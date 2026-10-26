/**
 * A tiny stand-in for the runtime the bridge reads (GameRuntime plus PhysicsWorld.getBody), for unit
 * tests of the ring, the resolver and the bells. Bodies are plain AudioBodyView records.
 */
import type { GameRuntime } from '../../../core/runtime';
import type { GameEvent, IcebergState, ObstacleKind, Vec3 } from '../../../core/types';
import type { AudioBodyView } from '../../contract';

export interface FakeBody extends AudioBodyView {
  anchored: boolean;
  state: 'intact' | 'loose' | 'broken';
  active: boolean;
  countedKnocked: boolean;
  shake: { amp: number; t0: number };
}

export function body(id: number, kind: ObstacleKind, over: Partial<FakeBody> = {}): FakeBody {
  return {
    id,
    originId: id,
    kind,
    part: 'main',
    placement: id,
    mass: 10,
    anchored: true,
    state: 'intact',
    active: true,
    pos: { x: 0, y: 0, z: 0 },
    spawn: { x: 0, y: 0, z: 0 },
    shake: { amp: 0, t0: 0 },
    countedKnocked: false,
    ...over,
  };
}

export function iceberg(over: Partial<IcebergState> = {}): IcebergState {
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

export interface FakeRuntime {
  rt: GameRuntime;
  bodies: FakeBody[];
  /** Emit an event to every listener, as session.update would. */
  emit(e: GameEvent): void;
  setTime(t: number): void;
  readonly ice: IcebergState;
}

export function fakeRuntime(bodies: FakeBody[] = [], ice: IcebergState = iceberg()): FakeRuntime {
  const listeners = new Set<(e: GameEvent) => void>();
  const log: GameEvent[] = [];
  const byId: FakeBody[] = [];
  for (const b of bodies) byId[b.id] = b;
  const state = { time: 0 };
  const rt = {
    get time() {
      return state.time;
    },
    iceberg: ice,
    physics: { getBody: (id: number) => byId[id] },
    events: {
      log,
      on(l: (e: GameEvent) => void) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      emit(e: GameEvent) {
        log.push(e);
        for (const l of listeners) l(e);
      },
    },
  } as unknown as GameRuntime;
  return {
    rt,
    bodies,
    ice,
    emit: (e) => (rt.events as unknown as { emit(e: GameEvent): void }).emit(e),
    setTime: (t) => {
      state.time = t;
    },
  };
}

export const at = (x: number, y = 0, z = 0): Vec3 => ({ x, y, z });
