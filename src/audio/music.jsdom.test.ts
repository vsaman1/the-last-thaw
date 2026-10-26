// @vitest-environment jsdom
/**
 * The UI tests run in jsdom, which has Audio but no playback and reports "Not implemented" through
 * console.error for every play()/pause(). The shared player must stay silent and quiet there.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { music } from './music';

afterEach(() => vi.restoreAllMocks());

describe('music under jsdom', () => {
  it('treats jsdom as no audio: no elements, no console errors', async () => {
    const errors = vi.spyOn(console, 'error');
    const created = vi.spyOn(window, 'Audio');
    music.play('wonder');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    music.unlock();
    music.play('cost');
    music.setVolume(0.4);
    music.setMuted(true);
    music.setMuted(false);
    music.play(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(created).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });
});
