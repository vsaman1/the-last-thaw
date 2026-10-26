import { describe, expect, it } from 'vitest';
import type { GameEvent, ObstacleKind, Vec3 } from '../../core/types';
import { ARCADE_MIX, FAMILY_LIMITS, GLOBAL_LIMITS, KIND_SOUNDS, type SessionAudioInfo, type SoundRequest } from '../contract';
import { EVENT_PRIORITY, EventRing } from './eventRing';
import { breakLevelDb, breakM, collisionM, hitLevelDb, hitSound, splashLevelDb, stoneM, tumbleRate } from './magnitude';
import { BREAK_AFTER_HIT_SEC, FrameResolver, TUMBLE_WINDOW_SEC } from './router';
import { RecordingSessionAudio } from './testing/recording';
import { at, body, fakeRuntime, type FakeBody } from './testing/world';

const INFO: SessionAudioInfo = { levelId: 'riverside-town', mode: 'arcade', chapterId: null, attempt: 1, mix: ARCADE_MIX };

function setup(bodies: FakeBody[] = [], settleTails = false) {
  const world = fakeRuntime(bodies);
  const session = new RecordingSessionAudio(1, INFO);
  const ring = new EventRing(world.rt);
  world.rt.events.on(ring.listener);
  const resolver = new FrameResolver(session, { settleTails });
  let frame = 0;
  /** One animation frame: emit, then resolve at game time t. */
  const frameAt = (t: number, events: GameEvent[], wall = -1) => {
    frame++;
    ring.frame = frame;
    session.beginFrame(frame);
    world.setTime(t);
    for (const e of events) world.emit(e);
    return resolver.resolve(ring, t, wall, 0, 0, 0);
  };
  return { world, session, ring, resolver, frameAt };
}

const collision = (id: number, kind: ObstacleKind, impulse: number, relSpeed: number, x: number | Vec3 = 0): GameEvent => ({
  type: 'collision',
  obstacleId: id,
  kind,
  pos: typeof x === 'number' ? at(x) : x,
  relSpeed,
  impulse,
});
const broken = (id: number, kind: ObstacleKind, x = 0): GameEvent => ({ type: 'obstacleBroken', obstacleId: id, kind, pos: at(x) });

describe('every event type has a mapping', () => {
  it('each GameEvent type is either a sound family or "no sound by design"', () => {
    // EVENT_PRIORITY is a Record over GameEvent['type']: the typecheck fails when a type is added.
    const silent = new Set(['airborne', 'complete', 'failed']);
    const { session, frameAt } = setup([body(1, 'house'), body(2, 'pine', { mass: 2 })]);
    const all: GameEvent[] = [
      collision(1, 'house', 160, 15),
      { type: 'treeFelled', obstacleId: 2, pos: at(40) },
      { type: 'splash', pos: at(90), intensity: 0.5 },
      { type: 'airborne', pos: at(0), speed: 10 },
      { type: 'landed', pos: at(0), drop: 3, speed: 10 },
      { type: 'enteredOcean', pos: at(0) },
      { type: 'iceChipped', pos: at(200), amount: 0.05, chunkMass: 1.5 },
      { type: 'absorbed', obstacleId: 9, pos: at(0), mass: 4, newMass: 34 },
      { type: 'complete', stats: {} as never },
      { type: 'failed', reason: 'stuck', stats: {} as never },
    ];
    frameAt(1, all);
    const families = new Set(session.plays.map((p) => p.family));
    for (const f of ['hit', 'tree', 'splash', 'land', 'ocean', 'chip', 'absorb']) expect(families, f).toContain(f);
    for (const t of Object.keys(EVENT_PRIORITY)) {
      if (silent.has(t)) {
        expect(session.traces.some((e) => e.kind === 'event' && e.ev === t && e.note === 'no sound by design'), t).toBe(true);
      }
    }
  });
});

describe('kinds route as KIND_SOUNDS says', () => {
  const kinds = Object.keys(KIND_SOUNDS) as ObstacleKind[];
  it('a firm hit on every kind plays its hit sound (heavy variant where there is one)', () => {
    for (const kind of kinds) {
      const { session, frameAt } = setup([body(1, kind)]);
      frameAt(1, [collision(1, kind, 30, 8)]);
      const main = session.plays[0]?.layers[0].sound;
      if (kind === 'stoneBarrier') continue; // m 0.5 >= 0.45: it scatters (F6)
      expect(main, kind).toBe(KIND_SOUNDS[kind].hit);
    }
  });

  it('every kind that breaks plays its break sound (and its layers); the rest play a hard hit', () => {
    for (const kind of kinds) {
      const { session, frameAt } = setup([body(1, kind, { mass: 12 })]);
      frameAt(1, [kind === 'pine' || kind === 'broadleaf' ? { type: 'treeFelled', obstacleId: 1, pos: at(0) } : broken(1, kind)]);
      const sounds = session.plays[0].layers.map((l) => l.sound);
      const k = KIND_SOUNDS[kind];
      if (k.brk !== null) {
        expect(sounds[0], kind).toBe(k.brk);
        for (const extra of k.brkLayers) expect(sounds, `${kind} ${extra}`).toContain(extra);
      } else {
        expect(sounds[0], kind).toBe(hitSound(kind, breakM(12, 0)));
      }
    }
  });
});

describe('frame rules (DESIGN §6.3)', () => {
  it('F1: the hit and its break are one request: the hit at its level, the break 15 ms later', () => {
    const { session, frameAt } = setup([body(4, 'house', { mass: 12 })]);
    frameAt(2, [collision(4, 'house', 300, 15), broken(4, 'house')]);
    expect(session.plays).toHaveLength(1);
    const req = session.plays[0];
    expect(req.family).toBe('breakStructure');
    expect(req.priority).toBe(0);
    expect(req.key).toBe(4);
    const m = collisionM(300, 15);
    expect(req.layers[0]).toMatchObject({ sound: 'hit.masonry', delaySec: 0 });
    expect(req.layers[0].gainDb).toBeCloseTo(hitLevelDb('hit.masonry', m), 6);
    expect(req.layers[1]).toMatchObject({ sound: 'house.collapse', delaySec: BREAK_AFTER_HIT_SEC });
    expect(req.layers[1].gainDb).toBeCloseTo(breakLevelDb('house.collapse', breakM(12, m)), 6);
    // Arcade: no settle tail.
    expect(req.layers.map((l) => l.sound)).not.toContain('debris.settle');
    expect(session.traces.some((t) => t.kind === 'coalesce' && t.note?.includes('layer 0'))).toBe(true);
  });

  it('F1 in Story: the church nave, its stained glass and the settle tail, at most four layers', () => {
    const { session, frameAt } = setup([body(7, 'church', { mass: 22 })], true);
    frameAt(2, [collision(7, 'church', 900, 20), broken(7, 'church')]);
    const layers = session.plays[0].layers;
    expect(layers.map((l) => l.sound)).toEqual(['hit.masonry', 'masonry.collapse.large', 'glass.break', 'debris.settle']);
    expect(layers[2].optional).toBe(true);
    expect(layers[3].optional).toBe(true);
    expect(layers[3].gainDb).toBeCloseTo(layers[1].gainDb - 14, 6);
  });

  it('F2: three church bodies give one break (mass summed) and at most two add-ons', () => {
    const tower = body(10, 'church', { placement: 44, mass: 30, part: 'churchTower' });
    const front = body(11, 'church', { placement: 44, mass: 22, part: 'church' });
    const back = body(12, 'church', { placement: 44, mass: 22, part: 'church' });
    const { session, frameAt } = setup([tower, front, back]);
    frameAt(1, [broken(11, 'church'), broken(12, 'church')]);
    expect(session.plays).toHaveLength(1);
    expect(session.plays[0].layers[0].gainDb).toBeCloseTo(breakLevelDb('masonry.collapse.large', breakM(44, 0)), 6);
    frameAt(1.3, [broken(10, 'church')]);
    expect(session.plays).toHaveLength(2);
    expect(session.plays[1].layers[0].sound).toBe('masonry.collapse.small');
    expect(session.plays[1].layers[0].gainDb).toBeCloseTo(session.plays[0].layers[0].gainDb - 9, 6);
    // More bodies of the same placement inside the window coalesce once two add-ons have played.
    frameAt(1.4, [broken(11, 'church')]);
    frameAt(1.5, [broken(12, 'church')]);
    expect(session.plays).toHaveLength(3);
    // After the window it is a break of its own again (the tower falling long after the nave).
    frameAt(5, [broken(10, 'church')]);
    expect(session.plays[3].layers[0].sound).toBe('masonry.collapse.large');
  });

  it('F2: dam monoliths coalesce over 2 s', () => {
    const a = body(20, 'dam', { placement: 3, mass: 97 });
    const b = body(21, 'dam', { placement: 3, mass: 97 });
    const { session, frameAt } = setup([a, b]);
    frameAt(1, [broken(20, 'dam')]);
    frameAt(2.8, [broken(21, 'dam')]);
    expect(session.plays.map((p) => p.layers[0].sound)).toEqual(['dam.break', 'masonry.collapse.small']);
    expect(session.plays[0].family).toBe('dam');
  });

  it('F3: a landing and the waterfall it crossed are one plunge', () => {
    const { session, frameAt } = setup();
    frameAt(1, [
      { type: 'landed', pos: at(0), drop: 18, speed: 20 },
      { type: 'waterfallCrossed', index: 0, pos: at(0) },
    ]);
    expect(session.plays).toHaveLength(1);
    expect(session.plays[0].layers[0].sound).toBe('water.plunge');
    expect(session.plays[0].key).toBe(0);
  });

  it('F4: a chip rides on its hit, or is masked under a heavy one', () => {
    const { session, frameAt } = setup([body(1, 'boulder'), body(2, 'boulder')]);
    const p = at(5, 1, 2);
    frameAt(1, [collision(1, 'boulder', 60, 10, p), { type: 'iceChipped', pos: p, amount: 0.05, chunkMass: 1.5 }]);
    expect(session.plays).toHaveLength(1);
    const chip = session.plays[0].layers.find((l) => l.sound === 'ice.chip');
    expect(chip).toMatchObject({ optional: true, delaySec: 0.01 });
    const q = at(9, 1, 2);
    frameAt(2, [collision(2, 'boulder', 1400, 30, q), { type: 'iceChipped', pos: q, amount: 0.2, chunkMass: 6 }]);
    expect(session.plays).toHaveLength(2);
    expect(session.plays[1].layers.some((l) => l.sound === 'ice.chip')).toBe(false);
    expect(session.traces.some((t) => t.reason === 'masked')).toBe(true);
  });

  it('F5: nine splashes in one frame give at most two voices with merged intensity', () => {
    const { session, frameAt } = setup();
    const near = Array.from({ length: 6 }, (_, i): GameEvent => ({ type: 'splash', pos: at(i * 2), intensity: 0.2 }));
    const far = Array.from({ length: 3 }, (_, i): GameEvent => ({ type: 'splash', pos: at(200 + i), intensity: 0.2 }));
    frameAt(1, [...near, ...far]);
    expect(session.plays).toHaveLength(2);
    const merged = (n: number) => 1 - Math.pow(0.8, n);
    const levels = session.plays.map((p) => p.layers[0].gainDb).sort((a, b) => b - a);
    expect(levels[0]).toBeCloseTo(splashLevelDb(merged(6)), 6);
    expect(levels[1]).toBeCloseTo(splashLevelDb(merged(3)), 6);
    // Within 120 ms and 30 m of a splash already heard: merged, not replayed.
    frameAt(1.05, [{ type: 'splash', pos: at(4), intensity: 0.3 }]);
    expect(session.plays).toHaveLength(2);
    frameAt(1.3, [{ type: 'splash', pos: at(4), intensity: 0.3 }]);
    expect(session.plays).toHaveLength(3);
  });

  it('F6: the first hard hit on a stone barrier scatters it (the hit, then the stones breaking apart at their break level)', () => {
    const stones = [body(30, 'stoneBarrier', { placement: 12, mass: 7.5 }), body(31, 'stoneBarrier', { placement: 12, mass: 7.5 })];
    const { session, frameAt } = setup(stones);
    frameAt(1, [collision(30, 'stoneBarrier', 200, 12)]);
    const m = collisionM(200, 12);
    const scatter = session.plays[0];
    expect([scatter.family, scatter.key, scatter.priority]).toEqual(['scatter', 12, 2]);
    expect(scatter.layers.map((l) => l.sound)).toEqual(['hit.stone.heavy', 'weight.thump', 'stone.scatter', 'hit.ice']);
    expect(scatter.layers[0].gainDb).toBeCloseTo(hitLevelDb('hit.stone.heavy', m), 6);
    const main = scatter.layers[2];
    expect(main.gainDb).toBeCloseTo(breakLevelDb('stone.scatter', stoneM(7.5, m)), 6);
    expect(main.delaySec).toBe(BREAK_AFTER_HIT_SEC);
    // Before the playtest of 2026-10-23 the scatter played at the hit's own level: 5 dB quieter here.
    expect(main.gainDb - hitLevelDb('hit.stone.heavy', m)).toBeGreaterThan(4);
    // Within 2 s the barrier neither scatters nor tumbles again: a hard hit on the next stone is a hit.
    frameAt(1.5, [collision(31, 'stoneBarrier', 200, 12)]);
    expect([session.plays[1].family, session.plays[1].layers[0].sound]).toEqual(['hit', 'hit.stone.heavy']);
  });

  it('F6b: a rock or a barrier stone knocked moving tumbles away, once per placement in 1.5 s; a graze is a hit', () => {
    const bodies = [
      body(40, 'rockSmall', { mass: 0.8 }),
      body(41, 'boulder', { mass: 22 }),
      body(42, 'rockCluster', { placement: 7, mass: 2 }),
      body(43, 'rockCluster', { placement: 7, mass: 2 }),
      body(44, 'stoneBarrier', { placement: 9, mass: 7.5 }),
    ];
    const { session, frameAt } = setup(bodies);
    // A small rock knocked at 7 m/s (J 5: 6 m/s for 0.8 t): the hit, then the tumble 15 ms later.
    frameAt(1, [collision(40, 'rockSmall', 5, 7)]);
    const m = collisionM(5, 7);
    const t = session.plays[0];
    expect([t.family, t.priority]).toEqual(['scatter', 2]);
    expect(t.layers.map((l) => l.sound)).toEqual(['hit.stone.light', 'stone.tumble']);
    expect(t.layers[1].gainDb).toBeCloseTo(breakLevelDb('stone.tumble', stoneM(0.8, m)), 6);
    expect(t.layers[1].rate).toBeCloseTo(tumbleRate(0.8), 6);
    expect(t.layers[1].delaySec).toBe(BREAK_AFTER_HIT_SEC);
    // A 22 t boulder nudged (J 10: 0.45 m/s) does not tumble: the hit alone.
    frameAt(2, [collision(41, 'boulder', 10, 2)]);
    expect([session.plays[1].family, session.plays[1].layers[0].sound]).toEqual(['hit', 'hit.stone.heavy']);
    // A cluster tumbles once per window: its second rock within 1.5 s is a hit, after it a tumble again.
    frameAt(3, [collision(42, 'rockCluster', 30, 9)]);
    frameAt(3.5, [collision(43, 'rockCluster', 30, 9)]);
    frameAt(3 + TUMBLE_WINDOW_SEC + 0.1, [collision(43, 'rockCluster', 30, 9)]);
    expect(session.plays.slice(2).map((p) => p.family)).toEqual(['scatter', 'hit', 'scatter']);
    // A barrier stone pushed below the scatter threshold tumbles; a graze (m < 0.2) is only a hit.
    frameAt(6, [collision(44, 'stoneBarrier', 30, 4)]);
    expect(collisionM(30, 4)).toBeLessThan(0.45);
    expect(session.plays[5].layers.map((l) => l.sound)).toContain('stone.tumble');
    frameAt(9, [collision(40, 'rockSmall', 2, 1)]);
    expect(collisionM(2, 1)).toBeLessThan(0.2);
    expect([session.plays[6].family, session.plays[6].layers.length]).toEqual(['hit', 1]);
  });

  it('F6b: at most three stone breaks a second (the family rate), the other rocks keep their plain hits', () => {
    const rocks = Array.from({ length: 10 }, (_, k) => body(70 + k, 'rockSmall', { mass: 0.8 }));
    const { session, frameAt } = setup(rocks);
    for (let k = 0; k < 10; k++) frameAt(1 + 0.05 * k, [collision(70 + k, 'rockSmall', 6, 8)]);
    expect(FAMILY_LIMITS.scatter.ratePerSec).toBe(3);
    expect(session.plays.map((p) => p.family)).toEqual(['scatter', 'scatter', 'scatter', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit']);
    // Every rock was heard: the plain hits carry the rock's own knock.
    for (const p of session.plays.slice(3)) expect(p.layers[0].sound).toBe('hit.stone.light');
    // A second after the first, there is room again.
    frameAt(2, [collision(79, 'rockSmall', 6, 8)]);
    expect(session.plays[10].family).toBe('scatter');
  });

  it('a log pile collapsing is the hit, then the logs knocking and rolling (logs.tumble)', () => {
    const { session, frameAt } = setup([body(60, 'logPile', { mass: 4.4 })]);
    frameAt(1, [collision(60, 'logPile', 40, 9), broken(60, 'logPile')]);
    const req = session.plays[0];
    expect(req.family).toBe('breakLight');
    expect(req.layers.map((l) => l.sound)).toEqual(['hit.wood', 'logs.tumble']);
    expect(req.layers[1].gainDb).toBeCloseTo(breakLevelDb('logs.tumble', breakM(4.4, collisionM(40, 9))), 6);
  });

  it('F7: a felled tree carries its hit; from the third tree within a second only the crack plays', () => {
    const trees = [1, 2, 3, 4].map((id) => body(id, 'pine', { mass: 2 }));
    const { session, frameAt } = setup(trees);
    frameAt(1, [collision(1, 'pine', 40, 12), { type: 'treeFelled', obstacleId: 1, pos: at(0) }]);
    expect(session.plays[0].layers.map((l) => l.sound)).toEqual(['hit.wood', 'tree.fall.pine']);
    frameAt(1.2, [{ type: 'treeFelled', obstacleId: 2, pos: at(0) }]);
    frameAt(1.4, [{ type: 'treeFelled', obstacleId: 3, pos: at(0) }]);
    const third = session.plays[2].layers[0];
    expect(third.sound).toBe('timber.break.light');
    expect(third.gainDb).toBeCloseTo(breakLevelDb('tree.fall.pine', breakM(2, 0)) - 6, 6);
    frameAt(3, [{ type: 'treeFelled', obstacleId: 4, pos: at(0) }]);
    expect(session.plays[3].layers[0].sound).toBe('tree.fall.pine');
  });

  it("F9: a gone body's 'rockSmall' is corrected to the kind seen before", () => {
    const { session, frameAt } = setup([]);
    frameAt(1, [collision(50, 'boulder', 60, 10)]);
    frameAt(2, [collision(50, 'rockSmall', 60, 10)]);
    expect(session.plays.map((p) => p.layers[0].sound)).toEqual(['hit.stone.heavy', 'hit.stone.heavy']);
  });

  it('F11: every event ends in the trace (the engine traces what it plays)', () => {
    const { session, frameAt } = setup([body(1, 'house', { mass: 12 })]);
    frameAt(1, [
      collision(1, 'house', 0.05, 0.1),
      collision(1, 'house', 300, 15),
      broken(1, 'house'),
      { type: 'airborne', pos: at(0), speed: 3 },
      { type: 'landed', pos: at(0), drop: 0.1, speed: 3 },
    ]);
    const events = session.traces.filter((t) => t.kind === 'event');
    expect(events).toHaveLength(5);
    for (const e of events) {
      const ended = session.traces.some((t) => t.cause === e.cause && t.kind !== 'event') || e.note === 'no sound by design';
      expect(ended, `${e.ev} #${e.cause}`).toBe(true);
    }
    expect(session.traces.filter((t) => t.reason === 'quiet')).toHaveLength(2);
  });

  it('a terrain wall hit plays only on frames without a collision or landing', () => {
    const { session, frameAt } = setup([body(1, 'rockMedium')]);
    frameAt(1, [], 0.4);
    frameAt(2, [collision(1, 'rockMedium', 40, 8)], 0.4);
    // The rock is knocked moving (J 40 on 10 t), so its hit tumbles (F6b): a 'scatter' request.
    expect(session.plays.map((p) => p.family)).toEqual(['wallScrape', 'scatter']);
  });

  it('a fastForward burst: the ring keeps 128, requests never exceed four layers, the loudest go first', () => {
    const bodies = Array.from({ length: 300 }, (_, i) => body(i, i % 3 === 0 ? 'house' : 'rockMedium', { mass: 12 }));
    const { session, ring, frameAt } = setup(bodies);
    const events: GameEvent[] = [];
    for (let i = 0; i < 200; i++) events.push(collision(i, bodies[i].kind, 20 + i, 6));
    for (let i = 0; i < 20; i++) events.push(broken(i * 3, 'house'));
    for (let i = 0; i < 40; i++) events.push({ type: 'splash', pos: at(i * 50), intensity: 0.4 });
    let overflow = 0;
    const origClear = ring.clear.bind(ring);
    ring.clear = () => {
      overflow = ring.overflow;
      origClear();
    };
    frameAt(1, events);
    expect(overflow).toBe(260 - GLOBAL_LIMITS.eventRing);
    expect(session.maxAdmittedInFrame).toBeLessThanOrEqual(GLOBAL_LIMITS.maxRequestsPerFrame);
    for (const p of session.plays) expect(p.layers.length).toBeLessThanOrEqual(GLOBAL_LIMITS.maxLayers);
    // Every break was kept by the ring and the admitted four are structural failures.
    const admitted = session.admitted;
    expect(admitted).toHaveLength(4);
    for (const p of admitted) expect(p.priority).toBe(0);
  });

  it('reuses its request objects: nothing is allocated per event', () => {
    const { world, ring } = setup([body(1, 'rockMedium')]);
    const seen: SoundRequest[] = [];
    const spy = new RecordingSessionAudio(2, INFO);
    const play = spy.play.bind(spy);
    spy.play = (req) => {
      seen.push(req);
      return play(req);
    };
    const resolver = new FrameResolver(spy, { settleTails: false });
    for (let f = 1; f <= 5; f++) {
      ring.frame = f;
      world.setTime(f);
      world.emit(collision(1, 'rockMedium', 40, 8));
      resolver.resolve(ring, f);
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(1);
  });
});
