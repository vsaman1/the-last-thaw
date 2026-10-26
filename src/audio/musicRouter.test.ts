import { describe, expect, it } from 'vitest';
import type { MusicCue } from '../story/types';
import { CHAPTER_MIX, HOLD_MAX_SEC, HOLD_SAFETY_SEC, PLAY_DUCK_FLOOR_DB, ROUTER_MIN_STEP, type AudioLevels } from './contract';
import { createMusicPlayer, type AudioBackend, type AudioVoice, type MusicPlayer, type VoiceOptions } from './music';
import { createMusicRouter, RELATIVE_STEP, TRIM_RAMP_SEC } from './musicRouter';
import { DEFAULT_LEVELS } from './settings';
import { ManualTicker } from './testing/manualTicker';
import { CUE_TRACKS, playlistUrls, trackUrl } from './tracks';

type Call = ['play', MusicCue | null] | ['setVolume', number] | ['setMuted', boolean] | ['unlock'];

/** Records every call the router makes on the player. */
class RecordingPlayer implements MusicPlayer {
  readonly calls: Call[] = [];
  play(cue: MusicCue | null): void {
    this.calls.push(['play', cue]);
  }
  setVolume(volume: number): void {
    this.calls.push(['setVolume', volume]);
  }
  setMuted(muted: boolean): void {
    this.calls.push(['setMuted', muted]);
  }
  unlock(): void {
    this.calls.push(['unlock']);
  }
  of<K extends Call[0]>(kind: K): Extract<Call, [K, ...unknown[]]>[] {
    return this.calls.filter((c): c is Extract<Call, [K, ...unknown[]]> => c[0] === kind);
  }
  lastVolume(): number {
    const v = this.of('setVolume');
    return v.length > 0 ? v[v.length - 1][1] : NaN;
  }
}

function rig(levels: AudioLevels = DEFAULT_LEVELS) {
  const player = new RecordingPlayer();
  const ticker = new ManualTicker();
  const notes: string[] = [];
  const router = createMusicRouter({ player, ticker, onNote: (_k, n) => notes.push(n) });
  router.setLevels(levels);
  return { player, ticker, router, notes };
}

const db = (x: number): number => Math.pow(10, x / 20);

describe('music router: volume and mute', () => {
  it('constructing it touches nothing; the first levels set the volume and the mute once', () => {
    const player = new RecordingPlayer();
    const router = createMusicRouter({ player, ticker: new ManualTicker() });
    expect(player.calls).toEqual([]);
    router.setLevels(DEFAULT_LEVELS);
    expect(player.calls).toEqual([
      ['setMuted', false],
      ['setVolume', 0.6],
    ]);
  });

  it('effective volume = master · music · 10^((trim + duck)/20)', () => {
    const { player, ticker, router } = rig({ ...DEFAULT_LEVELS, master: 0.5, music: 0.8 });
    expect(player.lastVolume()).toBeCloseTo(0.4, 12);
    router.setTrim(-2);
    ticker.advance(TRIM_RAMP_SEC * 1000);
    expect(player.lastVolume()).toBeCloseTo(0.4 * db(-2), 3);
    router.duck('pause', -8, 0.3);
    ticker.advance(300);
    expect(player.lastVolume()).toBeCloseTo(0.4 * db(-10), 3);
    expect(router.state()).toMatchObject({ trimDb: -2, duckDb: -8 });
  });

  it('while ramping, setVolume only on steps larger than ROUTER_MIN_STEP (or 2 %); never twice for the same levels', () => {
    const { player, ticker, router } = rig();
    router.setLevels({ ...DEFAULT_LEVELS });
    expect(player.of('setVolume')).toHaveLength(1);
    router.duck('fail', -12, 2);
    ticker.advance(2500);
    const vols = player.of('setVolume').map((c) => c[1]).slice(1);
    expect(vols.length).toBeGreaterThan(5);
    // Every step but the final settle is a real step.
    for (let i = 1; i < vols.length - 1; i++) {
      const step = Math.abs(vols[i] - vols[i - 1]);
      expect(step > ROUTER_MIN_STEP || step > RELATIVE_STEP * vols[i - 1]).toBe(true);
    }
    expect(vols[vols.length - 1]).toBeCloseTo(0.6 * db(-12), 12);
    // Settled: the ticker stops and the same levels again send nothing.
    expect(ticker.running).toBe(false);
    const n = player.of('setVolume').length;
    router.setLevels({ ...DEFAULT_LEVELS });
    expect(player.of('setVolume')).toHaveLength(n);
  });

  it('a quiet setting under a deep duck still lands exactly (no stale value within the step)', () => {
    const { player, ticker, router } = rig({ ...DEFAULT_LEVELS, master: 0.1, music: 0.07 });
    router.duck('church', -14, 1.5);
    router.duck('scar', -4, 4);
    ticker.advance(5000);
    expect(player.lastVolume()).toBeCloseTo(0.007 * db(-18), 12);
  });

  it('ramps are linear in dB, stepped at 20 Hz', () => {
    const { player, ticker, router } = rig({ ...DEFAULT_LEVELS, music: 1 });
    router.duck('fail', -12, 2);
    ticker.advance(1000);
    expect(20 * Math.log10(player.lastVolume())).toBeCloseTo(-6, 0);
    ticker.advance(1000);
    expect(20 * Math.log10(player.lastVolume())).toBeCloseTo(-12, 1);
    router.unduck('fail', 2);
    ticker.advance(1000);
    expect(20 * Math.log10(player.lastVolume())).toBeCloseTo(-6, 0);
    ticker.advance(1100);
    expect(player.lastVolume()).toBeCloseTo(1, 2);
    expect(router.state().ducks).toEqual({});
  });

  it('muted = musicMuted || soundMuted || hidden, sent only on change', () => {
    const { player, router } = rig();
    router.setLevels({ ...DEFAULT_LEVELS, soundMuted: true });
    router.setLevels({ ...DEFAULT_LEVELS, soundMuted: true, musicMuted: true });
    router.setHidden(true);
    router.setLevels({ ...DEFAULT_LEVELS, musicMuted: true });
    router.setLevels(DEFAULT_LEVELS);
    expect(player.of('setMuted').map((c) => c[1])).toEqual([false, true]);
    router.setHidden(false);
    expect(player.of('setMuted').map((c) => c[1])).toEqual([false, true, false]);
    expect(router.state().hidden).toBe(false);
  });

  it('the ducks never take the music more than PLAY_DUCK_FLOOR_DB down', () => {
    const { player, ticker, router } = rig({ ...DEFAULT_LEVELS, music: 1 });
    router.duck('pause', -8, 0);
    router.duck('church', -14, 0);
    router.duck('scar', -4, 0);
    ticker.advance(100);
    expect(router.state().duckDb).toBe(PLAY_DUCK_FLOOR_DB);
    expect(player.lastVolume()).toBeCloseTo(db(PLAY_DUCK_FLOOR_DB), 6);
  });

  it('a timed duck releases itself after attack + hold', () => {
    const { player, ticker, router } = rig({ ...DEFAULT_LEVELS, music: 1 });
    router.duckFor('makeRoom', -3, 0.06, 1.5, 1.2);
    ticker.advance(1000);
    expect(router.state().duckDb).toBeCloseTo(-3, 6);
    ticker.advance(3000);
    expect(router.state().duckDb).toBe(0);
    expect(player.lastVolume()).toBeCloseTo(1, 2);
    expect(ticker.running).toBe(false);
  });

  it('a positive duck or trim throws in development and tests', () => {
    const { router } = rig();
    expect(() => router.duck('reading', 3, 1)).toThrow(RangeError);
    expect(() => router.setTrim(1)).toThrow(RangeError);
    expect(() => router.duck('reading', Number.NaN, 1)).toThrow(RangeError);
  });
});

describe('music router: cues and holds', () => {
  it('passes the cue through, once per change', () => {
    const { player, router } = rig();
    router.setCue('wonder');
    router.setCue('wonder');
    router.setCue(null);
    router.setCue('cost');
    expect(player.of('play').map((c) => c[1])).toEqual(['wonder', null, 'cost']);
    expect(router.state()).toMatchObject({ cue: 'cost', playing: 'cost' });
  });

  it('a hold plays null; releasing the last hold plays the wanted cue again', () => {
    const { player, router } = rig();
    router.setCue('remains');
    router.hold('card');
    router.hold('card');
    router.hold('reveal');
    router.release('card');
    expect(player.of('play').map((c) => c[1])).toEqual(['remains', null]);
    router.setCue('thaw'); // wanted changes while held: remembered, still silent
    expect(player.of('play').map((c) => c[1])).toEqual(['remains', null]);
    router.release('reveal');
    router.release('reveal');
    expect(player.of('play').map((c) => c[1])).toEqual(['remains', null, 'thaw']);
    expect(router.state()).toMatchObject({ cue: 'thaw', playing: 'thaw', holds: [] });
  });

  it('a hold releases itself after HOLD_MAX_SEC', () => {
    const { player, ticker, router, notes } = rig();
    router.setCue('reckoning');
    router.hold('act3Entry');
    ticker.advance(HOLD_MAX_SEC * 1000 - 100);
    expect(router.state().holds).toEqual(['act3Entry']);
    ticker.advance(200);
    expect(router.state().holds).toEqual([]);
    expect(player.of('play').map((c) => c[1])).toEqual(['reckoning', null, 'reckoning']);
    expect(notes.some((n) => n.includes('safety'))).toBe(true);
    expect(ticker.running).toBe(false);
  });

  it('once a motif is scheduled, the hold ends by its end + HOLD_SAFETY_SEC at the latest', () => {
    const { ticker, router } = rig();
    router.setCue('cost');
    router.hold('reveal');
    ticker.advance(4000);
    router.limitHolds(15.5 + 4); // the motif ends 19.5 s from now
    ticker.advance((19.5 + HOLD_SAFETY_SEC) * 1000 - 100);
    expect(router.state().holds).toEqual(['reveal']);
    ticker.advance(200);
    expect(router.state().holds).toEqual([]);
  });

  it('state().targets: an attacking duck reports where it is heading, a releasing one where it is', () => {
    const { ticker, router } = rig();
    router.setCue('thaw');
    router.duckFor('seaCh9', -10, 4, Infinity, 3);
    ticker.advance(1000); // a quarter of the way in
    expect(router.state().ducks.seaCh9).toBeCloseTo(-2.5, 6);
    expect(router.state().targets.seaCh9).toBe(-10);
    ticker.advance(4000);
    expect(router.state().targets.seaCh9).toBe(-10);
    router.unduck('seaCh9', 2);
    ticker.advance(1000);
    expect(router.state().targets.seaCh9).toBeCloseTo(router.state().ducks.seaCh9!, 6);
    expect(router.state().targets.seaCh9).toBeCloseTo(-5, 6);
    ticker.advance(1100);
    expect(router.state().targets).toEqual({});
  });

  it('a hidden tab stops the hold limits counting (the motif waits on the suspended audio clock)', () => {
    const { ticker, router } = rig();
    router.setCue('cost');
    router.hold('reveal');
    router.limitHolds(18); // the motif ends 18 s from now on the audio clock
    ticker.advance(5000);
    router.setHidden(true);
    ticker.advance(60_000); // a minute away: past the safety limit and HOLD_MAX_SEC on wall time
    expect(router.state().holds).toEqual(['reveal']);
    router.setHidden(false);
    ticker.advance((13 + HOLD_SAFETY_SEC) * 1000 - 100);
    expect(router.state().holds).toEqual(['reveal']);
    ticker.advance(200);
    expect(router.state().holds).toEqual([]);
  });

  it('StrictMode double calls are idempotent', () => {
    const a = rig();
    const b = rig();
    for (const r of [a, b]) {
      const twice = r === b;
      const n = twice ? 2 : 1;
      for (let i = 0; i < n; i++) r.router.setCue('unease');
      for (let i = 0; i < n; i++) r.router.setLevels({ ...DEFAULT_LEVELS, music: 0.4 });
      for (let i = 0; i < n; i++) r.router.setTrim(-1);
      for (let i = 0; i < n; i++) r.router.hold('card');
      for (let i = 0; i < n; i++) r.router.duck('reading', -6, 0);
      r.ticker.advance(2000);
      for (let i = 0; i < n; i++) r.router.release('card');
    }
    expect(b.player.calls).toEqual(a.player.calls);
  });

  it('unlock forwards to the player', () => {
    const { player, router } = rig();
    router.unlock();
    expect(player.of('unlock')).toHaveLength(1);
  });
});

describe('the router with the real player and tracks: loudness, not just volume', () => {
  /** A media element stand-in that can be told its recording ended. */
  class Voice implements AudioVoice {
    volume = 1;
    muted = false;
    loop = false;
    playing = false;
    constructor(
      readonly url: string,
      readonly options?: VoiceOptions,
    ) {}
    play(): Promise<void> {
      this.playing = true;
      return Promise.resolve();
    }
    pause(): void {
      this.playing = false;
    }
    end(): void {
      this.playing = false;
      this.options?.onEnded();
    }
  }
  const heardLufs = (v: Voice): number => {
    const cue = (Object.keys(CUE_TRACKS) as MusicCue[]).find((c) => trackUrl(c) === v.url)!;
    return CUE_TRACKS[cue].lufsI + 20 * Math.log10(v.volume);
  };

  it('chapter 7 outlasting Moonlight: the nocturne that follows is no louder (it was +8.8 LU)', () => {
    const created: Voice[] = [];
    const backend: AudioBackend = { create: (url, o) => (created.push(new Voice(url, o)), created.at(-1)!) };
    const pt = new ManualTicker();
    const rt = new ManualTicker();
    const player = createMusicPlayer({ backend, ticker: pt });
    const router = createMusicRouter({ player, ticker: rt });
    router.setLevels(DEFAULT_LEVELS);
    router.unlock();
    router.setCue('cost');
    router.setTrim(CHAPTER_MIX['ch6-price'].musicBedDb);
    rt.advance(2000);
    pt.advance(4000);
    const nocturneInCh6 = heardLufs(created.find((v) => v.url === trackUrl('cost'))!);
    router.setCue('reckoning');
    router.setTrim(CHAPTER_MIX['ch7-escape'].musicBedDb);
    rt.advance(2000);
    pt.advance(4000);
    const moon = created.find((v) => v.url === trackUrl('reckoning'))!;
    const moonHeard = heardLufs(moon);
    // Act III below Act II, by its bed.
    expect(moonHeard).toBeCloseTo(nocturneInCh6 + CHAPTER_MIX['ch7-escape'].musicBedDb - CHAPTER_MIX['ch6-price'].musicBedDb, 1);
    moon.end();
    pt.advance(4000);
    const next = created.find((v) => v.url === playlistUrls('reckoning')[1] && v.playing)!;
    expect(next).toBeDefined();
    expect(heardLufs(next)).toBeLessThanOrEqual(moonHeard + 0.01);
    router.dispose();
  });

  it('every playlist played through, file after file: each is heard at the same loudness (K.545 → the waltz was +1.65 LU)', () => {
    for (const cue of Object.keys(CUE_TRACKS) as MusicCue[]) {
      const created: Voice[] = [];
      const backend: AudioBackend = { create: (url, o) => (created.push(new Voice(url, o)), created.at(-1)!) };
      const pt = new ManualTicker();
      const rt = new ManualTicker();
      const router = createMusicRouter({ player: createMusicPlayer({ backend, ticker: pt }), ticker: rt });
      router.setLevels(DEFAULT_LEVELS);
      router.unlock();
      router.setCue(cue);
      rt.advance(2000);
      pt.advance(4000);
      const heard: number[] = [];
      for (let i = 0; i < playlistUrls(cue).length; i++) {
        const now = created.filter((v) => v.playing);
        expect(now.map((v) => v.url), `${cue} #${i}`).toEqual([playlistUrls(cue)[i]]);
        heard.push(heardLufs(now[0]));
        now[0].end();
        pt.advance(4000);
      }
      for (let i = 1; i < heard.length; i++) expect(heard[i], `${cue}: ${playlistUrls(cue)[i]}`).toBeCloseTo(heard[0], 1);
      router.dispose();
    }
  });
});
