# audio-e2e 2026-10-23T03-06-41

Server http://localhost:5199/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| S14 Story restarts on the same screen: Replay chapter, Continue with narrative off | engine | 1 | 1 | 0 | 89 |
| R Offline renders (lab) | engine | 28 | 0 | 0 | 198 |

## S14 Story restarts on the same screen: Replay chapter, Continue with narrative off

- PASS Revelation panel: the reading level and the reveal hold are on: `{"buses":{"ambience":0.5367,"effects":0.4395},"ducks":["reading"],"holds":["reveal"],"playing":null,"musicDucks":{"reading":-2.6906400000572175}}`
- **FAIL** scenario ran to the end: `"Error: the replay never reached play\n    at Object.S14 (<repo>/scripts/audio-e2e.mjs:1763:57)\n    at async main (<repo>/scripts/audio-e2e.mjs:2539:7)"`

## R Offline renders (lab)

- PASS engine: the core and the burst's sounds bake on the menu: `25467` (want >= 0 ms)
- PASS R1: hit loudness rises strictly with m: `[-55.6,-50.1,-44.8,-37.3,-32]`
- PASS R3: stress burst true peak ≤ −1 dBTP: `-8.001499791864987`
- PASS R3: no clipped samples: `0`
- PASS R3: at most 24 concurrent voices: `24` (want <= 24)
- PASS R1: break loudness rises strictly with M: `[-27.7,-25.3,-22.9,-20.5,-19.4]`
- PASS R1: hit ΔL(0.1 → 0.9) is 18–28 LU: `23.7`
- PASS R1: the low band (< 150 Hz) share rises with m (light at 0.1 against heavy at 0.9): `[0.025,0.0245,0.0245,0.2535,0.3422]`
- PASS R2: tap <= pine hit - 4 LU <= house collapse - 12 LU: `{"tap":-56.3,"pine":-51.1,"house":-25.4}`
- PASS R2: house + 3 LU <= dam break: `{"house":-25.4,"dam":-20}`
- PASS R2: nothing above -8 dBFS: `[-36.6,-29.9,-16,-10.8]`
- PASS R2: tap <= pine hit - 4 LU <= house collapse - 12 LU (after a 150 Hz high-pass): `{"tap":-55.6,"pine":-49.9,"house":-23.9}`
- PASS R2: house + 3 LU <= dam break (after a 150 Hz high-pass): `{"house":-23.9,"dam":-18.3}`
- PASS R4: a -20 dBFS sine through preMaster comes out at -20 ± 0.3 dBFS: `-20` (want -20 ± 0.3)
- PASS R4: a full-scale burst (band-limited at 16 kHz) comes out at <= -1 dBTP: `{"whole":-1.29,"fromPoint1s":-1.29,"samplePeak":-2.37}` (want <= -1)
- PASS R5: effects 0.5 vs 1.0 = -6.02 ± 0.05 dB: `-6.021`
- PASS R5: ambience 0 renders below -120 dBFS (a bell at 40 m): `"-240"` (want < -120 dBFS)
- PASS R5: mute all renders silence: `"-240"` (want < -120 dBFS)
- PASS R5: the pause gate reaches -60 dB within 0.25 s: `-214.9` (want <= -60 dB)
- PASS R6: a bell at 250 m is >= 12 LU below a house collapse at 30 m: `{"bell250":-38.3,"house30":-23.4}`
- PASS R6: a bell at 40 m peaks at <= -16 dBFS: `-18` (want <= -16)
- PASS R10: every recording measured (integrated loudness): `[-21.45,-19.8,-22.1,-21.87,-21.93,-22]`
- PASS R10: tracks.ts's lufsI is each file's measured loudness (±0.05 LU): `[["wonder",-21.45,-21.45],["unease",-19.8,-19.8],["cost",-22.1,-22.1],["reckoning",-21.87,-21.87],["remains",-21.93,-21.93],["thaw",-22,-22]]`
- PASS R10: loudness-matched: every recording is heard at MUSIC_TARGET_LUFS ± 0.1 LU: `[-22.1,-22.1,-22.1,-22.1,-22.1,-22.1]` (want -22.1)
- PASS R10: the recordings peak at or under 0 dBFS (music is outside the limiter): `[-2.64,-3.29,-1.63,-3.11,-3.03,-5.32]`
- PASS R7: the motifs' median at music 0.6 = the recordings' median at el.volume 0.6 − 3 ± 1 LU: `{"motifMedian":-29.52,"target":-29.54}`
- PASS R7: no clipping in the motif: `[0,0,0,0,0,0,0]`
- PASS R7 (L1): every moment's motif sits at least 1 LU under its chapter's recording at that moment (bed and reading level included): `[["ch1-beginning revelation",1.07],["ch2-measurements revelation",1.07],["ch3-warning revelation",1.23],["ch4-people revelation",1.48],["ch5-denial revelation",1.48],["ch6-price revelation",1.48],["ch7-escape revelation",1.13],["ch8-remains revelation",1.14],["ch9-last-thaw revelation",1.21],["ch8-remains card",3.14],["epilogue",1.06]]` (want >= 1 LU)
- note: bank after the bake: {"ready":69,"pending":0,"bytes":23798676,"checksum":"d59b106d"}
- note: R1 breaks: one buffer at the levels the break law gives (rate 1, no low-pass): the gain law and the analysis, not a timbre change with M
- note: R1: spectral centroid by m: 961, 1121, 1297, 1049, 1109 Hz
- note: R4: full-band white noise at a 0 dBFS sample peak comes out at sample peak -2.52 dBFS but 0.88 dBTP: the noise itself carries about 3.5 dB of intersample peaks, and Chrome's DynamicsCompressorNode limits samples, not true peak (no oversampling)
- note: R4: a -6 dBFS noise burst comes out at -5.87 dBTP (-5.87 from 0.1 s); the R3 stress burst of game sounds at -8.00
- note: R10 mozart-k545-allegro.mp3: 2 ch, 48000 Hz, 133.9 s, peak -2.64 dBFS, -21.45 LUFS-I, max momentary -11.8; the player's cut -0.65 dB, heard -22.10
- note: R10 chopin-waltz-a-minor-b150.mp3: 2 ch, 48000 Hz, 130.7 s, peak -3.29 dBFS, -19.80 LUFS-I, max momentary -11.6; the player's cut -2.30 dB, heard -22.10
- note: R10 chopin-nocturne-e-minor-op72-1.mp3: 2 ch, 48000 Hz, 272.7 s, peak -1.63 dBFS, -22.10 LUFS-I, max momentary -12.1; the player's cut 0.00 dB, heard -22.10
- note: R10 beethoven-moonlight-adagio.mp3: 2 ch, 48000 Hz, 335.8 s, peak -3.11 dBFS, -21.87 LUFS-I, max momentary -13.7; the player's cut -0.23 dB, heard -22.10
- note: R10 schumann-the-poet-speaks.mp3: 2 ch, 48000 Hz, 164.8 s, peak -3.03 dBFS, -21.93 LUFS-I, max momentary -11.4; the player's cut -0.17 dB, heard -22.10
- note: R10 schumann-traumerei.mp3: 2 ch, 48000 Hz, 203.0 s, peak -5.32 dBFS, -22.00 LUFS-I, max momentary -14.0; the player's cut -0.10 dB, heard -22.10
- note: R7: recordings' median as heard -22.10 LUFS-I at el.volume 1; the motifs' median before calibration -28.99 LUFS-I at music 1; calibration wanted 3.88 dB, in use 3.9
- note: R7 act1@1: -29.07 LUFS-I raw (peak -14.0); at music 0.6 calibrated -29.61 (peak -14.5), target -29.54
- note: R7 act1@0.94: -28.23 LUFS-I raw (peak -14.0); at music 0.6 calibrated -28.77 (peak -14.5), target -29.54
- note: R7 act2@1: -28.99 LUFS-I raw (peak -14.0); at music 0.6 calibrated -29.52 (peak -14.5), target -29.54
- note: R7 act3@1: -28.13 LUFS-I raw (peak -14.0); at music 0.6 calibrated -28.67 (peak -14.5), target -29.54
- note: R7 act3-bare@1: -28.71 LUFS-I raw (peak -14.0); at music 0.6 calibrated -29.25 (peak -14.5), target -29.54
- note: R7 ch8@1: -29.14 LUFS-I raw (peak -14.0); at music 0.6 calibrated -29.68 (peak -14.5), target -29.54
- note: R7 epilogue@1: -30.56 LUFS-I raw (peak -14.0); at music 0.6 calibrated -31.10 (peak -14.5), target -29.54
- note: R7: each variant against that target (LU): act1@1 -0.1, act1@0.94 0.8, act2@1 0.0, act3@1 0.9, act3-bare@1 0.3, ch8@1 -0.1, epilogue@1 -1.6
- note: R7 L1 ch1-beginning revelation: act1@1 at -4 dB = -29.17 LUFS-I, the recording at that moment -28.10: 1.07 LU under
- note: R7 L1 ch2-measurements revelation: act1@1 at -4 dB = -29.17 LUFS-I, the recording at that moment -28.10: 1.07 LU under
- note: R7 L1 ch3-warning revelation: act1@0.94 at -6 dB = -30.33 LUFS-I, the recording at that moment -29.10: 1.23 LU under
- note: R7 L1 ch4-people revelation: act2@1 at -6.5 dB = -31.59 LUFS-I, the recording at that moment -30.10: 1.48 LU under
- note: R7 L1 ch5-denial revelation: act2@1 at -6.5 dB = -31.59 LUFS-I, the recording at that moment -30.10: 1.48 LU under
- note: R7 L1 ch6-price revelation: act2@1 at -7.5 dB = -32.59 LUFS-I, the recording at that moment -31.10: 1.48 LU under
- note: R7 L1 ch7-escape revelation: act3@1 at -9 dB = -33.23 LUFS-I, the recording at that moment -32.10: 1.13 LU under
- note: R7 L1 ch8-remains revelation: ch8@1 at -9 dB = -34.24 LUFS-I, the recording at that moment -33.10: 1.14 LU under
- note: R7 L1 ch9-last-thaw revelation: act3-bare@1 at -9.5 dB = -34.31 LUFS-I, the recording at that moment -33.10: 1.21 LU under
- note: R7 L1 ch8-remains card: ch8@1 at 0 dB = -25.24 LUFS-I, the recording at that moment -22.10: 3.14 LU under
- note: R7 L1 epilogue: epilogue@1 at -9.5 dB = -36.16 LUFS-I, the recording at that moment -35.10: 1.06 LU under
