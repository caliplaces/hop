import type { EyeMode, MouthMode } from "./rig";

/**
 * Bobble's choreography. Each state is a pure function of its local time that
 * returns a target pose; the scene blends between states and runs springs on
 * top (squash jiggle, antenna follow-through), so motion stays soft.
 */

export type MascotState = "idle" | "busy" | "cheer" | "broken" | "sleep";

export type Pose = {
  y: number; // hop height
  x: number; // side-step
  squash: number; // target vertical scale (springs make it jiggle)
  turn: number; // rotation around Y
  lean: number; // forward (+) / back (-) tilt
  tilt: number; // sideways tilt
  spin: number; // extra Y rotation (cheer spin)
  armL: number; // 0 down … 1 straight out … 2.2 up
  armR: number;
  lift: number; // which foot is lifted: -1 left … 1 right
  antennaDroop: number; // 0 upright … 1 flopped
  antennaPush: number; // impulse into the antenna spring (boing)
  look: { x: number; y: number; weight: number }; // where the pose wants the eyes, blended with the pointer
  blink: number; // 0 open … 1 closed
  eye: EyeMode;
  mouth: MouthMode;
  bandage: boolean;
  clip: number; // 0 hidden … 1 balancing the clip card
  bubble: number; // sleep bubble size, 0 … 1
  sweat: number; // sweat drop progress, 0 … 1 (0 = hidden)
};

export const NEUTRAL: Pose = {
  y: 0,
  x: 0,
  squash: 1,
  turn: 0,
  lean: 0,
  tilt: 0,
  spin: 0,
  armL: 0.12,
  armR: 0.12,
  lift: 0,
  antennaDroop: 0,
  antennaPush: 0,
  look: { x: 0, y: 0, weight: 0 },
  blink: 0,
  eye: "open",
  mouth: "smile",
  bandage: false,
  clip: 0,
  bubble: 0,
  sweat: 0,
};

/* ---------- Easing & keyframes ---------- */

type Ease = (t: number) => number;
const linear: Ease = (t) => t;
const inOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const out: Ease = (t) => 1 - (1 - t) ** 3;
const inQuad: Ease = (t) => t * t;
/** Overshoots then settles: for pops and landings. */
const back: Ease = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
export const ease = { linear, inOut, out, inQuad, back };

type Key = readonly [time: number, value: number, ease?: Ease];

/** Piecewise keyframe track; each key's ease shapes the segment arriving at it. */
export function track(t: number, keys: readonly Key[]): number {
  const first = keys[0] as Key;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e = inOut] = keys[i] as Key;
    const [t0, v0] = keys[i - 1] as Key;
    if (t <= t1) return v0 + (v1 - v0) * e((t - t0) / (t1 - t0));
  }
  return (keys[keys.length - 1] as Key)[1];
}

const TAU = Math.PI * 2;
const pulse = (t: number, at: number, length: number) =>
  t >= at && t < at + length ? Math.sin(((t - at) / length) * Math.PI) : 0;

/** Natural blinks: an irregular rhythm with the odd double-blink. */
function blinkAt(t: number): number {
  const c = t % 7.3;
  return Math.max(
    pulse(c, 1.1, 0.15),
    pulse(c, 4.2, 0.14),
    pulse(c, 4.45, 0.14),
    pulse(c, 6.4, 0.16),
  );
}

/** Little eye darts (saccades): a quick move, then a hold. */
const GLANCES = [
  [0, 0],
  [0.35, 0.1],
  [-0.25, -0.05],
  [0.1, 0.25],
  [-0.4, 0.12],
] as const;
function glance(t: number) {
  const step = 1.6;
  const i = Math.floor(t / step);
  const k = Math.min(1, ((t % step) / 0.12) ** 2);
  const a = GLANCES[i % GLANCES.length] as readonly [number, number];
  const b = GLANCES[(i + 1) % GLANCES.length] as readonly [number, number];
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k };
}

export const CHEER_PERIOD = 2.8;
export const IDLE_PERIOD = 7.2;
const BUSY_PERIOD = 1.3;

export function poseFor(state: MascotState, t: number): Pose {
  switch (state) {
    case "idle": {
      const c = t % IDLE_PERIOD;
      const g = glance(t);
      // A happy little hop near the end of each cycle, with anticipation.
      const hopY = track(c, [
        [5.4, 0],
        [5.75, 0.22, out],
        [6.05, 0, inQuad],
      ]);
      const hopSquash = track(c, [
        [5.2, 0],
        [5.4, -0.09],
        [5.5, 0.07, out],
        [6.05, 0.04],
        [6.15, -0.1, out],
        [6.45, 0, back],
      ]);
      const happy = c > 5.35 && c < 6.4;
      return {
        ...NEUTRAL,
        y: hopY,
        squash: 1 + 0.02 * Math.sin(t * 2.2) + hopSquash,
        tilt: 0.035 * Math.sin(t * 0.9),
        x: 0.03 * Math.sin(t * 0.9),
        turn: 0.06 * Math.sin(t * 0.45),
        armL: 0.12 + 0.06 * Math.sin(t * 2.2) + (happy ? 0.5 : 0),
        armR: 0.12 + 0.06 * Math.sin(t * 2.2 + 0.4) + (happy ? 0.5 : 0),
        antennaPush: pulse(c, 5.5, 0.08) * 40,
        look: { x: g.x, y: g.y, weight: 0.5 },
        blink: happy ? 0 : blinkAt(t),
        eye: happy ? "happy" : "open",
        mouth: happy ? "open" : "smile",
      };
    }

    case "busy": {
      // Balancing the clip on the antenna like a spinning plate: eyes up, arms
      // out, shifting weight foot to foot to keep it steady.
      const u = (t % BUSY_PERIOD) / BUSY_PERIOD;
      const side = Math.sin(u * TAU);
      const step = Math.abs(side);
      return {
        ...NEUTRAL,
        x: 0.07 * side,
        y: 0.035 * step,
        squash: 1 - 0.035 * (1 - step) + 0.02 * step,
        tilt: -0.07 * side,
        lean: -0.1, // looking up at the clip
        armL: 0.95 + 0.25 * Math.max(0, side),
        armR: 0.95 + 0.25 * Math.max(0, -side),
        lift: side,
        antennaPush: -side * 6,
        look: { x: 0.05 * side, y: 0.75, weight: 1 },
        blink: blinkAt(t) * 0.5,
        eye: "open",
        mouth: "o",
        clip: 1,
      };
    }

    case "cheer": {
      // Crouch, spinning jump with arms up, squashy landing, two happy bounces.
      const c = t % CHEER_PERIOD;
      const y = track(c, [
        [0.22, 0],
        [0.55, 0.82, out],
        [0.88, 0, inQuad],
        [1.12, 0.22, out],
        [1.34, 0, inQuad],
        [1.52, 0.1, out],
        [1.7, 0, inQuad],
      ]);
      const squash = track(c, [
        [0, 1],
        [0.22, 0.76, out],
        [0.3, 1.16, out],
        [0.55, 1.03],
        [0.86, 1.1],
        [0.95, 0.78, out],
        [1.12, 1.05, back],
        [1.34, 1.02],
        [1.4, 0.88, out],
        [1.52, 1.03],
        [1.7, 1],
        [1.78, 0.93],
        [2.0, 1, back],
      ]);
      const arms = track(c, [
        [0, 0.12],
        [0.22, 0.05],
        [0.4, 2.2, back],
        [0.95, 2.0],
        [1.5, 2.15],
        [2.2, 1.1],
        [CHEER_PERIOD, 0.12],
      ]);
      const wave = c > 1 ? 0.25 * Math.sin(c * 14) * Math.max(0, 1 - (c - 1) / 1.4) : 0;
      const celebrating = c < 2.3;
      return {
        ...NEUTRAL,
        y,
        squash,
        spin:
          TAU *
          track(c, [
            [0.28, 0],
            [0.84, 1, inOut],
          ]),
        armL: arms + wave,
        armR: arms - wave,
        antennaPush: pulse(c, 0.9, 0.06) * 60 + pulse(c, 1.36, 0.05) * 30,
        eye: celebrating ? "happy" : "open",
        mouth: celebrating ? "open" : "smile",
        blink: celebrating ? 0 : blinkAt(t),
      };
    }

    case "broken": {
      // Plopped down and dizzy, antenna flopped, the odd sad sigh.
      const c = t % 4.2;
      const sigh = track(c, [
        [2.6, 0],
        [3.1, 1, out],
        [3.8, 0, inOut],
      ]);
      return {
        ...NEUTRAL,
        squash: 0.84 + 0.012 * Math.sin(t * 1.6) + 0.06 * sigh,
        tilt: 0.13 + 0.05 * Math.sin(t * 0.8),
        turn: 0.1 * Math.sin(t * 0.55),
        lean: 0.06 - 0.04 * sigh,
        armL: 0.02 + 0.3 * sigh,
        armR: 0.02 + 0.3 * sigh,
        antennaDroop: 1,
        eye: "squeeze",
        mouth: "frown",
        bandage: true,
        sweat: (t % 3.1) / 3.1,
      };
    }

    case "sleep": {
      // Curled low; each breath inflates a little sleep bubble.
      const breath = Math.sin((t * TAU) / 3.4);
      return {
        ...NEUTRAL,
        squash: 0.82 + 0.035 * breath,
        lean: -0.04,
        tilt: 0.08,
        turn: 0.14,
        armL: 0,
        armR: 0,
        antennaDroop: 0.85,
        eye: "closed",
        mouth: "o",
        bubble: 0.35 + 0.65 * (0.5 + 0.5 * breath),
      };
    }
  }
}

/** Blend continuous fields; discrete ones come from `to`. */
export function blendPose(from: Pose, to: Pose, k: number): Pose {
  const m = (a: number, b: number) => a + (b - a) * k;
  return {
    ...to,
    y: m(from.y, to.y),
    x: m(from.x, to.x),
    squash: m(from.squash, to.squash),
    turn: m(from.turn, to.turn),
    lean: m(from.lean, to.lean),
    tilt: m(from.tilt, to.tilt),
    armL: m(from.armL, to.armL),
    armR: m(from.armR, to.armR),
    lift: m(from.lift, to.lift),
    antennaDroop: m(from.antennaDroop, to.antennaDroop),
    look: {
      x: m(from.look.x, to.look.x),
      y: m(from.look.y, to.look.y),
      weight: m(from.look.weight, to.look.weight),
    },
    blink: m(from.blink, to.blink),
    clip: m(from.clip, to.clip),
    bubble: m(from.bubble, to.bubble),
  };
}

/** Damped spring; underdamped values give the jelly wobble that reads as soft. */
export class Spring {
  value: number;
  velocity = 0;
  constructor(
    initial: number,
    private stiffness: number,
    private damping: number,
  ) {
    this.value = initial;
  }
  step(target: number, dt: number, force = 0) {
    const accel = this.stiffness * (target - this.value) - this.damping * this.velocity + force;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
  kick(velocity: number) {
    this.velocity += velocity;
  }
}
