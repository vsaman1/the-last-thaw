/**
 * The spatial model (DESIGN §2.5), pure and allocation-free: every function writes into an output
 * object the caller owns and returns it. The engine uses it for one-shots inside play(); package C
 * uses the same functions for continuous layers and bells, so both agree on what "far" sounds like.
 *
 *   distance gain = (refM / max(d, refM))^rolloff
 *   air low-pass  = clamp(16000·(refM/d)^0.7, 700, 16000) Hz beyond refM (16 kHz = open)
 *   pan           = panLimit·sin(azimuth), azimuth measured from the camera's horizontal forward
 */
import { AIR_LOWPASS, type ListenerPose, type SpatialProfile } from './contract';

export interface SpatialOut {
  /** Straight-line distance from the listener (m). */
  distM: number;
  gain: number;
  lowpassHz: number;
  pan: number;
  /** Beyond the profile's maxM: do not play. */
  culled: boolean;
}

export const createSpatialOut = (): SpatialOut => ({ distM: 0, gain: 1, lowpassHz: AIR_LOWPASS.hzAtRef, pan: 0, culled: false });

/** A listener at the origin facing -z (three.js's default camera), right = +x. */
export const createListenerPose = (): ListenerPose => ({ px: 0, py: 0, pz: 0, rightX: 1, rightZ: 0, fwdX: 0, fwdZ: -1 });

export function distanceGain(distM: number, profile: SpatialProfile): number {
  const d = Math.max(distM, profile.refM);
  return Math.pow(profile.refM / d, profile.rolloff);
}

/** Air absorption: open (16 kHz) inside refM, then falling with distance to a 700 Hz floor. */
export function airLowpassHz(distM: number, refM: number): number {
  if (!(distM > refM)) return AIR_LOWPASS.hzAtRef;
  const hz = AIR_LOWPASS.hzAtRef * Math.pow(refM / distM, AIR_LOWPASS.exponent);
  return Math.min(AIR_LOWPASS.hzAtRef, Math.max(AIR_LOWPASS.minHz, hz));
}

/** panLimit·sin(azimuth): the horizontal offset along the listener's right vector over the distance. */
export function panFor(pose: Readonly<ListenerPose>, x: number, z: number, panLimit: number): number {
  const dx = x - pose.px;
  const dz = z - pose.pz;
  const h = Math.hypot(dx, dz);
  if (h < 1e-6) return 0;
  const s = (dx * pose.rightX + dz * pose.rightZ) / h;
  return panLimit * Math.max(-1, Math.min(1, s));
}

/** Everything one positional sound needs, written into `out`. */
export function spatialize(
  pose: Readonly<ListenerPose>,
  x: number,
  y: number,
  z: number,
  profile: SpatialProfile,
  out: SpatialOut,
): SpatialOut {
  const d = Math.hypot(x - pose.px, y - pose.py, z - pose.pz);
  out.distM = d;
  out.culled = d > profile.maxM;
  out.gain = distanceGain(d, profile);
  out.lowpassHz = airLowpassHz(d, profile.refM);
  out.pan = panFor(pose, x, z, profile.panLimit);
  return out;
}

/**
 * The camera pose from a three.js matrixWorld (column-major elements): position 12–14, right = the
 * x axis (0, 2), forward = -z axis (-(8), -(10)), both flattened to the horizontal and normalised. A
 * degenerate axis (camera looking straight down its own axis) keeps the previous value.
 */
export function listenerFromMatrix(e: ArrayLike<number>, out: ListenerPose): ListenerPose {
  out.px = e[12];
  out.py = e[13];
  out.pz = e[14];
  const rl = Math.hypot(e[0], e[2]);
  if (rl > 1e-6) {
    out.rightX = e[0] / rl;
    out.rightZ = e[2] / rl;
  }
  const fl = Math.hypot(e[8], e[10]);
  if (fl > 1e-6) {
    out.fwdX = -e[8] / fl;
    out.fwdZ = -e[10] / fl;
  }
  return out;
}

/** Straight-line distance from the listener. */
export const distanceTo = (pose: Readonly<ListenerPose>, x: number, y: number, z: number): number =>
  Math.hypot(x - pose.px, y - pose.py, z - pose.pz);

export function copyPose(from: Readonly<ListenerPose>, to: ListenerPose): ListenerPose {
  to.px = from.px;
  to.py = from.py;
  to.pz = from.pz;
  to.rightX = from.rightX;
  to.rightZ = from.rightZ;
  to.fwdX = from.fwdX;
  to.fwdZ = from.fwdZ;
  return to;
}
