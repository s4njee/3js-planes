// ── Scene URL ──────────────────────────────────────────────────────────────────
// Encodes and decodes scene state into a shareable URL hash fragment.
// Format: #scene={plane},{lat},{lon},{heading},{datetime},{goldenHour}
//
// Example:
//   #scene=0,36.0544,-112.1401,-90,2026-04-20T18:47:00Z,1
//   → SR-71 over Grand Canyon at 6:47 PM UTC, golden hour mode on
//
// All values are plain text for readability. Lat/lon in degrees, heading in
// degrees, datetime as ISO 8601.

const HASH_PREFIX = '#scene=';

/**
 * @typedef {Object} SceneParams
 * @property {number} plane — model index
 * @property {number} lat — degrees
 * @property {number} lon — degrees
 * @property {number} heading — degrees from north, clockwise
 * @property {Date} datetime — the scene datetime
 * @property {boolean} goldenHour — whether golden hour mode is active
 */

/**
 * Encode scene parameters into a URL hash string.
 * @param {SceneParams} params
 * @returns {string} — the full hash string including '#scene='
 */
export function encodeSceneURL(params) {
  const parts = [
    params.plane,
    params.lat.toFixed(4),
    params.lon.toFixed(4),
    params.heading.toFixed(1),
    params.datetime.toISOString(),
    params.goldenHour ? '1' : '0',
  ];
  return HASH_PREFIX + parts.join(',');
}

/**
 * Decode scene parameters from the current URL hash.
 * @returns {SceneParams|null} — null if no valid scene hash is present
 */
export function decodeSceneURL() {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;

  const payload = hash.slice(HASH_PREFIX.length);
  const parts = payload.split(',');

  if (parts.length < 6) return null;

  const plane = parseInt(parts[0], 10);
  const lat = parseFloat(parts[1]);
  const lon = parseFloat(parts[2]);
  const heading = parseFloat(parts[3]);
  const datetime = new Date(parts[4]);
  const goldenHour = parts[5] === '1';

  if (
    isNaN(plane) || isNaN(lat) || isNaN(lon) || isNaN(heading)
    || isNaN(datetime.getTime())
  ) {
    return null;
  }

  return { plane, lat, lon, heading, datetime, goldenHour };
}

/**
 * Update the browser URL hash without triggering navigation.
 * @param {SceneParams} params
 */
export function pushSceneURL(params) {
  const hash = encodeSceneURL(params);
  window.history.replaceState(null, '', hash);
}

/**
 * Generate a full shareable URL for the current scene.
 * @param {SceneParams} params
 * @returns {string}
 */
export function getShareableURL(params) {
  const base = window.location.origin + window.location.pathname;
  return base + encodeSceneURL(params);
}

/**
 * Copy the shareable URL to clipboard.
 * @param {SceneParams} params
 * @returns {Promise<boolean>}
 */
export async function copySceneURL(params) {
  const url = getShareableURL(params);
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
