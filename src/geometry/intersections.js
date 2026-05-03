// Higher-level: given the full set of construction lines and circles, compute
// every pairwise intersection plus the per-line and per-circle "hit lists"
// used to slice them into sub-segments and arcs.
import { EPS } from '../constants.js';
import { dist, angBetween } from './vec.js';
import { segSegIntersect, segCircleIntersect, circleCircleIntersect } from './intersect.js';

// Position-based pid scheme. Two world points within ~PID_TOL/2 of the same
// bucket centre share a pid. The polygon connectivity check compares pids by
// equality, so this is what makes canvas intersections, free line endpoints,
// placed-tile vertices, and tile-edge endpoints all unify into one graph.
const PID_TOL = 0.01; // world units
export const pidForPoint = (p) => `p_${Math.round(p.x / PID_TOL)}_${Math.round(p.y / PID_TOL)}`;

// Per line: list of {x, y, t, kind, pid} sorted by t.
// Per circle: list of {x, y, angle, kind, pid} sorted by angle.
// `pid` is a stable ID for the canonical intersection point (or a synthetic
// per-endpoint string), allowing precision-independent equality.
export const computeIntersections = (lines, circles) => {
  const lineHits = {};
  const circleHits = {};
  const lineIds = Object.keys(lines);
  const circleIds = Object.keys(circles);

  for (const id of lineIds) {
    lineHits[id] = [
      { x: lines[id].p1.x, y: lines[id].p1.y, t: 0, kind: 'endpoint' },
      { x: lines[id].p2.x, y: lines[id].p2.y, t: 1, kind: 'endpoint' },
    ];
  }
  for (const id of circleIds) circleHits[id] = [];

  // line-line
  for (let i = 0; i < lineIds.length; i++) {
    for (let j = i + 1; j < lineIds.length; j++) {
      const A = lines[lineIds[i]], B = lines[lineIds[j]];
      const r = segSegIntersect(A.p1, A.p2, B.p1, B.p2);
      if (r) {
        lineHits[lineIds[i]].push({ x: r.x, y: r.y, t: r.t, kind: 'cross' });
        lineHits[lineIds[j]].push({ x: r.x, y: r.y, t: r.u, kind: 'cross' });
      }
    }
  }
  // line-circle
  for (const lid of lineIds) {
    for (const cid of circleIds) {
      const L = lines[lid], C = circles[cid];
      const ints = segCircleIntersect(L.p1, L.p2, C.center, C.radius);
      for (const p of ints) {
        lineHits[lid].push({ x: p.x, y: p.y, t: p.t, kind: 'cross' });
        circleHits[cid].push({ x: p.x, y: p.y, angle: p.angle, kind: 'cross' });
      }
    }
  }
  // circle-circle
  for (let i = 0; i < circleIds.length; i++) {
    for (let j = i + 1; j < circleIds.length; j++) {
      const A = circles[circleIds[i]], B = circles[circleIds[j]];
      const ints = circleCircleIntersect(A, B);
      for (const p of ints) {
        circleHits[circleIds[i]].push({ x: p.x, y: p.y, angle: angBetween(A.center, p), kind: 'cross' });
        circleHits[circleIds[j]].push({ x: p.x, y: p.y, angle: angBetween(B.center, p), kind: 'cross' });
      }
    }
  }
  for (const id in lineHits) lineHits[id].sort((a, b) => a.t - b.t);
  for (const id in circleHits) circleHits[id].sort((a, b) => a.angle - b.angle);

  // Build flat list of intersection-only points (no endpoint duplicates with cross).
  // Dedup tolerance must match canonTol below — otherwise we'd create distinct canonicals
  // for hits that canonicalize would have merged, causing pid mismatch.
  const POINT_DEDUP_TOL = EPS * 10000;
  const points = [];
  const seen = [];
  const addPoint = (p) => {
    for (const q of seen) if (dist(p, q) < POINT_DEDUP_TOL) return;
    seen.push(p);
    points.push(p);
  };
  for (const id in lineHits) for (const h of lineHits[id]) if (h.kind === 'cross') addPoint(h);
  for (const id in circleHits) for (const h of circleHits[id]) if (h.kind === 'cross') addPoint(h);

  // Canonicalize: when the same conceptual intersection is computed via different routes
  // (line-line vs line-circle vs circle-circle), the float results differ by tens of ULPs.
  // For deeply nested constructions, drift accumulates beyond simple ULP scale. Snap every
  // hit's (x, y) to the canonical intersection point's (x, y), AND assign a stable pid
  // (canonical-point ID) so downstream code can compare endpoints by ID instead of coord.
  const canonTol = EPS * 10000; // 1e-2 world units — generous to absorb FP drift
  const canonicalize = (hits) => {
    for (const h of hits) {
      for (let pi = 0; pi < points.length; pi++) {
        const p = points[pi];
        if (dist(h, p) < canonTol) {
          h.x = p.x;
          h.y = p.y;
          h.pid = pidForPoint(p);
          break;
        }
      }
    }
  };
  for (const id in lineHits) canonicalize(lineHits[id]);
  for (const id in circleHits) canonicalize(circleHits[id]);

  // Endpoint hits not coincident with any canonical intersection still get a
  // position-based pid so they unify with anything else at the same world point
  // (e.g. a placed-tile vertex sharing a line endpoint, or two free endpoints
  // at the same spot).
  for (const lid in lineHits) {
    for (const h of lineHits[lid]) {
      if (h.pid === undefined) h.pid = pidForPoint(h);
    }
  }
  for (const cid in circleHits) {
    for (const h of circleHits[cid]) {
      if (h.pid === undefined) h.pid = pidForPoint(h);
    }
  }

  return { lineHits, circleHits, intersections: points };
};

// Sub-segments along a line, between consecutive hits.
export const getLineSegments = (lineHits, lineId) => {
  const hits = lineHits[lineId];
  const segs = [];
  for (let i = 0; i < hits.length - 1; i++) {
    if (hits[i + 1].t - hits[i].t > EPS) {
      segs.push({
        a: { x: hits[i].x, y: hits[i].y },
        b: { x: hits[i + 1].x, y: hits[i + 1].y },
        lineId, t1: hits[i].t, t2: hits[i + 1].t,
        pidA: hits[i].pid, pidB: hits[i + 1].pid,
      });
    }
  }
  return segs;
};

// Arcs along a circle, wrapping back to the first hit.
// A circle with no intersections yields no arcs and is rendered as a whole-circle ink.
export const getCircleArcs = (circleHits, circleId, circle) => {
  const hits = circleHits[circleId];
  if (hits.length === 0) return [];
  const arcs = [];
  for (let i = 0; i < hits.length; i++) {
    const a1 = hits[i], a2 = hits[(i + 1) % hits.length];
    arcs.push({
      a: { x: a1.x, y: a1.y },
      b: { x: a2.x, y: a2.y },
      circleId, ang1: a1.angle, ang2: a2.angle,
      center: circle.center, radius: circle.radius,
      pidA: a1.pid, pidB: a2.pid,
    });
  }
  return arcs;
};
