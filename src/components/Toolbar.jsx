import React, { useEffect, useRef, useState } from 'react';

// Whether the device looks like a desktop pointer: hover-capable + fine
// (mouse-like) pointer. Used to decide whether to surface keyboard
// shortcuts on the toolbar icons — touch users have no keyboard, so the
// hint just adds clutter for them.
function useHasFinePointer() {
  const [yes, setYes] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
      : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const onChange = (e) => setYes(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return yes;
}
import { COLOR } from '../theme.js';
import {
  LineIcon, CircleIcon, InkIcon, PolygonIcon, FillIcon, SelectIcon,
  EyeIcon, EyeOffIcon, ClearIcon, KebabIcon,
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
  showCons, onToggleCons,
  confirmClear, onClear,
}) {
  const showShortcuts = useHasFinePointer();
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
          shortcut={showShortcuts ? shortcut : null}
        >
          <Icon />
        </Btn>
      ))}
      <div style={{ flex: 1 }} />
      <KebabMenu
        showCons={showCons}
        onToggleCons={onToggleCons}
        confirmClear={confirmClear}
        onClear={onClear}
      />
    </div>
  );
}

// Overflow menu housing the rarely-used actions: construction visibility
// and clearing the canvas. Keeps the main toolbar to just the tool buttons
// so it fits one row on phone-width viewports.
function KebabMenu({ showCons, onToggleCons, confirmClear, onClear }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close on any pointer-down outside the menu wrapper. Using pointerdown
  // (rather than click) means the menu dismisses as soon as the user
  // starts touching elsewhere, matching the feel of native overflow menus.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <Btn onClick={() => setOpen((o) => !o)} active={open} title="More">
        <KebabIcon />
      </Btn>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: COLOR.surface,
            border: `1px solid ${COLOR.border}`,
            borderRadius: 6,
            boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
            minWidth: 200,
            padding: 4,
            zIndex: 20,
          }}
        >
          <MenuItem
            icon={showCons ? <EyeOffIcon /> : <EyeIcon />}
            onClick={() => { onToggleCons(); setOpen(false); }}
          >
            {showCons ? 'Hide construction' : 'Show construction'}
          </MenuItem>
          <MenuItem
            icon={<ClearIcon />}
            danger={confirmClear}
            onClick={() => {
              const wasConfirming = confirmClear;
              onClear();
              // First tap arms the confirmation — keep the menu open so
              // the user can see the "Tap again" prompt. Second tap fires
              // the actual clear; dismiss the menu then.
              if (wasConfirming) setOpen(false);
            }}
          >
            {confirmClear ? 'Tap again to clear' : 'Clear canvas'}
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        gap: 10,
        padding: '8px 10px',
        border: 'none',
        background: 'transparent',
        borderRadius: 4,
        cursor: 'pointer',
        color: danger ? COLOR.danger : COLOR.text,
        fontSize: 13,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = COLOR.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </span>
      {children}
    </button>
  );
}

// Single button style used by the tool row + the kebab trigger.
// `shortcut` (optional, desktop-only) renders the key letter as a small
// corner glyph so users can learn the keybindings without hovering.
function Btn({ children, onClick, disabled, title, active, shortcut }) {
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
    position: 'relative',
  };
  const style = active ? { ...base, background: COLOR.active, color: COLOR.activeText } : base;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      onMouseEnter={(e) => {
        if (disabled || active) return;
        e.currentTarget.style.background = COLOR.hover;
      }}
      onMouseLeave={(e) => {
        if (disabled || active) return;
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
      {shortcut && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 3,
            bottom: 1,
            fontSize: 8,
            lineHeight: 1,
            fontWeight: 600,
            letterSpacing: 0.2,
            color: active ? COLOR.activeText : COLOR.textMuted,
            opacity: active ? 0.75 : 0.7,
            pointerEvents: 'none',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}
