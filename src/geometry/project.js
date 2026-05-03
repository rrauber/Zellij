// Closest-point projections used for hit testing and 1D snaps.
import { EPS } from '../constants.js';
import { dist } from './vec.js';

// Project p onto segment ab, clamped to the segment. Returns the projected
// point with `t` (0..1) and `dist` (perpendicular distance from p).
export const projOnSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { x: a.x, y: a.y, t: 0, dist: dist(p, a) };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const tc = Math.max(0, Math.min(1, t));
  const x = a.x + tc * dx, y = a.y + tc * dy;
  return { x, y, t: tc, dist: Math.hypot(p.x - x, p.y - y) };
};

// Project p onto the circumference of (center, radius). `dist` is the
// |radial-distance|, `angle` is the polar angle of the projected point.
export const projOnCircle = (p, center, radius) => {
  const dx = p.x - center.x, dy = p.y - center.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS) return { x: center.x + radius, y: center.y, dist: radius };
  const x = center.x + dx / d * radius;
  const y = center.y + dy / d * radius;
  return { x, y, dist: Math.abs(d - radius), angle: Math.atan2(dy, dx) };
};

// Whether angle a falls within the CCW arc from a1 to a2 (with wrap).
export const isAngleBetween = (a, a1, a2) => {
  if (a2 >= a1) return a >= a1 - EPS && a <= a2 + EPS;
  // Wrap arc: a1 is just below π, a2 is just above -π.
  return a >= a1 - EPS || a <= a2 + EPS;
};

// Even-odd ray cast for 2D point-in-polygon. Treats arc edges as their chords.
export const pointInPoly = (p, verts) => {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const vi = verts[i], vj = verts[j];
    if (
      ((vi.y > p.y) !== (vj.y > p.y)) &&
      (p.x < (vj.x - vi.x) * (p.y - vi.y) / (vj.y - vi.y) + vi.x)
    ) {
      inside = !inside;
    }
  }
  return inside;
};
