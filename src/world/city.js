import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid, distToSeg, mulberry32, circleVsOBB } from './spatial.js';
import * as TX from './textures.js';
import { allStopPlacements } from '../game/routes.js';

export const Y_ROAD = 0.14;
const Y_SIDEWALK = 0.1;
const SIDEWALK = 4;

// strati coplanari: spinge in avanti nel depth buffer (evita z-fighting)
export function layer(mat, n) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -n;
  mat.polygonOffsetUnits = -n * 2;
  return mat;
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
export function makeBuildingMaterial(uniforms) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vSeed; varying float vH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
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
        float fyy = vWP.y / 3.1;
        float flo = floor(fyy);
        float fxx = tw / 3.4 + vSeed * 7.0;
        vec2 ff = fract(vec2(fxx, fyy));
        float win = step(0.24, ff.x) * step(ff.x, 0.76) * step(0.34, ff.y) * step(ff.y, 0.84);
        float shop = step(0.06, ff.x) * step(ff.x, 0.94) * step(0.04, ff.y) * step(ff.y, 0.72);
        win = flo < 0.5 ? shop * step(0.45, vSeed) : win;
        win *= isWall * step(vWP.y, vH - 0.6);
        // cornicione e marcapiano
        float band = isWall * (1.0 - step(0.06, fract(fyy))) * 0.25;
        diffuseColor.rgb *= 1.0 - band;
        float roof = step(0.5, nW.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45 + vec3(0.06), roof);
        float shade = h31(vec3(floor(fxx), flo, vSeed));
        vec3 glass = mix(vec3(0.10, 0.13, 0.17), vec3(0.30, 0.36, 0.42), shade * (1.0 - uNight));
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.92);
        float lit = step(0.52, shade) * uNight * win;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += lit * mix(vec3(1.0, 0.78, 0.42), vec3(0.75, 0.85, 1.0), step(0.85, shade)) * 0.85;`);
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
    this.obstacles = new Grid(40);
    this.obstacleCount = 0;
    this.zones = [];
    this.nightMats = [];
    this.lampPositions = [];
    this.indexFeatures();
    this.buildGround();
    this.buildRoads();
    this.buildWater();
    this.buildRailway();
    this.buildLandmarks();
    this.buildStops();
    this.buildBuildings();
    this.buildTreesAndLamps();
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
    const { nodes, edges, water, railway } = this.net;
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      this.addSeg(A.x, A.z, B.x, B.z, e.width / 2, 'road', e);
    }
    for (const n of Object.values(nodes)) {
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
    for (const w of water) for (let i = 0; i < w.pts.length - 1; i++) this.addSeg(w.pts[i].x, w.pts[i].z, w.pts[i + 1].x, w.pts[i + 1].z, w.width / 2 + 6, 'water', w);
    for (let i = 0; i < railway.length - 1; i++) this.addSeg(railway[i].x, railway[i].z, railway[i + 1].x, railway[i + 1].z, 9, 'rail');
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
    return best;
  }

  // ---- terreno ----
  buildGround() {
    const tex = TX.groundTexture();
    tex.repeat.set(160, 160);
    const g = new THREE.PlaneGeometry(16000, 16000, 128, 128); // suddiviso: triangoli enormi danno problemi di profondità
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ---- strade ----
  buildRoads() {
    const { nodes, edges } = this.net;
    const road = new GeoBuilder();
    const walk = new GeoBuilder();
    const curb = [];
    const inter = [], walkDisc = [];
    const marks = new GeoBuilder();
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      const ra = A.joint ? 0 : A.radius * 0.6, rb = B.joint ? 0 : B.radius * 0.6;
      const ax = A.x + e.dx * ra, az = A.z + e.dz * ra, bx = B.x - e.dx * rb, bz = B.z - e.dz * rb;
      const hFn = e.elev ? (x, z) => edgeHeight(e, (x - A.x) * e.dx + (z - A.z) * e.dz) : null;
      road.ribbon(ax, az, bx, bz, e.width, Y_ROAD, 12, 0, hFn);
      walk.ribbon(A.x, A.z, B.x, B.z, e.width + (e.elev ? 2 : SIDEWALK * 2), Y_SIDEWALK, 6, 0, hFn);
      if (e.elev) { this.buildOverpass(e, A, curb); continue; }
      // strisce pedonali vicino agli incroci
      for (const [N, dirSign] of [[A, 1], [B, -1]]) {
        if (N.edges.length < 3 || N.edges.filter((x) => x.main).length < 3) continue;
        const base = N.radius + 1.2;
        for (let k = -e.width / 2 + 0.6; k < e.width / 2 - 0.4; k += 1.0) {
          const cx = N.x + e.dx * dirSign * (base + 2) + -e.dz * k, cz = N.z + e.dz * dirSign * (base + 2) + e.dx * k;
          const hx = e.dx * 1.7, hz = e.dz * 1.7, wx = -e.dz * 0.25, wz = e.dx * 0.25;
          marks.quad([cx - hx - wx, Y_ROAD + 0.02, cz - hz - wz], [cx - hx + wx, Y_ROAD + 0.02, cz - hz + wz], [cx + hx - wx, Y_ROAD + 0.02, cz + hz - wz], [cx + hx + wx, Y_ROAD + 0.02, cz + hz + wz], [0, 0, 1, 0, 0, 1, 1, 1]);
        }
      }
    }
    const joints = [];
    for (const n of Object.values(nodes)) {
      if (n.joint && n.bend < 0.02) continue;
      const seg = n.joint ? 12 : 28;
      // nelle curve il disco sta sotto l'asfalto e riempie solo lo spicchio tra i due tratti
      (n.joint ? joints : inter).push(disc(n.x, n.z, n.radius, Y_ROAD + (n.joint ? -0.005 : 0.01) + (n.h || 0), seg, 20));
      walkDisc.push(disc(n.x, n.z, n.radius + SIDEWALK + (n.joint ? 0 : 2), Y_SIDEWALK - 0.005 + (n.h || 0), seg, 6));
    }
    const roadTex = TX.roadTexture();
    const roadMat = layer(new THREE.MeshLambertMaterial({ map: roadTex }), 2);
    this.roadMat = roadMat;
    const rm = new THREE.Mesh(road.build(), roadMat);
    rm.receiveShadow = true;
    const im = new THREE.Mesh(mergeGeometries(inter), layer(new THREE.MeshLambertMaterial({ map: TX.intersectionTexture() }), 3));
    if (joints.length) {
      const jm = new THREE.Mesh(mergeGeometries(joints), layer(new THREE.MeshLambertMaterial({ map: TX.intersectionTexture(), color: 0xf4f4f4 }), 1.5));
      jm.receiveShadow = true;
      this.group.add(jm);
    }
    im.receiveShadow = true;
    const swTex = TX.sidewalkTexture();
    const swMat = layer(new THREE.MeshLambertMaterial({ map: swTex }), 1);
    const wm = new THREE.Mesh(mergeGeometries([walk.build().toNonIndexed(), ...walkDisc.map((g) => g.toNonIndexed())]), swMat);
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

  buildRailway() {
    const t = TX.railTexture();
    const g = polyRibbon(this.net.railway, 14, 0.06, 14);
    this.group.add(new THREE.Mesh(g, layer(new THREE.MeshLambertMaterial({ map: t }), 1)));
    // pali della linea aerea
    const poles = [];
    const pts = this.net.railway;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s < l; s += 50) {
        const x = a.x + ((b.x - a.x) * s) / l, z = a.z + ((b.z - a.z) * s) / l;
        if (this.clearance(x, z, ['road']) < 3) continue;
        const p = new THREE.BoxGeometry(0.3, 7, 0.3);
        p.translate(x + ((b.z - a.z) / l) * 7.5, 3.5, z - ((b.x - a.x) / l) * 7.5);
        poles.push(p);
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
    fit('santo', 56, 24); fit('ragione', 42, 16); fit('orologio', 12, 7); fit('duomo', 36, 18);
    fit('specola', 9, 9); fit('scrovegni', 8, 16); fit('ospedale', 62, 52); fit('fiera', 66, 46);
    this.stationLen = 0;
    for (const len of [200, 160, 120, 90]) if (fit('stazione', len / 2 + 2, 11, { maxShift: 140 })) { this.stationLen = len; break; }
    this.landmarkFit = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.scale]));
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

    // Basilica del Santo
    if (L.santo.scale) {
      const c = L.santo;
      this.zones.push({ x: c.x, z: c.z, rx: 70, rz: 40 });
      box(100, 24, 42, brick, c.x, 12, c.z);
      box(8, 30, 34, brick, c.x - 50, 15, c.z); // facciata
      // cupole
      const domeG = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const domes = [[-25, 0, 12], [-5, 0, 12], [15, 0, 12], [35, 0, 15], [5, 13, 8], [5, -13, 8], [-25, 13, 6], [-25, -13, 6]];
      for (const [dx, dz, r] of domes) {
        const dm = new THREE.Mesh(domeG, lead);
        dm.scale.set(r, r * 1.25, r);
        dm.position.set(c.x + dx, 24, c.z + dz);
        add(dm);
        const lan = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.15, r * 0.15, r * 0.6, 8), lead);
        lan.position.set(c.x + dx, 24 + r * 1.25 + r * 0.3, c.z + dz);
        add(lan);
      }
      // campanili a minareto
      for (const dz of [-17, 17]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 50, 12), brick);
        t.position.set(c.x + 30, 25, c.z + dz);
        add(t);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(3, 10, 12), lead);
        tip.position.set(c.x + 30, 55, c.z + dz);
        add(tip);
      }
      this.addObstacle(c.x, c.z, 54, 22, 0, 'landmark');
    }

    // Palazzo della Ragione (tetto a carena di nave)
    if (L.ragione.scale) {
      const c = L.ragione;
      this.zones.push({ x: c.x, z: c.z, rx: 55, rz: 30 });
      box(80, 14, 27, lam(0xe2c9a2), c.x, 7, c.z);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 80, 24, 1, false, 0, Math.PI), lead);
      roof.rotation.z = Math.PI / 2;
      roof.rotation.y = Math.PI / 2;
      roof.scale.set(1, 1, 0.9);
      roof.position.set(c.x, 14, c.z);
      add(roof);
      // logge
      box(82, 6, 2, lam(0xf0e4cc), c.x, 3, c.z - 14.5);
      box(82, 6, 2, lam(0xf0e4cc), c.x, 3, c.z + 14.5);
      this.addObstacle(c.x, c.z, 41, 15, 0, 'landmark');
    }

    // Torre dell'Orologio
    if (L.orologio.scale) {
      const c = L.orologio;
      this.zones.push({ x: c.x, z: c.z, rx: 18, rz: 18 });
      box(22, 14, 12, lam(0xead9b8), c.x, 7, c.z);
      box(8, 32, 8, lam(0xead9b8), c.x, 16, c.z);
      const face = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), lam(0x1a3b7a));
      face.position.set(c.x, 22, c.z + 4.05);
      add(face);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(5, 5, 4), lead);
      crown.rotation.y = Math.PI / 4;
      crown.position.set(c.x, 34.5, c.z);
      add(crown);
    }

    // Duomo
    if (L.duomo.scale) {
      const c = L.duomo;
      this.zones.push({ x: c.x, z: c.z, rx: 45, rz: 30 });
      box(70, 22, 34, lam(0xd8c4a4), c.x, 11, c.z, 0.1);
      const dm = new THREE.Mesh(new THREE.SphereGeometry(11, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), lead);
      dm.position.set(c.x + 15, 22, c.z);
      add(dm);
      box(9, 40, 9, brick, c.x - 30, 20, c.z + 22);
    }

    // Specola
    if (L.specola.scale) {
      const c = L.specola;
      this.zones.push({ x: c.x, z: c.z, rx: 20, rz: 20 });
      box(15, 42, 15, brick, c.x, 21, c.z);
      box(9, 6, 9, stone, c.x, 45, c.z);
      this.addObstacle(c.x, c.z, 8, 8, 0, 'landmark');
    }

    // Cappella degli Scrovegni ed Eremitani
    if (L.scrovegni.scale) {
      const c = L.scrovegni;
      this.zones.push({ x: c.x, z: c.z, rx: 30, rz: 40 });
      box(10, 11, 30, brick, c.x, 5.5, c.z);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 30, 3, 1), lam(0x8c4a33));
      r.rotation.x = Math.PI / 2;
      r.rotation.z = Math.PI / 2;
      r.scale.set(1, 1, 0.5);
      r.position.set(c.x, 12.5, c.z);
      add(r);
      const gt = TX.grassTexture();
      gt.repeat.set(4, 4);
      const g = new THREE.Mesh(new THREE.CircleGeometry(38, 24), layer(new THREE.MeshLambertMaterial({ map: gt }), 1));
      g.rotation.x = -Math.PI / 2;
      g.position.set(c.x, 0.06, c.z);
      this.group.add(g);
      this.addObstacle(c.x, c.z, 5, 15, 0, 'landmark');
    }

    // Stazione FS: fabbricato davanti al piazzale reale (corsie e tram vengono dal GTFS) e fascio binari
    if (this.stationLen) {
      const c = L.stazione, LEN = this.stationLen;
      this.zones.push({ x: c.x, z: c.z - 30, rx: LEN / 2 + 40, rz: 60 });
      const trav = lam(0xe6dfcf), glassD = lam(0x2b3a46), steel = lam(0x5d646b), plat = lam(0xbdb6a8);
      box(LEN, 12, 18, trav, c.x, 6, c.z);
      box(LEN + 0.4, 2.6, 18.4, glassD, c.x, 8.4, c.z);
      box(Math.min(56, LEN * 0.4), 17, 22, lam(0xdcd4c2), c.x, 8.5, c.z);
      const hw = Math.min(48, LEN * 0.34);
      const hall = new THREE.Mesh(new THREE.PlaneGeometry(hw, 10.5), new THREE.MeshLambertMaterial({ color: 0x3b5870 }));
      hall.position.set(c.x, 6.2, c.z + 11.06);
      this.group.add(hall);
      for (let x = -hw / 2; x <= hw / 2 + 0.1; x += hw / 8) box(0.35, 10.5, 0.3, steel, c.x + x, 6.2, c.z + 11.1).castShadow = false;
      const clock = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), lam(0xfafafa));
      clock.position.set(c.x, 13.4, c.z + 11.07);
      this.group.add(clock);
      for (const [w, h, r] of [[0.12, 1.3, 0.6], [0.1, 1.7, 2.4]]) {
        const hand = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lam(0x111111));
        hand.geometry.translate(0, h / 2, 0);
        hand.position.set(c.x, 13.4, c.z + 11.09);
        hand.rotation.z = r;
        this.group.add(hand);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(22, 2.4), new THREE.MeshBasicMaterial({ map: TX.labelTexture('PADOVA', { bg: '#dcd4c2', fg: '#1d3f8f', font: 'bold 92px Arial' }) }));
      sign.position.set(c.x, 15.6, c.z + 11.07);
      this.group.add(sign);
      box(LEN, 0.35, 6, steel, c.x, 5.2, c.z + 12);
      for (let x = -LEN / 2 + 5; x <= LEN / 2 - 5; x += 19) box(0.3, 5, 0.3, steel, c.x + x, 2.6, c.z + 14.6);
      this.addObstacle(c.x, c.z, LEN / 2, 9.5, 0, 'landmark');
      // binari dietro al fabbricato, con marciapiedi coperti e un treno regionale
      const rt = TX.railTexture();
      rt.repeat.set(2, 1);
      const yard = polyRibbon([{ x: c.x - LEN / 2 - 60, z: c.z - 40 }, { x: c.x + LEN / 2 + 60, z: c.z - 40 }], 44, 0.07, 14);
      this.group.add(new THREE.Mesh(yard, layer(new THREE.MeshLambertMaterial({ map: rt }), 1)));
      for (const dz of [-24, -44]) {
        box(LEN, 0.9, 5, plat, c.x, 0.45, c.z + dz);
        box(LEN - 20, 0.25, 6, steel, c.x, 4.4, c.z + dz);
        for (let x = -LEN / 2 + 15; x <= LEN / 2 - 15; x += 15) box(0.25, 3.6, 0.25, steel, c.x + x, 2.6, c.z + dz);
      }
      const coach = lam(0xf2f2ee), band = lam(0x223040), blue = lam(0x1f6fb2), roofM = lam(0x9aa0a6);
      for (let k = 0; k < Math.min(4, Math.floor(LEN / 27)); k++) {
        const x = c.x - LEN / 2 + 20 + k * 26;
        box(25, 3.2, 2.9, coach, x, 2.2, c.z - 34);
        box(25.05, 0.95, 2.95, band, x, 2.6, c.z - 34);
        box(25.05, 0.35, 2.95, blue, x, 1.3, c.z - 34);
        box(24.6, 0.3, 2.6, roofM, x, 3.9, c.z - 34);
      }
    }

    // Ospedale
    if (L.ospedale.scale) {
      const c = L.ospedale;
      this.zones.push({ x: c.x, z: c.z, rx: 90, rz: 70 });
      box(110, 28, 26, lam(0xeeeeea), c.x, 14, c.z - 25, 0.4);
      box(80, 36, 22, lam(0xe3e6e8), c.x + 10, 18, c.z + 25, 0.4);
      const cross = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: TX.labelTexture('+', { w: 128, h: 128, bg: '#ffffff', fg: '#d01010', font: 'bold 120px Arial' }) }));
      cross.position.set(c.x - 10, 30, c.z - 11.8);
      cross.rotation.y = 0.4;
      this.group.add(cross);
      this.addObstacle(c.x, c.z - 25, 55, 13, 0.4, 'landmark');
      this.addObstacle(c.x + 10, c.z + 25, 40, 11, 0.4, 'landmark');
    }

    // Fiera
    if (L.fiera.scale) {
      const c = L.fiera;
      this.zones.push({ x: c.x, z: c.z, rx: 80, rz: 55 });
      box(60, 12, 90, lam(0xb9bcc0), c.x - 35, 6, c.z);
      box(60, 14, 90, lam(0xa9aeb4), c.x + 35, 7, c.z);
      box(8, 60, 8, lam(0x8899aa), c.x, 30, c.z + 50);
      this.addObstacle(c.x, c.z, 65, 45, 0, 'landmark');
    }
  }

  // ---- fermate (scenografia per tutte le linee) ----
  buildStops() {
    this.stopPlacements = allStopPlacements(this.net, (x, z) => this.snapToRoad(x, z));
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fc4d6, transparent: true, opacity: 0.35 });
    const frame = new THREE.MeshLambertMaterial({ color: 0x2b3a4a });
    const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c200 });
    const poleG = new THREE.CylinderGeometry(0.05, 0.05, 3, 8);
    const marks = new GeoBuilder();
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
      // segnaletica gialla "BUS" sulla corsia
      const lx = st.cx + st.rx * (st.hw - 1.6), lz = st.cz + st.rz * (st.hw - 1.6);
      const y = Y_ROAD + 0.025;
      const L0 = -16, L1 = 6;
      for (const [o0, o1, w0, w1] of [[L0, L1, -1.4, -1.25], [L0, L1, 1.25, 1.4], [L0, L0 + 0.15, -1.4, 1.4], [L1 - 0.15, L1, -1.4, 1.4]]) {
        const p = (o, w) => [lx + st.dx * o + st.rx * w, y, lz + st.dz * o + st.rz * w];
        marks.quad(p(o0, w0), p(o0, w1), p(o1, w0), p(o1, w1), [0, 0, 1, 0, 0, 1, 1, 1]);
      }
    }
    const atlasTex = TX.makeTex(atlas, false);
    this.group.add(new THREE.Mesh(mergeGeometries(signs), new THREE.MeshBasicMaterial({ map: atlasTex, side: THREE.DoubleSide })));
    this.group.add(new THREE.Mesh(mergeGeometries(yellows), yellow));
    const fm = new THREE.Mesh(mergeGeometries(frames), frame);
    fm.castShadow = true;
    this.group.add(fm, new THREE.Mesh(mergeGeometries(glasses), glass), new THREE.Mesh(mergeGeometries(benches), new THREE.MeshLambertMaterial({ color: 0x8a6a44 })));
    const ym = new THREE.Mesh(marks.build(), layer(new THREE.MeshLambertMaterial({ color: 0xf2c200 }), 4));
    this.group.add(ym);
  }

  // ---- edifici ----
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
        if (this.clearance(x, z, ['road']) < 1.6) continue;
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
        if (this.clearance(x, z, ['road']) < 1.8) continue;
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
