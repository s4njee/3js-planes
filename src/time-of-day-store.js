// Shared time-of-day state — written by sliders (on-screen + lil-gui), read
// each frame by the lighting rig. Mirrors the flight-store.js pattern.

export const timeOfDayState = {
  hourUTC: 3,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setHour(h) {
  timeOfDayState.hourUTC = Math.max(-3, Math.min(9.08, h));
  listeners.forEach((fn) => fn(timeOfDayState.hourUTC));
}
