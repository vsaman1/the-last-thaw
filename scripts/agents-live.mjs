#!/usr/bin/env node
/**
 * Runs the LIVE Story Mode scripts that src/server/README.md documents, setting the environment
 * variable each one waits for. Plain Node, no dependency (no cross-env), so the npm scripts work the
 * same from cmd, PowerShell and POSIX shells:
 *
 *   npm run agents:gameplay [-- <case,case>]   plays the chapters headless and writes RunEvidence to
 *                                              docs/evidence/gameplay/ (no model, no key)   LT_GAMEPLAY
 *   npm run agents:story -- <case,case | all>  the Archivist and Historian on that evidence with the
 *                                              archived history; real API usage, costs money LT_AGENTS
 *   npm run agents:report                      regenerates docs/evidence/AGENT_RUNS_DETAIL.md and
 *                                              docs/evidence/tokenomics.json from the run files LT_REPORT
 *
 * Story cases: ch1, ch4-through, ch4-round, ch6, ch9, epilogue. Live agent runs skip with a message
 * when no key is configured (.env, see src/server/README.md).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORY_CASES = ['ch1', 'ch4-through', 'ch4-round', 'ch6', 'ch9', 'epilogue'];

/** @type {Record<string, { file: string, env: string, value: (arg: string) => string }>} */
const RUNS = {
  gameplay: { file: 'src/server/live/gameplay.live.test.ts', env: 'LT_GAMEPLAY', value: (arg) => arg || '1' },
  story: {
    file: 'src/server/live/story.live.test.ts',
    env: 'LT_AGENTS',
    value: (arg) => (arg === 'all' ? STORY_CASES.join(',') : arg),
  },
  report: { file: 'src/server/live/report.live.test.ts', env: 'LT_REPORT', value: () => '1' },
};

const USAGE =
  'usage: node scripts/agents-live.mjs gameplay [case,case]\n' +
  `       node scripts/agents-live.mjs story <case,case | all>   (cases: ${STORY_CASES.join(', ')})\n` +
  '       node scripts/agents-live.mjs report';

const [kind = '', arg = ''] = process.argv.slice(2);
const run = RUNS[kind];
if (!run) {
  console.error(USAGE);
  process.exit(2);
}
const value = run.value(arg.trim());
if (kind === 'story') {
  const cases = value.split(',').filter(Boolean);
  const unknown = cases.filter((c) => !STORY_CASES.includes(c));
  if (cases.length === 0 || unknown.length > 0) {
    console.error(cases.length === 0 ? 'agents:story needs one or more cases (each run uses the API).' : `unknown case: ${unknown.join(', ')}`);
    console.error(USAGE);
    process.exit(2);
  }
}

const vitest = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const res = spawnSync(process.execPath, [vitest, 'run', run.file, '--no-fsModuleCache', '--silent=false'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, [run.env]: value },
});
if (res.error) console.error(res.error.message);
process.exit(res.status ?? 1);
