import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../../story/chapters';
import type { NarrativeMode } from '../../story/validate';
import { ARCHIVIST_INSTRUCTIONS, generateNarrative, HISTORIAN_INSTRUCTIONS } from '../agents';
import { checkEpilogueRequest, checkReflectRequest } from '../contracts';
import { STORY } from '../story';
import { liveEnv, narrativeDeps, PROJECT_ROOT } from './liveSetup';
import { compactEvidence, loadGameplay, mainLineHistory, RUNS_DIR } from './storyRuns';

/**
 * LIVE: the two agents on REAL gameplay against the REAL story (docs/evidence/AGENT_RUNS.md). Each case
 * sends exactly what the game would send (compacted evidence of a real headless run, the archived
 * history) through the same request checks as the HTTP route, and saves the full trace and measured
 * usage to docs/evidence/runs/<case>-<runId>.json. Run one case at a time:
 *   LT_AGENTS=ch1 npx vitest run src/server/live/story.live.test.ts --silent=false
 * Skipped in the normal suite and when no key is configured.
 */
const CASES: Readonly<Record<string, { mode: NarrativeMode; chapter: number; gameplay: string; label: string }>> = {
  ch1: { mode: 'reflection', chapter: 0, gameplay: 'ch1-autopilot', label: 'chapter 1, autopilot' },
  'ch4-through': { mode: 'reflection', chapter: 3, gameplay: 'ch4-through-church-lane', label: 'chapter 4, steered through No. 14 and the Pells\' house' },
  'ch4-round': { mode: 'reflection', chapter: 3, gameplay: 'ch4-round-church-lane', label: 'chapter 4, steered round No. 14 and the Pells\' house' },
  ch6: { mode: 'reflection', chapter: 5, gameplay: 'ch6-autopilot', label: 'chapter 6, autopilot' },
  // Chapter 7 asks the agents only when the player chose AI for every chapter; the second playtest's
  // Calder processing plant and the Act III world (brown water, a grey sky) are checked here.
  ch7: { mode: 'reflection', chapter: 6, gameplay: 'ch7-autopilot', label: 'chapter 7, autopilot, through the Calder processing plant' },
  ch9: { mode: 'reflection', chapter: 8, gameplay: 'ch9-autopilot', label: 'chapter 9, autopilot, history of chapters 1-8' },
  epilogue: { mode: 'epilogue', chapter: 8, gameplay: 'ch9-autopilot', label: 'epilogue after chapter 9, history of chapters 1-8' },
};

const wanted = (process.env.LT_AGENTS ?? '').split(',').filter((c) => c in CASES);

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);
function gitHead(): string {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    return dirty ? `${head}+uncommitted` : head;
  } catch {
    return 'unknown';
  }
}

describe.skipIf(wanted.length === 0)('LIVE agents on real gameplay', () => {
  for (const name of wanted) {
    it(name, async () => {
      const env = liveEnv('agents:story');
      if (!env) return;
      const c = CASES[name];
      const chapter = CHAPTERS[c.chapter];
      const played = loadGameplay(c.gameplay);
      const { history, sources } = mainLineHistory(c.chapter);
      const body =
        c.mode === 'epilogue'
          ? { evidence: compactEvidence(played.evidence), history }
          : { chapterId: chapter.id, evidence: compactEvidence(played.evidence), history };
      const checked = c.mode === 'epilogue' ? checkEpilogueRequest(body, STORY) : checkReflectRequest(body, STORY);
      if (!checked.ok) throw new Error(`request rejected: ${checked.errors.join('; ')}`);
      const t0 = Date.now();
      const r = await generateNarrative(c.mode, checked.value, narrativeDeps(env, STORY, false));
      const wallMs = Date.now() - t0;
      const trace = env.logger.traces.get(r.runId) as { steps: { kind: string; data?: { usage?: { input_tokens_details?: { cache_write_tokens?: number } }; gateway?: { cacheStatus?: string } } }[] };
      const requests = trace.steps.filter((s) => s.kind === 'request');
      const sum = (f: (u: (typeof r.usage)[number]) => number): number => r.usage.reduce((a, u) => a + f(u), 0);
      const totals = {
        agentInvocations: r.usage.length,
        requests: sum((u) => u.requests),
        toolCalls: sum((u) => u.toolCalls),
        inputTokens: sum((u) => u.inputTokens),
        cachedInputTokens: sum((u) => u.cachedInputTokens),
        cacheWriteTokens: requests.reduce((a, s) => a + (s.data?.usage?.input_tokens_details?.cache_write_tokens ?? 0), 0),
        outputTokens: sum((u) => u.outputTokens),
        reasoningTokens: sum((u) => u.reasoningTokens ?? 0),
        costUsd: Math.round(sum((u) => u.costUsd ?? 0) * 1e8) / 1e8,
        agentMs: sum((u) => u.durationMs),
        wallMs,
        gatewayCacheHits: requests.filter((s) => /^hit$/i.test(s.data?.gateway?.cacheStatus ?? '')).length,
      };
      const doc = {
        case: name,
        label: c.label,
        date: new Date().toISOString(),
        model: env.config.model,
        runId: r.runId,
        // Which code and which instructions made this run (runs with the same hashes share a cached prefix).
        code: gitHead(),
        instructions: {
          archivist: sha(ARCHIVIST_INSTRUCTIONS[c.mode]),
          historian: sha(HISTORIAN_INSTRUCTIONS),
          budgets: env.config.budgets,
        },
        mode: c.mode,
        chapterId: chapter.id,
        gameplay: { file: `docs/evidence/gameplay/${c.gameplay}.json`, plan: played.plan },
        history: sources,
        request: body,
        result: r.ok
          ? { ok: true, title: r.title, text: r.text, fragmentIds: r.fragmentIds, factIds: r.factIds, claims: r.claims, review: r.review, validation: r.validation }
          : { ok: false, reason: r.reason, message: r.message },
        totals,
        trace,
      };
      mkdirSync(RUNS_DIR, { recursive: true });
      const file = path.join(RUNS_DIR, `${name}-${r.runId}.json`);
      writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`, 'utf8');
      console.log(`[agents:story] ${name} (${c.label}) run ${r.runId}: ${r.ok ? `OK, ${r.review.verdict} after ${r.review.rounds} review(s)` : `FALLBACK (${r.reason}: ${r.message})`}`);
      console.log(`[agents:story] ${JSON.stringify(totals)}`);
      if (r.ok) console.log(`\n${r.title ?? ''}\n${r.text}\n`);
      console.log(`[agents:story] saved ${path.relative(PROJECT_ROOT, file)}`);
      if (r.ok) expect(r.validation.passed).toBe(true);
    }, 600_000);
  }
});
