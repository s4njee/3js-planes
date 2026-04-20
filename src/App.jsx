import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';

const MonolithCanvas = lazy(() => import('./MonolithCanvas.jsx'));
const TilesBackgroundCanvas = lazy(() => import('./TilesBackgroundCanvas.jsx'));
const Minimap = lazy(() => import('./Minimap.jsx'));

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 1,
  pointerEvents: 'none',
};

const FPS_STYLE = {
  position: 'fixed',
  bottom: 12,
  right: 12,
  zIndex: 10,
  fontFamily: 'monospace',
  fontSize: 12,
  color: 'rgba(255,255,255,0.7)',
  background: 'rgba(0,0,0,0.35)',
  padding: '2px 7px',
  borderRadius: 4,
  pointerEvents: 'none',
  userSelect: 'none',
};

function FpsCounter() {
  const [fps, setFps] = useState(0);
  const frameTimesRef = useRef([]);
  const rafRef = useRef(null);

  useEffect(() => {
    let last = performance.now();
    const tick = (now) => {
      const delta = now - last;
      last = now;
      frameTimesRef.current.push(delta);
      if (frameTimesRef.current.length > 60) frameTimesRef.current.shift();
      const avg = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
      setFps(Math.round(1000 / avg));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <div style={FPS_STYLE}>{fps} fps</div>;
}

export default function App() {
  return (
    <Suspense fallback={null}>
      <TilesBackgroundCanvas />
      <div style={OVERLAY_STYLE}>
        <MonolithCanvas />
      </div>
      <Minimap />
      <FpsCounter />
    </Suspense>
  );
}
