import { describe, expect, it } from 'vitest';
import { getLevel } from '../core/levels';
import { CHAPTERS } from '../story/chapters';
import { executeToolCall, type AgentSpec } from './llm';
import { STORY } from './story';
import { CH1_HISTORY, ch4Evidence, chapterOf, FIXTURE_LEVEL, FIXTURE_STORY, GOOD_DRAFT } from './testing/fixtureStory';
import { ARCHIVIST_TOOLS, HISTORIAN_TOOLS, summarizeLevel, type ToolContext } from './tools';

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  mode: 'reflection',
  chapter: chapterOf('ch4-people'),
  evidence: ch4Evidence(),
  history: [CH1_HISTORY],
  story: FIXTURE_STORY,
  level: FIXTURE_LEVEL,
  draft: undefined,
  secrets: [],
  ...over,
});

const spec = (tools: AgentSpec<ToolContext>['tools']): AgentSpec<ToolContext> => ({
  agent: 'historian',
  instructions: '',
  tools,
  output: { name: 'x', schema: { type: 'boolean' } },
  maxOutputTokens: 1,
});

/** Runs a tool exactly as the agent loop does (allowlist, argument and result validation). */
function call(name: string, args: unknown = {}, c: ToolContext = ctx(), tools = HISTORIAN_TOOLS.concat(ARCHIVIST_TOOLS)) {
  const { output } = executeToolCall(spec([...new Set(tools)]), { name, args: JSON.stringify(args) }, c, []);
  return JSON.parse(output) as { ok: boolean; result?: Record<string, unknown>; error?: string };
}

describe('agent tools', () => {
  it('every tool result passes its own schema on realistic data', () => {
    const c = ctx({ draft: GOOD_DRAFT });
    for (const t of new Set([...ARCHIVIST_TOOLS, ...HISTORIAN_TOOLS])) {
      const r = call(t.name, t.name === 'get_bible_entries' ? { section: 'characters' } : {}, c);
      expect(r.ok, `${t.name}: ${r.error ?? ''}`).toBe(true);
    }
  });

  it('get_run_summary reports what the evidence says, and every landmark of the chapter', () => {
    const r = call('get_run_summary').result as { landmarks: { id: string; status: string }[]; destroyedTotal: number; growth: number };
    expect(r.landmarks).toEqual([
      { id: 'vey-house', name: 'The Vey house on Mill Lane', status: 'destroyed' },
      { id: 'mill-chapel', name: 'The chapel on Mill Lane', status: 'intact' },
    ]);
    expect(r.destroyedTotal).toBe(4);
    expect(r.growth).toBe(1.5);
  });

  it("get_run_summary gives the world the player sees: the chapter's look, and what their earlier toppling added", () => {
    // The second playtest: "the brown water, the gray skies". The same look the renderer draws
    // (src/story/environment.ts), in words (src/story/worldLook.ts), from the history the browser sends.
    type World = { act: number; water: string; sky: string; fromYourRecord: string; toppledIn: string[]; description: string };
    const world = (i: number, history: ToolContext['history']): World =>
      (call('get_run_summary', {}, ctx({ story: STORY, chapter: CHAPTERS[i], history })).result as { world: World }).world;
    const powerValley = { ...CH1_HISTORY, chapterId: 'ch6-price' as const, destroyedByKind: { coolingTower: 4, smokestack: 4, tank: 7, pylon: 9 } };
    expect(world(0, [])).toMatchObject({ act: 1, water: 'clear', sky: 'clear', fromYourRecord: 'none', toppledIn: [] });
    expect(world(4, [])).toMatchObject({ act: 2, water: 'greyer', sky: 'hazy', fromYourRecord: 'none' });
    expect(world(6, [])).toMatchObject({ act: 3, water: 'brown', sky: 'grey', fromYourRecord: 'none', toppledIn: [] });
    const worse = world(6, [powerValley]);
    expect(worse).toMatchObject({ act: 3, water: 'brown', sky: 'grey', fromYourRecord: 'clearly', toppledIn: ['Power Valley'] });
    expect(worse.description).toMatch(/^Here the rivers and streams run brown, a thick grey haze dulls the sky/);
    expect(worse.description).toMatch(/\(Power Valley\) made it clearly worse here\.$/);
    // The final check reads the same world: brown water is fine in chapter 7, not in chapter 1.
    const draft = { ...GOOD_DRAFT, text: `${GOOD_DRAFT.text} Below the farms the streams ran brown.` };
    const worldIssues = (c: ToolContext): string[] =>
      ((call('validate_narrative_events', {}, c).result as { issues: { code: string }[] }).issues ?? []).filter((x) => x.code === 'world').map((x) => x.code);
    expect(worldIssues(ctx({ draft, story: STORY, chapter: CHAPTERS[6], history: [] }))).toEqual([]);
    expect(worldIssues(ctx({ draft, story: STORY, chapter: CHAPTERS[0], history: [] }))).toEqual(['world']);
  });

  it('get_run_events filters and bounds', () => {
    const r = call('get_run_events', { type: 'broke', limit: 1 }).result as { total: number; events: unknown[] };
    expect(r.total).toBe(2);
    expect(r.events).toEqual([{ t: 40.1, type: 'broke', kind: 'house', category: 'home', landmarkId: 'vey-house', landmark: 'The Vey house on Mill Lane' }]);
    expect(call('get_run_events', { limit: 31 }).error).toMatch(/above 30/);
  });

  it('get_archive_fragments gives only records this run revealed, plus earlier ones the player saw', () => {
    const r = call('get_archive_fragments').result as { fragments: { id: string }[]; earlier: { id: string }[] };
    expect(r.fragments.map((f) => f.id)).toEqual(['ch4-vey-letter', 'ch4-chapel-notice']);
    expect(r.earlier.map((f) => f.id)).toEqual(['ch1-gauge-log', 'ch1-footbridge-notice']);
    const chapelGone = ch4Evidence({ landmarks: [{ id: 'mill-chapel', status: 'destroyed', closest: 0 }] });
    const r2 = call('get_archive_fragments', {}, ctx({ evidence: chapelGone })).result as { fragments: { id: string }[] };
    expect(r2.fragments.map((f) => f.id)).toEqual([]);
    const r3 = call('get_archive_fragments', { ids: ['ch1-gauge-log', 'ch9-pier-photo'] }).result as { fragments: { id: string }[]; missing: string[] };
    expect(r3.fragments.map((f) => f.id)).toEqual(['ch1-gauge-log']);
    expect(r3.missing).toEqual(['ch9-pier-photo']);
  });

  it('get_bible_entries never reveals a character, place or revelation before its chapter', () => {
    const chars = (call('get_bible_entries', { section: 'characters' }).result as { entries: { id: string; name: string; history: string }[] }).entries;
    // Ines Vey appears in chapter 4 but is revealed (named) in chapter 9: present, unnamed, no backstory.
    expect(chars.map((x) => x.id)).toEqual(['tomas-reed', 'unnamed-1']);
    expect(chars[1].name).toMatch(/not yet named/);
    expect(chars[1].history).toBe('Not yet revealed to the player.');
    expect(JSON.stringify(chars)).not.toMatch(/Ines/);
    const locs = (call('get_bible_entries', { section: 'locations' }).result as { entries: { id: string }[] }).entries;
    expect(locs.map((x) => x.id)).toEqual(['kell-valley', 'mill-lane']);
    expect((call('get_bible_entries', { section: 'revelations' }).result as { entries: unknown[] }).entries).toEqual([]);
    const ch1 = ctx({ chapter: chapterOf('ch1-beginning'), evidence: { ...ch4Evidence(), chapterId: 'ch1-beginning', landmarks: [] }, history: [] });
    const t1 = (call('get_bible_entries', { section: 'timeline' }, ch1).result as { entries: { id: string }[] }).entries;
    expect(t1.map((x) => x.id)).toEqual(['gauge-installed']);
  });

  it('get_bible_entries on the real story: the archivist has no name before chapter 8, in any section', () => {
    const sections = ['premise', 'characters', 'locations', 'timeline', 'decisions', 'relationships', 'revelations', 'invariants', 'style'];
    const realCtx = (i: number): ToolContext =>
      ctx({ chapter: CHAPTERS[i], evidence: { ...ch4Evidence(), chapterId: CHAPTERS[i].id, landmarks: [] }, history: [], story: STORY, level: undefined });
    const all = (i: number): string => sections.map((section) => JSON.stringify(call('get_bible_entries', { section }, realCtx(i)))).join('\n');
    for (const i of [0, 3, 5, 6]) {
      const text = all(i);
      expect(text, CHAPTERS[i].id).not.toMatch(/\bMara\b|mara-vey/);
      expect(text, CHAPTERS[i].id).toMatch(/archivist/i);
    }
    // Chapter 1 does not learn chapter 4's town or its house either; the rules survive the masking.
    const ch1 = all(0);
    expect(ch1).not.toMatch(/Riverside|Church Lane/);
    // Nor chapter 7's mesa, even where a decision writes it without "The" ("the Red Mesa ranger road").
    expect(ch1).not.toMatch(/Red Mesa/);
    expect(ch1).toMatch(/She is not named before chapter 8/);
    expect(all(7)).toMatch(/Mara Vey/);
    expect(all(8)).toMatch(/mara-vey/);
    // The Historian's continuity tool returns the invariants too, masked the same way.
    const cont = (i: number): string => JSON.stringify(call('check_narrative_continuity', {}, { ...realCtx(i), draft: GOOD_DRAFT }));
    expect(cont(0)).not.toMatch(/\bMara\b/);
    expect(cont(7)).toMatch(/Mara Vey/);
  });

  it('get_story_history fits a whole real story in one result (the first live epilogue could not)', () => {
    const history = CHAPTERS.slice(0, 8).map((c) => ({
      chapterId: c.id,
      outcome: 'complete' as const,
      storyPoints: 1234,
      destroyedByCategory: { home: 3, water: 1, energy: 2 },
      landmarks: c.landmarks.map((l) => ({ id: l.id, status: 'destroyed' as const, closest: 0.5 })),
      fragmentIds: c.fragments.slice(0, 4).map((f) => f.id),
      reflectionExcerpt: 'x'.repeat(239) + '…',
    }));
    const c9 = ctx({ chapter: CHAPTERS[8], evidence: { ...ch4Evidence(), chapterId: CHAPTERS[8].id, landmarks: [] }, history, story: STORY, level: undefined });
    const all = call('get_story_history', {}, c9);
    expect(all.ok, all.error).toBe(true);
    const chapters = (all.result as { chapters: { chapterId: string; landmarks: unknown[]; fragmentIds?: string[] }[]; note?: string }).chapters;
    expect(chapters.map((x) => x.chapterId)).toEqual(history.map((h) => h.chapterId));
    expect(chapters.every((x) => x.landmarks.length > 0)).toBe(true);
    expect((all.result as { note?: string }).note).toMatch(/Shortened/);
    // One chapter still comes whole.
    const one = call('get_story_history', { chapterId: 'ch4-people' }, c9).result as { chapters: { fragmentIds: string[]; reflectionExcerpt: { text: string } }[] };
    expect(one.chapters[0].fragmentIds).toEqual(history[3].fragmentIds);
    expect(one.chapters[0].reflectionExcerpt.text).toHaveLength(240);
  });

  it('get_approved_climate_fact gives an index, then approved wording without URLs', () => {
    const idx = call('get_approved_climate_fact').result as { index: { id: string }[] };
    expect(idx.index.map((f) => f.id)).toEqual(['fixture-fact-a', 'fixture-fact-b']);
    const one = call('get_approved_climate_fact', { id: 'fixture-fact-a' });
    expect(JSON.stringify(one)).not.toContain('example.org');
    expect(call('get_approved_climate_fact', { theme: 'DROP TABLE;' }).error).toMatch(/bad format/);
  });

  it('the Historian checks the draft under review, and can test corrected claims', () => {
    const c = ctx({ draft: { ...GOOD_DRAFT, claims: GOOD_DRAFT.claims.map((x) => (x.type === 'count' ? { ...x, value: 9 } : x)) } });
    expect((call('validate_narrative_events', {}, c).result as { passed: boolean }).passed).toBe(false);
    expect((call('validate_narrative_events', { claims: GOOD_DRAFT.claims }, c).result as { passed: boolean }).passed).toBe(true);
    expect(call('validate_narrative_events', {}, ctx()).error).toMatch(/no draft under review/);
  });

  it('summarises a real level and the overlay for get_level_context', () => {
    const s = summarizeLevel(getLevel('riverside-town'), chapterOf('ch4-people'));
    expect(s.name).toBe(getLevel('riverside-town').name);
    expect(s.structures.length).toBeGreaterThan(0);
    expect(s.structures.some((x) => ['pine', 'broadleaf', 'boulder'].includes(x.kind))).toBe(false);
  });
});
