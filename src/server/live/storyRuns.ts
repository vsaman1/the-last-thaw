import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { compactEvidence, compactHistory } from '../../story/client';
import { CHAPTERS } from '../../story/chapters';
import type { HistoryItem, RunEvidence } from '../../story/types';
import { archiveEntry, toHistoryItem } from './gameplay';
import { PROJECT_ROOT } from './liveSetup';

/**
 * The player whose story the live runs tell: REAL headless runs of the nine chapters
 * (docs/evidence/gameplay, written by gameplay.live.test.ts) archived the way the game archives them,
 * with the approved AI reflections of the live runs already made (the default 'selected' AI chapters
 * 1, 4 and 6) and the authored fallback everywhere else.
 */

export const EVIDENCE_DIR = path.join(PROJECT_ROOT, 'docs', 'evidence');
export const RUNS_DIR = path.join(EVIDENCE_DIR, 'runs');

/** The gameplay run used for each chapter of the main storyline (chapter 4: through Church Lane). */
export const MAIN_LINE: readonly string[] = [
  'ch1-autopilot',
  'ch2-autopilot',
  'ch3-autopilot',
  'ch4-through-church-lane',
  'ch5-autopilot',
  'ch6-autopilot',
  'ch7-autopilot',
  'ch8-autopilot',
  'ch9-autopilot',
];

/** Live run case whose approved text is the archived reflection for that chapter index (0-based). */
const AI_CASE: Readonly<Record<number, string>> = { 0: 'ch1', 3: 'ch4-through', 5: 'ch6' };

export function loadGameplay(name: string): { evidence: RunEvidence; plan: unknown; seconds: number } {
  const file = path.join(EVIDENCE_DIR, 'gameplay', `${name}.json`);
  if (!existsSync(file)) throw new Error(`no gameplay evidence ${name}: run LT_GAMEPLAY=1 npx vitest run src/server/live/gameplay.live.test.ts`);
  return JSON.parse(readFileSync(file, 'utf8')) as { evidence: RunEvidence; plan: unknown; seconds: number };
}

export interface SavedRun {
  readonly case: string;
  readonly runId: string;
  readonly result: { readonly ok: boolean; readonly title?: string; readonly text?: string; readonly fragmentIds?: readonly string[] };
}

/** The latest saved live run of a case (files are named <case>-<runId>.json; run ids sort by time). */
export function latestRun(caseName: string): SavedRun | undefined {
  if (!existsSync(RUNS_DIR)) return undefined;
  const files = readdirSync(RUNS_DIR)
    .filter((f) => f.startsWith(`${caseName}-lt-`) && f.endsWith('.json'))
    .sort();
  const last = files.at(-1);
  return last ? (JSON.parse(readFileSync(path.join(RUNS_DIR, last), 'utf8')) as SavedRun) : undefined;
}

/** History items for chapters [0, upTo) of the main line, as the game would send them. */
export function mainLineHistory(upTo: number): { history: HistoryItem[]; sources: { chapterId: string; gameplay: string; reflection: string }[] } {
  const history: HistoryItem[] = [];
  const sources: { chapterId: string; gameplay: string; reflection: string }[] = [];
  for (let i = 0; i < upTo; i++) {
    const chapter = CHAPTERS[i];
    const { evidence } = loadGameplay(MAIN_LINE[i]);
    const saved = AI_CASE[i] ? latestRun(AI_CASE[i]) : undefined;
    const ai =
      saved?.result.ok && saved.result.text
        ? { title: saved.result.title, text: saved.result.text, fragmentIds: saved.result.fragmentIds ?? [], runId: saved.runId }
        : undefined;
    const entry = archiveEntry(chapter, evidence, history, ai);
    history.push(toHistoryItem(entry));
    sources.push({ chapterId: chapter.id, gameplay: MAIN_LINE[i], reflection: ai ? `ai ${ai.runId}` : 'authored fallback' });
  }
  return { history: compactHistory(history), sources };
}

export { compactEvidence };
