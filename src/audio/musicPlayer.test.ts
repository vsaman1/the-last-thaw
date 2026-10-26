import { describe, expect, it } from 'vitest';
import { CrossfadeMusicPlayer, music, musicPlayer } from './music';

describe('the one additive export of music.ts', () => {
  it('musicPlayer is the music singleton itself, with its state() for evidence', () => {
    expect(musicPlayer).toBe(music);
    expect(musicPlayer).toBeInstanceOf(CrossfadeMusicPlayer);
    expect(musicPlayer.state()).toMatchObject({ unlocked: false, voices: [] });
  });
});
