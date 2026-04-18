// Shared flight state — written by the scene components, read by Minimap.
// Angles are in radians, altitude in metres.
// Start at Haneda Airport so the first refresh reads as Tokyo but not a dense
// city-center spawn.
export const START_LAT_RAD = 35.5494 * (Math.PI / 180);
export const START_LON_RAD = 139.7798 * (Math.PI / 180);

export const flightState = {
  lat: START_LAT_RAD,
  lon: START_LON_RAD,
  alt: 1500,
  heading: -90 * (Math.PI / 180),
  boost: false,
  left: false,
  right: false,
  up: false,
  down: false,
};

// Shared one-shot teleport command. The background scene requests a city
// change here, and the Monolith scene consumes it to move the actual plane
// origin so the shared flight state does not get snapped back on the next frame.
export const flightCommandState = {
  teleportVersion: 0,
  teleportLat: START_LAT_RAD,
  teleportLon: START_LON_RAD,
  teleportAlt: flightState.alt,
  teleportHeading: flightState.heading,
};

export function requestFlightTeleport({ lat, lon, alt = flightState.alt, heading = flightState.heading }) {
  flightCommandState.teleportLat = lat;
  flightCommandState.teleportLon = lon;
  flightCommandState.teleportAlt = alt;
  flightCommandState.teleportHeading = heading;
  flightCommandState.teleportVersion += 1;
}

// ── Autopilot ────────────────────────────────────────────────────────────────
// Smoothly flies the aircraft toward a destination instead of teleporting.
// Call requestAutopilot() to set a target, tickAutopilot(dt) every frame,
// and cancelAutopilot() (or any manual input) to abort.

export const autopilot = {
  active: false,
  targetLat: 0,   // radians
  targetLon: 0,   // radians
};

const AUTOPILOT_TURN_SPEED = 1.2;        // rad/s — how fast the plane banks
const AUTOPILOT_ARRIVAL_THRESHOLD = 0.001; // ~110 m in radians — close enough to stop

/**
 * Set a fly-to destination. Lat/lon in **degrees** (same interface as CitySearch).
 */
export function requestAutopilot({ lat, lon }) {
  const DEG2RAD = Math.PI / 180;
  autopilot.active = true;
  autopilot.targetLat = lat * DEG2RAD;
  autopilot.targetLon = lon * DEG2RAD;
  // Engage boost so long trips don't take forever
  flightState.boost = true;
}

export function cancelAutopilot() {
  if (!autopilot.active) return;
  autopilot.active = false;
  flightState.boost = false;
}

/**
 * Call once per frame from the animation loop.
 * Steers the heading toward the target and advances the plane.
 * Returns true while the autopilot is still active.
 */
export function tickAutopilot(dt) {
  if (!autopilot.active) return false;

  const dLon = autopilot.targetLon - flightState.lon;
  const dLat = autopilot.targetLat - flightState.lat;
  const dist = Math.sqrt(dLon * dLon + dLat * dLat);

  if (dist < AUTOPILOT_ARRIVAL_THRESHOLD) {
    cancelAutopilot();
    return false;
  }

  // Desired heading: atan2(dLon, dLat) matches the sim's convention
  // where heading 0 = north, positive = clockwise.
  const desired = Math.atan2(dLon, dLat);

  // Shortest-arc signed difference
  let diff = desired - flightState.heading;
  // Normalise to [-PI, PI]
  diff = ((diff + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

  const maxTurn = AUTOPILOT_TURN_SPEED * dt;
  if (Math.abs(diff) < maxTurn) {
    flightState.heading = desired;
  } else {
    flightState.heading += Math.sign(diff) * maxTurn;
  }

  return true;
}
