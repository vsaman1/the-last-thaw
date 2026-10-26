/**
 * The UI's story bridge on REAL headless runs: live story points, evidence and the Archive entry at
 * completion, the agents' reflection swapped in only when it comes back approved, and the epilogue.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FIXED_DT, GameSession } from '../../core/session';
import { useAppStore } from '../../state/appStore';
import { emptyStoryProgress, useStoryStore } from '../../state/storyStore';
import { evidenceFixture } from '../../story/fixtures';
import { THEME_LINE } from '../../story/select';
import { storyLevel } from '../../story/storyLevel';
import { LANES, runTestChapter, TEST_CHAPTER, type TestRun } from '../../story/testkit';
import type { AiPreference, NarrativeResult } from '../../story/types';
import { CHAPTERS } from '../../story/chapters';
import { attachStorySession, isLastChapter, prefetchEpilogue, startEpilogue, useStoryRun } from './storyRun';

const level = storyLevel(TEST_CHAPTER);
const runs: TestRun[] = [];

function reset(ai: AiPreference): void {
  const p = emptyStoryProgress();
  useStoryStore.setState({ progress: { ...p, settings: { ...p.settings, ai } }, failures: {} });
  useStoryRun.setState({ points: 0, outcome: null, epilogue: null, failedDocument: null });
}

async function play(lane: (s: number) => number): Promise<void> {
  let detach: (() => void) | null = null;
  const run = await runTestChapter(lane, 240, TEST_CHAPTER, (s) => {
    detach = attachStorySession(s, TEST_CHAPTER, level);
  });
  runs.push(run);
  (detach as (() => void) | null)?.();
}

afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const r of runs) r.session.dispose();
});

describe('story bridge on real runs', () => {
  it('smashing the chalet: live points match the evidence; the Archive records the run; arcade untouched', async () => {
    reset('off');
    const arcadeBefore = useAppStore.getState().progress;
    await play(LANES.smash);
    const { outcome, points } = useStoryRun.getState();
    expect(outcome).not.toBeNull();
    expect(outcome!.evidence.outcome).toBe('complete');
    expect(outcome!.evidence.landmarks.find((l) => l.id === 'test-chalet')?.status).toBe('destroyed');
    expect(points).toBe(outcome!.evidence.storyPoints);
    expect(points).toBeGreaterThan(0);
    // The in-run notice named the place as it broke (once).
    const notice = useStoryRun.getState().landmark;
    expect(notice?.id).toBe('test-chalet');
    expect(notice?.name).toBe(TEST_CHAPTER.landmarks.find((l) => l.id === 'test-chalet')?.name);
    expect(notice?.seq).toBe(1);
    expect(outcome!.narrative.status).toBe('ready');
    expect(outcome!.narrative.reflection.source).toBe('authored');
    const archive = useStoryStore.getState().progress.archive;
    expect(archive).toHaveLength(1);
    expect(archive[0].evidence).toEqual(outcome!.evidence);
    expect(useStoryStore.getState().progress.completed).toEqual([TEST_CHAPTER.id]);
    expect(useAppStore.getState().progress).toBe(arcadeBefore);

    // Chapter 9's Continue starts the epilogue: composed authored text, stored in the Archive.
    startEpilogue();
    const ep = useStoryRun.getState().epilogue;
    expect(ep?.status).toBe('ready');
    expect(ep?.reflection.source).toBe('authored');
    if (ep?.reflection.fragmentIds.length === 0) expect(ep.reflection.text).toBe(THEME_LINE);
    expect(useStoryStore.getState().progress.epilogue).toEqual(ep?.reflection);
  }, 120_000);

  it("the agents' approved reflection replaces the authored one, in the panel and the Archive", async () => {
    reset('selected');
    const approved: NarrativeResult = {
      ok: true,
      source: 'ai',
      runId: 'trace-7',
      text: 'The chalet above the bend is still there.',
      fragmentIds: [],
      factIds: [],
      claims: [{ type: 'landmark', landmarkId: 'test-chalet', status: 'intact' }],
      review: { verdict: 'corrected', rounds: 2, issues: ['said "spared" before the run reached it'] },
      validation: { passed: true, checked: 1 },
      toolCalls: [],
      usage: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(approved), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await play(LANES.avoid);
    expect(useStoryRun.getState().outcome?.evidence.landmarks.find((l) => l.id === 'test-chalet')?.status).toBe('intact');
    await vi.waitFor(() => expect(useStoryRun.getState().outcome?.narrative.status).toBe('ready'));
    const n = useStoryRun.getState().outcome!.narrative;
    expect(n.reflection).toMatchObject({ source: 'ai', text: approved.text, review: { verdict: 'corrected', rounds: 2 } });
    expect(n.result?.review.issues).toHaveLength(1);
    expect(useStoryStore.getState().progress.archive[0].reflection.source).toBe('ai');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['chapterId', 'evidence', 'history', 'model']);
    expect(body.model).toBe('gpt-6-luna'); // the default setting
  }, 120_000);

  it('a chapter reflection goes on the model in the settings: gpt-6-sol stays gpt-6-sol', async () => {
    reset('all');
    useStoryStore.getState().updateStorySettings({ model: 'gpt-6-sol' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(approvedFor('On the player’s own key.')), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await play(LANES.avoid);
    await vi.waitFor(() => expect(useStoryRun.getState().outcome?.narrative.status).toBe('ready'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/story/reflect');
    expect((JSON.parse(String(init.body)) as { model?: unknown }).model).toBe('gpt-6-sol');
    expect(useStoryStore.getState().progress.settings.model).toBe('gpt-6-sol');
  }, 120_000);

  it("a failed run picks the chapter's one document written for a failure, for the fail panel, and archives nothing", async () => {
    reset('off');
    // The test chapter keeps chapter 1's documents, so its failure record is "a day I turned back".
    const session = await GameSession.create({ level, skipIntro: true });
    const detach = attachStorySession(session, TEST_CHAPTER, level);
    for (let i = 0; i < 30; i++) session.update(FIXED_DT, { steer: 0, source: 'keyboard' });
    // The run ends short of the sea the way the session ends every failed run (its private fail()).
    (session as unknown as { fail(reason: 'stuck'): void }).fail('stuck');
    expect(session.phase).toBe('failed');
    expect(useStoryRun.getState().failedDocument?.id).toBe('ch1-turned-back');
    expect(useStoryRun.getState().outcome).toBeNull();
    expect(useStoryStore.getState().progress.archive).toHaveLength(0);
    expect(useStoryStore.getState().failures[TEST_CHAPTER.id]).toBe(1);
    // The next attempt starts clean.
    detach();
    const next = await GameSession.create({ level, skipIntro: true });
    const detachNext = attachStorySession(next, TEST_CHAPTER, level);
    expect(useStoryRun.getState().failedDocument).toBeNull();
    detachNext();
    session.dispose();
    next.dispose();
  }, 120_000);

  it('a late answer for an older completion is ignored, in the panel and in the Archive', async () => {
    reset('selected');
    const { f, answer } = deferredFetch();
    vi.stubGlobal('fetch', f);
    await play(LANES.avoid);
    const first = useStoryRun.getState().outcome!;
    expect(first.narrative.status).toBe('pending');
    // The player replays and finishes again before the agents answer the first run.
    const laterAt = new Date(Date.parse(first.completedAt) + 60_000).toISOString();
    const laterReflection = { source: 'authored' as const, text: 'The later run.', fragmentIds: [], factIds: [] };
    useStoryStore.getState().recordChapter({ chapterId: first.chapterId, completedAt: laterAt, evidence: first.evidence, fragmentIds: [], reflection: laterReflection });
    useStoryRun.setState({ outcome: { ...first, completedAt: laterAt, narrative: { status: 'ready', reflection: laterReflection } } });
    answer(0, approvedFor('An answer about the first run.'));
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(useStoryRun.getState().outcome?.narrative.reflection.text).toBe('The later run.');
    expect(useStoryStore.getState().progress.archive[0]).toMatchObject({ completedAt: laterAt, reflection: laterReflection });
  }, 120_000);
});

/** A fetch whose answers the test releases one by one. */
function deferredFetch(): { f: ReturnType<typeof vi.fn>; answer: (i: number, body: unknown) => void } {
  const pending: ((r: Response) => void)[] = [];
  const f = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
  return { f, answer: (i, body) => pending[i](new Response(JSON.stringify(body), { status: 200 })) };
}

const approvedFor = (text: string): NarrativeResult => ({
  ok: true,
  source: 'ai',
  runId: 'trace-late',
  text,
  fragmentIds: [],
  factIds: [],
  claims: [{ type: 'outcome', value: 'complete' }],
  review: { verdict: 'approved', rounds: 1, issues: [] },
  validation: { passed: true, checked: 1 },
  toolCalls: [],
  usage: [],
});

describe('epilogue answers that arrive late', () => {
  const ch9Outcome = (completedAt: string) => ({
    chapterId: 'ch9-last-thaw' as const,
    completedAt,
    evidence: evidenceFixture({ chapterId: 'ch9-last-thaw' }),
    fragments: [],
    narrative: { status: 'ready' as const, reflection: { source: 'authored' as const, text: 'Nine.', fragmentIds: [], factIds: [] } },
  });

  it('the authored epilogue shows at once; the agents’ replaces it when it arrives', async () => {
    reset('selected');
    const { f, answer } = deferredFetch();
    vi.stubGlobal('fetch', f);
    useStoryRun.setState({ outcome: ch9Outcome('2026-10-21T10:00:00.000Z') });
    startEpilogue();
    const authored = useStoryRun.getState().epilogue!;
    expect(authored).toMatchObject({ status: 'pending', reflection: { source: 'authored' } });
    expect(useStoryStore.getState().progress.epilogue).toEqual(authored.reflection);
    answer(0, approvedFor('For this journey, the agents wrote this.'));
    await vi.waitFor(() => expect(useStoryRun.getState().epilogue?.status).toBe('ready'));
    expect(useStoryRun.getState().epilogue?.reflection).toMatchObject({ source: 'ai', text: 'For this journey, the agents wrote this.' });
    expect(useStoryStore.getState().progress.epilogue?.source).toBe('ai');
  });

  it('an epilogue asked for when chapter 9 completed is picked up, not asked for again', async () => {
    reset('selected');
    const { f, answer } = deferredFetch();
    vi.stubGlobal('fetch', f);
    expect(CHAPTERS.map(isLastChapter)).toEqual([false, false, false, false, false, false, false, false, true]);
    const at = '2026-10-21T11:00:00.000Z';
    const outcome = ch9Outcome(at);
    prefetchEpilogue(at, outcome.evidence, []);
    expect(f).toHaveBeenCalledTimes(1);
    useStoryRun.setState({ outcome });
    startEpilogue();
    expect(f).toHaveBeenCalledTimes(1);
    answer(0, approvedFor('Asked for early.'));
    await vi.waitFor(() => expect(useStoryRun.getState().epilogue?.reflection.text).toBe('Asked for early.'));
    // A prefetch for another completion is not used.
    prefetchEpilogue('2026-10-21T09:00:00.000Z', outcome.evidence, []);
    useStoryRun.setState({ outcome: ch9Outcome('2026-10-21T12:00:00.000Z'), epilogue: null });
    startEpilogue();
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('the epilogue goes on the model in the settings, prefetched or not', async () => {
    reset('selected');
    useStoryStore.getState().updateStorySettings({ model: 'gpt-6-sol' });
    const { f } = deferredFetch();
    vi.stubGlobal('fetch', f);
    const sentModel = (i: number): unknown => (JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body)) as { model?: unknown }).model;
    const at = '2026-10-21T11:00:00.000Z';
    prefetchEpilogue(at, ch9Outcome(at).evidence, []);
    expect(sentModel(0)).toBe('gpt-6-sol');
    useStoryRun.setState({ outcome: ch9Outcome('2026-10-21T12:00:00.000Z') });
    startEpilogue(); // not the prefetched completion: asks again, on the same model
    expect(sentModel(1)).toBe('gpt-6-sol');
    prefetchEpilogue(at, ch9Outcome(at).evidence, [], 'gpt-6-luna');
    expect(sentModel(2)).toBe('gpt-6-luna');
  });

  it('an answer for an epilogue a newer one replaced is dropped', async () => {
    reset('selected');
    const { f, answer } = deferredFetch();
    vi.stubGlobal('fetch', f);
    useStoryRun.setState({ outcome: ch9Outcome('2026-10-21T10:00:00.000Z') });
    startEpilogue();
    // Chapter 9 replayed and finished again: a new run, a new epilogue.
    useStoryRun.setState({ outcome: ch9Outcome('2026-10-21T10:05:00.000Z'), epilogue: null });
    startEpilogue();
    expect(f).toHaveBeenCalledTimes(2);
    answer(0, approvedFor('The old journey.'));
    await new Promise((r) => setTimeout(r, 20));
    expect(useStoryRun.getState().epilogue?.status).toBe('pending');
    expect(useStoryStore.getState().progress.epilogue?.source).toBe('authored');
    answer(1, approvedFor('The new journey.'));
    await vi.waitFor(() => expect(useStoryRun.getState().epilogue?.reflection.text).toBe('The new journey.'));
    expect(useStoryStore.getState().progress.epilogue?.text).toBe('The new journey.');
  });
});
