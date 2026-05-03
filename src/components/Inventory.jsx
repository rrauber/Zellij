import React from 'react';
import TilePreview from './TilePreview.jsx';
import { COLOR } from '../theme.js';

// Bottom drawer of saved tiles. Tapping a tile places it on the canvas (via
// onUseTile). Drawer height caps at half the container height so it doesn't
// swallow the canvas on short screens.
export default function Inventory({
  tiles, sheetOpen, containerHeight,
  onToggleSheet, onUseTile, onDeleteTile,
}) {
  const sheetH = Math.min(280, containerHeight * 0.5);

  return (
    <>
      <button
        onClick={onToggleSheet}
        className="absolute bottom-0 left-0 right-0 py-2 text-center text-sm flex items-center justify-center gap-2"
        style={{
          background: COLOR.surface,
          color: COLOR.text,
          borderTop: `1px solid ${COLOR.border}`,
          letterSpacing: '0.04em',
          transform: sheetOpen ? `translateY(-${sheetH}px)` : 'translateY(0)',
          transition: 'transform 0.2s ease-out',
          zIndex: 10,
          fontWeight: 500,
        }}
      >
        <span>Inventory</span>
        <span style={{ color: COLOR.textMuted, fontSize: 12 }}>{tiles.length}</span>
        <span style={{ color: COLOR.textMuted, marginLeft: 4 }}>{sheetOpen ? '▾' : '▴'}</span>
      </button>

      <div
        className="absolute bottom-0 left-0 right-0 overflow-hidden"
        style={{
          background: COLOR.surface,
          borderTop: `1px solid ${COLOR.border}`,
          height: sheetOpen ? sheetH : 0,
          transition: 'height 0.2s ease-out',
        }}
      >
        <div className="overflow-x-auto overflow-y-hidden h-full p-3 flex gap-3">
          {tiles.length === 0 && (
            <div className="text-sm w-full self-center text-center"
                 style={{ color: COLOR.textMuted }}>
              Use the Polygon tool to outline a closed region — it'll be saved as a tile here.
            </div>
          )}
          {tiles.map((tile) => (
            <TilePreview
              key={tile.id}
              tile={tile}
              onUse={() => onUseTile(tile)}
              onDelete={() => onDeleteTile(tile.id)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
