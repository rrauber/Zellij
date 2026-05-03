import { transformPoint, transformShape, edgeToShape } from './transform.js';

// Build the SVG `d` attribute for a tile, walking its vertices and edges.
// Edges are either straight ("line") or arc segments; arcs carry their own
// center/radius and a sweep direction.
export function tilePathD(tile) {
  if (!tile.vertices || tile.vertices.length === 0) return '';
  let d = `M ${tile.vertices[0].x} ${tile.vertices[0].y}`;
  for (let i = 0; i < tile.edges.length; i++) {
    const e = tile.edges[i];
    const target = tile.vertices[e.to];
    if (e.type === 'line') {
      d += ` L ${target.x} ${target.y}`;
    } else if (e.type === 'arc') {
      // sweepCCW indicates whether to traverse the arc in the math-CCW direction
      // (ang1 → ang2 increasing). With y-down SVG coords, math-CCW corresponds to
      // SVG sweep-flag=1.
      let delta = e.toAngle - e.fromAngle;
      while (delta < -Math.PI * 2 + 1e-9) delta += 2 * Math.PI;
      while (delta > Math.PI * 2 - 1e-9) delta -= 2 * Math.PI;
      let largeArc, sweepFlag;
      if (e.sweepCCW !== false) {
        let d2 = delta; while (d2 < 0) d2 += 2 * Math.PI;
        largeArc = d2 > Math.PI ? 1 : 0;
        sweepFlag = 1;
      } else {
        let d2 = -delta; while (d2 < 0) d2 += 2 * Math.PI;
        largeArc = d2 > Math.PI ? 1 : 0;
        sweepFlag = 0;
      }
      d += ` A ${e.radius} ${e.radius} 0 ${largeArc} ${sweepFlag} ${target.x} ${target.y}`;
    }
  }
  d += ' Z';
  return d;
}

// Like tilePathD, but emits the tile in WORLD coords given a placed-tile
// transform. Used to combine many tile silhouettes into a single SVG path
// — the union renders without internal antialiasing seams that would
// otherwise show through anything painted on top (e.g. colour fills).
//
// Arcs flip orientation when placedTile.flipped is true, so the SVG sweep
// flag is `sweepCCW XOR flipped`. The resulting path is closed.
export function tilePathDWorld(tile, placedTile) {
  if (!tile.vertices || tile.vertices.length === 0) return '';
  const v0 = transformPoint(tile.vertices[0], placedTile);
  let d = `M ${v0.x} ${v0.y}`;
  for (const e of tile.edges) {
    const target = transformPoint(tile.vertices[e.to], placedTile);
    if (e.type === 'line') {
      d += ` L ${target.x} ${target.y}`;
    } else if (e.type === 'arc') {
      const worldArc = transformShape(edgeToShape(e, tile.vertices), placedTile);
      const sweepFlag = ((e.sweepCCW !== false) !== !!placedTile.flipped) ? 1 : 0;
      let span = worldArc.ang2 - worldArc.ang1;
      while (span < 0) span += 2 * Math.PI;
      const largeArc = span > Math.PI ? 1 : 0;
      d += ` A ${worldArc.radius} ${worldArc.radius} 0 ${largeArc} ${sweepFlag} ${target.x} ${target.y}`;
    }
  }
  d += ' Z';
  return d;
}
