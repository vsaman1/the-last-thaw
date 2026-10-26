/**
 * The attempt's sound, mounted inside the attempt-keyed RuntimeContext right after <CameraRig/> (so
 * its frame callback runs after GameLoop has stepped the session and the camera has moved). It renders
 * nothing: it begins one SessionAudio for the session, feeds the bridge (src/audio/game/sessionBridge.ts)
 * every frame with the camera as the listener, and ends it when the attempt ends: Retry, a level
 * change, leaving the game and the error dialog all unmount it, and everything of this attempt stops
 * within 0.15 s. Audio only listens: nothing here writes to the session.
 */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { audioEngine } from '../audio/game/engine';
import { SessionBridge } from '../audio/game/sessionBridge';
import { useAppStore } from '../state/appStore';
import { useGameStore } from '../state/gameStore';
import { useStoryStore } from '../state/storyStore';
import { chapterById } from '../story/chapters';
import { useRuntime } from './RuntimeContext';

export function GameAudio({ attempt }: { attempt: number }) {
  const rt = useRuntime();
  const bridge = useRef<SessionBridge | null>(null);

  useEffect(() => {
    const app = useAppStore.getState();
    const chapter = app.mode === 'story' && app.chapterId ? (chapterById(app.chapterId) ?? null) : null;
    const b = new SessionBridge(rt, {
      engine: audioEngine(),
      mode: app.mode,
      chapter,
      attempt,
      narrative: useStoryStore.getState().progress.settings.narrative,
    });
    bridge.current = b;
    // The store's phase carries the loading overlay and the pause (the frame loop idles while paused).
    b.setPhase(useGameStore.getState().phase);
    const off = useGameStore.subscribe((s, prev) => {
      if (s.phase !== prev.phase) b.setPhase(s.phase);
    });
    return () => {
      off();
      b.end();
      if (bridge.current === b) bridge.current = null;
    };
  }, [rt, attempt]);

  useFrame((state, delta) => {
    bridge.current?.frame(delta, state.camera.matrixWorld.elements);
  });

  return null;
}
