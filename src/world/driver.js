import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function colorize(g, c) {
  const n = g.attributes.position.count, arr = new Float32Array(n * 3), cc = new THREE.Color(c);
  for (let i = 0; i < n; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const boxG = (w, h, d, c, x, y, z) => colorize(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);

// autista seduto (per i bus e i tram automatici): busto e testa, e il braccio sinistro con la mano che saluta.
// arm: perno alla spalla; a riposo il braccio va al volante, salutando si alza e oscilla
let DRV = null;
// geometrie condivise: body (busto e testa, seduto) e arm (dalla spalla in giù, perno in ARM_PIVOT)
export const ARM_PIVOT = [0.25, 1.6, 0.02];
export function driverGeometry() {
  if (!DRV) {
    DRV = {
      body: mergeGeometries([
        boxG(0.42, 0.55, 0.26, 0x6f8fb3, 0, 1.38, 0), boxG(0.13, 0.12, 0.13, 0xd9a77e, 0, 1.71, 0.01),
        colorize(new THREE.SphereGeometry(0.115, 10, 8).translate(0, 1.86, 0.02), 0xd9a77e), boxG(0.24, 0.08, 0.24, 0x3a2a20, 0, 1.96, -0.01),
      ]),
      arm: mergeGeometries([boxG(0.09, 0.46, 0.09, 0x6f8fb3, 0, -0.23, 0), boxG(0.08, 0.13, 0.05, 0xd9a77e, 0, -0.52, 0)]),
      mat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    };
  }
  return DRV;
}
export function driverFigure() {
  driverGeometry();
  const group = new THREE.Group(), pivot = new THREE.Group();
  group.add(new THREE.Mesh(DRV.body, DRV.mat));
  pivot.position.set(...ARM_PIVOT);
  pivot.add(new THREE.Mesh(DRV.arm, DRV.mat));
  group.add(pivot);
  setWave(pivot, 0);
  return { group, arm: pivot };
}
// t: secondi che restano del saluto (da WAVE_T a 0); 0 = braccio al volante
export const WAVE_T = 2.2;
export function setWave(arm, t) {
  if (t <= 0) { arm.rotation.set(-0.95, 0, 0.15); return; }
  const k = Math.min(1, Math.min(WAVE_T - t, t) / 0.3); // su e giù
  arm.rotation.set(-0.95 - 1.75 * k, 0, 0.15 + k * (0.2 + 0.35 * Math.sin(t * 11)));
}
