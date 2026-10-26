/**
 * STORY MODE: the world's condition (./environment.ts) in plain words, for the agents and for the
 * deterministic validator (./validate.ts).
 *
 * The renderer shows each chapter's land a little more worn than the last (greyer, then brown water; a
 * light haze, then a grey one; yellowing, then brown grass; bare trees; grey snow), and further still
 * when the player toppled extraction, industry and energy in earlier chapters. The agents may mention
 * that look, because the player can see it, but only as it is: `lookOf` turns the condition's channels
 * into a few named levels, the get_run_summary tool hands them over, and the validator rejects a text
 * that calls the river brown or the sky grey in a chapter whose world is not (WORLD_PATTERNS), or that
 * blames the look on the player's earlier toppling when their record added nothing to it.
 *
 * The thresholds sit where the rendered change is plain to see (src/render/worldCondition.ts blends
 * linearly by each channel). With no toll, Act I is clear in every channel, Act II has greyer water, a
 * hazy sky and yellowing grass (yellowing trees from chapter 5), and Act III has brown water, a grey
 * sky, brown grass, some bare trees and grey snow (checked chapter by chapter in worldLook.test.ts).
 * A chapter whose level shows no snow anywhere (the Red Canyon, Power Valley, the Red Mesa) has snow
 * 'none': the agents are told nothing about snow there, and any snow wording is rejected.
 * Pure and deterministic.
 */
import { getLevel } from '../core/levels';
import { levelHasSnow } from '../core/terrain/themes';
import { CHAPTERS } from './chapters';
import { worldConditionFromHistory, type TollRecord, type WorldCondition, tollPointsOf } from './environment';
import { CHAPTER_IDS, type Act, type ChapterId, type StoryBible } from './types';

export const WATER_LOOKS = ['clear', 'greyer', 'brown'] as const;
export const SKY_LOOKS = ['clear', 'hazy', 'grey'] as const;
export const GRASS_LOOKS = ['green', 'yellowing', 'brown'] as const;
export const TREE_LOOKS = ['healthy', 'yellowing', 'some bare'] as const;
/**
 * 'none': the chapter's level shows no snow anywhere (themes.ts levelHasSnow: the Red Canyon, Power
 * Valley, the Red Mesa), so there is no snow to call clean or grey.
 */
export const SNOW_LOOKS = ['none', 'clean', 'grey'] as const;
export const RECORD_LOOKS = ['none', 'a little', 'clearly'] as const;

export type WaterLook = (typeof WATER_LOOKS)[number];
export type SkyLook = (typeof SKY_LOOKS)[number];
export type GrassLook = (typeof GRASS_LOOKS)[number];
export type TreeLook = (typeof TREE_LOOKS)[number];
export type SnowLook = (typeof SNOW_LOOKS)[number];
export type RecordLook = (typeof RECORD_LOOKS)[number];

export interface WorldLook {
  readonly chapterId: ChapterId;
  readonly act: Act;
  readonly water: WaterLook;
  readonly sky: SkyLook;
  readonly grass: GrassLook;
  readonly trees: TreeLook;
  readonly snow: SnowLook;
  /** How much the player's own earlier toppling of extraction, industry and energy added to this look. */
  readonly fromYourRecord: RecordLook;
  /** The earlier chapters whose toppled extraction, industry or energy counts, in story order. */
  readonly toppledIn: readonly ChapterId[];
}

/** Where each channel's named level begins (see the module comment). */
export const LOOK_THRESHOLDS = {
  water: { greyer: 0.12, brown: 0.6 },
  sky: { hazy: 0.15, grey: 0.6 },
  /** Dry grass seen: dryness × cover; brown: the browning of what is dry. */
  grass: { yellowing: 0.08, brown: 0.25 },
  trees: { yellowing: 0.15, bare: 0.04 },
  snow: { grey: 0.08 },
  /** Severity the record added above the chapter's own arc. */
  record: { aLittle: 0.005, clearly: 0.06 },
} as const;

const T = LOOK_THRESHOLDS;

/**
 * The named look of a condition (the record's share is measured against the chapter's own arc).
 * `snowy`: whether the chapter's level shows snow at all; without any, the snow channel is 'none' (the
 * arc greys the snow of every Act III chapter, but the Red Mesa has none to grey).
 */
export function lookOf(c: WorldCondition, toppledIn: readonly ChapterId[] = [], snowy = true): WorldLook {
  const added = c.severity - Math.min(1, c.arc);
  return {
    chapterId: c.chapterId,
    act: c.act,
    water: c.water.murk >= T.water.brown ? 'brown' : c.water.murk >= T.water.greyer ? 'greyer' : 'clear',
    sky: c.air.haze >= T.sky.grey ? 'grey' : c.air.haze >= T.sky.hazy ? 'hazy' : 'clear',
    grass:
      c.grass.dry * c.grass.cover < T.grass.yellowing ? 'green' : c.grass.brown >= T.grass.brown ? 'brown' : 'yellowing',
    trees: c.trees.dead >= T.trees.bare ? 'some bare' : c.trees.fade >= T.trees.yellowing ? 'yellowing' : 'healthy',
    snow: !snowy ? 'none' : c.snow.soot >= T.snow.grey ? 'grey' : 'clean',
    fromYourRecord: added >= T.record.clearly ? 'clearly' : added >= T.record.aLittle ? 'a little' : 'none',
    toppledIn: added >= T.record.aLittle ? toppledIn : [],
  };
}

/** The look of a chapter's world given the player's earlier chapters (the agents' history). */
export function worldLookFor(chapterId: ChapterId, history: readonly TollRecord[]): WorldLook {
  const before = CHAPTER_IDS.indexOf(chapterId);
  const toppledIn = CHAPTER_IDS.filter(
    (id, i) => i < before && history.some((h) => h.chapterId === id && tollPointsOf(h) > 0),
  );
  return lookOf(worldConditionFromHistory(chapterId, history), toppledIn, chapterHasSnow(chapterId));
}

/** Whether the chapter's level shows any snow (themes.ts levelHasSnow); true for an unknown chapter. */
export function chapterHasSnow(chapterId: ChapterId): boolean {
  const chapter = CHAPTERS.find((c) => c.id === chapterId);
  return chapter ? levelHasSnow(getLevel(chapter.levelId)) : true;
}

/** The place name of a chapter (the bible location the chapter is set in), else the chapter id. */
export const placeOf = (chapterId: ChapterId, bible: Pick<StoryBible, 'locations'>): string =>
  bible.locations.find((l) => l.chapterId === chapterId)?.name ?? chapterId;

const list = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** The look in two plain sentences (what the agents read in get_run_summary's `world`). */
export function describeLook(look: WorldLook, bible: Pick<StoryBible, 'locations'>): string {
  const water = { clear: 'the rivers and streams run clear', greyer: 'the rivers and streams run greyer than they used to', brown: 'the rivers and streams run brown' }[look.water];
  const sky = { clear: 'the sky is clear', hazy: 'a light haze hangs over the valley', grey: 'a thick grey haze dulls the sky' }[look.sky];
  const grass = { green: 'the grass is green', yellowing: 'the grass is yellowing in patches', brown: 'the grass is brown' }[look.grass];
  const trees = { healthy: 'the trees are healthy', yellowing: 'some trees are yellowing', 'some bare': 'some trees stand bare' }[look.trees];
  // A level with no snow anywhere gets no snow clause (and the validator rejects any snow wording).
  const snow = { none: null, clean: 'the snow is clean', grey: 'the snow is grey with soot' }[look.snow];
  const first = `Here ${list([water, sky, grass, trees, ...(snow ? [snow] : [])])}.`;
  // Mid-sentence, "The Red Canyon" reads "the Red Canyon".
  const places = list(look.toppledIn.map((id) => placeOf(id, bible).replace(/^The /, 'the ')));
  const second =
    look.fromYourRecord === 'none'
      ? 'Nothing the player toppled in earlier chapters adds to this look.'
      : `The extraction, industry and energy the player toppled in earlier chapters (${places}) made it ${look.fromYourRecord === 'clearly' ? 'clearly' : 'a little'} worse here.`;
  return `${first} ${second}`;
}

// -------------------------------------------------------------------------------------------------
// What a text may say about the look (read by src/story/validate.ts, clause by clause)
// -------------------------------------------------------------------------------------------------

/** One way of describing the land, and the least level of its channel that makes it true. */
export interface WorldPattern {
  readonly channel: 'water' | 'sky' | 'grass' | 'trees' | 'snow';
  readonly needs: string;
  readonly re: RegExp;
  /** Set when no chapter's world is ever drawn so: why (the validator rejects it everywhere). */
  readonly never?: string;
}

const WATER_NOUN = '(?:water|waters|river|rivers|stream|streams|creek|creeks|lake|lakes|loch|harbour|port|pools?|ditch|ditches)';
/**
 * The open sea and the fjord: the renderer blends them only half as far, toward grey-green
 * (environment.ts seaDeep / seaMid / seaShallow), never brown (playtest 2 review: the authored epilogue
 * opened on a brown fjord while the fjord on screen was blue-grey).
 */
const SEA_NOUN = '(?:fjord|fjords|sea|seas)';
/** Fresh water only: a grey sea or fjord is weather, so "grey" is checked on rivers, streams and lakes. */
const FRESH_WATER_NOUN = '(?:water|waters|river|rivers|stream|streams|creek|creeks|lake|lakes|loch|pools?|ditch|ditches)';
const SKY_NOUN = '(?:sky|skies|air|horizon)';
const GRASS_NOUN = '(?:grass|grasses|pastures?|meadows?|lawns?)';
const TREE_NOUN = '(?:trees?|pines?|woods|forests?|branches|crowns|birches|firs)';
const SNOW_NOUN = '(?:snow|snowfields?)';
const VERB =
  '(?:ran|run|runs|running|was|were|is|are|turned|turns|turning|went|goes|looked|looks|stayed|stays|came|comes|flowed|flows|stood|stands|hung|hangs|had\\s+gone|has\\s+gone|had\\s+turned|has\\s+turned)';

/** "brown, oily water", "a brown glacier stream", "the river ran brown", "the stream from the glacier is brown". */
function described(adj: string, noun: string): RegExp {
  return new RegExp(
    `\\b${adj}\\b(?:[\\s,-]+(?:and\\s+)?[a-z]+){0,2}?[\\s,-]+${noun}\\b|\\b${noun}\\b[^.!?;]{0,30}?\\b${VERB}\\s+(?:still\\s+|a\\s+|so\\s+|all\\s+|quite\\s+|almost\\s+)?${adj}\\b`,
    'gi',
  );
}

export const WORLD_PATTERNS: readonly WorldPattern[] = [
  { channel: 'water', needs: 'brown', re: described('(?:brown|muddy|oily|filthy|black)', WATER_NOUN) },
  {
    channel: 'water',
    needs: 'brown',
    re: described('(?:brown|muddy|filthy)', SEA_NOUN),
    never: 'the sea and the fjord are drawn grey-green, never brown',
  },
  { channel: 'water', needs: 'greyer', re: described('(?:grey|gray|greyer|grayer|murky|murkier|cloudy|cloudier)', FRESH_WATER_NOUN) },
  { channel: 'water', needs: 'greyer', re: described('(?:dirty|dirtier|polluted|browner)', WATER_NOUN) },
  { channel: 'sky', needs: 'grey', re: described('(?:grey|gray|brown|yellow|dirty|smoky|smoggy)', SKY_NOUN) },
  { channel: 'sky', needs: 'grey', re: /\b(?:thick|heavy|grey|gray|brown|dirty)\s+haze\b|\bsmog\b/gi },
  { channel: 'sky', needs: 'hazy', re: /\bhaze\b|\bhazy\b/gi },
  { channel: 'grass', needs: 'brown', re: described('(?:brown|browned|browning|scorched)', GRASS_NOUN) },
  { channel: 'grass', needs: 'yellowing', re: described('(?:yellow|yellowed|yellowing|dry|dried|drying|parched)', GRASS_NOUN) },
  { channel: 'trees', needs: 'some bare', re: described('(?:bare|leafless|rust-brown)', TREE_NOUN) },
  { channel: 'trees', needs: 'yellowing', re: described('(?:yellow|yellowed|yellowing|fading)', TREE_NOUN) },
  { channel: 'snow', needs: 'grey', re: described('(?:grey|gray|dirty|sooty|black|brown)', SNOW_NOUN) },
  { channel: 'snow', needs: 'grey', re: /\bsoot\b[^.!?;]{0,30}\bsnow\b|\bsnow\b[^.!?;]{0,30}\bsoot\b/gi },
  // Any snow at all, where the level shows none (snow 'none'): "the snow is grey" on the Red Mesa.
  { channel: 'snow', needs: 'clean', re: /\bsnow(?:s|y|fall|fields?|line|drifts?|caps?)?\b/gi },
];

const LEVELS: Readonly<Record<WorldPattern['channel'], readonly string[]>> = {
  water: WATER_LOOKS,
  sky: SKY_LOOKS,
  grass: GRASS_LOOKS,
  trees: TREE_LOOKS,
  snow: SNOW_LOOKS,
};

/** Whether the look has at least `needs` in this channel. */
export function lookHas(look: WorldLook, channel: WorldPattern['channel'], needs: string): boolean {
  const order = LEVELS[channel];
  return order.indexOf(look[channel]) >= order.indexOf(needs);
}

/** Words that make a clause about the land's look (for the record check). */
export const WORLD_WORD = /\b(?:haze|hazy|smog|smoke|soot|sooty|brown|browner|grey|gray|greyer|murky|murkier|dirty|oily|polluted|litter|rubbish|runoff)\b/i;

/**
 * A clause that blames the look on the player's earlier toppling: "the haze is thicker here because of
 * what you toppled in Power Valley", "the river runs brown after your toppling of the plant". It needs a
 * world word, a causal link to the player breaking something, and an earlier chapter (named, or
 * "earlier chapters"); then the player's record must have added to the look, and every earlier place
 * named must be one where they toppled extraction, industry or energy.
 */
export const BLAMES_PLAYER =
  /\b(?:because(?:\s+of)?|since|after|from|thanks\s+to|left\s+by|made\s+by|caused\s+by|due\s+to)\b[^.!?;]{0,60}?\b(?:you|you've|you'd)\s+(?:had\s+|have\s+)?(?:toppled|broke|broken|brought\s+down|knocked\s+down|smashed)\b|\byour\s+(?:earlier\s+)?(?:toppling|toppled|breaking|record|toll)\b/i;
export const EARLIER_RUNS = /\b(?:earlier|previous|past|last)\s+(?:chapters?|runs?|valleys?|levels?)\b|\bbefore\s+this\s+(?:chapter|valley|run)\b/i;
