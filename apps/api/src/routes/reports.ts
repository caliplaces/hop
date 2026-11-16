import { type Block, normalizeHandle, reportSchema } from "@hop/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { getDb } from "../db";
import { blocks, files, type ReportRow, reports } from "../db/schema";
import { sendReportEmail } from "../email/report";
import type { AppEnv } from "../env";
import { newId, sha256Hex } from "../lib/crypto";
import { clientIp, fail } from "../lib/http";
import { currentUser, requireUser } from "../lib/session";
import { validate } from "../lib/validate";
import { findUserByHandle } from "./auth";

/**
 * Reports and blocks (App Store Guideline 1.2). Anyone with an athlete's link
 * can send them clips, so an athlete can report a clip to Hop's team and
 * block its sender from sending more; anyone can report an athlete's page.
 * See "Reports and blocks" in the README.
 */
export const reportRoutes = new Hono<AppEnv>()
  /** An athlete reports a clip sent to them. */
  .post("/me/files/:fileId/report", requireUser, validate("json", reportSchema), async (c) => {
    const user = currentUser(c);
    if (await tooManyReports(c, `report:${user.id}`)) {
      return fail(c, 429, "rate_limited", "Too many reports. Try again in a minute.");
    }
    const db = getDb(c.env.DB);
    const file = await ownedFile(c, user.id);
    if (!file) return fail(c, 404, "not_found");
    const input = c.req.valid("json");
    const report = await db
      .insert(reports)
      .values({
        id: newId("rep"),
        kind: "clip",
        reason: input.reason,
        note: input.note || null,
        reporterId: user.id,
        subjectUserId: file.contributorUserId,
        fileId: file.id,
        contributorName: file.contributorName,
        senderKey: file.senderKey,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    tellTheTeam(c, report, user.handle);
    return c.json({ ok: true });
  })

  /**
   * An athlete blocks whoever sent a clip: by account if they were signed in,
   * else by their browser's key (lib/senders.ts). Blocking twice is fine.
   */
  .post("/me/files/:fileId/block", requireUser, async (c) => {
    const user = currentUser(c);
    if (await tooManyReports(c, `block:${user.id}`)) {
      return fail(c, 429, "rate_limited", "Too many blocks. Try again in a minute.");
    }
    const db = getDb(c.env.DB);
    const file = await ownedFile(c, user.id);
    if (!file) return fail(c, 404, "not_found");
    if (file.contributorUserId === user.id) {
      return fail(c, 400, "cant_block_yourself", "That clip is from you.");
    }
    const by = file.contributorUserId
      ? { contributorUserId: file.contributorUserId, senderKey: null }
      : file.senderKey
        ? { contributorUserId: null, senderKey: file.senderKey }
        : null;
    if (!by) {
      // Clips from before sender keys carry no way to recognise their sender.
      return fail(c, 422, "cant_block", "This clip's sender can't be blocked. You can report it.");
    }
    await db
      .insert(blocks)
      .values({
        id: newId("blk"),
        ownerId: user.id,
        ...by,
        label: file.contributorName,
        createdAt: Date.now(),
      })
      .onConflictDoNothing();
    return c.json({ ok: true });
  })

  /** Who the athlete has blocked, newest first. */
  .get("/me/blocks", requireUser, async (c) => {
    const user = currentUser(c);
    const rows = await getDb(c.env.DB)
      .select({ id: blocks.id, label: blocks.label, createdAt: blocks.createdAt })
      .from(blocks)
      .where(eq(blocks.ownerId, user.id))
      .orderBy(desc(blocks.createdAt));
    return c.json({ blocks: rows satisfies Block[] });
  })

  /** Unblocks a sender. */
  .delete("/me/blocks/:blockId", requireUser, async (c) => {
    const user = currentUser(c);
    const removed = await getDb(c.env.DB)
      .delete(blocks)
      .where(and(eq(blocks.id, c.req.param("blockId")), eq(blocks.ownerId, user.id)))
      .returning({ id: blocks.id });
    if (removed.length === 0) return fail(c, 404, "not_found");
    return c.json({ ok: true });
  })

  /** Anyone reports an athlete's page (its name or photo, say). */
  .post("/h/:handle/report", validate("json", reportSchema), async (c) => {
    const ipHash = await sha256Hex(`${c.env.SESSION_SECRET}:${clientIp(c)}`);
    if (await tooManyReports(c, `report-ip:${ipHash}`)) {
      return fail(c, 429, "rate_limited", "Too many reports. Try again in a minute.");
    }
    const db = getDb(c.env.DB);
    const owner = await findUserByHandle(db, normalizeHandle(c.req.param("handle")));
    if (!owner || owner.deletedAt) return fail(c, 404, "not_found", "This Hop doesn't exist.");
    const input = c.req.valid("json");
    const report = await db
      .insert(reports)
      .values({
        id: newId("rep"),
        kind: "profile",
        reason: input.reason,
        note: input.note || null,
        reporterIpHash: ipHash,
        subjectUserId: owner.id,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    tellTheTeam(c, report, owner.handle);
    return c.json({ ok: true });
  });

/** A clip sent to this athlete, from the route's :fileId. */
function ownedFile(c: Context<AppEnv>, userId: string) {
  return getDb(c.env.DB)
    .select()
    .from(files)
    .where(and(eq(files.id, c.req.param("fileId") ?? ""), eq(files.ownerId, userId)))
    .get();
}

/** After the response; the report is kept even if the email fails. */
function tellTheTeam(c: Context<AppEnv>, report: ReportRow, handle: string | null) {
  c.executionCtx.waitUntil(
    sendReportEmail(c.env, { report, handle }).catch((error) =>
      console.error("Report email failed", report.id, error),
    ),
  );
}

async function tooManyReports(c: Context<AppEnv>, key: string): Promise<boolean> {
  const { success } = await c.env.REPORT_LIMITER.limit({ key });
  return !success;
}
