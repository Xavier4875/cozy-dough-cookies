import { useLayoutEffect, useRef, useState } from 'react';
import { nextMascotImage } from '../mascot/mascotImages.js';

// Draws one pose from the shared cycle for the lifetime of the calling
// component — a fresh pose is drawn each time it mounts, but re-renders
// don't change it.
//
// The draw has to happen in an effect, not directly in the render body:
// nextMascotImage() has a side effect (advances shared cycling state), and
// React 18 StrictMode's dev-only double-invoke of the render phase resets
// ALL hook state (not just useState initializers) between its two calls —
// so a useRef guard checked directly in render still lets the draw run
// twice. Effects get a different (and here, useful) double-invoke: mount →
// cleanup → mount again, against the same already-committed hooks, so a
// ref guard *inside* the effect correctly skips the redundant second call.
// useLayoutEffect (not useEffect) so the image is set before the browser
// paints, avoiding a blank-then-populated flash.
export function useMascot() {
  const [src, setSrc] = useState(null);
  const hasDrawnRef = useRef(false);

  useLayoutEffect(() => {
    if (hasDrawnRef.current) return;
    hasDrawnRef.current = true;
    setSrc(nextMascotImage());
  }, []);

  return src;
}
