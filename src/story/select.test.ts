import { describe, expect, it } from 'vitest';
import { BIBLE, INSTITUTIONS } from './bible';
import { CHAPTERS } from './chapters';
import { EPILOGUE_PARTS, type EpiloguePart } from './epilogueText';
import {
  composeEpilogue,
  documentAuthor,
  EPILOGUE_WORDS,
  evaluateCondition,
  EXCERPT_CHARS,
  failedRunDocument,
  fallbackReflection,
  findDocument,
  historyBefore,
  MAX_FRAGMENTS,
  selectFragments,
  THEME_LINE,
  toHistoryItem,
  UNSIGNED_AUTHOR,
  wordCount,
} from './select';
import { evidenceFixture } from './fixtures';
import type { ArchiveEntry, ArchiveFragment, ChapterDef, HistoryItem } from './types';

const frag = (id: string, when: ArchiveFragment['when'], priority = 0, extra: Partial<ArchiveFragment> = {}): ArchiveFragment => ({
  id,
  chapterId: 'ch1-beginning',
  kind: 'letter',
  title: id,
  body: `Body of ${id}.`,
  when,
  priority,
  ...extra,
});

const chapter = (fragments: ArchiveFragment[], fallbackReflections: ArchiveFragment[] = []): ChapterDef => ({
  ...CHAPTERS[0],
  fragments,
  fallbackReflections,
});

describe('evaluateCondition', () => {
  const ev = evidenceFixture();
  it('landmark statuses, single or any of several; an unknown landmark is false', () => {
    expect(evaluateCondition({ landmark: 'mill', status: 'destroyed' }, ev)).toBe(true);
    expect(evaluateCondition({ landmark: 'mill', status: 'intact' }, ev)).toBe(false);
    expect(evaluateCondition({ landmark: 'chapel', status: ['intact', 'damaged'] }, ev)).toBe(true);
    expect(evaluateCondition({ landmark: 'nowhere', status: 'notReached' }, ev)).toBe(false);
  });
  it('outcome, destruction counts by category, waterfalls, growth', () => {
    expect(evaluateCondition({ outcome: 'complete' }, ev)).toBe(true);
    expect(evaluateCondition({ outcome: 'failed' }, ev)).toBe(false);
    expect(evaluateCondition({ destroyedAtLeast: 3 }, ev)).toBe(true);
    expect(evaluateCondition({ destroyedAtLeast: 2, categories: ['home'] }, ev)).toBe(false);
    expect(evaluateCondition({ destroyedAtMost: 0, categories: ['energy', 'extraction'] }, ev)).toBe(true);
    expect(evaluateCondition({ destroyedAtMost: 1, categories: ['home'] }, ev)).toBe(true);
    expect(evaluateCondition({ waterfallsAtLeast: 1 }, ev)).toBe(true);
    expect(evaluateCondition({ waterfallsAtLeast: 2 }, ev)).toBe(false);
    expect(evaluateCondition({ grewAtLeast: 1.5 }, ev)).toBe(false);
    expect(evaluateCondition({ grewAtLeast: 1.5 }, evidenceFixture({ peakMass: 60 }))).toBe(true);
  });
  it('history: the latest earlier entry listing the landmark decides', () => {
    const h = (status: 'destroyed' | 'intact'): HistoryItem => ({
      chapterId: 'ch1-beginning',
      outcome: 'complete',
      storyPoints: 0,
      destroyedByCategory: {},
      landmarks: [{ id: 'old-bridge', status, closest: 1 }],
      fragmentIds: [],
      reflectionExcerpt: '',
    });
    const cond = { history: { landmark: 'old-bridge', status: 'destroyed' as const } };
    expect(evaluateCondition(cond, ev, [])).toBe(false);
    expect(evaluateCondition(cond, ev, [h('destroyed')])).toBe(true);
    expect(evaluateCondition(cond, ev, [h('destroyed'), h('intact')])).toBe(false);
  });
  it('all / any / not compose; malformed or unknown conditions are false', () => {
    const yes = { outcome: 'complete' } as const;
    const no = { outcome: 'failed' } as const;
    expect(evaluateCondition({ all: [yes, { landmark: 'mill', status: 'destroyed' }] }, ev)).toBe(true);
    expect(evaluateCondition({ all: [yes, no] }, ev)).toBe(false);
    expect(evaluateCondition({ any: [no, yes] }, ev)).toBe(true);
    expect(evaluateCondition({ not: no }, ev)).toBe(true);
    expect(evaluateCondition({ always: true }, ev)).toBe(true);
    expect(evaluateCondition({ bogus: 1 } as never, ev)).toBe(false);
    expect(evaluateCondition(null as never, ev)).toBe(false);
    expect(evaluateCondition({ destroyedAtLeast: 'x' } as never, ev)).toBe(false);
  });
});

describe('selectFragments', () => {
  it('matching fragments by priority then authored order, capped, never untrusted', () => {
    const c = chapter([
      frag('a', { always: true }, 1),
      frag('b', { landmark: 'mill', status: 'intact' }, 9),
      frag('c', { landmark: 'mill', status: 'destroyed' }, 5),
      frag('d', { always: true }, 1),
      frag('inject', { always: true }, 99, { untrusted: true }),
      frag('e', { always: true }, 0),
      frag('f', { always: true }, 0),
    ]);
    const ids = selectFragments(c, evidenceFixture()).map((f) => f.id);
    expect(ids).toEqual(['c', 'a', 'd', 'e']);
    expect(ids.length).toBe(MAX_FRAGMENTS);
  });
  it('different runs reveal different documents', () => {
    const c = chapter([
      frag('lost', { landmark: 'mill', status: 'destroyed' }),
      frag('kept', { landmark: 'mill', status: 'intact' }),
    ]);
    const spared = evidenceFixture({ landmarks: [{ id: 'mill', status: 'intact', closest: 20 }] });
    expect(selectFragments(c, evidenceFixture()).map((f) => f.id)).toEqual(['lost']);
    expect(selectFragments(c, spared).map((f) => f.id)).toEqual(['kept']);
  });
});

describe('fallbackReflection', () => {
  it('the best fitting authored reflection, labelled authored', () => {
    const c = chapter([], [
      frag('r-spared', { landmark: 'mill', status: 'intact' }, 5),
      frag('r-lost', { landmark: 'mill', status: 'destroyed' }, 3),
      frag('r-any', { always: true }, 0),
    ]);
    const r = fallbackReflection(c, evidenceFixture());
    expect(r).toMatchObject({ source: 'authored', title: 'r-lost', text: 'Body of r-lost.', fragmentIds: ['r-lost'] });
  });
  it('chapter 8 speaks of Clachan losses only when the run broke the Clachan, never for felled trees', () => {
    // The measured routes (overlays.act3.test.ts plays them): lane −8 breaks eight trees, a fence,
    // Calder's glen pipeline and one hall of the power station, and leaves every Clachan home standing;
    // the Clachan route breaks the station, Achadh, its barn and Balnacoil.
    const ch8 = CHAPTERS[7];
    const standing = ch8.landmarks.map((l) => ({ id: l.id, status: 'intact' as const, closest: 200 }));
    const lane = evidenceFixture({
      chapterId: ch8.id,
      levelId: ch8.levelId,
      destroyedByCategory: { nature: 8, farm: 1, extraction: 1, industry: 1 },
      destroyedByKind: { pine: 6, broadleaf: 2, fence: 1, pipeline: 1, factoryHall: 1 },
      landmarks: standing.map((l) => (['glen-pipeline', 'clachan-station'].includes(l.id) ? { ...l, status: 'destroyed' as const } : l)),
    });
    const clachan = evidenceFixture({
      chapterId: ch8.id,
      levelId: ch8.levelId,
      destroyedByCategory: { home: 2, farm: 1, industry: 1 },
      destroyedByKind: { house: 2, barn: 1, factoryHall: 1 },
      landmarks: standing.map((l) =>
        ['achadh', 'achadh-barn', 'balnacoil', 'clachan-station'].includes(l.id) ? { ...l, status: 'destroyed' as const } : l,
      ),
    });
    expect(fallbackReflection(ch8, lane).fragmentIds).toEqual(['ch8-reflection-dark']);
    expect(selectFragments(ch8, lane).map((f) => f.id)).not.toContain('ch8-two-columns');
    expect(fallbackReflection(ch8, clachan).fragmentIds).toEqual(['ch8-reflection-much-lost']);
    expect(selectFragments(ch8, clachan, [], 12).map((f) => f.id)).toContain('ch8-two-columns');
    // A run that never reached the station (it failed above the glen) hears only what the station was.
    const early = evidenceFixture({ chapterId: ch8.id, levelId: ch8.levelId, outcome: 'failed', landmarks: [] });
    expect(fallbackReflection(ch8, early).fragmentIds).toEqual(['ch8-reflection']);
    const shownEarly = selectFragments(ch8, early, [], 12).map((f) => f.id);
    expect(shownEarly).toContain('ch8-station-notice');
    expect(shownEarly).not.toContain('ch8-station-log');
    expect(shownEarly).not.toContain('ch8-school-letter');
  });
  it('none fits: the best one anyway; none at all: the theme line', () => {
    const c = chapter([], [frag('only', { outcome: 'failed' })]);
    expect(fallbackReflection(c, evidenceFixture()).fragmentIds).toEqual(['only']);
    expect(fallbackReflection(chapter([]), evidenceFixture()).text).toBe(THEME_LINE);
  });
});

/**
 * The real chapters, selected the way Story Mode plays them: every playthrough reaches chapter 8 with a
 * chapter 4 entry in its history (so one of the two No. 14 memories always holds) and the epilogue with
 * chapter 8's power station broken (every route breaks it). A selection tested with no history once let
 * the school letter and the epilogue's station look reachable when neither ever was (playtest review,
 * 2026-10-23).
 */
describe('the real story, with the history a playthrough has', () => {
  const item = (chapterId: HistoryItem['chapterId'], landmarks: Record<string, 'destroyed' | 'intact'>): HistoryItem => ({
    chapterId,
    outcome: 'complete',
    storyPoints: 0,
    destroyedByCategory: {},
    landmarks: Object.entries(landmarks).map(([id, status]) => ({ id, status, closest: status === 'destroyed' ? 0 : 20 })),
    fragmentIds: [],
    reflectionExcerpt: '',
  });
  const runOf = (ch: ChapterDef, changed: Record<string, 'destroyed' | 'notReached'>, destroyedByCategory = {}) =>
    evidenceFixture({
      chapterId: ch.id,
      levelId: ch.levelId,
      destroyedByCategory,
      landmarks: ch.landmarks.map((l) => ({ id: l.id, status: changed[l.id] ?? 'intact', closest: changed[l.id] ? 0 : 30 })),
    });
  const ids = (fs: readonly ArchiveFragment[]): string[] => fs.map((f) => f.id);

  it('chapter 3 centres on the siren the valley road could not hear, never on a bridge', () => {
    const ch3 = CHAPTERS[2];
    // The line breaks nothing and reaches everything (overlays.act1.test.ts).
    const line = runOf(ch3, {});
    expect(ids(selectFragments(ch3, line))).toEqual(['ch3-valley-letter', 'ch3-chapel-log', 'ch3-exercise-notice', 'ch3-sorel-letter']);
    expect(fallbackReflection(ch3, line).fragmentIds).toEqual(['ch3-reflection-valley-stands']);
    const lost = runOf(ch3, { 'valley-chalet': 'destroyed' }, { home: 1 });
    expect(ids(selectFragments(ch3, lost))[0]).toBe('ch3-valley-chalet-gone');
    expect(fallbackReflection(ch3, lost).fragmentIds).toEqual(['ch3-reflection-valley-gone']);
    // No document is about the Devil's Cut bridge: the iceberg rides over it and does not break it,
    // and the bridge road is not a way to the sea (ch3.ts header).
    const texts = [ch3.intro.lines.join(' '), ch3.intro.document?.body ?? '', ...[...ch3.fragments, ...ch3.fallbackReflections].map((f) => f.body)];
    for (const t of texts) expect(t).not.toMatch(/\bbridge\b/i);
    expect(ch3.landmarks.map((l) => l.id)).not.toContain('cut-bridge');
  });

  it("chapter 8 shows what the station meant, the morning it went and what happened next, on every route", () => {
    const ch8 = CHAPTERS[7];
    for (const status of ['destroyed', 'intact'] as const) {
      const history = [item('ch4-people', { 'vey-house': status })];
      const memory = status === 'destroyed' ? 'ch8-after-church-lane' : 'ch8-finish-the-month';
      // The line: the two middle halls, the shepherd's hut, a fence, the pipeline; Achadh stands.
      const line = runOf(ch8, { 'clachan-station': 'destroyed', bothy: 'destroyed', 'glen-pipeline': 'destroyed' }, { industry: 2, home: 1, farm: 1, extraction: 1 });
      expect(ids(selectFragments(ch8, line, history))).toEqual(['ch8-station-notice', 'ch8-station-log', 'ch8-school-letter', 'ch8-achadh-letter']);
      expect(fallbackReflection(ch8, line, history).fragmentIds).toEqual(['ch8-reflection-dark']);
      // A left lane that never reaches Achadh: the chapter 4 memory takes the fourth place.
      const lane = runOf(ch8, { 'clachan-station': 'destroyed', 'glen-pipeline': 'destroyed', achadh: 'notReached', 'achadh-barn': 'notReached' }, { industry: 1, farm: 1, extraction: 1 });
      expect(ids(selectFragments(ch8, lane, history))).toEqual(['ch8-station-notice', 'ch8-station-log', 'ch8-school-letter', memory]);
      // The Clachan route: Achadh, its barn and Balnacoil. The reflection ends on the council's minutes,
      // so the minutes are shown with it.
      const clachan = runOf(ch8, { 'clachan-station': 'destroyed', achadh: 'destroyed', 'achadh-barn': 'destroyed', balnacoil: 'destroyed' }, { industry: 1, home: 2, farm: 1 });
      expect(ids(selectFragments(ch8, clachan, history))).toEqual(['ch8-station-notice', 'ch8-station-log', 'ch8-larder-door', 'ch8-two-columns']);
      expect(fallbackReflection(ch8, clachan, history).fragmentIds).toEqual(['ch8-reflection-much-lost']);
      // However much else went, the minutes never lose their place to a document below them.
      const everything = runOf(
        ch8,
        Object.fromEntries(ch8.landmarks.filter((l) => l.id !== 'achadh').map((l) => [l.id, 'destroyed' as const])),
        { industry: 2, home: 4, farm: 2, community: 3, extraction: 1 },
      );
      expect(fallbackReflection(ch8, everything, history).fragmentIds).toEqual(['ch8-reflection-much-lost']);
      expect(ids(selectFragments(ch8, everything, history))).toContain('ch8-two-columns');
    }
  });

  it('the line shows the worn land in Act II too: chapters 4, 5, 6 and 8 each show a document about it', () => {
    // Playtest 2 review: playing the line through all nine chapters, no Act II document it showed spoke of
    // the haze, the yellowing grass or the greyer river, so the written story jumped from nothing to brown
    // water in chapter 7, and chapter 8's one document tying the brown water to people's waste was crowded
    // out. The runs below are what each chapter's line broke and reached that day (headless, real
    // physics): every other landmark stood.
    // Act II: the haze, greyer water, yellowing grass. Chapter 8: the stream and people's waste (its
    // keeper's log already calls the flood water brown; that is the flood, not the glen's waste).
    const ACT2 = /\b(?:haze|hazy|smoke|soot|greyer|grey|yellow|yellowing|litter|rubbish)\b/i;
    const WASTE = /\b(?:rubbish|litter|sewage|waste|threw away|throws away)\b/i;
    const lines: [number, Record<string, 'destroyed' | 'notReached'>, Record<string, number>][] = [
      [3, { 'vey-house': 'destroyed', 'pell-house': 'destroyed', 'riverside-dam': 'destroyed' }, { home: 6, water: 1 }],
      [
        4,
        { 'kessel-dam': 'destroyed', 'dairy-chalet': 'destroyed', 'kessel-barn': 'destroyed', 'gorge-chalet': 'destroyed', 'kessel-pipeline': 'destroyed' },
        { extraction: 1, home: 2, farm: 1, water: 1 },
      ],
      [5, { 'coop-turbine': 'destroyed', 'coal-train': 'destroyed', 'north-tower': 'destroyed', 'works-pipeline': 'destroyed' }, { energy: 3, extraction: 3, industry: 2 }],
      [7, { 'clachan-station': 'destroyed', bothy: 'destroyed', 'glen-pipeline': 'destroyed' }, { industry: 3, home: 3, farm: 1, extraction: 4 }],
    ];
    for (const [i, changed, byCategory] of lines) {
      const ch = CHAPTERS[i];
      for (const status of ['destroyed', 'intact'] as const) {
        const history = [item('ch4-people', { 'vey-house': status })];
        const shown = selectFragments(ch, runOf(ch, changed, byCategory), history);
        const worn = shown.filter((f) => (i === 7 ? WASTE : ACT2).test(f.body)).map((f) => f.id);
        expect(worn, `${ch.id}: ${shown.map((f) => f.id).join(', ')}`).not.toEqual([]);
      }
    }
  });

  it('every document written for a failed run is reachable: the fail panel shows it (it is never archived)', () => {
    const forFailure = CHAPTERS.flatMap((c) => c.fragments.filter((f) => 'outcome' in f.when && f.when.outcome === 'failed').map((f) => [c, f] as const));
    expect(forFailure.map(([, f]) => f.id)).toEqual([
      'ch1-turned-back',
      'ch2-gap-in-record',
      'ch3-annex-c',
      'ch5-keepers-log',
      'ch7-truck-at-leap',
      'ch9-short-of-sea',
    ]);
    for (const [c, f] of forFailure) {
      const failed = evidenceFixture({ chapterId: c.id, levelId: c.levelId, outcome: 'failed', landmarks: [] });
      expect(failedRunDocument(c, failed)?.id, c.id).toBe(f.id);
      expect(failedRunDocument(c, { ...failed, outcome: 'complete' }), c.id).toBeUndefined();
    }
    // A chapter with none shows none; documents that merely also hold on a failed run are not picked.
    const ch4 = CHAPTERS[3];
    expect(failedRunDocument(ch4, evidenceFixture({ chapterId: ch4.id, levelId: ch4.levelId, outcome: 'failed', landmarks: [] }))).toBeUndefined();
    // The authored epilogue follows a completed chapter 9 only, so no part is written for a failed one.
    for (const p of EPILOGUE_PARTS) expect(JSON.stringify(p.when), p.id).not.toContain('"failed"');
  });

  it('the authored epilogue names the Clachan power station beside No. 14', () => {
    for (const status of ['destroyed', 'intact'] as const) {
      const history = [item('ch4-people', { 'vey-house': status }), item('ch8-remains', { 'clachan-station': 'destroyed' })];
      const e = composeEpilogue(evidenceFixture({ chapterId: 'ch9-last-thaw', levelId: CHAPTERS[8].levelId, landmarks: [] }), history);
      expect(e.fragmentIds[1]).toBe(status === 'destroyed' ? 'ep-journey-home-gone-station' : 'ep-journey-home-stood-station');
      expect(e.text).toMatch(/No\. 14/);
      expect(e.text).toMatch(/Clachan's power station/);
      expect(wordCount(e.text)).toBeLessThanOrEqual(EPILOGUE_WORDS.max);
    }
  });
});

describe('composeEpilogue', () => {
  const words = (n: number, w = 'word'): string => Array.from({ length: n }, () => w).join(' ');
  const part = (id: string, slot: EpiloguePart['slot'], n: number, priority = 0, when: EpiloguePart['when'] = { always: true }): EpiloguePart => ({
    id,
    slot,
    when,
    priority,
    text: words(n, id),
  });
  it('one part per slot in slot order, within 150–250 words', () => {
    const parts = [
      part('close', 'closing', 40),
      part('open', 'opening', 40),
      part('journey-lost', 'journey', 45, 2, { landmark: 'mill', status: 'destroyed' }),
      part('journey-kept', 'journey', 45, 2, { landmark: 'mill', status: 'intact' }),
      part('people', 'people', 45),
    ];
    const e = composeEpilogue(evidenceFixture(), [], parts);
    expect(e.source).toBe('authored');
    expect(e.fragmentIds).toEqual(['open', 'journey-lost', 'people', 'close']);
    expect(wordCount(e.text)).toBeGreaterThanOrEqual(EPILOGUE_WORDS.min);
    expect(wordCount(e.text)).toBeLessThanOrEqual(EPILOGUE_WORDS.max);
    expect(e.text.split('\n\n')).toHaveLength(4);
  });
  it('tops up short texts and never passes the maximum', () => {
    const parts = [
      part('o1', 'opening', 30, 2),
      part('o2', 'opening', 30, 1),
      part('j1', 'journey', 30),
      part('p1', 'people', 30),
      part('p2', 'people', 30),
      part('c1', 'closing', 30),
      part('huge', 'closing', 300, -1),
    ];
    const e = composeEpilogue(evidenceFixture(), [], parts);
    const n = wordCount(e.text);
    expect(n).toBeGreaterThanOrEqual(EPILOGUE_WORDS.min);
    expect(n).toBeLessThanOrEqual(EPILOGUE_WORDS.max);
    expect(e.fragmentIds).not.toContain('huge');
    expect(e.fragmentIds[0]).toBe('o1');
  });
  it('no parts: the theme line', () => {
    expect(composeEpilogue(evidenceFixture(), [], []).text).toBe(THEME_LINE);
  });
});

describe('history', () => {
  const entry = (chapterId: ArchiveEntry['chapterId'], text = 'x'): ArchiveEntry => ({
    chapterId,
    completedAt: '2026-10-21T00:00:00.000Z',
    attempts: 1,
    evidence: evidenceFixture({ chapterId }),
    fragmentIds: ['f'],
    reflection: { source: 'authored', text, fragmentIds: [], factIds: [] },
  });
  it('items carry only the compact fields, excerpt capped', () => {
    const item = toHistoryItem(entry('ch1-beginning', 'word '.repeat(200)));
    // Counts by kind as well, since the second playtest: the agents' world condition weighs the earlier
    // toppling by kind, as the renderer does (src/story/worldLook.ts).
    expect(Object.keys(item).sort()).toEqual(
      ['chapterId', 'destroyedByCategory', 'destroyedByKind', 'fragmentIds', 'landmarks', 'outcome', 'reflectionExcerpt', 'storyPoints'].sort(),
    );
    expect(item.reflectionExcerpt.length).toBeLessThanOrEqual(EXCERPT_CHARS);
  });
  it('only earlier chapters, in chapter order', () => {
    const archive = [entry('ch3-warning'), entry('ch1-beginning'), entry('ch5-denial')];
    expect(historyBefore(archive, 'ch4-people').map((h) => h.chapterId)).toEqual(['ch1-beginning', 'ch3-warning']);
    expect(historyBefore(archive, 'ch1-beginning')).toEqual([]);
  });
  it('findDocument looks up authored documents by id and never returns untrusted ones', () => {
    const c = chapter([frag('doc-1', { always: true }), frag('bad', { always: true }, 0, { untrusted: true })], [frag('refl-1', { always: true })]);
    expect(findDocument('doc-1', [c])?.id).toBe('doc-1');
    expect(findDocument('refl-1', [c])?.id).toBe('refl-1');
    expect(findDocument('bad', [c])).toBeUndefined();
  });
});

describe('documentAuthor', () => {
  it('shows a character by display name, an institution as written, never a raw id', () => {
    expect(documentAuthor('tomas-lind', 'ch1-beginning')).toBe('Tomas Lind');
    expect(documentAuthor('Vell Valley Water Board', 'ch2-measurements')).toBe('Vell Valley Water Board');
    expect(documentAuthor(undefined)).toBeUndefined();
    expect(documentAuthor('someone-unknown', 'ch1-beginning')).toBeUndefined();
  });

  it('keeps a name unsigned until the chapter where the story reveals it (the archivist: chapter 8)', () => {
    expect(documentAuthor('mara-vey', 'ch7-escape')).toBe(UNSIGNED_AUTHOR);
    expect(documentAuthor('mara-vey', 'ch8-remains')).toBe('Mara Vey');
    expect(documentAuthor('mara-vey')).toBe('Mara Vey'); // no chapter given: nothing to gate against
  });

  it('every authored document in the story reads with a real name, never an id', () => {
    const names = new Set(BIBLE.characters.map((c) => c.name));
    for (const ch of CHAPTERS) {
      const docs = [...(ch.intro.document ? [ch.intro.document] : []), ...ch.fragments, ...ch.fallbackReflections].filter(
        (d) => !('untrusted' in d && d.untrusted),
      );
      for (const d of docs) {
        if (!d.author) continue;
        const shown = documentAuthor(d.author, ch.id);
        expect(shown, `${d.id}: ${d.author}`).toBeDefined();
        expect(shown, `${d.id}: ${d.author}`).not.toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
        if (BIBLE.characters.some((c) => c.id === d.author)) expect(names.has(shown!), `${d.id}`).toBe(true);
        else expect(INSTITUTIONS).toContain(shown);
      }
    }
  });
});
