import type { LevelDef } from '../types';

/*
 * LEVEL 9 — "SUMMIT LABYRINTH", the finale. An OPEN MOUNTAIN (relief, halfWidth 200 m on the summit and
 * plateau): no marked way down. Start small (scale 0.9, 22 t, r 1.98 m), choose a col, grow on glacier
 * ice, burst the dam on the meltwater stream, fly four cliff bands, plough the village, leap the fjord
 * falls. Course straight along +Z (x = 0): s = z, d = −x. All numbers below are measured (engine 8a6b0c6
 * plus this file, headless autopilot runs; tests: ./summitLabyrinth.test.ts).
 *
 * SIZE. Start s 30 (floor ≈ 308) → coast s 1830 (1800 m) → finish s 1850; course to s 2150. cellSize 2.5,
 * 257 × 929 = 238,753 vertices; build 1.2–1.45 s CPU alone (1.5–1.8 s under parallel test load); route
 * search 1.5–1.9 s; 115 bodies. Slopes: summit 0.14 (s 0–200), plateau 0.115 (200–680), 0.16 (680–830),
 * descent 0.123 + the step and bands (830–1340), village 0.07. Relief: roll 2.5 m, gullies 2 m, 7 m tors
 * on 2.5 % of the floor (seed 444: chosen so the spawn fan, all three cols, the right-hand route and the
 * trap approach are clear of tors; lineClear 16 keeps them off the line).
 *
 * ROUTE MAP (d < 0 = left of travel)
 *   s 30      spawn in the summit cirque (hw 45 → 200 by s 160); the iceberg calves off the glacier
 *   s 196–232 THE SUMMIT COMB of sérac walls: three cols, none marked —
 *             LEFT d −112..−78 | CENTRE d −30..+30 (widest, straight down the fall line) | RIGHT d 78..112
 *   CENTRE    the icefall between walls WL / WR (side gaps: left s 258–290, right s 298–332), lured by an
 *             11.5 t field at s 350, ends at THE BERGSCHRUND C0 (30 m wide, 22 m deep, s ≈ 425–467):
 *             DEAD END (fell; the route search's slowest hop, off a crest, is 26.5 m/s; the icefall
 *             gives ≈ 22). A tor at s 402–406 stands in the middle of it.
 *   LEFT      the ICE SHELF: fields I1–I3 (s 255 / 320 / 390; 10.5 / 14.1 / 13.5 t); a closed slot gully on
 *             the far left (s 240–400, d −175..−190): DEAD END (stuck). The crevasse line across the
 *             whole summit (s 440–475): C1a | SNOW BRIDGE d −129..−117 | C1b–C0–C2. Off the bridge, C1 can
 *             only be hopped off a relief crest (route search: 15.2 m/s near C0, 20.6 m/s on C1a): on
 *             the uniform slope its far rim lies on the take-off plane.
 *   RIGHT     sérac slalom (spurs from the right wall s 262–282 and from WR s 335–348), lone blocks
 *             (5.9 / 7.3 t), then KICKER K2 (lip s 434.5, d 110, 3.5 / 14 m) over C2 (14 m, 16 m deep):
 *             clears from ≈ 11.3 m/s at the lip (10.2 falls; 7 m/s falls in ~2 s).
 *   s 468–830 THE PLATEAU, split by the medial wall M (gap s 560–605 joins the two halves):
 *     LEFT    fields I4 (520, −110; 23.8 t), I5 (585, −85; 26.1 t); the MORAINE MOUND across it (s 655–677,
 *             7.5 m, 40 m wide) with the TRAP FIELD T (636, −62; 77.0 t) at its foot; I6 (712, −104;
 *             27.3 t); then two rim walls funnel everything into THE DAM CHANNEL: two rock walls
 *             (faces d −107 and −73, s 790–860; outside the stream's 12 m cut) with a 6 m ROCK STEP
 *             across it (band s 810, d −112..−68). The MELTWATER STREAM (10 m wide, 2.5 m banks) springs
 *             from a cave in the step's foot (a spring pool at s 821: the reservoir drowns it, 7.3 m
 *             over its own level; it shows when the dam bursts and the lake drains); THE DAM at s 832
 *             (scale 1.1, three monoliths 62–132 t, break impulse 1815 each, 28 m span, 3 m to each
 *             wall face) holds its RESERVOIR in the pool below the step (level 205.1 m over a 196.0 m
 *             bed, crest 205.9, 104 vertices, 3497 m³ with the spring pool's bowl, s 810–828).
 *             The iceberg flies off the step straight into the dam face, so the lake does not slow
 *             it (a lake reaching up the channel slowed the line to 4.7 m/s at the dam). The channel
 *             is the left plateau's only outlet: the stream pours over band B1.
 *     RIGHT   field I-R1 (560, 120; 12.9 t); the FUNNEL POCKET (s 630–774, d 22..108, narrowing to ~10 m;
 *             a 23.4 t bait field at its mouth): DEAD END (stuck); a closed slot (s 600–760, d 168..186):
 *             DEAD END; THE GREAT CREVASSE C3 (26 m wide, 24 m deep) from M's foot to the right wall with
 *             a SNOW BRIDGE at d 113..125 (s ≈ 820). It wraps M's foot so the corridor beside M cannot be
 *             hopped (route search: 15–20 m/s near M; the sim falls in on three lines up to 24 m/s).
 *   s 860–1250 THE DESCENT: cliff bands B1 (s 860, 24 m, d −140..−40), B2 (990, 18 m, d −130..130, lip
 *             skewed 0.12: s 974 at d −130 → 1006 at d 130),
 *             B3 (1110, 16 m, d −130..10; crevasse C4, d −100..0, 14 m wide at its foot, cleared by any
 *             flight), B4 (1250, 22 m, d −150..150); tor field on the right (s 1050–1160, d 30..140).
 *             The stream bends left below B1 (away from the line) and falls over B2 (d −121), B3
 *             (d −124) and B4 (d −145), then runs along the village edge (d −150), over the fjord falls
 *             and into the sea (mouth s 1920).
 *   s 1262–1715 THE VILLAGE on a 0.8 m terrace (it clears the relief from the streets): ski-lift pylons,
 *             an asphalt cross road (s 1404, d −95 → the right wall) with two cars and a bus; a gravel
 *             west street (d −85) and an asphalt main street (d 15) down from it, a farm track to the
 *             barn; six chalets, barn, silo, church (scale 0.85), log pile, fence, pines.
 *   s 1740    THE FJORD FALLS (20 m, full width) → beach → coast s 1830 → finish s 1850.
 *
 * WHY GROWTH OPENS THE WAY. A monolith breaks when 1.25 · v · M ≥ 1815, i.e. M · v ≥ 1452. The channel
 * is steep (0.16) and the step throws the iceberg into the dam, so impacts are 18–24 m/s whatever the
 * mass: mass decides. Measured impacts (t, m/s): line ≈ 107 × 20.0 (1.47×); lane +2 ≈ 84 × 20.0
 * (1.16×); skip I6 ≈ 87 × 18.6 (passes); plateau only ≈ 66 × 18.4 and shelf only ≈ 43 × 22.4 (bounce);
 * no ice: melted to ~8 t, 23.5 m/s (bounces). So the dam wants about two thirds of the line's 115 t: the
 * shelf AND the plateau fields. A bounced iceberg floats in the reservoir and fails stuck against the
 * dam after 30–60 s (the afloat stuck rule). Bursting the dam drains the reservoir as a flood down the
 * stream.
 * THE STREAM AS A HAZARD: banks of 2.5 m hold an iceberg of radius ≤ 2.6 m (≤ ~51 t). The grown
 * dam-route iceberg (r ≥ 2.96 m) rides over it; a small one that drops in (exploring left from the
 * right-hand route) is held and dragged at ~2.8 m/s, still melting, and steering against a bank pins it
 * (stuck after 8.5 s). It never floats there, so it is no water-saving shortcut.
 * GREEDY: T (77 t) at the moraine's foot: the line arrives with ~88 t at ~11.8 m/s and crests at 5.6–9 m/s
 * (lanes); swallowing T caps the iceberg at 132 t and leaves 9.4 m/s: it rolls back (stuck, s 642).
 * Melting: water 1250 m + 10 m/rad for an 1800 m run: without ice even the dam-free right route runs dry.
 *
 * WATERFALLS ON THE LINE (take-off → landing s, landing drop): the step 808 → 818 into the pool (3.6 m,
 * not counted) and on into the dam; B1 out of the breach 857 → 879 (26.6 m), B2 973 → 1019 (24.6 m), B3
 * over C4 1102 → 1155 (22.1 m), B4 1248 → 1313 (29.4 m, 34 m/s), fjord falls 1738 → 1772 (22.6 m).
 * Right route: kicker 435 → 457, B2 990 → 1059, a crest at 1170 → 1281 over B4 (39 m drop), fjord falls.
 * At 33–34 m/s the cross street on the terrace gives a cosmetic 25 m hop (s 1413 → 1440).
 *
 * BALANCE (autopilot, real water budget and chipping; time / absorbed / peak / ice left (× 22 t) /
 * falls / buildings / score):
 *   line                 complete 119.7 s / 100.5 t / 109.0 t / 3.52 / 5 / 3 / 7516, dam burst at 20 m/s
 *                        (119.2 s / 3.52 / 7529 before the stream sprang from the step's cave)
 *   line lanes −2 −1 +1 +2  all complete 118.8–124.3 s / 76.8–98.8 t / 85.2–107.3 t / 2.32–3.43 / 5 / 3
 *   right route          complete 97.8 s / 32.7 t / 36.6 t / 1.16 / 3 / 1 / 5769, no dam
 *   right lanes −2 +2    complete 98.0 s and 98.8 s / 34.4 and 33.4 t / ice 1.20 and 1.20
 *   line skipping I6     complete 114.2 s / 78.4 t / 89.4 t / 2.87 / 6 / 0 (its line misses the village)
 *   plateau fields only  stuck at the dam (s 827), 59.9 t absorbed, peak 68.0 t
 *   shelf fields only    stuck at the dam (s 827), 36.1 t absorbed, peak 50.9 t
 *   line, no ice         stuck at the dam (s 828); right route, no ice: ran dry (ice 0.06), stuck s 1414
 *   right route, then the stream from B4: complete 223.3 s, ice 0.84 (dragged at 2.8 m/s: slow)
 *   greedy (line + T)    stuck at the moraine (s 642), peak 132 t (maxIce)
 *   slow kicker (7 m/s)  fell into C2 (s 446); centreline: stuck on the icefall tor (s 399);
 *   no input             fell into the bergschrund (s 455)
 *
 * SENSITIVE (re-check after engine changes): the moraine (lane −2 crests at 5.6 m/s, greedy stalls at
 * 9.4 m/s with 132 t); the church (3 bodies, 27 → 15 m/s for the line; below ~60 t it can stop an iceberg);
 * dam rubble in the channel (toppling / contact changes); the step throwing the iceberg into the dam;
 * the C2 kicker on the right route (12.4–14.5 m/s at the lip vs ~11.3 needed). Tors depend on
 * relief.seed, bounds (the cover quantile is sampled over the bounds) and the line (lineClear): changing
 * any of them re-rolls tors and needs the probes re-run.
 * The alpine snow line is start floor + 18 m (≈ 326 m), so today snow lies on the walls, mountains and
 * the calving glacier but the summit floor renders green. Designed as a snowy summit: opt into the
 * per-level snow option when the engine adds it (a snow line near y 200 whitens the summit and plateau,
 * s < ~860, and leaves the descent and the village green). Vehicles stand only on the cross road; every
 * building is within 60 m of a street; the dam holds back the meltwater stream in its walled channel.
 */
export const summitLabyrinth: LevelDef = {
  id: 'summit-labyrinth',
  index: 9,
  name: 'Summit Labyrinth',
  subtitle: 'No marked way down a crevassed summit. Grow on the glacier, burst the dam, fly to the fjord.',
  seed: 9901,
  bounds: { minX: -320, maxX: 320, minZ: -120, maxZ: 2200 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 312.2, halfWidth: 45 },
    { x: 0, z: 60, floor: 303.8, halfWidth: 105 },
    { x: 0, z: 160, floor: 289.8, halfWidth: 200 },
    { x: 0, z: 200, floor: 284.2, halfWidth: 200 },
    { x: 0, z: 680, floor: 229, halfWidth: 200 },
    { x: 0, z: 830, floor: 205, halfWidth: 200 },
    { x: 0, z: 1340, floor: 142.3, halfWidth: 190 },
    { x: 0, z: 1830, floor: 108, halfWidth: 170 },
    { x: 0, z: 2150, floor: 80, halfWidth: 170 },
  ],
  cliffs: [
    { s: 810, drop: 6, d: -90, width: 44 },
    { s: 860, drop: 24, d: -90, width: 100 },
    { s: 990, drop: 18, d: 0, width: 260, skew: 0.12 },
    { s: 1110, drop: 16, d: -60, width: 140 },
    { s: 1250, drop: 22, d: 0, width: 300 },
    { s: 1740, drop: 20 },
  ],
  wallHeight: 40,
  wallRamp: 30,
  startS: 30,
  coastS: 1830,
  finishS: 1850,
  theme: 'alpine',
  relief: {
    roll: 2.5,
    rollScale: 150,
    gullies: 2,
    gullySpacing: 45,
    outcrops: 7,
    outcropCover: 0.025,
    outcropScale: 26,
    lineClear: 16,
    seed: 444,
  },
  features: [
    // 0-3 The summit comb: three cols (left, centre, right).
    { type: 'ridge', points: [{ s: 232, d: -228 }, { s: 206, d: -117 }], width: 10, height: 12 },
    {
      type: 'ridge',
      points: [{ s: 212, d: -73 }, { s: 196, d: -52 }, { s: 200, d: -35 }],
      width: 10,
      height: 12,
    },
    {
      type: 'ridge',
      points: [{ s: 200, d: 35 }, { s: 196, d: 52 }, { s: 212, d: 73 }],
      width: 10,
      height: 12,
    },
    { type: 'ridge', points: [{ s: 206, d: 117 }, { s: 232, d: 228 }], width: 10, height: 12 },
    // 4-7 The icefall walls WL / WR either side of the centre, each with one gap.
    { type: 'ridge', points: [{ s: 200, d: -35 }, { s: 258, d: -42 }], width: 10, height: 12 },
    {
      type: 'ridge',
      points: [
        { s: 290, d: -45 },
        { s: 330, d: -52 },
        { s: 380, d: -49 },
        { s: 410, d: -60 },
        { s: 440, d: -62 },
      ],
      width: 10,
      height: 12,
    },
    { type: 'ridge', points: [{ s: 200, d: 35 }, { s: 298, d: 48 }], width: 10, height: 12 },
    {
      type: 'ridge',
      points: [
        { s: 332, d: 52 },
        { s: 360, d: 55 },
        { s: 390, d: 66 },
        { s: 412, d: 68 },
        { s: 436, d: 78 },
      ],
      width: 10,
      height: 12,
    },
    // 8-12 The crevasse system: C1a | snow bridge | C1b, C0 (the bergschrund), C2.
    { type: 'ravine', points: [{ s: 474, d: -228 }, { s: 466, d: -137 }], width: 16, depth: 18 },
    {
      type: 'ravine',
      points: [{ s: 461, d: -109 }, { s: 452, d: -82 }, { s: 440, d: -62 }],
      width: 16,
      depth: 18,
    },
    {
      type: 'ravine',
      points: [{ s: 440, d: -62 }, { s: 452, d: 0 }, { s: 440, d: 70 }],
      width: 30,
      depth: 22,
    },
    {
      type: 'ravine',
      points: [{ s: 436, d: 78 }, { s: 452, d: 150 }, { s: 460, d: 228 }],
      width: 14,
      depth: 16,
    },
    { type: 'ramp', s: 434.5, d: 110, width: 12, length: 14, height: 3.5 },
    // 13 Dead-end slot on the left shelf.
    {
      type: 'gully',
      points: [{ s: 240, d: -175 }, { s: 400, d: -190 }],
      width: 16,
      depth: 10,
      closed: true,
    },
    // 14-15 Sérac spurs: the right-hand slalom.
    { type: 'ridge', points: [{ s: 262, d: 228 }, { s: 282, d: 130 }], width: 10, height: 12 },
    { type: 'ridge', points: [{ s: 335, d: 52 }, { s: 348, d: 76 }], width: 10, height: 12 },
    // 16-17 The medial ridge M (gap at s 560–605).
    {
      type: 'ridge',
      points: [{ s: 468, d: 0 }, { s: 495, d: -8 }, { s: 520, d: -4 }, { s: 560, d: -12 }],
      width: 10,
      height: 12,
    },
    {
      type: 'ridge',
      points: [
        { s: 605, d: -14 },
        { s: 640, d: -21 },
        { s: 680, d: -16 },
        { s: 720, d: -24 },
        { s: 770, d: -19 },
        { s: 830, d: -24 },
      ],
      width: 10,
      height: 12,
    },
    // 18 The moraine mound across the left plateau.
    {
      type: 'ridge',
      points: [{ s: 655, d: -28 }, { s: 667, d: -120 }, { s: 677, d: -228 }],
      width: 40,
      height: 7.5,
      profile: 'mound',
    },
    // 19, 22 The dam channel's walls (34 m apart, outside the stream's cut); 20-21 the rim walls
    // funnelling the left plateau in.
    { type: 'ridge', points: [{ s: 790, d: -110 }, { s: 860, d: -110 }], width: 6, height: 12 },
    {
      type: 'ridge',
      points: [{ s: 860, d: -228 }, { s: 840, d: -150 }, { s: 790, d: -114 }],
      width: 10,
      height: 12,
    },
    { type: 'ridge', points: [{ s: 790, d: -66 }, { s: 828, d: -24 }], width: 10, height: 12 },
    { type: 'ridge', points: [{ s: 790, d: -70 }, { s: 860, d: -70 }], width: 6, height: 12 },
    // 23-24 The pocket (a funnel) and the right dead-end slot.
    {
      type: 'ridge',
      points: [{ s: 630, d: 22 }, { s: 770, d: 52 }, { s: 774, d: 70 }, { s: 630, d: 108 }],
      width: 8,
      height: 11,
    },
    {
      type: 'gully',
      points: [{ s: 600, d: 168 }, { s: 760, d: 186 }],
      width: 16,
      depth: 10,
      closed: true,
    },
    // 25-26 The great crevasse C3 across the right plateau, snow bridge at d 113–125.
    {
      type: 'ravine',
      points: [{ s: 838, d: -40 }, { s: 830, d: -10 }, { s: 826, d: 60 }, { s: 822, d: 100 }],
      width: 26,
      depth: 24,
    },
    { type: 'ravine', points: [{ s: 820, d: 138 }, { s: 816, d: 228 }], width: 26, depth: 24 },
    // 27 C4 at the foot of band B3.
    { type: 'ravine', points: [{ s: 1121, d: -100 }, { s: 1121, d: 0 }], width: 14, depth: 12 },
    // 28 Village cross road (asphalt, from the west street to the right wall); 29 the village terrace
    // (it clears the relief from the streets).
    { type: 'road', s0: 1400, s1: 1408, d: 46, width: 282, surface: 'asphalt' },
    { type: 'plateau', s0: 1262, s1: 1715, d: 0, width: 330, height: 0.8 },
    // 30 The meltwater stream: it springs from a cave in the foot of the rock step (source 'cave': its
    // spring pool at s 821, d −90, its rim 2 m off the step's foot at s 810 so the step keeps its
    // face, which rises 8.9 m within 15 m behind the mouth), drowned by the reservoir behind the dam;
    // then over B1 and away left of the line, over B2, B3 and B4, along the village edge, over the
    // fjord falls.
    {
      type: 'stream',
      source: 'cave',
      points: [
        { s: 821, d: -90 },
        { s: 860, d: -90 },
        { s: 880, d: -112 },
        { s: 960, d: -120 },
        { s: 1040, d: -124 },
        { s: 1110, d: -124 },
        { s: 1180, d: -135 },
        { s: 1250, d: -145 },
        { s: 1300, d: -150 },
        { s: 1700, d: -150 },
        { s: 1790, d: -146 },
        { s: 1920, d: -130 },
      ],
      width: 10,
      bank: 2.5,
    },
    // 31-33 The village streets: the west street (gravel, beside the line) from the cross road to
    // the church, the asphalt main street (a T with the cross road) to the log-pile yard, and the
    // farm track to the barn.
    {
      type: 'street',
      points: [
        { s: 1404, d: -85 },
        { s: 1630, d: -85 },
      ],
      width: 6,
      surface: 'gravel',
    },
    {
      type: 'street',
      points: [
        { s: 1404, d: 15 },
        { s: 1640, d: 15 },
      ],
      width: 7,
      surface: 'asphalt',
    },
    {
      type: 'street',
      points: [
        { s: 1480, d: 15 },
        { s: 1480, d: 128 },
      ],
      width: 4,
      surface: 'gravel',
    },
  ],
  obstacles: [
    // 0-2 Left shelf ice (the line).
    { kind: 'iceField', s: 255, d: -100, scale: 0.55, count: 6, spread: 5 },
    { kind: 'iceField', s: 320, d: -112, scale: 0.6, count: 6, spread: 5 },
    { kind: 'iceField', s: 390, d: -120, scale: 0.6, count: 6, spread: 5 },
    // 3-4 Left plateau ice (the line).
    { kind: 'iceField', s: 520, d: -110, scale: 0.7, count: 6, spread: 5 },
    { kind: 'iceField', s: 585, d: -85, scale: 0.75, count: 6, spread: 5 },
    // 5 The trap: the biggest field at the foot of the moraine mound.
    { kind: 'iceField', s: 636, d: -62, scale: 1.0, count: 7, spread: 7 },
    // 6 Below the mound, above the dam channel (the line).
    { kind: 'iceField', s: 712, d: -104, scale: 0.75, count: 6, spread: 5 },
    // 7 The dam across the meltwater channel (3 m to each wall: a light iceberg cannot squeeze by).
    { kind: 'dam', s: 832, d: -90, scale: 1.1, span: 28 },
    // 8-9 Lone blocks in the right-hand slalom; 10 the centre lure; 11 right plateau; 12 pocket bait.
    { kind: 'iceBlock', s: 300, d: 95 },
    { kind: 'iceBlock', s: 345, d: 92 },
    { kind: 'iceField', s: 350, d: 0, scale: 0.55, count: 6, spread: 5 },
    { kind: 'iceField', s: 560, d: 120, scale: 0.6, count: 6, spread: 5 },
    { kind: 'iceField', s: 660, d: 65, scale: 0.7, count: 6, spread: 5 },
    // 13-14 Descent ice on the right.
    { kind: 'iceField', s: 1080, d: 68, scale: 0.6, count: 6, spread: 5 },
    { kind: 'iceField', s: 1190, d: 62, scale: 0.5, count: 6, spread: 5 },
    // 15+ The village.
    { kind: 'skiLiftPylon', s: 1290, d: -10 },
    { kind: 'skiLiftPylon', s: 1320, d: -10 },
    { kind: 'skiLiftPylon', s: 1350, d: -10 },
    { kind: 'skiLiftPylon', s: 1380, d: -10 },
    { kind: 'car', s: 1404, d: -40, yaw: 1.57 },
    { kind: 'car', s: 1404, d: 60, yaw: -1.57 },
    { kind: 'bus', s: 1404, d: 120, yaw: 1.57 },
    { kind: 'chalet', s: 1440, d: -60 },
    { kind: 'chalet', s: 1470, d: -100 },
    { kind: 'chalet', s: 1500, d: 40 },
    { kind: 'chalet', s: 1530, d: -25 },
    { kind: 'chalet', s: 1560, d: 60 },
    { kind: 'barn', s: 1480, d: 140 },
    { kind: 'silo', s: 1500, d: 155 },
    { kind: 'church', s: 1620, d: -70, scale: 0.85 },
    { kind: 'chalet', s: 1600, d: -112 },
    { kind: 'logPile', s: 1650, d: 30 },
    { kind: 'fence', s: 1680, d: 80, span: 30 },
    { kind: 'pine', s: 1450, d: 160 },
    { kind: 'pine', s: 1520, d: -122 },
    { kind: 'pine', s: 1580, d: 150 },
    { kind: 'pine', s: 1660, d: -124 },
    { kind: 'pine', s: 1700, d: 130 },
  ],
  water: { metres: 1250, turnMetresPerRadian: 10 },
  iceberg: { scale: 0.9, mass: 22 },
  line: [
    { s: 30, d: 0 },
    { s: 120, d: -45 },
    { s: 200, d: -95 },
    { s: 255, d: -100 },
    { s: 320, d: -112 },
    { s: 390, d: -120 },
    { s: 440, d: -123 },
    { s: 480, d: -123 },
    { s: 520, d: -110 },
    { s: 585, d: -85 },
    { s: 625, d: -105 },
    { s: 667, d: -118 },
    { s: 712, d: -104 },
    { s: 750, d: -90 },
    { s: 900, d: -90 },
    { s: 1250, d: -60 },
    { s: 1440, d: -60 },
    { s: 1540, d: -60 },
    { s: 1620, d: -70 },
    { s: 1740, d: -40 },
    { s: 1830, d: -20 },
    { s: 2000, d: 0 },
  ],
  decor: {
    sceneryTreeDensity: 4,
    bushDensity: 1.5,
    grassTuftDensity: 10,
    pebbleDensity: 6,
  },
};
