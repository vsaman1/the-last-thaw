import { describe, expect, it } from 'vitest';
import { generateNarrative } from '../agents';
import { demoInput, isLive, liveEnv, narrativeDeps } from './liveSetup';

/**
 * LIVE (npm run agents:demo): one real Archivist → Historian run through Portkey on a saved evidence
 * fixture, writing logs/agent-usage.jsonl and logs/traces/<runId>.json. Skipped in the normal suite and
 * when no key is configured.
 */
describe.skipIf(!isLive('agents:demo'))('LIVE agents demo', () => {
  it('runs the two agents end to end and writes the trace', async () => {
    const env = liveEnv('agents:demo');
    if (!env) return;
    const input = demoInput();
    console.log(`[agents:demo] ${input.mode} for ${input.request.chapter.id} — ${input.label}`);
    const r = await generateNarrative(input.mode, input.request, narrativeDeps(env, input.story, input.fixture));
    const tokens = r.usage.reduce((a, u) => a + u.inputTokens + u.outputTokens, 0);
    const cost = r.usage.reduce((a, u) => a + (u.costUsd ?? 0), 0);
    console.log(`[agents:demo] run ${r.runId}: ${r.ok ? `OK (${r.review.verdict}, ${r.review.rounds} review(s))` : `FAILED (${r.reason}: ${r.message})`}`);
    console.log(`[agents:demo] ${r.usage.length} agent invocation(s), ${tokens} tokens, $${cost.toFixed(6)}`);
    if (r.ok) {
      console.log(`[agents:demo] tools: ${r.toolCalls.map((c) => `${c.agent}:${c.tool}${c.ok ? '' : '(refused)'}`).join(', ')}`);
      console.log(`\n${r.title ?? ''}\n\n${r.text}\n`);
    }
    console.log(`[agents:demo] trace: logs/traces/${r.runId}.json`);
    expect(env.logger.traces.has(r.runId)).toBe(true);
    // Whatever the model did, nothing unvalidated is ever returned as a result.
    if (r.ok) expect(r.validation.passed).toBe(true);
  }, 300_000);
});
