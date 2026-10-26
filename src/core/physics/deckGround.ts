import { sampleGradient, sampleHeight } from '../heightGrid';
import { rectGap, type RectDirection } from '../proxyRect';
import { SIM_TUNING } from '../sim/params';
import type { HeightGrid, ObstacleProxy, ProxyRect, RiverBank, Terrain, Vec3 } from '../types';

/**
 * The road bridges the iceberg rides across (playtest 2: "try passing on the bridge ... it is
 * impossible to cross").
 *
 * The iceberg stands on the terrain: its integrator (src/core/sim/iceberg.ts) follows
 * Terrain.heightAt and the grid's gradient, and it meets bodies only through their proxies, which it
 * passes over (top more than 0.3 m below its base), passes under (bottom above its top) or hits. A
 * road bridge's deck was a body like any other. Over a gorge there is no ground under it, and at
 * the rim, where its top is the very road the iceberg arrives on, the girder end stood square in
 * the iceberg's contact band: a wall at road level. Measured on every road bridge of the game with
 * the real session (lanes on the road and 3 m either side, 6 to 18 m/s): the iceberg stopped dead
 * against the girder end (Riverside Town, Alpine Pass: stuck) or glanced off it into the gorge
 * (Highland Maze, Power Valley: fell), every time.
 *
 * So a bridge now carries the iceberg the way it carries a car: this is the ground the session gives
 * the integrator in place of the terrain. While the iceberg is on a bridge's level (its base no more
 * than DECK_GROUND.levelReach below the running surface) and its edge within DECK_GROUND.engage m
 * of it, that bridge's running
 * surface (its abutments' caps and the decks still on their seats) is stamped into a copy of the
 * height grid, and its decks are passable (the iceberg rides them, like the abutments, instead of
 * colliding with them). Below that level (an iceberg in the gorge or the canal under it, one that
 * slid off the side) the ground is the terrain and the deck a solid body, as before. The iceberg's
 * own physics (gravity, momentum, steering, contacts) is untouched: it simply has ground under it.
 *
 * Grid vertices in a surface's plan carry its height where that is above the ground: with `joint`
 * m of slack along it (over the 1 cm joints between a deck and its neighbours) and half a grid cell
 * across it, so the flat top ends within half a cell either side of the deck's real edge however
 * the grid falls (strictly inside, it lost up to a whole cell on one side: on Alpine Pass, where
 * the grid lies 0.5 m off the deck's centre line, an iceberg 3 m left of it tipped off with its
 * edge still over the deck). The next row out is a SKIRT, `skirt` × a cell below the top: the
 * triangles off each side fall at less than the integrator's wall slope instead of plunging to the
 * gorge floor, because its wall probe (0.7 radius ahead, 34° either side of the heading) read the
 * far wall of the gap rising out of those sagging triangles as a wall across the deck and stopped
 * the iceberg dead 3 m short of the far rim (Power Valley, 3 m right of the centre line, every
 * speed). Past the skirt the iceberg's centre is off the side and it tips into whatever the bridge
 * crosses. A deck falls out of the bridge for good once it leaves its seats (a pier knocked out):
 * the iceberg on it then drops with it.
 *
 * PARAPETS (playtest 2 review: "the iceberg rides through the parapets, with up to 3.2 m of it
 * hanging out over the gorge"). A bridge's barriers are decor (../obstacles/structures/roadBridge.ts),
 * so the iceberg met nothing at the deck's edge. While it is up on a bridge's level and near it, each
 * side of the bridge now has a low wall proxy along the inner face of its barriers (parapetsFor),
 * anchored and unbreakable, which the collision solver treats like any other immovable body: the
 * iceberg slides along it instead of through it, and the deck still carries it. At each end of the
 * bridge the wall flares out over the road (PARAPET.flare, a shallow 7°), like the flared end of a
 * highway guard rail, so an iceberg that arrives off the centre line glances in off the flare
 * instead of meeting the square end of the barrier (at 7° a hull at 20 m/s meets it at ≈ 2.4 m/s,
 * about the chipThreshold of the shock that chips ice). The walls never drag: a hull sliding along
 * one keeps its speed (PARAPET.smooth). A hull steered into a wall carves its own speed away
 * against it (its grip); once it has lost PARAPET.yieldLoss that way the side gives way and the hull
 * rides over the barrier as it did before the walls, so holding the steering into a parapet never
 * grinds the iceberg to a crawl on a bridge (the playtest's "impossible to cross"). A side's wall
 * only switches on while the iceberg is clear of it and inside it (and the iceberg's centre no
 * further out than the deck's edge), switches off again if its centre drifts out past the deck's
 * edge before it meets the wall, and gives way at once to a hull that meets it with its centre
 * already outside the barrier line and still heading out (PARAPET.breakOut): one that arrives
 * already over or beyond a barrier rides as it did before the walls, never caught on a flare and
 * pushed back in. An iceberg with less than PARAPET.minSlack to spare
 * either side between the barriers (Power Valley's grown 90 t berg on the highway bridge: 0.65 m)
 * meets no walls at all: it would only bounce from parapet to parapet, so it rides as before. Under
 * the deck (in the gorge or the canal, more than PARAPET.levelReach below the barriers' base) there
 * are no walls.
 * The same corridor bounds the meltwater the iceberg lays on the deck (bankFor): the water stays
 * between the barriers instead of hanging over them.
 */

/** One barrier (parapet) along a bridge body, as built: its centre line in plan and its base. */
export interface DeckBarrier {
  /** Ends of its centre line in plan (world x, z). */
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  /** Half its width at the base (m): its inner face is this far inside the centre line. */
  readonly half: number;
  /** World height of its base (the running surface under it) at each end. */
  readonly y0: number;
  readonly y1: number;
}

export const PARAPET = {
  /**
   * The flared ends: angle (rad) from the bridge's axis. Lane sweeps over the Riverside viaduct (lane
   * ±4 and ±6 m, 20 m/s): 12° cost 1.5-2.1 points of ice at the sea against no walls, 7° 0.4-1.7.
   */
  flare: (7 * Math.PI) / 180,
  /** The flares reach out to catch an iceberg whose centre is up to this past the deck's edge (m). */
  catchPastEdge: 0,
  /** Thickness (m) of a wall proxy, outward from its face. */
  thick: 1,
  /**
   * Walls only for an iceberg with at least this much room (m) either side between the barriers'
   * inner faces (lane sweeps on Power Valley's highway bridge, 0.65 m to spare: walls standing just
   * clear of a hull that size cost 1.7-2.4 points of ice on lanes ±3 and at an angle).
   */
  minSlack: 1,
  /** Barrier spans along one side closer than this (m) form one wall (the joints between bodies). */
  joint: 0.5,
  /** The walls stand while the iceberg's base is no more than this (m) below the barriers' base. */
  levelReach: 3,
  /** ...and its centre within this (m) of the walls' ends and outer reach. */
  zone: 2,
  /** A hull this close (m) to a side's wall is pressing on it. */
  touch: 0.15,
  /**
   * A side's wall gives way (the hull rides over its barrier as it did before the walls) once the
   * hull pressing on it has lost this much (m/s) of its speed along the bridge since it touched.
   */
  yieldLoss: 1.5,
  /** A side that gave way stands again once the hull is this far (m) back from its wall. */
  rearm: 1,
  /**
   * A hull that meets a side's wall with its centre already outside that side's barrier line (past
   * the barriers' inner face) and still moving out at least this fast (m/s) is arriving outside the
   * barrier: the side gives way at once and it rides as it did before the walls (follow-up review
   * of playtest 2: on the Riverside viaduct 8 m off the axis the flare caught a hull 6 m out moving
   * out at 1.6 m/s, pushed it in, cost it 8 m/s and it dropped off mid-span, where without the walls
   * it crossed). A hull drifting along the line is still turned in: the glen bridge 5 m off the axis
   * meets the flare 4.9 m out at 0.5 m/s and is held on the deck, where without the walls it fell.
   */
  breakOut: 0.6,
  /**
   * Walls that do not slow a hull sliding along them (see updateParapets): no contact friction, and
   * while it presses on one, its friction gives back what the hull's own carving costs it (up to the
   * speed along the bridge it came near with).
   */
  smooth: true,
} as const;

/** One body of a bridge's running surface (a road deck or an abutment's cap). */
export interface DeckSurface {
  /** Horizontal distance (m) from (x, z) to its plan footprint (≤ 0 inside). */
  distance(x: number, z: number): number;
  /** Height of its running surface over (x, z) (the plane of its top, extended past its ends). */
  top(x: number, z: number): number;
  /**
   * How far (m) (x, z) lies beyond its sides (≤ 0 between them), or Infinity when it lies past its
   * ends by more than `along` m.
   */
  beyondSides(x: number, z: number, along: number): number;
  /** Still where it was built: an abutment always, a deck while it is on its seats. */
  standing(): boolean;
  /** The iceberg rides it (true) or meets it as a body again (false). */
  ride(on: boolean): void;
  /** Its barriers (parapets), as built: none for a body without any. */
  readonly barriers?: readonly DeckBarrier[];
  /** Its plan's bounding circle (for the grid scan). */
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export const DECK_GROUND = {
  /** A bridge is engaged while the iceberg's edge is within this (m) of its running surface... */
  engage: 2,
  /** ...and its base no more than this (m) below the surface there (above: any height). */
  levelReach: 1,
  /** Slack (m) past a surface's ends: over the joints between a deck and its neighbours. */
  joint: 0.3,
  /** The skirt row's drop below the top: this share of the wall slope, per grid cell. */
  skirt: 0.75,
} as const;

interface Stamp {
  readonly surface: DeckSurface;
  /** Grid vertices it covers and the height it carries each at. */
  readonly verts: Int32Array;
  readonly tops: Float32Array;
  alive: boolean;
}

interface Bridge {
  readonly stamps: Stamp[];
  /** Every vertex any of its surfaces covers. */
  readonly verts: Int32Array;
  engaged: boolean;
  /** Its parapets, or null when its bodies have no barriers. */
  readonly parapets: Parapets | null;
}

/** One barrier along one side, in its bridge's frame, with the surface it stands on. */
interface BarrierSpan {
  readonly u0: number;
  readonly u1: number;
  /** -1 or +1: the side of the axis it stands on. */
  readonly side: number;
  readonly stamp: Stamp;
}

/**
 * A bridge's parapets in its own frame: u along its axis (ux, uz) from (cx, cz), v across it along
 * (-uz, ux).
 */
interface Parapets {
  readonly cx: number;
  readonly cz: number;
  readonly ux: number;
  readonly uz: number;
  /** Half-width (m) between the barriers' inner faces, and to their outer faces (the deck's edge). */
  readonly inner: number;
  readonly edge: number;
  /** Lowest and highest base of its barriers (m). */
  readonly yMin: number;
  readonly yMax: number;
  readonly spans: readonly BarrierSpan[];
  /** Its ends along u, as built (the flares stand there). */
  readonly uMin: number;
  readonly uMax: number;
  /** Each side's wall is up (index 0: side -1, 1: side +1). */
  readonly on: [boolean, boolean];
  /** The walls as wall proxies (pooled), per side. */
  readonly walls: [ObstacleProxy[], ObstacleProxy[]];
  /** How many of each side's pooled walls are current. */
  readonly count: [number, number];
  /** Its proxies' ids start below this (negative, see parapetsFor). */
  readonly idBase: number;
  /** The iceberg's speed along the axis as it came near (0 while away; updateParapets). */
  carry: number;
  /** Per side: its top speed along the axis while pressing on that wall (NaN: not pressing). */
  readonly press: [number, number];
  /** Per side: the wall gave way to a hull that kept shoving into it (PARAPET.yieldLoss). */
  readonly yielded: [boolean, boolean];
}

/** A wall of a side: a rectangle in the bridge frame (centre, unit axis, half extents). */
interface WallShape {
  cu: number;
  cv: number;
  du: number;
  dv: number;
  hu: number;
  hv: number;
}

export class DeckGround {
  /** The terrain with the engaged bridges stamped in (handed out while any is engaged). */
  private readonly view: Terrain;
  private readonly grid: HeightGrid;
  private readonly bridges: Bridge[];
  /** parapetsFor's result (reused). */
  private readonly wallOut: ObstacleProxy[] = [];

  /** `bridges`: the running surface of each bridge the iceberg may ride, body by body. */
  constructor(
    private readonly terrain: Terrain,
    bridges: readonly (readonly DeckSurface[])[],
  ) {
    const g = terrain.grid;
    this.grid = { ...g, heights: new Float32Array(g.heights) };
    this.bridges = bridges.map((surfaces, i) => {
      const stamps = surfaces.map((s) => this.stampOf(s));
      const all = new Set<number>();
      for (const st of stamps) for (const v of st.verts) all.add(v);
      return { stamps, verts: Int32Array.from(all), engaged: false, parapets: parapetsOf(stamps, i) };
    });
    const grid = this.grid;
    const view: Terrain = {
      level: terrain.level,
      grid,
      course: terrain.course,
      heightAt: (x: number, z: number): number => sampleHeight(grid, x, z),
      gradientAt: (x: number, z: number): { dx: number; dz: number } => sampleGradient(grid, x, z),
      normalAt(x: number, z: number): Vec3 {
        const d = sampleGradient(grid, x, z);
        const n = Math.hypot(d.dx, 1, d.dz);
        return { x: -d.dx / n, y: 1 / n, z: -d.dz / n };
      },
      surfaceAt: (x, z) => terrain.surfaceAt(x, z),
      isOcean: (x, z) => terrain.isOcean(x, z),
    };
    if (terrain.kickers) Object.assign(view, { kickers: terrain.kickers });
    if (terrain.ravineDepthAt) Object.assign(view, { ravineDepthAt: terrain.ravineDepthAt });
    if (terrain.bridgeCutAt) Object.assign(view, { bridgeCutAt: terrain.bridgeCutAt });
    this.view = view;
  }

  /**
   * The ground for an iceberg at (x, y, z) (its base) of radius `radius` this step: the terrain, or
   * the view with the bridges it is on stamped in. Also drops decks that have left their seats.
   */
  groundFor(x: number, y: number, z: number, radius: number): Terrain {
    const R = DECK_GROUND;
    let engaged = 0;
    for (const b of this.bridges) {
      let fell = false;
      for (const st of b.stamps) {
        if (st.alive && !st.surface.standing()) {
          st.alive = false;
          st.surface.ride(false);
          fell = true;
        }
      }
      // The nearest standing surface: is the iceberg on its level, and close?
      let best = Infinity;
      let near: DeckSurface | null = null;
      for (const st of b.stamps) {
        if (!st.alive) continue;
        const d = st.surface.distance(x, z);
        if (d < best) {
          best = d;
          near = st.surface;
        }
      }
      const on = near !== null && best <= radius + R.engage && y >= near.top(x, z) - R.levelReach;
      if (on !== b.engaged || (on && fell)) {
        b.engaged = on;
        this.restamp(b);
        for (const st of b.stamps) if (st.alive) st.surface.ride(on);
      }
      if (on) engaged++;
    }
    return engaged > 0 ? this.view : this.terrain;
  }

  /**
   * The parapet walls an iceberg at (x, y, z) (its base) of `radius` meets this step (PARAPETS in
   * the header): anchored, unbreakable wall proxies with negative ids (isParapetId), in a list
   * reused from call to call. Call once per step, with the iceberg: a side's wall switches on and
   * off with where the iceberg is.
   */
  parapetsFor(
    x: number,
    y: number,
    z: number,
    radius: number,
    vx = 0,
    vz = 0,
  ): readonly ObstacleProxy[] {
    const out = this.wallOut;
    out.length = 0;
    for (const b of this.bridges) {
      const p = b.parapets;
      if (!p) continue;
      updateParapets(p, x, y, z, radius, vx, vz);
      for (let si = 0; si < 2; si++) {
        if (!p.on[si]) continue;
        const walls = p.walls[si];
        for (let k = 0; k < p.count[si]; k++) out.push(walls[k]);
      }
    }
    return out;
  }

  /**
   * The corridor between the barriers of the bridge an iceberg at (x, y, z) (its base) is riding,
   * for the meltwater it lays there, or null off the bridges. On a side the iceberg's centre is
   * outside of (it rode over that barrier) the water ends at the deck's edge instead, or nowhere
   * once its centre is past the edge. The same object comes back while nothing changes.
   */
  bankFor(x: number, y: number, z: number): RiverBank | null {
    for (const b of this.bridges) {
      const p = b.parapets;
      if (!p || !b.engaged) continue;
      const dx = x - p.cx;
      const dz = z - p.cz;
      const u = dx * p.ux + dz * p.uz;
      const v = dz * p.ux - dx * p.uz;
      if (u < p.uMin || u > p.uMax || y < p.yMin - 1 || y > p.yMax + 3) continue;
      const lo = -bankLimit(p, -v);
      const hi = bankLimit(p, v);
      const last = this.banks.get(p);
      if (last && last.lo === lo && last.hi === hi) return last;
      const bank: RiverBank = { x: p.cx, z: p.cz, nx: -p.uz, nz: p.ux, lo, hi };
      this.banks.set(p, bank);
      return bank;
    }
    return null;
  }

  /** The last bank handed out per bridge (bankFor). */
  private readonly banks = new Map<Parapets, RiverBank>();

  /** The bridge's vertices back to the ground, then (engaged) its standing surfaces on top. */
  private restamp(b: Bridge): void {
    const h = this.grid.heights;
    const g = this.terrain.grid.heights;
    for (const v of b.verts) h[v] = g[v];
    if (!b.engaged) return;
    for (const st of b.stamps) {
      if (!st.alive) continue;
      for (let i = 0; i < st.verts.length; i++) {
        const v = st.verts[i];
        if (st.tops[i] > h[v]) h[v] = st.tops[i];
      }
    }
  }

  /** The grid vertices a surface covers (as built) and its height over each. */
  private stampOf(s: DeckSurface): Stamp {
    const g = this.terrain.grid;
    const c = g.cellSize;
    const r = s.radius + 2 * c;
    const skirt = DECK_GROUND.skirt * SIM_TUNING.wallSlope * c;
    const i0 = Math.max(0, Math.floor((s.x - r - g.originX) / c));
    const i1 = Math.min(g.cols - 1, Math.ceil((s.x + r - g.originX) / c));
    const j0 = Math.max(0, Math.floor((s.z - r - g.originZ) / c));
    const j1 = Math.min(g.rows - 1, Math.ceil((s.z + r - g.originZ) / c));
    const verts: number[] = [];
    const tops: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const vz = g.originZ + j * c;
      for (let i = i0; i <= i1; i++) {
        const vx = g.originX + i * c;
        const e = s.beyondSides(vx, vz, DECK_GROUND.joint);
        if (!(e <= 1.5 * c)) continue;
        const v = j * g.cols + i;
        const top = e <= c / 2 ? s.top(vx, vz) : s.top(vx, vz) - skirt;
        if (!(top > g.heights[v])) continue;
        verts.push(v);
        tops.push(top);
      }
    }
    return { surface: s, verts: Int32Array.from(verts), tops: Float32Array.from(tops), alive: s.standing() };
  }
}

/** Parapet wall proxies have ids at or below this (body ids are never negative). */
export const PARAPET_ID_TOP = -1;

/** True for the id of a parapet wall proxy (DeckGround.parapetsFor). */
export const isParapetId = (id: number): boolean => id <= PARAPET_ID_TOP;

/** Ids per bridge side: far more walls than a side with every deck down has. */
const IDS_PER_SIDE = 16;

/** A bridge's parapets from its surfaces' barriers, or null when they have none on both sides. */
function parapetsOf(stamps: readonly Stamp[], index: number): Parapets | null {
  const all: { b: DeckBarrier; stamp: Stamp }[] = [];
  for (const st of stamps) for (const b of st.surface.barriers ?? []) all.push({ b, stamp: st });
  if (all.length === 0) return null;
  const f = all[0].b;
  const l = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
  if (!(l > 1e-6)) return null;
  const ux = (f.x1 - f.x0) / l;
  const uz = (f.z1 - f.z0) / l;
  // The axis runs midway between the two sides' barrier lines.
  const ox = (f.x0 + f.x1) / 2;
  const oz = (f.z0 + f.z1) / 2;
  let vLo = Infinity;
  let vHi = -Infinity;
  for (const { b } of all) {
    const v = ((b.z0 + b.z1) / 2 - oz) * ux - ((b.x0 + b.x1) / 2 - ox) * uz;
    vLo = Math.min(vLo, v);
    vHi = Math.max(vHi, v);
  }
  const mid = (vLo + vHi) / 2;
  const cx = ox - mid * uz;
  const cz = oz + mid * ux;
  let inner = Infinity;
  let edge = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  let uMin = Infinity;
  let uMax = -Infinity;
  const spans: BarrierSpan[] = [];
  for (const { b, stamp } of all) {
    const v = ((b.z0 + b.z1) / 2 - cz) * ux - ((b.x0 + b.x1) / 2 - cx) * uz;
    const a = (b.x0 - cx) * ux + (b.z0 - cz) * uz;
    const c = (b.x1 - cx) * ux + (b.z1 - cz) * uz;
    const u0 = Math.min(a, c);
    const u1 = Math.max(a, c);
    inner = Math.min(inner, Math.abs(v) - b.half);
    edge = Math.max(edge, Math.abs(v) + b.half);
    yMin = Math.min(yMin, b.y0, b.y1);
    yMax = Math.max(yMax, b.y0, b.y1);
    uMin = Math.min(uMin, u0);
    uMax = Math.max(uMax, u1);
    spans.push({ u0, u1, side: v < 0 ? -1 : 1, stamp });
  }
  // Barriers on one side only, or on the axis, are no pair of parapets.
  if (!(inner > 0.5) || !spans.some((s) => s.side < 0) || !spans.some((s) => s.side > 0)) return null;
  spans.sort((p, q) => p.u0 - q.u0);
  return {
    cx,
    cz,
    ux,
    uz,
    inner,
    edge,
    yMin,
    yMax,
    spans,
    uMin,
    uMax,
    on: [false, false],
    walls: [[], []],
    count: [0, 0],
    idBase: PARAPET_ID_TOP - index * 2 * IDS_PER_SIDE,
    carry: 0,
    press: [NaN, NaN],
    yielded: [false, false],
  };
}

const _shapes: WallShape[] = [];
/** Where the last sideShapes side's walls start and end along the axis (its flares stand there). */
const _ends = { first: Infinity, last: -Infinity };
const _rect: ProxyRect = { ux: 1, uz: 0, hu: 0, hv: 0 };
const _dir: RectDirection = { nu: 0, nv: 0 };

/** Signed distance (m) from (u, v) to a wall shape (negative inside), in the bridge frame. */
function shapeGap(w: WallShape, u: number, v: number): number {
  const du = u - w.cu;
  const dv = v - w.cv;
  _rect.hu = w.hu;
  _rect.hv = w.hv;
  return rectGap(du * w.du + dv * w.dv, dv * w.du - du * w.dv, _rect, _dir);
}

/**
 * The walls of one side (+1 or -1) as shapes in the bridge frame, into _shapes (returns how many):
 * a straight wall along each run of standing barriers, its face `w` m out from the axis, and a
 * flare `len` m long at each end of the bridge.
 */
function sideShapes(p: Parapets, side: number, w: number, len: number): number {
  const P = PARAPET;
  const t = P.thick;
  const cos = Math.cos(P.flare);
  const sin = Math.sin(P.flare);
  let n = 0;
  const shape = (): WallShape => {
    if (n === _shapes.length) _shapes.push({ cu: 0, cv: 0, du: 1, dv: 0, hu: 0, hv: 0 });
    return _shapes[n++];
  };
  let a = Infinity;
  let b = -Infinity;
  let first = Infinity;
  let last = -Infinity;
  const flush = (): void => {
    if (!(b > a)) return;
    const s = shape();
    s.cu = (a + b) / 2;
    s.cv = side * (w + t / 2);
    s.du = 1;
    s.dv = 0;
    s.hu = (b - a) / 2;
    s.hv = t / 2;
    first = Math.min(first, a);
    last = Math.max(last, b);
  };
  for (const sp of p.spans) {
    if (sp.side !== side || !sp.stamp.alive) continue;
    if (sp.u0 > b + P.joint) {
      flush();
      a = sp.u0;
      b = sp.u1;
    } else {
      a = Math.min(a, sp.u0);
      b = Math.max(b, sp.u1);
    }
  }
  flush();
  _ends.first = first;
  _ends.last = last;
  if (!(last > first)) return n;
  // The flares, where the side's walls end (the abutments' backs: they never fall). On a skewed
  // bridge each side ends at its own place along the axis: a side without its flare met an iceberg
  // arriving off the centre line with the square end of its barrier (playtest 2 lane sweeps, the
  // glen bridge's 37° skew: 4.3 m/s knocks and 6 m/s lost).
  for (const end of [-1, 1]) {
    const at = end < 0 ? first : last;
    // Along the flare, from the barrier's end outwards: its face starts at (at, side·w).
    const du = end * cos;
    const dv = side * sin;
    // Away from the corridor, square to the flare.
    let mu = -dv;
    let mv = du;
    if (mv * side < 0) {
      mu = -mu;
      mv = -mv;
    }
    const s = shape();
    s.cu = at + (du * len) / 2 + (mu * t) / 2;
    s.cv = side * w + (dv * len) / 2 + (mv * t) / 2;
    s.du = du;
    s.dv = dv;
    s.hu = len / 2;
    s.hv = t / 2;
  }
  return n;
}

/**
 * How far out (m) the wall face of the side sideShapes laid out last stands at u: w along its walls,
 * flaring out past their ends.
 */
function wallLine(u: number, w: number, reach: number): number {
  const tan = Math.tan(PARAPET.flare);
  if (u < _ends.first) return w + Math.min(reach, (_ends.first - u) * tan);
  if (u > _ends.last) return w + Math.min(reach, (u - _ends.last) * tan);
  return w;
}

/** Bring a bridge's walls up to date for an iceberg at (x, y, z) (its base) of radius r. */
function updateParapets(
  p: Parapets,
  x: number,
  y: number,
  z: number,
  r: number,
  vx: number,
  vz: number,
): void {
  const P = PARAPET;
  const dx = x - p.cx;
  const dz = z - p.cz;
  const u = dx * p.ux + dz * p.uz;
  const v = dz * p.ux - dx * p.uz;
  const w = p.inner;
  const cos = Math.cos(P.flare);
  // The flares reach out far enough that an iceberg whose centre is at the deck's edge meets their
  // face, not their end.
  const catchAt = p.edge + P.catchPastEdge;
  const reach = Math.max(1, catchAt + r * cos - w);
  const len = reach / Math.sin(P.flare);
  const along = len * cos;
  const near =
    y >= p.yMin - P.levelReach &&
    u >= p.uMin - along - r - P.zone &&
    u <= p.uMax + along + r + P.zone &&
    Math.abs(v) <= w + reach + r + P.zone;
  if (!near || p.inner - r < P.minSlack) {
    p.on[0] = p.on[1] = false;
    p.count[0] = p.count[1] = 0;
    p.carry = 0;
    p.press[0] = p.press[1] = NaN;
    p.yielded[0] = p.yielded[1] = false;
    return;
  }
  // The speed along the bridge it came near with (see the walls' own speed below).
  const vu = vx * p.ux + vz * p.uz;
  if (p.carry === 0) p.carry = Math.abs(vu);
  const boost = PARAPET.smooth ? Math.max(0, p.carry - Math.abs(vu)) * Math.sign(vu) : 0;
  const refX = vx + boost * p.ux;
  const refZ = vz + boost * p.uz;
  // Its speed across the bridge, toward side +1.
  const vv = vz * p.ux - vx * p.uz;
  for (let si = 0; si < 2; si++) {
    const side = si === 0 ? -1 : 1;
    const n = sideShapes(p, side, w, len);
    const line = wallLine(u, w, reach);
    const out = v * side;
    let gap = Infinity;
    for (let k = 0; k < n; k++) gap = Math.min(gap, shapeGap(_shapes[k], u, v));
    if (p.yielded[si] && gap >= r + P.rearm) p.yielded[si] = false;
    if (p.on[si]) {
      const sp = Math.abs(vu);
      if (out > line) {
        // Through it after all (a hit harder than one step's overlap): it rides on as before.
        p.on[si] = false;
      } else if (!(gap <= r + P.touch)) {
        p.press[si] = NaN;
        // Drifted out past the deck's edge before meeting the wall: it rides as before the walls.
        if (out > catchAt) p.on[si] = false;
      } else if (out > catchAt || (out > w && vv * side > P.breakOut)) {
        // Meeting it with its centre outside the barrier line and still heading out (PARAPET.breakOut):
        // it arrives outside the barrier, so the side gives way at once instead of the flare pushing
        // it back in. Only at a flare: along a straight wall the centre stays inside the barrier line.
        p.on[si] = false;
        p.yielded[si] = true;
      } else if (!(sp < p.press[si])) {
        p.press[si] = sp;
      } else if (sp < p.press[si] - P.yieldLoss) {
        // Steered into it, the hull carves its speed away against it (its grip): rather than grind
        // to a crawl along the parapet, it rides over the barrier as it did before the walls.
        p.on[si] = false;
        p.yielded[si] = true;
      }
    } else if (!p.yielded[si] && out < line && out <= catchAt) {
      // Clear of every wall of the side.
      p.on[si] = gap >= r;
      p.press[si] = NaN;
    }
    p.count[si] = 0;
    if (!p.on[si]) continue;
    const walls = p.walls[si];
    for (let k = 0; k < n; k++) {
      const s = _shapes[k];
      if (k === walls.length) walls.push(wallProxy(p.idBase - si * IDS_PER_SIDE - k));
      const o = walls[k];
      o.x = p.cx + s.cu * p.ux - s.cv * p.uz;
      o.z = p.cz + s.cu * p.uz + s.cv * p.ux;
      o.y = (p.yMin + p.yMax) / 2;
      o.top = p.yMax + 1;
      o.bottom = p.yMin - P.levelReach;
      o.radius = Math.hypot(s.hu, s.hv);
      const rect = o.rect as ProxyRect;
      rect.ux = s.du * p.ux - s.dv * p.uz;
      rect.uz = s.du * p.uz + s.dv * p.ux;
      rect.hu = s.hu;
      rect.hv = s.hv;
      // Smooth concrete: the wall moves along itself at the iceberg's own speed, so a hull sliding
      // along it is turned, not dragged to a stop by the solver's contact friction. Steered into it,
      // the hull's grip bleeds its speed away step after step (it carves into the wall): the wall
      // then moves at the speed along the bridge the iceberg came near with, so the contact's
      // friction gives back what the carving took, never more than it arrived with.
      const slide = PARAPET.smooth ? refX * rect.ux + refZ * rect.uz : 0;
      o.vx = slide * rect.ux;
      o.vz = slide * rect.uz;
    }
    p.count[si] = n;
  }
}

function wallProxy(id: number): ObstacleProxy {
  return {
    id,
    kind: 'roadBridge',
    part: 'parapet',
    x: 0,
    y: 0,
    z: 0,
    radius: 0,
    top: 0,
    bottom: 0,
    mass: Infinity,
    vx: 0,
    vy: 0,
    vz: 0,
    anchored: true,
    breakImpulse: Infinity,
    state: 'intact',
    rect: { ux: 1, uz: 0, hu: 0, hv: 0 },
  };
}

/** How far out (m) the water may spread on a side the iceberg's centre is `v` m out on. */
function bankLimit(p: Parapets, v: number): number {
  if (v <= p.inner - 0.2) return p.inner;
  if (v <= p.edge - 0.2) return p.edge;
  return Infinity;
}
