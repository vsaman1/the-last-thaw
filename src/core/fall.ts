/**
 * The fatal-ravine rule, shared by the session (fail detection) and the level tools (validator,
 * route search). Fatal ravines are gap / ravine features unless fatal: false.
 *
 * The run ends as 'fell' once the GROUNDED iceberg is on ground that a ravine has lowered by at
 * least FELL_DEPTH m (Terrain.ravineDepthAt: its floor, never its rim or a far edge the iceberg
 * landed on) and FELL_BEAT s have passed, so the plunge and the crash play before the fail camera
 * takes over. Flying over a ravine never counts; only touching down inside it does.
 */
export const FELL_DEPTH = 2;
export const FELL_BEAT = 0.6;
