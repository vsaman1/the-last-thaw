import { BUILT_CATEGORIES, type ChapterDef, type StoryOverlay } from '../types';
import { fragmentsOf, type OverlayRequest } from './authoring';

/**
 * CHAPTER 5 — "The Denial" (Act II, The Cost). Level 5, Glacier Avalanche: Kessel, a dairy village on
 * the avalanche track below the glacier lake, and the 1958 dam only a grown iceberg can burst. The
 * level's mechanic (you grow by swallowing ice until you are heavy enough to break the dam) is the
 * chapter's metaphor: delay accumulates. Denial here is not anyone saying no; it is minutes, polite
 * ministerial letters and a board resolution that says "not the company's role". Ines Moreno appears.
 *
 * Base placements used (src/core/levels/glacierAvalanche.ts): 26 skiLiftPylon s 880 d 72, 28 chalet
 * s 950 d -20, 29 barn s 990 d -23, 30 chalet s 1028 d -18, 31 chalet s 968 d 9, 35 silo s 990 d 47,
 * 39 dam s 1215 span 38.9.
 */

const F = fragmentsOf('ch5-denial');

export const OVERLAY_REQUESTS: readonly OverlayRequest[] = [
  {
    kind: 'pipeline',
    near: 's≈820-840, across the slope d≈-60 to 60 on supports, below icefall band 2 (s 760) and above the forest belt (s 865)',
    purpose: 'Calder\'s 2019 coastal gas pipeline, routed straight across the avalanche track because it was the cheapest line.',
    landmark: { id: 'kessel-pipeline', name: 'Calder\'s coastal pipeline', label: 'CALDER ENERGY · HIGH PRESSURE GAS' },
  },
  {
    kind: 'monument',
    near: 's≈1000 d≈20, in the village between the main street (d -6) and the farm track (d 38)',
    purpose: 'The 1890 ice-edge stone: where the glacier stood once, now a long walk below it. Tourists photograph it.',
    landmark: { id: 'ice-stone', name: 'The 1890 ice-edge stone', label: 'THE ICE STOOD HERE · 1890' },
  },
  {
    kind: 'apartmentBlock',
    near: 's≈1040 d≈30, at the lower end of the village where the farm track ends, above the rock band (s 1062)',
    purpose: 'Kessel Lodge, holiday flats built in 2016 for skiers: empty most of the year, and on the line.',
    landmark: { id: 'kessel-lodge', name: 'Kessel Lodge' },
  },
  {
    kind: 'tank',
    near: 's≈850 d≈95, beside the right forest route\'s ice fields, where the pipeline\'s valve station would stand',
    purpose: 'The pipeline\'s valve station: a little more extraction in the thaw\'s path.',
  },
];

/*
 * OVERLAY (level design, Act II "The Cost"). Placements are appended after the base obstacles, so the
 * base indices above stay valid; overlay index → landmark:
 *   0 pipeline       s 825   d -62…122 Calder's coastal pipeline (kessel-pipeline): straight across
 *                                    the avalanche track between the steep line fields (s 800 / 850)
 *                                    and the right forest fields, from the river's right bank (where
 *                                    it goes under the river, 5 m off its bank) to d 122, the valve
 *                                    station beyond: every tested way down past band 2 crosses it
 *   1 monument       s 1000  d 17    the 1890 ice-edge stone (ice-stone): in the village between the
 *                                    main street and the farm track, below the cross road
 *   2 apartmentBlock s 1036  d 28    Kessel Lodge (kessel-lodge): at the end of the farm track, 13 m
 *                                    above the rock band's lip, where the right-hand ways through the
 *                                    village funnel into the gorge
 *   3 tank           s 834   d 128   the valve station (unnamed), beside the pipeline's right end,
 *                                    off the right forest route
 * Site checks: no placement on a road (the pipeline stays 96 m from the nearest one, the stone 18.5 m
 * off the farm track, the Lodge's 26 × 12 m footprint 1.5 m from the track's end); |d| + radius
 * inside the half-width everywhere (the Lodge 42.5 of 73 m).
 * MEASURED (src/story/chapters/overlays.act2.test.ts: real sessions, autopilot, story level; the base
 * level on the same line in brackets). Bodies 175 (base 149, +26: the pipeline is 23 segments).
 *   line    complete 97.0 s, 18 → 90 t (peak 105 t), 2220 pts: the pipeline, 2 chalets, the barn, the
 *           dam. The guesthouse, the lift, the silo, the ice stone (38 m) and Kessel Lodge (37 m)
 *           stand: the careful way. [96.6 s, 1420 pts: no pipeline]
 *   centre  complete 98.8 s, peak 108 t, 2640 pts: the pipeline, a lift pylon, a barn, a fence, Kessel
 *           Lodge, the dam; the ice stone stands (14 m). [91.5 s, 1240 pts: the silo, not the Lodge]
 * The pipeline costs both ways 800 points; the Lodge is a choice: the centre route breaks it, the
 * line leaves it standing.
 */
const OVERLAY: StoryOverlay = {
  obstacles: [
    { kind: 'pipeline', s: 825, d: 30, span: 184 },
    { kind: 'monument', s: 1000, d: 17 },
    { kind: 'apartmentBlock', s: 1036, d: 28 },
    { kind: 'tank', s: 834, d: 128 },
  ],
};

export const CH5: ChapterDef = {
  id: 'ch5-denial',
  index: 5,
  levelId: 'glacier-avalanche',
  act: 2,
  actTitle: 'The Cost',
  title: 'The Denial',
  intro: {
    lines: [
      'Kessel sits on the avalanche track below the glacier lake, as it always has.',
      'In 2024 an engineer said its dam was too small for what was coming.',
      'Everyone agreed. That was the easy part.',
    ],
    document: {
      id: 'ch5-kessel-report',
      kind: 'report',
      title: 'Kessel dam: spillway adequacy (summary for the Board)',
      date: 'October 2024',
      author: 'anna-sorel',
      characters: ['anna-sorel'],
      body:
        'The glacier lake above Kessel now holds about four times as much water as it did in 1998. The spillway of ' +
        'the Kessel dam, the channel that carries extra water safely past it, was built in 1958 for melting snow, ' +
        'not for a lake. If the lake empties suddenly, water will pour over the top of the dam within hours. We ' +
        'recommend making the spillway bigger. The work would take two summers, and the national government would ' +
        'share the cost under its 2022 funding scheme. Please note: since the election, that scheme is being ' +
        'reviewed. Anna Sorel, engineer',
    },
  },
  caption: 'Kessel. Above the village, out of sight, the lake is filling.',
  landmarks: [
    {
      id: 'kessel-dam',
      name: 'The Kessel dam',
      category: 'water',
      bind: { source: 'base', index: 39 },
      bibleRefs: ['anna-sorel', 'kessel', 't2024-kessel-report', 'd2024-cofunding-withdrawn'],
      label: '1958 · spillway works postponed',
    },
    { id: 'dairy-chalet', name: 'The dairy chalet on the main street', category: 'home', bind: { source: 'base', index: 28 }, bibleRefs: ['kessel'] },
    { id: 'kessel-barn', name: 'The Kessel hay barn', category: 'farm', bind: { source: 'base', index: 29 }, bibleRefs: ['kessel'] },
    { id: 'kessel-guesthouse', name: 'The guesthouse across the street', category: 'home', bind: { source: 'base', index: 31 }, bibleRefs: ['kessel'] },
    { id: 'gorge-chalet', name: 'The last chalet before the gorge', category: 'home', bind: { source: 'base', index: 30 }, bibleRefs: ['kessel'] },
    { id: 'kessel-lift', name: 'The summer lift', category: 'transport', bind: { source: 'base', index: 26 }, bibleRefs: ['kessel'] },
    { id: 'coop-silo', name: 'The co-operative silo', category: 'industry', bind: { source: 'base', index: 35 }, bibleRefs: ['kessel'] },
    {
      id: 'kessel-pipeline',
      name: 'Calder\'s coastal pipeline',
      category: 'extraction',
      bind: { source: 'overlay', index: 0 },
      bibleRefs: ['kessel', 't2019-pipeline', 'd2019-pipeline-route', 'd2019-pipeline-permit'],
      label: 'CALDER ENERGY · HIGH PRESSURE GAS',
    },
    {
      id: 'ice-stone',
      name: 'The 1890 ice-edge stone',
      category: 'community',
      bind: { source: 'overlay', index: 1 },
      bibleRefs: ['kessel', 't1890-ice-stone'],
      label: 'THE ICE STOOD HERE · 1890',
    },
    { id: 'kessel-lodge', name: 'Kessel Lodge', category: 'home', bind: { source: 'overlay', index: 2 }, bibleRefs: ['kessel'] },
  ],
  overlay: OVERLAY,
  fragments: [
    F({
      id: 'ch5-board-minutes',
      kind: 'record',
      title: 'Water Board minutes, item 7',
      date: 'March 2025',
      author: 'Vell Valley Water Board',
      when: { always: true },
      priority: 5,
      body:
        'Item 6: farmers from Kessel asked why the lower pastures now turn yellow by July, and why the haze from ' +
        'the valley reaches the village on still days. The Board noted both questions. ' +
        'Item 7: the Kessel dam spillway. The Board read the engineer\'s report and agreed with what it said. ' +
        'Because the national government has withdrawn its share of the money, the Board decided to postpone the ' +
        'work to a future building budget, to keep the matter under review, and to write to the Ministry. Action: ' +
        'the Chair will write to the Ministry. Item 8: the Christmas lights.',
    }),
    F({
      id: 'ch5-ministry-reply',
      kind: 'letter',
      title: 'Reply from the Ministry',
      date: 'September 2025',
      author: 'Ministry of Infrastructure',
      when: { always: true },
      priority: 4,
      body:
        'Thank you for your letter of 14 April about the Kessel dam. The Minister understands how important strong ' +
        'dams and roads are to mountain communities. The funding priorities for this period were set after a full ' +
        'review, and the Minister is not able to make an exception at this time. You may wish to apply again in ' +
        'the next funding round, which opens in 2028.',
    }),
    F({
      id: 'ch5-public-question',
      kind: 'record',
      title: 'Water Board minutes, public session',
      date: 'March 2025',
      author: 'Vell Valley Water Board',
      characters: ['tomas-lind'],
      when: { always: true },
      priority: 3,
      body:
        'A member of the public asked to read aloud, for the official record, a page of Dr Tomas Lind\'s field ' +
        'notebook about the Kessel lake. She asked for her name to be left out of the minutes, saying, "It is not ' +
        'about me." The Chair agreed, and reminded her of the three-minute limit. She read for three minutes, and ' +
        'the Chair thanked her. She asked what the Board would do. The Chair pointed her to item 7 of today\'s ' +
        'minutes. She said she had read item 7, and that was why she was asking.',
    }),
    F({
      id: 'ch5-moreno-memo',
      kind: 'report',
      title: 'Internal memo: the Kessel spillway',
      date: 'May 2027',
      author: 'ines-moreno',
      characters: ['ines-moreno'],
      when: { landmark: 'kessel-dam', status: ['destroyed', 'damaged'] },
      priority: 8,
      body:
        'To the Board of Calder Energy. Our gas pipeline crosses the path that avalanches take down the slope above ' +
        'Kessel. If water ever pours over the Kessel dam, the flood will follow that same path. Option A: do ' +
        'nothing, and wait for our insurers to notice. Option B: share the cost of a bigger spillway with the Water ' +
        'Board. It would cost about what we spend on the yearly shareholders\' dinner (I checked). Option B also ' +
        'moves our tank farm up to higher ground. I can see the case for A: it is cheaper this year, and every ' +
        'year. I recommend Option B. Ines Moreno, regional director',
    }),
    F({
      id: 'ch5-calder-resolution',
      kind: 'record',
      title: 'Calder Energy, board resolution 2027/14',
      date: 'June 2027',
      author: 'Calder Energy',
      when: { destroyedAtLeast: 1, categories: ['extraction'] },
      priority: 7,
      body:
        'The board thanks the regional director for her memo and has decided three things. First, to raise the ' +
        'earth wall around the Power Valley tank farm by one metre. Second, that paying towards public works such ' +
        'as dams is not the company\'s role. Third, to review the route of the pipeline at its next major repair, ' +
        'which is planned for 2041.',
    }),
    F({
      id: 'ch5-dam-held',
      kind: 'memory',
      title: 'What the dam held',
      when: { landmark: 'kessel-dam', status: 'intact' },
      priority: 8,
      body:
        'The Kessel dam was still holding back the lake when you passed. It was holding up a pile of paperwork as ' +
        'well: a spillway built in 1958, a report in 2024 saying it was too small, minutes in 2025 that postponed ' +
        'the work, a memo in 2027 asking Calder Energy to help pay, and the company\'s answer that it was not their ' +
        'role. That is a lot to rest on one wall. People do that with walls; they keep leaning things against them.',
    }),
    F({
      id: 'ch5-lake-walk',
      kind: 'record',
      title: 'Field notebook: the Kessel lake',
      date: 'September 2024',
      author: 'tomas-lind',
      characters: ['tomas-lind', 'anna-sorel'],
      when: { grewAtLeast: 2 },
      priority: 6,
      body:
        'Walked up to the Kessel lake today with Anna Sorel. The water has worn away the bank of rock on its left ' +
        'side, and the lake is twice the size I drew it in 1998. We stood and looked at it the way you look at an ' +
        'animal that has grown bigger than you were told it would. Anna said, "It is not a lake, it is a line in a ' +
        'budget." I said, "It is both." She wrote that down.',
    }),
    F({
      id: 'ch5-ice-stone-photo',
      kind: 'caption',
      title: 'Photograph, 2015',
      when: { grewAtLeast: 1.5 },
      priority: 3,
      body:
        'Tourists in bright jackets stand around a stone in the middle of Kessel, carved THE ICE STOOD HERE, 1890. ' +
        'Behind them, far up the valley, the glacier is a thin white line under the ridge.',
    }),
    F({
      id: 'ch5-dairy',
      kind: 'memory',
      title: 'The dairy',
      when: { landmark: 'dairy-chalet', status: ['destroyed', 'damaged'] },
      priority: 5,
      body:
        'The dairy in Kessel made a hard yellow cheese that tasted faintly of the hay barn. Every summer the family ' +
        'took the cows up to the high pasture, and the chalet stood empty with a sign in the window: UP AT THE ' +
        'SUMMER PASTURE. RING THE BELL ANYWAY. By then the lower pasture was yellowing by July, so every year the ' +
        'cows went up a little earlier and a little higher. The sign was in the window in August 2039, and the bell ' +
        'was hanging by the door, as it always was.',
    }),
    F({
      id: 'ch5-guestbook',
      kind: 'record',
      title: 'Guestbook, the guesthouse across the street',
      date: '2009-2039',
      when: { landmark: 'kessel-guesthouse', status: 'intact' },
      priority: 5,
      body:
        'Four entries from the guestbook: "Lovely view of the glacier!" (2009). "Lovely view of where the glacier ' +
        'used to be!" (2021). "Sorry about the towel." (2031). "A bit hazy for photographs, but the cheese made up ' +
        'for it." (2036). The last entry was written by the owner in August 2039: "Closed. The keys are with the ' +
        'Water Board. Thank you all for coming, and for the towel."',
    }),
    F({
      id: 'ch5-pipeline-courier',
      kind: 'newspaper',
      title: 'Pipeline route approved',
      date: 'June 2019',
      author: 'Riverside Courier',
      when: { destroyedAtLeast: 5, categories: BUILT_CATEGORIES },
      priority: 4,
      body:
        'The Vell Valley Water Board has approved Calder Energy\'s route for its new coastal gas pipeline, which ' +
        'will cross the avalanche path above Kessel on raised supports. Residents had asked for a longer route ' +
        'around the avalanche path. Calder said its own risk assessment found a damaging avalanche "very unlikely ' +
        'during the pipeline\'s working life". The longer route would have taken eleven months more and cost an ' +
        'amount the company would not reveal.',
    }),
    F({
      id: 'ch5-keepers-log',
      kind: 'record',
      title: 'Kessel dam, keeper\'s log',
      date: '9 August 2039',
      when: { outcome: 'failed' },
      priority: 7,
      body:
        'The lake rose forty centimetres overnight, and the spillway is running full. I phoned the Water Board\'s ' +
        'night line and was told to keep watching. I phoned again when the day line opened and was told to ' +
        'evacuate. The village bell was rung at 06:10, and the last car left for the valley at 07:35. I have locked ' +
        'the office and I am taking this logbook with me. Somebody will want to read it.',
    }),
  ],
  fallbackReflections: [
    F({
      id: 'ch5-reflection-dam-gone',
      kind: 'reflection',
      title: 'Kessel',
      when: { landmark: 'kessel-dam', status: 'destroyed' },
      priority: 6,
      body:
        'You hit the Kessel dam with all the ice you had gathered on the way down, and it gave way. That is more or ' +
        'less what Anna Sorel\'s 2024 report said would happen if something big enough arrived. I want to be fair to ' +
        'the people who read that report. They agreed with it. They recorded it in their minutes. They wrote to the ' +
        'Ministry, and the Ministry wrote back very politely. Ines Moreno asked Calder\'s board for the price of one ' +
        'dinner, and got a higher wall around some fuel tanks instead. Denial is rarely anyone saying no. It is ' +
        'everyone saying yes, but later.',
    }),
    F({
      id: 'ch5-reflection-dam-stands',
      kind: 'reflection',
      title: 'Kessel',
      when: { landmark: 'kessel-dam', status: 'intact' },
      priority: 6,
      body:
        'The Kessel dam stood when you came through. I am not sure what to tell you about Kessel. The dairy, the ' +
        'guesthouse and the hay barn were places people loved, built on a slope that avalanches had used for longer ' +
        'than people had lived there. The dam was the only thing between them and the lake, and everyone knew it ' +
        'was too small. That knowledge sat safely in a drawer for fifteen years. Some September, somebody will ' +
        'measure the lake again and write the number down.',
    }),
    F({
      id: 'ch5-reflection',
      kind: 'reflection',
      title: 'Kessel',
      when: { always: true },
      priority: 0,
      body:
        'If I had to describe Kessel in one word, it would be postponed. The new spillway was not refused or ' +
        'ignored. It was postponed: to the next building budget, the next funding round, the next major repair. ' +
        'Every delay seemed reasonable on the day it was decided, and the minutes prove it. You grew on the way ' +
        'down; every field of ice you swallowed made you heavier and harder to stop. The delays worked the same way. ' +
        'Each one was small, but they added up, year after year, just as the ice did.',
    }),
  ],
  aiReflection: false,
  music: 'cost',
};
