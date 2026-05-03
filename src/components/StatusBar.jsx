import React from 'react';
import { COLOR_PALETTE } from '../constants.js';
import { COLOR } from '../theme.js';

// Always-visible thin strip below the toolbar. Two jobs:
//   1. Surface a one-line hint about what the current tool does, so the user
//      doesn't have to guess what each toolbar icon means (especially on
//      mobile where tooltips don't exist).
//   2. House transient context: in-progress draft prompts, polygon progress,
//      and the controls for whatever object is currently being edited.
//      The colour palette also lives here when the Fill tool is active.
//
// One bar instead of separate "tool hint" and "editing controls" surfaces —
// keeps the chrome budget tight on narrow viewports.

export default function StatusBar({
  draft, polyDraft, editing,
  onClearEditing,
  onDeleteLine, onDeleteCircle, onDeletePlaced,
  rotationStepDeg, rotationStepRad,
  onCycleRotationStep,
  onRotatePlaced, onSnapPlacedToGrid, onResetPlaced, onFlipPlaced,
  tool, selectedColor, onSelectColor,
}) {
  const hint = computeHint({ tool, draft, polyDraft, editing });

  return (
    <div
      className="px-3 py-1.5 text-xs flex items-center gap-2"
      style={{
        background: COLOR.surfaceAlt,
        color: COLOR.textMuted,
        borderBottom: `1px solid ${COLOR.border}`,
        minHeight: 32,
      }}
    >
      <span style={{ flex: '0 1 auto' }}>{hint}</span>

      {tool === 'fill' && (
        <div className="flex items-center gap-1.5" style={{ marginLeft: 8 }}>
          {COLOR_PALETTE.map((c) => {
            const isSelected = c === selectedColor;
            const isEraser = c === null;
            return (
              <button
                key={c ?? 'eraser'}
                onClick={() => onSelectColor(c)}
                title={isEraser ? 'Eraser' : c}
                style={{
                  width: 20, height: 20,
                  borderRadius: 10,
                  background: isEraser ? 'transparent' : c,
                  border: `1px solid ${isSelected ? COLOR.text : COLOR.borderStrong}`,
                  boxShadow: isSelected ? `0 0 0 2px ${COLOR.surface}, 0 0 0 3px ${COLOR.text}` : 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                {isEraser && (
                  <span style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: COLOR.textMuted,
                  }}>✕</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {editing && !draft && (
        <div className="flex gap-1.5 items-center" style={{ marginLeft: 'auto' }}>
          {editing.kind === 'placedTile' && (
            <>
              <SmallBtn onClick={onCycleRotationStep} title="Cycle rotation step">
                {rotationStepDeg}°
              </SmallBtn>
              <SmallBtn onClick={() => onRotatePlaced(editing.id, -rotationStepRad)} title="Rotate counter-clockwise">↺</SmallBtn>
              <SmallBtn onClick={() => onRotatePlaced(editing.id, rotationStepRad)}  title="Rotate clockwise">↻</SmallBtn>
              <SmallBtn onClick={() => onSnapPlacedToGrid(editing.id)}              title="Snap rotation to grid">⊞</SmallBtn>
              <SmallBtn onClick={() => onResetPlaced(editing.id)}                   title="Reset orientation">⟲</SmallBtn>
              <SmallBtn onClick={() => onFlipPlaced(editing.id)}                    title="Flip">⇄</SmallBtn>
              <SmallBtn onClick={() => onDeletePlaced(editing.id)}                  title="Delete (⌫)" danger>delete</SmallBtn>
            </>
          )}
          {editing.kind === 'line'   && <SmallBtn onClick={() => onDeleteLine(editing.id)}   title="Delete (⌫)" danger>delete</SmallBtn>}
          {editing.kind === 'circle' && <SmallBtn onClick={() => onDeleteCircle(editing.id)} title="Delete (⌫)" danger>delete</SmallBtn>}
          <SmallBtn onClick={onClearEditing} title="Done (Esc)">done</SmallBtn>
        </div>
      )}
    </div>
  );
}

// One-line description of the current tool / draft / polygon-progress state.
// Falling-through cases are arranged from most specific (mid-draft prompt) to
// most general (idle tool).
function computeHint({ tool, draft, polyDraft, editing }) {
  if (draft?.kind === 'line') return 'Tap to set the second endpoint.';
  if (draft?.kind === 'circle' && draft.step === 'measureA') return 'Tap a second point to set the compass width.';
  if (draft?.kind === 'circle' && draft.step === 'placing') return 'Tap to place a circle. Tap the Circle tool to remeasure.';
  if (polyDraft?.length > 0) {
    return `Polygon: ${polyDraft.length} edge${polyDraft.length === 1 ? '' : 's'} — tap a connecting segment, or close back to the start.`;
  }
  if (editing) {
    if (editing.kind === 'line')       return 'Editing line — drag the handles to lengthen or rotate.';
    if (editing.kind === 'circle')     return 'Editing circle — drag the centre or radius handle.';
    if (editing.kind === 'placedTile') return 'Editing tile — drag to move, use the controls to rotate/flip.';
  }
  switch (tool) {
    case 'line':    return 'Line: tap two points to draw a line.';
    case 'circle':  return 'Circle: tap two points to set the compass, then tap to place.';
    case 'ink':     return 'Ink: tap a construction segment to bold it. Tap a tile edge to toggle its boldness.';
    case 'polygon': return 'Polygon: tap segments around a closed loop to capture as a tile.';
    case 'fill':    return 'Fill: tap inside a region to apply the selected colour.';
    case 'select':  return 'Select: tap a line, circle, or tile to edit it.';
    default:        return '';
  }
}

function SmallBtn({ children, onClick, title, danger }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        height: 24,
        padding: '0 8px',
        borderRadius: 4,
        border: `1px solid ${COLOR.border}`,
        background: COLOR.surface,
        color: danger ? COLOR.danger : COLOR.text,
        fontSize: 11,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >{children}</button>
  );
}
