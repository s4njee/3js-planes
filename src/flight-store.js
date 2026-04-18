// Shared flight state — written by the scene components, read by Minimap.
// Angles are in radians, altitude in metres.
export const flightState = {
  lat: 35.6812 * (Math.PI / 180),
  lon: 139.80 * (Math.PI / 180),
  alt: 1500,
  heading: -90 * (Math.PI / 180),
  boost: false,
  left: false,
  right: false,
  up: false,
  down: false,
};
