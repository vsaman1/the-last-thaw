import type { ObstacleKind, StructureKind } from '../../types';
import type { StructureDef } from './kit';

/**
 * STRUCTURE REGISTRY — every `<kind>.ts` file in this folder whose default export is a StructureDef
 * is registered automatically (Vite import.meta.glob), so adding a kind = adding ONE file named
 * after it. Then remove the kind from PENDING in ./structures.test.ts; the kit tests pick it up.
 *
 * AUTHORING GUIDE (types in ./kit.ts; examples: car.ts loose, fence.ts / footbridge.ts spanning,
 * house.ts anchored building on shape-kit geometries)
 *
 * StructureDef — plain data plus a build(ctx) function returning BodyDef[]:
 *   kind, label, material ('stone' | 'wood' | 'masonry' | 'metal' | 'ice': buoyancy, damping,
 *   friction), building (shattering counts toward buildingsDestroyed), footprint (conservative
 *   radius in m at scale 1 for placement validation; spanning kinds: half depth across their
 *   length), palettes (named sRGB lists; each name is picked once per instance), span (spanning
 *   kinds: { default: metres | 'floor', min, max }), breakup (defaults for every body), and
 *   defaultYaw(ctx) for placements without a yaw (relative to the course direction).
 *
 * Structure frame: x across the valley (spanning kinds lay out along x over ctx.span), y up, z
 * down-course / the way the structure faces. Build in NOMINAL metres; the kit applies the
 * placement scale (sizes × s, mass × s³, strength × s²) and the yaw.
 *
 * BodyDef — one rigid body:
 *   part      proxy label while intact ('car', 'post', 'deck', ...)
 *   parts     PartDef[] (below); at least one non-decor part
 *   stand     'anchored' immovable until the iceberg's momentum test (1+e)·vn·M >= breakImpulse
 *             'resting'  loose but asleep exactly where built (a deck on posts): falls when what
 *                        holds it breaks — Rapier does it, nothing is jointed
 *             'loose'    free body set down on the ground, tilted onto the slope (vehicles)
 *   mass      total tonnes at scale 1, split over the collider parts by weight (default: volume)
 *   breakSpeed  anchored: closing speed at which a 30 t iceberg breaks it (momentum rule; e.g.
 *             house 15 → breakImpulse 562.5; a 100 t iceberg then breaks it at 4.5 m/s);
 *             loose: speed of a 30 t hit that shatters it (loose-body impulse). Omit = never.
 *   breakMode 'shatter' (default): every piece becomes its own dynamic body; 'uproot': it
 *             topples as one body (posts, pylons)
 *   breakup   { impulseScale, spin, falloff, floor }: share of the hit the pieces get, random
 *             spin, how strongly pieces near the contact are favoured
 *   at / yaw  body origin and extra yaw in the structure frame
 *   ground    'footprint' (anchored default: sits on the lowest ground under its base parts),
 *             'rest' (loose default), 'fixed' (resting default: at.y above the origin's ground;
 *             use ctx.groundAt(x, z) to follow uneven ground)
 *   proxy / trunkRadius / material / building / shake ('tilt' | 'offset') / ccd / settle
 *
 * PartDef — one rendered piece; non-decor parts are colliders built from the very same vertices:
 *   shape   'box' | { type: 'cylinder', segments?, taper? } | { type: 'cone', segments? }
 *           | { type: 'lathe', id, profile: [radius, y][] } (renders the true concave surface,
 *             collides as its hull) | { type: 'prism', id, outline: [u, v][], axis?: 'x' | 'z' }
 *           | { type: 'geom', key } (an existing shape-kit geometry at its own size).
 *           Kit shapes fill the unit cube, so `size` is the size in metres. Lathe/prism ids must
 *           be unique per profile (prefix them with the kind: 'tank-dome').
 *   at, size, rot (Euler XYZ), color (palette name or 0xRRGGBB), name (debris proxy label),
 *   weight (mass share), decor (render only: windows, lamps, railings), piece (parts sharing a
 *   piece name fly off together when the body shatters; decor follows its nearest collider).
 *
 * StructureContext (ctx): rng (seeded per placement), scale, span (nominal metres), d (lateral
 * course offset), palette(name), groundAt(x, z) (ground height relative to the origin's), seaLevel
 * (relative like groundAt: lets oilRig.ts stand in water of any depth).
 * Helpers in ./kit.ts: spanSegments(span, target) and maxGround(ctx, x0, x1, zs).
 *
 * Rules of thumb: realistic sizes and masses (t); a few hundred bodies per level at most, so
 * spanning kinds use segments of several metres and decor for fine detail; colours from real
 * materials (paint, timber, concrete, steel); test with the shared kit suite (every defined kind
 * is built on flat and sloped ground at two scales and its colliders compared with its mesh).
 */

export const STRUCTURE_KINDS: readonly StructureKind[] = [
  'car',
  'truck',
  'bus',
  'fence',
  'guardrail',
  'footbridge',
  'roadBridge',
  'railWagon',
  'boat',
  'dam',
  'church',
  'waterTower',
  'lighthouse',
  'apartmentBlock',
  'monument',
  'coolingTower',
  'smokestack',
  'tank',
  'factoryHall',
  'pylon',
  'windTurbine',
  'pumpjack',
  'oilRig',
  'pipeline',
  'chalet',
  'skiLiftPylon',
  'barn',
  'silo',
  'logPile',
  'trafficLight',
];

/**
 * Kinds laid out along ObstaclePlacement.span (across the valley at yaw 0). Listed here, not only
 * on their definitions, so placement validation knows them before Phase B defines them.
 */
export const SPANNING_KINDS: readonly StructureKind[] = [
  'fence',
  'guardrail',
  'footbridge',
  'roadBridge',
  'dam',
  'pipeline',
];

const KIND_SET = new Set<string>(STRUCTURE_KINDS);
const SPANNING_SET = new Set<string>(SPANNING_KINDS);

const modules = import.meta.glob<{ default?: StructureDef }>(
  ['./*.ts', '!./index.ts', '!./kit.ts', '!./*.test.ts'],
  { eager: true },
);

/** Definition file per kind (path → kind), for the registry tests. */
export const STRUCTURE_SOURCES: ReadonlyMap<string, StructureDef['kind']> = new Map(
  Object.entries(modules).flatMap(([path, mod]) =>
    mod.default ? [[path, mod.default.kind] as const] : [],
  ),
);

const DEFS: readonly StructureDef[] = (() => {
  const out: StructureDef[] = [];
  const seen = new Set<string>();
  for (const [path, mod] of Object.entries(modules)) {
    const def = mod.default;
    if (!def) continue;
    if (def.kind !== 'house' && !KIND_SET.has(def.kind)) {
      throw new Error(`${path}: "${def.kind}" is not a StructureKind`);
    }
    if (seen.has(def.kind)) throw new Error(`${path}: a second definition for "${def.kind}"`);
    if (!!def.span !== SPANNING_SET.has(def.kind)) {
      throw new Error(`${path}: "${def.kind}" span definition disagrees with SPANNING_KINDS`);
    }
    seen.add(def.kind);
    out.push(def);
  }
  return out;
})();

const BY_KIND = new Map<string, StructureDef>(DEFS.map((d) => [d.kind, d]));

/** Every registered definition (the house plus the StructureKinds defined so far). */
export function structureDefs(): readonly StructureDef[] {
  return DEFS;
}

/** The definition for `kind`, or undefined (built-in non-house kinds, or not defined yet). */
export function structureDef(kind: ObstacleKind): StructureDef | undefined {
  return BY_KIND.get(kind);
}

export function isStructureKind(kind: ObstacleKind): kind is StructureKind {
  return KIND_SET.has(kind);
}

/** StructureKinds without a definition file yet (sorted). Spawning one skips it with a warning. */
export function missingStructureKinds(): StructureKind[] {
  return STRUCTURE_KINDS.filter((k) => !BY_KIND.has(k)).sort();
}

export function isSpanningKind(kind: ObstacleKind): boolean {
  return SPANNING_SET.has(kind);
}

/**
 * Conservative placement radius (m) of a defined structure at `scale` (spanning kinds: their half
 * depth; their length is the placement span). Undefined for kinds without a definition.
 */
export function structureFootprint(kind: ObstacleKind, scale = 1): number | undefined {
  const def = BY_KIND.get(kind);
  return def ? def.footprint * scale : undefined;
}

export type { StructureDef } from './kit';
