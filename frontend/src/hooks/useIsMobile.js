import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT_PX = 767;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
