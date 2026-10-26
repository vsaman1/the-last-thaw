/**
 * Audio only listens (DESIGN §1 goal 8, §10 listenOnly): the same level, seed and autopilot, run once
 * with nothing listening and once with the whole bridge (the event ring, the resolver playing into a
 * recording session, ambience polled every frame, bell towers scanned, Story's points tracker). The
 * iceberg, the run's stats, the river and every event must come out bit for bit the same.
 */
import { describe, expect, it } from 'vitest';
import { getLevel } from '../../core/levels';
import { chapterById } from '../../story/chapters';
import { storyLevel } from '../../story/storyLevel';
import { fingerprint, runHeadless } from './testing/headless';

const SECONDS = 40;

describe('gameplay is unchanged by the sound bridge', () => {
  const ch4 = chapterById('ch4-people')!;
  const cases = [
    { name: 'mountain-valley, Arcade', level: getLevel('mountain-valley'), mode: 'arcade' as const, chapter: null },
    { name: 'riverside-town, Story chapter 4', level: storyLevel(ch4), mode: 'story' as const, chapter: ch4 },
    // With the full intro: the flyover and the calving (heard by calving.ts) come first.
    { name: 'rocky-canyon, Arcade, full intro', level: getLevel('rocky-canyon'), mode: 'arcade' as const, chapter: null, intro: 'full' as const },
  ];

  for (const c of cases) {
    it(`${c.name}: ${SECONDS} s of autopilot, bit-identical with and without audio`, async () => {
      const intro = 'intro' in c ? c.intro : undefined;
      const plain = await runHeadless({ level: c.level, seconds: SECONDS, bridge: false, intro });
      const heard = await runHeadless({ level: c.level, seconds: SECONDS, bridge: true, mode: c.mode, chapter: c.chapter, intro });
      const state = (r: typeof plain) => ({
        iceberg: r.session.iceberg,
        stats: r.session.stats,
        phase: r.session.phase,
        time: r.session.time,
        events: r.session.events.log,
        route: r.session.route,
        river: r.session.river.samples.length,
        physics: r.session.physics.stats,
      });
      expect(fingerprint(state(heard))).toBe(fingerprint(state(plain)));
      // The bridge really was listening: it heard the events and played sounds.
      expect(heard.session.events.log.length).toBeGreaterThan(5);
      expect(heard.audio!.plays.length).toBeGreaterThan(0);
      if (intro) expect(heard.bridge!.calving.played).toEqual(['groan', 'crack', 'land']);
      heard.bridge!.end();
      plain.session.dispose();
      heard.session.dispose();
    }, 180000);
  }
});
