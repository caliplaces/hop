import { Hono } from "hono";
import type { AppEnv } from "../env";
import { verifyPayload } from "../lib/crypto";
import { fail } from "../lib/http";
import { contentDisposition, type DevObjectToken, type DevPartToken } from "../lib/storage";

/**
 * Stand-ins for R2's presigned S3 URLs during local development, where the R2
 * simulator has no S3 endpoint. Only mounted when ENVIRONMENT=development.
 */
export const devRoutes = new Hono<AppEnv>()
  .put("/part", async (c) => {
    const token = await verifyPayload<DevPartToken>(
      c.env.SESSION_SECRET,
      c.req.query("token"),
      "dev-part",
    );
    if (!token) return fail(c, 403, "invalid_token");
    const multipart = c.env.BUCKET.resumeMultipartUpload(token.key, token.uploadId);
    const part = await multipart.uploadPart(token.partNumber, await c.req.arrayBuffer());
    // Mimic S3, which returns quoted ETags.
    return new Response(null, {
      headers: { etag: `"${part.etag}"`, "access-control-expose-headers": "ETag" },
    });
  })

  .get("/object", async (c) => {
    const token = await verifyPayload<DevObjectToken>(
      c.env.SESSION_SECRET,
      c.req.query("token"),
      "dev-object",
    );
    if (!token) return fail(c, 403, "invalid_token");
    const object = await c.env.BUCKET.get(token.key, { range: c.req.raw.headers });
    if (!object) return fail(c, 404, "not_found");

    const headers = new Headers({
      "content-type": token.mime,
      "content-disposition": contentDisposition(token.filename, token.download),
      "accept-ranges": "bytes",
      etag: object.httpEtag,
    });
    const range = object.range as { offset?: number; length?: number } | undefined;
    if (range && c.req.header("range")) {
      const offset = range.offset ?? 0;
      const length = range.length ?? object.size - offset;
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("content-length", String(length));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set("content-length", String(object.size));
    return new Response(object.body, { headers });
  });
