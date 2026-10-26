import type { LevelDef } from '../types';

/*
 * LEVEL 4 — "RIVERSIDE TOWN": an OPEN HILLSIDE TOWN on its river, for the big iceberg (scale 1.6,
 * 100 t, radius 3.5 m). A 400 m wide slope (halfWidth 200, ~0.11, relief: rolls, braided gullies, a
 * few tors) on a straight course along +Z, so s ≈ z and d = −x (d > 0 = right of travel). Start
 * s 30, coast s 1550, finish s 1570, end s 1780. Which street reaches the sea is not obvious:
 * walls, a railway bank, a fatal gorge and a dam funnel split the town into branches that rejoin
 * or end.
 *
 * THE RIVER (stream, 16 m between 2 m banks): the glacier's meltwater. It rises under the
 * level-start glacier (s 0, d −44) and runs out of an ice portal in its snout (s 16, d −47), down
 * the hilltop's left side past the farms (s 150, d −95), down the west side of the old town
 * (d ≈ −90), over the MILL WEIR, through the railway bank, through the GORGE's slot,
 * over the LOWER WEIR into the dam funnel's west channel, held back by the DAM
 * (its reservoir floods the channel above it), over the DAM FALLS, past the harbour quay (d ≈ −85),
 * over the HARBOUR CLIFF into the sea: four waterfalls. Its banks hold only an iceberg of radius
 * ≤ 2.1 m; this one rides over them, but whatever floats in it is carried at the river's pace: a
 * slow iceberg in the gorge's slot drifts down to the reservoir and is pinned against the dam. The
 * EAST BROOK (14 m; the dam was never given its spillway) springs from a cave in the east funnel
 * wall (a spring pool at s 1104, d 61), runs down the east channel beside the abutment through the
 * COFFER DAM and over the falls into its plunge pool.
 *
 * MAP (top to bottom)
 *   hilltop    s 30–140: Hill Road (d 0) with houses; the farm track (gravel, d −120) from the barn
 *              past the fence down to West Lane; Tower Road (d 108) with the WATER TOWER on its knoll
 *              (s 255, d 140).
 *   the fork   s 140: the old town walls A (west, to s 345) and B (east, to s 420) split the slope
 *              into the WEST LANE (with the river), the OLD TOWN and the EAST SIDE.
 *   mill weir  CLIFF BAND s 330, 12 m, d −100…40 (round its east end it is a slope).
 *   old town   s 352–620: down-slope streets Mill Street (d −65, along the river), Main Street
 *              (d −27), Church Lane (d 15), Gas Lane (d 52), crossed by two cross streets (s 400,
 *              s 470): eight crossroads, four with TRAFFIC LIGHTS (Main Street and Gas Lane at
 *              both); cars and a bus drive the streets and stop at the reds. Mill Street swings into
 *              Main Street at s 604; Main Street runs on over the level crossing to Station Street.
 *              The block between Main Street and Church Lane holds a row of houses (d −6) the line
 *              ploughs through; the CHURCH stands on its knoll (s 565, d 15) at the top of Church
 *              Lane.
 *   west lane  West Lane (d −112) west of the river, and QUARRY ROAD (d −165) into the QUARRY: a
 *              wall from s 470 d −135 via s 545 d −150 into the west wall closes it (stuck).
 *   east side  the GASWORKS on Gasworks Road (d 122): two gas holders, a smoking chimney, a hall,
 *              the yard (parking, a truck); the PARK, a sunken lawn (s 470, d 92); behind the
 *              gasworks a CLOSED GULLY (s 470 d 165 → s 600 d 188, 9 m deep): a dead end (stuck).
 *   railway    a grassy bank (5.5 m, crest it with speed) diagonal across the slope, s 600 (d −218)
 *              to s 690 (d 218), the TRACK BED (a rail street) along its crest, the train on it by
 *              the LEVEL CROSSING at the foot of Main Street; the river cuts through it at d −90.
 *              Crossings: W d −150…−125 (s ≈ 616), C d −40…−15 (s ≈ 639), E d 75…100 (s ≈ 663).
 *              Station Street (s 702), the station car park below it, and GORGE ROAD (d −50) from
 *              Station Street down to the viaduct.
 *   THE GORGE  s ≈ 750–820, fatal (14 m deep), diagonal: R1 west (26 m wide), the RIVER'S SLOT
 *              (d −99…−77), R2 (18 m) with the VIADUCT (roadBridge ×1.3, s 777.5, d −50, down the
 *              course rim to rim, 34 m: its deck meets the ground on both rims, Gorge Road at the top
 *              and Mill Race Road at the bottom; cars drive over it, and so does the iceberg, 14 m
 *              over the floor of R2: src/core/physics/deckGround.ts) and the KICKER on the line (lip
 *              s 778.5, d 40: the line meets it at ~18 m/s and clears; slow, it falls), R3 east
 *              (30 m), and a side ravine reaching up from R3 into the tongue below crossing E.
 *              Unsteered icebergs end up in the gorge.
 *   lower town s 850–1022: Lower Street (d 22), Mill Race Road (d −36, up to the viaduct) and a
 *              cross street (s 960): two crossroads, one signalised.
 *   lower weir CLIFF BAND s 1040, 8 m, d −80…60.
 *   the dam    s 930–1240: funnel walls from both sides converge on two channels split by a rock
 *              abutment (d 0). West channel (d −47…−6): the river along its west side, the DAM
 *              across it all (s 1170, d −26.5, span 36, scale 0.7: crest 6.3 m, 735 t·m/s, keyed
 *              into the rock at both ends, so its lake floods the whole channel above it, ~4100 m³).
 *              East channel: the east brook and the lower COFFER DAM (s 1150, scale 0.6, 540 t·m/s).
 *              Both stand on the lip of the DAM FALLS (CLIFF BAND s 1185, 16 m).
 *   harbour    s 1250–1550: Harbour Street (d 40), Quay Street (d −40), the quay (d −60), the
 *              HARBOUR CLIFF (band s 1420, 12 m, 300 m wide), boats moored in the harbour water past
 *              the coast, the LIGHTHOUSE (s 1505, d 120).
 *
 * ROUTES (autopilot, real water, chipping and traffic; see riversideTown.test.ts)
 *   line       the old town (4 houses in the block row), the level crossing, the gorge KICKER,
 *              2 houses in the lower town, the dry east side of the dam channel into the lake for its
 *              last ~30 m (it slows there: ~21 → 16 m/s), the DAM (bursts at 1.4× its strength: the
 *              lake drains in a flood, peak ~210 m³/s), four waterfalls: 96.2 s, 32.4 % ice,
 *              6 buildings, score 5589 (19 vehicles driving; they wait at the red lights).
 *   outskirts  the west lane beside the river (it fords the meltwater on the hilltop, s ≈ 125),
 *              crossing W, the river's slot through the gorge (it fords the river: ~22 → 11 m/s),
 *              the east brook's COFFER DAM: safer (no jump) but slower and plainer: 112 s, 32.9 %,
 *              4 buildings, score 4628 (102 s, 33.5 %, 4895 before the river rose in the glacier).
 *   viaduct    (playtest 2) the old town, crossing C, Station Street, down Gorge Road and over the
 *              VIADUCT (the iceberg rides its deck; it used to stop dead against the girder end, every
 *              lane and speed), Mill Race Road through the lower town, the DAM: 86.1 s, 34.8 % ice,
 *              5 buildings, score 5714. No jump, and measured a little quicker and higher-scoring
 *              than the line (the kicker's swing out to d 40 and back costs more than it pays).
 *   east       the gasworks and crossing E: steer left onto the kicker, or the side ravine / R3.
 *   dead ends  QUARRY (stuck), GASWORKS GULLY (stuck), the PARK (a slow iceberg rolls out of it
 *              and stalls against the railway bank), the side ravine and the gorge away from the
 *              slot and the kicker (fell), the river from the slot when slow (carried to the dam),
 *              off the side of the viaduct, or beside it into R2 (fell). Too slow off the kicker: fell. The centre line falls into the gorge at s ≈ 786; a
 *              no-input run does too (s 780–809).
 *
 * WATER BUDGET: metres 2900, turnMetresPerRadian 12. The line reaches the dam with ~52 t at
 * ~16 m/s (1.25·v·M ≈ 1.4× the dam's 735 t·m/s) and lands at ~32 % ice.
 */

/** Railway embankment: s on its axis at lateral offset d (a straight diagonal across the slope). */
const bankS = (d: number): number => Math.round((645 + 0.2093 * d) * 10) / 10;
/** The river gorge: s on its axis at lateral offset d. */
const gorgeS = (d: number): number => Math.round((785 + 0.15 * d) * 10) / 10;
/** Yaw (relative to the course) of a wagon standing on the embankment's rails. */
const RAIL_YAW = Math.PI / 2 + 0.21;

export const riversideTown: LevelDef = {
  id: 'riverside-town',
  index: 4,
  name: 'Riverside Town',
  subtitle: 'A hundred tonnes of ice and a whole hillside town: which street reaches the sea?',
  seed: 4404,
  bounds: { minX: -330, maxX: 330, minZ: -120, maxZ: 1780 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 221.6, halfWidth: 50 },
    { x: 0, z: 60, floor: 214.1, halfWidth: 120 },
    { x: 0, z: 160, floor: 201.1, halfWidth: 200 },
    { x: 0, z: 1552, floor: 48, halfWidth: 200 },
    { x: 0, z: 1780, floor: 22.9, halfWidth: 200 },
  ],
  cliffs: [
    // The mill weir: a rock step across the old town's upper edge.
    { s: 330, drop: 12, d: -30, width: 140 },
    // The lower weir, below the lower town.
    { s: 1040, drop: 8, d: -10, width: 140 },
    // The dam falls: the dam and the coffer dam stand on its lip.
    { s: 1185, drop: 16, d: 0, width: 120 },
    // The harbour cliff.
    { s: 1420, drop: 12, d: 0, width: 300 },
  ],
  wallHeight: 40,
  wallRamp: 30,
  startS: 30,
  coastS: 1550,
  finishS: 1570,
  theme: 'town',
  iceberg: { scale: 1.6, mass: 100 },
  water: { metres: 2900, turnMetresPerRadian: 12 },
  relief: {
    roll: 2.5,
    rollScale: 160,
    gullies: 2,
    gullySpacing: 50,
    outcrops: 4,
    outcropCover: 0.015,
    outcropScale: 26,
    lineClear: 18,
  },
  features: [
    // 0-1 The old town walls: the hilltop splits into the WEST lane, the OLD TOWN and the EAST side.
    {
      type: 'ridge',
      points: [
        { s: 140, d: -30 },
        { s: 220, d: -62 },
        { s: 300, d: -78 },
        { s: 345, d: -84 },
      ],
      width: 10,
      height: 9,
    },
    {
      type: 'ridge',
      points: [
        { s: 140, d: 30 },
        { s: 220, d: 60 },
        { s: 320, d: 72 },
        { s: 420, d: 76 },
      ],
      width: 10,
      height: 9,
    },
    // 2 The quarry wall: an L closing a pocket against the west wall (dead end: Quarry Road).
    {
      type: 'ridge',
      points: [
        { s: 470, d: -135 },
        { s: 545, d: -150 },
        { s: 562, d: -218 },
      ],
      width: 10,
      height: 9,
    },
    // 3 The closed gully behind the gasworks (dead end).
    {
      type: 'gully',
      points: [
        { s: 470, d: 165 },
        { s: 600, d: 188 },
      ],
      width: 18,
      depth: 9,
      closed: true,
    },
    // 4-7 The railway embankment: a grassy bank (crest it with speed) with three crossings,
    // W (d −150…−125), C (the level crossing at the foot of Main Street, d −40…−15) and E (75…100).
    {
      type: 'ridge',
      points: [
        { s: bankS(-218), d: -218 },
        { s: bankS(-165), d: -165 },
      ],
      width: 30,
      height: 5.5,
      profile: 'mound',
    },
    {
      type: 'ridge',
      points: [
        { s: bankS(-110), d: -110 },
        { s: bankS(-55), d: -55 },
      ],
      width: 30,
      height: 5.5,
      profile: 'mound',
    },
    {
      type: 'ridge',
      points: [
        { s: bankS(0), d: 0 },
        { s: bankS(60), d: 60 },
      ],
      width: 30,
      height: 5.5,
      profile: 'mound',
    },
    {
      type: 'ridge',
      points: [
        { s: bankS(115), d: 115 },
        { s: bankS(218), d: 218 },
      ],
      width: 30,
      height: 5.5,
      profile: 'mound',
    },
    // 8-10 THE GORGE (fatal): R1 west (too wide), the river's slot (a land neck, d −99…−77), R2
    // (18 m: jump it off the kicker at d 40; the viaduct crosses it at d −50), R3 east.
    {
      type: 'ravine',
      points: [
        { s: gorgeS(-218), d: -218 },
        { s: gorgeS(-112), d: -112 },
      ],
      width: 26,
      depth: 14,
    },
    {
      type: 'ravine',
      points: [
        { s: gorgeS(-68), d: -68 },
        { s: gorgeS(85), d: 85 },
      ],
      width: 18,
      depth: 14,
    },
    {
      type: 'ravine',
      points: [
        { s: gorgeS(85), d: 85 },
        { s: gorgeS(218), d: 218 },
      ],
      width: 30,
      depth: 14,
    },
    // 11 A side ravine reaching up into the tongue below crossing E (dead end: fell).
    {
      type: 'ravine',
      points: [
        { s: gorgeS(110), d: 110 },
        { s: 722, d: 150 },
      ],
      width: 18,
      depth: 12,
    },
    // 12 The kicker over R2, on the line.
    { type: 'ramp', s: 778.5, d: 40, width: 16, length: 14, height: 3.5 },
    // 13-15 The dam funnel: walls from both sides converge on two channels split by the abutment.
    {
      type: 'ridge',
      points: [
        { s: 930, d: -218 },
        { s: 1060, d: -110 },
        { s: 1150, d: -52 },
        { s: 1240, d: -52 },
      ],
      width: 10,
      height: 10,
    },
    {
      type: 'ridge',
      points: [
        { s: 930, d: 218 },
        { s: 1060, d: 120 },
        { s: 1150, d: 52 },
        { s: 1240, d: 52 },
      ],
      width: 10,
      height: 10,
    },
    {
      type: 'ridge',
      points: [
        { s: 1100, d: 0 },
        { s: 1240, d: 0 },
      ],
      width: 12,
      height: 12,
    },
    // 16-17 THE RIVER: meltwater from the glacier (source 'glacier': it rises under the ice and runs
    // out of a portal in the snout at s 16, d −47), down the hilltop's left side past the farms, down
    // the west side of the old town, over the mill weir, through the railway bank and the gorge's
    // slot, over the lower weir into the dam channel (the dam holds its reservoir), over the dam falls
    // and the harbour cliff into the sea. Its 2 m banks hold an iceberg of radius ≤ 2.1 m: this one
    // rides over them. The east brook springs from a cave in the east funnel wall (source 'cave': the
    // wall rises 8.2 m within 15 m behind the mouth) and runs down the east channel beside the
    // abutment, through the coffer dam and over the falls into its plunge pool.
    {
      type: 'stream',
      source: 'glacier',
      points: [
        { s: 0, d: -44 },
        { s: 20, d: -48 },
        { s: 60, d: -68 },
        { s: 100, d: -85 },
        { s: 150, d: -95 },
        { s: 250, d: -96 },
        { s: 330, d: -95 },
        { s: 420, d: -92 },
        { s: 520, d: -90 },
        { s: 626, d: -90 },
        { s: 700, d: -90 },
        { s: 771.5, d: -90 },
        { s: 830, d: -88 },
        { s: 930, d: -82 },
        { s: 1000, d: -76 },
        { s: 1040, d: -68 },
        { s: 1100, d: -40 },
        { s: 1140, d: -36 },
        { s: 1200, d: -36 },
        { s: 1240, d: -38 },
        { s: 1290, d: -75 },
        { s: 1420, d: -85 },
        { s: 1640, d: -85 },
      ],
      width: 16,
      bank: 2,
    },
    {
      type: 'stream',
      source: 'cave',
      points: [
        { s: 1104, d: 61 },
        { s: 1106, d: 46 },
        { s: 1130, d: 37 },
        { s: 1205, d: 36 },
        { s: 1232, d: 36 },
      ],
      width: 14,
      bank: 2,
      end: 'pool',
    },
    // 18-25 Streets: down-slope streets and terrace streets across the slope (intersections).
    { type: 'road', s0: 60, s1: 135, d: 0, width: 9 },
    {
      type: 'street',
      points: [
        { s: 185, d: -120 },
        { s: 300, d: -120 },
        { s: 345, d: -116 },
        { s: 360, d: -112 },
      ],
      width: 8,
      surface: 'gravel',
    },
    { type: 'road', s0: 200, s1: 320, d: 108, width: 8 },
    {
      type: 'street',
      points: [
        { s: 352, d: -65 },
        { s: 580, d: -65 },
        { s: 604, d: -27 },
      ],
      width: 9,
    },
    { type: 'road', s0: 352, s1: 702, d: -27, width: 10 },
    { type: 'road', s0: 352, s1: 540, d: 15, width: 9 },
    {
      type: 'street',
      points: [
        { s: 400, d: -76 },
        { s: 400, d: 65 },
      ],
      width: 9,
    },
    {
      type: 'street',
      points: [
        { s: 470, d: -76 },
        { s: 470, d: 65 },
      ],
      width: 9,
    },
    // 26-29 Quarry Road (into the dead end), Gasworks Road, Lower Street and the lower terrace.
    { type: 'road', s0: 380, s1: 555, d: -165, width: 9, surface: 'gravel' },
    { type: 'road', s0: 400, s1: 560, d: 122, width: 9 },
    { type: 'road', s0: 850, s1: 1022, d: 22, width: 9 },
    {
      type: 'street',
      points: [
        { s: 960, d: -50 },
        { s: 960, d: 36 },
      ],
      width: 9,
    },
    // 30 The park: a sunken lawn by the gasworks (a trap when slow).
    { type: 'basin', s: 470, d: 92, radius: 12, depth: 5.5 },
    // 31 The church knoll at the top of Church Lane.
    { type: 'hill', s: 565, d: 15, radius: 18, height: 6 },
    // 32 The water-tower knoll on the hilltop.
    { type: 'hill', s: 255, d: 140, radius: 16, height: 5 },
    // 33-34 Harbour: Harbour Street and the quay.
    { type: 'road', s0: 1260, s1: 1405, d: 40, width: 9 },
    { type: 'road', s0: 1440, s1: 1530, d: -60, width: 10 },
    // 35 Station Street, the terrace below the railway.
    {
      type: 'street',
      points: [
        { s: 702, d: -74 },
        { s: 702, d: 35 },
      ],
      width: 9,
    },
    // 36-39 West Lane, Gas Lane, Mill Race Road (from the viaduct through the lower town), Quay St.
    { type: 'road', s0: 360, s1: 465, d: -112, width: 8 },
    { type: 'road', s0: 352, s1: 525, d: 52, width: 8 },
    {
      type: 'street',
      points: [
        { s: 794.5, d: -50 },
        { s: 830, d: -48 },
        { s: 860, d: -36 },
        { s: 1022, d: -36 },
      ],
      width: 9,
    },
    { type: 'road', s0: 1260, s1: 1405, d: -40, width: 9 },
    // 40 The railway's track bed along the bank (level crossings in the gaps).
    {
      type: 'street',
      points: [
        { s: bankS(-218), d: -218 },
        { s: bankS(218), d: 218 },
      ],
      width: 5,
      surface: 'rail',
    },
    // 41-42 The gasworks yard and the station car park.
    { type: 'parking', s: 520, d: 138, length: 24, width: 14 },
    { type: 'parking', s: 716, d: -30, length: 14, width: 26 },
    // 43 Gorge Road: from Station Street down to the viaduct over R2 (Mill Race Road goes on).
    {
      type: 'street',
      points: [
        { s: 702, d: -50 },
        { s: 760.5, d: -50 },
      ],
      width: 9,
    },
  ],
  obstacles: [
    // Hilltop: Hill Road, the farm track with its fence, Tower Road.
    { kind: 'house', s: 85, d: -12 },
    { kind: 'house', s: 105, d: 12 },
    { kind: 'car', s: 122, d: 2.25, yaw: 0 },
    { kind: 'house', s: 125, d: -13 },
    { kind: 'barn', s: 200, d: -138 },
    { kind: 'fence', s: 250, d: -127, yaw: Math.PI / 2, span: 60 },
    { kind: 'house', s: 270, d: -132 },
    { kind: 'waterTower', s: 255, d: 140 },
    { kind: 'house', s: 220, d: 96 },
    { kind: 'car', s: 285, d: 110, yaw: 0 },
    { kind: 'house', s: 305, d: 120 },
    { kind: 'broadleaf', s: 280, d: 30 },
    { kind: 'pine', s: 200, d: 0 },
    // West lane and the quarry.
    { kind: 'house', s: 390, d: -152 },
    { kind: 'house', s: 430, d: -178 },
    { kind: 'truck', s: 495, d: -165, parked: true },
    { kind: 'truck', s: 525, d: -167, yaw: Math.PI, parked: true },
    { kind: 'boulder', s: 505, d: -195 },
    { kind: 'rockCluster', s: 535, d: -188, count: 3, spread: 3 },
    { kind: 'logPile', s: 470, d: -150 },
    // Old town: Main Street (d −27) carries the line through the houses lining it.
    { kind: 'house', s: 372, d: -38 },
    { kind: 'house', s: 380, d: -6 },
    { kind: 'house', s: 418, d: -36 },
    { kind: 'house', s: 412, d: -6 },
    { kind: 'house', s: 448, d: -38 },
    { kind: 'house', s: 440, d: -6 },
    { kind: 'house', s: 505, d: -36 },
    { kind: 'house', s: 492, d: -6 },
    { kind: 'house', s: 522, d: 6 },
    { kind: 'house', s: 545, d: -38 },
    { kind: 'house', s: 380, d: -76 },
    { kind: 'house', s: 430, d: -54 },
    { kind: 'house', s: 455, d: -76 },
    { kind: 'house', s: 520, d: -54 },
    { kind: 'house', s: 382, d: 26 },
    { kind: 'house', s: 430, d: 4 },
    { kind: 'house', s: 450, d: 26 },
    { kind: 'house', s: 505, d: 4 },
    { kind: 'house', s: 420, d: 48 },
    { kind: 'house', s: 490, d: 50 },
    { kind: 'car', s: 410, d: -24.5, yaw: 0 },
    { kind: 'car', s: 472.25, d: -40, yaw: Math.PI / 2 },
    { kind: 'bus', s: 472.25, d: 30, yaw: Math.PI / 2 },
    { kind: 'car', s: 540, d: -62.75, yaw: 0 },
    { kind: 'church', s: 565, d: 15 },
    // East: the gasworks on Gasworks Road.
    { kind: 'tank', s: 430, d: 140 },
    { kind: 'tank', s: 462, d: 140 },
    { kind: 'smokestack', s: 495, d: 138 },
    { kind: 'truck', s: 520, d: 138, yaw: 0 },
    { kind: 'house', s: 410, d: 104 },
    // The train on the embankment by the level crossing.
    { kind: 'railWagon', s: bankS(-70), d: -70, yaw: RAIL_YAW },
    { kind: 'railWagon', s: bankS(-56), d: -56, yaw: RAIL_YAW },
    { kind: 'railWagon', s: bankS(-42), d: -42, yaw: RAIL_YAW },
    // Between the railway and the gorge.
    { kind: 'house', s: 716, d: -62 },
    { kind: 'house', s: 716, d: 14 },
    { kind: 'house', s: 690, d: 30 },
    // The viaduct: Gorge Road over R2, rim to rim (down the course), on to Mill Race Road.
    { kind: 'roadBridge', s: 777.5, d: -50, yaw: Math.PI / 2, span: 34, scale: 1.3 },
    // Lower town: Lower Street and the lower terrace.
    { kind: 'house', s: 862, d: 34 },
    { kind: 'house', s: 885, d: 10 },
    { kind: 'house', s: 910, d: 34 },
    { kind: 'car', s: 930, d: 24.25, yaw: 0 },
    { kind: 'house', s: 945, d: -30 },
    { kind: 'house', s: 972, d: -12 },
    { kind: 'house', s: 990, d: 10 },
    { kind: 'truck', s: 1010, d: 19.75, yaw: Math.PI },
    { kind: 'house', s: 1018, d: 34 },
    // The dam across the riverbed (left) and the coffer dam across the east brook (right).
    { kind: 'dam', s: 1170, d: -26.5, span: 36, scale: 0.7 },
    { kind: 'dam', s: 1150, d: 26.5, span: 36, scale: 0.6 },
    // Harbour.
    { kind: 'house', s: 1290, d: 52 },
    { kind: 'car', s: 1330, d: 42.25, yaw: 0 },
    { kind: 'house', s: 1360, d: 28 },
    { kind: 'house', s: 1390, d: 52 },
    { kind: 'house', s: 1470, d: -46 },
    { kind: 'car', s: 1490, d: -62.5, yaw: Math.PI },
    { kind: 'house', s: 1500, d: -46 },
    { kind: 'boat', s: 1562, d: -48 },
    { kind: 'boat', s: 1566, d: -24 },
    { kind: 'boat', s: 1560, d: 30 },
    { kind: 'lighthouse', s: 1505, d: 120 },
    // More of the town (appended, so the placements above keep their seeds).
    { kind: 'house', s: 70, d: 13 },
    { kind: 'house', s: 70, d: -13 },
    { kind: 'house', s: 230, d: -110 },
    { kind: 'house', s: 272, d: 96 },
    { kind: 'house', s: 378, d: -133 },
    { kind: 'house', s: 410, d: -124 },
    { kind: 'house', s: 445, d: -133 },
    { kind: 'house', s: 420, d: -77 },
    { kind: 'house', s: 386, d: -54 },
    { kind: 'house', s: 560, d: -54 },
    { kind: 'house', s: 420, d: 26 },
    { kind: 'house', s: 505, d: 26 },
    { kind: 'house', s: 378, d: 41 },
    { kind: 'house', s: 440, d: 64 },
    { kind: 'house', s: 500, d: 64 },
    { kind: 'factoryHall', s: 545, d: 140 },
    { kind: 'house', s: 688, d: -62 },
    { kind: 'house', s: 688, d: 14 },
    { kind: 'house', s: 878, d: -23 },
    { kind: 'house', s: 878, d: -49 },
    { kind: 'house', s: 918, d: -49 },
    { kind: 'house', s: 1000, d: -49 },
    { kind: 'house', s: 1012, d: -23 },
    { kind: 'house', s: 938, d: 34 },
    { kind: 'house', s: 1015, d: 10 },
    { kind: 'car', s: 990, d: -33.75, yaw: 0 },
    { kind: 'house', s: 1275, d: 28 },
    { kind: 'house', s: 1330, d: 52 },
    { kind: 'house', s: 1275, d: -30 },
    { kind: 'house', s: 1310, d: -28 },
    { kind: 'house', s: 1350, d: -52 },
    { kind: 'house', s: 1385, d: -28 },
    { kind: 'car', s: 1360, d: -42.25, yaw: Math.PI },
    { kind: 'broadleaf', s: 520, d: -100 },
    { kind: 'broadleaf', s: 1250, d: 70 },
    { kind: 'pine', s: 860, d: 120 },
    { kind: 'house', s: 912, d: 14 },
    { kind: 'house', s: 942, d: 7 },
    // Traffic through the old town's junctions, and the station car park.
    { kind: 'car', s: 397.75, d: -45, yaw: -Math.PI / 2 },
    { kind: 'car', s: 402.25, d: 35, yaw: Math.PI / 2 },
    { kind: 'car', s: 440, d: 17.25, yaw: 0 },
    { kind: 'car', s: 380, d: -29.5, yaw: Math.PI },
    { kind: 'car', s: 500, d: 54, yaw: 0 },
    { kind: 'car', s: 957.75, d: -10, yaw: -Math.PI / 2 },
    { kind: 'car', s: 699.75, d: -60, yaw: -Math.PI / 2 },
    { kind: 'car', s: 716, d: -38 },
    { kind: 'car', s: 716, d: -22, yaw: Math.PI },
  ],
  line: [
    { s: 30, d: 0 },
    { s: 140, d: 0 },
    { s: 250, d: -12 },
    { s: 330, d: -18 },
    { s: 365, d: -8 },
    { s: 400, d: -6 },
    { s: 560, d: -6 },
    { s: 600, d: -18 },
    { s: 638, d: -27 },
    { s: 680, d: -5 },
    { s: 720, d: 30 },
    { s: 745, d: 40 },
    { s: 778.5, d: 40 },
    { s: 840, d: 30 },
    { s: 950, d: 5 },
    { s: 1080, d: -18 },
    { s: 1120, d: -16 },
    { s: 1240, d: -16 },
    { s: 1300, d: 8 },
    { s: 1420, d: 5 },
    { s: 1600, d: 0 },
  ],
  decor: {
    sceneryTreeDensity: 5,
    bushDensity: 4,
    grassTuftDensity: 16,
    pebbleDensity: 3,
  },
  sky: { top: '#2A86F0', horizon: '#CDEBFF', fog: '#D6ECFA' },
};
