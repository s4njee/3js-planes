import {
  LIGHTING_MODE_SCENE,
  ELEVATION_MIN_OFFSET,
} from './constants.js';

import {
  SHARED_FX_NONE,
} from '../shared/special-effects/index.ts';

// ── Flight state ───────────────────────────────────────────────────────────────
// Factory functions for the initial mutable state objects stored in refs inside
// MonolithScene. Extracted here so the shape of each state bag is defined in
// one place and can be referenced without scrolling through the component.

// ── Flight control state ───────────────────────────────────────────────────────
// Tracks keyboard input flags, accumulated yaw/pitch/bank offsets, and the
// elevation (altitude) of the aircraft above the ocean.

export function createInitialFlightControl() {
  return {
    ascendPressed: false,
    descendPressed: false,
    turnLeftPressed: false,
    turnRightPressed: false,
    // Touch drag steering: continuous -1…+1 values set by pointer handlers,
    // blended into the same turn/elevation inputs as keyboard keys each frame.
    touchTurnStrength: 0,
    touchElevationStrength: 0,
    elevationOffset: ELEVATION_MIN_OFFSET,
    targetElevationOffset: ELEVATION_MIN_OFFSET,
    pitchOffset: 0,
    yawOffset: 0,
    targetYawOffset: 0,
    bankOffset: 0,
    worldYaw: 0,
    lastWorldYaw: 0,
  };
}

// ── Monolith scene state ───────────────────────────────────────────────────────
// Holds lighting mode, active FX flags, model index, and hue-cycle state.

export function createInitialMonolithState() {
  return {
    whiteMode: false,
    hueCycleEnabled: false,
    hueCycleBaseHue: 0,
    hueCycleSavedEnabled: false,
    hueCycleSavedHue: 0,
    hueCycleSavedSaturation: 0,
    hueCycleStartTime: 0,
    xrayMode: false,
    restoreChromaticAberrationAfterXray: false,
    currentModelIndex: -1,
    lightingMode: LIGHTING_MODE_SCENE,
    currentFx: SHARED_FX_NONE,
    pixelMosaicEnabled: false,
    thermalVisionEnabled: false,
    pendingLightingMode: null,
    animationSpeedBoostEnabled: false,
  };
}
