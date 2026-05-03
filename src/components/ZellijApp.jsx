import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

import {
  SNAP_PX, HANDLE_R, HANDLE_HIT_PAD, TAP_PX, EPS,
  ROTATION_STEPS_DEG, DEFAULT_ROTATION_STEP_IDX,
  DEFAULT_COLOR,
} from '../constants.js';

import {
  dist, sub, add, lerp, angBetween, normAng, rot,
} from '../geometry/vec.js';
import { projOnSeg, projOnCircle, isAngleBetween, pointInPoly } from '../geometry/project.js';
import { computeIntersections, getLineSegments, getCircleArcs, pidForPoint } from '../geometry/intersections.js';
import { arcPathCCW } from '../geometry/arc.js';
import { clipLineByPolygon, clipArcByPolygon, clipWholeCircleByPolygon } from '../geometry/clip.js';
import { intersectShapes } from '../geometry/shapeIntersect.js';
import { shapesEqual } from '../geometry/shapeEqual.js';
import { buildFaces, faceContains, faceToPath, signedArea } from '../geometry/planar.js';
import { newId } from '../geometry/id.js';

import { tilePathD, tilePathDWorld } from '../tiles/tilePath.js';
import { transformPoint, transformShape, translateShape, edgeToShape } from '../tiles/transform.js';

import { COLOR, FONT_STACK } from '../theme.js';

import { useDocument } from '../hooks/useDocument.js';
import { useContainerSize } from '../hooks/useContainerSize.js';

import Toolbar from './Toolbar.jsx';
import StatusBar from './StatusBar.jsx';
import Inventory from './Inventory.jsx';

export default function ZellijApp() {
  // ============================ STATE ============================
  const {
    lines, setLines,
    circles, setCircles,
    inks, setInks,
    tiles, setTiles,
    placed, setPlaced,
    colors, setColors,
    pushUndo, undo, redo, canUndo, canRedo,
  } = useDocument();

  const [tool, setTool] = useState('line');
  const [editing, setEditing] = useState(null);          // {kind, id} or null
  const [draft, setDraft] = useState(null);              // in-progress line/circle
  const [polyDraft, setPolyDraft] = useState([]);        // edges of in-progress polygon
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [showCons, setShowCons] = useState(true);
  const [snapIndicator, setSnapIndicator] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Currently selected fill colour (null = eraser). Persists across tool
  // switches so the user doesn't lose their colour when, say, popping into
  // Select to nudge a tile and back into Fill.
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLOR);

  // Rotation step grid for placed tiles. Cycles through symmetry-friendly increments.
  const [rotationStepIdx, setRotationStepIdx] = useState(DEFAULT_ROTATION_STEP_IDX);
  const rotationStepDeg = ROTATION_STEPS_DEG[rotationStepIdx];
  const rotationStepRad = rotationStepDeg * Math.PI / 180;
  const cycleRotationStep = () => setRotationStepIdx((i) => (i + 1) % ROTATION_STEPS_DEG.length);

  // Brief auto-clearing UI flags
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 2500);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const [polyRejected, setPolyRejected] = useState(null);
  useEffect(() => {
    if (!polyRejected) return;
    const t = setTimeout(() => setPolyRejected(null), 1500);
    return () => clearTimeout(t);
  }, [polyRejected]);

  const svgRef = useRef(null);
  const ptrState = useRef({ pointers: new Map(), action: null });
  const [containerRef, containerSize] = useContainerSize();

  // True while a handle drag is in flight. Heavy memos (planar faces, tile
  // intersection snap points) short-circuit to a cached previous result while
  // this is set, since recomputing them on every drag frame is what's
  // pinning the CPU on complex designs. The drag itself still moves the
  // light visuals — silhouette wash, un-inked edges, inks — by re-running
  // their cheap memos.
  const [isDragging, setIsDragging] = useState(false);
  const cachedFacesRef = useRef([]);
  const cachedTileIntersRef = useRef([]);

  const { lineHits, circleHits, intersections } = useMemo(
    () => computeIntersections(lines, circles),
    [lines, circles],
  );

  // ============================ COORD CONVERSIONS ============================
  const screenToWorld = useCallback(
    (sx, sy) => ({ x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale }),
    [view],
  );

  // Multiply scale by `factor` while keeping the world point currently under the
  // screen-space (cx, cy) cursor pinned to that same screen point. Used by the
  // wheel handler and keyboard zoom; pinch zoom uses its own math because its
  // anchor moves with the gesture.
  const zoomAt = useCallback((cx, cy, factor) => {
    setView((v) => {
      const newScale = Math.max(0.001, v.scale * factor);
      const worldX = (cx - v.tx) / v.scale;
      const worldY = (cy - v.ty) / v.scale;
      return { scale: newScale, tx: cx - worldX * newScale, ty: cy - worldY * newScale };
    });
  }, []);

  // ============================ INK GRAPH (for fills) ============================
  // Every visible ink in world coords, as stroked-shapes. Inputs to the planar
  // face finder: any ink that bounds a coloured region needs to be in here.
  const globalInkShapes = useMemo(() => {
    const out = [];
    // Canvas inks are stored line/circle-relative; resolve to world geometry.
    for (const ink of inks) {
      if (ink.type === 'lineSeg') {
        const L = lines[ink.lineId];
        if (!L) continue;
        out.push({ type: 'line', a: lerp(L.p1, L.p2, ink.t1), b: lerp(L.p1, L.p2, ink.t2) });
      } else if (ink.type === 'arc') {
        const C = circles[ink.circleId];
        if (!C) continue;
        out.push({ type: 'arc', center: C.center, radius: C.radius, ang1: ink.ang1, ang2: ink.ang2 });
      } else if (ink.type === 'wholeCircle') {
        const C = circles[ink.circleId];
        if (!C) continue;
        out.push({ type: 'wholeCircle', center: C.center, radius: C.radius });
      }
    }
    // Placed-tile inks (already stored as stroked-shapes in tile-local coords).
    for (const pt of placed) {
      const tile = tiles.find((t) => t.id === pt.tileId);
      if (!tile) continue;
      for (const ink of tile.inks || []) out.push(transformShape(ink, pt));
    }
    return out;
  }, [inks, lines, circles, placed, tiles]);

  // Every placed tile's silhouette concatenated into a single SVG path string,
  // in world coords. Rendered as one <path> so the union has no internal
  // antialiasing seams — adjacent tiles meeting along an edge merge cleanly
  // instead of leaving a visible hairline. Used to lay the soft tan tint over
  // the colour fills without breaking the wash with seams.
  const combinedSilhouettePath = useMemo(() => {
    if (placed.length === 0) return '';
    const parts = [];
    for (const pt of placed) {
      const tile = tiles.find((t) => t.id === pt.tileId);
      if (!tile) continue;
      parts.push(tilePathDWorld(tile, pt));
    }
    return parts.join(' ');
  }, [placed, tiles]);

  // Un-inked tile edges that coincide with another placed tile's un-inked edge
  // (in world coords) shouldn't render — the two faint strokes would just draw
  // on top of each other at the seam between adjacent tiles. We only suppress
  // un-inked seams; an inked edge always renders bold regardless of whether
  // its neighbour also inked the shared edge.
  //
  // Keyed by `${placedId}:${edgeIdx}` so the per-tile render can quickly check
  // whether to skip a given edge.
  const sharedEdgeKeys = useMemo(() => {
    if (placed.length < 2) return new Set();
    const all = []; // [{ key, worldShape }]
    for (const pt of placed) {
      const tile = tiles.find((t) => t.id === pt.tileId);
      if (!tile) continue;
      for (let i = 0; i < tile.edges.length; i++) {
        const localShape = edgeToShape(tile.edges[i], tile.vertices);
        if (!localShape) continue;
        if ((tile.inks || []).some((ink) => shapesEqual(localShape, ink))) continue;
        all.push({ key: `${pt.id}:${i}`, worldShape: transformShape(localShape, pt) });
      }
    }
    const shared = new Set();
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (shapesEqual(all[i].worldShape, all[j].worldShape)) {
          shared.add(all[i].key);
          shared.add(all[j].key);
        }
      }
    }
    return shared;
  }, [placed, tiles]);

  // The bounded faces of the ink graph. Sorted by area ascending so a tap can
  // pick the smallest containing face (most specific region). The graph build
  // is O(N²) in ink count for the intersection step — fast enough at rest,
  // but bottlenecks the frame budget if it runs on every drag tick. While a
  // handle is being dragged, return the cached previous value; recompute
  // once when the drag ends.
  const planarFaces = useMemo(() => {
    if (isDragging) return cachedFacesRef.current;
    const { faces, vertices } = buildFaces(globalInkShapes);
    const withArea = faces.map((face) => ({ face, vertices, area: signedArea(face, vertices) }));
    withArea.sort((a, b) => a.area - b.area);
    cachedFacesRef.current = withArea;
    return withArea;
  }, [globalInkShapes, isDragging]);

  // For each persisted colour point, find the smallest face containing it and
  // emit { d, color } for rendering. Stable across edits because colours are
  // anchored to a point in world space, not to a face identifier.
  const coloredFaces = useMemo(() => {
    if (planarFaces.length === 0) return [];
    const out = [];
    for (const c of colors) {
      const hit = planarFaces.find(({ face, vertices }) => faceContains(face, vertices, c));
      if (!hit) continue;
      out.push({ d: faceToPath(hit.face, hit.vertices), color: c.color });
    }
    return out;
  }, [planarFaces, colors]);

  // ============================ SNAPPING ============================
  // Tile-internal intersections (and crossings of tile content with canvas
  // construction). Memoised because computeSnapTargets is hot — called on every
  // pointer move during a drag — and this loop is O(tile-shapes²). Same
  // drag-cache trick as planarFaces: while a drag is in flight the snap
  // points the user could possibly want are the *other* tiles' (which haven't
  // moved), so the cached pre-drag set is semantically correct anyway.
  const tileIntersectionPoints = useMemo(() => {
    if (isDragging) return cachedTileIntersRef.current;
    if (placed.length === 0) return [];
    const out = [];
    const canvasShapes = [
      ...Object.values(lines).map((l) => ({ type: 'line', a: l.p1, b: l.p2 })),
      ...Object.values(circles).map((c) => ({ type: 'wholeCircle', center: c.center, radius: c.radius })),
    ];
    for (const pt of placed) {
      const tile = tiles.find((t) => t.id === pt.tileId);
      if (!tile) continue;
      // Each visible stroke as a world-space shape: boundary edges (whether
      // currently inked or not), plus interior inks, plus faint construction.
      // Listing edges *and* inks may double-count boundary intersections when
      // an edge is inked (its matching shape lives in inks too) — but
      // intersectShapes returns nothing for coincident shapes, so the practical
      // result is just a few wasted comparisons, not spurious snap points.
      const tileShapes = [
        ...(tile.edges || []).map((e) => edgeToShape(e, tile.vertices)).filter(Boolean),
        ...(tile.inks || []),
        ...(tile.construction || []),
      ].map((s) => transformShape(s, pt));
      // Pairwise within this placed tile.
      for (let i = 0; i < tileShapes.length; i++) {
        for (let j = i + 1; j < tileShapes.length; j++) {
          for (const p of intersectShapes(tileShapes[i], tileShapes[j])) {
            out.push({ x: p.x, y: p.y, kind: 'tile-intersection' });
          }
        }
      }
      // Each tile shape vs every canvas shape.
      for (const ts of tileShapes) {
        for (const cs of canvasShapes) {
          for (const p of intersectShapes(ts, cs)) {
            out.push({ x: p.x, y: p.y, kind: 'tile-intersection' });
          }
        }
      }
    }
    cachedTileIntersRef.current = out;
    return out;
  }, [placed, tiles, lines, circles, isDragging]);

  // Returns: { points: [{x,y, kind}], lines1D: [...], circles1D: [...] }
  const computeSnapTargets = useCallback(() => {
    const points = [];
    for (const p of intersections) points.push({ x: p.x, y: p.y, kind: 'intersection' });
    for (const id in lines) {
      points.push({ x: lines[id].p1.x, y: lines[id].p1.y, kind: 'endpoint' });
      points.push({ x: lines[id].p2.x, y: lines[id].p2.y, kind: 'endpoint' });
    }
    for (const id in circles) {
      points.push({ x: circles[id].center.x, y: circles[id].center.y, kind: 'center' });
      const rPt = circles[id].radiusPt;
      if (rPt) points.push({ x: rPt.x, y: rPt.y, kind: 'radius-point' });
    }
    // Placed-tile vertices, tagged with placedId so a tile can't snap to itself.
    for (const pt of placed) {
      const tile = tiles.find((t) => t.id === pt.tileId);
      if (!tile) continue;
      for (const v of tile.vertices) {
        const w = transformPoint(v, pt);
        points.push({ x: w.x, y: w.y, kind: 'tile-vertex', placedId: pt.id });
      }
    }
    // Crossings of tile-interior strokes (with each other and with canvas).
    for (const p of tileIntersectionPoints) points.push(p);
    return {
      points,
      lines1D: Object.entries(lines).map(([id, l]) => ({ id, ...l })),
      circles1D: Object.entries(circles).map(([id, c]) => ({ id, ...c })),
    };
  }, [intersections, lines, circles, placed, tiles, tileIntersectionPoints]);

  // Find the best snap for a world-coord point. Priority: 0D points > 1D lines/circles > free.
  const trySnap = useCallback((worldP, opts = {}) => {
    const radiusWorld = SNAP_PX / view.scale;
    const targets = computeSnapTargets();
    let best = null;
    for (const t of targets.points) {
      const d = dist(worldP, t);
      if (d < radiusWorld && (!best || d < best.dist)) {
        best = { x: t.x, y: t.y, dist: d, kind: t.kind };
      }
    }
    if (best) return best;
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

  // ============================ POINTER HANDLING ============================
  const getEventPos = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
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
      // Keep the original world-space pinch center anchored under the new finger midpoint.
      const worldCenter = {
        x: (a.startCenter.x - a.startView.tx) / a.startView.scale,
        y: (a.startCenter.y - a.startView.ty) / a.startView.scale,
      };
      const tx = newCx - worldCenter.x * newScale;
      const ty = newCy - worldCenter.y * newScale;
      setView({ tx, ty, scale: newScale });
      return;
    }

    if (ptrState.current.action?.kind === 'pan') {
      const a = ptrState.current.action;
      setView((v) => ({ ...v, tx: a.startView.tx + (pos.x - a.startScreen.x), ty: a.startView.ty + (pos.y - a.startScreen.y) }));
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
      ptrState.current.action.handle.onEnd?.();
      ptrState.current.action = null;
      setSnapIndicator(null);
      setIsDragging(false); // unfreezes the heavy memos for one final recompute
      return;
    }
    if (ptrState.current.action?.kind === 'placeTile') {
      ptrState.current.action.onEnd?.();
      ptrState.current.action = null;
      setSnapIndicator(null);
      return;
    }
    if (!wasMoved) handleTap(startWorld);
  };

  // ============================ TAP HANDLING ============================
  const handleTap = (worldP) => {
    if (tool === 'line') return tapLine(worldP);
    if (tool === 'circle') return tapCircle(worldP);
    if (tool === 'select') return tapSelect(worldP);
    if (tool === 'ink') return handleInkTap(worldP);
    if (tool === 'polygon') return handlePolygonTap(worldP);
    if (tool === 'fill') return handleFillTap(worldP);
  };

  const tapLine = (worldP) => {
    const snapped = trySnap(worldP);
    if (!draft) {
      if (editing) setEditing(null);
      setDraft({ kind: 'line', p1: { x: snapped.x, y: snapped.y } });
      return;
    }
    if (draft.kind === 'line') {
      const p2 = { x: snapped.x, y: snapped.y };
      if (dist(draft.p1, p2) < 1 / view.scale) { setDraft(null); return; }
      pushUndo();
      const id = newId();
      setLines((L) => ({ ...L, [id]: { p1: draft.p1, p2 } }));
      setDraft(null);
      setEditing({ kind: 'line', id });
    }
  };

  const tapCircle = (worldP) => {
    const snapped = trySnap(worldP);
    if (!draft || draft.kind !== 'circle') {
      if (editing) setEditing(null);
      setDraft({ kind: 'circle', step: 'measureA', refA: { x: snapped.x, y: snapped.y } });
      return;
    }
    if (draft.step === 'measureA') {
      const r = dist(draft.refA, snapped);
      if (r < 1 / view.scale) { setDraft(null); return; }
      setDraft({ kind: 'circle', step: 'placing', radius: r, refA: draft.refA, refB: { x: snapped.x, y: snapped.y } });
      return;
    }
    if (draft.step === 'placing') {
      // Stamp a circle with the measured radius at the tapped center.
      pushUndo();
      const id = newId();
      const radius = draft.radius;
      const center = { x: snapped.x, y: snapped.y };
      const radiusPt = { x: center.x + radius, y: center.y };
      setCircles((C) => ({ ...C, [id]: { center, radius, radiusPt } }));
      // Stay in 'placing' to stamp more circles with the same radius.
    }
  };

  const tapSelect = (worldP) => {
    const hit = hitTestEditable(worldP);
    setEditing(hit || null);
  };

  // ============================ HIT TESTING ============================
  const hitTestEditable = (w) => {
    const tolWorld = TAP_PX / view.scale;
    // Topmost first: placed tiles, then lines, then circles.
    for (let i = placed.length - 1; i >= 0; i--) {
      if (pointInPlacedTile(w, placed[i])) return { kind: 'placedTile', id: placed[i].id };
    }
    for (const id in lines) {
      const proj = projOnSeg(w, lines[id].p1, lines[id].p2);
      if (proj.dist < tolWorld) return { kind: 'line', id };
    }
    for (const id in circles) {
      const C = circles[id];
      const proj = projOnCircle(w, C.center, C.radius);
      if (proj.dist < tolWorld) return { kind: 'circle', id };
    }
    return null;
  };

  const pointInPlacedTile = (w, pt) => {
    const tile = tiles.find((t) => t.id === pt.tileId);
    if (!tile) return false;
    let local = sub(w, pt.position);
    local = rot(local, -pt.rotation);
    if (pt.flipped) local = { x: -local.x, y: local.y };
    return pointInPoly(local, tile.vertices);
  };

  // Closest sub-segment / arc / whole circle to a world-coord point.
  const findSegmentAt = (w) => {
    const tolWorld = TAP_PX / view.scale;
    let best = null;
    for (const id in lines) {
      const segs = getLineSegments(lineHits, id);
      for (const seg of segs) {
        const p = projOnSeg(w, seg.a, seg.b);
        if (p.dist < tolWorld && (!best || p.dist < best.dist)) {
          best = {
            type: 'lineSeg', lineId: id, t1: seg.t1, t2: seg.t2,
            dist: p.dist, a: seg.a, b: seg.b,
            pidA: seg.pidA, pidB: seg.pidB,
          };
        }
      }
    }
    for (const id in circles) {
      const C = circles[id];
      const arcs = getCircleArcs(circleHits, id, C);
      if (arcs.length === 0) {
        const p = projOnCircle(w, C.center, C.radius);
        if (p.dist < tolWorld && (!best || p.dist < best.dist)) {
          best = { type: 'wholeCircle', circleId: id, dist: p.dist };
        }
      } else {
        for (const arc of arcs) {
          const p = projOnCircle(w, C.center, C.radius);
          if (p.dist < tolWorld) {
            const inArc = isAngleBetween(p.angle, arc.ang1, arc.ang2);
            if (inArc && (!best || p.dist < best.dist)) {
              best = {
                type: 'arc', circleId: id,
                ang1: arc.ang1, ang2: arc.ang2,
                center: C.center, radius: C.radius,
                dist: p.dist, a: arc.a, b: arc.b,
                pidA: arc.pidA, pidB: arc.pidB,
              };
            }
          }
        }
      }
    }
    // Placed-tile edges. Treated as polygon-eligible segments with the same
    // shape as canvas sub-segments; lineId/circleId are absent (these don't
    // belong to any canvas line/circle), but pidA/pidB are position-based so
    // they connect to canvas pids automatically wherever world points coincide.
    // (placedId, edgeIdx) lets the ink tool find the inventory tile to mutate.
    for (const pt of placed) {
      const tile = tiles.find((t) => t.id === pt.tileId);
      if (!tile) continue;
      for (let i = 0; i < tile.edges.length; i++) {
        const e = tile.edges[i];
        if (e.type === 'line') {
          const a = transformPoint(tile.vertices[e.from], pt);
          const b = transformPoint(tile.vertices[e.to],   pt);
          const p = projOnSeg(w, a, b);
          if (p.dist < tolWorld && (!best || p.dist < best.dist)) {
            best = {
              type: 'lineSeg', a, b,
              dist: p.dist,
              pidA: pidForPoint(a), pidB: pidForPoint(b),
              placedId: pt.id, edgeIdx: i,
            };
          }
        } else if (e.type === 'arc') {
          const arc = transformShape(edgeToShape(e, tile.vertices), pt);
          const p = projOnCircle(w, arc.center, arc.radius);
          if (p.dist < tolWorld && isAngleBetween(p.angle, arc.ang1, arc.ang2)) {
            if (!best || p.dist < best.dist) {
              const a = { x: arc.center.x + arc.radius * Math.cos(arc.ang1), y: arc.center.y + arc.radius * Math.sin(arc.ang1) };
              const b = { x: arc.center.x + arc.radius * Math.cos(arc.ang2), y: arc.center.y + arc.radius * Math.sin(arc.ang2) };
              best = {
                type: 'arc',
                center: arc.center, radius: arc.radius,
                ang1: arc.ang1, ang2: arc.ang2,
                a, b,
                dist: p.dist,
                pidA: pidForPoint(a), pidB: pidForPoint(b),
                placedId: pt.id, edgeIdx: i,
              };
            }
          }
        }
      }
    }
    return best;
  };

  // ============================ INK TOOL ============================
  const handleInkTap = (w) => {
    const seg = findSegmentAt(w);
    if (!seg) return;
    // Tile-edge taps toggle the boundary ink on the underlying inventory tile.
    // Tile is shared across all its placements, so toggling here updates every
    // placement of that tile in lockstep — same idea as a Symbol in a vector
    // editor.
    if (seg.placedId !== undefined) {
      toggleTileEdgeInk(seg);
      return;
    }
    pushUndo();
    if (seg.type === 'lineSeg') {
      const idx = inks.findIndex(
        (k) => k.type === 'lineSeg' && k.lineId === seg.lineId &&
          Math.abs(k.t1 - seg.t1) < EPS * 10 && Math.abs(k.t2 - seg.t2) < EPS * 10,
      );
      if (idx >= 0) setInks((I) => I.filter((_, i) => i !== idx));
      else setInks((I) => [...I, { type: 'lineSeg', lineId: seg.lineId, t1: seg.t1, t2: seg.t2 }]);
    } else if (seg.type === 'arc') {
      const idx = inks.findIndex(
        (k) => k.type === 'arc' && k.circleId === seg.circleId &&
          Math.abs(k.ang1 - seg.ang1) < EPS * 10 && Math.abs(k.ang2 - seg.ang2) < EPS * 10,
      );
      if (idx >= 0) setInks((I) => I.filter((_, i) => i !== idx));
      else setInks((I) => [...I, { type: 'arc', circleId: seg.circleId, ang1: seg.ang1, ang2: seg.ang2 }]);
    } else if (seg.type === 'wholeCircle') {
      const idx = inks.findIndex((k) => k.type === 'wholeCircle' && k.circleId === seg.circleId);
      if (idx >= 0) setInks((I) => I.filter((_, i) => i !== idx));
      else setInks((I) => [...I, { type: 'wholeCircle', circleId: seg.circleId }]);
    }
  };

  // Toggle the bold/non-bold state of an edge on a placed tile. The state
  // lives implicitly: an edge is "inked" iff a matching shape is in
  // tile.inks. Tap with ink → if matching ink exists, remove (un-ink);
  // otherwise add (re-ink). Mutates the inventory tile, so every placement
  // of that tile updates together.
  const toggleTileEdgeInk = (seg) => {
    const pt = placed.find((p) => p.id === seg.placedId);
    if (!pt) return;
    const tile = tiles.find((t) => t.id === pt.tileId);
    if (!tile) return;
    const edge = tile.edges[seg.edgeIdx];
    if (!edge) return;
    const edgeShape = edgeToShape(edge, tile.vertices);
    if (!edgeShape) return;
    pushUndo();
    setTiles((T) => T.map((t) => {
      if (t.id !== tile.id) return t;
      const matchIdx = (t.inks || []).findIndex((ink) => shapesEqual(edgeShape, ink));
      if (matchIdx >= 0) {
        return { ...t, inks: t.inks.filter((_, i) => i !== matchIdx) };
      }
      return { ...t, inks: [...(t.inks || []), edgeShape] };
    }));
  };

  // ============================ FILL TOOL ============================
  // Tap inside a region to apply the currently-selected palette colour. The
  // region is the smallest face whose chord-polygon contains the tap; any
  // existing colour anchor inside that face is replaced (or removed, if the
  // selected colour is null — eraser). New colour anchors are stored at the
  // tap point itself, so the colour stays attached to a place in the design
  // even as inks move and faces rebuild around it.
  const handleFillTap = (worldP) => {
    const hit = planarFaces.find(({ face, vertices }) => faceContains(face, vertices, worldP));
    if (!hit) return;
    pushUndo();
    const { face, vertices } = hit;
    const remaining = colors.filter((c) => !faceContains(face, vertices, c));
    if (selectedColor) {
      remaining.push({ x: worldP.x, y: worldP.y, color: selectedColor });
    }
    setColors(remaining);
  };

  // ============================ POLYGON TOOL ============================
  const handlePolygonTap = (w) => {
    const seg = findSegmentAt(w);
    if (!seg) return;
    if (seg.type === 'wholeCircle') return; // can't be a polygon edge

    // Tapping a segment already in the draft truncates back to before it.
    // Equality uses pidA/pidB pair (set), independent of FP precision. The
    // lineId/circleId checks are skipped when an id is missing (tile-edge segs
    // don't carry one) — pid equality is sufficient there.
    const sameSeg = (a, b) => {
      if (a.type !== b.type) return false;
      if (a.type === 'lineSeg' && a.lineId && b.lineId && a.lineId !== b.lineId) return false;
      if (a.type === 'arc' && a.circleId && b.circleId && a.circleId !== b.circleId) return false;
      return (a.pidA === b.pidA && a.pidB === b.pidB) || (a.pidA === b.pidB && a.pidB === b.pidA);
    };
    for (let i = 0; i < polyDraft.length; i++) {
      if (sameSeg(polyDraft[i].seg, seg)) {
        setPolyDraft(polyDraft.slice(0, i));
        return;
      }
    }

    const p1 = seg.a, p2 = seg.b;

    if (polyDraft.length === 0) {
      setPolyDraft([{ seg, from: p1, to: p2, forward: true, pidFrom: seg.pidA, pidTo: seg.pidB }]);
      return;
    }

    const last = polyDraft[polyDraft.length - 1];
    let nextFrom, nextTo, nextForward, nextPidFrom, nextPidTo;
    let needFirstReverse = false;
    // pid-based connectivity: two segments share an endpoint iff their canonical-point IDs match.
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
      return;
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

  // Promote the closed cycle into a tile. The new tile bundles, in tile-local coords:
  //   - vertices/edges (boundary topology — used for tilePathD shape and hit tests)
  //   - inks: every visible stroke. Includes one ink per boundary edge (the boundary
  //           IS an inked construction line), every canvas ink inside the polygon,
  //           and the inks of any placed tile whose centroid was inside (flattened).
  //   - construction: faint scaffold sub-segments inside, properly clipped at the
  //           polygon boundary so they don't bleed past the new tile's outline.
  // Placed tiles whose centroid lies inside the polygon are baked into the new tile
  // and removed from the canvas (snapshot semantics, no nested data structure).
  // True if the cycle entry's source segment is currently inked. For canvas
  // segs we look it up in the canvas inks list by lineId/circleId + parameters;
  // for tile-edge segs we check the constituent inventory tile's inks for a
  // shape match against the edge.
  const isCycleSegInked = (c) => {
    const s = c.seg;
    if (s.placedId !== undefined) {
      const pt = placed.find((p) => p.id === s.placedId);
      const tile = pt && tiles.find((t) => t.id === pt.tileId);
      const e = tile?.edges?.[s.edgeIdx];
      if (!e) return false;
      const shape = edgeToShape(e, tile.vertices);
      return !!shape && (tile.inks || []).some((ink) => shapesEqual(shape, ink));
    }
    if (s.type === 'lineSeg' && s.lineId) {
      return inks.some(
        (k) => k.type === 'lineSeg' && k.lineId === s.lineId
            && Math.abs(k.t1 - s.t1) < EPS * 10
            && Math.abs(k.t2 - s.t2) < EPS * 10,
      );
    }
    if (s.type === 'arc' && s.circleId) {
      return inks.some(
        (k) => k.type === 'arc' && k.circleId === s.circleId
            && Math.abs(k.ang1 - s.ang1) < EPS * 10
            && Math.abs(k.ang2 - s.ang2) < EPS * 10,
      );
    }
    return false;
  };

  const finalizePolygon = (cycle) => {
    pushUndo();

    // ---- 1. Boundary topology + centroid ----
    const vertices = cycle.map((c) => c.from);
    const edges = cycle.map((c, i) => {
      if (c.seg.type === 'lineSeg') {
        return { type: 'line', from: i, to: (i + 1) % cycle.length };
      }
      // Arc edge: sweepCCW=true ⇒ traverse same direction as the original CCW arc.
      const center = c.seg.center, radius = c.seg.radius;
      return {
        type: 'arc', from: i, to: (i + 1) % cycle.length,
        center, radius,
        fromAngle: angBetween(center, c.from),
        toAngle:   angBetween(center, c.to),
        sweepCCW: !!c.forward,
      };
    });

    const cx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length;
    const cy = vertices.reduce((s, v) => s + v.y, 0) / vertices.length;
    const toLocal = (shape) => translateShape(shape, -cx, -cy);
    const polyVerts = vertices;

    // Boundary as stroked-shape edges in WORLD coords — used both for clipping
    // construction/inks and as the source of the boundary inks themselves.
    const polyEdgesWorld = cycle.map((c) => {
      if (c.seg.type === 'lineSeg') return { type: 'line', a: c.from, b: c.to };
      // Arc geometry is the same regardless of c.forward; CCW from seg.ang1 → seg.ang2.
      return { type: 'arc', center: c.seg.center, radius: c.seg.radius, ang1: c.seg.ang1, ang2: c.seg.ang2 };
    });

    // ---- 2. Boundary inks: only edges whose source segment was inked ----
    // The user controls boldness by inking before tracing. Inked construction
    // → bold tile boundary at that edge. Un-inked source → faint tile outline
    // (rendered via the un-inked-edge pass at draw time, no ink record needed).
    const boundaryInks = [];
    for (let i = 0; i < cycle.length; i++) {
      if (!isCycleSegInked(cycle[i])) continue;
      boundaryInks.push(toLocal(polyEdgesWorld[i]));
    }

    // ---- 3. Canvas inks inside the polygon, clipped at boundary ----
    const inksInside = [];
    const captureClipped = (worldShape, sink) => {
      if (worldShape.type === 'line') {
        for (const piece of clipLineByPolygon(worldShape.a, worldShape.b, polyVerts, polyEdgesWorld)) {
          sink.push(toLocal({ type: 'line', a: piece.a, b: piece.b }));
        }
      } else if (worldShape.type === 'arc') {
        const pieces = clipArcByPolygon(worldShape.center, worldShape.radius, worldShape.ang1, worldShape.ang2, polyVerts, polyEdgesWorld);
        for (const p of pieces) {
          sink.push(toLocal({ type: 'arc', center: worldShape.center, radius: worldShape.radius, ang1: p.ang1, ang2: p.ang2 }));
        }
      } else if (worldShape.type === 'wholeCircle') {
        const pieces = clipWholeCircleByPolygon(worldShape.center, worldShape.radius, polyVerts, polyEdgesWorld);
        for (const p of pieces) {
          if (p.type === 'wholeCircle') {
            sink.push(toLocal({ type: 'wholeCircle', center: worldShape.center, radius: worldShape.radius }));
          } else {
            sink.push(toLocal({ type: 'arc', center: worldShape.center, radius: worldShape.radius, ang1: p.ang1, ang2: p.ang2 }));
          }
        }
      }
    };

    // Convert each canvas ink record (lineId-based / circleId-based) into a
    // world-space stroked-shape, then clip + capture.
    for (const ink of inks) {
      if (ink.type === 'lineSeg') {
        const L = lines[ink.lineId];
        if (!L) continue;
        captureClipped({ type: 'line', a: lerp(L.p1, L.p2, ink.t1), b: lerp(L.p1, L.p2, ink.t2) }, inksInside);
      } else if (ink.type === 'arc') {
        const C = circles[ink.circleId];
        if (!C) continue;
        captureClipped({ type: 'arc', center: C.center, radius: C.radius, ang1: ink.ang1, ang2: ink.ang2 }, inksInside);
      } else if (ink.type === 'wholeCircle') {
        const C = circles[ink.circleId];
        if (!C) continue;
        captureClipped({ type: 'wholeCircle', center: C.center, radius: C.radius }, inksInside);
      }
    }

    // ---- 4. Construction sub-segments inside, clipped at boundary ----
    // Without clipping, a sub-segment that straddles the boundary either gets
    // accepted whole (extending past the tile) or rejected whole (a piece that
    // *should* be inside disappears). Clipping keeps every piece's geometry
    // honest and preserves canonical intersection points for sub-segments that
    // share a pid (their endpoints stay fp-exact).
    const constructionInside = [];
    for (const id in lineHits) {
      for (const s of getLineSegments(lineHits, id)) {
        captureClipped({ type: 'line', a: s.a, b: s.b }, constructionInside);
      }
    }
    for (const id in circleHits) {
      const C = circles[id];
      if (!C) continue;
      for (const arc of getCircleArcs(circleHits, id, C)) {
        captureClipped({ type: 'arc', center: C.center, radius: C.radius, ang1: arc.ang1, ang2: arc.ang2 }, constructionInside);
      }
    }
    // Whole-circle construction (no intersections): the clip helper will keep
    // it whole if the centre is inside, or split it into arcs if a polygon
    // edge happens to clip through it.
    for (const id in circles) {
      if ((circleHits[id] || []).length > 0) continue;
      const C = circles[id];
      captureClipped({ type: 'wholeCircle', center: C.center, radius: C.radius }, constructionInside);
    }

    // ---- 5. Flatten placed tiles whose centroid is inside ----
    // A placed tile here is a stamp the user assembled; we *snapshot* its
    // visible content (boundary + inks + construction) into the new tile in
    // local coords. The original placement stays on the canvas — same way
    // construction lines stay when you trace a polygon over them. The user
    // can delete it manually if they want.
    const flattenedInks = [];
    const flattenedCons = [];
    for (const pt of placed) {
      const tile = tiles.find((t) => t.id === pt.tileId);
      if (!tile) continue;
      const centroidWorld = transformPoint({ x: 0, y: 0 }, pt); // tile-local origin = its centroid
      if (!pointInPoly(centroidWorld, polyVerts)) continue;
      // The flattened inks/construction can extend past the polygon if the
      // placed tile only partially overlaps it, so clip them too.
      for (const ink of tile.inks) captureClipped(transformShape(ink, pt), flattenedInks);
      for (const c   of tile.construction) captureClipped(transformShape(c, pt), flattenedCons);
      // Boundary edges of the constituent tile carry into the parent at the
      // same boldness: inked → parent's inks (bold), un-inked → parent's
      // construction (faint). An inked edge already has a matching shape in
      // tile.inks (which we're capturing into flattenedInks above), so adding
      // it again here would double-draw — skip it. Un-inked edges get added
      // as construction so the silhouette is preserved.
      for (const e of tile.edges) {
        const localShape = edgeToShape(e, tile.vertices);
        if (!localShape) continue;
        const isInked = (tile.inks || []).some((ink) => shapesEqual(localShape, ink));
        if (isInked) continue; // already captured via tile.inks above
        captureClipped(transformShape(localShape, pt), flattenedCons);
      }
    }

    // ---- 6. Compose the new tile, update state ----
    const localVerts = vertices.map((v) => ({ x: v.x - cx, y: v.y - cy }));
    const localEdges = edges.map((e) =>
      e.type === 'arc' ? { ...e, center: { x: e.center.x - cx, y: e.center.y - cy } } : e
    );

    setTiles((T) => [...T, {
      id: newId(),
      vertices: localVerts,
      edges: localEdges,
      inks: [...boundaryInks, ...inksInside, ...flattenedInks],
      construction: [...constructionInside, ...flattenedCons],
    }]);
    setSheetOpen(true);
  };

  // Initial center when first loaded
  useEffect(() => {
    if (view.tx === 0 && view.ty === 0 && containerSize.w > 0) {
      setView((v) => ({ ...v, tx: containerSize.w / 2, ty: containerSize.h / 2 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize]);

  // Wheel zoom — anchored at the cursor. Native listener with passive:false so
  // we can preventDefault the page scroll. macOS trackpad pinch arrives as
  // wheel events with ctrlKey set; we use a higher gain in that case so the
  // pinch feels responsive instead of crawling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      // Normalise across deltaMode (Firefox sometimes reports lines/pages).
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= window.innerHeight;
      const k = e.ctrlKey ? 0.02 : 0.0015;
      zoomAt(cx, cy, Math.exp(-dy * k));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ============================ ACTIONS ON EDITING ITEM ============================
  const updateLine   = (id, patch) => setLines((L) => ({ ...L, [id]: { ...L[id], ...patch } }));
  const updateCircle = (id, patch) => setCircles((C) => ({ ...C, [id]: { ...C[id], ...patch } }));

  const deleteLine = (id) => {
    pushUndo();
    setLines((L) => { const N = { ...L }; delete N[id]; return N; });
    setInks((I) => I.filter((k) => !(k.type === 'lineSeg' && k.lineId === id)));
    setEditing(null);
  };
  const deleteCircle = (id) => {
    pushUndo();
    setCircles((C) => { const N = { ...C }; delete N[id]; return N; });
    setInks((I) => I.filter((k) => !((k.type === 'arc' || k.type === 'wholeCircle') && k.circleId === id)));
    setEditing(null);
  };
  const deletePlaced = (id) => {
    pushUndo();
    setPlaced((P) => P.filter((p) => p.id !== id));
    setEditing(null);
  };
  const deleteTile = (id) => {
    pushUndo();
    setTiles((T) => T.filter((t) => t.id !== id));
    setPlaced((P) => P.filter((p) => p.tileId !== id));
  };

  const rotatePlaced = (id, delta) =>
    setPlaced((P) => P.map((p) => p.id === id ? { ...p, rotation: p.rotation + delta } : p));
  const flipPlaced = (id) =>
    setPlaced((P) => P.map((p) => p.id === id ? { ...p, flipped: !p.flipped } : p));
  const resetPlaced = (id) =>
    setPlaced((P) => P.map((p) => p.id === id ? { ...p, rotation: 0, flipped: false } : p));
  const snapPlacedToGrid = (id) => setPlaced((P) => P.map((p) => {
    if (p.id !== id) return p;
    const step = rotationStepRad;
    if (step <= 0) return p;
    return { ...p, rotation: Math.round(p.rotation / step) * step };
  }));

  const recenter = () => setView({ tx: containerSize.w / 2, ty: containerSize.h / 2, scale: view.scale });

  // Cancel any in-flight selection / draft / polygon. Used by tool switches,
  // undo/redo (state was just replaced; old refs are stale), and canvas clear.
  const clearInteraction = () => {
    setEditing(null); setDraft(null); setPolyDraft([]);
  };

  const onClickClear = () => {
    if (confirmClear) {
      pushUndo();
      setLines({}); setCircles({}); setInks([]); setPlaced([]); setColors([]);
      clearInteraction();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
    }
  };

  const undoAction = () => { if (undo()) clearInteraction(); };
  const redoAction = () => { if (redo()) clearInteraction(); };

  // ============================ KEYBOARD SHORTCUTS ============================
  // Ref pattern: the listener attaches once on mount, but reads the latest
  // state/handlers via this ref each keypress. Avoids re-binding the global
  // listener on every render.
  const kbdRef = useRef();
  kbdRef.current = {
    editing, tool, containerSize,
    deleteLine, deleteCircle, deletePlaced,
    undoAction, redoAction, recenter, clearInteraction,
    setTool, setShowCons, zoomAt,
  };
  useEffect(() => {
    const onKeyDown = (e) => {
      // Don't intercept while the user is typing into a text field.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const s = kbdRef.current;
      const mod = e.metaKey || e.ctrlKey;

      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) s.redoAction(); else s.undoAction();
          return;
        }
        if (k === 'y') {
          e.preventDefault();
          s.redoAction();
          return;
        }
        return; // other modifier combos pass through
      }

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          if (!s.editing) return;
          e.preventDefault();
          if (s.editing.kind === 'line') s.deleteLine(s.editing.id);
          else if (s.editing.kind === 'circle') s.deleteCircle(s.editing.id);
          else if (s.editing.kind === 'placedTile') s.deletePlaced(s.editing.id);
          break;
        case 'Escape':
          s.clearInteraction();
          break;
        case 'l': case 'L': s.setTool('line');    s.clearInteraction(); break;
        case 'c': case 'C': s.setTool('circle');  s.clearInteraction(); break;
        case 'i': case 'I': s.setTool('ink');     s.clearInteraction(); break;
        case 'p': case 'P': s.setTool('polygon'); s.clearInteraction(); break;
        case 'f': case 'F': s.setTool('fill');    s.clearInteraction(); break;
        case 'v': case 'V': // V for "select" — S is too easy to fat-finger near 'A'/'D'
        case 's': case 'S': s.setTool('select');  s.clearInteraction(); break;
        case 'h': case 'H': s.setShowCons((x) => !x); break;
        case 'r': case 'R': s.recenter(); break;
        case '+': case '=':
          s.zoomAt(s.containerSize.w / 2, s.containerSize.h / 2, 1.2);
          break;
        case '-': case '_':
          s.zoomAt(s.containerSize.w / 2, s.containerSize.h / 2, 1 / 1.2);
          break;
        default: return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ============================ INK PATHS (RENDER MEMO) ============================
  // Normalises every ink record into the common shape consumed by <StrokedShape>:
  // { type: 'line', a, b } | { type: 'arc', center, radius, ang1, ang2 } | { type: 'wholeCircle', center, radius }.
  const inkPaths = useMemo(() => {
    const paths = [];
    for (const ink of inks) {
      if (ink.type === 'lineSeg') {
        const L = lines[ink.lineId];
        if (!L) continue;
        paths.push({ type: 'line', a: lerp(L.p1, L.p2, ink.t1), b: lerp(L.p1, L.p2, ink.t2) });
      } else if (ink.type === 'arc') {
        const C = circles[ink.circleId];
        if (!C) continue;
        paths.push({ type: 'arc', center: C.center, radius: C.radius, ang1: ink.ang1, ang2: ink.ang2 });
      } else if (ink.type === 'wholeCircle') {
        const C = circles[ink.circleId];
        if (!C) continue;
        paths.push({ type: 'wholeCircle', center: C.center, radius: C.radius });
      }
    }
    return paths;
  }, [inks, lines, circles]);

  // ============================ EDIT-MODE HANDLES ============================
  // Build the visual-only handle list for the current editing target. The SVG's
  // pointerdown picks the nearest handle and dispatches drag; the handle's
  // onMove receives the snapped/free world point and applies the edit.
  const handles = buildHandles({
    editing, lines, circles, placed, tiles, view,
    updateLine, updateCircle, setPlaced,
    computeSnapTargets, setSnapIndicator,
    rotationStepRad,
  });

  // ============================ RENDER ============================
  const showSnapButtons = (tool === 'line' || tool === 'circle');

  return (
    <div
      className="w-full h-screen flex flex-col"
      style={{
        background: COLOR.canvas,
        fontFamily: FONT_STACK,
        color: COLOR.text,
        userSelect: 'none', touchAction: 'none',
      }}
    >
      <Toolbar
        tool={tool}
        onSelectTool={(t) => { setTool(t); clearInteraction(); }}
        onUndo={undoAction} canUndo={canUndo}
        onRedo={redoAction} canRedo={canRedo}
        showCons={showCons} onToggleCons={() => setShowCons((s) => !s)}
        onRecenter={recenter}
        confirmClear={confirmClear} onClear={onClickClear}
      />

      <StatusBar
        draft={draft} polyDraft={polyDraft} editing={editing}
        onClearEditing={() => setEditing(null)}
        onDeleteLine={deleteLine}
        onDeleteCircle={deleteCircle}
        onDeletePlaced={deletePlaced}
        rotationStepDeg={rotationStepDeg}
        rotationStepRad={rotationStepRad}
        onCycleRotationStep={cycleRotationStep}
        onRotatePlaced={rotatePlaced}
        onSnapPlacedToGrid={snapPlacedToGrid}
        onResetPlaced={resetPlaced}
        onFlipPlaced={flipPlaced}
        tool={tool}
        selectedColor={selectedColor}
        onSelectColor={setSelectedColor}
      />

      <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ background: COLOR.canvas }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          onPointerDown={(e) => {
            // Defensive: if a child handler has already initiated a non-pan action
            // for this pointerdown, don't override it.
            if (ptrState.current.action?.kind === 'dragHandle') return;
            const pos = getEventPos(e);
            const worldP = screenToWorld(pos.x, pos.y);

            // Nearest-handle hit detection: if a handle is within hit radius of the tap, drag it.
            // "Closest wins" — works correctly when handle hit areas overlap, no z-order surprises.
            // Only check this for the first finger; pinch/2-finger gestures go through pinch logic.
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
                setIsDragging(true);
                return;
              }
            }

            ptrState.current.pointers.set(e.pointerId, {
              ...pos, downAt: Date.now(), moved: false, startScreen: pos, startWorld: worldP,
            });
            e.target.setPointerCapture?.(e.pointerId);
            if (ptrState.current.pointers.size === 2) {
              const pts = [...ptrState.current.pointers.values()];
              const cx = (pts[0].x + pts[1].x) / 2;
              const cy = (pts[0].y + pts[1].y) / 2;
              const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
              ptrState.current.action = { kind: 'pinch', startDist: d, startCenter: { x: cx, y: cy }, startView: { ...view } };
            } else {
              // Always allow single-finger pan; tap vs drag distinguished by `moved` on pointer up.
              ptrState.current.action = { kind: 'pan', startScreen: pos, startView: { ...view } };
            }
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            {/* ---- Under-pass for placed tiles ----
                Un-inked tile edges only — these are faint outlines that
                should be hidden under colour fills (so a coloured region
                doesn't show stray seams) but visible in un-coloured areas.
                Shared seams between adjacent tiles are already dropped
                via sharedEdgeKeys. */}
            {placed.map((pt) => {
              const tile = tiles.find((t) => t.id === pt.tileId);
              if (!tile) return null;
              const transform = `translate(${pt.position.x},${pt.position.y}) rotate(${pt.rotation * 180 / Math.PI}) ${pt.flipped ? 'scale(-1,1)' : ''}`;
              const uninkedEdgeShapes = tile.edges
                .map((e, idx) => {
                  const s = edgeToShape(e, tile.vertices);
                  if (!s) return null;
                  if (tile.inks.some((ink) => shapesEqual(s, ink))) return null;
                  if (sharedEdgeKeys.has(`${pt.id}:${idx}`)) return null;
                  return s;
                })
                .filter(Boolean);
              if (uninkedEdgeShapes.length === 0) return null;
              return (
                <g key={`bg-${pt.id}`} transform={transform}>
                  {uninkedEdgeShapes.map((s, i) => (
                    <StrokedShape key={`ue-${i}`} shape={s}
                      stroke="#9C8A6A" strokeWidth={1} opacity={0.4} />
                  ))}
                </g>
              );
            })}

            {/* Coloured face fills — bold version. The silhouette pass below
                adds a translucent tan wash over them so they read as a
                subtle, slightly muted colour rather than vivid blocks.
                Hidden during a handle drag because the underlying face graph
                is frozen for performance — letting them render at stale
                positions while their tiles move would look like floating
                debris. They snap back into place on release. */}
            {!isDragging && coloredFaces.map((cf, i) => (
              <path key={`fill-${i}`} d={cf.d} fill={cf.color} stroke="none" />
            ))}

            {/* Combined silhouette wash — every placed tile's outline as a
                single <path> so the union renders without internal
                antialias seams. Lays a soft tan tint over both the colour
                fills (giving them the washed-out paper feel) and the
                under-pass un-inked edges. */}
            {combinedSilhouettePath && (
              <path d={combinedSilhouettePath} fill="rgba(225,200,150,0.25)" stroke="none" />
            )}

            {/* Canvas construction (faint, global). Above colours/wash so
                construction is visible over coloured regions for reference. */}
            {showCons && Object.entries(circles).map(([id, c]) => (
              <circle key={`c-${id}`} cx={c.center.x} cy={c.center.y} r={c.radius}
                fill="none" stroke="#9C8A6A" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.4} />
            ))}
            {showCons && Object.entries(lines).map(([id, l]) => (
              <line key={`l-${id}`} x1={l.p1.x} y1={l.p1.y} x2={l.p2.x} y2={l.p2.y}
                stroke="#9C8A6A" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.4} />
            ))}

            {/* Per-tile interior construction (also visible over colours). */}
            {showCons && placed.map((pt) => {
              const tile = tiles.find((t) => t.id === pt.tileId);
              if (!tile?.construction?.length) return null;
              const transform = `translate(${pt.position.x},${pt.position.y}) rotate(${pt.rotation * 180 / Math.PI}) ${pt.flipped ? 'scale(-1,1)' : ''}`;
              return (
                <g key={`mid-${pt.id}`} transform={transform}>
                  {tile.construction.map((c, i) => (
                    <StrokedShape key={`tc-${i}`} shape={c}
                      stroke="#9C8A6A" strokeWidth={1} opacity={0.4} />
                  ))}
                </g>
              );
            })}

            {/* Canvas inks */}
            {inkPaths.map((p, i) => (
              <StrokedShape key={`ink-${i}`} shape={p}
                stroke="#1B1B1B" strokeWidth={2.5} lineCap="round" />
            ))}

            {/* ---- Over-pass for placed tiles ----
                Bold inks plus the orange selection indicator. Always on top
                of fills, wash, and construction so the design's structure
                reads clearly. */}
            {placed.map((pt) => {
              const tile = tiles.find((t) => t.id === pt.tileId);
              if (!tile) return null;
              const transform = `translate(${pt.position.x},${pt.position.y}) rotate(${pt.rotation * 180 / Math.PI}) ${pt.flipped ? 'scale(-1,1)' : ''}`;
              return (
                <g key={`fg-${pt.id}`} transform={transform}>
                  {tile.inks.map((ink, i) => (
                    <StrokedShape key={i} shape={ink}
                      stroke="#1B1B1B" strokeWidth={2} lineCap="round" />
                  ))}
                  {editing?.kind === 'placedTile' && editing.id === pt.id && (
                    <path d={tilePathD(tile)} fill="none" stroke="#C58A3A"
                      strokeWidth={2.5} strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke" />
                  )}
                </g>
              );
            })}

            {/* Polygon-in-progress preview */}
            {polyDraft.map((pd, i) => (
              <StrokedShape key={`pd-${i}`} shape={polyDraftShape(pd)}
                stroke="#C58A3A" strokeWidth={3} lineCap="round" opacity={0.85} />
            ))}

            {/* Polygon vertex indicators: next-vertex (filled) and closure-target (ring). */}
            {polyDraft.length > 0 && (() => {
              const start = polyDraft[0].from;
              const next = polyDraft[polyDraft.length - 1].to;
              const sameAsStart = polyDraft[0].pidFrom !== undefined &&
                polyDraft[0].pidFrom === polyDraft[polyDraft.length - 1].pidTo;
              return (
                <g pointerEvents="none">
                  <circle cx={start.x} cy={start.y} r={11 / view.scale}
                    fill="none" stroke="#C58A3A" strokeWidth={2}
                    strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
                  {!sameAsStart && (
                    <circle cx={next.x} cy={next.y} r={9 / view.scale}
                      fill="#C58A3A" stroke="#3A2E1F" strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke" />
                  )}
                </g>
              );
            })()}

            {/* Rejected polygon-tap feedback. */}
            {polyRejected && (
              <StrokedShape shape={polyRejectedShape(polyRejected)}
                stroke="#8B2E1A" strokeWidth={3.5} lineCap="round" opacity={0.7}
                pointerEvents="none" />
            )}

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
                <line x1={draft.refA.x} y1={draft.refA.y} x2={draft.refB.x} y2={draft.refB.y}
                  stroke="#C58A3A" strokeWidth={1.5} strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke" opacity={0.7} />
              </>
            )}

            {/* Snap-target markers (shown in line/circle tools). Tappable: tapping a marker can
                start a new draft from the exact intersection. Defers to handle-drag if a handle
                is closer than the marker. Rendered before edit handles so handles draw on top —
                otherwise a marker at a line endpoint covers the lengthen handle's center. */}
            {showSnapButtons && (() => {
              const targets = computeSnapTargets();
              const shown = [];
              for (const p of targets.points) {
                if (!shown.some((q) => dist(q, p) < 1 / view.scale)) shown.push(p);
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
                    fill={sel ? '#C58A3A' : COLOR.canvas}
                    stroke="#3A2E1F"
                    strokeWidth={sel ? 2.5 : 1.2}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      const pos = getEventPos(e);
                      const worldP = screenToWorld(pos.x, pos.y);
                      // Defer to handle drag if any edit handle is closer than this marker.
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

            {/* Edit-mode handles — drawn after snap markers so a marker at a handle position
                doesn't cover the handle's centre glyph. */}
            {handles.map((h, i) => <Handle key={`h-${i}`} h={h} scale={view.scale} />)}

            {/* Snap indicator */}
            {snapIndicator && (
              <g>
                <circle cx={snapIndicator.x} cy={snapIndicator.y} r={10 / view.scale}
                  fill="none" stroke="#C58A3A" strokeWidth={2}
                  vectorEffect="non-scaling-stroke" />
                <circle cx={snapIndicator.x} cy={snapIndicator.y} r={3 / view.scale} fill="#C58A3A" />
              </g>
            )}
          </g>
        </svg>

        <Inventory
          tiles={tiles}
          sheetOpen={sheetOpen}
          containerHeight={containerSize.h}
          onToggleSheet={() => setSheetOpen((s) => !s)}
          onUseTile={(tile) => {
            pushUndo();
            const center = screenToWorld(containerSize.w / 2, containerSize.h / 2);
            const newPlaced = { id: newId(), tileId: tile.id, position: center, rotation: 0, flipped: false };
            setPlaced((P) => [...P, newPlaced]);
            setEditing({ kind: 'placedTile', id: newPlaced.id });
            setTool('select');
            setSheetOpen(false);
          }}
          onDeleteTile={deleteTile}
        />
      </div>
    </div>
  );
}

// ============================ HANDLE BUILDER ============================
// Produce the visual-only handle list for the current editing target. The
// handles are rendered later in the SVG; their hit area is driven by the
// nearest-handle dispatcher in the canvas's pointerdown.
function buildHandles({
  editing, lines, circles, placed, tiles, view,
  updateLine, updateCircle, setPlaced,
  computeSnapTargets, setSnapIndicator,
  rotationStepRad,
}) {
  const handles = [];
  if (editing?.kind === 'line') {
    const L = lines[editing.id];
    if (!L) return handles;
    addLineHandles(handles, L, editing.id, {
      view, updateLine, computeSnapTargets, setSnapIndicator,
    });
  } else if (editing?.kind === 'circle') {
    const C = circles[editing.id];
    if (!C) return handles;
    addCircleHandles(handles, C, editing.id, { updateCircle });
  } else if (editing?.kind === 'placedTile') {
    const pt = placed.find((p) => p.id === editing.id);
    const tile = pt && tiles.find((t) => t.id === pt.tileId);
    if (pt && tile) addPlacedTileHandles(handles, pt, tile, editing.id, {
      view, computeSnapTargets, setSnapIndicator, setPlaced, rotationStepRad,
    });
  }
  return handles;
}

function addLineHandles(handles, L, id, { view, updateLine, computeSnapTargets, setSnapIndicator }) {
  const mid = lerp(L.p1, L.p2, 0.5);
  const dir = sub(L.p2, L.p1);
  const len = Math.hypot(dir.x, dir.y);
  const dirUnit = len > EPS ? { x: dir.x / len, y: dir.y / len } : { x: 1, y: 0 };

  // Endpoint angle handles sit "just past" each endpoint along the line.
  // Fixed screen offset, capped so we don't pass the midpoint on short lines.
  const offset = Math.min(28 / view.scale, len * 0.25);
  const knobNearA = { x: L.p1.x + offset * dirUnit.x, y: L.p1.y + offset * dirUnit.y };
  const knobNearC = { x: L.p2.x - offset * dirUnit.x, y: L.p2.y - offset * dirUnit.y };

  // Lengthen along the line: project finger onto axis, snap to on-axis snap targets.
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

  // Rotation around a pivot, with on-line snap-target filtering and a preference for
  // the canonical (horizontal) angle when both snap candidates are within threshold.
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

  // The five handles, in order along the line.

  // 1. Length at A (P1) — pivot at P2, axis from P2 toward P1.
  handles.push({
    kind: 'lengthen', x: L.p1.x, y: L.p1.y,
    onMove: lengthenWithSnap(L.p2, { x: -dirUnit.x, y: -dirUnit.y }, (newP1) => updateLine(id, { p1: newP1 })),
    allowSnap: false,
  });

  // 2. Angle just past A — pivot at C; A swings.
  handles.push({
    kind: 'rotate', x: knobNearA.x, y: knobNearA.y, pivot: L.p2,
    onMove: rotateAroundPivot(L.p2, len, (ang) => {
      const newP1 = { x: L.p2.x + len * Math.cos(ang), y: L.p2.y + len * Math.sin(ang) };
      updateLine(id, { p1: newP1 });
    }),
    allowSnap: false,
  });

  // 3. Angle at midpoint — pivot at midpoint; both endpoints swing.
  handles.push({
    kind: 'rotate', x: mid.x, y: mid.y, pivot: mid,
    onMove: rotateAroundPivot(mid, len / 2, (ang) => {
      const half = len / 2;
      const newP1 = { x: mid.x - half * Math.cos(ang), y: mid.y - half * Math.sin(ang) };
      const newP2 = { x: mid.x + half * Math.cos(ang), y: mid.y + half * Math.sin(ang) };
      updateLine(id, { p1: newP1, p2: newP2 });
    }),
    allowSnap: false,
  });

  // 4. Angle just before C — pivot at A; C swings.
  handles.push({
    kind: 'rotate', x: knobNearC.x, y: knobNearC.y, pivot: L.p1,
    onMove: rotateAroundPivot(L.p1, len, (ang) => {
      const newP2 = { x: L.p1.x + len * Math.cos(ang), y: L.p1.y + len * Math.sin(ang) };
      updateLine(id, { p2: newP2 });
    }),
    allowSnap: false,
  });

  // 5. Length at C (P2) — pivot at P1, axis from P1 toward P2.
  handles.push({
    kind: 'lengthen', x: L.p2.x, y: L.p2.y,
    onMove: lengthenWithSnap(L.p1, dirUnit, (newP2) => updateLine(id, { p2: newP2 })),
    allowSnap: false,
  });
}

function addCircleHandles(handles, C, id, { updateCircle }) {
  // Center handle: moves the whole circle and drags radiusPt along.
  handles.push({
    kind: 'center', x: C.center.x, y: C.center.y,
    onMove: (snap) => {
      const delta = sub({ x: snap.x, y: snap.y }, C.center);
      updateCircle(id, {
        center: { x: snap.x, y: snap.y },
        radiusPt: C.radiusPt ? add(C.radiusPt, delta) : undefined,
      });
    },
    snapOpts: { allow1D: true },
  });

  const rPt = C.radiusPt || { x: C.center.x + C.radius, y: C.center.y };
  handles.push({
    kind: 'radius', x: rPt.x, y: rPt.y,
    onMove: (snap) => {
      const r = dist(C.center, snap);
      if (r > EPS) updateCircle(id, { radius: r, radiusPt: { x: snap.x, y: snap.y } });
    },
    snapOpts: { allow1D: true },
  });
}

function addPlacedTileHandles(handles, pt, tile, id, {
  view, computeSnapTargets, setSnapIndicator, setPlaced, rotationStepRad,
}) {
  // Move handle: tile center follows the finger, with vertex-snap onto any other
  // snap target (excluding this tile's own vertices).
  handles.push({
    kind: 'move', x: pt.position.x, y: pt.position.y,
    onMove: (snap, free) => {
      const tentativePos = { x: free.x, y: free.y };
      const tentativePt = { ...pt, position: tentativePos };
      const tentativeWorldVerts = tile.vertices.map((v) => transformPoint(v, tentativePt));
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
        const wv = tentativeWorldVerts[best.vertexIdx];
        const delta = sub(best.target, wv);
        finalPos = add(tentativePos, delta);
        setSnapIndicator({ x: best.target.x, y: best.target.y, kind: 'vertex-snap' });
      } else {
        setSnapIndicator(null);
      }
      setPlaced((P) => P.map((p) => p.id === id ? { ...p, position: finalPos } : p));
    },
    allowSnap: false, // we do our own snapping in onMove
  });

  // Rotation handle: fixed screen-pixel offset from the centroid; rotates with the tile.
  // Drag to rotate; snaps to the current rotation step.
  const rotHandleOffsetWorld = 60 / view.scale;
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
      const worldAngle = angBetween(pt.position, free);
      // Convert to "rotation": when not flipped, world handle angle = rotation.
      // When flipped, the local handle is at (-offset, 0), so world angle = rotation + π.
      let newRotation = pt.flipped ? worldAngle - Math.PI : worldAngle;
      if (rotationStepRad > 0) {
        newRotation = Math.round(newRotation / rotationStepRad) * rotationStepRad;
      }
      setPlaced((P) => P.map((p) => p.id === id ? { ...p, rotation: newRotation } : p));
    },
    allowSnap: false,
  });
}

// ============================ SMALL RENDER COMPONENTS ============================

// Render a stroked line / CCW arc / whole circle. Stroke widths are world-space
// inputs that get divided by `scale` so they render at constant screen size.
//
// `shape` is one of:
//   { type: 'line',        a, b }
//   { type: 'arc',         center, radius, ang1, ang2 }
//   { type: 'wholeCircle', center, radius }
// `strokeWidth` is in screen pixels. `vector-effect: non-scaling-stroke` keeps
// the stroke at that pixel width regardless of the surrounding SVG transform —
// so we don't recompute width props on zoom, and React doesn't have to walk
// every stroked element when the view scale changes.
function StrokedShape({ shape, stroke, strokeWidth, opacity = 1, lineCap, pointerEvents }) {
  const common = {
    stroke,
    strokeWidth,
    fill: 'none',
    opacity,
    vectorEffect: 'non-scaling-stroke',
  };
  if (lineCap) common.strokeLinecap = lineCap;
  if (pointerEvents !== undefined) common.pointerEvents = pointerEvents;

  if (shape.type === 'line') {
    return <line x1={shape.a.x} y1={shape.a.y} x2={shape.b.x} y2={shape.b.y} {...common} />;
  }
  if (shape.type === 'arc') {
    return <path d={arcPathCCW(shape.center, shape.radius, shape.ang1, shape.ang2)} {...common} />;
  }
  if (shape.type === 'wholeCircle') {
    return <circle cx={shape.center.x} cy={shape.center.y} r={shape.radius} {...common} />;
  }
  return null;
}

// `findSegmentAt` produces hits with `type: 'lineSeg'` / 'arc' (it doesn't normalise to the
// StrokedShape vocabulary). These two helpers map a polygon-tap segment record into the
// StrokedShape `shape` format. Polygon segs are never `wholeCircle` so we ignore that case.
const polyDraftShape = (pd) => pd.seg.type === 'lineSeg'
  ? { type: 'line', a: pd.from, b: pd.to }
  : pd.seg; // already { type: 'arc', center, radius, ang1, ang2 }

const polyRejectedShape = (seg) => seg.type === 'lineSeg'
  ? { type: 'line', a: seg.a, b: seg.b }
  : seg;

function Handle({ h, scale }) {
  // Handle geometry (radius, line endpoints, glyph offsets) is in world units
  // and stays scale-dependent — no SVG attribute makes a circle's radius
  // immune to the parent transform. Stroke widths and dasharrays use
  // non-scaling-stroke so they don't churn React props on zoom.
  return (
    <g style={{ pointerEvents: 'none' }}>
      {h.showTether && h.kind === 'rotate' && h.pivot && (
        <line x1={h.pivot.x} y1={h.pivot.y} x2={h.x} y2={h.y}
          stroke="#9C8A6A" strokeWidth={1} strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke" />
      )}
      <circle cx={h.x} cy={h.y} r={HANDLE_R / scale}
        fill={COLOR.canvas} stroke="#3A2E1F" strokeWidth={1.5}
        vectorEffect="non-scaling-stroke" />
      {h.kind === 'rotate'   && <circle cx={h.x} cy={h.y} r={(HANDLE_R - 6) / scale} fill="#3A2E1F" />}
      {h.kind === 'lengthen' && <line x1={h.x - 5 / scale} y1={h.y} x2={h.x + 5 / scale} y2={h.y} stroke="#3A2E1F" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      {h.kind === 'lengthen' && <line x1={h.x} y1={h.y - 5 / scale} x2={h.x} y2={h.y + 5 / scale} stroke="#3A2E1F" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      {h.kind === 'radius'   && <circle cx={h.x} cy={h.y} r={(HANDLE_R - 8) / scale} fill="#3A2E1F" />}
      {h.kind === 'center'   && <text x={h.x} y={h.y + 4 / scale} textAnchor="middle" fontSize={12 / scale} fill="#3A2E1F">+</text>}
    </g>
  );
}
