import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { NarrativeFailure, NarrativeResult, UsageRecord } from '../story/types';
import { loadConfig } from './config';
import { createStoryHandler, defaultDeps, RateLimiter } from './handler';
import { Budget, type ResponsesRequest, type Transport } from './llm';
import { costCeilingUsd } from './pricing';
import { modelStatuses } from './providers';
import { SpendCap } from './spend';
import { memoryLogger, type UsageLogger } from './log';
import { answer, callTools, fakeTransport } from './testing/fakeTransport';
import { CH1_HISTORY, ch4Evidence, ch9Evidence, FIXTURE_LEVEL, FIXTURE_STORY, GOOD_DRAFT } from './testing/fixtureStory';

const KEY = 'pk-handler-test-0123456789';
const OWN = 'sk-own-handler-test-0123456789';
let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

interface StartOptions {
  key?: boolean;
  /** Set OPENAI_API_KEY (your own key, for gpt-6-sol). */
  ownKey?: boolean;
  transport?: Transport;
  ownTransport?: Transport;
  spend?: SpendCap;
  env?: Record<string, string>;
  maxBodyBytes?: number;
  postsPerMinute?: number;
  deadlineMs?: number;
  logger?: UsageLogger;
}

async function start(opts: StartOptions = {}): Promise<string> {
  const handle = handlerFor(opts);
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/story`;
}

function handlerFor(opts: StartOptions = {}): ReturnType<typeof createStoryHandler> {
  const vars = { ...(opts.key === false ? {} : { PORTKEY_API_KEY: KEY }), ...(opts.ownKey ? { OPENAI_API_KEY: OWN } : {}), ...opts.env };
  const config = loadConfig('.', vars, {
    maxBodyBytes: opts.maxBodyBytes ?? 64 * 1024,
    postsPerMinute: opts.postsPerMinute ?? 100,
    ...(opts.deadlineMs ? { narrativeDeadlineMs: { reflection: opts.deadlineMs, epilogue: opts.deadlineMs } } : {}),
  });
  return createStoryHandler({
    config,
    story: FIXTURE_STORY,
    transports: {
      ...(opts.key === false ? {} : { course: opts.transport ?? fakeTransport({}) }),
      ...(opts.ownKey ? { 'own-key': opts.ownTransport ?? fakeTransport({}) } : {}),
    },
    budget: new Budget({ maxRequests: 100, dailyTokens: 1_000_000 }),
    spend: opts.spend ?? new SpendCap(config.ownKeyDailyUsdLimit),
    logger: opts.logger ?? memoryLogger(),
    level: () => FIXTURE_LEVEL,
    rate: new RateLimiter(config.budgets.postsPerMinute),
  });
}

const json = { 'Content-Type': 'application/json' };
const reflectBody = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ chapterId: 'ch4-people', evidence: ch4Evidence(), history: [CH1_HISTORY], ...over });

/** What the own-key limit holds for a gpt-6-sol request: the ceiling (pricing.ts) of the body it sends. */
const ceilingOf = (req: ResponsesRequest): number =>
  costCeilingUsd('gpt-6-sol', Buffer.byteLength(JSON.stringify(req), 'utf8'), req.max_output_tokens) ?? Number.NaN;
/** The costliest request in the saved traces (lt-20261021-190124-adf44c, on gpt-6-luna) ... */
const COSTLY_USAGE = { input_tokens: 9608, input_tokens_details: { cached_tokens: 2832, cache_write_tokens: 6773 }, output_tokens: 1775 };
/** ... priced at gpt-6-sol: (3 × 2.00 + 2,832 × 0.20 + 6,773 × 2.50 + 1,775 × 10.00) / 1e6. */
const COSTLY_SOL_USD = 0.0352549;

describe('HTTP handler', () => {
  it('GET /status says whether AI is available, and why not, never the key', async () => {
    const base = await start();
    const r = await fetch(`${base}/status`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({
      aiAvailable: true,
      model: 'gpt-6-luna',
      models: [
        { id: 'gpt-6-luna', provider: 'course', available: true },
        { id: 'gpt-6-sol', provider: 'own-key', available: false, reason: expect.stringMatching(/^OPENAI_API_KEY not set/) },
      ],
    });
    expect(text).not.toContain(KEY);
    server?.close();
    const base2 = await start({ key: false });
    expect(await (await fetch(`${base2}/status`)).json()).toMatchObject({ aiAvailable: false, reason: expect.stringMatching(/not set/) });
  });

  it('GET /status: each combination of keys, and only an "available" boolean about each key', async () => {
    const cases = [
      { key: false, ownKey: false, luna: false, sol: false },
      { key: true, ownKey: false, luna: true, sol: false },
      { key: false, ownKey: true, luna: false, sol: true },
      { key: true, ownKey: true, luna: true, sol: true },
    ];
    for (const c of cases) {
      const base = await start({ key: c.key, ownKey: c.ownKey });
      const text = await (await fetch(`${base}/status`)).text();
      const s = JSON.parse(text) as { aiAvailable: boolean; reason?: string; models: { id: string; available: boolean; reason?: string }[] };
      const label = JSON.stringify(c);
      expect(s.aiAvailable, label).toBe(c.luna); // the default model
      expect(s.models.map((m) => [m.id, m.available]), label).toEqual([['gpt-6-luna', c.luna], ['gpt-6-sol', c.sol]]);
      expect(s.models[0].reason === undefined, label).toBe(c.luna);
      expect(s.models[1].reason === undefined, label).toBe(c.sol);
      expect(text, label).not.toContain(KEY);
      expect(text, label).not.toContain(OWN);
      expect(text, label).not.toMatch(/sk-|pk-/);
      await new Promise<void>((done) => server?.close(() => done()));
      server = undefined;
    }
  });

  it('runs the model the request names on its own provider, and records the model and provider', async () => {
    const script = (): Parameters<typeof fakeTransport>[0] => ({
      archivist: [() => callTools([{ name: 'get_run_summary' }]), () => answer(GOOD_DRAFT)],
      historian: [() => answer({ verdict: 'approve', issues: [] })],
    });
    const course = fakeTransport(script());
    const own = fakeTransport(script());
    const logger = memoryLogger();
    const base = await start({ ownKey: true, transport: course, ownTransport: own, logger });
    const sol = (await (await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody({ model: 'gpt-6-sol' }) })).json()) as NarrativeResult;
    expect(sol).toMatchObject({ ok: true, review: { verdict: 'approved' } });
    expect(course.requests).toHaveLength(0);
    expect(own.requests.map((r) => r.model)).toEqual(['gpt-6-sol', 'gpt-6-sol', 'gpt-6-sol']);
    expect(sol.usage.map((u) => [u.model, u.provider])).toEqual([['gpt-6-sol', 'own-key'], ['gpt-6-sol', 'own-key']]);
    const trace = logger.traces.get(sol.runId) as { model: string; provider: string };
    expect(trace).toMatchObject({ model: 'gpt-6-sol', provider: 'own-key' });

    const luna = (await (await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody({ model: 'gpt-6-luna' }) })).json()) as NarrativeResult;
    expect(luna.ok).toBe(true);
    expect(own.requests).toHaveLength(3);
    expect(course.requests.map((r) => r.model)).toEqual(['gpt-6-luna', 'gpt-6-luna', 'gpt-6-luna']);
    expect(luna.usage.every((u) => u.model === 'gpt-6-luna' && u.provider === 'course')).toBe(true);
    expect(logger.traces.get(luna.runId)).toMatchObject({ model: 'gpt-6-luna', provider: 'course' });
    expect(logger.usage.map((u) => u.provider)).toEqual(['own-key', 'own-key', 'course', 'course']);
  });

  it('a request without a model runs on the server default (gpt-6-luna unless MODEL_NAME says otherwise)', async () => {
    const course = fakeTransport({ archivist: [() => answer('not json')] });
    const base = await start({ transport: course });
    await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody() });
    expect(course.requests[0].model).toBe('gpt-6-luna');
    await new Promise<void>((done) => server?.close(() => done()));
    // MODEL_NAME=gpt-6-sol makes sol the default; without OPENAI_API_KEY it fails, and luna is not used.
    const luna = fakeTransport({});
    const base2 = await start({ transport: luna, env: { MODEL_NAME: 'gpt-6-sol' } });
    const r = (await (await fetch(`${base2}/reflect`, { method: 'POST', headers: json, body: reflectBody() })).json()) as NarrativeFailure;
    expect(r).toMatchObject({ ok: false, reason: 'unavailable', fallback: true });
    expect(luna.requests).toHaveLength(0);
  });

  it('gpt-6-sol without OPENAI_API_KEY fails clearly, sends nothing, and never switches to gpt-6-luna', async () => {
    const course = fakeTransport({ archivist: [() => answer(GOOD_DRAFT)], historian: [() => answer({ verdict: 'approve', issues: [] })] });
    const logger = memoryLogger();
    const base = await start({ transport: course, logger });
    for (const route of ['reflect', 'epilogue']) {
      const body = route === 'reflect' ? reflectBody({ model: 'gpt-6-sol' }) : JSON.stringify({ evidence: ch9Evidence(), history: [CH1_HISTORY], model: 'gpt-6-sol' });
      const r = await fetch(`${base}/${route}`, { method: 'POST', headers: json, body });
      expect(r.status).toBe(200);
      const res = (await r.json()) as NarrativeFailure;
      expect(res).toMatchObject({ ok: false, reason: 'unavailable', fallback: true, usage: [] });
      expect(res.message).toMatch(/^gpt-6-sol is not available: OPENAI_API_KEY not set \(gpt-6-sol runs only on your own OpenAI key, billed to you/);
      expect(res.message).toMatch(/Nothing was sent to any model\.$/);
    }
    expect(course.requests).toHaveLength(0);
    expect(logger.usage).toHaveLength(0);
  });

  it('gpt-6-sol stops for the day once OPENAI_DAILY_USD_LIMIT is reached, and runs again the next day', async () => {
    let now = Date.parse('2026-10-21T18:00:00Z');
    const spend = new SpendCap(2, () => now, 2.5); // seeded from the day's log: already past the limit
    const own = fakeTransport({ archivist: [() => answer('not json')] });
    const base = await start({ ownKey: true, ownTransport: own, spend });
    const status = (await (await fetch(`${base}/status`)).json()) as { models: { id: string; available: boolean; reason?: string }[] };
    expect(status.models[1]).toMatchObject({ id: 'gpt-6-sol', available: false, reason: expect.stringMatching(/reached OPENAI_DAILY_USD_LIMIT \(\$2\.00\)/) });
    const r = (await (await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody({ model: 'gpt-6-sol' }) })).json()) as NarrativeFailure;
    expect(r).toMatchObject({ ok: false, reason: 'budget', fallback: true });
    expect(r.message).toMatch(/^gpt-6-sol is not available: today's spending on your own OpenAI key/);
    expect(own.requests).toHaveLength(0);
    // gpt-6-luna is unaffected: the limit is the own-key provider's only.
    expect(((await (await fetch(`${base}/status`)).json()) as { aiAvailable: boolean }).aiAvailable).toBe(true);
    now = Date.parse('2026-10-22T00:00:05Z');
    expect(((await (await fetch(`${base}/status`)).json()) as typeof status).models[1].available).toBe(true);
    await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody({ model: 'gpt-6-sol' }) });
    expect(own.requests.length).toBeGreaterThan(0);
    const usage = (await (await fetch(`${base}/usage`)).json()) as { ownKeySpend: { day: string; limitUsd: number } };
    expect(usage.ownKeySpend).toMatchObject({ day: '2026-10-22', limitUsd: 2 });
  });

  it('gpt-6-sol narratives running at once hold their ceilings: together they never pass OPENAI_DAILY_USD_LIMIT', async () => {
    const now = (): number => Date.parse('2026-10-21T18:00:00Z');
    /** Your key, answering after 40 ms with the costliest request in the saved traces, priced at gpt-6-sol. */
    const costlyModel = (spend: SpendCap): Transport & { sent: { ceiling: number; spent: number }[] } => {
      const sent: { ceiling: number; spent: number }[] = [];
      return {
        name: 'own-costly',
        provider: 'own-key',
        sent,
        send: (req) => {
          const ceiling = ceilingOf(req);
          // The test is only fair if the reply costs no more than its request's ceiling.
          expect(COSTLY_SOL_USD).toBeLessThanOrEqual(ceiling);
          sent.push({ ceiling, spent: spend.snapshot().spentUsd ?? Number.NaN });
          return new Promise((resolve) => setTimeout(() => resolve(callTools([{ name: 'get_run_summary' }], COSTLY_USAGE)), 40));
        },
      };
    };
    const twelveAtOnce = async (base: string): Promise<NarrativeFailure[]> =>
      Promise.all(
        Array.from({ length: 12 }, async () =>
          (await (await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody({ model: 'gpt-6-sol' }) })).json()) as NarrativeFailure,
        ),
      );

    // $0.01 left: no request's ceiling fits, so none is sent (without holds all twelve went out: $2.41).
    const nearlySpent = new SpendCap(2, now, 1.99);
    const own = costlyModel(nearlySpent);
    const base = await start({ ownKey: true, ownTransport: own, spend: nearlySpent });
    const refused = await twelveAtOnce(base);
    expect(own.sent).toHaveLength(0);
    expect(refused.every((r) => r.ok === false && r.reason === 'budget')).toBe(true);
    expect(refused[0].message).toMatch(/less than a request may cost/);
    expect(nearlySpent.snapshot()).toMatchObject({ spentUsd: 1.99, inFlightUsd: 0 });
    await new Promise<void>((done) => server?.close(() => done()));
    server = undefined;

    // $0.20 left: what is held and spent never passes $2.00 at any moment, and every request is counted.
    const spend = new SpendCap(2, now, 1.8);
    const own2 = costlyModel(spend);
    const base2 = await start({ ownKey: true, ownTransport: own2, spend });
    const results = await twelveAtOnce(base2);
    expect(own2.sent.length).toBeGreaterThanOrEqual(2);
    for (const s of own2.sent) expect(s.spent).toBeLessThanOrEqual(2);
    const final = spend.snapshot();
    expect(final.inFlightUsd).toBe(0);
    expect(final.spentUsd).toBeLessThanOrEqual(2);
    expect(final.spentUsd).toBeCloseTo(1.8 + own2.sent.length * COSTLY_SOL_USD, 7);
    expect(results.filter((r) => r.reason === 'budget').length).toBeGreaterThanOrEqual(10);
  });

  it('a model off the allowlist (prototype names included) is refused: nothing is sent', async () => {
    const course = fakeTransport({});
    const own = fakeTransport({});
    const base = await start({ ownKey: true, transport: course, ownTransport: own });
    for (const model of ['constructor', 'toString', 'hasOwnProperty', 'gpt-4o', 'gpt-6-luna-mini']) {
      const r = (await (await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody({ model }) })).json()) as NarrativeFailure;
      expect(r, model).toMatchObject({ ok: false, reason: 'unavailable' });
      expect(r.message, model).toBe('the requested model is not available: not an offered model (this server offers gpt-6-luna, gpt-6-sol). Nothing was sent to any model.');
    }
    // Not model-shaped at all: a 400 from the request schema.
    for (const model of ['__proto__', 'gpt 6', 42, '']) {
      expect((await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody({ model }) })).status, String(model)).toBe(400);
    }
    expect(course.requests).toHaveLength(0);
    expect(own.requests).toHaveLength(0);
  });

  it('POST /reflect runs the agents and answers 200 with a NarrativeResponse', async () => {
    const t = fakeTransport({
      archivist: [() => callTools([{ name: 'get_run_summary' }]), () => answer(GOOD_DRAFT)],
      historian: [() => answer({ verdict: 'approve', issues: [] })],
    });
    const base = await start({ transport: t });
    const r = await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody() });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, source: 'ai', title: GOOD_DRAFT.title, review: { verdict: 'approved' } });
  });

  it('without a key, a valid request gets NarrativeFailure "unavailable" (the game falls back)', async () => {
    const base = await start({ key: false });
    const r = await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody() });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: false, reason: 'unavailable', fallback: true });
  });

  it('rejects bad methods, routes, content types, JSON and shapes with clear 4xx errors', async () => {
    const base = await start();
    const get = await fetch(`${base}/reflect`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await fetch(`${base}/status`, { method: 'POST', headers: json, body: '{}' })).status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/reflect`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: reflectBody() })).status).toBe(415);
    const badJson = await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: '{"chapterId": ' });
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: 'the body is not valid JSON' });
    const badShape = await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: JSON.stringify({ chapterId: 'ch4-people', evidence: { ...ch4Evidence(), collisions: -1 }, history: [] }) });
    expect(badShape.status).toBe(400);
    expect(await badShape.json()).toMatchObject({ error: 'invalid request', details: [expect.stringMatching(/collisions: below 0/)] });
    // Meaning, not just shape: a landmark from another chapter, history from the future.
    const foreign = ch4Evidence({ landmarks: [{ id: 'gauge-hut', status: 'destroyed', closest: 0 }] });
    expect((await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody({ evidence: foreign }) })).status).toBe(400);
    const future = { ...CH1_HISTORY, chapterId: 'ch9-last-thaw' };
    expect((await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody({ history: [future] }) })).status).toBe(400);
    // The epilogue needs the last chapter's run.
    expect((await fetch(`${base}/epilogue`, { method: 'POST', headers: json, body: JSON.stringify({ evidence: ch4Evidence(), history: [] }) })).status).toBe(400);
    const ep = await fetch(`${base}/epilogue`, { method: 'POST', headers: json, body: JSON.stringify({ evidence: ch9Evidence(), history: [CH1_HISTORY] }) });
    expect(ep.status).toBe(200); // reaches the agents (whose fake script is empty → NarrativeFailure 'error')
    expect(await ep.json()).toMatchObject({ ok: false, reason: 'error' });
  });

  it('treats routes named like Object.prototype members as unknown (404), not as a method table entry', async () => {
    const base = await start();
    for (const route of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      const r = await fetch(`${base}/${route}`);
      expect(r.status).toBe(404);
      expect(r.headers.get('allow')).toBeNull();
    }
  });

  it('limits the body size (413), the request rate (429) and refuses cross-origin calls (403)', async () => {
    const base = await start({ maxBodyBytes: 1024, postsPerMinute: 2 });
    const big = await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody() });
    expect(big.status).toBe(413);
    expect((await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: '{}' })).status).toBe(400);
    const limited = await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: '{}' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    const cross = await fetch(`${base}/status`, { headers: { Origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
  });

  /** A model that takes `ms` per request (a tool call each time) unless its request is aborted. */
  const slowModel = (ms: number): Transport & { signals: AbortSignal[] } => {
    const signals: AbortSignal[] = [];
    return {
      name: 'slow',
      signals,
      send: (_req, signal) => {
        signals.push(signal);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(callTools([{ name: 'get_run_summary' }])), ms);
          signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))));
        });
      },
    };
  };
  const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
    for (const t0 = Date.now(); !cond() && Date.now() - t0 < ms; ) await new Promise((r) => setTimeout(r, 10));
  };

  it('stops the agents when the browser gives up: the request in flight is aborted and nothing more is sent', async () => {
    const model = slowModel(150);
    const logger = memoryLogger();
    const base = await start({ transport: model, logger });
    const client = new AbortController();
    // The browser gives up once the first model request is in flight (a fixed timer raced the server
    // under a loaded parallel run: it could abort before the server was listening for it).
    void until(() => model.signals.length > 0).then(() => client.abort());
    const err = await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody(), signal: client.signal }).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    await until(() => logger.traces.size > 0);
    await new Promise((r) => setTimeout(r, 300)); // long enough for two more 150 ms requests, had they been sent
    expect(model.signals).toHaveLength(1);
    expect(model.signals[0].aborted).toBe(true);
    const trace = [...logger.traces.values()][0] as { result: { ok: boolean; message: string } };
    expect(trace.result).toMatchObject({ ok: false, message: 'cancelled: the browser closed the request' });
    expect(logger.usage).toEqual([expect.objectContaining({ agent: 'archivist', requests: 1, ok: false })]);
  });

  it('sends nothing when the browser had already gone before the run began', async () => {
    const model = slowModel(150);
    const logger = memoryLogger();
    const handle = handlerFor({ transport: model, logger });
    const body = reflectBody();
    // The request was read in full, but the connection closed before the handler listened for it.
    const req = Object.assign(Readable.from([Buffer.from(body)]), {
      method: 'POST',
      url: '/api/story/reflect',
      headers: { host: '127.0.0.1:1', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      socket: { destroyed: true },
    });
    const res = Object.assign(new EventEmitter(), {
      headersSent: false,
      destroyed: true,
      writableEnded: false,
      statusCode: 200,
      setHeader: (): void => undefined,
      writeHead(): unknown {
        return this;
      },
      end(): void {
        this.writableEnded = true;
      },
    });
    await handle(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    expect(model.signals).toHaveLength(0);
    const trace = [...logger.traces.values()][0] as { result: { ok: boolean; message: string } } | undefined;
    expect(trace?.result).toMatchObject({ ok: false, message: 'cancelled: the browser closed the request' });
  });

  it('stops the agents at the narrative deadline and answers with the fallback', async () => {
    const model = slowModel(40);
    const base = await start({ transport: model, deadlineMs: 100 });
    const r = await fetch(`${base}/reflect`, { method: 'POST', headers: json, body: reflectBody() });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: false, reason: 'error', fallback: true, message: expect.stringMatching(/^cancelled: the reflection passed its 0 s deadline/) });
    expect(model.signals.length).toBeLessThanOrEqual(4);
  });

  it('GET /usage reports totals, per-agent usage, the cost estimate and the budget', async () => {
    const base = await start();
    const u = (await (await fetch(`${base}/usage`)).json()) as Record<string, unknown>;
    expect(Object.keys(u).sort()).toEqual(['budget', 'byAgent', 'byModel', 'estimate', 'ownKeySpend', 'runs', 'totals']);
  });
});

describe('production wiring (defaultDeps): the own-key limit outlives a restart and is shared by every server on the key', () => {
  const FAKE_OWN = 'sk-own-wiring-test-0123456789';
  const dirs: string[] = [];
  const tempDir = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'lt-wiring-'));
    dirs.push(d);
    return d;
  };
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const noLog = (): void => undefined;

  /**
   * Runs `fn` with these variables in the real environment, which wins over every .env file, and puts the
   * previous values back afterwards (never printing them). No request is sent in these tests.
   */
  function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
    const saved = Object.entries(vars).map(([k]) => [k, process.env[k]] as const);
    Object.assign(process.env, vars);
    try {
      return fn();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }
  const ENV = { OPENAI_API_KEY: FAKE_OWN, PORTKEY_API_KEY: 'pk-fake-wiring-0123456789', OPENAI_DAILY_USD_LIMIT: '2.00', STORY_AI: 'on' };

  const record = (over: Partial<UsageRecord>): UsageRecord => ({
    ts: new Date().toISOString(),
    runId: 'lt-wiring',
    agent: 'archivist',
    model: 'gpt-6-sol',
    provider: 'own-key',
    inputTokens: 1000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 100,
    reasoningTokens: 0,
    requests: 1,
    unmeteredRequests: 0,
    toolCalls: 0,
    durationMs: 1000,
    costUsd: 0,
    ok: true,
    ...over,
  });
  const solStatus = (d: ReturnType<typeof defaultDeps>) => modelStatuses(d).find((m) => m.id === 'gpt-6-sol');

  it("after a restart the limit starts from today's own-key spend in this checkout's usage log", () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'logs'));
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const lines = [
      record({ costUsd: 1.25 }),
      record({ costUsd: 0.75, agent: 'historian' }),
      record({ costUsd: 9, ts: yesterday }), // another day
      record({ costUsd: 7, model: 'gpt-6-luna', provider: 'course' }), // the course key's, not yours
    ];
    writeFileSync(path.join(root, 'logs', 'agent-usage.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
    withEnv(ENV, () => {
      const d = defaultDeps(root, noLog, { ledgerDir: tempDir() });
      expect(d.config.providers['own-key'].apiKey).toBe(FAKE_OWN);
      expect(d.spend.snapshot()).toMatchObject({ spentUsd: 2, inFlightUsd: 0, limitUsd: 2 });
      expect(solStatus(d)).toMatchObject({ available: false, reason: expect.stringMatching(/\(\$2\.0000\) reached OPENAI_DAILY_USD_LIMIT \(\$2\.00\)/) });
      expect(() => d.spend.hold(0.01)).toThrow(/reached OPENAI_DAILY_USD_LIMIT/);
    });
  });

  it('two servers on the same OPENAI_API_KEY (another checkout, or one started earlier) share one limit', () => {
    const ledgerDir = tempDir();
    withEnv(ENV, () => {
      // The main checkout and a worktree, each with its own logs/ folder, both started before either spends.
      const main = defaultDeps(tempDir(), noLog, { ledgerDir });
      const worktree = defaultDeps(tempDir(), noLog, { ledgerDir });
      const held = main.spend.hold(0.3);
      expect(worktree.spend.snapshot()).toMatchObject({ spentUsd: 0.3, inFlightUsd: 0.3 });
      held.settle(1.5);
      worktree.spend.hold(0.1).settle(0.5);
      for (const d of [main, worktree]) {
        expect(d.spend.snapshot().spentUsd).toBe(2);
        expect(solStatus(d)?.available).toBe(false);
        expect(() => d.spend.hold(0.01)).toThrow(/reached OPENAI_DAILY_USD_LIMIT/);
      }
      // A server started afterwards, in a checkout with no log at all, has the day too.
      expect(defaultDeps(tempDir(), noLog, { ledgerDir }).spend.reached()).toBe(true);
    });
    // Another key has a limit of its own.
    withEnv({ ...ENV, OPENAI_API_KEY: 'sk-own-wiring-other-0123456789' }, () => {
      expect(defaultDeps(tempDir(), noLog, { ledgerDir }).spend.snapshot().spentUsd).toBe(0);
    });
  });
});
