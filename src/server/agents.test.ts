import { describe, expect, it } from 'vitest';
import type { NarrativeClaim, NarrativeFailure, NarrativeResult } from '../story/types';
import type { NarrativeDraft } from '../story/validate';
import { BIBLE } from '../story/bible';
import { CHAPTERS } from '../story/chapters';
import { ARCHIVIST_INSTRUCTIONS, generateNarrative, HISTORIAN_INSTRUCTIONS, type NarrativeDeps } from './agents';
import { loadConfig } from './config';
import type { CheckedRequest } from './contracts';
import { Budget, type ResponsesRequest, type Transport } from './llm';
import { SpendCap } from './spend';
import { memoryLogger } from './log';
import { answer, callTools, fakeTransport, type Step } from './testing/fakeTransport';
import {
  CH1_HISTORY,
  ch4Evidence,
  CH4_HISTORY,
  ch9Evidence,
  chapterOf,
  FIXTURE_LEVEL,
  FIXTURE_STORY,
  GOOD_CLAIMS,
  GOOD_DRAFT,
  GOOD_TEXT,
} from './testing/fixtureStory';

const KEY = 'pk-test-agents-0123456789';
// Two Historian rounds, whatever the default, so the scripted conversations stay exact.
const config = loadConfig('.', { PORTKEY_API_KEY: KEY }, { maxHistorianRounds: 2 });

function setup(transport: Transport | undefined, over: Partial<NarrativeDeps> = {}) {
  const logger = memoryLogger();
  const deps: NarrativeDeps = {
    config,
    transport,
    story: FIXTURE_STORY,
    level: () => FIXTURE_LEVEL,
    budget: new Budget({ maxRequests: 100, dailyTokens: 1_000_000 }),
    logger,
    newRunId: () => 'lt-test-run',
    ...over,
  };
  return { deps, logger };
}

const ch4Request: CheckedRequest = { chapter: chapterOf('ch4-people'), evidence: ch4Evidence(), history: [CH1_HISTORY] };

/** Archivist: look at the run, then answer with `draft`. */
const archivistLooksThenWrites = (draft: NarrativeDraft): Step[] => [
  () => callTools([{ name: 'get_run_summary' }, { name: 'get_archive_fragments' }]),
  () => answer(draft),
];
/** Historian: run both deterministic checks, then give `verdict`. */
const historianChecksThen = (verdict: 'approve' | 'revise', issues: string[] = []): Step[] => [
  () => callTools([{ name: 'validate_narrative_events' }, { name: 'check_narrative_continuity' }]),
  () => answer({ verdict, issues }),
];

const toolOutputs = (req: ResponsesRequest): { ok: boolean; result?: { passed?: boolean }; error?: string }[] =>
  req.input.filter((i) => 'type' in i && i.type === 'function_call_output').map((i) => JSON.parse((i as { output: string }).output));

const BAD_DRAFT: NarrativeDraft = {
  ...GOOD_DRAFT,
  text: GOOD_TEXT.replace('three in all', 'four in all'),
  claims: GOOD_CLAIMS.map((c): NarrativeClaim => (c.type === 'count' ? { ...c, value: 4 } : c)),
};

describe('Archivist → Historian handoff', () => {
  it('approve path: tools are called, the Historian approves, validation passes, usage and trace are logged', async () => {
    const t = fakeTransport({ archivist: archivistLooksThenWrites(GOOD_DRAFT), historian: historianChecksThen('approve') });
    const { deps, logger } = setup(t);
    const r = (await generateNarrative('reflection', ch4Request, deps)) as NarrativeResult;
    expect(r.ok).toBe(true);
    expect(r.text).toBe(GOOD_TEXT);
    expect(r.review).toEqual({ verdict: 'approved', rounds: 1, issues: [] });
    expect(r.validation.passed).toBe(true);
    expect(r.toolCalls.map((c) => `${c.agent}:${c.tool}`)).toEqual([
      'archivist:get_run_summary',
      'archivist:get_archive_fragments',
      'historian:validate_narrative_events',
      'historian:check_narrative_continuity',
    ]);
    // The Historian's checking tools really ran on the draft.
    const hist = t.requests.filter((q) => q.instructions.startsWith('You are the Historian'));
    expect(toolOutputs(hist[1]).map((o) => o.result?.passed)).toEqual([true, true]);
    // The draft reached the Historian as data inside its user message.
    expect(JSON.stringify(hist[0].input)).toContain('What Mill Lane Kept');
    // One usage record per agent invocation, from the fake usage objects; a trace with every step.
    expect(r.usage.map((u) => u.agent)).toEqual(['archivist', 'historian']);
    expect(r.usage[0]).toMatchObject({ inputTokens: 1300, outputTokens: 240, requests: 2, toolCalls: 2, ok: true });
    expect(logger.usage).toHaveLength(2);
    const trace = logger.traces.get('lt-test-run') as { steps: { kind: string }[]; result: { ok: boolean } };
    expect(trace.result.ok).toBe(true);
    expect(new Set(trace.steps.map((s) => s.kind))).toEqual(new Set(['request', 'tool', 'draft', 'review', 'validation', 'final']));
  });

  it('revise path: the Historian finds the wrong count, the Archivist rewrites, the second review approves', async () => {
    const t = fakeTransport({
      archivist: [...archivistLooksThenWrites(BAD_DRAFT), () => answer(GOOD_DRAFT)],
      historian: [
        ...historianChecksThen('revise', ['Claim 3 says four homes were destroyed; the run shows three.']),
        ...historianChecksThen('approve'),
      ],
    });
    const { deps } = setup(t);
    const r = (await generateNarrative('reflection', ch4Request, deps)) as NarrativeResult;
    expect(r.ok).toBe(true);
    expect(r.review.verdict).toBe('corrected');
    expect(r.review.rounds).toBe(2);
    // The player sees the Historian's sentence and the failed check by its label (the trace keeps the message).
    expect(r.review.issues).toContain('Claim 3 says four homes were destroyed; the run shows three.');
    expect(r.review.issues).toContain('Deterministic check: a count did not match your run.');
    // The first Historian review saw the deterministic failure through its tool.
    const hist = t.requests.filter((q) => q.instructions.startsWith('You are the Historian'));
    expect(toolOutputs(hist[1])[0].result?.passed).toBe(false);
    // The rewrite request carried the issues to the Archivist.
    const rewrite = t.requests.filter((q) => !q.instructions.startsWith('You are the Historian'))[2];
    expect(JSON.stringify(rewrite.input)).toMatch(/four homes were destroyed/);
    expect(r.usage.map((u) => u.agent)).toEqual(['archivist', 'historian', 'archivist', 'historian']);
    // The second review knows it is the second (no voice issues now) and gets the first one's problems as data.
    const firstAsk = JSON.stringify(hist[0].input[0]);
    const secondAsk = t.requests.filter((q) => q.instructions.startsWith('You are the Historian')).find((q) => /review 2 of at most/.test(JSON.stringify(q.input[0])));
    expect(firstAsk).toMatch(/This is the first review/);
    expect(JSON.stringify(secondAsk?.input[0])).toMatch(/no voice issues now/);
    expect(JSON.stringify(secondAsk?.input[0])).toMatch(/four homes were destroyed/);
  });

  it('the review the player sees never repeats rejected draft words, unrevealed names or quoted matches', async () => {
    const harmful: NarrativeDraft = { ...GOOD_DRAFT, text: `${GOOD_TEXT} The whole Vey family died inside the house.` };
    const quoted = 'Remove "The whole Vey family died inside the house." No record supports it.';
    const early = 'Remove the aside about Aldo Brant: nothing in this chapter mentions him.';
    const t = fakeTransport({
      archivist: [() => answer(harmful), () => answer(GOOD_DRAFT)],
      historian: [() => answer({ verdict: 'revise', issues: [quoted, early, 'The last sentence is unsupported; remove it.'] }), () => answer({ verdict: 'approve', issues: [] })],
    });
    const { deps, logger } = setup(t);
    const r = (await generateNarrative('reflection', ch4Request, deps)) as NarrativeResult;
    expect(r).toMatchObject({ ok: true, review: { verdict: 'corrected', rounds: 2 } });
    const notShown = 'The Historian asked for a correction whose wording is not shown (it quoted text the checks do not allow).';
    expect(r.review.issues).toEqual([
      notShown,
      'The last sentence is unsupported; remove it.',
      'Deterministic check: wording about deaths or injuries, which this story never describes.',
      'Deterministic check: wording that put people inside a building.',
    ]);
    expect(JSON.stringify(r)).not.toMatch(/died|Brant/);
    // The Archivist still got the full problems (as data) to fix them, and the trace keeps everything.
    const rewrite = t.requests.filter((q) => !q.instructions.startsWith('You are the Historian'))[1];
    expect(JSON.stringify(rewrite.input)).toContain('The whole Vey family died inside the house.');
    const trace = logger.traces.get('lt-test-run') as { reviews: { issues: string[]; validationIssues: string[] }[] };
    expect(trace.reviews[0].issues).toEqual([quoted, early, 'The last sentence is unsupported; remove it.']);
    expect(trace.reviews[0].validationIssues.join(' ')).toMatch(/"died"/);
  });

  it('a lazy approval does not pass the deterministic gate: still wrong after the bounded rounds → rejected', async () => {
    const t = fakeTransport({
      archivist: [() => answer(BAD_DRAFT), () => answer(BAD_DRAFT)],
      historian: [() => answer({ verdict: 'approve', issues: [] }), () => answer({ verdict: 'approve', issues: [] })],
    });
    const { deps, logger } = setup(t);
    const r = (await generateNarrative('reflection', ch4Request, deps)) as NarrativeFailure;
    expect(r).toMatchObject({ ok: false, reason: 'rejected', fallback: true });
    expect(r.usage).toHaveLength(4);
    expect(logger.usage).toHaveLength(4);
    expect((logger.traces.get('lt-test-run') as { result: { reason: string } }).result.reason).toBe('rejected');
  });

  it('a cancelled run sends no further request, falls back, and still logs what it spent', async () => {
    const stop = new AbortController();
    const t = fakeTransport({
      archivist: [() => (stop.abort(new Error('the browser closed the request')), answer(GOOD_DRAFT))],
      historian: historianChecksThen('approve'),
    });
    const { deps, logger } = setup(t, { signal: stop.signal });
    const r = (await generateNarrative('reflection', ch4Request, deps)) as NarrativeFailure;
    expect(r).toMatchObject({ ok: false, reason: 'error', message: 'cancelled: the browser closed the request', fallback: true });
    expect(t.requests).toHaveLength(1); // the Archivist's draft; the Historian was never asked
    expect(logger.usage).toEqual([expect.objectContaining({ agent: 'archivist', requests: 1, ok: true })]);
    expect((logger.traces.get('lt-test-run') as { result: { ok: boolean } }).result.ok).toBe(false);
  });

  it('missing key: unavailable without touching the model', async () => {
    const t = fakeTransport({});
    const { deps } = setup(t, { config: loadConfig('.', {}) });
    const r = await generateNarrative('reflection', ch4Request, deps);
    expect(r).toMatchObject({ ok: false, reason: 'unavailable', fallback: true, usage: [] });
    expect((r as NarrativeFailure).message).toMatch(/PORTKEY_API_KEY not set/);
    expect(t.requests).toHaveLength(0);
  });

  it('budget exhaustion and transport errors become NarrativeFailure with the usage spent so far', async () => {
    const t = fakeTransport({ archivist: archivistLooksThenWrites(GOOD_DRAFT), historian: historianChecksThen('approve') });
    const { deps } = setup(t, { budget: new Budget({ maxRequests: 1, dailyTokens: 1_000_000 }) });
    const r = (await generateNarrative('reflection', ch4Request, deps)) as NarrativeFailure;
    expect(r).toMatchObject({ ok: false, reason: 'budget' });
    expect(r.usage[0]).toMatchObject({ agent: 'archivist', requests: 1, inputTokens: 500, ok: false });

    const down: Transport = { name: 'down', send: async () => Promise.reject(new Error('connection refused')) };
    const r2 = (await generateNarrative('reflection', ch4Request, setup(down).deps)) as NarrativeFailure;
    expect(r2).toMatchObject({ ok: false, reason: 'error' });
    expect(r2.message).toMatch(/connection refused/);
  });

  it('behind the routing: an own-key model needs your key, the matching transport and the daily limit', async () => {
    const both = loadConfig('.', { PORTKEY_API_KEY: KEY, OPENAI_API_KEY: 'sk-own-agents-0123456789' }, { maxHistorianRounds: 2 });
    const cases: { over: Partial<NarrativeDeps>; message: RegExp }[] = [
      { over: { model: 'gpt-6-sol', spend: new SpendCap(2) }, message: /OPENAI_API_KEY not set/ }, // `config` has the course key only
      { over: { config: both, model: 'gpt-6-sol' }, message: /runs only under the daily limit/ },
      { over: { config: both, model: 'constructor', spend: new SpendCap(2) }, message: /not an offered model/ },
    ];
    for (const c of cases) {
      const t = fakeTransport({});
      const r = (await generateNarrative('reflection', ch4Request, setup(t, c.over).deps)) as NarrativeFailure;
      expect(r).toMatchObject({ ok: false, reason: 'unavailable', fallback: true, usage: [] });
      expect(r.message).toMatch(c.message);
      expect(t.requests).toHaveLength(0);
    }
    // A transport that holds the other provider's key is refused before any request.
    const courseOnly: Transport = { name: 'portkey', provider: 'course', send: () => Promise.reject(new Error('must not be called')) };
    const mixed = (await generateNarrative('reflection', ch4Request, setup(courseOnly, { config: both, model: 'gpt-6-sol', spend: new SpendCap(2) }).deps)) as NarrativeFailure;
    expect(mixed).toMatchObject({ ok: false, reason: 'unavailable', message: expect.stringMatching(/runs only with OPENAI_API_KEY/) });
  });

  it('runs gpt-6-sol under the daily limit, recording model and provider, and stops when the limit is spent', async () => {
    const both = loadConfig('.', { PORTKEY_API_KEY: KEY, OPENAI_API_KEY: 'sk-own-agents-0123456789' }, { maxHistorianRounds: 2 });
    const t = fakeTransport({ archivist: archivistLooksThenWrites(GOOD_DRAFT), historian: historianChecksThen('approve') });
    const spend = new SpendCap(2);
    const { deps, logger } = setup(t, { config: both, model: 'gpt-6-sol', spend });
    const r = (await generateNarrative('reflection', ch4Request, deps)) as NarrativeResult;
    expect(r.ok).toBe(true);
    expect(t.requests.every((q) => q.model === 'gpt-6-sol')).toBe(true);
    expect(r.usage.map((u) => u.provider)).toEqual(['own-key', 'own-key']);
    // The limit has counted exactly what the usage records cost.
    const total = r.usage.reduce((a, u) => a + (u.costUsd ?? 0), 0);
    expect(spend.snapshot().spentUsd).toBeCloseTo(total, 8);
    expect(logger.traces.get('lt-test-run')).toMatchObject({ model: 'gpt-6-sol', provider: 'own-key' });

    const spent = new SpendCap(total, Date.now, total); // already at the limit
    const t2 = fakeTransport({ archivist: archivistLooksThenWrites(GOOD_DRAFT) });
    const r2 = (await generateNarrative('reflection', ch4Request, setup(t2, { config: both, model: 'gpt-6-sol', spend: spent }).deps)) as NarrativeFailure;
    expect(r2).toMatchObject({ ok: false, reason: 'budget' });
    expect(r2.message).toMatch(/reached OPENAI_DAILY_USD_LIMIT/);
    expect(t2.requests).toHaveLength(0);
  });
});

const EPILOGUE_TEXT =
  'The river is quiet now at Harrow Bay. The pier went into the water at dusk, and the lights that had been moved ' +
  'twice went with it. Upstream, the record is longer than anyone meant it to be. In Kell Valley the footbridge went ' +
  'first, and the gauge hut above the falls was left standing, its log still in the drawer. On Mill Lane the Vey house ' +
  'was taken, and the chapel stayed, and choir practice went on in the hall. Nobody decided all of this at once. A ' +
  'council approved houses on the floodplain because families needed somewhere to live. An office filed the readings ' +
  'every spring. Each choice was small and reasonable on the day it was made, and some people had far more say than ' +
  'others, and far more warning. Tomas Reed kept reading the gauge, morning after morning, and posted what he saw. ' +
  'Ines Vey kept every letter she was sent. You cannot undo the river behind you. You can still decide where it goes next.';

const EPILOGUE: NarrativeDraft = {
  title: 'Where It Goes Next',
  text: EPILOGUE_TEXT,
  fragmentIds: ['ch9-pier-photo'],
  factIds: [],
  claims: [
    { type: 'landmark', landmarkId: 'harrow-pier', status: 'destroyed' },
    { type: 'history', chapterId: 'ch1-beginning', landmarkId: 'gauge-hut', status: 'intact' },
    { type: 'history', chapterId: 'ch1-beginning', landmarkId: 'kell-footbridge', status: 'destroyed' },
    { type: 'history', chapterId: 'ch4-people', landmarkId: 'vey-house', status: 'destroyed' },
    { type: 'history', chapterId: 'ch4-people', landmarkId: 'mill-chapel', status: 'intact' },
    { type: 'fragment', fragmentId: 'ch9-pier-photo' },
  ],
};

describe('epilogue', () => {
  it('gives the epilogue one more Historian review than a reflection (here 3 against 2)', async () => {
    const script = () => ({
      archivist: [() => answer(EPILOGUE), () => answer(EPILOGUE), () => answer(EPILOGUE)],
      historian: [
        () => answer({ verdict: 'revise', issues: ['Attribute the reasons to Harrow’s letter.'] }),
        () => answer({ verdict: 'revise', issues: ['Say the route was the one Anna drew for the lake.'] }),
        () => answer({ verdict: 'approve', issues: [] }),
      ],
    });
    const req: CheckedRequest = { chapter: chapterOf('ch9-last-thaw'), evidence: ch9Evidence(), history: [CH1_HISTORY, CH4_HISTORY] };
    const epi = await generateNarrative('epilogue', req, setup(fakeTransport(script())).deps);
    expect(epi.ok ? epi.review : epi).toMatchObject({ verdict: 'corrected', rounds: 3 });
    // The same conversation for a reflection ends at the second review, rejected.
    const refl = await generateNarrative('reflection', ch4Request, setup(fakeTransport({ ...script(), archivist: [() => answer(GOOD_DRAFT), () => answer(GOOD_DRAFT)] })).deps);
    expect(refl).toMatchObject({ ok: false, reason: 'rejected' });
  });

  it('uses the whole history and the epilogue length, and passes the same gates', async () => {
    const t = fakeTransport({
      archivist: [() => callTools([{ name: 'get_story_history' }, { name: 'get_run_summary' }]), () => answer(EPILOGUE)],
      historian: historianChecksThen('approve'),
    });
    const { deps } = setup(t);
    const req: CheckedRequest = { chapter: chapterOf('ch9-last-thaw'), evidence: ch9Evidence(), history: [CH1_HISTORY, CH4_HISTORY] };
    const r = await generateNarrative('epilogue', req, deps);
    expect(r.ok ? r.review : r).toEqual({ verdict: 'approved', rounds: 1, issues: [] });
    const arch = t.requests[0];
    expect(arch.instructions).toMatch(/This is the epilogue/);
    expect(arch.instructions).toMatch(/150–250 words/);
    // The history tool returned both earlier chapters, the saved excerpt marked untrusted.
    const hist = toolOutputs(t.requests[1])[0] as unknown as { result: { chapters: { chapterId: string; reflectionExcerpt: { untrusted: boolean } }[] } };
    expect(hist.result.chapters.map((c) => c.chapterId)).toEqual(['ch1-beginning', 'ch4-people']);
    expect(hist.result.chapters[0].reflectionExcerpt.untrusted).toBe(true);
  });
});

describe('instructions (the cached prefix)', () => {
  const texts = [ARCHIVIST_INSTRUCTIONS.reflection, ARCHIVIST_INSTRUCTIONS.epilogue, HISTORIAN_INSTRUCTIONS];

  it('carry the authored voice examples verbatim, ahead of anything per-run', () => {
    const examples = CHAPTERS[1].fallbackReflections.filter((f) => ['ch2-reflection-many', 'ch2-reflection-cabin-stands'].includes(f.id));
    expect(examples).toHaveLength(2);
    for (const e of examples) expect(ARCHIVIST_INSTRUCTIONS.reflection).toContain(e.body);
    // Reflection and epilogue share one prefix up to the mode paragraph, so caching serves both.
    const shared = ARCHIVIST_INSTRUCTIONS.reflection.slice(0, ARCHIVIST_INSTRUCTIONS.reflection.lastIndexOf('\n\n'));
    expect(ARCHIVIST_INSTRUCTIONS.epilogue.startsWith(shared)).toBe(true);
  });

  it('name nobody the player may not know in chapter 1 (they are sent unchanged in every chapter)', () => {
    const later = (id: string): boolean => CHAPTERS.findIndex((c) => c.id === id) > 0;
    for (const t of texts) {
      expect(t).not.toMatch(/\bMara\b/);
      for (const c of BIBLE.characters) {
        if (!later(c.revealedIn ?? c.firstAppears)) continue;
        for (const part of c.name.split(' ')) expect(t, c.name).not.toMatch(new RegExp(`\\b${part}\\b`));
      }
      for (const l of BIBLE.locations) if (later(l.chapterId)) expect(t, l.name).not.toContain(l.name);
      for (const ch of CHAPTERS.slice(1)) for (const lm of ch.landmarks) expect(t, lm.name).not.toContain(lm.name);
    }
  });

  it('ask for the voice and the rules the student set, and the Historian checks them', () => {
    expect(ARCHIVIST_INSTRUCTIONS.reflection).toMatch(/first person/);
    expect(ARCHIVIST_INSTRUCTIONS.reflection).toMatch(/Intimate and restrained/);
    expect(ARCHIVIST_INSTRUCTIONS.reflection).toMatch(/never say that humanity was foolish/);
    expect(HISTORIAN_INSTRUCTIONS).toMatch(/Voice \(these are rules of the story, not taste\)/);
    expect(HISTORIAN_INSTRUCTIONS).toMatch(/never revise for taste/);
  });

  it('ask for plain English and full names, and the Historian checks clarity (the student\'s playtest, 2026-10-23)', () => {
    // The line the student could not follow is quoted to both agents as the thing not to write.
    const unclear = 'I keep the note beside it, the bowl still there in the written line';
    for (const t of texts) {
      expect(t).toMatch(/Name a person in full the first time/);
      expect(t).toMatch(/Never an initial for anyone/);
      expect(t).toMatch(/complete, grammatical sentences/);
    }
    expect(ARCHIVIST_INSTRUCTIONS.reflection).toMatch(/How it should read/);
    expect(ARCHIVIST_INSTRUCTIONS.reflection).toContain(unclear);
    expect(HISTORIAN_INSTRUCTIONS).toMatch(/Clarity \(also a rule/);
    expect(HISTORIAN_INSTRUCTIONS).toContain(unclear);
    expect(HISTORIAN_INSTRUCTIONS).toMatch(/Clarity issues: at most two per review/);
    // Two sentences the Historian once approved that still left the reader guessing (live run, 2026-10-23):
    // both agents get them as what not to write, with the pattern named.
    for (const t of [ARCHIVIST_INSTRUCTIONS.reflection, ARCHIVIST_INSTRUCTIONS.epilogue, HISTORIAN_INSTRUCTIONS]) {
      expect(t).toContain("I keep that fact beside Tomas's note.");
      expect(t).toContain('the kettles he asked me not to identify');
    }
    expect(ARCHIVIST_INSTRUCTIONS.reflection).toContain('Never write "I keep A beside B"');
  });
});
