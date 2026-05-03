import React from 'react';
import { tilePathD } from '../tiles/tilePath.js';
import { arcPathCCW } from '../geometry/arc.js';

// Thumbnail of a tile in the inventory drawer. Tap the thumbnail to place it
// onto the canvas; tap "delete" to remove the tile (and any placements of it).
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
  const strokeBoundary = Math.max(w, h) / 60;
  const strokeInk = Math.max(w, h) / 50;

  return (
    <div className="flex flex-col items-center" style={{ minWidth: '110px' }}>
      <div
        onClick={onUse}
        className="cursor-pointer rounded"
        style={{ background: '#F1E9D6', border: '1px solid #3A2E1F', padding: '4px' }}
      >
        <svg width={size} height={size} viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}>
          <path d={tilePathD(tile)} fill="rgba(225,200,150,0.4)" stroke="#3A2E1F" strokeWidth={strokeBoundary} />
          {tile.inks.map((ink, i) => {
            if (ink.type === 'line') {
              return (
                <line
                  key={i}
                  x1={ink.a.x} y1={ink.a.y} x2={ink.b.x} y2={ink.b.y}
                  stroke="#1B1B1B" strokeWidth={strokeInk} strokeLinecap="round"
                />
              );
            }
            if (ink.type === 'arc') {
              return (
                <path
                  key={i}
                  d={arcPathCCW(ink.center, ink.radius, ink.ang1, ink.ang2)}
                  fill="none" stroke="#1B1B1B" strokeWidth={strokeInk} strokeLinecap="round"
                />
              );
            }
            if (ink.type === 'wholeCircle') {
              return (
                <circle
                  key={i}
                  cx={ink.center.x} cy={ink.center.y} r={ink.radius}
                  fill="none" stroke="#1B1B1B" strokeWidth={strokeInk}
                />
              );
            }
            return null;
          })}
        </svg>
      </div>
      <button onClick={onDelete} className="text-xs mt-1" style={{ color: '#8B2E1A' }}>
        delete
      </button>
    </div>
  );
}
