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
  /** Fur shells: 24 for hero sizes, ~12 for small sizes and low-power devices. */
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
  /** Advance to an absolute time in seconds and draw. */
  render(time: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

const BLEND_SECONDS = 0.28;
const STEP = 1 / 240;
const CONFETTI = ["#FF6B5B", "#FFC93C", "#3DDC97", "#38BDF8", "#7C4DFF", "#F472B6"];

/** Small deterministic RNG so captures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function softShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.55, "rgba(0,0,0,0.2)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function zTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#8a8a94";
  ctx.font = "800 104px ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("z", 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type Particle = {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  life: number;
  kind: "dust" | "confetti" | "z";
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
  camera.position.set(0, 1.55, 8.2);
  camera.lookAt(0, 1.12, 0);

  // Soft studio light: warm key from top-left, cool fill, strong rim for a toy-like edge.
  scene.add(new THREE.HemisphereLight("#ffffff", "#e8dfd2", 1.1));
  const key = new THREE.DirectionalLight("#fff6ec", 2.1);
  key.position.set(-3, 5, 4);
  const rim = new THREE.DirectionalLight("#ffffff", 2.4);
  rim.position.set(3.5, 3, -4);
  const fill = new THREE.DirectionalLight("#e9f1ff", 0.6);
  fill.position.set(4, 1, 3);
  scene.add(key, rim, fill);

  let rig: Rig = buildRig({ color: options.color, shells: options.shells ?? 28 });
  scene.add(rig.root);

  const shadowTexture = softShadowTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 2.5),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
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

  const zMaterial = new THREE.SpriteMaterial({
    map: zTexture(),
    transparent: true,
    depthWrite: false,
  });
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
  let wasGrounded = true;
  let lastCheerCycle = -1;
  let nextZ = 0;
  const look = { x: 0, y: 0, tx: 0, ty: 0 };

  const squashSpring = new Spring(1, 520, 18); // slightly underdamped: a soft jiggle, not a pancake
  const antennaSpring = { x: new Spring(0, 95, 4.2), z: new Spring(0, 95, 4.2) };
  let prevTurn = 0;

  function spawnDust(x: number, z: number) {
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(dustGeometry, dustMaterial.clone());
      mesh.position.set(x + (random() - 0.5) * 0.3, 0.06, z + (random() - 0.5) * 0.2);
      scene.add(mesh);
      particles.push({
        mesh,
        velocity: new THREE.Vector3(
          (random() - 0.5) * 0.4 + 0.6,
          0.35 + random() * 0.25,
          (random() - 0.5) * 0.3,
        ),
        spin: new THREE.Vector3(),
        age: 0,
        life: 0.42 + random() * 0.15,
        kind: "dust",
      });
    }
  }

  function spawnConfetti(origin: THREE.Vector3) {
    for (let i = 0; i < 34; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: CONFETTI[i % CONFETTI.length],
        side: THREE.DoubleSide,
        transparent: true,
      });
      const mesh = new THREE.Mesh(confettiGeometry, material);
      mesh.position.copy(origin);
      const a = random() * Math.PI * 2;
      const up = 1.6 + random() * 1.4;
      const out = 1.1 + random() * 1.3;
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
        if (p.mesh instanceof THREE.Mesh || p.mesh instanceof THREE.Sprite)
          (p.mesh.material as THREE.Material).dispose();
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
      const material = (p.mesh as THREE.Mesh).material as THREE.Material & { opacity: number };
      if (p.kind === "dust") {
        p.mesh.scale.setScalar(0.7 + k * 1.6);
        material.opacity = 0.75 * (1 - k);
      } else if (p.kind === "confetti") {
        material.opacity = k > 0.75 ? (1 - k) / 0.25 : 1;
      } else {
        p.mesh.position.x += Math.sin(p.age * 2.4) * 0.004;
        p.mesh.scale.setScalar(0.24 + k * 0.3);
        material.opacity = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      }
    }
  }

  function applyPose(pose: Pose, dt: number, time: number) {
    // Squash & stretch with volume preservation, through a spring for jiggle.
    const sy = squashSpring.step(pose.squash, dt);
    const sxz = 1 / Math.sqrt(Math.max(0.5, sy));
    rig.squash.scale.set(sxz, sy, sxz);

    rig.root.position.y = pose.y;
    rig.root.rotation.order = "YXZ";
    rig.root.rotation.y = pose.turn + pose.spin + look.x * 0.42;
    rig.root.rotation.x = pose.lean - look.y * 0.14;
    rig.root.rotation.z = pose.tilt;

    // Feet stay planted while the body squashes; they patter during the run.
    rig.feet.forEach((foot, i) => {
      const side = i === 0 ? -1 : 1;
      foot.position.z = 0.5 + side * pose.footStep * 0.12;
      foot.position.y = 0.08 + Math.max(0, side * pose.footStep) * 0.08 - pose.y * 0; // feet travel with root
      foot.scale.set(1.05 * sxz, 0.55, 1.35);
    });

    rig.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      arm.rotation.z = side * (0.15 + pose.armRaise * 2.3);
      arm.rotation.x = (i === 0 ? 1 : -1) * pose.armSwing;
    });

    // Eyes & mouth
    for (const eye of rig.eyes) {
      eye.open.visible = pose.eye === "open";
      eye.happy.visible = pose.eye === "happy";
      eye.closed.visible = pose.eye === "closed";
      eye.squeeze.visible = pose.eye === "squeeze";
      eye.group.scale.y = pose.eye === "open" ? Math.max(0.08, 1 - pose.blink) : 1;
      eye.group.position.x = look.x * 0.025;
      eye.group.position.y = look.y * 0.02;
    }
    for (const [mode, mesh] of Object.entries(rig.mouths)) mesh.visible = mode === pose.mouth;
    if (pose.mouth === "o") rig.mouths.o.scale.setScalar(1 + 0.25 * Math.sin(time * 1.25));
    rig.bandage.visible = pose.bandage;

    // Appendages lag behind vertical motion (follow-through) and droop with mood.
    const vy = (pose.y - prevY) / Math.max(dt, 1e-4);
    const ay = (vy - prevVy) / Math.max(dt, 1e-4);
    prevY = pose.y;
    prevVy = vy;
    // The antenna lags behind vertical motion (follow-through) and flops over when sad or asleep.
    const inertia = Math.max(-60, Math.min(60, ay)) * 0.9;
    const turnVelocity = (rig.root.rotation.y - prevTurn) / Math.max(dt, 1e-4);
    prevTurn = rig.root.rotation.y;
    rig.antenna.rotation.x = antennaSpring.x.step(-pose.earDroop * 0.3, dt, inertia);
    rig.antenna.rotation.z = antennaSpring.z.step(pose.earDroop * 1.05, dt, -turnVelocity * 6);

    // Fur tips droop a little and trail behind hops and turns.
    rig.fur.uTime.value = time;
    rig.fur.uSway.value.set(
      Math.max(-0.04, Math.min(0.04, -turnVelocity * 0.01)),
      -0.022 + Math.max(-0.04, Math.min(0.04, -vy * 0.012)),
      0,
    );

    // Contact shadow shrinks and fades as the mascot leaves the ground.
    const lift = Math.min(1, pose.y / 0.9);
    shadow.scale.setScalar((1 - lift * 0.35) * sxz);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.9 - lift * 0.55;
    shadow.position.x = rig.root.position.x;

    // Stars orbit the head when dizzy.
    stars.forEach((s, i) => {
      s.visible = state === "broken";
      if (!s.visible) return;
      const a = time * 2.2 + (i * Math.PI * 2) / 3;
      s.position.set(
        Math.cos(a) * 0.7,
        rig.headTop * sy + 0.32 + Math.sin(a * 2) * 0.05,
        Math.sin(a) * 0.45,
      );
      s.rotation.z = time * 3 + i;
    });

    // Event-driven effects.
    const grounded = pose.y < 0.002;
    if (state === "run" && grounded && !wasGrounded) spawnDust(0.45, -0.2);
    wasGrounded = grounded;
    if (state === "cheer") {
      const cycle = Math.floor((time - stateStart) / CHEER_PERIOD);
      const local = (time - stateStart) % CHEER_PERIOD;
      if (local > 0.5 && cycle !== lastCheerCycle) {
        lastCheerCycle = cycle;
        spawnConfetti(new THREE.Vector3(0, pose.y + rig.headTop, 0));
      }
    }
    if (state === "sleep" && time >= nextZ) {
      nextZ = time + 1.25;
      spawnZ(new THREE.Vector3(0.45, rig.headTop * sy - 0.05, 0.4));
    }
  }

  function step(dt: number) {
    simTime += dt;
    look.x += (look.tx - look.x) * Math.min(1, dt * 6);
    look.y += (look.ty - look.y) * Math.min(1, dt * 6);
    const local = simTime - stateStart;
    let pose = poseFor(state, local);
    if (local < BLEND_SECONDS) pose = blendPose(blendFrom, pose, local / BLEND_SECONDS);
    lastPose = pose;
    applyPose(pose, dt, simTime);
    stepParticles(dt);
  }

  return {
    setState(next) {
      if (next === state) return;
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
      look.tx = Math.max(-1, Math.min(1, x));
      look.ty = Math.max(-1, Math.min(1, y));
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
      for (const p of particles) scene.remove(p.mesh);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of materials) m.dispose();
        }
      });
      shadowTexture.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      rig = undefined as unknown as Rig;
    },
  };
}
