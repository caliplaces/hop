import { useLayoutEffect } from "react";

type PageTheme = "dark";

const CANVAS: Record<PageTheme, string> = { dark: "#0b0b0c" };

/**
 * Pins the page to one colour scheme whatever the system setting, or (with
 * null) hands it back to the system. styles.css maps html[data-theme] to the
 * tokens; the browser toolbar colour follows along.
 */
export function applyPageTheme(theme: PageTheme | null) {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;

  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.dataset.systemContent ??= meta.content;
    meta.content = theme ? CANVAS[theme] : meta.dataset.systemContent;
  }
}

/** Pins the page's theme while the calling component is mounted. */
export function usePageTheme(theme: PageTheme) {
  useLayoutEffect(() => {
    applyPageTheme(theme);
    return () => applyPageTheme(null);
  }, [theme]);
}
