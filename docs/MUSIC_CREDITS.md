# Music credits: The Last Thaw

Story Mode plays six solo-piano recordings, one per music cue (`src/audio/tracks.ts`). Arcade Mode
plays the `wonder` cue's playlist: the first two (K. 545, then the Chopin waltz). Everything else the game
plays (effects, ambience, bells, the archive's piano motif) is synthesized and uses no recording:
`docs/AUDIO_CREDITS.md`.

The compositions are all long out of copyright. The **recordings** have their own rights, so each
one was checked separately. Every recording below comes from [Musopen](https://musopen.org/) via
Wikimedia Commons, and its Commons file page gives the recording itself a licence that allows
redistribution in a public repository:

- **Public domain**: the page's licence section reads `Recording: {{PD-author|Musopen}}`, backed by
  Wikimedia VRT permission ticket 2008012110017088 (Musopen's public-domain release).
- **CC0 1.0**: the page's licence section is `{{cc-zero}}` for the performance. Legal code:
  <https://creativecommons.org/publicdomain/zero/1.0/legalcode>.

Checked on 2026-10-21 against each page's wikitext and licence metadata (Commons API).

| Cue | File (`public/audio/`) | Title | Composer | Performer | Recording licence | Source |
| --- | --- | --- | --- | --- | --- | --- |
| wonder | `mozart-k545-allegro.mp3` | Piano Sonata No. 16 in C major, K. 545 "Sonata facile", I. Allegro | Wolfgang Amadeus Mozart | Not named on the source page (Musopen) | Public domain | <https://commons.wikimedia.org/wiki/File:Wolfgang_Amadeus_Mozart_-_sonata_no._16_in_c_major,_k.545_'sonata_facile'_-_i._allegro.ogg> |
| unease | `chopin-waltz-a-minor-b150.mp3` | Waltz in A minor, B. 150 | Frédéric Chopin | Aya Higuchi | CC0 1.0 | <https://commons.wikimedia.org/wiki/File:Chopin_-_Waltz_in_A_minor,_B_150.ogg> |
| cost | `chopin-nocturne-e-minor-op72-1.mp3` | Nocturne in E minor, Op. posth. 72 No. 1 | Frédéric Chopin | Luke Faulkner | CC0 1.0 | <https://commons.wikimedia.org/wiki/File:Chopin_-_Nocturne_Op._posth._72_no._1.ogg> |
| reckoning | `beethoven-moonlight-adagio.mp3` | Piano Sonata No. 14 in C-sharp minor "Moonlight", Op. 27 No. 2, I. Adagio sostenuto | Ludwig van Beethoven | Paul Pitman | Public domain | <https://commons.wikimedia.org/wiki/File:Ludwig_van_Beethoven_-_sonata_no._14_in_c_sharp_minor_'moonlight',_op._27_no._2_-_i._adagio_sostenuto.ogg> |
| remains | `schumann-the-poet-speaks.mp3` | Kinderszenen, Op. 15, No. 13 "Der Dichter spricht" (The Poet Speaks) | Robert Schumann | Not named on the source page (Musopen) | Public domain | <https://commons.wikimedia.org/wiki/File:Robert_Schumann_-_scenes_from_childhood,_op._15_-_xiii._the_poet_speaks.ogg> |
| thaw | `schumann-traumerei.mp3` | Kinderszenen, Op. 15, No. 7 "Träumerei" (Dreaming) | Robert Schumann | Not named on the source page (Musopen) | Public domain | <https://commons.wikimedia.org/wiki/File:Robert_Schumann_-_scenes_from_childhood,_op._15_-_vii._dreaming.ogg> |

Musopen's original pages, where Commons links them:
[Beethoven](https://musopen.org/music/278/ludwig-van-beethoven/sonata-no-14-in-c-sharp-minor-moonlight-op-27-no-2/),
[Chopin nocturne](https://musopen.org/music/370/frederic-chopin/nocturne-in-e-minor-op-posth-72/),
[Chopin waltz](https://musopen.org/music/2617/frederic-chopin/waltz-in-am-b-150/).

## The files

The mp3s are Wikimedia Commons' own mp3 transcodes of the Ogg originals, downloaded from
`https://upload.wikimedia.org/wikipedia/commons/transcoded/…/<file>.ogg.mp3`. Each local file's size
matches the server's `Content-Length` for that transcode exactly. Nothing has been trimmed or
re-encoded here. Total: 25,441,515 bytes (about 24.3 MiB).

**One edit, lossless (2026-10-22): the gain of four files.** As published the six recordings span 12.6 LU
of integrated loudness (the waltz −19.80 LUFS-I, Moonlight −32.41), and a media element's volume cannot go
above 1, so the quiet ones could not be brought up in the player. `scripts/mp3-gain.mjs` raised their gain
the way mp3gain does: it adds a whole number of steps to every granule's MP3 `global_gain` field (one step is
2^(1/4), 1.505 dB) and changes nothing else: no decoding, no re-encoding, the same size. Decoded in Chrome
155, each edited file is the original times 2^(steps/4) sample for sample (largest difference 1.9 × 10⁻⁶ of
full scale, float rounding), the same length; no granule reached the field's limit (the 1,105 that did not
change carry no audio data). Both are permitted by the licences above (public domain, CC0). The player then
cuts each file to −22.1 LUFS-I (`src/audio/tracks.ts`, `MUSIC_TARGET_LUFS`), so every recording is heard at
the same loudness before the chapter's bed. A test (`src/audio/tracks.test.ts`) checks each shipped file
against the SHA-256 below.

| File | Steps | Gain | LUFS-I as published → shipped | Sample peak (dBFS) | SHA-256 as published | SHA-256 as shipped |
| --- | ---: | ---: | --- | --- | --- | --- |
| `mozart-k545-allegro.mp3` | 0 | 0 | −21.45 | −2.64 | 47f21d5a9613c798a37a3341cd42075b2741f1af447f6d45eaf4880b662fa126 | 47f21d5a9613c798a37a3341cd42075b2741f1af447f6d45eaf4880b662fa126 |
| `chopin-waltz-a-minor-b150.mp3` | 0 | 0 | −19.80 | −3.29 | 1f12e3c3cdd5d84fac8ca4add2de03407408275d791be7aa1f1ed1738700016f | 1f12e3c3cdd5d84fac8ca4add2de03407408275d791be7aa1f1ed1738700016f |
| `chopin-nocturne-e-minor-op72-1.mp3` | 1 | +1.51 dB | −23.60 → −22.10 | −3.14 → −1.63 | e2c8b63b6e1b75e7c668771fd2fe8c29fb3582608265ac4942ab687f8e8db39a | a97ffa8a32c29f575c10bf0158346d58cde189002469a06170d7248c8a77eaa6 |
| `beethoven-moonlight-adagio.mp3` | 7 | +10.54 dB | −32.41 → −21.87 | −13.65 → −3.11 | a0702c6db4ff22ff5a0bf7a76e443079e7cf2ad2fdf5d445c3b7ea8d60d0994b | b9943f57cdba93a7a1deb42aad2df32ab3a36134c35762df54a26e19f2dec4ad |
| `schumann-the-poet-speaks.mp3` | 4 | +6.02 dB | −27.94 → −21.93 | −9.05 → −3.03 | b9439aafb20278208e82644f207a8e6ef211233bec64e0a6402c7404d27588b3 | d40795b4d2c8893078c96590d1f393eba4afa60de0f147959756ee1c8a88acc1 |
| `schumann-traumerei.mp3` | 5 | +7.53 dB | −29.53 → −22.00 | −12.84 → −5.32 | e6bc9e39c1c84050dad417bd8338371ce2dc77bd0fac780432d921b8ee964041 | e916d1af840ab02b76eeb03dfaa22bad3f0ee85ed775dc51e6e4b5a8eb332bba |

Loudness: BS.1770 integrated, both channels, decoded at 48 kHz (`src/audio/analysis.ts` through the lab's
`recording()`), measured on the files before and after. Reproduce the edit from the published files with
`node scripts/mp3-gain.mjs public/audio/<file> <steps>`.

## Courtesy requests (not licence conditions)

The Commons pages quote two requests from Musopen. They are not conditions of the licences, but this
project follows them:

1. Do not sell the recordings for profit. This is a free student project.
2. Credit Musopen (<https://musopen.org/>) where the recordings are used. This file does that, and the
   game's credits should too.
