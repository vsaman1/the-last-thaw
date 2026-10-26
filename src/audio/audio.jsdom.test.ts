// @vitest-environment jsdom
/**
 * The UI tests run in jsdom, which has no audio rendering. The sound system must notice and stay out
 * of the way there: no AudioContext, OfflineAudioContext or Audio element is ever constructed (even
 * when the globals exist), nothing is logged, and every call is a safe no-op. music.jsdom.test.ts
 * covers the music player itself; this covers the engine around it.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ARCADE_MIX, DUCK_PRESETS } from './contract';

vi.mock('../render/GameView', () => ({ GameView: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ctor = (name: string) =>
  vi.fn(function (this: unknown) {
    throw new Error(`${name} must not be constructed under jsdom`);
  });
const AudioContextSpy = ctor('AudioContext');
const OfflineSpy = ctor('OfflineAudioContext');

beforeAll(() => {
  vi.stubGlobal('AudioContext', AudioContextSpy);
  vi.stubGlobal('webkitAudioContext', AudioContextSpy);
  vi.stubGlobal('OfflineAudioContext', OfflineSpy);
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the sound system under jsdom', () => {
  it('constructs no audio object, logs nothing, and every call is a safe no-op', async () => {
    const errors = vi.spyOn(console, 'error');
    const warns = vi.spyOn(console, 'warn');
    const audioEl = vi.spyOn(window, 'Audio');
    const { audio } = await import('./manager');
    const { App } = await import('../ui/App');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(App)));
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchend']) {
      act(() => {
        window.dispatchEvent(new Event(type, { bubbles: true }));
      });
    }
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }));
    });

    expect(audio.available).toBe(false);
    expect(audio.status()).toBe('unavailable');
    audio.unlock();
    audio.applySettings({ master: 0.5, music: 0.6, ambience: 0.8, effects: 0.8, musicMuted: false, soundMuted: true });
    audio.setHidden(true);
    audio.setHidden(false);
    audio.duck('reading', DUCK_PRESETS.reading.story, 'story');
    audio.duck('reading', null, 'story');
    audio.music.setCue('wonder');
    audio.music.hold('card');
    audio.music.release('card');
    audio.prepare({ sounds: ['hit.wood'], bells: ['st-brides'], motifs: [{ variant: 'act1', tempoScale: 1 }] });
    expect(audio.playMotif({ variant: 'act1', tempoScale: 1 }, 0)).toBe(null);
    audio.stopMotif(1);
    audio.preview('effects');
    const s = audio.beginSession({ levelId: 'mountain-valley', mode: 'arcade', chapterId: null, attempt: 1, mix: ARCADE_MIX });
    s.setPhase('playing', false);
    s.beginFrame(1);
    s.setListener({ px: 0, py: 0, pz: 0, rightX: 1, rightZ: 0, fwdX: 0, fwdZ: -1 });
    const layers = Array.from({ length: 4 }, () => ({
      sound: 'hit.wood' as const,
      variant: -1,
      gainDb: -20,
      rate: 1,
      lowpassHz: 8000,
      delaySec: 0,
      optional: false,
    }));
    expect(s.play({ family: 'hit', priority: 3, layerCount: 1, layers, positional: false, x: 0, y: 0, z: 0, key: 1, cause: 1, startDelaySec: 0 })).toEqual({
      started: 0,
      reason: 'unavailable',
    });
    expect(s.playBell({ slot: 0, voicing: 'st-brides', form: 'strike', when: 0, velocity: 1, gainLin: 0.1, lowpassHz: 3000, pan: 0 })).toBe(null);
    expect(s.ambience).toBe(null);
    s.duck('pause', DUCK_PRESETS.pause.arcade);
    s.end();
    expect(audio.state()).toMatchObject({ available: false, status: 'unavailable' });
    await new Promise((r) => setTimeout(r, 0));

    act(() => root.unmount());
    host.remove();
    expect(AudioContextSpy).not.toHaveBeenCalled();
    expect(OfflineSpy).not.toHaveBeenCalled();
    expect(audioEl).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    expect(window.__icebergAudio).toBeUndefined();
  });
});
