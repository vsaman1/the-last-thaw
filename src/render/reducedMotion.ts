import { useEffect, useState } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Live prefers-reduced-motion (re-renders when the OS setting changes). */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => globalThis.matchMedia?.(REDUCED_MOTION).matches ?? false);
  useEffect(() => {
    const mq = globalThis.matchMedia?.(REDUCED_MOTION);
    if (!mq) return;
    const onChange = (): void => setReduce(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduce;
}
