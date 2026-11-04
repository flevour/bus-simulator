import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid, distToSeg, mulberry32, circleVsOBB } from './spatial.js';
import * as TX from './textures.js';
import { allStopPlacements } from '../game/routes.js';
import { LINES } from '../data/padova.js';
import { TrackPath, TRAM, catenaryGaps, CATENARY_HEIGHT, tramStopPlacements } from '../tram/tram.js';
import { TRAM_STOP_AHEAD } from '../game/routes.js';

export const Y_ROAD = 0.14;
export const TRAM_HW = 3.4; // metà larghezza della sede del tram (due corsie rosse e rotaia centrale)
const Y_SIDEWALK = 0.1;
const SIDEWALK = 4;

// strati coplanari: spinge in avanti nel depth buffer (evita z-fighting)
export function layer(mat, n) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -n;
  mat.polygonOffsetUnits = -n * 2;
  return mat;
}

// ---------- forma degli incroci ----------
// Raggio di raccordo del cordolo per tipo di strada (indice di ROAD_CLASS)
const filletOf = (e) => (e.cls <= 2 ? 6 : e.cls <= 4 ? 4.5 : e.cls <= 6 ? 3.5 : 2.5);
// Poligono dell'incrocio: ogni strada arriva con i suoi bordi dritti e tra due strade vicine il cordolo
// gira con una curva (raccordo). Restituisce i punti in ordine di angolo e la distanza a cui tagliare ogni strada.
// extra allarga i bordi (per il marciapiede) e riduce i raccordi dello stesso valore (archi concentrici).
function junctionShape(n, extra = 0, trimIn = null) {
  const arms = n.edges.map((e) => {
    const o = e.a === n.id ? 1 : -1;
    const dx = e.dx * o, dz = e.dz * o;
    return { e, dx, dz, hw: e.width / 2 + extra, ang: Math.atan2(dz, dx) };
  }).sort((p, q) => p.ang - q.ang);
  const N = arms.length;
  const trim = new Map();
  for (const a of arms) trim.set(a.e, trimIn ? trimIn.get(a.e) : Math.max(1.5, a.hw * 0.4));
  const wedges = [];
  for (let i = 0; i < N; i++) {
    const A = arms[i], B = arms[(i + 1) % N];
    let th = B.ang - A.ang;
    if (th <= 0) th += Math.PI * 2;
    // bordo di A verso B: normale (-dz, dx); bordo di B verso A: normale (dz, -dx)
    const ax = n.x - A.dz * A.hw, az = n.z + A.dx * A.hw;
    const bx = n.x + B.dz * B.hw, bz = n.z - B.dx * B.hw;
    const w = { A, B, straight: true };
    // tra due tratti dell'anello di una rotonda il bordo interno resta quello dell'isola: niente raccordo
    if (th < 2.95 && !(A.e.roundabout && B.e.roundabout)) {
      // intersezione dei due bordi: ax + A.d * t = bx + B.d * s
      const det = A.dx * -B.dz - A.dz * -B.dx;
      if (Math.abs(det) > 1e-4) {
        const rx = bx - ax, rz = bz - az;
        const t = (rx * -B.dz - rz * -B.dx) / det, sB = (A.dx * rz - A.dz * rx) / det;
        if (t > -0.5 && sB > -0.5) {
          const R = Math.max(0, Math.min(filletOf(A.e), filletOf(B.e)) - extra);
          const T = Math.min(14, R / Math.tan(th / 2));
          w.straight = false;
          w.I = [ax + A.dx * t, az + A.dz * t];
          w.ta = Math.max(0, t + T); w.tb = Math.max(0, sB + T);
          w.Pa = [ax + A.dx * w.ta, az + A.dz * w.ta];
          w.Pb = [bx + B.dx * w.tb, bz + B.dz * w.tb];
          trim.set(A.e, Math.max(trim.get(A.e), w.ta)); trim.set(B.e, Math.max(trim.get(B.e), w.tb));
        }
      }
    }
    w.ax = ax; w.az = az; w.bx = bx; w.bz = bz;
    wedges.push(w);
  }
  // contorno: per ogni strada i due spigoli al taglio, poi il raccordo verso la successiva
  const pts = [];
  for (let i = 0; i < N; i++) {
    const A = arms[i], w = wedges[i], tA = trim.get(A.e);
    const px = n.x + A.dx * tA, pz = n.z + A.dz * tA;
    pts.push([px + A.dz * A.hw, pz - A.dx * A.hw]); // lato verso la strada precedente
    pts.push([px - A.dz * A.hw, pz + A.dx * A.hw]); // lato verso la successiva
    if (!w.straight) {
      // curva di Bézier quadratica tra i punti di tangenza, col vertice all'incrocio dei bordi
      const [x0, z0] = w.Pa, [x1, z1] = w.I, [x2, z2] = w.Pb;
      for (let k = 0; k <= 6; k++) {
        const u = k / 6, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
        pts.push([a * x0 + b * x1 + c * x2, a * z0 + b * z1 + c * z2]);
      }
    }
  }
  return { pts, trim };
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- helper geometria ----------
class GeoBuilder {
  constructor() { this.pos = []; this.uv = []; this.idx = []; }
  quad(p0, p1, p2, p3, uv) {
    const b = this.pos.length / 3;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    this.uv.push(...uv);
    this.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  // nastro da A a B, larghezza w, quota y; v in metri / vScale (spezzato in tratti <= 40 m)
  ribbon(ax, az, bx, bz, w, y, vScale = 12, v0 = 0, hFn = null) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    if (l < 0.01) return;
    const nx = (-dz / l) * (w / 2), nz = (dx / l) * (w / 2);
    const n = Math.max(1, Math.ceil(l / (hFn ? 10 : 40)));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
      const va = v0 + (l * t0) / vScale, vb = v0 + (l * t1) / vScale;
      const y0 = y + (hFn ? hFn(x0, z0) : 0), y1 = y + (hFn ? hFn(x1, z1) : 0);
      // u: 0 sinistra -> 1 destra rispetto alla direzione
      this.quad([x0 - nx, y0, z0 - nz], [x0 + nx, y0, z0 + nz], [x1 - nx, y1, z1 - nz], [x1 + nx, y1, z1 + nz], [0, va, 1, va, 0, vb, 1, vb]);
    }
  }
  disc(x, z, r, y, seg = 16, uvScale = 20) {
    const b = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.uv.push(x / uvScale, z / uvScale);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      this.pos.push(px, y, pz);
      this.uv.push(px / uvScale, pz / uvScale);
      if (i) this.idx.push(b, b + i + 1, b + i);
    }
  }
  // poligono a ventaglio dal centro (cx, cz); punti in ordine di angolo crescente come disc()
  fan(cx, cz, pts, y, uvScale = 20) {
    const b = this.pos.length / 3;
    this.pos.push(cx, y, cz);
    this.uv.push(cx / uvScale, cz / uvScale);
    for (const [px, pz] of pts) { this.pos.push(px, y, pz); this.uv.push(px / uvScale, pz / uvScale); }
    const m = pts.length;
    for (let i = 0; i < m; i++) this.idx.push(b, b + 1 + ((i + 1) % m), b + 1 + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

function disc(x, z, r, y, seg = 28, uvScale = 20) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + x) / uvScale, (p.getZ(i) + z) / uvScale);
  g.translate(x, y, z);
  return g;
}

function polyRibbon(pts, w, y, vScale = 20) {
  const b = new GeoBuilder();
  let v = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    b.ribbon(a.x, a.z, c.x, c.z, w, y, vScale, v);
    v += Math.hypot(c.x - a.x, c.z - a.z) / vScale;
  }
  const geos = [b.build()];
  for (let i = 1; i < pts.length - 1; i++) geos.push(disc(pts[i].x, pts[i].z, w / 2, y, 20, vScale));
  return mergeGeometries(geos.map((g) => g.toNonIndexed()));
}

// ---------- materiale edifici con finestre procedurali ----------
export function makeBuildingMaterial(uniforms, merged = false) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: merged });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vSeed; varying float vH;' + (merged ? '\nattribute float aSeed; attribute float aH;' : ''))
      .replace('#include <begin_vertex>', merged ? `#include <begin_vertex>
        vWP = (modelMatrix * vec4(position, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * normal);
        vSeed = aSeed;
        vH = aH;` : `#include <begin_vertex>
        mat4 bIM = modelMatrix * instanceMatrix;
        vWP = (bIM * vec4(position, 1.0)).xyz;
        vWN = normalize(mat3(bIM) * normal);
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        vH = length(instanceMatrix[1].xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; varying vec3 vWP; varying vec3 vWN; varying float vSeed; varying float vH;\nfloat h31(vec3 p){ return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 43758.5453); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 nW = normalize(vWN);
        float isWall = 1.0 - step(0.5, abs(nW.y));
        float tw = dot(vWP.xz, vec2(-nW.z, nW.x));
        float centro = 1.0 - step(950.0, length(vec2(vWP.x + 150.0, (vWP.z - 120.0) * 1.15)));
        float fyy = vWP.y / 3.1;
        float flo = floor(fyy);
        float fxx = tw / 3.4 + vSeed * 7.0;
        vec2 ff = fract(vec2(fxx, fyy));
        float win = step(0.24, ff.x) * step(ff.x, 0.76) * step(0.34, ff.y) * step(ff.y, 0.84);
        float shop = step(0.06, ff.x) * step(ff.x, 0.94) * step(0.04, ff.y) * step(ff.y, 0.72);
        win = flo < 0.5 ? shop * step(0.45, vSeed) : win;
        win *= isWall * step(vWP.y, vH - 0.6);
        // portici ad arco al piano terra (centro storico)
        float portico = isWall * centro * step(vSeed, 0.42) * step(7.0, vH) * step(vWP.y, 3.9);
        float fx4 = fract(tw / 4.2 + vSeed * 3.0);
        float ax = (fx4 - 0.5) / 0.36;
        float archTop = 2.5 + 1.0 * sqrt(max(0.0, 1.0 - ax * ax));
        float arch = portico * step(abs(ax), 1.0) * step(vWP.y, archTop);
        win *= 1.0 - portico;
        // persiane accanto alle finestre (centro e case più vecchie)
        float shut = isWall * step(0.5, flo) * step(vWP.y, vH - 0.6) * step(0.34, ff.y) * step(ff.y, 0.84)
          * (step(0.1, ff.x) * step(ff.x, 0.235) + step(0.765, ff.x) * step(ff.x, 0.9)) * step(0.3, vSeed) * max(centro, step(vH, 11.0) * step(0.65, vSeed));
        vec3 shutCol = mix(vec3(0.20, 0.33, 0.22), vec3(0.36, 0.24, 0.15), step(0.7, vSeed));
        // zoccolo e cornicione
        diffuseColor.rgb *= 1.0 - isWall * (1.0 - step(0.7, vWP.y)) * 0.28;
        diffuseColor.rgb *= 1.0 - isWall * step(vH - 0.45, vWP.y) * 0.22;
        // marcapiano
        float band = isWall * (1.0 - step(0.06, fract(fyy))) * 0.25 * (1.0 - portico);
        diffuseColor.rgb *= 1.0 - band;
        // balconi a fascia sui palazzi moderni
        float balc = isWall * (1.0 - centro) * step(14.0, vH) * step(0.5, vSeed) * step(0.5, flo) * (1.0 - step(0.1, ff.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + 0.05, balc);
        float roof = step(0.5, nW.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45 + vec3(0.06), roof);
        diffuseColor.rgb = mix(diffuseColor.rgb, shutCol, shut * (1.0 - win));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.065, 0.06), arch);
        float shade = h31(vec3(floor(fxx), flo, vSeed));
        vec3 glass = mix(vec3(0.10, 0.13, 0.17), vec3(0.30, 0.36, 0.42), shade * (1.0 - uNight));
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.92);
        float lit = step(0.52, shade) * uNight * win;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += lit * mix(vec3(1.0, 0.78, 0.42), vec3(0.75, 0.85, 1.0), step(0.85, shade)) * 0.85;
        totalEmissiveRadiance += arch * uNight * vec3(0.32, 0.22, 0.12);`);
  };
  return m;
}

// quota della carreggiata lungo un arco sopraelevato (0 vicino ai nodi)
export function edgeHeight(e, s) {
  if (!e.elev) return 0;
  const t = Math.max(0, Math.min(1, s / e.len));
  return e.ha + (e.hb - e.ha) * t;
}

const CENTRO = { x: -150, z: 120 };
export function zoneOf(x, z) {
  const d = Math.hypot(x - CENTRO.x, (z - CENTRO.z) * 1.15);
  return d < 950 ? 0 : d < 2300 ? 1 : 2;
}

const PAL_CENTRO = ['#d9a66b', '#c97a52', '#e8cf9a', '#d9a19a', '#ece0c8', '#b5653f', '#e3b97f', '#cf8f6a', '#efe3c4', '#c4a484'];
const PAL_MID = ['#d8d2c4', '#c9b79c', '#e6e0d3', '#b8b0a3', '#d9c7a7', '#a9a39a', '#e0cfb0', '#c47b55', '#f0ebe0'];
const PAL_OUT = ['#e8dcc3', '#d5c4a1', '#c9c1b3', '#e9e4da', '#b8ab95', '#d4a373', '#a7a29b'];

export class City {
  constructor(scene, net, opts = {}) {
    this.scene = scene;
    this.net = net;
    this.uniforms = { uNight: { value: 0 } };
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rnd = mulberry32(1234);
    this.segGrid = new Grid(80);
    this.kerbGrid = new Grid(40); // incroci, curve strette e rotonde: dove la ruota posteriore taglia la curva
    this.obstacles = new Grid(40);
    this.obstacleCount = 0;
    this.zones = [];
    this.nightMats = [];
    this.lampPositions = [];
    this.timings = {};
    for (const step of ['indexFeatures', 'buildGround', 'buildRoads', 'buildWater', 'buildRailway', 'buildTramway', 'buildLandmarks', 'buildStops', 'buildRealBuildings', 'buildBuildings', 'buildTreesAndLamps', 'clearBusRoads']) {
      const t0 = performance.now();
      this[step]();
      this.timings[step] = Math.round(performance.now() - t0);
    }
  }

  // ---- indici spaziali ----
  addSeg(ax, az, bx, bz, hw, kind, ref) {
    const it = { ax, az, bx, bz, hw, kind, ref };
    this.segGrid.insertAABB(it, Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw);
  }
  addObstacle(x, z, hx, hz, ang, kind = 'building') {
    // ang = rotazione three.js attorno a Y: asse locale x -> (cos, -sin)
    const c = Math.cos(ang), s = -Math.sin(ang);
    const b = { x, z, hx, hz, c, s, kind };
    const r = Math.hypot(hx, hz);
    this.obstacles.insertAABB(b, x - r, z - r, x + r, z + r);
    this.obstacleCount++;
    return b;
  }
  indexFeatures() {
    const { nodes, edges, water, rails } = this.net;
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      this.addSeg(A.x, A.z, B.x, B.z, e.width / 2, 'road', e);
    }
    for (const n of Object.values(nodes)) {
      if (!n.edges.length) { n.radius = 0; continue; }
      const wmax = Math.max(...n.edges.map((e) => e.width));
      // i vertici intermedi di una via (due soli archi) non sono incroci
      n.joint = n.edges.length === 2;
      n.radius = n.joint ? wmax / 2 : wmax * 0.72 + (n.edges.length === 1 ? 4 : 0);
      if (n.joint) {
        const [e1, e2] = n.edges;
        const d1 = e1.a === n.id ? [e1.dx, e1.dz] : [-e1.dx, -e1.dz], d2 = e2.a === n.id ? [e2.dx, e2.dz] : [-e2.dx, -e2.dz];
        n.bend = 1 + (d1[0] * d2[0] + d1[1] * d2[1]); // 0 = rettilineo, 2 = inversione
      }
      this.addSeg(n.x, n.z, n.x + 0.01, n.z, n.radius, 'road', null);
    }
    // incroci veri (3+ strade): poligono con raccordi al posto del disco
    this.jctGrid = new Grid(40);
    for (const n of Object.values(nodes)) {
      if (n.edges.length < 3) continue;
      const sh = junctionShape(n);
      n.trim = sh.trim; n.poly = sh.pts;
      n.walkPoly = junctionShape(n, SIDEWALK, sh.trim).pts;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of sh.pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      this.jctGrid.insertAABB({ pts: sh.pts }, x0, z0, x1, z1);
    }
    // zone con fascia sormontabile: un bus da 12 m non può restare tutto sull'asfalto
    const kz = (ax, az, bx, bz, hw) => this.kerbGrid.insertAABB({ ax, az, bx, bz, hw }, Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw);
    for (const n of Object.values(nodes)) {
      const deg = n.edges.length;
      if (!deg) continue;
      if (deg >= 3 || deg === 1 || n.bend > 0.12 || n.edges.some((e) => e.roundabout)) kz(n.x, n.z, n.x + 0.01, n.z, n.radius + (deg === 1 ? 10 : 9));
    }
    for (const e of edges) if (e.roundabout) { const A = nodes[e.a], B = nodes[e.b]; kz(A.x, A.z, B.x, B.z, e.width / 2 + 5); }
    for (const w of water) for (let i = 0; i < w.pts.length - 1; i++) this.addSeg(w.pts[i].x, w.pts[i].z, w.pts[i + 1].x, w.pts[i + 1].z, w.width / 2 + 6, 'water', w);
    for (const r of rails) if (!r.tunnel) for (let i = 0; i < r.pts.length - 1; i++) this.addSeg(r.pts[i].x, r.pts[i].z, r.pts[i + 1].x, r.pts[i + 1].z, 3.2, 'rail');
    for (const t of this.net.tram || []) for (let i = 0; i < t.length - 1; i++) this.addSeg(t[i].x, t[i].z, t[i + 1].x, t[i + 1].z, TRAM_HW, 'tram');
  }
  // distanza libera (positiva = fuori) dalle feature
  clearance(x, z, kinds = null, r = 40) {
    const arr = this.segGrid.query(x, z, r, this._q || (this._q = []));
    let best = Infinity;
    for (const it of arr) {
      if (kinds && !kinds.includes(it.kind)) continue;
      const d = distToSeg(x, z, it.ax, it.az, it.bx, it.bz).d - it.hw;
      if (d < best) best = d;
    }
    for (const zn of this.zones) {
      const dx = (x - zn.x) / zn.rx, dz = (z - zn.z) / zn.rz;
      if (dx * dx + dz * dz < 1) return -1;
    }
    return best;
  }
  // punto della carreggiata più vicino, con direzione della via
  snapToRoad(x, z, r = 40) {
    const arr = this.segGrid.query(x, z, r, this._qs || (this._qs = []));
    let best = null, bd = Infinity;
    for (const it of arr) {
      if (it.kind !== 'road' || !it.ref) continue;
      const q = distToSeg(x, z, it.ax, it.az, it.bx, it.bz);
      if (q.d < bd) { bd = q.d; best = { it, t: q.t }; }
    }
    if (!best) return null;
    const { it, t } = best;
    const e = it.ref;
    return { cx: it.ax + (it.bx - it.ax) * t, cz: it.az + (it.bz - it.az) * t, dx: e.dx, dz: e.dz, hw: e.width / 2, edge: e, d: bd };
  }
  // informazioni sulla strada più vicina
  roadInfo(x, z) {
    const arr = this.segGrid.query(x, z, 20, this._q2 || (this._q2 = []));
    let best = { off: Infinity, edge: null };
    for (const it of arr) {
      if (it.kind !== 'road') continue;
      const d = distToSeg(x, z, it.ax, it.az, it.bx, it.bz).d - it.hw;
      if (d < best.off) best = { off: d, edge: it.ref };
    }
    if (best.off > -0.3 && this.jctGrid) {
      const jq = this.jctGrid.query(x, z, 1, this._qj || (this._qj = []));
      for (const it of jq) if (pointInPoly(x, z, it.pts)) { best.off = -0.3; break; }
    }
    return best;
  }

  // ---- terreno ----
  buildGround() {
    const tex = TX.groundTexture();
    tex.repeat.set(220, 220);
    const g = new THREE.PlaneGeometry(22000, 22000, 176, 176); // suddiviso: triangoli enormi danno problemi di profondità
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ---- strade ----
  buildRoads() {
    const { nodes, edges } = this.net;
    const road = new GeoBuilder();
    const plain = new GeoBuilder(); // residenziali e di servizio: asfalto senza segnaletica
    const roadOw = new GeoBuilder(); // sensi unici: senza mezzeria
    const ped = new GeoBuilder(); // aree pedonali lastricate
    const walk = new GeoBuilder();
    const curb = [];
    const marks = new GeoBuilder();
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      let ra = A.joint ? 0 : A.trim ? A.trim.get(e) : A.radius * 0.6, rb = B.joint ? 0 : B.trim ? B.trim.get(e) : B.radius * 0.6;
      if (ra + rb > e.len - 0.2) { const k = Math.max(0, e.len - 0.2) / (ra + rb); ra *= k; rb *= k; }
      const ax = A.x + e.dx * ra, az = A.z + e.dz * ra, bx = B.x - e.dx * rb, bz = B.z - e.dz * rb;
      const hFn = e.elev ? (x, z) => edgeHeight(e, (x - A.x) * e.dx + (z - A.z) * e.dz) : null;
      (e.ped ? ped : e.cls >= 5 && !e.routes ? plain : e.oneway ? roadOw : road).ribbon(ax, az, bx, bz, e.width, Y_ROAD, e.ped ? 6 : 12, 0, hFn);
      if (!e.ped) walk.ribbon(A.x, A.z, B.x, B.z, e.width + (e.elev ? 2 : e.service ? 2.4 : SIDEWALK * 2), Y_SIDEWALK, 6, 0, hFn);
      if (e.elev) { this.buildOverpass(e, A, curb); continue; }
      // strisce pedonali vicino agli incroci
      for (const [N, dirSign] of [[A, 1], [B, -1]]) {
        if (e.roundabout || N.edges.length < 3 || N.edges.filter((x) => x.main).length < 3) continue;
        const base = (N.trim ? N.trim.get(e) - 1.2 : N.radius) + 1.2;
        for (let k = -e.width / 2 + 0.6; k < e.width / 2 - 0.4; k += 1.0) {
          const cx = N.x + e.dx * dirSign * (base + 2) + -e.dz * k, cz = N.z + e.dz * dirSign * (base + 2) + e.dx * k;
          const hx = e.dx * 1.7, hz = e.dz * 1.7, wx = -e.dz * 0.25, wz = e.dx * 0.25;
          marks.quad([cx - hx - wx, Y_ROAD + 0.02, cz - hz - wz], [cx - hx + wx, Y_ROAD + 0.02, cz - hz + wz], [cx + hx - wx, Y_ROAD + 0.02, cz + hz - wz], [cx + hx + wx, Y_ROAD + 0.02, cz + hz + wz], [0, 0, 1, 0, 0, 1, 1, 1]);
        }
      }
    }
    const inter = new GeoBuilder(), joints = new GeoBuilder(), walkDisc = new GeoBuilder();
    for (const n of Object.values(nodes)) {
      if (!n.edges.length || (n.joint && n.bend < 0.02)) continue;
      const seg = n.joint ? 10 : 18;
      // nelle curve il disco sta sotto l'asfalto e riempie solo lo spicchio tra i due tratti
      if (n.poly) {
        inter.fan(n.x, n.z, n.poly, Y_ROAD + 0.01 + (n.h || 0), 20);
        if (!n.edges.every((e) => e.ped)) walkDisc.fan(n.x, n.z, n.walkPoly, Y_SIDEWALK - 0.005 + (n.h || 0), 6);
        continue;
      }
      (n.joint ? joints : inter).disc(n.x, n.z, n.radius, Y_ROAD + (n.joint ? -0.005 : 0.01) + (n.h || 0), seg, 20);
      if (!n.edges.every((e) => e.ped)) walkDisc.disc(n.x, n.z, n.radius + SIDEWALK + (n.joint ? 0 : 2), Y_SIDEWALK - 0.005 + (n.h || 0), seg, 6);
    }
    const roadTex = TX.roadTexture();
    const roadMat = layer(new THREE.MeshLambertMaterial({ map: roadTex }), 2);
    this.roadMat = roadMat;
    const rm = new THREE.Mesh(road.build(), roadMat);
    rm.receiveShadow = true;
    const im = new THREE.Mesh(inter.build(), layer(new THREE.MeshLambertMaterial({ map: TX.intersectionTexture() }), 3));
    {
      const jm = new THREE.Mesh(joints.build(), layer(new THREE.MeshLambertMaterial({ map: TX.intersectionTexture(), color: 0xf4f4f4 }), 1.5));
      jm.receiveShadow = true;
      this.group.add(jm);
    }
    im.receiveShadow = true;
    const swTex = TX.sidewalkTexture();
    const swMat = layer(new THREE.MeshLambertMaterial({ map: swTex }), 1);
    const owM = new THREE.Mesh(roadOw.build(), layer(new THREE.MeshLambertMaterial({ map: TX.roadTextureOneway() }), 2));
    owM.receiveShadow = true;
    this.owMat = owM.material;
    this.group.add(owM);
    const plainM = new THREE.Mesh(plain.build(), layer(new THREE.MeshLambertMaterial({ map: TX.intersectionTexture() }), 2));
    plainM.receiveShadow = true;
    const pedTex = TX.sidewalkTexture();
    const pedM = new THREE.Mesh(ped.build(), layer(new THREE.MeshLambertMaterial({ map: pedTex, color: 0xf0e8dc }), 2));
    pedM.receiveShadow = true;
    this.group.add(plainM, pedM);
    const wm = new THREE.Mesh(mergeGeometries([walk.build().toNonIndexed(), walkDisc.build().toNonIndexed()]), swMat);
    wm.receiveShadow = true;
    const cm = new THREE.Mesh(curb.length ? mergeGeometries(curb) : new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0xbdb8ae }));
    const mk = new THREE.Mesh(marks.build(), layer(new THREE.MeshLambertMaterial({ color: 0xeeeeea }), 4));
    this.group.add(rm, im, wm, cm, mk);
  }

  // cavalcavia: parapetti, impalcato e pile
  buildOverpass(e, A, out) {
    const ang = Math.atan2(e.dx, e.dz);
    const deck = [];
    for (let s = 0; s < e.len; s += 10) {
      const h0 = edgeHeight(e, s), h1 = edgeHeight(e, Math.min(e.len, s + 10));
      const hm = (h0 + h1) / 2;
      if (hm < 0.3) continue;
      const cx = A.x + e.dx * (s + 5), cz = A.z + e.dz * (s + 5);
      const slope = Math.atan2(h1 - h0, 10);
      for (const side of [-1, 1]) {
        const off = e.width / 2 + 0.9;
        if (this.clearance(cx - e.dz * side * off, cz + e.dx * side * off, ['road'], 20) < 0.2) continue;
        const g = new THREE.BoxGeometry(0.35, 1.1, 10.2);
        g.rotateX(-slope);
        g.rotateY(ang);
        g.translate(cx - e.dz * side * off, Y_ROAD + hm + 0.55, cz + e.dx * side * off);
        out.push(g);
        this.addObstacle(cx - e.dz * side * off, cz + e.dx * side * off, 5.2, 0.25, Math.atan2(-e.dz, e.dx), 'wall');
      }
      // fascia laterale dell'impalcato
      const sk = new THREE.BoxGeometry(e.width + 2.4, 1.0, 10.2);
      sk.rotateX(-slope);
      sk.rotateY(ang);
      sk.translate(cx, Y_ROAD + hm - 0.5, cz);
      deck.push(sk);
      if (hm > 2.5 && Math.round(s) % 30 === 0) {
        for (const side of [-1, 1]) {
          const pl = new THREE.BoxGeometry(1.2, hm - 0.6, 1.2);
          pl.translate(cx - e.dz * side * (e.width / 2 - 1), (hm - 0.6) / 2, cz + e.dx * side * (e.width / 2 - 1));
          deck.push(pl);
        }
      }
    }
    if (deck.length) {
      const m = new THREE.Mesh(mergeGeometries(deck), new THREE.MeshLambertMaterial({ color: 0xb9b4aa }));
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
  }

  // tram: c'è la linea aerea sopra questo punto della sede? (no nei tratti a batteria, es. Prato della Valle)
  catenaryAt(x, z) {
    if (!this.tramCenter || !this.catenaryGaps || !this.catenaryGaps.length) return true;
    const pr = this.tramCenter.project(x, z);
    return !(pr.d < 12 && this.catenaryGaps.some(([a, b]) => pr.s > a && pr.s < b));
  }
  // un tratto senza linea aerea comincia entro r metri?
  catenaryGapNear(x, z, r) {
    for (const g of this.catenaryGaps || []) for (const s of g) { const p = this.tramCenter.at(s); if (Math.hypot(p.x - x, p.z - z) < r) return true; }
    return false;
  }

  // vero se il punto è in una zona dove le ruote possono uscire un po' dall'asfalto (incroci, curve strette, rotonde)
  kerbAllowance(x, z) {
    const arr = this.kerbGrid.query(x, z, 20, this._qk || (this._qk = []));
    for (const it of arr) if (distToSeg(x, z, it.ax, it.az, it.bx, it.bz).d < it.hw) return true;
    return false;
  }

  // quota della strada sotto un punto (cavalcavia), 0 altrove
  heightAt(x, z) {
    const arr = this.segGrid.query(x, z, 12, this._qh || (this._qh = []));
    let h = 0;
    for (const it of arr) {
      const e = it.ref;
      if (it.kind !== 'road' || !e || !e.elev) continue;
      const r = distToSeg(x, z, it.ax, it.az, it.bx, it.bz);
      if (r.d > it.hw + 1.5) continue;
      h = Math.max(h, edgeHeight(e, r.t * e.len));
    }
    return h;
  }

  // ---- acqua e ponti ----
  buildWater() {
    const wTex = TX.waterTexture();
    const wMat = layer(new THREE.MeshLambertMaterial({ map: wTex, color: 0xaaccd0 }), 2);
    this.waterTex = wTex;
    const bank = layer(new THREE.MeshLambertMaterial({ color: 0x7d8a5c }), 1);
    const geos = [], banks = [];
    for (const w of this.net.water) {
      geos.push(polyRibbon(w.pts, w.width, 0.03, 30));
      banks.push(polyRibbon(w.pts, w.width + 16, 0.02, 30));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(geos), wMat), new THREE.Mesh(mergeGeometries(banks), bank));
    // parapetti dei ponti dove una strada attraversa un corso d'acqua
    const par = [];
    const { nodes, edges } = this.net;
    for (const e of edges) {
      if (!e.bridge) continue;
      const A = nodes[e.a], B = nodes[e.b];
      for (const w of this.net.water)
        for (let i = 0; i < w.pts.length - 1; i++) {
          const t = segIntersect(A, B, w.pts[i], w.pts[i + 1]);
          if (t == null) continue;
          const wdx = w.pts[i + 1].x - w.pts[i].x, wdz = w.pts[i + 1].z - w.pts[i].z;
          const sinA = Math.abs(e.dx * wdz - e.dz * wdx) / Math.hypot(wdx, wdz);
          if (sinA < 0.5) continue; // incrocio troppo obliquo: il tracciato del fiume è approssimato
          // parapetto limitato al tratto di strada (la via reale può curvare subito dopo)
          const half = (w.width / sinA + 10) / 2;
          const s0 = Math.max(0, t * e.len - half), s1 = Math.min(e.len, t * e.len + half);
          if (s1 - s0 < 4) continue;
          const span = s1 - s0, sm = (s0 + s1) / 2;
          const cx = A.x + e.dx * sm, cz = A.z + e.dz * sm;
          for (const side of [-1, 1]) {
            const ox = -e.dz * side * (e.width / 2 + 0.6), oz = e.dx * side * (e.width / 2 + 0.6);
            // non mettere il parapetto sopra un'altra carreggiata (doppie carreggiate, svincoli)
            if ([-0.45, 0, 0.45].some((f) => this.clearance(cx + ox + e.dx * span * f, cz + oz + e.dz * span * f, ['road'], 20) < 0.2)) continue;
            const g = new THREE.BoxGeometry(0.45, 1.1, span);
            g.rotateY(Math.atan2(e.dx, e.dz));
            g.translate(cx + ox, Y_ROAD + 0.55, cz + oz);
            par.push(g);
            const hl = span / 2;
            const ang = Math.atan2(-e.dz, e.dx);
            this.addObstacle(cx + ox, cz + oz, hl, 0.3, ang, 'wall');
          }
        }
    }
    if (par.length) this.group.add(new THREE.Mesh(mergeGeometries(par), new THREE.MeshLambertMaterial({ color: 0xcfc6b4 })));
  }

  // sede del tram: due corsie rosse, cordoli e la rotaia di guida centrale (Translohr), con le banchine alle fermate
  buildTramway() {
    const tram = this.net.tram || [];
    if (!tram.length) return;
    const red = new GeoBuilder(), rail = new GeoBuilder(), kerb = new GeoBuilder();
    for (const t of tram) {
      for (let i = 0; i < t.length - 1; i++) {
        const a = t[i], b = t[i + 1];
        red.ribbon(a.x, a.z, b.x, b.z, TRAM_HW * 2, Y_ROAD + 0.03, 8);
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
        // una rotaia di guida al centro di ogni corsia (Translohr: un'unica rotaia per binario)
        for (const sd of [-1, 1]) rail.ribbon(a.x + nx * sd * TRAM.lane, a.z + nz * sd * TRAM.lane, b.x + nx * sd * TRAM.lane, b.z + nz * sd * TRAM.lane, 0.22, Y_ROAD + 0.05, 8);
        for (const sd of [-1, 1]) kerb.ribbon(a.x + nx * sd * TRAM_HW, a.z + nz * sd * TRAM_HW, b.x + nx * sd * TRAM_HW, b.z + nz * sd * TRAM_HW, 0.3, Y_ROAD + 0.06, 8);
        red.disc(b.x, b.z, TRAM_HW, Y_ROAD + 0.029, 12, 8);
      }
    }
    // linea aerea: pali centrali ogni 30 m con la mensola, un filo di contatto per corsia; niente fili a Prato della Valle
    const center = new TrackPath(tram[0]);
    this.tramCenter = center;
    this.catenaryGaps = catenaryGaps(center, this.net.tramStops);
    const inGap = (s) => this.catenaryGaps.some(([g0, g1]) => s > g0 && s < g1);
    const poles = [], wires = [];
    let prev = null;
    for (let s = 0; s <= center.len; s += 30) {
      const p = center.at(s);
      if (inGap(s)) { prev = null; continue; }
      const ang = Math.atan2(p.dx, p.dz);
      poles.push(new THREE.CylinderGeometry(0.09, 0.12, CATENARY_HEIGHT + 0.7, 6).translate(p.x, Y_ROAD + (CATENARY_HEIGHT + 0.7) / 2, p.z));
      poles.push(new THREE.BoxGeometry(TRAM.lane * 2 + 0.8, 0.1, 0.1).rotateY(ang).translate(p.x, Y_ROAD + CATENARY_HEIGHT + 0.35, p.z));
      if (prev) for (const sd of [-1, 1]) {
        const ax = prev.x - prev.dz * sd * TRAM.lane, az = prev.z + prev.dx * sd * TRAM.lane, bx = p.x - p.dz * sd * TRAM.lane, bz = p.z + p.dx * sd * TRAM.lane;
        const wl = Math.hypot(bx - ax, bz - az);
        wires.push(new THREE.BoxGeometry(0.035, 0.035, wl).rotateY(Math.atan2(bx - ax, bz - az)).translate((ax + bx) / 2, Y_ROAD + CATENARY_HEIGHT, (az + bz) / 2));
      }
      prev = p;
    }
    if (poles.length) { const pm = new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x6f767c })); pm.castShadow = true; this.group.add(pm); }
    if (wires.length) this.group.add(new THREE.Mesh(mergeGeometries(wires), new THREE.MeshBasicMaterial({ color: 0x2a2d30 })));
    // cartelli "abbassare / alzare il pantografo" ai bordi dei tratti senza linea, per i due sensi
    const pan = [], panTex = TX.pantographSignTexture();
    for (const [g0, g1] of this.catenaryGaps) {
      for (const [sAt, dir, up] of [[g0 - 60, 1, 0], [g1 + 8, 1, 1], [g1 + 60, -1, 0], [g0 - 8, -1, 1]]) {
        const p = center.at(sAt), rx = -p.dz * dir, rz = p.dx * dir, px = p.x + rx * (TRAM_HW + 0.5), pz = p.z + rz * (TRAM_HW + 0.5);
        const ang = Math.atan2(-p.dx * dir, -p.dz * dir); // il cartello guarda il tram che arriva
        pan.push({ g: new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6).translate(px, Y_ROAD + 1.3, pz), mat: 'pole' });
        const pl = new THREE.PlaneGeometry(0.7, 0.7);
        const uv = pl.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (up ? 0.5 : 0));
        pan.push({ g: pl.rotateY(ang).translate(px, Y_ROAD + 2.35, pz), mat: 'sign' });
      }
    }
    if (pan.length) {
      this.group.add(new THREE.Mesh(mergeGeometries(pan.filter((x) => x.mat === 'pole').map((x) => x.g)), new THREE.MeshLambertMaterial({ color: 0x8f9497 })));
      this.group.add(new THREE.Mesh(mergeGeometries(pan.filter((x) => x.mat === 'sign').map((x) => x.g)), new THREE.MeshLambertMaterial({ map: panTex, side: THREE.DoubleSide })));
    }
    const tex = TX.tramLaneTexture();
    const rm = new THREE.Mesh(red.build(), layer(new THREE.MeshLambertMaterial({ map: tex }), 5));
    rm.receiveShadow = true;
    this.group.add(rm, new THREE.Mesh(rail.build(), layer(new THREE.MeshLambertMaterial({ color: 0x9da3a8 }), 6)), new THREE.Mesh(kerb.build(), layer(new THREE.MeshLambertMaterial({ color: 0xd8d4cc }), 6)));
    // banchine delle fermate del tram: dalle fermate reali di tutte le corse, a destra del verso di marcia di chi le
    // serve; a fine banchina la linea bianca di fermata (lì si ferma il muso)
    const plat = [], roofs = [], stopLines = new GeoBuilder();
    for (const st of tramStopPlacements(center)) {
      const p = center.at(st.s), dx = p.dx * st.sig, dz = p.dz * st.sig, rx = -dz, rz = dx;
      const ang = Math.atan2(dx, dz);
      // banchina piena se c'è spazio, altrimenti più stretta e attaccata alla sede (dove la sede corre accanto alla strada)
      const wide = this.clearance(p.x + rx * (TRAM_HW + 1.5), p.z + rz * (TRAM_HW + 1.5), ['road'], 20) >= 0.3;
      const off = wide ? TRAM_HW + 1.5 : TRAM_HW + 1.1, ox = rx * off, oz = rz * off;
      plat.push(new THREE.BoxGeometry(wide ? 2.8 : 2.0, 0.3, 30).rotateY(ang).translate(p.x + ox, Y_ROAD + 0.15, p.z + oz));
      roofs.push(new THREE.BoxGeometry(wide ? 2.4 : 1.8, 0.15, 12).rotateY(ang).translate(p.x + ox, 3.1, p.z + oz));
      for (const k of [-4.5, 4.5]) roofs.push(new THREE.BoxGeometry(0.12, 2.9, 0.12).translate(p.x + ox + dx * k - rx * (wide ? 0.9 : 0.6), 1.6, p.z + oz + dz * k - rz * (wide ? 0.9 : 0.6)));
      // linea di fermata trasversale sulla corsia
      const q = center.at(st.s + st.sig * TRAM_STOP_AHEAD), qx = q.x + rx * TRAM.lane, qz = q.z + rz * TRAM.lane;
      const P = (a, w) => [qx + dx * a + rx * w, Y_ROAD + 0.045, qz + dz * a + rz * w];
      stopLines.quad(P(-0.2, -1.6), P(-0.2, 1.6), P(0.2, -1.6), P(0.2, 1.6), [0, 0, 1, 0, 0, 1, 1, 1]);
    }
    if (stopLines.pos.length) this.group.add(new THREE.Mesh(stopLines.build(), layer(new THREE.MeshLambertMaterial({ color: 0xf2f2ea }), 7)));
    // scambio ai due capolinea (cambio cabina): un deviatoio che collega le due corsie nel binario tronco
    const xo = new GeoBuilder();
    for (const [s0, s1] of [[14, 38], [center.len - 14, center.len - 38]]) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const pa = center.at(s0 + (s1 - s0) * t0), pb = center.at(s0 + (s1 - s0) * t1);
        const wa = TRAM.lane * (1 - 2 * t0), wb = TRAM.lane * (1 - 2 * t1);
        xo.ribbon(pa.x - pa.dz * wa, pa.z + pa.dx * wa, pb.x - pb.dz * wb, pb.z + pb.dx * wb, 0.22, Y_ROAD + 0.05, 8);
      }
    }
    this.group.add(new THREE.Mesh(xo.build(), layer(new THREE.MeshLambertMaterial({ color: 0x9da3a8 }), 6)));
    if (plat.length) this.group.add(new THREE.Mesh(mergeGeometries(plat), new THREE.MeshLambertMaterial({ color: 0xc9c3b8 })));
    if (roofs.length) { const m = new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshLambertMaterial({ color: 0x5d646b })); m.castShadow = true; this.group.add(m); }
  }

  // la sede del tram sotto un punto?
  onTramway(x, z, margin = -0.4) {
    const arr = this.segGrid.query(x, z, 6, this._qt || (this._qt = []));
    for (const it of arr) if (it.kind === 'tram' && distToSeg(x, z, it.ax, it.az, it.bx, it.bz).d < it.hw + margin) return true;
    return false;
  }

  buildRailway() {
    // un nastro per ogni binario OSM (i fasci di stazione sono binari paralleli)
    const t = TX.railTexture1();
    const geos = [];
    for (const r of this.net.rails) if (!r.tunnel) geos.push(polyRibbon(r.pts, 4.4, r.bridge ? 0.09 : 0.06, 6));
    if (geos.length) this.group.add(new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed())), layer(new THREE.MeshLambertMaterial({ map: t }), 1)));
    // pali della linea aerea lungo le linee principali
    const poles = [];
    for (const r of this.net.rails) {
      if (r.yard || r.tunnel) continue;
      let acc = 0;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const l = Math.hypot(b.x - a.x, b.z - a.z);
        for (let s = (60 - acc) % 60; s < l; s += 60) {
          const x = a.x + ((b.x - a.x) * s) / l + ((b.z - a.z) / l) * 3.4, z = a.z + ((b.z - a.z) * s) / l - ((b.x - a.x) / l) * 3.4;
          if (this.clearance(x, z, ['road'], 20) < 2) continue;
          poles.push(new THREE.BoxGeometry(0.28, 7, 0.28).translate(x, 3.5, z));
        }
        acc = (acc + l) % 60;
      }
    }
    if (poles.length) this.group.add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x777777 })));
  }

  // ---- monumenti ----
  buildLandmarks() {
    const L = this.net.landmarks;
    // allinea i monumenti alla rete stradale reale: cerca il punto libero più vicino
    const free = (cx, cz, hx, hz, ell, step) => {
      for (let x = -hx; x <= hx + 0.1; x += step)
        for (let z = -hz; z <= hz + 0.1; z += step) {
          if (ell && (x / hx) ** 2 + (z / hz) ** 2 > 1) continue;
          if (this.clearance(cx + x, cz + z, ['road'], 30) < 2.5) return false;
        }
      return true;
    };
    const fit = (k, hx, hz, { ell = false, maxShift = 180, scales = [1] } = {}) => {
      const c = L[k];
      for (const sc of scales) {
        const step = Math.max(6, Math.min(hx, hz) * sc / 3);
        for (let r = 0; r <= maxShift; r += 10)
          for (let a = 0; a < (r ? 16 : 1); a++) {
            const x = c.x + Math.cos((a / 16) * Math.PI * 2) * r, z = c.z + Math.sin((a / 16) * Math.PI * 2) * r;
            if (free(x, z, hx * sc, hz * sc, ell, step)) { L[k] = { x, z, scale: sc }; return true; }
          }
      }
      L[k] = { ...c, scale: 0 };
      return false;
    };
    fit('prato', 120, 160, { ell: true, maxShift: 80, scales: [1, 0.92, 0.85, 0.75] });
    this.landmarkFit = { prato: L.prato.scale };
    const add = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh); return mesh; };
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const box = (w, h, d, mat, x, y, z, ry = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      return add(m);
    };
    const brick = lam(0xa45a3c), stone = lam(0xe6dccb), lead = lam(0x7d8a86), marble = lam(0xf2eee6);

    // Prato della Valle
    if (L.prato.scale) {
      const c = L.prato;
      const S = c.scale || 0.75;
      this.zones.push({ x: c.x, z: c.z, rx: 118 * S, rz: 158 * S });
      const ell = (rx, rz, y, mat, seg = 64) => {
        const g = new THREE.CircleGeometry(1, seg);
        g.rotateX(-Math.PI / 2);
        g.scale(rx, 1, rz);
        g.translate(c.x, y, c.z);
        return add(new THREE.Mesh(g, mat));
      };
      const pav = TX.sidewalkTexture();
      pav.repeat.set(30, 40);
      ell(122 * S, 162 * S, 0.09, layer(new THREE.MeshLambertMaterial({ map: pav }), 1));
      ell(82 * S, 122 * S, 0.1, layer(new THREE.MeshLambertMaterial({ map: this.waterTex || TX.waterTexture(), color: 0x9fc6c9 }), 2));
      const gt = TX.grassTexture();
      gt.repeat.set(8, 12);
      ell(72 * S, 112 * S, 0.12, layer(new THREE.MeshLambertMaterial({ map: gt }), 3));
      // viali a croce
      box(6, 0.05, 224 * S, stone, c.x, 0.16, c.z);
      box(144 * S, 0.05, 6, stone, c.x, 0.16, c.z);
      // fontana centrale
      const f = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.6, 32), stone);
      f.position.set(c.x, 0.4, c.z);
      add(f);
      const fw = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 0.1, 32), lam(0x5f8f99));
      fw.position.set(c.x, 0.72, c.z);
      add(fw);
      // statue su due anelli (78 in totale)
      const ped = new THREE.BoxGeometry(1.2, 1.6, 1.2);
      ped.translate(0, 0.8, 0);
      const fig = new THREE.CylinderGeometry(0.35, 0.45, 2.2, 8);
      fig.translate(0, 2.7, 0);
      const head = new THREE.SphereGeometry(0.3, 8, 6);
      head.translate(0, 4.0, 0);
      const statueGeo = mergeGeometries([ped, fig, head]);
      const N = 78;
      const inst = new THREE.InstancedMesh(statueGeo, marble, N);
      const M = new THREE.Matrix4();
      for (let i = 0; i < N; i++) {
        const ring = i % 2;
        const a = (Math.floor(i / 2) / (N / 2)) * Math.PI * 2 + ring * 0.04;
        const rx = (ring ? 86 : 69) * S, rz = (ring ? 126 : 109) * S;
        const x = c.x + Math.cos(a) * rx, z = c.z + Math.sin(a) * rz;
        // lascia spazio ai 4 ponti
        if (Math.abs(Math.cos(a)) > 0.995 || Math.abs(Math.sin(a)) > 0.997) { M.makeScale(0, 0, 0); inst.setMatrixAt(i, M); continue; }
        M.makeRotationY(-a);
        M.setPosition(x, 0.12, z);
        inst.setMatrixAt(i, M);
      }
      inst.castShadow = true;
      add(inst);
      // ponti
      for (const [dx, dz, ry] of [[0, -117, 0], [0, 117, 0], [77, 0, Math.PI / 2], [-77, 0, Math.PI / 2]]) box(7, 0.6, 14, stone, c.x + dx * S, 0.4, c.z + dz * S, ry);
      // alberi sull'isola
      this.pratoTrees = [];
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        this.pratoTrees.push({ x: c.x + Math.cos(a) * 58 * S, z: c.z + Math.sin(a) * 96 * S });
      }
      // Loggia Amulea (a ovest)
    }

  }

  // ---- fermate (scenografia per tutte le linee) ----
  buildStops() {
    this.stopPlacements = allStopPlacements(this.net, (x, z) => this.snapToRoad(x, z), (x, z) => this.clearance(x, z, ['road', 'tram'], 20));
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fc4d6, transparent: true, opacity: 0.35 });
    const frame = new THREE.MeshLambertMaterial({ color: 0x2b3a4a });
    const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c200 });
    const poleG = new THREE.CylinderGeometry(0.05, 0.05, 3, 8);
    const marks = new GeoBuilder(), busText = new GeoBuilder();
    const frames = [], glasses = [], benches = [], signs = [], yellows = [];
    const ATLAS_COLS = 16;
    const atlas = document.createElement('canvas');
    atlas.width = 256 * ATLAS_COLS;
    atlas.height = 128 * Math.ceil(this.stopPlacements.length / ATLAS_COLS);
    const atlasCtx = atlas.getContext('2d');
    for (const st of this.stopPlacements) {
      const ang = Math.atan2(st.dx, st.dz); // ruota lungo la strada
      const grp = new THREE.Group();
      grp.position.set(st.x + st.rx * 1.6, Y_SIDEWALK, st.z + st.rz * 1.6);
      grp.rotation.y = ang;
      grp.updateMatrixWorld();
      const put = (g, x, y, z, arr) => { const gg = g.clone(); gg.translate(x, y, z); gg.applyMatrix4(grp.matrixWorld); arr.push(gg); };
      // locale: z = direzione strada, +x = verso la carreggiata
      put(new THREE.BoxGeometry(1.9, 0.12, 5), 0, 2.45, -3, frames);
      put(new THREE.BoxGeometry(0.06, 2.1, 5), -0.85, 1.25, -3, glasses);
      put(new THREE.BoxGeometry(0.45, 0.08, 3.2), -0.55, 0.5, -3, benches);
      for (const dz of [-5.4, -0.6]) for (const dx of [-0.85, 0.85]) put(new THREE.BoxGeometry(0.08, 2.45, 0.08), dx, 1.22, dz, frames);
      // palina gialla con cartello (texture atlas condivisa)
      frames.push(poleG.clone().translate(st.x, Y_SIDEWALK + 1.5, st.z));
      const k = signs.length;
      const col = k % ATLAS_COLS, row = Math.floor(k / ATLAS_COLS);
      drawSignCell(atlasCtx, col * 256, row * 128, st.name, st.lines.join(' '));
      const sg = new THREE.PlaneGeometry(1.3, 0.65);
      const uv = sg.attributes.uv;
      const u0 = (col * 256) / atlas.width, u1 = ((col + 1) * 256) / atlas.width;
      const v1 = 1 - (row * 128) / atlas.height, v0 = 1 - ((row + 1) * 128) / atlas.height;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      sg.rotateY(ang + Math.PI / 2);
      sg.translate(st.x, Y_SIDEWALK + 2.6, st.z);
      signs.push(sg);
      const bg = new THREE.BoxGeometry(0.5, 0.5, 0.04);
      bg.rotateY(ang + Math.PI / 2);
      bg.translate(st.x, Y_SIDEWALK + 3.2, st.z);
      yellows.push(bg);
      // obstacle pensilina
      if (this.clearance(grp.position.x - st.dx * 3, grp.position.z - st.dz * 3, ['road'], 20) > 0.8) this.addObstacle(grp.position.x - st.dx * 3, grp.position.z - st.dz * 3, 2.6, 1.0, Math.atan2(-st.dz, st.dx), 'shelter');
      // segnaletica gialla della fermata (stile italiano): zig-zag all'ingresso e all'uscita,
      // linea tratteggiata lato corsia e la scritta BUS, leggibile da chi arriva
      const lx = st.cx + st.rx * (st.hw - 1.6), lz = st.cz + st.rz * (st.hw - 1.6);
      const y = Y_ROAD + 0.025;
      const p = (o, w) => [lx + st.dx * o + st.rx * w, y, lz + st.dz * o + st.rz * w];
      // o: lungo la strada (0 = palina), w: verso il marciapiede
      const WL = -1.1, WC = 1.3, LW = 0.07; // bordo lato corsia, bordo lato marciapiede, mezza larghezza linea
      const line = (o0, w0, o1, w1) => {
        const l = Math.hypot(o1 - o0, w1 - w0) || 1, no = -(w1 - w0) / l * LW, nw = (o1 - o0) / l * LW;
        marks.quad(p(o0 - no, w0 - nw), p(o0 + no, w0 + nw), p(o1 - no, w1 - nw), p(o1 + no, w1 + nw), [0, 0, 1, 0, 0, 1, 1, 1]);
      };
      const zig = (o0, o1) => { // tre "V" dal bordo corsia al marciapiede
        const n = 6, step = (o1 - o0) / n;
        for (let i = 0; i < n; i++) line(o0 + step * i, i % 2 ? WC : WL, o0 + step * (i + 1), i % 2 ? WL : WC);
      };
      const Z0 = -16, M0 = -11, M1 = 1, Z1 = 6;
      zig(Z0, M0);
      zig(M1, Z1);
      for (let o = M0 + 0.5; o < M1 - 0.4; o += 1.2) line(o, WL, Math.min(o + 0.6, M1), WL);
      // scritta BUS: il testo corre attraverso la corsia, le lettere guardano avanti
      const t0 = -6.2, t1 = -4.6;
      busText.quad(p(t0, WL + 0.3), p(t0, WC - 0.1), p(t1, WL + 0.3), p(t1, WC - 0.1), [0, 0, 1, 0, 0, 1, 1, 1]);
    }
    const atlasTex = TX.makeTex(atlas, false);
    this.group.add(new THREE.Mesh(mergeGeometries(signs), new THREE.MeshBasicMaterial({ map: atlasTex, side: THREE.DoubleSide })));
    this.group.add(new THREE.Mesh(mergeGeometries(yellows), yellow));
    const fm = new THREE.Mesh(mergeGeometries(frames), frame);
    fm.castShadow = true;
    this.group.add(fm, new THREE.Mesh(mergeGeometries(glasses), glass), new THREE.Mesh(mergeGeometries(benches), new THREE.MeshLambertMaterial({ color: 0x8a6a44 })));
    const ym = new THREE.Mesh(marks.build(), layer(new THREE.MeshLambertMaterial({ color: 0xf2c200 }), 4));
    this.group.add(ym);
    // texture della scritta BUS gialla (lettere allungate come la segnaletica orizzontale)
    const bc = document.createElement('canvas');
    bc.width = 256; bc.height = 128;
    const bx = bc.getContext('2d');
    bx.fillStyle = '#f2c200';
    bx.font = 'bold 120px Arial';
    bx.textAlign = 'center'; bx.textBaseline = 'middle';
    bx.fillText('BUS', 128, 68, 240);
    const bt = new THREE.Mesh(busText.build(), layer(new THREE.MeshLambertMaterial({ map: TX.makeTex(bc, false), transparent: true, alphaTest: 0.4, depthWrite: false }), 4));
    this.group.add(bt);
  }

  // ---- segnaletica verticale agli incroci (dopo i semafori: gli incroci semaforizzati non hanno cartelli) ----
  buildSigns() {
    const { nodes } = this.net;
    const fronts = [], backs = [], poles = [], lines = new GeoBuilder();
    this.stopSigns = [];
    this.signGrid = new Grid(60);
    const poleG = new THREE.CylinderGeometry(0.04, 0.04, 2.9, 6).translate(0, 1.45, 0);
    const rnd = (id, k) => { const v = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
    const rank = (e) => e.cls * 10 - Math.min(e.routes || 0, 9);
    const arrives = (e, n) => !e.oneway || (e.oneway === 1 ? e.b === n.id : e.a === n.id);
    const plate = (kind, x, y, z, ang, size) => {
      for (const back of [0, 1]) {
        const g = new THREE.PlaneGeometry(size, size);
        const u0 = ((back ? kind + 4 : kind) * 128) / 1024, u1 = u0 + 128 / 1024, uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) ? (back ? u0 : u1) : (back ? u1 : u0));
        g.rotateY(ang + (back ? Math.PI : 0));
        g.translate(x - Math.sin(ang) * (back ? 0.03 : -0.03), y, z - Math.cos(ang) * (back ? 0.03 : -0.03));
        (back ? backs : fronts).push(g);
      }
    };
    const y0 = Y_SIDEWALK, yl = Y_ROAD + 0.022;
    for (const n of Object.values(nodes)) {
      const deg = n.edges.length;
      if (deg < 3 || n.signal || n.edges.some((e) => e.elev || e.tunnel) || n.edges.every((e) => e.ped)) continue;
      const roundabout = n.edges.some((e) => e.roundabout);
      const best = Math.min(...n.edges.map(rank));
      const mainCls = Math.min(...n.edges.map((e) => e.cls));
      const hasCross = !roundabout && n.edges.filter((x) => x.main).length >= 3;
      n.edges.forEach((e, k) => {
        if (e.ped || e.service && e.cls >= 7 && !roundabout || !arrives(e, n)) return;
        let kind = -1;
        if (roundabout) { if (!e.roundabout) kind = 1; }
        else if (e.cls > mainCls && rank(e) > best + 5) kind = mainCls <= 2 && e.cls >= 5 && rnd(n.id, k) < 0.5 ? 0 : 1;
        else if (e.cls <= 3 && rank(e) === best && rnd(n.id, k + 7) < 0.25) kind = 3;
        if (kind < 0) return;
        const o = e.a === n.id ? 1 : -1, dx = e.dx * o, dz = e.dz * o; // verso l'esterno dell'incrocio
        const hw = e.width / 2, trim = n.trim ? n.trim.get(e) : n.radius;
        const at = trim + (hasCross ? 4.4 : 0.8);
        if (at > e.len * 0.6) return;
        // a destra di chi arriva: (dz, -dx)
        let px = 0, pz = 0, ok = false;
        for (const off of [hw + 0.8, hw + 1.6]) {
          px = n.x + dx * (at + 0.6) + dz * off; pz = n.z + dz * (at + 0.6) - dx * off;
          if (this.clearance(px, pz, ['road', 'tram'], 10) > 0.25) { ok = true; break; }
        }
        if (!ok) return;
        const ang = Math.atan2(dx, dz), h = (n.h || 0);
        poles.push(poleG.clone().translate(px, y0 + h, pz));
        plate(kind, px, y0 + h + (roundabout ? 2.45 : 2.3), pz, ang, 0.85);
        if (roundabout) plate(2, px, y0 + h + 1.65, pz, ang, 0.7);
        // linea di arresto (STOP) o tratteggio (precedenza) sulla corsia di chi arriva
        if (kind === 0 || kind === 1) {
          const w0 = e.oneway ? -hw + 0.3 : 0.1, w1 = hw - 0.3, lw = kind === 0 ? 0.25 : 0.15;
          const P = (a, w) => [n.x + dx * a + dz * w, yl + h, n.z + dz * a - dx * w];
          const seg = (a0, a1, wa, wb) => lines.quad(P(a0, wa), P(a0, wb), P(a1, wa), P(a1, wb), [0, 0, 1, 0, 0, 1, 1, 1]);
          if (kind === 0) seg(at - lw, at + lw, w1, w0);
          else for (let w = w0; w < w1 - 0.3; w += 1.0) seg(at - lw, at + lw, Math.min(w + 0.5, w1), w);
        }
        if (kind === 0) {
          const s = { x: n.x + dx * at + dz * hw / 2, z: n.z + dz * at - dx * hw / 2, dx: -dx, dz: -dz, hw };
          this.stopSigns.push(s);
          this.signGrid.insertAABB(s, s.x - 30, s.z - 30, s.x + 30, s.z + 30);
        }
      });
    }
    if (!poles.length) return;
    const tex = TX.signAtlas();
    this.group.add(new THREE.Mesh(mergeGeometries(fronts), new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 })));
    this.group.add(new THREE.Mesh(mergeGeometries(backs), new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 })));
    const pm = new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x8f9497 }));
    pm.castShadow = true;
    this.group.add(pm);
    if (lines.pos.length) this.group.add(new THREE.Mesh(lines.build(), layer(new THREE.MeshLambertMaterial({ color: 0xe8e8e0 }), 4)));
    this.signCount = fronts.length;
  }

  // ---- edifici ----
  // sulle strade percorse dai bus nessun ostacolo può invadere la carreggiata
  // (piccole imprecisioni di allineamento tra strade ed edifici OSM)
  clearBusRoads(tile = null) {
    const { nodes, edges } = this.net;
    let removed = 0;
    const q = [];
    const T = (this.tileSize || 400) / 2 + 80;
    for (const e of edges) {
      if (!e.routes) continue;
      const A = nodes[e.a];
      if (tile) { const B = nodes[e.b]; if (Math.abs((A.x + B.x) / 2 - tile.cx) > T || Math.abs((A.z + B.z) / 2 - tile.cz) > T) continue; }
      // corsia del bus: mezzeria (sensi unici) o metà destra, più la mezza larghezza del bus
      const r = Math.max(e.width / 2 - 0.3, (e.oneway ? 0 : e.width / 4) + 1.5);
      for (let s = 0; s <= e.len; s += 2) {
        const x = A.x + e.dx * s, z = A.z + e.dz * s;
        for (const b of this.obstacles.query(x, z, r + 2, q)) {
          if (b.dead || b.kind === 'car') continue;
          const lx = (x - b.x) * b.c + (z - b.z) * b.s, lz = -(x - b.x) * b.s + (z - b.z) * b.c;
          if (Math.hypot(Math.max(Math.abs(lx) - b.hx, 0), Math.max(Math.abs(lz) - b.hz, 0)) < r) { b.dead = true; removed++; }
        }
      }
    }
    // tratti di linea senza strada (salti dell'aggancio al confine della mappa): liberali comunque
    if (!tile) {
      for (const L of LINES) for (const v of L.variants) for (let i = 0; i < v.nodes.length - 1; i++) {
        if (this.net.edgeBetween(v.nodes[i], v.nodes[i + 1])) continue;
        const A = nodes[v.nodes[i]], B = nodes[v.nodes[i + 1]];
        const l = Math.hypot(B.x - A.x, B.z - A.z);
        for (let s = 0; s <= l; s += 2) {
          const x = A.x + ((B.x - A.x) * s) / l, z = A.z + ((B.z - A.z) * s) / l;
          for (const b of this.obstacles.query(x, z, 5, q)) {
            const lx = (x - b.x) * b.c + (z - b.z) * b.s, lz = -(x - b.x) * b.s + (z - b.z) * b.c;
            if (!b.dead && Math.hypot(Math.max(Math.abs(lx) - b.hx, 0), Math.max(Math.abs(lz) - b.hz, 0)) < 3) { b.dead = true; removed++; }
          }
        }
      }
    }
    this.clearedObstacles = (this.clearedObstacles || 0) + removed;
    if (!tile) this.busRoadsCleared = true;
  }

  // dentro l'area coperta dagli edifici OSM non si generano edifici procedurali
  inOsmArea(x, z) {
    const b = this.net.buildingBBox;
    return b && x > b[0] + 40 && x < b[2] - 40 && z > b[1] + 40 && z < b[3] - 40;
  }

  // edifici reali OSM: pianta estrusa, finestre procedurali, tetti piani, muri come ostacoli
  buildRealBuildings() {
    const list = this.net.buildings;
    if (!list || !list.length) return;
    this.realBuildingCount = list.length;
    // gli edifici sono divisi in riquadri da 400 m costruiti a richiesta (prima quelli vicini al bus)
    const T = (this.tileSize = 400);
    this.tiles = new Map();
    for (const b of list) {
      let cx = 0, cz = 0;
      for (const p of b.pts) { cx += p.x; cz += p.z; }
      b.cx = cx / b.pts.length; b.cz = cz / b.pts.length;
      const ix = Math.floor(b.cx / T), iz = Math.floor(b.cz / T), key = ix + ',' + iz;
      let t = this.tiles.get(key);
      if (!t) this.tiles.set(key, (t = { key, cx: (ix + 0.5) * T, cz: (iz + 0.5) * T, list: [], built: false, meshes: [] }));
      t.list.push(b);
    }
    this.bMat = makeBuildingMaterial(this.uniforms, true);
    this.rMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.tilesBuilt = 0;
    const p = this.net.landmarks.prato;
    if (p) this.ensureTiles(p.x, p.z, 700);
  }

  // costruisce subito i riquadri entro r metri (es. all'avvio o dopo un teletrasporto)
  ensureTiles(x, z, r) {
    if (!this.tiles) return;
    for (const t of this.tiles.values()) if (!t.built && Math.hypot(t.cx - x, t.cz - z) < r + this.tileSize * 0.71) this.buildTile(t);
  }

  // a ogni fotogramma: costruisce qualche riquadro in sottofondo e nasconde quelli lontani
  streamTiles(x, z, budgetMs = 6) {
    if (!this.tiles) return;
    const t0 = performance.now();
    if (!this._order || performance.now() - (this._orderT || 0) > 1500) {
      this._order = [...this.tiles.values()].filter((t) => !t.built).sort((a, b) => Math.hypot(a.cx - x, a.cz - z) - Math.hypot(b.cx - x, b.cz - z));
      this._orderT = performance.now();
    }
    while (this._order.length && performance.now() - t0 < budgetMs) {
      const t = this._order.shift();
      if (!t.built) this.buildTile(t);
    }
    for (const t of this.tiles.values()) {
      if (!t.built) continue;
      const vis = Math.hypot(t.cx - x, t.cz - z) < 2600;
      for (const m of t.meshes) m.visible = vis;
    }
  }

  buildTile(tile) {
    tile.built = true;
    this.tilesBuilt++;
    const W = { pos: [], nrm: [], col: [], seed: [], h: [] };
    const R = { pos: [], col: [] };
    const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
    const C = new THREE.Color();
    const specials = [];
    const ringArea2 = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.x * q.z - q.x * p.z; } return a; };
    for (const b of tile.list) {
      const pts = b.pts;
      if (pts.length < 3) continue;
      const holes = b.holes || [];
      const area2 = ringArea2(pts);
      const area = Math.abs(area2) / 2 - holes.reduce((s, h) => s + Math.abs(ringArea2(h)) / 2, 0);
      if (area < 4) continue;
      const cx = b.cx, cz = b.cz;
      const r = hash(cx, cz);
      const zone = zoneOf(cx, cz);
      const nm = b.name || '';
      const church = b.kind === 'church' || /church|cathedral|chapel|basilica/.test(b.kind) || /^(Chiesa|Basilica|Duomo|Cattedrale|Oratorio)/i.test(nm);
      let h = b.h || 9;
      let col;
      if (church) col = C.set(r < 0.5 ? 0xa45a3c : 0xd8c4a4);
      else if (b.kind === 'hospital') col = C.set(0xeeeeea);
      else if (b.kind === 'garage' || b.kind === 'garages' || b.kind === 'industrial' || b.kind === 'warehouse') col = C.set(0xb8b4ac).offsetHSL(0, 0, (r - 0.5) * 0.1);
      else { const pal = zone === 0 ? PAL_CENTRO : zone === 1 ? PAL_MID : PAL_OUT; col = C.set(pal[Math.floor(r * pal.length)]); }
      const special = /Sant'Antonio/i.test(nm) ? 'santo' : /Palazzo della Ragione/i.test(nm) ? 'ragione' : /Duomo|Cattedrale|Santa Maria Assunta/i.test(nm) && church ? 'duomo' : /Specola/i.test(nm) ? 'specola' : /Scrovegni/i.test(nm) ? 'scrovegni' : b.kind === 'train_station' || /Stazione di Padova/i.test(nm) ? 'stazione' : null;
      if (special === 'santo') { h = 24; col = C.set(0xa45a3c); }
      if (special === 'ragione') { h = 14; col = C.set(0xe2c9a2); }
      if (special === 'specola') { h = 40; col = C.set(0xa45a3c); }
      if (special === 'scrovegni') { h = 12; col = C.set(0xa45a3c); }
      if (special === 'stazione') { h = Math.max(h, 13); col = C.set(0xe6dfcf); }
      if (special) specials.push({ kind: special, pts, cx, cz, h, area });
      // muri: anello esterno con normali verso fuori, cortili con normali verso il cortile
      const rings = [[pts, false], ...holes.map((hr) => [hr, true])];
      for (const [ring, isHole] of rings) {
        const ccw = ringArea2(ring) > 0;
        const outwardFlip = ccw !== isHole; // vero se la normale (ez,-ex) va invertita
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          const ex = q.x - p.x, ez = q.z - p.z, l = Math.hypot(ex, ez);
          if (l < 0.05) continue;
          let nx = ez / l, nz = -ex / l;
          if (!outwardFlip) { nx = -nx; nz = -nz; }
          const v = [[p.x, 0, p.z], [q.x, 0, q.z], [q.x, h, q.z], [p.x, 0, p.z], [q.x, h, q.z], [p.x, h, p.z]];
          // ordine dei vertici coerente con la normale (faccia visibile dall'esterno del muro)
          const cr = (v[1][2] - v[0][2]) * 0 + ((v[1][0] - v[0][0]) * nz - (v[1][2] - v[0][2]) * nx);
          const order = cr > 0 ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4];
          for (const k of order) { W.pos.push(...v[k]); W.nrm.push(nx, 0, nz); W.col.push(col.r, col.g, col.b); W.seed.push(r); W.h.push(h); }
          this.addObstacle((p.x + q.x) / 2, (p.z + q.z) / 2, l / 2, 0.3, Math.atan2(-ez, ex), 'building');
        }
      }
      // tetto a padiglione sugli edifici quasi rettangolari senza cortile
      const flatKind = b.kind === 'industrial' || b.kind === 'warehouse' || b.kind === 'roof' || b.kind === 'garage' || b.kind === 'garages' || b.kind === 'commercial' || b.kind === 'retail';
      if (!special && !flatKind && !holes.length && pts.length <= 14 && area < 1600 && area > 25 && h < 24) {
        const o = minRect(pts);
        if (area / (o.L * o.Wd) > 0.8 && o.Wd > 4) {
          const tile2 = zone === 0 || r < 0.75;
          hipRoof(o, h, tile2 ? C.set([0xa4553a, 0xb0603f, 0x94503a, 0xb86d4b, 0x9c5a40][Math.floor(r * 5)]) : C.set(0x6f6a64), R);
          continue;
        }
      }
      // tetto piano (con i cortili)
      const contour = pts.map((p) => new THREE.Vector2(p.x, p.z));
      const hv = holes.map((hr) => hr.map((p) => new THREE.Vector2(p.x, p.z)));
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(contour, hv); } catch (e) { tris = []; }
      const all = [...contour, ...hv.flat()];
      const rc = zone === 0 && !church ? C.set([0xa4553a, 0xb0603f, 0x94503a, 0xb86d4b][Math.floor(r * 4)]) : church ? C.set(0x8c4a33) : C.set(0x77736c).offsetHSL(0, 0, (r - 0.5) * 0.1);
      for (const t of tris) {
        const [i0, i1, i2] = t;
        const A = all[i0], B = all[i1], Cc = all[i2];
        const sgn = (B.x - A.x) * (Cc.y - A.y) - (B.y - A.y) * (Cc.x - A.x);
        const ids = sgn > 0 ? [A, Cc, B] : [A, B, Cc];
        for (const P of ids) { R.pos.push(P.x, h, P.y); R.col.push(rc.r, rc.g, rc.b); }
      }
    }
    if (W.pos.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(W.pos, 3));
      wg.setAttribute('normal', new THREE.Float32BufferAttribute(W.nrm, 3));
      wg.setAttribute('color', new THREE.Float32BufferAttribute(W.col, 3));
      wg.setAttribute('aSeed', new THREE.Float32BufferAttribute(W.seed, 1));
      wg.setAttribute('aH', new THREE.Float32BufferAttribute(W.h, 1));
      const wm = new THREE.Mesh(wg, this.bMat);
      wm.castShadow = wm.receiveShadow = true;
      this.group.add(wm);
      tile.meshes.push(wm);
    }
    if (R.pos.length) {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(R.pos, 3));
      rg.setAttribute('color', new THREE.Float32BufferAttribute(R.col, 3));
      rg.computeVertexNormals();
      const rm = new THREE.Mesh(rg, this.rMat);
      rm.castShadow = rm.receiveShadow = true;
      this.group.add(rm);
      tile.meshes.push(rm);
    }
    if (specials.length) tile.meshes.push(...this.buildSpecials(specials));
    // le strade dei bus restano libere anche dagli edifici di questo riquadro
    if (this.busRoadsCleared) this.clearBusRoads(tile);
  }

  // decorazioni dei monumenti sulle piante reali
  buildSpecials(list) {
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const lead = lam(0x7d8a86), brick = lam(0xa45a3c);
    const made = [];
    const add = (m) => { m.castShadow = true; this.group.add(m); made.push(m); return m; };
    // rettangolo orientato minimo (asse lungo) di un poligono
    const obb = (pts) => {
      let best = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const a = Math.atan2(q.z - p.z, q.x - p.x), c = Math.cos(a), s = Math.sin(a);
        let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
        for (const v of pts) { const u = v.x * c + v.z * s, w = -v.x * s + v.z * c; mnx = Math.min(mnx, u); mxx = Math.max(mxx, u); mnz = Math.min(mnz, w); mxz = Math.max(mxz, w); }
        const ar = (mxx - mnx) * (mxz - mnz);
        if (!best || ar < best.ar) {
          const uc = (mnx + mxx) / 2, wc = (mnz + mxz) / 2;
          best = { ar, a, c, s, L: mxx - mnx, Wd: mxz - mnz, x: uc * c - wc * s, z: uc * s + wc * c };
        }
      }
      if (best.L < best.Wd) { best = { ...best, a: best.a + Math.PI / 2, L: best.Wd, Wd: best.L }; best.c = Math.cos(best.a); best.s = Math.sin(best.a); }
      return best;
    };
    const at = (o, u, w) => ({ x: o.x + u * o.c - w * o.s, z: o.z + u * o.s + w * o.c });
    for (const sp of list) {
      const o = obb(sp.pts);
      if (sp.kind === 'santo') {
        const domeG = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        const r = Math.min(13, o.Wd * 0.32);
        for (const [f, k, rr] of [[-0.3, 0, 1], [-0.08, 0, 1], [0.14, 0, 1], [0.34, 0, 1.2], [-0.3, 0.3, 0.55], [-0.3, -0.3, 0.55], [0.14, 0.3, 0.6], [0.14, -0.3, 0.6]]) {
          const p = at(o, f * o.L, k * o.Wd);
          const d = add(new THREE.Mesh(domeG, lead));
          d.scale.set(r * rr, r * rr * 1.25, r * rr);
          d.position.set(p.x, sp.h, p.z);
          const lan = add(new THREE.Mesh(new THREE.CylinderGeometry(r * rr * 0.15, r * rr * 0.15, r * rr * 0.6, 8), lead));
          lan.position.set(p.x, sp.h + r * rr * 1.25 + r * rr * 0.3, p.z);
        }
        for (const k of [-0.42, 0.42]) {
          const p = at(o, 0.24 * o.L, k * o.Wd);
          const t = add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 50, 12), brick));
          t.position.set(p.x, 25, p.z);
          const tip = add(new THREE.Mesh(new THREE.ConeGeometry(3, 10, 12), lead));
          tip.position.set(p.x, 55, p.z);
        }
      } else if (sp.kind === 'ragione') {
        const roof = add(new THREE.Mesh(new THREE.CylinderGeometry(o.Wd / 2, o.Wd / 2, o.L, 24, 1, false, 0, Math.PI), lead));
        roof.rotation.order = 'YXZ';
        roof.rotation.y = -o.a;
        roof.rotation.z = Math.PI / 2;
        roof.scale.set(1, 1, 0.9);
        roof.position.set(o.x, sp.h, o.z);
      } else if (sp.kind === 'duomo') {
        const p = at(o, 0.25 * o.L, 0);
        const d = add(new THREE.Mesh(new THREE.SphereGeometry(Math.min(12, o.Wd * 0.35), 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), lead));
        d.position.set(p.x, sp.h, p.z);
      } else if (sp.kind === 'stazione' && sp.area > 800) {
        // scritta PADOVA sulla facciata rivolta a sud (verso il piazzale)
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(22, o.L * 0.4), 2.4), new THREE.MeshBasicMaterial({ map: TX.labelTexture('PADOVA', { bg: '#dcd4c2', fg: '#1d3f8f', font: 'bold 92px Arial' }), side: THREE.DoubleSide }));
        const n = { x: -o.s, z: o.c };
        const sgn = n.z > 0 ? 1 : -1;
        sign.position.set(o.x + n.x * sgn * (o.Wd / 2 + 0.2), sp.h - 2, o.z + n.z * sgn * (o.Wd / 2 + 0.2));
        sign.rotation.y = Math.atan2(n.x * sgn, n.z * sgn);
        this.group.add(sign);
        made.push(sign);
      }
    }
    return made;
  }

  buildBuildings() {
    const { nodes, edges } = this.net;
    const rnd = this.rnd;
    const list = [];
    const roofs = [];
    const tryPlace = (x, z, dx, dz, w, d) => {
      const rx = -dz, rz = dx;
      for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const px = x + dx * (a * w) / 2 + rx * (b * d) / 2, pz = z + dz * (a * w) / 2 + rz * (b * d) / 2;
        if (this.clearance(px, pz) < SIDEWALK - 0.5) return false;
      }
      return true;
    };
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      if (e.elev) continue;
      const mA = A.joint ? 1 : A.radius + 6, mB = B.joint ? 1 : B.radius + 6;
      for (const side of [-1, 1]) {
        let s = mA;
        while (s < e.len - mB) {
          const mx = A.x + e.dx * s, mz = A.z + e.dz * s;
          const zone = zoneOf(mx, mz);
          if (this.inOsmArea(mx, mz) || e.ped || e.service) { s += 40; continue; }
          if (zone === 2 && (Math.hypot(mx - CENTRO.x, mz - CENTRO.z) > 5500 || rnd() < 0.45)) { s += 40; continue; }
          const w = zone === 0 ? 9 + rnd() * 10 : 12 + rnd() * 16;
          const gap = zone === 0 ? rnd() * 0.5 : 2 + rnd() * 10;
          if (zone === 2 && rnd() < 0.3) { s += w + gap + 10; continue; }
          for (let row = 0; row < (zone === 2 ? 1 : 2); row++) {
            const d = zone === 0 ? 11 + rnd() * 7 : 12 + rnd() * 12;
            const setback = zone === 0 ? 0.3 : 1.5 + rnd() * 7;
            const off = e.width / 2 + SIDEWALK + setback + d / 2 + row * (d + 6 + rnd() * 6);
            const cx = A.x + e.dx * (s + w / 2) + -e.dz * side * off;
            const cz = A.z + e.dz * (s + w / 2) + e.dx * side * off;
            if (!tryPlace(cx, cz, e.dx, e.dz, w, d)) continue;
            let h;
            if (zone === 0) h = 9 + Math.floor(rnd() * 4) * 3.1 + rnd();
            else if (zone === 1) h = rnd() < 0.12 ? 25 + rnd() * 20 : 9 + Math.floor(rnd() * 5) * 3.1;
            else h = rnd() < 0.08 ? 18 + rnd() * 12 : 6.5 + Math.floor(rnd() * 3) * 3.1;
            const pal = zone === 0 ? PAL_CENTRO : zone === 1 ? PAL_MID : PAL_OUT;
            const col = new THREE.Color(pal[Math.floor(rnd() * pal.length)]);
            col.offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
            const ang = Math.atan2(-e.dz, e.dx);
            list.push({ x: cx, z: cz, w, d, h, ang, col });
            this.addObstacle(cx, cz, w / 2, d / 2, ang);
            if (zone === 0 || (zone === 2 && h < 12 && rnd() < 0.7) || (zone === 1 && h < 20 && rnd() < 0.4)) roofs.push({ x: cx, z: cz, w, d, h, ang });
          }
          s += w + gap;
        }
      }
    }
    // riempimento degli isolati: griglia delle distanze dalle strade (BFS) e palazzi orientati
    // come la strada più vicina, fino a una certa distanza a seconda della zona
    this.fillerTrees = [];
    {
      const C = 24;
      const xs = Object.values(nodes).map((n) => n.x), zs = Object.values(nodes).map((n) => n.z);
      const minX = Math.max(-7000, Math.min(...xs) - 300), maxX = Math.min(7000, Math.max(...xs) + 300);
      const minZ = Math.max(-7000, Math.min(...zs) - 300), maxZ = Math.min(7000, Math.max(...zs) + 300);
      const W = Math.ceil((maxX - minX) / C), H = Math.ceil((maxZ - minZ) / C);
      const dist = new Int16Array(W * H).fill(-1);
      const src = new Int32Array(W * H).fill(-1);
      const queue = new Int32Array(W * H);
      let qh = 0, qt = 0;
      for (const e of edges) {
        const A = nodes[e.a];
        for (let t = 0; t <= e.len; t += C / 2) {
          const gx = Math.floor((A.x + e.dx * t - minX) / C), gz = Math.floor((A.z + e.dz * t - minZ) / C);
          if (gx < 0 || gz < 0 || gx >= W || gz >= H) continue;
          const k = gz * W + gx;
          if (dist[k] === -1) { dist[k] = 0; src[k] = e.id; queue[qt++] = k; }
        }
      }
      while (qh < qt) {
        const k = queue[qh++];
        const gx = k % W, gz = (k / W) | 0, d = dist[k];
        if (d >= 18) continue;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = gx + ox, nz = gz + oz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          const nk = nz * W + nx;
          if (dist[nk] !== -1) continue;
          dist[nk] = d + 1; src[nk] = src[k]; queue[qt++] = nk;
        }
      }
      for (let gz = 0; gz < H; gz++)
        for (let gx = 0; gx < W; gx++) {
          const k = gz * W + gx, d = dist[k];
          if (d < 1) continue;
          const x = minX + (gx + 0.5) * C + (rnd() - 0.5) * 5, z = minZ + (gz + 0.5) * C + (rnd() - 0.5) * 5;
          const zone = zoneOf(x, z);
          const maxD = zone === 0 ? 18 : zone === 1 ? 9 : 3;
          const prob = zone === 0 ? 0.9 : zone === 1 ? 0.5 : 0.18;
          if (zone === 2 && Math.hypot(x - CENTRO.x, z - CENTRO.z) > 5500) continue;
          if (this.inOsmArea(x, z)) continue;
          if (d > maxD || rnd() > prob) continue;
          const be = edges[src[k]];
          if (zone === 2 && rnd() < 0.35) { this.fillerTrees.push({ x, z, big: true }); continue; }
          const w = zone === 0 ? 12 + rnd() * 9 : 12 + rnd() * 12;
          const dd = zone === 0 ? 11 + rnd() * 8 : 10 + rnd() * 12;
          if (!tryPlace(x, z, be.dx, be.dz, w, dd)) continue;
          const obs = this.obstacles.query(x, z, 18, this._oq || (this._oq = []));
          let overlap = false;
          for (const b of obs) if (b.kind === 'building' && circleVsOBB(x, z, Math.min(w, dd) * 0.45, b)) { overlap = true; break; }
          if (overlap) continue;
          let h;
          if (zone === 0) h = 9 + Math.floor(rnd() * 4) * 3.1 + rnd();
          else if (zone === 1) h = rnd() < 0.15 ? 24 + rnd() * 22 : 9 + Math.floor(rnd() * 5) * 3.1;
          else h = rnd() < 0.06 ? 16 + rnd() * 10 : 6.5 + Math.floor(rnd() * 3) * 3.1;
          const pal = zone === 0 ? PAL_CENTRO : zone === 1 ? PAL_MID : PAL_OUT;
          const col = new THREE.Color(pal[Math.floor(rnd() * pal.length)]);
          col.offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
          const ang = Math.atan2(-be.dz, be.dx);
          list.push({ x, z, w, d: dd, h, ang, col });
          this.addObstacle(x, z, w / 2, dd / 2, ang);
          if (zone === 0 || (zone === 2 && h < 12 && rnd() < 0.7) || (zone === 1 && h < 20 && rnd() < 0.4)) roofs.push({ x, z, w, d: dd, h, ang });
        }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = makeBuildingMaterial(this.uniforms);
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    list.forEach((b, i) => {
      Q.setFromAxisAngle(Y, b.ang);
      M.compose(P.set(b.x, 0, b.z), Q, S.set(b.w, b.h, b.d));
      inst.setMatrixAt(i, M);
      inst.setColorAt(i, b.col);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.group.add(inst);
    this.buildingCount = list.length;

    // tetti a falde in coppi
    const rg = roofPrism();
    const rInst = new THREE.InstancedMesh(rg, new THREE.MeshLambertMaterial({ color: 0xffffff }), roofs.length);
    const roofCols = ['#a4553a', '#b0603f', '#94503a', '#b86d4b', '#8c4632'];
    roofs.forEach((b, i) => {
      Q.setFromAxisAngle(Y, b.ang);
      M.compose(P.set(b.x, b.h, b.z), Q, S.set(b.w + 0.6, Math.min(b.d * 0.3, 4.5), b.d + 0.6));
      rInst.setMatrixAt(i, M);
      rInst.setColorAt(i, new THREE.Color(roofCols[i % roofCols.length]));
    });
    rInst.castShadow = true;
    this.group.add(rInst);
  }

  // ---- alberi e lampioni ----
  buildTreesAndLamps() {
    const { nodes, edges } = this.net;
    const rnd = this.rnd;
    const trees = [...(this.pratoTrees || []), ...(this.fillerTrees || [])];
    const lamps = [];
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      if (e.elev) continue;
      // lampioni
      let k = e.id;
      const zoneE = zoneOf(A.x, A.z);
      const lampStep = zoneE === 2 ? 75 : 40;
      if (zoneE === 2 && !e.main && rnd() < 0.6) continue;
      const mA = A.joint ? 2 : A.radius + 8, mB = B.joint ? 2 : B.radius + 4;
      for (let s = mA + ((e.id * 17) % lampStep); s < e.len - mB; s += lampStep, k++) {
        const side = k % 2 ? 1 : -1;
        const off = e.width / 2 + 1.9;
        const x = A.x + e.dx * s + -e.dz * side * off, z = A.z + e.dz * s + e.dx * side * off;
        if (this.clearance(x, z, ['road', 'tram']) < 1.6) continue;
        lamps.push({ x, z, ang: Math.atan2(e.dx, e.dz), side });
        this.addObstacle(x, z, 0.18, 0.18, 0, 'pole');
      }
      // alberi (viali fuori dal centro)
      for (let s = mA + 4; s < e.len - mB - 2; s += 13 + rnd() * 9) {
        const mx = A.x + e.dx * s, mz = A.z + e.dz * s;
        const zone = zoneOf(mx, mz);
        if (zone === 0 && rnd() < 0.85) continue;
        if (rnd() < 0.35) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        const off = e.width / 2 + 2.4;
        const x = mx + -e.dz * side * off, z = mz + e.dx * side * off;
        if (this.clearance(x, z, ['road', 'tram']) < 1.8) continue;
        if (Math.hypot(...lamps.length ? [lamps[lamps.length - 1].x - x, lamps[lamps.length - 1].z - z] : [99, 99]) < 4) continue;
        trees.push({ x, z });
        this.addObstacle(x, z, 0.35, 0.35, 0, 'tree');
      }
    }
    // alberi sparsi nei parchi/campagna
    for (let i = 0; i < 2500; i++) {
      const x = (rnd() - 0.5) * 9000, z = (rnd() - 0.5) * 9000;
      if (this.clearance(x, z) < 8) continue;
      trees.push({ x, z, big: true });
    }
    const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
    trunkG.translate(0, 1.5, 0);
    const crownG = new THREE.IcosahedronGeometry(2.4, 1);
    crownG.translate(0, 4.6, 0);
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x5a4330 }), trees.length);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      const s = (t.big ? 1.1 : 0.8) + rnd() * 0.6;
      Q.setFromAxisAngle(Y, rnd() * 6.28);
      M.compose(P.set(t.x, 0, t.z), Q, S.set(s, s * (0.9 + rnd() * 0.3), s));
      trunks.setMatrixAt(i, M);
      crowns.setMatrixAt(i, M);
      col.setHSL(0.22 + rnd() * 0.08, 0.35 + rnd() * 0.2, 0.22 + rnd() * 0.12);
      crowns.setColorAt(i, col);
    });
    trunks.castShadow = crowns.castShadow = true;
    this.group.add(trunks, crowns);

    // lampioni
    const poleG = new THREE.CylinderGeometry(0.08, 0.12, 8, 6);
    poleG.translate(0, 4, 0);
    const armG = new THREE.BoxGeometry(0.08, 0.08, 1.8);
    armG.translate(0, 7.9, 0.8);
    const pg = mergeGeometries([poleG, armG]);
    const headG = new THREE.BoxGeometry(0.4, 0.15, 0.8);
    headG.translate(0, 7.85, 1.6);
    const poles = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ color: 0x4a4f55 }), lamps.length);
    this.lampMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, emissive: 0xffd08a, emissiveIntensity: 0 });
    const heads = new THREE.InstancedMesh(headG, this.lampMat, lamps.length);
    lamps.forEach((l, i) => {
      // il braccio punta verso la strada
      Q.setFromAxisAngle(Y, l.ang + (l.side > 0 ? -Math.PI / 2 : Math.PI / 2));
      M.compose(P.set(l.x, Y_SIDEWALK, l.z), Q, S.set(1, 1, 1));
      poles.setMatrixAt(i, M);
      heads.setMatrixAt(i, M);
    });
    poles.castShadow = true;
    this.group.add(poles, heads);
    this.lampPositions = lamps;
    // pozze di luce dei lampioni (decal additivi)
    const poolTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,210,140,0.9)');
      g.addColorStop(1, 'rgba(255,210,140,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const poolG = new THREE.PlaneGeometry(14, 14);
    poolG.rotateX(-Math.PI / 2);
    this.poolMat = layer(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }), 5);
    const pools = new THREE.InstancedMesh(poolG, this.poolMat, lamps.length);
    lamps.forEach((l, i) => {
      const ox = Math.sin(l.ang + (l.side > 0 ? -Math.PI / 2 : Math.PI / 2)) * 2.5, oz = Math.cos(l.ang + (l.side > 0 ? -Math.PI / 2 : Math.PI / 2)) * 2.5;
      M.makeTranslation(l.x + ox, Y_ROAD + 0.04, l.z + oz);
      pools.setMatrixAt(i, M);
    });
    pools.renderOrder = 2;
    this.group.add(pools);
  }

  setNight(f, wet = 0) {
    this.uniforms.uNight.value = f;
    this.lampMat.emissiveIntensity = f * 1.4;
    this.poolMat.opacity = f * 0.55;
    this.poolMat.visible = f > 0.02;
    this.roadMat.color.setScalar(1 - wet * 0.35);
    if (this.owMat) this.owMat.color.setScalar(1 - wet * 0.35);
  }

  update(dt) {
    if (this.waterTex) this.waterTex.offset.x += dt * 0.01;
  }
}

function drawSignCell(x, ox, oy, name, lines) {
  x.fillStyle = '#f2c200';
  x.fillRect(ox, oy, 256, 64);
  x.fillStyle = '#0b3d91';
  x.fillRect(ox, oy + 64, 256, 64);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const fit = (t, size, maxW) => { let sz = size; x.font = `bold ${sz}px Arial`; while (x.measureText(t).width > maxW && sz > 10) { sz -= 1; x.font = `bold ${sz}px Arial`; } };
  x.fillStyle = '#1a1a1a';
  fit(name, 30, 240);
  x.fillText(name, ox + 128, oy + 33);
  x.fillStyle = '#ffffff';
  fit(lines, 40, 240);
  x.fillText(lines, ox + 128, oy + 97);
}

// rettangolo orientato di area minima (asse lungo = L) di un poligono
export function minRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const a = Math.atan2(q.z - p.z, q.x - p.x), c = Math.cos(a), s = Math.sin(a);
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const v of pts) { const u = v.x * c + v.z * s, w = -v.x * s + v.z * c; mnx = Math.min(mnx, u); mxx = Math.max(mxx, u); mnz = Math.min(mnz, w); mxz = Math.max(mxz, w); }
    const ar = (mxx - mnx) * (mxz - mnz);
    if (!best || ar < best.ar) {
      const uc = (mnx + mxx) / 2, wc = (mnz + mxz) / 2;
      best = { ar, a, c, s, L: mxx - mnx, Wd: mxz - mnz, x: uc * c - wc * s, z: uc * s + wc * c };
    }
  }
  if (best.L < best.Wd) { best = { ...best, a: best.a + Math.PI / 2, L: best.Wd, Wd: best.L }; best.c = Math.cos(best.a); best.s = Math.sin(best.a); }
  return best;
}

// tetto a padiglione (o a quattro falde) sopra un rettangolo orientato, con sporgenza
function hipRoof(o, h, col, R, over = 0.35) {
  const L = o.L / 2 + over, W = o.Wd / 2 + over;
  const rh = Math.min(5, Math.max(1.6, o.Wd * 0.34));
  const rl = Math.max(0, L - W);
  const P = (u, w, y) => [o.x + u * o.c - w * o.s, y, o.z + u * o.s + w * o.c];
  const c0 = P(-L, -W, h), c1 = P(L, -W, h), c2 = P(L, W, h), c3 = P(-L, W, h);
  const r0 = P(-rl, 0, h + rh), r1 = P(rl, 0, h + rh);
  // facce con normale verso l'alto/esterno (ordine antiorario visto dall'esterno)
  const tris = [[c0, r1, c1], [c0, r0, r1], [c2, r0, c3], [c2, r1, r0], [c1, r1, c2], [c3, r0, c0]];
  for (const t of tris) {
    // assicura la normale verso l'alto
    const ux = t[1][0] - t[0][0], uy = t[1][1] - t[0][1], uz = t[1][2] - t[0][2];
    const vx = t[2][0] - t[0][0], vy = t[2][1] - t[0][1], vz = t[2][2] - t[0][2];
    const ny = uz * vx - ux * vz;
    const tt = ny >= 0 ? t : [t[0], t[2], t[1]];
    for (const p of tt) { R.pos.push(p[0], p[1], p[2]); R.col.push(col.r, col.g, col.b); }
  }
}

function segIntersect(a, b, c, d) {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

// prisma per tetto a due falde: base 1x1 (x,z in -0.5..0.5), colmo lungo x a quota 1
function roofPrism() {
  const v = [
    // falda sud
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    // falda nord
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    // timpani
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
