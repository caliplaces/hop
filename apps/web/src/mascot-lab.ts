/**
 * Mascot lab: a dev-only page for designing and reviewing the mascot.
 * Open http://localhost:5173/mascot-lab.html while `pnpm dev` runs.
 *
 * ?capture=1&state=busy&color=%23FF6B5B&size=600&shells=24 renders a single
 * mascot without a clock; window.__mascot.render(t) draws an exact frame,
 * which is how review videos are recorded. &orbit=0.8 views it from the side
 * (radians around it).
 */
import { PALETTE } from "@hop/shared";
import {
  createMascot,
  type MascotController,
  type MascotState,
} from "./features/mascot/engine/scene";

const params = new URLSearchParams(location.search);
const STATES: MascotState[] = ["idle", "busy", "cheer", "broken", "sleep"];
const root = document.getElementById("lab") as HTMLElement;

const dark = params.get("dark") === "1";
document.body.style.cssText = `margin:0;font:14px system-ui;background:${dark ? "#0b0b0c" : "#fafaf7"};color:${dark ? "#f4f4ef" : "#0b0b0c"}`;

const orbit = Number(params.get("orbit") ?? 0);

function mount(size: number, color: string, state: MascotState, shells?: number) {
  const canvas = document.createElement("canvas");
  canvas.style.width = canvas.style.height = `${size}px`;
  const framing = params.get("framing") === "portrait" ? "portrait" : "stage";
  const mascot = createMascot(canvas, {
    color,
    state,
    shells,
    framing,
    orbit,
    preserveDrawingBuffer: true,
  });
  mascot.resize(size, size);
  return { canvas, mascot };
}

if (params.get("capture") === "1") {
  const size = Number(params.get("size") ?? 600);
  const { canvas, mascot } = mount(
    size,
    params.get("color") ?? "#FF6B5B",
    (params.get("state") as MascotState) ?? "idle",
    params.get("shells") ? Number(params.get("shells")) : undefined,
  );
  root.append(canvas);
  const lx = Number(params.get("lookx") ?? 0);
  const ly = Number(params.get("looky") ?? 0);
  mascot.setLook(lx, ly);
  (window as unknown as { __mascot: MascotController }).__mascot = mascot;
} else {
  let color: string = PALETTE[0].hex;
  let state: MascotState = "idle";
  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;padding:16px;align-items:center";
  const stage = document.createElement("div");
  stage.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;padding:0 16px";
  root.append(controls, stage);

  const mascots: MascotController[] = [];
  // Hero quality and the lighter setting used for small sizes, side by side.
  for (const [label, size, shells] of [
    ["hero · 24 shells", 420, 24],
    ["small · 12 shells", 200, 12],
  ] as const) {
    const { canvas, mascot } = mount(size, color, state, shells);
    const card = document.createElement("figure");
    card.style.cssText = "margin:0;text-align:center";
    canvas.style.cursor = "pointer";
    canvas.title = "Poke me";
    canvas.onclick = () => mascot.poke();
    card.append(
      canvas,
      Object.assign(document.createElement("figcaption"), { textContent: label }),
    );
    stage.append(card);
    mascots.push(mascot);
  }

  for (const s of STATES) {
    const b = Object.assign(document.createElement("button"), { textContent: s });
    b.onclick = () => {
      state = s;
      for (const m of mascots) m.setState(s);
    };
    controls.append(b);
  }
  for (const c of PALETTE) {
    const b = document.createElement("button");
    b.title = c.name;
    b.style.cssText = `width:24px;height:24px;border-radius:999px;border:0;background:${c.hex}`;
    b.onclick = () => {
      color = c.hex;
      for (const m of mascots) m.setColor(color);
    };
    controls.append(b);
  }

  window.addEventListener("pointermove", (e) => {
    const x = (e.clientX / innerWidth) * 2 - 1;
    const y = -((e.clientY / innerHeight) * 2 - 1);
    for (const m of mascots) m.setLook(x, y);
  });
  const loop = (ms: number) => {
    for (const m of mascots) m.render(ms / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
