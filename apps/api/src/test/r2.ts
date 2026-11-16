/** An in-memory stand-in for an R2 bucket: put, get and delete. */
export function createTestR2() {
  const objects = new Map<string, { body: Uint8Array; contentType?: string }>();
  const bucket = {
    async put(key: string, body: Uint8Array, options?: R2PutOptions) {
      const httpMetadata = options?.httpMetadata as R2HTTPMetadata | undefined;
      objects.set(key, { body: new Uint8Array(body), contentType: httpMetadata?.contentType });
      return {};
    },
    async get(key: string) {
      const object = objects.get(key);
      return object ? { body: new Blob([object.body]).stream() } : null;
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}
