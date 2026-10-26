# audio-e2e 2026-10-23T05-18-48

Server http://localhost:5199/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42, CPU throttled 2x, S11E reads 60 s. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| S11E S11 on the real engine: the ch8 card, chapter 1 and chapter 9 motifs, the chapel, the epilogue | engine | 13 | 7 | 0 | 236 |

## S11E S11 on the real engine: the ch8 card, chapter 1 and chapter 9 motifs, the chapel, the epilogue

- PASS M3 (engine): the ch8 card plays the ch8 motif: `[[2.37,"motif","motif ch8@1: not baked"],[2.65,"motif","motif ch8@1: not baked"],[2.94,"motif","motif ch8@1: not baked"],[3.21,"motif","motif ch8@1: not baked"],[3.5,"motif","motif ch8@1: not baked"],[3.77,"motif","motif ch8@1: not baked"],[4.03,"motif","motif ch8@1: not baked"],[4.31,"motif","motif ch8@1: not baked"],[4.57,"motif","motif ch8@1: not baked"],[4.86,"motif","motif ch8@1: not baked"],[5.14,"motif","motif ch8@1: not baked"],[5.4,"motif","motif ch8@1 at +0.00 s, 18.4 s, 0.0 dB"]]`
- PASS M3 (engine): the motif is heard on the music bus (RMS > -40 dBFS): `-31.5` (want > -40)
- PASS ch1 completes: `"complete"`
- PASS M1 (engine): the recording is out (el.volume <= 0.001 or paused) by +3.1 s: `2717` (want <= 3100 ms)
- **FAIL** M1 (engine): "No. 14" (act1) played, not skipped: `[[2.37,"motif","motif ch8@1: not baked"],[2.65,"motif","motif ch8@1: not baked"],[2.94,"motif","motif ch8@1: not baked"],[3.21,"motif","motif ch8@1: not baked"],[3.5,"motif","motif ch8@1: not baked"],[3.77,"motif","motif ch8@1: not baked"],[4.03,"motif","motif ch8@1: not baked"],[4.31,"motif","motif ch8@1: not baked"],[4.57,"motif","motif ch8@1: not baked"],[4.86,"motif","motif ch8@1: not baked"],[5.14,"motif","motif ch8@1: not baked"],[5.4,"motif","motif ch8@1 at +0.00 s, 18.4 s, 0.0 dB"],[6.7,"motif","motif stopped over 1.50 s"],[34.73,"motif","motif act1@1: not baked"],[35.05,"motif","motif act1@1: not baked"],[35.33,"motif","motif act1@1: not baked"],[35.61,"motif","motif act1@1: not baked"],[35.89,"motif","motif act1@1: not baked"],[36.18,"motif","motif act1@1: not baked"],[36.48,"motif","motif act1@1: not baked"],[36.77,"motif","motif act1@1: not baked"],[37.05,"motif","motif act1@1: not baked"],[37.33,"motif","motif act1@1: not baked"],[37.62,"motif","motif act1@1: not baked"],[37.91,"motif","motif act1@1: not baked"],[38.2,"motif","motif act1@1: not baked"],[38.5,"motif","motif act1@1: not baked"],[38.77,"motif","motif act1@1: not baked"],[39.06,"motif","motif act1@1: not baked"],[39.33,"motif","motif act1@1: not baked"],[39.6,"motif","motif act1@1: not baked"],[39.91,"motif","motif act1@1: not baked"]]`
- **FAIL** M1 (engine): the motif is heard on the music bus while it plays (RMS > -40 dBFS): `null` (want > -40)
- PASS ch9 (engine): the chapel falls silent: no strike played after bell-silenced: `{"silenced":"bell-silenced p29 strikes=9","strikesAfter":0}`
- PASS ch9 (engine): the church duck lowers the music by 14 dB: `["church -14/-3/0 dB"]`
- PASS ch9 (engine): the approach hour strikes six in Story: `"bell-hour p29 fjord-chapel strokes=6 ds=462m"`
- PASS ch9 (engine): no strike dropped as notReady: `0` (want 0)
- PASS every duck asked for in ch9 lowers the music (<= 0 dB): `["act3Entry -12/0/0 dB","landmark -10/-2/0 dB","scar -0.75/0/0 dB","makeRoom -3/-4/0 dB","dam -10/0/0 dB","dam release","scar -1.5/0/0 dB","makeRoom -3/-4/0 dB","aftermath -8/0/0 dB","landmark -10/-2/0 dB","scar -2.25/0/0 dB","makeRoom -3/-4/0 dB","church -14/-3/0 dB","scar -3/0/0 dB","makeRoom -3/-4/0 dB","makeRoom -3/-4/0 dB","landmark -10/-2/0 dB","scar -3.75/0/0 dB","makeRoom -3/-4/0 dB","seaCh9 -10/0/0 dB"]`
- **FAIL** ch9 (engine): the revelation motif act3-bare played: `[[39.33,"motif","motif act1@1: not baked"],[39.6,"motif","motif act1@1: not baked"],[39.91,"motif","motif act1@1: not baked"],[143.7,"motif","motif act3-bare@1: not baked"]]`
- **FAIL** L1b (engine): the ch9 Revelation motif is at its trim, lowered by a scar only (not the sea's -10 dB), the floor's at most: `null` (want -23.5 .. -9.5 dB)
- **FAIL** M2 (engine): the epilogue motif played: `[[221.86,"motif","motif epilogue@1: not baked"],[222.18,"motif","motif epilogue@1: not baked"],[222.48,"motif","motif epilogue@1: not baked"]]`
- **FAIL** M2 (engine): sounding on the music bus (RMS > -75 dBFS; silence reads below -100): `null` (want > -75)
- **FAIL** L1b (engine): the epilogue motif is at its trim, lowered by a scar only (not the sea), the floor at most: `null` (want -21.5 .. -9.5 dB)
- PASS story ducks never raise the music: the router’s duck product stayed <= 0 dB, every 100 ms over the ch8 card, ch1, ch9, the revelation and the epilogue: `{"samples":1892,"maxDuckDb":"0","maxTrimDb":"0"}`
- PASS …and no recording ever played above the sliders (el.volume <= master × music): `{"maxOverSlider":"-0.04326150592360145"}`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: ch9: bell-silenced p29 strikes=9; strikes played 9, clanks 0, notReady 0
- note: epilogue motif bake (wall s from chapter 9's start): play 9.62, run complete 102.05, act3-bare baked never, epilogue started 162.26, epilogue motif baked never; the motif starts never s (audio clock) after the epilogue's start (on time: 4.5 s); bank pending at the run's end 19 and the epilogue's start 19; wall s per pace {"loading":32.4,"idle":56.93,"play":93.58}, 24.22 s of it with a moment's motif asked for (waited for, or the epilogue's on chapter 9's Revelation)
- note: M2 (engine): epilogue motif -Infinity dBFS RMS on the music bus, ambience -49.7 (motif minus ambience -Infinity dB)
- note: L1: the ch9 Revelation motif at NaN dB and the epilogue's at NaN dB under MOTIF_CALIB_DB; the music bus over 2 s of the epilogue motif -Infinity dBFS RMS, the ambience bus -49.7
