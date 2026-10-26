// Page-side helpers reaching the engine's internals (dev build). Serialised with toString.
export async function internals() {
  const { audio } = await import('/src/audio/manager.ts');
  const ctx = audio.context();
  const g = audio.graph();
  const now = ctx ? ctx.currentTime : 0;
  const sessions = [...audio.sessions];
  const r = (x) => (typeof x === 'number' ? +x.toFixed(4) : x);
  return {
    ctxState: ctx ? ctx.state : null,
    ctxTime: r(now),
    sessions: sessions.length,
    live: sessions.filter((s) => !s.ended).map((s) => s.token),
    latest: audio.latest ? audio.latest.token : null,
    gate: g ? r(g.gate.valueAt(now)) : null,
    hiddenGate: g ? r(g.hiddenGate.valueAt(now)) : null,
    spaceReturn: g && g.spaceReturnGain ? r(g.spaceReturnGain.valueAt(now)) : null,
    fxActive: audio.fx ? audio.fx.active(now) : null,
    bellsActive: audio.bellPool ? audio.bellPool.active(now) : null,
    motif: audio.motif ? { startsAt: r(audio.motif.startsAt), endsAt: r(audio.motif.endsAt) } : null,
    busTicking: audio.busTicking,
    router: (() => {
      const m = audio.music.state();
      return { cue: m.cue, playing: m.playing, holds: m.holds, ducks: m.ducks, duckDb: r(m.duckDb), volume: r(m.volume), muted: m.muted, hidden: m.hidden };
    })(),
    player: (() => {
      try {
        const p = window.__icebergAudio.player();
        return JSON.parse(JSON.stringify(p));
      } catch (e) {
        return String(e);
      }
    })(),
    bake: (() => {
      const b = audio.bakeReport();
      return { pace: b.pace, loadingScreen: b.loadingScreen, bank: b.bank, time: b.time };
    })(),
  };
}

export async function phaseOf() {
  const { useGameStore } = await import('/src/state/gameStore.ts');
  const { useAppStore } = await import('/src/state/appStore.ts');
  const a = useAppStore.getState();
  return { screen: a.screen, mode: a.mode, level: a.levelId, attempt: a.attempt, store: useGameStore.getState().phase, rt: window.__iceberg ? window.__iceberg.snapshot().phase : null };
}

export async function quit() {
  const { gameController } = await import('/src/game/controller.ts');
  gameController.quitToMenu();
  return true;
}

export function traceSince(seq) {
  return window.__icebergAudio
    .trace(seq)
    .map((e) => ({ seq: e.seq, t: +e.t.toFixed(3), kind: e.kind, token: e.token, sound: e.sound, reason: e.reason, note: e.note }));
}

export function lastSeq() {
  const t = window.__icebergAudio.trace(0);
  return t.length ? t[t.length - 1].seq : 0;
}

export function setHidden(hidden) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
  return document.visibilityState;
}
