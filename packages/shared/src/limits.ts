const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** Largest single file a contributor can upload. */
export const MAX_FILE_BYTES = 5 * GiB;

/**
 * Size of every multipart part except the last. R2 requires equal-sized parts
 * (min 5 MiB). 10 MiB keeps retries cheap on mobile networks, and a 5 GiB file
 * becomes 512 parts, well under R2's 10,000-part limit.
 */
export const PART_BYTES = 10 * MiB;

/** How many presigned part URLs the client may request in one call. */
export const MAX_PARTS_PER_SIGN_REQUEST = 50;

/** Max size of the client-generated JPEG thumbnail. */
export const MAX_THUMBNAIL_BYTES = 512 * 1024;

/** Storage an account gets until plans exist. */
export const DEFAULT_STORAGE_QUOTA_BYTES = 50 * GiB;

/** Uploads that never complete are cleaned up after this long. */
export const PENDING_UPLOAD_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const ALLOWED_MIME_PREFIXES = ["video/", "image/"] as const;

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

export function partCount(size: number, partBytes = PART_BYTES): number {
  return Math.max(1, Math.ceil(size / partBytes));
}
