import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { resolveAssetUrl } from './asset-url.js';
import { cachedFetch } from './model-cache.js';
import { cartographicToScenePosition } from './cesium-geospatial.js';
import { MODEL_SET_DEF } from './set-defs.js';

// ── Live Flights Manager ───────────────────────────────────────────────────────
// Renders real-time ADS-B aircraft as GLB models on the Cesium terrain.
// Each aircraft is interpolated between ADS-B updates (~10s) for smooth motion.
//
// Architecture:
//   - `aircraftMap` holds per-ICAO state: current/previous ADS-B snapshots,
//     interpolation progress, and the Three.js Object3D instance.
//   - `update(delta)` advances interpolation and positions models in scene space.
//   - `setAircraftData(states)` ingests a new batch from OpenSky.

const MAX_VISIBLE_AIRCRAFT = 80;
const INTERPOLATION_DURATION = 10; // seconds between ADS-B updates
const STALE_TIMEOUT = 30; // remove aircraft not seen for 30s
// Real aircraft are ~50-70m. Cesium terrain scale is 0.008 scene units/metre.
// So a 60m aircraft = 60 * 0.008 = 0.48 scene units. We normalize the model's
// largest dimension to this target size.
const MODEL_TARGET_SIZE = 0.48;

// Map aircraft type categories to available GLB models.
// Since we don't get aircraft type from OpenSky (free tier), we assign
// models based on a hash of the ICAO address for visual variety.
const AVAILABLE_MODELS = MODEL_SET_DEF.models.map((m) => m.path);

function icaoToModelIndex(icao24) {
  let hash = 0;
  for (let i = 0; i < icao24.length; i++) {
    hash = ((hash << 5) - hash + icao24.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % AVAILABLE_MODELS.length;
}

/**
 * @typedef {Object} TrackedAircraft
 * @property {string} icao24
 * @property {string|null} callsign
 * @property {Object} prev — previous ADS-B snapshot {lat, lon, alt, heading, velocity}
 * @property {Object} curr — current ADS-B snapshot
 * @property {number} interpT — 0..1 interpolation progress
 * @property {THREE.Group|null} mesh — the 3D model instance
 * @property {number} lastSeen — timestamp of last ADS-B update
 * @property {number} modelIndex — index into AVAILABLE_MODELS
 * @property {boolean} modelLoading — whether the GLB is currently loading
 */

export function createLiveFlightsManager({ scene, renderer }) {
  const aircraftMap = new Map(); // icao24 → TrackedAircraft
  const group = new THREE.Group();
  group.name = 'LiveFlightsGroup';
  scene.add(group);

  // Shared loader
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(resolveAssetUrl('/draco/'));
  dracoLoader.preload();
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  // Model cache: path → Promise<THREE.Group> (template to clone)
  const modelTemplates = new Map();

  /** Load or retrieve a cached model template. */
  function getModelTemplate(path) {
    if (modelTemplates.has(path)) return modelTemplates.get(path);

    const promise = cachedFetch(resolveAssetUrl(path))
      .then((response) => response.arrayBuffer())
      .then((buffer) => new Promise((resolve, reject) => {
        gltfLoader.parse(
          buffer,
          resolveAssetUrl(path.substring(0, path.lastIndexOf('/') + 1)),
          (gltf) => resolve(gltf.scene),
          reject,
        );
      }))
      .then((template) => {
        // Normalize so the model's largest dimension matches real aircraft size in scene space
        const box = new THREE.Box3().setFromObject(template);
        const size = new THREE.Vector3();
        box.getSize(size);
        const s = MODEL_TARGET_SIZE / Math.max(size.x, size.y, size.z);
        template.scale.setScalar(s);
        return template;
      })
      .catch((err) => {
        console.warn(`[LiveFlights] Failed to load model ${path}:`, err);
        modelTemplates.delete(path);
        return null;
      });

    modelTemplates.set(path, promise);
    return promise;
  }

  /** Spawn a 3D model for a tracked aircraft. */
  async function spawnModel(tracked) {
    if (tracked.modelLoading || tracked.mesh) return;
    tracked.modelLoading = true;

    const path = AVAILABLE_MODELS[tracked.modelIndex];
    const template = await getModelTemplate(path);
    if (!template) {
      tracked.modelLoading = false;
      return;
    }

    // Clone the template for this aircraft
    const mesh = template.clone();
    mesh.name = `flight-${tracked.icao24}`;
    mesh.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone();
      }
    });

    tracked.mesh = mesh;
    tracked.modelLoading = false;
    group.add(mesh);
    console.log(`[LiveFlights] Spawned model for ${tracked.callsign || tracked.icao24}`);
  }

  /** Remove a tracked aircraft from the scene. */
  function removeAircraft(icao24) {
    const tracked = aircraftMap.get(icao24);
    if (!tracked) return;

    if (tracked.mesh) {
      group.remove(tracked.mesh);
      tracked.mesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    }
    aircraftMap.delete(icao24);
  }

  // Scratch vectors for interpolation
  const _scenePos = new THREE.Vector3();

  /** Interpolate lat/lon/alt between prev and curr snapshots. */
  function interpolatePosition(tracked) {
    const t = Math.min(tracked.interpT, 1);
    const lat = THREE.MathUtils.lerp(tracked.prev.lat, tracked.curr.lat, t);
    const lon = THREE.MathUtils.lerp(tracked.prev.lon, tracked.curr.lon, t);
    const alt = THREE.MathUtils.lerp(tracked.prev.alt, tracked.curr.alt, t);
    return { lat: lat * (Math.PI / 180), lon: lon * (Math.PI / 180), height: alt };
  }

  /** Interpolate heading (handling 360° wrap). */
  function interpolateHeading(tracked) {
    const t = Math.min(tracked.interpT, 1);
    let from = tracked.prev.heading;
    let to = tracked.curr.heading;
    // Shortest path around the circle
    let diff = to - from;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return from + diff * t;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Ingest a new batch of ADS-B state vectors from OpenSky.
   * @param {import('./opensky.js').AircraftState[]} states
   */
  function setAircraftData(states) {
    const now = performance.now() / 1000;
    const seen = new Set();

    // Sort by altitude descending so we keep the most visible aircraft
    const sorted = states
      .slice()
      .sort((a, b) => b.altitude - a.altitude)
      .slice(0, MAX_VISIBLE_AIRCRAFT);

    for (const state of sorted) {
      seen.add(state.icao24);

      const snapshot = {
        lat: state.lat,
        lon: state.lon,
        alt: state.altitude,
        heading: state.heading,
        velocity: state.velocity,
        verticalRate: state.verticalRate,
      };

      if (aircraftMap.has(state.icao24)) {
        const tracked = aircraftMap.get(state.icao24);
        tracked.prev = { ...tracked.curr };
        tracked.curr = snapshot;
        tracked.interpT = 0;
        tracked.lastSeen = now;
        tracked.callsign = state.callsign ?? tracked.callsign;
      } else {
        const tracked = {
          icao24: state.icao24,
          callsign: state.callsign,
          prev: snapshot,
          curr: snapshot,
          interpT: 1, // start fully at current position
          mesh: null,
          modelLoading: false,
          lastSeen: now,
          modelIndex: icaoToModelIndex(state.icao24),
        };
        aircraftMap.set(state.icao24, tracked);
        spawnModel(tracked);
      }
    }

    // Remove stale aircraft
    for (const [icao24, tracked] of aircraftMap) {
      if (!seen.has(icao24) && (now - tracked.lastSeen) > STALE_TIMEOUT) {
        removeAircraft(icao24);
      }
    }
  }

  /**
   * Per-frame update: advance interpolation and position models.
   * @param {number} delta — frame delta in seconds
   */
  function update(delta) {
    for (const [, tracked] of aircraftMap) {
      // Advance interpolation
      tracked.interpT += delta / INTERPOLATION_DURATION;

      if (!tracked.mesh) continue;

      // Position
      const cartographic = interpolatePosition(tracked);
      const scenePos = cartographicToScenePosition(cartographic, _scenePos);

      if (scenePos) {
        tracked.mesh.position.copy(scenePos);

        // Heading: OpenSky heading is degrees CW from north.
        // In scene space, north is -Z, so heading 0° = facing -Z.
        const headingDeg = interpolateHeading(tracked);
        const headingRad = -headingDeg * (Math.PI / 180);
        tracked.mesh.rotation.set(0, headingRad, 0);
      }
    }
  }

  /**
   * Get a tracked aircraft by ICAO24 address.
   * @param {string} icao24
   * @returns {TrackedAircraft|undefined}
   */
  function getAircraft(icao24) {
    return aircraftMap.get(icao24);
  }

  /**
   * Get all currently tracked aircraft.
   * @returns {TrackedAircraft[]}
   */
  function getAllAircraft() {
    return Array.from(aircraftMap.values());
  }

  /**
   * Find the nearest aircraft to a given lat/lon (degrees).
   * @param {number} lat — degrees
   * @param {number} lon — degrees
   * @returns {TrackedAircraft|null}
   */
  function findNearest(lat, lon) {
    let nearest = null;
    let minDist = Infinity;

    for (const [, tracked] of aircraftMap) {
      const t = Math.min(tracked.interpT, 1);
      const aLat = THREE.MathUtils.lerp(tracked.prev.lat, tracked.curr.lat, t);
      const aLon = THREE.MathUtils.lerp(tracked.prev.lon, tracked.curr.lon, t);
      const dLat = aLat - lat;
      const dLon = aLon - lon;
      const dist = dLat * dLat + dLon * dLon;
      if (dist < minDist) {
        minDist = dist;
        nearest = tracked;
      }
    }

    return nearest;
  }

  /** Clean up all resources. */
  function dispose() {
    for (const [icao24] of aircraftMap) {
      removeAircraft(icao24);
    }
    scene.remove(group);
    dracoLoader.dispose();
  }

  return {
    setAircraftData,
    update,
    getAircraft,
    getAllAircraft,
    findNearest,
    dispose,
    group,
    get aircraftCount() {
      return aircraftMap.size;
    },
  };
}
