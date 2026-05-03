// Apply a placed tile's flip → rotation → translation to a tile-local point.
import { add, rot } from '../geometry/vec.js';

export const transformPoint = (p, placedTile) => {
  let q = { x: p.x, y: p.y };
  if (placedTile.flipped) q = { x: -q.x, y: q.y };
  q = rot(q, placedTile.rotation);
  q = add(q, placedTile.position);
  return q;
};

// Translate every concrete point in a stroked-shape by (dx, dy). Used to
// convert world-space shapes into tile-local (subtract the tile's centroid).
export function translateShape(shape, dx, dy) {
  if (shape.type === 'line') {
    return {
      type: 'line',
      a: { x: shape.a.x + dx, y: shape.a.y + dy },
      b: { x: shape.b.x + dx, y: shape.b.y + dy },
    };
  }
  if (shape.type === 'arc' || shape.type === 'wholeCircle') {
    return { ...shape, center: { x: shape.center.x + dx, y: shape.center.y + dy } };
  }
  return shape;
}

// Apply a placed-tile transform to a stroked-shape (line / arc / wholeCircle).
// For arcs, flipping mirrors x which maps a local angle θ → π − θ and reverses
// CCW → CW. We swap (ang1, ang2) so the result still satisfies the CCW
// convention used everywhere else (ang1 → ang2 sweep counter-clockwise).
export function transformShape(shape, placedTile) {
  if (shape.type === 'line') {
    return {
      type: 'line',
      a: transformPoint(shape.a, placedTile),
      b: transformPoint(shape.b, placedTile),
    };
  }
  const center = transformPoint(shape.center, placedTile);
  const radius = shape.radius;
  if (shape.type === 'wholeCircle') return { type: 'wholeCircle', center, radius };
  // arc
  const r = placedTile.rotation;
  let ang1, ang2;
  if (placedTile.flipped) {
    ang1 = Math.PI - shape.ang2 + r;
    ang2 = Math.PI - shape.ang1 + r;
  } else {
    ang1 = shape.ang1 + r;
    ang2 = shape.ang2 + r;
  }
  return { type: 'arc', center, radius, ang1, ang2 };
}

// Convert a tile's edge (topology, indexed into vertices) into the same
// stroked-shape format used for inks, so a flattened tile's boundary can be
// added to the new tile's `inks` list.
//
// Arc edges store (fromAngle, toAngle, sweepCCW). Our stroked-shape arcs
// always sweep CCW from ang1 to ang2 — so when sweepCCW is false we swap
// the angles to describe the same arc as a CCW path.
export function edgeToShape(edge, vertices) {
  if (edge.type === 'line') {
    return { type: 'line', a: vertices[edge.from], b: vertices[edge.to] };
  }
  if (edge.type === 'arc') {
    const ang1 = edge.sweepCCW !== false ? edge.fromAngle : edge.toAngle;
    const ang2 = edge.sweepCCW !== false ? edge.toAngle   : edge.fromAngle;
    return { type: 'arc', center: edge.center, radius: edge.radius, ang1, ang2 };
  }
  return null;
}
