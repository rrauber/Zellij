import React from 'react';
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
      <span
        style={{
          flex: '0 1 auto',
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >{hint}</span>

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
// Kept short enough to fit one row on a typical phone (~35–45 chars) so the
// status strip doesn't wrap. Falling-through cases are arranged from most
// specific (mid-draft prompt) to most general (idle tool). Fill is the one
// tool that returns an empty hint: when it's active the palette takes the
// row so the two don't crowd each other.
function computeHint({ tool, draft, polyDraft, editing }) {
  if (draft?.kind === 'line') return 'Tap the second point.';
  if (draft?.kind === 'circle' && draft.step === 'measureA') return 'Tap a second point for the radius.';
  if (draft?.kind === 'circle' && draft.step === 'placing') return 'Tap to place. Re-tap Circle to remeasure.';
  if (polyDraft?.length > 0) {
    return `Polygon: ${polyDraft.length} edge${polyDraft.length === 1 ? '' : 's'} — tap to extend, or close.`;
  }
  if (editing) {
    if (editing.kind === 'line')       return 'Editing line — drag handles to resize or rotate.';
    if (editing.kind === 'circle')     return 'Editing circle — drag centre or radius.';
    if (editing.kind === 'placedTile') return 'Editing tile — drag, rotate, flip.';
  }
  switch (tool) {
    case 'line':    return 'Line: tap two points to draw.';
    case 'circle':  return 'Circle: tap two points, then place.';
    case 'ink':     return 'Ink: tap to bold — inks bound colour fills.';
    case 'polygon': return 'Polygon: tap segments around a closed loop.';
    case 'fill':    return 'Fill: tap inside an inked region to colour it.';
    case 'select':  return 'Select: tap a line, circle, or tile.';
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

export function Swatch({ color, selected, onSelect }) {
  const isEraser = color === null;
  return (
    <button
      onClick={onSelect}
      title={isEraser ? 'Eraser' : color}
      style={{
        width: 20, height: 20,
        borderRadius: 10,
        background: isEraser ? 'transparent' : color,
        border: `1px solid ${selected ? COLOR.text : COLOR.borderStrong}`,
        boxShadow: selected ? `0 0 0 2px ${COLOR.surface}, 0 0 0 3px ${COLOR.text}` : 'none',
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
}
