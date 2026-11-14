import * as THREE from "three";
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
    paws: THREE.MeshPhysicalMaterial;
  };
  fur: FurUniforms;
  eyes: {
    group: THREE.Group;
    open: THREE.Group;
    happy: THREE.Mesh;
    closed: THREE.Mesh;
    squeeze: THREE.Group;
  }[];
  mouths: Record<MouthMode, THREE.Object3D>;
  arms: THREE.Group[]; // pivots at the shoulder
  feet: THREE.Mesh[];
  antenna: THREE.Group; // spring-driven
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

function arc(radius: number, tube: number, material: THREE.Material, up: boolean) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 28, Math.PI), material);
  if (!up) mesh.rotation.z = Math.PI; // open side up = smile / closed lid
  return mesh;
}

function buildEye(size: number, ink: THREE.Material, white: THREE.Material) {
  const group = new THREE.Group();
  const open = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(size, 32, 24), ink);
  ball.scale.set(1, 1.12, 0.55);
  const big = new THREE.Mesh(new THREE.SphereGeometry(size * 0.34, 16, 12), white);
  big.position.set(-size * 0.32, size * 0.38, size * 0.45);
  const small = new THREE.Mesh(new THREE.SphereGeometry(size * 0.15, 12, 10), white);
  small.position.set(size * 0.36, -size * 0.3, size * 0.47);
  open.add(ball, big, small);

  const happy = arc(size * 0.72, size * 0.15, ink, true); // ∩ squint
  happy.position.y = -size * 0.15;
  const closed = arc(size * 0.7, size * 0.13, ink, false); // ︶ asleep
  closed.position.y = size * 0.05;
  const squeeze = new THREE.Group(); // > <
  for (const sign of [1, -1]) {
    const stroke = new THREE.Mesh(new THREE.CapsuleGeometry(size * 0.15, size * 0.85, 6, 12), ink);
    stroke.rotation.z = sign * 0.9;
    stroke.position.y = sign * size * 0.28;
    squeeze.add(stroke);
  }
  // Line-style eyes sit slightly proud so the fur doesn't swallow them.
  for (const lines of [happy, closed, squeeze]) lines.position.z = size * 0.32;
  group.add(open, happy, closed, squeeze);
  return { group, open, happy, closed, squeeze };
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
  const paws = new THREE.MeshPhysicalMaterial({
    color: base,
    roughness: 0.5,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
  });
  const inkMaterial = new THREE.MeshPhysicalMaterial({
    color: INK,
    roughness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const whiteMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const blushMaterial = new THREE.MeshBasicMaterial({
    color: BLUSH,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const mouthMaterial = new THREE.MeshPhysicalMaterial({ color: "#3a1d24", roughness: 0.4 });
  const tongueMaterial = new THREE.MeshPhysicalMaterial({ color: "#ff8fa0", roughness: 0.5 });

  const eyeY = HEIGHT * 0.43; // low-set eyes
  const faceCenter = new THREE.Vector3(0, eyeY - 0.06, radiusAt(profile, eyeY - 0.06));
  const shortFur = 0.35; // face fur is 35% of full length
  const faceLift = fur.uFurLength.value * shortFur + 0.006; // features sit on top of the face fur

  // Body + coat (the body itself is the darker under-coat seen between strands)
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), undercoat);
  squash.add(body);
  const coat = furMaterial(base, fur, {
    shells,
    shortAround: { center: faceCenter, inner: 0.42, outer: 0.72, amount: 1 - shortFur },
  });
  addFur(body, coat, shells);

  // Face
  const face = new THREE.Group();
  squash.add(face);
  const eyeSize = 0.215;
  const eyes = [-1, 1].map((side) => {
    const eye = buildEye(eyeSize, inkMaterial, whiteMaterial);
    const anchor = new THREE.Group();
    onSurface(profile, anchor, side * 0.34, eyeY, faceLift);
    anchor.add(eye.group);
    face.add(anchor);
    return eye;
  });
  for (const side of [-1, 1]) {
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.13, 32), blushMaterial);
    blush.scale.set(1.35, 0.8, 1);
    onSurface(profile, blush, side * 0.6, eyeY - 0.17, faceLift + 0.01);
    face.add(blush);
  }
  const mouthAnchor = new THREE.Group();
  onSurface(profile, mouthAnchor, 0, eyeY - 0.16, faceLift);
  face.add(mouthAnchor);
  const smile = arc(0.075, 0.019, mouthMaterial, false);
  const frown = arc(0.07, 0.018, mouthMaterial, true);
  frown.position.y = -0.04;
  const open = new THREE.Group();
  const openShell = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 24, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    mouthMaterial,
  );
  openShell.rotation.x = -Math.PI / 2;
  openShell.scale.set(1.15, 1, 0.5);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), tongueMaterial);
  tongue.scale.set(1.2, 0.7, 0.6);
  tongue.position.set(0, -0.055, 0.02);
  open.add(openShell, tongue);
  const o = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.014, 8, 20), mouthMaterial);
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

  // Feet: smooth little paw pads that stay planted while the body squashes.
  const feet = [-1, 1].map((side) => {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), paws);
    foot.scale.set(1.05, 0.55, 1.35);
    foot.position.set(side * 0.42, 0.08, 0.5);
    root.add(foot);
    return foot;
  });

  // Antenna with a fluffy pompom, spring-driven so it wobbles behind every move.
  const antenna = new THREE.Group();
  antenna.position.set(0, HEIGHT - 0.04, 0);
  const stem = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.36, 6, 12), paws);
  stem.position.y = 0.2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 28, 20), undercoat);
  ball.position.y = 0.47;
  const pompomCoat = furMaterial(base, fur, { shells, length: 1.3 });
  addFur(ball, pompomCoat, shells);
  coatParts.push(pompomCoat);
  antenna.add(stem, ball);
  squash.add(antenna);

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
    paint: { coat: coatParts, undercoat, paws },
    fur,
    eyes,
    mouths: { smile, open, frown, o },
    arms,
    feet,
    antenna,
    bandage,
    headTop: HEIGHT + fur.uFurLength.value,
  };
}
