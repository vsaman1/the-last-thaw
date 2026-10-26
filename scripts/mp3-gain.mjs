#!/usr/bin/env node
/**
 * Lossless MP3 gain in 1.5 dB steps (the mp3gain method): every granule's global_gain field is raised
 * by `steps`, which scales the decoded signal by 2^(steps/4) (1.505 dB a step) without decoding or
 * re-encoding anything. Granules with no spectral data (part2_3_length 0, digital silence) are left
 * as they are; a granule whose global_gain would pass 255 is clamped and counted (none of those carry
 * audio in the shipped files).
 *
 * Supports what public/audio holds: MPEG-1 Layer III, no CRC, an ID3v2 tag and a Xing/Info frame at
 * the start (left untouched). Anything else is refused.
 *
 *   node scripts/mp3-gain.mjs <file.mp3> <steps> [--out <out.mp3>] [--dry]
 *
 * Used once on 2026-10-22 to loudness-match the six recordings (src/audio/tracks.ts, docs/MUSIC_CREDITS.md):
 * the quiet Act III recordings could not be raised by el.volume, which cannot exceed 1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];

/** Raise every granule's global_gain by steps. Returns the new bytes and what was done. */
export function mp3Gain(input, steps) {
  if (!Number.isInteger(steps) || steps < -60 || steps > 60) throw new Error(`steps must be an integer in -60..60, got ${steps}`);
  const b = Buffer.from(input);
  let p = 0;
  if (b.toString('latin1', 0, 3) === 'ID3') {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    p = 10 + size + (b[5] & 0x10 ? 10 : 0);
  }
  const stats = { frames: 0, granules: 0, changed: 0, silent: 0, clamped: 0, infoFrame: false };
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) {
      // A trailing ID3v1 tag is fine; anything else means the parse lost the stream.
      if (b.toString('latin1', p, p + 3) === 'TAG' && b.length - p === 128) break;
      throw new Error(`lost frame sync at byte ${p}`);
    }
    const version = (b[p + 1] >> 3) & 3;
    const layer = (b[p + 1] >> 1) & 3;
    const noCrc = b[p + 1] & 1;
    const bri = b[p + 2] >> 4;
    const sri = (b[p + 2] >> 2) & 3;
    const pad = (b[p + 2] >> 1) & 1;
    const mode = b[p + 3] >> 6;
    if (version !== 3 || layer !== 1) throw new Error(`frame at ${p}: only MPEG-1 Layer III is supported`);
    if (!noCrc) throw new Error(`frame at ${p}: CRC-protected frames are not supported`);
    if (bri === 0 || bri === 15 || sri === 3) throw new Error(`frame at ${p}: free or bad bitrate / rate`);
    const len = Math.floor((144 * BITRATES[bri] * 1000) / RATES[sri]) + pad;
    const nch = mode === 3 ? 1 : 2;
    const side = p + 4;
    stats.frames++;
    const tag = b.toString('latin1', side + (nch === 1 ? 17 : 32), side + (nch === 1 ? 21 : 36));
    if (stats.frames === 1 && (tag === 'Xing' || tag === 'Info')) {
      stats.infoFrame = true; // the encoder's info frame: no audio
      p += len;
      continue;
    }
    // Side information (ISO 11172-3 2.4.1.7): main_data_begin 9, private 5|3, scfsi 4 per channel,
    // then per granule and channel: part2_3_length 12, big_values 9, global_gain 8, and 30 bits more
    // (scalefac_compress 4, window_switching_flag 1, 22 bits either way, preflag, scalefac_scale,
    // count1table_select).
    let bit = side * 8 + 9 + (nch === 1 ? 5 : 3) + 4 * nch;
    const read = (n) => {
      let v = 0;
      for (let i = 0; i < n; i++) v = (v << 1) | ((b[(bit + i) >> 3] >> (7 - ((bit + i) & 7))) & 1);
      bit += n;
      return v;
    };
    const write = (at, n, v) => {
      for (let i = 0; i < n; i++) {
        const byte = (at + i) >> 3;
        const mask = 1 << (7 - ((at + i) & 7));
        if ((v >> (n - 1 - i)) & 1) b[byte] |= mask;
        else b[byte] &= ~mask;
      }
    };
    for (let gr = 0; gr < 2; gr++) {
      for (let ch = 0; ch < nch; ch++) {
        const part23 = read(12);
        read(9);
        const ggAt = bit;
        const gg = read(8);
        read(30);
        stats.granules++;
        if (part23 === 0) {
          stats.silent++;
          continue;
        }
        const next = gg + steps;
        const v = Math.max(0, Math.min(255, next));
        if (v !== next) stats.clamped++;
        write(ggAt, 8, v);
        stats.changed++;
      }
    }
    p += len;
  }
  return { bytes: b, stats, gainDb: 20 * Math.log10(Math.pow(2, steps / 4)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, stepsArg, ...rest] = process.argv.slice(2);
  if (!file || stepsArg === undefined) {
    console.error('usage: node scripts/mp3-gain.mjs <file.mp3> <steps> [--out <out.mp3>] [--dry]');
    process.exit(2);
  }
  const out = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : file;
  const { bytes, stats, gainDb } = mp3Gain(readFileSync(file), Number(stepsArg));
  console.log(JSON.stringify({ file, steps: Number(stepsArg), gainDb: +gainDb.toFixed(3), ...stats }));
  if (stats.clamped > 0) console.warn(`warning: ${stats.clamped} granules clamped at the global_gain limit`);
  if (!rest.includes('--dry')) writeFileSync(out, bytes);
}
