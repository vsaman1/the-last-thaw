import { Euler, Quaternion, Vector3 } from 'three';
import type { PartDef, Profile, StructureDef, V3 } from './kit';

/**
 * A power-station cooling tower: a 42 m reinforced-concrete hyperboloid shell (13 m base radius,
 * 8.4 m waist at 30 m, flaring to 8.9 m at the rim) standing on a ring of X-shaped inlet columns.
 *
 * Built as ONE anchored body whose shell is 3 bands x 10 flat, inward-leaning concrete panels (30
 * convex prisms, 3 shape keys); the air inlet (dark band + diagonal columns) and the rim are decor.
 * The hollow, open-topped shell reads correctly from above: panels are hulls, not a solid lathe.
 *
 * Strength: breakSpeed 45 m/s for a 30 t iceberg (breakImpulse 1687.5 t·m/s), i.e. more than the
 * 34 m/s speed cap, so a normal iceberg only bounces off (and chips hard). A 100 t iceberg breaks it
 * from 13.5 m/s, a 220 t one from 6.1 m/s. It then shatters into its 30 curved-shell panels (4-8 t
 * each): the ones next to the impact are shoved in, the rest lose support and cave in or peel off.
 *
 * Mass: 120 t of "game" concrete (a real shell weighs thousands). The mass decides what smashing
 * through costs: the iceberg keeps 1 - 1.25·m/(M + m) of its speed, ~56 % for a 220 t iceberg.
 * Proxy: a 'trunk' circle of the base radius around the tower axis (the footprint box would
 * overstate a round tower by ~20 %). Place it on near-flat ground: on a slope the downhill side
 * rests on the ground and the uphill side is sunk in (the shell is rigid).
 */

const N = 10;
/** Outer shell profile [radius, height] (m): base, lower bend, waist, rim. */
const PROFILE: Profile = [
  [13, 0],
  [10.3, 14],
  [8.4, 30],
  [8.9, 42],
];
/** Panel (shell) thickness (m): thicker than a real shell, for sturdy contacts in the debris pile. */
const T = 1.1;
/** Vertical gap between bands and horizontal clearance at the inner seams (m). */
const GAP = 0.03;
const HALF = Math.PI / N;
const INLET_H = 3.6;
/** Adjacent panels of a band that break away together as one curved section. */
const PER_PIECE = 1;

const _q = new Quaternion();
const _qy = new Quaternion();
const _e = new Euler();
const _v = new Vector3();
const _d = new Vector3();
const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

const shade = (c: number, k: number): number => {
  const ch = (s: number): number => Math.min(255, Math.round(((c >> s) & 0xff) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

interface Band {
  id: string;
  outline: Profile;
  /** Lean of the panel's top toward the axis (rad; negative = flaring out). */
  lean: number;
  slant: number;
  size: V3;
  /** Outer-face centre: apothem and height. */
  apothem: number;
  y: number;
  index: number;
}

/** The three panel bands (shared by every instance; shape keys are per band). */
const BANDS: Band[] = PROFILE.slice(0, -1).map(([r0, y0], k) => {
  const [r1, y1] = PROFILE[k + 1];
  const ya = y0 + (k === 0 ? 0 : GAP / 2);
  const yb = y1 - (k === PROFILE.length - 2 ? 0 : GAP / 2);
  const a0 = r0 * Math.cos(HALF);
  const a1 = r1 * Math.cos(HALF);
  // Apothems at the band's ends (the radius changes linearly with height).
  const at = (y: number): number => a0 + ((a1 - a0) * (y - y0)) / (y1 - y0);
  const aa = at(ya);
  const ab = at(yb);
  // Width that keeps the inner corners inside the panel's wedge (no overlap between pieces).
  const w = (a: number): number => 2 * (a - T) * Math.tan(HALF) - GAP;
  const wb = w(aa);
  const wt = w(ab);
  const slant = Math.hypot(yb - ya, aa - ab);
  const outline: Profile = [
    [-wb / 2, 0],
    [wb / 2, 0],
    [wt / 2, slant],
    [-wt / 2, slant],
  ];
  return {
    id: `coolingTower-panel${k}`,
    outline,
    lean: Math.atan2(aa - ab, yb - ya),
    slant,
    size: [Math.max(wb, wt), slant, T],
    apothem: (aa + ab) / 2,
    y: (ya + yb) / 2,
    index: k,
  };
});

/** A panel's placement: rotation (quaternion) and centre, for azimuth phi. */
function panelFrame(band: Band, phi: number): { q: Quaternion; c: Vector3 } {
  const q = new Quaternion()
    .setFromAxisAngle(UP, phi)
    .multiply(_q.setFromAxisAngle(X_AXIS, -band.lean));
  // Outward normal of the leaning panel (yawed later): tilted up for an inward lean.
  const nY = Math.sin(band.lean);
  const nZ = Math.cos(band.lean);
  const c = new Vector3(0, band.y - (nY * T) / 2, band.apothem - (nZ * T) / 2);
  c.applyQuaternion(_qy.setFromAxisAngle(UP, phi));
  return { q, c };
}

const euler = (q: Quaternion): V3 => {
  _e.setFromQuaternion(q, 'XYZ');
  return [_e.x, _e.y, _e.z];
};

/** Panel-local (u across, v up the slant from the bottom edge, w out of the outer face) → frame. */
function onPanel(band: Band, f: { q: Quaternion; c: Vector3 }, u: number, v: number, w: number): V3 {
  _v.set(u, v - band.slant / 2, T / 2 + w).applyQuaternion(f.q).add(f.c);
  return [_v.x, _v.y, _v.z];
}

function beam(a: V3, b: V3, width: number, color: number): PartDef {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  const rot = euler(_q.setFromUnitVectors(UP, _d.normalize()));
  return {
    shape: 'box',
    at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    size: [width, len, width],
    rot,
    color,
    decor: true,
  };
}

/** Panel width (outer face) at slant distance v from its bottom edge. */
function widthAt(band: Band, v: number): number {
  const hb = band.outline[1][0];
  const ht = band.outline[2][0];
  return 2 * (hb + ((ht - hb) * v) / band.slant);
}

const coolingTower: StructureDef = {
  kind: 'coolingTower',
  label: 'Cooling tower',
  material: 'masonry',
  building: true,
  footprint: 13.5,
  palettes: {
    // Weathered reinforced concrete, from light to stained.
    concrete: [0xc9c6bd, 0xbdb9ae, 0xd2cfc6, 0xb4b0a6],
    inlet: [0x262b2f],
  },
  // A round shell needs no orientation; turn it a little so rows of towers do not line up.
  defaultYaw: (ctx) => ctx.rng() * HALF * 2,
  build(ctx) {
    const concrete = ctx.palette('concrete');
    const inlet = ctx.palette('inlet');
    const parts: PartDef[] = [];
    for (const band of BANDS) {
      // Grime: the lower bands are a little darker than the rim band.
      const color = shade(concrete, 0.9 + 0.05 * band.index);
      for (let i = 0; i < N; i++) {
        const phi = (i + 0.5) * HALF * 2;
        const f = panelFrame(band, phi);
        const piece = `panel${band.index}-${Math.floor(i / PER_PIECE)}`;
        // Rib over the seam to the next panel (the panels are narrower than the facets so that
        // their inner corners never overlap, which leaves a slit on the outside).
        const g = panelFrame(band, (i + 1.5) * HALF * 2);
        const edge = widthAt(band, band.slant / 2) / 2;
        const p0 = onPanel(band, f, edge, band.slant / 2, 0.02);
        const p1 = onPanel(band, g, -edge, band.slant / 2, 0.02);
        const seamQ = new Quaternion()
          .setFromAxisAngle(UP, (i + 1) * HALF * 2)
          .multiply(_q.setFromAxisAngle(X_AXIS, -band.lean));
        parts.push({
          shape: 'box',
          piece,
          at: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
          size: [Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) + 0.3, band.slant - 0.1, 0.12],
          rot: euler(seamQ),
          color: shade(color, 0.94),
          decor: true,
        });
        parts.push({
          shape: { type: 'prism', id: band.id, outline: band.outline },
          name: 'panel',
          piece,
          at: [f.c.x, f.c.y, f.c.z],
          size: band.size,
          rot: euler(f.q),
          color,
        });
        if (band.index === 0) {
          // Air inlet: the dark gap under the shell, crossed by a pair of diagonal columns.
          const wIn = widthAt(band, INLET_H / 2);
          parts.push({
            shape: 'box',
            piece,
            at: onPanel(band, f, 0, INLET_H / 2 + 0.25, 0.03),
            size: [wIn, INLET_H, 0.04],
            rot: euler(f.q),
            color: inlet,
            decor: true,
          });
          const half = widthAt(band, 0) / 2 - 0.4;
          for (const s of [-1, 1]) {
            const a = onPanel(band, f, -s * half, 0.1, 0.32);
            const b = onPanel(band, f, s * half, INLET_H + 0.5, 0.32);
            parts.push({ ...beam(a, b, 0.45, shade(concrete, 0.82)), piece });
          }
        } else if (band.index === BANDS.length - 1) {
          // A slightly darker, soot-stained lip at the rim.
          parts.push({
            shape: 'box',
            piece,
            at: onPanel(band, f, 0, band.slant - 0.45, 0.025),
            size: [widthAt(band, band.slant - 0.45), 0.9, 0.04],
            rot: euler(f.q),
            color: shade(concrete, 0.72),
            decor: true,
          });
        }
      }
    }
    // The shadowed throat just under the rim, where the steam plume rises (render-only).
    const [rimR, rimY] = PROFILE[PROFILE.length - 1];
    const throat = 2 * (rimR - T) - 0.4;
    parts.push({
      shape: { type: 'cylinder', segments: N },
      at: [0, rimY - 0.6, 0],
      size: [throat, 0.05, throat],
      color: shade(concrete, 0.45),
      decor: true,
      plume: 'steam',
    });
    return [
      {
        part: 'coolingTower',
        stand: 'anchored',
        mass: 120,
        breakSpeed: 45,
        breakMode: 'shatter',
        proxy: 'trunk',
        trunkRadius: 12.6,
        shake: 'offset',
        breakup: { impulseScale: 0.45, spin: 0.25, falloff: 9, floor: 0.2 },
        parts,
      },
    ];
  },
};

export default coolingTower;
