const MAX_EDGE = 480;
const TIMEOUT_MS = 10_000;

function canvasToJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob | null> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
}

function videoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      const target = Number.isFinite(video.duration) ? Math.min(1, video.duration / 10) : 0;
      video.currentTime = target;
    };
    video.onseeked = () => {
      if (!video.videoWidth) return finish(null);
      canvasToJpeg(video, video.videoWidth, video.videoHeight).then(finish, () => finish(null));
    };
    video.src = url;
  });
}

async function imageThumbnail(file: File): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file);
  try {
    return await canvasToJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Small JPEG preview generated on the contributor's device, so the server never
 * has to decode video. Returns null when the browser can't decode the file
 * (e.g. HEVC in some browsers); the inbox then shows a placeholder.
 */
export async function createThumbnail(file: File): Promise<Blob | null> {
  try {
    if (file.type.startsWith("video/")) return await videoThumbnail(file);
    if (file.type.startsWith("image/")) return await imageThumbnail(file);
  } catch {
    // Fall through to "no thumbnail".
  }
  return null;
}
