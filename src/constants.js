// UI tap/snap thresholds (screen-pixel units)
export const SNAP_PX = 22;        // distance within which a snap target attracts the cursor
export const HANDLE_R = 14;       // visual radius of edit handles
export const HANDLE_HIT_PAD = 22; // extra hit area around a handle
export const TAP_PX = 16;         // hit tolerance for tapping a line/circle/segment

// Persistence
export const STORAGE_KEY = 'zellij-app-state-v1';

// Numerical
export const EPS = 1e-6;

// Rotation step grid for placed tiles. 18° = the natural step for 5/10/20-fold geometry.
export const ROTATION_STEPS_DEG = [9, 15, 18, 22.5, 30, 36, 45, 60, 72, 90];
export const DEFAULT_ROTATION_STEP_IDX = 2;

// Colour palette for the Fill tool. Loosely traditional zellij ground tones —
// cobalt, saffron gold, terracotta, emerald, cream, honey ochre, soot black —
// plus a leading null which acts as the eraser.
export const COLOR_PALETTE = [
  null,
  '#1B4965',
  '#C8B038',
  '#8B2E1A',
  '#3F6634',
  '#E8E1D1',
  '#9C8A6A',
  '#1B1B1B',
];
export const DEFAULT_COLOR = '#1B4965';
