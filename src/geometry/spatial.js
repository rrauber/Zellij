// Spatial index for stroked shapes — used to skip the O(N²) pairwise
// intersection step that dominated buildFaces and the tile-shape crossings.
//
// We use a uniform grid keyed by AABB cells. For zellij designs the shapes
// are small relative to the canvas extent, so the grid query degenerates
// gracefully toward the actual neighbour set without R-tree overhead.
//
// Arc AABBs are conservative (full circle's bbox) — slightly larger than
// tight, but cheap and still cuts the bulk of non-overlapping pairs.

export function aabbForShape(shape) {
  if (shape.type === 'line') {
    return {
      minX: Math.min(shape.a.x, shape.b.x),
      minY: Math.min(shape.a.y, shape.b.y),
      maxX: Math.max(shape.a.x, shape.b.x),
      maxY: Math.max(shape.a.y, shape.b.y),
    };
  }
  if (shape.type === 'arc' || shape.type === 'wholeCircle') {
    return {
      minX: shape.center.x - shape.radius,
      minY: shape.center.y - shape.radius,
      maxX: shape.center.x + shape.radius,
      maxY: shape.center.y + shape.radius,
    };
  }
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

export function aabbForLine(p1, p2) {
  return {
    minX: Math.min(p1.x, p2.x),
    minY: Math.min(p1.y, p2.y),
    maxX: Math.max(p1.x, p2.x),
    maxY: Math.max(p1.y, p2.y),
  };
}

export function aabbForCircle(center, radius) {
  return {
    minX: center.x - radius,
    minY: center.y - radius,
    maxX: center.x + radius,
    maxY: center.y + radius,
  };
}

export function aabbsOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// Pick a cell size from a list of AABBs. Cell-size choice is the entire
// performance lever for the grid:
//   - too small → each shape occupies many cells, insert/query become O(area)
//     and a single big circle (radius hundreds in world-space) can cost
//     hundreds of thousands of cells to insert. Hangs the main thread.
//   - too large → all shapes land in a few cells, query candidate set
//     approaches N, and the grid degenerates toward O(N²).
//
// We use the average AABB diameter, floored so a degenerate empty/tiny
// input doesn't pin us to ~zero. This gives roughly a constant number of
// cells per shape regardless of whether the geometry is in tile-local
// (~1 unit) or canvas world (~hundreds of units) coordinates.
export function chooseCellSize(aabbs, floor = 1) {
  if (!aabbs || aabbs.length === 0) return floor;
  let total = 0;
  for (const a of aabbs) {
    total += Math.max(a.maxX - a.minX, a.maxY - a.minY);
  }
  return Math.max(total / aabbs.length, floor);
}

// Uniform-grid index. Construct with `chooseCellSize(aabbs)` rather than a
// hard-coded constant — the same code runs on tile-local geometry (~1 unit)
// and canvas world-space geometry (~hundreds of units), and a fixed cell
// size for one regime catastrophically thrashes the other.
export class GridIndex {
  constructor(cellSize = 1) {
    this.cellSize = cellSize;
    this.cells = new Map(); // "gx,gy" -> [{ id, aabb }]
  }

  _cellKey(gx, gy) { return `${gx},${gy}`; }

  _cellRange(aabb) {
    const cs = this.cellSize;
    return {
      gx1: Math.floor(aabb.minX / cs),
      gy1: Math.floor(aabb.minY / cs),
      gx2: Math.floor(aabb.maxX / cs),
      gy2: Math.floor(aabb.maxY / cs),
    };
  }

  insert(id, aabb) {
    const r = this._cellRange(aabb);
    for (let gx = r.gx1; gx <= r.gx2; gx++) {
      for (let gy = r.gy1; gy <= r.gy2; gy++) {
        const key = this._cellKey(gx, gy);
        let bucket = this.cells.get(key);
        if (!bucket) { bucket = []; this.cells.set(key, bucket); }
        bucket.push({ id, aabb });
      }
    }
  }

  // Returns ids whose AABB overlaps the query AABB. Caller dedupes.
  query(aabb) {
    const r = this._cellRange(aabb);
    const out = new Set();
    for (let gx = r.gx1; gx <= r.gx2; gx++) {
      for (let gy = r.gy1; gy <= r.gy2; gy++) {
        const bucket = this.cells.get(this._cellKey(gx, gy));
        if (!bucket) continue;
        for (const entry of bucket) {
          if (aabbsOverlap(entry.aabb, aabb)) out.add(entry.id);
        }
      }
    }
    return out;
  }
}
