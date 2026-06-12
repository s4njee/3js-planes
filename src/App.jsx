import React, { lazy, Suspense } from 'react';
import { useMediaQuery, TABLET_QUERY } from './use-media-query.js';

const MonolithCanvas = lazy(() => import('./MonolithCanvas.jsx'));
const TilesBackgroundCanvas = lazy(() => import('./TilesBackgroundCanvas.jsx'));
const Minimap = lazy(() => import('./Minimap.jsx'));
const TimeOfDaySlider = lazy(() => import('./TimeOfDaySlider.jsx'));

// No pointerEvents: 'none' here — the flight canvas needs pointer events for
// the touch controls (tap = boost, drag = steer). Nothing beneath it is
// interactive; UI panels sit above at higher z-index.
const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 1,
};

export default function App() {
  // Phones hide the minimap; tablets and desktops show it.
  const showMinimap = useMediaQuery(TABLET_QUERY);

  return (
    <Suspense fallback={null}>
      <TilesBackgroundCanvas />
      <div style={OVERLAY_STYLE}>
        <MonolithCanvas />
      </div>
      {showMinimap && <Minimap />}
      <TimeOfDaySlider />
    </Suspense>
  );
}
