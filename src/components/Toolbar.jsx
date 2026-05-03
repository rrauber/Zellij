import React from 'react';

const TOOLS = [
  { id: 'line',    label: 'Line',    icon: '/' },
  { id: 'circle',  label: 'Circle',  icon: '○' },
  { id: 'ink',     label: 'Ink',     icon: '✎' },
  { id: 'polygon', label: 'Polygon', icon: '◇' },
  { id: 'select',  label: 'Select',  icon: '⇲' },
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
    <div className="border-b" style={{ background: '#E5DAC0', borderColor: '#C9B98F' }}>
      <div className="flex items-center px-2 py-1.5 gap-1 flex-wrap">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelectTool(t.id)}
            className="rounded transition-colors flex items-center justify-center"
            title={t.label}
            style={{
              background: tool === t.id ? '#3A2E1F' : 'transparent',
              color: tool === t.id ? '#F1E9D6' : '#3A2E1F',
              border: '1px solid #3A2E1F',
              width: 36,
              height: 36,
              fontSize: 16,
              lineHeight: 1,
              fontWeight: tool === t.id ? 600 : 400,
              flexShrink: 0,
            }}
          >
            {t.icon}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <IconBtn onClick={onUndo} disabled={!canUndo} title="Undo">↶</IconBtn>
        <IconBtn onClick={onRedo} disabled={!canRedo} title="Redo">↷</IconBtn>
        <IconBtn
          onClick={onToggleCons}
          title={showCons ? 'Hide construction' : 'Show construction'}
          style={{
            background: showCons ? 'transparent' : '#3A2E1F',
            color: showCons ? '#3A2E1F' : '#F1E9D6',
            fontSize: 11,
          }}
        >
          {showCons ? '◫' : '▢'}
        </IconBtn>
        <IconBtn onClick={onRecenter} title="Recenter">⊕</IconBtn>
        <button
          onClick={onClear}
          title="Clear canvas"
          className="rounded flex items-center justify-center"
          style={{
            border: '1px solid #8B2E1A',
            color: confirmClear ? '#F1E9D6' : '#8B2E1A',
            background: confirmClear ? '#8B2E1A' : 'transparent',
            padding: confirmClear ? '0 6px' : 0,
            width: confirmClear ? 'auto' : 30,
            height: 30,
            fontSize: confirmClear ? 10 : 13,
            flexShrink: 0,
          }}
        >
          {confirmClear ? 'tap again' : '✕'}
        </button>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, disabled, title, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded flex items-center justify-center"
      style={{
        border: '1px solid #3A2E1F',
        color: '#3A2E1F',
        opacity: disabled ? 0.3 : 1,
        width: 30,
        height: 30,
        fontSize: 13,
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
