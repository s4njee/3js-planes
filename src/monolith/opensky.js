// ── OpenSky Network ADS-B data feed ────────────────────────────────────────────
// Polls the OpenSky Network REST API for real-time aircraft state vectors.
// Anonymous access is rate-limited to ~10 second intervals.
//
// API docs: https://openskynetwork.github.io/opensky-api/rest.html
//
// Each state vector contains:
//   [0]  icao24          — ICAO 24-bit transponder address (hex string)
//   [1]  callsign        — callsign (string, may be null)
//   [2]  origin_country  — country of origin
//   [3]  time_position   — Unix timestamp of last position update
//   [4]  last_contact     — Unix timestamp of last contact
//   [5]  longitude       — WGS84 longitude (degrees)
//   [6]  latitude        — WGS84 latitude (degrees)
//   [7]  baro_altitude   — barometric altitude (metres)
//   [8]  on_ground       — boolean
//   [9]  velocity        — ground speed (m/s)
//   [10] true_track       — heading clockwise from north (degrees)
//   [11] vertical_rate   — climb/descent rate (m/s)
//   [12] sensors         — IDs of receivers
//   [13] geo_altitude    — geometric altitude (metres)
//   [14] squawk          — transponder squawk code
//   [15] spi             — special purpose indicator
//   [16] position_source — 0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM

const OPENSKY_API_BASE = import.meta.env.DEV
  ? '/opensky-api'
  : 'https://opensky-network.org/api';
const POLL_INTERVAL_MS = 10_000;
const BOUNDING_BOX_DEG = 3; // ±3° around center ≈ ~330 km at mid-latitudes

/**
 * @typedef {Object} AircraftState
 * @property {string}  icao24
 * @property {string|null} callsign
 * @property {string}  originCountry
 * @property {number}  timestamp      — seconds since epoch
 * @property {number}  lon            — degrees
 * @property {number}  lat            — degrees
 * @property {number}  altitude       — metres (geometric, falls back to baro)
 * @property {boolean} onGround
 * @property {number}  velocity       — m/s ground speed
 * @property {number}  heading        — degrees clockwise from north
 * @property {number}  verticalRate   — m/s
 */

/** Parse a single OpenSky state vector array into a typed object. */
function parseStateVector(sv) {
  if (!sv || sv[5] == null || sv[6] == null) return null;

  return {
    icao24: sv[0],
    callsign: sv[1]?.trim() || null,
    originCountry: sv[2],
    timestamp: sv[3] ?? sv[4],
    lon: sv[5],
    lat: sv[6],
    altitude: sv[13] ?? sv[7] ?? 0,
    onGround: Boolean(sv[8]),
    velocity: sv[9] ?? 0,
    heading: sv[10] ?? 0,
    verticalRate: sv[11] ?? 0,
  };
}

/**
 * Creates an OpenSky poller that fetches aircraft within a bounding box
 * centered on the given lat/lon (degrees).
 *
 * @param {Object} options
 * @param {() => {lat: number, lon: number}} options.getCenter — returns current center in degrees
 * @param {(aircraft: AircraftState[]) => void} options.onUpdate — called with parsed aircraft
 * @param {(error: Error) => void} [options.onError]
 * @returns {{ start: () => void, stop: () => void, poll: () => Promise<void> }}
 */
export function createOpenSkyPoller({ getCenter, onUpdate, onError }) {
  let timerId = null;
  let abortController = null;
  let running = false;

  async function poll() {
    const center = getCenter();
    if (!center) return;

    const lamin = center.lat - BOUNDING_BOX_DEG;
    const lamax = center.lat + BOUNDING_BOX_DEG;
    const lomin = center.lon - BOUNDING_BOX_DEG;
    const lomax = center.lon + BOUNDING_BOX_DEG;

    const url = `${OPENSKY_API_BASE}/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;

    abortController = new AbortController();

    try {
      const response = await fetch(url, { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(`OpenSky HTTP ${response.status}`);
      }

      const data = await response.json();
      const states = data.states ?? [];
      const aircraft = states
        .map(parseStateVector)
        .filter((a) => a && !a.onGround && a.altitude > 100);

      console.log(`[OpenSky] Fetched ${aircraft.length} airborne aircraft from ${states.length} total`);
      onUpdate(aircraft);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[OpenSky] Fetch error:', err.message);
        onError?.(err);
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    poll();
    timerId = setInterval(poll, POLL_INTERVAL_MS);
  }

  function stop() {
    running = false;
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    abortController?.abort();
    abortController = null;
  }

  return { start, stop, poll };
}
