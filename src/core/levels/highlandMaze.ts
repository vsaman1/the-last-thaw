import type { LevelDef, ObstaclePlacement } from '../types';

/** A stand of trees (one placement per tree) from flat s, d pairs. */
function grove(kind: 'pine' | 'broadleaf', sd: number[]): ObstaclePlacement[] {
  const out: ObstaclePlacement[] = [];
  for (let i = 0; i + 1 < sd.length; i += 2) out.push({ kind, s: sd[i], d: sd[i + 1] });
  return out;
}

/*
 * LEVEL 8 — "HIGHLAND MAZE". An open highland mountainside (alpine theme: green braes, grey crags,
 * pinewoods) for a big iceberg (scale 1.3, 60 t). No corridor: crag spurs, slot gullies, fatal
 * ravines, woods, lochans and three waterfall bands make a maze of glens that split and rejoin.
 * The course runs straight along +Z (x = 0), so s ≈ z and d = −x (d < 0 = left of travel). Floor
 * 380 m wide (halfWidth 190 from s 170; 100 m at the spawn). Spawn s 30 (floor y 223), coast
 * s 1700, finish 1720. cellSize 2.5: 265 × 841 = 222,865 grid vertices.
 *
 * ROUTE MAP (all values s / d in metres; "fatal" = falling in ends the run as 'fell')
 *   s 30–150     the braes below the glacier; pines either side of the fan (s 90–135, |d| 80–140).
 *   s 150        THE FAN: two crag spurs (A1/A2 left, B1/B2 right, 10–11 m wide, 12–14 m high)
 *                split the slope into three glens. From the spawn the middle one looks like the way.
 *   BLIND GLEN   (middle) the spurs close in a V of crags at s 606: a DEAD END (analyzeRoutes:
 *                trap, ~20,000 m²; no input and the centreline both die in it). The only ways out
 *                are the gaps in the spurs at s 276–312 (left) and s 298–334 (right).
 *   LEFT GLEN    (d −190 … A) the Coille Dubh pinewood (s 290–390, d −131 … −168) beside the line;
 *                G1, a closed slot gully (s 230–440, d −135 → −182, 16 m wide, 8 m deep): a DEAD END
 *                (stuck; a fast iceberg flies out of its end and dies against the crags below).
 *     THE LEAP   s 470: cliff band 0 (12 m, d −175 … −80) drops straight into ravine R1 (22 m wide,
 *                12 m deep, s 471–495), which runs from the left wall into spur A2: fatal. Measured
 *                at d −125: take-off ≥ 18.5 m/s clears it, 17.6 m/s falls in; the line takes off at
 *                21.5 m/s and lands at s 500 (15.5 m below). Beyond the band's left end R1 opens into
 *                a 40 m pothole against the wall (no jumping round the end).
 *   RIGHT GLEN   (B … right wall) ridge D (s 398–640, d ≈ 150 → 140) splits it. Right of D: the
 *                DEVIL'S CUT, ravine R2 (40 m wide, 14 m deep, s 622–678, d 132 → 215): a DEAD END
 *                (fell). Left of D: down to the JUNCTION below the crags' apex (s 560–640, d 40–130).
 *   s 600–1060   THREE LANES, split by crag lines E1/E2 (d ≈ −10 → −60) and F1/F2 (d ≈ 46 → 63):
 *     LOWER LEFT GLEN  (the line) a shepherd's bothy, its fank and a stalkers' track (s 575–700); a
 *                crag spur off the left wall (s 598–632); a lochan (s 720, d −165, 7 m deep: trap);
 *                pinewood; WATERFALL 2 — band 1 (14 m, d −195 … −55) at s 900.
 *     THE MIDDLE from the junction a hairpin left round the apex into a slalom of three crag spurs
 *                (s 700–760 to d 26, s 800–858 to d 0, s 950–996 to d 12): long and safe.
 *     THE CLACHAN (right of F) the glen road (asphalt, d 95, s 560–1045) through a hamlet: Achadh
 *                farm (house, barn, silo), the kirk on its knoll (hill s 760 d 140, 6 m), cottages,
 *                a crossroads with traffic lights (cross street s 820, d 70 → 175), Balnacoil farm
 *                (lorry parked on the yard apron across the road), a chalet, the mill; dry-stone
 *                dykes along the road and fields; cars drive the glen road and stop at the lights;
 *                the MILL FALLS — band 2 (8 m, d 45 … 195) at s 1060.
 *   s 1060–1590  THE LOWER BRAES, where the lanes rejoin:
 *     THE GORGE  ravines R3a/R3b (24 m wide, 14 m deep) cut diagonally from the right wall
 *                (s 1150) to d −84 (s 1362): fatal. Cross at the ROCK BRIDGE (a ~20 m neck between
 *                R3a and R3b at s ≈ 1265, d ≈ 60) or go round its left end (d < −90). The glen road
 *                crosses on a road bridge (s 1216–1260, d 95; skewed 37° to the gorge, its ends
 *                cut along the rims), and so can the iceberg (playtest 2: it rides the deck 14 m over
 *                the Gorge floor, src/core/physics/deckGround.ts; it used to glance off the skewed
 *                deck end into the Gorge from every lane and speed). R3c
 *                opens into a 40 m pothole at the right wall (no jumping round that end).
 *                The DRUIM, a crestable mound (s 1180–1232, d −195 → −40, 5.5 m high, 32 m wide): at
 *                speed it throws the line ~80 m (s 1213 → 1294); lochan 2 (s 1330, d 125: trap);
 *                closed gully G3 (s 1300–1440, d −150 → −186) above crag K, which runs from the left
 *                wall (s 1440) to d −92 (s 1525); crags G, H1, H2; woods.
 *   s 1590       WATERFALL 3, the loch falls — band 3 (12 m, d −150 … 150; ride round its ends) —
 *                onto the lochside village (street d 80: cottages, the kirk behind them, a car), the
 *                beach and two boats moored on the sea (s 1745–1752).
 *
 * THE LINE (LevelDef.line): left glen past the pinewood → THE LEAP → through the bothy and fank →
 * lower left glen → WATERFALL 2 → over the Druim → round the Gorge's left end → the loch falls →
 * the sea, never near the centreline. The autopilot ('path' pursuit) takes it as drawn.
 *
 * Relief: rolls 3 m (160 m), braided gullies 2 m (50 m apart), 7 m tors on 2.8 % of the floor (kept
 * 18 m clear of the line, and of the glen road's right side beyond the Gorge bridge, s 1250-1585, d
 * 90-122: a drift off the road there reaches the sea; relief seed +3). BALANCE (measured, headless, real water 2250 m +
 * 12 m/rad and chipping; see highlandMaze.test.ts):
 *   route                         result     time    ice    falls  buildings  land m  turn rad
 *   the line (Leap)               complete   79.1 s  31.0 %   3       1        1490    3.2
 *   the middle (slalom, round)    complete   97.1 s  20.5 %   1       0        1639   12.1
 *   the Clachan (hamlet, bridge)  complete  100.8 s   9.1 %   2       3        1648    9.6
 *   the glen road (hamlet, Gorge  complete   98.2 s   9.6 %   2       3
 *     road bridge; playtest 2)
 *   no input                      stuck in the Blind Glen (s 411)
 *   centreline                    stuck in the Blind Glen (s 201)
 * Every no-input drift tried from inside the maze also ends badly (pothole, Devil's Cut, Gorge,
 * spurs, lochan). The Clachan's three smashed buildings chip 12.6 % of the ice: it barely makes it
 * (sensitive to contact and chipping changes). Cost: terrain 1.0–1.5 s CPU, route search ~1.1 s,
 * 239 bodies + 4 traffic lights (7 vehicles driving); real GPU (Chrome, ANGLE D3D11, 1280×720,
 * quality High, benchmark(60)): 21 ms per frame at the spawn and the fan, 16–18 ms mid-slope,
 * 13 ms near the sea, 19–21 ms in river view.
 */
export const highlandMaze: LevelDef = {
  id: 'highland-maze',
  index: 8,
  name: 'Highland Maze',
  subtitle: 'An open highland with many ways down. Most of them end badly.',
  seed: 8086,
  bounds: { minX: -330, maxX: 330, minZ: -120, maxZ: 1980 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 227, halfWidth: 50 },
    { x: 0, z: 60, floor: 219.5, halfWidth: 120 },
    { x: 0, z: 170, floor: 205.75, halfWidth: 190 },
    { x: 0, z: 600, floor: 152, halfWidth: 190 },
    { x: 0, z: 1300, floor: 82, halfWidth: 190 },
    { x: 0, z: 1702, floor: 50, halfWidth: 190 },
    { x: 0, z: 1960, floor: 24, halfWidth: 190 },
  ],
  cliffs: [
    { s: 470, drop: 12, d: -127, width: 95 },
    { s: 900, drop: 14, d: -125, width: 140 },
    { s: 1060, drop: 8, d: 120, width: 150 },
    { s: 1590, drop: 12, d: 0, width: 300 },
  ],
  wallHeight: 40,
  wallRamp: 30,
  startS: 30,
  coastS: 1700,
  finishS: 1720,
  theme: 'alpine',
  iceberg: { scale: 1.3, mass: 60 },
  relief: {
    roll: 3,
    rollScale: 160,
    gullies: 2,
    gullySpacing: 50,
    outcrops: 7,
    outcropCover: 0.028,
    outcropScale: 26,
    lineClear: 18,
    // The glen road beyond the Gorge bridge, and the strip right of it: since the bridge carries the
    // iceberg (playtest 2), a run that drifts right off the road there met a tor (s 1396-1404, d
    // 112-120) and a 5 m rock hump (s 1452, d 102-110) and stuck between them and the raised road.
    clear: [{ points: [{ s: 1250, d: 106 }, { s: 1585, d: 102 }], width: 32 }],
    seed: 3,
  },
  features: [
    // 0 A1: nose of the left spur at the fan (the gap after it links the Blind Glen to the left).
    {
      type: 'ridge',
      points: [
        { s: 150, d: -14 },
        { s: 172, d: -25 },
        { s: 196, d: -33 },
        { s: 222, d: -47 },
        { s: 250, d: -53 },
        { s: 276, d: -62 },
      ],
      width: 10,
      height: 12,
    },
    // 1 A2: the left spur, down to the Blind Glen's apex.
    {
      type: 'ridge',
      points: [
        { s: 312, d: -76 },
        { s: 338, d: -86 },
        { s: 366, d: -91 },
        { s: 398, d: -99 },
        { s: 430, d: -93 },
        { s: 462, d: -87 },
        { s: 494, d: -74 },
        { s: 522, d: -61 },
        { s: 552, d: -45 },
        { s: 580, d: -26 },
        { s: 606, d: -3 },
      ],
      width: 11,
      height: 14,
    },
    // 2 B1: nose of the right spur (the gap after it links the Blind Glen to the right).
    {
      type: 'ridge',
      points: [
        { s: 150, d: 14 },
        { s: 176, d: 27 },
        { s: 204, d: 37 },
        { s: 230, d: 52 },
        { s: 262, d: 61 },
        { s: 298, d: 74 },
      ],
      width: 10,
      height: 12,
    },
    // 3 B2: the right spur, closing the Blind Glen with A2 at s 606.
    {
      type: 'ridge',
      points: [
        { s: 334, d: 86 },
        { s: 362, d: 92 },
        { s: 392, d: 97 },
        { s: 420, d: 94 },
        { s: 448, d: 95 },
        { s: 478, d: 84 },
        { s: 508, d: 72 },
        { s: 536, d: 57 },
        { s: 562, d: 41 },
        { s: 586, d: 23 },
        { s: 606, d: 3 },
      ],
      width: 11,
      height: 14,
    },
    // 4 D: splits the right glen; right of it the Devil's Cut.
    {
      type: 'ridge',
      points: [
        { s: 398, d: 152 },
        { s: 428, d: 147 },
        { s: 462, d: 149 },
        { s: 500, d: 141 },
        { s: 540, d: 140 },
        { s: 580, d: 134 },
        { s: 612, d: 136 },
        { s: 640, d: 140 },
      ],
      width: 10,
      height: 13,
    },
    // 5 R1: THE LEAP's ravine, its near edge on the lip of band 0 (fatal).
    {
      type: 'ravine',
      points: [
        { s: 481, d: -215 },
        { s: 482, d: -150 },
        { s: 482, d: -110 },
        { s: 483, d: -90 },
      ],
      width: 22,
      depth: 12,
    },
    // 6 R2: the Devil's Cut, too wide to jump (fatal dead end).
    {
      type: 'ravine',
      points: [
        { s: 642, d: 152 },
        { s: 650, d: 182 },
        { s: 658, d: 215 },
      ],
      width: 40,
      depth: 14,
    },
    // 7-8 E1, E2: crags between the lower left glen and the middle (gap at s 748–792).
    {
      type: 'ridge',
      points: [
        { s: 606, d: -3 },
        { s: 628, d: -12 },
        { s: 652, d: -22 },
        { s: 676, d: -30 },
        { s: 702, d: -41 },
        { s: 726, d: -47 },
        { s: 748, d: -53 },
      ],
      width: 10,
      height: 12,
    },
    {
      type: 'ridge',
      points: [
        { s: 792, d: -60 },
        { s: 820, d: -63 },
        { s: 852, d: -62 },
        { s: 880, d: -66 },
        { s: 906, d: -62 },
        { s: 930, d: -60 },
        { s: 950, d: -58 },
      ],
      width: 10,
      height: 12,
    },
    // 9-10 F1, F2: crags between the middle and the Clachan (gap at s 800–842).
    {
      type: 'ridge',
      points: [
        { s: 658, d: 46 },
        { s: 680, d: 52 },
        { s: 708, d: 55 },
        { s: 740, d: 60 },
        { s: 770, d: 59 },
        { s: 800, d: 63 },
      ],
      width: 10,
      height: 12,
    },
    {
      type: 'ridge',
      points: [
        { s: 842, d: 62 },
        { s: 872, d: 60 },
        { s: 904, d: 58 },
        { s: 940, d: 56 },
        { s: 972, d: 55 },
        { s: 1006, d: 50 },
        { s: 1040, d: 51 },
      ],
      width: 10,
      height: 12,
    },
    // 11-13 the middle's slalom: crag spurs off E1, F1 and E2; 14 a crag under F2's end.
    {
      type: 'ridge',
      points: [
        { s: 702, d: -41 },
        { s: 722, d: -14 },
        { s: 742, d: 8 },
        { s: 760, d: 26 },
      ],
      width: 9,
      height: 10,
    },
    {
      type: 'ridge',
      points: [
        { s: 800, d: 63 },
        { s: 820, d: 42 },
        { s: 840, d: 20 },
        { s: 858, d: 0 },
      ],
      width: 9,
      height: 10,
    },
    {
      type: 'ridge',
      points: [
        { s: 950, d: -58 },
        { s: 966, d: -36 },
        { s: 982, d: -12 },
        { s: 996, d: 12 },
      ],
      width: 9,
      height: 10,
    },
    {
      type: 'ridge',
      points: [
        { s: 1010, d: 52 },
        { s: 1024, d: 36 },
      ],
      width: 9,
      height: 10,
    },
    // 15 G1: closed gully on the far left of the upper glen (dead end).
    {
      type: 'gully',
      points: [
        { s: 230, d: -135 },
        { s: 270, d: -149 },
        { s: 310, d: -161 },
        { s: 350, d: -170 },
        { s: 400, d: -178 },
        { s: 440, d: -182 },
      ],
      width: 16,
      depth: 8,
      closed: true,
    },
    // 16 the kirk's knoll
    { type: 'hill', s: 760, d: 140, radius: 24, height: 6 },
    // 17 the glen road through the Clachan, down to the mill above the falls; at its head (s 560)
    // a footpath goes on up the right glen
    { type: 'road', s0: 560, s1: 1045, d: 95, width: 7, surface: 'asphalt', start: 'trailhead' },
    // 18 the lochan in the lower left glen (a trap)
    { type: 'basin', s: 720, d: -165, radius: 18, depth: 7 },
    // 19 the Druim: a crestable mound across the lower left (crest it at speed, or roll back)
    {
      type: 'ridge',
      points: [
        { s: 1180, d: -195 },
        { s: 1200, d: -140 },
        { s: 1218, d: -90 },
        { s: 1232, d: -40 },
      ],
      width: 32,
      height: 5.5,
      profile: 'mound',
    },
    // 20 the lochan on the lower right (a trap)
    { type: 'basin', s: 1330, d: 125, radius: 18, depth: 7 },
    // 21 G3: a closed slot gully on the lower left, ending above crag K
    {
      type: 'gully',
      points: [
        { s: 1300, d: -150 },
        { s: 1370, d: -170 },
        { s: 1440, d: -186 },
      ],
      width: 16,
      depth: 7,
      closed: true,
    },
    // 22 crag G, lower middle
    {
      type: 'ridge',
      points: [
        { s: 1390, d: 10 },
        { s: 1420, d: 30 },
        { s: 1450, d: 44 },
        { s: 1485, d: 62 },
      ],
      width: 10,
      height: 12,
    },
    // 23 R3a: the Gorge, right part (fatal)
    {
      type: 'ravine',
      points: [
        { s: 1150, d: 215 },
        { s: 1185, d: 165 },
        { s: 1220, d: 118 },
        { s: 1250, d: 80 },
      ],
      width: 24,
      depth: 14,
    },
    // 24 R3b: the Gorge, left part; the rock bridge is the neck between R3a and R3b
    {
      type: 'ravine',
      points: [
        { s: 1280, d: 42 },
        { s: 1300, d: 16 },
        { s: 1320, d: -8 },
        { s: 1342, d: -40 },
        { s: 1362, d: -72 },
      ],
      width: 24,
      depth: 14,
    },
    // 25-26 crags H1, H2 below the mill falls and the slalom
    {
      type: 'ridge',
      points: [
        { s: 1080, d: 40 },
        { s: 1110, d: 68 },
        { s: 1150, d: 84 },
      ],
      width: 10,
      height: 12,
    },
    {
      type: 'ridge',
      points: [
        { s: 1120, d: -40 },
        { s: 1160, d: -20 },
        { s: 1192, d: 10 },
      ],
      width: 10,
      height: 12,
    },
    // 27 crag K from the left wall: closes the left edge above the loch falls
    {
      type: 'ridge',
      points: [
        { s: 1440, d: -215 },
        { s: 1462, d: -170 },
        { s: 1482, d: -132 },
        { s: 1500, d: -112 },
        { s: 1525, d: -92 },
      ],
      width: 10,
      height: 12,
    },
    // 28 R3c: the Gorge widens into a pothole against the right wall (no jumping round its end)
    {
      type: 'ravine',
      points: [
        { s: 1136, d: 220 },
        { s: 1160, d: 184 },
      ],
      width: 40,
      depth: 14,
    },
    // 29-31 the glen road below the mill falls, over the Gorge bridge, and the lochside street
    { type: 'road', s0: 1080, s1: 1216, d: 95, width: 7, surface: 'asphalt' },
    { type: 'road', s0: 1260, s1: 1575, d: 95, width: 7, surface: 'asphalt' },
    { type: 'road', s0: 1614, s1: 1688, d: 80, width: 7, surface: 'asphalt' },
    // 32 R1's pothole against the left wall, beyond band 0's end: no jumping round the Leap's end
    {
      type: 'ravine',
      points: [
        { s: 478, d: -218 },
        { s: 484, d: -182 },
      ],
      width: 40,
      depth: 12,
    },
    // 33 a crag spur off the left wall below the Leap
    {
      type: 'ridge',
      points: [
        { s: 598, d: -215 },
        { s: 612, d: -186 },
        { s: 624, d: -164 },
        { s: 632, d: -152 },
      ],
      width: 10,
      height: 12,
    },
    // 34 the stalkers' track from the bothy down the lower left glen, a footpath beyond
    { type: 'road', s0: 585, s1: 700, d: -110, width: 4, surface: 'gravel', end: 'trailhead' },
    // 35 the Clachan crossroads: a cross street over the glen road at s 820 (four asphalt legs, so
    // the junction gets traffic lights), from the cottages' lane to the valley wall on the right
    {
      type: 'street',
      points: [
        { s: 820, d: 70 },
        { s: 820, d: 187 },
      ],
      width: 7,
      surface: 'asphalt',
    },
    // 36 Balnacoil farmyard: a gravel apron across the road from the farm
    { type: 'parking', s: 905, d: 82, length: 16, width: 10, surface: 'gravel' },
  ],
  obstacles: [
    // The Clachan. Achadh farm by the road.
    { kind: 'house', s: 668, d: 116 },
    { kind: 'barn', s: 692, d: 124 },
    { kind: 'silo', s: 676, d: 136 },
    { kind: 'car', s: 662, d: 95, yaw: 0 },
    // The kirk on its knoll, cottages across the road.
    { kind: 'church', s: 760, d: 140 },
    { kind: 'house', s: 720, d: 78 },
    { kind: 'house', s: 792, d: 80 },
    { kind: 'car', s: 738, d: 96, yaw: 0.05 },
    // Balnacoil farm: yard by the road with a lorry.
    { kind: 'house', s: 890, d: 120 },
    { kind: 'barn', s: 916, d: 130 },
    { kind: 'silo', s: 940, d: 146 },
    { kind: 'logPile', s: 878, d: 142 },
    { kind: 'truck', s: 905, d: 82, yaw: 0, parked: true },
    { kind: 'chalet', s: 980, d: 76 },
    // The mill above the falls.
    { kind: 'house', s: 1028, d: 120 },
    { kind: 'car', s: 1012, d: 96, yaw: 0 },
    // Dry-stone dykes along the road and between the fields.
    { kind: 'fence', s: 722, d: 101, yaw: Math.PI / 2, span: 24 },
    { kind: 'fence', s: 850, d: 89, yaw: Math.PI / 2, span: 24 },
    { kind: 'fence', s: 842, d: 145, span: 30 },
    // The lower glen road and its bridge over the Gorge.
    { kind: 'car', s: 1118, d: 95, yaw: 0 },
    // Along the road, so the Gorge crosses it at 37°: the deck's ends skew along the rims.
    { kind: 'roadBridge', s: 1238, d: 95, yaw: Math.PI / 2, span: 44 },
    { kind: 'truck', s: 1305, d: 95, yaw: 0 },
    { kind: 'car', s: 1430, d: 94, yaw: 0 },
    // The lochside village under the last falls: a street of cottages and a kirk; boats moored
    // on the sea past the beach.
    { kind: 'house', s: 1626, d: 57 },
    { kind: 'house', s: 1652, d: 58 },
    { kind: 'house', s: 1678, d: 57 },
    { kind: 'house', s: 1630, d: 103 },
    { kind: 'house', s: 1660, d: 104 },
    { kind: 'church', s: 1640, d: 124 },
    { kind: 'car', s: 1644, d: 82, yaw: 0 },
    { kind: 'boat', s: 1745, d: -80 },
    { kind: 'boat', s: 1752, d: 110 },
    // A shepherd's bothy below the Leap, on the fast line, and its fank (sheep pen).
    { kind: 'house', s: 575, d: -122, scale: 0.6 },
    { kind: 'logPile', s: 590, d: -104 },
    { kind: 'fence', s: 600, d: -126, span: 14 },
    // Woods (one body per tree).
    // Coille Dubh (upper left glen)
    ...grove(
      'pine',
      [
        316, -137, 376, -144, 347, -136, 331, -153, 353, -158, 363, -152, 372, -135, 355, -137, 300, -143,
        377, -160, 290, -144, 336, -136, 323, -133, 313, -145, 337, -147, 368, -160, 345, -146, 365, -131,
        387, -133, 325, -143, 341, -154, 390, -143, 293, -168, 355, -147,
      ],
    ),
    ...grove('broadleaf', [365, -143, 306, -134]),
    // right glen wood
    ...grove('pine', [344, 144, 330, 144, 348, 136, 324, 154, 326, 167, 336, 155, 305, 129, 320, 133]),
    ...grove('broadleaf', [353, 147, 318, 144, 310, 137, 351, 162]),
    // Blind Glen birches
    ...grove('broadleaf', [219, 1, 229, -6, 224, -15, 230, 5, 225, 14, 246, 8]),
    // Blind Glen lower
    ...grove('pine', [469, -2]),
    ...grove('broadleaf', [476, -11, 441, -24, 451, 0, 478, -28, 461, 5]),
    // lower left glen wood
    ...grove(
      'pine',
      [
        791, -147, 808, -133, 809, -143, 823, -155, 821, -134, 782, -145, 808, -125, 827, -97, 766, -108,
        794, -104, 818, -162, 817, -127, 802, -150, 825, -143, 783, -97, 813, -103, 842, -152,
      ],
    ),
    ...grove('broadleaf', [774, -140, 790, -131, 827, -124]),
    // switchback trees
    ...grove('pine', [899, -35, 934, 6, 937, -29, 853, 20]),
    ...grove('broadleaf', [846, -6, 884, -2, 908, 6]),
    // Clachan trees
    ...grove('pine', [809, 163]),
    ...grove('broadleaf', [832, 153, 847, 157, 902, 165, 803, 178, 897, 144, 786, 162, 789, 152]),
    // lower left wood
    ...grove(
      'pine',
      [
        1076, -128, 1064, -114, 1082, -115, 1091, -132, 1074, -136, 1097, -113, 1078, -102, 1084, -128, 1048,
        -113, 1108, -137, 1097, -144, 1085, -153, 1070, -104, 1063, -122, 1047, -144, 1038, -123,
      ],
    ),
    ...grove('broadleaf', [1113, -121, 1088, -101]),
    // gorge-side wood
    ...grove('pine', [1408, 145, 1415, 129, 1424, 134, 1395, 126]),
    ...grove(
      'broadleaf',
      [1398, 155, 1427, 155, 1404, 170, 1409, 137, 1385, 132, 1383, 141, 1392, 142, 1413, 158],
    ),
    // lower middle trees
    ...grove('pine', [1171, 43, 1164, 3, 1147, 19]),
    ...grove('broadleaf', [1203, 11, 1190, 19, 1153, 10, 1161, 17, 1196, 34]),
    // above the loch, left
    ...grove('pine', [1526, -154, 1513, -136, 1519, -126, 1533, -121, 1524, -144]),
    ...grove('broadleaf', [1518, -106, 1537, -144, 1502, -131]),
    // above the loch, right
    ...grove('pine', [1522, 153, 1553, 158]),
    ...grove('broadleaf', [1529, 141, 1528, 124, 1532, 170, 1544, 144, 1525, 133, 1531, 159]),
    // fan pines, left
    ...grove('pine', [109, -126, 103, -89, 130, -117, 121, -92, 112, -99, 96, -105, 119, -135]),
    ...grove('broadleaf', [102, -116, 89, -79]),
    // fan pines, right
    ...grove('pine', [127, 101, 118, 101, 130, 89, 112, 141, 130, 112, 113, 131, 121, 124]),
    ...grove('broadleaf', [112, 93, 97, 109]),
    // below the Leap
    ...grove('pine', [665, -165, 647, -170, 664, -151, 688, -162, 658, -171, 676, -167]),
  ],
  line: [
    { s: 30, d: 0 },
    { s: 80, d: -10 },
    { s: 150, d: -50 },
    { s: 250, d: -105 },
    { s: 330, d: -120 },
    { s: 420, d: -125 },
    { s: 470, d: -125 },
    { s: 520, d: -125 },
    { s: 620, d: -120 },
    { s: 720, d: -125 },
    { s: 820, d: -115 },
    { s: 900, d: -110 },
    { s: 960, d: -105 },
    { s: 1100, d: -90 },
    { s: 1215, d: -80 },
    { s: 1300, d: -98 },
    { s: 1380, d: -104 },
    { s: 1450, d: -78 },
    { s: 1590, d: -40 },
    { s: 1640, d: -24 },
    { s: 1700, d: -22 },
    { s: 1800, d: -20 },
  ],
  water: { metres: 2250, turnMetresPerRadian: 12 },
  decor: {
    sceneryTreeDensity: 5,
    bushDensity: 3,
    grassTuftDensity: 14,
    pebbleDensity: 6,
  },
  sky: { top: '#4F86C6', horizon: '#D8E4EA', fog: '#CBD8DF' },
};
