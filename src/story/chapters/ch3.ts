import type { ChapterDef, StoryOverlay } from '../types';
import { fragmentsOf, type OverlayRequest } from './authoring';

/**
 * CHAPTER 3 — "The Warning" (Act I, The Wonder). Level 3, Alpine Pass: an open mountainside with three
 * ways down and dead ends that are not marked. The archive's subject is the 2021 evacuation plan: its
 * assembly points, its drills with soup, the siren on the chapel roof that the valley road could not
 * hear, and the one page that was never funded (Annex F, a second siren mast for the valley road). On
 * drill days the post bus drove the valley road sounding its horn instead. The player should still feel
 * curious rather than guilty; the archivist speaks in the first person for the first time.
 *
 * The arc used to be the Cut bridge over the Devil's Cut and a second bridge in Annex F. In playtest 1
 * the iceberg could not cross that bridge (it fell into the Cut beside it or stopped against its deck),
 * so every completed run marked it standing and the player never met the chapter's centre (the
 * student's playtest, 2026-10-23: "don't make the story arc about the bridges"). Since playtest 2 the
 * bridge carries the iceberg (src/core/physics/deckGround.ts; "the bridge carries", alpinePass.test.ts),
 * but riding over it does not break it, and the bridge road is a way across, not a way to the sea
 * (followed from the spawn the iceberg melts away at s ≈ 930), so the story still does not name it. The
 * bridge (base placement 38) stays in the level as a road crossing. The siren's story is met on the line:
 * the last chalet on the valley road stands on the line, and the chapter's top document is then its
 * letter.
 *
 * Base placements used (src/core/levels/alpinePass.ts): 0 bus s 86 d 30 (summit car park), 13 chalet
 * s 232 d 20 (the hairpins), 22 skiLiftPylon s 260 d -160, 49 chalet s 935 d -62 and 50 church x0.6
 * s 965 d -95 (village shelf), 58 chalet s 870 d 150 (right valley road).
 */

const F = fragmentsOf('ch3-warning');

export const OVERLAY_REQUESTS: readonly OverlayRequest[] = [
  {
    kind: 'monument',
    near: 's≈96 d≈52, just below the summit car park (parking s 86 d 30, 40 m wide), beside the pass road junction',
    purpose: 'The 1936 road builders\' stone, which the evacuation plan names as Assembly Point B.',
    landmark: { id: 'road-stone', name: 'The road builders\' stone', label: 'PASS ROAD 1936 · ASSEMBLY POINT B' },
  },
  {
    kind: 'bus',
    near: 's≈925 d≈-50, parked in the village car park by the chapel (parking s 925 d -50)',
    purpose: 'Evacuation Coach A, left at the chapel after the drills: the plan made visible.',
  },
];

/**
 * OVERLAY (level design, Act I: light, easy to leave alone). Two placements, the two requests above:
 *   0 monument × 0.6 s 87 d 57 → landmark 'road-stone'. At the right-hand end of the summit car park
 *     (s 79–93, d 10–50), the pass road 7 m below it. The requested s 96 d 52 lies on the pass road's
 *     paved strip (s ≈ 94–102 there), where a standing stone would block its traffic, so it moved 9 m
 *     up the slope. Scale 0.6 (8.6 t): at 0.8 a slow iceberg just off the summit ran into it and stuck
 *     (the run failed at s 88); at 0.6 the same line breaks it (40 t breaks it above ≈ 4.3 m/s).
 *   1 bus s 930.5 d -52.5, parked, in the village car park (s 913–937, d -55…-45) beside its two cars,
 *     12 m off the village road. No landmark (the chapter already names eight places).
 *   No features needed: both stand by existing roads and parking. Bodies: 158 → 160 obstacle specs.
 * Validation: chapterBindingIssues [], validateLevel(story terrain) [], validateWorldLogic no new issue.
 * Measured (headless, real session, water budget and chipping on; src/story/chapters/overlays.act1.test.ts):
 *   line         complete 65.7 s · ice 33 % · 0 pts · nothing destroyed · stone 60.5 m, coach 32.2 m off
 *   ski route    complete 69.1 s · ice 32 % · 60 pts · transport 2 (2 × 30: traffic lights) · stone 63.6 m, coach 26.9 m
 *   gorge route  complete 79.5 s · ice 43 % · 0 pts · nothing destroyed (post bus knocked) · stone 23.6 m
 *   stone line   complete 85.4 s · ice 38 % · 200 pts · community 1 (the stone) — the gorge route bent
 *                through the stone; the same line without the overlay: 84.1 s · 40 %
 *   (the base level gives identical numbers for line, ski and gorge: the overlay changes no route)
 */
const OVERLAY: StoryOverlay = {
  obstacles: [
    { kind: 'monument', s: 87, d: 57, scale: 0.6 },
    { kind: 'bus', s: 930.5, d: -52.5, yaw: Math.PI, parked: true }, // lengthwise: the car park is 10 m wide
  ],
};

export const CH3: ChapterDef = {
  id: 'ch3-warning',
  index: 3,
  levelId: 'alpine-pass',
  act: 1,
  actTitle: 'The Wonder',
  title: 'The Warning',
  intro: {
    lines: [
      'Three roads come down off the Alpine Pass.',
      'In an emergency, the plan said, a siren would call everyone to the chapel or the summit car park.',
      'One page of the plan was never paid for.',
    ],
    document: {
      id: 'ch3-plan-draft',
      kind: 'report',
      title: 'Alpine Pass: emergency routes (draft 3)',
      date: 'November 2021',
      author: 'Vell Valley Water Board',
      characters: ['anna-sorel'],
      body:
        'There are three roads down from the pass. Route A, the ski road, could be blocked by mud and rocks sliding ' +
        'down the steep gully above it. Route B, the hairpin road, could be blocked by falling rocks at the second ' +
        'and third bends. Route C, the old pass road, is narrow but should stay open longest. When the siren on the ' +
        'chapel roof sounds, everyone goes to Assembly Point A, the chapel, or Assembly Point B, the summit car park, ' +
        'and the coaches take them down by whichever road is open. The siren cannot be heard on the valley road, ' +
        'on the far side of the Tobel ravine, where eleven households live. We recommend a second siren mast there. ' +
        'The costs are in Annex F. Prepared by Anna Sorel, engineer. [Annex F is not attached.]',
    },
  },
  caption: 'The Alpine Pass: two assembly points, one siren and three roads down.',
  landmarks: [
    {
      id: 'post-bus',
      name: 'The post bus at the summit car park',
      category: 'transport',
      bind: { source: 'base', index: 0 },
      bibleRefs: ['alpine-pass', 't2021-pass-plan'],
      label: 'Evacuation Coach B',
    },
    { id: 'lift-pylon', name: 'The Lochbach lift', category: 'transport', bind: { source: 'base', index: 22 }, bibleRefs: ['alpine-pass'] },
    { id: 'hairpin-chalet', name: 'The chalet on the second hairpin', category: 'home', bind: { source: 'base', index: 13 }, bibleRefs: ['alpine-pass'] },
    { id: 'village-guesthouse', name: 'The Lochbach guesthouse', category: 'home', bind: { source: 'base', index: 49 }, bibleRefs: ['alpine-pass'] },
    {
      id: 'pass-chapel',
      name: 'The pass chapel',
      category: 'community',
      bind: { source: 'base', index: 50 },
      bibleRefs: ['alpine-pass', 't2021-pass-plan'],
      label: 'Assembly Point A',
    },
    {
      id: 'valley-chalet',
      name: 'The last chalet on the valley road',
      category: 'home',
      bind: { source: 'base', index: 58 },
      bibleRefs: ['alpine-pass', 'anna-sorel', 't2021-pass-plan', 'd2021-second-siren'],
      label: 'Valley road · out of earshot of the siren',
    },
    {
      id: 'road-stone',
      name: 'The road builders\' stone',
      category: 'community',
      bind: { source: 'overlay', index: 0 },
      bibleRefs: ['alpine-pass', 't1936-pass-road', 't2021-pass-plan'],
      label: 'PASS ROAD 1936 · ASSEMBLY POINT B',
    },
  ],
  overlay: OVERLAY,
  fragments: [
    F({
      id: 'ch3-exercise-notice',
      kind: 'notice',
      title: 'Exercise notice, pass villages',
      date: 'June 2022',
      author: 'Vell Valley Water Board',
      when: { always: true },
      priority: 5,
      body:
        'On Saturday 18 June the pass villages will practise the evacuation plan. When the siren sounds three long ' +
        'notes, go to your assembly point with one bag per person. Assembly Point A is the chapel, and Assembly ' +
        'Point B is the summit car park. Do not drive down the ski road. If you live on the valley road and cannot ' +
        'hear the siren, listen for the post bus instead: it will drive along the valley road at ten o\'clock and ' +
        'sound its horn three times. The chapel committee will provide refreshments. Please hand in your exercise ' +
        'card when you arrive, so that we know you got there.',
    }),
    F({
      id: 'ch3-sorel-letter',
      kind: 'letter',
      title: 'Letter to the Water Board, with the third draft of the plan',
      date: 'November 2021',
      author: 'anna-sorel',
      characters: ['anna-sorel'],
      when: { always: true },
      priority: 4,
      body:
        'Dear colleagues, the third draft of the evacuation plan is attached. You will notice that Annex F, the ' +
        'costs for a second siren mast on the valley road, is missing. It is not really missing. It is in the ' +
        'Director\'s drawer, where it was put on 2 November with the comment "not this year". I mention this only ' +
        'so that the plan does not look more complete than it is. Plans are very good at looking complete. Anna ' +
        'Sorel, engineer',
    }),
    F({
      // The chapter's centre on the line: the valley road could not hear the siren, and Annex F, the second
      // mast, stayed in a drawer.
      id: 'ch3-valley-letter',
      kind: 'letter',
      title: 'Letter from the last chalet on the valley road',
      date: 'June 2035',
      when: { landmark: 'valley-chalet', status: 'intact' },
      priority: 8,
      body:
        'Dear Water Board, thank you for the exercise card. I am sorry to say that we did not hear the siren again ' +
        'this year. We found out about the drill from the post bus driver, who stopped at our gate and sounded his ' +
        'horn three times, which he says is the correct signal. He also brought our post, so the morning was not ' +
        'wasted. Could the second siren mast for the valley road go on next year\'s list? My husband says it has ' +
        'been on the list since 2021, and that the list is kept in a drawer. Yours sincerely, Hanna Roth, the last ' +
        'chalet on the valley road',
    }),
    F({
      id: 'ch3-valley-chalet-gone',
      kind: 'memory',
      title: 'The last chalet on the valley road',
      when: { landmark: 'valley-chalet', status: ['destroyed', 'damaged'] },
      priority: 8,
      body:
        'The last chalet on the valley road stood on the far side of the Tobel ravine, too far away to hear the ' +
        'siren on the chapel roof. Annex F would have put a second siren there. Instead, on every drill day, the ' +
        'post bus driver drove out along the valley road and sounded his horn at each gate, and on the real day he ' +
        'did the same, an hour before anyone else had to move. The chalet was empty when the water reached it. ' +
        'Hanna Roth and her husband were already on the post bus, holding their exercise cards.',
    }),
    F({
      id: 'ch3-chapel-logbooks',
      kind: 'memory',
      title: 'Assembly Point A',
      when: { landmark: 'pass-chapel', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'The pass chapel was Assembly Point A. During the drills, the chapel committee served soup from the porch ' +
        'in paper cups and wrote down everyone\'s name and arrival time in a school exercise book, in pencil. I ' +
        'have two of those books. In the second one, someone has written their dog\'s name in the column for ' +
        'people, someone else has crossed it out, and a third person has written it back in.',
    }),
    F({
      id: 'ch3-chapel-log',
      kind: 'record',
      title: 'Assembly Point A, exercise log',
      date: 'June 2034',
      when: { landmark: 'pass-chapel', status: 'intact' },
      priority: 6,
      body:
        'Forty-one people had arrived by 10:52. The last to arrive, at 11:20, was Greta Huber, who had to finish her ' +
        'crossword first. Soup: leek. Comments: the siren is too quiet on the far side of the Tobel ravine, and the ' +
        'chalet on the valley road did not hear it at all. Action taken: none recorded.',
    }),
    F({
      id: 'ch3-post-bus-timetable',
      kind: 'notice',
      title: 'Post bus 340, winter timetable',
      date: '2037',
      when: { landmark: 'post-bus', status: ['destroyed', 'damaged'] },
      priority: 5,
      body:
        'Post bus 340 runs twice a day from the summit car park to Lochbach and Riverside, carrying passengers and ' +
        'the mail. In an emergency this bus becomes Evacuation Coach B. It will drive the valley road first, ' +
        'sounding its horn at every gate, and the driver will not take fares. Skis and sledges will have to wait ' +
        'for the next bus. Thank you for travelling with the valley post bus.',
    }),
    F({
      id: 'ch3-lift-courier',
      kind: 'newspaper',
      title: 'Lochbach lift to close early',
      date: 'January 2030',
      author: 'Riverside Courier',
      when: { landmark: 'lift-pylon', status: ['destroyed', 'damaged'] },
      priority: 4,
      body:
        'The Lochbach chairlift will close in February this season, its third early closure in five years, because ' +
        'there is not enough snow on the lower slopes. The lift company says the upper slopes are still "excellent". ' +
        'A spokesperson for the pass villages said the lift carries more than skiers. In summer it is the fastest ' +
        'way down from the high pastures, and the evacuation plan lists it as an escape route.',
    }),
    F({
      id: 'ch3-annex-c',
      kind: 'notice',
      title: 'Evacuation plan, Annex C',
      date: '2021',
      author: 'Vell Valley Water Board',
      when: { outcome: 'failed' },
      priority: 7,
      body:
        'If you cannot reach your assembly point, go uphill, not down, because water follows the roads. Stay ' +
        'somewhere you can be seen. The plan expects you to be found the same day. [A pencil note underneath, written ' +
        'by the archivist: The people who wrote this had never been lost on this mountain. They knew that, so they ' +
        'asked people who had.]',
    }),
  ],
  fallbackReflections: [
    F({
      id: 'ch3-reflection-valley-gone',
      kind: 'reflection',
      title: 'The Alpine Pass',
      when: { landmark: 'valley-chalet', status: ['destroyed', 'damaged'] },
      priority: 5,
      body:
        'A plan is a story people tell before something happens, so that afterwards they know what to do. The pass ' +
        'plan was a good story with one page missing: Annex F, a second siren for the houses on the valley road. ' +
        'Today the water reached the last chalet on that road. I do not want to make this heavier than it is: the ' +
        'chalet was empty, and the family had left on the post bus an hour before. But I have read Annex F. Nobody ' +
        'chose to leave those houses out of earshot. What they chose, several years in a row, was "not this year".',
    }),
    F({
      id: 'ch3-reflection-valley-stands',
      kind: 'reflection',
      title: 'The Alpine Pass',
      when: { landmark: 'valley-chalet', status: 'intact' },
      priority: 5,
      body:
        'The last chalet on the valley road was still standing when you passed, and I have written that down first. ' +
        'The plan for the pass had two assembly points, three roads, coaches, soup and a siren on the chapel roof ' +
        'that nobody on the valley road could hear. The page that would have fixed that, Annex F, stayed in a ' +
        'drawer. So whenever there was a drill, the post bus went along the valley road, sounding its horn at ' +
        'each gate, and the families there came out with their bags. I was sixteen when the drills began, living ' +
        'down in Riverside, and every June I read about them in the Riverside Courier. In the end, leaving early ' +
        'worked. The second siren was the part nobody paid for in time.',
    }),
    F({
      id: 'ch3-reflection',
      kind: 'reflection',
      title: 'The Alpine Pass',
      when: { always: true },
      priority: 0,
      body:
        'You came down the pass the way people were told not to: fast, by whichever way looked best. There is ' +
        'nothing wrong with that; you are water, more or less. The people who lived here had a plan with assembly ' +
        'points, soup, a missing page and a siren that could not be heard past the Tobel ravine. They practised ' +
        'every June, and they grumbled about it. But they came anyway, with one bag each, and wrote their names in ' +
        'pencil in the soup book. Remember the soup book. It matters later.',
    }),
  ],
  aiReflection: false,
  music: 'unease',
};
