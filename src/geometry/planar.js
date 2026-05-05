// Planar face traversal over a set of stroked shapes (lines + arcs).
// Whole-circle inks aren't included in face detection — they're degenerate
// closed loops that need separate cyclic-edge handling.
//
// The algorithm is standard half-edge:
//   1. Pairwise-intersect every input stroke; collect break parameters.
//   2. Split each stroke at its breaks → atomic "pieces" (lines or sub-arcs).
//   3. Each piece becomes two twinned half-edges (one in each direction).
//   4. At every vertex, sort outgoing half-edges by their tangent angle CCW.
//   5. next(h) = predecessor of h.twin in that CCW order at h.to.
//   6. Walk next pointers to recover face cycles.
//   7. Keep cycles whose signed area is positive — those bound a region.

import { EPS } from '../constants.js';
import { angBetween } from './vec.js';
import { intersectShapes } from './shapeIntersect.js';
import { pidForPoint } from './intersections.js';
import { pointInPoly } from './project.js';
import { GridIndex, aabbForShape, chooseCellSize } from './spatial.js';

// ---- Stroke parameterisation ----

// Map a point known to lie on `stroke` to its 0..1 parameter along the
// stroke's natural direction (a→b for lines, ang1→ang2 CCW for arcs).
function paramOnStroke(stroke, p) {
  if (stroke.type === 'line') {
    const dx = stroke.b.x - stroke.a.x, dy = stroke.b.y - stroke.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return 0;
    return ((p.x - stroke.a.x) * dx + (p.y - stroke.a.y) * dy) / len2;
  }
  if (stroke.type === 'arc') {
    const ang = angBetween(stroke.center, p);
    let span = stroke.ang2 - stroke.ang1;
    while (span < 0) span += 2 * Math.PI;
    let d = ang - stroke.ang1;
    while (d < 0) d += 2 * Math.PI;
    return span < EPS ? 0 : d / span;
  }
  return 0;
}

function strokeStart(stroke) {
  if (stroke.type === 'line') return { x: stroke.a.x, y: stroke.a.y };
  return {
    x: stroke.center.x + stroke.radius * Math.cos(stroke.ang1),
    y: stroke.center.y + stroke.radius * Math.sin(stroke.ang1),
  };
}

function strokeEnd(stroke) {
  if (stroke.type === 'line') return { x: stroke.b.x, y: stroke.b.y };
  return {
    x: stroke.center.x + stroke.radius * Math.cos(stroke.ang2),
    y: stroke.center.y + stroke.radius * Math.sin(stroke.ang2),
  };
}

// ---- Build the graph and find faces ----

// `pairCache` (optional) memoises pairwise intersections across rebuilds:
// when an ink is added or removed, only pairs touching the new ink need
// fresh computation. Keyed by `${shapeIdA}|${shapeIdB}` (sorted), value is
// an array of {x, y} world points. The cache is mutated in-place; the
// caller is responsible for resetting it when a shape's geometry changes
// (we look up by shapeId, so changing a shape under a stable id without
// invalidating the cache would yield stale results).
export function buildFaces(strokes, pairCache = null) {
  // Whole circles ignored for now; they need cyclic-edge handling.
  const inputs = strokes.filter((s) => s && (s.type === 'line' || s.type === 'arc'));
  if (inputs.length === 0) return { faces: [], vertices: new Map() };

  // 1. Pairwise intersections → break parameters per input stroke.
  // Spatial-grid prefilter cuts the O(N²) pair sweep to ~O(N + K) where K is
  // the number of AABB-overlapping pairs. AABB test is then a final guard
  // before paying for the exact intersection.
  const aabbs = inputs.map(aabbForShape);
  const grid = new GridIndex(chooseCellSize(aabbs));
  for (let i = 0; i < inputs.length; i++) grid.insert(i, aabbs[i]);

  const breaks = inputs.map(() => []);
  const seenPair = new Set(); // dedupe symmetric query hits
  for (let i = 0; i < inputs.length; i++) {
    const candidates = grid.query(aabbs[i]);
    for (const j of candidates) {
      if (j <= i) continue; // each pair once
      const pairKey = `${i},${j}`;
      if (seenPair.has(pairKey)) continue;
      seenPair.add(pairKey);

      // Pair-intersection cache: keyed by stable shape ids if both inputs
      // carry one. Falls back to a fresh compute when ids are missing.
      const idA = inputs[i].shapeId;
      const idB = inputs[j].shapeId;
      let points;
      if (pairCache && idA && idB) {
        const cacheKey = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
        if (pairCache.has(cacheKey)) {
          points = pairCache.get(cacheKey);
        } else {
          points = intersectShapes(inputs[i], inputs[j]);
          pairCache.set(cacheKey, points);
        }
      } else {
        points = intersectShapes(inputs[i], inputs[j]);
      }

      for (const p of points) {
        breaks[i].push({ t: paramOnStroke(inputs[i], p), x: p.x, y: p.y });
        breaks[j].push({ t: paramOnStroke(inputs[j], p), x: p.x, y: p.y });
      }
    }
  }

  // 2. Split each stroke into atomic pieces.
  const pieces = [];
  for (let i = 0; i < inputs.length; i++) {
    const stroke = inputs[i];
    breaks[i].sort((a, b) => a.t - b.t);
    // Dedupe (same intersection point can appear twice if two crossings collide).
    const deduped = [];
    for (const b of breaks[i]) {
      if (deduped.length === 0 || Math.abs(b.t - deduped[deduped.length - 1].t) > EPS) {
        deduped.push(b);
      }
    }
    const start = strokeStart(stroke);
    const end = strokeEnd(stroke);
    const pts = [{ t: 0, x: start.x, y: start.y }, ...deduped, { t: 1, x: end.x, y: end.y }];
    for (let k = 0; k < pts.length - 1; k++) {
      const A = pts[k], B = pts[k + 1];
      if (B.t - A.t < EPS) continue;
      if (stroke.type === 'line') {
        pieces.push({ type: 'line', a: { x: A.x, y: A.y }, b: { x: B.x, y: B.y } });
      } else {
        const angA = angBetween(stroke.center, A);
        const angB = angBetween(stroke.center, B);
        pieces.push({
          type: 'arc',
          center: stroke.center,
          radius: stroke.radius,
          ang1: angA, ang2: angB,
        });
      }
    }
  }

  // 3. Vertices via position-based pid; tag each piece with pidA/pidB.
  const vertices = new Map();
  const placed = pieces.filter((piece) => {
    const ptA = strokeStart(piece);
    const ptB = strokeEnd(piece);
    const pidA = pidForPoint(ptA);
    const pidB = pidForPoint(ptB);
    if (pidA === pidB) return false; // degenerate
    if (!vertices.has(pidA)) vertices.set(pidA, ptA);
    if (!vertices.has(pidB)) vertices.set(pidB, ptB);
    piece.pidA = pidA;
    piece.pidB = pidB;
    return true;
  });

  // 4. Two twinned half-edges per piece.
  const halfEdges = [];
  for (const piece of placed) {
    const fwd = { piece, from: piece.pidA, to: piece.pidB, reverse: false };
    const rev = { piece, from: piece.pidB, to: piece.pidA, reverse: true };
    fwd.twin = rev; rev.twin = fwd;
    halfEdges.push(fwd, rev);
  }

  // 5. Sort outgoing half-edges at each vertex by tangent-angle CCW.
  const outBy = new Map();
  for (const he of halfEdges) {
    if (!outBy.has(he.from)) outBy.set(he.from, []);
    outBy.get(he.from).push(he);
  }
  for (const list of outBy.values()) {
    list.sort((a, b) => tangentAngle(a) - tangentAngle(b));
  }

  // 6. next(h) = predecessor of h.twin at h.to.
  for (const he of halfEdges) {
    const out = outBy.get(he.to);
    const twinIdx = out.indexOf(he.twin);
    const prevIdx = (twinIdx - 1 + out.length) % out.length;
    he.next = out[prevIdx];
  }

  // 7. Walk faces.
  const visited = new Set();
  const faces = [];
  for (const start of halfEdges) {
    if (visited.has(start)) continue;
    const face = [];
    let cur = start;
    let guard = 0;
    while (!visited.has(cur)) {
      visited.add(cur);
      face.push(cur);
      cur = cur.next;
      if (++guard > 100000) break; // pathological safety net
    }
    faces.push(face);
  }

  // Bounded faces have positive shoelace area (in screen y-down coords).
  const bounded = faces.filter((face) => signedArea(face, vertices) > 0);
  return { faces: bounded, vertices };
}

// ---- Tangent-angle helper ----
// Outgoing tangent at he.from (the angle of motion just leaving the vertex).
function tangentAngle(he) {
  const piece = he.piece;
  if (piece.type === 'line') {
    if (he.reverse) return Math.atan2(piece.a.y - piece.b.y, piece.a.x - piece.b.x);
    return Math.atan2(piece.b.y - piece.a.y, piece.b.x - piece.a.x);
  }
  // arc: tangent is perpendicular to the radial; CCW gives (-sin, cos), CW gives (sin, -cos).
  if (he.reverse) {
    return Math.atan2(-Math.cos(piece.ang2), Math.sin(piece.ang2));
  }
  return Math.atan2(Math.cos(piece.ang1), -Math.sin(piece.ang1));
}

// ---- Face geometry helpers ----

export function signedArea(face, vertices) {
  let sum = 0;
  for (const he of face) {
    const a = vertices.get(he.from);
    const b = vertices.get(he.to);
    sum += a.x * b.y - b.x * a.y;
  }
  return sum * 0.5;
}

// Approximate point-in-face: uses the chord polygon (each arc replaced by its
// chord). Faithful for typical zellij arcs which are short relative to the
// face they're part of.
export function faceContains(face, vertices, point) {
  const polyVerts = face.map((he) => vertices.get(he.from));
  return pointInPoly(point, polyVerts);
}

// SVG path string for a face boundary, honouring arc edges.
export function faceToPath(face, vertices) {
  let d = '';
  for (let i = 0; i < face.length; i++) {
    const he = face[i];
    const piece = he.piece;
    if (i === 0) {
      const start = vertices.get(he.from);
      d += `M ${start.x} ${start.y}`;
    }
    const end = vertices.get(he.to);
    if (piece.type === 'line') {
      d += ` L ${end.x} ${end.y}`;
    } else {
      // The piece's CCW direction is ang1 → ang2. Reverse traversals walk it
      // backwards (CW). SVG sweep-flag=1 corresponds to CCW with our y-down
      // coords, so reverse traversals use sweep-flag=0.
      const startAng = he.reverse ? piece.ang2 : piece.ang1;
      const endAng   = he.reverse ? piece.ang1 : piece.ang2;
      let delta = endAng - startAng;
      if (he.reverse) {
        while (delta > 0) delta -= 2 * Math.PI;
      } else {
        while (delta < 0) delta += 2 * Math.PI;
      }
      const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
      const sweepFlag = he.reverse ? 0 : 1;
      d += ` A ${piece.radius} ${piece.radius} 0 ${largeArc} ${sweepFlag} ${end.x} ${end.y}`;
    }
  }
  d += ' Z';
  return d;
}
