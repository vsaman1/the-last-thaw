import type { ChapterDef, StoryOverlay } from '../types';
import { fragmentsOf, type OverlayRequest } from './authoring';

/**
 * CHAPTER 4 — "The People" (Act II, The Cost). Level 4, Riverside Town: the archivist's town. The line
 * ploughs a row of houses between Main Street and Church Lane; one of them is No. 14, the Vey house,
 * where the archive lived. The archive here depends on what the run actually met: the house, the
 * church hall where the street wardens met, the train at the level crossing, the 1952 dam. Nobody is
 * inside anything: the wardens chalked every empty door. Gil Harrow, Ruth and Elias Vey appear; the
 * archivist is still unnamed ("Miss Vey", "my sister", "her daughter"), though she says "my house".
 *
 * Base placements used (src/core/levels/riversideTown.ts): 23 house s 412 d -6 and 25 house s 440 d -6
 * (the block row the line ploughs), 44 church s 565 d 15, 45 tank s 430 d 140 (gas holder), 50
 * railWagon s 630.3 d -70 (the train at the level crossing), 56 roadBridge x1.3 s 777.5 d -50 (the
 * viaduct), 66 dam x0.7 s 1170 d -26.5, 78 lighthouse s 1505 d 120.
 */

const F = fragmentsOf('ch4-people');

export const OVERLAY_REQUESTS: readonly OverlayRequest[] = [
  {
    kind: 'apartmentBlock',
    near: 's≈712 d≈60, on Station Street (s 702) east of the station car park, below crossing E',
    purpose: 'Station Court: flats built in 2027 for rail and plant workers, the "new Riverside". A big home on the line.',
    landmark: { id: 'station-court', name: 'Station Court', label: 'Station Court · 48 flats' },
  },
  {
    kind: 'apartmentBlock',
    near: 's≈1300 d≈-72, behind the houses on Quay Street (d -40), above the quay (d -60) and the harbour cliff (s 1420)',
    purpose: 'Harbour View, Gil Harrow\'s last project: flats for harbour families on reclaimed ground.',
    landmark: { id: 'harbour-view', name: 'Harbour View flats' },
  },
  {
    kind: 'monument',
    near: 's≈470 d≈-80, on Mill Street at the second cross street, between the street (d -65) and the river (d -90)',
    purpose: 'The flood stone, cut with the high-water marks of 1891, 1952 and 2017: the town\'s own measurements.',
    landmark: { id: 'flood-stone', name: 'The flood stone on Mill Street', label: 'HIGH WATER 1891 · 1952 · 2017' },
  },
  {
    kind: 'pipeline',
    near: 's≈430-470 d≈95-150, the gas main on supports across the park and Gasworks Road (d 122) into the gasworks',
    purpose: 'Calder\'s gas main feeding the town gasworks: extraction running past back gardens.',
  },
];

/*
 * OVERLAY (level design, Act II "The Cost"). Placements are appended after the base obstacles, so the
 * base indices above stay valid; overlay index → landmark:
 *   0 apartmentBlock s 712   d 60    Station Court (station-court): beside the end of Station Street,
 *                                    below crossing E, on the way from the east side to the kicker
 *   1 apartmentBlock s 1318  d -52   Harbour View flats (harbour-view): behind Quay Street, on the
 *                                    reclaimed strip above the river (the stream rule keeps it 25 m
 *                                    from the river's centreline, so d -52 rather than d -72)
 *   2 monument       s 481   d -77   the flood stone (flood-stone): by Mill Street just below the
 *                                    second cross street, between the street and the river
 *   3 pipeline       s 480   d 60…115 the gas main (unnamed), across the park on supports from the
 *                                    back gardens of Gas Lane to the kerb of Gasworks Road, where it
 *                                    goes under the road into the gasworks: an above-ground pipe never
 *                                    crosses a road (2.4 m high, it would stop the traffic)
 * Site checks (not covered by the validator): both blocks clear their streets (Station Court 14.5 m
 * from Station Street, Harbour View 1.5 m behind the kerb of Quay Street, the 26 × 12 m footprint
 * long side down the course); the flood stone stands 6.5 m off Mill Street; the gas main's ends stop
 * 2.5 m short of Gasworks Road; every placement keeps |d| + radius inside the 200 m half-width.
 * MEASURED (src/story/chapters/overlays.act2.test.ts: real sessions, autopilot, story level; the base
 * level on the same line in brackets). Bodies 183 (base 173, +10).
 *   line       complete 95.8 s, ice 32.6 %, 2400 pts: 6 houses (the block row: Vey, Pell), the dam.
 *              Station Court 33 m, Harbour View 58 m, the flood stone 71 m off: all intact. [the same]
 *   outskirts  complete 102.5 s, 33.5 %, 1900 pts: 4 houses, the coffer dam; all 11 landmarks intact:
 *              the careful way. [the same]
 *   east       complete 89.8 s, 32.0 %, 3200 pts: the gas main, Station Court, 3 houses, the dam.
 *              [78.9 s, 47.8 %, 1650 pts: 3 houses, the dam — the base level's cheapest way]
 * So the cheapest tested way rises from 1650 points (east) to 1900 (the outskirts), and every tested
 * way breaks at least four homes. The intended line and the outskirts pass the overlay untouched.
 */
const OVERLAY: StoryOverlay = {
  obstacles: [
    { kind: 'apartmentBlock', s: 712, d: 60 },
    { kind: 'apartmentBlock', s: 1318, d: -52 },
    { kind: 'monument', s: 481, d: -77 },
    { kind: 'pipeline', s: 480, d: 87.5, span: 55 },
  ],
};

export const CH4: ChapterDef = {
  id: 'ch4-people',
  index: 4,
  levelId: 'riverside-town',
  act: 2,
  actTitle: 'The Cost',
  title: 'The People',
  intro: {
    lines: [
      'Riverside is a hill town on its river, with a church on a hill, a railway, a dam and a harbour.',
      'Everyone knew whose car was whose.',
    ],
    document: {
      id: 'ch4-kitchen-calendar',
      kind: 'record',
      title: 'Kitchen calendar, Church Lane',
      date: 'August 2039',
      author: 'ruth-vey',
      characters: ['ruth-vey'],
      body:
        'This is the calendar on the kitchen wall at No. 14 Church Lane, in Ruth Vey\'s handwriting. Monday 1: her son ' +
        'Elias on the late shift. Tuesday 2: PLUMS!! Thursday 4: street wardens\' meeting, 7 pm, church hall. ' +
        'Friday 5: Elias to the dentist (he will not go; book it anyway). Wednesday 10: siren test (a real one?). ' +
        'Thursday 11: wardens\' meeting. Friday 12 is blank, and so is every day after it. The plums are written in ' +
        'green ink, which in this house means good news.',
    },
  },
  caption: 'Riverside in early August: laundry in every back garden, a light haze over the gasworks.',
  landmarks: [
    {
      id: 'vey-house',
      name: 'No. 14 Church Lane',
      category: 'home',
      bind: { source: 'base', index: 23 },
      bibleRefs: ['ruth-vey', 'elias-vey', 'riverside', 't2033-records-office'],
      label: 'No. 14 · bins Tuesday',
    },
    {
      id: 'pell-house',
      name: 'The Pells\' house, next door',
      category: 'home',
      bind: { source: 'base', index: 25 },
      bibleRefs: ['riverside', 'd2017-levy-vote'],
    },
    {
      id: 'st-brides',
      name: 'St Bride\'s, the church on the hill',
      category: 'community',
      bind: { source: 'base', index: 44 },
      bibleRefs: ['riverside'],
      label: 'Street wardens · Thursdays 7 pm',
    },
    { id: 'gas-holder', name: 'The east gas holder', category: 'extraction', bind: { source: 'base', index: 45 }, bibleRefs: ['riverside'] },
    {
      id: 'level-crossing-train',
      name: 'The train at the level crossing',
      category: 'transport',
      bind: { source: 'base', index: 50 },
      bibleRefs: ['elias-vey', 'riverside'],
    },
    {
      id: 'viaduct',
      name: 'The Gorge Road viaduct',
      category: 'transport',
      bind: { source: 'base', index: 56 },
      bibleRefs: ['riverside', 'gil-harrow'],
      label: '1911',
    },
    {
      id: 'riverside-dam',
      name: 'Riverside dam',
      category: 'water',
      bind: { source: 'base', index: 66 },
      bibleRefs: ['anna-sorel', 'gil-harrow', 't1952-riverside-dam', 'd2009-spillway-deferred', 'd2014-desk-review'],
      label: 'Riverside Water · 1952',
    },
    { id: 'harbour-light', name: 'The harbour light', category: 'community', bind: { source: 'base', index: 78 }, bibleRefs: ['gil-harrow', 'riverside'] },
    {
      id: 'station-court',
      name: 'Station Court',
      category: 'home',
      bind: { source: 'overlay', index: 0 },
      bibleRefs: ['riverside', 'elias-vey'],
      label: 'Station Court · 48 flats',
    },
    {
      id: 'harbour-view',
      name: 'Harbour View flats',
      category: 'home',
      bind: { source: 'overlay', index: 1 },
      bibleRefs: ['riverside', 'gil-harrow'],
    },
    {
      id: 'flood-stone',
      name: 'The flood stone on Mill Street',
      category: 'community',
      bind: { source: 'overlay', index: 2 },
      bibleRefs: ['riverside', 't2017-levy-vote'],
      label: 'HIGH WATER 1891 · 1952 · 2017',
    },
  ],
  overlay: OVERLAY,
  fragments: [
    F({
      id: 'ch4-wardens-list',
      kind: 'notice',
      title: 'Street wardens: Church Lane',
      date: 'March 2036',
      author: 'Riverside Street Wardens',
      characters: ['ruth-vey'],
      when: { always: true },
      priority: 5,
      body:
        'Street wardens for Church Lane: Daniel Okafor at No. 2, Ruth Vey and her daughter at No. 14, and Dorothy ' +
        'Pell at No. 16. If the siren sounds three long notes, knock at every door on your list, even if you know ' +
        'the people are away. When you are sure a house is empty, mark its door with chalk. Yes, chalk. We have ' +
        'tested it in the rain. The school will leave by train, and the children have practised the walk to the ' +
        'station.',
    }),
    F({
      id: 'ch4-vey-house-gone',
      kind: 'memory',
      title: 'No. 14',
      when: { landmark: 'vey-house', status: 'destroyed' },
      priority: 9,
      body:
        'The chalk mark on the door of No. 14 was a circle with a line through it, which meant empty. I drew it ' +
        'myself at ten past six, and then I stood there holding the chalk, because there was nothing left on my ' +
        'list. Left behind in the house were the kitchen calendar, a piano nobody had tuned since 2020, and eleven ' +
        'boxes of this archive that I could not carry. Water cannot read chalk. I have kept the chalk anyway.',
    }),
    F({
      id: 'ch4-kitchen-table-note',
      kind: 'letter',
      title: 'Note from Ruth Vey to her daughter, left on the kitchen table',
      date: '12 August 2039',
      author: 'ruth-vey',
      characters: ['ruth-vey', 'elias-vey'],
      when: { landmark: 'vey-house', status: 'intact' },
      priority: 9,
      body:
        'I have gone with the school. There are plums in the bowl: eat them, because they will not keep. The spare ' +
        'key is where it always is, which everyone in Riverside knows, so there was never much point in hiding it. ' +
        'Your brother Elias is driving the last train tonight. Make sure you are ON it, not organising it. Bring ' +
        'the boxes you can carry and not one more. I mean it. Love, Mum',
    }),
    F({
      id: 'ch4-pells',
      kind: 'memory',
      title: 'Next door',
      when: { landmark: 'pell-house', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'Dorothy Pell, our next-door neighbour, brought shortbread to every wardens\' meeting for three years. She ' +
        'told everyone she had voted against the 2017 flood levy, a yearly charge to pay for flood defences, so ' +
        'that nobody would have to wonder. She had her own roof to fix that year; I have her receipt for it too. ' +
        'She hung her washing out only on windy days, because on still ones the gasworks haze left grey specks on ' +
        'the sheets. She came to every drill and knocked on every door on her list. On the twelfth of August she chalked her ' +
        'own door before I could get to it, and she took the shortbread tin with her.',
    }),
    F({
      id: 'ch4-levy-result',
      kind: 'record',
      title: 'Result of the Riverside flood levy vote',
      date: '2017',
      author: 'Riverside Town Council',
      when: { destroyedAtLeast: 6, categories: ['home'] },
      priority: 7,
      body:
        'The question: should every household in Riverside pay a yearly charge to build a flood wall for the lower ' +
        'town and to raise the spillway of the dam (the channel that lets extra water flow safely past it)? Yes: ' +
        '1,402. No: 1,618. Invalid votes: 9. On the back of one invalid ballot paper, someone had written in blue ' +
        'pen: "I would if I could." The flood wall was finally built in 2036, paid for by the national government. ' +
        'It was built to the design first proposed in 2009.',
    }),
    F({
      id: 'ch4-harrow-letter',
      kind: 'letter',
      title: 'Letter from Gil Harrow, former leader of the town council',
      date: 'March 2038',
      author: 'gil-harrow',
      characters: ['gil-harrow'],
      when: { landmark: 'riverside-dam', status: ['destroyed', 'damaged'] },
      priority: 8,
      body:
        'Dear Miss Vey, at the meeting you asked whether I would say on the record why the dam\'s spillway was not ' +
        'raised in 2009 or in 2016. I said I would think about it. I have. It was put off because the national ' +
        'inspectors called the dam satisfactory, because the harbour needed dredging, because the school roof ' +
        'leaked, and because I believed we had time. Three of those reasons were true. Yours, as ever, Gil Harrow',
    }),
    F({
      id: 'ch4-dam-inspection',
      kind: 'report',
      title: 'Riverside dam, inspection',
      date: 'June 2037',
      author: 'Vell Valley Water Board',
      characters: ['anna-sorel'],
      when: { landmark: 'riverside-dam', status: 'intact' },
      priority: 7,
      body:
        'The top of the dam is in good condition. The spillway can still carry only as much water as it could when ' +
        'the dam was built in 1952. Recommendation, made for the eighth time: raise the spillway. [Added below in ' +
        'pencil by Anna Sorel, the Water Board\'s engineer, four years after she retired: It held today. That does ' +
        'not mean it will hold tomorrow.]',
    }),
    F({
      id: 'ch4-church-hall',
      kind: 'memory',
      title: 'St Bride\'s hall, Thursdays',
      when: { landmark: 'st-brides', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'The street wardens met in St Bride\'s church hall every Thursday at seven. The tea urn had to be switched ' +
        'on at half past six. We spread maps across folding tables and marked every street in a different colour of ' +
        'highlighter; Church Lane was green, because my mother got there first. Daniel Okafor took the minutes in a ' +
        'shorthand nobody else could read, and then read them back to us, beautifully, every week.',
    }),
    F({
      id: 'ch4-church-notices',
      kind: 'notice',
      title: 'Notice on the door of St Bride\'s church',
      date: 'August 2039',
      when: { landmark: 'st-brides', status: 'intact' },
      priority: 6,
      body:
        'The street wardens\' meeting on Thursday is cancelled, for reasons you all know. The church hall will stay ' +
        'open as a place to rest until the last train leaves. The tea urn will be on from five o\'clock. Please take ' +
        'a biscuit, or two. If you have lost something, look on the table by the door. To whoever left a cello ' +
        'here: we cannot take it on the train, but we have carried it upstairs, out of the water\'s way.',
    }),
    F({
      id: 'ch4-drivers-log',
      kind: 'record',
      title: 'Driver\'s log, valley line',
      date: '12 August 2039',
      author: 'elias-vey',
      characters: ['elias-vey'],
      when: { landmark: 'level-crossing-train', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'The 07:10 train from Riverside to Carran. I uncoupled the three empty wagons at the back and left them at ' +
        'the level crossing, to save four minutes. We still left four minutes late, at 07:14, because someone was ' +
        'loading a bassoon. Passengers: the whole school, 212 other people, and a man with a goat that he said was ' +
        'a dog. I did not argue. The line was clear all the way to Carran. Note to myself: tell my sister that the ' +
        '21:52 is the last train and I will not wait for her. (I will wait.)',
    }),
    F({
      id: 'ch4-light-touch',
      kind: 'memory',
      title: 'Your route through town',
      when: { all: [{ destroyedAtMost: 3, categories: ['home'] }, { outcome: 'complete' }] },
      priority: 6,
      body:
        'You came through Riverside and broke very few of its houses. I keep walking your route in my head, street ' +
        'by street. It looks like the map I would have drawn if anyone had asked me which parts of the town to keep: ' +
        'Church Lane, the school, the bakery with the blue door. Water cannot choose where it goes. Something ' +
        'steering it can choose a little, and it seems that you did.',
    }),
    F({
      // Station Court is overlay placement 0 (landmark station-court); gated on the block itself.
      id: 'ch4-station-court',
      kind: 'record',
      title: 'Station Court, warden\'s sheet',
      date: '12 August 2039',
      when: { landmark: 'station-court', status: 'destroyed' },
      priority: 5,
      body:
        'Station Court, flats 1 to 48. Warden: Sean Duffy, flat 2. I started knocking at 05:40, from the top floor ' +
        'down, and by 06:50 all 48 doors were chalked as empty. Notes: the woman in flat 17 has gone to her ' +
        'sister\'s and left her pet bird with the family in flat 18, who have taken it on the school train. Flat 40 ' +
        'asks for someone to water the tomatoes. [The archivist\'s pencil note at the bottom of the sheet: Station Court was built in 2027 for ' +
        'railway and power plant workers. It was the newest block in Riverside, and the tallest. A block of flats ' +
        'scores a lot of points. This sheet is what those points stood for.]',
    }),
  ],
  fallbackReflections: [
    F({
      id: 'ch4-reflection-house-gone',
      kind: 'reflection',
      title: 'Riverside',
      when: { landmark: 'vey-house', status: 'destroyed' },
      priority: 6,
      body:
        'You went down Church Lane and through No. 14, and your points went up the way they are meant to. I have ' +
        'thought about how to write this part, and I have decided to write it plainly. That was my house. It had a ' +
        'piano, a kitchen calendar, a front room full of boxes, and a chalk mark on the door that meant empty. It ' +
        'was empty. My mother was on a train with her school, timing the journey with her stopwatch. That summer ' +
        'the river below the town ran greyer than my grandmother remembered it, and when the wind dropped the ' +
        'gasworks left a haze over the lower town. I am not ' +
        'telling you this to make you sorry. The water came down Church Lane in the end; you only showed me what it ' +
        'looked like.',
    }),
    F({
      id: 'ch4-reflection-house-stands',
      kind: 'reflection',
      title: 'Riverside',
      when: { landmark: 'vey-house', status: 'intact' },
      priority: 6,
      body:
        'You missed No. 14. I do not know if you meant to. I like to think you saw the chalk circle on the door and ' +
        'decided that an empty house had been through enough. It was my house, if you had not guessed: an untuned ' +
        'piano, a kitchen calendar, and eleven boxes of this archive in the front room. Not everything was well, ' +
        'even so: the river ran greyer every summer, and on windless days the gasworks smoke hung over the lower ' +
        'streets. The people of Riverside were ' +
        'not careless. They voted, argued, practised, and knocked on doors with chalk in their pockets. Some voted ' +
        'against the flood levy because they had roofs of their own to fix. All of them got out.',
    }),
    F({
      id: 'ch4-reflection',
      kind: 'reflection',
      title: 'Riverside',
      when: { always: true },
      priority: 0,
      body:
        'Riverside was my town, and mostly it knew how to look after itself. It had a school that practised walking ' +
        'to the station, a church hall with a tea urn, a council leader, Gil Harrow, who remembered every child\'s ' +
        'name, a dam that every inspector called satisfactory, and a spillway that nobody paid to raise. If you want ' +
        'a villain, you will have to bring your own. What I have is a kitchen calendar, the result of a vote on a ' +
        'flood levy, and a letter in which Gil Harrow admits that not all of his reasons for waiting were true. By ' +
        'then the river was greyer than in my grandmother\'s photographs, and on still days a haze from the ' +
        'gasworks lay over the lower town. The town was not one decision. It was a few thousand small ones, and a ' +
        'few large ones made far away.',
    }),
  ],
  aiReflection: true,
  music: 'cost',
};
