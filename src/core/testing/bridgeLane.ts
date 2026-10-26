import { autopilotSteer } from '../autopilot';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import type { CourseCoord, GameEvent, LevelDef } from '../types';

/**
 * Lane sweeps over a level's road bridge (the parapet walls of src/core/physics/deckGround.ts): the
 * autopilot follows a route whose line is shifted sideways over the bridge, from the start of the
 * level, so the iceberg arrives at the bridge as a player holding that lane would.
 */

/** `line` offset by `shift` m between s0 and s1, ramped in over `ramp` m either side (every 5 m). */
export function shiftedLine(line: readonly CourseCoord[], shift: number, s0: number, s1: number, ramp = 30): CourseCoord[] {
  const dense: CourseCoord[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    dense.push(a);
    const b = line[i + 1];
    if (!b) break;
    for (let s = Math.ceil(a.s / 5) * 5 + 5; s < b.s; s += 5) {
      dense.push({ s, d: a.d + ((b.d - a.d) * (s - a.s)) / (b.s - a.s) });
    }
  }
  return dense.map((p) => {
    let k = 0;
    if (p.s >= s0 && p.s <= s1) k = 1;
    else if (p.s < s0 && p.s > s0 - ramp) k = (p.s - (s0 - ramp)) / ramp;
    else if (p.s > s1 && p.s < s1 + ramp) k = (s1 + ramp - p.s) / ramp;
    return { s: p.s, d: p.d + k * shift };
  });
}

export interface BridgeLaneRun {
  /** Why the run failed (null: still going when it stopped). */
  reason: string | null;
  /** It got 30 m past the bridge's far end. */
  crossed: boolean;
  /** Its lowest speed (m/s) over the bridge, and contacts with the parapet walls. */
  vMin: number;
  walls: number;
  /** Where it ended (course coordinates). */
  endS: number;
  endD: number;
}

/**
 * One run of `level` from its start along `route` shifted `lane` m over its (first) road bridge
 * (from 25 m before the deck to 25 m past it), until it is 30 m past the bridge or the run ends.
 */
export async function rideBridgeLane(level: LevelDef, route: readonly CourseCoord[], lane: number): Promise<BridgeLaneRun> {
  const bridge = level.obstacles.find((o) => o.kind === 'roadBridge')!;
  const half = ((bridge.span ?? 40) * (bridge.scale ?? 1)) / 2;
  const line = shiftedLine(route, lane, bridge.s - half - 25, bridge.s + half + 25);
  const s = await GameSession.create({ level, skipIntro: true, terrain: getTerrain(level) });
  const alt = { ...s.terrain, level: { ...s.terrain.level, line } };
  let walls = 0;
  s.events.on((e: GameEvent) => {
    if (e.type === 'collision' && e.obstacleId < 0) walls++;
  });
  let vMin = Infinity;
  let crossed = false;
  let p = s.terrain.course.project(s.iceberg.pos.x, s.iceberg.pos.z);
  for (let n = 0; n < 150 / FIXED_DT && s.phase === 'playing' && !crossed; n++) {
    s.update(FIXED_DT, autopilotSteer(s.iceberg, alt));
    p = s.terrain.course.project(s.iceberg.pos.x, s.iceberg.pos.z);
    if (Math.abs(p.s - bridge.s) < half && Math.abs(p.d - bridge.d) < 14) {
      vMin = Math.min(vMin, Math.hypot(s.iceberg.vel.x, s.iceberg.vel.z));
    }
    crossed = p.s > bridge.s + half + 30;
  }
  const out = { reason: s.failReason, crossed, vMin, walls, endS: p.s, endD: p.d };
  s.dispose();
  return out;
}
