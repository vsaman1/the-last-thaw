import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import type { UsageRecord } from '../../story/types';
import { estimateCosts } from '../log';
import { PRICES } from '../pricing';
import { RUNS_DIR, EVIDENCE_DIR } from './storyRuns';

/**
 * Writes docs/evidence/AGENT_RUNS_DETAIL.md from the saved live runs (docs/evidence/runs/*.json), and
 * docs/evidence/tokenomics.json from those and the saved browser traces: every number and every quoted
 * text comes from those files, nothing is typed by hand. Reads files only (no model). LT_REPORT=1 only.
 */

/** Code that made the runs saved before run files recorded it (from the commit times, see AGENT_RUNS.md). */
const EARLY_CODE: Readonly<Record<string, string>> = {
  'lt-20261021-091631-fb2773': '07ba0f7 (instructions v1)',
  'lt-20261021-091747-599c14': '07ba0f7 (instructions v1)',
  'lt-20261021-091832-76fcab': '07ba0f7 (instructions v1)',
  'lt-20261021-092108-91f79f': '07ba0f7 (instructions v1)',
  'lt-20261021-092217-3e3d7f': '07ba0f7 (instructions v1)',
  'lt-20261021-092254-6b7e8e': '07ba0f7 (instructions v1, output limits 1600/900)',
  'lt-20261021-092555-8873fb': 'a92dd27 (instructions v2)',
  'lt-20261021-092650-b77121': 'a92dd27 (instructions v2)',
  'lt-20261021-093343-5ae523': '86fe5ba (instructions v3)',
};

interface Step {
  agent: string;
  kind: string;
  at: number;
  summary: string;
  data?: {
    args?: unknown;
    status?: string | null;
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
  };
}
interface Usage {
  agent: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  requests: number;
  toolCalls: number;
  durationMs: number;
  costUsd: number | null;
  ok: boolean;
}
interface Run {
  case: string;
  label: string;
  runId: string;
  code?: string;
  instructions?: { archivist: string; historian: string };
  mode: string;
  chapterId: string;
  gameplay: { file: string; plan: unknown };
  history: { chapterId: string; gameplay: string; reflection: string }[];
  request: { evidence: Record<string, unknown> & { landmarks: { id: string; status: string; closest: number }[]; notable: unknown[] } };
  result: { ok: boolean; title?: string; text?: string; review?: { verdict: string; rounds: number }; validation?: { passed: boolean; checked: number }; reason?: string; message?: string };
  totals: Record<string, number>;
  trace: {
    steps: Step[];
    drafts: { title: string; text: string; fragmentIds: string[]; claims: unknown[] }[];
    reviews: { verdict: string; issues: string[]; validationIssues: string[] }[];
    usage: Usage[];
  };
}

const words = (t: string): number => t.split(/\s+/).filter(Boolean).length;
const quote = (t: string): string => t.split('\n').map((l) => `> ${l}`).join('\n');
const usd = (n: number | null | undefined): string => (n == null ? 'n/a' : `$${n.toFixed(6)}`);

/** Steps split into agent invocations (the agents alternate; each invocation is a run of one agent's steps). */
function invocations(steps: Step[]): { agent: string; steps: Step[] }[] {
  const out: { agent: string; steps: Step[] }[] = [];
  for (const s of steps) {
    if (s.kind === 'draft' || s.kind === 'review' || s.kind === 'validation' || s.kind === 'final') continue;
    const last = out.at(-1);
    // A new invocation starts at round 1 of a request.
    if (!last || last.agent !== s.agent || (s.kind === 'request' && /^round 1:/.test(s.summary))) out.push({ agent: s.agent, steps: [s] });
    else last.steps.push(s);
  }
  return out;
}

function section(r: Run): string {
  const e = r.request.evidence;
  const L: string[] = [];
  L.push(`## ${r.case}: \`${r.runId}\``, '');
  L.push(`*${r.label}* · ${r.mode} for \`${r.chapterId}\` · code ${r.code ?? EARLY_CODE[r.runId] ?? 'unknown'}` + (r.instructions ? ` · instructions archivist \`${r.instructions.archivist}\`, historian \`${r.instructions.historian}\`` : ''), '');
  L.push(
    `**Gameplay evidence** (\`${r.gameplay.file}\`, plan \`${JSON.stringify(r.gameplay.plan)}\`): ${e.outcome}, ${e.time} s, ${e.storyPoints} story points, ` +
      `destroyed ${JSON.stringify(e.destroyedByCategory)}, peak mass ${e.peakMass} t, ${e.waterfallsCrossed} waterfalls, ${e.notable.length} notable events. ` +
      `Landmarks: ${e.landmarks.map((l) => `${l.id} ${l.status} (${l.closest} m)`).join('; ')}. Request body ${JSON.stringify(r.request).length} bytes.`,
    '',
  );
  L.push(`**History sent**: ${r.history.length ? r.history.map((h) => `${h.chapterId} (${h.gameplay}; ${h.reflection})`).join(', ') : 'none (first chapter)'}.`, '');
  L.push('**Tool calls, per agent invocation**', '');
  invocations(r.trace.steps).forEach((inv, i) => {
    const calls = inv.steps.filter((s) => s.kind === 'tool').map((s) => `\`${s.summary.replace(/ ok$/, '')}${s.data?.args && JSON.stringify(s.data.args) !== '{}' ? ` ${JSON.stringify(s.data.args).slice(0, 80)}` : ''}\``);
    const reqs = inv.steps.filter((s) => s.kind === 'request').length;
    const errs = inv.steps.filter((s) => s.kind === 'error').map((s) => s.summary);
    L.push(`${i + 1}. ${inv.agent}, ${reqs} request(s): ${calls.join(', ') || 'no tools'}${errs.length ? `. Errors: ${errs.join('; ')}` : ''}`);
  });
  L.push('');
  r.trace.drafts.forEach((d, i) => {
    L.push(`**Archivist draft ${i + 1}** "${d.title}" (${words(d.text)} words; cites ${d.fragmentIds.join(', ') || 'no records'}; ${d.claims.length} claims)`, '', quote(d.text), '');
    const rev = r.trace.reviews[i];
    if (rev) {
      L.push(`**Historian review ${i + 1}: ${rev.verdict}**${rev.issues.length ? '' : ' (no issues)'}`);
      for (const iss of rev.issues) L.push(`- ${iss}`);
      L.push('', `Deterministic validation of draft ${i + 1}: ${rev.validationIssues.length ? rev.validationIssues.map((x) => `"${x}"`).join('; ') : 'passed'}.`, '');
    }
  });
  L.push(
    r.result.ok
      ? `**Result: ${r.result.review?.verdict} after ${r.result.review?.rounds} review(s); validation passed (${r.result.validation?.checked} checks).** The approved text is draft ${r.trace.drafts.length}.`
      : `**Result: fallback (${r.result.reason}): ${r.result.message}.** The player sees the authored reflection.`,
    '',
  );
  L.push('| Agent | Requests | Tool calls | Input | Cached input | Output (reasoning) | Time | Cost |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const u of r.trace.usage) {
    L.push(`| ${u.agent} | ${u.requests} | ${u.toolCalls} | ${u.inputTokens} | ${u.cachedInputTokens} | ${u.outputTokens} (${u.reasoningTokens ?? 0}) | ${(u.durationMs / 1000).toFixed(1)} s | ${usd(u.costUsd)} |`);
  }
  const t = r.totals;
  L.push(
    `| **total** | ${t.requests} | ${t.toolCalls} | ${t.inputTokens} | ${t.cachedInputTokens} (+${t.cacheWriteTokens} written) | ${t.outputTokens} (${t.reasoningTokens}) | ${(t.wallMs / 1000).toFixed(1)} s | ${usd(t.costUsd)} |`,
    '',
  );
  return L.join('\n');
}

/** A narrative trace as the service writes it (logs/traces/<runId>.json), copied from a browser session. */
interface BrowserTrace {
  runId: string;
  mode: string;
  chapterId: string;
  steps: Step[];
  toolCalls: unknown[];
  usage: Usage[];
  result: { ok: boolean };
}

/**
 * The real-browser sessions whose traces were kept, and the code they ran on (from the commit times):
 * playthrough 2 is the configuration that ships; playthrough 1 differs from it only in the epilogue (three
 * reviews, asked for on Continue); the chapter 1 run is from before the overlays and the v1 instructions.
 */
const BROWSER_SESSIONS = [
  { set: 'browserRun', dir: 'browser', code: 'not recorded (05:06 EDT, just before 07ba0f7; chapter 1 only)' },
  { set: 'playthrough1', dir: 'playthrough', code: '39aea91 (reflections as shipped; epilogue at most 3 reviews, asked for on Continue)' },
  { set: 'playthrough2', dir: 'playthrough2', code: 'e75c2f0 and later (the shipped configuration)' },
] as const;

/** A browser trace in the shape of a run file, with its totals computed from the trace itself. */
function traceAsRun(t: BrowserTrace, code: string): Run {
  const s = (f: (u: Usage) => number): number => t.usage.reduce((a, u) => a + f(u), 0);
  const written = t.steps.reduce((a, st) => a + (st.kind === 'request' ? (st.data?.usage?.input_tokens_details?.cache_write_tokens ?? 0) : 0), 0);
  return {
    case: t.chapterId,
    label: 'real browser session',
    runId: t.runId,
    code,
    mode: t.mode,
    chapterId: t.chapterId,
    result: t.result,
    totals: {
      agentInvocations: t.usage.length,
      requests: s((u) => u.requests),
      toolCalls: t.toolCalls.length,
      inputTokens: s((u) => u.inputTokens),
      cachedInputTokens: s((u) => u.cachedInputTokens),
      cacheWriteTokens: written,
      outputTokens: s((u) => u.outputTokens),
      reasoningTokens: s((u) => u.reasoningTokens ?? 0),
      costUsd: s((u) => u.costUsd ?? 0),
      agentMs: s((u) => u.durationMs),
      wallMs: t.steps.at(-1)?.at ?? 0,
    },
    trace: { steps: t.steps, drafts: [], reviews: [], usage: t.usage },
  } as unknown as Run;
}

function browserRuns(): { set: string; runs: Run[] }[] {
  return BROWSER_SESSIONS.map(({ set, dir, code }) => ({
    set,
    runs: readdirSync(path.join(EVIDENCE_DIR, dir))
      .filter((f) => /trace_lt-.*\.json$/.test(f))
      .map((f) => traceAsRun(JSON.parse(readFileSync(path.join(EVIDENCE_DIR, dir, f), 'utf8')) as BrowserTrace, code))
      .sort((a, b) => a.runId.localeCompare(b.runId)),
  }));
}

describe.skipIf(process.env.LT_REPORT !== '1')('report', () => {
  it('writes AGENT_RUNS_DETAIL.md', () => {
    const runs = readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(path.join(RUNS_DIR, f), 'utf8')) as Run)
      .sort((a, b) => a.runId.localeCompare(b.runId));
    const head = [
      '# Live agent runs: every run in full',
      '',
      'Generated by `src/server/live/report.live.test.ts` (LT_REPORT=1) from `docs/evidence/runs/*.json`; every number and',
      'quoted text below is copied from those files. Overview, the readable trace and the findings: `AGENT_RUNS.md`.',
      'Usage per agent invocation is from the API usage objects; "written" is `input_tokens_details.cache_write_tokens`.',
      '',
    ];
    writeFileSync(path.join(EVIDENCE_DIR, 'AGENT_RUNS_DETAIL.md'), `${[...head, ...runs.map(section)].join('\n')}\n`, 'utf8');
    writeFileSync(path.join(EVIDENCE_DIR, 'tokenomics.json'), `${JSON.stringify(tokenomics(runs, browserRuns()), null, 1)}\n`, 'utf8');
  });
});

/** Every figure TOKENOMICS.md quotes, computed from the run files and browser traces (prices: src/server/pricing.ts). */
function tokenomics(runs: Run[], browser: { set: string; runs: Run[] }[]) {
  const p = PRICES['gpt-6-luna'];
  const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
  const sum = (set: Run[], k: string): number => set.reduce((a, r) => a + (r.totals[k] ?? 0), 0);
  const stats = (set: Run[]) => {
    const n = set.length;
    const input = sum(set, 'inputTokens');
    const cached = sum(set, 'cachedInputTokens');
    const written = sum(set, 'cacheWriteTokens');
    const output = sum(set, 'outputTokens');
    const cost = sum(set, 'costUsd');
    const noCache = (input * p.input + output * p.output) / 1e6;
    return {
      runs: n,
      approved: set.filter((r) => r.result.ok).length,
      mean: {
        inputTokens: Math.round(input / n),
        cachedInputTokens: Math.round(cached / n),
        cacheWriteTokens: Math.round(written / n),
        outputTokens: Math.round(output / n),
        reasoningTokens: Math.round(sum(set, 'reasoningTokens') / n),
        requests: r6(sum(set, 'requests') / n),
        toolCalls: r6(sum(set, 'toolCalls') / n),
        costUsd: r6(cost / n),
        wallSeconds: Math.round(sum(set, 'wallMs') / n / 100) / 10,
      },
      total: { inputTokens: input, cachedInputTokens: cached, cacheWriteTokens: written, outputTokens: output, costUsd: r6(cost) },
      cachedShareOfInput: Math.round((cached / input) * 1000) / 1000,
      writtenShareOfInput: Math.round((written / input) * 1000) / 1000,
      outputShareOfCost: Math.round(((output * p.output) / 1e6 / cost) * 1000) / 1000,
      reasoningShareOfOutput: Math.round((sum(set, 'reasoningTokens') / output) * 1000) / 1000,
      costWithoutPromptCachingUsd: r6(noCache),
      savingFromCaching: Math.round((1 - cost / noCache) * 1000) / 1000,
    };
  };
  const month = (v: number) => ({ perUser: r6(v), users100: r6(v * 100), users10000: r6(v * 10_000) });
  const ids = (set: Run[]): string[] => set.map((r) => r.runId);

  // Headless runs on real gameplay, 288b250–e735262: before the Act I–III overlays changed what the
  // chapters hold, before the epilogue's fourth review and its request at chapter 9 (the headline until
  // 2026-10-22, kept for comparison).
  const headless = runs.filter((r) => r.code !== undefined);
  const headlessReflections = headless.filter((r) => r.mode === 'reflection');
  const v3Epilogues = runs.filter((r) => r.mode === 'epilogue' && (r.code !== undefined || EARLY_CODE[r.runId]?.startsWith('86fe5ba')));
  const hRefl = stats(headlessReflections);
  const hEpi = stats(v3Epilogues);

  // Real-browser sessions. Playthrough 2 is one complete playthrough on the shipped configuration; the
  // reflections of both playthroughs ran on the same reflection configuration (e75c2f0 changed only the
  // epilogue), so they are pooled; only playthrough 2's epilogue ran on the shipped epilogue configuration.
  const session = (name: string): Run[] => browser.find((b) => b.set === name)?.runs ?? [];
  const pt1 = session('playthrough1');
  const pt2 = session('playthrough2');
  const browserReflections = [...pt1, ...pt2].filter((r) => r.mode === 'reflection');
  const shippedEpilogues = pt2.filter((r) => r.mode === 'epilogue');
  const bRefl = stats(browserReflections);
  const bEpi = stats(shippedEpilogues);
  const measured = sum(pt2, 'costUsd');
  const pooled = 4 * bRefl.mean.costUsd + bEpi.mean.costUsd;
  const allChapters = 9 * bRefl.mean.costUsd + bEpi.mean.costUsd;
  // Every chapter 9 completion with AI on asks for (and bills) one epilogue, opened or not (storyRun.ts).
  const engaged = 12 * bRefl.mean.costUsd + 3 * bEpi.mean.costUsd;
  const headlessStory = 4 * hRefl.mean.costUsd + hEpi.mean.costUsd;

  const everyRun = [...runs, ...browser.flatMap((b) => b.runs)];
  const requestSteps = (set: Run[]) => set.flatMap((r) => r.trace.steps.map((s, i) => ({ r, s, ms: s.at - (i > 0 ? r.trace.steps[i - 1].at : 0) })).filter((x) => x.s.kind === 'request'));
  const cutOffs = requestSteps(everyRun).filter((x) => x.s.data?.status === 'incomplete');
  const since86fe5ba = new Set(ids([...v3Epilogues, ...headless, ...pt1, ...pt2]));
  const stalls = everyRun.flatMap((r) => r.trace.steps.filter((s) => s.kind === 'error' && /timed out/.test(s.summary)).map(() => r.runId));
  const latency = (set: Run[]) => {
    const ms = requestSteps(set).map((x) => x.ms).sort((a, b) => a - b);
    return { requests: ms.length, minSeconds: Math.round(ms[0] / 100) / 10, maxSeconds: Math.round(ms[ms.length - 1] / 100) / 10, over21s: ms.filter((m) => m > 21_000).length };
  };
  const firstRequests = runs.map((r) => r.trace.steps.find((s) => s.kind === 'request')?.data?.usage).filter((u) => u !== undefined);
  return {
    generatedFrom: 'docs/evidence/runs/*.json and the browser traces docs/evidence/{browser,playthrough,playthrough2}/*trace_*.json',
    prices: p,
    sets: {
      all: stats(runs),
      headless288b250toE735262: { ...stats(headless), code: '288b250–e735262, before the Act I–III overlays', runIds: ids(headless) },
      headless288b250toE735262Reflections: { ...hRefl, runIds: ids(headlessReflections) },
      v3Epilogues: { ...hEpi, runIds: ids(v3Epilogues) },
      browserPlaythrough1: { ...stats(pt1), code: BROWSER_SESSIONS[1].code, runIds: ids(pt1) },
      browserPlaythrough2: { ...stats(pt2), code: BROWSER_SESSIONS[2].code, runIds: ids(pt2) },
      browserReflections: { ...bRefl, runIds: ids(browserReflections) },
      shippedEpilogues: { ...bEpi, runIds: ids(shippedEpilogues) },
    },
    perPlayerStory: {
      definition: "one full playthrough, default 'selected' AI setting: reflections after chapters 1, 4, 6, 9 + the epilogue; every chapter completed once",
      measuredShipped: {
        costUsd: r6(measured),
        source: 'browser playthrough 2, the one complete playthrough on the shipped configuration: the sum of its 5 traces',
        perNarrativeUsd: pt2.map((r) => ({ runId: r.runId, mode: r.mode, chapterId: r.chapterId, ok: r.result.ok, costUsd: r6(r.totals.costUsd) })),
      },
      pooledShipped: {
        costUsd: r6(pooled),
        arithmetic: `4 × ${bRefl.mean.costUsd} (mean of the ${bRefl.runs} browser reflections) + ${bEpi.mean.costUsd} (the ${bEpi.runs} shipped epilogue)`,
      },
      headless288b250toE735262: { costUsd: r6(headlessStory), arithmetic: `4 × ${hRefl.mean.costUsd} + ${hEpi.mean.costUsd}` },
      allChaptersSettingCostUsd: r6(allChapters),
      engagedPlayerCostUsd: r6(engaged),
    },
    perMonth: {
      onePlaythrough: month(measured),
      onePlaythroughPooled: month(pooled),
      allChaptersSetting: month(allChapters),
      engaged: month(engaged),
      headless288b250toE735262: month(headlessStory),
    },
    // The service's own estimator fed the same records: a consistency check of the arithmetic, not an
    // independent measurement.
    serviceEstimator: estimateCosts(headless.flatMap((r) => r.trace.usage) as unknown as UsageRecord[], undefined, 'the usage records of the 8 headless run files on 288b250–e735262 (docs/evidence/runs/*.json)'),
    serviceEstimatorShipped: estimateCosts(pt2.flatMap((r) => r.trace.usage) as unknown as UsageRecord[], undefined, 'the usage records of the 5 traces of browser playthrough 2 (docs/evidence/playthrough2/)'),
    cutOffReplies: {
      count: cutOffs.length,
      outputTokens: cutOffs.reduce((a, x) => a + (x.s.data?.usage?.output_tokens ?? 0), 0),
      runIds: [...new Set(cutOffs.map((x) => x.r.runId))],
      // Output limits 3200 / 1800 since a92dd27; the runs from 86fe5ba on: the v3 epilogues, the headless
      // runs and both playthroughs.
      since86fe5ba: {
        runs: since86fe5ba.size,
        cutOffs: cutOffs.filter((x) => since86fe5ba.has(x.r.runId)).map((x) => ({ runId: x.r.runId, agent: x.s.agent, outputTokens: x.s.data?.usage?.output_tokens ?? 0 })),
      },
    },
    timedOutAttempts: { count: stalls.length, runIds: stalls, note: 'usage unknown (no reply); not in any token or cost figure here. One more is in docs/evidence/injection-lt-20261021-093604-fe037d.json.' },
    requestLatency: { headlessRuns: latency(runs), browserSessions: latency(browser.flatMap((b) => b.runs)) },
    firstRequest: {
      inputTokens: firstRequests.map((u) => u?.input_tokens ?? 0),
      cachedTokens: firstRequests.map((u) => u?.input_tokens_details?.cached_tokens ?? 0),
    },
  };
}
