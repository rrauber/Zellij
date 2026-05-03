// Apply a placed tile's flip → rotation → translation to a tile-local point.
import { add, rot } from '../geometry/vec.js';

export const transformPoint = (p, placedTile) => {
  let q = { x: p.x, y: p.y };
  if (placedTile.flipped) q = { x: -q.x, y: q.y };
  q = rot(q, placedTile.rotation);
  q = add(q, placedTile.position);
  return q;
};
