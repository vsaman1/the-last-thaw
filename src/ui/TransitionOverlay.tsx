/**
 * Polygon wipe shown while appStore.transitioning is true. One CSS animation lasting TRANSITION_MS
 * sweeps the shapes in (screen fully covered from ~42% to ~58%, when the store swaps screens)
 * and back out. Reduced motion: a plain cross-fade with the same timing.
 */
import type { CSSProperties } from 'react';
import { TRANSITION_MS, useAppStore } from '../state/appStore';
import { IcebergMark } from './icons';

export function TransitionOverlay() {
  const transitioning = useAppStore((s) => s.transitioning);
  if (!transitioning) return null;
  const style = { '--tx-ms': `${TRANSITION_MS}ms` } as CSSProperties;
  return (
    <div className="tx" style={style} aria-hidden="true" data-testid="transition">
      <div className="tx__shape tx__shape--a" />
      <div className="tx__shape tx__shape--b" />
      <div className="tx__shape tx__shape--c" />
      <div className="tx__shape tx__shape--cover">
        <IcebergMark size={72} className="tx__mark" />
      </div>
    </div>
  );
}
