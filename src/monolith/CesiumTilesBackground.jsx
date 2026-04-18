import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TilesRenderer as TilesRendererImpl } from '3d-tiles-renderer/three';
import { CesiumIonAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { GLTFExtensionsPlugin, TilesFadePlugin } from '3d-tiles-renderer/three/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { resolveAssetUrl } from './asset-url.js';
import {
  clearCesiumTerrainFrame,
  CESIUM_TERRAIN_LAT_RAD,
  CESIUM_TERRAIN_LON_RAD,
  CESIUM_TERRAIN_SCENE_SCALE,
  CESIUM_TERRAIN_SCENE_Y,
  setCesiumTerrainFrame,
} from './cesium-geospatial.js';

// ── CesiumTilesBackground ──────────────────────────────────────────────────────
// Loads Google Photorealistic 3D Tiles (Cesium Ion asset 2275207) and positions
// them as a terrain background below the aircraft.
//
// The tiles are in ECEF (metres). We transform the tiles group so that:
//   - The ENU "up" at our chosen Tokyo lat/lon aligns with scene +Y
//   - The terrain surface sits at Y = TERRAIN_Y in scene space
//   - 1 metre of real terrain = SCENE_SCALE scene units
//
// A virtual camera mirrors the scene camera in ECEF space for correct LOD.

const ION_ASSET_ID = '2275207'; // Google Photorealistic 3D Tiles
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;

export default function CesiumTilesBackground() {
  const { gl, scene, camera } = useThree();
  const stateRef = useRef(null);

  useEffect(() => {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(resolveAssetUrl('/draco/'));
    dracoLoader.preload();

    const tiles = new TilesRendererImpl();
    tiles.registerPlugin(new CesiumIonAuthPlugin({
      apiToken: ION_TOKEN,
      assetId: ION_ASSET_ID,
      autoRefreshToken: true,
    }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader }));
    tiles.registerPlugin(new TilesFadePlugin());

    // Virtual camera for LOD — lives in ECEF space
    const ecefCamera = new THREE.PerspectiveCamera(
      camera.fov, camera.aspect, 1, 1e7,
    );
    tiles.setCamera(ecefCamera);
    tiles.setResolutionFromRenderer(ecefCamera, gl);

    const onLoadTileset = () => {
      const { ellipsoid, group } = tiles;
      const enuToECEF = new THREE.Matrix4();
      ellipsoid.getEastNorthUpFrame(CESIUM_TERRAIN_LAT_RAD, CESIUM_TERRAIN_LON_RAD, 0, enuToECEF);

      // Full transform: ECEF → scene space
      // 1. Rotate/translate to ENU (terrain surface at origin)
      // 2. Scale to scene units
      // 3. Translate terrain surface to the scene floor
      const ecefToENU = enuToECEF.clone().invert();
      const scaleMatrix = new THREE.Matrix4().makeScale(
        CESIUM_TERRAIN_SCENE_SCALE,
        CESIUM_TERRAIN_SCENE_SCALE,
        CESIUM_TERRAIN_SCENE_SCALE,
      );
      const translateMatrix = new THREE.Matrix4().makeTranslation(0, CESIUM_TERRAIN_SCENE_Y, 0);

      group.matrix.copy(translateMatrix).multiply(scaleMatrix).multiply(ecefToENU);
      group.matrixAutoUpdate = false;
      group.matrixWorldNeedsUpdate = true;
      setCesiumTerrainFrame(ellipsoid, group.matrix);
    };

    tiles.addEventListener('load-tileset', onLoadTileset);
    scene.add(tiles.group);

    stateRef.current = { tiles, ecefCamera, dracoLoader };

    return () => {
      tiles.removeEventListener('load-tileset', onLoadTileset);
      scene.remove(tiles.group);
      tiles.dispose();
      dracoLoader.dispose();
      clearCesiumTerrainFrame();
      stateRef.current = null;
    };
  }, [camera, gl, scene]);

  useFrame(() => {
    const state = stateRef.current;
    if (!state) return;

    const { tiles, ecefCamera } = state;
    const { group } = tiles;

    // Only update LOD camera once the tileset is loaded and group is transformed
    if (group.matrixAutoUpdate === false) {
      // Map scene camera position → ECEF for LOD
      const invGroupMatrix = new THREE.Matrix4().copy(group.matrix).invert();
      const ecefPos = camera.position.clone().applyMatrix4(invGroupMatrix);

      ecefCamera.position.copy(ecefPos);
      ecefCamera.fov = camera.fov;
      ecefCamera.aspect = camera.aspect;
      ecefCamera.near = 1;
      ecefCamera.far = 1e7;
      ecefCamera.updateProjectionMatrix();

      // Copy camera orientation: scene camera rotation → ECEF rotation
      // The group matrix rotates scene→ECEF, so we need to apply that rotation to the camera quaternion
      const rotMatrix = new THREE.Matrix4().extractRotation(invGroupMatrix);
      const ecefQuat = camera.quaternion.clone().premultiply(
        new THREE.Quaternion().setFromRotationMatrix(rotMatrix),
      );
      ecefCamera.quaternion.copy(ecefQuat);
      ecefCamera.updateMatrixWorld(true);
    }

    tiles.setResolutionFromRenderer(ecefCamera, gl);
    tiles.update();
  });

  return null;
}
