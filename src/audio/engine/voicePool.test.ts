import { describe, expect, it } from 'vitest';
import {
  FAMILY_LIMITS,
  GLOBAL_LIMITS,
  SEED,
  SOUND_DEFS,
  SOUND_IDS,
  VARIATION,
  type DropReason,
  type SoundRequest,
} from '../contract';
import { streamRng } from '../rng';
import { createListenerPose } from '../spatial';
import { createFakeAudioContext } from '../testing/fakeAudioContext';
import { hit, layer, request } from '../testing/requests';
import { createToneBank, syncScheduler } from '../testing/toneBank';
import { createPlayDetail, EffectVoices, ShuffleBags, VoiceSession } from './voicePool';

function rig(token = 1) {
  const h = createFakeAudioContext({ state: 'running' });
  const ctx = h.ctx as unknown as BaseAudioContext;
  const out = h.fake.createGain();
  out.connect(h.fake.destination);
  const send = h.fake.createGain();
  const bank = createToneBank(syncScheduler, SEED, { maxSeconds: 6 });
  bank.attach(ctx);
  bank.request({ scope: 'core' });
  bank.request({ scope: 'level', set: { sounds: [...SOUND_IDS], bells: [], motifs: [] } });
  const pool = new EffectVoices(ctx, out as unknown as AudioNode, send as unknown as AudioNode, () => bank);
  const session = new VoiceSession(token, streamRng('mountain-valley', token, 'sfx'), createListenerPose());
  const detail = createPlayDetail();
  let frame = 0;
  const play = (req: SoundRequest) => pool.play(req, session, detail);
  const nextFrame = (dt = 1 / 60): void => {
    h.advance(dt);
    session.frame.begin(++frame);
  };
  session.frame.begin(frame);
  return { h, pool, session, detail, play, nextFrame, bank };
}

function count(results: { reason: DropReason | null }[]): Partial<Record<DropReason | 'played', number>> {
  const out: Partial<Record<DropReason | 'played', number>> = {};
  for (const r of results) {
    const k = r.reason ?? 'played';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

describe('admission under a fastForward burst', () => {
  it('200 collisions in one frame: 4 admitted, the other 196 counted as frameCap', () => {
    const { play } = rig();
    const results = Array.from({ length: 200 }, (_, i) => play(hit(-20, i)));
    expect(count(results)).toEqual({ played: 4, frameCap: 196 });
  });

  it('at one instant at most the global burst (12) of voices starts, whatever the frame count', () => {
    const { play, session, pool, h } = rig();
    let voices = 0;
    // Many frames, but audio time does not move (the synchronous burst of fastForward).
    for (let f = 1; f <= 40; f++) {
      session.frame.begin(f);
      for (let i = 0; i < 6; i++) {
        const sound = (['hit.stone.light', 'splash.small', 'ice.chip', 'ice.absorb', 'ice.wallScrape', 'ice.land.ground'] as const)[i];
        voices += play(request([layer(sound)], { key: f * 10 + i })).started;
      }
    }
    expect(voices).toBeLessThanOrEqual(GLOBAL_LIMITS.burst);
    expect(pool.active(h.fake.currentTime)).toBeLessThanOrEqual(GLOBAL_LIMITS.burst);
  });

  it('over 250 ms at 60 fps: hits <= 6 + 16·0.25 requests, all voices <= 12 + 40·0.25', () => {
    const { play, nextFrame } = rig();
    let hits = 0;
    let voices = 0;
    for (let f = 0; f < 15; f++) {
      nextFrame();
      for (let i = 0; i < 8; i++) {
        const r = play(hit(-20, f * 100 + i));
        if (r.started > 0) hits++;
        voices += r.started;
        voices += play(request([layer('splash.small')], { key: -1 })).started;
      }
    }
    expect(hits).toBeLessThanOrEqual(FAMILY_LIMITS.hit.burst + FAMILY_LIMITS.hit.ratePerSec * 0.25 + 1e-9);
    expect(voices).toBeLessThanOrEqual(GLOBAL_LIMITS.burst + GLOBAL_LIMITS.ratePerSec * 0.25 + 1e-9);
  });

  it('the 150 ms per-obstacle rule', () => {
    const { play, nextFrame } = rig();
    expect(play(hit(-20, 5)).reason).toBe(null);
    nextFrame(0.1);
    expect(play(hit(-20, 5)).reason).toBe('perKey');
    expect(play(hit(-20, 6)).reason).toBe(null);
    nextFrame(0.06);
    expect(play(hit(-20, 5)).reason).toBe(null);
  });

  it('a P0 is not refused for rate after minor sounds spent the global tokens', () => {
    const { play, pool, h } = rig();
    pool.limits.global.take(GLOBAL_LIMITS.burst, h.fake.currentTime); // minor sounds spent them all
    expect(play(hit(-20, 99)).reason).toBe('rate');
    const house = request([layer('house.collapse', { gainDb: -14 }), layer('glass.break', { gainDb: -20, optional: true })]);
    expect(play(house)).toEqual({ started: 2, reason: null });
    // ...into a bounded debt: one more P0 request's worth, then even a P0 waits.
    expect(play(request([layer('masonry.collapse.large', { gainDb: -12 }), layer('weight.thump'), layer('debris.settle')]))).toEqual({
      started: 3,
      reason: null,
    });
    expect(pool.limits.global.available(h.fake.currentTime)).toBe(-GLOBAL_LIMITS.maxLayers);
    expect(play(request([layer('dam.break', { gainDb: -9 })])).reason).toBe('rate');
  });
});

describe('caps and stealing', () => {
  it('caps per family: a quieter fifth splash is refused, a much louder one steals the quietest', () => {
    const { play, nextFrame, pool, h, detail } = rig();
    // Four at once (two sounds: three variants each, and one variant never starts twice in 40 ms).
    for (const sound of ['splash.large', 'splash.large', 'splash.medium', 'splash.medium'] as const) {
      expect(play(request([layer(sound, { gainDb: -30 })])).reason).toBe(null);
    }
    nextFrame(0.13); // one splash token back
    expect(play(request([layer('splash.large', { gainDb: -44 })])).reason).toBe('cap');
    nextFrame(0.13);
    expect(play(request([layer('splash.large', { gainDb: -16 })])).reason).toBe(null);
    expect(detail.stole).toBe(1);
    expect(pool.familyActive('splash', h.fake.currentTime)).toBe(FAMILY_LIMITS.splash.maxVoices);
  });

  it('stealing takes the lowest score first (here the quietest of four the same age)', () => {
    const { play, nextFrame, pool, h } = rig();
    const four = [['splash.large', -30], ['splash.large', -24], ['splash.medium', -40], ['splash.medium', -28]] as const;
    for (const [sound, g] of four) expect(play(request([layer(sound, { gainDb: g })])).reason).toBe(null);
    nextFrame(0.13);
    play(request([layer('splash.large', { gainDb: -10 })]));
    const faded = pool.strips.filter((s) => s.level === 0 && s.busyUntil > h.fake.currentTime);
    expect(faded).toHaveLength(1);
    // The faded strip is the one that carried the -40 dB voice: its gain was set lowest of the four.
    const started = pool.strips.filter((s) => s.busyUntil > h.fake.currentTime);
    const firstGain = (st: (typeof started)[number]) =>
      (st.gain.gain as unknown as { events: { type: string; value: number }[] }).events.find((e) => e.type === 'set')!.value;
    const quietest = started.slice(0, 4).reduce((m, st) => (firstGain(st) < firstGain(m) ? st : m));
    expect(faded[0]).toBe(quietest);
  });

  it('a P0 voice is never stolen by P1–P3, only by another P0', () => {
    const { play, nextFrame, detail } = rig();
    for (let i = 0; i < FAMILY_LIMITS.breakStructure.maxVoices; i++) {
      nextFrame(0.34); // breakStructure refills at 3/s
      expect(play(request([layer('house.collapse', { gainDb: -40 })])).reason).toBe(null);
    }
    nextFrame(0.34);
    expect(play(request([layer('glass.break', { gainDb: 0 })])).reason).toBe('cap'); // P1, however loud
    nextFrame(0.34);
    expect(play(request([layer('metal.break.structure', { gainDb: -10 })])).reason).toBe(null); // P0
    expect(detail.stole).toBe(1);
  });

  it('never more than 24 effect voices, and ended voices free their strips', () => {
    const { play, nextFrame, pool, h } = rig();
    for (let f = 0; f < 600; f++) {
      nextFrame(1 / 60);
      for (const sound of ['hit.stone.light', 'splash.small', 'ice.chip', 'house.collapse', 'tree.fall.pine'] as const) {
        play(request([layer(sound, { gainDb: -20 - (f % 7) }), layer('weight.thump', { gainDb: -26, optional: true })]));
      }
      expect(pool.active(h.fake.currentTime)).toBeLessThanOrEqual(GLOBAL_LIMITS.maxEffectVoices);
    }
    expect(pool.peak).toBeLessThanOrEqual(GLOBAL_LIMITS.maxEffectVoices);
    h.advance(10);
    expect(pool.active(h.fake.currentTime)).toBe(0);
    expect(pool.strips.every((s) => s.busyUntil <= h.fake.currentTime)).toBe(true);
    expect(h.liveSources()).toBe(0);
  });

  it('at 12+ active voices, P3 requests are refused as busy and optional layers dropped', () => {
    const { play, nextFrame, pool, h } = rig();
    while (pool.active(h.fake.currentTime) < GLOBAL_LIMITS.busyVoices) {
      nextFrame(0.2);
      play(request([layer('house.collapse'), layer('glass.break', { optional: true }), layer('weight.thump')]));
      play(request([layer('tree.fall.pine'), layer('weight.thump')]));
    }
    nextFrame(0.2);
    expect(play(hit(-10, 1)).reason).toBe('busy');
    const r = play(request([layer('hit.stone.heavy', { gainDb: -12 }), layer('ice.chip', { optional: true })], { priority: 2 }));
    expect(r.started).toBe(1);
  });
});

describe('variety without randomness leaking', () => {
  it('bags: every variant once before a repeat, and no immediate repeat across bag boundaries', () => {
    const bags = new ShuffleBags(streamRng('riverside-town', 1, 'sfx'));
    const seq: number[] = [];
    for (let i = 0; i < 400; i++) seq.push(bags.next('hit.stone.light', 4, i * 0.1));
    for (let b = 0; b < 100; b++) expect([...seq.slice(b * 4, b * 4 + 4)].sort()).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it('the same variant never starts twice within 40 ms', () => {
    const bags = new ShuffleBags(streamRng('riverside-town', 1, 'sfx'));
    const at0 = [0, 1, 2, 3, 4].map(() => bags.next('hit.stone.light', 4, 10));
    expect([...at0.slice(0, 4)].sort()).toEqual([0, 1, 2, 3]);
    expect(at0[4]).toBe(-1);
    expect(bags.next('ocean.entry', 1, 0)).toBe(0);
    expect(bags.next('ocean.entry', 1, 0.03)).toBe(-1);
    expect(bags.next('ocean.entry', 1, 0.05)).toBe(0);
    // An explicit variant is honoured unless it just started.
    expect(bags.next('splash.small', 3, 1, 2)).toBe(2);
    expect(bags.next('splash.small', 3, 1.01, 2)).not.toBe(2);
  });

  it('jitter stays within VARIATION, and density compensation scales a crowded family', () => {
    const { play, nextFrame, detail } = rig();
    const v = VARIATION.hit;
    const rates: number[] = [];
    for (let i = 0; i < 60; i++) {
      nextFrame(1);
      play(request([layer('hit.wood', { gainDb: -20, rate: 1, lowpassHz: 4000 })], { key: i }));
      expect(detail.count).toBe(1);
      rates.push(detail.rate[0]);
      expect(Math.abs(1200 * Math.log2(detail.rate[0]))).toBeLessThanOrEqual(v.rateCents + 1e-9);
      expect(Math.abs(detail.gainDb[0] + 20)).toBeLessThanOrEqual(v.gainDb + 1e-9);
      expect(Math.abs(detail.lowpassHz[0] / 4000 - 1)).toBeLessThanOrEqual(v.lowpassPct / 100 + 1e-9);
    }
    expect(new Set(rates).size).toBeGreaterThan(50);

    const r2 = rig();
    r2.pool.variation = false;
    r2.play(request([layer('hit.wood', { gainDb: -20 })]));
    expect(r2.detail.gainDb[0]).toBeCloseTo(-20, 9);
    r2.play(request([layer('hit.wood', { gainDb: -20 })]));
    // One hit already sounding in the family: x 1/sqrt(1 + 0.35).
    expect(r2.detail.gainDb[0]).toBeCloseTo(-20 + 20 * Math.log10(1 / Math.sqrt(1 + GLOBAL_LIMITS.densityK)), 9);
  });

  it('with variation off, the same request plays identically (lab renders)', () => {
    const a = rig();
    const b = rig();
    for (const r of [a, b]) r.pool.variation = false;
    const req = request([layer('house.collapse', { gainDb: -14, rate: 0.98 }), layer('glass.break', { gainDb: -20, delaySec: 0.06 })]);
    a.play(req);
    b.play(req);
    expect([...a.detail.variant.slice(0, 2)]).toEqual([...b.detail.variant.slice(0, 2)]);
    expect([...a.detail.rate.slice(0, 2)]).toEqual([0.98, 1]);
    expect([...a.detail.when.slice(0, 2)]).toEqual([...b.detail.when.slice(0, 2)]);
  });

  it('the same seed gives the same sequence of variants and jitter', () => {
    const runs = [rig(), rig()].map((r) => {
      const out: number[] = [];
      for (let i = 0; i < 30; i++) {
        r.nextFrame(0.2);
        r.play(request([layer('splash.small'), layer('splash.medium', { delaySec: 0.02 })]));
        out.push(r.detail.variant[0], r.detail.rate[0], r.detail.gainDb[1], r.detail.when[1]);
      }
      return out;
    });
    expect(runs[0]).toEqual(runs[1]);
  });
});

describe('strips', () => {
  it('make up the stereo panner equal-power law (x √2) and use a flat Butterworth low-pass (Q in dB)', () => {
    const { pool, h } = rig();
    const s = pool.strips[0];
    s.prepare(h.fake.currentTime, 0.1, 2000, 0, 0.1);
    const gain = s.gain.gain as unknown as { valueAt(t: number): number };
    expect(gain.valueAt(h.fake.currentTime)).toBeCloseTo(0.1 * Math.SQRT2, 12);
    expect(s.level).toBe(0.1);
    expect(s.lowpass.Q.value).toBeCloseTo(-3.0103, 4);
    s.fadeOut(h.fake.currentTime, 0.025);
    h.advance(0.03);
    expect(gain.valueAt(h.fake.currentTime)).toBe(0);
  });

  it("send a request's own space send (the calving's echo), else the session's", () => {
    const { pool, session, play, nextFrame, h } = rig();
    session.spaceSend = 0.14;
    const sendOf = (): number[] =>
      pool.strips.map((s) => (s.send.gain as unknown as { valueAt(t: number): number }).valueAt(h.fake.currentTime)).filter((v) => v > 0);
    expect(play(hit(-20, 1)).started).toBe(1);
    expect(sendOf()).toEqual([0.14]);
    nextFrame();
    expect(play(request([layer('ice.calve.crack', { gainDb: -20 })], { send: 0.35 })).started).toBe(1);
    expect(sendOf().sort()).toEqual([0.14, 0.35]);
  });
});

describe('layers and session end', () => {
  it('layers start at their offsets; no request plays more than maxLayers', () => {
    const { play, detail, h } = rig();
    const req = request(
      [layer('hit.masonry', { gainDb: -20 }), layer('house.collapse', { gainDb: -14, delaySec: 0.015 }), layer('glass.break', { gainDb: -20, delaySec: 0.06, optional: true }), layer('debris.settle', { gainDb: -28, delaySec: 0.3, optional: true })],
      { priority: 0, family: 'breakStructure' },
    );
    expect(play(req).started).toBe(4);
    const t0 = h.fake.currentTime + 0.005;
    const byLayer = new Map<number, number>();
    for (let i = 0; i < detail.count; i++) byLayer.set(detail.layer[i], detail.when[i]);
    expect(byLayer.get(0)).toBeCloseTo(t0, 9);
    expect(Math.abs(byLayer.get(1)! - (t0 + 0.015))).toBeLessThanOrEqual(VARIATION.breakStructure.layerMs / 1000 + 1e-9);
    expect(GLOBAL_LIMITS.maxLayers).toBe(4);
  });

  it('endSession fades and stops every voice of that session only; started = stopped after 0.2 s', () => {
    const { h, pool, detail } = rig(1);
    const other = new VoiceSession(2, streamRng('mountain-valley', 2, 'sfx'), createListenerPose());
    const mine = new VoiceSession(1, streamRng('mountain-valley', 1, 'sfx'), createListenerPose());
    mine.frame.begin(1);
    other.frame.begin(1);
    h.withOwner('s1', () => pool.play(request([layer('house.collapse'), layer('glass.break', { delaySec: 0.06 })]), mine, detail));
    h.withOwner('s2', () => pool.play(request([layer('masonry.collapse.large')]), other, detail));
    h.advance(0.05);
    expect(h.liveSources('s1')).toBe(2);
    pool.endSession(1, 0.12, h.fake.currentTime);
    h.advance(0.2);
    expect(h.liveSources('s1')).toBe(0);
    expect(h.liveSources('s2')).toBe(1);
    const started = h.ops.filter((o) => o.op === 'start').length;
    expect(started).toBe(3);
    expect(pool.liveOf(1, h.fake.currentTime)).toBe(0);
    expect(SOUND_DEFS['masonry.collapse.large'].seconds).toBeGreaterThan(1);
  });
});
