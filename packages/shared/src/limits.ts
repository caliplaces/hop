const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;

/** Largest single file a contributor can upload. */
export const MAX_FILE_BYTES = 5 * GiB;

/** Anything smaller can't be a real photo or video. */
export const MIN_FILE_BYTES = 1 * KiB;

/**
 * Size of every multipart part except the last. R2 requires equal-sized parts
 * (min 5 MiB). 10 MiB keeps retries cheap on mobile networks, and a 5 GiB file
 * becomes 512 parts, well under R2's 10,000-part limit.
 */
export const PART_BYTES = 10 * MiB;

/** How many presigned part URLs the client may request in one call. */
export const MAX_PARTS_PER_SIGN_REQUEST = 50;

/** Max size of the client-generated JPEG thumbnail. */
export const MAX_THUMBNAIL_BYTES = 512 * KiB;

/**
 * What each plan includes. Free keeps clips for `retentionDays`; Hop+ keeps
 * them for good (null). Retention isn't enforced yet: see the API README.
 */
export const PLANS = {
  free: { storageBytes: 15 * GiB, retentionDays: 30 },
  plus: { storageBytes: 200 * GiB, retentionDays: null },
} as const;

export type PlanId = keyof typeof PLANS;

/** App Store product IDs that give Hop+, all in one subscription group. */
export const HOP_PLUS_PRODUCT_IDS = ["hop_plus", "hop_plus_annual"] as const;

/**
 * A pending upload only reserves quota while it's actively uploading, so
 * abandoned uploads can't make a Hop look full.
 */
export const PENDING_RESERVATION_MS = 60 * 60 * 1000;

/** Uploads with no activity for this long are aborted and removed. */
export const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** Limits per Turnstile pass, so one solved challenge can't flood a Hop. */
export const MAX_ACTIVE_UPLOADS_PER_PASS = 6;
export const MAX_UPLOADS_PER_PASS = 300;

/**
 * Media types Hop stores, with the extension used for downloads. The stored
 * type always comes from sniffing the file's bytes, never from the client.
 */
export const MEDIA_TYPES = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
} as const;

export type MediaType = keyof typeof MEDIA_TYPES;

/**
 * Early check on the browser-reported type, for a friendly error before
 * uploading. Browsers sometimes report nothing (e.g. HEIC on Android), so an
 * empty or generic type is let through and the bytes decide at completion.
 */
export function isAcceptableDeclaredType(type: string): boolean {
  if (type === "" || type === "application/octet-stream") return true;
  if (type.includes("svg") || type.includes("xml")) return false;
  return type.startsWith("video/") || type.startsWith("image/");
}

/** Replace a file's extension with the one matching its real type. */
export function withMediaExtension(name: string, type: MediaType): string {
  const ext = MEDIA_TYPES[type];
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const current = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const aliases: Record<string, string> = { jpeg: "jpg", m4v: "mp4", qt: "mov" };
  if ((aliases[current] ?? current) === ext) return name;
  return `${base || "file"}.${ext}`;
}

export function partCount(size: number, partBytes = PART_BYTES): number {
  return Math.max(1, Math.ceil(size / partBytes));
}

/** Byte length of a given part (the last one is usually shorter). */
export function partLength(size: number, partNumber: number, partBytes = PART_BYTES): number {
  return Math.min(partBytes, size - (partNumber - 1) * partBytes);
}
