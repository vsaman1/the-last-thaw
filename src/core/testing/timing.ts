/**
 * How long `fn` took in ms: wall time, or this process's CPU time when that is lower. Other test
 * workers and processes competing for the cores stretch wall time but not CPU time, so build-time
 * budgets stay meaningful on a busy machine. (Vitest runs each test file in its own process.)
 */
export function timed<T>(fn: () => T): { result: T; ms: number } {
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const result = fn();
  const wall = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  return { result, ms: Math.min(wall, (cpu.user + cpu.system) / 1000) };
}

/**
 * The fastest of `runs` timings of `make(i)`, after one untimed warm-up run: the first call pays for
 * the JIT, so a level timed first against a reference timed second looked slower than it is (Power
 * Valley's ratio test failed on a busy machine, 2026-10-23). `make` gets the run's index so each call
 * can use its own id and miss any cache.
 */
export function bestOf<T>(make: (i: number) => T, runs = 2): { result: T; ms: number } {
  make(-1);
  let best = timed(() => make(0));
  for (let i = 1; i < runs; i++) {
    const t = timed(() => make(i));
    if (t.ms < best.ms) best = t;
  }
  return best;
}
