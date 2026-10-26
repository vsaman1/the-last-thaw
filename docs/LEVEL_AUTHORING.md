# Level authoring guide

How to build a level for Iceberg River. A level is one `LevelDef` (see `src/core/types.ts`) in
`src/core/levels/levelN.ts`, registered in `src/core/levels/index.ts`. Everything is placed in **course
coordinates**: `s` = arc length along the valley centreline (metres from its first control point), `d` = lateral
offset, positive = right of the travel direction.

## 1. Shape of the valley

- `course`: control points `{x, z, floor, halfWidth}` from the start to well out to sea. `floor` is the *base*
  floor (cliff drops are subtracted downstream of each cliff). Keep the centreline descending between cliffs.
- `cliffs`: `{s, drop}` — sharp drops that become waterfalls. Clean lip, flat-ish landing run-out (≥ 25 m). A cliff
  must be before `coastS`.
- **Cliff bands**: `{s, drop, d, width, skew?}` — a cliff that is sheer only over `width` m centred on `d` (a rock
  step across part of the slope). The ground below is `drop` lower everywhere; beyond the band's ends the drop is
  spread along s over 4 m per metre out (`cliffBandSpread`), so you can ride round an end: the slope there is
  rideable (< 0.6) from ~0.63 × drop m beyond it. `skew` (ds per metre across, |skew| ≤ 1.5) runs the lip
  diagonally: lip at `s + skew·(d' − d)`. Flying off a band is a waterfall like any cliff (the river and the
  waterfall counter treat it the same). Keep a band ≥ 79 m (`COAST_REACH`) before `coastS`.
  **The spread zone covers the whole rest of the floor.** From 22.5 m beyond an end (90 m / 4) on, however far
  across the slope, the drop is spread over lip − 31.5 … lip + 58.5 m (`cliffMaxSpread` 90 m): the floor there is
  up to 1.5 · drop / 90 steeper than the course's (+0.2 for a 12 m band, +0.27 for 16 m), steepest ~13 m below
  the lip line. That is deliberate (the ground below has to be lower everywhere, and a shorter spread would be a
  steeper, kicker-like crest), but it matters for what you place there: a ramp keeps its authored shape relative
  to that floor, so it takes off that much flatter than on the plain slope (fly it with `rampLaunch(ramp, v,
  localSlope)`), and the run-up is faster. `levelWarnings(terrain)` lists every ramp in a spread zone with the
  extra slope (Glacier Avalanche's draft kicker at s 403.5, 55 m beyond a band's end: +0.2 on a 0.13 slope).
  **To keep a band out of the other branches**, set `spreadSlope` on it: the spread keeps lengthening (4 m per metre
  out) until the floor is at most that much steeper — `spreadSlope: 0.05` spreads a 12 m drop over up to 360 m
  (lip − 126 … lip + 234 m), +0.09 50 m beyond its end and ≤ +0.05 from 110 m on; the slope you ride round the end
  on is unchanged. It is opt-in because it reshapes the floor far down the slope (made the default, it broke Alpine
  Pass's balanced glacier-tongue graze line); keep such a band ≥ 0.65 × the spread before other cliffs and the coast.
- `startS`, `coastS` (floor reaches sea level), `finishS` ≈ `coastS + 20` (just into open water), and keep ≥ 100 m of
  course past `finishS` (camera, ocean current).
- **Coast blend.** Over the last **70 m before `coastS`** (up to **79 m** off the centreline, where the shoreline
  wobbles: `COAST_REACH` in `terrain.ts`) the floor is blended into the beach/seabed profile. A cliff inside that
  stretch keeps its full drop — the blend starts at the foot of the last such cliff — but the floor below it is
  pulled toward the beach (keep the designed floor there close to sea level, or the foot moves). Features (gaps,
  ramps, hills, basins) are added on top of the coast shaping and keep their shape. `validateLevel` fails a cliff at
  or past `coastS`, or one whose terrain drop is under 90 % of `drop` (before this fix a cliff ~15 m from the coast
  vanished and Power Valley's 30 m sea cliff, 55 m out, kept 25 m).
- `wallHeight`, `wallRamp`; `bounds` with generous margins; `cellSize: 2` for crisp features (2.5 is fine without).

## 2. Terrain features (`features`)

General rules: features (except roads, streets and parking areas) start at or after `startS + 20`, end before
`coastS`, have their centre on the floor; only islands and polyline features may straddle a cliff; a ramp lip may sit exactly on a cliff lip; gaps and
islands must not overlap other features (polyline features may meet anything: mazes are built from junctions). A
trap wall must be at least `2.21 × cellSize` deep (4.4 m at cellSize 2, 5.5 m at 2.5, 6.6 m at 3).

| feature | fields | rules of thumb |
| --- | --- | --- |
| `hill` | `s, d, radius, height` | max slope 1.54·h/r ≤ 0.6 (h ≤ 0.39·r). h 5 / r 16: a 5 m/s iceberg rolls back, 14 m/s crests it (low speed, 0.087 slope; see below for fast icebergs) |
| `basin` | `s, d, radius, depth` | 1.54·depth/r ≤ 0.9; bottom ≥ 0.5 m above sea. depth 5 / r 12 holds a 3 m/s iceberg, 16 m/s rides through (low speed, 0.087 slope; see below) |
| `ramp` | `s` = lip, `d, width, length, height` | lip slope 2h/length ≤ 0.9; width ≥ 1.5 iceberg diameters; 3/16 ramp flies ~23 m at 15 m/s (`rampLaunch()`, speed at the lip); 25 m clear landing; face must not cross a cliff; floor bumps and relief fade out over 30 m around it (a calm run-up); a gap or ravine never cuts its face |
| `gap` | `s` = take-off edge, `length, depth, d?, width?, fatal?` | **fatal** (see below) unless `fatal: false`; full-width gap needs a ramp lip within [s − 8, s + 1] and length + radius + 2 ≤ flight at 15 m/s (3/16 ramp clears ~19 m); several ramps may share a gap (each is checked); 25 m after the far edge free of cliffs/basins/gaps/islands/ravines/wall ridges; a partial gap needs a way round ≥ 2.5 diameters free of islands, other gaps, basins, wall ridges and ravines all along it |
| `island` | `s0, s1, d, width, height` | height ≥ 2.97 × cellSize; each channel ≥ 2.5 iceberg diameters (11 m at base size, 22 m at scale 2); rock surface |
| `plateau` | `s0, s1, d, width, height` | length ≥ 10·h + 4 (each end ramp runs 5·h); flat top follows the valley descent |
| `road` | `s0, s1, d, width ≥ 4, surface?, start?, end?` | asphalt (town/industrial) or gravel by default, `'rail'` = a track bed (gravel ballast, no traffic); may be a terrace cut into the wall up to `halfWidth + wallRamp`; tapers over 8 m; must not cross a cliff; shorter than wide (s1 − s0 < width) = a cross street for traffic (see 2c); `start` / `end`: an intended end at s0 / s1 (6b) |
| `street` | `points: {s,d}[], width ≥ 4, surface?, speed?, signals?, carve?, start?, end?` | a road along a polyline (2c): cross streets, bends, junctions; levelled like a road, round ends; `carve: false` shapes nothing (a street over a bridge deck or a dam crest); `start` / `end` as for roads |
| `parking` | `s, d, length, width (≥ 4 each), yaw?, surface?` | a levelled paved rectangle (also a garage apron); vehicles on it are parked |
| `ridge` | `points: {s,d}[], width, height, profile?` | a rock spine along a polyline (round ends): branching and diagonal walls, dead ends. `'wall'` (default): island profile, blocks when height ≥ 2.97 × cellSize (7.4 m at 2.5); `'mound'`: (1 − q²)² bank, crestable when height ≤ 0.19 × width (slope ≤ 0.6); width ≥ 2 cells; points may run into the walls (≤ halfWidth + wallRamp) to seal a branch |
| `gully` | `points, width, depth, closed?` | a groove along a polyline that guides the iceberg; opens over max(width, 5·depth) from its first point, fades out the same way before its last point unless `closed` (then it ends in a wall as steep as its sides); width ≥ 2.5 diameters; side slope ≈ 1.54·depth / (width / 2): < 0.6 a fast iceberg rides out, > 1.2 it is a slot (a closed slot is a dead end) |
| `ravine` | `points, width, depth, fatal?` | a gap along a polyline (diagonal cuts across the slope), round ends, sheer walls, **fatal** unless `fatal: false`; depth ≥ trap wall, width ≥ 2 cells; cross it on the line only where a jump clears (see "Fatal ravines") |
| `stream` | `points` (source → mouth), `width, bank, depth?, flow?, end?, source` | a river channel with flowing water (see §2d): width ≥ max(4 m, 2 cells), bank ≥ 1 m, depth ≤ 0.8 × bank; it must **have a source** (`'glacier'`, `'cave'` or `'branch'`, §2d "Where a river comes from") and end in the sea, in another stream, or with `end: 'pool'`; may run past `coastS` into the sea; banks ≥ 0.95 × the iceberg's radius hold it in the channel; a glacier-fed stream starts under the glacier, upstream of the spawn (exempt from the start rule, but its bank top keeps an iceberg diameter from the spawn point) |

Polyline features use (s, d) as flat coordinates: exact on straight courses, stretched by 1 − κ·d on bends (keep
open-mountain courses nearly straight). Obstacles on features: in gaps and ravines only `footbridge`/`roadBridge`;
on islands and wall ridges only `pine`, `broadleaf`, `rockSmall`, `rockMedium`, `boulder`; nothing on ramp faces.

**Jumps off ramps.** A ramp's lip height and take-off angle are exact wherever the lip falls on the terrain grid,
on straights and on bends: the terrain publishes each lip (`Terrain.kickers`), and over the last cell diagonal
(+ 0.5 m) of the face an iceberg heading over the lip rides the exact face and takes off at the lip line, at any
speed. So there is no need to put a lip on a grid row. "Heading over" means within ~53° of square to the lip, on a
path that meets the lip inside the ramp's width: running along a ramp or off its side edge gets no kicker take-off,
and nothing launches off the back face or the floor past the lip. The flight is what `rampLaunch()` predicts for
the speed at the lip (the sim lands 1–4 % short: air drag); climbing a 3.5 m lip costs 1.6–2.6 m/s of approach
speed (more when slow). On a misaligned lip the iceberg rides up to one cell's rise above the mesh over that last
stretch (cosmetic). Jumps are 6–11 % longer than off the old grid-aligned lips (whose last grid cell was flatter
than the authored lip slope) and up to ~40 % longer than off the worst-aligned ones.
- **A lip at a ravine's edge.** A gap or ravine never cuts a ramp's face: put the lip at the near edge, or even a
  little past it, and the whole face is kept up to the lip line (the ravine's edge follows the lip there;
  `levelWarnings` notes it). Before, a ravine wall eating the last 0.2–0.6 m of a face mis-fitted the exact lip and
  put the iceberg tens of metres under the ground with its speed gone (Glacier Avalanche's draft, Power Valley's
  dirt kicker).
- **Calm run-up.** Floor bumps and relief fade out over 30 m around a ramp (along the slope and across), so its toe
  meets the ground without a step at any relief seed (a step there used to launch a fast iceberg before the lip:
  0.3–4 m on a roll-3 slope). The run-up and landing within 30 m are the designed floor.
- **Coming down on a face.** An iceberg that lands on the last metres of a face lands on the exact face and rides
  on to the lip; a hull on land is never left under the terrain. A kicker sample whose fitted face does not match
  the terrain (a ridge across the face, a fold of the course on a bend) gets no exact take-off: `levelWarnings`
  lists it.

**Fast icebergs and smooth features.** Hill crests and the far walls of basins are kickers too: at ≥ 20 m/s they
launch 70–110 m flights (observed on valley slopes 0.065–0.2). The hill/basin rules of thumb above were measured at
low speed on a 0.087 slope; check what a fast line does over every hill and basin it can reach.

**Traps.** A slow iceberg that rocks in a basin, or rolls back off a hill it could not crest, is failed as stuck
about 10–13 s after it drops in (the trap rule in `src/core/sim/confinement.ts`: it keeps coming back to where it
was; measured on bowls r 8–15, depth 4–5), no longer only once the rocking dies out (33–38 s). Shallow dips that
rock slowly take 13–30 s (25–32 s before). Steering out still works whenever it did before. An iceberg that rolls
back off a hill and would only creep round it after a long backward excursion is now failed too. (Ravines are no
longer traps: falling into one ends the run at once, see below. `fatal: false` restores the old trench.)

**Fatal ravines.** Gaps and ravines are fatal by default. The run ends as `'fell'` ("FELL INTO THE RAVINE!", with a
tip: hit it faster and straight on, line up with a kicker or a drop, or find another way round) once the **grounded**
iceberg stands on ground the ravine has lowered by at least `FELL_DEPTH` = 2 m (`Terrain.ravineDepthAt`, the same
grid interpolation as the heights) and `FELL_BEAT` = 0.6 s have passed: the plunge and the crash play, then the fail
camera orbits the iceberg down in the ravine (`src/core/fall.ts`; the stuck rule waits for the beat). Flying over a
ravine never counts, nor does landing on its far edge or riding along its rim (the iceberg's centre decides), nor
cliffs, cliff bands, gullies, basins or the sea. A slow iceberg off Rocky Canyon's kicker now fails ~2–3 s after
take-off instead of ~10 s later as stuck. How fast does a jump need to be?
- **Off a kicker** (`rampLaunch()`): a 3.5 m / 14 m kicker flies ~15 m at 10 m/s at the lip, ~20 m at 12, ~29 m at
  15, ~47 m at 20 (the sim lands 1–4 % short). Climbing the kicker costs ~1.5–3 m/s of approach speed.
- **The rule for everything else:** the iceberg leaves an edge along the slope it was riding, so it clears a ravine W
  m across only if the far rim lies Δh below that take-off plane: `v > W · sqrt(g / (2·Δh))` (+ ~1 m/s for its
  hull and the grid). (The old rule `v² > g·W / (2·slope)` was wrong: on a uniform slope the far rim is ON the
  take-off plane, Δh = 0.)
- **Without a kicker, on a uniform slope:** it cannot be cleared. Measured on a 0.13 slope at cellSize 2.5: 12, 16
  and 20 m ravines are never cleared below the 34 m/s cap; only the grid's rounded edges let 6–10 m ones be hopped
  at 20–25 m/s (14–21 m/s at cellSize 2): don't design on that either way — add a kicker, a drop or a crest.
- **Off a drop** (a cliff band whose foot is the ravine's near edge, Δh = drop; the slope cancels out): 16 m under an
  8 m band needs 13.6 m/s (rule 12.5), 10 m under 12 m 6.0 (6.4), 20 m under 6 m 18.5 (18.1); at cellSize 3 up to
  ~3 m/s more. (The old `W / sqrt(2·(drop + slope·W) / g)` gave 11.2 / 6.1 / 15.1: too low.)
- **Over a crest** (the slope steepens by Δs at the edge, Δh = Δs·W): it needs 1.25–1.7× the rule, because a gentle
  crest only launches a fast iceberg: 10 m over +0.3 needs 16 m/s (rule 12.8), 16 m over +0.5 21.4 (12.5), 16 m over
  +0.2 never. A crest is a weak jump; use a kicker.
- At an angle the crossing is longer (W / cos θ). Faces between 0.9 and 1.2 that the iceberg can still climb are
  kickers too (relief outcrops are made sheer for that reason). All measured in `src/core/sim/jumpRules.test.ts`.

## 2b. Open mountainside levels (`relief`)

For a level that is a mountainside, not a corridor: a **wide floor** (`halfWidth` 150–300 m), a nearly straight course
(bend radius ≥ 1.1 × halfWidth, else course coordinates fold on the inside of the bend: checked), `relief`, and
polyline features to shape the maze.

```ts
relief: { roll: 3, rollScale: 160, gullies: 2.5, gullySpacing: 50, outcrops: 6, outcropCover: 0.05, lineClear: 15 },
features: [
  // A fork: two wall ridges split the slope into three branches; C seals the left one into a pocket.
  { type: 'ridge', points: [{ s: 150, d: -15 }, { s: 300, d: -80 }, { s: 600, d: -125 }], width: 8, height: 10 },
  { type: 'ridge', points: [{ s: 150, d: 15 }, { s: 300, d: 70 }, { s: 628, d: 112 }], width: 8, height: 10 },
  { type: 'ridge', points: [{ s: 560, d: -120 }, { s: 600, d: -265 }], width: 8, height: 10 },
  // A diagonal ravine across the middle, a kicker on the line at its near edge.
  { type: 'ravine', points: [{ s: 600, d: -125 }, { s: 622, d: 60 }, { s: 630, d: 125 }], width: 16, depth: 12 },
  { type: 'ramp', s: 605.5, d: 0, width: 14, length: 14, height: 3.5 },
  // A slot that ends in a wall: a dead end.
  { type: 'gully', points: [{ s: 1000, d: 150 }, { s: 1150, d: 200 }], width: 14, depth: 7, closed: true },
],
cliffs: [{ s: 900, drop: 12, d: -60, width: 200 }], // a cliff band: waterfall in the middle, ride round the right
```

(Simplified from `src/core/testing/mountainSandbox.ts`, the engine's test level: read it and its tests for a worked
example.) What `relief` adds, all deterministic from the level seed (+ `relief.seed`), faded out near the spawn, the
beach, the floor edge, cliff lips and under ramps (and 30 m around them), plateaus and roads:
- `roll` (m, size `rollScale` = 140): broad undulation. Where it outweighs the descent it leaves hollows (natural dead
  ends): keep roll · 3 / rollScale below the slope unless you want them.
- `gullies` (m, `gullySpacing` = 45, `gullyStretch` = 5): braided grooves running down the slope, ~0.3 × spacing wide;
  they channel an iceberg that is not steering hard.
- `outcrops` (m, `outcropCover` = 0.05 of the floor, `outcropScale` = 28): sheer rock tors. Taller than the trap wall
  (5.5 m at 2.5) they block like islands; `lineClear` keeps them that far from `line`. They are terrain, not obstacles:
  the autopilot does not avoid them off the line. Their pattern is anchored to the course: the cover is measured on
  the floor (startS … coastS), so changing `bounds` no longer moves them (it used to; re-anchoring kept 85–100 % of
  each level's tor area and brought Summit Labyrinth's cover from 1.7 % to the 2.5 % it asks for).
- `clear: [{ points, width? }]`: more corridors kept free of tors — alternative routes, a dam breach, the way round a
  band. Tors fade out within `width` / 2 of each polyline (default `lineClear`, else 15 m) and reach full height 12 m
  further out, exactly as along the line. Prefer this to switching tors off.

**Building a maze.** Branches are made by wall ridges (they may run into the walls to seal a branch). Dead ends must be
real: a pocket closed by walls on a descending slope (the iceberg cannot climb back: stuck), a closed slot gully, or a
ravine with no kicker (fell). A diagonal wall across the slope is a deflector, not a dead end: the iceberg slides along
it downhill. Expect relief to add its own small dead ends (hollows, tors).

**Route search** (`analyzeRoutes(terrain)` in `src/core/terrain/routes.ts`, 1.3–2.6 s per open level alone, cached
per terrain): an energy model (speed² / 2g, friction, drag, climbing; faces > the wall slope block; ravine floors
kill) searched over 5 m cells × 8 headings × a two-move turn memory, with jump moves found by ballistic probes from
floor cells near ravines (they ride the grid's kickers, cliff lips and crests). It returns `solvable`, `deadEnds`
(centre s/d, area, cause `'ravine'` or `'trap'`), the best `path`, every jump (`jumpList`: take-off, landing, the
slowest take-off `speed` and the model's `arrive` speed there) and timings. `validateLevel` runs it for relief levels
and fails "no way from the spawn to the sea". Calibrated against the sim:
- Friction, drag and gravity match an autopilot run along its own path within 1–4 %; the search's best speed at the
  cells a run passes is 0.95–1.06 of the run's (p90, six open levels) — above it where obstacles, absorbed ice, dams
  or the autopilot's steering cost the run speed (the model ignores obstacles).
- Turns: a 45° change of heading keeps 0.95 of the head, but one that continues a turn the same way within two cells
  keeps what the sim keeps for 45° in that time (full lock at speed scrubs to ~0.97 × the arc in m/s). So an S-bend
  across the slope stays cheap and a U-turn at speed costs what it does in the sim: before, the search U-turned at
  full speed out of pockets the sim cannot leave (Power Valley's slag-heap pocket is now reported).
- Jumps land the whole hull (one radius) past the ravine and never take off from or land on wall ridges, islands,
  tors or the valley walls (probes off ridge tops made sealed pockets look escapable). The hull's wall probe (0.7 ×
  radius) keeps a big iceberg's centre off a wall it runs at.
- **Jump margins:** the search uses a jump whenever it arrives fast enough, so a reported dead end is reliable, but a
  jump it uses with a margin (`arrive` / `speed` − 1) under ~10 % is marginal in the sim: Glacier Avalanche's
  right-couloir crevasse (21.1 m/s needed, 22.9 arriving, real runs ~20) fails; Highland Maze's Leap (20.0, 21.0) is
  made by the line. Check marginal jumps with a session test. (`ROUTE_RULES.jumpShare` = 0.9 would drop both.)

**Performance limits** (measured on the sandbox: 2 km × 480 m floor, bounds 800 × 2380 m, cellSize 2.5): terrain
build ≈ 3.5–4.5 µs per grid vertex → 306k vertices in 1.15–1.45 s CPU (relief adds ~0.15 s, features ~0); the same
area at cellSize 2 would be 478k vertices ≈ 1.8–2.2 s, over the 2 s budget. Render geometry 609k triangles in 75
chunks (0.94 s to build), the Rapier terrain trimesh 445k triangles (1.3 s: course mode meshes the whole wide floor),
decor 0.1 s (capped counts), a step 0.26 ms. Rendering (headless Edge on the Intel Iris Xe, ANGLE D3D11,
1280×720, quality Medium, `__iceberg.benchmark(60)`, a synchronous GPU-flushed measure): 19–24 ms per frame looking
down the whole open slope from the spawn (1.09 M triangles drawn incl. the shadow pass), 16–21 ms mid-slope, 9–14 ms
lower down; Power Valley measured 14–19 ms the same way. So a wide level costs about what the heaviest valley level
does, and its first views sit a little under 60 fps on that GPU (cellSize 3 did not change that measurably; a
distant-chunk LOD would be the next step). Rules: cellSize 2.5–3 for open levels, ≤ ~320k vertices, no more than
~150 m of mountains beyond the walls, and few obstacles spread over the slope (each is a physics body).

## 2c. Roads, traffic and the living world

Roads form a **network** (`src/core/terrain/roads.ts`, `src/core/traffic/`): every `road` and `street` is a
centreline; a **junction** is found wherever two centrelines cross, or an end of one comes within the other's
half-width + 1.5 m (a T; two ends meeting make an L). Candidates closer than 6 m merge. A straight `road` runs along
the course; one shorter than it is wide runs across it (the old wide-short-strip idiom is a cross street now).
Track beds (`surface: 'rail'`) take no part.

```ts
features: [
  { type: 'road', s0: 90, s1: 600, d: 40, width: 9 },                                    // main road
  { type: 'street', points: [{ s: 250, d: -72 }, { s: 250, d: 72 }], width: 8 },          // cross street
  { type: 'street', points: [{ s: 250, d: -10 }, { s: 300, d: -30 }, { s: 330, d: -50 }], width: 6 }, // a T
  { type: 'parking', s: 345, d: -52, length: 24, width: 18 },                            // car park
  { type: 'parking', s: 230, d: 46.5, length: 12, width: 4 },                            // bay at the kerb
],
obstacles: [
  { kind: 'car', s: 120, d: 42.25, yaw: 0 },           // drives down-course in the right-hand lane
  { kind: 'bus', s: 340, d: 37.75, yaw: Math.PI },     // drives up-course in the other lane
  { kind: 'car', s: 248, d: -20, yaw: -Math.PI / 2 },  // drives across (toward +d) on the cross street
  { kind: 'car', s: 345, d: -52, yaw: 0 },             // in the car park: parked
  { kind: 'truck', s: 230, d: 45.8, yaw: 0, parked: true }, // in the kerb bay, parked (clear of the lane)
],
```

(Simplified from `src/core/testing/trafficSandbox.ts`, the living-world test level.)
- **Lanes**: two, right-hand traffic, centred `width / 4` (1.2–2.6 m) either side of the centreline. A vehicle
  placed on a road (centre within its half-width + 1 m) **drives** in the nearest lane whose direction agrees with its
  yaw; `parked: true`, or standing on a `parking` area, keeps it still (and a parked vehicle in a lane blocks it:
  park in a bay at the kerb, a small `parking` area beside the road, or in a car park; not half on the verge, see
  the vehicle placement rules below). At most 60 drive per level (the rest stay parked).
- **Driving**: cars 10–14 m/s on asphalt (limit 12.5 × 0.85–1.1; gravel 9), trucks and buses ≤ 10; they follow the
  road over slopes, slow for turns, queue, turn at junctions (straight on 6 : right 3 : left 2), turn round at dead
  ends, and brake for anything in their lane: debris, standing obstacles, the iceberg, river water on the road, a
  broken bridge deck. `street.speed` sets a limit (m/s). A road drops away (broken) only where a deck or dam crest
  carried it (1.2 m in 3 m); carved ground is driven however steep (Alpine Pass's roads fall up to 1.7 m in 3 m),
  except a wall (2.4 m in 3 m: a road end run up the valley side; end roads at the wall's foot). **Closed roads**:
  at a junction a vehicle does not turn into a road with something standing in it (fallen ice, a parked vehicle, a
  house) while another way is open; one that stands 6 s right before something in its lane (the iceberg's river
  across the road, fallen ice) backs round in a half circle onto the other lane, once that is clear, and drives back.
  Two junctions a few metres apart are fine: a lane between them shorter than a vehicle is entered once it is empty.
  `src/core/physics/vehicleFlow.physics.test.ts` checks every level: no two vehicles ever overlap, and none stands
  still longer than 45 s in two minutes.
- **Signals**: a junction of 3+ legs where every road is asphalt may get **traffic lights**: the busiest first (most
  legs, widest roads), none within 70 m of another (the minor junctions next to them stay unsignalised). One
  `trafficLight` stands at the right kerb of each approach, facing the traffic (auto-placed: do not place them
  yourself; a turn may pass a pole's width from one, so the traffic does not stop for a standing light, only for a
  knocked-over one lying in the road), with phases by
  direction (opposite legs together), 12 s green for the widest road, 9 s for the others, 3 s amber, 1.5 s all-red,
  offset per junction. `street.signals: true / false` forces lights on / off at its junctions. Unsignalised
  junctions: one vehicle at a time through crossing paths. A designer-placed `trafficLight` binds to the nearest
  signalised approach within 30 m (else it cycles on its own).
- **Hits**: driving vehicles are kinematic: the iceberg meets them at their driving velocity (the momentum exchange
  counts it) and they become ordinary loose bodies (the usual push / shatter rules); so do vehicles hit by debris,
  flooded by the river, or whose bridge deck gives way. Driving does not count toward knocked-down; it counts from
  where a vehicle is released. Traffic runs during the intro flyover too (it starts from the placements at load).
- **Bridges**: a `roadBridge` carries a street along its deck automatically (2e), so traffic arriving at a rim on
  a road drives across at deck height; a `street` with `carve: false` across a dam crest does the same there.
  Vehicles placed on a deck (or such a street) start on it.
- **Smoke, steam, rotors** (render only): smokestacks smoke, cooling towers steam, house and chalet chimneys and a
  factory-hall vent breathe a wisp, wind-turbine rotors turn; each stops for good when its structure is broken,
  knocked off or toppled.

**Vehicle placement rules** (`validateLevel`, or only these: `validateVehiclePlacements(terrain)`): cars, trucks and
buses on a road / street (not a track bed), a bridge deck or a parking area; rail wagons on a track bed
(`surface: 'rail'`); boats on open water. A car, truck or bus is judged at the pose it really has when the run
starts (`vehiclePoses`): standing ones where they spawn, at the yaw they really get (a placement without `yaw` is
turned along or across the valley by the level seed, so give tight spots a `yaw`), driving ones where the traffic
puts them on their lane. Its whole footprint (the collider box of its structure: car 4.2 × 1.8 m, truck 7.6 × 2.5,
bus 12 × 2.6) stands on the paving (`VEHICLE_RULES.overhang`: up to 0.25 m over the edge), and it does not lean: the
ground falls at most 12 % of its width from one side to the other (`VEHICLE_RULES.maxRoll`: 0.31 m across a bus,
0.22 m across a car; not checked on a bridge deck). Park lengthwise on a steep car park, never across it.

### 2e. Bridges that connect

A bridge carries a road (or a path) **from ground to ground** across something lower: a gorge, a ravine, a stream, a
cutting. The kit works out the deck from the terrain (`src/core/obstacles/structures/deck.ts`, the same plan the
logic check reads through `bridgePlans(terrain)` in `src/core/obstacles/bridges.ts`):

- **Rim to rim** (any span that stays inside the floor — the usual case on open mountainsides): each end of the
  running surface sits on the ground at its end of `span` (a ravine's cut is ignored there: its rim height), and the
  deck runs straight from one to the other, **ramped** when the rims differ. An **abutment** at each end (concrete,
  anchored, unbreakable, buried in the bank; the iceberg rides over it like the ground) carries the road out to where
  it meets the ground and holds the deck end on its seat; the girder starts where the ground falls away below the
  deck, with piers (road bridge, ~20 m bays) or posts (footbridge, ~8 m bays) standing on the real ground in between.
  A short crossing (≤ 24 m road, ≤ 12 m foot) is one girder and needs no pier. Rims more than 15 % (road) / 20 %
  (foot) apart over the span are refused by the logic check: put the bridge across the slope, or where the rims are
  level. So **choose `span` so both ends land on the rims, along the road it carries** (`yaw: Math.PI / 2` runs it
  down the course), **each end at least tan(angle) × half the deck's width past the rim** on the road's centre line
  (angle: how far the rim is off square; a road deck is 10.5 m wide, so 0 m square, 3 m at 30°, 4 m at 37°, 5.25 m at
  45°), plus a metre or two: nearer, one edge of the deck ends out over the gap and `bridge-end` fails it, saying how
  much to add.
- **Skewed** (a road meeting the gap at an angle): where a rim crosses a road deck 5° or more from square, that end is
  skewed — the girder end, the abutment's road (its cap) and its seat run along the rim, a straight line clear of the
  bank on every line across the deck (0.25 m apart), so no corner of the girder is buried in the bank; the abutment's
  block under the road stops at the bank measured on those lines, so on a curved or ragged rim only the cap and the
  seat that carries the deck end stand out over the drop where the straight girder end does (the deck is then a slab
  rather than the sloped-web box girder; piers stay square). The deck and the abutment collide and carry traffic as
  their real trapezoids, not their bounding boxes. Keep the road straight and let the bridge skew, up to 45° (`bridge-skew`
  fails a steeper one: turn it nearer square). A footbridge never skews (it is narrow); a rim more than 30° off
  square fails it. Measure the span on the road's line: a skewed gap is wider along the road than across it
  (Highland Maze's road crosses the Gorge at 37°: 24 m across, 30 m along the road, span 44).
- **Approach cuttings** (road bridges only): the terrain grades the bank under each road bridge
  (`src/core/terrain/bridgeCuts.ts`, run by `createTerrain`). Between the abutments' back faces (its width plus the
  wing walls, one grid cell beyond) it is cut down to the running surface less 4 cm wherever it stands higher, so a
  rounded rim, a cross slope or a knoll by the gap never pokes through the road; behind each back face the approach is
  made up (cut or filled) to the abutment's top less 4 cm and blended back into the ground over 8 m, so no kerb is
  left where the road meets the abutment. Never graded: footbridges, take-offs (`profile: 'mound'` ridges and ramps:
  the jumps the level is balanced on) and anything beyond 5 m (× scale) of grading (a bank that far above the road
  means the bridge is in the wrong place: it shows). Every bridge is planned on the ground as the level made it and
  graded once against that plan, so the deck plan is the same with and without the cuttings (tested on every level).
  Beyond the made-up approach the road is the level's own.
- **Wall to wall** (a span that reaches the floor edge at both ends, `span` omitted = the floor width — the narrow
  valley idiom): the deck is level, 8 m (road) / 4.6 m (foot) above the highest floor ground under it, so the iceberg
  passes under between the piers as before (the floor piers stay where they were), and each end runs on into the
  valley wall to where the wall has risen to the deck, an abutment there.
- **Over nothing** (no ground falls away under the line between the ends): the old build, a deck 8 m up with both
  ends in the air. The logic check fails it (`bridge-crossing`).

**The iceberg crosses road bridges** (`src/core/physics/deckGround.ts`): while it is on a rim-to-rim road bridge's
level (its base within 1 m of the road, its edge within 2 m of the running surface), that bridge's abutments and the
decks still on their seats are stamped into the ground it stands on and the decks are passable, so it rides from the
approach road over the deck and on down the road beyond, as a car does. Its centre has to stay over the deck: off the
side (past the deck's edge, within half a grid cell) it tips into whatever the bridge crosses. Below the deck (in the
gorge or canal under it) the ground is the terrain and the deck a solid body; a wall-to-wall viaduct is passed under,
never ridden; a footbridge (2.2 m) is never ridden. A deck knocked off its seats carries nothing. So a road bridge on a
road down the slope is a way across its gap: test the route over it (`riversideTown.test.ts` has one).

Breaking: knock a pier (or post) out and the decks resting on it fall; the abutments hold their ends (the joints over
piers open wide enough that two decks hinging down never lock into an arch). Vehicles on a deck that gives way are
released. A pier hit along the deck (an iceberg running down a bridge that runs down the course) topples under the
deck it carries and props it: such a deck mostly stays up.

**A road over a bridge**: end a road or street at each end of the running surface (within its half-width + 2 m) and
place the bridge; the traffic network lays a street (`carve: false`, two lanes) along the deck from end to end and
joins it to them, so cars drive across. If the level already authors a street over the deck (`carve: false`) none is
added. Do not run a carved road through the gap under it.

```ts
features: [
  // A ravine across the slope at s 300 (20 m wide), and the glen road down to each rim.
  { type: 'ravine', points: [{ s: 300, d: -80 }, { s: 300, d: 80 }], width: 20, depth: 12 },
  { type: 'street', points: [{ s: 120, d: 30 }, { s: 200, d: 20 }, { s: 284, d: 20 }], width: 8 }, // to the rim
  { type: 'street', points: [{ s: 316, d: 20 }, { s: 420, d: 10 }], width: 8, end: 'turning' },  // on from it
],
obstacles: [
  // Down the course (yaw π/2) from s 284 to 316: both ends 6 m past the ravine's edges, on the rims.
  { kind: 'roadBridge', s: 300, d: 20, yaw: Math.PI / 2, span: 32 },
  { kind: 'car', s: 250, d: 22, yaw: 0 }, // drives down the street, over the bridge and on
],
```

(`src/core/obstacles/bridges.test.ts` and `src/core/physics/bridges.physics.test.ts` build exactly this kind of
crossing.) Check it with `bridgePlans(terrain)`: each plan's `mode` ('rims' / 'walls' / 'floating'), its two `ends`
(course s/d, running-surface `top` and the `ground` under it), `grade`, `depthBelow` and `intrusion`.

## 2d. Streams, dams, reservoirs and floods

A natural river is a `stream` feature: a polyline from its source to its mouth, carved into the terrain and filled
with flowing water. A `dam` placed across a stream holds back a reservoir; break the dam and the lake drains in a
flood down the stream. A big iceberg can leave a stream and take its water along its own path (river capture).
Worked example and tests: `src/core/testing/streamSandbox.ts`, `src/core/session.stream.test.ts`,
`src/core/water/*.test.ts`.

```ts
features: [
  // 14 m between the bank tops, banks 3 m (they hold the base iceberg, not a scale-2.2 one), 1.2 m of water at
  // 4 m/s; meltwater: it rises under the level-start glacier, runs out of a portal in the snout beside the
  // spawn, down the valley and out into the sea.
  { type: 'stream', source: 'glacier', points: [{ s: 2, d: -17 }, { s: 25, d: -16 }, { s: 60, d: 0 },
      { s: 200, d: -8 }, { s: 400, d: 6 }, { s: 600, d: 0 }, { s: 760, d: -6 }, { s: 1000, d: 4 },
      { s: 1185, d: 0 }], width: 14, bank: 3, depth: 1.2, flow: 4 },
  // A side stream from a cave spring at the foot of the left valley wall (its first segment points away
  // from the wall), ending in a still pool: a trap for an iceberg it carries.
  { type: 'stream', source: 'cave', points: [{ s: 290, d: -36 }, { s: 300, d: -26 }, { s: 430, d: -30 }],
      width: 10, bank: 3, end: 'pool' },
],
cliffs: [{ s: 760, drop: 6, d: -6, width: 40 }], // the band steps the stream's bed down: a waterfall
obstacles: [
  // Across the stream in a gorge (halfWidth 16), keyed into both walls: the reservoir floods the gorge.
  { kind: 'dam', s: 600, d: 0, span: 34 },
],
```

**The channel.** The bed follows the valley height under the polyline (without other features), made
non-increasing from the source (water never runs uphill: it cuts through rises; where the ground steps down, e.g.
at a cliff or cliff band, the bed steps down: a waterfall). The channel is `bank` m deep below that profile, flat
across its bed with rock banks (steepest 1.6) up to `width / 2`; where the ground beside it stands above the bank
top the cut continues up at slope 1 (at most 12 m out). With a `source` (every stream needs one, below) it starts at
its full section, hidden under the ice, in the spring pool or in the parent; it closes over max(width, 4 × bank) at a
sea end; a `'pool'` end stops in a round bowl. Polyline (s, d) rules apply (exact on straight
courses; keep the course nearly straight where streams run). Other features (hills, plateaus, roads, ridges) are cut
through; gaps and ravines cut deeper. Placements in the channel (and a spring pool) must be bridges, the dam, boats,
rocks, trees, ice, log piles, stone barriers, fences or guardrails (anything else "would stand in the water").

**Where a river comes from (`source`).** A river cannot pop out of a meadow: every stream says where its water comes
from, and the world logic rule `stream-source` (§6b) checks that it holds (an error otherwise, naming the fix).

- `'glacier'` — meltwater from the level-start glacier (`src/core/glacier/glacier.ts`, every level has one upstream
  of the spawn). Put the first point **under the ice**: upstream of the snout at its d and inside the glacier's
  width (it may lie upstream of s 0, where the glacier reaches back onto the headwall; `getGlacier(terrain)` gives
  `faceS`, `backS`, `halfWidth`, and `glacierSnoutS(g, d)` the snout line, which recedes toward the sides). Where
  the stream first crosses the snout the face opens in an **ice portal**: an arch springing from the bank tops
  (rising 0.55 × the half width, 1.8–4.5 m, over the bank tops), a pale rim of fresh ice, a dark vault 5–12 m into
  the glacier along the stream, and under it the water running out at full depth. Over the arch the ice stands at
  least 1.5 m: where the snout is thinner it rises in a local lobe (at most 2.5 m; the arch is lowered to fit, down
  to 1.8 m). The rule fails a stream whose first point is not under the ice, that leaves through the glacier's side
  (no face there), whose opening comes within the iceberg's socket half-width + 2 m of the centre line, or where the
  snout is too thin even for the lowest arch. `validateFeatures` also wants its bank top an iceberg diameter from
  the spawn point. Measured: Power Valley's snout stands 3.9 m over its river's bank tops at d 30 (arch 3.85 m,
  lobe 1.48 m), Riverside Town's 2.9 m at d −47 (arch 3.88 m, lobe 2.5 m), the sandbox's (a 30 t iceberg: a 2.3 m
  face) 2.1 m at d −16 (arch 3.1 m, lobe 2.5 m).
- `'cave'` — a spring: **the first point is the middle of a round spring pool** (radius clamp(0.9 × width, 6, 20) m,
  its floor 1 m below the channel bed at its outlet, cutting back into higher ground behind it at slope 2.5) of still
  water, and the stream flows out of it over its sill. At the back of the pool, against the first segment's
  direction, a **cave mouth** stands in the rock: a low-poly block of rock with an arched opening facing down the
  stream (half width 0.4 × the stream's width, 2.5–6 m), a dark recess and a near-black back wall, running back
  up the ground behind until the slope buries it (a spur of the face with the cave in its end;
  `src/core/water/cave.ts`, in the theme's rock colours). So put the spring **at the foot of a rock face** — the
  valley wall, a wall ridge, a cliff or cliff band, a rock step — with the first segment pointing away from the
  rock. The rule measures the ground up to 15 m behind the mouth (along its axis and either side of it): it must rise
  ≥ 6 m above the spring's ground, somewhere by ≥ 1 per metre over 4 m (a rock face). Measured on all nine levels
  (a 12 m stream pointing away from the rock): valley-wall feet rise 15.6–40.6 m within 15 m (steepest 1.27–3.57),
  cliff-band and rock-step feet 8.9–35.4 m (1.66–7.60); the open floor on the centre line 1.0–3.8 m (0.07–0.98)
  and the old stream heads in open ground 2.1–6.2 m (0.11–0.36) fail. A long even slope can rise 6 m without a
  face (Highland Maze s 600: 11.4 m, steepest 0.13: fails). The pool is still water at the stream's level at its
  sill (an iceberg floats there and drifts toward the outlet at 1 m/s, like on a reservoir;
  `session.stream.test.ts`). A dam's reservoir may drown a spring (Summit Labyrinth: 7.3 m over the pool); the
  cave shows when the lake drains.
- `'branch'` — a mill race or distributary leaving another stream: the first point lies **in another stream's
  channel** (between its bank tops), and that stream's design water surface there stands at or above this stream's
  bed (its profile − bank; with the same ground that means `bank ≥ parent bank − parent depth`). The branch's
  ribbon starts where it leaves the parent's water (no double water surface); its channel cuts through the
  parent's bank. Its own discharge enters at its first cell (the parent's is not reduced).

In the game: Power Valley's and Riverside Town's rivers are the glacier's meltwater (portals at s 19, d 30 and
s 16, d −47); Alpine Pass's Lochbach (the left valley wall, s 700), Glacier Avalanche's river (the pocket wall,
s 500), Riverside Town's east brook (the east funnel wall, s 1104) and Summit Labyrinth's stream (the rock step,
s 821, under the dam's lake) rise at cave springs. No level uses a branch yet (the unit tests in
`src/core/terrain/logic.test.ts` cover it).

**The water.** A stream carries `q = (width − bank run) × depth × flow` m³/s (default depth min(1.2, 0.45 × bank),
flow 4 m/s, both on a 0.05 bed). Steeper bed: faster and shallower (speed × sqrt(slope / 0.05), 0.6–2.2×: pools and
rapids, the rapids foamy); a bed steeper than 0.8 is a waterfall (foam in the plunge pool, 6 m). It is drawn with the
meltwater river's material; the iceberg's own meltwater trail is drawn on top of it (a wake) and runs into it where
they meet. Loose bodies in it are dragged and floated like in the meltwater river (flowing water wakes sleeping
debris: keep loose rocks out of streams unless they should be swept down).

**An iceberg in a stream.** Water at least the draft deep (0.75 m × radius / 2.2: 0.75 m for the base iceberg,
1.65 m at scale 2.2) floats it: its base rides the surface (drawn with the ocean's draft and bob), the current carries
it (its speed relative to the water decays at 0.6/s, 0.08/s on still water), steering pushes it across at 2.5 m/s²,
and it does **not melt** while afloat (the water carries it; it lays no river). Shallower water drags it along
(0.8/s × depth / draft). Over a waterfall's lip it flies, afloat or riding, and lands in the pool below (a waterfall
crossing when the fall is a cliff or cliff band). Measured on the sandbox: the base iceberg falls into the stream from the spawn (across
the meltwater's diagonal run from the glacier, touching the far bank once) and is afloat within 10 s, carried at 4.4–4.9
m/s, over the 6 m waterfall, to the sea in 248 s (1144 m).

**Confinement** (`src/core/sim/inlandWater.ts`). The banks hold the iceberg in the channel iff
`bank ≥ 0.75 × icebergHeight` (icebergHeight = 1.27 × radius: the collision height, 2.8 m for the base iceberg) and
it fits (2 × radius ≤ width):

| iceberg | radius | held by banks ≥ |
| --- | --- | --- |
| base (scale 1) | 2.2 m | 2.1 m |
| scale 1.5 | 3.3 m | 3.15 m |
| scale 2 | 4.4 m | 4.2 m |
| sandbox big (scale 2.2) | 4.84 m | 4.62 m |

Melting shrinks the iceberg (held more easily), absorbing ice grows it (it can break out). A held iceberg stays
within 0.75 × width / 2 − radius / 2 of the centre line (the banks are smooth walls; full steer into one for 6 s:
it slides along it, never out). It leaves only along the channel (the mouth, a pool end), where a reservoir or a flood
drowns the banks, or by flying: a fast iceberg can jump a narrow stream from the land before it falls in. Speed
does not free it. An iceberg the banks do not hold rides over the bed, the banks and the outer cut as if they were
flat (no climb, no wall); left alone it follows the stream (its sideways motion decays at 1.5/s), steered it crabs out
(turning at 0.35 × its rate, pushed across at 4 m/s²): the sandbox's big iceberg is out in 2.15 s at full steer and
keeps 7.7 m/s.

**Stuck, traps and soft locks.** Afloat, the stuck timer runs only while slower than 0.6 m/s (at a third of its
rate: 9 s with stuckTime 3): drifting on a lake is never stuck, being pinned against a dam it cannot break or resting
in a closed pool is. Measured: the base iceberg drifts across the sandbox reservoir (never under 0.6 m/s), reaches the
dam after 20 s and fails stuck at 31.7 s; carried into the pool stream it fails stuck at 51.6 s. A held iceberg can
therefore only end in the sea, in a pool or against a dam: `validateLevel` fails a stream that does not run into the
sea or another stream unless it ends in a `'pool'` (a designed trap).

**Dams hold reservoirs.** A `dam` must span a stream's channel bank to bank: its axis crosses the stream at ≥ 30°
with at least `width / 2 / sin(angle)` m of span each side of the crossing (`validateLevel` reports any dam that does
not; `damProblems(terrain, placement)` / `validateDams(terrain)` in `src/core/water/validate.ts`). Its crest stands
9 × scale m above the lowest ground along its axis; the full lake stands at
`min(crest − 0.8, abutment − 0.2)`, abutment = the highest ground within 4 m beyond each end of the dam (the lower end
decides): key the dam into rising ground at both ends or it only holds what its ends do (a dam on an open floor keeps
the channel brimful, no more). The terrain decides the shoreline: the lake fills every grid vertex below the level
connected to the stream above the dam, on the upstream side of its line (at most 900 m away). The sandbox lake:
level 63.5 m (crest 64.3), 2232 vertices, 22,600 m³. Floating things drift toward the dam at 2 m/s. Below an intact dam
the stream runs at the spillway trickle (12 % of its water). Several dams on one stream each hold their own lake.

**Dam breaks and floods.** Dams break by the momentum rule (§4). A monolith whose foot is under the lake breaches it
(each adds 10 × scale m of breach); one on dry ground does not. The lake level then falls as H0 / (1 + t/5)² above
the breach floor (75 % of the head gone after 5 s, 89 % after 10 s) and the flood carries what the lake loses, at most
1.7 × breach width × head^1.5 m³/s (the weir law) and 1500 m³/s, down the stream (a kinematic wave over 2 m cells,
wider and over the banks when it rises above them: up to 24 m each side), pulling floating things toward the breach
(+4 m/s at the peak). Sandbox numbers: one monolith: 388 m³/s, +1.0 m 50 m below after 6.4 s; the big iceberg
(900 t, scale 2.2) breaks three from the lake at ~4 m/s: 30 m breach, +2.7 m 50 m below (over the 3 m banks), 6 of the
dam's 22 blocks carried more than 8 m downstream, a parked car swept 4 m, and the iceberg rides the flood through the
breach. Afterwards the stream flows through the breach at its full discharge.

**Vehicles and the water.** The physics world's water forces read all water through one `flowAt`: the session hands
it the meltwater trail combined with the inland water (`WaterSystem.flowAdapter`). So the living world's own checks
see streams, reservoirs, floods and captured rivers like the meltwater river: a driving vehicle the water reaches is
released as a loose body ("flooded", 2c), and traffic brakes for water on the road (a stream crossed at grade, a
flooded street; bridges carry it over). Measured: a car driving on a street on the gorge floor below the sandbox dam
is released 4.1 s after the breach. Parked and loose vehicles are moved by the water forces. Standing (anchored)
`car`, `truck`, `bus`, `boat` or `railWagon` bodies in flood water ≥ 0.5 m deep flowing ≥ 2.5 m/s (where the water
stands ≥ 0.4 m above its free level, or in a captured river) are released through `applyContact` with an unbounded
test impulse (the break path), then carried.

**River capture.** An iceberg the banks do not hold that was in a stream's water and leaves its channel (riding or
hopping over a bank) captures the stream once it is 6 m + its radius from where it left without coming back: 1 s
later the stream starts pouring into its meltwater path, 90 % of its water (and of any flood arriving there) after
4 s more. The old channel below the departure drains to a tenth (its depth to under half); the captured river runs
over the ground along the trail, as far as the iceberg has gone — wider (1.6 × the trail, at least 0.8 × the stream),
faster (1.3 × the stream's speed on the same slope) and foamier than the meltwater — until the path comes back into
the channel (the water rejoins it there), climbs 1.5 m above its lowest point (water runs downhill), reaches the sea
or jumps a ravine. It floods over whatever the iceberg smashed along its path. One capture per stream.

**Performance.** Terrain build: a stream costs like any polyline feature, per grid vertex inside its bounding box
(in s, d, grown by width / 2 + 12 m) and per polyline segment, plus sampling its profile once (the sandbox, 81k
vertices, its two streams covering most of the floor: 297 ms without them, 406 ms with). Water per session:
20–40 ms to build (reaches, the reservoir's flood fill); a step of the whole water 0.2–0.35 ms (2 streams, 630 cells,
a draining reservoir); a water query 4–8 µs (the iceberg makes a few per substep, the physics one per loose body). Rendering: one mesh per stream (5 vertices per 2 m), one per
reservoir (its footprint's cells), one per captured river; rebuilt only when the water changes (floods, draining,
captures). Sandbox on the Intel Iris Xe (headless Chrome, ANGLE D3D11, 1280×720, quality auto → high,
`benchmark(60)`, two runs): 11.9–16.5 ms per frame at the spawn, 10.4–17.9 on the reservoir, 11.3–15.4 during the
flood, 10.5–14.0 on the captured river (80 draw calls, 404k triangles). Limits: streams ≤ a
few km (one cell per 2 m), the reservoir footprint ≤ 900 m from its dam (250k vertices), one captured river per
stream (≤ 8 km), floods ≤ 24 m beyond the banks. The route search (`analyzeRoutes`) treats stream banks as terrain
(it does not know confinement): check designed river traps in a session test.

## 3. Themes (`theme`)

Colours, decor and backdrop only (never heights); sky/lighting follow automatically.
`meadow` (default, the tutorial look) · `canyon` (red/orange strata, dry grass, mesas, few trees) · `alpine` (snow
above max(sea + 60, start floor + 18), tree line, grey rock, conifers) · `town` (mown stripes, asphalt) ·
`industrial` (greyer, dirt, scrub).

**Snow on the floor (`snow`).** The alpine line sits 18 m above the start floor, so a glacier or summit level's
playable floor renders green under snowy mountains. `snow: { line?, floor? }` brings the snow down onto the floor:

```ts
theme: 'alpine',
snow: { line: 200 },                    // white down to y 200 (Summit Labyrinth: summit and plateau, s < ~860)
snow: { line: 130, floor: 'patchy' },   // snow fields with grass between, closing up ~80 m higher
snow: {},                               // the whole land, down to the beach
```

- `line` (world y, default: sea level) only lowers the theme's line; its edge is as ragged as the theme's (raised by
  up to 14 m in places). `floor: 'patchy'` lays snow fields with grass between below the theme's own line.
- What stays: roads, kicker earth, the beach and seabed, painted rock (tors, wall ridges, islands, ravine walls,
  stream banks), faces steeper than the theme's snow slope (alpine 1.1). Mound ridges and the floor turn white;
  the calving glacier and its snowfield keep their own colours.
- Decor: scenery forests stay (snowy conifers up to the theme's tree line); no bushes or grass tufts on the snow.
- **Looks only**: heights, surfaces and friction are unchanged — the iceberg slides on snow exactly as on grass
  (no level can change friction). Levels without `snow` look exactly as before (face for face). It works on any
  theme (a theme without snow uses alpine's slope and ragged edge).

## 4. Obstacles (`obstacles`)

`{kind, s, d, yaw?, scale?, count?, spread?, span?}`. `yaw` is **relative to the course direction** (0 = the kind's
default: spanning kinds run across the valley, vehicles/buildings face down-course). `scale` multiplies size
(mass × s³, strength × s²). Spanning kinds (`fence`, `guardrail`, `footbridge`, `roadBridge`, `dam`) take `span`
(default: floor width; may reach 1.5 m into the walls).

**Randomness is seeded per placement index** (`placementRng(seed, index)` in `src/core/obstacles/spawn.ts`): editing
one placement never reshuffles the others, but inserting or reordering a placement shifts the index of every later
one and re-rolls its randomness (ice-field masses and layout, rock clusters, tree variants…), which changes the
balance. Append new placements at the end of `obstacles`, or re-check the balance tests after reordering. (Do not
change the seeding itself: it would re-balance every level.)

**Breaking.** A standing (anchored) obstacle breaks when the iceberg's momentum test `1.25 · closing speed · M`
reaches its break impulse (M = current iceberg mass: 30 t normal, it shrinks as it melts and grows as it absorbs
glacier ice). Break speeds at 30 t: pine 7 m/s, broadleaf 9, house 15, fence 2.5, footbridge post 5.5, chalet ~12,
church ~22, dam ~40 (≈ 12 m/s at 100 t). Crashes chip ice off the iceberg (a fraction of its current ice, larger for
stronger obstacles relative to its mass); the chunks break off its flanks, never in front of it.

**Rubble.** Breaking an obstacle costs the loose-body impulse for its whole mass; its pieces are then *bulldozed*, not
hit afresh: a loose body exchanges momentum once, and touching it again within a second is pushing it. Rubble at most
half the iceberg's mass (or low against its height: ridden over) costs only the friction of dragging it and is shoved
aside, so a heavy iceberg ploughs through houses, power plants and dam breaches. Rubble about as heavy as the iceberg
still stops it when it is jammed — traps for light icebergs. Rubble pushed against a standing building passes the
iceberg's momentum test on to it. Long or wide bodies (dam monoliths, naves, halls, wagons, fallen chimneys) collide as
their footprint rectangles, not as circles; a long loose body hit near one end spins away and takes less of the hit.
Standing bodies met at once (the seam between two dam monoliths, or a monolith narrower than the iceberg and its
neighbours) are each tested with the iceberg's full momentum and together cost about what one of them would.

**Kinds.** Built-ins: `rockSmall`, `rockMedium`, `boulder`, `rockCluster`, `stoneBarrier`, `pine`, `broadleaf`,
`house`, `iceBlock` / `iceField` (glacier ice the iceberg **absorbs** to grow; momentum is conserved, so absorbing
slows it). Structures (data-driven, `src/core/obstacles/structures/<kind>.ts`): `car`, `truck`, `bus`, `fence`,
`guardrail`, `footbridge`, `roadBridge`, `railWagon`, `boat`, `dam`, `church`, `waterTower`, `lighthouse`,
`coolingTower`, `smokestack`, `tank`, `factoryHall`, `pylon`, `windTurbine`, `chalet`, `skiLiftPylon`, `barn`,
`silo`, `logPile`, `trafficLight` (auto-placed at signalised junctions, see 2c). Vehicles (`car`, `truck`, `bus`)
on roads drive unless `parked: true` (2c). `variant: 'ruined'` builds a `house`, `chalet` or `barn` as an
abandoned, flood-wrecked shell (`src/core/obstacles/structures/ruin.ts`: part of the roof and one wall gone, the
remaining roof sagging, a dark flood line, broken and boarded windows, rubble, no smoke); its colliders are the
parts that remain, and it is lighter and weaker than the intact building. Other kinds reject it (placement
validation). Add a structure by creating its file with a default-exported `StructureDef` (authoring guide at the
top of `src/core/obstacles/structures/index.ts`; render-only part fields: `lamp`, `spin`, `plume`; a kind that
offers a look lists it in `variants` and reads `ctx.variant`).

## 5. Iceberg, water and the intended line

- `iceberg: { scale, mass }` — default `{1, 30}`. Bigger icebergs smash heavier structures and need wider channels.
- `water: { metres, turnMetresPerRadian }` — the meltwater budget (tutorial: 850 / 10; smooth lines finish with
  ~40 % ice). Absorbed glacier ice adds water.
- `line: {s, d}[]` — an intended good line (increasing s, on the floor, off islands and wall ridges, crossing a gap
  only over one of its ramps, or a ravine (or rampless gap) only where a jump along the line clears it at 90 % of
  the speed the line carries there by the energy model — `lineHeads()`). The autopilot follows it; level tests use
  it. In a valley level the autopilot (`src/core/autopilot.ts`, `pursuit: 'course'`) aims at the line **18 + 0.9·v m
  of course arc length ahead** (≈ 40 m at 24 m/s), so it cuts bends and starts lateral moves ~40 m early: line
  points near hazards need exaggerated offsets, placed well before the hazard. On open-mountain levels (`relief`
  set) it defaults to `pursuit: 'path'`: it pursues the line as a world-space path, measures the look-ahead along the
  line itself and shortens it until the chord to the aim point cuts no corner of the line by more than
  `cornerTolerance` (3 m), so winding lines with big lateral offsets and turns round diagonal ridges are followed
  closely (still give it a straight run-up of ~1 s before a kicker). It reads `terrain.level.line` from the terrain
  cached per level id (`getTerrain`), so an alternative line on a copy of the level with the same id is ignored —
  steer alternatives in tests with `lane` offsets (or pass a terrain whose `level.line` is replaced).

## 6. Checks every level must pass

- `validateLevel(createTerrain(level))` returns `[]` (features, obstacle placements incl. the vehicle rules of 2c,
  cliffs and cliff bands, line; for relief levels also the routes: a way to the sea, and no bend tighter than the
  floor is wide; the world logic errors of 6b). Every `dam` must span a stream's channel bank to bank (§2d), and
  every stream must have a source (§2d) and end in the sea, another stream or a pool. A street may pass a cliff band's end: only the
  stretch of it that actually crosses the sheer part of a band is refused.
- `validateWorldLogic(terrain)` lists no warnings you have not looked at (6b).
- Levels with streams: a session test for every designed river trap (a pool, a dam the level's iceberg cannot
  break) showing the run ends (stuck), and for the intended dam break / capture if there is one.
- Open-mountain levels: read `analyzeRoutes(terrain).deadEnds` and check each designed dead end really ends the run
  in a session test (stuck or fell), and that no unintended dead end swallows a sensible route. Read the margins of
  the jumps your routes need in `jumpList` (`arrive` vs `speed`): under ~10 % needs a session test.
- Read `levelWarnings(terrain)` (design smells, not failures): ramps on a cliff band's spread slope (they take off
  flatter), ramp faces reaching into a ravine (kept up to the lip), ramps without an exact take-off over part of
  their width.
- Terrain builds in < 2 s; obstacle bodies and step cost stay bounded.
- An autopilot following `line` completes with the real water budget and chipping on; report time, ice left,
  knocked down, buildings destroyed, peak mass. On harder levels, a naive centreline / no-input run should struggle.

## 6b. World logic (`validateWorldLogic`)

Does the world make sense? `src/core/terrain/logic.ts`, tolerances in `LOGIC_RULES`. `validateLevel` includes the
**errors** (area `'logic'`; the message names the rule, `obstacle N` or `feature N`, and a fix); call
`validateWorldLogic(terrain)` for the **warnings** too. The rules:

| rule | severity | what it asks |
| --- | --- | --- |
| `bridge-crossing` | error | a bridge crosses something: some ground falls away under the line between its ends (else it is built 8 m up with both ends in the air) |
| `bridge-end` | error | each end of the running surface meets the ground within 0.75 m — not hanging over a ravine's cut or past a rim, not buried, not in the sea or a stream channel; neither edge of the deck ends more than 0.1 m out over the gap (an oblique rim met too close to the end: lengthen the span by tan(angle) × half the width); a wall-to-wall bridge's wall rises to the deck within 40 m |
| `bridge-grade` | error | its ends differ by at most 15 % of the span (road bridge), 20 % (footbridge) |
| `bridge-ground` | error | the ground nowhere rises more than 0.3 m into the deck's underside between its ends |
| `bridge-skew` | error | a rim crosses a road bridge at most 45° from square (its ends skew along it), a footbridge at most 30° (its ends stay square) |
| `bridge-road` | error | a road bridge has a road or street ending within its half-width + 2 m of each end (a footbridge's path may end on the bank); warning: a street over the deck that is carved (give it `carve: false`) |
| `road-end` | error | each end of a road or street is somewhere: a junction (or ≤ 15 m past the last one: a drive), a parking area (≤ 4 m), a building or yard (house, chalet, barn, church, works, tank, silo, dam, log pile…: ≤ its footprint + 25 m), a bridge end, the valley wall (≤ 3 m from the floor edge), a wall ridge or island (a cul-de-sac against the rock, ≤ 6 m), a cliff's lip or foot (≤ 20 m: the game cannot carve a road down a cliff), the coast (≤ 70 m before `coastS`, or the sea ≤ 30 m) or a level edge (≤ 10 m from `startS`, the course end or the map bounds). Otherwise mark it: `start` / `end: 'turning'` (a turning circle) or `'trailhead'` (a footpath goes on) |
| `rail-short` | error | a track bed is at least 30 m long |
| `rail-end` | error | each end of a track bed runs into the valley wall, a tunnel portal (a wall ridge or island ≤ 8 m), another track bed, the coast, a level edge or a goods shed (as `road-end`), or is marked `start` / `end: 'buffer'` (a buffer stop) |
| `rail-wagon` | error | a wagon stands wholly on its track bed (its 14.4 m length, 1 m slack) and along it (≤ 15°; a wagon's length is its local +z, so `yaw` 0 lies along the course and π/2 across it) |
| `lighthouse-coast` | error | a lighthouse stands within 150 m of the sea or of `coastS` |
| `lift-line` | error / warning | a ski-lift pylon has another within 150 m (a lone pylon: error); a lift's pylons stand within 6 m of the line through its end pylons and their ropes (local +z) run within 20° of it (warnings) |
| `lift-slope` | warning | a lift climbs at least 5 % between its end pylons |
| `open-ground` | error | pylons and wind turbines stand off roads, track beds and parking areas |
| `building-road` | error | houses, chalets, barns and churches stand within 60 m of a road, street or parking area |
| `fence-road` | error | fences and guardrails do not cross a road, street, track bed or bridge deck (sampled every metre along the span, 0.5 m inside the paved strip) |
| `stream-source` | error | every stream has a `source` that holds (§2d): `'glacier'` — its first point under the level-start glacier, leaving through the snout (not the side) with its ice portal ≥ the iceberg's socket half-width + 2 m from the centre line and a snout thick enough to arch over it; `'cave'` — within 15 m behind the cave mouth the ground rises ≥ 6 m above the spring's ground and somewhere by ≥ 1 per metre over 4 m (a rock face, not a meadow); `'branch'` — its first point in another stream's channel whose water there stands at or above its bed (0.05 m slack). No source: it "rises out of open ground" |

Vehicles on roads, wagons on track beds and boats on water are the vehicle placement rules of 2c; dams across
streams are §2d.
