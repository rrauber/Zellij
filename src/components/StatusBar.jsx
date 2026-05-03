import React from 'react';

// The skinny strip below the toolbar. Shows draft hints, polygon progress, and
// editing controls (rotation step, flip, delete) when an item is selected.
export default function StatusBar({
  draft, polyDraft, editing,
  onClearEditing,
  onDeleteLine, onDeleteCircle, onDeletePlaced,
  rotationStepDeg, rotationStepRad,
  onCycleRotationStep,
  onRotatePlaced, onSnapPlacedToGrid, onResetPlaced, onFlipPlaced,
}) {
  const visible = draft || polyDraft.length > 0 || editing;
  if (!visible) return null;

  return (
    <div className="px-3 py-1 text-xs" style={{ background: '#D9C9A4', color: '#3A2E1F', fontStyle: 'italic' }}>
      {draft?.kind === 'line' && 'Tap to set second endpoint'}
      {draft?.kind === 'circle' && draft.step === 'measureA' && 'Tap second point to set compass width'}
      {draft?.kind === 'circle' && draft.step === 'placing' && 'Tap any point to place a circle. Tap Circle tool to remeasure.'}
      {polyDraft.length > 0 && `Polygon: ${polyDraft.length} edge${polyDraft.length === 1 ? '' : 's'} selected. Tap connecting segment, or close back to start.`}
      {editing && !draft && (
        <div className="flex gap-2 items-center">
          <span>Editing {editing.kind}</span>
          {editing.kind === 'line' && (
            <button onClick={() => onDeleteLine(editing.id)} className="ml-auto px-2 py-0.5" style={{ color: '#8B2E1A' }}>delete</button>
          )}
          {editing.kind === 'circle' && (
            <button onClick={() => onDeleteCircle(editing.id)} className="ml-auto px-2 py-0.5" style={{ color: '#8B2E1A' }}>delete</button>
          )}
          {editing.kind === 'placedTile' && (
            <>
              <button
                onClick={onCycleRotationStep}
                title="Tap to cycle rotation step"
                className="px-2 py-0.5"
                style={{ border: '1px solid #3A2E1F', background: '#E5DAC0', minWidth: 44 }}
              >
                {rotationStepDeg}°
              </button>
              <button onClick={() => onRotatePlaced(editing.id, -rotationStepRad)} title="Rotate counter-clockwise by step" className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>↺</button>
              <button onClick={() => onRotatePlaced(editing.id, rotationStepRad)}  title="Rotate clockwise by step"        className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>↻</button>
              <button onClick={() => onSnapPlacedToGrid(editing.id)}              title="Snap rotation to step grid"     className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>⊞</button>
              <button onClick={() => onResetPlaced(editing.id)}                   title="Reset to original orientation"  className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>⟲</button>
              <button onClick={() => onFlipPlaced(editing.id)}                                                            className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>flip</button>
              <button onClick={() => onDeletePlaced(editing.id)}                                                          className="px-2 py-0.5" style={{ color: '#8B2E1A' }}>delete</button>
            </>
          )}
          <button onClick={onClearEditing} className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>done</button>
        </div>
      )}
    </div>
  );
}
