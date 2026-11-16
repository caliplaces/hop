import { z } from "zod";
import { COLOR_IDS, type ColorId } from "./colors";
import { MAX_FILE_BYTES, MAX_PARTS_PER_SIGN_REQUEST, MIN_FILE_BYTES } from "./limits";

/**
 * Anonymous names can't start with "@", which is reserved for signed-in
 * contributors' verified handles.
 */
export const contributorNameSchema = z
  .string()
  .trim()
  .transform((name) =>
    name
      .replace(/^@+/, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim(),
  )
  .pipe(z.string().min(1).max(40));

export const createUploadSchema = z.object({
  name: z.string().trim().min(1).max(255),
  size: z
    .number()
    .int()
    .min(MIN_FILE_BYTES, "That file is too small.")
    .max(MAX_FILE_BYTES, "Files can be up to 5 GB."),
  type: z.string().trim().max(127),
  contributorName: contributorNameSchema.optional(),
  note: z.string().trim().max(280).optional(),
});
export type CreateUploadInput = z.infer<typeof createUploadSchema>;

export type CreateUploadResult = {
  fileId: string;
  uploadToken: string;
  partSize: number;
  partCount: number;
};

export const signPartsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(MAX_PARTS_PER_SIGN_REQUEST),
});

export type SignedPart = { partNumber: number; url: string };

export const completeUploadSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1) }))
    .min(1)
    .max(10_000),
});
export type CompletedPart = z.infer<typeof completeUploadSchema>["parts"][number];

export const hopPassSchema = z.object({ turnstileToken: z.string().min(1) });

export const colorSchema = z.enum(COLOR_IDS);

export const claimHandleSchema = z.object({ handle: z.string(), color: colorSchema.optional() });

export const updateProfileSchema = z
  .object({ color: colorSchema, emailNewClips: z.boolean() })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, "Nothing to update.");

/** Unsubscribe links carry a signed token; `subscribe: true` undoes it. */
export const emailPreferenceSchema = z.object({
  token: z.string().min(1).max(1000),
  subscribe: z.boolean().optional(),
});

export const createHopSchema = z.object({
  title: z.string().trim().min(1).max(80),
  slug: z.string().trim().optional(),
});

export const updateHopSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["open", "closed"]).optional(),
});

export type HopStatus = "open" | "closed";

export type PublicHop = {
  id: string;
  slug: string;
  title: string;
  status: HopStatus;
  owner: { handle: string; name: string | null; color: ColorId };
};

export type Me = {
  id: string;
  name: string | null;
  email: string | null;
  handle: string | null;
  activeHopId: string | null;
  /** Always set: the chosen colour, or a stable default until they choose. */
  color: ColorId;
  /** Whether new clips are announced by email (on unless they opted out). */
  emailNewClips: boolean;
};

export type HopSummary = {
  id: string;
  slug: string;
  title: string;
  status: HopStatus;
  createdAt: number;
  fileCount: number;
  totalBytes: number;
};

export type InboxFile = {
  id: string;
  hopId: string;
  name: string;
  mime: string;
  size: number;
  hasThumbnail: boolean;
  contributorName: string | null;
  /** True when the contributor was signed in, so the name is their real handle. */
  contributorVerified: boolean;
  note: string | null;
  createdAt: number;
};

export type InboxPage = { files: InboxFile[]; nextCursor: string | null };

/**
 * Registers a Live Activity's push token (the URL's last segment) so the API
 * can update its count as clips land. `environment` is the APNs environment the
 * token belongs to: "sandbox" for debug builds, "production" otherwise.
 */
export const liveActivitySchema = z.object({
  hopId: z.string().min(1).max(64),
  since: z.number().int().nonnegative(),
  environment: z.enum(["sandbox", "production"]),
});

/** A signed App Store transaction (StoreKit 2's `jwsRepresentation`). */
export const appleTransactionSchema = z.object({
  transaction: z.string().min(1).max(16_384),
});

/** The athlete's plan, storage and, with Hop+, their subscription. */
export type PlanStatus = {
  plan: "free" | "plus";
  storage: { usedBytes: number; limitBytes: number };
  /** Days free clips are kept; null with Hop+ (kept for good). */
  retentionDays: number | null;
  /** With Hop+: when the current period ends, and whether it renews. */
  subscription: {
    productId: string;
    expiresAt: number;
    /**
     * Set while Apple retries a failed renewal: the period has ended, and
     * Hop+ carries on until this unless the athlete fixes their payment.
     */
    graceExpiresAt: number | null;
    autoRenew: boolean;
    environment: "Sandbox" | "Production";
  } | null;
  /**
   * Ties App Store purchases to this account (StoreKit's appAccountToken):
   * the app sets it on every purchase, and the API only credits matching ones.
   */
  appAccountToken: string;
  /** What each plan includes, so the app's comparison always matches the server. */
  plans: Record<"free" | "plus", { storageBytes: number; retentionDays: number | null }>;
  /**
   * Goes up whenever the athlete's subscriptions change, and is read before
   * the rest, so the rest is at least this new. A reply with a lower revision
   * than one already shown is stale: it read the plan before a change.
   */
  revision: number;
};

/** Making a hop live: when it happened, by the server's clock. */
export type HopActivation = { ok: true; activatedAt: number };

/**
 * Clips that finished uploading into a hop since a moment (by the server's
 * clock): how many, and the newest few, newest first. Event mode counts with it.
 */
export type HopArrivals = { count: number; latest: InboxFile[] };

export const fileUrlsSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(100),
  download: z.boolean().default(true),
});

export type PublicConfig = { turnstileSiteKey: string };

export type ApiError = { error: string; message?: string };
