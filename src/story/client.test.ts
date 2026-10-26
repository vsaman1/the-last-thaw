import { describe, expect, it, vi } from 'vitest';
import { CHAPTERS } from './chapters';
import {
  compactEvidence,
  EPILOGUE_TIMEOUT_MS,
  fetchStatus,
  REFLECT_TIMEOUT_MS,
  reflectionFor,
  requestEpilogue,
  requestReflection,
  wantsAi,
} from './client';
import { evidenceFixture } from './fixtures';
import { THEME_LINE } from './select';
import type { NarrativeResult } from './types';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const approved: NarrativeResult = {
  ok: true,
  source: 'ai',
  runId: 'run-1',
  title: 'What the river kept',
  text: 'A short reflection.',
  fragmentIds: ['f1'],
  factIds: [],
  claims: [{ type: 'outcome', value: 'complete' }],
  review: { verdict: 'approved', rounds: 1, issues: [] },
  validation: { passed: true, checked: 3 },
  toolCalls: [{ agent: 'archivist', tool: 'get_run_summary', args: {}, ok: true, ms: 4 }],
  usage: [],
};

const ch1 = CHAPTERS[0];

describe('story client', () => {
  it('status: a missing service reads as unavailable with a reason, never throws', async () => {
    const s = await fetchStatus({ fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    expect(s.aiAvailable).toBe(false);
    expect(s.reason).toMatch(/unreachable/);
    const ok = await fetchStatus({ fetch: vi.fn().mockResolvedValue(json({ aiAvailable: true, model: 'm' })) });
    expect(ok).toEqual({ aiAvailable: true, model: 'm', models: [] });
  });

  it('status: reads the per-model list entry by entry, dropping anything malformed', async () => {
    const models = [
      { id: 'gpt-6-luna', provider: 'course', available: true },
      { id: 'gpt-6-sol', provider: 'own-key', available: false, reason: 'OPENAI_API_KEY not set', extra: 'dropped' },
      { id: 'x', provider: 'someone-else', available: true },
      { id: 'y', provider: 'course', available: 'yes' },
      { id: 'z'.repeat(65), provider: 'course', available: true },
      null,
      'gpt-6-luna',
    ];
    const s = await fetchStatus({ fetch: vi.fn().mockResolvedValue(json({ aiAvailable: true, model: 'gpt-6-luna', models })) });
    expect(s.models).toEqual([
      { id: 'gpt-6-luna', provider: 'course', available: true },
      { id: 'gpt-6-sol', provider: 'own-key', available: false, reason: 'OPENAI_API_KEY not set' },
    ]);
    const odd = await fetchStatus({ fetch: vi.fn().mockResolvedValue(json({ aiAvailable: true, model: 'gpt-6-luna', models: { 'gpt-6-sol': true } })) });
    expect(odd.models).toEqual([]);
    const down = await fetchStatus({ fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    expect(down.models).toEqual([]);
  });

  it('sends the chosen model with every reflection and epilogue request: gpt-6-luna unless told otherwise', async () => {
    const sentModel = async (call: (f: typeof fetch) => Promise<unknown>): Promise<unknown> => {
      const f = vi.fn().mockResolvedValue(json(approved));
      await call(f as unknown as typeof fetch);
      return (JSON.parse(String((f.mock.calls[0] as [string, RequestInit])[1].body)) as { model?: unknown }).model;
    };
    const base = { chapterId: 'ch1-beginning' as const, evidence: evidenceFixture(), history: [] };
    expect(await sentModel((f) => requestReflection(base, { fetch: f }))).toBe('gpt-6-luna');
    expect(await sentModel((f) => requestReflection({ ...base, model: 'gpt-6-sol' }, { fetch: f }))).toBe('gpt-6-sol');
    expect(await sentModel((f) => requestEpilogue({ evidence: evidenceFixture(), history: [], model: 'gpt-6-sol' }, { fetch: f }))).toBe('gpt-6-sol');
    expect(await sentModel((f) => requestEpilogue({ evidence: evidenceFixture(), history: [] }, { fetch: f }))).toBe('gpt-6-luna');
    // Anything that is not an offered model goes as the default (a stale or hand-edited setting).
    for (const junk of ['gpt-4o', 'constructor', 7]) {
      expect(await sentModel((f) => requestReflection({ ...base, model: junk as never }, { fetch: f })), String(junk)).toBe('gpt-6-luna');
    }
    expect(await sentModel((f) => reflectionFor({ ...ch1, aiReflection: true }, evidenceFixture(), [], { ai: 'selected', model: 'gpt-6-sol' }, { fetch: f }))).toBe('gpt-6-sol');
  });

  it("a gpt-6-sol refusal comes back with the server's reason, and the authored text stands", async () => {
    const message = 'gpt-6-sol is not available: OPENAI_API_KEY not set (gpt-6-sol runs only on your own OpenAI key, billed to you). Nothing was sent to any model.';
    const f = vi.fn().mockResolvedValue(json({ ok: false, runId: 'r', reason: 'unavailable', message, fallback: true, usage: [] }));
    const r = await reflectionFor({ ...ch1, aiReflection: true }, evidenceFixture(), [], { ai: 'selected', model: 'gpt-6-sol' }, { fetch: f });
    expect(r.reflection.source).toBe('authored');
    expect(r.failure).toMatchObject({ reason: 'unavailable', message });
    expect(f).toHaveBeenCalledTimes(1); // no second request on another model
  });

  it('reflect: posts only RunEvidence + compact history to /api/story/reflect', async () => {
    const f = vi.fn().mockResolvedValue(json(approved));
    const evidence = { ...evidenceFixture(), secret: 'do not send' } as never;
    const history = [
      {
        chapterId: 'ch1-beginning' as const,
        outcome: 'complete' as const,
        storyPoints: 1,
        destroyedByCategory: {},
        landmarks: [],
        fragmentIds: [],
        reflectionExcerpt: 'x'.repeat(1000),
        extra: 'nope',
      },
    ];
    const res = await requestReflection({ chapterId: 'ch1-beginning', evidence, history }, { fetch: f });
    expect(res.ok).toBe(true);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/story/reflect');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['chapterId', 'evidence', 'history', 'model']);
    expect(JSON.stringify(sent)).not.toMatch(/do not send|nope/);
    expect(sent.evidence).toEqual(compactEvidence(evidenceFixture()));
    expect((sent.history as { reflectionExcerpt: string }[])[0].reflectionExcerpt.length).toBe(240);
  });

  it('every failure is a NarrativeFailure with fallback: HTTP error, malformed, unvalidated, network', async () => {
    const cases = [
      vi.fn().mockResolvedValue(json({ error: 'x' }, 500)),
      vi.fn().mockResolvedValue(new Response('not json', { status: 200 })),
      vi.fn().mockResolvedValue(json({ ...approved, validation: { passed: false } })),
      vi.fn().mockResolvedValue(json({ ...approved, text: '' })),
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    ];
    for (const f of cases) {
      const res = await requestReflection({ chapterId: 'ch1-beginning', evidence: evidenceFixture(), history: [] }, { fetch: f });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.fallback).toBe(true);
    }
  });

  it("passes the server's own failure through (reason kept)", async () => {
    const f = vi.fn().mockResolvedValue(
      json({ ok: false, runId: 'r', reason: 'unavailable', message: 'PORTKEY_API_KEY not set', fallback: true, usage: [] }),
    );
    const res = await requestEpilogue({ evidence: evidenceFixture(), history: [] }, { fetch: f });
    expect(res).toMatchObject({ ok: false, reason: 'unavailable', message: 'PORTKEY_API_KEY not set' });
    expect((f.mock.calls[0] as [string])[0]).toBe('/api/story/epilogue');
  });

  it('times out (AbortController) and falls back', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const p = requestReflection({ chapterId: 'ch1-beginning', evidence: evidenceFixture(), history: [] }, { fetch: f as never });
      await vi.advanceTimersByTimeAsync(REFLECT_TIMEOUT_MS);
      const res = await p;
      expect(res).toMatchObject({ ok: false, reason: 'error' });
      if (!res.ok) expect(res.message).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits long enough for a real two-agent run (26–131 s measured): a 131 s answer still lands', async () => {
    expect(REFLECT_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
    expect(EPILOGUE_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
    vi.useFakeTimers();
    try {
      const slow = (): ReturnType<typeof vi.fn> =>
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise<Response>((resolve, reject) => {
              const id = setTimeout(() => resolve(json(approved)), 131_000);
              init?.signal?.addEventListener('abort', () => {
                clearTimeout(id);
                reject(new DOMException('aborted', 'AbortError'));
              });
            }),
        );
      const r = requestReflection({ chapterId: 'ch1-beginning', evidence: evidenceFixture(), history: [] }, { fetch: slow() as never });
      const e = requestEpilogue({ evidence: evidenceFixture(), history: [] }, { fetch: slow() as never });
      await vi.advanceTimersByTimeAsync(131_000);
      expect(await r).toMatchObject({ ok: true, text: approved.text });
      expect(await e).toMatchObject({ ok: true, text: approved.text });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reflectionFor: AI only when the preference asks; authored on failure', async () => {
    expect(wantsAi({ aiReflection: true }, 'selected')).toBe(true);
    expect(wantsAi({ aiReflection: false }, 'selected')).toBe(false);
    expect(wantsAi({ aiReflection: false }, 'all')).toBe(true);
    expect(wantsAi({ aiReflection: true }, 'off')).toBe(false);

    const never = vi.fn();
    const off = await reflectionFor(ch1, evidenceFixture(), [], { ai: 'off', model: 'gpt-6-luna' }, { fetch: never });
    expect(never).not.toHaveBeenCalled();
    expect(off.reflection.source).toBe('authored');

    const ai = await reflectionFor({ ...ch1, aiReflection: true }, evidenceFixture(), [], { ai: 'selected', model: 'gpt-6-luna' }, {
      fetch: vi.fn().mockResolvedValue(json(approved)),
    });
    expect(ai.reflection).toMatchObject({ source: 'ai', text: 'A short reflection.', validated: true, traceId: 'run-1' });
    expect(ai.result?.toolCalls).toHaveLength(1);

    const failed = await reflectionFor({ ...ch1, aiReflection: true }, evidenceFixture(), [], { ai: 'selected', model: 'gpt-6-luna' }, {
      fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    expect(failed.reflection.source).toBe('authored');
    expect(failed.failure?.fallback).toBe(true);
    // The stub chapter has no authored reflections yet: the theme line stands in.
    if (ch1.fallbackReflections.length === 0) expect(failed.reflection.text).toBe(THEME_LINE);
  });
});
