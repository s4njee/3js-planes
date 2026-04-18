import * as THREE from 'three';

import {
  TERRAIN_GENERATOR_ARGS,
  TERRAIN_HEIGHT_STRENGTH,
  TERRAIN_TILE_LENGTH,
  TERRAIN_TILE_OVERLAP,
  TERRAIN_WIDTH,
  TERRAIN_RESOLUTION,
  TERRAIN_BASE_Y,
  TERRAIN_TREE_COUNT,
  TERRAIN_TREE_ATTEMPT_MULTIPLIER,
  TERRAIN_SAMPLE_Z_SCALE,
  TERRAIN_SAMPLE_X_DRIFT,
  TERRAIN_SAMPLE_Z_WARP,
  TERRAIN_RIVER_WIDTH,
  TERRAIN_RIVER_FALLOFF,
} from './constants.js';

// ── Terrain generation ─────────────────────────────────────────────────────────
// Procedural terrain built from layered FBM noise: base heightfield, biome
// moisture, hydraulic erosion carving, and meandering rivers. Each tile is a
// PlaneGeometry with per-vertex height, normal, and colour, plus instanced
// cone-trees planted by a rejection sampler.

// ── Noise primitives ───────────────────────────────────────────────────────────

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

// ── FBM noise sampler factory ──────────────────────────────────────────────────

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

// ── Coordinate warping ─────────────────────────────────────────────────────────

function getTerrainSampleCoordinates(x, logicalZ) {
  return {
    sampleX: x
      + (Math.sin(logicalZ * 0.0065) * TERRAIN_SAMPLE_X_DRIFT)
      + (Math.sin(logicalZ * 0.0023) * 12),
    sampleZ: (logicalZ * TERRAIN_SAMPLE_Z_SCALE) + (Math.sin(x * 0.021) * TERRAIN_SAMPLE_Z_WARP),
  };
}

// ── Noise instances ────────────────────────────────────────────────────────────

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

// ── Heightfield sampling ───────────────────────────────────────────────────────

export function sampleTerrainField(x, worldZ) {
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

export function getTerrainHeight(x, worldZ) {
  return sampleTerrainField(x, worldZ).height;
}

// ── Biome classification ───────────────────────────────────────────────────────

export function getTerrainBiomeFromField(field, height = field.height) {
  const moisture = THREE.MathUtils.clamp(0.54 + (field.biomeNoise * 0.3) + (field.riverMask * 0.95), 0.18, 1.15);
  const fertility = THREE.MathUtils.clamp(moisture - (Math.max(height, 0) * 0.024), 0.08, 1.05);
  return {
    fertility,
    moisture,
    riverMask: field.riverMask,
  };
}

export function getTerrainBiome(x, worldZ, height) {
  return getTerrainBiomeFromField(sampleTerrainField(x, worldZ), height);
}

// ── Normal estimation ──────────────────────────────────────────────────────────

export function getTerrainNormal(x, worldZ) {
  const sampleOffset = 0.8;
  const slopeX = getTerrainHeight(x + sampleOffset, worldZ) - getTerrainHeight(x - sampleOffset, worldZ);
  const slopeZ = getTerrainHeight(x, worldZ + sampleOffset) - getTerrainHeight(x, worldZ - sampleOffset);
  return new THREE.Vector3(-slopeX, sampleOffset * 2, -slopeZ).normalize();
}

// ── Tile disposal ──────────────────────────────────────────────────────────────

export function disposeTerrainTileContents(tileGroup) {
  tileGroup.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    child.material.dispose();
  });
  tileGroup.clear();
}

// ── Tile population ────────────────────────────────────────────────────────────
// Builds the heightfield mesh and plants instanced trees for a single tile.

export function populateTerrainTile(tileGroup, { renderZOffset, logicalZOffset }) {
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

  // ── Tree instancing ────────────────────────────────────────────────────────
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

// ── Tile factory ───────────────────────────────────────────────────────────────

export function createTerrainTile({ renderZOffset, logicalZOffset }) {
  const tileGroup = new THREE.Group();
  populateTerrainTile(tileGroup, { renderZOffset, logicalZOffset });
  return tileGroup;
}
