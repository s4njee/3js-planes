import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { flightState } from './flight-store.js';

const RAD2DEG = 180 / Math.PI;

const CONTAINER_STYLE = {
  position: 'fixed', bottom: 16, left: 16, width: 260, height: 260,
  borderRadius: 10, overflow: 'hidden',
  border: '1px solid rgba(255,255,255,0.3)',
  boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
  zIndex: 10, pointerEvents: 'auto', background: '#111',
};

const PLANE_SVG = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M15 1.5c0-.8.7-1.5 1.5-1.5S18 0.7 18 1.5V8l6.6 2.6c1.3.5 2.2 1.7 2.2 3.1s-.9 2.6-2.2 3.1L18 19.4v7.1l2.8 4.2c.5.7.3 1.7-.4 2.2-.7.5-1.7.3-2.2-.4L16 29.9l-2.2 2.6c-.5.7-1.5.9-2.2.4-.7-.5-.9-1.5-.4-2.2l2.8-4.2v-7.1L7.6 16.8c-1.3-.5-2.2-1.7-2.2-3.1s.9-2.6 2.2-3.1L14 8V1.5z"/></svg>`;

const STYLE = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap', maxzoom: 19 } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export default function Minimap() {
  const containerRef = useRef(null);
  useEffect(() => {
    const initLon = flightState.lon * RAD2DEG;
    const initLat = flightState.lat * RAD2DEG;
    let isUserInteracting = false;
    const map = new maplibregl.Map({ container: containerRef.current, style: STYLE, center: [initLon, initLat], zoom: 6, attributionControl: { compact: true }, interactive: true, dragRotate: false, pitchWithRotate: false });
    map.scrollZoom.enable(); map.dragPan.enable();
    const markStart = () => { isUserInteracting = true; };
    const markEnd = () => { window.setTimeout(() => { isUserInteracting = false; }, 0); };
    map.on('dragstart', markStart); map.on('dragend', markEnd);
    map.on('zoomstart', markStart); map.on('zoomend', markEnd);
    const el = document.createElement('div');
    el.innerHTML = PLANE_SVG;
    el.style.cssText = 'width:28px;height:28px;color:#ff2d2d;filter:drop-shadow(0 0 2px rgba(0,0,0,0.7));';
    const marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' }).setLngLat([initLon, initLat]).addTo(map);
    let raf;
    const tick = () => {
      const lon = flightState.lon * RAD2DEG, lat = flightState.lat * RAD2DEG;
      marker.setLngLat([lon, lat]); marker.setRotation(flightState.heading * RAD2DEG);
      if (!isUserInteracting) map.setCenter([lon, lat]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      map.off('dragstart', markStart); map.off('dragend', markEnd);
      map.off('zoomstart', markStart); map.off('zoomend', markEnd);
      map.remove();
    };
  }, []);
  return <div ref={containerRef} style={CONTAINER_STYLE} />;
}
