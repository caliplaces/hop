/**
 * Email design tokens, mirroring the web app's (apps/web/src/styles.css):
 * a neutral base where the athlete's colour, and Bobble in it, is the accent.
 * Email clients need literal values, so these are hex codes, not variables.
 */
export const light = {
  bg: "#fafaf7",
  surface: "#ffffff",
  ink: "#0b0b0c",
  muted: "#6b6b66",
  line: "#ebebe6",
} as const;

export const dark = {
  bg: "#0b0b0c",
  surface: "#151517",
  panel: "#1d1d20",
  ink: "#f4f4ef",
  muted: "#a1a19b",
  line: "#26262a",
} as const;

/**
 * The system UI font. Emails load no web fonts: fetching one from a font CDN
 * would tell that CDN each time someone opens an email.
 */
export const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The athlete's colour mixed into white: a soft panel Bobble stands out on. */
export function tint(hex: string, amount: number): string {
  const channel = (i: number) => {
    const value = Number.parseInt(hex.slice(i, i + 2), 16);
    return Math.round(255 + (value - 255) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * Dark-mode overrides for clients that support them (Apple Mail, iOS Mail,
 * Outlook for Mac). Elements opt in with these class names; the inline styles
 * remain the light default everywhere else.
 */
export const DARK_MODE_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .bg { background-color: ${dark.bg} !important; }
  .card { background-color: ${dark.surface} !important; border-color: ${dark.line} !important; }
  .panel { background-color: ${dark.panel} !important; }
  .ink { color: ${dark.ink} !important; }
  .muted, .muted a { color: ${dark.muted} !important; }
  .button { background-color: ${dark.ink} !important; }
  .button a { color: ${dark.bg} !important; }
  .rule { border-color: ${dark.line} !important; }
}
@media (max-width: 600px) {
  .card { padding: 24px 20px !important; }
  .title { font-size: 26px !important; line-height: 32px !important; }
  .pill { font-size: 17px !important; line-height: 22px !important; }
}
`;
