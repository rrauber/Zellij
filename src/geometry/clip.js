// Clip lines / arcs / whole circles against a polygon, keeping the pieces
// whose midpoints lie inside the polygon. Used when capturing a polygon as
// a tile so inks and construction don't extend past the new tile's boundary.
//
// "polyEdges" is a list of stroked-shape boundary edges:
//   { type: 'line', a, b }  |  { type: 'arc', center, radius, ang1, ang2 }
// "polyVerts" is the polygon's vertex list (used for the inside test; arc
// edges are approximated as their chord, same as everywhere else).

import { EPS } from '../constants.js';
import { angBetween } from './vec.js';
import { segSegIntersect, segCircleIntersect, circleCircleIntersect } from './intersect.js';
import { isAngleBetween, pointInPoly } from './project.js';

// ---- LINE SEGMENTS ----

// Find where line segment a→b crosses the polygon boundary. Returns
// {t, x, y} entries strictly between the endpoints, sorted by t.
function findLineBreaks(a, b, polyEdges) {
  const breaks = [];
  for (const edge of polyEdges) {
    if (edge.type === 'line') {
      const r = segSegIntersect(a, b, edge.a, edge.b);
      if (r && r.t > EPS && r.t < 1 - EPS) breaks.push({ t: r.t, x: r.x, y: r.y });
    } else if (edge.type === 'arc') {
      const ints = segCircleIntersect(a, b, edge.center, edge.radius);
      for (const p of ints) {
        if (p.t > EPS && p.t < 1 - EPS && isAngleBetween(p.angle, edge.ang1, edge.ang2)) {
          breaks.push({ t: p.t, x: p.x, y: p.y });
        }
      }
    }
  }
  breaks.sort((p, q) => p.t - q.t);
  return breaks;
}

// Returns a list of {a, b} sub-segments of a→b that lie inside the polygon.
export function clipLineByPolygon(a, b, polyVerts, polyEdges) {
  const breaks = findLineBreaks(a, b, polyEdges);
  const points = [{ t: 0, x: a.x, y: a.y }, ...breaks, { t: 1, x: b.x, y: b.y }];
  const pieces = [];
  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i], B = points[i + 1];
    if (B.t - A.t < EPS) continue;
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    if (pointInPoly(mid, polyVerts)) {
      pieces.push({ a: { x: A.x, y: A.y }, b: { x: B.x, y: B.y } });
    }
  }
  return pieces;
}

// ---- CCW ARCS ----

// Map an absolute angle to a 0..1 parameter along the CCW arc from ang1 to ang2.
// Returns null if the angle isn't on the arc.
function angToT(ang, ang1, span) {
  let d = ang - ang1;
  while (d < 0) d += 2 * Math.PI;
  if (d > span + EPS) return null;
  return d / span;
}

function findArcBreaks(center, radius, ang1, ang2, polyEdges) {
  let span = ang2 - ang1;
  while (span < 0) span += 2 * Math.PI;
  const breaks = [];
  for (const edge of polyEdges) {
    if (edge.type === 'line') {
      const ints = segCircleIntersect(edge.a, edge.b, center, radius);
      for (const p of ints) {
        const t = angToT(p.angle, ang1, span);
        if (t !== null && t > EPS && t < 1 - EPS) {
          breaks.push({ t, ang: p.angle, x: p.x, y: p.y });
        }
      }
    } else if (edge.type === 'arc') {
      const ints = circleCircleIntersect(
        { center, radius },
        { center: edge.center, radius: edge.radius },
      );
      for (const p of ints) {
        const polyAng = angBetween(edge.center, p);
        if (!isAngleBetween(polyAng, edge.ang1, edge.ang2)) continue;
        const ourAng = angBetween(center, p);
        const t = angToT(ourAng, ang1, span);
        if (t !== null && t > EPS && t < 1 - EPS) {
          breaks.push({ t, ang: ourAng, x: p.x, y: p.y });
        }
      }
    }
  }
  breaks.sort((p, q) => p.t - q.t);
  return breaks;
}

// Returns a list of {ang1, ang2} sub-arcs (each on the original CCW arc) that
// lie inside the polygon. Endpoints in radians.
export function clipArcByPolygon(center, radius, ang1, ang2, polyVerts, polyEdges) {
  const breaks = findArcBreaks(center, radius, ang1, ang2, polyEdges);
  const startX = center.x + radius * Math.cos(ang1);
  const startY = center.y + radius * Math.sin(ang1);
  const endX   = center.x + radius * Math.cos(ang2);
  const endY   = center.y + radius * Math.sin(ang2);
  const points = [
    { t: 0, ang: ang1, x: startX, y: startY },
    ...breaks,
    { t: 1, ang: ang2, x: endX, y: endY },
  ];
  const pieces = [];
  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i], B = points[i + 1];
    if (B.t - A.t < EPS) continue;
    let midAng = (A.ang + B.ang) / 2;
    if (B.ang < A.ang) midAng = (A.ang + B.ang + 2 * Math.PI) / 2;
    const mid = { x: center.x + radius * Math.cos(midAng), y: center.y + radius * Math.sin(midAng) };
    if (pointInPoly(mid, polyVerts)) pieces.push({ ang1: A.ang, ang2: B.ang });
  }
  return pieces;
}

// ---- WHOLE CIRCLES ----

// Splits the circle at every polygon-boundary intersection, keeps pieces
// inside the polygon. Returns pieces as { type: 'wholeCircle' } if the circle
// is entirely inside, otherwise an array of { type: 'arc', ang1, ang2 }.
// (No piece if the circle is entirely outside.)
export function clipWholeCircleByPolygon(center, radius, polyVerts, polyEdges) {
  const hits = [];
  for (const edge of polyEdges) {
    if (edge.type === 'line') {
      const ints = segCircleIntersect(edge.a, edge.b, center, radius);
      for (const p of ints) hits.push(p.angle);
    } else if (edge.type === 'arc') {
      const ints = circleCircleIntersect(
        { center, radius },
        { center: edge.center, radius: edge.radius },
      );
      for (const p of ints) {
        const polyAng = angBetween(edge.center, p);
        if (!isAngleBetween(polyAng, edge.ang1, edge.ang2)) continue;
        hits.push(angBetween(center, p));
      }
    }
  }
  if (hits.length === 0) {
    // No polygon edge crosses the circle — three possibilities:
    //   (a) circle fully inside polygon: keep whole.
    //   (b) circle fully outside polygon: discard.
    //   (c) polygon fully inside circle (small polygon, big circle):
    //       circle's center is inside the polygon, but the circle's body
    //       extends way past it — must discard, otherwise we end up
    //       stamping a giant disk of construction that bleeds out.
    // To distinguish (a) from (c), test a point on the circle's boundary.
    if (!pointInPoly(center, polyVerts)) return [];
    const sample = { x: center.x + radius, y: center.y };
    return pointInPoly(sample, polyVerts) ? [{ type: 'wholeCircle' }] : [];
  }
  hits.sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < hits.length; i++) {
    const a = hits[i], b = hits[(i + 1) % hits.length];
    let mid = (a + b) / 2;
    if (b < a) mid = (a + b + 2 * Math.PI) / 2;
    const midPt = { x: center.x + radius * Math.cos(mid), y: center.y + radius * Math.sin(mid) };
    if (pointInPoly(midPt, polyVerts)) pieces.push({ type: 'arc', ang1: a, ang2: b });
  }
  return pieces;
}
