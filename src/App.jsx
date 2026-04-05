import React, { lazy, Suspense } from 'react';

const MonolithCanvas = lazy(() => import('./MonolithCanvas.jsx'));

export default function App() {
  return (
    <Suspense fallback={null}>
      <MonolithCanvas />
    </Suspense>
  );
}
