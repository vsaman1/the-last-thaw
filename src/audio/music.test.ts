import { describe, expect, it } from 'vitest';
import type { MusicCue } from '../story/types';
import {
  CROSSFADE_MS,
  DEFAULT_VOLUME,
  createMusicPlayer,
  music,
  type AudioBackend,
  type AudioVoice,
  type VoiceOptions,
  type CrossfadeMusicPlayer,
  type FadeTicker,
} from './music';

/** A media element stand-in: records calls; play() can be told to reject. */
class FakeVoice implements AudioVoice {
  volume = 1;
  muted = false;
  loop = false;
  playing = false;
  playCalls = 0;
  pauseCalls = 0;
  rejectWith: string | null = null;
  constructor(
    readonly url: string,
    readonly options?: VoiceOptions,
  ) {
    this.loop = options?.loop ?? false;
  }
  /** The recording played to its end (only fires when it does not loop). */
  end(): void {
    this.playing = false;
    this.options?.onEnded();
  }
  /** The file would not load. */
  fail(): void {
    this.playing = false;
    this.options?.onError();
  }
  play(): Promise<void> {
    this.playCalls++;
    if (this.rejectWith) {
      const err = new Error('blocked');
      err.name = this.rejectWith;
      return Promise.reject(err);
    }
    this.playing = true;
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCalls++;
    this.playing = false;
  }
}

class FakeBackend implements AudioBackend {
  readonly created: FakeVoice[] = [];
  create(url: string, options?: VoiceOptions): FakeVoice {
    const v = new FakeVoice(url, options);
    this.created.push(v);
    return v;
  }
  voice(cue: MusicCue): FakeVoice | undefined {
    return this.created.find((v) => v.url === `test/${cue}`);
  }
}

/** A manual clock: advance() fires the tick callback every 50 ms while the player wants ticks. */
class ManualTicker implements FadeTicker {
  t = 0;
  running = false;
  private onTick: (() => void) | null = null;
  now(): number {
    return this.t;
  }
  start(onTick: () => void): void {
    this.running = true;
    this.onTick = onTick;
  }
  stop(): void {
    this.running = false;
  }
  advance(ms: number): void {
    for (let left = ms; left > 0; left -= 50) {
      this.t += Math.min(50, left);
      if (this.running) this.onTick?.();
    }
  }
}

interface Rig {
  backend: FakeBackend;
  ticker: ManualTicker;
  player: CrossfadeMusicPlayer;
}

function setup(): Rig {
  const backend = new FakeBackend();
  const ticker = new ManualTicker();
  const player = createMusicPlayer({ backend, ticker, urlFor: (cue) => `test/${cue}` });
  return { backend, ticker, player };
}

/** A player whose every cue has a playlist of three recordings: test/<cue>/a, /b and /c. */
function playlistSetup(): Rig {
  const backend = new FakeBackend();
  const ticker = new ManualTicker();
  const player = createMusicPlayer({ backend, ticker, playlistFor: (cue) => ['a', 'b', 'c'].map((x) => `test/${cue}/${x}`) });
  return { backend, ticker, player };
}
const voiceAt = (b: FakeBackend, url: string): FakeVoice | undefined => b.created.find((v) => v.url === url);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('unlock queueing', () => {
  it('remembers a cue asked for before unlock and creates nothing until then', () => {
    const { backend, player } = setup();
    player.play('wonder');
    player.play('unease');
    expect(backend.created).toHaveLength(0);
    expect(player.state()).toMatchObject({ unlocked: false, cue: 'unease' });

    player.unlock();
    expect(backend.created.map((v) => v.url)).toEqual(['test/unease']);
    expect(backend.voice('unease')!.playCalls).toBe(1);
  });

  it('play(null) before unlock leaves nothing to start', () => {
    const { backend, player } = setup();
    player.play('cost');
    player.play(null);
    player.unlock();
    expect(backend.created).toHaveLength(0);
  });

  it('relocks when the browser rejects play() and retries on the next unlock', async () => {
    const { backend, player } = setup();
    player.play('cost');
    const realCreate = backend.create.bind(backend);
    backend.create = (url) => Object.assign(realCreate(url), { rejectWith: 'NotAllowedError' });
    player.unlock();
    await flush();
    expect(player.state().unlocked).toBe(false);

    const v = backend.voice('cost')!;
    v.rejectWith = null;
    player.unlock();
    expect(v.playCalls).toBe(2);
    expect(v.playing).toBe(true);
    expect(backend.created).toHaveLength(1); // the element is reused, not fetched again
  });

  it('asks once for a retry on the next gesture when blocked, and the retry plays', async () => {
    const backend = new FakeBackend();
    const retries: (() => void)[] = [];
    const player = createMusicPlayer({
      backend,
      ticker: new ManualTicker(),
      urlFor: (cue) => `test/${cue}`,
      onBlocked: (retry) => retries.push(retry),
    });
    const realCreate = backend.create.bind(backend);
    backend.create = (url) => Object.assign(realCreate(url), { rejectWith: 'NotAllowedError' });
    player.play('wonder');
    player.unlock();
    await flush();
    player.unlock(); // a second blocked attempt must not register a second retry
    await flush();
    expect(retries).toHaveLength(1);

    backend.voice('wonder')!.rejectWith = null;
    retries[0]!();
    expect(player.state().unlocked).toBe(true);
    expect(backend.voice('wonder')!.playing).toBe(true);
  });

  it('drops a voice whose file fails to load, so a later play() tries afresh', async () => {
    const { backend, player } = setup();
    const realCreate = backend.create.bind(backend);
    backend.create = (url) => Object.assign(realCreate(url), { rejectWith: 'NotSupportedError' });
    player.unlock();
    player.play('thaw');
    await flush();
    expect(player.state()).toMatchObject({ unlocked: true, voices: [] });
  });
});

describe('crossfade state machine', () => {
  it('fades the first cue in over the crossfade time', () => {
    const { backend, ticker, player } = setup();
    player.unlock();
    player.play('wonder');
    const v = backend.voice('wonder')!;
    expect(v.volume).toBe(0);
    ticker.advance(CROSSFADE_MS / 2);
    expect(v.volume).toBeGreaterThan(0);
    expect(v.volume).toBeLessThan(DEFAULT_VOLUME);
    ticker.advance(CROSSFADE_MS / 2);
    expect(v.volume).toBeCloseTo(DEFAULT_VOLUME, 10);
    expect(ticker.running).toBe(false);
  });

  it('crossfades between cues with equal power, then pauses the old one', () => {
    const { backend, ticker, player } = setup();
    player.unlock();
    player.play('wonder');
    ticker.advance(CROSSFADE_MS);
    player.play('cost');
    const a = backend.voice('wonder')!;
    const b = backend.voice('cost')!;
    expect(b.playCalls).toBe(1);

    ticker.advance(CROSSFADE_MS / 2);
    expect(a.playing && b.playing).toBe(true);
    // Equal power: the two volumes' squares sum to the full volume's square mid-fade.
    expect(a.volume ** 2 + b.volume ** 2).toBeCloseTo(DEFAULT_VOLUME ** 2, 6);

    ticker.advance(CROSSFADE_MS / 2);
    expect(a.playing).toBe(false);
    expect(a.volume).toBe(0);
    expect(b.volume).toBeCloseTo(DEFAULT_VOLUME, 10);
    expect(ticker.running).toBe(false);
  });

  it('reverses smoothly when the cue changes back mid-fade, reusing the element', () => {
    const { backend, ticker, player } = setup();
    player.unlock();
    player.play('wonder');
    ticker.advance(CROSSFADE_MS);
    player.play('unease');
    ticker.advance(CROSSFADE_MS / 3);
    const before = backend.voice('wonder')!.volume;
    player.play('wonder');
    ticker.advance(50);
    expect(backend.voice('wonder')!.volume).toBeGreaterThan(before);
    expect(backend.voice('wonder')!.playCalls).toBe(1); // never stopped, so never restarted
    ticker.advance(CROSSFADE_MS);
    expect(backend.voice('unease')!.playing).toBe(false);
    expect(backend.created).toHaveLength(2);
  });

  it('asking for the cue already playing changes nothing', () => {
    const { backend, ticker, player } = setup();
    player.unlock();
    player.play('remains');
    ticker.advance(CROSSFADE_MS);
    player.play('remains');
    ticker.advance(CROSSFADE_MS);
    expect(backend.created).toHaveLength(1);
    expect(backend.voice('remains')!.playCalls).toBe(1);
    expect(backend.voice('remains')!.volume).toBeCloseTo(DEFAULT_VOLUME, 10);
  });

  it('play(null) fades everything out and stops', () => {
    const { backend, ticker, player } = setup();
    player.unlock();
    player.play('thaw');
    ticker.advance(CROSSFADE_MS);
    player.play(null);
    ticker.advance(CROSSFADE_MS);
    const v = backend.voice('thaw')!;
    expect(v.playing).toBe(false);
    expect(v.volume).toBe(0);
    expect(ticker.running).toBe(false);
  });

  it('only loads the tracks that are actually played', () => {
    const { backend, ticker, player } = setup();
    player.unlock();
    for (const cue of ['wonder', 'cost', 'wonder'] as const) {
      player.play(cue);
      ticker.advance(CROSSFADE_MS);
    }
    expect(backend.created.map((v) => v.url)).toEqual(['test/wonder', 'test/cost']);
  });
});

describe('volume and mute', () => {
  it('clamps volume to 0..1, ignores non-numbers and applies at once', () => {
    const { backend, ticker, player } = setup();
    player.unlock();
    player.play('cost');
    ticker.advance(CROSSFADE_MS);
    const v = backend.voice('cost')!;
    player.setVolume(2);
    expect(player.state().volume).toBe(1);
    expect(v.volume).toBeCloseTo(1, 10);
    player.setVolume(-0.5);
    expect(player.state().volume).toBe(0);
    expect(v.volume).toBe(0);
    player.setVolume(Number.NaN);
    player.setVolume(Number.POSITIVE_INFINITY);
    expect(player.state().volume).toBe(0);
    player.setVolume(0.25);
    expect(v.volume).toBeCloseTo(0.25, 10);
  });

  it('mute silences and pauses at once; unmute fades the current cue back in', () => {
    const { backend, ticker, player } = setup();
    player.unlock();
    player.play('wonder');
    ticker.advance(CROSSFADE_MS);
    const v = backend.voice('wonder')!;
    player.setMuted(true);
    expect(v).toMatchObject({ playing: false, muted: true, volume: 0 });
    expect(ticker.running).toBe(false);

    player.play('reckoning'); // a cue change while muted downloads nothing
    expect(backend.voice('reckoning')).toBeUndefined();

    player.setMuted(false);
    const r = backend.voice('reckoning')!;
    expect(r.playing).toBe(true);
    expect(r.muted).toBe(false);
    expect(r.volume).toBe(0);
    ticker.advance(CROSSFADE_MS);
    expect(r.volume).toBeCloseTo(DEFAULT_VOLUME, 10);
    expect(v.playing).toBe(false);
  });

  it('unlocking while muted fetches nothing', () => {
    const { backend, player } = setup();
    player.setMuted(true);
    player.play('wonder');
    player.unlock();
    expect(backend.created).toHaveLength(0);
  });
});

describe('without audio', () => {
  it('a player with no backend accepts every call', () => {
    const ticker = new ManualTicker();
    const player = createMusicPlayer({ backend: null, ticker });
    expect(() => {
      player.play('wonder');
      player.unlock();
      player.setVolume(0.3);
      player.setMuted(true);
      player.setMuted(false);
      player.play(null);
    }).not.toThrow();
    expect(player.state()).toMatchObject({ unlocked: true, cue: null, voices: [] });
    expect(ticker.running).toBe(false);
  });

  it('survives a backend that throws on create', () => {
    const ticker = new ManualTicker();
    const backend: AudioBackend = {
      create: () => {
        throw new Error('no audio device');
      },
    };
    const player = createMusicPlayer({ backend, ticker });
    player.unlock();
    expect(() => player.play('cost')).not.toThrow();
    expect(player.state().voices).toEqual([]);
  });

  it('the shared singleton is a no-op under node', () => {
    expect(() => {
      music.unlock();
      music.play('wonder');
      music.setVolume(0.5);
      music.setMuted(true);
      music.play(null);
    }).not.toThrow();
  });
});

describe('never silent: loops and playlists', () => {
  it('a cue with one recording loops it natively', () => {
    const { backend, player } = setup();
    player.unlock();
    player.play('thaw');
    expect(backend.voice('thaw')!.loop).toBe(true);
  });

  it('when a recording ends the next one fades in, and after the last the list starts again', () => {
    const { backend, ticker, player } = playlistSetup();
    player.unlock();
    player.play('cost');
    const a = voiceAt(backend, 'test/cost/a')!;
    expect(a.loop).toBe(false);
    ticker.advance(CROSSFADE_MS);
    a.end();
    const b = voiceAt(backend, 'test/cost/b')!;
    expect(b.playing).toBe(true);
    ticker.advance(CROSSFADE_MS);
    expect(b.volume).toBeCloseTo(DEFAULT_VOLUME, 5);
    b.end();
    const c = voiceAt(backend, 'test/cost/c')!;
    expect(c.playing).toBe(true);
    ticker.advance(CROSSFADE_MS);
    c.end();
    // Round again: the first recording plays once more (the same element, no new download).
    expect(a.playing).toBe(true);
    expect(backend.created.filter((v) => v.url === 'test/cost/a')).toHaveLength(1);
  });

  it('a recording that fails to load is skipped for the backup', () => {
    const { backend, player } = playlistSetup();
    player.unlock();
    player.play('reckoning');
    voiceAt(backend, 'test/reckoning/a')!.fail();
    expect(voiceAt(backend, 'test/reckoning/b')!.playing).toBe(true);
  });

  it('every recording failing ends in silence without spinning; another cue still plays', () => {
    const { backend, player } = playlistSetup();
    player.unlock();
    player.play('remains');
    for (const x of ['a', 'b', 'c']) voiceAt(backend, `test/remains/${x}`)!.fail();
    expect(backend.created.filter((v) => v.url.startsWith('test/remains/'))).toHaveLength(3);
    expect(player.state().voices.filter((v) => v.playing)).toHaveLength(0);
    player.play('wonder');
    expect(voiceAt(backend, 'test/wonder/a')!.playing).toBe(true);
  });

  it('the end of a recording that was fading out does not skip the current cue', () => {
    const { backend, ticker, player } = playlistSetup();
    player.unlock();
    player.play('cost');
    ticker.advance(CROSSFADE_MS);
    player.play('thaw');
    voiceAt(backend, 'test/cost/a')!.end();
    expect(voiceAt(backend, 'test/thaw/a')!.playing).toBe(true);
    expect(voiceAt(backend, 'test/thaw/b')).toBeUndefined();
  });
});
