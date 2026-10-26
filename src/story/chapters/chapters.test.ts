import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../core/levels';
import { BIBLE, INSTITUTIONS, MINOR_PEOPLE } from '../bible';
import { EPILOGUE_PARTS, EPILOGUE_SLOTS } from '../epilogueText';
import { GLOSSED, INITIAL } from '../plainWords';
import type {
  ArchiveDocument,
  ArchiveFragment,
  ChapterDef,
  ChapterId,
  FragmentCondition,
  LandmarkStatus,
  RunEvidence,
  StructureCategory,
} from '../types';
import { CHAPTER_IDS } from '../types';
import { landmarkPlacement, landmarkPlacements, storyLevel } from '../storyLevel';
import { CHAPTERS, OVERLAY_REQUESTS_BY_CHAPTER, chapterById, chapterForLevel } from './index';

/**
 * Consistency tests for the authored story: the chapters, the bible and the epilogue parts. They
 * guard the rules the writing must keep (no casualties, no claims beyond the evidence, Mara unnamed
 * until chapter 8, word limits) and the bindings the game relies on (landmark indices and kinds,
 * condition ids, aiReflection flags).
 */

/**
 * Kind → category, mirroring STRUCTURE_CATEGORY in src/story/scoring.ts (owned by the integration
 * work and not on every branch). A landmark's category must be its kind's category, so the Archive,
 * the scoring and the agents all describe a placement the same way.
 */
const CATEGORY_OF: Record<string, StructureCategory> = {
  house: 'home',
  chalet: 'home',
  apartmentBlock: 'home',
  church: 'community',
  monument: 'community',
  waterTower: 'community',
  lighthouse: 'community',
  car: 'transport',
  truck: 'transport',
  bus: 'transport',
  guardrail: 'transport',
  footbridge: 'transport',
  roadBridge: 'transport',
  railWagon: 'transport',
  boat: 'transport',
  trafficLight: 'transport',
  skiLiftPylon: 'transport',
  dam: 'water',
  coolingTower: 'energy',
  smokestack: 'energy',
  pylon: 'energy',
  windTurbine: 'energy',
  pumpjack: 'extraction',
  oilRig: 'extraction',
  pipeline: 'extraction',
  tank: 'extraction',
  factoryHall: 'industry',
  silo: 'industry',
  logPile: 'industry',
  barn: 'farm',
  fence: 'farm',
  rockSmall: 'nature',
  rockMedium: 'nature',
  boulder: 'nature',
  rockCluster: 'nature',
  stoneBarrier: 'nature',
  pine: 'nature',
  broadleaf: 'nature',
  iceBlock: 'nature',
  iceField: 'nature',
};

/** Words that would claim or imply casualties. The story never uses them, in any form. */
const CASUALTY =
  /\b(die|dies|died|dying|dead|death|deaths|kill|kills|killed|killing|body|bodies|corpses?|casualt(?:y|ies)|drown(?:s|ed|ing)?|perish(?:es|ed|ing)?|victims?|fatal(?:ity|ities)?|funerals?|graves?|mourn(?:s|ed|ing)?)\b/i;
/** Claims that someone was inside a building. */
const INSIDE_CLAIM = /\b(was|were) (still )?inside\b/i;
/** Real organisations stay in "Science Behind the Story" (src/story/science.ts), never in the fiction. */
const REAL_ORGS = /\b(NASA|NOAA|IPCC|WMO|EPA|USGS)\b/;

const words = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const chapterIndex = (id: ChapterId): number => CHAPTER_IDS.indexOf(id);
const MARA_REVEALED = chapterIndex('ch8-remains');

const characterIds = new Set(BIBLE.characters.map((c) => c.id));
const locationIds = new Set(BIBLE.locations.map((l) => l.id));
const decisionIds = new Set(BIBLE.decisions.map((d) => d.id));
const timelineIds = new Set(BIBLE.timeline.map((t) => t.id));
const bibleIds = new Set([...characterIds, ...locationIds, ...decisionIds, ...timelineIds]);
const institutions = new Set(INSTITUTIONS);

const allDocuments = (ch: ChapterDef): ArchiveDocument[] => [
  ...(ch.intro.document ? [ch.intro.document] : []),
  ...ch.fragments,
  ...ch.fallbackReflections,
];

/** Every player-visible string of a chapter (what the name and vocabulary rules apply to). */
const chapterTexts = (ch: ChapterDef): string[] => [
  ch.title,
  ...ch.intro.lines,
  ...(ch.caption ? [ch.caption] : []),
  ...(ch.tutorial ?? []).flatMap((t) => [t.title, t.body]),
  ...ch.landmarks.flatMap((l) => [l.name, l.label ?? '']),
  ...allDocuments(ch).flatMap((d) => [d.title, d.body, d.date ?? '']),
];

const bibleNarrative = (): string[] => [
  BIBLE.premise,
  ...BIBLE.characters.flatMap((c) => [c.role, c.description, c.history]),
  ...BIBLE.timeline.map((t) => t.summary),
  ...BIBLE.locations.map((l) => l.description),
  ...BIBLE.decisions.flatMap((d) => [d.decision, d.consequence]),
  ...BIBLE.relationships.map((r) => r.kind),
  ...BIBLE.revelations.map((r) => r.text),
];

/** Every condition inside a (possibly composite) condition. */
function flatten(c: FragmentCondition): FragmentCondition[] {
  if ('all' in c) return [c, ...c.all.flatMap(flatten)];
  if ('any' in c) return [c, ...c.any.flatMap(flatten)];
  if ('not' in c) return [c, ...flatten(c.not)];
  return [c];
}

const statuses = (s: LandmarkStatus | readonly LandmarkStatus[]): readonly LandmarkStatus[] =>
  typeof s === 'string' ? [s] : s;

/** Every authored text the player may be shown, with the condition that reveals it (if any). */
const shownTexts: readonly { id: string; text: string; when?: FragmentCondition }[] = [
  ...CHAPTERS.flatMap((ch) => [
    ...(ch.intro.document ? [{ id: ch.intro.document.id, text: ch.intro.document.body }] : []),
    ...[...ch.fragments, ...ch.fallbackReflections].map((f) => ({ id: f.id, text: f.body, when: f.when })),
  ]),
  ...EPILOGUE_PARTS.map((p) => ({ id: p.id, text: p.text, when: p.when })),
];

/**
 * Minimal evaluator with the documented semantics (src/story/select.ts is the real one): a landmark
 * missing from the evidence counts as 'notReached'; a history condition needs a saved entry.
 */
function holds(c: FragmentCondition, ev: RunEvidence, history: readonly { landmarks: RunEvidence['landmarks'] }[]): boolean {
  const destroyed = (cats?: readonly StructureCategory[]): number =>
    Object.entries(ev.destroyedByCategory)
      .filter(([k]) => !cats || cats.includes(k as StructureCategory))
      .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  if ('always' in c) return true;
  if ('landmark' in c) return statuses(c.status).includes(ev.landmarks.find((l) => l.id === c.landmark)?.status ?? 'notReached');
  if ('outcome' in c) return ev.outcome === c.outcome;
  if ('destroyedAtLeast' in c) return destroyed(c.categories) >= c.destroyedAtLeast;
  if ('destroyedAtMost' in c) return destroyed(c.categories) <= c.destroyedAtMost;
  if ('waterfallsAtLeast' in c) return ev.waterfallsCrossed >= c.waterfallsAtLeast;
  if ('grewAtLeast' in c) return ev.peakMass / ev.startMass >= c.grewAtLeast;
  if ('history' in c) {
    const h = c.history;
    const found = history.flatMap((e) => e.landmarks).find((l) => l.id === h.landmark);
    return found !== undefined && statuses(h.status).includes(found.status);
  }
  if ('all' in c) return c.all.every((x) => holds(x, ev, history));
  if ('any' in c) return c.any.some((x) => holds(x, ev, history));
  return !holds(c.not, ev, history);
}

const emptyEvidence = (ch: ChapterDef): RunEvidence => ({
  version: 1,
  chapterId: ch.id,
  levelId: ch.levelId,
  outcome: 'complete',
  time: 0,
  distance: 0,
  topSpeed: 0,
  startMass: 1,
  endMass: 1,
  peakMass: 1,
  absorbed: 0,
  iceLeft: 1,
  waterfallsCrossed: 0,
  collisions: 0,
  treesFelled: 0,
  knockedDown: 0,
  buildingsDestroyed: 0,
  storyPoints: 0,
  destroyedByCategory: {},
  destroyedByKind: {},
  landmarks: [],
  notable: [],
  route: [],
  reachedS: 0,
  coastS: 0,
});

describe('chapters: structure', () => {
  it('has nine chapters in level order with the right acts, music and AI flags', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual(CHAPTER_IDS);
    expect(CHAPTERS.map((c) => c.levelId)).toEqual(LEVELS.map((l) => l.id));
    expect(CHAPTERS.map((c) => c.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(CHAPTERS.map((c) => c.act)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(CHAPTERS.map((c) => c.actTitle)).toEqual([
      ...Array(3).fill('The Wonder'),
      ...Array(3).fill('The Cost'),
      ...Array(3).fill('The Reckoning'),
    ]);
    expect(CHAPTERS.map((c) => c.music)).toEqual(['wonder', 'wonder', 'unease', 'cost', 'cost', 'cost', 'reckoning', 'remains', 'thaw']);
    expect(CHAPTERS.filter((c) => c.aiReflection).map((c) => c.index)).toEqual([1, 4, 6, 9]);
    for (const ch of CHAPTERS) {
      expect(chapterById(ch.id)).toBe(ch);
      expect(chapterForLevel(ch.levelId)).toBe(ch);
      // The level designers fill overlays from OVERLAY_REQUESTS: once a chapter has its overlay, every
      // landmark its requests name is bound to an overlay placement.
      if (ch.overlay.obstacles.length > 0) {
        for (const r of OVERLAY_REQUESTS_BY_CHAPTER[ch.id]) {
          if (!r.landmark) continue;
          const lm = ch.landmarks.find((l) => l.id === r.landmark?.id);
          expect(lm?.bind.source, `${ch.id}: ${r.landmark.id}`).toBe('overlay');
        }
      }
    }
  });

  it('only chapter 1 has the tutorial: topple structures for points, the big targets worth most, no harm said', () => {
    for (const ch of CHAPTERS.slice(1)) expect(ch.tutorial).toBeUndefined();
    const tutorial = (CHAPTERS[0].tutorial ?? []).map((t) => `${t.title} ${t.body}`).join(' ');
    expect(tutorial).toMatch(/topple points/i);
    // Chapters 4 and 6 quote it: "the tutorial said a rig / a block like this is worth the most".
    expect(tutorial).toMatch(/oil rig/i);
    expect(tutorial).toMatch(/pipeline/i);
    expect(tutorial).toMatch(/apartment block/i);
    expect(tutorial).toMatch(/worth the most/i);
    // Light-hearted at first: what those points stand for is the story's to reveal, later.
    expect(tutorial).not.toMatch(/destr|harm|damage/i);
    expect(tutorial).toMatch(/points guide/i);
  });

  it('has 6-12 fragments and 2-4 fallback reflections per chapter, each tagged with its chapter', () => {
    for (const ch of CHAPTERS) {
      expect(ch.fragments.length, ch.id).toBeGreaterThanOrEqual(6);
      expect(ch.fragments.length, ch.id).toBeLessThanOrEqual(12);
      expect(ch.fallbackReflections.length, ch.id).toBeGreaterThanOrEqual(2);
      expect(ch.fallbackReflections.length, ch.id).toBeLessThanOrEqual(4);
      for (const f of [...ch.fragments, ...ch.fallbackReflections]) {
        expect(f.chapterId, f.id).toBe(ch.id);
        expect(f.untrusted, f.id).toBeUndefined();
      }
      for (const f of ch.fragments) expect(f.kind, f.id).not.toBe('reflection');
      for (const f of ch.fallbackReflections) expect(f.kind, f.id).toBe('reflection');
    }
  });

  it('uses ids that are unique across the whole story', () => {
    const docIds = CHAPTERS.flatMap((c) => allDocuments(c).map((d) => d.id));
    expect(new Set(docIds).size).toBe(docIds.length);
    const landmarkIds = CHAPTERS.flatMap((c) => c.landmarks.map((l) => l.id));
    // Requested landmarks not yet bound in their own chapter must not collide with any landmark either.
    const requested = CHAPTER_IDS.flatMap((id) =>
      OVERLAY_REQUESTS_BY_CHAPTER[id].flatMap((r) =>
        r.landmark && !chapterById(id)?.landmarks.some((l) => l.id === r.landmark?.id) ? [r.landmark.id] : [],
      ),
    );
    const all = [...landmarkIds, ...requested];
    expect(new Set(all).size).toBe(all.length);
    const epIds = EPILOGUE_PARTS.map((p) => p.id);
    expect(new Set([...docIds, ...epIds]).size).toBe(docIds.length + epIds.length);
  });
});

describe('chapters: landmarks', () => {
  it('binds 3-8 landmarks per chapter (plus its requested overlay landmarks) to placements of a fitting kind', () => {
    CHAPTERS.forEach((ch, i) => {
      const level = LEVELS[i];
      expect(level.id).toBe(ch.levelId);
      expect(ch.landmarks.length, ch.id).toBeGreaterThanOrEqual(3);
      // The writer's own landmarks stay at most 8; the overlay landmarks its requests name come on top.
      const requestedLandmarks = OVERLAY_REQUESTS_BY_CHAPTER[ch.id].filter((r) => r.landmark).length;
      expect(ch.landmarks.length, ch.id).toBeLessThanOrEqual(8 + requestedLandmarks);
      const bound = new Set<number>();
      // Base landmarks index the level's own obstacles, overlay landmarks the chapter's overlay;
      // both resolve into the story level's obstacles (base first, overlay appended). A landmark of
      // several placements (bind.also) needs every one to exist, be of its category and be its alone.
      const obstacles = storyLevel(ch).obstacles;
      for (const lm of ch.landmarks) {
        const indices = landmarkPlacements(ch, lm);
        expect(indices[0]).toBe(landmarkPlacement(ch, lm));
        for (const index of indices) {
          const placement = obstacles[index];
          expect(placement, `${lm.id}: ${level.id} has no ${lm.bind.source} obstacle for placement ${index}`).toBeDefined();
          expect(CATEGORY_OF[placement.kind], `${lm.id} binds a ${placement.kind}`).toBe(lm.category);
          expect(bound.has(index), `${lm.id} shares placement ${index}`).toBe(false);
          bound.add(index);
        }
      }
    });
  });

  it('binds each thing the story counts as one over all its placements: three turbines, a tank farm, a train, two well fields', () => {
    // "12 Aug: all three running" and "Tanks 1 to 6 sound" are shown only when every one stood, so the
    // landmark must hold every placement the text speaks for (src/core/levels/powerValley.ts: mound M0's
    // three turbines, the freight train across the yard, the tank farm; the overlays' well pads).
    const kinds = (chapterId: ChapterId, id: string): { kind: string; s: number }[] => {
      const ch = CHAPTERS.find((c) => c.id === chapterId)!;
      const lm = ch.landmarks.find((l) => l.id === id)!;
      const obstacles = storyLevel(ch).obstacles;
      return landmarkPlacements(ch, lm).map((p) => ({ kind: obstacles[p].kind, s: obstacles[p].s }));
    };
    const groups: [ChapterId, string, string, number][] = [
      ['ch6-price', 'coop-turbine', 'windTurbine', 3],
      ['ch6-price', 'coal-train', 'railWagon', 5],
      ['ch6-price', 'tank-farm', 'tank', 3],
      ['ch6-price', 'bench-wells', 'pumpjack', 3],
      ['ch7-escape', 'mesa-wells', 'pumpjack', 4],
    ];
    for (const [chapterId, id, kind, n] of groups) {
      const got = kinds(chapterId, id);
      expect(got.map((g) => g.kind), id).toEqual(Array(n).fill(kind));
    }
    // Mound M0's turbines stand together at s 302-310; the train is stopped across the yard at s 560.
    expect(kinds('ch6-price', 'coop-turbine').map((g) => g.s).sort()).toEqual([302, 306, 310]);
    expect(new Set(kinds('ch6-price', 'coal-train').map((g) => g.s))).toEqual(new Set([560]));
  });

  it('points every bibleRef at the bible and keeps the bible\'s location lists in step', () => {
    for (const ch of CHAPTERS) {
      for (const lm of ch.landmarks) for (const ref of lm.bibleRefs) expect(bibleIds.has(ref), `${lm.id} → ${ref}`).toBe(true);
      const loc = BIBLE.locations.find((l) => l.chapterId === ch.id);
      expect(loc, ch.id).toBeDefined();
      expect([...(loc?.landmarkIds ?? [])].sort()).toEqual(ch.landmarks.map((l) => l.id).sort());
    }
  });
});

describe('chapters: conditions', () => {
  it('names only landmarks of the same chapter, and history only of earlier chapters', () => {
    CHAPTERS.forEach((ch, i) => {
      const own = new Set(ch.landmarks.map((l) => l.id));
      const earlier = new Set(CHAPTERS.slice(0, i).flatMap((c) => c.landmarks.map((l) => l.id)));
      for (const f of [...ch.fragments, ...ch.fallbackReflections]) {
        for (const c of flatten(f.when)) {
          if ('landmark' in c) expect(own.has(c.landmark), `${f.id} → ${c.landmark}`).toBe(true);
          if ('history' in c) {
            expect(i, `${f.id}: history conditions start in chapter 4`).toBeGreaterThanOrEqual(3);
            expect(earlier.has(c.history.landmark), `${f.id} → history ${c.history.landmark}`).toBe(true);
          }
        }
      }
    });
  });

  it('never claims a place was spared except on an "intact" condition', () => {
    // A low destroyed count is not evidence that any particular place stood: such texts say how little
    // the player broke instead. Only a condition that guarantees an intact landmark licenses these words.
    const spared =
      /\b(still stands|still standing|still there|still hanging|was standing|stood when|stood in your run|mostly stood|left (?:[\w.]+ ){0,3}standing|left most of it|left the hut|it held(?=[.,;])|still held|held when you|spared|survived)\b/i;
    const impliesIntact = (c: FragmentCondition): boolean => {
      if ('landmark' in c) return statuses(c.status).every((s) => s === 'intact');
      if ('history' in c) return statuses(c.history.status).every((s) => s === 'intact');
      if ('all' in c) return c.all.some(impliesIntact);
      if ('any' in c) return c.any.every(impliesIntact);
      return false;
    };
    const problems = shownTexts
      .filter((t) => spared.test(t.text) && !(t.when && impliesIntact(t.when)))
      .map((t) => `${t.id}: "${t.text.match(spared)?.[0]}" without an intact condition`);
    expect(problems).toEqual([]);
  });

  it('counts losses only in what was built: every "at least" count names its categories, never trees', () => {
    // Felled trees are destroyed placements too (they score), so an uncategorised count once called a
    // route that broke seven trees, a fence and Calder's pipeline "a great deal of the Clachan", while
    // the route through Achadh and Balnacoil (three placements) did not. No authored text
    // is about trees: every count that reveals a text names the built categories it means. A count
    // under `not` reads the other way round ("not at most 3" is "at least 4").
    const problems: string[] = [];
    const check = (id: string, c: FragmentCondition, negated: boolean): void => {
      if ('all' in c) for (const x of c.all) check(id, x, negated);
      else if ('any' in c) for (const x of c.any) check(id, x, negated);
      else if ('not' in c) check(id, c.not, !negated);
      else if (('destroyedAtLeast' in c && !negated) || ('destroyedAtMost' in c && negated)) {
        if (!c.categories?.length) problems.push(`${id}: counts every category, felled trees included`);
        else if (c.categories.includes('nature')) problems.push(`${id}: counts felled trees as losses`);
      }
    };
    for (const t of shownTexts) if (t.when) check(t.id, t.when, false);
    expect(problems).toEqual([]);
  });

  it('says how much a run broke only where a count of what it built guarantees it', () => {
    // How much went is a count, so a landmark condition (one house) or `always` cannot license it.
    const amount = /\b(a great deal of it went|broke a great deal|went one after another|the list was long|points were very high)\b/i;
    const countsBuilt = (c: FragmentCondition): boolean => {
      if ('destroyedAtLeast' in c) return c.destroyedAtLeast >= 2 && (c.categories ?? []).length > 0 && !c.categories?.includes('nature');
      if ('all' in c) return c.all.some(countsBuilt);
      if ('any' in c) return c.any.length > 0 && c.any.every(countsBuilt);
      return false;
    };
    const problems = shownTexts
      .filter((t) => amount.test(t.text) && !(t.when && countsBuilt(t.when)))
      .map((t) => `${t.id}: "${t.text.match(amount)?.[0]}" without a count of built losses`);
    expect(problems).toEqual([]);
    // The texts this guards exist (a renamed phrase would silently empty the check).
    expect(shownTexts.filter((t) => amount.test(t.text)).map((t) => t.id).sort()).toEqual(
      ['ch7-reflection-homes', 'ch8-reflection-much-lost', 'ch8-two-columns', 'ep-journey-heavy'].sort(),
    );
  });

  it('gives every chapter an always-fragment and a reflection that fits an empty run', () => {
    for (const ch of CHAPTERS) {
      expect(ch.fragments.some((f) => 'always' in f.when), ch.id).toBe(true);
      const ev = emptyEvidence(ch);
      expect(ch.fallbackReflections.some((f) => holds(f.when, ev, [])), ch.id).toBe(true);
      expect(ch.fragments.some((f: ArchiveFragment) => holds(f.when, ev, [])), ch.id).toBe(true);
    }
  });
});

describe('chapters: writing rules', () => {
  it('keeps documents, captions, reflections and intro lines within their word limits', () => {
    for (const ch of CHAPTERS) {
      expect(ch.intro.lines.length, ch.id).toBeGreaterThanOrEqual(1);
      expect(ch.intro.lines.length, ch.id).toBeLessThanOrEqual(4);
      for (const line of ch.intro.lines) expect(words(line), line).toBeLessThanOrEqual(25);
      if (ch.caption) expect(words(ch.caption), ch.caption).toBeLessThanOrEqual(16);
      for (const t of ch.tutorial ?? []) expect(words(t.body), t.title).toBeLessThanOrEqual(60);
    }
    // Collected rather than asserted one by one, so a writing pass sees every overrun at once.
    const problems: string[] = [];
    const check = (id: string, n: number, min: number, max: number): void => {
      if (n < min || n > max) problems.push(`${id}: ${n} words (want ${min}-${max})`);
    };
    for (const ch of CHAPTERS) {
      for (const d of [...(ch.intro.document ? [ch.intro.document] : []), ...ch.fragments]) {
        if (d.kind === 'caption') check(d.id, words(d.body), 8, 40);
        else check(d.id, words(d.body), 40, 140);
      }
      for (const r of ch.fallbackReflections) check(r.id, words(r.body), 60, 150);
    }
    expect(problems).toEqual([]);
  });

  it('uses no casualty vocabulary, no "inside" claims and no real organisations anywhere', () => {
    const texts = [...CHAPTERS.flatMap(chapterTexts), ...EPILOGUE_PARTS.map((p) => p.text), ...bibleNarrative()];
    for (const t of texts) {
      expect(t, 'casualty vocabulary').not.toMatch(CASUALTY);
      expect(t, 'inside claim').not.toMatch(INSIDE_CLAIM);
      expect(t, 'real organisation').not.toMatch(REAL_ORGS);
    }
  });

  it('repeats no nine-word run of text between two documents', () => {
    // Motifs may echo; whole phrases may not. Epilogue parts of the same slot are alternatives that never
    // appear together, so they may share their framing.
    const SPAN = 9;
    const norm = (t: string): string[] => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const docs = [
      ...CHAPTERS.flatMap((ch) => allDocuments(ch).map((d) => ({ id: d.id, group: d.id, text: d.body }))),
      ...EPILOGUE_PARTS.map((p) => ({ id: p.id, group: `epilogue-${p.slot}`, text: p.text })),
    ];
    const seen = new Map<string, { id: string; group: string }>();
    const problems: string[] = [];
    for (const d of docs) {
      const w = norm(d.text);
      const own = new Set<string>();
      for (let i = 0; i + SPAN <= w.length; i++) {
        const key = w.slice(i, i + SPAN).join(' ');
        if (own.has(key)) continue;
        own.add(key);
        const first = seen.get(key);
        if (first && first.group !== d.group) problems.push(`${first.id} / ${d.id}: "${key}"`);
        else if (!first) seen.set(key, d);
      }
    }
    expect(problems).toEqual([]);
  });

  it('names people in full, never by a bare initial (the student\'s playtest: "E. is driving the late train")', () => {
    // INITIAL (src/story/plainWords.ts, shared with the validator of the agents' text): a capital letter
    // and a full stop standing for a name; labels that end in a letter ("Annex F.", "Point B") are not names.
    const texts = [
      ...CHAPTERS.flatMap((ch) => allDocuments(ch).flatMap((d) => [{ id: d.id, text: `${d.title}\n${d.body}` }])),
      ...EPILOGUE_PARTS.map((p) => ({ id: p.id, text: p.text })),
    ];
    const problems = texts.filter((t) => INITIAL.test(t.text)).map((t) => `${t.id}: "${t.text.match(INITIAL)?.[0]}"`);
    expect(problems).toEqual([]);
    // The pattern does catch the old forms, so an empty list means something.
    for (const old of ['E. is driving the late train.', 'Prepared by A. Sorel.', 'Back Sunday. Love, J.', 'several weeks. T.L.', 'dentist (M.), will not go']) {
      expect(old, old).toMatch(INITIAL);
    }
    expect('The costs are in Annex F. Prepared by Anna Sorel.').not.toMatch(INITIAL);
  });

  it('uses plain words, not regional or old-fashioned ones a reader would need explained (the playtest: "Spoilt: 9", "by the font")', () => {
    // GLOSSED (src/story/plainWords.ts, shared with the validator): the words the playtest stumbled on and
    // their neighbours. Ids may keep them ('bothy', 'clachan-kirk'): only what the player reads is checked.
    const texts = [
      ...CHAPTERS.flatMap((ch) => [
        { id: `${ch.id} intro`, text: [...ch.intro.lines, ch.caption ?? ''].join('\n') },
        ...ch.landmarks.map((l) => ({ id: l.id, text: `${l.name}\n${l.label ?? ''}` })),
        ...allDocuments(ch).map((d) => ({ id: d.id, text: `${d.title}\n${d.body}` })),
      ]),
      ...EPILOGUE_PARTS.map((p) => ({ id: p.id, text: p.text })),
    ];
    const problems = texts.filter((t) => GLOSSED.test(t.text)).map((t) => `${t.id}: "${t.text.match(GLOSSED)?.[0]}"`);
    expect(problems).toEqual([]);
    for (const old of ['Spoilt: 9.', 'Lost property is by the font.', 'signed in biro', 'the bothy above the Leap', 'the kirk bell']) {
      expect(old, old).toMatch(GLOSSED);
    }
  });

  it('names each minor person in full in their first chapter and in no earlier one', () => {
    for (const p of MINOR_PEOPLE) {
      const from = chapterIndex(p.chapterId as ChapterId);
      expect(from, p.name).toBeGreaterThanOrEqual(0);
      const [first, ...rest] = p.name.split(' ');
      const last = rest.at(-1) ?? '';
      expect(chapterTexts(CHAPTERS[from]).join('\n'), `${p.name} in ${p.chapterId}`).toContain(p.name);
      CHAPTERS.slice(0, from).forEach((ch) => {
        const text = chapterTexts(ch).join('\n');
        expect(text, `${ch.id} names ${first}`).not.toMatch(new RegExp(`\\b${first}\\b`));
        expect(text, `${ch.id} names ${last}`).not.toMatch(new RegExp(`\\b${last}\\b`));
      });
      // Nobody in the bible's cast shares the name.
      for (const c of BIBLE.characters) expect(c.name.split(' ')).not.toContain(first);
    }
  });

  it('references only bible characters and valid authors', () => {
    for (const ch of CHAPTERS) {
      for (const d of allDocuments(ch)) {
        for (const id of d.characters ?? []) expect(characterIds.has(id), `${d.id} → ${id}`).toBe(true);
        if (d.author) expect(characterIds.has(d.author) || institutions.has(d.author), `${d.id} author ${d.author}`).toBe(true);
      }
    }
    for (const dec of BIBLE.decisions) expect(characterIds.has(dec.who) || institutions.has(dec.who), dec.id).toBe(true);
  });

  it('introduces no character before their first chapter, and never names Mara before chapter 8', () => {
    const surnameCount = new Map<string, number>();
    for (const c of BIBLE.characters) {
      const last = c.name.split(' ').at(-1) ?? '';
      surnameCount.set(last, (surnameCount.get(last) ?? 0) + 1);
    }
    CHAPTERS.forEach((ch, i) => {
      const text = chapterTexts(ch).join('\n');
      const refs = [
        ...allDocuments(ch).flatMap((d) => [...(d.characters ?? []), ...(d.author ? [d.author] : [])]),
        ...ch.landmarks.flatMap((l) => l.bibleRefs),
      ].filter((id) => characterIds.has(id));
      for (const c of BIBLE.characters) {
        const from = chapterIndex(c.revealedIn ?? c.firstAppears);
        if (i >= from) continue;
        const [first] = c.name.split(' ');
        const last = c.name.split(' ').at(-1) ?? '';
        expect(text, `${ch.id} names ${first}`).not.toMatch(new RegExp(`\\b${first}\\b`));
        if (surnameCount.get(last) === 1) expect(text, `${ch.id} names ${last}`).not.toMatch(new RegExp(`\\b${last}\\b`));
        expect(refs, `${ch.id} references ${c.id}`).not.toContain(c.id);
      }
      if (i < MARA_REVEALED) expect(text).not.toMatch(/\bMara\b/);
    });
    expect(BIBLE.characters.find((c) => c.id === 'mara-vey')?.revealedIn).toBe('ch8-remains');
    expect(chapterTexts(CHAPTERS[MARA_REVEALED]).join(' ')).toMatch(/\bMara Vey\b/);
  });
});

describe('story bible', () => {
  it('keeps a small cast whose references all resolve', () => {
    expect(BIBLE.characters.length).toBeGreaterThanOrEqual(6);
    expect(BIBLE.characters.length).toBeLessThanOrEqual(9);
    expect(characterIds.size).toBe(BIBLE.characters.length);
    for (const c of BIBLE.characters) for (const l of c.locations) expect(locationIds.has(l), `${c.id} → ${l}`).toBe(true);
    for (const t of BIBLE.timeline) {
      for (const id of t.characters ?? []) expect(characterIds.has(id), `${t.id} → ${id}`).toBe(true);
      for (const id of t.locations ?? []) expect(locationIds.has(id), `${t.id} → ${id}`).toBe(true);
    }
    const years = BIBLE.timeline.map((t) => t.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    for (const r of BIBLE.relationships) {
      expect(characterIds.has(r.a), r.a).toBe(true);
      expect(characterIds.has(r.b), r.b).toBe(true);
    }
    expect(BIBLE.revelations.map((r) => r.chapterId)).toEqual(CHAPTER_IDS);
    expect(BIBLE.locations.map((l) => l.chapterId)).toEqual(CHAPTER_IDS);
    expect(BIBLE.theme).toBe('You cannot undo the river behind you. You can still decide where it goes next.');
  });

  it('spreads responsibility across household, local, regional, national, industry and global decisions', () => {
    const levels = new Set(BIBLE.decisions.map((d) => d.responsibility));
    for (const r of ['household', 'local', 'regional', 'national', 'industry', 'global'] as const) expect(levels.has(r), r).toBe(true);
  });
});

describe('overlay requests', () => {
  const allowed = new Set([...Object.keys(CATEGORY_OF)]);
  it('escalates by act and asks only for known kinds at real course positions', () => {
    const counts = CHAPTER_IDS.map((id) => OVERLAY_REQUESTS_BY_CHAPTER[id].length);
    expect(counts[0]).toBe(0);
    const act = (a: number): number => counts.slice(a * 3, a * 3 + 3).reduce((s, n) => s + n, 0);
    expect(act(0)).toBeLessThan(act(1));
    expect(act(1)).toBeLessThan(act(2));
    for (const id of CHAPTER_IDS) {
      for (const r of OVERLAY_REQUESTS_BY_CHAPTER[id]) {
        expect(allowed.has(r.kind), `${id}: ${r.kind}`).toBe(true);
        expect(CATEGORY_OF[r.kind], `${id}: ${r.kind}`).not.toBe('nature');
        expect(r.near, id).toMatch(/s≈\d+/);
        expect(r.purpose.length, id).toBeGreaterThan(10);
      }
    }
    // Act II asks for homes and extraction; Act III for the big harmful kinds.
    const kinds = (ids: ChapterId[]): Set<string> => new Set(ids.flatMap((id) => OVERLAY_REQUESTS_BY_CHAPTER[id].map((r) => r.kind)));
    const act2 = kinds(['ch4-people', 'ch5-denial', 'ch6-price']);
    for (const k of ['apartmentBlock', 'pipeline', 'pumpjack']) expect(act2.has(k), k).toBe(true);
    const act3 = kinds(['ch7-escape', 'ch8-remains', 'ch9-last-thaw']);
    for (const k of ['apartmentBlock', 'pipeline', 'pumpjack', 'oilRig']) expect(act3.has(k), k).toBe(true);
  });
});

describe('epilogue parts', () => {
  const lastChapter = CHAPTERS[8];
  const earlierLandmarks = new Set(CHAPTERS.slice(0, 8).flatMap((c) => c.landmarks.map((l) => l.id)));
  const ownLandmarks = new Set(lastChapter.landmarks.map((l) => l.id));

  it('covers every slot with an always part and resolves every landmark it names', () => {
    for (const slot of EPILOGUE_SLOTS) {
      expect(EPILOGUE_PARTS.some((p) => p.slot === slot && 'always' in p.when), slot).toBe(true);
    }
    for (const p of EPILOGUE_PARTS) {
      for (const c of flatten(p.when)) {
        if ('history' in c) expect(earlierLandmarks.has(c.history.landmark), `${p.id} → ${c.history.landmark}`).toBe(true);
        if ('landmark' in c) expect(ownLandmarks.has(c.landmark), `${p.id} → ${c.landmark}`).toBe(true);
      }
    }
  });

  it('joins into 150-250 words whichever part each slot picks', () => {
    for (const p of EPILOGUE_PARTS) {
      expect(words(p.text), p.id).toBeGreaterThanOrEqual(30);
      expect(words(p.text), p.id).toBeLessThanOrEqual(80);
    }
    const bySlot = EPILOGUE_SLOTS.map((s) => EPILOGUE_PARTS.filter((p) => p.slot === s).map((p) => words(p.text)));
    const min = bySlot.reduce((sum, ns) => sum + Math.min(...ns), 0);
    const max = bySlot.reduce((sum, ns) => sum + Math.max(...ns), 0);
    expect(min).toBeGreaterThanOrEqual(150);
    expect(max).toBeLessThanOrEqual(250);
  });

  it('states the theme once in the closing, and nowhere claims humanity ended', () => {
    for (const p of EPILOGUE_PARTS) {
      expect(p.text).not.toMatch(/\b(extinct|extinction|humanity)\b/i);
      if (p.text.includes('You cannot undo the river behind you')) expect(p.slot).toBe('closing');
    }
    for (const p of EPILOGUE_PARTS.filter((x) => x.slot === 'closing')) expect(p.text).toContain(BIBLE.theme);
  });
});
