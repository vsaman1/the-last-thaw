import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkEpilogueRequest, checkReflectRequest, historyProblems } from '../server/contracts';
import {
  CH1_HISTORY,
  ch4Evidence,
  ch9Evidence,
  chapterOf,
  CH4_HISTORY,
  FIXTURE_STORY,
  FIXTURE_STORY_WITH_INJECTION,
  GOOD_CLAIMS,
  GOOD_DRAFT,
  GOOD_TEXT,
} from '../server/testing/fixtureStory';
import { levelSummaryFor, STORY } from '../server/story';
import { getRunSummary } from '../server/tools';
import { CHAPTERS } from './chapters';
import { EPILOGUE_PARTS } from './epilogueText';
import { evidenceFixture } from './fixtures';
import { currentHistoryItem } from './select';
import { CLIMATE_FACTS } from './science';
import type { ChapterDef, HistoryItem, LandmarkStatus, NarrativeClaim, RunEvidence } from './types';
import {
  builtTotal,
  claimProblem,
  digitRuns,
  extractNumbers,
  fragmentApplies,
  validateNarrative,
  wordCount,
  type NarrativeDraft,
  type ValidationContext,
} from './validate';

const ctx4 = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  mode: 'reflection',
  chapter: chapterOf('ch4-people'),
  evidence: ch4Evidence(),
  history: [CH1_HISTORY],
  story: FIXTURE_STORY,
  secrets: ['SECRET-CANARY-TEST-123456'],
  ...over,
});

const codes = (d: NarrativeDraft, c: ValidationContext = ctx4()): string[] => validateNarrative(d, c).issues.map((i) => i.code);

describe('validateNarrative', () => {
  it('accepts a grounded, restrained reflection', () => {
    const r = validateNarrative(GOOD_DRAFT, ctx4());
    expect(r.issues).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.checked).toBeGreaterThan(10);
  });

  it('rejects an invented event (a landmark status the run does not show)', () => {
    const claims: NarrativeClaim[] = GOOD_CLAIMS.map((c) =>
      c.type === 'landmark' && c.landmarkId === 'mill-chapel' ? { ...c, status: 'destroyed' } : c,
    );
    expect(codes({ ...GOOD_DRAFT, claims })).toContain('claim-landmark');
    expect(codes({ ...GOOD_DRAFT, claims: [...GOOD_CLAIMS, { type: 'landmark', landmarkId: 'gauge-hut', status: 'destroyed' }] })).toContain(
      'claim-landmark',
    );
  });

  it('rejects wrong counts, outcomes and growth', () => {
    const wrong = (c: NarrativeClaim): string[] => codes({ ...GOOD_DRAFT, claims: [...GOOD_CLAIMS, c] });
    expect(wrong({ type: 'count', what: 'destroyed', category: 'home', value: 4 })).toContain('claim-count');
    expect(wrong({ type: 'count', what: 'trees', value: 6 })).toContain('claim-count');
    expect(wrong({ type: 'outcome', value: 'failed' })).toContain('claim-outcome');
    expect(wrong({ type: 'growth', peakMass: 2500 })).toContain('claim-growth');
    expect(wrong({ type: 'growth', peakMass: 1845 })).not.toContain('claim-growth'); // rounding within 1 %
  });

  it('"N structures destroyed" counts what was built: felled trees are their own count, here and in the agents\' summary', () => {
    // Three trees felled and nothing built broken: "3 destroyed" is false, "0 destroyed, 3 trees" true.
    const ev = ch4Evidence({ destroyedByCategory: { nature: 3 }, destroyedByKind: { pine: 3 }, treesFelled: 3 });
    const claimCodes = (c: NarrativeClaim): string[] => codes({ ...GOOD_DRAFT, claims: [...GOOD_CLAIMS.filter((x) => x.type !== 'count'), c] }, ctx4({ evidence: ev }));
    expect(claimCodes({ type: 'count', what: 'destroyed', value: 3 })).toContain('claim-count');
    expect(claimCodes({ type: 'count', what: 'destroyed', value: 0 })).not.toContain('claim-count');
    expect(claimCodes({ type: 'count', what: 'trees', value: 3 })).not.toContain('claim-count');
    expect(claimCodes({ type: 'count', what: 'destroyed', category: 'nature', value: 3 })).not.toContain('claim-count');
    // The Archivist's get_run_summary reports the same total the claim is checked against.
    const mixed = ch4Evidence({ destroyedByCategory: { home: 2, farm: 1, nature: 5 } });
    const summary = getRunSummary.run({}, { ...ctx4({ evidence: mixed }), level: undefined, draft: undefined, secrets: [] }) as { destroyedTotal: number };
    expect(summary.destroyedTotal).toBe(3);
    expect(builtTotal(mixed.destroyedByCategory)).toBe(3);
    expect(claimProblem({ type: 'count', what: 'destroyed', value: summary.destroyedTotal }, ctx4({ evidence: mixed }))).toBeNull();
  });

  it('rejects casualties and people inside structures', () => {
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} The family died that night.` })).toContain('casualty');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} Ines was inside when the water came.` })).toContain('people-inside');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} Children were still at home.` })).toContain('people-inside');
  });

  it('rejects numbers that come from nowhere, and accepts ones from the run or a cited record', () => {
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} Forty-two houses went.` })).toContain('number');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} It was 2044.` })).toContain('number');
    // 14 collisions and 2031 (the cited letter's date) are both grounded.
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} Fourteen times it struck something. March 2031.` })).not.toContain('number');
  });

  it('rejects characters, places and revelations before their chapter', () => {
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} Aldo Brant watched from the pier.` })).toContain('early-character');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} Far off lay Harrow Bay.` })).toContain('early-location');
    const reveal = `${GOOD_TEXT} The readings were filed every spring at the regional office and never opened.`;
    expect(codes({ ...GOOD_DRAFT, text: reveal })).toContain('early-revelation');
    // The same sentence is fine once its chapter has come.
    const ctx9 = ctx4({ mode: 'reflection', chapter: chapterOf('ch9-last-thaw'), evidence: ch9Evidence(), history: [CH1_HISTORY, CH4_HISTORY] });
    const d9: NarrativeDraft = {
      title: 'The Pier',
      text: `${'The pier at Harrow Bay went into the water at dusk. '.repeat(6)}The readings were filed every spring at the regional office and never opened.`,
      fragmentIds: [],
      factIds: [],
      claims: [{ type: 'landmark', landmarkId: 'harrow-pier', status: 'destroyed' }],
    };
    expect(codes(d9, ctx9)).not.toContain('early-revelation');
  });

  it('flags unknown names', () => {
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} Later, Marguerite Okafor wrote back.` })).toContain('unknown-name');
  });

  it('reads "left standing" against the landmark it is said of; naming a landmark needs a claim', () => {
    const noChapel = GOOD_CLAIMS.filter((c) => !(c.type === 'landmark' && c.landmarkId === 'mill-chapel'));
    expect(codes({ ...GOOD_DRAFT, claims: noChapel })).toContain('undeclared-landmark');
    // The chapel destroyed in the run: "The chapel on Mill Lane was left standing" is false, whatever is claimed.
    const chapelGone = ch4Evidence({
      landmarks: [
        { id: 'vey-house', status: 'destroyed', closest: 0 },
        { id: 'mill-chapel', status: 'destroyed', closest: 0 },
      ],
    });
    const claims = GOOD_CLAIMS.flatMap((c): NarrativeClaim[] =>
      c.type === 'landmark' && c.landmarkId === 'mill-chapel' ? [{ ...c, status: 'destroyed' }] : c.type === 'fragment' && c.fragmentId === 'ch4-chapel-notice' ? [] : [c],
    );
    expect(codes({ ...GOOD_DRAFT, claims, fragmentIds: ['ch4-vey-letter'] }, ctx4({ evidence: chapelGone }))).toContain('spared');
    // Survival said of nothing named still needs some true intact claim.
    const unnamed = { ...GOOD_DRAFT, text: GOOD_TEXT.replace('The chapel on Mill Lane was left standing', 'Something was left standing'), claims: noChapel };
    expect(codes(unnamed)).toContain('spared');
  });

  it('rejects secrets, the canary, URLs and machinery', () => {
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} SECRET-CANARY-TEST-123456` })).toContain('secret');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} The PORTKEY_API_KEY is hidden.` })).toContain('secret');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} See https://example.com for more.` })).toContain('url');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} I used get_run_summary.` })).toContain('meta');
  });

  it('checks which records may be cited', () => {
    // The chapel notice only applies when the chapel is intact.
    const chapelGone = ch4Evidence({
      landmarks: [
        { id: 'vey-house', status: 'destroyed', closest: 0 },
        { id: 'mill-chapel', status: 'destroyed', closest: 0 },
      ],
    });
    expect(codes(GOOD_DRAFT, ctx4({ evidence: chapelGone }))).toContain('claim-fragment');
    // Untrusted entries can never be cited.
    const injected = { ...GOOD_DRAFT, fragmentIds: ['ch4-injected-note'] };
    expect(codes(injected, ctx4({ story: FIXTURE_STORY_WITH_INJECTION }))).toContain('fragment');
    // Earlier records only if the player saw them; later ones never.
    const seen = { ...GOOD_DRAFT, claims: [...GOOD_CLAIMS, { type: 'fragment', fragmentId: 'ch1-gauge-log' } as const] };
    expect(codes(seen)).not.toContain('claim-fragment');
    expect(codes(seen, ctx4({ history: [] }))).toContain('claim-fragment');
    expect(codes({ ...GOOD_DRAFT, fragmentIds: ['ch9-pier-photo'] })).toContain('fragment');
    expect(codes({ ...GOOD_DRAFT, factIds: ['not-a-fact'] })).toContain('fact');
  });

  it('checks history claims against the saved record', () => {
    const h = (status: 'intact' | 'destroyed', chapterId: 'ch1-beginning' | 'ch9-last-thaw' = 'ch1-beginning'): string[] =>
      codes({ ...GOOD_DRAFT, claims: [...GOOD_CLAIMS, { type: 'history', chapterId, landmarkId: 'gauge-hut', status }] });
    expect(h('intact')).not.toContain('claim-history');
    expect(h('destroyed')).toContain('claim-history');
    expect(h('intact', 'ch9-last-thaw')).toContain('claim-history');
  });

  it('enforces length bounds per mode and requires grounding', () => {
    expect(codes({ ...GOOD_DRAFT, text: 'Too short. The chapel on Mill Lane was left standing.' })).toContain('length');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} ${GOOD_TEXT}` })).toContain('length');
    expect(codes(GOOD_DRAFT, ctx4({ mode: 'epilogue', chapter: chapterOf('ch9-last-thaw'), evidence: ch9Evidence() }))).toContain('length');
    const ungrounded = { ...GOOD_DRAFT, claims: GOOD_CLAIMS.filter((c) => c.type === 'fragment') };
    expect(codes(ungrounded)).toContain('ungrounded');
  });
});

describe('helpers', () => {
  it('extracts digits and number words, skipping a lone "one"', () => {
    const v = (t: string): number[] => extractNumbers(t).map((n) => n.value);
    expect(v('twenty-three houses and 1,200 tonnes in 2031')).toEqual(expect.arrayContaining([23, 1200, 2031]));
    expect(v('no one came; one morning')).toEqual([]);
    expect(v('a hundred and five')).toEqual([105]);
  });

  it('counts words', () => {
    expect(wordCount("It's 4.5 m, the Vey house.")).toBe(6);
  });

  it('evaluates fragment conditions, including history and combinators', () => {
    const ev = ch4Evidence();
    expect(fragmentApplies({ all: [{ outcome: 'complete' }, { destroyedAtLeast: 3, categories: ['home'] }] }, ev, [])).toBe(true);
    expect(fragmentApplies({ any: [{ waterfallsAtLeast: 5 }, { grewAtLeast: 1.5 }] }, ev, [])).toBe(true);
    expect(fragmentApplies({ not: { landmark: 'vey-house', status: 'destroyed' } }, ev, [])).toBe(false);
    expect(fragmentApplies({ history: { landmark: 'kell-footbridge', status: 'destroyed' } }, ev, [CH1_HISTORY])).toBe(true);
    expect(fragmentApplies({ history: { landmark: 'kell-footbridge', status: 'destroyed' } }, ev, [])).toBe(false);
    expect(fragmentApplies({ landmark: 'unknown', status: 'notReached' }, ev, [])).toBe(true);
  });
});

/**
 * The validator on the REAL story (bible, nine chapters, epilogue parts). Its job is to reject invented
 * facts, not good writing: every authored fallback reflection of the AI chapters and every epilogue
 * part (the voice the agents are asked to match) passes the text checks wherever its own condition
 * holds, and each false rejection found on real content stays fixed. The safety rules stay strict.
 */
describe('validateNarrative on the real story', () => {
  const realEv = (ch: ChapterDef, status: LandmarkStatus): RunEvidence =>
    evidenceFixture({
      chapterId: ch.id,
      levelId: ch.levelId,
      landmarks: ch.landmarks.map((l) => ({ id: l.id, status, closest: status === 'destroyed' ? 0 : 20 })),
      destroyedByCategory: status === 'destroyed' ? { home: 6, extraction: 4, transport: 3, community: 2, nature: 5 } : { nature: 1 },
      // The heavy run gathered ice (three times its start), so the parts about weight can hold.
      ...(status === 'destroyed' ? { peakMass: 90 } : {}),
    });
  const realHistory = (upTo: number, status: LandmarkStatus): HistoryItem[] =>
    CHAPTERS.slice(0, upTo).map((c) => ({
      chapterId: c.id,
      outcome: 'complete',
      storyPoints: 300,
      destroyedByCategory: status === 'destroyed' ? { home: 3 } : {},
      landmarks: c.landmarks.map((l) => ({ id: l.id, status, closest: 1 })),
      fragmentIds: c.fragments.filter((f) => !f.untrusted).map((f) => f.id),
      reflectionExcerpt: '',
    }));
  const realCtx = (i: number, status: LandmarkStatus = 'intact', mode: 'reflection' | 'epilogue' = 'reflection'): ValidationContext => ({
    mode,
    chapter: CHAPTERS[i],
    evidence: realEv(CHAPTERS[i], status),
    history: realHistory(i, status),
    story: STORY,
  });
  /** A draft that cites everything the player has seen and declares every landmark truthfully. */
  const realDraft = (ctx: ValidationContext, text: string): NarrativeDraft => ({
    title: 'Notes',
    text,
    fragmentIds: [
      ...ctx.chapter.fragments.filter((f) => !f.untrusted && fragmentApplies(f.when, ctx.evidence, ctx.history)).map((f) => f.id),
      ...ctx.history.flatMap((h) => h.fragmentIds),
    ],
    factIds: [],
    claims: [
      ...ctx.evidence.landmarks.map((l): NarrativeClaim => ({ type: 'landmark', landmarkId: l.id, status: l.status })),
      ...ctx.history.flatMap((h) =>
        h.landmarks.map((l): NarrativeClaim => ({ type: 'history', chapterId: h.chapterId, landmarkId: l.id, status: l.status })),
      ),
    ],
  });
  const realIssues = (ctx: ValidationContext, text: string) => validateNarrative(realDraft(ctx, text), ctx, ['continuity', 'events', 'safety']).issues;
  const realCodes = (ctx: ValidationContext, text: string): string[] => realIssues(ctx, text).map((i) => i.code);

  it('accepts the authored reflections of the AI chapters (1, 4, 6, 9) and every epilogue part', () => {
    const problems: string[] = [];
    for (const i of [0, 3, 5, 8]) {
      for (const status of ['destroyed', 'intact'] as const) {
        const ctx = realCtx(i, status);
        for (const r of CHAPTERS[i].fallbackReflections) {
          if (!fragmentApplies(r.when, ctx.evidence, ctx.history)) continue;
          const c = realIssues(ctx, r.body).map((x) => x.message);
          if (c.length) problems.push(`${r.id} [${status}]: ${c.join('; ')}`);
        }
      }
    }
    // Epilogue parts likewise where their own condition holds: the prose is now read against the record,
    // so "You left No. 14 standing" fails (rightly) beside a destroyed house.
    // The epilogue follows a completed chapter 9, so its outcome is always 'complete'. The third history is
    // the usual playthrough: No. 14 stood, and the Clachan's power station (on every route) did not.
    const checkedParts = new Set<string>();
    const stationGone = (h: readonly HistoryItem[]): HistoryItem[] =>
      h.map((x) => ({ ...x, landmarks: x.landmarks.map((l) => (l.id === 'clachan-station' ? { ...l, status: 'destroyed' as const } : l)) }));
    for (const [status, mixed] of [['destroyed', false], ['intact', false], ['intact', true]] as const) {
      const base = realCtx(8, status, 'epilogue');
      const ctx = mixed ? { ...base, history: stationGone(base.history) } : base;
      for (const p of EPILOGUE_PARTS) {
        if (!fragmentApplies(p.when, ctx.evidence, ctx.history)) continue;
        checkedParts.add(p.id);
        const c = realIssues(ctx, p.text).map((x) => x.message);
        if (c.length) problems.push(`${p.id} [${status}]: ${c.join('; ')}`);
      }
    }
    expect(problems).toEqual([]);
    expect([...checkedParts].sort()).toEqual(EPILOGUE_PARTS.map((p) => p.id).sort());
  });

  it('never lets the archivist be named before chapter 8, though she appears from chapter 1', () => {
    const text = 'I keep the notebooks in a box under the window, and I am Mara, if you had not guessed. The hut was empty.';
    for (const i of [0, 3, 5, 6]) expect(realCodes(realCtx(i), text), CHAPTERS[i].id).toContain('early-character');
    expect(realCodes(realCtx(7), text)).not.toContain('early-character');
    expect(realCodes(realCtx(8), text)).not.toContain('early-character');
    // "Vey" is the family's name from chapter 4 (No. 14, Ruth, Elias): there only "Mara" gives her away.
    expect(realCodes(realCtx(3), 'The Vey house had a piano and a calendar.')).not.toContain('early-character');
    expect(realCodes(realCtx(0), 'The Vey house had a piano and a calendar.')).toContain('early-character');
    // The revision note names the chapter that reveals her NAME (she appears from chapter 1).
    const note = realIssues(realCtx(3), text).find((i) => i.code === 'early-character')?.message;
    expect(note).toBe('"Mara" is not named in the story until ch8-remains');
  });

  it('rejects a bare initial and a word that needs explaining, as the authored text is tested (the playtest)', () => {
    const formCodes = (i: number, text: string, mode: 'reflection' | 'epilogue' = 'reflection'): string[] => {
      const ctx = realCtx(i, 'intact', mode);
      return validateNarrative(realDraft(ctx, text), ctx, ['form']).issues.map((x) => x.code);
    };
    // The student's own example, in a chapter 9 epilogue: once only the length was reported.
    expect(formCodes(8, 'E. drove the last train.', 'epilogue')).toContain('initial');
    expect(formCodes(8, 'Elias drove the last train, and Tomas Lind wrote "T.L." under his numbers.', 'epilogue')).toContain('initial');
    expect(formCodes(3, 'Nine ballots were spoilt, and the count went on past midnight.')).toContain('plain-words');
    expect(formCodes(7, 'The bothy above the Leap had a tin roof.')).toContain('plain-words');
    // Labels that end in a letter, and the pronoun, are not initials; plain words pass.
    const fine = 'The costs were in Annex F. Everyone met at Assembly Point B. Nobody heard the siren, and so did I.';
    expect(formCodes(2, fine)).not.toContain('initial');
    expect(formCodes(2, fine)).not.toContain('plain-words');
    // The full gate reports them too, with the other checks.
    const ctx = realCtx(8, 'intact', 'epilogue');
    expect(validateNarrative(realDraft(ctx, 'E. drove the last train.'), ctx).issues.map((x) => x.code)).toEqual(
      expect.arrayContaining(['length', 'initial']),
    );
  });

  it('reads plural weekdays and months as calendar words, not names', () => {
    expect(realCodes(realCtx(8), 'He washed the van on Saturdays and kept at it for many Septembers.')).not.toContain('unknown-name');
    expect(realCodes(realCtx(8), 'He washed the van for Saturdine on Fridays.')).toContain('unknown-name');
  });

  it('accepts the full names the records give, once the player has seen them (the playtest: no initials)', () => {
    // Chapter 1: Tomas Lind (the bible) and Jean Harper (the postcard on the chapter card).
    expect(realCodes(realCtx(0), 'Tomas Lind measured the stakes, and Jean Harper wrote home about the view.')).not.toContain('unknown-name');
    // Chapter 4: Ruth and Elias Vey are in the bible; the wardens' list (every run) names Daniel Okafor and Dorothy Pell.
    const wardens = 'Ruth Vey and her son Elias Vey were on the list with Daniel Okafor and Dorothy Pell.';
    expect(realCodes(realCtx(3), wardens)).not.toContain('unknown-name');
    expect(realCodes(realCtx(3), wardens)).not.toContain('early-character');
    // Sean Duffy signs the Station Court sheet, which is shown only when the block broke.
    expect(realCodes(realCtx(3, 'destroyed'), 'The warden, Sean Duffy, chalked every door.')).not.toContain('unknown-name');
    expect(realCodes(realCtx(3, 'intact'), 'The warden, Sean Duffy, chalked every door.')).toContain('unknown-name');
    // Chapter 8: Isla Munro, the keeper of the power station, from the log shown when it broke.
    expect(realCodes(realCtx(7, 'destroyed'), 'The keeper, Isla Munro, shut down both turbines.')).not.toContain('unknown-name');
    // A chapter 4 neighbour is still unknown in chapter 3.
    expect(realCodes(realCtx(2), 'Her neighbour Dorothy Pell brought shortbread.')).toContain('unknown-name');
  });

  it('treats "a few thousand" as a size, not a count; digits and exact number words still count', () => {
    const v = (t: string): number[] => extractNumbers(t).map((n) => n.value);
    expect(v('a few thousand small ones, and several hundred people')).toEqual([]);
    expect(v('a hundred houses, two thousand tonnes, 3000 more')).toEqual(expect.arrayContaining([100, 2000, 3000]));
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} It was a few thousand small decisions.` })).not.toContain('number');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} It was two thousand small decisions.` })).toContain('number');
  });

  it('allows numbers from what the player has read and the bible entries open at this chapter, never from a hidden backstory', () => {
    // Fixture: Tomas Reed's history (chapter 1) says "thirty years"; nothing says thirty-one.
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} Someone read the gauge for thirty years.` })).not.toContain('number');
    expect(codes({ ...GOOD_DRAFT, text: `${GOOD_TEXT} Someone read the gauge for thirty-one years.` })).toContain('number');
    // Real story: chapter 2's card and Tomas Lind's entry say "fifty-two"; nothing says fifty-three.
    expect(realCodes(realCtx(3), 'For fifty-two Septembers someone measured the ice.')).not.toContain('number');
    expect(realCodes(realCtx(3), 'For fifty-three Septembers someone measured the ice.')).toContain('number');
    // A backstory revealed later keeps its numbers closed until then (fixture: Ines Vey's, chapter 9).
    const bible = FIXTURE_STORY.bible;
    const story = {
      ...FIXTURE_STORY,
      bible: { ...bible, characters: bible.characters.map((c) => (c.id === 'ines-vey' ? { ...c, history: `${c.history} She kept seventeen boxes.` } : c)) },
    };
    const boxes = { ...GOOD_DRAFT, text: `${GOOD_TEXT} She kept seventeen boxes.` };
    expect(codes(boxes, ctx4({ story }))).toContain('number');
    const ctx9 = ctx4({ story, chapter: chapterOf('ch9-last-thaw'), evidence: ch9Evidence(), history: [CH1_HISTORY, CH4_HISTORY] });
    expect(validateNarrative(boxes, ctx9).issues.filter((i) => i.code === 'number')).toEqual([]);
  });

  it('does not call a place early when a record the player has read already names it', () => {
    // Riverside is chapter 4's town; chapter 3's bus timetable (shown when the post bus breaks) names it.
    const ch3 = (status: LandmarkStatus): ValidationContext => ({ ...realCtx(2, status), history: [] });
    expect(realCodes(ch3('destroyed'), 'The bus ran to Riverside twice daily.')).not.toContain('early-location');
    expect(realCodes(ch3('intact'), 'The bus ran to Riverside twice daily.')).toContain('early-location');
    expect(realCodes(realCtx(0), 'The water went on towards Riverside.')).toContain('early-location');
  });

  it('"asleep on a train" is not "inside"; asleep in a house still is', () => {
    const ctx8 = realCtx(7, 'destroyed');
    expect(realCodes(ctx8, "When No. 14 went, I was asleep on four boxes in a guard's van.")).not.toContain('people-inside');
    for (const t of [
      'When No. 14 went, the family was asleep in the house by the train line.',
      'They were sleeping in their beds above the bus depot when it broke.',
      'She was asleep upstairs when the water came.',
      'They were asleep on the train, and the Pells were still inside.',
    ]) {
      expect(realCodes(ctx8, t), t).toContain('people-inside');
    }
  });

  /** Number issues for a draft that cites one approved fact. */
  const numberIssues = (factId: string, text: string, ctx: ValidationContext = realCtx(8)): string[] =>
    validateNarrative({ ...realDraft(ctx, text), factIds: [factId] }, ctx, ['events'])
      .issues.filter((i) => i.code === 'number')
      .map((i) => i.message);

  it('reads digits the way science.ts lists them: every digit run as printed', () => {
    // science.test.ts: /\d+(?:[.,]\d+)*/ over the statement must equal the fact's `numbers`.
    const scienceRuns = (t: string): string[] => t.match(/\d+(?:[.,]\d+)*/g) ?? [];
    for (const f of CLIMATE_FACTS) {
      expect(digitRuns(f.statement), f.id).toEqual(scienceRuns(f.statement));
      expect(new Set(digitRuns(f.statement)), f.id).toEqual(new Set(f.numbers));
    }
    for (const t of ['1.1°C above 1850–1900 in 2011–2020', '2023/24 was the 37th year', '1,200 tonnes', '21.10.2031', '3,4 and 5']) {
      expect(digitRuns(t), t).toEqual(scienceRuns(t));
      // Every number the validator reads from digits comes from one of those runs.
      const fromDigits = extractNumbers(t).filter((n) => /\d/.test(n.raw));
      expect(fromDigits.every((n) => scienceRuns(t).includes(n.raw)), t).toBe(true);
    }
    const v = (t: string): number[] => extractNumbers(t).map((n) => n.value);
    expect(v('1,200 tonnes')).toEqual([1200]);
    expect(v('3,4 and 5')).toEqual([3, 4, 5]);
    expect(v('on 21.10.2031')).toEqual([21, 10, 2031]);
    expect(v('1.1°C')).toEqual([1.1]);
  });

  it('a faithful quote of every approved fact passes the number check; a changed number fails', () => {
    const problems: string[] = [];
    for (const f of CLIMATE_FACTS) {
      const bad = numberIssues(f.id, `A line the record keeps from ${f.source.org}: “${f.statement}”`);
      if (bad.length > 0) problems.push(`${f.id}: ${bad.join('; ')}`);
    }
    expect(problems).toEqual([]);

    const changes: readonly [string, string, string][] = [
      ['human-caused-warming', '1.1°C', '1.7°C'],
      ['glacier-loss-accelerating', '37th', '57th'],
      ['ice-sheets-shrinking', '279 billion', '297 billion'],
      ['sea-level-land-ice', '(21–24 centimeters)', '(21–94 centimeters)'],
    ];
    for (const [id, from, to] of changes) {
      const f = CLIMATE_FACTS.find((x) => x.id === id)!;
      expect(f.statement, id).toContain(from);
      expect(numberIssues(id, f.statement), id).toEqual([]);
      expect(numberIssues(id, f.statement.replace(from, to)).length, `${id}: ${to}`).toBeGreaterThan(0);
    }
    // The same quote without citing the fact: its numbers are not the run's, so they fail.
    const sea = CLIMATE_FACTS.find((x) => x.id === 'sea-level-land-ice')!;
    const ctx = realCtx(8);
    expect(validateNarrative(realDraft(ctx, sea.statement), ctx, ['events']).issues.map((i) => i.code)).toContain('number');
  });

  it('a number the cited statement writes as a word ("the last three complete decades") is the statement’s too', () => {
    // A statement whose words carry numbers nothing else in the context allows.
    const fact = {
      ...CLIMATE_FACTS[0],
      id: 'test-worded-fact',
      statement: 'Thirteen of the seventeen reference glaciers lost ice in 2023.',
      numbers: ['2023'],
    };
    const ctx: ValidationContext = { ...realCtx(0), story: { ...STORY, facts: [...STORY.facts, fact] } };
    expect(numberIssues(fact.id, fact.statement, ctx)).toEqual([]);
    expect(numberIssues(fact.id, 'Thirteen of the eighty-three reference glaciers lost ice in 2023.', ctx)).toHaveLength(1);
    expect(numberIssues(fact.id, 'Thirteen of the seventeen reference glaciers lost ice in 2051.', ctx)).toHaveLength(1);
    // Not cited, the statement's numbers are nobody's.
    expect(numberIssues('human-caused-warming', fact.statement, ctx)).toHaveLength(3);
  });
});

/**
 * The prose against the evidence, on a REAL run: the chapter 4 request saved by the live agent runs
 * (docs/evidence/runs: steered through No. 14 and the Pells' house; the dam breached; St Bride's and the
 * harbour light standing) and the draft the agents had approved for it. Each probe keeps the draft's
 * true claims and changes only the prose, as a model could, so only reading the prose catches it.
 */
const RUNS = fileURLToPath(new URL('../../docs/evidence/runs/', import.meta.url));

/**
 * A saved live run as the final gate saw it: its request (validated as the server does) and its result.
 * The request's history is replayed as today's client sends the same archive (select.ts
 * currentHistoryItem): runs saved before chapter 8's Gorge bridge and post van log were replaced by the
 * power station name those ids, which the current story no longer has.
 */
function savedRun(file: string): { ctx: ValidationContext; draft: NarrativeDraft; ok: boolean } {
  const j = JSON.parse(readFileSync(`${RUNS}${file}`, 'utf8'));
  const mode = j.mode as 'reflection' | 'epilogue';
  const request = { ...j.request, history: (j.request.history as HistoryItem[]).map((h) => currentHistoryItem(h)) };
  const checked = mode === 'epilogue' ? checkEpilogueRequest(request, STORY) : checkReflectRequest(request, STORY);
  if (!checked.ok) throw new Error(`${file}: ${checked.errors.join('; ')}`);
  const level = levelSummaryFor(checked.value.chapter);
  const ctx: ValidationContext = {
    mode,
    ...checked.value,
    story: STORY,
    extraNumbers: level?.structures.map((s) => s.count) ?? [],
    extraNames: level ? [level.name] : [],
  };
  const r = j.result;
  return { ctx, ok: r.ok === true, draft: { title: r.title ?? '', text: r.text ?? '', fragmentIds: r.fragmentIds ?? [], factIds: r.factIds ?? [], claims: r.claims ?? [] } };
}

describe('the prose against the evidence (the real chapter 4 run and its approved draft)', () => {
  const { ctx, draft } = savedRun('ch4-through-lt-20261021-094235-60dc7c.json');
  const issueCodes = (d: NarrativeDraft, c: ValidationContext = ctx): string[] => validateNarrative(d, c).issues.map((i) => i.code);
  const withText = (text: string, over: Partial<NarrativeDraft> = {}): NarrativeDraft => ({ ...draft, text, ...over });
  const status = (id: string): LandmarkStatus | undefined => ctx.evidence.landmarks.find((l) => l.id === id)?.status;

  it('the run and the approved draft are what the probes assume', () => {
    expect([status('vey-house'), status('pell-house'), status('riverside-dam'), status('st-brides'), status('harbour-light')]).toEqual([
      'destroyed', 'destroyed', 'destroyed', 'intact', 'intact',
    ]);
    expect(ctx.evidence.destroyedByCategory.home).toBe(7);
    expect(validateNarrative(draft, ctx).issues).toEqual([]);
    expect(draft.text).toContain('St Bride’s remained intact.');
  });

  it('(A) survival said of a destroyed landmark fails, though another landmark is truly intact', () => {
    const text = draft.text.replace('You broke No. 14, then the Pells’ house next door.', "You broke the Pells' house next door; No. 14 Church Lane still stands.");
    expect(text).not.toBe(draft.text);
    expect(issueCodes(withText(text))).toContain('spared');
    // In one clause too: the survival word goes with the landmark beside it.
    expect(issueCodes(withText(text.replace(';', ' and')))).toContain('spared');
  });

  it('(B) breaking said of an intact landmark fails', () => {
    expect(issueCodes(withText(draft.text.replace('St Bride’s remained intact.', "St Bride's came down in the night.")))).toContain('broken');
    expect(issueCodes(withText(draft.text.replace('Later, Riverside dam gave way.', 'Later, the harbour light gave way.')))).toContain('broken');
  });

  it('St Bride’s: a curly apostrophe and a short name still name it, and its status is read', () => {
    const gone = { ...ctx, evidence: { ...ctx.evidence, landmarks: ctx.evidence.landmarks.map((l) => (l.id === 'st-brides' ? { ...l, status: 'destroyed' as const } : l)) } };
    const d = {
      ...draft,
      fragmentIds: draft.fragmentIds.filter((f) => f !== 'ch4-church-notices'),
      claims: draft.claims.filter((c) => !(c.type === 'landmark' && c.landmarkId === 'st-brides') && !(c.type === 'fragment' && c.fragmentId === 'ch4-church-notices')),
      text: draft.text.replace(' Its hall opened as a rest point, with the tea urn on from five.', ''),
    };
    const got = issueCodes(d, gone);
    expect(got).toContain('spared');
    expect(got).toContain('undeclared-landmark');
  });

  it('(C) a count of what broke must be the run’s or the history’s, not any number in the bag', () => {
    // 10 is a number of the run (collisions, knocked down), but 7 homes broke.
    expect(ctx.evidence.collisions).toBe(10);
    for (const t of ['You broke ten homes.', 'You broke 10 homes.', 'Ten houses went.']) {
      expect(issueCodes(withText(`${draft.text} ${t}`)), t).toContain('prose-count');
    }
    expect(issueCodes(withText(`${draft.text} You broke seven homes.`))).not.toContain('prose-count');
    // Not a count of what broke: a year, a total, a record's own number.
    for (const t of ['The 1952 dam gave way.', 'Two of the three houses broke.']) {
      expect(issueCodes(withText(`${draft.text} ${t}`)), t).not.toContain('prose-count');
    }
  });

  it('(D) "nobody got out", "under that roof": people inside, however it is phrased', () => {
    for (const t of ["Nobody got out of the Pells' house.", 'Mrs Pell was under that roof when it went.', 'She never made it out.', 'Two of the wardens went missing.']) {
      const got = issueCodes(withText(`${draft.text} ${t}`));
      expect(got.some((c) => c === 'people-inside' || c === 'casualty'), t).toBe(true);
    }
    // The record's own line stays allowed.
    expect(issueCodes(withText(`${draft.text} All of them got out.`))).not.toContain('people-inside');
  });

  it('(E) an invented person at the start of a sentence, or in the title, is an unknown name', () => {
    expect(issueCodes(withText(`${draft.text} Margaret held the ladder for her.`))).toContain('unknown-name');
    expect(issueCodes({ ...draft, title: 'Margaret Thornbury of Elmfield' })).toContain('unknown-name');
    // Ordinary words in Title Case and at sentence starts are not names.
    expect(issueCodes({ ...draft, title: 'What the Chalk Kept' })).not.toContain('unknown-name');
    expect(issueCodes(withText(`${draft.text} Afterwards, nobody argued.`))).not.toContain('unknown-name');
  });

  it('(F) real climate science needs a cited, approved fact', () => {
    const science = 'The world’s glaciers have been losing ice faster every decade, and the seas are rising faster than ever measured.';
    expect(issueCodes(withText(`${draft.text} ${science}`))).toContain('uncited-science');
    expect(issueCodes(withText(`${draft.text} ${science}`, { factIds: ['glacier-loss-accelerating'] }))).not.toContain('uncited-science');
  });

  it('the title gets the same checks as the text: survival words, landmark names', () => {
    expect(issueCodes({ ...draft, title: 'No. 14 Church Lane Still Stands' })).toContain('spared');
    const noStBrides = { ...draft, claims: draft.claims.filter((c) => !(c.type === 'landmark' && c.landmarkId === 'st-brides')) };
    expect(issueCodes({ ...noStBrides, title: "St Bride's, the church on the hill", text: draft.text.replace(' St Bride’s remained intact. Its hall opened as a rest point, with the tea urn on from five.', '') })).toContain(
      'undeclared-landmark',
    );
  });

  it('"you saved Riverside" needs Riverside whole, not one unrelated intact landmark', () => {
    const text =
      'You came down through Riverside in the early morning, and I will say it plainly: you saved Riverside, the whole of it. ' +
      'The wardens had chalked every door by six, and the harbour light was still turning when the water reached the quay. ' +
      'I have the wardens’ list on my desk, and the chalk beside it. The list is in pencil. It always was.';
    const saved: NarrativeDraft = { title: 'The Quay', text, fragmentIds: [], factIds: [], claims: [{ type: 'landmark', landmarkId: 'harbour-light', status: 'intact' }] };
    expect(issueCodes(saved)).toContain('spared');
    expect(issueCodes({ ...saved, text: text.replace('you saved Riverside, the whole of it', 'the town survived') })).toContain('spared');
    // A run that broke nothing in Riverside and reached every landmark of it: then it may be said. (The
    // saved run predates the overlay's three landmarks: unlisted, they were not reached, so not whole.)
    const whole = {
      ...ctx,
      evidence: { ...ctx.evidence, destroyedByCategory: {}, destroyedByKind: {}, landmarks: ctx.chapter.landmarks.map((l) => ({ id: l.id, status: 'intact' as const, closest: 20 })) },
    };
    expect(issueCodes(saved, whole)).not.toContain('spared');
    const unlisted = { ...whole, evidence: { ...whole.evidence, landmarks: ctx.evidence.landmarks.map((l) => ({ ...l, status: 'intact' as const })) } };
    expect(issueCodes(saved, unlisted)).toContain('spared');
  });

  it('negation turns a status word round', () => {
    expect(issueCodes(withText(`${draft.text} No. 14 was not spared.`))).not.toContain('spared');
    expect(issueCodes(withText(`${draft.text} St Bride's was not spared.`))).toContain('spared');
    expect(issueCodes(withText(`${draft.text} St Bride's was never damaged.`))).not.toContain('broken');
  });
});

describe('an archive saved by an earlier version of the story', () => {
  it('still makes a request the server accepts: removed landmarks and fragments are left out', () => {
    // Saved before chapter 8's Gorge bridge and post van log were replaced by the power station.
    const j = JSON.parse(readFileSync(`${RUNS}ch9-lt-20261021-092217-3e3d7f.json`, 'utf8'));
    const raw = j.request.history as HistoryItem[];
    const problems = historyProblems(raw, 'ch9-last-thaw', STORY);
    expect(problems.join('\n')).toMatch(/gorge-bridge/);
    expect(problems.join('\n')).toMatch(/ch8-post-van-log/);
    const today = raw.map((h) => currentHistoryItem(h));
    expect(historyProblems(today, 'ch9-last-thaw', STORY)).toEqual([]);
    // Only the removed ids go: the rest of chapter 8's record is kept as it was.
    const before = raw.find((h) => h.chapterId === 'ch8-remains');
    const after = today.find((h) => h.chapterId === 'ch8-remains');
    expect(after?.landmarks.map((l) => l.id)).toEqual(before?.landmarks.map((l) => l.id).filter((id) => id !== 'gorge-bridge'));
    expect(after?.fragmentIds).toEqual(before?.fragmentIds.filter((id) => CHAPTERS[7].fragments.some((f) => f.id === id)));
    expect(after?.reflectionExcerpt).toBe(before?.reflectionExcerpt);
  });
});

describe('the approved real AI narratives (docs/evidence/runs)', () => {
  it('every approved text still passes the final gate on its own saved request', () => {
    const files = readdirSync(RUNS).filter((f) => f.endsWith('.json'));
    const approved = files.map((f) => ({ f, ...savedRun(f) })).filter((r) => r.ok);
    // 12 from 2026-10-21, the chapter 1 check of the plain-English instructions (2026-10-23), and the
    // chapter 7 check of the second playtest's words and world condition (2026-10-24).
    expect(approved.length).toBe(14);
    const issues = approved.flatMap(({ f, draft, ctx }) => validateNarrative(draft, ctx).issues.map((i) => ({ f, code: i.code, message: i.message })));
    // The plain-English checks (the playtest of 2026-10-23) came after the 2026-10-21 runs and now catch
    // the very words the student stumbled on in them; every other check still passes every approved text,
    // but one: the chapter 7 run of 2026-10-24 was told the Red Mesa's snow was grey, and the Red Mesa has
    // no snow (playtest 2 review). The corrected world rejects its snow sentence (docs/evidence/AGENT_RUNS.md).
    const plain = new Set(['initial', 'plain-words']);
    const CH7_SNOW = 'ch7-lt-20261024-162130-2d719a.json';
    expect(issues.filter((i) => i.f === CH7_SNOW).map((i) => i.message)).toEqual([
      '"snow is grey" is not how this chapter looks: it has no snow (the world\'s condition)',
      '"snow" is not how this chapter looks: it has no snow (the world\'s condition)',
    ]);
    expect(
      issues.filter((i) => !plain.has(i.code) && i.f !== CH7_SNOW).map((i) => `${i.f}: ${i.code}: ${i.message}`),
    ).toEqual([]);
    expect(issues.filter((i) => plain.has(i.code)).map((i) => `${i.f}: ${i.message.split(':')[0]}`)).toEqual([
      'ch4-round-lt-20261021-094317-16a398.json: "knoll"',
      'ch6-lt-20261021-092108-91f79f.json: "bund"',
      'ch6-lt-20261021-095113-f46bab.json: "Bund"',
      'epilogue-lt-20261021-093343-5ae523.json: "spoilt"',
      'epilogue-lt-20261021-094814-3d26cc.json: "bothy"',
    ]);
    // The runs made under the plain-English instructions pass them.
    expect(issues.filter((i) => !i.f.includes('-20261021-') && i.f !== CH7_SNOW)).toEqual([]);
  });
});
