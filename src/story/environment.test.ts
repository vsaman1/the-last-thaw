import { describe, expect, it } from 'vitest';
import {
  MAX_DEAD_TREES,
  TOLL_BOOST,
  TOLL_SCALE,
  WORLD_ARC,
  WORLD_PALETTE,
  actOf,
  conditionAt,
  industrialToll,
  isHealthy,
  resolveWorldCondition,
  worldCondition,
  type WorldCondition,
} from './environment';
import { sanitizeEntry } from '../state/storyStore';
import { STORY_POINTS } from './scoring';
import { CHAPTER_IDS, type ArchiveEntry, type ChapterId } from './types';

/** An Archive entry (as the store keeps it) whose run toppled `kinds`. */
function entry(chapterId: ChapterId, kinds: Record<string, number>): ArchiveEntry {
  const raw = {
    chapterId,
    completedAt: '2026-10-20T10:00:00.000Z',
    attempts: 1,
    evidence: {
      version: 1, chapterId, levelId: 'level', outcome: 'complete',
      time: 90, distance: 1000, topSpeed: 20, startMass: 100, endMass: 80, peakMass: 120, absorbed: 0, iceLeft: 0.8,
      waterfallsCrossed: 0, collisions: 10, treesFelled: 0, knockedDown: 5, buildingsDestroyed: 3, storyPoints: 1000,
      destroyedByCategory: {}, destroyedByKind: kinds, landmarks: [], notable: [], route: [], reachedS: 1000, coastS: -1,
    },
    fragmentIds: [],
    reflection: { source: 'authored', text: 'An entry.', fragmentIds: [], factIds: [] },
  };
  const e = sanitizeEntry(raw);
  if (!e) throw new Error('test entry did not sanitise');
  return e;
}

/** A player who toppled every chimney, tank and cooling tower they met, chapters 1-8. */
const HEAVY: ArchiveEntry[] = [
  entry('ch2-measurements', { logPile: 6 }),
  entry('ch4-people', { tank: 2, smokestack: 1, factoryHall: 1, pipeline: 1 }),
  entry('ch5-denial', { silo: 1, pipeline: 1, tank: 1 }),
  entry('ch6-price', { pylon: 9, factoryHall: 7, smokestack: 4, coolingTower: 4, tank: 7, pumpjack: 3, oilRig: 1 }),
  entry('ch7-escape', { pumpjack: 4, pipeline: 1 }),
  entry('ch8-remains', { silo: 2, pipeline: 1, tank: 1 }),
];

const channels = (c: WorldCondition): number[] => [
  c.grass.dry * c.grass.cover,
  c.grass.brown,
  c.trees.dead,
  c.trees.fade,
  c.water.murk,
  c.air.haze,
  c.snow.soot,
];

describe('the world across the story', () => {
  const plain = CHAPTER_IDS.map((id) => worldCondition(id, []));

  it('Act I is the world as it was: healthy, nothing changed', () => {
    for (const c of plain.slice(0, 3)) {
      expect(c.act).toBe(1);
      expect(isHealthy(c)).toBe(true);
      expect(channels(c).every((v) => v === 0)).toBe(true);
    }
  });

  it('Act II shows first signs only: dry patches, light haze, slightly murkier water, no dead trees', () => {
    for (const c of plain.slice(3, 6)) {
      expect(c.act).toBe(2);
      expect(isHealthy(c)).toBe(false);
      expect(c.grass.cover).toBeGreaterThan(0.25);
      expect(c.grass.cover).toBeLessThan(0.7); // in places, not everywhere
      expect(c.grass.brown).toBe(0); // yellowing, not yet brown
      expect(c.trees.dead).toBe(0);
      expect(c.water.murk).toBeGreaterThan(0.15);
      expect(c.water.murk).toBeLessThan(0.55);
      expect(c.air.haze).toBeGreaterThan(0.25);
      expect(c.air.haze).toBeLessThan(0.55);
    }
  });

  it('Act III is clearly worn: brown grass everywhere, dead trees among the living, a brown river, thick haze', () => {
    for (const c of plain.slice(6)) {
      expect(c.act).toBe(3);
      expect(c.grass.cover).toBeGreaterThan(0.85);
      expect(c.grass.dry).toBeGreaterThan(0.85);
      expect(c.grass.brown).toBeGreaterThan(0.35);
      expect(c.trees.dead).toBeGreaterThan(0.1);
      expect(c.trees.dead).toBeLessThan(0.5); // among living ones, never a dead forest
      expect(c.water.murk).toBeGreaterThan(0.8);
      expect(c.air.haze).toBeGreaterThan(0.65);
    }
  });

  it('never gets better from one chapter to the next', () => {
    for (let i = 1; i < plain.length; i++) {
      expect(plain[i].severity).toBeGreaterThanOrEqual(plain[i - 1].severity);
      const a = channels(plain[i - 1]);
      channels(plain[i]).forEach((v, k) => expect(v).toBeGreaterThanOrEqual(a[k]));
    }
  });

  it('keeps every channel in range at any severity', () => {
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const c = conditionAt('ch9-last-thaw', 3, s, 0, 0);
      for (const v of [c.grass.dry, c.grass.cover, c.grass.brown, c.water.murk, c.air.haze]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(c.trees.dead).toBeLessThanOrEqual(MAX_DEAD_TREES);
      expect(c.trees.fade).toBeLessThanOrEqual(0.6);
      expect(c.snow.soot).toBeLessThanOrEqual(0.6);
    }
  });

  it('acts follow chapter order', () => {
    expect(CHAPTER_IDS.map(actOf)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(Object.keys(WORLD_ARC)).toEqual([...CHAPTER_IDS]);
  });

  it('has a palette of valid colours', () => {
    for (const hex of Object.values(WORLD_PALETTE)) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("the player's own record", () => {
  it('counts extraction, industry and energy toppled in earlier chapters, by their harm weights', () => {
    const archive = [entry('ch6-price', { coolingTower: 2, tank: 1, house: 5, church: 1, pine: 9, dam: 1 })];
    expect(industrialToll('ch7-escape', archive)).toBe(2 * STORY_POINTS.coolingTower + STORY_POINTS.tank);
  });

  it('never counts the chapter itself or a later one (replaying cannot change its own world)', () => {
    const archive = [entry('ch6-price', { coolingTower: 4 }), entry('ch8-remains', { oilRig: 1 })];
    expect(industrialToll('ch6-price', archive)).toBe(0);
    expect(industrialToll('ch7-escape', archive)).toBe(4 * STORY_POINTS.coolingTower);
    expect(worldCondition('ch6-price', archive)).toEqual(worldCondition('ch6-price', []));
  });

  it('makes the world worse, within limits', () => {
    for (const id of CHAPTER_IDS.slice(3)) {
      const plain = worldCondition(id, []);
      const heavy = worldCondition(id, HEAVY);
      expect(heavy.severity).toBeGreaterThanOrEqual(plain.severity);
      expect(heavy.severity).toBeLessThanOrEqual(Math.min(1, plain.arc + TOLL_BOOST[plain.act]) + 1e-12);
      const a = channels(plain);
      channels(heavy).forEach((v, k) => expect(v).toBeGreaterThanOrEqual(a[k]));
    }
    // From chapter 7 on, a heavy record is clearly visible: more dead trees, browner, hazier.
    const plain8 = worldCondition('ch8-remains', []);
    const heavy8 = worldCondition('ch8-remains', HEAVY);
    expect(heavy8.toll).toBeGreaterThan(0.95);
    expect(heavy8.trees.dead).toBeGreaterThan(plain8.trees.dead + 0.1);
    expect(heavy8.grass.brown).toBeGreaterThan(plain8.grass.brown + 0.2);
    expect(heavy8.air.haze).toBeGreaterThan(plain8.air.haze + 0.15);
  });

  it('saturates: twice the toppling is not twice the effect', () => {
    const one = worldCondition('ch8-remains', [entry('ch6-price', { coolingTower: 9 })]);
    const two = worldCondition('ch8-remains', [entry('ch6-price', { coolingTower: 18 })]);
    expect(one.toll).toBeCloseTo(1 - Math.exp(-(9 * STORY_POINTS.coolingTower) / TOLL_SCALE), 12);
    expect(two.severity - one.severity).toBeLessThan(one.severity - worldCondition('ch8-remains', []).severity);
  });

  it('leaves Act I all but healthy whatever was toppled', () => {
    const c = worldCondition('ch3-warning', [entry('ch2-measurements', { oilRig: 50 })]);
    expect(c.severity).toBeLessThanOrEqual(TOLL_BOOST[1]);
    expect(c.grass.cover).toBe(0);
    expect(c.trees.dead).toBe(0);
  });
});

describe('the ?world= override (debugging and side-by-side checks)', () => {
  it("'off' is no condition; nothing or anything unknown is the chapter's own world", () => {
    expect(resolveWorldCondition('ch8-remains', [], '?world=off')).toBeNull();
    expect(resolveWorldCondition('ch8-remains', [], '')).toEqual(worldCondition('ch8-remains', []));
    expect(resolveWorldCondition('ch8-remains', [], '?world=banana')).toEqual(worldCondition('ch8-remains', []));
  });

  it("a chapter number or id shows that chapter's arc on this chapter's level, with the player's record", () => {
    const asCh1 = resolveWorldCondition('ch8-remains', [], '?world=1');
    expect(asCh1 && isHealthy(asCh1)).toBe(true);
    const asCh5 = resolveWorldCondition('ch8-remains', HEAVY, '?world=ch5-denial');
    expect(asCh5?.chapterId).toBe('ch8-remains');
    expect(asCh5?.arc).toBe(WORLD_ARC['ch5-denial']);
    expect(asCh5?.toll).toBe(worldCondition('ch8-remains', HEAVY).toll);
  });
});
