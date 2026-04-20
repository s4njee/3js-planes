// Shared flight state — written by the scene components, read by Minimap.
// Angles are in radians, altitude in metres.
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
  sunDateOverride: null,
};

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
