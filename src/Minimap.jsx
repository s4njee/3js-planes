import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { flightState } from './flight-store.js';

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
};

// Plane silhouette pointing up (north). Stroke uses currentColor so we can
// recolor via CSS.
const PLANE_SVG = `
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
  <path d="M12 1.5 L13.4 9 L22 12 L13.4 15 L12 22.5 L10.6 15 L2 12 L10.6 9 Z"/>
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
      zoom: 6,
      attributionControl: { compact: true },
      interactive: true,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.scrollZoom.disable();

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
    const tick = () => {
      const lon = flightState.lon * RAD2DEG;
      const lat = flightState.lat * RAD2DEG;
      marker.setLngLat([lon, lat]);
      marker.setRotation(flightState.heading * RAD2DEG);
      map.setCenter([lon, lat]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      map.remove();
    };
  }, []);

  return <div ref={containerRef} style={CONTAINER_STYLE} />;
}
