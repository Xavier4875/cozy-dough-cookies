import { useState } from 'react';
import { nextMascotImage } from '../mascot/mascotImages.js';

// Draws one pose from the shared cycle for the lifetime of the calling
// component — a fresh pose is drawn each time it mounts, but re-renders
// don't change it.
export function useMascot() {
  const [src] = useState(() => nextMascotImage());
  return src;
}
