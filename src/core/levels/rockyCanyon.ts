import type { LevelDef } from '../types';

/*
 * LEVEL 2 — "ROCKY CANYON". Red-rock canyon, normal iceberg (scale 1, 30 t), course length 1177.2 m.
 * All positions are arc length s (m) / lateral d (m, + = right of travel). Start → coast = 905 m.
 * cellSize 2 so island walls, the kicker lip and the ravine are crisp. Grid rows run every 2 m of
 * world z and the canyon runs exactly along +Z from s ≈ 150 to 535 and 765 to 855 (x = -30 / 34),
 * so the three cliff lips and the ravine lie along grid rows; on that stretch s = z + 4.343.
 *
 *   s 0–30      cirque shelf, start at s = 30 (floor 163.2, halfWidth 21.7), facing +Z
 *   s 30–165    CHUTE 1, slope 0.19–0.20, narrows to halfWidth 16.6. Rocks, a log pile (s 84), pines on
 *               the ledges, FOOTBRIDGE 1 at s 118 (posts at d 0, ±8.3, ±16.6: thread at d ≈ -4 or
 *               knock a post out and drop the decks), boulder s 136. ~18 m/s at the first lip.
 *   s 178       WATERFALL 1, drop 10 m (lip y 137.2), run-out s 178–220 at 0.08. Lands s ≈ 202 at 23 m/s.
 *   s 220–394   THE SPLIT on a gentler bench (0.067; the iceberg cruises at ~21 m/s): two rock ISLANDS
 *               (d -8, width 5, height 9) at s 222–288 and 322–394 with a crossover WINDOW s 288–322.
 *               - LEFT, the narrow SLOT (d -24.5 … -10.5, ~13 m): a boulder slalom — boulder s 238
 *                 d -14 (pass left), boulder s 278 d -21 (pass right), rocks s 322 d -21, boulder s 358
 *                 d -13.5 (pass left) — then straight onto the KICKER. A hit costs ~50 % of your speed
 *                 and 5–9 % ice; crash early and the window is your only way out of the slot.
 *               - RIGHT, the wide channel (~31 m): log piles s 238/256 and the SINKHOLE — basin s 338
 *                 d 10 (r 8, 4 m deep) backed by a mound s 352 (r 8, 2 m). Enter it slower than
 *                 ~7 m/s and you rock in the bowl until the trap rule fails you (~10–12 s); hit it at
 *                 15+ m/s and its far wall launches you ~70 m over the ravine's bypass (s 345 → 415).
 *                 The safe line skirts it along the right wall (d ≈ 20).
 *   s 394.5     THE RAVINE: gap s 394.5–424 (29.5 m), 7 m deep, d -26 … 6. KICKER ramp lip s 394.5 on the
 *               slot's axis (d -18, width 9, 9 m long, 3.5 m high, lip slope 0.78). Measured with exact
 *               kicker lips (2026-10-17): take-off ≥ 13.3 m/s clears it (approach 15 m/s), 12.8 m/s or
 *               less (approach ≤ 14.5) falls in (the run ends: 'fell'); at the slot's ~19.5 m/s the
 *               jump is ~60 m (lands s ≈ 455, 19 m drop). BYPASS d 6 … 24.4 on the right for the slow
 *               and the wide channel; after it a rubble field (boulders s 436/460 d 17, rocks s 447 d 10,
 *               s 470 d 6) makes bypass riders weave while kicker landings (d -20 … -8) stay clean.
 *   s 490       WATERFALL 2, drop 14 m (lip y 101.4), run-out s 490–534 at 0.07; lands s ≈ 526.
 *   s 534–790   CHUTE 2, slope 0.21, an S-bend, halfWidth 17–20; reaches ~31 m/s. FOOTBRIDGE 2 at s 548
 *               (span 40: posts at d ±4, ±12, ±20), boulders s 580 d 8 / s 596 d -8, the stone-barrier
 *               GATE (s 616 d 5.5 and s 640 d -5.5: one clean lane at d ≈ 0), log piles, and the
 *               RANGER CABIN (house × 0.7, s 700 d 11, at the end of a gravel track from a trailhead
 *               at s 668) the line smashes at ~25 m/s (+1 building,
 *               ~4.7 % ice: at ~15 t it only breaks above ~15 m/s — slower, you bounce off it).
 *   s 800       WATERFALL 3, drop 22 m (lip y 33.0): at ~22 m/s the iceberg flies to s ≈ 845.
 *   s 845–935   CANYON MOUTH widening to halfWidth 42, slope 0.084: a corral fence (scale 0.75, s 858
 *               d -19 … -1), the trading post (house × 0.6 s 872 d -20, its car parked in a gravel
 *               yard s 874–886 d -16 … -8), a WATER TOWER (× 0.8, s 884 d 22: clip a leg and the tank
 *               drops 14 m), then the beach (sand from s ≈ 910) and fishing boats moored offshore.
 *   s 935       coast (world (23.8, 0, 919.2)); finish s 955, 20 m out to sea; course ends s 1177.
 *
 * THE LINE (LevelDef.line): slot → kicker → clean side → gate → cabin → right of the corral. The
 * autopilot aims 18 + 0.9·speed m ahead, so line points lead each obstacle by ~15 m. Alternatives:
 * - SINKHOLE launch (wide channel, through the bowl at speed): the hidden expert line, within 0.5 s
 *   and 1 % ice of the slot (longer flight), but enter it slow and it keeps you.
 * - SAFE route (wide channel along the right wall, bypass, weave the rubble): ~1 s slower, ~6 % less ice.
 * - BAIL-OUT (slot to the window, then the left lane past the sinkhole and the bypass): ~6 s slower.
 * - Naive centreline: smashes footbridge 1's centre post, then falls into the ravine (fell, s ≈ 419).
 * - No input: drifts into the wide channel and the bypass, crashes through the gate and the mouth;
 *   ~16 s slower with a third of the ice of the line (or worse).
 *
 * WATER BUDGET: 1180 m + 10 m/rad. A smooth line lays ~765 m of river on land (~160 m is in the air:
 * 25 m off waterfall 1, ~60 m over the ravine, ~37 m off waterfall 2, ~45 m off waterfall 3) and turns
 * little, so melting costs ~66 % and the cabin + a log pile chip ~5.5 %: the line finishes with ~29 %
 * ice. Weaving, rubble and barrier hits (each stone of a gate costs 1–3 %) push the other routes to
 * 20–23 % (no input 10 %); a wall-to-wall weave or a slow crawl melts. There are no refills.
 */
export const rockyCanyon: LevelDef = {
  id: 'rocky-canyon',
  index: 2,
  name: 'Rocky Canyon',
  subtitle: 'Thread the slot or ride the sinkhole, jump the ravine, drop three falls to the sea.',
  seed: 2207,
  bounds: { minX: -200, maxX: 200, minZ: -100, maxZ: 1200 },
  cellSize: 2,
  seaLevel: 0,
  // Base floors (each cliff's drop is subtracted downstream of its lip).
  course: [
    { x: 0, z: 0, floor: 166, halfWidth: 26 },
    { x: 0, z: 24, floor: 164.6, halfWidth: 22 },
    { x: -6, z: 64, floor: 156.5, halfWidth: 18 },
    { x: -22, z: 110, floor: 146.8, halfWidth: 16 },
    { x: -30, z: 140, floor: 140.55, halfWidth: 17 },
    { x: -30, z: 160, floor: 138.15, halfWidth: 18 },
    { x: -30, z: 185, floor: 136.45, halfWidth: 20 },
    { x: -30, z: 215, floor: 134.05, halfWidth: 24 },
    { x: -30, z: 260, floor: 130.9, halfWidth: 25 },
    { x: -30, z: 320, floor: 127, halfWidth: 26 },
    { x: -30, z: 380, floor: 123.1, halfWidth: 25 },
    { x: -30, z: 440, floor: 115.9, halfWidth: 22 },
    { x: -30, z: 490, floor: 110.9, halfWidth: 20 },
    { x: -30, z: 530, floor: 108.1, halfWidth: 20 },
    { x: -18, z: 590, floor: 97.1, halfWidth: 19 },
    { x: 10, z: 650, floor: 82.5, halfWidth: 17 },
    { x: 28, z: 710, floor: 68.7, halfWidth: 17 },
    { x: 34, z: 750, floor: 60.6, halfWidth: 18 },
    { x: 34, z: 775, floor: 57.6, halfWidth: 19 },
    { x: 34, z: 800, floor: 56.1, halfWidth: 21 },
    { x: 34, z: 840, floor: 52.9, halfWidth: 26 },
    { x: 30, z: 880, floor: 49.7, halfWidth: 34 },
    { x: 22, z: 930, floor: 45.1, halfWidth: 44 },
    { x: 14, z: 980, floor: 40.5, halfWidth: 54 },
    { x: 8, z: 1040, floor: 35.7, halfWidth: 62 },
    { x: 4, z: 1100, floor: 31.0, halfWidth: 66 },
    { x: 0, z: 1160, floor: 26.4, halfWidth: 66 },
  ],
  cliffs: [
    { s: 178, drop: 10 },
    { s: 490, drop: 14 },
    { s: 800, drop: 22 },
  ],
  wallHeight: 48,
  wallRamp: 24,
  startS: 30,
  coastS: 935,
  finishS: 955,
  theme: 'canyon',
  iceberg: { scale: 1, mass: 30 },
  features: [
    // The split: two rock islands with a crossover window between them.
    { type: 'island', s0: 222, s1: 288, d: -8, width: 5, height: 9 },
    { type: 'island', s0: 322, s1: 394, d: -8, width: 5, height: 9 },
    // The sinkhole in the wide channel: a bowl backed by a mound (trap when slow, kicker when fast).
    { type: 'basin', s: 338, d: 10, radius: 8, depth: 4 },
    { type: 'hill', s: 352, d: 10, radius: 8, height: 2 },
    // The ravine and the kicker on the slot's axis; the bypass is d 6 … 24.4.
    { type: 'ramp', s: 394.5, d: -18, width: 9, length: 9, height: 3.5 },
    { type: 'gap', s: 394.5, length: 29.5, depth: 7, d: -10, width: 32 },
    // The trading post's gravel yard at the canyon mouth (its car stands here).
    { type: 'parking', s: 880, d: -12, length: 12, width: 8 },
    // The ranger cabin's gravel track: it comes down the right bank from a trailhead to the door.
    { type: 'road', s0: 668, s1: 692, d: 13, width: 4, surface: 'gravel', start: 'trailhead' },
  ],
  obstacles: [
    // Chute 1
    { kind: 'rockSmall', s: 52, d: 7 },
    { kind: 'rockCluster', s: 68, d: -9, count: 3, spread: 2.5 },
    { kind: 'logPile', s: 84, d: 7 },
    { kind: 'pine', s: 94, d: -14.5 },
    { kind: 'footbridge', s: 118, d: 0 },
    { kind: 'boulder', s: 136, d: 6 },
    { kind: 'pine', s: 146, d: 14.5 },
    { kind: 'rockCluster', s: 156, d: 7, count: 3, spread: 2.5 },
    // The split, left: the narrow slot's boulder slalom.
    { kind: 'boulder', s: 238, d: -14 },
    { kind: 'boulder', s: 278, d: -21 },
    { kind: 'rockCluster', s: 322, d: -21, count: 3, spread: 2 },
    { kind: 'boulder', s: 358, d: -13.5 },
    // Pines clinging to the island crests.
    { kind: 'pine', s: 250, d: -8 },
    { kind: 'pine', s: 272, d: -8 },
    { kind: 'pine', s: 365, d: -8 },
    // The split, right: the wide channel, and the bypass beside the ravine.
    { kind: 'logPile', s: 238, d: 4 },
    { kind: 'logPile', s: 256, d: 12 },
    { kind: 'rockMedium', s: 276, d: 8 },
    { kind: 'pine', s: 265, d: 22 },
    { kind: 'logPile', s: 398, d: 11 },
    { kind: 'rockCluster', s: 410, d: 19, count: 3, spread: 2 },
    // After the ravine: rubble on the bypass side, a clean landing on the kicker side.
    { kind: 'boulder', s: 436, d: 17 },
    { kind: 'rockCluster', s: 447, d: 10, count: 3, spread: 2.5 },
    { kind: 'boulder', s: 460, d: 17 },
    { kind: 'rockCluster', s: 470, d: 6, count: 3, spread: 2.5 },
    { kind: 'pine', s: 462, d: -18 },
    // Chute 2: footbridge, boulders, the barrier gate, log piles and the ranger cabin.
    { kind: 'footbridge', s: 548, d: 0, span: 40 },
    { kind: 'rockCluster', s: 566, d: -7, count: 3, spread: 2.5 },
    { kind: 'boulder', s: 580, d: 8 },
    { kind: 'boulder', s: 596, d: -8 },
    { kind: 'stoneBarrier', s: 616, d: 5.5, count: 3 },
    { kind: 'stoneBarrier', s: 640, d: -5.5, count: 3 },
    { kind: 'logPile', s: 684, d: -8 },
    { kind: 'house', s: 700, d: 11, scale: 0.7 },
    { kind: 'pine', s: 708, d: -14 },
    { kind: 'logPile', s: 722, d: 6.5 },
    { kind: 'rockCluster', s: 740, d: -6, count: 3, spread: 2.5 },
    { kind: 'pine', s: 758, d: 15 },
    // Canyon mouth: corral, trading post (car in its yard), water tower.
    { kind: 'rockCluster', s: 828, d: -8, count: 3, spread: 2.5 },
    { kind: 'fence', s: 858, d: -10, span: 18, scale: 0.75 },
    { kind: 'house', s: 872, d: -20, scale: 0.6 },
    { kind: 'car', s: 880, d: -12 },
    { kind: 'waterTower', s: 884, d: 22, scale: 0.8 },
    // Fishing boats moored on the open sea off the canyon mouth.
    { kind: 'boat', s: 948, d: -16 },
    { kind: 'boat', s: 958, d: 18 },
    { kind: 'boat', s: 966, d: 30 },
  ],
  line: [
    { s: 30, d: 0 },
    { s: 60, d: 2 },
    { s: 84, d: 5 },
    { s: 104, d: -4 },
    { s: 140, d: -4 },
    { s: 160, d: -8 },
    { s: 178, d: -11 },
    { s: 205, d: -16 },
    { s: 220, d: -21 },
    { s: 255, d: -21 },
    { s: 275, d: -14.5 },
    { s: 318, d: -14.5 },
    { s: 340, d: -20 },
    { s: 366, d: -19.5 },
    { s: 394.5, d: -18 },
    { s: 450, d: -14 },
    { s: 490, d: 0 },
    { s: 530, d: 1 },
    { s: 640, d: 0.5 },
    { s: 655, d: 2 },
    { s: 692, d: 10 },
    { s: 712, d: 9 },
    { s: 730, d: 3 },
    { s: 800, d: 0 },
    { s: 830, d: 3 },
    { s: 845, d: 9 },
    { s: 875, d: 8 },
    { s: 905, d: 2 },
    { s: 935, d: 0 },
    { s: 1000, d: 0 },
  ],
  water: { metres: 1180, turnMetresPerRadian: 10 },
  decor: {
    sceneryTreeDensity: 3,
    bushDensity: 3,
    grassTuftDensity: 16,
    pebbleDensity: 10,
  },
};
