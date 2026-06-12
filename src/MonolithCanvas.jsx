import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ── Internal modules ───────────────────────────────────────────────────────────

import { createGuiControls, createDefaultGuiParams } from './monolith/gui.js';
import { createLightingRig } from './monolith/lighting.js';
import { createMaterialManager } from './monolith/materials.js';
import { createOverlays } from './monolith/overlays.js';
import { MODEL_SET_DEF } from './monolith/set-defs.js';
import { createUI } from './monolith/ui.js';
import { resolveAssetUrl } from './monolith/asset-url.js';
import { cachedFetch, hasCachedModel } from './monolith/model-cache.js';

// ── Extracted modules ──────────────────────────────────────────────────────────

import {
  LIGHTING_MODE_SCENE,
  LIGHTING_MODE_LABELS,
  ANIMATION_SPEED_BOOST_MULTIPLIER,
  TOUCH_LONG_PRESS_DELAY_MS,
  TOUCH_TAP_MAX_MOVEMENT_PX,
  TOUCH_DOUBLE_TAP_MAX_DELAY_MS,
  TOUCH_DOUBLE_TAP_MAX_DISTANCE_PX,
  BASE_CAMERA_FOV,
  BOOST_CAMERA_FOV,
  BOOST_FOV_LERP_SPEED,
  BOOST_SHAKE_LERP_SPEED,
  BOOST_SHAKE_X_AMPLITUDE,
  BOOST_SHAKE_Y_AMPLITUDE,
  BOOST_SHAKE_Z_AMPLITUDE,
  CAMERA_TURN_SWAY_FACTOR,
  CAMERA_TURN_ROLL_FACTOR,
  AMBIENT_SHAKE_INTENSITY,
  BASE_SCENE_BACKGROUND,
  CINEMATIC_EXPOSURE_MULTIPLIER,
  CLOUDS_ENABLED,
  CLOUD_SCROLL_SPEED,
  CLOUD_FIELD_DEPTH,
  CLOUD_AMBIENT_MIN_FACTOR,
  OCEAN_ENABLED,
  ELEVATION_SPEED,
  ELEVATION_LERP_SPEED,
  ELEVATION_MIN_OFFSET,
  ELEVATION_MAX_OFFSET,
  ELEVATION_PITCH_MAX,
  ELEVATION_PITCH_LERP_SPEED,
  TERRAIN_ENABLED,
  TERRAIN_TILE_COUNT,
  TERRAIN_TILE_LENGTH,
  TERRAIN_SCROLL_SPEED,
} from './monolith/constants.js';

import {
  disposeTerrainTileContents,
  populateTerrainTile,
  createTerrainTile,
} from './monolith/terrain.js';

import {
  createSkyDome,
  createOcean,
  createCloudField,
  randomizeCloudSprite,
} from './monolith/environment.js';

import { createHeatShimmerGroup } from './monolith/heat-shimmer.js';
import CesiumTilesBackground from './monolith/CesiumTilesBackground.jsx';
import { autopilot, flightState } from './flight-store.js';
import { shouldSuppressGlobalShortcuts } from './keyboard-shortcuts.js';
import {
  cartographicToScenePosition,
  CESIUM_TERRAIN_SCENE_SCALE,
  scenePositionToCartographic,
} from './monolith/cesium-geospatial.js';
import { flightCommandState } from './flight-store.js';
import { createInitialFlightControl, createInitialMonolithState } from './monolith/flight-state.js';
import { attachNavLights, updateNavLights } from './monolith/nav-lights.js';
import { createMonolithEffectSnapshot, canTriggerMonolithGlitch } from './monolith/effects.js';

const teleportScenePositionScratch = new THREE.Vector3();
const teleportAnchorOffsetScratch = new THREE.Vector3();
const teleportRotationScratch = new THREE.Matrix4();
const monolithWorldAnchorScratch = new THREE.Vector3();
const framePlanePositionScratch = new THREE.Vector3();
const FRAME_Y_AXIS = new THREE.Vector3(0, 1, 0);

function getShortestAngleDelta(target, current) {
  return THREE.MathUtils.euclideanModulo(
    target - current + Math.PI,
    Math.PI * 2,
  ) - Math.PI;
}

// ── Shared effects ─────────────────────────────────────────────────────────────

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

// ── MonolithScene ──────────────────────────────────────────────────────────────
// The main React component that owns the entire 3D scene. All mutable values
// live in refs to avoid re-renders; only `effectSnapshot` is React state
// because SharedEffectStack needs to re-render when post-processing changes.

function MonolithScene() {
  const { gl, scene, camera } = useThree();

  // ── Refs ──────────────────────────────────────────────────────────────────
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
  const oceanRef = useRef(null);
  const cloudFieldRef = useRef(null);
  const cloudStateRef = useRef({
    density: 0,
    ambientFactor: 1,
  });
  const appliedTeleportVersionRef = useRef(flightCommandState.teleportVersion);
  const terrainTilesRef = useRef([]);
  const flightControlRef = useRef(createInitialFlightControl());
  const stateRef = useRef(createInitialMonolithState());
  const boostVisualStateRef = useRef({
    intensity: 0,
    lastShakeOffset: new THREE.Vector3(),
  });
  const glitchTriggerTokenRef = useRef(0);
  const [effectSnapshot, setEffectSnapshot] = useState(() => (
    createMonolithEffectSnapshot(guiParamsRef.current, stateRef.current, glitchTriggerTokenRef.current)
  ));
  const foregroundEffectsPausedRef = useRef(false);
  const [foregroundEffectsPaused, setForegroundEffectsPaused] = useState(false);

  // ── Derived helpers ───────────────────────────────────────────────────────

  const currentSetDef = () => MODEL_SET_DEF;
  const currentModels = () => currentSetDef().models;
  const getCurrentModelDef = () => currentModels()[stateRef.current.currentModelIndex] ?? null;
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

  // ── Heat shimmer mesh management ──────────────────────────────────────────

  const rebuildHeatShimmerMeshes = () => {
    if (!heatShimmerRef.current || !heatShimmerMaterialRef.current) return;

    const shimmerGroup = heatShimmerRef.current;
    const shimmerConfigs = getModelEngineShimmers(stateRef.current.currentModelIndex);

    shimmerGroup.children.forEach((child) => {
      child.geometry.dispose();
    });
    shimmerGroup.clear();

    shimmerConfigs.forEach(() => {
      const geometry = new THREE.CylinderGeometry(0.3, 0.0, 4.5, 32, 16, true);
      geometry.rotateZ(Math.PI / 2);
      shimmerGroup.add(new THREE.Mesh(geometry, heatShimmerMaterialRef.current));
    });
  };

  // ── Animation speed boost ─────────────────────────────────────────────────

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

  // ── Effect snapshot ───────────────────────────────────────────────────────
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

  // ── Scene / material helpers ──────────────────────────────────────────────

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

    document.body.style.background = effectiveWhiteMode ? 'white' : 'transparent';
    scene.environment = null;
    scene.background = effectiveWhiteMode ? new THREE.Color(0xffffff) : null;
    if (skyDomeRef.current) {
      skyDomeRef.current.visible = false; // tiles replace the sky dome
    }
    if (cloudFieldRef.current) {
      cloudFieldRef.current.visible = false; // replaced by volumetric clouds
    }
    if (oceanRef.current) {
      oceanRef.current.visible = !effectiveWhiteMode && OCEAN_ENABLED;
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

  // ── Model transform ───────────────────────────────────────────────────────

  const applyMonolithTransform = () => {
    if (!monolithRef.current) return;

    monolithRef.current.position.copy(monolithBasePositionRef.current);
    monolithRef.current.position.y += flightControlRef.current.elevationOffset;
    // Apply base GUI rotation first
    monolithRef.current.rotation.set(
      guiParamsRef.current.modelRotationX,
      guiParamsRef.current.modelRotationY,
      guiParamsRef.current.modelRotationZ
    );
    
    // Apply flight offsets independently in local object space to avoid Gimbal Lock.
    // Native X is the nose-to-tail axis -> Roll/Bank.
    // Native Z is the wing-to-wing axis -> Pitch.
    // Native Y is the vertical axis -> Yaw.
    monolithRef.current.rotateX(-flightControlRef.current.bankOffset);
    monolithRef.current.rotateY(-flightControlRef.current.yawOffset);
    monolithRef.current.rotateZ(flightControlRef.current.pitchOffset);

    monolithRef.current.updateMatrixWorld(true);
    const geoAnchor = monolithRef.current.userData.monolithGeoAnchor;
    const worldAnchor = geoAnchor instanceof THREE.Vector3
      ? monolithWorldAnchorScratch.copy(geoAnchor)
      : monolithWorldAnchorScratch.copy(monolithRef.current.position);
    monolithRef.current.localToWorld(worldAnchor);

    const cartographic = scenePositionToCartographic(worldAnchor);
    if (cartographic) {
      flightState.lat = cartographic.lat;
      flightState.lon = cartographic.lon;
      flightState.alt = cartographic.height;
      flightState.heading = -Math.PI / 2 - flightControlRef.current.worldYaw;
    }
  };

  const applyPendingTeleport = () => {
    if (!monolithRef.current) return false;
    if (flightCommandState.teleportVersion === appliedTeleportVersionRef.current) return false;

    const targetScenePosition = cartographicToScenePosition({
      lat: flightCommandState.teleportLat,
      lon: flightCommandState.teleportLon,
      height: flightCommandState.teleportAlt,
    }, teleportScenePositionScratch);

    const planeGeoAnchor = monolithRef.current.userData.monolithGeoAnchor;
    if (!targetScenePosition || !(planeGeoAnchor instanceof THREE.Vector3)) return false;

    teleportRotationScratch.compose(
      new THREE.Vector3(0, 0, 0),
      monolithRef.current.quaternion,
      monolithRef.current.scale,
    );
    teleportAnchorOffsetScratch.copy(planeGeoAnchor).applyMatrix4(teleportRotationScratch);

    monolithBasePositionRef.current.copy(targetScenePosition);
    monolithBasePositionRef.current.y -= flightControlRef.current.elevationOffset;
    monolithBasePositionRef.current.sub(teleportAnchorOffsetScratch);

    flightControlRef.current.worldYaw = -Math.PI / 2 - flightCommandState.teleportHeading;
    flightControlRef.current.lastWorldYaw = flightControlRef.current.worldYaw;
    flightControlRef.current.targetYawOffset = 0;
    flightControlRef.current.yawOffset = 0;
    flightControlRef.current.bankOffset = 0;
    flightControlRef.current.pitchOffset = 0;

    appliedTeleportVersionRef.current = flightCommandState.teleportVersion;
    applyMonolithTransform();
    return true;
  };

  // ── Model swap ────────────────────────────────────────────────────────────

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
    attachNavLights(monolithRef.current);

    if (animations?.length > 0) {
      mixerRef.current = new THREE.AnimationMixer(model);
      animations.forEach((clip) => mixerRef.current.clipAction(clip).play());
      syncAnimationMixerSpeed();
    }

    uiRef.current?.updateLabel(name);
  };

  // ── Model loading ─────────────────────────────────────────────────────────
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

  // ── Mode switching ────────────────────────────────────────────────────────

  const switchLightingMode = (mode) => {
    stateRef.current.lightingMode = mode;
    guiParamsRef.current.lightingMode = getLightingModeLabel(mode);
    applySceneAppearance();
    markDisplayedModelMaterialsDirty();
    guiControlsRef.current?.syncGuiDisplay();
    uiRef.current?.updateModeButtons();
  };

  // ── Effect toggles ────────────────────────────────────────────────────────

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

  // ── Setup effect (mount / unmount) ────────────────────────────────────────

  useEffect(() => {
    scene.background = null;
    document.body.style.background = 'transparent';

    camera.fov = BASE_CAMERA_FOV;
    camera.near = 0.1;
    camera.far = 2000;
    camera.position.set(0, 5.0, 14);
    camera.updateProjectionMatrix();

    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = guiParamsRef.current.exposure;
    gl.domElement.style.position = 'relative';
    gl.domElement.style.zIndex = '1';
    gl.domElement.style.touchAction = 'none';
    gl.domElement.style.webkitTouchCallout = 'none';
    gl.domElement.style.transition = 'opacity 0.6s';
    gl.domElement.style.opacity = '0';

    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 5.0, 0);
    controls.enableRotate = false;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.update();
    controlsRef.current = controls;

    // ── Touch input state ─────────────────────────────────────────────────
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

    // ── Pointer event handlers ────────────────────────────────────────────
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

    // ── Scene construction ────────────────────────────────────────────────
    materialManagerRef.current = createMaterialManager(gl);

    scene.add(monolithRef.current);

    const skyDome = createSkyDome();
    scene.add(skyDome);
    skyDomeRef.current = skyDome;

    if (CLOUDS_ENABLED) {
      const cloudField = createCloudField();
      scene.add(cloudField);
      cloudFieldRef.current = cloudField;
    }


    if (OCEAN_ENABLED) {
      const ocean = createOcean();
      scene.add(ocean);
      oceanRef.current = ocean;
    }

    if (TERRAIN_ENABLED) {
      const terrainTiles = Array.from({ length: TERRAIN_TILE_COUNT }, (_, index) => (
        createTerrainTile({
          renderZOffset: -index * TERRAIN_TILE_LENGTH,
          logicalZOffset: -index * TERRAIN_TILE_LENGTH,
        })
      ));
      terrainTiles.forEach((tile) => scene.add(tile));
      terrainTilesRef.current = terrainTiles;
    }

    // ── Heat shimmer ────────────────────────────────────────────────────────
    const { shimmerGroup, shimmerMat } = createHeatShimmerGroup();
    scene.add(shimmerGroup);
    heatShimmerRef.current = shimmerGroup;
    heatShimmerMaterialRef.current = shimmerMat;
    rebuildHeatShimmerMeshes();

    // ── Overlays, lighting, UI, GUI ─────────────────────────────────────────
    overlaysRef.current = createOverlays(scene);

    lightingRigRef.current = createLightingRig({
      scene,
      currentSetDef,
      getCurrentModelIndex: () => stateRef.current.currentModelIndex,
      getMonolith: () => monolithRef.current,
      guiParams: guiParamsRef.current,
      getCloudAmbientFactor: () => cloudStateRef.current.ambientFactor,
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

    // ── Progress bar ────────────────────────────────────────────────────────
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

    // ── GLTF / DRACO loader ─────────────────────────────────────────────────
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(resolveAssetUrl('/draco/'));
    dracoLoader.preload();

    loaderRef.current = new GLTFLoader();
    loaderRef.current.setDRACOLoader(dracoLoader);

    // ── Keyboard event handlers ─────────────────────────────────────────────
    const handleSharedEffectHotkey = createSharedEffectHotkeyListener({
      cinematic: () => toggleFx(SHARED_FX_CINEMATIC),
      chromaticAberration: toggleChromaticAberration,
      databend: () => toggleFx(SHARED_FX_DATABEND),
      hueCycle: toggleHueCycle,
      pixelMosaic: togglePixelMosaic,
      thermalVision: toggleThermalVision,
      xrayMode: toggleXrayMode,
    });

    const onKeyDown = (event) => {
      if (shouldSuppressGlobalShortcuts(event)) return;
      if (event.code === 'Space') {
        if (event.repeat || !supportsAnimationSpeedBoost()) return;
        event.preventDefault();
        setAnimationSpeedBoost(true);
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.key === 'ArrowRight') {
          flightControlRef.current.turnRightPressed = true;
        } else {
          flightControlRef.current.turnLeftPressed = true;
        }
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

      if (event.key === 'z' || event.key === 'Z') {
        loadNextModel(-1);
        return;
      }

      if (event.key === 'x' || event.key === 'X') {
        loadNextModel(1);
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
      if (shouldSuppressGlobalShortcuts(event)) return;
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
        return;
      }

      if (event.key === 'ArrowLeft') {
        flightControlRef.current.turnLeftPressed = false;
        return;
      }

      if (event.key === 'ArrowRight') {
        flightControlRef.current.turnRightPressed = false;
      }
    };

    // ── Attach listeners and start ──────────────────────────────────────────
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    gl.domElement.addEventListener('pointerdown', onPointerDown);
    gl.domElement.addEventListener('pointermove', onPointerMove);
    gl.domElement.addEventListener('pointerup', onPointerEnd);
    gl.domElement.addEventListener('pointercancel', onPointerEnd);

    loadDefaultModel();
    syncEffectSnapshot();
    applySceneAppearance();

    // ── Cleanup ─────────────────────────────────────────────────────────────
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
      if (oceanRef.current) {
        scene.remove(oceanRef.current);
        oceanRef.current.geometry.dispose();
        oceanRef.current.material.dispose();
      }
      if (cloudFieldRef.current) {
        scene.remove(cloudFieldRef.current);
        cloudFieldRef.current.traverse((child) => {
          if (child.isSprite) {
            child.material.dispose();
          }
        });
        cloudFieldRef.current.userData.texture?.dispose?.();
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

  // ── Per-frame animation loop ──────────────────────────────────────────────

  useFrame((_, delta) => {
    const elapsed = clockRef.current.getElapsedTime();
    const boostVisualState = boostVisualStateRef.current;
    const boostShakeOffset = boostVisualState.lastShakeOffset;
    const shouldPauseForegroundEffects = autopilot.active || flightState.boost;

    if (foregroundEffectsPausedRef.current !== shouldPauseForegroundEffects) {
      foregroundEffectsPausedRef.current = shouldPauseForegroundEffects;
      setForegroundEffectsPaused(shouldPauseForegroundEffects);
    }

    // Sync autopilot boost → visual effect stack so minimap click-to-fly
    // triggers the same spacebar effects (FOV, shake, shimmer).
    if (flightState.boost && !stateRef.current.animationSpeedBoostEnabled) {
      setAnimationSpeedBoost(true);
    } else if (!flightState.boost && stateRef.current.animationSpeedBoostEnabled) {
      setAnimationSpeedBoost(false);
    }

    const currentModel = getCurrentModelDef();
    const sr71BoostMotionScale = (
      supportsAnimationSpeedBoost()
      && stateRef.current.animationSpeedBoostEnabled
      && currentModel?.name === 'SR-71'
      && Number.isFinite(currentModel.realisticBoostSpeedMps)
    )
      ? (currentModel.realisticBoostSpeedMps * CESIUM_TERRAIN_SCENE_SCALE) / TERRAIN_SCROLL_SPEED
      : null;
    const boostTarget = (
      supportsAnimationSpeedBoost() && stateRef.current.animationSpeedBoostEnabled
    ) ? 1 : 0;

    if (boostShakeOffset.lengthSq() > 0) {
      camera.position.sub(boostShakeOffset);
      boostShakeOffset.set(0, 0, 0);
    }

    applyPendingTeleport();

    // ── Camera follow ───────────────────────────────────────────────────
    const planeGeoAnchor = monolithRef.current?.userData.monolithGeoAnchor;
    const planePos = planeGeoAnchor instanceof THREE.Vector3
      ? framePlanePositionScratch.copy(planeGeoAnchor)
      : monolithRef.current
        ? framePlanePositionScratch.copy(monolithRef.current.position)
        : framePlanePositionScratch.set(0, 0, 0);
    if (monolithRef.current) {
      monolithRef.current.localToWorld(planePos);
    }
    const camRadius = 22;
    const camBaseY = 7.0;
    // Chase-cam lag: swing toward the outside of the turn as the plane banks,
    // and lean the view slightly into the bank. bankOffset is already smoothed
    // so both effects ease in and out with the aircraft lean.
    const bankOffsetNow = flightControlRef.current.bankOffset;
    const targetCamX = planePos.x - bankOffsetNow * CAMERA_TURN_SWAY_FACTOR;
    const targetCamZ = planePos.z + camRadius;
    const targetCamY = planePos.y + camBaseY;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, delta * 6);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, delta * 6);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCamY, delta * 4);

    const targetLookY = planePos.y + 2.5;
    if (controlsRef.current) {
      controlsRef.current.target.x = THREE.MathUtils.lerp(controlsRef.current.target.x, planePos.x, delta * 6);
      controlsRef.current.target.z = THREE.MathUtils.lerp(controlsRef.current.target.z, planePos.z, delta * 6);
      controlsRef.current.target.y = THREE.MathUtils.lerp(controlsRef.current.target.y, targetLookY, delta * 4);
    }
    // Roll the camera with the bank by tilting its up vector — OrbitControls'
    // lookAt picks this up each update, and it returns to level as bankOffset
    // lerps back to zero.
    const cameraRoll = -bankOffsetNow * CAMERA_TURN_ROLL_FACTOR;
    camera.up.set(Math.sin(cameraRoll), Math.cos(cameraRoll), 0);
    controlsRef.current?.update();
    mixerRef.current?.update(delta);
    materialManagerRef.current?.updateXrayAnimation(elapsed);

    // ── Boost visual intensity ──────────────────────────────────────────
    boostVisualState.intensity = THREE.MathUtils.lerp(
      boostVisualState.intensity,
      boostTarget,
      delta * BOOST_SHAKE_LERP_SPEED,
    );

    // ── Flight controls ─────────────────────────────────────────────────
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

    // Background rotation uses turnDirection; currently left must increase yaw to move background right.
    const manualTurnDirection = Number(flightControl.turnLeftPressed) - Number(flightControl.turnRightPressed);
    const autopilotTargetWorldYaw = -Math.PI / 2 - flightState.heading;
    const autopilotWorldYawDelta = getShortestAngleDelta(
      autopilotTargetWorldYaw,
      flightControl.worldYaw,
    );
    const autopilotTurnDirection = (
      autopilot.active
      && manualTurnDirection === 0
      && Math.abs(autopilotWorldYawDelta) > 0.0001
      && delta > 0
    )
      ? THREE.MathUtils.clamp(autopilotWorldYawDelta / (1.4 * delta), -1, 1)
      : 0;
    const turnDirection = manualTurnDirection || autopilotTurnDirection;

    // worldYaw accumulates freely — drives sky/ocean so sun can be placed anywhere
    flightControl.worldYaw += turnDirection * 1.4 * delta;

    // Plane model yaw: small transient lean, returns to neutral on release
    flightControl.targetYawOffset = turnDirection * 0.18;
    flightControl.yawOffset = THREE.MathUtils.lerp(flightControl.yawOffset, flightControl.targetYawOffset, delta * 5);
    flightControl.bankOffset = THREE.MathUtils.lerp(flightControl.bankOffset, -turnDirection * 0.38, delta * 5);

    applyMonolithTransform();

    // ── Nav lights (after transform so flightState lat/lon is fresh) ────
    updateNavLights(monolithRef.current, elapsed);

    // ── Exposure & FOV ──────────────────────────────────────────────────
    const targetExposure = guiParamsRef.current.exposure * (
      effectSnapshot.cinematicEnabled ? CINEMATIC_EXPOSURE_MULTIPLIER : 1
    );
    gl.toneMappingExposure = THREE.MathUtils.lerp(
      gl.toneMappingExposure,
      targetExposure,
      delta * 6,
    );

    const targetFov = THREE.MathUtils.lerp(
      BASE_CAMERA_FOV,
      BOOST_CAMERA_FOV,
      boostVisualState.intensity,
    );
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, delta * BOOST_FOV_LERP_SPEED);
    camera.updateProjectionMatrix();

    // ── Camera shake ────────────────────────────────────────────────────
    // Ambient turbulence keeps a faint shake during normal flight; boost
    // ramps it up through the same offset.
    const shakeIntensity = boostVisualState.intensity + AMBIENT_SHAKE_INTENSITY;
    if (shakeIntensity > 0.001) {
      boostShakeOffset.set(
        (Math.sin(elapsed * 23.0) + Math.sin(elapsed * 41.0 + 0.8)) * BOOST_SHAKE_X_AMPLITUDE * shakeIntensity,
        (Math.sin(elapsed * 31.0 + 1.2) + Math.sin(elapsed * 53.0)) * BOOST_SHAKE_Y_AMPLITUDE * shakeIntensity,
        (Math.sin(elapsed * 19.0 + 0.3) + Math.sin(elapsed * 47.0 + 2.4)) * BOOST_SHAKE_Z_AMPLITUDE * shakeIntensity,
      );
      camera.position.add(boostShakeOffset);
    }

    // ── Sky dome ────────────────────────────────────────────────────────
    if (skyDomeRef.current) {
      skyDomeRef.current.position.copy(camera.position);
      skyDomeRef.current.material.uniforms.time.value = elapsed;
      skyDomeRef.current.material.uniforms.yaw.value = flightControlRef.current.worldYaw;
    }

    // ── Ocean ───────────────────────────────────────────────────────────
    if (OCEAN_ENABLED && oceanRef.current) {
      const oceanSpeed = CLOUD_SCROLL_SPEED * (
        sr71BoostMotionScale ?? (1 + boostVisualState.intensity * 1.8)
      );
      oceanRef.current.material.uniforms.scrollOffset.value += oceanSpeed * delta;
      oceanRef.current.material.uniforms.time.value = elapsed;
      oceanRef.current.material.uniforms.yaw.value = flightControlRef.current.worldYaw;
      oceanRef.current.material.uniforms.cameraPos.value.copy(camera.position);
    }

    // ── Cloud field ─────────────────────────────────────────────────────
    if (CLOUDS_ENABLED && cloudFieldRef.current) {
      let densityAccumulator = 0;
      const monolithY = monolithRef.current?.position.y ?? 0;
      const cloudSpeed = CLOUD_SCROLL_SPEED * (
        sr71BoostMotionScale ?? (1 + boostVisualState.intensity * 1.8)
      );
      const deltaYaw = flightControl.worldYaw - flightControl.lastWorldYaw;

      cloudFieldRef.current.children.forEach((cloud) => {
        cloud.position.applyAxisAngle(FRAME_Y_AXIS, -deltaYaw);
        cloud.position.z += cloudSpeed * cloud.userData.scrollSpeed * delta;
        if (cloud.position.z > 22) {
          randomizeCloudSprite(
            cloud,
            cloud.userData.layerIndex ?? 0,
            -(CLOUD_FIELD_DEPTH + (Math.random() * 28)),
          );
        }

        const zCloseness = 1 - THREE.MathUtils.smoothstep(8, 36, Math.abs(cloud.position.z));
        const yCloseness = 1 - THREE.MathUtils.smoothstep(2.5, 11.5, Math.abs(cloud.position.y - monolithY));
        const sizeWeight = THREE.MathUtils.clamp(cloud.scale.y / 26, 0.2, 1);
        densityAccumulator += zCloseness * yCloseness * cloud.material.opacity * sizeWeight;
      });

      const targetDensity = THREE.MathUtils.clamp(densityAccumulator * 0.16, 0, 1);
      cloudStateRef.current.density = THREE.MathUtils.lerp(
        cloudStateRef.current.density,
        targetDensity,
        delta * 2.2,
      );
      cloudStateRef.current.ambientFactor = THREE.MathUtils.lerp(
        1,
        CLOUD_AMBIENT_MIN_FACTOR,
        cloudStateRef.current.density,
      );
    } else {
      cloudStateRef.current.density = THREE.MathUtils.lerp(cloudStateRef.current.density, 0, delta * 2.2);
      cloudStateRef.current.ambientFactor = THREE.MathUtils.lerp(cloudStateRef.current.ambientFactor, 1, delta * 2.2);
    }


    // ── Terrain scrolling ───────────────────────────────────────────────
    if (TERRAIN_ENABLED && terrainTilesRef.current.length > 0) {
      const scrollSpeed = TERRAIN_SCROLL_SPEED * (
        sr71BoostMotionScale ?? (1 + boostVisualState.intensity * 2.6)
      );
      const wrapThreshold = TERRAIN_TILE_LENGTH * 0.75;
      let furthestBackZ = Infinity;
      let furthestBackLogicalZ = Infinity;

      terrainTilesRef.current.forEach((tile) => {
        furthestBackZ = Math.min(furthestBackZ, tile.position.z);
        furthestBackLogicalZ = Math.min(
          furthestBackLogicalZ,
          tile.userData.logicalZOffset ?? tile.position.z,
        );
      });

      const deltaYaw = flightControl.worldYaw - flightControl.lastWorldYaw;
      
      terrainTilesRef.current.forEach((tile) => {
        tile.position.applyAxisAngle(FRAME_Y_AXIS, -deltaYaw);
        tile.position.z += scrollSpeed * delta;
        if (tile.position.z > wrapThreshold) {
          const nextRenderZOffset = furthestBackZ - TERRAIN_TILE_LENGTH;
          const nextLogicalZOffset = furthestBackLogicalZ - TERRAIN_TILE_LENGTH;
          disposeTerrainTileContents(tile);
          populateTerrainTile(tile, {
            renderZOffset: nextRenderZOffset,
            logicalZOffset: nextLogicalZOffset,
          });
          furthestBackZ = nextRenderZOffset;
          furthestBackLogicalZ = nextLogicalZOffset;
        }
      });
    }

    // ── Heat shimmer ────────────────────────────────────────────────────
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

    // ── Hue cycle ───────────────────────────────────────────────────────
    if (stateRef.current.hueCycleEnabled) {
      guiParamsRef.current.hue = getHueCycleHue(
        stateRef.current.hueCycleBaseHue,
        stateRef.current.hueCycleStartTime,
        elapsed,
      );
      guiParamsRef.current.saturation = 1;
    }

    // ── Lighting ────────────────────────────────────────────────────────
    if (stateRef.current.lightingMode === LIGHTING_MODE_SCENE) {
      lightingRigRef.current?.updateSceneLighting({
        forceRefresh: effectSnapshot.cinematicEnabled && effectSnapshot.bloomEnabled,
      });
    }

    if (effectSnapshot.cinematicEnabled && effectSnapshot.bloomEnabled) {
      lightingRigRef.current?.animateBloomRing();
    }

    // ── Sync last yaw for next frame delta ──────────────────────────────
    flightControl.lastWorldYaw = flightControl.worldYaw;
  });

  return (
    <SharedEffectStack
      {...effectSnapshot}
      paused={foregroundEffectsPaused}
    />
  );
}

// ── MonolithCanvas wrapper ──────────────────────────────────────────────────────

export default function MonolithCanvas() {
  return (
    <SafeCanvas
      dpr={0.75}
      rendererOptions={{ antialias: false, alpha: true }}
      sceneLabel="Monolith"
      showFrameRateOverlay
      style={{ position: 'fixed', inset: 0, zIndex: 1 }}
    >
      <Suspense fallback={null}>
        <MonolithScene />
      </Suspense>
    </SafeCanvas>
  );
}
