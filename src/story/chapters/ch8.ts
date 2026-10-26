import type { ObstacleKind, TerrainFeature } from '../../core/types';
import type { ChapterDef, FragmentCondition } from '../types';
import { fragmentsOf, type OverlayRequest } from './authoring';

/**
 * CHAPTER 8 — "What Remains" (Act III, The Reckoning). Level 8, Highland Maze: the Clachan, the hamlet
 * where Ruth Vey was born and her daughter spent every childhood summer. The grid never reached this
 * far up the glen, so in 1958 the Clachan built its own small hydro power station on the glacier
 * stream, at the head of the glen: it gives every house its light and heat, runs the water pumps, the
 * school and the clinic's vaccine refrigerator. Its six buildings stand in a row across the head of
 * the glen, where the thaw begins, so every route down breaks it first (measured below), and the rest
 * of the chapter is played through a glen whose lights are already out. The documents follow it: what
 * it meant (the open day notice, always), the morning it was shut down (the keeper's log), and what
 * happened next (the school letter, or on a run that broke much of the Clachan the council's minutes), never
 * by saying anyone was hurt. This is also the chapter that names the archivist: Callum Reid's letter (the
 * intro document) says "Mara Vey", and her reflections sign themselves.
 *
 * What a run shows (at most four documents, src/story/select.ts MAX_FRAGMENTS; every Story playthrough
 * has a chapter 4 entry, so one of its two memories always holds): the open day notice (10) and the
 * keeper's log (9) on every run; then Achadh lost (8) and the two-column minutes (8) when the run broke
 * them, so the reflection that ends on the minutes never comes without them; then the school letter (7),
 * Ruth's Achadh letter (6), the chapter 4 memory (5) and, after it in authored order, the council's
 * stream notice (5). Since the glen was crowded (playtest 2) the line, the lanes from −12 to +4 and the
 * Clachan route break three or more Clachan homes, farm buildings and shared places (CLACHAN_LOST): on
 * the line, notice, log, the minutes (which now say how full the glen had become) and the school letter,
 * with the "much lost" reflection; on the Clachan route, notice, log, Achadh and the minutes. The middle
 * route and the lanes from +8 to +16 break the station, the distillery, tanks and sheds and at most one
 * home: notice, log, the school letter and Ruth's letter (the chapter 4 memory where Achadh was not
 * reached), with the "dark glen" reflection, which says how full the glen was. The stream notice and
 * "Once, plainly" (3) are shown only on a run with little else (select.test.ts plays these with a
 * chapter 4 history). Act III's world is brown water and a grey sky (src/story/environment.ts): the
 * reflections, the keeper's log and the stream notice say so.
 *
 * Base placements used (src/core/levels/highlandMaze.ts): 32 house x0.6 s 575 d -122 (the shepherd's
 * hut the line goes through), 0 house s 668 d 116 and 1 barn s 692 d 124 (Achadh farm), 4 church
 * s 760 d 140 (the church on its hill), 8 house s 890 d 120 (Balnacoil), 14 house s 1028 d 120 (by
 * the mill), 28 church s 1640 d 124 (the lochside church). The base level's road bridge over the
 * Gorge (20) is still there and, since playtest 2, carries the iceberg (src/core/physics/deckGround.ts;
 * in the base level the glen road over it reaches the sea, highlandMaze.ts). The story does not name
 * it: the chapter is about the station and the Clachan, and riding over the bridge does not break it.
 */

const F = fragmentsOf('ch8-remains');

/**
 * "A great deal of the Clachan went": at least three of its homes, farm buildings and shared places
 * broke. Built Clachan things only: felled trees, Calder's glen pipeline and tanks, the distillery,
 * the sheds and the power station's halls (industry, extraction) are not counted here. Since the glen
 * was crowded (playtest 2) the line, the lanes left of it and the Clachan route all get there (cottages,
 * the shepherd's hut, the fank; Achadh, its barn and Balnacoil); the middle and the lanes right of the
 * line break the station, tanks and sheds and leave at most one home.
 */
const CLACHAN_LOST: FragmentCondition = { destroyedAtLeast: 3, categories: ['home', 'farm', 'community'] };

/** The power station broke (any of its six buildings). */
const STATION_GONE: FragmentCondition = { landmark: 'clachan-station', status: 'destroyed' };

/** One extra placement of the crowded glen (overlay indices from EXTRA_FROM on). */
interface Extra {
  readonly kind: ObstacleKind;
  readonly s: number;
  readonly d: number;
  readonly scale?: number;
  readonly yaw?: number;
  readonly parked?: boolean;
  readonly near: string;
  readonly purpose: string;
}

/** Overlay index of the first extra placement (the thirteen placements of the first overlay come first). */
export const EXTRA_FROM = 13;

/**
 * The station roads (overlay features): two gravel roads down the braes below the power station, from
 * its west and east ends to the foot of the braes, so the station's cottages stand on a road.
 */
const STATION_ROADS: readonly TerrainFeature[] = [
  { type: 'road', s0: 75, s1: 130, d: -65, width: 5, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 75, s1: 130, d: 65, width: 5, surface: 'gravel', start: 'turning', end: 'trailhead' },
];

/**
 * The glen's crofting tracks (playtest 2, third pass: "over population of things ... impossible to
 * avoid"): gravel lanes left of the line, 40-65 m from it, so the rows of cottages along them stand on a
 * road. Each stops short of the waterfall bands, the basin, the Druim's lochan gully and the ridges.
 */
const GLEN_TRACKS: readonly TerrainFeature[] = [
  { type: 'road', s0: 505, s1: 575, d: -165, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 745, s1: 890, d: -160, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 912, s1: 1150, d: -150, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 1236, s1: 1292, d: -145, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 1530, s1: 1572, d: -110, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
];

const COTTAGE = 'A cottage of the Clachan: the glen was lived in from the power station all the way down.';

type GlenKind = 'house' | 'barn' | 'tank' | 'factoryHall' | 'logPile' | 'silo';

/**
 * The glen along the way down (EXTRA's last part; playtest 2 review: below the station each 200 m
 * band of the glen held 1-10 built things, and from the chase camera it was open brown ground):
 * [kind, s, d, scale, where]. Crofts, sheds, woodpiles and the glen pipeline's tank batteries beside
 * every stretch the line and the routes run in the open, where the chase camera sees them: at least
 * 21 m left or 25 m right of the line (the measured lanes run from −12 to +16 m), clear of the middle
 * and Clachan routes, the crags, the woods, the lochans and the waterfall bands. Houses and barns
 * stand within 60 m of a road or track (the station roads, the stalkers' track, the glen road).
 */
const GLEN: readonly (readonly [GlenKind, number, number, number, string])[] = [
  // The braes below the station (s 150-240), left of the line.
  ['house', 160, -100, 0.55, 'the braes below the west station road'],
  ['factoryHall', 186, -122, 0.35, 'the braes, a hay shed'],
  ['logPile', 204, -138, 1, 'the braes, a croft\'s woodpile'],
  ['factoryHall', 228, -150, 0.35, 'the braes, a sheep shed'],
  ['tank', 172, -128, 0.6, 'the braes, the station\'s oil tank'],
  // The right glen (s 380-470), either side of the middle and Clachan routes.
  ['factoryHall', 392, 84, 0.4, 'the right glen, the distillery\'s malt barn'],
  ['tank', 412, 80, 0.55, 'the right glen, a distillery tank'],
  ['tank', 440, 132, 0.55, 'the right glen, a distillery tank'],
  ['logPile', 380, 138, 1, 'the right glen, the distillery\'s woodpile'],
  // The lower left glen (s 700-760), right of the line, on the stalkers' track's side.
  ['barn', 712, -84, 0.5, 'the lower left glen, a byre by the stalkers\' track'],
  ['house', 736, -80, 0.5, 'the lower left glen, a croft by the stalkers\' track'],
  ['logPile', 754, -86, 1, 'the lower left glen, the croft\'s woodpile'],
  // Below the second waterfall (s 935-1010), right of the line.
  ['tank', 940, -72, 0.7, 'below the second waterfall, a glen pipeline tank battery'],
  ['factoryHall', 980, -64, 0.45, 'below the second waterfall, a pumping station'],
  ['tank', 1004, -56, 0.7, 'below the second waterfall, a glen pipeline tank battery'],
  // Above the Druim (s 1115-1165), right of the line.
  ['tank', 1120, -54, 0.7, 'above the Druim, a glen pipeline tank battery'],
  ['tank', 1136, -46, 0.7, 'above the Druim, a glen pipeline tank battery'],
  ['factoryHall', 1158, -52, 0.45, 'above the Druim, a pumping station'],
  // Round the Gorge's left end (s 1395-1445), right of the line.
  ['tank', 1400, -62, 0.7, 'below the Gorge, a glen pipeline tank battery'],
  ['tank', 1418, -52, 0.7, 'below the Gorge, a glen pipeline tank battery'],
  ['factoryHall', 1440, -44, 0.45, 'below the Gorge, a compressor house'],
  // The lower braes above the loch falls (s 1525-1565), right of the line.
  ['tank', 1528, -24, 0.65, 'the lower braes, a metering station tank'],
  ['tank', 1544, -16, 0.65, 'the lower braes, a metering station tank'],
  ['silo', 1562, -8, 0.6, 'the lower braes, a feed silo'],
  // Below the second waterfall (s 1065-1090), right of the line, and above the Gorge's left end, left of it.
  ['tank', 1068, -60, 0.65, 'below the mill falls, a glen pipeline tank'],
  ['factoryHall', 1086, -54, 0.4, 'below the mill falls, a pipeline hut'],
  ['tank', 1255, -128, 0.65, 'above the Gorge\'s left end, a glen pipeline tank'],
  ['tank', 1272, -136, 0.65, 'above the Gorge\'s left end, a glen pipeline tank'],
  // The glen road beyond the Gorge bridge (s 1350-1560): the cottages the Clachan route passes.
  ['house', 1352, 112, 0.5, 'on the glen road below the Gorge bridge'],
  ['barn', 1374, 108, 0.5, 'on the glen road below the Gorge bridge, a byre'],
  ['house', 1462, 112, 0.5, 'on the glen road above the loch falls'],
  ['house', 1490, 108, 0.5, 'on the glen road above the loch falls'],
  ['house', 1556, 110, 0.5, 'on the glen road at the loch falls'],
  // The lochside below the last falls (s 1620-1695): the harbour's sheds, left of the line.
  ['factoryHall', 1626, -62, 0.3, 'on the lochside, the harbour\'s net store'],
  ['tank', 1642, -78, 0.5, 'on the lochside, the harbour\'s fuel tank'],
  ['factoryHall', 1666, -66, 0.3, 'on the lochside, a boat shed'],
  ['logPile', 1690, -80, 1, 'on the lochside, a woodpile'],
  ['factoryHall', 1650, 14, 0.25, 'on the lochside, the harbour office'],
];

const GLEN_PURPOSE: Readonly<Record<GlenKind, string>> = {
  house: COTTAGE,
  barn: 'A croft\'s byre: the glen was farmed all the way down.',
  tank: 'A tank of the glen pipeline: Calder\'s oil, carried across the highlands.',
  factoryHall: 'A shed or pumping station of the crowded glen.',
  logPile: 'A croft\'s woodpile.',
  silo: 'A croft\'s feed silo.',
};

type DenseKind = 'house' | 'barn' | 'apartmentBlock' | 'factoryHall' | 'silo';

/**
 * THE CROWDED GLEN, THIRD PASS (playtest 2: "over population of things in levels 7 and 8 that it is
 * impossible to avoid"; the lead's chase-camera review: the glen still read as open grass): [kind, s, d,
 * scale]. A valley community beside the lanes from the braes to the loch, at working size: rows of
 * cottages and byres along the crofting tracks (GLEN_TRACKS) and the glen road, and away from the roads
 * the housing schemes' flats, the factory halls and feed silos. A grid 16 m apart in s, each at least 20 m
 * plus its footprint radius left of the line or 23 m plus it right of it (the measured lanes run from -12
 * to +16 m), 9 m plus it from the middle and Clachan routes, on level ground (no crag, ravine, lochan or
 * waterfall band), clear of every road, tree and building. The Leap's run-up (s 250-500) stays as it was.
 */
const DENSE: readonly (readonly [DenseKind, number, number, number])[] = [
    ['apartmentBlock', 200, -162, 0.55], ['factoryHall', 248, -165, 0.7],
    ['apartmentBlock', 248, -133, 0.45], ['factoryHall', 248, -69, 0.6], ['silo', 248, -37, 1],
    ['apartmentBlock', 248, -21, 0.5], ['house', 504, -154, 1], ['house', 520, -178, 0.85],
    ['barn', 536, -153, 0.8], ['house', 536, -89, 0.9], ['house', 552, -80, 1], ['house', 568, -152, 0.8],
    ['house', 568, -88, 1], ['house', 584, -159, 0.85], ['factoryHall', 584, -47, 0.75],
    ['barn', 600, -166, 0.8], ['house', 600, -150, 0.9], ['house', 600, -86, 1], ['house', 616, -77, 0.8],
    ['house', 616, -61, 1], ['apartmentBlock', 616, -45, 0.55], ['house', 632, -86, 0.85],
    ['barn', 632, -54, 0.8], ['house', 648, -78, 0.9], ['house', 648, -62, 1], ['house', 664, -87, 0.8],
    ['house', 664, -71, 1], ['house', 664, -55, 0.85], ['barn', 680, -64, 0.8], ['house', 696, -153, 0.9],
    ['house', 696, -73, 1], ['house', 696, -57, 0.8], ['house', 712, -66, 1], ['house', 728, -89, 0.85],
    ['barn', 744, -176, 0.8], ['house', 760, -150, 0.9], ['factoryHall', 760, -70, 0.7],
    ['apartmentBlock', 760, -38, 0.45], ['house', 776, -172, 1], ['factoryHall', 792, -83, 0.6],
    ['silo', 792, -51, 1], ['factoryHall', 808, -41, 0.75], ['apartmentBlock', 824, -80, 0.55],
    ['factoryHall', 840, -39, 0.7], ['house', 856, -174, 0.8], ['house', 856, -142, 1],
    ['house', 872, -149, 0.85], ['barn', 920, -169, 0.8], ['house', 920, -137, 0.9],
    ['apartmentBlock', 920, -73, 0.45], ['house', 936, -176, 1], ['house', 936, -160, 0.8],
    ['house', 952, -167, 1], ['house', 952, -135, 0.85], ['factoryHall', 952, -23, 0.6],
    ['barn', 968, -173, 0.8], ['house', 984, -163, 0.9], ['house', 984, -131, 1], ['silo', 984, -51, 1],
    ['apartmentBlock', 984, -35, 0.5], ['house', 1000, -170, 0.8], ['house', 1000, -138, 1],
    ['house', 1016, -160, 0.85], ['barn', 1016, -128, 0.8], ['factoryHall', 1016, -32, 0.75],
    ['house', 1032, -166, 0.9], ['house', 1032, -134, 1], ['apartmentBlock', 1032, -54, 0.55],
    ['house', 1048, -173, 0.8], ['factoryHall', 1048, -29, 0.7], ['house', 1064, -163, 1],
    ['house', 1080, -169, 0.85], ['barn', 1096, -175, 0.8], ['house', 1096, -159, 0.9],
    ['apartmentBlock', 1096, -31, 0.45], ['house', 1112, -166, 1], ['factoryHall', 1112, -22, 0.6],
    ['silo', 1112, -6, 1], ['house', 1128, -173, 0.8], ['house', 1128, -125, 1],
    ['house', 1144, -131, 0.85], ['barn', 1144, -115, 0.8], ['apartmentBlock', 1144, -3, 0.5],
    ['house', 1160, -170, 0.9], ['house', 1160, -154, 1], ['house', 1160, -138, 0.8],
    ['house', 1160, -122, 1], ['house', 1176, -144, 0.85], ['barn', 1176, -128, 0.8],
    ['house', 1176, -112, 0.9], ['factoryHall', 1176, -32, 0.75], ['apartmentBlock', 1208, -46, 0.55],
    ['house', 1224, -151, 1], ['house', 1224, -135, 0.8], ['factoryHall', 1224, -7, 0.7],
    ['house', 1240, -162, 1], ['house', 1240, -130, 0.85], ['barn', 1240, -114, 0.8],
    ['apartmentBlock', 1240, -18, 0.45], ['house', 1256, -174, 0.9], ['house', 1256, -158, 1],
    ['factoryHall', 1256, -46, 0.6], ['silo', 1256, -30, 1], ['apartmentBlock', 1256, -14, 0.5],
    ['house', 1272, -169, 0.8], ['house', 1272, -121, 1], ['house', 1288, -164, 0.85],
    ['factoryHall', 1288, -52, 0.75], ['apartmentBlock', 1288, -20, 0.55],
    ['factoryHall', 1320, -56, 0.7], ['barn', 1336, -130, 0.8], ['factoryHall', 1368, -148, 0.6],
    ['silo', 1368, -36, 1], ['apartmentBlock', 1368, -20, 0.5], ['factoryHall', 1400, -142, 0.75],
    ['apartmentBlock', 1400, -14, 0.55], ['factoryHall', 1416, -32, 0.7],
    ['apartmentBlock', 1432, -162, 0.45], ['factoryHall', 1432, -130, 0.6], ['silo', 1432, -114, 1],
    ['apartmentBlock', 1432, -18, 0.5], ['factoryHall', 1448, -148, 0.75],
    ['apartmentBlock', 1448, -116, 0.55], ['factoryHall', 1448, -4, 0.7],
    ['apartmentBlock', 1464, -135, 0.45], ['factoryHall', 1464, -39, 0.6], ['silo', 1464, -23, 1],
    ['apartmentBlock', 1464, 9, 0.5], ['house', 1480, -107, 0.9], ['factoryHall', 1480, -11, 0.75],
    ['house', 1496, -143, 1], ['house', 1496, -95, 0.8], ['apartmentBlock', 1496, 17, 0.55],
    ['factoryHall', 1512, -2, 0.7], ['apartmentBlock', 1528, 10, 0.45], ['house', 1544, -89, 1],
    ['factoryHall', 1544, 23, 0.6], ['house', 1560, -125, 0.85], ['barn', 1560, -93, 0.8],
    ['house', 1576, -129, 0.9], ['house', 1576, -97, 1], ['silo', 1576, -1, 1],
    ['apartmentBlock', 1576, 15, 0.5], ['house', 1608, -103, 0.8], ['house', 1608, -87, 1],
    ['house', 1608, -71, 0.85], ['factoryHall', 1608, 9, 0.75], ['barn', 1624, -106, 0.8],
    ['house', 1624, -90, 0.9], ['apartmentBlock', 1640, -93, 0.55], ['house', 1656, 44, 1],
    ['factoryHall', 1672, -108, 0.7], ['apartmentBlock', 1688, -67, 0.45], ['house', 1688, 45, 0.8],
    ['house', 1304, -158, 1], ['house', 1315, -143, 0.85], ['factoryHall', 1381, -48, 0.7],
    ['apartmentBlock', 1414, -118, 0.45], ['apartmentBlock', 1496, -27, 0.55], ['house', 1532, -131, 1],
    ['house', 1532, -83, 0.85],
];

const DENSE_PURPOSE: Readonly<Record<DenseKind, string>> = {
  house: COTTAGE,
  barn: 'A byre: the glen was farmed all the way down.',
  apartmentBlock: 'A block of the housing scheme: the glen filled up as the towns below it flooded.',
  factoryHall: 'A works of the crowded glen: a sawmill, a creamery, a bottling hall.',
  silo: 'A feed silo of the crofts.',
};

type RowKind = 'house' | 'tank' | 'factoryHall' | 'silo' | 'logPile';

/**
 * The crofts ON the way down (EXTRA's very last part; playtest 2, second pass: "over population of things
 * ... that it is impossible to avoid"): [kind, s, d, scale, where]. Rows across the line's lanes, 7 m
 * apart from 6 m left of the line to 29 m right of it, so every lane from -9 to +16 meets one (the
 * iceberg is 5.7 m across; no gap lets it through). Lanes -12 to -10 pass their left ends: they reach the
 * sea with the least ice (they pass the glen pipeline's left end), and each hit's turn costs them melt;
 * they still break the station, the cottages and the fank. A row of cottages by the end of the stalkers' track,
 * and crofts' yards (sheds 0.25, oil tanks 0.35, feed silos 0.45, woodpiles) where no road is near.
 * All light: none chips this 60 t iceberg (break impulse 70-110 against the chip threshold of
 * 2.5 m/s, 150), each costs it about 1.5 m/s. Only where the line is on the ground, out of the pinewoods,
 * clear of the Leap's run-up (s 250-470) and the Gorge's left end (s 1280-1400).
 */
const ROWS: readonly (readonly [RowKind, number, number, number, string])[] = [
  // s 706 (the line d -124), by the end of the stalkers' track.
  ['house', 706, -130, 0.42, 'by the end of the stalkers\' track, a cottage'],
  ['house', 706, -123, 0.42, 'by the end of the stalkers\' track, a cottage'],
  ['house', 706, -116, 0.42, 'by the end of the stalkers\' track, a cottage'],
  ['house', 706, -109, 0.42, 'by the end of the stalkers\' track, a cottage'],
  ['house', 706, -102, 0.42, 'by the end of the stalkers\' track, a cottage'],
  ['house', 706, -95, 0.42, 'by the end of the stalkers\' track, a cottage'],
  // s 860 (the line d -112), above the second waterfall.
  ['tank', 860, -118, 0.35, 'above the second waterfall, a croft\'s oil tank'],
  ['factoryHall', 860, -111, 0.25, 'above the second waterfall, a croft\'s shed'],
  ['silo', 860, -104, 0.45, 'above the second waterfall, a croft\'s feed silo'],
  ['logPile', 860, -97, 1, 'above the second waterfall, a croft\'s woodpile'],
  ['factoryHall', 860, -90, 0.25, 'above the second waterfall, a croft\'s shed'],
  ['tank', 860, -83, 0.35, 'above the second waterfall, a croft\'s oil tank'],
  // s 970 (the line d -104), below the second waterfall.
  ['tank', 970, -110, 0.35, 'below the second waterfall, a croft\'s oil tank'],
  ['factoryHall', 970, -103, 0.25, 'below the second waterfall, a croft\'s shed'],
  ['silo', 970, -96, 0.45, 'below the second waterfall, a croft\'s feed silo'],
  ['logPile', 970, -89, 1, 'below the second waterfall, a croft\'s woodpile'],
  ['factoryHall', 970, -82, 0.25, 'below the second waterfall, a croft\'s shed'],
  ['tank', 970, -75, 0.35, 'below the second waterfall, a croft\'s oil tank'],
  // s 1135 (the line d -87), above the Druim.
  ['tank', 1135, -93, 0.35, 'above the Druim, a croft\'s oil tank'],
  ['factoryHall', 1135, -86, 0.25, 'above the Druim, a croft\'s shed'],
  ['silo', 1135, -79, 0.45, 'above the Druim, a croft\'s feed silo'],
  ['logPile', 1135, -72, 1, 'above the Druim, a croft\'s woodpile'],
  ['factoryHall', 1135, -65, 0.25, 'above the Druim, a croft\'s shed'],
  ['tank', 1135, -58, 0.35, 'above the Druim, a croft\'s oil tank'],
  // s 1262 (the line d -90), below the Druim.
  ['tank', 1262, -96, 0.35, 'below the Druim, a croft\'s oil tank'],
  ['factoryHall', 1262, -89, 0.25, 'below the Druim, a croft\'s shed'],
  ['silo', 1262, -82, 0.45, 'below the Druim, a croft\'s feed silo'],
  ['logPile', 1262, -75, 1, 'below the Druim, a croft\'s woodpile'],
  ['factoryHall', 1262, -68, 0.25, 'below the Druim, a croft\'s shed'],
  ['tank', 1262, -61, 0.35, 'below the Druim, a croft\'s oil tank'],
  // s 1420 (the line d -87), below the Gorge's left end.
  ['tank', 1420, -93, 0.35, 'below the Gorge\'s left end, a croft\'s oil tank'],
  ['factoryHall', 1420, -86, 0.25, 'below the Gorge\'s left end, a croft\'s shed'],
  ['silo', 1420, -79, 0.45, 'below the Gorge\'s left end, a croft\'s feed silo'],
  ['logPile', 1420, -72, 1, 'below the Gorge\'s left end, a croft\'s woodpile'],
  ['factoryHall', 1420, -65, 0.25, 'below the Gorge\'s left end, a croft\'s shed'],
  ['tank', 1420, -58, 0.35, 'below the Gorge\'s left end, a croft\'s oil tank'],
];

const ROW_PURPOSE: Readonly<Record<RowKind, string>> = {
  house: COTTAGE,
  tank: 'A croft\'s oil tank: the glen was lived in all the way down.',
  factoryHall: 'A croft\'s shed: the glen was farmed all the way down.',
  silo: 'A croft\'s feed silo.',
  logPile: 'A croft\'s woodpile.',
};




/**
 * THE CROWDED GLEN (Act III: avoiding human things is no longer possible). Below the power station:
 * the station roads and their cottages on the braes, where every way down crosses; the distillery in
 * the right glen; the cottages along the stalkers' track in the lower left glen and the glen road
 * above Achadh; the power line pylons across the middle glen; Calder's metering station on the lower
 * braes; the boat shed on the lochside. The left glen above the Leap is left as it was: every lane
 * that takes the Leap needs all its speed there. Measured in the OVERLAY comment.
 */
const EXTRA: readonly Extra[] = [
  // The station roads: a parked car on each, cottages along them.
  { kind: 'car', s: 100, d: -66.5, yaw: 0, parked: true, near: 's≈100 d≈−66, parked on the west station road', purpose: 'The keeper\'s car.' },
  { kind: 'car', s: 100, d: 66.5, yaw: 0, parked: true, near: 's≈100 d≈66, parked on the east station road', purpose: 'A car at the station cottages.' },
  { kind: 'house', s: 100, d: -20, scale: 0.6, near: 's≈100 d≈−20, below the power station, on the line', purpose: COTTAGE },
  { kind: 'house', s: 95, d: -48, scale: 0.6, near: 's≈95 d≈−48, by the west station road', purpose: COTTAGE },
  { kind: 'house', s: 85, d: -82, scale: 0.6, near: 's≈85 d≈−82, beside the west station road', purpose: COTTAGE },
  { kind: 'house', s: 117, d: -84, scale: 0.6, near: 's≈117 d≈−84, beside the west station road', purpose: COTTAGE },
  { kind: 'house', s: 100, d: 33, scale: 0.6, near: 's≈100 d≈33, below the power station, on the way to the right glen', purpose: COTTAGE },
  { kind: 'house', s: 125, d: 50, scale: 0.6, near: 's≈125 d≈50, by the east station road', purpose: COTTAGE },
  { kind: 'house', s: 85, d: 82, scale: 0.6, near: 's≈85 d≈82, beside the east station road', purpose: COTTAGE },
  { kind: 'house', s: 120, d: 84, scale: 0.6, near: 's≈120 d≈84, beside the east station road', purpose: COTTAGE },
  // The distillery in the right glen, where the middle and Clachan routes come down.
  {
    kind: 'factoryHall',
    s: 330,
    d: 116,
    scale: 0.33,
    yaw: Math.PI / 2,
    near: 's≈330 d≈116, the right glen',
    purpose: 'The Clachan distillery, where the glen\'s whisky is made.',
  },
  { kind: 'tank', s: 365, d: 121, scale: 0.35, near: 's≈365 d≈121, the right glen', purpose: 'The distillery\'s spirit tank.' },
  { kind: 'smokestack', s: 350, d: 138, scale: 0.3, near: 's≈350 d≈138, the right glen', purpose: 'The distillery\'s chimney.' },
  {
    kind: 'factoryHall',
    s: 300,
    d: 131,
    scale: 0.3,
    yaw: Math.PI / 2,
    near: 's≈300 d≈131, the right glen',
    purpose: 'The distillery\'s warehouse, where the casks are kept.',
  },
  // Cottages along the stalkers' track in the lower left glen (d −110, s 585-700), and its parked cars.
  { kind: 'house', s: 560, d: -137.5, scale: 0.42, near: 's≈560 d≈−137, below the Leap, west of the line', purpose: COTTAGE },
  { kind: 'house', s: 575, d: -112, scale: 0.42, near: 's≈575 d≈−112, by the shepherd\'s hut, east of the line', purpose: COTTAGE },
  { kind: 'house', s: 630, d: -130, scale: 0.42, near: 's≈630 d≈−130, by the stalkers\' track, west of the line', purpose: COTTAGE },
  { kind: 'house', s: 665, d: -120, scale: 0.5, near: 's≈665 d≈−120, by the stalkers\' track, on the line', purpose: COTTAGE },
  { kind: 'house', s: 720, d: -138, scale: 0.38, near: 's≈720 d≈−138, by the lochan, west of the line', purpose: COTTAGE },
  { kind: 'house', s: 745, d: -133, scale: 0.38, near: 's≈745 d≈−133, below the lochan, west of the line', purpose: COTTAGE },
  { kind: 'barn', s: 612, d: -94, scale: 0.5, near: 's≈612 d≈−94, by the stalkers\' track', purpose: 'A cowshed by the stalkers\' track.' },
  { kind: 'car', s: 640, d: -110, yaw: 0, parked: true, near: 's≈640 d≈−110, parked on the stalkers\' track', purpose: 'A car on the stalkers\' track.' },
  { kind: 'car', s: 690, d: -110, yaw: 0, parked: true, near: 's≈690 d≈−110, parked on the stalkers\' track', purpose: 'A car on the stalkers\' track.' },
  // The upper Clachan: two more cottages on the glen road above Achadh, and more of its traffic.
  { kind: 'house', s: 600, d: 108, scale: 0.43, near: 's≈600 d≈108, the glen road above Achadh', purpose: COTTAGE },
  { kind: 'house', s: 632, d: 111, scale: 0.43, near: 's≈632 d≈111, the glen road above Achadh', purpose: COTTAGE },
  { kind: 'car', s: 780, d: 96.75, yaw: 0, near: 's≈780 d≈97, driving down the glen road', purpose: 'A car on the glen road.' },
  { kind: 'car', s: 960, d: 93.25, yaw: Math.PI, near: 's≈960 d≈93, driving up the glen road', purpose: 'A car on the glen road.' },
  // The lower left glen below the lochan: a woodpile and the glen pipeline's pumping tanks.
  { kind: 'logPile', s: 830, d: -104, near: 's≈830 d≈−104, the lower left glen', purpose: 'A woodpile of the glen\'s forestry.' },
  { kind: 'tank', s: 1030, d: -94, scale: 0.28, near: 's≈1030 d≈−94, below the second waterfall', purpose: 'A tank of the glen pipeline\'s pumping station.' },
  { kind: 'tank', s: 1150, d: -82, scale: 0.28, near: 's≈1150 d≈−82, above the Druim', purpose: 'A tank of the glen pipeline\'s pumping station.' },
  { kind: 'tank', s: 1100, d: -74, scale: 0.28, near: 's≈1100 d≈−74, below the second waterfall', purpose: 'A tank of the glen pipeline\'s pumping station.' },
  // The Clachan's power line across the middle glen.
  { kind: 'pylon', s: 900, d: 12, scale: 0.4, near: 's≈900 d≈12, the middle glen', purpose: 'A pylon of the line that carries the station\'s power down the glen.' },
  { kind: 'pylon', s: 1020, d: 9, scale: 0.4, near: 's≈1020 d≈9, the middle glen', purpose: 'A pylon of the line that carries the station\'s power down the glen.' },
  // Calder's metering station on the lower braes, where the line and the middle rejoin.
  { kind: 'tank', s: 1460, d: -74, scale: 0.28, near: 's≈1460 d≈−74, the lower braes', purpose: 'A tank of Calder\'s metering station on the glen pipeline.' },
  {
    kind: 'factoryHall',
    s: 1505,
    d: -62,
    scale: 0.23,
    yaw: Math.PI / 2,
    near: 's≈1505 d≈−62, the lower braes',
    purpose: 'The metering station\'s hut.',
  },
  { kind: 'tank', s: 1475, d: -95, scale: 0.28, near: 's≈1475 d≈−95, the lower braes', purpose: 'A tank of Calder\'s metering station.' },
  { kind: 'tank', s: 1490, d: -58, scale: 0.28, near: 's≈1490 d≈−58, the lower braes', purpose: 'A tank of Calder\'s metering station.' },
  { kind: 'tank', s: 1460, d: -60, scale: 0.28, near: 's≈1460 d≈−60, the lower braes', purpose: 'A tank of Calder\'s metering station.' },
  // The lochside: a boat shed on the beach, more cars in the street.
  {
    kind: 'factoryHall',
    s: 1660,
    d: -22,
    scale: 0.2,
    yaw: Math.PI / 2,
    near: 's≈1660 d≈−22, on the lochside below the falls',
    purpose: 'The lochside boat shed.',
  },
  {
    kind: 'factoryHall',
    s: 1675,
    d: -12,
    scale: 0.2,
    yaw: Math.PI / 2,
    near: 's≈1675 d≈−12, on the lochside below the falls',
    purpose: 'The lochside net store.',
  },
  {
    kind: 'factoryHall',
    s: 1660,
    d: -5,
    scale: 0.2,
    yaw: Math.PI / 2,
    near: 's≈1660 d≈−5, on the lochside below the falls',
    purpose: 'The lochside smokehouse.',
  },
  { kind: 'car', s: 1662, d: 81.75, yaw: 0, near: 's≈1662 d≈82, driving along the lochside street', purpose: 'A car in the lochside street.' },
  ...GLEN.map(
    ([kind, s, d, scale, where]): Extra => ({
      kind,
      s,
      d,
      ...(scale !== 1 ? { scale } : {}),
      ...(kind === 'factoryHall' ? { yaw: Math.PI / 2 } : {}),
      near: `s≈${s} d≈${d}, ${where}`,
      purpose: GLEN_PURPOSE[kind],
    }),
  ),
  // THE CROFTS ON THE WAY DOWN (playtest 2, second pass): ROWS, across the line's lanes.
  ...ROWS.map(
    ([kind, s, d, scale, where]): Extra => ({
      kind,
      s,
      d,
      ...(scale !== 1 ? { scale } : {}),
      ...(kind === 'factoryHall' ? { yaw: Math.PI / 2 } : {}),
      near: `s≈${s} d≈${d}, ${where}`,
      purpose: ROW_PURPOSE[kind],
    }),
  ),
  // THE CROWDED GLEN, THIRD PASS: DENSE, beside the lanes.
  ...DENSE.map(
    ([kind, s, d, scale]): Extra => ({
      kind,
      s,
      d,
      ...(scale !== 1 ? { scale } : {}),
      ...(kind === 'factoryHall' || kind === 'apartmentBlock' ? { yaw: Math.PI / 2 } : {}),
      near: `s≈${s} d≈${d}, in the crowded glen`,
      purpose: DENSE_PURPOSE[kind],
    }),
  ),
];

export const OVERLAY_REQUESTS: readonly OverlayRequest[] = [
  {
    kind: 'apartmentBlock',
    near: 's≈1605 d≈40, on the seaward side of the lochside street (d 80, s 1614-1688)',
    purpose:
      'Lochside flats built in 2033 for families moved off Riverside\'s lower-town flood plain: people relocated ' +
      'to be safe, a partial action the thaw reached anyway.',
    landmark: { id: 'lochside-flats', name: 'The lochside flats' },
  },
  {
    kind: 'apartmentBlock',
    near: 's≈1668 d≈38, second block on the lochside street',
    purpose: 'Second lochside block: a village grown by people the water had already moved once.',
  },
  {
    kind: 'pipeline',
    near: 's≈520, across the lower left glen d≈-190 to -60 on supports, below the Leap (s 470-500)',
    purpose: 'Calder\'s coastal pipeline again, carried across the highlands: extraction has reached even here.',
    landmark: { id: 'glen-pipeline', name: 'The glen pipeline' },
  },
  {
    kind: 'tank',
    near: 's≈1100 d≈130, beside the glen road (d 95) below the mill falls',
    purpose: 'The pipeline\'s compressor station tank in the middle of the glen.',
  },
  {
    kind: 'monument',
    near: 's≈826 d≈82, at the Clachan crossroads (cross street s 820, glen road d 95)',
    purpose: 'The Clachan market cross, where the community council posted its notices and the post van stopped.',
    landmark: { id: 'market-cross', name: 'The Clachan market cross' },
  },
  {
    kind: 'house',
    near: 's≈812 d≈112, a cottage at the crossroads on the cottages\' lane',
    purpose: 'A cottage: the Clachan was a place people lived, all along the road.',
  },
  {
    kind: 'house',
    near: 's≈1300 d≈110, below the Gorge bridge on the glen road (d 95, s 1260-1575)',
    purpose: 'The ferry cottage on the glen road, on the way out.',
  },
  {
    kind: 'factoryHall',
    near: 's≈50 d≈-4, at the head of the glen just below the spawn, square across the slope',
    purpose:
      'The Clachan power station (1958): the turbine house of the hamlet\'s own small hydro station on the ' +
      'glacier stream. It gives the whole glen its light and heat, runs the water pumps, the school and the ' +
      'clinic\'s vaccine refrigerator, and it stands where every way down from the ice begins.',
    landmark: { id: 'clachan-station', name: 'The Clachan power station', label: 'Clachan power station · lights the whole glen' },
  },
  {
    kind: 'factoryHall',
    near: 's≈50 d≈-16, left of the turbine house',
    purpose: 'The station\'s switch house beside the turbine house: the buildings are one station.',
  },
  {
    kind: 'factoryHall',
    near: 's≈50 d≈8, right of the turbine house',
    purpose: 'The station\'s transformer house, where the power leaves for the houses down the glen.',
  },
  {
    kind: 'factoryHall',
    near: 's≈50 d≈-27, left of the switch house',
    purpose: 'The keeper\'s workshop, at the left end of the row.',
  },
  {
    kind: 'factoryHall',
    near: 's≈50 d≈19, right of the transformer house',
    purpose: 'The valve house, where the pipe from the stream comes down to the turbines.',
  },
  {
    kind: 'factoryHall',
    near: 's≈50 d≈31, at the right end of the row',
    purpose:
      'The station\'s store, its sixth building. With it the row spans the head of the glen, so no way down from ' +
      'the ice gets round it.',
  },
  ...EXTRA.map(({ kind, near, purpose }): OverlayRequest => ({ kind, near, purpose })),
];

export const CH8: ChapterDef = {
  id: 'ch8-remains',
  index: 8,
  levelId: 'highland-maze',
  act: 3,
  actTitle: 'The Reckoning',
  title: 'What Remains',
  intro: {
    lines: [
      'The Clachan is crowded now: cottages on every road, flats by the loch, two farms, two churches and its own power station.',
      'The archivist\'s mother was born here, at Achadh, in the farmhouse with the green door.',
    ],
    document: {
      id: 'ch8-callum-letter',
      kind: 'letter',
      title: 'Callum Reid\'s letter to whoever reads the archive',
      date: 'October 2039',
      author: 'callum-reid',
      characters: ['callum-reid', 'mara-vey'],
      body:
        'To whoever reads this archive: you will not know the woman who kept it, so let me introduce her. Her name ' +
        'is Mara Vey. Her hair has been silver since she was nineteen, her eyes are pale grey, and she wears long ' +
        'dark dresses, so people expect a tragic heroine holding a single rose. Then she opens her mouth and asks ' +
        'where you keep your minutes. She kept everything in this archive. She will be annoyed that I wrote ' +
        'about her and not about the Clachan\'s power station, so here it is: the station has given this glen ' +
        'its light for eighty-one years. Put that first. Callum Reid, the Clachan\'s postman',
    },
  },
  caption: 'The Clachan power station, below the glacier. Every light in the glen starts here.',
  landmarks: [
    {
      id: 'clachan-station',
      name: 'The Clachan power station',
      category: 'industry',
      // The turbine house (overlay 7), the switch house (8), the transformer house (9), the keeper's
      // workshop (10), the valve house (11) and the store (12) are one station.
      bind: { source: 'overlay', index: 7, also: [8, 9, 10, 11, 12] },
      bibleRefs: ['the-clachan', 't1958-clachan-station', 'd2032-clachan-line', 'callum-reid'],
      label: 'Clachan power station · lights the whole glen',
    },
    {
      id: 'bothy',
      name: 'The shepherd\'s hut above the Leap',
      category: 'home',
      bind: { source: 'base', index: 32 },
      bibleRefs: ['mara-vey', 'callum-reid', 'the-clachan'],
      label: 'Shepherd\'s hut · leave it as you found it',
    },
    {
      id: 'achadh',
      name: 'Achadh farmhouse, the green door',
      category: 'home',
      bind: { source: 'base', index: 0 },
      bibleRefs: ['ruth-vey', 'mara-vey', 'the-clachan'],
      label: 'Achadh',
    },
    { id: 'achadh-barn', name: 'The Achadh barn', category: 'farm', bind: { source: 'base', index: 1 }, bibleRefs: ['the-clachan'] },
    {
      id: 'clachan-kirk',
      name: 'The Clachan church',
      category: 'community',
      bind: { source: 'base', index: 4 },
      bibleRefs: ['ruth-vey', 'the-clachan'],
      label: 'Clachan church · bell cracked 1911',
    },
    { id: 'balnacoil', name: 'Balnacoil farmhouse', category: 'home', bind: { source: 'base', index: 8 }, bibleRefs: ['callum-reid', 'the-clachan'] },
    { id: 'mill-house', name: 'The mill house above the falls', category: 'home', bind: { source: 'base', index: 14 }, bibleRefs: ['the-clachan'] },
    { id: 'loch-kirk', name: 'The lochside church', category: 'community', bind: { source: 'base', index: 28 }, bibleRefs: ['the-clachan'] },
    { id: 'lochside-flats', name: 'The lochside flats', category: 'home', bind: { source: 'overlay', index: 0 }, bibleRefs: ['the-clachan'] },
    { id: 'glen-pipeline', name: 'The glen pipeline', category: 'extraction', bind: { source: 'overlay', index: 2 }, bibleRefs: ['the-clachan'] },
    { id: 'market-cross', name: 'The Clachan market cross', category: 'community', bind: { source: 'overlay', index: 4 }, bibleRefs: ['the-clachan'] },
  ],
  /*
   * OVERPOPULATED (playtest 2, third pass, 2026-10-24; the lead's chase-camera review: "the glen is still
   * mostly open grass with a few small sheds and silos far ahead"): DENSE, 161 buildings at working size
   * beside the lanes from s 470 to 1700 (cottages and byres along five new crofting tracks, GLEN_TRACKS,
   * and away from the roads housing-scheme flats, factory halls and feed silos), and one more crofts' row
   * across the lanes below the Druim (s 1262). 325 built placements (the base level 35; 158 before this
   * pass). Nothing new stands on a measured way down, so the runs barely change; built things broken, ice:
   *   lanes −12 / −11 / −10   complete, ice 0.073 / 0.011 / 0.029:  6 / 7 / 6 (unchanged)
   *   lanes −9 / −8 / −4      complete, ice 0.064 / 0.068 / 0.250:  9 / 10 / 11 (the s 1262 row)
   *   the line (lane 0)       complete 84.4 s, ice 0.266: 17
   *   lanes +4 / +8 / +12 / +16  complete, ice 0.243 / 0.172 / 0.119 / 0.164: 17 / 16 / 17 / 12
   *   the middle              complete 102.3 s, ice 0.170: 13      the Clachan  complete 103.1 s, ice 0.083: 9
   *   held right 0.8 s / left 1.6 s: complete, 16 each
   *   the swerve to −24 m now sticks against a block of flats at s 628 (it stuck at s 1298 before; it
   *   never reached the sea); +24, +40, +60 and the two short early steers end where they ended before
   * Frame time (Intel Iris Xe, headless Chrome, 1280×720, High, render-only ms per frame at the line's
   * s 60 / 700 / 850 / 1140 / 1300): 25.3 / 20.9 / 20.4 / 22.5 / 21.6 (before this pass 25.3 / 21.5 / – /
   * 19.3 / –; Arcade Level 8 19.7 / 23.7): the kit's parts are instanced, so no new draw calls of their own.
   *
   * CROWDED ALL THE WAY DOWN (playtest 2, second pass, 2026-10-24): the earlier fixer's GLEN (crofts, sheds,
   * woodpiles and the glen pipeline's tank batteries 21-60 m beside every open stretch) and ROWS across the
   * line's lanes (a row of cottages by the end of the stalkers' track at s 706; crofts' yards at s 860, 970,
   * 1135 and 1420). 158 built placements (the base level 35; before this round 90). The Leap's run-up (s
   * 250-470) stays clear: every lane needs all its speed there. Measured (story level, real water and
   * chipping, headless autopilot; 380 bodies, base 241), built things broken:
   *   lanes −12 / −11 / −10   complete, ice 0.073 / 0.011 / 0.029:  6 / 7 / 6 (they pass the rows' left
   *                           ends; unchanged, and as thin on ice as they were)
   *   lanes −9 / −8 / −4      complete, ice 0.069 / 0.071 / 0.250:  8 / 9 / 11
   *   the line (lane 0)       complete 84.0 s, ice 0.270: 16
   *   lanes +4 / +8 / +12 / +16  complete, ice 0.242 / 0.174 / 0.117 / 0.163: 17 / 15 / 16 / 11
   *   the middle              complete 101.8 s, ice 0.171: 12      the Clachan  complete 103.2 s, ice 0.083: 9
   *   held right 0.8 s / left 1.6 s: complete, 16 / 17; tapped right 0.7 s, held right 1.5 s and the swerves
   *                           to −24, +24, +40, +60 end where they ended before
   *
   * OVERLAY, PLAYTEST 2 (2026-10-24): the crowded glen (EXTRA, overlay 13-54, and the two station roads,
   * the overlay's features). Below the station: cottages along two gravel roads down the braes (s 75-130,
   * d ±65: houses must stand within 60 m of a road), one on the line (s 100 d −20) and one on the way to
   * the right glen (s 100 d 33); the distillery in the right glen (a hall and a tank on the middle and
   * Clachan routes, its warehouse and chimney beside them); cottages along the stalkers' track, a cowshed
   * and parked cars in the lower left glen; two more cottages on the glen road above Achadh; a woodpile
   * and the glen pipeline's pumping tanks in the lower left glen; the Clachan's power line across the
   * middle glen; Calder's metering station on the lower braes; two sheds and a smokehouse on the lochside;
   * cars driving the glen road and the lochside street. The left glen above the Leap stays as it was:
   * every lane that takes the Leap needs its speed there (lanes +8 … +16 take off at 18.9-19.4 m/s, 18.5
   * clears it). Costs are kept near nothing: this 60 t iceberg's hit costs 0.006 × (breakImpulse / 60 −
   * 2.5 × ice) of a full iceberg, so cottages of 0.38-0.43 and tanks of 0.28 chip no ice where they stand
   * (lanes −12 … −9 arrive at the sea with 0.01-0.08 ice, as before). The station roads first ran at d ±45
   * from s 62: lanes −8 … −12 rode the west one, and lane −8.5 then fell at the Leap; at d ±65 from s 75
   * no lane touches them. Measured (story level, real water and chipping, headless; 312 bodies, base 241):
   *   line          complete 81.5 s, ice 0.280: 11 built (turbine house, cottage, hut, fence, cottage,
   *                 two pumping tanks, metering tank and hut, pipeline, shed)
   *   lane +8       complete 93.7 s, ice 0.221:  7 built      lane −8  complete 102.6 s, ice 0.082: 5
   *   lane −4       complete 83.8 s, ice 0.263:  5 built      lane +4  complete  84.7 s, ice 0.251: 11
   *   lane −12      complete 107.0 s, ice 0.073: 6 built      lane +12 complete 104.3 s, ice 0.156: 7
   *   lane −11 / −10 / −9   complete, ice 0.011 / 0.029 / 0.076: 7 / 6 / 5 built (−11.5 / −10.5 / −9.5 /
   *                 −8.5: 0.011 / 0.013 / 0.060 / 0.081, 5-7 built)      lane +16 complete, 0.186: 6
   *   the middle    complete 100.6 s, ice 0.169: 10 built (transformer house, cottage, distillery hall and
   *                 tank, two pylons, metering tank and hut, pipeline, shed)
   *   the Clachan   complete 103.4 s, ice 0.083:  9 built (transformer house, cottage, distillery hall and
   *                 tank, two cottages above Achadh, Achadh, its barn, Balnacoil)
   *   held right 0.8 s / left 1.6 s: complete, 11 built; tapped right 0.7 s and held right 1.5 s stop at
   *                 s 58.6 and 47.4 with the station broken, as before the crowding
   *   lanes −40 … −16 and +20 … +60: fail exactly where they failed before (stuck at s 39-48 or 100-391,
   *                 fallen at the Leap, s 494; lane −24 stuck at s 1298)
   * Every run that reaches the sea breaks the station and at least four more built things. With three or
   * more Clachan homes, farm buildings and shared places gone, the line, lanes −12 … +4 and the Clachan
   * route now read "a great deal of the Clachan went" (CLACHAN_LOST); the middle and lanes +8 … +16 (the
   * station, tanks and sheds) read the dark glen.
   *
   * FIRST OVERLAY (Act III). THE POWER STATION (7-12): six small halls (scale 0.3: 7.2 m wide,
   * 5.4 m deep, roofs 3.1 m) in a row across the head of the glen at s 50, the closest the start
   * clearance allows (front walls at s 47.3, 17 m below the spawn), doors up the slope, 4.5 m apart: the
   * keeper's workshop (d −31 … −23.8), the switch house (−19.3 … −12.1), the turbine house (−7.6 … −0.4),
   * the transformer house (4.1 … 11.3), the valve house (15.8 … 23) and the store (27.5 … 34.7). Every gap
   * is narrower than the iceberg (5.7 m), so nothing passes between, and with its radius the row covers
   * d −34 … +37: here every way down is still bunched (lanes −27 … +60 of the line and the middle and
   * Clachan routes cross s 50 within d −28 … +32). A hall breaks from 1.35 m/s for the 60 t iceberg
   * (breakImpulse 101 t·m/s), less with a scrape, and costs it almost nothing. Small on purpose: with
   * four 0.45 halls (break speed 3.1 m/s) a player who steered at the start (held right 0.8 s, left
   * 1.6 s) met a hall at 1.4-2.8 m/s, came to rest against it and failed 'stuck' with the station
   * standing (review of 2026-10-24: 50 of 178 headless steering plans). Moved down the glen instead
   * (s 64-66) the row let the hardest swerves past it (lane −24 or −26 to s 100, then the line; lanes
   * +34, +50 and +60, then the Clachan route) to the sea with the station standing; five halls of 0.32 or
   * 0.35 at s 50 still left 5 and 18 of 178 plans at rest against a hall.
   * The glen pipeline runs across the lower braes at s 1550 from d −56 to +20, where the line and the
   * middle have rejoined, so both, and the lanes from −6 to +16 beside the line, cross it; its right end
   * stops 28 m short of the Clachan route, which pays in its own farms. Lanes −7 … −12 pass its left end:
   * −8 … −12 reach it with the least ice of any lane (0.09-0.16, after felling eight to eleven trees), and
   * across the whole floor (to d −189) it stopped lanes −10.5 … −11.5 with 0.07 ice left (and lane −10 too,
   * after the old station's chip), station or not; scaled down to 0.5 lane −11 broke it and melted 18 m
   * short of the sea, and −10.5 arrived with 0.002. Scaled 0.6: at full size it stopped both ±8 lanes. The lochside flats stand on the flat ground
   * behind the lochside church (one block across, one along the slope): the requested d≈40 is the Clachan
   * route's last approach and s≈1605 lies in the loch falls' exclusion zone. The market cross (s 828 d 84)
   * and the crossroads cottage (s 808 d 135) were moved off the cross street's paved strip. The compressor
   * tank and the ferry cottage stand where asked.
   * Measured (story level, real water and chipping, headless, 2026-10-24; overlays.act3.test.ts plays the
   * lines, lanes −12 … +16 (1 m steps from −12 to −8), the swerves −24, +24, +40 and +60 and four steers
   * at the start):
   *   line          complete  79.3 s, ice 0.301: the turbine house, the hut, a fence, the pipeline
   *   lane −12      complete 105.3 s, ice 0.085: the switch house, a fence, 8 trees
   *   lane −11      complete 102.5 s, ice 0.015: two halls, a fence, 11 trees (−10.5 the same)
   *   lane −10      complete 102.0 s, ice 0.028: two halls, a fence, 10 trees
   *   lane −8       complete 102.3 s, ice 0.084: two halls, a fence, 8 trees
   *   lane −4       complete  83.4 s, ice 0.274: the turbine house, the hut, a fence, the pipeline
   *   lane +4       complete  83.0 s, ice 0.265: the turbine house, the hut, a fence, the pipeline
   *   lane +8       complete  97.9 s, ice 0.229: two halls, the pipeline
   *   lane +12      complete 102.1 s, ice 0.154: the transformer house, the pipeline, 4 trees
   *   lane +16      complete 100.4 s, ice 0.192: the transformer house, a log pile, the pipeline, 2 trees
   *   the middle    complete  97.1 s, ice 0.193: the transformer house, the pipeline
   *   the Clachan   complete 101.3 s, ice 0.090: the transformer house, Achadh, its barn, Balnacoil
   *   Every lane from −12 to +16 m completes (1 m steps, and −11.5, −10.5, −9.5, −8.5). Lanes −13 … −21
   *   fall into the Leap (s 494), but −18, which melts 21 m short of the sea; −22 … −27 and +17 … +60 break
   *   one or two halls and fail further down, as they did before the station (stuck or fallen); lanes
   *   −28 … −34 stop on the slope by s 48 even with no station there.
   *   The sweep (221 plans: lanes −30 … +30 every metre, +34 … +60, steering held left or right for 0.2-4 s
   *   or tapped and let go for up to 5 s, half steering, aims across the slope, swerves to lane ±22 … ±60
   *   until s 100 and then the line, the middle or the Clachan route): 106 reach the sea, every one with the
   *   station broken. Of the 46 that stop before s 100, 16 never reach the row (lanes −30 and beyond and
   *   aims across the slope stop at s 39-44) and 29 break a hall first, all but one stopping where they
   *   stop with no station (held right 1.2-2 s at s 47-48, tapped right 0.8-1 s at s 54-59, half right
   *   for 2 s or more at s 52-55, lane −28 at s 47.6, a tap let go for 5 s in the gully at d +20 at
   *   s 92-94). The one: tapped right 0.7 s and let go until 3.5 s, the iceberg breaks the transformer
   *   house at 4.6 m/s and stops at s 58.5 (with no station it gets going again from 2.6 m/s at s 60).
   *   One plan touches a standing hall: lane −29 stops on the slope at s 45.8 with no station, and here
   *   comes to rest against the switch house's corner at 0.7 m/s (s 45.0); moving the switch house 1 m
   *   right cleared it but sent lane −12 into the Leap. The slowest contact that broke a hall: 1.22 m/s.
   * Every route breaks the power station and something else built; the hut, Achadh and the pipeline
   * each fall on some routes and stand on others; the flats, the market cross and the churches stand
   * on all of them (steer to break).
   */
  overlay: {
    obstacles: [
      { kind: 'apartmentBlock', s: 1613, d: 128, yaw: 0 }, // 0 the lochside flats
      { kind: 'apartmentBlock', s: 1628, d: 160 }, // 1 the second block
      { kind: 'pipeline', s: 1550, d: -18, span: 76, scale: 0.6 }, // 2 the glen pipeline
      { kind: 'tank', s: 1100, d: 132 }, // 3 the compressor station tank
      { kind: 'monument', s: 828, d: 84 }, // 4 the Clachan market cross
      { kind: 'house', s: 808, d: 135 }, // 5 a cottage on the cottages' lane
      { kind: 'house', s: 1300, d: 110 }, // 6 the ferry cottage on the glen road
      { kind: 'factoryHall', s: 50, d: -4, scale: 0.3, yaw: Math.PI }, // 7 the power station's turbine house
      { kind: 'factoryHall', s: 50, d: -15.7, scale: 0.3, yaw: Math.PI }, // 8 the switch house
      { kind: 'factoryHall', s: 50, d: 7.7, scale: 0.3, yaw: Math.PI }, // 9 the transformer house
      { kind: 'factoryHall', s: 50, d: -27.4, scale: 0.3, yaw: Math.PI }, // 10 the keeper's workshop
      { kind: 'factoryHall', s: 50, d: 19.4, scale: 0.3, yaw: Math.PI }, // 11 the valve house
      { kind: 'factoryHall', s: 50, d: 31.1, scale: 0.3, yaw: Math.PI }, // 12 the store
      // 13- the crowded glen (EXTRA, in its order)
      ...EXTRA.map(({ kind, s, d, scale, yaw, parked }) => ({
        kind,
        s,
        d,
        ...(scale !== undefined ? { scale } : {}),
        ...(yaw !== undefined ? { yaw } : {}),
        ...(parked ? { parked } : {}),
      })),
    ],
    features: [...STATION_ROADS, ...GLEN_TRACKS],
  },
  fragments: [
    F({
      // What the station meant, on every run (the open day on Saturday 6 August, six days before the thaw).
      id: 'ch8-station-notice',
      kind: 'notice',
      title: 'Power station open day',
      date: 'July 2039',
      author: 'Clachan community council',
      when: { always: true },
      priority: 10,
      body:
        'The Clachan power station is eighty-one years old this summer. Everyone is invited to the open day on ' +
        'Saturday 6 August, from ten until four. Isla Munro, the station keeper, will show you round all six ' +
        'buildings: the turbine house, the switch house, the transformer house, the valve house, the store and her ' +
        'workshop. There will be tea and cake in the switch house. A reminder of what the station does for the glen: it ' +
        'lights every house, heats the school, runs the pumps that bring our water up from the stream, and keeps ' +
        'the vaccines cold in the clinic refrigerator. It runs on the stream that comes down from the glacier. The ' +
        'national grid never reached this far up the glen, so in 1958 the Clachan built its own. Please bring a chair.',
    }),
    F({
      // The morning it was shut down: the lights go out, and nobody is in the building.
      id: 'ch8-station-log',
      kind: 'record',
      title: 'Power station, keeper\'s log',
      date: '12 August 2039',
      characters: ['callum-reid'],
      when: STATION_GONE,
      priority: 9,
      body:
        '05:40. The stream from the glacier is brown and rising fast. I telephoned Callum Reid so that he could ' +
        'start driving the oldest people down to Carran in the post van. 05:55. I shut down both turbines. From ' +
        'this minute the Clachan has no electricity: no lights, no heating, no water pumps and no refrigerator at ' +
        'the clinic. 06:02. I checked every room, and nobody is in the station. I locked the doors and took this ' +
        'logbook with me. 06:20. From the road I can see water at the station doors. I have kept this station ' +
        'running for twenty-two years, and this is the first time I have had to write that the whole glen is ' +
        'dark. Isla Munro, station keeper',
    }),
    F({
      // What happened next: the cold, and the school moved to Carran (above Ruth's letter and the chapter 4
      // memories, so the line shows it).
      id: 'ch8-school-letter',
      kind: 'letter',
      title: 'Letter to parents, Clachan Primary School',
      date: '29 August 2039',
      when: STATION_GONE,
      priority: 7,
      body:
        'Dear parents, the Clachan school will not open this term. Without the power station we have no lights, ' +
        'no heating and no running water in the building, and the engineers say the station cannot be rebuilt ' +
        'where it stood. From Monday 5 September our fourteen pupils will be taught together in a spare ' +
        'classroom at Carran Primary School, so that they can stay with their friends. I know most of you are already living ' +
        'in Carran, in borrowed rooms. Please send your child with indoor shoes and a warm coat, because the spare ' +
        'classroom is cold as well. We will move back to the Clachan as soon as the glen has power again. Morag ' +
        'Dunn, head teacher',
    }),
    F({
      id: 'ch8-larder-door',
      kind: 'memory',
      title: 'Achadh',
      author: 'mara-vey',
      when: { landmark: 'achadh', status: ['destroyed', 'damaged'] },
      priority: 8,
      body:
        'Achadh had a green door that stuck and a kitchen that smelled of peat smoke and wet dog. Every summer from ' +
        '2008 to 2021, my grandmother measured my height on the pantry door frame, in pencil, with the date. There ' +
        'were fourteen lines. I meant to photograph them every summer, and I never did. The house was empty when it ' +
        'went; my grandmother had been living in Carran for years by then, complaining about the tea.',
    }),
    F({
      id: 'ch8-achadh-letter',
      kind: 'letter',
      title: 'Letter from Ruth Vey to her daughter Mara',
      date: 'September 2039',
      author: 'ruth-vey',
      characters: ['ruth-vey', 'callum-reid', 'mara-vey'],
      when: { landmark: 'achadh', status: 'intact' },
      priority: 6,
      body:
        'Mara, Callum went up to Achadh yesterday. The house is still standing, the door is still green, and it ' +
        'still sticks. There is no power anywhere in the glen now, so he read the pencil lines on the pantry door ' +
        'frame by the light of his phone. He says they are all there, 2008 to 2021, and that you were a short ' +
        'child for a very long time and then suddenly not. The kitchen was cold enough to see his breath, in ' +
        'September. He has taken a photograph, and I have told him you will want three copies. Mum',
    }),
    F({
      id: 'ch8-bothy-peaches',
      kind: 'memory',
      title: 'The shepherd\'s hut',
      author: 'mara-vey',
      characters: ['callum-reid'],
      when: { landmark: 'bothy', status: ['destroyed', 'damaged'] },
      priority: 4,
      body:
        'The shepherd\'s hut above the Leap had four stone walls, a tin roof and a visitors\' book. When Callum ' +
        'and I were sixteen, a storm kept us there for two nights with a tin of peaches and no tin opener. He ' +
        'opened it with a fence staple. It took an hour, and it was the most romantic thing anyone has ever done ' +
        'near me, though I did not tell him so for about fifteen years. The visitors\' book is in the archive; ' +
        'our names are on page 61.',
    }),
    F({
      id: 'ch8-cracked-bell',
      kind: 'memory',
      title: 'The church bell',
      author: 'mara-vey',
      when: { landmark: 'clachan-kirk', status: ['destroyed', 'damaged'] },
      priority: 4,
      body:
        'The bell of the Clachan church cracked in 1911 and was never replaced, so it rang a note slightly wrong, ' +
        'like someone humming a hymn they only half know. On the morning of 12 August the power was already off, ' +
        'and the valley siren did not reach the glen, so Callum\'s aunt rang the bell for twenty minutes. ' +
        'Everyone heard it. Everyone knew that wrong note, and everyone came down to the road.',
    }),
    F({
      id: 'ch8-after-church-lane',
      kind: 'memory',
      title: 'After Church Lane',
      author: 'mara-vey',
      characters: ['callum-reid'],
      when: { history: { landmark: 'vey-house', status: 'destroyed' } },
      priority: 5,
      body:
        'When our house at No. 14 Church Lane went, I was asleep on four boxes at the back of my brother Elias\'s ' +
        'train. Callum was waiting on the platform at Carran when the last train came in, at twenty to midnight. ' +
        'Elias would not wake me, so Callum did. He carried the boxes to the post van and drove me to my ' +
        'grandmother\'s house. He did not say a word the whole way, because he knew I could not talk yet. He has ' +
        'said a great many kind things to me over the years, but that quiet drive is the one I remember best.',
    }),
    F({
      id: 'ch8-finish-the-month',
      kind: 'memory',
      title: 'August, unfinished',
      author: 'mara-vey',
      characters: ['ruth-vey', 'callum-reid'],
      when: { history: { landmark: 'vey-house', status: 'intact' } },
      priority: 5,
      body:
        'My mother wants to go back to Church Lane. They tell her the house is still standing, with my chalk mark ' +
        'still on the door to tell the wardens it was empty, and the calendar on the kitchen wall still open at ' +
        'August. She wants to go home and finish that month in her own kitchen. I have said I will take her, and ' +
        'Callum says he will drive us there in the post van.',
    }),
    F({
      // The crowded glen (playtest 2) and what so many people put into one stream. Below the chapter 4
      // memories in authored order, so at the same priority the memory keeps its place (one of the two
      // always holds); the notice fills a slot the station's documents leave free.
      id: 'ch8-stream-notice',
      kind: 'notice',
      title: 'Please keep the stream clean',
      date: 'June 2037',
      author: 'Clachan community council',
      when: { always: true },
      priority: 5,
      body:
        'The Clachan has grown more in the last ten years than in the hundred before: the flats by the loch, the ' +
        'new cottages on the roads below the power station and along the track in the lower glen, and the families ' +
        'who moved up here when the towns below them flooded. We are glad of every one of you. But everything in ' +
        'this glen runs downhill into the stream. This spring the council pulled two fridges, a mattress and ' +
        'fourteen bags of rubbish out of it, and after rain it runs grey below the new houses, the distillery and ' +
        'Calder\'s metering station. The bins are emptied on Tuesdays. The stream is not a bin.',
    }),
    F({
      // Mara tried, on the record, and it was late. Always eligible but last: with four slots it shows only
      // on a run where little else holds (the header).
      id: 'ch8-tried',
      kind: 'memory',
      title: 'Once, plainly',
      author: 'mara-vey',
      characters: ['tomas-lind', 'anna-sorel'],
      when: { always: true },
      priority: 3,
      body:
        'I tried. I want that in the record once, plainly, and then I will stop saying it. I read Tomas Lind\'s ' +
        'measurements aloud at council meetings for six years and posted Anna Sorel\'s reports to anyone with an ' +
        'address. In the Water Board minutes I am only "a member of the public", because I asked not to be named. ' +
        'It was not enough, and it was late, and the water did not ask who had tried.',
    }),
    F({
      id: 'ch8-two-columns',
      kind: 'record',
      title: 'Clachan community council, minutes',
      date: 'October 2039',
      author: 'Clachan community council',
      // Above the school letter: ch8-reflection-much-lost ends on these minutes.
      when: CLACHAN_LOST,
      priority: 8,
      body:
        'The meeting was held in a borrowed church hall in Carran, and thirty-one people came. The only item was ' +
        'what remains of the Clachan. The chair asked for a list, and the list was long. It ran to four pages, ' +
        'because the glen had filled up in its last ten years, with cottages on every road and flats for families ' +
        'the water had already moved once. Someone asked for the stream to go on the list as well: for years it had ' +
        'run grey after rain with whatever the glen threw away, and since the flood it has run brown. The secretary ' +
        'asked whether she should write down what was gone or what was left. The meeting agreed to write both, in ' +
        'two columns, and to read the second column out loud.',
    }),
  ],
  fallbackReflections: [
    F({
      id: 'ch8-reflection-much-lost',
      kind: 'reflection',
      title: 'The Clachan',
      author: 'mara-vey',
      when: { all: [CLACHAN_LOST, STATION_GONE] },
      priority: 6,
      body:
        'I am Mara Vey, by the way. It seems late to say so, and Callum is right that I would rather talk about ' +
        'the station. You came through the Clachan and a great deal of it went: the power station below the ' +
        'glacier first, then homes and other buildings further down the glen. By the end the glen was crowded, with cottages ' +
        'on every road and flats by the loch, and the stream that turned the station\'s turbines ran brown. None ' +
        'of it surprises me, because I have read every report ever written about this glen. What I had not expected was how much of it I would want to list, one ' +
        'thing at a time, in pencil, as if the order mattered. What remains is mostly people, as it turns out. They ' +
        'are in Carran, in borrowed rooms, already arguing about the minutes.',
    }),
    F({
      id: 'ch8-reflection-dark',
      kind: 'reflection',
      title: 'The Clachan',
      author: 'mara-vey',
      when: STATION_GONE,
      priority: 5,
      body:
        'The Clachan is where my mother was born, so I should give you my name here: I am Mara Vey, and this is my ' +
        'archive. You broke the power station at the head of the glen. Anything coming down from the ice would ' +
        'have broken it, because it stood right where the water came down. Calder Energy had turned down the ' +
        'glen\'s request for a second power line in 2032, so losing it left the whole glen without power, and by ' +
        'then the glen was full: cottages on every road, flats by the loch, and below them a stream that ran ' +
        'brown. Within a month the school, the clinic and most of the families were in Carran, in borrowed ' +
        'rooms. By December only nine households were left in the glen, cooking and keeping warm on wood ' +
        'stoves. They say they are staying, and I believe them.',
    }),
    F({
      id: 'ch8-reflection',
      kind: 'reflection',
      title: 'The Clachan',
      author: 'mara-vey',
      when: { always: true },
      priority: 0,
      body:
        'My name is Mara Vey. I kept this archive: the notebooks, the minutes, the letters and the photographs. ' +
        'I am telling you now because this is where my mother was born and where I spent my summers, and it seems ' +
        'rude to stay anonymous in my grandmother\'s kitchen. In 1958 nobody would bring electricity this far up the glen, so ' +
        'the Clachan built a power station of its own to run the lights, the heating and the water pumps. That is ' +
        'the kind of place this is. When I was a child, the stream below the station ran clear enough to drink ' +
        'from. By the end it ran brown, and the sky over the glen was grey on most days. Whatever remains of the ' +
        'Clachan, it will be mostly its people.',
    }),
  ],
  aiReflection: false,
  music: 'remains',
};
