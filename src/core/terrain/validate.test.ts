import { describe, expect, it } from 'vitest';
import type { LevelDef, ObstacleKind, ObstaclePlacement, TerrainFeature } from '../types';
import { level1 } from '../levels/level1';
import { missingStructureKinds, structureFootprint } from '../obstacles/structures';
import { buildObstacleSpecs } from '../obstacles/spawn';
import { createTerrain } from './terrain';
import {
  ALL_OBSTACLE_KINDS,
  OBSTACLE_FOOTPRINT,
  SPANNING_KINDS,
  isSpanningKind,
  obstacleFootprint,
  placementFootprint,
  placementSpan,
  validateCliffs,
  validateFeatures,
  validateLevel,
  validateLine,
  validatePlacements,
} from './validate';

/** Straight valley: s = z, d = -x, floor half-width 20 m, slope ≈ 0.087, no cliffs unless given. */
const level = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 'validate',
  index: 99,
  name: 'Validate',
  subtitle: 'test',
  seed: 5,
  bounds: { minX: -110, maxX: 110, minZ: -60, maxZ: 640 },
  cellSize: 2,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 70, halfWidth: 20 },
    { x: 0, z: 300, floor: 44, halfWidth: 20 },
    { x: 0, z: 600, floor: 16, halfWidth: 20 },
  ],
  cliffs: [],
  wallHeight: 20,
  wallRamp: 15,
  startS: 20,
  coastS: 540,
  finishS: 570,
  obstacles: [],
  decor: { sceneryTreeDensity: 2, bushDensity: 2, grassTuftDensity: 5, pebbleDensity: 2 },
  ...over,
});

const problemsOf = (issues: { index: number; problem: string }[], index: number): string =>
  issues
    .filter((i) => i.index === index)
    .map((i) => i.problem)
    .join(' | ');

describe('validate: obstacle kinds and spans', () => {
  it('knows a footprint for every obstacle kind, builtin and structure', () => {
    expect(ALL_OBSTACLE_KINDS).toHaveLength(40);
    expect(new Set(ALL_OBSTACLE_KINDS).size).toBe(40);
    for (const k of ALL_OBSTACLE_KINDS) {
      expect(OBSTACLE_FOOTPRINT[k], k).toBeGreaterThan(0);
      expect(Number.isFinite(OBSTACLE_FOOTPRINT[k])).toBe(true);
    }
    expect(Object.keys(OBSTACLE_FOOTPRINT)).toHaveLength(40);
    expect([...SPANNING_KINDS].sort()).toEqual(['dam', 'fence', 'footbridge', 'guardrail', 'pipeline', 'roadBridge']);
    expect(isSpanningKind('fence')).toBe(true);
    expect(isSpanningKind('car')).toBe(false);
  });

  it('uses the structure kit footprint for defined kinds and the table for pending ones', () => {
    const pending = new Set<ObstacleKind>(missingStructureKinds());
    for (const k of ALL_OBSTACLE_KINDS) {
      const kit = structureFootprint(k, 2);
      if (kit !== undefined) expect(obstacleFootprint(k, 2), k).toBe(kit);
      else expect(obstacleFootprint(k, 2), k).toBe(OBSTACLE_FOOTPRINT[k] * 2);
      if (pending.has(k)) expect(kit, k).toBeUndefined();
    }
    expect(structureFootprint('car')).toBeDefined();
    expect(placementFootprint({ kind: 'car', s: 0, d: 0, scale: 1.5 })).toBe(structureFootprint('car', 1.5));
    // An ice field reaches its spread plus the biggest block.
    expect(placementFootprint({ kind: 'iceField', s: 0, d: 0 })).toBe(9);
    expect(placementFootprint({ kind: 'iceField', s: 0, d: 0, spread: 3 })).toBe(5);
    expect(placementFootprint({ kind: 'iceField', s: 0, d: 0, spread: 12, scale: 1.5 })).toBe(15);
  });

  it('defaults a span to the floor width and checks that spanning kinds fit across the floor', () => {
    const t = createTerrain(level());
    expect(placementSpan(t, { kind: 'fence', s: 100, d: 0 })).toBeCloseTo(40, 1);
    expect(placementSpan(t, { kind: 'fence', s: 100, d: 0, span: 12 })).toBe(12);
    expect(placementSpan(t, { kind: 'car', s: 100, d: 0 })).toBe(0);
    const obstacles: ObstaclePlacement[] = [
      { kind: 'fence', s: 100, d: 0 }, // 0: default span = floor width, fits
      { kind: 'dam', s: 120, d: 0, span: 50 }, // 1: wider than the floor
      { kind: 'guardrail', s: 140, d: 12, span: 20 }, // 2: pokes 2 m into the wall (allowed 1.5)
      { kind: 'fence', s: 160, d: 0, span: 70, yaw: Math.PI / 2 }, // 3: along the course: fits across
      { kind: 'guardrail', s: 180, d: 8, span: 16, yaw: 0.3 }, // 4: angled, fits
      { kind: 'car', s: 200, d: 15 }, // 5: car fits (footprint 2.6), on its road
      { kind: 'factoryHall', s: 220, d: 10 }, // 6: too big this close to the wall
    ];
    // (Vehicles must stand on a road or parking area: give the car one.)
    const features: TerrainFeature[] = [{ type: 'road', s0: 190, s1: 210, d: 15, width: 5 }];
    const issues = validatePlacements(createTerrain(level({ obstacles, features })));
    expect(problemsOf(issues, 0)).toBe('');
    expect(problemsOf(issues, 1)).toMatch(/span/);
    expect(problemsOf(issues, 2)).toMatch(/span/);
    expect(problemsOf(issues, 3)).toBe('');
    expect(problemsOf(issues, 4)).toBe('');
    expect(problemsOf(issues, 5)).toBe('');
    expect(problemsOf(issues, 6)).toMatch(/outside the floor/);
  });
});

describe('validate: placements against features', () => {
  const features: TerrainFeature[] = [
    { type: 'ramp', s: 260, d: 0, width: 12, length: 16, height: 3 },
    { type: 'gap', s: 260, length: 12, depth: 8 },
    { type: 'island', s0: 320, s1: 370, d: 0, width: 10, height: 7 },
    { type: 'road', s0: 400, s1: 450, d: 10, width: 6 },
  ];
  const obstacles: ObstaclePlacement[] = [
    { kind: 'rockSmall', s: 266, d: 5 }, // 0: at the bottom of the gap
    { kind: 'footbridge', s: 266, d: 0 }, // 1: a bridge over the gap is allowed
    { kind: 'fence', s: 266, d: 0 }, // 2: a fence across the gap is not
    { kind: 'house', s: 345, d: 0 }, // 3: on top of the island
    { kind: 'pine', s: 345, d: 0 }, // 4: trees may grow on islands
    { kind: 'boulder', s: 252, d: 1 }, // 5: on the ramp face: blocks the kicker
    { kind: 'car', s: 425, d: 10 }, // 6: a car on the road is fine
    { kind: 'fence', s: 345, d: 0 }, // 7: a fence across the island
    { kind: 'house', s: 345, d: -14 }, // 8: in the channel beside the island: fine
  ];
  const t = createTerrain(level({ features, obstacles }));
  const issues = validatePlacements(t);

  it('keeps things out of gaps, off islands and off ramp faces unless allowed', () => {
    expect(problemsOf(issues, 0)).toMatch(/gap/);
    expect(problemsOf(issues, 1)).toBe('');
    expect(problemsOf(issues, 2)).toMatch(/gap/);
    expect(problemsOf(issues, 3)).toMatch(/island/);
    expect(problemsOf(issues, 4)).toBe('');
    expect(problemsOf(issues, 5)).toMatch(/ramp/);
    expect(problemsOf(issues, 6)).toBe('');
    expect(problemsOf(issues, 7)).toMatch(/island/);
    expect(problemsOf(issues, 8)).toBe('');
  });

  it('accepts a well-formed featured level', () => {
    const good = createTerrain(
      level({
        features: [
          ...features,
          { type: 'hill', s: 120, d: 4, radius: 16, height: 4 },
          { type: 'basin', s: 170, d: -6, radius: 10, depth: 4 },
          { type: 'plateau', s0: 470, s1: 520, d: -8, width: 14, height: 2.5 },
        ],
        line: [
          { s: 30, d: 0 },
          { s: 250, d: 0 },
          { s: 300, d: 0 },
          { s: 340, d: -12 },
          { s: 380, d: 0 },
          { s: 530, d: 0 },
        ],
      }),
    );
    expect(validateFeatures(good)).toEqual([]);
    expect(validateLine(good)).toEqual([]);
  });
});

describe('validate: features', () => {
  const check = (features: TerrainFeature[], over: Partial<LevelDef> = {}): string[] =>
    validateFeatures(createTerrain(level({ features, ...over }))).map((i) => `${i.index}: ${i.problem}`);

  it('flags features outside the course, at the start or beyond the coast', () => {
    const far: TerrainFeature = { type: 'hill', s: 600, d: 0, radius: 10, height: 2 };
    expect(check([far]).join()).toMatch(/outside the course/);
    expect(check([{ type: 'basin', s: 22, d: 0, radius: 8, depth: 3 }]).join()).toMatch(/start/);
    const aside: TerrainFeature = { type: 'hill', s: 200, d: 30, radius: 6, height: 2 };
    expect(check([aside]).join()).toMatch(/outside the floor/);
  });

  it('flags bad overlaps with cliffs (gaps, roads, ramp faces) but allows a lip on a cliff', () => {
    const cliffs = [{ s: 300, drop: 10 }];
    expect(check([{ type: 'gap', s: 295, length: 10, depth: 8 }], { cliffs }).join()).toMatch(/cliff/);
    expect(check([{ type: 'road', s0: 280, s1: 320, d: 0, width: 6 }], { cliffs }).join()).toMatch(/cliff/);
    const ramp: TerrainFeature = { type: 'ramp', s: 306, d: 0, width: 10, length: 14, height: 2 };
    expect(check([ramp], { cliffs }).join()).toMatch(/cliff/);
    expect(check([{ ...ramp, s: 300 }], { cliffs })).toEqual([]);
    expect(check([{ type: 'island', s0: 280, s1: 330, d: 0, width: 8, height: 7 }], { cliffs })).toEqual([]);
  });

  it('demands that a full-width gap can be jumped and leaves a landing', () => {
    const gap: TerrainFeature = { type: 'gap', s: 260, length: 12, depth: 8 };
    expect(check([gap]).join()).toMatch(/cannot be cleared/);
    const ramp: TerrainFeature = { type: 'ramp', s: 260, d: 0, width: 12, length: 16, height: 3 };
    expect(check([ramp, gap])).toEqual([]);
    expect(check([ramp, { ...gap, length: 40 }]).join()).toMatch(/too long/);
    expect(check([ramp, gap], { cliffs: [{ s: 285, drop: 10 }] }).join()).toMatch(/landing/);
    const basin: TerrainFeature = { type: 'basin', s: 290, d: 0, radius: 8, depth: 4 };
    expect(check([ramp, gap, basin]).join()).toMatch(/landing/);
    // A partial gap can be steered around, so it needs no ramp.
    expect(check([{ type: 'gap', s: 260, length: 10, depth: 8, d: 9, width: 12 }])).toEqual([]);
  });

  it('lets a gap have several ramps, judging each one by the gap (jump and landing)', () => {
    const gap: TerrainFeature = { type: 'gap', s: 260, length: 12, depth: 8 };
    const left: TerrainFeature = { type: 'ramp', s: 260, d: -8, width: 12, length: 16, height: 3 };
    const right: TerrainFeature = { ...left, d: 8 };
    // Before, only the first ramp belonged to the gap: the second was a lone ramp with the gap in
    // its landing run.
    expect(check([left, right, gap])).toEqual([]);
    const weak: TerrainFeature = { ...right, height: 1 };
    const weakIssues = check([left, weak, gap]);
    expect(weakIssues.join()).toMatch(/2: too long to jump from ramp 1 /);
    expect(weakIssues.filter((p) => !p.startsWith('2:'))).toEqual([]);
    // A basin in the right ramp's landing corridor only is still caught.
    const basin: TerrainFeature = { type: 'basin', s: 290, d: 10, radius: 6, depth: 2 };
    expect(check([left, right, gap, basin]).join()).toMatch(/2: no clear landing: the basin \(feature 3\)/);
    // And the intended line may cross the gap over either ramp.
    const t = createTerrain(
      level({
        features: [left, right, gap],
        line: [
          { s: 30, d: 0 },
          { s: 220, d: 8 },
          { s: 300, d: 8 },
          { s: 520, d: 0 },
        ],
      }),
    );
    expect(validateLine(t)).toEqual([]);
  });

  it('counts islands, other gaps and basins in the way round a partial gap', () => {
    const gap: TerrainFeature = { type: 'gap', s: 260, length: 10, depth: 8, d: 9, width: 12 };
    expect(check([gap])).toEqual([]);
    // A basin in the 23 m bypass (d -20 … 3) leaves 4 m and 3 m either side of it.
    const basin: TerrainFeature = { type: 'basin', s: 265, d: -8, radius: 8, depth: 4 };
    expect(check([gap, basin]).join()).toMatch(/0: no channel around it .*feature 1 in the way/);
    // An island in the bypass narrows it to 9.5 m (it also fails its own channel check).
    const island: TerrainFeature = { type: 'island', s0: 250, s1: 280, d: -8, width: 5, height: 7 };
    expect(check([gap, island]).join()).toMatch(/0: no channel around it \(widest 9\.5 m.*feature 1/);
  });

  it('demands real trap walls for gaps and islands at the level grid size', () => {
    const shallow: TerrainFeature = { type: 'gap', s: 260, length: 10, depth: 3, d: 9, width: 12 };
    expect(check([shallow]).join()).toMatch(/too shallow/);
    const low: TerrainFeature = { type: 'island', s0: 300, s1: 340, d: 0, width: 8, height: 3 };
    expect(check([low]).join()).toMatch(/too low/);
    const coarse = { cellSize: 3 };
    expect(check([{ type: 'gap', s: 260, length: 10, depth: 5.5, d: 9, width: 12 }]).join()).toBe('');
    expect(check([{ type: 'gap', s: 260, length: 10, depth: 5.5, d: 9, width: 12 }], coarse).join()).toMatch(
      /too shallow/,
    );
  });

  it('keeps both island channels wide enough for the level iceberg', () => {
    const island: TerrainFeature = { type: 'island', s0: 300, s1: 340, d: 7, width: 10, height: 7 };
    expect(check([island]).join()).toMatch(/channel/);
    expect(check([{ ...island, d: 2 }])).toEqual([]);
    expect(check([{ ...island, d: 2 }], { iceberg: { scale: 2, mass: 120 } }).join()).toMatch(/channel/);
  });

  it('flags hills too steep to drive, plateaus too short for their ramps and narrow roads', () => {
    expect(check([{ type: 'hill', s: 200, d: 0, radius: 8, height: 6 }]).join()).toMatch(/too steep/);
    const short: TerrainFeature = { type: 'plateau', s0: 200, s1: 215, d: 0, width: 14, height: 3 };
    expect(check([short]).join()).toMatch(/too short/);
    expect(check([{ type: 'road', s0: 200, s1: 260, d: 0, width: 2.5 }]).join()).toMatch(/too narrow/);
  });

  it('flags gaps or islands overlapping other features and basins or gaps below the sea', () => {
    expect(
      check([
        { type: 'island', s0: 300, s1: 340, d: 0, width: 8, height: 7 },
        { type: 'hill', s: 320, d: 0, radius: 8, height: 2 },
      ]).join(),
    ).toMatch(/overlaps feature/);
    const low = level({
      course: [
        { x: 0, z: 0, floor: 20, halfWidth: 20 },
        { x: 0, z: 300, floor: 8, halfWidth: 20 },
        { x: 0, z: 600, floor: 0, halfWidth: 20 },
      ],
      features: [{ type: 'basin', s: 400, d: 0, radius: 10, depth: 8 }],
    });
    expect(validateFeatures(createTerrain(low)).map((i) => i.problem).join()).toMatch(/below sea/);
  });
});

describe('validate: intended line and whole level', () => {
  it('checks the line is ordered, on the floor, clear of islands and jumps gaps from a ramp', () => {
    const t = createTerrain(
      level({
        features: [
          { type: 'island', s0: 300, s1: 340, d: 0, width: 10, height: 7 },
          { type: 'gap', s: 400, length: 10, depth: 8, d: 8, width: 12 },
        ],
        line: [
          { s: 30, d: 0 },
          { s: 200, d: 0 },
          { s: 150, d: 0 }, // 2: out of order
          { s: 250, d: 25 }, // 3: off the floor
          { s: 320, d: 0 }, // 4: on the island
          { s: 405, d: 8 }, // 5: into a partial gap with no ramp
          { s: 520, d: 0 },
        ],
      }),
    );
    const issues = validateLine(t);
    expect(problemsOf(issues, 2)).toMatch(/order/);
    expect(problemsOf(issues, 3)).toMatch(/outside the floor/);
    expect(problemsOf(issues, 4)).toMatch(/island/);
    expect(problemsOf(issues, 5)).toMatch(/gap/);
    expect(problemsOf(issues, 0)).toBe('');
    expect(problemsOf(issues, 6)).toBe('');
  });

  it('checks cliffs: before the coast, and keeping their drop', () => {
    // 25 m before the coast, inside the coast blend: kept whole.
    expect(validateCliffs(createTerrain(level({ cliffs: [{ s: 515, drop: 12 }] })))).toEqual([]);
    const beyond = validateCliffs(createTerrain(level({ cliffs: [{ s: 545, drop: 12 }] })));
    expect(beyond.map((i) => i.problem).join()).toMatch(/beyond the coast/);
    const issues = validateLevel(createTerrain(level({ cliffs: [{ s: 545, drop: 12 }] })));
    expect(issues.some((i) => i.area === 'cliff' && /cliff at s=545/.test(i.problem))).toBe(true);
  });

  it('passes level 1 as designed', () => {
    expect(validateLevel(createTerrain(level1))).toEqual([]);
  });
});

describe('boats belong on the sea', () => {
  it('a boat moored past the coast passes; a car there does not', () => {
    const at = level1.finishS;
    const lv = {
      ...level1,
      id: 'boats-at-sea-test',
      obstacles: [...level1.obstacles, { kind: 'boat', s: at, d: 0 }, { kind: 'car', s: at, d: 6 }],
    } as LevelDef;
    const t = createTerrain(lv);
    const boat = lv.obstacles.length - 2;
    const issues = validateLevel(t).filter((i) => i.area === 'obstacle');
    expect(issues.filter((i) => i.index === boat)).toEqual([]);
    expect(issues.filter((i) => i.index === boat + 1).map((i) => i.problem).join()).toMatch(/coast|sea|road/);
  });
});

describe('oil rigs stand in the sea', () => {
  it('a rig in open water past the coast passes; one on land is flagged', () => {
    const lv = {
      ...level1,
      id: 'oil-rig-at-sea-test',
      obstacles: [...level1.obstacles, { kind: 'oilRig', s: level1.finishS, d: 0 }, { kind: 'oilRig', s: 300, d: 0 }],
    } as LevelDef;
    const t = createTerrain(lv);
    const rig = lv.obstacles.length - 2;
    const issues = validateLevel(t).filter((i) => i.area === 'obstacle');
    expect(issues.filter((i) => i.index === rig)).toEqual([]);
    expect(issues.filter((i) => i.index === rig + 1).map((i) => i.problem).join()).toMatch(/not at sea/);
    // Built there, its legs stand on the sea floor under the water and its deck is 6 m above it.
    const [atSea] = buildObstacleSpecs(t, 3).filter((s) => s.kind === 'oilRig' && t.isOcean(s.position.x, s.position.z));
    const seaFloor = t.heightAt(atSea.position.x, atSea.position.z);
    expect(seaFloor).toBeLessThan(lv.seaLevel - 1);
    expect(atSea.position.y).toBeCloseTo(seaFloor, 6);
    const deck = atSea.parts.find((p) => p.name === 'deck');
    expect(deck).toBeDefined();
    expect(atSea.position.y + (deck?.offset.y ?? 0) - 0.6).toBeCloseTo(lv.seaLevel + 6, 4);
  });
});
