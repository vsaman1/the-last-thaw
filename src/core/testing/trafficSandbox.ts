import type { LevelDef, ObstaclePlacement } from '../types';

/*
 * TRAFFIC SANDBOX — a test fixture for the living world (streets, junctions, traffic lights, road
 * traffic, parking, smoke and steam plumes, turning rotors). NOT registered in LEVELS.
 * A straight 700 m town valley (halfWidth 80) on a ~0.1 slope, cellSize 2; the course runs along +Z
 * (x = 0), so s ≈ z and d = −x. Coast s ≈ 690.
 *
 *   s 90–600    the main road on the right bank (d 40, 9 m) and a lane on the left bank (d −40, 7 m)
 *   s 250, 430  two cross streets right across the valley: four signalised crossroads (asphalt)
 *   s 430–525   a side street bending off cross street 2 (a T at d −10), across the left lane
 *               (crossroads at s ≈ 491) to a parking lot: both unsignalised (within 70 m of lights)
 *   s 300–380   the works: a smokestack (dark smoke), a cooling tower (steam), a factory hall
 *   houses with chimneys either side, wind turbines on the benches
 * Vehicles on the roads drive (cars, trucks, buses in both directions); the three in the parking lot
 * and one marked `parked` stay put. The line runs straight down the middle, across both cross
 * streets.
 */

const ROAD_RIGHT = 40;
const ROAD_LEFT = -40;
/** Lane centres (laneOffset = width / 4): down-course on the right of travel (+d). */
const R_DOWN = ROAD_RIGHT + 2.25;
const R_UP = ROAD_RIGHT - 2.25;
const L_DOWN = ROAD_LEFT + 1.75;
const L_UP = ROAD_LEFT - 1.75;
/** Yaw (relative to the course) of a vehicle driving toward +d (across, to the right) and -d. */
const ACROSS_RIGHT = -Math.PI / 2;
const ACROSS_LEFT = Math.PI / 2;

const vehicles: ObstaclePlacement[] = [
  // Main road, right bank.
  { kind: 'car', s: 110, d: R_DOWN, yaw: 0 },
  { kind: 'car', s: 135, d: R_DOWN, yaw: 0 },
  { kind: 'truck', s: 175, d: R_DOWN, yaw: 0 },
  { kind: 'car', s: 300, d: R_DOWN, yaw: 0 },
  { kind: 'bus', s: 340, d: R_UP, yaw: Math.PI },
  { kind: 'car', s: 395, d: R_UP, yaw: Math.PI },
  { kind: 'car', s: 520, d: R_UP, yaw: Math.PI },
  { kind: 'truck', s: 575, d: R_UP, yaw: Math.PI },
  // Left bank.
  { kind: 'car', s: 160, d: L_DOWN, yaw: 0 },
  { kind: 'car', s: 320, d: L_UP, yaw: Math.PI },
  { kind: 'truck', s: 500, d: L_UP, yaw: Math.PI },
  // Cross streets (lanes 2 m either side of s 250 / 430).
  { kind: 'car', s: 248, d: -20, yaw: ACROSS_RIGHT },
  { kind: 'car', s: 252, d: 18, yaw: ACROSS_LEFT },
  { kind: 'bus', s: 252, d: 60, yaw: ACROSS_LEFT },
  { kind: 'car', s: 428, d: 15, yaw: ACROSS_RIGHT },
  { kind: 'car', s: 432, d: 55, yaw: ACROSS_LEFT },
  // Side street.
  { kind: 'car', s: 512, d: -50, yaw: Math.PI },
  // Parked: the lot, and one in the bay at the right kerb of the main road (clear of the lane: on the
  // road itself a parked car would stand in it, and half on the verge it would lean).
  { kind: 'car', s: 534, d: -57 },
  { kind: 'car', s: 540, d: -52 },
  { kind: 'truck', s: 546, d: -46, yaw: Math.PI / 2 },
  { kind: 'car', s: 230, d: ROAD_RIGHT + 5.5, yaw: 0, parked: true },
];

export const trafficSandbox: LevelDef = {
  id: 'traffic-sandbox',
  index: 98,
  name: 'Traffic Sandbox',
  subtitle: 'Test fixture: streets, junctions, traffic lights, traffic, plumes.',
  seed: 4242,
  bounds: { minX: -220, maxX: 220, minZ: -100, maxZ: 860 },
  cellSize: 2,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 76, halfWidth: 40 },
    { x: 0, z: 80, floor: 70, halfWidth: 80 },
    { x: 0, z: 690, floor: 6, halfWidth: 80 },
    { x: 0, z: 840, floor: -14, halfWidth: 80 },
  ],
  cliffs: [],
  wallHeight: 30,
  wallRamp: 25,
  startS: 30,
  coastS: 690,
  finishS: 710,
  theme: 'town',
  features: [
    // (The roads end in turning circles, where the traffic turns round: validateWorldLogic.)
    { type: 'road', s0: 90, s1: 600, d: ROAD_RIGHT, width: 9, start: 'turning', end: 'turning' },
    { type: 'road', s0: 120, s1: 560, d: ROAD_LEFT, width: 7, start: 'turning', end: 'turning' },
    {
      type: 'street',
      points: [{ s: 250, d: -72 }, { s: 250, d: 72 }],
      width: 8,
      start: 'turning',
      end: 'turning',
    },
    {
      type: 'street',
      points: [{ s: 430, d: -72 }, { s: 430, d: 72 }],
      width: 8,
      start: 'turning',
      end: 'turning',
    },
    {
      type: 'street',
      points: [
        { s: 430, d: -10 },
        { s: 470, d: -20 },
        { s: 500, d: -48 },
        { s: 525, d: -52 },
      ],
      width: 6,
    },
    { type: 'parking', s: 540, d: -52, length: 24, width: 18 },
    // A parking bay along the right kerb of the main road (d 44.5 … 48.5).
    { type: 'parking', s: 230, d: ROAD_RIGHT + 6.5, length: 12, width: 4 },
  ],
  obstacles: [
    ...vehicles,
    // The works.
    { kind: 'smokestack', s: 330, d: 64 },
    { kind: 'smokestack', s: 352, d: 66 },
    { kind: 'coolingTower', s: 360, d: -62 },
    { kind: 'factoryHall', s: 300, d: -60 },
    // Houses and a chalet with chimneys.
    { kind: 'house', s: 200, d: 22 },
    { kind: 'house', s: 215, d: -22 },
    { kind: 'house', s: 470, d: 20 },
    { kind: 'chalet', s: 600, d: -20 },
    // Turbines on the benches, trees along the way.
    { kind: 'windTurbine', s: 150, d: 66 },
    { kind: 'windTurbine', s: 560, d: 66 },
    { kind: 'pine', s: 180, d: 10 },
    { kind: 'broadleaf', s: 395, d: -15 },
  ],
  decor: { sceneryTreeDensity: 2, bushDensity: 2, grassTuftDensity: 4, pebbleDensity: 1 },
  line: [
    { s: 30, d: 0 },
    { s: 700, d: 0 },
  ],
};
