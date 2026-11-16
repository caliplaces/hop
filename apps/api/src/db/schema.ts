import { REPORT_REASONS } from "@hop/shared";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    oidcSub: text("oidc_sub").notNull().unique(),
    email: text("email"),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    name: text("name"),
    /** Public handle (onmyhop.com/<handle>). One per account, claimed once. */
    handle: text("handle").unique(),
    /** Palette colour id for the athlete's page; null until chosen (a stable default is derived). */
    color: text("color"),
    /** The hop that onmyhop.com/<handle> uploads into. */
    activeHopId: text("active_hop_id"),
    /** Email the athlete when new clips arrive. On by default; unsubscribe links turn it off. */
    emailNewClips: integer("email_new_clips", { mode: "boolean" }).notNull().default(true),
    /** New clips are announced on their phones too (the digest, src/notify.ts). */
    pushNewClips: integer("push_new_clips", { mode: "boolean" }).notNull().default(true),
    /**
     * A UUID the iPhone app sets on App Store purchases (StoreKit's
     * appAccountToken), so the API knows whose they are. Made when first needed.
     */
    appAccountToken: text("app_account_token").unique(),
    /**
     * Goes up whenever one of the athlete's subscriptions changes, so the app
     * can tell a stale plan reply from a newer one (see GET /api/me/plan).
     */
    planRevision: integer("plan_revision").notNull().default(0),
    /**
     * The name others see, set in Hop. `name` is their Caliplaces account's,
     * refreshed at every sign-in, and stands in until they set one.
     */
    displayName: text("display_name"),
    /**
     * Their profile photo in R2 (avatars/<random>.jpg), public. Unique and
     * indexed: the cleanup looks photos up by it.
     */
    avatarKey: text("avatar_key").unique(),
    /** When they confirmed their public profile, so the app asks only once. */
    profileReviewedAt: integer("profile_reviewed_at"),
    /**
     * When they deleted their account. The row stays as a tombstone with
     * nothing personal left, keeping only the handle, so nobody else can claim
     * it and receive clips sent to their old link. See lib/accounts.ts.
     */
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    // Deleted accounts only: tiny, and what the cleanup reads them by.
    index("users_deleted_idx").on(t.deletedAt).where(sql`${t.deletedAt} is not null`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the session token; the token itself only lives with the client. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * "web" sessions live in the website's cookie, "app" sessions are bearer
     * tokens held by the iPhone app. Each is only accepted the way it was issued.
     */
    kind: text("kind", { enum: ["web", "app"] })
      .notNull()
      .default("web"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const hops = sqliteTable(
  "hops",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("hops_owner_slug_idx").on(t.ownerId, t.slug)],
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    hopId: text("hop_id")
      .notNull()
      .references(() => hops.id, { onDelete: "cascade" }),
    /** Denormalised from the hop for inbox and quota queries. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    thumbKey: text("thumb_key"),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    partSize: integer("part_size").notNull(),
    partCount: integer("part_count").notNull(),
    /**
     * "deleting" rows are being removed; see lib/files.ts removeFile. "held"
     * clips were reported, then deleted: gone for the athlete, kept for Hop's
     * team until held_until.
     */
    status: text("status", { enum: ["pending", "complete", "deleting", "held"] })
      .notNull()
      .default("pending"),
    multipartUploadId: text("multipart_upload_id"),
    /** Turnstile pass the upload was created under, for per-pass limits. */
    passId: text("pass_id").notNull(),
    /** SHA-256 of the per-file upload token handed to the contributor. */
    uploadTokenHash: text("upload_token_hash").notNull(),
    contributorName: text("contributor_name"),
    contributorUserId: text("contributor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    uploaderIpHash: text("uploader_ip_hash"),
    /**
     * SHA-256 of the sender's browser key (the hop_sender cookie, see
     * lib/senders.ts), so an athlete can block whoever sent a clip without
     * blocking everyone else on the same network.
     */
    senderKey: text("sender_key"),
    /**
     * Set when the clip is reported: until then, deleting it (by the athlete,
     * a block or deleting their account) only hides it, so Hop's team can
     * still look at it. See lib/files.ts.
     */
    heldUntil: integer("held_until"),
    createdAt: integer("created_at").notNull(),
    /** Bumped on create, part signing and completion; drives quota reservation and cleanup. */
    lastActivityAt: integer("last_activity_at").notNull(),
    completedAt: integer("completed_at"),
    /**
     * The new-clips digest (see notify.ts). A complete clip waits with these
     * null, is claimed into a batch (notifyBatch, the claim time), and is
     * announced (notifiedAt) once that batch's email has gone out.
     * notifyAttemptedAt is the batch's latest send attempt, so retries rotate.
     */
    notifyBatch: integer("notify_batch"),
    notifyAttemptedAt: integer("notify_attempted_at"),
    notifiedAt: integer("notified_at"),
    /**
     * Free-plan expiry (see src/expiry.ts). A clip near the end of its 30
     * days is claimed into a notice (expiry_notice_batch, the notice's
     * batch), and once that notice has reached the athlete, expiry_goes_at
     * is when the clip may go: after the day the notice named has ended
     * everywhere, never before. Both clear while the athlete has Hop+.
     */
    expiryNoticeBatch: integer("expiry_notice_batch"),
    expiryGoesAt: integer("expiry_goes_at"),
  },
  (t) => [
    index("files_owner_status_activity_idx").on(t.ownerId, t.status, t.lastActivityAt),
    index("files_owner_status_created_idx").on(t.ownerId, t.status, t.createdAt),
    index("files_hop_status_created_idx").on(t.hopId, t.status, t.createdAt),
    // Event mode's arrivals: a hop's clips finished since a moment.
    index("files_hop_status_completed_idx").on(t.hopId, t.status, t.completedAt),
    index("files_status_activity_idx").on(t.status, t.lastActivityAt),
    index("files_pass_status_idx").on(t.passId, t.status),
    // Clips sent by signed-in contributors, so deleting an account finds
    // theirs without reading every clip.
    index("files_contributor_idx")
      .on(t.contributorUserId)
      .where(sql`${t.contributorUserId} is not null`),
    // Only finished uploads not yet announced: tiny, since almost every row is.
    // Keyed on completed_at rather than status, so SQLite can't prefer the
    // status indexes (and read every clip) for the digest's queries.
    index("files_unannounced_idx")
      .on(t.ownerId, t.notifyBatch, t.completedAt)
      .where(sql`${t.completedAt} is not null and ${t.notifiedAt} is null`),
    // Clips not yet in an expiry notice, by athlete and age.
    index("files_unnoticed_idx")
      .on(t.ownerId, t.completedAt)
      .where(sql`${t.status} = 'complete' and ${t.expiryNoticeBatch} is null`),
    // An athlete's clips in expiry notices: few, as they go within a week.
    index("files_notice_idx")
      .on(t.ownerId, t.expiryNoticeBatch)
      .where(sql`${t.expiryNoticeBatch} is not null`),
    // Clips that may go, by when.
    index("files_goes_idx").on(t.expiryGoesAt).where(sql`${t.expiryGoesAt} is not null`),
  ],
);

/**
 * Event mode's Live Activities, to push updates to while the phone is locked.
 * Apple gives each Live Activity a push token and may rotate it; each token is
 * its own row. Rows go when the app ends Event mode, when Apple says the token
 * is gone, or when they expire (Live Activities end within 12 hours anyway).
 */
export const liveActivities = sqliteTable(
  "live_activities",
  {
    /** The Live Activity's APNs push token, as hex. */
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hopId: text("hop_id")
      .notNull()
      .references(() => hops.id, { onDelete: "cascade" }),
    /** Clips that finish uploading from this moment (ms, server clock) count. */
    since: integer("since").notNull(),
    /** When a push last lit the screen up; quieter updates in between. */
    alertedAt: integer("alerted_at"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    index("live_activities_hop_idx").on(t.hopId, t.expiresAt),
    index("live_activities_user_idx").on(t.userId, t.createdAt),
    index("live_activities_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Hop+ subscriptions bought through the App Store, one row per subscription
 * (Apple's originalTransactionId, which stays the same across renewals). Kept
 * up to date from signed transactions the app sends and from App Store Server
 * Notifications. An athlete has Hop+ while one of theirs is paid up or in a
 * billing grace period, and wasn't revoked (refunded).
 */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    originalTransactionId: text("original_transaction_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    environment: text("environment", { enum: ["Sandbox", "Production"] }).notNull(),
    /** End of the paid period. */
    expiresAt: integer("expires_at").notNull(),
    /**
     * While Apple retries a failed renewal, Hop+ carries on until this. Only
     * renewal info (from notifications) sets it; a newer purchase clears it.
     */
    graceExpiresAt: integer("grace_expires_at"),
    /** Set when Apple refunded or revoked it: Hop+ ends at once. */
    revokedAt: integer("revoked_at"),
    autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(true),
    /**
     * Which data is newest: the purchase date of the latest transaction
     * applied (each renewal, upgrade or resubscription is a new one), then when
     * Apple signed it. Older data (a retry, an out-of-order notification, or a
     * freshly signed copy of a superseded transaction) never overwrites newer.
     */
    purchasedAt: integer("purchased_at").notNull(),
    signedAt: integer("signed_at").notNull(),
    /**
     * When the newest renewal info applied (grace period, auto-renew) was
     * signed. It's ordered on its own, apart from the transaction's.
     */
    renewalSignedAt: integer("renewal_signed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("subscriptions_user_idx").on(t.userId, t.expiresAt)],
);

/**
 * Who asked to hear when Hop launches, from the landing page. Emails are
 * stored lowercased, once each. The list is only for the launch email, and
 * each address is deleted a day after it went out (see launch.ts).
 */
export const waitlist = sqliteTable("waitlist", {
  email: text("email").primaryKey(),
  createdAt: integer("created_at").notNull(),
  /** When the launch email went out to them. The row goes a day later. */
  notifiedAt: integer("notified_at"),
  /** The launch email's first and last tries, and how many there have been. */
  launchFirstAttemptAt: integer("launch_first_attempt_at"),
  launchAttemptedAt: integer("launch_attempted_at"),
  launchAttempts: integer("launch_attempts").notNull().default(0),
});

export type UserRow = typeof users.$inferSelect;
export type HopRow = typeof hops.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;

/**
 * Reports of a clip (by the athlete it was sent to) or of an athlete's page
 * (by anyone). Each is emailed to REPORTS_EMAIL; the row is the record, kept
 * for a year (see cron.ts).
 */
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    /** A clip or a page reported, or a sender blocked (which tells the team too). */
    kind: text("kind", { enum: ["clip", "profile", "block"] }).notNull(),
    reason: text("reason", { enum: REPORT_REASONS }).notNull(),
    note: text("note"),
    /** The athlete reporting a clip; null for a page reported by a visitor. */
    reporterId: text("reporter_id").references(() => users.id, { onDelete: "set null" }),
    /** SHA-256 of a visitor's IP, for page reports. */
    reporterIpHash: text("reporter_ip_hash"),
    /** The account reported: the page's owner, or a clip's signed-in sender. */
    subjectUserId: text("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    /** The clip reported. Not a foreign key: the report outlives the clip. */
    fileId: text("file_id"),
    /** The clip's sender as it showed them, and their browser key. */
    contributorName: text("contributor_name"),
    senderKey: text("sender_key"),
    /** The clip's note and file name, which outlive it here. */
    clipNote: text("clip_note"),
    clipName: text("clip_name"),
    /**
     * The team's email about it (see src/reports.ts): the batch it was
     * claimed into (the claim time), then when that batch's email went out.
     */
    emailBatch: integer("email_batch"),
    emailedAt: integer("emailed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("reports_created_idx").on(t.createdAt),
    index("reports_unemailed_idx").on(t.createdAt).where(sql`${t.emailedAt} is null`),
    // An athlete reports (or blocks from) each clip once.
    uniqueIndex("reports_once_idx")
      .on(t.kind, t.reporterId, t.fileId)
      .where(sql`${t.reporterId} is not null and ${t.fileId} is not null`),
    index("reports_page_idx").on(t.reporterIpHash, t.subjectUserId, t.createdAt),
  ],
);

/**
 * Senders an athlete blocked: by account, when they sent while signed in,
 * and by every browser key they were seen with (block_keys). Uploads from a
 * blocked sender are refused (lib/senders.ts).
 */
export const blocks = sqliteTable(
  "blocks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contributorUserId: text("contributor_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /** How they appeared on the clip that was blocked, for the athlete's list. */
    label: text("label"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("blocks_owner_user_idx")
      .on(t.ownerId, t.contributorUserId)
      .where(sql`${t.contributorUserId} is not null`),
    index("blocks_owner_created_idx").on(t.ownerId, t.createdAt),
  ],
);

/** The browser keys (hashed) a block covers: each blocked once per athlete. */
export const blockKeys = sqliteTable(
  "block_keys",
  {
    ownerId: text("owner_id").notNull(),
    senderKey: text("sender_key").notNull(),
    blockId: text("block_id")
      .notNull()
      .references(() => blocks.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.senderKey] }),
    index("block_keys_block_idx").on(t.blockId),
  ],
);

export type ReportRow = typeof reports.$inferSelect;
export type BlockRow = typeof blocks.$inferSelect;
export type BlockKeyRow = typeof blockKeys.$inferSelect;

/**
 * The app's push tokens, one per install: for notifications such as clips
 * about to expire. A token signed in to another account moves to it.
 */
export const devices = sqliteTable(
  "devices",
  {
    /** APNs device token, as hex. */
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    environment: text("environment", { enum: ["sandbox", "production"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("devices_user_idx").on(t.userId),
    // For forgetting tokens the app hasn't refreshed in a while.
    index("devices_updated_idx").on(t.updatedAt),
  ],
);

export type DeviceRow = typeof devices.$inferSelect;

/**
 * Free-plan expiry notices (see src/expiry.ts), one per athlete and batch:
 * the clips claimed into it (files.expiry_notice_batch) and how telling the
 * athlete went. A notice counts once a channel took it (given_at); only then
 * may its clips go, at goes_at.
 */
export const expiryNotices = sqliteTable(
  "expiry_notices",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** When its clips were claimed: also the email's idempotency key. */
    batch: integer("batch").notNull(),
    /** How many clips it names, fixed at the claim so a retry says the same. */
    clips: integer("clips").notNull(),
    /** When they go: after the day it names has ended in every time zone. */
    goesAt: integer("goes_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    /** When to try again, while it hasn't reached the athlete. */
    nextAttemptAt: integer("next_attempt_at").notNull(),
    /** A phone took the push: it's never pushed again. */
    pushedAt: integer("pushed_at"),
    /** It reached the athlete: their clips may go at goes_at. */
    givenAt: integer("given_at"),
    /** Tried for long enough without reaching them: its clips were let go. */
    abandonedAt: integer("abandoned_at"),
    /** The day-before reminder went (or was skipped). */
    remindedAt: integer("reminded_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.batch] }),
    // Notices still being sent, next first.
    index("expiry_notices_sending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.givenAt} is null and ${t.abandonedAt} is null`),
    // Given notices not yet reminded of, by when their clips go.
    index("expiry_notices_reminder_idx")
      .on(t.goesAt)
      .where(sql`${t.givenAt} is not null and ${t.remindedAt} is null`),
  ],
);

export type ExpiryNoticeRow = typeof expiryNotices.$inferSelect;
