import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../../story/chapters';
import { anyHuman, isHumanFragment } from './human';

/**
 * Every document of the nine chapters (intro documents, fragments and authored reflections), pinned:
 * the motif plays over a revelation only when one of the run's surfaced documents is human. A story
 * change that changes a classification has to be looked at here on purpose.
 */
const PINNED: readonly (readonly [string, boolean])[] = [
  ['ch1-postcard-1962', true], // letter - | Jean Harper's postcard home from Vell…
  ['ch1-hut-door-note', false], // notice tomas-lind | Note pinned to the survey hut door
  ['ch1-notebook-1987', true], // record tomas-lind | Field notebook: measuring the glacier
  ['ch1-benchmark-register', true], // record tomas-lind | Survey register: the bolted stone at…
  ['ch1-hut-gone', true], // memory - | Margin note, in pencil
  ['ch1-hut-stands', true], // memory - | Margin note, in pencil
  ['ch1-rowan-photo', true], // caption - | Photograph, undated
  ['ch1-leaflet', false], // newspaper - | Vell Foot: A Day Out (leaflet)
  ['ch1-clean-run', false], // caption - | Margin note
  ['ch1-turned-back', true], // record tomas-lind | Field notebook: a day I turned back
  ['ch1-reflection-hut-gone', false], // reflection - | Vell Foot
  ['ch1-reflection-hut-stands', false], // reflection - | Vell Foot
  ['ch1-reflection', false], // reflection - | Vell Foot
  ['ch2-summary-sheet', true], // record tomas-lind | Summary sheet: how far the ice has mo…
  ['ch2-notebook-lake', true], // record tomas-lind | Field notebook: a new lake above Kess…
  ['ch2-young-lind', true], // caption - | Photograph, 1984
  ['ch2-gauge-gone', true], // memory - | Gauge 2
  ['ch2-gauge-reading', true], // record tomas-lind | Gauge 2: timing the river
  ['ch2-cabin-gone', true], // memory - | The field cabin
  ['ch2-parcel-letter', true], // letter tomas-lind | Letter from Tomas Lind to the archivi…
  ['ch2-price-board', false], // record - | Price board, Canyon Trading Post
  ['ch2-tower-courier', false], // newspaper Riverside Courier | Canyon water tower to be replaced
  ['ch2-marit', true], // memory - | The Marit
  ['ch2-gap-in-record', true], // record tomas-lind | Field notebook: the stakes I could no…
  ['ch2-reflection-cabin-stands', false], // reflection - | The Red Canyon
  ['ch2-reflection-many', false], // reflection - | The Red Canyon
  ['ch2-reflection', false], // reflection - | The Red Canyon
  ['ch3-plan-draft', false], // report Vell Valley Water Board | Alpine Pass: emergency routes (dra…
  ['ch3-exercise-notice', false], // notice Vell Valley Water Board | Exercise notice, pass villages
  ['ch3-sorel-letter', true], // letter anna-sorel | Letter to the Water Board, with the t…
  ['ch3-valley-letter', true], // letter - | Letter from the last chalet on the valley road
  ['ch3-valley-chalet-gone', true], // memory - | The last chalet on the valley road
  ['ch3-chapel-logbooks', true], // memory - | Assembly Point A
  ['ch3-chapel-log', false], // record - | Assembly Point A, exercise log
  ['ch3-post-bus-timetable', false], // notice - | Post bus 340, winter timetable
  ['ch3-lift-courier', false], // newspaper Riverside Courier | Lochbach lift to close early
  ['ch3-annex-c', false], // notice Vell Valley Water Board | Evacuation plan, Annex C
  ['ch3-reflection-valley-gone', false], // reflection - | The Alpine Pass
  ['ch3-reflection-valley-stands', false], // reflection - | The Alpine Pass
  ['ch3-reflection', false], // reflection - | The Alpine Pass
  ['ch4-kitchen-calendar', true], // record ruth-vey | Kitchen calendar, Church Lane
  ['ch4-wardens-list', false], // notice Riverside Street Wardens | Street wardens: Church Lane
  ['ch4-vey-house-gone', true], // memory - | No. 14
  ['ch4-kitchen-table-note', true], // letter ruth-vey | Note from Ruth Vey to her daughter, l…
  ['ch4-pells', true], // memory - | Next door
  ['ch4-levy-result', false], // record Riverside Town Council | Result of the Riverside flood levy vo…
  ['ch4-harrow-letter', true], // letter gil-harrow | Letter from Gil Harrow, former leader…
  ['ch4-dam-inspection', false], // report Vell Valley Water Board | Riverside dam, inspection
  ['ch4-church-hall', true], // memory - | St Bride's hall, Thursdays
  ['ch4-church-notices', false], // notice - | Notice on the door of St Bride's chur…
  ['ch4-drivers-log', true], // record elias-vey | Driver's log, valley line
  ['ch4-light-touch', true], // memory - | Your route through town
  ['ch4-station-court', false], // record - | Station Court, warden's sheet
  ['ch4-reflection-house-gone', false], // reflection - | Riverside
  ['ch4-reflection-house-stands', false], // reflection - | Riverside
  ['ch4-reflection', false], // reflection - | Riverside
  ['ch5-kessel-report', false], // report anna-sorel | Kessel dam: spillway adequacy (summary for t…
  ['ch5-board-minutes', false], // record Vell Valley Water Board | Water Board minutes, item 7
  ['ch5-ministry-reply', false], // letter Ministry of Infrastructure | Reply from the Ministry
  ['ch5-public-question', false], // record Vell Valley Water Board | Water Board minutes, public s…
  ['ch5-moreno-memo', false], // report ines-moreno | Internal memo: the Kessel spillway
  ['ch5-calder-resolution', false], // record Calder Energy | Calder Energy, board resolution 2027/…
  ['ch5-dam-held', true], // memory - | What the dam held
  ['ch5-lake-walk', true], // record tomas-lind | Field notebook: the Kessel lake
  ['ch5-ice-stone-photo', true], // caption - | Photograph, 2015
  ['ch5-dairy', true], // memory - | The dairy
  ['ch5-guestbook', false], // record - | Guestbook, the guesthouse across the street
  ['ch5-pipeline-courier', false], // newspaper Riverside Courier | Pipeline route approved
  ['ch5-keepers-log', false], // record - | Kessel dam, keeper's log
  ['ch5-reflection-dam-gone', false], // reflection - | Kessel
  ['ch5-reflection-dam-stands', false], // reflection - | Kessel
  ['ch5-reflection', false], // reflection - | Kessel
  ['ch6-first-payslip', false], // record Calder Energy | Payslip, Power Valley rail yard
  ['ch6-moreno-letter', true], // letter ines-moreno | Letter from Ines Moreno to the archiv…
  ['ch6-river-cleanup', true], // record ruth-vey | River clean-up, notes for the co-op newsletter
  ['ch6-emergency-roster', false], // notice Calder Energy | Emergency staff list, Power Valley pl…
  ['ch6-coop-courier', false], // newspaper Riverside Courier | Valley co-op switches on its turbin…
  ['ch6-coop-log', false], // record - | Co-op wind turbines, daily log
  ['ch6-cottages', true], // memory - | The Calder cottages
  ['ch6-tank-incident', false], // report ines-moreno | Incident report, Calder Energy
  ['ch6-tank-inspection', false], // report Calder Energy | Tank farm, inspection
  ['ch6-brother-yard', true], // memory - | The yard
  ['ch6-risk-register', false], // record Calder Energy | Calder Energy, list of risks, line 44
  ['ch6-dam-annual-report', true], // memory - | The Calder dam
  ['ch6-rig-four', false], // notice Calder Energy | Calder Rig Four, visitor briefing card
  ['ch6-reflection-extraction', false], // reflection - | Power Valley
  ['ch6-reflection-light', false], // reflection - | Power Valley
  ['ch6-reflection', false], // reflection - | Power Valley
  ['ch7-route-card', false], // notice Vell Valley Water Board | Red Mesa route card (keep in your …
  ['ch7-plant-letter', true], // letter - | Letter from Ada Hollins to Calder Energy
  ['ch7-plant-notice', false], // notice Vell Valley Water Board | Red Mesa: do not use the water
  ['ch7-plant-log', false], // record Calder Energy | Calder processing plant, Red Mesa: daily log
  ['ch7-ranger-log', false], // record Red Mesa ranger post | Ranger post log
  ['ch7-line-31', false], // record Vell Valley Water Board | Water Board building plans, line 31
  ['ch7-last-train', true], // record elias-vey | Driver's log, the last train
  ['ch7-salt-spring', true], // memory - | The Red Mesa, the next spring
  ['ch7-water-porch', true], // memory - | The ranger post
  ['ch7-hollins-door', true], // memory - | Hollins farm
  ['ch7-after-action', false], // report Vell Valley Water Board | Red Mesa evacuation: what worked and …
  ['ch7-truck-at-leap', false], // record Red Mesa ranger post | Ranger post log
  ['ch7-field-courier', false], // newspaper Riverside Courier | Red Mesa field "past its best", sa…
  ['ch7-reflection-homes', false], // reflection - | The Red Mesa
  ['ch7-reflection-plant', false], // reflection - | The Red Mesa
  ['ch7-reflection-plant-stands', false], // reflection - | The Red Mesa
  ['ch7-reflection', false], // reflection - | The Red Mesa
  ['ch8-callum-letter', true], // letter callum-reid | Letter to whoever reads the archive
  ['ch8-station-notice', false], // notice Clachan community council | Power station open day
  ['ch8-station-log', false], // record - | Power station, keeper's log
  ['ch8-school-letter', true], // letter - | Letter to parents, Clachan Primary School
  ['ch8-larder-door', true], // memory mara-vey | Achadh
  ['ch8-achadh-letter', true], // letter ruth-vey | Letter from Ruth Vey to her daughter …
  ['ch8-bothy-peaches', true], // memory mara-vey | The shepherd's hut
  ['ch8-cracked-bell', true], // memory mara-vey | The church bell
  ['ch8-after-church-lane', true], // memory mara-vey | After Church Lane
  ['ch8-finish-the-month', true], // memory mara-vey | August, unfinished
  ['ch8-stream-notice', false], // notice Clachan community council | Please keep the stream clean
  ['ch8-tried', true], // memory mara-vey | Once, plainly
  ['ch8-two-columns', false], // record Clachan community council | Clachan community council, minu…
  ['ch8-reflection-much-lost', false], // reflection mara-vey | The Clachan
  ['ch8-reflection-dark', false], // reflection mara-vey | The Clachan
  ['ch8-reflection', false], // reflection mara-vey | The Clachan
  ['ch9-last-notebook', true], // record tomas-lind | Field notebook, last page
  ['ch9-handover-note', false], // report anna-sorel | Upper Vell dam, handover note
  ['ch9-dam-went', true], // memory mara-vey | The Upper Vell dam
  ['ch9-dam-keeper', false], // record - | Upper Vell dam, keeper's log
  ['ch9-kettles', true], // memory mara-vey | Kettles
  ['ch9-tomas-letter', true], // letter tomas-lind | Letter from Tomas Lind to Mara
  ['ch9-chapel-board', false], // notice - | Fjord chapel, notice board
  ['ch9-rig-shutdown', false], // record Calder Energy | Calder Rig Seven, shutdown log
  ['ch9-lower-terrace', false], // notice Vell Valley Water Board | The lower terrace: no more repairs
  ['ch9-abandoned', true], // memory mara-vey | The lower terrace
  ['ch9-annex-f-funded', false], // notice Vell Valley Water Board | Alpine Pass road reopened
  ['ch9-ministry-programme', false], // newspaper Ministry of Infrastructure | National spillway pr…
  ['ch9-short-of-sea', true], // memory mara-vey | Short of the sea
  ['ch9-reflection-dam-gone', false], // reflection mara-vey | The Upper Vell
  ['ch9-reflection-dam-stands', false], // reflection mara-vey | The Upper Vell
  ['ch9-reflection', false], // reflection mara-vey | The Upper Vell
];

describe('which documents are human (DESIGN §8.6)', () => {
  it('the pinned examples', () => {
    const get = (id: string) => PINNED.find(([d]) => d === id)?.[1];
    expect(get('ch4-kitchen-table-note')).toBe(true);
    expect(get('ch4-vey-house-gone')).toBe(true);
    expect(get('ch8-callum-letter')).toBe(true);
    expect(get('ch5-ministry-reply')).toBe(false);
  });

  it('every document of every chapter is classified as pinned', () => {
    const docs = CHAPTERS.flatMap((c) => [...(c.intro.document ? [c.intro.document] : []), ...c.fragments, ...c.fallbackReflections]);
    expect(docs.map((d) => d.id)).toEqual(PINNED.map(([id]) => id));
    for (const d of docs) expect(isHumanFragment(d), d.id).toBe(PINNED.find(([id]) => id === d.id)?.[1]);
  });

  it("the rule itself: personal kinds by people, photographs, the characters' own records", () => {
    expect(isHumanFragment({ kind: 'letter', title: 'x' })).toBe(true);
    expect(isHumanFragment({ kind: 'letter', author: 'Vell Valley Water Board', title: 'x' })).toBe(false);
    expect(isHumanFragment({ kind: 'memory', author: 'mara-vey', title: 'x' })).toBe(true);
    expect(isHumanFragment({ kind: 'caption', title: 'Photograph, 1984' })).toBe(true);
    expect(isHumanFragment({ kind: 'caption', title: 'Margin note' })).toBe(false);
    expect(isHumanFragment({ kind: 'record', author: 'tomas-lind', title: 'x' })).toBe(true);
    expect(isHumanFragment({ kind: 'record', author: 'Calder Energy', title: 'x' })).toBe(false);
    expect(isHumanFragment({ kind: 'record', title: 'x' })).toBe(false);
    for (const kind of ['notice', 'report', 'newspaper', 'reflection'] as const) {
      expect(isHumanFragment({ kind, author: 'tomas-lind', title: 'x' })).toBe(false);
    }
    expect(anyHuman([])).toBe(false);
  });

  it('chapter 5 (denial): the documents it always shows are institutional', () => {
    const ch5 = CHAPTERS.find((c) => c.id === 'ch5-denial')!;
    const always = ch5.fragments.filter((f) => 'always' in f.when);
    expect(always.length).toBeGreaterThan(0);
    expect(anyHuman(always)).toBe(false);
  });
});
