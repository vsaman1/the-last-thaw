import type { LevelDef } from '../types';
import { alpinePass } from './alpinePass';
import { glacierAvalanche } from './glacierAvalanche';
import { highlandMaze } from './highlandMaze';
import { level1 } from './level1';
import { powerValley } from './powerValley';
import { ravineRun } from './ravineRun';
import { riversideTown } from './riversideTown';
import { rockyCanyon } from './rockyCanyon';
import { summitLabyrinth } from './summitLabyrinth';

/** All playable levels in display order. Add a level by appending its LevelDef here. */
export const LEVELS: readonly LevelDef[] = [
  level1,
  rockyCanyon,
  alpinePass,
  riversideTown,
  glacierAvalanche,
  powerValley,
  ravineRun,
  highlandMaze,
  summitLabyrinth,
];

export function getLevel(id: string): LevelDef {
  const l = LEVELS.find((lv) => lv.id === id);
  if (!l) throw new Error(`Unknown level: ${id}`);
  return l;
}
