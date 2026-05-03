// Tolerance-based equality for stroked shapes (line / arc / wholeCircle).
// Used to find the boundary ink that matches a given edge: if such an ink
// exists, the edge is "inked" (rendered bold); otherwise the edge is rendered
// faintly so the tile's outline is still visible.
//
// Boundary inks are produced from edgeToShape(edge, vertices), which uses the
// same coordinates the edge stores, so matches are normally exact. The
// tolerance is just there so a tiny drift from a future round-trip
// (transform → local → save → load) doesn't break recognition.

import { dist } from './vec.js';

// Position tolerance is a touch generous (matches the pidForPoint bucket size)
// because adjacent placed tiles' shared edges, once transformed through their
// per-placement flip/rotate/translate, can drift by a small amount that's
// still semantically the same edge. False positives at this scale would
// require two unrelated edges to coincide within 0.01 world units in both
// endpoints — extremely unlikely for hand-drawn zellij geometry.
const POS_TOL = 0.01;
const ANG_TOL = 1e-4;

export function shapesEqual(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'line') {
    const ab = dist(a.a, b.a) < POS_TOL && dist(a.b, b.b) < POS_TOL;
    const ba = dist(a.a, b.b) < POS_TOL && dist(a.b, b.a) < POS_TOL;
    return ab || ba;
  }
  if (a.type === 'arc') {
    if (dist(a.center, b.center) >= POS_TOL) return false;
    if (Math.abs(a.radius - b.radius) >= POS_TOL) return false;
    return Math.abs(a.ang1 - b.ang1) < ANG_TOL && Math.abs(a.ang2 - b.ang2) < ANG_TOL;
  }
  if (a.type === 'wholeCircle') {
    return dist(a.center, b.center) < POS_TOL && Math.abs(a.radius - b.radius) < POS_TOL;
  }
  return false;
}
