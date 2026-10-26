import { describe, expect, it } from 'vitest';
import { getTerrain } from '../../core/session';
import { getLevel } from '../../core/levels';
import { PAINT } from '../../core/terrain/features';
import type { GameRuntime } from '../../core/runtime';
import type { RiverSample } from '../../core/types';
import { LEVEL_WIND } from '../contract';
import {
  AmbienceInputs,
  WallDetector,
  groundOf,
  oceanProximity,
  riverLevel,
  scrapeCentreHz,
  scrapeDrive,
  waterLoudness,
} from './ambienceInputs';
import { createListenerPose } from '../spatial';
import { RecordingAmbience } from './testing/recording';
import { iceberg } from './testing/world';

describe('the scrape (DESIGN §7.2)', () => {
  it('is silent below 0.8 m/s and whenever the iceberg is not on land', () => {
    expect(scrapeDrive(0.79, 30, true)).toBe(0);
    expect(scrapeDrive(20, 30, false)).toBe(0);
  });

  it('rises monotonically with speed, and with mass up to 100 t', () => {
    let prev = -1;
    for (let v = 0; v <= 40; v += 0.25) {
      const d = scrapeDrive(v, 30, true);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    expect(scrapeDrive(22, 30, true)).toBeLessThanOrEqual(1);
    expect(scrapeDrive(10, 100, true)).toBeGreaterThan(scrapeDrive(10, 30, true));
    expect(scrapeDrive(10, 300, true)).toBe(scrapeDrive(10, 100, true));
  });

  it('a bigger iceberg sounds lower, a faster one brighter', () => {
    expect(scrapeCentreHz(15, 6)).toBeLessThan(scrapeCentreHz(15, 2.2));
    expect(scrapeCentreHz(20, 2.2)).toBeGreaterThan(scrapeCentreHz(5, 2.2));
    expect(scrapeCentreHz(0, 50)).toBe(300);
    expect(scrapeCentreHz(100, 0.5)).toBe(2600);
  });

  it('the ground is the surface refined by the paint a feature left', () => {
    expect(groundOf('grass', PAINT.none)).toBe('grass');
    expect(groundOf('grass', PAINT.asphalt)).toBe('asphalt');
    expect(groundOf('rock', PAINT.gravel)).toBe('gravel');
    expect(groundOf('grass', PAINT.dirt)).toBe('dirt');
    expect(groundOf('sand', PAINT.rock)).toBe('rock');
  });
});

describe('water and sea', () => {
  it('the river level is monotonic in flow and never above 1', () => {
    let prev = -1;
    for (let u = 0; u <= 20; u += 0.5) {
      const lv = riverLevel(u, 1, u, true, u, 2);
      expect(lv).toBeGreaterThanOrEqual(prev);
      expect(lv).toBeLessThanOrEqual(1);
      prev = lv;
    }
    expect(waterLoudness(1)).toBe(0);
    expect(riverLevel(0, 0, 0, false, 10, 2)).toBe(0);
    expect(riverLevel(10, 0, 0, false, 0, 0)).toBeCloseTo(0.6 * waterLoudness(10), 9);
  });

  it('the sea is silent beyond 260 m of the coast and full at it and at sea', () => {
    expect(oceanProximity(1000, 700, false)).toBe(0);
    expect(oceanProximity(1000, 1000, false)).toBe(1);
    expect(oceanProximity(1000, 1100, false)).toBe(1);
    expect(oceanProximity(1000, 0, true)).toBe(1);
    expect(oceanProximity(1000, 870, false)).toBeGreaterThan(oceanProximity(1000, 800, false));
  });
});

describe('terrain wall hits', () => {
  it('fire on a rise of the impact flash, never on a frame with a collision or landing', () => {
    const w = new WallDetector();
    expect(w.step(0, 1 / 60, false)).toBeLessThan(0);
    expect(w.step(0.6, 1 / 60, false)).toBeGreaterThan(0);
    // Decaying normally: no hit.
    expect(w.step(0.56, 1 / 60, false)).toBeLessThan(0);
    const v = new WallDetector();
    v.step(0, 1 / 60, false);
    expect(v.step(0.8, 1 / 60, true)).toBeLessThan(0);
  });
});

describe('the poller on a real level', () => {
  const level = getLevel('mountain-valley');
  const terrain = getTerrain(level);
  const ice = iceberg({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 12 } });
  const samples: RiverSample[] = [];
  const rt = {
    level,
    terrain,
    iceberg: ice,
    water: null,
    river: { samples, version: 0, flowAt: () => null },
  } as unknown as GameRuntime;

  it('updates the scrape at 30 Hz and the rest at 10 Hz, with real inputs', () => {
    const start = terrain.course.toWorld(level.startS, 0);
    ice.pos.x = start.x;
    ice.pos.z = start.z;
    const amb = new RecordingAmbience();
    const inputs = new AmbienceInputs(rt, 'mountain-valley');
    const pose = createListenerPose();
    for (let i = 0; i < 60; i++) inputs.update(1 / 60, pose, amb);
    expect(amb.counts.scrape).toBe(30);
    expect(amb.counts.wind).toBe(10);
    expect(amb.counts.water).toBe(10);
    expect(amb.last.wind).toEqual({ amount: LEVEL_WIND['mountain-valley'], airSpeed: 0 });
    expect(amb.last.scrape).toMatchObject({ onLand: true, airborne: false, speed: 12, massT: 30 });
    expect(inputs.drive).toBeGreaterThan(0);
    // Airborne: the scrape stops and the wind rises past the ears.
    ice.grounded = false;
    for (let i = 0; i < 6; i++) inputs.update(1 / 60, pose, amb);
    expect(amb.last.scrape?.airborne).toBe(true);
    expect(inputs.drive).toBe(0);
    expect(amb.last.wind?.airSpeed).toBeCloseTo(12, 6);
    ice.grounded = true;
  });

  it('works with no voices yet (they are built once the bank is ready)', () => {
    const inputs = new AmbienceInputs(rt, 'mountain-valley');
    expect(() => inputs.update(0.2, createListenerPose(), null)).not.toThrow();
  });

  it('hears the sea from the coast and pans toward it', () => {
    const inputs = new AmbienceInputs(rt, 'mountain-valley');
    const amb = new RecordingAmbience();
    const coast = terrain.course.sampleAt(level.coastS);
    const pose = { px: coast.x, py: 0, pz: coast.z, rightX: -coast.dirZ, rightZ: coast.dirX, fwdX: coast.dirX, fwdZ: coast.dirZ };
    inputs.update(0.2, pose, amb);
    expect(amb.last.ocean?.proximity).toBeGreaterThan(0.95);
    const far = terrain.course.sampleAt(level.startS);
    inputs.update(0.2, { ...pose, px: far.x, pz: far.z }, amb);
    expect(amb.last.ocean?.proximity).toBe(0);
  });
});
