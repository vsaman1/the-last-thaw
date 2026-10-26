import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { UsageRecord } from '../story/types';
import { estimateCosts, fileLogger, summarizeUsage, tokensOnDay, usdOnDay } from './log';
import { costUsd } from './pricing';

const dir = mkdtempSync(path.join(tmpdir(), 'lt-log-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const rec = (runId: string, agent: UsageRecord['agent'], inputTokens: number, outputTokens: number, model = 'gpt-6-luna'): UsageRecord => ({
  ts: '2026-10-21T10:00:00.000Z',
  runId,
  agent,
  model,
  inputTokens,
  cachedInputTokens: 0,
  outputTokens,
  requests: 2,
  toolCalls: 3,
  durationMs: 1000,
  costUsd: costUsd(model, { inputTokens, cachedInputTokens: 0, outputTokens }),
  ok: true,
});

describe('pricing', () => {
  it('prices gpt-6-luna from the table and refuses to guess for other models', () => {
    expect(costUsd('gpt-6-luna', { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 })).toBeCloseTo(0.1, 10);
    expect(costUsd('gpt-6-luna', { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.51, 10);
    // Cache writes (reported as input_tokens_details.cache_write_tokens) at the cache-write rate.
    expect(costUsd('gpt-6-luna', { inputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.125, 10);
    expect(costUsd('some-other-model', { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 })).toBeNull();
  });

  it('prices gpt-6-sol from the OpenAI pricing page: 20 times gpt-6-luna on every component', () => {
    const one = 1_000_000;
    expect(costUsd('gpt-6-sol', { inputTokens: one, cachedInputTokens: 0, outputTokens: 0 })).toBeCloseTo(2.0, 10);
    expect(costUsd('gpt-6-sol', { inputTokens: one, cachedInputTokens: one, outputTokens: 0 })).toBeCloseTo(0.2, 10);
    expect(costUsd('gpt-6-sol', { inputTokens: one, cachedInputTokens: 0, cacheWriteTokens: one, outputTokens: 0 })).toBeCloseTo(2.5, 10);
    expect(costUsd('gpt-6-sol', { inputTokens: 0, cachedInputTokens: 0, outputTokens: one })).toBeCloseTo(10.0, 10);
    // Browser playthrough 2's measured tokens (docs/evidence/TOKENOMICS.md): $0.031404 on luna, $0.628082 at sol prices.
    const pt2 = { inputTokens: 281_864, cachedInputTokens: 190_373, cacheWriteTokens: 91_251, outputTokens: 36_140 };
    expect(costUsd('gpt-6-luna', pt2)).toBeCloseTo(0.031404, 6);
    expect(costUsd('gpt-6-sol', pt2)).toBeCloseTo(0.6280821, 7);
    expect(costUsd('gpt-6-sol', pt2)! / costUsd('gpt-6-luna', pt2)!).toBeCloseTo(20, 4); // both rounded to 1e-8 USD
    // Prototype names have no price.
    for (const name of ['constructor', '__proto__', 'toString']) expect(costUsd(name, pt2), name).toBeNull();
  });
});

describe('usage log', () => {
  it('appends JSONL records and writes traces; skips torn lines when reading', () => {
    const log = fileLogger(dir);
    log.appendUsage([rec('lt-a', 'archivist', 1000, 200), rec('lt-a', 'historian', 600, 100)]);
    appendFileSync(path.join(dir, 'agent-usage.jsonl'), '{"torn":');
    expect(log.readUsage()).toHaveLength(2);
    log.writeTrace('lt-a', { steps: [] });
    expect(JSON.parse(readFileSync(path.join(dir, 'traces', 'lt-a.json'), 'utf8'))).toEqual({ steps: [] });
    expect(() => log.writeTrace('../escape', {})).toThrow(/unsafe/);
    expect(tokensOnDay(log.readUsage(), '2026-10-21')).toBe(1900);
  });

  it('summarises totals per agent and per run, and estimates cost from measured averages', () => {
    const records = [rec('lt-a', 'archivist', 1000, 200), rec('lt-a', 'historian', 600, 100), rec('lt-b', 'archivist', 2000, 400)];
    const s = summarizeUsage(records);
    expect(s.totals).toMatchObject({ invocations: 3, inputTokens: 3600, outputTokens: 700, requests: 6, toolCalls: 9, unpricedRecords: 0 });
    expect(s.byAgent.archivist.inputTokens).toBe(3000);
    expect(s.runs).toHaveLength(2);
    // Run a: 1600 in + 300 out = 0.00016 + 0.00015 = 0.00031; run b: 0.0002 + 0.0002 = 0.0004. Mean 0.000355.
    expect(s.estimate.measured.avgCostPerNarrativeUsd).toBeCloseTo(0.000355, 9);
    expect(s.estimate.perUserPerMonthUsd).toBeCloseTo(0.000355 * 5, 9);
    expect(s.estimate.at10000UsersPerMonthUsd).toBeCloseTo(0.000355 * 5 * 10_000, 2);
    expect(s.estimate.assumptions.join(' ')).toMatch(/measured from 2 logged narrative run/);
  });

  it('sums cache writes and requests without usage, and says when the figures are a lower bound', () => {
    const stalled: UsageRecord = { ...rec('lt-c', 'historian', 500, 50), cacheWriteTokens: 300, unmeteredRequests: 1 };
    const fresh: UsageRecord = { ...rec('lt-c', 'archivist', 900, 90), cacheWriteTokens: 600, unmeteredRequests: 0 };
    const s = summarizeUsage([fresh, stalled]);
    expect(s.totals).toMatchObject({ cacheWriteTokens: 900, unmeteredRequests: 1 });
    expect(s.estimate.assumptions.join(' ')).toMatch(/1 request\(s\) were sent but returned no usage .* lower bound/);
    // Records from before the count say nothing either way: also a lower bound, and said so.
    expect(estimateCosts([rec('lt-d', 'archivist', 10, 10)]).assumptions.join(' ')).toMatch(/predate the count .* lower bound/);
    expect(estimateCosts([fresh]).assumptions.join(' ')).toMatch(/Every request counted here returned its usage/);
    // The source the estimate names is the one it was fed.
    expect(estimateCosts([fresh], undefined, 'docs/evidence/runs/*.json').assumptions[0]).toMatch(/in docs\/evidence\/runs\/\*\.json/);
  });

  it('reports no cost estimate when nothing measured has a price', () => {
    const e = estimateCosts([rec('lt-x', 'archivist', 10, 10, 'unpriced-model')]);
    expect(e.perUserPerMonthUsd).toBeNull();
    expect(estimateCosts([]).basedOnRuns).toBe(0);
  });

  it('splits usage and cost by model and provider; older records without a provider count as the course key', () => {
    const luna = { ...rec('lt-l', 'archivist', 1000, 200), provider: 'course' as const };
    const legacy = rec('lt-old', 'historian', 500, 100); // no provider field
    const sol = { ...rec('lt-s', 'archivist', 1000, 200, 'gpt-6-sol'), provider: 'own-key' as const };
    const s = summarizeUsage([luna, legacy, sol]);
    expect(s.byModel.map((m) => [m.model, m.provider, m.totals.invocations])).toEqual([
      ['gpt-6-luna', 'course', 2],
      ['gpt-6-sol', 'own-key', 1],
    ]);
    // Each model's estimate is its own; the pooled one says it pools.
    expect(s.byModel[1].estimate.model).toBe('gpt-6-sol');
    expect(s.byModel[1].estimate.measured.avgCostPerNarrativeUsd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6, 9);
    expect(s.estimate.model).toBeNull();
    expect(s.estimate.assumptions.join(' ')).toMatch(/Runs on 2 models \(gpt-6-luna, gpt-6-sol\) are pooled here/);
    expect(summarizeUsage([luna]).estimate.assumptions.join(' ')).not.toMatch(/pooled here/);
  });

  it('sums one provider\'s USD on a UTC day, to seed the daily limit after a restart', () => {
    const sol = { ...rec('lt-s', 'archivist', 1000, 200, 'gpt-6-sol'), provider: 'own-key' as const };
    const solLegacy = rec('lt-s2', 'historian', 1000, 0, 'gpt-6-sol'); // provider inferred from the model
    const yesterday = { ...sol, ts: '2026-10-20T23:59:59.000Z' };
    const luna = { ...rec('lt-l', 'archivist', 1000, 200), provider: 'course' as const };
    const unpriced = { ...sol, costUsd: null };
    const records = [sol, solLegacy, yesterday, luna, unpriced];
    expect(usdOnDay(records, '2026-10-21', 'own-key')).toBeCloseTo(0.004 + 0.002, 10);
    expect(usdOnDay(records, '2026-10-21', 'course')).toBeCloseTo(0.0002, 10);
    expect(usdOnDay(records, '2026-10-22', 'own-key')).toBe(0);
  });
});
