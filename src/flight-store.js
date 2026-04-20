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
  targetLat: null,
  targetLon: null,
  /** When set, overrides the Cesium sky sun to this Date instead of local noon. */
  sunDateOverride: null,
  /** Current model index — written by MonolithCanvas, read by TilesBackgroundCanvas for speed. */
  currentModelIndex: 0,
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
