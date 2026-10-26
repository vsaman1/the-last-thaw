import type { PartDef, StructureContext, StructureDef } from './kit';

/**
 * A roadside stack of ten spruce logs (rows of 4, 3, 2, 1; 4.6-5.2 m long, 0.3-0.5 m thick with
 * the thickest at the bottom, about 1.4 m high), bark in mixed browns with pale end grain. Each
 * log is one break piece; the end-grain discs are decor that go with their log.
 * Mass ≈ 4.5 t (green spruce, 0.75 t/m³, from the logs' volumes). It holds together until a hit
 * of 2 m/s or more (breakImpulse 75 for a 30 t iceberg, below the ice-chipping threshold), then
 * every log is a free body: the stack COLLAPSES, the logs (32-sided, so they roll on slopes from
 * ~0.1) roll downhill across the course, and they float and drift in the river (wood).
 * Why not one 'resting' body per log: the shared kit test requires every body except a 'deck'
 * to touch the ground, which the upper rows cannot. So the stack is one anchored body that
 * shatters into its logs, built exactly as they would rest (1.2 cm apart, so nothing starts
 * interpenetrating) and following the ground under it.
 * Local frame: logs along x (across the valley at yaw 0, so they roll down the course), rows
 * stacked along z. With no yaw given it is turned a little at random.
 */

const ROWS = [4, 3, 2, 1] as const;
const LOG = { type: 'cylinder', segments: 32 } as const;
const END = { type: 'cylinder', segments: 16 } as const;
/** Clearance between neighbouring logs and above the ground (m). */
const GAP = 0.012;
const DENSITY = 0.75;
const BARK = [0x6b4e36, 0x5d4430, 0x7a5a3f, 0x4f3a2a, 0x8a6a4a] as const;
const GRAIN = [0xd9b98c, 0xcfa978, 0xe0c49a] as const;

interface Log {
  z: number;
  y: number;
  r: number;
}

/** Centre (z, y) of a circle of radius r resting on circles a and b (above them), gap apart. */
function restOn(a: Log, b: Log, r: number): Log {
  const ra = a.r + r + GAP;
  const rb = b.r + r + GAP;
  const dz = b.z - a.z;
  const dy = b.y - a.y;
  const d = Math.hypot(dz, dy);
  const along = (ra * ra - rb * rb + d * d) / (2 * d);
  const up = Math.sqrt(Math.max(0, ra * ra - along * along));
  // Of the two intersections take the upper one.
  const z = a.z + (dz * along) / d;
  const y = a.y + (dy * along) / d;
  const n = dz >= 0 ? 1 : -1;
  return { z: z - (n * dy * up) / d, y: y + (n * dz * up) / d, r };
}

function build(ctx: StructureContext): { parts: PartDef[]; mass: number } {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(ctx.rng() * list.length) % list.length];
  // Thick logs at the bottom: the base row varies around the pile's girth, and every upper log is
  // no thicker than the thinner of the two it rests on (so it cannot reach into its row neighbour).
  const girth = 0.19 + 0.03 * ctx.rng();
  const radius = (): number => girth + 0.05 * (ctx.rng() - 0.5);
  // Side tilt of the whole stack where the ground falls across the logs' length.
  const half = 2.5;
  const tilt = Math.atan2(ctx.groundAt(half, 0) - ctx.groundAt(-half, 0), 2 * half);
  // Bottom row: side by side on the ground, centre heights from the ground's slope under each log.
  const radii = Array.from({ length: ROWS[0] }, radius);
  const width = radii.reduce((s, r) => s + 2 * r, 0) + GAP * (ROWS[0] - 1);
  let z = -width / 2;
  let row: Log[] = radii.map((r) => {
    const c = z + r;
    z += 2 * r + GAP;
    const gz = (ctx.groundAt(0, c + r) - ctx.groundAt(0, c - r)) / (2 * r);
    const ends = (ctx.groundAt(-half, c) + ctx.groundAt(half, c)) / 2;
    const y0 = ctx.groundAt(0, c);
    const lift = Math.max(0, ends - y0);
    return { z: c, y: y0 + lift + r * Math.hypot(1, gz, Math.tan(tilt)) + GAP / 2, r };
  });
  const logs: Log[] = [...row];
  for (let k = 1; k < ROWS.length; k++) {
    const next: Log[] = [];
    for (let j = 0; j + 1 < row.length; j++) {
      let r = Math.min(row[j].r, row[j + 1].r) - 0.012 * ctx.rng();
      let log = restOn(row[j], row[j + 1], r);
      // Guard: thin it further if it would still touch its neighbour in the row.
      const left = next[next.length - 1];
      while (left && r > 0.1 && Math.hypot(log.z - left.z, log.y - left.y) < left.r + r + GAP) {
        r -= 0.005;
        log = restOn(row[j], row[j + 1], r);
      }
      next.push(log);
    }
    logs.push(...next);
    row = next;
  }
  const parts: PartDef[] = [];
  let mass = 0;
  const rot = [0, 0, tilt - Math.PI / 2] as const;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  logs.forEach((log, i) => {
    const len = 4.6 + 0.6 * ctx.rng();
    const x = (ctx.rng() - 0.5) * 0.3;
    // Rows were laid out in the section x = 0: keep each axis on that line when shifted along it.
    const y = log.y + x * Math.tan(tilt);
    const piece = `log${i}`;
    mass += Math.PI * log.r * log.r * len * DENSITY;
    parts.push({
      shape: LOG,
      piece,
      name: 'log',
      at: [x, y, log.z],
      size: [2 * log.r, len, 2 * log.r],
      rot,
      color: pick(BARK),
    });
    const grain = pick(GRAIN);
    for (const e of [-1, 1]) {
      const d = e * (len / 2 + 0.008);
      parts.push({
        shape: END,
        piece,
        at: [x + d * c, y + d * s, log.z],
        size: [1.8 * log.r, 0.02, 1.8 * log.r],
        rot,
        color: grain,
        decor: true,
      });
    }
  });
  return { parts, mass };
}

const logPile: StructureDef = {
  kind: 'logPile',
  label: 'Log pile',
  material: 'wood',
  footprint: 3,
  palettes: {},
  breakup: { impulseScale: 0.8, spin: 0.12, falloff: 2, floor: 0.35 },
  defaultYaw: (ctx) => (ctx.rng() - 0.5) * 0.4,
  build(ctx) {
    const { parts, mass } = build(ctx);
    return [
      {
        part: 'logPile',
        stand: 'anchored',
        ground: 'fixed',
        mass,
        breakSpeed: 2,
        breakMode: 'shatter',
        parts,
      },
    ];
  },
};

export default logPile;
