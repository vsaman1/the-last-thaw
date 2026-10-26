/**
 * What the live ambience voices are told, read from the real game state (DESIGN §7.1–§7.3, §7.6):
 * the iceberg's slide (scrape), the wind, the moving water near the listener and the sea. Polled at
 * 30 Hz (scrape) and 10 Hz (the rest) into preallocated input objects; the ground under the iceberg
 * at 5 Hz. Only allocation-free queries are used (river.flowAt's object is copied at once,
 * water.sample and course.projectInto write into objects owned here).
 *
 * Also the terrain wall detector: a wall or bank hit makes no event, but it raises
 * IcebergState.impact; a rise with no collision or landing that frame is a wall scrape (§6.2).
 */
import { clamp01, smoothstep } from '../../core/math';
import type { GameRuntime } from '../../core/runtime';
import { createWaterSample, type InlandWaterSample } from '../../core/sim/inlandWater';
import { PAINT, type PaintCode } from '../../core/terrain/features';
import type { CourseProjection } from '../../core/terrain/course';
import { isGeneratedTerrain, type GeneratedTerrain } from '../../core/terrain/terrain';
import type { SurfaceKind } from '../../core/types';
import {
  LEVEL_WIND,
  type AmbienceVoices,
  type AudioLevelId,
  type GroundKind,
  type ListenerPose,
  type OceanInputs,
  type ScrapeInputs,
  type WaterInputs,
  type WindInputs,
} from '../contract';
import { wallM } from './magnitude';
import { panFor } from '../spatial';

export const SCRAPE_HZ = 30;
export const AMBIENCE_HZ = 10;
export const GROUND_HZ = 5;
/** The sea is heard from this far inland (m of course arc before the coast). */
export const OCEAN_HEAR_M = 260;
/** Wading: grounded in water at least this deep (m). */
export const WADE_DEPTH_M = 0.15;
const WATER_PAN = 0.5;
/** A poll is due once its period has passed (a hair early, so 60 Hz frames land on 30 / 10 / 5 Hz exactly). */
const due = (clock: number, hz: number): boolean => clock >= 1 / hz - 1e-6;
const SEA_PAN = 0.5;

// --- the §7.2 slide, as the inputs drive it ---------------------------------------------------------

/**
 * How hard the iceberg is scraping (0..1): 0 off the ground, afloat or at sea, rising with speed from
 * 0.8 m/s and with mass. The scrape voice applies exactly this to its hiss, rumble and grit.
 */
export function scrapeDrive(speed: number, massT: number, onLand: boolean): number {
  if (!onLand) return 0;
  const v = Math.max(0, speed);
  return smoothstep(0.8, 5, v) * (0.35 + 0.65 * Math.min(1, v / 22)) * (0.8 + 0.2 * Math.min(1, Math.max(0, massT) / 100));
}

/** Centre of the scrape hiss (Hz): faster is brighter, a bigger iceberg sounds lower. */
export const scrapeCentreHz = (speed: number, radius: number): number =>
  Math.min(2600, Math.max(300, (500 + 60 * Math.max(0, speed)) * Math.pow(6 / Math.max(0.5, radius), 0.3)));

/** Loudness of moving water from its speed (m/s). */
export const waterLoudness = (u: number): number => smoothstep(1.5, 14, u);

/**
 * The water level the listener hears (0..1): the new river right behind the iceberg, the river under
 * the listener (by how central it is), a stream channel (by its speed and depth).
 */
export function riverLevel(
  uHead: number,
  strength: number,
  uHere: number,
  inChannel: boolean,
  uStream: number,
  depth: number,
): number {
  return Math.max(
    0.6 * waterLoudness(uHead),
    clamp01(strength) * waterLoudness(uHere),
    inChannel ? waterLoudness(uStream) * Math.min(1, Math.max(0, depth) / 1.5) : 0,
  );
}

/** 0 more than 260 m of course before the coast, 1 at it and at sea. */
export const oceanProximity = (coastS: number, listenerS: number, atSea: boolean): number =>
  atSea ? 1 : smoothstep(OCEAN_HEAR_M, 0, coastS - listenerS);

/** The ground under the iceberg: the terrain surface, refined by the paint a feature left there. */
export function groundOf(surface: SurfaceKind, paint: PaintCode): GroundKind {
  if (paint === PAINT.asphalt) return 'asphalt';
  if (paint === PAINT.gravel) return 'gravel';
  if (paint === PAINT.dirt) return 'dirt';
  if (paint === PAINT.rock) return 'rock';
  return surface;
}

/** Rise of IcebergState.impact this frame over its own decay: d = impact − prev·e^(−2.5·dt). */
export class WallDetector {
  private prev = 0;

  /** The wall-scrape magnitude this frame (< 0: none). `contact`: a collision or landing this frame. */
  step(impact: number, dt: number, contact: boolean): number {
    const now = Number.isFinite(impact) ? impact : 0;
    const rise = now - this.prev * Math.exp(-2.5 * Math.max(0, dt));
    this.prev = now;
    return contact ? -1 : wallM(rise);
  }
}

// --- the poller ------------------------------------------------------------------------------------

export class AmbienceInputs {
  readonly wind: WindInputs = { amount: 0, airSpeed: 0 };
  readonly scrape: ScrapeInputs = {
    onLand: false,
    airborne: false,
    wading: false,
    speed: 0,
    massT: 30,
    radius: 2.2,
    ground: 'grass',
  };
  readonly water: WaterInputs = { level: 0, flowSpeed: 0, turbulence: 0, pan: 0, afloat: false };
  readonly ocean: OceanInputs = { proximity: 0, atSea: false, pan: 0, bob: 0 };
  /** Scrape drive of the last 30 Hz update (diagnostics and the browser correlation check). */
  drive = 0;

  private readonly gen: GeneratedTerrain | null;
  private readonly proj: CourseProjection = { s: 0, sExt: 0, d: 0 };
  private readonly ws: InlandWaterSample = createWaterSample();
  private readonly coastS: number;
  private readonly seaX: number;
  private readonly seaZ: number;
  private scrapeClock = Infinity;
  private ambClock = Infinity;
  private groundClock = Infinity;
  /** Grounded in a stream channel at least WADE_DEPTH_M deep (from the last water sample). */
  private wadingWater = false;

  constructor(
    private readonly rt: GameRuntime,
    levelId: AudioLevelId,
  ) {
    this.gen = isGeneratedTerrain(rt.terrain) ? rt.terrain : null;
    this.wind.amount = LEVEL_WIND[levelId];
    const level = rt.level;
    this.coastS = level.coastS;
    const c = rt.terrain.course.sampleAt(Math.min(level.coastS, rt.terrain.course.length));
    const l = Math.hypot(c.dirX, c.dirZ) || 1;
    this.seaX = c.dirX / l;
    this.seaZ = c.dirZ / l;
  }

  /** Poll what is due after dt seconds and push it into the voices (when they exist yet). */
  update(dt: number, pose: Readonly<ListenerPose>, voices: AmbienceVoices | null): void {
    this.scrapeClock += dt;
    this.ambClock += dt;
    this.groundClock += dt;
    if (due(this.groundClock, GROUND_HZ)) {
      this.groundClock = 0;
      this.sampleGround();
    }
    if (due(this.ambClock, AMBIENCE_HZ)) {
      this.ambClock = 0;
      this.pollWind();
      this.pollWater(pose);
      this.pollOcean(pose);
      if (voices) {
        voices.wind.update(this.wind);
        voices.water.update(this.water);
        voices.ocean.update(this.ocean);
      }
    }
    if (due(this.scrapeClock, SCRAPE_HZ)) {
      this.scrapeClock = 0;
      this.pollScrape();
      voices?.scrape.update(this.scrape);
    }
  }

  private pollScrape(): void {
    const ice = this.rt.iceberg;
    const s = this.scrape;
    const afloat = ice.afloat === true;
    s.airborne = !ice.grounded;
    s.onLand = ice.grounded && !ice.inOcean && !afloat;
    s.speed = Math.hypot(ice.vel.x, ice.vel.z);
    s.massT = ice.mass;
    s.radius = ice.radius;
    s.wading = ice.grounded && !afloat && (s.ground === 'seabed' || this.wadingWater);
    this.drive = scrapeDrive(s.speed, s.massT, s.onLand);
  }

  private sampleGround(): void {
    const ice = this.rt.iceberg;
    const t = this.rt.terrain;
    const surface = t.surfaceAt(ice.pos.x, ice.pos.z);
    this.scrape.ground = groundOf(surface, this.gen ? this.gen.paintAt(ice.pos.x, ice.pos.z) : PAINT.none);
    const water = this.rt.water;
    if (water && ice.grounded) {
      water.sample(ice.pos.x, ice.pos.z, this.ws);
      this.wadingWater = this.ws.channel && this.ws.surfaceY - this.ws.groundY >= WADE_DEPTH_M;
    } else {
      this.wadingWater = false;
    }
  }

  private pollWind(): void {
    const ice = this.rt.iceberg;
    this.wind.airSpeed = ice.grounded ? 0 : Math.hypot(ice.vel.x, ice.vel.z);
  }

  private pollWater(pose: Readonly<ListenerPose>): void {
    const ice = this.rt.iceberg;
    const samples = this.rt.river.samples;
    const head = samples.length > 0 ? samples[samples.length - 1] : null;
    const uHead = head ? head.flowSpeed : 0;
    let px = head ? head.x : ice.pos.x;
    let pz = head ? head.z : ice.pos.z;
    let best = 0.6 * waterLoudness(uHead);
    let speed = uHead;
    // The river under the listener (copied out of the trail's reused object at once).
    const here = this.rt.river.flowAt(pose.px, pose.pz);
    if (here) {
      const u = Math.hypot(here.vx, here.vz);
      const lv = clamp01(here.strength) * waterLoudness(u);
      if (lv > best) {
        best = lv;
        speed = u;
        px = pose.px;
        pz = pose.pz;
      }
    }
    // A stream channel at the listener or at the iceberg (the camera trails it by 20–40 m).
    const water = this.rt.water;
    if (water) {
      for (let k = 0; k < 2; k++) {
        const x = k === 0 ? pose.px : ice.pos.x;
        const z = k === 0 ? pose.pz : ice.pos.z;
        water.sample(x, z, this.ws);
        if (!this.ws.channel) continue;
        const u = Math.hypot(this.ws.vx, this.ws.vz);
        const lv = waterLoudness(u) * Math.min(1, Math.max(0, this.ws.surfaceY - this.ws.groundY) / 1.5);
        if (lv > best) {
          best = lv;
          speed = u;
          px = x;
          pz = z;
        }
      }
    }
    const w = this.water;
    w.level = best;
    w.flowSpeed = speed;
    w.turbulence = head ? clamp01(head.turbulence) : 0;
    w.pan = panFor(pose, px, pz, WATER_PAN);
    w.afloat = ice.afloat === true;
  }

  private pollOcean(pose: Readonly<ListenerPose>): void {
    const ice = this.rt.iceberg;
    const o = this.ocean;
    const course = this.gen?.course;
    let s: number;
    if (course) s = course.projectInto(pose.px, pose.pz, this.proj).sExt;
    else s = this.rt.terrain.course.project(pose.px, pose.pz).s;
    o.atSea = ice.inOcean;
    o.proximity = oceanProximity(this.coastS, s, o.atSea);
    // The sea lies down-course; at sea it is all round, so the pan settles to the middle.
    const side = this.seaX * pose.rightX + this.seaZ * pose.rightZ;
    o.pan = o.atSea ? 0 : SEA_PAN * side * o.proximity;
    // Laps against the ice follow how fast it drifts and rocks (the swell is drawn, not simulated).
    o.bob = o.atSea ? clamp01(0.4 + Math.hypot(ice.vel.x, ice.vel.z) / 10) : 0;
  }
}
