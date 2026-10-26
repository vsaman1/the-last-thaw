import { describe, expect, it } from 'vitest';
import type { CliffDef, LevelDef, TerrainFeature } from '../types';
import { createIceberg, stepIceberg } from '../sim/iceberg';
import { DEFAULT_ICEBERG_PARAMS as P } from '../sim/params';
import { createTerrain, type GeneratedTerrain } from './terrain';

/**
 * Relief and floor bumps fade out continuously around a ramp (FEATURE_TUNING.rampClear), along the
 * slope and across it. Before, they stopped dead at the ramp's toe (the fade was lateral only): a
 * relief step there launched a fast iceberg before the lip, and Ravine Run had to drop its roll and
 * try 400 relief seeds to find calm kicker approaches.
 */

const RAMPS: Extract<TerrainFeature, { type: 'ramp' }>[] = [
  { type: 'ramp', s: 200, d: -40, width: 14, length: 14, height: 3.5 },
  { type: 'ramp', s: 330, d: 25, width: 14, length: 14, height: 3 },
  { type: 'ramp', s: 470, d: 0, width: 16, length: 14, height: 1.5 },
];

function slope(seed: number, cliffs: CliffDef[] = []): LevelDef {
  return {
    id: `ramp-apron-${seed}-${JSON.stringify(cliffs)}`,
    index: 0,
    name: 'ramp apron',
    subtitle: '',
    seed: 4000 + seed,
    bounds: { minX: -200, maxX: 200, minZ: -100, maxZ: 760 },
    cellSize: 2.5,
    seaLevel: 0,
    course: [
      { x: 0, z: 0, floor: 120, halfWidth: 50 },
      { x: 0, z: 60, floor: 112, halfWidth: 140 },
      { x: 0, z: 740, floor: 2, halfWidth: 140 },
    ],
    cliffs,
    wallHeight: 30,
    wallRamp: 25,
    startS: 30,
    coastS: 700,
    finishS: 720,
    relief: { roll: 3, rollScale: 160, gullies: 2.5, gullySpacing: 50 },
    features: RAMPS,
    obstacles: [],
    decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
  };
}

/**
 * Worst bump (m) in the grid's surface along the approach to each ramp: the change of height over
 * 2.5 m steps against the designed floor's, from 40 m before the toe to its first 5 m (the metric
 * of Ravine Run's calm-approach test, taken all along the approach and at three offsets).
 */
function worstStep(t: GeneratedTerrain): number {
  let worst = 0;
  for (const k of RAMPS) {
    const toe = k.s - k.length;
    for (const dd of [-5, 0, 5]) {
      const d = k.d + dd;
      let prev = NaN;
      for (let s = toe - 40; s <= toe + 5; s += 2.5) {
        const rise = t.course.toWorld(s + 2.5, d).y - t.course.toWorld(s, d).y;
        const floor = t.course.floorAtD(s + 2.5, d) - t.course.floorAtD(s, d);
        const lift = s + 2.5 > toe ? k.height * ((s + 2.5 - toe) / k.length) ** 2 : 0;
        const liftPrev = s > toe ? k.height * ((s - toe) / k.length) ** 2 : 0;
        const step = rise - floor - (lift - liftPrev);
        // The step against the neighbouring one (relief is smooth; a step stands out).
        if (prev === prev) worst = Math.max(worst, Math.abs(step - prev));
        prev = step;
      }
    }
  }
  return worst;
}

/** s of the first take-off of an iceberg sent straight at the ramp from 60 m out at `speed`. */
function firstTakeoff(t: GeneratedTerrain, k: (typeof RAMPS)[number], speed: number): number {
  const ice = createIceberg(t, P);
  const w = t.course.toWorld(k.s - 60, k.d);
  const c = t.course.sampleAt(k.s - 60);
  ice.pos.x = w.x;
  ice.pos.y = w.y;
  ice.pos.z = w.z;
  ice.vel.x = c.dirX * speed;
  ice.vel.z = c.dirZ * speed;
  ice.heading = Math.atan2(ice.vel.x, ice.vel.z);
  for (let i = 0; i < 6 * 60; i++) {
    for (const e of stepIceberg(ice, { steer: 0, source: 'none' }, t, 1 / 60, P, 100 + i / 60)) {
      if (e.type === 'airborne') return t.course.project(e.pos.x, e.pos.z).s;
    }
  }
  return NaN;
}

describe('relief fades out around a ramp, along the slope and across it', () => {
  it('leaves no step on any kicker approach, whatever the relief seed', () => {
    // Before (main 1caf073, the same 24 seeds): this metric up to 2.41 m; Ravine Run's (rise over
    // the toe ± 2.5 m against the floor's) 0.32–4.12 m, every seed over its 0.3 m guard. Now 0.145
    // and 0.11–0.21 m (that one includes the ramp's own first 2.5 m of rise, up to 0.11 m).
    let worst = 0;
    for (let seed = 0; seed < 24; seed++) worst = Math.max(worst, worstStep(createTerrain(slope(seed))));
    expect(worst).toBeLessThan(0.2);
  });

  it('launches a fast iceberg at the lip, never off the approach', () => {
    // Before: seed 0 took off 1.8 m past the toe of the ramp at s 200 (25 m/s).
    for (let seed = 0; seed < 6; seed++) {
      const t = createTerrain(slope(seed));
      for (const k of RAMPS) {
        const s = firstTakeoff(t, k, 25);
        expect(s, `seed ${seed}, ramp at s ${k.s}`).toBeGreaterThan(k.s - 0.01);
        expect(s, `seed ${seed}, ramp at s ${k.s}`).toBeLessThan(k.s + 1);
      }
    }
  });

  it('also in a cliff band’s spread zone (the drop spread over the floor beyond its end)', () => {
    // A 12 m band 50–110 m to the side of the ramps, its lip just upstream of each face.
    const bands: CliffDef[] = RAMPS.map((k) => ({ s: k.s - 8, drop: 12, d: k.d - 80, width: 50 }));
    for (let seed = 0; seed < 6; seed++) {
      const t = createTerrain(slope(seed, bands));
      expect(worstStep(t), `seed ${seed}`).toBeLessThan(0.2);
      for (const k of RAMPS) {
        const s = firstTakeoff(t, k, 25);
        expect(s, `seed ${seed}, ramp at s ${k.s}`).toBeGreaterThan(k.s - 0.01);
        expect(s, `seed ${seed}, ramp at s ${k.s}`).toBeLessThan(k.s + 1);
      }
    }
  });
});
