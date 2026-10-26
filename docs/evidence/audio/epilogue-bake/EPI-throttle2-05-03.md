# audio-e2e 2026-10-23T05-03-05

Server http://localhost:5199/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42, CPU throttled 2x. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| EPI The epilogue motif's bake: Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked | engine | 4 | 3 | 0 | 222 |

## EPI The epilogue motif's bake: Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked

- PASS the A/B windows all had work pending to the end: `{"idle":[5,5,5],"loading":[5,5,5]}`
- PASS worst case: the epilogue motif is not baked when the epilogue starts: `{"pending":1,"unbaked":true,"clicked":true}`
- **FAIL** worst case: the epilogue motif played: `[[209.96,"motif","motif epilogue@1: not baked"],[210.26,"motif","motif epilogue@1: not baked"],[210.59,"motif","motif epilogue@1: not baked"]]`
- **FAIL** worst case: it started inside the epilogue's wait (<= 15 s): `null` (want <= 15 s)
- **FAIL** worst case: the epilogue motif was asked for first, at the loading pace, and let go once it played: `[[107.05,"lifecycle","bake: motif act3-bare@1 wanted by a moment: baked first, at the loading pace"],[112.83,"lifecycle","bake: motif epilogue@1 wanted by a moment: baked first, at the loading pace"],[210.59,"lifecycle","bake: no motif wanted by a moment"]]`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: Revelation frame time (rAF intervals, 4 s windows): nothing to bake median 16.8 ms, p95 33.4, mean 24.14, frames over 33 ms 0.75/s; work pending at the idle pace (3 windows) median 16.8, p95 33.4, mean 23.35, over 33 ms 1/s, bake 10.1 ms/s; at the loading pace median 33.3, p95 50, mean 33.6, over 33 ms 9.58/s, bake 286.4 ms/s
- note: worst case (nothing of the epilogue motif baked at the epilogue's start): baked -0.31 s (wall) after the epilogue's start, -3 ms of main-thread work; the motif starts never s (audio clock) after the epilogue's start (wait 15 s); frames during the first 4 s of the wait median 33.4 ms, p95 50.1, over 33 ms 11.75/s, bake {"loading":1112.1,"idle":0,"play":0} ms
