import { z } from "zod";
import { COLOR_IDS, type ColorId } from "./colors";
import { MAX_FILE_BYTES, MAX_PARTS_PER_SIGN_REQUEST, MIN_FILE_BYTES } from "./limits";

/** An emoji, with any colour or skin-tone modifiers, and others joined to it. */
const EMOJI =
  /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*/gu;
/** Check marks, which would pass for a badge next to a name. */
const CHECK_MARKS = /[\u2611\u2705\u2713\u2714\u{1F5F8}]/u;

/**
 * A name as people should see it, whoever typed it: compatibility forms
 * folded (a fullwidth ＠ is an @), no control or invisible characters
 * (bidi overrides, zero-width and other default-ignorable ones) except
 * those that build an emoji, no stacks of combining marks ("Zalgo" text),
 * no check marks, and one space at a time.
 */
export function cleanName(name: string): string {
  const visible = (text: string) => text.replace(/[\p{C}\p{Default_Ignorable_Code_Point}]/gu, "");
  // Line breaks and tabs become spaces before anything invisible goes.
  const normal = name.normalize("NFKC").replace(/\s+/g, " ");
  let kept = "";
  let last = 0;
  for (const emoji of normal.matchAll(EMOJI)) {
    kept += visible(normal.slice(last, emoji.index)) + emoji[0];
    last = emoji.index + emoji[0].length;
  }
  kept += visible(normal.slice(last));
  return kept
    .replace(/(\p{M}{3})\p{M}+/gu, "$1")
    .replace(new RegExp(CHECK_MARKS.source, "gu"), "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What an anonymous contributor calls themselves, cleaned (see cleanName).
 * It can't start with "@", which is reserved for signed-in contributors'
 * verified handles, and must show something: a letter, a number or an emoji.
 */
export const contributorNameSchema = z
  .string()
  .max(200)
  .transform((name) => cleanName(name).replace(/^@+/, "").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(40)
      .refine((name) => /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(name)),
  );

/** The longest note a sender can leave with their clips. */
export const UPLOAD_NOTE_MAX = 280;

export const createUploadSchema = z.object({
  name: z.string().trim().min(1).max(255),
  size: z
    .number()
    .int()
    .min(MIN_FILE_BYTES, "That file is too small.")
    .max(MAX_FILE_BYTES, "Files can be up to 5 GB."),
  type: z.string().trim().max(127),
  contributorName: contributorNameSchema.optional(),
  /**
   * A line for the athlete about these clips ("Round 2, from the left"),
   * cleaned like a name: it's shown to them. Empty once cleaned: no note.
   */
  note: z.string().max(1000).transform(cleanName).pipe(z.string().max(UPLOAD_NOTE_MAX)).optional(),
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

/**
 * The name others see on an athlete's page. Hop's own, kept apart from the
 * one their Caliplaces account sends (which every sign-in refreshes, and is
 * checked the same way). Names are public, so they may not disguise
 * themselves or someone else:
 *
 * - no control or invisible characters (bidi overrides, zero-width and other
 *   default-ignorable ones), except those that build an emoji;
 * - something readable: at least one letter or number;
 * - no stacks of combining marks ("Zalgo" text);
 * - no leading @, which would pass for a handle, and no check marks.
 */
export const displayNameSchema = z
  .string()
  .max(200, "That name is too long.")
  .transform((name) => name.normalize("NFC").trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Enter a name.")
      .max(50, "That name is too long.")
      .refine(
        (name) => !/[\p{C}\p{Default_Ignorable_Code_Point}]/u.test(name.replace(EMOJI, "")),
        "That name has characters that can't be shown.",
      )
      .refine((name) => /[\p{L}\p{N}]/u.test(name), "Enter a name.")
      .refine((name) => !/\p{M}{4,}/u.test(name), "That name has characters that can't be shown.")
      .refine((name) => !name.startsWith("@"), "A name can't start with @.")
      .refine((name) => !CHECK_MARKS.test(name), "A name can't include check marks."),
  );

export const updateProfileSchema = z
  .object({
    color: colorSchema,
    emailNewClips: z.boolean(),
    pushNewClips: z.boolean(),
    /** null goes back to the name from their Caliplaces account. */
    displayName: displayNameSchema.nullable(),
    /** They've seen and confirmed their public profile. */
    profileReviewed: z.literal(true),
  })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, "Nothing to update.");

/** Why something was reported. */
export const REPORT_REASONS = ["sexual", "violence", "harassment", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Reporting a clip (from the app) or an athlete's page (from the web). */
export const reportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(500).optional(),
});
export type ReportInput = z.infer<typeof reportSchema>;

/** Reporting a page needs no account, so it needs a Turnstile pass instead. */
export const pageReportSchema = reportSchema.extend({
  turnstileToken: z.string().min(1).max(4096),
});

/** Someone an athlete blocked from sending them clips. */
export type Block = {
  id: string;
  /** How they appeared on the clip blocked: a name or an @handle. */
  label: string | null;
  createdAt: number;
};

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
  owner: {
    handle: string;
    name: string | null;
    color: ColorId;
    /** Their profile photo, relative to the site, if they set one. */
    avatarUrl: string | null;
    /**
     * They have Hop+, which their page shows with a Hop+ mark. Deliberately
     * not a "verified" check: paying doesn't prove who someone is.
     */
    hopPlus: boolean;
  };
};

export type Me = {
  id: string;
  /** The name others see: their Hop profile's, or else their Caliplaces account's. */
  name: string | null;
  email: string | null;
  handle: string | null;
  activeHopId: string | null;
  /** Always set: the chosen colour, or a stable default until they choose. */
  color: ColorId;
  /** Whether new clips are announced by email (on unless they opted out). */
  emailNewClips: boolean;
  /**
   * Whether new clips are announced on their phones, where they turned on
   * notifications (on unless they turned it off).
   */
  pushNewClips: boolean;
  /** Their profile photo, relative to the site (/api/avatars/...), if they set one. */
  avatarUrl: string | null;
  /** They have Hop+, which their page shows with a Hop+ mark. */
  hopPlus: boolean;
  /** Whether they've seen their public profile since signing up. */
  profileReviewed: boolean;
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
    /**
     * Where it was bought, which is where it's managed: the App Store (in
     * the iPhone app) or the website (Stripe). Servers from before the
     * website sold Hop+ leave it out: the App Store.
     */
    provider?: "apple" | "stripe";
    /** hop_plus (monthly) or hop_plus_annual, whichever the provider. */
    productId: string;
    expiresAt: number;
    /**
     * Set while a failed renewal is retried: the period has ended, and Hop+
     * carries on until this unless the athlete fixes their payment.
     */
    graceExpiresAt: number | null;
    autoRenew: boolean;
    /** Sandbox: an App Store test purchase, or Stripe's test mode. */
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
  /**
   * Free-plan clips the athlete has been told are leaving: how many, the day
   * the first notice named (`on`, YYYY-MM-DD), and when those may go (ms
   * since 1970), which is after that day has ended in every time zone. Null
   * when none are, as always with Hop+.
   */
  expiring: { clips: number; on: string; at: number } | null;
};

/** A Hop+ price on the website, from Stripe: `amount` in the currency's minor unit (cents). */
export type WebPrice = {
  id: string;
  amount: number;
  /** ISO 4217, lowercase, as Stripe gives it: "eur". */
  currency: string;
  interval: "month" | "year";
};

/** Starts a Stripe Checkout for one of the website's Hop+ prices. */
export const webCheckoutSchema = z.object({ priceId: z.string().min(1).max(255) });

/** Where to send the browser next: Stripe Checkout or Stripe's customer portal. */
export type BillingRedirect = { url: string };

/**
 * Registers the app's push token (the URL's last segment) for notifications,
 * such as clips about to expire. `environment` is the APNs environment the
 * token belongs to, as for Live Activities.
 */
export const deviceSchema = z.object({
  environment: z.enum(["sandbox", "production"]),
});

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

/** Counts in the last day, week and 30 days. */
export type Recent = { day: number; week: number; month: number };

/**
 * Hop's numbers, for the private stats page (/admin): counts only, nothing
 * about anyone in particular. See apps/api/src/stats.ts.
 */
export type AdminStats = {
  generatedAt: number;
  /** Accounts with a handle (athletes), not deleted. */
  athletes: { total: number; new: Recent; active: Recent; deleted: number };
  /** Distinct people who sent clips (by browser, or account if signed in). */
  senders: Recent;
  /** Events: Hops other than each athlete's standing one. */
  events: { total: number; new: Recent };
  clips: { total: number; new: Recent };
  storage: {
    /** Clips kept (complete, or held for a report). */
    bytes: number;
    /** Uploads under way. */
    pendingBytes: number;
    /** What the free plan and Hop+ athletes keep. */
    freeBytes: number;
    plusBytes: number;
  };
  plus: { subscribers: number };
  waitlist: number;
  /** The last 30 days, oldest first; days start at midnight UTC. */
  daily: { day: string; athletes: number; events: number; clips: number; bytes: number }[];
};
