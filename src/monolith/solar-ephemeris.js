// ── Solar Ephemeris ─────────────────────────────────────────────────────────────
// Computes the sun's position (azimuth + elevation) for any location and time.
// Based on the NOAA Solar Calculator algorithms.
// Reference: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
//
// All angles in radians unless noted. Lat/lon in radians.

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Compute Julian Day Number from a Date object.
 */
function dateToJulianDay(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const h = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  let jy = y;
  let jm = m;
  if (m <= 2) {
    jy -= 1;
    jm += 12;
  }

  const A = Math.floor(jy / 100);
  const B = 2 - A + Math.floor(A / 4);

  return Math.floor(365.25 * (jy + 4716)) + Math.floor(30.6001 * (jm + 1)) + d + h / 24 + B - 1524.5;
}

/**
 * Compute the sun's position for a given location and time.
 *
 * @param {number} latRad — latitude in radians
 * @param {number} lonRad — longitude in radians
 * @param {Date} date — the datetime to compute for
 * @returns {{ azimuth: number, elevation: number, sunDirection: [number, number, number] }}
 *   azimuth: radians from north, clockwise (0 = north, π/2 = east)
 *   elevation: radians above horizon (negative = below)
 *   sunDirection: normalized [x, y, z] vector in scene space (y = up)
 */
export function computeSunPosition(latRad, lonRad, date) {
  const JD = dateToJulianDay(date);
  const JC = (JD - 2451545.0) / 36525.0; // Julian century

  // Geometric mean longitude of the sun (degrees)
  const L0 = (280.46646 + JC * (36000.76983 + 0.0003032 * JC)) % 360;

  // Mean anomaly of the sun (degrees)
  const M = (357.52911 + JC * (35999.05029 - 0.0001537 * JC)) % 360;
  const Mrad = M * DEG_TO_RAD;

  // Equation of center
  const C = (1.914602 - JC * (0.004817 + 0.000014 * JC)) * Math.sin(Mrad)
    + (0.019993 - 0.000101 * JC) * Math.sin(2 * Mrad)
    + 0.000289 * Math.sin(3 * Mrad);

  // Sun's true longitude and anomaly
  const sunLon = (L0 + C) * DEG_TO_RAD;

  // Obliquity of the ecliptic
  const obliquity = (23.439291 - 0.0130042 * JC) * DEG_TO_RAD;

  // Sun's declination
  const sinDec = Math.sin(obliquity) * Math.sin(sunLon);
  const declination = Math.asin(sinDec);
  const cosDec = Math.cos(declination);

  // Equation of time (minutes)
  const y2 = Math.tan(obliquity / 2) ** 2;
  const L0rad = L0 * DEG_TO_RAD;
  const eqTime = 4 * RAD_TO_DEG * (
    y2 * Math.sin(2 * L0rad)
    - 2 * 0.016709 * Math.sin(Mrad)
    + 4 * 0.016709 * y2 * Math.sin(Mrad) * Math.cos(2 * L0rad)
    - 0.5 * y2 * y2 * Math.sin(4 * L0rad)
    - 1.25 * 0.016709 * 0.016709 * Math.sin(2 * Mrad)
  );

  // Solar time
  const lonDeg = lonRad * RAD_TO_DEG;
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solarTime = (utcHours * 60 + eqTime + 4 * lonDeg) % 1440;

  // Hour angle
  let hourAngle = (solarTime / 4 - 180) * DEG_TO_RAD;

  // Solar elevation
  const latSin = Math.sin(latRad);
  const latCos = Math.cos(latRad);
  const sinElevation = latSin * sinDec + latCos * cosDec * Math.cos(hourAngle);
  const elevation = Math.asin(sinElevation);

  // Solar azimuth (from north, clockwise)
  const cosElevation = Math.cos(elevation);
  let azimuth;
  if (cosElevation > 0.001) {
    const sinAz = -cosDec * Math.sin(hourAngle) / cosElevation;
    const cosAz = (sinElevation * latSin - sinDec) / (cosElevation * latCos);
    azimuth = Math.atan2(sinAz, cosAz);
  } else {
    azimuth = 0;
  }

  // Convert to scene-space direction vector.
  // Scene: Y = up, -Z = north, +X = east
  // azimuth 0 = north (-Z), π/2 = east (+X)
  const x = Math.cos(elevation) * Math.sin(azimuth);
  const y = Math.sin(elevation);
  const z = -Math.cos(elevation) * Math.cos(azimuth);

  return {
    azimuth,
    elevation,
    sunDirection: [x, y, z],
  };
}

/**
 * Determine the lighting "phase" from sun elevation.
 * Returns a descriptor useful for color grading.
 *
 * @param {number} elevation — radians above horizon
 * @returns {'night'|'twilight'|'golden'|'day'}
 */
export function getSunPhase(elevation) {
  const deg = elevation * RAD_TO_DEG;
  if (deg < -12) return 'night';
  if (deg < -0.5) return 'twilight';
  if (deg < 10) return 'golden';
  return 'day';
}

/**
 * Compute sun color temperature based on elevation.
 * Low sun = warm orange/red, high sun = neutral white.
 *
 * @param {number} elevation — radians
 * @returns {{ r: number, g: number, b: number }} — linear RGB color
 */
export function getSunColor(elevation) {
  const deg = elevation * RAD_TO_DEG;

  if (deg < -0.5) {
    // Below horizon — deep blue ambient
    return { r: 0.05, g: 0.08, b: 0.2 };
  }

  if (deg < 6) {
    // Golden hour — warm orange to yellow
    const t = Math.max(0, deg + 0.5) / 6.5;
    return {
      r: 1.0,
      g: 0.4 + t * 0.35,
      b: 0.1 + t * 0.2,
    };
  }

  if (deg < 20) {
    // Transition to neutral
    const t = (deg - 6) / 14;
    return {
      r: 1.0,
      g: 0.75 + t * 0.25,
      b: 0.3 + t * 0.7,
    };
  }

  // Full daylight
  return { r: 1.0, g: 1.0, b: 0.95 };
}

/**
 * Find a datetime at which the sun sits in the "golden" band (~0°–8° elevation)
 * for the given lat/lon, preferring sunset or sunrise. Scans the 24h window
 * around baseDate at 5-minute resolution.
 *
 * @param {number} latRad — latitude in radians
 * @param {number} lonRad — longitude in radians
 * @param {{ mode?: 'sunset' | 'sunrise', baseDate?: Date }} [opts]
 * @returns {Date}
 */
export function findGoldenHourDatetime(latRad, lonRad, opts = {}) {
  const mode = opts.mode ?? 'sunset';
  const base = new Date(opts.baseDate ?? new Date());
  base.setUTCHours(0, 0, 0, 0);

  const targetElevRad = 3 * DEG_TO_RAD;
  let best = null;
  let bestScore = Infinity;

  for (let minute = 0; minute < 1440; minute += 5) {
    const candidate = new Date(base.getTime() + minute * 60000);
    const elev = computeSunPosition(latRad, lonRad, candidate).elevation;
    const elevDeg = elev * RAD_TO_DEG;
    if (elevDeg < 0 || elevDeg > 8) continue;

    const prevElev = computeSunPosition(
      latRad,
      lonRad,
      new Date(candidate.getTime() - 60000),
    ).elevation;
    const ascending = elev > prevElev;
    if (mode === 'sunset' && ascending) continue;
    if (mode === 'sunrise' && !ascending) continue;

    const score = Math.abs(elev - targetElevRad);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  // Fallback for polar day / polar night where the sun never crosses the band.
  if (!best) {
    const fallbackHour = mode === 'sunrise' ? 6 : 18;
    best = new Date(base.getTime() + fallbackHour * 3600 * 1000);
  }
  return best;
}

/**
 * Compute ambient light intensity and color based on sun elevation.
 *
 * @param {number} elevation — radians
 * @returns {{ intensity: number, r: number, g: number, b: number }}
 */
export function getAmbientFromSun(elevation) {
  const deg = elevation * RAD_TO_DEG;

  if (deg < -12) {
    return { intensity: 0.02, r: 0.05, g: 0.05, b: 0.15 };
  }

  if (deg < -0.5) {
    const t = (deg + 12) / 11.5;
    return {
      intensity: 0.02 + t * 0.15,
      r: 0.05 + t * 0.2,
      g: 0.05 + t * 0.1,
      b: 0.15 + t * 0.1,
    };
  }

  if (deg < 10) {
    const t = (deg + 0.5) / 10.5;
    return {
      intensity: 0.17 + t * 0.4,
      r: 0.25 + t * 0.5,
      g: 0.15 + t * 0.45,
      b: 0.25 + t * 0.35,
    };
  }

  return { intensity: 0.6, r: 0.75, g: 0.8, b: 0.9 };
}
