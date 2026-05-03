// Visual tokens. Centralised so future rebrands touch one file.
//
// The design splits cleanly into two palettes:
//
//   - Chrome (toolbar, status bar, inventory): neutral light theme with one
//     accent. Stays out of the way and signals "tool surface, not artwork".
//
//   - Canvas (background, tile silhouettes, inks, construction): preserved
//     from the original paper-metaphor scheme. The warm canvas + tinted tile
//     overlay reads as physical and contrasts nicely with the cool chrome.

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, system-ui, sans-serif';

export const COLOR = {
  // ---- Chrome ----
  surface:       '#FAFAFA',  // toolbar / inventory drawer background
  surfaceAlt:    '#F5F5F4',  // status bar
  border:        '#E7E5E4',  // separators
  borderStrong:  '#D6D3D1',  // active button outline
  text:          '#1C1917',  // near-black primary text
  textMuted:     '#57534E',  // secondary text / placeholder
  hover:         '#F0EFEC',  // button hover background
  active:        '#1C1917',  // active button fill (filled dark)
  activeText:    '#FAFAFA',  // active button glyph

  // ---- Accents ----
  accent:        '#C58A3A',  // saffron — drafts, selection, polygon previews
  accentSoft:    '#E8C58A',  // disabled/secondary accent
  danger:        '#DC2626',  // clear / delete (cleaner red than burgundy)

  // ---- Canvas (artwork side, preserved) ----
  canvas:        '#F1E9D6',
  tileFill:      'rgba(225,200,150,0.25)',
  ink:           '#1B1B1B',
  construction:  '#9C8A6A',
};
