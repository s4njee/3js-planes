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

  return {
    barrelBlurAmount: guiParams.barrelBlurAmount,
    barrelBlurEnabled: guiParams.barrelBlurEnabled,
    barrelBlurOffsetX: guiParams.barrelBlurOffsetX,
    barrelBlurOffsetY: guiParams.barrelBlurOffsetY,
    bloomEnabled: guiParams.bloomEnabled,
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
    cinematicEnabled: state.currentFx === SHARED_FX_CINEMATIC,
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
  const heatShimmerRef = useRef(null);
  const stateRef = useRef(createInitialMonolithState());
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

    document.body.style.background = effectiveWhiteMode ? 'white' : '#111111';
    scene.environment = null;
    scene.background = currentSetDef().nullBackground
      ? null
      : new THREE.Color(effectiveWhiteMode ? 0xffffff : 0x111111);
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

  const swapModel = (model, name, animations) => {
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }

    scene.remove(monolithRef.current);
    model.rotation.set(
      guiParamsRef.current.modelRotationX,
      guiParamsRef.current.modelRotationY,
      guiParamsRef.current.modelRotationZ
    );
    monolithRef.current = model;
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
    scene.background = new THREE.Color(0x111111);
    document.body.style.background = '#111111';

    camera.fov = 45;
    camera.near = 0.1;
    camera.far = 100;
    camera.position.set(0, 2.5, 14);
    camera.updateProjectionMatrix();

    gl.setPixelRatio(window.devicePixelRatio);
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.4;
    gl.domElement.style.position = 'relative';
    gl.domElement.style.zIndex = '1';
    gl.domElement.style.transition = 'opacity 0.6s';
    gl.domElement.style.opacity = '0';

    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 2.5, 0);
    controls.enableDamping = true;
    controls.update();
    controlsRef.current = controls;

    materialManagerRef.current = createMaterialManager(gl);

    scene.add(monolithRef.current);

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
    
    const meshLeft = new THREE.Mesh(shimmerGeoLeft, shimmerMat);
    const meshRight = new THREE.Mesh(shimmerGeoRight, shimmerMat);
    shimmerGroup.add(meshLeft);
    shimmerGroup.add(meshRight);

    scene.add(shimmerGroup);
    heatShimmerRef.current = shimmerGroup;

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
      onEffectSettingsChange: syncEffectSnapshot,
      onTriggerGlitch: () => syncEffectSnapshot({ triggerGlitch: true }),
      onModelRotationChange: () => {
        if (monolithRef.current) {
          monolithRef.current.rotation.set(
            guiParamsRef.current.modelRotationX,
            guiParamsRef.current.modelRotationY,
            guiParamsRef.current.modelRotationZ
          );
        }
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
        stateRef.current.animationSpeedBoostEnabled = true;
        syncAnimationMixerSpeed();
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const models = currentModels();
        if (!models.length) return;

        const currentIndex = stateRef.current.currentModelIndex >= 0
          ? stateRef.current.currentModelIndex
          : (currentSetDef().defaultModel ?? 0);
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (currentIndex + direction + models.length) % models.length;
        loadModel(nextIndex);
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
      if (event.code !== 'Space' || !supportsAnimationSpeedBoost()) return;
      stateRef.current.animationSpeedBoostEnabled = false;
      syncAnimationMixerSpeed();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    loadDefaultModel();
    syncEffectSnapshot();
    applySceneAppearance();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      controls.dispose();
      guiControlsRef.current?.destroy();
      uiRef.current?.destroy();
      overlaysRef.current?.destroy();
      progressContainer.remove();
      scene.remove(monolithRef.current);
      if (heatShimmerRef.current) {
        scene.remove(heatShimmerRef.current);
        heatShimmerRef.current.children.forEach((child) => {
          child.geometry.dispose();
          // The material is shared so this disposes it twice, but Three handles it safely
          child.material.dispose();
        });
      }
      scene.environment = null;
      scene.background = null;
      dracoLoader.dispose();
      mixerRef.current?.stopAllAction();
    };
  }, [camera, gl, scene]);

  // ── Per-frame animation loop ─────────────────────────────────────────────────────────

  useFrame((_, delta) => {
    const elapsed = clockRef.current.getElapsedTime();

    controlsRef.current?.update();
    mixerRef.current?.update(delta);
    materialManagerRef.current?.updateXrayAnimation(elapsed);

    if (heatShimmerRef.current && heatShimmerRef.current.children.length === 2) {
      const isEligibleModel = stateRef.current.currentModelIndex === 0 || stateRef.current.currentModelIndex === 1;
      const isBoosting = isEligibleModel && stateRef.current.animationSpeedBoostEnabled && supportsAnimationSpeedBoost();
      
      const leftMesh = heatShimmerRef.current.children[0];
      const rightMesh = heatShimmerRef.current.children[1];
      const mat = leftMesh.material;
      
      const currentIntensity = mat.uniforms.boostIntensity.value;
      const targetIntensity = isBoosting ? 1.0 : 0.0;
      
      mat.uniforms.boostIntensity.value = THREE.MathUtils.lerp(currentIntensity, targetIntensity, delta * 10);
      mat.uniforms.time.value = elapsed;
      
      heatShimmerRef.current.visible = mat.uniforms.boostIntensity.value > 0.01;
      
      leftMesh.position.set(
        guiParamsRef.current.shimmerOffsetX,
        guiParamsRef.current.shimmerOffsetY,
        guiParamsRef.current.shimmerOffsetZ
      );
      rightMesh.position.set(
        guiParamsRef.current.shimmerOffsetX,
        guiParamsRef.current.shimmerOffsetY,
        -guiParamsRef.current.shimmerOffsetZ
      );
      
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
  const dpr = useMemo(() => [1, Math.min(window.devicePixelRatio, 2)], []);

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
