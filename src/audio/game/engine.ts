/**
 * The AudioManager the game and story bridge drive (contract §14): package A's app singleton,
 * src/audio/manager.ts `audio`. Where there is no Web Audio (node, jsdom, ?audio=off) that is the Null
 * manager, which constructs nothing and plays no sound but still drives the recorded music through
 * its router, so the director's cue, holds, bed, ducks and levels keep working everywhere.
 *
 * Why a port and not a direct import: the bridge and the director read the engine at call time, so a
 * test can install a recording manager (src/audio/game/testing/recording.ts) without module mocks.
 */
import type { AudioManager } from '../contract';
import { audio } from '../manager';

let current: AudioManager = audio;

/** The engine in use now (read it at call time: an install replaces it). */
export const audioEngine = (): AudioManager => current;

/** Install another engine (tests); returns an uninstaller that restores the previous one. */
export function installAudioEngine(manager: AudioManager): () => void {
  const previous = current;
  current = manager;
  return () => {
    if (current === manager) current = previous;
  };
}
