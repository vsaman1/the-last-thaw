import { describe, expect, it } from 'vitest';
import { autopilotSteer } from '../autopilot';
import { createPhysicsWorld, type PhysicsWorld } from '../physics/world';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import { validateLevel } from '../terrain/validate';
import { trafficNetwork } from '../traffic/network';
import type { LevelDef, ObstaclePlacement } from '../types';
import { trafficSandbox } from './trafficSandbox';

/** The living-world sandbox: a town valley with streets, junctions, lights, traffic and plumes. */

const L = trafficSandbox;

describe('traffic sandbox', () => {
  const terrain = getTerrain(L);

  it('passes every level-design check (vehicles on roads and in the parking lot)', () => {
    expect(validateLevel(terrain)).toEqual([]);
  });

  it('has a road network with signalised crossroads, an unsignalised T and crossing', () => {
    const net = trafficNetwork(terrain);
    const signalised = net.junctions.filter((j) => j.signalised);
    console.log(
      `[traffic sandbox] ${net.lines.length} lines, ${net.junctions.length} junctions ` +
        `(${signalised.length} signalised: ${signalised.map((j) => j.legs.length).join(', ')} legs), ` +
        `${net.paths.filter((p) => p.kind === 'lane').length} lanes, ` +
        `${net.paths.filter((p) => p.kind === 'turn').length} turns`,
    );
    // The four crossroads of the cross streets with the banks' roads get lights; the T and the side
    // street's crossing, within 70 m of those, are unsignalised.
    expect(signalised.map((j) => j.legs.length)).toEqual([4, 4, 4, 4]);
    expect(net.junctions.filter((j) => !j.signalised).map((j) => j.legs.length).sort()).toEqual([3, 4]);
  });

  it('runs: traffic drives and waits at lights, the autopilot reaches the sea; deterministic', async () => {
    const drive = async (): Promise<{ poses: number[]; summary: string; ms: number }> => {
      const s = await GameSession.create({ level: L, skipIntro: true });
      const w = s.physics as PhysicsWorld;
      const t = w.traffic!;
      let waited = 0;
      let n = 0;
      let ms = 0;
      const poses: number[] = [];
      while (s.phase === 'playing' && n < 120 * 60) {
        const t0 = performance.now();
        s.update(FIXED_DT, autopilotSteer(s.iceberg, s.terrain, { lane: 0 }));
        ms += performance.now() - t0;
        n++;
        // A vehicle standing at a stop line with its phase red.
        for (let i = 0; i < t.count; i++) {
          if (!t.active[i] || t.v[i] > 0.05) continue;
          const p = t.net.paths[t.path[i]];
          if (p.kind !== 'lane' || p.junction < 0 || p.leg < 0) continue;
          const J = t.net.junctions[p.junction];
          if (p.length - t.arc[i] < 6 && t.signal(J.id, J.legs[p.leg].group) === 'red') waited++;
        }
        if (n === 30 * 60) for (const b of w.bodies) if (b.driven) poses.push(b.pos.x, b.pos.y, b.pos.z);
      }
      const st = s.stats;
      const summary =
        `${s.phase} t=${st.time.toFixed(2)} ice=${(s.iceberg.ice * 100).toFixed(1)}% ` +
        `knocked=${st.knockedDown} buildings=${st.buildingsDestroyed} driving=${t.driving}/${t.count} ` +
        `lights=${w.bodies.filter((b) => b.kind === 'trafficLight').length} red-light waits=${waited}`;
      s.dispose();
      return { poses, summary, ms: ms / n };
    };
    const a = await drive();
    const b = await drive();
    console.log(`[traffic sandbox] autopilot ${a.summary}, ${a.ms.toFixed(2)} ms/step`);
    expect(a.summary).toMatch(/^complete/);
    expect(a.summary).toEqual(b.summary);
    expect(a.poses).toEqual(b.poses);
    expect(a.poses.length).toBeGreaterThan(30);
    expect(Number(/red-light waits=(\d+)/.exec(a.summary)![1])).toBeGreaterThan(60);
  });

  it('keeps 60 driving vehicles cheap', async () => {
    const cars: ObstaclePlacement[] = [];
    for (let k = 0; k < 30; k++) {
      cars.push({ kind: k % 7 === 3 ? 'truck' : 'car', s: 100 + k * 16, d: 42.25, yaw: 0 });
      cars.push({ kind: k % 9 === 4 ? 'bus' : 'car', s: 108 + k * 16, d: 37.75, yaw: Math.PI });
    }
    const busy: LevelDef = { ...L, id: 'traffic-sandbox-busy', obstacles: cars };
    const time = async (traffic: boolean): Promise<{ ms: number; w: PhysicsWorld }> => {
      const w = await createPhysicsWorld(getTerrain(busy), { seed: busy.seed, traffic });
      w.setIceberg(0, 30, 2.2);
      for (let k = 0; k < 120; k++) w.step(FIXED_DT);
      const t0 = performance.now();
      for (let k = 0; k < 1200; k++) w.step(FIXED_DT);
      return { ms: (performance.now() - t0) / 1200, w };
    };
    const off = await time(false);
    const on = await time(true);
    const t = on.w.traffic!;
    let moving = 0;
    for (let i = 0; i < t.count; i++) if (t.v[i] > 0.5) moving++;
    console.log(
      `[traffic sandbox] 60 vehicles: step ${on.ms.toFixed(3)} ms with traffic vs ${off.ms.toFixed(3)} ms ` +
        `parked (+${(on.ms - off.ms).toFixed(3)} ms), ${t.driving} driving, ${moving} moving`,
    );
    expect(t.count).toBe(60);
    expect(t.driving).toBe(60);
    expect(moving).toBeGreaterThan(30);
    // ~0.4-0.6 ms alone; up to ~1.3 ms with the whole suite competing for the cores.
    expect(on.ms - off.ms).toBeLessThan(2.5);
    off.w.dispose();
    on.w.dispose();
  });
});
