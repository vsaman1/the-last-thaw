import { describe, expect, it } from 'vitest';
import { STORY } from '../server/story';
import { CHAPTERS } from './chapters';
import { worldCondition, worldConditionFromHistory, type TollRecord } from './environment';
import { EPILOGUE_PARTS } from './epilogueText';
import { evidenceFixture } from './fixtures';
import { toHistoryItem } from './select';
import { CHAPTER_IDS, type ArchiveEntry, type ChapterId, type HistoryItem } from './types';
import { validateNarrative, type ValidationContext } from './validate';
import { describeLook, lookOf, worldLookFor, type WorldLook } from './worldLook';

/** A history item (as the browser sends it) whose run toppled `kinds`. */
const item = (chapterId: ChapterId, destroyedByKind?: Record<string, number>): HistoryItem => ({
  chapterId,
  outcome: 'complete',
  storyPoints: 1000,
  destroyedByCategory: {},
  ...(destroyedByKind ? { destroyedByKind } : {}),
  landmarks: [],
  fragmentIds: [],
  reflectionExcerpt: '',
});

/** Power Valley toppled hard: every chimney, cooling tower and tank (environment.test.ts's HEAVY chapter 6). */
const HEAVY_CH6 = item('ch6-price', { pylon: 9, factoryHall: 7, smokestack: 4, coolingTower: 4, tank: 7, pumpjack: 3, oilRig: 1 });

const channels = (l: WorldLook) => ({ water: l.water, sky: l.sky, grass: l.grass, trees: l.trees, snow: l.snow });

describe('the world in words', () => {
  it('reads each chapter as the renderer draws it, with no record: clear, then greyer and hazy, then brown and grey', () => {
    const clear = { water: 'clear', sky: 'clear', grass: 'green', trees: 'healthy', snow: 'clean' };
    const worn = { water: 'brown', sky: 'grey', grass: 'brown', trees: 'some bare', snow: 'grey' };
    const expected: Record<ChapterId, Record<string, string>> = {
      'ch1-beginning': clear,
      // The Red Canyon, Power Valley and the Red Mesa show no snow anywhere (themes.ts levelHasSnow);
      // Riverside's far ranges do.
      'ch2-measurements': { ...clear, snow: 'none' },
      'ch3-warning': clear,
      'ch4-people': { water: 'greyer', sky: 'hazy', grass: 'yellowing', trees: 'healthy', snow: 'clean' },
      'ch5-denial': { water: 'greyer', sky: 'hazy', grass: 'yellowing', trees: 'yellowing', snow: 'clean' },
      'ch6-price': { water: 'greyer', sky: 'hazy', grass: 'yellowing', trees: 'yellowing', snow: 'none' },
      'ch7-escape': { ...worn, snow: 'none' },
      'ch8-remains': worn,
      'ch9-last-thaw': worn,
    };
    for (const id of CHAPTER_IDS) {
      const look = worldLookFor(id, []);
      expect(channels(look), id).toEqual(expected[id]);
      expect(look.fromYourRecord, id).toBe('none');
      expect(look.toppledIn, id).toEqual([]);
    }
  });

  it('adds the player\'s earlier toppling of extraction, industry and energy, and names where it happened', () => {
    const look = worldLookFor('ch7-escape', [item('ch4-people'), HEAVY_CH6]);
    expect(look.fromYourRecord).toBe('clearly');
    expect(look.toppledIn).toEqual(['ch6-price']);
    // In Act II the same record turns greyer water brown.
    const ch5 = worldLookFor('ch5-denial', [item('ch4-people', { tank: 2, smokestack: 1, factoryHall: 1, pipeline: 1, coolingTower: 2 })]);
    expect(ch5.fromYourRecord).not.toBe('none');
    expect(ch5.toppledIn).toEqual(['ch4-people']);
    // Homes and trees are not pollution; the chapter itself and later chapters never count.
    expect(worldLookFor('ch5-denial', [item('ch4-people', { house: 9, pine: 30 })]).fromYourRecord).toBe('none');
    expect(worldLookFor('ch6-price', [HEAVY_CH6]).fromYourRecord).toBe('none');
    expect(worldLookFor('ch5-denial', [HEAVY_CH6]).fromYourRecord).toBe('none');
    // A history from an older client (no counts by kind) adds nothing.
    expect(worldLookFor('ch7-escape', [item('ch6-price')])).toEqual(worldLookFor('ch7-escape', []));
  });

  it('is the world the browser renders: the agents\' history gives the same condition as the Archive', () => {
    const entry = (chapterId: ChapterId, kinds: Record<string, number>): ArchiveEntry => ({
      chapterId,
      completedAt: '2026-10-24T10:00:00.000Z',
      attempts: 1,
      evidence: evidenceFixture({ chapterId, destroyedByKind: kinds }),
      fragmentIds: [],
      reflection: { source: 'authored', text: 'An entry.', fragmentIds: [], factIds: [] },
    });
    const archive = [entry('ch4-people', { tank: 2, smokestack: 1 }), entry('ch6-price', { coolingTower: 4, tank: 7, pylon: 9 })];
    const history: TollRecord[] = archive.map(toHistoryItem);
    for (const id of CHAPTER_IDS) expect(worldConditionFromHistory(id, history), id).toEqual(worldCondition(id, archive));
  });

  it('describes the look in two plain sentences, with the places the record names', () => {
    const plain = describeLook(worldLookFor('ch2-measurements', []), STORY.bible);
    // The Red Canyon has no snow, so no snow clause.
    expect(plain).toMatch(/^Here the rivers and streams run clear, the sky is clear, the grass is green and the trees are healthy\./);
    expect(plain).not.toMatch(/snow/);
    expect(describeLook(worldLookFor('ch3-warning', []), STORY.bible)).toMatch(/the trees are healthy and the snow is clean\./);
    expect(plain).toMatch(/Nothing the player toppled in earlier chapters adds to this look\.$/);
    const worn = describeLook(worldLookFor('ch7-escape', [HEAVY_CH6]), STORY.bible);
    expect(worn).toMatch(/run brown/);
    expect(worn).toMatch(/grey haze/);
    expect(worn).toMatch(/\(Power Valley\) made it clearly worse here\.$/);
    expect(worn.length).toBeLessThanOrEqual(600);
    // Two places, the second written with "The" in the bible: lower case mid-sentence.
    const two = describeLook(worldLookFor('ch8-remains', [HEAVY_CH6, item('ch7-escape', { tank: 5, pumpjack: 1 })]), STORY.bible);
    expect(two).toMatch(/\(Power Valley and the Red Mesa\) made it clearly worse here\.$/);
  });

  it('never names a place for a woodpile: log piles are not pollution', () => {
    // Playtest 2 review: the Red Canyon line breaks a house and a log pile (category industry), and
    // chapters 6-9 told the agents that what the player toppled in the Red Canyon made the land worse.
    const canyon = item('ch2-measurements', { house: 1, logPile: 1 });
    for (const id of ['ch6-price', 'ch7-escape', 'ch9-last-thaw'] as const) {
      const look = worldLookFor(id, [canyon]);
      expect(look.toppledIn, id).toEqual([]);
      expect(look.fromYourRecord, id).toBe('none');
    }
    expect(worldLookFor('ch7-escape', [canyon, HEAVY_CH6]).toppledIn).toEqual(['ch6-price']);
  });

  it('measures the record against the chapter\'s own arc', () => {
    const c = worldCondition('ch8-remains');
    expect(lookOf(c).fromYourRecord).toBe('none');
    expect(lookOf({ ...c, severity: c.arc + 0.1 }, ['ch6-price']).fromYourRecord).toBe('clearly');
    expect(lookOf({ ...c, severity: c.arc + 0.01 }, ['ch6-price'])).toMatchObject({ fromYourRecord: 'a little', toppledIn: ['ch6-price'] });
  });
});

describe('the validator reads the land against the world', () => {
  const ctxFor = (chapterId: ChapterId, history: HistoryItem[] = []): ValidationContext => {
    const chapter = CHAPTERS.find((c) => c.id === chapterId)!;
    return {
      mode: 'reflection',
      chapter,
      evidence: evidenceFixture({ chapterId, levelId: chapter.levelId, landmarks: [] }),
      history,
      story: STORY,
    };
  };
  const worldIssues = (ctx: ValidationContext, text: string): string[] =>
    validateNarrative({ title: 'Notes', text, fragmentIds: [], factIds: [], claims: [] }, ctx, ['events'])
      .issues.filter((i) => i.code === 'world')
      .map((i) => i.message);

  it('rejects brown water, a grey sky or bare trees in a chapter that does not show them', () => {
    expect(worldIssues(ctxFor('ch1-beginning'), 'The river ran brown below the hut.')).toHaveLength(1);
    expect(worldIssues(ctxFor('ch1-beginning'), 'A grey haze hung over the valley.').length).toBeGreaterThan(0);
    expect(worldIssues(ctxFor('ch4-people'), 'By then the river was brown and oily.')[0]).toMatch(
      /^"river was brown" is not how this chapter looks: its rivers and streams are greyer/,
    );
    expect(worldIssues(ctxFor('ch5-denial'), 'The pines on the ridge stood bare.')).toHaveLength(1);
    expect(worldIssues(ctxFor('ch6-price'), 'Even the snow was grey with soot.').length).toBeGreaterThan(0);
  });

  it('says nothing of snow where the level has none, and rejects any snow wording there', () => {
    // Playtest 2 review: the agents were told "the snow is grey with soot" on the Red Mesa, which has no
    // snow, and an approved chapter 7 reflection said "the snow is grey".
    for (const id of ['ch2-measurements', 'ch7-escape'] as const) {
      const look = worldLookFor(id, [HEAVY_CH6]);
      expect(look.snow, id).toBe('none');
      expect(describeLook(look, STORY.bible), id).not.toMatch(/snow/i);
    }
    expect(worldIssues(ctxFor('ch7-escape'), 'The grass is brown, and the snow is grey.')[0]).toMatch(
      /^"snow is grey" is not how this chapter looks: it has no snow/,
    );
    expect(worldIssues(ctxFor('ch2-measurements'), 'Fresh snow lay on the canyon rim.').length).toBeGreaterThan(0);
    // Where there is snow, the same words pass at the look the chapter has.
    expect(worldIssues(ctxFor('ch9-last-thaw'), 'The grass is brown, and the snow is grey.')).toEqual([]);
    expect(worldIssues(ctxFor('ch4-people'), 'Snow still capped the far ranges.')).toEqual([]);
  });

  it('accepts the look each chapter has, and words that deny it', () => {
    expect(worldIssues(ctxFor('ch4-people'), 'The river was greyer than in the photographs, and a light haze lay over the town.')).toEqual([]);
    expect(worldIssues(ctxFor('ch7-escape'), 'The streams ran brown under a grey sky, and the grass was brown.')).toEqual([]);
    expect(worldIssues(ctxFor('ch9-last-thaw'), 'Above the village the snow was grey, and some trees stood bare.')).toEqual([]);
    expect(worldIssues(ctxFor('ch1-beginning'), 'The river was not brown then. It ran clear over the stones.')).toEqual([]);
    // A grey sea is weather; a grey river is not, before the middle of the story.
    expect(worldIssues(ctxFor('ch1-beginning'), 'Far below, the sea was grey under the clouds.')).toEqual([]);
    expect(worldIssues(ctxFor('ch1-beginning'), 'Far below, the river was grey.')).toHaveLength(1);
    expect(worldIssues(ctxFor('ch1-beginning'), 'The harbour water was oily.')).toHaveLength(1);
    // The player's own record makes Act II brown: a heavy chapter 4 turns chapter 5's water.
    const heavy = [item('ch4-people', { tank: 6, smokestack: 3, factoryHall: 4, pipeline: 2, coolingTower: 4 })];
    expect(worldLookFor('ch5-denial', heavy).water).toBe('brown');
    expect(worldIssues(ctxFor('ch5-denial', heavy), 'By the summer the river ran brown.')).toEqual([]);
  });

  it('lets the text blame the look on the player\'s earlier toppling only where their record added to it', () => {
    const blame = 'The haze is thicker here because of what you toppled in Power Valley.';
    expect(worldIssues(ctxFor('ch7-escape', [HEAVY_CH6]), blame)).toEqual([]);
    expect(worldIssues(ctxFor('ch7-escape', [item('ch6-price')]), blame)[0]).toMatch(/nothing the player toppled in earlier chapters added/);
    // A place where they toppled none of it.
    const elsewhere = 'The river runs brown here because of what you toppled in Riverside.';
    expect(worldIssues(ctxFor('ch7-escape', [item('ch4-people'), HEAVY_CH6]), elsewhere)[0]).toMatch(/toppled no extraction, industry or energy in Riverside/);
    // Without a world word, or without the player, it is not such a claim.
    expect(worldIssues(ctxFor('ch7-escape'), 'You toppled the plant in Power Valley, and I wrote it down.')).toEqual([]);
    expect(worldIssues(ctxFor('ch7-escape'), 'The haze came from the valleys, from decades of smoke.')).toEqual([]);
  });

  it('passes every authored document, reflection, intro and epilogue part at its own chapter\'s look', () => {
    // The agents paraphrase these records; none may describe the land other than the chapter shows it,
    // even with no record of the player's adding to it (the record only ever makes the land worse).
    const problems: string[] = [];
    for (const ch of CHAPTERS) {
      const ctx = ctxFor(ch.id);
      const texts: [string, string][] = [
        [`${ch.id} intro`, ch.intro.lines.join(' ')],
        [`${ch.id} caption`, ch.caption ?? ''],
        ...(ch.intro.document ? [[ch.intro.document.id, ch.intro.document.body] as [string, string]] : []),
        ...[...ch.fragments, ...ch.fallbackReflections].map((f): [string, string] => [f.id, `${f.title}\n${f.body}`]),
      ];
      for (const [id, text] of texts) for (const m of worldIssues(ctx, text)) problems.push(`${id}: ${m}`);
    }
    const ch9 = ctxFor('ch9-last-thaw');
    for (const p of EPILOGUE_PARTS) for (const m of worldIssues({ ...ch9, mode: 'epilogue' }, p.text)) problems.push(`${p.id}: ${m}`);
    expect(problems).toEqual([]);
  });
});
