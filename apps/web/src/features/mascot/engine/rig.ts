import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { addFur, createFurUniforms, type FurUniforms, furMaterial } from "./fur";

/**
 * Bobble, Hop's mascot, built from primitives. Proportions follow the "baby
 * schema": the head is the whole body, eyes are big, wide-set and below the
 * midline, the mouth is tiny, cheeks blush, limbs are stubby nubs. A fluffy
 * coat (shell fur) and a pompom antenna make it plush-toy soft.
 *
 * Origin is at the feet so squash and stretch pivot on the ground.
 */

export type EyeMode = "open" | "happy" | "closed" | "squeeze";
export type MouthMode = "smile" | "open" | "frown" | "o";

export type Rig = {
  root: THREE.Group; // hop height, turn, lean
  squash: THREE.Group; // squash & stretch, pivot at ground
  /** Materials recoloured per athlete. */
  paint: {
    coat: THREE.MeshStandardMaterial[];
    undercoat: THREE.MeshPhysicalMaterial;
    shoes: THREE.MeshPhysicalMaterial; // the sneakers' uppers and the antenna stem
    accent: THREE.MeshPhysicalMaterial; // the play icon on the clip card
    eyeGlow: THREE.MeshBasicMaterial; // the athlete's colour reflected low in each eye
  };
  fur: FurUniforms;
  eyes: {
    group: THREE.Group;
    open: THREE.Group;
    happy: THREE.Object3D;
    closed: THREE.Object3D;
    squeeze: THREE.Group;
  }[];
  mouths: Record<MouthMode, THREE.Object3D>;
  arms: THREE.Group[]; // pivots at the shoulder
  feet: THREE.Group[]; // sneakers, origin at the sole
  antenna: THREE.Group; // spring-driven
  clip: THREE.Group; // the clip card balanced on the pompom while busy
  clipRestY: number;
  bubble: THREE.Group; // sleep bubble
  sweat: THREE.Mesh; // sweat drop when broken
  /** Position + outward normal on the body surface, for props that slide along it. */
  surface: (
    angle: number,
    y: number,
    lift: number,
  ) => { position: THREE.Vector3; normal: THREE.Vector3 };
  bandage: THREE.Group;
  headTop: number;
};

export type RigOptions = {
  color: THREE.ColorRepresentation;
  /** Fur shell count: ~24 looks plush, ~12 is plenty for small sizes / phones. */
  shells: number;
};

const INK = new THREE.Color("#17171c");
const BLUSH = new THREE.Color("#ff8a9e");
const RADIUS = 1;
const HEIGHT = 1.86;

/** Lathe profile of a soft mochi: slightly bottom-heavy, flat-ish base, round top. */
function bodyProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const center = HEIGHT * 0.47;
  for (let i = 0; i <= 48; i++) {
    const theta = -Math.PI / 2 + (Math.PI * i) / 48;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const half = s < 0 ? center * 0.82 : HEIGHT - center;
    const pear = s < 0 ? 1 + 0.05 * -s : 1 - 0.05 * s;
    const x = RADIUS * pear * Math.sign(c) * Math.abs(c) ** 0.78;
    const y = center + half * s;
    points.push(new THREE.Vector2(Math.max(0, x), Math.max(0, y)));
  }
  return points;
}

/** Radius of the lathe at height y (linear interpolation over the profile). */
function radiusAt(profile: THREE.Vector2[], y: number): number {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1] as THREE.Vector2;
    const b = profile[i] as THREE.Vector2;
    if ((y >= a.y && y <= b.y) || (y <= a.y && y >= b.y)) {
      const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return 0;
}

/** Put an object on the body surface at (angle around Y, height), facing outward. */
function onSurface(
  profile: THREE.Vector2[],
  obj: THREE.Object3D,
  angle: number,
  y: number,
  lift = 0,
) {
  const r = radiusAt(profile, y);
  const dy = 0.02;
  const slope = (radiusAt(profile, y + dy) - radiusAt(profile, y - dy)) / (2 * dy);
  const normal = new THREE.Vector3(Math.sin(angle), -slope, Math.cos(angle)).normalize();
  obj.position.set(Math.sin(angle) * r, y, Math.cos(angle) * r).addScaledVector(normal, lift);
  obj.lookAt(obj.position.clone().add(normal));
}

function surfacePoint(profile: THREE.Vector2[], angle: number, y: number, lift: number) {
  const holder = new THREE.Object3D();
  onSurface(profile, holder, angle, y, lift);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(holder.quaternion);
  return { position: holder.position.clone(), normal };
}

/** An arc of a circle in the XY plane, from angle `from` to `to` (radians). */
class ArcCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private radius: number,
    private from: number,
    private to: number,
  ) {
    super();
  }
  override getPoint(t: number, target = new THREE.Vector3()) {
    const a = this.from + (this.to - this.from) * t;
    return target.set(Math.cos(a) * this.radius, Math.sin(a) * this.radius, 0);
  }
}

/**
 * A line drawn like a felt-tip stroke along an arc, with round ends: smiles,
 * squinting and sleeping eyes. 0 → π is ∩, π → 2π is ∪.
 */
function stroke(radius: number, thickness: number, from: number, to: number, ink: THREE.Material) {
  const curve = new ArcCurve(radius, from, to);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, thickness, 12, false), ink));
  const cap = new THREE.SphereGeometry(thickness, 14, 10);
  for (const t of [0, 1]) {
    const end = new THREE.Mesh(cap, ink);
    end.position.copy(curve.getPoint(t));
    group.add(end);
  }
  return group;
}

/**
 * An alpha map from a radial falloff: white (opaque) at the centre to black
 * (clear) at `radius`. Alpha maps read brightness, not the canvas's alpha.
 */
function falloff(cx: number, cy: number, radius: number, stops: [number, number][]) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 128, 128);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  for (const [at, level] of stops) {
    const v = Math.round(level * 255);
    g.addColorStop(at, `rgb(${v},${v},${v})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** Airbrushed blush: strongest in the middle, melting into the fur. */
const blushMap = () =>
  falloff(64, 64, 64, [
    [0, 1],
    [0.4, 0.8],
    [1, 0],
  ]);

/**
 * The glow low in each eye: brightest at the bottom centre, fading up and out.
 * The canvas's top is the cap's top edge, its bottom the cap's bottom.
 */
const eyeGlowMap = () =>
  falloff(64, 150, 135, [
    [0, 1],
    [0.5, 0.75],
    [1, 0],
  ]);

function buildEye(size: number, ink: THREE.Material, white: THREE.Material, glow: THREE.Material) {
  const group = new THREE.Group();
  const open = new THREE.Group();
  // A glossy dome, set into the face rather than stuck on it.
  const depth = 0.42;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(size, 32, 24), ink);
  ball.scale.set(1, 1.12, depth);
  // The athlete's colour reflected low in the eye: a thin cap over the lower front.
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(
      size * 1.012,
      32,
      16,
      Math.PI * 0.22,
      Math.PI * 0.56,
      Math.PI * 0.58,
      Math.PI * 0.32,
    ),
    glow,
  );
  cap.scale.copy(ball.scale);
  const big = new THREE.Mesh(new THREE.SphereGeometry(size * 0.3, 16, 12), white);
  big.position.set(-size * 0.3, size * 0.4, size * depth * 0.82);
  big.scale.z = 0.6;
  const small = new THREE.Mesh(new THREE.SphereGeometry(size * 0.13, 12, 10), white);
  small.position.set(size * 0.36, -size * 0.28, size * depth * 0.86);
  small.scale.z = 0.6;
  open.add(ball, cap, big, small);

  const happy = stroke(size * 0.7, size * 0.13, Math.PI * 0.12, Math.PI * 0.88, ink); // ∩ squint
  happy.position.y = -size * 0.32;
  const closed = stroke(size * 0.7, size * 0.12, Math.PI * 1.14, Math.PI * 1.86, ink); // ︶ asleep
  closed.position.y = size * 0.22;
  const squeeze = new THREE.Group(); // > <
  for (const sign of [1, -1]) {
    const stroke = new THREE.Mesh(new THREE.CapsuleGeometry(size * 0.15, size * 0.85, 6, 12), ink);
    stroke.rotation.z = sign * 0.9;
    stroke.position.y = sign * size * 0.28;
    squeeze.add(stroke);
  }
  // Line-style eyes sit slightly proud so the fur doesn't swallow them.
  for (const lines of [happy, closed, squeeze]) lines.position.z = size * 0.24;
  group.add(open, happy, closed, squeeze);
  return { group, open, happy, closed, squeeze };
}

/**
 * A happy open mouth, like a "D" on its side: a gently smiling top edge over a
 * deep round bowl, with the tongue resting inside it.
 */
function buildOpenMouth(inside: THREE.Material, tongueMaterial: THREE.Material) {
  const w = 0.105;
  const h = 0.105;
  const right = new THREE.CubicBezierCurve(
    new THREE.Vector2(w, 0),
    new THREE.Vector2(w * 1.02, -h * 0.72),
    new THREE.Vector2(w * 0.58, -h),
    new THREE.Vector2(0, -h),
  );
  const left = new THREE.CubicBezierCurve(
    new THREE.Vector2(0, -h),
    new THREE.Vector2(-w * 0.58, -h),
    new THREE.Vector2(-w * 1.02, -h * 0.72),
    new THREE.Vector2(-w, 0),
  );
  const mouth = new THREE.Shape();
  mouth.moveTo(-w, 0);
  mouth.quadraticCurveTo(0, -h * 0.2, w, 0);
  for (const { v1, v2, v3 } of [right, left])
    mouth.bezierCurveTo(v1.x, v1.y, v2.x, v2.y, v3.x, v3.y);

  // The tongue follows the bottom of the bowl, inset so the mouth frames it,
  // and bulges up in the middle.
  const inset = 0.016;
  const bowl = [...right.getPoints(24), ...left.getPoints(24).slice(1)]
    .filter((p) => p.y < -h * 0.46)
    .map((p) =>
      p
        .clone()
        .multiplyScalar(1 - inset / Math.max(w, h))
        .setY(p.y + inset * 0.6),
    );
  const tongue = new THREE.Shape();
  const first = bowl[0] as THREE.Vector2;
  const last = bowl[bowl.length - 1] as THREE.Vector2;
  tongue.moveTo(first.x, first.y);
  for (const p of bowl.slice(1)) tongue.lineTo(p.x, p.y);
  tongue.bezierCurveTo(last.x * 0.5, -h * 0.36, first.x * 0.5, -h * 0.36, first.x, first.y);

  const extrude = (shape: THREE.Shape, depth: number, bevel: number) =>
    new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 24,
    });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(extrude(mouth, 0.006, 0.01), inside));
  const tongueMesh = new THREE.Mesh(extrude(tongue, 0.004, 0.006), tongueMaterial);
  tongueMesh.position.z = 0.012;
  group.add(tongueMesh);
  return group;
}

/**
 * A little sneaker: a low, rounded toe box in the athlete's colour on a white
 * rubber sole that shows as a thin rim all round. Origin at the sole.
 */
function buildShoe(upper: THREE.Material, rubber: THREE.Material) {
  const shoe = new THREE.Group();
  const width = 0.18;
  const length = 0.25;
  const footprint = new THREE.Shape();
  footprint.absellipse(0, 0, width, length, 0, Math.PI * 2, false, 0);
  const bevel = 0.012;
  const soleHeight = 0.05;
  const sole = new THREE.Mesh(
    new THREE.ExtrudeGeometry(footprint, {
      depth: soleHeight - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 4,
      curveSegments: 48,
    }),
    rubber,
  );
  // Extruded along z; stand it on the ground, toe towards +z.
  sole.rotation.x = -Math.PI / 2;
  sole.position.y = bevel;
  // The upper is widest where it meets the sole, so only the rubber rim shows.
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 28, 0, Math.PI * 2, 0, Math.PI / 2),
    upper,
  );
  body.scale.set(width * 0.97, 0.13, length * 0.97);
  body.position.y = soleHeight - 0.004;
  shoe.add(sole, body);
  return shoe;
}

export function makeStar(material: THREE.Material) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.13 : 0.055;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelSize: 0.02,
    bevelThickness: 0.02,
    bevelSegments: 2,
  });
  geometry.center();
  return new THREE.Mesh(geometry, material);
}

export function buildRig({ color, shells }: RigOptions): Rig {
  const root = new THREE.Group();
  const squash = new THREE.Group();
  root.add(squash);
  const profile = bodyProfile();
  const fur = createFurUniforms();
  const base = new THREE.Color(color);

  const undercoat = new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.9 });
  // Soft woven uppers with a faint sheen, unlike the glossy eyes.
  const shoes = new THREE.MeshPhysicalMaterial({
    color: base,
    roughness: 0.6,
    sheen: 0.35,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color("#ffffff"),
  });
  const rubber = new THREE.MeshPhysicalMaterial({
    color: "#f6f3ec",
    roughness: 0.55,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
  });
  const eyeGlow = new THREE.MeshBasicMaterial({
    color: base,
    alphaMap: eyeGlowMap(),
    transparent: true,
    depthWrite: false,
  });
  const inkMaterial = new THREE.MeshPhysicalMaterial({
    color: INK,
    roughness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const whiteMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  // Airbrushed: strongest in the middle, fading into the fur.
  const blushMaterial = new THREE.MeshBasicMaterial({
    color: BLUSH,
    alphaMap: blushMap(),
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const mouthMaterial = new THREE.MeshPhysicalMaterial({
    color: "#3a1d24",
    roughness: 0.35,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
  });
  const tongueMaterial = new THREE.MeshPhysicalMaterial({ color: "#ff8fa0", roughness: 0.45 });

  const eyeY = HEIGHT * 0.43; // low-set eyes
  const faceCenter = new THREE.Vector3(0, eyeY - 0.06, radiusAt(profile, eyeY - 0.06));
  const shortFur = 0.35; // face fur is 35% of full length
  const faceLift = fur.uFurLength.value * shortFur + 0.006; // features sit on top of the face fur

  // Body + coat (the body itself is the darker under-coat seen between strands)
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), undercoat);
  squash.add(body);
  const coat = furMaterial(base, fur, {
    shells,
    // Short over the eyes, mouth and cheeks, so the blush isn't speckled with strands.
    shortAround: { center: faceCenter, inner: 0.6, outer: 0.88, amount: 1 - shortFur },
  });
  addFur(body, coat, shells);

  // Face
  const face = new THREE.Group();
  squash.add(face);
  const eyeSize = 0.215;
  const eyes = [-1, 1].map((side) => {
    const eye = buildEye(eyeSize, inkMaterial, whiteMaterial, eyeGlow);
    const anchor = new THREE.Group();
    onSurface(profile, anchor, side * 0.34, eyeY, faceLift);
    anchor.add(eye.group);
    face.add(anchor);
    return eye;
  });
  for (const side of [-1, 1]) {
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), blushMaterial);
    blush.scale.set(1.3, 0.78, 1);
    onSurface(profile, blush, side * 0.6, eyeY - 0.17, faceLift + 0.01);
    face.add(blush);
  }
  const mouthAnchor = new THREE.Group();
  onSurface(profile, mouthAnchor, 0, eyeY - 0.16, faceLift);
  face.add(mouthAnchor);
  const smile = stroke(0.1, 0.017, Math.PI * 1.2, Math.PI * 1.8, mouthMaterial); // ‿
  smile.position.y = 0.04;
  const frown = stroke(0.085, 0.016, Math.PI * 0.2, Math.PI * 0.8, mouthMaterial); // ⌒
  frown.position.y = -0.1;
  const open = buildOpenMouth(mouthMaterial, tongueMaterial);
  open.position.y = 0.03;
  // A small round "o", filled like the open mouth rather than a ring.
  const oShape = new THREE.Shape();
  oShape.absellipse(0, 0, 0.034, 0.042, 0, Math.PI * 2, false, 0);
  const o = new THREE.Mesh(
    new THREE.ExtrudeGeometry(oShape, {
      depth: 0.006,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 3,
      curveSegments: 32,
    }),
    mouthMaterial,
  );
  o.position.y = -0.02;
  for (const m of [smile, frown, open, o]) mouthAnchor.add(m);

  // Arms: fluffy nubs on the sides, pivoting at the shoulder.
  const coatParts: THREE.MeshStandardMaterial[] = [coat];
  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    onSurface(profile, pivot, side * 1.5, HEIGHT * 0.38, -0.08);
    pivot.lookAt(pivot.position.clone().add(new THREE.Vector3(0, 0, 1))); // keep pivot axes world-aligned
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 18), undercoat);
    nub.scale.set(0.85, 1.15, 0.85);
    nub.position.set(side * 0.08, -0.12, 0);
    const armCoat = furMaterial(base, fur, { shells, length: 0.75 });
    addFur(nub, armCoat, shells);
    coatParts.push(armCoat);
    pivot.add(nub);
    squash.add(pivot);
    return pivot;
  });

  // Feet: little sneakers, tucked under the body and toed out a touch. They
  // stay planted while the body squashes.
  const feet = [-1, 1].map((side) => {
    const shoe = buildShoe(shoes, rubber);
    shoe.position.set(side * 0.42, 0, 0.36);
    shoe.rotation.y = side * 0.16;
    root.add(shoe);
    return shoe;
  });

  // Antenna with a fluffy pompom, spring-driven so it wobbles behind every move.
  const antenna = new THREE.Group();
  antenna.position.set(0, HEIGHT - 0.04, 0);
  const stem = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.36, 6, 12), shoes);
  stem.position.y = 0.2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 28, 20), undercoat);
  ball.position.y = 0.47;
  const pompomCoat = furMaterial(base, fur, { shells, length: 1.3 });
  addFur(ball, pompomCoat, shells);
  coatParts.push(pompomCoat);
  antenna.add(stem, ball);
  squash.add(antenna);

  // The clip card Bobble balances on its pompom while uploading: a glossy card
  // with a play icon in the athlete's colour, spinning like a plate on a stick.
  const accent = new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.35, clearcoat: 0.6 });
  const clip = new THREE.Group();
  clip.position.y = 0.47 + 0.13 + fur.uFurLength.value * 1.3 + 0.3;
  const card = new THREE.Mesh(
    new RoundedBoxGeometry(0.86, 0.6, 0.07, 4, 0.09),
    new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      roughness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    }),
  );
  const play = new THREE.Shape();
  play.moveTo(-0.085, -0.115);
  play.lineTo(0.13, 0);
  play.lineTo(-0.085, 0.115);
  play.closePath();
  const playGeometry = new THREE.ExtrudeGeometry(play, {
    depth: 0.012,
    bevelEnabled: true,
    bevelSize: 0.012,
    bevelThickness: 0.008,
    bevelSegments: 2,
  });
  for (const face of [1, -1]) {
    const icon = new THREE.Mesh(playGeometry, accent);
    icon.position.z = face * 0.04;
    if (face < 0) icon.rotation.y = Math.PI;
    card.add(icon);
  }
  clip.add(card);
  clip.visible = false;
  antenna.add(clip);

  // Sleep bubble: a glassy sphere at the mouth that breathes in and out.
  const mouthPoint = surfacePoint(profile, 0.16, eyeY - 0.18, faceLift);
  const bubble = new THREE.Group();
  bubble.position.copy(mouthPoint.position).addScaledVector(mouthPoint.normal, 0.12);
  const bubbleShell = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 32, 24),
    new THREE.MeshPhysicalMaterial({
      color: "#dff4ff",
      roughness: 0.04,
      clearcoat: 1,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
  );
  const glint = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), whiteMaterial);
  glint.position.set(-0.08, 0.09, 0.16);
  bubble.add(bubbleShell, glint);
  bubble.visible = false;
  squash.add(bubble);

  // Sweat drop that slides down the side of the head when things go wrong.
  // Teardrop: a lathe whose radius swells from a point at the top to a round base.
  const dropProfile = Array.from({ length: 24 }, (_, i) => {
    const t = (i / 23) * Math.PI;
    return new THREE.Vector2(0.075 * Math.sin(t) * (1 - Math.cos(t)) * 0.62, -0.16 * Math.cos(t));
  });
  const sweat = new THREE.Mesh(
    new THREE.LatheGeometry(dropProfile, 24),
    new THREE.MeshPhysicalMaterial({
      color: "#9ad8ff",
      roughness: 0.08,
      clearcoat: 1,
      transparent: true,
      opacity: 0.9,
    }),
  );
  sweat.scale.set(1, 1, 0.75);
  sweat.visible = false;
  squash.add(sweat);

  // Bandage for the "broken" state: a little plaster on the head.
  const bandage = new THREE.Group();
  const plaster = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.075, 0.32, 6, 16),
    new THREE.MeshPhysicalMaterial({ color: "#fff4e6", roughness: 0.7 }),
  );
  plaster.rotation.z = Math.PI / 2;
  plaster.scale.set(1, 1, 0.35);
  const cross = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.022, 0.02),
    new THREE.MeshBasicMaterial({ color: "#e8c9a8" }),
  );
  cross.position.z = 0.03;
  bandage.add(plaster, cross);
  onSurface(profile, bandage, 0.45, HEIGHT * 0.83, fur.uFurLength.value + 0.01);
  bandage.rotateZ(0.5);
  squash.add(bandage);

  return {
    root,
    squash,
    paint: { coat: coatParts, undercoat, shoes, accent, eyeGlow },
    fur,
    eyes,
    mouths: { smile, open, frown, o },
    arms,
    feet,
    antenna,
    clip,
    clipRestY: clip.position.y,
    bubble,
    sweat,
    surface: (angle, y, lift) => surfacePoint(profile, angle, y, fur.uFurLength.value * lift),
    bandage,
    headTop: HEIGHT + fur.uFurLength.value,
  };
}
