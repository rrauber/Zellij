import { useEffect, useState } from 'react';

// Track an element's size, updating whenever the window resizes.
// Returns [ref, { w, h }]. Default is 800×600 until the first measurement.
export function useContainerSize(initial = { w: 800, h: 600 }) {
  const [size, setSize] = useState(initial);
  const [ref, setRef] = useState(null);

  useEffect(() => {
    if (!ref) return;
    const update = () => {
      const r = ref.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [ref]);

  return [setRef, size];
}
