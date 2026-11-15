// The polyfill must load before the X.509 library, which needs Reflect metadata.
import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { APPLE_ROOT_CERTIFICATES } from "./apple-roots";
import { fromBase64url } from "./crypto";

/**
 * Verifies data the App Store signed: StoreKit 2 transactions, renewal info
 * and App Store Server Notifications V2. Each is a JWS (ES256) whose x5c
 * header carries the signing certificate chain. Follows Apple's own verifier
 * (app-store-server-library, jws_verification.ts):
 *
 * - exactly three certificates: leaf, intermediate, root;
 * - the intermediate is signed by a pinned Apple root (never the token's own),
 *   and the leaf by the intermediate, with matching issuer names;
 * - the intermediate is a CA and carries Apple's WWDR marker
 *   (1.2.840.113635.100.6.2.1), and the leaf carries the App Store signing
 *   marker (1.2.840.113635.100.6.11.1). Without that check, any certificate
 *   Apple issued under the same intermediate (a developer's own, say) could
 *   sign fake purchases;
 * - all three were valid when the data was signed (its signedDate), within a
 *   minute of clock skew;
 * - and the JWS signature checks out against the leaf's key.
 *
 * Like Apple's library with online checks off, it checks certificates at the
 * signedDate and doesn't ask Apple whether they've been revoked (OCSP). That
 * keeps transactions cached on a phone verifiable, and only matters should an
 * App Store signing key ever leak.
 */

x509.cryptoProvider.set(crypto);

const LEAF_OID = "1.2.840.113635.100.6.11.1";
const INTERMEDIATE_OID = "1.2.840.113635.100.6.2.1";
const MAX_SKEW_MS = 60 * 1000;

export class AppleSignatureError extends Error {}

const roots = () => APPLE_ROOT_CERTIFICATES.map((der) => new x509.X509Certificate(der));

/** A JWS part's JSON, which must be an object. */
function decodeObject(part: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(part)));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppleSignatureError("malformed JWS");
  }
  return value as Record<string, unknown>;
}

function validAt(cert: x509.X509Certificate, at: number): boolean {
  return (
    cert.notBefore.getTime() - MAX_SKEW_MS <= at && at <= cert.notAfter.getTime() + MAX_SKEW_MS
  );
}

/**
 * Verifies an App Store JWS and returns its payload. Anything else, however
 * malformed, throws AppleSignatureError.
 */
export async function verifyAppleSigned<T extends { signedDate?: number }>(
  jws: string,
): Promise<T> {
  try {
    return await verify<T>(jws);
  } catch (error) {
    if (error instanceof AppleSignatureError) throw error;
    // A certificate or signature the libraries can't parse.
    throw new AppleSignatureError("malformed JWS");
  }
}

async function verify<T extends { signedDate?: number }>(jws: string): Promise<T> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new AppleSignatureError("not a JWS");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: unknown; x5c?: unknown };
  let payload: T;
  try {
    header = decodeObject(headerPart);
    payload = decodeObject(payloadPart) as T;
  } catch {
    throw new AppleSignatureError("malformed JWS");
  }
  if (header.alg !== "ES256") throw new AppleSignatureError("unexpected algorithm");
  const chain = header.x5c;
  if (!Array.isArray(chain) || chain.length !== 3 || !chain.every((c) => typeof c === "string")) {
    throw new AppleSignatureError("unexpected certificate chain");
  }

  let leaf: x509.X509Certificate;
  let intermediate: x509.X509Certificate;
  try {
    leaf = new x509.X509Certificate(chain[0] as string);
    intermediate = new x509.X509Certificate(chain[1] as string);
  } catch {
    throw new AppleSignatureError("unreadable certificate");
  }

  // Certificates must have been valid when the data was signed.
  const signedAt = typeof payload.signedDate === "number" ? payload.signedDate : Date.now();

  // The intermediate must chain to a root we trust, not to whatever the token sent.
  let anchored = false;
  for (const root of roots()) {
    if (
      intermediate.issuer === root.subject &&
      validAt(root, signedAt) &&
      (await intermediate.verify({ publicKey: root, signatureOnly: true }))
    ) {
      anchored = true;
      break;
    }
  }
  if (!anchored) throw new AppleSignatureError("not signed by Apple");

  const basic = intermediate.getExtension(x509.BasicConstraintsExtension);
  if (!basic?.ca || !intermediate.getExtension(INTERMEDIATE_OID)) {
    throw new AppleSignatureError("unexpected intermediate certificate");
  }
  if (
    leaf.issuer !== intermediate.subject ||
    !(await leaf.verify({ publicKey: intermediate, signatureOnly: true }))
  ) {
    throw new AppleSignatureError("leaf not signed by the intermediate");
  }
  if (!leaf.getExtension(LEAF_OID))
    throw new AppleSignatureError("not an App Store signing certificate");
  if (!validAt(intermediate, signedAt) || !validAt(leaf, signedAt)) {
    throw new AppleSignatureError("certificate not valid when signed");
  }

  // Finally the JWS itself; ES256 signatures are raw r‖s, as Web Crypto expects.
  let key: CryptoKey;
  try {
    key = await leaf.publicKey.export({ name: "ECDSA", namedCurve: "P-256" }, ["verify"]);
  } catch {
    throw new AppleSignatureError("unexpected signing key");
  }
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    fromBase64url(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new AppleSignatureError("bad signature");
  return payload;
}

/** A StoreKit 2 transaction (JWSTransactionDecodedPayload), the fields Hop uses. */
export type AppleTransaction = {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  type: string;
  purchaseDate: number;
  expiresDate?: number;
  revocationDate?: number;
  appAccountToken?: string;
  /** Superseded by an upgrade to a higher level, which comes as its own transaction. */
  isUpgraded?: boolean;
  environment: "Sandbox" | "Production" | string;
  signedDate: number;
};

/** Subscription renewal info (JWSRenewalInfoDecodedPayload), the fields Hop uses. */
export type AppleRenewalInfo = {
  originalTransactionId: string;
  autoRenewStatus?: number;
  gracePeriodExpiresDate?: number;
  environment: string;
  signedDate: number;
};

/** An App Store Server Notification V2 (ResponseBodyV2DecodedPayload). */
export type AppleNotification = {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  data?: {
    appAppleId?: number;
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
  signedDate: number;
};
