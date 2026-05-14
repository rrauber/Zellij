import React, { useLayoutEffect, useRef } from 'react';
import { tilePathD } from '../tiles/tilePath.js';
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

    // 1a. Default tile silhouette fill — a hair warmer/darker than the
    // canvas so unfilled tiles read as distinct shapes. Coloured face
    // fills below paint over this where applicable.
    placed.forEach((pt) => {
      const tile = tiles.find((t) => t.id === pt.tileId);
      if (!tile) return;
      ctx.save();
      ctx.translate(pt.position.x, pt.position.y);
      ctx.rotate(pt.rotation);
      if (pt.flipped) ctx.scale(-1, 1);
      ctx.fillStyle = COLOR.tileFill;
      ctx.fill(new Path2D(tilePathD(tile)));
      ctx.restore();
    });

    // 1. Coloured face fills, drawn straight onto the canvas. The default
    // palette colours have the old tile-silhouette wash pre-blended into
    // them, so they sit consistently against the lighter tile-fill backdrop.
    for (const cf of coloredFaces) {
      ctx.fillStyle = cf.color;
      ctx.fill(new Path2D(cf.d));
    }

    // 2. Construction (Canvas)
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
        // Two arc segments on the axis perpendicular to pivot→handle, each
        // capped with a filled triangular arrowhead pointing FORWARD past
        // the arc end. The arc terminates at the triangle's base so they
        // meet smoothly without the arrowhead-wings-cross-the-shaft problem
        // of an open chevron.
        ctx.strokeStyle = '#3A2E1F';
        ctx.fillStyle = '#3A2E1F';
        ctx.lineWidth = 1.6 / view.scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        let radialAngle = 0;
        if (h.pivot && (h.x !== h.pivot.x || h.y !== h.pivot.y)) {
          radialAngle = Math.atan2(h.y - h.pivot.y, h.x - h.pivot.x);
        }
        const r = 8 / view.scale;       // arc radius (HANDLE_R is 14)
        const span = 1.3;               // arc span in radians (~75°)
        const headLen = 4 / view.scale; // arrowhead length along tangent
        const headHalf = 2.5 / view.scale; // arrowhead half-width
        for (const offset of [Math.PI / 2, -Math.PI / 2]) {
          const center = radialAngle + offset;
          const startA = center - span / 2;
          const endA = center + span / 2;
          ctx.beginPath();
          ctx.arc(h.x, h.y, r, startA, endA);
          ctx.stroke();
          // Tangent + radial at endA.
          const ex = h.x + r * Math.cos(endA);
          const ey = h.y + r * Math.sin(endA);
          const tx = -Math.sin(endA), ty = Math.cos(endA); // CCW tangent
          const nx = Math.cos(endA), ny = Math.sin(endA);  // outward radial (perp to tangent)
          // Triangle: tip forward along tangent, base perpendicular at arc end.
          ctx.beginPath();
          ctx.moveTo(ex + tx * headLen, ey + ty * headLen);
          ctx.lineTo(ex + nx * headHalf, ey + ny * headHalf);
          ctx.lineTo(ex - nx * headHalf, ey - ny * headHalf);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (h.kind === 'lengthen' || h.kind === 'radius') {
        // Arrow pointing outward in the extension direction. Geometrically
        // centered on the handle so the icon sits in the middle of the
        // handle circle.
        const dir = h.dir || { x: 1, y: 0 };
        ctx.strokeStyle = '#3A2E1F';
        ctx.lineWidth = 1.8 / view.scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const half = 7 / view.scale;    // half-shaft (HANDLE_R is 14)
        const tipX = h.x + dir.x * half;
        const tipY = h.y + dir.y * half;
        const baseX = h.x - dir.x * half;
        const baseY = h.y - dir.y * half;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        const head = 5 / view.scale;
        const px = -dir.y, py = dir.x; // perpendicular to dir
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - dir.x * head + px * head * 0.6, tipY - dir.y * head + py * head * 0.6);
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - dir.x * head - px * head * 0.6, tipY - dir.y * head - py * head * 0.6);
        ctx.stroke();
      }
      if (h.kind === 'center') {
        // Drawn as two stroked lines instead of a text glyph so it sits
        // exactly at the handle center — text-baseline geometry is fonty
        // and never quite lands centered.
        ctx.strokeStyle = '#3A2E1F';
        ctx.lineWidth = 1.8 / view.scale;
        ctx.lineCap = 'round';
        const arm = 5 / view.scale;
        ctx.beginPath();
        ctx.moveTo(h.x - arm, h.y);
        ctx.lineTo(h.x + arm, h.y);
        ctx.moveTo(h.x, h.y - arm);
        ctx.lineTo(h.x, h.y + arm);
        ctx.stroke();
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
