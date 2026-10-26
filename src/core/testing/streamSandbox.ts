import type { CourseCoord, LevelDef } from '../types';

/*
 * STREAM SANDBOX — a test fixture for natural streams, dams with reservoirs, dam-break floods and
 * river capture. NOT registered in LEVELS. A straight valley along +Z (x = 0: s ≈ z, d = −x),
 * halfWidth 40, cellSize 2, sea level 0, coast s ≈ 1150.
 *
 *   s 30        spawn on the centre line, beside the meltwater stream leaving the glacier
 *   s 2–1180    THE STREAM (feature 0): meltwater (source 'glacier': it rises under the ice at d −17
 *               and runs out of a portal in the snout at s ~24, d −16, then past the spawn's bow to
 *               the centre line at s 60, where it used to rise from nothing: arcs along it are
 *               SANDBOX_GLACIER_RUN m longer than from there); 14 m wide, banks 3 m, 1.2 m deep,
 *               4 m/s, winding d −8 … +6, out into the sea. Its banks hold the base iceberg (r 2.2:
 *               needs ≥ 2.1 m) but not the big one of streamSandboxBig (scale 2.2: would need 4.6 m).
 *   s 560–660   a GORGE (halfWidth 16, walls 30 m) with the DAM across it at s 600 (span 34 m, wall
 *               to wall): the reservoir floods the gorge and the valley floor upstream.
 *   s 760       a cliff band (6 m, d −26 … +14) across the stream: a waterfall.
 *   s 290–430   a side stream (feature 1) from a cave spring at the foot of the left valley wall
 *               (source 'cave') across the left floor, ending in a still POOL (a trap).
 *   s 630       a car parked in a bay on the gorge floor below the dam (in the flood's way).
 */

/** The main stream from under the glacier: the first two points lead to (60, 0). */
const MAIN: CourseCoord[] = [
  { s: 2, d: -17 },
  { s: 25, d: -16 },
  { s: 60, d: 0 },
  { s: 200, d: -8 },
  { s: 400, d: 6 },
  { s: 600, d: 0 },
  { s: 760, d: -6 },
  { s: 1000, d: 4 },
  { s: 1185, d: 0 },
];

/** Arc length (m) of the main stream from its source under the glacier to the centre line at s 60. */
export const SANDBOX_GLACIER_RUN = Math.hypot(MAIN[1].s - MAIN[0].s, MAIN[1].d - MAIN[0].d) +
  Math.hypot(MAIN[2].s - MAIN[1].s, MAIN[2].d - MAIN[1].d);

export const streamSandbox: LevelDef = {
  id: 'stream-sandbox',
  index: 98,
  name: 'Stream Sandbox',
  subtitle: 'Test fixture: a stream, a dam and its reservoir, a waterfall, a pool.',
  seed: 4242,
  bounds: { minX: -110, maxX: 110, minZ: -60, maxZ: 1400 },
  cellSize: 2,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 100, halfWidth: 40 },
    { x: 0, z: 440, floor: 64.8, halfWidth: 40 },
    { x: 0, z: 550, floor: 60.4, halfWidth: 40 },
    { x: 0, z: 575, floor: 59.4, halfWidth: 16 },
    { x: 0, z: 640, floor: 56.8, halfWidth: 16 },
    { x: 0, z: 665, floor: 55.3, halfWidth: 40 },
    { x: 0, z: 1150, floor: 6.8, halfWidth: 40 },
    { x: 0, z: 1390, floor: -24, halfWidth: 40 },
  ],
  cliffs: [{ s: 760, drop: 6, d: -6, width: 40 }],
  wallHeight: 30,
  wallRamp: 12,
  startS: 30,
  coastS: 1150,
  finishS: 1170,
  theme: 'meadow',
  features: [
    {
      type: 'stream',
      source: 'glacier',
      points: MAIN,
      width: 14,
      bank: 3,
      depth: 1.2,
      flow: 4,
    },
    {
      type: 'stream',
      source: 'cave',
      points: [
        { s: 290, d: -36 },
        { s: 300, d: -26 },
        { s: 430, d: -30 },
      ],
      width: 10,
      bank: 3,
      depth: 1.2,
      flow: 3,
      end: 'pool',
    },
    // A parking bay on the gorge floor below the dam, for the parked car.
    { type: 'parking', s: 630, d: 10.5, length: 10, width: 6 },
  ],
  obstacles: [
    { kind: 'dam', s: 600, d: 0, span: 34 },
    { kind: 'car', s: 630, d: 9, yaw: 0 },
  ],
  line: [
    { s: 30, d: 0 },
    { s: 1200, d: 0 },
  ],
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
};

/** The same valley with a big iceberg (scale 2.2, 900 t: banks of 3 m cannot hold it). */
export const streamSandboxBig: LevelDef = {
  ...streamSandbox,
  id: 'stream-sandbox-big',
  iceberg: { scale: 2.2, mass: 900 },
};

/** The same valley without the dam: a free stream from the source to the sea. */
export const streamSandboxOpen: LevelDef = {
  ...streamSandbox,
  id: 'stream-sandbox-open',
  obstacles: [],
};
