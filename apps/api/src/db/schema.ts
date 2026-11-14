import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
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
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the session token; the token itself only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    /** "deleting" rows are being removed; see lib/files.ts removeFile. */
    status: text("status", { enum: ["pending", "complete", "deleting"] })
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
    createdAt: integer("created_at").notNull(),
    /** Bumped on create, part signing and completion; drives quota reservation and cleanup. */
    lastActivityAt: integer("last_activity_at").notNull(),
    completedAt: integer("completed_at"),
    /**
     * The new-clips digest (see notify.ts). A complete clip waits with both
     * null, is claimed into a batch (notifyBatch, the claim time), and is
     * announced (notifiedAt) once that batch's email has gone out.
     */
    notifyBatch: integer("notify_batch"),
    notifiedAt: integer("notified_at"),
  },
  (t) => [
    index("files_owner_status_activity_idx").on(t.ownerId, t.status, t.lastActivityAt),
    index("files_owner_status_created_idx").on(t.ownerId, t.status, t.createdAt),
    index("files_hop_status_created_idx").on(t.hopId, t.status, t.createdAt),
    index("files_status_activity_idx").on(t.status, t.lastActivityAt),
    index("files_pass_status_idx").on(t.passId, t.status),
    // Only clips waiting to be announced: tiny, since almost every row is notified.
    index("files_unnotified_idx")
      .on(t.ownerId, t.completedAt)
      .where(sql`${t.status} = 'complete' and ${t.notifiedAt} is null`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type HopRow = typeof hops.$inferSelect;
export type FileRow = typeof files.$inferSelect;
