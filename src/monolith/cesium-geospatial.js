import * as THREE from 'three';
import { Geodetic } from '@takram/three-geospatial';
import { START_LAT_RAD, START_LON_RAD } from '../flight-store.js';

// ── Cesium terrain frame ──────────────────────────────────────────────────────
// Shared between the Cesium tiles background and the minimap feed. The terrain
// origin is fixed so every frame can convert scene-space positions back to
// geographic coordinates without recreating the ENU frame.

export const CESIUM_TERRAIN_LAT_RAD = START_LAT_RAD;
export const CESIUM_TERRAIN_LON_RAD = START_LON_RAD;
export const CESIUM_TERRAIN_SCENE_SCALE = 0.008; // 1 metre → 0.008 scene units
export const CESIUM_TERRAIN_SCENE_Y = -14;

const terrainFrameState = {
  enuToECEF: new THREE.Matrix4(),
  ecefToENU: new THREE.Matrix4(),
  ecefToScene: new THREE.Matrix4(),
  sceneToECEF: new THREE.Matrix4(),
  ellipsoid: null,
};

const sceneToECEFScratch = new THREE.Vector3();
const ecefScratch = new THREE.Vector3();
const geodeticScratch = new Geodetic();
const cartographicScratch = { lat: 0, lon: 0, height: 0 };

export function setCesiumTerrainFrame(ellipsoid, ecefToSceneMatrix) {
  ellipsoid.getEastNorthUpFrame(CESIUM_TERRAIN_LAT_RAD, CESIUM_TERRAIN_LON_RAD, 0, terrainFrameState.enuToECEF);
  terrainFrameState.ecefToENU.copy(terrainFrameState.enuToECEF).invert();
  terrainFrameState.ecefToScene.copy(ecefToSceneMatrix);
  terrainFrameState.sceneToECEF.copy(ecefToSceneMatrix).invert();
  terrainFrameState.ellipsoid = ellipsoid;
}

export function clearCesiumTerrainFrame() {
  terrainFrameState.enuToECEF.identity();
  terrainFrameState.ecefToENU.identity();
  terrainFrameState.ecefToScene.identity();
  terrainFrameState.sceneToECEF.identity();
  terrainFrameState.ellipsoid = null;
}

export function getCesiumTerrainFrame() {
  return terrainFrameState;
}

export function scenePositionToCartographic(scenePosition, target = cartographicScratch) {
  if (!terrainFrameState.ellipsoid || !scenePosition) return null;

  sceneToECEFScratch.copy(scenePosition).applyMatrix4(terrainFrameState.sceneToECEF);

  return terrainFrameState.ellipsoid.getPositionToCartographic(sceneToECEFScratch, target);
}

export function cartographicToScenePosition({ lat, lon, height = 0 }, target = new THREE.Vector3()) {
  if (!terrainFrameState.ellipsoid) return null;

  geodeticScratch.set(lon, lat, height);
  geodeticScratch.toECEF(ecefScratch, { ellipsoid: terrainFrameState.ellipsoid });

  return target.copy(ecefScratch).applyMatrix4(terrainFrameState.ecefToScene);
}
