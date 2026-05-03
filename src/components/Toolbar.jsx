import React from 'react';
import { COLOR } from '../theme.js';
import {
  LineIcon, CircleIcon, InkIcon, PolygonIcon, FillIcon, SelectIcon,
  UndoIcon, RedoIcon, EyeIcon, EyeOffIcon, CenterIcon, ClearIcon,
} from './icons.jsx';

const TOOLS = [
  { id: 'line',    label: 'Line',    shortcut: 'L', Icon: LineIcon    },
  { id: 'circle',  label: 'Circle',  shortcut: 'C', Icon: CircleIcon  },
  { id: 'ink',     label: 'Ink',     shortcut: 'I', Icon: InkIcon     },
  { id: 'polygon', label: 'Polygon', shortcut: 'P', Icon: PolygonIcon },
  { id: 'fill',    label: 'Fill',    shortcut: 'F', Icon: FillIcon    },
  { id: 'select',  label: 'Select',  shortcut: 'V', Icon: SelectIcon  },
];

export default function Toolbar({
  tool, onSelectTool,
  onUndo, canUndo,
  onRedo, canRedo,
  showCons, onToggleCons,
  onRecenter,
  confirmClear, onClear,
}) {
  return (
    <div
      className="flex items-center px-2 py-1.5 gap-1 flex-wrap"
      style={{
        background: COLOR.surface,
        borderBottom: `1px solid ${COLOR.border}`,
      }}
    >
      {TOOLS.map(({ id, label, shortcut, Icon }) => (
        <Btn
          key={id}
          active={tool === id}
          onClick={() => onSelectTool(id)}
          title={`${label} (${shortcut})`}
        >
          <Icon />
        </Btn>
      ))}
      <div style={{ flex: 1 }} />
      <Btn onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)"><UndoIcon /></Btn>
      <Btn onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)"><RedoIcon /></Btn>
      <Btn
        onClick={onToggleCons}
        title={showCons ? 'Hide construction (H)' : 'Show construction (H)'}
        active={!showCons}
      >
        {showCons ? <EyeIcon /> : <EyeOffIcon />}
      </Btn>
      <Btn onClick={onRecenter} title="Recenter (R)"><CenterIcon /></Btn>
      <Btn
        onClick={onClear}
        danger
        confirming={confirmClear}
        title={confirmClear ? 'Tap again to clear canvas' : 'Clear canvas'}
      >
        {confirmClear ? <span style={{ fontSize: 11, fontWeight: 600 }}>clear?</span> : <ClearIcon />}
      </Btn>
    </div>
  );
}

// Single button style used everywhere in the toolbar. Default state is
// borderless and transparent for a calm look; hover/active/danger paint
// the surface as needed. `active` = filled dark glyph (current tool / pressed
// toggles); `danger` = the destructive red on confirmation; `disabled` is
// dimmed and non-interactive.
function Btn({ children, onClick, disabled, title, active, danger, confirming }) {
  const base = {
    width: 36,
    height: 36,
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: '1px solid transparent',
    background: 'transparent',
    color: COLOR.text,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
    padding: 0,
    minWidth: confirming ? 56 : undefined,
  };
  let style = base;
  if (active) {
    style = { ...base, background: COLOR.active, color: COLOR.activeText };
  } else if (confirming) {
    style = {
      ...base,
      background: COLOR.danger,
      color: COLOR.activeText,
      borderColor: COLOR.danger,
      paddingLeft: 8, paddingRight: 8,
    };
  } else if (danger) {
    style = { ...base, color: COLOR.danger };
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      onMouseEnter={(e) => {
        if (disabled || active || confirming) return;
        e.currentTarget.style.background = COLOR.hover;
      }}
      onMouseLeave={(e) => {
        if (disabled || active || confirming) return;
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
