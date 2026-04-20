import * as THREE from 'three';

// ── Cockpit Camera Controller ──────────────────────────────────────────────────
// Provides a "cockpit view" that follows a selected live flight.
// Three modes:
//   - OFF:     Normal scene camera (default)
//   - CHASE:   Third-person behind the aircraft
//   - COCKPIT: First-person from inside the aircraft
//
// The controller smoothly interpolates the camera position/target each frame
// to avoid jarring jumps when ADS-B data updates.

export const COCKPIT_MODE_OFF = 0;
export const COCKPIT_MODE_CHASE = 1;
export const COCKPIT_MODE_COCKPIT = 2;

const MODE_LABELS = ['Off', 'Chase', 'Cockpit'];

const CHASE_DISTANCE = 0.15;   // scene units behind the aircraft
const CHASE_HEIGHT = 0.06;     // scene units above the aircraft
const COCKPIT_HEIGHT = 0.005;  // slight offset above model center
const LOOK_AHEAD = 0.2;       // how far ahead of the aircraft to look
const LERP_SPEED = 3;          // camera smoothing factor

export function createCockpitCamera() {
  let mode = COCKPIT_MODE_OFF;
  let targetIcao24 = null;
  let liveFlightsManager = null;

  // Scratch vectors
  const _targetPos = new THREE.Vector3();
  const _camPos = new THREE.Vector3();
  const _lookAt = new THREE.Vector3();
  const _forward = new THREE.Vector3();

  /**
   * Set the live flights manager reference.
   * @param {ReturnType<import('./live-flights.js').createLiveFlightsManager>} manager
   */
  function setLiveFlightsManager(manager) {
    liveFlightsManager = manager;
  }

  /**
   * Select an aircraft to follow by ICAO24 address.
   * @param {string|null} icao24
   */
  function selectAircraft(icao24) {
    targetIcao24 = icao24;
    if (icao24 && mode === COCKPIT_MODE_OFF) {
      mode = COCKPIT_MODE_CHASE;
    }
  }

  /**
   * Cycle through camera modes: Off → Chase → Cockpit → Off
   */
  function cycleMode() {
    mode = (mode + 1) % 3;
    if (mode !== COCKPIT_MODE_OFF && !targetIcao24) {
      // Auto-select nearest aircraft if none selected
      const nearest = liveFlightsManager?.findNearest(0, 0);
      if (nearest) {
        targetIcao24 = nearest.icao24;
      } else {
        mode = COCKPIT_MODE_OFF;
      }
    }
    return mode;
  }

  /**
   * Select the nearest aircraft to the current camera center.
   * @param {number} lat — degrees
   * @param {number} lon — degrees
   */
  function selectNearest(lat, lon) {
    const nearest = liveFlightsManager?.findNearest(lat, lon);
    if (nearest) {
      console.log(`[CockpitCam] Selected ${nearest.callsign || nearest.icao24}`);
      selectAircraft(nearest.icao24);
    } else {
      console.log('[CockpitCam] No aircraft found nearby');
    }
  }

  /**
   * Per-frame update. Positions the camera relative to the tracked aircraft.
   * @param {THREE.Camera} camera
   * @param {Object} controls — OrbitControls instance
   * @param {number} delta — frame delta in seconds
   * @returns {boolean} — true if the cockpit camera is active and controlling the view
   */
  function update(camera, controls, delta) {
    if (mode === COCKPIT_MODE_OFF || !targetIcao24 || !liveFlightsManager) {
      return false;
    }

    const tracked = liveFlightsManager.getAircraft(targetIcao24);
    if (!tracked || !tracked.mesh) {
      // Aircraft lost — revert to normal camera
      mode = COCKPIT_MODE_OFF;
      targetIcao24 = null;
      return false;
    }

    const mesh = tracked.mesh;
    _targetPos.copy(mesh.position);

    // Forward direction from the aircraft's heading rotation
    _forward.set(0, 0, -1).applyQuaternion(mesh.quaternion).normalize();

    if (mode === COCKPIT_MODE_CHASE) {
      // Position camera behind and above the aircraft
      _camPos.copy(_targetPos)
        .addScaledVector(_forward, -CHASE_DISTANCE)
        .setY(_targetPos.y + CHASE_HEIGHT);

      // Look ahead of the aircraft
      _lookAt.copy(_targetPos).addScaledVector(_forward, LOOK_AHEAD);

    } else if (mode === COCKPIT_MODE_COCKPIT) {
      // Position camera at the aircraft's position (inside cockpit)
      _camPos.copy(_targetPos).setY(_targetPos.y + COCKPIT_HEIGHT);

      // Look far ahead
      _lookAt.copy(_targetPos).addScaledVector(_forward, LOOK_AHEAD * 3);
    }

    // Smooth interpolation
    const lerpFactor = 1 - Math.exp(-LERP_SPEED * delta);
    camera.position.lerp(_camPos, lerpFactor);

    if (controls) {
      controls.target.lerp(_lookAt, lerpFactor);
      controls.update();
    } else {
      camera.lookAt(_lookAt);
    }

    return true;
  }

  /**
   * Get current mode info for UI display.
   */
  function getStatus() {
    const tracked = targetIcao24 && liveFlightsManager
      ? liveFlightsManager.getAircraft(targetIcao24)
      : null;

    return {
      mode,
      modeLabel: MODE_LABELS[mode],
      targetIcao24,
      callsign: tracked?.callsign ?? null,
      aircraftCount: liveFlightsManager?.aircraftCount ?? 0,
    };
  }

  function getMode() {
    return mode;
  }

  function setMode(newMode) {
    mode = newMode;
  }

  function getTargetIcao24() {
    return targetIcao24;
  }

  return {
    selectAircraft,
    selectNearest,
    cycleMode,
    update,
    getStatus,
    getMode,
    setMode,
    getTargetIcao24,
    setLiveFlightsManager,
    COCKPIT_MODE_OFF,
    COCKPIT_MODE_CHASE,
    COCKPIT_MODE_COCKPIT,
  };
}
