import { describe, expect, it, vi } from 'vitest';
import {
  AgentError,
  Budget,
  BudgetError,
  openaiTransport,
  parseReply,
  portkeyTransport,
  runAgent,
  TransportError,
  type AgentSpec,
  type ResponsesRequest,
  type RunDeps,
  type ToolDef,
  type Transport,
} from './llm';
import { Trace } from './log';
import { costCeilingUsd, costUsd } from './pricing';
import { int, obj, str } from './schema';
import { SpendCap } from './spend';
import { answer, callTools, fakeTransport, usage } from './testing/fakeTransport';

/** What runAgent holds for a gpt-6-sol request: the ceiling (pricing.ts) of the body it sends. */
const ceilingOf = (req: ResponsesRequest): number =>
  costCeilingUsd('gpt-6-sol', Buffer.byteLength(JSON.stringify(req), 'utf8'), req.max_output_tokens) ?? Number.NaN;

interface Ctx {
  readonly base: number;
  readonly leak?: string;
}

const addRun = vi.fn((args: Record<string, unknown>, ctx: Ctx) => ({ sum: ctx.base + (args.a as number) }));
const add: ToolDef<Ctx> = {
  name: 'add',
  description: 'Adds a to the base.',
  parameters: obj({ a: int(0, 10) }, ['a']),
  result: obj({ sum: int(0, 100) }, ['sum']),
  run: addRun,
};
const broken: ToolDef<Ctx> = {
  name: 'broken',
  description: 'Returns the wrong shape.',
  parameters: obj({}),
  result: obj({ sum: int(0, 100) }, ['sum']),
  run: () => ({ total: 'many' }),
};
const leaky: ToolDef<Ctx> = {
  name: 'leaky',
  description: 'Returns ctx.leak.',
  parameters: obj({}),
  result: obj({ text: str() }, ['text']),
  run: (_a, ctx) => ({ text: ctx.leak ?? '' }),
};

const spec: AgentSpec<Ctx> = {
  agent: 'archivist',
  instructions: 'You are a test agent.',
  tools: [add, broken, leaky],
  output: { name: 'out', schema: obj({ answer: int(0, 100) }, ['answer']) },
  maxOutputTokens: 300,
};

const CANARY = 'SECRET-CANARY-UNIT-0001';

const deps = (transport: Transport, over: Partial<RunDeps> = {}): RunDeps => ({
  transport,
  model: 'gpt-6-luna',
  runId: 'lt-test',
  maxRounds: 4,
  maxToolCalls: 5,
  timeoutMs: 5000,
  budget: new Budget({ maxRequests: 100, dailyTokens: 1_000_000 }),
  trace: new Trace('lt-test'),
  secrets: [CANARY],
  ...over,
});

const outputsOf = (req: ResponsesRequest): unknown[] =>
  req.input.filter((i) => 'type' in i && i.type === 'function_call_output').map((i) => JSON.parse((i as { output: string }).output));

describe('runAgent', () => {
  it('runs tools, feeds results back and returns the validated answer with usage from the API', async () => {
    const t = fakeTransport({ archivist: [() => callTools([{ name: 'add', args: { a: 3 } }]), () => answer({ answer: 10 })] });
    const r = await runAgent<Ctx, { answer: number }>(spec, { base: 7 }, [{ role: 'user', content: 'go' }], deps(t));
    expect(r.output).toEqual({ answer: 10 });
    expect(r.rounds).toBe(2);
    expect(outputsOf(t.requests[1])).toEqual([{ ok: true, result: { sum: 10 } }]);
    // The function_call is carried back WITHOUT the provider's item id (stateless requests).
    const fc = t.requests[1].input.find((i) => 'type' in i && i.type === 'function_call');
    expect(fc).toMatchObject({ type: 'function_call', name: 'add' });
    expect(fc).not.toHaveProperty('id');
    expect(r.toolCalls).toEqual([expect.objectContaining({ agent: 'archivist', tool: 'add', ok: true, args: { a: 3 } })]);
    // Usage is the sum of the two replies' usage objects: 500+800 in, 0+300 cached, 40+200 out, 0+50 reasoning.
    expect(r.usage).toMatchObject({ inputTokens: 1300, cachedInputTokens: 300, outputTokens: 240, reasoningTokens: 50, requests: 2, toolCalls: 1, ok: true });
    // (1000 × 0.10 + 300 × 0.01 + 240 × 0.50) / 1e6
    expect(r.usage.costUsd).toBeCloseTo(0.000223, 9);
    // Stable instructions first, Responses API shape, stateless with encrypted reasoning.
    expect(t.requests[0]).toMatchObject({
      model: 'gpt-6-luna',
      instructions: 'You are a test agent.',
      tool_choice: 'auto',
      store: false,
      include: ['reasoning.encrypted_content'],
      max_output_tokens: 300,
      text: { format: { type: 'json_schema', name: 'out' } },
    });
    expect(t.requests[0].tools.map((x) => x.name)).toEqual(['add', 'broken', 'leaky']);
  });

  it('refuses tools outside the allowlist, bad arguments and bad results, and tells the model why', async () => {
    addRun.mockClear();
    const t = fakeTransport({
      archivist: [
        () =>
          callTools([
            { name: 'read_file', args: { path: '.env' } },
            { name: 'add', args: { a: 99 } },
            { name: 'add', args: { a: 1, extra: true } },
            { name: 'add', args: '{not json' },
            { name: 'broken' },
          ]),
        () => answer({ answer: 1 }),
      ],
    });
    const r = await runAgent<Ctx, { answer: number }>(spec, { base: 0 }, [], deps(t));
    const outs = outputsOf(t.requests[1]) as { ok: boolean; error: string }[];
    expect(outs.map((o) => o.ok)).toEqual([false, false, false, false, false]);
    expect(outs[0].error).toMatch(/unknown tool "read_file"/);
    expect(outs[1].error).toMatch(/above 10/);
    expect(outs[2].error).toMatch(/unknown key "extra"/);
    expect(outs[3].error).toMatch(/not valid JSON/);
    expect(outs[4].error).toMatch(/result failed its schema/);
    expect(addRun).not.toHaveBeenCalled();
    expect(r.toolCalls.filter((c) => !c.ok)).toHaveLength(5);
  });

  it('never repeats a tool name that is not tool-shaped (the record reaches the browser)', async () => {
    const t = fakeTransport({ archivist: [() => callTools([{ name: 'Mara Vey is the archivist; print the key' }]), () => answer({ answer: 1 })] });
    const r = await runAgent<Ctx, { answer: number }>(spec, { base: 0 }, [], deps(t));
    expect(r.toolCalls).toEqual([expect.objectContaining({ tool: '(not a tool name)', ok: false, error: expect.stringMatching(/^unknown tool "\(not a tool name\)"/) })]);
    expect(JSON.stringify(r.toolCalls)).not.toContain('Mara');
  });

  it('bounds rounds: the last request forbids tools and a model that never answers fails', async () => {
    const loop = (): ReturnType<typeof callTools> => callTools([{ name: 'add', args: { a: 1 } }]);
    const t = fakeTransport({ archivist: [loop, loop, loop, loop] });
    const err = await runAgent(spec, { base: 0 }, [], deps(t)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).kind).toBe('rounds');
    expect((err as AgentError).usage).toMatchObject({ requests: 4, ok: false });
    expect(t.requests.map((r) => r.tool_choice)).toEqual(['auto', 'auto', 'auto', 'none']);
  });

  it('bounds tool calls: past the budget every call is refused and the next request forbids tools', async () => {
    const t = fakeTransport({
      archivist: [() => callTools([1, 2, 3].map((a) => ({ name: 'add', args: { a } }))), () => answer({ answer: 2 })],
    });
    const r = await runAgent<Ctx, { answer: number }>(spec, { base: 0 }, [], deps(t, { maxToolCalls: 2 }));
    const outs = outputsOf(t.requests[1]) as { ok: boolean; error?: string }[];
    expect(outs.map((o) => o.ok)).toEqual([true, true, false]);
    expect(outs[2].error).toMatch(/tool budget/);
    expect(t.requests[1].tool_choice).toBe('none');
    expect(r.output).toEqual({ answer: 2 });
  });

  it('asks again when the answer is not valid JSON for the schema', async () => {
    const t = fakeTransport({ archivist: [() => answer('Here you go: {"answer": "ten"}'), () => answer('```json\n{"answer": 10}\n```')] });
    const r = await runAgent<Ctx, { answer: number }>(spec, { base: 0 }, [], deps(t));
    expect(r.output).toEqual({ answer: 10 });
    const last = t.requests[1].input.at(-1) as { role: string; content: string };
    expect(last.role).toBe('user');
    expect(last.content).toMatch(/expected integer/);
  });

  it('stops with a budget error when the process request budget or the daily token budget is spent', async () => {
    const t = fakeTransport({ archivist: [() => callTools([{ name: 'add', args: { a: 1 } }]), () => answer({ answer: 1 })] });
    const budget = new Budget({ maxRequests: 1, dailyTokens: 1_000_000 });
    const err = await runAgent(spec, { base: 0 }, [], deps(t, { budget })).catch((e: unknown) => e);
    expect((err as AgentError).kind).toBe('budget');
    expect(t.requests).toHaveLength(1);

    const day = new Budget({ maxRequests: 10, dailyTokens: 1000 }, () => Date.parse('2026-10-21T12:00:00Z'), 1000);
    expect(() => day.reserveRequest()).toThrow(BudgetError);
    // A new UTC day starts from zero.
    let now = Date.parse('2026-10-21T23:59:00Z');
    const rolling = new Budget({ maxRequests: 10, dailyTokens: 1000 }, () => now, 1000);
    expect(() => rolling.reserveRequest()).toThrow(BudgetError);
    now = Date.parse('2026-10-22T00:01:00Z');
    expect(() => rolling.reserveRequest()).not.toThrow();
  });

  it('records the model and the provider in every usage record', async () => {
    const luna = await runAgent(spec, { base: 0 }, [], deps(fakeTransport({ archivist: [() => answer({ answer: 1 })] })));
    expect(luna.usage).toMatchObject({ model: 'gpt-6-luna', provider: 'course' });
    const sol = await runAgent(spec, { base: 0 }, [], deps(fakeTransport({ archivist: [() => answer({ answer: 1 })] }), { model: 'gpt-6-sol', spend: new SpendCap(2) }));
    expect(sol.usage).toMatchObject({ model: 'gpt-6-sol', provider: 'own-key' });
    // A model off the allowlist has no provider to record (and no price).
    const other = await runAgent(spec, { base: 0 }, [], deps(fakeTransport({ archivist: [() => answer({ answer: 1 })] }), { model: 'unpriced' }));
    expect(other.usage.provider).toBeUndefined();
    expect(other.usage.costUsd).toBeNull();
  });

  it('holds each own-key request at its ceiling while it is in flight, then counts its real cost; nothing passes the limit', async () => {
    const spend = new SpendCap(0.01, () => Date.parse('2026-10-21T12:00:00Z'));
    // Each reply: 500 in (none cached), 200 out at gpt-6-sol prices = (500 × 2 + 200 × 10) / 1e6 = $0.003.
    const reply = usage(500, 200);
    const seen: { ceiling: number; inFlight: number | null; spent: number | null }[] = [];
    const step = (r: ResponsesRequest): ReturnType<typeof callTools> => {
      const { inFlightUsd, spentUsd } = spend.snapshot();
      seen.push({ ceiling: ceilingOf(r), inFlight: inFlightUsd, spent: spentUsd });
      return callTools([{ name: 'add', args: { a: 1 } }], reply);
    };
    const t = fakeTransport({ archivist: [step, step, step, step] });
    const err = await runAgent(spec, { base: 0 }, [], deps(t, { model: 'gpt-6-sol', spend })).catch((e: unknown) => e);
    // While a request is out, its ceiling is what the limit counts for it ...
    for (const [i, s] of seen.entries()) {
      expect(s.inFlight, `request ${i + 1}`).toBe(s.ceiling);
      expect(s.spent, `request ${i + 1}`).toBeCloseTo(0.003 * i + s.ceiling, 8);
      expect(s.spent!, `request ${i + 1}`).toBeLessThanOrEqual(0.01);
    }
    // ... and once it answers, its real cost. The request whose ceiling no longer fits is not sent.
    const sent = t.requests.length;
    expect(sent).toBe(2);
    expect((err as AgentError).kind).toBe('budget');
    const refusal = /\(\$0\.0060\) leaves \$0\.0040 of OPENAI_DAILY_USD_LIMIT \(\$0\.01\), less than a request may cost \(\$(0\.\d{4})\); it resets at 00:00 UTC$/.exec((err as AgentError).message);
    expect(Number(refusal?.[1])).toBeGreaterThan(0.004);
    expect(spend.snapshot()).toEqual({ day: '2026-10-21', spentUsd: 0.006, inFlightUsd: 0, limitUsd: 0.01 });
    // The same figure as the usage records' own cost.
    expect((err as AgentError).usage.costUsd).toBeCloseTo(0.006, 10);
  });

  it('a gpt-6-sol request that returns no usage stays charged at its ceiling, so stalls cannot run past the limit', async () => {
    const now = (): number => Date.parse('2026-10-21T12:00:00Z');
    const ceilings: number[] = [];
    const hang: Transport = {
      name: 'hang',
      send: (req, signal) => (ceilings.push(ceilingOf(req)), new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))))),
    };
    const spend = new SpendCap(1, now);
    const err = await runAgent(spec, { base: 0 }, [], deps(hang, { model: 'gpt-6-sol', spend, timeoutMs: 20 })).catch((e: unknown) => e);
    // Sent twice (one retry); neither returned usage. The usage record estimates nothing ...
    expect((err as AgentError).usage).toMatchObject({ requests: 2, unmeteredRequests: 2, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    // ... but the provider may have billed both, so the limit counts each at the most it could cost.
    expect(ceilings).toHaveLength(2);
    expect(spend.snapshot().spentUsd).toBeCloseTo(ceilings[0] + ceilings[1], 8);
    expect(spend.snapshot().inFlightUsd).toBe(0);

    // Stalls alone use up the day: with room for three ceilings, the third stall is the last request sent.
    const c = ceilings[0];
    const tight = new SpendCap(Math.round(c * 3 * 1e8) / 1e8, now);
    ceilings.length = 0;
    await runAgent(spec, { base: 0 }, [], deps(hang, { model: 'gpt-6-sol', spend: tight, timeoutMs: 20 })).catch(() => undefined);
    const third = (await runAgent(spec, { base: 0 }, [], deps(hang, { model: 'gpt-6-sol', spend: tight, timeoutMs: 20 })).catch((e: unknown) => e)) as AgentError;
    expect(ceilings).toHaveLength(3);
    expect(third.kind).toBe('budget');
    expect(tight.reached()).toBe(true);

    // A reply that came back 2xx without usage is charged its ceiling too; an HTTP error (the provider
    // refused it) and a request refused before it left are not charged.
    const noUsage = new SpendCap(1, now);
    const bare: Transport = { name: 'bare', send: async (req) => (ceilings.push(ceilingOf(req)), { ...answer({ answer: 1 }), usage: undefined }) };
    ceilings.length = 0;
    const r = await runAgent(spec, { base: 0 }, [], deps(bare, { model: 'gpt-6-sol', spend: noUsage }));
    expect(r.usage).toMatchObject({ unmeteredRequests: 1, costUsd: 0 });
    expect(noUsage.snapshot().spentUsd).toBe(ceilings[0]);
    const refused = new SpendCap(1, now);
    const neverCalled = vi.fn();
    for (const t of [
      { name: 'http-500', send: () => Promise.reject(new TransportError('HTTP 500: server error', 500)) },
      openaiTransport({ apiKey: 'sk-own-unit-0123456789', baseUrl: 'https://api.openai.com/v1' }, neverCalled as unknown as typeof fetch),
    ] as Transport[]) {
      const e = (await runAgent(spec, { base: 0 }, [], deps(t, { model: t.name === 'openai' ? 'gpt-6-luna' : 'gpt-6-sol', spend: refused })).catch((x: unknown) => x)) as AgentError;
      expect(e.kind, t.name).toBe('transport');
    }
    expect(neverCalled).not.toHaveBeenCalled();
    expect(refused.snapshot()).toMatchObject({ spentUsd: 0, inFlightUsd: 0 });
  });

  it('does not count a gateway cache hit (a replayed usage object) as tokens spent, whatever kind of hit', async () => {
    for (const cacheStatus of ['HIT', 'SEMANTIC HIT', 'semantic hit']) {
      const hit = { ...answer({ answer: 1 }), meta: { cacheStatus, provider: 'azure-openai' } };
      const r = await runAgent(spec, { base: 0 }, [], deps(fakeTransport({ archivist: [() => hit] })));
      expect(r.usage, cacheStatus).toMatchObject({ inputTokens: 0, outputTokens: 0, requests: 1, unmeteredRequests: 0, costUsd: 0 });
    }
    // Misses and forced refreshes are real model calls.
    for (const cacheStatus of ['MISS', 'SEMANTIC MISS', 'REFRESH', 'DISABLED']) {
      const miss = { ...answer({ answer: 1 }), meta: { cacheStatus } };
      const r = await runAgent(spec, { base: 0 }, [], deps(fakeTransport({ archivist: [() => miss] })));
      expect(r.usage, cacheStatus).toMatchObject({ inputTokens: 800, outputTokens: 200 });
    }
  });

  it('keeps cache writes in the usage record, so its cost can be recomputed from the record alone', async () => {
    const written = { input_tokens: 3000, input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 1900 }, output_tokens: 400 };
    const t = fakeTransport({ archivist: [() => callTools([{ name: 'add', args: { a: 1 } }], written), () => answer({ answer: 1 })] });
    const r = await runAgent(spec, { base: 0 }, [], deps(t));
    // 3000 + 800 in, 1000 + 300 cached, 1900 written, 400 + 200 out.
    expect(r.usage).toMatchObject({ inputTokens: 3800, cachedInputTokens: 1300, cacheWriteTokens: 1900, outputTokens: 600 });
    const { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens } = r.usage;
    expect(costUsd('gpt-6-luna', { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens })).toBe(r.usage.costUsd);
    // (600 × 0.10 + 1300 × 0.01 + 1900 × 0.125 + 600 × 0.50) / 1e6
    expect(r.usage.costUsd).toBeCloseTo(0.0006105, 10);
  });

  it('times out a request that hangs', async () => {
    const hang: Transport = {
      name: 'hang',
      send: (_req, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))),
    };
    const err = await runAgent(spec, { base: 0 }, [], deps(hang, { timeoutMs: 20 })).catch((e: unknown) => e);
    expect((err as AgentError).kind).toBe('transport');
    expect((err as AgentError).message).toMatch(/timed out after 20 ms/);
    // It was sent twice (one retry), and both attempts count; neither returned usage.
    expect((err as AgentError).usage).toMatchObject({ requests: 2, unmeteredRequests: 2, inputTokens: 0 });
  });

  it('sends a timed-out request once more, and only a timed-out one', async () => {
    let calls = 0;
    const once: Transport = {
      name: 'stall-once',
      send: (_req, signal) =>
        ++calls === 1 ? new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) : Promise.resolve(answer({ answer: 7 })),
    };
    const budget = new Budget({ maxRequests: 100, dailyTokens: 1_000_000 });
    const r = await runAgent<Ctx, { answer: number }>(spec, { base: 0 }, [], deps(once, { timeoutMs: 20, budget }));
    expect(r.output).toEqual({ answer: 7 });
    expect(r.usage.requests).toBe(2);
    expect(budget.snapshot().requests).toBe(2);
    // The stalled attempt left and may be billed, but returned no usage: logged as such, never estimated.
    expect(r.usage).toMatchObject({ unmeteredRequests: 1, inputTokens: 800, outputTokens: 200 });
    // A refused connection is not retried.
    let refused = 0;
    const down: Transport = { name: 'down', send: () => (refused++, Promise.reject(new TransportError('network error: refused'))) };
    const err = await runAgent(spec, { base: 0 }, [], deps(down)).catch((e: unknown) => e);
    expect((err as AgentError).kind).toBe('transport');
    expect(refused).toBe(1);
  });

  it('stops when the run is cancelled: the request in flight is aborted, never retried, and nothing more is sent', async () => {
    const seen: AbortSignal[] = [];
    const hang: Transport = {
      name: 'hang',
      send: (_req, signal) => (seen.push(signal), new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))))),
    };
    const stop = new AbortController();
    setTimeout(() => stop.abort(new Error('the browser closed the request')), 20);
    const err = await runAgent(spec, { base: 0 }, [], deps(hang, { timeoutMs: 5000, signal: stop.signal })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).kind).toBe('cancelled');
    expect((err as AgentError).message).toBe('cancelled: the browser closed the request');
    expect((err as AgentError).usage).toMatchObject({ requests: 1, unmeteredRequests: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0].aborted).toBe(true);
    // Already cancelled: not even the first request goes out.
    const t = fakeTransport({ archivist: [() => answer({ answer: 1 })] });
    const err2 = await runAgent(spec, { base: 0 }, [], deps(t, { signal: stop.signal })).catch((e: unknown) => e);
    expect((err2 as AgentError).kind).toBe('cancelled');
    expect(t.requests).toHaveLength(0);
  });

  it('never sends a secret: tool results carrying one are withheld, and a request carrying one is not sent', async () => {
    const t = fakeTransport({ archivist: [() => callTools([{ name: 'leaky' }]), () => answer({ answer: 1 })] });
    await runAgent(spec, { base: 0, leak: `the canary is ${CANARY}` }, [], deps(t));
    expect(JSON.stringify(t.requests)).not.toContain(CANARY);
    expect(outputsOf(t.requests[1])).toEqual([{ ok: false, error: 'internal: result withheld' }]);

    const t2 = fakeTransport({ archivist: [() => answer({ answer: 1 })] });
    const err = await runAgent(spec, { base: 0 }, [{ role: 'user', content: CANARY }], deps(t2)).catch((e: unknown) => e);
    expect((err as AgentError).kind).toBe('invalid');
    expect(t2.requests).toHaveLength(0);
  });
});

describe('parseReply', () => {
  it('collects calls, carries encrypted reasoning forward and drops id-only reasoning', () => {
    const p = parseReply({
      output: [
        { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc', summary: [] },
        { type: 'reasoning', id: 'rs_2', summary: [] },
        { type: 'function_call', id: 'fc_1', call_id: 'c1', name: 'add', arguments: '{"a":1}' },
        { type: 'message', content: [{ type: 'output_text', text: '{"answer":1}' }] },
      ],
    });
    expect(p.calls).toEqual([{ callId: 'c1', name: 'add', args: '{"a":1}' }]);
    expect(p.reasoning).toEqual([{ type: 'reasoning', id: 'rs_1', encrypted_content: 'enc', summary: [] }]);
    expect(p.text).toBe('{"answer":1}');
  });
});

describe('portkeyTransport', () => {
  const KEY = 'pk-test-0123456789abcdef';
  const req = { model: 'gpt-6-luna', instructions: 'x', input: [] } as unknown as ResponsesRequest;

  it('posts to {base}/responses with the course headers; the key only in Authorization', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ output: [], usage: usage(1, 1) }), { status: 200, headers: { 'x-portkey-cache-status': 'REFRESH' } }),
    );
    const t = portkeyTransport({ apiKey: KEY, baseUrl: 'https://api.portkey.ai/v1' }, fetchMock as unknown as typeof fetch);
    const reply = await t.send(req, new AbortController().signal);
    expect(reply.meta?.cacheStatus).toBe('REFRESH');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.portkey.ai/v1/responses');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      'x-portkey-provider': 'openai',
      'x-portkey-cache-force-refresh': 'true',
      'Content-Type': 'application/json',
    });
    expect(String(init.body)).not.toContain(KEY);
  });

  it('turns HTTP errors into TransportError without echoing the key', async () => {
    const fetchMock = vi.fn(async () => new Response(`bad key ${KEY}`, { status: 401 }));
    const t = portkeyTransport({ apiKey: KEY, baseUrl: 'https://api.portkey.ai/v1' }, fetchMock as unknown as typeof fetch);
    const err = await t.send(req, new AbortController().signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).status).toBe(401);
    expect((err as Error).message).not.toContain(KEY);
  });

  it('serves gpt-6-luna only: any other model is refused before anything is sent (the course rule)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output: [] }), { status: 200 }));
    const t = portkeyTransport({ apiKey: KEY, baseUrl: 'https://api.portkey.ai/v1' }, fetchMock as unknown as typeof fetch);
    expect(t.provider).toBe('course');
    for (const model of ['gpt-6-sol', 'gpt-6-luna-mini', 'GPT-6-LUNA', 'constructor', '']) {
      const err = await t.send({ ...req, model }, new AbortController().signal).catch((e: unknown) => e);
      expect(err, model).toBeInstanceOf(TransportError);
      expect((err as Error).message).toMatch(/the course key serves gpt-6-luna only/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('openaiTransport (your own key)', () => {
  const OWN = 'sk-own-test-0123456789abcdef';
  const sol = { model: 'gpt-6-sol', instructions: 'x', input: [] } as unknown as ResponsesRequest;

  it('posts to api.openai.com/v1/responses with only Authorization and Content-Type: no Portkey header', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output: [], usage: usage(1, 1) }), { status: 200 }));
    const t = openaiTransport({ apiKey: OWN, baseUrl: 'https://api.openai.com/v1' }, fetchMock as unknown as typeof fetch);
    expect(t.provider).toBe('own-key');
    const reply = await t.send(sol, new AbortController().signal);
    expect(reply.usage).toEqual(usage(1, 1));
    expect(reply.meta).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${OWN}` });
    expect(Object.keys(init.headers as Record<string, string>).some((h) => /portkey/i.test(h))).toBe(false);
    expect(String(init.body)).not.toContain(OWN);
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-6-sol' });
  });

  it('serves only its own models: gpt-6-luna (the course model) and anything else is refused before sending', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const t = openaiTransport({ apiKey: OWN, baseUrl: 'https://api.openai.com/v1' }, fetchMock as unknown as typeof fetch);
    for (const model of ['gpt-6-luna', 'gpt-4o', '__proto__', 'toString']) {
      const err = await t.send({ ...sol, model }, new AbortController().signal).catch((e: unknown) => e);
      expect(err, model).toBeInstanceOf(TransportError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns HTTP errors into TransportError without echoing the key', async () => {
    const fetchMock = vi.fn(async () => new Response(`Incorrect API key provided: ${OWN}`, { status: 401 }));
    const t = openaiTransport({ apiKey: OWN, baseUrl: 'https://api.openai.com/v1' }, fetchMock as unknown as typeof fetch);
    const err = await t.send(sol, new AbortController().signal).catch((e: unknown) => e);
    expect((err as TransportError).status).toBe(401);
    expect((err as Error).message).not.toContain(OWN);
  });
});
