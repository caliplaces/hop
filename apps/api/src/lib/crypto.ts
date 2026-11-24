const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Unbiased random string from a 36-char alphabet (rejection sampling). */
export function randomString(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < 252) out += ID_ALPHABET[byte % 36];
      if (out.length === length) break;
    }
  }
  return out;
}

/** 20 random base36 chars is ~103 bits, plenty for unguessable ids. */
export function newId(prefix: "usr" | "hop" | "fil" | "rep" | "blk"): string {
  return `${prefix}_${randomString(20)}`;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(input: string): Uint8Array {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/**
 * A private key's DER bytes from its PEM, with or without the header lines
 * and line breaks, and with line breaks escaped as \n (as in a JSON key file
 * pasted somewhere that keeps them literal).
 */
export function pkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

type Signed = { exp: number; purpose: string };

/**
 * Compact signed (not encrypted) token: base64url(json).base64url(hmac).
 * Used for short-lived capabilities like upload passes and the OIDC flow cookie.
 */
export async function signPayload<T extends Signed>(secret: string, payload: T): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(body),
  );
  return `${body}.${base64url(new Uint8Array(sig))}`;
}

export async function verifyPayload<T extends Signed>(
  secret: string,
  token: string | undefined | null,
  purpose: T["purpose"],
): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64url(sig),
      new TextEncoder().encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as T;
    if (
      payload.purpose !== purpose ||
      typeof payload.exp !== "number" ||
      payload.exp < Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
