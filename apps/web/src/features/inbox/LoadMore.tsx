import { useEffect, useRef } from "react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";

/**
 * Loads the next page shortly before the user reaches the end of the grid.
 * The observer only fires on entering view, so a failed load shows a retry.
 */
export function LoadMore({
  onLoad,
  loading,
  failed,
}: {
  onLoad: () => void;
  loading: boolean;
  failed: boolean;
}) {
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
    <div
      ref={ref}
      className="flex min-h-16 items-center justify-center gap-3 py-4 text-sm text-muted"
    >
      {loading ? (
        <Spinner />
      ) : failed ? (
        <>
          Couldn’t load more clips.
          <Button variant="soft" size="sm" onClick={onLoad}>
            Retry
          </Button>
        </>
      ) : null}
    </div>
  );
}
