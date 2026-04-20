import * as THREE from 'three';
import { computeSunPosition, getSunColor, getAmbientFromSun, getSunPhase } from './solar-ephemeris.js';

// ── Golden Hour Controller ─────────────────────────────────────────────────────
// Manages real solar ephemeris lighting. When enabled, computes the sun's true
// position for the aircraft's current lat/lon and a given datetime, then drives:
//   - A directional "sun" light with correct color temperature
//   - Ambient light intensity/color matching the time of day
//   - Sky dome sun direction uniform
//   - Scene background tint
//
// The controller can be set to "live" mode (uses real current time) or "fixed"
// mode (uses a specific datetime for shareable scenes).

export function createGoldenHourController({ scene }) {
  let enabled = false;
  let useRealTime = true;
  let fixedDatetime = new Date();
  let lastComputedSun = null;
  let tint = 'sunset'; // 'sunset' | 'sunrise'

  // Sun directional light — the primary light source in golden hour mode
  const sunLight = new THREE.DirectionalLight(0xffffff, 0);
  sunLight.position.set(0, 10, 0);
  sunLight.castShadow = false;
  scene.add(sunLight);

  // Fill light — opposite side, cool tone
  const fillLight = new THREE.DirectionalLight(0x8899cc, 0);
  fillLight.position.set(0, 5, 0);
  scene.add(fillLight);

  // Ambient
  const ambientLight = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambientLight);

  // Hemisphere light for sky/ground color bleed
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444422, 0);
  scene.add(hemiLight);

  /**
   * Get the datetime to use for computation.
   */
  function getDatetime() {
    return useRealTime ? new Date() : fixedDatetime;
  }

  /**
   * Compute and apply sun lighting for the given position.
   * @param {number} latRad — latitude in radians
   * @param {number} lonRad — longitude in radians
   * @param {THREE.Object3D} [target] — optional object to point sun at
   */
  function update(latRad, lonRad, target) {
    if (!enabled) return null;

    const datetime = getDatetime();
    const sun = computeSunPosition(latRad, lonRad, datetime);
    lastComputedSun = sun;

    const [sx, sy, sz] = sun.sunDirection;
    const sunColor = getSunColor(sun.elevation);
    const ambientParams = getAmbientFromSun(sun.elevation);
    const phase = getSunPhase(sun.elevation);

    // Position sun light along the computed direction
    const sunDistance = 50;
    sunLight.position.set(sx * sunDistance, sy * sunDistance, sz * sunDistance);
    if (target) {
      sunLight.target.position.copy(target.position);
      sunLight.target.updateMatrixWorld();
    }

    // Sun light color and intensity based on elevation
    sunLight.color.setRGB(sunColor.r, sunColor.g, sunColor.b);

    // Intensity varies with elevation — strongest at midday, softer at golden hour
    const elevDeg = sun.elevation * (180 / Math.PI);
    if (elevDeg < -0.5) {
      sunLight.intensity = 0;
    } else if (elevDeg < 10) {
      // Golden hour: moderate intensity, very warm
      sunLight.intensity = 1.5 + (elevDeg / 10) * 2.5;
    } else {
      sunLight.intensity = 4.0;
    }

    // Fill light — opposite side
    fillLight.position.set(-sx * 30, Math.max(sy * 20, 5), -sz * 30);

    if (tint === 'sunrise') {
      // Pre-dawn sky: strong cool-blue fill dominates from the opposite horizon
      fillLight.intensity = sunLight.intensity * 0.9;
      fillLight.color.setRGB(0.25, 0.45, 1.0);
    } else {
      fillLight.intensity = sunLight.intensity * 0.2;
      fillLight.color.setRGB(
        0.4 + sunColor.b * 0.3,
        0.5 + sunColor.b * 0.2,
        0.7 + sunColor.b * 0.2,
      );
    }

    // Ambient
    if (tint === 'sunrise') {
      // Cool blue ambient — pre-dawn atmosphere
      ambientLight.color.setRGB(
        ambientParams.r * 0.4,
        ambientParams.g * 0.6,
        ambientParams.b * 1.6,
      );
      ambientLight.intensity = ambientParams.intensity * 1.2;
    } else {
      ambientLight.color.setRGB(ambientParams.r, ambientParams.g, ambientParams.b);
      ambientLight.intensity = ambientParams.intensity;
    }

    // Hemisphere: sky color from sun, ground warm
    if (tint === 'sunrise') {
      if (phase === 'golden') {
        hemiLight.color.setRGB(0.3, 0.5, 1.0);       // blue sky half
        hemiLight.groundColor.setRGB(0.08, 0.06, 0.18); // cool dark ground
        hemiLight.intensity = 0.55;
      } else if (phase === 'twilight') {
        hemiLight.color.setRGB(0.1, 0.15, 0.5);
        hemiLight.groundColor.setRGB(0.03, 0.03, 0.1);
        hemiLight.intensity = 0.2;
      } else {
        hemiLight.color.setRGB(0.5, 0.65, 1.0);
        hemiLight.groundColor.setRGB(0.2, 0.2, 0.3);
        hemiLight.intensity = 0.35;
      }
    } else if (phase === 'golden') {
      hemiLight.color.setRGB(sunColor.r * 0.8, sunColor.g * 0.6, sunColor.b * 0.4);
      hemiLight.groundColor.setRGB(0.3, 0.15, 0.05);
      hemiLight.intensity = 0.4;
    } else if (phase === 'day') {
      hemiLight.color.setRGB(0.6, 0.7, 0.9);
      hemiLight.groundColor.setRGB(0.3, 0.25, 0.2);
      hemiLight.intensity = 0.3;
    } else if (phase === 'twilight') {
      hemiLight.color.setRGB(0.15, 0.1, 0.3);
      hemiLight.groundColor.setRGB(0.05, 0.03, 0.02);
      hemiLight.intensity = 0.15;
    } else {
      hemiLight.intensity = 0.02;
    }

    return sun;
  }

  /**
   * Get the sun direction as a THREE.Vector3 (for sky dome uniform).
   */
  function getSunDirectionVec3() {
    if (!lastComputedSun) return null;
    const [x, y, z] = lastComputedSun.sunDirection;
    return new THREE.Vector3(x, y, z);
  }

  function setEnabled(value) {
    enabled = value;
    if (!enabled) {
      sunLight.intensity = 0;
      fillLight.intensity = 0;
      ambientLight.intensity = 0;
      hemiLight.intensity = 0;
    }
  }

  function isEnabled() {
    return enabled;
  }

  function setFixedDatetime(date) {
    fixedDatetime = date;
    useRealTime = false;
  }

  function setRealTime() {
    useRealTime = true;
  }

  function isRealTime() {
    return useRealTime;
  }

  function getFixedDatetime() {
    return fixedDatetime;
  }

  function setTint(value) {
    tint = value;
  }

  function getTint() {
    return tint;
  }

  function getPhase() {
    if (!lastComputedSun) return 'day';
    return getSunPhase(lastComputedSun.elevation);
  }

  function getElevationDeg() {
    if (!lastComputedSun) return 45;
    return lastComputedSun.elevation * (180 / Math.PI);
  }

  function dispose() {
    scene.remove(sunLight);
    scene.remove(sunLight.target);
    scene.remove(fillLight);
    scene.remove(ambientLight);
    scene.remove(hemiLight);
  }

  return {
    update,
    setEnabled,
    isEnabled,
    setFixedDatetime,
    setRealTime,
    isRealTime,
    getFixedDatetime,
    getSunDirectionVec3,
    getPhase,
    getElevationDeg,
    setTint,
    getTint,
    dispose,
  };
}
