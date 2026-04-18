import { useState, useEffect, useRef } from 'react';
import { timeOfDayState, subscribe, setHour } from './time-of-day-store.js';

const MIN_HOUR = -3;
const MAX_HOUR = 9.08;
const ANIMATE_DURATION_MS = 30000; // 30 seconds sunrise to sunset

const CONTAINER_STYLE = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 10,
  pointerEvents: 'auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 4,
  userSelect: 'none',
};

const LABEL_STYLE = {
  color: 'rgba(255,255,255,0.85)',
  fontSize: 11,
  fontFamily: 'monospace',
  textShadow: '0 1px 3px rgba(0,0,0,0.7)',
  letterSpacing: '0.05em',
};

const SLIDER_STYLE = {
  width: 160,
  cursor: 'pointer',
  accentColor: '#ffb07a',
};

const BUTTON_STYLE = {
  background: 'rgba(255,255,255,0.12)',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: 6,
  color: 'rgba(255,255,255,0.85)',
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '4px 12px',
  cursor: 'pointer',
  letterSpacing: '0.05em',
  textShadow: '0 1px 3px rgba(0,0,0,0.7)',
};

function formatUTC(h) {
  const wrapped = ((h % 24) + 24) % 24;
  const hh = Math.floor(wrapped);
  const mm = Math.floor((wrapped - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} UTC`;
}

export default function TimeOfDaySlider() {
  const [hour, setLocalHour] = useState(timeOfDayState.hourUTC);
  const [animating, setAnimating] = useState(false);
  const rafRef = useRef(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    const unsub = subscribe((h) => setLocalHour(h));
    return unsub;
  }, []);

  useEffect(() => {
    if (!animating) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    setHour(MIN_HOUR);
    startTimeRef.current = performance.now();

    const tick = (now) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / ANIMATE_DURATION_MS, 1);
      setHour(MIN_HOUR + t * (MAX_HOUR - MIN_HOUR));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setAnimating(false);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [animating]);

  function handleChange(e) {
    setAnimating(false);
    setHour(parseFloat(e.target.value));
  }

  function handleAnimate() {
    setAnimating(!animating);
  }

  return (
    <div style={CONTAINER_STYLE}>
      <span style={LABEL_STYLE}>{formatUTC(hour)}</span>
      <input
        type="range"
        min={MIN_HOUR}
        max={MAX_HOUR}
        step="0.01"
        value={hour}
        onChange={handleChange}
        style={SLIDER_STYLE}
      />
      <button type="button" style={BUTTON_STYLE} onClick={handleAnimate}>
        {animating ? 'Stop' : 'Animate'}
      </button>
    </div>
  );
}
