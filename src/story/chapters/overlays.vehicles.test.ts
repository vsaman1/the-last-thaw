/**
 * The road vehicles of every Story Mode level (base level + the chapter's overlay), in the real physics
 * world for two minutes: no two vehicles ever stand inside each other, and the traffic keeps moving.
 * The same check as src/core/physics/vehicleFlow.physics.test.ts on the arcade levels; overlays add
 * vehicles (chapter 3's coach in the village car park, chapter 7's minibus...), so they are checked too.
 * Chapter 3 is Alpine Pass, the student's "the cars at level three are still stuck together".
 */
import { describe, expect, it } from 'vitest';
import { describeStops, longStops, MAX_STANDSTILL, measureVehicleFlow } from '../../core/testing/vehicleFlow';
import { storyLevel } from '../storyLevel';
import { CHAPTERS } from './index';

describe('story levels: no overlapping vehicles, traffic that keeps moving', () => {
  for (const ch of CHAPTERS) {
    it(`${ch.id} (${ch.levelId})`, async () => {
      const r = await measureVehicleFlow(storyLevel(ch));
      const stuck = describeStops(r, MAX_STANDSTILL);
      if (r.driving > 0) {
        const longest = Math.max(...r.stops.map((s) => s.longest));
        console.log(
          `[${ch.id}] ${r.vehicles} vehicles, ${r.driving} driving; moving at 60 s ${r.moving[60]}, ` +
            `at 120 s ${r.moving[120]}; longest standstill ${longest.toFixed(1)} s`,
        );
      }
      expect(r.overlaps, JSON.stringify(r.overlaps.slice(0, 5))).toEqual([]);
      expect(longStops(r), stuck).toEqual([]);
    }, 180_000);
  }
});
