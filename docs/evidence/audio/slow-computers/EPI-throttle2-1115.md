# audio-e2e 2026-10-23T11-15-16

Server http://localhost:5399/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42, CPU throttled 2x. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| EPI The epilogue motif's bake on the main thread (?audioworker=off): Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked | engine | 10 | 0 | 0 | 181 |

## EPI The epilogue motif's bake on the main thread (?audioworker=off): Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked

- PASS the motifs bake on the main thread (?audioworker=off): `null`
- PASS the A/B windows all had work pending to the end: `{"idle":[11,10,11],"loading":[10,10,10]}`
- PASS worst case: the epilogue motif is not baked when the epilogue starts: `{"mark":298,"pending":1,"unbaked":true,"clicked":true,"bankAwaited":"epilogue@1","awaitedMotif":"epilogue@1","bankAwaitedAtStart":"epilogue@1","paceAtStart":"loading"}`
- PASS worst case (edge case A): dropped and asked for again, the bank still bakes it first, as bakeReport says: `{"bankAwaited":"epilogue@1","awaitedMotif":"epilogue@1","atStart":"epilogue@1"}`
- PASS worst case: the epilogue motif played: `[[165.23,"motif","motif epilogue@1: not baked",331],[165.53,"motif","motif epilogue@1: not baked",332],[165.86,"motif","motif epilogue@1 at +0.00 s, 34.2 s, -13.3 dB",333]]`
- PASS worst case: it started inside the epilogue's wait (<= 15 s): `8.76` (want <= 15 s)
- PASS worst case: the epilogue asked for its own motif (its own trace line, after the drop), at the loading pace, and let it go once it played: `{"own":[[157.1,"lifecycle","bake: motif epilogue@1 wanted by a moment: baked first, at the loading pace",305],[165.86,"lifecycle","bake: no motif wanted by a moment",334]],"paceAtStart":"loading"}`
- PASS worst case: the motif sounds on the music bus (RMS > -75 dBFS): `-49` (want > -75)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: Revelation frame time (rAF intervals, 4 s windows): nothing to bake median 17 ms, p95 33.4, mean 25.25, frames over 33 ms 2.25/s; work pending at the idle pace (3 windows) median 33.2, p95 33.4, mean 25.41, over 33 ms 2.42/s, bake 5.5 ms/s; at the loading pace median 33.3, p95 50, mean 35.21, over 33 ms 10.33/s, bake 268.2 ms/s
- note: worst case (nothing of the epilogue motif baked at the epilogue's start): baked 8.55 s (wall) after the epilogue's start, 2167 ms of main-thread bake work meanwhile; the motif starts 8.76 s (audio clock) after the epilogue's start (on time: 4.5 s; wait 15 s); frames during the first 4 s of the wait median 33.4 ms, p95 66.5, over 33 ms 11.50/s, bake {"loading":980.9,"idle":0,"play":0} ms
