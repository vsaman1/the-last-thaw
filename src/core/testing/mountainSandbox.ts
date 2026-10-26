import type { LevelDef } from '../types';

/*
 * OPEN-MOUNTAIN SANDBOX — a test fixture for the open-mountain engine (relief, ridges, gullies,
 * ravines, cliff bands, fatal falls, route search, path pursuit). NOT registered in LEVELS.
 * A 2 km × 480 m mountainside (halfWidth 240) on a 0.13 slope, cellSize 2.5; the course runs
 * straight along +Z (x = 0), so s ≈ z and d = −x. Coast s ≈ 1985.
 *
 *   s 30        spawn (halfWidth 50, widening to 240 by s ≈ 160); relief starts after s 45
 *   s 150–626   THE FORK: wall ridges A (left) and B (right) split the slope into three branches
 *               - LEFT  (d < A): ridge C closes it at s 560–600: a POCKET, dead end (stuck)
 *               - MIDDLE (between A and B, 22 m wide at s 150, ~230 m at s 600): the line
 *               - RIGHT (d > B): runs into the wide ravine R2: dead end (fell)
 *   s ~600–650  THE RAVINE across the whole slope: R1 (16 m wide, 12 m deep) across the middle,
 *               R2 (36 m wide) across the right, both diagonal; ridge A and B end in them.
 *               KICKER on the line (lip s 605.5, d 0, 14 × 14 m, 3.5 m): ~12 m/s at the lip
 *               clears R1 there; without the kicker R1 needs ~25 m/s (its far rim is 2 m lower).
 *               R2 cannot be jumped below the 34 m/s cap.
 *   s 900       CLIFF BAND (12 m, d −160 … 40): fly it for the waterfall; round its right end
 *               (d > ~48) the drop is a rideable slope
 *   s 1000      closed gully G1 on the right (d 150 → 200): a second dead end (stuck)
 *   s 1050–1260 ridge D, a diagonal wall from the left wall to d 60: go round its right end
 *   s 1300–1650 open gully G2 guiding back to the middle; coast s ≈ 1985, finish s 2005
 *
 * Relief: rolls 3 m (160 m), braided gullies 2.5 m (50 m apart), 6 m outcrops on 5 % of the floor
 * kept 15 m clear of the line. No water budget (never melts).
 */
export const mountainSandbox: LevelDef = {
  id: 'mountain-sandbox',
  index: 99,
  name: 'Mountain Sandbox',
  subtitle: 'Test fixture: open mountainside, ridges, ravines, a cliff band.',
  seed: 9119,
  bounds: { minX: -400, maxX: 400, minZ: -120, maxZ: 2260 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 270, halfWidth: 50 },
    { x: 0, z: 60, floor: 262.5, halfWidth: 120 },
    { x: 0, z: 160, floor: 249.5, halfWidth: 240 },
    { x: 0, z: 1987, floor: 12, halfWidth: 240 },
    { x: 0, z: 2240, floor: -20.9, halfWidth: 240 },
  ],
  cliffs: [{ s: 900, drop: 12, d: -60, width: 200 }],
  wallHeight: 40,
  wallRamp: 30,
  startS: 30,
  coastS: 1985,
  finishS: 2005,
  theme: 'alpine',
  relief: {
    roll: 3,
    rollScale: 160,
    gullies: 2.5,
    gullySpacing: 50,
    outcrops: 6,
    outcropCover: 0.05,
    outcropScale: 30,
    lineClear: 15,
  },
  features: [
    // 0-1 The fork: ridges A and B (both end in the ravine).
    {
      type: 'ridge',
      points: [
        { s: 150, d: -15 },
        { s: 300, d: -80 },
        { s: 480, d: -110 },
        { s: 560, d: -120 },
        { s: 600, d: -125 },
      ],
      width: 8,
      height: 10,
    },
    {
      type: 'ridge',
      points: [
        { s: 150, d: 15 },
        { s: 300, d: 70 },
        { s: 480, d: 100 },
        { s: 628, d: 112 },
      ],
      width: 8,
      height: 10,
    },
    // 2 Ridge C closes the left branch into a pocket (into the left wall).
    {
      type: 'ridge',
      points: [
        { s: 560, d: -120 },
        { s: 590, d: -200 },
        { s: 600, d: -265 },
      ],
      width: 8,
      height: 10,
    },
    // 3-4 The ravine: R1 across the middle, R2 (too wide to jump) across the right.
    {
      type: 'ravine',
      points: [
        { s: 600, d: -125 },
        { s: 622, d: 60 },
        { s: 630, d: 125 },
      ],
      width: 16,
      depth: 12,
    },
    {
      type: 'ravine',
      points: [
        { s: 640, d: 112 },
        { s: 660, d: 265 },
      ],
      width: 50,
      depth: 12,
    },
    // 5 The kicker on the line, lip at R1's near edge.
    { type: 'ramp', s: 605.5, d: 0, width: 14, length: 14, height: 3.5 },
    // 6 A closed gully on the right below the band: a dead end.
    {
      type: 'gully',
      points: [
        { s: 1000, d: 150 },
        { s: 1150, d: 200 },
      ],
      width: 14,
      depth: 7,
      closed: true,
    },
    // 7 Ridge D: a diagonal wall from the left wall to d 60.
    {
      type: 'ridge',
      points: [
        { s: 1050, d: -265 },
        { s: 1150, d: -100 },
        { s: 1260, d: 60 },
      ],
      width: 8,
      height: 10,
    },
    // 8 An open gully guiding back to the middle.
    {
      type: 'gully',
      points: [
        { s: 1300, d: 90 },
        { s: 1450, d: 30 },
        { s: 1650, d: 0 },
      ],
      width: 24,
      depth: 3,
    },
  ],
  obstacles: [
    { kind: 'pine', s: 250, d: -55 },
    { kind: 'pine', s: 400, d: -97 },
    { kind: 'boulder', s: 350, d: -160 },
    { kind: 'rockCluster', s: 420, d: 170, count: 3, spread: 2.5 },
    { kind: 'pine', s: 700, d: 120 },
    { kind: 'boulder', s: 760, d: -120 },
    { kind: 'pine', s: 1100, d: -160 },
    { kind: 'rockCluster', s: 1400, d: -120, count: 3, spread: 2.5 },
    { kind: 'pine', s: 1550, d: 140 },
    { kind: 'boulder', s: 1700, d: -80 },
  ],
  line: [
    { s: 30, d: 0 },
    { s: 140, d: 0 },
    { s: 300, d: -5 },
    { s: 450, d: 0 },
    { s: 592, d: 0 },
    { s: 605.5, d: 0 },
    { s: 660, d: -10 },
    { s: 800, d: -40 },
    { s: 900, d: -40 },
    { s: 960, d: -30 },
    { s: 1060, d: 20 },
    { s: 1180, d: 80 },
    { s: 1260, d: 100 },
    { s: 1320, d: 80 },
    { s: 1450, d: 30 },
    { s: 1650, d: 0 },
    { s: 1985, d: 0 },
    { s: 2100, d: 0 },
  ],
  decor: {
    sceneryTreeDensity: 4,
    bushDensity: 2,
    grassTuftDensity: 12,
    pebbleDensity: 6,
  },
};
