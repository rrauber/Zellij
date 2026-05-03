// SVG-arc helpers for the math-CCW direction (sweep-flag=1 with our y-down coords).
// All inputs are angles in radians; "CCW" means ang1 → ang2 with increasing angle,
// wrapping past +π if needed.

// Build a complete SVG path string ("M sx sy A r r 0 large 1 ex ey") drawing the arc.
export function arcPathCCW(center, radius, ang1, ang2) {
  const sx = center.x + radius * Math.cos(ang1);
  const sy = center.y + radius * Math.sin(ang1);
  const ex = center.x + radius * Math.cos(ang2);
  const ey = center.y + radius * Math.sin(ang2);
  let delta = ang2 - ang1;
  while (delta < 0) delta += 2 * Math.PI;
  const largeArc = delta > Math.PI ? 1 : 0;
  return `M ${sx} ${sy} A ${radius} ${radius} 0 ${largeArc} 1 ${ex} ${ey}`;
}

// Midpoint angle on the CCW arc from ang1 to ang2 (handles wrap).
export function arcMidAngleCCW(ang1, ang2) {
  if (ang2 < ang1) return (ang1 + ang2 + 2 * Math.PI) / 2;
  return (ang1 + ang2) / 2;
}

// Convenience: the actual (x, y) point at the CCW arc midpoint.
export function arcMidPointCCW(center, radius, ang1, ang2) {
  const a = arcMidAngleCCW(ang1, ang2);
  return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
}
