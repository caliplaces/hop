import type { EyeMode, MouthMode } from "./rig";

export type MascotState = "idle" | "run" | "cheer" | "broken" | "sleep";

/** Everything a state decides about one frame. Continuous fields blend between states. */
export type Pose = {
  y: number; // hop height
  squash: number; // target vertical scale (springs make it jiggle)
  turn: number; // rotation around Y
  lean: number; // forward tilt
  tilt: number; // sideways tilt
  spin: number; // extra Y rotation (cheer spin)
  armRaise: number; // 0 down … 1 up
  armSwing: number; // alternating pump
  footStep: number; // alternating feet, -1 … 1
  earDroop: number; // 0 perky … 1 floppy
  blink: number; // 0 open … 1 closed
  eye: EyeMode;
  mouth: MouthMode;
  bandage: boolean;
};

export const NEUTRAL: Pose = {
  y: 0,
  squash: 1,
  turn: 0,
  lean: 0,
  tilt: 0,
  spin: 0,
  armRaise: 0,
  armSwing: 0,
  footStep: 0,
  earDroop: 0.1,
  blink: 0,
  eye: "open",
  mouth: "smile",
  bandage: false,
};

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Natural-looking blinks: two overlapping rhythms so they never feel metronomic. */
function blinkAt(t: number): number {
  const pulse = (period: number, offset: number) => {
    const p = (t + offset) % period;
    return p < 0.16 ? Math.sin((p / 0.16) * Math.PI) : 0;
  };
  return Math.max(pulse(3.9, 0), pulse(6.7, 2.1));
}

/** Hop arc: parabola over `air` fraction of the cycle, ground contact for the rest. */
function hop(u: number, height: number, air: number) {
  if (u < 1 - air) return { y: 0, grounded: true, a: 0 };
  const a = (u - (1 - air)) / air;
  return { y: height * 4 * a * (1 - a), grounded: false, a };
}

const RUN_PERIOD = 0.38;
export const CHEER_PERIOD = 2.4;

export function poseFor(state: MascotState, t: number): Pose {
  switch (state) {
    case "idle": {
      // Breathing, a gentle sway, and a little bounce every few seconds.
      const cycle = t % 5.5;
      const bounce =
        cycle > 4.6 ? hop((cycle - 4.6) / 0.6, 0.18, 0.7) : { y: 0, grounded: true, a: 0 };
      const anticip =
        cycle > 4.4 && cycle < 4.6 ? Math.sin(((cycle - 4.4) / 0.2) * Math.PI) * 0.06 : 0;
      return {
        ...NEUTRAL,
        y: bounce.y,
        squash: 1 + 0.022 * Math.sin(t * 2.1) - anticip + (bounce.grounded ? 0 : 0.05),
        tilt: 0.035 * Math.sin(t * 1.15),
        turn: 0.08 * Math.sin(t * 0.55),
        armSwing: 0.08 * Math.sin(t * 2.1),
        blink: blinkAt(t),
      };
    }
    case "run": {
      // Bouncy hop-run: squash on contact, stretch in the air, feet patter.
      const u = (t % RUN_PERIOD) / RUN_PERIOD;
      const step = hop(u, 0.34, 0.72);
      const speed = step.grounded ? 0 : Math.abs(1 - 2 * step.a); // fastest at take-off and landing
      const contact = step.grounded ? Math.sin((u / 0.28) * Math.PI) : 0;
      const stride = Math.floor(t / RUN_PERIOD) % 2 === 0 ? 1 : -1;
      return {
        ...NEUTRAL,
        y: step.y,
        squash: 1 + 0.1 * speed ** 1.4 - 0.11 * contact,
        turn: -0.55,
        lean: 0.16,
        tilt: 0.04 * stride,
        armSwing: 0.7 * stride * Math.sin(u * Math.PI),
        footStep: stride * Math.cos(u * Math.PI),
        earDroop: 0,
        blink: blinkAt(t) * 0.6,
        mouth: "smile",
      };
    }
    case "cheer": {
      // Anticipation, a spinning jump with arms up, a squashy landing, happy bobbing.
      const c = t % CHEER_PERIOD;
      const pre = 0.22;
      const air = 0.62;
      if (c < pre) {
        const k = Math.sin((c / pre) * (Math.PI / 2));
        return {
          ...NEUTRAL,
          squash: 1 - 0.24 * k,
          armRaise: 0.2 * k,
          eye: "happy",
          mouth: "open",
          earDroop: 0.3 * k,
        };
      }
      if (c < pre + air) {
        const a = (c - pre) / air;
        return {
          ...NEUTRAL,
          y: 0.72 * 4 * a * (1 - a),
          squash: 1 + 0.16 * Math.abs(1 - 2 * a) ** 1.5,
          spin: TAU * easeInOut(clamp01((a - 0.05) / 0.85)),
          armRaise: 1,
          eye: "happy",
          mouth: "open",
          earDroop: 0,
        };
      }
      const after = c - pre - air;
      const land = after < 0.2 ? Math.sin((after / 0.2) * Math.PI) : 0;
      return {
        ...NEUTRAL,
        y: Math.max(0, 0.06 * Math.sin(after * 9)) * Math.exp(-after * 1.2),
        squash: 1 - 0.22 * land + 0.02 * Math.sin(after * 9),
        armRaise: 0.75 + 0.2 * Math.sin(after * 9),
        tilt: 0.06 * Math.sin(after * 4.5),
        eye: "happy",
        mouth: "open",
      };
    }
    case "broken": {
      // Plopped down, dizzy wobble, droopy ears, a plaster on the head.
      return {
        ...NEUTRAL,
        squash: 0.86 + 0.012 * Math.sin(t * 1.6),
        tilt: 0.1 * Math.sin(t * 1.05),
        turn: 0.12 * Math.sin(t * 0.7),
        lean: 0.05,
        armRaise: 0,
        armSwing: -0.25,
        earDroop: 1,
        eye: "squeeze",
        mouth: "frown",
        bandage: true,
      };
    }
    case "sleep": {
      // Curled low, slow breathing, ears flopped.
      const breath = Math.sin(t * 1.25);
      return {
        ...NEUTRAL,
        squash: 0.84 + 0.035 * breath,
        lean: -0.05,
        tilt: 0.06,
        turn: 0.15,
        earDroop: 0.85,
        armSwing: -0.1,
        eye: "closed",
        mouth: "o",
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
    squash: m(from.squash, to.squash),
    turn: m(from.turn, to.turn),
    lean: m(from.lean, to.lean),
    tilt: m(from.tilt, to.tilt),
    spin: to.spin,
    armRaise: m(from.armRaise, to.armRaise),
    armSwing: m(from.armSwing, to.armSwing),
    footStep: m(from.footStep, to.footStep),
    earDroop: m(from.earDroop, to.earDroop),
    blink: m(from.blink, to.blink),
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
}
