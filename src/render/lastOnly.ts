/**
 * Memoises `build` for the most recent key only (compared by identity). The render caches keyed by a
 * level's Terrain use it: a retry of the same level reuses the built arrays, and loading another
 * level drops the previous level's instead of keeping every visited level alive (the session keeps
 * each level's Terrain in a module-level map, so a WeakMap keyed by Terrain never lets go).
 */
export function lastOnly<K, V>(build: (key: K) => V): (key: K) => V {
  let cached: { key: K; value: V } | null = null;
  return (key) => {
    if (cached === null || cached.key !== key) cached = { key, value: build(key) };
    return cached.value;
  };
}
