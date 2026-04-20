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
import { flightState, requestFlightTeleport } from './flight-store.js';
import { MODEL_SET_DEF } from './monolith/set-defs.js';
import CitySearch from './CitySearch.jsx';
import { shouldSuppressGlobalShortcuts } from './keyboard-shortcuts.js';

const ION_KEY = import.meta.env.VITE_CESIUM_ION_TOKEN;
const DEG2RAD = Math.PI / 180;

export default function TilesBackgroundCanvas() {
  const canvasRef = useRef(null);
  const teleportRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    let animId;
    let prevTime = 0;
    let deltaTime = 0;

    // renderer — try HalfFloat first, fall back to default if unsupported
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        outputBufferType: THREE.HalfFloatType,
        antialias: true,
      });
    } catch (_e) {
      console.warn('[TilesBackground] HalfFloatType not supported, falling back to default buffer');
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
      });
    }
    renderer.setPixelRatio(window.devicePixelRatio);
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
    scene.add(tiles.group);

    // flightState is module-shared (see flight-store.js) so the minimap and
    // search widget can share a single location without prop drilling.
    const ALT_MIN = 300, ALT_MAX = 26000;
    const EARTH_RADIUS_M = 6_371_000;
    const DEFAULT_SPEED_MPS = 255; // ~subsonic airliner fallback
    const TURN_SPEED = 0.8;

    /** Convert m/s to radians/s on the globe surface. */
    const mpsToRadPerSec = (mps) => mps / EARTH_RADIUS_M;

    /** Get the current model's cruise speed in rad/s. */
    const getFlightSpeed = () => {
      if (Number.isFinite(flightState._speedOverrideMps)) {
        return mpsToRadPerSec(flightState._speedOverrideMps);
      }
      const model = MODEL_SET_DEF.models[flightState.currentModelIndex];
      const mps = model?.speedMps ?? DEFAULT_SPEED_MPS;
      return mpsToRadPerSec(mps);
    };

    const onKeyDown = (e) => {
      if (shouldSuppressGlobalShortcuts(e)) return;
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

    const teleportTo = ({ lat, lon, label }) => {
      flightState.lat = lat * DEG2RAD;
      flightState.lon = lon * DEG2RAD;
      flightState.heading = -90 * DEG2RAD;
      flightState.alt = Math.max(ALT_MIN, flightState.alt);
      if (label) {
        flightState.cityRevealLabel = label;
        flightState.cityRevealVersion += 1;
      }
      requestFlightTeleport({
        lat: flightState.lat,
        lon: flightState.lon,
        alt: flightState.alt,
        heading: flightState.heading,
      });
      updateCamera();
      updateSunDirection();
    };

    const flyTo = ({ lat, lon, label }) => {
      flightState.targetLat = lat * DEG2RAD;
      flightState.targetLon = lon * DEG2RAD;
      flightState.boost = true;
      if (label) {
        flightState.cityRevealLabel = label;
        flightState.cityRevealVersion += 1;
      }
    };

    teleportRef.current = { teleportTo, flyTo };
    updateCamera();

    // GUI
    const gui = new GUI({ title: 'Flight Controls' });
    gui.hide();
    const posFolder = gui.addFolder('Position');
    posFolder.add(flightState, 'alt', ALT_MIN, ALT_MAX, 1).name('Altitude (m)').onChange(updateCamera);
    const latProxy = { v: flightState.lat / DEG2RAD };
    posFolder.add(latProxy, 'v', -85, 85, 0.0001).name('Latitude °').onChange(v => { flightState.lat = v * DEG2RAD; updateCamera(); });
    const lonProxy = { v: flightState.lon / DEG2RAD };
    posFolder.add(lonProxy, 'v', -180, 180, 0.0001).name('Longitude °').onChange(v => { flightState.lon = v * DEG2RAD; updateCamera(); });
    const speedProxy = { v: DEFAULT_SPEED_MPS };
    gui.add(speedProxy, 'v', 0, 1200, 1).name('Speed (m/s)').onChange(v => { flightState._speedOverrideMps = v; });
    const headingProxy = { v: flightState.heading / DEG2RAD };
    gui.add(headingProxy, 'v', -180, 180, 0.1).name('Heading °').onChange(v => { flightState.heading = v * DEG2RAD; updateCamera(); });
    gui.add({ v: 10 }, 'v', 1, 30, 0.1).name('Exposure').onChange(v => { altAtmo.baseExposure = v; });
    gui.add({ v: 0.3 }, 'v', 0, 1, 0.01).name('Cloud Coverage').onChange(v => { altAtmo.baseCoverage = v; });

    // sun
    const sunDirection = new THREE.Vector3();

    const updateSunDirection = () => {
      let date;
      if (flightState.sunDateOverride instanceof Date) {
        // Golden hour mode — use the override but recompute for current position
        // so the sun stays at the same visual elevation everywhere.
        date = flightState.sunDateOverride;
      } else {
        // Default: always local solar noon at the current position.
        // This keeps the sun high and the scene well-lit everywhere.
        const lonDeg = flightState.lon / DEG2RAD;
        const localNoonUTC = 12 - lonDeg / 15;
        date = new Date(Date.UTC(2024, 5, 21, Math.round(localNoonUTC)));
      }
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
    clouds.coverage = 0.3;
    clouds.localWeatherVelocity.set(0.001, 0);
    clouds.shadow.farScale = 0.25;
    clouds.shadow.maxFar = 1e5;
    clouds.shadow.cascadeCount = 2;
    clouds.shadow.mapSize.set(512, 512);
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

    if (typeof renderer.setEffects === 'function') {
      try {
        renderer.setEffects([
          new EffectPassAdapter(normalPass),
          new EffectPassAdapter(new EffectPass(camera, clouds, aerialPerspective)),
          new EffectPassAdapter(new EffectPass(camera, new LensFlareEffect())),
          new EffectPassAdapter(new EffectPass(camera, new SMAAEffect())),
          new EffectPassAdapter(new EffectPass(camera, new DitheringEffect())),
        ]);
      } catch (e) {
        console.warn('[TilesBackground] setEffects failed, rendering without post-processing:', e);
      }
    } else {
      console.warn('[TilesBackground] renderer.setEffects not available — post-processing disabled');
    }

    // async init: precomputed textures + cloud textures
    (async () => {
      try {
        const texturesGenerator = new PrecomputedTexturesGenerator(renderer);
        const textures = await texturesGenerator.update();
        Object.assign(aerialPerspective, textures);
        Object.assign(clouds, textures);
      } catch (e) {
        console.warn('[TilesBackground] Precomputed textures failed:', e);
      }

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
      renderer.setSize(window.innerWidth, window.innerHeight);
      tiles.setResolutionFromRenderer(camera, renderer);
    };
    window.addEventListener('resize', onResize);

    // ── Altitude-aware atmosphere state ────────────────────────────────────
    // Smoothed altitude value prevents flickering when alt changes rapidly.
    const altAtmo = {
      smoothAlt: flightState.alt,       // lerped toward flightState.alt each frame
      baseCoverage: 0.3,                // GUI-set cloud coverage baseline
      baseExposure: 10,                 // GUI-set exposure baseline
    };

    /** Map altitude to atmosphere parameters and apply them. */
    const updateAltitudeAtmosphere = (dt) => {
      // Smooth altitude toward the real value
      const lerpSpeed = 3.0;
      altAtmo.smoothAlt += (flightState.alt - altAtmo.smoothAlt) * Math.min(1, lerpSpeed * dt);

      const alt = altAtmo.smoothAlt;

      // Normalised altitude bands (metres)
      const tLow   = THREE.MathUtils.clamp((alt - 300) / 700, 0, 1);       // 300–1000m
      const tMid   = THREE.MathUtils.clamp((alt - 1000) / 4000, 0, 1);     // 1000–5000m
      const tHigh  = THREE.MathUtils.clamp((alt - 5000) / 10000, 0, 1);    // 5000–15000m
      const tSpace = THREE.MathUtils.clamp((alt - 15000) / 11000, 0, 1);   // 15000–26000m

      // Cloud coverage: thick at low alt, thins at high alt
      const coverageScale = 1.0 - tHigh * 0.6 - tSpace * 0.35;
      clouds.coverage = altAtmo.baseCoverage * Math.max(0.05, coverageScale);

      // Haze: dense near ground, fades with height
      const hazeValue = THREE.MathUtils.lerp(0.6, 0.0, tLow * 0.5 + tMid * 0.3 + tHigh * 0.2);
      if (clouds.haze !== undefined) clouds.haze = hazeValue;

      // Exposure: slightly brighter at altitude (thinner atmosphere)
      const exposureBoost = 1.0 + tMid * 0.15 + tHigh * 0.25 + tSpace * 0.1;
      renderer.toneMappingExposure = altAtmo.baseExposure * exposureBoost;
    };

    const animate = (time) => {
      animId = requestAnimationFrame(animate);
      deltaTime = (time - prevTime) / 1000;
      prevTime = time;
      if (deltaTime > 0 && deltaTime < 1) {
        // Auto-steer toward target if set
        if (flightState.targetLat != null && flightState.targetLon != null) {
          const dLon = flightState.targetLon - flightState.lon;
          const dLat = flightState.targetLat - flightState.lat;
          const distSq = dLon * dLon + dLat * dLat;
          const arrivalThreshold = 0.0001; // ~11m in radians
          if (distSq < arrivalThreshold * arrivalThreshold) {
            // Arrived — clear target and disable boost
            flightState.targetLat = null;
            flightState.targetLon = null;
            flightState.boost = false;
          } else {
            flightState.boost = true;
            const desiredHeading = Math.atan2(dLon, dLat);
            let diff = desiredHeading - flightState.heading;
            // Normalize to [-PI, PI]
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            const steerSpeed = 1.2 * deltaTime;
            flightState.heading += Math.max(-steerSpeed, Math.min(steerSpeed, diff));
          }
        }

        if (flightState.left) flightState.heading -= TURN_SPEED * deltaTime;
        if (flightState.right) flightState.heading += TURN_SPEED * deltaTime;
        const speed = getFlightSpeed() * (flightState.boost ? 3 : 1) * deltaTime;
        flightState.lon += Math.sin(flightState.heading) * speed;
        flightState.lat += Math.cos(flightState.heading) * speed;
        if (flightState.up) flightState.alt = Math.min(ALT_MAX, flightState.alt + 300 * deltaTime * (flightState.boost ? 10 : 1));
        if (flightState.down) flightState.alt = Math.max(ALT_MIN, flightState.alt - 300 * deltaTime * (flightState.boost ? 10 : 1));
        updateCamera();
        updateSunDirection();
        updateAltitudeAtmosphere(deltaTime);
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
      <CitySearch onSelectCity={(city, mode) => {
        if (mode === 'fly') {
          teleportRef.current?.flyTo(city);
        } else {
          teleportRef.current?.teleportTo(city);
        }
      }} />
    </>
  );
}
