import * as THREE from 'three';

// ── Constants ──────────────────────────────────────────────────────────────────
// All tuning knobs, feature flags, and magic numbers used across the Planes
// visualization. Centralised here so every module imports from one place and
// values stay consistent.

// ── Lighting modes ─────────────────────────────────────────────────────────────

export const LIGHTING_MODE_SCENE = 0;
export const LIGHTING_MODE_LABELS = [
  'A (Scene)',
];

// ── Post-processing ────────────────────────────────────────────────────────────

export const CHROMATIC_OSCILLATION_SPEED = 3.2;

// ── Animation ──────────────────────────────────────────────────────────────────

export const ANIMATION_SPEED_BOOST_MULTIPLIER = 1.4;

// ── Touch interaction thresholds ───────────────────────────────────────────────

export const TOUCH_LONG_PRESS_DELAY_MS = 420;
export const TOUCH_TAP_MAX_MOVEMENT_PX = 12;
export const TOUCH_DOUBLE_TAP_MAX_DELAY_MS = 300;
export const TOUCH_DOUBLE_TAP_MAX_DISTANCE_PX = 24;

// ── Camera ─────────────────────────────────────────────────────────────────────

export const BASE_CAMERA_FOV = 45;
export const BOOST_CAMERA_FOV = 75;
export const BOOST_FOV_LERP_SPEED = 6;
export const BOOST_SHAKE_LERP_SPEED = 8;
export const BOOST_SHAKE_X_AMPLITUDE = 0.035;
export const BOOST_SHAKE_Y_AMPLITUDE = 0.025;
export const BOOST_SHAKE_Z_AMPLITUDE = 0.05;

// ── Scene ──────────────────────────────────────────────────────────────────────

export const BASE_SCENE_BACKGROUND = 0x050709;
export const SKY_DOME_RADIUS = 90;
export const CINEMATIC_EXPOSURE_MULTIPLIER = 0.58;

// ── Clouds ─────────────────────────────────────────────────────────────────────

export const CLOUDS_ENABLED = false;
export const VOLUMETRIC_CLOUDS_ENABLED = true;
export const SPRITE_CLOUDS_ENABLED = CLOUDS_ENABLED && !VOLUMETRIC_CLOUDS_ENABLED;
export const CLOUD_LAYER_COUNT = 5;
export const CLOUDS_PER_LAYER = 40;
export const CLOUD_SCROLL_SPEED = 9;
export const CLOUD_FIELD_BASE_Y = 24.0;
export const CLOUD_FIELD_WIDTH = 120;
export const CLOUD_FIELD_DEPTH = 220;
export const CLOUD_FIELD_HEIGHT = 26;
export const CLOUD_AMBIENT_MIN_FACTOR = 0.58;

// ── Ocean ──────────────────────────────────────────────────────────────────────

export const OCEAN_ENABLED = false;
export const OCEAN_Y = -8;
export const OCEAN_SIZE = 400;

// ── God rays ───────────────────────────────────────────────────────────────────

export const GOD_RAYS_ENABLED = true;

// ── Flight controls ────────────────────────────────────────────────────────────

export const ELEVATION_SPEED = 5.5;
export const ELEVATION_LERP_SPEED = 5.5;
export const ELEVATION_MIN_OFFSET = -3.5;
export const ELEVATION_MAX_OFFSET = 28.0;
export const ELEVATION_PITCH_MAX = 0.2;
export const ELEVATION_PITCH_LERP_SPEED = 6.5;

// ── Terrain ────────────────────────────────────────────────────────────────────

export const TERRAIN_ENABLED = false;
export const TERRAIN_TILE_COUNT = 3;
export const TERRAIN_TILE_LENGTH = 180;
export const TERRAIN_TILE_OVERLAP = 20;
export const TERRAIN_SCROLL_SPEED = 24;
export const TERRAIN_BASE_Y = -60;
export const TERRAIN_WIDTH = 220;
export const TERRAIN_RESOLUTION = 40;
export const TERRAIN_TREE_COUNT = 180;
export const TERRAIN_TREE_ATTEMPT_MULTIPLIER = 10;
export const TERRAIN_SAMPLE_Z_SCALE = 1.08;
export const TERRAIN_SAMPLE_X_DRIFT = 32;
export const TERRAIN_SAMPLE_Z_WARP = 10;
export const TERRAIN_GENERATOR_ARGS = Object.freeze({
  seed: 17,
  gain: 0.52,
  lacunarity: 1.78,
  frequency: 0.011,
  amplitude: 1.08,
  altitude: 0.18,
  erosion: 0.84,
  erosionSoftness: 0.32,
  rivers: 0.48,
  riversFrequency: 1.15,
  riversSeed: 31,
  riverWidth: 0.42,
  riverFalloff: 0.42,
  smoothLowerPlanes: 0.58,
  octaves: 7,
});

// ── Terrain (derived) ──────────────────────────────────────────────────────────

export const TERRAIN_HEIGHT_STRENGTH = 12.4 * (1 - TERRAIN_GENERATOR_ARGS.smoothLowerPlanes * 0.5);
export const TERRAIN_RIVER_WIDTH = THREE.MathUtils.mapLinear(TERRAIN_GENERATOR_ARGS.riverWidth, 0, 1, 0.5, 0.44);
export const TERRAIN_RIVER_FALLOFF = TERRAIN_GENERATOR_ARGS.riverFalloff * 0.3;
