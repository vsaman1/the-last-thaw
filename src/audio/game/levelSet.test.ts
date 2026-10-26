import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../core/levels';
import { CHAPTERS } from '../../story/chapters';
import { storyLevel } from '../../story/storyLevel';
import {
  BANK_BUDGET_BYTES,
  CARD_MOTIF,
  CHURCH_BELLS,
  KIND_SOUNDS,
  REVELATION_MOTIF,
  SOUND_DEFS,
  SOUND_IDS,
  type SoundId,
} from '../contract';
import { kindsOf, levelSoundSet, soundsForKind } from './levelSet';

const bytes = (ids: readonly SoundId[]): number =>
  ids.reduce((sum, id) => sum + SOUND_DEFS[id].variants * SOUND_DEFS[id].seconds * SOUND_DEFS[id].sampleRate * 4, 0);
const core = SOUND_IDS.filter((id) => SOUND_DEFS[id].set === 'core');

describe('level sound sets', () => {
  for (const level of LEVELS) {
    it(`${level.id}: core, plus exactly what its kinds need, within the level budget`, () => {
      const set = levelSoundSet(level.id, null);
      for (const id of core) expect(set.sounds, id).toContain(id);
      const needed = new Set<SoundId>(core);
      for (const k of kindsOf(level)) for (const s of soundsForKind(k, false)) needed.add(s);
      expect(new Set(set.sounds)).toEqual(needed);
      // Every kind the level places has its hit and its break baked.
      for (const k of kindsOf(level)) {
        expect(set.sounds).toContain(KIND_SOUNDS[k].hit);
        const brk = KIND_SOUNDS[k].brk;
        if (brk) expect(set.sounds).toContain(brk);
      }
      expect(set.sounds).not.toContain('debris.settle');
      expect(set.sounds).not.toContain('piano.strings');
      expect(set.motifs).toEqual([]);
      expect(bytes(set.sounds.filter((id) => SOUND_DEFS[id].set !== 'core'))).toBeLessThanOrEqual(BANK_BUDGET_BYTES.level);
    });
  }

  it('bells only on the four church levels, two on Highland Maze, in their own voicings', () => {
    const byLevel = Object.fromEntries(LEVELS.map((l) => [l.id, levelSoundSet(l.id, null).bells]));
    for (const [id, bells] of Object.entries(byLevel)) {
      const expected = CHURCH_BELLS.filter((c) => c.levelId === id).map((c) => c.voicing);
      expect(bells, id).toEqual(expected);
    }
    expect(byLevel['highland-maze']).toEqual(['clachan-kirk', 'loch-kirk']);
    expect(Object.values(byLevel).filter((b) => b.length > 0)).toHaveLength(4);
  });

  it('Story: overlay kinds are baked, settle tails join, the chapter motifs come with them', () => {
    for (const chapter of CHAPTERS) {
      const set = levelSoundSet(chapter.levelId, chapter.id);
      const level = storyLevel(chapter);
      for (const k of kindsOf(level)) expect(set.sounds, `${chapter.id} ${k}`).toContain(KIND_SOUNDS[k].hit);
      const variants = set.motifs.map((m) => m.variant);
      expect(variants[0]).toBe(REVELATION_MOTIF[chapter.id].variant);
      expect(set.motifs[0].tempoScale).toBe(REVELATION_MOTIF[chapter.id].tempoScale);
      if (CARD_MOTIF[chapter.id]) expect(variants).toContain(CARD_MOTIF[chapter.id]);
      expect(variants.includes('epilogue')).toBe(chapter.id === 'ch9-last-thaw');
      expect(bytes(set.sounds.filter((id) => SOUND_DEFS[id].set !== 'core'))).toBeLessThanOrEqual(BANK_BUDGET_BYTES.level);
    }
    expect(levelSoundSet('riverside-town', 'ch4-people').sounds).toContain('debris.settle');
    expect(levelSoundSet('mountain-valley', 'ch1-beginning').motifs).toEqual([{ variant: 'act1', tempoScale: 1 }]);
    expect(levelSoundSet('alpine-pass', 'ch3-warning').motifs).toEqual([{ variant: 'act1', tempoScale: 0.94 }]);
    expect(levelSoundSet('highland-maze', 'ch8-remains').motifs).toEqual([{ variant: 'ch8', tempoScale: 1 }]);
  });

  it('an industrial level has its machinery; a meadow has no metal', () => {
    const power = levelSoundSet('power-valley', null).sounds;
    expect(power).toContain('metal.break.structure');
    const meadow = levelSoundSet('mountain-valley', null).sounds;
    expect(meadow.some((s) => s.startsWith('metal.'))).toBe(false);
  });
});
