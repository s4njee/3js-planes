import React, { lazy, Suspense, useEffect, useState } from 'react';

const MonolithCanvas = lazy(() => import('./MonolithCanvas.jsx'));
const TilesBackgroundCanvas = lazy(() => import('./TilesBackgroundCanvas.jsx'));
const Minimap = lazy(() => import('./Minimap.jsx'));
const TimeOfDaySlider = lazy(() => import('./TimeOfDaySlider.jsx'));

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 1,
  pointerEvents: 'none',
};

// Phones: hide minimap (< 768 px wide). Tablets and desktops show it.
const TABLET_QUERY = '(min-width: 768px)';

function useIsTablet() {
  const [match, setMatch] = useState(() => window.matchMedia(TABLET_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(TABLET_QUERY);
    const handler = (e) => setMatch(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return match;
}

export default function App() {
  const showMinimap = useIsTablet();

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
