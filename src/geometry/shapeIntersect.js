// Pairwise intersection of stroked shapes (line / arc / wholeCircle), in
// world coords. Each input is a stroked-shape POJO:
//   { type: 'line',        a, b }
//   { type: 'arc',         center, radius, ang1, ang2 }   // CCW from ang1 → ang2
//   { type: 'wholeCircle', center, radius }
//
// Returns an array of {x, y} world-space intersection points (deduped is the
// caller's job — usually fine since the snap-marker layer dedupes by
// proximity anyway).

import { angBetween } from './vec.js';
import { isAngleBetween } from './project.js';
import { segSegIntersect, segCircleIntersect, circleCircleIntersect } from './intersect.js';

export function intersectShapes(s1, s2) {
  // Order-normalise so the dispatch below only handles each pair once.
  const order = ['line', 'arc', 'wholeCircle'];
  if (order.indexOf(s1.type) > order.indexOf(s2.type)) [s1, s2] = [s2, s1];
  const key = `${s1.type}-${s2.type}`;
  switch (key) {
    case 'line-line': {
      const r = segSegIntersect(s1.a, s1.b, s2.a, s2.b);
      return r ? [{ x: r.x, y: r.y }] : [];
    }
    case 'line-arc': {
      const ints = segCircleIntersect(s1.a, s1.b, s2.center, s2.radius);
      return ints
        .filter((p) => isAngleBetween(p.angle, s2.ang1, s2.ang2))
        .map((p) => ({ x: p.x, y: p.y }));
    }
    case 'line-wholeCircle': {
      const ints = segCircleIntersect(s1.a, s1.b, s2.center, s2.radius);
      return ints.map((p) => ({ x: p.x, y: p.y }));
    }
    case 'arc-arc': {
      const ints = circleCircleIntersect(
        { center: s1.center, radius: s1.radius },
        { center: s2.center, radius: s2.radius },
      );
      return ints.filter(
        (p) => isAngleBetween(angBetween(s1.center, p), s1.ang1, s1.ang2)
            && isAngleBetween(angBetween(s2.center, p), s2.ang1, s2.ang2),
      );
    }
    case 'arc-wholeCircle': {
      const ints = circleCircleIntersect(
        { center: s1.center, radius: s1.radius },
        { center: s2.center, radius: s2.radius },
      );
      return ints.filter((p) => isAngleBetween(angBetween(s1.center, p), s1.ang1, s1.ang2));
    }
    case 'wholeCircle-wholeCircle': {
      return circleCircleIntersect(
        { center: s1.center, radius: s1.radius },
        { center: s2.center, radius: s2.radius },
      );
    }
    default:
      return [];
  }
}
