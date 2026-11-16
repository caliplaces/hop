/** An in-memory stand-in for an R2 bucket: put, get, list and delete. */
export function createTestR2() {
  const objects = new Map<string, { body: Uint8Array; uploaded: Date }>();
  /** Set to make the next delete fail, as R2 sometimes does. */
  const faults = { deleteFails: false };
  const bucket = {
    async put(key: string, body: Uint8Array) {
      objects.set(key, { body: new Uint8Array(body), uploaded: new Date() });
      return {};
    },
    async get(key: string) {
      const object = objects.get(key);
      return object ? { body: new Blob([object.body]).stream() } : null;
    },
    async list({ prefix = "" }: R2ListOptions = {}) {
      const listed = [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({ key, uploaded: object.uploaded }));
      return { objects: listed, truncated: false };
    },
    async delete(keys: string | string[]) {
      if (faults.deleteFails) {
        faults.deleteFails = false;
        throw new Error("R2 is having a moment");
      }
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects, faults };
}
