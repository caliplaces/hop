import { useEffect, useState } from "react";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Steps through `count` items every `ms`; pauses in background tabs and for reduced motion. */
export function useCycle(count: number, ms: number): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reducedMotion() || count < 2) return;
    const id = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % count);
    }, ms);
    return () => clearInterval(id);
  }, [count, ms]);
  return index;
}
