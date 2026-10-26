import type { IcebergState, Terrain } from '../types';
import { clamp01, lerp } from '../math';
import type { IntroTimeline } from '../intro';
import { calvingKeys, slideProgress } from '../glacier/calving';
import { type GlacierPlacement, glacierWorld } from '../glacier/glacier';
import type { RiverTrail } from './trail';

/**
 * The river's first stretch: meltwater running out of the glacier socket the iceberg calves from,
 * down the ledge and along the slide to the spawn point, so the river starts inside the notch and
 * runs on into the river the iceberg lays in play. The session lays it before play (nothing is
 * charged to the water budget, which is the iceberg's melting) and it is revealed behind the
 * calving iceberg: each sample is born when the drawn iceberg passes over it (src/core/glacier/
 * calving.ts), and the water shader hides samples not born yet. Deterministic from the placement.
 */

export const MELTWATER = {
  /** The first sample sits this far in front of the socket's back wall (m). */
  backInset: 0.4,
  /** Largest step between samples (m). */
  step: 0.6,
  /** Water above the socket's sloping ice floor (m). */
  floorClearance: 0.12,
  /**
   * Water above the ground from the socket to the snout, easing to the river's own landOffset by
   * the spawn: well clear of the snow field (lifted 6 cm, pulled forward in depth) (m).
   */
  snoutLift: 0.25,
} as const;

/** The stretch as points: world x/z, water level y, and metres upstream of the spawn (`along`). */
export interface MeltwaterPath {
  readonly x: number[];
  readonly y: number[];
  readonly z: number[];
  readonly along: number[];
}

export function createMeltwaterPath(): MeltwaterPath {
  return { x: [], y: [], z: [], along: [] };
}

const at = { x: 0, y: 0, z: 0 };

/**
 * The stretch from just inside the socket (MELTWATER.backInset in front of its back wall, on the
 * glacier frame's centreline) straight down the frame to the spawn point (spawnX, spawnZ), with
 * the water above the socket's ice floor (as the glacier mesh slopes it: ledge height at the back
 * wall, 0.25 m under the ground at the snout) and above the ground.
 */
export function meltwaterPath(
  g: GlacierPlacement,
  spawnX: number,
  spawnZ: number,
  landOffset: number,
  out: MeltwaterPath = createMeltwaterPath(),
): MeltwaterPath {
  const M = MELTWATER;
  const t = g.terrain;
  out.x.length = 0;
  out.y.length = 0;
  out.z.length = 0;
  out.along.length = 0;
  const s0 = g.socketBackS + M.backInset;
  const s1 = g.startS;
  if (!(s1 > s0)) return out;
  // the socket's ice floor along the centreline
  const floorEnd = g.faceS + 0.05;
  glacierWorld(g, g.socketBackS, 0, at);
  const floorBack = t.heightAt(at.x, at.z) + g.ledge;
  glacierWorld(g, floorEnd, 0, at);
  const floorFront = t.heightAt(at.x, at.z) - 0.25;
  const n = Math.max(1, Math.ceil((s1 - s0) / M.step));
  for (let i = 0; i <= n; i++) {
    const s = lerp(s0, s1, i / n);
    glacierWorld(g, s, 0, at);
    if (i === n) {
      at.x = spawnX;
      at.z = spawnZ;
    }
    const ground = t.heightAt(at.x, at.z);
    const lift = lerp(M.snoutLift, landOffset, clamp01((s - g.faceS) / (s1 - g.faceS)));
    let y = ground + lift;
    if (s < floorEnd) {
      const floor = lerp(floorBack, floorFront, clamp01((s - g.socketBackS) / (floorEnd - g.socketBackS)));
      y = Math.max(y, floor + M.floorClearance);
    }
    out.x.push(at.x);
    out.y.push(y);
    out.z.push(at.z);
    out.along.push(s1 - s);
  }
  return out;
}

/**
 * Birth times (session seconds) of the stretch's samples for an intro timeline whose calving
 * starts `flyoverFrom` seconds after `time0`: water behind the embedded iceberg appears as it breaks
 * free, the rest as its centre slides over it (the river's head always sits under the iceberg),
 * the spawn point at the hand-off. With no calving everything is born at time0.
 */
export function meltwaterBirths(
  g: GlacierPlacement,
  along: readonly number[],
  tl: IntroTimeline,
  time0: number,
  out: number[] = [],
): number[] {
  out.length = 0;
  if (!(tl.calving > 0)) {
    for (let i = 0; i < along.length; i++) out.push(time0);
    return out;
  }
  const k = calvingKeys(tl.calving);
  const D = g.slide;
  const window = k.duration - k.breakAt;
  const m = window > 0 && D > 0 ? (g.endSpeed * window) / D : 0;
  for (let i = 0; i < along.length; i++) {
    const a = along[i];
    let tc = k.breakAt;
    if (a < D && window > 0) {
      // slideProgress(u, m) is monotonic: find the u where the centre's along = D·(1 − p) reaches a
      const want = 1 - a / D;
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 40; it++) {
        const mid = 0.5 * (lo + hi);
        if (slideProgress(mid, m) < want) lo = mid;
        else hi = mid;
      }
      tc = k.breakAt + hi * window;
    }
    out.push(time0 + tl.flyover + tc);
  }
  return out;
}

const path = createMeltwaterPath();
const births: number[] = [];

/**
 * Lay the meltwater stretch on an empty trail for this intro, the intro starting at session time
 * `time0` (the iceberg is at its spawn).
 */
export function seedMeltwater(
  trail: RiverTrail,
  terrain: Terrain,
  iceberg: IcebergState,
  g: GlacierPlacement,
  tl: IntroTimeline,
  time0: number,
): void {
  meltwaterPath(g, iceberg.pos.x, iceberg.pos.z, trail.options.landOffset, path);
  if (path.x.length < 2) return;
  meltwaterBirths(g, path.along, tl, time0, births);
  trail.seed(iceberg, terrain, path.x, path.y, path.z, births);
}

/** Re-time the stretch for an intro (re)starting at session time `time0` (a skipped flyover). */
export function retimeMeltwater(
  trail: RiverTrail,
  iceberg: IcebergState,
  g: GlacierPlacement,
  tl: IntroTimeline,
  time0: number,
): void {
  if (trail.seeded === 0) return;
  meltwaterPath(g, iceberg.pos.x, iceberg.pos.z, trail.options.landOffset, path);
  meltwaterBirths(g, path.along, tl, time0, births);
  trail.retimeSeed(births);
}

/** Everything of the stretch not born yet is born at `time` (the intro was skipped to play). */
export function meltwaterBornBy(trail: RiverTrail, time: number): void {
  const n = trail.seeded;
  if (n === 0) return;
  births.length = 0;
  for (let i = 0; i < n; i++) births.push(Math.min(trail.samples[i].t, time));
  trail.retimeSeed(births);
}
