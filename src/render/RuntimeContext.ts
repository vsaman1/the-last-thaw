import { createContext, useContext } from 'react';
import type { GameRuntime } from '../core/runtime';

export const RuntimeContext = createContext<GameRuntime | null>(null);

export function useRuntime(): GameRuntime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error('useRuntime must be used inside <RuntimeContext.Provider>');
  return rt;
}
