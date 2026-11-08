import * as THREE from 'three';
import { toXZ } from '../data/padova.js';
import { labelTexture } from './textures.js';

// Deposito degli autobus urbani alla Stanga (OSM: "Deposito Busitalia Veneto S.p.A.", way 1346975178). Si entra da
// Via Orlandini, vicino all'incrocio con Via Rismondo, per una strada di servizio chiusa da una sbarra (node 5799274253):
// il piazzale dietro la sbarra non è nella rete stradale, il deposito per il gioco comincia lì. Le prime corse del
// turno partono da qui fuori servizio, le ultime ci rientrano.
export const DEPOT_NAME = 'Deposito Stanga';
const GATE = toXZ(45.4171464, 11.8949211);

// nodo della rete più vicino alla sbarra (tra quelli percorribili) e verso dell'uscita: { node, out, x, z, dx, dz, hw }
export function depotGate(net) {
  let best = null, bd = 40;
  for (const id in net.nodes) {
    const n = net.nodes[id], d = Math.hypot(n.x - GATE.x, n.z - GATE.z);
    if (d >= bd) continue;
    const e = n.edges.find((f) => !f.ped);
    if (e) { bd = d; best = { n, e }; }
  }
  if (!best) return null;
  const { n, e } = best, out = e.a === n.id ? e.b : e.a, O = net.nodes[out];
  const l = Math.hypot(O.x - n.x, O.z - n.z) || 1;
  return { node: n.id, out, x: n.x, z: n.z, dx: (O.x - n.x) / l, dz: (O.z - n.z) / l, hw: e.width / 2 };
}

// sbarra a strisce bianche e rosse con il cartello: si alza quando arriva un bus
export class DepotGate {
  constructor(scene, gate) {
    this.gate = gate;
    this.angle = 0;
    const { x, z, dx, dz, hw } = gate;
    const rx = -dz, rz = dx; // destra guardando verso l'uscita (nel gruppo +x è la sinistra)
    const g = new THREE.Group();
    g.position.set(x + rx * (hw + 0.4), 0, z + rz * (hw + 0.4));
    g.rotation.y = Math.atan2(dx, dz);
    const grey = new THREE.MeshLambertMaterial({ color: 0x9ea7ad });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35), grey);
    post.position.y = 0.55;
    g.add(post);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 16;
    const cx = c.getContext('2d');
    for (let i = 0; i < 8; i++) { cx.fillStyle = i % 2 ? '#d32f2f' : '#f5f5f5'; cx.fillRect(i * 32, 0, 32, 16); }
    const stripes = new THREE.CanvasTexture(c);
    stripes.colorSpace = THREE.SRGBColorSpace;
    const len = hw * 2 + 0.4;
    this.arm = new THREE.Group();
    this.arm.position.set(0, 1.0, 0);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.08), new THREE.MeshLambertMaterial({ map: stripes }));
    bar.position.x = len / 2; // dal palo verso il centro della strada
    this.arm.add(bar);
    g.add(this.arm);
    // cartello leggibile dai due lati: chi arriva e chi esce
    const signMat = new THREE.MeshLambertMaterial({ map: labelTexture('DEPOSITO', { bg: '#0b3d91', font: 'bold 64px Arial' }) });
    for (const ry of [0, Math.PI]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), signMat);
      sign.position.set(-0.3, 2.3, ry ? -0.01 : 0.01);
      sign.rotation.y = ry;
      g.add(sign);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 8), grey);
    pole.position.set(-0.3, 1.05, -0.05);
    g.add(pole);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    this.group = g;
  }
  update(dt, bus) {
    const near = bus && Math.hypot(bus.x - this.gate.x, bus.z - this.gate.z) < 24;
    this.angle += Math.max(-dt * 0.8, Math.min(dt * 0.8, (near ? 1.4 : 0) - this.angle));
    this.arm.rotation.z = this.angle;
  }
}
