import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEY } from '../constants.js';
import { edgeToShape } from '../tiles/transform.js';

// Owns the five "document" slices (the things the user explicitly created and
// that get persisted), plus an undo/redo stack and localStorage save/load.
// Saves are debounced so a continuous drag doesn't write to disk every frame.

// Bumped whenever the persisted tile shape changes. `migrate()` runs on load
// and brings older snapshots up to the current version, so users don't lose
// their work across schema changes.
const DOC_VERSION = 2;

// v1 → v2: boundary edges are now part of `inks` rather than being a separate
// dark stroke. Synthesise one ink per edge so old tiles render the same way.
function migrate(s) {
  if (!s) return s;
  const v = s.version ?? 1;
  if (v >= DOC_VERSION) return s;
  const tiles = (s.tiles || []).map((t) => {
    const boundaryInks = (t.edges || [])
      .map((e) => edgeToShape(e, t.vertices))
      .filter(Boolean);
    return { ...t, inks: [...boundaryInks, ...(t.inks || [])] };
  });
  return { ...s, tiles, version: DOC_VERSION };
}

const loadInitial = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch (e) {
    // Malformed JSON, quota errors, or sandboxed/private contexts — skip.
    return null;
  }
};

export function useDocument() {
  // Single sync read at mount; the lazy initializer keeps subsequent renders cheap.
  const [initial] = useState(loadInitial);
  const [lines,   setLines]   = useState(() => initial?.lines   ?? {});
  const [circles, setCircles] = useState(() => initial?.circles ?? {});
  const [inks,    setInks]    = useState(() => initial?.inks    ?? []);
  const [tiles,   setTiles]   = useState(() => initial?.tiles   ?? []);
  const [placed,  setPlaced]  = useState(() => initial?.placed  ?? []);

  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Save (debounced). The first effect run rewrites the same JSON we just
  // loaded — harmless and saves us a "loaded" gate.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: DOC_VERSION, lines, circles, inks, tiles, placed }),
        );
      } catch (e) { /* quota / private mode — drop the save */ }
    }, 400);
    return () => clearTimeout(t);
  }, [lines, circles, inks, tiles, placed]);

  // Undo/redo. pushUndo captures the *current* state — call it BEFORE the
  // mutation. Stack capped at 50 entries.
  const pushUndo = useCallback(() => {
    setUndoStack((s) => [...s.slice(-50), { lines, circles, inks, tiles, placed }]);
    setRedoStack([]);
  }, [lines, circles, inks, tiles, placed]);

  const applySnapshot = (snap) => {
    setLines(snap.lines);
    setCircles(snap.circles);
    setInks(snap.inks);
    setTiles(snap.tiles);
    setPlaced(snap.placed);
  };

  const undo = () => {
    if (undoStack.length === 0) return false;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, { lines, circles, inks, tiles, placed }]);
    setUndoStack((s) => s.slice(0, -1));
    applySnapshot(prev);
    return true;
  };

  const redo = () => {
    if (redoStack.length === 0) return false;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((s) => [...s, { lines, circles, inks, tiles, placed }]);
    setRedoStack((r) => r.slice(0, -1));
    applySnapshot(next);
    return true;
  };

  return {
    lines, setLines,
    circles, setCircles,
    inks, setInks,
    tiles, setTiles,
    placed, setPlaced,
    pushUndo, undo, redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
