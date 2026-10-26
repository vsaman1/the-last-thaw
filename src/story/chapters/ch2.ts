import { BUILT_CATEGORIES, type ChapterDef, type StoryOverlay } from '../types';
import { fragmentsOf, type OverlayRequest } from './authoring';

/**
 * CHAPTER 2 — "The Measurements" (Act I, The Wonder). Level 2, Rocky Canyon: the Red Canyon, where
 * the Vell's meltwater cut down to the sea. Still a joyride (three falls, the kicker, the ravine), but
 * the archive now shows what one man measured here for fifty-two Septembers: stakes, a painted gauge
 * board, oranges timed between two rocks. The numbers are fiction; nothing here is a real statistic.
 * The archivist's copies are in her handwriting (the first trace of her, never an initial).
 *
 * Base placements used (src/core/levels/rockyCanyon.ts): 4 footbridge s 118, 26 footbridge s 548
 * (span 40), 33 house x0.7 s 700 d 11 (the ranger cabin the line smashes), 40 house x0.6 s 872 d -20
 * (the trading post), 42 waterTower x0.8 s 884 d 22, 44 boat s 958 d 18.
 */

const F = fragmentsOf('ch2-measurements');

export const OVERLAY_REQUESTS: readonly OverlayRequest[] = [
  {
    kind: 'monument',
    near: 's≈895 d≈-34, on the canyon mouth\'s left bank between the trading post\'s yard and the beach (sand from s≈910)',
    purpose:
      'Lind\'s reference cairn where the meltwater river meets the sea: the bottom end of his canyon gauging, as BM 1 at Vell Foot is the top.',
    landmark: { id: 'stake-zero', name: 'The Stake Zero cairn', label: 'STAKE 0 · 1979' },
  },
];

/**
 * OVERLAY (level design, Act I: light, easy to leave alone). One placement, the request above:
 *   0 monument × 0.6 s 896 d -31 → landmark 'stake-zero'. On the left bank of the canyon mouth, past
 *     the trading post's yard (s 874–886) and short of the beach (s ≈ 910). The requested d -34 is off
 *     the floor there (half-width 33.9 at s 895), so it stands 3 m further in. Scale 0.6 (≈ 8 m tall,
 *     8.6 t) reads as a survey cairn rather than a town monument. No road needed (no building-road rule
 *     for monuments). Bodies: 108 → 109 obstacle specs (budget ≤ 250).
 * Validation: chapterBindingIssues [], validateLevel(story terrain) [], validateWorldLogic no new issue.
 * Measured (headless, real session, water budget and chipping on; src/story/chapters/overlays.act1.test.ts):
 *   line          complete 44.6 s · ice 29 % · 265 pts · destroyed home 1, industry 1 (cabin, log pile)
 *                 · cairn intact, closest 34.8 m
 *   safe route    complete 45.5 s · ice 23 % · 265 pts · same · cairn closest 34.7 m
 *   mouth-left    complete 46.3 s · ice 26 % · 265 pts · same · cairn closest 7.1 m (lane -36 after s 835;
 *                 not hit: lanes -33/-36/-40 aimed at it pass 7–20 m off, the bank and the yard in the way)
 */
const OVERLAY: StoryOverlay = {
  obstacles: [{ kind: 'monument', s: 896, d: -31, scale: 0.6 }],
};

export const CH2: ChapterDef = {
  id: 'ch2-measurements',
  index: 2,
  levelId: 'rocky-canyon',
  act: 1,
  actTitle: 'The Wonder',
  title: 'The Measurements',
  intro: {
    lines: [
      'The Red Canyon carries the Vell\'s meltwater down to the sea.',
      'For fifty-two Septembers, someone came here to measure it.',
    ],
    document: {
      id: 'ch2-summary-sheet',
      kind: 'record',
      title: 'Summary sheet: how far the ice has moved back',
      date: '2011',
      author: 'tomas-lind',
      characters: ['tomas-lind'],
      body:
        'The distance from the brass bolt set in 1979 to the edge of the ice, measured every September along the ' +
        'valley floor: 61 metres in 1979, 212 metres in 1987, 640 metres in 1998, 1,010 metres in 2005 and 1,380 ' +
        'metres in 2011. The amount of water running through the canyon in August, measured at the footbridge ' +
        'gauge, has gone up in every decade since the measuring began. Stakes that melted out and had to be drilled ' +
        'in again: 41. [The archivist copied this sheet in 2029, because the original notebook had got wet.]',
    },
  },
  caption: 'The Red Canyon. The water here has been timed since 1979.',
  landmarks: [
    {
      id: 'gauging-bridge',
      name: 'The gauging footbridge',
      category: 'transport',
      bind: { source: 'base', index: 4 },
      bibleRefs: ['tomas-lind', 'red-canyon', 't1987-first-report'],
      label: 'Gauge 2 · do not lean on the rail',
    },
    { id: 'long-bridge', name: 'The long footbridge', category: 'transport', bind: { source: 'base', index: 26 }, bibleRefs: ['red-canyon'] },
    {
      id: 'lind-cabin',
      name: 'The field cabin above the third falls',
      category: 'home',
      bind: { source: 'base', index: 33 },
      bibleRefs: ['tomas-lind', 'red-canyon'],
      label: 'Field cabin · stove needs swearing at',
    },
    { id: 'trading-post', name: 'The canyon trading post', category: 'home', bind: { source: 'base', index: 40 }, bibleRefs: ['red-canyon'] },
    { id: 'canyon-tower', name: 'The canyon water tower', category: 'community', bind: { source: 'base', index: 42 }, bibleRefs: ['red-canyon'] },
    { id: 'canyon-boat', name: 'The Marit, moored off the mouth', category: 'transport', bind: { source: 'base', index: 44 }, bibleRefs: ['red-canyon'] },
    {
      id: 'stake-zero',
      name: 'The Stake Zero cairn',
      category: 'community',
      bind: { source: 'overlay', index: 0 },
      bibleRefs: ['tomas-lind', 'red-canyon', 't1979-stake-line'],
      label: 'STAKE 0 · 1979',
    },
  ],
  overlay: OVERLAY,
  fragments: [
    F({
      id: 'ch2-notebook-lake',
      kind: 'record',
      title: 'Field notebook: a new lake above Kessel',
      date: 'September 1998',
      author: 'tomas-lind',
      characters: ['tomas-lind'],
      when: { always: true },
      priority: 5,
      body:
        'Today I walked above the stakes to the bank of loose rock at the head of the Kessel valley, which the ' +
        'glacier pushed up long ago. There is a lake behind it now. It is not on any map. It is grey-green, about ' +
        'the size of the football pitch in Riverside, and it is filling. The bank of rock holding it back looks ' +
        'loose. If it gives way, the water will go down the Kessel valley and into everything below. My report will ' +
        'be called Thirty Stakes and a Lake. It is a more exciting title than I usually choose, so perhaps they ' +
        'will read this one.',
    }),
    F({
      id: 'ch2-young-lind',
      kind: 'caption',
      title: 'Photograph, 1984',
      characters: ['tomas-lind'],
      when: { always: true },
      priority: 2,
      body: 'A young Tomas Lind in a green wool hat, grinning, holding a survey stake taller than he is. On the back, in pencil: "Stake 1. This one will outlast me."',
    }),
    F({
      id: 'ch2-gauge-gone',
      kind: 'memory',
      title: 'Gauge 2',
      when: { landmark: 'gauging-bridge', status: 'destroyed' },
      priority: 7,
      body:
        'Gauge 2 was a white board screwed to the first footbridge, painted with a mark for every tenth of a metre ' +
        'of water. To measure how fast the river was running, Tomas Lind threw an orange into the water upstream and ' +
        'timed it to the bridge with a stopwatch. For thirty years the oranges went faster. When the bridge came ' +
        'down, the board went with it. It was the only instrument in the canyon that had never once been wrong.',
    }),
    F({
      id: 'ch2-gauge-reading',
      kind: 'record',
      title: 'Gauge 2: timing the river',
      date: 'August 2004',
      author: 'tomas-lind',
      characters: ['tomas-lind'],
      when: { landmark: 'gauging-bridge', status: 'intact' },
      priority: 7,
      body:
        'At 14:10 the water reached 0.9 metres on the Gauge 2 board. I threw an orange in at the rock upstream, and ' +
        'it took 7.1 seconds to reach the bridge. Last August it took 9.4 seconds, and in 1984 about 13. A walker ' +
        'ate my second orange, because he thought I was offering it to him. The third orange took 7.0 seconds. The ' +
        'river is in a hurry, and I am in no position to tell it to stop. Note to myself: buy more oranges.',
    }),
    F({
      id: 'ch2-cabin-gone',
      kind: 'memory',
      title: 'The field cabin',
      when: { landmark: 'lind-cabin', status: 'destroyed' },
      priority: 8,
      body:
        'Tomas Lind\'s field cabin above the third waterfall had two bunks, a stove that smoked unless you swore at ' +
        'it, and a shelf of notebooks with the years painted on their spines in white, from 1979 to 2031. The ' +
        'notebooks were not there when the cabin went. Tomas had given them to me in the autumn his knees gave out. ' +
        'They are in this archive now, and that is how I can tell you what was on the shelf.',
    }),
    F({
      id: 'ch2-parcel-letter',
      kind: 'letter',
      title: 'Letter from Tomas Lind to the archivist, with his notebooks',
      date: 'October 2031',
      author: 'tomas-lind',
      characters: ['tomas-lind'],
      when: { landmark: 'lind-cabin', status: 'intact' },
      priority: 8,
      body:
        'Dear friend, here they are: fifty-two notebooks, and some of them are even dry. The early ones are mostly ' +
        'about the weather, with complaints. The later ones are mostly numbers, which are worse. I have kept the key ' +
        'to the cabin, because everyone should have one door they are allowed to go back to. If you go up there, ' +
        'the stove needs swearing at. Use long words; it responds to education. Yours, Tomas',
    }),
    F({
      id: 'ch2-price-board',
      kind: 'record',
      title: 'Price board, Canyon Trading Post',
      date: '1987-2038',
      when: { landmark: 'trading-post', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'The price board outside the Canyon Trading Post listed bait, fuel, ice cream and maps. In 2012 the owner ' +
        'added a line at the bottom: GLACIER TOURS CANCELLED UNTIL FURTHER NOTICE. WALK UP AND HAVE A LOOK ' +
        'YOURSELF. The glacier was getting too far away to visit. In 2026 she painted over the word GLACIER, and ' +
        'later the word TOURS. In the last photograph of the board, it says only: CANCELLED UNTIL FURTHER NOTICE.',
    }),
    F({
      id: 'ch2-tower-courier',
      kind: 'newspaper',
      title: 'Canyon water tower to be replaced',
      date: 'May 2016',
      author: 'Riverside Courier',
      when: { landmark: 'canyon-tower', status: ['destroyed', 'damaged'] },
      priority: 5,
      body:
        'The water tower at the canyon mouth, which has supplied the trading post and the boats moored there since ' +
        '1961, is to be replaced. Inspectors found that spring floods had washed away the ground under its ' +
        'foundations. A temporary tank will be put in. Residents say the spring floods have reached the tower in ' +
        'four of the last six years, compared with only twice in the forty years before.',
    }),
    F({
      id: 'ch2-marit',
      kind: 'memory',
      title: 'The Marit',
      when: { landmark: 'canyon-boat', status: ['destroyed', 'damaged'] },
      priority: 4,
      body:
        'The Marit, a small fishing boat, was moored off the canyon mouth for thirty years. She went out perhaps ' +
        'twice a summer, because her owner preferred sitting on her to fishing from her. He said the water at the ' +
        'mouth had changed colour in his lifetime, from almost black to milky white. Tomas Lind told him it was ' +
        'glacier flour: rock ground into powder by the ice. The owner said that was somehow worse than he had ' +
        'thought.',
    }),
    F({
      id: 'ch2-gap-in-record',
      kind: 'record',
      title: 'Field notebook: the stakes I could not reach',
      date: 'September 2019',
      author: 'tomas-lind',
      characters: ['tomas-lind'],
      when: { outcome: 'failed' },
      priority: 7,
      body:
        'I could not reach stakes 20 to 30 today. The ice between them has broken up into grey rubble that shifts ' +
        'and cracks loudly. I measured the stakes I could reach. A gap in a record is part of the record too, so I ' +
        'am writing down why it is there: the glacier has stopped being a place you can walk on.',
    }),
  ],
  fallbackReflections: [
    F({
      id: 'ch2-reflection-cabin-stands',
      kind: 'reflection',
      title: 'The Red Canyon',
      when: { landmark: 'lind-cabin', status: 'intact' },
      priority: 5,
      body:
        'You went past the cabin above the third waterfall and left it standing, stove and all. I am glad, though I ' +
        'could not give you a good reason why. Tomas Lind used that cabin while he measured the same thirty stakes ' +
        'for fifty-two years. Most of what he found was dull, the way true things often are: each year the ice was ' +
        'a little lower, the river a little faster and the edge of the glacier a little further away. His tables ' +
        'are in a box beside me now, written in pencil, with tea rings on them.',
    }),
    F({
      id: 'ch2-reflection-many',
      kind: 'reflection',
      title: 'The Red Canyon',
      when: {
        all: [
          { destroyedAtLeast: 3, categories: BUILT_CATEGORIES },
          {
            any: [
              { landmark: 'gauging-bridge', status: 'destroyed' },
              { landmark: 'trading-post', status: 'destroyed' },
            ],
          },
        ],
      },
      priority: 4,
      body:
        'The canyon kept its measurements in odd places: a painted board on a bridge, a ledger at the trading post, ' +
        'and oranges timed as they floated between two rocks. You went through some of those places today, your ' +
        'points went up, and I have written down which ones. That is not an accusation; writing things down is ' +
        'what an archive does. Tomas Lind spent fifty years recording a number that kept getting worse, and almost ' +
        'nobody asked him what it meant. His numbers are in my boxes now, and so is your run.',
    }),
    F({
      id: 'ch2-reflection',
      kind: 'reflection',
      title: 'The Red Canyon',
      when: { always: true },
      priority: 0,
      body:
        'The measurements were never secret. They were in reports with plain titles, filed in the proper places and ' +
        'sent to the people whose job it was to read them. Some of those people did read them. One wrote "very ' +
        'good" in the margin and passed the report on. The water in the canyon got faster every decade. The oranges ' +
        'showed it, and so did the painted board on the bridge, and the canyon did not wait for anyone to agree.',
    }),
  ],
  aiReflection: false,
  music: 'wonder',
};
