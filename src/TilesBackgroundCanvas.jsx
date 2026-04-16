import { useEffect, useRef } from 'react';
import * as THREE from 'three';
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

const ION_KEY = import.meta.env.VITE_CESIUM_ION_TOKEN;
const DEG2RAD = Math.PI / 180;

const STYLE = {
  position: 'fixed',
  inset: 0,
  width: '100%',
  height: '100%',
  zIndex: 0,
};

export default function TilesBackgroundCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    let animId;
    let prevTime = 0;
    let deltaTime = 0;

    // renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      outputBufferType: THREE.HalfFloatType,
      antialias: true,
    });
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

    // position camera above Tokyo
    // Flight state — advance longitude each frame to simulate forward flight
    const flightState = { lat: 35.6812 * DEG2RAD, lon: 139.80 * DEG2RAD, heading: -90 * DEG2RAD, boost: false, left: false, right: false };
    const FLIGHT_SPEED = 0.00004;
    const TURN_SPEED = 0.8;

    const onKeyDown = (e) => {
      if (e.code === 'Space') flightState.boost = true;
      if (e.code === 'ArrowLeft') flightState.left = true;
      if (e.code === 'ArrowRight') flightState.right = true;
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') flightState.boost = false;
      if (e.code === 'ArrowLeft') flightState.left = false;
      if (e.code === 'ArrowRight') flightState.right = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const updateCamera = () => {
      tiles.ellipsoid.getObjectFrame(
        flightState.lat, flightState.lon, 500,
        flightState.heading, -10 * DEG2RAD, 0,
        camera.matrix, CAMERA_FRAME,
      );
      camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    };
    updateCamera();

    // sun
    const sunDirection = new THREE.Vector3();
    let hourUTC = 0;

    const updateSunDirection = () => {
      const date = new Date(Date.UTC(2024, 2, 1) + hourUTC * 3600000);
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
          this.pass.setSize(readBuffer.width, readBuffer.height);
          if (readBuffer.depthTexture && this.pass.setDepthTexture) {
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

    renderer.setEffects([
      new EffectPassAdapter(normalPass),
      new EffectPassAdapter(new EffectPass(camera, clouds, aerialPerspective)),
      new EffectPassAdapter(new EffectPass(camera, new LensFlareEffect())),
      new EffectPassAdapter(new EffectPass(camera, new SMAAEffect())),
      new EffectPassAdapter(new EffectPass(camera, new DitheringEffect())),
    ]);

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
      renderer.setSize(window.innerWidth, window.innerHeight);
      tiles.setResolutionFromRenderer(camera, renderer);
    };
    window.addEventListener('resize', onResize);

    const animate = (time) => {
      animId = requestAnimationFrame(animate);
      deltaTime = (time - prevTime) / 1000;
      prevTime = time;
      if (deltaTime > 0 && deltaTime < 1) {
        if (flightState.left) flightState.heading -= TURN_SPEED * deltaTime;
        if (flightState.right) flightState.heading += TURN_SPEED * deltaTime;
        const speed = FLIGHT_SPEED * (flightState.boost ? 10 : 1) * deltaTime;
        flightState.lon += Math.sin(flightState.heading) * speed;
        flightState.lat += Math.cos(flightState.heading) * speed;
        updateCamera();
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
      tiles.dispose();
      dracoLoader.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} style={STYLE} />;
}
