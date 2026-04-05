import * as THREE from 'three';

// ── Material manager ─────────────────────────────────────────────────────────────
// Centralises all material-related operations for Monolith models:
//   - State capture/restore so any material can be reset to its GLB defaults
//   - Per-collection style overrides (anime flat shading, metalness/roughness tuning)
//   - X-ray mode: injects GLSL into Three.js’s shader via onBeforeCompile,
//     adding animated rim glow, scanline distortion, and transparency pulses
//   - Texture anisotropy maximisation on load
//
// All functions are fully encapsulated. The returned object is the only
// surface MonolithScene interacts with.

export function createMaterialManager(renderer) {
  // ── State capture / restore ───────────────────────────────────────────────
  // We store the original property values from the parsed GLB so any mode
  // (overrides, anime, x-ray) can be reverted cleanly without reloading.
  const originalMaterialState = new WeakMap();
  const xrayAnimatedMaterials = new Set();

  // X-ray shader visual constants
  const XRAY_RIM_STRENGTH = 1.35;
  const XRAY_RIM_POWER = 2.4;
  const XRAY_RIM_COLOR = new THREE.Color(0xe8fbff);

  function forEachMaterial(model, callback) {
    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(callback);
    });
  }

  function captureOriginalMaterialState(mat) {
    if (originalMaterialState.has(mat)) return;
    originalMaterialState.set(mat, {
      color: mat.color?.clone() ?? null,
      emissive: mat.emissive?.clone() ?? null,
      emissiveIntensity: mat.emissiveIntensity,
      map: mat.map ?? null,
      emissiveMap: mat.emissiveMap ?? null,
      metalnessMap: mat.metalnessMap ?? null,
      roughnessMap: mat.roughnessMap ?? null,
      envMap: mat.envMap ?? null,
      envMapIntensity: mat.envMapIntensity,
      metalness: mat.metalness,
      roughness: mat.roughness,
      transparent: mat.transparent,
      opacity: mat.opacity,
      depthWrite: mat.depthWrite,
      side: mat.side,
      alphaTest: mat.alphaTest,
      alphaHash: mat.alphaHash,
      onBeforeCompile: mat.onBeforeCompile,
      customProgramCacheKey: mat.customProgramCacheKey,
    });
  }

  function restoreOriginalMaterialState(mat) {
    const original = originalMaterialState.get(mat);
    if (!original) return;

    if (original.color && mat.color) mat.color.copy(original.color);
    if (original.emissive && mat.emissive) mat.emissive.copy(original.emissive);
    if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = original.emissiveIntensity ?? 1;
    if ('map' in mat) mat.map = original.map;
    if ('emissiveMap' in mat) mat.emissiveMap = original.emissiveMap;
    if ('metalnessMap' in mat) mat.metalnessMap = original.metalnessMap;
    if ('roughnessMap' in mat) mat.roughnessMap = original.roughnessMap;
    if ('envMap' in mat) mat.envMap = original.envMap;
    if (mat.envMapIntensity !== undefined) mat.envMapIntensity = original.envMapIntensity ?? 1;
    if (mat.metalness !== undefined) mat.metalness = original.metalness ?? mat.metalness;
    if (mat.roughness !== undefined) mat.roughness = original.roughness ?? mat.roughness;
    mat.transparent = original.transparent;
    mat.opacity = original.opacity;
    mat.depthWrite = original.depthWrite;
    mat.side = original.side;
    mat.alphaTest = original.alphaTest;
    mat.alphaHash = original.alphaHash;
    mat.onBeforeCompile = original.onBeforeCompile;
    mat.customProgramCacheKey = original.customProgramCacheKey;
    delete mat.userData.xrayShader;
    delete mat.userData.xrayShaderApplied;
    xrayAnimatedMaterials.delete(mat);
    mat.needsUpdate = true;
  }

  // ── X-ray shader ────────────────────────────────────────────────────────────
  // applyXrayShader patches onBeforeCompile to inject custom GLSL uniforms
  // into Three.js’s built-in material shaders. The injected code adds:
  //   - Animated rim light (fresnel-based, view-dependent)
  //   - Vertex position distortion along Y-axis scanlines
  //   - Animated opacity/scanline teardown in the fragment stage
  // userData.xrayShader holds a reference to the compiled ShaderObject so
  // updateXrayAnimation() can update uniforms each frame without re-compiling.
  function applyXrayShader(mat) {
    if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial && !mat.isMeshPhongMaterial && !mat.isMeshLambertMaterial) {
      return;
    }
    if (!('onBeforeCompile' in mat)) return;
    if (mat.userData.xrayShaderApplied) return;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.xrayRimColor = { value: XRAY_RIM_COLOR.clone() };
      shader.uniforms.xrayRimStrength = { value: XRAY_RIM_STRENGTH };
      shader.uniforms.xrayRimPower = { value: XRAY_RIM_POWER };
      shader.uniforms.xrayTime = { value: 0 };
      shader.uniforms.xrayPulse = { value: 0 };
      shader.uniforms.xrayPhase = { value: 0 };
      shader.uniforms.xrayDistortionStrength = { value: 0 };

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float xrayTime;
        uniform float xrayPulse;
        uniform float xrayPhase;
        uniform float xrayDistortionStrength;`,
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float xrayBand = smoothstep(0.72, 0.98, sin((position.y * 7.5) - (xrayTime * 18.0) + (xrayPhase * 4.0)));
        float xrayJitter = sin((position.y * 24.0) + (xrayTime * 42.0) + (xrayPhase * 9.0));
        transformed.x += xrayBand * xrayJitter * (0.045 * xrayPulse * xrayDistortionStrength);`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform vec3 xrayRimColor;
        uniform float xrayRimStrength;
        uniform float xrayRimPower;
        uniform float xrayTime;
        uniform float xrayPulse;
        uniform float xrayPhase;
        uniform float xrayDistortionStrength;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `float xrayViewDot = abs(dot(normalize(vNormal), normalize(vViewPosition)));
        float xrayRim = pow(1.0 - clamp(xrayViewDot, 0.0, 1.0), xrayRimPower);
        float xrayScan = 0.55 + 0.45 * sin((gl_FragCoord.y * 0.18) - (xrayTime * 14.0));
        float xrayNoise = sin(xrayTime * 24.0 + gl_FragCoord.y * 0.09)
          + 0.65 * sin(xrayTime * 41.0 + gl_FragCoord.x * 0.05)
          + 0.35 * sin(xrayTime * 67.0 + (gl_FragCoord.x + gl_FragCoord.y) * 0.025);
        float xrayGate = smoothstep(0.2, 1.55, xrayNoise);
        float xrayFlash = smoothstep(1.2, 1.9, xrayNoise);
        float xrayLocalPulse = max(xrayGate * xrayScan, xrayFlash * 1.35);
        float xraySyncPulse = max(xrayPulse, xrayLocalPulse * 0.45);
        float scanlineWave = sin((gl_FragCoord.y * 1.25) - (xrayTime * 22.0) + (xrayPhase * 9.0));
        float scanlineMask = 1.0 - (0.16 * xrayDistortionStrength * (0.5 + 0.5 * scanlineWave) * (0.3 + 0.7 * xraySyncPulse));
        float tearBand = smoothstep(0.72, 0.98, sin((gl_FragCoord.y * 0.32) - (xrayTime * 16.0) + (xrayPhase * 5.0)));
        float tearShift = sin((gl_FragCoord.x * 0.09) + (xrayTime * 34.0) + (xrayPhase * 13.0));
        float tearMask = 1.0 + (tearBand * tearShift * 0.16 * xraySyncPulse * xrayDistortionStrength);
        outgoingLight *= scanlineMask * tearMask;
        outgoingLight *= 0.28 + (0.95 * xrayLocalPulse);
        outgoingLight += xrayRimColor * (xrayRim * xrayRimStrength * (0.35 + 1.9 * xraySyncPulse));
        diffuseColor.a *= (0.82 + (0.18 * scanlineMask)) * (0.05 + (0.95 * xraySyncPulse));
        #include <output_fragment>`,
      );

      mat.userData.xrayShader = shader;
    };

    mat.customProgramCacheKey = () => 'xray-rim';
    mat.userData.xrayShaderApplied = true;
    mat.needsUpdate = true;
  }

  function applyMaterialOverrides(model, def, modelIndex) {
    forEachMaterial(model, (mat) => {
      captureOriginalMaterialState(mat);
      restoreOriginalMaterialState(mat);

      if (mat.emissiveMap) {
        mat.emissiveMap = null;
        if (mat.emissive) mat.emissive.set(0x000000);
        mat.needsUpdate = true;
      }

      if (def.materialStyle === 'anime') {
        mat.metalness = 0;
        mat.roughness = 1.0;
        mat.envMap = null;
        mat.envMapIntensity = 0;
        if (mat.metalnessMap) mat.metalnessMap = null;
        if (mat.roughnessMap) mat.roughnessMap = null;
        mat.needsUpdate = true;
        return;
      }

      if (def.materialOverrides) {
        for (const override of def.materialOverrides) {
          if (override.match(modelIndex)) {
            mat.metalness = override.metalness !== undefined
              ? Math.min(mat.metalness, override.metalness)
              : mat.metalness;
            mat.roughness = override.roughness !== undefined
              ? Math.max(mat.roughness, override.roughness)
              : mat.roughness;
            if (override.clearMetalnessMap && mat.metalnessMap) mat.metalnessMap = null;
            mat.needsUpdate = true;
            break;
          }
        }
      }
    });
  }

  function applyXrayMaterial(model) {
    forEachMaterial(model, (mat) => {
      captureOriginalMaterialState(mat);
      const original = originalMaterialState.get(mat);
      applyXrayShader(mat);
      xrayAnimatedMaterials.add(mat);
      if (original?.color && mat.color) {
        mat.color.copy(original.color).lerp(new THREE.Color(0xf5fbff), 0.42);
      } else if (mat.color) {
        mat.color.set(0xf5fbff);
      }
      if (mat.emissive) mat.emissive.set(0xbfefff);
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0.2;
      if ('envMap' in mat) mat.envMap = null;
      if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0;
      if (mat.metalness !== undefined) mat.metalness = 0;
      if (mat.roughness !== undefined) mat.roughness = Math.min(Math.max(mat.roughness, 0.45), 0.8);
      mat.transparent = true;
      mat.opacity = 0.3;
      mat.depthWrite = false;
      mat.alphaHash = false;
      mat.side = THREE.DoubleSide;
      mat.needsUpdate = true;
    });
  }

  // ── Material application ─────────────────────────────────────────────────────

  function applyModelMaterials(model, def, modelIndex, xrayMode) {
    applyMaterialOverrides(model, def, modelIndex);
    const flickerStrength = def.xrayFlickerStrength ?? 0;
    const distortionStrength = def.xrayDistortionStrength ?? 0;
    forEachMaterial(model, (mat) => {
      mat.userData.xrayFlickerStrength = flickerStrength;
      mat.userData.xrayDistortionStrength = distortionStrength;
    });
    if (xrayMode) applyXrayMaterial(model);
  }

  function normalizeModelTransform(model, def, index) {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);

    const scale = (5 / Math.max(size.x, size.y, size.z)) * 1.5625;
    model.scale.setScalar(scale);

    box.setFromObject(model);
    const center = new THREE.Vector3();
    box.getCenter(center);
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;

    const yOffset = def.positionYOffsetOverrides?.[index] ?? def.positionYOffset ?? -1.2;
    model.position.y += yOffset;

    if (def.rotationOverride) {
      model.rotation.x = def.rotationOverride.x;
      model.rotation.y = def.rotationOverride.y;
      model.rotation.z = def.rotationOverride.z;
    } else {
      model.rotation.y = 0.35;
    }
  }

  // ── Texture and geometry utilities ──────────────────────────────────────────

  function applyModelTextureFiltering(model) {
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    model.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        for (const prop of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
          if (mat[prop]) {
            mat[prop].anisotropy = maxAniso;
            mat[prop].needsUpdate = true;
          }
        }
      }
    });
  }

  // ── Per-frame x-ray animation ─────────────────────────────────────────────────
  // Updates the uniforms injected by applyXrayShader() each frame.
  // Only materials in the xrayAnimatedMaterials Set are visited.
  function updateXrayAnimation(time) {
    for (const mat of xrayAnimatedMaterials) {
      const shader = mat.userData.xrayShader;
      const phase = (mat.id % 7) * 0.37;
      const scan = 0.72 + 0.28 * Math.sin((time * 18) + phase);
      const breakup = Math.sin((time * 28) + phase) + (0.22 * Math.sin((time * 47) + (phase * 2.3)));
      const visibleGate = THREE.MathUtils.smoothstep(breakup, -0.35, 0.9);
      const flash = THREE.MathUtils.smoothstep(breakup, 1.28, 1.5);
      const pulse = Math.max(visibleGate * (0.78 + 0.22 * scan), flash * 0.45);

      if (shader) {
        shader.uniforms.xrayTime.value = time;
        shader.uniforms.xrayPulse.value = pulse;
        shader.uniforms.xrayPhase.value = phase;
        shader.uniforms.xrayDistortionStrength.value = mat.userData.xrayDistortionStrength ?? 0;
      }

      const flickerStrength = mat.userData.xrayFlickerStrength ?? 0;
      const animatedPulse = flickerStrength > 0 ? pulse : 1;

      mat.opacity = 0.2 + (0.12 * animatedPulse);
      if (mat.emissiveIntensity !== undefined) {
        mat.emissiveIntensity = 0.18 + (0.2 * animatedPulse);
      }
    }
  }

  return {
    applyModelMaterials,
    applyModelTextureFiltering,
    normalizeModelTransform,
    updateXrayAnimation,
  };
}
