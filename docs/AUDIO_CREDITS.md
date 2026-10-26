# Sound credits: Iceberg River

Everything the game plays falls into one of three groups. Only the first contains any recording.

| What | Source | Licence |
| --- | --- | --- |
| The six music recordings (Story Mode's chapter cues; Arcade Mode plays the first two) | [Musopen](https://musopen.org/) via Wikimedia Commons, each checked on its file page | Public domain or CC0 1.0: see `docs/MUSIC_CREDITS.md` |
| Every sound effect, every ambience layer, the church bells, the shared reverb and the noise beds | Original procedural synthesis written for this project in TypeScript (`src/audio/synth/`, `src/audio/voices/`) | Original work (course project); no samples, nothing to licence |
| The piano motif *No. 14* and its felt-piano voice | Original composition (2026) for this game; the score is data in `src/audio/contract.ts` (`MOTIF_SCORES`), rendered by `src/audio/synth/piano.ts` | Original work (course project) |

No sound sample, field recording, sound library or third-party instrument is used. If one is ever added
(for example a licence-verified multisample piano in place of the synthesized one, `AUDIO_DESIGN.md` §8.5),
its licence must be checked on its source page, dated and recorded here before it ships.

The closed list of every sound source with its provenance is `SOUND_SOURCES` in `src/audio/sources.ts`; a
test enumerates it against every sound id, bell voicing and motif, so nothing can play without a row there.

## The synthesized sounds

All are built from noise, filters, decaying resonators and envelopes at bake time (deterministic from
`SEED = 42`: two bakes are identical, and the bank has a checksum). Grouped by material:

| Material | Sound ids |
| --- | --- |
| Stone | `hit.stone.light`, `hit.stone.heavy`, `stone.scatter`, `weight.thump` |
| Ice | `hit.ice`, `ice.chip`, `ice.absorb`, `ice.wallScrape`, `ice.land.ground`, `ice.land.water`, `ice.calve.groan`, `ice.calve.crack`, `scrape.grit` (loop) |
| Water | `water.plunge`, `splash.small`, `splash.medium`, `splash.large`, `ocean.entry`, `liquid.release` |
| Wood | `hit.wood`, `tree.fall.pine`, `tree.fall.broadleaf`, `timber.break.light`, `timber.break.medium`, `timber.collapse` |
| Masonry | `hit.masonry`, `house.collapse`, `masonry.collapse.small`, `masonry.collapse.large`, `dam.break`, `debris.settle` |
| Glass | `glass.break`, `glass.pane` |
| Metal and machinery | `hit.metal.panel`, `hit.metal.heavy`, `metal.break.light`, `metal.break.vehicle`, `metal.break.structure`, `machine.winddown`, `emitter.pumpjack`, `emitter.factory`, `emitter.turbine`, `emitter.rig` (loops) |
| Piano | `piano.strings` (in the contract, never requested: the "Vey strings" were cut, see `AUDIO_DESIGN.md`) |

Live ambience voices (wind, the iceberg's scrape, river and streams, waterfalls, the flood, the sea) are
built at run time from shared white, pink and brown noise and slow random control signals.

**Church bells** (`src/audio/synth/bell.ts`), one voicing per church, from the classic bell partials (hum,
prime, tierce, quint, nominal and upper partials, each a slightly detuned pair):

| Voicing | Church | Strike note |
| --- | --- | --- |
| `pass-chapel` | the pass chapel, Alpine Pass | E5 (659.26 Hz), a small bell |
| `st-brides` | St Bride's, the church on the hill, Riverside Town | B4 (493.88 Hz) |
| `clachan-kirk` | the Clachan kirk, Highland Maze: cracked in 1911 | D5 − 40 cents (573.92 Hz), with a beat and a short buzz |
| `loch-kirk` | the lochside kirk, Highland Maze | G4 (392.00 Hz), true |
| `fjord-chapel` | the fjord chapel, Summit Labyrinth | C5 (523.25 Hz) |

The church names, the bell's history and every person in The Last Thaw are invented.

## The motif

*No. 14* is a four-note cell (F4 A4 E5 | D5) with diatonic continuations in six variants, composed for this
game in 2026. No test can rule out that it accidentally resembles an existing tune; a person should listen
for that.

## Sources (methods, standards and code the sound relies on)

The synthesis and the measurements are written for this project, but several rest on published methods,
and one on someone else's code. AGENTS.md §6 asks for each to be cited:

| Used in | Source | How |
| --- | --- | --- |
| `src/audio/analysis.ts` `kWeighting()`: the K-weighting filter of every loudness number in the evidence | **libebur128**, Jan Kokemüller, <https://github.com/jiixyj/libebur128> (`ebur128/ebur128.c`, `ebur128_init_filter`). **MIT licence**, Copyright (c) 2011 Jan Kokemüller; the full notice is reproduced in the comment on `kWeighting()` | Ported: its six filter constants and the coefficient formulas, so the filter can be derived at any sample rate |
| `src/audio/analysis.ts`: momentary and gated integrated loudness, 4x true peak | ITU-R Recommendation **BS.1770-4** (2015), *Algorithms to measure audio programme loudness and true-peak audio level* | Implemented from the recommendation (400 ms blocks, 75 % overlap, −70 LUFS absolute and −10 LU relative gates; Annex 2's oversampling for true peak) |
| `src/audio/analysis.ts` `yinPitch()`: the bells' and the piano's pitch checks | A. de Cheveigné and H. Kawahara, "YIN, a fundamental frequency estimator for speech and music", *J. Acoust. Soc. Am.* 111(4), 2002 | Implemented from the paper |
| `src/audio/analysis.ts` `schroederT60()`: decay times (bells, the space IR) | M. R. Schroeder, "New method of measuring reverberation time", *J. Acoust. Soc. Am.* 37, 1965 | Backward-integrated energy decay |
| `src/audio/synth/piano.ts`: the felt piano's small room | M. R. Schroeder, "Natural sounding artificial reverberation", *J. Audio Eng. Soc.* 10(3), 1962 | Parallel combs into series all-passes |
| `src/audio/synth/dsp.ts` `pinkNoise()` | Paul Kellet's refined pink-noise filter (posted to the music-dsp mailing list, 1999; collected in the music-dsp source code archive) | Its filter, reimplemented |
| `src/audio/synth/dsp.ts` `Biquad` | R. Bristow-Johnson, *Cookbook formulae for audio EQ biquad filter coefficients* ("Audio EQ Cookbook") | Coefficient formulas |
| `scripts/mp3-gain.mjs`: the lossless gain of four recordings (`docs/MUSIC_CREDITS.md`) | The method of mp3gain (G. Pai), changing each granule's `global_gain` in the MPEG-1 Layer III side information (ISO/IEC 11172-3 §2.4.1.7) | Reimplemented from the standard's bitstream layout; no mp3gain code |

## AI assistance

The sound design, the synthesis recipes, the motif's score and the code were produced with AI assistance
(Claude Code), as the course's attribution rules ask; the README's Credits say the same for the whole game.
