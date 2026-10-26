/**
 * The intro's calving (DESIGN §6.4, P1): the iceberg cracking out of the glacier is the first thing
 * every attempt hears. Read from the session's own intro clock, like the renderers (calvingClock.ts):
 *
 *   shudder  → ice.calve.groan (the full calving only: friction in the ice, a 1.3 s swell)
 *   break    → ice.calve.crack (the high "pew" of lake ice and a low thud)
 *   landing  → ice.land.ground at m 0.7
 *
 * The short beat (Retry, Replay, Skip intros) keeps only the crack and the landing: it is heard on
 * every retry, so it stays small. A key the clock has jumped past (Space during the calving) is
 * skipped, never played late; each fires at most once per attempt. One preallocated request: nothing
 * is allocated per frame. Audio only listens: this reads the runtime and writes nothing to it.
 */
import type { GameRuntime } from '../../core/runtime';
import { INTRO_TIMING, calvingTimeAt } from '../../core/intro';
import { calvingKeys, type CalvingKeys } from '../../core/glacier/calving';
import { EVENT_MAG, GLOBAL_LIMITS, SOUND_DEFS, type SessionAudio, type SoundId, type SoundRequest } from '../contract';
import { landingLevelDb } from './magnitude';

/** A key more than this far behind the clock (a skip, a hitch) is dropped, not played late. */
export const CALVING_LATE_SEC = 0.3;
/** Open filter: the calving recipes carry their own tone. */
const OPEN_LOWPASS = 16000;

type Beat = 'groan' | 'crack' | 'land';

const BEATS: readonly { beat: Beat; sound: SoundId; at: keyof CalvingKeys; level: () => number; fullOnly: boolean }[] = [
  { beat: 'groan', sound: 'ice.calve.groan', at: 'shudderFrom', level: () => EVENT_MAG.calveGroanDb, fullOnly: true },
  { beat: 'crack', sound: 'ice.calve.crack', at: 'breakAt', level: () => EVENT_MAG.calveCrackDb, fullOnly: false },
  { beat: 'land', sound: 'ice.land.ground', at: 'landAt', level: () => landingLevelDb(EVENT_MAG.calveLandM), fullOnly: false },
];

function makeRequest(): SoundRequest {
  return {
    family: 'calve',
    priority: 1,
    layerCount: 0,
    layers: Array.from({ length: GLOBAL_LIMITS.maxLayers }, () => ({
      sound: 'ice.calve.crack' as SoundId,
      variant: -1,
      gainDb: -60,
      rate: 1,
      lowpassHz: OPEN_LOWPASS,
      delaySec: 0,
      optional: false,
    })),
    positional: true,
    x: 0,
    y: 0,
    z: 0,
    key: -1,
    cause: -1,
    startDelaySec: 0,
  };
}

export class CalvingSounds {
  /** Beats played (tests and the trace); a skipped beat is in `skipped`. */
  readonly played: Beat[] = [];
  readonly skipped: Beat[] = [];
  private readonly done = new Set<Beat>();
  private keys: CalvingKeys = calvingKeys(INTRO_TIMING.calving);
  private readonly req = makeRequest();

  constructor(
    private readonly rt: GameRuntime,
    private readonly session: SessionAudio,
  ) {}

  /** Once per frame (not while loading). */
  frame(): void {
    const rt = this.rt;
    if (this.done.size === BEATS.length) return;
    const tl = rt.introTimeline;
    if (tl.calving <= 0) return;
    if (rt.phase !== 'intro') {
      // Play began (or the attempt ended) with beats still to come: they never will.
      for (const b of BEATS) if (!this.done.has(b.beat)) this.skip(b.beat);
      return;
    }
    if (this.keys.duration !== tl.calving) this.keys = calvingKeys(tl.calving);
    const t = calvingTimeAt(tl, rt.introTime);
    if (!(t > 0)) return; // still on the flyover
    const full = tl.kind === 'full';
    for (const b of BEATS) {
      if (this.done.has(b.beat)) continue;
      if (b.fullOnly && !full) {
        this.skip(b.beat);
        continue;
      }
      const at = this.keys[b.at];
      if (t < at) continue;
      if (t - at > CALVING_LATE_SEC) this.skip(b.beat);
      else this.play(b.beat, b.sound, b.level());
    }
  }

  private play(beat: Beat, sound: SoundId, gainDb: number): void {
    this.done.add(beat);
    this.played.push(beat);
    const req = this.req;
    const ice = this.rt.iceberg;
    // One family for the three beats (the landing's layer inherits it): once per attempt, 3 voices.
    req.family = 'calve';
    req.priority = SOUND_DEFS['ice.calve.crack'].priority;
    req.layerCount = 1;
    req.x = ice.pos.x;
    req.y = ice.pos.y;
    req.z = ice.pos.z;
    // The valley's echo: a bigger send than the act's one-shots (ChapterMix.calveSend).
    req.send = this.session.info.mix.calveSend;
    const l = req.layers[0];
    l.sound = sound;
    l.variant = -1;
    l.gainDb = gainDb;
    l.rate = 1;
    l.lowpassHz = OPEN_LOWPASS;
    l.delaySec = 0;
    l.optional = false;
    this.session.play(req);
  }

  private skip(beat: Beat): void {
    this.done.add(beat);
    this.skipped.push(beat);
  }
}
