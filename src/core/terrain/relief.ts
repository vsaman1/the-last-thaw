import type { LevelDef, ReliefSettings } from '../types';
import { clamp, smoothstep } from '../math';
import { createRng, fbm2 } from '../rng';
import type { CourseGeometry } from './course';
import { coursePolyline, polylineDistance, type CoursePolyline } from './features';

/**
 * Natural relief for open-mountainside levels (LevelDef.relief), added to the valley floor by
 * src/core/terrain/terrain.ts before features. Three deterministic layers:
 * - roll: broad fbm undulation in world space (amplitude `roll`, size `rollScale`); where it
 *   outweighs the floor's descent it leaves hollows and saddles (natural dead ends).
 * - gullies: grooves along the zero lines of 2-octave noise in course coordinates, stretched
 *   `gullyStretch`× along s, so they run down the slope, meander and braid (depth `gullies`,
 *   (1 − r²)² cross-section about 0.3·gullySpacing wide). They channel an iceberg that is not
 *   steering hard; their sides are ~1.5·depth / (0.15·spacing) steep.
 * - outcrops: sheer rock tors where world-space noise exceeds the quantile that covers
 *   `outcropCover` of the floor (measured on seeded samples of the floor in course coordinates,
 *   startS … coastS across the floor's width, so cover is exact on average and the pattern does
 *   not move when the level bounds change; it used to sample the whole bounds).
 *   They report `rock` (0..1) so the terrain paints them rock; `lineClear` keeps them off a band
 *   around LevelDef.line, and `clear` off more corridors (alternative routes, a breach).
 * The terrain multiplies the result by fades (start, coast, floor edge, cliff lips, ramps,
 * plateaus, roads), so relief never disturbs the spawn, the beach, a lip or a kicker face.
 */

export const RELIEF_DEFAULTS = {
  rollScale: 140,
  gullySpacing: 45,
  gullyStretch: 5,
  outcropCover: 0.05,
  outcropScale: 28,
} as const;

export const RELIEF_TUNING = {
  /** Half-width of a gully groove in noise units (|n| below this is groove). */
  gullyBand: 0.22,
  /**
   * Width (noise units) of an outcrop's edge: small = sheer sides. At 0.02 the flank of a 6 m tor
   * is steeper than the sim's wall slope almost everywhere (a gentler flank would be a kicker).
   */
  outcropEdge: 0.02,
  /** Outcrop tops rise a further share of their height over this much noise above the edge. */
  outcropCrown: 0.25,
  outcropCrownShare: 0.3,
  /** Samples used to find the outcrop threshold for the requested cover. */
  coverSamples: 4096,
  /** Outcrops reach full height this far (m) beyond lineClear. */
  lineClearRamp: 12,
  /** Spacing (m) of the line offset lookup. */
  lineStep: 2,
  /** Clear half-width (m) of a ReliefSettings.clear corridor without a width when lineClear is 0. */
  defaultClear: 15,
} as const;

const R = RELIEF_TUNING;

/** True when a level has any relief to add. */
export function hasRelief(relief: ReliefSettings | undefined): relief is ReliefSettings {
  return !!relief && ((relief.roll ?? 0) > 0 || (relief.gullies ?? 0) > 0 || (relief.outcrops ?? 0) > 0);
}

export class ReliefField {
  /** Output of the last at(): 0..1 how much of the point is outcrop rock. */
  rock = 0;

  private readonly roll: number;
  private readonly rollScale: number;
  private readonly gullies: number;
  private readonly gullyS: number;
  private readonly gullyD: number;
  private readonly outcrops: number;
  private readonly outcropScale: number;
  private readonly threshold: number;
  private readonly seed: number;
  private readonly lineClear: number;
  /** LevelDef.line offset sampled every lineStep m from lineS0 (null without a line or lineClear). */
  private readonly lineD: Float64Array | null;
  private readonly lineS0: number;
  /** ReliefSettings.clear corridors and their clear half-widths (m). */
  private readonly clear: { poly: CoursePolyline; half: number }[];

  constructor(level: LevelDef, relief: ReliefSettings, geo: CourseGeometry) {
    this.seed = (level.seed + (relief.seed ?? 0)) | 0;
    this.roll = Math.max(0, relief.roll ?? 0);
    this.rollScale = Math.max(10, relief.rollScale ?? RELIEF_DEFAULTS.rollScale);
    this.gullies = Math.max(0, relief.gullies ?? 0);
    const spacing = Math.max(8, relief.gullySpacing ?? RELIEF_DEFAULTS.gullySpacing);
    this.gullyD = spacing;
    this.gullyS = spacing * Math.max(1, relief.gullyStretch ?? RELIEF_DEFAULTS.gullyStretch);
    this.outcrops = Math.max(0, relief.outcrops ?? 0);
    this.outcropScale = Math.max(6, relief.outcropScale ?? RELIEF_DEFAULTS.outcropScale);
    const cover = clamp(relief.outcropCover ?? RELIEF_DEFAULTS.outcropCover, 0, 0.4);
    this.threshold = this.outcrops > 0 && cover > 0 ? this.quantile(level, geo, 1 - cover) : Infinity;
    this.lineClear = Math.max(0, relief.lineClear ?? 0);
    const line = level.line ?? [];
    if (this.lineClear > 0 && line.length > 0) {
      this.lineS0 = line[0].s;
      const n = Math.max(2, Math.ceil((line[line.length - 1].s - line[0].s) / R.lineStep) + 1);
      this.lineD = new Float64Array(n);
      let k = 1;
      for (let i = 0; i < n; i++) {
        const s = this.lineS0 + i * R.lineStep;
        while (k < line.length - 1 && line[k].s < s) k++;
        const a = line[Math.max(0, k - 1)];
        const b = line[k] ?? a;
        const t = b.s > a.s ? clamp((s - a.s) / (b.s - a.s), 0, 1) : 1;
        this.lineD[i] = a.d + (b.d - a.d) * t;
      }
    } else {
      this.lineS0 = 0;
      this.lineD = null;
    }
    const half = this.lineClear > 0 ? this.lineClear : R.defaultClear;
    this.clear = (relief.clear ?? [])
      .filter((c) => c.points.length > 0)
      .map((c) => ({ poly: coursePolyline(c.points), half: c.width !== undefined ? c.width / 2 : half }));
  }

  /** Outcrop noise at a world point. */
  private outcropNoise(x: number, z: number): number {
    const sc = this.outcropScale;
    return fbm2(x / sc, z / sc, this.seed + 521, 3);
  }

  /**
   * Value of the outcrop noise below which a share `q` of seeded sample points on the floor lie
   * (course coordinates: s in startS … coastS, d across the floor; independent of the bounds).
   */
  private quantile(level: LevelDef, geo: CourseGeometry, q: number): number {
    const rng = createRng((this.seed ^ 0x0c7c09) >>> 0);
    const v = new Float64Array(R.coverSamples);
    const fr = { x: 0, z: 0, dirX: 0, dirZ: 1 };
    const s0 = Math.max(0, level.startS);
    const s1 = Math.min(geo.length, Math.max(s0 + 1, level.coastS));
    for (let i = 0; i < v.length; i++) {
      const s = s0 + rng() * (s1 - s0);
      const d = (rng() * 2 - 1) * geo.halfWidthAt(s);
      geo.frameAt(s, fr);
      v[i] = this.outcropNoise(fr.x - fr.dirZ * d, fr.z + fr.dirX * d);
    }
    v.sort();
    return v[clamp(Math.floor(q * v.length), 0, v.length - 1)];
  }

  /** Lateral offset of LevelDef.line at s (held beyond its ends). */
  private lineAt(s: number): number {
    const t = this.lineD!;
    const f = clamp((s - this.lineS0) / R.lineStep, 0, t.length - 1);
    const i = Math.min(Math.floor(f), t.length - 2);
    return t[i] + (t[i + 1] - t[i]) * (f - i);
  }

  /** Relief height (m) at world (x, z) = course (sExt, d), before the terrain's fades. Sets `rock`. */
  at(x: number, z: number, sExt: number, d: number): number {
    let h = 0;
    this.rock = 0;
    if (this.roll > 0) {
      const rs = this.rollScale;
      h += this.roll * fbm2(x / rs, z / rs, this.seed + 501, 3);
    }
    if (this.gullies > 0) {
      const n = fbm2(sExt / this.gullyS, d / this.gullyD, this.seed + 511, 2);
      const r = Math.abs(n) / R.gullyBand;
      if (r < 1) h -= this.gullies * (1 - r * r) * (1 - r * r);
    }
    if (this.outcrops > 0) {
      const n = this.outcropNoise(x, z);
      const t = this.threshold;
      if (n > t) {
        let w = smoothstep(t, t + R.outcropEdge, n);
        if (this.lineD) {
          const off = Math.abs(d - this.lineAt(sExt));
          w *= smoothstep(this.lineClear, this.lineClear + R.lineClearRamp, off);
        }
        for (let i = 0; i < this.clear.length && w > 0; i++) {
          const { poly: p, half } = this.clear[i];
          const r = half + R.lineClearRamp;
          if (sExt < p.s0 - r || sExt > p.s1 + r || d < p.d0 - r || d > p.d1 + r) continue;
          w *= smoothstep(half, r, polylineDistance(p, sExt, d));
        }
        if (w > 0) {
          const crown = R.outcropCrownShare * Math.min(1, (n - t) / R.outcropCrown);
          h += this.outcrops * w * (1 - R.outcropCrownShare + crown);
          this.rock = w;
        }
      }
    }
    return h;
  }
}
