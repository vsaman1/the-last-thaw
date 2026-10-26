import { BUILT_CATEGORIES, type FragmentCondition } from './types';

/**
 * Authored building blocks of the final epilogue, used when the agents are off or fail (and as the
 * agents' reference for tone). src/story/select.ts composeEpilogue picks the best matching part per
 * slot (highest priority whose condition holds; ties keep authored order) and joins them in slot
 * order: opening, journey, people, closing. Any one part per slot joins into 150-250 words (tested).
 *
 * Conditions read the chapter 9 run (counts; its outcome is always 'complete', because the epilogue
 * follows a finished chapter 9) and, through `history`, what earlier runs left standing or broke, so the
 * epilogue reflects the player's own journey. Every slot has an `always`
 * part so the epilogue is never missing a piece. Reflective, not triumphant; nobody went extinct; the
 * houses were empty. The theme line appears once, in the closing, in Tomas Lind's hand. Written in
 * plain English with full names (see the bible's writing rules).
 */
export interface EpiloguePart {
  readonly id: string;
  readonly slot: 'opening' | 'journey' | 'people' | 'closing';
  readonly when: FragmentCondition;
  readonly priority: number;
  readonly text: string;
}

export const EPILOGUE_SLOTS: readonly EpiloguePart['slot'][] = ['opening', 'journey', 'people', 'closing'];

export const EPILOGUE_PARTS: readonly EpiloguePart[] = [
  // ---------------------------------------------------------------------------------------------- opening
  {
    id: 'ep-open-sea',
    slot: 'opening',
    when: { outcome: 'complete' },
    priority: 5,
    text:
      // The fjord as drawn: grey-green, never brown (worldLook.ts SEA_NOUN).
      'The archive ends where the water did: in the fjord below the Upper Vell, grey with what the rivers ' +
      'carried down, with ice floating in it. I have read your nine runs again, as Tomas Lind read his stakes: ' +
      'slowly and twice. I did not like some of the numbers, but I liked others more than I expected.',
  },
  {
    id: 'ep-open',
    slot: 'opening',
    when: { always: true },
    priority: 0,
    text:
      'This is the last page of the archive, for now. I have read through your runs again, from start to finish, ' +
      'the way Tomas Lind read his stakes every September: slowly, twice, and writing down only what was really ' +
      'there.',
  },
  // ---------------------------------------------------------------------------------------------- journey
  // One part per slot already passes the 150-word minimum, so nothing is ever topped up: a part that loses
  // its slot is never read. The Clachan's power station falls on every run (chapter 8), so No. 14's two
  // parts come in a version that names the station too, above the rest.
  {
    id: 'ep-journey-home-gone-station',
    slot: 'journey',
    when: {
      all: [{ history: { landmark: 'vey-house', status: 'destroyed' } }, { history: { landmark: 'clachan-station', status: 'destroyed' } }],
    },
    priority: 7,
    text:
      'You went through No. 14 on Church Lane, and through a good deal else on the way down, and your points went ' +
      'up the way the game promised. I do not hold the points against you. I keep the record of what each one ' +
      'was. One was my mother\'s kitchen. Another was the Clachan\'s power station, which lit every house in the ' +
      'glen.',
  },
  {
    id: 'ep-journey-home-stood-station',
    slot: 'journey',
    when: {
      all: [{ history: { landmark: 'vey-house', status: 'intact' } }, { history: { landmark: 'clachan-station', status: 'destroyed' } }],
    },
    priority: 7,
    text:
      'You left No. 14 standing on Church Lane, and I have stopped pretending that it does not matter to me. The ' +
      'Clachan\'s power station did not stand, and losing it left every house in the glen without power. The ' +
      'rest of your journey was mixed. Some things you broke because they were in the way, some because they ' +
      'scored points, and a few you went around.',
  },
  {
    id: 'ep-journey-home-gone',
    slot: 'journey',
    when: { history: { landmark: 'vey-house', status: 'destroyed' } },
    priority: 6,
    text:
      'You went through No. 14 on Church Lane, and through a good deal else on the way down, and your points went ' +
      'up the way the game promised. I do not hold the points against you. I hold on to the record, which says ' +
      'what each of them was. One of them was my mother\'s kitchen, with a calendar written in four colours of pen.',
  },
  {
    id: 'ep-journey-home-stood',
    slot: 'journey',
    when: { history: { landmark: 'vey-house', status: 'intact' } },
    priority: 6,
    text:
      'You left No. 14 standing on Church Lane, and I have stopped pretending that it does not matter to me. The ' +
      'rest of your journey was mixed, as journeys are. Some things you broke because they were in the way, some ' +
      'because they scored points, and a few you went around when you did not have to.',
  },
  {
    // Heavy with what it gathered (doubled at least) and eight built things broken in the last run;
    // felled trees are not what "a great deal" means.
    id: 'ep-journey-heavy',
    slot: 'journey',
    when: { all: [{ destroyedAtLeast: 8, categories: BUILT_CATEGORIES }, { grewAtLeast: 2 }] },
    priority: 4,
    text:
      'By the last mountain you were heavy with all the ice you had gathered, and you broke a great deal on the ' +
      'way to the fjord. Your points were very high, and I have added them up. Beside them I have written the ' +
      'other total: the one the valley is still paying, in rent for borrowed rooms, letters to insurers and ' +
      'rivers that still run brown.',
  },
  {
    // The station alone, for a journey whose saved chapter 4 left No. 14 unreached (No. 14's parts above
    // name the station too).
    id: 'ep-journey-station',
    slot: 'journey',
    when: { history: { landmark: 'clachan-station', status: 'destroyed' } },
    priority: 3,
    text:
      'The Clachan\'s power station broke in your run. It was the first thing the water met in that glen, and ' +
      'losing it took the light and heat from every house. I have put it at the top of my list, as Callum Reid asked, with ' +
      'everything else that fell listed below it in order. I have not crossed anything out or added anything to ' +
      'make it look better.',
  },
  {
    id: 'ep-journey',
    slot: 'journey',
    when: { always: true },
    priority: 0,
    text:
      'You came down through nine places in one summer: Vell Foot, the canyon, the pass, my town, Kessel, Power ' +
      'Valley, the mesa, the Clachan and the Upper Vell. Some of what stood there you broke, and some you went ' +
      'around. The archive keeps both lists in the same handwriting, in pencil, and does not add them up.',
  },
  // ----------------------------------------------------------------------------------------------- people
  {
    id: 'ep-people-kessel',
    slot: 'people',
    when: { history: { landmark: 'kessel-dam', status: 'destroyed' } },
    priority: 5,
    text:
      'The people are the part I am surest of. The Kessel dam gave way, as Anna Sorel\'s report said it would, but ' +
      'the people of Kessel had already left. The last car left at 07:35, carrying the dam keeper\'s logbook. ' +
      'Everyone on every list is accounted for. Most are in Carran, writing to the council, which is how I know ' +
      'they are fine.',
  },
  {
    id: 'ep-people-tanks',
    slot: 'people',
    when: { history: { landmark: 'tank-farm', status: 'destroyed' } },
    priority: 4,
    text:
      'In your run the tank farm in Power Valley broke, and its fuel went into the river. Volunteers from the wind ' +
      'co-operative were out with floating barriers, and they still go out most Saturdays. Ines Moreno attached ' +
      'her 2027 memo to the incident report, again. Everyone on every list is accounted for. The river is another ' +
      'matter: near the port it is still brown.',
  },
  {
    id: 'ep-people',
    slot: 'people',
    when: { always: true },
    priority: 0,
    text:
      'The people are the part I am surest of. My mother, Ruth Vey, timed her school\'s walk to the station every ' +
      'term, and on the day it took eleven minutes. My brother Elias drove the last train. Callum Reid drove the ' +
      'glen\'s oldest people to Carran in the post van. Everyone on every list is accounted for. The houses were ' +
      'empty; I checked the lists.',
  },
  // ---------------------------------------------------------------------------------------------- closing
  {
    id: 'ep-close-careful',
    slot: 'closing',
    when: { all: [{ destroyedAtMost: 3 }, { outcome: 'complete' }] },
    priority: 5,
    text:
      'You came down the last mountain carefully and broke very little. I do not want to make too much of that, ' +
      'but I am going to anyway. Inside the cover of his last notebook, under fifty-two years of numbers, Tomas ' +
      'Lind wrote one line: You cannot undo the river behind you. You can still decide where it goes next.',
  },
  {
    id: 'ep-close-heavy',
    slot: 'closing',
    when: { destroyedAtLeast: 8, categories: BUILT_CATEGORIES },
    priority: 4,
    text:
      'I am not going to tell you what it means; you were there, and you were the water. Inside the cover of his ' +
      'last notebook, under fifty-two years of numbers, Tomas Lind wrote one line: You cannot undo the river ' +
      'behind you. You can still decide where it goes next. Then he drew a kettle.',
  },
  {
    id: 'ep-close',
    slot: 'closing',
    when: { always: true },
    priority: 0,
    text:
      'I am not going to tell you what it means; you were there. I will tell you what Tomas Lind wrote inside the ' +
      'cover of his last notebook, under fifty-two years of numbers, in handwriting that was getting larger: You ' +
      'cannot undo the river behind you. You can still decide where it goes next. Then he drew a kettle.',
  },
];
