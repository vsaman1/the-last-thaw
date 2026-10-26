import { BufferAttribute, BufferGeometry, Color } from 'three';
import { clamp, lerp, smoothstep } from '../math';
import { createRng, hash2 } from '../rng';
import { gridValue } from '../heightGrid';
import { isGeneratedTerrain } from '../terrain/terrain';
import { themeOf } from '../terrain/themes';
import {
  type GlacierPlacement,
  type GlacierPortal,
  GLACIER_TUNING,
  glacierFrontS,
  glacierSnoutS,
  glacierSnowAt,
  glacierSocketS,
  glacierSurface,
  glacierTopAt,
  glacierWorld,
  PORTAL_TUNING,
  portalArchY,
} from './glacier';

/**
 * Low-poly, flat-shaded geometry for the glacier (non-indexed, per-face normals and colours, built
 * once per level, deterministic from the seed):
 * - the body: snow-covered top with crevasses, a turquoise calving face banded like the iceberg, and
 *   the socket the iceberg breaks out of (fresh fracture ice);
 * - the calving cracks: thin ribbons around the socket with a reveal value for the crack shader;
 * - the snow field: the terrain's own triangles around the glacier, lifted a few centimetres and
 *   coloured with the theme's snow (so no terrain colour changes and the same lit program).
 */

/**
 * sRGB colours. The ice mirrors ICEBERG_VISUAL (src/render/Iceberg.tsx): one ice material language.
 * The glacier's snow is the iceberg's cool snow in every theme (a warm theme snow read as sand on
 * it); the snow field around it leans toward the theme's snow so it sits in the landscape.
 */
export const GLACIER_COLOURS = {
  snow: '#F2FAFF',
  snowShade: '#D3E6F2',
  iceTop: '#5CFCEE',
  iceSlope: '#2ED3EE',
  iceSide: '#1C8FD6',
  iceBase: '#0F5FB0',
  icePale: '#B4ECF8',
  icePaleDeep: '#86D8F0',
  fresh: '#D6FBFF',
  freshDeep: '#9FEAF8',
  crevasse: '#0B4A8A',
  /** A meltwater portal's vault: blue ice at the arch, darkening into the glacier. */
  vault: '#1A6FB8',
  vaultDeep: '#0A2F63',
  vaultBack: '#03122A',
} as const;

/**
 * Per-face emissive weight (aGlow): ice glows turquoise like the iceberg, snow hardly at all; a
 * portal's vault glows faintly at the arch (light through the ice) and not at all at its back.
 */
export const GLACIER_GLOW = {
  snow: 0.12,
  pale: 0.4,
  ice: 1,
  fresh: 1.35,
  crevasse: 0.7,
  vault: 0.55,
  vaultBack: 0,
} as const;

/** Slices of a portal's vault from the arch to its back wall. */
const VAULT_SLICES = 5;
/** A portal's rim: a band this tall (m) above the arch, standing PORTAL_LIP m proud of the face. */
const PORTAL_RIM = 0.8;
const PORTAL_LIP = 0.3;

/** Snow-field lift above the terrain (m); the material adds a polygon offset on top. */
export const SNOW_LIFT = 0.06;

/** Face profile: the mid row sits at this height fraction, bulging forward this much per unit scale. */
const FACE_MID = 0.5;
const FACE_BULGE = 0.12;

type RGB = { r: number; g: number; b: number };

const linear = (hex: string): RGB => {
  const c = new Color(hex);
  return { r: c.r, g: c.g, b: c.b };
};

/** Triangle soup with per-face normals, colours and glow. */
class Tris {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly glow: number[] = [];

  /** Adds (a, b, c); flips the winding if the face normal points away from the hint direction. */
  add(a: V, b: V, c: V, rgb: RGB, glow: number, hx: number, hy: number, hz: number): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9)) return;
    nx /= l;
    ny /= l;
    nz /= l;
    let p = b;
    let q = c;
    if (nx * hx + ny * hy + nz * hz < 0) {
      p = c;
      q = b;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const v of [a, p, q]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(rgb.r, rgb.g, rgb.b);
      this.glow.push(glow);
    }
  }

  get count(): number {
    return this.pos.length / 3;
  }

  toGeometry(withGlow: boolean): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    if (withGlow) g.setAttribute('aGlow', new BufferAttribute(new Float32Array(this.glow), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** A world-space vertex [x, y, z]. */
type V = [number, number, number];

const scratch = { x: 0, y: 0, z: 0 };

function worldAt(g: GlacierPlacement, s: number, d: number, y: number): V {
  glacierWorld(g, s, d, scratch);
  return [scratch.x, y, scratch.z];
}

function groundAt(g: GlacierPlacement, s: number, d: number): number {
  glacierWorld(g, s, d, scratch);
  return g.terrain.heightAt(scratch.x, scratch.z);
}

const mixRGB = (a: RGB, b: RGB, t: number, k = 1): RGB => ({
  r: lerp(a.r, b.r, t) * k,
  g: lerp(a.g, b.g, t) * k,
  b: lerp(a.b, b.b, t) * k,
});

/** Columns across a meltwater portal's opening (exact edges at its springs). */
const PORTAL_COLUMNS = 12;

/**
 * Lateral sample positions: even spacing outside the socket, finer across it (exact socket edges),
 * and finer across each meltwater portal (exact spring columns, so the arch is round).
 */
export function glacierColumns(g: GlacierPlacement): number[] {
  const W = g.halfWidth;
  const sh = Math.min(g.socketHalf, W * 0.5);
  const spacing = clamp(W / 16, 1.8, 3.2);
  const outer = Math.max(1, Math.ceil((W - sh) / spacing));
  let cols: number[] = [];
  for (let i = 0; i < outer; i++) cols.push(-W + ((W - sh) * i) / outer);
  const inner = 6;
  for (let i = 0; i <= inner; i++) cols.push(-sh + (2 * sh * i) / inner);
  for (let i = outer - 1; i >= 0; i--) cols.push(W - ((W - sh) * i) / outer);
  for (const p of g.portals) {
    const lo = p.d - p.half;
    const hi = p.d + p.half;
    // Drop the even columns too close to the opening, then add its own.
    cols = cols.filter((d) => d < lo - 0.5 * spacing || d > hi + 0.5 * spacing || Math.abs(d) <= sh);
    for (let i = 0; i <= PORTAL_COLUMNS; i++) {
      const d = lo + ((hi - lo) * i) / PORTAL_COLUMNS;
      if (Math.abs(d) > sh && Math.abs(d) < W) cols.push(d);
    }
    cols.sort((a, b) => a - b);
  }
  return cols;
}

/** The meltwater portal whose opening spans frame lateral d (null if none). */
function portalOver(g: GlacierPlacement, d: number): GlacierPortal | null {
  for (const p of g.portals) if (Math.abs(d - p.d) <= p.half + 1e-6) return p;
  return null;
}

/**
 * Warm themes light the scene warm (their own snow is warm too): the glacier's snow is shifted cool
 * by as much, so it still reads as snow rather than sand under a canyon sun.
 */
function coolSnow(g: GlacierPlacement, c: RGB): RGB {
  const theme = isGeneratedTerrain(g.terrain) ? g.terrain.theme : themeOf(g.terrain.level);
  const t = linear(theme.terrain.snow);
  const warmth = clamp(t.r - t.b, 0, 0.3);
  return { r: c.r - warmth * 0.7, g: c.g - warmth * 0.3, b: c.b };
}

/** Height fraction → face ice colour: deep blue at the foot, turquoise toward the top (× k). */
function faceColour(C: Record<string, RGB>, hf: number, k: number): RGB {
  if (hf < 0.35) return mixRGB(C.iceBase, C.iceSide, hf / 0.35, k);
  if (hf < 0.7) return mixRGB(C.iceSide, C.iceSlope, (hf - 0.35) / 0.35, k);
  return mixRGB(C.iceSlope, C.iceTop, (hf - 0.7) / 0.2, k);
}

/**
 * The glacier body. Attributes: position, normal, color (linear), aGlow (emissive weight).
 */
export function buildGlacierGeometry(g: GlacierPlacement): BufferGeometry {
  const C: Record<string, RGB> = {
    snow: coolSnow(g, linear(GLACIER_COLOURS.snow)),
    snowShade: coolSnow(g, linear(GLACIER_COLOURS.snowShade)),
    iceTop: linear(GLACIER_COLOURS.iceTop),
    iceSlope: linear(GLACIER_COLOURS.iceSlope),
    iceSide: linear(GLACIER_COLOURS.iceSide),
    iceBase: linear(GLACIER_COLOURS.iceBase),
    icePale: linear(GLACIER_COLOURS.icePale),
    icePaleDeep: linear(GLACIER_COLOURS.icePaleDeep),
    fresh: linear(GLACIER_COLOURS.fresh),
    freshDeep: linear(GLACIER_COLOURS.freshDeep),
    crevasse: linear(GLACIER_COLOURS.crevasse),
  };
  const rng = createRng((g.seed ^ 0x61ac1e5) >>> 0);
  const tris = new Tris();
  const cols = glacierColumns(g);
  const nj = cols.length;
  const rowStep = 2.2;
  const ni = Math.max(4, Math.ceil((g.faceS - g.backS) / rowStep));
  const sc = g.scale;
  const jitterY = 0.12 * Math.max(1, sc * 0.7);
  /** No jitter near the socket (the crack ribbons sit just above the surface there). */
  const calm = (s: number, d: number): number =>
    smoothstep(2.2 * g.radius, 3.6 * g.radius, Math.hypot(s - g.embedS, d));

  // --- top surface: rows from backS to each column's front edge ---
  const top: V[][] = [];
  const buried: boolean[][] = [];
  const fronts = cols.map((d) => glacierFrontS(g, d));
  for (let i = 0; i <= ni; i++) {
    const row: V[] = [];
    const rowBuried: boolean[] = [];
    for (let j = 0; j < nj; j++) {
      let d = cols[j];
      let s = g.backS + (i / ni) * (fronts[j] - g.backS);
      const edge = i === 0 || i === ni || j === 0 || j === nj - 1;
      const k = calm(s, d);
      if (!edge) {
        s += (hash2(i, j, g.seed + 3) - 0.5) * 0.6 * k;
        d += (hash2(i, j, g.seed + 5) - 0.5) * 0.6 * k;
      }
      const ground = groundAt(g, s, d);
      let y = glacierSurface(g, s, d) + (hash2(i, j, g.seed + 7) - 0.5) * 2 * jitterY * k;
      const under = i === 0 || y < ground + 0.05;
      if (under) y = ground - 0.6;
      row.push(worldAt(g, s, d, y));
      rowBuried.push(under);
    }
    top.push(row);
    buried.push(rowBuried);
  }
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj - 1; j++) {
      const a = top[i][j];
      const b = top[i + 1][j];
      const c = top[i + 1][j + 1];
      const d = top[i][j + 1];
      const bur = buried[i][j] && buried[i + 1][j] && buried[i + 1][j + 1] && buried[i][j + 1];
      if (bur) continue;
      const lip = i === ni - 1;
      const quad = (p: V, q: V, r: V): void => {
        const ux = q[0] - p[0];
        const uy = q[1] - p[1];
        const uz = q[2] - p[2];
        const vx = r[0] - p[0];
        const vy = r[1] - p[1];
        const vz = r[2] - p[2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const up = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
        const rnd = rng();
        let rgb: RGB;
        let glow: number;
        if (lip) {
          rgb = mixRGB(C.icePale, C.snow, 0.35 + 0.3 * rnd);
          glow = GLACIER_GLOW.pale;
        } else if (up < 0.72) {
          // Steep: exposed ice (the icefall down the headwall).
          rgb = mixRGB(C.icePale, C.icePaleDeep, rnd, 0.97);
          glow = GLACIER_GLOW.pale;
        } else if (rnd < 0.05) {
          rgb = mixRGB(C.snow, C.icePale, 0.6);
          glow = GLACIER_GLOW.pale * 0.5;
        } else {
          rgb = mixRGB(C.snow, C.snowShade, smoothstep(0.97, 0.8, up), 0.95 + 0.07 * rng());
          glow = GLACIER_GLOW.snow;
        }
        tris.add(p, q, r, rgb, glow, 0, 1, 0);
      };
      if ((i + j) % 2 === 0) {
        quad(a, b, c);
        quad(a, c, d);
      } else {
        quad(a, b, d);
        quad(b, c, d);
      }
    }
  }

  // --- the face (snout) and the socket: per column top → snow cap → mid → bottom ---
  const fwd = { x: g.fx, z: g.fz };
  const faceTop = top[ni];
  interface FaceCol {
    t: V;
    c: V;
    m: V;
    b: V;
    socket: boolean;
    portal: boolean;
    floor: V | null;
    ok: boolean;
  }
  const face: FaceCol[] = [];
  for (let j = 0; j < nj; j++) {
    const d = cols[j];
    const socketS = glacierSocketS(g, d);
    const snout = glacierSnoutS(g, d);
    const socket = socketS > -Infinity && socketS < snout - 0.05;
    const t = faceTop[j];
    const sFront = fronts[j];
    let bottomY: number;
    let bottomS: number;
    let floor: V | null = null;
    const portal = socket ? null : portalOver(g, d);
    if (socket) {
      bottomS = socketS;
      bottomY = groundAt(g, socketS, d) + g.ledge;
      floor = worldAt(g, snout + 0.05, d, groundAt(g, snout + 0.05, d) - 0.25);
    } else if (portal) {
      // Over a meltwater portal the face ends at the arch: the channel runs out beneath it.
      bottomS = snout + 0.25;
      bottomY = portalArchY(portal, d);
    } else {
      bottomS = snout + 0.25;
      bottomY = groundAt(g, bottomS, d) - 0.45;
    }
    let bulge = socket ? 0.04 * sc : FACE_BULGE * sc + (hash2(j, 11, g.seed) - 0.5) * 0.08;
    // Uneven rows, so the face reads as fractured ice rather than stripes.
    let midF = FACE_MID + (socket ? 0 : (hash2(j, 13, g.seed) - 0.5) * 0.18);
    if (portal) {
      // Over a portal the lower row is the arch's rim: a band of fresh ice standing a little proud.
      midF = Math.min(0.45, PORTAL_RIM / Math.max(0.5, t[1] - bottomY));
      bulge = FACE_BULGE * sc + PORTAL_LIP;
    }
    const capH = Math.min(0.14 * (t[1] - bottomY), 0.35 * sc + 0.15) * (0.7 + 0.6 * hash2(j, 17, g.seed));
    const c = worldAt(g, sFront + 0.06 * sc, d, t[1] - capH);
    const m = worldAt(g, lerp(bottomS, sFront, midF) + bulge, d, lerp(bottomY, t[1], midF));
    face.push({
      t,
      c,
      m,
      b: worldAt(g, bottomS, d, bottomY),
      socket,
      portal: portal !== null,
      floor,
      ok: !buried[ni][j],
    });
  }
  for (let j = 0; j < nj - 1; j++) {
    const p = face[j];
    const q = face[j + 1];
    if (!p.ok || !q.ok) continue;
    const socket = p.socket || q.socket;
    const both = p.socket && q.socket;
    const strata = j % 2;
    const ice = (hf: number, k: number): RGB => {
      const shade = 0.9 + 0.06 * k + 0.08 * rng();
      return both ? mixRGB(C.fresh, C.freshDeep, 1 - hf, shade + 0.04) : faceColour(C, hf, shade);
    };
    const glow = both ? GLACIER_GLOW.fresh : socket ? GLACIER_GLOW.ice * 1.1 : GLACIER_GLOW.ice;
    // Snow cap along the top edge (fresh ice in the socket).
    const cap = both ? ice(0.95, strata) : mixRGB(C.snow, C.icePale, 0.2 + 0.2 * rng());
    const capGlow = both ? glow : GLACIER_GLOW.snow;
    tris.add(p.t, q.t, q.c, cap, capGlow, fwd.x, 0, fwd.z);
    tris.add(p.t, q.c, p.c, cap, capGlow, fwd.x, 0, fwd.z);
    tris.add(p.c, q.c, q.m, ice(0.82, strata), glow, fwd.x, 0, fwd.z);
    tris.add(p.c, q.m, p.m, ice(0.7, 1 - strata), glow, fwd.x, 0, fwd.z);
    if (p.portal && q.portal) {
      // The arch's rim: fresh pale ice framing the dark opening.
      const rim = mixRGB(C.fresh, C.icePale, 0.25 + 0.3 * rng());
      tris.add(p.m, q.m, q.b, rim, GLACIER_GLOW.fresh * 0.8, fwd.x, 0, fwd.z);
      tris.add(p.m, q.b, p.b, rim, GLACIER_GLOW.fresh * 0.8, fwd.x, 0, fwd.z);
    } else {
      tris.add(p.m, q.m, q.b, ice(0.3, strata), glow, fwd.x, 0, fwd.z);
      tris.add(p.m, q.b, p.b, ice(0.15, 1 - strata), glow, fwd.x, 0, fwd.z);
    }
    if (both && p.floor && q.floor) {
      const floorRgb = mixRGB(C.fresh, C.icePale, 0.4);
      tris.add(p.b, q.b, q.floor, floorRgb, GLACIER_GLOW.fresh, 0, 1, 0);
      tris.add(p.b, q.floor, p.floor, floorRgb, GLACIER_GLOW.fresh, 0, 1, 0);
    }
  }

  // --- meltwater portals: a vault into the ice behind each arch, ending in a dark back wall ---
  for (const p of g.portals) {
    const arch = cols.map((d, j) => ({ d, j })).filter(({ d }) => portalOver(g, d) === p);
    if (arch.length >= 2) addPortalVault(g, p, arch.map(({ j }) => face[j].b), tris);
  }

  // --- crevasses: dark-blue ribbons across the top, parallel to the snout ---
  const count = 7 + Math.floor(rng() * 3);
  const sMax = g.faceS - 2.2 * sc - 0.5;
  const sMin = g.backS + 8;
  for (let k = 0; k < count && sMax > sMin; k++) {
    const sk = lerp(sMin, sMax, (k + rng()) / count);
    const dc = (rng() - 0.5) * g.halfWidth * 0.9;
    const half = (0.15 + 0.25 * rng()) * g.halfWidth;
    const width = (0.35 + 0.35 * rng()) * Math.max(1, sc * 0.8);
    const phase = rng() * 6.28;
    const n = Math.max(2, Math.ceil((2 * half) / 1.8));
    let prev: { l: V; r: V } | null = null;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const d = dc - half + 2 * half * u;
      const a = d / g.floorHalfWidth;
      const s = sk - GLACIER_TUNING.lobe * g.floorHalfWidth * a * a * 0.85 + 0.6 * Math.sin(d * 0.4 + phase);
      const w = width * Math.sin(Math.PI * clamp(u, 0.04, 0.96));
      glacierWorld(g, s, d, scratch);
      const topY = glacierTopAt(g, scratch.x, scratch.z);
      if (!Number.isFinite(topY) || Math.hypot(s - g.embedS, d) < 2.5 * g.radius) {
        prev = null;
        continue;
      }
      const y = glacierSurface(g, s, d) + 0.07;
      const cur = { l: worldAt(g, s - w / 2, d, y), r: worldAt(g, s + w / 2, d, y) };
      if (prev) {
        const glow = GLACIER_GLOW.crevasse;
        tris.add(prev.l, prev.r, cur.r, C.crevasse, glow, 0, 1, 0);
        tris.add(prev.l, cur.r, cur.l, C.crevasse, glow, 0, 1, 0);
      }
      prev = cur;
    }
  }

  return tris.toGeometry(true);
}

/**
 * The vault behind a meltwater portal: the arch (`mouth`, the face's bottom points over the opening,
 * left to right) carried `depth` m into the ice along the stream in VAULT_SLICES slices, narrowing
 * to PORTAL_TUNING.backShare and following the bank tops up the channel, its inside faces blue ice
 * darkening into the glacier; then a near-black back wall from the last arch down below the bed,
 * so the channel (and the stream's water, which runs on under the ice to its source) disappears
 * into the dark.
 */
function addPortalVault(g: GlacierPlacement, p: GlacierPortal, mouth: V[], tris: Tris): void {
  const PT = PORTAL_TUNING;
  const C = {
    vault: linear(GLACIER_COLOURS.vault),
    deep: linear(GLACIER_COLOURS.vaultDeep),
    back: linear(GLACIER_COLOURS.vaultBack),
  };
  // Downstream direction in the world, and the axis point at the face.
  const ex = g.fx * p.dirS + g.rx * p.dirD;
  const ez = g.fz * p.dirS + g.rz * p.dirD;
  const el = Math.hypot(ex, ez) || 1;
  const ux = ex / el;
  const uz = ez / el;
  const o = worldAt(g, glacierSnoutS(g, p.d) + 0.25, p.d, 0);
  const spring0 = p.springY - PT.springSink;
  const slices: V[][] = [];
  const axis: V[] = [];
  for (let k = 0; k <= VAULT_SLICES; k++) {
    const f = k / VAULT_SLICES;
    const t = p.depth * f;
    const sh = lerp(1, PT.backShare, f);
    const spring = lerp(p.springY, p.backSpringY, f) - PT.springSink;
    const ox = o[0] - ux * t;
    const oz = o[2] - uz * t;
    axis.push([ox, spring, oz]);
    slices.push(
      mouth.map((m, j) => {
        // A little roughness inside (not at the arch itself, which the face shares).
        const jitter = k === 0 ? 0 : (hash2(j, k, g.seed + 29) - 0.5) * 0.3;
        return [
          ox + (m[0] - o[0]) * sh,
          spring + (m[1] - spring0) * sh + jitter,
          oz + (m[2] - o[2]) * sh,
        ] as V;
      }),
    );
  }
  for (let k = 0; k < VAULT_SLICES; k++) {
    const f = (k + 0.5) / VAULT_SLICES;
    const rgb = mixRGB(C.vault, C.deep, smoothstep(0, 1, f));
    const glow = GLACIER_GLOW.vault * (1 - f) ** 2;
    const a = axis[k];
    for (let j = 0; j + 1 < mouth.length; j++) {
      const p0 = slices[k][j];
      const p1 = slices[k][j + 1];
      const q0 = slices[k + 1][j];
      const q1 = slices[k + 1][j + 1];
      // Facing the inside: toward the axis at the spring line.
      const cx = (p0[0] + p1[0] + q0[0] + q1[0]) / 4;
      const cy = (p0[1] + p1[1] + q0[1] + q1[1]) / 4;
      const cz = (p0[2] + p1[2] + q0[2] + q1[2]) / 4;
      const shade = 0.85 + 0.25 * hash2(j, k, g.seed + 31);
      const c = { r: rgb.r * shade, g: rgb.g * shade, b: rgb.b * shade };
      tris.add(p0, q0, q1, c, glow, a[0] - cx, a[1] - cy, a[2] - cz);
      tris.add(p0, q1, p1, c, glow, a[0] - cx, a[1] - cy, a[2] - cz);
    }
  }
  // Back wall: the last arch closed down to below the bed, facing out of the portal.
  const last = slices[VAULT_SLICES];
  const ax = axis[VAULT_SLICES];
  const floorY = p.bedY - 1.2;
  const l = last[0];
  const r = last[last.length - 1];
  const centre: V = [ax[0], floorY, ax[2]];
  const lb: V = [l[0], floorY, l[2]];
  const rb: V = [r[0], floorY, r[2]];
  tris.add(centre, lb, l, C.back, GLACIER_GLOW.vaultBack, ux, 0, uz);
  for (let j = 0; j + 1 < last.length; j++) {
    tris.add(centre, last[j], last[j + 1], C.back, GLACIER_GLOW.vaultBack, ux, 0, uz);
  }
  tris.add(centre, r, rb, C.back, GLACIER_GLOW.vaultBack, ux, 0, uz);
}

/** One crack polyline in the frame: points (s, d, height above the surface / on the face), reveal. */
interface CrackPoint {
  p: V;
  reveal: number;
}

/**
 * The calving cracks: ribbons around the socket (on the glacier top) and down the face beside it,
 * with branches. Attributes: position, aReveal (0 where the crack starts → 1 where it ends; a crack
 * point is lit once the shader's uCrack passes it) and aEdge (−1..1 across the ribbon).
 */
export function buildCrackGeometry(g: GlacierPlacement): BufferGeometry {
  const rng = createRng((g.seed ^ 0xc4ac5) >>> 0);
  const sc = g.scale;
  const pos: number[] = [];
  const reveal: number[] = [];
  const edge: number[] = [];
  const upHint = { x: 0, y: 1, z: 0 };
  const fwdHint = { x: g.fx, y: 0, z: g.fz };

  const onTop = (s: number, d: number, r: number): CrackPoint => ({
    p: worldAt(g, s, d, glacierSurface(g, s, d) + 0.08),
    reveal: r,
  });
  /**
   * A point just in front of the face at height fraction hf (1 = top edge), on the outermost face
   * profile buildGlacierGeometry can produce there (cap lip, bulge incl. its jitter).
   */
  const onFace = (d: number, hf: number, r: number): CrackPoint => {
    const snout = glacierSnoutS(g, d);
    const topY = glacierSurface(g, glacierFrontS(g, d), d);
    const botS = snout + 0.25;
    const botY = groundAt(g, botS, d) - 0.45;
    const midS = lerp(botS, snout, FACE_MID) + FACE_BULGE * sc + 0.04;
    const s =
      hf >= FACE_MID
        ? lerp(midS, snout + 0.06 * sc, (hf - FACE_MID) / (1 - FACE_MID))
        : lerp(botS, midS, hf / FACE_MID);
    return { p: worldAt(g, s + 0.12, d, lerp(botY, topY, hf)), reveal: r };
  };

  type Dir = { x: number; y: number; z: number };
  const ribbon = (pts: CrackPoint[], width: number, normal: Dir): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.p[0] - a.p[0];
      const dy = b.p[1] - a.p[1];
      const dz = b.p[2] - a.p[2];
      // across = normalize(segment × normal)
      let ax = dy * normal.z - dz * normal.y;
      let ay = dz * normal.x - dx * normal.z;
      let az = dx * normal.y - dy * normal.x;
      const l = Math.hypot(ax, ay, az);
      if (!(l > 1e-9)) continue;
      const h = width / 2 / l;
      ax *= h;
      ay *= h;
      az *= h;
      const quad: [V, number, number][] = [
        [[a.p[0] - ax, a.p[1] - ay, a.p[2] - az], a.reveal, -1],
        [[a.p[0] + ax, a.p[1] + ay, a.p[2] + az], a.reveal, 1],
        [[b.p[0] + ax, b.p[1] + ay, b.p[2] + az], b.reveal, 1],
        [[b.p[0] - ax, b.p[1] - ay, b.p[2] - az], b.reveal, -1],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [v, r, e] = quad[k];
        pos.push(v[0], v[1], v[2]);
        reveal.push(r);
        edge.push(e);
      }
    }
  };

  const dc = g.socketHalf + 0.12 * sc;
  const sB = g.socketBackS - 0.3 * sc;
  const wTop = 0.2 * sc + 0.1;
  const wFace = 0.18 * sc + 0.09;
  const wBranch = 0.12 * sc + 0.06;
  const arcN = 10;
  for (const side of [-1, 1]) {
    const d1 = side * dc;
    const sC = glacierSnoutS(g, d1) - 0.05;
    // Behind the socket, from the back point round to the corner on the face's top edge.
    const arc: CrackPoint[] = [];
    for (let i = 0; i <= arcN; i++) {
      const phi = (i / arcN) * (Math.PI / 2);
      const s = sC - (sC - sB) * Math.cos(phi) + (i > 0 && i < arcN ? (rng() - 0.5) * 0.12 * sc : 0);
      const d = d1 * Math.sin(phi);
      arc.push(onTop(s, d, 0.45 * (i / arcN)));
    }
    ribbon(arc, wTop, upHint);
    // Down the face beside the socket, zig-zagging.
    const down: CrackPoint[] = [];
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const hf = 1 - i / steps;
      const zig = i > 0 && i < steps ? (rng() - 0.5) * 0.3 * sc : 0;
      down.push(onFace(d1 + zig, hf, 0.45 + 0.4 * (i / steps)));
    }
    ribbon(down, wFace, fwdHint);
    // A diagonal branch off the face crack, away from the socket.
    const mid = 2;
    const branch: CrackPoint[] = [];
    for (let i = 0; i <= 3; i++) {
      const hf = (1 - mid / steps) * (1 - i / 3) + 0.08 * (i / 3);
      branch.push(onFace(d1 + side * (0.25 + 0.5 * i) * sc, hf, 0.6 + 0.35 * (i / 3)));
    }
    ribbon(branch, wBranch, fwdHint);
    // Hairline branches off the top arc, outward.
    for (const at of [3, 7]) {
      const base = arc[at];
      const phi = (at / arcN) * (Math.PI / 2);
      const s0 = sC - (sC - sB) * Math.cos(phi);
      const d0 = d1 * Math.sin(phi);
      const len = (0.6 + 0.8 * rng()) * g.radius;
      const pts: CrackPoint[] = [base];
      for (let i = 1; i <= 3; i++) {
        const f = i / 3;
        const s = s0 - Math.cos(phi) * len * f + (rng() - 0.5) * 0.2 * sc;
        const d = d0 + side * Math.sin(phi + 0.4) * len * f;
        pts.push(onTop(s, d, base.reveal + 0.3 * f));
      }
      ribbon(pts, wBranch, upHint);
    }
  }
  // Spreading back up the glacier from the back of the socket.
  const back: CrackPoint[] = [];
  for (let i = 0; i <= 4; i++) {
    const f = i / 4;
    back.push(onTop(sB - 1.2 * g.radius * f, (rng() - 0.5) * 0.3 * sc * (i > 0 ? 1 : 0), 0.3 * f));
  }
  ribbon(back, wBranch, upHint);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aReveal', new BufferAttribute(new Float32Array(reveal), 1));
  geo.setAttribute('aEdge', new BufferAttribute(new Float32Array(edge), 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The snow field: every terrain triangle around the glacier whose snow cover passes a ragged
 * threshold, as the heightGrid triangulates it (exactly the terrain mesh's faces), lifted SNOW_LIFT
 * and coloured with the theme's snow. Faces fully under the glacier are skipped.
 */
export function buildSnowFieldGeometry(g: GlacierPlacement): BufferGeometry {
  const terrain = g.terrain;
  const grid = terrain.grid;
  const theme = isGeneratedTerrain(terrain) ? terrain.theme : themeOf(terrain.level);
  const snow = mixRGB(linear(GLACIER_COLOURS.snow), linear(theme.terrain.snow), 0.4);
  const shade = mixRGB(linear(GLACIER_COLOURS.snowShade), linear(theme.terrain.snowShade), 0.4);
  const tris = new Tris();
  const T = GLACIER_TUNING;
  const halfW = g.floorHalfWidth + T.snowWallRamps * Math.max(1, terrain.level.wallRamp);
  const cs = g.faceS - T.snowCentreBack;
  const len = T.snowHalfLength * 1.15;
  const wide = halfW * 1.15;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [su, sd] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    glacierWorld(g, cs + su * len, sd * wide, scratch);
    minX = Math.min(minX, scratch.x);
    maxX = Math.max(maxX, scratch.x);
    minZ = Math.min(minZ, scratch.z);
    maxZ = Math.max(maxZ, scratch.z);
  }
  const c = grid.cellSize;
  const ix0 = clamp(Math.floor((minX - grid.originX) / c), 0, grid.cols - 2);
  const ix1 = clamp(Math.ceil((maxX - grid.originX) / c), 0, grid.cols - 2);
  const iz0 = clamp(Math.floor((minZ - grid.originZ) / c), 0, grid.rows - 2);
  const iz1 = clamp(Math.ceil((maxZ - grid.originZ) / c), 0, grid.rows - 2);
  const lift = SNOW_LIFT;
  const face = (a: V, b: V, q: V, rnd: number): void => {
    const cx = (a[0] + b[0] + q[0]) / 3;
    const cy = (a[1] + b[1] + q[1]) / 3;
    const cz = (a[2] + b[2] + q[2]) / 3;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = q[0] - a[0];
    const vy = q[1] - a[1];
    const vz = q[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const slope = Math.abs(ny) > 1e-9 ? Math.hypot(nx, nz) / Math.abs(ny) : 1e6;
    const amount = glacierSnowAt(g, cx, cz, cy, slope);
    if (amount < 0.5 + 0.35 * (rnd - 0.5)) return;
    if (glacierTopAt(g, cx, cz) > cy + 0.4) return;
    const rgb = mixRGB(snow, shade, smoothstep(0.25, 1.1, slope), 0.94 + 0.08 * rnd);
    tris.add(
      [a[0], a[1] + lift, a[2]],
      [b[0], b[1] + lift, b[2]],
      [q[0], q[1] + lift, q[2]],
      rgb,
      0,
      0,
      1,
      0,
    );
  };
  for (let iz = iz0; iz <= iz1; iz++) {
    const z0 = grid.originZ + iz * c;
    const z1 = z0 + c;
    for (let ix = ix0; ix <= ix1; ix++) {
      const x0 = grid.originX + ix * c;
      const x1 = x0 + c;
      const p00: V = [x0, gridValue(grid, ix, iz), z0];
      const p10: V = [x1, gridValue(grid, ix + 1, iz), z0];
      const p11: V = [x1, gridValue(grid, ix + 1, iz + 1), z1];
      const p01: V = [x0, gridValue(grid, ix, iz + 1), z1];
      face(p00, p11, p10, hash2(ix * 2, iz, g.seed + 71));
      face(p00, p01, p11, hash2(ix * 2 + 1, iz, g.seed + 71));
    }
  }
  return tris.toGeometry(false);
}
