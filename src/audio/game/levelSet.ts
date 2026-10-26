/**
 * What a level needs baked before it is played (DESIGN §6.1 slicing, contract LevelSoundSet): the core
 * sounds, the hits and breaks of every kind the level (and its Story overlay) places, the bell of
 * every church in it, and in Story the chapter's motifs. The director asks for it as soon as a level
 * or a chapter is chosen, so the bake runs on the menus and the chapter card, not during play.
 */
import { getLevel } from '../../core/levels';
import type { LevelDef, ObstacleKind } from '../../core/types';
import { chapterById } from '../../story/chapters';
import { storyLevel } from '../../story/storyLevel';
import type { ChapterId } from '../../story/types';
import {
  CARD_MOTIF,
  EPILOGUE_MOTIF,
  KIND_SOUNDS,
  REVELATION_MOTIF,
  SOUND_DEFS,
  SOUND_IDS,
  type BellVoicingId,
  type LevelSoundSet,
  type MotifRequest,
  type SoundId,
} from '../contract';
import { churchesOf } from './bells';
import { TUMBLE_KINDS, addOnFor } from './router';

const TREE_KINDS: ReadonlySet<ObstacleKind> = new Set(['pine', 'broadleaf']);
/** Breaks that get the Story settle tail (router SETTLE_SOUNDS). */
const SETTLED: ReadonlySet<SoundId> = new Set(['house.collapse', 'timber.collapse', 'masonry.collapse.small', 'masonry.collapse.large']);
/** The chapter the epilogue follows: its set bakes the epilogue's motif too. */
export const LAST_CHAPTER: ChapterId = 'ch9-last-thaw';

/** Every sound a kind can make (what the resolver may ask for when it is hit or breaks). */
export function soundsForKind(kind: ObstacleKind, story: boolean): SoundId[] {
  const k = KIND_SOUNDS[kind];
  const out: SoundId[] = [k.hit];
  if (k.hitHeavy) out.push(k.hitHeavy);
  if (k.paneAbove !== null) out.push('glass.pane');
  if (k.brk) {
    out.push(k.brk, ...k.brkLayers);
    const addOn = addOnFor(k.brk);
    if (addOn) out.push(addOn);
    if (story && SETTLED.has(k.brk)) out.push('debris.settle');
  } else {
    // A kind without a break of its own is heard breaking as its hardest hit.
    if (k.hitHeavy) out.push(k.hitHeavy);
  }
  if (kind === 'stoneBarrier') out.push('stone.scatter');
  // Rocks and barrier stones knocked moving tumble away (rule F6b).
  if (TUMBLE_KINDS.has(kind)) out.push('stone.tumble');
  if (kind === 'iceBlock' || kind === 'iceField') out.push('ice.absorb');
  // The third tree within a second plays only its crack.
  if (TREE_KINDS.has(kind)) out.push('timber.break.light');
  return out;
}

/** Kinds a level can contain at run time: its placements, plus traffic lights at street junctions. */
export function kindsOf(level: LevelDef): Set<ObstacleKind> {
  const kinds = new Set<ObstacleKind>(level.obstacles.map((o) => o.kind));
  if ((level.features ?? []).some((f) => f.type === 'street')) kinds.add('trafficLight');
  return kinds;
}

/** The chapter's motifs: the revelation, the chapter card (ch8) and, after the last chapter, the epilogue. */
export function motifsFor(chapterId: ChapterId): MotifRequest[] {
  const out: MotifRequest[] = [REVELATION_MOTIF[chapterId]];
  const card = CARD_MOTIF[chapterId];
  if (card) out.push({ variant: card, tempoScale: 1 });
  if (chapterId === LAST_CHAPTER) out.push({ variant: EPILOGUE_MOTIF, tempoScale: 1 });
  const seen = new Set<string>();
  return out.filter((m) => {
    const key = `${m.variant}@${m.tempoScale}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The bake set for a level in Arcade (chapterId null) or for a chapter's story level. */
export function levelSoundSet(levelId: string, chapterId: ChapterId | null): LevelSoundSet {
  const chapter = chapterId ? chapterById(chapterId) : undefined;
  const level = chapter ? storyLevel(chapter) : getLevel(levelId);
  return soundSetOf(level, chapter ? chapter.id : null);
}

export function soundSetOf(level: LevelDef, chapterId: ChapterId | null): LevelSoundSet {
  const story = chapterId !== null;
  const wanted = new Set<SoundId>();
  for (const id of SOUND_IDS) if (SOUND_DEFS[id].set === 'core') wanted.add(id);
  for (const kind of kindsOf(level)) for (const s of soundsForKind(kind, story)) wanted.add(s);
  const sounds = SOUND_IDS.filter((id) => wanted.has(id));
  const bells: BellVoicingId[] = [...new Set(churchesOf(level).map((c) => c.voicing))];
  return { sounds, bells, motifs: chapterId ? motifsFor(chapterId) : [] };
}
