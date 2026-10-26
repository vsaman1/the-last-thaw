/**
 * Where package B's synthesis plugs into the engine (DESIGN §9, integration step 3). The engine only
 * ever calls these through the contract's factory types:
 *
 *   createSoundBank       src/audio/synth/bank.ts       baked one-shots, loops, bells, motifs (the
 *                         motifs in a Web Worker where there is one: synth/motifRenderer.ts)
 *   createNoiseBank       src/audio/voices/noiseBank.ts shared noise and control buffers
 *   createAmbienceVoices  src/audio/voices/ambience.ts  wind, scrape, water, falls, ocean, flood
 *   generateSpaceIR       src/audio/synth/ir.ts         the shared space's stereo impulse response
 *
 *   warmSteps             the noise bank's and the space IR's sample data, computed in idle time on
 *                         the menu before the first gesture (both need no context), so the gesture
 *                         that builds the context only wraps them
 *
 * Tests pass their own factories (AudioManagerOptions.synthesis), for example the tone bank. Where a
 * factory is null the engine runs without it, quietly: no bank means every play() is dropped as
 * 'notReady', no noise or ambience factory means SessionAudio.ambience stays null, no IR means the
 * space is silent.
 */
import { SPACE, type CreateAmbienceVoices, type CreateNoiseBank, type CreateSoundBank, type GenerateSpaceIR } from './contract';
import { createSoundBank } from './synth/bank';
import { browserMotifRenderer } from './synth/motifRenderer';
import { generateSpaceIR, spaceIRSteps } from './synth/ir';
import { createAmbienceVoices } from './voices/ambience';
import { createNoiseBank, noiseBankSteps } from './voices/noiseBank';

export interface SynthesisFactories {
  readonly createSoundBank: CreateSoundBank | null;
  readonly createNoiseBank: CreateNoiseBank | null;
  readonly createAmbienceVoices: CreateAmbienceVoices | null;
  readonly generateSpaceIR: GenerateSpaceIR | null;
  /**
   * Work the factories can do before any context exists, as small steps for idle time: the noise
   * bank's samples and the space IR at `sampleRate` (the rate the context will most likely have).
   */
  readonly warmSteps?: ((seed: number, sampleRate: number) => (() => void)[]) | null;
}

export const SYNTHESIS: SynthesisFactories = {
  // Motifs render in a Web Worker where one can be made (src/audio/synth/motifRenderer.ts); the bank
  // bakes them on the main thread otherwise. The samples are the same either way.
  createSoundBank: (schedule, seed) => createSoundBank(schedule, seed, { motifRenderer: browserMotifRenderer() }),
  createNoiseBank,
  createAmbienceVoices,
  generateSpaceIR,
  warmSteps: (seed, sampleRate) => [...noiseBankSteps(seed), ...spaceIRSteps(sampleRate, SPACE.irSeconds, seed)],
};

