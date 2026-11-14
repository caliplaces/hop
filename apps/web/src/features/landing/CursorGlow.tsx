import { useEffect, useRef } from "react";

/**
 * A soft glow that eases after the pointer. Writes transforms directly (no
 * React re-render per frame) and is skipped on touch devices and for
 * reduced motion.
 */
export function CursorGlow({ color }: { color: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!node || !finePointer || reduced) return;

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 3 };
    const current = { ...target };
    let frame = 0;
    const tick = () => {
      current.x += (target.x - current.x) * 0.12;
      current.y += (target.y - current.y) * 0.12;
      node.style.transform = `translate3d(${current.x}px, ${current.y}px, 0) translate(-50%, -50%)`;
      if (Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.5) {
        frame = requestAnimationFrame(tick);
      } else {
        frame = 0;
      }
    };
    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      node.style.opacity = "1";
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 -z-10 size-[36rem] rounded-full opacity-0 blur-3xl transition-[opacity,background-color] duration-700"
      style={{ backgroundColor: `${color}2e` }}
    />
  );
}
