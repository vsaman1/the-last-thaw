/**
 * How loud, how bright and how low each game event sounds (DESIGN §6.2): pure functions of the event
 * fields and the bodies involved, with the constants in the contract (§4). Small taps stay quiet and
 * light, structural failures heavy, and everything in between follows the real impact:
 *
 *   collision  m = clamp01(0.75·ln(1+J)/ln(1501) + 0.25·min(1, v/25)·min(1, ln(1+J)/ln(21))),
 *              silent below 0.08 (the speed counts as far as the contact moved momentum)
 *              level = HIT_LREF + 26·(m − 1), rate = 1.06 − 0.12·m, low-pass = 1500·2^(3.2·m)
 *   break      W = log10(1+mass)/log10(151), M = 0.7·W + 0.3·mHit
 *              level = clamp(ltyp + span·(M − mtyp), ltyp − 12, ceil ?? ltyp + 4), rate = 1.05 − 0.10·M
 *   stones     a barrier breaking apart or a rock knocked moving (F6, F6b): M = 0.1·W + 0.9·mHit, so
 *              the sound follows the knock and a boulder nudged is quieter than a boulder struck
 *
 * So a roll-back tap (J 2, v 2) peaks at −34.9 dBFS, a house holding a hit at −20.6, a house
 * collapsing at −14 and a dam breaking at −9: the tap sits 20 dB under the house and 26 under the dam.
 */
import { clamp, clamp01 } from '../../core/math';
import type { ObstacleKind } from '../../core/types';
import {
  BREAK_LEVELS,
  BREAK_MAG,
  COLLISION_MAG,
  EVENT_MAG,
  HIT_LREF,
  KIND_SOUNDS,
  STONE_MAG,
  type SoundId,
} from '../contract';

const C = COLLISION_MAG;
const E = EVENT_MAG;
const LN_JREF = Math.log(1 + C.jRef);
const LN_JGATE = Math.log(1 + C.jGate);
const LOG_MASS_REF = Math.log10(1 + BREAK_MAG.massRefT);
const LOG_LAND_REF = Math.log10(1 + E.landRef);
const LOG_ABSORB_REF = Math.log10(26);

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => (g > 0 ? 20 * Math.log10(g) : -Infinity);

// --- collisions ----------------------------------------------------------------------------------

/** Collision magnitude 0..1 from the impulse J (t·m/s) and the closing speed v (m/s). */
export function collisionM(impulse: number, relSpeed: number): number {
  const j = Number.isFinite(impulse) && impulse > 0 ? impulse : 0;
  const v = Number.isFinite(relSpeed) && relSpeed > 0 ? relSpeed : 0;
  const lj = Math.log(1 + j);
  // The speed term only as far as the contact moved momentum: a fast graze that moves almost none
  // (a light fence brushed at 25 m/s, J 0.4) is not a loud impact, however fast (DESIGN §6.2, S4).
  return clamp01((C.wJ * lj) / LN_JREF + C.wV * Math.min(1, v / C.vRef) * Math.min(1, lj / LN_JGATE));
}

/** Below this a contact makes no sound at all (rubbing, resting, a roll-back nudge). */
export const isQuietHit = (m: number): boolean => m < C.silentBelow;

/** The hit sound for a kind at magnitude m (the heavy variant takes over at heavyFrom). */
export function hitSound(kind: ObstacleKind, m: number): SoundId {
  const k = KIND_SOUNDS[kind];
  return m >= C.heavyFrom && k.hitHeavy !== null ? k.hitHeavy : k.hit;
}

/** Peak level (dBFS) of a hit sound at magnitude m. */
export const hitLevelDb = (sound: SoundId, m: number): number => (HIT_LREF[sound] ?? -13) + C.spanDb * (m - 1);
/** Heavier sounds lower. */
export const hitRate = (m: number): number => C.rateTop - C.rateSlope * m;
/** Soft taps dull, hard hits bright. */
export const hitLowpassHz = (m: number): number => C.lpBaseHz * Math.pow(2, C.lpOctaves * m);

/** Level of the weight.thump layer under a hit, or null below weightFrom. */
export function weightLevelDb(m: number): number | null {
  if (!(m > C.weightFrom)) return null;
  return (HIT_LREF['weight.thump'] ?? -14) + 20 * Math.log10((m - C.weightFrom) / (1 - C.weightFrom));
}

/** True when the iceberg's own ice voice joins a hit on something that is not ice. */
export const wantsIceLayer = (kind: ObstacleKind, m: number): boolean =>
  m >= C.iceLayerFrom && kind !== 'iceBlock' && kind !== 'iceField';

// --- breaks --------------------------------------------------------------------------------------

/** Broken mass term 0..1 (tonnes, summed over the bodies of one placement). */
export const breakW = (massT: number): number =>
  clamp01(Math.log10(1 + Math.max(0, Number.isFinite(massT) ? massT : 0)) / LOG_MASS_REF);

/** Break magnitude 0..1 from the broken mass and the hit that broke it (0 when none: a flood, debris). */
export const breakM = (massT: number, mHit: number): number =>
  clamp01(BREAK_MAG.wMass * breakW(massT) + BREAK_MAG.wHit * clamp01(mHit));

/**
 * F6 / F6b magnitude 0..1 of a stone barrier breaking apart or a rock knocked moving: the hit weighs most
 * (STONE_MAG), so its level follows the knock instead of the stone's mass alone.
 */
export const stoneM = (massT: number, mHit: number): number =>
  clamp01(STONE_MAG.wMass * breakW(massT) + STONE_MAG.wHit * clamp01(mHit));

/**
 * Peak level (dBFS) of a break sound at magnitude M, kept within −12 dB of its typical level and under
 * its ceiling (+4 dB by default; the trees, stones and log piles stop at a house collapse's loudness).
 */
export function breakLevelDb(sound: SoundId, M: number): number {
  const b = BREAK_LEVELS[sound];
  if (!b) return -18;
  return clamp(b.ltyp + b.span * (M - b.mtyp), b.ltyp - 12, b.ceil ?? b.ltyp + 4);
}

export const breakRate = (M: number): number => BREAK_MAG.rateTop - BREAK_MAG.rateSlope * M;

/** A rock tumbling: pitched by its mass (0.8 t → 1.16, 4 t → 1.09, 22 t → 0.98). */
export const tumbleRate = (massT: number): number => E.tumbleRateTop - E.tumbleRateSlope * breakW(massT);

/** True when a hit knocks a rock or a barrier stone moving (rule F6b): a real knock, not a graze. */
export const knocksLoose = (m: number, impulse: number, massT: number): boolean =>
  m >= E.tumbleFrom && massT > 0 && Number.isFinite(impulse) && impulse / massT >= E.tumbleDv;

// --- the iceberg itself and water ------------------------------------------------------------------

/** Landing magnitude 0..1 from the iceberg's mass (t) and the drop (m); 0 below landMinDrop. */
export function landingM(massT: number, drop: number): number {
  if (!(drop >= E.landMinDrop)) return 0;
  return clamp01(Math.log10(1 + Math.max(0, massT) * drop) / LOG_LAND_REF);
}

export const landingLevelDb = (mL: number): number => E.landTopDb + E.landSpanDb * (mL - 1);

/** water.plunge level for a waterfall landing of `drop` metres. */
export const plungeLevelDb = (drop: number): number =>
  E.plungeDb + 20 * Math.log10(0.8 + 0.2 * Math.min(1, Math.max(0, drop) / 30));

/** Merge one more splash into a running intensity: i = 1 − Π(1 − iₖ). */
export const mergeIntensity = (acc: number, i: number): number => 1 - (1 - clamp01(acc)) * (1 - clamp01(i));

export function splashSound(i: number): SoundId {
  if (i < E.splashSmallBelow) return 'splash.small';
  if (i < E.splashMediumBelow) return 'splash.medium';
  return 'splash.large';
}

export const splashLevelDb = (i: number): number => E.splashTopDb + E.splashSpanDb * (clamp01(i) - 1);

/** ice.chip level for a chip of `amount` (fraction of a full iceberg). */
export const chipLevelDb = (amount: number): number =>
  E.chipTopDb + E.chipSpanDb * (Math.min(1, Math.max(0, amount) / E.chipAmountRef) - 1);

/** ice.absorb level for glacier ice of `massT` tonnes merged (one merged burst). */
export const absorbLevelDb = (massT: number): number =>
  E.absorbTopDb + E.absorbSpanDb * (clamp01(Math.log10(1 + Math.max(0, massT)) / LOG_ABSORB_REF) - 1);

/** Terrain wall hit magnitude from the rise of IcebergState.impact; negative = no hit. */
export const wallM = (rise: number): number => (rise >= E.wallRise ? clamp01((rise - E.wallRise) / E.wallSpan) : -1);

export const wallLevelDb = (m: number): number => E.wallTopDb + E.wallSpanDb * (m - 1);

/** ocean.entry level: ±3 dB around −15 by the iceberg's mass (30 t is the reference). */
export const oceanLevelDb = (massT: number): number =>
  E.oceanDb + clamp(2 * Math.log2(Math.max(1e-3, massT) / 30), -3, 3);
