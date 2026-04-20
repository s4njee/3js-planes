import { useEffect, useMemo, useRef, useState } from 'react';

const PANEL_STYLE = {
  position: 'fixed',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(520px, calc(100vw - 32px))',
  zIndex: 20,
  pointerEvents: 'auto',
};

const SHELL_STYLE = {
  background: 'rgba(10, 14, 18, 0.72)',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 16,
  boxShadow: '0 14px 40px rgba(0, 0, 0, 0.35)',
  backdropFilter: 'blur(18px)',
  color: '#f7f7f3',
  overflow: 'hidden',
};

const INPUT_ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 0,
};

const INPUT_STYLE = {
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  border: '0',
  outline: 'none',
  background: 'transparent',
  color: 'inherit',
  padding: '14px 16px',
  font: '600 14px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  letterSpacing: '0.01em',
};

const MODE_BTN_STYLE = {
  flexShrink: 0,
  margin: '0 10px 0 0',
  padding: '5px 10px',
  font: '600 11px/1 ui-sans-serif, system-ui, sans-serif',
  letterSpacing: '0.03em',
  color: 'rgba(255,255,255,0.8)',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 8,
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  transition: 'all 0.15s',
};

const HINT_STYLE = {
  marginTop: 8,
  padding: '0 14px',
  color: 'rgba(255, 255, 255, 0.55)',
  font: '500 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const RESULTS_STYLE = {
  maxHeight: 320,
  overflowY: 'auto',
  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
};

const ITEM_STYLE = {
  width: '100%',
  border: 0,
  background: 'transparent',
  color: 'inherit',
  textAlign: 'left',
  padding: '12px 16px',
  cursor: 'pointer',
  display: 'block',
};

const ITEM_TITLE_STYLE = {
  font: '600 13px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const ITEM_SUBTITLE_STYLE = {
  marginTop: 4,
  color: 'rgba(255, 255, 255, 0.6)',
  font: '500 11px/1.3 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

function formatResultLabel(result) {
  return result.display_name ?? result.name ?? 'Unknown location';
}

export default function CitySearch({ onSelectCity }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('teleport'); // 'teleport' | 'fly'
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (trimmedQuery.length < 2) {
      setResults([]);
      setIsLoading(false);
      setError('');
      return () => {};
    }

    const timeoutId = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      setError('');

      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '6');
      url.searchParams.set('accept-language', 'en');
      url.searchParams.set('q', trimmedQuery);

      fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((data) => {
          setResults(Array.isArray(data) ? data : []);
          setOpen(true);
          setIsLoading(false);
        })
        .catch((fetchError) => {
          if (fetchError.name === 'AbortError') return;
          setResults([]);
          setIsLoading(false);
          setError('Search unavailable right now');
        });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [trimmedQuery]);

  const selectResult = (result) => {
    const lat = Number(result.lat);
    const lon = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const label = formatResultLabel(result);
    setQuery(label);
    setResults([]);
    setError('');
    setOpen(false);
    onSelectCity?.({ lat, lon, label }, mode);
    inputRef.current?.blur();
  };

  const toggleMode = () => {
    setMode((m) => (m === 'teleport' ? 'fly' : 'teleport'));
  };

  const modeBtn = (value, label) => ({
    ...MODE_BTN_STYLE,
    background: mode === value ? 'rgba(255,255,255,0.18)' : 'transparent',
    borderColor: mode === value ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.12)',
    color: mode === value ? '#fff' : 'rgba(255,255,255,0.45)',
  });

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      selectResult(results[0]);
    }
  };

  return (
    <div style={PANEL_STYLE} data-shortcut-scope="city-search">
      <div style={SHELL_STYLE}>
        <div style={INPUT_ROW_STYLE}>
          <input
            ref={inputRef}
            aria-label="Search city"
            style={INPUT_STYLE}
            value={query}
            placeholder="Search any city in the world"
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          <div style={{ display: 'flex', gap: 4, marginRight: 10, flexShrink: 0 }}>
            <button
              type="button"
              style={modeBtn('teleport')}
              onClick={() => setMode('teleport')}
            >
              ⚡ Teleport
            </button>
            <button
              type="button"
              style={modeBtn('fly')}
              onClick={() => setMode('fly')}
            >
              ✈ Fly
            </button>
          </div>
        </div>
        <div style={HINT_STYLE}>
          {isLoading ? 'Searching...' : error || 'Press Enter to pick the first result'}
        </div>
        {open && results.length > 0 && (
          <div style={RESULTS_STYLE}>
            {results.map((result) => (
              <button
                key={result.place_id}
                type="button"
                style={ITEM_STYLE}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectResult(result)}
              >
                <div style={ITEM_TITLE_STYLE}>{result.name || formatResultLabel(result)}</div>
                <div style={ITEM_SUBTITLE_STYLE}>{formatResultLabel(result)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
