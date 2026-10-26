# audio-e2e 2026-10-23T10-15-18

Server http://localhost:5399/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| EPI The epilogue motif's bake: Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked | engine | 8 | 0 | 0 | 130 |

## EPI The epilogue motif's bake: Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked

- PASS the A/B windows all had work pending to the end: `{"idle":[5,3,5],"loading":[3,3,3]}`
- PASS worst case: the epilogue motif is not baked when the epilogue starts: `{"pending":1,"unbaked":true,"clicked":true}`
- PASS worst case: the epilogue motif played: `[[113.87,"motif","motif epilogue@1: not baked"],[114.15,"motif","motif epilogue@1: not baked"],[114.43,"motif","motif epilogue@1 at +0.00 s, 34.2 s, -13.3 dB"]]`
- PASS worst case: it started inside the epilogue's wait (<= 15 s): `5.28` (want <= 15 s)
- PASS worst case: the epilogue motif was asked for first, at the loading pace, and let go once it played: `[[75.06,"lifecycle","bake: motif epilogue@1 wanted by a moment: baked first, at the loading pace"],[114.43,"lifecycle","bake: no motif wanted by a moment"]]`
- PASS worst case: the motif sounds on the music bus (RMS > -75 dBFS): `-48.3` (want > -75)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: Revelation frame time (rAF intervals, 4 s windows): nothing to bake median 16.7 ms, p95 33.4, mean 21.82, frames over 33 ms 2.75/s; work pending at the idle pace (3 windows) median 16.7, p95 33.4, mean 20.61, over 33 ms 2.42/s, bake 161.6 ms/s; at the loading pace median 16.7, p95 33.4, mean 22.34, over 33 ms 3/s, bake 705.7 ms/s
- note: worst case (nothing of the epilogue motif baked at the epilogue's start): baked 5.17 s (wall) after the epilogue's start, 3581 ms of main-thread work; the motif starts 5.28 s (audio clock) after the epilogue's start (wait 15 s); frames during the first 4 s of the wait median 16.7 ms, p95 33.4, over 33 ms 3.25/s, bake {"loading":2803.4,"idle":0,"play":0} ms
