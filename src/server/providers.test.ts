import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { NarrativeResult } from '../story/types';
import { loadConfig } from './config';
import { createStoryHandler, RateLimiter } from './handler';
import { Budget, type ResponsesRequest } from './llm';
import { SpendCap } from './spend';
import { memoryLogger } from './log';
import { createTransports, modelStatuses, routeModel } from './providers';
import { agentOf, answer, callTools } from './testing/fakeTransport';
import { CH1_HISTORY, ch4Evidence, FIXTURE_LEVEL, FIXTURE_STORY, GOOD_DRAFT } from './testing/fixtureStory';

/**
 * The two providers end to end, through the REAL transports with a fake fetch (no network, no model):
 * which URL and headers each model's requests carry, and that each key only ever travels to its own host.
 */

const COURSE_KEY = 'pk-course-isolation-0123456789';
const OWN_KEY = 'sk-own-isolation-0123456789';

interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: ResponsesRequest;
  /** Everything that left in this request: URL, headers and body. */
  readonly raw: string;
}

/** A fetch that plays both agents (a tool call, then the fixture draft; the Historian approves) and records every request. */
function scriptedFetch(): { readonly fetch: typeof fetch; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const fake = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = { ...(init?.headers as Record<string, string>) };
    const body = JSON.parse(String(init?.body)) as ResponsesRequest;
    sent.push({ url: String(url), headers, body, raw: JSON.stringify({ url: String(url), headers, body: String(init?.body) }) });
    const toolsDone = body.input.some((i) => 'type' in i && i.type === 'function_call_output');
    const reply =
      agentOf(body) === 'historian'
        ? answer({ verdict: 'approve', issues: [] })
        : toolsDone
          ? answer(GOOD_DRAFT)
          : callTools([{ name: 'get_run_summary' }]);
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch: fake as typeof fetch, sent };
}

const both = (): ReturnType<typeof loadConfig> => loadConfig('.', { PORTKEY_API_KEY: COURSE_KEY, OPENAI_API_KEY: OWN_KEY });

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

describe('providers: routing by model', () => {
  it('gpt-6-luna goes to Portkey with the course key and headers; gpt-6-sol to OpenAI with your key and none of them', async () => {
    const config = both();
    const { fetch: f, sent } = scriptedFetch();
    const d = { config, transports: createTransports(config, f), spend: new SpendCap(config.ownKeyDailyUsdLimit) };
    const req = (model: string): ResponsesRequest => ({ model, instructions: 'x', input: [] }) as unknown as ResponsesRequest;

    const luna = routeModel('gpt-6-luna', d);
    if (!luna.ok) throw new Error(luna.message);
    expect(luna).toMatchObject({ provider: 'course', model: 'gpt-6-luna' });
    expect(luna.spend).toBeUndefined(); // the USD limit is the own-key provider's only
    await luna.transport.send(req('gpt-6-luna'), new AbortController().signal);

    const sol = routeModel('gpt-6-sol', d);
    if (!sol.ok) throw new Error(sol.message);
    expect(sol).toMatchObject({ provider: 'own-key', model: 'gpt-6-sol' });
    expect(sol.spend).toBe(d.spend);
    await sol.transport.send(req('gpt-6-sol'), new AbortController().signal);

    expect(sent.map((s) => s.url)).toEqual(['https://api.portkey.ai/v1/responses', 'https://api.openai.com/v1/responses']);
    expect(sent[0].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${COURSE_KEY}`,
      'x-portkey-provider': 'openai',
      'x-portkey-cache-force-refresh': 'true',
    });
    expect(sent[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${OWN_KEY}` });

    // The server default follows MODEL_NAME only within the allowlist.
    expect(routeModel(undefined, d)).toMatchObject({ ok: true, model: 'gpt-6-luna', provider: 'course' });
    const solDefault = loadConfig('.', { PORTKEY_API_KEY: COURSE_KEY, OPENAI_API_KEY: OWN_KEY, MODEL_NAME: 'gpt-6-sol' });
    expect(routeModel(undefined, { ...d, config: solDefault })).toMatchObject({ ok: true, provider: 'own-key' });
  });

  it('even a mis-routed request cannot put another model on the course key, nor luna on your key', async () => {
    const config = both();
    const { fetch: f, sent } = scriptedFetch();
    const t = createTransports(config, f);
    const req = (model: string): ResponsesRequest => ({ model, instructions: 'x', input: [] }) as unknown as ResponsesRequest;
    await expect(t.course?.send(req('gpt-6-sol'), new AbortController().signal)).rejects.toThrow(/serves gpt-6-luna only/);
    await expect(t['own-key']?.send(req('gpt-6-luna'), new AbortController().signal)).rejects.toThrow(/was not sent/);
    expect(sent).toHaveLength(0);
  });

  it('a base URL override spelling the other provider\'s host another way still sends each key to its own host', async () => {
    const config = loadConfig('.', {
      PORTKEY_API_KEY: COURSE_KEY,
      OPENAI_API_KEY: OWN_KEY,
      PORTKEY_BASE_URL: 'https://api.openai.com./v1',
      OPENAI_BASE_URL: 'https://api.portkey.ai%2E/v1',
    });
    expect(config.notes).toHaveLength(2);
    const { fetch: f, sent } = scriptedFetch();
    const t = createTransports(config, f);
    const req = (model: string): ResponsesRequest => ({ model, instructions: 'x', input: [] }) as unknown as ResponsesRequest;
    await t.course?.send(req('gpt-6-luna'), new AbortController().signal);
    await t['own-key']?.send(req('gpt-6-sol'), new AbortController().signal);
    expect(sent.map((s) => [s.url, s.headers.Authorization])).toEqual([
      ['https://api.portkey.ai/v1/responses', `Bearer ${COURSE_KEY}`],
      ['https://api.openai.com/v1/responses', `Bearer ${OWN_KEY}`],
    ]);
  });

  it('allowlist lookups are own-property only: prototype names are no model', () => {
    const config = both();
    const d = { config, transports: createTransports(config, scriptedFetch().fetch), spend: new SpendCap(2) };
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(routeModel(name, d), name).toMatchObject({ ok: false, reason: 'unavailable', message: expect.stringMatching(/^the requested model is not available: not an offered model/) });
    }
  });

  it('status per model for each combination of keys (no keys, course only, own key only, both)', () => {
    const status = (vars: Record<string, string>, spend = new SpendCap(2)) => {
      const config = loadConfig('.', vars);
      return modelStatuses({ config, transports: createTransports(config, scriptedFetch().fetch), spend });
    };
    const none = status({});
    expect(none).toEqual([
      { id: 'gpt-6-luna', provider: 'course', available: false, reason: expect.stringMatching(/^PORTKEY_API_KEY not set/) },
      { id: 'gpt-6-sol', provider: 'own-key', available: false, reason: expect.stringMatching(/^OPENAI_API_KEY not set/) },
    ]);
    expect(status({ PORTKEY_API_KEY: COURSE_KEY }).map((m) => m.available)).toEqual([true, false]);
    expect(status({ OPENAI_API_KEY: OWN_KEY }).map((m) => m.available)).toEqual([false, true]);
    expect(status({ PORTKEY_API_KEY: COURSE_KEY, OPENAI_API_KEY: OWN_KEY }).map((m) => m.available)).toEqual([true, true]);
    // Your key with the limit spent, or with the limit at 0, is unavailable with the reason.
    const spent = status({ PORTKEY_API_KEY: COURSE_KEY, OPENAI_API_KEY: OWN_KEY }, new SpendCap(2, Date.now, 2));
    expect(spent[1]).toMatchObject({ available: false, reason: expect.stringMatching(/reached OPENAI_DAILY_USD_LIMIT/) });
    const zero = status({ PORTKEY_API_KEY: COURSE_KEY, OPENAI_API_KEY: OWN_KEY, OPENAI_DAILY_USD_LIMIT: '0' }, new SpendCap(0));
    expect(zero[1]).toEqual({ id: 'gpt-6-sol', provider: 'own-key', available: false, reason: 'disabled by OPENAI_DAILY_USD_LIMIT=0' });
    // A limit that cannot be read turns gpt-6-sol off and says so (never the $2.00 default).
    const unreadable = status({ PORTKEY_API_KEY: COURSE_KEY, OPENAI_API_KEY: OWN_KEY, OPENAI_DAILY_USD_LIMIT: '0,50' }, new SpendCap(0));
    expect(unreadable).toEqual([
      { id: 'gpt-6-luna', provider: 'course', available: true },
      { id: 'gpt-6-sol', provider: 'own-key', available: false, reason: expect.stringMatching(/^OPENAI_DAILY_USD_LIMIT is not a plain number of dollars .*gpt-6-sol is off until it is fixed$/) },
    ]);
    expect(JSON.stringify([none, spent, zero, unreadable])).not.toMatch(new RegExp(`${COURSE_KEY}|${OWN_KEY}`));
  });
});

describe('providers: key isolation, end to end over HTTP', () => {
  it('the course key never travels to OpenAI, your key never to Portkey, and neither reaches the browser', async () => {
    const config = both();
    const { fetch: f, sent } = scriptedFetch();
    const logger = memoryLogger();
    const handle = createStoryHandler({
      config,
      story: FIXTURE_STORY,
      transports: createTransports(config, f),
      budget: new Budget({ maxRequests: 100, dailyTokens: 1_000_000 }),
      spend: new SpendCap(config.ownKeyDailyUsdLimit),
      logger,
      level: () => FIXTURE_LEVEL,
      rate: new RateLimiter(100),
    });
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/story`;
    const post = async (model: string): Promise<string> =>
      (
        await fetch(`${base}/reflect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterId: 'ch4-people', evidence: ch4Evidence(), history: [CH1_HISTORY], model }),
        })
      ).text();

    const browserSaw = [await post('gpt-6-sol'), await post('gpt-6-luna'), await post('gpt-6-sol')];
    browserSaw.push(await (await fetch(`${base}/status`)).text(), await (await fetch(`${base}/usage`)).text());
    for (const r of browserSaw.slice(0, 3)) expect((JSON.parse(r) as NarrativeResult).ok).toBe(true);

    const toOpenAI = sent.filter((s) => s.url.startsWith('https://api.openai.com/'));
    const toPortkey = sent.filter((s) => s.url.startsWith('https://api.portkey.ai/'));
    expect(toOpenAI.length).toBe(6);
    expect(toPortkey.length).toBe(3);
    expect(toOpenAI.length + toPortkey.length).toBe(sent.length);
    for (const s of toOpenAI) {
      expect(s.body.model).toBe('gpt-6-sol');
      expect(s.raw).not.toContain(COURSE_KEY);
      expect(s.raw).toContain(OWN_KEY); // in the Authorization header only
      expect(JSON.stringify(s.body)).not.toContain(OWN_KEY);
      expect(Object.keys(s.headers).filter((h) => /portkey/i.test(h))).toEqual([]);
    }
    for (const s of toPortkey) {
      expect(s.body.model).toBe('gpt-6-luna');
      expect(s.raw).not.toContain(OWN_KEY);
      expect(JSON.stringify(s.body)).not.toContain(COURSE_KEY);
      expect(s.headers['x-portkey-provider']).toBe('openai');
    }
    for (const text of browserSaw) {
      expect(text).not.toContain(COURSE_KEY);
      expect(text).not.toContain(OWN_KEY);
    }
    // Usage and traces say which model and which key paid.
    expect(logger.usage.map((u) => `${u.model}/${u.provider}`)).toEqual([
      'gpt-6-sol/own-key', 'gpt-6-sol/own-key', 'gpt-6-luna/course', 'gpt-6-luna/course', 'gpt-6-sol/own-key', 'gpt-6-sol/own-key',
    ]);
    const traces = [...logger.traces.values()] as { model: string; provider: string; transport: string }[];
    expect(traces.map((t) => [t.model, t.provider, t.transport])).toEqual([
      ['gpt-6-sol', 'own-key', 'openai'],
      ['gpt-6-luna', 'course', 'portkey'],
      ['gpt-6-sol', 'own-key', 'openai'],
    ]);
    expect(JSON.stringify(traces)).not.toMatch(new RegExp(`${COURSE_KEY}|${OWN_KEY}`));
  });
});
