import * as THREE from 'three';

// ── Contrails ──────────────────────────────────────────────────────────────────
// Particle pool for aerodynamic wingtip vapor trails. Creates 200 soft,
// additive-blended sprites that are reused in a ring buffer. Particles are
// spawned at the aircraft's wingtips during boost and fade out over their
// lifetime as they drift backward through the air.

export function createContrails() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.8,
  });
  
  const group = new THREE.Group();
  const particles = [];
  for (let i = 0; i < 200; i++) {
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    group.add(sprite);
    particles.push({ sprite, life: 0, maxLife: 1.0 });
  }
  
  return { group, particles };
}
