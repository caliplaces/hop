import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/**
 * Lays out children on a fixed design canvas (width × height, in px) and
 * scales it down to fit the container, so a composed scene keeps its exact
 * positions at every screen size.
 */
export function Scaled({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, offset: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = (available: number) => {
      const scale = Math.min(1, available / width);
      setBox({ scale, offset: (available - width * scale) / 2 });
    };
    measure(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div ref={ref} className="relative w-full" style={{ height: height * box.scale }}>
      <div
        className="absolute top-0 origin-top-left"
        style={{ width, height, left: box.offset, transform: `scale(${box.scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
