import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  CesiumIonAuthPlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
  UpdateOnChangePlugin,
} from '3d-tiles-renderer/plugins';

export const GLOBE_TILES_ENABLED = true;

export const GLOBE_CITY_OPTIONS = [
  {
    key: 'A',
    name: 'New York City',
    latitude: 40.6413,
    longitude: -73.7781,
  },
  {
    key: 'B',
    name: 'Los Angeles',
    latitude: 33.9416,
    longitude: -118.4085,
  },
  {
    key: 'C',
    name: 'Chicago',
    latitude: 41.9742,
    longitude: -87.9073,
  },
  {
    key: 'D',
    name: 'Dallas',
    latitude: 32.8998,
    longitude: -97.0403,
  },
];

export const DEFAULT_GLOBE_CITY_INDEX = 1;

const CESIUM_ION_PHOTOREALISTIC_ASSET_ID = '2275207';
const GLOBE_TILES_SCENE_SCALE = 0.06;
const GLOBE_TILES_BASE_Y = -30;
const GLOBE_TILES_SCROLL_SPEED = 7.5;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export function createGlobeTilesLayer({
  camera,
  dracoLoader,
  renderer,
  onError,
} = {}) {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN ?? '';

  if (!token) {
    onError?.(new Error('Missing VITE_CESIUM_ION_TOKEN in .env.local.'));
    return null;
  }

  const root = new THREE.Group();
  root.name = 'GlobeTilesLocalFlightRoot';
  root.position.y = GLOBE_TILES_BASE_Y;
  root.scale.setScalar(GLOBE_TILES_SCENE_SCALE);

  const tiles = new TilesRenderer();
  tiles.registerPlugin(
    new CesiumIonAuthPlugin({
      apiToken: token,
      assetId: CESIUM_ION_PHOTOREALISTIC_ASSET_ID,
      autoRefreshToken: true,
    }),
  );
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader }));
  tiles.registerPlugin(new TilesFadePlugin());
  tiles.registerPlugin(new UpdateOnChangePlugin());
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  tiles.addEventListener('load-error', (event) => {
    onError?.(event?.error ?? event);
  });

  const setCity = (cityIndex = DEFAULT_GLOBE_CITY_INDEX) => {
    const city = GLOBE_CITY_OPTIONS[cityIndex] ?? GLOBE_CITY_OPTIONS[DEFAULT_GLOBE_CITY_INDEX];
    tiles.setLatLonToYUp(
      THREE.MathUtils.degToRad(city.latitude),
      THREE.MathUtils.degToRad(city.longitude),
    );
    root.position.set(0, GLOBE_TILES_BASE_Y, 0);
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
  };

  setCity(DEFAULT_GLOBE_CITY_INDEX);

  root.add(tiles.group);
  root.updateMatrixWorld(true);

  return {
    root,
    tiles,
    setCity,
    update({ boostIntensity = 0, camera: frameCamera, delta = 0, deltaYaw = 0, renderer: frameRenderer }) {
      const scrollSpeed = GLOBE_TILES_SCROLL_SPEED * (1 + boostIntensity * 2.25);

      root.position.applyAxisAngle(Y_AXIS, -deltaYaw);
      root.position.z += scrollSpeed * delta;
      root.rotation.y -= deltaYaw;
      root.updateMatrixWorld(true);

      tiles.setCamera(frameCamera);
      tiles.setResolutionFromRenderer(frameCamera, frameRenderer);
      frameCamera.updateMatrixWorld();
      tiles.update();
    },
    dispose() {
      root.remove(tiles.group);
      tiles.dispose();
    },
  };
}
