import * as THREE from 'three';
import GUI from 'lil-gui';

// ── GUI controls ──────────────────────────────────────────────────────────────
// Wraps lil-gui to provide a floating debug panel for Monolith.
//
// Two exports:
//   createDefaultGuiParams() — the canonical starting values for every slider
//     and toggle. MonolithScene holds a live ref to this object; lil-gui reads
//     and writes it directly via its mutable-object pattern.
//
//   createGuiControls(...)   — builds the panel, wires all folder/controller
//     callbacks, and returns { destroy, syncGuiDisplay, toggleGUI }.
//     syncGuiDisplay() is called after any external state change so the panel
//     reflects the current values without the user having to reopen it.
//
// The panel is hidden by default and toggled with the G key (wired in
// MonolithCanvas.jsx). It stays at z-index 200 so it floats above everything.

// ── Default params ──────────────────────────────────────────────────────────────
// Bloom values are tuned for Monolith’s legacy UnrealBloomPass range and are
// translated to @react-three/postprocessing equivalents in mapMonolithBloomSettings().

export function createDefaultGuiParams() {
  const lightingModes = ['A (Scene)', 'B (Particles)'];

  return {
    showGUI: false,
    bloomEnabled: true,
    bloomStrength: 0.5,
    bloomRadius: 0.15,
    bloomThreshold: 0.77,
    barrelBlurEnabled: false,
    barrelBlurAmount: 0.12,
    barrelBlurOffsetX: 0.0,
    barrelBlurOffsetY: 0.0,
    chromaticAberrationEnabled: false,
    chromaticAberrationOffsetX: 0.004,
    chromaticAberrationOffsetY: 0.004,
    chromaticAberrationRadialModulation: false,
    chromaticAberrationModulationOffset: 0.15,
    hueSatEnabled: false,
    hue: 0.0,
    saturation: 0.0,
    glitchDuration: 0.4,
    glitchStrength: 1.0,
    scanlineEnabled: true,
    scanlineDensity: 5.13,
    scanlineOpacity: 0.75,
    scanlineScrollSpeed: 0.08,
    exposure: 1.4,
    toneMapping: 'ACESFilmic',
    ambientOverrideEnabled: true,
    ambientIntensity: 0.78,
    ambientColor: '#ffffff',
    backgroundColor: '#111111',
    whiteMode: false,
    lightingMode: lightingModes[0],
  };
}

// ── GUI panel builder ──────────────────────────────────────────────────────────────

export function createGuiControls({
  guiParams,
  renderer,
  scene,
  onChromaticAberrationChange,
  onEffectSettingsChange,
  onWhiteModeChange,
  onLightingModeChange,
  onTriggerGlitch,
}) {
  const lightingModes = ['A (Scene)', 'B (Particles)'];

  const gui = new GUI({ title: '⚙ Settings' });
  gui.domElement.style.zIndex = '200';
  gui.hide();

  // ── Post-processing folders ──────────────────────────────────────────────────────

  const bloomFolder = gui.addFolder('Bloom');
  bloomFolder.add(guiParams, 'bloomEnabled').name('Enabled').onChange(onEffectSettingsChange);
  bloomFolder.add(guiParams, 'bloomStrength', 0, 3, 0.01).name('Strength').onChange(onEffectSettingsChange);
  bloomFolder.add(guiParams, 'bloomRadius', 0, 1, 0.01).name('Radius').onChange(onEffectSettingsChange);
  bloomFolder.add(guiParams, 'bloomThreshold', 0, 1, 0.01).name('Threshold').onChange(onEffectSettingsChange);

  const barrelBlurFolder = gui.addFolder('Barrel Blur');
  barrelBlurFolder.add(guiParams, 'barrelBlurEnabled').name('Enabled').onChange(onEffectSettingsChange);
  barrelBlurFolder.add(guiParams, 'barrelBlurAmount', 0, 0.5, 0.001).name('Amount').onChange(onEffectSettingsChange);
  barrelBlurFolder.add(guiParams, 'barrelBlurOffsetX', -0.5, 0.5, 0.001).name('Offset X').onChange(onEffectSettingsChange);
  barrelBlurFolder.add(guiParams, 'barrelBlurOffsetY', -0.5, 0.5, 0.001).name('Offset Y').onChange(onEffectSettingsChange);

  const chromaticAberrationFolder = gui.addFolder('Chromatic Aberration');
  chromaticAberrationFolder.add(guiParams, 'chromaticAberrationEnabled').name('Enabled').onChange(onChromaticAberrationChange);
  chromaticAberrationFolder.add(guiParams, 'chromaticAberrationOffsetX', 0, 0.5, 0.001).name('Offset X').onChange(onEffectSettingsChange);
  chromaticAberrationFolder.add(guiParams, 'chromaticAberrationOffsetY', 0, 0.5, 0.001).name('Offset Y').onChange(onEffectSettingsChange);
  chromaticAberrationFolder.add(guiParams, 'chromaticAberrationRadialModulation').name('Radial Modulation').onChange(onEffectSettingsChange);
  chromaticAberrationFolder.add(guiParams, 'chromaticAberrationModulationOffset', 0, 1, 0.001).name('Modulation Offset').onChange(onEffectSettingsChange);

  const hueSatFolder = gui.addFolder('Hue & Saturation');
  hueSatFolder.add(guiParams, 'hueSatEnabled').name('Enabled').onChange(onEffectSettingsChange);
  hueSatFolder.add(guiParams, 'hue', -Math.PI, Math.PI, 0.001).name('Hue').onChange(onEffectSettingsChange);
  hueSatFolder.add(guiParams, 'saturation', -1, 1, 0.001).name('Saturation').onChange(onEffectSettingsChange);

  const glitchFolder = gui.addFolder('Glitch');
  glitchFolder.add(guiParams, 'glitchDuration', 0.1, 2.0, 0.01).name('Duration (s)').onChange(onEffectSettingsChange);
  glitchFolder.add(guiParams, 'glitchStrength', 0.1, 3.0, 0.01).name('Strength').onChange(onEffectSettingsChange);
  glitchFolder.add({ trigger: () => onTriggerGlitch() }, 'trigger').name('⚡ Test Glitch');

  const scanlineFolder = gui.addFolder('Scanline');
  scanlineFolder.add(guiParams, 'scanlineEnabled').name('Enabled').onChange(onEffectSettingsChange);
  scanlineFolder.add(guiParams, 'scanlineDensity', 0.1, 10, 0.01).name('Density').onChange(onEffectSettingsChange);
  scanlineFolder.add(guiParams, 'scanlineOpacity', 0, 1, 0.01).name('Opacity').onChange(onEffectSettingsChange);
  scanlineFolder.add(guiParams, 'scanlineScrollSpeed', 0, 2, 0.01).name('Scroll Speed').onChange(onEffectSettingsChange);

  // ── Renderer folders ────────────────────────────────────────────────────────────

  const toneFolder = gui.addFolder('Tone Mapping');
  toneFolder.add(guiParams, 'exposure', 0, 3, 0.01).name('Exposure').onChange((value) => {
    renderer.toneMappingExposure = value;
  });
  toneFolder.add(guiParams, 'toneMapping', ['NoToneMapping', 'Linear', 'Reinhard', 'Cineon', 'ACESFilmic', 'AgX', 'Neutral']).name('Algorithm').onChange((value) => {
    const map = {
      NoToneMapping: THREE.NoToneMapping,
      Linear: THREE.LinearToneMapping,
      Reinhard: THREE.ReinhardToneMapping,
      Cineon: THREE.CineonToneMapping,
      ACESFilmic: THREE.ACESFilmicToneMapping,
      AgX: THREE.AgXToneMapping,
      Neutral: THREE.NeutralToneMapping,
    };
    renderer.toneMapping = map[value] ?? THREE.ACESFilmicToneMapping;
  });

  // ── Scene / lighting folders ────────────────────────────────────────────────────

  const ambientFolder = gui.addFolder('Ambient Light');
  ambientFolder.add(guiParams, 'ambientOverrideEnabled').name('Override Enabled');
  ambientFolder.add(guiParams, 'ambientIntensity', 0, 10, 0.01).name('Intensity');
  ambientFolder.addColor(guiParams, 'ambientColor').name('Color');

  const sceneFolder = gui.addFolder('Scene');
  sceneFolder.addColor(guiParams, 'backgroundColor').name('Background').onChange((value) => {
    scene.background = new THREE.Color(value);
    document.body.style.background = value;
  });
  sceneFolder.add(guiParams, 'whiteMode').name('White Mode').onChange((value) => {
    onWhiteModeChange(value);
  });
  sceneFolder.add(guiParams, 'lightingMode', lightingModes).name('Lighting Mode').onChange((value) => {
    onLightingModeChange(Math.max(lightingModes.indexOf(value), 0));
  });

  // ── Panel show/hide helpers ─────────────────────────────────────────────────────

  let guiVisible = false;

  function syncGuiDisplay() {
    // Refreshes every controller so external state changes (hotkeys, mode
    // switches) are immediately reflected without reopening the panel.
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  }

  function toggleGUI() {
    guiVisible = !guiVisible;
    if (guiVisible) gui.show();
    else gui.hide();
  }

  return {
    destroy: () => gui.destroy(),
    guiParams,
    syncGuiDisplay,
    toggleGUI,
  };
}
