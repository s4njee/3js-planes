// ── DOM UI ────────────────────────────────────────────────────────────────────
// Builds and manages all persistent DOM chrome for the Monolith scene.
// Everything here is imperative DOM construction (createElement + cssText)
// rather than React, because MonolithScene renders inside a Three.js Canvas
// and these elements live in the page body outside the canvas hierarchy.
//
// Elements created:
//   label       — bottom-centre model name, shown briefly after each load
//   modeNav     — top-left row of lighting-mode buttons (A / B)
//
// All elements are appended to document.body and removed in destroy().
// The label timeout ID is tracked locally (labelTimeout) and cleared in
// destroy() to match the cleanup contract.
//
// See root ToDo.md §2 for the planned localStorage set/model persistence.

export function createUI({
  getWhiteMode,
  getLightingMode,
  onSwitchLightingMode,
}) {
  // ── Model name label ──────────────────────────────────────────────────────

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);color:#fff;font:14px/1 monospace;opacity:0;transition:opacity 0.3s;pointer-events:none;text-shadow:0 1px 4px #000';
  document.body.appendChild(label);

  let labelTimeout;

  // ── Shared button style helper ────────────────────────────────────────────────────

  const BTN_CSS = 'width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.3);color:#fff;font:14px/1 monospace;cursor:pointer;background:rgba(255,255,255,0.05);transition:all 0.2s;user-select:none';

  function styleButton(button, active) {
    const whiteMode = getWhiteMode();
    const colorTriplet = whiteMode ? '0,0,0' : '255,255,255';
    button.style.color = whiteMode ? '#000' : '#fff';
    button.style.background = `rgba(${colorTriplet},${active ? (whiteMode ? 0.15 : 0.25) : 0.05})`;
    button.style.borderColor = `rgba(${colorTriplet},${active ? 0.7 : 0.3})`;
  }

  // ── Lighting mode buttons (A / B) ──────────────────────────────────────────────────

  const modeNav = document.createElement('div');
  modeNav.style.cssText = 'position:fixed;top:16px;left:16px;display:flex;gap:8px;z-index:10';
  document.body.appendChild(modeNav);

  const modeButtons = [];
  ['A', 'B'].forEach((labelText, index) => {
    const button = document.createElement('div');
    button.textContent = labelText;
    button.style.cssText = BTN_CSS;
    button.addEventListener('click', () => onSwitchLightingMode(index));
    button.addEventListener('mouseenter', () => {
      if (index !== getLightingMode()) styleButton(button, false);
    });
    button.addEventListener('mouseleave', () => {
      if (index !== getLightingMode()) styleButton(button, false);
    });
    modeNav.appendChild(button);
    modeButtons.push(button);
  });

  // ── Update helpers and public API ───────────────────────────────────────────────────

  function updateLabel(name) {
    label.textContent = name;
    label.style.opacity = '1';
    clearTimeout(labelTimeout);
    labelTimeout = setTimeout(() => {
      label.style.opacity = '0';
    }, 1500);
  }

  function updateModeButtons() {
    modeButtons.forEach((button, index) => styleButton(button, index === getLightingMode()));
  }

  function applyWhiteMode() {
    const textColor = getWhiteMode() ? '#000' : '#fff';
    label.style.color = textColor;
    updateModeButtons();
  }

  updateModeButtons();

  return {
    applyWhiteMode,
    destroy: () => {
      label.remove();
      modeNav.remove();
      clearTimeout(labelTimeout);
    },
    updateLabel,
    updateModeButtons,
  };
}
