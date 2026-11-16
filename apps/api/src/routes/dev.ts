import { colorFor } from "@hop/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { files, hops } from "../db/schema";
import { accountDeletedEmail } from "../email/account-deleted";
import { clipsExpiringEmail } from "../email/clips-expiring";
import { launchEmail } from "../email/launch";
import { newClipsEmail } from "../email/new-clips";
import { reportsEmail } from "../email/report";
import type { RenderedEmail } from "../email/send";
import { welcomeEmail } from "../email/welcome";
import type { AppEnv } from "../env";
import { newId, verifyPayload } from "../lib/crypto";
import { originalKey } from "../lib/files";
import { BodyTooLargeError, fail, readBodyCapped } from "../lib/http";
import { contentDisposition, type DevObjectToken, type DevPartToken } from "../lib/storage";
import { validate } from "../lib/validate";
import { pushArrivals } from "../live";

type Query = (key: string) => string | undefined;

/** Every email with sample data, for the email lab (apps/web/email-lab.html). */
const EMAIL_PREVIEWS: Record<string, (appUrl: string, query: Query) => Promise<RenderedEmail>> = {
  welcome: (appUrl, query) =>
    welcomeEmail({
      appUrl,
      handle: query("handle") || "matej",
      name: query("name") ?? "Matej Matiasko",
      color: colorFor(query("color"), "preview"),
    }),
  // ?handle= (empty) shows an account deleted before it claimed a handle.
  "account-deleted": (appUrl, query) =>
    accountDeletedEmail({ appUrl, handle: query("handle") ?? "matej" }),
  // ?count=3 shows several in one email.
  report: (appUrl, query) => {
    const base = {
      reporterId: "usr_preview",
      reporterIpHash: null,
      subjectUserId: null,
      fileId: "fil_preview",
      contributorName: "SmokyMonkey441",
      senderKey: "preview",
      clipNote: "lol look at this",
      clipName: "IMG_0412.MOV",
      emailBatch: null,
      emailedAt: null,
      createdAt: Date.now(),
    };
    const samples = [
      {
        ...base,
        id: "rep_1",
        kind: "clip" as const,
        reason: "harassment" as const,
        note: "They keep sending the same clip with a rude caption.",
      },
      { ...base, id: "rep_2", kind: "block" as const, reason: "other" as const, note: null },
      {
        ...base,
        id: "rep_3",
        kind: "profile" as const,
        reason: "sexual" as const,
        note: "Their photo",
        reporterId: null,
        fileId: null,
        contributorName: null,
        clipNote: null,
        clipName: null,
      },
    ];
    const count = Math.min(Math.max(Number(query("count")) || 1, 1), samples.length);
    return reportsEmail(
      appUrl,
      samples.slice(0, count).map((report) => ({ report, handle: "matej" })),
    );
  },
  // ?when=reminder for the day before; ?count= for how many.
  "clips-expiring": (appUrl, query) =>
    clipsExpiringEmail({
      appUrl,
      clips: Math.max(Number(query("count")) || 12, 1),
      at: Date.now() + (query("when") === "reminder" ? 1 : 7) * 24 * 60 * 60 * 1000,
      when: query("when") === "reminder" ? "reminder" : "notice",
    }),
  // ?app=1 adds the App Store link.
  launch: (appUrl, query) =>
    launchEmail({
      appUrl,
      appStoreUrl: query("app") ? "https://apps.apple.com/app/id6834920854" : undefined,
    }),
  "new-clips": (appUrl, query) => {
    const hops = [
      { id: "hop_1", slug: "street-kings-prague", title: "Street Kings Prague" },
      { id: "hop_2", slug: "inbox", title: "Main" },
    ];
    const names = ["Coach Peter", "Lea from the crew", "SmokyMonkey441", "@nina", null];
    // ?count=5&hops=2 shapes the sample.
    const count = Math.min(Math.max(Number(query("count")) || 5, 1), 50);
    const spread = query("hops") === "2" ? 2 : 1;
    return newClipsEmail({
      appUrl,
      color: colorFor(query("color"), "preview"),
      clips: Array.from({ length: count }, (_, i) => ({
        hopId: hops[i % spread]?.id ?? "hop_1",
        contributor: names[i % names.length] ?? null,
      })),
      hops,
      unsubscribeUrl: `${appUrl}/unsubscribe?token=preview`,
    });
  },
};

/**
 * Local development helpers, mounted only for ENVIRONMENT=development on a
 * localhost hostname (see index.ts): stand-ins for R2's presigned S3 URLs,
 * since the R2 simulator has no S3 endpoint, email previews, and fake clips
 * for trying Event mode.
 */
export const devRoutes = new Hono<AppEnv>()
  /**
   * A fake clip lands in a hop, as if someone had just uploaded it: it counts
   * in Event mode and is pushed to Live Activities, but has no file behind it.
   * POST /api/dev/hops/<hop id>/arrivals with {"from": "Mia"} (optional).
   */
  .post(
    "/hops/:hopId/arrivals",
    validate("json", z.object({ from: z.string().max(40).optional() })),
    async (c) => {
      const db = getDb(c.env.DB);
      const hop = await db
        .select()
        .from(hops)
        .where(eq(hops.id, c.req.param("hopId")))
        .get();
      if (!hop) return fail(c, 404, "not_found");
      const id = newId("fil");
      const now = Date.now();
      await db.insert(files).values({
        id,
        hopId: hop.id,
        ownerId: hop.ownerId,
        r2Key: originalKey(hop.id, id),
        originalName: "IMG_0001.MOV",
        mime: "video/quicktime",
        size: 1_000_000,
        partSize: 1_000_000,
        partCount: 1,
        status: "complete",
        passId: "dev",
        uploadTokenHash: "dev",
        contributorName: c.req.valid("json").from ?? null,
        createdAt: now,
        lastActivityAt: now,
        completedAt: now,
        // Already announced: no digest email for a fake clip.
        notifiedAt: now,
      });
      await pushArrivals(c.env, hop.id, now);
      return c.json({ id });
    },
  )

  .get("/emails", (c) => c.json({ emails: Object.keys(EMAIL_PREVIEWS) }))

  .get("/emails/:name", async (c) => {
    const name = c.req.param("name");
    const preview = Object.hasOwn(EMAIL_PREVIEWS, name) ? EMAIL_PREVIEWS[name] : undefined;
    if (!preview) return fail(c, 404, "not_found");
    return c.json(await preview(c.env.APP_URL, (key) => c.req.query(key)));
  })

  .put("/part", async (c) => {
    const token = await verifyPayload<DevPartToken>(
      c.env.SESSION_SECRET,
      c.req.query("token"),
      "dev-part",
    );
    if (!token) return fail(c, 403, "invalid_token");
    let body: Uint8Array;
    try {
      body = await readBodyCapped(c.req.raw, token.contentLength);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return fail(c, 400, "invalid_length");
      throw error;
    }
    // Same rule as the signed Content-Length on real presigned URLs.
    if (body.byteLength !== token.contentLength) return fail(c, 400, "invalid_length");
    const multipart = c.env.BUCKET.resumeMultipartUpload(token.key, token.uploadId);
    const part = await multipart.uploadPart(token.partNumber, body);
    // Mimic S3, which returns quoted ETags.
    return new Response(null, {
      headers: { etag: `"${part.etag}"`, "access-control-expose-headers": "ETag" },
    });
  })

  .get("/object", async (c) => {
    const token = await verifyPayload<DevObjectToken>(
      c.env.SESSION_SECRET,
      c.req.query("token"),
      "dev-object",
    );
    if (!token) return fail(c, 403, "invalid_token");
    const object = await c.env.BUCKET.get(token.key, { range: c.req.raw.headers });
    if (!object) return fail(c, 404, "not_found");

    const headers = new Headers({
      "content-type": token.mime,
      "content-disposition": contentDisposition(token.filename, token.download),
      "accept-ranges": "bytes",
      etag: object.httpEtag,
      "x-content-type-options": "nosniff",
    });
    const range = object.range as { offset?: number; length?: number } | undefined;
    if (range && c.req.header("range")) {
      const offset = range.offset ?? 0;
      const length = range.length ?? object.size - offset;
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("content-length", String(length));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set("content-length", String(object.size));
    return new Response(object.body, { headers });
  });
