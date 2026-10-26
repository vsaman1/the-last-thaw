# Development log

Concise record of technical decisions, completed functionality, known problems and testing.
Newest entries at the bottom of each section.

## Decisions

- **Stack**: Vite + React 19 + TypeScript, three.js via React Three Fiber, Rapier (`@dimforge/rapier3d-compat`,
  WASM embedded so no extra asset hosting), zustand for UI state, vitest for tests. No backend, no API keys.
- **Core vs render split**: everything under `src/core` is plain TypeScript with no React/DOM/WebGL, so the whole
  game (terrain, iceberg, river, physics, session) runs headless in tests and can later be inspected or driven by an
  agent. `src/render` only draws what the core state says; `src/ui` is DOM menus/HUD.
- **Iceberg is not a Rapier body.** Its motion is a custom integrator (gravity along the terrain gradient,
  friction, drag, heading + grip steering, airborne/landing, ocean floating). Reason: a sliding rigid body on a
  triangle mesh is jittery and hard to tune, and we need precise, testable control over momentum loss. Obstacles
  *are* Rapier bodies; iceberg↔obstacle contacts use one shared momentum-exchange rule
  (`J = (1+e)·vn·Mm/(M+m)`, e = 0.25) so heavier objects cost more speed and anchored ones (trees, houses) break
  only above an impulse threshold.
- **One surface definition.** Terrain is a height grid; the render mesh, the Rapier trimesh and the iceberg all
  use the same triangle split (`src/core/heightGrid.ts`), so nothing floats above or sinks into the ground.
- **River = recorded trail.** The river is generated from samples recorded behind the iceberg (its real route),
  turned into a chunked ribbon mesh that conforms to the terrain, with waterfall sheets inserted where the iceberg
  went airborne over a cliff. Flow is a shader (advected noise, foam) plus `flowAt()` queries that push physics
  bodies downstream. Not CFD — a procedural mesh + shader + forces.
- **Fixed 60 Hz simulation step** with an accumulator; frame dt is clamped to 0.1 s.
- **Session per attempt.** Restart builds a new session (terrain is cached per level), so no state leaks between
  attempts and no page reload is needed.
- **Course coordinates.** Levels place obstacles by arc length `s` along the valley centreline and lateral offset
  `d`, so level data stays readable and terrain changes don't break placements.
- **Programmatic access** for future agents: `src/core/api.ts` (`getSnapshot`, `getRunLog`) exposes position,
  velocity, momentum, steering input, slope, route, collisions/events, stats, outcome, time and distance. In the
  browser the same is on `window.__iceberg` (also lets a script steer or enable the autopilot).
- **Assignment-driven deviations from the course AGENTS.md** (Python-oriented): this is a Node project, so no
  `.venv`/ruff; formatting/linting via TypeScript strict mode. The interface needs a build tool (Vite) rather than a
  single HTML file, because the spec requires TypeScript/React/R3F/Rapier.
- **Anchored obstacles break on the iceberg's momentum** (2026-10-17): `J_test = (1+e)·vn·M` with the iceberg's
  *current* mass, against `breakImpulse` (pine 262.5, broadleaf 337.5, house 562.5 at M = 30; strength × scale²).
  The old test (`Mm/(M+m)`) saturated at the obstacle's mass, so a heavier iceberg barely helped. Breaking still
  costs the iceberg the loose-body impulse of the obstacle's mass.
- **Chips are a fraction of the current ice** (`chipPerShock · (shock − 2.5)`, cap 0.35, × ice); a remainder under
  2 % shatters (`SHATTER_BELOW`) and the run fails as *melted*. Fixed-size chips hit already-melted icebergs far too
  hard. `shock` = how hard the obstacle pushed back on the ice: the full bounce, only the obstacle's strength when
  it gives way, `J/M` for loose bodies — so a 220 t iceberg crushing a dam barely chips.
- **Growth by absorbing glacier ice** (user request): absorbable `iceBlock`/`iceField` obstacles merge with momentum
  conserved; mass = 30 t × ice (per-level base), size = cbrt(ice) above 1, cap `maxIce` 6. Ice above 1 counts in the
  score (`round(iceLeft × 600)`) so avalanche routes pay off; the time bonus still rewards fast lines.
- **Data-driven structure kit**: one self-registering file per kind in `src/core/obstacles/structures/` (Vite
  `import.meta.glob`), described as bodies of parts with stands (anchored / resting / loose), ground modes
  (footprint / rest / fixed / float) and calibrated break speeds. 24 kinds. Tests must run with
  `--no-fsModuleCache` (now in `npm test`), otherwise vitest's cached glob list misses new files.
- **Force-sleep only resting bodies nothing awake presses on** (`touchesAwakeBody`): Rapier stops resolving the
  contact of a force-slept support, so the body on top sank into it and pushed it through the terrain (30-panel
  cooling-tower pile: 9–16 panels under the ground before, none after). Tried and rejected: waking any sleeping body
  that still moves — waking a force-slept body right after its extra integration step dropped a fence rail through
  the terrain every run. Tests now check Rapier's true positions (`rigidBodyPosition`), because `ObstacleBody.pos`
  is stale while a body sleeps.
- **Playtest switch**: Settings → Gameplay → *Unlock all levels* (off by default).

## Build log

- 2026-10-16 — Scaffolded project; wrote shared contracts (`src/core/types.ts`), math/noise helpers, height-grid
  sampler, stores, controller, analytic test terrain. Six systems built in parallel against those contracts
  (terrain+level 1, iceberg sim, river/water, physics/obstacles, UI/input, camera/FX), then integrated.
- 2026-10-16 — A temporary internet outage killed the river, physics and UI build agents mid-run (API
  ENETUNREACH/ENOTFOUND — not code errors; each had just received a successful tool result). Their files on disk
  were intact; continuation agents picked up from those files rather than restarting. Terrain, iceberg sim and
  camera/FX had finished; the iceberg reviewer kept running.
- 2026-10-16 — Level 1 opening redesigned by the terrain agent: the first draft's 0.05 slope barely beat friction
  (0.038) so the iceberg crawled; now a short plateau behind the spawn and a 0.16 launch ramp. Start elevation is
  ~90 m rather than 150 m because steeper average slopes would exceed the tuned cruise speeds.
- 2026-10-16 — Session: intro has its own clock (pausing during the intro no longer restarts it). Canvas uses
  PCF shadows (three r186 removed PCFSoftShadowMap) and Neutral tone mapping (ACES washed out the saturated palette).

- 2026-10-16 — Session usage limit stopped all agents ~13:20; work preserved on disk, `RESUME_NOTES.md` written
  and a local WIP checkpoint commit made (`869174a`). After the reset the three continuation agents were resumed
  with their context. The iceberg reviewer (not resumable) had already landed its fixes: no fake hops after a
  contact push, ground re-snap after separation, sea-cliff falls land on the water, wall-crest freeze, stuckTime 0,
  vertical-speed spike at cliff faces — all covered by `src/core/sim/iceberg.edge.test.ts` (41 sim tests pass).

## Balance probe (headless, level 1, real terrain + physics + river) — 2026-10-16 16:44

Measured by driving `GameSession` with the autopilot at different lateral lanes, random input, and no input:

| strategy | outcome | time | top speed | collisions | knocked | notes |
| --- | --- | --- | --- | --- | --- | --- |
| centre line | won | 61.1 s | 18.0 m/s | 4 | 4 | waterfall + ocean crossed |
| lane +8 m | won | 66.0 s | 18.8 m/s | 13 | 13 | 1 tree felled |
| lane −10 m | won | 57.3 s | 20.6 m/s | 12 | 9 | 3 trees felled |
| lane +14 m | won | 56.5 s | 22.8 m/s | 4 | 3 | |
| lane −18 m (hugging wall) | lost (stuck) | 37.9 s | 14.5 m/s | 2 | 1 | stalled at the gate, s≈336 |
| random steer every 1/3 s | lost (stuck) | 27.6 s | 7.3 m/s | 45 | 2 | zig-zag bleeds momentum as designed |
| no input | won | 68.4 s | 19.6 m/s | 8 | 6 | valley bowl guides it — fine for a tutorial level |

Sim cost: 0.18–0.48 ms per 60 Hz step (node, whole session incl. Rapier). No houses were hit on these lines
(they sit at the floor edges).

## Browser playtest #1 — 2026-10-16 ~16:50 (Claude Browser preview, Intel Iris Xe, 1024×768)

The preview pane was hidden, so the page's requestAnimationFrame was throttled to ~1 fps (measured 1.2 fps even
on the main menu with no canvas). Gameplay was therefore advanced with the debug hook (`fastForward`, which runs
the real simulation) and rendering cost was measured with `benchmark()` (synchronous GPU-flushed renders,
independent of rAF throttling).

Verified working in the real app: main menu → Play → loading → intro fly-over with title card and
"PRESS SPACE TO SKIP TO GAMEPLAY" → Space skips → HUD (level, progress, momentum km/h, knocked, falls) →
autopilot run: river trail follows the path with foam, waterfall crossed (falls = 1), ocean + buoys visible →
LEVEL COMPLETE overlay over the live scene (time 1:06.7, 809 m, 10 knocked, score 2282, "New best") →
outro wide shot shows the whole river from the mountains over the falls into the sea → Replay starts a fresh
attempt without reload → progress saved in localStorage. Failure: holding full lock stalls in ~7.7 s →
"STUCK!" panel with tip, Retry / Level Select / Main Menu. No console errors (only a THREE.Clock deprecation
warning from a dependency).

Render cost (scene only, no post-processing): ~17 ms/frame, 42 draw calls, ~576k triangles → ~55–60 fps
equivalent on integrated graphics before bloom. Needs a performance pass (ocean grid and shadow pass are the
likely big contributors).

Findings to address: in-valley obstacles render correctly but read small from the gameplay camera (60 m-wide
valley); a beginner holding a hard turn at the start fails within seconds.

## Adversarial review #1 — 2026-10-16 (five read-only reviewers)

26 reproduced findings (all with evidence). Highlights: stuck rule unrecoverable after near-stops on ~71% of the
course; knocked heavy rocks pinning the iceberg; turn penalty charged on gross yaw (gentle curves cost as much as
zig-zags); stone barrier keeps only ~30% of speed; collisions counted per physics step; river slab floating 2–3 m
above valley walls; fake waterfalls from hops down walls; mouse steering takes over at the last menu-click
position (new players fail in ~12 s without touching anything); no error boundary / WebGL check; shaders compiling
on the first visible frame (2.5 s freeze) and mid-game (river 1.3 s); post-processing ≈ 2/3 of GPU time; renderer
leak per restart; docs not TA-ready. Fixes were split three ways (gameplay/physics agent, river agent, UI agent)
plus render/perf by the lead.

## Real-GPU measurements — 2026-10-16 ~18:30 (headless Chrome, ANGLE D3D11, Intel Iris Xe, 1280×720, DPR 1, dev build)

The Claude Browser pane was hidden (requestAnimationFrame throttled to ~1 fps, later 0), so performance was
measured with a small CDP-driven headless Chrome on the real GPU instead (scratch script, not in the repo).

- After the warm-up change: all 33 shader programs (incl. both river materials) compile **behind the loading
  overlay**; no new programs appear during play. Long tasks after the overlay disappears: none > 0.1 s.
- Play → intro on a cold profile: 10.1 s (dev build, includes terrain + physics build and shader compilation).
- Restart (R): 1.6 s back to the intro, **same canvas** (renderer kept alive across attempts).
- Frame rate in play: **low quality 60 fps (vsync-locked)**; shadows without post-processing **60 fps**;
  high quality with bloom 33–42 fps (MSAA 4 → 0 + SMAA helped only a little). The post-processing chain is the
  cost on integrated graphics → an automatic quality tier is being added (bloom only where the GPU keeps 60 fps).

## Fix round results — 2026-10-16 (after review #1)

- River (agent): water drapes onto lower ground (≤ 0.4 m hover, level only past drop-offs / near a lip); a
  landing is a waterfall only over a real steep drop (> 3 m at slope > 1.5); fall vertices kept out of rock;
  plume `coastS` = first ocean entry. No-input run: floating probe points 645 → 0; fake falls removed; the real
  cliff fall is unchanged and connected for lanes −24…+22 and angled crossings (39 river tests).
- UI (agent): mouse steering arms only after the cursor passes the screen centre (keyboard works at once);
  HUD steering indicator + "move the mouse to the centre" prompt; specific fail tips (held turn / heavy
  obstacle); per-field settings validation; progress merged across tabs; reduced-motion → skip intros by
  default; aria-live phase announcements; clearer momentum warning; inline favicon (no console 404).
- Gameplay/physics (agent; it hit the usage limit just after finishing its tests — work recovered from disk,
  suite green): stuck timer ignores an iceberg that is still gaining speed and lets a stopped one wriggle
  sideways; turn cost charged on the net turn and only for sharper steering, plus a small cost for rapid hard
  reversals; knocked heavy debris is shoved to the side; barrier = 3 stones of 7–8 t; s=412 boulder moved off
  the line; one house moved onto a smashable left line; two pine groves added; collisions counted per impact;
  physics terrain mesh cached per terrain (faster restarts).
- Lead: shader warm-up behind the loading overlay, persistent Canvas across attempts, WebGL check + error
  boundary, context-loss pause, renderer-leak guard, whole-frame render stats, automatic quality tier
  (auto/high/medium/low), reduced-motion camera, `<main>` landmark, mouse re-arming on entering play.

### Balance probe #2 (headless, level 1, after fixes)

| strategy | result |
| --- | --- |
| autopilot lanes −16, −10, −5, 0, +5, +10, +15, +20 m | all **won**, 48–71 s (−16 used to stall at the gate) |
| no input | won, 54.9 s |
| random zig-zag (new steer every 1/3 s) | failed (stuck) at s≈124 |
| aim at the left-line house from s 600 | won, house smashed (`buildingsDestroyed` 1) |
| 0.09 slope, 8 s from 15 m/s | straight 17.1 m/s · gentle curve 14.3 (−16 %) · 0.8 s zig-zag 4.8 (−72 %) — curve now clearly cheaper |
| "lazy" keyboard players (press only on clear drift, 0.15–0.35 s reaction, rare mistaken taps) | **13/16 won**, median 118 s; losses = driving slowly into the s≈120–150 grove or the gate area |
| "lane-tracking" keyboard players (constant corrections toward a random lane, through obstacles) | 8/16 won, median 179 s |

Interpretation: smooth (mouse/proportional) steering is rewarded strongly; keyboard tap-steering usually
finishes but slower; reckless zig-zags fail. A slower keyboard ramp (2.5/s) and gating the reversal cost to
fully ramped steering helped on an open-slope test (12.1 vs 2.8 m/s after 40 s of weaving) but made no
difference on the real level, so input was left unchanged.

## Testing

- Unit tests live next to the code (`*.test.ts`); `npm test` runs them all headless.
- `src/core/session.test.ts` is the end-to-end check: builds level 1 with real terrain, physics and river, and
  verifies that an autopilot completes it, that the river follows the route, and that stuck/fail, intro/skip and
  pause/resume work.

## Browser playtest #2 — 2026-10-16 ~22:00 (headless Chrome on the real Iris Xe GPU, dev build)

Mouse arming: after clicking PLAY with the cursor far left, the iceberg did not steer (`source: none`) and the HUD
showed "Move the mouse to the centre to steer"; after passing the centre, moving right steered right (+0.47).
Full autopilot run with a left line: completed 1:05.7, house smashed, tree felled, waterfall crossed, score 2416.
Replay → intro 2.6 s. Holding full lock → STUCK with the specific tip "You held a full turn…". Auto quality
settled on Medium. Console: only a THREE.Clock deprecation warning from a dependency (no favicon 404). Screenshots
checked: waterfall sheet joined to the river above and below with foam/mist; house breaking into walls/roof/
chimney; HUD at 1280×720 and 390×844 (no overflow; prompt moved above the steering gauge so it no longer covers the
iceberg). `npm run build` succeeds (one ~6 MB chunk, expected — Rapier WASM is embedded).

## Tutorial update — 2026-10-16/17 (user feedback round)

Requests: shorter/faster tutorial; finish soon after entering the sea; a way to look at the whole river after
completing; the iceberg should "run out of water if it is too windy"; music and harder/bigger levels later.

- **Interpretation**: "too windy" was read as *too winding* (a winding route uses more meltwater). Literal wind
  is on the roadmap if wanted.
- **Melt mechanic**: `IcebergState.ice` drains per metre of river laid on land plus per radian of net turning
  (`LevelDef.water = {metres, turnMetresPerRadian}`); `size` (0.55–1) shrinks the iceberg, its collision radius
  and the river width; 0 ice → fail `'melted'`. No drain in the air, at sea, or outside play. Ice left adds up to
  +600 score. HUD *Ice* gauge with a low-ice warning; *MELTED!* panel with a steering tip.
- **Crystals: built, then removed.** Collectible ice crystals (score + refill) were implemented, then the user
  decided against the concept, so all crystals — collectible and the decorative glowing scenery crystals that had
  looked like pickups — were deleted (commit `a9f6e16`).
- **Tutorial**: start → coast 510 m (was ~750 m), launch ramp 0.18, finish 20 m into the sea; autopilot runs take
  32–42 s (was 57–66 s).
- **Water budget** (balance probe, real level): every route lays ~460–530 m of river; net turning separates
  styles — smooth lines 2–6 rad, a moderate weave ~18 rad, tap-steering keyboard players 11–27 rad, a wall-to-wall
  weave ~48 rad. Smoothing the turn signal did not separate keyboard wobble from deliberate weaving, so the
  tutorial budget is forgiving: **850 m + 10 m/rad** (at 800/10: smooth lines 35–38 % left, keyboard players 2–21 %,
  wall-to-wall weave melts). Regression tests guard both ends.
- **View the river**: button + V on LEVEL COMPLETE; orbit camera fitted to the river's bounding box (drag, wheel,
  pinch, slow auto-rotate; fog pushed out). Playtest found the river hidden behind canyon walls after a sideways
  drag → orbit elevation now 43–83°, gentler drag, 1 s entry blend.
- **Ocean from above**: narrower sun-glint lobes (a third of the sea washed white) and the terrain's flat 14 m
  seabed now reads as open sea (it showed as a light rectangle).

### Browser playtest #3 (headless Chrome, real Iris Xe GPU) — 2026-10-17

Autopilot centre line: completed in 32.4 s over 528 m; ice 82 % at s≈174, 41 % at the end (iceberg size 0.74);
results show "Ice left 41%" and *View the river (V)*; river view + drag + V back all work; a wall-to-wall weave
melted after 124 s → *MELTED!* panel with the steering tip. Console clean apart from the dependency's
THREE.Clock warning. 351 tests pass; typecheck clean.

## Big expansion — 2026-10-17 (user feedback round 2)

User asked for: an easier river view (zoom to a spot), physics-based ice chunks on crashes, many harder and more
creative levels (bridges, cars, dams, power plants, steeper drops, unclear best path, traps, jumps), big-iceberg
levels, and (mid-request) levels where you absorb glacier ice and snowball into an avalanche. Crystals stay removed.

Built (parallel agents, lead integration): river-view orbit camera (zoom at the pointer, double-click fly-to,
right/Shift-drag pan, keyboard orbit/pan/zoom, Home reset, steeper close-up orbit); momentum break rule, chipping and
growth (above); terrain features (island, hill, basin, ramp, gap, plateau, road) and themes (meadow, canyon, alpine,
town, industrial); river jumps over gaps; 24 structure kinds; per-level iceberg scale/mass, water budget and an
intended line for the line-following autopilot; HUD ice/mass gauge with chip/absorb flashes; levels 2–6.

### Levels — measured by the level designers (headless: real terrain + Rapier + river, autopilot, real water budget, chipping on)

| Level | Iceberg | Intended line | Other routes |
| --- | --- | --- | --- |
| 2 Rocky Canyon | 30 t | complete 44.7 s, 28 % ice | sinkhole launch 44.6 s 30 %; safe bypass 45.9 s 23 %; naive centre line stuck in the ravine |
| 3 Alpine Pass | 40 t | complete 65.2 s, 31 %, absorbed 16 t | glacier tongue 73.6 s 139 % (77 t peak); swallowing the bait stalls on the col; centre line stuck at the island nose |
| 4 Riverside Town | 100 t | complete 83.3 s, 33 %, 5 buildings | Mill Lane 88.8 s; bypass 102.6 s; centre line stuck in church rubble |
| 5 Glacier Avalanche | 18 t | complete 82.7 s, absorbed 95.5 t, peak 106.7 t, dam burst | skip lines arrive too light and stall at the dam |
| 6 Power Valley | 220 t | complete 112.1 s, 33 %, 8 buildings | speed line 97.7 s 40 %; right channel 113.4 s; centre line stuck on the island nose |

### Real-GPU smoke — 2026-10-17 ~14:30 (headless Chrome, ANGLE D3D11, Intel Iris Xe, 1280×720, dev build, quality Auto)

Every level loaded (2.6–4.7 s) and completed on its line with the autopilot (fast-forwarded): L1 32.5 s 42 % ice;
L2 44.7 s 28 %; L3 65.9 s 30 %; L4 83.8 s 33 %; L5 82.3 s 521 % ice (94 t at sea); L6 118.2 s 31 % (6 s slower
than the designer's run — measured after the road-bridge pier rework). Frame cost (`benchmark(60)`, start of each
level): 14.2–18.8 ms (53–70 fps), 158–410 draw calls, 0.43–0.98 M triangles. No console errors (only the
dependency's THREE.Clock deprecation warning).

### Engine issues found while designing — and how they were fixed (2026-10-17 evening)

Designers' reports were batched into two engine agents working in separate git worktrees, merged into main, then
reviewed again by an adversarial review (4 lenses, each finding re-traced or reproduced by a skeptic) and fixed in a
second round. Level files were never edited by the engine agents; designers re-balanced afterwards.

- **Rubble pinned heavy icebergs** (two houses stopped 80 t; a toppled chimney 132 t; a factory hall / full cooling
  tower 220 t). Cause, measured: every re-contact with a piece sitting just ahead (slowed by friction, jammed in the
  pile) cost a fresh `J/M` — 80 t through two houses lost 14.3 m/s to wall pieces vs 2.8 m/s to the breaks.
  **Fix — bulldozing contacts:** a loose body exchanges momentum once; re-touching it (or a piece of something just
  broken) within 1 s is a *push* costing friction (`0.6·g·dt·m/M` per step) for rubble that gives way — fully when the
  iceberg is ≥ 2× heavier, or when the rubble is low relative to the iceberg's height (ridden over) — and it is shoved
  aside. Rubble that holds keeps the old rule (a 22 t boulder still pins 30 t). Pushes are not new collisions and
  do not chip. After: 80 t through two houses keeps 12–14 m/s; 220 t through a full cooling tower exits at 11 m/s
  (was stuck); 30 t through a house still loses 38 % and 9.75 % of its ice.
- **Debris shielded the next building** from the break test → debris pressed into a standing body passes the
  momentum test on (`pressedInto`), using the debris's rectangle, not its bounding circle (review fix).
- **Long/wide bodies collided as circles** (a dam's 10 m breach closed to ~8.7 m) → footprint-rectangle proxies for
  bodies ≥ 1.3× longer than wide; long bodies exchange momentum with their effective mass at the contact point and
  their spin is capped (review: end hits flung bus ends at ~4× the iceberg's speed).
- **Dam seams pinned 110–132 t icebergs** → bodies broken together are each tested against the full momentum along
  their own normal and cost one exchange with the spanned mass. 132 t @ 14 m/s at a joint now exits ~7 m/s; 60 t is
  still stopped. Dam columns follow uneven ground (worst sunk block 1.5 → 0.6–0.8 m).
- **Own ice chips** spawned in front (122–464 self-hits per dam breach) → chunks leave the iceberg's flanks and are
  ignored for 1.5 s (0 self-hits).
- **Bowl traps took ~30 s to fail** → a confinement tracker: returning near a ≥ 1.5 s old position after ≥ 4 m of
  travel marks a trap; trapped icebergs fail in ~10–13 s; slow climbs, wall slides, the ocean and real escapes are
  unaffected (tested).
- **Ramp launches depended on lip/grid alignment** (a 23 m/s jump varied 52.8–66.7 m) → the iceberg rides the exact
  ramp face over the last cell and takes off at the exact lip (spread ≤ 0.3 m fast, ≤ 0.05 m slow); review fixes: no
  pops from back faces, gap edges or side edges; exact lips on curved courses (two Alpine Pass kickers had wrong
  lip data before).
- **Coast blend erased cliffs near the sea** (Power Valley's 30 m sea cliff kept 24.9 m) → blend starts at the foot
  of the last cliff (30.6 m kept); `validateLevel` now flags cliffs that lose > 10 %, ramps per gap may be several,
  and a partial gap's bypass accounts for islands.
- **Placement randomness by index**: documented in `docs/LEVEL_AUTHORING.md` (append new placements; don't reorder).

Render/UI review (same method, 17 confirmed findings, all fixed): retry after a 3D crash no longer hangs on a
spinner; Retry no longer mounts the scene once against the disposed session; focus rings readable over the scene;
reduced motion respected by the fail/outro cameras; HUD bottom band can't overlap; keyboard-aware steering prompt;
chip/absorb flashes and "open water" announced correctly; touch steering (`touch-action: none`); auto quality aware
of 50 Hz / 30 fps caps, applied at the next loading screen and remembered between visits; errors inside frame
callbacks and lost WebGL contexts show the error dialog; warm-up compiles the variants actually used (33 → 23
programs at High, none added in play); glacier-ice material prewarmed; render caches keep only the current level
(~215 MB held after visiting all six before); no rendering while paused; shadow map freed on Low.

### Levels re-balanced on the fixed engine — 2026-10-18 (designers, headless autopilot, real water + chipping)

With rubble no longer pinning heavy icebergs, the designers removed their workarounds (shrunken structures,
glancing lines) and re-measured. Intended lines (time / ice / buildings / score where reported):

| Level | Change | Intended line | Other routes |
| --- | --- | --- | --- |
| 2 Rocky Canyon | ravine threshold re-measured with exact kicker lips (take-off ≥ 13.3 m/s clears) | 44.7 s, 29 % | centre line still falls into the ravine |
| 3 Alpine Pass | full-size chalet + log pile in the village (a momentum trap at line size); glacier tongue 43 → 70 t | 64.4 s, 29 %, score 3789 | graze the tongue ≈ 4110 (expert); swallow it all → rolls back off the col (stuck); avalanche route 3871 |
| 4 Riverside Town | dam 0.6 → 0.85 after a straight chute; terrace row of three houses on the line; church backs onto a railway embankment; coffer dam closes the bypass to an unsteered iceberg | 89.3 s, 33.8 %, 7 buildings, 5450 | Mill Lane 81.6 s / 5242; bypass 96.3 s / 5293; church head-on stuck on the embankment; centre line and no input stuck |
| 5 Glacier Avalanche | dam 0.8 → 1.2 (needs ~72–82 t at gorge speed ≈ 50–58 % of the ice); head-on village | 89.5 s, absorbed 95.5 t, peak 106.7 t, 3 buildings | skipping the upper glacier now fails at the dam; skip lines stuck at the dam |
| 6 Power Valley | full-size 42 m cooling towers, chimneys, halls; turbines back on the crests | 113.8 s, 28.5 %, 8 buildings, 6348 | speed line 97.6 s / 6452; dam breach 126.3 s / 6035; centre line and no input stuck |

The speed line on Power Valley slightly outscores the destruction line (6452 vs 6348): time and ice outweigh
the extra buildings there — both are reasonable choices, left as is.

### Real-GPU smoke #3 — 2026-10-18 ~08:00 (headless Chrome, ANGLE D3D11, Intel Iris Xe, 1280×720, dev build)

All six levels loaded (2.6–4.5 s) and completed on their intended lines with the autopilot (fast-forwarded):
L1 32.5 s 42 %; L2 44.7 s 29 %; L3 64.2 s 30 %; L4 89.1 s 34 %; L5 90.2 s 481 % ice (87 t at sea); L6 112.4 s 29 %.
Frame cost at quality High (fresh profile, before any auto step-down applies): 15.9–21.6 ms (46–63 fps), 175–410
draw calls, 0.42–0.98 M triangles, 35 programs. Auto quality queued a step to Medium on L3–L6 (applied at the next
loading screen and remembered). No console errors. Full suite: 55 files, 1002 passed, 1 skipped; typecheck clean.

## Rounds 3–6 — 2026-10-18 → 10-20 (user feedback rounds 3–6)

What the user asked for, and what was built (commit subjects in `git log`; per-level balance in each level file's
header in `src/core/levels/`):

- **Round 3** (waterfalls, maze-like mountains, a real start, the windmill): waterfalls now follow the recorded flight
  of the iceberg off each lip; levels 3–9 were rebuilt as open, ambiguous mountainsides (several ways to the sea,
  dead-end glens, fatal ravines you must jump with enough momentum) keeping each level's theme, and levels 7 Ravine
  Run, 8 Highland Maze and 9 Summit Labyrinth were added; every level starts with the iceberg embedded in a glacier and
  an animation of it calving off (the flyover before it scales with the route length); toppling fixes so tall
  structures the iceberg breaks come down. "The river has to connect to the glacier": the meltwater river now starts
  at the glacier socket.
- **Round 4** (river view, dynamism, things that make sense): the river view keeps each level's atmosphere while the
  river stays legible (fog and draw distance follow the orbit camera); a fatal fall only counts down once the iceberg
  is in the ravine, never mid-air over it. Living world: cars and trucks drive on roads and streets with an IDM car
  follower, stop at red lights at automatically placed signals on four-way asphalt junctions, and are handed to the
  physics when hit; chimneys and cooling towers smoke and steam; turbine rotors turn. Natural rivers: streams in
  carved channels, reservoirs behind dams, dam-break floods, river capture, and banks that trap an iceberg too small to
  climb out (≥ ~0.95 × its radius). Vehicles were moved onto roads or parking areas; boats moored on the sea.
- **Round 5** ("a bridge has to connect to the road"): a world-logic check (`src/core/terrain/logic.ts`,
  `validateWorldLogic`, errors included in `validateLevel`) — bridges from ground to ground carrying a road that
  reaches both ends, roads that end somewhere, rail rules, lighthouses on the coast, lift lines, buildings by a road,
  fences off roads — and the bridge deck planner (`src/core/obstacles/structures/deck.ts`): rim to rim, ramped
  between uneven rims, abutments in the banks, piers on the real ground. All nine levels were brought clean against it.
  A continuous world backdrop now surrounds every level beyond its bounds.
- **Engine fixes merged 2026-10-20** (`9efb76a`, measured by the engine agent): relief faded over 30 m round ramps and
  ravines never cut a ramp face — a test kicker that used to launch the iceberg off its toe (s 390.2) and leave it
  104 m under the ground now takes off at the lip (s 403.5–403.7, 13.1 m/s) and lands at s 426.6 (17.0 m/s); the
  route search was calibrated against autopilot runs (best model speed 0.95–1.06 of real runs) and now charges turns
  what the sim charges; opt-in `LevelDef.snow` (looks only) and `relief.clear` (keeps tors off alternative routes).
- **Riverside Town world logic** (`6ceb23e`): the viaduct crosses the gorge rim to rim on a new Gorge Road; line
  96.2 s, 32.4 % ice, 6 buildings, score 5589 (before 96.0 s, 32.5 %, 5594); 19 vehicles driving.

### Round 6 — "the bridge looks really off" / "grass coming off the bridge" (Highland Maze)

Diagnosis (probe of the deck plan against the ground): the glen road meets the Gorge at **37°** (a ravine running
diagonally across the course), but the bridge was built square: on each end, half of the abutment block hung over
the drop and, since its depth was taken from the lowest ground under it, reached down to the gorge floor (the grey
block under the deck in the user's view); the girder ends sat askew to the rims. Measured skew on every bridge
(where the rim crosses the deck's two edge lines): Highland Maze 37°/37°, Alpine Pass 30°/15°, Riverside Town 7°,
Power Valley 5° (one end), all others ≤ 6° (footbridges).

Fix 1 — **skewed bridges** (`76e89eb`): from 5° off square, a road deck's end follows the rim: the abutment's front
face, its seat and the girder end run along it (trapezoids in plan, new plan-view prism shapes); barriers and lines
end on the skewed ends; piers stay square. Footbridges stay square. New rule `bridge-skew` (≤ 45° road, ≤ 30° foot).
Highland Maze's span went 60 → 44 m (the gap is 24 m across, 30 m along the road) and its roads now run to both ends.
Alpine Pass's Devil's Cut test now starts on the open slope beside the bridge road (on the road the iceberg meets the
bridge end, which the old square deck happened to deflect into the cut). *Corrected after review #2 (below): that
explanation was wrong — the run on the road ended 'stuck' because of a phantom corner of the deck's bounding-box
collision proxy.*

Fix 2 — **approach cuttings** (`82b4508`): the user then saw grass and rock poking through the asphalt near the rims:
between each end and its rim the bank bulged above the straight deck line — measured 0.32 m on Highland Maze, 0.60 m
Riverside Town, 0.65 m Power Valley, 3.23 m at one corner of Alpine Pass. `createTerrain` now grades every grid vertex
within one cell of a bridge's footprint down to the running surface less 4 cm where it stands higher (cut only, never
fill; repeated against the fresh plan until it settles; the deck plan is unchanged — tested). After: Highland Maze
0.00 m inside the ends; what remains on the others (0.05–0.33 m) is at the end corners where parapets meet the bank.
Verified on the real GPU (river view close-ups of the Highland Maze bridge): no grass on the deck. *Corrected after
review #2: "the deck plan is unchanged — tested" was false (the test used analytic terrain only). Re-planning every
pass ratcheted the graded ends down and the 6-pass cap stopped mid-drift: Ravine Run's #49 high end sank 0.92 m,
Power Valley's skewed end turned square, Alpine Pass's x0 rim read 26.6° instead of 29.7°. And the cut, which also
graded footbridges, shaved up to 3 m off Ravine Run's take-off lips under R5's and R6's rope bridges, so both
crossings became fatal at 12 and 16 m/s.*

Review #2 — four adversarial reviewers (terrain, physics, geometry, world logic) confirmed 15 problems in the two
commits; the fixes (one branch, tested on every level):
- **Frozen plans**: every bridge is planned once on the ungraded ground and graded in a single pass against those
  plans; the lowering is kept in its own grid (`Terrain.bridgeCutAt`, not the fatal ravine field), which the deck
  planner adds back, so every later plan is the same plan. Test: on all 9 levels every deck plan (tops, supports,
  skews, banks, rim angles) is identical with and without the grading. Measured skews now: Highland Maze 37.3°/37.5°,
  Alpine Pass 29.8°/14.5°, Riverside Town 7.5°/6.2°, Power Valley 5.4° (x0 only), footbridges ≤ 5.9° (square).
- **No gameplay damage**: footbridges and take-offs (mound ridges, ramps) are never graded, and no vertex moves more
  than 5 m × scale. Ravine Run's terrain is now byte-identical to the ungraded one; straight down each rope bridge's
  own line R5 (d −122) clears at 12 / 16 m/s (end s 1050 / 1081) and R6's right lip (d 150) at 12 / 16 m/s (1292 /
  1299) — new session tests. Most graded per level (lowered / raised): Alpine Pass 4.84 / 0.31 m (7 vertices of the
  rock wall by the x0 end's edge are cut 2.0–4.84 m, the rest under 0.9 m), Riverside Town 0.66 / 0.43, Power Valley
  0.73 / 0.21, Highland Maze 0.39 / 0.41.
- **Approach step**: behind each abutment's back face the approach is made up (cut or filled) to the abutment top
  less 4 cm and blended over 8 m: no step over 5 cm across the road at either back face (tested on every level).
- **Contact footprint**: a skewed deck and a skewed abutment collide and carry traffic as their trapezoid
  (`ProxyRect.k0 / k1`, shared by the iceberg solver, the physics world's footprint distance and lever mass, and
  traffic support), not their bounding rectangle, which reached |skew| × width past the real end. The trapezoid
  alone did not stop the Highland Maze deck being thrown: an iceberg sliding off the glen road (s 1190, d 91/95/99,
  10 m/s) still met the skewed end face, whose push is 45–61 % sideways, and threw the deck 22–29 m into the gorge
  (a square end is pushed end-on and braced by its neighbours). So a deck still on its seats (within 0.5 m of where
  it was built) now takes an iceberg's push only along its own line; a deck dropped by a broken pier is loose as
  before. Deck moved 0.22–0.24 m now (test). Consequence, measured: down Alpine Pass's bridge road with no steering
  (s 400, d 178, 12 m/s) the iceberg now ends 'stuck' against the deck end, which follows the rim, instead of the
  pre-skew 'fell'; with the trapezoid but no seat restraint it fell only because the hit shoved the deck 12.8 m into
  the cut. The test keeps the open-slope case (d 196: 'fell') and records the road case as 'stuck' — a deviation
  from the brief, which asked for 'fell' there (both cannot hold: the sideways shove that let it fall at Alpine Pass,
  J 350 × 0.25, is smaller than the one that threw the Highland Maze deck, 208 × 0.61).
- **Geometry**: deck ends meet the abutment faces within 2 cm and never overlap, at both ends of every level bridge
  (the face used to pass through the road surface's end, so a graded deck sat DECK_H·tan(tilt) inside the low block
  and the physics popped it up 0.24 m on Riverside Town); decks stay put when woken (< 2 cm). The girder end clears
  the ground on lines 0.25 m apart (was 9 lines, 1.3 m apart: Alpine Pass's x0 girder end was buried 0.85 m between
  two) and the logic check samples the same lines. A rim beyond the span end on an edge line is looked for past the
  end, so its angle is measured and a deck edge left over the gap fails `bridge-end`. The abutment block stops at the
  bank measured per pair of lines (only the cap and the seat stand out over the drop) and its sides are plumb (a
  tilted block leaned its foot out over the gap: 1.66 m in the air on Riverside Town).
- **Measurement**: each edge line's crossing is interpolated (the footbridge angle moved in 6.5° steps) and a crossing
  too shallow for the 1 m drop line is measured where the girder clears it (it read square at any angle).
- Intended lines, before → after the review fixes (headless autopilot, real water budget): Rocky Canyon, Alpine Pass,
  Ravine Run, Highland Maze identical (complete; ice 29.1 / 33.0 / 39.0 / 31.0 %); Riverside Town complete, ice
  32.6 → 32.4 %, 95.8 → 96.0 s; Power Valley complete, ice 26.2 %, 113.4 → 113.5 s.
- Verified on the real GPU (river view close-ups, headless Chrome on the Iris Xe): Highland Maze's bridge ends run
  along both rims with no grass on the road; Alpine Pass's deck and abutment ends show no ground through the road;
  Ravine Run's R5 rope bridge stands on its lip as before 82b4508.

Tests after both fixes: 1573 passed, 1 skipped, 1 timed out (Summit Labyrinth's layout check: 5.4 s alone, 38–48 s
when the full parallel run shared the machine with a GPU check; its timeout is now 120 s).

## The Last Thaw — 2026-10-21 (Story Mode and two LLM agents)

What the user asked for: a tragic Story Mode on the same nine levels, told by Mara through an archive of documents,
with points weighted by environmental harm, three acts in which destruction becomes unavoidable, two real LLM agents
with structured tools, deterministic checks, an offline fallback, a personalised epilogue, music that turns from upbeat
to melancholic piano, a pilot-study interface and measured tokenomics. "The story should be the star": little time on
new 3D models. Architecture and rules: `docs/STORY_MODE.md`; how to run it: `README.md`.

- **The game is untouched underneath.** A story level is its base level plus the chapter's overlay (structures and
  landmarks appended, nothing moved); the iceberg's gravity, momentum, steering and collisions are the arcade ones.
  Story points come from `STORY_POINTS` (oil rig 1000, dam 900, pipeline 800, apartment block 750, cooling tower 700,
  pumpjack and tank 600, …): the more harm a structure does when it fails, the more it is worth, which chapter 1's
  tutorial sells and the later chapters turn around.
- **Evidence only from the run.** `RunEvidence` is built from the session's own `obstacleBroken` events mapped to
  the overlay's placements; a landmark is `intact` only if the iceberg reached it (else `notReached`). No casualties
  are inferred from collisions and nothing is "saved" that the run does not show.
- **Two agents, then a validator.** The Archivist drafts a reflection with claims; the Historian checks it with its
  own tools (`validate_narrative_events`, `check_narrative_continuity`) and approves or asks for a revision (3
  reviews, 4 for the epilogue); `src/story/validate.ts` runs last, and any failure gives the authored text instead.
  Portkey's Responses API (chat/completions rejects tools for gpt-6-luna), called from a Vite plugin so the key stays
  on the server; `.env` is looked up in the project folder and every parent, the real environment wins. Budgets:
  6 rounds, 12 tool calls, 45 s per request, 300 requests per process, 1.5 M tokens a day, 12 POSTs a minute.
- **Measured, not estimated.** 17 live runs (`docs/evidence/AGENT_RUNS.md`) and their cost
  (`docs/evidence/TOKENOMICS.md`, from the API's own usage objects); the prompt-injection test's raw runs are in
  `docs/evidence/`.
- **Fixes found by playing it.** `get_story_history` outgrew the 8,000-character tool cap once the overlays were in
  (a third shortening step drops landmark names). The live epilogue fell back after 3 Historian reviews and 3.3 min
  in the first full playthrough: it is now asked for the moment chapter 9 completes, gets a fourth review and 5 min
  (e75c2f0); the second full playthrough showed the AI epilogue approved and ready 2 s after Continue (7351151).
- **Music** (db00508): six Musopen piano recordings from Wikimedia Commons, each recording public domain or CC0
  (`docs/MUSIC_CREDITS.md`). Each mood plays a playlist, its own piece first: when one ends the next fades in and the
  list wraps round, and a file that will not load is skipped, so a long chapter never falls silent.
- **User feedback, same day.** Power Valley: a car drove up the slag heap's end cap, which reached 10.2 m into the
  plant street; the heap now ends short of the road, and a new world-logic rule `road-ground` fails any road where the
  ground at a lane centre stands more than 3 m above the road (3dc41d2). Story Mode's chapter list has a
  **Start over…** button (shown once there is progress; asks first; clears chapters, archive, attempts and the
  epilogue, keeps the settings) for anyone who wants to play the story again.
- Not done: the pilot study has its interface and export but no participants yet.
- **gpt-6-sol on the player's own key** (user, 2026-10-21: "Add gpt-6-sol as an option that runs on my own
  OPENAI_API_KEY (I'll pay for it); keep gpt-6-luna as the default on the course key"). The course allows only
  gpt-6-luna on PORTKEY_API_KEY, so the model now picks the provider: luna → Portkey with the course key, sol →
  api.openai.com with OPENAI_API_KEY, no gateway headers. The Portkey transport refuses every other model before
  sending; each key goes only to its own host; the player chooses in Settings → Story Mode → AI model (sol disabled,
  with the reason, when the server cannot run it); a sol request that cannot run fails with the reason and never
  moves to luna. Cost safety: OPENAI_DAILY_USD_LIMIT (default $2.00 a UTC day) from each response's real usage.
  Price from the OpenAI pricing page (20 × luna); no sol call was made (no OPENAI_API_KEY here), so its cost in
  `TOKENOMICS.md` is a projection from luna's measured tokens: $0.6281 per playthrough. Covered by fake-fetch tests.
- **Review fixes to gpt-6-sol** (2026-10-22). A base-URL override that spells the other provider's host another way
  (a trailing dot, `%2E`, another name for this machine) is refused like the plain host. The daily limit was
  check-then-record: twelve narratives at once with $0.01 left spent $2.41, a timed-out request added $0, and two
  servers on one key each had the full $2.00. Now each sol request holds its ceiling (body bytes at the cache-write
  rate plus its whole output allowance, `pricing.ts`) while it is in flight and is refused if that would pass the
  limit; the hold becomes the real cost, or stays when no usage came back; the charges live in one file per key and
  day in the OS temp folder, shared by every server on the key (`spend.ts`). New tests also pin that chapter
  reflections go on the chosen model, that gpt-6-luna stays choosable when nothing can run, and that a restart
  starts the limit from today's log.

## Sound — 2026-10-22 (the game and story sound bridge, the music direction, Settings, browser checks)

What the user asked for: background music and per-object sound effects in Arcade; sound design for The Last Thaw
as a quiet tragedy (no screams, no disaster-movie sounds, no explosions), event-driven sounds for every listed
category scaled by the real impact, one AudioManager with music / ambience / effects channels, volumes, mute,
pause, autoplay rules, no repetition fatigue, only original or licensed audio, a recurring piano motif tied to the
Archive's human stories, music that lowers or leaves at important moments, church bells where there is a church,
and browser tests. Design: `docs/AUDIO_DESIGN.md` (built as three packages on a frozen contract); as built:
`docs/AUDIO.md`. This entry is package C's (the bridge, the direction, the UI, the docs, the browser driver).

- **Audio only listens.** One `SessionBridge` per attempt subscribes to the session's events and reads its state
  (the iceberg, river, inland water, reservoirs, bodies); `listenOnly.test.ts` runs the real session for 40 s on
  Mountain Valley and Riverside Town ch4 with and without it and gets bit-identical iceberg, stats, events, route,
  river and physics stats. A throwing listener is caught; five errors silence the bridge for the attempt.
- **Magnitude from the actual impact** (log impulse plus closing speed; breaks from the broken mass and the hit that
  broke them): a light tap −34.6 dBFS, a house collapse about −14, a dam break −9. One contract constant was a
  placeholder: `chipAmountRef` 0.004 is below nearly every real chip, so the bridge uses 0.4, the 95th percentile
  of 29 chips over all nine levels (contract change requested).
- **Bells as a turret clock**, never a toll: background phrases of 2–4 strokes, the hour on approach (three in
  Arcade, six in Story), silence when the tower falls (mid-count if striking), a shiver when it holds a blow.
  Calibrated waterfall flow: `FALL_Q_REF` 17.5, the 90th percentile of 7,567 source samples over all levels.
- **The music direction.** Arcade's game screen now plays `wonder` (it was silent); Story's beds fall by act,
  Act III enters after the caption, losses breathe and scar, landmarks and churches lower it more, the
  Revelation holds the recording and plays *No. 14* only over a human document. The bridge's stand-in engine keeps
  the recorded music working before (or without) the engine: it passes cue, holds, bed, ducks and mutes to the
  existing player.
- **Found by the browser run** (`scripts/audio-e2e.mjs`): leaving Arcade play reset the bed to 0 dB before the cue
  went to null, so the 3 s fade-out began 2 dB louder (up to 5 dB leaving Act III); going silent now keeps the bed.
  The bell scheduler's trace entries said frame 0; they now carry the bridge's frame. The dev build's StrictMode
  makes two sessions per attempt, the first ended at once: the checks count live sessions.
- **Settings → Sound**: master, music, ambience, effects, Mute music, Mute all sound; **M** anywhere, announced in a
  polite live region (a repeated announcement still changes the region's text). How to Play lists M; the credits
  name the synthesized sound and the motif.
- P1, after every P0 item was in and tested: the Settings preview (letting go of Effects or Ambience asks the
  engine for a sample, at most every 0.4 s) and the intro's calving (groan, crack, landing on the first attempt;
  only the crack and the landing on Retry, which is heard often; a third listen-only case runs the full intro).
  Not built: machines that run until destroyed. Cut by the lead: the "Vey strings". Nobody has listened to the result yet: every check is a number
  (`docs/AUDIO.md`, *What only a human ear can judge*).

## Sound integration — 2026-10-22 (the engine, the synthesis and the bridge together)

- **Merged** in the design's order: A (engine), B (synthesis), C (bridge), each `--no-ff`, onto
  `feature/last-thaw`. No conflicts: C had copied A's four settings fields verbatim.
- **Contract requests decided** in one commit (listed at the top of `docs/AUDIO_DESIGN.md`). The one that would
  have been heard: A's graph had a 15 ms DelayNode and the browser's IR normalisation, B's IR already carries the
  predelay with unit energy; the graph now has no DelayNode and `normalize = false`. Also `chipAmountRef` 0.4 (C's
  measured value; the placeholder played every chip at full level) and a per-request space send so the calving
  gets its echo. Three requests refused, with reasons.
- **Wired:** the manager bakes with B's bank, noise and ambience voices and convolves with B's IR; the bridge and
  the director drive A's `audio` (C's stand-in manager and router are gone); C's copy of the spatial maths is gone;
  the lab measures with B's BS.1770 analysis. `packages.integration.test.ts` runs all three headless on real
  autopilot runs (real buffers, B's voices fed by C, St Bride's ringing, gameplay bit-identical).
- **Smoke run in headless Chrome** (`docs/evidence/AUDIO_RUNS.md`): autoplay, Arcade music and ambience, impact-
  scaled hits and collapses, Story's cue and ducks, pause, and leaving all behave by the numbers.
- **Found and fixed:** the approach hour was traced on every frame while it waited for a phrase to finish (now
  once); the e2e driver could not read a silent meter (−Infinity over CDP).
- **Found, open:** an Arcade level's sounds are baked only once the level is chosen, by idle-time slices; in
  headless Chrome Riverside Town's set took 47.7 s while the level loaded and played, so St Bride's first phrase
  and its approach hour were dropped as `notReady` (silent), and Power Valley's first metal hits likewise. Baked on
  the menu first, the same set takes 9.2 s and every strike plays. Needs a decision (bake bells earlier, bigger
  slices during the loading screen, or bake on the level-select screen) and a measurement on the real laptop.

## Sound fix round — 2026-10-22 (the integration's open problems, every browser scenario run)

- **The level set now bakes in time** (the bells were its casualty). Before: a level's sounds were asked for only
  once it was chosen and baked in idle-time slices of ≤ 4 ms behind everything else; from a cold start straight
  into play St Bride's strike never baked (0 of 7 strikes played in Arcade, 0 of 10 in chapter 4) and 2, 7 and 11
  hits were dropped as `notReady` (Riverside, chapter 4, Power Valley). Now the bank bakes without an
  AudioContext, the director asks for the next level's set on the menus, before any gesture; each level's bell
  strikes bake first, then its collision sounds, then the core and the heavy sounds; slices are paced by the
  screen (16 ms behind the loading overlay, up to 12 ms of a menu's idle time, ≤ 4 ms in play); a bell whose
  strike is still baking waits for it; every `notReady` drop is counted. After, three cold starts of each flow:
  every strike played, nothing dropped. The first attempt had used 40 ms slices behind the overlay; measured
  against `?audio=off` they made the load 0.17–0.43 s longer, so they are 16 ms (+0.08 s on average, nothing
  dropped).
- **The Ambience preview works from a cold start**: the core keeps St Bride's strike.
- **The motif is calibrated**: `MOTIF_CALIB_DB` +0.2 dB from the six recordings' loudness (median −25.77 LUFS-I)
  and the seven motif renders' (−28.99), the design's 3 LU under. Found: the recordings span 12.6 LU, so in Act III
  the motif comes in 4–8.5 LU above the chapter's own recording; left for the lead and a listener, with the trims
  that would fix it.
- **S4, decided by a better mapping**: the closing speed used to add to a hit's magnitude whatever its impulse, so
  fences brushed at 25 m/s that moved almost no momentum played as loud as real knocks (ρ 0.761 and 0.860
  against 0.9). The speed term now counts in proportion to the impulse up to J 20; ρ 0.961 and 0.959 on the
  requested levels (0.95 on the ±8 m lanes, which were in the gate's sample too, so not held out), 0.921 as played. The threshold is checked on the mapping's levels,
  and the engine's jitter and density compensation separately (every play within bounds).
- **Found by the new engine scenarios and fixed**: the shared reverb rang on for 2.2 s after leaving the game
  (−72.6 dBFS on the menu; now it closes with the last attempt, digital silence); R11's limiter reduction was
  misread by the limiter's 6 ms look-ahead (145–159 dB; now 0); R4's full-scale burst failed on white noise's own
  intersample peaks (now band-limited like the game's signals: −1.29 dBTP).
- **Every scenario of `AUDIO_DESIGN.md` §11 run on the integrated build**, S0–S13 with engine twins of S3, S5, S8,
  S10 and S11, S4M, R1–R11 and the bake runs: 329 checks passed, 0 failed, 2 not applicable (`docs/evidence/AUDIO_RUNS.md`, *After the open
  problems*). Headless Chrome; nothing was listened to.
- **Open**: the motif's level in Act III; the first click's unlock is one 0.25–0.6 s main-thread task in headless
  Chrome (mostly the `AudioContext` constructor), to be measured on the real laptop.

## Sound, second fix round — 2026-10-22 (after the review)

- **Restarting on the same screen** (Replay chapter, R, Continue with narrative off) carried the Revelation's
  reading level, its hold and its motif into the next attempt (effects −12 dB for the whole attempt). The moments
  now end with the run they belong to. New engine scenario S14: 10 of 10.
- **A hidden tab** released the music's hold on wall time while the motif waited on the suspended audio clock, so
  the two played together on return. The release now follows the audio clock; the router's hold limits pause
  while hidden.
- **The music's level.** The six recordings spanned 12.6 LU, so the beds could not make a descent and from chapter
  4 on the piano sat 11–18 LU under the game. Four files were raised losslessly (MP3 global gain) and the player
  cuts each to −22.1 LUFS-I; in play Act III now sits 6–11 LU under the master. Act II's opening still measures
  13.6–16.5 LU under (the nocturne starts quietly); left for a listener.
- **Lead decision L1, the motif never above its chapter's recording**: `MOTIF_CALIB_DB` +3.9 against the matched
  recordings and per-moment trims (−4 to −9.5 dB), the attempt's scar and chapter 9's sea subtracted at the moment;
  the lab measures every moment 1.06–1.48 LU under (R7).
- **Lead decision L2, the first click**: the noise bank and the reverb IR are computed on the menu before the
  gesture; the click's task went from 0.51–0.56 s to 0.33–0.42 s, the rest mostly the `AudioContext` constructor,
  which must stay in the gesture.
- Smaller: the aftermath's release per act, M on a focused slider, HMR of the engine reloads the page, the
  libebur128 credit and the DSP sources, docs corrected (held-out lanes, the S4 rationale, the late bake, the bank
  peak 19.1 MiB, node's checksum), constants pinned by value.

## Sound, the epilogue motif's bake — 2026-10-23

- **The race.** S11E finished chapter 9 and played the Revelation's motif, but the epilogue's never came: `motif
  epilogue@1: not baked` three times, then the hold was released. It is the longest bake (34.2 s of piano, 3.1–3.7 s
  of main-thread work in headless Chrome), chapter 9's set bakes it last, behind the river view the idle pace gave
  it 0.06–0.19 s of work a second, and the moment waited 5 s.
- **Fix**: a motif a moment wants is baked first (a bake in progress is set aside and resumed) at the loading
  overlay's 16 ms timer slices, off play only (`AudioManager.awaitMotif`, `SoundBank.prioritize`); the epilogue
  waits up to 15 s for its motif (the other moments keep their start time + 0.5 s); from chapter 9's Revelation
  until the epilogue, the epilogue's motif is asked for the same way.
- **Measured** (`docs/evidence/AUDIO_RUNS.md`, *Epilogue motif bake*): S11E three times, the motif baked in play
  (50.1–53.5 s into chapter 9) and on time each run; the new EPI scenario's worst case (nothing of it baked at the
  epilogue's start) baked it in 4.5–5.5 s and started it 5.0–5.8 s in, inside the 15 s wait (two of five runs would
  have missed the old 5 s). On the Revelation the faster pace keeps the median frame at 16.7 ms and costs about 9 %
  of the frames while it runs; S12 −0.1 ms against `?audio=off`, S1 passes. On a 2x CPU-throttled main thread with
  a minute on the Revelation the epilogue's motif played on time because of the Revelation's ask (missed without).
- Measured and not kept as worded: moving the chapter's motifs to the front at the run's end (nothing was pending
  ahead of them in any run) and baking the epilogue earlier in play (not free in play).
- **Open**: on a 2x CPU-throttled main thread the Revelations' motifs are still missed, and the epilogue's after a
  short read (the render is the cost; a cheaper render or a Worker bake would be next). Nobody has listened to a
  late motif. *(Done the same day: next section.)*

## Sound, slow computers — 2026-10-23

- **Before** (measured again first, `cd4357b`): with the CPU throttled 2x and a 20 s read, S11E missed chapter 1's
  Revelation motif, chapter 9's and the epilogue's (13 pass, 7 fail); EPI's worst case took 3,581 ms of main-thread
  work for the epilogue's motif.
- **A cheaper render, the same samples**: the felt piano's per-sample loops ran inside the generators the bank
  slices, three to four times slower than the same loop in a plain function. They (and the room's) now run as
  plain functions between the same yields; a twinned partial's strings share one loop. Same arithmetic, same order:
  every motif's hash is pinned from the old render, in node and in Chrome. The epilogue: 3.8 s → 0.7 s in node,
  3.6 s → 0.7–0.8 s in Chrome. No partial culled, nothing to listen for.
- **Motifs in a Web Worker** (module worker, Vite's `new URL(..., import.meta.url)`), sent as soon as a set is
  asked for, in the bank's order; the main thread only wraps the result. No worker (`file://`, node, jsdom,
  `?audioworker=off`) or a failed one: the main-thread bake as before. Identical samples either way.
- **Queue edge cases**: (A) the bank keeps a moment's request by key, so a motif dropped and asked for again keeps
  its priority; `awaitMotif` passes repeats on and the epilogue asks for its own motif (its own trace line). (B)
  releasing a motif sets its bake in progress aside, so the level's sounds come first again.
- **Driver**: EPI checks the epilogue's own ask and the bank's `awaited`, runs on the main-thread path; new EPIW
  (the worker); `--cpu-throttle N` also slows the worker (`?audioworkerslow=N`: DevTools throttling cannot reach a
  worker, measured); `--audio-worker off`; S11E checks chapter 9's Revelation motif after its wait; the first render
  may take 180 s; S13 checks every motif's hash in Chrome.
- **Measured** (`docs/evidence/AUDIO_RUNS.md`, *Slow computers*): at 2x, S11E **3 of 3** with every motif on time
  (chapter 9's two baked before its play began); without the worker all four played too (20 of 20 with the moved
  check), with less margin. At normal speed S11E 3 of 3, the epilogue's motif baked 3.2–4.0 s into chapter 9 (was
  46–54 s); EPI's worst case 693 ms of main-thread work and the motif at +4.62 s, EPIW 0 ms and +4.53 s; S1 and S13
  pass; S12 −0.05 and −0.1 ms against `?audio=off` (a first S12 failed the other way: its `?audio=off` baseline ran
  at 30 fps, machine noise).
- **Open**: at 2x the level's own sounds still lag (10 of chapter 9's set pending at the run's end, one dropped in
  play): the recipes' loops have the same generator cost. A real two-core machine (the worker competing for a core)
  and `file://` were not measured.

## Roadmap — keep in mind for later levels (user, 2026-10-16)

- **Music**: done for Story Mode on 2026-10-21 (piano playlists per mood, see The Last Thaw above), and for
  Arcade with the sound design on 2026-10-22 (above). Music that reacts to speed was not built; stingers for
  waterfall / complete / fail were dropped on purpose (the sound design avoids triumphant stingers).
- **More, harder levels**: steeper slopes (0.15–0.25) so the iceberg goes much faster, more complicated layouts
  (winding canyon, several waterfalls, tight gates). May need `maxSpeed` > 34 m/s and camera/FOV tuning.
- **Big, powerful iceberg levels** (longer courses): houses, power plants and industrial buildings should go down
  easily. Design: per-level `iceberg: { scale, mass }` in LevelDef (radius, river width, camera distance and water
  budget scale with it). Today an anchored obstacle breaks when `J = 1.25·vn·Mm/(M+m) ≥ breakImpulse`; because
  `Mm/(M+m)` saturates at the obstacle's mass m, a heavier iceberg barely helps. Switch the anchored test to the
  iceberg's momentum `J = 1.25·vn·M` and recalibrate (pine ≈ 262, broadleaf ≈ 337, house ≈ 562 at M = 30) — then
  a 90 t iceberg flattens a house at ~5 m/s. New obstacle kinds: power-plant hall, cooling tower, tanks, pipes,
  pylons/power lines (compound bodies like houses; small parts break off, big parts need a big iceberg).
- **Wind (literal)**: if wanted later, gusts that push the iceberg sideways and/or speed up melting.

## Known problems

- Keyboard tap-steering is much slower than proportional (mouse) steering (balance probe #2); acceptable for now.
- The intro and the LEVEL COMPLETE panel are generous in size; the panel hides much of the outro pull-back shot.
- Shadowed rock faces read very dark navy; could use a little more fill light.
- No interpolation between 60 Hz sim steps (possible judder on high-refresh monitors).
- THREE.Clock deprecation warning in the console comes from @react-three/fiber, not our code.
- Sound: the level set bakes on the menus before the first gesture and bells wait for their strike, so in the fix
  round's cold starts nothing was dropped (7 of 7 and 10 of 10 strikes, 0 `notReady`). On a main thread twice as
  slow (DevTools CPU throttling, 2026-10-23) chapter 9's own sounds still lag: 10 of its set were pending at the
  run's end (95 s of play; 25 in the same run before the change, the two motifs among them) and one sound was
  dropped as `notReady` in play. The Story motifs now play on time there (next item). See *Sound fix round* and *Sound, slow computers*
  above.
- Sound, resolved by lead decision L1b (2026-10-23): chapter 9's motifs no longer follow the sea's −10 dB (it
  left the epilogue's motif at −55.6 dBFS RMS against the ambience's −37.2, probably masked); the epilogue lowers
  the ambience 14 dB instead. Measured after: −48.1 to −48.4 dBFS against −44.9 to −46.3. Whether that is heard
  over the sea is for a listener (`docs/AUDIO.md`).
- Sound, resolved 2026-10-23: the Story motifs on a slow machine. The motifs render in a Web Worker (about 0.7 s
  for the epilogue's, 3.6 s before on the main thread); with the CPU throttled 2x (the worker slowed as much) and a
  20 s read every motif played on time in 3 of 3 runs, and on the main thread alone (no worker, as under
  `file://`) all four played in both runs, with less margin. Both queue edge cases are fixed
  (`docs/evidence/AUDIO_RUNS.md`, *Slow computers*). Not measured: a real two-core machine, where the worker
  competes with the game for a core.
- Alpine Pass: three streets over mounds tilt 1.0–1.6 m between their lane centres (feature 9 at s 96, 12 at s 478,
  18 at s 1113). Within `road-ground`'s 3 m, and levelling them would change the col's gameplay, so left as is.
- The Claude Browser preview pane could not be used for timing (hidden pane → requestAnimationFrame throttled to
  0–1 fps); all real-GPU measurements were made with a headless Chrome driver instead.
