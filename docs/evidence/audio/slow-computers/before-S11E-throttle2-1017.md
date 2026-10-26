# audio-e2e 2026-10-23T10-17-42

Server http://localhost:5399/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42, CPU throttled 2x. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| S11E S11 on the real engine: the ch8 card, chapter 1 and chapter 9 motifs, the chapel, the epilogue | engine | 13 | 7 | 0 | 196 |

## S11E S11 on the real engine: the ch8 card, chapter 1 and chapter 9 motifs, the chapel, the epilogue

- PASS M3 (engine): the ch8 card plays the ch8 motif: `[[2.6,"motif","motif ch8@1: not baked"],[2.88,"motif","motif ch8@1: not baked"],[3.16,"motif","motif ch8@1: not baked"],[3.44,"motif","motif ch8@1: not baked"],[3.71,"motif","motif ch8@1: not baked"],[4,"motif","motif ch8@1: not baked"],[4.27,"motif","motif ch8@1: not baked"],[4.55,"motif","motif ch8@1: not baked"],[4.84,"motif","motif ch8@1: not baked"],[5.11,"motif","motif ch8@1: not baked"],[5.4,"motif","motif ch8@1: not baked"],[5.69,"motif","motif ch8@1: not baked"],[5.96,"motif","motif ch8@1: not baked"],[6.24,"motif","motif ch8@1 at +0.00 s, 18.4 s, 0.0 dB"]]`
- PASS M3 (engine): the motif is heard on the music bus (RMS > -40 dBFS): `-32.1` (want > -40)
- PASS ch1 completes: `"complete"`
- PASS M1 (engine): the recording is out (el.volume <= 0.001 or paused) by +3.1 s: `2798` (want <= 3100 ms)
- **FAIL** M1 (engine): "No. 14" (act1) played, not skipped: `[[2.6,"motif","motif ch8@1: not baked"],[2.88,"motif","motif ch8@1: not baked"],[3.16,"motif","motif ch8@1: not baked"],[3.44,"motif","motif ch8@1: not baked"],[3.71,"motif","motif ch8@1: not baked"],[4,"motif","motif ch8@1: not baked"],[4.27,"motif","motif ch8@1: not baked"],[4.55,"motif","motif ch8@1: not baked"],[4.84,"motif","motif ch8@1: not baked"],[5.11,"motif","motif ch8@1: not baked"],[5.4,"motif","motif ch8@1: not baked"],[5.69,"motif","motif ch8@1: not baked"],[5.96,"motif","motif ch8@1: not baked"],[6.24,"motif","motif ch8@1 at +0.00 s, 18.4 s, 0.0 dB"],[6.98,"motif","motif stopped over 1.50 s"],[33.19,"motif","motif act1@1: not baked"],[33.5,"motif","motif act1@1: not baked"],[33.78,"motif","motif act1@1: not baked"],[34.06,"motif","motif act1@1: not baked"],[34.35,"motif","motif act1@1: not baked"],[34.65,"motif","motif act1@1: not baked"],[34.95,"motif","motif act1@1: not baked"],[35.23,"motif","motif act1@1: not baked"],[35.51,"motif","motif act1@1: not baked"],[35.81,"motif","motif act1@1: not baked"],[36.1,"motif","motif act1@1: not baked"],[36.38,"motif","motif act1@1: not baked"],[36.67,"motif","motif act1@1: not baked"],[36.97,"motif","motif act1@1: not baked"],[37.26,"motif","motif act1@1: not baked"],[37.54,"motif","motif act1@1: not baked"],[37.82,"motif","motif act1@1: not baked"],[38.14,"motif","motif act1@1: not baked"],[38.44,"motif","motif act1@1: not baked"]]`
- **FAIL** M1 (engine): the motif is heard on the music bus while it plays (RMS > -40 dBFS): `null` (want > -40)
- PASS ch9 (engine): the chapel falls silent: no strike played after bell-silenced: `{"silenced":"bell-silenced p29 strikes=9","strikesAfter":0}`
- PASS ch9 (engine): the church duck lowers the music by 14 dB: `["church -14/-3/0 dB"]`
- PASS ch9 (engine): the approach hour strikes six in Story: `"bell-hour p29 fjord-chapel strokes=6 ds=462m"`
- PASS ch9 (engine): no strike dropped as notReady: `0` (want 0)
- PASS every duck asked for in ch9 lowers the music (<= 0 dB): `["act3Entry -12/0/0 dB","landmark -10/-2/0 dB","scar -0.75/0/0 dB","makeRoom -3/-4/0 dB","dam -10/0/0 dB","dam release","scar -1.5/0/0 dB","makeRoom -3/-4/0 dB","aftermath -8/0/0 dB","landmark -10/-2/0 dB","scar -2.25/0/0 dB","makeRoom -3/-4/0 dB","church -14/-3/0 dB","scar -3/0/0 dB","makeRoom -3/-4/0 dB","makeRoom -3/-4/0 dB","landmark -10/-2/0 dB","scar -3.75/0/0 dB","makeRoom -3/-4/0 dB","seaCh9 -10/0/0 dB"]`
- **FAIL** ch9 (engine): the revelation motif act3-bare played: `[[37.82,"motif","motif act1@1: not baked"],[38.14,"motif","motif act1@1: not baked"],[38.44,"motif","motif act1@1: not baked"],[143.59,"motif","motif act3-bare@1: not baked"]]`
- **FAIL** L1b (engine): the ch9 Revelation motif is at its trim, lowered by a scar only (not the sea's -10 dB), the floor's at most: `null` (want -23.5 .. -9.5 dB)
- **FAIL** M2 (engine): the epilogue motif played: `[[182,"motif","motif epilogue@1: not baked"],[182.33,"motif","motif epilogue@1: not baked"],[182.63,"motif","motif epilogue@1: not baked"]]`
- **FAIL** M2 (engine): sounding on the music bus (RMS > -75 dBFS; silence reads below -100): `null` (want > -75)
- **FAIL** L1b (engine): the epilogue motif is at its trim, lowered by a scar only (not the sea), the floor at most: `null` (want -21.5 .. -9.5 dB)
- PASS story ducks never raise the music: the router’s duck product stayed <= 0 dB, every 100 ms over the ch8 card, ch1, ch9, the revelation and the epilogue: `{"samples":1488,"maxDuckDb":"0","maxTrimDb":"0"}`
- PASS …and no recording ever played above the sliders (el.volume <= master × music): `{"maxOverSlider":"-0.04326150592360145"}`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: ch9: bell-silenced p29 strikes=9; strikes played 9, clanks 0, notReady 0
- note: epilogue motif bake (wall s from chapter 9's start): play 9.87, run complete 103.35, act3-bare baked never, epilogue started 123.59, epilogue motif baked never; the motif starts never s (audio clock) after the epilogue's start (on time: 4.5 s); bank pending at the run's end 25 and the epilogue's start 25; wall s per pace {"loading":47.51,"idle":2.36,"play":94.6}, 39.09 s of it with a moment's motif asked for (waited for, or the epilogue's on chapter 9's Revelation)
- note: M2 (engine): epilogue motif -Infinity dBFS RMS on the music bus, ambience -41.6 (motif minus ambience -Infinity dB)
- note: L1: the ch9 Revelation motif at NaN dB and the epilogue's at NaN dB under MOTIF_CALIB_DB; the music bus over 2 s of the epilogue motif -Infinity dBFS RMS, the ambience bus -41.6
