import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import {
  ICEBERG_VISUAL,
  buildIcebergGeometry,
  chipLookFor,
  decayChipLook,
  frostFactor,
  growthFactor,
  icebergGrowth,
  icebergVisualScale,
  type ChipLook,
} from './Iceberg';

const SEED = ICEBERG_VISUAL.shapeSeed;

function attr(g: BufferGeometry, name: string): Float32Array {
  return g.getAttribute(name).array as Float32Array;
}

/** CPU mirror of the vertex shader: positions as drawn at a given growth (0..1). */
function grownPositions(g: BufferGeometry, growth: number): Float32Array {
  const p = attr(g, 'position');
  const a = attr(g, 'aAnchor');
  const t = attr(g, 'aGrow');
  const out = new Float32Array(p.length);
  for (let v = 0; v < t.length; v++) {
    const k = growthFactor(t[v], growth);
    for (let c = 0; c < 3; c++) out[v * 3 + c] = a[v * 3 + c] + (p[v * 3 + c] - a[v * 3 + c]) * k;
  }
  return out;
}

/** Largest horizontal reach in each of `n` azimuth sectors (the outline seen from above). */
function silhouette(p: Float32Array, n: number): number[] {
  const reach = new Array<number>(n).fill(0);
  const S = 8;
  for (let t = 0; t < p.length; t += 9) {
    // Sample each triangle so sectors between vertices see its edges too.
    for (let i = 0; i <= S; i++) {
      for (let j = 0; j <= S - i; j++) {
        const u = i / S;
        const v = j / S;
        const x = p[t] + (p[t + 3] - p[t]) * u + (p[t + 6] - p[t]) * v;
        const z = p[t + 2] + (p[t + 5] - p[t + 2]) * u + (p[t + 8] - p[t + 2]) * v;
        const sec = Math.floor(((Math.atan2(x, z) + Math.PI) / (2 * Math.PI)) * n) % n;
        reach[sec] = Math.max(reach[sec], Math.hypot(x, z));
      }
    }
  }
  return reach;
}

function spread(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / m;
}

describe('iceberg growth look', () => {
  it('growth is 0 while melting or as spawned, 1 at the largest size, monotonic between', () => {
    expect(icebergGrowth(0.55)).toBe(0);
    expect(icebergGrowth(1)).toBe(0);
    expect(icebergGrowth(ICEBERG_VISUAL.maxGrowthSize)).toBe(1);
    expect(icebergGrowth(Math.cbrt(6))).toBe(1);
    let prev = 0;
    for (let s = 1; s <= 1.9; s += 0.05) {
      const g = icebergGrowth(s);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(icebergGrowth(1.4)).toBeGreaterThan(0.3);
    expect(icebergGrowth(1.4)).toBeLessThan(0.7);
  });

  it('visual scale follows the collision radius (level scale × size), with a safe fallback', () => {
    expect(icebergVisualScale(2.2, 1)).toBeCloseTo(1);
    // A level with iceberg.scale 1.6 that has grown to size 1.5: radius 2.2 × 1.6 × 1.5.
    expect(icebergVisualScale(2.2 * 1.6 * 1.5, 1.5, 1.6)).toBeCloseTo(2.4);
    expect(icebergVisualScale(0, 0.8, 1.5)).toBeCloseTo(1.2);
    expect(icebergVisualScale(Number.NaN, 0, 1)).toBe(1);
  });

  it('geometry is deterministic and carries the growth / frost / chip attributes', () => {
    const a = buildIcebergGeometry(SEED);
    const b = buildIcebergGeometry(SEED);
    const verts = attr(a, 'position').length / 3;
    for (const name of ['position', 'color', 'aGrow', 'aAnchor', 'aFrost', 'aChip']) {
      expect(attr(a, name)).toEqual(attr(b, name));
    }
    expect(attr(a, 'aGrow').length).toBe(verts);
    expect(attr(a, 'aFrost').length).toBe(verts);
    expect(attr(a, 'aChip').length).toBe(verts);
    expect(attr(a, 'aAnchor').length).toBe(verts * 3);
    expect(attr(buildIcebergGeometry(SEED + 1), 'position')).not.toEqual(attr(a, 'position'));
  });

  it('at normal size the iceberg looks exactly as before (hull unchanged, accretions hidden)', () => {
    const g = buildIcebergGeometry(SEED);
    const p = attr(g, 'position');
    const c = attr(g, 'color');
    const t = attr(g, 'aGrow');
    const hull = ICEBERG_VISUAL.hullVertices;
    expect(hull).toBe(114);
    for (let v = 0; v < hull; v++) expect(t[v]).toBeLessThan(0);
    let sp = 0;
    let sc = 0;
    for (let i = 0; i < hull * 3; i++) {
      sp += p[i] * ((i % 7) + 1);
      sc += c[i] * ((i % 5) + 1);
    }
    // Checksums of the original hull (positions and face colours) before growth existed.
    expect(sp).toBeCloseTo(504.9358, 3);
    expect(sc).toBeCloseTo(407.6148, 3);
    // Accretions collapse to points at growth 0, so the drawn shape is just the hull.
    const drawn = grownPositions(g, 0);
    for (let v = hull; v < t.length; v++) {
      expect(t[v]).toBeGreaterThan(0);
      expect(t[v]).toBeLessThanOrEqual(1);
      const a = attr(g, 'aAnchor');
      for (let k = 0; k < 3; k++) expect(drawn[v * 3 + k]).toBeCloseTo(a[v * 3 + k], 6);
    }
  });

  it('a fully grown iceberg has a bigger, more irregular silhouette', () => {
    const g = buildIcebergGeometry(SEED);
    const small = silhouette(grownPositions(g, 0), 12);
    const big = silhouette(grownPositions(g, 1), 12);
    expect(Math.max(...big)).toBeGreaterThan(Math.max(...small) * 1.08);
    expect(spread(big)).toBeGreaterThan(spread(small));
    // Every sector stays within a sensible reach of the collision radius (2.2 m at size 1).
    expect(Math.max(...big)).toBeLessThan(2.2 * 1.3);
    // Accretions build up gradually: some appear early, some only near full size.
    const t = Array.from(attr(g, 'aGrow')).filter((x) => x > 0);
    expect(Math.min(...t)).toBeLessThan(0.3);
    expect(Math.max(...t)).toBeGreaterThan(0.7);
    // No accretion pokes below the base (into the ground) or towers above the peaks.
    const full = grownPositions(g, 1);
    for (let v = ICEBERG_VISUAL.hullVertices; v < full.length / 3; v++) {
      expect(full[v * 3 + 1]).toBeGreaterThan(0.15);
      expect(full[v * 3 + 1]).toBeLessThan(3.4);
    }
  });

  it('frost spreads from the top facets down, never onto the underside', () => {
    const g = buildIcebergGeometry(SEED);
    const n = attr(g, 'normal');
    const f = attr(g, 'aFrost');
    const hull = ICEBERG_VISUAL.hullVertices;
    const top: number[] = [];
    const side: number[] = [];
    for (let v = 0; v < hull; v++) {
      const ny = n[v * 3 + 1];
      if (ny > 0.6) top.push(f[v]);
      else if (ny < -0.5) expect(frostFactor(f[v], 1)).toBe(0);
      else if (Math.abs(ny) < 0.5) side.push(f[v]);
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(top.length).toBeGreaterThan(0);
    expect(side.length).toBeGreaterThan(0);
    expect(mean(top)).toBeLessThan(mean(side));
    // No frost at all at normal size; at full growth most tops are snow-crusted.
    for (let v = 0; v < hull; v++) expect(frostFactor(f[v], 0)).toBe(0);
    const frostedTops = top.filter((x) => frostFactor(x, 1) > 0.5).length;
    expect(frostedTops / top.length).toBeGreaterThan(0.8);
    expect(frostFactor(0.2, 1)).toBeLessThanOrEqual(ICEBERG_VISUAL.frostMax);
  });

  it('fully grown, some upper facets stay glowing ice so it still reads as the iceberg', () => {
    const g = buildIcebergGeometry(SEED);
    const n = attr(g, 'normal');
    const f = attr(g, 'aFrost');
    let upper = 0;
    let icy = 0;
    // Upper sides and slopes (facing outward/upward, below the top facets), one sample per face.
    for (let v = 0; v < ICEBERG_VISUAL.hullVertices; v += 3) {
      const ny = n[v * 3 + 1];
      if (ny < 0 || ny > 0.6) continue;
      upper++;
      if (frostFactor(f[v], 1) < 0.4) icy++;
    }
    expect(upper).toBeGreaterThan(6);
    expect(icy / upper).toBeGreaterThan(0.15);
    expect(icy / upper).toBeLessThan(0.7);
  });

  it('accreted glacier ice grows as blunt lumps, not single-apex crystal spikes', () => {
    const g = buildIcebergGeometry(SEED);
    const p = attr(g, 'position');
    const a = attr(g, 'aAnchor');
    const t = attr(g, 'aGrow');
    const lumps = new Map<string, Map<string, number[]>>();
    for (let v = ICEBERG_VISUAL.hullVertices; v < t.length; v++) {
      const key = `${a[v * 3].toFixed(5)},${a[v * 3 + 1].toFixed(5)},${a[v * 3 + 2].toFixed(5)}`;
      const verts = lumps.get(key) ?? new Map<string, number[]>();
      const pos = [p[v * 3] - a[v * 3], p[v * 3 + 1] - a[v * 3 + 1], p[v * 3 + 2] - a[v * 3 + 2]];
      verts.set(pos.map((x) => x.toFixed(5)).join(','), pos);
      lumps.set(key, verts);
    }
    expect(lumps.size).toBe(ICEBERG_VISUAL.accretions);
    for (const verts of lumps.values()) {
      const offs = [...verts.values()];
      // Outward = mean offset from the anchor; the two outermost corners share the top (a ridge).
      const d = [0, 1, 2].map((k) => offs.reduce((s, o) => s + o[k], 0) / offs.length);
      const len = Math.hypot(d[0], d[1], d[2]);
      const heights = offs.map((o) => (o[0] * d[0] + o[1] * d[1] + o[2] * d[2]) / len).sort((x, y) => y - x);
      expect(heights[0]).toBeGreaterThan(0);
      expect(heights[1]).toBeGreaterThan(heights[0] * 0.8);
    }
  });
});

describe('iceberg damage look', () => {
  it('a chip flashes and scars in proportion to the ice lost, within subtle limits', () => {
    const small: ChipLook = { flash: 0, scar: 0 };
    const big: ChipLook = { flash: 0, scar: 0 };
    chipLookFor(0.01, small);
    chipLookFor(0.1, big);
    expect(small.flash).toBeGreaterThan(0);
    expect(big.flash).toBeGreaterThan(small.flash);
    expect(big.scar).toBeGreaterThan(small.scar);
    expect(big.flash).toBeLessThanOrEqual(1);
    expect(big.scar).toBeLessThanOrEqual(ICEBERG_VISUAL.maxScar);
    const none: ChipLook = { flash: 0, scar: 0 };
    chipLookFor(0, none);
    expect(none).toEqual({ flash: 0, scar: 0 });
    // A second, smaller hit never makes the look weaker than it already is.
    const before = { ...big };
    chipLookFor(0.01, big);
    expect(big.flash).toBeGreaterThanOrEqual(before.flash);
    expect(big.scar).toBeGreaterThanOrEqual(before.scar);
  });

  it('the flash is quick, the scars linger briefly, and both fade without flicker', () => {
    const look: ChipLook = { flash: 0, scar: 0 };
    chipLookFor(0.08, look);
    let flash = look.flash;
    let scar = look.scar;
    let t = 0;
    let flashGone = -1;
    let scarGone = -1;
    while (t < 4) {
      decayChipLook(look, 1 / 60);
      t += 1 / 60;
      expect(look.flash).toBeLessThanOrEqual(flash);
      expect(look.scar).toBeLessThanOrEqual(scar);
      flash = look.flash;
      scar = look.scar;
      if (flashGone < 0 && look.flash === 0) flashGone = t;
      if (scarGone < 0 && look.scar === 0) scarGone = t;
    }
    expect(flashGone).toBeGreaterThan(0.15);
    expect(flashGone).toBeLessThan(0.8);
    expect(scarGone).toBeGreaterThan(flashGone);
    expect(scarGone).toBeLessThan(3);
  });
});
