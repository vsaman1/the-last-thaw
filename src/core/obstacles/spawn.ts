import { lerp, rightOf, TAU } from '../math';
import { createRng } from '../rng';
import type { BuiltinObstacleKind, ObstacleKind, ObstaclePlacement, Terrain } from '../types';
import {
  BROADLEAF,
  COLORS,
  KIND_INFO,
  momentumBreakImpulse,
  PINE,
  ROCK_CLUSTER,
  ROCK_SIZES,
  STONE_BARRIER,
} from './catalog';
import { iceBlockSpec, iceFieldSpecs } from './ice';
import { BLOB_VARIANTS, PEBBLE_VARIANTS, ROCK_VARIANTS, STONE_VARIANTS } from './shapes';
import {
  centreOfMassY,
  IDENTITY,
  pick,
  restingY,
  yawQuat,
  type BodyPart,
  type BodySpec,
  type SpawnOptions,
} from './specs';
import { structureDef } from './structures/index';
import { buildStructureSpecs } from './structures/kit';

/**
 * Spawner: turns level placements (course coordinates) into explicit, plain-data body specs.
 * Pure and deterministic — no Rapier here — so specs can be inspected and tested headless.
 * Rocks, stones, trees and glacier ice are built here; the house and every StructureKind come from
 * the data-driven structure kit (./structures).
 */

export {
  centreOfMassY,
  rotateVec,
  yawQuat,
  type BodyPart,
  type BodySpec,
  type BreakMode,
  type Quat,
  type SpawnOptions,
} from './specs';

type CatalogKind = Exclude<BuiltinObstacleKind, 'house' | 'iceBlock' | 'iceField'>;

function baseSpec(
  kind: CatalogKind,
  placement: number,
): Omit<BodySpec, 'position' | 'rotation' | 'mass' | 'parts'> {
  const info = KIND_INFO[kind];
  return {
    kind,
    part: info.part,
    material: info.material,
    proxyMode: info.proxyMode,
    anchored: info.anchored,
    breakImpulse: Infinity,
    breakMode: 'none',
    hitHeight: 0,
    trunkRadius: 0,
    ccd: false,
    settle: false,
    placement,
  };
}

type RockSize = 'rockSmall' | 'rockMedium' | 'boulder';

/** A single loose rock of the given size class, resting on the ground at (x, z). */
export function rockSpec(
  size: RockSize,
  kind: CatalogKind,
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: { yaw?: number; scale?: number; placement?: number } = {},
): BodySpec {
  const sz = ROCK_SIZES[size];
  const r = lerp(sz.radiusMin, sz.radiusMax, rng()) * (opts.scale ?? 1);
  const squash = lerp(sz.squashMin, sz.squashMax, rng());
  const scale = { x: r * lerp(0.92, 1.08, rng()), y: r * squash, z: r * lerp(0.92, 1.08, rng()) };
  const mass = sz.nominalMass * (r / sz.nominalRadius) ** 3;
  const palette = size === 'boulder' ? COLORS.boulder : COLORS.rock;
  const geom =
    size === 'rockSmall'
      ? `pebble${Math.floor(rng() * PEBBLE_VARIANTS)}`
      : `rock${Math.floor(rng() * ROCK_VARIANTS)}`;
  const part: BodyPart = {
    geom,
    name: 'rock',
    offset: { x: 0, y: 0, z: 0 },
    rotation: IDENTITY,
    scale,
    color: pick(rng, palette),
    mass,
  };
  const rotation = yawQuat(opts.yaw ?? rng() * TAU);
  const parts = [part];
  return {
    ...baseSpec(kind, opts.placement ?? -1),
    part: size === 'rockSmall' ? 'rock' : size === 'rockMedium' ? 'rockMedium' : 'boulder',
    position: { x, y: restingY(terrain, x, z, rotation, parts) - 0.02, z },
    rotation,
    mass,
    ccd: size === 'rockSmall',
    parts,
  };
}

export function clusterSpecs(
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: { count?: number; spread?: number; scale?: number; placement?: number } = {},
): BodySpec[] {
  const { countMin, countMax } = ROCK_CLUSTER;
  const count = opts.count ?? countMin + Math.floor(rng() * (countMax - countMin + 1));
  const spread = opts.spread ?? ROCK_CLUSTER.defaultSpread;
  const out: BodySpec[] = [];
  const placed: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const size: RockSize = rng() < ROCK_CLUSTER.mediumShare ? 'rockMedium' : 'rockSmall';
    const spec = rockSpec(size, 'rockCluster', x, z, terrain, rng, {
      scale: opts.scale,
      placement: opts.placement,
    });
    const r = Math.max(spec.parts[0].scale.x, spec.parts[0].scale.z);
    let px = x;
    let pz = z;
    for (let tries = 0; tries < 24; tries++) {
      const a = rng() * TAU;
      const d = Math.sqrt(rng()) * spread;
      px = x + Math.cos(a) * d;
      pz = z + Math.sin(a) * d;
      if (placed.every((o) => Math.hypot(o.x - px, o.z - pz) > o.r + r + 0.15)) break;
    }
    placed.push({ x: px, z: pz, r });
    spec.position.x = px;
    spec.position.z = pz;
    spec.position.y = restingY(terrain, px, pz, spec.rotation, spec.parts) - 0.02;
    out.push(spec);
  }
  return out;
}

/** Stones laid across the course: a bottom row of 2-3 and 1-2 stones on top in the grooves. */
export function barrierSpecs(
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: { count?: number; scale?: number; dirX?: number; dirZ?: number; placement?: number } = {},
): BodySpec[] {
  const B = STONE_BARRIER;
  const count = Math.min(B.countMax, Math.max(B.countMin, opts.count ?? (rng() < 0.5 ? 3 : 4)));
  const bottomN = count >= 4 ? 3 : 2;
  const topN = count - bottomN;
  const s = opts.scale ?? 1;
  const dirLen = Math.hypot(opts.dirX ?? 0, opts.dirZ ?? 1) || 1;
  const right = rightOf((opts.dirX ?? 0) / dirLen, (opts.dirZ ?? 1) / dirLen);
  const wallYaw = Math.atan2(-right.z, right.x);
  const stone = (): { hl: number; hh: number; hd: number; mass: number } => {
    const hl = lerp(B.halfLength[0], B.halfLength[1], rng()) * s;
    const hh = lerp(B.halfHeight[0], B.halfHeight[1], rng()) * s;
    const hd = lerp(B.halfDepth[0], B.halfDepth[1], rng()) * s;
    return { hl, hh, hd, mass: lerp(B.massMin, B.massMax, rng()) * s ** 3 };
  };
  const make = (along: number, dims: ReturnType<typeof stone>, y: number | null): BodySpec => {
    const px = x + right.x * along;
    const pz = z + right.z * along;
    const rotation = yawQuat(wallYaw + (rng() - 0.5) * 0.12);
    const parts: BodyPart[] = [
      {
        geom: `stone${Math.floor(rng() * STONE_VARIANTS)}`,
        name: 'stone',
        offset: { x: 0, y: 0, z: 0 },
        rotation: IDENTITY,
        scale: { x: dims.hl, y: dims.hh, z: dims.hd },
        color: pick(rng, COLORS.barrierStone),
        mass: dims.mass,
      },
    ];
    return {
      ...baseSpec('stoneBarrier', opts.placement ?? -1),
      position: { x: px, y: y ?? restingY(terrain, px, pz, rotation, parts) - 0.02, z: pz },
      rotation,
      mass: dims.mass,
      settle: true,
      parts,
    };
  };
  const bottoms = Array.from({ length: bottomN }, stone);
  const spacing = (2 * bottoms.reduce((a, b) => a + b.hl, 0)) / bottomN;
  const out: BodySpec[] = [];
  const alongs: number[] = [];
  let topOfRow = -Infinity;
  bottoms.forEach((dims, i) => {
    const along = (i - (bottomN - 1) / 2) * spacing;
    alongs.push(along);
    const spec = make(along, dims, null);
    topOfRow = Math.max(topOfRow, spec.position.y + dims.hh * 0.88);
    out.push(spec);
  });
  const grooves = alongs.slice(0, -1).map((a, i) => (a + alongs[i + 1]) / 2);
  const firstGroove = topN < grooves.length ? Math.floor(rng() * grooves.length) : 0;
  for (let i = 0; i < topN; i++) {
    const dims = stone();
    const along = grooves[(firstGroove + i) % grooves.length];
    out.push(make(along, dims, topOfRow + dims.hh * 0.8 + 0.04));
  }
  return out;
}

function trunkPart(h: number, r: number, mass: number, rng: () => number): BodyPart {
  return {
    geom: 'trunk',
    name: 'trunk',
    offset: { x: 0, y: -0.15, z: 0 },
    rotation: yawQuat(rng() * TAU),
    scale: { x: r, y: h + 0.15, z: r },
    color: pick(rng, COLORS.trunk),
    mass,
  };
}

function treeSpec(
  kind: 'pine' | 'broadleaf',
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: { yaw?: number; scale?: number; placement?: number },
): BodySpec {
  const T = kind === 'pine' ? PINE : BROADLEAF;
  const h = lerp(T.heightMin, T.heightMax, rng()) * (opts.scale ?? 1);
  const hf = h / T.nominalHeight;
  const mass = T.nominalMass * hf * hf;
  const parts: BodyPart[] = [];
  let trunkR: number;
  if (kind === 'pine') {
    trunkR = 0.042 * h;
    const tiers = rng() < 0.4 ? 2 : 3;
    const layout =
      tiers === 3
        ? { base: [0.27, 0.47, 0.65], height: [0.4, 0.34, 0.35], radius: [0.24, 0.18, 0.12] }
        : { base: [0.3, 0.56], height: [0.46, 0.44], radius: [0.25, 0.16] };
    const vols = layout.radius.map((r, i) => r * r * layout.height[i]);
    const volSum = vols.reduce((a, b) => a + b, 0);
    parts.push(trunkPart(0.5 * h, trunkR, mass * 0.3, rng));
    const coneColor = pick(rng, COLORS.pineCone);
    for (let i = 0; i < tiers; i++) {
      const r = layout.radius[i] * h;
      parts.push({
        geom: 'cone',
        name: 'cone',
        offset: { x: 0, y: layout.base[i] * h, z: 0 },
        rotation: yawQuat(rng() * TAU),
        scale: { x: r, y: layout.height[i] * h, z: r },
        color: i === tiers - 1 ? pick(rng, COLORS.pineAccent) : coneColor,
        mass: (mass * 0.7 * vols[i]) / volSum,
      });
    }
  } else {
    trunkR = 0.05 * h;
    parts.push(trunkPart(0.58 * h, trunkR, mass * 0.35, rng));
    const blobs: { y: number; r: number; ox: number; oz: number }[] = [{ y: 0.66, r: 0.27, ox: 0, oz: 0 }];
    const extra = rng() < 0.5 ? 1 : 2;
    const a0 = rng() * TAU;
    for (let i = 0; i < extra; i++) {
      const a = a0 + (i * TAU) / extra;
      blobs.push({ y: 0.6 + rng() * 0.08, r: 0.18, ox: Math.cos(a) * 0.17, oz: Math.sin(a) * 0.17 });
    }
    blobs.push({ y: 0.84, r: 0.17, ox: (rng() - 0.5) * 0.06, oz: (rng() - 0.5) * 0.06 });
    const vols = blobs.map((b) => b.r ** 3);
    const volSum = vols.reduce((a, b) => a + b, 0);
    blobs.forEach((b, i) => {
      const r = b.r * h;
      parts.push({
        geom: `blob${Math.floor(rng() * BLOB_VARIANTS)}`,
        name: 'canopy',
        offset: { x: b.ox * h, y: b.y * h, z: b.oz * h },
        rotation: yawQuat(rng() * TAU),
        scale: { x: r, y: r * 0.85, z: r },
        color: pick(rng, COLORS.canopy),
        mass: (mass * 0.65 * vols[i]) / volSum,
      });
    });
  }
  const yaw = opts.yaw ?? rng() * TAU;
  return {
    ...baseSpec(kind, opts.placement ?? -1),
    position: { x, y: terrain.heightAt(x, z) - 0.04, z },
    rotation: yawQuat(yaw),
    mass,
    // Momentum rule: strength follows the placement scale, not the random height.
    breakImpulse: momentumBreakImpulse(T.breakSpeed, opts.scale ?? 1),
    breakMode: 'uproot',
    hitHeight: centreOfMassY(parts) + T.hitAboveCom * h,
    trunkRadius: trunkR,
    ccd: true,
    parts,
    shakeStyle: 'tilt',
  };
}

type SpawnOpts = SpawnOptions & { placement?: number };

function specsFor(
  kind: ObstacleKind,
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: SpawnOpts,
  warned: Set<ObstacleKind> | null,
): BodySpec[] {
  switch (kind) {
    case 'rockSmall':
    case 'rockMedium':
    case 'boulder':
      return [rockSpec(kind, kind, x, z, terrain, rng, opts)];
    case 'rockCluster':
      return clusterSpecs(x, z, terrain, rng, opts);
    case 'stoneBarrier':
      return barrierSpecs(x, z, terrain, rng, opts);
    case 'pine':
    case 'broadleaf':
      return [treeSpec(kind, x, z, terrain, rng, opts)];
    case 'iceBlock':
      return [iceBlockSpec(x, z, terrain, rng, opts)];
    case 'iceField':
      return iceFieldSpecs(x, z, terrain, rng, opts);
  }
  const def = structureDef(kind);
  if (def) return buildStructureSpecs(def, x, z, terrain, rng, opts);
  if (!warned?.has(kind)) {
    warned?.add(kind);
    console.warn(`[obstacles] "${kind}" has no structure definition yet; placements of it are skipped`);
  }
  return [];
}

/**
 * Specs for one obstacle of `kind` at world (x, z). Clusters, barriers, ice fields and multi-body
 * structures yield several bodies; a structure kind without a definition yields none (with a
 * console warning) instead of crashing the game.
 */
export function specsForKind(
  kind: ObstacleKind,
  x: number,
  z: number,
  terrain: Terrain,
  rng: () => number,
  opts: SpawnOpts = {},
): BodySpec[] {
  return specsFor(kind, x, z, terrain, rng, opts, null);
}

/** Per-placement RNG so editing one placement never reshuffles the others. */
export const placementRng = (seed: number, index: number): (() => number) =>
  createRng((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);

function placementSpecs(
  p: ObstaclePlacement,
  index: number,
  terrain: Terrain,
  seed: number,
  warned: Set<ObstacleKind> | null,
): BodySpec[] {
  const w = terrain.course.toWorld(p.s, p.d);
  const cs = terrain.course.sampleAt(p.s);
  return specsFor(
    p.kind,
    w.x,
    w.z,
    terrain,
    placementRng(seed, index),
    {
      yaw: p.yaw,
      scale: p.scale,
      count: p.count,
      spread: p.spread,
      span: p.span,
      dirX: cs.dirX,
      dirZ: cs.dirZ,
      d: p.d,
      halfWidth: cs.halfWidth,
      placement: index,
      ...(p.variant ? { variant: p.variant } : {}),
    },
    warned,
  );
}

export function specsForPlacement(
  p: ObstaclePlacement,
  index: number,
  terrain: Terrain,
  seed: number,
): BodySpec[] {
  return placementSpecs(p, index, terrain, seed, null);
}

/**
 * Every body for the level's obstacle placements, in placement order. Kinds without a structure
 * definition are skipped with one console warning per kind.
 */
export function buildObstacleSpecs(terrain: Terrain, seed: number): BodySpec[] {
  const out: BodySpec[] = [];
  const warned = new Set<ObstacleKind>();
  terrain.level.obstacles.forEach((p, i) => {
    for (const s of placementSpecs(p, i, terrain, seed, warned)) out.push(s);
  });
  return out;
}
