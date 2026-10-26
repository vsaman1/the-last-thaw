/**
 * Headless runs of a real GameSession (Rapier physics, the level's terrain and water) on autopilot,
 * with or without the full sound bridge listening, for the listen-only and integration tests.
 */
import { autopilotSteer } from '../../../core/autopilot';
import { FIXED_DT, GameSession } from '../../../core/session';
import type { LevelDef } from '../../../core/types';
import type { GameMode } from '../../../state/appStore';
import type { ChapterDef } from '../../../story/types';
import { SessionBridge } from '../sessionBridge';
import { RecordingAudioManager, type RecordingSessionAudio } from './recording';

export interface HeadlessOptions {
  readonly level: LevelDef;
  /** Seconds of game time (one fixed step per frame). */
  readonly seconds: number;
  readonly bridge: boolean;
  readonly mode?: GameMode;
  readonly chapter?: ChapterDef | null;
  readonly seed?: number;
  /** Ambience voices for the recording session (default: recording voices; null: never ready). */
  readonly ambience?: boolean;
  /** Play this intro first (default none: straight to play). */
  readonly intro?: 'full' | 'short';
}

export interface HeadlessRun {
  readonly session: GameSession;
  readonly bridge: SessionBridge | null;
  readonly engine: RecordingAudioManager | null;
  readonly audio: RecordingSessionAudio | null;
  /** Wall-clock milliseconds spent in bridge.frame (the bridge's own cost). */
  readonly bridgeMs: number;
  readonly frames: number;
}

/** A camera 30 m behind and 15 m above the iceberg, looking along its travel (three.js matrixWorld). */
export function trailingCamera(session: GameSession, out: Float64Array): Float64Array {
  const ice = session.iceberg;
  let fx = ice.vel.x;
  let fz = ice.vel.z;
  const l = Math.hypot(fx, fz);
  if (l < 0.5) {
    fx = Math.sin(ice.heading);
    fz = Math.cos(ice.heading);
  } else {
    fx /= l;
    fz /= l;
  }
  out.fill(0);
  // x axis = right of travel (−fz, fx); y axis up; z axis = −forward; position behind and above.
  out[0] = -fz;
  out[2] = fx;
  out[5] = 1;
  out[8] = -fx;
  out[10] = -fz;
  out[12] = ice.pos.x - fx * 30;
  out[13] = ice.pos.y + 15;
  out[14] = ice.pos.z - fz * 30;
  out[15] = 1;
  return out;
}

export async function runHeadless(o: HeadlessOptions): Promise<HeadlessRun> {
  const session = await GameSession.create(
    o.intro ? { level: o.level, intro: o.intro, seed: o.seed } : { level: o.level, skipIntro: true, seed: o.seed },
  );
  const engine = o.bridge ? new RecordingAudioManager({ session: o.ambience === false ? { ambience: null } : {} }) : null;
  const bridge = engine
    ? new SessionBridge(session, {
        engine,
        mode: o.mode ?? 'arcade',
        chapter: o.chapter ?? null,
        attempt: 1,
        narrative: true,
      })
    : null;
  bridge?.setPhase(session.phase);
  const cam = new Float64Array(16);
  const steps = Math.round(o.seconds / FIXED_DT);
  let bridgeMs = 0;
  for (let i = 0; i < steps; i++) {
    session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, {}));
    if (bridge && engine) {
      engine.clock += FIXED_DT;
      const t0 = performance.now();
      bridge.frame(FIXED_DT, trailingCamera(session, cam));
      bridgeMs += performance.now() - t0;
    }
  }
  return { session, bridge, engine, audio: engine ? engine.session : null, bridgeMs, frames: steps };
}

/**
 * A fingerprint that tells every number apart bit for bit (−0 from 0, each NaN payload aside): two
 * runs are identical exactly when their fingerprints are equal strings.
 */
export function fingerprint(value: unknown): string {
  const view = new DataView(new ArrayBuffer(8));
  const walk = (v: unknown): string => {
    if (typeof v === 'number') {
      view.setFloat64(0, v);
      return `n${view.getUint32(0).toString(16)}.${view.getUint32(4).toString(16)}`;
    }
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'u';
    if (Array.isArray(v)) return `[${v.map(walk).join(',')}]`;
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${k}:${walk((v as Record<string, unknown>)[k])}`).join(',')}}`;
  };
  return walk(value);
}
