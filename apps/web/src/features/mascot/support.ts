let webgl2: boolean | null = null;

/** WebGL2 available and the user hasn't asked to save data. Cached per page. */
export function canRender3D(): boolean {
  if (typeof window === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return false;
  if (webgl2 === null) {
    try {
      webgl2 = Boolean(document.createElement("canvas").getContext("webgl2"));
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Fur shells by on-screen size and device class: plush where it shows, cheap where it doesn't. */
export function shellsFor(size: number): number {
  const lowEnd =
    (navigator.hardwareConcurrency ?? 8) <= 4 ||
    ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
  const shells = size >= 220 ? 28 : size >= 120 ? 18 : 12;
  return lowEnd ? Math.min(shells, 14) : shells;
}
