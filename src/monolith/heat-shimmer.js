import * as THREE from 'three';

// ── Heat shimmer ───────────────────────────────────────────────────────────────
// Creates the afterburner flame effect attached to engine exhaust positions.
// The shader uses multi-frequency turbulence in the vertex stage to deform a
// truncated cone into a flickering flame shape, and a colour ramp from blue
// core → orange → red tips in the fragment stage. Intensity is driven by the
// `boostIntensity` uniform which the main loop lerps toward 0 or 1.

// ── Shader material factory ────────────────────────────────────────────────────

export function createHeatShimmerMaterial() {
  return new THREE.ShaderMaterial({
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
}

// ── Shimmer group factory ──────────────────────────────────────────────────────
// Creates the Group that holds the shimmer meshes and the shared material.
// Individual engine cones are added/rebuilt by rebuildHeatShimmerMeshes() in
// MonolithCanvas.jsx when the active model changes.

export function createHeatShimmerGroup() {
  const shimmerMat = createHeatShimmerMaterial();
  const shimmerGroup = new THREE.Group();
  shimmerGroup.visible = false;

  // Create two initial cylinders (most planes have 1–2 engines)
  const geoLeft = new THREE.CylinderGeometry(0.3, 0.0, 4.5, 32, 16, true);
  geoLeft.rotateZ(Math.PI / 2);

  const geoRight = new THREE.CylinderGeometry(0.3, 0.0, 4.5, 32, 16, true);
  geoRight.rotateZ(Math.PI / 2);

  shimmerGroup.add(new THREE.Mesh(geoLeft, shimmerMat));
  shimmerGroup.add(new THREE.Mesh(geoRight, shimmerMat));

  return { shimmerGroup, shimmerMat };
}
