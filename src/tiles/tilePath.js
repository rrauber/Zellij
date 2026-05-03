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
