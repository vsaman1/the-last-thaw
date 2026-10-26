/**
 * Seeded streams for the sound system (AGENTS.md §3: SEED = 42, reported in the output).
 *
 * Every subsystem draws from its own stream, seeded hash(SEED, levelId, attempt, stream): FNV-1a over
 * the parts as strings, then core/rng's mulberry32. Separate streams mean a change in one subsystem
 * (say, one more bell stroke) never shifts another's sequence (the variant chosen for the next hit).
 */
import { createRng } from '../core/rng';
import { SEED, type RngStream } from './contract';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over a string's UTF-16 code units, continuing from h. */
export function fnv1a(text: string, h: number = FNV_OFFSET): number {
  let x = h >>> 0;
  for (let i = 0; i < text.length; i++) {
    x ^= text.charCodeAt(i);
    x = Math.imul(x, FNV_PRIME);
  }
  return x >>> 0;
}

/** hash(seed, ...parts): the parts are separated by a unit separator so ('ab','c') != ('a','bc'). */
export function hashSeed(seed: number, ...parts: readonly (string | number)[]): number {
  let h = fnv1a(String(seed));
  for (const p of parts) h = fnv1a(`\u001f${String(p)}`, h);
  return h;
}

/** The seed of one stream of one attempt. */
export function streamSeed(levelId: string, attempt: number, stream: RngStream, seed: number = SEED): number {
  return hashSeed(seed, levelId, attempt, stream);
}

/** A fresh generator in [0, 1) for one stream of one attempt. */
export function streamRng(levelId: string, attempt: number, stream: RngStream, seed: number = SEED): () => number {
  return createRng(streamSeed(levelId, attempt, stream, seed));
}

/** Uniform in [-1, 1) from a [0, 1) generator. */
export const signed = (rng: () => number): number => rng() * 2 - 1;
