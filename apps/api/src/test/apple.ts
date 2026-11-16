import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { base64url } from "../lib/crypto";

/**
 * A stand-in for Apple's App Store signing PKI, for tests: a root, a "WWDR"
 * intermediate and an App Store signing leaf, each carrying Apple's marker
 * extensions unless a test leaves them out to forge something.
 */

x509.cryptoProvider.set(crypto);

const LEAF_OID = "1.2.840.113635.100.6.11.1";
const INTERMEDIATE_OID = "1.2.840.113635.100.6.2.1";
/** An ASN.1 NULL: Apple's marker extensions carry no value worth reading. */
const NULL = new Uint8Array([5, 0]);
const YEAR = 365 * 24 * 60 * 60 * 1000;

export type TestPki = {
  root: x509.X509Certificate;
  intermediate: x509.X509Certificate;
  leaf: x509.X509Certificate;
  leafKey: CryptoKey;
};

type Options = {
  /** Leave Apple's App Store marker off the leaf, like a developer's own certificate. */
  leafMarker?: boolean;
  intermediateMarker?: boolean;
  intermediateIsCa?: boolean;
  /** When the leaf is valid, by default a year either side of now. */
  leafValid?: { from: number; to: number };
};

const ecdsa = (namedCurve: string) =>
  crypto.subtle.generateKey({ name: "ECDSA", namedCurve }, true, [
    "sign",
    "verify",
  ]) as Promise<CryptoKeyPair>;

let serial = 1;

export async function makePki(options: Options = {}): Promise<TestPki> {
  const now = Date.now();
  const rootKeys = await ecdsa("P-384");
  const root = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: String(serial++).padStart(2, "0"),
    name: "CN=Test Root CA - G3, O=Test",
    notBefore: new Date(now - 10 * YEAR),
    notAfter: new Date(now + 10 * YEAR),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-384" },
    keys: rootKeys,
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });

  const intermediateKeys = await ecdsa("P-384");
  const intermediate = await x509.X509CertificateGenerator.create({
    serialNumber: String(serial++).padStart(2, "0"),
    subject: "CN=Test WWDR, O=Test",
    issuer: root.subject,
    notBefore: new Date(now - 5 * YEAR),
    notAfter: new Date(now + 5 * YEAR),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-384" },
    publicKey: intermediateKeys.publicKey,
    signingKey: rootKeys.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(options.intermediateIsCa ?? true, 0, true),
      ...(options.intermediateMarker === false
        ? []
        : [new x509.Extension(INTERMEDIATE_OID, false, NULL)]),
    ],
  });

  const leafKeys = await ecdsa("P-256");
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: String(serial++).padStart(2, "0"),
    subject: "CN=Test App Store Signing, O=Test",
    issuer: intermediate.subject,
    notBefore: new Date(options.leafValid?.from ?? now - YEAR),
    notAfter: new Date(options.leafValid?.to ?? now + YEAR),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-384" },
    publicKey: leafKeys.publicKey,
    signingKey: intermediateKeys.privateKey,
    extensions: options.leafMarker === false ? [] : [new x509.Extension(LEAF_OID, false, NULL)],
  });
  return { root, intermediate, leaf, leafKey: leafKeys.privateKey };
}

const b64 = (cert: x509.X509Certificate) => cert.toString("base64");

/** The root to trust, as APPLE_ROOT_CERTIFICATES holds it. */
export const trustedRoot = (pki: TestPki) => b64(pki.root);

/** Signs `payload` like the App Store: ES256 with the chain in x5c. */
export async function signLikeApple(
  pki: TestPki,
  payload: unknown,
  header: Record<string, unknown> = {},
): Promise<string> {
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const head = encode({
    alg: "ES256",
    x5c: [b64(pki.leaf), b64(pki.intermediate), b64(pki.root)],
    ...header,
  });
  const body = encode(payload);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pki.leafKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
}
