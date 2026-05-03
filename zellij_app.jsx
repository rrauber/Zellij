import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

// ======================== CONSTANTS ========================
const SNAP_PX = 22;
const HANDLE_R = 14;
const HANDLE_HIT_PAD = 22;
const TAP_PX = 16;
const STORAGE_KEY = 'zellij-app-state-v1';
const EPS = 1e-6;

// ======================== GEOMETRY UTILITIES ========================
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const angBetween = (c, p) => Math.atan2(p.y - c.y, p.x - c.x);
const normAng = a => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };

// rotate point p around origin by angle a
const rot = (p, a) => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
});

const segSegIntersect = (a1, a2, b1, b2) => {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < EPS) return null;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y), t, u };
};

const segCircleIntersect = (p1, p2, center, radius) => {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const fx = p1.x - center.x, fy = p1.y - center.y;
  const A = dx*dx + dy*dy;
  const B = 2 * (fx*dx + fy*dy);
  const C = fx*fx + fy*fy - radius*radius;
  const disc = B*B - 4*A*C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const ts = [(-B - sq) / (2*A), (-B + sq) / (2*A)];
  const out = [];
  for (const t of ts) {
    if (t >= -EPS && t <= 1 + EPS) {
      const x = p1.x + t*dx, y = p1.y + t*dy;
      out.push({ x, y, t, angle: Math.atan2(y - center.y, x - center.x) });
    }
  }
  return out;
};

const circleCircleIntersect = (c1, c2) => {
  const D = dist(c1.center, c2.center);
  if (D > c1.radius + c2.radius + EPS || D < Math.abs(c1.radius - c2.radius) - EPS || D < EPS) return [];
  const a = (c1.radius*c1.radius - c2.radius*c2.radius + D*D) / (2*D);
  const h = Math.sqrt(Math.max(0, c1.radius*c1.radius - a*a));
  const dx = (c2.center.x - c1.center.x) / D;
  const dy = (c2.center.y - c1.center.y) / D;
  const px = c1.center.x + a*dx;
  const py = c1.center.y + a*dy;
  if (h < EPS) return [{ x: px, y: py }];
  return [
    { x: px + h*dy, y: py - h*dx },
    { x: px - h*dy, y: py + h*dx },
  ];
};

const projOnSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx*dx + dy*dy;
  if (len2 < EPS) return { x: a.x, y: a.y, t: 0, dist: dist(p, a) };
  let t = ((p.x - a.x)*dx + (p.y - a.y)*dy) / len2;
  const tc = Math.max(0, Math.min(1, t));
  const x = a.x + tc*dx, y = a.y + tc*dy;
  return { x, y, t: tc, dist: Math.hypot(p.x - x, p.y - y) };
};

const projOnCircle = (p, center, radius) => {
  const dx = p.x - center.x, dy = p.y - center.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS) return { x: center.x + radius, y: center.y, dist: radius };
  const x = center.x + dx/d * radius;
  const y = center.y + dy/d * radius;
  return { x, y, dist: Math.abs(d - radius), angle: Math.atan2(dy, dx) };
};

// ======================== INTERSECTION COMPUTATION ========================
// Per line: list of {x,y,t} sorted by t. Per circle: list of {x,y,angle} sorted by angle.
const computeIntersections = (lines, circles) => {
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
  // For deeply nested constructions (5-fold geometry, many circles), drift can accumulate
  // beyond simple ULP scale. Each per-line/per-circle hit list retains its own value, so
  // segments meeting at that intersection end up with non-matching endpoints. Snap every
  // hit's (x, y) to the canonical intersection point's (x, y), AND assign a stable pid
  // (canonical-point ID) so downstream code can compare endpoints by ID instead of coord.
  // pid-based comparison eliminates FP precision concerns for polygon connectivity.
  const canonTol = EPS * 10000; // 1e-2 world units — generous to absorb FP drift
  const canonicalize = (hits) => {
    for (const h of hits) {
      for (let pi = 0; pi < points.length; pi++) {
        const p = points[pi];
        if (dist(h, p) < canonTol) {
          h.x = p.x;
          h.y = p.y;
          h.pid = pi;
          break;
        }
      }
    }
  };
  for (const id in lineHits) canonicalize(lineHits[id]);
  for (const id in circleHits) canonicalize(circleHits[id]);

  // Assign synthetic pids to endpoint hits not coincident with any canonical intersection.
  // These are line endpoints "in free space" — they don't share with anything else, so
  // they get a unique signature based on (lineId, p1 vs p2). Stable across renders since
  // line IDs are stable.
  for (const lid in lineHits) {
    for (const h of lineHits[lid]) {
      if (h.pid === undefined && h.kind === 'endpoint') {
        h.pid = `ep_${lid}_${h.t < 0.5 ? 'p1' : 'p2'}`;
      }
    }
  }

  return { lineHits, circleHits, intersections: points };
};

// Get segments along a line as pairs of {a, b, lineId}
const getLineSegments = (lineHits, lineId) => {
  const hits = lineHits[lineId];
  const segs = [];
  for (let i = 0; i < hits.length - 1; i++) {
    if (hits[i+1].t - hits[i].t > EPS) {
      segs.push({
        a: { x: hits[i].x, y: hits[i].y },
        b: { x: hits[i+1].x, y: hits[i+1].y },
        lineId, t1: hits[i].t, t2: hits[i+1].t,
        pidA: hits[i].pid, pidB: hits[i+1].pid,
      });
    }
  }
  return segs;
};

// Get arcs along a circle
const getCircleArcs = (circleHits, circleId, circle) => {
  const hits = circleHits[circleId];
  if (hits.length === 0) return []; // a circle with no intersections has no "arc segments" — handled as whole-circle ink
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

// ======================== ID GENERATION ========================
let _idCounter = 1;
const newId = () => `id_${Date.now()}_${_idCounter++}`;

// ======================== APP ========================
export default function ZellijApp() {
  // Construction state
  const [lines, setLines] = useState({});
  const [circles, setCircles] = useState({});
  // Ink state: arrays of {type:'lineSeg', lineId, t1, t2} or {type:'arc', circleId, ang1, ang2} or {type:'wholeCircle', circleId}
  const [inks, setInks] = useState([]);
  // Tile inventory: array of {id, vertices: [{x,y}], edges: [{type, from, to, ...}], inks: [...]}
  const [tiles, setTiles] = useState([]);
  // Placed tiles: array of {id, tileId, position: {x,y}, rotation, flipped}
  const [placed, setPlaced] = useState([]);
  // Tool selection
  const [tool, setTool] = useState('line');
  // Current edit target: {kind: 'line'|'circle'|'placedTile', id}
  const [editing, setEditing] = useState(null);
  // Drawing in progress: {kind: 'line', p1} or {kind: 'circle', center}
  const [draft, setDraft] = useState(null);
  // Polygon-in-progress: array of {edgeRef, fromVertex, toVertex}
  const [polyDraft, setPolyDraft] = useState([]);
  // View state
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [showCons, setShowCons] = useState(true);
  // Snap indicator (current snap point being shown)
  const [snapIndicator, setSnapIndicator] = useState(null);
  // Undo/redo stacks (snapshots of {lines, circles, inks, tiles, placed})
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  // Bottom sheet open
  const [sheetOpen, setSheetOpen] = useState(false);
  // Tile being dragged from inventory (for placement)
  const [pendingPlace, setPendingPlace] = useState(null);
  // Rotation step for placed-tile rotation. Tap-cycles through symmetry-friendly increments.
  const ROTATION_STEPS_DEG = [9, 15, 18, 22.5, 30, 36, 45, 60, 72, 90];
  const [rotationStepIdx, setRotationStepIdx] = useState(2); // 18° default — works for 5/10/20-fold systems
  const rotationStepDeg = ROTATION_STEPS_DEG[rotationStepIdx];
  const rotationStepRad = rotationStepDeg * Math.PI / 180;
  const cycleRotationStep = () => setRotationStepIdx((rotationStepIdx + 1) % ROTATION_STEPS_DEG.length);

  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 2500);
    return () => clearTimeout(t);
  }, [confirmClear]);

  // When a polygon tap fails to connect, briefly mark the tapped segment so the user can see
  // exactly which segment was identified vs. where the polygon needs to connect.
  const [polyRejected, setPolyRejected] = useState(null);
  useEffect(() => {
    if (!polyRejected) return;
    const t = setTimeout(() => setPolyRejected(null), 1500);
    return () => clearTimeout(t);
  }, [polyRejected]);

  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const ptrState = useRef({ pointers: new Map(), action: null });
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });

  // Compute intersections (memoized)
  const { lineHits, circleHits, intersections } = useMemo(() => computeIntersections(lines, circles), [lines, circles]);

  // Resize
  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const [loaded, setLoaded] = useState(false);

  // Persistence: load (async via window.storage)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (window.storage?.get) {
          const result = await window.storage.get(STORAGE_KEY);
          if (!cancelled && result?.value) {
            const s = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
            if (s.lines) setLines(s.lines);
            if (s.circles) setCircles(s.circles);
            if (s.inks) setInks(s.inks);
            if (s.tiles) setTiles(s.tiles);
            if (s.placed) setPlaced(s.placed);
          }
        }
      } catch (e) { /* missing key or unavailable - fine */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persistence: save (debounced) — only after initial load completes
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      (async () => {
        try {
          if (window.storage?.set) {
            await window.storage.set(STORAGE_KEY, JSON.stringify({ lines, circles, inks, tiles, placed }));
          }
        } catch (e) { /* ignore */ }
      })();
    }, 400);
    return () => clearTimeout(t);
  }, [lines, circles, inks, tiles, placed, loaded]);

  // Undo/redo helpers
  const pushUndo = useCallback(() => {
    setUndoStack(s => [...s.slice(-50), { lines, circles, inks, tiles, placed }]);
    setRedoStack([]);
  }, [lines, circles, inks, tiles, placed]);

  const undo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, { lines, circles, inks, tiles, placed }]);
    setUndoStack(s => s.slice(0, -1));
    setLines(prev.lines); setCircles(prev.circles); setInks(prev.inks); setTiles(prev.tiles); setPlaced(prev.placed);
    setEditing(null); setDraft(null); setPolyDraft([]);
  };
  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(s => [...s, { lines, circles, inks, tiles, placed }]);
    setRedoStack(r => r.slice(0, -1));
    setLines(next.lines); setCircles(next.circles); setInks(next.inks); setTiles(next.tiles); setPlaced(next.placed);
    setEditing(null); setDraft(null); setPolyDraft([]);
  };

  // ======================== COORDINATE CONVERSIONS ========================
  const screenToWorld = useCallback((sx, sy) => ({
    x: (sx - view.tx) / view.scale,
    y: (sy - view.ty) / view.scale,
  }), [view]);
  const worldToScreen = useCallback((wx, wy) => ({
    x: wx * view.scale + view.tx,
    y: wy * view.scale + view.ty,
  }), [view]);

  // ======================== SNAP TARGETS ========================
  // Returns: {points: [{x,y, kind}], lines: [...lines for 1D snap], circles: [...]}
  const computeSnapTargets = useCallback(() => {
    const points = [];
    // intersections
    for (const p of intersections) points.push({ x: p.x, y: p.y, kind: 'intersection' });
    // line endpoints
    for (const id in lines) {
      points.push({ x: lines[id].p1.x, y: lines[id].p1.y, kind: 'endpoint' });
      points.push({ x: lines[id].p2.x, y: lines[id].p2.y, kind: 'endpoint' });
    }
    // circle centers and radius points
    for (const id in circles) {
      points.push({ x: circles[id].center.x, y: circles[id].center.y, kind: 'center' });
      const rPt = circles[id].radiusPt;
      if (rPt) points.push({ x: rPt.x, y: rPt.y, kind: 'radius-point' });
    }
    // placed tile vertices (tagged with placed-tile id so self-vertices can be excluded)
    for (const pt of placed) {
      const tile = tiles.find(t => t.id === pt.tileId);
      if (!tile) continue;
      for (const v of tile.vertices) {
        const w = transformPoint(v, pt);
        points.push({ x: w.x, y: w.y, kind: 'tile-vertex', placedId: pt.id });
      }
    }
    return {
      points,
      lines1D: Object.entries(lines).map(([id, l]) => ({ id, ...l })),
      circles1D: Object.entries(circles).map(([id, c]) => ({ id, ...c })),
    };
  }, [intersections, lines, circles, placed, tiles]);

  const transformPoint = (p, placedTile) => {
    let q = { x: p.x, y: p.y };
    if (placedTile.flipped) q = { x: -q.x, y: q.y };
    q = rot(q, placedTile.rotation);
    q = add(q, placedTile.position);
    return q;
  };

  // Find best snap for a world-coordinate point. Returns {x, y, kind} or original.
  const trySnap = useCallback((worldP, opts = {}) => {
    const radiusWorld = SNAP_PX / view.scale;
    const targets = computeSnapTargets();
    let best = null;
    // priority 1: points
    for (const t of targets.points) {
      const d = dist(worldP, t);
      if (d < radiusWorld && (!best || d < best.dist)) best = { x: t.x, y: t.y, dist: d, kind: t.kind };
    }
    if (best) return best;
    // priority 2: 1D snaps if allowed
    if (opts.allow1D !== false) {
      for (const l of targets.lines1D) {
        const proj = projOnSeg(worldP, l.p1, l.p2);
        if (proj.dist < radiusWorld && (!best || proj.dist < best.dist)) {
          best = { x: proj.x, y: proj.y, dist: proj.dist, kind: 'on-line', lineId: l.id };
        }
      }
      for (const c of targets.circles1D) {
        const proj = projOnCircle(worldP, c.center, c.radius);
        if (proj.dist < radiusWorld && (!best || proj.dist < best.dist)) {
          best = { x: proj.x, y: proj.y, dist: proj.dist, kind: 'on-circle', circleId: c.id };
        }
      }
    }
    return best || { x: worldP.x, y: worldP.y, kind: 'free' };
  }, [view, computeSnapTargets]);

  // ======================== POINTER HANDLING ========================
  // We support: tap, drag (single-pointer), pinch+pan (two pointers).
  const getEventPos = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e) => {
    e.target.setPointerCapture?.(e.pointerId);
    const pos = getEventPos(e);
    ptrState.current.pointers.set(e.pointerId, { ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: screenToWorld(pos.x, pos.y) });
    if (ptrState.current.pointers.size === 2) {
      // begin pinch
      const pts = [...ptrState.current.pointers.values()];
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      ptrState.current.action = { kind: 'pinch', startDist: d, startCenter: { x: cx, y: cy }, startView: { ...view } };
    }
  };

  const onPointerMove = (e) => {
    const ptr = ptrState.current.pointers.get(e.pointerId);
    if (!ptr) return;
    const pos = getEventPos(e);
    const dx = pos.x - ptr.startScreen.x, dy = pos.y - ptr.startScreen.y;
    if (Math.hypot(dx, dy) > 5) ptr.moved = true;
    ptr.x = pos.x; ptr.y = pos.y;

    if (ptrState.current.action?.kind === 'pinch' && ptrState.current.pointers.size === 2) {
      const pts = [...ptrState.current.pointers.values()];
      const newDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const newCx = (pts[0].x + pts[1].x) / 2;
      const newCy = (pts[0].y + pts[1].y) / 2;
      const a = ptrState.current.action;
      const k = newDist / a.startDist;
      const newScale = Math.max(0.001, a.startView.scale * k);
      // keep startCenter (in original world coords) anchored under newCx,newCy
      const worldCenter = { x: (a.startCenter.x - a.startView.tx) / a.startView.scale, y: (a.startCenter.y - a.startView.ty) / a.startView.scale };
      const tx = newCx - worldCenter.x * newScale;
      const ty = newCy - worldCenter.y * newScale;
      setView({ tx, ty, scale: newScale });
      return;
    }

    if (ptrState.current.action?.kind === 'pan') {
      const a = ptrState.current.action;
      setView(v => ({ ...v, tx: a.startView.tx + (pos.x - a.startScreen.x), ty: a.startView.ty + (pos.y - a.startScreen.y) }));
      return;
    }

    if (ptrState.current.action?.kind === 'dragHandle') {
      const a = ptrState.current.action;
      const w = screenToWorld(pos.x, pos.y);
      const snapped = a.handle.allowSnap !== false ? trySnap(w, a.handle.snapOpts) : { x: w.x, y: w.y, kind: 'free' };
      setSnapIndicator(snapped.kind !== 'free' ? snapped : null);
      a.handle.onMove(snapped, w);
      return;
    }

    if (ptrState.current.action?.kind === 'placeTile') {
      const w = screenToWorld(pos.x, pos.y);
      const snapped = trySnap(w, { allow1D: false });
      setSnapIndicator(snapped.kind !== 'free' ? snapped : null);
      ptrState.current.action.onMove(snapped, w);
      return;
    }
  };

  const onPointerUp = (e) => {
    const ptr = ptrState.current.pointers.get(e.pointerId);
    if (!ptr) return;
    const wasMoved = ptr.moved;
    const startWorld = ptr.startWorld;
    ptrState.current.pointers.delete(e.pointerId);
    if (ptrState.current.action?.kind === 'pinch' && ptrState.current.pointers.size < 2) ptrState.current.action = null;
    if (ptrState.current.action?.kind === 'pan' && ptrState.current.pointers.size === 0) ptrState.current.action = null;
    if (ptrState.current.action?.kind === 'dragHandle') {
      const a = ptrState.current.action;
      a.handle.onEnd?.();
      ptrState.current.action = null;
      setSnapIndicator(null);
      return;
    }
    if (ptrState.current.action?.kind === 'placeTile') {
      ptrState.current.action.onEnd?.();
      ptrState.current.action = null;
      setSnapIndicator(null);
      return;
    }
    if (!wasMoved) {
      // it's a tap
      handleTap(startWorld);
    }
  };

  // ======================== TAP HANDLING ========================
  const handleTap = (worldP) => {
    if (tool === 'line') {
      const snapped = trySnap(worldP);
      if (!draft) {
        if (editing) setEditing(null);
        setDraft({ kind: 'line', p1: { x: snapped.x, y: snapped.y } });
      } else if (draft.kind === 'line') {
        const p2 = { x: snapped.x, y: snapped.y };
        if (dist(draft.p1, p2) < 1 / view.scale) { setDraft(null); return; }
        pushUndo();
        const id = newId();
        setLines(L => ({ ...L, [id]: { p1: draft.p1, p2 } }));
        setDraft(null);
        setEditing({ kind: 'line', id });
      }
      return;
    }
    if (tool === 'circle') {
      const snapped = trySnap(worldP);
      if (!draft || draft.kind !== 'circle') {
        if (editing) setEditing(null);
        // First tap: first measurement reference point
        setDraft({ kind: 'circle', step: 'measureA', refA: { x: snapped.x, y: snapped.y } });
      } else if (draft.step === 'measureA') {
        // Second tap: second measurement reference; sets compass width
        const r = dist(draft.refA, snapped);
        if (r < 1 / view.scale) { setDraft(null); return; }
        setDraft({ kind: 'circle', step: 'placing', radius: r, refA: draft.refA, refB: { x: snapped.x, y: snapped.y } });
      } else if (draft.step === 'placing') {
        // Stamp a circle with the measured radius at the tapped center
        pushUndo();
        const id = newId();
        const radius = draft.radius;
        const center = { x: snapped.x, y: snapped.y };
        // Default radiusPt placed to the right of center; user can drag it later in select mode
        const radiusPt = { x: center.x + radius, y: center.y };
        setCircles(C => ({ ...C, [id]: { center, radius, radiusPt } }));
        // Stay in 'placing' state to stamp more circles with the same radius
      }
      return;
    }
    if (tool === 'select') {
      // Try to find what was tapped
      const hit = hitTestEditable(worldP);
      if (hit) setEditing(hit);
      else setEditing(null);
      return;
    }
    if (tool === 'ink') {
      handleInkTap(worldP);
      return;
    }
    if (tool === 'polygon') {
      handlePolygonTap(worldP);
      return;
    }
  };

  // Hit-test what's editable at world point
  const hitTestEditable = (w) => {
    const tolWorld = TAP_PX / view.scale;
    // placed tiles first (topmost)
    for (let i = placed.length - 1; i >= 0; i--) {
      if (pointInPlacedTile(w, placed[i])) return { kind: 'placedTile', id: placed[i].id };
    }
    // lines
    for (const id in lines) {
      const L = lines[id];
      const proj = projOnSeg(w, L.p1, L.p2);
      if (proj.dist < tolWorld) return { kind: 'line', id };
    }
    // circles
    for (const id in circles) {
      const C = circles[id];
      const proj = projOnCircle(w, C.center, C.radius);
      if (proj.dist < tolWorld) return { kind: 'circle', id };
    }
    return null;
  };

  const pointInPlacedTile = (w, pt) => {
    const tile = tiles.find(t => t.id === pt.tileId);
    if (!tile) return false;
    // transform point into tile-local coords
    let local = sub(w, pt.position);
    local = rot(local, -pt.rotation);
    if (pt.flipped) local = { x: -local.x, y: local.y };
    // ray cast (treats arc edges as their chords for simplicity)
    let inside = false;
    const verts = tile.vertices;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const vi = verts[i], vj = verts[j];
      if (((vi.y > local.y) !== (vj.y > local.y)) && (local.x < (vj.x - vi.x) * (local.y - vi.y) / (vj.y - vi.y) + vi.x)) inside = !inside;
    }
    return inside;
  };

  // Find which sub-segment of a line / arc of a circle is closest to a point
  const findSegmentAt = (w) => {
    const tolWorld = TAP_PX / view.scale;
    let best = null;
    for (const id in lines) {
      const segs = getLineSegments(lineHits, id);
      for (const seg of segs) {
        const p = projOnSeg(w, seg.a, seg.b);
        if (p.dist < tolWorld && (!best || p.dist < best.dist)) {
          best = { type: 'lineSeg', lineId: id, t1: seg.t1, t2: seg.t2, dist: p.dist, a: seg.a, b: seg.b, pidA: seg.pidA, pidB: seg.pidB };
        }
      }
    }
    for (const id in circles) {
      const C = circles[id];
      const arcs = getCircleArcs(circleHits, id, C);
      if (arcs.length === 0) {
        // whole circle (no intersections)
        const p = projOnCircle(w, C.center, C.radius);
        if (p.dist < tolWorld && (!best || p.dist < best.dist)) {
          best = { type: 'wholeCircle', circleId: id, dist: p.dist };
        }
      } else {
        for (const arc of arcs) {
          // we approximate arc distance using projOnCircle and then check arc range
          const p = projOnCircle(w, C.center, C.radius);
          if (p.dist < tolWorld) {
            const a = p.angle;
            // is angle within arc's range?
            // arc goes from ang1 to ang2 in CCW direction
            const a1 = arc.ang1, a2 = arc.ang2;
            const inArc = isAngleBetween(a, a1, a2);
            if (inArc && (!best || p.dist < best.dist)) {
              best = { type: 'arc', circleId: id, ang1: arc.ang1, ang2: arc.ang2, center: C.center, radius: C.radius, dist: p.dist, a: arc.a, b: arc.b, pidA: arc.pidA, pidB: arc.pidB };
            }
          }
        }
      }
    }
    return best;
  };

  const isAngleBetween = (a, a1, a2) => {
    // CCW from a1 to a2, with wrapping (arcs are sorted by angle ascending; a2 may be < a1 only across wrap)
    // arcs as constructed: hits are sorted by angle ascending; arc i goes from hits[i] to hits[i+1] in CCW direction
    // Since angles are in [-pi, pi], CCW means increasing. The "wrap" arc goes from hits[n-1] to hits[0] (which is +2pi from hits[n-1] when wrapping).
    if (a2 >= a1) return a >= a1 - EPS && a <= a2 + EPS;
    // wrap arc
    return a >= a1 - EPS || a <= a2 + EPS;
  };

  // ======================== INK TOOL ========================
  const handleInkTap = (w) => {
    const seg = findSegmentAt(w);
    if (!seg) return;
    pushUndo();
    if (seg.type === 'lineSeg') {
      // toggle: find existing ink that matches this exact range
      const idx = inks.findIndex(k => k.type === 'lineSeg' && k.lineId === seg.lineId && Math.abs(k.t1 - seg.t1) < EPS*10 && Math.abs(k.t2 - seg.t2) < EPS*10);
      if (idx >= 0) setInks(I => I.filter((_, i) => i !== idx));
      else setInks(I => [...I, { type: 'lineSeg', lineId: seg.lineId, t1: seg.t1, t2: seg.t2 }]);
    } else if (seg.type === 'arc') {
      const idx = inks.findIndex(k => k.type === 'arc' && k.circleId === seg.circleId && Math.abs(k.ang1 - seg.ang1) < EPS*10 && Math.abs(k.ang2 - seg.ang2) < EPS*10);
      if (idx >= 0) setInks(I => I.filter((_, i) => i !== idx));
      else setInks(I => [...I, { type: 'arc', circleId: seg.circleId, ang1: seg.ang1, ang2: seg.ang2 }]);
    } else if (seg.type === 'wholeCircle') {
      const idx = inks.findIndex(k => k.type === 'wholeCircle' && k.circleId === seg.circleId);
      if (idx >= 0) setInks(I => I.filter((_, i) => i !== idx));
      else setInks(I => [...I, { type: 'wholeCircle', circleId: seg.circleId }]);
    }
  };

  // ======================== POLYGON TOOL ========================
  const handlePolygonTap = (w) => {
    const seg = findSegmentAt(w);
    if (!seg) return;
    if (seg.type === 'wholeCircle') return; // can't be polygon edge

    // If the user taps a segment already in polyDraft, truncate the draft to before that segment.
    // Comparison uses pidA/pidB pair (set), independent of underlying line/arc parameters
    // and FP precision.
    const sameSeg = (a, b) => {
      if (a.type !== b.type) return false;
      if (a.type === 'lineSeg' && a.lineId !== b.lineId) return false;
      if (a.type === 'arc' && a.circleId !== b.circleId) return false;
      return (a.pidA === b.pidA && a.pidB === b.pidB) || (a.pidA === b.pidB && a.pidB === b.pidA);
    };
    for (let i = 0; i < polyDraft.length; i++) {
      if (sameSeg(polyDraft[i].seg, seg)) {
        setPolyDraft(polyDraft.slice(0, i));
        return;
      }
    }

    let p1, p2;
    if (seg.type === 'lineSeg') { p1 = seg.a; p2 = seg.b; }
    else if (seg.type === 'arc') { p1 = seg.a; p2 = seg.b; }

    if (polyDraft.length === 0) {
      setPolyDraft([{ seg, from: p1, to: p2, forward: true, pidFrom: seg.pidA, pidTo: seg.pidB }]);
      return;
    }
    const last = polyDraft[polyDraft.length - 1];
    let nextFrom, nextTo, nextForward, nextPidFrom, nextPidTo;
    let needFirstReverse = false;
    // pid-based connectivity: two segments share an endpoint iff their canonical-point IDs match.
    // This is precision-independent — no float comparison needed.
    if (seg.pidA !== undefined && seg.pidA === last.pidTo) {
      nextFrom = p1; nextTo = p2; nextForward = true; nextPidFrom = seg.pidA; nextPidTo = seg.pidB;
    } else if (seg.pidB !== undefined && seg.pidB === last.pidTo) {
      nextFrom = p2; nextTo = p1; nextForward = false; nextPidFrom = seg.pidB; nextPidTo = seg.pidA;
    } else if (polyDraft.length === 1 && seg.pidA !== undefined && seg.pidA === last.pidFrom) {
      nextFrom = p1; nextTo = p2; nextForward = true; needFirstReverse = true;
      nextPidFrom = seg.pidA; nextPidTo = seg.pidB;
    } else if (polyDraft.length === 1 && seg.pidB !== undefined && seg.pidB === last.pidFrom) {
      nextFrom = p2; nextTo = p1; nextForward = false; needFirstReverse = true;
      nextPidFrom = seg.pidB; nextPidTo = seg.pidA;
    } else {
      setPolyRejected(seg);
      return; // doesn't connect — flash the segment red so user sees what they hit
    }
    let baseDraft = polyDraft;
    if (needFirstReverse) {
      const rev = { ...last, from: last.to, to: last.from, forward: !last.forward, pidFrom: last.pidTo, pidTo: last.pidFrom };
      baseDraft = [rev];
    }
    const startPid = baseDraft[0].pidFrom;
    if (nextPidTo !== undefined && nextPidTo === startPid) {
      const cycle = [...baseDraft, { seg, from: nextFrom, to: nextTo, forward: nextForward, pidFrom: nextPidFrom, pidTo: nextPidTo }];
      finalizePolygon(cycle);
      setPolyDraft([]);
    } else {
      setPolyDraft([...baseDraft, { seg, from: nextFrom, to: nextTo, forward: nextForward, pidFrom: nextPidFrom, pidTo: nextPidTo }]);
    }
  };

  const finalizePolygon = (cycle) => {
    pushUndo();
    // vertices in order
    const vertices = cycle.map(c => c.from);
    // edges
    const edges = cycle.map((c, i) => {
      if (c.seg.type === 'lineSeg') {
        return { type: 'line', from: i, to: (i + 1) % cycle.length };
      } else {
        // arc edge — sweepCCW=true means traverse in same direction as original CCW arc (ang1 -> ang2)
        const center = c.seg.center;
        const radius = c.seg.radius;
        const fromAngle = angBetween(center, c.from);
        const toAngle = angBetween(center, c.to);
        return { type: 'arc', from: i, to: (i + 1) % cycle.length, center, radius, fromAngle, toAngle, sweepCCW: !!c.forward };
      }
    });
    // Compute centroid for centering
    const cx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length;
    const cy = vertices.reduce((s, v) => s + v.y, 0) / vertices.length;
    const localVerts = vertices.map(v => ({ x: v.x - cx, y: v.y - cy }));
    const localEdges = edges.map(e => {
      if (e.type === 'arc') return { ...e, center: { x: e.center.x - cx, y: e.center.y - cy } };
      return e;
    });
    // Find inks inside polygon (in world coords) and translate to local
    const polyVerts = vertices;
    const inksInside = [];
    for (const ink of inks) {
      const inside = isInkInsidePolygon(ink, polyVerts);
      if (inside) {
        if (ink.type === 'lineSeg') {
          const L = lines[ink.lineId];
          if (!L) continue;
          const a = lerp(L.p1, L.p2, ink.t1);
          const b = lerp(L.p1, L.p2, ink.t2);
          inksInside.push({ type: 'line', a: { x: a.x - cx, y: a.y - cy }, b: { x: b.x - cx, y: b.y - cy } });
        } else if (ink.type === 'arc') {
          const C = circles[ink.circleId];
          if (!C) continue;
          inksInside.push({ type: 'arc', center: { x: C.center.x - cx, y: C.center.y - cy }, radius: C.radius, ang1: ink.ang1, ang2: ink.ang2 });
        } else if (ink.type === 'wholeCircle') {
          const C = circles[ink.circleId];
          if (!C) continue;
          inksInside.push({ type: 'wholeCircle', center: { x: C.center.x - cx, y: C.center.y - cy }, radius: C.radius });
        }
      }
    }

    // Find construction sub-segments inside polygon. We walk each line's hits and each circle's
    // hits to get sub-segments between intersections (the same decomposition used for inking),
    // then test each sub-segment's midpoint against the polygon. Sub-segments coincident with
    // polygon boundary edges may or may not pass the midpoint test (boundary case is unstable),
    // but since they render under the dark tile boundary stroke, the visual outcome is fine
    // either way.
    const constructionInside = [];
    for (const id in lineHits) {
      const segs = getLineSegments(lineHits, id);
      for (const s of segs) {
        const mid = lerp(s.a, s.b, 0.5);
        if (pointInPoly(mid, polyVerts)) {
          constructionInside.push({
            type: 'line',
            a: { x: s.a.x - cx, y: s.a.y - cy },
            b: { x: s.b.x - cx, y: s.b.y - cy },
          });
        }
      }
    }
    for (const id in circleHits) {
      const C = circles[id];
      if (!C) continue;
      const arcs = getCircleArcs(circleHits, id, C);
      for (const arc of arcs) {
        // midpoint angle of CCW arc from ang1 to ang2
        let midAng = (arc.ang1 + arc.ang2) / 2;
        if (arc.ang2 < arc.ang1) midAng = (arc.ang1 + arc.ang2 + 2 * Math.PI) / 2;
        const midP = {
          x: C.center.x + C.radius * Math.cos(midAng),
          y: C.center.y + C.radius * Math.sin(midAng),
        };
        if (pointInPoly(midP, polyVerts)) {
          constructionInside.push({
            type: 'arc',
            center: { x: C.center.x - cx, y: C.center.y - cy },
            radius: C.radius,
            ang1: arc.ang1,
            ang2: arc.ang2,
          });
        }
      }
    }
    // Whole-circle construction (no intersections): included if center is inside polygon.
    // Such a circle is either entirely inside or entirely outside the polygon (since it has
    // no intersections with anything), so a single center test suffices.
    for (const id in circles) {
      const C = circles[id];
      const hits = circleHits[id] || [];
      if (hits.length === 0 && pointInPoly(C.center, polyVerts)) {
        constructionInside.push({
          type: 'wholeCircle',
          center: { x: C.center.x - cx, y: C.center.y - cy },
          radius: C.radius,
        });
      }
    }

    const newTile = { id: newId(), vertices: localVerts, edges: localEdges, inks: inksInside, construction: constructionInside };
    setTiles(T => [...T, newTile]);
    setSheetOpen(true);
  };

  // Approximate "ink inside polygon" check: midpoint of ink inside polygon
  const isInkInsidePolygon = (ink, polyVerts) => {
    let pt;
    if (ink.type === 'lineSeg') {
      const L = lines[ink.lineId];
      if (!L) return false;
      const a = lerp(L.p1, L.p2, ink.t1);
      const b = lerp(L.p1, L.p2, ink.t2);
      pt = lerp(a, b, 0.5);
    } else if (ink.type === 'arc') {
      const C = circles[ink.circleId];
      if (!C) return false;
      let mid = (ink.ang1 + ink.ang2) / 2;
      if (ink.ang2 < ink.ang1) mid = (ink.ang1 + ink.ang2 + 2*Math.PI) / 2;
      pt = { x: C.center.x + C.radius * Math.cos(mid), y: C.center.y + C.radius * Math.sin(mid) };
    } else return false;
    return pointInPoly(pt, polyVerts);
  };

  const pointInPoly = (p, verts) => {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const vi = verts[i], vj = verts[j];
      if (((vi.y > p.y) !== (vj.y > p.y)) && (p.x < (vj.x - vi.x) * (p.y - vi.y) / (vj.y - vi.y) + vi.x)) inside = !inside;
    }
    return inside;
  };

  // ======================== HANDLE DRAGGING (FOR LINES, CIRCLES, TILES) ========================
  const startHandleDrag = (handle, e) => {
    e.stopPropagation();
    const pos = getEventPos(e);
    e.target.setPointerCapture?.(e.pointerId);
    ptrState.current.pointers.set(e.pointerId, { ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: screenToWorld(pos.x, pos.y) });
    ptrState.current.action = { kind: 'dragHandle', handle, startView: { ...view } };
  };

  // Pan when no tool action makes sense (e.g., select tool, empty area)
  const startPan = (e) => {
    const pos = getEventPos(e);
    ptrState.current.action = { kind: 'pan', startScreen: pos, startView: { ...view } };
  };

  // ======================== RENDERING HELPERS ========================
  const recenter = () => setView({ tx: containerSize.w / 2, ty: containerSize.h / 2, scale: view.scale });

  // Initial center when first loaded
  useEffect(() => {
    if (view.tx === 0 && view.ty === 0 && containerSize.w > 0) {
      setView(v => ({ ...v, tx: containerSize.w / 2, ty: containerSize.h / 2 }));
    }
  }, [containerSize]);

  // Build SVG path for an arc (from start point to end point along circle)
  const arcPath = (start, end, center, radius, sweepCCW = true) => {
    // SVG arc: M sx sy A rx ry x-axis-rotation large-arc-flag sweep-flag ex ey
    // sweep-flag: 0 = CCW, 1 = CW (in SVG with default y-down... actually 1 = CW with screen-y up; need to be careful)
    // We'll compute large-arc-flag based on arc angle.
    const a1 = angBetween(center, start);
    const a2 = angBetween(center, end);
    let delta = a2 - a1;
    if (sweepCCW) {
      while (delta < 0) delta += 2 * Math.PI;
    } else {
      while (delta > 0) delta -= 2 * Math.PI;
    }
    const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
    const sweepFlag = sweepCCW ? 0 : 1; // SVG: 0 = CCW (in math sense, but with y-flipped this becomes CW visually). Try both.
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${end.x} ${end.y}`;
  };

  // ======================== ACTIONS ON EDITING ITEM ========================
  const updateLine = (id, patch) => setLines(L => ({ ...L, [id]: { ...L[id], ...patch } }));
  const updateCircle = (id, patch) => setCircles(C => ({ ...C, [id]: { ...C[id], ...patch } }));

  const deleteLine = (id) => {
    pushUndo();
    setLines(L => { const N = { ...L }; delete N[id]; return N; });
    setInks(I => I.filter(k => !(k.type === 'lineSeg' && k.lineId === id)));
    setEditing(null);
  };
  const deleteCircle = (id) => {
    pushUndo();
    setCircles(C => { const N = { ...C }; delete N[id]; return N; });
    setInks(I => I.filter(k => !((k.type === 'arc' || k.type === 'wholeCircle') && k.circleId === id)));
    setEditing(null);
  };
  const deletePlaced = (id) => {
    pushUndo();
    setPlaced(P => P.filter(p => p.id !== id));
    setEditing(null);
  };

  const deleteTile = (id) => {
    pushUndo();
    setTiles(T => T.filter(t => t.id !== id));
    setPlaced(P => P.filter(p => p.tileId !== id));
  };

  // Rotate placed tile by delta
  const rotatePlaced = (id, delta) => {
    setPlaced(P => P.map(p => p.id === id ? { ...p, rotation: p.rotation + delta } : p));
  };
  const flipPlaced = (id) => {
    setPlaced(P => P.map(p => p.id === id ? { ...p, flipped: !p.flipped } : p));
  };
  // Reset to original construction orientation (rotation=0, flipped=false)
  const resetPlaced = (id) => {
    setPlaced(P => P.map(p => p.id === id ? { ...p, rotation: 0, flipped: false } : p));
  };
  // Snap a placed tile's rotation to the nearest step grid multiple
  const snapPlacedToGrid = (id) => {
    setPlaced(P => P.map(p => {
      if (p.id !== id) return p;
      const step = rotationStepRad;
      if (step <= 0) return p;
      return { ...p, rotation: Math.round(p.rotation / step) * step };
    }));
  };

  // ======================== CONSTRUCTION RENDERING ========================
  // Determine ink/segment overlay paths from inks
  const inkPaths = useMemo(() => {
    const paths = [];
    for (const ink of inks) {
      if (ink.type === 'lineSeg') {
        const L = lines[ink.lineId];
        if (!L) continue;
        const a = lerp(L.p1, L.p2, ink.t1);
        const b = lerp(L.p1, L.p2, ink.t2);
        paths.push({ kind: 'line', a, b });
      } else if (ink.type === 'arc') {
        const C = circles[ink.circleId];
        if (!C) continue;
        const a = { x: C.center.x + C.radius * Math.cos(ink.ang1), y: C.center.y + C.radius * Math.sin(ink.ang1) };
        const b = { x: C.center.x + C.radius * Math.cos(ink.ang2), y: C.center.y + C.radius * Math.sin(ink.ang2) };
        paths.push({ kind: 'arc', a, b, center: C.center, radius: C.radius });
      } else if (ink.type === 'wholeCircle') {
        const C = circles[ink.circleId];
        if (!C) continue;
        paths.push({ kind: 'wholeCircle', center: C.center, radius: C.radius });
      }
    }
    return paths;
  }, [inks, lines, circles]);

  // Polygon-in-progress paths
  const polyDraftSegs = polyDraft;

  // ======================== EDIT MODE HANDLES ========================
  // Generate handles for current editing item.
  let handles = [];
  if (editing?.kind === 'line') {
    const L = lines[editing.id];
    if (L) {
      const mid = lerp(L.p1, L.p2, 0.5);
      const dir = sub(L.p2, L.p1);
      const len = Math.hypot(dir.x, dir.y);
      const dirUnit = len > EPS ? { x: dir.x / len, y: dir.y / len } : { x: 1, y: 0 };

      // Endpoint angle handles sit "just past" each endpoint along the line.
      // Use a fixed screen offset, but cap it so we don't pass the midpoint on short lines.
      const offset = Math.min(28 / view.scale, len * 0.25);
      const knobNearA = { x: L.p1.x + offset * dirUnit.x, y: L.p1.y + offset * dirUnit.y };
      const knobNearC = { x: L.p2.x - offset * dirUnit.x, y: L.p2.y - offset * dirUnit.y };

      // ---- Lengthen helper: project onto axis, snap to on-axis snap targets ----
      const lengthenWithSnap = (axisOrigin, axisDir, applyEndpoint) => (snap, free) => {
        const fromAO = sub(free, axisOrigin);
        const t_finger = fromAO.x * axisDir.x + fromAO.y * axisDir.y;
        if (Math.abs(t_finger) < EPS) return;
        const projected = { x: axisOrigin.x + t_finger * axisDir.x, y: axisOrigin.y + t_finger * axisDir.y };

        const targets = computeSnapTargets();
        const snapRadiusWorld = SNAP_PX / view.scale;
        const perpTol = 2 / view.scale;
        let best = null;
        for (const tg of targets.points) {
          if (dist(tg, axisOrigin) < EPS) continue;
          const tgVec = sub(tg, axisOrigin);
          const t_target = tgVec.x * axisDir.x + tgVec.y * axisDir.y;
          if (t_target < EPS) continue;
          const onAxisP = { x: axisOrigin.x + t_target * axisDir.x, y: axisOrigin.y + t_target * axisDir.y };
          const perpDist = dist(tg, onAxisP);
          if (perpDist > perpTol) continue;
          const axisDist = Math.abs(t_target - t_finger);
          if (axisDist > snapRadiusWorld) continue;
          if (!best || axisDist < best.axisDist) best = { tg, t_target, axisDist, onAxisP };
        }

        let newPos;
        if (best) {
          newPos = best.onAxisP;
          setSnapIndicator({ x: best.tg.x, y: best.tg.y, kind: 'lengthen-snap' });
        } else {
          newPos = projected;
          setSnapIndicator(null);
        }
        applyEndpoint(newPos);
      };

      // ---- Rotation helper: filter on-line points, prefer canonical horizontal ----
      const rotateAroundPivot = (pivot, fixedLen, applyAngle) => (snap, free) => {
        const isOnEditLine = (p) => {
          const fromP1 = sub(p, L.p1);
          const onLineComp = fromP1.x * dirUnit.x + fromP1.y * dirUnit.y;
          const onLine = { x: L.p1.x + onLineComp * dirUnit.x, y: L.p1.y + onLineComp * dirUnit.y };
          return dist(p, onLine) < 1 / view.scale;
        };

        const candidates = [0, Math.PI];
        const targets = computeSnapTargets();
        for (const t of targets.points) {
          if (dist(t, pivot) < EPS) continue;
          if (isOnEditLine(t)) continue;
          const a = angBetween(pivot, t);
          candidates.push(a);
          candidates.push(normAng(a + Math.PI));
        }

        const userAngle = angBetween(pivot, free);
        const angThresh = Math.atan2(SNAP_PX / view.scale, Math.max(fixedLen, 1));

        const isCanonicalAng = (a) => {
          const an = normAng(a);
          return Math.abs(an) < 0.001 || Math.abs(Math.abs(an) - Math.PI) < 0.001;
        };

        let bestAng = userAngle;
        let bestDelta = Infinity;
        let bestCanonical = false;
        for (const c of candidates) {
          const d = Math.abs(normAng(c - userAngle));
          if (d > angThresh) continue;
          const cIsC = isCanonicalAng(c);
          if (bestCanonical && !cIsC) continue;
          if (!bestCanonical && cIsC) {
            bestAng = c; bestDelta = d; bestCanonical = true;
            continue;
          }
          if (d < bestDelta) { bestAng = c; bestDelta = d; }
        }

        applyAngle(bestAng);
        if (bestDelta !== Infinity) setSnapIndicator({ x: free.x, y: free.y, kind: 'rot' });
        else setSnapIndicator(null);
      };

      // ---- The five handles, in order along the line ----

      // 1. Length at A (P1) — pivot at P2, axis from P2 toward P1
      handles.push({
        kind: 'lengthen',
        x: L.p1.x, y: L.p1.y,
        onMove: lengthenWithSnap(L.p2, { x: -dirUnit.x, y: -dirUnit.y }, (newP1) => {
          updateLine(editing.id, { p1: newP1 });
        }),
        allowSnap: false,
      });

      // 2. Angle just past A — pivot at C (L.p2); A swings
      handles.push({
        kind: 'rotate',
        x: knobNearA.x, y: knobNearA.y,
        pivot: L.p2,
        onMove: rotateAroundPivot(L.p2, len, (ang) => {
          const newP1 = { x: L.p2.x + len * Math.cos(ang), y: L.p2.y + len * Math.sin(ang) };
          updateLine(editing.id, { p1: newP1 });
        }),
        allowSnap: false,
      });

      // 3. Angle at midpoint — pivot at midpoint; both endpoints swing
      handles.push({
        kind: 'rotate',
        x: mid.x, y: mid.y,
        pivot: mid,
        onMove: rotateAroundPivot(mid, len / 2, (ang) => {
          const half = len / 2;
          const newP1 = { x: mid.x - half * Math.cos(ang), y: mid.y - half * Math.sin(ang) };
          const newP2 = { x: mid.x + half * Math.cos(ang), y: mid.y + half * Math.sin(ang) };
          updateLine(editing.id, { p1: newP1, p2: newP2 });
        }),
        allowSnap: false,
      });

      // 4. Angle just before C — pivot at A (L.p1); C swings
      handles.push({
        kind: 'rotate',
        x: knobNearC.x, y: knobNearC.y,
        pivot: L.p1,
        onMove: rotateAroundPivot(L.p1, len, (ang) => {
          const newP2 = { x: L.p1.x + len * Math.cos(ang), y: L.p1.y + len * Math.sin(ang) };
          updateLine(editing.id, { p2: newP2 });
        }),
        allowSnap: false,
      });

      // 5. Length at C (P2) — pivot at P1, axis from P1 toward P2
      handles.push({
        kind: 'lengthen',
        x: L.p2.x, y: L.p2.y,
        onMove: lengthenWithSnap(L.p1, dirUnit, (newP2) => {
          updateLine(editing.id, { p2: newP2 });
        }),
        allowSnap: false,
      });
    }
  } else if (editing?.kind === 'circle') {
    const C = circles[editing.id];
    if (C) {
      // center handle (move whole circle)
      handles.push({
        kind: 'center',
        x: C.center.x, y: C.center.y,
        onMove: (snap) => {
          const delta = sub({ x: snap.x, y: snap.y }, C.center);
          updateCircle(editing.id, { center: { x: snap.x, y: snap.y }, radiusPt: C.radiusPt ? add(C.radiusPt, delta) : undefined });
        },
        snapOpts: { allow1D: true },
      });
      // radius point handle
      const rPt = C.radiusPt || { x: C.center.x + C.radius, y: C.center.y };
      handles.push({
        kind: 'radius',
        x: rPt.x, y: rPt.y,
        onMove: (snap) => {
          const r = dist(C.center, snap);
          if (r > EPS) updateCircle(editing.id, { radius: r, radiusPt: { x: snap.x, y: snap.y } });
        },
        snapOpts: { allow1D: true },
      });
    }
  } else if (editing?.kind === 'placedTile') {
    const pt = placed.find(p => p.id === editing.id);
    const tile = pt && tiles.find(t => t.id === pt.tileId);
    if (pt && tile) {
      handles.push({
        kind: 'move',
        x: pt.position.x, y: pt.position.y,
        onMove: (snap, free) => {
          // Tentative position: tile center follows the finger.
          const tentativePos = { x: free.x, y: free.y };
          // Compute tentative world positions of all this tile's vertices.
          const tentativePt = { ...pt, position: tentativePos };
          const tentativeWorldVerts = tile.vertices.map(v => transformPoint(v, tentativePt));
          // Look for the best (vertex, snap target) pair, excluding this tile's own vertices.
          const targets = computeSnapTargets();
          const radiusWorld = SNAP_PX / view.scale;
          let best = null;
          for (let i = 0; i < tentativeWorldVerts.length; i++) {
            const wv = tentativeWorldVerts[i];
            for (const t of targets.points) {
              if (t.kind === 'tile-vertex' && t.placedId === pt.id) continue;
              const d = dist(wv, t);
              if (d < radiusWorld && (!best || d < best.dist)) {
                best = { vertexIdx: i, target: t, dist: d };
              }
            }
          }
          let finalPos = tentativePos;
          if (best) {
            // Translate the tile so the chosen vertex lands exactly on the target.
            const wv = tentativeWorldVerts[best.vertexIdx];
            const delta = sub(best.target, wv);
            finalPos = add(tentativePos, delta);
            setSnapIndicator({ x: best.target.x, y: best.target.y, kind: 'vertex-snap' });
          } else {
            setSnapIndicator(null);
          }
          setPlaced(P => P.map(p => p.id === editing.id ? { ...p, position: finalPos } : p));
        },
        // We do our own snapping in onMove; bypass the auto-snap layer.
        allowSnap: false,
      });

      // Rotation handle — placed at a fixed screen-pixel offset from the centroid, rotating with the tile.
      // Drag to rotate; snaps to the current rotation step.
      const rotHandleOffsetPx = 60;
      const rotHandleOffsetWorld = rotHandleOffsetPx / view.scale;
      // Local offset (before tile transform): (offset, 0). After flip+rotation+translate, world position:
      let rotHandleLocal = { x: rotHandleOffsetWorld, y: 0 };
      if (pt.flipped) rotHandleLocal = { x: -rotHandleLocal.x, y: rotHandleLocal.y };
      const rotHandleAfterRot = rot(rotHandleLocal, pt.rotation);
      const rotHandleWorld = add(rotHandleAfterRot, pt.position);
      handles.push({
        kind: 'rotate',
        x: rotHandleWorld.x, y: rotHandleWorld.y,
        pivot: pt.position,
        showTether: true,
        onMove: (snap, free) => {
          // World angle from centroid to finger.
          let worldAngle = angBetween(pt.position, free);
          // Convert to "rotation" value: when not flipped, world handle angle = rotation.
          // When flipped, the local handle is at (-offset,0), so world angle = rotation + π.
          let newRotation = pt.flipped ? worldAngle - Math.PI : worldAngle;
          // Snap to step
          if (rotationStepRad > 0) {
            newRotation = Math.round(newRotation / rotationStepRad) * rotationStepRad;
          }
          setPlaced(P => P.map(p => p.id === editing.id ? { ...p, rotation: newRotation } : p));
        },
        allowSnap: false,
      });
    }
  }

  // ======================== TOOL CONTROLS ========================
  const tools = [
    { id: 'line', label: 'Line', icon: '/' },
    { id: 'circle', label: 'Circle', icon: '○' },
    { id: 'ink', label: 'Ink', icon: '✎' },
    { id: 'polygon', label: 'Polygon', icon: '◇' },
    { id: 'select', label: 'Select', icon: '⇲' },
  ];

  // Render snap-target intersection buttons (visible when line/circle tool selected and not in middle of edit/draft)
  const showSnapButtons = (tool === 'line' || tool === 'circle');

  // ======================== RENDER ========================
  return (
    <div className="w-full h-screen flex flex-col" style={{ background: '#F1E9D6', fontFamily: '"Cormorant Garamond", "EB Garamond", Georgia, serif', userSelect: 'none', touchAction: 'none' }}>
      {/* Top toolbar */}
      <div className="border-b" style={{ background: '#E5DAC0', borderColor: '#C9B98F' }}>
        <div className="flex items-center px-2 py-1.5 gap-1 flex-wrap">
          {tools.map(t => (
            <button
              key={t.id}
              onClick={() => { setTool(t.id); setDraft(null); setEditing(null); setPolyDraft([]); }}
              className="rounded transition-colors flex items-center justify-center"
              title={t.label}
              style={{
                background: tool === t.id ? '#3A2E1F' : 'transparent',
                color: tool === t.id ? '#F1E9D6' : '#3A2E1F',
                border: '1px solid #3A2E1F',
                width: 36,
                height: 36,
                fontSize: 16,
                lineHeight: 1,
                fontWeight: tool === t.id ? 600 : 400,
                flexShrink: 0,
              }}
            >{t.icon}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={undo} disabled={undoStack.length === 0} title="Undo" className="rounded flex items-center justify-center" style={{ border: '1px solid #3A2E1F', color: '#3A2E1F', opacity: undoStack.length === 0 ? 0.3 : 1, width: 30, height: 30, fontSize: 13, flexShrink: 0 }}>↶</button>
          <button onClick={redo} disabled={redoStack.length === 0} title="Redo" className="rounded flex items-center justify-center" style={{ border: '1px solid #3A2E1F', color: '#3A2E1F', opacity: redoStack.length === 0 ? 0.3 : 1, width: 30, height: 30, fontSize: 13, flexShrink: 0 }}>↷</button>
          <button onClick={() => setShowCons(s => !s)} title={showCons ? 'Hide construction' : 'Show construction'} className="rounded flex items-center justify-center" style={{ border: '1px solid #3A2E1F', background: showCons ? 'transparent' : '#3A2E1F', color: showCons ? '#3A2E1F' : '#F1E9D6', width: 30, height: 30, fontSize: 11, flexShrink: 0 }}>{showCons ? '◫' : '▢'}</button>
          <button onClick={recenter} title="Recenter" className="rounded flex items-center justify-center" style={{ border: '1px solid #3A2E1F', color: '#3A2E1F', width: 30, height: 30, fontSize: 13, flexShrink: 0 }}>⊕</button>
          <button
            onClick={() => {
              if (confirmClear) {
                pushUndo();
                setLines({}); setCircles({}); setInks([]); setPlaced([]);
                setEditing(null); setDraft(null); setPolyDraft([]);
                setConfirmClear(false);
              } else {
                setConfirmClear(true);
              }
            }}
            title="Clear canvas"
            className="rounded flex items-center justify-center"
            style={{
              border: '1px solid #8B2E1A',
              color: confirmClear ? '#F1E9D6' : '#8B2E1A',
              background: confirmClear ? '#8B2E1A' : 'transparent',
              padding: confirmClear ? '0 6px' : 0,
              width: confirmClear ? 'auto' : 30,
              height: 30,
              fontSize: confirmClear ? 10 : 13,
              flexShrink: 0,
            }}
          >{confirmClear ? 'tap again' : '✕'}</button>
        </div>
      </div>

      {/* Status / draft info */}
      {(draft || polyDraft.length > 0 || editing) && (
        <div className="px-3 py-1 text-xs" style={{ background: '#D9C9A4', color: '#3A2E1F', fontStyle: 'italic' }}>
          {draft?.kind === 'line' && 'Tap to set second endpoint'}
          {draft?.kind === 'circle' && draft.step === 'measureA' && 'Tap second point to set compass width'}
          {draft?.kind === 'circle' && draft.step === 'placing' && 'Tap any point to place a circle. Tap Circle tool to remeasure.'}
          {polyDraft.length > 0 && `Polygon: ${polyDraft.length} edge${polyDraft.length === 1 ? '' : 's'} selected. Tap connecting segment, or close back to start.`}
          {editing && !draft && (
            <div className="flex gap-2 items-center">
              <span>Editing {editing.kind}</span>
              {editing.kind === 'line' && <button onClick={() => deleteLine(editing.id)} className="ml-auto px-2 py-0.5" style={{ color: '#8B2E1A' }}>delete</button>}
              {editing.kind === 'circle' && <button onClick={() => deleteCircle(editing.id)} className="ml-auto px-2 py-0.5" style={{ color: '#8B2E1A' }}>delete</button>}
              {editing.kind === 'placedTile' && <>
                <button
                  onClick={cycleRotationStep}
                  title="Tap to cycle rotation step"
                  className="px-2 py-0.5"
                  style={{ border: '1px solid #3A2E1F', background: '#E5DAC0', minWidth: 44 }}
                >{rotationStepDeg}°</button>
                <button onClick={() => rotatePlaced(editing.id, -rotationStepRad)} title="Rotate counter-clockwise by step" className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>↺</button>
                <button onClick={() => rotatePlaced(editing.id, rotationStepRad)} title="Rotate clockwise by step" className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>↻</button>
                <button onClick={() => snapPlacedToGrid(editing.id)} title="Snap rotation to step grid" className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>⊞</button>
                <button onClick={() => resetPlaced(editing.id)} title="Reset to original orientation" className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>⟲</button>
                <button onClick={() => flipPlaced(editing.id)} className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>flip</button>
                <button onClick={() => deletePlaced(editing.id)} className="px-2 py-0.5" style={{ color: '#8B2E1A' }}>delete</button>
              </>}
              <button onClick={() => setEditing(null)} className="px-2 py-0.5" style={{ border: '1px solid #3A2E1F' }}>done</button>
            </div>
          )}
        </div>
      )}

      {/* Canvas container */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ background: '#F1E9D6' }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          onPointerDown={(e) => {
            // Defensive: if a child handler (handle, marker) has already initiated a non-pan action
            // for this pointerdown, don't override it. Belt-and-suspenders for stopPropagation.
            if (ptrState.current.action?.kind === 'dragHandle') return;
            const pos = getEventPos(e);
            const worldP = screenToWorld(pos.x, pos.y);

            // Nearest-handle hit detection: if a handle is within hit radius of the tap, drag it.
            // "Closest wins" — works correctly even when handle hit areas overlap, no z-order surprises.
            // Only check this for the first finger; pinch/2-finger gestures still go through pinch logic.
            if (handles.length > 0 && ptrState.current.pointers.size === 0) {
              const hitRadiusWorld = (HANDLE_R + HANDLE_HIT_PAD) / view.scale;
              let nearest = null;
              let nearestD = hitRadiusWorld;
              for (const h of handles) {
                const d = dist(worldP, h);
                if (d < nearestD) { nearestD = d; nearest = h; }
              }
              if (nearest) {
                e.target.setPointerCapture?.(e.pointerId);
                ptrState.current.pointers.set(e.pointerId, {
                  ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: worldP,
                });
                ptrState.current.action = { kind: 'dragHandle', handle: nearest, startView: { ...view } };
                return;
              }
            }

            ptrState.current.pointers.set(e.pointerId, { ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: worldP });
            e.target.setPointerCapture?.(e.pointerId);
            if (ptrState.current.pointers.size === 2) {
              const pts = [...ptrState.current.pointers.values()];
              const cx = (pts[0].x + pts[1].x) / 2;
              const cy = (pts[0].y + pts[1].y) / 2;
              const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
              ptrState.current.action = { kind: 'pinch', startDist: d, startCenter: { x: cx, y: cy }, startView: { ...view } };
            } else {
              // Always allow single-finger pan; tap vs drag distinguished by `moved` flag on pointer up.
              ptrState.current.action = { kind: 'pan', startScreen: pos, startView: { ...view } };
            }
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            {/* Construction circles */}
            {showCons && Object.entries(circles).map(([id, c]) => (
              <circle
                key={`c-${id}`}
                cx={c.center.x}
                cy={c.center.y}
                r={c.radius}
                fill="none"
                stroke="#9C8A6A"
                strokeWidth={1 / view.scale}
                opacity={0.4}
              />
            ))}
            {/* Construction lines */}
            {showCons && Object.entries(lines).map(([id, l]) => (
              <line
                key={`l-${id}`}
                x1={l.p1.x} y1={l.p1.y} x2={l.p2.x} y2={l.p2.y}
                stroke="#9C8A6A"
                strokeWidth={1 / view.scale}
                opacity={0.4}
              />
            ))}

            {/* Inks */}
            {inkPaths.map((p, i) => {
              if (p.kind === 'line') return <line key={`ink-${i}`} x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke="#1B1B1B" strokeWidth={2.5 / view.scale} strokeLinecap="round" />;
              if (p.kind === 'arc') {
                // For ink arcs, we draw an arc that goes CCW from ang1 to ang2.
                // But CCW in math (y-up) becomes CW visually with SVG y-down. Use sweepFlag accordingly.
                let delta = p.kind === 'arc' ? null : null;
                // Compute large-arc and sweep flags
                const a1 = angBetween(p.center, p.a);
                const a2 = angBetween(p.center, p.b);
                let d2 = a2 - a1;
                while (d2 < 0) d2 += 2 * Math.PI;
                const largeArc = d2 > Math.PI ? 1 : 0;
                // SVG's y-axis is flipped; CCW in math = CW visually so sweep-flag should be 1 for visually-CW.
                // Wait: with our world coords matching SVG (y-down), "CCW" in math sense means clockwise on screen.
                // We want the arc that goes from a1 to a2 increasing angle (math CCW).
                // SVG sweep-flag=1 means arc goes in direction of increasing angle (positive). Use 1.
                return (
                  <path key={`ink-${i}`} d={`M ${p.a.x} ${p.a.y} A ${p.radius} ${p.radius} 0 ${largeArc} 1 ${p.b.x} ${p.b.y}`} fill="none" stroke="#1B1B1B" strokeWidth={2.5 / view.scale} strokeLinecap="round" />
                );
              }
              if (p.kind === 'wholeCircle') return <circle key={`ink-${i}`} cx={p.center.x} cy={p.center.y} r={p.radius} fill="none" stroke="#1B1B1B" strokeWidth={2.5 / view.scale} />;
              return null;
            })}

            {/* Placed tiles */}
            {placed.map(pt => {
              const tile = tiles.find(t => t.id === pt.tileId);
              if (!tile) return null;
              const transform = `translate(${pt.position.x},${pt.position.y}) rotate(${pt.rotation * 180 / Math.PI}) ${pt.flipped ? 'scale(-1,1)' : ''}`;
              return (
                <g key={pt.id} transform={transform}>
                  {/* tile boundary (with semi-transparent fill) */}
                  <path
                    d={tilePathD(tile)}
                    fill="rgba(225,200,150,0.25)"
                    stroke="#3A2E1F"
                    strokeWidth={1.8 / view.scale}
                    strokeLinejoin="round"
                  />
                  {/* tile interior construction (above fill, below inks). Gated by showCons. */}
                  {showCons && tile.construction && tile.construction.map((c, i) => {
                    if (c.type === 'line') return <line key={`tc-${i}`} x1={c.a.x} y1={c.a.y} x2={c.b.x} y2={c.b.y} stroke="#9C8A6A" strokeWidth={1 / view.scale} opacity={0.4} />;
                    if (c.type === 'arc') {
                      let d2 = c.ang2 - c.ang1;
                      while (d2 < 0) d2 += 2*Math.PI;
                      const largeArc = d2 > Math.PI ? 1 : 0;
                      const sx = c.center.x + c.radius * Math.cos(c.ang1);
                      const sy = c.center.y + c.radius * Math.sin(c.ang1);
                      const ex = c.center.x + c.radius * Math.cos(c.ang2);
                      const ey = c.center.y + c.radius * Math.sin(c.ang2);
                      return <path key={`tc-${i}`} d={`M ${sx} ${sy} A ${c.radius} ${c.radius} 0 ${largeArc} 1 ${ex} ${ey}`} fill="none" stroke="#9C8A6A" strokeWidth={1 / view.scale} opacity={0.4} />;
                    }
                    if (c.type === 'wholeCircle') return <circle key={`tc-${i}`} cx={c.center.x} cy={c.center.y} r={c.radius} fill="none" stroke="#9C8A6A" strokeWidth={1 / view.scale} opacity={0.4} />;
                    return null;
                  })}
                  {/* tile inks */}
                  {tile.inks.map((ink, i) => {
                    if (ink.type === 'line') return <line key={i} x1={ink.a.x} y1={ink.a.y} x2={ink.b.x} y2={ink.b.y} stroke="#1B1B1B" strokeWidth={2 / view.scale} strokeLinecap="round" />;
                    if (ink.type === 'arc') {
                      const a1 = ink.ang1, a2 = ink.ang2;
                      let d2 = a2 - a1;
                      while (d2 < 0) d2 += 2*Math.PI;
                      const largeArc = d2 > Math.PI ? 1 : 0;
                      const sx = ink.center.x + ink.radius * Math.cos(a1);
                      const sy = ink.center.y + ink.radius * Math.sin(a1);
                      const ex = ink.center.x + ink.radius * Math.cos(a2);
                      const ey = ink.center.y + ink.radius * Math.sin(a2);
                      return <path key={i} d={`M ${sx} ${sy} A ${ink.radius} ${ink.radius} 0 ${largeArc} 1 ${ex} ${ey}`} fill="none" stroke="#1B1B1B" strokeWidth={2 / view.scale} strokeLinecap="round" />;
                    }
                    if (ink.type === 'wholeCircle') return <circle key={i} cx={ink.center.x} cy={ink.center.y} r={ink.radius} fill="none" stroke="#1B1B1B" strokeWidth={2 / view.scale} />;
                    return null;
                  })}
                  {/* Selected indicator */}
                  {editing?.kind === 'placedTile' && editing.id === pt.id && (
                    <path d={tilePathD(tile)} fill="none" stroke="#C58A3A" strokeWidth={2.5 / view.scale} strokeDasharray={`${4 / view.scale} ${3 / view.scale}`} />
                  )}
                </g>
              );
            })}

            {/* Polygon-in-progress preview */}
            {polyDraft.map((pd, i) => {
              if (pd.seg.type === 'lineSeg') {
                return <line key={`pd-${i}`} x1={pd.from.x} y1={pd.from.y} x2={pd.to.x} y2={pd.to.y} stroke="#C58A3A" strokeWidth={3 / view.scale} strokeLinecap="round" opacity={0.85} />;
              }
              if (pd.seg.type === 'arc') {
                const center = pd.seg.center, r = pd.seg.radius;
                const a1 = angBetween(center, pd.from);
                const a2 = angBetween(center, pd.to);
                let d2 = a2 - a1;
                // arc direction: figure out which arc was tapped (the one originally selected)
                // We stored ang1, ang2 in seg. Use them.
                const sa1 = pd.seg.ang1, sa2 = pd.seg.ang2;
                const sx = center.x + r * Math.cos(sa1), sy = center.y + r * Math.sin(sa1);
                const ex = center.x + r * Math.cos(sa2), ey = center.y + r * Math.sin(sa2);
                let delta = sa2 - sa1; while (delta < 0) delta += 2*Math.PI;
                const largeArc = delta > Math.PI ? 1 : 0;
                return <path key={`pd-${i}`} d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`} fill="none" stroke="#C58A3A" strokeWidth={3 / view.scale} strokeLinecap="round" opacity={0.85} />;
              }
              return null;
            })}

            {/* Polygon vertex indicators: show where the next segment must connect (next-vertex)
                and where the polygon will close back to (start-vertex). */}
            {polyDraft.length > 0 && (() => {
              const start = polyDraft[0].from;
              const next = polyDraft[polyDraft.length - 1].to;
              const sameAsStart = polyDraft[0].pidFrom !== undefined &&
                polyDraft[0].pidFrom === polyDraft[polyDraft.length - 1].pidTo;
              return (
                <g pointerEvents="none">
                  {/* Closure target: hollow ring at start vertex */}
                  <circle cx={start.x} cy={start.y} r={11 / view.scale}
                    fill="none" stroke="#C58A3A" strokeWidth={2 / view.scale}
                    strokeDasharray={`${3/view.scale} ${2/view.scale}`} />
                  {/* Next-connection target: filled saffron disc at the current end (overrides closure ring if same) */}
                  {!sameAsStart && (
                    <circle cx={next.x} cy={next.y} r={9 / view.scale}
                      fill="#C58A3A" stroke="#3A2E1F" strokeWidth={1.5 / view.scale} />
                  )}
                </g>
              );
            })()}

            {/* Rejected polygon tap feedback: shows the segment the user tapped when it didn't
                connect to the polygon's required vertex. Combined with the next-vertex disc, this
                tells the user "you tapped this, but I expected something at that vertex over there". */}
            {polyRejected && (() => {
              if (polyRejected.type === 'lineSeg') {
                return <line x1={polyRejected.a.x} y1={polyRejected.a.y} x2={polyRejected.b.x} y2={polyRejected.b.y}
                  stroke="#8B2E1A" strokeWidth={3.5 / view.scale} strokeLinecap="round" opacity={0.7}
                  pointerEvents="none" />;
              }
              if (polyRejected.type === 'arc') {
                const sx = polyRejected.center.x + polyRejected.radius * Math.cos(polyRejected.ang1);
                const sy = polyRejected.center.y + polyRejected.radius * Math.sin(polyRejected.ang1);
                const ex = polyRejected.center.x + polyRejected.radius * Math.cos(polyRejected.ang2);
                const ey = polyRejected.center.y + polyRejected.radius * Math.sin(polyRejected.ang2);
                let delta = polyRejected.ang2 - polyRejected.ang1; while (delta < 0) delta += 2*Math.PI;
                const largeArc = delta > Math.PI ? 1 : 0;
                return <path d={`M ${sx} ${sy} A ${polyRejected.radius} ${polyRejected.radius} 0 ${largeArc} 1 ${ex} ${ey}`}
                  fill="none" stroke="#8B2E1A" strokeWidth={3.5 / view.scale} strokeLinecap="round" opacity={0.7}
                  pointerEvents="none" />;
              }
              return null;
            })()}

            {/* Draft preview */}
            {draft?.kind === 'line' && (
              <circle cx={draft.p1.x} cy={draft.p1.y} r={5 / view.scale} fill="#C58A3A" />
            )}
            {draft?.kind === 'circle' && draft.refA && (
              <circle cx={draft.refA.x} cy={draft.refA.y} r={5 / view.scale} fill="#C58A3A" />
            )}
            {draft?.kind === 'circle' && draft.refB && (
              <>
                <circle cx={draft.refB.x} cy={draft.refB.y} r={5 / view.scale} fill="#C58A3A" />
                <line x1={draft.refA.x} y1={draft.refA.y} x2={draft.refB.x} y2={draft.refB.y} stroke="#C58A3A" strokeWidth={1.5 / view.scale} strokeDasharray={`${4 / view.scale} ${3 / view.scale}`} opacity={0.7} />
              </>
            )}

            {/* When tool is ink or polygon: show all segments highlighted slightly so user knows what they can tap */}
            {(tool === 'ink' || tool === 'polygon') && Object.keys(lines).map(id => {
              const segs = getLineSegments(lineHits, id);
              return segs.map((s, i) => (
                <line key={`seg-hl-${id}-${i}`} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="#C58A3A" strokeWidth={6 / view.scale} opacity={0.0} />
              ));
            })}

            {/* Edit-mode handles — purely visual; the SVG's pointerdown finds the nearest handle and dispatches drag. */}
            {handles.map((h, i) => (
              <g key={`h-${i}`} style={{ pointerEvents: 'none' }}>
                {/* Optional tether: dashed line from rotation handle back to its pivot. */}
                {h.showTether && h.kind === 'rotate' && h.pivot && (
                  <line x1={h.pivot.x} y1={h.pivot.y} x2={h.x} y2={h.y}
                    stroke="#9C8A6A" strokeWidth={1 / view.scale} strokeDasharray={`${3/view.scale} ${3/view.scale}`} />
                )}
                <circle cx={h.x} cy={h.y} r={HANDLE_R / view.scale} fill="#F1E9D6" stroke="#3A2E1F" strokeWidth={1.5 / view.scale} />
                {h.kind === 'rotate' && <circle cx={h.x} cy={h.y} r={(HANDLE_R - 6) / view.scale} fill="#3A2E1F" />}
                {h.kind === 'lengthen' && <line x1={h.x - 5/view.scale} y1={h.y} x2={h.x + 5/view.scale} y2={h.y} stroke="#3A2E1F" strokeWidth={2 / view.scale} />}
                {h.kind === 'lengthen' && <line x1={h.x} y1={h.y - 5/view.scale} x2={h.x} y2={h.y + 5/view.scale} stroke="#3A2E1F" strokeWidth={2 / view.scale} />}
                {h.kind === 'radius' && <circle cx={h.x} cy={h.y} r={(HANDLE_R - 8) / view.scale} fill="#3A2E1F" />}
                {h.kind === 'center' && <text x={h.x} y={h.y + 4/view.scale} textAnchor="middle" fontSize={12/view.scale} fill="#3A2E1F">+</text>}
              </g>
            ))}

            {/* Snap point markers — render AFTER handles. Tap-able: tapping a marker starts a new draft from the exact intersection.
                Markers also highlight when they're the selected anchor of an in-progress draft. */}
            {showSnapButtons && (() => {
              const targets = computeSnapTargets();
              const shown = [];
              for (const p of targets.points) {
                if (!shown.some(q => dist(q, p) < 1 / view.scale)) shown.push(p);
              }
              const isAnchor = (markerPos) => {
                const tol = 1 / view.scale;
                if (draft?.kind === 'line' && draft.p1 && dist(markerPos, draft.p1) < tol) return true;
                if (draft?.kind === 'circle') {
                  if (draft.refA && dist(markerPos, draft.refA) < tol) return true;
                  if (draft.refB && dist(markerPos, draft.refB) < tol) return true;
                }
                return false;
              };
              return shown.map((p, i) => {
                const sel = isAnchor(p);
                return (
                  <circle
                    key={`sp-${i}`}
                    cx={p.x} cy={p.y}
                    r={(sel ? 10 : 7) / view.scale}
                    fill={sel ? '#C58A3A' : '#F1E9D6'}
                    stroke="#3A2E1F"
                    strokeWidth={(sel ? 2.5 : 1.2) / view.scale}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      const pos = getEventPos(e);
                      const worldP = screenToWorld(pos.x, pos.y);
                      // Defer to handle drag if any edit handle is closer than this marker.
                      // Markers are small (7-10 world units) and many sit on top of handles
                      // (which have 36-unit hit radius), so without this check the marker would
                      // intercept taps the user intended for a handle just-created lines'
                      // editing handles, in particular).
                      if (handles.length > 0) {
                        const hitRadiusWorld = (HANDLE_R + HANDLE_HIT_PAD) / view.scale;
                        const distToMarker = dist(worldP, p);
                        let nearestHandleD = Infinity;
                        for (const h of handles) {
                          const d = dist(worldP, h);
                          if (d < nearestHandleD) nearestHandleD = d;
                        }
                        if (nearestHandleD < hitRadiusWorld && nearestHandleD <= distToMarker) {
                          // Don't stopPropagation — let the SVG's nearest-handle handler catch it.
                          return;
                        }
                      }
                      e.stopPropagation();
                      e.target.setPointerCapture?.(e.pointerId);
                      ptrState.current.pointers.set(e.pointerId, {
                        ...pos, downAt: Date.now(), moved: false, startScreen: pos,
                        startWorld: { x: p.x, y: p.y },
                      });
                      ptrState.current.action = { kind: 'pan', startScreen: pos, startView: { ...view } };
                    }}
                  />
                );
              });
            })()}

            {/* Snap indicator */}
            {snapIndicator && (
              <g>
                <circle cx={snapIndicator.x} cy={snapIndicator.y} r={10 / view.scale} fill="none" stroke="#C58A3A" strokeWidth={2 / view.scale} />
                <circle cx={snapIndicator.x} cy={snapIndicator.y} r={3 / view.scale} fill="#C58A3A" />
              </g>
            )}
          </g>
        </svg>

        {/* Inventory tab */}
        <button
          onClick={() => setSheetOpen(s => !s)}
          className="absolute bottom-0 left-0 right-0 py-2 text-center text-sm"
          style={{
            background: '#3A2E1F',
            color: '#F1E9D6',
            letterSpacing: '0.1em',
            transform: sheetOpen ? `translateY(-${Math.min(280, containerSize.h * 0.5)}px)` : 'translateY(0)',
            transition: 'transform 0.2s ease-out',
            zIndex: 10,
          }}
        >
          INVENTORY ({tiles.length}) {sheetOpen ? '▼' : '▲'}
        </button>

        {/* Bottom sheet */}
        <div
          className="absolute bottom-0 left-0 right-0 overflow-hidden"
          style={{
            background: '#E5DAC0',
            borderTop: '1px solid #3A2E1F',
            height: sheetOpen ? Math.min(280, containerSize.h * 0.5) : 0,
            transition: 'height 0.2s ease-out',
          }}
        >
          <div className="overflow-x-auto overflow-y-hidden h-full p-3 flex gap-3">
            {tiles.length === 0 && (
              <div className="text-sm w-full self-center text-center" style={{ color: '#5C4A33', fontStyle: 'italic' }}>
                Construct a polygon to add tiles. Use the Polygon tool and tap segments forming a closed cycle.
              </div>
            )}
            {tiles.map(tile => (
              <TilePreview
                key={tile.id}
                tile={tile}
                onUse={() => {
                  pushUndo();
                  // place at canvas center
                  const center = screenToWorld(containerSize.w / 2, containerSize.h / 2);
                  const newPlaced = { id: newId(), tileId: tile.id, position: center, rotation: 0, flipped: false };
                  setPlaced(P => [...P, newPlaced]);
                  setEditing({ kind: 'placedTile', id: newPlaced.id });
                  setTool('select');
                  setSheetOpen(false);
                }}
                onDelete={() => deleteTile(tile.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ======================== TILE PATH GENERATION ========================
function tilePathD(tile) {
  if (!tile.vertices || tile.vertices.length === 0) return '';
  let d = `M ${tile.vertices[0].x} ${tile.vertices[0].y}`;
  for (let i = 0; i < tile.edges.length; i++) {
    const e = tile.edges[i];
    const target = tile.vertices[e.to];
    if (e.type === 'line') {
      d += ` L ${target.x} ${target.y}`;
    } else if (e.type === 'arc') {
      // sweepCCW indicates whether to traverse the arc in the CCW direction (math sense, ang1 -> ang2 increasing)
      // SVG sweep-flag=1 corresponds to CCW math direction with our y-down coord system.
      let delta = e.toAngle - e.fromAngle;
      while (delta < -Math.PI * 2 + 1e-9) delta += 2 * Math.PI;
      while (delta > Math.PI * 2 - 1e-9) delta -= 2 * Math.PI;
      let largeArc, sweepFlag;
      if (e.sweepCCW !== false) {
        // forward CCW: signed delta should be in (0, 2pi)
        let d2 = delta; while (d2 < 0) d2 += 2 * Math.PI;
        largeArc = d2 > Math.PI ? 1 : 0;
        sweepFlag = 1;
      } else {
        // reverse CW
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

// ======================== TILE PREVIEW ========================
function TilePreview({ tile, onUse, onDelete }) {
  // compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of tile.vertices) {
    if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y;
  }
  const pad = 6;
  const w = maxX - minX + 2 * pad;
  const h = maxY - minY + 2 * pad;
  const size = 100;
  return (
    <div className="flex flex-col items-center" style={{ minWidth: '110px' }}>
      <div
        onClick={onUse}
        className="cursor-pointer rounded"
        style={{ background: '#F1E9D6', border: '1px solid #3A2E1F', padding: '4px' }}
      >
        <svg width={size} height={size} viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}>
          <path d={tilePathD(tile)} fill="rgba(225,200,150,0.4)" stroke="#3A2E1F" strokeWidth={Math.max(w, h) / 60} />
          {tile.inks.map((ink, i) => {
            if (ink.type === 'line') return <line key={i} x1={ink.a.x} y1={ink.a.y} x2={ink.b.x} y2={ink.b.y} stroke="#1B1B1B" strokeWidth={Math.max(w, h) / 50} strokeLinecap="round" />;
            if (ink.type === 'arc') {
              let d2 = ink.ang2 - ink.ang1; while (d2 < 0) d2 += 2*Math.PI;
              const largeArc = d2 > Math.PI ? 1 : 0;
              const sx = ink.center.x + ink.radius * Math.cos(ink.ang1);
              const sy = ink.center.y + ink.radius * Math.sin(ink.ang1);
              const ex = ink.center.x + ink.radius * Math.cos(ink.ang2);
              const ey = ink.center.y + ink.radius * Math.sin(ink.ang2);
              return <path key={i} d={`M ${sx} ${sy} A ${ink.radius} ${ink.radius} 0 ${largeArc} 1 ${ex} ${ey}`} fill="none" stroke="#1B1B1B" strokeWidth={Math.max(w, h) / 50} strokeLinecap="round" />;
            }
            if (ink.type === 'wholeCircle') return <circle key={i} cx={ink.center.x} cy={ink.center.y} r={ink.radius} fill="none" stroke="#1B1B1B" strokeWidth={Math.max(w, h) / 50} />;
            return null;
          })}
        </svg>
      </div>
      <button onClick={onDelete} className="text-xs mt-1" style={{ color: '#8B2E1A' }}>delete</button>
    </div>
  );
}
