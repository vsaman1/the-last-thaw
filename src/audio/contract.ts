/**
 * src/audio/contract.ts: the shared audio contract (DESIGN.md is the prose companion).
 *
 * FROZEN for the parallel build. Package A (engine), B (synthesis) and C (bridge) all code against
 * this file; none of them edits it alone. A change needs a note in DESIGN.md and all three packages
 * re-checked. Types, constant tables, a few table-building helpers and one pure predicate: no side
 * effects on import, no Web Audio access, so it is safe under node, jsdom and the browser alike.
 *
 * Conventions used everywhere below:
 *  - Levels are in dBFS measured at the pre-master sum with every user slider at 1 and no ducks.
 *  - Linear gains are amplitude (not power). `db(x) = 20·log10(x)`.
 *  - Seconds for durations and AudioContext times; metres for distances; tonnes for mass.
 *  - Every random choice comes from a seeded stream derived from SEED (AGENTS.md: SEED = 42).
 *  - Nothing here may make a sound louder in response to a narrative moment: every duck is <= 0 dB.
 */
import type { GameEvent, GamePhase, ObstacleKind, SurfaceKind, Vec3 } from '../core/types';
import type { GameMode, Screen } from '../state/appStore';
import type { ChapterId, DocumentKind, MusicCue } from '../story/types';
import type { FadeTicker, MusicPlayer } from './music';

// =================================================================================================
// 0. Identity, seeds, levels
// =================================================================================================

/** AGENTS.md: every system that touches randomness uses this seed and reports it. */
export const SEED = 42;

/** Independent seeded streams: a change in one subsystem never shifts another's sequence. */
export const RNG_STREAMS = ['sfx', 'amb', 'bells', 'motif', 'bake'] as const;
export type RngStream = (typeof RNG_STREAMS)[number];

/** The nine levels (LevelDef.id). Audio tables are keyed by these. */
export const AUDIO_LEVEL_IDS = [
  'mountain-valley',
  'rocky-canyon',
  'alpine-pass',
  'riverside-town',
  'glacier-avalanche',
  'power-valley',
  'ravine-run',
  'highland-maze',
  'summit-labyrinth',
] as const;
export type AudioLevelId = (typeof AUDIO_LEVEL_IDS)[number];

/** Wind amount per level (0..1): the level's physical exposure. The act sets its colour (CHAPTER_MIX). */
export const LEVEL_WIND: Readonly<Record<AudioLevelId, number>> = {
  'mountain-valley': 0.6,
  'rocky-canyon': 0.7,
  'alpine-pass': 0.8,
  'riverside-town': 0.4,
  'glacier-avalanche': 0.9,
  'power-valley': 0.4,
  'ravine-run': 0.7,
  'highland-maze': 0.6,
  'summit-labyrinth': 0.9,
};

// =================================================================================================
// 1. Channels, buses, settings
// =================================================================================================

/** The three user-facing channels. The scrape loop is an effect (it is what the iceberg does). */
export type Channel = 'music' | 'ambience' | 'effects';

/** New persisted settings fields (appStore Settings / defaultSettings / sanitizeSettings). */
export interface AudioSettingsFields {
  /** 0..1, multiplies every channel including the recorded music. */
  masterVolume: number;
  /** 0..1. River, waterfalls, sea, wind, church bells. */
  ambienceVolume: number;
  /** 0..1. Collisions, breaking structures, splashes, the iceberg's slide. */
  effectsVolume: number;
  /** "Mute all sound" (shortcut M). musicMuted stays the separate, existing music mute. */
  soundMuted: boolean;
}

/** Defaults. masterVolume 1 keeps today's music loudness (el.volume = 0.6) for existing saves. */
export const AUDIO_SETTING_DEFAULTS: Readonly<AudioSettingsFields> = {
  masterVolume: 1,
  ambienceVolume: 0.8,
  effectsVolume: 0.8,
  soundMuted: false,
};

/** What the engine consumes: the app settings reduced to audio levels (all linear 0..1). */
export interface AudioLevels {
  readonly master: number;
  readonly music: number;
  readonly ambience: number;
  readonly effects: number;
  readonly musicMuted: boolean;
  readonly soundMuted: boolean;
}

/** Master safety limiter (DynamicsCompressorNode). Normal play must never reach it. */
export const LIMITER = {
  thresholdDb: -3,
  kneeDb: 0,
  ratio: 20,
  attackSec: 0.001,
  releaseSec: 0.12,
  /**
   * Gain after the limiter cancelling the node's built-in makeup gain, (1/fullRangeGain)^0.6 by the
   * spec, ~ +1.71 dB for these settings. Initial value; package A measures it offline (S-R4) and pins it.
   */
  makeupCompDb: -1.71,
} as const;

/**
 * The motif's gain against the recordings (DESIGN §8.5: its integrated loudness at music volume v sits
 * 3 LU under the recordings' median at el.volume v). The recordings are loudness-matched (src/audio/
 * tracks.ts: every one is heard at MUSIC_TARGET_LUFS, -22.1 LUFS-I at el.volume 1), so the median is
 * that target; the seven motif renders through motifBus at music 1, uncalibrated, read -30.56 to
 * -28.13 LUFS-I (MOTIF_RENDER_LUFS, median -28.99; Chrome 155, package B's BS.1770, R10). So
 * -22.1 - 3 - (-28.99) = +3.89 dB, rounded to 3.9 (it was +0.2 against the unmatched recordings'
 * median of -25.77). Both scale with the same slider, so one value holds at every music volume. Each
 * moment then lowers its motif further (MOTIF_MOMENT_TRIM_DB).
 */
export const MOTIF_CALIB_DB = 3.9;

/**
 * The one shared space: a procedural stereo IR on a ConvolverNode, fed by per-strip sends.
 * Integration decision: the IR carries the predelay as predelaySec of leading silence and has unit
 * energy per channel, so the convolver runs with `normalize = false` and there is no DelayNode; a
 * send of g then returns steady noise at g × returnDb, at any sample rate.
 */
export const SPACE = { irSeconds: 2.2, predelaySec: 0.015, returnDb: -6 } as const;

/** Effects tone shelf (BiquadFilter highshelf) on the effects bus; the act sets its gain (CHAPTER_MIX). */
export const EFFECTS_SHELF_HZ = 6000;

// =================================================================================================
// 2. Sound ids (baked one-shots and baked loops)
// =================================================================================================

export const SOUND_IDS = [
  // hits (collision without a break)
  'hit.stone.light',
  'hit.stone.heavy',
  'hit.ice',
  'hit.wood',
  'hit.metal.panel',
  'hit.metal.heavy',
  'hit.masonry',
  'weight.thump',
  'stone.scatter',
  'stone.tumble',
  // the iceberg itself
  'ice.chip',
  'ice.absorb',
  'ice.wallScrape',
  'ice.land.ground',
  'ice.land.water',
  'ice.calve.groan',
  'ice.calve.crack',
  // water
  'water.plunge',
  'splash.small',
  'splash.medium',
  'splash.large',
  'ocean.entry',
  // breaks
  'tree.fall.pine',
  'tree.fall.broadleaf',
  'timber.break.light',
  'timber.break.medium',
  'logs.tumble',
  'house.collapse',
  'timber.collapse',
  'masonry.collapse.small',
  'masonry.collapse.large',
  'glass.break',
  'glass.pane',
  'metal.break.light',
  'metal.break.vehicle',
  'metal.break.structure',
  'machine.winddown',
  'liquid.release',
  'dam.break',
  'debris.settle',
  // Story only
  'piano.strings',
  // baked loops (ambience / scrape voices read these; never played as one-shots)
  'scrape.grit',
  'emitter.pumpjack',
  'emitter.factory',
  'emitter.turbine',
  'emitter.rig',
] as const;
export type SoundId = (typeof SOUND_IDS)[number];

/** Rate-limit and cap families. A request has exactly one family; its layers inherit it. */
export type SoundFamily =
  | 'hit'
  | 'scatter'
  | 'chip'
  | 'absorb'
  | 'wallScrape'
  | 'land'
  | 'plunge'
  | 'splash'
  | 'tree'
  | 'breakLight'
  | 'breakStructure'
  | 'dam'
  | 'ocean'
  | 'calve'
  | 'piano'
  | 'loop';

/** 0 = structural failure ... 3 = minor. Lower number wins. */
export type Priority = 0 | 1 | 2 | 3;
export const PRIORITY_WEIGHT: Readonly<Record<Priority, number>> = { 0: 8, 1: 4, 2: 2, 3: 1 };

/** Which bake set a sound belongs to. 'level' sounds bake only when a kind that needs them is present. */
export type BakeSet = 'core' | 'level' | 'story';

export interface SoundDef {
  readonly family: SoundFamily;
  /** Distinct seeded variants (different modes and grain timing, not pitch-shifted copies). */
  readonly variants: number;
  /** Buffer length per variant, including the tail; the recipe must decay to < -70 dBFS by the end. */
  readonly seconds: number;
  /** Bake rate: 32 kHz for bright material, 24 kHz default, 16 kHz for low-band layers. */
  readonly sampleRate: 16000 | 24000 | 32000;
  readonly set: BakeSet;
  readonly priority: Priority;
  /** Loop buffers have a seamless seam (|x[N-1] - x[0]| < 0.01, no RMS step). */
  readonly loop?: true;
}

const sd = (
  family: SoundFamily,
  variants: number,
  seconds: number,
  sampleRate: SoundDef['sampleRate'],
  set: BakeSet,
  priority: Priority,
  loop = false,
): SoundDef =>
  loop
    ? { family, variants, seconds, sampleRate, set, priority, loop: true }
    : { family, variants, seconds, sampleRate, set, priority };

/** sd(family, variants, seconds, sampleRate, set, priority, loop?) */
export const SOUND_DEFS: Readonly<Record<SoundId, SoundDef>> = {
  'hit.stone.light': sd('hit', 4, 0.3, 24000, 'core', 3),
  'hit.stone.heavy': sd('hit', 3, 0.7, 24000, 'core', 2),
  'hit.ice': sd('hit', 4, 0.5, 32000, 'core', 3),
  'hit.wood': sd('hit', 4, 0.35, 24000, 'core', 3),
  'hit.metal.panel': sd('hit', 3, 0.5, 24000, 'level', 3),
  'hit.metal.heavy': sd('hit', 3, 1.2, 24000, 'level', 2),
  'hit.masonry': sd('hit', 3, 0.6, 24000, 'level', 2),
  'weight.thump': sd('hit', 3, 1.0, 16000, 'core', 2),
  'stone.scatter': sd('scatter', 2, 1.3, 24000, 'level', 2),
  'stone.tumble': sd('scatter', 3, 1.6, 24000, 'level', 2),
  'ice.chip': sd('chip', 4, 0.2, 32000, 'core', 3),
  'ice.absorb': sd('absorb', 3, 0.3, 24000, 'level', 3),
  'ice.wallScrape': sd('wallScrape', 3, 0.7, 24000, 'core', 3),
  'ice.land.ground': sd('land', 3, 0.8, 24000, 'core', 2),
  'ice.land.water': sd('land', 3, 1.4, 32000, 'core', 2),
  'ice.calve.groan': sd('calve', 1, 1.5, 16000, 'core', 1),
  'ice.calve.crack': sd('calve', 2, 1.0, 32000, 'core', 1),
  'water.plunge': sd('plunge', 2, 2.5, 32000, 'core', 1),
  'splash.small': sd('splash', 3, 0.4, 32000, 'core', 3),
  'splash.medium': sd('splash', 3, 0.9, 32000, 'core', 3),
  'splash.large': sd('splash', 3, 1.6, 32000, 'core', 2),
  'ocean.entry': sd('ocean', 2, 5.0, 24000, 'core', 1),
  'tree.fall.pine': sd('tree', 2, 2.2, 24000, 'level', 1),
  'tree.fall.broadleaf': sd('tree', 2, 2.2, 24000, 'level', 1),
  'timber.break.light': sd('breakLight', 3, 0.5, 24000, 'level', 2),
  'timber.break.medium': sd('breakLight', 2, 1.2, 24000, 'level', 2),
  'logs.tumble': sd('breakLight', 2, 2.2, 24000, 'level', 2),
  'house.collapse': sd('breakStructure', 3, 3.5, 24000, 'level', 0),
  'timber.collapse': sd('breakStructure', 2, 3.0, 24000, 'level', 0),
  'masonry.collapse.small': sd('breakStructure', 2, 2.5, 24000, 'level', 0),
  'masonry.collapse.large': sd('breakStructure', 2, 4.5, 24000, 'level', 0),
  'glass.break': sd('breakStructure', 3, 1.0, 32000, 'level', 1),
  'glass.pane': sd('breakLight', 2, 0.4, 32000, 'level', 2),
  'metal.break.light': sd('breakLight', 2, 0.8, 24000, 'level', 2),
  'metal.break.vehicle': sd('breakStructure', 2, 1.5, 24000, 'level', 1),
  'metal.break.structure': sd('breakStructure', 2, 3.0, 24000, 'level', 0),
  'machine.winddown': sd('breakStructure', 2, 3.0, 16000, 'level', 1),
  'liquid.release': sd('breakStructure', 2, 2.0, 16000, 'level', 1),
  'dam.break': sd('dam', 2, 5.0, 24000, 'level', 0),
  'debris.settle': sd('breakStructure', 3, 3.0, 24000, 'story', 3),
  'piano.strings': sd('piano', 1, 6.0, 24000, 'story', 1),
  'scrape.grit': sd('loop', 1, 2.0, 24000, 'core', 3, true),
  'emitter.pumpjack': sd('loop', 1, 9.0, 16000, 'level', 3, true),
  'emitter.factory': sd('loop', 1, 4.0, 16000, 'level', 3, true),
  'emitter.turbine': sd('loop', 1, 4.0, 16000, 'level', 3, true),
  'emitter.rig': sd('loop', 1, 4.0, 16000, 'level', 3, true),
};

/** Memory caps (bytes of Float32 PCM), asserted by a unit test from SOUND_DEFS arithmetic. */
export const BANK_BUDGET_BYTES = {
  core: 6 * 1024 * 1024,
  level: 10 * 1024 * 1024,
  bells: 3 * 1024 * 1024,
  motif: 4 * 1024 * 1024,
  total: 22 * 1024 * 1024,
} as const;

// =================================================================================================
// 3. Limits, voices, variation
// =================================================================================================

export interface FamilyLimit {
  /** Concurrent voices (layers) of this family. */
  readonly maxVoices: number;
  /** Token bucket on AudioContext time, counted in requests (events), not layers. */
  readonly ratePerSec: number;
  readonly burst: number;
  /** Minimum seconds between two requests with the same key (obstacle id or placement); 0 = off. */
  readonly perKeySec: number;
}

/**
 * Playtest of 2026-10-23 (trees, stones and log piles were not heard): 'scatter' now carries a rock's
 * tumble too, a request of up to three layers (the hit, its weight, the tumble), so it has six voices,
 * three requests a second and a 1.5 s per-key interval (the router keeps its own 1.5-2 s windows per
 * placement); 'tree' has six voices (three felled trees of two layers each overlap for 2 s); 'breakLight'
 * four (a log pile's two layers beside a fence's snap).
 */
export const FAMILY_LIMITS: Readonly<Record<SoundFamily, FamilyLimit>> = {
  hit: { maxVoices: 8, ratePerSec: 16, burst: 6, perKeySec: 0.15 },
  scatter: { maxVoices: 6, ratePerSec: 3, burst: 3, perKeySec: 1.5 },
  chip: { maxVoices: 2, ratePerSec: 6, burst: 3, perKeySec: 0 },
  absorb: { maxVoices: 2, ratePerSec: 4, burst: 2, perKeySec: 0 },
  wallScrape: { maxVoices: 2, ratePerSec: 5, burst: 2, perKeySec: 0 },
  land: { maxVoices: 2, ratePerSec: 4, burst: 2, perKeySec: 0 },
  plunge: { maxVoices: 2, ratePerSec: 1, burst: 1, perKeySec: 1.5 },
  splash: { maxVoices: 4, ratePerSec: 8, burst: 4, perKeySec: 0 },
  tree: { maxVoices: 6, ratePerSec: 4, burst: 3, perKeySec: 0 },
  breakLight: { maxVoices: 4, ratePerSec: 4, burst: 2, perKeySec: 0.5 },
  breakStructure: { maxVoices: 8, ratePerSec: 3, burst: 3, perKeySec: 1.5 },
  dam: { maxVoices: 3, ratePerSec: 1, burst: 1, perKeySec: 2 },
  ocean: { maxVoices: 2, ratePerSec: 1, burst: 1, perKeySec: 0 },
  calve: { maxVoices: 3, ratePerSec: 3, burst: 3, perKeySec: 0 },
  piano: { maxVoices: 1, ratePerSec: 1, burst: 1, perKeySec: 0 },
  loop: { maxVoices: 0, ratePerSec: 0, burst: 0, perKeySec: 0 },
};

export const GLOBAL_LIMITS = {
  /** Effect one-shot voices sounding at once. */
  maxEffectVoices: 24,
  /** Pre-built effect strips (more than voices, so a stolen voice can fade on its own strip). */
  effectStrips: 28,
  /** Ambience one-shot strips (bell strikes, shivers). */
  bellStrips: 4,
  /** Voices started per second across all families, and the burst allowed. */
  ratePerSec: 40,
  burst: 12,
  /** Requests admitted per animation frame (fastForward delivers hundreds in one frame). */
  maxRequestsPerFrame: 4,
  /**
   * Layers per request: [the causing hit], main, extra, extra-or-settle. Trimmed in that order of
   * importance; optional layers drop first under load.
   */
  maxLayers: 4,
  /** At or above this many active voices only P0..P2 are admitted, and optional layers are dropped. */
  busyVoices: 12,
  /** Event ring in the session listener; on overflow the lowest-priority entry is replaced. */
  eventRing: 128,
  /** A stolen voice fades out over this. */
  stealFadeSec: 0.025,
  /** A new voice steals the lowest-scoring active voice only if it scores this much higher. */
  stealRatio: 1.5,
  /** Same variant of the same sound never starts twice within this. */
  sameVariantSec: 0.04,
  /** Density compensation: each new voice x 1/sqrt(1 + densityK·activeInFamily). */
  densityK: 0.35,
  /** Debug trace ring. */
  traceEntries: 4096,
} as const;

/** Per-family play-time jitter, applied by the engine from the 'sfx' stream (lab can switch it off). */
export interface Variation {
  /** +/- cents of playback-rate jitter. */
  readonly rateCents: number;
  readonly gainDb: number;
  /** +/- percent on the strip low-pass. */
  readonly lowpassPct: number;
  /** +/- milliseconds between layers of one request. */
  readonly layerMs: number;
  readonly pan: number;
}

export const VARIATION: Readonly<Record<SoundFamily, Variation>> = {
  hit: { rateCents: 70, gainDb: 1.5, lowpassPct: 8, layerMs: 10, pan: 0.05 },
  scatter: { rateCents: 40, gainDb: 1, lowpassPct: 8, layerMs: 15, pan: 0.05 },
  chip: { rateCents: 60, gainDb: 1.5, lowpassPct: 10, layerMs: 5, pan: 0.05 },
  absorb: { rateCents: 60, gainDb: 1.5, lowpassPct: 10, layerMs: 5, pan: 0.05 },
  wallScrape: { rateCents: 50, gainDb: 1.5, lowpassPct: 10, layerMs: 0, pan: 0.05 },
  land: { rateCents: 40, gainDb: 1, lowpassPct: 8, layerMs: 5, pan: 0.03 },
  plunge: { rateCents: 30, gainDb: 1, lowpassPct: 5, layerMs: 0, pan: 0.03 },
  splash: { rateCents: 85, gainDb: 1.5, lowpassPct: 10, layerMs: 10, pan: 0.05 },
  tree: { rateCents: 35, gainDb: 1, lowpassPct: 6, layerMs: 10, pan: 0.03 },
  breakLight: { rateCents: 50, gainDb: 1, lowpassPct: 8, layerMs: 10, pan: 0.05 },
  breakStructure: { rateCents: 35, gainDb: 1, lowpassPct: 6, layerMs: 10, pan: 0.03 },
  dam: { rateCents: 20, gainDb: 0.5, lowpassPct: 4, layerMs: 0, pan: 0.02 },
  ocean: { rateCents: 20, gainDb: 0.5, lowpassPct: 4, layerMs: 0, pan: 0 },
  calve: { rateCents: 20, gainDb: 0.5, lowpassPct: 4, layerMs: 0, pan: 0 },
  piano: { rateCents: 0, gainDb: 0, lowpassPct: 0, layerMs: 0, pan: 0 },
  loop: { rateCents: 0, gainDb: 0, lowpassPct: 0, layerMs: 0, pan: 0 },
};

/** Bell strikes: tiny jitter only (a real clock is regular, a real bell is never quite the same). */
export const BELL_VARIATION = { rateCents: 2.5, gainDb: 0.5, strokeJitterSec: 0.015 } as const;

// =================================================================================================
// 4. Magnitude and level mapping (router, package C; checked by render tests)
// =================================================================================================

/**
 * Collision: m = clamp01(wJ·ln(1+J)/ln(1+jRef) + wV·min(1, v/vRef)·min(1, ln(1+J)/ln(1+jGate)));
 * silent below silentBelow. The closing speed counts in proportion to the momentum the contact moved
 * (jGate, after the S4 measurement of 2026-10-22): a fast graze of a light fence that moves almost no
 * momentum is not a loud impact.
 * level = HIT_LREF[sound] + spanDb·(m - 1); rate = rateTop - rateSlope·m;
 * lowpass = lpBaseHz·2^(lpOctaves·m); the weight.thump layer joins above weightFrom with gain
 * (m - weightFrom)/(1 - weightFrom) at HIT_LREF['weight.thump']; the hit.ice layer joins non-ice
 * hits at m >= iceLayerFrom, iceLayerDb below the main layer.
 */
export const COLLISION_MAG = {
  jRef: 1500,
  wJ: 0.75,
  vRef: 25,
  wV: 0.25,
  /** The speed term is full from this impulse up (t·m/s; a pine that holds is J 23), scaled by ln(1+J) below. */
  jGate: 20,
  silentBelow: 0.08,
  spanDb: 26,
  rateTop: 1.06,
  rateSlope: 0.12,
  lpBaseHz: 1500,
  lpOctaves: 3.2,
  weightFrom: 0.55,
  iceLayerFrom: 0.3,
  iceLayerDb: -8,
  /** Heavy variant (e.g. hit.stone.heavy) replaces the light one at or above this m. */
  heavyFrom: 0.55,
} as const;

/** Reference peak level (dBFS) of each hit sound at m = 1, 40 m or nearer. */
export const HIT_LREF: Readonly<Partial<Record<SoundId, number>>> = {
  'hit.stone.light': -12,
  'hit.stone.heavy': -12,
  'hit.ice': -13,
  'hit.wood': -13,
  'hit.metal.panel': -14,
  'hit.metal.heavy': -13,
  'hit.masonry': -12,
  'weight.thump': -14,
};

/**
 * Breaks carry no magnitude, so M = clamp01(wMass·W + wHit·mHit) where W = clamp01(log10(1+massT)/
 * log10(1+massRefT)), massT = the broken body's mass (summed over bodies of one placement coalesced in
 * the window) and mHit = the m of the last collision on that placement within hitWindowSec (0 if none).
 * level = clamp(ltyp + span·(M - mtyp), ltyp - 12, ceil ?? ltyp + 4); rate = rateTop - rateSlope·M;
 * the 'large' feel comes from the sound id choice in KIND_SOUNDS, not from M.
 */
export const BREAK_MAG = {
  massRefT: 150,
  wMass: 0.7,
  wHit: 0.3,
  hitWindowSec: 0.3,
  rateTop: 1.05,
  rateSlope: 0.1,
  /** Bodies of one placement breaking within this window are one break (+ at most 2 settle add-ons). */
  coalesceSec: 0.7,
  settleAddOnDb: -9,
  maxSettleAddOns: 2,
} as const;

/**
 * F6 / F6b (a stone barrier breaking apart, a rock knocked moving): the magnitude weights the hit over
 * the mass, M = clamp01(wMass·W + wHit·mHit) with BREAK_MAG's W. The hit's own m already carries the
 * stone's mass (it grows with ln J, and a heavier stone takes a larger impulse at the same knock). With
 * the break weights (0.7·W) a boulder (W 0.62) sat at stone.tumble's ceiling from the knock threshold
 * up, and a 4 t rock from m 0.6: a nudge that barely moved it as loud as a full-speed strike.
 */
export const STONE_MAG = {
  wMass: 0.1,
  wHit: 0.9,
} as const;

export interface BreakLevel {
  /** Typical peak level (dBFS) at the typical M. */
  readonly ltyp: number;
  readonly mtyp: number;
  readonly span: number;
  /**
   * The loudest it may ever be asked for (dBFS); default ltyp + 4. Set where a sound must never be
   * louder than a house collapse at its typical level (the trees, stones and log piles).
   */
  readonly ceil?: number;
}

/**
 * Trees, log piles, stone barriers and rocks (playtest of 2026-10-23: "similar to the house breaking i
 * want trees to have a sound effect as well and stones and logs"): each at its typical impact about 3 LU
 * under a house collapse at its typical level (a rock of 4 t about 4 LU under, a small rock about 6),
 * and at its strongest never above it (`ceil`). Measured, not assumed: recipes.test.ts mixes the router's
 * requests and checks both, on full range and on laptop speakers. Before, they played 7-9 LU (trees, log
 * piles), 14 LU (a stone barrier) and 26-28 LU (a rock) under a house collapse, under the river and the
 * music.
 */
export const BREAK_LEVELS: Readonly<Partial<Record<SoundId, BreakLevel>>> = {
  'tree.fall.pine': { ltyp: -15.5, mtyp: 0.28, span: 14, ceil: -14 },
  'tree.fall.broadleaf': { ltyp: -15.5, mtyp: 0.32, span: 14, ceil: -14 },
  'logs.tumble': { ltyp: -16, mtyp: 0.38, span: 14, ceil: -14 },
  // The stones take M = stoneM (STONE_MAG), so they follow the hit: a 4 t rock knocked at m 0.2 plays
  // 5 dB under one knocked at m 0.45, and a boulder reaches the ceiling only from m 0.44.
  'stone.scatter': { ltyp: -16.4, mtyp: 0.6, span: 20, ceil: -16 },
  'stone.tumble': { ltyp: -14.4, mtyp: 0.437, span: 22, ceil: -14 },
  'timber.break.light': { ltyp: -22, mtyp: 0.15, span: 14 },
  'timber.break.medium': { ltyp: -19, mtyp: 0.3, span: 14 },
  'metal.break.light': { ltyp: -21, mtyp: 0.15, span: 14 },
  'house.collapse': { ltyp: -14, mtyp: 0.56, span: 12 },
  'timber.collapse': { ltyp: -15, mtyp: 0.56, span: 12 },
  'masonry.collapse.small': { ltyp: -14, mtyp: 0.62, span: 12 },
  'masonry.collapse.large': { ltyp: -12, mtyp: 0.72, span: 12 },
  'metal.break.vehicle': { ltyp: -16, mtyp: 0.55, span: 12 },
  'metal.break.structure': { ltyp: -13, mtyp: 0.65, span: 12 },
  'dam.break': { ltyp: -9, mtyp: 0.88, span: 10 },
};

/** Extra layers on a break, relative to the break's main layer level (dB). */
export const BREAK_LAYER_DB: Readonly<Partial<Record<SoundId, number>>> = {
  'glass.break': -6,
  'glass.pane': -8,
  'machine.winddown': -4,
  'liquid.release': -8,
  'debris.settle': -14,
  'piano.strings': -22,
};

/** The other event mappings (router). Formulas in DESIGN.md §5.2; constants here. */
export const EVENT_MAG = {
  /** splash: level = splashTopDb + splashSpanDb·(i - 1); size by intensity i. */
  splashTopDb: -16,
  splashSpanDb: 18,
  splashSmallBelow: 0.35,
  splashMediumBelow: 0.7,
  /** Splashes within this window merge: i = 1 - Π(1 - i_k), position = intensity-weighted centroid. */
  splashMergeSec: 0.12,
  /** A second splash voice in one window only if more than this far from the first. */
  splashApartM: 30,
  /** landed: mL = clamp01(log10(1 + massT·drop)/log10(1 + landRef)); silent if drop < landMinDrop. */
  landRef: 6000,
  landMinDrop: 0.4,
  landTopDb: -14,
  landSpanDb: 14,
  /** waterfallCrossed replaces that frame's landed: plungeDb + 20·log10(0.8 + 0.2·min(1, drop/30)). */
  plungeDb: -13,
  /** iceChipped: a = min(1, amount/chipAmountRef); level = chipTopDb + chipSpanDb·(a - 1). */
  // The 95th percentile of `amount` over 29 chips in headless runs of all nine levels (package C,
  // integration.test.ts); the 0.004 placeholder sat below nearly every real chip.
  chipAmountRef: 0.4,
  chipTopDb: -30,
  chipSpanDb: 8,
  /** A chip in the same frame as a collision with m above this is masked (not played). */
  chipMaskedAbove: 0.75,
  /** absorbed: level = absorbTopDb + absorbSpanDb·(clamp01(log10(1+mass)/log10(26)) - 1). */
  absorbTopDb: -24,
  absorbSpanDb: 6,
  absorbMergeSec: 0.1,
  /** Terrain wall / bank hit, read from IcebergState.impact: d = impact - prev·exp(-2.5·dt). */
  wallRise: 0.12,
  wallSpan: 0.9,
  wallTopDb: -20,
  wallSpanDb: 14,
  /** enteredOcean: oceanDb + clamp(2·log2(mass/30), -3, +3). */
  oceanDb: -15,
  /** Calving (intro): fixed levels. */
  calveGroanDb: -22,
  calveCrackDb: -16,
  calveLandM: 0.7,
  /**
   * stoneBarrier: the first stone of a placement hit with m >= scatterFrom plays the hit, then
   * stone.scatter at its BREAK_LEVELS level for M = stoneM(the stone's mass, m) (rule F6).
   */
  scatterFrom: 0.45,
  /**
   * A rock or a barrier stone knocked moving (rule F6b): a hit with m >= tumbleFrom that gives the body
   * at least tumbleDv m/s (impulse / its mass) plays the hit, then stone.tumble at its BREAK_LEVELS level
   * for M = stoneM(mass, m), at rate tumbleRateTop - tumbleRateSlope·W(mass) (a small rock higher), once
   * per placement in 1.5 s. A graze, or a boulder that barely moved, is the hit alone.
   */
  tumbleFrom: 0.2,
  tumbleDv: 1,
  tumbleRateTop: 1.2,
  tumbleRateSlope: 0.35,
  /** Trees: from the third treeFelled within 1 s only the crack portion plays (layer gain -6 dB). */
  treeLodAfter: 2,
} as const;

// =================================================================================================
// 5. Obstacle kind -> sounds (exhaustive: a new ObstacleKind fails the typecheck here)
// =================================================================================================

export interface KindSounds {
  /** Hit when the body holds or is pushed (light variant). */
  readonly hit: SoundId;
  /** Replaces `hit` at m >= COLLISION_MAG.heavyFrom; null = keep `hit`. */
  readonly hitHeavy: SoundId | null;
  /** Main break layer for obstacleBroken / treeFelled; null = never breaks (or absorbed). */
  readonly brk: SoundId | null;
  /**
   * Up to two extra break layers (BREAK_LAYER_DB). In Story, debris.settle is appended for house,
   * timber and masonry breaks (those have at most one extra), so a request never exceeds maxLayers.
   */
  readonly brkLayers: readonly SoundId[];
  /** Hit layered with a glass pane when m exceeds this (vehicles); null = never. */
  readonly paneAbove: number | null;
}

const k = (
  hit: SoundId,
  hitHeavy: SoundId | null,
  brk: SoundId | null,
  brkLayers: readonly SoundId[] = [],
  paneAbove: number | null = null,
): KindSounds => ({ hit, hitHeavy, brk, brkLayers, paneAbove });

export const KIND_SOUNDS: Readonly<Record<ObstacleKind, KindSounds>> = {
  // Rocks never break: knocked moving, they tumble (stone.tumble, rule F6b).
  rockSmall: k('hit.stone.light', 'hit.stone.heavy', null),
  rockMedium: k('hit.stone.light', 'hit.stone.heavy', null),
  boulder: k('hit.stone.heavy', null, null),
  rockCluster: k('hit.stone.light', 'hit.stone.heavy', null),
  stoneBarrier: k('hit.stone.heavy', null, null), // never breaks: "breaking apart" = stone.scatter (F6)
  pine: k('hit.wood', null, 'tree.fall.pine'),
  broadleaf: k('hit.wood', null, 'tree.fall.broadleaf'),
  house: k('hit.masonry', null, 'house.collapse'),
  iceBlock: k('hit.ice', null, null), // absorbed -> ice.absorb
  iceField: k('hit.ice', null, null),
  car: k('hit.metal.panel', null, null, [], 0.6),
  truck: k('hit.metal.heavy', null, 'metal.break.vehicle', ['glass.pane'], 0.6),
  bus: k('hit.metal.heavy', null, 'metal.break.vehicle', ['glass.pane'], 0.6),
  fence: k('hit.wood', null, 'timber.break.light'),
  guardrail: k('hit.metal.panel', null, 'metal.break.light'),
  footbridge: k('hit.wood', null, 'timber.break.medium'),
  roadBridge: k('hit.stone.heavy', null, 'masonry.collapse.large'),
  railWagon: k('hit.metal.heavy', null, 'metal.break.vehicle'),
  boat: k('hit.wood', null, 'timber.break.medium'),
  dam: k('hit.stone.heavy', null, 'dam.break'),
  church: k('hit.masonry', null, 'masonry.collapse.large', ['glass.break']),
  waterTower: k('hit.metal.heavy', null, 'metal.break.structure', ['liquid.release']),
  lighthouse: k('hit.masonry', null, 'masonry.collapse.large', ['glass.pane']),
  apartmentBlock: k('hit.masonry', null, 'masonry.collapse.large', ['glass.break']),
  monument: k('hit.stone.heavy', null, 'masonry.collapse.small'),
  coolingTower: k('hit.masonry', null, 'masonry.collapse.large'),
  smokestack: k('hit.masonry', null, 'masonry.collapse.large'),
  tank: k('hit.metal.heavy', null, 'metal.break.structure', ['liquid.release']),
  factoryHall: k('hit.metal.heavy', null, 'metal.break.structure', ['machine.winddown']),
  pylon: k('hit.metal.heavy', null, 'metal.break.structure'),
  windTurbine: k('hit.metal.heavy', null, 'metal.break.structure', ['machine.winddown']),
  pumpjack: k('hit.metal.heavy', null, 'metal.break.structure', ['machine.winddown']),
  oilRig: k('hit.metal.heavy', null, 'metal.break.structure', ['machine.winddown', 'liquid.release']),
  pipeline: k('hit.metal.panel', 'hit.metal.heavy', 'metal.break.structure', ['liquid.release']),
  chalet: k('hit.wood', null, 'timber.collapse', ['glass.pane']),
  skiLiftPylon: k('hit.metal.panel', null, 'metal.break.light'),
  barn: k('hit.wood', null, 'timber.collapse'),
  silo: k('hit.masonry', null, 'masonry.collapse.small'),
  logPile: k('hit.wood', null, 'logs.tumble'),
  trafficLight: k('hit.metal.panel', null, 'metal.break.light', ['glass.pane']),
};

/** Machines that run while standing (P1 emitters) and the loop each plays. */
export type EmitterKind = 'pumpjack' | 'factory' | 'turbine' | 'rig';
export const EMITTER_FOR_KIND: Readonly<Partial<Record<ObstacleKind, EmitterKind>>> = {
  pumpjack: 'pumpjack',
  factoryHall: 'factory',
  windTurbine: 'turbine',
  oilRig: 'rig',
};
export const EMITTER_LOOP: Readonly<Record<EmitterKind, SoundId>> = {
  pumpjack: 'emitter.pumpjack',
  factory: 'emitter.factory',
  turbine: 'emitter.turbine',
  rig: 'emitter.rig',
};

// =================================================================================================
// 6. Spatial model
// =================================================================================================

/** Camera pose read from matrixWorld without allocation (position; right and forward, horizontal). */
export interface ListenerPose {
  px: number;
  py: number;
  pz: number;
  rightX: number;
  rightZ: number;
  fwdX: number;
  fwdZ: number;
}

export interface SpatialProfile {
  /** No attenuation inside refM. gain = (refM / max(d, refM))^rolloff. */
  readonly refM: number;
  readonly rolloff: number;
  /** Culled beyond this. */
  readonly maxM: number;
  /** pan = panLimit·sin(azimuth), StereoPannerNode (never hard-panned). */
  readonly panLimit: number;
}

export type SpatialClass = 'effects' | 'bells' | 'falls' | 'flood' | 'emitters';
export const SPATIAL: Readonly<Record<SpatialClass, SpatialProfile>> = {
  effects: { refM: 40, rolloff: 1, maxM: 600, panLimit: 0.5 },
  bells: { refM: 40, rolloff: 0.9, maxM: 1500, panLimit: 0.7 },
  falls: { refM: 20, rolloff: 1.1, maxM: 300, panLimit: 0.7 },
  flood: { refM: 40, rolloff: 0.8, maxM: 800, panLimit: 0.7 },
  emitters: { refM: 25, rolloff: 1.2, maxM: 250, panLimit: 0.7 },
};

/** Air absorption: lowpass = clamp(hzAtRef·(refM/d)^exponent, minHz, hzAtRef) beyond refM. */
export const AIR_LOWPASS = { hzAtRef: 16000, exponent: 0.7, minHz: 700 } as const;

// =================================================================================================
// 7. Event bridge input types (package C fills, package A plays)
// =================================================================================================

/**
 * One game event copied into the preallocated ring by the session listener (inside session.update).
 * Body facts are looked up AT LISTEN TIME (getBody), because the body can change state by the next
 * frame. Unused fields are 0 / -1 / null. Never allocate one per event: reuse ring slots.
 */
export interface QueuedEvent {
  seq: number;
  type: GameEvent['type'] | null;
  /** Animation frame counter when queued (coalescing is per frame). */
  frame: number;
  x: number;
  y: number;
  z: number;
  obstacleId: number;
  /** Body placement (index into level.obstacles), -1 for debris without an origin placement. */
  placement: number;
  kind: ObstacleKind | null;
  /** ObstacleBody.part ('churchTower', 'church', ...); null when unknown. */
  part: string | null;
  /** Broken / felled body mass (t); absorbed: merged mass. */
  massT: number;
  relSpeed: number;
  impulse: number;
  intensity: number;
  drop: number;
  speed: number;
  amount: number;
  /** waterfallCrossed cliff index. */
  index: number;
}

/** One buffer playback inside a request. */
export interface VoiceLayer {
  sound: SoundId;
  /** -1 = the engine's shuffle bag picks (no immediate repeat). */
  variant: number;
  /** Level before distance (dBFS at preMaster, sliders at 1). Jitter is added by the engine. */
  gainDb: number;
  rate: number;
  /** Timbre low-pass before air absorption (the engine applies min(lowpassHz, air)). */
  lowpassHz: number;
  /** Seconds after the request's start. */
  delaySec: number;
  /** LOD: dropped first under load (glass, settle tails, chip layers). */
  optional: boolean;
}

/**
 * One sound decision. Package C owns a small pool of these and reuses them; package A reads it
 * synchronously inside play() and never keeps a reference.
 */
export interface SoundRequest {
  family: SoundFamily;
  priority: Priority;
  layerCount: number;
  /** Always GLOBAL_LIMITS.maxLayers long; only the first layerCount are read. */
  readonly layers: VoiceLayer[];
  positional: boolean;
  x: number;
  y: number;
  z: number;
  /** Per-key limit key: obstacle id for hits, placement for breaks; -1 = none. */
  key: number;
  /** QueuedEvent.seq that caused it (trace join key). */
  cause: number;
  /** Seconds from now (ctx.currentTime + 0.005 + startDelaySec). */
  startDelaySec: number;
  /**
   * Space send for this request's strips; undefined = the session's ChapterMix.spaceSend. Only the
   * intro's calving sets it (ChapterMix.calveSend: the valley's echo).
   */
  send?: number;
}

export type DropReason =
  | 'quiet' // below the silent threshold
  | 'graze'
  | 'rate' // family or global bucket empty
  | 'perKey'
  | 'cap' // family or global voice cap and nothing to steal
  | 'frameCap'
  | 'overflow' // event ring overflow
  | 'coalesced' // merged into another request
  | 'masked' // e.g. chip under a big hit
  | 'notReady' // bank buffer not baked yet: silence, never a glitch
  | 'paused'
  | 'loading'
  | 'culled' // beyond SpatialProfile.maxM
  | 'busy' // busyVoices reached and priority too low
  | 'disabled' // session audio disabled after repeated errors
  | 'unavailable'; // no Web Audio

export interface PlayResult {
  /** Layers actually started (0 = dropped). */
  started: number;
  reason: DropReason | null;
}

// =================================================================================================
// 8. Ambience inputs and live voices (C computes inputs, B's voices make the sound)
// =================================================================================================

/** surfaceAt (grass, rock, sand, seabed) refined by paintAt (asphalt, gravel, dirt, rock). */
export type GroundKind = SurfaceKind | 'asphalt' | 'gravel' | 'dirt';

/** Scrape colour per ground: band-pass Q, grit amount 0..1, extra low-pass (0 = none). */
export const SURFACE_SCRAPE: Readonly<Record<GroundKind, { q: number; grit: number; lowpassHz: number }>> = {
  rock: { q: 1.4, grit: 1.0, lowpassHz: 0 },
  gravel: { q: 1.1, grit: 0.8, lowpassHz: 0 },
  asphalt: { q: 1.1, grit: 0.6, lowpassHz: 0 },
  sand: { q: 0.9, grit: 0.3, lowpassHz: 0 },
  dirt: { q: 0.8, grit: 0.4, lowpassHz: 1400 },
  grass: { q: 0.7, grit: 0.25, lowpassHz: 1200 },
  seabed: { q: 0.8, grit: 0.2, lowpassHz: 0 },
};

export interface WindCharacter {
  readonly bandHz: number;
  readonly q: number;
  /** +/- dB of gust swing and mean seconds between gust targets. */
  readonly gustDb: number;
  readonly gustSec: number;
  /** Long near-silent troughs between gusts (Act III). */
  readonly troughs: boolean;
}

export interface WindInputs {
  /** LEVEL_WIND for this level. */
  amount: number;
  /** Horizontal speed while airborne (m/s), else 0: the wind rises past the ears. */
  airSpeed: number;
}

export interface ScrapeInputs {
  /** grounded && !inOcean && !afloat (the integrator's own on-land test). */
  onLand: boolean;
  airborne: boolean;
  /** Shallow wading or seabed contact: the wade swish replaces grit. */
  wading: boolean;
  /** Horizontal speed (m/s). */
  speed: number;
  massT: number;
  radius: number;
  ground: GroundKind;
}

export interface WaterInputs {
  /** 0..1 loudness of the nearest moving water (river trail at the iceberg, or a stream channel). */
  level: number;
  /** m/s; busier babble as it rises. */
  flowSpeed: number;
  /** 0..1 foam; raises the top band. */
  turbulence: number;
  pan: number;
  /** Floating on inland water: lapping against the ice. */
  afloat: boolean;
}

export interface FallSlotInputs {
  active: boolean;
  /** 0..1 source strength from its flow (normalised by a pinned reference flow). */
  strength: number;
  /** SPATIAL.falls gain, air low-pass and pan for the current listener. */
  distGain: number;
  airLowpassHz: number;
  pan: number;
  /** 0..1 spray layer amount (1 inside 8 m, 0 beyond 40 m). */
  near: number;
}

export interface OceanInputs {
  /** 0 beyond 260 m of the coast, 1 at it or at sea. */
  proximity: number;
  atSea: boolean;
  /** Pan toward the sea (computeOceanFrame). */
  pan: number;
  /** 0..1 how fast the iceberg bobs (drives laps at sea). */
  bob: number;
}

export interface FloodInputs {
  /** 0..1 = max(sqrt(outflow/1500), downstream flood height term). */
  rush: number;
  distGain: number;
  airLowpassHz: number;
  pan: number;
}

export interface EmitterSlotInputs {
  kind: EmitterKind | null;
  /** False once its body stops standing: the voice runs down (wind-down) and never restarts. */
  running: boolean;
  distGain: number;
  airLowpassHz: number;
  pan: number;
}

/** Act colour applied to the ambience voices (from CHAPTER_MIX / ARCADE_MIX). */
export interface AmbienceTimbre {
  readonly wind: WindCharacter;
  /** dB on the water babble's top band (darker water in Act III). */
  readonly waterTopDb: number;
}

/**
 * Live loop voices, built by package B on a context, driven by package C at <= 30 Hz.
 * Every update() takes a reused input object, never allocates, and only calls setTargetAtTime when
 * a target moves by more than 1 %. Voices start silent and fade in from their first update.
 */
export interface AmbienceVoices {
  readonly wind: { update(i: WindInputs): void };
  readonly scrape: { update(i: ScrapeInputs): void };
  readonly water: { update(i: WaterInputs): void };
  /** Three slots; C assigns the two loudest sources and lets the third fade a reassigned one out. */
  readonly falls: readonly { update(i: FallSlotInputs): void }[];
  readonly ocean: { update(i: OceanInputs): void; /** enteredOcean: next wave 6 s later. */ surge(): void };
  readonly flood: { update(i: FloodInputs): void };
  /** Four slots (P1). */
  readonly emitters: readonly { update(i: EmitterSlotInputs): void }[];
  setTimbre(t: AmbienceTimbre): void;
  /** Fade everything to 0 over fadeSec, then stop and disconnect every source. Idempotent. */
  stop(fadeSec: number): void;
}

/** Shared noise for live voices (generated once per context, reused by every loop). */
export interface NoiseBank {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  /**
   * 30 s smooth random walks (0..1) connected straight to gain params: modulation with no JS. Their
   * roles are package B's own (CONTROL in src/audio/voices/noiseBank.ts); only B's voices read them.
   */
  readonly control: readonly AudioBuffer[];
}

export interface AmbienceOutputs {
  readonly ambience: AudioNode;
  /** Scrape goes to effects (it is the iceberg's own sound). */
  readonly effects: AudioNode;
  readonly space: AudioNode;
}

export type AmbienceVoiceFactory = (
  ctx: BaseAudioContext,
  out: AmbienceOutputs,
  noise: NoiseBank,
  bank: SoundBank,
  seed: number,
) => AmbienceVoices;

// =================================================================================================
// 9. Church bells
// =================================================================================================

export type BellVoicingId = 'pass-chapel' | 'st-brides' | 'clachan-kirk' | 'loch-kirk' | 'fjord-chapel';
export type BellForm = 'strike' | 'shiver' | 'clank';

/** Every church in the game: base placements only (story overlays add none). */
export interface ChurchBellDef {
  readonly levelId: AudioLevelId;
  /** Index into level.obstacles (identical in Arcade and the Story level). */
  readonly placement: number;
  readonly voicing: BellVoicingId;
  /** The Story landmark bound to this placement. */
  readonly landmarkId: string;
}

export const CHURCH_BELLS: readonly ChurchBellDef[] = [
  { levelId: 'alpine-pass', placement: 50, voicing: 'pass-chapel', landmarkId: 'pass-chapel' },
  { levelId: 'riverside-town', placement: 44, voicing: 'st-brides', landmarkId: 'st-brides' },
  { levelId: 'highland-maze', placement: 4, voicing: 'clachan-kirk', landmarkId: 'clachan-kirk' },
  { levelId: 'highland-maze', placement: 28, voicing: 'loch-kirk', landmarkId: 'loch-kirk' },
  { levelId: 'summit-labyrinth', placement: 29, voicing: 'fjord-chapel', landmarkId: 'fjord-chapel' },
];

/** Partials relative to the strike note (= prime): hum, prime, tierce, quint, nominal, then upper. */
export const BELL_PARTIAL_RATIOS = [0.5, 1, 1.2, 1.5, 2, 2.5, 2.667, 3, 4] as const;
/** Amplitudes relative to the nominal. */
export const BELL_PARTIAL_AMPS = [0.4, 0.55, 0.65, 0.2, 1, 0.45, 0.15, 0.25, 0.12] as const;
/** Reference T60 (s) per partial, before BellVoicing.t60Scale. */
export const BELL_PARTIAL_T60 = [14, 8, 6, 3, 4, 2.4, 1.8, 1.4, 1.0] as const;

export interface BellVoicing {
  /** Strike pitch (Hz). Tuned to a consonant degree of the chapter cue's key, except Clachan. */
  readonly strikeHz: number;
  readonly t60Scale: number;
  /** Strike interval within a phrase (s). */
  readonly strokeSec: number;
  readonly trimDb: number;
  /** Each partial is a seeded doublet split by this fraction range (slow natural warble). */
  readonly doubletSplit: readonly [number, number];
  /** The cracked bell (Clachan, 1911): ratio overrides and a short crack buzz. */
  readonly cracked?: {
    readonly humRatio: number;
    readonly tierceRatio: number;
    /** Prime doublet split (0.004 at 573.9 Hz = 2.3 Hz beat). */
    readonly primeSplit: number;
    /** Extra inharmonic partials (ratio, amp, T60 s). */
    readonly extra: readonly (readonly [number, number, number])[];
    /** Amplitude modulation on partials from the nominal up for the first buzzSec. */
    readonly buzzHz: number;
    readonly buzzDepth: number;
    readonly buzzSec: number;
    /** Faint rattle noise level (dB re strike). */
    readonly rattleDb: number;
  };
}

export const BELL_VOICINGS: Readonly<Record<BellVoicingId, BellVoicing>> = {
  // ch3 cue 'unease' (A minor): E5, the dominant. Small bell (scale 0.6): shorter ring.
  'pass-chapel': { strikeHz: 659.26, t60Scale: 0.7, strokeSec: 2.0, trimDb: -2, doubletSplit: [0.0005, 0.0015] },
  // ch4 cue 'cost' (E minor): B4, the dominant. The reference voicing.
  'st-brides': { strikeHz: 493.88, t60Scale: 1.0, strokeSec: 2.4, trimDb: 0, doubletSplit: [0.0005, 0.0015] },
  // ch8: D5 - 40 cents. "Rang a note slightly wrong, like someone humming a hymn they half know."
  'clachan-kirk': {
    strikeHz: 573.92,
    t60Scale: 0.45,
    strokeSec: 2.4,
    trimDb: 0,
    doubletSplit: [0.0005, 0.0015],
    cracked: {
      humRatio: 0.485,
      tierceRatio: 1.17,
      primeSplit: 0.004,
      extra: [
        [1.37, 0.3, 1.2],
        [3.31, 0.3, 1.2],
      ],
      buzzHz: 31,
      buzzDepth: 0.35,
      buzzSec: 0.4,
      rattleDb: -20,
    },
  },
  // ch8 cue 'remains' (G major): G4, true. The player can compare it with the cracked one.
  'loch-kirk': { strikeHz: 392.0, t60Scale: 1.15, strokeSec: 2.8, trimDb: 0, doubletSplit: [0.0005, 0.0015] },
  // ch9 cue 'thaw' (F major): C5, the dominant. Scale 0.85.
  'fjord-chapel': { strikeHz: 523.25, t60Scale: 0.85, strokeSec: 2.2, trimDb: -1, doubletSplit: [0.0005, 0.0015] },
};

export const BELL_BAKE = {
  sampleRate: 24000,
  strikeSec: 9,
  shiverSec: 4,
  clankSec: 1.5,
  /** Cosine fade over the last second of the strike buffer. */
  endFadeSec: 1,
  /** Strike transient: 5 ms noise burst into a 3 kHz band-pass, and a 400 Hz low-passed clapper thunk. */
  transientDb: -14,
  thunkDb: -20,
  /** Shiver: hum, prime and tierce only, no transient. Clank: all partials, T60 x 0.06, LP 2.5 kHz. */
  clankT60Scale: 0.06,
  clankLowpassHz: 2500,
} as const;

/** The clock's behaviour (BellScheduler, package C). Strokes are never a toll: see DESIGN.md §7.4. */
export const BELL_PATTERN = {
  /** Peak level of a strike at 40 m (dBFS). */
  strikeDbAt40m: -18,
  /** Background phrases: 2..4 strokes, never 1. */
  phraseStrokesMin: 2,
  phraseStrokesMax: 4,
  phraseGapSec: [45, 75] as const,
  firstPhraseSec: [6, 14] as const,
  /** Two churches in one level keep their phrases at least this far apart. */
  churchOffsetSec: 20,
  /** First stroke velocity 1, then 0.85 +/- 0.05. */
  laterVelocity: 0.85,
  laterVelocityJitter: 0.05,
  /** The approach hour: once per church per attempt, while 'playing'. */
  hourStrokesStory: 6,
  hourStrokesArcade: 3,
  /** Start when predicted time-to-arrival <= strokes·strokeSec + hourLeadSec ... */
  hourLeadSec: 3,
  /** ... within a trigger radius clamped to this range (m). */
  hourRadiusM: [120, 600] as const,
  /** Shiver when the tower holds a blow: shake amp >= this, gain 0.25 + 0.5·amp (<= 0.6), cooldown. */
  shiverFromAmp: 0.15,
  shiverCooldownSec: 3,
  /** Silencing: choke ringing strikes with this time constant; dull clank this long after the fall. */
  chokeTauSec: 0.025,
  clankDelaySec: 1.1,
  clankDb: -10,
  /** Scheduling lookahead; a stroke more than skipLateSec in the past is skipped (no catch-up). */
  lookaheadSec: 0.25,
  skipLateSec: 0.3,
  /** Bell position: tower body origin (its foot) + belfryM·scale up. */
  belfryM: 15.5,
} as const;

export interface BellRequest {
  /** Index into this session's church list (0..4 per level; never more than 2 in practice). */
  slot: number;
  voicing: BellVoicingId;
  form: BellForm;
  /** AudioContext time. */
  when: number;
  velocity: number;
  gainLin: number;
  lowpassHz: number;
  pan: number;
}

/** A long positional voice: C updates distance and pan at 10 Hz while it rings. */
export interface PositionalVoice {
  readonly endsAt: number;
  update(gainLin: number, lowpassHz: number, pan: number): void;
  choke(tauSec: number): void;
}

// =================================================================================================
// 10. Music: the router over the existing HTMLAudio player, holds and ducks
// =================================================================================================

/** While any hold is active the router plays cue null (the player's own 3 s fade-out, then pause). */
export type MusicHoldKey = 'reveal' | 'epilogue' | 'card' | 'act3Entry';

export type DuckKey =
  | 'pause'
  | 'fail'
  | 'makeRoom'
  | 'aftermath'
  | 'landmark'
  | 'church'
  | 'dam'
  | 'seaCh9'
  | 'reading'
  | 'readingRiver'
  | 'epilogueReading'
  | 'act3Entry'
  | 'scar'
  | 'preview';

/**
 * dB per channel, each <= 0 (asserted). 'music' acts on the recorded music only (via the router): the
 * motif is never ducked, because it only ever plays inside a hold, as the one sound of that moment.
 */
export interface DuckLevels {
  readonly music: number;
  readonly ambience: number;
  readonly effects: number;
}

export interface DuckPreset {
  /** Levels by mode; null = this duck does not apply in that mode. */
  readonly story: DuckLevels | null;
  readonly arcade: DuckLevels | null;
  readonly attackSec: number;
  /** Seconds held after the attack, or 'untilRelease' (released by its owner or by session end). */
  readonly holdSec: number | 'untilRelease';
  readonly releaseSec: number;
}

const dl = (music: number, ambience = 0, effects = 0): DuckLevels => ({ music, ambience, effects });

export const DUCK_PRESETS: Readonly<Record<DuckKey, DuckPreset>> = {
  pause: { story: dl(-8), arcade: dl(-8), attackSec: 0.3, holdSec: 'untilRelease', releaseSec: 0.3 },
  fail: { story: dl(-12), arcade: dl(-6), attackSec: 2, holdSec: 'untilRelease', releaseSec: 2 },
  makeRoom: { story: dl(-3, -4), arcade: dl(-3, -4), attackSec: 0.06, holdSec: 1.5, releaseSec: 1.2 },
  // music depth and release come from CHAPTER_MIX (aftermathDb / aftermathReleaseSec); -5 is a placeholder.
  aftermath: { story: dl(-5), arcade: null, attackSec: 0.6, holdSec: 1, releaseSec: 4 },
  landmark: { story: dl(-10, -2), arcade: null, attackSec: 1.5, holdSec: 6, releaseSec: 8 },
  church: { story: dl(-14, -3), arcade: null, attackSec: 1.5, holdSec: 10, releaseSec: 10 },
  dam: { story: dl(-10), arcade: dl(-4), attackSec: 1, holdSec: 'untilRelease', releaseSec: 6 },
  seaCh9: { story: dl(-10), arcade: null, attackSec: 4, holdSec: 'untilRelease', releaseSec: 3 },
  reading: { story: dl(-6, -8, -12), arcade: null, attackSec: 2.5, holdSec: 'untilRelease', releaseSec: 3 },
  readingRiver: { story: dl(-6, -2, -6), arcade: null, attackSec: 1, holdSec: 'untilRelease', releaseSec: 2 },
  // Ambience -14 (was -6), lead decision L1b: the world falls back for the story's last motif.
  epilogueReading: { story: dl(-8, -14, -12), arcade: null, attackSec: 2.5, holdSec: 'untilRelease', releaseSec: 4 },
  // Applied at full depth the instant the act3Entry hold releases, then released over 6 s.
  act3Entry: { story: dl(-12), arcade: null, attackSec: 0, holdSec: 0, releaseSec: 6 },
  // Story: the persistent scar of the attempt; music depth = accumulated CHAPTER_MIX.scarDb (capped).
  scar: { story: dl(0), arcade: null, attackSec: 4, holdSec: 'untilRelease', releaseSec: 4 },
  // Settings preview: the music dips while a preview sound plays.
  preview: { story: dl(-6), arcade: dl(-6), attackSec: 0.1, holdSec: 0.8, releaseSec: 0.5 },
};

/**
 * During play the product of music ducks never goes below this (holds are not ducks). The engine
 * floors the ambience and effects duck sums at the same level.
 */
export const PLAY_DUCK_FLOOR_DB = -20;
/** Aftermath ducks: the deepest active one wins; repeats extend the hold up to this. */
export const AFTERMATH_MAX_HOLD_SEC = 10;
/** A Story loss with at least this many STORY_POINTS (deduped per placement) triggers an aftermath. */
export const AFTERMATH_MIN_POINTS = 100;
/** Delay from the break to the aftermath duck's attack. */
export const AFTERMATH_DELAY_SEC = 0.3;
/** Every hold releases by itself this long after its scheduled end (never stuck silent). */
export const HOLD_SAFETY_SEC = 10;
/** And no hold lasts longer than this in total. */
export const HOLD_MAX_SEC = 60;
/**
 * How often the router steps duck ramps. While a ramp moves it calls music.setVolume only on a
 * change > ROUTER_MIN_STEP or > 2% of the level (the absolute step alone leaves a quiet setting
 * several dB off), and it sends the exact value once the ramps have settled.
 */
export const ROUTER_TICK_MS = 50;
export const ROUTER_MIN_STEP = 0.002;

export interface MusicRouterState {
  readonly cue: MusicCue | null;
  readonly playing: MusicCue | null;
  readonly holds: readonly MusicHoldKey[];
  /** Active ducks on the recording, in dB (current, not target). */
  readonly ducks: Readonly<Partial<Record<DuckKey, number>>>;
  /**
   * Where each active duck on the recording is heading, in dB: its target while it attacks or
   * holds, its current level once it releases (a moment sets its motif against these).
   */
  readonly targets: Readonly<Partial<Record<DuckKey, number>>>;
  /** Product of the ducks after the floor, and the trim, in dB. */
  readonly duckDb: number;
  readonly trimDb: number;
  /** What the router last passed to music.setVolume / setMuted. */
  readonly volume: number;
  readonly muted: boolean;
  readonly hidden: boolean;
}

/**
 * The only caller of music.play / setVolume / setMuted / unlock after this change. The existing
 * player is untouched apart from one additive export (musicPlayer, the concrete instance).
 * Effective volume = master · music · 10^((trimDb + duckDb)/20); muted = musicMuted || soundMuted ||
 * hidden. Every method is idempotent (StrictMode double effects).
 */
export interface MusicRouter {
  setCue(cue: MusicCue | null): void;
  setLevels(levels: AudioLevels): void;
  setHidden(hidden: boolean): void;
  /** Mode / chapter bed trim, <= 0 dB. */
  setTrim(db: number): void;
  /**
   * Holds are a set keyed by MusicHoldKey, not reference counted: holding a held key does nothing,
   * and one release lets it go however many times it was held (the director and the attempt's
   * Story audio both take 'act3Entry').
   */
  hold(key: MusicHoldKey): void;
  release(key: MusicHoldKey): void;
  /** Ramp the recording's duck for `key` to db (<= 0) over attackSec (linear in dB). */
  duck(key: DuckKey, db: number, attackSec: number): void;
  unduck(key: DuckKey, releaseSec: number): void;
  unlock(): void;
  state(): MusicRouterState;
}

export interface MusicRouterOptions {
  readonly player: MusicPlayer;
  readonly ticker: FadeTicker;
}

// =================================================================================================
// 11. Story progression (mix per chapter) and the Arcade mix
// =================================================================================================

export interface ChapterMix {
  /** Music bed relative to the slider (dB, <= 0). */
  readonly musicBedDb: number;
  /** 'afterCaption': hold 'act3Entry' from loading until the opening caption ends (6.5 s of play). */
  readonly musicEntry: 'flyover' | 'afterCaption';
  readonly wind: WindCharacter;
  readonly waterTopDb: number;
  readonly effectsShelfDb: number;
  /** Space send for effects strips. */
  readonly spaceSend: number;
  /** Calving echo send (the valley gets bigger and emptier). */
  readonly calveSend: number;
  /** Aftermath duck depth and release (0 = none). */
  readonly aftermathDb: number;
  readonly aftermathReleaseSec: number;
  /** Persistent scar per significant loss, and its cap, within one attempt (dB, applied to music). */
  readonly scarDb: number;
  readonly scarMaxDb: number;
  /** Story-only settle tails (debris.settle) on structural failures. */
  readonly settleTails: boolean;
  readonly hourStrokes: number;
}

const WIND_WARM: WindCharacter = { bandHz: 380, q: 0.7, gustDb: 4, gustSec: 2.8, troughs: false };
const WIND_COOL: WindCharacter = { bandHz: 450, q: 0.9, gustDb: 4, gustSec: 2.6, troughs: false };
const WIND_TOWN: WindCharacter = { bandHz: 340, q: 0.8, gustDb: 3, gustSec: 3.2, troughs: false };
const WIND_ICY: WindCharacter = { bandHz: 520, q: 1.2, gustDb: 5, gustSec: 2.4, troughs: false };
const WIND_WORKS: WindCharacter = { bandHz: 300, q: 0.8, gustDb: 3, gustSec: 3.5, troughs: false };
const WIND_THIN: WindCharacter = { bandHz: 720, q: 1.8, gustDb: 7, gustSec: 4, troughs: true };

const act1 = {
  waterTopDb: 0, effectsShelfDb: 0, spaceSend: 0.1, calveSend: 0.25, scarDb: 0.25, scarMaxDb: 1.5,
} as const;
const act2 = {
  waterTopDb: -1, effectsShelfDb: -2, spaceSend: 0.14, calveSend: 0.25, scarDb: 0.5, scarMaxDb: 3,
} as const;
const act3 = {
  waterTopDb: -4, effectsShelfDb: -3, spaceSend: 0.2, calveSend: 0.35, scarDb: 0.75, scarMaxDb: 4,
} as const;
const story = { settleTails: true, hourStrokes: 6 } as const;

export const CHAPTER_MIX: Readonly<Record<ChapterId, ChapterMix>> = {
  'ch1-beginning': {
    ...act1,
    ...story,
    musicBedDb: 0,
    musicEntry: 'flyover',
    wind: WIND_WARM,
    aftermathDb: -2,
    aftermathReleaseSec: 2,
  },
  'ch2-measurements': {
    ...act1,
    ...story,
    musicBedDb: 0,
    musicEntry: 'flyover',
    wind: WIND_WARM,
    aftermathDb: -2,
    aftermathReleaseSec: 2,
  },
  'ch3-warning': {
    ...act1,
    ...story,
    musicBedDb: -1,
    musicEntry: 'flyover',
    wind: WIND_COOL,
    aftermathDb: -3,
    aftermathReleaseSec: 2,
  },
  'ch4-people': {
    ...act2,
    ...story,
    musicBedDb: -2,
    musicEntry: 'flyover',
    wind: WIND_TOWN,
    aftermathDb: -5,
    aftermathReleaseSec: 4,
  },
  'ch5-denial': {
    ...act2,
    ...story,
    musicBedDb: -2,
    musicEntry: 'flyover',
    wind: WIND_ICY,
    aftermathDb: -5,
    aftermathReleaseSec: 4,
  },
  'ch6-price': {
    ...act2,
    ...story,
    musicBedDb: -3,
    musicEntry: 'flyover',
    wind: WIND_WORKS,
    aftermathDb: -6,
    aftermathReleaseSec: 4,
  },
  'ch7-escape': {
    ...act3,
    ...story,
    musicBedDb: -4,
    musicEntry: 'afterCaption',
    wind: WIND_THIN,
    aftermathDb: -8,
    aftermathReleaseSec: 6,
  },
  'ch8-remains': {
    ...act3,
    ...story,
    musicBedDb: -5,
    musicEntry: 'afterCaption',
    wind: WIND_THIN,
    aftermathDb: -8,
    aftermathReleaseSec: 6,
  },
  'ch9-last-thaw': {
    ...act3,
    ...story,
    musicBedDb: -5,
    musicEntry: 'afterCaption',
    wind: WIND_THIN,
    aftermathDb: -8,
    aftermathReleaseSec: 6,
  },
};

/** Arcade: the same world, lighter. Music trimmed 2 dB under the effects; no narrative ducks. */
export const ARCADE_MIX: ChapterMix = {
  ...act1,
  scarDb: 0,
  scarMaxDb: 0,
  musicBedDb: -2,
  musicEntry: 'flyover',
  wind: WIND_WARM,
  aftermathDb: 0,
  aftermathReleaseSec: 0,
  settleTails: false,
  hourStrokes: 3,
};

/** The Arcade game screen plays this cue (Mozart K.545, then the Chopin waltz). Menus stay silent. */
export const ARCADE_CUE: MusicCue = 'wonder';

// =================================================================================================
// 12. The Archive motif, "No. 14" (original, 2026), and the felt piano
// =================================================================================================

export type MotifVariantId = 'act1' | 'act2' | 'act3' | 'act3-bare' | 'ch8' | 'epilogue';

export interface MotifNote {
  /** Onset in beats from the start. */
  readonly beat: number;
  /** Written length in beats (released at the first pedal lift at or after onset + beats). */
  readonly beats: number;
  /** MIDI note number (60 = C4). */
  readonly midi: number;
  /** Velocity 0..1 (felt piano: 0.15 pp .. 0.55 mp). */
  readonly vel: number;
  readonly hand: 'R' | 'L';
}

export interface MotifScore {
  readonly bpm: number;
  readonly beatsPerBar: 3;
  readonly totalBeats: number;
  /** Linear tempo change from fromBeat to the end. */
  readonly ritardando?: { readonly fromBeat: number; readonly toBpm: number };
  /** Extra beats held on the final onset (fermata). */
  readonly fermataBeats: number;
  /** Beats at which the pedal lifts (dampers close on every note due by then). */
  readonly pedalLifts: readonly number[];
  /** Ring-out after the last beat (s). */
  readonly tailSec: number;
  readonly notes: readonly MotifNote[];
}

/** The untuned piano at No. 14 Church Lane ("nobody had tuned since 2020", ch4.ts:209). */
export const MOTIF_TUNING = {
  /** The whole instrument has gone flat: A4 = 440·2^(-10/1200). */
  a4Hz: 437.47,
  /**
   * Two strings per note (n <= 4 partials twinned), detuned +/- at most this many cents: the
   * renderer caps each unison so it beats no faster than 0.65 Hz (0.8 cents on G5 would beat at
   * 0.72 Hz, against the test plan's "under 0.7 Hz"). The untuned keys below are not capped.
   */
  unisonCents: 0.8,
  /** The untuned keys: D4 and D5 strings at +/- 4 cents (a 2.7 Hz waver on D5). */
  untunedKeys: { 62: 4, 74: 4 } as Readonly<Record<number, number>>,
} as const;

const R = (beat: number, beats: number, midi: number, vel: number): MotifNote =>
  ({ beat, beats, midi, vel, hand: 'R' });
const L = (beat: number, beats: number, midi: number, vel: number): MotifNote =>
  ({ beat, beats, midi, vel, hand: 'L' });

/** The cell, identical at the start of every variant: F4 A4 E5 | D5 (a reach, an imperfect landing). */
const CELL = (v: number): MotifNote[] => [R(0, 1, 65, v), R(1, 1, 69, v), R(2, 1, 76, v), R(3, 3, 74, v)];

export const MOTIF_SCORES: Readonly<Record<MotifVariantId, MotifScore>> = {
  // Act I (ch1-3 revelations): mp, ends on the dominant G5 over C: an open question.
  act1: {
    bpm: 66,
    beatsPerBar: 3,
    totalBeats: 12,
    fermataBeats: 0,
    pedalLifts: [3, 6, 9],
    tailSec: 3,
    notes: [
      ...CELL(0.5),
      R(6, 1, 72, 0.5), R(7, 1, 74, 0.5), R(8, 1, 76, 0.52), R(9, 3, 79, 0.48),
      L(0, 3, 41, 0.38), L(0, 3, 48, 0.36), L(3, 3, 46, 0.38), L(3, 3, 53, 0.36),
      L(6, 3, 45, 0.38), L(6, 3, 52, 0.36), L(9, 3, 48, 0.36), L(9, 3, 55, 0.34),
    ],
  },
  // Act II (ch4-6): p, Dm - Gm - Bb, ends on A over an open fifth (no third): hanging.
  act2: {
    bpm: 58,
    beatsPerBar: 3,
    totalBeats: 15,
    fermataBeats: 0,
    pedalLifts: [3, 6, 9, 12],
    tailSec: 4,
    notes: [
      ...CELL(0.42),
      R(6, 1, 72, 0.42), R(7, 1, 70, 0.4), R(8, 1, 69, 0.38), R(9, 3, 67, 0.38), R(12, 3, 69, 0.34),
      L(0, 3, 41, 0.32), L(0, 3, 48, 0.3), L(3, 3, 38, 0.32), L(3, 3, 45, 0.3),
      L(6, 3, 43, 0.32), L(6, 3, 50, 0.3), L(9, 3, 46, 0.3), L(9, 3, 53, 0.28),
      L(12, 3, 45, 0.28), L(12, 3, 52, 0.26),
    ],
  },
  // Act III (ch7): pp, a rest bar where the answer should be, then the untuned D an octave down.
  act3: {
    bpm: 50,
    beatsPerBar: 3,
    totalBeats: 12,
    fermataBeats: 0,
    pedalLifts: [3, 9],
    tailSec: 5,
    notes: [...CELL(0.3), R(9, 3, 62, 0.26), L(3, 3, 38, 0.18)],
  },
  // Act III (ch9): the same with no left hand at all.
  'act3-bare': {
    bpm: 50,
    beatsPerBar: 3,
    totalBeats: 12,
    fermataBeats: 0,
    pedalLifts: [3, 9],
    tailSec: 5,
    notes: [...CELL(0.3), R(9, 3, 62, 0.26)],
  },
  // Ch8 (card and revelation): starts again, stops after two notes: "a hymn they half know".
  ch8: {
    bpm: 50,
    beatsPerBar: 3,
    totalBeats: 12,
    fermataBeats: 0,
    pedalLifts: [3, 6],
    tailSec: 4,
    notes: [...CELL(0.3), R(6, 1, 65, 0.28), R(7, 5, 69, 0.26), L(3, 3, 38, 0.22), L(3, 3, 45, 0.2)],
  },
  // Epilogue (after ch9 only): the game's only full close, V - I onto F. The D5 stays untuned.
  epilogue: {
    bpm: 48,
    beatsPerBar: 3,
    totalBeats: 21,
    ritardando: { fromBeat: 15, toBpm: 40 },
    fermataBeats: 1.5,
    pedalLifts: [3, 6, 9, 12, 15, 18],
    tailSec: 5,
    notes: [
      R(0, 1, 65, 0.3), R(1, 1, 69, 0.31), R(2, 1, 76, 0.32), R(3, 3, 74, 0.33),
      R(6, 1, 72, 0.36), R(7, 1, 70, 0.37), R(8, 1, 69, 0.38),
      R(9, 1, 67, 0.4), R(10, 1, 69, 0.41), R(11, 1, 70, 0.42),
      R(12, 3, 69, 0.38), R(15, 2, 67, 0.35), R(17, 1, 64, 0.33), R(18, 3, 65, 0.32),
      L(0, 3, 41, 0.26), L(0, 3, 48, 0.24), L(3, 3, 46, 0.26), L(3, 3, 53, 0.24),
      L(6, 3, 43, 0.27), L(6, 3, 50, 0.25), L(9, 3, 48, 0.28), L(9, 3, 55, 0.26),
      L(12, 3, 38, 0.27), L(12, 3, 45, 0.25), L(15, 3, 48, 0.26), L(15, 3, 55, 0.24),
      L(18, 3, 41, 0.25), L(18, 3, 48, 0.24), L(18, 3, 57, 0.22),
    ],
  },
};

/** Revelation motif per chapter (played only if >= 1 human fragment surfaced and narrative is on). */
export const REVELATION_MOTIF: Readonly<Record<ChapterId, MotifRequest>> = {
  'ch1-beginning': { variant: 'act1', tempoScale: 1 },
  'ch2-measurements': { variant: 'act1', tempoScale: 1 },
  'ch3-warning': { variant: 'act1', tempoScale: 0.94 },
  'ch4-people': { variant: 'act2', tempoScale: 1 },
  'ch5-denial': { variant: 'act2', tempoScale: 1 },
  'ch6-price': { variant: 'act2', tempoScale: 1 },
  'ch7-escape': { variant: 'act3', tempoScale: 1 },
  'ch8-remains': { variant: 'ch8', tempoScale: 1 },
  'ch9-last-thaw': { variant: 'act3-bare', tempoScale: 1 },
};

/** Chapter cards that play the motif (once per chapter per app session): only Mara's naming letter. */
export const CARD_MOTIF: Readonly<Partial<Record<ChapterId, MotifVariantId>>> = { 'ch8-remains': 'ch8' };
export const EPILOGUE_MOTIF: MotifVariantId = 'epilogue';

/**
 * The motif renders' integrated loudness (LUFS-I) through motifBus at music 1, before MOTIF_CALIB_DB,
 * keyed `${variant}@${tempoScale}` (R10: Chrome 155, package B's BS.1770; renders are deterministic).
 */
export const MOTIF_RENDER_LUFS: Readonly<Record<string, number>> = {
  'act1@1': -29.07,
  'act1@0.94': -28.23,
  'act2@1': -28.99,
  'act3@1': -28.13,
  'act3-bare@1': -28.71,
  'ch8@1': -29.14,
  'epilogue@1': -30.56,
};

/** Lead decision L1: a moment's motif sits at least this far under its chapter's recording at that moment. */
export const MOTIF_UNDER_RECORDING_LU = 1;

/**
 * Each moment's motif trim (dB, <= 0) on top of MOTIF_CALIB_DB (lead decision L1, 2026-10-22: the
 * motif must never sit louder than its chapter's own recording; the moments lower or remove the music,
 * they never make it louder). The reference is the chapter's recording at that moment: the
 * loudness-matched recording at the chapter's bed (CHAPTER_MIX.musicBedDb; 0 on the chapter card)
 * under the moment's own reading level (DUCK_PRESETS.reading -6 dB for a Revelation, epilogueReading
 * -8 dB for the epilogue, none on the card), which is where the recording comes back after the motif.
 * Each trim puts the motif's integrated loudness at least MOTIF_UNDER_RECORDING_LU under that, from
 * MOTIF_RENDER_LUFS, rounded down to 0.5 dB (moments.test.ts recomputes it; the lab measures it, R7).
 * The ducks that stay on the recording until the attempt ends (the attempt's scar, chapter 9's sea:
 * src/audio/story/moments.ts PERSISTENT_DUCKS) are subtracted from the motif when it is scheduled, at
 * their targets and as far as the router's floor lets the recording go, so the margin holds with every
 * duck included. The game completes a run only in the ocean, so in chapter 9 the sea duck is on at
 * the Revelation and the epilogue, and both motifs play 10 dB under these trims as well.
 */
export const MOTIF_MOMENT_TRIM_DB: {
  readonly reveal: Readonly<Record<ChapterId, number>>;
  readonly card: Readonly<Partial<Record<ChapterId, number>>>;
  readonly epilogue: number;
} = {
  reveal: {
    'ch1-beginning': -4,
    'ch2-measurements': -4,
    'ch3-warning': -6,
    'ch4-people': -6.5,
    'ch5-denial': -6.5,
    'ch6-price': -7.5,
    'ch7-escape': -9,
    'ch8-remains': -9,
    'ch9-last-thaw': -9.5,
  },
  card: { 'ch8-remains': 0 },
  epilogue: -9.5,
};

/** Moment timing (seconds from the trigger). */
export const MOMENT_TIMING = {
  revealMotifAtSec: 4.0,
  revealSilenceAfterSec: 4.0,
  epilogueMotifAtSec: 4.5,
  epilogueSilenceAfterSec: 6.0,
  cardMotifAtSec: 1.2,
  cardSilenceAfterSec: 2.0,
  /** Leaving mid-motif. */
  motifFadeOnLeaveSec: 1.5,
  /** If the motif buffer is not baked by its start time it is skipped and the hold releases. */
  motifLateReleaseSec: 0.5,
  /** The opening caption's length (StoryGame CAPTION_MS = 6500). */
  captionSec: 6.5,
  /** act3Entry release when narrative is off (no caption is shown). */
  act3EntryNoCaptionSec: 3,
  /** StrictMode dedupe for mount-keyed triggers. */
  dedupeSec: 1,
} as const;

/** Felt piano voice (package B). Formulas in DESIGN.md §8.5. */
export const FELT_PIANO = {
  sampleRate: 24000,
  maxPartials: 12,
  maxPartialHz: 9000,
  /** Inharmonicity B by register: below C3, C3..C5, above C5. */
  inharmonicity: [0.00012, 0.00025, 0.0004] as const,
  /** Hammer strike point 1/8: a_n *= |sin(pi·n/8)|. */
  strikePoint: 8,
  /** Felt cutoff: e^(-n·f0 / (feltBaseHz + feltVelHz·v)). */
  feltBaseHz: 800,
  feltVelHz: 2600,
  attackMs: [4, 7] as const,
  thumpDb: -24,
  thumpLowpassHz: 350,
  keyClickDb: -32,
  damperTauSec: 0.12,
  pedalLiftTauSec: 0.35,
  /** Small front room baked in: 4 combs + 2 all-passes, RT60, wet level, wet low-pass. */
  roomRt60Sec: 1.3,
  roomWetDb: -14,
  roomLowpassHz: 4000,
  /** Peak target of a rendered phrase before the music channel gain (calibrated against recordings). */
  peakDb: -14,
} as const;

// The Vey strings (a piano struck inside a destroyed house) were cut by the lead on 2026-10-21: heard
// from a house that just fell, a piano could read as someone at home, which the story never implies.

// =================================================================================================
// 13. Which documents count as "human" (the motif is tied to them)
// =================================================================================================

export const HUMAN_DOCUMENT_RULE = {
  /** Human if written by a person: letter or memory whose author is not in INSTITUTIONS (bible.ts). */
  personalKinds: ['letter', 'memory'] as readonly DocumentKind[],
  /** A caption whose title starts with this is a photograph. */
  photographKind: 'caption' as DocumentKind,
  photographTitlePrefix: 'Photograph',
  /** A record written by a character id from BIBLE.characters (a personal log). */
  characterRecordKind: 'record' as DocumentKind,
} as const;

// =================================================================================================
// 14. Engine-facing interfaces
// =================================================================================================

export type ContextStatus = 'unavailable' | 'locked' | 'starting' | 'running' | 'suspended';

export interface SessionAudioInfo {
  readonly levelId: AudioLevelId;
  readonly mode: GameMode;
  readonly chapterId: ChapterId | null;
  readonly attempt: number;
  readonly mix: ChapterMix;
}

/** Per attempt. Created at session creation, ended in the component's cleanup. Never throws. */
export interface SessionAudio {
  readonly token: number;
  readonly info: SessionAudioInfo;
  /** Seeded stream for this session: hash(SEED, levelId, attempt, stream). */
  rng(stream: RngStream): () => number;
  play(req: SoundRequest): PlayResult;
  playBell(req: BellRequest): PositionalVoice | null;
  /**
   * True once this voicing's strike is baked (or when nothing could ever play it). The bell scheduler
   * defers a phrase or the hour until then: bells are background, so late is fine and lost is not.
   */
  bellReady(voicing: BellVoicingId): boolean;
  /** Null until the bank and noise are ready (C retries each frame). */
  readonly ambience: AmbienceVoices | null;
  setListener(pose: Readonly<ListenerPose>): void;
  /**
   * Lifecycle owned by the engine: the pause gate (effects + ambience to 0 in 120 ms; sources keep
   * running), the loading gate, and the 'pause' and 'fail' music ducks for this session's mode.
   */
  setPhase(phase: GamePhase, loading: boolean): void;
  /** Store-level frame counter for per-frame admission caps. */
  beginFrame(frame: number): void;
  /** Session-scoped ducks (released automatically by end()). levels null = release. */
  duck(key: DuckKey, levels: DuckLevels | null): void;
  /** True when window.__icebergAudio is installed; build TraceEntry objects only then. */
  readonly tracing: boolean;
  trace(entry: TraceEntry): void;
  /** Bell scheduler snapshot for state() (C pushes it on change, at most 2 Hz). */
  reportBells(bells: AudioState['bells']): void;
  /** Fade every voice, loop and bell of this session to 0 over fadeSec, stop, disconnect. Idempotent. */
  end(fadeSec?: number): void;
}

export interface MotifHandle {
  readonly startsAt: number;
  readonly endsAt: number;
  stop(fadeSec: number): void;
}

/** A motif bake is keyed by variant and tempo (ch3 plays act1 at 0.94: a slower bake, never a rate change). */
export interface MotifRequest {
  readonly variant: MotifVariantId;
  readonly tempoScale: number;
}

/** A level's bake set. A new level request replaces the previous one (core sounds always stay). */
export interface LevelSoundSet {
  readonly sounds: readonly SoundId[];
  readonly bells: readonly BellVoicingId[];
  readonly motifs: readonly MotifRequest[];
}

/** App lifetime singleton (src/audio/manager.ts exports `audio`). NullAudioManager without Web Audio. */
export interface AudioManager {
  readonly available: boolean;
  readonly seed: number;
  status(): ContextStatus;
  /** Inside a trusted gesture; constructs only if navigator.userActivation.isActive (when present). */
  unlock(): void;
  applySettings(levels: AudioLevels): void;
  setHidden(hidden: boolean): void;
  readonly music: MusicRouter;
  /** App-scoped ducks (reading, epilogue, pause...). levels null = release with the preset's release. */
  duck(key: DuckKey, levels: DuckLevels | null, mode: GameMode): void;
  /**
   * Null when unavailable, muted, or the buffer is not baked; never plays two motifs at once. gainDb
   * (<= 0, default 0) is the moment's own trim (MOTIF_MOMENT_TRIM_DB plus the ducks that stay on the
   * recording until the attempt ends: the scar, chapter 9's sea), on top of the music slider and
   * MOTIF_CALIB_DB.
   */
  playMotif(motif: MotifRequest, delaySec: number, gainDb?: number): MotifHandle | null;
  stopMotif(fadeSec: number): void;
  /**
   * A moment is waiting for this motif, or comes next and plays it (chapter 9's epilogue, during its
   * Revelation); null: none. Until it is baked the bank bakes it ahead of everything else still
   * pending (SoundBank.prioritize), in the loading overlay's timer slices instead of idle time (the
   * player is reading a panel; nothing is in play). Never raises the pace in play. Every call is passed
   * on, a repeat of the same motif too (the caller asks when the moment that wants it changes).
   */
  awaitMotif(motif: MotifRequest | null): void;
  preview(kind: 'effects' | 'ambience'): void;
  /**
   * Queue bakes for a level (and its Story overlay kinds, bells, motifs). Idempotent; a new set
   * replaces the last (what the two share stays baked). Works before the first gesture: baking needs
   * no AudioContext, so a set asked for on a menu is ready (or nearly) when the level starts.
   */
  prepare(set: LevelSoundSet): void;
  /**
   * The loading overlay covers the screen (the director says so): the bank may bake in bigger slices
   * then, since no frame the player sees can be dropped.
   */
  setLoadingScreen(on: boolean): void;
  beginSession(info: SessionAudioInfo): SessionAudio;
  now(): number;
  state(): AudioState;
  /** Tests and HMR only. */
  dispose(): Promise<void>;
}

// =================================================================================================
// 15. Synthesis-facing interfaces (package B)
// =================================================================================================

/** Raw baked PCM, mono. */
export interface BakedPcm {
  readonly sampleRate: number;
  readonly data: Float32Array;
}

export type BakeJob =
  | { readonly scope: 'core' }
  | { readonly scope: 'level'; readonly set: LevelSoundSet };

export interface BankStats {
  readonly ready: number;
  readonly pending: number;
  readonly bytes: number;
  /** FNV-1a over every baked sample (as Int16), for determinism checks. */
  readonly checksum: string;
  /** The motif baked ahead of everything else (prioritize) while it is still to bake, 'variant@tempo'. */
  readonly awaited?: string | null;
  /**
   * Motifs rendered off the main thread (a Web Worker): renders done, their time there (ms), whether
   * the worker failed (motifs then bake on the main thread), and whether it is rendering now. Null
   * where the bank has no worker.
   */
  readonly offThread?: { readonly renders: number; readonly ms: number; readonly failed: boolean; readonly busy: boolean } | null;
}

/**
 * Bakes in slices (at most 4 ms ahead in play; up to 16 ms while the loading overlay is up or a moment
 * waits for its motif, up to 12 ms of a menu's idle time), wraps PCM into AudioBuffers once attached,
 * frees PCM after wrapping.
 */
export interface SoundBank {
  attach(ctx: BaseAudioContext): void;
  request(job: BakeJob): void;
  /** Free the previous level's set (core stays). */
  releaseLevel(): void;
  ready(id: SoundId): boolean;
  buffer(id: SoundId, variant: number): AudioBuffer | null;
  bell(voicing: BellVoicingId, form: BellForm): AudioBuffer | null;
  motif(motif: MotifRequest): AudioBuffer | null;
  /**
   * Bake this motif of the level set next, ahead of everything still pending, until it is baked (a
   * bake in progress is set aside and resumed later); the request stands while the motif is dropped
   * from the set and asked for again. null puts it back in its place (a bake of it in progress is set
   * aside, so the queue's own order resumes first). One at a time.
   */
  prioritize(motif: MotifRequest | null): void;
  stats(): BankStats;
}

/**
 * Injected slice scheduler (paced by the screen in the browser, synchronous in tests). `work` runs
 * until its deadline and returns true while more remains; the scheduler calls it again while it
 * does. `deadlineMs` is an absolute time on the performance.now() clock (ms): at most 4 ms ahead in
 * play, at most 16 ms ahead while the loading overlay covers the screen or 12 ms in a menu's idle
 * time (src/audio/synth/bank.ts BAKE_PACE). A deadline, not a budget.
 */
export type SliceScheduler = (work: (deadlineMs: number) => boolean) => void;

// Module boundaries: the factory names and paths each package exports (DESIGN.md §10).
/** src/audio/synth/bank.ts (B): `export const createSoundBank: CreateSoundBank`. */
export type CreateSoundBank = (schedule: SliceScheduler, seed: number) => SoundBank;
/** src/audio/synth/recipes/index.ts (B): pure, node-testable. Output peak-normalised to 1.0 (loops: RMS 0.25). */
export type BakeSound = (id: SoundId, variant: number, seed: number) => BakedPcm;
/** src/audio/synth/bell.ts (B). Strike peak-normalised to 1.0; shiver and clank relative to the strike. */
export type BakeBell = (voicing: BellVoicingId, form: BellForm, seed: number) => BakedPcm;
/** src/audio/synth/piano.ts (B). Peak at FELT_PIANO.peakDb. */
export type RenderMotif = (motif: MotifRequest, seed: number) => BakedPcm;
/**
 * src/audio/synth/ir.ts (B): stereo space impulse response, SPACE.predelaySec of leading silence
 * included, unit energy per channel (the convolver runs with normalize = false; see SPACE).
 */
export type GenerateSpaceIR = (
  sampleRate: number,
  seconds: number,
  seed: number,
) => readonly [Float32Array, Float32Array];
/** src/audio/voices/noiseBank.ts (B). */
export type CreateNoiseBank = (ctx: BaseAudioContext, seed: number) => NoiseBank;
/** src/audio/voices/ambience.ts (B): `export const createAmbienceVoices: AmbienceVoiceFactory`. */
export type CreateAmbienceVoices = AmbienceVoiceFactory;
/** src/audio/musicRouter.ts (A). */
export type CreateMusicRouter = (options: MusicRouterOptions) => MusicRouter;

// =================================================================================================
// 16. Observability (window.__icebergAudio, DEV or ?audiodebug=1)
// =================================================================================================

export type TraceKind =
  | 'event'
  | 'play'
  | 'drop'
  | 'coalesce'
  | 'duck'
  | 'hold'
  | 'bell'
  | 'motif'
  | 'ambience'
  | 'music'
  | 'lifecycle'
  | 'error';

export interface TraceEntry {
  readonly seq: number;
  /**
   * AudioContext time (0 when unavailable) and game time. The engine does not know game time: its
   * own entries (play, drop, bell, lifecycle) carry wall-clock seconds since the session began in
   * `gt`; the bridge's bell and error entries carry the session's game time, its event and
   * coalesce entries 0 (they are joined by `frame` and `cause`).
   */
  readonly t: number;
  readonly gt: number;
  readonly token: number;
  readonly frame: number;
  readonly kind: TraceKind;
  readonly ev?: GameEvent['type'];
  /** The QueuedEvent.seq this entry descends from (-1 none). */
  readonly cause: number;
  readonly sound?: SoundId;
  readonly family?: SoundFamily;
  readonly variant?: number;
  /** As played: the request's level with the jitter, the distance and the density compensation. */
  readonly gainDb?: number;
  /** 'play' entries: the level the request asked for (before jitter, distance and density). */
  readonly requestDb?: number;
  readonly rate?: number;
  readonly lowpassHz?: number;
  readonly pan?: number;
  readonly distM?: number;
  readonly priority?: Priority;
  readonly reason?: DropReason;
  readonly activeVoices?: number;
  readonly placement?: number;
  readonly input?: {
    readonly relSpeed?: number;
    readonly impulse?: number;
    readonly intensity?: number;
    readonly drop?: number;
    readonly amount?: number;
    readonly massT?: number;
    readonly m?: number;
  };
  /** Free text for lifecycle, duck and bell entries ('bell-silenced p29 strikes=4'). */
  readonly note?: string;
}

export interface BusMeter {
  readonly peakDb: number;
  readonly rmsDb: number;
}

export interface AudioState {
  readonly available: boolean;
  readonly status: ContextStatus;
  readonly seed: number;
  readonly sampleRate: number;
  readonly hidden: boolean;
  readonly paused: boolean;
  readonly levels: AudioLevels;
  /**
   * The channel gains as scheduled now (the engine's model of each ramp, which matches the
   * AudioParam to within one render quantum). `master` excludes the hidden-tab gate (`hidden`
   * reports that).
   */
  readonly buses: {
    readonly master: number;
    readonly music: number;
    readonly ambience: number;
    readonly effects: number;
    readonly gate: number;
  };
  readonly ducks: Readonly<Partial<Record<DuckKey, DuckLevels>>>;
  readonly voices: {
    readonly active: number;
    readonly peak: number;
    readonly byFamily: Readonly<Partial<Record<SoundFamily, number>>>;
  };
  readonly bells: readonly {
    readonly placement: number;
    readonly voicing: BellVoicingId;
    readonly standing: boolean;
    readonly strikes: number;
    readonly nextStrikeAt: number | null;
    readonly silencedAt: number | null;
  }[];
  readonly bank: BankStats;
  readonly session: number | null;
  readonly music: MusicRouterState;
  readonly perf: { readonly frameMsMedian: number; readonly frameMsP99: number };
}

export interface RenderStats {
  readonly peakDb: number;
  readonly truePeakDb: number;
  readonly rmsDb: number;
  /** ITU-R BS.1770 integrated (ungated is reported separately) and max momentary loudness. */
  readonly lufsI: number;
  readonly lufsMMax: number;
  readonly clippedSamples: number;
  readonly dcOffset: number;
  readonly centroidHz: number;
  /** Energy fraction below 150 Hz and below 40 Hz. */
  readonly below150: number;
  readonly below40: number;
  readonly durationSec: number;
}

export interface BurstSpec {
  readonly collisions: number;
  readonly breaks: number;
  readonly splashes: number;
  readonly seconds: number;
}

export interface MixStats extends RenderStats {
  readonly limiterMaxReductionDb: number;
  readonly limiterP99ReductionDb: number;
  readonly maxVoices: number;
  /** The limiter's look-ahead the reduction was aligned by (samples at the lab's rate). */
  readonly limiterLatencySamples?: number;
}

/** Offline lab (dev only; dynamic import so it never ships in the main path). */
export interface AudioLab {
  fire(id: SoundId, opts: { gainDb: number; rate: number; lowpassHz: number; distM: number }): void;
  burst(spec: BurstSpec): Promise<RenderStats>;
  render(id: SoundId, variant: number, gainDb: number): Promise<RenderStats>;
  renderMix(trace: readonly TraceEntry[]): Promise<MixStats>;
  variation(on: boolean): void;
}

export interface AudioDebugApi {
  state(): AudioState;
  trace(sinceSeq?: number): readonly TraceEntry[];
  clearTrace(): void;
  /** Per-bus peak and RMS since the last call (AnalyserNode taps read each animation frame). */
  meter(): Readonly<Record<'master' | 'music' | 'ambience' | 'effects', BusMeter>>;
  lab(): Promise<AudioLab>;
}

declare global {
  interface Window {
    __icebergAudio?: AudioDebugApi;
  }
}

/** What the App-level director reads each change (useAudioDirector, package C). */
export interface DirectorInputs {
  readonly screen: Screen;
  readonly mode: GameMode;
  readonly chapterId: ChapterId | null;
  readonly narrative: boolean;
  readonly viewingRiver: boolean;
}

// =================================================================================================
// 17. Read-only views of game objects (the audio layer never writes to them)
// =================================================================================================

/** The ObstacleBody fields audio reads (src/core/physics/world.ts), via an instanceof guard. */
export interface AudioBodyView {
  readonly id: number;
  readonly originId: number;
  readonly kind: ObstacleKind;
  readonly part: string;
  readonly placement: number;
  readonly mass: number;
  readonly anchored: boolean;
  readonly state: 'intact' | 'loose' | 'broken';
  readonly active: boolean;
  readonly pos: Vec3;
  readonly spawn: Vec3;
  readonly shake: { readonly amp: number; readonly t0: number };
  readonly countedKnocked: boolean;
}

/** A tower "stands" while this holds (the Plumes test for anchored bodies, plus not knocked). */
export const towerStanding = (b: AudioBodyView): boolean =>
  b.active && b.anchored && b.state === 'intact' && !b.countedKnocked;

// =================================================================================================
// 18. Test double surface (package A ships src/audio/testing/fakeAudioContext.ts implementing this)
// =================================================================================================

export type RecordedAudioOp =
  | { readonly op: 'create'; readonly node: string; readonly id: number }
  | { readonly op: 'connect'; readonly from: number; readonly to: number }
  | { readonly op: 'disconnect'; readonly from: number }
  | { readonly op: 'start'; readonly id: number; readonly when: number; readonly offset: number }
  | { readonly op: 'stop'; readonly id: number; readonly when: number }
  | {
      readonly op: 'param';
      readonly id: number;
      readonly param: string;
      readonly method: string;
      readonly value: number;
      readonly time: number;
    }
  | { readonly op: 'state'; readonly state: string };

export interface FakeAudioContextHandle {
  /** Cast to BaseAudioContext / AudioContext for code under test. */
  readonly ctx: unknown;
  readonly ops: readonly RecordedAudioOp[];
  /** Advance currentTime (and fire 'ended' on sources whose buffers finished). */
  advance(seconds: number): void;
  setState(state: 'suspended' | 'running' | 'closed' | 'interrupted'): void;
  /**
   * Sources started minus stopped/ended, optionally for one owner tag. (Package A's FakeHandle,
   * src/audio/testing/fakeAudioContext.ts, adds withOwner() to tag the nodes a call creates.)
   */
  liveSources(owner?: string): number;
}
