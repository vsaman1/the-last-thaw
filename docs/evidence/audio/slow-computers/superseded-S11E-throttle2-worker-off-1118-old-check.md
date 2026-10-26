# audio-e2e 2026-10-23T11-18-22

Server http://localhost:5399/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42, CPU throttled 2x, motif worker off (?audioworker=off). "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| S11E S11 on the real engine: the ch8 card, chapter 1 and chapter 9 motifs, the chapel, the epilogue | engine | 18 | 2 | 0 | 182 |

## S11E S11 on the real engine: the ch8 card, chapter 1 and chapter 9 motifs, the chapel, the epilogue

- PASS M3 (engine): the ch8 card plays the ch8 motif: `[[2.39,"motif","motif ch8@1 at +1.20 s, 18.4 s, 0.0 dB"]]`
- PASS M3 (engine): the motif is heard on the music bus (RMS > -40 dBFS): `-30.2` (want > -40)
- PASS ch1 completes: `"complete"`
- PASS M1 (engine): the recording is out (el.volume <= 0.001 or paused) by +3.1 s: `2748` (want <= 3100 ms)
- PASS M1 (engine): "No. 14" (act1) played, not skipped: `[[2.39,"motif","motif ch8@1 at +1.20 s, 18.4 s, 0.0 dB"],[6.64,"motif","motif stopped over 1.50 s"],[33.35,"motif","motif act1@1 at +4.00 s, 13.9 s, -4.0 dB"]]`
- PASS M1 (engine): the motif is heard on the music bus while it plays (RMS > -40 dBFS): `-35` (want > -40)
- PASS ch9 (engine): the chapel falls silent: no strike played after bell-silenced: `{"silenced":"bell-silenced p29 strikes=9","strikesAfter":0}`
- PASS ch9 (engine): the church duck lowers the music by 14 dB: `["church -14/-3/0 dB"]`
- PASS ch9 (engine): the approach hour strikes six in Story: `"bell-hour p29 fjord-chapel strokes=6 ds=463m"`
- PASS ch9 (engine): no strike dropped as notReady: `0` (want 0)
- PASS every duck asked for in ch9 lowers the music (<= 0 dB): `["act3Entry -12/0/0 dB","landmark -10/-2/0 dB","scar -0.75/0/0 dB","makeRoom -3/-4/0 dB","dam -10/0/0 dB","dam release","scar -1.5/0/0 dB","makeRoom -3/-4/0 dB","aftermath -8/0/0 dB","landmark -10/-2/0 dB","scar -2.25/0/0 dB","makeRoom -3/-4/0 dB","church -14/-3/0 dB","scar -3/0/0 dB","makeRoom -3/-4/0 dB","makeRoom -3/-4/0 dB","landmark -10/-2/0 dB","scar -3.75/0/0 dB","makeRoom -3/-4/0 dB","seaCh9 -10/0/0 dB"]`
- **FAIL** ch9 (engine): the revelation motif act3-bare played: `[[6.64,"motif","motif stopped over 1.50 s"],[33.35,"motif","motif act1@1 at +4.00 s, 13.9 s, -4.0 dB"],[40.08,"motif","motif stopped over 1.50 s"],[142.69,"motif","motif act3-bare@1: not baked"]]`
- **FAIL** L1b (engine): the ch9 Revelation motif is at its trim, lowered by a scar only (not the sea's -10 dB), the floor's at most: `null` (want -23.5 .. -9.5 dB)
- PASS M2 (engine): the epilogue motif played: `[[145.27,"motif","motif act3-bare@1 at +2.00 s, 19.4 s, -13.3 dB"],[163,"motif","motif stopped over 1.50 s"],[163.01,"motif","motif epilogue@1 at +4.50 s, 34.2 s, -13.3 dB"]]`
- PASS M2 (engine): sounding on the music bus (RMS > -75 dBFS; silence reads below -100): `-48.2` (want > -75)
- PASS L1b (engine): the epilogue motif is at its trim, lowered by a scar only (not the sea), the floor at most: `-13.3` (want -21.5 .. -9.5 dB)
- PASS story ducks never raise the music: the router’s duck product stayed <= 0 dB, every 100 ms over the ch8 card, ch1, ch9, the revelation and the epilogue: `{"samples":1365,"maxDuckDb":"0","maxTrimDb":"0"}`
- PASS …and no recording ever played above the sliders (el.volume <= master × music): `{"maxOverSlider":"-0.04326150592360145"}`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: ch9: bell-silenced p29 strikes=9; strikes played 9, clanks 0, notReady 0
- note: epilogue motif bake (wall s from chapter 9's start): play 9.39, run complete 102.54, act3-bare baked 104.81, epilogue started 122.78, epilogue motif baked 114.9; the motif starts 4.5 s (audio clock) after the epilogue's start (on time: 4.5 s); bank pending at the run's end 12 and the epilogue's start 10; wall s per pace {"loading":20.46,"idle":16.39,"play":94.08}, 12.4 s of it with a moment's motif asked for (waited for, or the epilogue's on chapter 9's Revelation); motifs off the main thread no (main thread); ch9 sounds dropped as notReady in play 1
- note: M2 (engine): epilogue motif -48.2 dBFS RMS on the music bus, ambience -39.8 (motif minus ambience -8.4 dB)
- note: L1: the ch9 Revelation motif at NaN dB and the epilogue's at -13.3 dB under MOTIF_CALIB_DB; the music bus over 2 s of the epilogue motif -48.2 dBFS RMS, the ambience bus -39.8
