import { useEffect } from 'react';

// Measures `ref`'s rendered height and publishes it as a CSS var on
// documentElement, kept in sync via ResizeObserver. Lets sticky/fixed
// elements elsewhere on the page offset by a real measured height instead
// of a hardcoded number that drifts once content wraps differently
// (different screen size, longer text, etc).
export function usePublishHeight(ref, cssVarName) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(cssVarName, `${el.getBoundingClientRect().height}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, cssVarName]);
}
