import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../../story/chapters';
import { playChapter, type SteerPlan } from './gameplay';
import { PROJECT_ROOT } from './liveSetup';

/**
 * REAL headless gameplay for the live agent runs (no model, no key): every chapter played by the game's
 * autopilot, and chapter 4 twice more, steered through No. 14 and the Pells' house or round them. The
 * RunEvidence goes to docs/evidence/gameplay/<case>.json. Run with LT_GAMEPLAY=1 (or a comma list of
 * case names); skipped in the normal suite.
 */
const ONLY = process.env.LT_GAMEPLAY;

const CASES: readonly { name: string; chapter: number; plan: SteerPlan }[] = [
  ...CHAPTERS.map((_c, i) => ({ name: `ch${i + 1}-autopilot`, chapter: i, plan: { kind: 'autopilot' } as const })),
  { name: 'ch4-through-church-lane', chapter: 3, plan: { kind: 'aim', landmarkIds: ['vey-house', 'pell-house'] } },
  { name: 'ch4-round-church-lane', chapter: 3, plan: { kind: 'avoid', landmarkIds: ['vey-house', 'pell-house'] } },
];

describe.skipIf(!ONLY)('REAL headless story runs (gameplay evidence)', () => {
  const wanted = ONLY === '1' ? CASES : CASES.filter((c) => ONLY?.split(',').includes(c.name));
  const dir = path.join(PROJECT_ROOT, 'docs', 'evidence', 'gameplay');
  for (const c of wanted) {
    it(c.name, async () => {
      const chapter = CHAPTERS[c.chapter];
      const run = await playChapter(chapter, c.plan);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${c.name}.json`), `${JSON.stringify({ case: c.name, plan: c.plan, seconds: run.seconds, evidence: run.evidence }, null, 1)}\n`);
      const e = run.evidence;
      console.log(
        `[gameplay] ${c.name}: ${e.outcome}${e.failReason ? ` (${e.failReason})` : ''}, ${e.time.toFixed(1)} s play, ${e.storyPoints} pts, ` +
          `destroyed ${JSON.stringify(e.destroyedByCategory)}, landmarks ${e.landmarks.map((l) => `${l.id}:${l.status}`).join(' ')} ` +
          `[${run.seconds.toFixed(1)} s wall]`,
      );
      expect(e.chapterId).toBe(chapter.id);
    }, 600_000);
  }
});
