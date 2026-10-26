import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameSession } from '../session';
import { level1 } from '../levels/level1';
import { powerValley } from '../levels/powerValley';
import type { LevelDef } from '../types';
import { calvingKeys } from '../glacier/calving';
import { getGlacier, glacierWorld } from '../glacier/glacier';
import { INTRO_TIMING } from '../intro';
import { dirToHeading, smoothstep } from '../math';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import { RIVER_CROSS_VERTS, buildRiverChunk } from './geometry';
import { MELTWATER } from './meltwater';
import { RiverTrail } from './trail';
import { drive, makeIceberg, type PathFn } from './testkit';

/*
 * The river starts in the glacier socket the iceberg calves from: the session lays the meltwater
 * down the slide to the spawn before play, revealed behind the calving iceberg.
 */

const CROSS = RIVER_CROSS_VERTS;
const LEVELS: [string, LevelDef][] = [
  ['level 1', level1],
  ['level 6', powerValley],
];

describe.each(LEVELS)('meltwater from the glacier (%s)', (_name, level) => {
  it('starts inside the socket and runs continuously to the spawn and on into the river', async () => {
    const session = await GameSession.create({ level, skipIntro: true });
    const { river, terrain, iceberg } = session;
    const g = getGlacier(terrain);
    const s = river.samples;
    const n = river.seeded;
    expect(n).toBeGreaterThanOrEqual(6);
    // first sample just in front of the socket's back wall, on the frame's centreline
    const back = glacierWorld(g, g.socketBackS, 0, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(s[0].x - back.x, s[0].z - back.z)).toBeLessThan(0.5);
    // inside the notch: behind the face line
    const along = (i: number): number => (s[i].x - g.spawn.x) * g.fx + (s[i].z - g.spawn.z) * g.fz;
    expect(g.startS + along(0)).toBeLessThan(g.faceS);
    // the last seeded sample is the spawn point, at the river's own level there
    const spawn = iceberg.pos;
    expect(Math.hypot(s[n - 1].x - spawn.x, s[n - 1].z - spawn.z)).toBeLessThan(1e-6);
    expect(s[n - 1].y).toBeCloseTo(terrain.heightAt(spawn.x, spawn.z) + river.options.landOffset, 6);
    for (let i = 1; i < n; i++) {
      expect(Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z)).toBeLessThanOrEqual(MELTWATER.step + 1e-6);
      expect(s[i].s).toBeGreaterThan(s[i - 1].s);
      expect(s[i].kind).toBe('flow');
      // downhill all the way: out of the socket, down onto the slide
      expect(s[i].y).toBeLessThanOrEqual(s[i - 1].y + 1e-9);
    }
    // nothing charged: the iceberg has not melted or moved
    expect(iceberg.ice).toBe(1);
    expect(session.stats.distance).toBe(0);
    // play on: the river continues from the spawn with no gap
    for (let k = 0; k < 120; k++) session.update(FIXED_DT, { steer: 0, source: 'none' });
    expect(s.length).toBeGreaterThan(n + 5);
    expect(Math.hypot(s[n].x - s[n - 1].x, s[n].z - s[n - 1].z)).toBeLessThan(2 * river.options.spacing);
    for (let i = 1; i < s.length; i++) expect(s[i].gapBefore).toBe(false);
    session.dispose();
  });

  it('sits on top: above the socket ice floor, the ground and the snow field', async () => {
    const session = await GameSession.create({ level, skipIntro: true });
    const { river, terrain } = session;
    const g = getGlacier(terrain);
    const n = river.seeded;
    const geo = buildRiverChunk(river.samples, 0, n + 2, terrain);
    const P = geo.position;
    let lowest = Infinity;
    let lowestFloor = Infinity;
    const floorAt = (s: number): number => {
      const b = glacierWorld(g, g.socketBackS, 0, { x: 0, y: 0, z: 0 });
      const f = glacierWorld(g, g.faceS + 0.05, 0, { x: 0, y: 0, z: 0 });
      const yb = terrain.heightAt(b.x, b.z) + g.ledge;
      const yf = terrain.heightAt(f.x, f.z) - 0.25;
      return yb + ((yf - yb) * (s - g.socketBackS)) / (g.faceS + 0.05 - g.socketBackS);
    };
    const smp = river.samples;
    for (let v = 0; v < n * CROSS; v++) {
      // where the water shader draws the vertex: the trail's first 4 m taper in from 35 % width
      const i = Math.floor(v / CROSS);
      const c = i * CROSS + (CROSS - 1) / 2;
      const taper = 0.35 + 0.65 * smoothstep(smp[0].s, smp[0].s + 4, smp[i].s);
      const x = P[c * 3] + (P[v * 3] - P[c * 3]) * taper;
      const y = P[v * 3 + 1];
      const z = P[c * 3 + 2] + (P[v * 3 + 2] - P[c * 3 + 2]) * taper;
      lowest = Math.min(lowest, y - terrain.heightAt(x, z));
      const sv = g.startS + (x - g.spawn.x) * g.fx + (z - g.spawn.z) * g.fz;
      const d = (x - g.spawn.x) * g.rx + (z - g.spawn.z) * g.rz;
      if (sv < g.faceS && Math.abs(d) < g.socketHalf) lowestFloor = Math.min(lowestFloor, y - floorAt(sv));
    }
    // (the snow field is the terrain lifted 6 cm; the river's own banks keep 8 cm off the ground)
    expect(lowest).toBeGreaterThan(0.079);
    expect(lowestFloor).toBeGreaterThan(0.05);
    session.dispose();
  });

  it('is revealed behind the calving iceberg, whatever the intro', async () => {
    const full = await GameSession.create({ level });
    const fr = full.river;
    const n = fr.seeded;
    const k = calvingKeys(INTRO_TIMING.calving);
    const breakAt = full.introTimeline.flyover + k.breakAt;
    // nothing is there before the break; the water behind the embedded iceberg comes with it; the
    // rest as the iceberg slides over it, the spawn point at the hand-off
    for (let i = 0; i < n; i++) {
      expect(fr.samples[i].t).toBeGreaterThanOrEqual(breakAt - 1e-9);
      if (i > 0) expect(fr.samples[i].t).toBeGreaterThanOrEqual(fr.samples[i - 1].t);
    }
    expect(fr.samples[0].t).toBeCloseTo(breakAt, 6);
    expect(fr.samples[n - 1].t).toBeCloseTo(full.introTimeline.total, 6);
    // Space during the flyover: the short calving plays from now, the water with it
    for (let i = 0; i < 90; i++) full.update(1 / 60, { steer: 0, source: 'none' });
    const now = full.time;
    full.skipIntroStep();
    expect(full.introTimeline.kind).toBe('short');
    const ks = calvingKeys(INTRO_TIMING.calvingShort);
    expect(fr.samples[0].t).toBeCloseTo(now + ks.breakAt, 6);
    expect(fr.samples[n - 1].t).toBeCloseTo(now + INTRO_TIMING.calvingShort, 6);
    // Space again (skip the calving): all of it is there at once
    full.update(1 / 60, { steer: 0, source: 'none' });
    full.skipIntroStep();
    expect(full.phase).toBe('playing');
    for (let i = 0; i < n; i++) expect(fr.samples[i].t).toBeLessThanOrEqual(full.time);
    // the intro never moves the iceberg or melts it
    expect(full.iceberg.ice).toBe(1);
    full.dispose();

    // Retry / Skip intros: the short calving from the start, played out to the hand-off
    const short = await GameSession.create({ level, intro: 'short' });
    const sr = short.river;
    expect(sr.samples[sr.seeded - 1].t).toBeCloseTo(INTRO_TIMING.calvingShort, 6);
    const none = { steer: 0, source: 'none' } as const;
    for (let i = 0; i < 100 && short.phase === 'intro'; i++) short.update(1 / 60, none);
    expect(short.phase).toBe('playing');
    for (let i = 0; i < sr.seeded; i++) expect(sr.samples[i].t).toBeLessThanOrEqual(short.time);
    expect(short.iceberg.ice).toBe(1);
    short.dispose();
  });
});

describe('the seeded stretch leaves the river laid in play exactly as it was', () => {
  it('same samples from the spawn on, with or without the meltwater before them', () => {
    // River widths and flows move loose bodies, and the physics is chaotic: the seed must not
    // shift anything (s, width noise, flow) of the river the iceberg lays.
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.08), length: 400, width: 120 });
    const path: PathFn = (d) => ({ x: 12 * Math.sin(d / 40), z: d });
    const plain = new RiverTrail();
    drive(plain, terrain, path, { speed: 14, from: 20, to: 260 });
    const seeded = new RiverTrail();
    const ice = makeIceberg();
    const p0 = path(20);
    const q0 = path(20.01);
    const l = Math.hypot(q0.x - p0.x, q0.z - p0.z);
    ice.pos.x = p0.x;
    ice.pos.z = p0.z;
    ice.vel.x = ((q0.x - p0.x) / l) * 14;
    ice.vel.z = ((q0.z - p0.z) / l) * 14;
    ice.heading = dirToHeading(ice.vel.x, ice.vel.z);
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let k = 10; k >= 0; k--) {
      const x = p0.x;
      const z = p0.z - 0.6 * k;
      xs.push(x);
      ys.push(terrain.heightAt(x, z) + (k === 0 ? 0.15 : 0.4));
      zs.push(z);
    }
    seeded.seed(ice, terrain, xs, ys, zs, xs.map(() => 0));
    drive(seeded, terrain, path, { speed: 14, from: 20, to: 260 });
    const n = seeded.seeded;
    expect(n).toBe(11);
    const a = plain.samples;
    const b = seeded.samples;
    expect(b.length).toBe(a.length + n - 1);
    expect(b[0].s).toBeLessThan(-5);
    const keys = ['x', 'y', 'z', 's', 'width', 'flowSpeed', 'turbulence', 'dirX', 'dirZ', 'kind'] as const;
    for (let i = 0; i < a.length; i++) {
      for (const k of keys) expect(b[i + n - 1][k], `sample ${i} ${k}`).toBe(a[i][k]);
    }
    for (const [x, z] of [[p0.x, 60], [p0.x + 1, 120], [path(200).x, 200]]) {
      expect(seeded.flowAt(x, z)).toEqual(plain.flowAt(x, z));
    }
  });
});
