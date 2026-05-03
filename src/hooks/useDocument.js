import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEY } from '../constants.js';

// Owns the five "document" slices (the things the user explicitly created and
// that get persisted), plus an undo/redo stack and async load/save.
//
// Persistence uses `window.storage` if present (the surrounding harness's
// async storage API). Saves are debounced so rapid edits coalesce.
export function useDocument() {
  const [lines, setLines] = useState({});
  const [circles, setCircles] = useState({});
  const [inks, setInks] = useState([]);
  const [tiles, setTiles] = useState([]);
  const [placed, setPlaced] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Load on mount
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

  // Save (debounced) — only after initial load completes so we don't clobber
  // saved state with the empty defaults during the first render.
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

  // Undo/redo. pushUndo captures the *current* state — so call it BEFORE the
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
    loaded,
    pushUndo, undo, redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
