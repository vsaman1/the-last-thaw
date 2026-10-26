import { describe, expect, it } from 'vitest';
import { getLevel, LEVELS } from '../levels';
import type { CourseCoord } from '../types';
import { describeStops, longStops, MAX_STANDSTILL, measureVehicleFlow } from '../testing/vehicleFlow';

/**
 * What the player sees of the road vehicles, in the real physics world of every level (two minutes,
 * the level's own seed): no two vehicles ever stand inside each other, and the traffic keeps moving
 * (no driving vehicle stands still longer than a red light and its queue).
 *
 * The student's playtest of 2026-10-24: "the cars at level three are still stuck together". On Alpine
 * Pass a car was placed 2.1 m inside the summit car park's bus (where the run starts), and within two
 * minutes all 14 driving vehicles stood still for good, queued nose to tail 1.7–2.0 m apart: mountain
 * roads steeper than 1.2 m in 3 m read as a broken bridge deck, the pass road's ends ran 31–36 m up the
 * valley walls, a traffic light stood beside a turn, and glacier ice lies across the gorge road. In a
 * real run the iceberg's own meltwater river across the roads stopped cars for good too. Riverside
 * Town and Power Valley jammed at junctions a few metres apart, where the lane between them was shorter
 * than a car needs to clear the junction; in Riverside Town, Glacier Avalanche and chapter 7 a car
 * drove up to a house, a chalet or a parked minibus standing in its lane and stayed there.
 */

describe('Alpine Pass: the cars are not stuck together', () => {
  it('no two vehicles overlap, and every driving vehicle keeps moving', async () => {
    const level = getLevel('alpine-pass');
    const r = await measureVehicleFlow(level);
    const gaps = Object.entries(r.minGap).map(([t, g]) => `${t} s: ${g.toFixed(2)} m`);
    const moving = Object.entries(r.moving).map(([t, k]) => `${t} s: ${k}`);
    console.log(
      `[alpine pass] ${r.vehicles} vehicles, ${r.driving} driving; smallest footprint gap ` +
        `${gaps.join(', ')}; moving ${moving.join(', ')}; longest standstill ` +
        `${Math.max(...r.stops.map((s) => s.longest)).toFixed(1)} s`,
    );
    expect(r.overlaps, JSON.stringify(r.overlaps.slice(0, 5))).toEqual([]);
    for (const t of [0, 10, 30, 60]) expect(r.minGap[t], `at ${t} s`).toBeGreaterThan(0.5);
    expect(r.driving).toBeGreaterThanOrEqual(10);
    expect(longStops(r), describeStops(r, MAX_STANDSTILL)).toEqual([]);
    expect(r.moving[60]).toBeGreaterThanOrEqual(Math.ceil(r.driving * 0.75));
    // Every driving vehicle gets somewhere (the ones that jammed drove 55–100 m, then stood).
    for (const s of r.stops) expect(s.driven, `#${s.placement} ${s.kind}`).toBeGreaterThan(300);
  }, 180_000);

  it('in a real run too: the iceberg’s river across the roads turns cars round, no queue', async () => {
    // The line crosses the pass road at the summit and runs down the hairpin road: its meltwater
    // (0.07–0.15 m over the road) stops the cars there. They used to stand at the water for the rest
    // of the run (43.7 s by the finish), the cars behind them queued; now they turn round.
    const level = getLevel('alpine-pass');
    const r = await measureVehicleFlow(level, { play: true });
    const longest = Math.max(...r.stops.map((s) => s.longest));
    console.log(
      `[alpine pass, the line] ${r.phase} after ${r.seconds.toFixed(1)} s; moving ` +
        `${Object.entries(r.moving).map(([t, k]) => `${t} s: ${k}`).join(', ')} of ${r.driving}; ` +
        `longest standstill ${longest.toFixed(1)} s`,
    );
    expect(r.phase).toBe('complete');
    expect(r.overlaps, JSON.stringify(r.overlaps.slice(0, 5))).toEqual([]);
    expect(longest, describeStops(r, 20)).toBeLessThan(20);
    expect(r.moving[60]).toBeGreaterThanOrEqual(Math.ceil(r.driving * 0.75));
  }, 180_000);

  it('on the gorge route: no car turns round into the bus the iceberg knocks onto the pass road', async () => {
    // Playtest round 2 review: the iceberg hits the summit bus at 9.4 m/s (t 7.3 s), which lands on its
    // side across the pass road; the pass-road car stopped 2.2 m short, then turned round into it (0.67
    // m deep, the box test on both collider boxes) and back and forth every ~9 s: inside it 32 of the
    // run's 81 s, 144 overlap samples, standing 58.4 s. Its turn-round now needs room for its box all
    // the way round; with none it parks after TRAFFIC_TUNING.giveUpAfter s.
    const level = getLevel('alpine-pass');
    const r = await measureVehicleFlow(level, { route: ALPINE_GORGE, seconds: 150 });
    const longest = Math.max(...r.stops.map((s) => s.longest));
    const parked = r.stops.filter((s) => s.gaveUp).map((s) => `#${s.placement} ${s.kind}`);
    console.log(
      `[alpine pass, the gorge route] ${r.phase} after ${r.seconds.toFixed(1)} s; overlaps ` +
        `${r.overlaps.length}; longest standstill ${longest.toFixed(1)} s; parked: ${parked.join(', ')}`,
    );
    expect(r.phase).toBe('complete');
    expect(r.overlaps, JSON.stringify(r.overlaps.slice(0, 5))).toEqual([]);
    expect(longStops(r), describeStops(r, MAX_STANDSTILL)).toEqual([]);
  }, 180_000);
});

/** alpinePass.test.ts's gorge route: the old road down the right side, under the viaduct. */
const ALPINE_GORGE: CourseCoord[] = (() => {
  const line = getLevel('alpine-pass').line ?? [];
  const pts = ([] as [number, number][]).concat(
    [[60, 8], [100, 40], [160, 58], [200, 85], [240, 112], [265, 119], [690, 119], [740, 125]],
    [[760, 126], [800, 140], [850, 160], [1000, 168], [1040, 150], [1100, 128], [1150, 90]],
    [[1178, 85], [1300, 80], [1420, 75]],
  );
  return [
    ...line.filter((p) => p.s < 31),
    ...pts.map(([s, d]) => ({ s, d })),
    ...line.filter((p) => p.s > 1430),
  ];
})();

/** riversideTown.test.ts's viaduct route: Gorge Road over the viaduct, Mill Race Road, the dam. */
const RIVERSIDE_VIADUCT: CourseCoord[] = (() => {
  const line = getLevel('riverside-town').line ?? [];
  const pts: [number, number][] = [[680, -42], [702, -50], [760, -50], [795, -50], [830, -48]];
  return [
    ...line.filter((p) => p.s <= 638),
    ...pts.map(([s, d]) => ({ s, d })),
    { s: 860, d: -36 },
    { s: 1000, d: -36 },
    ...line.filter((p) => p.s >= 1080),
  ];
})();

describe('Riverside Town in a real run: the debris at Main Street does not hold a queue for good', () => {
  // Playtest round 2 review: on the line the iceberg ploughs through the house row and knocks a wall of
  // house #21 into the s 400 crossroads; car #41 stood 49.9 s inside its junction turn before it (no
  // turn-round from a turn), and four more queued 23–46 s. A vehicle with no way round now parks after
  // TRAFFIC_TUNING.giveUpAfter s, and the ones behind it turn round.
  for (const [name, route] of [
    ['the line', undefined],
    ['the viaduct route', RIVERSIDE_VIADUCT],
  ] as const) {
    it(name, async () => {
      const level = getLevel('riverside-town');
      const r = await measureVehicleFlow(level, { play: true, route, seconds: 150 });
      const longest = Math.max(...r.stops.map((s) => s.longest));
      const parked = r.stops.filter((s) => s.gaveUp).map((s) => `#${s.placement} ${s.kind}`);
      console.log(
        `[riverside town, ${name}] ${r.phase} after ${r.seconds.toFixed(1)} s; overlaps ` +
          `${r.overlaps.length}; longest standstill ${longest.toFixed(1)} s; parked: ${parked.join(', ')}`,
      );
      expect(r.phase).toBe('complete');
      expect(r.overlaps, JSON.stringify(r.overlaps.slice(0, 5))).toEqual([]);
      expect(longStops(r), describeStops(r, MAX_STANDSTILL)).toEqual([]);
    }, 180_000);
  }
});

describe('every level: no overlapping vehicles, traffic that keeps moving', () => {
  for (const level of LEVELS) {
    it(level.name, async () => {
      const r = await measureVehicleFlow(level);
      const stuck = describeStops(r, MAX_STANDSTILL);
      if (r.driving > 0) {
        const longest = Math.max(...r.stops.map((s) => s.longest));
        console.log(
          `[${level.id}] ${r.vehicles} vehicles, ${r.driving} driving; moving at 60 s ${r.moving[60]}, ` +
            `at 120 s ${r.moving[120]}; longest standstill ${longest.toFixed(1)} s`,
        );
      }
      expect(r.overlaps, JSON.stringify(r.overlaps.slice(0, 5))).toEqual([]);
      expect(longStops(r), stuck).toEqual([]);
    }, 180_000);
  }
});
