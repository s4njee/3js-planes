import React, { lazy, Suspense } from 'react';

const MonolithCanvas = lazy(() => import('./MonolithCanvas.jsx'));
const TilesBackgroundCanvas = lazy(() => import('./TilesBackgroundCanvas.jsx'));

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 1,
  pointerEvents: 'none',
};

export default function App() {
  return (
    <Suspense fallback={null}>
      <TilesBackgroundCanvas />
      <div style={OVERLAY_STYLE}>
        <MonolithCanvas />
      </div>
    </Suspense>
  );
}
