/**
 * Renders Bobble's logo, favicon and email images from the real 3D mascot.
 *
 *   pnpm --filter @hop/web mascot:assets          # everything
 *   pnpm --filter @hop/web mascot:assets email    # only the email images
 *   pnpm --filter @hop/web mascot:assets ios      # only the iOS app images
 *
 * Starts Vite in-process, opens the mascot lab in headless Chrome, freezes
 * Bobble at an exact moment, and writes PNGs to public/bobble/ (logo) and
 * public/email/ (email heroes), or into the iOS app's asset catalog. Set
 * CHROME_PATH if Chrome isn't in the default macOS location.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { createServer } from "vite";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(webDir, "public", "bobble");
const emailDir = path.join(webDir, "public", "email");
const chrome =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Keep in sync with packages/shared/src/colors.ts (the script runs without TS).
const PALETTE = {
  coral: "#FF6B5B",
  tangerine: "#FF9F1C",
  sunflower: "#FFC93C",
  mint: "#3DDC97",
  teal: "#14B8A6",
  sky: "#38BDF8",
  ocean: "#2563EB",
  indigo: "#5B5BF0",
  grape: "#7C4DFF",
  bubblegum: "#F472B6",
  cherry: "#E11D48",
  graphite: "#3F3F46",
};
const BRAND = "grape";
const RENDER = 512;
/** A moment in the idle loop where Bobble looks straight ahead, eyes open, feet down. */
const STILL_AT = 6.62;
/**
 * Full-body poses for email heroes, shown at 200 px and rendered at 2x. Email
 * clients can't run WebGL, so each colour gets a still. `at` is the moment in
 * that state's loop; `crop` trims the stage framing's spare room (a square of
 * `size` of the frame, centred, starting `top` from the top).
 */
const EMAIL_POSES = {
  // Happy eyes in a burst of confetti (welcome email).
  cheer: { state: "cheer", at: 1.3, crop: { size: 0.84, top: 0.02 } },
  // Balancing a clip card on the antenna (new-clips digest).
  busy: { state: "busy", at: 0.33, crop: { size: 0.84, top: 0.02 } },
};
const EMAIL_SIZE = 400;
const only = process.argv[2]; // "email" to skip the logo images, "ios" for the iOS app only
/**
 * iOS app images, written straight into apps/ios's asset catalogs: two poses,
 * the face, the app icons, and Bobble idling in every athlete colour; and for
 * the widgets, Bobble's face in every colour. Bobble shows at up to ~220 pt
 * in the app, so poses render at 3x of that.
 */
const iosAssets = path.resolve(webDir, "..", "ios", "Hop", "Assets.xcassets");
/** The widget extension's catalog: Bobble's face, for the Dynamic Island. */
const widgetAssets = path.resolve(webDir, "..", "ios", "HopWidgets", "Assets.xcassets");
const IOS_POSES = {
  // Sits inside the welcome bubble.
  "bobble-idle": {
    set: "BobbleIdle",
    state: "idle",
    at: STILL_AT,
    crop: { size: 0.84, top: 0.02 },
  },
  // Greets people on the sign-in screen.
  "bobble-cheer": { set: "BobbleCheer", state: "cheer", at: 1.3, crop: { size: 0.84, top: 0.02 } },
};
const IOS_POSE_SIZE = 660;
/** Per-colour Bobbles show at up to 160 pt. */
const IOS_COLOR_POSE_SIZE = 480;
/** Per-colour faces show at up to 32 pt. */
const IOS_FACE_SIZE = 96;
const IOS_ICON_SIZE = 1024;
const XCODE_INFO = { author: "xcode", version: 1 };

const server = await createServer({ root: webDir, logLevel: "error", server: { port: 0 } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function render(
  hex,
  { state = "idle", at = STILL_AT, framing = "portrait", size = RENDER } = {},
) {
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: size });
  const url = `${base}mascot-lab.html?capture=1&framing=${framing}&state=${state}&shells=32&size=${size}&color=${encodeURIComponent(hex)}`;
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__mascot);
  await page.evaluate((until) => {
    // Simulate up to the still moment without drawing, then draw once.
    for (let t = 0; t < until; t += 1 / 60) window.__mascot.advance(t);
    window.__mascot.render(until);
  }, at);
  return page;
}

/** Downscale the WebGL canvas (optionally cropped, or onto a background) and return PNG bytes. */
async function snapshot(page, size, { background = null, padding = 0, crop = null } = {}) {
  const dataUrl = await page.evaluate(
    (size, background, padding, crop) => {
      const source = document.querySelector("canvas");
      const out = document.createElement("canvas");
      out.width = out.height = size;
      const ctx = out.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, size, size);
      }
      const side = source.width * (crop?.size ?? 1);
      const sx = (source.width - side) / 2;
      const sy = source.height * (crop?.top ?? 0);
      const inset = size * padding;
      ctx.drawImage(source, sx, sy, side, side, inset, inset, size - inset * 2, size - inset * 2);
      return out.toDataURL("image/png");
    },
    size,
    background,
    padding,
    crop,
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

if (only === "ios") {
  const hex = PALETTE[BRAND];
  for (const [name, pose] of Object.entries(IOS_POSES)) {
    const page = await render(hex, { ...pose, framing: "stage", size: 1024 });
    const png = await sharp(await snapshot(page, IOS_POSE_SIZE, { crop: pose.crop }))
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();
    fs.writeFileSync(path.join(iosAssets, `${pose.set}.imageset`, `${name}.png`), png);
    await page.close();
  }
  const page = await render(hex, { size: IOS_ICON_SIZE });
  const iconDir = path.join(iosAssets, "AppIcon.appiconset");
  // The App Store rejects icons with an alpha channel.
  const icon = await snapshot(page, IOS_ICON_SIZE, { background: "#fafaf7", padding: 0.12 });
  fs.writeFileSync(
    path.join(iconDir, "app-icon.png"),
    await sharp(icon).removeAlpha().png({ compressionLevel: 9 }).toBuffer(),
  );
  // Dark Home Screens draw their own backdrop behind a transparent icon.
  fs.writeFileSync(
    path.join(iconDir, "app-icon-dark.png"),
    await snapshot(page, IOS_ICON_SIZE, { padding: 0.12 }),
  );
  // The face beside the wordmark on the welcome screen.
  fs.writeFileSync(
    path.join(iosAssets, "BobbleFace.imageset", "bobble-face.png"),
    await snapshot(page, 128),
  );
  await page.close();

  // Bobble idling in each athlete colour, for the screens that wear it.
  const colorsDir = path.join(iosAssets, "Bobble");
  fs.mkdirSync(colorsDir, { recursive: true });
  fs.writeFileSync(
    path.join(colorsDir, "Contents.json"),
    `${JSON.stringify({ info: XCODE_INFO }, null, 2)}\n`,
  );
  const facesDir = path.join(widgetAssets, "Face");
  fs.mkdirSync(facesDir, { recursive: true });
  for (const dir of [widgetAssets, facesDir]) {
    fs.writeFileSync(
      path.join(dir, "Contents.json"),
      `${JSON.stringify({ info: XCODE_INFO }, null, 2)}\n`,
    );
  }
  const idle = IOS_POSES["bobble-idle"];
  for (const [id, colorHex] of Object.entries(PALETTE)) {
    // Bobble's face in this colour, for the widgets.
    const facePage = await render(colorHex);
    const face = path.join(facesDir, `Face-${id}.imageset`);
    fs.mkdirSync(face, { recursive: true });
    fs.writeFileSync(
      path.join(face, `face-${id}.png`),
      await sharp(await snapshot(facePage, IOS_FACE_SIZE))
        .png({ compressionLevel: 9, effort: 10 })
        .toBuffer(),
    );
    fs.writeFileSync(
      path.join(face, "Contents.json"),
      `${JSON.stringify({ images: [{ filename: `face-${id}.png`, idiom: "universal", scale: "3x" }], info: XCODE_INFO }, null, 2)}\n`,
    );
    await facePage.close();

    const colorPage = await render(colorHex, { ...idle, framing: "stage", size: 768 });
    const png = await sharp(await snapshot(colorPage, IOS_COLOR_POSE_SIZE, { crop: idle.crop }))
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();
    const set = path.join(colorsDir, `Bobble-${id}.imageset`);
    fs.mkdirSync(set, { recursive: true });
    fs.writeFileSync(path.join(set, `bobble-${id}.png`), png);
    const images = [{ filename: `bobble-${id}.png`, idiom: "universal", scale: "3x" }];
    fs.writeFileSync(
      path.join(set, "Contents.json"),
      `${JSON.stringify({ images, info: XCODE_INFO }, null, 2)}\n`,
    );
    await colorPage.close();
  }
  await browser.close();
  await server.close();
  console.log("rendered iOS assets");
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(emailDir, { recursive: true });
for (const [id, hex] of Object.entries(PALETTE)) {
  for (const [name, pose] of Object.entries(EMAIL_POSES)) {
    const page = await render(hex, { ...pose, framing: "stage" });
    // A 256-colour palette keeps each image around 20 KB for people on mobile
    // data, and looks the same as the full-colour PNG at this size.
    const png = await sharp(await snapshot(page, EMAIL_SIZE, { crop: pose.crop }))
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(path.join(emailDir, `${name}-${id}.png`), png);
    await page.close();
  }
  if (only === "email") {
    console.log("rendered", id);
    continue;
  }
  const page = await render(hex);
  fs.writeFileSync(path.join(outDir, `face-${id}.png`), await snapshot(page, 128));
  if (id === BRAND) {
    fs.writeFileSync(path.join(webDir, "public", "favicon-32.png"), await snapshot(page, 32));
    fs.writeFileSync(path.join(webDir, "public", "favicon-64.png"), await snapshot(page, 64));
    fs.writeFileSync(
      path.join(webDir, "public", "apple-touch-icon.png"),
      await snapshot(page, 180, { background: "#fafaf7", padding: 0.08 }),
    );
    fs.writeFileSync(
      path.join(webDir, "public", "icon-512.png"),
      await snapshot(page, 512, { background: "#fafaf7", padding: 0.1 }),
    );
  }
  await page.close();
  console.log("rendered", id);
}

await browser.close();
await server.close();
