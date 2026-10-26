/**
 * THE LAST THAW — pilot-study instrument: every question the optional before/after surveys ask, in
 * display order, with the codebook data an analyst needs (scale anchors, reverse-keyed items, the
 * SUS items the usability block adapts, and each factual question's answer key with its source).
 *
 * Why it is data and not JSX: the same list drives the form, the storage sanitiser (only known item
 * ids and in-range values survive a reload), the CSV columns and the JSON codebook, so the four can
 * never disagree. Change the wording and you must bump INSTRUMENT_VERSION: stored answers carry the
 * version they were given under, and a pre/post comparison is only valid within one version.
 *
 * Anonymity by construction: the only free-text items are the two `open` questions of the after-play
 * survey. Nothing asks for a name, email, age, location or anything else that identifies a person
 * (pilot.test.ts enforces this).
 */
import type { SourceOrg } from '../../story/types';

/**
 * Bump whenever an item's wording, options or order changes. Stored with every response.
 * - pilot-2: em2 names the score as the game now does ("Topple points", was "destruction points").
 */
export const INSTRUMENT_VERSION = 'last-thaw-pilot-2';

export type Phase = 'pre' | 'post';

export type ItemBlock = 'context' | 'attitude' | 'factual' | 'usability' | 'emotion' | 'open';

/** Five-point agreement scale shared by every Likert item: value 1..5, anchors in this order. */
export const LIKERT_LABELS = [
  'Strongly disagree',
  'Disagree',
  'Neither agree nor disagree',
  'Agree',
  'Strongly agree',
] as const;

export const LIKERT_POINTS = LIKERT_LABELS.length;

interface BaseItem {
  /** Stable id; also the CSV column name, so snake_case and never reused for another wording. */
  readonly id: string;
  readonly block: ItemBlock;
  readonly text: string;
  /** Surveys that ask it. Attitude and factual items are in both, for the pre/post comparison. */
  readonly phases: readonly Phase[];
}

export interface LikertItem extends BaseItem {
  readonly type: 'likert';
  /** Negatively worded: agreement means the opposite of the construct. Stored raw, not flipped. */
  readonly reverse?: boolean;
  /** Which System Usability Scale item (Brooke 1996, items 1..10) this adapts, if any. */
  readonly susItem?: number;
}

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
}

export interface ChoiceItem extends BaseItem {
  readonly type: 'choice';
  readonly options: readonly ChoiceOption[];
}

/** Where a factual answer key comes from: checked by fetching the page on `accessed`. */
export interface FactSource {
  readonly org: SourceOrg;
  readonly title: string;
  readonly url: string;
  /** ISO date the page was read. */
  readonly accessed: string;
  /** The sentence(s) on the page that settle the answer, verbatim. */
  readonly quote: string;
}

export interface FactualItem extends Omit<ChoiceItem, 'type'> {
  readonly type: 'factual';
  /** Option id of the correct answer. 'unsure' is always offered and is never correct. */
  readonly correct: string;
  readonly source: FactSource;
}

export interface OpenItem extends BaseItem {
  readonly type: 'open';
  readonly maxLength: number;
}

export type PilotItem = LikertItem | ChoiceItem | FactualItem | OpenItem;

/** Offered on every factual question: an honest "don't know" is better data than a guess. */
export const UNSURE: ChoiceOption = { id: 'unsure', label: 'Not sure' };

/** Upper bound for an open answer (characters). Long enough for a paragraph, short enough to scan. */
export const OPEN_MAX_LENGTH = 1000;

const BOTH: readonly Phase[] = ['pre', 'post'];
const POST: readonly Phase[] = ['post'];
const ACCESSED = '2026-10-21';

const IPCC_SYR_HEADLINES: Omit<FactSource, 'quote'> = {
  org: 'IPCC',
  title: 'AR6 Synthesis Report: Summary for Policymakers Headline Statements',
  url: 'https://www.ipcc.ch/report/ar6/syr/resources/spm-headline-statements/',
  accessed: ACCESSED,
};

export const ITEMS: readonly PilotItem[] = [
  // --- context (after play only): how much of the story the answers are about -------------------
  {
    id: 'ctx_story_played',
    block: 'context',
    type: 'choice',
    phases: POST,
    text: 'How much of Story Mode did you play in this session?',
    options: [
      { id: 'none', label: 'None of it' },
      { id: 'ch1_3', label: 'Chapters 1–3' },
      { id: 'ch4_6', label: 'Up to chapter 4, 5 or 6' },
      { id: 'ch7_9', label: 'Up to chapter 7, 8 or 9' },
      UNSURE,
    ],
  },

  // --- attitudes: climate risk and the human consequences of environmental decisions -------------
  {
    id: 'att1_affects_people',
    block: 'attitude',
    type: 'likert',
    phases: BOTH,
    text: 'Climate change will seriously affect people’s lives during my lifetime.',
  },
  {
    id: 'att2_past_decisions',
    block: 'attitude',
    type: 'likert',
    phases: BOTH,
    text: 'Decisions about energy and land made decades ago still shape people’s lives today.',
  },
  {
    id: 'att3_irreversible',
    block: 'attitude',
    type: 'likert',
    phases: BOTH,
    text: 'Some environmental damage cannot be undone once it has happened.',
  },
  {
    id: 'att4_unequal_harm',
    block: 'attitude',
    type: 'likert',
    phases: BOTH,
    text: 'The people most harmed by environmental damage are often not the ones who caused most of it.',
  },
  {
    // Reverse-keyed on purpose: one item where agreeing is the "delay" position catches answering
    // "agree" down the whole page without reading.
    id: 'att5_wait_for_certainty',
    block: 'attitude',
    type: 'likert',
    phases: BOTH,
    reverse: true,
    text: 'It is reasonable to wait for more certainty before acting on environmental warnings.',
  },
  {
    id: 'att6_communities_matter',
    block: 'attitude',
    type: 'likert',
    phases: BOTH,
    text: 'What happens to communities affected by environmental decisions matters to me personally.',
  },
  {
    id: 'att7_choices_now',
    block: 'attitude',
    type: 'likert',
    phases: BOTH,
    text: 'Choices made now can still change how severe future consequences will be.',
  },

  // --- factual: answer keys from NASA / NOAA / IPCC pages, each read on ACCESSED ----------------
  {
    id: 'fact1_co2_ppm',
    block: 'factual',
    type: 'factual',
    phases: BOTH,
    text:
      'Before the Industrial Revolution, carbon dioxide in the atmosphere was about 280 parts per ' +
      'million (ppm). Roughly what was the global average in 2024?',
    options: [
      { id: 'a', label: 'About 290 ppm' },
      { id: 'b', label: 'About 340 ppm' },
      { id: 'c', label: 'About 420 ppm' },
      { id: 'd', label: 'About 600 ppm' },
      UNSURE,
    ],
    correct: 'c',
    source: {
      org: 'NOAA',
      title: 'Climate change: atmospheric carbon dioxide (NOAA Climate.gov)',
      url: 'https://www.climate.gov/news-features/understanding-climate/climate-change-atmospheric-carbon-dioxide',
      accessed: ACCESSED,
      quote:
        'Based on the annual analysis from NOAA’s Global Monitoring Lab, global average atmospheric ' +
        'carbon dioxide was 422.8 parts per million (“ppm,” for short) in 2024, a new record high. ' +
        'Before the Industrial Revolution started in the mid-1700s, atmospheric carbon dioxide was ' +
        '280 ppm or less.',
    },
  },
  {
    id: 'fact2_warming',
    block: 'factual',
    type: 'factual',
    phases: BOTH,
    text: 'Compared with 1850–1900, about how much warmer was the global surface in 2011–2020?',
    options: [
      { id: 'a', label: 'About 0.1 °C' },
      { id: 'b', label: 'About 1.1 °C' },
      { id: 'c', label: 'About 3 °C' },
      { id: 'd', label: 'About 5 °C' },
      UNSURE,
    ],
    correct: 'b',
    source: {
      ...IPCC_SYR_HEADLINES,
      quote:
        'A.1 Human activities, principally through emissions of greenhouse gases, have unequivocally ' +
        'caused global warming, with global surface temperature reaching 1.1°C above 1850–1900 in ' +
        '2011–2020.',
    },
  },
  {
    id: 'fact3_main_cause',
    block: 'factual',
    type: 'factual',
    phases: BOTH,
    text: 'What is the main driver of the global warming observed since the mid-20th century?',
    options: [
      { id: 'a', label: 'Changes in the Sun’s energy output' },
      { id: 'b', label: 'Volcanic eruptions' },
      { id: 'c', label: 'Natural cycles in the ocean' },
      { id: 'd', label: 'Human activities, chiefly greenhouse-gas emissions' },
      UNSURE,
    ],
    correct: 'd',
    source: {
      org: 'NASA',
      title: 'The Causes of Climate Change (NASA Science)',
      url: 'https://science.nasa.gov/climate-change/causes/',
      accessed: ACCESSED,
      quote:
        'Human activities are driving the global warming trend observed since the mid-20th century. ' +
        '… While the Sun has played a role in past climate changes, the evidence shows the current ' +
        'warming cannot be explained by the Sun.',
    },
  },
  {
    id: 'fact4_sea_level_committed',
    block: 'factual',
    type: 'factual',
    phases: BOTH,
    text: 'What does the IPCC conclude about global sea level over the long term?',
    options: [
      {
        id: 'a',
        label:
          'It is committed to rise for centuries to millennia, and will stay elevated for ' +
          'thousands of years',
      },
      { id: 'b', label: 'It will stop rising within a few years once emissions fall' },
      { id: 'c', label: 'It will return to its 1900 level by 2100' },
      { id: 'd', label: 'It is expected to fall as the climate warms' },
      UNSURE,
    ],
    correct: 'a',
    source: {
      org: 'IPCC',
      title: 'IPCC AR6 Working Group I: Summary for Policymakers',
      url: 'https://www.ipcc.ch/report/ar6/wg1/chapter/summary-for-policymakers/',
      accessed: ACCESSED,
      quote:
        'B.5.4 In the longer term, sea level is committed to rise for centuries to millennia due to ' +
        'continuing deep-ocean warming and ice-sheet melt and will remain elevated for thousands of ' +
        'years (high confidence).',
    },
  },
  {
    id: 'fact5_unequal_impacts',
    block: 'factual',
    type: 'factual',
    phases: BOTH,
    text: 'According to the IPCC, who is disproportionately affected by climate change?',
    options: [
      { id: 'a', label: 'Everyone is affected about equally' },
      { id: 'b', label: 'Vulnerable communities who have historically contributed the least to it' },
      { id: 'c', label: 'Mostly the communities that have emitted the most' },
      { id: 'd', label: 'Nobody yet: the impacts are still in the future' },
      UNSURE,
    ],
    correct: 'b',
    source: {
      ...IPCC_SYR_HEADLINES,
      quote:
        'A.2 … Human-caused climate change is already affecting many weather and climate extremes in ' +
        'every region across the globe. … Vulnerable communities who have historically contributed ' +
        'the least to current climate change are disproportionately affected (high confidence).',
    },
  },

  // --- usability: five System Usability Scale items (Brooke 1996), worded for a game ------------
  // A short form, NOT the 10-item SUS: no 0–100 SUS score is computed or claimed. Odd SUS items are
  // positive and even ones negative, so the mix of directions is kept.
  {
    id: 'us1_play_again',
    block: 'usability',
    type: 'likert',
    phases: POST,
    susItem: 1,
    text: 'I think I would like to play this game again.',
  },
  {
    id: 'us2_complex',
    block: 'usability',
    type: 'likert',
    phases: POST,
    susItem: 2,
    reverse: true,
    text: 'I found the game unnecessarily complex.',
  },
  {
    id: 'us3_easy',
    block: 'usability',
    type: 'likert',
    phases: POST,
    susItem: 3,
    text: 'I thought the game was easy to play.',
  },
  {
    id: 'us4_confident',
    block: 'usability',
    type: 'likert',
    phases: POST,
    susItem: 9,
    text: 'I felt very confident playing the game.',
  },
  {
    id: 'us5_learn_a_lot',
    block: 'usability',
    type: 'likert',
    phases: POST,
    susItem: 10,
    reverse: true,
    text: 'I needed to learn a lot of things before I could get going with the game.',
  },

  // --- emotional engagement: did discovery, not instruction, carry the feeling? -----------------
  {
    id: 'em1_cared_people',
    block: 'emotion',
    type: 'likert',
    phases: POST,
    text: 'I cared about the people the archive described.',
  },
  {
    id: 'em2_points_changed',
    block: 'emotion',
    type: 'likert',
    phases: POST,
    text: 'The story changed how I felt about earning Topple points.',
  },
  {
    id: 'em3_uneasy',
    block: 'emotion',
    type: 'likert',
    phases: POST,
    text: 'At some point I felt uneasy about where my iceberg was going.',
  },
  {
    id: 'em4_stayed_with_me',
    block: 'emotion',
    type: 'likert',
    phases: POST,
    text: 'Something from the story stayed with me after I stopped playing.',
  },
  {
    // The brief's "not preachy" goal, asked directly. Reverse-keyed: agreement is the failure.
    id: 'em5_told_what_to_think',
    block: 'emotion',
    type: 'likert',
    phases: POST,
    reverse: true,
    text: 'The game told me what to think.',
  },

  // --- open (the only free text in the whole instrument) ------------------------------------------
  {
    id: 'open1_moment',
    block: 'open',
    type: 'open',
    phases: POST,
    maxLength: OPEN_MAX_LENGTH,
    text: 'Was there a moment, object or document that changed how you saw the game? What was it?',
  },
  {
    id: 'open2_change',
    block: 'open',
    type: 'open',
    phases: POST,
    maxLength: OPEN_MAX_LENGTH,
    text: 'What confused you, felt wrong, or would you change?',
  },
];

export const itemsFor = (phase: Phase): readonly PilotItem[] =>
  ITEMS.filter((it) => it.phases.includes(phase));

export const FACTUAL_ITEMS: readonly FactualItem[] = ITEMS.filter(
  (it): it is FactualItem => it.type === 'factual',
);

export const itemById = (id: string): PilotItem | undefined => ITEMS.find((it) => it.id === id);

/** A survey page section: a heading, one line of instructions and the blocks it shows. */
export interface SurveySection {
  readonly title: string;
  readonly lede: string;
  readonly blocks: readonly ItemBlock[];
}

export const SECTIONS: Readonly<Record<Phase, readonly SurveySection[]>> = {
  pre: [
    {
      title: 'How you see it',
      lede: 'There are no right or wrong answers. Choose the option closest to your view.',
      blocks: ['attitude'],
    },
    {
      title: 'What you know',
      lede: 'A few factual questions. If you don’t know, “Not sure” helps more than a guess.',
      blocks: ['factual'],
    },
  ],
  post: [
    { title: 'Your session', lede: 'So we know what your answers are about.', blocks: ['context'] },
    {
      title: 'How you see it',
      lede: 'The same statements as before. Answer for how you see it now.',
      blocks: ['attitude'],
    },
    {
      title: 'What you know',
      lede: 'The same questions as before. “Not sure” is still a good answer.',
      blocks: ['factual'],
    },
    { title: 'The game itself', lede: 'How easy it was to play.', blocks: ['usability'] },
    { title: 'How it felt', lede: 'There are no right or wrong answers.', blocks: ['emotion'] },
    {
      title: 'In your own words',
      lede: 'Optional. Please leave out names or anything else that could identify you.',
      blocks: ['open'],
    },
  ],
};
