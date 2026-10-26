import type { ObstacleKind } from '../../core/types';
import type { ChapterDef } from '../types';
import { fragmentsOf, type OverlayRequest } from './authoring';

/**
 * CHAPTER 7 — "The Escape" (Act III, The Reckoning). Level 7, Ravine Run: the Red Mesa, cut by six
 * fatal ravines, where the coast farms' only way out was the ranger road round their ends, plus two
 * rope bridges. The archive is about evacuation routes and the infrastructure people depended on: the
 * plan worked because people started early; it was hard because Line 31 (pave the road, replace the
 * rope crossings) was deferred in four capital plans. Elias's log of the last train out of Riverside
 * lives here too. Act III is dense: the overlay asks for an oil field and its pipeline across every
 * route, so avoiding human structures becomes nearly impossible.
 *
 * The chapter's big structure (playtest 2, 2026-10-24: "build something else instead of the bridge that
 * is super impactful, that if it gets destroyed it is bad"): THE CALDER PROCESSING PLANT at the head of
 * the mesa, where the oil from the wells is separated from the salty, oily water that comes up with it
 * and that waste water is kept in tanks, above every farm, the ranger post and the coast. Its four
 * waste water tanks stand across the head of the mesa where every way down begins (landmark
 * 'mesa-plant', overlay 9 with 8, 10 and 11), so every run breaks at least one of them: the text agent
 * tells what that means for the water below. Behind them the plant itself (overlay 12-30, PLANT_BODY):
 * a 30 m flare stack with its smoke, separator, pump and compressor houses, oil and waste water tank
 * farms at working size, on both sides of the line for the first 200 m, so it reads from the start and
 * the iceberg runs on through the middle of it after breaking the tanks; then well pads and tank
 * batteries all the way down (FIELD beside the lanes, LANE across them). The rope bridges keep their landmarks (base 16, 49),
 * but no document is about them any more: the plant took the bridges' place in the story.
 *
 * THE WORDS (playtest 2). Before the run, the intro and the route card put the plant above every farm.
 * After it, the documents follow the plant the way chapter 8's follow its power station: what it meant
 * to the people below it (Ada Hollins's letter, always shown), what its loss did to the water (the Water
 * Board's notice, on every run that broke it, which is every run that reaches the sea), and what the
 * mesa looked like the next spring (brown streams, an oily film, salted fields, litter along the fences,
 * a grey sky). A run that left all four tanks standing (none of the measured routes does) finds Calder's
 * log instead. The world's condition in Act III (src/story/environment.ts) is the same: brown water, a
 * grey haze, brown grass. On the line, the four documents shown are the notice, the letter, the ranger's
 * log and the spring; the reflection is the plant's (the homes reflection only after three homes).
 *
 * Base placements used (src/core/levels/ravineRun.ts): 16 footbridge s 255 d -121 (R1's rope bridge),
 * 22 house s 520 d 163 and 41 house s 765 d 163 (farms on the ranger road), 42 waterTower s 912 d 12
 * and 44 house s 935 d 45 (the ranger post), 49 footbridge s 977 d -122 (R5, the Rope Bridge), 66 house
 * s 1178 d 192 (road end), 62 house s 1378 d -126 (by the beach road).
 */

const F = fragmentsOf('ch7-escape');

/** One extra placement of the crowded mesa (overlay indices from EXTRA_FROM on). */
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

/** Overlay index of the first extra placement (the eight placements of the first overlay come first). */
export const EXTRA_FROM = 8;

/** The processing plant's tanks across the head of the mesa: d of each, west to east. */
const PLANT_TANKS = [-12, -4, 4, 12] as const;
/** Index in PLANT_TANKS of the tank the plant's sign stands at (the one on the line). */
const PLANT_SIGN = 1;
const PLANT_SCALE = 0.4;

const ALONG = Math.PI / 2;

type FieldKind = 'tank' | 'pumpjack' | 'factoryHall' | 'silo' | 'house' | 'barn';

/**
 * The oil field along the way down (EXTRA's last part): [kind, s, d, scale, where]. Each stands at
 * least 20 m from the line's lanes ±4 (its edge from the iceberg's), clear of the narrows and the
 * ranger road, of the ravines, walls and cliff bands, of the kicker run-ups (straight 40 m before
 * each), of the power line's pylons and of the base level's rocks and trees.
 */
const FIELD: readonly (readonly [FieldKind, number, number, number, string])[] = [
  // Bench 1 (s 300-440), inside the centre lane's walls.
  ['tank', 330, -45, 0.7, 'bench 1, a tank battery left of the line'],
  ['tank', 343, -52, 0.7, 'bench 1, a tank battery left of the line'],
  ['tank', 356, -45, 0.7, 'bench 1, a tank battery left of the line'],
  ['pumpjack', 405, -48, 0.5, 'bench 1, a well left of the line'],
  ['factoryHall', 322, 34, 0.45, 'bench 1, a pump house right of the line'],
  ['tank', 342, 40, 0.7, 'bench 1, a tank battery right of the line'],
  ['tank', 356, 30, 0.7, 'bench 1, a tank battery right of the line'],
  ['pumpjack', 412, 22, 0.5, 'bench 1, a well right of the line'],
  // Chute 2 below the first waterfall (s 475-600), and the centre-right sub-lane.
  ['tank', 482, -48, 0.7, 'below the first waterfall, a tank battery left of the line'],
  ['tank', 496, -56, 0.7, 'below the first waterfall, a tank battery left of the line'],
  ['pumpjack', 535, -42, 0.5, 'chute 2, a well left of the line'],
  ['factoryHall', 566, -52, 0.45, 'chute 2, a pump house left of the line'],
  ['tank', 500, 62, 0.75, 'the centre-right sub-lane, a tank battery'],
  ['tank', 514, 74, 0.75, 'the centre-right sub-lane, a tank battery'],
  ['tank', 528, 62, 0.75, 'the centre-right sub-lane, a tank battery'],
  ['factoryHall', 562, 78, 0.5, 'the centre-right sub-lane, a pump house'],
  // Bench 2 (s 695-780), above the Leap.
  ['tank', 700, -36, 0.8, 'bench 2, a tank farm left of the line'],
  ['tank', 703, -50, 0.8, 'bench 2, a tank farm left of the line'],
  ['tank', 716, -43, 0.8, 'bench 2, a tank farm left of the line'],
  ['factoryHall', 750, -46, 0.55, 'bench 2, the tank farm\'s pump house'],
  ['pumpjack', 772, -28, 0.5, 'bench 2, a well left of the line'],
  ['tank', 698, 32, 0.8, 'bench 2, a tank farm right of the line'],
  ['tank', 708, 44, 0.8, 'bench 2, a tank farm right of the line'],
  ['tank', 744, 36, 0.8, 'bench 2, a tank farm right of the line'],
  ['silo', 762, 42, 0.7, 'bench 2, the tank farm\'s sand silos'],
  ['silo', 762, 50, 0.7, 'bench 2, the tank farm\'s sand silos'],
  ['factoryHall', 702, 72, 0.5, 'bench 2, a pump house right of the line'],
  // The lower mesa (s 860-950): beside the well field, and the ranger post hamlet.
  ['tank', 905, -45, 0.75, 'the lower mesa, a tank battery by the well field'],
  ['tank', 918, -54, 0.75, 'the lower mesa, a tank battery by the well field'],
  ['tank', 932, -60, 0.75, 'the lower mesa, a tank battery by the well field'],
  ['house', 878, 72, 0.55, 'the ranger post hamlet, east of its road'],
  ['house', 945, 72, 0.55, 'the ranger post hamlet, east of its road'],
  ['barn', 900, 72, 0.5, 'the ranger post hamlet, east of its road'],
  // Bench 3 (s 1020-1080), below the Rope Bridge ravine.
  ['tank', 1028, -40, 0.75, 'bench 3, a tank battery left of the line'],
  ['tank', 1042, -48, 0.75, 'bench 3, a tank battery left of the line'],
  ['factoryHall', 1062, -42, 0.5, 'bench 3, a pump house left of the line'],
  ['tank', 1030, 34, 0.75, 'bench 3, a tank battery right of the line'],
  ['tank', 1044, 42, 0.75, 'bench 3, a tank battery right of the line'],
  ['silo', 1074, 46, 0.7, 'bench 3, a sand silo right of the line'],
  // Chute 5 (s 1120-1180), below the third waterfall.
  ['factoryHall', 1132, -36, 0.5, 'chute 5, a pump house left of the line'],
  ['tank', 1150, -40, 0.7, 'chute 5, a tank battery left of the line'],
  ['tank', 1163, -32, 0.7, 'chute 5, a tank battery left of the line'],
  ['tank', 1130, 36, 0.7, 'chute 5, a tank battery right of the line'],
  ['tank', 1145, 44, 0.7, 'chute 5, a tank battery right of the line'],
  ['pumpjack', 1150, 24, 0.5, 'chute 5, a well right of the line'],
  // Bench 4 (s 1260-1300), above the gathering pipeline.
  ['tank', 1272, -38, 0.7, 'bench 4, a tank battery left of the line'],
  ['tank', 1284, -46, 0.7, 'bench 4, a tank battery left of the line'],
  ['tank', 1272, 36, 0.7, 'bench 4, a tank battery right of the line'],
  ['tank', 1286, 30, 0.7, 'bench 4, a tank battery right of the line'],
  ['factoryHall', 1296, 50, 0.45, 'bench 4, a pump house on the gathering pipeline'],
  // The beach (s 1355-1410): the coast terminal.
  ['tank', 1372, 26, 0.75, 'the coast terminal, a tank right of the line'],
  ['tank', 1386, 38, 0.75, 'the coast terminal, a tank right of the line'],
  ['factoryHall', 1366, 52, 0.5, 'the coast terminal\'s pump house'],
  ['tank', 1376, -30, 0.75, 'the coast terminal, a tank left of the line'],
];

type PlantKind = 'factoryHall' | 'smokestack' | 'tank' | 'silo';

/**
 * The body of the Calder processing plant (EXTRA, after its four waste water tanks): [kind, s, d, scale,
 * purpose]. Left of the line its flare stack (the "flame on its tall chimney" of Ada Hollins's letter,
 * 30 m with its smoke), the separator and pump houses and the oil tanks; right of it the waste water
 * tank farm and the compressor house; beyond the right gully the east tank farm. Halls 0.7-0.8 (7 m
 * high, 22-25 m long), tanks 0.9-1.0 (9-10 m), the stack 1.0: the plant reads from the iceberg's
 * start and stands on both sides of the line for the first 200 m. None stands on a measured way down.
 */
const PLANT_BODY: readonly (readonly [PlantKind, number, number, number, string])[] = [
  ['smokestack', 118, -27, 1, 'The plant\'s flare stack, burning off the gas nobody pipes away: the flame and smoke over the mesa.'],
  ['factoryHall', 142, -33, 0.8, 'The plant\'s separator house, where oil, gas and the salty waste water are parted.'],
  ['factoryHall', 186, -40, 0.75, 'The plant\'s pump house, which sends the oil on down the gathering pipeline.'],
  ['tank', 160, -60, 1, 'One of the processing plant\'s oil tanks.'],
  ['tank', 176, -70, 1, 'One of the processing plant\'s oil tanks.'],
  ['tank', 205, -62, 1, 'One of the processing plant\'s oil tanks.'],
  ['silo', 128, -44, 0.6, 'The plant\'s sand silo, for the wells.'],
  ['factoryHall', 128, 27, 0.7, 'The plant\'s compressor house.'],
  ['tank', 152, 32, 0.9, 'One of the processing plant\'s waste water tanks.'],
  ['tank', 152, 47, 0.9, 'One of the processing plant\'s waste water tanks.'],
  ['tank', 170, 30, 0.9, 'One of the processing plant\'s waste water tanks.'],
  ['tank', 170, 45, 0.9, 'One of the processing plant\'s waste water tanks.'],
  ['tank', 188, 36, 0.9, 'One of the processing plant\'s waste water tanks.'],
  ['tank', 188, 52, 0.9, 'One of the processing plant\'s waste water tanks.'],
  ['tank', 176, 92, 0.95, 'One of the processing plant\'s oil tanks, across the head of the mesa from its houses.'],
  ['tank', 180, 108, 0.95, 'One of the processing plant\'s oil tanks, across the head of the mesa from its houses.'],
  ['tank', 196, 98, 0.95, 'One of the processing plant\'s oil tanks, across the head of the mesa from its houses.'],
  ['factoryHall', 214, 126, 0.6, 'The plant\'s compressor house by its east tank farm.'],
  ['smokestack', 206, 112, 0.7, 'The east tank farm\'s vent stack.'],
];

type LaneKind = 'tank' | 'pumpjack' | 'pylon';

/**
 * The oil field ON the way down (EXTRA's very last part; playtest 2: "over population of things ... that
 * it is impossible to avoid"): [kind, s, d, scale, where]. Rows of a well pad\'s light tanks (0.32: 3 m
 * high, 3.5 m across, break from 2.6 m/s for this 30 t iceberg and chip almost no ice) 6 m apart across
 * the line\'s lanes, so every lane from 18 m left of the line to 18 m right of it meets a tank of each row
 * (the iceberg is 4.4 m across, the gaps 2.5 m). Rows stand only where the line is on the ground (not
 * under a waterfall\'s or a kicker\'s flight) and has room to get its speed back before the next kicker
 * (K1 s 255, K3 615, K4 800.5, K5 970, K6 1205: never in their last 45 m). None between the Leap\'s
 * landing and K5: a row at s 896 turned lane +4 and every early steer off K5 into the Rope Bridge ravine.
 * None on the narrows: well pads on its path slowed it into R6's boulder field (fell at s 1219).
 */
const LANE: readonly (readonly [LaneKind, number, number, number, string])[] = [
  // Above band 1 (the line d -17).
  ['tank', 398, -35, 0.32, 'above band 1, a well pad across the centre lane'],
  ['tank', 398, -29, 0.32, 'above band 1, a well pad across the centre lane'],
  ['tank', 398, -23, 0.32, 'above band 1, a well pad across the centre lane'],
  ['tank', 398, -17, 0.32, 'above band 1, a well pad across the centre lane'],
  ['tank', 398, -11, 0.32, 'above band 1, a well pad across the centre lane'],
  ['tank', 398, -5, 0.32, 'above band 1, a well pad across the centre lane'],
  ['tank', 398, 1, 0.32, 'above band 1, a well pad across the centre lane'],
  // Chute 2 below the waterfall (the line d -12), and the field\'s power line.
  ['tank', 525, -30, 0.32, 'chute 2, a well pad across the line'],
  ['tank', 525, -24, 0.32, 'chute 2, a well pad across the line'],
  ['tank', 525, -18, 0.32, 'chute 2, a well pad across the line'],
  ['tank', 525, -12, 0.32, 'chute 2, a well pad across the line'],
  ['tank', 525, -6, 0.32, 'chute 2, a well pad across the line'],
  ['tank', 525, 0, 0.32, 'chute 2, a well pad across the line'],
  ['tank', 525, 6, 0.32, 'chute 2, a well pad across the line'],
  ['pylon', 506, -30, 0.3, 'chute 2, a pylon of the field\'s power line'],
  ['pylon', 506, 6, 0.3, 'chute 2, a pylon of the field\'s power line'],
  // Chute 3 below the Switchback (the line d -3).
  ['tank', 690, -21, 0.32, 'chute 3, a well pad across the line'],
  ['tank', 690, -15, 0.32, 'chute 3, a well pad across the line'],
  ['tank', 690, -9, 0.32, 'chute 3, a well pad across the line'],
  ['tank', 690, -3, 0.32, 'chute 3, a well pad across the line'],
  ['tank', 690, 3, 0.32, 'chute 3, a well pad across the line'],
  ['tank', 690, 9, 0.32, 'chute 3, a well pad across the line'],
  ['tank', 690, 15, 0.32, 'chute 3, a well pad across the line'],
  // Bench 3 below the Rope Bridge ravine (the line d 4).
  ['tank', 1040, -14, 0.32, 'bench 3, a well pad across the line'],
  ['tank', 1040, -8, 0.32, 'bench 3, a well pad across the line'],
  ['tank', 1040, -2, 0.32, 'bench 3, a well pad across the line'],
  ['tank', 1040, 4, 0.32, 'bench 3, a well pad across the line'],
  ['tank', 1040, 10, 0.32, 'bench 3, a well pad across the line'],
  ['tank', 1040, 16, 0.32, 'bench 3, a well pad across the line'],
  ['tank', 1040, 22, 0.32, 'bench 3, a well pad across the line'],
  // Chute 5 below band 3's waterfall (the line d 0).
  ['tank', 1148, -18, 0.32, 'chute 5, a well pad across the line'],
  ['tank', 1148, -12, 0.32, 'chute 5, a well pad across the line'],
  ['tank', 1148, -6, 0.32, 'chute 5, a well pad across the line'],
  ['tank', 1148, 0, 0.32, 'chute 5, a well pad across the line'],
  ['tank', 1148, 6, 0.32, 'chute 5, a well pad across the line'],
  ['tank', 1148, 12, 0.32, 'chute 5, a well pad across the line'],
  ['tank', 1148, 18, 0.32, 'chute 5, a well pad across the line'],
  // Bench 4 above the gathering pipeline (the line d 0).
  ['tank', 1295, -18, 0.32, 'bench 4, a well pad across the line'],
  ['tank', 1295, -12, 0.32, 'bench 4, a well pad across the line'],
  ['tank', 1295, -6, 0.32, 'bench 4, a well pad across the line'],
  ['tank', 1295, 0, 0.32, 'bench 4, a well pad across the line'],
  ['tank', 1295, 6, 0.32, 'bench 4, a well pad across the line'],
  ['tank', 1295, 12, 0.32, 'bench 4, a well pad across the line'],
  ['tank', 1295, 18, 0.32, 'bench 4, a well pad across the line'],
];

const LANE_PURPOSE: Readonly<Record<LaneKind, string>> = {
  tank: 'A tank of a Red Mesa well pad, on the way down: no way down the mesa misses the field.',
  pumpjack: 'A well of the Red Mesa oil field, on the way down.',
  pylon: 'A pylon of the oil field\'s power line.',
};

const FIELD_PURPOSE: Readonly<Record<FieldKind, string>> = {
  tank: 'A tank of the Red Mesa oil field: oil, or the salty waste water that comes up with it.',
  pumpjack: 'A well of the Red Mesa oil field.',
  factoryHall: 'A pump house of the Red Mesa oil field.',
  silo: 'A sand silo of the oil field\'s wells.',
  house: 'A house of the ranger post hamlet.',
  barn: 'The ranger post hamlet\'s hay barn.',
};

/**
 * THE CROWDED MESA (Act III: avoiding human things is no longer possible). From the top: the Calder
 * processing plant across the head of the mesa, where every way down begins; its outer tanks,
 * separator and pump houses and flare stack; the top farm's shed and woodpile; cars left along the
 * ranger road; well pads (a tank, a well) on the benches the line and the narrows cross, with second
 * tanks either side of the line; a power line across chute 3; the ranger post hamlet; the coast
 * terminal's tanks on the beach. Small on purpose: every hit costs this 30 t iceberg ice
 * (0.006 × (breakImpulse / 30 − 2.5 × ice) of a full iceberg), and the kickers want their speed. Measured
 * in the OVERLAY comment.
 */
const EXTRA: readonly Extra[] = [
  ...PLANT_TANKS.map(
    (d, i): Extra => ({
      kind: 'tank',
      s: 55,
      d,
      scale: PLANT_SCALE,
      near: `s≈55 d≈${d}, the processing plant's row of tanks across the head of the mesa (${i + 1} of ${PLANT_TANKS.length})`,
      purpose:
        i === PLANT_SIGN
          ? 'The Calder processing plant (1971): where the oil from the Red Mesa wells is separated from the salty, ' +
            'oily water that comes up with it, and that waste water is kept in a row of tanks. It stands at the top of ' +
            'the mesa, above every farm, the ranger post and the coast, where every way down from the ice begins.'
          : 'One of the processing plant\'s waste water tanks: the row spans the head of the mesa, so no way down gets round it.',
    }),
  ),
  // The plant itself, behind its waste water tanks and in view from the start (playtest 2 review: at
  // d ±54-74 its outbuildings were out of every chase view, and then at 0.55-0.6 they still read as
  // sheds): PLANT_BODY, at working size, on both sides of the line down the head of the mesa (s 100-225),
  // so the iceberg runs down through the middle of the plant for some ten seconds after it breaks the
  // tanks. Clear of the line, the narrows, the ranger road and the kicker K1's run-up.
  ...PLANT_BODY.map(
    ([kind, s, d, scale, purpose]): Extra => ({
      kind,
      s,
      d,
      scale,
      ...(kind === 'factoryHall' ? { yaw: Math.PI / 2 } : {}),
      near: `s≈${s} d≈${d}, the Calder processing plant at the head of the mesa`,
      purpose,
    }),
  ),
  {
    kind: 'barn',
    s: 150,
    d: 136,
    scale: 0.4,
    near: 's≈150 d≈136, the top farm\'s hay shed above the ranger road',
    purpose: 'The top farm\'s hay shed, on the way down to the ranger road.',
  },
  {
    kind: 'logPile',
    s: 125,
    d: 94,
    near: 's≈125 d≈94, the top farm\'s woodpile on the way to the ranger road',
    purpose: 'The top farm\'s woodpile.',
  },
  // Cars left at the side of the ranger road (its right-hand edge, d 180.6, clear of an iceberg riding it).
  ...[300, 440, 640, 980, 1100].map(
    (s): Extra => ({
      kind: 'car',
      s,
      d: 180.6,
      yaw: 0,
      parked: true,
      near: `s≈${s} d≈181, parked at the side of the ranger road`,
      purpose: 'A car left at the side of the ranger road: the mesa\'s one way out was full of them.',
    }),
  ),
  // Well pads on the benches the line and the narrows cross: small, so they cost the iceberg little.
  {
    kind: 'tank',
    s: 310,
    d: -12,
    scale: 0.28,
    near: 's≈310 d≈−12, bench 1 below the First Cut, on the line',
    purpose: 'A well pad\'s oil tank on bench 1.',
  },
  {
    kind: 'pumpjack',
    s: 345,
    d: -15,
    scale: 0.33,
    yaw: ALONG,
    near: 's≈345 d≈−15, bench 1, on the line',
    purpose: 'A well on bench 1: the field reaches the middle of the mesa.',
  },
  {
    kind: 'pumpjack',
    s: 380,
    d: -160,
    scale: 0.33,
    yaw: ALONG,
    near: 's≈380 d≈−160, beside the narrows below the First Cut',
    purpose: 'A well beside the narrows.',
  },
  {
    kind: 'tank',
    s: 545,
    d: -8,
    scale: 0.28,
    near: 's≈545 d≈−8, chute 2 below band 1, on the line',
    purpose: 'A well pad\'s oil tank in chute 2.',
  },
  {
    kind: 'pumpjack',
    s: 575,
    d: -100,
    scale: 0.33,
    yaw: ALONG,
    near: 's≈575 d≈−100, beside the narrows above the Switchback',
    purpose: 'A well beside the narrows above the Switchback.',
  },
  // A power line across chute 3 to the plant (the narrows pass between two of its pylons).
  ...[-170, -150, -105, -62, -1, 45, 90, 128, 166].map(
    (d): Extra => ({
      kind: 'pylon',
      s: 725,
      d,
      scale: 0.3,
      near: `s≈725 d≈${d}, the power line across chute 3`,
      purpose: 'A pylon of the power line that carries electricity across the mesa to the processing plant.',
    }),
  ),
  // The ranger post hamlet round the ranger post road (s 875-950, d 28), beside the line.
  {
    kind: 'house',
    s: 905,
    d: 48,
    scale: 0.6,
    near: 's≈905 d≈48, the ranger post hamlet beside its road',
    purpose: 'A house of the ranger post hamlet.',
  },
  {
    kind: 'house',
    s: 948,
    d: 60,
    scale: 0.6,
    near: 's≈948 d≈60, the ranger post hamlet beside its road',
    purpose: 'A house of the ranger post hamlet.',
  },
  {
    kind: 'house',
    s: 890,
    d: -20,
    scale: 0.5,
    near: 's≈890 d≈−20, the ranger post hamlet, west of the line',
    purpose: 'A cottage of the ranger post hamlet.',
  },
  {
    kind: 'house',
    s: 940,
    d: 20,
    scale: 0.5,
    near: 's≈940 d≈20, the ranger post hamlet, east of the line',
    purpose: 'A cottage of the ranger post hamlet.',
  },
  {
    kind: 'car',
    s: 940,
    d: 26.25,
    yaw: Math.PI,
    near: 's≈940 d≈26, driving up the ranger post road',
    purpose: 'A car on the ranger post road.',
  },
  {
    kind: 'tank',
    s: 1068,
    d: 2,
    scale: 0.28,
    near: 's≈1068 d≈2, bench 3 below the Rope Bridge ravine, on the line',
    purpose: 'A well pad\'s oil tank on bench 3.',
  },
  {
    kind: 'pumpjack',
    s: 1295,
    d: -63,
    scale: 0.33,
    yaw: ALONG,
    near: 's≈1295 d≈−63, bench 4 below the Last Gash, the narrows',
    purpose: 'A well on bench 4 in the narrows.',
  },
  // Second tanks of the well pads, a few metres either side of the line's own (lanes ±4 meet them).
  ...(
    [
      [545, -15, 's≈545 d≈−15, chute 2, beside the line'],
      [1068, -5, 's≈1068 d≈−5, bench 3, beside the line'],
      [1068, 9, 's≈1068 d≈9, bench 3, beside the line'],
    ] as const
  ).map(
    ([s, d, near]): Extra => ({ kind: 'tank', s, d, scale: 0.28, near, purpose: 'A well pad\'s second oil tank.' }),
  ),
  // Calder's coast terminal on the beach, where the gathering pipeline ends.
  ...(
    [
      [1400, -7, 's≈1400 d≈−7, the coast terminal on the beach, beside the line'],
      [1400, 6, 's≈1400 d≈6, the coast terminal on the beach, beside the line'],
    ] as const
  ).map(
    ([s, d, near]): Extra => ({ kind: 'tank', s, d, scale: 0.3, near, purpose: 'A tank of Calder\'s coast terminal.' }),
  ),
  {
    kind: 'tank',
    s: 1405,
    d: 0,
    scale: 0.3,
    near: 's≈1405 d≈0, the coast terminal on the beach, on the line',
    purpose: 'A tank of Calder\'s coast terminal, where the gathering pipeline ends.',
  },
  {
    kind: 'tank',
    s: 1410,
    d: -36,
    scale: 0.3,
    near: 's≈1410 d≈−36, the coast terminal on the beach, below the narrows',
    purpose: 'A tank of Calder\'s coast terminal.',
  },
  // THE FIELD ALONG THE WAY DOWN (playtest 2 review: below the plant each 200 m band of the mesa held
  // 1-10 built things, and from the chase camera it was open ground). Tank batteries, well pads and
  // pump houses on every bench and chute, 20-60 m either side of the line, where the chase camera sees
  // them; at working size (tanks 0.7-0.8), clear of the measured ways down and of the kicker run-ups.
  ...FIELD.map(
    ([kind, s, d, scale, where]): Extra => ({
      kind,
      s,
      d,
      scale,
      ...(kind === 'factoryHall' ? { yaw: Math.PI / 2 } : kind === 'pumpjack' ? { yaw: ALONG } : {}),
      near: `s≈${s} d≈${d}, ${where}`,
      purpose: FIELD_PURPOSE[kind],
    }),
  ),
  // THE FIELD ON THE WAY DOWN (playtest 2): LANE, across the line's lanes.
  ...LANE.map(
    ([kind, s, d, scale, where]): Extra => ({
      kind,
      s,
      d,
      scale,
      ...(kind === 'pumpjack' ? { yaw: ALONG } : {}),
      near: `s≈${s} d≈${d}, ${where}`,
      purpose: LANE_PURPOSE[kind],
    }),
  ),
];

/** Overlay indices of the processing plant's tanks (the landmark), the sign's tank first. */
const PLANT = [EXTRA_FROM + PLANT_SIGN, ...PLANT_TANKS.flatMap((_, i) => (i === PLANT_SIGN ? [] : [EXTRA_FROM + i]))];

export const OVERLAY_REQUESTS: readonly OverlayRequest[] = [
  {
    kind: 'pumpjack',
    near: 's≈840 d≈-70, on the lower mesa (s 800-900, slope 0.07) left of the ranger post road',
    purpose: 'The Red Mesa oil field, pumping since 1971 and "past its best": extraction on the escape route.',
    landmark: { id: 'mesa-wells', name: 'The Red Mesa well field' },
  },
  { kind: 'pumpjack', near: 's≈862 d≈-110, lower mesa, same field', purpose: 'Second well of the Red Mesa field.' },
  { kind: 'pumpjack', near: 's≈884 d≈-150, lower mesa, same field', purpose: 'Third well of the Red Mesa field.' },
  {
    kind: 'pumpjack',
    near: 's≈1040 d≈60, on bench 3 below R5 (s 955-1010), right of the kicker K5 (d 10)',
    purpose: 'A fourth well beyond the Rope Bridge ravine: the field reaches every lane.',
  },
  {
    kind: 'pipeline',
    near: 's≈1150, across chute 5 (s 1100-1190) from d≈-120 to 120 on supports, below band 3 (s 1100)',
    purpose: 'The field\'s gathering pipeline to the coast terminal, crossing every route to the sea.',
    landmark: { id: 'mesa-pipeline', name: 'The gathering pipeline', label: 'CALDER · CRUDE · DO NOT CLIMB' },
  },
  {
    kind: 'apartmentBlock',
    near: 's≈1385 d≈-82, by the beach road (s 1352-1404, d -110) below band 4 (s 1335)',
    purpose: 'The oil-field workers\' hostel at the end of the road: a big home block on the last approach to the sea.',
    landmark: { id: 'field-hostel', name: 'The field workers\' hostel' },
  },
  {
    kind: 'house',
    near: 's≈1060 d≈165, on the ranger road (d 178) past the end of R5',
    purpose: 'One more farm on the list: the mesa was lived on all the way down.',
  },
  {
    kind: 'bus',
    near: 's≈920 d≈30, parked on the ranger post road (s 875-950, d 28)',
    purpose: 'The ranger\'s minibus, which the plan calls "the coach". It seats eleven.',
  },
  ...EXTRA.map(
    ({ kind, near, purpose }, i): OverlayRequest => ({
      kind,
      near,
      purpose,
      ...(i === PLANT_SIGN
        ? {
            landmark: {
              id: 'mesa-plant',
              name: 'The Calder processing plant',
              label: 'Calder processing plant · holds the oil field\'s waste water',
            },
          }
        : {}),
    }),
  ),
];

export const CH7: ChapterDef = {
  id: 'ch7-escape',
  index: 7,
  levelId: 'ravine-run',
  act: 3,
  actTitle: 'The Reckoning',
  title: 'The Escape',
  intro: {
    lines: [
      'South of the valley, the farms of the Red Mesa had one way out: the ranger road, round the ends of six ravines.',
      'At the head of the mesa, above every farm, stood the Calder processing plant and its tanks of oily waste water.',
    ],
    document: {
      id: 'ch7-route-card',
      kind: 'notice',
      title: 'Red Mesa route card (keep in your vehicle)',
      date: '2034',
      author: 'Vell Valley Water Board',
      body:
        'Follow the ranger road south. If the alarm sounds at the processing plant at the head of the mesa, keep ' +
        'away from the streams that run down from it, and keep your animals away too. At the Leap, the deepest ' +
        'ravine, the road goes round its right-hand end, so allow twenty minutes. If the road is blocked, walk to ' +
        'the ranger post and wait for the coach. The coach is the ranger\'s minibus, and it seats eleven people.',
    },
  },
  caption: 'The Red Mesa: the plant at the top, six ravines below it, then the sea.',
  landmarks: [
    { id: 'first-cut-bridge', name: 'The First Cut rope bridge', category: 'transport', bind: { source: 'base', index: 16 }, bibleRefs: ['red-mesa'] },
    { id: 'hollins-farm', name: 'Hollins farm on the ranger road', category: 'home', bind: { source: 'base', index: 22 }, bibleRefs: ['red-mesa'] },
    { id: 'leap-farm', name: 'The farm above the Leap', category: 'home', bind: { source: 'base', index: 41 }, bibleRefs: ['red-mesa'] },
    {
      id: 'ranger-tank',
      name: 'The ranger post water tower',
      category: 'community',
      bind: { source: 'base', index: 42 },
      bibleRefs: ['red-mesa'],
      label: 'Ranger post · water',
    },
    { id: 'ranger-post', name: 'The ranger post', category: 'home', bind: { source: 'base', index: 44 }, bibleRefs: ['red-mesa'], label: 'Assembly point' },
    {
      id: 'rope-bridge',
      name: 'The Rope Bridge',
      category: 'transport',
      bind: { source: 'base', index: 49 },
      bibleRefs: ['red-mesa', 'd2026-line-31'],
      label: 'Foot traffic only · not an evacuation route',
    },
    { id: 'road-end-farm', name: 'The last farm on the ranger road', category: 'home', bind: { source: 'base', index: 66 }, bibleRefs: ['red-mesa'] },
    { id: 'beach-house', name: 'The house at the road\'s end', category: 'home', bind: { source: 'base', index: 62 }, bibleRefs: ['red-mesa'] },
    {
      // All four wells of the field (overlay 0-3): it is 'intact' only when every one of them stood.
      id: 'mesa-wells',
      name: 'The Red Mesa well field',
      category: 'extraction',
      bind: { source: 'overlay', index: 0, also: [1, 2, 3] },
      bibleRefs: ['red-mesa'],
    },
    {
      id: 'mesa-pipeline',
      name: 'The gathering pipeline',
      category: 'extraction',
      bind: { source: 'overlay', index: 4 },
      bibleRefs: ['red-mesa'],
      label: 'CALDER · CRUDE · DO NOT CLIMB',
    },
    { id: 'field-hostel', name: 'The field workers\' hostel', category: 'home', bind: { source: 'overlay', index: 5 }, bibleRefs: ['red-mesa'] },
    {
      // The processing plant's four waste water tanks across the head of the mesa (overlay 8-11; the
      // sign stands at the one on the line, overlay 9): one plant, 'intact' only when every tank stood.
      id: 'mesa-plant',
      name: 'The Calder processing plant',
      category: 'extraction',
      bind: { source: 'overlay', index: PLANT[0], also: PLANT.slice(1) },
      bibleRefs: ['red-mesa'],
      label: 'Calder processing plant · holds the oil field\'s waste water',
    },
  ],
  /*
   * CROWDED ALL THE WAY DOWN (playtest 2, second pass, 2026-10-24): the plant's body at working size
   * (PLANT_BODY, overlay 12-30: halls 0.6-0.8, tanks 0.9-1.0, stacks 0.7-1.0, at s 118-214 either side of
   * the line, none on a measured way down), the FIELD of tank batteries, wells, silos and pump houses 20-60
   * m either side of the line on every bench and chute, and the LANE rows of light well pad tanks across
   * the line's lanes at s 398, 525, 690, 1040, 1148 and 1295 (where the line is on the ground and clear of
   * the kickers' run-ups). 202 built placements (the base level 27). Measured (story level, real water and
   * chipping, headless autopilot; 397 bodies, base 162):
   *   line          complete 68.7 s, ice 0.219: 16 built      lane −4  complete 64.5 s, ice 0.276: 14
   *   lane +4       complete 68.1 s, ice 0.101: 17 built      lane −2 / +2  complete, ice 0.260 / 0.066: 18 / 20
   *   the narrows   complete 79.8 s, ice 0.215:  5 built      ranger road   complete 77.4 s, ice 0.085: 6
   *   held right 0.8 s / left 1.6 s / tapped right 0.7 s / held right 1.5 s, then the line: complete, ice
   *                 0.145-0.168, 16-17 built
   *   lane −40 stuck at s 166 (as before), lane +48 stuck at s 150 against the plant's waste water tank farm
   *                 (it fell into the First Cut at s 288 before; neither ever reached the sea)
   * A row at s 896 (between the Leap's landing and K5) turned lane +4 and every early steer off K5 into
   * the Rope Bridge ravine (fell at s 996-999); well pads on the narrows' path slowed it into R6's boulder
   * field (fell at s 1219). Neither is there.
   *
   * OVERLAY, PLAYTEST 2 (2026-10-24): the crowded mesa (EXTRA, overlay 8-53). THE PLANT: four tanks
   * (scale 0.4: 4.4 m across, 3.4 m high, 1.8 t; break from 3.6 m/s for the 30 t iceberg) at s 55, d −12,
   * −4, 4, 12: every way down passes s 55 within d −12 … +12 (the line −0.5, the narrows −10, the road
   * +10), and the 3.6 m gaps are narrower than the iceberg. A row of twelve (d −44 … +44) trapped the wide
   * lanes, which crawl across the top at 2 m/s (lanes ±40 … ±48, swerves to ±50: they came to rest
   * against an outer tank at s 51-53 and failed stuck with the plant standing); with the row across the
   * middle only they pass beside it and fail where they failed before (stuck at s 160-166 or fallen into
   * the First Cut). Its outer tanks (s 58, d ±64, ±74), halls (s 68, d ±54) and stack (s 66, d −66) stand
   * beyond where any lane passes. Well pads cost little: tanks 0.28 and wells 0.33 (break impulse < 60).
   * The narrows' own wells stand beside it (s 380 d −160, s 575 d −100): on its path they slowed it into
   * R6's boulder field (fell at s 1217-1219, twice); its well is on bench 4 (s 1295 d −63) instead.
   * Pipeline 0.75 → 0.5 and the top farm 0.6 → 0.36 pay for the road route's plant tanks. Measured
   * (story level, real water and chipping, headless autopilot; 275 bodies, base 162):
   *   line          complete 63.2 s, ice 0.314: 10 built (a plant tank, well pad tank and well, log pile,
   *                 well pad tank, pylon, water tower, bench-3 tank, pipeline, a terminal tank)
   *   lane −4       complete 60.6 s, ice 0.364:  8 built      lane +4  complete 61.0 s, ice 0.298: 8
   *   lane −2       complete 63.5 s, ice 0.362: 10 built      lane +2  complete 66.8 s, ice 0.190: 11
   *   lane −3 / +3  complete, ice 0.360 / 0.190: 9 / 12      lane −1 / +1 complete, 0.365 / 0.225: 9 / 11
   *   the narrows   complete 80.5 s, ice 0.209:  5 built (a plant tank, the well field, the bench-4 well,
   *                 pipeline, a terminal tank)
   *   ranger road   complete 77.4 s, ice 0.085:  6 built (two plant tanks, the woodpile, the shed, the top
   *                 farm, pipeline; SENSITIVE: ice)
   *   held right 0.8 s / left 1.6 s / tapped right 0.7 s / held right 1.5 s, then the line: complete, ice
   *                 0.25-0.28, 10-11 built
   *   lanes ±6 … ±40 (4 m steps), ±48: fail exactly where they failed before the crowding (fell into the
   *                 First Cut at s 272-289; lane −40 stuck at s 166); those within ±16 break a plant tank
   *   swerve to −50 / +50 until s 90, then the line: stuck at s 161 / fell at s 283, as lane −40 / +48
   * Every run that reaches the sea breaks the plant and at least four other built things; none rests
   * against a standing plant tank.
   *
   * FIRST OVERLAY (Act III). The well field on the lower mesa below the Leap (R4 fills s
   * 803-848, so the wells stand at s 874-898), a fourth well on bench 3, the gathering pipeline across
   * bench 4 (s 1318, d -75 … 160: below R6, 5 m above band 4's exclusion zone, where every route is on
   * the ground; it crosses no road: the ranger road ends at s 1190), the hostel by the beach road, the
   * extra farm at the top of the ranger road (moved from s≈1060, where no route passes, to the open
   * mesa the road route crosses before the trailhead), the minibus parked at the ranger post's kerb.
   * The narrows' well is scaled 0.7 (4.8 t): a full 14 t pumpjack stops the narrows (fell at R6); the
   * pipeline was scaled 0.75 (a gathering line; 0.5 since playtest 2): at full size the narrows and the
   * road get stuck on it. Measured then (208 bodies, base 162):
   *   line          complete 60.9 s, ice 0.358, 1065 pts: log pile, water tower, pipeline
   *   lane −4       complete 59.7 s, ice 0.361,  815 pts: log pile, pipeline (the water tower stands)
   *   lane +4       complete 60.3 s, ice 0.293, 1065 pts: log pile, water tower, pipeline
   *   the narrows   complete 74.0 s, ice 0.294, 1400 pts: the well field (pumpjack), pipeline
   *   ranger road   complete 77.2 s, ice 0.066, 1050 pts: the top farm (house), pipeline (SENSITIVE: ice)
   * Every route breaks the pipeline; the well field falls only on the narrows and the ranger post's
   * water tower only on the line and right of it, so both can be spared by steering. The hostel (110 t)
   * cannot be broken by this 30 t iceberg: it stands on every route.
   */
  overlay: {
    obstacles: [
      { kind: 'pumpjack', s: 898, d: -137, yaw: Math.PI / 2, scale: 0.7 }, // 0 the well field (narrows lane)
      { kind: 'pumpjack', s: 874, d: -100, yaw: 2.4 }, // 1
      { kind: 'pumpjack', s: 880, d: -62, yaw: 0.9 }, // 2
      { kind: 'pumpjack', s: 1050, d: 78, yaw: 2.0 }, // 3 beyond the Rope Bridge ravine
      { kind: 'pipeline', s: 1318, d: 42.5, span: 235, scale: 0.5 }, // 4 gathering pipeline, bench 4
      { kind: 'apartmentBlock', s: 1385, d: -86 }, // 5 field workers' hostel by the beach road
      { kind: 'house', s: 172, d: 160, scale: 0.36 }, // 6 one more farm, at the top of the ranger road
      { kind: 'bus', s: 925, d: 30, yaw: 0, parked: true }, // 7 the ranger's minibus, at the kerb (road edge d 31.5)
      // 8+ the crowded mesa (EXTRA, in its order): 8-11 the processing plant's waste water tanks, 12-30
      // the plant's body, then the rest (see the OVERLAY comments above)
      ...EXTRA.map(({ kind, s, d, scale, yaw, parked }) => ({
        kind,
        s,
        d,
        ...(scale !== undefined ? { scale } : {}),
        ...(yaw !== undefined ? { yaw } : {}),
        ...(parked ? { parked } : {}),
      })),
    ],
  },
  fragments: [
    F({
      // Before: what the plant meant to the people below it, on every run.
      id: 'ch7-plant-letter',
      kind: 'letter',
      title: 'Letter from Ada Hollins to Calder Energy',
      date: 'May 2036',
      when: { always: true },
      priority: 8,
      body:
        'Dear Calder Energy, my family has farmed below your processing plant since it was built in 1971. It gave ' +
        'my father his first steady job, and on dark evenings the flame on its tall chimney is how we find our way ' +
        'home across the mesa. I am not writing to complain about the smell, which we stopped noticing years ago. ' +
        'I am writing about the tanks. They hold the salty, oily water that comes up from your wells with the oil, ' +
        'and they stand at the top of the mesa, above our wells, our streams and our potato fields. Please empty ' +
        'them before the field closes. Everything on this mesa runs downhill from your plant. Yours, Ada Hollins, ' +
        'Hollins farm',
    }),
    F({
      // After: what its loss did to the water. Every run that reaches the sea breaks the plant.
      id: 'ch7-plant-notice',
      kind: 'notice',
      title: 'Red Mesa: do not use the water',
      date: '14 August 2039',
      author: 'Vell Valley Water Board',
      when: { landmark: 'mesa-plant', status: 'destroyed' },
      priority: 9,
      body:
        'One or more of the tanks of the Calder processing plant at the head of the Red Mesa were broken open on ' +
        '12 August, and waste water has run down the streams below them. Until further notice: do not drink from any well ' +
        'or stream on the mesa, do not water animals from them, and do not eat anything grown in the lower fields. ' +
        'The streams are running brown, with an oily film on the still pools, and the beach below the terminal is ' +
        'closed. Drinking water will be brought to the ranger post by tanker every morning at nine. The plant was ' +
        'empty: its staff left at six with everyone else.',
    }),
    F({
      // A run that left all four tanks standing (no measured route does): Calder's log, and Ines Moreno.
      id: 'ch7-plant-log',
      kind: 'record',
      title: 'Calder processing plant, Red Mesa: daily log',
      date: '13 August 2039',
      author: 'Calder Energy',
      characters: ['ines-moreno'],
      when: { landmark: 'mesa-plant', status: 'intact' },
      priority: 9,
      body:
        'All four waste water tanks are standing and sealed, and no water has left the site. The wells were shut ' +
        'down at five in the morning on the twelfth, and the staff left with the farms at six. [Written underneath ' +
        'by Ines Moreno: The tanks held, which on this mesa counts as good news. Empty them this autumn, all four, ' +
        'before the board finds a reason to wait. I am writing this down so that someone remembers I asked.]',
    }),
    F({
      id: 'ch7-ranger-log',
      kind: 'record',
      title: 'Ranger post log',
      date: '12 August 2039',
      author: 'Red Mesa ranger post',
      when: { always: true },
      priority: 7,
      body:
        '05:40: heard the siren from the valley, faintly. 06:00: phoned the fourteen farms on my list, and eleven ' +
        'answered. 06:30: drove the minibus to the three that did not. The Hollins family had already gone and ' +
        'chalked their door. The farm above the Leap was empty too, with a dog bowl left out and a note on it: DOG ' +
        'WITH US. At the last farm on the road, the family were still packing. I gave them ten minutes. They took ' +
        'twelve, and left the rest of their things behind.',
    }),
    F({
      id: 'ch7-line-31',
      kind: 'record',
      title: 'Water Board building plans, line 31',
      date: '2026-2038',
      author: 'Vell Valley Water Board',
      when: { always: true },
      priority: 4,
      body:
        'The Water Board\'s building plan for 2026 to 2030, line 31: pave the Red Mesa ranger road, widen it to two ' +
        'lanes, and replace its two rope bridges with bridges that cars can cross, so that it can be used as an ' +
        'evacuation route. Status: put off until the plan for 2030 to 2034. In that plan, line 31 was put off ' +
        'again, until 2034 to 2038. In that plan it was put off once more. [In the margin, in pencil: Line 31 has ' +
        'outlasted two heads of the Water Board.]',
    }),
    F({
      id: 'ch7-last-train',
      kind: 'record',
      title: 'Driver\'s log, the last train',
      date: '12 August 2039',
      author: 'elias-vey',
      characters: ['elias-vey'],
      when: { always: true },
      priority: 3,
      body:
        'The 21:52 from Riverside to Carran, the last train of the day. At 21:49 the platform was empty except for ' +
        'one passenger, my sister, who was arguing with the guard about four boxes. We loaded the boxes, and then ' +
        'we loaded my sister. We left at 21:52. At 21:58, behind us, water came over the rails at the level ' +
        'crossing. We arrived at Carran at 23:40. My sister was asleep on her boxes. I did not wake her.',
    }),
    F({
      // After, the next spring: what the mesa looked like once the waste water had gone down it.
      id: 'ch7-salt-spring',
      kind: 'memory',
      title: 'The Red Mesa, the next spring',
      when: { landmark: 'mesa-plant', status: 'destroyed' },
      priority: 6,
      body:
        'I went back to the Red Mesa the following April. The streams below the plant still ran brown, and where ' +
        'they slowed there was a rainbow skin of oil on the water. The Hollins potato field was white at the edges ' +
        'with salt, and nothing had come up in it. Along every fence the flood had left a line of litter: plastic ' +
        'sheeting, feed sacks, a road sign, a garden chair. The flame on the plant\'s chimney had gone out for the ' +
        'first time since 1971, but the sky over the mesa was still grey with the haze from the valley. Ada Hollins ' +
        'asked me to photograph her field for the insurance company. I took eleven photographs, and they all look ' +
        'the same.',
    }),
    F({
      id: 'ch7-water-porch',
      kind: 'memory',
      title: 'The ranger post',
      when: { landmark: 'ranger-tank', status: ['destroyed', 'damaged'] },
      priority: 5,
      body:
        'The water tower at the ranger post held the drinking water for the last stop on the mesa, the place where ' +
        'people waited for the minibus. On the morning of the twelfth, the ranger filled every bottle she could find ' +
        'and lined them up on the porch with a sign: TAKE ONE. TAKE TWO IF YOU ARE CARRYING A CHILD. By nine ' +
        'o\'clock every bottle had been taken.',
    }),
    F({
      id: 'ch7-hollins-door',
      kind: 'memory',
      title: 'Hollins farm',
      when: { landmark: 'hollins-farm', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'Hollins farm grew potatoes in red soil that made them look sunburnt. The family left at six in the morning ' +
        'with the dog, the papers for the farm and the grandmother Ada Hollins\'s potato knife, which she refused to ' +
        'leave behind. They chalked a circle on the door to show the house was empty. I have a photograph of that door ' +
        'from the following spring. You can still faintly see the chalk. The door is lying in a field two ' +
        'kilometres south of the farm.',
    }),
    F({
      id: 'ch7-after-action',
      kind: 'report',
      title: 'Red Mesa evacuation: what worked and what did not (draft)',
      date: 'October 2039',
      author: 'Vell Valley Water Board',
      when: { destroyedAtLeast: 3, categories: ['home'] },
      priority: 7,
      body:
        'There were fourteen farms on the list, and all fourteen households were out by 09:10. The plan expected the ' +
        'drive from the end of the road to the coast to take forty minutes. It took two hours and fifty minutes, ' +
        'because the road at the Leap has only one lane and the minibus seats eleven. What we found: the plan ' +
        'worked because people started early, and it would not have worked an hour later. What we recommend: pave ' +
        'and widen the ranger road, and replace the two rope bridges with bridges that vehicles can cross.',
    }),
    F({
      id: 'ch7-truck-at-leap',
      kind: 'record',
      title: 'Ranger post log',
      date: '12 August 2039, 08:15',
      author: 'Red Mesa ranger post',
      when: { outcome: 'failed' },
      priority: 8,
      body:
        'The road at the Leap was blocked for twenty minutes. A farm truck had slid off the edge and was hanging by ' +
        'its back wheels. It was empty; its driver had climbed out and was already walking. We all walked round it. ' +
        'A note for the review afterwards: every plan assumes the road will be open, and a great many things can ' +
        'close a road.',
    }),
    F({
      id: 'ch7-field-courier',
      kind: 'newspaper',
      title: 'Red Mesa field "past its best", says Calder',
      date: 'February 2033',
      author: 'Riverside Courier',
      when: { destroyedAtLeast: 2, categories: ['extraction'] },
      priority: 5,
      body:
        'Calder Energy has announced that the Red Mesa oil field, which has been pumping oil since 1971, will slowly ' +
        'close over the next ten years. The wells will be left where they are "until it makes financial sense to ' +
        'remove them". Farmers on the mesa had asked for the pipeline that collects the oil, which crosses every ' +
        'route to the coast, to be raised or buried, and for the waste water tanks at the processing plant to be ' +
        'emptied, before the field closes. Calder said it would consider both requests.',
    }),
  ],
  fallbackReflections: [
    F({
      // Above the plant's reflection: three homes is the rarer run, and its reflection is the evacuation's.
      id: 'ch7-reflection-homes',
      kind: 'reflection',
      title: 'The Red Mesa',
      when: { destroyedAtLeast: 3, categories: ['home'] },
      priority: 7,
      body:
        'The mesa farms went one after another today. Every door on the ranger\'s list had been chalked as empty by ' +
        'nine in the morning, so I can tell you plainly that every house was empty. The plan worked because people ' +
        'believed in it and started early: the ranger with her list and her minibus, and Ada Hollins with her ' +
        'potato knife. What the plan could not do was move the farms, or pave the road it depended on. The ' +
        'evacuation was done well. It should never have been that hard.',
    }),
    F({
      // The plant broke (every run that reaches the sea): what it held, and where that went.
      id: 'ch7-reflection-plant',
      kind: 'reflection',
      title: 'The Red Mesa',
      when: { landmark: 'mesa-plant', status: 'destroyed' },
      priority: 6,
      body:
        'You came over the head of the Red Mesa and through the Calder processing plant at the top of it. Its ' +
        'tanks held the waste water of a whole oil field, and everything on the mesa lay downhill from them: the ' +
        'streams, the farm wells, the potato fields and, at the bottom, the beach. The farms had all left by nine ' +
        'that morning, so what the water reached was empty. It still reached everything. Ada Hollins had written ' +
        'to Calder three years before, asking for those tanks to be emptied, and the company promised to think ' +
        'about it. I have her letter, and a photograph of her field the next spring, white with salt at the ' +
        'edges. The streams were still brown when I left.',
    }),
    F({
      // All four tanks stood (no measured route leaves them): saved wording only on that condition.
      id: 'ch7-reflection-plant-stands',
      kind: 'reflection',
      title: 'The Red Mesa',
      when: { landmark: 'mesa-plant', status: 'intact' },
      priority: 6,
      body:
        'The Calder processing plant was still standing when you had gone, all four of its tanks. I did not expect ' +
        'that, and nor did Ines Moreno, who wrote on the next day\'s log that it counted as good news. The waste ' +
        'water stayed where it was, above the farms, and the mesa kept its wells, its streams and its potato ' +
        'fields. The tanks were emptied that autumn by road tanker, one load at a time, which took three months ' +
        'and made nobody any money. Ada Hollins watched the last tanker go down the ranger road and then went home ' +
        'to dig her potatoes.',
    }),
    F({
      id: 'ch7-reflection',
      kind: 'reflection',
      title: 'The Red Mesa',
      when: { always: true },
      priority: 0,
      body:
        'I will keep this plain, because the mesa deserves it. The people of the Red Mesa did everything a plan asks ' +
        'of people: they kept the route card in the car, answered the phone, left early and chalked their doors. ' +
        'The things they could not do themselves, like paving a road, emptying a plant\'s tanks of waste water or ' +
        'moving a pipeline, were put off year after year by people who did not live downhill from them. That is ' +
        'what made the escape hard, and what made the mesa so hard to come back to. It was never a lack of ' +
        'courage. It was a few lines in a budget.',
    }),
  ],
  aiReflection: false,
  music: 'reckoning',
};
