import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import GUI from 'lil-gui';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { TilesRenderer, CAMERA_FRAME } from '3d-tiles-renderer';
import { CesiumIonAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { GLTFExtensionsPlugin, TilesFadePlugin, UpdateOnChangePlugin } from '3d-tiles-renderer/three/plugins';
import { EffectMaterial, EffectPass, NormalPass, SMAAEffect } from 'postprocessing';
import {
  CloudsEffect,
  CLOUD_SHAPE_TEXTURE_SIZE,
  CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
  DEFAULT_LOCAL_WEATHER_URL,
  DEFAULT_SHAPE_URL,
  DEFAULT_SHAPE_DETAIL_URL,
  DEFAULT_TURBULENCE_URL,
} from '@takram/three-clouds';
import { AerialPerspectiveEffect, PrecomputedTexturesGenerator, getSunDirectionECEF } from '@takram/three-atmosphere';
import { STBNLoader, DEFAULT_STBN_URL } from '@takram/three-geospatial';
import { DitheringEffect, LensFlareEffect } from '@takram/three-geospatial-effects';
import { resolveAssetUrl } from './monolith/asset-url.js';
import { flightState, tickAutopilot, cancelAutopilot, requestAutopilot, autopilot } from './flight-store.js';
import CitySearch from './CitySearch.jsx';
import { shouldSuppressGlobalShortcuts } from './keyboard-shortcuts.js';
import { publishBackgroundPerformanceSnapshot } from './shared/performance/index.ts';

const ION_KEY = import.meta.env.VITE_CESIUM_ION_TOKEN;
const DEG2RAD = Math.PI / 180;
const MIN_BACKGROUND_DPR = 0.75;
const MEDIUM_BACKGROUND_DPR = 0.75;
const MAX_BACKGROUND_DPR = 0.75;
const BACKGROUND_DPR_EPSILON = 0.01;
const BACKGROUND_DPR_SUSTAIN_MS = 2500;
const BACKGROUND_QUALITY_HIGH = 'high';
const BACKGROUND_QUALITY_MEDIUM = 'medium';
const BACKGROUND_QUALITY_LOW = 'low';
const BACKGROUND_QUALITY_SAMPLE_SIZE = 90;
const BACKGROUND_QUALITY_SUSTAIN_MS = 1800;
const BACKGROUND_QUALITY_HIGH_FPS = 52;
const BACKGROUND_QUALITY_MEDIUM_FPS = 38;
const BACKGROUND_STATS_PUBLISH_INTERVAL_MS = 400;
const BACKGROUND_CLOUD_SHADOW_HIGH = Object.freeze({
  cascadeCount: 1,
  mapSize: 256,
});
const BACKGROUND_CLOUD_SHADOW_MEDIUM = Object.freeze({
  cascadeCount: 1,
  mapSize: 256,
});
const BACKGROUND_CLOUD_SHADOW_LOW = Object.freeze({
  cascadeCount: 1,
  mapSize: 256,
});
const BACKGROUND_CLOUD_COVERAGE_DEFAULT = 0.18;
const BACKGROUND_CLOUD_COVERAGE_LOW = 0.15;
const BACKGROUND_CLOUD_SHADOW_MAX_FAR_DEFAULT = 5e4;
const BACKGROUND_CLOUD_SHADOW_MAX_FAR_LOW = 4e4;

// Hysteresis gap: require higher FPS to promote than to demote.
// This prevents oscillation when the GPU is right at the boundary.
const BACKGROUND_QUALITY_PROMOTE_HIGH_FPS = 58;
const BACKGROUND_QUALITY_DEMOTE_MEDIUM_FPS = 38;

function getDevicePixelRatio() {
  if (!Number.isFinite(window.devicePixelRatio) || window.devicePixelRatio <= 0) {
    return 1;
  }

  return window.devicePixelRatio;
}

function roundBackgroundDpr(value) {
  return Math.round(value * 100) / 100;
}

function clampBackgroundDpr(value) {
  return roundBackgroundDpr(Math.min(Math.max(value, MIN_BACKGROUND_DPR), MAX_BACKGROUND_DPR));
}

function getBackgroundDprSteps() {
  const initialDpr = clampBackgroundDpr(getDevicePixelRatio());
  const mediumDpr = clampBackgroundDpr(MEDIUM_BACKGROUND_DPR);
  const lowDpr = clampBackgroundDpr(MIN_BACKGROUND_DPR);

  return [initialDpr, mediumDpr, lowDpr].filter((value, index, values) => (
    values.findIndex((candidate) => Math.abs(candidate - value) < BACKGROUND_DPR_EPSILON) === index
  ));
}

function getBackgroundQualityForFps(fps, currentQuality) {
  // Hysteresis: require a higher FPS to promote than to demote.
  // This prevents the quality from oscillating when GPU load is near a boundary.
  if (currentQuality === BACKGROUND_QUALITY_LOW) {
    // Need to sustain well above medium threshold to promote
    if (fps >= BACKGROUND_QUALITY_DEMOTE_MEDIUM_FPS + 6) return BACKGROUND_QUALITY_MEDIUM;
    return BACKGROUND_QUALITY_LOW;
  }
  if (currentQuality === BACKGROUND_QUALITY_MEDIUM) {
    if (fps >= BACKGROUND_QUALITY_PROMOTE_HIGH_FPS) return BACKGROUND_QUALITY_HIGH;
    if (fps < BACKGROUND_QUALITY_DEMOTE_MEDIUM_FPS) return BACKGROUND_QUALITY_LOW;
    return BACKGROUND_QUALITY_MEDIUM;
  }
  // currentQuality === high
  if (fps < BACKGROUND_QUALITY_DEMOTE_MEDIUM_FPS) return BACKGROUND_QUALITY_LOW;
  if (fps < BACKGROUND_QUALITY_PROMOTE_HIGH_FPS - 4) return BACKGROUND_QUALITY_MEDIUM;
  return BACKGROUND_QUALITY_HIGH;
}

export default function TilesBackgroundCanvas() {
  const canvasRef = useRef(null);
  const teleportRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    let animId;
    let prevTime = 0;
    let deltaTime = 0;
    let backgroundQuality = BACKGROUND_QUALITY_HIGH;
    let backgroundDpr = clampBackgroundDpr(getDevicePixelRatio());
    const backgroundDprSteps = getBackgroundDprSteps();
    let qualityCandidate = null;
    let qualityCandidateSince = 0;
    let dprCandidate = null;
    let dprCandidateSince = 0;
    let lastStatsPublishTime = 0;
    let frameTimeTotal = 0;
    const frameTimeSamples = [];

    // Sun direction throttle (perf idea J) — only recompute when longitude
    // changes by ~0.5° (~0.0087 rad), saving Date allocation + trig per frame.
    let lastSunLon = flightState.lon;
    const SUN_LON_THRESHOLD = 0.0087; // ~0.5 degrees in radians

    // Idle half-rate rendering (perf idea O) — when no input and no autopilot,
    // skip every other background frame since the scene is effectively static.
    let idleFrameSkip = false;

    // renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      outputBufferType: THREE.HalfFloatType,
      antialias: true,
    });
    renderer.setPixelRatio(backgroundDpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 10;

    // camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 10, 1e6);

    // scene
    const scene = new THREE.Scene();

    // draco
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(resolveAssetUrl('/draco/'));

    // tiles
    class TileCreasedNormalsPlugin {
      processTileModel(scene) {
        scene.traverse((mesh) => {
          if (mesh.geometry) {
            mesh.geometry = toCreasedNormals(mesh.geometry, 30 * DEG2RAD);
          }
        });
      }
    }

    const tiles = new TilesRenderer();
    tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: ION_KEY, assetId: '2275207', autoRefreshToken: true }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader }));
    tiles.registerPlugin(new TileCreasedNormalsPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    // Scale tile LOD error target with DPR (perf idea K) — at lower DPR,
    // accept coarser tiles since the resolution hides the difference.
    if (tiles.errorTarget !== undefined) {
      tiles.errorTarget = 6 / backgroundDpr;
    }
    scene.add(tiles.group);

    // flightState is module-shared (see flight-store.js) so the minimap and
    // search widget can share a single location without prop drilling.
    const ALT_MIN = 500, ALT_MAX = 3500;
    const FLIGHT_SPEED = 0.00004;
    const TURN_SPEED = 0.8;

    const onKeyDown = (e) => {
      if (shouldSuppressGlobalShortcuts(e)) return;
      // Any manual input cancels autopilot so the pilot stays in control
      cancelAutopilot();
      if (e.code === 'Space') flightState.boost = true;
      if (e.code === 'ArrowLeft') flightState.left = true;
      if (e.code === 'ArrowRight') flightState.right = true;
      if (e.code === 'ArrowUp') flightState.up = true;
      if (e.code === 'ArrowDown') flightState.down = true;
    };
    const onKeyUp = (e) => {
      if (shouldSuppressGlobalShortcuts(e)) return;
      if (e.code === 'Space') flightState.boost = false;
      if (e.code === 'ArrowLeft') flightState.left = false;
      if (e.code === 'ArrowRight') flightState.right = false;
      if (e.code === 'ArrowUp') flightState.up = false;
      if (e.code === 'ArrowDown') flightState.down = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const updateCamera = () => {
      tiles.ellipsoid.getObjectFrame(
        flightState.lat, flightState.lon, flightState.alt,
        flightState.heading, -10 * DEG2RAD, 0,
        camera.matrix, CAMERA_FRAME,
      );
      camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    };

    const teleportTo = ({ lat, lon }) => {
      requestAutopilot({ lat, lon });
    };

    teleportRef.current = teleportTo;
    updateCamera();

    // GUI
    let cloudQualityOverride = 'auto'; // 'auto' | 'high' | 'low' | 'off'
    const gui = new GUI({ title: 'Flight Controls' });
    gui.hide();
    const posFolder = gui.addFolder('Position');
    posFolder.add(flightState, 'alt', ALT_MIN, ALT_MAX, 1).name('Altitude (m)').onChange(updateCamera);
    const latProxy = { v: flightState.lat / DEG2RAD };
    posFolder.add(latProxy, 'v', -85, 85, 0.0001).name('Latitude °').onChange(v => { flightState.lat = v * DEG2RAD; updateCamera(); });
    const lonProxy = { v: flightState.lon / DEG2RAD };
    posFolder.add(lonProxy, 'v', -180, 180, 0.0001).name('Longitude °').onChange(v => { flightState.lon = v * DEG2RAD; updateCamera(); });
    const speedProxy = { v: FLIGHT_SPEED };
    gui.add(speedProxy, 'v', 0, 0.001, 0.000001).name('Speed').onChange(v => { flightState._speed = v; });
    const headingProxy = { v: flightState.heading / DEG2RAD };
    gui.add(headingProxy, 'v', -180, 180, 0.1).name('Heading °').onChange(v => { flightState.heading = v * DEG2RAD; updateCamera(); });
    gui.add({ v: 10 }, 'v', 1, 30, 0.1).name('Exposure').onChange(v => { renderer.toneMappingExposure = v; });

    // Manual cloud quality: High / Low / Off. Auto path never jumps to Off.
    const cloudQualityProxy = { v: 'auto' };
    gui.add(cloudQualityProxy, 'v', ['auto', 'high', 'low', 'off']).name('Cloud Quality').onChange(v => {
      cloudQualityOverride = v;
      if (v === 'high') {
        clouds.coverage = BACKGROUND_CLOUD_COVERAGE_DEFAULT;
        clouds.shadow.cascadeCount = BACKGROUND_CLOUD_SHADOW_HIGH.cascadeCount;
        clouds.shadow.mapSize.set(BACKGROUND_CLOUD_SHADOW_HIGH.mapSize, BACKGROUND_CLOUD_SHADOW_HIGH.mapSize);
        clouds.shadow.maxFar = BACKGROUND_CLOUD_SHADOW_MAX_FAR_DEFAULT;
      } else if (v === 'low') {
        clouds.coverage = BACKGROUND_CLOUD_COVERAGE_LOW;
        clouds.shadow.cascadeCount = BACKGROUND_CLOUD_SHADOW_LOW.cascadeCount;
        clouds.shadow.mapSize.set(BACKGROUND_CLOUD_SHADOW_LOW.mapSize, BACKGROUND_CLOUD_SHADOW_LOW.mapSize);
        clouds.shadow.maxFar = BACKGROUND_CLOUD_SHADOW_MAX_FAR_LOW;
      } else if (v === 'off') {
        clouds.coverage = 0;
      } else {
        // auto — re-apply current automatic tier
        applyBackgroundQuality(backgroundQuality);
      }
    });

    // sun
    const sunDirection = new THREE.Vector3();

    const updateSunDirection = () => {
      // Use local solar noon: offset UTC so the sun is overhead at the current longitude
      const lonDeg = flightState.lon / DEG2RAD;
      const localNoonUTC = 12 - lonDeg / 15; // hours
      const date = new Date(Date.UTC(2024, 2, 1) + localNoonUTC * 3600000);
      getSunDirectionECEF(date, sunDirection);
      aerialPerspective.sunDirection.copy(sunDirection);
      clouds.sunDirection.copy(sunDirection);
    };

    // aerial perspective
    const aerialPerspective = new AerialPerspectiveEffect(camera);
    aerialPerspective.sky = true;
    aerialPerspective.sunLight = true;
    aerialPerspective.skyLight = true;

    const normalPass = new NormalPass(scene, camera);
    aerialPerspective.normalBuffer = normalPass.texture;

    // clouds
    const clouds = new CloudsEffect(camera);
    clouds.coverage = BACKGROUND_CLOUD_COVERAGE_DEFAULT;
    clouds.localWeatherVelocity.set(0.001, 0);
    clouds.shadow.farScale = 0.25;
    clouds.shadow.maxFar = BACKGROUND_CLOUD_SHADOW_MAX_FAR_DEFAULT;
    clouds.shadow.cascadeCount = BACKGROUND_CLOUD_SHADOW_HIGH.cascadeCount;
    clouds.shadow.mapSize.set(
      BACKGROUND_CLOUD_SHADOW_HIGH.mapSize,
      BACKGROUND_CLOUD_SHADOW_HIGH.mapSize,
    );
    clouds.shadow.splitMode = 'practical';
    clouds.shadow.splitLambda = 0.71;

    clouds.events.addEventListener('change', (event) => {
      if (event.property === 'atmosphereOverlay') aerialPerspective.overlay = clouds.atmosphereOverlay;
      if (event.property === 'atmosphereShadow') aerialPerspective.shadow = clouds.atmosphereShadow;
      if (event.property === 'atmosphereShadowLength') aerialPerspective.shadowLength = clouds.atmosphereShadowLength;
    });

    // effect pass adapter
    class EffectPassAdapter {
      constructor(pass) {
        this.pass = pass;
        this.needsSwap = pass.needsSwap !== false;
        this.enabled = true;
        this._initialized = false;
      }

      render(renderer, writeBuffer, readBuffer) {
        if (!this._initialized) {
          this.pass.initialize(renderer, false, THREE.HalfFloatType);
          if (readBuffer) this.pass.setSize(readBuffer.width, readBuffer.height);
          if (readBuffer?.depthTexture && this.pass.setDepthTexture) {
            this.pass.setDepthTexture(readBuffer.depthTexture);
          }
          this._initialized = true;
        }
        if (this.pass.fullscreenMaterial instanceof EffectMaterial) {
          this.pass.fullscreenMaterial.adoptCameraSettings(camera);
        }
        this.pass.render(renderer, readBuffer, writeBuffer, deltaTime);
      }

      setSize(width, height) {
        if (this._initialized) this.pass.setSize(width, height);
      }
    }

    const effectAdapters = {
      normal: new EffectPassAdapter(normalPass),
      cloudsAtmosphere: new EffectPassAdapter(new EffectPass(camera, clouds, aerialPerspective)),
      lensFlare: new EffectPassAdapter(new EffectPass(camera, new LensFlareEffect())),
      smaa: new EffectPassAdapter(new EffectPass(camera, new SMAAEffect())),
      dithering: new EffectPassAdapter(new EffectPass(camera, new DitheringEffect())),
    };
    const effectStack = [
      effectAdapters.normal,
      effectAdapters.cloudsAtmosphere,
      effectAdapters.lensFlare,
      effectAdapters.smaa,
      effectAdapters.dithering,
    ];

    const applyBackgroundQuality = (quality) => {
      backgroundQuality = quality;
      effectAdapters.lensFlare.enabled = quality === BACKGROUND_QUALITY_HIGH;
      effectAdapters.smaa.enabled = quality !== BACKGROUND_QUALITY_LOW;

      // When a manual cloud override is active, skip automatic cloud adjustments
      if (cloudQualityOverride === 'auto') {
        if (quality === BACKGROUND_QUALITY_LOW) {
          // Low: slightly reduce coverage and shadow distance
          clouds.coverage = BACKGROUND_CLOUD_COVERAGE_LOW;
          clouds.shadow.maxFar = BACKGROUND_CLOUD_SHADOW_MAX_FAR_LOW;
        } else {
          // High/Medium: same lightweight cloud config — no oscillation
          clouds.coverage = BACKGROUND_CLOUD_COVERAGE_DEFAULT;
          clouds.shadow.maxFar = BACKGROUND_CLOUD_SHADOW_MAX_FAR_DEFAULT;
        }
        // Shadow quality stays constant across tiers to prevent FPS swings
        clouds.shadow.cascadeCount = BACKGROUND_CLOUD_SHADOW_HIGH.cascadeCount;
        clouds.shadow.mapSize.set(BACKGROUND_CLOUD_SHADOW_HIGH.mapSize, BACKGROUND_CLOUD_SHADOW_HIGH.mapSize);
      }

      renderer.setEffects(effectStack.filter((adapter) => adapter.enabled));
    };

    applyBackgroundQuality(backgroundQuality);

    const publishBackgroundStats = (fps, now) => {
      if (
        lastStatsPublishTime !== 0
        && now - lastStatsPublishTime < BACKGROUND_STATS_PUBLISH_INTERVAL_MS
      ) {
        return;
      }

      lastStatsPublishTime = now;
      publishBackgroundPerformanceSnapshot({
        dpr: backgroundDpr,
        fps,
        quality: backgroundQuality,
        sampleCount: frameTimeSamples.length,
      });
    };

    const applyBackgroundDpr = (nextDpr) => {
      if (Math.abs(backgroundDpr - nextDpr) < BACKGROUND_DPR_EPSILON) return;

      backgroundDpr = nextDpr;
      renderer.setPixelRatio(backgroundDpr);
      renderer.setSize(window.innerWidth, window.innerHeight);
      tiles.setResolutionFromRenderer(camera, renderer);
    };

    const updateBackgroundDpr = (fps, now) => {
      if (backgroundDprSteps.length <= 1) {
        dprCandidate = null;
        dprCandidateSince = 0;
        return;
      }

      const currentStepIndex = backgroundDprSteps.findIndex((step) => (
        Math.abs(step - backgroundDpr) < BACKGROUND_DPR_EPSILON
      ));
      const safeStepIndex = currentStepIndex === -1 ? 0 : currentStepIndex;
      const canStepDown = safeStepIndex < backgroundDprSteps.length - 1;
      const canStepUp = safeStepIndex > 0;
      const downThreshold = canStepDown
        ? (safeStepIndex === 0 && backgroundDprSteps.length > 2
          ? BACKGROUND_QUALITY_HIGH_FPS
          : BACKGROUND_QUALITY_MEDIUM_FPS)
        : null;
      const upThreshold = canStepUp
        ? (safeStepIndex === 1 && backgroundDprSteps.length > 2
          ? BACKGROUND_QUALITY_HIGH_FPS
          : BACKGROUND_QUALITY_MEDIUM_FPS)
        : null;
      const nextDpr = canStepDown && downThreshold !== null && fps < downThreshold
        ? backgroundDprSteps[safeStepIndex + 1]
        : canStepUp && upThreshold !== null && fps >= upThreshold
          ? backgroundDprSteps[safeStepIndex - 1]
          : null;

      if (nextDpr === null) {
        dprCandidate = null;
        dprCandidateSince = 0;
        return;
      }

      if (dprCandidate !== nextDpr) {
        dprCandidate = nextDpr;
        dprCandidateSince = now;
        return;
      }

      if (now - dprCandidateSince < BACKGROUND_DPR_SUSTAIN_MS) {
        return;
      }

      dprCandidate = null;
      dprCandidateSince = 0;
      applyBackgroundDpr(nextDpr);
    };

    const updateBackgroundPerformance = (frameTimeMs, now) => {
      if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) return;

      frameTimeSamples.push(frameTimeMs);
      frameTimeTotal += frameTimeMs;

      if (frameTimeSamples.length > BACKGROUND_QUALITY_SAMPLE_SIZE) {
        const oldestFrameTime = frameTimeSamples.shift();
        if (oldestFrameTime !== undefined) {
          frameTimeTotal -= oldestFrameTime;
        }
      }

      if (frameTimeSamples.length < Math.min(30, BACKGROUND_QUALITY_SAMPLE_SIZE)) {
        return;
      }

      const averageFrameTime = frameTimeTotal / frameTimeSamples.length;
      const fps = averageFrameTime > 0 ? 1000 / averageFrameTime : 0;
      const nextQuality = getBackgroundQualityForFps(fps, backgroundQuality);
      updateBackgroundDpr(fps, now);
      publishBackgroundStats(fps, now);

      if (nextQuality === backgroundQuality) {
        qualityCandidate = null;
        qualityCandidateSince = 0;
        return;
      }

      if (qualityCandidate !== nextQuality) {
        qualityCandidate = nextQuality;
        qualityCandidateSince = now;
        return;
      }

      if (now - qualityCandidateSince < BACKGROUND_QUALITY_SUSTAIN_MS) {
        return;
      }

      qualityCandidate = null;
      qualityCandidateSince = 0;
      applyBackgroundQuality(nextQuality);
      publishBackgroundStats(fps, now);
    };

    // async init: precomputed textures + cloud textures
    (async () => {
      const texturesGenerator = new PrecomputedTexturesGenerator(renderer);
      const textures = await texturesGenerator.update();
      Object.assign(aerialPerspective, textures);
      Object.assign(clouds, textures);

      const textureLoader = new THREE.TextureLoader();
      const loadTex = (url, prop) => textureLoader.load(url, (t) => {
        t.minFilter = THREE.LinearMipMapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
        clouds[prop] = t;
      });
      loadTex(DEFAULT_LOCAL_WEATHER_URL, 'localWeatherTexture');
      loadTex(DEFAULT_TURBULENCE_URL, 'turbulenceTexture');

      const load3D = (url, size, prop) => fetch(url).then(r => r.arrayBuffer()).then(buf => {
        const t = new THREE.Data3DTexture(new Uint8Array(buf), size, size, size);
        t.format = THREE.RedFormat;
        t.minFilter = t.magFilter = THREE.LinearFilter;
        t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
        clouds[prop] = t;
      });
      load3D(DEFAULT_SHAPE_URL, CLOUD_SHAPE_TEXTURE_SIZE, 'shapeTexture');
      load3D(DEFAULT_SHAPE_DETAIL_URL, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, 'shapeDetailTexture');

      new STBNLoader().load(DEFAULT_STBN_URL, (t) => {
        clouds.stbnTexture = t;
        aerialPerspective.stbnTexture = t;
      });

      updateSunDirection();
    })();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(backgroundDpr);
      renderer.setSize(window.innerWidth, window.innerHeight);
      tiles.setResolutionFromRenderer(camera, renderer);
    };
    window.addEventListener('resize', onResize);

    const animate = (time) => {
      animId = requestAnimationFrame(animate);
      deltaTime = (time - prevTime) / 1000;
      prevTime = time;
      if (deltaTime > 0 && deltaTime < 1) {
        updateBackgroundPerformance(deltaTime * 1000, time);

        // Autopilot steers heading toward destination each frame
        tickAutopilot(deltaTime);

        if (flightState.left) flightState.heading -= TURN_SPEED * deltaTime;
        if (flightState.right) flightState.heading += TURN_SPEED * deltaTime;
        const speed = (flightState._speed ?? FLIGHT_SPEED) * (flightState.boost ? 10 : 1) * deltaTime;
        flightState.lon += Math.sin(flightState.heading) * speed;
        flightState.lat += Math.cos(flightState.heading) * speed;
        if (flightState.up) flightState.alt = Math.min(ALT_MAX, flightState.alt + 300 * deltaTime * (flightState.boost ? 10 : 1));
        if (flightState.down) flightState.alt = Math.max(ALT_MIN, flightState.alt - 300 * deltaTime * (flightState.boost ? 10 : 1));
        updateCamera();

        // Throttle sun direction to longitude-change threshold (perf idea J)
        if (Math.abs(flightState.lon - lastSunLon) > SUN_LON_THRESHOLD) {
          updateSunDirection();
          lastSunLon = flightState.lon;
        }
      }

      // Idle half-rate rendering (perf idea O) — skip every other frame
      // when the scene is effectively static (no input, no autopilot).
      const isIdle = !flightState.left && !flightState.right
        && !flightState.up && !flightState.down
        && !flightState.boost && !autopilot.active;
      if (isIdle) {
        idleFrameSkip = !idleFrameSkip;
        if (idleFrameSkip) {
          // Still update tiles for streaming, but skip the expensive render
          tiles.update();
          return;
        }
      } else {
        idleFrameSkip = false;
      }

      tiles.update();
      renderer.render(scene, camera);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      gui.destroy();
      tiles.dispose();
      dracoLoader.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }} />
      <CitySearch onSelectCity={(city) => {
        teleportRef.current?.(city);
      }} />
    </>
  );
}
