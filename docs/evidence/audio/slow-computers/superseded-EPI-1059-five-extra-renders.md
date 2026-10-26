# audio-e2e 2026-10-23T10-59-59

Server http://localhost:5399/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| EPI The epilogue motif's bake on the main thread (?audioworker=off): Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked | engine | 9 | 1 | 0 | 127 |

## EPI The epilogue motif's bake on the main thread (?audioworker=off): Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked

- PASS the motifs bake on the main thread (?audioworker=off): `null`
- **FAIL** the A/B windows all had work pending to the end: `{"idle":[4,0,4],"loading":[0,0,0]}`
- PASS worst case: the epilogue motif is not baked when the epilogue starts: `{"mark":302,"pending":1,"unbaked":true,"clicked":true,"bankAwaited":"epilogue@1","awaitedMotif":"epilogue@1","bankAwaitedAtStart":"epilogue@1","paceAtStart":"loading"}`
- PASS worst case (edge case A): dropped and asked for again, the bank still bakes it first, as bakeReport says: `{"bankAwaited":"epilogue@1","awaitedMotif":"epilogue@1","atStart":"epilogue@1"}`
- PASS worst case: the epilogue motif played: `[[110.53,"motif","motif epilogue@1: not baked",312],[110.79,"motif","motif epilogue@1: not baked",313],[111.05,"motif","motif epilogue@1 at +3.25 s, 34.2 s, -13.3 dB",314]]`
- PASS worst case: it started inside the epilogue's wait (<= 15 s): `4.61` (want <= 15 s)
- PASS worst case: the epilogue asked for its own motif (its own trace line, after the drop), at the loading pace, and let it go once it played: `{"own":[[109.69,"lifecycle","bake: motif epilogue@1 wanted by a moment: baked first, at the loading pace",309],[111.05,"lifecycle","bake: no motif wanted by a moment",315]],"paceAtStart":"loading"}`
- PASS worst case: the motif sounds on the music bus (RMS > -75 dBFS): `-48.2` (want > -75)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: Revelation frame time (rAF intervals, 4 s windows): nothing to bake median 16.7 ms, p95 33.4, mean 20.38, frames over 33 ms 2.50/s; work pending at the idle pace (3 windows) median 16.7, p95 33.4, mean 20.49, over 33 ms 2.83/s, bake 95.3 ms/s; at the loading pace median 16.7, p95 33.4, mean 20.7, over 33 ms 2.75/s, bake 283.6 ms/s
- note: worst case (nothing of the epilogue motif baked at the epilogue's start): baked 1.07 s (wall) after the epilogue's start, 730 ms of main-thread bake work meanwhile; the motif starts 4.61 s (audio clock) after the epilogue's start (on time: 4.5 s; wait 15 s); frames during the first 4 s of the wait median 16.7 ms, p95 33.4, over 33 ms 2.50/s, bake {"loading":681.8,"idle":0,"play":0} ms
