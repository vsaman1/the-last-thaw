# audio-e2e 2026-10-23T04-09-29

Server http://localhost:5199/, Chrome/155.0.8059.86, win32 10.0.26200, seed 42. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio.

| Scenario | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | ---: | ---: | ---: | ---: |
| EPI The epilogue motif's bake: Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked | engine | 8 | 0 | 0 | 127 |

## EPI The epilogue motif's bake: Revelation frame time at the idle and loading paces; the epilogue started with its motif unbaked

- PASS the A/B windows all had work pending to the end: `{"idle":[5,3,5],"loading":[3,3,3]}`
- PASS worst case: the epilogue motif is not baked when the epilogue starts: `{"unbaked":true,"pending":1}`
- PASS worst case: the epilogue motif played: `[[114.14,"motif","motif epilogue@1: not baked"],[114.41,"motif","motif epilogue@1: not baked"],[114.66,"motif","motif epilogue@1 at +0.00 s, 34.2 s, -13.3 dB"]]`
- PASS worst case: it started inside the epilogue's wait (<= 15 s): `5.02` (want <= 15 s)
- PASS worst case: the moment asked for its motif first, at the loading pace, and let go once it played: `[[109.64,"lifecycle","bake: a moment waits for motif epilogue@1: baked first, at the loading pace"],[114.66,"lifecycle","bake: no moment waits for a motif"]]`
- PASS worst case: the motif sounds on the music bus (RMS > -75 dBFS): `-48.2` (want > -75)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: Revelation frame time (rAF intervals, 4 s windows): nothing to bake median 16.7 ms, p95 33.3, mean 19.4, frames over 33 ms 1.75/s; work pending at the idle pace (3 windows) median 16.7, p95 33.4, mean 19.51, over 33 ms 2.42/s, bake 157.6 ms/s; at the loading pace median 16.7, p95 33.4, mean 21.56, over 33 ms 2.67/s, bake 713.7 ms/s
- note: worst case (nothing of the epilogue motif baked at the epilogue's start): baked 4.93 s (wall) after the epilogue's start, 3390 ms of main-thread work; the motif starts 5.02 s (audio clock) after the epilogue's start (wait 15 s); frames during the first 4 s of the wait median 16.7 ms, p95 33.4, over 33 ms 3.25/s, bake {"loading":2755.5,"idle":0,"play":0} ms
