import type { LevelDef } from '../types';

/*
 * LEVEL 1 — "MOUNTAIN VALLEY" (tutorial). Course length ≈ 715.6 m; all values are arc length s (m).
 *   plateau    s = 0–20 (slope 0.05) inside a mountain cirque, behind the spawn
 *   start      s = 30 on the launch ramp: floor 70.6, halfWidth 30, world (1.4, 70.6, 30.0), facing ≈ +Z
 *   launch     s ≈ 20–85 ramp (0.18) so the run gets going at once
 *   open       s ≈ 85–150 (0.10), wide (halfWidth 30→26): small rocks, a pine grove right of the line
 *   narrowing  s ≈ 150–255 (0.12, 0.11), bending left; boulder at s 222 left of the line
 *   gate       s ≈ 255–295 (0.09) halfWidth ≈ 14.2; stoneBarrier at s 276 d +6, world (-37.1, 40.3, 272.5);
 *              pillar rock at d -11; the clear line runs between them (d ≈ -4.5, world (-26.8, 40.3, 270.9))
 *   chute      s ≈ 295–375 (0.13, 0.11), bending right onto a straight run along +Z
 *   waterfall  lip s = 400, drop 15 m; lip world (0.0, 27.1, 389.7), foot y 12.1; landing run-out
 *              s 400–455 at 0.065; nothing placed between s 388 and 417.5. Leaving the lip at 13–19 m/s
 *              the iceberg lands 20–30 m out, around s 420–430.
 *   lower      s ≈ 455–540 (0.10) bending left: a small cottage (house at scale 0.5, break impulse ≈ 141)
 *              at s 470 d -12, world (9.2, 7.1, 462.0). By then the melting iceberg weighs ~12–15 t, so it
 *              smashes the cottage at ~10–12 m/s on a deliberate left line; the centre line clears it.
 *              Pine grove right of the line
 *              at s 474–488, d 7–14
 *   beach      sand from s ≈ 515
 *   coast      s = 540 (floor reaches sea level 0), world (-23.9, 0, 526.0); start→coast = 510 m
 *   finish     s = 560, 20 m out to sea, world (-30.0, sea 0 / seabed -4.0, 545.0); end s ≈ 715.6
 * Floors below are BASE floors (the terrain subtracts the 15 m cliff downstream of s = 400). Slopes
 * between control points: 0.05/0.18/0.10/0.12/0.11/0.09/0.13/0.11/0.065/0.065/0.10/0.10/0.09/0.08/0.08.
 * Autopilot (no melt): centre line 32.4 s (top 24.4 m/s), lane -10 38.4 s (smashes the house), lane +10
 * 39.3 s (clips the barrier), no input 45.3 s. The old 750 m valley took ~57–66 s at up to ~20 m/s.
 *
 * WATER BUDGET (tuned with a balance probe, see DEVLOG): metres 850, turnMetresPerRadian 10. Every
 * route lays ~460–530 m of river on land; what differs is net turning: smooth lines 2–6 rad, a
 * moderate weave ~18 rad, tap-steering keyboard players 11–27 rad, a wall-to-wall weave ~48 rad.
 * Measured at 800/10: smooth lines finish with 35–38 % ice, keyboard players 2–21 %, the wall-to-wall
 * weave melts; 850 adds a little slack because this is the tutorial. There are no refills, so how
 * smoothly the player steers decides how much ice is left at the sea (and the ice-left score bonus).
 */
export const level1: LevelDef = {
  id: 'mountain-valley',
  index: 1,
  name: 'Mountain Valley',
  subtitle: 'Steer your melting iceberg down a green valley: ride the falls, reach the sea.',
  seed: 1101,
  bounds: { minX: -250, maxX: 215, minZ: -150, maxZ: 780 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 73.5, halfWidth: 30 },
    { x: 1, z: 20, floor: 72.5, halfWidth: 30 },
    { x: 2, z: 85, floor: 60.8, halfWidth: 30 },
    { x: -10, z: 150, floor: 54.2, halfWidth: 27 },
    { x: -28, z: 210, floor: 46.6, halfWidth: 18 },
    { x: -33, z: 250, floor: 42.2, halfWidth: 14 },
    { x: -27, z: 290, floor: 38.6, halfWidth: 14 },
    { x: -6, z: 335, floor: 32.1, halfWidth: 19 },
    { x: 0, z: 365, floor: 28.7, halfWidth: 22 },
    // On the lip, between two collinear points: the course runs exactly along +Z here, so the cliff
    // step lies along one grid row and the lip is the same height and position across the floor.
    { x: 0, z: 390, floor: 27.08, halfWidth: 22.6 },
    { x: 0, z: 445, floor: 23.5, halfWidth: 24 },
    { x: -14, z: 500, floor: 17.8, halfWidth: 28 },
    { x: -30, z: 545, floor: 13.1, halfWidth: 34 },
    { x: -36, z: 600, floor: 8.06, halfWidth: 44 },
    { x: -36, z: 660, floor: 3.26, halfWidth: 52 },
    { x: -32, z: 700, floor: 0.06, halfWidth: 58 },
  ],
  cliffs: [{ s: 400, drop: 15 }],
  // A gravel track from the cottage down to the beach, so the cottage stands on a road (world logic).
  features: [{ type: 'road', s0: 470, s1: 528, d: -21, width: 4, surface: 'gravel' }],
  wallHeight: 40,
  wallRamp: 30,
  startS: 30,
  coastS: 540,
  finishS: 560,
  obstacles: [
    // Open upper valley: a few small rocks and trees to learn steering.
    { kind: 'rockSmall', s: 62, d: 9 },
    { kind: 'rockSmall', s: 80, d: -12 },
    { kind: 'rockCluster', s: 108, d: 5, count: 3, spread: 3 },
    // Pine grove right of the line; pines fall above ~7 m/s and stay >= 8 m apart (no wedging).
    { kind: 'pine', s: 124, d: 12 },
    { kind: 'pine', s: 132, d: 17 },
    { kind: 'pine', s: 136, d: 9 },
    { kind: 'broadleaf', s: 152, d: -9 },
    { kind: 'rockMedium', s: 172, d: 6 },
    { kind: 'pine', s: 190, d: -12 },
    // Narrowing toward the gate.
    { kind: 'boulder', s: 222, d: -7 },
    { kind: 'rockSmall', s: 240, d: 7 },
    // The rocky gate: pillar rock on the left, the barrier right of centre; the line is between them.
    { kind: 'rockMedium', s: 272, d: -11 },
    { kind: 'stoneBarrier', s: 276, d: 6, count: 3 },
    // Chute down to the falls.
    { kind: 'rockSmall', s: 312, d: -4 },
    { kind: 'rockCluster', s: 332, d: 8, count: 3, spread: 3 },
    { kind: 'pine', s: 352, d: -12 },
    { kind: 'rockSmall', s: 372, d: 9 },
    // Waterfall lip at s = 400: nothing between s 388 and 417.5; the landing run-out stays open.
    { kind: 'broadleaf', s: 448, d: 15 },
    // Lower valley: a house on a deliberate left line, a pine grove right of the centre line.
    { kind: 'house', s: 470, d: -12, scale: 0.5 },
    { kind: 'pine', s: 474, d: 9 },
    { kind: 'pine', s: 482, d: 14 },
    { kind: 'pine', s: 488, d: 7 },
    { kind: 'rockSmall', s: 508, d: -6 },
  ],
  water: { metres: 850, turnMetresPerRadian: 10 },
  decor: {
    sceneryTreeDensity: 8,
    bushDensity: 4,
    grassTuftDensity: 30,
    pebbleDensity: 6,
  },
  sky: { top: '#1E7BFF', horizon: '#BDEFFF', fog: '#CFEFFF' },
};
