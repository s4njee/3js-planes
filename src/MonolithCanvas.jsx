import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

import { createGuiControls, createDefaultGuiParams } from './monolith/gui.js';
import { createLightingRig } from './monolith/lighting.js';
import { createMaterialManager } from './monolith/materials.js';
import { createOverlays } from './monolith/overlays.js';
import { MODEL_SET_DEF } from './monolith/set-defs.js';
import { createUI } from './monolith/ui.js';
import { resolveAssetUrl } from './monolith/asset-url.js';
import { cachedFetch, hasCachedModel } from './monolith/model-cache.js';
import SafeCanvas from './shared/webgl/SafeCanvas.tsx';
import {
  SharedEffectStack,
  createSharedEffectHotkeyListener,
  getHueCycleHue,
  SHARED_FX_CINEMATIC,
  SHARED_FX_DATABEND,
  SHARED_FX_NONE,
  setChromaticAberrationState,
  toggleChromaticAberrationState,
  toggleHueCycleState,
  toggleSharedFxMode,
  toggleXrayModeState,
} from './shared/special-effects/index.ts';

const LIGHTING_MODE_SCENE = 0;
const LIGHTING_MODE_PARTICLES = 1;
const LIGHTING_MODE_LABELS = [
  'A (Scene)',
  'B (Particles)',
];
const CHROMATIC_OSCILLATION_SPEED = 3.2;
const ANIMATION_SPEED_BOOST_MULTIPLIER = 1.4;
const TOUCH_LONG_PRESS_DELAY_MS = 420;
const TOUCH_TAP_MAX_MOVEMENT_PX = 12;
const TOUCH_DOUBLE_TAP_MAX_DELAY_MS = 300;
const TOUCH_DOUBLE_TAP_MAX_DISTANCE_PX = 24;
const BASE_CAMERA_FOV = 45;
const BOOST_CAMERA_FOV = 75;
const BOOST_FOV_LERP_SPEED = 6;
const BOOST_SHAKE_LERP_SPEED = 8;
const BOOST_SHAKE_X_AMPLITUDE = 0.035;
const BOOST_SHAKE_Y_AMPLITUDE = 0.025;
const BOOST_SHAKE_Z_AMPLITUDE = 0.05;
const BASE_SCENE_BACKGROUND = 0x050709;
const SKY_DOME_RADIUS = 90;
const CINEMATIC_EXPOSURE_MULTIPLIER = 0.58;
const CLOUDS_ENABLED = false;
const CLOUD_LAYER_COUNT = 5;
const CLOUDS_PER_LAYER = 20;
const CLOUD_SCROLL_SPEED = 9;
const CLOUD_FIELD_WIDTH = 95;
const CLOUD_FIELD_DEPTH = 180;
const CLOUD_FIELD_HEIGHT = 26;
const CLOUD_AMBIENT_MIN_FACTOR = 0.58;
const OCEAN_ENABLED = true;
const OCEAN_Y = -8;
const OCEAN_SIZE = 400;
const GOD_RAYS_ENABLED = true;
const TERRAIN_ENABLED = false;
const ELEVATION_SPEED = 5.5;
const ELEVATION_LERP_SPEED = 5.5;
const ELEVATION_MIN_OFFSET = -3.5;
const ELEVATION_MAX_OFFSET = 28.0;
const ELEVATION_PITCH_MAX = 0.2;
const ELEVATION_PITCH_LERP_SPEED = 6.5;
const TERRAIN_TILE_COUNT = 3;
const TERRAIN_TILE_LENGTH = 180;
const TERRAIN_TILE_OVERLAP = 20;
const TERRAIN_SCROLL_SPEED = 24;
const TERRAIN_BASE_Y = -60;
const TERRAIN_WIDTH = 220;
const TERRAIN_RESOLUTION = 40;
const TERRAIN_TREE_COUNT = 180;
const TERRAIN_TREE_ATTEMPT_MULTIPLIER = 10;
const TERRAIN_SAMPLE_Z_SCALE = 1.08;
const TERRAIN_SAMPLE_X_DRIFT = 32;
const TERRAIN_SAMPLE_Z_WARP = 10;
const TERRAIN_GENERATOR_ARGS = Object.freeze({
  seed: 17,
  gain: 0.52,
  lacunarity: 1.78,
  frequency: 0.011,
  amplitude: 1.08,
  altitude: 0.18,
  erosion: 0.84,
  erosionSoftness: 0.32,
  rivers: 0.48,
  riversFrequency: 1.15,
  riversSeed: 31,
  riverWidth: 0.42,
  riverFalloff: 0.42,
  smoothLowerPlanes: 0.58,
  octaves: 7,
});
const TERRAIN_HEIGHT_STRENGTH = 12.4 * (1 - TERRAIN_GENERATOR_ARGS.smoothLowerPlanes * 0.5);
const TERRAIN_RIVER_WIDTH = THREE.MathUtils.mapLinear(TERRAIN_GENERATOR_ARGS.riverWidth, 0, 1, 0.5, 0.44);
const TERRAIN_RIVER_FALLOFF = TERRAIN_GENERATOR_ARGS.riverFalloff * 0.3;

function fract(value) {
  return value - Math.floor(value);
}

function hash2D(x, y, seed) {
  return fract(Math.sin((x * 127.1) + (y * 311.7) + (seed * 74.7)) * 43758.5453123);
}

function sampleValueNoise2D(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - (2 * fx));
  const uy = fy * fy * (3 - (2 * fy));

  const n00 = hash2D(ix, iy, seed);
  const n10 = hash2D(ix + 1, iy, seed);
  const n01 = hash2D(ix, iy + 1, seed);
  const n11 = hash2D(ix + 1, iy + 1, seed);

  const nx0 = THREE.MathUtils.lerp(n00, n10, ux);
  const nx1 = THREE.MathUtils.lerp(n01, n11, ux);
  return THREE.MathUtils.lerp(nx0, nx1, uy);
}

function sampleSignedNoise2D(x, y, seed) {
  return (sampleValueNoise2D(x, y, seed) * 2) - 1;
}

function createFbmNoiseSampler({
  octaves = 1,
  lacunarity = 2,
  frequency = 0.01,
  amplitude = 1,
  gain = 0.5,
  seed = 0,
  offset = 0,
}) {
  return (x, y) => {
    let value = 0;
    let amp = amplitude;
    let freq = frequency;

    for (let i = 0; i < octaves; i += 1) {
      value += amp * sampleSignedNoise2D(x * freq, y * freq, seed + (i * 101));
      freq *= lacunarity;
      amp *= gain;
    }

    return value + offset;
  };
}

function getTerrainSampleCoordinates(x, logicalZ) {
  return {
    sampleX: x
      + (Math.sin(logicalZ * 0.0065) * TERRAIN_SAMPLE_X_DRIFT)
      + (Math.sin(logicalZ * 0.0023) * 12),
    sampleZ: (logicalZ * TERRAIN_SAMPLE_Z_SCALE) + (Math.sin(x * 0.021) * TERRAIN_SAMPLE_Z_WARP),
  };
}

const terrainBaseNoise = createFbmNoiseSampler({
  octaves: TERRAIN_GENERATOR_ARGS.octaves,
  lacunarity: TERRAIN_GENERATOR_ARGS.lacunarity,
  gain: TERRAIN_GENERATOR_ARGS.gain,
  seed: TERRAIN_GENERATOR_ARGS.seed,
  offset: 0.25,
  amplitude: TERRAIN_GENERATOR_ARGS.amplitude,
  frequency: TERRAIN_GENERATOR_ARGS.frequency,
});

const terrainBiomeNoise = createFbmNoiseSampler({
  octaves: 1,
  seed: TERRAIN_GENERATOR_ARGS.seed + 4,
  frequency: 0.012,
  amplitude: 1,
  gain: 1,
  lacunarity: 1,
});

const terrainErosionNoise = createFbmNoiseSampler({
  octaves: 3,
  lacunarity: 1.8,
  gain: 0.5,
  seed: TERRAIN_GENERATOR_ARGS.seed + 1,
  offset: 0.3,
  amplitude: 0.2,
  frequency: TERRAIN_GENERATOR_ARGS.frequency,
});

const terrainRiverNoise = createFbmNoiseSampler({
  octaves: 4,
  gain: 0.35,
  lacunarity: 2,
  seed: TERRAIN_GENERATOR_ARGS.riversSeed,
  amplitude: 0.2,
  frequency: TERRAIN_GENERATOR_ARGS.frequency * TERRAIN_GENERATOR_ARGS.riversFrequency,
});

function sampleTerrainField(x, worldZ) {
  const { sampleX, sampleZ } = getTerrainSampleCoordinates(x, worldZ);
  let terrainNoise = terrainBaseNoise(sampleX, sampleZ);

  const biomeNoise = terrainBiomeNoise(sampleX, sampleZ);
  const erosionNoise = terrainBiomeNoise(sampleX + 500, sampleZ + 500) * 0.6 - 0.1;
  const erosionSoftness = erosionNoise + TERRAIN_GENERATOR_ARGS.erosionSoftness;
  let erosion = terrainErosionNoise(sampleX, sampleZ);

  erosion = THREE.MathUtils.smoothstep(erosion, 0, 1);
  erosion = Math.pow(erosion, 1 + erosionSoftness);
  erosion = THREE.MathUtils.clamp(THREE.MathUtils.pingpong(erosion * 2, 1) - 0.3, 0, 100);

  terrainNoise *= THREE.MathUtils.lerp(1, erosion, TERRAIN_GENERATOR_ARGS.erosion * terrainNoise);

  let riverMask = (Math.abs(terrainRiverNoise(sampleX, sampleZ)) - 0.5) * 2;
  riverMask = THREE.MathUtils.pingpong(riverMask, 0.5);
  riverMask = THREE.MathUtils.clamp(
    THREE.MathUtils.mapLinear(riverMask, TERRAIN_RIVER_WIDTH, TERRAIN_RIVER_WIDTH + TERRAIN_RIVER_FALLOFF, 1, 0),
    0,
    1,
  );
  riverMask = (1 - THREE.MathUtils.smoothstep(riverMask, 0, 1)) * 0.5;

  const altitudeNoise = biomeNoise * 1.4 - 0.75;
  terrainNoise += TERRAIN_GENERATOR_ARGS.altitude + altitudeNoise;
  terrainNoise = THREE.MathUtils.lerp(
    terrainNoise * terrainNoise,
    terrainNoise * terrainNoise * terrainNoise,
    TERRAIN_GENERATOR_ARGS.smoothLowerPlanes,
  );

  return {
    biomeNoise,
    height: (terrainNoise - (riverMask * TERRAIN_GENERATOR_ARGS.rivers)) * TERRAIN_HEIGHT_STRENGTH,
    riverMask,
  };
}

function getTerrainHeight(x, worldZ) {
  return sampleTerrainField(x, worldZ).height;
}

function getTerrainBiomeFromField(field, height = field.height) {
  const moisture = THREE.MathUtils.clamp(0.54 + (field.biomeNoise * 0.3) + (field.riverMask * 0.95), 0.18, 1.15);
  const fertility = THREE.MathUtils.clamp(moisture - (Math.max(height, 0) * 0.024), 0.08, 1.05);
  return {
    fertility,
    moisture,
    riverMask: field.riverMask,
  };
}

function getTerrainBiome(x, worldZ, height) {
  return getTerrainBiomeFromField(sampleTerrainField(x, worldZ), height);
}

function getTerrainNormal(x, worldZ) {
  const sampleOffset = 0.8;
  const slopeX = getTerrainHeight(x + sampleOffset, worldZ) - getTerrainHeight(x - sampleOffset, worldZ);
  const slopeZ = getTerrainHeight(x, worldZ + sampleOffset) - getTerrainHeight(x, worldZ - sampleOffset);
  return new THREE.Vector3(-slopeX, sampleOffset * 2, -slopeZ).normalize();
}

function disposeTerrainTileContents(tileGroup) {
  tileGroup.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    child.material.dispose();
  });
  tileGroup.clear();
}

function populateTerrainTile(tileGroup, { renderZOffset, logicalZOffset }) {
  const length = TERRAIN_TILE_LENGTH + TERRAIN_TILE_OVERLAP;
  const widthSegments = TERRAIN_RESOLUTION;
  const lengthSegments = TERRAIN_RESOLUTION;
  const geometry = new THREE.PlaneGeometry(TERRAIN_WIDTH, length, widthSegments, lengthSegments);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const normals = new Float32Array(positions.count * 3);
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  const vertexNormal = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const logicalWorldZ = z + logicalZOffset;
    const field = sampleTerrainField(x, logicalWorldZ);
    const height = field.height;
    positions.setY(i, height);
    vertexNormal.copy(getTerrainNormal(x, logicalWorldZ));
    normals[i * 3] = vertexNormal.x;
    normals[i * 3 + 1] = vertexNormal.y;
    normals[i * 3 + 2] = vertexNormal.z;

    const { fertility, moisture } = getTerrainBiomeFromField(field, height);
    const hue = THREE.MathUtils.clamp(0.315 + (fertility * 0.008) - (height * 0.0008), 0.305, 0.335);
    const saturation = THREE.MathUtils.clamp(0.11 + (moisture * 0.065), 0.1, 0.19);
    const lightness = THREE.MathUtils.clamp(0.026 + ((height + 6.5) / 150) + (fertility * 0.004), 0.024, 0.062);
    color.setHSL(hue, saturation, lightness);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  tileGroup.add(mesh);

  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.18, 1.3, 6);
  const trunkMaterial = new THREE.MeshBasicMaterial({ color: 0x2b2119 });
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, TERRAIN_TREE_COUNT);
  const canopyGeometry = new THREE.ConeGeometry(0.7, 2.5, 8);
  const canopyMaterial = new THREE.MeshBasicMaterial({ color: 0x152a18 });
  const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, TERRAIN_TREE_COUNT);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();

  let plantedTrees = 0;
  let attempts = 0;
  while (plantedTrees < TERRAIN_TREE_COUNT && attempts < TERRAIN_TREE_COUNT * TERRAIN_TREE_ATTEMPT_MULTIPLIER) {
    attempts += 1;
    const x = (Math.random() - 0.5) * (TERRAIN_WIDTH - 14);
    const z = (Math.random() - 0.5) * (length - 10);
    const logicalWorldZ = z + logicalZOffset;
    const field = sampleTerrainField(x, logicalWorldZ);
    const height = field.height;
    const { fertility, riverMask } = getTerrainBiomeFromField(field, height);

    const slopeX = getTerrainHeight(x + 0.8, logicalWorldZ) - getTerrainHeight(x - 0.8, logicalWorldZ);
    const slopeZ = getTerrainHeight(x, logicalWorldZ + 0.8) - getTerrainHeight(x, logicalWorldZ - 0.8);
    const slope = Math.hypot(slopeX, slopeZ);
    const inRiver = riverMask > 0.12;

    if (fertility < 0.5 || slope > 1.35 || inRiver || height < -4.9) {
      continue;
    }

    normal.set(-slopeX, 1.8, -slopeZ).normalize();
    tangent.set(1, slopeX, 0).normalize();
    bitangent.crossVectors(normal, tangent).normalize();
    tangent.crossVectors(bitangent, normal).normalize();
    matrix.makeBasis(tangent, normal, bitangent);
    quaternion.setFromRotationMatrix(matrix);

    const trunkHeight = 1.1 + Math.random() * 1.2;
    const canopyHeight = 2.1 + Math.random() * 2.3;
    const canopyRadius = 0.45 + Math.random() * 0.26;

    position.set(x, height + (trunkHeight * 0.5), z);
    scale.set(0.7, trunkHeight / 1.3, 0.7);
    matrix.compose(position, quaternion, scale);
    trunkMesh.setMatrixAt(plantedTrees, matrix);

    position.set(x, height + trunkHeight + (canopyHeight * 0.44), z);
    scale.set(canopyRadius, canopyHeight / 1.9, canopyRadius);
    matrix.compose(position, quaternion, scale);
    canopyMesh.setMatrixAt(plantedTrees, matrix);

    plantedTrees += 1;
  }

  trunkMesh.count = plantedTrees;
  canopyMesh.count = plantedTrees;
  trunkMesh.instanceMatrix.needsUpdate = true;
  canopyMesh.instanceMatrix.needsUpdate = true;
  tileGroup.add(trunkMesh);
  tileGroup.add(canopyMesh);

  tileGroup.userData.logicalZOffset = logicalZOffset;
  tileGroup.position.set(0, TERRAIN_BASE_Y, renderZOffset);
}

function createTerrainTile({ renderZOffset, logicalZOffset }) {
  const tileGroup = new THREE.Group();
  populateTerrainTile(tileGroup, { renderZOffset, logicalZOffset });
  return tileGroup;
}

function createSkyDome() {
  const geometry = new THREE.SphereGeometry(SKY_DOME_RADIUS, 48, 32);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      yaw: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDirection;

      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float yaw;
      varying vec3 vDirection;

      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }

      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float n000 = hash(i + vec3(0.0, 0.0, 0.0));
        float n100 = hash(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash(i + vec3(1.0, 1.0, 1.0));

        float nx00 = mix(n000, n100, f.x);
        float nx10 = mix(n010, n110, f.x);
        float nx01 = mix(n001, n101, f.x);
        float nx11 = mix(n011, n111, f.x);
        float nxy0 = mix(nx00, nx10, f.y);
        float nxy1 = mix(nx01, nx11, f.y);
        return mix(nxy0, nxy1, f.z);
      }

      float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 5; i += 1) {
          value += noise(p) * amplitude;
          p *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec3 dir = normalize(vDirection);
        float horizon = clamp((dir.y + 0.22) * 0.9, 0.0, 1.0);

        vec3 zenith = vec3(0.02, 0.04, 0.14);
        vec3 midSky = vec3(0.06, 0.10, 0.28);
        vec3 horizonColor = vec3(0.85, 0.38, 0.10);
        vec3 base = mix(horizonColor, midSky, smoothstep(0.0, 0.38, horizon));
        base = mix(base, zenith, smoothstep(0.35, 1.0, horizon));

        float sunsetBand = smoothstep(-0.22, 0.1, dir.y) * (1.0 - smoothstep(0.1, 0.34, dir.y));
        base += vec3(0.45, 0.18, 0.04) * sunsetBand * 0.7;
        base += vec3(0.3, 0.08, 0.02) * sunsetBand * 0.5;
        base += vec3(0.5, 0.25, 0.06) * pow(sunsetBand, 1.6) * 0.4;

        vec3 nebulaPos = vec3(
          dir.x * 2.8 + time * 0.015,
          dir.y * 1.8 - time * 0.01,
          dir.z * 2.8
        );
        float nebula = fbm(nebulaPos);
        float wisps = smoothstep(0.45, 0.8, nebula) * smoothstep(-0.2, 0.78, dir.y);
        float secondary = smoothstep(0.52, 0.88, fbm(nebulaPos * 1.9 + 7.3)) * 0.78;
        float cloudLayer = smoothstep(0.42, 0.74, fbm(nebulaPos * 1.3 + vec3(4.2, -1.8, 2.7))) * smoothstep(-0.24, 0.38, dir.y);
        float highClouds = smoothstep(0.5, 0.76, fbm(nebulaPos * 2.4 + vec3(-6.0, 2.5, 1.2))) * smoothstep(0.08, 0.7, dir.y) * 0.55;

        vec3 nebulaBlue = vec3(0.06, 0.10, 0.28);
        vec3 nebulaDeep = vec3(0.10, 0.12, 0.32);
        vec3 nebulaGlow = vec3(0.7, 0.30, 0.08);
        vec3 cloudWarm = vec3(0.85, 0.40, 0.10);
        vec3 cloudAmber = vec3(0.7, 0.25, 0.06);
        base += nebulaBlue * wisps * 0.2;
        base += nebulaDeep * wisps * 0.35;
        base += nebulaGlow * secondary * 0.3;
        base += cloudWarm * cloudLayer * 0.22;
        base += cloudAmber * cloudLayer * 0.18;
        base += vec3(0.12, 0.16, 0.32) * highClouds * 0.25;

        // ── Sun disc + glow ─────────────────────────────────────────
        vec3 sunDir = normalize(vec3(-0.55, 0.06, -1.0));
        float sunDot = dot(dir, sunDir);
        float sunAngle = max(sunDot, 0.0);

        // Bright white core
        float sunDisc = smoothstep(0.9980, 0.9994, sunAngle);
        base += vec3(1.0, 0.95, 0.8) * sunDisc * 6.0;

        // Inner glow — yellowish-white
        float sunGlow = pow(sunAngle, 32.0);
        base += vec3(1.0, 0.7, 0.3) * sunGlow * 1.8;

        // Mid glow
        float sunMid = pow(sunAngle, 12.0);
        base += vec3(0.9, 0.45, 0.12) * sunMid * 0.7;

        // Wide warm wash
        float sunWash = pow(sunAngle, 5.0);
        base += vec3(0.5, 0.18, 0.05) * sunWash * 0.4;

        // ── God rays (crepuscular rays) ─────────────────────────────
        float cloudOcclusion = wisps + cloudLayer * 0.7 + highClouds * 0.5;

        // Guard against zero-length toSun (when dir == sunDir)
        vec3 toSun = dir - sunDir * sunDot;
        float toSunLen = length(toSun);
        float rayAngle = toSunLen > 0.001 ? atan(toSun.y, toSun.x) : 0.0;

        // Multiple overlapping ray frequencies for natural look
        float rays = 0.0;
        rays += sin(rayAngle * 7.0 + time * 0.08) * 0.5 + 0.5;
        rays *= sin(rayAngle * 13.0 - time * 0.05) * 0.3 + 0.7;
        rays += (sin(rayAngle * 23.0 + time * 0.12) * 0.5 + 0.5) * 0.3;

        // Noise-based variation so rays aren't perfectly uniform
        float rayNoise = noise(vec3(rayAngle * 3.0, time * 0.1, 0.0));
        rays *= 0.6 + rayNoise * 0.4;

        // Rays only visible near the sun, fading with angular distance
        float rayFalloff = pow(max(sunAngle, 0.0), 3.0);

        // Cloud gaps modulate ray brightness
        float rayOcclusion = 1.0 - cloudOcclusion * 0.7;
        rayOcclusion = max(rayOcclusion, 0.3);

        // Rays visible mainly near and below horizon
        float rayHeightMask = smoothstep(0.5, 0.0, dir.y) * smoothstep(-0.4, -0.1, dir.y);

        vec3 rayColor = vec3(0.7, 0.35, 0.15);
        base += rayColor * rays * rayFalloff * rayOcclusion * rayHeightMask * 0.2;

        float vignette = 1.0 - smoothstep(0.15, 1.0, length(dir.xz) * 0.85);
        base += vec3(0.07, 0.025, 0.09) * vignette * 0.28;

        gl_FragColor = vec4(base, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}

function createCloudTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);

  const puffs = [
    { x: 0.34, y: 0.52, r: 0.26, a: 0.9 },
    { x: 0.52, y: 0.44, r: 0.24, a: 0.82 },
    { x: 0.66, y: 0.54, r: 0.2, a: 0.74 },
    { x: 0.48, y: 0.64, r: 0.2, a: 0.66 },
  ];

  puffs.forEach(({ x, y, r, a }) => {
    const gradient = ctx.createRadialGradient(
      x * size,
      y * size,
      size * 0.02,
      x * size,
      y * size,
      size * r,
    );
    gradient.addColorStop(0, `rgba(255,255,255,${a})`);
    gradient.addColorStop(0.55, `rgba(255,255,255,${a * 0.42})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function randomizeCloudSprite(sprite, layerIndex, depth = null) {
  const layerT = CLOUD_LAYER_COUNT <= 1 ? 0.5 : layerIndex / (CLOUD_LAYER_COUNT - 1);
  const layerCenterY = THREE.MathUtils.lerp(-(CLOUD_FIELD_HEIGHT * 0.5), CLOUD_FIELD_HEIGHT * 0.5, layerT);
  const distanceFromMid = Math.abs(layerT - 0.5) * 2;
  const scale = 11 + Math.random() * 14 + ((1 - distanceFromMid) * 2.2);
  sprite.position.set(
    (Math.random() - 0.5) * CLOUD_FIELD_WIDTH,
    layerCenterY + ((Math.random() - 0.5) * 5.5),
    depth ?? (-Math.random() * CLOUD_FIELD_DEPTH),
  );
  sprite.scale.set(scale * (1.35 + Math.random() * 0.7), scale, 1);
  sprite.material.opacity = 0.16 + Math.random() * 0.2;
  sprite.userData.scrollSpeed = 0.7 + Math.random() * 0.9 + ((1 - distanceFromMid) * 0.28);
}

function createCloudField() {
  const texture = createCloudTexture();
  const group = new THREE.Group();
  group.renderOrder = -20;

  for (let layerIndex = 0; layerIndex < CLOUD_LAYER_COUNT; layerIndex += 1) {
    for (let i = 0; i < CLOUDS_PER_LAYER; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: new THREE.Color().setHSL(
          0.03 + (layerIndex * 0.015),
          0.28 + (Math.random() * 0.12),
          0.86 + (Math.random() * 0.08),
        ),
        transparent: true,
        depthWrite: false,
        depthTest: true,
        opacity: 0.22,
      });
      const sprite = new THREE.Sprite(material);
      randomizeCloudSprite(sprite, layerIndex, -Math.random() * CLOUD_FIELD_DEPTH);
      sprite.userData.layerIndex = layerIndex;
      group.add(sprite);
    }
  }

  group.userData.texture = texture;
  return group;
}

function createOcean() {
  const geometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      time: { value: 0 },
      scrollOffset: { value: 0 },
      yaw: { value: 0 },
      cameraPos: { value: new THREE.Vector3() },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float scrollOffset;
      uniform float yaw;
      uniform vec3 cameraPos;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec3 viewDir = normalize(cameraPos - vWorldPos);
        float dist = length(cameraPos.xz - vWorldPos.xz);

        // Wave normals from scrolling noise — scroll with flight speed
        vec2 flight = vec2(0.0, -scrollOffset * 0.04);
        vec2 uv1 = vWorldPos.xz * 0.04 + vec2(time * 0.02, time * 0.015) + flight;
        vec2 uv2 = vWorldPos.xz * 0.08 + vec2(-time * 0.015, time * 0.01) + flight * 2.0;

        // Two noise layers instead of three FBM calls
        float n1 = noise(uv1) * 0.6 + noise(uv1 * 2.1) * 0.3;
        float n2 = noise(uv2) * 0.4 + noise(uv2 * 1.9) * 0.2;
        float waves = n1 + n2;

        // Analytical normal from noise derivatives via finite offset on cheap single-octave noise
        float eps = 0.15;
        float hC = noise(uv1) + noise(uv2) * 0.5;
        float hR = noise(uv1 + vec2(eps, 0.0)) + noise(uv2 + vec2(eps, 0.0)) * 0.5;
        float hU = noise(uv1 + vec2(0.0, eps)) + noise(uv2 + vec2(0.0, eps)) * 0.5;
        vec3 waveNormal = normalize(vec3(hC - hR, eps * 4.0, hC - hU));

        // Fresnel - stronger reflection at grazing angles
        float fresnel = pow(1.0 - max(dot(viewDir, waveNormal), 0.0), 2.5);
        fresnel = mix(0.25, 1.0, fresnel);

        vec3 sunDir = normalize(vec3(-0.55, 0.08, -1.0));

        // Specular highlight from sun
        vec3 halfDir = normalize(viewDir + sunDir);
        float spec = pow(max(dot(waveNormal, halfDir), 0.0), 256.0);
        float specBroad = pow(max(dot(waveNormal, halfDir), 0.0), 24.0);

        // Sky reflection colors (matching blue-orange sky dome)
        vec3 zenithColor = vec3(0.01, 0.04, 0.22);
        vec3 horizonColor = vec3(0.85, 0.38, 0.10);
        vec3 sunsetWarm = vec3(0.8, 0.35, 0.08);
        vec3 sunsetGlow = vec3(0.95, 0.45, 0.12);

        // Reflection based on view angle
        float reflAngle = max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0);

        // Bias warm reflection toward the sun direction
        vec3 flatViewDir = normalize(vec3(viewDir.x, 0.0, viewDir.z));
        vec3 flatSunDir = normalize(vec3(sunDir.x, 0.0, sunDir.z));
        float sunAlignment = max(dot(flatViewDir, flatSunDir), 0.0);
        float sunReflWeight = pow(sunAlignment, 1.8);

        // Away from sun: deep indigo tones
        vec3 coolReflect = mix(vec3(0.02, 0.06, 0.22), zenithColor, smoothstep(0.0, 0.4, reflAngle));
        vec3 warmReflect = mix(sunsetWarm, horizonColor * 0.8, smoothstep(0.0, 0.2, reflAngle));
        warmReflect = mix(warmReflect, zenithColor, smoothstep(0.2, 0.6, reflAngle));
        vec3 skyReflect = mix(coolReflect, warmReflect, sunReflWeight);

        // Wave shimmer
        skyReflect += vec3(0.1, 0.06, 0.03) * waves;

        // Deep water base — rich indigo
        vec3 deepColor = vec3(0.01, 0.03, 0.12);

        // Combine reflection and depth
        vec3 color = mix(deepColor, skyReflect, fresnel);

        // Specular highlights — sun-facing gets bright, broad glow everywhere
        color += sunsetGlow * spec * 3.0;
        color += vec3(0.5, 0.2, 0.1) * specBroad * 0.12 * sunReflWeight;
        color += vec3(0.02, 0.04, 0.14) * specBroad * 0.06; // navy glint

        // Subtle caustic shimmer
        float caustic = pow(waves, 2.0) * 0.06;
        color += vec3(0.15, 0.12, 0.08) * caustic;

        // Distance fade to horizon
        float distFade = smoothstep(0.0, OCEAN_SIZE_F * 0.4, dist);
        color = mix(color, horizonColor * 0.35 + vec3(0.02, 0.04, 0.12), distFade * 0.6);

        // Opacity: solid near camera, transparent at edges
        float alpha = 1.0 - smoothstep(OCEAN_SIZE_F * 0.35, OCEAN_SIZE_F * 0.5, dist);
        alpha = max(alpha, 0.35 * (1.0 - distFade));

        gl_FragColor = vec4(color, alpha * 0.95);
      }
    `.replace(/OCEAN_SIZE_F/g, OCEAN_SIZE.toFixed(1)),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = OCEAN_Y;
  mesh.renderOrder = -50;
  mesh.frustumCulled = false;
  return mesh;
}

function mapMonolithBloomSettings(guiParams) {
  // Monolith's legacy sliders were tuned for UnrealBloomPass. Translate them
  // into values that read similarly in @react-three/postprocessing's Bloom.
  return {
    intensity: Math.max(1.2, guiParams.bloomStrength * 3.5),
    radius: Math.min(1, (guiParams.bloomRadius * 2.8) + 0.12),
    smoothing: THREE.MathUtils.clamp(0.35 + ((1 - guiParams.bloomThreshold) * 0.5), 0, 1),
    threshold: THREE.MathUtils.clamp((guiParams.bloomThreshold - 0.77) * 0.05, 0, 1),
  };
}

// ── Initial state factory ──────────────────────────────────────────────────────────────

function createInitialMonolithState() {
  return {
    whiteMode: false,
    hueCycleEnabled: false,
    hueCycleBaseHue: 0,
    hueCycleSavedEnabled: false,
    hueCycleSavedHue: 0,
    hueCycleSavedSaturation: 0,
    hueCycleStartTime: 0,
    xrayMode: false,
    restoreChromaticAberrationAfterXray: false,
    currentModelIndex: -1,
    lightingMode: LIGHTING_MODE_SCENE,
    currentFx: SHARED_FX_NONE,
    pixelMosaicEnabled: false,
    thermalVisionEnabled: false,
    pendingLightingMode: null,
    animationSpeedBoostEnabled: false,
  };
}

// ── Glitch logic ───────────────────────────────────────────────────────────────────────

function canTriggerMonolithGlitch(state) {
  return (
    state.currentFx === SHARED_FX_CINEMATIC ||
    state.currentFx === SHARED_FX_DATABEND ||
    state.pixelMosaicEnabled ||
    state.thermalVisionEnabled
  );
}

function createMonolithEffectSnapshot(guiParams, state, glitchTriggerToken) {
  const bloom = mapMonolithBloomSettings(guiParams);
  const cinematicEnabled = state.currentFx === SHARED_FX_CINEMATIC;

  return {
    barrelBlurAmount: guiParams.barrelBlurAmount,
    barrelBlurEnabled: guiParams.barrelBlurEnabled,
    barrelBlurOffsetX: guiParams.barrelBlurOffsetX,
    barrelBlurOffsetY: guiParams.barrelBlurOffsetY,
    bloomEnabled: guiParams.bloomEnabled && !cinematicEnabled,
    bloomIntensity: bloom.intensity,
    bloomRadius: bloom.radius,
    bloomSmoothing: bloom.smoothing,
    bloomThreshold: bloom.threshold,
    chromaticAberrationEnabled: guiParams.chromaticAberrationEnabled,
    chromaticModulationOffset: guiParams.chromaticAberrationModulationOffset,
    chromaticOffsetX: guiParams.chromaticAberrationOffsetX,
    chromaticOffsetY: guiParams.chromaticAberrationOffsetY,
    chromaticOscillationSpeed: CHROMATIC_OSCILLATION_SPEED,
    chromaticRadialModulation: guiParams.chromaticAberrationRadialModulation,
    cinematicEnabled,
    databendEnabled: state.currentFx === SHARED_FX_DATABEND,
    glitchDuration: guiParams.glitchDuration,
    glitchEnabled: canTriggerMonolithGlitch(state),
    glitchStrength: guiParams.glitchStrength,
    glitchTriggerToken,
    hue: guiParams.hue,
    hueCycleBaseHue: state.hueCycleBaseHue,
    hueCycleEnabled: state.hueCycleEnabled,
    hueCycleStartTime: state.hueCycleStartTime,
    hueSatEnabled: state.currentFx === SHARED_FX_CINEMATIC && guiParams.hueSatEnabled,
    pixelMosaicEnabled: state.pixelMosaicEnabled,
    saturation: guiParams.saturation,
    scanlineDensity: guiParams.scanlineDensity,
    scanlineEnabled: guiParams.scanlineEnabled,
    scanlineOpacity: guiParams.scanlineOpacity,
    scanlineScrollSpeed: guiParams.scanlineScrollSpeed,
    thermalVisionEnabled: state.thermalVisionEnabled,
  };
}

function MonolithScene() {
  const { gl, scene, camera } = useThree();

  // ── Refs ────────────────────────────────────────────────────────────────────
  // All mutable scene values live in refs rather than state so they can be
  // read and written imperatively inside callbacks and the useFrame loop
  // without triggering re-renders. Only effectSnapshot is React state, because
  // SharedEffectStack needs to re-render when post-processing settings change.
  const controlsRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const guiParamsRef = useRef(createDefaultGuiParams());
  const materialManagerRef = useRef(null);
  const overlaysRef = useRef(null);
  const lightingRigRef = useRef(null);
  const uiRef = useRef(null);
  const guiControlsRef = useRef(null);
  const progressRef = useRef(null);
  const loaderRef = useRef(null);
  const modelCacheRef = useRef(new Map()); // session cache keyed by model path; see TODO in root ToDo.md #6
  const mixerRef = useRef(null);
  const monolithRef = useRef(new THREE.Group());
  const monolithBasePositionRef = useRef(new THREE.Vector3());
  const heatShimmerRef = useRef(null);
  const heatShimmerMaterialRef = useRef(null);
  const skyDomeRef = useRef(null);
  const oceanRef = useRef(null);
  const cloudFieldRef = useRef(null);
  const cloudStateRef = useRef({
    density: 0,
    ambientFactor: 1,
  });
  const terrainTilesRef = useRef([]);
  const flightControlRef = useRef({
    ascendPressed: false,
    descendPressed: false,
    turnLeftPressed: false,
    turnRightPressed: false,
    elevationOffset: 0,
    targetElevationOffset: 0,
    pitchOffset: 0,
    yawOffset: 0,
    targetYawOffset: 0,
    bankOffset: 0,
    worldYaw: 0,
  });
  const stateRef = useRef(createInitialMonolithState());
  const boostVisualStateRef = useRef({
    intensity: 0,
    lastShakeOffset: new THREE.Vector3(),
  });
  const glitchTriggerTokenRef = useRef(0);
  const [effectSnapshot, setEffectSnapshot] = useState(() => (
    createMonolithEffectSnapshot(guiParamsRef.current, stateRef.current, glitchTriggerTokenRef.current)
  ));

  // ── Derived helpers ────────────────────────────────────────────────────────────

  const currentSetDef = () => MODEL_SET_DEF;
  const currentModels = () => currentSetDef().models;
  const supportsAnimationSpeedBoost = () => Boolean(currentSetDef().supportsAnimationSpeedBoost);
  const getLightingModeLabel = (mode) => LIGHTING_MODE_LABELS[mode] ?? LIGHTING_MODE_LABELS[0];
  const getEffectiveWhiteMode = () => stateRef.current.whiteMode;
  const getFallbackEngineShimmers = () => ([
    {
      x: guiParamsRef.current.shimmerOffsetX,
      y: guiParamsRef.current.shimmerOffsetY,
      z: guiParamsRef.current.shimmerOffsetZ,
    },
    {
      x: guiParamsRef.current.shimmerOffsetX,
      y: guiParamsRef.current.shimmerOffsetY,
      z: -guiParamsRef.current.shimmerOffsetZ + 0.14,
    },
  ]);
  const getModelEngineShimmers = (modelIndex) => {
    const model = currentModels()[modelIndex];
    if (!model) return [];
    if (Array.isArray(model.engineShimmers)) return model.engineShimmers;
    return modelIndex === 0 || modelIndex === 1 ? getFallbackEngineShimmers() : [];
  };
  const rebuildHeatShimmerMeshes = () => {
    if (!heatShimmerRef.current || !heatShimmerMaterialRef.current) return;

    const shimmerGroup = heatShimmerRef.current;
    const shimmerConfigs = getModelEngineShimmers(stateRef.current.currentModelIndex);

    shimmerGroup.children.forEach((child) => {
      child.geometry.dispose();
    });
    shimmerGroup.clear();

    shimmerConfigs.forEach(() => {
      const geometry = new THREE.CylinderGeometry(0.3, 0.0, 4.5, 32, 16, true);
      geometry.rotateZ(Math.PI / 2);
      shimmerGroup.add(new THREE.Mesh(geometry, heatShimmerMaterialRef.current));
    });
  };
  const setAnimationSpeedBoost = (enabled) => {
    if (!supportsAnimationSpeedBoost()) return;
    stateRef.current.animationSpeedBoostEnabled = enabled;
    syncAnimationMixerSpeed();
    syncEffectSnapshot();
  };
  const loadNextModel = (direction = 1) => {
    const models = currentModels();
    if (!models.length) return;

    const currentIndex = stateRef.current.currentModelIndex >= 0
      ? stateRef.current.currentModelIndex
      : (currentSetDef().defaultModel ?? 0);
    const nextIndex = (currentIndex + direction + models.length) % models.length;
    loadModel(nextIndex);
  };

  // ── Effect snapshot ───────────────────────────────────────────────────────────
  // syncEffectSnapshot() is the only way effectSnapshot changes. Calling it
  // causes SharedEffectStack to re-render with the latest settings from both
  // guiParamsRef and stateRef. triggerGlitch increments a token that
  // SharedEffectStack uses to fire a one-shot glitch burst.

  const revealScene = () => {
    if (stateRef.current.pendingLightingMode !== null) {
      switchLightingMode(stateRef.current.pendingLightingMode);
      stateRef.current.pendingLightingMode = null;
    }
    gl.domElement.style.opacity = '1';
  };

  const syncEffectSnapshot = ({ triggerGlitch = false } = {}) => {
    if (triggerGlitch && canTriggerMonolithGlitch(stateRef.current)) {
      glitchTriggerTokenRef.current += 1;
    }

    setEffectSnapshot(
      createMonolithEffectSnapshot(
        guiParamsRef.current,
        stateRef.current,
        glitchTriggerTokenRef.current,
      ),
    );
  };

  // ── Scene / material helpers ──────────────────────────────────────────────────────

  const markDisplayedModelMaterialsDirty = () => {
    monolithRef.current.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        material.needsUpdate = true;
      });
    });
  };

  const applySceneAppearance = () => {
    const effectiveWhiteMode = getEffectiveWhiteMode();

    document.body.style.background = effectiveWhiteMode ? 'white' : '#050709';
    scene.environment = null;
    scene.background = currentSetDef().nullBackground
      ? null
      : new THREE.Color(effectiveWhiteMode ? 0xffffff : BASE_SCENE_BACKGROUND);
    if (skyDomeRef.current) {
      skyDomeRef.current.visible = !effectiveWhiteMode;
    }
    if (cloudFieldRef.current) {
      cloudFieldRef.current.visible = !effectiveWhiteMode && CLOUDS_ENABLED;
    }
    if (oceanRef.current) {
      oceanRef.current.visible = !effectiveWhiteMode && OCEAN_ENABLED;
    }
    overlaysRef.current?.applyWhiteMode(effectiveWhiteMode);
    uiRef.current?.applyWhiteMode();
  };

  const setWhiteMode = (value) => {
    stateRef.current.whiteMode = value;
    guiParamsRef.current.whiteMode = value;
    applySceneAppearance();
  };

  const applyChromaticXrayState = (nextState) => {
    const chromaticChanged = (
      guiParamsRef.current.chromaticAberrationEnabled !== nextState.chromaticAberrationEnabled
    );
    const xrayChanged = stateRef.current.xrayMode !== nextState.xrayMode;

    guiParamsRef.current.chromaticAberrationEnabled = nextState.chromaticAberrationEnabled;
    stateRef.current.restoreChromaticAberrationAfterXray = nextState.restoreChromaticAfterXray;
    stateRef.current.xrayMode = nextState.xrayMode;

    if (chromaticChanged) syncEffectSnapshot();

    if (chromaticChanged || xrayChanged) {
      guiControlsRef.current?.syncGuiDisplay();
    }

    if (xrayChanged) {
      refreshDisplayedModelMaterials();
    }
  };

  const toggleFx = (mode) => {
    stateRef.current.currentFx = toggleSharedFxMode(stateRef.current.currentFx, mode);
    syncEffectSnapshot();
    guiControlsRef.current?.syncGuiDisplay();
  };

  const refreshDisplayedModelMaterials = () => {
    if (stateRef.current.currentModelIndex < 0) return;
    materialManagerRef.current?.applyModelMaterials(
      monolithRef.current,
      currentSetDef(),
      stateRef.current.currentModelIndex,
      stateRef.current.xrayMode,
    );
  };

  const syncAnimationMixerSpeed = () => {
    if (!mixerRef.current) return;

    mixerRef.current.timeScale = (
      supportsAnimationSpeedBoost() && stateRef.current.animationSpeedBoostEnabled
    )
      ? ANIMATION_SPEED_BOOST_MULTIPLIER
      : 1;
  };

  const applyMonolithTransform = () => {
    if (!monolithRef.current) return;

    monolithRef.current.position.copy(monolithBasePositionRef.current);
    monolithRef.current.position.y += flightControlRef.current.elevationOffset;
    monolithRef.current.rotation.set(
      guiParamsRef.current.modelRotationX,
      guiParamsRef.current.modelRotationY + flightControlRef.current.yawOffset,
      guiParamsRef.current.modelRotationZ + flightControlRef.current.pitchOffset + flightControlRef.current.bankOffset,
    );
  };

  const swapModel = (model, name, animations) => {
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }

    scene.remove(monolithRef.current);
    const basePosition = model.userData.monolithBasePosition instanceof THREE.Vector3
      ? model.userData.monolithBasePosition
      : model.position.clone();
    monolithBasePositionRef.current.copy(basePosition);
    monolithRef.current = model;
    applyMonolithTransform();
    scene.add(monolithRef.current);

    if (animations?.length > 0) {
      mixerRef.current = new THREE.AnimationMixer(model);
      animations.forEach((clip) => mixerRef.current.clipAction(clip).play());
      syncAnimationMixerSpeed();
    }

    uiRef.current?.updateLabel(name);
  };

  // ── Model loading ────────────────────────────────────────────────────────────────
  // Load order: in-memory Map (modelCacheRef) → Cache API (cachedFetch) → network.
  // Parsed GLTF scenes are kept in modelCacheRef so revisiting a model in the
  // same session avoids re-parsing. cachedFetch caches the raw GLB bytes in the
  // browser Cache API so subsequent sessions skip the network request entirely.

  /** Displays the red "failed to load" progress bar state. */
  const showLoadError = (modelName) => {
    if (progressRef.current) {
      progressRef.current.container.style.opacity = '1';
      progressRef.current.bar.style.width = '100%';
      progressRef.current.bar.style.background = '#ff5c5c';
      progressRef.current.container.style.width = '320px';
      const label = progressRef.current.container.firstChild;
      if (label) {
        label.textContent = `failed to load ${modelName.toLowerCase()}`;
        label.style.color = 'rgba(255,92,92,0.9)';
      }
    }
  };

  const resetLoadProgress = () => {
    if (!progressRef.current) return;

    progressRef.current.container.style.transition = 'opacity 0.2s';
    progressRef.current.container.style.opacity = '1';
    progressRef.current.container.style.width = '200px';
    progressRef.current.bar.style.width = '0%';
    progressRef.current.bar.style.background = '#fff';

    const label = progressRef.current.container.firstChild;
    if (label) {
      label.textContent = 'loading';
      label.style.color = 'rgba(255,255,255,0.5)';
    }
  };

  const hideLoadProgress = ({ immediate = false } = {}) => {
    if (!progressRef.current) return;
    progressRef.current.container.style.transition = immediate ? 'opacity 0s' : 'opacity 0.4s';
    progressRef.current.container.style.opacity = '0';
  };

  const updateLoadProgress = (loadedBytes, totalBytes) => {
    if (!progressRef.current) return;

    if (totalBytes && totalBytes > 0) {
      progressRef.current.bar.style.width = `${Math.round((loadedBytes / totalBytes) * 100)}%`;
      return;
    }

    // Some cached/proxied responses do not expose Content-Length. In that case,
    // still show visible progress instead of leaving the bar at 0%.
    const fallbackProgress = Math.min(90, 8 + Math.sqrt(loadedBytes / 65536) * 18);
    progressRef.current.bar.style.width = `${fallbackProgress}%`;
  };

  const readModelArrayBuffer = async (response, trackProgress) => {
    if (!trackProgress) {
      return response.arrayBuffer();
    }

    const totalBytes = Number.parseInt(response.headers.get('content-length') ?? '', 10);

    if (!response.body || !Number.isFinite(totalBytes)) {
      const buffer = await response.arrayBuffer();
      updateLoadProgress(buffer.byteLength, Number.isFinite(totalBytes) ? totalBytes : 0);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
      loadedBytes += value.byteLength;
      updateLoadProgress(loadedBytes, totalBytes);
    }

    const buffer = new Uint8Array(loadedBytes);
    let offset = 0;

    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    updateLoadProgress(loadedBytes, totalBytes);
    return buffer.buffer;
  };

  const loadModel = async (index, { showProgressIfUncached = false } = {}) => {
    if (!loaderRef.current || index === stateRef.current.currentModelIndex) return;
    stateRef.current.currentModelIndex = index;
    rebuildHeatShimmerMeshes();
    guiControlsRef.current?.rebuildEngineShimmerFolder();
    syncEffectSnapshot({ triggerGlitch: true });
    gl.domElement.style.opacity = '0';
    overlaysRef.current?.updateTextVisibility(-1);

    const entry = currentModels()[index];
    const def = currentSetDef();
    const cacheKey = entry.path;

    if (modelCacheRef.current.has(cacheKey)) {
      hideLoadProgress({ immediate: true });
      const cached = modelCacheRef.current.get(cacheKey);
      materialManagerRef.current?.applyModelMaterials(
        cached.model,
        def,
        index,
        stateRef.current.xrayMode,
      );
      // TODO: skip the fade for cached hits (no network round-trip). Track the
      // timeout ID so it can be cleared on unmount (see root ToDo.md items #5, #8).
      window.setTimeout(() => {
        swapModel(cached.model, entry.name, cached.animations);
        overlaysRef.current?.updateTextVisibility(index);
        revealScene();
      }, 200);
      return;
    }

    // Fetch the GLB through the persistent Cache API layer, then parse with
    // GLTFLoader.  Using cachedFetch() + parse() instead of loader.load() lets
    // us cache the raw binary response across sessions so revisits skip the
    // network entirely.  DRACO decompression still runs via the DRACOLoader
    // attached to the GLTFLoader instance.
    const modelUrl = resolveAssetUrl(entry.path);
    const shouldTrackProgress = (
      showProgressIfUncached
      && !(await hasCachedModel(modelUrl))
    );

    if (shouldTrackProgress) {
      resetLoadProgress();
    } else {
      hideLoadProgress({ immediate: true });
    }

    cachedFetch(modelUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading ${entry.path}`);
        }
        return readModelArrayBuffer(response, shouldTrackProgress);
      })
      .then((buffer) => {
        loaderRef.current.parse(
          buffer,
          // resourcePath — tells the parser where to resolve relative
          // references (textures, etc.) within the GLB
          resolveAssetUrl(entry.path.substring(0, entry.path.lastIndexOf('/') + 1)),
          (gltf) => {
            if (shouldTrackProgress) {
              hideLoadProgress();
            }

            const model = gltf.scene;
            const animations = gltf.animations;

            materialManagerRef.current?.normalizeModelTransform(model, def, index);
            if (!(model.userData.monolithBasePosition instanceof THREE.Vector3)) {
              model.userData.monolithBasePosition = model.position.clone();
            }
            materialManagerRef.current?.applyModelTextureFiltering(model);
            materialManagerRef.current?.applyModelMaterials(
              model,
              def,
              index,
              stateRef.current.xrayMode,
            );

            modelCacheRef.current.set(cacheKey, { model, animations });
            // TODO: track this timeout ID and clear it in the cleanup to prevent
            // stale DOM updates after unmount (see root ToDo.md #8).
            window.setTimeout(() => {
              swapModel(model, entry.name, animations);
              overlaysRef.current?.updateTextVisibility(index);
              revealScene();
            }, 200);
          },
          (error) => {
            console.error('Failed to parse model', entry.path, error);
            gl.domElement.style.opacity = '1';
            showLoadError(entry.name);
          },
        );
      })
      .catch((error) => {
        console.error('Failed to load model', entry.path, error);
        gl.domElement.style.opacity = '1';
        showLoadError(entry.name);
      });
  };

  // ── Mode switching ────────────────────────────────────────────────────────────────

  const switchLightingMode = (mode) => {
    stateRef.current.lightingMode = mode;
    if (lightingRigRef.current) {
      lightingRigRef.current.particles.visible = mode === LIGHTING_MODE_PARTICLES;
      if (mode !== LIGHTING_MODE_PARTICLES) lightingRigRef.current.clearParticleGlow();
    }
    guiParamsRef.current.lightingMode = getLightingModeLabel(mode);
    applySceneAppearance();
    markDisplayedModelMaterialsDirty();
    guiControlsRef.current?.syncGuiDisplay();
    uiRef.current?.updateModeButtons();
  };

  // ── Effect toggles ────────────────────────────────────────────────────────────────

  const toggleWhiteMode = () => {
    setWhiteMode(!stateRef.current.whiteMode);
    guiControlsRef.current?.syncGuiDisplay();
  };

  const toggleChromaticAberration = () => {
    applyChromaticXrayState(toggleChromaticAberrationState({
      chromaticAberrationEnabled: guiParamsRef.current.chromaticAberrationEnabled,
      restoreChromaticAfterXray: stateRef.current.restoreChromaticAberrationAfterXray,
      xrayMode: stateRef.current.xrayMode,
    }));
  };

  const toggleXrayMode = () => {
    applyChromaticXrayState(toggleXrayModeState({
      chromaticAberrationEnabled: guiParamsRef.current.chromaticAberrationEnabled,
      restoreChromaticAfterXray: stateRef.current.restoreChromaticAberrationAfterXray,
      xrayMode: stateRef.current.xrayMode,
    }));
  };

  const toggleHueCycle = () => {
    const nextState = toggleHueCycleState({
      hue: guiParamsRef.current.hue,
      hueCycleBaseHue: stateRef.current.hueCycleBaseHue,
      hueCycleEnabled: stateRef.current.hueCycleEnabled,
      hueCycleSavedEnabled: stateRef.current.hueCycleSavedEnabled,
      hueCycleSavedHue: stateRef.current.hueCycleSavedHue,
      hueCycleSavedSaturation: stateRef.current.hueCycleSavedSaturation,
      hueCycleStartTime: stateRef.current.hueCycleStartTime,
      hueSatEnabled: guiParamsRef.current.hueSatEnabled,
      saturation: guiParamsRef.current.saturation,
    }, clockRef.current.getElapsedTime());

    stateRef.current.hueCycleEnabled = nextState.hueCycleEnabled;
    stateRef.current.hueCycleSavedEnabled = nextState.hueCycleSavedEnabled;
    stateRef.current.hueCycleSavedHue = nextState.hueCycleSavedHue;
    stateRef.current.hueCycleSavedSaturation = nextState.hueCycleSavedSaturation;
    stateRef.current.hueCycleBaseHue = nextState.hueCycleBaseHue;
    stateRef.current.hueCycleStartTime = nextState.hueCycleStartTime;

    guiParamsRef.current.hueSatEnabled = nextState.hueSatEnabled;
    guiParamsRef.current.hue = nextState.hue;
    guiParamsRef.current.saturation = nextState.saturation;

    syncEffectSnapshot();
    guiControlsRef.current?.syncGuiDisplay();
  };

  const togglePixelMosaic = () => {
    stateRef.current.pixelMosaicEnabled = !stateRef.current.pixelMosaicEnabled;
    syncEffectSnapshot();
    guiControlsRef.current?.syncGuiDisplay();
  };

  const toggleThermalVision = () => {
    stateRef.current.thermalVisionEnabled = !stateRef.current.thermalVisionEnabled;
    syncEffectSnapshot();
    guiControlsRef.current?.syncGuiDisplay();
  };

  const loadDefaultModel = () => {
    stateRef.current.currentModelIndex = -1;
    stateRef.current.animationSpeedBoostEnabled = false;
    syncAnimationMixerSpeed();

    const def = currentSetDef();
    overlaysRef.current?.hideAllOverlays();
    applySceneAppearance();

    stateRef.current.pendingLightingMode = def.defaultLighting ?? LIGHTING_MODE_SCENE;
    loadModel(def.defaultModel ?? 0, { showProgressIfUncached: true });
  };

  // ── Setup effect (mount / unmount) ───────────────────────────────────────────────

  useEffect(() => {
    scene.background = new THREE.Color(BASE_SCENE_BACKGROUND);
    document.body.style.background = '#050709';

    camera.fov = BASE_CAMERA_FOV;
    camera.near = 0.1;
    camera.far = 250;
    camera.position.set(0, 5.0, 14);
    camera.updateProjectionMatrix();

    gl.setPixelRatio(window.devicePixelRatio);
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = guiParamsRef.current.exposure;
    gl.domElement.style.position = 'relative';
    gl.domElement.style.zIndex = '1';
    gl.domElement.style.touchAction = 'none';
    gl.domElement.style.webkitTouchCallout = 'none';
    gl.domElement.style.transition = 'opacity 0.6s';
    gl.domElement.style.opacity = '0';

    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 5.0, 0);
    controls.enableDamping = true;
    controls.update();
    controlsRef.current = controls;

    const touchState = {
      activePointers: new Map(),
      longPressTimerId: null,
      longPressPointerId: null,
      longPressActive: false,
      lastTapTime: 0,
      lastTapX: 0,
      lastTapY: 0,
      lastTapClearTimerId: null,
    };

    const isTouchDevice = () => (
      window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0
    );

    const clearLongPressTimer = () => {
      if (touchState.longPressTimerId !== null) {
        window.clearTimeout(touchState.longPressTimerId);
        touchState.longPressTimerId = null;
      }
      touchState.longPressPointerId = null;
    };

    const clearLastTap = () => {
      if (touchState.lastTapClearTimerId !== null) {
        window.clearTimeout(touchState.lastTapClearTimerId);
        touchState.lastTapClearTimerId = null;
      }
      touchState.lastTapTime = 0;
    };

    const stopTouchBoost = () => {
      if (!touchState.longPressActive) return;
      touchState.longPressActive = false;
      setAnimationSpeedBoost(false);
    };

    const startLongPressTimer = (pointerId) => {
      clearLongPressTimer();
      touchState.longPressPointerId = pointerId;
      touchState.longPressTimerId = window.setTimeout(() => {
        const pointer = touchState.activePointers.get(pointerId);
        if (!pointer || pointer.cancelled || pointer.moved || touchState.activePointers.size !== 1) {
          return;
        }

        touchState.longPressTimerId = null;
        touchState.longPressPointerId = null;
        touchState.longPressActive = true;
        clearLastTap();
        setAnimationSpeedBoost(true);
      }, TOUCH_LONG_PRESS_DELAY_MS);
    };

    const onPointerDown = (event) => {
      if (!isTouchDevice() || event.pointerType !== 'touch') return;

      const pointerCountBefore = touchState.activePointers.size;
      touchState.activePointers.set(event.pointerId, {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        cancelled: false,
      });

      if (pointerCountBefore === 0) {
        startLongPressTimer(event.pointerId);
        return;
      }

      clearLongPressTimer();
      stopTouchBoost();
      clearLastTap();
      touchState.activePointers.forEach((pointer) => {
        pointer.cancelled = true;
      });
    };

    const onPointerMove = (event) => {
      if (!isTouchDevice() || event.pointerType !== 'touch') return;

      const pointer = touchState.activePointers.get(event.pointerId);
      if (!pointer) return;

      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;

      const moveDistance = Math.hypot(
        pointer.lastX - pointer.startX,
        pointer.lastY - pointer.startY,
      );

      if (moveDistance > TOUCH_TAP_MAX_MOVEMENT_PX) {
        pointer.moved = true;
        clearLongPressTimer();
      }
    };

    const onPointerEnd = (event) => {
      if (!isTouchDevice() || event.pointerType !== 'touch') return;

      const pointer = touchState.activePointers.get(event.pointerId);
      if (!pointer) return;

      touchState.activePointers.delete(event.pointerId);

      if (touchState.longPressPointerId === event.pointerId) {
        clearLongPressTimer();
      }

      if (touchState.longPressActive) {
        if (touchState.activePointers.size === 0) {
          stopTouchBoost();
        }
        return;
      }

      if (pointer.cancelled || pointer.moved || touchState.activePointers.size !== 0) {
        return;
      }

      const now = window.performance.now();
      const tapDistance = Math.hypot(
        pointer.lastX - touchState.lastTapX,
        pointer.lastY - touchState.lastTapY,
      );

      if (
        touchState.lastTapTime > 0
        && (now - touchState.lastTapTime) <= TOUCH_DOUBLE_TAP_MAX_DELAY_MS
        && tapDistance <= TOUCH_DOUBLE_TAP_MAX_DISTANCE_PX
      ) {
        clearLastTap();
        loadNextModel(1);
        return;
      }

      clearLastTap();
      touchState.lastTapX = pointer.lastX;
      touchState.lastTapY = pointer.lastY;
      touchState.lastTapTime = now;
      touchState.lastTapClearTimerId = window.setTimeout(() => {
        touchState.lastTapClearTimerId = null;
        touchState.lastTapTime = 0;
      }, TOUCH_DOUBLE_TAP_MAX_DELAY_MS);
    };

    materialManagerRef.current = createMaterialManager(gl);

    scene.add(monolithRef.current);

    const skyDome = createSkyDome();
    scene.add(skyDome);
    skyDomeRef.current = skyDome;

    if (CLOUDS_ENABLED) {
      const cloudField = createCloudField();
      scene.add(cloudField);
      cloudFieldRef.current = cloudField;
    }

    if (OCEAN_ENABLED) {
      const ocean = createOcean();
      scene.add(ocean);
      oceanRef.current = ocean;
    }

    if (TERRAIN_ENABLED) {
      const terrainTiles = Array.from({ length: TERRAIN_TILE_COUNT }, (_, index) => (
        createTerrainTile({
          renderZOffset: -index * TERRAIN_TILE_LENGTH,
          logicalZOffset: -index * TERRAIN_TILE_LENGTH,
        })
      ));
      terrainTiles.forEach((tile) => scene.add(tile));
      terrainTilesRef.current = terrainTiles;
    }

    // Create heat shimmer mesh behind the monolith
    const shimmerGroup = new THREE.Group();
    shimmerGroup.visible = false;

    const shimmerGeoLeft = new THREE.CylinderGeometry(0.3, 0.0, 4.5, 32, 16, true);
    shimmerGeoLeft.rotateZ(Math.PI / 2);

    const shimmerGeoRight = new THREE.CylinderGeometry(0.3, 0.0, 4.5, 32, 16, true);
    shimmerGeoRight.rotateZ(Math.PI / 2);

    const shimmerMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        boostIntensity: { value: 0 },
      },
      vertexShader: `
        uniform float time;
        uniform float boostIntensity;
        varying vec2 vUv;
        varying float vDisplacement;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), u.x),
                     mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
        }

        void main() {
          vUv = uv;
          vec3 pos = position;

          float tailFade = 1.0 - vUv.y;

          // Multi-frequency turbulence for chaotic flame shape
          float n1 = noise(vec2(vUv.x * 6.0 + time * 12.0, vUv.y * 4.0 + time * 18.0)) - 0.5;
          float n2 = noise(vec2(vUv.x * 12.0 - time * 8.0, vUv.y * 8.0 + time * 25.0)) - 0.5;
          float n3 = noise(vec2(vUv.x * 3.0, time * 22.0)) - 0.5;
          float n4 = noise(vec2(vUv.y * 10.0 + time * 30.0, vUv.x * 8.0)) - 0.5;

          // Large-scale flame licking motion
          float lick = sin(vUv.y * 6.28 + time * 10.0) * 0.08;

          // Flame widens and narrows chaotically
          float flicker = 1.0 + n3 * 0.4 * boostIntensity;
          pos.y *= flicker;
          pos.z *= flicker;

          // Turbulent displacement increases toward the tail
          float turb = tailFade * tailFade;
          pos.y += (n1 * 0.25 + n2 * 0.12 + lick) * boostIntensity * turb;
          pos.z += (n4 * 0.2 + n2 * 0.1) * boostIntensity * turb;
          pos.x += n3 * 0.5 * boostIntensity * turb;

          vDisplacement = abs(n1) + abs(n2) * 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float boostIntensity;
        varying vec2 vUv;
        varying float vDisplacement;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), u.x),
                     mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
        }

        void main() {
          if (boostIntensity < 0.01) discard;

          // Fast-scrolling noise at multiple scales for flame detail
          float n1 = noise(vec2(vUv.x * 5.0, vUv.y * 4.0 - time * 8.0));
          float n2 = noise(vec2(vUv.x * 10.0 + 50.0, vUv.y * 8.0 - time * 14.0));
          float n3 = noise(vec2(vUv.x * 20.0, vUv.y * 12.0 - time * 20.0));
          float n = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

          // Shape: rounded edge with noise-driven tearing
          float edge = sin(vUv.x * 3.14159);
          edge = pow(edge, 0.6); // Wider flame body
          float tearNoise = noise(vec2(vUv.x * 8.0 + time * 6.0, vUv.y * 3.0));
          edge *= smoothstep(0.15, 0.35, edge + tearNoise * 0.2); // Ragged edges

          // Tail fade — sharp near engine, long taper
          float tailFade = pow(1.0 - vUv.y, 0.4);
          // Flickering tail tip
          float tipFlicker = noise(vec2(time * 18.0, vUv.x * 4.0));
          tailFade *= smoothstep(0.0, 0.15 + tipFlicker * 0.1, 1.0 - vUv.y);

          float intensity = n * edge * tailFade * boostIntensity;

          // Flame color gradient: blue core → white hot → orange → red tips
          float coreT = smoothstep(0.0, 0.3, vUv.y); // 0 at tip, 1 near engine
          vec3 tipColor = vec3(1.0, 0.12, 0.0);                // Deep red tips
          vec3 midColor = vec3(1.0, 0.45, 0.02);               // Rich orange
          vec3 hotColor = vec3(1.0, 0.7, 0.1);                 // Orange-yellow (not white)
          vec3 coreColor = vec3(1.0, 0.6, 0.15);               // Bright orange core

          vec3 color = mix(tipColor, midColor, smoothstep(0.0, 0.3, coreT));
          color = mix(color, hotColor, smoothstep(0.3, 0.7, coreT));
          color = mix(color, coreColor, smoothstep(0.82, 1.0, coreT));

          // Noise drives local hot spots — orange not white
          color = mix(color, hotColor, pow(n, 2.5) * 0.5);

          // Red at the tip (low coreT = toward tip)
          vec3 redHighlight = vec3(0.9, 0.05, 0.0);
          color = mix(color, redHighlight, pow(1.0 - coreT, 2.5) * 0.75);

          // Red on the edges (where edge envelope is low)
          float edgeness = 1.0 - smoothstep(0.0, 0.45, edge);
          color = mix(color, redHighlight, edgeness * 0.6 * tailFade);

          // Displacement from vertex shader adds brightness variation
          color += vec3(0.3, 0.15, 0.0) * vDisplacement * 0.5;

          gl_FragColor = vec4(color * intensity * 5.0, intensity * 2.5);
        }
      `
    });
    
    scene.add(shimmerGroup);
    heatShimmerRef.current = shimmerGroup;
    heatShimmerMaterialRef.current = shimmerMat;
    rebuildHeatShimmerMeshes();

    overlaysRef.current = createOverlays(scene);

    lightingRigRef.current = createLightingRig({
      scene,
      currentSetDef,
      getCurrentModelIndex: () => stateRef.current.currentModelIndex,
      getMonolith: () => monolithRef.current,
      guiParams: guiParamsRef.current,
      getIsBoosting: () => stateRef.current.animationSpeedBoostEnabled && supportsAnimationSpeedBoost(),
      getCloudAmbientFactor: () => cloudStateRef.current.ambientFactor,
    });

    uiRef.current = createUI({
      getWhiteMode: getEffectiveWhiteMode,
      getLightingMode: () => stateRef.current.lightingMode,
      onSwitchLightingMode: switchLightingMode,
    });

    guiControlsRef.current = createGuiControls({
      guiParams: guiParamsRef.current,
      models: currentModels(),
      getCurrentModelIndex: () => stateRef.current.currentModelIndex,
      renderer: gl,
      scene,
      onWhiteModeChange: setWhiteMode,
      onLightingModeChange: switchLightingMode,
      onChromaticAberrationChange: (enabled) => {
        applyChromaticXrayState(setChromaticAberrationState({
          chromaticAberrationEnabled: guiParamsRef.current.chromaticAberrationEnabled,
          restoreChromaticAfterXray: stateRef.current.restoreChromaticAberrationAfterXray,
          xrayMode: stateRef.current.xrayMode,
        }, enabled));
      },
      onEngineShimmerChange: (modelIndex) => {
        if (modelIndex === stateRef.current.currentModelIndex) {
          rebuildHeatShimmerMeshes();
        }
      },
      onEffectSettingsChange: syncEffectSnapshot,
      onTriggerGlitch: () => syncEffectSnapshot({ triggerGlitch: true }),
      onModelRotationChange: () => {
        applyMonolithTransform();
      },
    });

    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:200px;z-index:200;opacity:0;pointer-events:none;transition:opacity 0.4s';
    const progressBar = document.createElement('div');
    progressBar.style.cssText = 'width:0%;height:2px;background:#fff;transition:width 0.2s';
    const progressLabel = document.createElement('div');
    progressLabel.style.cssText = 'color:rgba(255,255,255,0.5);font:12px/1 monospace;text-align:center;margin-bottom:8px';
    progressLabel.textContent = 'loading';
    progressContainer.appendChild(progressLabel);
    progressContainer.appendChild(progressBar);
    document.body.appendChild(progressContainer);
    progressRef.current = { bar: progressBar, container: progressContainer };

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(resolveAssetUrl('/draco/'));
    dracoLoader.preload();

    loaderRef.current = new GLTFLoader();
    loaderRef.current.setDRACOLoader(dracoLoader);

    const handleSharedEffectHotkey = createSharedEffectHotkeyListener({
      cinematic: () => toggleFx(SHARED_FX_CINEMATIC),
      chromaticAberration: toggleChromaticAberration,
      databend: () => toggleFx(SHARED_FX_DATABEND),
      hueCycle: toggleHueCycle,
      pixelMosaic: togglePixelMosaic,
      thermalVision: toggleThermalVision,
      xrayMode: toggleXrayMode,
    });

    // ── Hotkey handler ────────────────────────────────────────────────────────────────
    // Arrow keys → model navigation within the active set.
    // 6         → toggle white mode.
    // G         → toggle lil-gui debug panel.
    // All post-processing hotkeys are delegated to handleSharedEffectHotkey.
    const onKeyDown = (event) => {
      if (event.code === 'Space') {
        if (event.repeat || !supportsAnimationSpeedBoost()) return;
        event.preventDefault();
        setAnimationSpeedBoost(true);
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.key === 'ArrowRight') {
          flightControlRef.current.turnRightPressed = true;
        } else {
          flightControlRef.current.turnLeftPressed = true;
        }
        return;
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (event.key === 'ArrowUp') {
          flightControlRef.current.ascendPressed = true;
        } else {
          flightControlRef.current.descendPressed = true;
        }
        return;
      }

      if (event.key === 'z' || event.key === 'Z') {
        loadNextModel(-1);
        return;
      }

      if (event.key === 'x' || event.key === 'X') {
        loadNextModel(1);
        return;
      }

      if (event.key === '6') {
        toggleWhiteMode();
        return;
      }

      if (event.key === 'g' || event.key === 'G') {
        guiControlsRef.current?.toggleGUI();
        return;
      }

      if (handleSharedEffectHotkey(event)) {
        return;
      }
    };

    const onKeyUp = (event) => {
      if (event.code === 'Space' && supportsAnimationSpeedBoost()) {
        setAnimationSpeedBoost(false);
        return;
      }

      if (event.key === 'ArrowUp') {
        flightControlRef.current.ascendPressed = false;
        return;
      }

      if (event.key === 'ArrowDown') {
        flightControlRef.current.descendPressed = false;
        return;
      }

      if (event.key === 'ArrowLeft') {
        flightControlRef.current.turnLeftPressed = false;
        return;
      }

      if (event.key === 'ArrowRight') {
        flightControlRef.current.turnRightPressed = false;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    gl.domElement.addEventListener('pointerdown', onPointerDown);
    gl.domElement.addEventListener('pointermove', onPointerMove);
    gl.domElement.addEventListener('pointerup', onPointerEnd);
    gl.domElement.addEventListener('pointercancel', onPointerEnd);

    loadDefaultModel();
    syncEffectSnapshot();
    applySceneAppearance();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      gl.domElement.removeEventListener('pointerdown', onPointerDown);
      gl.domElement.removeEventListener('pointermove', onPointerMove);
      gl.domElement.removeEventListener('pointerup', onPointerEnd);
      gl.domElement.removeEventListener('pointercancel', onPointerEnd);
      clearLongPressTimer();
      clearLastTap();
      stopTouchBoost();
      touchState.activePointers.clear();
      controls.dispose();
      guiControlsRef.current?.destroy();
      uiRef.current?.destroy();
      overlaysRef.current?.destroy();
      progressContainer.remove();
      scene.remove(monolithRef.current);
      if (skyDomeRef.current) {
        scene.remove(skyDomeRef.current);
        skyDomeRef.current.geometry.dispose();
        skyDomeRef.current.material.dispose();
      }
      if (oceanRef.current) {
        scene.remove(oceanRef.current);
        oceanRef.current.geometry.dispose();
        oceanRef.current.material.dispose();
      }
      if (cloudFieldRef.current) {
        scene.remove(cloudFieldRef.current);
        cloudFieldRef.current.traverse((child) => {
          if (child.isSprite) {
            child.material.dispose();
          }
        });
        cloudFieldRef.current.userData.texture?.dispose?.();
      }
      terrainTilesRef.current.forEach((tile) => {
        scene.remove(tile);
        disposeTerrainTileContents(tile);
      });
      terrainTilesRef.current = [];
      if (heatShimmerRef.current) {
        scene.remove(heatShimmerRef.current);
        heatShimmerRef.current.children.forEach((child) => {
          child.geometry.dispose();
        });
      }
      heatShimmerMaterialRef.current?.dispose();
      lightingRigRef.current?.dispose?.();
      lightingRigRef.current = null;
      scene.environment = null;
      scene.background = null;
      dracoLoader.dispose();
      mixerRef.current?.stopAllAction();
    };
  }, [camera, gl, scene]);

  // ── Per-frame animation loop ─────────────────────────────────────────────────────────

  useFrame((_, delta) => {
    const elapsed = clockRef.current.getElapsedTime();
    const boostVisualState = boostVisualStateRef.current;
    const boostShakeOffset = boostVisualState.lastShakeOffset;
    const boostTarget = (
      supportsAnimationSpeedBoost() && stateRef.current.animationSpeedBoostEnabled
    ) ? 1 : 0;

    if (boostShakeOffset.lengthSq() > 0) {
      camera.position.sub(boostShakeOffset);
      boostShakeOffset.set(0, 0, 0);
    }

    // Camera follows plane yaw — orbit around the plane keeping it centered
    const planePos = monolithRef.current?.position ?? new THREE.Vector3();
    const camRadius = 14;
    const camBaseY = 5.0;
    const worldYaw = flightControlRef.current.worldYaw;
    const targetCamX = planePos.x + Math.sin(worldYaw) * camRadius;
    const targetCamZ = planePos.z + Math.cos(worldYaw) * camRadius;
    const targetCamY = planePos.y + camBaseY;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, delta * 6);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, delta * 6);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCamY, delta * 4);

    const targetLookY = planePos.y + 2.5;
    controlsRef.current.target.x = THREE.MathUtils.lerp(controlsRef.current.target.x, planePos.x, delta * 6);
    controlsRef.current.target.z = THREE.MathUtils.lerp(controlsRef.current.target.z, planePos.z, delta * 6);
    controlsRef.current.target.y = THREE.MathUtils.lerp(controlsRef.current.target.y, targetLookY, delta * 4);
    controlsRef.current?.update();
    mixerRef.current?.update(delta);
    materialManagerRef.current?.updateXrayAnimation(elapsed);
    lightingRigRef.current?.updateBackgroundStars({
      cameraPosition: camera.position,
    });

    boostVisualState.intensity = THREE.MathUtils.lerp(
      boostVisualState.intensity,
      boostTarget,
      delta * BOOST_SHAKE_LERP_SPEED,
    );

    const flightControl = flightControlRef.current;
    const elevationDirection = Number(flightControl.ascendPressed) - Number(flightControl.descendPressed);
    if (elevationDirection !== 0) {
      flightControl.targetElevationOffset = THREE.MathUtils.clamp(
        flightControl.targetElevationOffset + (elevationDirection * ELEVATION_SPEED * delta),
        ELEVATION_MIN_OFFSET,
        ELEVATION_MAX_OFFSET,
      );
    }
    flightControl.elevationOffset = THREE.MathUtils.lerp(
      flightControl.elevationOffset,
      flightControl.targetElevationOffset,
      delta * ELEVATION_LERP_SPEED,
    );
    flightControl.pitchOffset = THREE.MathUtils.lerp(
      flightControl.pitchOffset,
      -elevationDirection * ELEVATION_PITCH_MAX,
      delta * ELEVATION_PITCH_LERP_SPEED,
    );

    const turnDirection = Number(flightControl.turnRightPressed) - Number(flightControl.turnLeftPressed);

    // worldYaw accumulates freely — drives sky/ocean so sun can be placed anywhere
    flightControl.worldYaw += turnDirection * 1.4 * delta;

    // Plane model yaw: small transient lean, returns to neutral on release
    flightControl.targetYawOffset = turnDirection * 0.18;
    flightControl.yawOffset = THREE.MathUtils.lerp(flightControl.yawOffset, flightControl.targetYawOffset, delta * 5);
    flightControl.bankOffset = THREE.MathUtils.lerp(flightControl.bankOffset, -turnDirection * 0.38, delta * 5);

    applyMonolithTransform();

    const targetExposure = guiParamsRef.current.exposure * (
      effectSnapshot.cinematicEnabled ? CINEMATIC_EXPOSURE_MULTIPLIER : 1
    );
    gl.toneMappingExposure = THREE.MathUtils.lerp(
      gl.toneMappingExposure,
      targetExposure,
      delta * 6,
    );

    const targetFov = THREE.MathUtils.lerp(
      BASE_CAMERA_FOV,
      BOOST_CAMERA_FOV,
      boostVisualState.intensity,
    );
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, delta * BOOST_FOV_LERP_SPEED);
    camera.updateProjectionMatrix();

    if (boostVisualState.intensity > 0.001) {
      boostShakeOffset.set(
        (Math.sin(elapsed * 23.0) + Math.sin(elapsed * 41.0 + 0.8)) * BOOST_SHAKE_X_AMPLITUDE * boostVisualState.intensity,
        (Math.sin(elapsed * 31.0 + 1.2) + Math.sin(elapsed * 53.0)) * BOOST_SHAKE_Y_AMPLITUDE * boostVisualState.intensity,
        (Math.sin(elapsed * 19.0 + 0.3) + Math.sin(elapsed * 47.0 + 2.4)) * BOOST_SHAKE_Z_AMPLITUDE * boostVisualState.intensity,
      );
      camera.position.add(boostShakeOffset);
    }

    if (skyDomeRef.current) {
      skyDomeRef.current.position.copy(camera.position);
      skyDomeRef.current.material.uniforms.time.value = elapsed;
      skyDomeRef.current.material.uniforms.yaw.value = flightControlRef.current.worldYaw;
    }

    if (OCEAN_ENABLED && oceanRef.current) {
      const oceanSpeed = CLOUD_SCROLL_SPEED * (1 + boostVisualState.intensity * 1.8);
      oceanRef.current.material.uniforms.scrollOffset.value += oceanSpeed * delta;
      oceanRef.current.material.uniforms.time.value = elapsed;
      oceanRef.current.material.uniforms.yaw.value = flightControlRef.current.worldYaw;
      oceanRef.current.material.uniforms.cameraPos.value.copy(camera.position);
    }

    if (CLOUDS_ENABLED && cloudFieldRef.current) {
      let densityAccumulator = 0;
      const monolithY = monolithRef.current?.position.y ?? 0;
      const cloudSpeed = CLOUD_SCROLL_SPEED * (1 + boostVisualState.intensity * 1.8);

      cloudFieldRef.current.children.forEach((cloud) => {
        cloud.position.z += cloudSpeed * cloud.userData.scrollSpeed * delta;
        if (cloud.position.z > 22) {
          randomizeCloudSprite(
            cloud,
            cloud.userData.layerIndex ?? 0,
            -(CLOUD_FIELD_DEPTH + (Math.random() * 28)),
          );
        }

        const zCloseness = 1 - THREE.MathUtils.smoothstep(8, 36, Math.abs(cloud.position.z));
        const yCloseness = 1 - THREE.MathUtils.smoothstep(2.5, 11.5, Math.abs(cloud.position.y - monolithY));
        const sizeWeight = THREE.MathUtils.clamp(cloud.scale.y / 26, 0.2, 1);
        densityAccumulator += zCloseness * yCloseness * cloud.material.opacity * sizeWeight;
      });

      const targetDensity = THREE.MathUtils.clamp(densityAccumulator * 0.16, 0, 1);
      cloudStateRef.current.density = THREE.MathUtils.lerp(
        cloudStateRef.current.density,
        targetDensity,
        delta * 2.2,
      );
      cloudStateRef.current.ambientFactor = THREE.MathUtils.lerp(
        1,
        CLOUD_AMBIENT_MIN_FACTOR,
        cloudStateRef.current.density,
      );
    } else {
      cloudStateRef.current.density = THREE.MathUtils.lerp(cloudStateRef.current.density, 0, delta * 2.2);
      cloudStateRef.current.ambientFactor = THREE.MathUtils.lerp(cloudStateRef.current.ambientFactor, 1, delta * 2.2);
    }

    if (TERRAIN_ENABLED && terrainTilesRef.current.length > 0) {
      const scrollSpeed = TERRAIN_SCROLL_SPEED * (1 + boostVisualState.intensity * 2.6);
      const wrapThreshold = TERRAIN_TILE_LENGTH * 0.75;
      let furthestBackZ = Infinity;
      let furthestBackLogicalZ = Infinity;

      terrainTilesRef.current.forEach((tile) => {
        furthestBackZ = Math.min(furthestBackZ, tile.position.z);
        furthestBackLogicalZ = Math.min(
          furthestBackLogicalZ,
          tile.userData.logicalZOffset ?? tile.position.z,
        );
      });

      terrainTilesRef.current.forEach((tile) => {
        tile.position.z += scrollSpeed * delta;
        if (tile.position.z > wrapThreshold) {
          const nextRenderZOffset = furthestBackZ - TERRAIN_TILE_LENGTH;
          const nextLogicalZOffset = furthestBackLogicalZ - TERRAIN_TILE_LENGTH;
          disposeTerrainTileContents(tile);
          populateTerrainTile(tile, {
            renderZOffset: nextRenderZOffset,
            logicalZOffset: nextLogicalZOffset,
          });
          furthestBackZ = nextRenderZOffset;
          furthestBackLogicalZ = nextLogicalZOffset;
        }
      });
    }

    if (heatShimmerRef.current && heatShimmerRef.current.children.length > 0) {
      const engineShimmers = getModelEngineShimmers(stateRef.current.currentModelIndex);
      const isBoosting = engineShimmers.length > 0
        && stateRef.current.animationSpeedBoostEnabled
        && supportsAnimationSpeedBoost();
      const firstMesh = heatShimmerRef.current.children[0];
      const mat = firstMesh.material;
      
      const currentIntensity = mat.uniforms.boostIntensity.value;
      const targetIntensity = isBoosting ? 1.0 : 0.0;
      
      mat.uniforms.boostIntensity.value = THREE.MathUtils.lerp(currentIntensity, targetIntensity, delta * 10);
      mat.uniforms.time.value = elapsed;
      
      heatShimmerRef.current.visible = mat.uniforms.boostIntensity.value > 0.01;

      heatShimmerRef.current.children.forEach((mesh, index) => {
        const shimmer = engineShimmers[index];
        if (!shimmer) return;
        mesh.position.set(shimmer.x, shimmer.y, shimmer.z);
      });
      
      if (monolithRef.current) {
        heatShimmerRef.current.position.copy(monolithRef.current.position);
        heatShimmerRef.current.rotation.copy(monolithRef.current.rotation);
      }
    }

    if (stateRef.current.hueCycleEnabled) {
      guiParamsRef.current.hue = getHueCycleHue(
        stateRef.current.hueCycleBaseHue,
        stateRef.current.hueCycleStartTime,
        elapsed,
      );
      guiParamsRef.current.saturation = 1;
    }

    if (stateRef.current.lightingMode === LIGHTING_MODE_SCENE) {
      lightingRigRef.current?.updateSceneLighting({
        forceRefresh: effectSnapshot.cinematicEnabled && effectSnapshot.bloomEnabled,
      });
    } else if (stateRef.current.lightingMode === LIGHTING_MODE_PARTICLES) {
      lightingRigRef.current?.updateParticleLighting();
    }

    if (effectSnapshot.cinematicEnabled && effectSnapshot.bloomEnabled) {
      lightingRigRef.current?.animateBloomRing();
    }
  });

  return <SharedEffectStack {...effectSnapshot} />;
}

export default function MonolithCanvas() {
  const dpr = useMemo(() => Math.min(window.devicePixelRatio, 2), []);

  return (
    <SafeCanvas
      dpr={dpr}
      rendererOptions={{ antialias: true, alpha: true }}
      sceneLabel="Planes"
    >
      <Suspense fallback={null}>
        <MonolithScene />
      </Suspense>
    </SafeCanvas>
  );
}
