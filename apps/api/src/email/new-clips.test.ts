import { PALETTE } from "@hop/shared";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { describePeople, newClipsEmail } from "./new-clips";
import { listUnsubscribeHeaders, unsubscribeLinks, verifyUnsubscribeToken } from "./unsubscribe";

const color = PALETTE.find((c) => c.id === "mint") as (typeof PALETTE)[number];
const hops = [
  { id: "hop_event", slug: "street-kings-prague", title: "Street Kings Prague" },
  { id: "hop_main", slug: "inbox", title: "Main" },
];
const base = {
  appUrl: "https://onmyhop.com",
  color,
  hops,
  unsubscribeUrl: "https://onmyhop.com/unsubscribe?token=abc",
};

describe("describePeople", () => {
  it("names up to two people and counts the rest", () => {
    expect(describePeople(["Lea"])).toBe("Lea");
    expect(describePeople(["Lea", "Lea", "Peter"])).toBe("Lea and Peter");
    expect(describePeople(["Lea", "Peter", "Nina", "@matej"])).toBe("Lea, Peter and 2 others");
    expect(describePeople(["Lea", "Peter", null])).toBe("Lea, Peter and 1 other");
    expect(describePeople([null, null])).toBe("Someone");
  });

  it("keeps names that look like web addresses from becoming links", () => {
    expect(describePeople(["evil.example/login"])).toBe("evil.​example/​login");
  });
});

describe("new-clips email", () => {
  it("names the event when every clip is from one", async () => {
    const email = await newClipsEmail({
      ...base,
      clips: [
        { hopId: "hop_event", contributor: "Coach Peter" },
        { hopId: "hop_event", contributor: "Lea" },
        { hopId: "hop_event", contributor: "Coach Peter" },
      ],
    });
    expect(email.subject).toBe("3 new clips from Street Kings Prague");
    expect(email.text).toContain("Coach Peter and Lea sent you clips from Street Kings Prague.");
    expect(email.html).toContain('href="https://onmyhop.com/app?hop=hop_event"');
    expect(email.html).toContain("https://onmyhop.com/email/busy-mint.png");
    expect(email.text).toContain("Unsubscribe: https://onmyhop.com/unsubscribe?token=abc");
    expect(email.html).toContain('href="https://onmyhop.com/unsubscribe?token=abc"');
  });

  it("talks about the Hop, not 'Main', for the standing Hop", async () => {
    const email = await newClipsEmail({
      ...base,
      clips: [{ hopId: "hop_main", contributor: "SmokyMonkey441" }],
    });
    expect(email.subject).toBe("1 new clip on your Hop");
    expect(email.text).toContain("SmokyMonkey441 sent you a clip.");
    expect(email.text).toContain("Watch them: https://onmyhop.com/app?hop=hop_main");
  });

  it("breaks clips down by Hop when they span several", async () => {
    const email = await newClipsEmail({
      ...base,
      clips: [
        { hopId: "hop_main", contributor: "Lea" },
        { hopId: "hop_event", contributor: "Peter" },
        { hopId: "hop_event", contributor: "Nina" },
      ],
    });
    expect(email.subject).toBe("3 new clips on your Hop");
    expect(email.text).toContain("- Street Kings Prague: 2 clips\n- Main: 1 clip");
    expect(email.html).toContain('href="https://onmyhop.com/app"');
  });

  it("escapes what contributors typed", async () => {
    const email = await newClipsEmail({
      ...base,
      clips: [{ hopId: "hop_event", contributor: "<b>Peter</b>" }],
    });
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain("&lt;b&gt;Peter&lt;/\u200bb&gt;");
  });
});

describe("unsubscribe links", () => {
  const env = { APP_URL: "https://onmyhop.com", SESSION_SECRET: "test-secret" } as Env;

  it("carry a signed token for the account", async () => {
    const links = await unsubscribeLinks(env, "usr_1");
    expect(links.page.startsWith("https://onmyhop.com/unsubscribe?token=")).toBe(true);
    expect(links.oneClick.startsWith("https://onmyhop.com/api/email/unsubscribe?token=")).toBe(
      true,
    );
    const token = new URL(links.oneClick).searchParams.get("token");
    expect(await verifyUnsubscribeToken(env, token)).toMatchObject({
      userId: "usr_1",
      list: "new-clips",
    });
  });

  it("reject tampered or foreign tokens", async () => {
    const links = await unsubscribeLinks(env, "usr_1");
    const token = new URL(links.oneClick).searchParams.get("token") ?? "";
    expect(await verifyUnsubscribeToken(env, `${token}x`)).toBeNull();
    expect(
      await verifyUnsubscribeToken({ ...env, SESSION_SECRET: "other-secret" }, token),
    ).toBeNull();
    expect(await verifyUnsubscribeToken(env, "")).toBeNull();
  });

  it("let mail apps unsubscribe in one click", () => {
    expect(listUnsubscribeHeaders("https://onmyhop.com/api/email/unsubscribe?token=t")).toEqual({
      "List-Unsubscribe": "<https://onmyhop.com/api/email/unsubscribe?token=t>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
