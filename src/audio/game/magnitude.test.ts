import { describe, expect, it } from 'vitest';
import type { ObstacleKind } from '../../core/types';
import { BREAK_LEVELS, COLLISION_MAG, EVENT_MAG, KIND_SOUNDS, type SoundId } from '../contract';
import {
  absorbLevelDb,
  breakLevelDb,
  breakM,
  chipLevelDb,
  collisionM,
  hitLevelDb,
  hitLowpassHz,
  hitRate,
  hitSound,
  isQuietHit,
  knocksLoose,
  landingLevelDb,
  landingM,
  oceanLevelDb,
  plungeLevelDb,
  splashLevelDb,
  splashSound,
  stoneM,
  tumbleRate,
  wallLevelDb,
  wallM,
  weightLevelDb,
} from './magnitude';

describe('collision magnitude (DESIGN §6.2 worked table)', () => {
  const rows: [string, ObstacleKind, number, number, number, number][] = [
    // name, kind, J, v, m, peak dBFS
    ['roll-back tap', 'rockSmall', 2, 2, 0.12, -34.9],
    ['small rock', 'rockSmall', 10, 10, 0.32, -29.6],
    ['pine holds', 'pine', 23, 10, 0.43, -27.9],
    ['house holds', 'house', 160, 15, 0.67, -20.6],
    ['church nave holds', 'church', 340, 15, 0.75, -18.6],
    ['dam monolith holds', 'dam', 770, 12, 0.8, -17.2],
    ['boulder in the Ravine Run narrows', 'boulder', 480, 32, 0.88, -15.0],
    ['cooling tower holds', 'coolingTower', 1460, 15, 0.9, -14.7],
  ];
  for (const [name, kind, J, v, m, db] of rows) {
    it(`${name}: m ${m}, ${db} dBFS`, () => {
      const got = collisionM(J, v);
      expect(got).toBeCloseTo(m, 1);
      expect(Math.abs(got - m)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(hitLevelDb(hitSound(kind, got), got) - db)).toBeLessThanOrEqual(0.2);
    });
  }

  it('is monotonic in the impulse and in the closing speed, and clamped to 0..1', () => {
    let prev = -1;
    for (let J = 0; J <= 4000; J += 25) {
      const m = collisionM(J, 10);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
    prev = -1;
    for (let v = 0; v <= 60; v += 0.5) {
      const m = collisionM(100, v);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
    expect(collisionM(1e9, 1e9)).toBe(1);
    expect(collisionM(-5, Number.NaN)).toBe(0);
  });

  it('counts the closing speed only as far as the contact moved momentum (S4, 2026-10-22)', () => {
    // A light fence brushed at 25 m/s moving almost no momentum (J 0.4) is silent, and a grazed chalet
    // (J 2.1 at 25 m/s) sits under a car pushed hard (J 19 at 12 m/s); from J 20 up the speed counts fully.
    expect(isQuietHit(collisionM(0.4, 25.4))).toBe(true);
    expect(collisionM(2.1, 25.2)).toBeLessThan(collisionM(19.3, 12));
    expect(collisionM(30, 25) - collisionM(30, 0)).toBeCloseTo(COLLISION_MAG.wV, 6);
    expect(collisionM(4.6, 7.1)).toBeLessThan(collisionM(4.6, 25));
  });

  it('below 0.08 is silent; a light tap is quiet but audible', () => {
    expect(isQuietHit(collisionM(0.1, 0.2))).toBe(true);
    expect(isQuietHit(COLLISION_MAG.silentBelow - 1e-6)).toBe(true);
    expect(isQuietHit(collisionM(2, 2))).toBe(false);
  });

  it('heavier hits sound lower and brighter, and gain weight above 0.55', () => {
    expect(hitRate(0.9)).toBeLessThan(hitRate(0.2));
    expect(hitLowpassHz(0.9)).toBeGreaterThan(hitLowpassHz(0.2));
    expect(weightLevelDb(0.5)).toBeNull();
    expect(weightLevelDb(1)).toBeCloseTo(-14, 5);
    expect(weightLevelDb(0.7)!).toBeLessThan(weightLevelDb(0.9)!);
  });

  it('rocks change to the heavy hit at 0.55; kinds without a heavy variant keep theirs', () => {
    expect(hitSound('rockMedium', 0.54)).toBe('hit.stone.light');
    expect(hitSound('rockMedium', 0.55)).toBe('hit.stone.heavy');
    expect(hitSound('house', 0.95)).toBe('hit.masonry');
    expect(hitSound('pipeline', 0.6)).toBe('hit.metal.heavy');
  });
});

describe('break magnitude (DESIGN §6.2 worked table)', () => {
  const rows: [string, SoundId, number, number, number, number][] = [
    // name, sound, massT, mHit, M, peak dBFS
    ['fence segment', 'timber.break.light', 0.08, 0.25, 0.09, -22.9],
    // The trees, log piles and stones were raised after the playtest of 2026-10-23 (they were not heard;
    // the pine was -17.0 dBFS): about 3 LU under a house collapse, never above it (recipes.test.ts).
    ['pine felled', 'tree.fall.pine', 2, 0.43, 0.28, -15.5],
    ['log pile collapsing', 'logs.tumble', 4.4, 0.5, 0.39, -15.9],
    ['truck', 'metal.break.vehicle', 8, 0.6, 0.49, -16.8],
    ['house', 'house.collapse', 12, 0.67, 0.56, -14.0],
    ['pass chapel nave (scale 0.6)', 'masonry.collapse.large', 4.75, 0.6, 0.42, -15.6],
    ['church nave', 'masonry.collapse.large', 22, 0.75, 0.66, -12.7],
    ['factory hall', 'metal.break.structure', 55, 0.8, 0.8, -11.2],
    ['apartment block', 'masonry.collapse.large', 110, 0.85, 0.91, -9.7],
    ['cooling tower', 'masonry.collapse.large', 120, 0.9, 0.94, -9.4],
    ['dam monolith', 'dam.break', 97, 0.8, 0.88, -9.0],
  ];
  for (const [name, sound, mass, mHit, M, db] of rows) {
    it(`${name}: M ${M}, ${db} dBFS`, () => {
      const got = breakM(mass, mHit);
      expect(Math.abs(got - M)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(breakLevelDb(sound, got) - db)).toBeLessThanOrEqual(0.2);
    });
  }

  // The stones (F6, F6b) take M = stoneM, the hit weighing most (review of 2026-10-24: with the break
  // weights a boulder tumbled at its ceiling however lightly it was knocked). Their typical levels kept.
  const stones: [string, SoundId, number, number, number, number][] = [
    // name, sound, massT, mHit, M, peak dBFS
    ['stone barrier breaking apart (one 7.5 t stone)', 'stone.scatter', 7.5, 0.62, 0.6, -16.4],
    ['rock of 4 t tumbling', 'stone.tumble', 4, 0.45, 0.44, -14.4],
    ['small rock tumbling', 'stone.tumble', 0.8, 0.3, 0.28, -17.8],
    ['boulder nudged at its knock (22 t, m 0.34)', 'stone.tumble', 22, 0.34, 0.37, -15.9],
    ['boulder struck (at its ceiling)', 'stone.tumble', 22, 0.65, 0.65, -14.0],
  ];
  for (const [name, sound, mass, mHit, M, db] of stones) {
    it(`${name}: M ${M}, ${db} dBFS`, () => {
      const got = stoneM(mass, mHit);
      expect(Math.abs(got - M)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(breakLevelDb(sound, got) - db)).toBeLessThanOrEqual(0.2);
    });
  }

  it('a knocked rock is heard by its knock: every size rises with the hit, 3.5 dB or more before its ceiling', () => {
    // Across the hits a rock can be knocked moving at (m from 0.2, the threshold, to a full strike), the
    // tumble never falls as m grows, rises strictly until its ceiling, and starts well under it. Before
    // (M = 0.7·W + 0.3·m), a 22 t boulder and an 8 t cluster sat at the ceiling from the first knock.
    const ceil = BREAK_LEVELS['stone.tumble']?.ceil ?? 0;
    for (const mass of [0.8, 2, 4, 6, 8, 22]) {
      let prev = -Infinity;
      for (let m = 0.2; m <= 1.0001; m += 0.05) {
        const db = breakLevelDb('stone.tumble', stoneM(mass, m));
        if (prev < ceil) expect(db, `${mass} t at m ${m.toFixed(2)}`).toBeGreaterThan(prev);
        else expect(db).toBe(ceil);
        prev = db;
      }
      expect(ceil - breakLevelDb('stone.tumble', stoneM(mass, 0.2)), `${mass} t at the threshold`).toBeGreaterThanOrEqual(3.5);
      expect(breakLevelDb('stone.tumble', stoneM(mass, 1)), `${mass} t struck`).toBe(ceil);
    }
    // The integrator's trace (a boulder knocked at m 0.34 and at m 0.71): one level before, now about 2 dB apart.
    expect(breakLevelDb('stone.tumble', stoneM(22, 0.71)) - breakLevelDb('stone.tumble', stoneM(22, 0.34))).toBeGreaterThan(1.8);
    // A stone barrier breaking apart follows its hit too, from scatterFrom to its ceiling.
    const scatter = (m: number): number => breakLevelDb('stone.scatter', stoneM(7.5, m));
    expect(scatter(0.62) - scatter(EVENT_MAG.scatterFrom)).toBeGreaterThan(2.5);
  });

  it('levels rise strictly with the broken mass at a fixed hit (within the ±12/+4 dB clamp)', () => {
    const ceiling = (s: SoundId): number => breakLevelDb(s, 1);
    for (const sound of ['house.collapse', 'masonry.collapse.large', 'dam.break', 'tree.fall.pine'] as const) {
      let prev = -Infinity;
      for (const mass of [0.5, 2, 5, 12, 30, 60, 120]) {
        const db = breakLevelDb(sound, breakM(mass, 0.5));
        if (prev === ceiling(sound)) expect(db, `${sound} ${mass} t`).toBe(prev);
        else expect(db, `${sound} ${mass} t`).toBeGreaterThan(prev);
        prev = db;
      }
    }
  });

  it('trees, log piles and stones are never asked for above their ceiling, whatever the mass or the hit', () => {
    for (const sound of ['tree.fall.pine', 'tree.fall.broadleaf', 'logs.tumble', 'stone.scatter', 'stone.tumble'] as const) {
      const ceil = BREAK_LEVELS[sound]?.ceil;
      expect(ceil, sound).toBeDefined();
      const M = sound.startsWith('stone.') ? stoneM : breakM;
      for (const mass of [0.5, 2, 5, 22, 150, 1000]) for (const mHit of [0, 0.5, 1]) expect(breakLevelDb(sound, M(mass, mHit))).toBeLessThanOrEqual(ceil!);
      expect(breakLevelDb(sound, 1)).toBe(ceil);
    }
  });

  it('a rock tumbles higher the smaller it is; only a real knock that moves it tumbles', () => {
    expect(tumbleRate(0.8)).toBeGreaterThan(tumbleRate(4));
    expect(tumbleRate(4)).toBeGreaterThan(tumbleRate(22));
    expect(knocksLoose(collisionM(5, 7), 5, 0.8)).toBe(true);
    expect(knocksLoose(collisionM(10, 2), 10, 22)).toBe(false); // 0.45 m/s: a nudge
    expect(knocksLoose(collisionM(2, 1), 2, 0.8)).toBe(false); // m < 0.2: a graze
    expect(knocksLoose(0.5, 30, 0)).toBe(false); // no body to ask
  });

  it('a light tap sits about 20 dB under a house collapse and 26 dB under a dam break', () => {
    const tap = hitLevelDb('hit.stone.light', collisionM(2, 2));
    expect(breakLevelDb('house.collapse', breakM(12, 0.67)) - tap).toBeGreaterThan(19.5);
    expect(breakLevelDb('dam.break', breakM(97, 0.8)) - tap).toBeGreaterThan(25);
  });

  it('every break sound of every kind has a level', () => {
    for (const k of Object.values(KIND_SOUNDS)) {
      if (k.brk !== null) expect(Number.isFinite(breakLevelDb(k.brk, 0.5))).toBe(true);
    }
  });
});

describe('the other events', () => {
  it('landing: monotonic in mass × drop, silent under 0.4 m, the worked examples', () => {
    expect(landingM(30, 1)).toBeCloseTo(0.39, 2);
    expect(landingM(30, 6)).toBeCloseTo(0.6, 2);
    expect(landingM(220, 30)).toBe(1);
    expect(landingM(30, EVENT_MAG.landMinDrop - 0.01)).toBe(0);
    let prev = -1;
    for (let d = 0.4; d < 40; d += 0.5) {
      const m = landingM(30, d);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
    expect(landingLevelDb(1)).toBe(-14);
  });

  it('plunge, splash, chip, absorb, wall and ocean levels stay in their ranges', () => {
    expect(plungeLevelDb(30)).toBeCloseTo(-13, 5);
    expect(plungeLevelDb(0)).toBeLessThan(plungeLevelDb(12));
    expect(splashSound(0.2)).toBe('splash.small');
    expect(splashSound(0.5)).toBe('splash.medium');
    expect(splashSound(0.9)).toBe('splash.large');
    expect(splashLevelDb(0)).toBe(-34);
    expect(splashLevelDb(1)).toBe(-16);
    expect(chipLevelDb(1)).toBe(-30);
    expect(chipLevelDb(0)).toBe(-38);
    expect(absorbLevelDb(25)).toBeCloseTo(-24, 5);
    expect(absorbLevelDb(0.5)).toBeLessThan(absorbLevelDb(10));
    expect(wallM(0.05)).toBeLessThan(0);
    expect(wallLevelDb(wallM(1.02))).toBeCloseTo(-20, 5);
    expect(oceanLevelDb(30)).toBe(-15);
    expect(oceanLevelDb(300)).toBe(-12);
    expect(oceanLevelDb(1)).toBe(-18);
  });
});
