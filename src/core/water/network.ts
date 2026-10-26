import type { TerrainFeature } from '../types';
import { clamp, smoothstep } from '../math';
import { polylineOf } from '../terrain/features';
import {
  profileAt,
  springPoolLevels,
  streamAlong,
  streamBankRun,
  streamDepth,
  streamFlow,
  type SpringPoolLevels,
  type StreamProfile,
} from '../terrain/stream';
import type { GeneratedTerrain } from '../terrain/terrain';
import { Reach } from './reach';
import { HYDRO, SPRING } from './tuning';

/**
 * The level's streams as reaches (./reach.ts): one cell every ~HYDRO.cell m along each polyline,
 * placed in the world through the course frame, with the bed of the terrain's carve (the stream
 * profile minus the bank), the channel width, and a speed scale from the bed slope (pools slower,
 * rapids up to 2.2× faster; a fall where the bed drops steeper than HYDRO.fallSlope). Water springs
 * up along the channel's opening taper, so a stream carries its design discharge
 *   q = (top width − bank run) × depth × flow   (m³/s)
 * from the end of the taper on. A stream with a source (types.ts StreamSource) has no taper: all of
 * q enters at its first cell (from under the glacier, out of the cave, from the parent stream), so
 * the water runs at full depth from the source on. A 'cave' stream's cells inside its spring pool
 * lie on the bed at the pool's outlet (flat: one still level, ./pool.ts) with no current, which
 * picks up past the outlet. Built per session (a few ms); the reach then holds the live state.
 */

type Stream = Extract<TerrainFeature, { type: 'stream' }>;

export interface StreamInfo {
  /** Index in level.features. */
  readonly feature: number;
  readonly def: Stream;
  readonly reach: Reach;
  /** Design discharge (m³/s). */
  readonly q: number;
  /** Polyline length (m, course coordinates) and cell spacing along it. */
  readonly length: number;
  /** Course coordinates of each cell (for crossings). */
  readonly cs: Float64Array;
  readonly cd: Float64Array;
  /** 'cave' source only: its spring pool (radius and the carved floor and rim heights). */
  readonly pool: SpringPoolLevels | null;
  /**
   * First cell the stream's ribbon draws at its own surface: the cells before it lie under other
   * water that is drawn instead (the spring pool's lake, the parent stream of a 'branch') and are
   * drawn sunk below it (src/core/water/geometry.ts fillRibbon), so the two never z-fight.
   */
  drawFrom: number;
}

const TURB_BASE = 0.06;

export function buildStreams(terrain: GeneratedTerrain): StreamInfo[] {
  const features = terrain.level.features ?? [];
  const out: StreamInfo[] = [];
  for (const prof of terrain.streamProfiles) {
    const f = features[prof.index];
    if (!f || f.type !== 'stream') continue;
    out.push(buildStream(terrain, f, prof));
  }
  for (const st of out) if (st.def.source === 'branch') st.drawFrom = branchDrawFrom(st, out);
  return out;
}

/**
 * First cell of a 'branch' stream outside its parent's water (the stream whose channel holds its
 * first point): before it the parent's ribbon is the water drawn.
 */
function branchDrawFrom(st: StreamInfo, all: readonly StreamInfo[]): number {
  const r = st.reach;
  const inWater = (x: number, z: number): boolean =>
    all.some((o) => {
      if (o === st) return false;
      const p = o.reach;
      for (let i = 0; i + 1 < p.n; i++) {
        const ex = p.x[i + 1] - p.x[i];
        const ez = p.z[i + 1] - p.z[i];
        const l2 = ex * ex + ez * ez;
        const t = l2 > 1e-12 ? clamp(((x - p.x[i]) * ex + (z - p.z[i]) * ez) / l2, 0, 1) : 0;
        const dist = Math.hypot(x - p.x[i] - ex * t, z - p.z[i] - ez * t);
        if (dist <= p.waterHalf(i, p.h[i])) return true;
      }
      return false;
    });
  let i = 0;
  while (i < r.n - 1 && inWater(r.x[i], r.z[i])) i++;
  return i;
}

function buildStream(terrain: GeneratedTerrain, f: Stream, prof: StreamProfile): StreamInfo {
  const poly = polylineOf(f);
  const L = Math.max(poly.length, 1e-3);
  const n = Math.max(2, Math.round(L / HYDRO.cell) + 1);
  const dx = L / (n - 1);
  const r = new Reach(n, dx);
  r.n = n;
  const cs = new Float64Array(n);
  const cd = new Float64Array(n);
  const half = f.width / 2;
  const depth = streamDepth(f);
  const flow = streamFlow(f);
  const fullRun = streamBankRun(f.bank, half);
  const q = Math.max(0.05, (f.width - fullRun) * depth * flow);
  const pool = springPoolLevels(f, prof);
  const poolR = pool ? Math.min(pool.radius, L) : 0;
  /** Last cell inside the spring pool (its outlet), −1 without one. */
  let outlet = -1;
  let seg = 0;
  let prevAlong = 0;
  let drawFrom = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.min(i * dx, L);
    while (seg < poly.s.length - 2 && poly.arc[seg + 1] < a) seg++;
    const k = Math.min(seg + 1, poly.s.length - 1);
    const span = poly.arc[k] - poly.arc[seg];
    const t = span > 1e-9 ? (a - poly.arc[seg]) / span : 0;
    const s = poly.s[seg] + (poly.s[k] - poly.s[seg]) * t;
    const d = poly.d[seg] + (poly.d[k] - poly.d[seg]) * t;
    cs[i] = s;
    cd[i] = d;
    const w = terrain.course.toWorld(s, d);
    r.x[i] = w.x;
    r.z[i] = w.z;
    r.arc[i] = a;
    const along = streamAlong(f, a, L);
    const bank = f.bank * along;
    r.baseY[i] = profileAt(prof, a) - bank;
    r.bank[i] = Math.max(bank, 0.05);
    const run = streamBankRun(bank, half);
    r.width[i] = Math.max(f.width - run, 0.5);
    r.topHalf[i] = half;
    r.h0[i] = Math.max(depth * along, 0.05);
    r.springs[i] = q * Math.max(0, along - prevAlong);
    prevAlong = Math.max(prevAlong, along);
    r.still[i] = f.end === 'pool' ? 1 - smoothstep(L - HYDRO.poolStill, L - 4, a) : 1;
    if (pool) {
      // No current in the spring pool; it picks up over the outlet.
      r.still[i] *= smoothstep(poolR - SPRING.stillIn, poolR + SPRING.stillOut, a);
      if (a <= poolR) outlet = i;
    }
  }
  // The pool's lake is drawn over the cells up to its sill (the outlet cell).
  if (pool) drawFrom = outlet + 1;
  // Directions, slopes, speeds and turbulence from the laid-out cells.
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const ex = r.x[i1] - r.x[i0];
    const ez = r.z[i1] - r.z[i0];
    const el = Math.hypot(ex, ez) || 1;
    r.dirX[i] = ex / el;
    r.dirZ[i] = ez / el;
    const slope = (r.baseY[i0] - r.baseY[i1]) / Math.max(r.arc[i1] - r.arc[i0], 1e-3);
    const rapid = clamp(Math.sqrt(Math.max(slope, 0) / HYDRO.slopeRef), HYDRO.rapidMin, HYDRO.rapidMax);
    r.speed[i] = flow * rapid;
    r.turb[i] = Math.max(TURB_BASE, 0.55 * smoothstep(1.3, HYDRO.rapidMax, rapid));
  }
  // The spring pool: its cells lie flat on the outlet's bed with the outlet's speed scale, so they
  // carry the outlet's depth: one level (./pool.ts) that runs on into the channel without a step.
  for (let i = 0; i < outlet; i++) {
    r.baseY[i] = r.baseY[outlet];
    r.speed[i] = r.speed[outlet];
    r.turb[i] = TURB_BASE;
  }
  for (let i = 0; i + 1 < n; i++) {
    if ((r.baseY[i] - r.baseY[i + 1]) / dx > HYDRO.fallSlope) {
      r.fall[i] = 1;
      r.fall[i + 1] = 1;
      // Plunge pool below the fall.
      for (let j = i + 1; j < n && r.arc[j] - r.arc[i + 1] <= HYDRO.plunge; j++) {
        r.turb[j] = Math.max(r.turb[j], 0.9);
      }
    }
  }
  // Bends add turbulence (heading change per metre, as on the meltwater river).
  for (let i = 1; i + 1 < n; i++) {
    const cross = r.dirX[i - 1] * r.dirZ[i + 1] - r.dirZ[i - 1] * r.dirX[i + 1];
    const dot = r.dirX[i - 1] * r.dirX[i + 1] + r.dirZ[i - 1] * r.dirZ[i + 1];
    const kappa = Math.abs(Math.atan2(cross, dot)) / (2 * dx);
    if (i >= outlet) r.turb[i] = Math.max(r.turb[i], 0.7 * smoothstep(0.03, 0.3, kappa));
  }
  r.qIn = 0;
  r.settle(0);
  return { feature: prof.index, def: f, reach: r, q, length: L, cs, cd, pool, drawFrom };
}
