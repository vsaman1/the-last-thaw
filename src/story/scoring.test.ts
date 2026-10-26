import { describe, expect, it } from 'vitest';
import { buildObstacleSpecs } from '../core/obstacles/spawn';
import { isSpanningKind } from '../core/obstacles/structures';
import { createAnalyticTerrain } from '../core/testing/analyticTerrain';
import type { GameEvent, ObstacleKind, ObstaclePlacement } from '../core/types';
import {
  categoryOf,
  KIND_LABEL,
  pointsGuide,
  POINTS_TIERS,
  STORY_POINTS,
  storyPointsFor,
  STRUCTURE_CATEGORY,
  tallyStoryPoints,
  type ScoredBody,
} from './scoring';

describe('story scoring', () => {
  it('every scored kind has a category and a label', () => {
    for (const k of Object.keys(STORY_POINTS)) {
      expect(STRUCTURE_CATEGORY[k as keyof typeof STRUCTURE_CATEGORY], k).toBeDefined();
      expect(KIND_LABEL[k as keyof typeof KIND_LABEL], k).toBeTruthy();
    }
    expect(Object.keys(STRUCTURE_CATEGORY).sort()).toEqual(Object.keys(STORY_POINTS).sort());
  });

  it('weighted by harm: extraction and big infrastructure above homes above fences and trees', () => {
    const p = storyPointsFor;
    for (const big of ['oilRig', 'pipeline', 'pumpjack', 'apartmentBlock', 'coolingTower', 'tank', 'dam']) {
      expect(p(big), big).toBeGreaterThan(p('house'));
      expect(p(big), big).toBeGreaterThan(p('church'));
    }
    for (const small of ['fence', 'logPile', 'pine', 'broadleaf']) {
      expect(p(small), small).toBeLessThan(p('truck'));
      expect(p(small), small).toBeGreaterThan(0);
    }
    expect(p('oilRig')).toBe(Math.max(...Object.values(STORY_POINTS)));
    expect(p('rockSmall')).toBe(0);
    expect(p('somethingNew')).toBe(0);
    expect(categoryOf('somethingNew')).toBe('other');
    expect(categoryOf('pumpjack')).toBe('extraction');
    expect(categoryOf('apartmentBlock')).toBe('home');
  });

  it('the Points guide lists every kind that topples once, with its real points, in its band, highest first', () => {
    const guide = pointsGuide();
    const entries = guide.flatMap((t) => t.entries);
    const toppling = Object.keys(STORY_POINTS).filter((k) => STORY_POINTS[k as keyof typeof STORY_POINTS] > 0);
    expect(entries.map((e) => e.kind).sort()).toEqual([...toppling].sort());
    for (const e of entries) {
      expect(e.points, e.kind).toBe(STORY_POINTS[e.kind]);
      expect(e.label, e.kind).toMatch(/^[A-Z]/);
    }
    const vals = entries.map((e) => e.points);
    expect([...vals].sort((a, b) => b - a)).toEqual(vals);
    guide.forEach(({ tier, entries: es }) => {
      const i = POINTS_TIERS.indexOf(tier);
      const above = i === 0 ? Infinity : POINTS_TIERS[i - 1].min;
      for (const e of es) expect(e.points >= tier.min && e.points < above, `${e.kind} in ${tier.title}`).toBe(true);
    });
    // Rocks, glacier ice, parked cars and stone walls never topple: not in the bands.
    for (const k of ['rockSmall', 'boulder', 'iceBlock', 'iceField', 'car', 'stoneBarrier']) {
      expect(entries.some((e) => e.kind === k), k).toBe(false);
    }
    expect(guide[0].tier.title).toBe('The big ones');
    expect(guide[0].entries[0]).toMatchObject({ kind: 'oilRig', label: 'Oil rig', points: 1000 });
  });

  it('lists only kinds that can really topple: each has a body that breaks (a finite break impulse)', () => {
    // The guide once listed "Car 80" and "Stone wall 10", but a parked car and a dry-stone wall are pushed,
    // never broken (stand 'loose' / breakSpeed Infinity), so their points could never be earned.
    const breakable = (kind: ObstacleKind): boolean => {
      const placement: ObstaclePlacement = { kind, s: 80, d: 0, ...(isSpanningKind(kind) ? { span: 24 } : {}) };
      const terrain = createAnalyticTerrain({ height: () => 5, cellSize: 2, level: { obstacles: [placement] } });
      return buildObstacleSpecs(terrain, 7).some((b) => Number.isFinite(b.breakImpulse) && b.breakMode !== 'none');
    };
    const entries = pointsGuide().flatMap((t) => t.entries);
    const cannot = entries.filter((e) => !breakable(e.kind as ObstacleKind)).map((e) => e.kind);
    expect(cannot).toEqual([]);
    // And the other way round: what scores nothing cannot topple.
    for (const k of ['car', 'stoneBarrier', 'rockSmall', 'boulder'] as const) {
      expect(STORY_POINTS[k], k).toBe(0);
      expect(breakable(k), k).toBe(false);
    }
  });

  it('one placement counts once however many of its bodies break; unplaced bodies count per origin', () => {
    const bodies: ScoredBody[] = [
      { id: 1, originId: 1, kind: 'dam' as ObstacleKind, placement: 4 },
      { id: 2, originId: 2, kind: 'dam' as ObstacleKind, placement: 4 },
      { id: 3, originId: 1, kind: 'dam' as ObstacleKind, placement: -1 }, // debris of body 1
      { id: 9, originId: 9, kind: 'trafficLight' as ObstacleKind, placement: -1 },
    ];
    const lookup = (id: number): ScoredBody | undefined => bodies.find((b) => b.id === id);
    const pos = { x: 0, y: 0, z: 0 };
    const broke = (id: number, kind: ObstacleKind): GameEvent =>
      ({ type: 'obstacleBroken', obstacleId: id, kind, pos }) as unknown as GameEvent;
    const log = [broke(1, 'dam' as ObstacleKind), broke(2, 'dam' as ObstacleKind), broke(3, 'dam' as ObstacleKind), broke(9, 'trafficLight' as ObstacleKind)];
    const t = tallyStoryPoints(log, lookup);
    expect(t.destroyed.map((d) => d.unit)).toEqual(['p4', 'b9']);
    expect(t.points).toBe(STORY_POINTS.dam + STORY_POINTS.trafficLight);
  });
});
