import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../story/chapters';
import type { MusicCue } from '../story/types';
import { CHAPTER_MIX } from './contract';
import { CUE_PLAYLISTS, CUE_TRACKS, MUSIC_TARGET_LUFS, playlistUrls, recordingGain, recordingGainDb, trackUrl } from './tracks';

const ROOT = resolve(__dirname, '../..');
const CUES: readonly MusicCue[] = ['wonder', 'unease', 'cost', 'reckoning', 'remains', 'thaw'];
/** The brief's ~25 MB budget for shipped audio, with a little headroom. */
const MAX_TOTAL_BYTES = 26 * 1024 * 1024;

describe('cue → track mapping', () => {
  it('maps every cue to its own recording', () => {
    expect(Object.keys(CUE_TRACKS).sort()).toEqual([...CUES].sort());
    const files = CUES.map((c) => CUE_TRACKS[c].file);
    expect(new Set(files).size).toBe(CUES.length);
  });

  it('builds URLs under public/audio and ships every file within the size budget', () => {
    let total = 0;
    for (const cue of CUES) {
      const { file } = CUE_TRACKS[cue];
      expect(trackUrl(cue).endsWith(`audio/${file}`)).toBe(true);
      const path = resolve(ROOT, 'public/audio', file);
      expect(existsSync(path), file).toBe(true);
      total += statSync(path).size;
    }
    expect(total).toBeLessThan(MAX_TOTAL_BYTES);
  });

  it('credits every track with its source page and recording licence', () => {
    const credits = readFileSync(resolve(ROOT, 'docs/MUSIC_CREDITS.md'), 'utf8');
    for (const cue of CUES) {
      const t = CUE_TRACKS[cue];
      expect(t.source.startsWith('https://commons.wikimedia.org/wiki/File:')).toBe(true);
      const row = credits.split('\n').find((line) => line.includes(`\`${t.file}\``));
      expect(row, t.file).toBeDefined();
      expect(row).toContain(t.source);
      expect(row).toContain(t.licence);
      expect(row).toContain(t.composer);
    }
  });
});

describe('playlists (music never runs out)', () => {
  it('every cue plays its own recording first, then at least one backup, all of them credited tracks', () => {
    for (const cue of Object.keys(CUE_TRACKS) as (keyof typeof CUE_TRACKS)[]) {
      const list = CUE_PLAYLISTS[cue];
      expect(list[0], cue).toBe(cue);
      expect(list.length, cue).toBeGreaterThanOrEqual(2);
      expect(new Set(list).size, cue).toBe(list.length);
      for (const c of list) expect(CUE_TRACKS[c], `${cue} → ${c}`).toBeDefined();
      expect(playlistUrls(cue)[0]).toBe(trackUrl(cue));
    }
  });
});

describe('loudness-matched recordings (every file heard at MUSIC_TARGET_LUFS before the bed)', () => {
  const heard = (cue: MusicCue): number => CUE_TRACKS[cue].lufsI + recordingGainDb(cue);

  it('the player only cuts, and every recording comes out at the target', () => {
    for (const cue of CUES) {
      expect(recordingGainDb(cue), cue).toBeLessThanOrEqual(0);
      expect(heard(cue), cue).toBeCloseTo(MUSIC_TARGET_LUFS, 6);
      expect(recordingGain(trackUrl(cue)), cue).toBeCloseTo(Math.pow(10, recordingGainDb(cue) / 20), 12);
    }
    // The target is the quietest file as shipped: no recording would need a volume above 1.
    expect(MUSIC_TARGET_LUFS).toBeCloseTo(Math.min(...CUES.map((c) => CUE_TRACKS[c].lufsI)), 6);
    expect(recordingGain('somewhere/else.mp3')).toBe(1);
  });

  it('a playlist moving on to its next recording never makes the music louder', () => {
    for (const cue of CUES) for (const next of CUE_PLAYLISTS[cue]) expect(heard(next) - heard(cue), `${cue} → ${next}`).toBeLessThanOrEqual(0.01);
  });

  it('the music descends: no chapter is heard louder than the one before (bed included), at any slider', () => {
    let previous = Infinity;
    for (const c of CHAPTERS) {
      // Whichever file of the chapter's playlist is playing (a long chapter moves on to its backups).
      const loudest = Math.max(...CUE_PLAYLISTS[c.music].map((f) => heard(f))) + CHAPTER_MIX[c.id].musicBedDb;
      expect(loudest, c.id).toBeLessThanOrEqual(previous + 0.01);
      previous = Math.min(...CUE_PLAYLISTS[c.music].map((f) => heard(f))) + CHAPTER_MIX[c.id].musicBedDb;
    }
  });

  it('the shipped files are the ones measured: their SHA-256 is the one in MUSIC_CREDITS.md', () => {
    const credits = readFileSync(resolve(ROOT, 'docs/MUSIC_CREDITS.md'), 'utf8');
    for (const cue of CUES) {
      const { file, fileGainSteps } = CUE_TRACKS[cue];
      const sha = createHash('sha256').update(readFileSync(resolve(ROOT, 'public/audio', file))).digest('hex');
      const row = credits.split('\n').find((line) => line.startsWith(`| \`${file}\` |`));
      expect(row, file).toBeDefined();
      expect(row, file).toContain(sha);
      expect(row, file).toContain(`| ${fileGainSteps} |`);
    }
  });
});
