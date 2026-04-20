import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { flightState } from './flight-store.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const CONTAINER_STYLE = {
  position: 'fixed', bottom: 16, left: 16, width: 260, height: 260,
  borderRadius: 10, overflow: 'hidden',
  border: '1px solid rgba(255,255,255,0.3)',
  boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
  zIndex: 10, pointerEvents: 'auto', background: '#111',
};

const FOLLOW_BTN_STYLE = {
  position: 'fixed', bottom: 24, left: 200, zIndex: 11,
  padding: '4px 10px',
  font: '500 11px/1 ui-sans-serif, system-ui, sans-serif',
  letterSpacing: '0.04em',
  color: '#fff',
  background: 'rgba(0,0,0,0.6)',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: 6,
  cursor: 'pointer',
  backdropFilter: 'blur(6px)',
  pointerEvents: 'auto',
  userSelect: 'none',
};

const PLANE_SVG = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M15 1.5c0-.8.7-1.5 1.5-1.5S18 0.7 18 1.5V8l6.6 2.6c1.3.5 2.2 1.7 2.2 3.1s-.9 2.6-2.2 3.1L18 19.4v7.1l2.8 4.2c.5.7.3 1.7-.4 2.2-.7.5-1.7.3-2.2-.4L16 29.9l-2.2 2.6c-.5.7-1.5.9-2.2.4-.7-.5-.9-1.5-.4-2.2l2.8-4.2v-7.1L7.6 16.8c-1.3-.5-2.2-1.7-2.2-3.1s.9-2.6 2.2-3.1L14 8V1.5z"/></svg>`;

const TARGET_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`;

const MAP_STYLE = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap', maxzoom: 19 } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export default function Minimap() {
  const containerRef = useRef(null);
  const followRef = useRef(true);
  const mapRef = useRef(null);
  const targetMarkerRef = useRef(null);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    const initLon = flightState.lon * RAD2DEG;
    const initLat = flightState.lat * RAD2DEG;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [initLon, initLat],
      zoom: 6,
      attributionControl: { compact: true },
      interactive: true,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.scrollZoom.enable();
    map.dragPan.enable();

    // Break follow on drag or scroll — not on simple clicks
    let pointerStartX = 0, pointerStartY = 0;
    const onPointerDown = (e) => {
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
    };
    const onPointerMove = (e) => {
      if (followRef.current && e.buttons > 0) {
        const dx = e.clientX - pointerStartX;
        const dy = e.clientY - pointerStartY;
        if (dx * dx + dy * dy > 16) {
          followRef.current = false;
          setFollowing(false);
        }
      }
    };
    const onWheel = () => {
      followRef.current = false;
      setFollowing(false);
    };

    const container = containerRef.current;
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    map.on('wheel', onWheel);

    // Plane marker
    const planeEl = document.createElement('div');
    planeEl.innerHTML = PLANE_SVG;
    planeEl.style.cssText = 'width:28px;height:28px;color:#ff2d2d;filter:drop-shadow(0 0 2px rgba(0,0,0,0.7));';
    const planeMarker = new maplibregl.Marker({ element: planeEl, rotationAlignment: 'map' })
      .setLngLat([initLon, initLat])
      .addTo(map);

    // Target marker (hidden initially)
    const targetEl = document.createElement('div');
    targetEl.innerHTML = TARGET_SVG;
    targetEl.style.cssText = 'width:22px;height:22px;color:#4af;filter:drop-shadow(0 0 3px rgba(0,0,0,0.7));display:none;';
    const targetMarker = new maplibregl.Marker({ element: targetEl })
      .setLngLat([0, 0])
      .addTo(map);
    targetMarkerRef.current = targetMarker;

    // Route line source + layer
    map.on('load', () => {
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#4af',
          'line-width': 2,
          'line-dasharray': [2, 3],
          'line-opacity': 0.7,
        },
      });
    });

    // Click to set destination
    map.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      flightState.targetLat = lat * DEG2RAD;
      flightState.targetLon = lng * DEG2RAD;
      targetEl.style.display = '';
      targetMarker.setLngLat([lng, lat]);
    });

    let raf;
    const tick = () => {
      const lon = flightState.lon * RAD2DEG;
      const lat = flightState.lat * RAD2DEG;
      planeMarker.setLngLat([lon, lat]);
      planeMarker.setRotation(flightState.heading * RAD2DEG);
      if (followRef.current) map.setCenter([lon, lat]);

      // Update route line
      if (flightState.targetLat != null && flightState.targetLon != null) {
        const tLon = flightState.targetLon * RAD2DEG;
        const tLat = flightState.targetLat * RAD2DEG;
        const src = map.getSource('route');
        if (src) {
          src.setData({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[lon, lat], [tLon, tLat]] },
          });
        }
      } else {
        // Target cleared (arrived) — hide marker and line
        targetEl.style.display = 'none';
        const src = map.getSource('route');
        if (src) {
          src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      map.off('wheel', onWheel);
      map.remove();
    };
  }, []);

  const handleFollow = () => {
    followRef.current = true;
    setFollowing(true);
  };

  return (
    <>
      <div ref={containerRef} style={CONTAINER_STYLE} />
      {!following && (
        <button type="button" style={FOLLOW_BTN_STYLE} onClick={handleFollow}>
          Follow
        </button>
      )}
    </>
  );
}
