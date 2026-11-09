// Anteprime delle livree per il menu: ogni livrea è disegnata con lo stesso modello 3D del gioco, di tre quarti dal
// lato porte, in un renderer a parte che poi viene liberato. Le immagini restano in cache (bus da 12 m e snodato).
import * as THREE from 'three';
import { Bus } from '../bus/bus.js';
import { suspendTerrain, resumeTerrain } from '../world/terrain.js';

const cache = new Map();

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
}

// ids: livree da disegnare; articulated: snodato da 18 m. Restituisce { livrea: dataURL }.
export function liveryPreviews(ids, articulated, { w = 320, h = 150 } = {}) {
  const key = articulated ? 'snodato' : '12m';
  if (cache.has(key)) return cache.get(key);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 2.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-10, 16, 12);
  scene.add(sun);
  // il bus va da +6 (muso) a -6 (coda), lo snodato fino a -12: si inquadra il centro
  const zc = articulated ? -3 : 0, dist = articulated ? 22 : 16;
  const cam = new THREE.PerspectiveCamera(24, w / h, 0.5, 200);
  const a = 0.72; // di tre quarti, dal lato porte (x negativo) e un po' davanti
  cam.position.set(-Math.sin(a) * dist, dist * 0.28, zc + Math.cos(a) * dist);
  cam.lookAt(0, 1.4, zc + 0.8); // il muso, più vicino, sembra più grande: si centra un po' più avanti
  const out = {};
  for (const id of ids) {
    const bus = new Bus(scene, { id: articulated ? '10' : '', color: '#ffffff', dest: 'Padova', livery: id, articulated });
    bus.place(0, 0, 0);
    // il bus sta a quota zero: senza il terreno, che altrimenti lo alzerebbe fuori dall'inquadratura
    const was = suspendTerrain();
    renderer.render(scene, cam);
    resumeTerrain(was);
    out[id] = renderer.domElement.toDataURL('image/png');
    scene.remove(bus.group);
    disposeTree(bus.group);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  cache.set(key, out);
  return out;
}
