import { Canvas, type CanvasProps, useThree } from '@react-three/fiber';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { WebGLRenderer, type WebGLRendererParameters } from 'three';
import {
  FrameRateHud,
  FrameRateMonitorBridge,
  FrameRateMonitorProvider,
  type FrameRateMonitorConfig,
  useFrameRate,
} from '../performance/index.ts';

const R3F_DEFAULT_RENDERER_OPTIONS: WebGLRendererParameters = {
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance',
};

const SHELL_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
} as const;

const STATUS_STYLE = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  color: 'rgba(255, 255, 255, 0.86)',
  background: '#020406',
  textAlign: 'center',
} as const;

const CARD_STYLE = {
  width: 'min(100%, 420px)',
  padding: '18px 20px',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: '18px',
  background: 'rgba(6, 10, 16, 0.78)',
  boxShadow: '0 22px 60px rgba(0, 0, 0, 0.3)',
} as const;

const EYEBROW_STYLE = {
  margin: '0 0 10px',
  font: "700 0.72rem/1 'Anton', sans-serif",
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
} as const;

const TITLE_STYLE = {
  margin: '0 0 10px',
  font: "700 clamp(1.15rem, 2vw, 1.5rem) / 1.1 'Anton', sans-serif",
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
} as const;

const BODY_STYLE = {
  margin: 0,
  font: "500 0.92rem/1.55 'Avenir Next', 'Segoe UI', sans-serif",
  color: 'rgba(255, 255, 255, 0.74)',
} as const;

const DEFAULT_DEVICE_PIXEL_RATIO = 1;
const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2;
const ADAPTIVE_DPR_SUSTAIN_MS = 3000;
const DPR_PRECISION = 100;
const DPR_EPSILON = 0.01;

type SafeCanvasProps = Omit<CanvasProps, 'fallback' | 'gl'> & {
  fallback?: ReactNode;
  frameRateConfig?: Partial<FrameRateMonitorConfig>;
  rendererOptions?: WebGLRendererParameters;
  sceneLabel?: string;
  showFrameRateOverlay?: boolean;
};

type ProbeState =
  | { status: 'pending' }
  | { status: 'ready'; options: WebGLRendererParameters }
  | { status: 'unsupported'; error: Error };

const probeCache = new Map<string, ProbeState>();

function normalizeRendererOptions(
  options: WebGLRendererParameters,
): WebGLRendererParameters {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as WebGLRendererParameters;
}

function getRendererCandidates(
  requestedOptions: WebGLRendererParameters,
): WebGLRendererParameters[] {
  const candidates = [
    requestedOptions,
    { ...requestedOptions, powerPreference: 'default' },
    { ...requestedOptions, antialias: false },
    {
      ...requestedOptions,
      antialias: false,
      powerPreference: 'default',
    },
    requestedOptions.alpha === true
      ? {
          ...requestedOptions,
          alpha: false,
          antialias: false,
          powerPreference: 'default',
        }
      : null,
  ];

  const seen = new Set<string>();

  return candidates
    .filter((candidate): candidate is WebGLRendererParameters => candidate !== null)
    .map((candidate) => normalizeRendererOptions(candidate))
    .filter((candidate) => {
      const key = JSON.stringify(candidate);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function getRendererProbeKey(options: WebGLRendererParameters) {
  return JSON.stringify(options);
}

function getDevicePixelRatio() {
  if (
    typeof window === 'undefined'
    || !Number.isFinite(window.devicePixelRatio)
    || window.devicePixelRatio <= 0
  ) {
    return DEFAULT_DEVICE_PIXEL_RATIO;
  }

  return window.devicePixelRatio;
}

function roundDpr(value: number) {
  return Math.round(value * DPR_PRECISION) / DPR_PRECISION;
}

function clampDpr(value: number, min: number, max: number) {
  return roundDpr(Math.min(Math.max(value, min), max));
}

function normalizeDprProp(dpr: CanvasProps['dpr']) {
  const deviceDpr = getDevicePixelRatio();

  if (Array.isArray(dpr)) {
    const [rawMin, rawMax] = dpr;
    const minDpr = Math.min(rawMin, rawMax);
    const maxDpr = Math.max(rawMin, rawMax);

    return {
      minDpr,
      maxDpr,
      initialDpr: clampDpr(deviceDpr, minDpr, maxDpr),
    };
  }

  if (typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0) {
    const exactDpr = roundDpr(dpr);

    return {
      minDpr: Math.min(DEFAULT_DEVICE_PIXEL_RATIO, exactDpr),
      maxDpr: exactDpr,
      initialDpr: exactDpr,
    };
  }

  const maxDpr = Math.min(deviceDpr, DEFAULT_MAX_DEVICE_PIXEL_RATIO);

  return {
    minDpr: DEFAULT_DEVICE_PIXEL_RATIO,
    maxDpr,
    initialDpr: clampDpr(deviceDpr, DEFAULT_DEVICE_PIXEL_RATIO, maxDpr),
  };
}

function buildAdaptiveDprSteps(dpr: CanvasProps['dpr']) {
  const { minDpr, maxDpr, initialDpr } = normalizeDprProp(dpr);
  const mediumDpr = clampDpr(1.5, minDpr, maxDpr);
  const lowDpr = clampDpr(DEFAULT_DEVICE_PIXEL_RATIO, minDpr, maxDpr);
  const steps = [initialDpr, mediumDpr, lowDpr].filter((value, index, values) => (
    values.findIndex((candidate) => Math.abs(candidate - value) < DPR_EPSILON) === index
  ));

  return steps;
}

function getDprPropKey(dpr: CanvasProps['dpr']) {
  if (Array.isArray(dpr)) {
    return `${dpr[0]}:${dpr[1]}`;
  }

  if (typeof dpr === 'number') {
    return `${dpr}`;
  }

  return 'default';
}

function probeRendererOptions(options: WebGLRendererParameters): ProbeState {
  const probeKey = getRendererProbeKey(options);
  const cachedProbe = probeCache.get(probeKey);

  if (cachedProbe) {
    return cachedProbe;
  }

  if (typeof document === 'undefined') {
    return { status: 'pending' };
  }

  let lastError = new Error('WebGL 2 is unavailable in this browser.');

  for (const candidate of getRendererCandidates(options)) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', {
      alpha: candidate.alpha,
      antialias: candidate.antialias,
      depth: candidate.depth,
      failIfMajorPerformanceCaveat: candidate.failIfMajorPerformanceCaveat,
      powerPreference: candidate.powerPreference,
      premultipliedAlpha: candidate.premultipliedAlpha,
      preserveDrawingBuffer: candidate.preserveDrawingBuffer,
      stencil: candidate.stencil,
    });

    if (context) {
      const supportedProbe = { status: 'ready', options: candidate } as const;
      probeCache.set(probeKey, supportedProbe);
      return supportedProbe;
    }

    lastError = new Error(
      `WebGL 2 context creation failed for ${JSON.stringify(candidate)}.`,
    );
  }

  const unsupportedProbe = { status: 'unsupported', error: lastError } as const;
  probeCache.set(probeKey, unsupportedProbe);
  return unsupportedProbe;
}

// Runs inside the R3F Canvas. Reads the shared FPS monitor and requests DPR
// reductions only after the scene stays in a lower band long enough to avoid
// oscillation from short-lived frame spikes.
function AdaptiveDprBridge({
  currentDpr,
  dprSteps,
  onDprChange,
}: {
  currentDpr: number;
  dprSteps: number[];
  onDprChange: (nextDpr: number) => void;
}) {
  const { gl } = useThree();
  const { fps, sampleCount, thresholds } = useFrameRate();
  const transitionDirectionRef = useRef<'up' | 'down' | null>(null);
  const transitionStartTimeRef = useRef(0);
  const currentStepIndex = useMemo(() => {
    const matchedStepIndex = dprSteps.findIndex((step) => Math.abs(step - currentDpr) < DPR_EPSILON);

    return matchedStepIndex === -1 ? 0 : matchedStepIndex;
  }, [currentDpr, dprSteps]);

  useEffect(() => {
    gl.setPixelRatio(currentDpr);
  }, [currentDpr, gl]);

  useEffect(() => {
    if (sampleCount === 0 || dprSteps.length <= 1) {
      transitionDirectionRef.current = null;
      transitionStartTimeRef.current = 0;
      return;
    }

    const canStepDown = currentStepIndex < dprSteps.length - 1;
    const canStepUp = currentStepIndex > 0;
    const downThreshold = canStepDown
      ? (currentStepIndex === 0 && dprSteps.length > 2 ? thresholds.high : thresholds.medium)
      : null;
    const upThreshold = canStepUp
      ? (currentStepIndex === 1 && dprSteps.length > 2 ? thresholds.high : thresholds.medium)
      : null;
    const nextDirection = canStepDown && downThreshold !== null && fps < downThreshold
      ? 'down'
      : canStepUp && upThreshold !== null && fps >= upThreshold
        ? 'up'
        : null;

    if (nextDirection === null) {
      transitionDirectionRef.current = null;
      transitionStartTimeRef.current = 0;
      return;
    }

    const now = performance.now();

    if (transitionDirectionRef.current !== nextDirection) {
      transitionDirectionRef.current = nextDirection;
      transitionStartTimeRef.current = now;
      return;
    }

    if (now - transitionStartTimeRef.current < ADAPTIVE_DPR_SUSTAIN_MS) {
      return;
    }

    transitionDirectionRef.current = null;
    transitionStartTimeRef.current = 0;
    onDprChange(dprSteps[currentStepIndex + (nextDirection === 'down' ? 1 : -1)]);
  }, [currentStepIndex, dprSteps, fps, onDprChange, sampleCount, thresholds]);

  return null;
}

function SafeCanvasStatus({
  eyebrow,
  title,
  message,
}: {
  eyebrow: string;
  title: string;
  message: string;
}) {
  return (
    <div style={STATUS_STYLE}>
      <div style={CARD_STYLE}>
        <p style={EYEBROW_STYLE}>{eyebrow}</p>
        <h2 style={TITLE_STYLE}>{title}</h2>
        <p style={BODY_STYLE}>{message}</p>
      </div>
    </div>
  );
}

export default function SafeCanvas({
  children,
  dpr: requestedDpr,
  fallback,
  frameRateConfig,
  rendererOptions,
  sceneLabel = 'Scene',
  showFrameRateOverlay = true,
  ...props
}: SafeCanvasProps) {
  const requestedDprKey = getDprPropKey(requestedDpr);
  const adaptiveDprSteps = useMemo(
    () => buildAdaptiveDprSteps(requestedDpr),
    [requestedDprKey],
  );
  const adaptiveDprKey = adaptiveDprSteps.join(':');
  const initialAdaptiveDpr = adaptiveDprSteps[0];
  const [adaptiveDpr, setAdaptiveDpr] = useState(() => adaptiveDprSteps[0]);
  const requestedOptions = useMemo(
    () => normalizeRendererOptions({
      ...R3F_DEFAULT_RENDERER_OPTIONS,
      ...rendererOptions,
    }),
    [rendererOptions],
  );
  const probeKey = useMemo(
    () => getRendererProbeKey(requestedOptions),
    [requestedOptions],
  );
  const [probe, setProbe] = useState<ProbeState>(() => {
    if (typeof document === 'undefined') {
      return { status: 'pending' };
    }

    return probeCache.get(probeKey) ?? { status: 'pending' };
  });

  useEffect(() => {
    setProbe(probeRendererOptions(requestedOptions));
  }, [probeKey, requestedOptions]);

  useEffect(() => {
    setAdaptiveDpr(initialAdaptiveDpr);
  }, [adaptiveDprKey, initialAdaptiveDpr]);

  if (probe.status === 'unsupported') {
    return (
      <div style={SHELL_STYLE}>
        <SafeCanvasStatus
          eyebrow="WebGL Offline"
          title={sceneLabel}
          message="This scene could not start a WebGL 2 renderer here. Try another scene from the + menu, or re-enable hardware acceleration and WebGL in your browser."
        />
      </div>
    );
  }

  if (probe.status !== 'ready') {
    return (
      <div style={SHELL_STYLE}>
        <SafeCanvasStatus
          eyebrow="Checking Graphics"
          title={sceneLabel}
          message="Preparing the renderer with the safest available graphics settings for this device."
        />
      </div>
    );
  }

  return (
    <div style={SHELL_STYLE}>
      <FrameRateMonitorProvider config={frameRateConfig}>
        <Canvas
          {...props}
          dpr={adaptiveDpr}
          fallback={fallback}
          gl={(defaultProps) => new WebGLRenderer({
            ...defaultProps,
            ...probe.options,
          })}
        >
          <FrameRateMonitorBridge />
          <AdaptiveDprBridge
            currentDpr={adaptiveDpr}
            dprSteps={adaptiveDprSteps}
            onDprChange={setAdaptiveDpr}
          />
          {children}
        </Canvas>
        {showFrameRateOverlay ? <FrameRateHud label={sceneLabel} /> : null}
      </FrameRateMonitorProvider>
    </div>
  );
}
