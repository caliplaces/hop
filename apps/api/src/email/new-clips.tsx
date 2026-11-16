/** @jsxImportSource hono/jsx */
import { cleanName, DEFAULT_HOP_SLUG, type PaletteColor } from "@hop/shared";
import { Button, EmailDocument, Hero, renderEmail, Text, Title } from "./layout";
import type { RenderedEmail } from "./send";
import { light } from "./theme";

export type NewClipsInput = {
  appUrl: string;
  color: PaletteColor;
  /**
   * One entry per clip in this digest. `verified` is a signed-in
   * contributor, whose name is their @handle.
   */
  clips: { hopId: string; contributor: string | null; verified?: boolean }[];
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

/** Keeps right-to-left text in a name from reordering the sentence around it. */
const isolate = (text: string) => `\u2068${text}\u2069`;

/**
 * A contributor's name for a notification: no link-defusing needed, but
 * cleaned as names are on the way in (cleanName; older names predate it),
 * and only a signed-in contributor's verified handle may start with @.
 */
function pushName(name: string | null, verified: boolean): string | null {
  if (!name) return null;
  const clean = cleanName(name);
  const shown = verified ? clean : clean.replace(/^@+/, "").trim();
  return shown ? isolate(shown) : null;
}

/** "Coach Peter", "Coach Peter and Lea", "Coach Peter, Lea and 3 others". */
export function describePeople(
  contributors: (string | null)[],
  clean: (name: string) => string = defuse,
): string {
  const names = [...new Set(contributors.filter((n): n is string => Boolean(n)).map(clean))];
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
  show: { names: (string | null)[]; title: (title: string) => string },
) {
  const count = clips.length;
  const counts = new Map<string, number>();
  for (const clip of clips) counts.set(clip.hopId, (counts.get(clip.hopId) ?? 0) + 1);
  const byHop = [...counts]
    .map(([hopId, n]) => ({ hop: hops.find((h) => h.id === hopId), count: n }))
    .sort((a, b) => b.count - a.count);
  const single = byHop.length === 1 ? byHop[0]?.hop : undefined;
  // "from Street Kings Prague" reads well; "from Main", the standing Hop, doesn't.
  const event = single && single.slug !== DEFAULT_HOP_SLUG ? show.title(single.title) : null;
  const people = describePeople(show.names, (name) => name);
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
  const {
    count,
    byHop,
    single,
    event,
    headline: subject,
    sent,
  } = summarize(clips, hops, {
    names: clips.map((clip) => (clip.contributor ? defuse(clip.contributor) : null)),
    // The athlete's own title, as they typed it.
    title: (title) => title,
  });
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
  const { headline, sent, single } = summarize(clips, hops, {
    names: clips.map((clip) => pushName(clip.contributor, clip.verified ?? false)),
    title: (title) => isolate(cleanName(title)),
  });
  return { alert: { title: headline, body: `${sent}.` }, hopId: single?.id ?? null };
}
