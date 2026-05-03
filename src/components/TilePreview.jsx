import React from 'react';
import { tilePathD } from '../tiles/tilePath.js';
import { arcPathCCW } from '../geometry/arc.js';
import { edgeToShape } from '../tiles/transform.js';
import { shapesEqual } from '../geometry/shapeEqual.js';
import { COLOR } from '../theme.js';

// Thumbnail of a tile in the inventory drawer. Tap the thumbnail to place it
// onto the canvas; tap "delete" to remove the tile (and any placements of it).
//
// Edges render bold (via the inks pass) when a matching boundary ink exists,
// faint otherwise — same convention as the canvas-level placed-tile renderer.
export default function TilePreview({ tile, onUse, onDelete }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of tile.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  const pad = 6;
  const w = maxX - minX + 2 * pad;
  const h = maxY - minY + 2 * pad;
  const size = 100;
  const strokeInk = Math.max(w, h) / 50;
  const strokeFaint = Math.max(w, h) / 100;

  // Edges with no matching ink → render faintly so the tile silhouette is
  // legible. Edges that *do* have a matching ink draw bold via the inks pass.
  const uninkedEdgeShapes = tile.edges
    .map((e) => edgeToShape(e, tile.vertices))
    .filter((s) => s && !tile.inks.some((ink) => shapesEqual(s, ink)));

  const renderShape = (s, key, stroke, strokeWidth, opacity = 1) => {
    if (s.type === 'line') {
      return (
        <line key={key} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y}
          stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" opacity={opacity} />
      );
    }
    if (s.type === 'arc') {
      return (
        <path key={key} d={arcPathCCW(s.center, s.radius, s.ang1, s.ang2)}
          fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" opacity={opacity} />
      );
    }
    if (s.type === 'wholeCircle') {
      return (
        <circle key={key} cx={s.center.x} cy={s.center.y} r={s.radius}
          fill="none" stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} />
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col items-center" style={{ minWidth: '110px' }}>
      <div
        onClick={onUse}
        className="cursor-pointer"
        style={{
          background: COLOR.canvas,
          border: `1px solid ${COLOR.border}`,
          borderRadius: 8,
          padding: 4,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <svg width={size} height={size} viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}>
          <path d={tilePathD(tile)} fill="rgba(225,200,150,0.4)" stroke="none" />
          {uninkedEdgeShapes.map((s, i) => renderShape(s, `ue-${i}`, COLOR.construction, strokeFaint, 0.5))}
          {tile.inks.map((ink, i) => renderShape(ink, i, COLOR.ink, strokeInk))}
        </svg>
      </div>
      <button
        onClick={onDelete}
        className="text-xs mt-1"
        style={{ color: COLOR.danger, background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        delete
      </button>
    </div>
  );
}
