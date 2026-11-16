/** @jsxImportSource hono/jsx */
import { DEFAULT_HOP_SLUG, type PaletteColor } from "@hop/shared";
import { Button, EmailDocument, Hero, renderEmail, Text, Title } from "./layout";
import type { RenderedEmail } from "./send";
import { light } from "./theme";

export type NewClipsInput = {
  appUrl: string;
  color: PaletteColor;
  /** One entry per clip in this digest. */
  clips: { hopId: string; contributor: string | null }[];
  /** The athlete's Hops, for titles. */
  hops: { id: string; slug: string; title: string }[];
  unsubscribeUrl: string;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Contributor names are typed by strangers, and mail apps turn anything that
 * looks like a web address into a link. A zero-width space after dots, colons
 * and slashes keeps "evil.example" plain text.
 */
function defuse(name: string): string {
  return name.replace(/[.:/]/g, (ch) => `${ch}​`);
}

/**
 * Names for a notification: no link-defusing needed, but nothing that could
 * break a line or hide in it.
 */
function plain(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
}

/** "Coach Peter", "Coach Peter and Lea", "Coach Peter, Lea and 3 others". */
export function describePeople(
  contributors: (string | null)[],
  clean: (name: string) => string = defuse,
): string {
  const names = [
    ...new Set(contributors.map((n) => (n ? clean(n) : "")).filter((n) => n.length > 0)),
  ];
  const anonymous = contributors.some((n) => !n);
  if (names.length === 0) return "Someone";
  const shown = names.slice(0, 2);
  const others = names.length - shown.length + (anonymous ? 1 : 0);
  if (others === 0) return shown.join(" and ");
  return `${shown.join(", ")} and ${others === 1 ? "1 other" : `${others} others`}`;
}

/** What a digest says, by email or on the phone. */
function summarize(
  clips: NewClipsInput["clips"],
  hops: NewClipsInput["hops"],
  clean: (name: string) => string,
) {
  const count = clips.length;
  const counts = new Map<string, number>();
  for (const clip of clips) counts.set(clip.hopId, (counts.get(clip.hopId) ?? 0) + 1);
  const byHop = [...counts]
    .map(([hopId, n]) => ({ hop: hops.find((h) => h.id === hopId), count: n }))
    .sort((a, b) => b.count - a.count);
  const single = byHop.length === 1 ? byHop[0]?.hop : undefined;
  // "from Street Kings Prague" reads well; "from Main", the standing Hop, doesn't.
  const event = single && single.slug !== DEFAULT_HOP_SLUG ? clean(single.title) : null;
  const people = describePeople(
    clips.map((clip) => clip.contributor),
    clean,
  );
  const headline = event
    ? `${plural(count, "new clip")} from ${event}`
    : `${plural(count, "new clip")} on your Hop`;
  const sent = `${people} sent you ${count === 1 ? "a clip" : "clips"}`;
  return { count, byHop, single, event, headline, sent };
}

/** Sent by the new-clips digest (notify.ts) once a burst of uploads goes quiet. */
export async function newClipsEmail({
  appUrl,
  color,
  clips,
  hops,
  unsubscribeUrl,
}: NewClipsInput): Promise<RenderedEmail> {
  const { count, byHop, single, event, headline: subject, sent } = summarize(clips, hops, defuse);
  const sentence = `${sent}${event ? ` from ${event}` : ""}.`;
  const inboxUrl = single ? `${appUrl}/app?hop=${encodeURIComponent(single.id)}` : `${appUrl}/app`;
  const footer = "You’re getting this because new clips arrived on your Hop.";
  const breakdown = byHop.length > 1 ? byHop : [];

  const html = await renderEmail(
    <EmailDocument
      appUrl={appUrl}
      title={subject}
      preheader={sentence}
      footer={
        <p style={{ margin: "0" }}>
          {footer}{" "}
          <a href={unsubscribeUrl} style={{ color: light.muted, textDecoration: "underline" }}>
            Unsubscribe
          </a>
        </p>
      }
    >
      <Hero src={`${appUrl}/email/busy-${color.id}.png`} color={color} />
      <Title>{plural(count, "new clip")}!</Title>
      <Text>{sentence}</Text>
      {breakdown.length > 0 && (
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border={0}
          style={{ borderCollapse: "collapse", marginTop: "20px" }}
        >
          {breakdown.map(({ hop, count: n }) => (
            <tr>
              <td
                class="ink rule"
                style={{
                  padding: "12px 0",
                  borderTop: `1px solid ${light.line}`,
                  color: light.ink,
                  fontSize: "16px",
                  fontWeight: "600",
                }}
              >
                {hop?.title ?? "A Hop"}
              </td>
              <td
                class="muted rule"
                align="right"
                style={{
                  padding: "12px 0",
                  borderTop: `1px solid ${light.line}`,
                  color: light.muted,
                  fontSize: "15px",
                  whiteSpace: "nowrap",
                }}
              >
                {plural(n, "clip")}
              </td>
            </tr>
          ))}
        </table>
      )}
      <div style={{ height: "28px", lineHeight: "28px" }}>&nbsp;</div>
      <Button href={inboxUrl}>{count === 1 ? "Watch it" : "Watch them"}</Button>
    </EmailDocument>,
  );

  const text = [
    `${plural(count, "new clip")}!`,
    "",
    sentence,
    ...(breakdown.length > 0
      ? [
          "",
          ...breakdown.map(
            ({ hop, count: n }) => `- ${hop?.title ?? "A Hop"}: ${plural(n, "clip")}`,
          ),
        ]
      : []),
    "",
    `Watch them: ${inboxUrl}`,
    "",
    "--",
    footer,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * The same digest on the athlete's phone: "3 new clips from Street Kings
 * Prague", "Coach Peter and Lea sent you clips." `hopId` is the one event
 * they're all in, if they are, for the app to open.
 */
export function newClipsPush({ clips, hops }: Pick<NewClipsInput, "clips" | "hops">) {
  const { headline, sent, single } = summarize(clips, hops, plain);
  return { alert: { title: headline, body: `${sent}.` }, hopId: single?.id ?? null };
}
