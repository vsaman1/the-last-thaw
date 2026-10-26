import { describe, expect, it } from 'vitest';
import type { GameEvent, ObstacleKind } from '../../core/types';
import { chapterById } from '../../story/chapters';
import type { ScoredBody } from '../../story/scoring';
import { landmarkIndex, storyLevel } from '../../story/storyLevel';
import type { ChapterId } from '../../story/types';
import { CHAPTER_MIX, DUCK_PRESETS, MOMENT_TIMING, type SessionAudioInfo } from '../contract';
import { RecordingRouter, RecordingSessionAudio } from '../game/testing/recording';
import { StoryAudio } from './storyAudio';

function setup(chapterId: ChapterId, narrative = true) {
  const chapter = chapterById(chapterId)!;
  const level = storyLevel(chapter);
  const mix = CHAPTER_MIX[chapterId];
  const info: SessionAudioInfo = { levelId: 'riverside-town', mode: 'story', chapterId, attempt: 1, mix };
  const session = new RecordingSessionAudio(1, info);
  const music = new RecordingRouter();
  const bodies = new Map<number, ScoredBody>();
  const clock = { t: 0 };
  const story = new StoryAudio(session, { chapter, level, mix, narrative, music, lookup: (id) => bodies.get(id), time: () => clock.t });
  /** A body of placement p (its id is 1000 + p) breaking at time t. */
  const fall = (p: number, kind: ObstacleKind, t: number): void => {
    const id = 1000 + p;
    bodies.set(id, { id, originId: id, kind, placement: p });
    clock.t = t;
    const e: GameEvent =
      kind === 'pine' ? { type: 'treeFelled', obstacleId: id, pos: { x: 0, y: 0, z: 0 } } : { type: 'obstacleBroken', obstacleId: id, kind, pos: { x: 0, y: 0, z: 0 } };
    story.listener(e);
  };
  const at = (t: number, phase: 'playing' | 'intro' | 'complete' = 'playing') => {
    clock.t = t;
    story.tick(phase);
  };
  const ducks = (key: string) => session.ducks.filter((d) => d.key === key);
  return { chapter, session, music, story, fall, at, ducks, mix };
}

describe('Story ducks inside an attempt', () => {
  it('a landmark lowers the music (−10 dB), not the ordinary breath', () => {
    const { chapter, fall, at, ducks } = setup('ch4-people');
    const [placement] = [...landmarkIndex(chapter).entries()].find(([, id]) => id === 'vey-house')!;
    fall(placement, 'house', 10);
    at(10.5);
    expect(ducks('landmark')).toHaveLength(1);
    expect(ducks('landmark')[0].levels).toEqual(DUCK_PRESETS.landmark.story);
    expect(ducks('aftermath')).toHaveLength(0);
  });

  it('a church lowers it most, once, whether its nave breaks or its bell falls silent', () => {
    const { fall, story, ducks } = setup('ch4-people');
    fall(44, 'church', 5);
    story.churchSilenced(44);
    fall(44, 'church', 6);
    expect(ducks('church')).toHaveLength(1);
    expect(ducks('church')[0].levels).toEqual({ music: -14, ambience: -3, effects: 0 });
  });

  it('a loss of 100 points or more breathes 0.3 s later at the chapter depth; smaller ones do not', () => {
    const { fall, at, ducks, mix } = setup('ch6-price');
    fall(900, 'pine', 1); // 5 points
    fall(901, 'fence', 1); // 10 points
    at(2);
    expect(ducks('aftermath')).toHaveLength(0);
    fall(902, 'factoryHall', 3);
    at(3.2);
    expect(ducks('aftermath')).toHaveLength(0);
    at(3.31);
    expect(ducks('aftermath')).toHaveLength(1);
    expect(ducks('aftermath')[0].levels?.music).toBe(mix.aftermathDb);
    expect(mix.aftermathDb).toBe(-6);
  });

  it('each significant loss deepens the scar, up to the act cap', () => {
    const { fall, ducks, mix, story } = setup('ch7-escape');
    for (let i = 0; i < 12; i++) fall(800 + i, 'house', i * 20);
    const scars = ducks('scar').map((d) => d.levels?.music);
    expect(scars[0]).toBe(-mix.scarDb);
    expect(Math.min(...(scars as number[]))).toBe(-mix.scarMaxDb);
    expect(story.scar).toBe(mix.scarMaxDb);
    // Once at the cap, no further duck calls.
    expect(scars.filter((s) => s === -mix.scarMaxDb)).toHaveLength(1);
  });

  it('the sea takes the music down only in chapter 9', () => {
    for (const [id, n] of [
      ['ch9-last-thaw', 1],
      ['ch8-remains', 0],
    ] as const) {
      const { story, ducks } = setup(id);
      story.listener({ type: 'enteredOcean', pos: { x: 0, y: 0, z: 0 } });
      story.listener({ type: 'enteredOcean', pos: { x: 0, y: 0, z: 0 } });
      expect(ducks('seaCh9'), id).toHaveLength(n);
    }
  });

  it('Act III: no music over the flyover; it enters after the caption (or 3 s with narrative off)', () => {
    for (const narrative of [true, false]) {
      const { music, at, ducks, story } = setup('ch8-remains', narrative);
      expect(music.holds.has('act3Entry')).toBe(true);
      at(1, 'intro');
      at(20, 'intro');
      expect(music.holds.has('act3Entry')).toBe(true);
      at(21);
      const wait = narrative ? MOMENT_TIMING.captionSec : MOMENT_TIMING.act3EntryNoCaptionSec;
      at(21 + wait - 0.05);
      expect(music.holds.has('act3Entry')).toBe(true);
      at(21 + wait + 0.01);
      expect(music.holds.has('act3Entry')).toBe(false);
      expect(ducks('act3Entry')).toEqual([{ key: 'act3Entry', levels: DUCK_PRESETS.act3Entry.story, frame: 0 }]);
      story.dispose();
      expect(music.calls.filter((c) => c === 'release act3Entry')).toHaveLength(1);
    }
  });

  it('Acts I and II have no late entry; leaving mid-caption lets the hold go', () => {
    expect(setup('ch1-beginning').music.holds.size).toBe(0);
    const { music, story } = setup('ch9-last-thaw');
    story.dispose();
    expect(music.holds.size).toBe(0);
  });
});
