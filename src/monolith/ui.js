// ── DOM UI ────────────────────────────────────────────────────────────────────
// Builds and manages all persistent DOM chrome for the Monolith scene.
// Everything here is imperative DOM construction (createElement + cssText)
// rather than React, because MonolithScene renders inside a Three.js Canvas
// and these elements live in the page body outside the canvas hierarchy.
//
// Elements created:
//   label       — bottom-centre model name, shown briefly after each load
//   cityNav     — top-left row of city buttons (A / B / C / D)
//
// All elements are appended to document.body and removed in destroy().
// The label timeout ID is tracked locally (labelTimeout) and cleared in
// destroy() to match the cleanup contract.
//
// See root ToDo.md §2 for the planned localStorage set/model persistence.

export function createUI({
  getWhiteMode,
  cityOptions = [],
  getCurrentCityIndex,
  onSwitchCity,
}) {
  // ── City reveal label ──────────────────────────────────────────────────

  const cityReveal = document.createElement('div');
  cityReveal.style.cssText = [
    'position:fixed',
    'bottom:38%',
    'left:50%',
    'transform:translateX(-50%)',
    'color:rgba(255,255,255,0.88)',
    'font:300 clamp(28px, 5vw, 56px)/1 "Helvetica Neue", Helvetica, Arial, sans-serif',
    'letter-spacing:0.22em',
    'text-transform:uppercase',
    'opacity:0',
    'transition:opacity 0.8s ease-out',
    'pointer-events:none',
    'text-shadow:0 2px 12px rgba(0,0,0,0.5)',
    'white-space:nowrap',
    'z-index:5',
  ].join(';');
  document.body.appendChild(cityReveal);

  let cityRevealTimeout;

  // ── Model name label ──────────────────────────────────────────────────────

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);color:#fff;font:14px/1 monospace;opacity:0;transition:opacity 0.3s;pointer-events:none;text-shadow:0 1px 4px #000';
  document.body.appendChild(label);

  let labelTimeout;

  // ── Shared button style helper ────────────────────────────────────────────────────

  const BTN_CSS = 'min-width:36px;height:36px;padding:0 12px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.3);color:#fff;font:12px/1 monospace;cursor:pointer;background:rgba(255,255,255,0.05);transition:all 0.2s;user-select:none;white-space:nowrap';

  function styleButton(button, active) {
    const whiteMode = getWhiteMode();
    const colorTriplet = whiteMode ? '0,0,0' : '255,255,255';
    button.style.color = whiteMode ? '#000' : '#fff';
    button.style.background = `rgba(${colorTriplet},${active ? (whiteMode ? 0.15 : 0.25) : 0.05})`;
    button.style.borderColor = `rgba(${colorTriplet},${active ? 0.7 : 0.3})`;
  }

  // ── City buttons (A / B / C / D) ──────────────────────────────────────────────────

  const cityNav = document.createElement('div');
  cityNav.style.cssText = 'position:fixed;top:16px;left:16px;display:flex;gap:8px;z-index:10;flex-wrap:wrap;max-width:calc(100vw - 32px)';
  document.body.appendChild(cityNav);

  const cityButtons = [];
  cityOptions.forEach((city, index) => {
    const button = document.createElement('div');
    button.textContent = `${city.key} ${city.name}`;
    button.style.cssText = BTN_CSS;
    button.addEventListener('click', () => onSwitchCity(index));
    button.addEventListener('mouseenter', () => {
      if (index !== getCurrentCityIndex()) styleButton(button, false);
    });
    button.addEventListener('mouseleave', () => {
      if (index !== getCurrentCityIndex()) styleButton(button, false);
    });
    cityNav.appendChild(button);
    cityButtons.push(button);
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

  function updateCityButtons() {
    cityButtons.forEach((button, index) => styleButton(button, index === getCurrentCityIndex()));
  }

  function showCityReveal(name) {
    if (!name) return;
    clearTimeout(cityRevealTimeout);
    cityReveal.textContent = name.toUpperCase();
    cityReveal.style.opacity = '0';
    // Force reflow so the transition restarts cleanly
    void cityReveal.offsetWidth;
    cityReveal.style.opacity = '1';
    cityRevealTimeout = setTimeout(() => {
      cityReveal.style.transition = 'opacity 1.2s ease-in';
      cityReveal.style.opacity = '0';
      // Reset transition for next reveal
      setTimeout(() => {
        cityReveal.style.transition = 'opacity 0.8s ease-out';
      }, 1300);
    }, 2200);
  }

  function applyWhiteMode() {
    const textColor = getWhiteMode() ? '#000' : '#fff';
    label.style.color = textColor;
    updateCityButtons();
  }

  updateCityButtons();

  return {
    applyWhiteMode,
    destroy: () => {
      label.remove();
      cityReveal.remove();
      cityNav.remove();
      clearTimeout(labelTimeout);
      clearTimeout(cityRevealTimeout);
    },
    updateLabel,
    updateCityButtons,
    updateModeButtons: () => {},
    showCityReveal,
  };
}
