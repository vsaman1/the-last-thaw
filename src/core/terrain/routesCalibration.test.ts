import { describe, expect, it } from 'vitest';
import type { LevelDef, SteeringInput, TerrainFeature } from '../types';
import { FIXED_DT, GameSession } from '../session';
import { autopilotSteer } from '../autopilot';
import { FELL_DEPTH } from '../fall';
import { DEFAULT_ICEBERG_PARAMS as P } from '../sim/params';
import { createTerrain, type GeneratedTerrain } from './terrain';
import { analyzeRoutes, headToSpeed, speedToHead, turnSpeedKeep } from './routes';

/**
 * The route search against the sim (issues reported by the level designers): its energy model and
 * turns calibrated on real runs, U-turns out of pockets, jump landings, perches and the hull's
 * width. Straight synthetic slopes along +Z (s = z, d = −x), cellSize 2.5, nav cells 5 m.
 */

const slope = (id: string, features: TerrainFeature[], over: Partial<LevelDef> = {}): LevelDef => ({
  id,
  index: 0,
  name: id,
  subtitle: '',
  seed: 21,
  bounds: { minX: -160, maxX: 160, minZ: -80, maxZ: 900 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 100, halfWidth: 40 },
    { x: 0, z: 60, floor: 94, halfWidth: 120 },
    { x: 0, z: 880, floor: 2, halfWidth: 120 },
  ],
  cliffs: [],
  wallHeight: 30,
  wallRamp: 25,
  startS: 30,
  coastS: 840,
  finishS: 860,
  features,
  obstacles: [],
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
  ...over,
});

/** Model speed (best over headings and turn memory) at course point (s, d). */
const modelSpeed = (t: GeneratedTerrain, s: number, d: number): number => {
  const r = analyzeRoutes(t);
  const w = t.course.toWorld(s, d);
  const c = Math.round((w.z - r.originZ) / r.cell) * r.cols + Math.round((w.x - r.originX) / r.cell);
  return r.head[c] >= 0 ? headToSpeed(r.head[c]) : 0;
};

// A pocket 60 m wide and 150 m long (two 10 m wall ridges closed at the bottom) on the 0.112 slope:
// the shape of Power Valley's slag-heap pocket, which the route search used to report escapable
// (it turned round at full speed in 4 nav cells).
const POCKET: TerrainFeature[] = [
  { type: 'ridge', points: [{ s: 300, d: -30 }, { s: 450, d: -30 }], width: 8, height: 10 },
  { type: 'ridge', points: [{ s: 300, d: 30 }, { s: 450, d: 30 }], width: 8, height: 10 },
  { type: 'ridge', points: [{ s: 450, d: -30 }, { s: 450, d: 30 }], width: 8, height: 10 },
];

describe('route search calibrated on the sim', () => {
  it('turnSpeedKeep follows the measured turns (flat ground, 45°)', () => {
    expect(turnSpeedKeep(3)).toBeCloseTo(0.945, 2); // steer 0.2
    expect(turnSpeedKeep(1.8)).toBeCloseTo(0.91, 1); // steer 0.35
    expect(turnSpeedKeep(0.8)).toBeCloseTo(0.75, 1); // full lock
    // Faster than full lock: it slows to ~0.97 × the arc (m/s) to make the turn.
    expect(25 * turnSpeedKeep(6 / 25)).toBeCloseTo(0.97 * 6, 1);
  });

  it('matches an autopilot run on a clean slope (and stays above it)', async () => {
    // Before (main): the model's friction, drag and gravity already gave the run's speed within 1–4 %
    // along its own path; this pins the search's best head to within 8 % of the run.
    const level = slope('calib-clean', []);
    const session = await GameSession.create({ level, skipIntro: true });
    const t = session.terrain as GeneratedTerrain;
    const ratios: number[] = [];
    for (let n = 0; n < 60 * 40 && session.phase === 'playing'; n++) {
      session.update(FIXED_DT, autopilotSteer(session.iceberg, t));
      if (n % 30 !== 0 || n < 120) continue;
      const ice = session.iceberg;
      const p = t.course.project(ice.pos.x, ice.pos.z);
      if (p.s > 800) break;
      ratios.push(Math.hypot(ice.vel.x, ice.vel.z) / modelSpeed(t, p.s, p.d));
    }
    session.dispose();
    expect(ratios.length).toBeGreaterThan(20);
    for (const r of ratios) {
      expect(r).toBeGreaterThan(0.92);
      expect(r).toBeLessThan(1.03);
    }
  });

  it('reports a pocket an iceberg cannot U-turn out of in the sim as a dead end', async () => {
    const level = slope('calib-pocket', POCKET);
    const t = createTerrain(level);
    const r = analyzeRoutes(t);
    expect(r.solvable).toBe(true);
    const pocket = r.deadEnds.find((d) => d.s > 330 && d.s < 450 && Math.abs(d.d) < 25);
    // Before: no dead end there (the pocket looked escapable).
    expect(pocket?.cause).toBe('trap');
    // The sim: send an iceberg into the pocket at 20 m/s and turn round as hard as it can, then
    // steer for the mouth: it never gets back out above s 300.
    const session = await GameSession.create({ level, skipIntro: true });
    const ice = session.iceberg;
    const w = t.course.toWorld(320, 0);
    ice.pos.x = w.x;
    ice.pos.y = w.y;
    ice.pos.z = w.z;
    ice.vel.x = 0;
    ice.vel.z = 20;
    ice.heading = 0;
    let turned = false;
    let highest = Infinity;
    for (let n = 0; n < 60 * 30 && session.phase === 'playing'; n++) {
      if (Math.cos(ice.heading) < -0.9) turned = true;
      let steer = 1;
      if (turned) {
        // Turned round: steer for the mouth, up the slope.
        let err = Math.atan2(-ice.pos.x, 280 - ice.pos.z) - ice.heading;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        steer = Math.max(-1, Math.min(1, err * 2));
      }
      const input: SteeringInput = { steer, source: 'scripted' };
      session.update(FIXED_DT, input);
      if (turned) highest = Math.min(highest, t.course.project(ice.pos.x, ice.pos.z).s);
    }
    session.dispose();
    expect(turned).toBe(true);
    expect(highest).toBeGreaterThan(300);
  });

  it('keeps jump probes off ridge tops and the walls, and lands the whole hull past the ravine', () => {
    // A ravine across the slope with wall ridges running into it (their tops used to launch probes).
    const features: TerrainFeature[] = [
      { type: 'ravine', points: [{ s: 500, d: -130 }, { s: 500, d: 130 }], width: 14, depth: 10 },
      { type: 'ridge', points: [{ s: 420, d: -60 }, { s: 495, d: -60 }], width: 10, height: 10 },
      { type: 'ridge', points: [{ s: 420, d: 60 }, { s: 495, d: 60 }], width: 10, height: 10 },
      { type: 'ramp', s: 492.5, d: 0, width: 14, length: 14, height: 3.5 },
    ];
    const t = createTerrain(slope('calib-perch', features));
    const r = analyzeRoutes(t);
    expect(r.jumps).toBeGreaterThan(0);
    const radius = P.radius;
    for (const j of r.jumpList) {
      for (const p of [j.from, j.to]) {
        const w = t.course.toWorld(p.s, p.d);
        expect(t.wallnessAt(w.x, w.z), `${p.s},${p.d}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(p.d)).toBeLessThanOrEqual(t.course.halfWidthAt(p.s));
      }
      // Landing cells sit at least a radius past the far rim (507 m) along the flight.
      expect(j.to.s, JSON.stringify(j)).toBeGreaterThan(507 + radius - t.level.cellSize);
      expect(j.arrive).toBeGreaterThanOrEqual(0);
      const back = t.course.toWorld(j.to.s - radius, j.to.d);
      expect(t.ravineDepthAt!(back.x, back.z)).toBeLessThan(FELL_DEPTH + 8);
    }
  });

  it('keeps a big iceberg’s centre off a wall it runs at (its wall probe reach)', () => {
    // A wall ridge across the slope, its face 3.5 m beyond the nav cell at s 395 (on the grid: steep
    // between the vertices at 397.5 and 400).
    const wall: TerrainFeature[] = [
      { type: 'ridge', points: [{ s: 402.5, d: -40 }, { s: 402.5, d: 40 }], width: 8, height: 10 },
    ];
    const small = createTerrain(slope('calib-wall-1', wall));
    const big = createTerrain(slope('calib-wall-2', wall, { iceberg: { scale: 2.2, mass: 220 } }));
    // Straight at the wall, the small iceberg (probe 1.5 m ahead) reaches the cell; the big one
    // (3.4 m) bounces before it and only gets there on a slant, slower.
    const v1 = modelSpeed(small, 395, 0);
    const v2 = modelSpeed(big, 395, 0);
    expect(v1).toBeGreaterThan(10);
    expect(speedToHead(v2)).toBeLessThan(0.97 * speedToHead(v1));
  });
});
