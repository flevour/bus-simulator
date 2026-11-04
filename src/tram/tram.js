import * as THREE from 'three';
import { ledTexture } from '../world/textures.js';

// Tram su gomma a guida vincolata (Translohr del SIR1): moduli articolati che seguono la rotaia centrale.
// Misure in metri. Con 3 moduli ~25 m (STE3), con 4 moduli ~33 m (linee future).
export const TRAM = { width: 2.2, cab: 8.2, mid: 7.6, gap: 0.45, lane: 1.7, ref: 6 };
export const tramLength = (n) => 2 * TRAM.cab + Math.max(0, n - 2) * TRAM.mid + (n - 1) * TRAM.gap;

// ---------- tracciato ----------
// Polilinea con distanze progressive; at(s) estrapola oltre gli estremi lungo il primo/ultimo tratto.
export class TrackPath {
  constructor(pts) {
    this.pts = pts;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    this.cum = cum;
    this.len = cum[cum.length - 1];
  }
  seg(s) {
    let lo = 0, hi = this.cum.length - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.cum[m] <= s) lo = m; else hi = m - 1; }
    return lo;
  }
  at(s) {
    const i = this.seg(s), a = this.pts[i], b = this.pts[i + 1];
    const l = this.cum[i + 1] - this.cum[i] || 1e-6, t = (s - this.cum[i]) / l;
    const dx = (b.x - a.x) / l, dz = (b.z - a.z) / l;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx, dz, h: Math.atan2(dx, dz) };
  }
  // proiezione di un punto: s, distanza e scostamento laterale (positivo a destra del verso del tracciato)
  project(x, z) {
    let best = { s: 0, d: Infinity, lat: 0 };
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-6;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
      const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(x - px, z - pz);
      if (d < best.d) {
        const l = Math.sqrt(l2);
        best = { s: this.cum[i] + l * t, d, lat: ((x - a.x) * -ez + (z - a.z) * ex) / l };
      }
    }
    return best;
  }
}

// Corsia di un senso di marcia: la sede (centro) spostata di `lane` metri a destra del verso di marcia, da s0 a s1.
export function lanePath(center, s0, s1, lane = TRAM.lane) {
  const sig = s1 >= s0 ? 1 : -1, pts = [];
  const off = (p, nx, nz, k = 1) => pts.push({ x: p.x + nx * lane * k, z: p.z + nz * lane * k });
  const p0 = center.at(s0);
  off(p0, -p0.dz * sig, p0.dx * sig);
  const idx = [];
  for (let i = 1; i < center.pts.length - 1; i++) {
    const c = center.cum[i];
    if (sig > 0 ? c > s0 + 0.5 && c < s1 - 0.5 : c < s0 - 0.5 && c > s1 + 0.5) idx.push(i);
  }
  if (sig < 0) idx.reverse();
  for (const i of idx) {
    const a = center.pts[i - 1], b = center.pts[i], c = center.pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z) || 1, l2 = Math.hypot(c.x - b.x, c.z - b.z) || 1;
    const n1x = -(b.z - a.z) / l1, n1z = (b.x - a.x) / l1, n2x = -(c.z - b.z) / l2, n2z = (c.x - b.x) / l2;
    let nx = n1x + n2x, nz = n1z + n2z;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const miter = 1 / Math.max(0.6, nx * n1x + nz * n1z); // spigolo vivo: la corsia resta parallela
    off(b, nx * sig, nz * sig, miter);
  }
  const p1 = center.at(s1);
  off(p1, -p1.dz * sig, p1.dx * sig);
  return new TrackPath(pts);
}

// Percorso di una corsa: le fermate proiettate sulla sede, la corsia nel verso di marcia, un po' di binario
// prima della prima fermata (il convoglio ci sta tutto dietro la banchina) e dopo l'ultima.
export function tramRoute(net, variant, modules = 3) {
  const center = new TrackPath(net.tram[0]);
  const ss = variant.stops.map((st) => center.project(st.x, st.z).s);
  const sig = ss[ss.length - 1] >= ss[0] ? 1 : -1;
  const back = tramLength(modules) + 20;
  const s0 = Math.max(0, Math.min(center.len, ss[0] - sig * back)), s1 = Math.max(0, Math.min(center.len, ss[ss.length - 1] + sig * 30));
  return { path: lanePath(center, s0, s1), sig, center };
}

// Tratti senza linea aerea (s lungo la sede): a Prato della Valle il tram va a batteria, col pantografo abbassato.
export const CATENARY_GAP_HALF = 130;
export function catenaryGaps(center, stops) {
  const out = [];
  for (const st of stops || []) {
    if (!/prato/i.test(st.name)) continue;
    const pr = center.project(st.x, st.z);
    if (pr.d < 40 && !out.some(([a, b]) => pr.s > a && pr.s < b)) out.push([pr.s - CATENARY_GAP_HALF, pr.s + CATENARY_GAP_HALF]);
  }
  return out;
}
export const CATENARY_HEIGHT = 5.6;

// ---------- modello ----------
let MATS = null;
export function tramMaterials() {
  if (MATS) return MATS;
  const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  MATS = {
    blue: lam(0x1f4fae), silver: lam(0xc8cdd3), glass: lam(0x16222c), skirt: lam(0x17191b), roof: lam(0xd5d9dd),
    bellows: lam(0x2b2e32), door: lam(0x24384a), head: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0 }),
    tail: new THREE.MeshLambertMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0 }),
    console: lam(0xd9dcde), consoleBlue: lam(0x24476f), seat: lam(0x3a5e8c), floor: lam(0x5a5f63),
    cabin: new THREE.MeshLambertMaterial({ color: 0xf4f1e6, emissive: 0xfff6dc, emissiveIntensity: 0.2 }),
  };
  return MATS;
}

// cruscotto del Translohr (dalla foto): banco chiaro con file di pulsanti tondi
function consoleTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#d9dcde'; x.fillRect(0, 0, 512, 256);
  x.strokeStyle = '#b8bcc0'; x.lineWidth = 4; x.strokeRect(6, 6, 500, 244);
  const cols = ['#8e959b', '#8e959b', '#8e959b', '#8e959b', '#c8102e', '#8e959b', '#2bb3e0', '#8e959b'];
  let k = 0;
  for (let r = 0; r < 4; r++) for (let i = 0; i < 10; i++) {
    const px = 40 + i * 47 + (r % 2) * 10, py = 40 + r * 55;
    x.fillStyle = '#6d7378'; x.beginPath(); x.arc(px, py + 2, 15, 0, 7); x.fill();
    x.fillStyle = cols[(k++ * 7) % cols.length]; x.beginPath(); x.arc(px, py, 14, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Un modulo: gruppo con +z verso l'estremità A del convoglio. kind: 'cabA' | 'cabB' | 'mid'.
function buildModule(kind, len, opts) {
  const M = tramMaterials(), W = TRAM.width;
  const group = new THREE.Group();
  const inner = new THREE.Group(); // nella cabina B il muso guarda verso -z
  if (kind === 'cabB') inner.rotation.y = Math.PI;
  group.add(inner);
  const cab = kind !== 'mid';
  box(W - 0.1, 0.42, len - 0.3, M.skirt, 0, 0.34, 0, inner);
  // fiancata bassa come pannelli (senza coperchio): da dentro si vedono pavimento, sedili e banco di guida
  for (const sx of [-1, 1]) box(0.06, 0.8, len, M.blue, sx * (W / 2 - 0.03), 0.95, 0, inner);
  for (const ez of [-1, 1]) if (!(cab && ez === 1)) box(W, 0.8, 0.06, M.blue, 0, 0.95, ez * (len / 2 - 0.03), inner);
  box(W + 0.02, 1.05, len - 0.6, M.glass, 0, 1.88, 0, inner);
  box(W, 0.5, len, M.blue, 0, 2.65, 0, inner);
  box(W - 0.5, 0.18, len - 1.2, M.roof, 0, 2.98, 0, inner);
  // porte doppie sui due lati, con la cornice grigio argento
  const doorZ = kind === 'mid' ? [0] : [-len / 2 + 2.1];
  const doors = [];
  for (const dz of doorZ) {
    box(W + 0.04, 2.3, 1.6, M.silver, 0, 1.45, dz, inner);
    const leaves = [];
    for (const sd of [-1, 1]) for (const lr of [-1, 1]) {
      const leaf = box(0.05, 1.95, 0.66, M.door, sd * (W / 2 + 0.035), 1.32, dz + lr * 0.34, inner);
      leaf.userData = { sd, lr, z0: dz + lr * 0.34 };
      leaves.push(leaf);
    }
    doors.push({ z: dz, leaves, kind });
  }
  let eye = null, dash = null, led = null;
  if (cab) {
    // testata: parabrezza grande e inclinato, fanali bassi, display di linea
    const f = len / 2;
    box(W, 0.75, 0.5, M.blue, 0, 0.8, f - 0.05, inner); // il muso resta sotto il parabrezza
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.12, 1.5), M.glass);
    ws.position.set(0, 1.95, f + 0.06); ws.rotation.x = -0.22; inner.add(ws);
    for (const sx of [-0.78, 0.78]) {
      box(0.32, 0.14, 0.05, M.head, sx, 0.72, f + 0.24, inner);
      box(0.18, 0.1, 0.05, M.tail, sx * 1.12, 0.95, f + 0.24, inner);
    }
    led = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.3), new THREE.MeshBasicMaterial({ map: ledTexture(opts.line, opts.dest) }));
    led.position.set(0, 2.72, f + 0.02); inner.add(led);
    // posto di guida al centro (dalla foto): sotto il parabrezza il cruscotto grigio chiaro, davanti al guidatore il
    // banco inclinato con le file di pulsanti; a destra la plancia blu con lo schermo LCD e il pulsante a fungo rosso.
    // In locale -x è la destra del guidatore.
    box(W - 0.2, 0.1, 0.7, M.console, 0, 1.18, f - 0.5, inner);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.55), new THREE.MeshLambertMaterial({ map: consoleTexture() }));
    desk.position.set(0.12, 1.42, f - 1.05); desk.rotation.x = 0.38; inner.add(desk);
    box(1.15, 0.5, 0.4, M.console, 0.12, 1.12, f - 1.0, inner);
    box(0.5, 0.5, 0.42, M.consoleBlue, -0.72, 1.3, f - 0.85, inner);
    box(0.09, 0.08, 0.09, M.tail, -0.9, 1.6, f - 0.95, inner);
    dash = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.27), new THREE.MeshBasicMaterial({ map: opts.dashTex }));
    dash.position.set(-0.7, 1.58, f - 1.07); dash.rotation.y = Math.PI; dash.rotation.x = 0.45; inner.add(dash);
    // montanti e tetto della cabina visti da dentro
    for (const sx of [-1, 1]) box(0.12, 1.5, 0.14, M.skirt, sx * (W / 2 - 0.08), 1.95, f - 0.05, inner);
    box(W - 0.1, 0.05, 1.6, M.cabin, 0, 2.42, f - 0.9, inner);
    // occhi del guidatore: telaio con +z verso il muso
    eye = new THREE.Object3D();
    inner.add(eye);
  }
  // pantografo sul primo modulo centrale: base, due bracci e strisciante
  let panto = null;
  if (kind === 'mid' && opts.pantograph) {
    panto = new THREE.Group();
    panto.position.set(0, 3.07, 0);
    inner.add(panto);
    box(1.1, 0.12, 1.4, M.skirt, 0, 0.06, 0, panto);
    const arm = () => { const a = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1), M.silver); panto.add(a); return a; };
    panto.userData = { lower: arm(), upper: arm(), head: box(1.7, 0.06, 0.14, M.skirt, 0, 0.3, 0, panto) };
  }
  // sedili, pavimento e soffitto chiaro (vista passeggeri)
  box(W - 0.15, 0.04, len - 0.4, M.floor, 0, 0.56, 0, inner);
  box(W - 0.15, 0.04, len - (cab ? 2.2 : 0.4), M.cabin, 0, 2.37, cab ? -1 : 0, inner);
  for (let z = -len / 2 + 1.2; z < len / 2 - (cab ? 2.4 : 1.2); z += 1.5) {
    if (doorZ.some((dz) => Math.abs(z - dz) < 1.2)) continue;
    for (const sx of [-0.62, 0.62]) box(0.48, 0.45, 0.45, M.seat, sx, 0.82, z, inner);
  }
  return { group, inner, len, kind, doors, eye, dash, led, panto };
}

// altezza del pantografo: 0 abbassato, 1 contro il filo di contatto
export function setPantograph(panto, pos) {
  if (!panto) return;
  const { lower, upper, head } = panto.userData;
  const h = 0.3 + pos * (CATENARY_HEIGHT - 0.14 - 3.07 - 0.3), L = 1.25;
  const k = Math.sqrt(Math.max(0.01, L * L - (h / 2) * (h / 2))); // ginocchio del braccio
  const place = (m, y0, z0, y1, z1) => { m.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2); m.scale.z = Math.hypot(y1 - y0, z1 - z0); m.rotation.x = -Math.atan2(y1 - y0, z1 - z0); };
  place(lower, 0.12, -0.3, 0.12 + h / 2, -0.3 + k);
  place(upper, 0.12 + h / 2, -0.3 + k, 0.12 + h, -0.3);
  head.position.set(0, 0.12 + h, -0.3);
}

// ---------- veicolo del giocatore ----------
export class Tram {
  constructor(scene, opts) {
    const { line = 'SIR1', dest = '', modules = 3, path } = opts;
    this.isTram = true;
    this.electric = true;
    this.path = path;
    this.nMod = Math.max(3, modules);
    this.length = tramLength(this.nMod);
    this.scene = scene;
    // stato: posizione del muso A lungo il percorso, verso di marcia (+1 = s crescente)
    this.aFwd = 1; this.facing = 1;
    this.sA = 0;
    this.v = 0; this.dir = 1; this.gear = 1; this.rpm = 0; this.powerKw = 0;
    this.throttle = 0; this.brake = 0; this.parking = true;
    this.aLong = 0; this.aLat = 0; this.yawRate = 0; this.odometer = 0;
    this.indicator = 0; this.blink = 0; this.steerIn = 0; this.kneelTarget = 0;
    this.lights = false; this.horn = false; this.passengers = 0;
    this.doorTarget = 0;
    this.elev = 0;
    // texture del cruscotto (schermo LCD con il tachimetro)
    const dc = document.createElement('canvas');
    dc.width = 256; dc.height = 160;
    this.dashCanvas = dc; this.dashCtx = dc.getContext('2d');
    this.dashTex = new THREE.CanvasTexture(dc);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.modules = [];
    for (let k = 0; k < this.nMod; k++) {
      const kind = k === 0 ? 'cabA' : k === this.nMod - 1 ? 'cabB' : 'mid';
      const m = buildModule(kind, kind === 'mid' ? TRAM.mid : TRAM.cab, { line, dest, dashTex: this.dashTex, pantograph: k === 1 });
      m.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(m.group);
      this.modules.push(m);
    }
    // pantografo e batteria (per i tratti senza linea aerea)
    this.pantoModule = this.modules[1];
    this.pantoUp = true; this.pantoPos = 1; this.battery = 1; this.wired = true;
    setPantograph(this.pantoModule.panto, 1);
    // soffietti tra i moduli
    this.bellows = [];
    for (let k = 0; k < this.nMod - 1; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(TRAM.width - 0.25, 2.35, TRAM.gap + 0.3), tramMaterials().bellows);
      this.group.add(b);
      this.bellows.push(b);
    }
    this.doors = this.modules.flatMap((m) => m.doors.map((d) => ({ ...d, module: m })));
    this.doorOpen = this.doors.map(() => 0);
    this.cabinLightMat = tramMaterials().cabin;
    this.brakeMat = tramMaterials().tail;
    this._hPrev = null;
    this.syncTransform();
  }
  get speedKmh() { return Math.abs(this.v) * 3.6; }
  get fx() { return Math.sin(this.h); }
  get fz() { return Math.cos(this.h); }
  get doorsClosed() { return this.doorOpen.every((d) => d < 0.01); }
  get doorsAnyOpen() { return this.doorOpen.some((d) => d > 0.05); }
  get doorCount() { return this.doors.length; }
  // muso della cabina attiva lungo il percorso
  get sFront() { return this.facing === this.aFwd ? this.sA : this.sA - this.aFwd * this.length; }
  get activeCab() { return this.facing === this.aFwd ? this.modules[0] : this.modules[this.nMod - 1]; }
  get body() { return this.activeCab.eye; }
  get cabEye() { return [0, 1.98, TRAM.cab / 2 - 1.8]; }
  get paxEye() { return [0.55, 1.75, -1.2]; }
  get chaseDist() { return 30; }

  toWorld(lx, lz) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    return { x: this.x + lx * c + lz * s, z: this.z - lx * s + lz * c };
  }
  // posiziona il muso della cabina attiva al punto del percorso più vicino a (x, z)
  place(x, z) {
    const pr = this.path.project(x, z);
    this.setFront(pr.s + this.facing * TRAM.ref);
  }
  setFront(sFront) {
    this.sA = this.facing === this.aFwd ? sFront : sFront + this.aFwd * this.length;
    this.v = 0;
    this.syncTransform();
  }
  // curvatura media del percorso attorno a s (1/m), su 24 m: la spezzata del GTFS diventa una curva
  curvature(s) {
    const a = this.path.at(s - 12), b = this.path.at(s + 12);
    const d = Math.atan2(Math.sin(b.h - a.h), Math.cos(b.h - a.h));
    return Math.abs(d) / 24;
  }
  // velocità massima per la curva più stretta nei prossimi `ahead` metri (accelerazione laterale ~1 m/s²)
  curveLimit(ahead = 70) {
    let k = 0;
    for (let d = -this.length / 2; d <= ahead; d += 6) k = Math.max(k, this.curvature(this.sFront + this.facing * d));
    if (k < 1e-4) return 70;
    const v = Math.sqrt(1.0 / k) * 3.6;
    return Math.max(15, Math.min(70, Math.floor(v / 5) * 5));
  }
  togglePantograph() { this.pantoUp = !this.pantoUp; return this.pantoUp; }
  // punto del pantografo (centro del modulo che lo porta)
  pantoPoint() { return { x: this.pantoModule.group.position.x, z: this.pantoModule.group.position.z }; }
  // punti lungo il convoglio (per chi segue sulla stessa corsia)
  trackPoints() {
    const out = [];
    for (let d = 0; d <= this.length; d += 6) { const p = this.path.at(this.sFront - this.facing * d); out.push({ x: p.x, z: p.z }); }
    return out;
  }
  // cambio cabina: solo da fermo con le porte chiuse
  changeCab() {
    if (Math.abs(this.v) > 0.05 || !this.doorsClosed) return false;
    this.facing = -this.facing;
    this.syncTransform();
    return true;
  }
  // punto davanti a una porta, sul lato `side` (+1 destra del verso di marcia), a `out` metri dal fianco
  doorPoint(i, out = 0.6, side = 1) {
    const d = this.doors[i], m = d.module;
    const towardA = this.facing === this.aFwd;
    const zl = m.kind === 'cabB' ? -d.z : d.z;
    const xl = (towardA ? -1 : 1) * side * (TRAM.width / 2 + out);
    const p = new THREE.Vector3(xl, 0, zl);
    m.group.updateMatrixWorld();
    m.group.localToWorld(p);
    return { x: p.x, z: p.z };
  }
  nearestDoor(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.doors.length; i++) { const p = this.doorPoint(i, 0.6); const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  syncTransform() {
    const P = this.path;
    let off = 0;
    this.modules.forEach((m, k) => {
      const sa = this.sA - this.aFwd * off, sb = sa - this.aFwd * m.len;
      const a = P.at(sa), b = P.at(sb);
      m.group.position.set((a.x + b.x) / 2, (this.elev || 0) + 0.14, (a.z + b.z) / 2);
      m.group.rotation.y = Math.atan2(a.x - b.x, a.z - b.z);
      if (k < this.nMod - 1) {
        const j = P.at(sb - this.aFwd * TRAM.gap / 2), bl = this.bellows[k];
        bl.position.set(j.x, (this.elev || 0) + 1.55, j.z);
        bl.rotation.y = j.h;
      }
      off += m.len + TRAM.gap;
    });
    // punto di riferimento (come il centro del bus): 6 m dietro il muso della cabina attiva
    const sr = this.sFront - this.facing * TRAM.ref;
    const r = P.at(sr), ra = P.at(sr + 4), rb = P.at(sr - 4);
    this.x = r.x; this.z = r.z;
    const hc = Math.atan2(ra.x - rb.x, ra.z - rb.z);
    this.h = this.facing > 0 ? hc : hc + Math.PI;
  }

  update(dt, input, world) {
    const sp = Math.abs(this.v);
    // manipolatore: come i pedali del bus, progressivo; Shift per la tacca piena
    const thrT = input.throttle && !input.brake ? (input.shift ? 1 : 0.6) : 0;
    const brkT = input.brake ? (input.shift ? 1 : 0.5) : 0;
    this.throttle += Math.sign(thrT - this.throttle) * Math.min(Math.abs(thrT - this.throttle), dt * (thrT > this.throttle ? 0.9 : 3));
    this.brake += Math.sign(brkT - this.brake) * Math.min(Math.abs(brkT - this.brake), dt * (brkT > this.brake ? 1.4 : 4));
    if (this.throttle > 0.1 && this.parking) this.parking = false;
    // porte
    for (let i = 0; i < this.doorOpen.length; i++) {
      const d = this.doorTarget - this.doorOpen[i];
      this.doorOpen[i] += Math.sign(d) * Math.min(Math.abs(d), dt / (this.doorTarget > 0 ? 1.6 : 1.9));
    }
    const doorHold = this.doorsAnyOpen || this.doorTarget > 0;
    const m = 36000 + this.passengers * 75;
    // pantografo: sale e scende in ~4 s; alimentazione dal filo solo se è alzato e c'è la linea aerea
    this.pantoPos += Math.sign((this.pantoUp ? 1 : 0) - this.pantoPos) * Math.min(Math.abs((this.pantoUp ? 1 : 0) - this.pantoPos), dt / 4);
    setPantograph(this.pantoModule.panto, this.pantoPos);
    const wire = !world || !world.catenaryAt || world.catenaryAt(this.pantoPoint().x, this.pantoPoint().z);
    this.wired = wire && this.pantoPos > 0.97;
    // trazione: 48 kN fino a ~36 km/h, poi potenza costante (480 kW dal filo, 160 kW a batteria); niente trazione a porte aperte
    const Pmax = this.wired ? 480000 : this.battery > 0.03 ? 160000 : 0;
    let F = doorHold ? 0 : this.throttle * Math.min(48000, Pmax / Math.max(1, sp));
    if (sp * 3.6 > 70) F = 0;
    const res = 0.004 * m * 9.81 + 0.5 * 1.2 * 2.6 * 3.1 * sp * sp;
    let dec = this.brake * (0.6 + 0.8 * this.brake) * 1.25; // fino a ~1,75 m/s² con Shift
    if (this.parking || doorHold) dec = Math.max(dec, 2.2);
    if (input.emergency) dec = 2.6;
    const vPrev = this.v;
    let a = (F - res) / m;
    this.v += a * dt;
    if (this.v > 0) this.v = Math.max(0, this.v - dec * dt);
    this.v = Math.max(0, this.v);
    this.powerKw += ((F * sp - (this.brake > 0.05 ? m * dec * sp * 0.6 : 0)) / 1000 - this.powerKw) * Math.min(1, dt * 5);
    this.rpm = 300 + sp * 170;
    // batteria da 20 kWh: si scarica in trazione senza filo, si ricarica col pantografo alzato
    if (this.wired) this.battery = Math.min(1, this.battery + dt / 90);
    else this.battery = Math.max(0, this.battery - (Math.max(0, F * sp) / 1000) * dt / 3600 / 20 - dt / 3600 / 4);
    this.aLong += ((this.v - vPrev) / dt - this.aLong) * Math.min(1, dt * 8);
    // collisioni: auto o tram sulla corsia davanti al muso
    let hit = null;
    if (world && world.carsNear) {
      const fr = this.path.at(this.sFront), fdx = fr.dx * this.facing, fdz = fr.dz * this.facing;
      for (const c of world.carsNear(fr.x, fr.z, 6)) {
        const rx = c.x - fr.x, rz = c.z - fr.z;
        const ahead = rx * fdx + rz * fdz, lat = Math.abs(rx * -fdz + rz * fdx);
        if (ahead > -0.5 && ahead < (c.isTram ? 3.2 : 2.4) && lat < 1.9) {
          const across = c.h != null && Math.abs(Math.sin(c.h) * fdx + Math.cos(c.h) * fdz) < 0.6;
          hit = { kind: c.isTram ? 'tram' : 'car', car: c, impact: this.v, x: fr.x, z: fr.z, lz: 1, crossing: !c.isTram && across };
          this.v = 0;
          break;
        }
      }
    }
    this.sA += this.facing * this.v * dt;
    // il convoglio resta sul percorso
    const sf = this.sFront;
    if (sf > this.path.len - 1 && this.facing > 0) { this.sA -= sf - (this.path.len - 1); this.v = 0; }
    if (sf < 1 && this.facing < 0) { this.sA += 1 - sf; this.v = 0; }
    this.odometer += this.v * dt;
    const hPrev = this.h;
    this.syncTransform();
    let dh = this.h - hPrev;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.yawRate = dt > 0 ? dh / dt : 0;
    // accelerazione laterale dei passeggeri: v² per la curvatura media (non il salto della spezzata)
    this.aLat += (this.v * this.v * this.curvature(this.sFront - this.facing * this.length / 2) - this.aLat) * Math.min(1, dt * 4);
    this.blink += dt;
    // fanali e luci di stop
    const M = tramMaterials();
    M.head.emissiveIntensity = this.lights ? 2.2 : 0.15;
    M.tail.emissiveIntensity = this.brake > 0.05 || doorHold ? 2.2 : this.lights ? 0.8 : 0;
    this.animDoors();
    return hit;
  }
  animDoors() {
    this.doors.forEach((d, i) => {
      const o = this.doorOpen[i];
      for (const leaf of d.leaves) {
        const { sd, lr, z0 } = leaf.userData;
        leaf.position.z = z0 + lr * 0.62 * o;
        leaf.position.x = sd * (TRAM.width / 2 + 0.035 + 0.06 * Math.min(1, o * 4));
      }
    });
  }
  // schermo LCD del banco: tachimetro a lancetta e stato
  drawDash(state = {}) {
    const x = this.dashCtx, W = 256, H = 160;
    x.fillStyle = '#c9d7c4'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#26302a'; x.lineWidth = 3;
    x.beginPath(); x.arc(128, 92, 58, Math.PI * 0.8, Math.PI * 2.2); x.stroke();
    x.lineWidth = 2;
    for (let v = 0; v <= 80; v += 10) {
      const a = Math.PI * 0.8 + (Math.PI * 1.4 * v) / 80;
      x.beginPath(); x.moveTo(128 + Math.cos(a) * 50, 92 + Math.sin(a) * 50); x.lineTo(128 + Math.cos(a) * 58, 92 + Math.sin(a) * 58); x.stroke();
    }
    const a = Math.PI * 0.8 + (Math.PI * 1.4 * Math.min(80, this.speedKmh)) / 80;
    x.strokeStyle = '#111'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(128, 92); x.lineTo(128 + Math.cos(a) * 52, 92 + Math.sin(a) * 52); x.stroke();
    x.fillStyle = '#111'; x.font = 'bold 24px monospace'; x.textAlign = 'center';
    x.fillText(String(Math.round(this.speedKmh)), 128, 128);
    x.font = 'bold 14px monospace';
    x.fillText(this.throttle > 0.05 ? `T ${Math.round(this.throttle * 100)}%` : this.brake > 0.05 ? `F ${Math.round(this.brake * 100)}%` : 'N', 128, 150);
    if (state.doors) { x.fillStyle = '#c8102e'; x.fillText('PORTE', 40, 20); }
    if (state.request) { x.fillStyle = '#b08800'; x.fillText('PRENOT.', 210, 20); }
    if (this.parking) { x.fillStyle = '#c8102e'; x.fillText('P', 128, 20); }
    this.dashTex.needsUpdate = true;
  }
  setPassengerVisuals() {}
  setInnerDisplay() {}
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

// convoglio statico (per i tram automatici): stessi moduli, posizionati da fuori
export function buildTramConvoy(scene, modules = 3, line = 'SIR1', dest = '') {
  const dashTex = new THREE.CanvasTexture(document.createElement('canvas'));
  const mods = [];
  for (let k = 0; k < modules; k++) {
    const kind = k === 0 ? 'cabA' : k === modules - 1 ? 'cabB' : 'mid';
    const m = buildModule(kind, kind === 'mid' ? TRAM.mid : TRAM.cab, { line, dest, dashTex, pantograph: k === 1 });
    m.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(m.group);
    mods.push(m);
    if (m.panto) setPantograph(m.panto, 1);
  }
  const bellows = [];
  for (let k = 0; k < modules - 1; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(TRAM.width - 0.25, 2.35, TRAM.gap + 0.3), tramMaterials().bellows);
    scene.add(b);
    bellows.push(b);
  }
  return { mods, bellows };
}
