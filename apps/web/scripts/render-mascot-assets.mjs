/**
 * Renders Bobble's logo and favicon images from the real 3D mascot.
 *
 *   pnpm --filter @hop/web mascot:assets
 *
 * Starts Vite in-process, opens the mascot lab in headless Chrome, freezes
 * Bobble looking straight ahead, and writes PNGs to public/bobble/. Set
 * CHROME_PATH if Chrome isn't in the default macOS location.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(webDir, "public", "bobble");
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

const server = await createServer({ root: webDir, logLevel: "error", server: { port: 0 } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function render(hex) {
  const page = await browser.newPage();
  await page.setViewport({ width: RENDER, height: RENDER });
  const url = `${base}mascot-lab.html?capture=1&framing=portrait&state=idle&shells=32&size=${RENDER}&color=${encodeURIComponent(hex)}`;
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__mascot);
  await page.evaluate((until) => {
    // Simulate up to the still moment without drawing, then draw once.
    for (let t = 0; t < until; t += 1 / 60) window.__mascot.advance(t);
    window.__mascot.render(until);
  }, STILL_AT);
  return page;
}

/** Downscale the WebGL canvas (optionally onto a background) and return PNG bytes. */
async function snapshot(page, size, { background = null, padding = 0 } = {}) {
  const dataUrl = await page.evaluate(
    (size, background, padding) => {
      const source = document.querySelector("canvas");
      const out = document.createElement("canvas");
      out.width = out.height = size;
      const ctx = out.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, size, size);
      }
      const inset = size * padding;
      ctx.drawImage(source, inset, inset, size - inset * 2, size - inset * 2);
      return out.toDataURL("image/png");
    },
    size,
    background,
    padding,
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

fs.mkdirSync(outDir, { recursive: true });
for (const [id, hex] of Object.entries(PALETTE)) {
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
