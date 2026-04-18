import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;

function currentDayOfYear() {
  const now = new Date();
  const start = new Date(now.getUTCFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

// Standard low-precision solar position (~1° accuracy, fine for visuals).
// Returns azimuth (rad, 0=north, +east) and elevation (rad, 0=horizon).
export function computeSunDirection({ latRad, lonRad, hourUTC, dayOfYear = currentDayOfYear() }) {
  const decl = 23.45 * DEG2RAD * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365);
  const localSolarTime = hourUTC + lonRad * (12 / Math.PI);
  const hourAngle = (localSolarTime - 12) * 15 * DEG2RAD;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinDecl = Math.sin(decl);
  const cosDecl = Math.cos(decl);
  const cosH = Math.cos(hourAngle);

  const elevation = Math.asin(sinLat * sinDecl + cosLat * cosDecl * cosH);
  const azimuth = Math.atan2(-Math.sin(hourAngle), cosLat * Math.tan(decl) - sinLat * cosH);

  return { azimuth, elevation };
}

// ── Palette ───────────────────────────────────────────────────────────────────
// Three regimes (night / golden hour / day) blended by sun elevation.
// All output fields reference shared scratch objects — callers must copy
// Color/Vector3 values before the next call overwrites them.

const PALETTES = [
  // elevation threshold, ambientInt, ambientHex, sunInt, sunHex, bgHex
  { elev: -0.15, ambientInt: 0.10, ambientHex: 0x1a2440, sunInt: 0.0, sunHex: 0x446088, bgHex: 0x02030a },
  { elev:  0.00, ambientInt: 0.45, ambientHex: 0xffb07a, sunInt: 0.9, sunHex: 0xff6a2a, bgHex: 0x3a2a2e },
  { elev:  0.25, ambientInt: 0.90, ambientHex: 0xffffff, sunInt: 1.3, sunHex: 0xfff4d6, bgHex: 0x9cc4e8 },
];

// Scratch objects — reused every call to avoid per-frame allocation.
const _ambientColor = new THREE.Color();
const _sunColor = new THREE.Color();
const _bgColor = new THREE.Color();
const _sunDir = new THREE.Vector3();
const _colA = new THREE.Color();
const _colB = new THREE.Color();

const _result = {
  ambientIntensity: 0,
  ambientColor: _ambientColor,
  sunIntensity: 0,
  sunColor: _sunColor,
  backgroundColor: _bgColor,
  sunDir: _sunDir,
};

function lerpColor(out, hexA, hexB, t) {
  _colA.setHex(hexA);
  _colB.setHex(hexB);
  out.copy(_colA).lerp(_colB, t);
}

// Returns a shared result object. Copy Color/Vector3 fields before next call.
export function evaluateTimeOfDay({ hourUTC, latRad, lonRad }) {
  const { azimuth, elevation } = computeSunDirection({ latRad, lonRad, hourUTC });

  // Sun world-space direction (Three.js y-up)
  const cosEl = Math.cos(elevation);
  _sunDir.set(cosEl * Math.sin(azimuth), Math.sin(elevation), cosEl * Math.cos(azimuth));

  // Find which palette segment elevation falls in and compute blend factor
  const lo = PALETTES[0];
  const mid = PALETTES[1];
  const hi = PALETTES[2];

  let t, a, b;
  if (elevation <= lo.elev) {
    t = 0; a = lo; b = lo;
  } else if (elevation <= mid.elev) {
    t = THREE.MathUtils.smoothstep(elevation, lo.elev, mid.elev);
    a = lo; b = mid;
  } else if (elevation <= hi.elev) {
    t = THREE.MathUtils.smoothstep(elevation, mid.elev, hi.elev);
    a = mid; b = hi;
  } else {
    t = 1; a = hi; b = hi;
  }

  _result.ambientIntensity = a.ambientInt + (b.ambientInt - a.ambientInt) * t;
  _result.sunIntensity = a.sunInt + (b.sunInt - a.sunInt) * t;
  lerpColor(_ambientColor, a.ambientHex, b.ambientHex, t);
  lerpColor(_sunColor, a.sunHex, b.sunHex, t);
  lerpColor(_bgColor, a.bgHex, b.bgHex, t);

  return _result;
}
