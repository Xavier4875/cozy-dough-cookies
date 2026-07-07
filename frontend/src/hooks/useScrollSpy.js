import { useEffect, useRef, useState } from 'react';

// Tracks which of several vertically-stacked sections is "current" as the
// page scrolls (whichever section's top has scrolled up past the bottom
// edge of a sticky nav stack), and exposes a scrollToKey() that
// smooth-scrolls to a section.
//
// While a click-triggered scroll is animating, naively recomputing on every
// `scroll` event would flicker through whichever sections lie between the
// old and new position. suppressSpyRef mutes recomputation until the
// scroll actually finishes (scrollend where supported, otherwise polling
// until scrollY holds still); scrollTokenRef guards against a second click
// resolving a stale "scroll finished" callback from an earlier click.
export function useScrollSpy({ sectionRefs, stickyBoundaryRef, keys }) {
  const [activeKey, setActiveKey] = useState(keys[0]);
  const suppressSpyRef = useRef(false);
  const recomputeActiveRef = useRef(() => {});
  const scrollTokenRef = useRef(0);

  useEffect(() => {
    function handleScroll() {
      if (suppressSpyRef.current) return;
      const stickyBottom = stickyBoundaryRef.current?.getBoundingClientRect().bottom ?? 0;
      let current = keys[0];
      for (const key of keys) {
        const el = sectionRefs.current[key];
        if (el && el.getBoundingClientRect().top <= stickyBottom + 1) {
          current = key;
        }
      }
      setActiveKey(current);
    }
    recomputeActiveRef.current = handleScroll;
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [sectionRefs, stickyBoundaryRef, keys]);

  function scrollToKey(key) {
    setActiveKey(key);
    suppressSpyRef.current = true;
    const token = ++scrollTokenRef.current;
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    function resume() {
      if (scrollTokenRef.current !== token) return; // superseded by a later click
      suppressSpyRef.current = false;
      recomputeActiveRef.current();
    }

    if ('onscrollend' in window) {
      window.addEventListener('scrollend', resume, { once: true });
      return;
    }

    // Safari (pre-18.2ish) lacks scrollend — poll until scrollY holds still
    // for a few frames instead of guessing a fixed animation duration.
    let lastY = window.scrollY;
    let stableFrames = 0;
    function poll() {
      if (scrollTokenRef.current !== token) return;
      const y = window.scrollY;
      if (y === lastY) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastY = y;
      }
      if (stableFrames > 6) {
        resume();
      } else {
        requestAnimationFrame(poll);
      }
    }
    requestAnimationFrame(poll);
  }

  return { activeKey, scrollToKey };
}
