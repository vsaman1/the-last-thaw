import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BELL_VOICINGS, SOUND_IDS } from './contract';
import { CUE_TRACKS } from './tracks';
import { COMPOSITION, SOUND_SOURCES, SYNTHESIS, recipeFile } from './sources';
import { CUT_SOUNDS, bakeable } from './synth/recipes';

const ROOT = resolve(__dirname, '../..');

describe('SOUND_SOURCES (the closed list)', () => {
  const byId = new Map(SOUND_SOURCES.map((s) => [s.id, s]));

  it('has one row per id', () => {
    expect(byId.size).toBe(SOUND_SOURCES.length);
  });

  it('lists every baked SoundId as original procedural synthesis, made in a file that exists', () => {
    for (const id of SOUND_IDS.filter(bakeable)) {
      const row = byId.get(id);
      expect(row, id).toBeDefined();
      expect(row!.kind, id).toBe('synthesis');
      expect(row!.provenance, id).toBe(SYNTHESIS);
      expect(row!.author, id).toBe('this project');
      expect(row!.file, id).toBe(recipeFile(id));
      expect(existsSync(resolve(ROOT, row!.file)), row!.file).toBe(true);
    }
  });

  it('has no row for a cut sound: the Vey strings are not in the game', () => {
    for (const id of CUT_SOUNDS) expect(byId.has(id), id).toBe(false);
  });

  it('lists every bell voicing, the felt piano, the space, the noise and the live voices as synthesis', () => {
    const ids = [
      ...Object.keys(BELL_VOICINGS).map((v) => `bell:${v}`),
      'piano:felt',
      'space-ir',
      'noise:white',
      'noise:pink',
      'noise:brown',
      'noise:control',
      'ambience:wind',
      'ambience:scrape',
      'ambience:water',
      'ambience:falls',
      'ambience:ocean',
      'ambience:flood',
      'ambience:emitters',
    ];
    for (const id of ids) {
      const row = byId.get(id);
      expect(row, id).toBeDefined();
      expect(row!.provenance, id).toBe(SYNTHESIS);
      expect(existsSync(resolve(ROOT, row!.file)), row!.file).toBe(true);
    }
  });

  it('credits the motif "No. 14" as an original composition (2026)', () => {
    const m = byId.get('motif:no-14');
    expect(m?.kind).toBe('composition');
    expect(m?.provenance).toBe(COMPOSITION);
  });

  it('has exactly six recordings: the Musopen piano tracks, public domain or CC0, with their source pages', () => {
    const recordings = SOUND_SOURCES.filter((s) => s.kind === 'recording');
    expect(recordings.length).toBe(Object.keys(CUE_TRACKS).length);
    expect(recordings.length).toBe(6);
    for (const r of recordings) {
      const cue = r.id.replace('track:', '') as keyof typeof CUE_TRACKS;
      const t = CUE_TRACKS[cue];
      expect(t, r.id).toBeDefined();
      expect(['Public domain', 'CC0 1.0']).toContain(r.licence);
      expect(r.licence).toBe(t.licence);
      expect(r.author).toContain('Musopen');
      expect(r.source).toBe(t.source);
      expect(existsSync(resolve(ROOT, r.file)), r.file).toBe(true);
    }
  });

  it('public/audio holds exactly the six recordings and nothing else', () => {
    const files = readdirSync(resolve(ROOT, 'public/audio')).sort();
    expect(files).toEqual(Object.values(CUE_TRACKS).map((t) => t.file).sort());
  });

  it('the synthesis code loads no audio files: no fetch, no decodeAudioData, no sample extensions', () => {
    const dirs = ['src/audio/synth', 'src/audio/synth/recipes', 'src/audio/voices'];
    for (const dir of dirs) {
      for (const f of readdirSync(resolve(ROOT, dir)).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
        const text = readFileSync(join(resolve(ROOT, dir), f), 'utf8');
        expect(/\bfetch\(|decodeAudioData|new Audio\(|\.(wav|mp3|ogg|flac|m4a|aac)\b/.test(text), `${dir}/${f}`).toBe(false);
      }
    }
  });
});
