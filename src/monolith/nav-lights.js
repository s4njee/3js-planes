import * as THREE from 'three';
import { timeOfDayState } from '../time-of-day-store.js';
import { flightState } from '../flight-store.js';
import { computeSunDirection } from '../solar-position.js';

// ── Aircraft navigation lights ─────────────────────────────────────────────────
// Attaches FAA-style exterior lighting to each aircraft model: steady red
// (port) / green (starboard) wingtip lights, a white double-flash strobe at the
// tail, and a pulsing red anti-collision beacon on the spine. Light positions
// are found by scanning the model's geometry for the extreme vertices along
// each axis (native X = nose→tail, Y = up, Z = wing-to-wing), so the rig works
// for any model in the collection without per-model tuning.
//
// Intensity is driven by the time-of-day sun elevation: faint glints in
// daylight, bright glowing halos at night.

// Sprite sizes in world (scene) units — converted to model-local units at
// attach time since the sprites live under the scaled model root.
const WINGTIP_SIZE = 0.3;
const STROBE_SIZE = 0.55;
const BEACON_SIZE = 0.38;

const STROBE_PERIOD_S = 1.4;   // double-flash cycle length
const BEACON_RATE = 4.2;       // beacon pulse angular speed (rad/s)
const BEACON_LIGHT_DISTANCE = 7;
const BEACON_LIGHT_MAX_INTENSITY = 2.2;

// Vertex sampling cap per mesh — extremes don't need every vertex.
const MAX_SAMPLED_VERTICES = 20000;

let sharedTexture = null;

// Soft radial glow: hot white core fading to transparent. Tinted per-light via
// SpriteMaterial.color.
function getNavLightTexture() {
  if (sharedTexture) return sharedTexture;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  sharedTexture = new THREE.CanvasTexture(canvas);
  sharedTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedTexture;
}

// Scans mesh vertices in root-local space and returns the extreme points used
// as light anchors: port wingtip (max Z), starboard wingtip (min Z), tail
// (max X — engine shimmer offsets confirm +X is aft), and spine top (max Y).
function findLightAnchors(root) {
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toLocal = new THREE.Matrix4();
  const v = new THREE.Vector3();

  const anchors = {
    port: new THREE.Vector3(),
    starboard: new THREE.Vector3(),
    tail: new THREE.Vector3(),
    top: new THREE.Vector3(),
  };
  let maxZ = -Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    toLocal.multiplyMatrices(invRoot, child.matrixWorld);
    const position = child.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(position.count / MAX_SAMPLED_VERTICES));
    for (let i = 0; i < position.count; i += stride) {
      v.fromBufferAttribute(position, i).applyMatrix4(toLocal);
      if (v.z > maxZ) { maxZ = v.z; anchors.port.copy(v); }
      if (v.z < minZ) { minZ = v.z; anchors.starboard.copy(v); }
      if (v.x > maxX) { maxX = v.x; anchors.tail.copy(v); }
      if (v.y > maxY) { maxY = v.y; anchors.top.copy(v); }
    }
  });

  return maxZ === -Infinity ? null : anchors;
}

function makeLightSprite(colorHex, localScale) {
  const material = new THREE.SpriteMaterial({
    map: getNavLightTexture(),
    color: colorHex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(localScale);
  sprite.userData.baseScale = localScale;
  return sprite;
}

// Idempotent — safe to call on every swap; cached models keep their rig.
export function attachNavLights(model) {
  if (!model || model.userData.navLights) return;

  const anchors = findLightAnchors(model);
  if (!anchors) return;

  // Sprites are children of the scaled model root, so convert world-unit
  // sizes into model-local units.
  const rootScale = model.scale?.x || 1;

  const group = new THREE.Group();
  const port = makeLightSprite(0xff2222, WINGTIP_SIZE / rootScale);
  const starboard = makeLightSprite(0x22ff44, WINGTIP_SIZE / rootScale);
  const strobe = makeLightSprite(0xffffff, STROBE_SIZE / rootScale);
  const beacon = makeLightSprite(0xff3344, BEACON_SIZE / rootScale);
  port.position.copy(anchors.port);
  starboard.position.copy(anchors.starboard);
  strobe.position.copy(anchors.tail);
  beacon.position.copy(anchors.top);
  group.add(port, starboard, strobe, beacon);

  // Real light so the beacon flash washes red over the fuselage at night.
  // Distance/intensity are world-space scalars — unaffected by root scale.
  const beaconLight = new THREE.PointLight(0xff3344, 0, BEACON_LIGHT_DISTANCE);
  beaconLight.position.copy(anchors.top);
  group.add(beaconLight);

  model.add(group);
  model.userData.navLights = {
    group,
    sprites: [port, starboard, strobe, beacon],
    portMaterial: port.material,
    starboardMaterial: starboard.material,
    strobeMaterial: strobe.material,
    beaconMaterial: beacon.material,
    beaconLight,
  };
}

export function updateNavLights(model, elapsedS) {
  const nav = model?.userData?.navLights;
  if (!nav) return;

  const { elevation } = computeSunDirection({
    latRad: flightState.lat,
    lonRad: flightState.lon,
    hourUTC: timeOfDayState.hourUTC,
  });
  // 0 in daylight → 1 once the sun dips below the horizon
  const darkness = 1 - THREE.MathUtils.smoothstep(elevation, -0.05, 0.12);
  const visibility = 0.18 + 0.82 * darkness;

  nav.portMaterial.opacity = 0.85 * visibility;
  nav.starboardMaterial.opacity = 0.85 * visibility;

  // White tail strobe: sharp double flash per cycle, like real anti-collision
  // strobes (on-off-on-off then a long gap).
  const t = elapsedS % STROBE_PERIOD_S;
  const flash = (t < 0.07 || (t >= 0.18 && t < 0.25)) ? 1 : 0;
  nav.strobeMaterial.opacity = flash * (0.5 + 0.5 * darkness);

  // Red beacon: soft rotating-beacon pulse.
  const pulse = Math.pow(Math.max(Math.sin(elapsedS * BEACON_RATE), 0), 3);
  nav.beaconMaterial.opacity = pulse * visibility;
  nav.beaconLight.intensity = pulse * darkness * BEACON_LIGHT_MAX_INTENSITY;

  // Halos bloom larger as it gets darker.
  const haloScale = 1 + darkness * 0.9;
  nav.sprites.forEach((sprite) => {
    sprite.scale.setScalar(sprite.userData.baseScale * haloScale);
  });
}
