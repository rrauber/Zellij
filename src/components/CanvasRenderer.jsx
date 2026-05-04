import React, { useLayoutEffect, useRef } from 'react';
import { tilePathD, tilePathDWorld } from '../tiles/tilePath.js';
import { edgeToShape } from '../tiles/transform.js';
import { shapesEqual } from '../geometry/shapeEqual.js';
import { HANDLE_R } from '../constants.js';
import { COLOR } from '../theme.js';

// Three stacked <canvas> layers, painted independently:
//
//   static  — tile silhouettes, fills, wash, construction, inks, editing
//             outline. Repaints only when its inputs change.
//   markers — snap markers, handles, polygon-draft, line/circle preview.
//             Geometry- and click-driven, not cursor-driven; stable
//             between pointer moves.
//   cursor  — the single snap indicator. Cheap; repaints on every cursor
//             move while snapping.
//
// Splitting matters most for the line tool: snapIndicator updates every
// pointer move, but snap markers (potentially hundreds of circles) only
// change with geometry/draft state. The split keeps the marker grid out
// of the cursor-move repaint path.
//
// Pointer events go to the topmost (cursor) canvas; the lower two are
// `pointerEvents: none`.
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
  inkPaths,
  editing,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
}) {
  const staticCanvasRef = useRef(null);
  const markersCanvasRef = useRef(null);
  const cursorCanvasRef = useRef(null);

  // ---------- Static layer ----------
  useLayoutEffect(() => {
    const ctx = setupLayer(staticCanvasRef.current, containerSize, view);
    if (!ctx) return;

    const draw = strokeDrawer(ctx, view);

    // 1. (Removed: faint un-inked tile edge under-pass.) Drawing the polygon
    // outline as a faint stroke for every placed tile produced a visible
    // hairline on every internal tile-tile boundary that the sharedEdgeKeys
    // suppression failed to match — brittle to position drift, arc traversal
    // direction, etc. The silhouette wash below already defines the placed
    // tile's outline (tan inside, canvas color outside); inking a boundary
    // edge is the way to give it a stronger outline.

    // 2. Coloured face fills
    for (const cf of coloredFaces) {
      ctx.fillStyle = cf.color;
      ctx.fill(new Path2D(cf.d));
    }

    // 3. Combined silhouette wash, via an offscreen canvas.
    //
    // The naïve approach — one combined Path2D filled at alpha 0.25 — leaves
    // a visible hairline at the boundary between adjacent tile silhouettes.
    // Two AA-coverage values from adjacent tiles compose under `source-over`
    // as `s + d*(1-s)`, so a pixel covered 50% by each tile lands at alpha
    // 0.75 instead of 1.0; after the 0.25 composite that pixel reads ~0.19
    // vs ~0.25 just inside, painting a thin lighter line at the seam.
    //
    // Routing through an offscreen buffer at alpha 1.0 gets us most of the
    // way there (overlapping fills clamp to alpha 1.0), but per-tile AA at
    // the silhouette boundary still under-covers shared-edge pixels for the
    // same reason. Stroking each silhouette with a 1-device-pixel line in
    // the same color saturates those boundary pixels to full coverage, so
    // the union is a single uniformly opaque region on the offscreen canvas,
    // and the final composite produces one consistent wash with no seams.
    if (placed.length > 0) {
      const dpr = window.devicePixelRatio || 1;
      const off = document.createElement('canvas');
      off.width = staticCanvasRef.current.width;
      off.height = staticCanvasRef.current.height;
      const offCtx = off.getContext('2d');
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      offCtx.translate(view.tx, view.ty);
      offCtx.scale(view.scale, view.scale);
      offCtx.fillStyle = 'rgb(225,200,150)';
      offCtx.strokeStyle = 'rgb(225,200,150)';
      offCtx.lineWidth = 1 / view.scale;
      offCtx.lineJoin = 'miter';
      for (const pt of placed) {
        const tile = tiles.find((t) => t.id === pt.tileId);
        if (!tile) continue;
        const path = new Path2D(tilePathDWorld(tile, pt));
        offCtx.fill(path);
        offCtx.stroke(path);
      }

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.25;
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }

    // 4. Construction (Canvas)
    if (showCons) {
      Object.values(circles).forEach((c) => {
        draw({ type: 'wholeCircle', center: c.center, radius: c.radius }, '#9C8A6A', 1, 0.4);
      });
      Object.values(lines).forEach((l) => {
        draw({ type: 'line', a: l.p1, b: l.p2 }, '#9C8A6A', 1, 0.4);
      });

      placed.forEach((pt) => {
        const tile = tiles.find((t) => t.id === pt.tileId);
        if (!tile?.construction?.length) return;

        ctx.save();
        ctx.translate(pt.position.x, pt.position.y);
        ctx.rotate(pt.rotation);
        if (pt.flipped) ctx.scale(-1, 1);

        // Clip construction to the tile silhouette. The geometric clipper
        // captureClipped used at finalize is correct in the common cases
        // but has tricky edge conditions (a circle whose disk swallows the
        // polygon, an arc straddling the boundary at a degenerate point,
        // etc.) — a render-time clip is what guarantees nothing bleeds past
        // the tile, regardless of what the stored geometry contains.
        ctx.clip(new Path2D(tilePathD(tile)));

        tile.construction.forEach((c) => {
          draw(c, '#9C8A6A', 1, 0.4);
        });
        ctx.restore();
      });
    }

    // 5. Canvas inks
    inkPaths.forEach((p) => {
      draw(p, '#1B1B1B', 2.5, 1, 'round');
    });

    // 6. Over-pass for placed tiles
    placed.forEach((pt) => {
      const tile = tiles.find((t) => t.id === pt.tileId);
      if (!tile) return;

      ctx.save();
      ctx.translate(pt.position.x, pt.position.y);
      ctx.rotate(pt.rotation);
      if (pt.flipped) ctx.scale(-1, 1);

      tile.inks.forEach((ink) => {
        draw(ink, '#1B1B1B', 2, 1, 'round');
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

    ctx.restore();
  }, [
    view,
    lines, circles, placed, tiles,
    coloredFaces,
    showCons, isDragging,
    containerSize, inkPaths,
    editing,
  ]);

  // ---------- Markers layer ----------
  useLayoutEffect(() => {
    const ctx = setupLayer(markersCanvasRef.current, containerSize, view);
    if (!ctx) return;

    const draw = strokeDrawer(ctx, view);

    // 7. Polygon draft
    const polyDraftShape = (pd) => pd.seg.type === 'lineSeg'
      ? { type: 'line', a: pd.from, b: pd.to }
      : pd.seg;

    polyDraft.forEach((pd) => {
      draw(polyDraftShape(pd), '#C58A3A', 3, 0.85, 'round');
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
      draw(shape, '#8B2E1A', 3.5, 0.7, 'round');
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

    // Snap markers
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
    handles.forEach((h) => {
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
        ctx.fillText('+', h.x, h.y + 1 / view.scale);
      }
    });

    ctx.restore();
  }, [
    view,
    polyDraft, polyRejected, draft,
    handles, snapTargets, showSnapButtons,
    containerSize,
  ]);

  // ---------- Cursor layer ----------
  useLayoutEffect(() => {
    const ctx = setupLayer(cursorCanvasRef.current, containerSize, view);
    if (!ctx) return;

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
  }, [view, snapIndicator, containerSize]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={staticCanvasRef}  style={layerStyle} />
      <canvas ref={markersCanvasRef} style={layerStyle} />
      <canvas
        ref={cursorCanvasRef}
        style={{ ...layerStyle, pointerEvents: 'auto', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  );
}

const layerStyle = {
  position: 'absolute',
  top: 0, left: 0,
  display: 'block',
  width: '100%', height: '100%',
  pointerEvents: 'none',
};

// Common per-layer setup: resize for DPR, clear, apply view transform.
// Caller is responsible for the matching ctx.restore().
function setupLayer(canvas, containerSize, view) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = containerSize.w;
  const h = containerSize.h;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);
  return ctx;
}

// Builds a stroke helper bound to the given context and view scale, so each
// caller doesn't need to thread `view` through every drawShape call.
function strokeDrawer(ctx, view) {
  return (shape, strokeColor, strokeWidth, opacity = 1, lineCap = 'butt', dashArray = []) => {
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth / view.scale;
    ctx.globalAlpha = opacity;
    ctx.lineCap = lineCap;
    if (dashArray.length > 0) ctx.setLineDash(dashArray.map((d) => d / view.scale));
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
}
