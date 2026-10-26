import { describe, expect, it } from 'vitest';
import { createTerrain, type GeneratedTerrain } from '../terrain/terrain';
import type { IcebergState, KickerLip, LevelDef, TerrainFeature } from '../types';
import { createIceberg, stepIceberg } from './iceberg';
import { alongLip } from './kicker';
import { DEFAULT_ICEBERG_PARAMS as P } from './params';
import { levelWarnings } from '../terrain/validate';

/**
 * Kickers on an open relief slope, in a cliff band's spread zone, with a fatal crevasse at the lip
 * (the Glacier Avalanche report, measured on main 36b5594): a 3.5/14 kicker on ~0.33 ground left a
 * ~0.5 m step at its toe that launched the iceberg early; it came down on the last metres of the
 * face, where the crevasse's wall had eaten into the face the exact lip was fitted to, and the
 * mis-fitted face put it 66 m under the ground with its speed gone (15 → 1.6 m/s, stuck).
 * The layout (the level's draft before 59e8b29): a straight course along +Z (s = z, d = −x), a 12 m
 * cliff band at s 392 (d −90, 70 m wide), the ramp lip at s 403.5 on d 0, the crevasse a diagonal
 * 16 m ravine whose near edge crosses d 0 at the lip + `edge` m.
 */

const LIP = 403.5;

function draft(edge: number): LevelDef {
  const half = 8;
  // Centre line crossing d 0 at LIP + edge + half / cos(θ) (θ: its angle off the d axis).
  const c0 = LIP + edge + half / Math.cos(Math.atan2(20, 240));
  const crevasse: TerrainFeature = {
    type: 'ravine',
    points: [
      { s: c0 - 10, d: -120 },
      { s: c0 + 10, d: 120 },
    ],
    width: 2 * half,
    depth: 12,
  };
  return {
    id: `kicker-relief-${edge}`,
    index: 0,
    name: 'kicker relief draft',
    subtitle: '',
    seed: 5501,
    bounds: { minX: -240, maxX: 240, minZ: -120, maxZ: 800 },
    cellSize: 2.5,
    seaLevel: 0,
    course: [
      { x: 0, z: 0, floor: 230.3, halfWidth: 50 },
      { x: 0, z: 60, floor: 222.9, halfWidth: 120 },
      { x: 0, z: 160, floor: 207.2, halfWidth: 160 },
      { x: 0, z: 440, floor: 170.8, halfWidth: 160 },
      { x: 0, z: 640, floor: 149.7, halfWidth: 160 },
      { x: 0, z: 790, floor: 2, halfWidth: 160 },
    ],
    cliffs: [{ s: 392, drop: 12, d: -90, width: 70 }],
    wallHeight: 40,
    wallRamp: 30,
    startS: 30,
    coastS: 760,
    finishS: 780,
    theme: 'alpine',
    relief: { roll: 3, rollScale: 160, gullies: 2.5, gullySpacing: 50 },
    features: [crevasse, { type: 'ramp', s: LIP, d: 0, width: 14, length: 14, height: 3.5 }],
    obstacles: [],
    decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
  };
}

const NONE = { steer: 0, source: 'none' } as const;

/** On the ground at course (s, d) moving straight down-course at `speed`. */
function place(t: GeneratedTerrain, s: number, d: number, speed: number): IcebergState {
  const ice = createIceberg(t, P);
  const w = t.course.toWorld(s, d);
  const c = t.course.sampleAt(s);
  ice.pos.x = w.x;
  ice.pos.y = w.y;
  ice.pos.z = w.z;
  ice.vel.x = c.dirX * speed;
  ice.vel.z = c.dirZ * speed;
  ice.heading = Math.atan2(ice.vel.x, ice.vel.z);
  return ice;
}

interface Run {
  airborne: { s: number; speed: number }[];
  landed: { s: number; y: number; ground: number; speed: number }[];
  /** Deepest the iceberg ever was under the ground (m, ≥ 0). */
  under: number;
  endS: number;
  endSpeed: number;
}

function run(t: GeneratedTerrain, ice: IcebergState, seconds: number): Run {
  const out: Run = { airborne: [], landed: [], under: 0, endS: 0, endSpeed: 0 };
  for (let i = 0; i < seconds * 60; i++) {
    for (const e of stepIceberg(ice, NONE, t, 1 / 60, P, 100 + i / 60)) {
      const s = t.course.project(e.pos.x, e.pos.z).s;
      if (e.type === 'airborne') out.airborne.push({ s, speed: e.speed });
      if (e.type === 'landed') {
        out.landed.push({ s, y: e.pos.y, ground: t.heightAt(e.pos.x, e.pos.z), speed: e.speed });
      }
    }
    out.under = Math.max(out.under, t.heightAt(ice.pos.x, ice.pos.z) - ice.pos.y);
  }
  out.endS = t.course.project(ice.pos.x, ice.pos.z).s;
  out.endSpeed = Math.hypot(ice.vel.x, ice.vel.z);
  return out;
}

describe('a kicker on a relief slope at a crevasse edge (Glacier Avalanche draft)', () => {
  const edges = [-0.6, -0.3, 0, 0.2, 1, 1.5];
  const terrains = new Map(edges.map((e) => [e, createTerrain(draft(e))]));

  it('meets the ground at its toe without a step (relief fades in around a ramp)', () => {
    // Before: the relief stopped dead at the toe (s 389.5), a 0.55 m step up within one cell: the
    // grid's slope jumped from −0.31 to +0.22 there.
    const t = terrains.get(0)!;
    let worst = 0;
    const slope = (s: number): number => (t.course.toWorld(s + 2.5, 0).y - t.course.toWorld(s, 0).y) / 2.5;
    for (let s = 360; s < LIP - 5; s += 2.5) worst = Math.max(worst, Math.abs(slope(s + 2.5) - slope(s)));
    expect(worst).toBeLessThan(0.15);
  });

  it('keeps its whole face where the crevasse reaches the lip (the cut never eats a ramp face)', () => {
    const ref = terrains.get(1.5)!.kickers[0];
    const mid = Math.floor(ref.height.length / 2);
    for (const edge of edges) {
      const t = terrains.get(edge)!;
      const k = t.kickers[0];
      for (const i of [1, mid, k.height.length - 2]) {
        expect(k.height[i], `edge ${edge}`).toBeCloseTo(ref.height[i], 1);
        expect(k.slope[i], `edge ${edge}`).toBeCloseTo(ref.slope[i], 1);
      }
      // No grid vertex on the face is cut: the cut starts at the lip line.
      const g = t.grid;
      let worst = 0;
      for (let iz = 0; iz < g.rows; iz++) {
        const z = g.originZ + iz * g.cellSize;
        if (z < LIP - 14 || z > LIP) continue;
        for (let ix = 0; ix < g.cols; ix++) {
          const x = g.originX + ix * g.cellSize;
          if (Math.abs(x) < 7) worst = Math.max(worst, t.cut![iz * g.cols + ix]);
        }
      }
      expect(worst, `edge ${edge}`).toBe(0);
    }
  });

  it('launches a 12 m/s iceberg once, at the lip, clear over the crevasse wherever its edge is', () => {
    // Before: airborne off the toe step at s 390.2, down on the face at s 400.8 (15 m/s), then
    // y 68.8 m on a ground of 173.1 at 0.45 m/s (edges −0.6 and −0.3); with edges 0–1.5 it flew
    // off the lip at 14.6 m/s after that first hop.
    for (const edge of edges) {
      const t = terrains.get(edge)!;
      const r = run(t, place(t, 380, 0, 12), 6);
      const why = `edge ${edge}: ${JSON.stringify(r.airborne)} ${JSON.stringify(r.landed)}`;
      expect(r.airborne.length, why).toBeGreaterThan(0);
      expect(r.airborne[0].s, why).toBeGreaterThan(LIP - 0.01);
      expect(r.airborne[0].s, why).toBeLessThan(LIP + 0.5);
      expect(r.airborne[0].speed, why).toBeGreaterThan(12.5);
      // It lands past the crevasse (far edge ≈ LIP + edge + 16 on d 0) and runs on.
      expect(r.landed[0].s, why).toBeGreaterThan(LIP + edge + 17);
      expect(r.under, why).toBeLessThan(0.3);
      expect(r.endS, why).toBeGreaterThan(460);
      expect(r.endSpeed, why).toBeGreaterThan(15);
    }
  });

  it('lands an iceberg coming down on the last metres of the face on the exact face, at speed', () => {
    const t = terrains.get(0)!;
    const k = t.kickers[0];
    const mid = Math.floor(k.height.length / 2);
    for (const short of [3, 1.5, 0.5]) {
      // Just above the exact face `short` m before the lip, flying on at 15 m/s.
      const ice = place(t, LIP - short, 0, 15);
      const a = -short;
      ice.pos.y = k.height[mid] + k.slope[mid] * a + 0.5 * k.curve[mid] * a * a + 0.05;
      ice.vel.y = -2;
      ice.grounded = false;
      const r = run(t, ice, 4);
      const first = r.landed[0];
      const why = `${short} m short: ${JSON.stringify(r.airborne)} ${JSON.stringify(r.landed)}`;
      // Touched down on the face (at or above the grid there), then took off at the lip.
      expect(first.s, why).toBeLessThan(LIP);
      expect(first.y, why).toBeGreaterThan(first.ground - 0.01);
      expect(r.airborne[0].s, why).toBeGreaterThan(LIP - 0.01);
      expect(r.airborne[0].speed, why).toBeGreaterThan(14);
      expect(r.under, why).toBeLessThan(0.3);
      expect(r.endSpeed, why).toBeGreaterThan(15);
    }
  });

  it('is flagged by levelWarnings: on the band’s spread slope, its face in the crevasse', () => {
    const near = levelWarnings(terrains.get(-0.6)!).map((w) => w.problem);
    expect(near.some((p) => /spread slope .* up to 0\.(1[5-9]|2)\d steeper/.test(p))).toBe(true);
    expect(near.some((p) => /reaches into the ravine \(feature 0\)/.test(p))).toBe(true);
    const clear = levelWarnings(terrains.get(1.5)!).map((w) => w.problem);
    expect(clear.some((p) => /reaches into/.test(p))).toBe(false);
    expect(clear.some((p) => /no exact take-off/.test(p))).toBe(false);
  });

  it('never takes an iceberg under the ground, even on a mis-fitted kicker profile', () => {
    // The profile the crevasse used to leave (lip 6 m low, face plunging): riding it put the
    // iceberg 104 m under the ground at 0.45 m/s. Now the face is checked against the grid.
    const t = terrains.get(0)!;
    const k = t.kickers[0];
    const n = k.height.length;
    const bad: KickerLip = {
      ...k,
      height: k.height.map((h) => h - 6.3),
      slope: Array(n).fill(-24.4),
      curve: Array(n).fill(-44.6),
      drop: Array(n).fill(-5.9),
    };
    const broken = { ...t, kickers: [bad] } as GeneratedTerrain;
    const ice = place(broken, 398, 0, 15);
    const r = run(broken, ice, 3);
    expect(r.under).toBeLessThan(0.3);
    expect(r.endSpeed).toBeGreaterThan(10);
    expect(alongLip(k, ice.pos.x, ice.pos.z)).toBeGreaterThan(10);
  });
});
