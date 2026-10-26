import { describe, expect, it } from 'vitest';
import type { GameEvent, IcebergState, ObstacleKind } from '../core/types';
import {
  AVALANCHE,
  PARTICLE_CAPACITY,
  ParticlePool,
  absorbPuffCount,
  avalancheRate,
  createEmitterState,
  debrisVariantFor,
  emitIcebergEffects,
  iceShardCount,
} from './Particles';

const SEED = 42;

function iceberg(over: Partial<IcebergState> = {}): IcebergState {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    heading: 0,
    steer: 0,
    yawRate: 0,
    grounded: true,
    airTime: 0,
    airPeakY: 0,
    inOcean: false,
    stuckTimer: 0,
    pitch: 0,
    roll: 0,
    impact: 0,
    radius: 2.2,
    mass: 30,
    ice: 1,
    size: 1,
    ...over,
  };
}

const chipped = (amount: number): GameEvent => ({
  type: 'iceChipped',
  pos: { x: 0, y: 1, z: 0 },
  amount,
  chunkMass: amount * 30,
});

/** Live particle positions (the pool keeps dead slots zero-sized). */
function live(pool: ParticlePool): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < pool.capacity; i++) {
    if (pool.misc[i * 3] > 0 && pool.colors[i * 4 + 3] > 0) {
      out.push({ x: pool.positions[i * 3], y: pool.positions[i * 3 + 1], z: pool.positions[i * 3 + 2] });
    }
  }
  return out;
}

describe('ice chip shards', () => {
  it('the burst grows with the ice lost and is capped', () => {
    expect(iceShardCount(0)).toBe(0);
    expect(iceShardCount(0.005)).toBeGreaterThanOrEqual(8);
    expect(iceShardCount(0.1)).toBeGreaterThan(iceShardCount(0.02));
    expect(iceShardCount(0.5)).toBe(iceShardCount(1));
    expect(iceShardCount(1)).toBeLessThanOrEqual(80);
    const alive = (amount: number): number => {
      const pool = new ParticlePool(PARTICLE_CAPACITY, SEED);
      pool.handleEvent(chipped(amount));
      return pool.alive;
    };
    expect(alive(0.1)).toBeGreaterThan(alive(0.02));
    expect(alive(0.02)).toBeGreaterThanOrEqual(iceShardCount(0.02));
  });

  it('is deterministic for a seed', () => {
    const run = (): Float32Array => {
      const pool = new ParticlePool(PARTICLE_CAPACITY, SEED);
      pool.iceberg = iceberg({ vel: { x: 3, y: 0, z: 12 } });
      pool.handleEvent(chipped(0.06));
      for (let i = 0; i < 10; i++) pool.update(1 / 60);
      return pool.positions.slice();
    };
    expect(run()).toEqual(run());
  });

  it('shards carry on with the moving iceberg rather than stopping dead', () => {
    const pool = new ParticlePool(PARTICLE_CAPACITY, SEED);
    pool.iceberg = iceberg({ vel: { x: 0, y: 0, z: 15 } });
    pool.handleEvent(chipped(0.08));
    pool.update(0.2);
    const pts = live(pool);
    const meanZ = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    expect(meanZ).toBeGreaterThan(1);
  });
});

describe('absorb puff', () => {
  const absorbed: GameEvent = {
    type: 'absorbed',
    obstacleId: 7,
    pos: { x: 6, y: 1, z: 0 },
    mass: 12,
    newMass: 42,
  };

  it('is sized by how much the iceberg grew', () => {
    expect(absorbPuffCount(0.5)).toBeGreaterThan(absorbPuffCount(0.05));
    expect(absorbPuffCount(0.01)).toBeGreaterThanOrEqual(10);
    expect(absorbPuffCount(1)).toBeLessThanOrEqual(70);
  });

  it('swirls into the moving iceberg and is gone soon after', () => {
    const pool = new ParticlePool(PARTICLE_CAPACITY, SEED);
    const ice = iceberg({ vel: { x: 0, y: 0, z: 10 } });
    pool.iceberg = ice;
    pool.handleEvent(absorbed);
    expect(pool.alive).toBeGreaterThanOrEqual(absorbPuffCount(12 / 42));
    const dist = (): number => {
      const pts = live(pool);
      return pts.reduce((a, p) => a + Math.hypot(p.x - ice.pos.x, p.z - ice.pos.z), 0) / pts.length;
    };
    // Particles become visible on their first update.
    pool.update(1 / 60);
    const d0 = dist();
    for (let i = 0; i < 30; i++) {
      ice.pos.z += ice.vel.z / 60;
      pool.update(1 / 60);
    }
    expect(dist()).toBeLessThan(d0 * 0.6);
    for (let i = 0; i < 120; i++) {
      ice.pos.z += ice.vel.z / 60;
      pool.update(1 / 60);
    }
    expect(pool.alive).toBe(0);
  });
});

describe('avalanche snow spray budget', () => {
  it('only a big, fast iceberg throws snow, more the bigger and faster it is', () => {
    expect(avalancheRate(1, 30, 0, PARTICLE_CAPACITY)).toBe(0);
    expect(avalancheRate(1.8, 4, 0, PARTICLE_CAPACITY)).toBe(0);
    const mid = avalancheRate(1.4, 14, 0, PARTICLE_CAPACITY);
    expect(mid).toBeGreaterThan(0);
    expect(avalancheRate(1.8, 14, 0, PARTICLE_CAPACITY)).toBeGreaterThan(mid);
    expect(avalancheRate(1.4, 25, 0, PARTICLE_CAPACITY)).toBeGreaterThan(mid);
    expect(avalancheRate(3, 40, 0, PARTICLE_CAPACITY)).toBeCloseTo(AVALANCHE.maxRate);
  });

  it('backs off as the particle pool fills and stops before it is full', () => {
    const full = avalancheRate(1.8, 25, 0, PARTICLE_CAPACITY);
    const busy = avalancheRate(1.8, 25, 0.8 * PARTICLE_CAPACITY, PARTICLE_CAPACITY);
    expect(busy).toBeLessThan(full);
    expect(busy).toBeGreaterThan(0);
    expect(avalancheRate(1.8, 25, 0.9 * PARTICLE_CAPACITY, PARTICLE_CAPACITY)).toBe(0);
  });

  it('a grown iceberg sprays snow in play, a normal one does not, within the pool', () => {
    const run = (radius: number, budget = 1): ParticlePool => {
      const pool = new ParticlePool(PARTICLE_CAPACITY, SEED);
      pool.budget = budget;
      const ice = iceberg({ radius, vel: { x: 0, y: 0, z: 20 } });
      const em = createEmitterState(0);
      const p = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 120; i++) {
        emitIcebergEffects('playing', ice, 1 / 60, pool, em, p);
        pool.update(1 / 60);
        expect(pool.alive).toBeLessThanOrEqual(pool.capacity);
      }
      return pool;
    };
    const normal = run(2.2).alive;
    const big = run(2.2 * 1.8).alive;
    expect(big).toBeGreaterThan(normal + 40);
    expect(run(2.2 * 1.8, 0.5).alive).toBeLessThan(big);
  });
});

describe('debris for the new obstacles', () => {
  it('picks a material per kind', () => {
    const cases: [ObstacleKind, string][] = [
      ['car', 'metal'],
      ['truck', 'metal'],
      ['pylon', 'metal'],
      ['coolingTower', 'concrete'],
      ['dam', 'concrete'],
      ['factoryHall', 'concrete'],
      ['church', 'house'],
      ['chalet', 'house'],
      ['house', 'house'],
      ['logPile', 'wood'],
      ['pine', 'wood'],
      ['iceBlock', 'ice'],
      ['boulder', 'rock'],
      ['rockSmall', 'rock'],
    ];
    for (const [kind, v] of cases) expect(debrisVariantFor(kind)).toBe(v);
  });

  it('a concrete structure collapses with more debris and dust than a rock breaking', () => {
    const broken = (kind: ObstacleKind): number => {
      const pool = new ParticlePool(PARTICLE_CAPACITY, SEED);
      pool.handleEvent({ type: 'obstacleBroken', obstacleId: 1, kind, pos: { x: 0, y: 0, z: 0 } });
      return pool.alive;
    };
    expect(broken('coolingTower')).toBeGreaterThan(broken('boulder'));
    expect(broken('car')).toBeGreaterThan(broken('boulder'));
  });

  it('never exceeds the pool capacity, however many hits arrive', () => {
    const pool = new ParticlePool(PARTICLE_CAPACITY, SEED);
    for (let i = 0; i < 300; i++) {
      pool.handleEvent(chipped(0.2));
      const pos = { x: 0, y: 0, z: 0 };
      pool.handleEvent({ type: 'obstacleBroken', obstacleId: i, kind: 'factoryHall', pos });
    }
    expect(pool.alive).toBeLessThanOrEqual(pool.capacity);
    pool.update(1 / 60);
    expect(pool.alive).toBeLessThanOrEqual(pool.capacity);
  });
});
