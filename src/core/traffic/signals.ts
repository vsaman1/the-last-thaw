import { NETWORK_TUNING, type TrafficJunction } from './network';

/**
 * Traffic-light states: a pure function of the junction and the traffic clock, so the vehicles
 * (src/core/traffic/traffic.ts) and the lamps the renderer lights always agree. Each signal phase
 * runs green → amber → all-red in turn; the junction's offset staggers neighbouring lights.
 */

export type SignalState = 'green' | 'amber' | 'red';

/** State of signal phase `group` at junction `j` at traffic time t (s). Unsignalised: green. */
export function signalState(j: TrafficJunction, group: number, t: number): SignalState {
  if (!j.signalised || group < 0 || !(j.cycle > 0)) return 'green';
  let tc = (t + j.offset) % j.cycle;
  if (tc < 0) tc += j.cycle;
  const { amber, allRed } = NETWORK_TUNING;
  for (let g = 0; g < j.groups; g++) {
    const green = j.greens[g];
    if (tc < green) return g === group ? 'green' : 'red';
    tc -= green;
    if (tc < amber) return g === group ? 'amber' : 'red';
    tc -= amber;
    if (tc < allRed) return 'red';
    tc -= allRed;
  }
  return 'red';
}

/** Seconds until phase `group` next turns green (0 while it is green). */
export function timeToGreen(j: TrafficJunction, group: number, t: number): number {
  if (signalState(j, group, t) === 'green') return 0;
  const { amber, allRed } = NETWORK_TUNING;
  let start = 0;
  for (let g = 0; g < group; g++) start += j.greens[g] + amber + allRed;
  let tc = (t + j.offset) % j.cycle;
  if (tc < 0) tc += j.cycle;
  return (start - tc + j.cycle) % j.cycle;
}
