/** localStorage helpers that never throw (private mode, quota, corrupted JSON). */

export function loadJson<T>(key: string, fallback: T, validate: (v: unknown) => v is T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — progress simply won't persist
  }
}
