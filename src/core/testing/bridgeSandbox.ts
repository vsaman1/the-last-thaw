import type { LevelDef } from '../types';

/*
 * BRIDGE SANDBOX — a test fixture for bridges that connect (src/core/obstacles/structures/deck.ts)
 * and the world logic check (src/core/terrain/logic.ts). NOT registered in LEVELS.
 * A straight open slope (halfWidth 120, ~0.11) along +Z (x = 0), so s ≈ z and d = −x. Coast s 800.
 *
 *   s 160       THE GORGE: a ravine across the left of the slope (d −110…20, 22 m wide, 14 m deep,
 *               fatal); the line passes round its right end (d 60).
 *   d −40       the glen road: a street down to the gorge's upper rim (s 145), the ROAD BRIDGE down
 *               the course from rim to rim (s 145–175: the deck ramps 3.3 m down between them, an
 *               abutment at each end), and the street on to the car park at s 420; cars drive over.
 *   d −90       a FOOTBRIDGE across the gorge (s 147–173) between two field paths' trailheads.
 * Every placement passes validateLevel, so the world logic has no errors here.
 */

export const bridgeSandbox: LevelDef = {
  id: 'bridge-sandbox',
  index: 97,
  name: 'Bridge Sandbox',
  subtitle: 'Test fixture: a road over a gorge on a bridge, traffic crossing it.',
  seed: 9797,
  bounds: { minX: -200, maxX: 200, minZ: -100, maxZ: 960 },
  cellSize: 2,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 110, halfWidth: 60 },
    { x: 0, z: 60, floor: 104, halfWidth: 120 },
    { x: 0, z: 800, floor: 22, halfWidth: 120 },
    { x: 0, z: 950, floor: 6, halfWidth: 120 },
  ],
  cliffs: [],
  wallHeight: 30,
  wallRamp: 25,
  startS: 30,
  coastS: 800,
  finishS: 820,
  theme: 'town',
  features: [
    // 0 The gorge.
    {
      type: 'ravine',
      points: [
        { s: 160, d: -110 },
        { s: 160, d: 20 },
      ],
      width: 22,
      depth: 14,
    },
    // 1-2 The glen road to each rim (the bridge carries it between them) and on to the car park.
    {
      type: 'street',
      points: [
        { s: 40, d: -20 },
        { s: 90, d: -32 },
        { s: 145, d: -40 },
      ],
      width: 8,
      start: 'turning',
    },
    {
      type: 'street',
      points: [
        { s: 175, d: -40 },
        { s: 300, d: -46 },
        { s: 410, d: -46 },
      ],
      width: 8,
    },
    // 3 The car park at the bottom of the glen road.
    { type: 'parking', s: 425, d: -46, length: 24, width: 18 },
  ],
  obstacles: [
    // The road bridge down the course from rim to rim, and the footbridge beside it.
    { kind: 'roadBridge', s: 160, d: -40, yaw: Math.PI / 2, span: 30 },
    { kind: 'footbridge', s: 160, d: -90, yaw: Math.PI / 2, span: 26 },
    // Traffic on the glen road, both ways (lanes 2 m either side of its centre line).
    { kind: 'car', s: 100, d: -32, yaw: 0 },
    { kind: 'car', s: 60, d: -23, yaw: 0 },
    { kind: 'truck', s: 230, d: -41, yaw: Math.PI },
    { kind: 'car', s: 290, d: -43.5, yaw: Math.PI },
    { kind: 'bus', s: 360, d: -44, yaw: Math.PI },
    // Parked in the car park.
    { kind: 'car', s: 420, d: -50 },
    { kind: 'car', s: 430, d: -42 },
    // A house by the road, pines by the gorge.
    { kind: 'house', s: 330, d: -70 },
    { kind: 'pine', s: 135, d: -70 },
    { kind: 'pine', s: 190, d: -15 },
  ],
  decor: { sceneryTreeDensity: 1, bushDensity: 1, grassTuftDensity: 3, pebbleDensity: 1 },
  line: [
    { s: 30, d: 0 },
    { s: 120, d: 60 },
    { s: 220, d: 60 },
    { s: 820, d: 0 },
  ],
};
