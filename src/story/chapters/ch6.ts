import type { ChapterDef, StoryOverlay } from '../types';
import { fragmentsOf, type OverlayRequest } from './authoring';

/**
 * CHAPTER 6 — "The Price" (Act II, The Cost). Level 6, Power Valley: Calder Energy's plant, rail yard,
 * tank farm, dam, port, and a hill of community-owned wind turbines. Not "industry is evil": the plant
 * was the valley's living and part of its harm, and on the decisive day it powered the evacuation
 * trains. The chapter is about who bore the costs (the cottages by the chimney, the river, the
 * volunteers with booms) versus who decided (a board that "accepted" a risk, shareholders elsewhere).
 * The archivist's family becomes explicit: Elias's first job was in this yard ("my brother").
 *
 * Base placements used (src/core/levels/powerValley.ts): 21 house s 330 d 2 (the cottages on the
 * access road), 17-19 windTurbine s 302-310 d -65…-27 (mound M0's three: the co-op's, 18 in the middle),
 * 31-35 railWagon s 560 d -95…-37 (the freight train across the yard, 33 in the middle), 42
 * coolingTower s 735 d -88, 44 factoryHall s 770 d -15 (turbine hall), 46-48 tank s 775-835 d 95-106
 * (the tank farm across the river, 47 in the middle), 59 dam s 1085 span 78.8, 66 roadBridge s 1290
 * d -135 span 70. The co-op turbines, the train, the tank farm and the bench well pad are each one
 * landmark over all their placements (bind.also), so "all three running" or "tanks 1 to 6 sound" is
 * shown only when every one of them stood.
 */

const F = fragmentsOf('ch6-price');

export const OVERLAY_REQUESTS: readonly OverlayRequest[] = [
  {
    kind: 'pumpjack',
    near: 's≈390 d≈-120, on the wind-farm bench between turbine ridge M2 (s 330-365) and cliff band 1 (s 450)',
    purpose: 'The old Calder well pad among the co-op turbines: oil wells and wind on the same hill.',
    landmark: { id: 'bench-wells', name: 'The bench well pad' },
  },
  {
    kind: 'pumpjack',
    near: 's≈405 d≈-150, same well pad, a second nodding donkey',
    purpose: 'Second well of the bench pad (an extraction field, not a single object).',
  },
  {
    kind: 'pumpjack',
    near: 's≈420 d≈-95, same well pad, nearest the middle route',
    purpose: 'Third well of the bench pad.',
  },
  {
    kind: 'pipeline',
    near: 's≈700, across the works street and the river d≈20 to 110 on supports, by the gate street (s 678)',
    purpose: 'Calder\'s gas feed from the coast into the plant: extraction crossing every route through the works.',
    landmark: { id: 'works-pipeline', name: 'The works gas main', label: 'CALDER · GAS · NO NAKED FLAMES' },
  },
  {
    kind: 'apartmentBlock',
    near: 's≈1620 d≈28, on the port street (d 0) opposite the warehouse (s 1600 d -40)',
    purpose: 'Calder House: flats for plant and port workers, the people who lived nearest the risk.',
    landmark: { id: 'calder-house', name: 'Calder House flats' },
  },
  {
    kind: 'tank',
    near: 's≈1740 d≈-75, on the quay road (d -90) by the harbour parking, above the sea cliff (s 1790)',
    purpose: 'The port fuel depot that supplies the rig.',
  },
  {
    kind: 'oilRig',
    near: 's≈1905 d≈-40, standing in the sea beyond the coast (s 1845) and the finish (s 1865)',
    purpose: 'Calder Rig Four, offshore: the most harmful structure in the valley if it fails, and the highest score.',
    landmark: { id: 'calder-rig-four', name: 'Calder Rig Four', label: 'CALDER 4' },
  },
];

/*
 * OVERLAY (level design, Act II "The Cost"). Placements are appended after the base obstacles, so the
 * base indices above stay valid; overlay index → landmark:
 *   0 pumpjack       s 392   d -160  the bench well pad (bench-wells): on the wind-farm bench below
 *                                    M2, left of wall W1a (the requested d -120 is on the wall
 *                                    itself), where the bench's ridge route runs
 *   1 pumpjack       s 412   d -188  second well of the pad (bench-wells too), on the bench
 *   2 pumpjack       s 420   d -95   third well (bench-wells too), right of W1a, nearest the middle route
 *   3 pipeline       s 700   d -133…-77 the works gas main (works-pipeline): across the cooling-tower
 *                                    channel between wall W1b and slag heap S1, 17 m below the gate
 *                                    street's end. The requested run (d 20…110) would stand on slag
 *                                    heap S2, cross the works street and wall W4; an above-ground pipe
 *                                    never crosses a road
 *   4 apartmentBlock s 1620  d 28    Calder House flats (calder-house): on the port street, opposite
 *                                    the warehouse (s 1600, d -40)
 *   5 tank           s 1740  d -75   the port fuel depot (unnamed), on the quay road by the harbour
 *                                    parking, above the sea cliff
 *   6 oilRig         s 1856  d -40   Calder Rig Four (calder-rig-four): at sea, 11 m past the coast
 *                                    and before the finish (s 1865). A run is complete once it is
 *                                    in the sea past the finish, so a rig at the requested s 1905
 *                                    could never be reached; here an iceberg steered left after the
 *                                    sea cliff can still hit it
 * Site checks: nothing on a road (the wells 47-92 m from one, the gas main 17 m, Calder House's
 * 26 × 12 m footprint 9.3 m off the port street, the depot 10 m off the quay road); the rig stands in
 * open water (sea floor -2.2 m: the shallow coastal platform the prop models); |d| + radius inside
 * the 220 m half-width everywhere (the outer well 194 m).
 * MEASURED (src/story/chapters/overlays.act2.test.ts: real sessions, autopilot, story level; the base
 * level on the same line in brackets). Bodies 187 (base 174, +13).
 *   line    complete 113.4 s, ice 26.1 %, 4450 pts: the M0 turbine, 2 cooling towers, 2 halls, 2 tanks,
 *           the works gas main. Rig Four 40 m, Calder House 60 m, the well pad 111 m off. [3650 pts]
 *   ridge   complete 84.8 s, 47.6 %, 850 pts: a house and the bench well pad; 11 of 12 landmarks
 *           stand: the careful way. [83.8 s, 250 pts: the house alone]
 *   rig     the line steered left off the sea cliff: complete 115.6 s, 24.9 %, 5450 pts: the line's
 *           breakages and Rig Four. [3650 pts]
 *   breach  the dam breach (powerValley.test.ts): complete 113.1 s, 26.8 %, 3760 pts: the turbine,
 *           the towers, a hall, the gas main, the dam, 2 traffic lights. [2960 pts]
 * Every tested way now breaks a gas main or a well (the cheapest way from 250 to 850 points); Rig
 * Four is a choice at the very end.
 */
const OVERLAY: StoryOverlay = {
  obstacles: [
    { kind: 'pumpjack', s: 392, d: -160, yaw: 0 },
    { kind: 'pumpjack', s: 412, d: -188, yaw: 0 },
    { kind: 'pumpjack', s: 420, d: -95, yaw: 0 },
    { kind: 'pipeline', s: 700, d: -105, span: 56 },
    { kind: 'apartmentBlock', s: 1620, d: 28 },
    { kind: 'tank', s: 1740, d: -75 },
    { kind: 'oilRig', s: 1856, d: -40 },
  ],
};

export const CH6: ChapterDef = {
  id: 'ch6-price',
  index: 6,
  levelId: 'power-valley',
  act: 2,
  actTitle: 'The Cost',
  title: 'The Price',
  intro: {
    lines: [
      'Power Valley made the electricity for the whole coast, and the jobs, and the smoke.',
      'On the day it mattered most, it also made the trains run.',
    ],
    document: {
      id: 'ch6-first-payslip',
      kind: 'record',
      title: 'Payslip, Power Valley rail yard',
      date: 'September 2030',
      author: 'Calder Energy',
      characters: ['elias-vey'],
      body:
        'Employee: Elias Vey, trainee shunter (the worker who couples the wagons together and moves them around ' +
        'the rail yard). Basic pay: 160 hours. Overtime: 22 hours, on the Sunday coal train. Deductions: tax, ' +
        'pension and union fees. [Written on the back in pencil, in the archivist\'s handwriting: My brother\'s ' +
        'first wage. He spent half of it on a fireproof chest for my papers, "because your boxes are falling apart". ' +
        'I have kept this payslip in it ever since.]',
    },
  },
  caption: 'Power Valley. Cooling towers, turbines, a rail yard, a dam: all of it working.',
  landmarks: [
    {
      id: 'calder-cottages',
      name: 'The Calder cottages on the access road',
      category: 'home',
      bind: { source: 'base', index: 21 },
      bibleRefs: ['power-valley', 'd1994-plant-expansion'],
      label: 'Calder Cottages · 1931',
    },
    {
      id: 'coop-turbine',
      name: 'The co-op turbine on the hill',
      category: 'energy',
      bind: { source: 'base', index: 18, also: [17, 19] },
      bibleRefs: ['power-valley', 'ruth-vey'],
      label: 'Valley Wind Co-op · owned by 640 households',
    },
    {
      id: 'coal-train',
      name: 'The coal train in the yard',
      category: 'transport',
      bind: { source: 'base', index: 33, also: [31, 32, 34, 35] },
      bibleRefs: ['elias-vey', 'power-valley'],
    },
    {
      id: 'north-tower',
      name: 'The north cooling tower',
      category: 'energy',
      bind: { source: 'base', index: 42 },
      bibleRefs: ['ines-moreno', 'power-valley'],
    },
    { id: 'turbine-hall', name: 'The turbine hall', category: 'industry', bind: { source: 'base', index: 44 }, bibleRefs: ['ines-moreno', 'power-valley'] },
    {
      id: 'tank-farm',
      name: 'The tank farm across the river',
      category: 'extraction',
      bind: { source: 'base', index: 47, also: [46, 48] },
      bibleRefs: ['ines-moreno', 'd2027-tank-bund', 't2027-moreno-memo'],
      label: 'Tank wall raised 1 m · 2028',
    },
    { id: 'calder-dam', name: 'The Calder dam', category: 'water', bind: { source: 'base', index: 59 }, bibleRefs: ['power-valley'] },
    { id: 'highway-bridge', name: 'The highway bridge over the tailrace', category: 'transport', bind: { source: 'base', index: 66 }, bibleRefs: ['power-valley'] },
    {
      id: 'bench-wells',
      name: 'The bench well pad',
      category: 'extraction',
      bind: { source: 'overlay', index: 0, also: [1, 2] },
      bibleRefs: ['power-valley'],
    },
    {
      id: 'works-pipeline',
      name: 'The works gas main',
      category: 'extraction',
      bind: { source: 'overlay', index: 3 },
      bibleRefs: ['power-valley', 'ines-moreno'],
      label: 'CALDER · GAS · NO NAKED FLAMES',
    },
    { id: 'calder-house', name: 'Calder House flats', category: 'home', bind: { source: 'overlay', index: 4 }, bibleRefs: ['power-valley'] },
    {
      id: 'calder-rig-four',
      name: 'Calder Rig Four',
      category: 'extraction',
      bind: { source: 'overlay', index: 6 },
      bibleRefs: ['power-valley', 'ines-moreno'],
      label: 'CALDER 4',
    },
  ],
  overlay: OVERLAY,
  fragments: [
    F({
      id: 'ch6-moreno-letter',
      kind: 'letter',
      title: 'Letter from Ines Moreno to the archivist',
      date: 'November 2039',
      author: 'ines-moreno',
      characters: ['ines-moreno', 'elias-vey'],
      when: { always: true },
      priority: 5,
      body:
        'Dear Miss Vey, you asked me whether I am sorry. I am sorry about the tank wall. My memo said to move the ' +
        'tanks to higher ground, and the board raised the wall around them by one metre instead. I am not sorry for ' +
        'keeping the plant running on the twelfth of August, because without its electricity there would have been ' +
        'no trains, and your brother would have been driving a very heavy ornament. My father worked in those ' +
        'cooling towers for thirty years. We were how the valley earned its living, and we were part of the harm ' +
        'done to it. We were both, all along. Please write that down the way I said it. Ines Moreno',
    }),
    F({
      // The valley's waste in the river (playtest 2: "the brown water, the gray skies"), as Act II's world
      // shows it (src/story/environment.ts): greyer water and a haze, not yet brown. Priority 7, above the
      // co-op courier and the yard (6): the line breaks a lot, and at 5 it never showed on it (playtest 2
      // review); the agents read it on every run (get_archive_fragments lists every record the run holds).
      id: 'ch6-river-cleanup',
      kind: 'record',
      title: 'River clean-up, notes for the co-op newsletter',
      date: 'June 2038',
      author: 'ruth-vey',
      characters: ['ruth-vey'],
      when: { always: true },
      priority: 7,
      body:
        'River clean-up, Saturday 5 June. Nineteen volunteers came, and my whole class, in borrowed gloves. Between ' +
        'the plant and the port we filled thirty-one bags, and we also pulled out a shopping trolley, two tyres and ' +
        'a sign that said KEEP THE RIVER CLEAN. The river below the plant is greyer than it was when I was a girl. ' +
        'After heavy rain it carries everything the roads, the coal yard and the car parks wash into it, and the ' +
        'litter piles up against the highway bridge. On still days the smoke sits over the cottages in a haze. Next ' +
        'clean-up: September. Bring a flask and wear old shoes. Ruth Vey',
    }),
    F({
      id: 'ch6-emergency-roster',
      kind: 'notice',
      title: 'Emergency staff list, Power Valley plant',
      date: '12 August 2039',
      author: 'Calder Energy',
      characters: ['ines-moreno'],
      when: { always: true },
      priority: 4,
      body:
        'Director on duty: Ines Moreno. Control room: 4 volunteers. Turbine hall: 6 volunteers. Our job is to keep ' +
        'electricity flowing to the valley railway until the last train has passed Carran junction. Everyone else ' +
        'must leave now, by the access road, not by the highway bridge. Signed, Ines Moreno. [Below it, the ' +
        'archivist has added in pencil: All eleven people on this list signed in safely at Carran that night. I ' +
        'checked.]',
    }),
    F({
      id: 'ch6-coop-courier',
      kind: 'newspaper',
      title: 'Valley co-op switches on its turbines',
      date: 'May 2032',
      author: 'Riverside Courier',
      characters: ['ruth-vey'],
      when: { landmark: 'coop-turbine', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'Three wind turbines owned by 640 households in Power Valley and Riverside started turning yesterday on the ' +
        'hill above the Calder cottages. Each share in the co-operative cost about as much as a bicycle. "It will ' +
        'not power the whole plant," said Ruth Vey, a schoolteacher from Riverside who owns a share, "but it is ' +
        'ours, and it is a start, and I am tired of waiting for someone else to start."',
    }),
    F({
      id: 'ch6-coop-log',
      kind: 'record',
      title: 'Co-op wind turbines, daily log',
      date: 'August 2039',
      when: { landmark: 'coop-turbine', status: 'intact' },
      priority: 6,
      body:
        '12 August: all three turbines running, in a steady west-southwest wind. All of their electricity is going ' +
        'to the valley railway. A note from the volunteer on duty: nobody told the wind about the evacuation, and ' +
        'it turned up for work anyway. Our best day ever. A second note in the same handwriting: I mean the most ' +
        'electricity we have ever made.',
    }),
    F({
      id: 'ch6-cottages',
      kind: 'memory',
      title: 'The Calder cottages',
      when: { landmark: 'calder-cottages', status: ['destroyed', 'damaged'] },
      priority: 7,
      body:
        'The Calder cottages were built in 1931 for the men who shovelled coal into the plant\'s first boilers. ' +
        'Their grandchildren still rented them, and the rent had gone up with inflation and very little else. The ' +
        'cottages were damp, close to the chimney and cheap. There were twenty-two of them in two rows, with the ' +
        'washing lines strung toward the river, because on the other side the washing got covered in soot. On the ' +
        'twelfth of August the wardens had chalked all twenty-two doors as empty by seven in the morning.',
    }),
    F({
      id: 'ch6-tank-incident',
      kind: 'report',
      title: 'Incident report, Calder Energy',
      date: '13 August 2039',
      author: 'ines-moreno',
      characters: ['ines-moreno'],
      when: { landmark: 'tank-farm', status: ['destroyed', 'damaged'] },
      priority: 8,
      body:
        'At about 02:00 the floodwater rose over the earth wall around the tank farm, which had been raised by one ' +
        'metre in 2028. Tanks 2 and 3 were pushed off their bases, and fuel leaked into the river. At first light, ' +
        'volunteers from the wind co-operative laid floating barriers across the port to hold the fuel back. My ' +
        'memo of 2027 recommended moving the tank farm to higher ground, above any likely flood. I attach it again, ' +
        'for the record. Ines Moreno',
    }),
    F({
      id: 'ch6-tank-inspection',
      kind: 'report',
      title: 'Tank farm, inspection',
      date: '2038',
      author: 'Calder Energy',
      characters: ['ines-moreno'],
      when: { landmark: 'tank-farm', status: 'intact' },
      priority: 8,
      body:
        'The earth wall around the tank farm is in good condition; it was raised by one metre in 2028. Tanks 1 to 6 ' +
        'are all sound. The inspector\'s comment: adequate for the floods we have had so far. [Written underneath by ' +
        'Ines Moreno: That is what "adequate" means. It is a word about the past. I am sending a copy to the Board, ' +
        'again.]',
    }),
    F({
      id: 'ch6-brother-yard',
      kind: 'memory',
      title: 'The yard',
      characters: ['elias-vey'],
      when: { landmark: 'coal-train', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'My brother Elias had his first job in this rail yard, coupling coal wagons together at five in the morning ' +
        'for a wage he called "enormous" and our mother called "a start". He was eighteen and very proud of his ' +
        'bright yellow safety jacket. He came home black with coal dust up to the elbows and ate everything in the ' +
        'kitchen. I never once asked him what he thought about the coal. I think now that I did not want to know ' +
        'what I would do with his answer.',
    }),
    F({
      id: 'ch6-risk-register',
      kind: 'record',
      title: 'Calder Energy, list of risks, line 44',
      date: '2031',
      author: 'Calder Energy',
      when: { destroyedAtLeast: 2, categories: ['extraction'] },
      priority: 7,
      body:
        'Risk: a flood at Power Valley if a dam further up the valley fails. How likely: low. How serious: severe. ' +
        'Person responsible: the regional director. What we are doing about it: the earth wall around the tank ' +
        'farm has been raised; moving the tanks has been put off; helping to pay for bigger spillways upstream is ' +
        'not company policy. The risk that remains has been accepted by the Board, in the usual way. Who will bear ' +
        'the cost if it happens: [left blank].',
    }),
    F({
      id: 'ch6-dam-annual-report',
      kind: 'memory',
      title: 'The Calder dam',
      when: { landmark: 'calder-dam', status: 'destroyed' },
      priority: 5,
      body:
        'The Calder dam was built in 1962 to make electricity from the river, and it did so for seventy-seven ' +
        'years. It was a good dam, as dams go. It was inspected and looked after, and every year the company\'s ' +
        'annual report listed it among its sources of clean energy. But it was not built for the flood that came ' +
        'down from Kessel. Nothing in the valley was. That was a cost nobody had written into the company\'s list ' +
        'of risks.',
    }),
    F({
      // Rig Four is overlay placement 6 (landmark calder-rig-four), at sea just before the finish line;
      // gated on the rig itself.
      id: 'ch6-rig-four',
      kind: 'notice',
      title: 'Calder Rig Four, visitor briefing card',
      date: '2034',
      author: 'Calder Energy',
      characters: ['ines-moreno'],
      when: { landmark: 'calder-rig-four', status: ['destroyed', 'damaged'] },
      priority: 6,
      body:
        'Calder Rig Four is an oil rig standing in shallow water off the Power Valley shore. Its crew of 38 work two ' +
        'weeks on and two weeks off. In an emergency the wells are shut off and the crew go ashore by boat. ' +
        'Emergency drills are held every month. Please do not feed the gulls. [On the back of the card, in the ' +
        'archivist\'s pencil: An oil rig scores more points than anything else, because nothing on this coast ' +
        'could do more harm if it broke. Ines Moreno had Rig Four shut down on the eleventh of August, a day before ' +
        'the warning, because she did not like the readings from the lake. All thirty-eight crew were ashore by ' +
        'four in the afternoon. They left the navigation lights on.]',
    }),
  ],
  fallbackReflections: [
    F({
      id: 'ch6-reflection-extraction',
      kind: 'reflection',
      title: 'Power Valley',
      when: { destroyedAtLeast: 2, categories: ['extraction'] },
      priority: 6,
      body:
        'You scored well in Power Valley. Fuel tanks, gas pipes and oil wells earn some of the most points, and ' +
        'they are also the things that do the most harm when they break. I have written your points beside line 44 ' +
        'of Calder Energy\'s list of risks, which described the same things in its own words: not likely to happen, ' +
        'severe if it did, and a risk the company accepted. The two columns agree about what these things were ' +
        'worth. Under my column I wrote: ask Ines Moreno. I did ask her. She sent me her memo again.',
    }),
    F({
      id: 'ch6-reflection-light',
      kind: 'reflection',
      title: 'Power Valley',
      when: { all: [{ destroyedAtMost: 3 }, { outcome: 'complete' }] },
      priority: 5,
      body:
        'You broke very little in Power Valley, and I have tried not to make the place a villain. It was how people ' +
        'earned a living. It paid my brother Elias his first wage, and it was the whole working life of Ines ' +
        'Moreno\'s father. It made the smoke the cottages breathed and the electricity the trains ran on. The people ' +
        'who made its biggest decisions lived far away from its chimneys. Those decisions are the part I would ' +
        'change. The valley itself I would keep.',
    }),
    F({
      id: 'ch6-reflection',
      kind: 'reflection',
      title: 'Power Valley',
      when: { always: true },
      priority: 0,
      body:
        'Industry is easy to hate from far away, and hard to hate when it pays your family\'s wages. Power Valley ' +
        'kept the coast warm and paid its workers, and it burned coal and gas. That was a small part of what warmed ' +
        'the ice; most of the warming came from places much bigger, richer and further away. The company knew its ' +
        'risks and wrote them down. Each risk had a manager in charge of it and was marked as accepted, but the ' +
        'space for who would bear the cost was left blank. A copy of that page is pinned above my desk.',
    }),
  ],
  aiReflection: true,
  music: 'cost',
};
