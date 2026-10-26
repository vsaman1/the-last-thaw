/**
 * A stand-in SoundBank made of plain test tones, for the engine's tests, the lab and browser checks
 * before package B's real bank is wired in. NOT the game's sounds: each sound id is one decaying sine
 * at a pitch derived from its name (variants a few percent apart), peak-normalised to 1.0 like a real
 * bake; loops are a steady sine at RMS 0.25; bells are the contract's partial table summed with
 * their T60s; a motif is its score as decaying sines. It follows the SoundBank contract (core, then
 * level sets, a new level set replacing the last, release, notReady before a request), so engine
 * behaviour around baking is testable. Like package B's bank, the core keeps St Bride's strike (the
 * Settings preview's bell).
 */
import {
  BELL_BAKE,
  BELL_PARTIAL_AMPS,
  BELL_PARTIAL_RATIOS,
  BELL_PARTIAL_T60,
  BELL_VOICINGS,
  MOTIF_SCORES,
  MOTIF_TUNING,
  SOUND_DEFS,
  SOUND_IDS,
  type BakeJob,
  type BankStats,
  type BellForm,
  type BellVoicingId,
  type MotifRequest,
  type SliceScheduler,
  type SoundBank,
  type SoundId,
} from '../contract';
import { fnv1a } from '../rng';

export interface ToneBankOptions {
  /** Cap every buffer's length (s) to keep node tests quick. */
  readonly maxSeconds?: number;
}

export interface ToneBank extends SoundBank {
  /** Jobs requested so far (tests). */
  readonly jobs: readonly BakeJob[];
  /** Every prioritize() call, as 'variant@tempo' or null (tests). */
  readonly prioritized: readonly (string | null)[];
  attached(): BaseAudioContext | null;
}

const CORE: readonly SoundId[] = SOUND_IDS.filter((id) => SOUND_DEFS[id].set === 'core');

function tone(id: string, variant: number): number {
  return 220 * Math.pow(2, (fnv1a(id) % 2400) / 1200) * (1 + 0.04 * variant);
}

export function createToneBank(schedule: SliceScheduler, seed: number, options: ToneBankOptions = {}): ToneBank {
  const maxSec = options.maxSeconds ?? Infinity;
  const ready = new Set<SoundId>(); // requested and "baked"
  const level = new Set<SoundId>();
  const bells = new Set<BellVoicingId>();
  /** Strikes kept with the core (package B's PREVIEW_BELL). */
  const coreStrikes = new Set<BellVoicingId>();
  const motifs = new Set<string>();
  const cache = new Map<string, AudioBuffer>();
  const jobs: BakeJob[] = [];
  const prioritized: (string | null)[] = [];
  let ctx: BaseAudioContext | null = null;
  let bytes = 0;
  let checksum = fnv1a(String(seed));

  const make = (key: string, sampleRate: number, seconds: number, fill: (out: Float32Array, sr: number) => void): AudioBuffer | null => {
    if (ctx === null) return null;
    const hit = cache.get(key);
    if (hit) return hit;
    const len = Math.max(1, Math.round(Math.min(seconds, maxSec) * sampleRate));
    const buf = ctx.createBuffer(1, len, sampleRate);
    const data = buf.getChannelData(0);
    fill(data, sampleRate);
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) for (let i = 0; i < len; i++) data[i] /= peak;
    cache.set(key, buf);
    bytes += len * 4;
    checksum = fnv1a(`${key}:${len}`, checksum);
    return buf;
  };

  return {
    jobs,
    prioritized,
    attached: () => ctx,
    attach(c: BaseAudioContext): void {
      if (ctx !== c) cache.clear();
      ctx = c;
    },
    request(job: BakeJob): void {
      jobs.push(job);
      // A new level set replaces the last (the contract); the core stays.
      if (job.scope === 'level') this.releaseLevel();
      schedule(() => {
        if (job.scope === 'core') {
          for (const id of CORE) ready.add(id);
          coreStrikes.add('st-brides');
        } else {
          for (const id of job.set.sounds) {
            ready.add(id);
            if (SOUND_DEFS[id].set !== 'core') level.add(id);
          }
          for (const b of job.set.bells) bells.add(b);
          for (const m of job.set.motifs) motifs.add(`${m.variant}@${m.tempoScale}`);
        }
        return false;
      });
    },
    releaseLevel(): void {
      for (const id of level) {
        ready.delete(id);
        for (const key of [...cache.keys()]) if (key.startsWith(`${id}#`)) cache.delete(key);
      }
      level.clear();
      bells.clear();
      motifs.clear();
    },
    ready: (id: SoundId) => ready.has(id) && ctx !== null,
    buffer(id: SoundId, variant: number): AudioBuffer | null {
      const def = SOUND_DEFS[id];
      if (!ready.has(id) || variant < 0 || variant >= def.variants) return null;
      const f = tone(id, variant);
      return make(`${id}#${variant}`, def.sampleRate, def.seconds, (out, sr) => {
        const tau = def.seconds / 6;
        for (let i = 0; i < out.length; i++) {
          const t = i / sr;
          const env = def.loop ? 0.25 * Math.SQRT2 : Math.exp(-t / tau) * Math.min(1, t / 0.002);
          out[i] = env * Math.sin(2 * Math.PI * f * t);
        }
      });
    },
    bell(voicing: BellVoicingId, form: BellForm): AudioBuffer | null {
      if (!bells.has(voicing) && !(form === 'strike' && coreStrikes.has(voicing))) return null;
      const v = BELL_VOICINGS[voicing];
      const seconds = form === 'strike' ? BELL_BAKE.strikeSec : form === 'shiver' ? BELL_BAKE.shiverSec : BELL_BAKE.clankSec;
      return make(`bell:${voicing}:${form}`, BELL_BAKE.sampleRate, seconds, (out, sr) => {
        const t60Scale = v.t60Scale * (form === 'clank' ? BELL_BAKE.clankT60Scale : 1);
        const parts = form === 'shiver' ? 3 : BELL_PARTIAL_RATIOS.length;
        for (let p = 0; p < parts; p++) {
          const f = v.strikeHz * BELL_PARTIAL_RATIOS[p];
          if (f >= sr / 2) continue;
          const k = 6.9078 / (BELL_PARTIAL_T60[p] * t60Scale); // ln(1000): -60 dB at T60
          for (let i = 0; i < out.length; i++) {
            const t = i / sr;
            out[i] += BELL_PARTIAL_AMPS[p] * Math.exp(-k * t) * Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.001);
          }
        }
      });
    },
    motif(m: MotifRequest): AudioBuffer | null {
      const key = `${m.variant}@${m.tempoScale}`;
      if (!motifs.has(key)) return null;
      const score = MOTIF_SCORES[m.variant];
      const beatSec = 60 / (score.bpm * m.tempoScale);
      const seconds = score.totalBeats * beatSec + score.fermataBeats * beatSec + score.tailSec;
      return make(`motif:${key}`, 24000, seconds, (out, sr) => {
        for (const n of score.notes) {
          const f = MOTIF_TUNING.a4Hz * Math.pow(2, (n.midi - 69) / 12);
          const i0 = Math.round(n.beat * beatSec * sr);
          for (let i = i0; i < out.length; i++) {
            const t = (i - i0) / sr;
            out[i] += n.vel * Math.exp(-t / 1.2) * Math.sin(2 * Math.PI * f * t);
          }
        }
      });
    },
    // Bakes are instant here: the order is only recorded.
    prioritize(m: MotifRequest | null): void {
      prioritized.push(m === null ? null : `${m.variant}@${m.tempoScale}`);
    },
    stats(): BankStats {
      return { ready: ready.size, pending: 0, bytes, checksum: checksum.toString(16) };
    },
  };
}

/** Runs every slice immediately (tests). */
export const syncScheduler: SliceScheduler = (work) => {
  while (work(Infinity)) {
    // keep going
  }
};
