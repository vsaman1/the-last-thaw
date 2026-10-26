import { type Ref, useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import {
  type BloomEffect,
  type EffectComposer as EffectComposerImpl,
  ToneMappingMode,
} from 'postprocessing';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  NeutralToneMapping,
  ReinhardToneMapping,
  type ToneMapping as ThreeToneMapping,
} from 'three';

export const EFFECTS = {
  bloomThreshold: 0.75,
  bloomSmoothing: 0.18,
  bloomIntensity: 0.85,
  bloomRadius: 0.72,
  vignetteOffset: 0.32,
  vignetteDarkness: 0.42,
  /**
   * MSAA samples of the composer's input buffer: 4 cost ~6 ms/frame at 1080p on Iris Xe and 2 still
   * kept 'high' under 60 fps at 720p, so anti-aliasing comes from a single SMAA pass instead.
   */
  multisampling: 0,
  luminanceScale: 0.5,
} as const;

/** EffectComposer forces the renderer to NoToneMapping, so re-apply the Canvas's curve as an effect. */
function toneMappingModeFor(t: ThreeToneMapping): ToneMappingMode {
  switch (t) {
    case ACESFilmicToneMapping:
      return ToneMappingMode.ACES_FILMIC;
    case AgXToneMapping:
      return ToneMappingMode.AGX;
    case NeutralToneMapping:
      return ToneMappingMode.NEUTRAL;
    case ReinhardToneMapping:
      return ToneMappingMode.REINHARD;
    case CineonToneMapping:
      return ToneMappingMode.OPTIMIZED_CINEON;
    default:
      return ToneMappingMode.LINEAR;
  }
}

export interface EffectsProps {
  quality: 'high' | 'low';
  /**
   * Receives the composer while post-processing is mounted (null otherwise): the scene is then drawn
   * into its input buffer, the render target the shader warm-up must compile against.
   */
  composerRef?: Ref<EffectComposerImpl>;
}

/**
 * Bloom (only bright HDR pixels: iceberg glow, foam, sparkles), tone mapping and a
 * subtle vignette. Renders nothing on 'low' quality.
 */
export function Effects({ quality, composerRef }: EffectsProps) {
  if (quality === 'low') return null;
  return <HighQualityEffects composerRef={composerRef} />;
}

function HighQualityEffects({ composerRef }: { composerRef?: Ref<EffectComposerImpl> }) {
  const gl = useThree((s) => s.gl);
  // Read once, before the composer's mount effect switches the renderer to NoToneMapping.
  const [mode] = useState(() => toneMappingModeFor(gl.toneMapping));
  const bloomRef = useRef<BloomEffect>(null);
  useEffect(() => {
    // The bright-pixel extraction only feeds a blurred mip chain, so half resolution is invisible
    // but saves ~1-2 ms per frame on integrated GPUs at 1080p (measured in review).
    const bloom = bloomRef.current;
    if (bloom) bloom.luminancePass.resolution.scale = EFFECTS.luminanceScale;
  }, []);
  return (
    <EffectComposer ref={composerRef} multisampling={EFFECTS.multisampling}>
      <Bloom
        ref={bloomRef}
        luminanceThreshold={EFFECTS.bloomThreshold}
        luminanceSmoothing={EFFECTS.bloomSmoothing}
        intensity={EFFECTS.bloomIntensity}
        radius={EFFECTS.bloomRadius}
        mipmapBlur
      />
      <ToneMapping mode={mode} />
      <Vignette eskil={false} offset={EFFECTS.vignetteOffset} darkness={EFFECTS.vignetteDarkness} />
      <SMAA />
    </EffectComposer>
  );
}
