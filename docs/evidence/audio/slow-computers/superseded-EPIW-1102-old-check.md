# audio-e2e 2026-10-23T11-02-12

Server http://localhost:5399/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| EPIW The epilogue started with its motif unbaked, the motifs rendered in a Web Worker (as the game ships) | engine | 10 | 0 | 0 | 98 |

## EPIW The epilogue started with its motif unbaked, the motifs rendered in a Web Worker (as the game ships)

- PASS the motifs render off the main thread (a Web Worker): `{"renders":2,"ms":1655,"failed":false,"busy":false}`
- PASS worst case: the epilogue motif is not baked when the epilogue starts: `{"mark":284,"pending":1,"unbaked":true,"clicked":true,"bankAwaited":"epilogue@1","awaitedMotif":"epilogue@1","bankAwaitedAtStart":"epilogue@1","paceAtStart":"loading"}`
- PASS worst case (edge case A): dropped and asked for again, the bank still bakes it first, as bakeReport says: `{"bankAwaited":"epilogue@1","awaitedMotif":"epilogue@1","atStart":"epilogue@1"}`
- PASS worst case: the epilogue motif played: `[[80.47,"motif","motif epilogue@1: not baked",294],[80.73,"motif","motif epilogue@1: not baked",295],[80.98,"motif","motif epilogue@1 at +3.75 s, 34.2 s, -13.3 dB",296]]`
- PASS worst case: it started inside the epilogue's wait (<= 15 s): `4.52` (want <= 15 s)
- PASS worst case (worker): it started on time (+4.5 s), the render off the main thread: `{"lateBy":4.52,"offThread":{"renders":3,"ms":2410,"failed":false,"busy":false}}` (want <= 4.5 s)
- PASS worst case: the epilogue asked for its own motif (its own trace line, after the drop), at the loading pace, and let it go once it played: `{"own":[[80.21,"lifecycle","bake: motif epilogue@1 wanted by a moment: baked first, at the loading pace",293],[80.98,"lifecycle","bake: no motif wanted by a moment",297]],"paceAtStart":"loading"}`
- PASS worst case: the motif sounds on the music bus (RMS > -75 dBFS): `-48.3` (want > -75)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: worst case (nothing of the epilogue motif baked at the epilogue's start): baked 0.7 s (wall) after the epilogue's start, 0 ms of main-thread bake work meanwhile (the worker's renders since the Revelation took 755 ms there, 3 renders in all); the motif starts 4.52 s (audio clock) after the epilogue's start (on time: 4.5 s; wait 15 s); frames during the first 4 s of the wait median 16.7 ms, p95 33.5, over 33 ms 3.75/s, bake {"loading":0,"idle":0,"play":0} ms
