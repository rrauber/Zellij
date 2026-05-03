import React from 'react';
import TilePreview from './TilePreview.jsx';

// Bottom drawer of saved tiles. Tapping a tile places it on the canvas (via
// onUseTile). The drawer height caps at half the container height so it doesn't
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
        className="absolute bottom-0 left-0 right-0 py-2 text-center text-sm"
        style={{
          background: '#3A2E1F',
          color: '#F1E9D6',
          letterSpacing: '0.1em',
          transform: sheetOpen ? `translateY(-${sheetH}px)` : 'translateY(0)',
          transition: 'transform 0.2s ease-out',
          zIndex: 10,
        }}
      >
        INVENTORY ({tiles.length}) {sheetOpen ? '▼' : '▲'}
      </button>

      <div
        className="absolute bottom-0 left-0 right-0 overflow-hidden"
        style={{
          background: '#E5DAC0',
          borderTop: '1px solid #3A2E1F',
          height: sheetOpen ? sheetH : 0,
          transition: 'height 0.2s ease-out',
        }}
      >
        <div className="overflow-x-auto overflow-y-hidden h-full p-3 flex gap-3">
          {tiles.length === 0 && (
            <div className="text-sm w-full self-center text-center" style={{ color: '#5C4A33', fontStyle: 'italic' }}>
              Construct a polygon to add tiles. Use the Polygon tool and tap segments forming a closed cycle.
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
