import type { CourseCoord, LevelDef, TerrainFeature } from '../types';

/*
 * LEVEL 7 — "RAVINE RUN". An open red-rock mesa slope, 400 m wide, cut by six fatal ravines; canyon
 * theme, normal iceberg (scale 1, 30 t). The course runs straight along +Z (x = 0), so s = z and
 * d = −x. Start s 30 → coast s 1420 (1390 m), finish s 1440. cellSize 2.5: 281 × 713 = 200,353
 * vertices, terrain ~1.0–1.4 s CPU, route search ~2.4–3.9 s, 168 bodies.
 *
 * THE SLOPE (floor after the bands): steep chutes build speed, gentle benches bleed it, and every
 * ravine sits on a bench, so jumping one naturally takes far more speed than its width suggests.
 *   s 30–200     chute 1, 0.20 (halfWidth 60 → 200 by s 150). Three gullies fan out from s 60:
 *                left (to d −150, 20 m wide of R1's narrow spot), centre (ends at d +8, 18 m right
 *                of K1: follow it and you miss the kicker), right (to d +100, R1's widest part)
 *   s 200–330    bench 1, 0.07: R1
 *   s 330–450    0.10; a crestable 2.5 m mound across the centre lane at s 365–375
 *   s 450        BAND 1, 14 m, sheer d −200 … 60, its lip diagonal (skew 0.05: s 443.5 at the left
 *                wall, 456.5 at d 60): a waterfall. R2 "the moat" just below it in the left lane
 *   s 450–580    chute 2, 0.12;   s 580–700 bench 2, 0.05: R3;   s 700–800 chute 3, 0.11
 *   s 800.5      BAND 2 "THE LEAP", 16 m, sheer d −200 … 110, the 44 m gorge R4 at its foot
 *   s 800–900    lower mesa, 0.07 (ranger post: road, water tower, cabin, car)
 *   s 900–960    chute 4, 0.12;   s 960–1060 bench 3, 0.05: R5
 *   s 1100       BAND 3, 12 m, sheer d −140 … 140;   s 1100–1190 chute 5, 0.12
 *   s 1190–1335  bench 4, 0.05: R6;   s 1335 BAND 4, 12 m, sheer d −150 … 150;   beach to s 1420
 *
 * THE RAVINES. Each crossing ravine is a chain of segments of different widths: you choose WHERE to
 * cross. Narrow spots (8 m) carry a 2.3 m rock lip (a mound whose crest is the near rim); kicker
 * spots (28 m) a 3–3.5 m × 14 m kicker whose lip sits on a grid row; the rest is unjumpable.
 *   R1 "First Cut"   s 230–310: 22 | NARROW d −137 … −117 (rope bridge d −121, two boulders and
 *                    a rock cluster before it) | 22 | KICKER K1 d −10 | 40 m (d 42 … 170)
 *   R2 "The Moat"    s 451–473, d −228 … −75, 22 m below band 1: the left lane flies it or falls in
 *   R3 "Switchback"  s 595–680: 30 (d 50 … 165) | KICKER K3 d −5 | 22 | NARROW d −125 … −105
 *                    (boulder, cluster and tors around it) | 32 m to the left wall
 *   R4 "The Leap"    s 803.5–847.5 under band 2, d −228 … 132, 14 m deep (30 m below the lip):
 *                    K4 (1.5 m) on the band lip at d 0, a 1.5 m rock lip at d −150 … −130
 *   R5 "Rope Bridge" s 955–1010: 26 | NARROW d −140 … −120 (rope bridge d −122) | 26 | KICKER K5
 *                    d 10 | 26 m, ending at d 161: the ranger road passes its end
 *   R6 "Last Gash"   s 1195–1255: 24 | NARROW d −95 … −75 (boulder field) | 24 | KICKER K6 d 0 | 24
 *                    | NARROW d 130 … 154 (trail bridge d 150: the road lane's crossing) | 24
 *
 * THE MAZE. Wall ridges W1 (d ≈ −80 … −97) and W2 (d ≈ 100 … 128) split s 268–650 into three lanes:
 *   LEFT    R1's narrow lip → the moat → sub-lane A → R3's narrow lip. W5 splits off sub-lane B, a
 *           dead end above R3's 32 m part.
 *   CENTRE  K1 → band 1 → K3. W4 splits off the centre-right sub-lane, a dead end above R3's 30 m part.
 *   RIGHT   the ranger road (gravel, d 178, s 195–1190) round the ends of R1, R3, the Leap and R5,
 *           then R6's right narrow lip.
 *   Lower down W3/W7 and W6/W8 seal two middle-right pockets above the wide right parts of R5, R6.
 *   Relief: braided gullies (2 m), tors (7 m, 3 % of the floor, ≥ 30 m off the line). No roll: the
 *   relief is faded abruptly where a kicker face starts, and any step there (> ~0.3 m) launches a
 *   fast iceberg before the lip. relief.seed 124 is the only one of 400 tried that leaves all five
 *   kicker approaches calm (gullies 0.00 m there).
 *
 * JUMP THRESHOLDS (approach speed 30 m before the spot, straight on, no melting: falls / clears):
 *   K1 16 / 18 (take-off 14.0 / 16.1)   R1 narrow 10 / 12   K3 18 / 20   R3 narrow 10 / 12
 *   moat, off band 1: 14 / 16   K4 20 / 22 (lands s 850 at 22, s 867 at 28)   Leap left lip 20 / 22
 *   the gorge with no lip 24 / 26 (d −180), 26 / 28 (d 85)   K5 18 / 20   R5 narrow 10 / 12
 *   K6 18 / 20   R6 narrow 10 / 12   R6 right narrow 10 / 12 (every narrow spot clears 12 … 30)
 *   So a kicker spot needs 1.6–1.8× the speed of a narrow lip. Too slow, the run ends ~1.5 s after
 *   take-off (the plunge and the 0.6 s fall beat).
 *
 * ROUTES (real water budget 1600 m + 10 m/rad, chipping on; ravineRun.test.ts):
 *   route                        result           time    ice    waterfalls  knocked
 *   the line (kickers, centre)   complete         60.4 s  39.0 %  4           2 (log pile, water tower)
 *   the narrows (left lips)      complete         63.7 s  51.2 %  3           0
 *   the ranger road (safe)       complete         73.8 s  13.9 %  1           0
 *   naive centreline             fell, s 279      17.2 s
 *   no input                     fell, s 284      16.5 s
 *   Line take-offs: K1 18.1, K3 25.0, K4 26.9 (lands s 866; band 2's waterfall window ends at
 *   880.5), K5 29.0, K6 32.3 m/s; it smashes the log pile (s 322) and the ranger post's water tower
 *   (s 912, −4.9 % ice). The narrows fly 80–118 m off the lips at 29–34 m/s and skip both smashes.
 *   Dead ends (session tests): the centre-right sub-lane and sub-lane B above R3, the pockets above
 *   R5 and R6 — drifting in, or steering back toward the line, ends the run (fell or stuck). The
 *   right gully from the top drops a drifting iceberg into R1's 40 m part.
 *
 * SENSITIVE: the line's ice (39 %) and the Leap's landing (s 866, 14 m inside the waterfall window)
 * depend on the water-tower hit and the K3/K4 take-off speeds: re-check after contact or toppling
 * changes. Vehicles stand only on roads, buildings and fences beside them (user rule, tested); all
 * are parked except one ranger car driving its road at the ranger post; three boats moored offshore.
 */

const ALONG = Math.PI / 2;
type Pt = [number, number];
const pts = (...p: Pt[]): CourseCoord[] => p.map(([s, d]) => ({ s, d }));
/** A fatal ravine segment along a polyline. */
const ravine = (width: number, depth: number, ...p: Pt[]): TerrainFeature => ({
  type: 'ravine',
  points: pts(...p),
  width,
  depth,
});
/** A sheer rock spine (impassable). */
const wall = (...p: Pt[]): TerrainFeature => ({ type: 'ridge', points: pts(...p), width: 8, height: 10 });
/** A rounded rock lip: a mound ridge (crestable), its crest on a narrow spot's near rim. */
const lip = (a: Pt, b: Pt, height = 2.3): TerrainFeature => ({
  type: 'ridge',
  points: pts(a, b),
  width: 12,
  height,
  profile: 'mound',
});

export const ravineRun: LevelDef = {
  id: 'ravine-run',
  index: 7,
  name: 'Ravine Run',
  subtitle: 'An open red-rock mountainside cut by deadly ravines: pick your crossing, keep your speed.',
  seed: 7707,
  bounds: { minX: -350, maxX: 350, minZ: -120, maxZ: 1660 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 192.0, halfWidth: 45 },
    { x: 0, z: 30, floor: 189.6, halfWidth: 60 },
    { x: 0, z: 100, floor: 175.6, halfWidth: 160 },
    { x: 0, z: 150, floor: 165.6, halfWidth: 200 },
    { x: 0, z: 170, floor: 161.6, halfWidth: 200 },
    { x: 0, z: 200, floor: 155.6, halfWidth: 200 },
    { x: 0, z: 330, floor: 146.5, halfWidth: 200 },
    { x: 0, z: 450, floor: 134.5, halfWidth: 200 },
    { x: 0, z: 580, floor: 118.9, halfWidth: 200 },
    { x: 0, z: 700, floor: 112.9, halfWidth: 200 },
    { x: 0, z: 800, floor: 101.9, halfWidth: 200 },
    { x: 0, z: 900, floor: 94.9, halfWidth: 200 },
    { x: 0, z: 960, floor: 87.7, halfWidth: 200 },
    { x: 0, z: 1060, floor: 82.7, halfWidth: 200 },
    { x: 0, z: 1100, floor: 78.7, halfWidth: 200 },
    { x: 0, z: 1190, floor: 67.9, halfWidth: 200 },
    { x: 0, z: 1335, floor: 60.65, halfWidth: 200 },
    { x: 0, z: 1420, floor: 54.0, halfWidth: 200 },
    { x: 0, z: 1640, floor: 38.6, halfWidth: 200 },
  ],
  cliffs: [
    { s: 450, drop: 14, d: -70, width: 260, skew: 0.05 },
    { s: 800.5, drop: 16, d: -45, width: 310 },
    { s: 1100, drop: 12, d: 0, width: 280 },
    { s: 1335, drop: 12, d: 0, width: 300 },
  ],
  wallHeight: 45,
  wallRamp: 30,
  startS: 30,
  coastS: 1420,
  finishS: 1440,
  theme: 'canyon',
  iceberg: { scale: 1, mass: 30 },
  relief: {
    gullies: 2,
    gullySpacing: 45,
    outcrops: 7,
    outcropCover: 0.03,
    outcropScale: 26,
    lineClear: 30,
    seed: 124,
  },
  features: [
    // 0-2 Three gullies fanning out from the top: left, centre (ends 18 m right of K1), right.
    { type: 'gully', points: pts([60, -6], [150, -60], [236, -150]), width: 16, depth: 3 },
    { type: 'gully', points: pts([60, 0], [150, 4], [236, 8]), width: 16, depth: 2.5 },
    { type: 'gully', points: pts([60, 6], [150, 50], [250, 100]), width: 16, depth: 3 },
    // 3-7 R1 "First Cut" on bench 1: far left, NARROW, left, KICKER, wide right.
    ravine(22, 12, [240, -228], [247, -190], [254, -148]),
    ravine(8, 12, [254, -148], [256, -106]),
    ravine(22, 12, [256, -106], [265, -62]),
    ravine(28, 14, [265, -62], [275, 42]),
    ravine(40, 14, [275, 42], [288, 95], [290, 150]),
    // 8 Kicker K1; 9 rock lip at the narrow spot.
    { type: 'ramp', s: 255, d: -10, width: 14, length: 14, height: 3.5 },
    lip([250.2, -134], [250.8, -120]),
    // 10-11 Lane dividers W1 (left) and W2 (right), from R1 down to R3.
    wall([268, -95], [330, -88], [390, -97], [450, -80], [505, -87], [560, -79], [610, -90], [649, -95]),
    wall([300, 100], [370, 110], [450, 100], [530, 118], [612, 128]),
    // 12 Ranger road down the right lane (round the ends of R1, R3, the Leap and R5); a trail goes
    // on from the trailhead car park at its top end.
    { type: 'road', s0: 195, s1: 1190, d: 178, width: 7, start: 'trailhead' },
    // 13 Mound M1 across the centre lane.
    { type: 'ridge', points: pts([365, -70], [375, 90]), width: 24, height: 2.5, profile: 'mound' },
    // 14 R2 "The Moat" at the foot of band 1, left lane.
    ravine(22, 12, [462, -228], [462, -86]),
    // 15-16 Sub-lane dividers: W4 (centre), W5 (left).
    wall([520, 30], [572, 44], [624, 50]),
    wall([485, -150], [570, -146], [656, -140]),
    // 17-21 R3 on bench 2: wide right (dead end), KICKER, left, NARROW, far left (dead end).
    ravine(30, 12, [608, 150], [612, 100], [622, 50]),
    ravine(28, 14, [622, 50], [636, -40]),
    ravine(22, 12, [636, -40], [648, -94]),
    ravine(8, 12, [648, -94], [651, -141]),
    ravine(32, 12, [651, -141], [662, -185], [666, -230]),
    // 22 Kicker K3; 23 rock lip at the narrow spot.
    { type: 'ramp', s: 615, d: -5, width: 14, length: 14, height: 3 },
    lip([644.4, -108], [645.3, -122]),
    // 24 R4: the Leap's gorge at the foot of band 2; 25 kicker K4 on band 2's lip.
    ravine(44, 14, [825.5, -228], [825.5, 110]),
    { type: 'ramp', s: 800.5, d: 0, width: 16, length: 14, height: 1.5 },
    // 26 W3: the left wall of the middle-right pocket above R5.
    wall([880, 120], [930, 104], [988, 60]),
    // 27-31 R5 "Rope Bridge Gorge" on bench 3: far left, NARROW (bridge), left, KICKER, right.
    ravine(26, 12, [968, -228], [969, -190], [976, -153]),
    ravine(8, 12, [976, -153], [978, -107]),
    ravine(26, 12, [978, -107], [983, -40]),
    ravine(28, 14, [983, -40], [988, 60]),
    ravine(26, 12, [988, 60], [995, 105], [992, 148]),
    // 32 Kicker K5; 33 rock lip at the narrow spot.
    { type: 'ramp', s: 970, d: 10, width: 14, length: 14, height: 3 },
    lip([972.2, -137], [972.8, -123]),
    // 34 W6: the left wall of the middle-right pocket above R6.
    wall([1160, 70], [1195, 64], [1226, 50]),
    // 35-39 R6 "Last Gash" on bench 4: far left, NARROW, left, KICKER, right.
    ravine(24, 9, [1214, -228], [1206, -170], [1214, -107]),
    ravine(8, 9, [1214, -107], [1215, -63]),
    ravine(24, 9, [1215, -63], [1219, -40]),
    ravine(28, 10, [1219, -40], [1226, 50]),
    ravine(24, 9, [1226, 50], [1233, 85], [1233, 118]),
    // 40 Kicker K6; 41 rock lip at the narrow spot.
    { type: 'ramp', s: 1205, d: 0, width: 14, length: 14, height: 3 },
    lip([1209.8, -92], [1210.2, -78]),
    // 42 Ranger post road on the lower mesa; 43 beach road.
    { type: 'road', s0: 875, s1: 950, d: 28, width: 7, start: 'turning' },
    { type: 'road', s0: 1352, s1: 1404, d: -110, width: 7 },
    // 44 W7: seals the middle-right pocket above R5 from the road lane.
    wall([880, 150], [935, 156], [992, 150]),
    // 45-46 R6 right: NARROW (the road lane's crossing), wide to the wall; 47 its rock lip.
    ravine(8, 9, [1233, 118], [1235, 166]),
    ravine(24, 9, [1235, 166], [1243, 198], [1240, 230]),
    lip([1229.2, 134], [1229.8, 148]),
    // 48 W8: seals the middle-right pocket above R6 from the road lane.
    wall([1160, 120], [1195, 126], [1233, 120]),
    // 49 The Leap's left lip: a low rock mound on band 2's lip for the left lane.
    lip([795, -150], [795, -130], 1.5),
  ],
  obstacles: [
    // 0-9 Chute 1: pines and rocks.
    { kind: 'pine', s: 75, d: -30 },
    { kind: 'pine', s: 88, d: 35 },
    { kind: 'rockSmall', s: 95, d: -14 },
    { kind: 'boulder', s: 118, d: 42 },
    { kind: 'rockCluster', s: 140, d: -52, count: 3, spread: 2.5 },
    { kind: 'pine', s: 150, d: 95 },
    { kind: 'pine', s: 165, d: -110 },
    { kind: 'rockMedium', s: 178, d: 20 },
    { kind: 'boulder', s: 200, d: -85 },
    { kind: 'pine', s: 205, d: 140 },
    // 10-12 Ranger road trailhead: two parked cars, a fence along the road. (Vehicles parked on the
    // ranger road stand lengthwise at its right-hand edge, d 181.5: on the road, clear of an iceberg
    // riding the road route at d 177, by ≥ 0.6 m.)
    { kind: 'car', s: 206, d: 180.6, yaw: 0, parked: true },
    { kind: 'car', s: 220, d: 180.6, yaw: 0, parked: true },
    { kind: 'fence', s: 236, d: 172.5, yaw: ALONG, span: 24 },
    // 13-16 The narrow left crossing of R1: a boulder field before it, a rope bridge over it.
    { kind: 'boulder', s: 226, d: -138 },
    { kind: 'boulder', s: 232, d: -122 },
    { kind: 'rockCluster', s: 218, d: -150, count: 3, spread: 2.5 },
    { kind: 'footbridge', s: 255, d: -121, yaw: ALONG, span: 16 },
    // 17-20 Centre lane, bench 1 (the line smashes the log pile).
    { kind: 'logPile', s: 322, d: -13 },
    { kind: 'pine', s: 330, d: 60 },
    { kind: 'rockCluster', s: 405, d: 30, count: 3, spread: 2.5 },
    { kind: 'boulder', s: 425, d: -60 },
    // 21-25 Ranger road: fences, the ranger station with its car and woodpile.
    { kind: 'fence', s: 330, d: 172.5, yaw: ALONG, span: 30 },
    { kind: 'house', s: 520, d: 163, scale: 0.7 },
    { kind: 'car', s: 515, d: 180.6, yaw: 0, parked: true },
    { kind: 'logPile', s: 538, d: 160 },
    { kind: 'fence', s: 600, d: 172.5, yaw: ALONG, span: 30 },
    // 26-29 Left lane.
    { kind: 'boulder', s: 330, d: -150 },
    { kind: 'rockCluster', s: 400, d: -130, count: 3, spread: 2.5 },
    { kind: 'boulder', s: 520, d: -110 },
    { kind: 'pine', s: 560, d: -190 },
    // 30-31 Guard of the narrow left crossing of R3.
    { kind: 'boulder', s: 625, d: -108 },
    { kind: 'rockCluster', s: 618, d: -125, count: 3, spread: 2 },
    // 32-35 Centre lane below band 1, and the centre-right sub-lane.
    { kind: 'boulder', s: 545, d: -40 },
    { kind: 'pine', s: 560, d: 10 },
    { kind: 'rockMedium', s: 575, d: -30 },
    { kind: 'boulder', s: 560, d: 70 },
    // 36-39 Above the Leap.
    { kind: 'pine', s: 705, d: -60 },
    { kind: 'boulder', s: 720, d: 40 },
    { kind: 'rockCluster', s: 745, d: -120, count: 3, spread: 2.5 },
    { kind: 'pine', s: 760, d: 90 },
    // 40-41 Ranger road beside the Leap: a parked truck and the lookout cabin.
    { kind: 'truck', s: 757, d: 180.5, yaw: 0, parked: true },
    { kind: 'house', s: 765, d: 163, scale: 0.6 },
    // 42-44 Ranger post on the lower mesa road: water tank tower (on the line), a ranger car
    // driving up and down its road (down-course lane, d 28 + 7/4), a cabin.
    { kind: 'waterTower', s: 912, d: 12, scale: 0.8 },
    { kind: 'car', s: 885, d: 29.75, yaw: 0 },
    { kind: 'house', s: 935, d: 45, scale: 0.6 },
    // 45-48 Lower mesa.
    { kind: 'pine', s: 870, d: -60 },
    { kind: 'boulder', s: 890, d: -120 },
    { kind: 'rockCluster', s: 930, d: -40, count: 3, spread: 2.5 },
    { kind: 'pine', s: 950, d: -150 },
    // 49 The rope bridge over R5's narrow spot.
    { kind: 'footbridge', s: 977, d: -122, yaw: ALONG, span: 16 },
    // 50-54 Bench 3 and below band 3.
    { kind: 'boulder', s: 1030, d: -60 },
    { kind: 'pine', s: 1040, d: 60 },
    { kind: 'rockCluster', s: 1070, d: -100, count: 3, spread: 2.5 },
    { kind: 'pine', s: 1150, d: -60 },
    { kind: 'boulder', s: 1165, d: 30 },
    // 55-57 Boulder field guarding R6's narrow spot.
    { kind: 'boulder', s: 1185, d: -92 },
    { kind: 'boulder', s: 1192, d: -78 },
    { kind: 'rockCluster', s: 1180, d: -70, count: 3, spread: 2 },
    // 58-59 Bench 4.
    { kind: 'pine', s: 1280, d: -100 },
    { kind: 'boulder', s: 1300, d: 80 },
    // 60-65 Beach road: parked cars, a beach hut with its woodpile, a fence along the road.
    { kind: 'car', s: 1365, d: -112, yaw: Math.PI, parked: true },
    { kind: 'car', s: 1388, d: -108, yaw: 0, parked: true },
    { kind: 'house', s: 1378, d: -126, scale: 0.5 },
    { kind: 'fence', s: 1378, d: -105, yaw: ALONG, span: 30 },
    { kind: 'logPile', s: 1394, d: -126 },
    { kind: 'rockSmall', s: 1400, d: 60 },
    // 66-68 End of the ranger road: a cabin and its car; the trail bridge over R6's right narrow spot.
    { kind: 'house', s: 1178, d: 192, scale: 0.6 },
    { kind: 'car', s: 1168, d: 180.6, yaw: 0, parked: true },
    { kind: 'footbridge', s: 1234, d: 150, yaw: ALONG, span: 16 },
    // 69-78 Scattered rock on the lower slopes.
    { kind: 'rockCluster', s: 1015, d: 120, count: 3, spread: 3 },
    { kind: 'boulder', s: 1050, d: -170 },
    { kind: 'rockMedium', s: 1065, d: 35 },
    { kind: 'rockCluster', s: 1140, d: 160, count: 3, spread: 3 },
    { kind: 'boulder', s: 1170, d: -175 },
    { kind: 'rockMedium', s: 1255, d: 95 },
    { kind: 'rockCluster', s: 1270, d: -150, count: 3, spread: 3 },
    { kind: 'boulder', s: 1295, d: -30 },
    { kind: 'pine', s: 1290, d: 175 },
    { kind: 'rockMedium', s: 860, d: -175 },
    // 79-81 Fishing boats moored off the beach (on open sea).
    { kind: 'boat', s: 1440, d: -60 },
    { kind: 'boat', s: 1445, d: 40 },
    { kind: 'boat', s: 1435, d: 70 },
  ],
  // The centre: K1 → band 1 → K3 → the Leap (K4) → K5 → band 3 → K6 → band 4. Straight run-ups of
  // 40+ m before each kicker; lateral moves only where the iceberg is slow enough to turn cheaply.
  line: pts(
    [30, 0],
    [100, -3],
    [200, -10],
    [255, -10],
    [300, -12],
    [360, -15],
    [450, -20],
    [520, -12],
    [580, -5],
    [615, -5],
    [680, -3],
    [760, 0],
    [800.5, 0],
    [900, 6],
    [940, 10],
    [970, 10],
    [1030, 5],
    [1100, 0],
    [1170, 0],
    [1205, 0],
    [1335, 0],
    [1420, 0],
    [1500, 0],
  ),
  water: { metres: 1600, turnMetresPerRadian: 10 },
  decor: {
    sceneryTreeDensity: 2,
    bushDensity: 5,
    grassTuftDensity: 20,
    pebbleDensity: 14,
  },
};
