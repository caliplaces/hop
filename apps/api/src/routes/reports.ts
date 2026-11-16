import { type Block, normalizeHandle, pageReportSchema, reportSchema } from "@hop/shared";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { type Db, getDb } from "../db";
import { blockKeys, blocks, type FileRow, files, reports } from "../db/schema";
import type { AppEnv } from "../env";
import { newId, sha256Hex } from "../lib/crypto";
import { goneStatus, HOLD_MS } from "../lib/files";
import { clientIp, fail, ipRateKey } from "../lib/http";
import { currentUser, requireUser } from "../lib/session";
import { verifyTurnstile } from "../lib/turnstile";
import { validate } from "../lib/validate";
import { findUserByHandle } from "./auth";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reports and blocks (App Store Guideline 1.2). Anyone with an athlete's link
 * can send them clips, so an athlete can report a clip to Hop's team and
 * block its sender; anyone can report an athlete's page. Reports reach the
 * team by email from a five-minute job (src/reports.ts), never straight from
 * a request, so a flood of them can't flood the inbox. See "Reports and
 * blocks" in the README.
 */
export const reportRoutes = new Hono<AppEnv>()
  /**
   * An athlete reports a clip sent to them. The clip is held for the team
   * (lib/files.ts): deleting it afterwards only hides it until they've had
   * a look. Each clip is reported once; again changes nothing.
   */
  .post("/me/files/:fileId/report", requireUser, validate("json", reportSchema), async (c) => {
    const user = currentUser(c);
    if (await tooMany(c, `report:${user.id}`)) {
      return fail(c, 429, "rate_limited", "Too many reports. Try again in a minute.");
    }
    const db = getDb(c.env.DB);
    const file = await ownedFile(db, c.req.param("fileId"), user.id);
    if (!file) return fail(c, 404, "not_found");
    const input = c.req.valid("json");
    const now = Date.now();
    await db.batch([
      db
        .insert(reports)
        .values({
          ...aboutClip(file),
          id: newId("rep"),
          kind: "clip",
          reason: input.reason,
          note: input.note || null,
          reporterId: user.id,
          createdAt: now,
        })
        .onConflictDoNothing(),
      // Not one already going: deleting it claimed it first (lib/files.ts).
      db
        .update(files)
        .set({ heldUntil: sql`max(coalesce(${files.heldUntil}, 0), ${now + HOLD_MS})` })
        .where(and(eq(files.id, file.id), inArray(files.status, ["pending", "complete", "held"]))),
    ]);
    return c.json({ ok: true });
  })

  /**
   * An athlete blocks whoever sent a clip: by account and browser key, as
   * known (lib/senders.ts). Their clips leave the athlete's inbox, uploads
   * under way included, and Hop's team hears of it. Blocking twice is fine.
   */
  .post("/me/files/:fileId/block", requireUser, async (c) => {
    const user = currentUser(c);
    if (await tooMany(c, `block:${user.id}`)) {
      return fail(c, 429, "rate_limited", "Too many blocks. Try again in a minute.");
    }
    const db = getDb(c.env.DB);
    const file = await ownedFile(db, c.req.param("fileId"), user.id);
    if (!file) return fail(c, 404, "not_found");
    if (file.contributorUserId === user.id) {
      return fail(c, 400, "cant_block_yourself", "That clip is from you.");
    }
    if (!file.contributorUserId && !file.senderKey) {
      // Clips from before sender keys carry no way to recognise their sender.
      return fail(c, 422, "cant_block", "This clip's sender can't be blocked. You can report it.");
    }
    await saveBlock(db, user.id, file);

    const now = Date.now();
    const theirs = [
      ...(file.contributorUserId ? [eq(files.contributorUserId, file.contributorUserId)] : []),
      ...(file.senderKey ? [eq(files.senderKey, file.senderKey)] : []),
    ];
    const [, removed] = await db.batch([
      db
        .insert(reports)
        .values({
          ...aboutClip(file),
          id: newId("rep"),
          kind: "block",
          reason: "other",
          reporterId: user.id,
          createdAt: now,
        })
        .onConflictDoNothing(),
      // Gone from the inbox at once; the cleanup removes them (lib/files.ts).
      db
        .update(files)
        .set({ status: goneStatus(now), lastActivityAt: 0 })
        .where(
          and(
            eq(files.ownerId, user.id),
            inArray(files.status, ["pending", "complete"]),
            or(...theirs),
          ),
        )
        .returning({ id: files.id }),
    ]);
    // Which clips went, so the app can drop them at once, before it reloads.
    return c.json({
      ok: true,
      removed: removed.length,
      removedIds: removed.map((file) => file.id),
    });
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

  /** Unblocks a sender. Their clips that went with the block don't come back. */
  .delete("/me/blocks/:blockId", requireUser, async (c) => {
    const user = currentUser(c);
    const db = getDb(c.env.DB);
    const blockId = c.req.param("blockId");
    const [, removed] = await db.batch([
      db
        .delete(blockKeys)
        .where(and(eq(blockKeys.blockId, blockId), eq(blockKeys.ownerId, user.id))),
      db
        .delete(blocks)
        .where(and(eq(blocks.id, blockId), eq(blocks.ownerId, user.id)))
        .returning({ id: blocks.id }),
    ]);
    if (removed.length === 0) return fail(c, 404, "not_found");
    return c.json({ ok: true });
  })

  /**
   * Anyone reports an athlete's page (its name or photo, say), behind
   * Turnstile and a limit per IP (per /64 for IPv6). The same visitor
   * reporting the same page again within a day changes nothing.
   */
  .post("/h/:handle/report", validate("json", pageReportSchema), async (c) => {
    const ip = clientIp(c);
    const ipHash = await sha256Hex(`${c.env.SESSION_SECRET}:${ipRateKey(ip)}`);
    if (await tooMany(c, `report-ip:${ipHash}`)) {
      return fail(c, 429, "rate_limited", "Too many reports. Try again in a minute.");
    }
    const input = c.req.valid("json");
    if (!(await verifyTurnstile(c.env, input.turnstileToken, ip, "report"))) {
      return fail(c, 403, "turnstile_failed", "We couldn't verify you're human. Please try again.");
    }
    const db = getDb(c.env.DB);
    const owner = await findUserByHandle(db, normalizeHandle(c.req.param("handle")));
    if (!owner || owner.deletedAt) return fail(c, 404, "not_found", "This Hop doesn't exist.");
    // One statement: the same visitor reporting the same page twice at once,
    // or again within a day, still makes one report.
    const now = Date.now();
    await db.run(sql`
      insert into ${reports} (id, kind, reason, note, reporter_ip_hash, subject_user_id, created_at)
      select ${newId("rep")}, 'profile', ${input.reason}, ${input.note || null}, ${ipHash}, ${owner.id}, ${now}
      where not exists (
        select 1 from ${reports}
        where ${reports.reporterIpHash} = ${ipHash}
          and ${reports.subjectUserId} = ${owner.id}
          and ${reports.createdAt} > ${now - DAY_MS}
      )
    `);
    return c.json({ ok: true });
  });

/** A clip sent to this athlete. */
function ownedFile(db: Db, fileId: string, userId: string) {
  return db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.ownerId, userId)))
    .get();
}

/** What a report keeps about a clip, which may be deleted before anyone looks. */
function aboutClip(file: FileRow) {
  return {
    subjectUserId: file.contributorUserId,
    fileId: file.id,
    contributorName: file.contributorName,
    senderKey: file.senderKey,
    clipNote: file.note,
    clipName: file.originalName,
  };
}

/**
 * Blocks whoever sent `file`, every way they're known: by account if they
 * were signed in, and by this browser's key. A sender seen with several
 * browsers gets one block covering each key it was given (block_keys), so
 * signing out on any of them doesn't help. An existing block of the same
 * sender learns what it lacked.
 */
async function saveBlock(db: Db, ownerId: string, file: FileRow) {
  const now = Date.now();
  let block = file.contributorUserId
    ? await db
        .select()
        .from(blocks)
        .where(
          and(eq(blocks.ownerId, ownerId), eq(blocks.contributorUserId, file.contributorUserId)),
        )
        .get()
    : undefined;
  if (!block && file.senderKey) {
    const known = await db
      .select({ blockId: blockKeys.blockId })
      .from(blockKeys)
      .where(and(eq(blockKeys.ownerId, ownerId), eq(blockKeys.senderKey, file.senderKey)))
      .get();
    if (known) block = await db.select().from(blocks).where(eq(blocks.id, known.blockId)).get();
  }
  const blockId = block?.id ?? newId("blk");
  try {
    if (!block) {
      await db.insert(blocks).values({
        id: blockId,
        ownerId,
        contributorUserId: file.contributorUserId,
        label: file.contributorName,
        createdAt: now,
      });
    } else if (file.contributorUserId && !block.contributorUserId) {
      await db
        .update(blocks)
        .set({ contributorUserId: file.contributorUserId })
        .where(eq(blocks.id, block.id));
    }
  } catch (error) {
    // Another block of the same account landed meanwhile: that one counts.
    if (!isUniqueViolation(error)) throw error;
  }
  if (file.senderKey) {
    // A key already blocked (under another block of theirs) stays where it is.
    await db
      .insert(blockKeys)
      .values({ ownerId, senderKey: file.senderKey, blockId, createdAt: now })
      .onConflictDoNothing();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed/i.test(`${error.message} ${error.cause ?? ""}`)
  );
}

async function tooMany(c: Context<AppEnv>, key: string): Promise<boolean> {
  const { success } = await c.env.REPORT_LIMITER.limit({ key });
  return !success;
}
