export interface BackgroundPerformanceSnapshot {
  dpr?: number;
  fps: number;
  quality: 'high' | 'medium' | 'low';
  sampleCount: number;
}

const DEFAULT_BACKGROUND_PERFORMANCE_SNAPSHOT: BackgroundPerformanceSnapshot = {
  dpr: undefined,
  fps: 0,
  quality: 'high',
  sampleCount: 0,
};

const listeners = new Set<(snapshot: BackgroundPerformanceSnapshot) => void>();
let currentSnapshot = DEFAULT_BACKGROUND_PERFORMANCE_SNAPSHOT;

export function getBackgroundPerformanceSnapshot() {
  return currentSnapshot;
}

export function publishBackgroundPerformanceSnapshot(
  snapshot: BackgroundPerformanceSnapshot,
) {
  currentSnapshot = snapshot;
  listeners.forEach((listener) => listener(currentSnapshot));
}

export function subscribeBackgroundPerformance(
  listener: (snapshot: BackgroundPerformanceSnapshot) => void,
) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
