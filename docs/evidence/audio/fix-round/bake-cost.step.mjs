// Per-sound bake cost (main-thread ms to run each recipe to completion), per level set, in Chrome.
export default async ({ evaluate, wait, log }) => {
  await wait(3000);
  const r = await evaluate(`(async () => {
    const [{ bakeSteps, bakeable }, ls, c] = await Promise.all([import('/src/audio/synth/recipes/index.ts'), import('/src/audio/game/levelSet.ts'), import('/src/audio/contract.ts')]);
    const run = (gen) => { const t0 = performance.now(); let r = gen.next(); let steps = 1; let maxStep = 0; let tl = performance.now(); while (!r.done) { r = gen.next(); steps++; const t = performance.now(); maxStep = Math.max(maxStep, t - tl); tl = t; } return { ms: performance.now() - t0, steps, maxStep }; };
    const cost = {};
    for (const id of c.SOUND_IDS) {
      if (!bakeable(id)) continue;
      const def = c.SOUND_DEFS[id];
      let ms = 0, steps = 0, maxStep = 0;
      for (let v = 0; v < def.variants; v++) { const x = run(bakeSteps(id, v, 42)); ms += x.ms; steps += x.steps; maxStep = Math.max(maxStep, x.maxStep); }
      cost[id] = { ms: +ms.toFixed(1), steps, maxStep: +maxStep.toFixed(1), variants: def.variants, set: def.set, priority: def.priority, family: def.family, seconds: def.seconds };
    }
    const sets = {};
    for (const level of ['riverside-town', 'power-valley', 'mountain-valley', 'highland-maze']) {
      const s = ls.levelSoundSet(level, null);
      const lvl = [...new Set(s.sounds)].filter((id) => cost[id] && cost[id].set !== 'core');
      sets[level] = { n: lvl.length, ms: +lvl.reduce((a, id) => a + cost[id].ms, 0).toFixed(0), list: lvl.map((id) => id + ' ' + cost[id].ms + 'ms p' + cost[id].priority).join(', ') };
    }
    const core = Object.entries(cost).filter(([, x]) => x.set === 'core');
    return { core: { n: core.length, ms: +core.reduce((a, [, x]) => a + x.ms, 0).toFixed(0) }, sets, cost };
  })()`);
  log(JSON.stringify(r.core));
  for (const [k, v] of Object.entries(r.sets)) log(k, JSON.stringify(v));
  log(JSON.stringify(Object.entries(r.cost).sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => `${k} ${v.ms}ms ${v.variants}v max ${v.maxStep} p${v.priority} ${v.set}`)));
};
