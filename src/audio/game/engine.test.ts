import { describe, expect, it } from 'vitest';
import { ARCADE_MIX, type SessionAudioInfo } from '../contract';
import { audio } from '../manager';
import { audioEngine, installAudioEngine } from './engine';
import { RecordingAudioManager } from './testing/recording';

const info: SessionAudioInfo = { levelId: 'mountain-valley', mode: 'arcade', chapterId: null, attempt: 1, mix: ARCADE_MIX };

describe('the engine the bridge and the director drive', () => {
  it("is package A's app singleton; under node that is the Null manager, which plays nothing", () => {
    expect(audioEngine()).toBe(audio);
    expect(audio.available).toBe(false);
    expect(audio.status()).toBe('unavailable');
    const s = audio.beginSession(info);
    expect(s.play({} as never)).toEqual({ started: 0, reason: 'unavailable' });
    expect(s.playBell({} as never)).toBeNull();
    expect(s.ambience).toBeNull();
    s.end();
    expect(audio.playMotif({ variant: 'act1', tempoScale: 1 }, 4)).toBeNull();
  });

  it('installing an engine replaces it until uninstalled', () => {
    const rec = new RecordingAudioManager();
    const off = installAudioEngine(rec);
    expect(audioEngine()).toBe(rec);
    off();
    expect(audioEngine()).toBe(audio);
    // A stale uninstaller (its engine was replaced since) changes nothing.
    const offA = installAudioEngine(rec);
    const rec2 = new RecordingAudioManager();
    const offB = installAudioEngine(rec2);
    offA();
    expect(audioEngine()).toBe(rec2);
    offB();
    expect(audioEngine()).toBe(rec);
    installAudioEngine(audio);
  });
});
