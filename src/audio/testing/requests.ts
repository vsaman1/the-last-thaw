/** Building SoundRequests in tests (package C owns the real request pool). */
import { GLOBAL_LIMITS, SOUND_DEFS, type SoundId, type SoundRequest, type VoiceLayer } from '../contract';

export function layer(sound: SoundId, over: Partial<VoiceLayer> = {}): VoiceLayer {
  return { sound, variant: -1, gainDb: -20, rate: 1, lowpassHz: 16000, delaySec: 0, optional: false, ...over };
}

/** A request from layers; family and priority default to the first layer's SOUND_DEFS entry. */
export function request(layers: readonly VoiceLayer[], over: Partial<Omit<SoundRequest, 'layers' | 'layerCount'>> = {}): SoundRequest {
  const def = SOUND_DEFS[layers[0].sound];
  const padded: VoiceLayer[] = [...layers];
  while (padded.length < GLOBAL_LIMITS.maxLayers) padded.push(layer(layers[0].sound));
  return {
    family: def.family,
    priority: def.priority,
    positional: false,
    x: 0,
    y: 0,
    z: 0,
    key: -1,
    cause: -1,
    startDelaySec: 0,
    ...over,
    layerCount: layers.length,
    layers: padded,
  };
}

export const hit = (gainDb = -20, key = -1, sound: SoundId = 'hit.stone.light'): SoundRequest =>
  request([layer(sound, { gainDb })], { key });
