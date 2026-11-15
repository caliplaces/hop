import { beforeAll, describe, expect, it, vi } from "vitest";
import { makePki, signLikeApple, type TestPki, trustedRoot } from "../test/apple";
import { AppleSignatureError, verifyAppleSigned } from "./apple";

// The verifier trusts whatever this module lists; tests list their own root.
const trust = vi.hoisted(() => ({ roots: [] as string[] }));
vi.mock("./apple-roots", () => ({
  get APPLE_ROOT_CERTIFICATES() {
    return trust.roots;
  },
}));

let pki: TestPki;
const now = Date.now();
const transaction = { transactionId: "1", originalTransactionId: "1", signedDate: now };

beforeAll(async () => {
  pki = await makePki();
  trust.roots = [trustedRoot(pki)];
});

/** Signed by its own complete PKI, trusted for this call: it fails only on `reason`. */
async function rejectsWith(options: Parameters<typeof makePki>[0], reason: string) {
  const odd = await makePki(options);
  trust.roots = [trustedRoot(odd)];
  try {
    await expect(verifyAppleSigned(await signLikeApple(odd, transaction))).rejects.toThrow(reason);
  } finally {
    trust.roots = [trustedRoot(pki)];
  }
}

const rejects = (jws: string, reason: string) =>
  expect(verifyAppleSigned(jws)).rejects.toThrow(new AppleSignatureError(reason));

describe("verifying App Store signed data", () => {
  it("accepts data signed through Apple's chain, and returns its payload", async () => {
    const payload = await verifyAppleSigned<typeof transaction>(
      await signLikeApple(pki, transaction),
    );
    expect(payload).toEqual(transaction);
  });

  it("rejects a look-alike chain under a root it doesn't trust", async () => {
    await rejects(await signLikeApple(await makePki(), transaction), "not signed by Apple");
  });

  it("rejects a leaf without the App Store signing marker, like a developer certificate", async () => {
    await rejectsWith({ leafMarker: false }, "not an App Store signing certificate");
  });

  it("rejects an intermediate without Apple's marker, or that isn't a CA", async () => {
    await rejectsWith({ intermediateMarker: false }, "unexpected intermediate certificate");
    await rejectsWith({ intermediateIsCa: false }, "unexpected intermediate certificate");
  });

  it("rejects tampering, other algorithms and short chains", async () => {
    const [head, , sig] = (await signLikeApple(pki, transaction)).split(".");
    const other = (await signLikeApple(pki, { ...transaction, transactionId: "2" })).split(".")[1];
    await rejects(`${head}.${other}.${sig}`, "bad signature");
    await rejects(await signLikeApple(pki, transaction, { alg: "ES384" }), "unexpected algorithm");
    await rejects(await signLikeApple(pki, transaction, { alg: "none" }), "unexpected algorithm");
    const leafOnly = await signLikeApple(pki, transaction, { x5c: [pki.leaf.toString("base64")] });
    await rejects(leafOnly, "unexpected certificate chain");
    await rejects("not.a.jws", "malformed JWS");
    await rejects("nonsense", "not a JWS");
  });

  it("rejects malformed tokens as unverifiable, never with another error", async () => {
    const [head, body] = (await signLikeApple(pki, transaction)).split(".");
    const nul = btoa("null").replace(/=+$/, "");
    await rejects(`${nul}.${body}.AAAA`, "malformed JWS");
    await rejects(`${head}.${nul}.AAAA`, "malformed JWS");
    await rejects(`${head}.${body}.not*base64`, "malformed JWS");

    // An intermediate claiming to be issued by the root, with a signature
    // that isn't even well-formed DER: the X.509 library throws on it.
    const der = new Uint8Array(pki.intermediate.rawData);
    const signature = new Uint8Array(pki.intermediate.signature);
    const at = der.findLastIndex((_, i) => signature.every((byte, j) => der[i + j] === byte));
    expect(at).toBeGreaterThan(0);
    const broken = der.slice();
    broken[at] = 0x31; // the signature's SEQUENCE tag, now a SET
    const x5c = [
      pki.leaf.toString("base64"),
      btoa(String.fromCharCode(...broken)),
      pki.root.toString("base64"),
    ];
    await rejects(await signLikeApple(pki, transaction, { x5c }), "malformed JWS");
  });

  it("rejects data signed while the leaf certificate wasn't valid, by its signedDate", async () => {
    const leafValid = { from: now - 3 * 86_400_000, to: now - 86_400_000 };
    await rejectsWith({ leafValid }, "certificate not valid when signed");
    // Signed back when it was valid: fine, as Apple checks at signedDate.
    const expired = await makePki({ leafValid });
    trust.roots = [trustedRoot(expired)];
    try {
      const earlier = { ...transaction, signedDate: now - 2 * 86_400_000 };
      await expect(verifyAppleSigned(await signLikeApple(expired, earlier))).resolves.toEqual(
        earlier,
      );
    } finally {
      trust.roots = [trustedRoot(pki)];
    }
  });
});

describe("the pinned root", () => {
  it("is Apple Root CA - G3", async () => {
    const { APPLE_ROOT_CERTIFICATES } =
      await vi.importActual<typeof import("./apple-roots")>("./apple-roots");
    expect(APPLE_ROOT_CERTIFICATES).toHaveLength(1);
    const der = Uint8Array.from(atob(APPLE_ROOT_CERTIFICATES[0] as string), (c) => c.charCodeAt(0));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
    const fingerprint = [...digest]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(":")
      .toUpperCase();
    expect(fingerprint).toBe(
      "63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79",
    );
  });
});
