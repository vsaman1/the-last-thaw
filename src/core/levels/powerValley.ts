import type { LevelDef } from '../types';

/** Yaw that turns a pylon's cross arms along the course, so its (implied) line crosses the valley. */
const ACROSS = Math.PI / 2;
/** Yaw that lays a rail wagon or a parked car along the course / square to the valley. */
const ALONG = Math.PI / 2;
/** Yaw of a vehicle driving across the valley toward +d (right) or −d (left) on a cross street. */
const TO_RIGHT = -Math.PI / 2;
const TO_LEFT = Math.PI / 2;

/*
 * LEVEL 6 — "POWER VALLEY": an OPEN, MAZE-LIKE INDUSTRIAL MOUNTAIN VALLEY with a real river, for the
 * 220 t iceberg (scale 2.2: radius 4.84 m; every passage ≥ 25 m = 2.5 diameters). The course runs
 * straight along +Z (s ≈ z, d = −x); the floor is 440 m wide from s 170 (halfWidth 220) with relief
 * (2 m rolls, 1.5 m braided gullies, no tors: random tors walled off the alternative routes). Spawn
 * s 30, coast s 1845, finish s 1865 (20 m out to sea): 1815 m to the sea. The maze is built from
 * wall ridges (11-12 m), mound ridges, gullies and ravines; everything sits where it would really be.
 *
 * THE RIVER (a `stream`, 14 m wide, 3 m banks, 1.2 m deep at 4 m/s) is the glacier's meltwater
 * (source 'glacier'): it rises under the ice at s 0, d 30 and runs out of an ice portal in the snout
 * (s ~19, the opening 14.6 m wide, its arch 3.85 m over the bank tops under a 1.5 m lobe of ice),
 * 23 m right of the spawn, then right of the access road, falls over cliff band 1, runs along the
 * works street in the plant's right
 * channel into the gorge, where the DAM holds it as a reservoir (level 154.2 m, ~3.7 m over the
 * gorge floor, ~2.7k m²), plunges over the 30 m cliff, passes the end of the tailrace canal, falls
 * over cliff band 3 and the sea cliff into the sea. Its 3 m banks do not hold this iceberg: it rides
 * over them, but wading slows it, so the intended line keeps to the river's left bank.
 *
 * MAP (s along the valley, d left − / right +)
 *   gate       s 30-170 (0.15): car park, gatehouse, access road (d 15), pylon line s 150
 *   FORK s 190 W1a (left) and W2 (right) split the slope three ways:
 *     left     the WIND-FARM BENCH: open mound ridges M1 (s 215-255) and M2 (s 330-365) with
 *              turbines on their crests; it stays left of the plant all the way to the 30 m cliff
 *     middle   the access road, cottages, mound M0 (s 300-312) with three turbines (the line
 *              knocks one down), the river on the right, then CLIFF BAND 1 (s 450, 14 m)
 *     right    the RAIL CUTTING: track bed (wagons) into a slot that ends at the tunnel wall;
 *              W3 closes the branch — DEAD END (stuck)
 *   rail yard  s 450-650 (0.09): rail track bed d −110 with wagons, a freight train stopped across
 *              the yard on its cross track (s 560), the loading dock (trucks parked) and goods shed;
 *              right of the river the COAL YARD (walls W4, W5, a closed gully) — DEAD END (stuck)
 *   plant      s 650-990 (0.10): slag heaps S1/S2 split it — left: two 42 m cooling towers; right:
 *              the works street along the river (the gate street s 678 and the outlet street s 886
 *              meet it at traffic lights), the tank farm across the river; middle: the turbine hall
 *              and a chimney in the SLAG-HEAP POCKET, closed by a third heap — DEAD END (stuck; where
 *              a centreline run ends). Left and right rejoin at the outlet: boiler house, twin cooling
 *              towers, chimney, tanks. A gap in the bench wall (s 860-900) links plant and bench.
 *   dam        the gorge walls G1/G2 funnel the plant into a 70 m gorge where the DAM (s 1085,
 *              d −66..13, seven ~11 m monoliths, keyed into both walls) holds the reservoir. The
 *              decision: the SPILLWAY, a 27 m cut through G1 at s 1005-1035 onto the bench (dry, safe),
 *              or RAM THE DAM across the lake: square on a monolith over the riverbed it breaks, the
 *              lake drains in a flood (20 m breach, ~550 m³/s) and you ride it over the fall; too
 *              slow across the lake and you are pinned against the wall (where a no-input run ends)
 *   cliff      s 1100, 30 m across the whole valley: gorge, river and bench all fall here
 *   lower      s 1100-1450 (0.07 then 0.10): hydro powerhouse and its road (d −135), carried over the
 *              tailrace canal by the highway bridge (s 1255-1325) to the depot; pylon line s 1205.
 *              The TAILRACE CANAL (s ~1285-1305, 16 m wide, 10 m deep, d −222..30) is FATAL; kickers
 *              K1 (lip s 1288, d −20: the breach) and K2 (lip s 1284, d −170: the line, the ridge) fly
 *              it; the highway bridge carries the hydro road and the iceberg over it (playtest 2: the
 *              iceberg rides the deck ~9.5 m over the canal, src/core/physics/deckGround.ts; it used to
 *              glance off the deck end into the canal); the river passes its end (slow); right of the
 *              river the slope drains into its
 *              40 m branch — DEAD END (fell). The lower block (wall ridge s 1330-1400) splits the run
 *              to CLIFF BAND 3 (s 1450, 16 m, d −150..110)
 *   port       s 1450-1790: hill with a turbine, the street (d 0) and the quay road (d −90), both
 *              crossed by the cross street s 1646 at traffic lights, the river on the right;
 *              warehouses, silos, chimney, guardrails, harbour parking; SEA CLIFF s 1790 (30 m)
 *
 * ROUTES (autopilot, real water budget and chipping; powerValley.test.ts)
 *   line: plant + spillway   114 s, 26 % ice, knocked 15, buildings 6, 4 falls, score ~6140
 *         (M0 turbine, two cooling towers, boiler house, two tanks, a warehouse; K2)
 *   ridge route (bench)       84 s, 48 % ice, knocked 2, buildings 1, 4 falls, score ~6020
 *   dam breach + flood       114 s, 26 % ice, knocked 18, buildings 3, 4 falls, score ~5730
 *   highway bridge (the line,
 *     then the hydro road)   116 s, 24 % ice, buildings 6, 4 falls, score ~6080 (playtest 2)
 *   wrong branches: slag-heap pocket, rail cutting, coal yard → stuck; canal branch, a missed
 *   kicker → fell. Centreline: stuck in the slag-heap pocket; no input: pinned at the dam.
 *   analyzeRoutes (≈ 1 s) reports the cutting and the coal yard (trap); it treats the river's
 *   banks as walls (so it never reaches the canal branch) and its 6 m cells miss the slag-heap
 *   pocket: the session tests prove both.
 *
 * SMASH vs RESIST (momentum test 1.25·vn·M; M = 220 t × ice, ~60 t at the sea): every structure
 * breaks at walking pace for the full iceberg and toppled turbines and chimneys come down; a
 * cooling tower costs ~4 m/s, a hall ~2, a tank or house ~0-1. What resists: the dam to an iceberg
 * the lake has slowed, the walls and the canal.
 *
 * WATER BUDGET: 3000 m + 20 m/rad. Every route lays ~1800-1900 m of river; the plant routes chip
 * ~10-20 % more than the bench, so ice left runs 26-48 %.
 *
 * LIVING WORLD: 29 vehicles drive the lanes (width / 4 either side of a road's centre: down-course
 * on the +d side) and stop at the lights of the four signalised junctions (13 traffic lights); a
 * truck crosses the highway bridge; cars in the car park and trucks at the loading dock are parked;
 * wagons stand along rail track beds (buffer stops, the cutting's tunnel wall); every road ends at a
 * junction, a bridge, a building, a car park or a turning circle (validateWorldLogic: clean).
 *
 * PERFORMANCE: cellSize 3, 247 × 761 = 188k vertices, ~0.9-1.3 s CPU alone; 101 placements → 174
 * bodies at spawn; ~3-6 ms per physics step. Real GPU (Iris Xe, quality high, with the river and
 * traffic): 26 ms/frame at the spawn (1.0 M triangles: the whole open slope), 24 ms in the plant.
 */
export const powerValley: LevelDef = {
  id: 'power-valley',
  index: 6,
  name: 'Power Valley',
  subtitle: 'A 220-tonne iceberg loose in an industrial mountain valley: find your way through the plant.',
  seed: 6606,
  bounds: { minX: -370, maxX: 370, minZ: -120, maxZ: 2160 },
  cellSize: 3,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 281.9, halfWidth: 45 },
    { x: 0, z: 30, floor: 280.1, halfWidth: 55 },
    { x: 0, z: 90, floor: 271.1, halfWidth: 120 },
    { x: 0, z: 170, floor: 259.1, halfWidth: 220 },
    { x: 0, z: 450, floor: 228.3, halfWidth: 220 },
    { x: 0, z: 650, floor: 210.3, halfWidth: 220 },
    { x: 0, z: 1000, floor: 175.3, halfWidth: 220 },
    { x: 0, z: 1100, floor: 163.3, halfWidth: 220 },
    { x: 0, z: 1140, floor: 160.5, halfWidth: 220 },
    { x: 0, z: 1450, floor: 129.5, halfWidth: 220 },
    { x: 0, z: 1790, floor: 95.5, halfWidth: 220 },
    { x: 0, z: 1845, floor: 90, halfWidth: 220 },
    { x: 0, z: 2100, floor: 64.5, halfWidth: 220 },
  ],  cliffs: [
    { s: 450, drop: 14, d: -40, width: 280 },
    { s: 1100, drop: 30 },
    { s: 1450, drop: 16, d: -20, width: 260 },
    { s: 1790, drop: 30 },
  ],
  wallHeight: 40,
  wallRamp: 30,
  startS: 30,
  coastS: 1845,
  finishS: 1865,
  theme: 'industrial',
  iceberg: { scale: 2.2, mass: 220 },
  water: { metres: 3000, turnMetresPerRadian: 20 },
  relief: {
    roll: 2,
    rollScale: 160,
    gullies: 1.5,
    gullySpacing: 50,
  },
  features: [
    // 0-1 Plant access road down the middle, staff car park at the gate.
    { type: 'road', s0: 80, s1: 440, d: 15, width: 10 },
    { type: 'parking', s: 92, d: 2, length: 26, width: 24 },
    // 2-4 The fork below the gate: W1a (left: the wind-farm bench beyond it), W2 (right: the rail
    // cutting beyond it), W3 closes the right branch into a pocket.
    {
      type: 'ridge',
      points: [{ s: 190, d: -35 }, { s: 300, d: -112 }, { s: 440, d: -132 }],
      width: 9,
      height: 11,
    },
    {
      type: 'ridge',
      points: [{ s: 205, d: 60 }, { s: 300, d: 82 }, { s: 430, d: 92 }],
      width: 9,
      height: 11,
    },
    {
      type: 'ridge',
      points: [{ s: 425, d: 92 }, { s: 448, d: 160 }, { s: 462, d: 245 }],
      width: 9,
      height: 11,
    },
    // 5-6 Rail cutting (a slot that ends at the tunnel wall: dead end) and its track bed.
    { type: 'gully', points: [{ s: 290, d: 150 }, { s: 435, d: 150 }], width: 26, depth: 11, closed: true },
    { type: 'road', s0: 230, s1: 437, d: 150, width: 8, surface: 'rail', start: 'buffer' },
    // 7-9 Wind farm: open mound ridges on the left bench (M1, M2) and one in the middle (M0).
    {
      type: 'ridge',
      points: [{ s: 215, d: -215 }, { s: 255, d: -130 }],
      width: 30,
      height: 5,
      profile: 'mound',
    },
    {
      type: 'ridge',
      points: [{ s: 330, d: -220 }, { s: 365, d: -150 }],
      width: 28,
      height: 5,
      profile: 'mound',
    },
    {
      type: 'ridge',
      points: [{ s: 300, d: -75 }, { s: 312, d: -20 }],
      width: 26,
      height: 4,
      profile: 'mound',
    },
    // 10-12 Rail yard below cliff band 1: track bed, the cross track of the stopped freight train,
    // the loading dock.
    { type: 'road', s0: 470, s1: 650, d: -110, width: 10, surface: 'rail', end: 'buffer' },
    { type: 'road', s0: 554, s1: 566, d: -55, width: 110, surface: 'rail', end: 'buffer' },
    { type: 'parking', s: 522, d: 0, length: 44, width: 14 },
    // 13-16 Coal yard on the right: walled in (W4, W5) with a closed gully behind it: dead end.
    { type: 'ridge', points: [{ s: 560, d: 80 }, { s: 720, d: 88 }], width: 9, height: 11 },
    {
      type: 'ridge',
      points: [{ s: 720, d: 88 }, { s: 738, d: 165 }, { s: 750, d: 248 }],
      width: 9,
      height: 11,
    },
    { type: 'road', s0: 500, s1: 700, d: 125, width: 10, start: 'turning', end: 'turning' },
    { type: 'gully', points: [{ s: 540, d: 185 }, { s: 705, d: 185 }], width: 26, depth: 11, closed: true },
    // 17 W1b: the bench/plant divider.
    { type: 'ridge', points: [{ s: 600, d: -140 }, { s: 860, d: -142 }], width: 9, height: 11 },
    // 18-20 Slag heaps S1, S2 split the plant; a third heap closes the channel between them: the
    // slag-heap pocket (dead end).
    // S1 starts at s 700 like S2 (it began at s 690, and its 12 m end cap reached into the plant street at
    // s 678, so cars in the street's far lane drove up its rock face: the ground stood 10.2 m above the road).
    { type: 'ridge', points: [{ s: 700, d: -61 }, { s: 830, d: -48 }], width: 24, height: 11 },
    { type: 'ridge', points: [{ s: 700, d: 14 }, { s: 850, d: 30 }], width: 22, height: 11 },
    { type: 'ridge', points: [{ s: 828, d: -48 }, { s: 852, d: 30 }], width: 12, height: 11 },
    // 21-23 Plant streets: the works street on the river's left bank (right channel), the gate and
    // outlet streets meeting it at traffic lights.
    {
      type: 'street',
      points: [
        { s: 664, d: 31 },
        { s: 700, d: 34 },
        { s: 850, d: 48 },
        { s: 900, d: 52 },
        { s: 960, d: 42 },
        { s: 1000, d: 22 },
      ],
      width: 10,
    },
    { type: 'street', points: [{ s: 678, d: -128 }, { s: 678, d: 33 }], width: 10 },
    { type: 'street', points: [{ s: 886, d: -85 }, { s: 886, d: 51 }], width: 10 },
    // 24-27 W1c and the gorge walls funnelling the plant into the dam: G1 (left, cut by the spillway
    // channel at s 1005-1035 onto the bench) and G2 (right).
    { type: 'ridge', points: [{ s: 900, d: -142 }, { s: 960, d: -142 }], width: 9, height: 11 },
    { type: 'ridge', points: [{ s: 960, d: -142 }, { s: 1005, d: -111 }], width: 10, height: 12 },
    {
      type: 'ridge',
      points: [{ s: 1035, d: -90 }, { s: 1050, d: -80 }, { s: 1112, d: -70 }],
      width: 10,
      height: 12,
    },
    {
      type: 'ridge',
      points: [{ s: 930, d: 248 }, { s: 980, d: 120 }, { s: 1050, d: 25 }, { s: 1112, d: 18 }],
      width: 10,
      height: 12,
    },
    // 28 THE RIVER: meltwater from the glacier (it rises under the ice and runs out of a portal in the
    // snout at s ~19), down the right of the access road, over cliff band 1, along the works street,
    // into the gorge where the dam holds it as a reservoir, over the 30 m cliff, past the end of the
    // tailrace canal, over cliff band 3 and the sea cliff into the sea.
    {
      type: 'stream',
      source: 'glacier',
      points: [
        { s: 0, d: 30 },
        { s: 60, d: 30 },
        { s: 150, d: 33 },
        { s: 200, d: 38 },
        { s: 300, d: 50 },
        { s: 440, d: 60 },
        { s: 560, d: 58 },
        { s: 650, d: 60 },
        { s: 720, d: 64 },
        { s: 850, d: 72 },
        { s: 900, d: 74 },
        { s: 960, d: 60 },
        { s: 1020, d: 30 },
        { s: 1060, d: 5 },
        { s: 1085, d: -5 },
        { s: 1150, d: 0 },
        { s: 1200, d: 15 },
        { s: 1260, d: 40 },
        { s: 1300, d: 46 },
        { s: 1360, d: 50 },
        { s: 1450, d: 52 },
        { s: 1520, d: 58 },
        { s: 1650, d: 65 },
        { s: 1790, d: 70 },
        { s: 1850, d: 70 },
        { s: 1920, d: 70 },
      ],
      width: 14,
      bank: 3,
    },
    // 29-31 Hydro road below the dam, carried over the tailrace canal by the highway bridge (a street on
    // its deck), on to the depot.
    { type: 'road', s0: 1165, s1: 1255, d: -135, width: 10 },
    { type: 'street', points: [{ s: 1255, d: -135 }, { s: 1325, d: -135 }], width: 10, carve: false },
    { type: 'road', s0: 1325, s1: 1412, d: -135, width: 10 },
    // 32-33 The tailrace canal across the slope (fatal), 16 m wide, ending short of the river; right of
    // the river the slope drains into its 40 m-wide branch (dead end).
    { type: 'ravine', points: [{ s: 1292, d: -222 }, { s: 1299, d: 22 }], width: 16, depth: 10 },
    { type: 'ravine', points: [{ s: 1300, d: 80 }, { s: 1315, d: 222 }], width: 40, depth: 12 },
    // 34-35 Kickers over the canal: K1 (middle, the breach) and K2 (far left: the line and the ridge).
    { type: 'ramp', s: 1288, d: -20, width: 18, length: 18, height: 4 },
    { type: 'ramp', s: 1284, d: -170, width: 18, length: 18, height: 4 },
    // 36-37 Lower industrial block and its road.
    { type: 'ridge', points: [{ s: 1330, d: -72 }, { s: 1400, d: -52 }], width: 26, height: 10 },
    { type: 'road', s0: 1330, s1: 1412, d: 20, width: 10, start: 'turning' },
    // 38-41 Port: hill, street, cross street, quay road.
    { type: 'hill', s: 1525, d: -10, radius: 22, height: 6 },
    { type: 'road', s0: 1560, s1: 1745, d: 0, width: 12, start: 'turning' },
    { type: 'street', points: [{ s: 1646, d: -100 }, { s: 1646, d: 14 }], width: 12 },
    { type: 'road', s0: 1632, s1: 1745, d: -90, width: 10 },
    // 42-46 Parking: the dam car park at the works street's end, the depot, the lower yard, the harbour.
    { type: 'parking', s: 1010, d: 8, length: 24, width: 18 },
    { type: 'parking', s: 1422, d: -135, length: 20, width: 16 },
    { type: 'parking', s: 1422, d: 20, length: 20, width: 16 },
    { type: 'parking', s: 1755, d: 0, length: 16, width: 24 },
    { type: 'parking', s: 1755, d: -90, length: 16, width: 20 },
  ],
  obstacles: [
    // --- Gate: car park, gatehouse, access-road trucks, the first power line --------------------
    // (The car park falls ≈ 12 % down the course, about the most a car parked across the slope
    // may lean (validateVehiclePlacements): the second row, where it is steeper, parks nose down
    // the slope.)
    { kind: 'car', s: 86, d: -7.5, yaw: ALONG },
    { kind: 'car', s: 86, d: -2, yaw: ALONG },
    { kind: 'car', s: 86, d: 5, yaw: ALONG },
    { kind: 'car', s: 98, d: -6, yaw: 0 },
    { kind: 'car', s: 98, d: 2, yaw: 0 },
    { kind: 'house', s: 112, d: -24, scale: 0.7 },
    { kind: 'truck', s: 140, d: 17.5, yaw: 0 },
    { kind: 'truck', s: 232, d: 12.5, yaw: Math.PI },
    { kind: 'pylon', s: 150, d: -110, yaw: ACROSS },
    { kind: 'pylon', s: 150, d: -62, yaw: ACROSS },
    { kind: 'pylon', s: 150, d: 62, yaw: ACROSS },
    { kind: 'pylon', s: 150, d: 90, yaw: ACROSS },
    // --- Wind farm: turbines on the mound crests -----------------------------------------------
    { kind: 'windTurbine', s: 222, d: -200 },
    { kind: 'windTurbine', s: 231, d: -181 },
    { kind: 'windTurbine', s: 250, d: -140 },
    { kind: 'windTurbine', s: 338, d: -204 },
    { kind: 'windTurbine', s: 347, d: -186 },
    { kind: 'windTurbine', s: 302, d: -65 },
    { kind: 'windTurbine', s: 306, d: -45 },
    { kind: 'windTurbine', s: 310, d: -27 },
    // Workers' cottages along the access road.
    { kind: 'house', s: 250, d: 2 },
    { kind: 'house', s: 330, d: 2 },
    { kind: 'house', s: 390, d: 2 },
    // --- Rail cutting (right pocket): wagons on the track bed into the cutting ------------------
    { kind: 'railWagon', s: 240, d: 150, yaw: 0 },
    { kind: 'railWagon', s: 256, d: 150, yaw: 0 },
    { kind: 'railWagon', s: 272, d: 150, yaw: 0 },
    // --- Rail yard -----------------------------------------------------------------------------
    { kind: 'railWagon', s: 490, d: -110, yaw: 0 },
    { kind: 'railWagon', s: 506, d: -110, yaw: 0 },
    { kind: 'railWagon', s: 522, d: -110, yaw: 0 },
    { kind: 'railWagon', s: 600, d: -110, yaw: 0 },
    { kind: 'railWagon', s: 616, d: -110, yaw: 0 },
    // The freight train stopped across the yard on its cross track.
    { kind: 'railWagon', s: 560, d: -95 },
    { kind: 'railWagon', s: 560, d: -80.4 },
    { kind: 'railWagon', s: 560, d: -65.8 },
    { kind: 'railWagon', s: 560, d: -51.2 },
    { kind: 'railWagon', s: 560, d: -36.6 },
    // Loading dock: trucks on the platform, the goods shed beside it.
    { kind: 'truck', s: 512, d: 0, yaw: ALONG },
    { kind: 'truck', s: 532, d: 0, yaw: ALONG },
    { kind: 'factoryHall', s: 520, d: 24 },
    // --- Coal yard (dead end) ------------------------------------------------------------------
    { kind: 'truck', s: 560, d: 127.5, yaw: 0 },
    { kind: 'truck', s: 622, d: 122.5, yaw: Math.PI },
    { kind: 'smokestack', s: 600, d: 160 },
    // --- Power plant ---------------------------------------------------------------------------
    // Cooling-tower channel (left, along the river).
    { kind: 'coolingTower', s: 735, d: -88 },
    { kind: 'coolingTower', s: 805, d: -113 },
    // Slag-heap pocket (dead end): the turbine hall and a chimney tempt you in.
    { kind: 'factoryHall', s: 770, d: -15 },
    { kind: 'smokestack', s: 812, d: -24 },
    // Main road (right channel): tank farm beside it, trucks on it.
    { kind: 'tank', s: 775, d: 95 },
    { kind: 'tank', s: 805, d: 100 },
    { kind: 'tank', s: 835, d: 106 },
    { kind: 'truck', s: 700, d: 36.5, yaw: 0 },
    { kind: 'truck', s: 850, d: 45.5, yaw: Math.PI },
    // Plant outlet: boiler house, the twin cooling towers, chimney, tanks.
    { kind: 'factoryHall', s: 915, d: -80 },
    { kind: 'coolingTower', s: 935, d: -18 },
    { kind: 'coolingTower', s: 975, d: 12 },
    { kind: 'smokestack', s: 950, d: -30 },
    { kind: 'tank', s: 947, d: -68 },
    { kind: 'tank', s: 978, d: -64 },
    { kind: 'pylon', s: 990, d: -110, yaw: ACROSS },
    { kind: 'pylon', s: 985, d: 75, yaw: ACROSS },
    // --- The dam across the river in the gorge; the spillway gap on the left -----------------
    { kind: 'dam', s: 1085, d: -26.5, span: 78.8 },
    // --- Below the dam -------------------------------------------------------------------------
    { kind: 'factoryHall', s: 1180, d: -105 },
    { kind: 'truck', s: 1190, d: -132.5, yaw: 0 },
    { kind: 'truck', s: 1232, d: -137.5, yaw: Math.PI },
    { kind: 'pylon', s: 1205, d: -80, yaw: ACROSS },
    { kind: 'pylon', s: 1205, d: 45, yaw: ACROSS },
    { kind: 'pylon', s: 1205, d: 80, yaw: ACROSS },
    { kind: 'roadBridge', s: 1290, d: -135, yaw: ALONG, span: 70 },
    // Lower industrial block.
    { kind: 'pine', s: 1345, d: -67 },
    { kind: 'pine', s: 1385, d: -56 },
    { kind: 'truck', s: 1340, d: 22.5, yaw: 0 },
    { kind: 'truck', s: 1400, d: 17.5, yaw: Math.PI },
    { kind: 'tank', s: 1380, d: 3 },
    { kind: 'factoryHall', s: 1370, d: -108 },
    // --- Port ----------------------------------------------------------------------------------
    { kind: 'windTurbine', s: 1525, d: -10 },
    { kind: 'truck', s: 1580, d: 3, yaw: 0 },
    { kind: 'car', s: 1600, d: -3, yaw: Math.PI },
    { kind: 'bus', s: 1625, d: -3, yaw: Math.PI },
    { kind: 'car', s: 1680, d: 3, yaw: 0 },
    { kind: 'truck', s: 1710, d: -3, yaw: Math.PI },
    { kind: 'car', s: 1649, d: 10, yaw: TO_LEFT },
    { kind: 'truck', s: 1643, d: -60, yaw: TO_RIGHT },
    { kind: 'factoryHall', s: 1600, d: -40 },
    { kind: 'factoryHall', s: 1690, d: 30 },
    { kind: 'silo', s: 1700, d: -72 },
    { kind: 'silo', s: 1716, d: -108 },
    { kind: 'smokestack', s: 1740, d: 40 },
    // Fences and guardrails along the roads and the yard (appended: placement randomness is seeded
    // per index).
    { kind: 'guardrail', s: 300, d: 21.5, yaw: ALONG, span: 80 },
    { kind: 'fence', s: 600, d: -118, yaw: ALONG, span: 48 },
    { kind: 'guardrail', s: 1700, d: 7.5, yaw: ALONG, span: 60 },
    // Traffic in the lanes (width / 4 either side of a road's centre): it drives, queues and stops
    // at the lights of the plant and port junctions.
    { kind: 'car', s: 300, d: 17.5, yaw: 0 },
    { kind: 'car', s: 380, d: 12.5, yaw: Math.PI },
    { kind: 'car', s: 675.5, d: -80, yaw: TO_RIGHT },
    { kind: 'car', s: 680.5, d: 20, yaw: TO_LEFT },
    { kind: 'car', s: 760, d: 42, yaw: 0 },
    { kind: 'car', s: 930, d: 44.5, yaw: Math.PI },
    { kind: 'car', s: 883.5, d: -70, yaw: TO_RIGHT },
    { kind: 'truck', s: 888.5, d: 0, yaw: TO_LEFT },
    { kind: 'car', s: 1660, d: -87.5, yaw: 0 },
    { kind: 'truck', s: 1720, d: -92.5, yaw: Math.PI },
    { kind: 'car', s: 1643, d: 8, yaw: TO_RIGHT },
    // Over the highway bridge on the hydro road.
    { kind: 'truck', s: 1265, d: -132.5, yaw: 0 },
  ],
  line: [
    { s: 30, d: 0 },
    { s: 140, d: 0 },
    { s: 200, d: -10 },
    { s: 270, d: -35 },
    { s: 306, d: -45 },
    { s: 360, d: -48 },
    { s: 440, d: -50 },
    { s: 500, d: -58 },
    { s: 560, d: -58 },
    { s: 620, d: -80 },
    { s: 690, d: -105 },
    { s: 735, d: -100 },
    { s: 805, d: -100 },
    { s: 870, d: -95 },
    { s: 915, d: -80 },
    { s: 947, d: -70 },
    { s: 978, d: -66 },
    { s: 1020, d: -100 },
    { s: 1060, d: -140 },
    { s: 1100, d: -160 },
    { s: 1150, d: -165 },
    { s: 1262, d: -170 },
    { s: 1284, d: -170 },
    { s: 1330, d: -165 },
    { s: 1400, d: -160 },
    { s: 1450, d: -135 },
    { s: 1530, d: -80 },
    { s: 1600, d: -40 },
    { s: 1650, d: -25 },
    { s: 1700, d: -15 },
    { s: 1790, d: -5 },
    { s: 1845, d: 0 },
    { s: 1900, d: 0 },
  ],
  decor: {
    sceneryTreeDensity: 3,
    bushDensity: 4,
    grassTuftDensity: 14,
    pebbleDensity: 6,
  },
  sky: { top: '#4F7FB8', horizon: '#D9DCD2', fog: '#C9CCC4' },
};
