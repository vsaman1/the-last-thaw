/**
 * Which recording plays for each music cue. All six are solo-piano recordings from Musopen, taken from
 * Wikimedia Commons, where each file page carries a licence for the RECORDING (not only the
 * composition): public domain (PD-author, Musopen, VRT ticket 2008012110017088) or CC0. Full credits
 * and links are in docs/MUSIC_CREDITS.md; a test keeps that file and this table in step.
 *
 * The arc follows the story: a bright Mozart allegro while the world is still beautiful, a minor-key
 * waltz when the first shadow falls, then slower and sparser piano as the cost comes into view.
 *
 * Loudness-matched (2026-10-22). As published the six span 12.6 LU (the waltz -19.80 LUFS-I, Moonlight
 * -32.41), so the chapter beds (0 to -5 dB) could not make a gentle descent: from chapter 4 on the
 * piano sat 11-18 LU under the game. The four quietest files had their gain raised losslessly
 * (scripts/mp3-gain.mjs: each granule's MP3 global gain, 1.505 dB a step; the decoded samples are the
 * original's times 2^(steps/4) to within float rounding), because el.volume cannot go above 1; then the
 * player cuts each recording to MUSIC_TARGET_LUFS (recordingGainDb), so every file is heard at the
 * same integrated loudness before the bed, and a playlist that moves on to its next file never gets
 * louder. lufsI is measured on the files as shipped (the lab's recording(): decoded at 48 kHz, both
 * channels, package B's BS.1770, Chrome 155).
 */
import type { MusicCue } from '../story/types';

export interface TrackDef {
  /** File name under public/audio/. */
  readonly file: string;
  readonly title: string;
  readonly composer: string;
  /** As named on the source page; Musopen does not name every performer there. */
  readonly performer: string;
  /** The Wikimedia Commons file page that states the recording's licence. */
  readonly source: string;
  readonly licence: 'Public domain' | 'CC0 1.0';
  /** Lossless MP3 gain applied to the published file here (scripts/mp3-gain.mjs; 1.505 dB a step). */
  readonly fileGainSteps: number;
  /** Integrated loudness of the file as shipped, at el.volume 1 (LUFS-I, measured). */
  readonly lufsI: number;
}

/**
 * Every recording is heard at this integrated loudness at el.volume 1 before the chapter's bed: the
 * quietest file as shipped (the nocturne after its one gain step), so recordingGainDb only ever cuts
 * and the player never needs a volume above 1.
 */
export const MUSIC_TARGET_LUFS = -22.1;

export const CUE_TRACKS: Readonly<Record<MusicCue, TrackDef>> = {
  // Act I: bright, upbeat, light.
  wonder: {
    file: 'mozart-k545-allegro.mp3',
    title: "Piano Sonata No. 16 in C major, K. 545 'Sonata facile', I. Allegro",
    composer: 'Wolfgang Amadeus Mozart',
    performer: 'Musopen (performer not named on the source page)',
    source:
      "https://commons.wikimedia.org/wiki/File:Wolfgang_Amadeus_Mozart_-_sonata_no._16_in_c_major,_k.545_'sonata_facile'_-_i._allegro.ogg",
    licence: 'Public domain',
    fileGainSteps: 0,
    lufsI: -21.45,
  },
  // Chapter 3: still a dance, but in A minor; the first shadow.
  unease: {
    file: 'chopin-waltz-a-minor-b150.mp3',
    title: 'Waltz in A minor, B. 150',
    composer: 'Frédéric Chopin',
    performer: 'Aya Higuchi',
    source: 'https://commons.wikimedia.org/wiki/File:Chopin_-_Waltz_in_A_minor,_B_150.ogg',
    licence: 'CC0 1.0',
    fileGainSteps: 0,
    lufsI: -19.8,
  },
  // Act II: melancholic piano.
  cost: {
    file: 'chopin-nocturne-e-minor-op72-1.mp3',
    title: 'Nocturne in E minor, Op. posth. 72 No. 1',
    composer: 'Frédéric Chopin',
    performer: 'Luke Faulkner',
    source: 'https://commons.wikimedia.org/wiki/File:Chopin_-_Nocturne_Op._posth._72_no._1.ogg',
    licence: 'CC0 1.0',
    // -23.60 LUFS-I as published; +1 step (+1.51 dB), sample peak -3.14 -> -1.63 dBFS.
    fileGainSteps: 1,
    lufsI: -22.1,
  },
  // Chapter 7: sparse, darker piano.
  reckoning: {
    file: 'beethoven-moonlight-adagio.mp3',
    title: "Piano Sonata No. 14 in C-sharp minor 'Moonlight', Op. 27 No. 2, I. Adagio sostenuto",
    composer: 'Ludwig van Beethoven',
    performer: 'Paul Pitman',
    source:
      "https://commons.wikimedia.org/wiki/File:Ludwig_van_Beethoven_-_sonata_no._14_in_c_sharp_minor_'moonlight',_op._27_no._2_-_i._adagio_sostenuto.ogg",
    licence: 'Public domain',
    // -32.41 LUFS-I as published; +7 steps (+10.54 dB), sample peak -13.65 -> -3.11 dBFS.
    fileGainSteps: 7,
    lufsI: -21.87,
  },
  // Chapter 8: very quiet solo piano.
  remains: {
    file: 'schumann-the-poet-speaks.mp3',
    title: "Kinderszenen, Op. 15, No. 13 'Der Dichter spricht' (The Poet Speaks)",
    composer: 'Robert Schumann',
    performer: 'Musopen (performer not named on the source page)',
    source:
      'https://commons.wikimedia.org/wiki/File:Robert_Schumann_-_scenes_from_childhood,_op._15_-_xiii._the_poet_speaks.ogg',
    licence: 'Public domain',
    // -27.94 LUFS-I as published; +4 steps (+6.02 dB), sample peak -9.05 -> -3.03 dBFS.
    fileGainSteps: 4,
    lufsI: -21.93,
  },
  // Chapter 9 and the epilogue: slow, reflective.
  thaw: {
    file: 'schumann-traumerei.mp3',
    title: "Kinderszenen, Op. 15, No. 7 'Träumerei' (Dreaming)",
    composer: 'Robert Schumann',
    performer: 'Musopen (performer not named on the source page)',
    source:
      'https://commons.wikimedia.org/wiki/File:Robert_Schumann_-_scenes_from_childhood,_op._15_-_vii._dreaming.ogg',
    licence: 'Public domain',
    // -29.53 LUFS-I as published; +5 steps (+7.53 dB), sample peak -12.84 -> -5.32 dBFS.
    fileGainSteps: 5,
    lufsI: -22.0,
  },
};

/**
 * What plays, in order, for each cue: the cue's own recording first, then backups of a close mood. When a
 * recording ends the next one fades in, and after the last the list starts again, so a chapter that
 * outlasts its piece (Träumerei is under three minutes, a long chapter can take ten) never falls silent;
 * a recording that fails to load is skipped for the next. Every file here is one of the six above.
 */
export const CUE_PLAYLISTS: Readonly<Record<MusicCue, readonly MusicCue[]>> = {
  wonder: ['wonder', 'unease'],
  unease: ['unease', 'wonder', 'cost'],
  cost: ['cost', 'remains', 'thaw'],
  reckoning: ['reckoning', 'cost', 'remains'],
  remains: ['remains', 'thaw', 'cost'],
  thaw: ['thaw', 'remains', 'reckoning'],
};

/** URL of one recording. Vite serves public/ at the app's base ('./' in vite.config.ts, so the built
 *  game also runs from a file share or a sub-path); BASE_URL already ends in '/'. */
const fileUrl = (file: string): string => `${import.meta.env.BASE_URL}audio/${file}`;

/** URL of a cue's own recording. */
export function trackUrl(cue: MusicCue): string {
  return fileUrl(CUE_TRACKS[cue].file);
}

/** The player's cut for one recording (dB, <= 0): it is heard at MUSIC_TARGET_LUFS at el.volume 1. */
export function recordingGainDb(cue: MusicCue): number {
  return Math.min(0, MUSIC_TARGET_LUFS - CUE_TRACKS[cue].lufsI);
}

const GAIN_BY_URL: ReadonlyMap<string, number> = new Map(
  (Object.keys(CUE_TRACKS) as MusicCue[]).map((cue) => [trackUrl(cue), Math.pow(10, recordingGainDb(cue) / 20)]),
);

/** The player's linear gain for a recording URL (1 for a URL that is not one of the six). */
export function recordingGain(url: string): number {
  return GAIN_BY_URL.get(url) ?? 1;
}

/** URLs of a cue's playlist, its own recording first. */
export function playlistUrls(cue: MusicCue): string[] {
  return CUE_PLAYLISTS[cue].map((c) => trackUrl(c));
}
