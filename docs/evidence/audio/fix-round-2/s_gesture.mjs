// The first click's main-thread task: the long task at the click, the AudioContext constructor's own
// time, and a CPU profile of the click (inclusive time of the functions that matter).
export default async (b) => {
  await b.load('http://localhost:5199/');
  // Let the menu settle and its idle time pass (a player reads the menu for a few seconds).
  await b.wait(Number(process.env.MENU_MS ?? 6000));
  b.log("warm at the click:", await b.evaluate("JSON.stringify(window.__icebergAudio.bake().warm)"));
  await b.send("Profiler.enable");
  await b.send('Profiler.setSamplingInterval', { interval: 100 });
  await b.send('Profiler.start');
  const t0 = await b.evaluate('performance.now()');
  await b.click(640, 700);
  await b.wait(2500);
  const prof = (await b.send('Profiler.stop')).result.profile;
  const page = await b.evaluate(`JSON.stringify({ ctor: window.__audioProbe.ctorMs, long: window.__audioProbe.longtasks, status: window.__icebergAudio?.state().status, rate: window.__icebergAudio?.state().sampleRate })`);
  const P = JSON.parse(page);
  const clickLong = P.long.filter((e) => e.start >= t0 - 5 && e.start <= t0 + 400);
  // Inclusive time per function name.
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const incl = new Map();
  const want = /^(noiseBankData|createNoiseBank|generateSpaceIR|channel|noiseLoop|controlWalk|onCreated|unlock|AudioGraph|onRunning|noiseBank|warmStep|attach|ensureBank)$/;
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (prof.timeDeltas[i + 1] ?? 0) / 1000;
    const seen = new Set();
    for (let id = prof.samples[i]; id !== undefined; id = parent.get(id)) {
      const fn = byId.get(id).callFrame.functionName || '(anon)';
      if (seen.has(fn)) continue;
      seen.add(fn);
      if (want.test(fn)) incl.set(fn, (incl.get(fn) ?? 0) + dt);
    }
  }
  const warm = await b.evaluate("JSON.stringify(window.__icebergAudio.bake().warm)");
  b.log("warm before the click:", warm);
  b.log(JSON.stringify({ status: P.status, rate: P.rate, ctorMs: P.ctor.map((c) => +c.ms.toFixed(1)), clickLongTasks: clickLong.map((e) => +e.ms.toFixed(0)), allLongTasksAfterClick: P.long.filter((e) => e.start >= t0 - 5).map((e) => [+(e.start - t0).toFixed(0), +e.ms.toFixed(0)]), inclusiveMs: Object.fromEntries([...incl].map(([k, v]) => [k, +v.toFixed(1)])) }));
};
