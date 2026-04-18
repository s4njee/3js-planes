import * as THREE from 'three';
import { timeOfDayState } from '../time-of-day-store.js';
import { evaluateTimeOfDay } from '../solar-position.js';
import { flightState } from '../flight-store.js';

// ── Lighting rig ──────────────────────────────────────────────────────────────
// Creates and animates all Three.js lights used by MonolithScene.
// The rig provides a static/animated scene-lighting style selected by the
// active model collection definition.
//
// The returned object exposes only the methods MonolithScene needs;
// all internal light instances and buffers are fully encapsulated.

export function createLightingRig({ scene, currentSetDef, getCurrentModelIndex, getMonolith, guiParams, getCloudAmbientFactor }) {
  // ── Animation constants ─────────────────────────────────────────────────────
  const RING_TOP = 8;        // World-space Y where a moving ring light starts
  const RING_BOTTOM = -3;    // World-space Y where it exits the frame
  const RING_RANGE = RING_TOP - RING_BOTTOM;
  const RING_SPEED = 0.0004; // Normalised units per ms

  const ambient = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambient);

  // ── Scene lights (Lighting mode A) ─────────────────────────────────────────
  const ringGeometry = new THREE.TorusGeometry(3, 0.05, 8, 64);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
  const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.visible = false;
  scene.add(ringMesh);

  const ringLight = new THREE.PointLight(0xffffff, 3, 10);
  const ringLight2 = new THREE.PointLight(0xffffff, 3, 10);
  scene.add(ringLight);
  scene.add(ringLight2);

  const streetLight1 = new THREE.PointLight(0xffeedd, 0, 15);
  streetLight1.position.set(-1.5, 6, 0);
  scene.add(streetLight1);

  const streetLight2 = new THREE.PointLight(0xffeedd, 0, 15);
  streetLight2.position.set(1.5, 6, 0);
  scene.add(streetLight2);

  const dirRingLight = new THREE.DirectionalLight(0xffffff, 0);
  dirRingLight.position.set(0, 8, 0);
  dirRingLight.target.position.set(0, 0, 0);
  scene.add(dirRingLight);
  scene.add(dirRingLight.target);

  const dirRingLight2 = new THREE.DirectionalLight(0xffffff, 0);
  dirRingLight2.position.set(0, 8, 0);
  dirRingLight2.target.position.set(0, 0, 0);
  scene.add(dirRingLight2);
  scene.add(dirRingLight2.target);

  const warmLight = new THREE.DirectionalLight(0xff8844, 0);
  warmLight.position.set(-3, 3, 2);
  scene.add(warmLight);

  const coolLight = new THREE.DirectionalLight(0x4488ff, 0);
  coolLight.position.set(3, 3, 2);
  scene.add(coolLight);

  const heroSpotLight = new THREE.SpotLight(0xfff2d6, 0, 45, Math.PI / 5, 0.45, 1.4);
  heroSpotLight.position.set(4, 10, 8);
  heroSpotLight.target.position.set(0, 2.5, 0);
  scene.add(heroSpotLight);
  scene.add(heroSpotLight.target);

  let lastStaticSceneSignature = null;

  function resetAllLights() {
    ringLight.intensity = 0;
    ringLight2.intensity = 0;
    dirRingLight.intensity = 0;
    dirRingLight2.intensity = 0;
    warmLight.intensity = 0;
    coolLight.intensity = 0;
    streetLight1.intensity = 0;
    streetLight2.intensity = 0;
    heroSpotLight.intensity = 0;
    dirRingLight.visible = false;
    dirRingLight2.visible = false;
    warmLight.visible = false;
    coolLight.visible = false;
    heroSpotLight.visible = false;
  }

  function getLightingStyle() {
    const def = currentSetDef();
    const modelIndex = getCurrentModelIndex();
    if (def.lightingOverrides?.[modelIndex]) return def.lightingOverrides[modelIndex];
    return def.lightingStyle;
  }

  function applyAmbientOverrides() {
    if (!guiParams.ambientOverrideEnabled) return;
    ambient.color.set(guiParams.ambientColor);
    ambient.intensity = guiParams.ambientIntensity;
  }

  function getAmbientOverrideSignature() {
    const todKey = Math.round(timeOfDayState.hourUTC * 10);
    if (!guiParams.ambientOverrideEnabled) {
      return `off:${todKey}`;
    }

    return `${guiParams.ambientColor}:${guiParams.ambientIntensity}:${todKey}`;
  }

  function applyCloudAmbientFactor() {
    const cloudAmbientFactor = getCloudAmbientFactor ? getCloudAmbientFactor() : 1;
    ambient.intensity *= cloudAmbientFactor;
  }

  function getPulse(progress) {
    return Math.min(Math.min(progress, 1 - progress) * 5, 1);
  }

  function setHeroSpotlightTarget(monolith) {
    heroSpotLight.target.position.copy(monolith.position);
    heroSpotLight.target.updateMatrixWorld();
    heroSpotLight.position.set(
      monolith.position.x + 4,
      monolith.position.y + 10,
      monolith.position.z + 8,
    );
  }

  function animateDirectionalRingPair({ nowMs, intensityScale, speed = RING_SPEED, zOffset = 2 }) {
    dirRingLight.visible = true;
    dirRingLight2.visible = true;
    const progress = nowMs * speed;
    const p1 = progress % 1.0;
    const p2 = (progress + 0.5) % 1.0;
    dirRingLight.position.set(0, RING_TOP - p1 * RING_RANGE, zOffset);
    dirRingLight.intensity = intensityScale * getPulse(p1);
    dirRingLight2.position.set(0, RING_TOP - p2 * RING_RANGE, -zOffset);
    dirRingLight2.intensity = intensityScale * getPulse(p2);
  }

  function animatePointRingPair({ nowMs, intensityScale, speed = RING_SPEED, distance = 30 }) {
    ringLight.distance = distance;
    ringLight2.distance = distance;
    const progress = nowMs * speed;
    const p1 = progress % 1.0;
    const p2 = (progress + 0.5) % 1.0;
    ringLight.position.set(0, RING_TOP - p1 * RING_RANGE, 0);
    ringLight.intensity = intensityScale * getPulse(p1);
    ringLight2.position.set(0, RING_TOP - p2 * RING_RANGE, 0);
    ringLight2.intensity = intensityScale * getPulse(p2);
  }

  function animateSingleDirectionalRing({ nowMs, intensityScale, speed = 0.00015, zOffset = 2 }) {
    dirRingLight.visible = true;
    const progress = (nowMs * speed) % 1.0;
    const center = Math.abs(progress - 0.5) * 2;
    dirRingLight.position.set(0, RING_TOP - progress * RING_RANGE, zOffset);
    dirRingLight.intensity = intensityScale * Math.pow(1 - center, 4);
  }

  function animateStreetlights({
    nowMs,
    speed,
    far,
    near,
    xOffset = 1.5,
    height = 6,
    intensityScale,
    falloffDivisor,
  }) {
    const range = far - near;
    const progress = nowMs * speed;
    const p1 = progress % 1.0;
    const p2 = (progress + 0.5) % 1.0;
    const z1 = far - p1 * range;
    const z2 = far - p2 * range;
    const falloff1 = Math.exp(-(z1 * z1) / falloffDivisor);
    const falloff2 = Math.exp(-(z2 * z2) / falloffDivisor);
    streetLight1.position.set(-xOffset, height, z1);
    streetLight2.position.set(xOffset, height, z2);
    streetLight1.intensity = intensityScale * falloff1;
    streetLight2.intensity = intensityScale * falloff2;
  }

  // ── Scene lighting style effects ───────────────────────────────────────────
  // Each entry corresponds to a model-collection lightingStyle value.
  // Called every frame by updateSceneLighting() after resetAllLights().
  const sceneLightingEffects = {
    neon: ({ nowMs }) => {
      const angle = nowMs * 0.0004;
      ambient.color.set(0xcc44ff);
      ambient.intensity = 1.0;
      warmLight.visible = true;
      coolLight.visible = true;
      warmLight.color.set(0xff1493);
      coolLight.color.set(0x8800ff);
      warmLight.position.set(Math.cos(angle) * 4, 3, Math.sin(angle) * 4);
      coolLight.position.set(Math.cos(angle + Math.PI) * 4, 2, Math.sin(angle + Math.PI) * 4);
      warmLight.intensity = 2;
      coolLight.intensity = 2;
    },

    splitTone: ({ nowMs }) => {
      const angle = nowMs * 0.0003;
      warmLight.visible = true;
      coolLight.visible = true;
      warmLight.color.set(0xff8844);
      coolLight.color.set(0x4488ff);
      warmLight.position.set(Math.cos(angle) * 4, 3, Math.sin(angle) * 4);
      coolLight.position.set(Math.cos(angle + Math.PI) * 4, 3, Math.sin(angle + Math.PI) * 4);
      ambient.intensity = 0.3;
      warmLight.intensity = 1.5;
      coolLight.intensity = 1.5;
    },

    dualRingBright: ({ nowMs }) => {
      ambient.intensity = 0.4;
      animateDirectionalRingPair({ nowMs, intensityScale: 6 });
    },

    dualRing: ({ nowMs }) => {
      ambient.intensity = 0.2;
      animateDirectionalRingPair({ nowMs, intensityScale: 3 });
    },

    singleRing: ({ nowMs }) => {
      ambient.intensity = 0.05;
      animateSingleDirectionalRing({ nowMs, intensityScale: 4 });
    },

    streetlightSlow: ({ nowMs }) => {
      ambient.intensity = 0.5;
      animateStreetlights({
        nowMs,
        speed: 0.00012,
        far: 20,
        near: -15,
        intensityScale: 20,
        falloffDivisor: 25,
      });
    },

    streetlight: ({ nowMs }) => {
      ambient.intensity = 0.5;
      animateStreetlights({
        nowMs,
        speed: 0.0008,
        far: 15,
        near: -10,
        intensityScale: 20,
        falloffDivisor: 18,
      });
    },

    ambientBright: () => {
      ambient.intensity = 8.4;
      dirRingLight.visible = true;
      dirRingLight.position.set(0, 10, 2);
      dirRingLight.target.position.set(0, 0, 0);
      dirRingLight.intensity = 6;
    },

    ambientOnly: () => {
      ambient.intensity = 2.8;
    },

    pointRing: () => {
      // Static overhead key light + softer fill from below
      ambient.intensity = 0.4;
      ringLight.distance = 40;
      ringLight2.distance = 40;
      ringLight.position.set(0, 12, 2);
      ringLight.intensity = 8;
      ringLight2.position.set(0, 4, -3);
      ringLight2.intensity = 3;
    },
  };

  const sceneLightingConfigs = {
    neon: { animated: true, heroSpotlightIntensity: 5.5 },
    splitTone: { animated: true, heroSpotlightIntensity: 5.5 },
    dualRingBright: { animated: true, heroSpotlightIntensity: 0 },
    dualRing: { animated: true, heroSpotlightIntensity: 0 },
    singleRing: { animated: true, heroSpotlightIntensity: 0 },
    streetlightSlow: { animated: true, heroSpotlightIntensity: 5.5 },
    streetlight: { animated: true, heroSpotlightIntensity: 5.5 },
    ambientBright: { animated: false, heroSpotlightIntensity: 0 },
    ambientOnly: { animated: false, heroSpotlightIntensity: 0 },
    pointRing: { animated: false, heroSpotlightIntensity: 0 },
  };

  // ── Per-frame update entry points ───────────────────────────────────────────

  function updateSceneLighting({ forceRefresh = false } = {}) {
    const style = getLightingStyle();
    const effect = sceneLightingEffects[style] ?? sceneLightingEffects.pointRing;
    const config = sceneLightingConfigs[style] ?? sceneLightingConfigs.pointRing;
    const ambientOverrideSignature = getAmbientOverrideSignature();
    const staticSceneSignature = `${style}:${ambientOverrideSignature}`;

    if (!forceRefresh && !config.animated && lastStaticSceneSignature === staticSceneSignature) {
      return;
    }

    const monolith = config.heroSpotlightIntensity > 0 ? getMonolith() : null;
    const nowMs = Date.now();

    if (config.animated) {
      lastStaticSceneSignature = null;
    } else {
      lastStaticSceneSignature = staticSceneSignature;
    }

    ambient.color.set(0xffffff);
    resetAllLights();
    if (monolith) {
      heroSpotLight.visible = true;
      setHeroSpotlightTarget(monolith);
    }
    effect({ monolith, nowMs, style });

    heroSpotLight.intensity = config.heroSpotlightIntensity;

    applyAmbientOverrides();
    applyCloudAmbientFactor();

    // ── Time-of-day pass ──────────────────────────────────────────────────────
    const tod = evaluateTimeOfDay({
      hourUTC: timeOfDayState.hourUTC,
      latRad: flightState.lat,
      lonRad: flightState.lon,
    });

    if (!guiParams.ambientOverrideEnabled) {
      ambient.intensity = tod.ambientIntensity;
      ambient.color.copy(tod.ambientColor);
    }

    // Use dirRingLight as the sun when the current style hasn't activated it
    if (!dirRingLight.visible) {
      dirRingLight.visible = true;
      dirRingLight.position.copy(tod.sunDir).multiplyScalar(20);
      dirRingLight.color.copy(tod.sunColor);
      dirRingLight.intensity = tod.sunIntensity;
      dirRingLight.target.position.set(0, 0, 0);
      dirRingLight.target.updateMatrixWorld();
    }

    // Drive body background from TOD palette (keeps MonolithCanvas transparent
    // so the terrain canvas beneath it remains visible)
    document.body.style.background = tod.backgroundColor.getStyle();
  }

  function animateBloomRing() {
    const nowMs = Date.now();
    animateDirectionalRingPair({ nowMs, intensityScale: 1.5 });

    const lowTop = 3;
    const lowBottom = -2;
    const lowRange = lowTop - lowBottom;
    const progress = nowMs * RING_SPEED * 0.8;
    const p1 = progress % 1.0;
    const p2 = (progress + 0.5) % 1.0;
    streetLight1.position.set(-1.5, lowTop - p1 * lowRange, 2);
    streetLight1.intensity = 1.5 * getPulse(p1);
    streetLight2.position.set(1.5, lowTop - p2 * lowRange, -2);
    streetLight2.intensity = 1.5 * getPulse(p2);
  }

  function dispose() {
    scene.remove(ambient);
    scene.remove(ringMesh);
    scene.remove(ringLight);
    scene.remove(ringLight2);
    scene.remove(streetLight1);
    scene.remove(streetLight2);
    scene.remove(dirRingLight);
    scene.remove(dirRingLight.target);
    scene.remove(dirRingLight2);
    scene.remove(dirRingLight2.target);
    scene.remove(warmLight);
    scene.remove(coolLight);
    scene.remove(heroSpotLight);
    scene.remove(heroSpotLight.target);
    ringGeometry.dispose();
    ringMaterial.dispose();
  }

  return {
    animateBloomRing,
    dispose,
    updateSceneLighting,
  };
}
