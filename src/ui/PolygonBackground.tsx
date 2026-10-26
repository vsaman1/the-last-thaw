/**
 * Menu backdrop: a low-poly facet mesh plus overlapping translucent shards and cyan glints.
 * Geometry is generated once from a fixed seed. Each layer is its own <svg> animated only with
 * CSS transform/opacity, so the compositor moves it without repainting (cheap at any size).
 */
import { memo } from 'react';
import { createRng } from '../core/rng';
import { parseHex, toHex } from './contrast';

const W = 1600;
const H = 900;
const SEED = 20251016;

/** Dark (top-left, behind the text column) → ocean blues → electric blue (bottom-right). */
const RAMP = ['#030F26', '#061A3A', '#09245A', '#0B3A8C', '#1450E6', '#1C8FD6'];

function rampColour(t: number): string {
  const x = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = parseHex(RAMP[i]);
  const b = parseHex(RAMP[i + 1]);
  return toHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

interface Tri {
  points: string;
  fill: string;
  opacity?: number;
}

interface Layers {
  mesh: Tri[];
  glints: Tri[];
  shardsA: Tri[];
  shardsB: Tri[];
  shardsC: Tri[];
}

const pts = (p: number[]): string => {
  let s = '';
  for (let i = 0; i < p.length; i += 2) s += `${i ? ' ' : ''}${p[i].toFixed(1)},${p[i + 1].toFixed(1)}`;
  return s;
};

function buildLayers(seed: number): Layers {
  const rng = createRng(seed);
  const cols = 14;
  const rows = 8;
  const cw = W / cols;
  const ch = H / rows;
  const gx: number[][] = [];
  const gy: number[][] = [];
  for (let r = -1; r <= rows + 1; r++) {
    const rx: number[] = [];
    const ry: number[] = [];
    for (let c = -1; c <= cols + 1; c++) {
      rx.push(c * cw + (rng() - 0.5) * cw * 0.75);
      ry.push(r * ch + (rng() - 0.5) * ch * 0.75);
    }
    gx.push(rx);
    gy.push(ry);
  }

  const mesh: Tri[] = [];
  const glints: Tri[] = [];
  const shade = (cx: number, cy: number): number => {
    const u = cx / W;
    const v = cy / H;
    // Keep the left ~40% (menu text column) dark; brighten toward the bottom-right.
    const textGuard = Math.min(1, Math.max(0, (u - 0.28) / 0.4));
    const base = 0.12 + 0.62 * textGuard * (0.55 + 0.45 * v) + 0.12 * v;
    return base + (rng() - 0.5) * 0.16;
  };
  for (let r = 0; r < rows + 2; r++) {
    for (let c = 0; c < cols + 2; c++) {
      const a = [gx[r][c], gy[r][c]];
      const b = [gx[r][c + 1], gy[r][c + 1]];
      const d = [gx[r + 1][c], gy[r + 1][c]];
      const e = [gx[r + 1][c + 1], gy[r + 1][c + 1]];
      const tris =
        rng() < 0.5
          ? [[...a, ...b, ...e], [...a, ...e, ...d]]
          : [[...a, ...b, ...d], [...b, ...e, ...d]];
      for (const t of tris) {
        const cx = (t[0] + t[2] + t[4]) / 3;
        const cy = (t[1] + t[3] + t[5]) / 3;
        mesh.push({ points: pts(t), fill: rampColour(shade(cx, cy)) });
        if (cx > W * 0.58 && rng() < 0.07) {
          const fill = rng() < 0.5 ? '#5FF3FF' : '#7FFFF4';
          glints.push({ points: pts(t), fill, opacity: 0.18 + rng() * 0.2 });
        }
      }
    }
  }

  const shard = (cx: number, cy: number, r: number, fill: string, opacity: number): Tri => {
    const p: number[] = [];
    const rot = rng() * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      const ang = rot + (k * Math.PI * 2) / 3 + (rng() - 0.5) * 0.9;
      const rr = r * (0.7 + rng() * 0.5);
      p.push(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
    }
    return { points: pts(p), fill, opacity };
  };

  return {
    mesh,
    glints,
    shardsA: [
      shard(1250, 260, 420, '#1C8FD6', 0.22),
      shard(1480, 760, 380, '#1450E6', 0.35),
      shard(980, 860, 300, '#1C8FD6', 0.18),
    ],
    shardsB: [
      shard(1380, 470, 260, '#5FF3FF', 0.13),
      shard(1100, 120, 200, '#7FFFF4', 0.1),
      shard(300, 900, 260, '#1450E6', 0.22),
    ],
    shardsC: [
      shard(1560, 160, 300, '#0B3A8C', 0.5),
      shard(820, 620, 240, '#1450E6', 0.16),
      shard(120, 80, 220, '#0B3A8C', 0.35),
    ],
  };
}

const LAYERS = buildLayers(SEED);

interface LayerProps {
  tris: Tri[];
  className: string;
  /** Stroke each facet in its own fill to hide anti-aliasing seams between neighbours. */
  seamless?: boolean;
}

function Layer({ tris, className, seamless = false }: LayerProps) {
  return (
    <svg
      className={`polybg__layer ${className}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
    >
      {tris.map((t, i) => (
        <polygon
          key={i}
          points={t.points}
          fill={t.fill}
          fillOpacity={t.opacity}
          stroke={seamless ? t.fill : undefined}
          strokeWidth={seamless ? 1.2 : undefined}
        />
      ))}
    </svg>
  );
}

/** Full-viewport decorative backdrop for menu screens. */
export const PolygonBackground = memo(function PolygonBackground() {
  return (
    <div className="polybg" aria-hidden="true">
      <Layer tris={LAYERS.mesh} className="polybg__mesh" seamless />
      <Layer tris={LAYERS.shardsC} className="polybg__shards-c" />
      <Layer tris={LAYERS.shardsA} className="polybg__shards-a" />
      <Layer tris={LAYERS.glints} className="polybg__glints" />
      <Layer tris={LAYERS.shardsB} className="polybg__shards-b" />
      <div className="polybg__vignette" />
    </div>
  );
});
