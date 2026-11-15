import { type RefCallback, useCallback } from "react";

/**
 * Feeds the pointer position to every .lp-spot card inside the container as
 * --mx / --my, for the hover light in landing.css. One listener per grid,
 * styles written directly (no React render per move), mouse and pen only.
 */
export function useSpotlight(): RefCallback<HTMLElement> {
  return useCallback<RefCallback<HTMLElement>>((container) => {
    if (!container) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      for (const card of container.querySelectorAll<HTMLElement>(".lp-spot")) {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
        card.style.setProperty("--my", `${e.clientY - rect.top}px`);
      }
    };
    container.addEventListener("pointermove", onMove, { passive: true });
    return () => container.removeEventListener("pointermove", onMove);
  }, []);
}
