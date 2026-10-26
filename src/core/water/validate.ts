import type { ObstaclePlacement, Terrain, TerrainFeature } from '../types';
import { featureContains } from '../terrain/features';
import { profileAt, streamDepth, streamFlow } from '../terrain/stream';
import { isGeneratedTerrain } from '../terrain/terrain';
import { damAxis, MIN_DAM_SIN, spansChannel, streamCrossings, type DamCrossing } from './dams';

/**
 * Design checks for streams and dams (wired into validateLevel by src/core/terrain/validate.ts, and
 * callable on their own from level tests).
 *
 * A DAM must hold back a stream: its axis has to cross a 'stream' feature's channel from bank to
 * bank (each side of the crossing at least the channel's half top width / sin(angle) of span, the
 * crossing at least 30° off the stream's direction). A dam anywhere else is reported.
 */

type Stream = Extract<TerrainFeature, { type: 'stream' }>;

/** Thresholds of the stream and dam checks. */
export const STREAM_RULES = {
  /** Channels at least this wide (m) and this many grid cells. */
  minWidth: 4,
  minCells: 2,
  /** Banks at least this high (m); water at most this share of the bank deep. */
  minBank: 1,
  maxDepthShare: 0.8,
  /** Fastest authored flow (m/s). */
  maxFlow: 12,
  /** A 'sea' end must be within this height (m) of the sea, or past coastS − this distance (m). */
  seaReach: 1,
  coastReach: 10,
  /** A dam that misses every stream is still matched to one passing within this distance (m). */
  damSearch: 20,
} as const;

const R = STREAM_RULES;

export interface DamIssue {
  /** Index into level.obstacles. */
  index: number;
  s: number;
  d: number;
  problem: string;
}

/** Problems with one dam placement (empty when it spans a stream's channel bank to bank). */
export function damProblems(terrain: Terrain, p: ObstaclePlacement): string[] {
  if (p.kind !== 'dam') return [];
  const features = terrain.level.features ?? [];
  const axis = damAxis(terrain, p);
  let near: DamCrossing | null = null;
  for (let index = 0; index < features.length; index++) {
    const f = features[index];
    if (f.type !== 'stream') continue;
    for (const c of streamCrossings(axis, f, index, R.damSearch)) {
      const onAxis = c.t >= -axis.half && c.t <= axis.half;
      if (onAxis && c.sin >= MIN_DAM_SIN && spansChannel(c)) return [];
      // Prefer reporting a crossing on the axis, then the nearest beyond its ends.
      if (!near || Math.abs(c.t) < Math.abs(near.t)) near = c;
    }
  }
  if (!near) {
    return ['holds back no stream: a dam must span a stream channel bank to bank (add a stream under it)'];
  }
  const fix = (v: number): string => v.toFixed(1);
  const which = `stream (feature ${near.feature})`;
  if (near.t < -axis.half || near.t > axis.half) {
    const miss = Math.abs(near.t) - axis.half;
    return [`stops short of ${which}: its axis misses the channel by ${fix(miss)} m`];
  }
  if (near.sin < MIN_DAM_SIN) {
    const deg = (Math.asin(Math.min(1, near.sin)) * 180) / Math.PI;
    return [`runs along ${which} (${deg.toFixed(0)}° to it): a dam must cross the channel (≥ 30°)`];
  }
  return [
    `does not span ${which} bank to bank: needs ${fix(near.need)} m of span each side of the ` +
      `crossing, has ${fix(Math.max(0, near.left))} / ${fix(Math.max(0, near.right))} m`,
  ];
}

/** Every dam placement that does not hold back a stream (see damProblems). */
export function validateDams(terrain: Terrain): DamIssue[] {
  const out: DamIssue[] = [];
  terrain.level.obstacles.forEach((p, index) => {
    for (const problem of damProblems(terrain, p)) out.push({ index, s: p.s, d: p.d, problem });
  });
  return out;
}

/** Problems with one stream feature (index `index` in level.features). */
export function streamProblems(terrain: Terrain, f: Stream, index: number): string[] {
  const level = terrain.level;
  const out: string[] = [];
  const fix = (v: number): string => v.toFixed(1);
  const minW = Math.max(R.minWidth, R.minCells * level.cellSize);
  if (f.points.length < 2) out.push('needs at least two points (source and mouth)');
  if (!(f.width >= minW)) out.push(`too narrow (${f.width} m < ${fix(minW)} m)`);
  if (!(f.bank >= R.minBank)) out.push(`banks too low (${f.bank} m < ${R.minBank} m)`);
  const depth = streamDepth(f);
  if (!(depth <= R.maxDepthShare * f.bank)) {
    out.push(`too deep for its banks (${fix(depth)} m > ${R.maxDepthShare} × ${f.bank} m)`);
  }
  const flow = streamFlow(f);
  if (!(flow > 0 && flow <= R.maxFlow)) out.push(`flow ${flow} m/s outside 0..${R.maxFlow}`);
  if (f.points.length < 2 || f.end === 'pool') return out;
  // A 'sea' end runs out into the sea or into another stream.
  const last = f.points[f.points.length - 1];
  const w = terrain.course.toWorld(last.s, last.d);
  const gen = isGeneratedTerrain(terrain) ? terrain : null;
  const prof = gen?.streamProfiles.find((p) => p.index === index);
  const bed = prof ? profileAt(prof, prof.length) - f.bank : w.y;
  const atSea =
    terrain.isOcean(w.x, w.z) ||
    Math.min(w.y, bed) <= level.seaLevel + R.seaReach ||
    last.s >= level.coastS - R.coastReach;
  const joins = (level.features ?? []).some((g, k) => {
    if (k === index || g.type !== 'stream') return false;
    const hw = terrain.course.sampleAt(last.s).halfWidth;
    return featureContains(g, last.s, last.d, hw);
  });
  if (!atSea && !joins) {
    const above = fix(w.y - level.seaLevel);
    out.push(
      `does not reach the sea or another stream (ends at s=${fix(last.s)}, ${above} m above the ` +
        `sea): a confined iceberg would be stranded; run it into the sea, join it to another stream, ` +
        `or make it end: 'pool' (a designed trap)`,
    );
  }
  return out;
}
