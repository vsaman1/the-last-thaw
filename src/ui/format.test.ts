import { describe, expect, it } from 'vitest';
import { LEVELS } from '../core/levels';
import type { LevelDef } from '../core/types';
import { emptyProgress, recordCompletion } from '../state/progress';
import { levelLabel, pickPlayLevel } from './actions';
import { compareWithBest } from './game/Panels';
import { coastFraction } from './game/Hud';
import {
  formatDistance,
  formatIcePercent,
  formatInt,
  formatMass,
  formatPercent,
  formatTime,
  iceFlashSpeech,
  iceFlashText,
  levelNumber,
  toKmh,
} from './format';

describe('formatTime (m:ss.s)', () => {
  it('formats and rounds to tenths', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(5.04)).toBe('0:05.0');
    expect(formatTime(83.46)).toBe('1:23.5');
    expect(formatTime(59.96)).toBe('1:00.0');
    expect(formatTime(600)).toBe('10:00.0');
  });

  it('never shows negative or NaN', () => {
    expect(formatTime(-3)).toBe('0:00.0');
    expect(formatTime(Number.NaN)).toBe('0:00.0');
  });
});

describe('number formatting', () => {
  it('groups thousands', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1000)).toBe('1,000');
    expect(formatInt(1234567.6)).toBe('1,234,568');
    expect(formatInt(-4321)).toBe('-4,321');
    expect(formatDistance(612.4)).toBe('612 m');
  });

  it('km/h and percent', () => {
    expect(toKmh(10)).toBe(36);
    expect(toKmh(-1)).toBe(0);
    expect(formatPercent(0.426)).toBe('42%');
    expect(formatPercent(0.996)).toBe('99%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(2)).toBe('100%');
    expect(levelNumber(1)).toBe('01');
  });

  it('ice percent can go past 100% once the iceberg grows', () => {
    expect(formatIcePercent(0.426)).toBe('42%');
    expect(formatIcePercent(1)).toBe('100%');
    expect(formatIcePercent(1.004)).toBe('100%');
    expect(formatIcePercent(1.6)).toBe('160%');
    expect(formatIcePercent(5.999)).toBe('599%');
    expect(formatIcePercent(-1)).toBe('0%');
    expect(formatIcePercent(Number.NaN)).toBe('0%');
  });

  it('masses in tonnes: whole tonnes from 10 t, one decimal below', () => {
    expect(formatMass(30)).toBe('30 t');
    expect(formatMass(29.6)).toBe('30 t');
    expect(formatMass(1234.4)).toBe('1,234 t');
    expect(formatMass(9.46)).toBe('9.5 t');
    expect(formatMass(-3)).toBe('0.0 t');
    expect(formatMass(Number.NaN)).toBe('0.0 t');
  });
});

describe('ice flash text', () => {
  it('chips read as a lost percentage, absorbs as gained tonnes (true minus sign)', () => {
    expect(iceFlashText({ kind: 'chip', amount: 0.08, id: 1 })).toBe('−8% ice');
    expect(iceFlashText({ kind: 'chip', amount: 0.004, id: 1 })).toBe('−0.4% ice');
    expect(iceFlashText({ kind: 'chip', amount: 0.00001, id: 1 })).toBe('−0.1% ice');
    expect(iceFlashText({ kind: 'absorb', amount: 12.3, id: 2 })).toBe('+12 t ice');
    expect(iceFlashText({ kind: 'absorb', amount: 2.46, id: 2 })).toBe('+2.5 t ice');
  });

  it('has a spoken form for the live region', () => {
    expect(iceFlashSpeech({ kind: 'chip', amount: 0.08, id: 1 })).toBe('Ice broke off: 8% lost.');
    expect(iceFlashSpeech({ kind: 'absorb', amount: 12.3, id: 2 })).toBe(
      'Absorbed 12 tonnes of glacier ice.',
    );
  });
});

describe('menu logic', () => {
  const lv = (id: string, index: number): LevelDef => ({ id, index, name: id }) as LevelDef;
  const levels = [lv('two', 2), lv('one', 1), lv('three', 3)];
  const done = (id: string) => ({
    levelId: id,
    time: 60,
    score: 100,
    distance: 1,
    topSpeed: 1,
    knockedDown: 0,
    buildingsDestroyed: 0,
    treesFelled: 0,
    waterfallsCrossed: 0,
    collisions: 0,
    iceLeft: 1,
    absorbed: 0,
    peakMass: 30,
  });

  it('Play picks the first unlocked level that is not completed, else level 1', () => {
    let p = emptyProgress();
    expect(pickPlayLevel(levels, p)).toBe('one');
    p = recordCompletion(p, done('one'));
    expect(pickPlayLevel(levels, p)).toBe('two');
    p = recordCompletion(p, done('two'));
    p = recordCompletion(p, done('three'));
    expect(pickPlayLevel(levels, p)).toBe('one');
    expect(pickPlayLevel([], p)).toBeNull();
  });

  it('works on the real level list', () => {
    expect(pickPlayLevel(LEVELS, emptyProgress())).toBe(
      [...LEVELS].sort((a, b) => a.index - b.index)[0].id,
    );
  });

  it('labels and coast marker', () => {
    expect(levelLabel({ index: 1, name: 'Mountain Valley' })).toBe('Level 1 · Mountain Valley');
    expect(coastFraction({ startS: 20, coastS: 600, finishS: 660 })).toBeCloseTo(580 / 640, 10);
    expect(coastFraction({ startS: 0, coastS: 10, finishS: 0 })).toBe(1);
  });

  it('"New best" compares against the record from before the run', () => {
    expect(compareWithBest({ time: 70, score: 900 }, null)).toEqual({ time: true, score: true });
    const prev = { bestTime: 65, bestScore: 1000, completions: 1 };
    expect(compareWithBest({ time: 70, score: 900 }, prev)).toEqual({ time: false, score: false });
    expect(compareWithBest({ time: 60, score: 900 }, prev)).toEqual({ time: true, score: false });
    expect(compareWithBest({ time: 65, score: 1001 }, prev)).toEqual({ time: false, score: true });
  });
});
