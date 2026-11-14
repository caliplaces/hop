import { AwsClient } from "aws4fetch";
import type { Env } from "../env";
import { signPayload } from "./crypto";

/**
 * Browsers talk to R2 directly through presigned S3 URLs, so file bytes never
 * pass through the Worker. Local dev has no S3 endpoint for the R2 simulator, so
 * without R2 credentials the same URLs point at dev-only Worker routes instead.
 */

const PART_URL_TTL_S = 60 * 60;
const GET_URL_TTL_S = 15 * 60;

let s3: { key: string; client: AwsClient } | null = null;

function s3Client(env: Env): AwsClient | null {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  if (s3?.key !== env.R2_ACCESS_KEY_ID) {
    s3 = {
      key: env.R2_ACCESS_KEY_ID,
      client: new AwsClient({
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        service: "s3",
        region: "auto",
      }),
    };
  }
  return s3.client;
}

function objectUrl(env: Env, key: string): URL {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${path}`,
  );
}

function assertDevFallbackAllowed(env: Env) {
  if (env.ENVIRONMENT !== "development") {
    throw new Error("R2 S3 credentials are required outside local development");
  }
}

export type DevPartToken = {
  purpose: "dev-part";
  exp: number;
  key: string;
  uploadId: string;
  partNumber: number;
};

export type DevObjectToken = {
  purpose: "dev-object";
  exp: number;
  key: string;
  filename: string;
  download: boolean;
  mime: string;
};

export async function presignUploadPart(
  env: Env,
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  const client = s3Client(env);
  if (!client) {
    assertDevFallbackAllowed(env);
    const token = await signPayload<DevPartToken>(env.SESSION_SECRET, {
      purpose: "dev-part",
      exp: Date.now() + PART_URL_TTL_S * 1000,
      key,
      uploadId,
      partNumber,
    });
    return `/api/dev/part?token=${encodeURIComponent(token)}`;
  }
  const url = objectUrl(env, key);
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(PART_URL_TTL_S));
  const signed = await client.sign(new Request(url, { method: "PUT" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

function contentDisposition(filename: string, download: boolean): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function presignGet(
  env: Env,
  key: string,
  opts: { filename: string; download: boolean; mime: string },
): Promise<string> {
  const client = s3Client(env);
  if (!client) {
    assertDevFallbackAllowed(env);
    const token = await signPayload<DevObjectToken>(env.SESSION_SECRET, {
      purpose: "dev-object",
      exp: Date.now() + GET_URL_TTL_S * 1000,
      key,
      ...opts,
    });
    return `/api/dev/object?token=${encodeURIComponent(token)}`;
  }
  const url = objectUrl(env, key);
  url.searchParams.set("X-Amz-Expires", String(GET_URL_TTL_S));
  url.searchParams.set(
    "response-content-disposition",
    contentDisposition(opts.filename, opts.download),
  );
  url.searchParams.set("response-content-type", opts.mime);
  const signed = await client.sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

export { contentDisposition };

/** S3 returns quoted ETags; the R2 binding works with bare ones. */
export function normalizeEtag(etag: string): string {
  return etag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}
