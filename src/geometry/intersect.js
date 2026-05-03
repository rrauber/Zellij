// Pairwise intersection primitives between line segments and circles.
// All return concrete points (or null/[]); none mutate inputs.
import { EPS } from '../constants.js';
import { dist } from './vec.js';

export const segSegIntersect = (a1, a2, b1, b2) => {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < EPS) return null;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y), t, u };
};

export const segCircleIntersect = (p1, p2, center, radius) => {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const fx = p1.x - center.x, fy = p1.y - center.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const ts = [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  const out = [];
  for (const t of ts) {
    if (t >= -EPS && t <= 1 + EPS) {
      const x = p1.x + t * dx, y = p1.y + t * dy;
      out.push({ x, y, t, angle: Math.atan2(y - center.y, x - center.x) });
    }
  }
  return out;
};

export const circleCircleIntersect = (c1, c2) => {
  const D = dist(c1.center, c2.center);
  if (D > c1.radius + c2.radius + EPS || D < Math.abs(c1.radius - c2.radius) - EPS || D < EPS) return [];
  const a = (c1.radius * c1.radius - c2.radius * c2.radius + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, c1.radius * c1.radius - a * a));
  const dx = (c2.center.x - c1.center.x) / D;
  const dy = (c2.center.y - c1.center.y) / D;
  const px = c1.center.x + a * dx;
  const py = c1.center.y + a * dy;
  if (h < EPS) return [{ x: px, y: py }];
  return [
    { x: px + h * dy, y: py - h * dx },
    { x: px - h * dy, y: py + h * dx },
  ];
};
