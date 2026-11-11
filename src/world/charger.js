// Colonnine di ricarica dei bus elettrici ai capolinea: palo sul marciapiede, braccio sopra la corsia e pantografo che
// scende sulle barre di contatto del tetto (sopra la porta anteriore, CONTACT_Z nelle coordinate del bus) quando
// l'autista lo chiede. Una per capolinea, messa dove il bus si ferma alla palina (stopPose di routes.js).
import * as THREE from 'three';
import { labelTexture } from './textures.js';
import { Y_ROAD } from './city.js';

export const CONTACT_Z = 2.8; // barre di contatto sul tetto, dal centro del bus verso il muso
export const CHARGE_KW = 300; // potenza della colonnina
const HEAD_UP = 4.6, HEAD_DOWN = 3.74; // altezza del pattino: alzato, appoggiato sulle barre (tetto e carenatura 3,69)
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

class Charger {
  // x, z: punto di contatto a terra; h: direzione del bus fermo; side: 1 se il marciapiede è a destra del bus
  constructor(scene, { x, z, h, side }) {
    Object.assign(this, { x, z, h, pos: 0, target: 0 });
    const g = new THREE.Group();
    g.position.set(x, Y_ROAD, z);
    g.rotation.y = h; // +z avanti come il bus, +x a sinistra
    const steel = new THREE.MeshLambertMaterial({ color: 0x8d969c });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b3036 });
    const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); g.add(m); return m; };
    const mx = -side * 2.3; // palo a 70 cm dal cordolo, sul marciapiede
    add(new THREE.BoxGeometry(0.32, 5.1, 0.32), steel, mx, 2.55, 0);
    add(new THREE.BoxGeometry(Math.abs(mx) + 0.5, 0.26, 0.3), steel, mx / 2 + side * 0.25, 5.0, 0); // braccio
    add(new THREE.BoxGeometry(0.75, 1.5, 0.45), dark, mx - side * 0.1, 0.75, -0.6); // armadio dell'inverter
    const sign = new THREE.MeshLambertMaterial({ map: labelTexture('⚡ RICARICA BUS', { bg: '#1d3b8f', font: 'bold 48px Arial' }) });
    for (const ry of [0, Math.PI]) {
      const s = add(new THREE.PlaneGeometry(1.1, 0.28), sign, mx, 3.0, ry ? -0.17 : 0.17);
      s.rotation.y = ry;
    }
    // pantografo: asta che si allunga e pattino con la luce che si accende in carica
    this.rod = add(new THREE.BoxGeometry(0.12, 1, 0.12), dark, 0, 0, 0);
    this.head = new THREE.Group();
    this.head.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.6), dark));
    this.lamp = new THREE.MeshLambertMaterial({ color: 0x1d3b8f, emissive: 0x000000 });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.08), this.lamp);
    led.position.set(0, 0.07, 0.3);
    this.head.add(led);
    g.add(this.head);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    this.group = g;
    this.setPos(0);
  }

  setPos(p) {
    const y = HEAD_UP + (HEAD_DOWN - HEAD_UP) * p, top = 4.9;
    this.head.position.set(0, y, 0);
    this.rod.position.y = (top + y) / 2;
    this.rod.scale.y = top - y;
  }

  get down() { return this.pos > 0.98; }

  // il bus ha le barre del tetto sotto il pattino? (allineato entro 1,2 m in avanti e 60 cm di lato)
  under(bus) {
    const p = bus.toWorld(0, CONTACT_Z), dx = p.x - this.x, dz = p.z - this.z;
    const s = Math.sin(this.h), c = Math.cos(this.h);
    return Math.abs(dx * s + dz * c) < 1.2 && Math.abs(dx * c - dz * s) < 0.6 && Math.abs(wrapA(bus.h - this.h)) < 0.3;
  }

  update(dt, charging) {
    this.pos += Math.max(-dt / 2.5, Math.min(dt / 2.5, this.target - this.pos));
    this.setPos(this.pos);
    this.lamp.emissive.setHex(charging ? 0x2f6bff : 0x000000);
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
}

// Le colonnine della corsa: ai capolinea veri della variante (non dove la linea è tagliata al bordo della mappa)
export class Chargers {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  // pose: { x, z, h } del bus fermo alla palina; side: 1 marciapiede a destra
  add(pose, side) {
    const fx = Math.sin(pose.h), fz = Math.cos(pose.h);
    const x = pose.x + fx * CONTACT_Z, z = pose.z + fz * CONTACT_Z;
    if (this.list.some((c) => Math.hypot(c.x - x, c.z - z) < 4)) return;
    this.list.push(new Charger(this.scene, { x, z, h: pose.h, side }));
    // ne restano al massimo 6 (le corse di un turno passano dagli stessi capolinea)
    while (this.list.length > 6) this.list.shift().dispose(this.scene);
  }

  at(bus) { return this.list.find((c) => c.under(bus)) || null; }

  // corsa nuova: tutti i pantografi su
  release() { for (const c of this.list) c.target = 0; }

  update(dt, active) {
    for (const c of this.list) c.update(dt, c === active && c.down);
  }
}
