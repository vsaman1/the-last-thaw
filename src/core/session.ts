import { EventBus } from './events';
import { FELL_BEAT, FELL_DEPTH } from './fall';
import { clamp01, len2 } from './math';
import type { GameRuntime } from './runtime';
import { type IntroStage, type IntroTimeline, introStageAt, introTimeline, routeLengthOf } from './intro';
import { createTerrain, isGeneratedTerrain } from './terrain/terrain';
import { DEFAULT_ICEBERG_PARAMS, withLevelIceberg, withWaterBudget } from './sim/params';
import {
  absorbIce,
  canGrow,
  chipAmount,
  collectAbsorbable,
  createIceberg,
  isMelted,
  isStuck,
  proxyGap,
  resolveIcebergContacts,
  setIce,
  stepIceberg,
  type ContactOptions,
  type ProxyDirection,
} from './sim/iceberg';
import { RiverTrail } from './river/trail';
import { meltwaterBornBy, retimeMeltwater, seedMeltwater } from './river/meltwater';
import { getGlacier } from './glacier/glacier';
import { createPhysicsWorld } from './physics/world';
import { hasInlandWater, WaterSystem } from './water/system';
import type {
  ChunkSource,
  FailReason,
  FxEmitter,
  GameEvent,
  GamePhase,
  IcebergContact,
  IcebergParams,
  IcebergState,
  LevelDef,
  ObstacleProxy,
  PhysicsWorldApi,
  RiverTrailApi,
  RoutePoint,
  RunStats,
  SteeringInput,
  Terrain,
} from './types';

export const FIXED_DT = 1 / 60;
/** Frames longer than this (tab switch, debugger) are clamped so physics never explodes. */
const MAX_FRAME_DT = 0.1;
const ROUTE_INTERVAL = 0.25;
/** A landing counts as crossing a waterfall if it dropped at least this far near a cliff. */
const WATERFALL_MIN_DROP = 6;
/**
 * Collision events/stats count impacts, not physics steps in contact: a body already touching the
 * iceberg only counts again after the gap between them exceeds TOUCH_GAP (m), or on a fresh impact
 * closing faster than NEW_IMPACT_SPEED (m/s).
 */
const TOUCH_GAP = 0.5;
const NEW_IMPACT_SPEED = 0.5;
/** A hit that would leave less ice than this (fraction of the starting iceberg) shatters the rest. */
export const SHATTER_BELOW = 0.02;
/** The fatal-ravine rule ('fell'): see ./fall.ts. */
export { FELL_BEAT, FELL_DEPTH };
/** Completion score for a full iceberg at the finish (scaled by ice left). */
export const ICE_SCORE = 600;

const terrainCache = new Map<string, Terrain>();

/** Terrain is immutable per level, so build it once and reuse it across restarts. */
export function getTerrain(level: LevelDef): Terrain {
  let t = terrainCache.get(level.id);
  if (!t) {
    t = createTerrain(level);
    terrainCache.set(level.id, t);
  }
  return t;
}

export interface SessionOptions {
  level: LevelDef;
  /**
   * Iceberg params. The level's water budget still sets the melt rates unless these already carry
   * non-zero meltPerMetre / meltPerRadian; the level's iceberg (LevelDef.iceberg) always scales the
   * radius and sets the mass.
   */
  params?: IcebergParams;
  /** Prebuilt terrain instead of the cached one built from `level` (analytic test terrains). */
  terrain?: Terrain;
  /** Prebuilt physics world (tests, scripted worlds); default: a Rapier world for the terrain. */
  physics?: PhysicsWorldApi;
  /** Start directly in 'playing': no intro at all (tests, scripted runs). */
  skipIntro?: boolean;
  /**
   * The intro when not skipped: 'full' = course flyover + the iceberg calving off the glacier
   * (default), 'short' = only a short calving beat (Settings → Skip intros, Retry/Replay).
   */
  intro?: 'full' | 'short';
  seed?: number;
}

type PhaseListener = (phase: GamePhase, session: GameSession) => void;

/**
 * One attempt at one level. Owns the iceberg, river, physics world and run statistics, and advances
 * them on a fixed 60 Hz step. Pure TypeScript: runs in the browser and headless in tests.
 */
export class GameSession implements GameRuntime {
  readonly level: LevelDef;
  readonly terrain: Terrain;
  readonly iceberg: IcebergState;
  readonly river: RiverTrail;
  /**
   * Streams, reservoirs, dam-break floods and captured rivers (src/core/water); null on levels
   * without 'stream' features (nothing about them changes then).
   */
  readonly water: WaterSystem | null;
  readonly physics: PhysicsWorldApi;
  readonly events = new EventBus();
  readonly params: IcebergParams;
  fx: FxEmitter | null = null;

  time = 0;
  phase: GamePhase = 'intro';
  phaseTime = 0;
  introProgress = 0;
  introTimeline: IntroTimeline;
  progress = 0;
  failReason: FailReason | null = null;
  readonly route: RoutePoint[] = [];
  readonly stats: RunStats;
  /** Last steering input applied (for snapshots / analysis). */
  lastInput: SteeringInput = { steer: 0, source: 'none' };

  private accumulator = 0;
  /** Fixed-step accumulator for the ambient world (road traffic) during the intro. */
  private ambientAccumulator = 0;
  /** Separate from phaseTime so pausing during the intro does not restart it. */
  private introElapsed = 0;
  private playTime = 0;
  private pausedFrom: GamePhase | null = null;
  private routeTimer = 0;
  /** Seconds since the iceberg touched a fatal ravine's floor (−1: it has not). */
  private fellTime = -1;
  private crossedCliffs = new Set<number>();
  /** Obstacle ids currently touching the iceberg (see TOUCH_GAP); a handful at most. */
  private readonly touching: number[] = [];
  private phaseListeners = new Set<PhaseListener>();
  /** Params for steps outside 'playing' (the post-finish drift): the same, minus melting. */
  private readonly driftParams: IcebergParams;
  /** Contact options while playing (glacier ice is absorbed) and after the run (it is just pushed). */
  private readonly playContacts: ContactOptions;
  private readonly driftContacts: ContactOptions;
  /**
   * The ground the iceberg stood on in the last step: the terrain, or the terrain with the road
   * bridge it is on (PhysicsWorldApi.icebergGround).
   */
  private ground: Terrain;
  /** Scratch for the absorbable bodies touched this step: ids and positions (x, y, z triples). */
  private readonly absorbIds: number[] = [];
  private readonly absorbPos: number[] = [];
  /** Scratch for proxyGap. */
  private readonly gapDir: ProxyDirection = { nx: 0, nz: 0 };
  /** What the physics world's water forces read: the trail, plus the inland water when there is any. */
  private readonly waterForces: RiverTrailApi;

  private constructor(level: LevelDef, terrain: Terrain, physics: PhysicsWorldApi, opts: SessionOptions) {
    this.level = level;
    this.terrain = terrain;
    this.physics = physics;
    this.params = withLevelIceberg(
      withWaterBudget(opts.params ?? DEFAULT_ICEBERG_PARAMS, level.water),
      level.iceberg,
    );
    const p = this.params;
    this.driftParams =
      p.meltPerMetre === 0 && p.meltPerRadian === 0 ? p : { ...p, meltPerMetre: 0, meltPerRadian: 0 };
    this.iceberg = createIceberg(terrain, p);
    this.playContacts = { absorbing: physics.absorb !== undefined, terrain };
    this.driftContacts = { absorbing: false, terrain };
    this.ground = terrain;
    this.river = new RiverTrail();
    this.water = hasInlandWater(level) && isGeneratedTerrain(terrain) ? new WaterSystem(terrain) : null;
    this.waterForces = this.water ? this.water.flowAdapter(this.river) : this.river;
    this.stats = {
      levelId: level.id,
      time: 0,
      distance: 0,
      topSpeed: 0,
      knockedDown: 0,
      buildingsDestroyed: 0,
      treesFelled: 0,
      waterfallsCrossed: 0,
      collisions: 0,
      iceLeft: this.iceberg.ice,
      absorbed: 0,
      peakMass: this.iceberg.mass,
      score: 0,
    };
    this.introTimeline = introTimeline(
      opts.skipIntro ? 'none' : (opts.intro ?? 'full'),
      routeLengthOf(opts.level),
    );
    // The river starts in the glacier socket the iceberg calves from: meltwater laid down the slide
    // to the spawn before play (no water budget), revealed behind the iceberg as it calves.
    seedMeltwater(this.river, terrain, this.iceberg, getGlacier(terrain), this.introTimeline, 0);
    this.river.record(this.iceberg, terrain, 0);
    if (opts.skipIntro) {
      this.phase = 'playing';
      this.introProgress = 1;
    }
  }

  static async create(opts: SessionOptions): Promise<GameSession> {
    const terrain = opts.terrain ?? getTerrain(opts.level);
    const seed = opts.seed ?? opts.level.seed;
    const physics = opts.physics ?? (await createPhysicsWorld(terrain, { seed }));
    return new GameSession(opts.level, terrain, physics, opts);
  }

  onPhaseChange(l: PhaseListener): () => void {
    this.phaseListeners.add(l);
    return () => this.phaseListeners.delete(l);
  }

  // --- controls ---------------------------------------------------------------------------------

  pause(): void {
    if (this.phase !== 'playing' && this.phase !== 'intro') return;
    this.pausedFrom = this.phase;
    this.setPhase('paused');
  }

  resume(): void {
    if (this.phase !== 'paused' || !this.pausedFrom) return;
    const back = this.pausedFrom;
    this.pausedFrom = null;
    this.setPhase(back);
  }

  /** Straight to play from anywhere in the intro (the hand-off). */
  skipIntro(): void {
    if (this.phase === 'intro') this.setPhase('playing');
  }

  /** Seconds into the intro (GameRuntime.introTime). */
  get introTime(): number {
    return this.introElapsed;
  }

  /** Flyover, calving, or done. */
  get introStage(): IntroStage {
    return introStageAt(this.introTimeline, this.introElapsed);
  }

  /**
   * Skip the flyover: the short calving beat plays instead (every level starts with the iceberg
   * breaking off the glacier). No-op once the calving has started. Works while paused in the intro.
   */
  skipFlyover(): void {
    const inIntro = this.phase === 'intro' || (this.phase === 'paused' && this.pausedFrom === 'intro');
    if (!inIntro || this.introStage !== 'flyover') return;
    this.introTimeline = introTimeline('short');
    this.introElapsed = 0;
    this.introProgress = 0;
    retimeMeltwater(this.river, this.iceberg, getGlacier(this.terrain), this.introTimeline, this.time);
  }

  /** Space / the skip button: the flyover skips to the short calving, the calving to play. */
  skipIntroStep(): void {
    if (this.phase !== 'intro') return;
    if (this.introStage === 'flyover') this.skipFlyover();
    else this.skipIntro();
  }

  // --- simulation -------------------------------------------------------------------------------

  /** Advance by one rendered frame. Runs as many fixed steps as the elapsed time requires. */
  update(frameDt: number, input: SteeringInput): void {
    if (this.phase === 'paused' || this.phase === 'loading') return;
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
    this.lastInput = input;
    this.time += dt;
    this.phaseTime += dt;

    if (this.phase === 'intro') {
      this.introElapsed += dt;
      const total = this.introTimeline.total;
      this.introProgress = total > 0 ? clamp01(this.introElapsed / total) : 1;
      // The valley lives during the intro: road traffic and its lights run on fixed steps.
      if (this.physics.stepAmbient) {
        this.ambientAccumulator += dt;
        while (this.ambientAccumulator >= FIXED_DT) {
          this.ambientAccumulator -= FIXED_DT;
          this.physics.setIceberg?.(this.iceberg.pos.x, this.iceberg.pos.z, this.iceberg.radius, 0, 0);
          this.physics.stepAmbient(FIXED_DT);
        }
      }
      if (this.introProgress >= 1) this.setPhase('playing');
      return;
    }

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.fixedStep(FIXED_DT, input);
    }
  }

  /** Run a fixed number of steps directly (tests, scripted agents). */
  advance(steps: number, input: SteeringInput): void {
    for (let i = 0; i < steps; i++) this.update(FIXED_DT, input);
  }

  private fixedStep(h: number, input: SteeringInput): void {
    const ice = this.iceberg;
    const playing = this.phase === 'playing';
    // After the run ends the world keeps living (river flows, debris settles, iceberg drifts out to sea).
    const steer: SteeringInput = playing ? input : { steer: 0, source: 'none' };
    const prevX = ice.pos.x;
    const prevZ = ice.pos.z;

    if (this.phase !== 'failed') {
      const p = playing ? this.params : this.driftParams;
      const water = this.water ?? undefined;
      // A road bridge carries the iceberg like the ground while it is on the bridge's level (its
      // running surface is stamped into the ground it stands on, its decks are ridden, not hit).
      const ground =
        this.physics.icebergGround?.(ice.pos.x, ice.pos.y, ice.pos.z, ice.radius) ?? this.terrain;
      this.ground = ground;
      for (const e of stepIceberg(ice, steer, ground, h, p, this.playTime, undefined, water)) {
        this.onIcebergEvent(e);
      }
      const near = this.physics.proxiesNear(ice.pos.x, ice.pos.z, ice.radius + 8);
      const base = playing ? this.playContacts : this.driftContacts;
      const opts = ground === this.terrain ? base : { ...base, terrain: ground };
      for (const c of resolveIcebergContacts(ice, near, this.params, opts)) {
        const outcome = this.physics.applyContact(c);
        const impulse = len2(c.impulse.x, c.impulse.z);
        this.river.disturb(c.point.x, c.point.z, Math.min(1, impulse / 60));
        const known = this.touching.includes(c.obstacleId);
        if (!known) this.touching.push(c.obstacleId);
        // Ploughing through rubble that yields is no new impact, however fast, even on the first
        // touch of a piece of what it just broke (the break was the impact): no collision, FX or
        // chip. A push on rubble that holds (heavy) is a real hit and counts like any other.
        if (c.push || (known && !(c.relSpeed > NEW_IMPACT_SPEED))) continue;
        if (playing) this.stats.collisions++;
        this.emit({
          type: 'collision',
          obstacleId: c.obstacleId,
          kind: outcome.kind,
          pos: c.point,
          relSpeed: c.relSpeed,
          impulse,
        });
        // Once per impact (the touching filter above), never per step spent pressing on a body.
        if (playing) this.chip(c);
      }
      if (this.touching.length > 0) this.forgetSeparated(near);
      if (playing && opts.absorbing) this.absorbTouching(near);
      // On a road bridge's deck the water stays between its barriers (RiverSample.bank).
      const bank = this.physics.icebergBank?.(ice.pos.x, ice.pos.y, ice.pos.z) ?? null;
      this.river.record(ice, this.terrain, this.time, bank);
    }

    // Streams flow, reservoirs drain, captured rivers follow the trail (the world keeps living).
    this.water?.step(h, this.phase !== 'failed' ? ice : null, this.river, this.physics);
    // Road traffic brakes for the iceberg (once it has failed it still sits there).
    this.physics.setIceberg?.(ice.pos.x, ice.pos.z, ice.radius, ice.vel.x, ice.vel.z);
    this.physics.applyWaterForces(this.waterForces, h);
    this.physics.step(h);
    for (const e of this.physics.drainEvents()) {
      // A dam body breaking under water breaches its reservoir.
      if (e.type === 'obstacleBroken' && e.kind === 'dam') this.water?.damBroken(e.pos);
      this.emit(e);
    }

    if (!playing) return;

    this.playTime += h;
    const speed = len2(ice.vel.x, ice.vel.z);
    const st = this.stats;
    st.time = this.playTime;
    st.distance += len2(ice.pos.x - prevX, ice.pos.z - prevZ);
    st.topSpeed = Math.max(st.topSpeed, speed);
    const ps = this.physics.stats;
    st.knockedDown = ps.knockedDown;
    st.buildingsDestroyed = ps.buildingsDestroyed;
    st.treesFelled = ps.treesFelled;

    this.routeTimer -= h;
    if (this.routeTimer <= 0) {
      this.routeTimer = ROUTE_INTERVAL;
      const g = this.terrain.gradientAt(ice.pos.x, ice.pos.z);
      this.route.push({
        t: this.playTime,
        x: ice.pos.x,
        y: ice.pos.y,
        z: ice.pos.z,
        speed,
        steer: ice.steer,
        slope: len2(g.dx, g.dz),
      });
    }

    const { s } = this.terrain.course.project(ice.pos.x, ice.pos.z);
    const lv = this.level;
    this.progress = clamp01((s - lv.startS) / (lv.finishS - lv.startS));
    st.iceLeft = Number.isFinite(ice.ice) ? Math.max(0, ice.ice) : 0;
    const fell = this.updateFall(h);

    if (isMelted(ice)) {
      this.fail('melted');
    } else if (ice.inOcean && s >= lv.finishS) {
      st.score = computeScore(st, lv);
      this.setPhase('complete');
      this.emit({ type: 'complete', stats: { ...st } });
    } else if (fell) {
      this.fail('fell');
    } else if (this.fellTime < 0 && isStuck(ice, this.params)) {
      this.fail('stuck');
    }
  }

  /**
   * Fatal ravines: starts the FELL_BEAT once the grounded iceberg is on ground a ravine lowered by
   * FELL_DEPTH or more; true when the beat is over (the walls are trap walls, so nothing climbs out
   * in the meantime; the stuck rule waits for it).
   */
  private updateFall(h: number): boolean {
    const ice = this.iceberg;
    if (this.fellTime >= 0) {
      // Rose back up to the rim, or left the ravine (a bounce out, a far-edge landing): no fall.
      if (this.ravineDrop() < FELL_DEPTH * 0.5) {
        this.fellTime = -1;
        return false;
      }
      this.fellTime += h;
      return this.fellTime >= FELL_BEAT;
    }
    if (!ice.grounded || ice.inOcean) return false;
    if (!(this.ravineDrop() >= FELL_DEPTH)) return false;
    this.fellTime = 0;
    return FELL_BEAT <= 0;
  }

  /**
   * How far below the rim of a ravine the iceberg is (m): the uncut ground there (terrain height +
   * the ravine's cut) minus the iceberg's own height. 0 outside ravines. Measured from the iceberg,
   * not from the grid: at a kicker lip beside a ravine the iceberg rides the exact lip while the grid
   * cell already dips into the cut, which must not count as being down in it.
   */
  private ravineDrop(): number {
    const ice = this.iceberg;
    const cut = this.terrain.ravineDepthAt?.(ice.pos.x, ice.pos.z) ?? 0;
    if (!(cut > 0)) return 0;
    // On a bridge deck over the ravine, not down in it (the deck is its ground).
    if (this.ground !== this.terrain) {
      const deck = this.ground.heightAt(ice.pos.x, ice.pos.z);
      const overGap = deck - this.terrain.heightAt(ice.pos.x, ice.pos.z) > FELL_DEPTH;
      if (overGap && ice.pos.y > deck - FELL_DEPTH) return 0;
    }
    const rim = this.terrain.heightAt(ice.pos.x, ice.pos.z) + cut;
    return Math.max(0, Math.min(cut, rim - ice.pos.y));
  }

  /**
   * Break ice off the iceberg for a hit (IcebergContact.shock); chunks go to the physics world.
   * chipAmount is a fraction of the ice the iceberg has NOW: a half-melted iceberg loses half the
   * tonnage a full one would (a fixed tonnage took a third of a small iceberg in one bounce).
   */
  private chip(c: IcebergContact): void {
    const ice = this.iceberg;
    let amount = Math.min(chipAmount(c.shock, this.params) * ice.ice, ice.ice);
    // Proportional chips never reach zero on their own; a sliver this small shatters completely.
    if (amount > 0 && ice.ice - amount < SHATTER_BELOW) amount = ice.ice;
    if (!(amount > 0)) return;
    setIce(ice, ice.ice - amount, this.params);
    const chunkMass = amount * this.params.mass;
    this.emit({ type: 'iceChipped', pos: c.point, amount, chunkMass });
    this.physics.spawnIceChunks?.({ ...c.point }, { ...ice.vel }, chunkMass, this.chunkSource());
  }

  /** Where chunks break off: the iceberg's flanks (never ahead of it, where it would hit them). */
  private chunkSource(): ChunkSource {
    const ice = this.iceberg;
    return { x: ice.pos.x, z: ice.pos.z, radius: ice.radius };
  }

  /**
   * Merge the glacier ice the iceberg touches (momentum conserved, it grows). Ice that does not fit
   * under maxIce shatters into chunks. Ids and positions are copied before absorbing because
   * absorb() changes the world the `near` list came from.
   */
  private absorbTouching(near: readonly ObstacleProxy[]): void {
    const ice = this.iceberg;
    const ids = this.absorbIds;
    const n = collectAbsorbable(ice, near, ids, this.params);
    if (n === 0) return;
    const xyz = this.absorbPos;
    xyz.length = 0;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < near.length; i++) {
        if (near[i].id !== ids[k]) continue;
        xyz.push(near[i].x, near[i].y, near[i].z);
        break;
      }
    }
    const st = this.stats;
    for (let k = 0; k < n && canGrow(ice, this.params); k++) {
      const got = this.physics.absorb?.(ids[k]);
      if (!got) continue;
      const merged = absorbIce(ice, got.mass, got.vel, this.params);
      const pos = { x: xyz[3 * k], y: xyz[3 * k + 1], z: xyz[3 * k + 2] };
      st.absorbed += merged;
      st.peakMass = Math.max(st.peakMass, ice.mass);
      this.emit({ type: 'absorbed', obstacleId: ids[k], pos, mass: merged, newMass: ice.mass });
      const spill = got.mass - merged;
      if (spill > 1e-6) this.physics.spawnIceChunks?.({ ...pos }, { ...ice.vel }, spill, this.chunkSource());
    }
  }

  private fail(reason: FailReason): void {
    this.failReason = reason;
    this.stats.score = 0;
    this.setPhase('failed');
    this.emit({ type: 'failed', reason, stats: { ...this.stats } });
  }

  /** Drop touching ids whose body is gone or now more than TOUCH_GAP away from the iceberg. */
  private forgetSeparated(near: readonly ObstacleProxy[]): void {
    const ice = this.iceberg;
    const ids = this.touching;
    for (let k = ids.length - 1; k >= 0; k--) {
      let apart = true;
      for (let i = 0; i < near.length; i++) {
        const p = near[i];
        if (p.id !== ids[k]) continue;
        apart = proxyGap(ice.pos.x, ice.pos.z, p, this.gapDir) > ice.radius + TOUCH_GAP;
        break;
      }
      if (apart) {
        ids[k] = ids[ids.length - 1];
        ids.pop();
      }
    }
  }

  private onIcebergEvent(e: ReturnType<typeof stepIceberg>[number]): void {
    if (e.type === 'landed') {
      this.emit({ type: 'landed', pos: e.pos, drop: e.drop, speed: e.speed });
      this.river.disturb(e.pos.x, e.pos.z, 1);
      if (e.drop >= WATERFALL_MIN_DROP) this.countWaterfall(e.pos.x, e.pos.z, e.pos);
    } else if (e.type === 'airborne') {
      this.emit({ type: 'airborne', pos: e.pos, speed: e.speed });
    } else {
      this.emit({ type: 'enteredOcean', pos: e.pos });
    }
  }

  private countWaterfall(x: number, z: number, pos: { x: number; y: number; z: number }): void {
    const { s } = this.terrain.course.project(x, z);
    const cliffs = this.level.cliffs;
    for (let i = 0; i < cliffs.length; i++) {
      if (this.crossedCliffs.has(i)) continue;
      if (s >= cliffs[i].s - 5 && s <= cliffs[i].s + 80) {
        this.crossedCliffs.add(i);
        this.stats.waterfallsCrossed = this.crossedCliffs.size;
        this.emit({ type: 'waterfallCrossed', index: i, pos });
        return;
      }
    }
  }

  private emit(e: GameEvent): void {
    this.events.emit(e);
  }

  private setPhase(p: GamePhase): void {
    if (p === this.phase) return;
    if (p === 'playing' && this.phase === 'intro') {
      this.accumulator = 0;
      // The intro is over (introProgress keeps its value so the camera can tell a skip).
      this.introElapsed = this.introTimeline.total;
      meltwaterBornBy(this.river, this.time);
    }
    this.phase = p;
    this.phaseTime = 0;
    for (const l of this.phaseListeners) l(p, this);
  }

  dispose(): void {
    this.events.clear();
    this.phaseListeners.clear();
    this.physics.dispose();
  }
}

/**
 * Score rewards finishing fast and interacting with the world. Par time is one minute per 500 m of
 * course between start and finish line. The ice left at the finish adds round(iceLeft × ICE_SCORE):
 * 600 for the starting tonnage (levels without a water budget always finish with full ice) and more
 * for an iceberg grown past it by absorbing glacier ice (139 % ice → 834).
 */
export function computeScore(st: RunStats, level: LevelDef): number {
  const par = ((level.finishS - level.startS) / 500) * 60;
  const timeBonus = Math.max(0, par - st.time) * 25;
  return Math.round(
    1000 +
      timeBonus +
      st.knockedDown * 20 +
      st.buildingsDestroyed * 150 +
      st.waterfallsCrossed * 250 +
      st.topSpeed * 4 +
      Math.round(Math.max(0, st.iceLeft) * ICE_SCORE),
  );
}
