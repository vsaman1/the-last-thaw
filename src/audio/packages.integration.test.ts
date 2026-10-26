/**
 * The three sound packages together, headless (DESIGN §9 integration): package A's WebAudioManager on
 * the recording fake AudioContext, package B's real synthesis (the bank baked synchronously, the
 * noise bank, the live ambience voices, the space IR) and package C's bridge on a real GameSession
 * (Rapier, terrain, river, water) on autopilot. What it shows: real baked buffers reach the engine's
 * strips, B's voices are built on per-session gains and fed by C's inputs, the church rings, every
 * event of the run is accounted for, the hits' levels follow the impact, end() leaves nothing
 * running, and the game comes out bit-identical to a run with no sound at all.
 */
import { describe, expect, it } from 'vitest';
import { autopilotSteer } from '../core/autopilot';
import { getLevel } from '../core/levels';
import { FIXED_DT, GameSession } from '../core/session';
import { CHAPTERS } from '../story/chapters';
import { AUDIO_LEVEL_IDS, BANK_BUDGET_BYTES, type TraceEntry } from './contract';
import { levelSoundSet } from './game/levelSet';
import { SessionBridge } from './game/sessionBridge';
import { fingerprint, runHeadless, trailingCamera } from './game/testing/headless';
import { WebAudioManager } from './manager';
import type { MusicPlayer } from './music';
import { coreBytes, levelSetBytes } from './synth/bank';
import { SYNTHESIS } from './synthesis';
import { createFakeAudioContext, type FakeHandle } from './testing/fakeAudioContext';
import { ManualTicker } from './testing/manualTicker';
import { ManualTimers } from './testing/manualTimers';
import { hit } from './testing/requests';
import { syncScheduler } from './testing/toneBank';

const SECONDS = 40;
const MiB = 1024 * 1024;

const quietPlayer: MusicPlayer = { play: () => {}, setVolume: () => {}, setMuted: () => {}, unlock: () => {} };

/** Spearman's rank correlation (average ranks for ties). */
function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (v: readonly number[]): number[] => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (ra.length - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - mean) * (rb[i] - mean);
    da += (ra[i] - mean) ** 2;
    db += (rb[i] - mean) ** 2;
  }
  return num / Math.sqrt(da * db);
}

function engine() {
  let handle: FakeHandle | null = null;
  const timers = new ManualTimers();
  const ticker = new ManualTicker();
  const busTicker = new ManualTicker();
  const target = new EventTarget();
  const m = new WebAudioManager({
    synthesis: SYNTHESIS,
    player: quietPlayer,
    ticker,
    busTicker,
    timers,
    target,
    hasActivation: () => true,
    scheduler: syncScheduler,
    debug: true,
    createContext: () => {
      handle = createFakeAudioContext({ resume: 'sync', sampleRate: 48000 });
      return handle.ctx as unknown as AudioContext;
    },
  });
  const advance = (sec: number): void => {
    handle?.advance(sec);
    timers.advance(sec * 1000);
    ticker.advance(sec * 1000, 10);
    busTicker.advance(sec * 1000, 10);
  };
  return { m, target, advance, fake: (): FakeHandle => handle! };
}

/** One attempt of `levelId` in Arcade through the real engine and synthesis, the bridge listening. */
async function playThrough(levelId: string) {
  const e = engine();
  const set = levelSoundSet(levelId, null);
  e.m.prepare(set);
  // A trusted gesture: the context is built and runs, the bank bakes core and the level set.
  e.target.dispatchEvent(new Event('click'));
  const session = await GameSession.create({ level: getLevel(levelId), skipIntro: true });
  const bridge = new SessionBridge(session, { engine: e.m, mode: 'arcade', chapter: null, attempt: 1, narrative: true });
  bridge.setPhase('loading');
  e.advance(0.1);
  bridge.setPhase(session.phase);
  const cam = new Float64Array(16);
  let maxVoices = 0;
  for (let i = 0; i < Math.round(SECONDS / FIXED_DT); i++) {
    session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, {}));
    e.advance(FIXED_DT);
    bridge.frame(FIXED_DT, trailingCamera(session, cam));
    maxVoices = Math.max(maxVoices, e.m.state().voices.active);
  }
  const token = bridge.session.token;
  const mine = (): TraceEntry[] => e.m.traceRing.since(0).filter((t) => t.token === token);
  return { e, set, session, bridge, token, mine, maxVoices };
}

/** (m, played level) of the first hit layer of every collision that played (a break's layer 0 too). */
/**
 * [m, requested level, played level with the distance taken out, active voices] of the first hit
 * layer of each collision (SPATIAL.effects: (40/d) beyond 40 m).
 */
function hitLevels(trace: readonly TraceEntry[]): [number, number, number, number][] {
  const mOf = new Map(trace.filter((t) => t.kind === 'event' && t.ev === 'collision').map((t) => [t.cause, t.input?.m ?? NaN]));
  const pairs: [number, number, number, number][] = [];
  const seen = new Set<number>();
  for (const p of trace) {
    if (p.kind !== 'play' || !p.sound?.startsWith('hit.') || seen.has(p.cause)) continue;
    const m = mOf.get(p.cause);
    if (m === undefined || !Number.isFinite(m)) continue;
    seen.add(p.cause);
    const d = p.distM ?? 0;
    pairs.push([m, p.requestDb!, p.gainDb! - (d > 40 ? 20 * Math.log10(40 / d) : 0), p.activeVoices ?? 0]);
  }
  return pairs;
}

describe('packages A, B and C together on a real run', () => {
  const pairs: [number, number, number, number][] = [];

  it(`riverside-town, Arcade: ${SECONDS} s of autopilot through the real engine and synthesis`, async () => {
    const plain = await runHeadless({ level: getLevel('riverside-town'), seconds: SECONDS, bridge: false });
    const { e, set, session, bridge, token, mine, maxVoices } = await playThrough('riverside-town');
    expect(e.m.status()).toBe('running');
    const bank = e.m.bank()!;
    for (const id of set.sounds) expect(bank.ready(id), id).toBe(true);
    expect(bank.bell('st-brides', 'strike')).not.toBeNull();
    expect(e.fake().nodesOf('Convolver')[0]).toMatchObject({ normalize: false });

    // Gameplay is untouched by the real engine too.
    const state = (s: GameSession) => ({ iceberg: s.iceberg, stats: s.stats, events: s.events.log, route: s.route, physics: s.physics.stats });
    expect(fingerprint(state(session))).toBe(fingerprint(state(plain.session)));

    const trace = mine();
    expect(trace.filter((t) => t.kind === 'error')).toEqual([]);
    // B's ambience voices were built on this session's gains and fed by C's inputs.
    expect(bridge.session.ambience).not.toBeNull();
    expect(trace.some((t) => t.kind === 'ambience')).toBe(true);
    // Real baked buffers played: houses fell (the hit, then the collapse), splashes, landings.
    const plays = trace.filter((t) => t.kind === 'play');
    expect(plays.filter((t) => t.sound === 'house.collapse').length).toBeGreaterThan(0);
    expect(plays.filter((t) => t.family === 'splash').length).toBeGreaterThan(0);
    expect(trace.filter((t) => t.kind === 'drop' && t.reason === 'notReady')).toEqual([]);
    expect(maxVoices).toBeLessThanOrEqual(24 + 4 + 2);
    // St Bride's rang (a background phrase falls 6-14 s in, then every 45-75 s) on its baked buffer.
    const bells = trace.filter((t) => t.kind === 'bell' && t.note?.startsWith('st-brides strike'));
    expect(bells.length).toBeGreaterThanOrEqual(2);
    expect(bells.filter((t) => t.reason !== undefined)).toEqual([]);
    // Every event of the run has an entry in the bridge's trace.
    expect(trace.filter((t) => t.kind === 'event').length).toBe(session.events.log.length);
    pairs.push(...hitLevels(trace));

    // end(): everything of this attempt stops within 0.15 s, and later calls are traced as stale.
    bridge.end();
    e.advance(0.25);
    expect(e.fake().liveSources()).toBe(0);
    expect(e.m.state().voices.active).toBe(0);
    expect(bridge.session.play(hit(-20)).reason).toBe('disabled');
    expect(e.m.traceRing.since(0).some((t) => t.token === token && t.note === 'stale')).toBe(true);

    plain.session.dispose();
    session.dispose();
    await e.m.dispose();
  }, 300000);

  it(`power-valley, Arcade: ${SECONDS} s; across both runs the hits' levels follow the impact`, async () => {
    const { e, session, bridge, mine } = await playThrough('power-valley');
    const trace = mine();
    expect(trace.filter((t) => t.kind === 'error' || (t.kind === 'drop' && t.reason === 'notReady'))).toEqual([]);
    // No church in this valley: no bell.
    expect(trace.filter((t) => t.kind === 'bell')).toEqual([]);
    pairs.push(...hitLevels(trace));
    // Rank correlation of m with the requested level, first hit layer of each collision (the played
    // level adds ±1.5 dB of jitter by design, which reorders taps whose levels lie within 3 dB: with
    // a handful of taps in one run that alone moved this from 0.89 to 0.64 when the mapping changed).
    expect(pairs.length).toBeGreaterThanOrEqual(6);
    const rho = spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
    expect(rho).toBeGreaterThan(0.8);
    // The engine plays each at its request, give or take the jitter (±1.5 dB) and the density
    // compensation (1/sqrt(1 + 0.35 n), n at most the voices active after it), distance aside.
    for (const [m, req, played, active] of pairs) {
      expect(played - req, `m ${m}`).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(played - req, `m ${m}`).toBeGreaterThanOrEqual(-1.5 - 10 * Math.log10(1 + 0.35 * active) - 1e-6);
    }
    // And the hard knocks sit well above the taps as played (m 0.25 about -34 dB, m 0.75 about -20 dB).
    const taps = pairs.filter(([m]) => m < 0.3).map(([, , g]) => g);
    const knocks = pairs.filter(([m]) => m > 0.7).map(([, , g]) => g);
    expect(taps.length).toBeGreaterThan(0);
    expect(knocks.length).toBeGreaterThan(0);
    expect(Math.min(...knocks) - Math.max(...taps)).toBeGreaterThan(8);
    bridge.end();
    e.advance(0.25);
    expect(e.fake().liveSources()).toBe(0);
    session.dispose();
    await e.m.dispose();
  }, 300000);
});

describe("the bake sets package C asks for fit package B's budgets", () => {
  it('every Arcade level and every chapter: sounds, bells and motifs within budget, the peak within 22 MiB', () => {
    const sets = [
      ...AUDIO_LEVEL_IDS.map((id) => ({ name: `arcade ${id}`, set: levelSoundSet(id, null) })),
      ...CHAPTERS.map((c) => ({ name: `story ${c.id}`, set: levelSoundSet(c.levelId, c.id) })),
    ];
    expect(sets).toHaveLength(18);
    const core = coreBytes();
    const over: string[] = [];
    let peak = 0;
    for (const { name, set } of sets) {
      // The bytes a set adds on top of the core (the core is baked once at unlock and always kept).
      const b = levelSetBytes(set);
      if (b.sounds > BANK_BUDGET_BYTES.level) over.push(`${name}: sounds ${b.sounds}`);
      if (b.bells > BANK_BUDGET_BYTES.bells) over.push(`${name}: bells ${b.bells}`);
      if (b.motifs > BANK_BUDGET_BYTES.motif) over.push(`${name}: motifs ${(b.motifs / MiB).toFixed(2)} MiB`);
      peak = Math.max(peak, core + b.total);
    }
    // One known exception: the epilogue plays inside chapter 9's game screen (useStoryRun.epilogue),
    // so chapter 9 bakes its Revelation and the epilogue together, 4.91 MiB of motifs against the
    // 4 MiB motif budget. A set of its own would race the motif's 4.5 s entry and evict chapter 9's
    // sounds mid-attempt; the peak stays under the 22 MiB total, which is the budget that matters.
    expect(over).toEqual(['story ch9-last-thaw: motifs 4.91 MiB']);
    expect(peak).toBeLessThanOrEqual(BANK_BUDGET_BYTES.total);
    // 18.3 MiB at integration; +0.82 MiB since the core keeps St Bride's strike for the Settings
    // preview (it plays from a cold start), so 19.1 MiB at the peak (chapter 9); +0.44 MiB since the
    // playtest of 2026-10-23 (chapter 9's pines fall for 2.2 s instead of 2.0, its log pile has its own
    // 2.2 s logs.tumble), so 19.54 MiB; +0.96 MiB since the second playtest (2026-10-24: chapter 9's
    // abandoned village brings houses, so house.collapse, to the Upper Vell), so 20.50 MiB, still 1.5 MiB
    // under the 22 MiB total.
    expect(peak / MiB).toBeLessThan(20.75);
  });
});
