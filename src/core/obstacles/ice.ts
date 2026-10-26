import { lerp, TAU } from '../math';
import type { Terrain, Vec3 } from '../types';
import { COLORS, ICE } from './catalog';
import { getGeom, ICE_VARIANTS } from './shapes';
import { IDENTITY, pick, restingY, yawQuat, type BodyPart, type BodySpec } from './specs';

/**
 * Glacier ice bodies. iceBlock / iceField members are loose, absorbable blocks the iceberg merges
 * with on contact; chunks are pieces broken off the iceberg itself (not absorbable). All of them
 * are faceted 'ice' geometries whose mass follows their hull volume at the density of ice.
 */

interface IceBodyOptions {
  kind: 'iceBlock' | 'iceField';
  part: string;
  absorbable: boolean;
  colors: readonly number[];
  placement: number;
}

/** Block dimensions (m) whose ice-hull volume weighs `mass` t, with a random squat aspect. */
function iceParts(mass: number, rng: () => number, colors: readonly number[]): BodyPart[] {
  const geom = `ice${Math.floor(rng() * ICE_VARIANTS) % ICE_VARIANTS}`;
  const ay = lerp(0.55, 0.85, rng());
  const az = lerp(0.75, 1.25, rng());
  const k = Math.cbrt(mass / (ICE.density * getGeom(geom).volume * ay * az));
  return [
    {
      geom,
      name: 'ice',
      offset: { x: 0, y: 0, z: 0 },
      rotation: IDENTITY,
      scale: { x: k, y: k * ay, z: k * az },
      color: pick(rng, colors),
      mass,
    },
  ];
}

function iceSpec(mass: number, position: Vec3, rng: () => number, o: IceBodyOptions): BodySpec {
  const parts = iceParts(mass, rng, o.colors);
  return {
    kind: o.kind,
    part: o.part,
    material: 'ice',
    proxyMode: 'extent',
    position,
    rotation: yawQuat(rng() * TAU),
    anchored: false,
    mass,
    breakImpulse: Infinity,
    breakMode: 'none',
    hitHeight: 0,
    trunkRadius: 0,
    ccd: mass < 1.5,
    settle: false,
    parts,
    placement: o.placement,
    absorbable: o.absorbable,
    noTally: true,
  };
}

function setOnGround(spec: BodySpec, terrain: Terrain, x: number, z: number): void {
  spec.position.x = x;
  spec.position.z = z;
  spec.position.y = restingY(terrain, x, z, spec.rotation, spec.parts) - 0.02;
}

/** A lone block of glacier ice resting on the ground at (x, z). */
export function iceBlockSpec(
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: { scale?: number; placement?: number } = {},
): BodySpec {
  const s = opts.scale ?? 1;
  const mass = lerp(ICE.singleMass[0], ICE.singleMass[1], rng()) * s * s * s;
  const spec = iceSpec(mass, { x, y: 0, z }, rng, {
    kind: 'iceBlock',
    part: 'ice',
    absorbable: true,
    colors: COLORS.glacier,
    placement: opts.placement ?? -1,
  });
  setOnGround(spec, terrain, x, z);
  return spec;
}

/**
 * A field of glacier blocks of mixed sizes (mostly small, a few big: stratified so every field has
 * both), scattered without overlap within `spread` of (x, z). Biggest blocks are placed first.
 */
export function iceFieldSpecs(
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: { count?: number; spread?: number; scale?: number; placement?: number } = {},
): BodySpec[] {
  const [c0, c1] = ICE.fieldCount;
  const count = Math.max(1, Math.round(opts.count ?? c0 + Math.floor(rng() * (c1 - c0 + 1))));
  const spread = opts.spread ?? ICE.fieldSpread;
  const s = opts.scale ?? 1;
  const [m0, m1] = ICE.blockMass;
  const masses = Array.from({ length: count }, (_, i) => {
    const u = (i + rng()) / count;
    return lerp(m0, m1, u ** 1.6) * s * s * s;
  }).sort((a, b) => b - a);
  const placed: { x: number; z: number; r: number }[] = [];
  return masses.map((mass) => {
    const spec = iceSpec(mass, { x, y: 0, z }, rng, {
      kind: 'iceField',
      part: 'ice',
      absorbable: true,
      colors: COLORS.glacier,
      placement: opts.placement ?? -1,
    });
    const sc = spec.parts[0].scale;
    const r = Math.max(sc.x, sc.z) / 2;
    let best = { x, z, gap: -Infinity };
    for (let tries = 0; tries < 40 && best.gap < 0.2; tries++) {
      const a = rng() * TAU;
      const d = Math.sqrt(rng()) * spread;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      let gap = Infinity;
      for (const o of placed) gap = Math.min(gap, Math.hypot(o.x - px, o.z - pz) - o.r - r);
      if (gap > best.gap) best = { x: px, z: pz, gap };
    }
    placed.push({ x: best.x, z: best.z, r });
    setOnGround(spec, terrain, best.x, best.z);
    return spec;
  });
}

/**
 * Specs for chunks broken off the iceberg: `totalMass` split over `count` chunks of varied size,
 * centred on `pos` (placed in a small ring so they do not start inside each other). Velocities are
 * the caller's job (they are created awake after warm-up).
 */
export function iceChunkSpecs(
  pos: Vec3,
  totalMass: number,
  count: number,
  rng: () => number,
): BodySpec[] {
  const weights = Array.from({ length: count }, () => 0.6 + 0.8 * rng());
  const wsum = weights.reduce((a, w) => a + w, 0);
  const a0 = rng() * TAU;
  const specs = weights.map((w) => {
    const mass = (totalMass * w) / wsum;
    return iceSpec(mass, { x: pos.x, y: pos.y, z: pos.z }, rng, {
      kind: 'iceBlock',
      part: 'chunk',
      absorbable: false,
      colors: COLORS.chunk,
      placement: -1,
    });
  });
  if (count > 1) {
    let size = 0;
    for (const sp of specs) size = Math.max(size, sp.parts[0].scale.x, sp.parts[0].scale.z);
    // Neighbouring centres 1.1 chunk sizes apart.
    const ring = (0.55 * size) / Math.sin(Math.PI / count);
    specs.forEach((sp, i) => {
      const a = a0 + (i * TAU) / count;
      sp.position.x += Math.cos(a) * ring;
      sp.position.z += Math.sin(a) * ring;
      sp.position.y += (i % 2) * 0.3;
    });
  }
  return specs;
}
