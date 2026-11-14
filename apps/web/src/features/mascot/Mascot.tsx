import { type ButtonHTMLAttributes, useEffect, useRef, useState } from "react";
import { cx } from "../../components/ui/cx";
import type { MascotState } from "./engine/motion";
import type { MascotController } from "./engine/scene";
import { MascotPoster } from "./MascotPoster";
import { canRender3D, prefersReducedMotion, shellsFor } from "./support";

export type { MascotState };

type Props = {
  state?: MascotState;
  /** Body colour (hex), usually the athlete's palette colour. */
  color: string;
  /** Rendered size in CSS pixels (square). */
  size: number;
  /** Eyes follow the pointer anywhere on the page. */
  follow?: boolean;
  /** Tap to poke (renders as a button). */
  interactive?: boolean;
  /** Accessible name; without one Bobble is decorative. */
  label?: string;
  className?: string;
};

function whenIdle(callback: () => void) {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout: 1500 });
    return { cancel: () => window.cancelIdleCallback(id) };
  }
  const id = setTimeout(callback, 300);
  return { cancel: () => clearTimeout(id) };
}

/** Run the simulation forward a bit and draw one frame (for reduced motion). */
function drawStill(controller: MascotController) {
  const start = performance.now() / 1000;
  for (let k = 0; k <= 30; k++) controller.advance(start + k * 0.05);
  controller.render(start + 1.55);
}

/**
 * Bobble. Shows a CSS poster instantly, lazy-loads the 3D mascot (three.js is
 * its own chunk), and only renders while on screen and in a visible tab.
 */
export function Mascot({
  state = "idle",
  color,
  size,
  follow,
  interactive,
  label,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<MascotController | null>(null);
  const [ready, setReady] = useState(false);
  const initial = useRef({ state, color });
  initial.current = { state, color };

  // Create the 3D mascot once per size; state and colour are pushed in below.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canRender3D()) return;
    const reduced = prefersReducedMotion();
    let disposed = false;
    let frame = 0;
    let onScreen = true;
    let controller: MascotController | null = null;

    const loop = (ms: number) => {
      frame = 0;
      if (!controller || !onScreen || document.hidden) return;
      controller.render(ms / 1000);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!frame && !reduced && controller) frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
      if (onScreen) start();
      else stop();
    });
    observer.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    const onContextLost = () => {
      stop();
      setReady(false); // fall back to the poster
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    // Fetch the 3D engine once the browser is idle, so it never competes with
    // the page's own requests on a slow connection; the poster covers the gap.
    const idle = whenIdle(() => {
      import("./engine/scene")
        .then(({ createMascot }) => {
          if (disposed) return;
          controller = createMascot(canvas, {
            color: initial.current.color,
            state: initial.current.state,
            shells: shellsFor(size),
          });
          controller.resize(size, size);
          controllerRef.current = controller;
          if (reduced) drawStill(controller);
          else start();
          setReady(true);
        })
        .catch(() => {
          // No WebGL after all (or the chunk failed): the poster stays.
        });
    });

    return () => {
      disposed = true;
      idle.cancel();
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      controller?.dispose();
      controllerRef.current = null;
      setReady(false);
    };
  }, [size]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !ready) return;
    controller.setState(state);
    controller.setColor(color);
    if (prefersReducedMotion()) drawStill(controller);
  }, [state, color, ready]);

  // Eyes follow the pointer, measured from Bobble's own position on the page.
  useEffect(() => {
    if (!follow || !ready) return;
    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - (rect.left + rect.width / 2)) / (window.innerWidth / 2);
      const y = -(e.clientY - (rect.top + rect.height / 2)) / (window.innerHeight / 2);
      controllerRef.current?.setLook(x, y);
    };
    const onLeave = () => controllerRef.current?.setLook(0, 0);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [follow, ready]);

  const body = (
    <>
      <MascotPoster
        color={color}
        state={state}
        className={cx("transition-opacity duration-500", ready && "opacity-0")}
      />
      <canvas
        ref={canvasRef}
        className={cx(
          "absolute inset-0 size-full transition-opacity duration-500",
          ready ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  );
  const frameStyle = { width: size, height: size };

  if (interactive) {
    const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
      type: "button",
      "aria-label": label ?? "Poke Bobble",
      onClick: () => controllerRef.current?.poke(),
    };
    return (
      <button
        {...buttonProps}
        className={cx("relative shrink-0 cursor-pointer select-none", className)}
        style={frameStyle}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cx("relative shrink-0 select-none", className)}
      style={frameStyle}
    >
      {body}
    </div>
  );
}
