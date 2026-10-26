import type { LevelDef } from '../types';

/*
 * LEVEL 3 — "ALPINE PASS": an OPEN MOUNTAINSIDE (relief level). Theme alpine, iceberg 1.1 / 40 t (r 2.42 m),
 * cellSize 2.5, a 400 m wide face (halfWidth 192–210) that curves gently left (≈ 18° over 1.3 km; straight
 * along +Z from z 400 to 660 so the ravine kicker's lip lies on a grid row). Start s 30 on the summit,
 * coast s 1300, finish s 1320 (20 m into the lake/sea). All positions are course (s, d); d > 0 = right.
 * From the summit three ways fan out between rock ridges, and nothing says which one reaches the sea:
 *
 *   s      LEFT: ski area                MIDDLE: switchbacks                RIGHT: old pass road
 *     30   ·························· spawn on the summit ·························
 *    100   ═══ pass road over the summit: T-junctions (traffic lights) with the three roads ═══
 *    165   ski road ║  pylons  ridge L ╲   hairpin road ⟲⟳ (4 hairpins)   ╱ ridge R ║ old road  pines
 *    200            ║  Couloir ▼ slot    safe ice: two lone blocks,           ║        ╠═ bridge road
 *    300   ski jump ╱  (dead end:        the terrace field (11 t)             ║ ridge S┐ ║ open slope,
 *    345   car park ║   stuck)           ~~ band M, rock step 10 m ~~         ║ gorge  │ ║ glacier ice
 *    390   ~~ band 1, falls 14 m ~~      glacier TONGUE 74 t · BAIT 49 t      ║ (old   │ ║
 *    410   ✕✕✕ ravine R1, left arm      ══ THE COL (saddle mound) ══         ║ road)  │ ╫ road bridge
 *    500         R1 runs diagonally ✕✕✕ below the col to ridge R  ⟋ kicker   ║        ┘ ╫ over the
 *    590                                        (s 589, d 25) over R1        ║          ║ DEVIL'S CUT ✕
 *    700   spring ◖○ lochan, the Lochbach ↓  open lower slope: tors, pines  ╚═══╦══════╝ (40 m: fell)
 *    760   ~~~~~~~~ band 2, the big falls (18 m, diagonal) ~~~~~~~~~~~~~      ╲  round its right end
 *    860   village shelf · village road     Tobel ▼ (closed gully: stuck)   right valley road
 *   1100   ══ the moraine (mound) ══
 *   1130                                                          lake road, lake car park (below it)
 *   1180   ~~~~~~~~ band 3, the lake falls (14 m, diagonal) ~~~~~~~~~~~~~~
 *   1300   coast · finish s 1320
 *
 * ROUTES (all measured with the real water budget and chipping; the autopilot pursues each as a path):
 *   LINE (middle): pass road → down the hairpins (two lone blocks and the terrace field: 17 t) → fly the
 *     rock step (band M) → between the tongue and the bait → crest the col at ≈ 18 m/s → the kicker over R1
 *     (lip s 589) → the open lower slope → fly the big falls → beside the village road → the moraine → fly
 *     the lake falls. 3 waterfalls.
 *   SKI (left): left of ridge L across the ski slope (pylons), over the ski jump, fly band 1 straight over
 *     the ravine's left arm, then right across the lower slope, over the big falls and through the village
 *     street on its shelf, down the left of the lake falls. 4 waterfalls; the fastest way down.
 *   GORGE (right): down the old pass road, absorbing the glacier ice on the upper right, through the gorge
 *     between ridges R and S, round the right end of the big falls, down the right valley road, fly the
 *     lake falls. Longest on the ground. (The open slope right of ridge S looks just as good: it ends in
 *     the Devil's Cut, beside the road bridge.)
 *   THE BRIDGE ROAD (playtest 2): the road bridge carries the iceberg over the Devil's Cut (it rides the
 *     deck ~12 m over the floor of the cut, src/core/physics/deckGround.ts; it used to stop dead against
 *     the deck end, stuck at s 480-490 from every lane and speed). The bridge road then runs down to the
 *     right valley road, but it is the longest way round on the ground and passes no glacier ice:
 *     followed from the spawn it melts away at s ≈ 930 (55 s); with no steering from the bridge road the
 *     iceberg stalls on the flat by the lake (s ≈ 980). A way across, not a way to the sea.
 * DEAD ENDS (route search `deadEnds`, confirmed in the sim): the Couloir (a slot beside ridge L that ends
 *   in a wall above the ski falls: stuck), the Devil's Cut (the open slope right of ridge S runs into a
 *   40 m ravine: fell), the col's left end (a slow crest there slides into R1: fell), the middle without
 *   the kicker (R1: fell), rounding band 1's right end (R1: fell), the Tobel (closed gully: stuck), the
 *   lochan (slow: stuck). Rock tors (relief outcrops, 3.5 % of the floor) stop careless lines too.
 * THE COL AND THE GLACIER GAMBLE: the saddle mound (10.5 m) sits on a near-flat stretch, so cresting it
 *   takes ≈ 13 m/s at its foot. Graze the tongue's edge (≈ 10 t) and you crest with more water; swallow it
 *   (≈ 70 t) or the bait (≈ 49 t, on the natural path into the col) and you arrive at ≈ 9 m/s: you roll
 *   back and are stuck. Band 1's drop spreads 90 m along s across the whole floor, so it was moved up
 *   (s 390) to keep the col's approach flat.
 * A WORLD THAT MAKES SENSE: vehicles only on streets and car parks (validateVehiclePlacements); a few drive
 *   (cars on the pass road, hairpins and valley roads, a bus and a truck on the village road); the lake road
 *   does not meet the village road, so no traffic crosses the line near the shore. Buildings stand within
 *   60 m of a road (ski station by its car park, a chalet inside a hairpin, the village by its road, a
 *   chalet by the valley road); fences and guardrails run along roads. The road bridge
 *   carries the bridge road over the Devil's Cut: both rims are at the same height, the deck carries the
 *   street (carve: false) and the street continues from both rims to junctions with the old road (s 200
 *   and s 736), so traffic drives over it; the deck height itself comes from the engine (until its bridge
 *   auto-height lands the deck stands 8 m above the rims). The Lochbach, an alpine stream, springs from a
 *   cave in the left valley wall beside the lochan (a spring pool at the wall's foot, s 700, d −189), runs
 *   down the left of the lower face, over the big falls and the lake falls into the lake (banks 2 m:
 *   they do not hold this iceberg, it rides across; nothing stands in its channel). No dam.
 *
 * WATER: 930 m + 10 m/rad. The line lands ≈ 33 % ice at the sea (lanes ±2 m: 30–31 %); the ski route ≈ 19 %
 * (it misses its glacier field), the gorge route ≈ 35 % (30 t of glacier ice along the old road). Waterfalls
 * save water (airborne metres do not melt), so the flown routes are the efficient ones.
 *
 * BALANCE (time / ice / knocked / buildings / absorbed / peak / score; engine 735f313):
 *   line          65.8 s ·  33 % · 4 · 0 · 17.3 t · 45.6 t · 4379 (3 falls)
 *   ski route     61.5 s ·  19 % · 5 · 0 ·  6.1 t · 44.8 t · 4680 (4 falls)
 *   gorge route   79.9 s ·  35 % · 2 · 0 · 30.4 t · 47.6 t · 3731 (2 falls)
 *   graze tongue  83.6 s ·  44 % · 4 · 0 · 27.3 t · 52.1 t · 3986
 *   swallow       stuck at the col (s 446) at 112.7 t; bait: stuck at the col (s 443) at 89.5 t
 *   naive centre (followLine false): swallows the bait, stuck at the col; no input: falls into R1 (s 672)
 * Before this rework the level was one valley corridor (line 64.4 s · 29 % · 13 · 0 · 16 t · 42.9 t).
 */
export const alpinePass: LevelDef = {
  id: 'alpine-pass',
  index: 3,
  name: 'Alpine Pass',
  subtitle: 'An open alpine face: ski runs, hairpins, a glacier and a deadly ravine. Which way is down?',
  seed: 3303,
  bounds: { minX: -380, maxX: 470, minZ: -120, maxZ: 1440 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 173.7, halfWidth: 50 },
    { x: -3, z: 60, floor: 168.3, halfWidth: 150 },
    { x: -8, z: 130, floor: 159.9, halfWidth: 200 },
    { x: -24, z: 300, floor: 139.5, halfWidth: 205 },
    { x: -30, z: 360, floor: 132.3, halfWidth: 200 },
    { x: -33, z: 400, floor: 129.1, halfWidth: 196 },
    // Straight along +Z from z 400 to 660: the ravine kicker's lip lies along a grid row.
    { x: -33, z: 500, floor: 126.1, halfWidth: 198 },
    { x: -33, z: 600, floor: 116.1, halfWidth: 200 },
    { x: -33, z: 660, floor: 110.1, halfWidth: 198 },
    { x: -25, z: 760, floor: 100.1, halfWidth: 192 },
    { x: -5, z: 900, floor: 88.2, halfWidth: 210 },
    { x: 25, z: 1050, floor: 75.4, halfWidth: 200 },
    { x: 55, z: 1180, floor: 64.4, halfWidth: 206 },
    { x: 81, z: 1300, floor: 56, halfWidth: 200 },
    { x: 111, z: 1440, floor: 46.2, halfWidth: 220 },
  ],
  cliffs: [
    // M: the rock step across the middle face (between ridges L and R).
    { s: 360, drop: 10, d: 2, width: 176, skew: 0.12 },
    // 1: the ski-area falls on the left, right above the ravine.
    { s: 390, drop: 14, d: -140, width: 120, skew: -0.15 },
    // 2: the big falls across most of the lower face.
    { s: 760, drop: 18, d: -20, width: 280, skew: 0.15 },
    // 3: the lake falls.
    { s: 1180, drop: 14, d: 0, width: 340, skew: -0.1 },
  ],
  wallHeight: 42,
  wallRamp: 30,
  startS: 30,
  coastS: 1300,
  finishS: 1320,
  theme: 'alpine',
  iceberg: { scale: 1.1, mass: 40 },
  relief: {
    roll: 3,
    rollScale: 160,
    gullies: 2.5,
    gullySpacing: 50,
    outcrops: 6,
    outcropCover: 0.035,
    outcropScale: 28,
    lineClear: 15,
  },
  features: [
    // 0 Ridge L: between the ski area (left) and the middle face.
    {
      type: 'ridge',
      points: [
        { s: 165, d: -25 },
        { s: 200, d: -38 },
        { s: 240, d: -57 },
        { s: 285, d: -66 },
        { s: 330, d: -77 },
        { s: 375, d: -81 },
        { s: 420, d: -87 },
        { s: 448, d: -88 },
      ],
      width: 9,
      height: 11,
    },
    // 1 Ridge R: between the middle face and the gorge; it ends in the ravine.
    {
      type: 'ridge',
      points: [
        { s: 165, d: 25 },
        { s: 210, d: 44 },
        { s: 250, d: 63 },
        { s: 300, d: 74 },
        { s: 340, d: 84 },
        { s: 400, d: 88 },
        { s: 450, d: 93 },
        { s: 520, d: 95 },
        { s: 600, d: 98 },
        { s: 690, d: 99 },
      ],
      width: 9,
      height: 11,
    },
    // 2 Ridge S: the gorge's right wall; right of it the open slope runs into the Devil's Cut.
    {
      type: 'ridge',
      points: [
        { s: 300, d: 140 },
        { s: 350, d: 147 },
        { s: 400, d: 151 },
        { s: 480, d: 154 },
        { s: 550, d: 158 },
        { s: 610, d: 155 },
      ],
      width: 9,
      height: 11,
    },
    // 3 The Couloir: a slot beside ridge L that ends in a wall above the ski falls (dead end).
    {
      type: 'gully',
      points: [
        { s: 230, d: -95 },
        { s: 300, d: -104 },
        { s: 368, d: -110 },
      ],
      width: 16,
      depth: 9,
      closed: true,
    },
    // 4 R1: the ravine. Its left arm lies at the foot of the ski falls, then it runs diagonally
    // below the col to ridge R.
    {
      type: 'ravine',
      points: [
        { s: 414, d: -212 },
        { s: 406, d: -150 },
        { s: 400, d: -100 },
        { s: 598, d: 8 },
        { s: 602, d: 45 },
        { s: 690, d: 98 },
      ],
      width: 14,
      depth: 12,
    },
    // 5 R2: the Devil's Cut, too wide to jump.
    {
      type: 'ravine',
      points: [
        { s: 500, d: 148 },
        { s: 520, d: 215 },
      ],
      width: 40,
      depth: 12,
    },
    // 6 Kicker over R1 on the line.
    { type: 'ramp', s: 589, d: 25, width: 14, length: 14, height: 3.5 },
    // 7 The col: a saddle mound from ridge L's foot to ridge R.
    {
      type: 'ridge',
      points: [
        { s: 470, d: -96 },
        { s: 478, d: 98 },
      ],
      width: 56,
      height: 10.5,
      profile: 'mound',
    },
    // 8 Ski jump.
    { type: 'ramp', s: 300, d: -135, width: 12, length: 14, height: 2.5 },
    // The pass road over the summit (it bows round the spawn). It ends at the foot of the valley walls
    // (the floor is 181 m wide here): out to d ±205 it ran 31–36 m up them, and its traffic with it.
    {
      type: 'street',
      points: [
        { s: 102.9, d: -186 },
        { s: 99, d: -110 },
        { s: 97, d: 0 },
        { s: 99, d: 110 },
        { s: 102.8, d: 183 },
      ],
      width: 8,
      surface: 'asphalt',
    },
    // The ski road down the left side to the ski station.
    {
      type: 'street',
      points: [
        { s: 100, d: -184 },
        { s: 170, d: -182 },
        { s: 250, d: -178 },
        { s: 330, d: -176 },
        { s: 350, d: -172 },
      ],
      width: 7,
      surface: 'asphalt',
    },
    // The switchbacks down the middle face: four hairpins between ridges L and R.
    {
      type: 'street',
      points: [
        { s: 97, d: -4 },
        { s: 130, d: -8 },
        { s: 160, d: -10 },
        { s: 185, d: 0 },
        { s: 205, d: 20 },
        { s: 222, d: 34 },
        { s: 236, d: 38 },
        { s: 248, d: 30 },
        { s: 258, d: 10 },
        { s: 270, d: -18 },
        { s: 284, d: -38 },
        { s: 298, d: -50 },
        { s: 310, d: -52 },
        { s: 320, d: -44 },
        { s: 330, d: -25 },
        { s: 338, d: -5 },
      ],
      width: 7,
      surface: 'asphalt',
      // A viewpoint above the rock step: the road ends in a turning circle.
      end: 'turning',
    },
    // The old pass road down the right side and through the gorge between ridges R and S to the
    // junction above the big falls.
    {
      type: 'street',
      points: [
        { s: 99, d: 108 },
        { s: 150, d: 114 },
        { s: 220, d: 118 },
        { s: 300, d: 119 },
        { s: 450, d: 119 },
        { s: 600, d: 118 },
        { s: 690, d: 126 },
        { s: 735, d: 140 },
      ],
      width: 8,
      surface: 'asphalt',
    },
    // ... and on round the right end of the big falls to the lake (split there: a street keeps clear of
    // a cliff band's sheer part).
    {
      type: 'street',
      points: [
        { s: 737, d: 145 },
        { s: 790, d: 160 },
        { s: 850, d: 178 },
        { s: 950, d: 184 },
        { s: 1050, d: 180 },
        { s: 1110, d: 170 },
      ],
      width: 8,
      surface: 'asphalt',
    },
    // The Devil's Cut bridge road: off the old road at s 200, down the open slope right of ridge S, over
    // the cut on a road bridge (the deck carries the street: carve false) and on down to rejoin the old
    // road where it meets the valley road. Both rims are at the same height; the street meets the deck
    // at both ends (the bridge's deck height comes from the engine).
    {
      type: 'street',
      points: [
        { s: 200, d: 121 },
        { s: 240, d: 150 },
        { s: 300, d: 170 },
        { s: 400, d: 176 },
        { s: 483, d: 180 },
      ],
      width: 8,
      surface: 'asphalt',
    },
    {
      type: 'street',
      points: [
        { s: 483, d: 180 },
        { s: 537, d: 180 },
      ],
      width: 8,
      surface: 'asphalt',
      carve: false,
    },
    {
      type: 'street',
      points: [
        { s: 537, d: 180 },
        { s: 600, d: 182 },
        { s: 680, d: 176 },
        { s: 735, d: 148 },
      ],
      width: 8,
      surface: 'asphalt',
    },
    // The village road from below the big falls to the lake.
    {
      type: 'street',
      points: [
        { s: 790, d: -30 },
        { s: 850, d: -38 },
        { s: 950, d: -40 },
        { s: 1050, d: -34 },
        { s: 1110, d: -20 },
      ],
      width: 7,
      surface: 'asphalt',
      // A turning circle below the big falls; at the lake a footpath goes on along the shore.
      start: 'turning',
      end: 'trailhead',
    },
    // The lake road along the shore from the right-hand valley road, on the flat below the moraine.
    // (It ran along the moraine's lower flank, s 1114-1116, which tilts ≈ 40 % across there: driving
    // it, cars leaned over 26-28°, playtest 2 review. Here it is level across, ≤ 5 %.)
    {
      type: 'street',
      points: [{ s: 1126, d: 40 }, { s: 1127, d: 100 }, { s: 1126, d: 148 }, { s: 1114, d: 172 }],
      width: 7,
      surface: 'asphalt',
      // It ends in a turning circle on the shore, short of the iceberg's line.
      start: 'turning',
    },
    // Car parks: the summit, the ski station, the village, a lay-by in the gorge.
    { type: 'parking', s: 86, d: 30, length: 14, width: 40 },
    { type: 'parking', s: 352, d: -165, length: 36, width: 16 },
    { type: 'parking', s: 925, d: -50, length: 24, width: 10 },
    { type: 'parking', s: 460, d: 109, length: 18, width: 7 },
    // (The lake car park lay across the moraine's crest, s 1088-1112: its bus perched on the hump. It
    // now lies on the flat beside the lake road, lengthwise along it.)
    { type: 'parking', s: 1137, d: 144, length: 24, width: 10, yaw: Math.PI / 2 },
    // The village shelf.
    { type: 'plateau', s0: 855, s1: 985, d: -80, width: 70, height: 3 },
    // The Tobel: a closed gully on the lower right (dead end).
    {
      type: 'gully',
      points: [
        { s: 850, d: 110 },
        { s: 990, d: 150 },
      ],
      width: 16,
      depth: 9,
      closed: true,
    },
    // The lochan below the ravine on the left (a trap if slow).
    { type: 'basin', s: 690, d: -150, radius: 14, depth: 4.5 },
    // The Lochbach: an alpine stream that springs from a cave at the foot of the left valley wall
    // (source 'cave': its spring pool at s 700, d −189; the wall rises 18.6 m within 15 m behind the
    // mouth), past the lochan, down the left of the lower face, over the big falls and the lake falls
    // into the lake (banks 2 m: they do not hold this iceberg; it rides across).
    {
      type: 'stream',
      source: 'cave',
      points: [
        { s: 700, d: -189 },
        { s: 707, d: -174 },
        { s: 735, d: -150 },
        { s: 760, d: -152 },
        { s: 820, d: -160 },
        { s: 900, d: -168 },
        { s: 1000, d: -170 },
        { s: 1100, d: -168 },
        { s: 1170, d: -165 },
        { s: 1220, d: -160 },
        { s: 1300, d: -150 },
        { s: 1360, d: -140 },
      ],
      width: 12,
      bank: 2,
    },
    // The moraine: a mound across the lower face.
    {
      type: 'ridge',
      points: [
        { s: 1095, d: -150 },
        { s: 1105, d: 150 },
      ],
      width: 36,
      height: 5,
      profile: 'mound',
    },
  ],
  obstacles: [
    // The summit car park (bus and cars parked), traffic on the pass road, a guardrail below it.
    { kind: 'bus', s: 86, d: 30, yaw: Math.PI / 2 },
    { kind: 'car', s: 101, d: -150, yaw: -Math.PI / 2 },
    { kind: 'car', s: 101, d: 150, yaw: Math.PI / 2 },
    { kind: 'car', s: 86, d: 44, yaw: Math.PI / 2 },
    { kind: 'guardrail', s: 103.5, d: 20, span: 20 },
    // Launch: a lone glacier block on the way down, rocks and pines.
    { kind: 'iceBlock', s: 62, d: -3, scale: 0.8 },
    { kind: 'rockMedium', s: 75, d: 40 },
    { kind: 'pine', s: 140, d: 90 },
    { kind: 'pine', s: 150, d: -95 },
    // The hairpins: traffic, guardrails at two hairpins, a chalet inside one; the ski car park.
    // (This car and the one after the guardrail below park side by side in bays left of the bus, facing
    // down the car park: seen from the start, 2.2 m of tarmac shows between them and 5.6 m to the bus.)
    { kind: 'car', s: 86, d: 13.5, yaw: 0 },
    { kind: 'car', s: 205, d: 20, yaw: -0.7 },
    // (Ski car park, at its flatter lower end: lengthwise, like the bus and cars there. The car park falls
    // up to 30 % along its length and is level across it: a vehicle parked across it leans right over.)
    { kind: 'truck', s: 366, d: -164, yaw: 0 },
    { kind: 'guardrail', s: 244, d: 44, yaw: Math.PI / 2, span: 20 },
    { kind: 'chalet', s: 232, d: 20 },
    { kind: 'car', s: 290, d: -45, yaw: 0.7 },
    { kind: 'bus', s: 820, d: -34, yaw: 0 },
    { kind: 'car', s: 318, d: -46, yaw: -0.7 },
    { kind: 'guardrail', s: 316, d: -59, span: 10 },
    // (In a bay of the summit car park, not in the bus: at d 24 this car stood 2.1 m inside the bus's
    // rear, the two stuck together where the run starts.)
    { kind: 'car', s: 86, d: 17.5, yaw: 0 },
    { kind: 'iceBlock', s: 250, d: 4, scale: 0.75 },
    // Ski area: lift pylons up the slope, the ski road with the car park and the station.
    { kind: 'skiLiftPylon', s: 190, d: -160 },
    { kind: 'skiLiftPylon', s: 225, d: -160 },
    { kind: 'skiLiftPylon', s: 260, d: -160 },
    { kind: 'skiLiftPylon', s: 330, d: -160 },
    { kind: 'skiLiftPylon', s: 372, d: -158 },
    { kind: 'chalet', s: 365, d: -150 },
    { kind: 'bus', s: 364, d: -170, yaw: 0 },
    { kind: 'car', s: 340, d: -164, yaw: 0 },
    { kind: 'car', s: 366, d: -160, yaw: Math.PI },
    { kind: 'fence', s: 250, d: -183, yaw: Math.PI / 2, span: 40 },
    // Below the rock step: the glacier tongue (70 t) and the bait on the way into the col.
    { kind: 'iceField', s: 405, d: 48, count: 7, spread: 6 },
    { kind: 'iceField', s: 450, d: 5, scale: 0.9, count: 6, spread: 4 },
    // The upper right: larches and log piles on the open slope.
    { kind: 'pine', s: 185, d: 150 },
    { kind: 'pine', s: 260, d: 135 },
    { kind: 'pine', s: 290, d: 102 },
    { kind: 'pine', s: 330, d: 188 },
    { kind: 'pine', s: 420, d: 162 },
    { kind: 'boulder', s: 350, d: 134 },
    // The road bridge over the Devil's Cut (along the course), carrying the bridge road.
    { kind: 'roadBridge', s: 510, d: 180, yaw: Math.PI / 2, span: 54 },
    // Traffic on the right-hand valley road, a guardrail at its bend.
    { kind: 'car', s: 940, d: 183, yaw: 0 },
    { kind: 'truck', s: 704, d: 129, yaw: -0.3 },
    { kind: 'car', s: 760, d: 148, yaw: -0.35 },
    { kind: 'guardrail', s: 800, d: 172, yaw: Math.PI / 2, span: 10 },
    // Lower slope: pines and rocks.
    { kind: 'pine', s: 660, d: -100 },
    { kind: 'pine', s: 680, d: 60 },
    { kind: 'boulder', s: 736, d: -40 },
    { kind: 'pine', s: 735, d: 130 },
    // The village on its shelf beside the village road (cars in its car park, traffic on the road).
    { kind: 'fence', s: 875, d: -45, yaw: Math.PI / 2, span: 30 },
    { kind: 'chalet', s: 890, d: -60 },
    { kind: 'chalet', s: 935, d: -62 },
    { kind: 'church', s: 965, d: -95, scale: 0.6 },
    { kind: 'barn', s: 905, d: -98 },
    { kind: 'silo', s: 885, d: -100 },
    { kind: 'logPile', s: 950, d: -47 },
    { kind: 'car', s: 920, d: -52 },
    { kind: 'car', s: 930, d: -48, yaw: Math.PI },
    { kind: 'truck', s: 1000, d: -37, yaw: 0 },
    // More traffic, a chalet by the valley road, the lake car park, a guardrail by the village road.
    { kind: 'car', s: 800, d: 163, yaw: 0 },
    { kind: 'chalet', s: 870, d: 150 },
    { kind: 'bus', s: 1137, d: 146, yaw: Math.PI / 2 },
    { kind: 'car', s: 1060, d: 178, yaw: Math.PI },
    // (On the valley road, driving toward the lake road: it starts on the valley road, not on the lake
    // road itself, which once tilted ≈ 40 % across on the moraine's flank.)
    { kind: 'car', s: 1095, d: 174.5, yaw: 0.165 },
    { kind: 'guardrail', s: 1030, d: -30, yaw: Math.PI / 2, span: 40 },
    // Lower meadows to the lake.
    { kind: 'iceField', s: 1000, d: 172, scale: 0.55, count: 5, spread: 3.5 },
    { kind: 'pine', s: 1070, d: 90 },
    { kind: 'pine', s: 1120, d: -120 },
    { kind: 'pine', s: 1140, d: 140 },
    { kind: 'boulder', s: 1150, d: -40 },
    // Safe ice on the middle face below road B3 (the glacier terrace field).
    { kind: 'iceField', s: 322, d: 0, scale: 0.55, count: 6, spread: 3.5 },
    // A truck halted on the gorge road beside the lay-by, parked in its lane: glacier ice lies across
    // the road both ways (the remnants at s 300 and the block at s 520), so the traffic does not come
    // this way (a closed road, TrafficEnv.closed) and the truck has nowhere to drive. In the lay-by it
    // could not stand level: the lay-by climbs the gorge wall, rising ≈ 30 % along and falling up to
    // 25 % across (at d 111.25 a truck rested on three wheels). Driving, it met one of the two ice
    // falls within a minute and stood there for the rest of the run.
    { kind: 'truck', s: 454.5, d: 120.5, yaw: 0, parked: true },
    // Glacier remnants on the ski slope and on the upper right, across the old road.
    { kind: 'iceField', s: 345, d: -135, scale: 0.6, count: 6, spread: 3.5 },
    { kind: 'iceField', s: 300, d: 121, scale: 0.8, count: 6, spread: 3.5 },
    // A glacier block fallen onto the gorge road.
    { kind: 'iceBlock', s: 520, d: 119, scale: 0.9 },
  ],
  line: [
    { s: 30, d: 0 },
    { s: 90, d: -4 },
    { s: 160, d: -8 },
    { s: 200, d: -5 },
    { s: 240, d: 3 },
    { s: 282, d: 2 },
    { s: 322, d: 0 },
    { s: 360, d: 5 },
    { s: 400, d: 18 },
    { s: 430, d: 28 },
    { s: 450, d: 29 },
    { s: 475, d: 27 },
    { s: 540, d: 25 },
    { s: 589, d: 25 },
    { s: 650, d: 20 },
    { s: 709, d: 12 },
    { s: 758, d: 0 },
    { s: 800, d: -10 },
    { s: 850, d: -20 },
    { s: 1000, d: -20 },
    { s: 1044, d: -15 },
    { s: 1100, d: -5 },
    { s: 1178, d: 0 },
    { s: 1300, d: 0 },
    { s: 1420, d: 0 },
  ],
  water: { metres: 930, turnMetresPerRadian: 10 },
  decor: { sceneryTreeDensity: 6, bushDensity: 3, grassTuftDensity: 16, pebbleDensity: 6 },
};
