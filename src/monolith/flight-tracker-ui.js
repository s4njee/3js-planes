// ── Flight Tracker UI ──────────────────────────────────────────────────────────
// DOM overlay showing live flight count, selected aircraft info, and controls.
// Positioned bottom-left to avoid conflicting with existing city buttons (top-left)
// and model label (bottom-center).

export function createFlightTrackerUI({ onToggleTracker, onCycleCamera, onSelectNearest }) {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font: 12px/1.4 monospace;
    color: #fff;
    pointer-events: auto;
    user-select: none;
  `;
  document.body.appendChild(container);

  // Status line
  const statusEl = document.createElement('div');
  statusEl.style.cssText = `
    background: rgba(0,0,0,0.6);
    padding: 8px 12px;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    min-width: 180px;
    backdrop-filter: blur(4px);
  `;
  container.appendChild(statusEl);

  // Button row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  container.appendChild(btnRow);

  const BTN_CSS = `
    padding: 6px 12px;
    background: rgba(0,0,0,0.5);
    border: 1px solid rgba(255,255,255,0.2);
    color: #fff;
    font: 11px/1 monospace;
    cursor: pointer;
    border-radius: 3px;
    backdrop-filter: blur(4px);
    transition: all 0.15s;
  `;

  function makeButton(label, onClick) {
    const btn = document.createElement('div');
    btn.textContent = label;
    btn.style.cssText = BTN_CSS;
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,255,255,0.15)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(0,0,0,0.5)';
    });
    return btn;
  }

  const toggleBtn = makeButton('T  Live Flights: OFF', onToggleTracker);
  const cameraBtn = makeButton('V  Camera: Off', onCycleCamera);
  const nearestBtn = makeButton('N  Select Nearest', onSelectNearest);

  btnRow.appendChild(toggleBtn);
  btnRow.appendChild(cameraBtn);
  btnRow.appendChild(nearestBtn);

  let visible = true;

  function updateStatus({ enabled, aircraftCount, mode, modeLabel, callsign, targetIcao24 }) {
    if (!enabled) {
      statusEl.innerHTML = '<span style="opacity:0.5">Live flight tracker disabled</span>';
      toggleBtn.textContent = 'T  Live Flights: OFF';
      cameraBtn.textContent = 'V  Camera: Off';
      return;
    }

    toggleBtn.textContent = 'T  Live Flights: ON';
    cameraBtn.textContent = `V  Camera: ${modeLabel}`;

    let html = `<div style="margin-bottom:4px;color:#4fc3f7">✈ ${aircraftCount} live aircraft</div>`;

    if (targetIcao24) {
      html += `<div style="opacity:0.7">Following: ${callsign || targetIcao24}</div>`;
      html += `<div style="opacity:0.5;font-size:10px">ICAO: ${targetIcao24}</div>`;
    } else {
      html += '<div style="opacity:0.5">Press N to select nearest aircraft</div>';
    }

    statusEl.innerHTML = html;
  }

  function setVisible(v) {
    visible = v;
    container.style.display = v ? 'flex' : 'none';
  }

  function destroy() {
    container.remove();
  }

  // Initial state
  updateStatus({ enabled: false, aircraftCount: 0, mode: 0, modeLabel: 'Off', callsign: null, targetIcao24: null });

  return {
    updateStatus,
    setVisible,
    destroy,
  };
}
