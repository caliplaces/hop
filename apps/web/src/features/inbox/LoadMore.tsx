import { useEffect, useRef } from "react";
import { Spinner } from "../../components/ui/Spinner";

/** Loads the next page shortly before the user reaches the end of the grid. */
export function LoadMore({ onLoad, loading }: { onLoad: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && onLoadRef.current(),
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="flex h-16 items-center justify-center text-muted">
      {loading && <Spinner />}
    </div>
  );
}
