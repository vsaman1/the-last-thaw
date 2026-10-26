import { beforeAll, describe, expect, it } from 'vitest';
import { autopilotSteer } from '../../core/autopilot';
import { getLevel } from '../../core/levels';
import { buildObstacleSpecs } from '../../core/obstacles/spawn';
import { FIXED_DT, GameSession, getTerrain } from '../../core/session';
import { validateWorldLogic } from '../../core/terrain/logic';
import { validateLevel } from '../../core/terrain/validate';
import { rideBridgeLane } from '../../core/testing/bridgeLane';
import type { CourseCoord, LevelDef, TerrainFeature } from '../../core/types';
import { attachEventClock, buildRunEvidence } from '../evidence';
import { categoryOf, tallyStoryPoints, type ScoredBody } from '../scoring';
import { selectFragments } from '../select';
import { chapterBindingIssues, storyLevel } from '../storyLevel';
import { runTestChapter } from '../testkit';
import type { ChapterDef, RunEvidence, StructureCategory } from '../types';
import type { OverlayRequest } from './authoring';
import { CH4, OVERLAY_REQUESTS as REQUESTS4 } from './ch4';
import { CH5, OVERLAY_REQUESTS as REQUESTS5 } from './ch5';
import { CH6, OVERLAY_REQUESTS as REQUESTS6 } from './ch6';

/**
 * Act II, "The Cost" (chapters 4-6): the level designer's overlays. They must bind every requested
 * landmark, leave the story level valid (placements, world logic, body budget), keep the intended line
 * finishable, and do what the act asks: getting down the valley without breaking human things gets
 * harder (homes, flats, pipelines, wells and a rig stand in the ways), while a careful line still
 * leaves most named places standing.
 *
 * Every run is a real headless session (Rapier physics, real water budget, chipping, traffic) with
 * the autopilot: the level's own line through src/story/testkit.ts runTestChapter, the alternatives
 * on a copy of the story level whose line is replaced (the autopilot reads terrain.level.line).
 *
 * THE ESCALATION PROPERTY (asserted below, measured numbers in each chapter's OVERLAY comment):
 * - no tested way down is free: every one destroys at least two human-built placements, at least one
 *   of them a home or an extraction site, and scores at least 800 story points (one pipeline's worth);
 * - the overlay stands in the ways: in Riverside it closes the base level's cheapest way (the east
 *   side: 1650 points on the base level, 3200 with the gas main and Station Court); Calder's pipeline
 *   lies across both tested ways down the Kessel avalanche track (+800 points each); in Power Valley
 *   the careful bench route now breaks the well pad (250 -> 850 points), and the intended line and the
 *   dam breach the works gas main;
 * - meaningful choices remain: each chapter's careful line leaves at least four named landmarks intact,
 *   and the overlay's high-value landmarks (Station Court, Kessel Lodge, Rig Four) are each destroyed by
 *   one tested line and spared by another.
 * Measured on this branch (story level, real sessions): the cheapest tested way per chapter costs 1900
 * (Riverside outskirts), 2220 (Kessel, the line) and 850 points (Power Valley ridge); on the base
 * levels the same ways cost 1650 (east), 1240 (centre) and 250.
 */

type Line = CourseCoord[];
type Stream = Extract<TerrainFeature, { type: 'stream' }>;

/** Riverside: the outskirts (west lane, crossing W, the river's slot, the coffer dam). */
const OUTSKIRTS: Line = [
  { s: 30, d: 0 }, { s: 100, d: -55 }, { s: 140, d: -110 }, { s: 200, d: -120 }, { s: 300, d: -120 },
  { s: 420, d: -118 }, { s: 470, d: -120 }, { s: 545, d: -124 }, { s: 616, d: -137 }, { s: 680, d: -118 },
  { s: 745, d: -95 }, { s: 771.5, d: -90 }, { s: 800, d: -72 }, { s: 850, d: -50 }, { s: 960, d: -20 },
  { s: 1080, d: 12 }, { s: 1120, d: 18 }, { s: 1240, d: 18 }, { s: 1300, d: 10 }, { s: 1420, d: 0 },
  { s: 1600, d: 0 },
];
/** Riverside: the east side (between old-town wall B and Tower Road, the park, crossing E, the kicker). */
const EAST: Line = [
  { s: 30, d: 0 }, { s: 110, d: 25 }, { s: 150, d: 50 }, { s: 220, d: 78 }, { s: 320, d: 84 }, { s: 400, d: 88 },
  { s: 440, d: 90 }, { s: 480, d: 92 }, { s: 540, d: 90 }, { s: 600, d: 88 }, { s: 663, d: 87 }, { s: 700, d: 75 },
  { s: 730, d: 52 }, { s: 750, d: 41 }, { s: 778.5, d: 40 }, { s: 840, d: 30 }, { s: 950, d: 5 },
  { s: 1080, d: -18 }, { s: 1120, d: -16 }, { s: 1240, d: -16 }, { s: 1300, d: 8 }, { s: 1420, d: 5 },
  { s: 1600, d: 0 },
];
/** Kessel: the centre couloir, the 20 m crevasse jump, the right forest, the village's right side. */
const CENTRE: Line = [
  { s: 30, d: 0 }, { s: 150, d: 0 }, { s: 200, d: 6 }, { s: 270, d: 2 }, { s: 330, d: 4 }, { s: 400, d: 2 },
  { s: 440, d: 5 }, { s: 480, d: 15 }, { s: 505, d: 25 }, { s: 560, d: 38 }, { s: 600, d: 55 },
  { s: 650, d: 75 }, { s: 700, d: 86 }, { s: 760, d: 100 }, { s: 800, d: 105 }, { s: 860, d: 100 },
  { s: 920, d: 70 }, { s: 970, d: 45 }, { s: 1040, d: 15 }, { s: 1062, d: 0 }, { s: 1520, d: 0 },
];
/** Power Valley: the ridge route over the wind-farm bench (no plant, no dam). */
const RIDGE: Line = [
  { s: 30, d: 0 }, { s: 90, d: -12 }, { s: 150, d: -45 }, { s: 185, d: -65 }, { s: 230, d: -100 },
  { s: 280, d: -135 }, { s: 330, d: -160 }, { s: 440, d: -165 }, { s: 520, d: -178 }, { s: 1000, d: -180 },
  { s: 1150, d: -175 }, { s: 1262, d: -170 }, { s: 1284, d: -170 }, { s: 1330, d: -165 }, { s: 1400, d: -160 },
  { s: 1450, d: -135 }, { s: 1530, d: -80 }, { s: 1650, d: -60 }, { s: 1700, d: -45 }, { s: 1790, d: -15 },
  { s: 1845, d: 0 }, { s: 1900, d: 0 },
];
/** Power Valley: the intended line, but steered left off the sea cliff onto Rig Four. */
const RIG: Line = [
  ...(getLevel(CH6.levelId).line ?? []).filter((p) => p.s <= 1650),
  { s: 1700, d: -20 }, { s: 1790, d: -28 }, { s: 1830, d: -38 }, { s: 1856, d: -40 }, { s: 1900, d: -40 },
];
/**
 * Power Valley: the dam breach of src/core/levels/powerValley.test.ts — the line to the boiler house,
 * then down the gorge and square onto the dam monolith over the riverbed, over the fall with the flood.
 */
function breachLine(): Line {
  const level = getLevel(CH6.levelId);
  const terrain = getTerrain(level);
  const dam = level.obstacles.find((o) => o.kind === 'dam')!;
  const river = (level.features ?? []).find((f): f is Stream => f.type === 'stream')!;
  const riverD = river.points.reduce((b, p) => (Math.abs(p.s - dam.s) < Math.abs(b.s - dam.s) ? p : b)).d;
  const index = level.obstacles.indexOf(dam);
  const ds = buildObstacleSpecs(terrain, level.seed)
    .filter((b) => b.placement === index && b.anchored)
    .map((b) => terrain.course.project(b.position.x, b.position.z).d);
  const target = ds.reduce((a, b) => (Math.abs(b - riverD) < Math.abs(a - riverD) ? b : a));
  return [
    ...(level.line ?? []).filter((q) => q.s <= 915),
    { s: 960, d: -46 }, { s: 1010, d: -34 }, { s: 1050, d: target }, { s: 1085, d: target },
    { s: 1150, d: -20 }, { s: 1265, d: -20 }, { s: 1288, d: -20 }, { s: 1330, d: -20 }, { s: 1400, d: -15 },
    { s: 1450, d: -20 }, { s: 1500, d: 5 }, { s: 1560, d: -10 }, { s: 1640, d: -12 }, { s: 1700, d: -2 },
    { s: 1790, d: 0 }, { s: 1845, d: 0 }, { s: 1900, d: 0 },
  ];
}

interface Act2Chapter {
  chapter: ChapterDef;
  requests: readonly OverlayRequest[];
  /** Alternatives to the level's own line; `careful` is the one that breaks least. */
  lines: Record<string, Line | (() => Line)>;
  careful: string;
}

const ACT2: readonly Act2Chapter[] = [
  { chapter: CH4, requests: REQUESTS4, lines: { outskirts: OUTSKIRTS, east: EAST }, careful: 'outskirts' },
  { chapter: CH5, requests: REQUESTS5, lines: { centre: CENTRE }, careful: 'line' },
  { chapter: CH6, requests: REQUESTS6, lines: { ridge: RIDGE, rig: RIG, breach: breachLine }, careful: 'ridge' },
];

/** Obstacle bodies the overlay may add to the level's own count. */
const BODY_BUDGET = 60;

/** Real headless run of a chapter: its level line (testkit), or `line` on a copy of the story level. */
async function play(chapter: ChapterDef, name: string, line?: Line): Promise<RunEvidence> {
  const story = storyLevel(chapter);
  if (!line) {
    const { session, clock } = await runTestChapter(() => 0, 240, chapter);
    const ev = buildRunEvidence({ session, chapter, level: story, clock });
    session.dispose();
    return ev;
  }
  const level: LevelDef = { ...story, id: `${story.id}-${name}`, line };
  const session = await GameSession.create({ level, skipIntro: true });
  const clock = attachEventClock(session);
  for (let i = 0; i < 240 / FIXED_DT && session.phase === 'playing'; i++) {
    session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain));
  }
  const ev = buildRunEvidence({ session, chapter, level, clock });
  session.dispose();
  return ev;
}

const HUMAN = (c: StructureCategory): boolean => c !== 'nature';
const destroyedWhere = (ev: RunEvidence, keep: (c: StructureCategory) => boolean): number =>
  Object.entries(ev.destroyedByCategory).reduce((n, [c, k]) => n + (keep(c as StructureCategory) ? (k ?? 0) : 0), 0);
const statusOf = (ev: RunEvidence, id: string): string | undefined => ev.landmarks.find((l) => l.id === id)?.status;

const summary = (chapter: ChapterDef, name: string, ev: RunEvidence): string =>
  `[act2] ${chapter.id} ${name}: ${ev.outcome}${ev.failReason ? ` (${ev.failReason})` : ''} ` +
  `${ev.time.toFixed(1)} s, ice ${(ev.iceLeft * 100).toFixed(1)} %, ${ev.storyPoints} pts, ` +
  `destroyed ${JSON.stringify(ev.destroyedByCategory)}; landmarks ` +
  ev.landmarks.map((l) => `${l.id} ${l.status}`).join(', ');

describe.each(ACT2)('Act II overlay: $chapter.id', ({ chapter, requests, lines, careful }) => {
  const level = storyLevel(chapter);
  const base = getLevel(chapter.levelId);

  it('binds every requested landmark to an overlay placement of the requested kind', () => {
    expect(chapterBindingIssues(chapter)).toEqual([]);
    for (const r of requests) {
      if (!r.landmark) continue;
      const lm = chapter.landmarks.find((l) => l.id === r.landmark?.id);
      expect(lm, r.landmark.id).toBeDefined();
      expect(lm?.bind.source, r.landmark.id).toBe('overlay');
      const placed = chapter.overlay.obstacles[lm?.bind.index ?? -1];
      expect(placed?.kind, r.landmark.id).toBe(r.kind);
      expect(lm?.category, r.landmark.id).toBe(categoryOf(r.kind));
      expect(lm?.name, r.landmark.id).toBe(r.landmark.name);
      if (r.landmark.label) expect(lm?.label, r.landmark.id).toBe(r.landmark.label);
    }
    // Every requested kind is placed at least as often as it was requested.
    const count = (kinds: readonly string[], k: string): number => kinds.filter((x) => x === k).length;
    const placedKinds: string[] = chapter.overlay.obstacles.map((o) => o.kind);
    const asked: string[] = requests.map((r) => r.kind);
    for (const k of new Set(asked)) expect(count(placedKinds, k), k).toBeGreaterThanOrEqual(count(asked, k));
  });

  it('keeps the story level valid: placements, world logic, body budget', () => {
    const terrain = getTerrain(level);
    expect(level.id).not.toBe(base.id);
    expect(level.obstacles.slice(0, base.obstacles.length)).toEqual(base.obstacles);
    expect(validateLevel(terrain)).toEqual([]);
    expect(validateWorldLogic(terrain).filter((i) => i.severity === 'error')).toEqual([]);
    const bodies = buildObstacleSpecs(terrain, level.seed).length;
    const baseBodies = buildObstacleSpecs(getTerrain(base), base.seed).length;
    expect(bodies - baseBodies).toBeGreaterThan(0);
    expect(bodies - baseBodies).toBeLessThanOrEqual(BODY_BUDGET);
  }, 120_000);

  describe('playtests (real sessions, autopilot)', () => {
    const runs = new Map<string, RunEvidence>();
    beforeAll(async () => {
      runs.set('line', await play(chapter, 'line'));
      for (const [name, line] of Object.entries(lines)) {
        runs.set(name, await play(chapter, name, typeof line === 'function' ? line() : line));
      }
      for (const [name, ev] of runs) console.log(summary(chapter, name, ev));
    }, 600_000);

    it('the intended line still completes with the overlay, and so does every tested way', () => {
      for (const [name, ev] of runs) expect(ev.outcome, `${chapter.id} ${name}`).toBe('complete');
    });

    it('no tested way down is free: two human-built placements or more, one a home or extraction site', () => {
      for (const [name, ev] of runs) {
        const tag = `${chapter.id} ${name}`;
        expect(destroyedWhere(ev, HUMAN), tag).toBeGreaterThanOrEqual(2);
        expect(destroyedWhere(ev, (c) => c === 'home' || c === 'extraction'), tag).toBeGreaterThanOrEqual(1);
        expect(ev.storyPoints, tag).toBeGreaterThanOrEqual(800);
      }
    });

    it('the careful line still leaves at least four named landmarks standing', () => {
      const ev = runs.get(careful)!;
      expect(ev.landmarks.filter((l) => l.status === 'intact').length).toBeGreaterThanOrEqual(4);
    });

    it('the overlay stands in the ways', () => {
      const all = [...runs.values()];
      const overlayIds = chapter.landmarks.filter((l) => l.bind.source === 'overlay').map((l) => l.id);
      // Some tested way breaks an overlay landmark, and some tested way spares it.
      expect(all.some((ev) => overlayIds.some((id) => statusOf(ev, id) === 'destroyed'))).toBe(true);
      expect(all.some((ev) => overlayIds.some((id) => statusOf(ev, id) === 'intact'))).toBe(true);
      if (chapter.id === 'ch4-people') {
        // The east side, the base level's cheapest way (1650 points), now breaks the gas main and
        // Station Court; the old town's line and the outskirts leave the block standing.
        const east = runs.get('east')!;
        expect(statusOf(east, 'station-court')).toBe('destroyed');
        expect(east.destroyedByKind.pipeline ?? 0).toBeGreaterThanOrEqual(1);
        expect(statusOf(runs.get('line')!, 'station-court')).toBe('intact');
        expect(statusOf(runs.get('outskirts')!, 'station-court')).toBe('intact');
      }
      if (chapter.id === 'ch5-denial') {
        // The pipeline lies across every way down the avalanche track; Kessel Lodge is a choice.
        for (const ev of all) expect(statusOf(ev, 'kessel-pipeline')).toBe('destroyed');
        expect(statusOf(runs.get('centre')!, 'kessel-lodge')).toBe('destroyed');
        expect(statusOf(runs.get('line')!, 'kessel-lodge')).toBe('intact');
      }
      if (chapter.id === 'ch6-price') {
        // The careful bench route now breaks the well pad; the line and the dam breach break the works
        // gas main; the rig is spared unless steered for.
        expect(statusOf(runs.get('ridge')!, 'bench-wells')).toBe('destroyed');
        expect(statusOf(runs.get('line')!, 'works-pipeline')).toBe('destroyed');
        expect(statusOf(runs.get('breach')!, 'works-pipeline')).toBe('destroyed');
        expect(statusOf(runs.get('breach')!, 'calder-dam')).toBe('destroyed');
        expect(statusOf(runs.get('rig')!, 'calder-rig-four')).toBe('destroyed');
        expect(statusOf(runs.get('line')!, 'calder-rig-four')).toBe('intact');
      }
    });
  });
});

describe('Power Valley: the co-op turbines are one landmark', () => {
  it('breaking an outer turbine of mound M0 breaks the co-op turbine: "all three running" is withheld', async () => {
    // 14 m right of the line across mound M0 only (s 250-340): the run breaks the third turbine (#19),
    // not the middle one (#18) the landmark points at.
    const { session, clock } = await runTestChapter((s) => (s >= 250 && s <= 340 ? 14 : 0), 240, CH6);
    try {
      const ev = buildRunEvidence({ session, chapter: CH6, level: storyLevel(CH6), clock });
      const w = session.physics as unknown as { getBody(id: number): ScoredBody | undefined };
      const turbines = tallyStoryPoints(session.events.log, (id) => w.getBody(id))
        .destroyed.filter((u) => u.kind === 'windTurbine')
        .map((u) => u.placement);
      console.log(`${summary(CH6, 'm0 +14', ev)}; turbines broken ${turbines.join(', ')}`);
      expect(turbines).toContain(19);
      expect(turbines).not.toContain(18);
      expect(statusOf(ev, 'coop-turbine')).toBe('destroyed');
      expect(ev.notable.some((n) => n.landmarkId === 'coop-turbine' && n.kind === 'windTurbine')).toBe(true);
      const shown = selectFragments(CH6, ev, [], 12).map((f) => f.id);
      expect(shown).not.toContain('ch6-coop-log');
      expect(shown).toContain('ch6-coop-courier');
    } finally {
      session.dispose();
    }
  }, 300_000);
});

describe('Riverside (chapter 4): the viaduct with the overlay', () => {
  it('an iceberg arriving outside a viaduct parapet rides as before the walls (lanes -8 and +7)', async () => {
    // Follow-up review of playtest 2: on the viaduct route 8 m left of the axis (and 7 m right, where
    // Arcade's lane +7 crossed) the flare caught the hull arriving outside the barrier line, pushed it
    // in, and it dropped off mid-span at s 780-785; without the walls both crossed at 20 m/s. Now the
    // side gives way to such a hull (src/core/physics/deckGround.ts, PARAPET.breakOut).
    const base = getLevel(CH4.levelId);
    const viaduct: Line = [
      ...(base.line ?? []).filter((p) => p.s <= 638),
      { s: 680, d: -42 }, { s: 702, d: -50 }, { s: 760, d: -50 }, { s: 795, d: -50 }, { s: 830, d: -48 },
      { s: 860, d: -36 }, { s: 1000, d: -36 },
      ...(base.line ?? []).filter((p) => p.s >= 1080),
    ];
    for (const lane of [-8, 7]) {
      const r = await rideBridgeLane(storyLevel(CH4), viaduct, lane);
      const tag = `lane ${lane}: ${r.reason ?? (r.crossed ? 'crossed' : 'short')} at s ${r.endS.toFixed(0)} d ${r.endD.toFixed(0)}, ${r.vMin.toFixed(1)} m/s at least on the bridge, ${r.walls} wall contacts`;
      console.log(`[act2] ch4 viaduct ${tag}`);
      expect(r.reason, tag).toBeNull();
      expect(r.crossed, tag).toBe(true);
      expect(r.walls, tag).toBe(0);
      expect(r.vMin, tag).toBeGreaterThan(17);
    }
  }, 240_000);
});
