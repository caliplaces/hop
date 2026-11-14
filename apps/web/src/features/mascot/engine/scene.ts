import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  blendPose,
  CHEER_PERIOD,
  type MascotState,
  NEUTRAL,
  type Pose,
  poseFor,
  Spring,
} from "./motion";
import { buildRig, makeStar, type Rig } from "./rig";

export type { MascotState };

export type MascotOptions = {
  color: string;
  /** Fur shells: 28 for hero sizes, ~12 for small sizes and low-power devices. */
  shells?: number;
  state?: MascotState;
  /** Keep the GL buffer so screenshots work (used by the lab/capture). */
  preserveDrawingBuffer?: boolean;
};

export type MascotController = {
  setState(state: MascotState): void;
  setColor(hex: string): void;
  /** Where to look, -1…1 in both axes (screen space). */
  setLook(x: number, y: number): void;
  /** A tap on Bobble: a giggle and an antenna boing. */
  poke(): void;
  /** Advance to an absolute time in seconds and draw. */
  render(time: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

const BLEND_SECONDS = 0.3;
const STEP = 1 / 240;
const POKE_SECONDS = 0.75;
/** Per-state camera framing: where to look (height) and how far back to stand. */
const FRAMING: Record<MascotState, { y: number; distance: number }> = {
  idle: { y: 1.08, distance: 7.6 },
  busy: { y: 1.55, distance: 8.9 },
  cheer: { y: 1.4, distance: 8.9 },
  broken: { y: 1.05, distance: 7.6 },
  sleep: { y: 0.9, distance: 7.1 },
};

const CONFETTI = ["#FF6B5B", "#FFC93C", "#3DDC97", "#38BDF8", "#7C4DFF", "#F472B6"];

/** Small deterministic RNG so captures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D) => void, srgb = false) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  draw(canvas.getContext("2d") as CanvasRenderingContext2D);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const shadowTexture = () =>
  canvasTexture((ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,0.5)");
    g.addColorStop(0.55, "rgba(0,0,0,0.18)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });

const zTexture = () =>
  canvasTexture((ctx) => {
    ctx.fillStyle = "#8a8a94";
    ctx.font = "800 104px ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("z", 64, 70);
  }, true);

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  for (const m of Array.isArray(material) ? material : [material]) m.dispose();
}

type ParticleKind = "dust" | "confetti" | "z";
type Particle = {
  mesh: THREE.Mesh | THREE.Sprite;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  life: number;
  kind: ParticleKind;
};

export function createMascot(canvas: HTMLCanvasElement, options: MascotOptions): MascotController {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps palette hues true
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 50);
  const initialFrame = FRAMING[options.state ?? "idle"];
  const shot = { y: initialFrame.y, distance: initialFrame.distance };
  function placeCamera() {
    camera.position.set(0, shot.y + 0.35, shot.distance);
    camera.lookAt(0, shot.y, 0);
  }
  placeCamera();

  // Soft studio light: warm key, cool fill, strong rim for a toy-like edge, and
  // a ground bounce tinted by Bobble's own colour so it sits in its scene.
  const hemisphere = new THREE.HemisphereLight("#ffffff", "#e8dfd2", 1.1);
  const key = new THREE.DirectionalLight("#fff6ec", 2.1);
  key.position.set(-3, 5, 4);
  const rim = new THREE.DirectionalLight("#ffffff", 2.4);
  rim.position.set(3.5, 3, -4);
  const fill = new THREE.DirectionalLight("#e9f1ff", 0.6);
  fill.position.set(4, 1, 3);
  scene.add(hemisphere, key, rim, fill);

  const rig: Rig = buildRig({ color: options.color, shells: options.shells ?? 28 });
  scene.add(rig.root);

  const shadowMap = shadowTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 2.5),
    new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;
  scene.add(shadow);

  // Orbiting stars for the dizzy "broken" state.
  const starMaterial = new THREE.MeshPhysicalMaterial({
    color: "#FFD447",
    emissive: "#FFB800",
    emissiveIntensity: 0.25,
    roughness: 0.35,
    clearcoat: 1,
  });
  const stars = [0, 1, 2].map(() => {
    const s = makeStar(starMaterial);
    scene.add(s);
    return s;
  });

  const zMap = zTexture();
  const zMaterial = new THREE.SpriteMaterial({ map: zMap, transparent: true, depthWrite: false });
  const dustMaterial = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    depthWrite: false,
  });
  const dustGeometry = new THREE.SphereGeometry(0.1, 12, 10);
  const confettiGeometry = new THREE.PlaneGeometry(0.16, 0.09);
  const particles: Particle[] = [];
  const random = rng(7);

  function applyColor(hex: string) {
    const base = new THREE.Color(hex);
    for (const coat of rig.paint.coat) coat.color.copy(base);
    // The under-coat (seen between strands) is a deeper shade, which gives the fur depth.
    rig.paint.undercoat.color.copy(base).multiplyScalar(0.9);
    rig.paint.paws.color.copy(base).multiplyScalar(0.92);
    rig.paint.accent.color.copy(base);
    hemisphere.groundColor.set("#e8dfd2").lerp(base, 0.3);
  }
  applyColor(options.color);

  let state: MascotState = options.state ?? "idle";
  let stateStart = 0;
  let blendFrom: Pose = NEUTRAL;
  let lastPose: Pose = NEUTRAL;
  let lastTime: number | null = null;
  let simTime = 0;
  let prevY = 0;
  let prevVy = 0;
  let prevTurn = 0;
  let airborne = false;
  let lastCheerCycle = -1;
  let nextZ = 0;
  let pokeAt = Number.NEGATIVE_INFINITY;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const squashSpring = new Spring(1, 520, 18); // slightly underdamped: a soft jiggle
  const antennaSpring = { x: new Spring(0, 95, 4.2), z: new Spring(0, 95, 4.2) };

  function spawnDust() {
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(dustGeometry, dustMaterial.clone());
      const a = (i / 6) * Math.PI * 2 + random();
      mesh.position.set(rig.root.position.x + Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.4 + 0.2);
      scene.add(mesh);
      particles.push({
        mesh,
        velocity: new THREE.Vector3(Math.cos(a) * 0.9, 0.25 + random() * 0.2, Math.sin(a) * 0.5),
        spin: new THREE.Vector3(),
        age: 0,
        life: 0.45 + random() * 0.15,
        kind: "dust",
      });
    }
  }

  function spawnConfetti(origin: THREE.Vector3, count = 34, power = 1) {
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: CONFETTI[i % CONFETTI.length],
        side: THREE.DoubleSide,
        transparent: true,
      });
      const mesh = new THREE.Mesh(confettiGeometry, material);
      mesh.position.copy(origin);
      const a = random() * Math.PI * 2;
      const up = (1.6 + random() * 1.4) * power;
      const out = (1.1 + random() * 1.3) * power;
      scene.add(mesh);
      particles.push({
        mesh,
        velocity: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out * 0.6),
        spin: new THREE.Vector3(random() * 12, random() * 12, random() * 12),
        age: 0,
        life: 1.5 + random() * 0.5,
        kind: "confetti",
      });
    }
  }

  function spawnZ(origin: THREE.Vector3) {
    const sprite = new THREE.Sprite(zMaterial.clone());
    sprite.position.copy(origin);
    sprite.scale.setScalar(0.26);
    scene.add(sprite);
    particles.push({
      mesh: sprite,
      velocity: new THREE.Vector3(0.22, 0.38, 0),
      spin: new THREE.Vector3(),
      age: 0,
      life: 2.6,
      kind: "z",
    });
  }

  function stepParticles(dt: number) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i] as Particle;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        scene.remove(p.mesh);
        disposeMaterial(p.mesh.material);
        particles.splice(i, 1);
        continue;
      }
      if (p.kind === "confetti") {
        p.velocity.y -= 4.2 * dt;
        p.velocity.multiplyScalar(1 - 0.9 * dt); // paper drag: drifts instead of dropping
      }
      if (p.kind === "dust") p.velocity.multiplyScalar(1 - 3 * dt);
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      const material = p.mesh.material as THREE.Material & { opacity: number };
      if (p.kind === "dust") {
        p.mesh.scale.setScalar(0.6 + k * 1.5);
        material.opacity = 0.7 * (1 - k);
      } else if (p.kind === "confetti") {
        material.opacity = k > 0.75 ? (1 - k) / 0.25 : 1;
      } else {
        p.mesh.position.x += Math.sin(p.age * 2.4) * 0.004;
        p.mesh.scale.setScalar(0.24 + k * 0.3);
        material.opacity = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      }
    }
  }

  /** The poke overlay: a squishy giggle layered over whatever state is running. */
  function withPoke(pose: Pose, time: number): Pose {
    const k = (time - pokeAt) / POKE_SECONDS;
    if (k < 0 || k >= 1) return pose;
    const squish = Math.sin(k * Math.PI * 3) * (1 - k) * 0.14;
    return {
      ...pose,
      squash: pose.squash - squish,
      tilt: pose.tilt + Math.sin(k * Math.PI * 4) * (1 - k) * 0.12,
      eye: pose.eye === "open" ? "happy" : pose.eye,
      mouth: pose.mouth === "smile" ? "open" : pose.mouth,
      blink: 0,
    };
  }

  function applyPose(pose: Pose, dt: number, time: number) {
    // Squash & stretch with volume preservation, through a spring for jiggle.
    const sy = squashSpring.step(pose.squash, dt);
    const sxz = 1 / Math.sqrt(Math.max(0.5, sy));
    rig.squash.scale.set(sxz, sy, sxz);

    // Eyes follow the pointer unless the pose wants them somewhere (e.g. up at the clip).
    const w = pose.look.weight;
    const lookX = pointer.x * (1 - w) + pose.look.x * w;
    const lookY = pointer.y * (1 - w) + pose.look.y * w;

    rig.root.position.set(pose.x, pose.y, 0);
    rig.root.rotation.order = "YXZ";
    rig.root.rotation.y = pose.turn + pose.spin + pointer.x * 0.38 * (1 - w);
    rig.root.rotation.x = pose.lean - pointer.y * 0.12 * (1 - w);
    rig.root.rotation.z = pose.tilt;

    // Feet stay planted while the body squashes; one lifts on each side-step.
    rig.feet.forEach((foot, i) => {
      const side = i === 0 ? -1 : 1;
      foot.position.y = 0.08 + Math.max(0, side * pose.lift) * 0.07;
      foot.scale.set(1.05 * sxz, 0.55, 1.35);
    });
    rig.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      arm.rotation.z = side * (i === 0 ? pose.armL : pose.armR);
    });

    // Eyes & mouth
    for (const eye of rig.eyes) {
      eye.open.visible = pose.eye === "open";
      eye.happy.visible = pose.eye === "happy";
      eye.closed.visible = pose.eye === "closed";
      eye.squeeze.visible = pose.eye === "squeeze";
      eye.group.scale.y = pose.eye === "open" ? Math.max(0.08, 1 - pose.blink) : 1;
      eye.group.position.x = lookX * 0.03;
      eye.group.position.y = lookY * 0.035;
    }
    for (const [mode, mesh] of Object.entries(rig.mouths)) mesh.visible = mode === pose.mouth;
    if (pose.mouth === "o") rig.mouths.o.scale.setScalar(1 + 0.2 * Math.sin(time * 1.85));
    rig.bandage.visible = pose.bandage;

    // Antenna: lags behind vertical motion and turns (follow-through), flops when sad.
    const vy = (pose.y - prevY) / Math.max(dt, 1e-4);
    const ay = (vy - prevVy) / Math.max(dt, 1e-4);
    prevY = pose.y;
    prevVy = vy;
    const turnVelocity = (rig.root.rotation.y - prevTurn) / Math.max(dt, 1e-4);
    prevTurn = rig.root.rotation.y;
    const inertia = Math.max(-60, Math.min(60, ay)) * 0.9;
    rig.antenna.rotation.x = antennaSpring.x.step(
      -pose.antennaDroop * 0.3,
      dt,
      inertia + pose.antennaPush,
    );
    rig.antenna.rotation.z = antennaSpring.z.step(pose.antennaDroop * 1.05, dt, -turnVelocity * 6);

    // Fur tips droop a little and trail behind hops and turns.
    rig.fur.uTime.value = time;
    rig.fur.uSway.value.set(
      Math.max(-0.04, Math.min(0.04, -turnVelocity * 0.01)),
      -0.022 + Math.max(-0.04, Math.min(0.04, -vy * 0.012)),
      0,
    );

    // The clip spins like a plate on a stick while busy.
    rig.clip.visible = pose.clip > 0.01;
    if (rig.clip.visible) {
      rig.clip.scale.setScalar(pose.clip);
      rig.clip.rotation.y = time * 2.4;
      rig.clip.rotation.z = 0.08 * Math.sin(time * 2.7);
      rig.clip.position.y = rig.clipRestY + 0.03 * Math.abs(Math.sin(time * 4.8));
    }

    // Sleep bubble breathes; the sweat drop slides down the side of the head.
    rig.bubble.visible = pose.bubble > 0.01;
    if (rig.bubble.visible) rig.bubble.scale.setScalar(0.25 + pose.bubble * 0.85);
    rig.sweat.visible = pose.sweat > 0.02 && pose.sweat < 0.9;
    if (rig.sweat.visible) {
      const k = pose.sweat;
      const spot = rig.surface(-0.95, 1.5 - k * 0.45, 0.5);
      rig.sweat.position.copy(spot.position);
      const material = rig.sweat.material as THREE.MeshPhysicalMaterial;
      material.opacity = 0.9 * Math.min(1, k * 6) * Math.min(1, (0.9 - k) * 6);
    }

    // Contact shadow shrinks and fades as Bobble leaves the ground.
    const lift = Math.min(1, pose.y / 0.9);
    shadow.scale.setScalar((1 - lift * 0.35) * sxz);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.9 - lift * 0.55;
    shadow.position.x = pose.x;

    // Stars orbit the head when dizzy.
    stars.forEach((s, i) => {
      s.visible = pose.bandage;
      if (!s.visible) return;
      const a = time * 2.2 + (i * Math.PI * 2) / 3;
      s.position.set(
        Math.cos(a) * 0.72,
        rig.headTop * sy + 0.34 + Math.sin(a * 2) * 0.05,
        Math.sin(a) * 0.45,
      );
      s.rotation.z = time * 3 + i;
    });

    // Event-driven effects.
    if (pose.y > 0.12) airborne = true;
    if (airborne && pose.y < 0.004) {
      airborne = false;
      spawnDust();
    }
    if (state === "cheer") {
      const local = time - stateStart;
      const cycle = Math.floor(local / CHEER_PERIOD);
      if (local % CHEER_PERIOD > 0.5 && cycle !== lastCheerCycle) {
        lastCheerCycle = cycle;
        spawnConfetti(new THREE.Vector3(pose.x, pose.y + rig.headTop, 0));
      }
    }
    if (state === "sleep" && time >= nextZ) {
      nextZ = time + 1.3;
      spawnZ(new THREE.Vector3(0.45, rig.headTop * sy - 0.05, 0.4));
    }
  }

  function step(dt: number) {
    simTime += dt;
    // Ease the camera towards this state's framing (a gentle push in or out).
    const frame = FRAMING[state];
    const k = Math.min(1, dt * 2.2);
    shot.y += (frame.y - shot.y) * k;
    shot.distance += (frame.distance - shot.distance) * k;
    placeCamera();
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 6);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 6);
    const local = simTime - stateStart;
    let pose = poseFor(state, local);
    if (local < BLEND_SECONDS) pose = blendPose(blendFrom, pose, local / BLEND_SECONDS);
    pose = withPoke(pose, simTime);
    lastPose = pose;
    applyPose(pose, dt, simTime);
    stepParticles(dt);
  }

  return {
    setState(next) {
      if (next === state) return;
      // Finishing an upload: the clip bursts into confetti right where it was.
      if (state === "busy" && next === "cheer" && rig.clip.visible) {
        const origin = new THREE.Vector3();
        rig.clip.getWorldPosition(origin);
        spawnConfetti(origin, 26, 0.8);
        lastPose = { ...lastPose, clip: 0 };
      }
      blendFrom = lastPose;
      state = next;
      stateStart = simTime;
      lastCheerCycle = -1;
      nextZ = simTime + 0.4;
    },
    setColor(hex) {
      applyColor(hex);
    },
    setLook(x, y) {
      pointer.tx = Math.max(-1, Math.min(1, x));
      pointer.ty = Math.max(-1, Math.min(1, y));
    },
    poke() {
      pokeAt = simTime;
      antennaSpring.x.kick(-9);
      antennaSpring.z.kick((random() - 0.5) * 10);
    },
    render(time) {
      if (lastTime === null) lastTime = time;
      let dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      while (dt > 0) {
        const h = Math.min(STEP, dt);
        step(h);
        dt -= h;
      }
      renderer.render(scene, camera);
    },
    resize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const p of particles) {
        scene.remove(p.mesh);
        disposeMaterial(p.mesh.material);
      }
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of materials) m.dispose();
        }
      });
      for (const texture of [shadowMap, zMap, environment]) texture.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
