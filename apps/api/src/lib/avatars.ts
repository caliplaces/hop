import { randomToken } from "./crypto";

/**
 * Profile photos live in R2 under a random, unguessable name that never
 * changes once written, so they're served publicly and cached for good. A
 * new photo gets a new name; the old one is deleted.
 */
const PREFIX = "avatars/";
/** Photos never change under a name, so they're cached for good. */
export const AVATAR_CACHE = "public, max-age=31536000, immutable";
/** A random name as newAvatarKey makes it: 16 random bytes, base64url, .jpg. */
const FILE = /^[A-Za-z0-9_-]{22}\.jpg$/;

export function newAvatarKey(): string {
  return `${PREFIX}${randomToken(16)}.jpg`;
}

/** Where the API serves a photo, relative to the site. */
export function avatarUrl(key: string | null): string | null {
  return key ? `/api/${key}` : null;
}

/** The R2 key for a photo's file name in a URL, or null if it isn't one. */
export function avatarKeyFor(file: string): string | null {
  return FILE.test(file) ? `${PREFIX}${file}` : null;
}
