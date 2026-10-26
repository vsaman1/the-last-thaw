import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession } from '../session';
import { autopilotSteer } from '../autopilot';
import { level1 } from '../levels/level1';
import type { IcebergState, RiverSample, SteeringInput, Terrain } from '../types';
import type { TrailSample } from './trail';
import {
  RIVER_CROSS_VERTS,
  RIVER_GEOMETRY_REACH,
  buildRiverChunk,
  createRiverChunkGeometry,
  riverChunkCount,
  riverChunkRange,
  riverCrossSection,
  type RiverChunkGeometry,
} from './geometry';
import { buildAllChunks, fallRuns, nearFallLip, probeSurface } from './testkit';

/*
 * River geometry checked on real level-1 runs (real terrain, iceberg sim, physics and river).
 * Assertions are properties of the water, not of the route, so they hold whatever line is taken.
 */

const CROSS = RIVER_CROSS_VERTS;
const CLIFF_S = level1.cliffs[0].s;
/** Course s where the late lane switches begin, so the iceberg reaches the lip at an angle. */
const LATE_FROM = CLIFF_S - 120;
const MAX_STEPS = 60 * 240;

type Policy = (ice: IcebergState, terrain: Terrain, step: number) => SteeringInput;

const noInput: Policy = () => ({ steer: 0, source: 'none' });
const lane =
  (l: number): Policy =>
  (ice, t) =>
    autopilotSteer(ice, t, { lane: l });
/** Centre line, then lane `l` for course s in (from, to): a late switch reaches the lip at an angle. */
const lateLane =
  (l: number, from: number, to = Infinity): Policy =>
  (ice, t) => {
    const { s } = t.course.project(ice.pos.x, ice.pos.z);
    return autopilotSteer(ice, t, { lane: s > from && s < to ? l : 0 });
  };
/** Full-lock zig-zag with the given half period (s) from 60 m before the lip to just past it. */
const zigzag =
  (half: number): Policy =>
  (ice, t, step) => {
    const { s } = t.course.project(ice.pos.x, ice.pos.z);
    if (s < CLIFF_S - 60 || s > CLIFF_S + 5) return autopilotSteer(ice, t, { lane: 0 });
    return { steer: Math.floor(step / (60 * half)) % 2 ? 1 : -1, source: 'scripted' };
  };

/** Mirrors the renderer's incremental chunk updates (src/render/River.tsx) without three.js. */
class ChunkMirror {
  readonly chunks: { geo: RiverChunkGeometry; built: number }[] = [];
  private structure = -1;

  update(samples: readonly TrailSample[], version: number, structure: number, terrain: Terrain): void {
    const n = samples.length;
    const full = structure !== this.structure;
    this.structure = structure;
    for (let k = 0; k < riverChunkCount(n); k++) {
      const r = riverChunkRange(k, n);
      let entry = this.chunks[k];
      if (!entry || full) {
        entry ??= { geo: createRiverChunkGeometry(), built: -1 };
        this.chunks[k] = entry;
        buildRiverChunk(samples, r.start, r.end, terrain, entry.geo);
        entry.built = version;
        continue;
      }
      const lo = Math.max(0, r.start - RIVER_GEOMETRY_REACH);
      const hi = Math.min(n - 1, r.end + RIVER_GEOMETRY_REACH);
      let first = -1;
      for (let i = lo; i <= hi && first < 0; i++) if (samples[i].rev > entry.built) first = i;
      if (first < 0 && entry.geo.end === r.end) continue;
      const from = first < 0 ? r.start : Math.max(r.start, first - RIVER_GEOMETRY_REACH);
      buildRiverChunk(samples, r.start, r.end, terrain, entry.geo, undefined, from);
      entry.built = version;
    }
  }
}

async function play(policy: Policy, untilS = Infinity, mirror?: ChunkMirror): Promise<GameSession> {
  const session = await GameSession.create({ level: level1, skipIntro: true });
  const { river, terrain, iceberg } = session;
  for (let step = 0; session.phase === 'playing' && step < MAX_STEPS; step++) {
    session.update(FIXED_DT, policy(iceberg, terrain, step));
    mirror?.update(river.samples, river.version, river.structureVersion, terrain);
    if (terrain.course.project(iceberg.pos.x, iceberg.pos.z).s > untilS) break;
  }
  return session;
}

const courseS = (t: Terrain, p: RiverSample): number => t.course.project(p.x, p.z).s;
const seg3 = (a: RiverSample, b: RiverSample): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

describe('level 1 river geometry (real GameSession runs)', () => {
  it.each<[string, Policy]>([
    ['no input', noInput],
    ['autopilot lane +22', lane(22)],
    ['autopilot lane -20', lane(-20)],
  ])('%s: water hugs the valley walls and only the real cliff pours a waterfall', async (_name, policy) => {
    const mirror = new ChunkMirror();
    const session = await play(policy, Infinity, mirror);
    const { terrain } = session;
    const s = session.river.samples;
    const chunks = buildAllChunks(s, terrain);

    // Review findings: a 2–3 m floating slab on the walls, and fake waterfall sheets (buried up to
    // 2.3 m in the rock) from short hops down a wall. Overhang shelves at a real lip are allowed.
    const rep = probeSurface(chunks, terrain, nearFallLip(s, 4));
    const at = (i: number): string => (i >= 0 ? `course s ${courseS(terrain, s[i]).toFixed(0)}` : '-');
    expect(rep.floatOver1, `max float ${rep.maxFloat.toFixed(2)} m at ${at(rep.maxFloatAt)}`).toBe(0);
    expect(rep.maxFloat).toBeLessThan(1);
    expect(rep.fallInRock, `deepest fall vertex ${rep.maxFallDepth.toFixed(2)} m`).toBe(0);
    expect(rep.maxBury, `at ${at(rep.maxBuryAt)}`).toBeLessThan(0.3);
    for (const run of fallRuns(s)) {
      const lipS = courseS(terrain, s[run.lip]);
      const msg = `fall run with its lip at course s ${lipS.toFixed(0)}`;
      expect(Math.abs(lipS - CLIFF_S), msg).toBeLessThan(12);
    }

    // The renderer's incremental rebuilds give exactly the full build, and chunk seams match.
    expect(mirror.chunks).toHaveLength(chunks.length);
    const keys = [
      'position',
      'normal',
      'uv',
      'lateral',
      'flowSpeed',
      'turbulence',
      'fall',
      'ocean',
      'birth',
    ] as const;
    for (let k = 0; k < chunks.length; k++) {
      const full = chunks[k];
      const inc = mirror.chunks[k].geo;
      expect(inc.vertexCount).toBe(full.vertexCount);
      for (const key of keys) {
        const per = full[key].length / full.maxCrossSections / CROSS;
        const n = full.vertexCount * per;
        expect(Array.from(inc[key].subarray(0, n)), `${key} of chunk ${k}`).toEqual(
          Array.from(full[key].subarray(0, n)),
        );
      }
      if (k + 1 < chunks.length) {
        const next = chunks[k + 1];
        const last = (full.crossSections - 1) * CROSS * 3;
        expect(Array.from(full.position.subarray(last, last + CROSS * 3))).toEqual(
          Array.from(next.position.subarray(0, CROSS * 3)),
        );
        expect(Array.from(full.normal.subarray(last, last + CROSS * 3))).toEqual(
          Array.from(next.normal.subarray(0, CROSS * 3)),
        );
      }
    }
    session.dispose();
  });

  it.each<[string, Policy]>([
    ['lane -24', lateLane(-24, LATE_FROM)],
    ['lane -12', lateLane(-12, LATE_FROM)],
    ['the centre line', lane(0)],
    ['lane +12', lateLane(12, LATE_FROM)],
    ['lane +22', lateLane(22, LATE_FROM)],
    ['a swerve to lane +18', lateLane(18, CLIFF_S - 30, CLIFF_S + 20)],
    ['a swerve to lane -18', lateLane(-18, CLIFF_S - 30, CLIFF_S + 20)],
    ['a 0.5 s zig-zag', zigzag(0.5)],
  ])('crossing the cliff via %s gives one connected waterfall with nothing buried', async (_n, policy) => {
    const session = await play(policy, CLIFF_S + 60);
    const { terrain } = session;
    const s = session.river.samples;
    const endS = courseS(terrain, s[s.length - 1]);
    expect(endS, 'the run did not get past the cliff').toBeGreaterThan(CLIFF_S + 20);

    const runs = fallRuns(s);
    expect(runs).toHaveLength(1);
    const { lip, first, last, base } = runs[0];
    expect(Math.abs(courseS(terrain, s[lip]) - CLIFF_S)).toBeLessThan(12);
    expect(s[lip].kind).toBe('flow');
    expect(s[base].kind).toBe('flow');
    expect(s[lip].y - s[base].y).toBeGreaterThan(14);
    expect(last - first + 1).toBeGreaterThanOrEqual(10);
    for (let i = Math.max(1, lip - 10); i <= Math.min(s.length - 1, base + 10); i++) {
      expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
      if (i > lip && i <= base) expect(s[i].y).toBeLessThanOrEqual(s[i - 1].y + 1e-9);
    }

    const rep = probeSurface(buildAllChunks(s, terrain), terrain);
    expect(rep.fallInRock, `deepest fall vertex ${rep.maxFallDepth.toFixed(2)} m`).toBe(0);
    // Nothing near the lip cuts into the cliff edge, and no bank is draped down the cliff face.
    const lipZone = probeSurface([buildRiverChunk(s, lip - 6, base, terrain)], terrain);
    expect(lipZone.maxBury).toBeLessThan(0.1);
    for (let i = lip - 6; i <= lip; i++) {
      const cs = riverCrossSection(s, i, terrain);
      for (let k = 0; k < CROSS; k++) expect(s[i].y - cs[k * 3 + 1]).toBeLessThan(1.6);
    }
    session.dispose();
  });
});
