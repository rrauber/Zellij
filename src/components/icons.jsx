import React from 'react';

// SVG icon set used in the toolbar / status bar. Stroke uses currentColor so
// the parent can swap colours via CSS (active = light icon, default = dark).
//
// Conventions: 24×24 viewBox, stroke 2, round joins, no fill unless noted.

const I = ({ children, fill = 'none' }) => (
  <svg
    viewBox="0 0 24 24"
    width="20" height="20"
    fill={fill}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >{children}</svg>
);

export const LineIcon    = () => <I><line x1="5" y1="19" x2="19" y2="5" /></I>;
export const CircleIcon  = () => <I><circle cx="12" cy="12" r="8" /></I>;

// Pencil with a clear tip. The diagonal body + perpendicular tip cap reads
// as "ink" without needing detail.
export const InkIcon = () => (
  <I>
    <path d="M14 4 L20 10 L9 21 L3 21 L3 15 Z" />
    <line x1="13" y1="5" x2="19" y2="11" />
  </I>
);

export const PolygonIcon = () => (
  <I>
    <polygon points="12,3 21,8.5 18,20 6,20 3,8.5" />
  </I>
);

// Filled bucket-ish drop. The fill style cues "this places colour".
export const FillIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 C12 3 5 12 5 16 a7 7 0 0 0 14 0 C19 12 12 3 12 3 Z" fill="currentColor" />
  </svg>
);

// Pointer arrow. Top-left tail with the classic notched right side.
export const SelectIcon = () => (
  <I>
    <path d="M5 3 L5 19 L9.5 15 L12.5 21 L15 20 L12 14 L19 14 Z" />
  </I>
);

export const UndoIcon = () => (
  <I>
    <polyline points="9 14 4 9 9 4" />
    <path d="M4 9 H14 a6 6 0 0 1 0 12 H10" />
  </I>
);

export const RedoIcon = () => (
  <I>
    <polyline points="15 14 20 9 15 4" />
    <path d="M20 9 H10 a6 6 0 0 0 0 12 H14" />
  </I>
);

// Eye / eye-off — visibility toggle for construction lines.
export const EyeIcon = () => (
  <I>
    <path d="M2 12 C5 6 8.5 5 12 5 C15.5 5 19 6 22 12 C19 18 15.5 19 12 19 C8.5 19 5 18 2 12 Z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);
export const EyeOffIcon = () => (
  <I>
    <path d="M3 3 L21 21" />
    <path d="M2 12 C5 6 8.5 5 12 5 C13.5 5 15 5.2 16.4 5.7" />
    <path d="M22 12 C20.5 15 19 16.7 17.4 17.7" />
    <path d="M9.5 9.5 a3 3 0 0 0 4 4" />
  </I>
);

// Crosshair / target — recenter.
export const CenterIcon = () => (
  <I>
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="2"  x2="12" y2="6"  />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="2"  y1="12" x2="6"  y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
  </I>
);

export const ClearIcon = () => (
  <I>
    <line x1="6"  y1="6"  x2="18" y2="18" />
    <line x1="18" y1="6"  x2="6"  y2="18" />
  </I>
);
