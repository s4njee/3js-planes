import * as THREE from 'three';

import {
  SKY_DOME_RADIUS,
  OCEAN_Y,
  OCEAN_SIZE,
  CLOUD_LAYER_COUNT,
  CLOUDS_PER_LAYER,
  CLOUD_FIELD_BASE_Y,
  CLOUD_FIELD_WIDTH,
  CLOUD_FIELD_DEPTH,
  CLOUD_FIELD_HEIGHT,
} from './constants.js';

// ── Environment ────────────────────────────────────────────────────────────────
// Factory functions for the three major environmental layers that surround the
// aircraft: the procedural sky dome (GLSL gradient + sun + god rays), the
// reflective ocean plane, and the volumetric cloud field built from sprite
// billboards.

// ── Sky dome ───────────────────────────────────────────────────────────────────
// A large inverted sphere with a fragment shader that paints a sunset gradient,
// animated nebula wisps, a sun disc with bloom, and crepuscular god rays.
// The `yaw` uniform rotates the entire sky to match the flight direction.

export function createSkyDome() {
  const geometry = new THREE.SphereGeometry(SKY_DOME_RADIUS, 48, 32);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      yaw: { value: 0 },
      sunDirection: { value: new THREE.Vector3(-0.55, 0.06, -1.0).normalize() },
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
      uniform vec3 sunDirection;
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

      vec3 rotateY(vec3 v, float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
      }

      void main() {
        vec3 dir = normalize(vDirection);
        dir = rotateY(dir, yaw);
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
        vec3 sunDir = normalize(sunDirection);
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

// ── Cloud texture ──────────────────────────────────────────────────────────────
// Procedurally generates a soft, cloud-like alpha texture on a canvas. Used as
// the sprite map for every cloud billboard in the field.

export function createCloudTexture() {
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

// ── Cloud sprite randomisation ─────────────────────────────────────────────────
// Places a single cloud sprite at a random position within its vertical layer,
// giving it a randomised scale, opacity, and scroll speed.

export function randomizeCloudSprite(sprite, layerIndex, depth = null) {
  const layerT = CLOUD_LAYER_COUNT <= 1 ? 0.5 : layerIndex / (CLOUD_LAYER_COUNT - 1);
  const layerCenterY = CLOUD_FIELD_BASE_Y + THREE.MathUtils.lerp(-(CLOUD_FIELD_HEIGHT * 0.5), CLOUD_FIELD_HEIGHT * 0.5, layerT);
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

// ── Cloud field ────────────────────────────────────────────────────────────────
// Creates the full cloud canopy: CLOUD_LAYER_COUNT vertical layers, each with
// CLOUDS_PER_LAYER sprite billboards. The group scrolls toward the camera in
// the useFrame loop to simulate forward flight.

export function createCloudField() {
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

// ── Ocean ──────────────────────────────────────────────────────────────────────
// A single large PlaneGeometry with a shader that renders animated waves,
// Fresnel-based sky reflections, sun specular highlights, and distance fade.
// The `yaw` uniform rotates the wave pattern and sun reflection to match the
// sky dome's orientation.

export function createOcean() {
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

        float s = sin(yaw);
        float c = cos(yaw);
        vec2 rotatedPos = vec2(vWorldPos.x * c + vWorldPos.z * s, -vWorldPos.x * s + vWorldPos.z * c);

        // Wave normals from scrolling noise
        vec2 flightDir = vec2(sin(yaw), -cos(yaw));
        vec2 flight = flightDir * scrollOffset * 0.04;
        vec2 uv1 = rotatedPos * 0.04 + vec2(time * 0.02, time * 0.015) + flight;
        vec2 uv2 = rotatedPos * 0.08 + vec2(-time * 0.015, time * 0.01) + flight * 2.0;

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

        float sunS = sin(-yaw);
        float sunC = cos(-yaw);
        vec3 baseSunDir = vec3(-0.55, 0.08, -1.0);
        vec3 sunDir = normalize(vec3(baseSunDir.x * sunC + baseSunDir.z * sunS, baseSunDir.y, -baseSunDir.x * sunS + baseSunDir.z * sunC));

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
