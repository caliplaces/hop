import { type CSSProperties, type RefCallback, useCallback } from "react";

/*
 * One observer for the whole page. An element is revealed once and then
 * forgotten, so scrolling back up doesn't replay anything.
 */
let observer: IntersectionObserver | null = null;

function sharedObserver() {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute("data-shown", "");
        observer?.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  return observer;
}

/**
 * Spread onto an element to fade it up as it scrolls into view (styles in
 * landing.css). `delay` staggers siblings.
 */
export function useReveal(delay = 0): {
  ref: RefCallback<HTMLElement>;
  "data-reveal": "";
  style: CSSProperties;
} {
  const ref = useCallback<RefCallback<HTMLElement>>((node) => {
    if (!node) return;
    const io = sharedObserver();
    io.observe(node);
    return () => io.unobserve(node);
  }, []);
  return { ref, "data-reveal": "", style: { "--reveal-delay": `${delay}ms` } as CSSProperties };
}
