import type { TerrainFeature } from '../../core/types';
import type { ChapterDef } from '../types';
import { fragmentsOf, type OverlayRequest } from './authoring';

/**
 * CHAPTER 9 — "The Last Thaw" (Act III, The Reckoning). Level 9, Summit Labyrinth: the Upper Vell,
 * where the ice began. The 2029 dam on the summit stream (a real, partial fix, sized for the lake of
 * 2029), the lift village above the fjord, and the final sequence to the sea, where the story asks for
 * Calder's rig standing offshore. Reflective, not triumphant; nobody went extinct; a fictional
 * tragedy in one climate-affected region, with some things saved because someone acted early. The
 * personalised epilogue follows (AI, or EPILOGUE_PARTS in src/story/epilogueText.ts).
 *
 * THE WORDS (playtest 2). The overlay's ruined houses are the village's lower terrace, given up to the
 * summit stream's floods (2031, 2034, 2036) years before the thaw: the Water Board's notice says why
 * (always shown), Mara's memory says what the run came through (the abandoned houses broke, which every
 * run through the village does), and the dam reflections and the closing one say it once each. The
 * pollution the second playtest asked for is in them as Act III's world shows it (src/story/environment.ts):
 * flood mud with sewage, fuel and rubbish in it, litter in the fences, brown water, grey snow and sky.
 * On the line the four documents shown are the dam, the lower terrace, Tomas Lind's letter and the
 * notice. ("Heavy" and the fjord photograph made room for them; the epilogue keeps the ice in the fjord.)
 *
 * Base placements used (src/core/levels/summitLabyrinth.ts): 7 dam x1.1 s 832 d -90, 16 skiLiftPylon
 * s 1320 d -10, 22 chalet s 1440 d -60, 25 chalet s 1530 d -25, 29 church x0.85 s 1620 d -70, 27 barn
 * s 1480 d 140, 30 chalet s 1600 d -112.
 */

const F = fragmentsOf('ch9-last-thaw');

/** One abandoned building of the old village (overlay placements from RUINS_FROM on, all 'ruined'). */
interface Ruin {
  readonly kind: 'house' | 'chalet' | 'barn';
  readonly s: number;
  readonly d: number;
  readonly scale?: number;
  readonly yaw?: number;
  readonly near: string;
}

/** Overlay index of the first ruin (the nine placements above come first). */
export const RUINS_FROM = 9;

/**
 * THE ABANDONED VILLAGE: the houses, chalets and barns the Upper Vell's floods have been through again
 * and again, left half-fallen where they stand among the streets (src/core/obstacles/structures/ruin.ts:
 * roofs and walls gone, a dark flood line, broken and boarded windows, rubble). They crowd every
 * part of the terrace, so every way through the village breaks some (measured in the OVERLAY comment).
 */
const RUINS: readonly Ruin[] = [
  // On the line (d −62 … −68.5) and the lanes beside it. Round 2 bug fix: lanes +3 and +3.5 stuck at
  // 87 % (Arcade finishes them). The first four slowed them to 16-20 m/s, too slow to break the chapel
  // (Arcade arrives at 24); they stand on the line's left half now. The house at the depot stopped
  // lane +3 dead: it stands 12 m left of the line.
  { kind: 'house', s: 1365, d: -66, near: 's≈1365 d≈−66, above the cross road, on the line\'s left half' },
  { kind: 'house', s: 1464, d: -66, near: 's≈1464 d≈−66, below the first chalet, on the line\'s left half' },
  { kind: 'barn', s: 1505, d: -68, near: 's≈1505 d≈−68, beside the west street, on the line\'s left half' },
  { kind: 'house', s: 1545, d: -66, near: 's≈1545 d≈−66, on the line\'s left half' },
  { kind: 'chalet', s: 1585, d: -47, near: 's≈1585 d≈−47, above the chapel, beside the line' },
  { kind: 'house', s: 1648, d: -62, near: 's≈1648 d≈−62, below the chapel, on the line' },
  { kind: 'house', s: 1674, d: -68.5, near: 's≈1674 d≈−68.5, above the depot, 12 m left of the line' },
  // On the right-hand route (d 8 … 46), smaller cottages.
  { kind: 'house', s: 1370, d: 46, scale: 0.8, near: 's≈1370 d≈46, below the second wellhead, on the right route' },
  { kind: 'house', s: 1450, d: 44, scale: 0.8, near: 's≈1450 d≈44, on the right route' },
  { kind: 'house', s: 1527, d: 36, scale: 0.8, near: 's≈1527 d≈36, on the right route' },
  { kind: 'house', s: 1590, d: 29, scale: 0.8, near: 's≈1590 d≈29, beside the main street, on the right route' },
  { kind: 'house', s: 1628, d: 26, scale: 0.8, near: 's≈1628 d≈26, at the foot of the main street' },
  { kind: 'house', s: 1695, d: 8, scale: 0.8, near: 's≈1695 d≈8, above the fjord falls, on the right route' },
  // West of the west street (d −100 … −112).
  { kind: 'chalet', s: 1440, d: -112, near: 's≈1440 d≈−112, west of the west street' },
  { kind: 'house', s: 1500, d: -104, near: 's≈1500 d≈−104, west of the west street' },
  { kind: 'house', s: 1532, d: -102, near: 's≈1532 d≈−102, west of the west street' },
  { kind: 'barn', s: 1652, d: -110, near: 's≈1652 d≈−110, behind the chapel' },
  { kind: 'house', s: 1690, d: -100, near: 's≈1690 d≈−100, by the stream' },
  // Between the line and the main street (d −25 … −30).
  { kind: 'house', s: 1365, d: -30, near: 's≈1365 d≈−30, beside the lift' },
  { kind: 'chalet', s: 1482, d: -30, near: 's≈1482 d≈−30, below the apartments' },
  { kind: 'house', s: 1600, d: -30, near: 's≈1600 d≈−30, between the streets' },
  { kind: 'house', s: 1665, d: -25, near: 's≈1665 d≈−25, above the depot' },
  // East of the right route (d 80 … 115).
  { kind: 'chalet', s: 1370, d: 92, near: 's≈1370 d≈92, above the cross road' },
  { kind: 'house', s: 1440, d: 82, near: 's≈1440 d≈82, east of the main street' },
  { kind: 'barn', s: 1530, d: 104, near: 's≈1530 d≈104, below the farm track' },
  { kind: 'house', s: 1612, d: 74, near: 's≈1612 d≈74, east of the main street' },
  { kind: 'chalet', s: 1645, d: 70, near: 's≈1645 d≈70, at the foot of the main street' },
  { kind: 'house', s: 1690, d: 50, near: 's≈1690 d≈50, above the fjord falls' },
  { kind: 'house', s: 1350, d: 115, near: 's≈1350 d≈115, above the cross road' },
  // Filling the gaps: the old village stood shoulder to shoulder.
  { kind: 'house', s: 1360, d: 15, near: 's≈1360 d≈15, above the main street' },
  { kind: 'house', s: 1352, d: 72, near: 's≈1352 d≈72, above the cross road' },
  { kind: 'house', s: 1455, d: 27, scale: 0.8, near: 's≈1455 d≈27, beside the main street' },
  { kind: 'house', s: 1460, d: 115, near: 's≈1460 d≈115, above the farm track' },
  { kind: 'house', s: 1560, d: -5, near: 's≈1560 d≈−5, between the streets' },
  { kind: 'house', s: 1585, d: 75, near: 's≈1585 d≈75, east of the main street' },
  { kind: 'house', s: 1632, d: -38, near: 's≈1632 d≈−38, beside the chapel' },
  { kind: 'house', s: 1655, d: 45, near: 's≈1655 d≈45, at the foot of the main street' },
  { kind: 'house', s: 1685, d: -78, near: 's≈1685 d≈−78, below the chapel' },
  // Playtest 2 review: riding 10-20 m off the line met only 1-3 ruins, and on the terrace the ruins
  // stood 20-40 m apart. Three columns of cottages close the gaps beside the line (10 and 17 m left of
  // it, 12 m right), and more fill the east of the terrace and beyond the west street.
  ...(
    [
      [1350, -70], [1388, -70], [1424, -70], [1478, -70], [1520, -70], [1660, -70],
      [1368, -77], [1442, -77], [1494, -77], [1536, -77], [1645, -80.5],
      [1346, -48], [1384, -48], [1420, -48], [1452, -46], [1490, -48], [1520, -48], [1552, -48], [1610, -57],
      [1668, -46],
      [1425, 60], [1425, 110], [1495, 75], [1515, 128], [1385, 15], [1390, 70], [1470, -128], [1560, -120], [1620, -130],
    ] as const
  ).map(
    ([s, d]): Ruin => ({ kind: 'house', s, d, scale: 0.8, near: `s≈${s} d≈${d}, a cottage of the lower terrace` }),
  ),
  // Up the valley: the summer huts and barns of the old farms along their tracks (UP_TRACKS), given up
  // with the village (s 505-1250, between the line and the right-hand route, where both see them).
  ...(
    [
      ['chalet', 515, 15], ['barn', 535, 62], ['house', 560, 18], ['house', 580, 64],
      ['house', 655, -66], ['barn', 675, -36], ['chalet', 700, -68], ['house', 722, -38], ['house', 740, -64],
      ['chalet', 925, -12], ['barn', 945, 30], ['house', 960, -15], ['house', 970, 35],
      ['house', 1165, -8], ['barn', 1185, 40], ['chalet', 1205, -12], ['house', 1225, 42],
    ] as const
  ).map(([kind, s, d]): Ruin => ({ kind, s, d, near: `s≈${s} d≈${d}, up the valley, beside an old farm track` })),
  // Playtest 2, second pass ("very overcrowded ... half destroyed and abandoned buildings"): the farms
  // given up along the line itself up the valley (the left plateau, below the dam's band, above the
  // village: 20-60 m either side of it, beside the new tracks), and the terrace packed 15-17 m apart
  // (three times as many ruins as before), each at least 9 m plus half its width off the line and off the
  // right-hand route and clear of every street, building and tree.
  ...(
    [
      ['house', 292, -172, 0.85], ['house', 292, -127, 0.8], ['chalet', 307, -164.5, 0.8],
      ['house', 307, -134.5, 0.9], ['barn', 322, -172, 0.7], ['house', 322, -127, 0.8],
      ['house', 322, -97, 0.85], ['house', 337, -164.5, 0.8], ['chalet', 337, -134.5, 0.8],
      ['house', 352, -172, 0.9], ['barn', 352, -97, 0.7], ['house', 367, -164.5, 0.8],
      ['house', 367, -134.5, 0.85], ['house', 367, -104.5, 0.8], ['chalet', 382, -172, 0.8],
      ['house', 382, -97, 0.9], ['barn', 397, -164.5, 0.7], ['house', 397, -134.5, 0.8],
      ['house', 397, -104.5, 0.85], ['house', 412, -172, 0.8], ['chalet', 412, -97, 0.8],
      ['house', 427, -164.5, 0.9], ['barn', 427, -104.5, 0.7], ['house', 1014, -136, 0.8],
      ['house', 1014, -106, 0.85], ['chalet', 1029, -98.5, 0.8],
      ['house', 1044, -136, 0.9], ['barn', 1044, -106, 0.7], ['house', 1044, -91, 0.8],
      ['house', 1059, -98.5, 0.8], ['chalet', 1074, -136, 0.8],
      ['house', 1074, -106, 0.9], ['barn', 1074, -91, 0.7],       ['house', 1089, -98.5, 0.85], ['chalet', 1148, -106, 0.8],
      ['house', 1148, -91, 0.9], ['barn', 1148, -31, 0.7],       ['house', 1163, -98.5, 0.85], ['house', 1163, -83.5, 0.8], ['chalet', 1163, -23.5, 0.8],
      ['barn', 1178, -106, 0.7], ['house', 1178, -91, 0.8],
      ['house', 1178, -31, 0.85], ['chalet', 1193, -98.5, 0.8],
      ['house', 1193, -83.5, 0.9], ['house', 1208, -106, 0.8],
      ['house', 1208, -91, 0.85], ['house', 1208, -76, 0.8], ['chalet', 1208, -31, 0.8],
      ['house', 1223, -128.5, 0.9], ['barn', 1223, -98.5, 0.7], ['house', 1223, -83.5, 0.8],
      ['house', 1223, -23.5, 0.85],
    ] as const
  ).map(([kind, s, d, scale]): Ruin => ({ kind, s, d, scale, near: `s≈${s} d≈${d}, up the valley, beside the line` })),
  ...(
    [
      ['chalet', 1274, -133, 0.8], ['house', 1274, -116, 0.9],
      ['barn', 1274, -82, 0.7], ['house', 1274, -48, 0.8], ['house', 1274, 3, 0.85],
      ['house', 1274, 20, 0.8], ['chalet', 1274, 37, 0.8], ['house', 1274, 71, 0.9],
      ['barn', 1274, 88, 0.7], ['house', 1274, 122, 0.8], ['house', 1274, 139, 0.85],
      ['chalet', 1291, -124.5, 0.8], ['house', 1291, -90.5, 0.9],
      ['barn', 1291, -73.5, 0.7], ['house', 1291, 79.5, 0.8], ['house', 1291, 113.5, 0.85],
      ['house', 1291, 130.5, 0.8], ['chalet', 1291, 147.5, 0.8],       ['barn', 1308, -133, 0.7], ['house', 1308, -116, 0.8], ['house', 1308, -82, 0.85],
      ['house', 1308, -48, 0.8], ['chalet', 1308, 71, 0.8], ['house', 1308, 88, 0.9],
      ['barn', 1308, 122, 0.7], ['house', 1308, 139, 0.8],       ['house', 1325, -124.5, 0.8], ['chalet', 1325, -90.5, 0.8], ['house', 1325, 79.5, 0.9],
      ['barn', 1325, 130.5, 0.7], ['house', 1325, 147.5, 0.8],       ['house', 1342, -133, 0.8], ['chalet', 1342, -116, 0.8], ['house', 1342, -82, 0.9],
      ['barn', 1342, 88, 0.7], ['house', 1342, 139, 0.8],       ['house', 1359, -124.5, 0.8], ['chalet', 1359, -90.5, 0.8], ['house', 1359, 28.5, 0.9],
      ['barn', 1359, 130.5, 0.7], ['house', 1359, 147.5, 0.8],       ['house', 1376, -133, 0.8], ['chalet', 1376, -116, 0.8], ['house', 1376, 3, 0.9],
      ['barn', 1376, 71, 0.7], ['house', 1376, 122, 0.8], ['house', 1376, 139, 0.85],
      ['chalet', 1393, -124.5, 0.8], ['house', 1393, -90.5, 0.9],
      ['house', 1410, -133, 0.8], ['house', 1410, -116, 0.85],
      ['chalet', 1427, -124.5, 0.8], ['house', 1427, 79.5, 0.9],
      ['barn', 1427, 96.5, 0.7], ['house', 1427, 130.5, 0.8], ['house', 1427, 147.5, 0.85],
      ['house', 1444, -133, 0.8], ['chalet', 1444, 3, 0.8], ['house', 1444, 105, 0.9],
      ['barn', 1444, 122, 0.7], ['house', 1444, 139, 0.8],       ['house', 1461, -73.5, 0.8], ['chalet', 1461, -22.5, 0.8], ['house', 1461, -5.5, 0.9],
      ['barn', 1461, 62.5, 0.7], ['house', 1461, 79.5, 0.8], ['house', 1461, 96.5, 0.85],
      ['house', 1461, 130.5, 0.8], ['chalet', 1461, 147.5, 0.8], ['house', 1478, -116, 0.9],
      ['house', 1495, -124.5, 0.8], ['house', 1495, -5.5, 0.85],
      ['house', 1495, 62.5, 0.8], ['chalet', 1495, 96.5, 0.8], ['house', 1495, 113.5, 0.9],
      ['barn', 1512, -133, 0.7], ['house', 1512, -99, 0.8], ['house', 1512, -31, 0.85],
      ['house', 1512, -14, 0.8], ['chalet', 1512, 3, 0.8], ['house', 1512, 54, 0.9],
      ['barn', 1512, 71, 0.7], ['house', 1512, 88, 0.8], ['house', 1512, 105, 0.85],
      ['house', 1512, 139, 0.8], ['house', 1529, -5.5, 0.9],
      ['barn', 1529, 62.5, 0.7], ['house', 1529, 79.5, 0.8], ['house', 1529, 130.5, 0.85],
      ['house', 1529, 147.5, 0.8], ['chalet', 1546, -133, 0.8], ['house', 1546, -31, 0.9],
      ['barn', 1546, -14, 0.7], ['house', 1546, 3, 0.8], ['house', 1546, 54, 0.85],
      ['house', 1546, 71, 0.8], ['house', 1563, -39.5, 0.9],
      ['barn', 1563, -22.5, 0.7], ['house', 1563, 45.5, 0.8], ['house', 1580, -133, 0.85],
      ['house', 1580, -31, 0.8], ['chalet', 1580, -14, 0.8], ['house', 1580, 3, 0.9],
      ['barn', 1580, 54, 0.7], ['house', 1597, -5.5, 0.85],
      ['house', 1597, 45.5, 0.8], ['chalet', 1597, 62.5, 0.8], ['house', 1614, -99, 0.9],
      ['barn', 1614, -14, 0.7], ['house', 1614, 3, 0.8], ['house', 1614, 37, 0.85],
      ['house', 1614, 54, 0.8], ['house', 1631, -124.5, 0.9],
      ['barn', 1631, -107.5, 0.7], ['house', 1631, -22.5, 0.8], ['house', 1631, -5.5, 0.85],
      ['house', 1631, 45.5, 0.8], ['chalet', 1648, -133, 0.8], ['house', 1648, -48, 0.9],
      ['barn', 1648, -31, 0.7], ['house', 1648, -14, 0.8], ['house', 1648, 3, 0.85],
      ['house', 1665, -90.5, 0.8], ['chalet', 1665, -5.5, 0.8], ['house', 1665, 28.5, 0.9],
      ['barn', 1665, 62.5, 0.7], ['house', 1682, -14, 0.8], ['house', 1682, 37, 0.85],
    ] as const
  ).map(([kind, s, d, scale]): Ruin => ({ kind, s, d, scale, near: `s≈${s} d≈${d}, on the village terrace` })),
];

/**
 * The old farm tracks up the valley (overlay features): gravel, each from a turning place to a
 * trailhead, so the abandoned huts and barns beside them stand on a road (world logic: buildings
 * stand within 60 m of one). They keep clear of the line and the right-hand route.
 */
const UP_TRACKS: readonly TerrainFeature[] = [
  { type: 'road', s0: 505, s1: 590, d: 40, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 645, s1: 745, d: -50, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 915, s1: 972, d: 10, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 1150, s1: 1228, d: 18, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  // Playtest 2, second pass: tracks beside the line itself, so the farms given up along it stand where
  // the chase camera sees them: the left plateau, below the dam's band, above the village; and two
  // lanes on the upper terrace, which held nothing but the lift before.
  { type: 'road', s0: 285, s1: 435, d: -150, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 1008, s1: 1098, d: -118, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 1142, s1: 1238, d: -118, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 1270, s1: 1396, d: -104, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
  { type: 'road', s0: 1270, s1: 1396, d: 104, width: 4, surface: 'gravel', start: 'turning', end: 'trailhead' },
];

/**
 * Each ruin's turn (yaw), so its collapse faces up the course, where the chase camera comes from
 * (playtest 2 review: some ruins looked intact from the approach, and one showed its remaining roof
 * slab edge-on). The ruined look always takes the structure's +x side (house.ts, chalet.ts, barn.ts):
 * a quarter turn brings it round to face up the course; a house turns 3/8 so its fallen gable and
 * front roof slab both face the camera and the slab that remains is seen across, not edge-on.
 */
const RUIN_FACING: Record<Ruin['kind'], number> = {
  house: (3 * Math.PI) / 4,
  chalet: Math.PI / 2,
  barn: Math.PI / 2,
};

const RUIN_PURPOSE: Record<Ruin['kind'], string> = {
  house:
    'A house of the old village, abandoned after the floods came through it again and again: part of its roof ' +
    'and one wall gone, a dark flood line on what remains.',
  chalet: 'A chalet of the old village, abandoned after the floods: half its roof fallen in, the windows broken.',
  barn: 'A barn of the old village, abandoned after the floods: its roof and a wall caved in.',
};

export const OVERLAY_REQUESTS: readonly OverlayRequest[] = [
  {
    kind: 'oilRig',
    near: 's≈1900 d≈0, standing in the fjord mouth beyond the coast (s 1830) and the finish (s 1850)',
    purpose: 'Calder Rig Seven: the last and most harmful structure between the thaw and the open sea.',
    landmark: { id: 'rig-seven', name: 'Calder Rig Seven', label: 'CALDER 7' },
  },
  {
    kind: 'pipeline',
    near: 's≈1800-1815, across the beach below the fjord falls (s 1740), d≈-110 to 110 on supports',
    purpose: 'The rig\'s export pipeline coming ashore: extraction lies across the last stretch of every route.',
    landmark: { id: 'landfall-pipeline', name: 'The landfall pipeline' },
  },
  {
    kind: 'apartmentBlock',
    near: 's≈1420 d≈20, on the village street (the asphalt strip s 1400-1408) below the lift',
    purpose: 'Holiday apartments built in 2034 when the lower resorts lost their snow: a big home block in the village.',
    landmark: { id: 'summit-apartments', name: 'The Fjordview apartments' },
  },
  {
    kind: 'apartmentBlock',
    near: 's≈1565 d≈-60, between the chalets on the village terrace',
    purpose: 'A second block: the village grew as the ski season shrank everywhere below it.',
  },
  {
    kind: 'pumpjack',
    near: 's≈1330 d≈-70, on the lower slope above the village, left of the lift (d -10)',
    purpose: 'A summit gas wellhead: extraction right up to the edge of the ice.',
  },
  {
    kind: 'pumpjack',
    near: 's≈1340 d≈70, lower slope above the village, right of the lift',
    purpose: 'Second wellhead.',
  },
  {
    kind: 'tank',
    near: 's≈1700 d≈-40, at the fjord quay above the falls (s 1740)',
    purpose: 'The rig supply depot.',
  },
  {
    kind: 'tank',
    near: 's≈1705 d≈-15, same depot',
    purpose: 'Second tank of the supply depot.',
  },
  {
    kind: 'monument',
    near: 's≈1470 d≈5, in the village square between the lift and the chapel',
    purpose: 'The Thaw stone (2035): a granite marker showing where the ice front stood in 1979, 2005 and 2031.',
    landmark: { id: 'thaw-stone', name: 'The Thaw stone', label: 'ICE FRONT · 1979 · 2005 · 2031' },
  },
  ...RUINS.map(
    (r, i): OverlayRequest => ({
      kind: r.kind,
      near: r.near,
      purpose: RUIN_PURPOSE[r.kind],
      ...(i === 0
        ? { landmark: { id: 'abandoned-houses', name: 'The abandoned houses', label: 'Abandoned after the floods' } }
        : {}),
    }),
  ),
];

/** Overlay indices of the abandoned homes (houses and chalets; the barns are farm buildings). */
const RUINED_HOMES = RUINS.flatMap((r, i) => (r.kind === 'barn' ? [] : [RUINS_FROM + i]));

export const CH9: ChapterDef = {
  id: 'ch9-last-thaw',
  index: 9,
  levelId: 'summit-labyrinth',
  act: 3,
  actTitle: 'The Reckoning',
  title: 'The Last Thaw',
  intro: {
    lines: [
      'This is the Upper Vell, where the ice began and where little of it is left.',
      'Below it are a dam built in eleven months, a village whose lower terrace the floods emptied, and then the sea.',
    ],
    document: {
      id: 'ch9-last-notebook',
      kind: 'record',
      title: 'Tomas Lind\'s field notebook, last page',
      date: 'September 2031',
      author: 'tomas-lind',
      characters: ['tomas-lind', 'mara-vey'],
      body:
        'Today I measured stake 30, the last one, at the top of the basin. The edge of the ice is now 2.4 kilometres from the bolt I ' +
        'set in 1979. The lake behind the new dam is quiet and blue, and it is already bigger than the lake the dam ' +
        'was designed for. My knees tell me this is my last September up here. I have written these numbers down for ' +
        'fifty-two years in case someone needed them. Someone does. I am giving my notebooks to Mara Vey at the ' +
        'records office, the one with the silver hair. She reads the footnotes.',
    },
  },
  caption: 'The Upper Vell: the last of the old ice, and a village the floods half emptied.',
  landmarks: [
    {
      id: 'upper-dam',
      name: 'The Upper Vell dam',
      category: 'water',
      bind: { source: 'base', index: 7 },
      bibleRefs: ['anna-sorel', 'upper-vell', 'd2029-upper-vell-dam', 't2029-upper-vell-dam'],
      label: 'Built 2029, in eleven months',
    },
    { id: 'village-lift', name: 'The village lift', category: 'transport', bind: { source: 'base', index: 16 }, bibleRefs: ['upper-vell'] },
    { id: 'first-chalet', name: 'The first chalet in the village', category: 'home', bind: { source: 'base', index: 22 }, bibleRefs: ['upper-vell'] },
    {
      id: 'lind-chalet',
      name: 'Tomas Lind\'s chalet',
      category: 'home',
      bind: { source: 'base', index: 25 },
      bibleRefs: ['tomas-lind', 'upper-vell'],
      label: 'Kettles on every shelf',
    },
    { id: 'fjord-chapel', name: 'The fjord chapel', category: 'community', bind: { source: 'base', index: 29 }, bibleRefs: ['upper-vell'] },
    { id: 'village-barn', name: 'The village barn', category: 'farm', bind: { source: 'base', index: 27 }, bibleRefs: ['upper-vell'] },
    { id: 'fjord-chalet', name: 'The chalet above the fjord', category: 'home', bind: { source: 'base', index: 30 }, bibleRefs: ['upper-vell'] },
    { id: 'rig-seven', name: 'Calder Rig Seven', category: 'extraction', bind: { source: 'overlay', index: 0 }, bibleRefs: ['upper-vell'], label: 'CALDER 7' },
    { id: 'landfall-pipeline', name: 'The landfall pipeline', category: 'extraction', bind: { source: 'overlay', index: 1 }, bibleRefs: ['upper-vell'] },
    { id: 'summit-apartments', name: 'The Fjordview apartments', category: 'home', bind: { source: 'overlay', index: 2 }, bibleRefs: ['upper-vell'] },
    {
      id: 'thaw-stone',
      name: 'The Thaw stone',
      category: 'community',
      bind: { source: 'overlay', index: 8 },
      bibleRefs: ['upper-vell'],
      label: 'ICE FRONT · 1979 · 2005 · 2031',
    },
    {
      // Every abandoned house and chalet of the old village (the first ruin, overlay 9, carries the
      // sign): 'destroyed' when the run broke any of them, 'intact' only if it passed them all.
      id: 'abandoned-houses',
      name: 'The abandoned houses',
      category: 'home',
      bind: { source: 'overlay', index: RUINED_HOMES[0], also: RUINED_HOMES.slice(1) },
      bibleRefs: ['upper-vell'],
      label: 'Abandoned after the floods',
    },
  ],
  /*
   * VERY OVERCROWDED (playtest 2, second pass, 2026-10-24): 265 ruins (38 before the review, 84 in the
   * earlier fixer's pass). The terrace packed 15-17 m apart (about 210 ruins on s 1262-1715, its upper
   * part reached by two new lanes), the farms given up along the line itself up the valley (the left
   * plateau, below the dam's band, above the village, beside new tracks) and along the old farm tracks;
   * each new ruin at least 9 m plus half its width off the line and the right-hand route, clear of the
   * stream, every street, building and tree. Every ruin is turned so its fallen side faces up the course
   * (RUIN_FACING). 293 built placements (the base level 19). Measured (story level, real water and
   * chipping, headless autopilot; 425 bodies, base 115), built things broken:
   *   line          complete 125.0 s, ice 3.27: 13 (dam, wellhead, seven ruined houses, a ruined chalet and
   *                 barn, the first chalet, the chapel, pipeline)
   *   lane +2 / −2  complete, ice 1.89 / 2.81: 12 / 15
   *   right / right → rig   complete, ice 1.05 / 0.88: 8 / 9
   *   through the village 20 / 10 m left, 10 / 20 m right of the line: complete, 7 / 14 / 11 / 9 ruined
   *                 houses (11 / 19 / 17 / 13 built)
   *   lanes −8 and +4 fail where they failed before (s 473, s 827)
   * Round 2 fix (2026-10-25): lanes +3 and +3.5 failed 'stuck' at the chapel and the depot (Arcade
   * finishes them); with the four ruins on the line on its left half and the house at the depot moved
   * (RUINS above), lanes −3 … +3.5 in 0.5 m steps and +3.25 all complete, as in Arcade (lane +4 fails
   * at the dam in both), and lanes +3 … +3.5 reach the chapel at 21-24 m/s (were 16-20) even with the
   * autopilot's input held over 2-6 steps, as a slow browser frame does.
   *
   * OVERLAY, PLAYTEST 2 (2026-10-24): THE ABANDONED VILLAGE (RUINS, overlay 9-46, every one 'ruined':
   * src/core/obstacles/structures/ruin.ts). 38 houses, chalets and barns the floods left half-fallen
   * crowd the terrace from s 1350 to 1702: on the line (d −55 … −64), on the right-hand route (smaller
   * cottages, scale 0.8, d 8 … 46), between them, west of the west street and east of the main street,
   * every one within 60 m of a street and clear of the paved strips. A ruin weighs half the intact
   * building's remaining parts and breaks at 0.55 of its speed: the line's iceberg (60-90 t) loses
   * 1.5-3 m/s per ruin, the right route's (25-40 t) 3-4. With the ruins at three quarters of that weight
   * and a chalet on the line just above the chapel, lane +2 reached the chapel at 9.6 m/s with 57 t and
   * stuck against it (s 1617); lighter ruins and that chalet moved 19 m off the line, every tested lane
   * gets through. Measured (story level, real water and chipping, headless; 198 bodies, base 115):
   *   line          complete 124.8 s, ice 3.28: 11 built (dam, wellhead, five ruined houses and a ruined
   *                 barn, the first chalet, the chapel, pipeline)
   *   lanes −1 / +1 / −2 / +2 / −3 / +3   complete, ice 2.92 / 3.17 / 2.82 / 1.91 / 2.11 / 1.05: 10-11 built
   *   right route   complete 123.6 s, ice 1.05: 8 built (wellhead, five ruined cottages, a chalet, pipeline)
   *   right → rig   complete 127.6 s, ice 0.88: 9 built (and Rig Seven)
   *   lanes ±4 and beyond fail before the village, exactly as before (the crevasse line at s 470, the dam)
   * The ruins stand on every way through the village (landmark 'abandoned-houses': all 35 houses and
   * chalets; the three barns are farm buildings). The ruins are the kinds' own parts minus the gone ones
   * plus a few box decor parts (one shared kit geometry): no new draw calls of their own. Frame time on
   * the target laptop (Intel Iris Xe, headless Chrome on ANGLE D3D11, 1280×720, quality High, the line
   * driven to each spot; render-only benchmark(60) ms per frame / requestAnimationFrame fps over 2.5 s),
   * this story level against the arcade level without any overlay:
   *   s 1340   20.1 ms / 49 fps   (arcade 18.8 ms / 52 fps; 208 draw calls against 182)
   *   s 1440   14.7 ms / 50 fps   (13.1 / 53)
   *   s 1520   12.5 ms / 56 fps   (12.1 / 53)
   *   s 1600   13.2 ms / 51 fps   (15.0 / 51)
   *
   * FIRST OVERLAY (Act III). Calder Rig Seven stands in the fjord mouth at s 1843 d 40, just
   * inside the finish (s 1850), where the sea begins (the requested s≈1900 lies beyond the finish, where
   * no run can reach it and its shutdown log could never be found); both routes reach the sea either
   * side of it, so leaving it standing is the default and breaking it a deliberate last turn. Scaled
   * 0.85: at full size the right route's 28 t iceberg, slowed by the pipeline and the shallows, stuck
   * against it (s 1831). The landfall pipeline crosses the beach at s 1785 (d −110 … 110), before the
   * crest at s 1790 that throws the right route over the requested s≈1808; scaled 0.75. The Fjordview
   * apartments stand beside the main street (s 1430 d −22; the requested s 1420 d 20 is on the street),
   * the second block beside the west street (s 1565 d −108): at the requested d≈−60, on the line, the
   * line broke it and then stuck on the chapel (s 1618, and both lanes). The wellheads stand on the
   * line (s 1330 d −64) and on the right route (s 1345 d 52); the depot's tanks at the fjord quay, the
   * first at its requested d −40: at d −45 it stood on the line, and once the base level's stream
   * sprang from a cave in the rock step (its spring pool deepens the reservoir the line lands in) lane
   * +2 reached it at ~10 m/s with 51 t, below its break (M·v ≥ 600), and stuck there (s 1691).
   * Measured (story level, real water and chipping, headless autopilot; 160 bodies, base 115; ice in
   * multiples of the 22 t start):
   *   line          complete 120.2 s, ice 3.43, 2800 pts: dam, wellhead, first chalet, chapel, pipeline
   *   lane −2       complete 122.1 s, ice 3.02, 2800 pts: the same five
   *   lane +2       complete 127.5 s, ice 2.17, 2800 pts: the same five
   *   (with the tank at d −45, before the stream's source: 121.7 / 122.6 / 127.2 s, 3400 pts, the tank
   *   broken on all three)
   *   right route   complete 118.9 s, ice 1.23, 1600 pts: wellhead, a chalet, pipeline
   *   right → rig   complete 122.0 s, ice 1.06, 2600 pts: wellhead, a chalet, pipeline, Rig Seven
   * Every route breaks the pipeline and a wellhead; Rig Seven, the apartments and the Thaw stone stand
   * on every natural route (the rig falls only to a deliberate turn at the shore).
   */
  overlay: {
    features: UP_TRACKS,
    obstacles: [
      { kind: 'oilRig', s: 1843, d: 40, scale: 0.85 }, // 0 Calder Rig Seven
      { kind: 'pipeline', s: 1785, d: 0, span: 220, scale: 0.75 }, // 1 the landfall pipeline
      { kind: 'apartmentBlock', s: 1430, d: -22 }, // 2 the Fjordview apartments
      { kind: 'apartmentBlock', s: 1565, d: -108 }, // 3 the second block
      { kind: 'pumpjack', s: 1330, d: -64 }, // 4 a summit wellhead
      { kind: 'pumpjack', s: 1345, d: 52 }, // 5 the second wellhead
      { kind: 'tank', s: 1700, d: -40 }, // 6 the rig supply depot (beside the line)
      { kind: 'tank', s: 1706, d: -20 }, // 7 its second tank
      { kind: 'monument', s: 1470, d: 5 }, // 8 the Thaw stone
      // 9+ the abandoned village and the farms up the valley (RUINS)
      ...RUINS.map(({ kind, s, d, scale, yaw }) => ({
        kind,
        s,
        d,
        variant: 'ruined' as const,
        ...(scale !== undefined ? { scale } : {}),
        yaw: yaw ?? RUIN_FACING[kind],
      })),
    ],
  },
  fragments: [
    F({
      id: 'ch9-handover-note',
      kind: 'report',
      title: 'Upper Vell dam, handover note',
      date: 'February 2030',
      author: 'anna-sorel',
      characters: ['anna-sorel'],
      when: { always: true },
      priority: 5,
      body:
        'The Upper Vell dam was designed in six weeks, built in eleven months and paid for from an emergency fund ' +
        'that did not exist the year before. It is sized for the lake as we measured it in March 2029. It will hold ' +
        'that lake. It will not hold a larger one. I have said so in writing to everyone whose signature counts. ' +
        'Please do not let this become the dam that proves we did something. It should be the first of the things ' +
        'we do. Anna Sorel, engineer',
    }),
    F({
      id: 'ch9-dam-went',
      kind: 'memory',
      title: 'The Upper Vell dam',
      author: 'mara-vey',
      characters: ['anna-sorel'],
      when: { landmark: 'upper-dam', status: 'destroyed' },
      priority: 8,
      body:
        'The Upper Vell dam held back the lake for ten summers. That is not nothing. Building it was the right thing ' +
        'to do, even though it was done late and only once. When it gave way, the lake came down the stream toward ' +
        'the village along the route Anna Sorel had drawn in red pen on her handover map. By then the village had ' +
        'already left the other way, by the green route, the one they had practised.',
    }),
    F({
      id: 'ch9-dam-keeper',
      kind: 'record',
      title: 'Upper Vell dam, keeper\'s log',
      date: '12 August 2039',
      characters: ['anna-sorel'],
      when: { landmark: 'upper-dam', status: 'intact' },
      priority: 8,
      body:
        'The lake is high, but the dam is holding, and the spillway is running full. Everyone in the village left by ' +
        'the green route from 06:00. I am the last person up here, the dam is the last thing up here, and we are ' +
        'both doing our jobs. I am leaving at noon by the top road. If anyone reads this: it held today. Anna Sorel ' +
        'always said that holding today is not the same as holding for ever. Today will have to do.',
    }),
    F({
      id: 'ch9-kettles',
      kind: 'memory',
      title: 'Kettles',
      author: 'mara-vey',
      characters: ['tomas-lind'],
      when: { landmark: 'lind-chalet', status: ['destroyed', 'damaged'] },
      priority: 7,
      body:
        'Tomas Lind\'s chalet had a kettle on every flat surface, a habit from fifty years of living in huts. By ' +
        'August he was living with his daughter in Carran, writing me letters in handwriting that grew larger every ' +
        'month. When I told him about the chalet, he wrote back just one line: "Did the kettles go?" I said yes. He ' +
        'wrote: "Good. They will be somewhere downstream, being useful to someone."',
    }),
    F({
      id: 'ch9-tomas-letter',
      kind: 'letter',
      title: 'Letter from Tomas Lind to Mara',
      date: 'October 2039',
      author: 'tomas-lind',
      characters: ['tomas-lind', 'mara-vey'],
      when: { landmark: 'lind-chalet', status: 'intact' },
      priority: 7,
      body:
        'Dear Mara, they tell me the chalet is still standing, kettles and all. Do not tell me which kettles; I would ' +
        'like to imagine all of them. I have been thinking about my line of measuring stakes. Someone should drill a ' +
        'new line, higher up, where there is still some ice. Not because it will change anything this year, but ' +
        'because the numbers are how you know where you are. Love, Tomas',
    }),
    F({
      id: 'ch9-chapel-board',
      kind: 'notice',
      title: 'Fjord chapel, notice board',
      date: 'August 2039',
      when: { landmark: 'fjord-chapel', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'Services are suspended. Please keep out of what is left of the building. If you have come up here looking ' +
        'for someone, the lists of everyone who left are at the church hall in Carran, and every person on them is ' +
        'safe and accounted for. If you have come up here looking for your belongings, take your time. The water ' +
        'scattered a great many things.',
    }),
    F({
      id: 'ch9-rig-shutdown',
      kind: 'record',
      title: 'Calder Rig Seven, shutdown log',
      date: '12 August 2039',
      author: 'Calder Energy',
      characters: ['ines-moreno', 'mara-vey'],
      when: { landmark: 'rig-seven', status: ['destroyed', 'damaged'] },
      priority: 7,
      body:
        'All oil production stopped at 04:00. The crew of 46 were flown ashore to Carran by 09:30. The wells were ' +
        'sealed, and the pressure was let out of the pipeline to the shore. A note from the rig manager: everything ' +
        'we were told to do, we did, and we did it early. Written below by Ines Moreno: Thank you. A copy for Mara ' +
        'Vey\'s archive, as she asked.',
    }),
    F({
      // Before: the old village had been given up to the floods long before the thaw (the ruins of the
      // overlay, RUINS), on every run.
      id: 'ch9-lower-terrace',
      kind: 'notice',
      title: 'The lower terrace: no more repairs',
      date: 'May 2036',
      author: 'Vell Valley Water Board',
      when: { always: true },
      priority: 7,
      body:
        'To the owners of the houses, chalets and barns on the lower terrace of the village. The summit stream ' +
        'flooded the lower terrace in 2031 and 2034, and again this spring. Each time the water left mud up to the ' +
        'windowsills, and with it sewage from the overflowing septic tanks, fuel from the road and rubbish from the ' +
        'whole slope above. The Board will not pay to repair these buildings a fourth time. Owners who move will be ' +
        'offered a plot on the upper terrace and help with the cost. Please do not go back into a flooded house ' +
        'without boots and gloves. [In Mara Vey\'s pencil: By the end of that year every house on this list had ' +
        'been left. Most of ' +
        'the owners nailed boards over the windows before they went, as if they meant to come back.]',
    }),
    F({
      // After: the run broke the abandoned houses (every run through the village does).
      id: 'ch9-abandoned',
      kind: 'memory',
      title: 'The lower terrace',
      author: 'mara-vey',
      when: { landmark: 'abandoned-houses', status: 'destroyed' },
      priority: 8,
      body:
        'The houses of the lower terrace had stood empty for three summers when you came through them. Every one ' +
        'had a brown line across its walls where the last flood had stopped, and most had boards over the windows, ' +
        'nailed up by owners who meant to come back and check. Below the line, everything was the colour of mud. ' +
        'Plastic bags hung in the fences, and the ditch along the street was full of bottles, tyres and a fridge ' +
        'nobody had come back for. Above the village the snow was grey, and on most days so was the sky. People ' +
        'did not leave the lower terrace in one night. They left over five years, one flood at a time, each family ' +
        'hoping that flood would be the last, and the last family moved out after the flood of 2036.',
    }),
    F({
      id: 'ch9-annex-f-funded',
      kind: 'notice',
      title: 'Alpine Pass road reopened',
      date: 'October 2039',
      author: 'Vell Valley Water Board',
      characters: ['anna-sorel'],
      // Chapter 3's open item: the valley road that could not hear the siren (its last chalet stood).
      when: { history: { landmark: 'valley-chalet', status: 'intact' } },
      priority: 5,
      body:
        'The Alpine Pass road has reopened to residents, and the post bus will run its winter timetable from 1 ' +
        'November. Annex F of the 2021 evacuation plan, a second siren mast for the valley road, has now been ' +
        'approved and paid for, and it will be built in the spring. The houses on the valley road, which could ' +
        'never hear the old siren, will hear the new one. [Written in the margin by Anna Sorel: Eighteen years ' +
        'after I asked. Better late than never. Somebody should paint that on the mast.]',
    }),
    F({
      id: 'ch9-ministry-programme',
      kind: 'newspaper',
      title: 'National spillway programme announced',
      date: 'November 2039',
      author: 'Ministry of Infrastructure',
      when: { history: { landmark: 'kessel-dam', status: 'destroyed' } },
      priority: 5,
      body:
        'The Minister has announced a national programme to enlarge the spillways of every dam fed by a glacier. ' +
        'Applications from the Vell Valley Water Board will be dealt with first. [Taped beside this cutting in the ' +
        'archive is the Ministry\'s letter of September 2025, which said no to the Kessel dam. It has the same ' +
        'letterhead and the same typeface. Only the year is different.]',
    }),
    F({
      id: 'ch9-short-of-sea',
      kind: 'memory',
      title: 'Short of the sea',
      author: 'mara-vey',
      characters: ['tomas-lind'],
      when: { outcome: 'failed' },
      priority: 6,
      body:
        'You did not reach the sea this time. Water usually gets there in the end; that is rather the problem with ' +
        'it. Tomas Lind used to say that a glacier is a river with great patience, and a river is a glacier that ' +
        'has run out of patience. I do not know which of those you are. I suspect you still get to choose.',
    }),
  ],
  fallbackReflections: [
    F({
      id: 'ch9-reflection-dam-gone',
      kind: 'reflection',
      title: 'The Upper Vell',
      author: 'mara-vey',
      when: { landmark: 'upper-dam', status: 'destroyed' },
      priority: 6,
      body:
        'So this is the last of it. You came off the Upper Vell with all the ice the mountain had left. The dam ' +
        'that was built in eleven months for the lake of 2029 met the much bigger lake of 2039, and the lake won, ' +
        'just as Anna Sorel had warned in writing. Below it, the lower terrace had already been given up, one flood ' +
        'at a time, with brown lines on the walls and boards on the windows. I do not think of you as the villain ' +
        'of this story. You are what ' +
        'was set in motion before I was born, a little by the valley and a great deal by the wider world. You were ' +
        'also, for nine chapters, a joy to watch. Both of those things are true, and I am keeping both.',
    }),
    F({
      id: 'ch9-reflection-dam-stands',
      kind: 'reflection',
      title: 'The Upper Vell',
      author: 'mara-vey',
      when: { landmark: 'upper-dam', status: 'intact' },
      priority: 6,
      body:
        'The Upper Vell dam held when you came through. It was only a partial fix, late and small, but it was real, ' +
        'and it did exactly what it was built to do. Anna Sorel had been told "not this year" about other projects ' +
        'for twenty years. This time she was finally told yes, and she built the dam in eleven months. It did not ' +
        'save the valley, but it gave the village one extra morning, and the village used that morning well. ' +
        'Everyone left safely, down the green route they had practised in their drills. The houses of the lower ' +
        'terrace had been empty for years by then, given up after three floods in five years.',
    }),
    F({
      id: 'ch9-reflection',
      kind: 'reflection',
      title: 'The Upper Vell',
      author: 'mara-vey',
      when: { always: true },
      priority: 0,
      body:
        'That is the end of the run, and nearly the end of my boxes. I have tried to keep this archive honest: what ' +
        'the measurements said, who decided what, who paid for it, and what stood and what did not. Once the ice ' +
        'had warmed, the thaw was always going to come down from the Upper Vell to the sea. But where it went, what ' +
        'stood in its way, and how early the houses were emptied were ours to decide. Some of those decisions we got ' +
        'right. Others are still in front of us: the river I grew up beside runs brown now, and even the snow up ' +
        'here is grey.',
    }),
  ],
  aiReflection: true,
  music: 'thaw',
};
