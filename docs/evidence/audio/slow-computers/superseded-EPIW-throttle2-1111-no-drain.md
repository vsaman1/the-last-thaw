# audio-e2e 2026-10-23T11-11-27

Server http://localhost:5399/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42, CPU throttled 2x. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| EPIW The epilogue started with its motif unbaked, the motifs rendered in a Web Worker (as the game ships) | engine | 8 | 2 | 0 | 223 |

## EPIW The epilogue started with its motif unbaked, the motifs rendered in a Web Worker (as the game ships)

- PASS the motifs render off the main thread (a Web Worker): `{"renders":2,"ms":2236,"failed":false,"busy":false}`
- **FAIL** worst case: the epilogue motif is not baked when the epilogue starts: `{"mark":278,"pending":22,"unbaked":true,"clicked":true,"bankAwaited":"epilogue@1","awaitedMotif":"epilogue@1","bankAwaitedAtStart":"epilogue@1","paceAtStart":"loading"}`
- PASS worst case (edge case A): dropped and asked for again, the bank still bakes it first, as bakeReport says: `{"bankAwaited":"epilogue@1","awaitedMotif":"epilogue@1","atStart":"epilogue@1"}`
- PASS worst case: the epilogue motif played: `[[204.15,"motif","motif epilogue@1: not baked",288],[204.47,"motif","motif epilogue@1: not baked",289],[204.76,"motif","motif epilogue@1 at +3.25 s, 34.2 s, -13.3 dB",290]]`
- PASS worst case: it started inside the epilogue's wait (<= 15 s): `4.88` (want <= 15 s)
- **FAIL** worst case (worker): it started on time (+4.5 s), the render off the main thread: `{"lateBy":4.88,"offThread":{"renders":3,"ms":3606,"failed":false,"busy":false}}` (want <= 4.5 s)
- PASS worst case: the epilogue asked for its own motif (its own trace line, after the drop), at the loading pace, and let it go once it played: `{"own":[[203.14,"lifecycle","bake: motif epilogue@1 wanted by a moment: baked first, at the loading pace",285],[204.76,"lifecycle","bake: no motif wanted by a moment",291]],"paceAtStart":"loading"}`
- PASS worst case: the motif sounds on the music bus (RMS > -75 dBFS): `-48.8` (want > -75)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: worst case (nothing of the epilogue motif baked at the epilogue's start): baked 1.21 s (wall) after the epilogue's start, 296 ms of main-thread bake work meanwhile (the worker's renders since the Revelation took 1370 ms there, 3 renders in all); the motif starts 4.88 s (audio clock) after the epilogue's start (on time: 4.5 s; wait 15 s); frames during the first 4 s of the wait median 33.2 ms, p95 50, over 33 ms 5.50/s, bake {"loading":202.1,"idle":55.1,"play":0} ms
