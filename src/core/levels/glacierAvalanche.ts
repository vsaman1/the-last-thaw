import type { LevelDef } from '../types';

/*
 * LEVEL 5 — "GLACIER AVALANCHE": the lower avalanche track of an alpine mountain, an OPEN, maze-like
 * slope (halfWidth 160, relief rolls and braided gullies, no random tors) from a snow cirque down
 * through moraine couloirs, an icefall and its crevasse, a momentum ridge, forest belts and an alpine
 * village into a gorge, where a dam only a grown iceberg can burst holds the glacier's meltwater river
 * in a reservoir above the last drop to the sea. Start small (scale 0.8, 18 t); glacier ice is
 * physical blocks you absorb (momentum conserved: it slows you, but you grow, up to 108 t).
 * Straight course along +Z (s ≈ z); d > 0 = right.
 *
 * ROUTE MAP (s, d in m)
 *   s 30         spawn in the cirque (hw 50 → 160 by s 160)
 *   s 150–440    THREE COULOIRS split by moraines M1 (d −22 → −80) and M2 (d 22 → 84):
 *                LEFT   ice couloir: four fields (8.9–14.3 t, 44 t) — slow at first (~13 m/s), you grow
 *                CENTRE fast (~20 m/s): a tor slalom (s 200–344) and a 7 t bait field
 *                RIGHT  forest, two lone blocks (bait) and a crag; M2 seals it into the wide crevasse:
 *                       DEAD END (fell; runs reach its lip at ~20 m/s, it needs > 34)
 *   s 440        ICEFALL CLIFF across the slope (12 m, waterfall 1) with the CREVASSE at its foot:
 *                10 m wide on the left (clears from ~10 m/s), 20 m in the centre (~16 m/s: 14 falls),
 *                50 m on the right. Fatal: falling in ends the run.
 *   s 500        the MELTWATER RIVER springs from a cave at the foot of the pocket wall (its spring pool at
 *                d −117: the icefall's meltwater, out of the rock); it runs down the left of the line
 *                (d −96 … −42), cuts a notch through the ridge, falls over band 2 and the rock band,
 *                passes the village, runs down the gorge's left side (d −10) into the reservoir and over
 *                the final falls to the sea (12 m wide, 2.3 m banks, 1 m deep, 4 m/s). Its banks hold an
 *                iceberg under ~47 t (r ≤ 2.4 m): TRAP — a small one that falls in is carried past every
 *                field to the dam (from s 620: ~120 s afloat, nothing absorbed, stuck); a grown one
 *                rides over it
 *   s 452–625    the POCKET on the far left (walls at d −130 / s 610–625): a 58 t bait field inside;
 *                DEAD END (stuck). Mid-slope fields: line (s 520 / 570, 14 / 19 t) on the left, centre
 *                route (s 505, 22 t) on the right of a tor (s 540–555, d −6..2)
 *   s 650        MOMENTUM RIDGE, a 7 m snow mound wall to wall. TRAP: the 76 t field at its foot
 *                (s 626, d 20) — swallow it and you roll back off the crest (stuck)
 *   s 680–745    closed slot gully on the lower left: DEAD END (stuck)
 *   s 760        ICEFALL BAND (14 m, sheer d −140..60, waterfall 2); ride round its right end
 *   s 790–890    steep line fields (s 800 / 850, 24 / 22 t, d −40 / −30); right forest route fields
 *                (s 700 / 800 / 860, 23 / 34 / 36 t, d 86–105); forest belt s 865–890; ski lift
 *   s 925–1045   VILLAGE: main street (d −6) with a chalet, a barn and a chalet on its left side that
 *                the line ploughs head-on (s 950 / 990 / 1028), a chalet opposite, cars parked on the
 *                street; farm track (d 38) with barn, silo, log pile, a parked car and a fence along it
 *   s 1062       ROCK BAND above the gorge (10 m, sheer d −40..40, waterfall 3)
 *   s 1040–1200  the funnel narrows to the GORGE (hw 70 → 18): the river on its left, the avalanche's
 *                way on the dry right (in the river's current even a 99 t iceberg slows to ~6 m/s)
 *   s 1168–1210  the RESERVOIR (level 42.2 m, 226 grid vertices, 4,200 m³) behind the
 *   s 1215       DAM across the gorge (scale 1.0, span 38.9 = wall to wall, the river through its left
 *                monolith, the line into its centre one). Breaking it releases the lake down the river:
 *                333 m³/s from one monolith, 670–740 from two. Rock buttresses at s 1209 key it into
 *                the walls (a small iceberg slipped round its end in the first GPU playtest)
 *   s 1255       FINAL WATERFALL (26 m, waterfall 4); coast s 1345, finish s 1365, course end 1520
 * Ice per route: line 123 t (fields 0–3, 8–9, 13–14), centre route 121 t (4, 10, 11, 15–16); baits:
 * right-couloir blocks 8.5 t, pocket 58 t, trap 76 t.
 *
 * DAM MATHS. Break impulse per monolith 1500 t·m/s (scale 1.0); 1.25·v·M ≥ 1500 ⇔ M·v ≥ 1200:
 * full 108 t from 11.1 m/s, 100 t 12, 80 t 15, 70 t 17.1, 60 t 20, 48 t 25. Floating the last
 * ~45 m on the reservoir, routes hit it at 16–20 m/s, so the gate is ~60–75 t at the dam ≈ 57–72 t
 * absorbed ≈ half to 60 % of a route's ice; skip-the-ice runs arrive with 8–15 t (M·v ≤ 330).
 * Scale 1.1 (M·v ≥ 1452) failed three line variants of 78–84 t once the reservoir slowed them; 1.15+
 * stalls an 84 t iceberg in its rubble.
 *
 * WATER BUDGET: 2000 m, 10 m/rad (1.5x the 1315 m run): skip runs reach the dam with 0.4–0.7 of
 * their ice (afloat they do not melt); absorbed ice adds water (the line finishes with 5x its
 * starting ice).
 *
 * BALANCE (seed 5501, real budget and chipping, path-pursuit autopilot; time / absorbed / peak):
 *   line (left couloir, icefall drop, village)   complete 96.9 s / 94.8 t / 105.3 t, 3 buildings,
 *                                                4 waterfalls, dam hit with 99 t at 17.7 m/s, flood
 *                                                333 m³/s, 90.6 t at the sea (96.6 s before the
 *                                                river sprang from the pocket wall's cave; its
 *                                                impact, flood and the rows below date from then)
 *   line lanes −4 / −2 / +2                      complete 108.4 / 95.8 / 104.4 s (78–97 t absorbed);
 *                                                +4 misses the fields (41 t) and stops at the dam
 *   centre route (centre couloir, 20 m jump,     complete 91.5 s / 97.4 t / 108 t, 3 waterfalls,
 *   ridge right, round band 2, right forest)     dam hit with 101 t at 19.8 m/s
 *   mix (centre couloir, then the line's fields) complete 99.9 s / 74.4 t / 85 t (78 t at 16.7 m/s)
 *   skip, centre / left (no ice)                 stuck at the dam (s 1211), pinned in the reservoir:
 *                                                15 t at 22 / 8 t at 25 m/s
 *   a small iceberg dropped in the river         carried from s 620 to the dam, stuck (137 s)
 *   centre route + the trap field                stuck on the ridge (s 631) after 90 t absorbed
 *   right couloir at full speed                  fell into the wide crevasse (s 486)
 *   placed: pocket stuck (s 604), closed gully stuck (s 740); centre crevasse ≤ 14 m/s fell,
 *   ≥ 16 m/s clears; left crevasse ≤ 8 m/s fell, ≥ 10 m/s clears; hugging either gorge wall at
 *   18 m/s a small iceberg stops at the dam
 */
export const glacierAvalanche: LevelDef = {
  id: 'glacier-avalanche',
  index: 5,
  name: 'Glacier Avalanche',
  subtitle: 'Start small. Read the mountain: swallow the glacier, snowball, burst the dam.',
  seed: 5501,
  bounds: { minX: -240, maxX: 240, minZ: -120, maxZ: 1540 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 230.3, halfWidth: 50 },
    { x: 0, z: 60, floor: 222.9, halfWidth: 120 },
    { x: 0, z: 160, floor: 207.2, halfWidth: 160 },
    { x: 0, z: 440, floor: 170.8, halfWidth: 160 },
    { x: 0, z: 640, floor: 149.7, halfWidth: 160 },
    { x: 0, z: 760, floor: 135.3, halfWidth: 160 },
    { x: 0, z: 900, floor: 115.7, halfWidth: 160 },
    { x: 0, z: 1040, floor: 98.9, halfWidth: 70 },
    { x: 0, z: 1062, floor: 96.25, halfWidth: 58 },
    { x: 0, z: 1140, floor: 84.55, halfWidth: 22 },
    { x: 0, z: 1200, floor: 75.55, halfWidth: 18 },
    { x: 0, z: 1255, floor: 67.85, halfWidth: 18 },
    { x: 0, z: 1280, floor: 66.2, halfWidth: 26 },
    { x: 0, z: 1345, floor: 62.0, halfWidth: 60 },
    { x: 0, z: 1420, floor: 57.0, halfWidth: 100 },
    { x: 0, z: 1520, floor: 51.0, halfWidth: 140 },
  ],
  cliffs: [
    { s: 440, drop: 12 },
    { s: 760, drop: 14, d: -40, width: 200 },
    { s: 1062, drop: 10, d: 0, width: 80 },
    { s: 1255, drop: 26 },
  ],
  wallHeight: 40,
  wallRamp: 18,
  startS: 30,
  coastS: 1345,
  finishS: 1365,
  theme: 'alpine',
  iceberg: { scale: 0.8, mass: 18 },
  relief: {
    roll: 3,
    rollScale: 160,
    gullies: 2.5,
    gullySpacing: 50,
  },
  features: [
    // 0-1 Moraines M1 / M2 split the upper slope into three couloirs; M2 runs over the icefall
    // into the wide crevasse, sealing the right couloir.
    {
      type: 'ridge',
      points: [{ s: 150, d: -22 }, { s: 250, d: -62 }, { s: 370, d: -80 }],
      width: 9,
      height: 10,
    },
    {
      type: 'ridge',
      points: [
        { s: 150, d: 22 },
        { s: 250, d: 60 },
        { s: 350, d: 78 },
        { s: 455, d: 84 },
        { s: 520, d: 62 },
      ],
      width: 9,
      height: 10,
    },
    // 2-4 The crevasse at the foot of the icefall cliff (s 440): narrow on the left (clears from
    // ~10 m/s off the drop), wider in the centre (~16 m/s), far too wide on the right.
    { type: 'ravine', points: [{ s: 447.5, d: -178 }, { s: 447.5, d: -50 }], width: 10, depth: 12 },
    { type: 'ravine', points: [{ s: 452.5, d: -50 }, { s: 452.5, d: 55 }], width: 20, depth: 12 },
    { type: 'ravine', points: [{ s: 467.5, d: 55 }, { s: 467.5, d: 178 }], width: 50, depth: 12 },
    // 5-6 The pocket on the far left below the crevasse (mouth s 452–480).
    { type: 'ridge', points: [{ s: 480, d: -130 }, { s: 610, d: -122 }], width: 9, height: 10 },
    { type: 'ridge', points: [{ s: 610, d: -122 }, { s: 625, d: -178 }], width: 9, height: 10 },
    // 7 Momentum ridge: a snow mound wall to wall.
    {
      type: 'ridge',
      points: [{ s: 650, d: -175 }, { s: 650, d: 175 }],
      width: 40,
      height: 7,
      profile: 'mound',
    },
    // 8 A closed slot gully on the lower left: a dead end.
    { type: 'gully', points: [{ s: 680, d: -110 }, { s: 745, d: -148 }], width: 14, depth: 7, closed: true },
    // 9-10 Village: main street and farm track.
    { type: 'road', s0: 925, s1: 1045, d: -6, width: 7 },
    { type: 'road', s0: 930, s1: 1030, d: 38, width: 5 },
    // 11-15 Rock tors (short wall spines): a slalom in the centre couloir, crags in the right one,
    // a crag splitting the mid-slope.
    { type: 'ridge', points: [{ s: 200, d: -12 }, { s: 212, d: -6 }], width: 8, height: 8 },
    { type: 'ridge', points: [{ s: 262, d: 18 }, { s: 276, d: 28 }], width: 8, height: 8 },
    { type: 'ridge', points: [{ s: 330, d: -30 }, { s: 344, d: -22 }], width: 8, height: 8 },
    { type: 'ridge', points: [{ s: 260, d: 132 }, { s: 280, d: 145 }], width: 10, height: 9 },
    { type: 'ridge', points: [{ s: 540, d: -6 }, { s: 555, d: 2 }], width: 9, height: 8 },
    // 16 A snow mound on the open lower slope.
    {
      type: 'ridge',
      points: [{ s: 815, d: 45 }, { s: 835, d: 70 }],
      width: 22,
      height: 4,
      profile: 'mound',
    },
    // 17-18 Rock buttresses just above the dam, from the floor edge up into the gorge walls: the
    // wall foot is rideable ~5 m past the floor edge, so without them a small iceberg slips round
    // the dam's ends.
    { type: 'ridge', points: [{ s: 1208.8, d: 17.8 }, { s: 1208.8, d: 34 }], width: 6, height: 10 },
    { type: 'ridge', points: [{ s: 1208.8, d: -17.8 }, { s: 1208.8, d: -34 }], width: 6, height: 10 },
    // 19 The glacier's meltwater river: the icefall's meltwater sinks into the rock and springs from a
    // cave at the foot of the pocket wall's outer face below the crevasse (source 'cave': its spring
    // pool at s 500, d −117; the wall rises 9.3 m within 15 m behind the mouth), runs through a notch
    // in the momentum ridge, over icefall band 2 and the rock band (waterfalls), past the village into
    // the gorge, held by the dam as a reservoir, then over the final falls to the sea. Its 2.3 m banks
    // hold an iceberg under ~47 t (r ≤ 2.4 m): a small one that falls in is carried past every field
    // to the dam; a grown one rides over it.
    {
      type: 'stream',
      source: 'cave',
      points: [
        { s: 500, d: -117 },
        { s: 505, d: -105 },
        { s: 600, d: -96 },
        { s: 700, d: -92 },
        { s: 760, d: -80 },
        { s: 850, d: -70 },
        { s: 920, d: -52 },
        { s: 1000, d: -42 },
        { s: 1062, d: -28 },
        { s: 1110, d: -16 },
        { s: 1150, d: -10 },
        { s: 1290, d: -10 },
        { s: 1380, d: -4 },
      ],
      width: 12,
      bank: 2.3,
      depth: 1.0,
      flow: 4,
    },
    // 20 A cross road joining the main street and the farm track.
    { type: 'road', s0: 972, s1: 978, d: 16, width: 46 },
  ],
  obstacles: [
    // Left couloir: the absorb line.
    { kind: 'iceField', s: 175, d: -78, scale: 0.5, count: 6, spread: 4 },
    { kind: 'iceField', s: 240, d: -100, scale: 0.55, count: 6, spread: 4 },
    { kind: 'iceField', s: 300, d: -108, scale: 0.55, count: 6, spread: 4 },
    { kind: 'iceField', s: 350, d: -100, scale: 0.6, count: 6, spread: 4 },
    // Centre couloir bait; right couloir blocks (bait in a dead end).
    { kind: 'iceField', s: 280, d: 2, scale: 0.5, count: 5, spread: 4 },
    { kind: 'iceBlock', s: 200, d: 110, scale: 0.7 },
    { kind: 'iceBlock', s: 290, d: 118, scale: 0.7 },
    // Pocket bait.
    { kind: 'iceField', s: 560, d: -152, scale: 0.9, count: 7, spread: 6 },
    // Mid-slope: line fields (left) and centre fields.
    { kind: 'iceField', s: 520, d: -45, scale: 0.6, count: 6, spread: 4 },
    { kind: 'iceField', s: 570, d: -35, scale: 0.65, count: 6, spread: 4 },
    { kind: 'iceField', s: 505, d: 25, scale: 0.7, count: 6, spread: 4 },
    { kind: 'iceField', s: 700, d: 86, scale: 0.7, count: 6, spread: 4 },
    // Trap field at the foot of the momentum ridge.
    { kind: 'iceField', s: 626, d: 20, scale: 1.0, count: 7, spread: 6 },
    // Below the icefall: steep line fields, right forest fields.
    { kind: 'iceField', s: 800, d: -40, scale: 0.7, count: 6, spread: 4 },
    { kind: 'iceField', s: 850, d: -30, scale: 0.7, count: 6, spread: 4 },
    { kind: 'iceField', s: 800, d: 105, scale: 0.8, count: 6, spread: 4 },
    { kind: 'iceField', s: 860, d: 100, scale: 0.8, count: 6, spread: 4 },
    // Forest belts (upper right couloir, below the icefall) and the ski lift.
    { kind: 'pine', s: 210, d: 128 },
    { kind: 'pine', s: 250, d: 100 },
    { kind: 'pine', s: 320, d: 140 },
    { kind: 'pine', s: 870, d: -90 },
    { kind: 'pine', s: 878, d: -82 },
    { kind: 'pine', s: 872, d: 4 },
    { kind: 'pine', s: 880, d: 30 },
    { kind: 'pine', s: 885, d: 55 },
    { kind: 'pine', s: 876, d: 140 },
    { kind: 'skiLiftPylon', s: 880, d: 72 },
    { kind: 'skiLiftPylon', s: 910, d: 76 },
    // Village: buildings along the main street (left row on the line) and the farm track.
    { kind: 'chalet', s: 950, d: -20 },
    { kind: 'barn', s: 990, d: -23 },
    { kind: 'chalet', s: 1028, d: -18 },
    { kind: 'chalet', s: 968, d: 9 },
    { kind: 'car', s: 975, d: -5, yaw: 0 },
    { kind: 'car', s: 1012, d: -7, yaw: 0 },
    { kind: 'barn', s: 958, d: 50 },
    { kind: 'silo', s: 990, d: 47 },
    { kind: 'car', s: 942, d: 38, yaw: 0 },
    { kind: 'fence', s: 1004, d: 32, span: 34, yaw: Math.PI / 2 },
    { kind: 'logPile', s: 1018, d: 45 },
    // The dam across the gorge (the channel the meltwater river runs down).
    { kind: 'dam', s: 1215, d: 0, scale: 1.0, span: 38.9 },
    // Forest belts: the right couloir, the left flank, the belt above the village, the outskirts.
    { kind: 'pine', s: 185, d: 140 },
    { kind: 'pine', s: 215, d: 112 },
    { kind: 'pine', s: 240, d: 145 },
    { kind: 'pine', s: 270, d: 108 },
    { kind: 'pine', s: 305, d: 128 },
    { kind: 'pine', s: 335, d: 150 },
    { kind: 'pine', s: 690, d: -70 },
    { kind: 'pine', s: 705, d: -60 },
    { kind: 'pine', s: 722, d: -66 },
    { kind: 'pine', s: 738, d: -58 },
    { kind: 'pine', s: 868, d: -130 },
    { kind: 'pine', s: 882, d: -110 },
    { kind: 'pine', s: 890, d: -150 },
    { kind: 'pine', s: 888, d: 118 },
    { kind: 'pine', s: 870, d: 155 },
    { kind: 'pine', s: 935, d: -74 },
    { kind: 'pine', s: 960, d: -70 },
    { kind: 'pine', s: 990, d: -68 },
  ],
  water: { metres: 2000, turnMetresPerRadian: 10 },
  line: [
    { s: 30, d: 0 },
    { s: 110, d: -20 },
    { s: 175, d: -78 },
    { s: 240, d: -100 },
    { s: 300, d: -108 },
    { s: 350, d: -100 },
    { s: 400, d: -90 },
    { s: 440, d: -88 },
    { s: 470, d: -80 },
    { s: 500, d: -58 },
    { s: 520, d: -45 },
    { s: 570, d: -35 },
    { s: 650, d: -25 },
    { s: 740, d: -35 },
    { s: 760, d: -36 },
    { s: 800, d: -40 },
    { s: 850, d: -30 },
    { s: 900, d: -22 },
    { s: 950, d: -20 },
    { s: 990, d: -23 },
    { s: 1028, d: -18 },
    { s: 1062, d: 0 },
    { s: 1100, d: 1 },
    { s: 1520, d: 1 },
  ],
  decor: {
    sceneryTreeDensity: 6,
    bushDensity: 2,
    grassTuftDensity: 14,
    pebbleDensity: 6,
  },
};
