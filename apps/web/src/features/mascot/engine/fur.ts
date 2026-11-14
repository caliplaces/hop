import * as THREE from "three";

/**
 * Shell-textured fur. A furry part is drawn N more times (one instanced draw
 * call), each shell pushed a little further out along the normal. Each shell
 * keeps only the pixels inside a strand; strands are 3D cells seeded from the
 * un-displaced surface position, so the same strand continues through every
 * shell and tapers towards its tip. Edges use alpha-to-coverage (MSAA) rather
 * than blending, so there's no sorting cost.
 */

export type FurUniforms = {
  uFurLength: { value: number };
  uDensity: { value: number };
  uSway: { value: THREE.Vector3 };
  uTime: { value: number };
};

export type FurOptions = {
  shells: number;
  /** Fur length multiplier for this part (pompoms are fluffier). */
  length?: number;
  /** Shorter fur around a point (the face), so eyes and mouth sit on top. */
  shortAround?: { center: THREE.Vector3; inner: number; outer: number; amount: number };
};

export function createFurUniforms(): FurUniforms {
  return {
    uFurLength: { value: 0.1 },
    uDensity: { value: 30 },
    uSway: { value: new THREE.Vector3() },
    uTime: { value: 0 },
  };
}

const HASH = /* glsl */ `
  float furHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  // Coverage of one tapered strand per cell at shell height h (0 root … 1 tip).
  float furStrand(vec3 p, float h) {
    vec3 cell = floor(p);
    vec3 f = fract(p) - 0.5;
    vec3 jitter = vec3(furHash(cell + 1.3), furHash(cell + 2.7), furHash(cell + 4.1)) - 0.5;
    float strandLength = mix(0.45, 1.0, furHash(cell));
    float d = length(f - jitter * 0.8);
    // Derivatives first, outside any branch (they're undefined in divergent flow).
    float edge = max(fwidth(d), 1e-3);
    float radius = 0.74 * pow(max(0.0, 1.0 - h / strandLength), 0.75);
    return step(h, strandLength) * smoothstep(radius, radius - edge, d);
  }
`;

/** Fur material: a standard material whose shaders displace shells and cut strands. */
export function furMaterial(color: THREE.Color, uniforms: FurUniforms, options: FurOptions) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
  material.alphaToCoverage = true;
  // Colour replaces (coverage does the antialiasing), but alpha takes the MAX:
  // the canvas is transparent so the mascot sits on any page, and without this
  // each shell would write its partial strand alpha over the opaque under-coat,
  // letting the page background speckle through the body.
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.ZeroFactor;
  material.blendEquationAlpha = THREE.MaxEquation;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneFactor;
  const local = {
    uPartLength: { value: options.length ?? 1 },
    uFaceCenter: { value: options.shortAround?.center ?? new THREE.Vector3() },
    uFaceInner: { value: options.shortAround?.inner ?? 0 },
    uFaceOuter: { value: options.shortAround?.outer ?? 0 },
    uFaceAmount: { value: options.shortAround ? options.shortAround.amount : 0 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, local);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        attribute float aShell;
        uniform float uFurLength, uPartLength, uTime, uFaceInner, uFaceOuter, uFaceAmount;
        uniform vec3 uSway, uFaceCenter;
        varying float vShell;
        varying vec3 vFurPos;
        varying float vFace;`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        vShell = aShell;
        vFurPos = position;
        // Short "muzzle" fur around the face, full length elsewhere.
        float face = 1.0;
        if (uFaceOuter > 0.0) {
          face = mix(1.0 - uFaceAmount, 1.0, smoothstep(uFaceInner, uFaceOuter, distance(position, uFaceCenter)));
        }
        vFace = face;
        float h = aShell;
        float len = uFurLength * uPartLength * face;
        transformed += normalize(objectNormal) * len * h;
        // Tips trail behind motion and droop a touch; a breath of wind keeps it alive.
        vec3 wind = vec3(sin(uTime * 1.7 + position.y * 4.0), 0.0, cos(uTime * 1.3 + position.x * 4.0)) * 0.12;
        transformed += (uSway + wind * uFurLength) * len * 12.0 * h * h;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uDensity;
        varying float vShell;
        varying vec3 vFurPos;
        varying float vFace;
        ${HASH}`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        float h = vShell;
        // Strands live on two overlapping, rotated cell grids at different scales:
        // rotation keeps the grid off the body's axis (no rings on top), and two
        // grids break up any visible lattice pattern.
        const mat3 frameA = mat3(0.8, -0.36, 0.48, 0.48, 0.8, -0.36, -0.36, 0.48, 0.8);
        const mat3 frameB = mat3(0.36, 0.8, -0.48, -0.8, 0.48, 0.36, 0.48, 0.36, 0.8);
        float alpha = max(
          furStrand(frameA * vFurPos * uDensity, h),
          furStrand(frameB * vFurPos * uDensity * 1.37 + 11.3, h)
        );
        diffuseColor.a = alpha;
        if (alpha < 0.01) discard;
        // Soft self-shadowing (roots a touch deeper) plus a gentle low-frequency
        // variation so the coat looks organic rather than speckled.
        float tone = furHash(floor(vFurPos * 6.0));
        diffuseColor.rgb *= mix(0.86, 1.03, h) * mix(0.96, 1.02, tone) * mix(0.95, 1.0, vFace);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        // Velvety rim: fur catches light at grazing angles.
        float rim = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 2.4);
        totalEmissiveRadiance += diffuseColor.rgb * rim * 0.28 * (0.4 + 0.6 * h);`,
      );
  };
  // Distinct program per configuration (face vs plain parts compile the same source).
  material.customProgramCacheKey = () => "hop-fur";
  return material;
}

/** Wrap a mesh in fur shells; the mesh itself becomes the dark under-coat. */
export function addFur(mesh: THREE.Mesh, material: THREE.MeshStandardMaterial, shells: number) {
  const geometry = mesh.geometry.clone();
  const levels = new Float32Array(shells);
  for (let i = 0; i < shells; i++) levels[i] = (i + 1) / shells;
  geometry.setAttribute("aShell", new THREE.InstancedBufferAttribute(levels, 1));
  const fur = new THREE.InstancedMesh(geometry, material, shells);
  fur.frustumCulled = false;
  const identity = new THREE.Matrix4();
  for (let i = 0; i < shells; i++) fur.setMatrixAt(i, identity);
  mesh.add(fur);
  return fur;
}
