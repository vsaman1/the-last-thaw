import { bridgePlan, placementFrame, type BridgePlan } from '../obstacles/bridges';
import { DECK_RULES, deckTopAt } from '../obstacles/structures/deck';
import { sampleHeight } from '../heightGrid';
import type { Terrain, TerrainFeature } from '../types';
import { featureContains } from './features';

/**
 * Bridge approach cuttings: the ground under a road bridge's road is graded to it, as an engineer
 * would grade it.
 * - Between the abutments' back faces (the running surface plus the `back` metres each abutment
 *   carries it on under the approach), the bank is CUT down to the road where it stands higher.
 *   Without this a bank that bulges above the straight deck line (a rounded rim, a cross slope, a
 *   knoll by the gorge) pokes up through the asphalt.
 * - Behind each back face the approach is MADE UP to the abutment (cut or filled): to the deck
 *   line less 4 cm (DECK_RULES.lift in world metres) for a grid cell either side of the face, so
 *   the road steps onto the abutment by those 4 cm all across the carriageway, then blended back
 *   into the ground over BRIDGE_CUT.approach metres. Without this the abutment's top, which
 *   carries the deck's grade, stood proud of the approach street at one end of Riverside Town's
 *   viaduct and under it at the other (a kerb across the carriageway either way).
 * The footprint is the deck's width plus the wing walls and one grid cell more (every triangle that
 * reaches under the road; a cell-wide slope joins the ground beside it). Every grid vertex in it is
 * set to its target: the triangulated surface then lies under the road everywhere over the deck and
 * wing walls (a triangle whose corners all lie under a plane lies under it), except where a vertex
 * is left alone or moved only maxDepth (below).
 *
 * Every bridge is planned ONCE, on the ground as the level made it (createTerrain runs this before
 * anything reads the heights), and the terrain is graded in a single pass against those plans. How
 * far each vertex moved is kept in a field of its own (Terrain.bridgeCutAt, the grid's layout and
 * triangulation; positive down), which the deck planner adds back (StructureContext.ungradedAt /
 * uncutAt): every plan made afterwards, by the builds, the logic check or the traffic network, is
 * exactly the plan the grading was made against (tested on every level). It is not the ravine cut
 * field (Terrain.ravineDepthAt): that one makes ground fatal and steers the route search.
 *
 * What is never graded:
 * - take-off features, the crestable ('mound') ridges and the ramps (kickers), with a cell of
 *   margin: their crest is the jump the level was balanced on, and a deck line running under a
 *   crest would notch it out (82b4508 shaved up to 3 m off Ravine Run's lips that way);
 * - footbridges: a path meets the bank as a trail does, its stone sill bedded in the ground, and a
 *   cutting a cell wider than the deck either side would be a trench out of all proportion to a
 *   2.2 m walkway; the rim-to-rim footbridges of the game (Ravine Run's rope bridges) all stand on
 *   designed take-off lips;
 * - more than BRIDGE_CUT.maxDepth (× the bridge's scale), down or up: a road cut into a hillside
 *   beside a bridge end is real engineering (Alpine Pass needs 4.8 m at a rock wall beside its x0
 *   end, off every route), but a bank standing further above the deck line than that is not a bank
 *   by the bridge; the bridge (or its span) is in the wrong place, which is the level's to fix, and
 *   such a vertex moves maxDepth only, so the bank shows.
 * Measured on the shipped levels (bridgeCuts.test.ts bounds each, a little above): most lowered /
 * raised, Alpine Pass 4.84 / 0.31 m (7 of its 97 graded vertices are cut 2.0-4.84 m: the rock wall
 * by the deck's edge at the x0 end, s 529-539; the others under 0.9 m), Riverside Town 0.66 / 0.43,
 * Power Valley 0.73 / 0.21, Highland Maze 0.39 / 0.41; Ravine Run (footbridges only) and every
 * level without a road bridge are not graded at all. Every deck plan is identical with and without
 * the grading, on every level (the same test).
 */

export const BRIDGE_CUT = {
  /** Wing walls: how far a footprint reaches beyond half the deck width (nominal m). */
  wing: 0.4,
  /** Furthest a vertex is moved, down or up (nominal m, × the bridge's scale). */
  maxDepth: 5,
  /** The made-up approach blends back into the ground over this (nominal m, × the scale). */
  approach: 8,
} as const;

/** What the grading did to a terrain (cutBridgeApproaches). */
export interface BridgeCuts {
  /** Per grid vertex (the heights' layout): how far it was lowered (m; negative: raised). */
  readonly field: Float32Array;
  /** Vertices moved. */
  readonly moved: number;
  /** The most any vertex was lowered, and raised (m). */
  readonly deepest: number;
  readonly highest: number;
  /** The lowering at world (x, z), triangulated like the heights (Terrain.bridgeCutAt). */
  at(x: number, z: number): number;
}

/** Features whose crest launches the iceberg: never graded. */
const takesOff = (f: TerrainFeature): boolean =>
  f.type === 'ramp' || (f.type === 'ridge' && f.profile === 'mound');

/** A vertex's grading target: its height, and whether it may be raised to it (else only cut). */
interface Target {
  t: number;
  fill: boolean;
}

/**
 * Plan every bridge on `terrain` (as the level made it: nothing may have graded it yet) and grade
 * the ground under each road bridge that reaches the ground, in place. Returns what was done, or
 * null when nothing moved.
 */
export function cutBridgeApproaches(terrain: Terrain): BridgeCuts | null {
  if (terrain.bridgeCutAt) throw new Error('cutBridgeApproaches: the terrain is already graded');
  const g = terrain.grid;
  // Plans first, all of them, on the ungraded ground; the grading never re-plans.
  const plans: BridgePlan[] = [];
  terrain.level.obstacles.forEach((p, i) => {
    const b = bridgePlan(terrain, p, i);
    if (b && b.kind === 'roadBridge' && b.mode !== 'floating') plans.push(b);
  });
  if (plans.length === 0) return null;
  const targets = new Map<number, Target>();
  for (const b of plans) footprintTargets(terrain, b, targets);
  const takeOff = (terrain.level.features ?? []).filter(takesOff);
  const field = new Float32Array(g.heights.length);
  let moved = 0;
  let deepest = 0;
  let highest = 0;
  for (const [k, { t, fill }] of targets) {
    const h = g.heights[k];
    if (!(h > t + 1e-4) && !(fill && h < t - 1e-4)) continue;
    if (takeOff.length > 0 && onTakeOff(terrain, takeOff, k)) continue;
    g.heights[k] = t;
    // Both Float32 and close together, so the difference is exact: heights + field is the ground
    // as it was.
    field[k] = h - g.heights[k];
    moved++;
    deepest = Math.max(deepest, field[k]);
    highest = Math.max(highest, -field[k]);
  }
  if (moved === 0) return null;
  const grid = { ...g, heights: field };
  return { field, moved, deepest, highest, at: (x, z) => sampleHeight(grid, x, z) };
}

/** Whether grid vertex k lies on a take-off feature (or within one cell of it). */
function onTakeOff(terrain: Terrain, features: readonly TerrainFeature[], k: number): boolean {
  const g = terrain.grid;
  const x = g.originX + (k % g.cols) * g.cellSize;
  const z = g.originZ + Math.floor(k / g.cols) * g.cellSize;
  const c = terrain.course.project(x, z);
  const hw = terrain.course.sampleAt(Math.min(Math.max(c.s, 0), terrain.course.length)).halfWidth;
  return features.some((f) => featureContains(f, c.s, c.d, hw, g.cellSize));
}

/**
 * The target of every grid vertex in one bridge's footprint, merged into `out` (the lowest wins):
 * see the module comment. Never more than maxDepth from where it stands.
 */
function footprintTargets(terrain: Terrain, b: BridgePlan, out: Map<number, Target>): void {
  const g = terrain.grid;
  const f = placementFrame(terrain, terrain.level.obstacles[b.index], b.index);
  if (!f) return;
  // Local (nominal m) ↔ world: origin and axes from the frame's own transform.
  const ox = f.worldX(0, 0);
  const oz = f.worldZ(0, 0);
  const ax = f.worldX(1, 0) - ox;
  const az = f.worldZ(1, 0) - oz;
  const bx = f.worldX(0, 1) - ox;
  const bz = f.worldZ(0, 1) - oz;
  const det = ax * bz - az * bx;
  if (!(Math.abs(det) > 1e-9)) return;
  const toLocal = (x: number, z: number): [number, number] => {
    const dx = x - ox;
    const dz = z - oz;
    return [(dx * bz - dz * bx) / det, (ax * dz - az * dx) / det];
  };
  const plan = b.plan;
  const cell = g.cellSize / b.scale;
  /** The deck and its wing walls, a cell beyond them (the triangles that reach under the road). */
  const half = b.spec.width / 2 + BRIDGE_CUT.wing + cell;
  const reach = BRIDGE_CUT.maxDepth * b.scale;
  // The abutments' back faces, and how far behind them the approach is made up.
  const back0 = plan.x0 - b.spec.back;
  const back1 = plan.x1 + b.spec.back;
  const blend = BRIDGE_CUT.approach;
  const lx0 = back0 - cell - blend;
  const lx1 = back1 + cell + blend;
  /** The running surface at local x (world; the deck line, carried on past its ends). */
  const top = (lx: number): number => f.originY + deckTopAt(plan, lx) * b.scale;
  /** Cut to: the lift below it (the end tops sit that far above the ground there). */
  const line = (lx: number): number => top(lx) - DECK_RULES.lift * b.scale;
  /** Made up to: the lift below the abutment's top in world metres, at any scale. */
  const made = (lx: number): number => top(lx) - DECK_RULES.lift;
  // World box of the footprint, then every vertex in it tested in the local frame.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const lx of [lx0, lx1]) {
    for (const lz of [-half, half]) {
      const x = f.worldX(lx, lz);
      const z = f.worldZ(lx, lz);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  const i0 = Math.max(0, Math.floor((minX - g.originX) / g.cellSize));
  const i1 = Math.min(g.cols - 1, Math.ceil((maxX - g.originX) / g.cellSize));
  const k0 = Math.max(0, Math.floor((minZ - g.originZ) / g.cellSize));
  const k1 = Math.min(g.rows - 1, Math.ceil((maxZ - g.originZ) / g.cellSize));
  for (let iz = k0; iz <= k1; iz++) {
    for (let ix = i0; ix <= i1; ix++) {
      const [lx, lz] = toLocal(g.originX + ix * g.cellSize, g.originZ + iz * g.cellSize);
      if (lx < lx0 || lx > lx1 || Math.abs(lz) > half) continue;
      const k = iz * g.cols + ix;
      const h = g.heights[k];
      // How far behind the nearer back face (negative: in front of it, under the abutment / deck).
      const behind = Math.max(back0 - lx, lx - back1);
      let target: Target;
      if (behind <= -cell) {
        target = { t: line(lx), fill: false };
      } else if (behind <= cell) {
        // A cell either side of the back face: on the deck line, cut or filled.
        target = { t: made(lx), fill: true };
      } else {
        // Then from the deck line, carried on, back into the ground.
        const w = (behind - cell) / blend;
        if (w >= 1) continue;
        target = { t: made(lx) + (h - made(lx)) * w, fill: true };
      }
      target.t = Math.min(h + reach, Math.max(h - reach, target.t));
      const was = out.get(k);
      if (!was || target.t < was.t) out.set(k, target);
    }
  }
}
