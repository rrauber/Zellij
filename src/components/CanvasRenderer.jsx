import React, { useLayoutEffect, useRef } from 'react';
import { tilePathD } from '../tiles/tilePath.js';
import { edgeToShape } from '../tiles/transform.js';
import { shapesEqual } from '../geometry/shapeEqual.js';
import { HANDLE_R } from '../constants.js';
import { COLOR } from '../theme.js';

export default function CanvasRenderer({
  view,
  lines,
  circles,
  placed,
  tiles,
  inks,
  planarFaces,
  coloredFaces,
  polyDraft,
  polyRejected,
  draft,
  handles,
  snapIndicator,
  snapTargets,
  showSnapButtons,
  showCons,
  isDragging,
  containerSize,
  sharedEdgeKeys,
  inkPaths,
  combinedSilhouettePath,
  editing,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel
}) {
  const canvasRef = useRef(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = containerSize.w;
    const h = containerSize.h;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    const drawStrokedShape = (shape, strokeColor, strokeWidth, opacity = 1, lineCap = 'butt', dashArray = []) => {
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth / view.scale; // emulate non-scaling-stroke
      ctx.globalAlpha = opacity;
      ctx.lineCap = lineCap;
      if (dashArray.length > 0) ctx.setLineDash(dashArray.map(d => d / view.scale));
      else ctx.setLineDash([]);

      ctx.beginPath();
      if (shape.type === 'line') {
        ctx.moveTo(shape.a.x, shape.a.y);
        ctx.lineTo(shape.b.x, shape.b.y);
      } else if (shape.type === 'arc') {
        ctx.arc(shape.center.x, shape.center.y, shape.radius, shape.ang1, shape.ang2, false);
      } else if (shape.type === 'wholeCircle') {
        ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();
    };

    // 1. Under-pass for placed tiles
    for (const pt of placed) {
      const tile = tiles.find(t => t.id === pt.tileId);
      if (!tile) continue;
      
      ctx.save();
      ctx.translate(pt.position.x, pt.position.y);
      ctx.rotate(pt.rotation);
      if (pt.flipped) ctx.scale(-1, 1);

      tile.edges.forEach((e, idx) => {
        const s = edgeToShape(e, tile.vertices);
        if (!s) return;
        if (tile.inks.some(ink => shapesEqual(s, ink))) return;
        if (sharedEdgeKeys.has(`${pt.id}:${idx}`)) return;
        
        drawStrokedShape(s, '#9C8A6A', 1, 0.4);
      });
      ctx.restore();
    }

    // 2. Coloured face fills
    if (!isDragging) {
      for (const cf of coloredFaces) {
        ctx.fillStyle = cf.color;
        ctx.fill(new Path2D(cf.d));
      }
    }

    // 3. Combined silhouette wash
    if (combinedSilhouettePath) {
      ctx.fillStyle = "rgba(225,200,150,0.25)";
      ctx.fill(new Path2D(combinedSilhouettePath));
    }

    // 4. Construction (Canvas)
    if (showCons) {
      Object.values(circles).forEach(c => {
        drawStrokedShape({ type: 'wholeCircle', center: c.center, radius: c.radius }, '#9C8A6A', 1, 0.4);
      });
      Object.values(lines).forEach(l => {
        drawStrokedShape({ type: 'line', a: l.p1, b: l.p2 }, '#9C8A6A', 1, 0.4);
      });

      // Per-tile interior construction
      placed.forEach(pt => {
        const tile = tiles.find(t => t.id === pt.tileId);
        if (!tile?.construction?.length) return;

        ctx.save();
        ctx.translate(pt.position.x, pt.position.y);
        ctx.rotate(pt.rotation);
        if (pt.flipped) ctx.scale(-1, 1);

        tile.construction.forEach(c => {
          drawStrokedShape(c, '#9C8A6A', 1, 0.4);
        });
        ctx.restore();
      });
    }

    // 5. Canvas inks
    inkPaths.forEach(p => {
      drawStrokedShape(p, '#1B1B1B', 2.5, 1, 'round');
    });

    // 6. Over-pass for placed tiles
    placed.forEach(pt => {
      const tile = tiles.find(t => t.id === pt.tileId);
      if (!tile) return;

      ctx.save();
      ctx.translate(pt.position.x, pt.position.y);
      ctx.rotate(pt.rotation);
      if (pt.flipped) ctx.scale(-1, 1);

      tile.inks.forEach(ink => {
        drawStrokedShape(ink, '#1B1B1B', 2, 1, 'round');
      });

      if (editing?.kind === 'placedTile' && editing.id === pt.id) {
        ctx.strokeStyle = '#C58A3A';
        ctx.lineWidth = 2.5 / view.scale;
        ctx.setLineDash([4 / view.scale, 3 / view.scale]);
        ctx.stroke(new Path2D(tilePathD(tile)));
        ctx.setLineDash([]);
      }

      ctx.restore();
    });

    // 7. Polygon draft
    const polyDraftShape = (pd) => pd.seg.type === 'lineSeg'
      ? { type: 'line', a: pd.from, b: pd.to }
      : pd.seg;

    polyDraft.forEach(pd => {
      drawStrokedShape(polyDraftShape(pd), '#C58A3A', 3, 0.85, 'round');
    });

    if (polyDraft.length > 0) {
      const start = polyDraft[0].from;
      const next = polyDraft[polyDraft.length - 1].to;
      const sameAsStart = polyDraft[0].pidFrom !== undefined &&
        polyDraft[0].pidFrom === polyDraft[polyDraft.length - 1].pidTo;

      ctx.strokeStyle = '#C58A3A';
      ctx.lineWidth = 2 / view.scale;
      ctx.setLineDash([3 / view.scale, 2 / view.scale]);
      ctx.beginPath();
      ctx.arc(start.x, start.y, 11 / view.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!sameAsStart) {
        ctx.fillStyle = '#C58A3A';
        ctx.strokeStyle = '#3A2E1F';
        ctx.lineWidth = 1.5 / view.scale;
        ctx.beginPath();
        ctx.arc(next.x, next.y, 9 / view.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (polyRejected) {
      const shape = polyRejected.type === 'lineSeg'
        ? { type: 'line', a: polyRejected.a, b: polyRejected.b }
        : polyRejected;
      drawStrokedShape(shape, '#8B2E1A', 3.5, 0.7, 'round');
    }

    // Draft rendering
    if (draft?.kind === 'line') {
      ctx.strokeStyle = '#C58A3A';
      ctx.lineWidth = 1.5 / view.scale;
      ctx.setLineDash([4 / view.scale, 3 / view.scale]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(draft.p1.x, draft.p1.y, 5 / view.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    } else if (draft?.kind === 'circle') {
      ctx.strokeStyle = '#C58A3A';
      ctx.lineWidth = 1.5 / view.scale;
      ctx.setLineDash([4 / view.scale, 3 / view.scale]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(draft.refA.x, draft.refA.y, 5 / view.scale, 0, Math.PI * 2);
      ctx.stroke();
      if (draft.refB) {
        ctx.beginPath();
        ctx.arc(draft.refB.x, draft.refB.y, 5 / view.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#C58A3A';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(draft.refA.x, draft.refA.y);
        ctx.lineTo(draft.refB.x, draft.refB.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Snap Markers
    if (showSnapButtons && snapTargets) {
      const tol = 1 / view.scale;
      const tolSq = tol * tol;

      const isAnchor = (markerPos) => {
        if (draft?.kind === 'line' && draft.p1) {
          const dx = markerPos.x - draft.p1.x, dy = markerPos.y - draft.p1.y;
          if (dx * dx + dy * dy < tolSq) return true;
        }
        if (draft?.kind === 'circle') {
          if (draft.refA) {
            const dx = markerPos.x - draft.refA.x, dy = markerPos.y - draft.refA.y;
            if (dx * dx + dy * dy < tolSq) return true;
          }
          if (draft.refB) {
            const dx = markerPos.x - draft.refB.x, dy = markerPos.y - draft.refB.y;
            if (dx * dx + dy * dy < tolSq) return true;
          }
        }
        return false;
      };

      const left = -view.tx / view.scale;
      const right = (containerSize.w - view.tx) / view.scale;
      const top = -view.ty / view.scale;
      const bottom = (containerSize.h - view.ty) / view.scale;
      const pad = 10 / view.scale;

      const { grid, gridSize } = snapTargets;
      if (grid) {
        const gx1 = Math.floor((left - pad) / gridSize);
        const gx2 = Math.floor((right + pad) / gridSize);
        const gy1 = Math.floor((top - pad) / gridSize);
        const gy2 = Math.floor((bottom + pad) / gridSize);

        const bucketSize = Math.max(0.1, 1 / view.scale);
        const seen = new Set();

        for (let gx = gx1; gx <= gx2; gx++) {
          for (let gy = gy1; gy <= gy2; gy++) {
            const bucket = grid.get(`${gx},${gy}`);
            if (!bucket) continue;

            for (const p of bucket) {
              // Grid-based deduping (visual only, keep it simple)
              const bx = Math.round(p.x / bucketSize);
              const by = Math.round(p.y / bucketSize);
              const key = `${bx},${by}`;
              if (seen.has(key)) continue;
              seen.add(key);

              const sel = isAnchor(p);
              ctx.fillStyle = sel ? '#C58A3A' : COLOR.canvas;
              ctx.strokeStyle = '#3A2E1F';
              ctx.lineWidth = (sel ? 2.5 : 1.2) / view.scale;
              ctx.beginPath();
              ctx.arc(p.x, p.y, (sel ? 10 : 7) / view.scale, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
        }
      }
    }

    // Handles
    handles.forEach(h => {
      if (h.showTether && h.kind === 'rotate' && h.pivot) {
        ctx.strokeStyle = '#9C8A6A';
        ctx.lineWidth = 1 / view.scale;
        ctx.setLineDash([3 / view.scale, 3 / view.scale]);
        ctx.beginPath();
        ctx.moveTo(h.pivot.x, h.pivot.y);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = COLOR.canvas;
      ctx.strokeStyle = '#3A2E1F';
      ctx.lineWidth = 1.5 / view.scale;
      ctx.beginPath();
      ctx.arc(h.x, h.y, HANDLE_R / view.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (h.kind === 'rotate') {
        ctx.fillStyle = '#3A2E1F';
        ctx.beginPath();
        ctx.arc(h.x, h.y, (HANDLE_R - 6) / view.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      if (h.kind === 'lengthen') {
        ctx.strokeStyle = '#3A2E1F';
        ctx.lineWidth = 2 / view.scale;
        ctx.beginPath();
        ctx.moveTo(h.x - 5 / view.scale, h.y);
        ctx.lineTo(h.x + 5 / view.scale, h.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(h.x, h.y - 5 / view.scale);
        ctx.lineTo(h.x, h.y + 5 / view.scale);
        ctx.stroke();
      }
      if (h.kind === 'radius') {
        ctx.fillStyle = '#3A2E1F';
        ctx.beginPath();
        ctx.arc(h.x, h.y, (HANDLE_R - 8) / view.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      if (h.kind === 'center') {
        ctx.fillStyle = '#3A2E1F';
        ctx.font = `${12 / view.scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', h.x, h.y + 1 / view.scale); // adjusted for visual centering
      }
    });

    // Snap Indicator
    if (snapIndicator) {
      ctx.strokeStyle = '#C58A3A';
      ctx.lineWidth = 2 / view.scale;
      ctx.beginPath();
      ctx.arc(snapIndicator.x, snapIndicator.y, 10 / view.scale, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.fillStyle = '#C58A3A';
      ctx.beginPath();
      ctx.arc(snapIndicator.x, snapIndicator.y, 3 / view.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

  }, [
    view, lines, circles, placed, tiles, inks, planarFaces, coloredFaces,
    polyDraft, polyRejected, draft, handles, snapIndicator, snapTargets, showSnapButtons, showCons, isDragging,
    containerSize, sharedEdgeKeys, inkPaths, combinedSilhouettePath, editing
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    />
  );
}