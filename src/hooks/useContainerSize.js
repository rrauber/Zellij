import { useEffect, useState } from 'react';

// Track an element's size. ResizeObserver fires once on observe() with the
// current size, then again on every subsequent resize — that initial fire is
// what makes this reliable on first interaction (a plain getBoundingClientRect
// inside useEffect would race with user clicks that happen before the first
// post-mount paint).
//
// Returns [refCallback, { w, h }]. Default size is 800×600 only until the
// ResizeObserver delivers its first entry, which usually happens in the
// same tick as the ref callback firing.
export function useContainerSize(initial = { w: 800, h: 600 }) {
  const [size, setSize] = useState(initial);
  const [ref, setRef] = useState(null);

  useEffect(() => {
    if (!ref) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    observer.observe(ref);
    return () => observer.disconnect();
  }, [ref]);

  return [setRef, size];
}
