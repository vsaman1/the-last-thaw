import { describe, expect, it } from 'vitest';
import { CONTACT_ABOVE } from '../sim/iceberg';
import {
  BASE_RADIUS,
  CONTACT_ABOVE_BASE,
  confiningBank,
  createWaterSample,
  floatDraft,
  hullCurrent,
  icebergHeight,
  isConfinedBy,
} from '../sim/inlandWater';
import { DEFAULT_ICEBERG_PARAMS } from '../sim/params';
import { profileAt, streamSection } from '../terrain/stream';
import { createTerrain, type GeneratedTerrain } from '../terrain/terrain';
import { SANDBOX_GLACIER_RUN, streamSandbox } from '../testing/streamSandbox';
import { timed } from '../testing/timing';
import type { LevelDef, TerrainFeature } from '../types';
import { Reach } from './reach';
import { WaterSystem } from './system';
import { HYDRO, RESERVOIR, SPRING } from './tuning';

/**
 * Streams, reservoirs and floods on their own (no iceberg, no physics): the channel the terrain
 * carves, the current, the confinement thresholds, the 1D routing, the reservoir's level and
 * shoreline, the drain and flood after a breach, determinism. Fixture: src/core/testing/streamSandbox.
 */

type Stream = Extract<TerrainFeature, { type: 'stream' }>;
const FIXED = 1 / 60;
const stream = streamSandbox.features![0] as Stream;
const built = timed(() => createTerrain(streamSandbox));
const terrain: GeneratedTerrain = built.result;
/** The same valley without its streams (the dam stays: it is only an obstacle). */
const plain = createTerrain({ ...streamSandbox, id: 'stream-sandbox-plain', features: [] });

const water = (): WaterSystem => new WaterSystem(terrain);
const prof0 = () => terrain.streamProfiles[0];
const step = (w: WaterSystem, seconds: number): void => {
  for (let k = 0; k < Math.round(seconds / FIXED); k++) w.step(FIXED, null, null, null);
};

describe('confinement thresholds', () => {
  it('uses the iceberg collision height (2.8 m at the base radius) and the drawn draft', () => {
    expect(CONTACT_ABOVE_BASE).toBe(CONTACT_ABOVE);
    expect(BASE_RADIUS).toBe(DEFAULT_ICEBERG_PARAMS.radius);
    expect(icebergHeight(2.2)).toBeCloseTo(2.8, 6);
    expect(floatDraft(2.2)).toBeCloseTo(0.75, 6);
    expect(floatDraft(4.4)).toBeCloseTo(1.5, 6);
  });

  it('holds an iceberg in a channel whose banks reach 3/4 of its height, if it fits the channel', () => {
    // Base iceberg: banks from 2.1 m; scale 1.5: 3.15 m; scale 2: 4.2 m.
    expect(confiningBank(2.2)).toBeCloseTo(2.1, 6);
    expect(confiningBank(3.3)).toBeCloseTo(3.15, 6);
    expect(confiningBank(4.4)).toBeCloseTo(4.2, 6);
    expect(isConfinedBy(3, 14, 2.2)).toBe(true);
    expect(isConfinedBy(2, 14, 2.2)).toBe(false);
    expect(isConfinedBy(3, 14, 4.84)).toBe(false); // the sandbox's big iceberg (scale 2.2)
    expect(isConfinedBy(5, 14, 4.84)).toBe(true);
    // Wider than the channel: it straddles it, whatever the banks.
    expect(isConfinedBy(10, 4, 2.2)).toBe(false);
    // Melting shrinks it (held more easily), growing frees it.
    expect(isConfinedBy(1.8, 14, 2.2 * 0.8)).toBe(true);
    expect(isConfinedBy(3, 14, 2.2 * Math.cbrt(4))).toBe(false);
  });

  it('carries the hull at the centre line speed unless it is pressed toward a bank', () => {
    const w = createWaterSample();
    Object.assign(w, { channel: true, cvx: 0, cvz: 4, vx: 0, vz: 1, waterHalf: 5, lat: 0 });
    const out = { x: 0, z: 0 };
    hullCurrent(w, 2.2, out);
    expect(out.z).toBeCloseTo(4, 6);
    w.lat = 4.5;
    hullCurrent(w, 2.2, out);
    expect(out.z).toBeGreaterThan(1.4);
    expect(out.z).toBeLessThan(4);
    w.channel = false;
    hullCurrent(w, 2.2, out);
    expect(out.z).toBe(1);
  });
});

describe('stream channel', () => {
  const prof = terrain.streamProfiles[0];

  it('builds in about the time of the plain valley and publishes one profile per stream', () => {
    const size = `${terrain.grid.cols}×${terrain.grid.rows}`;
    console.log(`stream sandbox terrain build ${built.ms.toFixed(0)} ms (${size})`);
    expect(terrain.streamProfiles.map((p) => p.index)).toEqual([0, 1]);
    expect(built.ms).toBeLessThan(2000);
  });

  it('never rises downstream and steps down where the valley does (the cliff band: a waterfall)', () => {
    const v = prof.values;
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThanOrEqual(v[i - 1]);
    // The 6 m band at s 760 crosses the stream (d ≈ −6) about 700 m below s 60.
    const from = Math.round(SANDBOX_GLACIER_RUN / prof.step);
    let drop = 0;
    for (let i = from + 680; i < from + 720; i++) drop = Math.max(drop, v[i] - v[i + 3]);
    expect(drop).toBeGreaterThan(4.5);
  });

  it('cuts a bed `bank` m below the profile with banks to the ground beside it', () => {
    const w = new WaterSystem(terrain);
    const r = w.streams[0].reach;
    for (const i of [60, 150, 230, 420, 500]) {
      const x = r.x[i];
      const z = r.z[i];
      const bed = profileAt(prof, r.arc[i]) - stream.bank;
      expect(terrain.heightAt(x, z)).toBeCloseTo(bed, 0);
      // The bank top: the valley floor, as without the stream (a few cm of bumps aside).
      const rx = -r.dirZ[i];
      const rz = r.dirX[i];
      for (const side of [-1, 1]) {
        const out = stream.width / 2 + 2;
        const gx = x + rx * side * out;
        const gz = z + rz * side * out;
        expect(Math.abs(terrain.heightAt(gx, gz) - plain.heightAt(gx, gz))).toBeLessThan(1.5);
        expect(terrain.heightAt(gx, gz)).toBeGreaterThan(bed + stream.bank - 0.6);
      }
    }
    // The section itself: flat bed, banks up to the profile at the bank top, cut beyond only where
    // the ground stands above the profile.
    expect(streamSection(stream, 0, 50, 1)).toBe(47);
    expect(streamSection(stream, 7, 50, 1)).toBeCloseTo(50, 6);
    expect(streamSection(stream, 9, 50, 1)).toBeCloseTo(52, 6);
    expect(streamSection(stream, 30, 50, 1)).toBe(Infinity);
  });

  it('leaves the ground alone away from the streams', () => {
    for (const [x, z] of [
      [25, 200],
      [-30, 900],
      [0, 20],
    ]) {
      expect(terrain.heightAt(x, z)).toBeCloseTo(plain.heightAt(x, z), 6);
    }
  });
});

describe('current', () => {
  it('flows down the channel at the design discharge, faster and shallower on steep stretches', () => {
    const w = water();
    const st = w.streams[0];
    const r = st.reach;
    // Past the opening taper the whole design discharge flows (the spillway below the dam: 12 %).
    const below = w.reservoirs[0].cell;
    for (const i of [40, 100, 200, 260]) expect(w.dischargeAt(0, i)).toBeCloseTo(st.q, 1);
    for (const i of [below + 20, below + 200]) {
      expect(w.dischargeAt(0, i)).toBeCloseTo(RESERVOIR.spillShare * st.q, 1);
    }
    // s 60-440 falls 0.08/m, s 440-550 0.04/m: the gentle stretch flows slower and deeper.
    const steep = 120;
    const gentle = 240;
    expect(r.u[steep]).toBeGreaterThan(r.u[gentle] + 0.5);
    expect(r.h[steep]).toBeLessThan(r.h[gentle]);
    // The flow runs down the channel: the sample there points along it, slower at the banks.
    const ws = createWaterSample();
    expect(w.sample(r.x[steep], r.z[steep], ws)).toBe(true);
    expect(ws.channel).toBe(true);
    expect(ws.vx * r.dirX[steep] + ws.vz * r.dirZ[steep]).toBeCloseTo(r.u[steep], 1);
    const fast = Math.hypot(ws.vx, ws.vz);
    const rx = -r.dirZ[steep];
    const rz = r.dirX[steep];
    expect(w.sample(r.x[steep] + rx * 3.5, r.z[steep] + rz * 3.5, ws)).toBe(true);
    expect(Math.hypot(ws.vx, ws.vz)).toBeLessThan(fast);
    expect(Math.abs(ws.lat - 3.5)).toBeLessThan(0.2);
    // Dry land beside it.
    expect(w.sample(r.x[steep] + rx * 25, r.z[steep] + rz * 25, ws)).toBe(false);
    expect(w.flowAt(r.x[steep] + rx * 25, r.z[steep] + rz * 25)).toBeNull();
  });

  it('stays still at a pool end and stays steady when nothing happens', () => {
    const w = water();
    const pool = w.streams[1].reach;
    const ws = createWaterSample();
    const end = pool.n - 2;
    expect(w.sample(pool.x[end], pool.z[end], ws)).toBe(true);
    expect(Math.hypot(ws.vx, ws.vz)).toBeLessThan(0.2);
    expect(ws.still).toBe(true);
    const v0 = w.version;
    step(w, 10);
    expect(w.version).toBe(v0);
  });
});

describe('stream sources', () => {
  it('meltwater runs at full depth and discharge from its first cell under the glacier', () => {
    const w = water();
    const st = w.streams[0];
    const r = st.reach;
    expect(st.def.source).toBe('glacier');
    // All of it enters at the source (no fade-in taper), so the first cells carry it at full depth.
    expect(r.springs[0]).toBeCloseTo(st.q, 9);
    for (let i = 1; i < r.n; i++) expect(r.springs[i]).toBe(0);
    expect(w.dischargeAt(0, 1)).toBeCloseTo(st.q, 1);
    expect(r.h[0]).toBeGreaterThan(0.8);
    expect(r.bank[0]).toBe(stream.bank);
    // The terrain's channel is full depth at the source too (under the ice).
    expect(terrain.heightAt(r.x[0], r.z[0])).toBeCloseTo(profileAt(prof0(), 0) - stream.bank, 0);
    expect(st.drawFrom).toBe(0);
  });

  it('a cave spring rises in a still pool at one level that runs on into the stream without a step', () => {
    const w = water();
    expect(w.pools).toHaveLength(1);
    const pool = w.pools[0];
    const st = w.streams[pool.stream];
    const r = st.reach;
    expect(st.def.source).toBe('cave');
    // The pool's cells lie flat, at the pool's level; the stream's cells past its sill drop away.
    let out = 0;
    while (r.arc[out + 1] <= pool.radius) out++;
    for (let i = 0; i <= out; i++) expect(r.baseY[i] + r.h[i]).toBeCloseTo(pool.level, 6);
    const slope = (r.baseY[out + 1] - r.baseY[out + 3]) / (r.arc[out + 3] - r.arc[out + 1]);
    const drop = pool.level - (r.baseY[out + 1] + r.h[out + 1]);
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThan(slope * r.dx + 0.15);
    // Its bowl is deeper than the stream (the carve's SPRING_POOL.deepen below the outlet's bed).
    expect(pool.level - pool.floorY).toBeGreaterThan(1.8);
    expect(terrain.heightAt(r.x[0], r.z[0])).toBeCloseTo(pool.floorY, 1);
    expect(pool.vertexCount).toBeGreaterThan(20);
    // Sampled along the stream from behind the spring out past the sill: the surface never jumps.
    const ws = createWaterSample();
    let last = Infinity;
    for (let a = -6; a <= 24; a += 0.5) {
      const x = r.x[0] + r.dirX[0] * a;
      const z = r.z[0] + r.dirZ[0] * a;
      if (!w.sample(x, z, ws) || !(ws.surfaceY > ws.groundY + 0.02)) continue;
      if (last < Infinity) expect(Math.abs(ws.surfaceY - last)).toBeLessThan(0.12);
      last = ws.surfaceY;
    }
    // In the pool: still water at its level, drifting gently toward the outlet, no banks.
    const mid = { x: r.x[0] + r.dirX[0] * 2, z: r.z[0] + r.dirZ[0] * 2 };
    expect(w.sample(mid.x, mid.z, ws)).toBe(true);
    expect(ws.surfaceY).toBeCloseTo(pool.level, 6);
    expect(ws.still).toBe(true);
    expect(ws.drowned).toBe(true);
    expect(Math.hypot(ws.vx, ws.vz)).toBeCloseTo(SPRING.drift, 6);
    expect(ws.vx * (pool.ox - mid.x) + ws.vz * (pool.oz - mid.z)).toBeGreaterThan(0);
    const f = w.flowAt(mid.x, mid.z);
    expect(f?.surfaceY).toBeCloseTo(pool.level, 6);
    // Beside the spring, off the channel's line, still the pool.
    const side = { x: r.x[0] - r.dirZ[0] * 6, z: r.z[0] + r.dirX[0] * 6 };
    expect(w.sample(side.x, side.z, ws)).toBe(true);
    expect(ws.surfaceY).toBeCloseTo(pool.level, 6);
    // The lake is not drawn past the sill; the stream's ribbon takes over there.
    expect(st.drawFrom).toBe(out + 1);
    expect(pool.contains(r.x[out + 2], r.z[out + 2])).toBe(false);
  });

  it("a branch's ribbon starts where it leaves its parent's water", () => {
    const branch: Stream = {
      type: 'stream',
      source: 'branch',
      points: [
        { s: 250, d: -4 },
        { s: 270, d: 14 },
        { s: 420, d: 24 },
      ],
      width: 8,
      bank: 3,
      end: 'pool',
    };
    const level: LevelDef = { ...streamSandbox, id: 'stream-sandbox-branch', features: [stream, branch] };
    const w = new WaterSystem(createTerrain(level));
    const st = w.streams[1];
    expect(st.drawFrom).toBeGreaterThan(0);
    expect(st.drawFrom).toBeLessThan(8);
    // Its first cell lies in the parent's water, the first one drawn outside it.
    const parent = w.streams[0].reach;
    const inParent = (i: number): boolean => {
      const x = st.reach.x[i];
      const z = st.reach.z[i];
      for (let k = 0; k + 1 < parent.n; k++) {
        const ex = parent.x[k + 1] - parent.x[k];
        const ez = parent.z[k + 1] - parent.z[k];
        const t = Math.min(1, Math.max(0, ((x - parent.x[k]) * ex + (z - parent.z[k]) * ez) / (ex * ex + ez * ez)));
        const dist = Math.hypot(x - parent.x[k] - ex * t, z - parent.z[k] - ez * t);
        if (dist <= parent.waterHalf(k, parent.h[k])) return true;
      }
      return false;
    };
    expect(inParent(0)).toBe(true);
    expect(inParent(st.drawFrom - 1)).toBe(true);
    expect(inParent(st.drawFrom)).toBe(false);
  });
});

describe('reach routing', () => {
  /** A straight 400 m channel 10 m wide, 2 m banks, 1 m deep at 4 m/s. */
  const channel = (): Reach => {
    const r = new Reach(201, 2);
    r.n = 201;
    for (let i = 0; i < r.n; i++) {
      r.x[i] = 0;
      r.z[i] = i * 2;
      r.dirZ[i] = 1;
      r.arc[i] = i * 2;
      r.baseY[i] = -0.05 * i * 2;
      r.width[i] = 10;
      r.topHalf[i] = 5;
      r.bank[i] = 2;
      r.speed[i] = 4;
      r.h0[i] = 1;
      r.still[i] = 1;
    }
    r.qIn = 40;
    r.settle(40);
    return r;
  };

  it('keeps a steady state steady and conserves water', () => {
    const r = channel();
    expect(r.h[100]).toBeCloseTo(1, 3);
    for (let k = 0; k < 600; k++) r.step(FIXED);
    expect(r.h[100]).toBeCloseTo(1, 3);
    expect(r.outflow).toBeCloseTo(40, 3);
    // A pulse: what goes in comes out (or is still in the channel).
    const v0 = r.A.reduce((a, b) => a + b, 0) * r.dx;
    let inflow = 0;
    let outflow = 0;
    for (let k = 0; k < 1200; k++) {
      r.qIn = k < 120 ? 200 : 40;
      inflow += r.qIn * FIXED;
      r.step(FIXED);
      outflow += r.outflow * FIXED;
    }
    const v1 = r.A.reduce((a, b) => a + b, 0) * r.dx;
    expect(v1 - v0).toBeCloseTo(inflow - outflow, 3);
  });

  it('runs a flood wave down at about 5/3 of the water speed and spreads it over the banks', () => {
    const r = channel();
    let arrive = -1;
    for (let k = 0; k < 60 * 60 && arrive < 0; k++) {
      r.qIn = k < 300 ? 400 : 40;
      r.step(FIXED);
      if (r.h[150] > 2) arrive = k * FIXED;
    }
    // 300 m at the flood's speed (~9-12 m/s at 3+ m depth): well under a minute.
    expect(arrive).toBeGreaterThan(10);
    expect(arrive).toBeLessThan(40);
    expect(r.waterHalf(150, r.h[150])).toBeGreaterThan(5);
  });

  it('sends a dam inflow to its reservoir and splits off a captured share', () => {
    const r = channel();
    r.sinks.push({ at: 100, inflow: 4, sunk: 0 });
    r.divertAt = 150;
    r.divertShare = 0.75;
    for (let k = 0; k < 60 * 120; k++) r.step(FIXED);
    expect(r.sinks[0].sunk).toBeCloseTo(40, 1);
    expect(r.A[160] * r.u[160]).toBeCloseTo(1, 1);
    expect(r.diverted).toBeCloseTo(3, 1);
  });
});

describe('reservoir', () => {
  it('fills the gorge to just under the crest; the terrain decides the shoreline', () => {
    const w = water();
    expect(w.reservoirs).toHaveLength(1);
    const res = w.reservoirs[0];
    expect(res.placement).toBe(0);
    expect(res.crestY - res.floorY).toBeCloseTo(RESERVOIR.crest, 6);
    expect(res.fullLevel).toBeCloseTo(res.crestY - RESERVOIR.freeboard, 6);
    // Every lake vertex is below the level and upstream of the dam's line; its neighbours outside
    // the lake are above the level or across the dam.
    const g = terrain.grid;
    let checked = 0;
    for (let j = 0; j < res.rows; j++) {
      for (let i = 0; i < res.cols; i++) {
        const gx = g.originX + (res.ix0 + i) * g.cellSize;
        const gz = g.originZ + (res.iz0 + j) * g.cellSize;
        const up = (gx - res.cx) * res.upX + (gz - res.cz) * res.upZ;
        const lake = res.mask[j * res.cols + i] === 1;
        if (lake) {
          expect(g.heights[(res.iz0 + j) * g.cols + res.ix0 + i]).toBeLessThan(res.level);
          expect(up).toBeGreaterThan(0);
          checked++;
        }
      }
    }
    expect(checked).toBe(res.vertexCount);
    expect(res.vertexCount).toBeGreaterThan(1000);
    // It reaches up the valley until the floor rises above it (s ≈ 430), and floods the floor.
    const ws = createWaterSample();
    const at = (s: number, d: number): boolean => {
      const p = terrain.course.toWorld(s, d);
      return w.sample(p.x, p.z, ws) && Math.abs(ws.surfaceY - res.level) < 1e-6;
    };
    expect(at(580, 10)).toBe(true);
    expect(at(520, -25)).toBe(true);
    expect(at(400, 0)).toBe(false);
    expect(at(610, 0)).toBe(false);
    // Volume grows with the level.
    expect(res.volumeAt(res.level)).toBeCloseTo(res.fullVolume, 3);
    expect(res.volumeAt(res.level - 2)).toBeLessThan(res.fullVolume);
    console.log(
      `reservoir: level ${res.level.toFixed(2)} (crest ${res.crestY.toFixed(2)}), ` +
        `${res.vertexCount} vertices, ${res.fullVolume.toFixed(0)} m³`,
    );
  });

  it('drains over a few seconds after a breach and sends a flood down the stream', () => {
    const w = water();
    const res = w.reservoirs[0];
    const r = w.streams[0].reach;
    const head = res.level - res.floorY;
    // A monolith whose foot stands above the water (up the gorge wall) is no breach.
    const [e0, e1] = res.ends;
    const al = Math.hypot(e1.x - e0.x, e1.z - e0.z);
    let dry = { x: e0.x, y: 0, z: e0.z };
    for (let o = 0; o < 6; o += 0.5) {
      const x = e0.x - ((e1.x - e0.x) / al) * o;
      const z = e0.z - ((e1.z - e0.z) / al) * o;
      dry = { x, y: terrain.heightAt(x, z), z };
      if (dry.y > res.level + 0.5) break;
    }
    expect(dry.y).toBeGreaterThan(res.level);
    expect(w.damBroken(dry)).toBeNull();
    expect(res.broken).toBe(false);
    expect(w.damBroken({ x: res.cx, y: res.floorY, z: res.cz })).toBe(res);
    const tau = RESERVOIR.drainTau;
    const cell = (s: number): number => {
      let best = 0;
      for (let i = 0; i < r.n; i++) if (Math.abs(r.z[i] - s) < Math.abs(r.z[best] - s)) best = i;
      return best;
    };
    const c650 = cell(650);
    const c900 = cell(900);
    // (Below the intact dam the stream ran at the spillway trickle.)
    const before900 = r.h[c900];
    let peak650 = 0;
    let arrive650 = -1;
    let arrive900 = -1;
    let qMax = 0;
    for (let k = 1; k <= 60 * 40; k++) {
      w.step(FIXED, null, null, null);
      const t = k * FIXED;
      qMax = Math.max(qMax, res.outflow);
      const rise = r.h[c650] - r.steady[c650];
      peak650 = Math.max(peak650, rise);
      if (arrive650 < 0 && rise > 0.5) arrive650 = t;
      if (arrive900 < 0 && r.h[c900] - before900 > 0.5) arrive900 = t;
      const left = res.level - res.breachFloor;
      if (k === Math.round(tau * 60)) expect(left).toBeLessThanOrEqual(0.26 * head);
      if (k === Math.round(2 * tau * 60)) expect(left).toBeLessThanOrEqual(0.12 * head);
    }
    expect(qMax).toBeLessThanOrEqual(RESERVOIR.weir * res.breachWidth * Math.pow(head, 1.5) + 1e-6);
    expect(qMax).toBeLessThanOrEqual(RESERVOIR.floodMax);
    expect(qMax).toBeGreaterThan(150);
    // One monolith (10 m) breached: 50 m below the dam within seconds, a metre above the free
    // stream; 300 m below later. (Three monoliths: see the session test, over the banks.)
    expect(res.breachWidth).toBe(RESERVOIR.breachWidth);
    expect(arrive650).toBeGreaterThan(0);
    expect(arrive650).toBeLessThan(10);
    expect(peak650).toBeGreaterThan(0.8);
    expect(arrive900).toBeGreaterThan(arrive650);
    // Drained: the stream runs through the breach at its free discharge.
    expect(w.dischargeAt(0, res.cell + 10) / w.streams[0].q).toBeGreaterThan(0.97);
    console.log(
      `flood: peak ${qMax.toFixed(0)} m³/s, at s 650 after ${arrive650.toFixed(1)} s ` +
        `(rise ${peak650.toFixed(2)} m), s 900 after ${arrive900.toFixed(1)} s`,
    );
  });

  it('holds no reservoir behind a dam whose ends do not reach high ground, nor without a stream', () => {
    // The same dam on the open floor, 20 m wide: its ends stand on the floor beside the channel.
    const level: LevelDef = {
      ...streamSandbox,
      id: 'stream-short-dam',
      obstacles: [{ kind: 'dam', s: 300, d: 2, span: 20 }],
    };
    const w = new WaterSystem(createTerrain(level));
    expect(w.reservoirs).toHaveLength(1);
    const res = w.reservoirs[0];
    // Held only to just below the floor beside it (the channel brimful), not to the crest.
    expect(res.level).toBeLessThan(res.crestY - 3);
    const none = new WaterSystem(createTerrain({ ...level, id: 'stream-no-dam', obstacles: [] }));
    expect(none.reservoirs).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('two systems stepped alike agree bit for bit', () => {
    const a = water();
    const b = water();
    for (const w of [a, b]) {
      step(w, 2);
      w.damBroken({ x: w.reservoirs[0].cx, y: w.reservoirs[0].floorY, z: w.reservoirs[0].cz });
      step(w, 12);
    }
    expect(Array.from(a.streams[0].reach.A)).toEqual(Array.from(b.streams[0].reach.A));
    expect(a.reservoirs[0].level).toBe(b.reservoirs[0].level);
    expect(a.version).toBe(b.version);
  });

  it('builds and steps cheaply', () => {
    // Terrain with and without the streams (the same valley), and the session's water system.
    const level = { ...streamSandbox, id: 'stream-sandbox-timing' };
    const withStreams = timed(() => createTerrain(level)).ms;
    const without = timed(() => createTerrain({ ...level, id: 'stream-plain-timing', features: [] })).ms;
    const build = timed(() => new WaterSystem(terrain));
    console.log(
      `terrain ${withStreams.toFixed(0)} ms with the two streams, ${without.toFixed(0)} ms without; ` +
        `water system ${build.ms.toFixed(1)} ms`,
    );
    expect(build.ms).toBeLessThan(200);
    const w = build.result;
    w.damBroken({ x: w.reservoirs[0].cx, y: w.reservoirs[0].floorY, z: w.reservoirs[0].cz });
    const t = timed(() => step(w, 10));
    const per = t.ms / 600;
    console.log(`water step (2 streams, 630 cells, draining reservoir): ${(per * 1000).toFixed(0)} µs`);
    expect(per).toBeLessThan(1);
    const ws = createWaterSample();
    const r = w.streams[0].reach;
    const q = timed(() => {
      let n = 0;
      for (let k = 0; k < 20000; k++) if (w.sample(r.x[k % r.n] + 2, r.z[k % r.n], ws)) n++;
      return n;
    });
    console.log(`water sample: ${((q.ms / 20000) * 1000).toFixed(2)} µs`);
    expect(q.ms / 20000).toBeLessThan(0.05);
    expect(HYDRO.cell).toBe(2);
  });
});
