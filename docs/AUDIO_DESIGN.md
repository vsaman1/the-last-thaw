# Iceberg River sound design (final, merged from proposals A and B)

> **Status:** the design as agreed before the build (2026-10-21), kept to show the work. What was built
> and measured is in docs/AUDIO.md. Lead decisions on the open questions: the music pauses in a hidden
> tab; Arcade churches strike three; Ambience and Effects default to 0.8; the P1 "Vey strings" are CUT (a
> piano heard from a house that just fell could read as someone at home); other P1 items only if time allows.

> **Contract changes at integration (2026-10-22).** The three packages asked for these; the
> integrator applied them to `src/audio/contract.ts` and to every package that reads them, in one
> commit:
> - `SPACE` / `GenerateSpaceIR`: the IR carries the 15 ms predelay as leading silence and has unit
>   energy per channel; the convolver runs with `normalize = false` and the graph has no DelayNode
>   (A had both a DelayNode and the browser's normalisation, which with B's IR would have doubled the
>   predelay and made the return depend on the IR's length).
> - `EVENT_MAG.chipAmountRef`: 0.004 → 0.4, the 95th percentile of real chips (C measured it; the
>   placeholder played every chip at full level). C's local `CHIP_AMOUNT_REF` is gone.
> - `SoundRequest.send?`: a per-request space send (default the session's `spaceSend`), so the intro's
>   calving uses `ChapterMix.calveSend` as §6.4 intended.
> - `FakeAudioContextHandle.liveSources(owner?)`: the signature now matches its comment.
> - Wording only: `SliceScheduler`'s deadline is an absolute `performance.now()` time at most 4 ms
>   ahead; `ROUTER_MIN_STEP` also counts a 2% relative step and sends the settled value;
>   `PLAY_DUCK_FLOOR_DB` floors the ambience and effects sums too; `AudioState.buses` is the modelled
>   schedule and `master` excludes the hidden gate; `TraceEntry.gt` is wall-clock session time in the
>   engine's entries; `MusicRouter.hold` is a per-key set, not reference counted;
>   `MOTIF_TUNING.unisonCents` is a maximum (each unison beats at most 0.65 Hz).
> - §10 corrections: "loop seam < 0.01" cannot hold for noise loops and is tested statistically (the
>   seam step is under 4σ of the steps inside the loop, and the RMS step across it is no larger than any
>   inside); "hits T60 ≤ 0.3 s" applies to stone, ice and wood; masonry, metal-panel and heavy-metal
>   hits use their own §6.4 decay specs.
>
> Refused, with reasons: removing the cut `piano.strings` from `SOUND_IDS` (it would touch three
> packages' exhaustive tables for no change at run time; its recipe is null, `CUT_SOUNDS` lists it,
> the bank never bakes it and no level set asks for it); putting `withOwner()` in the frozen fake
> handle (only A's tests tag owners; A's `FakeHandle` type has it); moving the noise bank's control
> roles into the contract (only B's voices read them; the contract now points at B's `CONTROL`).

> **Changes after the integrated smoke run (2026-10-22, the fix round; measured in
> docs/evidence/AUDIO_RUNS.md, *After the open problems*).**
> - `SessionAudio.bellReady(voicing)`: whether the strike is baked. The bell scheduler defers a phrase
>   or the hour until it is (bells are background: late is fine, lost is not) and traces the wait.
> - `AudioManager.setLoadingScreen(on)`: the director says when the loading overlay covers the screen.
> - `AudioManager.prepare()` works before the first gesture (baking needs no AudioContext; none is
>   built) and replaces the level set by difference; the director asks for the next level's set on the
>   menus (§6.1's "as soon as a level or chapter is chosen" is now "as soon as it is known").
> - The bank's order (supersedes §6.1's "core, then the level set, then bells, then motifs"): the
>   level's bell strikes and a chapter card's motif, then the level's collision sounds (hits, scatter,
>   absorb: about 60 ms of work, needed from the first seconds of play); the core, St Bride's strike
>   first (kept with the core, so the Settings Ambience preview works from a cold start); the level's
>   other sounds, structural failures first; the shiver and the clank; the other motifs.
> - Slices (supersedes "≤ 4 ms slices" in §6.1 and risk 11): paced by the screen, `BAKE_PACE` in
>   `synth/bank.ts`: 16 ms timer slices behind the loading overlay (40 ms baked more per load but made
>   the load 0.17-0.43 s longer; 16 ms costs about 0.08 s, with nothing dropped either way), up to 12 ms
>   of a menu's idle time, at most 4 ms in play. `SliceScheduler`'s wording says so.
> - `TraceEntry.requestDb`: a play's requested level next to the level it played at, so S4 can test the
>   mapping apart from the engine's jitter and density compensation.
> - §11.2 R11: the limiter's reduction is read with the output shifted by the limiter's look-ahead
>   (measured in the lab, `MixStats.limiterLatencySamples`); unshifted, a block ending on an onset read
>   as 145-159 dB of reduction.
> - §11.2 R4: the full-scale burst is band-limited at 16 kHz, where every effect strip's low-pass stops;
>   full-band white noise carries +3.5 dBTP of intersample peaks of its own, and Chrome's compressor
>   limits samples, not true peak (that number is still reported).
> - §4 lifecycle: when the last live attempt ends, the shared space's return closes with the attempt's
>   fade and opens again once the convolver has emptied (or when the next attempt begins, or for a
>   Settings preview): §11.3 S8's "bus RMS < −90 dBFS 300 ms later" failed on the reverb's 2.2 s tail.
> - §11.3 adds engine twins of S3, S5, S8, S10 and S11 (the page's own audio, no recording engine),
>   S4M (the magnitude mapping against every collision, audio off) and BAKE / BAKEOFF (the level set
>   from a cold start, against `?audio=off`).
> - §11.3 S0: headless Chrome's audio clock runs at 0.84x wall time here, under the 0.95 the live
>   meters assumed; the driver times every meter window on the context clock instead.
> - A Story moment waits for a motif still baking until its start time plus `motifLateReleaseSec`
>   (never less than 3 s), as `MOMENT_TIMING` always said; it used to give up at once.
> - `MOTIF_CALIB_DB` (§8.5): measured (R7/R10).
> - §6.2 and §11.3 S4, the decision on the impulse threshold (measured in AUDIO_RUNS.md): a better
>   mapping, not a lower threshold. The closing-speed term is scaled by the impulse up to J 20
>   (`COLLISION_MAG.jGate`): a fast graze that moves almost no momentum (a fence brushed at 25 m/s, J
>   0.4) was as loud as a real knock. S4's threshold (ρ ≥ 0.9) is applied, as written, to the level
>   the mapping asks for (`requestDb`); the engine's ±1.5 dB jitter and density compensation, which
>   by design reorder hits whose levels lie within 3 dB, are checked on their own (S3E's engine
>   fidelity: every play within its request ± jitter, minus density, minus distance).

> **Changes in the second fix round (2026-10-22, after the review; measured in
> docs/evidence/AUDIO_RUNS.md, *Second fix round*).**
> - §8.3 and §8.1, the music's level: the six recordings are **loudness-matched** before any bed. Four
>   files had their gain raised losslessly (`scripts/mp3-gain.mjs`; MP3 global gain, 1.505 dB a step),
>   because `el.volume` cannot exceed 1, and the player cuts each file to `MUSIC_TARGET_LUFS` (−22.1
>   LUFS-I) by a per-recording gain (`MusicPlayerOptions.gainFor`, default `tracks.ts`
>   `recordingGain`). The beds (0 to −5 dB) are now the descent §8.3 describes; before, the recordings'
>   own 12.6 LU spread made chapter 4 on a cliff (11–18 LU under the game) and let a playlist's next
>   file come in up to 8.8 LU louder.
> - §8.5 / §8.7, the motif's level (lead decision L1: the motif never sits louder than its chapter's
>   own recording): `MOTIF_CALIB_DB` is re-derived against the matched recordings (+3.9 dB; §8.5's rule
>   is unchanged), and each moment trims it further (`MOTIF_MOMENT_TRIM_DB`, −4 to −9.5 dB) to sit at
>   least `MOTIF_UNDER_RECORDING_LU` (1 LU) under the recording at its bed and the moment's reading
>   level; the ducks that stay on the recording to the attempt's end (the scar, chapter 9's sea;
>   `PERSISTENT_DUCKS` in `moments.ts`, read at their targets from `MusicRouterState.targets`, as far as the
>   router's −20 dB floor) are subtracted at the moment, so the margin holds with every duck included.
>   `AudioManager.playMotif(motif, delaySec, gainDb?)` takes the trim.
> - §4 / §8.7 lifecycle: a Revelation or epilogue ends with its run, also when a new attempt starts on
>   the same game screen (Replay chapter, R, Continue with narrative off); the hold after a motif is
>   released on the audio clock, and the router's hold limits stop counting while the tab is hidden.
> - §8.3: the aftermath's release is the chapter's own (`CHAPTER_MIX.aftermathReleaseSec`); it was 4 s
>   everywhere.
> - §5: M works on a focused slider, checkbox, radio button or button; only text entry, a select's
>   type-ahead and editable text keep the letter.
> - §4, the first gesture (lead decision L2): the noise bank's samples and the space IR (at 48 kHz) are
>   computed in the bake's idle slices on the menu before any gesture (`SynthesisFactories.warmSteps`);
>   the gesture builds the context and wraps them. The `AudioContext` constructor itself cannot move.
> - Development only: the engine module accepts its own hot updates by reloading the page (an edit
>   used to leave the previous AudioContext running).

> **Changes for the epilogue motif's bake (2026-10-23; measured in docs/evidence/AUDIO_RUNS.md,
> *Epilogue motif bake*).** The epilogue's motif (34 s of felt piano, the longest bake) could still be
> baking when the epilogue began, and at the idle pace behind the river view its 5 s wait was far too
> short; S11E lost it.
> - `SoundBank.prioritize(motif | null)`: bake this motif of the level set next, ahead of everything
>   still pending (a bake in progress is set aside and resumed later, with the same result); null puts
>   it back. One at a time.
> - `AudioManager.awaitMotif(motif | null)`: a moment is waiting for this motif, or comes next with it.
>   The engine asks the bank for it first and, off play, bakes at the loading overlay's pace (16 ms
>   timer slices) until it is baked (§6.1's pacing gains this one case; play keeps its 4 ms). The
>   moments ask for their motif when it is not baked at the trigger and let go when it plays, when they
>   give up and when they end; from chapter 9's Revelation until the epilogue starts they ask for the
>   epilogue's (§8.7 M1 → M2: it plays next and is the longest bake).
> - §8.7 M2: the epilogue waits up to 15 s from its start for its motif (`EPILOGUE_MOTIF_WAIT_SEC` in
>   `moments.ts`; the other moments keep their start time plus `motifLateReleaseSec`, never under 3 s).
>   Its text takes minutes to read and the music stays held meanwhile; the latest start, the motif and
>   its 6 s of silence stay under `HOLD_MAX_SEC`.

> **Changes for slow computers (2026-10-23; measured in docs/evidence/AUDIO_RUNS.md, *Slow
> computers*).** On a main thread twice as slow the Revelations' motifs and the epilogue's were missed:
> the render was the cost (the epilogue's 3.1–3.7 s of main-thread work).
> - §8.5: the felt piano's per-sample loops (each partial, both strings of a twinned partial in one
>   loop, and the room) run as plain functions between the generator's yields: the same arithmetic in
>   the same order, so the same samples (every motif's hash pinned from the old render), about 5x faster.
> - §6.1: `SoundBankOptions.motifRenderer`: where a Web Worker can be made, the bank sends a set's motifs
>   to it one at a time, in its own order (the awaited one first), as soon as the set is asked for; the
>   main thread only wraps the result. No worker (node, jsdom, `file://`, `?audioworker=off`) or a
>   failed one: motifs bake in the main thread's slices as before. `BankStats` gains `awaited` and
>   `offThread`.
> - `SoundBank.prioritize`: the request stands by key, so an entry dropped and asked for again keeps
>   its priority; null (or another motif) sets a bake of the released motif in progress aside, so the
>   queue's own order resumes before the rest of it. `AudioManager.awaitMotif` passes every call on (a
>   repeat too); the moments ask again only when the moment that wants the motif changes, so the
>   epilogue asks for its own motif after the Revelation asked for it as the next one.
> - Measurement only: `?audioworkerslow=N` keeps the worker busy N times as long (DevTools CPU
>   throttling slows the page's main thread, never a worker).

Project: this repository, branch `feature/last-thaw` @ `f4c16ed`,
working tree clean. Nothing in the project was edited. The shared contract is
`contract.ts` next to this file. It was type-checked against the real project types with the
project's own `tsc` and strict tsconfig: a scratch `tsconfig` used `rootDirs`, so
`../core/types` and the other imports resolved into the project. A probe that removed one
`ObstacleKind` key failed as expected, which proves the exhaustiveness check is live.

**Facts I checked in the code on top of the three maps**

- **Tower standing test.** `ObstacleBody` has `countedKnocked` on the origin body
  (`world.ts:133`, `:1170-1174`). It is set when the body moves more than 1.5 m. An anchored tower
  only moves once it is uprooted, so `active && anchored && state==='intact' && !countedKnocked`
  is a safe standing test (`towerStanding` in the contract).
- **Story hooks need no edit to `storyRun.ts`:**
  - `useStoryRun` exposes `outcome.completedAt` and `epilogue` (`storyRun.ts:43-60`).
  - `StoryPointsTracker.add()` returns a `DestroyedUnit` with `placement` (`scoring.ts:190-211`).
  - `landmarkIndex(chapter)` maps placements to landmark ids (`storyLevel.ts:94-103`).
- **The Vey house.** It is the landmark `vey-house`, base index 23 in Riverside Town
  (`ch4.ts:113-120`). Its fragment says "a piano nobody had tuned since 2020" and "at ten past six"
  (`ch4.ts:211-212`).
- **The Clachan bell was the warning.** "On the morning of 12 August the power was already off, and
  the valley siren did not reach the glen, so Callum's aunt rang the bell for twenty minutes. Everyone
  heard it. Everyone knew that wrong note, and everyone came down to the road" (`ch8.ts:363-365`).
  This raises the stakes of that bell falling silent.
- **Institutions list.** `INSTITUTIONS` is exported from `bible.ts:29-41`, so the "human document"
  rule can be computed.
- **Unlock gestures.** The existing music retry already listens on `click`, `touchend` and
  `keydown`, because pointerdown does not grant activation on touch (`music.ts:413-424`).
- **Dev server.** `vite.config.ts` pins `server.port 5173, strictPort`. A CLI `--port 5199` overrides
  it. The Story agents plugin runs in any dev or preview server, so browser runs must turn story AI
  off in `localStorage` (`iceberg-river.story.v1`).

---

## 0. Where A or B won, point by point

| Decision | Taken from | Why |
|---|---|---|
| Music stays on the HTMLAudio player, with no `MediaElementAudioSourceNode` | both | Music survives a missing or suspended AudioContext, and every test in `music.test.ts` still passes. |
| Ducks applied through a **router** that owns every `music.*` call; `music.ts` gains only one additive export (`musicPlayer`) | B | A's in-player `setDuck` would change the tested fade code. The router changes none of it. |
| Removing music at a moment = **hold** (router plays cue `null`: the player's own 3 s fade, then pause, then resume where it stopped) | B | It reuses tested code, stops decoding, and the piece resumes from where it paused. A's duck to 0 would let the piece run on unheard. |
| One-shots **baked in pure TypeScript** (`Float32Array`) | B | Every recipe becomes testable in node vitest and is deterministic across engines. A's `OfflineAudioContext` lab is kept for checks of the whole graph. |
| **No glue compressor on effects**; one master limiter whose makeup gain is cancelled | A | A bus compressor would flatten the small-versus-large contrast the user asked for. |
| Collision magnitude: log impulse plus closing speed, with a worked table | A | Uses both event fields and is fully specified. |
| Break magnitude: **broken mass** (B) blended with the **last hit** (A), against a **per-family typical level** (new) | B + A | Reacts to the actual impact and scale: the 0.6-scale pass chapel is about 3 dB quieter than St Bride's. |
| Landing magnitude from mass × drop | B | It tracks the energy of the landing. |
| Layered events (the causing hit, then the break 15 ms later, plus material layers), at most 4 layers | B | Gives causality and variety. A's caps bound it. |
| Voice caps, stealing, priority weights | A | A's numbers, with the layer count added. |
| Rate limits on **AudioContext time** plus a **per-frame** admission cap | B + A | A `fastForward` burst is bounded twice. |
| Frame coalescing rules | union | §6.3 |
| Scrape loop: B's hiss/rumble/grit/wade layers, A's drive formula, surface table and channel (effects) | B + A | |
| Ocean waves synthesized live from shared noise | A | Saves about 5 MB of baked waves. |
| Bells present **in the background all level** (phrases of 2–4 strokes) with an approach rule | A | The user asked for bells "in the background". |
| Bells also strike **the hour once on approach** (6 in Story, 3 in Arcade), so a falling tower can stop the clock mid-count | B | Ties to "ten past six" and gives the clock that stops. |
| Bell tuning consonant with each chapter cue; Clachan at D5 −40 cents | B | |
| Cracked bell: B's mistunings plus A's 31 Hz buzz and extra inharmonic partials | B + A | |
| Struck-but-standing tower: **shiver** (resonance, no clapper) | B | Subtler and physical. |
| Tower falls: choke, then a dull buried clank under the collapse; no toll | B, at A's restraint | |
| Motif: B's "No. 14", one cell and six variants, with the only full close in the epilogue | B | It is a real progression; A's single phrase with forms was less developed. |
| Felt-piano voice, with the whole instrument 10 cents flat and the D keys untuned | B (A's two-stage decay) | |
| Story progression: B's per-chapter bed, late music entry in Act III and aftermath ducks that deepen; A's consequence trim folded in as a capped "scar" | B + A | |
| Duck invariants (every factor ≤ 0 dB, floor −20 dB during play, property test) | A | |
| Moment table (Revelation, Epilogue, ch8 card, landmark, dam, ch9 sea, Act III entry) | B | |
| Arcade completion and fail stingers | dropped | The user asked to avoid unnecessary effects. |
| Machine emitters that run down when destroyed | B (P1) | "The small sounds that stop". |
| Vey piano strings struck by debris | B (P1, needs a human check) | |
| Calving sounds in the intro | both (P1) | |
| Pause: gate effects and ambience, keep sources running, never suspend | A | No restart races. |
| Unlock stays armed until `running`, checks `navigator.userActivation`, uses `latencyHint: 'balanced'` | A | Escape does not grant activation; the Iris Xe laptop runs under GPU load. |
| Settings order: sliders, then the two toggles | A | Keeps `switches[5]` as Mute music. |
| Settings preview on slider release | B (P1) | |
| `window.__icebergAudio` (state, trace, meter, lab) | A | |
| Gameplay-preservation test (bit-identical session with and without audio) | A | |
| Browser runs on port 5199 | A | |

---

## 1. Goals and non-goals

**Goals**

1. **Arcade mode has background music** (the `wonder` playlist) and the same physical sound effects
   as Story.
2. **Story Mode gets sound design that reads as a quiet tragedy:**
   - weight without spectacle;
   - consequence carried by what *stops* sounding (a bell, a machine, the music taking a breath);
   - a recurring original piano motif tied to the Archive's human documents.
3. **Event-driven sound for every listed category**, with loudness, length and timbre following the
   real impact. A light tap sits about 20 dB below a house collapse and about 26 dB below a dam break.
4. **One `AudioManager` with three channels:**
   - **music:** the recorded cues plus the synthesized motif;
   - **ambience:** wind, river, falls, sea, flood, bells, machines;
   - **effects:** one-shots plus the scrape loop.

   It also has master volume and mute, behaves correctly on pause, hidden tab, level change, retry
   and leaving, and unlocks only after a user gesture.
5. **No repetition fatigue:** seeded variants (SEED = 42), jitter, shuffle bags, rate limits and
   voice caps.
6. **Everything procedural or already public domain:**
   - no new recordings, and no asset to license;
   - every source is documented;
   - the motif is an original composition (2026).
7. **Verifiable without ears.** Every claim is checked by a number: an event-to-sound trace, voice
   counts, AudioParam values, baked-PCM analysis in node, `OfflineAudioContext` renders in Chrome,
   and CDP-driven browser runs.
8. **Gameplay, physics, collisions and narrative are unchanged.** Audio only listens, and a test
   proves it bit for bit.
9. **Budget:**
   - `frame()` median ≤ 0.05 ms and p99 ≤ 0.3 ms on the Iris Xe laptop;
   - baked PCM ≤ 22 MiB at peak;
   - no allocation per frame in the hot paths.

**Non-goals**

- **Never in the game, in either mode:**
  - human voices of any kind (screams, crowds, singing);
  - sirens or alarms;
  - explosions, fire roars, sub-drops, risers or "braaam" hits;
  - triumphant stingers on destruction;
  - a funeral toll.

  `SOUND_SOURCES` is a closed list, and a test enumerates it.
- **Music is not re-routed through Web Audio** in this version. The upgrade path is in §7.1.
- **No adaptive music re-composition.** The six recorded cues and their per-chapter mapping
  (`chapters.test.ts:204`) are unchanged.
- **Safari and iOS are not targets.** iOS `el.volume` is read-only, so music ducking does nothing
  there, as music volume already does today.
- **No HRTF.** Panning is `StereoPannerNode`: cheap, deterministic and traceable.
- **The late arrival of the agents' reflection text makes no sound.** The player is reading.

---

## 2. Architecture and routing graph

### 2.1 Layers

```
App (React)
  useAudioDirector  ── settings, unlock, visibility, cue/trim, Story moments, M key   [C]
        │ calls
        ▼
  audio: AudioManager (singleton; NullAudioManager without Web Audio)                  [A]
    ├─ MusicRouter ── the only caller of music.play/setVolume/setMuted/unlock          [A]
    │     └─ existing CrossfadeMusicPlayer (HTMLAudio, unchanged)
    ├─ graph: buses, strips, limiter, space, meters                                    [A]
    ├─ voice pool, limits, ducks, trace                                                [A]
    ├─ SoundBank (baked PCM → AudioBuffers), NoiseBank, ambience voices                [B]
    └─ beginSession() → SessionAudio (per attempt)                                     [A]
GameView (R3F)
  <GameAudio/> after <CameraRig/>: session listener → ring → per-frame resolver,
              ambience inputs, bells, story-in-play ducks                              [C]
```

**Data flow:**
1. `session.events` (synchronous, inside `session.update`) fills a preallocated ring.
2. `GameAudio`'s `useFrame` (after GameLoop and CameraRig) drains it.
3. It builds `SoundRequest`s and calls `SessionAudio.play()`, which spatialises, limits, steals and
   starts buffer sources on pre-built strips.
4. Continuous layers are updated from polled state at 10–30 Hz.

### 2.2 Routing graph

```
effect one-shot  AudioBufferSource(rate) ─► strip[i]: Gain ─► Biquad LP ─► StereoPanner ─┬─► effectsIn
                                                                                          └─► send[i] ─► spaceIn
scrape loop      noise / grit loop ─► filters ─► Gain ───────────────────────────────────────► effectsIn
bell strike      AudioBufferSource ─► bellStrip[j] (same shape) ─► ambienceIn   (+ send 0.25 ─► spaceIn)
ambience loops   NoiseBank / baked loops ─► filters ─► Gain [─► StereoPanner] ─────────────► ambienceIn
                 (control buffers ─► GainNode.gain: gusts and babble move with no JS)
motif            AudioBufferSource ─► motifGain ─► motifBus                (piano room baked into the buffer)

effectsIn  ─► effectsShelf (highshelf 6 kHz, act gain) ─► effectsGain = effects × duck.effects ─► gate ─┐
ambienceIn ─► ambienceGain = ambience × duck.ambience ─────────────────────────────────────────► gate ─┤
motifBus   ─► motifGain = music × (musicMuted ? 0 : 1) × motifCalib ───────────────────────────────────┼─► preMaster
spaceIn    ─► Convolver (procedural stereo IR 2.2 s, 15 ms predelay) ─► spaceReturn (−6 dB) ──────────┘
preMaster ─► limiter (DynamicsCompressor −3 dB, ratio 20, knee 0, 1 ms / 120 ms) ─► makeupComp (−1.71 dB, measured)
          ─► master = masterVolume × (soundMuted ? 0 : 1) × hiddenGate ─► destination
[debug] AnalyserNode taps: effectsGain, ambienceGain, motifBus, master

recorded music (outside the graph):
  el.volume = musicVolume × masterVolume × 10^((trimDb + duckDb)/20) × equalPower(level)
  muted (paused) when musicMuted || soundMuted || hidden; cue null while any hold is active
```

- **Strips are built once at unlock:** 28 effect strips, 4 bell strips and the bus chain, about 130
  nodes. A play creates only one `AudioBufferSourceNode`.
- **Spare strips:** a stolen voice fades out over 25 ms on its own strip while the new voice starts
  on another, which is why there are 28 strips for 24 voices.
- **Two gates:** `gate` sits on effects and ambience only, so the pause menu keeps its music; the
  pause music duck is separate. `hiddenGate` is on the master.

### 2.3 Gain staging and headroom

All levels are dBFS peak at `preMaster`, with sliders at 1 and no ducks. These are design targets;
the render checks in §11.2 measure them.

| Layer | Channel | Target |
|---|---|---|
| Light tap (m 0.13) | effects | −34.6 |
| Pine hit (m 0.43) | effects | −27.9 |
| House holds (m 0.67) | effects | −20.6 |
| Tree falls (typical) | effects | −17 |
| House collapse (typical) | effects | −14, about −26 RMS over 2 s |
| Church nave collapse | effects | −12.7 |
| Dam break (loudest designed one-shot) | effects | −9, about −20 RMS over 3 s |
| Splash | effects | −34 to −16 |
| Plunge / ocean entry | effects | −13 / −15 |
| Scrape loop (22 m/s, rock, 30 t) | effects | ≤ −22 RMS |
| Wind bed | ambience | −44 + 10·amount RMS (−40 to −35) |
| River | ambience | −36 to −24 RMS |
| Waterfall at 20 m | ambience | about −22 RMS |
| Flood near the breach | ambience | about −18 RMS |
| Surf at wave peaks | ambience | −30 to −22 RMS |
| Bell strike at 40 m | ambience | −18 (about −39 at 565 m, low-passed to about 2.5 kHz) |
| Motif phrase | music | −14 peak before calibration (§8.5) |
| Recorded music | outside the graph | `el.volume` 0.6 by default; the recordings' peak and loudness are measured (§11.2 R10) |

**Worst designed coincidence:**
- A dam break (−9) plus the flood (about −12 peak), one waterfall and the scrape sums to about −1 dBFS
  of coincident peak; the RMS sum is far lower.
- `makeRoom` (§8.7, M11) dips ambience by 4 dB while a P0 failure plays.
- Default sliders of 0.8 give another −1.9 dB.
- The limiter catches the rest. It should not engage in normal play: p99 reduction ≤ 0.5 dB is a
  pass criterion.

**Music is outside the limiter.** The `makeRoom` dip on music (−3 dB) and the narrative ducks keep
it below structural failures. The decoded tracks' peaks are measured (R10), so the residual risk is
a number. If the margin is under 1 dB, cut the effects references by 2 dB.

### 2.4 Event pipeline

**1. Listener** (C, `eventRing.ts`), registered with `session.events.on`.
- Runs synchronously inside `session.update`: up to 6 fixed steps per frame, or hundreds under
  `fastForward`.
- Copies the event into a ring slot (`QueuedEvent`, 128 slots).
- The body lookup happens **here**: `getBody(obstacleId)` behind an `instanceof PhysicsWorld` guard
  fills `placement`, `part` and `massT`.
- Keeps a per-session `Map<obstacleId, ObstacleKind>` for the `'rockSmall'` gone-body quirk
  (`world.ts:1283-1285`).
- On overflow it replaces the lowest-priority slot and counts `overflow`.
- Wrapped in try/catch: a throwing listener would become the "3D view stopped" dialog
  (`GameView.tsx:545-550`). After 5 errors the session's audio disables itself, with one
  `console.warn` and one trace entry.

**2. Frame resolver** (C, `router.ts`): runs once per animation frame in `GameAudio`'s `useFrame`.
It applies the coalescing rules (§6.3), fills pooled `SoundRequest`s, sorts them by
priority × linear gain, and calls `SessionAudio.play()`.

**3. Admission** (A, `voicePool.ts`, `limits.ts`). In order:
1. `frameCap`: 4 requests per frame;
2. global bucket: 40 voices/s, burst 12;
3. family bucket and `perKey` interval;
4. `busy` gate (≥ 12 active voices: only P0–P2, and optional layers are dropped);
5. family and global caps, with stealing.

Every decision is traced with its `cause`.

**4. Scheduling.** A request starts at `ctx.currentTime + 0.005 + startDelaySec`, and its layers at
their `delaySec` offsets. Events carry no timestamps, so same-frame order comes from offsets: the
break plays 15 ms after the hit.

### 2.5 Spatial model

- **Listener:** the camera, read from `state.camera.matrixWorld` with no allocation: position
  (elements 12–14), right vector (0, 2), forward = −(8, 10).
- **One-shots:** A spatialises them inside `play()` from `x, y, z`. Continuous layers and bells:
  C computes the spatial terms with A's pure `spatial.ts` and passes gain, pan and low-pass.
- **Formulas:**
  - distance gain = `(refM / max(d, refM))^rolloff`;
  - air low-pass = `clamp(16000·(refM/d)^0.7, 700, 16000)` Hz beyond `refM`;
  - pan = `panLimit·sin(azimuth)`.
- **Profiles** (`SPATIAL` in the contract): effects 40 m / 1.0 / ±0.5; bells 40 m / 0.9 / ±0.7,
  audible to 1500 m; falls 20 m / 1.1; flood 40 m / 0.8; emitters 25 m / 1.2.
- The camera trails the iceberg by 20–40 m, so the iceberg's own hits are not attenuated.

---

## 3. The AudioManager API

The exact types are in `contract.ts` §14–16. The semantics every implementation must keep:

**`audio: AudioManager`** is an app-lifetime singleton exported from `src/audio/manager.ts`.

- **Availability.** `available` is false under node, under jsdom (`/jsdom/i` user agent), or with no
  `AudioContext`/`webkitAudioContext`.
  - The `NullAudioManager` then constructs no `AudioContext`, `OfflineAudioContext` or `Audio`.
  - It logs nothing, and every call is a no-op, **except the music router**. Volume composition,
    holds and ducks still drive the HTMLAudio player.
- **`unlock()`** is called from a trusted gesture handler.
  - It constructs the context only when `navigator.userActivation?.isActive !== false`, so Chrome
    never logs "The AudioContext was not allowed to start".
  - It creates `new AudioContext({ latencyHint: 'balanced' })` synchronously, builds the graph, calls
    `resume()`, then `attach`es the bank and starts the core bake.
  - It is idempotent. `music.unlock()` runs on the same gesture stack, through the router.
- **`applySettings(levels)`** sets bus gains (`setTargetAtTime`, τ 0.03 s) and pushes the music
  volume and mute to the router. It is idempotent, which StrictMode needs.
- **`setHidden(h)`:** see §4.
- **`duck(key, levels | null, mode)`** handles app-scoped ducks (reading, epilogue, preview).
  Session-scoped ducks go through `SessionAudio.duck`.
  - Levels are clamped to ≤ 0 dB.
  - In dev, an assertion throws on a value above 0 in tests.
- **`playMotif({variant, tempoScale}, delaySec)`** returns a handle with `startsAt`/`endsAt`, or
  null when unavailable, muted or not baked. It never plays two motifs at once: a new one fades the
  old one out over 1.5 s.
- **`prepare(levelSet)`** queues the bakes for a level (its kinds plus Story overlay kinds, its
  bells, its motifs). A new level set replaces the previous one; the core set always stays.
- **`beginSession(info)`** always returns a `SessionAudio`.
  - If the context is not running yet, `play()` drops with `unavailable` and `ambience` stays null
    until it runs.
  - Each session gets a token, and every async continuation checks it.
- **`state()`, `now()`, `dispose()`** (tests and HMR only).

**`SessionAudio`** lives for one attempt.

| Method | Behaviour |
|---|---|
| `play(req)` | Returns the layers started and the drop reason. Never throws and never retains `req`. |
| `playBell(req)` | Returns a `PositionalVoice` (`update(gain, lp, pan)` at 10 Hz, `choke(τ)`). |
| `ambience` | B's live voices, built when the bank's core set and the noise are ready. |
| `setListener(pose)` | Updates the listener used to spatialise one-shots. |
| `setPhase(phase, loading)` | Handles the pause gate, loading gate, and the `pause` and `fail` ducks (A owns these lifecycle ducks). |
| `beginFrame(n)` | Starts the per-frame admission count. |
| `duck(key, levels)` | Session-scoped duck, released automatically by `end()`. |
| `tracing`, `trace(e)`, `reportBells(...)` | Observability. |
| `end(fade = 0.12)` | Idempotent. Ramps every voice, loop and bell of this session to 0 over `fade`, stops them at +0.15 s, disconnects at +0.2 s, releases session ducks and the act3Entry hold, and drops later calls (they are traced as stale). |

**`MusicRouter`** (`contract.ts` §10) wraps the existing `music` singleton.
- **Volume:** effective volume = master · music · 10^((trim + duck)/20). It calls
  `music.setVolume` only when the value changes by more than 0.002, stepped at 20 Hz while a ramp
  moves.
- **Mute:** muted = musicMuted || soundMuted || hidden, through `music.setMuted`, which keeps the
  player's pause-on-mute behaviour.
- **Ramps** are linear in dB. The product of the play-time ducks has a floor of −20 dB; holds are
  not ducks.
- **Holds:** `setCue(c)` records the wanted cue; the router plays `null` while any hold is active.
- **Unlock:** `unlock()` forwards to `music.unlock()`.
- **Construction:** `createMusicRouter({ player: music, ticker })` takes an injected `FadeTicker`,
  so its tests use the same `ManualTicker` pattern as `music.test.ts`.

---

## 4. Lifecycle

**Context state machine** (A, `engine/context.ts`)

| From | Event | To | Action |
|---|---|---|---|
| (start) | no Web Audio, or jsdom | `unavailable` | NullAudioManager |
| (start) | | `locked` | Gesture listeners armed on `window`, capture phase: `pointerdown`, `pointerup`, `click`, `touchend`, `keydown` |
| `locked` | trusted gesture with activation | `starting` | create the context, build the graph, `resume()` |
| `starting` | `statechange` → running | `running` | Disarm the gestures; `bank.attach(ctx)`; start the core bake (if not already baked as PCM) |
| `starting` | still not running after 1 s (for example Escape pressed first: Chrome does not count Escape as activation) | `locked` | Re-arm; keep the context and try `resume()` on the next gesture |
| `running` | hidden tab | `suspended` | `hiddenGate` → 0 (τ 10 ms); `ctx.suspend()` 60 ms later; router `setHidden(true)` (music pauses) |
| `suspended` | visible | `running` | `resume()`; `hiddenGate` → 1 over 150 ms; router `setHidden(false)` (the cue fades in over 3 s); if not running within 1 s, re-arm the gesture |
| any | `closed` or `interrupted` | `locked` | Re-arm; if closed, rebuild the graph and re-attach the bank on the next gesture |

**What happens when**

| Situation | Effects | Ambience | Recorded music | Motif / other |
|---|---|---|---|---|
| Before any gesture | none | none | not created (existing lazy rule) | no context |
| Store phase `loading` (shader warm-up) | requests dropped (`loading`) | voices held at 0 | the cue continues; Act III Story: `act3Entry` hold starts | level bake runs in slices |
| Intro (flyover, calving) | calving sounds only (P1) | fade in over 1.5 s from the first update; background bell phrases may strike | | no events fire |
| Playing | all | all | | |
| Paused (Esc/P, blur, WebGL loss) | `gate` → 0 in 120 ms; sources keep running | the same gate | `pause` duck −8 dB over 0.3 s | nothing restarts on resume; useFrame stops, so polling stops too |
| Resume | gate → 1 over 250 ms | | duck released over 0.3 s | |
| Complete | drift collisions continue; Story: `reading` duck | continues (sea under the archive) | Story: `reveal` hold and motif (§8.7) | |
| Failed | the scrape falls to 0 (speed 0); water and physics sounds continue | continues | `fail` duck: Story −12 dB, Arcade −6 dB | |
| Retry (R), level change, quit, `CanvasErrorBoundary` | `end(0.12)`: everything of this token stops within 150 ms | | Arcade: the same cue continues on retry and level change; quitting to a menu fades out over the existing 3 s | motif fades over 1.5 s; the level set stays until the next `prepare` |
| Mute all (M or the toggle) | master → 0 over 30 ms | | `setMuted(true)` (paused) | |
| Tab hidden on any screen | master gate 0, then suspend | | paused | the motif freezes in place with the context |

**Guards**

- **Tokens and generations.** Every async continuation carries a session token or a generation
  number: bank attach, `resume()` promise, bell lookahead, motif timer and hold release. A stale one
  does nothing.
- **StrictMode** mounts, unmounts and remounts in development. Test: for token 1, sources started
  equals sources stopped, and only one listener subscription is live per session.
- **Rapid toggles.** 10 pause toggles in 1 s end in a consistent state (a generation counter on the
  gate).
- **Loading gate.** `GameAudio` reads `useGameStore.phase === 'loading'`. The session reports
  `'intro'` before the loading overlay is gone (`GameView.tsx:634-641`).

---

## 5. Settings and UI changes

**New fields.** They go into `Settings`, `defaultSettings` **and** `sanitizeSettings`. The key stays
`iceberg-river.settings.v1`; old saves pick up the defaults.

| Field | Default | Sanitising |
|---|---|---|
| `masterVolume` | 1.0 | finite number clamped to 0..1, otherwise the default (same as `musicVolume`, `appStore.ts:113-116`) |
| `ambienceVolume` | 0.8 | same |
| `effectsVolume` | 0.8 | same |
| `soundMuted` | false | `bool()` |

`levelsFromSettings(s): AudioLevels` (A, `settings.ts`) produces
`{master, music, ambience, effects, musicMuted, soundMuted}`.

**Sound fieldset**, in this order (`SettingsScreen.tsx`, C), using the existing `SettingRow`,
`Toggle` and slider pattern: `aria-labelledby`/`aria-describedby`, `aria-valuetext "NN percent"`,
and the `.num` output.

1. **Master volume** (slider, new): "Everything you hear. M mutes all sound."
2. **Music volume** (existing slider). The copy changes to "Story Mode plays each chapter's piece;
   Arcade Mode plays a lighter one."
3. **Ambience volume** (slider, new): "River, waterfalls, sea, wind and church bells."
4. **Effects volume** (slider, new): "Collisions, breaking structures, splashes and the iceberg's
   slide."
5. **Mute music** (existing toggle, still `switches[5]`).
6. **Mute all sound** (toggle, new, `switches[6]`): "Silence everything without losing the volume
   settings. Shortcut: M."

**Rules for the new controls**

- **Linear amplitude** sliders, as the music slider already is. Whether that law feels right is a
  human question (§13).
- **P1 preview:** releasing the Effects or Ambience slider (pointerup, or keyup after an arrow key)
  calls `audio.preview(kind)`, throttled to 0.4 s.
  - Effects plays `hit.stone.heavy` at m 0.5 and 30 m.
  - Ambience plays a St Bride's strike at 120 m. The bell is requested when the Settings screen
    mounts; if it is not baked yet, nothing plays.
  - The music dips by the `preview` duck while it plays.

**M shortcut.** An app-level keydown listener in `useAudioDirector`.
- It ignores Ctrl/Alt/Meta, `isFormControl(e.target)` (`input.ts:111`), `e.repeat` and
  `transitioning`, and does not collide with A/D/P/R/V/Space/Home/+/−/arrows.
- It toggles `soundMuted` (persisted) and announces "Sound off" / "Sound on" in a visually hidden
  `aria-live="polite"` region.
- It is added to the keys list in `HowToPlay.tsx:285-318`.

**Tests updated in the same change**

- `appStore.test.tsx:96-109`: the exact `toEqual` gains the four defaults. New sanitising cases:
  non-finite, out-of-range and wrong-type values fall back to defaults.
- `App.test.tsx:186-215`: 6 → 7 switches, and `switches[6]` toggles `soundMuted`. The first range
  input stays mouse sensitivity. The three new sliders carry `aria-valuetext`.

**Copy updated** (C):
- `Credits.tsx:47` ("Played in Story Mode only") becomes "Played in Story Mode; Arcade Mode plays
  the first two." Add a line: "Sound effects, ambience, bells and the archive's piano motif are
  synthesized in the browser; the motif is an original composition for this game (2026)."
- `SettingsScreen.tsx:368`.
- `docs/MUSIC_CREDITS.md:3-4`.
- `README.md`:
  - lines 144–145 and 254 (the music bullets);
  - line 290 (the folder map: `audio/ music player, sound engine, synthesis`);
  - lines 314–319 (the music credits paragraph);
  - a new "Sound" paragraph and the AI-assistance attribution (AGENTS.md §6).
- The stale "(WebAudio)" at `docs/STORY_MODE.md:50`.

The tests that pin credits (`StoryUi.test.tsx:584-598`: Musopen, every source link, "public domain",
"CC0") keep passing, because those strings stay.

---

## 6. Sound effects

### 6.1 Building blocks and bake rules (B)

All synthesis is pure TypeScript into `Float32Array` (mono), at the sample rate given in
`SOUND_DEFS`: 32 kHz for bright material, 24 kHz by default, 16 kHz for low-band layers. At play
time a buffer is wrapped once into an `AudioBuffer`, and the browser resamples it.

**DSP blocks** (`synth/dsp.ts`, `synth/blocks.ts`)
- **Noise:**
  - white from mulberry32 (`core/rng`);
  - pink by Paul Kellet's filter;
  - brown by a leaky integrator (0.997), normalised.
- **RBJ biquads:** LP, HP, BP, peak, low and high shelf. Plus a one-pole smoother.
- **Modal resonator:** a two-pole recursive decaying sinusoid,
  `y[n] = 2r·cos(ω)·y[n−1] − r²·y[n−2] + x[n]`, with `r = 10^(−3/(T60·fs))`. That is 3 multiplies
  per sample per mode, and no `Math.sin` in the loop.
- **Grain:** a noise slice into a band-pass with an exponential envelope.
- **Poisson grain train:** the rate λ(t) decays exponentially from start to end.
- **Chirp:** a sine with an exponential frequency glide (bubbles, "pew").
- **Stick-slip train:** impulses at rate r(t) with ±15% jitter into resonators (creaks, groans).
- **Envelopes:** exponential AD/AHD.
- **Reverb:** a comb plus all-pass room (piano only). The shared space IR (`synth/ir.ts`) is
  exponentially decaying stereo noise, low-passed over time.

**Bake rules** (each one is tested)
- Every one-shot variant is **peak-normalised to 1.0**, so `VoiceLayer.gainDb` *is* the intended
  peak dBFS. Loops are RMS-normalised to 0.25.
- A **40 Hz high-pass** goes on every output. **Heavy recipes keep ≥ 50% of their energy above
  150 Hz** and < 2% below 40 Hz, so weight survives laptop speakers and never reads as a cinematic
  boom.
- **Edges:** the first sample is < 1e-3. A 30 ms cosine fade-out ends each buffer, and the last
  20 ms sit below −70 dBFS RMS. DC offset < 1e-3. No one-shot is longer than 6 s.
- **Determinism:** the seed is `hash(SEED, id, variant)`, so two bakes are identical and the bank has
  a checksum.
- **Slicing:** bakes run in ≤ 4 ms slices (`requestIdleCallback`, falling back to
  `setTimeout(0)`), in priority order: core, then the level set, then bells, then motifs.
  - The core bake starts at unlock and is ready long before the first level, because the menus are
    idle.
  - The level set is requested by the director as soon as a level or chapter is chosen.
  - If a buffer is not ready, the request is dropped as `notReady`: silence, never a glitch.
- **Memory**, from `SOUND_DEFS` arithmetic and checked by a test against `BANK_BUDGET_BYTES`:
  - core 4.99 MiB;
  - all level sounds 9.04 MiB (a single level uses fewer);
  - Story extras 1.37 MiB;
  - bells for two churches 2.66 MiB;
  - the longest motif (epilogue, 34.2 s) 3.13 MiB, freed after it plays.

  The peak stays under 22 MiB. The PCM is freed once wrapped.

### 6.2 Magnitude model (C, `game/magnitude.ts`; constants in the contract §4)

**Collision.** J = `impulse` (t·m/s), v = `relSpeed` (m/s).

```
m      = clamp01(0.75·ln(1+J)/ln(1501) + 0.25·min(1, v/25)·min(1, ln(1+J)/ln(21)));   m < 0.08 → silent
         (the last factor since the fix round, S4: the speed counts as far as the contact moved momentum)
level  = HIT_LREF[sound] + 26·(m − 1)            sound = KIND_SOUNDS[kind].hit, or hitHeavy at m ≥ 0.55
rate   = 1.06 − 0.12·m                           heavier sounds lower
lowpass= 1500·2^(3.2·m) Hz                       soft taps dull, hard hits bright
layers = [main]
       + weight.thump if m > 0.55, gain (m−0.55)/0.45 at −14 dBFS
       + hit.ice at −8 dB re main if m ≥ 0.3 and the kind is not ice   (the iceberg's own voice)
       + glass.pane at −8 dB if KIND_SOUNDS.paneAbove and m above it   (vehicles)
```

| Hit | J | v | m | Peak (dBFS) |
|---|---|---|---|---|
| Roll-back tap | 2 | 2 | 0.12 (0.13 before the gate) | −34.9 (−34.6) |
| Small rock | ≈10 | 10 | 0.32 (0.35) | −29.6 (−29.0) |
| Pine (holds) | 23 | 10 | 0.43 | −27.9 |
| House holds ("shook") | 160 | 15 | 0.67 | −20.6 |
| Church nave holds | 340 | 15 | 0.75 | −18.6 |
| Dam monolith holds | 770 | 12 | 0.80 | −17.2 |
| Boulder, Ravine Run narrows | ≈480 | 32 | 0.88 | −15.0 |
| Cooling tower holds | 1460 | 15 | 0.90 | −14.7 |

**Break.** The events carry no magnitude, so it is built from the body and the hit that broke it:

```
W     = clamp01(log10(1 + massT) / log10(151))       massT = the broken body's mass (scale³ included)
mHit  = m of the last collision on that placement within 0.3 s (0 if none: flood sweeps, debris pushes)
M     = clamp01(0.7·W + 0.3·mHit)
level = clamp(ltyp + span·(M − mtyp), ltyp − 12, ltyp + 4)      BREAK_LEVELS[sound]
rate  = 1.05 − 0.10·M
```

| Break | massT | mHit | W | M | Peak (dBFS) |
|---|---|---|---|---|---|
| Fence segment | 0.08 | 0.25 | 0.02 | 0.09 | −22.9 |
| Pine felled | 2 | 0.43 | 0.22 | 0.28 | −17.0 |
| Truck | 8 | 0.60 | 0.44 | 0.49 | −16.8 |
| House | 12 | 0.67 | 0.51 | 0.56 | −14.0 |
| Pass chapel nave (scale 0.6) | 4.75 | 0.60 | 0.35 | 0.42 | −15.6 |
| Church nave (scale 1) | 22 | 0.75 | 0.63 | 0.66 | −12.7 |
| Factory hall | 55 | 0.80 | 0.80 | 0.80 | −11.2 |
| Apartment block | 110 | 0.85 | 0.94 | 0.91 | −9.7 |
| Cooling tower | 120 | 0.90 | 0.96 | 0.94 | −9.4 |
| Dam monolith | 97 | 0.80 | 0.91 | 0.88 | −9.0 |

So a light tap (−34.6) sits about 20 dB below a house collapse and 26 dB below a dam break, and the
big sounds also last 10–20 times longer.

**Other events**

| Event | Mapping |
|---|---|
| `landed` | `mL = clamp01(log10(1 + mass·drop)/log10(6001))`, silent if drop < 0.4 m. Level = −14 + 14·(mL − 1). Water variant if `inOcean \|\| afloat` after the step. Examples: 30 t × 1 m → 0.39; 30 t × 6 m → 0.60; 220 t × 30 m → 1.0. |
| `waterfallCrossed` | Replaces that frame's `landed` with `water.plunge` at −13 + 20·log10(0.8 + 0.2·min(1, drop/30)). |
| `splash` | Merged over 120 ms: i = 1 − Π(1 − iₖ), at the intensity-weighted centroid. Size: small below 0.35, medium below 0.7, otherwise large. Level = −16 + 18·(i − 1). A second voice in one window only if more than 30 m away. |
| `iceChipped` | a = min(1, amount/chipAmountRef); level = −30 + 8·(a − 1). `chipAmountRef` is pinned to the 95th percentile of `amount` in the existing session-test run logs. Masked (dropped) when a same-frame collision has m > 0.75; otherwise it is an optional layer on that hit at +10 ms. |
| `absorbed` | Merged over 100 ms; level = −24 + 6·(clamp01(log10(1 + mass)/log10(26)) − 1). |
| Terrain wall or bank (no event) | d = impact − prev·e^(−2.5·dt). If d ≥ 0.12 and no collision or landed this frame: m = clamp01((d − 0.12)/0.9), level = −20 + 14·(m − 1), `ice.wallScrape`. |
| `enteredOcean` | `ocean.entry` once per session at −15 + clamp(2·log2(mass/30), ±3), plus `ambience.ocean.surge()`. |
| `airborne`, `complete`, `failed` | No one-shot. The scrape cuts (§7.2); the phases drive the ducks. |

### 6.3 Frame resolver rules (C, `router.ts`)

| # | Rule |
|---|---|
| F1 | **Hit then break on one placement** (same frame, or within 0.3 s) → one break request. Layers: [the hit at its collision level, delay 0] + [break main at +15 ms] + [`brkLayers`] + [`debris.settle` in Story for house, timber and masonry breaks]. |
| F2 | **Several bodies of one placement** (a church's 3 bodies, a dam's monoliths) within `BREAK_MAG.coalesceSec` (0.7 s; dam 2 s) → one break, with mass summed into W. Later bodies of an already-broken placement add at most 2 add-ons (`masonry.collapse.small` at −9 dB re the main level). |
| F3 | **`landed` + `waterfallCrossed`** in one frame → `water.plunge` only. |
| F4 | **`iceChipped` after a collision** on the same frame → an optional chip layer on that hit, or masked (F-chip above). |
| F5 | **Splash bursts** are merged (§6.2). |
| F6 | **Stone barrier** (it never emits `obstacleBroken`): the first stone of a placement hit with m ≥ 0.45 plays `stone.scatter` (perKey: placement, 2 s). Later stones play ordinary hits under the hit limits. |
| F7 | **`treeFelled` with its collision** → one tree request with `hit.wood` as layer 0. From the third tree within 1 s, only the crack portion plays (layer gain −6 dB, no ground whump: LOD). |
| F8 | **Absorbs** are merged over 100 ms. |
| F9 | **Kind fallback:** `'rockSmall'` from a gone body uses the cached kind. |
| F10 | **Drift and failed phases:** collisions and splashes still play (the world is alive). In Story the `reading` duck quietens them. |
| F11 | **Every event** gets a trace entry: played, coalesced, or dropped with a reason. |

### 6.4 The sound table

Columns, as in the contract: **P** = priority (0 structural … 3 minor); **Var** = variants × seconds;
limits = `FAMILY_LIMITS` (requests/s, burst, voice cap, perKey); jitter = `VARIATION`. Every
recipe gets the bake rules of §6.1.

| Sound id | Trigger (exact) | Recipe (B) | Magnitude | Var | Limits | P | Ch |
|---|---|---|---|---|---|---|---|
| `hit.stone.light` | `collision` on rockSmall, rockMedium, rockCluster (m < 0.55) | Click: 3 ms white noise into a 3.2 kHz band-pass (Q 0.9), τ 6 ms. Modes {520, 830, 1290, 1920, 2750} × (0.9–1.1 seeded), T60 40–90 ms, amps 1/.6/.45/.3/.2. 6–10 grit grains at 1.5–5 kHz within 40 ms. | collision | 4 × 0.3 s | hit: 16/s, 6, 8, 0.15 s per obstacle | 3 | fx |
| `hit.stone.heavy` | rock kinds at m ≥ 0.55; boulder, stoneBarrier, dam, monument and roadBridge holds | Modes {160, 270, 430, 690, 1050} × jitter, T60 120–220 ms. Click and 10–16 grit grains. (Weight comes from the thump layer.) | collision | 3 × 0.7 | hit | 2 | fx |
| `hit.ice` | iceBlock and iceField hits; ice layer under other hits at m ≥ 0.3 | 3 ms half-cosine plus a 12 ms noise burst (τ 4 ms) exciting modes {210, 395, 640, 1020, 1710, 2830} Hz with T60 {180, 140, 110, 80, 55, 35} ms. Crack: band-pass 4.5 kHz (Q 1.2), 25 ms. Ice tick: sines at 2.4, 3.9 and 5.6 kHz (±5%), τ 12–30 ms, −14 dB. | collision | 4 × 0.5 | hit | 3 | fx |
| `hit.wood` | trees that hold, fence, footbridge, boat, chalet, barn, logPile | Knock: 6 ms noise into modes {180, 410, 690, 1150} (±8%), T60 50–90 ms. Bark crunch: 8–14 grains at 1.8–3.5 kHz (Q 2, τ 4–8 ms) within 30 ms. | collision | 4 × 0.35 | hit | 3 | fx |
| `hit.metal.panel` | car, guardrail, skiLiftPylon, trafficLight, pipeline (light) | Plate modes × {1, 1.41, 1.73, 2.24, 2.65, 3.16, 3.6}, f0 300–500 Hz, T60 0.15–0.4 s. Click excitation; low-pass 7 kHz; body noise in a 300 Hz band-pass, τ 40 ms. | collision | 3 × 0.5 | hit | 3 | fx |
| `hit.metal.heavy` | truck, bus, railWagon, tank, factoryHall, pylon, windTurbine, pumpjack, oilRig, waterTower | Free-bar modes 1 : 2.76 : 5.40 : 8.93 : 13.34, f1 140–260 Hz, T60 0.9 falling to 0.25 s, amps 1/.7/.5/.3/.2. Hollow body: noise in a 120 Hz band-pass, τ 60 ms. | collision | 3 × 1.2 | hit | 2 | fx |
| `hit.masonry` | house, church, lighthouse, apartmentBlock, coolingTower, smokestack, silo hold ("shook") | Thud: sine 110 → 70 Hz, τ 80 ms, plus brown noise low-passed at 500 Hz, τ 120 ms. Plaster grit: 20 grains at 900–2500 Hz over 250 ms, thinning. | collision | 3 × 0.6 | hit | 2 | fx |
| `weight.thump` | layer under hits at m > 0.55, and inside breaks | Sine sweep 95 → 48 Hz over 120 ms (τ 90 ms). Brown noise low-passed at 150 Hz. **A 180–300 Hz band-pass body**, so the weight survives laptop speakers. | (m−0.55)/0.45 | 3 × 1.0 | hit | 2 | fx |
| `stone.scatter` | F6 (stone barrier breaking apart) | One heavy stone knock, then 3–6 tumble knocks (heavy stone modes) at decreasing spacing from +60 to +700 ms, each 2–6 dB lower. Gravel spill grains, 0.4–1.1 s. | m of the first hit | 2 × 1.1 | scatter: 2/s, 2, 3, 2 s per placement | 2 | fx |
| `ice.chip` | `iceChipped` (F4) | 3–7 sine pings at 3–7.5 kHz (τ 15–40 ms, spaced 10–60 ms). Tink modes at 3.8 and 6.1 kHz (T60 30 ms). A flick high-passed at 5 kHz. | chip | 4 × 0.2 | chip: 6/s, 3, 2 | 3 | fx |
| `ice.absorb` | `absorbed` (merged) | Crunch grains at 0.4–2.5 kHz over 120–200 ms. Settle: brown noise low-passed at 400 Hz, τ 150 ms. | absorb | 3 × 0.3 | absorb: 4/s, 2, 2 | 3 | fx |
| `ice.wallScrape` | impact rise with no event (§6.2) | Brown plus pink noise through rock band-passes {700, 1400, 2600} Hz (Q 1.5). Attack 20 ms, τ 150–300 ms. 40 Hz noise AM for roughness; 40/s grit grains. | wall | 3 × 0.7 | wallScrape: 5/s, 2, 2 | 3 | fx |
| `ice.land.ground` | `landed` on land | Sine 70 → 45 Hz (τ 150 ms), crunch grains, ice tick, and `hit.ice` modes at −6 dB. | landing | 3 × 0.8 | land: 4/s, 2, 2 | 2 (1 if drop ≥ 6 m) | fx |
| `ice.land.water` | `landed` onto water | Slap: noise in a 900 Hz band-pass, 2 ms attack, τ 60 ms. Bloop chirp 180 → 90 Hz (τ 80 ms). Spray high-passed at 2.5 kHz, τ 400 ms. 10–20 droplets at 0.3–1.2 s. | landing | 3 × 1.4 | land | 2 | fx |
| `water.plunge` | `waterfallCrossed` (F3) | Large splash core. Whoomph: brown noise low-passed at 300 Hz, τ 0.5 s. A 1.5 s rise of bubbles (chirps). 1.5–2 s of spray. | plunge | 2 × 2.5 | plunge: 1/s, 1, 2, 1.5 s | 1 | fx |
| `splash.small` / `splash.medium` / `splash.large` | `splash` (F5) | **Small:** bubble chirp 600 → 1200 Hz (15–30 ms), noise in a 1.5 kHz band-pass (τ 50–120 ms), 5–10 droplets. **Medium:** slap, 3–6 chirps at 400–1200 Hz, spray high-passed at 3 kHz (τ 250 ms), 10–20 droplets. **Large:** 70 Hz thud for 150 ms, a noise burst in a 300–2500 Hz band-pass (5 ms attack, 0.9 s decay), sheet hiss, 30–60 droplets over 1.4 s, and a submerge whoomp (200 Hz low-pass swell, 0.4 s). | splash | 3 × 0.4 / 0.9 / 1.6 | splash: 8/s, 4, 4 | 3 (2 large) | fx |
| `ocean.entry` | `enteredOcean` (once) | Swell: pink noise through a low-pass sweeping 250 → 1600 Hz over 2.2 s, rising. Break: a burst high-passed at 1.5 kHz, τ 0.6 s. Wash: low-pass 1600 → 400 Hz over 2.5 s while decaying, with foam-fizz grains above 4 kHz. | fixed ±3 dB by mass | 2 × 5.0 | once per session | 1 | fx |
| `ice.calve.groan`, `ice.calve.crack` (P1) | intro calving via `readCalving`: shudder start, break at 1.3 s, landing at 2.05 s; landing uses `ice.land.ground` at m 0.7 | **Groan:** friction-excited ice modes at 38–160 Hz, a 1.3 s swell. **Crack:** a 2 ms impulse, high-pass 1 kHz for 60 ms, **a dispersive chirp 6 → 1 kHz in 40 ms** (the "pew" of lake ice), and a 60 Hz thud (τ 0.3 s, −10 dB). Echo send `calveSend`. | fixed (−22 / −16) | 1 × 1.5, 2 × 1.0 | once per attempt | 1 | fx |
| `tree.fall.pine` / `tree.fall.broadleaf` | `treeFelled` (F7) | **Crack:** 3–6 impulses of 1–2 ms within 40 ms into a 2.2 kHz band-pass (Q 3). **Creak:** a stick-slip train slowing 40 → 20 Hz over 0.3–0.6 s into wood resonators {210, 540, 1180} Hz (Q 6). **Rustle:** pine is pink noise high-passed at 5 kHz; broadleaf is band-passed at 3.5 kHz and fuller. It swells to a peak at 0.9 s. **Ground whump** at 0.9–1.3 s: brown noise low-passed at 250 Hz, a 60 Hz sine (τ 200 ms), branch crackle. | break (mass) | 2 × 2.0 each | tree: 4/s, 3, 4 | 1 | fx |
| `timber.break.light` | fence | 2–3 wood snaps. Each: a 1.5 ms click, a 2.2 kHz band-pass (Q 2) for 25 ms, then splinter crackle for 120–350 ms (Poisson 300 → 20 grains/s, grains 0.5–2 ms in a 1–4 kHz band-pass). | break | 3 × 0.5 | breakLight: 4/s, 2, 3, 0.5 s | 2 | fx |
| `timber.break.medium` | footbridge, boat, logPile | Two snaps, a deck or hull thump (low wood modes), and a 0.6 s timber groan. | break | 2 × 1.2 | breakLight | 2 | fx |
| `house.collapse` | `obstacleBroken` house | **0 s:** masonry crack (noise high-passed at 1 kHz for 15 ms, plus a thud). **0.06–0.9 s, glass that gives way rather than shatters:** 8–14 shards, each 3–5 inharmonic modes at 2.4–9.5 kHz (T60 0.08–0.5 s), first a pane tick, then spread out, at −6 dB re the layer. **0.1–1.2 s:** 3–5 timber snaps at −6 dB, and a timber groan from +0.15 s. **0.2–2.2 s:** slump rumble (brown noise low-passed at 220 Hz, 150 ms attack, τ 0.8 s) and rubble grains at 300–1500 Hz thinning from 60/s to 5/s. **0.9 s:** "roof down" thump. **1.5–3.5 s:** a settle trickle at −20 dB. | break | 3 × 3.5 | breakStructure: 3/s, 3, 8, 1.5 s per placement | 0 | fx |
| `timber.collapse` | chalet, barn (chalet + `glass.pane`) | Two snaps, a 1.2–1.8 s timber groan (stick-slip 70 → 45 Hz into wood resonators), a wood tumble (8–14 wood knocks over 0.2–2 s, thinning), a roof thump at 0.9 s, and a settle. | break | 2 × 3.0 | breakStructure | 0 | fx |
| `masonry.collapse.small` | monument, silo; also the F2 add-ons | Crack (10 ms impulse train into a 1.2 kHz band-pass). Grind: pink noise band-passed at 350 Hz (Q 2), 0.4 s. Rumble: brown noise low-passed at 200 Hz, attack 0.15 s, τ 0.8 s. Crumble grains at 400–2000 Hz, 100/s → 8/s. A 1 s settle. | break | 2 × 2.5 | breakStructure | 0 | fx |
| `masonry.collapse.large` | church (+ `glass.break` stained glass), apartmentBlock (+ `glass.break`), coolingTower, smokestack, lighthouse (+ `glass.pane`), roadBridge | Crack. **Stone groan:** friction-excited low stone modes at 60–220 Hz for 1.2 s (the lean). Grind for 0.5 s. Rumble: brown noise low-passed at 160–220 Hz, attack 0.2 s, τ 1.2–2.5 s, 3–6 Hz AM at 20%. Crumble 120/s → 8/s. Slate: 30–60 two-mode thin-plate clicks at 1.5–4.5 kHz over 0.8 s. A heavy thump. A 2–3 s settle. High-pass at 45 Hz; no boom. | break | 2 × 4.5 | breakStructure | 0 | fx |
| `glass.break` | layer (house in-recipe, church, apartment) | 6–14 shards (3–5 inharmonic modes at 2.4–9.5 kHz, T60 0.08–0.5 s): a first pane tick, then shards spread over 0.05–0.9 s, high-passed at 1.8 kHz. | layer −6 dB | 3 × 1.0 | parent family | 1 | fx |
| `glass.pane` | layer (vehicles at m > 0.6, chalet, lighthouse, trafficLight) | A tick and 3–5 shards over 0.3 s. | layer −8 dB | 2 × 0.4 | parent | 2 | fx |
| `metal.break.light` | guardrail, skiLiftPylon, trafficLight | A panel clang and a short 0.4 s groan. | break | 2 × 0.8 | breakLight | 2 | fx |
| `metal.break.vehicle` | truck, bus, railWagon | A heavy clang, a 0.8 s metal groan bending down 2 semitones, and 2 clangs. | break | 2 × 1.5 | breakStructure | 1 | fx |
| `metal.break.structure` | pylon, waterTower, tank, pipeline, factoryHall, windTurbine, pumpjack, oilRig | **Groan:** a 40–75 Hz sawtooth low-passed at 600 Hz, into two resonant band-passes (Q 10) at 220–320 Hz and 480–700 Hz that drift ±8%. Pitch bends down 3–7 semitones over 1.5–2.5 s, with stick-slip AM at 8–14 Hz. 2–3 rivet pops, 2–4 heavy clangs at 0.3–1.5 s, and a heavy thump. **No explosion, no fire.** | break | 2 × 3.0 | breakStructure | 0 | fx |
| `machine.winddown` | layer for factoryHall, windTurbine, pumpjack, oilRig; also when a P1 emitter stops | Motor harmonics 1–8 gliding 50 → 18 Hz over 2.8 s (τ 1.2 s), low-pass 600 → 150 Hz. Bearing whine 900 → 300 Hz at −24 dB. Gear ticks slowing from 12/s to 1/s through a 1.5 kHz band-pass. A last clunk. The router sets a deterministic rate per kind: pumpjack 0.8, factory 1.0, turbine 1.3, rig 0.7. | layer −4 dB | 2 × 3.0 | parent | 1 | fx |
| `liquid.release` | layer for tank, oilRig, pipeline, waterTower | Bubbles (sines chirping up from 80 to 400 Hz, 20–60 ms, 30/s) over noise low-passed at 400 Hz, decaying over 2 s. | layer −8 dB | 2 × 2.0 | parent | 1 | fx |
| `dam.break` | `obstacleBroken` kind dam (F2, coalesced over 2 s) | Cracks at 0 and +0.15 s (the masonry crack, 1.5× longer). Deep rumble: brown noise low-passed at 140 Hz, attack 0.4 s, τ 3 s. Grinding: pink noise band-passed at 260 Hz (Q 1.5) for 1.5 s. **Rush onset:** noise through a low-pass sweeping 300 → 2500 Hz over 2.5 s with a gain swell, handing over to the flood loop (§7.5). **No explosion layer.** | break | 2 × 5.0 | dam: 1/s, 1, 3, 2 s per placement | 0 | fx |
| `debris.settle` | Story only: appended to house, timber and masonry breaks | Sparse pebble ticks (tiny light stone modes at 1.5–4 kHz) and dust hiss (pink noise high-passed at 2 kHz, −30 dB), thinning from 12/s to 0.5/s over 3 s. "The quiet after." | layer −14 dB | 3 × 3.0 | parent | 3 | fx |
| `piano.strings` (P1, Story ch4) | the tracker unit for landmark `vey-house` is destroyed | The felt-piano partials of F3, A3, D4, E4 and D5 (the motif's notes), struck by a soundboard knock (noise low-passed at 300 Hz for 30 ms) instead of hammers. Onsets spread over 0–80 ms, undamped for 6 s with the untuned beats, low-passed at 2.2 kHz. Starts 0.25 s after the collapse. | −22 dB re the collapse | 1 × 6.0 | piano: once | 1 | fx |

That is 40 one-shot ids and 9 recipe files (ice, stone, wood, glass, metal, masonry, water,
machine, piano), plus bells. The four `emitter.*` loops and `scrape.grit` are baked loops used by
the live voices.

### 6.5 Voices, priorities, stealing

**Caps**
- Global: 24 effect voices on 28 strips; bells 4 voices on 4 strips, at most 2 per church; motif
  1 voice plus 1 fading out.
- **Per frame:** at most 4 requests (each up to 4 layers). At 12 or more active voices only P0–P2
  are admitted and optional layers are dropped (LOD).

**Density compensation.** Each new voice is scaled by `1/√(1 + densityK·activeInFamily)`
(`densityK` 0.35), so a pile-up does not grow in loudness linearly.

**Stealing**
- Each active voice is scored by its estimated current loudness, gain₀·e^(−age/τ_family), times
  `PRIORITY_WEIGHT` (P0 8, P1 4, P2 2, P3 1).
- A new request whose score is more than 1.5 × the lowest active voice's score takes over:
  that voice fades over 25 ms and the new one starts on a free strip.
- **A P0 voice is never stolen except by another P0.**
- Otherwise the request is dropped with `cap`.

**`fastForward`** emits hundreds of steps' worth of events in one frame. The ring keeps the 128
best, admission starts at most 4 requests in that frame, and the buckets run on audio time (which
barely advances during the synchronous burst).

### 6.6 Variation (deterministic)

**Streams.** Separate streams `sfx`, `amb`, `bells`, `motif` and `bake`, each seeded with
`hash(SEED = 42, levelId, attempt, stream)` (FNV-1a over the strings, then `core/rng` mulberry32).
Separate streams mean one subsystem's change never shifts another's sequence. The seed is reported
in `state().seed` and in the trace header.

**Variant choice.** A shuffle bag per sound: every variant plays once before any repeats, there is
no immediate repeat across bag boundaries, and the same variant never starts twice within 40 ms.

**Jitter** (`VARIATION`), applied by A at play time:

| Family | Playback rate | Gain | Filter cutoff | Layer timing |
|---|---|---|---|---|
| hits | ±70 cents (±4%) | ±1.5 dB | ±8% | ±10 ms |
| splashes | ±85 cents | ±1.5 dB | ±10% | |
| breaks | ±35 cents (±2%) | ±1 dB | ±6% | ±10 ms |
| dam | ±20 cents | | | |
| bells | ±2.5 cents | | | ±15 ms stroke jitter |
| motif | 0 | 0 | 0 | 0 |

**Tests** switch jitter off with `lab.variation(false)`, so the same request renders identically.

---

## 7. Ambience

All live voices are built by B (`voices/ambience.ts`) from the shared `NoiseBank`: white, pink and
brown 6 s buffers, plus 30 s smooth random-walk control buffers wired straight to `GainNode.gain`,
so gusts and babble move without JS. C polls inputs into preallocated objects (`contract.ts` §8).

**Rules for every voice**
- `update()` calls `setTargetAtTime` only when a target moves by more than 1%. `cancelAndHoldAtTime`
  is not used.
- The scrape updates at up to 30 Hz; everything else at 10 Hz.
- C copies the numbers out of `river.flowAt`'s reused object immediately, and uses only the
  allocation-free calls: `water.sample(x, z, out)`, `course.projectInto`, `surfaceAt`, `paintAt`.
- `physics.bodies` is rescanned only when `structureVersion` changes.

### 7.1 Wind bed (the room tone)

- **Chain:** brown noise into a band-pass (the act's `WindCharacter.bandHz`, `q`), then gain.
- **Level:** −44 + 10·amount dBFS RMS, with `LEVEL_WIND` per level.
- **Whistle:** levels with amount ≥ 0.7 add pink noise band-passed at 2·bandHz (Q 1.5) at −12 dB.
- **Gusts:** a control buffer at depth `gustDb`. With `troughs` (Act III) the control is shaped by a
  cube, so troughs fall to −20 dB.
- **Airborne:** +6·min(1, airSpeed/30) dB, and the band rises by up to one octave.
- **Purpose:** the silence after a bell or a collapse must still sound like a place, not digital
  zero.

### 7.2 The iceberg scraping and sliding loop (effects channel)

```
v = hypot(vel.x, vel.z);  onLand = grounded && !inOcean && !afloat   (the integrator's own test)
drive  = onLand ? smoothstep(0.8, 5, v)·(0.35 + 0.65·min(1, v/22))·(0.8 + 0.2·min(1, mass/100)) : 0
hiss   = white → BP fc = clamp((500 + 60v)·(6/radius)^0.3, 300, 2600) Hz, Q = SURFACE_SCRAPE.q → 0.08·drive
rumble = brown → LP (90 + 6v) Hz → 0.08·drive·clamp(√(mass/30), 0.6, 2)·smoothstep(2, 20, v)
grit   = 'scrape.grit' loop at rate 0.7 + v/40 → 0.06·drive·SURFACE_SCRAPE.grit (+ LP if the table says so)
wade   = pink → BP 800 Q 0.7 → LP 2 kHz → 0.06·drive        replaces grit when wading or on seabed
```

**What it means**
- A bigger iceberg sounds lower.
- A faster one sounds brighter and louder.
- A heavier one carries more rumble.

**Smoothing**
- τ 0.08 s rising and 0.15 s falling.
- Going airborne cuts it with τ 0.03 s, so a lip launch is heard as sudden quiet and the wind rises.
- Going afloat fades it with τ 0.25 s.
- When the iceberg gets stuck, the drive simply falls with the speed.

**Ground** is sampled at 5 Hz: `surfaceAt`, refined by `paintAt` (asphalt, gravel, dirt).

**Target:** ≤ −22 dBFS RMS at 22 m/s on rock with a 30 t iceberg.

**Transients:** wall and bank hits are the one-shot `ice.wallScrape`.

### 7.3 River and flowing water

**Inputs** (C, every 100 ms):
- `uHead`: the `flowSpeed` of the newest `session.river` sample.
- At the listener: `river.flowAt(camera)` gives `strength` and |v|.
- Streams (only when `session.water` is non-null; it is null on four levels):
  `water.sample(camera, out)`. In a channel: `uS = hypot(vx, vz)`, depth = `surfaceY − groundY`.
- Combined: `level = max(0.6·f(uHead), strength·f(|v|), inChannel ? f(uS)·min(1, depth/1.5) : 0)`,
  with `f(u) = smoothstep(1.5, 14, u)`.

**Voice** (B)
- Pink noise into 4 band-passes (320, 760, 1650 and 3400 Hz, Q 1.5). Each band's gain follows its
  own control buffer, whose playback rate is 0.5 + flowSpeed/12, so the water gets busier as it gets
  faster.
- The top band gets `waterTopDb` (Act III −4 dB: darker water) and × (0.6 + 0.4·turbulence).
- A low flow rumble: brown noise low-passed at 140 Hz.
- Gains: low layer 0.03·level, babble 0.02·level.
- Pan follows the nearest water point.

**Afloat on inland water:** the low layer gains +3 dB with a 0.5 Hz swell. "Laps" (60 ms bursts of
noise low-passed at 600 Hz) are scheduled by the voice itself, 0.5 s ahead, at seeded intervals of
0.7–1.5 s.

### 7.4 Waterfalls

**Sources.** Rebuilt when `water.version` or `river.version` changes, at most every 0.5 s, into a
preallocated `Float32Array(4 × 64)` holding x, z, flow and kind.
- **Stream falls:** contiguous cells with `reach.fall[c] === 1`, one source per cluster at its
  lowest cell, flow q = h·|u|.
- **Trail falls:** the bottoms of `kind === 'fall'` river samples, as `scanFalls` finds them
  (`Particles.tsx:1053-1078`), flow q = flowSpeed·width/10.
- **Dry level cliffs make no sound** until water crosses them.

**Selection**
- Strength = smoothstep(0, qRef, q), with qRef the 90th-percentile flow from a recorded trace,
  pinned by a test.
- The two loudest by strength × distance gain take slots, re-chosen every 0.25 s with 15%
  hysteresis.
- The third slot carries a 1.5 s fade-out of a reassigned source, so there are no jumps.
- Sources beyond 300 m are culled.

**Voice** (B)
- Brown noise plus 0.5 pink, with a +4 dB peak at 250 Hz, then the air low-pass (and 2.5 kHz at
  most), a stereo panner, and gain 0.08·strength·distGain.
- A "thunder" layer (brown noise low-passed at 120 Hz) at `near`.
- A spray layer (high-passed at 3 kHz) at `near`, which is 1 inside 8 m and 0 beyond 40 m.

### 7.5 Dam breach and flood rush

- **Polling:** C polls `water.reservoirs[k]` at 10 Hz: `broken`, `outflow` (≤ 1500 m³/s), `bx/bz`,
  `drained`, `qPeak`. There is no breach event.
- **Rush:** `rush = sqrt(outflow/1500)` at the breach point.
- **Flood:** `flood = (h − steady)/1.5` at the nearest reach cell where `h > steady`. The scan covers
  ≤ 256 cells per tick, round-robin.
- **Input:** `rush = max(...)` with its distance gain (SPATIAL.flood) and pan.
- **Voice** (B), created on its first non-zero update:
  - brown plus pink noise low-passed at (500 + 5000·rush) Hz, capped by the air low-pass;
  - grit band-passed at 2 kHz;
  - gain 0.12·rush·distGain.

  It follows `head = H0/(1 + t/5)²` down by itself, and stops at `drained > 0.98` or
  `outflow < 5`.
- **Sequence:** concrete fails (`dam.break`); its rush onset hands over to this loop; the water
  arrives and slowly drains. There is no stinger. Downstream, debris enters the water as separate
  `splash` events, merged by F5.

### 7.6 Ocean

**Proximity:** `smoothstep(260, 0, coastS − s(listener))` via `projectInto`, or 1 while `inOcean`.
The pan points seaward (`computeOceanFrame`).

**Bed:** a pink noise loop through an automated low-pass and gain, with a surf floor at 25% of the
wave peak.

**Waves**, scheduled live every seeded 7–11 s:

| Stage | Duration | Shape |
|---|---|---|
| Swell | 2.4 s | low-pass 300 → 1500 Hz, rising |
| Break | short | foam: white noise high-passed at 3 kHz, gain 0.06·proximity at the peak |
| Wash | 3.5 s | gain to 25%, low-pass to 450 Hz |

At most 2 waves overlap.

**At sea** (after `enteredOcean`): broader, slower swells (9–13 s), the break 6 dB lower, and laps
against the ice every 0.7–1.5 s, with gain ∝ `bob`.

**Entering the sea:** the one-shot `ocean.entry` plays and `surge()` moves the next wave to 6 s
later, so the two never double up.

**After `complete`:** the sea is what stays audible under the Archive (`reading`: ambience −8 dB).

### 7.7 Church bells

**Churches** (`CHURCH_BELLS`): base placements only, identical in Arcade and Story. Story overlays
add none.

| Level / chapter | Placement | Voicing | Strike note | Why |
|---|---|---|---|---|
| alpine-pass / ch3 | 50 (scale 0.6) | pass chapel, "Assembly Point A" | E5, 659.26 Hz | dominant of the ch3 cue (A minor); small bell, T60 × 0.7 |
| riverside-town / ch4 | 44 | St Bride's, the church on the hill | B4, 493.88 Hz | dominant of E minor (Nocturne); the reference voicing |
| highland-maze / ch8 | 4 | **Clachan kirk, cracked 1911** | **D5 − 40 cents = 573.92 Hz** | "a note slightly wrong" |
| highland-maze / ch8 | 28 | lochside kirk | G4, 392.00 Hz | tonic of The Poet Speaks; **true**, so the player can compare |
| summit-labyrinth / ch9 | 29 (scale 0.85) | fjord chapel | C5, 523.25 Hz | dominant of F major (Träumerei) |

**Finding the towers at runtime**
- The tower is the body with `kind 'church'`, `part 'churchTower'` and that `placement`.
- The bell sits at the tower foot (body origin) + 15.5·scale m up: the belfry centre,
  `church.ts:28-30`.
- Bodies are scanned once, and again when `structureVersion` changes.

**Synthesis** (B, `synth/bell.ts`). Baked per church for the current level at 24 kHz: strike 9 s
(with a 1 s cosine end fade), shiver 4 s, clank 1.5 s.

| Partial (× strike) | 0.5 hum | 1 prime | 1.2 tierce | 1.5 quint | 2 nominal | 2.5 | 2.667 | 3 | 4 |
|---|---|---|---|---|---|---|---|---|---|
| Amplitude (re nominal) | 0.40 | 0.55 | 0.65 | 0.20 | 1.00 | 0.45 | 0.15 | 0.25 | 0.12 |
| T60 (s, × t60Scale) | 14 | 8 | 6 | 3 | 4 | 2.4 | 1.8 | 1.4 | 1.0 |

- **Doublets:** every partial is a seeded doublet split by 0.05–0.15%, the slow natural warble of
  bells.
- **Strike transient:** a 5 ms noise burst into a 3 kHz band-pass at −14 dB, plus a clapper thunk
  low-passed at 400 Hz at −20 dB.
- **Clachan (cracked):**
  - hum ratio 0.485 (flat);
  - tierce 1.17 (a "neutral" third);
  - prime doublet split 0.4%, a **2.3 Hz beat**;
  - extra inharmonic partials at 1.37 and 3.31 (amplitude 0.3, T60 1.2 s);
  - partials from the nominal up get **31 Hz AM at 35% depth for the first 0.4 s** (the buzz of the
    crack);
  - T60 × 0.45;
  - a rattle at −20 dB.

  Its D is 30 cents below the motif piano's untuned D5: wrong even against that piano.

**The pattern: a turret clock, never a toll** (C, `game/bells.ts`; constants `BELL_PATTERN`)

1. **Background phrases.** 2–4 strokes (seeded, **never 1**), at the voicing's stroke interval ±15
   ms. Velocity 1.0 for the first stroke, then 0.85 ± 0.05. Gaps of 45–75 s between phrases.
   - The first phrase falls at session time 6–14 s, so it usually sounds during the flyover or
     calving, establishing the place.
   - Two churches in one level stay at least 20 s apart.
   - Scheduled while the listener is within 1500 m.
2. **The approach hour.** Once per church per attempt, while `'playing'`.
   - It starts when the predicted time to arrival, `(s_church − s_iceberg)/max(speed along course, 1)`,
     is ≤ strokes × stroke + 3 s, within a trigger radius clamped to 120–600 m.
   - It never starts if the player has passed the church.
   - It waits for a phrase in progress to end.
   - **Story strikes six:** the morning of the twelfth, ten minutes before the chalk ("at ten past
     six", `ch4.ts:211`). **Arcade strikes three.**
   - It makes sure the player hears the bell before reaching the church. In ch8 the cracked kirk
     strikes six as the player comes down the glen: the note that once brought everyone down to the
     road.
3. **Scheduling.**
   - Phrases are defined in session time (`rt.time`, which stops while paused) and mapped to the
     context clock with a 0.25 s lookahead.
   - A stroke more than 0.3 s in the past is skipped: there is no catch-up after `fastForward` or a
     hitch.
   - Pausing freezes session time, so a phrase resumes without losing or doubling strokes.
   - Nothing is scheduled during `loading`.
4. **Mix.**
   - Ambience channel.
   - −18 dBFS peak at 40 m, then (40/d)^0.9 and the air low-pass: about −39 dBFS and 2.5 kHz at
     565 m, the Riverside start.
   - Pan ±0.7; space send 0.25.
   - The `PositionalVoice` is updated at 10 Hz while it rings.
5. **Shiver.** When the tower holds a blow (its `shake.t0` changes with amp ≥ 0.15, or a collision on
   the tower body does not break it):
   - the shiver buffer plays: hum, prime and tierce only, no clapper;
   - gain 0.25 + 0.5·amp, capped at 0.6;
   - cooldown 3 s per church.

   The bell resonates; nobody rang it.
6. **Falling silent.** When the tower stops standing (`towerStanding` at 10 Hz, plus an immediate
   check on `obstacleBroken` for the tower body), in **both modes**:
   1. every ringing strike of that church is choked (τ 25 ms);
   2. at +1.1 s, a dull buried clank (all partials, T60 × 0.06, low-passed at 2.5 kHz, −10 dB re a
      strike at that distance) plays under the collapse, on the effects channel;
   3. the scheduler entry is removed for the rest of the attempt (a retry is a new session and
      restores it);
   4. a trace entry `bell-silenced p<placement> strikes=<n>` is written. If it happens mid-hour,
      the clock stopped at, say, four.

   No toll and no replacement sound follow.
   - **Story** adds the `church` duck (music −14 dB, ambience −3 dB, hold 10 s, release 10 s):
     the moment is the absence.
   - **Arcade** gets the same silence, without the duck. A fallen tower cannot ring, so ringing on
     would be a bug.
   - If only the naves shatter and the tower stands, the bell keeps ringing: the truthful outcome.
7. **Expected frequency.** Only ch9's default line breaks a church (the fjord chapel,
   `ch9.ts:150-152`). Elsewhere the player must steer into one.
   - In ch8, if the player destroys the cracked kirk, the true lochside bell keeps ringing later.
   - Only after the run does `ch8-cracked-bell` explain the note they heard.

### 7.8 Machines that stop (P1)

**Emitters.** Standing bodies of kind pumpjack, factoryHall, windTurbine and oilRig
(`EMITTER_FOR_KIND`). They are rescanned when `structureVersion` changes; the 4 nearest within 250 m
are active.

| Emitter | Baked loop (16 kHz) | Length |
|---|---|---|
| Pumpjack | two strokes: a low knock and a creak per stroke, with a 48 Hz motor | 9 s |
| Factory | 50 Hz hum with odd harmonics, sparse clanks | 4 s |
| Turbine | blade swish at 0.75 Hz (pink noise band-passed at 600 Hz, AM) and a 140 Hz gearbox | 4 s |
| Rig | 55/110/165 Hz drone and a pump knock | 4 s |

Gain is 0.05·distGain.

**When an emitter's body stops standing:**
- The slot's loop fades out over 0.15 s. A turbine's playback rate instead ramps 1 → 0.3 over 4 s.
- `machine.winddown` plays at its position, unless the break request already carried it.
- It never restarts in that attempt.

In Act II the busy world is the one being taken apart, one running sound at a time.

---

## 8. Music

### 8.1 How music routes (decision)

**The routing**
- The existing `CrossfadeMusicPlayer` (HTMLAudio) stays exactly as it is; `src/audio/music.ts` gets
  one additive line:
  `export const musicPlayer = createMusicPlayer({...}); export const music: MusicPlayer = musicPlayer`.
- The **MusicRouter** is the only caller of the player after this change:
  - Volume = master × music × 10^((trimDb + duckDb)/20), stepped at 20 Hz during ramps.
  - Mute = musicMuted || soundMuted || hidden.
  - Holds play cue `null`, so the player's own 3 s fade-out and pause apply. Releasing a hold resumes
    the piece where it paused, with the 3 s fade-in.

**Why not route it into the graph now**
1. Music keeps working when Web Audio is missing, locked, suspended or closed.
2. How `el.volume` and `muted` apply through a media-element source varies between engines, and
   the equal-power crossfade depends on it.
3. The player creates its elements lazily, inside its own unlock and retry path. Routing them would
   create an ordering dependency across two unlock paths.
4. Every number in `music.test.ts` and `music.jsdom.test.ts` stays as it is.

**Cost.** The recordings are not under the limiter and cannot be metered in the graph, so their
evidence is `musicPlayer.state()` (the exact `el.volume`). Their decoded peak and loudness are
measured offline (R10).

**Upgrade path.** A `graphBackend` `AudioBackend` that wraps each element in a
`MediaElementAudioSourceNode` into a music bus, behind the same player API.

**The motif** plays on the in-graph `motifBus`, governed by the music slider and mute. It sounds only
while the recording is held, so the two are never heard together.

### 8.2 Arcade

- **The cue:** `cueFor('game', 'arcade', …)` returns `ARCADE_CUE = 'wonder'`: Mozart K.545 allegro,
  then the Chopin A-minor waltz as the backup the never-silent rule needs.
  - These recordings are already verified as PD or CC0, and no new cue type is needed: adding one
    would break the `CUE_TRACKS` key test.
  - The cue is identical across retries and level changes, so the music continues without
    restarting.
- **Menus** stay silent as today. Leaving the game fades out over the existing 3 s.
- **Trim:** −2 dB under the effects.
- **Ducks:** `pause` (−8 dB), `fail` (−6 dB), `makeRoom` (−3 dB on P0 failures), and `dam` (−4 dB
  for 4 s).
- **The same physical world**, with no narrative layer:
  - no settle tails;
  - no aftermath, landmark or church ducks;
  - no motif, no Vey strings;
  - the hour strikes 3;
  - bells still fall silent when their tower falls, because the physics is the same.

### 8.3 Story Mode: the emotional progression per chapter

**Fixed:** the chapter cues (`chapters.test.ts:204`). **Carried by the mix:** the progression comes
from where the music enters, how low it sits, how deep the breath after each loss is, how the world
thins, and the motif. Every step lowers a level; none raises one. The values are in `CHAPTER_MIX`.

| Ch | Act | Cue (recording) | Music bed | Music entry | Wind | Water top / effects shelf / space | Aftermath duck | Scar per loss (cap) | Revelation motif |
|---|---|---|---|---|---|---|---|---|---|
| 1 | I | wonder (K.545) | 0 dB | from the flyover | warm (380 Hz, Q 0.7) | 0 / 0 / 0.10 | −2 dB, release 2 s | 0.25 (1.5) dB | `act1` |
| 2 | I | wonder | 0 | flyover | warm | 0 / 0 / 0.10 | −2 / 2 s | 0.25 (1.5) | `act1` |
| 3 | I | unease (Chopin waltz, A minor) | −1 | flyover | cooler (450 Hz) | 0 / 0 / 0.10 | −3 / 2 s | 0.25 (1.5) | `act1` at tempo 0.94; **the pass chapel strikes six** |
| 4 | II | cost (Nocturne, E minor) | −2 | flyover | town (340 Hz) | −1 / −2 / 0.14 | −5 / 4 s | 0.5 (3) | `act2`; **St Bride's strikes six**; the Vey strings (P1) |
| 5 | II | cost | −2 | flyover | icy, hollow (520 Hz, Q 1.2) | −1 / −2 / 0.14 | −5 / 4 s | 0.5 (3) | `act2` if a human document surfaced. Usually **none**: ch5's always-eligible documents are institutional. Denial has no human voice. |
| 6 | II | cost | −3 | flyover | works (300 Hz) | −1 / −2 / 0.14 | −6 / 4 s | 0.5 (3) | `act2`; machines run down (P1) |
| 7 | III | reckoning (Moonlight adagio) | −4 | **after the opening caption** | thin (720 Hz, Q 1.8, troughs) | −4 / −3 / 0.20 | −8 / 6 s | 0.75 (4) | `act3` |
| 8 | III | remains (The Poet Speaks) | −5 | after the caption | thin | −4 / −3 / 0.20 | −8 / 6 s | 0.75 (4) | `ch8` (also on the chapter card); **two kirk clocks, cracked then true** |
| 9 | III | thaw (Träumerei) | −5, then −10 at the sea (`seaCh9`) | after the caption | thin, then only the sea | −4 / −3 / 0.20 | −8 / 6 s | 0.75 (4) | `act3-bare`; **the fjord chapel strikes six and, on the default line, falls**; the full close is saved for the epilogue |
| Epilogue | — | thaw | −8 reading level | after the motif | — | — | — | — | `epilogue`, the only resolution in the game |

**How the levers work**

- **Aftermath.**
  - Trigger: a placement destroyed with `STORY_POINTS ≥ 100`, deduplicated by C's own
    `StoryPointsTracker` units. That covers homes, community, energy, extraction, industry ≥ 150,
    water, and transport ≥ 100.
  - Shape: it starts 0.3 s after the break, with a 0.6 s attack.
  - Overlaps: the deepest duck wins, and repeats extend the hold up to 10 s.
  - Landmark and church ducks override it.
- **Scar.** Each aftermath also lowers the music permanently for the attempt, by `scarDb`, up to
  `scarMaxDb`, through the session-scoped `scar` duck (attack 4 s). The breath after a loss comes
  back a little lower. A new attempt starts without it.
- **Act III entry.** The `act3Entry` hold runs from `beginSession` (during loading) until 6.5 s into
  `'playing'` (the caption), or 3 s in when narrative is off.
  - The flyover and calving play with no piano, only wind, water and the ice.
  - On release, the `act3Entry` duck starts at −12 dB and releases over 6 s, so the piano enters
    gently. With narrative off there is no caption, so the hold releases 3 s into play
    (`MOMENT_TIMING.act3EntryNoCaptionSec`).
- **The world thins.** Act III darkens the water's top band (−4 dB), narrows the wind with
  near-silent troughs, gives the calving a bigger, emptier echo, and mellows the effects shelf.
  Act II's town and works winds fill the space with the busy world being taken apart.

### 8.4 The recurring motif: "No. 14"

**Identity**

- Original, composed for this game in 2026. Named after No. 14 Church Lane, the Vey house with "a
  piano nobody had tuned since 2020" (`ch4.ts:212`).
- F major / D minor, 3/4, felt piano.
- **The cell, identical at the start of every variant: F4 ♩ A4 ♩ E5 ♩ | D5 (dotted half).** A reach up
  a major seventh, then a step down onto the untuned D: a hopeful reach, an imperfect landing.
- **The instrument is 10 cents flat** (A4 = 437.47 Hz). Unisons sit at ±0.8 cents; **the D4 and D5
  keys are untuned at ±4 cents**, a 2.7 Hz waver on D5. The cracked Clachan bell strikes 30 cents
  below that D5.
- The data is `MOTIF_SCORES` in the contract. Beats are quarter notes; durations in seconds come
  from the score's tempo.

```
Act I  (ch1–3 revelation)   ♩ = 66, mp                          12 beats = 10.9 s + 3 s ring
 RH | F4  A4  E5 | D5 ——— | C5  D5  E5 | G5 ——— (let ring)
 LH | F2+C3 ——— | B♭2+F3 — | A2+E3 ——— | C3+G3 ———
 Ends on the dominant: an open question. (ch3 plays it at tempo 0.94.)

Act II (ch4–6)              ♩ = 58, p                           15 beats = 15.5 s + 4 s
 RH | F4  A4  E5 | D5 ——— | C5  B♭4 A4 | G4 ——— | A4 ———
 LH | F2+C3     | D2+A2  | G2+D3      | B♭2+F3 | A2+E3 (open fifth, no third)
 Dm, Gm, B♭, then hanging on A: unresolved.

Act III (ch7)               ♩ = 50, pp                          12 beats = 14.4 s + 5 s
 RH | F4  A4  E5 | D5 ——— | (rest)  | D4 ——— (the untuned D, an octave down)
 LH |            | D2 (v 0.18) |    |
 The pedal holds D5 through the empty bar: the answer does not come.
Act III bare (ch9)          the same, with no left hand at all.

Ch8 (chapter card and revelation)   ♩ = 50, pp                  12 beats = 14.4 s + 4 s
 RH | F4  A4  E5 | D5 ——— | F4  A4 ———————— (held into the empty bar)
 LH |            | D2+A2  |
 It starts again and stops after two notes: "a hymn they half know".

Epilogue (after ch9 only)   ♩ = 48, ritardando from beat 15 to ♩ = 40, fermata 1.5 beats
                                                                21 beats ≈ 29.2 s + 5 s
 RH | F4  A4  E5 | D5 ——— | C5  B♭4 A4 | G4  A4  B♭4 | A4 ——— | G4 —— E4 | F4 ——— (fermata)
 LH | F2+C3     | B♭2+F3 | G2+D3      | C3+G3       | D2+A2  | C3+G3    | F2+C3+A3
 Bar 5 is a deceptive cadence (still sad); bars 6–7 make the game's only full close, V to I onto F.
 The D5 stays untuned: the damage is not repaired. It lands in F, the key of Träumerei, which
 returns 6 s later.
```

Velocities are in the contract (pp ≈ 0.18–0.3, p ≈ 0.4, mp ≈ 0.5). The pedal lifts at the listed
beats; a note is released at the first lift at or after its written end.

**Score rules, unit-tested**
- 3 beats per bar.
- Every melody note is in {F, G, A, B♭, C, D, E}.
- The cell opens every variant.
- Only the epilogue ends on F.
- The Act III and ch8 variants never resolve.

**Why this progression.** Act I's question ends on C, the key the Mozart returns in. Act II hangs on
A. Act III leaves a hole where the answer should be. Ch8 forgets the tune. The epilogue finally
finishes it, flatly in tune with nothing but itself.

**Arcade never hears the motif**, so it stays tied to the Archive.

### 8.5 The felt-piano voice (B, `synth/piano.ts`) and why synthesis

**Partials.** n = 1..12, below 9 kHz:
- frequency: `f_n = n·f0·√(1 + B·n²)`, with B = 0.00012 (below C3), 0.00025 (C3–C5), 0.0004 (above
  C5);
- amplitude: `a_n = n^−1.5 · |sin(π·n/8)| · e^(−n·f0/(800 + 2600·v))`. That is the strike point at
  1/8 and a felt cutoff rising with velocity.

**Decay.** Two-stage, `0.7·e^(−t/τ1) + 0.3·e^(−t/τ2)`, with:
- `τ1 = 0.45·(262/f0)^0.5 / (1 + 0.15(n−1))`;
- `τ2 = 3.2·(262/f0)^0.6 / (1 + 0.2(n−1))`.

**Strings.** Partials n ≤ 4 are twinned at the unison offsets of the tuning map, so they beat.

**Mechanics**
- attack 4–7 ms, slower when softer;
- a felt thump of 12 ms (low-passed at 350 Hz) at −24 dB·v;
- a key-bed click at −32 dB;
- dampers close with τ 0.12 s, and with τ 0.35 s when the pedal lifts.

**Room.** A small front room baked in: 4 combs and 2 all-passes, RT60 1.3 s, wet at −14 dB,
low-passed at 4 kHz. "The front room full of boxes": close and dry. No shared space send.

**Rendering.** Each motif `{variant, tempoScale}` is rendered when its chapter's set is prepared
(during the chapter card or loading) and freed after it plays.
- Its peak is −14 dBFS.
- `motifCalib` sets its integrated loudness at music volume v to the median measured recording
  loudness at `el.volume = v`, minus 3 LU (intimate). The constant comes from R10 and is pinned.

**Why synthesis, given that nobody can audition it**
1. **No licence chain.** An original score deserves a renderer that is entirely this project's work.
   Free piano sample sets carry terms that would each have to be verified on their source pages.
2. **No bytes.** The 26 MiB track budget has about 1.8 MB of headroom, and a multisampled piano is
   5–100 MB.
3. **It is the story's instrument.** A flat, muffled, slightly untuned piano is the Vey piano. It is
   meant to sound unlike the Musopen grands, and it is never heard beside them (they are held first).
4. **It is measurable:** pitch with stretched partials, onsets, the beat rate and loudness are all
   checked (§10).
5. **Felt piano is the most forgiving piano to synthesize.** The register (F2–G5) and dynamics
   (pp–mp) avoid synthesis's weak spots: bright forte attacks and rich bass strings.

**Fallback.** `MOTIF_SCORES` is data, separate from the renderer. If a human listener rejects the
voice, a licence-verified multisample renderer can replace `piano.ts` behind `RenderMotif` without
touching the score or the moments.
- One candidate is the FreePats Upright Piano KW, which is stated to be CC0.
- Its licence must be verified on the source page and recorded in `docs/AUDIO_CREDITS.md` first.

### 8.6 Which documents count as "human"

`isHumanFragment(doc)` (C, `story/human.ts`) is true for:
- a `letter` or `memory` whose `author` is absent or not in `INSTITUTIONS` (`bible.ts:29-41`);
- a `caption` whose title starts with "Photograph";
- a `record` whose `author` is a character id in `BIBLE.characters`.

A pinned table covers every fragment in `src/story/chapters`. Pinned examples:
- human: `ch4-kitchen-table-note`, `ch4-vey-house-gone`, `ch8-callum-letter`;
- not human: `ch5-ministry-reply`.

### 8.7 Moments: where the music lowers or leaves (never louder)

**Invariants** (A's `DuckMixer`, property-tested)
- Contributions are named and multiply per bus.
- Every factor is ≤ 0 dB.
- During play the music product is ≥ −20 dB; only holds remove music.
- Ramps are linear in dB.
- Music never exceeds master × music × bed.

**Lifetimes.** Holds release themselves at their scheduled end + 10 s, and never last more than
60 s. Leaving mid-motif fades it over 1.5 s.

| # | Moment | Trigger and key | Music | Ambience / effects |
|---|---|---|---|---|
| M1 | **Archive revelation** | `useStoryRun.outcome.completedAt` changes (never on panel mount: "View the river" remounts it). Needs narrative on, ≥ 1 human fragment in `outcome.fragments`, and audio available. | Hold `reveal` at t0 (the cue fades over 3 s). Motif `REVELATION_MOTIF[ch]` at **t0 + 4.0 s**. 4 s of silence after it. Release: the cue fades back in under `reading` (−6 dB) while the panel is open. | `reading`: −8 / −12 dB at t0. "View the river" swaps it for `readingRiver` (−2 / −6). |
| M1′ | Revelation with no motif | narrative off, no human fragment, motif not baked by its start (`motif:late`), or unavailable | `reading` −6 dB only, with no hold | same |
| M2 | **Epilogue** | `useStoryRun.epilogue` goes from null to non-null | Release `reveal`/`reading`; fade any motif over 1.5 s. Hold `epilogue`. `epilogue` motif at **+4.5 s**, then 6 s of silence. Träumerei returns at `epilogueReading` (−8 dB). | −6 / −12 dB |
| M3 | **Ch8 chapter card** (Callum's letter names Mara, `ch8.ts:119-133`) | screen becomes `storyIntro` with chapter `ch8-remains`, narrative on; once per app session; deduped within 1 s for StrictMode | Hold `card`. `ch8` motif at **+1.2 s**. Release 2 s after it ends: "remains" fades in. If Begin is pressed early, the motif fades over 1.5 s and the hold releases. | — |
| M4 | **A Story landmark is destroyed** during play | a tracker unit whose placement is in `landmarkIndex(chapter)` (not a church) | `landmark`: −10 dB, attack 1.5 s, hold 6 s (a repeat extends it), release 8 s | ambience −2 dB |
| M4c | **A church** (tower stops standing, or a church placement breaks) | §7.7 step 6 | `church`: −14 dB, hold 10 s, release 10 s | ambience −3 dB; the bell is silent in both modes |
| M4v | **The Vey house** (ch4, P1) | landmark `vey-house` | `landmark` as M4, plus `piano.strings` at +0.25 s | — |
| M5 | **Dam breaks** | `reservoir.broken` first seen | Story `dam`: −10 dB while outflow > 0.3·qPeak (15 s at most), release 6 s. Arcade: −4 dB for 4 s. | the flood rises by itself |
| M6 | **Aftermath** (Story) | §8.3 | chapter depth; the scar remains | — |
| M7 | **Ch9 final approach** | `enteredOcean` in ch9 | `seaCh9`: −10 dB over 4 s, held to session end. The sea takes over before M1. | — |
| M8 | **Act III level start** | ch7–9, `beginSession` | hold `act3Entry` until the caption ends, then the `act3Entry` duck −12 → 0 dB over 6 s | — |
| M9 | **Pause** | phase `'paused'` (both modes) | `pause`: −8 dB | effects and ambience gated off |
| M10 | **Fail panel** | phase `'failed'` | Story −12 dB (attack 2 s), Arcade −6 dB, held until retry or leave | — |
| M11 | **Make room** | a P0 voice starts (both modes) | −3 dB, attack 60 ms, hold 1.5 s, release 1.2 s | ambience −4 dB |

**Nothing plays on the Archive screen** (rereading), the **Science** screen (fact, not fiction), or
when music is muted. The reflection swap from pending to ready is silent.

---

## 9. File plan: three work packages

**Integration order**
1. **Day 0.** The contract is copied to `src/audio/contract.ts` (frozen). A lands its "day-0" pieces
   first, each a small file: `testing/fakeAudioContext.ts`, `rng.ts`, `spatial.ts`, and the
   `NullAudioManager` skeleton. B and C can then run tests against them.
2. **In parallel.** B and C proceed against the contract. C tests its router against its own
   `RecordingSessionAudio` (a test fake implementing `SessionAudio`).
3. **Integration**, in one final commit per package, in the order A → B → C. A wires B's
   `createSoundBank`, `createNoiseBank`, `createAmbienceVoices` and `generateSpaceIR` into the
   manager. C mounts `<GameAudio/>` and the director.

**No file is edited by two packages.**

### Package A: engine, channels, settings, lifecycle

| File | Content |
|---|---|
| `src/audio/contract.ts` | Copied verbatim (shared, frozen; A owns any agreed change) |
| `src/audio/env.ts` | `audioAvailable()` |
| `src/audio/rng.ts` | `streamRng(levelId, attempt, stream)`, FNV-1a over `core/rng` |
| `src/audio/spatial.ts` | pure distance, air low-pass, pan and listener-pose helpers |
| `src/audio/settings.ts` | `levelsFromSettings` |
| `src/audio/musicRouter.ts` | `createMusicRouter` |
| `src/audio/ducks.ts` | `DuckMixer`: pure, multiplicative, floor, ramps |
| `src/audio/engine/context.ts` | gesture unlock, state machine, visibility suspend and resume |
| `src/audio/engine/graph.ts` | buses, shelf, limiter, makeupComp, space, meters |
| `src/audio/engine/strips.ts` | |
| `src/audio/engine/voicePool.ts` | caps, stealing, shuffle bags, jitter, density compensation |
| `src/audio/engine/limits.ts` | token buckets on ctx time, perKey LRU (256), frame cap |
| `src/audio/manager.ts` | `AudioManager`, `NullAudioManager`, `SessionAudio`, `audio` singleton |
| `src/audio/trace.ts` | ring of 4096 |
| `src/audio/debug.ts` | `window.__icebergAudio`, gated by `import.meta.env.DEV` or `?audiodebug=1`; `?audio=off` disables Web Audio for A/B performance runs |
| `src/audio/lab.ts` | dev-only `OfflineAudioContext` lab: builds the real graph offline, renders bank buffers and recorded traces, measures with B's `analysis.ts`; dynamic import |
| `src/audio/testing/fakeAudioContext.ts` | records nodes, connects, starts, stops, param automation and state (contract §18) |
| `src/audio/music.ts` | **one additive export** (`musicPlayer`) |
| `src/state/appStore.ts` | four fields, defaults, sanitising |
| `src/state/appStore.test.tsx` | updated `toEqual` and new sanitising cases |
| Tests | `src/audio/{rng,spatial,settings,musicRouter,ducks,manager}.test.ts`, `src/audio/engine/{limits,voicePool}.test.ts`, `src/audio/audio.jsdom.test.ts` |

### Package B: synthesis voices and the motif

| File | Content |
|---|---|
| `src/audio/synth/dsp.ts` | biquads, one-pole, resonator, envelopes, noise colours, loop crossfade |
| `src/audio/synth/blocks.ts` | grain, Poisson train, chirp, stick-slip, modal bank |
| `src/audio/synth/recipes/{ice,stone,wood,glass,metal,masonry,water,machine}.ts` | the recipes of §6.4 |
| `src/audio/synth/recipes/index.ts` | `bakeSound`, `RECIPES: Record<SoundId, Recipe>` (exhaustive) |
| `src/audio/synth/bell.ts` | `bakeBell` |
| `src/audio/synth/piano.ts` | felt piano and `renderMotif` (reads `MOTIF_SCORES`, `MOTIF_TUNING`, `FELT_PIANO`, `VEY_STRINGS`) |
| `src/audio/synth/ir.ts` | `generateSpaceIR` |
| `src/audio/synth/bank.ts` | `createSoundBank`: slicing, priorities, budget accounting, checksum, attach and free |
| `src/audio/voices/noiseBank.ts` | `createNoiseBank` |
| `src/audio/voices/ambience.ts` | `createAmbienceVoices`: wind, scrape, water, falls ×3, ocean, flood, emitters ×4 |
| `src/audio/analysis.ts` | peak, 4× true peak, RMS, BS.1770 K-weighted LUFS (integrated with gating, momentary), spectral centroid, band energy, onsets, YIN pitch, Schroeder T60, envelope autocorrelation, FFT peak picking |
| `src/audio/sources.ts` | `SOUND_SOURCES`, the closed licence and provenance table |
| Tests | `src/audio/synth/{dsp,recipes,bell,piano,motif,bank}.test.ts`, `src/audio/voices/ambience.test.ts`, `src/audio/{analysis,sources}.test.ts` |

### Package C: game and story bridge, music direction, UI, docs, browser runs

| File | Content |
|---|---|
| `src/audio/game/eventRing.ts` | listener, ring, listen-time body lookup, kind cache |
| `src/audio/game/magnitude.ts` | pure §6.2 |
| `src/audio/game/router.ts` | §6.3 resolver, request pool |
| `src/audio/game/ambienceInputs.ts` | scrape, wind, water, ocean inputs, wall-scrape detection |
| `src/audio/game/waterSources.ts` | falls and flood source scanning and selection |
| `src/audio/game/bells.ts` | `BellScheduler` (pure, injected clock) plus the driver |
| `src/audio/game/emitters.ts` | P1 |
| `src/audio/game/calving.ts` | P1 |
| `src/audio/game/levelSet.ts` | `levelSoundSet(levelId, chapter)` from level and overlay kinds, `CHURCH_BELLS`, motifs |
| `src/audio/story/human.ts` | `isHumanFragment` |
| `src/audio/story/storyAudio.ts` | session-scoped: its own `StoryPointsTracker`, landmark, church and aftermath ducks, scar, dam, `seaCh9`, act3Entry, Vey strings |
| `src/audio/story/moments.ts` | app-scoped: reveal, epilogue, ch8 card |
| `src/render/GameAudio.tsx` | R3F component: `useRuntime()`, `beginSession`, subscriptions, `useFrame`, cleanup with `end()` |
| `src/render/GameView.tsx` | mount `<GameAudio/>` right after `<CameraRig/>`, inside the same `<Suspense>` of the attempt-keyed provider, so its `useFrame` runs after GameLoop and the camera write |
| `src/ui/audio/useAudioDirector.ts` | settings, unlock, visibility, cue and trim, `prepare`, moments, M key and its live region |
| `src/ui/story/music.ts` | `cueFor` returns `ARCADE_CUE` for the Arcade game screen; `useMusicDirector` delegates to the router (or is folded into `useAudioDirector`) |
| `src/ui/App.tsx` | calls the director |
| `src/ui/screens/SettingsScreen.tsx` | §5 controls |
| `src/ui/screens/HowToPlay.tsx` | the M key |
| `src/ui/story/Credits.tsx` | copy |
| `src/ui/App.test.tsx` | 7 switches, new sliders |
| `docs/AUDIO.md` | design summary, mix targets, SEED, debug API |
| `docs/AUDIO_CREDITS.md` | from `SOUND_SOURCES` |
| `docs/MUSIC_CREDITS.md` | lines 3–4 |
| `docs/STORY_MODE.md` | line 50 |
| `README.md` | §5 copy, the Sound section, AI attribution |
| `DEVLOG.md` | entry |
| `scripts/audio-e2e.mjs` | the CDP driver (§11) |
| `docs/evidence/AUDIO_RUNS.md` | written after the runs; raw JSON under `logs/audio/` |
| Tests | `src/audio/game/{magnitude,router,ambienceInputs,waterSources,bells,levelSet}.test.ts`, `src/audio/story/{human,storyAudio,moments}.test.ts`, `src/audio/game/listenOnly.test.ts`, `src/audio/game/integration.test.ts`, `src/ui/audio/useAudioDirector.jsdom.test.tsx` |

**Priority inside every package**
- **P0:** everything not marked P1 or P2.
- **P1:** emitters, calving, the Vey strings, the Settings preview.
- **P2:** the graph-routed music backend.

---

## 10. Test plan (vitest; node unless noted; deterministic with SEED = 42)

### Package A

| Test | Asserts |
|---|---|
| `limits`, `voicePool` (injected clock) | 200 collisions in one frame: ≤ 4 requests admitted, the overflow counted, and the ring keeps the 128 highest-priority entries. ≤ 12 voices start per 250 ms. The 150 ms per-obstacle rule. Caps per family. Stealing order. A P0 is never stolen by P1–P3. Ended voices free their strips. The same variant never starts twice within 40 ms. Bags have no immediate repeat. Jitter stays in range. Density compensation. |
| `rng` | Same seed gives the same sequence. Streams are independent. The first outputs of `mulberry32(42)` are pinned. |
| `spatial` | Gains at `refM` and 2×`refM` per profile. The air low-pass at 565 m is 2.5 kHz ± 5%. Pan symmetry. No allocation (the same output object is returned). |
| `ducks` | **Property test:** 10,000 seeded random moment sequences. Every factor ≤ 0 dB, the product ≤ 0 dB, the play-time music product ≥ −20 dB, and music ≤ master × music × bed. Exact targets and timings for every `DUCK_PRESETS` entry. Hold extension and the 10 s aftermath cap. A positive dB throws in dev. |
| `musicRouter` (a recording fake `MusicPlayer` + `ManualTicker`) | `setVolume` is called only on changes > 0.002. Effective volume = master·music·10^(dB/20). A hold plays `null`; releasing it re-plays the wanted cue. Hidden, musicMuted or soundMuted give `setMuted(true)`. Holds release by themselves after end + 10 s or 60 s. StrictMode double calls are idempotent. |
| `manager` (FakeAudioContext) | Nothing is constructed before unlock. A double `unlock()` creates one context. A failed resume (an Escape-like gesture) keeps the listeners armed. Session tokens. `end()` leaves started = stopped and drops later calls. The pause gate reaches 0 within 0.12 s. Ten rapid toggles end consistent. Hidden suspends and visible resumes. Five throwing calls disable the session. The Null manager still drives the router. |
| `settings`, `appStore.test.tsx` | Sanitising of the 4 fields; the updated full `toEqual`. |
| `audio.jsdom.test.ts` | Spies on `window.AudioContext`, `OfflineAudioContext` and `Audio`. Render `App`; dispatch pointerdown, keydown, touchend and M; call `unlock`, `applySettings`, `duck` and `beginSession` with a fake session. **No constructor is called, `console.error` is never called, and `audio.available === false`.** `music.jsdom.test.ts` stays as it is. |
| `music.test.ts`, `tracks.test.ts` | **Untouched; they must pass.** One new assertion in a new file: `musicPlayer === music`. |

### Package B (baked PCM is analysed in node, so no browser is needed)

| Test | Asserts |
|---|---|
| `dsp` | Band-pass centre gain is 0 ± 0.1 dB, with the −3 dB points within 2%. Measured resonator T60 within 5% of the spec. Pink spectrum slope −3 ± 0.5 dB/octave. Brown −6 ± 0.5. |
| `recipes` (every `SoundId` × variant) | All samples finite. Peak = 1.0 ± 1e-6 (loops: RMS 0.25 ± 2%). DC < 1e-3. First sample < 1e-3. Last 20 ms < −70 dBFS. Length = `SOUND_DEFS.seconds` × rate. Two bakes identical. Loop seam < 0.01 with no RMS step. Heavy families (`weight.thump`, `*.collapse.*`, `dam.break`, `metal.break.structure`): ≥ 50% of energy above 150 Hz and < 2% below 40 Hz. Durations per family: hits T60 ≤ 0.3 s; house 2–4 s; dam ≥ 3 s. Spectral centroid ordering: `hit.stone.light` > `hit.stone.heavy`; the crack in `ice.calve.crack` sweeps downward (onset centroid > tail centroid). |
| `bell` | FFT peaks at every partial within ±0.5%. Clachan: strike 573.9 ± 1 Hz, beat 2.3 ± 0.3 Hz, a 31 Hz envelope component in the first 0.4 s only on the cracked bell. Lochside within 3 cents of true. Hum T60 > nominal > upper. Shiver has no transient (its first 10 ms carry < 5% of the strike's high-band energy). |
| `piano` | YIN pitch within ±2 cents of the −10-cent tuning per note. D5 beat 2.7 ± 0.3 Hz; every other note < 0.7 Hz. Centroid at v 0.3 < v 0.6. Onsets of every variant within ±5 ms of the score, tempo and ritardando included. Peak −14 ± 0.5 dBFS. |
| `motif` (score rules) | Bar sums. Scale membership. The cell opens every variant. Only the epilogue ends on F. Lengths match §8.4 within 0.05 s. |
| `bank` | For each of the 9 levels, and each chapter's story level, the level set's bytes ≤ `BANK_BUDGET_BYTES.level`; core ≤ 6 MiB; total peak ≤ 22 MiB. Slices respect the deadline (injected clock). Priority order. The checksum is stable across two banks. `releaseLevel` frees the bytes. `notReady` before baking. |
| `ambience` (FakeAudioContext) | Every voice starts silent. `update()` with an unchanged input issues no param ops. A change > 1% issues exactly one `setTargetAtTime`. `stop()` stops and disconnects every source. Scrape gains rise with speed and are 0 when airborne or afloat. The flood voice is created on its first non-zero update. |
| `analysis` | A 1 kHz sine at −20 dBFS in one channel reads −23.0 ± 0.1 LUFS (BS.1770). A known inter-sample overshoot is detected as true peak. The YIN error on a 440 Hz sine is < 0.5 cents. |
| `sources` | Every `SoundId`, every bell voicing, the motif, the space IR and the noise have a `SOUND_SOURCES` row marked "Original procedural synthesis (this project)". The motif is "Original composition (2026)". `public/audio` contains exactly the six `CUE_TRACKS` files. |

### Package C

| Test | Asserts |
|---|---|
| `magnitude` | The worked tables of §6.2 hold within ±0.01 (m) and ±0.2 dB. m is monotonic in J and v. Below 0.08 is silent. Break levels rise strictly with mass at a fixed hit. Landing m is monotonic. |
| `router` | Every `GameEvent` type maps to a family or an explicit "none". Kinds route as in `KIND_SOUNDS`. Rules F1–F11 each have a case: hit + break gives one request with the hit as layer 0 and the break at +15 ms; 3 church bodies give 1 break + ≤ 2 add-ons; landed + waterfallCrossed gives a plunge; 9 splashes in a frame give ≤ 2 voices with merged intensity; the stone-barrier scatter; tree LOD; the `'rockSmall'` fallback. Requests never exceed 4 layers. No allocation per event (the pool is reused). |
| `bells` (scheduler with an injected clock) | The first phrase falls in 6–14 s. Phrases have 2–4 strokes and never 1. Two Highland churches stay ≥ 20 s apart. The approach hour fires once, with 6 (Story) or 3 (Arcade) strokes, ending ≥ 2 s before arrival along a scripted 18 m/s path. A tower falling mid-hour gives a choke, a clank at +1.1 s and zero strikes after. A 60 s time jump gives no catch-up. Pausing loses and doubles nothing. Never more than 6 consecutive regularly spaced strokes. Levels without churches produce 0. A shiver needs amp ≥ 0.15 and respects its cooldown. |
| `ambienceInputs`, `waterSources` | Scrape drive is 0 below 0.8 m/s and when airborne or afloat, rises monotonically with speed, and its centre frequency falls as the radius grows. River level is monotonic in flow. Falls selection picks the two loudest with hysteresis and fades the third out. Ocean proximity is 0 beyond 260 m and 1 at sea. Wall-scrape detection does not fire on frames with a collision or landed. |
| `levelSet` | Each level's set contains exactly the sounds its kinds (and overlay kinds) need, plus core. Bells only on the 4 church levels (2 on highland-maze). Motifs per chapter. |
| `human` | A pinned classification for every fragment and intro document in all 9 chapters. |
| `storyAudio` (fake session and tracker) | A landmark unit triggers `landmark`, a church triggers `church`, the Vey house adds the strings, a ≥ 100-point unit triggers the aftermath with the chapter's depth, < 100 points does nothing. The scar reaches its cap. The dam duck follows outflow. `seaCh9` only in ch9. act3Entry releases at the caption, or at 3 s when narrative is off. Nothing in Arcade. |
| `moments` | Reveal: hold at t0, motif at +4.0 s, release at motif end + 4 s, `reading` −6 dB after. Toggling the river view twice adds no second motif. Narrative off or no human fragment: no motif. The ch8 card plays once per app session (StrictMode dedupe). The epilogue plays once, its variant is `epilogue`, and it fades any reveal motif. Leaving mid-motif fades and releases. |
| **`listenOnly`** (gameplay preserved) | Run `GameSession` headless twice for mountain-valley and riverside-town (same seed, autopilot, 40 s of game time): once plain, once with the full bridge (ring listener, resolver against `RecordingSessionAudio`, ambience polling every frame, bell scanning, storyAudio's tracker). **The final iceberg state, `stats` and `events.log` are bit-identical.** |
| `integration` | The same headless runs. **100% of events end in a play or a reasoned drop.** Families match `KIND_SOUNDS`. Caps hold every frame. The trace is identical across two runs at SEED 42. |
| `useAudioDirector.jsdom` | Arcade game gives cue `wonder` with trim −2; menus give null. M toggles mute and is ignored in inputs, with modifiers, and on repeat. The live region announces. Under StrictMode there is one effective subscription. Sliders are keyboard-reachable with `aria-valuetext`. |
| `App.test.tsx` | §5 |

---

## 11. Browser verification plan

### 11.1 The driver (`scripts/audio-e2e.mjs`, package C)

- **Dependencies:** Node 22's global `WebSocket` and `fetch`, and raw CDP. No new dependency.
- **Server:** `vite --port 5199 --strictPort`, **never 5173** (the user's server), or
  `vite build` then `vite preview --port 5199`. Pages load with `?audiodebug=1`.
- **Profile seeding:** a scratch `--user-data-dir`, seeded before load through `localStorage`:
  - `iceberg-river.story.v1` with `settings.ai = 'off'`, so no agent calls;
  - unlocked levels;
  - narrative on.
- **Browser:** Chrome or Edge with
  `--headless=new --mute-audio --autoplay-policy=document-user-activation-required --remote-debugging-port=9339`.
- **Gestures:** `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`, which are trusted and grant
  user activation.
- **Sampling:** a page-side `requestAnimationFrame` collector records `__icebergAudio.state()`,
  `meter()` and `state().music` every frame and returns them in batches, avoiding per-sample CDP
  latency. `Log.entryAdded` and console events are captured.
- **Gameplay:** `window.__iceberg.autopilot`, `fastForward` and `setSteer` for scripted routes.
- **Output:** a JSON report per scenario under `logs/audio/`, and a summary table in
  `docs/evidence/AUDIO_RUNS.md`. Exit is non-zero on any failed threshold. Any `lab`-injected event
  is labelled "injected" and never counts as natural coverage.

### 11.2 Offline render checks (in the same Chrome, via `__icebergAudio.lab()`)

The real graph is built on an `OfflineAudioContext(2, 48000·T, 48000)`: strips, shelf, limiter,
makeup, space. It is measured with `analysis.ts`.

| Check | Pass |
|---|---|
| R1 Magnitude ladder: `hit.*` at m 0.1, 0.3, 0.5, 0.7, 0.9; breaks at M 0.2 … 1.0 (jitter off) | Max momentary loudness strictly increasing. ΔL(0.1 → 0.9) is 18–28 LU for hits. The low-band (< 150 Hz) ratio rises with m. |
| R2 Cross-family ordering at 30 m, default sliders | tap ≤ pine hit − 4 LU ≤ house collapse − 12 LU; house + 3 LU ≤ dam break; nothing above −8 dBFS. **The same ordering after a 150 Hz high-pass** (laptop speakers). |
| R3 Stress (seeded `burst`: 200 collisions, 40 splashes, 20 breaks in 2 s) | ≤ 24 concurrent voices. True peak ≤ −1 dBTP. 0 clipped samples. Max momentary loudness ≤ a single dam break + 3 LU. Drops > 0 and traced. |
| R4 Limiter and makeup | A −20 dBFS sine through preMaster comes out at −20 ± 0.3 dB, which pins `makeupCompDb`. A full-scale burst comes out ≤ −1 dBTP. |
| R5 Channels | Effects 0.5 vs 1.0 = −6.02 ± 0.05 dB. Ambience 0 renders < −120 dBFS. Mute all gives silence. The pause gate reaches −60 dB within 0.25 s. |
| R6 Bells | At 250 m, ≥ 12 LU below a house collapse at 30 m. At 40 m, peak ≤ −16 dBFS. |
| R7 Motif via `motifBus` | Onsets within ±10 ms of the score. No clipping. Loudness at music 0.6 equals the recordings' median at `el.volume` 0.6 − 3 ± 1 LU, after calibration. |
| R8 Repetition | 60 s ambience render: the RMS-envelope autocorrelation has no peak > 0.5 at lags of 1–30 s (no audible loop period). 40 identical hit requests with jitter on: no two consecutive renders identical. |
| R9 Determinism | Two bank builds in the same browser give identical checksums, and the checksum equals node's. |
| R10 Recordings | `decodeAudioData` on the six mp3s: peak, true peak and integrated loudness per track are recorded. They set `motifCalib` and the music-versus-effects margin (§2.3). Not pass/fail. |
| R11 Mix replay | `renderMix` of the S3 traces: per-bus integrated loudness per level, master true peak ≤ −1 dBTP, limiter reduction p99 ≤ 0.5 dB. |

### 11.3 Live scenarios

| # | Scenario | Steps | Pass numbers |
|---|---|---|---|
| S0 | Clock sanity | Unlock, then `lab.fire` a reference sound | `currentTime` advances ≥ 0.95 s per wall second and the master meter sees the sound. If not (no output device), the live-meter checks are marked "not measurable" and evidence falls back to the trace plus 11.2. |
| S1 | Autoplay | Load, wait 2 s, press Escape, then click | Before any gesture: no context (an init script counts constructor calls) and no music voices. After Escape: not running, listeners still armed. After the click: `running` within 500 ms and the music unlocked. No "not allowed to start" warning, no console errors. |
| S2 | Arcade basics | Mountain Valley, autopilot, real time | Cue `wonder`, 1 voice playing, `el.volume` = 0.6 × 10^(−2/20) ± 0.01 after the fade. Ambience bus above −50 dBFS RMS while playing. Scrape gain correlates with horizontal speed at Pearson r ≥ 0.7 (10 Hz). Quitting to the menu: cue null and the voice paused within 3.0–3.3 s. |
| S3 | Event coverage | All 9 levels in Arcade on their measured routes; Story ch1, ch4 and ch9 to completion. Rare events by scripted lines: the Riverside dam route; the Power Valley "plant + spillway" line (`powerValley.ts:65-67`); a deliberate church hit on level 8. | 100% of `runLog` events have a trace entry (played, coalesced, or dropped with a reason). ≥ 90% of events not dropped by rate or cap are played. Every event type in the log has at least one played entry of its mapped family. The family per kind matches `KIND_SOUNDS`. |
| S4 | Magnitude in the wild | From S3 | Spearman ρ(impulse, gainDb) ≥ 0.9 for played hits. Every collapse's gainDb ≥ the run's median small-rock gainDb + 12 dB. The median break level is above the 90th-percentile hit level. |
| S5 | Rapid collisions | Power Valley plant: real time, then `fastForward(30)` in chunks; `lab.burst` | Active effect voices ≤ 24 every frame. ≤ 4 requests admitted per frame. Master sample peak ≤ −1 dBFS where the meter runs. The effects short-term RMS stays below a single dam break + 3 dB. Drops are counted by reason. |
| S6 | Volume controls | Settings by keyboard only (Tab to each slider, arrow keys), the M key in game, then reload | Bus gains equal the settings within 1e-3 after 100 ms. `el.volume` = music × master × level × duck within 0.005. A `lab.fire` at effects 0.5 measures −6.02 ± 0.3 dB against 1.0. M takes the master RMS below −100 dBFS within 150 ms and sets `el.muted`. Settings persist across reload; garbage in `localStorage` loads the defaults. |
| S7 | Pause | Esc during play; 10 rapid Esc presses in 1 s; window blur | Effects and ambience gains reach 0 within 200 ms. Music reaches −8 ± 0.3 dB within 400 ms. Resume restores them within 0.8 s. After the rapid presses the state is consistent. Blur behaves the same. |
| S8 | Leave, retry, level change | During scrape + bells + falls: press R; switch level; quit to the menu (Arcade and Story) | Within 200 ms the old token has started = stopped, and no trace entries for it appear afterwards. Bus RMS < −90 dBFS 300 ms later. Arcade music continues across retry and level change. Story screens keep the chapter cue (by design). The new session's ambience starts only after `loading`. |
| S9 | Hidden tab | A synthetic `visibilitychange` (overriding `visibilityState`); one headed manual check | Master gate 0, then `suspended`; music paused. On return: running and the cue fades in. If resume fails, the gesture is re-armed. |
| S10 | Church bells | Levels 3, 4, 8, 9, then levels 1, 2, 5, 6, 7; the ch9 line route; a deliberate kirk hit on level 8 | Each church strikes ≥ 1 phrase before the player passes it, and the hour fires once (6 Story / 3 Arcade). Levels without churches: 0 strikes. On the ch9 line the chapel break silences that bell for the rest of the attempt, with zero strikes after `bell-silenced`. In Story, `church` takes music to −14 ± 0.5 dB within 2 s. On level 8 the lochside kirk keeps striking. Clachan strikes use the cracked buffer. A shaken tower gives a shiver. |
| S11 | Story moments | ch1 and ch4 to completion with narrative on (`fastForward` near the end, then real time); toggle "View the river" twice; open the ch8 card; finish ch9, then the epilogue | At completion `el.volume` ≤ 0.001 by +3.1 s, and the motif traces at +4.0 ± 0.1 s with motif-bus RMS > −40 dBFS while it plays. The music returns to the reading level ± 2%. No second motif after the toggles. The ch8 card plays `ch8` once. The epilogue plays `epilogue` once. Narrative off: none. |
| S12 | Performance | The real Iris Xe laptop, high quality, 60 s, A/B against `?audio=off` | `frame()` median ≤ 0.05 ms and p99 ≤ 0.3 ms. Median frame-time change ≤ 0.3 ms (`benchmark()` and rAF). The level set bakes before the intro ends. Bank bytes reported. Underruns 0 where Chrome exposes playback stats. |
| S13 | Determinism | The same `lab` sequence twice | Identical trace in variant, rate and level. |

### 11.4 Requirement → evidence

| Requirement | Evidence |
|---|---|
| Arcade music and effects | S2, S3 |
| Distinct sounds for every listed category | S3 family coverage; the `KIND_SOUNDS` exhaustiveness check; router tests |
| Impact-reactive loudness | R1, R2, S4, `magnitude` tests |
| AudioManager with music, ambience and effects channels | `state().buses`, R5, S6 |
| Volume, mute, pause | S6, S7, R5 |
| Autoplay | S1, the jsdom tests |
| Anti-repetition | the `voicePool` and `rng` tests, R8, S5, S13 |
| Licensing | `sources.test.ts`, `docs/AUDIO_CREDITS.md` |
| Piano progression and motif | §8; the `piano` and `motif` tests; R7; S11 |
| Music lowered, never louder | the ducks property test; S10; S11 |
| Gameplay preserved | `listenOnly.test.ts` |
| Audio stops on level change and on leaving | S8 |
| Rapid collisions never overwhelming | R3, S5 |
| Church bells and their silence | the `bells` tests, S10, R6 |

---

## 12. Licensing and credits

**Effects, ambience, bells, the space IR, the noise and the felt piano** are original procedural
synthesis written for this project. There are no samples, so nothing needs a licence. Each is
listed in `SOUND_SOURCES` (`src/audio/sources.ts`) as:

```
{ id, kind: 'synthesis' | 'composition' | 'recording', author: 'this project', file: 'src/audio/synth/…', licence: 'Original work (course project)' }
```

A test enumerates it against `SOUND_IDS`, the bell voicings and the motif ids.

**The motif "No. 14"** is an original composition (2026) for this game, credited as such.
- It is a 4-note cell plus diatonic continuations.
- A human should still confirm it does not accidentally quote a known tune. No test can rule that
  out.

**The music** is still the six Musopen recordings (PD or CC0), unchanged. Their credits, the
`tracks.test.ts` rows and the `StoryUi` credit test are untouched.

**New file `docs/AUDIO_CREDITS.md`.** It is generated by hand from `SOUND_SOURCES` and says:
- all effects and ambience are synthesized in `src/audio/synth`;
- the motif is an original composition (2026);
- the recordings remain Musopen PD/CC0, with a pointer to `MUSIC_CREDITS.md`;
- SEED = 42.

**No new recording is added.** If one ever is (for example the FreePats piano fallback), its licence
must be verified on its source page, dated, and recorded there before use.

**AGENTS.md §6 attribution:** the README credits the AI-assisted portions of the sound design and
code.

---

## 13. Risks, and what still needs a human ear

**Risks and their mitigations**

| # | Risk | Mitigation |
|---|---|---|
| 1 | **The felt piano sounds like a toy or an electric piano (highest risk)** | Dark felt timbre, two-string beating, mechanical noise, a room tail, and a register and dynamics chosen to avoid synthesis's weak spots. The renderer can be swapped (§8.5). |
| 2 | **Collapses read as noise bursts rather than materials** | Layered material transients (snaps, shards, groans, crumble), plus the spectral and duration tests and R1/R2. |
| 3 | **Music sums outside the limiter** | The recordings are measured (R10); `makeRoom` and the ducks; cut the effects references by 2 dB if the margin is under 1 dB; the P2 graph backend. |
| 4 | **The realtime clock may not advance in headless Chrome** without an audio device | The proofs rest on traces, node analysis and offline renders; live meters are a bonus (S0). |
| 5 | **Autopilot rarely breaks dams or churches** | Scripted routes come first. Injected events are labelled and do not count as natural coverage. |
| 6 | **The impact-rise heuristic for terrain walls misfires** | Gated on same-frame events and rate-limited. False positives show up in the trace as `wallScrape` entries with no wall nearby. |
| 7 | **Stacked ducks in Act III** (bed × scar × church × make-room) | Clamped at −20 dB during play. Whether that feels like "gone" is a listening question. |
| 8 | **Holds read as "the music broke"** | Fades ≥ 2.5 s, holds capped, a 60 s safety, and a motif-late release. |
| 9 | **The silence, the shiver or the Vey strings read as someone inside** | A clock mechanism, no toll, no voices, and the piano struck with no melody. Put it in front of a reader anyway; the Vey strings are P1 and can be cut. |
| 10 | **Calibration constants** (`chipAmountRef`, `qRef`) come from one recorded trace | Pinned by tests. Re-measure if the physics tuning changes. |
| 11 | **Bank bake time on Iris Xe while shaders compile** | ≤ 4 ms slices, the core set baked in menus, `notReady` drops are silent. Since 2026-10-23 the motifs render in a Web Worker where one can be made (not under `file://`: the main-thread bake then). |
| 12 | **The linear slider law** puts most of the dB range in the bottom 30% of travel | Kept for consistency with the existing slider. Revisit with a listener. |
| 13 | **Safari and iOS** | Not targets. |
| 14 | **StrictMode or HMR duplicates the manager** | Idempotent subscriptions, tokens, and an `import.meta.hot.dispose` that calls `audio.dispose()`. |

**What only a human ear can judge**

1. **The motif:**
   - whether the synthesized felt piano sounds like a quiet, slightly untuned real piano;
   - whether "No. 14" carries weight and becomes associated with the people over nine chapters;
   - whether the Act I → epilogue arc is felt;
   - whether it accidentally quotes a known tune.
2. **The bells:**
   - whether they sound like real bells at distance, and gentle;
   - whether Clachan's note sounds *wrong in the intended way* rather than broken;
   - whether the shiver reads as resonance.
3. **Destruction:**
   - whether a house collapse has weight without spectacle, and glass that gives way rather than
     crashes;
   - whether metal groans and the machinery run-down read as industrial, not sci-fi;
   - whether the dam reads as concrete and water, not an explosion.
4. **The silences:** whether the breath after a loss, the scar and a church clock that stops
   mid-count register as consequence rather than as a bug. This is a playtest question.
5. **The water:** whether river, falls and sea are believable, and stay alive rather than static
   over a 2–10 minute run.
6. **Balance:** whether the recorded grands and the synthesized world sit together, on laptop
   speakers and on headphones (the tests only simulate a 150 Hz high-pass).
7. **Fatigue:** repetition over 40+ collisions per run.
8. **Reading:** whether the motif over the Revelation helps or distracts someone who is reading.
9. **Arcade:** whether it feels lighter while still sounding like the same world.
10. **The device:** clicks, zipper noise or crackle from audio-thread underruns on the actual Iris
    Xe laptop under GPU load.

---

## Appendix: open questions to put to the user

1. **Hidden tab.** The music now pauses when the tab is hidden; today it keeps playing. This design
   pauses it, for consistency with the auto-pause.
2. **Arcade's approach hour** strikes 3 (Story 6). An alternative is to give Arcade only the
   background phrases.
3. **The P1 items** (machines that stop, calving, Vey strings, Settings preview) are in the plan
   but can be cut without touching the P0 contract.
4. **The default Ambience and Effects volumes are 0.8.** A listener may prefer different defaults.
