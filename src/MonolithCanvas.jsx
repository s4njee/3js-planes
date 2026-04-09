import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

import { createGuiControls, createDefaultGuiParams } from './monolith/gui.js';
import { createLightingRig } from './monolith/lighting.js';
import { createMaterialManager } from './monolith/materials.js';
import { createOverlays } from './monolith/overlays.js';
import { MODEL_SET_DEF } from './monolith/set-defs.js';
import { createUI } from './monolith/ui.js';
import { resolveAssetUrl } from './monolith/asset-url.js';
import { cachedFetch, hasCachedModel } from './monolith/model-cache.js';
import SafeCanvas from './shared/webgl/SafeCanvas.tsx';
import {
  SharedEffectStack,
  createSharedEffectHotkeyListener,
  getHueCycleHue,
  SHARED_FX_CINEMATIC,
  SHARED_FX_DATABEND,
  SHARED_FX_NONE,
  setChromaticAberrationState,
  toggleChromaticAberrationState,
  toggleHueCycleState,
  toggleSharedFxMode,
  toggleXrayModeState,
} from './shared/special-effects/index.ts';

const LIGHTING_MODE_SCENE = 0;
const LIGHTING_MODE_PARTICLES = 1;
const LIGHTING_MODE_LABELS = [
  'A (Scene)',
  'B (Particles)',
];
const CHROMATIC_OSCILLATION_SPEED = 3.2;
const ANIMATION_SPEED_BOOST_MULTIPLIER = 1.4;
const TOUCH_LONG_PRESS_DELAY_MS = 420;
const TOUCH_TAP_MAX_MOVEMENT_PX = 12;
const TOUCH_DOUBLE_TAP_MAX_DELAY_MS = 300;
const TOUCH_DOUBLE_TAP_MAX_DISTANCE_PX = 24;
const BASE_CAMERA_FOV = 45;
const BOOST_CAMERA_FOV = 75;
const BOOST_FOV_LERP_SPEED = 6;
const BOOST_SHAKE_LERP_SPEED = 8;
const BOOST_SHAKE_X_AMPLITUDE = 0.035;
const BOOST_SHAKE_Y_AMPLITUDE = 0.025;
const BOOST_SHAKE_Z_AMPLITUDE = 0.05;
const BASE_SCENE_BACKGROUND = 0x050709;
const SKY_DOME_RADIUS = 90;
const ELEVATION_SPEED = 5.5;
const ELEVATION_LERP_SPEED = 5.5;
const ELEVATION_MIN_OFFSET = -3.5;
const ELEVATION_MAX_OFFSET = 5.5;
const ELEVATION_PITCH_MAX = 0.2;
const ELEVATION_PITCH_LERP_SPEED = 6.5;
const TERRAIN_TILE_COUNT = 3;
const TERRAIN_TILE_LENGTH = 180;
const TERRAIN_TILE_OVERLAP = 20;
const TERRAIN_SCROLL_SPEED = 24;
const TERRAIN_BASE_Y = -19.5;
const TERRAIN_WIDTH = 220;
const TERRAIN_TREE_COUNT = 180;
const TERRAIN_TREE_ATTEMPT_MULTIPLIER = 10;

function getTerrainHeight(x, worldZ) {
  const broadHills =
    Math.sin(x * 0.018) * 4.1 +
    Math.cos(worldZ * 0.015) * 3.2 +
    Math.sin((x * 0.032) + (worldZ * 0.022)) * 2.4;
  const rollingDetail =
    Math.sin((x * 0.082) - (worldZ * 0.051)) * 1.25 +
    Math.cos((x * 0.055) + (worldZ * 0.09)) * 0.8;
  const valley = -Math.exp(-Math.pow(x / 15.0, 2.0)) * 2.2;
  return broadHills + rollingDetail + valley - 1.8;
}

function getTerrainBiome(x, worldZ, height) {
  const moisture =
    0.62 +
    (Math.sin((x + 40) * 0.02) * 0.22) +
    (Math.cos((worldZ - 12) * 0.03) * 0.2) +
    (Math.sin((x * 0.06) + (worldZ * 0.045)) * 0.14);
  const fertility = moisture - (Math.max(height, 0) * 0.022);
  return {
    fertility,
    moisture,
  };
}

function getTerrainNormal(x, worldZ) {
  const sampleOffset = 0.8;
  const slopeX = getTerrainHeight(x + sampleOffset, worldZ) - getTerrainHeight(x - sampleOffset, worldZ);
  const slopeZ = getTerrainHeight(x, worldZ + sampleOffset) - getTerrainHeight(x, worldZ - sampleOffset);
  return new THREE.Vector3(-slopeX, sampleOffset * 2, -slopeZ).normalize();
}

function disposeTerrainTileContents(tileGroup) {
  tileGroup.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    child.material.dispose();
  });
  tileGroup.clear();
}

function populateTerrainTile(tileGroup, zOffset) {
  const length = TERRAIN_TILE_LENGTH + TERRAIN_TILE_OVERLAP;
  const widthSegments = 28;
  const lengthSegments = 28;
  const geometry = new THREE.PlaneGeometry(TERRAIN_WIDTH, length, widthSegments, lengthSegments);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const normals = new Float32Array(positions.count * 3);
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  const vertexNormal = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const worldZ = z + zOffset;
    const height = getTerrainHeight(x, worldZ);
    positions.setY(i, height);
    vertexNormal.copy(getTerrainNormal(x, worldZ));
    normals[i * 3] = vertexNormal.x;
    normals[i * 3 + 1] = vertexNormal.y;
    normals[i * 3 + 2] = vertexNormal.z;

    const { fertility, moisture } = getTerrainBiome(x, worldZ, height);
    const hue = THREE.MathUtils.clamp(0.29 + (fertility * 0.028) - (height * 0.002), 0.27, 0.35);
    const saturation = THREE.MathUtils.clamp(0.24 + (moisture * 0.18), 0.2, 0.4);
    const lightness = THREE.MathUtils.clamp(0.1 + ((height + 6.5) / 42) + (fertility * 0.018), 0.08, 0.22);
    color.setHSL(hue, saturation, lightness);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.98,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  tileGroup.add(mesh);

  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.18, 1.3, 6);
  const trunkMaterial = new THREE.MeshBasicMaterial({ color: 0x2b2119 });
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, TERRAIN_TREE_COUNT);
  const canopyGeometry = new THREE.ConeGeometry(0.7, 2.5, 8);
  const canopyMaterial = new THREE.MeshBasicMaterial({ color: 0x152a18 });
  const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, TERRAIN_TREE_COUNT);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();

  let plantedTrees = 0;
  let attempts = 0;
  while (plantedTrees < TERRAIN_TREE_COUNT && attempts < TERRAIN_TREE_COUNT * TERRAIN_TREE_ATTEMPT_MULTIPLIER) {
    attempts += 1;
    const x = (Math.random() - 0.5) * (TERRAIN_WIDTH - 14);
    const z = (Math.random() - 0.5) * (length - 10);
    const worldZ = z + zOffset;
    const height = getTerrainHeight(x, worldZ);
    const { fertility } = getTerrainBiome(x, worldZ, height);

    const slopeX = getTerrainHeight(x + 0.8, worldZ) - getTerrainHeight(x - 0.8, worldZ);
    const slopeZ = getTerrainHeight(x, worldZ + 0.8) - getTerrainHeight(x, worldZ - 0.8);
    const slope = Math.hypot(slopeX, slopeZ);
    const inRiver = Math.abs(x) < 11 && fertility < 0.56;

    if (fertility < 0.5 || slope > 1.15 || inRiver || height < -4.9) {
      continue;
    }

    normal.set(-slopeX, 1.8, -slopeZ).normalize();
    tangent.set(1, slopeX, 0).normalize();
    bitangent.crossVectors(normal, tangent).normalize();
    tangent.crossVectors(bitangent, normal).normalize();
    matrix.makeBasis(tangent, normal, bitangent);
    quaternion.setFromRotationMatrix(matrix);

    const trunkHeight = 1.1 + Math.random() * 1.2;
    const canopyHeight = 2.1 + Math.random() * 2.3;
    const canopyRadius = 0.45 + Math.random() * 0.26;

    position.set(x, height + (trunkHeight * 0.5), z);
    scale.set(0.7, trunkHeight / 1.3, 0.7);
    matrix.compose(position, quaternion, scale);
    trunkMesh.setMatrixAt(plantedTrees, matrix);

    position.set(x, height + trunkHeight + (canopyHeight * 0.44), z);
    scale.set(canopyRadius, canopyHeight / 1.9, canopyRadius);
    matrix.compose(position, quaternion, scale);
    canopyMesh.setMatrixAt(plantedTrees, matrix);

    plantedTrees += 1;
  }

  trunkMesh.count = plantedTrees;
  canopyMesh.count = plantedTrees;
  trunkMesh.instanceMatrix.needsUpdate = true;
  canopyMesh.instanceMatrix.needsUpdate = true;
  tileGroup.add(trunkMesh);
  tileGroup.add(canopyMesh);

  tileGroup.position.set(0, TERRAIN_BASE_Y, zOffset);
}

function createTerrainTile({ zOffset }) {
  const tileGroup = new THREE.Group();
  populateTerrainTile(tileGroup, zOffset);
  return tileGroup;
}

function createSkyDome() {
  const geometry = new THREE.SphereGeometry(SKY_DOME_RADIUS, 48, 32);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDirection;

      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec3 vDirection;

      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }

      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float n000 = hash(i + vec3(0.0, 0.0, 0.0));
        float n100 = hash(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash(i + vec3(1.0, 1.0, 1.0));

        float nx00 = mix(n000, n100, f.x);
        float nx10 = mix(n010, n110, f.x);
        float nx01 = mix(n001, n101, f.x);
        float nx11 = mix(n011, n111, f.x);
        float nxy0 = mix(nx00, nx10, f.y);
        float nxy1 = mix(nx01, nx11, f.y);
        return mix(nxy0, nxy1, f.z);
      }

      float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 5; i += 1) {
          value += noise(p) * amplitude;
          p *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec3 dir = normalize(vDirection);
        float horizon = clamp((dir.y + 0.22) * 0.9, 0.0, 1.0);

        vec3 zenith = vec3(0.05, 0.02, 0.24);
        vec3 midSky = vec3(0.08, 0.12, 0.42);
        vec3 horizonColor = vec3(0.10, 0.22, 0.56);
        vec3 base = mix(horizonColor, midSky, smoothstep(0.0, 0.42, horizon));
        base = mix(base, zenith, smoothstep(0.35, 1.0, horizon));

        vec3 nebulaPos = vec3(
          dir.x * 2.8 + time * 0.015,
          dir.y * 1.8 - time * 0.01,
          dir.z * 2.8
        );
        float nebula = fbm(nebulaPos);
        float wisps = smoothstep(0.5, 0.82, nebula) * smoothstep(-0.15, 0.75, dir.y);
        float secondary = smoothstep(0.58, 0.9, fbm(nebulaPos * 1.9 + 7.3)) * 0.6;

        vec3 nebulaBlue = vec3(0.20, 0.34, 0.88);
        vec3 nebulaPurple = vec3(0.36, 0.14, 0.72);
        vec3 nebulaGlow = vec3(0.56, 0.48, 1.0);
        base += nebulaBlue * wisps * 0.55;
        base += nebulaPurple * wisps * 0.32;
        base += nebulaGlow * secondary * 0.3;

        float vignette = 1.0 - smoothstep(0.15, 1.0, length(dir.xz) * 0.85);
        base += vec3(0.08, 0.10, 0.24) * vignette * 0.18;

        gl_FragColor = vec4(base, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}

function mapMonolithBloomSettings(guiParams) {
  // Monolith's legacy sliders were tuned for UnrealBloomPass. Translate them
  // into values that read similarly in @react-three/postprocessing's Bloom.
  return {
    intensity: Math.max(1.2, guiParams.bloomStrength * 3.5),
    radius: Math.min(1, (guiParams.bloomRadius * 2.8) + 0.12),
    smoothing: THREE.MathUtils.clamp(0.35 + ((1 - guiParams.bloomThreshold) * 0.5), 0, 1),
    threshold: THREE.MathUtils.clamp((guiParams.bloomThreshold - 0.77) * 0.05, 0, 1),
  };
}

// ── Initial state factory ──────────────────────────────────────────────────────────────

function createInitialMonolithState() {
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

// ── Glitch logic ───────────────────────────────────────────────────────────────────────

function canTriggerMonolithGlitch(state) {
  return (
    state.currentFx === SHARED_FX_CINEMATIC ||
    state.currentFx === SHARED_FX_DATABEND ||
    state.pixelMosaicEnabled ||
    state.thermalVisionEnabled
  );
}

function createMonolithEffectSnapshot(guiParams, state, glitchTriggerToken) {
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

function MonolithScene() {
  const { gl, scene, camera } = useThree();

  // ── Refs ────────────────────────────────────────────────────────────────────
  // All mutable scene values live in refs rather than state so they can be
  // read and written imperatively inside callbacks and the useFrame loop
  // without triggering re-renders. Only effectSnapshot is React state, because
  // SharedEffectStack needs to re-render when post-processing settings change.
  const controlsRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const guiParamsRef = useRef(createDefaultGuiParams());
  const materialManagerRef = useRef(null);
  const overlaysRef = useRef(null);
  const lightingRigRef = useRef(null);
  const uiRef = useRef(null);
  const guiControlsRef = useRef(null);
  const progressRef = useRef(null);
  const loaderRef = useRef(null);
  const modelCacheRef = useRef(new Map()); // session cache keyed by model path; see TODO in root ToDo.md #6
  const mixerRef = useRef(null);
  const monolithRef = useRef(new THREE.Group());
  const monolithBasePositionRef = useRef(new THREE.Vector3());
  const heatShimmerRef = useRef(null);
  const heatShimmerMaterialRef = useRef(null);
  const skyDomeRef = useRef(null);
  const terrainTilesRef = useRef([]);
  const flightControlRef = useRef({
    ascendPressed: false,
    descendPressed: false,
    elevationOffset: 0,
    targetElevationOffset: 0,
    pitchOffset: 0,
  });
  const stateRef = useRef(createInitialMonolithState());
  const boostVisualStateRef = useRef({
    intensity: 0,
    lastShakeOffset: new THREE.Vector3(),
  });
  const glitchTriggerTokenRef = useRef(0);
  const [effectSnapshot, setEffectSnapshot] = useState(() => (
    createMonolithEffectSnapshot(guiParamsRef.current, stateRef.current, glitchTriggerTokenRef.current)
  ));

  // ── Derived helpers ────────────────────────────────────────────────────────────

  const currentSetDef = () => MODEL_SET_DEF;
  const currentModels = () => currentSetDef().models;
  const supportsAnimationSpeedBoost = () => Boolean(currentSetDef().supportsAnimationSpeedBoost);
  const getLightingModeLabel = (mode) => LIGHTING_MODE_LABELS[mode] ?? LIGHTING_MODE_LABELS[0];
  const getEffectiveWhiteMode = () => stateRef.current.whiteMode;
  const getFallbackEngineShimmers = () => ([
    {
      x: guiParamsRef.current.shimmerOffsetX,
      y: guiParamsRef.current.shimmerOffsetY,
      z: guiParamsRef.current.shimmerOffsetZ,
    },
    {
      x: guiParamsRef.current.shimmerOffsetX,
      y: guiParamsRef.current.shimmerOffsetY,
      z: -guiParamsRef.current.shimmerOffsetZ + 0.14,
    },
  ]);
  const getModelEngineShimmers = (modelIndex) => {
    const model = currentModels()[modelIndex];
    if (!model) return [];
    if (Array.isArray(model.engineShimmers)) return model.engineShimmers;
    return modelIndex === 0 || modelIndex === 1 ? getFallbackEngineShimmers() : [];
  };
  const rebuildHeatShimmerMeshes = () => {
    if (!heatShimmerRef.current || !heatShimmerMaterialRef.current) return;

    const shimmerGroup = heatShimmerRef.current;
    const shimmerConfigs = getModelEngineShimmers(stateRef.current.currentModelIndex);

    shimmerGroup.children.forEach((child) => {
      child.geometry.dispose();
    });
    shimmerGroup.clear();

    shimmerConfigs.forEach(() => {
      const geometry = new THREE.CylinderGeometry(0.2, 0.0, 3.5, 32, 1, true);
      geometry.rotateZ(Math.PI / 2);
      shimmerGroup.add(new THREE.Mesh(geometry, heatShimmerMaterialRef.current));
    });
  };
  const setAnimationSpeedBoost = (enabled) => {
    if (!supportsAnimationSpeedBoost()) return;
    stateRef.current.animationSpeedBoostEnabled = enabled;
    syncAnimationMixerSpeed();
    syncEffectSnapshot();
  };
  const loadNextModel = (direction = 1) => {
    const models = currentModels();
    if (!models.length) return;

    const currentIndex = stateRef.current.currentModelIndex >= 0
      ? stateRef.current.currentModelIndex
      : (currentSetDef().defaultModel ?? 0);
    const nextIndex = (currentIndex + direction + models.length) % models.length;
    loadModel(nextIndex);
  };

  // ── Effect snapshot ───────────────────────────────────────────────────────────
  // syncEffectSnapshot() is the only way effectSnapshot changes. Calling it
  // causes SharedEffectStack to re-render with the latest settings from both
  // guiParamsRef and stateRef. triggerGlitch increments a token that
  // SharedEffectStack uses to fire a one-shot glitch burst.

  const revealScene = () => {
    if (stateRef.current.pendingLightingMode !== null) {
      switchLightingMode(stateRef.current.pendingLightingMode);
      stateRef.current.pendingLightingMode = null;
    }
    gl.domElement.style.opacity = '1';
  };

  const syncEffectSnapshot = ({ triggerGlitch = false } = {}) => {
    if (triggerGlitch && canTriggerMonolithGlitch(stateRef.current)) {
      glitchTriggerTokenRef.current += 1;
    }

    setEffectSnapshot(
      createMonolithEffectSnapshot(
        guiParamsRef.current,
        stateRef.current,
        glitchTriggerTokenRef.current,
      ),
    );
  };

  // ── Scene / material helpers ──────────────────────────────────────────────────────

  const markDisplayedModelMaterialsDirty = () => {
    monolithRef.current.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        material.needsUpdate = true;
      });
    });
  };

  const applySceneAppearance = () => {
    const effectiveWhiteMode = getEffectiveWhiteMode();

    document.body.style.background = effectiveWhiteMode ? 'white' : '#050709';
    scene.environment = null;
    scene.background = currentSetDef().nullBackground
      ? null
      : new THREE.Color(effectiveWhiteMode ? 0xffffff : BASE_SCENE_BACKGROUND);
    if (skyDomeRef.current) {
      skyDomeRef.current.visible = !effectiveWhiteMode;
    }
    overlaysRef.current?.applyWhiteMode(effectiveWhiteMode);
    uiRef.current?.applyWhiteMode();
  };

  const setWhiteMode = (value) => {
    stateRef.current.whiteMode = value;
    guiParamsRef.current.whiteMode = value;
    applySceneAppearance();
  };

  const applyChromaticXrayState = (nextState) => {
    const chromaticChanged = (
      guiParamsRef.current.chromaticAberrationEnabled !== nextState.chromaticAberrationEnabled
    );
    const xrayChanged = stateRef.current.xrayMode !== nextState.xrayMode;

    guiParamsRef.current.chromaticAberrationEnabled = nextState.chromaticAberrationEnabled;
    stateRef.current.restoreChromaticAberrationAfterXray = nextState.restoreChromaticAfterXray;
    stateRef.current.xrayMode = nextState.xrayMode;

    if (chromaticChanged) syncEffectSnapshot();

    if (chromaticChanged || xrayChanged) {
      guiControlsRef.current?.syncGuiDisplay();
    }

    if (xrayChanged) {
      refreshDisplayedModelMaterials();
    }
  };

  const toggleFx = (mode) => {
    stateRef.current.currentFx = toggleSharedFxMode(stateRef.current.currentFx, mode);
    syncEffectSnapshot();
    guiControlsRef.current?.syncGuiDisplay();
  };

  const refreshDisplayedModelMaterials = () => {
    if (stateRef.current.currentModelIndex < 0) return;
    materialManagerRef.current?.applyModelMaterials(
      monolithRef.current,
      currentSetDef(),
      stateRef.current.currentModelIndex,
      stateRef.current.xrayMode,
    );
  };

  const syncAnimationMixerSpeed = () => {
    if (!mixerRef.current) return;

    mixerRef.current.timeScale = (
      supportsAnimationSpeedBoost() && stateRef.current.animationSpeedBoostEnabled
    )
      ? ANIMATION_SPEED_BOOST_MULTIPLIER
      : 1;
  };

  const applyMonolithTransform = () => {
    if (!monolithRef.current) return;

    monolithRef.current.position.copy(monolithBasePositionRef.current);
    monolithRef.current.position.y += flightControlRef.current.elevationOffset;
    monolithRef.current.rotation.set(
      guiParamsRef.current.modelRotationX,
      guiParamsRef.current.modelRotationY,
      guiParamsRef.current.modelRotationZ + flightControlRef.current.pitchOffset,
    );
  };

  const swapModel = (model, name, animations) => {
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }

    scene.remove(monolithRef.current);
    const basePosition = model.userData.monolithBasePosition instanceof THREE.Vector3
      ? model.userData.monolithBasePosition
      : model.position.clone();
    monolithBasePositionRef.current.copy(basePosition);
    monolithRef.current = model;
    applyMonolithTransform();
    scene.add(monolithRef.current);

    if (animations?.length > 0) {
      mixerRef.current = new THREE.AnimationMixer(model);
      animations.forEach((clip) => mixerRef.current.clipAction(clip).play());
      syncAnimationMixerSpeed();
    }

    uiRef.current?.updateLabel(name);
  };

  // ── Model loading ────────────────────────────────────────────────────────────────
  // Load order: in-memory Map (modelCacheRef) → Cache API (cachedFetch) → network.
  // Parsed GLTF scenes are kept in modelCacheRef so revisiting a model in the
  // same session avoids re-parsing. cachedFetch caches the raw GLB bytes in the
  // browser Cache API so subsequent sessions skip the network request entirely.

  /** Displays the red "failed to load" progress bar state. */
  const showLoadError = (modelName) => {
    if (progressRef.current) {
      progressRef.current.container.style.opacity = '1';
      progressRef.current.bar.style.width = '100%';
      progressRef.current.bar.style.background = '#ff5c5c';
      progressRef.current.container.style.width = '320px';
      const label = progressRef.current.container.firstChild;
      if (label) {
        label.textContent = `failed to load ${modelName.toLowerCase()}`;
        label.style.color = 'rgba(255,92,92,0.9)';
      }
    }
  };

  const resetLoadProgress = () => {
    if (!progressRef.current) return;

    progressRef.current.container.style.transition = 'opacity 0.2s';
    progressRef.current.container.style.opacity = '1';
    progressRef.current.container.style.width = '200px';
    progressRef.current.bar.style.width = '0%';
    progressRef.current.bar.style.background = '#fff';

    const label = progressRef.current.container.firstChild;
    if (label) {
      label.textContent = 'loading';
      label.style.color = 'rgba(255,255,255,0.5)';
    }
  };

  const hideLoadProgress = ({ immediate = false } = {}) => {
    if (!progressRef.current) return;
    progressRef.current.container.style.transition = immediate ? 'opacity 0s' : 'opacity 0.4s';
    progressRef.current.container.style.opacity = '0';
  };

  const updateLoadProgress = (loadedBytes, totalBytes) => {
    if (!progressRef.current) return;

    if (totalBytes && totalBytes > 0) {
      progressRef.current.bar.style.width = `${Math.round((loadedBytes / totalBytes) * 100)}%`;
      return;
    }

    // Some cached/proxied responses do not expose Content-Length. In that case,
    // still show visible progress instead of leaving the bar at 0%.
    const fallbackProgress = Math.min(90, 8 + Math.sqrt(loadedBytes / 65536) * 18);
    progressRef.current.bar.style.width = `${fallbackProgress}%`;
  };

  const readModelArrayBuffer = async (response, trackProgress) => {
    if (!trackProgress) {
      return response.arrayBuffer();
    }

    const totalBytes = Number.parseInt(response.headers.get('content-length') ?? '', 10);

    if (!response.body || !Number.isFinite(totalBytes)) {
      const buffer = await response.arrayBuffer();
      updateLoadProgress(buffer.byteLength, Number.isFinite(totalBytes) ? totalBytes : 0);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
      loadedBytes += value.byteLength;
      updateLoadProgress(loadedBytes, totalBytes);
    }

    const buffer = new Uint8Array(loadedBytes);
    let offset = 0;

    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    updateLoadProgress(loadedBytes, totalBytes);
    return buffer.buffer;
  };

  const loadModel = async (index, { showProgressIfUncached = false } = {}) => {
    if (!loaderRef.current || index === stateRef.current.currentModelIndex) return;
    stateRef.current.currentModelIndex = index;
    rebuildHeatShimmerMeshes();
    guiControlsRef.current?.rebuildEngineShimmerFolder();
    syncEffectSnapshot({ triggerGlitch: true });
    gl.domElement.style.opacity = '0';
    overlaysRef.current?.updateTextVisibility(-1);

    const entry = currentModels()[index];
    const def = currentSetDef();
    const cacheKey = entry.path;

    if (modelCacheRef.current.has(cacheKey)) {
      hideLoadProgress({ immediate: true });
      const cached = modelCacheRef.current.get(cacheKey);
      materialManagerRef.current?.applyModelMaterials(
        cached.model,
        def,
        index,
        stateRef.current.xrayMode,
      );
      // TODO: skip the fade for cached hits (no network round-trip). Track the
      // timeout ID so it can be cleared on unmount (see root ToDo.md items #5, #8).
      window.setTimeout(() => {
        swapModel(cached.model, entry.name, cached.animations);
        overlaysRef.current?.updateTextVisibility(index);
        revealScene();
      }, 200);
      return;
    }

    // Fetch the GLB through the persistent Cache API layer, then parse with
    // GLTFLoader.  Using cachedFetch() + parse() instead of loader.load() lets
    // us cache the raw binary response across sessions so revisits skip the
    // network entirely.  DRACO decompression still runs via the DRACOLoader
    // attached to the GLTFLoader instance.
    const modelUrl = resolveAssetUrl(entry.path);
    const shouldTrackProgress = (
      showProgressIfUncached
      && !(await hasCachedModel(modelUrl))
    );

    if (shouldTrackProgress) {
      resetLoadProgress();
    } else {
      hideLoadProgress({ immediate: true });
    }

    cachedFetch(modelUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading ${entry.path}`);
        }
        return readModelArrayBuffer(response, shouldTrackProgress);
      })
      .then((buffer) => {
        loaderRef.current.parse(
          buffer,
          // resourcePath — tells the parser where to resolve relative
          // references (textures, etc.) within the GLB
          resolveAssetUrl(entry.path.substring(0, entry.path.lastIndexOf('/') + 1)),
          (gltf) => {
            if (shouldTrackProgress) {
              hideLoadProgress();
            }

            const model = gltf.scene;
            const animations = gltf.animations;

            materialManagerRef.current?.normalizeModelTransform(model, def, index);
            if (!(model.userData.monolithBasePosition instanceof THREE.Vector3)) {
              model.userData.monolithBasePosition = model.position.clone();
            }
            materialManagerRef.current?.applyModelTextureFiltering(model);
            materialManagerRef.current?.applyModelMaterials(
              model,
              def,
              index,
              stateRef.current.xrayMode,
            );

            modelCacheRef.current.set(cacheKey, { model, animations });
            // TODO: track this timeout ID and clear it in the cleanup to prevent
            // stale DOM updates after unmount (see root ToDo.md #8).
            window.setTimeout(() => {
              swapModel(model, entry.name, animations);
              overlaysRef.current?.updateTextVisibility(index);
              revealScene();
            }, 200);
          },
          (error) => {
            console.error('Failed to parse model', entry.path, error);
            gl.domElement.style.opacity = '1';
            showLoadError(entry.name);
          },
        );
      })
      .catch((error) => {
        console.error('Failed to load model', entry.path, error);
        gl.domElement.style.opacity = '1';
        showLoadError(entry.name);
      });
  };

  // ── Mode switching ────────────────────────────────────────────────────────────────

  const switchLightingMode = (mode) => {
    stateRef.current.lightingMode = mode;
    if (lightingRigRef.current) {
      lightingRigRef.current.particles.visible = mode === LIGHTING_MODE_PARTICLES;
      if (mode !== LIGHTING_MODE_PARTICLES) lightingRigRef.current.clearParticleGlow();
    }
    guiParamsRef.current.lightingMode = getLightingModeLabel(mode);
    applySceneAppearance();
    markDisplayedModelMaterialsDirty();
    guiControlsRef.current?.syncGuiDisplay();
    uiRef.current?.updateModeButtons();
  };

  // ── Effect toggles ────────────────────────────────────────────────────────────────

  const toggleWhiteMode = () => {
    setWhiteMode(!stateRef.current.whiteMode);
    guiControlsRef.current?.syncGuiDisplay();
  };

  const toggleChromaticAberration = () => {
    applyChromaticXrayState(toggleChromaticAberrationState({
      chromaticAberrationEnabled: guiParamsRef.current.chromaticAberrationEnabled,
      restoreChromaticAfterXray: stateRef.current.restoreChromaticAberrationAfterXray,
      xrayMode: stateRef.current.xrayMode,
    }));
  };

  const toggleXrayMode = () => {
    applyChromaticXrayState(toggleXrayModeState({
      chromaticAberrationEnabled: guiParamsRef.current.chromaticAberrationEnabled,
      restoreChromaticAfterXray: stateRef.current.restoreChromaticAberrationAfterXray,
      xrayMode: stateRef.current.xrayMode,
    }));
  };

  const toggleHueCycle = () => {
    const nextState = toggleHueCycleState({
      hue: guiParamsRef.current.hue,
      hueCycleBaseHue: stateRef.current.hueCycleBaseHue,
      hueCycleEnabled: stateRef.current.hueCycleEnabled,
      hueCycleSavedEnabled: stateRef.current.hueCycleSavedEnabled,
      hueCycleSavedHue: stateRef.current.hueCycleSavedHue,
      hueCycleSavedSaturation: stateRef.current.hueCycleSavedSaturation,
      hueCycleStartTime: stateRef.current.hueCycleStartTime,
      hueSatEnabled: guiParamsRef.current.hueSatEnabled,
      saturation: guiParamsRef.current.saturation,
    }, clockRef.current.getElapsedTime());

    stateRef.current.hueCycleEnabled = nextState.hueCycleEnabled;
    stateRef.current.hueCycleSavedEnabled = nextState.hueCycleSavedEnabled;
    stateRef.current.hueCycleSavedHue = nextState.hueCycleSavedHue;
    stateRef.current.hueCycleSavedSaturation = nextState.hueCycleSavedSaturation;
    stateRef.current.hueCycleBaseHue = nextState.hueCycleBaseHue;
    stateRef.current.hueCycleStartTime = nextState.hueCycleStartTime;

    guiParamsRef.current.hueSatEnabled = nextState.hueSatEnabled;
    guiParamsRef.current.hue = nextState.hue;
    guiParamsRef.current.saturation = nextState.saturation;

    syncEffectSnapshot();
    guiControlsRef.current?.syncGuiDisplay();
  };

  const togglePixelMosaic = () => {
    stateRef.current.pixelMosaicEnabled = !stateRef.current.pixelMosaicEnabled;
    syncEffectSnapshot();
    guiControlsRef.current?.syncGuiDisplay();
  };

  const toggleThermalVision = () => {
    stateRef.current.thermalVisionEnabled = !stateRef.current.thermalVisionEnabled;
    syncEffectSnapshot();
    guiControlsRef.current?.syncGuiDisplay();
  };

  const loadDefaultModel = () => {
    stateRef.current.currentModelIndex = -1;
    stateRef.current.animationSpeedBoostEnabled = false;
    syncAnimationMixerSpeed();

    const def = currentSetDef();
    overlaysRef.current?.hideAllOverlays();
    applySceneAppearance();

    stateRef.current.pendingLightingMode = def.defaultLighting ?? LIGHTING_MODE_SCENE;
    loadModel(def.defaultModel ?? 0, { showProgressIfUncached: true });
  };

  // ── Setup effect (mount / unmount) ───────────────────────────────────────────────

  useEffect(() => {
    scene.background = new THREE.Color(BASE_SCENE_BACKGROUND);
    document.body.style.background = '#050709';

    camera.fov = BASE_CAMERA_FOV;
    camera.near = 0.1;
    camera.far = 100;
    camera.position.set(0, 2.5, 14);
    camera.updateProjectionMatrix();

    gl.setPixelRatio(window.devicePixelRatio);
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.1;
    gl.domElement.style.position = 'relative';
    gl.domElement.style.zIndex = '1';
    gl.domElement.style.touchAction = 'none';
    gl.domElement.style.webkitTouchCallout = 'none';
    gl.domElement.style.transition = 'opacity 0.6s';
    gl.domElement.style.opacity = '0';

    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 2.5, 0);
    controls.enableDamping = true;
    controls.update();
    controlsRef.current = controls;

    const touchState = {
      activePointers: new Map(),
      longPressTimerId: null,
      longPressPointerId: null,
      longPressActive: false,
      lastTapTime: 0,
      lastTapX: 0,
      lastTapY: 0,
      lastTapClearTimerId: null,
    };

    const isTouchDevice = () => (
      window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0
    );

    const clearLongPressTimer = () => {
      if (touchState.longPressTimerId !== null) {
        window.clearTimeout(touchState.longPressTimerId);
        touchState.longPressTimerId = null;
      }
      touchState.longPressPointerId = null;
    };

    const clearLastTap = () => {
      if (touchState.lastTapClearTimerId !== null) {
        window.clearTimeout(touchState.lastTapClearTimerId);
        touchState.lastTapClearTimerId = null;
      }
      touchState.lastTapTime = 0;
    };

    const stopTouchBoost = () => {
      if (!touchState.longPressActive) return;
      touchState.longPressActive = false;
      setAnimationSpeedBoost(false);
    };

    const startLongPressTimer = (pointerId) => {
      clearLongPressTimer();
      touchState.longPressPointerId = pointerId;
      touchState.longPressTimerId = window.setTimeout(() => {
        const pointer = touchState.activePointers.get(pointerId);
        if (!pointer || pointer.cancelled || pointer.moved || touchState.activePointers.size !== 1) {
          return;
        }

        touchState.longPressTimerId = null;
        touchState.longPressPointerId = null;
        touchState.longPressActive = true;
        clearLastTap();
        setAnimationSpeedBoost(true);
      }, TOUCH_LONG_PRESS_DELAY_MS);
    };

    const onPointerDown = (event) => {
      if (!isTouchDevice() || event.pointerType !== 'touch') return;

      const pointerCountBefore = touchState.activePointers.size;
      touchState.activePointers.set(event.pointerId, {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        cancelled: false,
      });

      if (pointerCountBefore === 0) {
        startLongPressTimer(event.pointerId);
        return;
      }

      clearLongPressTimer();
      stopTouchBoost();
      clearLastTap();
      touchState.activePointers.forEach((pointer) => {
        pointer.cancelled = true;
      });
    };

    const onPointerMove = (event) => {
      if (!isTouchDevice() || event.pointerType !== 'touch') return;

      const pointer = touchState.activePointers.get(event.pointerId);
      if (!pointer) return;

      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;

      const moveDistance = Math.hypot(
        pointer.lastX - pointer.startX,
        pointer.lastY - pointer.startY,
      );

      if (moveDistance > TOUCH_TAP_MAX_MOVEMENT_PX) {
        pointer.moved = true;
        clearLongPressTimer();
      }
    };

    const onPointerEnd = (event) => {
      if (!isTouchDevice() || event.pointerType !== 'touch') return;

      const pointer = touchState.activePointers.get(event.pointerId);
      if (!pointer) return;

      touchState.activePointers.delete(event.pointerId);

      if (touchState.longPressPointerId === event.pointerId) {
        clearLongPressTimer();
      }

      if (touchState.longPressActive) {
        if (touchState.activePointers.size === 0) {
          stopTouchBoost();
        }
        return;
      }

      if (pointer.cancelled || pointer.moved || touchState.activePointers.size !== 0) {
        return;
      }

      const now = window.performance.now();
      const tapDistance = Math.hypot(
        pointer.lastX - touchState.lastTapX,
        pointer.lastY - touchState.lastTapY,
      );

      if (
        touchState.lastTapTime > 0
        && (now - touchState.lastTapTime) <= TOUCH_DOUBLE_TAP_MAX_DELAY_MS
        && tapDistance <= TOUCH_DOUBLE_TAP_MAX_DISTANCE_PX
      ) {
        clearLastTap();
        loadNextModel(1);
        return;
      }

      clearLastTap();
      touchState.lastTapX = pointer.lastX;
      touchState.lastTapY = pointer.lastY;
      touchState.lastTapTime = now;
      touchState.lastTapClearTimerId = window.setTimeout(() => {
        touchState.lastTapClearTimerId = null;
        touchState.lastTapTime = 0;
      }, TOUCH_DOUBLE_TAP_MAX_DELAY_MS);
    };

    materialManagerRef.current = createMaterialManager(gl);

    scene.add(monolithRef.current);

    const skyDome = createSkyDome();
    scene.add(skyDome);
    skyDomeRef.current = skyDome;

    const terrainTiles = Array.from({ length: TERRAIN_TILE_COUNT }, (_, index) => (
      createTerrainTile({ zOffset: -index * TERRAIN_TILE_LENGTH })
    ));
    terrainTiles.forEach((tile) => scene.add(tile));
    terrainTilesRef.current = terrainTiles;

    // Create heat shimmer mesh behind the monolith
    const shimmerGroup = new THREE.Group();
    shimmerGroup.visible = false;

    const shimmerGeoLeft = new THREE.CylinderGeometry(0.2, 0.0, 3.5, 32, 1, true);
    shimmerGeoLeft.rotateZ(Math.PI / 2); // align along local X axis

    const shimmerGeoRight = new THREE.CylinderGeometry(0.2, 0.0, 3.5, 32, 1, true);
    shimmerGeoRight.rotateZ(Math.PI / 2);

    const shimmerMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        boostIntensity: { value: 0 },
      },
      vertexShader: `
        uniform float time;
        uniform float boostIntensity;
        varying vec2 vUv;
        
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                     mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
        }

        void main() {
          vUv = uv;
          vec3 pos = position;
          
          // Anchor the effect: zero displacement at base (vUv.y == 1), max at the tip
          float tailFade = 1.0 - vUv.y;
          
          float ny = noise(vec2(vUv.x * 5.0, time * 15.0)) - 0.5;
          float nz = noise(vec2(vUv.x * 5.0 + 100.0, time * 15.0)) - 0.5;
          float nx = noise(vec2(time * 20.0, 0.0)) - 0.5;
          
          // Add turbulent rippling to the cone profile
          pos.y += ny * 0.15 * boostIntensity * tailFade;
          pos.z += nz * 0.15 * boostIntensity * tailFade;
          // Pulse the length of the flame slightly
          pos.x += nx * 0.3 * boostIntensity * tailFade;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float boostIntensity;
        varying vec2 vUv;
        
        // Simple 2D noise
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                     mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
        }
        
        void main() {
          if (boostIntensity < 0.01) discard;
          
          // Scroll noise along V (z-axis of cylinder)
          vec2 uv1 = vec2(vUv.x * 4.0, vUv.y * 3.0 - time * 5.0);
          vec2 uv2 = vec2(vUv.x * 3.0 - time * 2.0, vUv.y * 5.0 - time * 8.0);
          
          float n = noise(uv1) * 0.5 + noise(uv2) * 0.5;
          
          // Fade edges less aggressively
          float edge = sin(vUv.x * 3.14159);
          float distFade = pow(1.0 - vUv.y, 0.6); // Stays visible further down the tail
          
          // Increase baseline intensity
          float intensity = n * edge * distFade * boostIntensity;
          
          // Make it redder with a hot yellow core
          vec3 color = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 0.3, 0.0), n); // Deep red / bright orange
          color = mix(color, vec3(1.0, 0.8, 0.2), pow(n, 3.0)); // Yellow/white hot core
          
          // Boost visibility multiplier
          gl_FragColor = vec4(color * intensity * 4.0, intensity * 2.0);
        }
      `
    });
    
    scene.add(shimmerGroup);
    heatShimmerRef.current = shimmerGroup;
    heatShimmerMaterialRef.current = shimmerMat;
    rebuildHeatShimmerMeshes();

    overlaysRef.current = createOverlays(scene);

    lightingRigRef.current = createLightingRig({
      scene,
      currentSetDef,
      getCurrentModelIndex: () => stateRef.current.currentModelIndex,
      getMonolith: () => monolithRef.current,
      guiParams: guiParamsRef.current,
      getIsBoosting: () => stateRef.current.animationSpeedBoostEnabled && supportsAnimationSpeedBoost(),
    });

    uiRef.current = createUI({
      getWhiteMode: getEffectiveWhiteMode,
      getLightingMode: () => stateRef.current.lightingMode,
      onSwitchLightingMode: switchLightingMode,
    });

    guiControlsRef.current = createGuiControls({
      guiParams: guiParamsRef.current,
      models: currentModels(),
      getCurrentModelIndex: () => stateRef.current.currentModelIndex,
      renderer: gl,
      scene,
      onWhiteModeChange: setWhiteMode,
      onLightingModeChange: switchLightingMode,
      onChromaticAberrationChange: (enabled) => {
        applyChromaticXrayState(setChromaticAberrationState({
          chromaticAberrationEnabled: guiParamsRef.current.chromaticAberrationEnabled,
          restoreChromaticAfterXray: stateRef.current.restoreChromaticAberrationAfterXray,
          xrayMode: stateRef.current.xrayMode,
        }, enabled));
      },
      onEngineShimmerChange: (modelIndex) => {
        if (modelIndex === stateRef.current.currentModelIndex) {
          rebuildHeatShimmerMeshes();
        }
      },
      onEffectSettingsChange: syncEffectSnapshot,
      onTriggerGlitch: () => syncEffectSnapshot({ triggerGlitch: true }),
      onModelRotationChange: () => {
        applyMonolithTransform();
      },
    });

    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:200px;z-index:200;opacity:0;pointer-events:none;transition:opacity 0.4s';
    const progressBar = document.createElement('div');
    progressBar.style.cssText = 'width:0%;height:2px;background:#fff;transition:width 0.2s';
    const progressLabel = document.createElement('div');
    progressLabel.style.cssText = 'color:rgba(255,255,255,0.5);font:12px/1 monospace;text-align:center;margin-bottom:8px';
    progressLabel.textContent = 'loading';
    progressContainer.appendChild(progressLabel);
    progressContainer.appendChild(progressBar);
    document.body.appendChild(progressContainer);
    progressRef.current = { bar: progressBar, container: progressContainer };

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(resolveAssetUrl('/draco/'));
    dracoLoader.preload();

    loaderRef.current = new GLTFLoader();
    loaderRef.current.setDRACOLoader(dracoLoader);

    const handleSharedEffectHotkey = createSharedEffectHotkeyListener({
      cinematic: () => toggleFx(SHARED_FX_CINEMATIC),
      chromaticAberration: toggleChromaticAberration,
      databend: () => toggleFx(SHARED_FX_DATABEND),
      hueCycle: toggleHueCycle,
      pixelMosaic: togglePixelMosaic,
      thermalVision: toggleThermalVision,
      xrayMode: toggleXrayMode,
    });

    // ── Hotkey handler ────────────────────────────────────────────────────────────────
    // Arrow keys → model navigation within the active set.
    // 6         → toggle white mode.
    // G         → toggle lil-gui debug panel.
    // All post-processing hotkeys are delegated to handleSharedEffectHotkey.
    const onKeyDown = (event) => {
      if (event.code === 'Space') {
        if (event.repeat || !supportsAnimationSpeedBoost()) return;
        event.preventDefault();
        setAnimationSpeedBoost(true);
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        loadNextModel(event.key === 'ArrowRight' ? 1 : -1);
        return;
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (event.key === 'ArrowUp') {
          flightControlRef.current.ascendPressed = true;
        } else {
          flightControlRef.current.descendPressed = true;
        }
        return;
      }

      if (event.key === '6') {
        toggleWhiteMode();
        return;
      }

      if (event.key === 'g' || event.key === 'G') {
        guiControlsRef.current?.toggleGUI();
        return;
      }

      if (handleSharedEffectHotkey(event)) {
        return;
      }
    };

    const onKeyUp = (event) => {
      if (event.code === 'Space' && supportsAnimationSpeedBoost()) {
        setAnimationSpeedBoost(false);
        return;
      }

      if (event.key === 'ArrowUp') {
        flightControlRef.current.ascendPressed = false;
        return;
      }

      if (event.key === 'ArrowDown') {
        flightControlRef.current.descendPressed = false;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    gl.domElement.addEventListener('pointerdown', onPointerDown);
    gl.domElement.addEventListener('pointermove', onPointerMove);
    gl.domElement.addEventListener('pointerup', onPointerEnd);
    gl.domElement.addEventListener('pointercancel', onPointerEnd);

    loadDefaultModel();
    syncEffectSnapshot();
    applySceneAppearance();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      gl.domElement.removeEventListener('pointerdown', onPointerDown);
      gl.domElement.removeEventListener('pointermove', onPointerMove);
      gl.domElement.removeEventListener('pointerup', onPointerEnd);
      gl.domElement.removeEventListener('pointercancel', onPointerEnd);
      clearLongPressTimer();
      clearLastTap();
      stopTouchBoost();
      touchState.activePointers.clear();
      controls.dispose();
      guiControlsRef.current?.destroy();
      uiRef.current?.destroy();
      overlaysRef.current?.destroy();
      progressContainer.remove();
      scene.remove(monolithRef.current);
      if (skyDomeRef.current) {
        scene.remove(skyDomeRef.current);
        skyDomeRef.current.geometry.dispose();
        skyDomeRef.current.material.dispose();
      }
      terrainTilesRef.current.forEach((tile) => {
        scene.remove(tile);
        disposeTerrainTileContents(tile);
      });
      terrainTilesRef.current = [];
      if (heatShimmerRef.current) {
        scene.remove(heatShimmerRef.current);
        heatShimmerRef.current.children.forEach((child) => {
          child.geometry.dispose();
        });
      }
      heatShimmerMaterialRef.current?.dispose();
      lightingRigRef.current?.dispose?.();
      lightingRigRef.current = null;
      scene.environment = null;
      scene.background = null;
      dracoLoader.dispose();
      mixerRef.current?.stopAllAction();
    };
  }, [camera, gl, scene]);

  // ── Per-frame animation loop ─────────────────────────────────────────────────────────

  useFrame((_, delta) => {
    const elapsed = clockRef.current.getElapsedTime();
    const boostVisualState = boostVisualStateRef.current;
    const boostShakeOffset = boostVisualState.lastShakeOffset;
    const boostTarget = (
      supportsAnimationSpeedBoost() && stateRef.current.animationSpeedBoostEnabled
    ) ? 1 : 0;

    if (boostShakeOffset.lengthSq() > 0) {
      camera.position.sub(boostShakeOffset);
      boostShakeOffset.set(0, 0, 0);
    }

    controlsRef.current?.update();
    mixerRef.current?.update(delta);
    materialManagerRef.current?.updateXrayAnimation(elapsed);
    lightingRigRef.current?.updateBackgroundStars({
      cameraPosition: camera.position,
    });

    boostVisualState.intensity = THREE.MathUtils.lerp(
      boostVisualState.intensity,
      boostTarget,
      delta * BOOST_SHAKE_LERP_SPEED,
    );

    const flightControl = flightControlRef.current;
    const elevationDirection = Number(flightControl.ascendPressed) - Number(flightControl.descendPressed);
    if (elevationDirection !== 0) {
      flightControl.targetElevationOffset = THREE.MathUtils.clamp(
        flightControl.targetElevationOffset + (elevationDirection * ELEVATION_SPEED * delta),
        ELEVATION_MIN_OFFSET,
        ELEVATION_MAX_OFFSET,
      );
    }
    flightControl.elevationOffset = THREE.MathUtils.lerp(
      flightControl.elevationOffset,
      flightControl.targetElevationOffset,
      delta * ELEVATION_LERP_SPEED,
    );
    flightControl.pitchOffset = THREE.MathUtils.lerp(
      flightControl.pitchOffset,
      -elevationDirection * ELEVATION_PITCH_MAX,
      delta * ELEVATION_PITCH_LERP_SPEED,
    );
    applyMonolithTransform();

    const targetFov = THREE.MathUtils.lerp(
      BASE_CAMERA_FOV,
      BOOST_CAMERA_FOV,
      boostVisualState.intensity,
    );
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, delta * BOOST_FOV_LERP_SPEED);
    camera.updateProjectionMatrix();

    if (boostVisualState.intensity > 0.001) {
      boostShakeOffset.set(
        (Math.sin(elapsed * 23.0) + Math.sin(elapsed * 41.0 + 0.8)) * BOOST_SHAKE_X_AMPLITUDE * boostVisualState.intensity,
        (Math.sin(elapsed * 31.0 + 1.2) + Math.sin(elapsed * 53.0)) * BOOST_SHAKE_Y_AMPLITUDE * boostVisualState.intensity,
        (Math.sin(elapsed * 19.0 + 0.3) + Math.sin(elapsed * 47.0 + 2.4)) * BOOST_SHAKE_Z_AMPLITUDE * boostVisualState.intensity,
      );
      camera.position.add(boostShakeOffset);
    }

    if (skyDomeRef.current) {
      skyDomeRef.current.position.copy(camera.position);
      skyDomeRef.current.material.uniforms.time.value = elapsed;
    }

    if (terrainTilesRef.current.length > 0) {
      const scrollSpeed = TERRAIN_SCROLL_SPEED * (1 + boostVisualState.intensity * 2.6);
      const wrapThreshold = TERRAIN_TILE_LENGTH * 0.75;
      let furthestBackZ = Infinity;

      terrainTilesRef.current.forEach((tile) => {
        furthestBackZ = Math.min(furthestBackZ, tile.position.z);
      });

      terrainTilesRef.current.forEach((tile) => {
        tile.position.z += scrollSpeed * delta;
        if (tile.position.z > wrapThreshold) {
          const nextZOffset = furthestBackZ - TERRAIN_TILE_LENGTH;
          disposeTerrainTileContents(tile);
          populateTerrainTile(tile, nextZOffset);
          furthestBackZ = nextZOffset;
        }
      });
    }

    if (heatShimmerRef.current && heatShimmerRef.current.children.length > 0) {
      const engineShimmers = getModelEngineShimmers(stateRef.current.currentModelIndex);
      const isBoosting = engineShimmers.length > 0
        && stateRef.current.animationSpeedBoostEnabled
        && supportsAnimationSpeedBoost();
      const firstMesh = heatShimmerRef.current.children[0];
      const mat = firstMesh.material;
      
      const currentIntensity = mat.uniforms.boostIntensity.value;
      const targetIntensity = isBoosting ? 1.0 : 0.0;
      
      mat.uniforms.boostIntensity.value = THREE.MathUtils.lerp(currentIntensity, targetIntensity, delta * 10);
      mat.uniforms.time.value = elapsed;
      
      heatShimmerRef.current.visible = mat.uniforms.boostIntensity.value > 0.01;

      heatShimmerRef.current.children.forEach((mesh, index) => {
        const shimmer = engineShimmers[index];
        if (!shimmer) return;
        mesh.position.set(shimmer.x, shimmer.y, shimmer.z);
      });
      
      if (monolithRef.current) {
        heatShimmerRef.current.position.copy(monolithRef.current.position);
        heatShimmerRef.current.rotation.copy(monolithRef.current.rotation);
      }
    }

    if (stateRef.current.hueCycleEnabled) {
      guiParamsRef.current.hue = getHueCycleHue(
        stateRef.current.hueCycleBaseHue,
        stateRef.current.hueCycleStartTime,
        elapsed,
      );
      guiParamsRef.current.saturation = 1;
    }

    if (stateRef.current.lightingMode === LIGHTING_MODE_SCENE) {
      lightingRigRef.current?.updateSceneLighting({
        forceRefresh: effectSnapshot.cinematicEnabled && effectSnapshot.bloomEnabled,
      });
    } else if (stateRef.current.lightingMode === LIGHTING_MODE_PARTICLES) {
      lightingRigRef.current?.updateParticleLighting();
    }

    if (effectSnapshot.cinematicEnabled && effectSnapshot.bloomEnabled) {
      lightingRigRef.current?.animateBloomRing();
    }
  });

  return <SharedEffectStack {...effectSnapshot} />;
}

export default function MonolithCanvas() {
  const dpr = useMemo(() => Math.min(window.devicePixelRatio, 2), []);

  return (
    <SafeCanvas
      dpr={dpr}
      rendererOptions={{ antialias: true, alpha: true }}
      sceneLabel="Planes"
    >
      <Suspense fallback={null}>
        <MonolithScene />
      </Suspense>
    </SafeCanvas>
  );
}
