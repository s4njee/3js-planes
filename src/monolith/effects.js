import * as THREE from 'three';

import { CHROMATIC_OSCILLATION_SPEED } from './constants.js';
import {
  SHARED_FX_CINEMATIC,
  SHARED_FX_DATABEND,
} from '../shared/special-effects/index.ts';

// ── Effects ────────────────────────────────────────────────────────────────────
// Pure helper functions that build or evaluate the post-processing effect
// snapshot used by SharedEffectStack. No React dependencies.

// ── Bloom translation ──────────────────────────────────────────────────────────
// Monolith's legacy sliders were tuned for UnrealBloomPass. Translate them
// into values that read similarly in @react-three/postprocessing's Bloom.

export function mapMonolithBloomSettings(guiParams) {
  return {
    intensity: Math.max(1.2, guiParams.bloomStrength * 3.5),
    radius: Math.min(1, (guiParams.bloomRadius * 2.8) + 0.12),
    smoothing: THREE.MathUtils.clamp(0.35 + ((1 - guiParams.bloomThreshold) * 0.5), 0, 1),
    threshold: THREE.MathUtils.clamp((guiParams.bloomThreshold - 0.77) * 0.05, 0, 1),
  };
}

// ── Glitch guard ───────────────────────────────────────────────────────────────

export function canTriggerMonolithGlitch(state) {
  return (
    state.currentFx === SHARED_FX_CINEMATIC ||
    state.currentFx === SHARED_FX_DATABEND ||
    state.pixelMosaicEnabled ||
    state.thermalVisionEnabled
  );
}

// ── Snapshot builder ───────────────────────────────────────────────────────────
// Produces the immutable props object that SharedEffectStack consumes. Called
// every time any GUI param or state flag changes.

export function createMonolithEffectSnapshot(guiParams, state, glitchTriggerToken) {
  const bloom = mapMonolithBloomSettings(guiParams);
  const cinematicEnabled = state.currentFx === SHARED_FX_CINEMATIC;

  return {
    barrelBlurAmount: guiParams.barrelBlurAmount,
    barrelBlurEnabled: guiParams.barrelBlurEnabled,
    barrelBlurOffsetX: guiParams.barrelBlurOffsetX,
    barrelBlurOffsetY: guiParams.barrelBlurOffsetY,
    bloomEnabled: guiParams.bloomEnabled && !cinematicEnabled,
    bloomIntensity: bloom.intensity,
    bloomRadius: bloom.radius,
    bloomSmoothing: bloom.smoothing,
    bloomThreshold: bloom.threshold,
    chromaticAberrationEnabled: guiParams.chromaticAberrationEnabled,
    chromaticModulationOffset: guiParams.chromaticAberrationModulationOffset,
    chromaticOffsetX: guiParams.chromaticAberrationOffsetX,
    chromaticOffsetY: guiParams.chromaticAberrationOffsetY,
    chromaticOscillationSpeed: CHROMATIC_OSCILLATION_SPEED,
    chromaticRadialModulation: guiParams.chromaticAberrationRadialModulation,
    cinematicEnabled,
    databendEnabled: state.currentFx === SHARED_FX_DATABEND,
    glitchDuration: guiParams.glitchDuration,
    glitchEnabled: canTriggerMonolithGlitch(state),
    glitchStrength: guiParams.glitchStrength,
    glitchTriggerToken,
    hue: guiParams.hue,
    hueCycleBaseHue: state.hueCycleBaseHue,
    hueCycleEnabled: state.hueCycleEnabled,
    hueCycleStartTime: state.hueCycleStartTime,
    hueSatEnabled: state.currentFx === SHARED_FX_CINEMATIC && guiParams.hueSatEnabled,
    pixelMosaicEnabled: state.pixelMosaicEnabled,
    saturation: guiParams.saturation,
    scanlineDensity: guiParams.scanlineDensity,
    scanlineEnabled: guiParams.scanlineEnabled,
    scanlineOpacity: guiParams.scanlineOpacity,
    scanlineScrollSpeed: guiParams.scanlineScrollSpeed,
    thermalVisionEnabled: state.thermalVisionEnabled,
  };
}
