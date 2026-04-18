import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { flightState, requestAutopilot } from './flight-store.js';

const RAD2DEG = 180 / Math.PI;

const CONTAINER_STYLE = {
  position: 'fixed',
  bottom: 16,
  left: 16,
  width: 260,
  height: 260,
  borderRadius: 10,
  overflow: 'hidden',
  border: '1px solid rgba(255,255,255,0.3)',
  boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
  zIndex: 10,
  pointerEvents: 'auto',
  background: '#111',
  cursor: 'crosshair',
};

// Top-down plane silhouette pointing up (north). The fuselage is longer than
// the wings so the marker reads as an aircraft instead of a symmetric X.
const PLANE_SVG = `
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
  <path d="M15 1.5c0-.8.7-1.5 1.5-1.5S18 0.7 18 1.5V8l6.6 2.6c1.3.5 2.2 1.7 2.2 3.1s-.9 2.6-2.2 3.1L18 19.4v7.1l2.8 4.2c.5.7.3 1.7-.4 2.2-.7.5-1.7.3-2.2-.4L16 29.9l-2.2 2.6c-.5.7-1.5.9-2.2.4-.7-.5-.9-1.5-.4-2.2l2.8-4.2v-7.1L7.6 16.8c-1.3-.5-2.2-1.7-2.2-3.1s.9-2.6 2.2-3.1L14 8V1.5z"/>
  <path d="M5 15.5c0-.8.7-1.5 1.5-1.5H12l1.4-2.8c.4-.8 1.3-1.1 2.1-.7.8.4 1.1 1.3.7 2.1L15.5 14h1l-.7-1.4c-.4-.8-.1-1.7.7-2.1.8-.4 1.7-.1 2.1.7L20 14h5.5c.8 0 1.5.7 1.5 1.5S26.3 17 25.5 17H20l-1.4 2.8c-.4.8-1.3 1.1-2.1.7-.8-.4-1.1-1.3-.7-2.1l.7-1.4h-1l.7 1.4c.4.8.1 1.7-.7 2.1-.8.4-1.7.1-2.1-.7L12 17H6.5C5.7 17 5 16.3 5 15.5z"/>
</svg>`;

const STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export default function Minimap() {
  const containerRef = useRef(null);

  useEffect(() => {
    const initLon = flightState.lon * RAD2DEG;
    const initLat = flightState.lat * RAD2DEG;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [initLon, initLat],
      zoom: 3,
      attributionControl: { compact: true },
      interactive: false,
    });

    // Re-enable scroll zoom while keeping drag/rotate disabled
    map.scrollZoom.enable();

    // Click-to-fly: click anywhere on the minimap to fly there.
    // Uses the same autopilot path as CitySearch for consistent behaviour.
    map.getCanvas().addEventListener('click', (e) => {
      const rect = map.getCanvas().getBoundingClientRect();
      const point = new maplibregl.Point(
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      const { lng, lat } = map.unproject(point);
      requestAutopilot({ lat, lon: lng });
    });

    const el = document.createElement('div');
    el.innerHTML = PLANE_SVG;
    el.style.cssText = 'width:28px;height:28px;color:#ff2d2d;filter:drop-shadow(0 0 2px rgba(0,0,0,0.7));';

    const marker = new maplibregl.Marker({
      element: el,
      rotationAlignment: 'map',
    })
      .setLngLat([initLon, initLat])
      .addTo(map);

    let raf;
    let lastUpdate = 0;
    const UPDATE_INTERVAL = 1000 / 15; // 15 Hz
    let lastMapCenter = [initLon, initLat];
    const CENTER_THRESHOLD = 0.0001; // roughly 10m at the equator

    const tick = (time) => {
      raf = requestAnimationFrame(tick);

      if (time - lastUpdate < UPDATE_INTERVAL) return;
      lastUpdate = time;

      const lon = flightState.lon * RAD2DEG;
      const lat = flightState.lat * RAD2DEG;
      marker.setLngLat([lon, lat]);
      marker.setRotation(flightState.heading * RAD2DEG);

      const dist = Math.sqrt(
        Math.pow(lon - lastMapCenter[0], 2) + Math.pow(lat - lastMapCenter[1], 2),
      );
      if (dist > CENTER_THRESHOLD) {
        map.setCenter([lon, lat]);
        lastMapCenter = [lon, lat];
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      map.remove();
    };
  }, []);

  return <div ref={containerRef} style={CONTAINER_STYLE} />;
}
