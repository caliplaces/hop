/** @jsxImportSource hono/jsx */
import { type PaletteColor, textOn } from "@hop/shared";
import type { Child } from "hono/jsx";
import { DARK_MODE_CSS, FONT, light, tint } from "./theme";

/**
 * Building blocks for Hop's emails. Email clients only reliably support tables
 * and inline styles, so that's what these render; hono/jsx escapes every text
 * value and attribute.
 */

const BRAND_FACE = "grape";

export async function renderEmail(document: Child): Promise<string> {
  return `<!DOCTYPE html>${await Promise.resolve(document?.toString() ?? "")}`;
}

/** A table that's only there for layout, so screen readers skip it. */
function Layout({ children, width = "100%" }: { children: Child; width?: string }) {
  return (
    <table
      role="presentation"
      width={width}
      cellpadding="0"
      cellspacing="0"
      border={0}
      style={{ borderCollapse: "collapse" }}
    >
      {children}
    </table>
  );
}

export function EmailDocument({
  appUrl,
  title,
  preheader,
  footer,
  children,
}: {
  appUrl: string;
  title: string;
  /** The preview line inbox lists show after the subject. */
  preheader: string;
  footer: Child;
  children: Child;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: DARK_MODE_CSS }} />
      </head>
      <body class="bg" style={{ margin: "0", padding: "0", backgroundColor: light.bg }}>
        <div
          style={{ display: "none", maxHeight: "0", overflow: "hidden", opacity: "0" }}
          aria-hidden="true"
        >
          {/* Padding keeps clients from pulling body text into the preview. */}
          {preheader}
          {" ‌".repeat(60)}
        </div>
        <Layout>
          <tr>
            <td
              class="bg"
              align="center"
              style={{ padding: "32px 12px 40px", backgroundColor: light.bg, fontFamily: FONT }}
            >
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border={0}
                style={{ maxWidth: "560px", borderCollapse: "collapse" }}
              >
                <tr>
                  <td style={{ padding: "0 8px 20px" }}>
                    <a href={appUrl} style={{ textDecoration: "none" }}>
                      <Layout width="auto">
                        <tr>
                          <td style={{ paddingRight: "6px" }}>
                            <img
                              src={`${appUrl}/bobble/face-${BRAND_FACE}.png`}
                              width="32"
                              height="32"
                              alt=""
                              style={{ display: "block", border: "0" }}
                            />
                          </td>
                          <td
                            class="ink"
                            style={{
                              color: light.ink,
                              fontSize: "22px",
                              fontWeight: "700",
                              letterSpacing: "-0.02em",
                            }}
                          >
                            hop
                          </td>
                        </tr>
                      </Layout>
                    </a>
                  </td>
                </tr>
                <tr>
                  <td
                    class="card"
                    style={{
                      backgroundColor: light.surface,
                      border: `1px solid ${light.line}`,
                      borderRadius: "28px",
                      padding: "32px",
                    }}
                  >
                    {children}
                  </td>
                </tr>
                <tr>
                  <td
                    class="muted"
                    style={{
                      padding: "24px 8px 0",
                      color: light.muted,
                      fontSize: "13px",
                      lineHeight: "20px",
                    }}
                  >
                    {footer}
                    <p style={{ margin: "12px 0 0" }}>
                      Hop · <FooterLink href={appUrl}>{new URL(appUrl).host}</FooterLink> ·{" "}
                      <FooterLink href="https://github.com/caliplaces/hop">Open source</FooterLink>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </Layout>
      </body>
    </html>
  );
}

function FooterLink({ href, children }: { href: string; children: Child }) {
  return (
    <a href={href} style={{ color: light.muted, textDecoration: "underline" }}>
      {children}
    </a>
  );
}

/** Bobble on a soft panel in the athlete's colour. */
export function Hero({ src, color }: { src: string; color: PaletteColor }) {
  return (
    <Layout>
      <tr>
        <td
          class="panel"
          align="center"
          style={{
            backgroundColor: tint(color.hex, 0.14),
            borderRadius: "22px",
            padding: "16px 0 8px",
          }}
        >
          <img
            src={src}
            width="200"
            height="200"
            alt=""
            style={{ display: "block", border: "0", width: "200px", height: "200px" }}
          />
        </td>
      </tr>
    </Layout>
  );
}

export function Title({ children }: { children: Child }) {
  return (
    <h1
      class="ink title"
      style={{
        margin: "28px 0 0",
        color: light.ink,
        fontSize: "30px",
        lineHeight: "36px",
        fontWeight: "700",
        letterSpacing: "-0.02em",
      }}
    >
      {children}
    </h1>
  );
}

export function Subtitle({ children }: { children: Child }) {
  return (
    <h2
      class="ink"
      style={{
        margin: "32px 0 16px",
        color: light.ink,
        fontSize: "18px",
        lineHeight: "24px",
        fontWeight: "700",
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </h2>
  );
}

export function Text({ children, muted = false }: { children: Child; muted?: boolean }) {
  return (
    <p
      class={muted ? "muted" : "ink"}
      style={{
        margin: "12px 0 0",
        color: muted ? light.muted : light.ink,
        fontSize: "16px",
        lineHeight: "24px",
      }}
    >
      {children}
    </p>
  );
}

/** The athlete's link, big, in their colour. */
export function LinkPill({
  href,
  label,
  color,
}: {
  href: string;
  label: string;
  color: PaletteColor;
}) {
  return (
    <Layout>
      <tr>
        <td
          align="center"
          style={{ backgroundColor: color.hex, borderRadius: "999px", padding: "16px 20px" }}
        >
          <a
            href={href}
            style={{
              color: textOn(color.hex),
              fontSize: "20px",
              lineHeight: "24px",
              fontWeight: "700",
              letterSpacing: "-0.01em",
              textDecoration: "none",
            }}
          >
            {label}
          </a>
        </td>
      </tr>
    </Layout>
  );
}

/** Numbered steps with the numbers on the athlete's colour. */
export function Steps({
  items,
  color,
}: {
  items: { title: string; body: string }[];
  color: PaletteColor;
}) {
  return (
    <Layout>
      {items.map((item, index) => (
        <tr>
          <td width="44" valign="top" style={{ paddingBottom: "18px" }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "999px",
                backgroundColor: color.hex,
                color: textOn(color.hex),
                fontSize: "14px",
                lineHeight: "28px",
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              {index + 1}
            </div>
          </td>
          <td valign="top" style={{ paddingBottom: "18px" }}>
            <p
              class="ink"
              style={{
                margin: "3px 0 0",
                color: light.ink,
                fontSize: "16px",
                lineHeight: "22px",
                fontWeight: "600",
              }}
            >
              {item.title}
            </p>
            <p
              class="muted"
              style={{
                margin: "4px 0 0",
                color: light.muted,
                fontSize: "15px",
                lineHeight: "22px",
              }}
            >
              {item.body}
            </p>
          </td>
        </tr>
      ))}
    </Layout>
  );
}

/** The main call to action: an ink pill (light in dark mode). */
export function Button({ href, children }: { href: string; children: Child }) {
  return (
    <Layout width="auto">
      <tr>
        <td
          class="button"
          style={{ backgroundColor: light.ink, borderRadius: "999px", textAlign: "center" }}
        >
          <a
            href={href}
            style={{
              display: "inline-block",
              padding: "14px 26px",
              color: "#ffffff",
              fontSize: "16px",
              lineHeight: "20px",
              fontWeight: "600",
              textDecoration: "none",
            }}
          >
            {children}
          </a>
        </td>
      </tr>
    </Layout>
  );
}

export function Divider() {
  return (
    <div
      class="rule"
      style={{ borderTop: `1px solid ${light.line}`, margin: "28px 0 0", lineHeight: "0" }}
    />
  );
}
