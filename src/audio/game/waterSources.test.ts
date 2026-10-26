import { describe, expect, it } from 'vitest';
import type { RiverSample, RiverTrailApi } from '../../core/types';
import type { WaterSystem } from '../../core/water/system';
import { SPATIAL } from '../contract';
import { distanceGain } from '../spatial';
import {
  DamWatch,
  FALL_FADE_SEC,
  FALL_Q_REF,
  FallSources,
  FloodSource,
  fallStrength,
  nearAmount,
} from './waterSources';

const sample = (x: number, kind: RiverSample['kind'], flowSpeed = 10, width = 6): RiverSample => ({
  x,
  y: 0,
  z: 0,
  dirX: 1,
  dirZ: 0,
  s: x,
  width,
  flowSpeed,
  turbulence: 0,
  t: 0,
  kind,
});

function river(samples: RiverSample[]): RiverTrailApi & { version: number } {
  return { samples, version: 1, length: 0, record() {}, flowAt: () => null, disturb() {}, reset() {} };
}

interface FakeReach {
  n: number;
  x: Float64Array;
  z: Float64Array;
  baseY: Float64Array;
  h: Float64Array;
  u: Float64Array;
  fall: Float64Array;
  steady: Float64Array;
}

function reach(n: number, falls: readonly number[], at: (c: number) => [number, number] = (c) => [c * 2, 50]): FakeReach {
  const r: FakeReach = {
    n,
    x: new Float64Array(n),
    z: new Float64Array(n),
    baseY: new Float64Array(n),
    h: new Float64Array(n).fill(1),
    u: new Float64Array(n).fill(4),
    fall: new Float64Array(n),
    steady: new Float64Array(n).fill(1),
  };
  for (let c = 0; c < n; c++) [r.x[c], r.z[c]] = at(c);
  for (const c of falls) r.fall[c] = 1;
  return r;
}

const water = (reaches: FakeReach[], reservoirs: unknown[] = []): WaterSystem =>
  ({ version: 1, streams: reaches.map((r) => ({ reach: r })), captures: [], reservoirs }) as unknown as WaterSystem;

const poseAt = (x: number, z = 0) => ({ px: x, py: 0, pz: z, rightX: 0, rightZ: -1, fwdX: 1, fwdZ: 0 });

describe('waterfall sources', () => {
  it('a dry level has none; the river trail adds one per fall run, a stream one per run of fall cells', () => {
    const dry = new FallSources(river([sample(0, 'flow'), sample(2, 'flow')]), null);
    dry.rebuild();
    expect(dry.count).toBe(0);
    const s = [sample(0, 'flow'), sample(2, 'fall'), sample(4, 'fall'), sample(6, 'flow', 12, 5), sample(8, 'fall'), sample(10, 'flow')];
    const r = reach(20, [3, 4, 5, 12]);
    const f = new FallSources(river(s), water([r]));
    f.rebuild();
    expect(f.count).toBe(4);
    // Stream runs at their lowest (last) cell, flow h·|u|.
    expect(Array.from(f.table.slice(0, 3))).toEqual([10, 50, 4]);
    // Trail runs at the first sample after the run, flow flowSpeed·width/10.
    expect(f.table[2 * 4]).toBe(6);
    expect(f.table[2 * 4 + 2]).toBeCloseTo(6, 5);
  });

  it('strength follows the pinned reference flow; spray only near', () => {
    expect(fallStrength(0)).toBe(0);
    expect(fallStrength(FALL_Q_REF)).toBe(1);
    expect(fallStrength(FALL_Q_REF / 2)).toBeCloseTo(0.5, 6);
    expect(nearAmount(5)).toBe(1);
    expect(nearAmount(50)).toBe(0);
  });

  it('the two loudest take the slots; a reassigned source fades out on the third, nothing jumps', () => {
    // Three trail falls at x = 0, 100 and 200 (each the sample after a one-sample fall run).
    const s = [
      sample(-2, 'fall', 20, 10), sample(0, 'flow', 20, 10),
      sample(98, 'fall', 20, 10), sample(100, 'flow', 20, 10),
      sample(198, 'fall', 20, 10), sample(200, 'flow', 20, 10),
    ];
    const f = new FallSources(river(s), null);
    let inp = f.update(0.3, poseAt(0));
    const on = () => f.slots.filter((x) => x.mode === 'on').map((x) => x.x).sort((a, b) => a - b);
    expect(on()).toEqual([0, 100]);
    expect(inp[0].distGain).toBe(1);
    // Move toward the third: once it beats the weaker by 15 % it takes over, the old one fades.
    inp = f.update(0.3, poseAt(160));
    expect(on()).toEqual([100, 200]);
    const fading = f.slots.find((x) => x.mode === 'fading');
    expect(fading?.x).toBe(0);
    const k = f.slots.indexOf(fading!);
    const before = inp[k].strength;
    inp = f.update(0.5, poseAt(160));
    expect(inp[k].strength).toBeLessThan(before);
    expect(inp[k].strength).toBeGreaterThan(0);
    f.update(FALL_FADE_SEC, poseAt(160));
    expect(f.slots[k].mode).toBe('free');
    expect(f.inputs[k].active).toBe(false);
  });

  it('hysteresis: a challenger only a little louder does not take a slot', () => {
    const s = [
      sample(-2, 'fall', 20, 10), sample(0, 'flow', 20, 10),
      sample(98, 'fall', 20, 10), sample(100, 'flow', 20, 10),
      sample(118, 'fall', 20, 10), sample(120, 'flow', 20, 10),
    ];
    const f = new FallSources(river(s), null);
    f.update(0.3, poseAt(0));
    const before = f.slots.map((x) => x.mode + x.x).join();
    // From x = 61 the source at 120 (59 m) is a little louder than the playing one at 0 (61 m): not enough.
    const challenger = distanceGain(59, SPATIAL.falls);
    const incumbent = distanceGain(61, SPATIAL.falls);
    expect(challenger / incumbent).toBeGreaterThan(1);
    expect(challenger / incumbent).toBeLessThan(1.15);
    f.update(0.3, poseAt(61));
    expect(f.slots.map((x) => x.mode + x.x).join()).toBe(before);
    // Closer still, it is clearly louder and takes over.
    f.update(0.3, poseAt(90));
    expect(f.slots.filter((x) => x.mode === 'on').map((x) => x.x).sort((a, b) => a - b)).toEqual([100, 120]);
  });

  it('sources beyond 300 m are culled', () => {
    const f = new FallSources(river([sample(-2, 'fall'), sample(0, 'flow')]), null);
    f.update(0.3, poseAt(400));
    expect(f.slots.every((x) => x.mode === 'free')).toBe(true);
  });
});

describe('the flood', () => {
  const res = (over: Record<string, unknown> = {}) => ({
    broken: false,
    outflow: 0,
    drained: 0,
    qPeak: 0,
    bx: 0,
    bz: 0,
    floorY: 0,
    ...over,
  });

  it('is silent until a breach, rushes at √(outflow/1500), stops once drained', () => {
    const r = res();
    const w = water([reach(10, [])], [r]);
    const flood = new FloodSource(w);
    expect(flood.update(poseAt(0)).rush).toBe(0);
    Object.assign(r, { broken: true, outflow: 1500 * 0.25, qPeak: 1500 });
    expect(flood.update(poseAt(0)).rush).toBeCloseTo(0.5, 6);
    expect(flood.inputs.distGain).toBe(1);
    Object.assign(r, { drained: 0.99 });
    expect(flood.update(poseAt(0)).rush).toBe(0);
  });

  it('hears the flood front downstream once the breach is far', () => {
    const r = reach(300, []);
    for (let c = 200; c < 220; c++) r.h[c] = 2.5; // 1.5 m over steady: a full flood
    const w = water([r], [res({ broken: true, outflow: 900, qPeak: 1200, bx: -2000 })]);
    const flood = new FloodSource(w);
    flood.update(poseAt(420, 50));
    flood.update(poseAt(420, 50));
    const out = flood.update(poseAt(420, 50));
    expect(out.rush).toBe(1);
    expect(out.distGain).toBeGreaterThan(0.9);
  });
});

describe('the dam moment (M5)', () => {
  it('Story: lowers while the outflow is high, at most 15 s; Arcade: 4 s', () => {
    const r = { broken: false, outflow: 0, qPeak: 0 };
    const w = { reservoirs: [r] } as unknown as WaterSystem;
    const story = new DamWatch(w, true);
    expect(story.update(0.1)).toBeNull();
    Object.assign(r, { broken: true, outflow: 1000, qPeak: 1000 });
    expect(story.update(0.1)).toBe('breach');
    expect(story.update(5)).toBeNull();
    r.outflow = 250;
    expect(story.update(0.1)).toBe('subside');
    expect(story.update(0.1)).toBeNull();
    const r2 = { broken: true, outflow: 1000, qPeak: 1000 };
    const arcade = new DamWatch({ reservoirs: [r2] } as unknown as WaterSystem, false);
    expect(arcade.update(0.1)).toBe('breach');
    expect(arcade.update(3.9)).toBeNull();
    expect(arcade.update(0.2)).toBe('subside');
    const capped = new DamWatch({ reservoirs: [{ broken: true, outflow: 1000, qPeak: 1000 }] } as unknown as WaterSystem, true);
    capped.update(0.1);
    expect(capped.update(14.9)).toBeNull();
    expect(capped.update(0.2)).toBe('subside');
  });
});
