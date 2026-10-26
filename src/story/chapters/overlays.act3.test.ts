/**
 * ACT III overlays (chapters 7–9, "The Reckoning"): the oil field, pipelines, apartment blocks, wells,
 * depots, monuments and the offshore rig the story adds to Ravine Run, Highland Maze and Summit
 * Labyrinth, checked on the STORY level (base level + overlay) and played headless with the real
 * session (Rapier physics, real terrain, water budget and chipping on).
 *
 * Act III's escalation property: on every tested line (the intended line, a lane beside it and the
 * level's alternative routes) the run still reaches the sea AND breaks many built things. Since the
 * second playtest (2026-10-24: "over population of things in levels 7 and 8 that it is impossible to
 * avoid", "level 9 ... half destroyed and abandoned buildings") the worlds are crowded: chapter 7's
 * Calder processing plant stands across the head of the mesa where every way down begins, with well
 * pads, a power line, a hamlet and a terminal below it; chapter 8's glen has cottages, a distillery,
 * tanks and sheds on every way down; chapter 9's village is crowded with ruins. Every line of chapters 7
 * and 9 breaks the chapter's pipeline, chapter 7's every line the plant, chapter 9's every line a
 * wellhead and abandoned houses; in chapter 8 every line breaks the power station. The fewest built
 * structures any tested line breaks: 5 (ch7), 7 (ch8), 8 (ch9). It is still a choice: in each chapter
 * some named landmarks fall on one line and stand on another, and some stand on every natural route
 * (Rig Seven falls only to a deliberate turn at the shore). Measured numbers are recorded in each
 * chapter's OVERLAY comment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autopilotSteer } from '../../core/autopilot';
import { getLevel } from '../../core/levels';
import { trafficLines } from '../../core/obstacles/bridges';
import { buildObstacleSpecs } from '../../core/obstacles/spawn';
import { FIXED_DT, GameSession, getTerrain } from '../../core/session';
import { validateWorldLogic } from '../../core/terrain/logic';
import { parkingAt, roadLineAt } from '../../core/terrain/roads';
import { levelIcebergRadius, placementFootprint, placementSpan, ROAD_VEHICLES, validateLevel } from '../../core/terrain/validate';
import type { CourseCoord } from '../../core/types';
import { attachEventClock, buildRunEvidence } from '../evidence';
import { STRUCTURE_CATEGORY } from '../scoring';
import { evaluateCondition, fallbackReflection, selectFragments } from '../select';
import { chapterBindingIssues, landmarkPlacement, landmarkPlacements, storyLevel } from '../storyLevel';
import { runTestChapter } from '../testkit';
import type { ChapterDef, LandmarkStatus, RunEvidence, StructureCategory } from '../types';
import type { OverlayRequest } from './authoring';
import { CH7, OVERLAY_REQUESTS as REQ7 } from './ch7';
import { CH8, EXTRA_FROM as CH8_EXTRA_FROM, OVERLAY_REQUESTS as REQ8 } from './ch8';
import { CH9, OVERLAY_REQUESTS as REQ9, RUINS_FROM } from './ch9';

const ACT3: readonly { ch: ChapterDef; req: readonly OverlayRequest[] }[] = [
  { ch: CH7, req: REQ7 },
  { ch: CH8, req: REQ8 },
  { ch: CH9, req: REQ9 },
];

/**
 * Story levels may add this many physics bodies to their base level. Act III's crowded worlds (the
 * plant, well pads, power line, hamlet and terminal of chapter 7: +113; chapter 8's cottages,
 * distillery and stations: +71; chapter 9's abandoned village: +83) were measured on the target laptop
 * (Intel Iris Xe, headless Chrome, 1280×720, quality High; render-only ms per frame, story level against
 * the arcade level at about the same spots): chapter 7 −0.5 … +1.4 ms, chapter 8 −0.2 … +0.4 ms,
 * chapter 9 −1.9 … +1.6 ms (ch9.ts has the table).
 */
const BODY_BUDGET = 320;

// ---------------------------------------------------------------------------------------------------
// The alternative routes (copied from the level tests, src/core/levels/*.test.ts)
// ---------------------------------------------------------------------------------------------------

const P = (sd: number[]): CourseCoord[] => Array.from({ length: sd.length / 2 }, (_, i) => ({ s: sd[2 * i], d: sd[2 * i + 1] }));

/** Ravine Run's ranger road and narrows (ravineRun.test.ts). */
const ROAD = P([30, 0, 60, 10, 100, 55, 150, 140, 175, 170, 195, 177, 1150, 177, 1200, 145, 1260, 140, 1330, 140, 1420, 120, 1500, 110]);
const NARROWS = P([
  30, 0, 100, -30, 160, -100, 205, -130, 285, -130, 330, -140, 380, -148, 420, -140, 450, -125, 520, -120, 600, -116,
  650, -115, 700, -121, 760, -138, 860, -141, 900, -138, 930, -133, 977, -131, 1040, -125, 1090, -118, 1135, -116,
  1200, -86, 1214, -85, 1260, -70, 1335, -55, 1420, -30, 1500, -25,
]);
/** Highland Maze's middle and Clachan routes (highlandMaze.test.ts). */
const MIDDLE = P([
  30, 0, 62, 9, 106, 41, 142, 47, 178, 67, 218, 84, 246, 90, 270, 104, 302, 109, 338, 119, 408, 127, 452, 114, 540,
  115, 568, 102, 584, 83, 628, 25, 652, 10, 682, 19, 712, 23, 744, 41, 766, 42, 788, 33, 832, -9, 848, -15, 864, -10,
  880, 6, 904, 16, 950, 18, 988, 25, 1030, 7, 1070, -28, 1110, -60, 1182, -68, 1216, -80, 1250, -84, 1296, -100,
  1392, -100, 1444, -77, 1480, -72, 1514, -58, 1548, -54, 1582, -40, 1620, -28, 1660, -20, 1724, -25, 1800, -20,
]);
const CLACHAN = P([
  30, 0, 62, 9, 106, 41, 142, 47, 178, 67, 218, 84, 246, 90, 270, 104, 302, 109, 338, 119, 372, 121, 405, 126, 452,
  114, 540, 116, 570, 110, 605, 105, 640, 108, 668, 116, 692, 122, 720, 116, 760, 110, 800, 110, 856, 116, 890, 119,
  918, 112, 956, 110, 1000, 108, 1040, 108, 1074, 112, 1114, 101, 1170, 97, 1228, 67, 1254, 60, 1284, 64, 1366, 64,
  1408, 56, 1442, 63, 1480, 72, 1512, 56, 1534, 47, 1600, 47, 1640, 29, 1682, 25, 1718, 15, 1800, 0,
]);
/** Summit Labyrinth's right-hand route (summitLabyrinth.test.ts), and the same bent into Rig Seven. */
const RIGHT_TO_SHORE = [
  30, 0, 115, 62, 150, 88, 205, 95, 300, 95, 345, 92, 395, 104, 412, 110, 434.5, 110, 470, 110, 560, 120, 640, 125,
  700, 115, 760, 112, 800, 119, 840, 119, 870, 116, 920, 95, 990, 75, 1060, 72, 1080, 68, 1190, 62, 1250, 62, 1400,
  40, 1500, 40, 1740, 0,
];
const RIGHT = P([...RIGHT_TO_SHORE, 1830, 0, 2000, 0]);
const RIGHT_RIG = P([...RIGHT_TO_SHORE, 1780, 12, 1820, 38, 1850, 40, 2000, 40]);

// ---------------------------------------------------------------------------------------------------
// Playing a chapter headless
// ---------------------------------------------------------------------------------------------------

interface Played {
  ev: RunEvidence;
  /** Built (non-nature) structures destroyed. */
  built: number;
  status: (landmark: string) => LandmarkStatus | undefined;
}

function summarise(session: GameSession, ch: ChapterDef, clock: ReturnType<typeof attachEventClock>): Played {
  const ev = buildRunEvidence({ session, chapter: ch, level: storyLevel(ch), clock });
  const built = Object.entries(ev.destroyedByCategory)
    .filter(([cat]) => (cat as StructureCategory) !== 'nature')
    .reduce((n, [, v]) => n + (v ?? 0), 0);
  return { ev, built, status: (id) => ev.landmarks.find((l) => l.id === id)?.status };
}

/**
 * The autopilot on the level line, offset by `lane` metres (src/story/testkit.ts); with `untilS`, only
 * until that course s, then back on the line (a wide swerve at the top).
 */
async function playLane(ch: ChapterDef, lane = 0, untilS = Infinity): Promise<Played> {
  const { session, clock } = await runTestChapter((s) => (s < untilS ? lane : 0), 260, ch);
  const out = summarise(session, ch, clock);
  session.dispose();
  return out;
}

/**
 * A player at the keys at the start: the steering held at `steer` for `hold` seconds, then let go until
 * `lineFrom` seconds, then the autopilot back on the level line.
 */
async function playEarlySteer(ch: ChapterDef, steer: number, hold: number, lineFrom: number): Promise<Played> {
  const level = storyLevel(ch);
  const session = await GameSession.create({ level, skipIntro: true });
  const clock = attachEventClock(session);
  for (let i = 0; i < 260 / FIXED_DT && session.phase === 'playing'; i++) {
    const t = i * FIXED_DT;
    const input =
      t < hold
        ? { steer, source: 'keyboard' as const }
        : t < lineFrom
          ? { steer: 0, source: 'keyboard' as const }
          : autopilotSteer(session.iceberg, session.terrain);
    session.update(FIXED_DT, input);
  }
  const out = summarise(session, ch, clock);
  session.dispose();
  return out;
}

/** The autopilot pursuing another line on the same story level (as the level tests do). */
async function playLine(ch: ChapterDef, line: CourseCoord[]): Promise<Played> {
  const level = storyLevel(ch);
  const terrain = getTerrain(level);
  const steerOn = { ...terrain, level: { ...level, line } };
  const session = await GameSession.create({ level, skipIntro: true, terrain });
  const clock = attachEventClock(session);
  for (let i = 0; i < 260 / FIXED_DT && session.phase === 'playing'; i++) {
    session.update(FIXED_DT, autopilotSteer(session.iceberg, steerOn));
  }
  const out = summarise(session, ch, clock);
  session.dispose();
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Static checks
// ---------------------------------------------------------------------------------------------------

describe('act III overlays: bindings and the story levels', () => {
  it('places exactly the requested kinds, in request order, and adds no terrain but gravel roads in chapters 8 and 9', () => {
    for (const { ch, req } of ACT3) {
      expect(ch.overlay.obstacles.map((o) => o.kind), ch.id).toEqual(req.map((r) => r.kind));
    }
    expect(CH7.overlay.features ?? []).toEqual([]);
    // Chapter 9's old farm tracks up the valley and on the upper terrace (its ruins stand within 60 m of
    // a road): gravel, each from a turning place to a trailhead.
    const tracks = CH9.overlay.features ?? [];
    expect(tracks.length).toBeGreaterThanOrEqual(4);
    for (const f of tracks) expect(f.type === 'road' && f.surface === 'gravel', JSON.stringify(f)).toBe(true);
    // Chapter 8's two gravel roads down the braes below the power station and its crofting tracks left of
    // the line (its cottages stand on them): gravel, clear of every route's path (validated below).
    const ch8Roads = CH8.overlay.features ?? [];
    expect(ch8Roads.length).toBeGreaterThanOrEqual(2);
    for (const f of ch8Roads) expect(f.type === 'road' && f.surface === 'gravel', JSON.stringify(f)).toBe(true);
  });

  it('builds chapter 9\'s abandoned village from ruined houses, chalets and barns, crowding the terrace and the way down to it', () => {
    const ruins = CH9.overlay.obstacles.slice(RUINS_FROM);
    for (const r of ruins) {
      expect(['house', 'chalet', 'barn']).toContain(r.kind);
      expect(r.variant).toBe('ruined');
      expect(r.s).toBeGreaterThan(280);
      expect(r.s).toBeLessThan(1715);
    }
    // Playtest 2 ("very overcrowded ... half destroyed and abandoned buildings"): the village terrace
    // (s 1262-1715) packed with ruins, and the farms given up along the way down to it.
    const terrace = ruins.filter((r) => r.s >= 1262);
    expect(terrace.length).toBeGreaterThanOrEqual(150);
    expect(ruins.length - terrace.length).toBeGreaterThanOrEqual(40);
    // Only the ruins take the look; the placements before them are the first overlay's.
    expect(CH9.overlay.obstacles.slice(0, RUINS_FROM).some((o) => o.variant)).toBe(false);
    // Both sides of the village and the strip between the routes: crowded everywhere.
    expect(ruins.filter((r) => r.d < -90).length).toBeGreaterThanOrEqual(4);
    expect(ruins.filter((r) => r.d > 45).length).toBeGreaterThanOrEqual(4);
    expect(ruins.filter((r) => r.d > -70 && r.d < -50).length).toBeGreaterThanOrEqual(5);
  });

  it('stands chapter 7\'s processing plant across the head of the mesa, no gap an iceberg passes', () => {
    const lm = CH7.landmarks.find((l) => l.id === 'mesa-plant');
    expect(lm).toBeDefined();
    if (!lm) return;
    const obstacles = storyLevel(CH7).obstacles;
    const tanks = landmarkPlacements(CH7, lm).map((p) => obstacles[p]);
    expect(tanks.every((t) => t.kind === 'tank' && t.s === tanks[0].s)).toBe(true);
    // Every way down passes s 55 within d −12 … +12 (the line −0.5, the narrows −10, the road +10).
    const ds = tanks.map((t) => t.d).sort((a, b) => a - b);
    expect(ds[0]).toBeLessThanOrEqual(-12);
    expect(ds[ds.length - 1]).toBeGreaterThanOrEqual(12);
    const level = storyLevel(CH7);
    const terrain = getTerrain(level);
    const specs = buildObstacleSpecs(terrain, level.seed);
    const radius = (i: number): number => specs.find((s) => s.placement === landmarkPlacements(CH7, lm)[i])?.trunkRadius ?? 0;
    const iceberg = 2 * levelIcebergRadius(terrain);
    for (let i = 1; i < ds.length; i++) {
      // The proxies are circles of the shell's radius: the gap between neighbours is narrower than the iceberg.
      expect(ds[i] - ds[i - 1] - radius(i) - radius(i - 1)).toBeLessThan(iceberg);
    }
  });

  it('binds every requested landmark to its overlay placement, with the requested name and label', () => {
    for (const { ch, req } of ACT3) {
      expect(chapterBindingIssues(ch), ch.id).toEqual([]);
      const obstacles = storyLevel(ch).obstacles;
      req.forEach((r, i) => {
        if (!r.landmark) return;
        const lm = ch.landmarks.find((l) => l.id === r.landmark?.id);
        expect(lm, `${ch.id}: ${r.landmark.id}`).toBeDefined();
        if (!lm) return;
        // The landmark points at the requested placement (a well field also holds its other wells).
        expect({ source: lm.bind.source, index: lm.bind.index }).toEqual({ source: 'overlay', index: i });
        expect(lm.name).toBe(r.landmark.name);
        expect(lm.label).toBe(r.landmark.label);
        expect(obstacles[landmarkPlacement(ch, lm)].kind).toBe(r.kind);
        expect(lm.category).toBe(STRUCTURE_CATEGORY[r.kind as keyof typeof STRUCTURE_CATEGORY]);
        expect(lm.bibleRefs.length).toBeGreaterThan(0);
      });
    }
  });

  it('validates each story level: placements, features, line, routes and world logic', () => {
    for (const { ch } of ACT3) {
      const terrain = getTerrain(storyLevel(ch));
      expect(validateLevel(terrain), ch.id).toEqual([]);
      expect(validateWorldLogic(terrain), ch.id).toEqual([]);
    }
    // Three whole story levels validated in one test: on a loaded machine (two workflows and the full
    // suite at once, 2026-10-23) it took 30.5 s against the 30 s default; alone it passes well inside.
  }, 120_000);

  it('keeps buildings, monuments, wells and tanks off the paved strips, and pipelines across no road', () => {
    // validateLevel puts vehicles on roads but does not keep other kinds off them.
    for (const { ch } of ACT3) {
      const level = storyLevel(ch);
      const terrain = getTerrain(level);
      const lines = trafficLines(terrain);
      for (const p of ch.overlay.obstacles) {
        if (ROAD_VEHICLES.includes(p.kind)) continue;
        const span = placementSpan(terrain, p);
        const pts: CourseCoord[] = [];
        if (span > 0) {
          const yaw = p.yaw ?? 0;
          for (let t = -span / 2; t <= span / 2; t += 1) pts.push({ s: p.s + t * Math.sin(yaw), d: p.d + t * Math.cos(yaw) });
        } else pts.push({ s: p.s, d: p.d });
        const margin = span > 0 ? 0.5 : placementFootprint(p);
        const where = `${ch.id}: ${p.kind} at s ${p.s} d ${p.d}`;
        expect(pts.some((q) => roadLineAt(lines, q.s, q.d, margin) >= 0), where).toBe(false);
        expect(pts.some((q) => parkingAt(level, q.s, q.d, margin) >= 0), where).toBe(false);
      }
    }
  });

  it(`keeps the body count within ${BODY_BUDGET} of the base level`, () => {
    for (const { ch } of ACT3) {
      const base = getLevel(ch.levelId);
      const level = storyLevel(ch);
      const specs = buildObstacleSpecs(getTerrain(level), level.seed);
      const baseSpecs = buildObstacleSpecs(getTerrain(base), base.seed);
      expect(specs.length - baseSpecs.length, ch.id).toBeLessThanOrEqual(BODY_BUDGET);
      ch.overlay.obstacles.forEach((_, i) => {
        expect(specs.some((s) => s.placement === base.obstacles.length + i), `${ch.id} overlay ${i}`).toBe(true);
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Playtests
// ---------------------------------------------------------------------------------------------------

const runs: Record<string, Played> = {};
/**
 * Chapter 8 lanes played only for the power station and the glen pipeline (lanes 0 and ±8 are played
 * anyway): 1 m steps from −12 to −8, where the iceberg arrives at the pipeline with the least ice (review
 * of 2026-10-24: lanes −10 and −11 stuck there, on the 4 m grid nobody had looked).
 */
const STATION_SWEEP = [-12, -11, -10, -9, -4, 4, 12, 16] as const;
/**
 * Chapter 8's hard swerves round the ends of the station's row: the keeper's workshop closes the left
 * end, the valve house and the store the right. They still fail further down, as they did before the
 * station.
 */
const STATION_SWERVES = [-24, 24, 40, 60] as const;
/**
 * Chapter 8: a player who steers at the start (review of 2026-10-24: with the station's four 0.45 halls
 * these came to rest against a standing hall and failed 'stuck'): the steering held, let go, and the
 * autopilot back on the line from `lineFrom` seconds.
 */
const EARLY_STEERS = [
  { name: 'hold right 0.8 s', steer: 1, hold: 0.8, lineFrom: 0.8 },
  { name: 'hold left 1.6 s', steer: -1, hold: 1.6, lineFrom: 1.6 },
  // Breaks the transformer house at 4.6 m/s, then stops at s 58.5 (with no station it gets going again
  // from 2.6 m/s at s 60; a 0.8 s tap stops at s 56 even then).
  { name: 'tap right 0.7 s', steer: 1, hold: 0.7, lineFrom: 3.5 },
  // Held right this long the iceberg stops on the open slope at s 47.6 even with no station there; it
  // breaks the hall it reaches first.
  { name: 'hold right 1.5 s', steer: 1, hold: 1.5, lineFrom: 1.5 },
] as const;
/** The course s of the iceberg's centre as it touches the front of the station's row (less a 0.6 m margin). */
const STATION_REACH =
  Math.min(...CH8.overlay.obstacles.slice(7, CH8_EXTRA_FROM).map((o) => o.s - 9 * (o.scale ?? 1))) - 3.5;
/**
 * The course s of the iceberg's centre as it touches the front of chapter 7's processing plant (its tanks
 * at s 55, shells of radius 2.2 m; the iceberg 2.2 m) less a 0.6 m margin.
 */
const PLANT_REACH = 55 - 2.2 - 2.2 - 0.6;
/** ... and as it leaves the back of the row (plus the same margin). */
const PLANT_PAST = 55 + 2.2 + 2.2 + 0.6;
/**
 * Chapter 7: the players who steer at the start (the same four plans as chapter 8's), and the wide
 * lanes that crawl across the top of the mesa at 2 m/s (they fail further down, as they did before the
 * plant: stuck on the slope or fallen into the First Cut).
 */
const PLANT_STEERS = EARLY_STEERS;
const PLANT_WIDE = [
  { name: 'lane -40', lane: -40, untilS: Infinity },
  { name: 'lane +48', lane: 48, untilS: Infinity },
  { name: 'swerve -50 until s 90', lane: -50, untilS: 90 },
] as const;
const LINES: Record<string, readonly string[]> = {
  ch7: ['ch7 line', 'ch7 lane -4', 'ch7 narrows', 'ch7 road'],
  ch8: ['ch8 line', 'ch8 lane +8', 'ch8 middle', 'ch8 clachan'],
  ch9: ['ch9 line', 'ch9 lane +2', 'ch9 right', 'ch9 right-rig'],
};
/**
 * Chapter 9: riding 10-20 m off the line through the village (review of 2026-10-24: -20 m once met one
 * ruin): on the line until s 1300, eased onto the offset by s 1330, held to s 1710, then back.
 */
const VILLAGE_SHIFTS = [-20, -10, 10, 20] as const;
/**
 * Chapter 9 lanes right of the line played in both modes (round 2 review: lanes +3 and +3.5 failed
 * 'stuck' at the chapel, 87 %, where Arcade finishes them). Rule: every lane that finishes in Arcade
 * finishes in Story.
 */
const CH9_LANES = [3, 3.5] as const;
/** Phases of the CH9_LANES on the arcade level (the base level, no overlay). */
const arcadePhase: Record<string, string> = {};

/** The autopilot on the arcade level's line, offset by `lane` metres: the phase the run ends in. */
async function playArcadeLane(ch: ChapterDef, lane: number): Promise<string> {
  const session = await GameSession.create({ level: getLevel(ch.levelId), skipIntro: true });
  for (let i = 0; i < 260 / FIXED_DT && session.phase === 'playing'; i++) {
    session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, { lane }));
  }
  const phase = session.phase;
  session.dispose();
  return phase;
}
const villageShift =
  (k: number) =>
  (s: number): number =>
    s >= 1330 && s <= 1710 ? k : s > 1300 && s < 1330 ? (k * (s - 1300)) / 30 : s > 1710 && s < 1740 ? (k * (1740 - s)) / 30 : 0;

beforeAll(async () => {
  runs['ch7 line'] = await playLane(CH7);
  runs['ch7 lane -4'] = await playLane(CH7, -4);
  runs['ch7 narrows'] = await playLine(CH7, NARROWS);
  runs['ch7 road'] = await playLine(CH7, ROAD);
  runs['ch7 lane +4'] = await playLane(CH7, 4);
  for (const e of PLANT_STEERS) runs[`ch7 ${e.name}`] = await playEarlySteer(CH7, e.steer, e.hold, e.lineFrom);
  for (const w of PLANT_WIDE) runs[`ch7 ${w.name}`] = await playLane(CH7, w.lane, w.untilS);
  runs['ch8 line'] = await playLane(CH8);
  runs['ch8 lane +8'] = await playLane(CH8, 8);
  runs['ch8 middle'] = await playLine(CH8, MIDDLE);
  runs['ch8 clachan'] = await playLine(CH8, CLACHAN);
  // Not a tested line of the escalation property: the measured lane (eight trees, a fence and the power
  // station) whose felled trees once read "a great deal of the Clachan went".
  runs['ch8 lane -8'] = await playLane(CH8, -8);
  // The power station's sweep: with lanes 0, ±8 and the two routes, lanes from −12 to +16 m.
  for (const lane of [...STATION_SWEEP, ...STATION_SWERVES]) {
    runs[`ch8 lane ${lane > 0 ? '+' : ''}${lane}`] = await playLane(CH8, lane);
  }
  for (const e of EARLY_STEERS) runs[`ch8 ${e.name}`] = await playEarlySteer(CH8, e.steer, e.hold, e.lineFrom);
  runs['ch9 line'] = await playLane(CH9);
  runs['ch9 lane +2'] = await playLane(CH9, 2);
  for (const lane of CH9_LANES) {
    runs[`ch9 lane +${lane}`] = await playLane(CH9, lane);
    arcadePhase[`ch9 lane +${lane}`] = await playArcadeLane(CH9, lane);
  }
  runs['ch9 right'] = await playLine(CH9, RIGHT);
  runs['ch9 right-rig'] = await playLine(CH9, RIGHT_RIG);
  for (const k of VILLAGE_SHIFTS) {
    const { session, clock } = await runTestChapter(villageShift(k), 260, CH9);
    runs[`ch9 village ${k > 0 ? '+' : ''}${k}`] = summarise(session, CH9, clock);
    session.dispose();
  }
}, 2_400_000);

afterAll(() => {
  for (const k of Object.keys(runs)) delete runs[k];
  for (const k of Object.keys(arcadePhase)) delete arcadePhase[k];
});

const tell = (p: Played): string =>
  `${p.ev.outcome}${p.ev.failReason ? ` (${p.ev.failReason})` : ''} at s ${p.ev.reachedS.toFixed(0)}, ` +
  `${JSON.stringify(p.ev.destroyedByKind)}`;

describe('act III overlays: played headless on the story levels', () => {
  it('every chapter is finishable on every tested line, with the overlay in place', () => {
    for (const k of Object.values(LINES).flat()) {
      expect(runs[k].ev.outcome, `${k}: ${tell(runs[k])}`).toBe('complete');
      expect(runs[k].ev.iceLeft, k).toBeGreaterThan(0.05);
    }
    // Lane −8 too, one of the lanes with the least ice at the glen pipeline (they pass its left end: ch8.ts).
    expect(runs['ch8 lane -8'].ev.outcome, tell(runs['ch8 lane -8'])).toBe('complete');
  });

  it('the reckoning: every tested line breaks many built things (at least 5 / 7 / 8 per chapter)', () => {
    const least: Record<string, number> = { ch7: 5, ch8: 7, ch9: 8 };
    for (const [ch, keys] of Object.entries(LINES)) {
      for (const k of keys) expect(runs[k].built, `${k}: ${tell(runs[k])}`).toBeGreaterThanOrEqual(least[ch]);
    }
    // The pipelines lie across every route of chapters 7 and 9; chapter 9's wellheads too. Chapter 7's
    // processing plant stands across the head of the mesa, where every way down begins; chapter 9's
    // abandoned houses crowd every way through the village (the base level has no houses there: every
    // house broken is a ruin).
    for (const k of LINES.ch7) {
      expect(runs[k].status('mesa-pipeline'), k).toBe('destroyed');
      expect(runs[k].status('mesa-plant'), `${k}: ${tell(runs[k])}`).toBe('destroyed');
    }
    for (const k of LINES.ch9) {
      expect(runs[k].status('landfall-pipeline'), k).toBe('destroyed');
      expect(runs[k].ev.destroyedByKind.pumpjack, k).toBeGreaterThanOrEqual(1);
      expect(runs[k].status('abandoned-houses'), k).toBe('destroyed');
      expect(runs[k].ev.destroyedByKind.house, `${k}: ${tell(runs[k])}`).toBeGreaterThanOrEqual(4);
    }
    // Chapter 8's power station stands at the head of the glen, where every route down begins: every
    // line breaks it, and so does lane −8 (one or two of its six small halls; none is stopped by them).
    for (const k of [...LINES.ch8, 'ch8 lane -8']) {
      expect(runs[k].status('clachan-station'), `${k}: ${tell(runs[k])}`).toBe('destroyed');
      expect(runs[k].ev.destroyedByKind.factoryHall, k).toBeGreaterThanOrEqual(1);
    }
    // The glen pipeline catches every route but the Clachan, which breaks its own farms.
    for (const k of ['ch8 line', 'ch8 lane +8', 'ch8 middle']) expect(runs[k].status('glen-pipeline'), k).toBe('destroyed');
    expect(runs['ch8 clachan'].ev.destroyedByCategory.home, tell(runs['ch8 clachan'])).toBeGreaterThanOrEqual(2);
  });

  it('chapter 9: riding 10-20 m off the line through the village still meets at least four ruined houses', () => {
    for (const k of VILLAGE_SHIFTS) {
      const key = `ch9 village ${k > 0 ? '+' : ''}${k}`;
      expect(runs[key].ev.outcome, `${key}: ${tell(runs[key])}`).toBe('complete');
      expect(runs[key].ev.destroyedByKind.house, `${key}: ${tell(runs[key])}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('chapter 9: lanes +3 and +3.5 get past the chapel to the sea, as they do in Arcade', () => {
    for (const lane of CH9_LANES) {
      const key = `ch9 lane +${lane}`;
      // The rule is not empty: both lanes finish in Arcade (measured 2026-10-25).
      expect(arcadePhase[key], `${key} in Arcade`).toBe('complete');
      expect(runs[key].ev.outcome, `${key}: ${tell(runs[key])}`).toBe('complete');
    }
  });

  it('chapter 7: every run that reaches the sea breaks the processing plant and at least four other built things', () => {
    const reached = ['ch7 line', 'ch7 lane -4', 'ch7 lane +4', 'ch7 narrows', 'ch7 road', ...PLANT_STEERS.map((e) => `ch7 ${e.name}`)];
    for (const k of reached) {
      expect(runs[k].ev.outcome, `${k}: ${tell(runs[k])}`).toBe('complete');
      expect(runs[k].status('mesa-plant'), `${k}: ${tell(runs[k])}`).toBe('destroyed');
      expect(runs[k].built, `${k}: ${tell(runs[k])}`).toBeGreaterThanOrEqual(5);
    }
    expect(runs['ch7 lane +4'].ev.iceLeft).toBeGreaterThan(0.05);
  });

  it('chapter 7: steering at the start or crawling wide never leaves the iceberg resting against the standing plant', () => {
    // The plant's four tanks break from 3.6 m/s for the 30 t iceberg; the row spans only d −14 … +14, so
    // the wide lanes that crawl across the top at 2 m/s pass beside it and fail where they failed before.
    for (const k of [...PLANT_STEERS.map((e) => `ch7 ${e.name}`), ...PLANT_WIDE.map((w) => `ch7 ${w.name}`)]) {
      const p = runs[k];
      // At rest against the row: stuck with the plant standing, between touching its front and its back.
      const restsAgainstIt =
        p.ev.outcome === 'failed' &&
        p.ev.failReason === 'stuck' &&
        p.status('mesa-plant') === 'intact' &&
        p.ev.reachedS >= PLANT_REACH &&
        p.ev.reachedS <= PLANT_PAST;
      expect(restsAgainstIt, `${k}: ${tell(p)}`).toBe(false);
    }
    for (const w of PLANT_WIDE) expect(runs[`ch7 ${w.name}`].ev.reachedS, w.name).toBeGreaterThan(120);
  });

  it('chapter 8: every lane from −12 to +16 m gets down the glen, none without breaking the power station and four more built things', () => {
    // The station stands across the head of the glen, where every way down from the ice begins (the
    // lanes beyond these leave the line and fail: they fall at the Leap or stick, see ch8.ts). Lanes −12
    // to −9 reach the glen pipeline with the least ice and pass round its left end.
    const lanes = ['ch8 lane -12', 'ch8 lane -11', 'ch8 lane -10', 'ch8 lane -9', 'ch8 lane -8', 'ch8 lane -4', 'ch8 line', 'ch8 lane +4', 'ch8 lane +8', 'ch8 lane +12', 'ch8 lane +16'];
    for (const k of [...lanes, 'ch8 middle', 'ch8 clachan']) {
      expect(runs[k].ev.outcome, `${k}: ${tell(runs[k])}`).toBe('complete');
      expect(runs[k].status('clachan-station'), `${k}: ${tell(runs[k])}`).toBe('destroyed');
      // The crowded glen: cottages, the distillery, tanks, sheds and pylons on every way down.
      expect(runs[k].built, `${k}: ${tell(runs[k])}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('chapter 8: steering at the start never leaves the iceberg stuck against the standing power station', () => {
    // A steer at the start that reaches the row meets it fast enough to break a hall (small halls: one
    // breaks from 1.35 m/s for the 60 t iceberg, less with a scrape), so it does not come to rest against
    // a standing station (the sweep of ch8.ts found one extreme lane that does: see there).
    for (const e of EARLY_STEERS) {
      const p = runs[`ch8 ${e.name}`];
      const restsAgainstIt =
        p.ev.outcome === 'failed' && p.ev.failReason === 'stuck' && p.status('clachan-station') === 'intact' && p.ev.reachedS >= STATION_REACH;
      expect(restsAgainstIt, `${e.name}: ${tell(p)}`).toBe(false);
    }
    // Every one of them breaks the station; held right 0.8 s or left 1.6 s the iceberg reaches the sea.
    for (const e of EARLY_STEERS) {
      const p = runs[`ch8 ${e.name}`];
      expect(p.status('clachan-station'), `${e.name}: ${tell(p)}`).toBe('destroyed');
    }
    for (const name of ['hold right 0.8 s', 'hold left 1.6 s']) {
      expect(runs[`ch8 ${name}`].ev.outcome, `${name}: ${tell(runs[`ch8 ${name}`])}`).toBe('complete');
    }
  });

  it('chapter 8: a hard swerve round either end of the station breaks its end buildings', () => {
    // The keeper's workshop closes the left end of the row, the valve house and the store the right (see ch8.ts).
    for (const lane of STATION_SWERVES) {
      const k = `ch8 lane ${lane > 0 ? '+' : ''}${lane}`;
      expect(runs[k].status('clachan-station'), `${k}: ${tell(runs[k])}`).toBe('destroyed');
      expect(runs[k].ev.destroyedByKind.factoryHall, k).toBeGreaterThanOrEqual(1);
    }
  });

  it('you can still decide: named landmarks fall on one line and stand on another', () => {
    const choices: [string, string, string][] = [
      // [landmark, a line that breaks it, a line that leaves it standing]
      ['mesa-wells', 'ch7 narrows', 'ch7 line'],
      ['ranger-tank', 'ch7 line', 'ch7 lane -4'],
      ['bothy', 'ch8 line', 'ch8 middle'],
      ['glen-pipeline', 'ch8 middle', 'ch8 clachan'],
      ['achadh', 'ch8 clachan', 'ch8 line'],
      ['upper-dam', 'ch9 line', 'ch9 right'],
      ['rig-seven', 'ch9 right-rig', 'ch9 right'],
    ];
    for (const [id, breaks, spares] of choices) {
      expect(runs[breaks].status(id), `${id} on ${breaks}`).toBe('destroyed');
      expect(runs[spares].status(id), `${id} on ${spares}`).toBe('intact');
    }
  });

  it('and some named structures stand on every natural route', () => {
    const standing: Record<string, readonly string[]> = {
      ch7: ['field-hostel', 'rope-bridge'],
      ch8: ['lochside-flats', 'market-cross', 'loch-kirk'],
      ch9: ['summit-apartments', 'thaw-stone', 'lind-chalet'],
    };
    for (const [ch, ids] of Object.entries(standing)) {
      for (const k of LINES[ch]) for (const id of ids) expect(runs[k].status(id), `${id} on ${k}`).toBe('intact');
    }
    for (const k of ['ch9 line', 'ch9 lane +2', 'ch9 right']) expect(runs[k].status('rig-seven'), k).toBe('intact');
  });

  it('chapter 8 speaks of Clachan losses on the runs that broke the Clachan, and of the dark glen on the others', () => {
    const read = (k: string): { reflection: string; shown: string[]; first: string[] } => ({
      reflection: fallbackReflection(CH8, runs[k].ev).fragmentIds[0],
      shown: selectFragments(CH8, runs[k].ev, [], 12).map((f) => f.id),
      first: selectFragments(CH8, runs[k].ev).map((f) => f.id),
    });
    // "A great deal of the Clachan went": three or more of its homes, farm buildings and shared places
    // (CLACHAN_LOST in ch8.ts). With the glen crowded, the line and the Clachan route both get there; the
    // lanes right of the line (power station halls, tanks, sheds: industry) leave the glen dark instead.
    const clachanLost = (k: string): boolean =>
      (['home', 'farm', 'community'] as const).reduce((n, c) => n + (runs[k].ev.destroyedByCategory[c] ?? 0), 0) >= 3;
    const keys = [...LINES.ch8, 'ch8 lane -8', ...STATION_SWEEP.map((l) => `ch8 lane ${l > 0 ? '+' : ''}${l}`)];
    for (const k of keys) {
      const lost = clachanLost(k);
      expect(read(k).reflection, `${k}: ${tell(runs[k])}`).toBe(lost ? 'ch8-reflection-much-lost' : 'ch8-reflection-dark');
      if (lost) expect(read(k).shown, k).toContain('ch8-two-columns');
      else expect(read(k).shown, k).not.toContain('ch8-two-columns');
    }
    expect(clachanLost('ch8 clachan'), tell(runs['ch8 clachan'])).toBe(true);
    expect(keys.some((k) => !clachanLost(k))).toBe(true);
    // Every line shows what the station was and the morning it was shut down, first.
    for (const k of LINES.ch8) expect(read(k).first.slice(0, 2), k).toEqual(['ch8-station-notice', 'ch8-station-log']);
    // Lane −8 fells trees and leaves Achadh standing: its letter, not a loss.
    expect(runs['ch8 lane -8'].ev.destroyedByCategory.nature ?? 0, tell(runs['ch8 lane -8'])).toBeGreaterThan(0);
    expect(read('ch8 lane -8').shown).toContain('ch8-achadh-letter');
  });

  it('Rig Seven\'s shutdown log is found only when the rig is broken', () => {
    const log = CH9.fragments.find((f) => f.id === 'ch9-rig-shutdown');
    expect(log).toBeDefined();
    if (!log) return;
    expect(evaluateCondition(log.when, runs['ch9 right-rig'].ev, [])).toBe(true);
    for (const k of ['ch9 line', 'ch9 lane +2', 'ch9 right']) expect(evaluateCondition(log.when, runs[k].ev, []), k).toBe(false);
  });
});
