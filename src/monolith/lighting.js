import * as THREE from 'three';
import { resolveAssetUrl } from './asset-url.js';

// ── Lighting rig ──────────────────────────────────────────────────────────────
// Creates and animates all Three.js lights used by MonolithScene.
// Two lighting modes are supported:
//   Mode A (Scene)     — a static backdrop of directional/spot/street lights,
//                        style selected by the active model collection definition.
//   Mode B (Particles) — 5000 falling particles with 6 proximity point lights
//                        that respond to how close particles are to the model.
//
// The returned object exposes only the methods MonolithScene needs;
// all internal light instances and buffers are fully encapsulated.

export function createLightingRig({ scene, currentSetDef, getCurrentModelIndex, getMonolith, guiParams }) {
  // ── Animation constants ─────────────────────────────────────────────────────
  const RING_TOP = 8;        // World-space Y where a moving ring light starts
  const RING_BOTTOM = -3;    // World-space Y where it exits the frame
  const RING_RANGE = RING_TOP - RING_BOTTOM;
  const RING_SPEED = 0.0004; // Normalised units per ms

  // ── Particle system (Lighting mode B) ──────────────────────────────────────
  // 5000 falling point-sprites that drift downward and wrap at y=-1.
  // Their positions drive proximity glow lights toward the active model.
  const ambient = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambient);

  const particleCount = 5000;
  const particleGeo = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 30;
    particlePositions[i * 3 + 1] = Math.random() * 25;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 30;
    velocities[i] = 0.01 + Math.random() * 0.03;
  }
  const particleColors = new Float32Array(particleCount * 3);
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

  const particleTexture = new THREE.TextureLoader().load(resolveAssetUrl('/textures/star_02.png'));
  const particleMat = new THREE.PointsMaterial({
    size: 0.18,
    sizeAttenuation: true,
    map: particleTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexColors: true,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  particles.visible = false;
  scene.add(particles);

  const glowLights = [];
  const glowCount = 6;
  const GLOW_RADIUS = 25;
  for (let i = 0; i < glowCount; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 8);
    light.position.set(0, -10, 0);
    scene.add(light);
    glowLights.push(light);
  }

  // ── Scene lights (Lighting mode A) ─────────────────────────────────────────
  // These are all created up front and selectively activated by the style
  // functions in sceneLightingEffects. resetAllLights() zeros their intensities
  // at the top of every updateSceneLighting() call so the active style has a
  // clean starting state each frame.
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

  let lightFrame = 0;
  const tempColor = new THREE.Color();
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

  function clearParticleGlow() {
    glowLights.forEach((light) => {
      light.intensity = 0;
    });
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
    if (!guiParams.ambientOverrideEnabled) {
      return 'off';
    }

    return `${guiParams.ambientColor}:${guiParams.ambientIntensity}`;
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

  function animateParticlePositions({ nowMs }) {
    const positions = particles.geometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3 + 1] -= velocities[i];
      positions[i * 3] += Math.sin(nowMs * 0.001 + i) * 0.002;
      if (positions[i * 3 + 1] < -1) {
        positions[i * 3 + 1] = 25;
        positions[i * 3] = (Math.random() - 0.5) * 30;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
      }
    }
    particles.geometry.attributes.position.needsUpdate = true;
    return positions;
  }

  function getParticleBaseHue({ hueType, time }) {
    if (hueType === 'warm') {
      return 0.04 + Math.sin(time) * 0.02 + Math.sin(time * 2.3) * 0.01 + Math.sin(time * 5.7) * 0.01;
    }
    if (hueType === 'rainbow') {
      return (time * 0.1) % 1.0;
    }
    return 0;
  }

  function updateParticleColors({ time, hueType }) {
    const colors = particles.geometry.attributes.color.array;
    let baseHue = getParticleBaseHue({ hueType, time });

    for (let i = 0; i < particleCount; i++) {
      const flicker = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 3 + i * 7.13));
      if (hueType === 'warm') {
        tempColor.setHSL(baseHue + Math.sin(i * 3.77 + time) * 0.03, 1.0, 0.35 + flicker * 0.4);
      } else if (hueType === 'rainbow') {
        tempColor.setHSL((baseHue + i / particleCount + Math.sin(i * 0.5 + time) * 0.1) % 1.0, 1.0, 0.35 + flicker * 0.4);
      } else {
        tempColor.setHSL(0, 0, 0.6 + flicker * 0.35);
      }
      colors[i * 3] = tempColor.r;
      colors[i * 3 + 1] = tempColor.g;
      colors[i * 3 + 2] = tempColor.b;
    }

    particles.geometry.attributes.color.needsUpdate = true;
    return baseHue;
  }

  function collectNearestParticlesToMonolith(positions, monolithPosition) {
    const nearest = [];

    for (let i = 0; i < particleCount; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const dx = x - monolithPosition.x;
      const dy = y - monolithPosition.y;
      const dz = z - monolithPosition.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < GLOW_RADIUS * GLOW_RADIUS) {
        nearest.push({ x, y, z, distSq });
        if (nearest.length > glowCount * 3) {
          nearest.sort((a, b) => a.distSq - b.distSq);
          nearest.length = glowCount;
        }
      }
    }

    nearest.sort((a, b) => a.distSq - b.distSq);
    return nearest;
  }

  function updateParticleGlowLights({ baseHue, hueType, nearestParticles }) {
    const saturation = hueType === 'warm' || hueType === 'rainbow' ? 1.0 : 0;

    for (let i = 0; i < glowCount; i++) {
      const light = glowLights[i];
      if (i < nearestParticles.length) {
        const particle = nearestParticles[i];
        light.position.set(particle.x, particle.y, particle.z);
        light.intensity = (1 - Math.sqrt(particle.distSq) / GLOW_RADIUS) * 6;
        light.color.setHSL(baseHue, saturation, 0.5);
      } else {
        light.intensity = 0;
      }
    }
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

    pointRing: ({ nowMs }) => {
      animatePointRingPair({ nowMs, intensityScale: 5 });
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
    pointRing: { animated: true, heroSpotlightIntensity: 0 },
  };

  // ── Per-frame update entry points ───────────────────────────────────────────

  function updateParticleLighting() {
    resetAllLights();
    ambient.color.set(0xffffff);
    ambient.intensity = 0.08;
    const nowMs = Date.now();
    const positions = animateParticlePositions({ nowMs });
    const t = nowMs * 0.005;
    const hueType = currentSetDef().particleHue;
    let baseHue = getParticleBaseHue({ hueType, time: t });

    // Throttle color + glow-light computation to every 4th frame to reduce
    // the per-frame cost of iterating all 5000 particles on the CPU.
    if (lightFrame % 4 === 0) {
      baseHue = updateParticleColors({ time: t, hueType });
      const monolith = getMonolith();
      const nearestParticles = collectNearestParticlesToMonolith(positions, monolith.position);
      updateParticleGlowLights({ baseHue, hueType, nearestParticles });
    }
    lightFrame++;
  }

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

  return {
    animateBloomRing,
    clearParticleGlow,
    particles,
    updateParticleLighting,
    updateSceneLighting,
  };
}
