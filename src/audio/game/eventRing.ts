/**
 * The bridge's ear on the game (DESIGN §2.4 step 1): a listener on session.events that copies each
 * event into a preallocated ring, once per event, while the session is stepping. It runs inside
 * session.update (up to 6 fixed steps a frame, hundreds under fastForward), so it only copies numbers
 * and reads bodies; the frame resolver (./router.ts) turns the ring into sounds once per frame.
 *
 * Bodies are read HERE, at listen time, because a body can change by the next frame (a tower that
 * held a hit can fall in the same frame's next step): placement, part and mass come from getBody.
 * A gone body reports its kind as 'rockSmall' (physics/world.ts applyContact); the ring keeps the
 * kind it saw for each id and puts it back.
 *
 * Audio only listens: nothing here writes to an event, a body or the session. A listener that throws
 * would end in the "3D view stopped" dialog (GameView), so every call is caught; after
 * MAX_RING_ERRORS the ring turns itself off (one console.warn) and the game plays on in silence.
 */
import type { GameRuntime } from '../../core/runtime';
import type { GameEvent, ObstacleKind } from '../../core/types';
import { GLOBAL_LIMITS, type AudioBodyView, type QueuedEvent } from '../contract';

/** Retention priority when the ring is full (lower = kept first). */
export const EVENT_PRIORITY: Readonly<Record<GameEvent['type'], number>> = {
  obstacleBroken: 0,
  enteredOcean: 0,
  waterfallCrossed: 0,
  treeFelled: 1,
  landed: 1,
  collision: 2,
  splash: 3,
  iceChipped: 3,
  absorbed: 3,
  airborne: 4,
  complete: 4,
  failed: 4,
};

export const MAX_RING_ERRORS = 5;

/** What the ring reads of the physics world: PhysicsWorld.getBody, duck-typed (no Rapier import). */
export interface BodySource {
  getBody(id: number): AudioBodyView | undefined;
}

export const hasBodies = (p: unknown): p is BodySource =>
  typeof p === 'object' && p !== null && typeof (p as Partial<BodySource>).getBody === 'function';

const emptySlot = (): QueuedEvent => ({
  seq: 0,
  type: null,
  frame: 0,
  x: 0,
  y: 0,
  z: 0,
  obstacleId: -1,
  placement: -1,
  kind: null,
  part: null,
  massT: 0,
  relSpeed: 0,
  impulse: 0,
  intensity: 0,
  drop: 0,
  speed: 0,
  amount: 0,
  index: -1,
});

export class EventRing {
  readonly capacity: number;
  readonly slots: QueuedEvent[];
  /** Game time (runtime.time) when each slot was filled. */
  readonly times: Float64Array;
  /** landed: the iceberg was in water (ocean or afloat) after the step. */
  readonly wet: Uint8Array;
  /** Slots filled since the last clear(). */
  count = 0;
  /** Events lost to a full ring since the last clear(). */
  overflow = 0;
  /** Set by the bridge each animation frame (coalescing is per frame). */
  frame = 0;
  disabled = false;
  errors = 0;
  /** Events seen in all (the trace's join key is the per-event seq). */
  private seq = 0;
  /** The kind first seen for each obstacle id (the gone-body 'rockSmall' fallback). */
  private readonly kinds = new Map<number, ObstacleKind>();
  private readonly bodies: BodySource | null;

  constructor(
    private readonly rt: GameRuntime,
    capacity: number = GLOBAL_LIMITS.eventRing,
    private readonly onError: (err: unknown, disabled: boolean) => void = () => {},
  ) {
    this.capacity = capacity;
    this.slots = Array.from({ length: capacity }, emptySlot);
    this.times = new Float64Array(capacity);
    this.wet = new Uint8Array(capacity);
    this.bodies = hasBodies(rt.physics) ? rt.physics : null;
  }

  /** The session listener (pass it to rt.events.on). Never throws. */
  readonly listener = (e: GameEvent): void => {
    if (this.disabled) return;
    try {
      this.push(e);
    } catch (err) {
      this.errors++;
      if (this.errors >= MAX_RING_ERRORS) this.disabled = true;
      this.onError(err, this.disabled);
    }
  };

  /** Forget the frame's events (the resolver calls it after reading them). */
  clear(): void {
    this.count = 0;
    this.overflow = 0;
  }

  /** The body behind an id, if the world can say. */
  body(id: number): AudioBodyView | undefined {
    return id >= 0 ? this.bodies?.getBody(id) : undefined;
  }

  private push(e: GameEvent): void {
    let i = this.count;
    if (i >= this.capacity) {
      this.overflow++;
      i = this.victim(e);
      if (i < 0) return;
    } else {
      this.count++;
    }
    this.fill(i, e);
  }

  /** The slot a new event may replace when the ring is full, or -1 to drop the new event. */
  private victim(e: GameEvent): number {
    const p = EVENT_PRIORITY[e.type];
    let worst = -1;
    let worstP = -1;
    let worstImpulse = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      const sp = s.type === null ? 99 : EVENT_PRIORITY[s.type];
      // Among equals keep the stronger hits: a full ring of collisions sheds the softest.
      const imp = s.type === 'collision' ? s.impulse : 0;
      if (sp > worstP || (sp === worstP && imp < worstImpulse)) {
        worst = i;
        worstP = sp;
        worstImpulse = imp;
      }
    }
    if (p < worstP) return worst;
    if (p === worstP && e.type === 'collision' && e.impulse > worstImpulse) return worst;
    return -1;
  }

  private fill(i: number, e: GameEvent): void {
    const q = this.slots[i];
    q.seq = ++this.seq;
    q.type = e.type;
    q.frame = this.frame;
    q.obstacleId = -1;
    q.placement = -1;
    q.kind = null;
    q.part = null;
    q.massT = 0;
    q.relSpeed = 0;
    q.impulse = 0;
    q.intensity = 0;
    q.drop = 0;
    q.speed = 0;
    q.amount = 0;
    q.index = -1;
    this.times[i] = this.rt.time;
    this.wet[i] = 0;
    if (e.type !== 'complete' && e.type !== 'failed') {
      q.x = e.pos.x;
      q.y = e.pos.y;
      q.z = e.pos.z;
    } else {
      q.x = this.rt.iceberg.pos.x;
      q.y = this.rt.iceberg.pos.y;
      q.z = this.rt.iceberg.pos.z;
    }
    switch (e.type) {
      case 'collision':
        q.relSpeed = e.relSpeed;
        q.impulse = e.impulse;
        this.readBody(q, e.obstacleId, e.kind);
        break;
      case 'obstacleBroken':
        this.readBody(q, e.obstacleId, e.kind);
        break;
      case 'treeFelled':
        this.readBody(q, e.obstacleId, null);
        break;
      case 'absorbed':
        q.obstacleId = e.obstacleId;
        q.kind = 'iceBlock';
        q.massT = e.mass;
        break;
      case 'splash':
        q.intensity = e.intensity;
        break;
      case 'landed': {
        q.drop = e.drop;
        q.speed = e.speed;
        const ice = this.rt.iceberg;
        q.massT = ice.mass;
        this.wet[i] = ice.inOcean || ice.afloat === true ? 1 : 0;
        break;
      }
      case 'airborne':
        q.speed = e.speed;
        break;
      case 'waterfallCrossed':
        q.index = e.index;
        break;
      case 'enteredOcean':
        q.massT = this.rt.iceberg.mass;
        break;
      case 'iceChipped':
        q.amount = e.amount;
        q.massT = e.chunkMass;
        break;
      case 'complete':
      case 'failed':
        break;
    }
  }

  /** Placement (of the original body), part and mass at listen time; the kind with its fallback. */
  private readBody(q: QueuedEvent, id: number, kind: ObstacleKind | null): void {
    q.obstacleId = id;
    const b = this.body(id);
    if (b) {
      const origin = b.originId === b.id ? b : (this.body(b.originId) ?? b);
      q.placement = origin.placement;
      q.part = b.part;
      q.massT = b.mass;
      q.kind = b.kind;
    } else {
      // No body to ask: a gone body reports 'rockSmall', so trust what was seen of this id before.
      q.kind = kind === 'rockSmall' || kind === null ? (this.kinds.get(id) ?? kind) : kind;
    }
    if (q.kind !== null && !this.kinds.has(id)) this.kinds.set(id, q.kind);
  }
}
