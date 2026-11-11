import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid, distToSeg, mulberry32, circleVsOBB } from './spatial.js';
import * as TX from './textures.js';
import { allStopPlacements } from '../game/routes.js';
import { LINES, TRAM_LINES, laneLayout, laneSpan, parseBuilding } from '../data/padova.js';
import { AREA_SIZE, AREA_KEYS, areaData, requestArea, dropArea, areaKeysNear, loadAllAreas } from '../data/aree.js';
import { TrackPath, TRAM, CATENARY_HEIGHT, TramTrack, tramLength } from '../tram/tram.js';
import { TRAM_STOP_AHEAD } from '../game/routes.js';
import { applyTerrain } from './terrain.js';

export const Y_ROAD = 0.14;
export const TRAM_HW = 3.4; // metà larghezza della sede del tram (due corsie rosse e rotaia centrale)
const Y_SIDEWALK = 0.1;
const Y_GREEN = 0.05; // prati e aiuole del DBGT, sopra il prato generico e sotto i marciapiedi
const SIDEWALK = 4;
// aree a richiesta (src/data/aree.js): si scaricano entro AREA_NEAR metri dal bus, si liberano oltre AREA_FAR
const AREA_NEAR = 1500, AREA_FAR = 2600;

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
  // nastro lungo una spezzata (pts: [{x, z}]) con giunti a cuneo: i tratti consecutivi non si sovrappongono (niente
  // z-fighting) e le righe di bordo girano senza tacche. u: 0 sinistra -> 1 destra, v continua lungo la spezzata
  strip(pts, w, y, vScale = 12, shift = 0) {
    const n = pts.length, off = [], nrm = [];
    if (n < 2) return;
    const perp = (a, b) => { const l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return [-(b.z - a.z) / l, (b.x - a.x) / l]; };
    for (let i = 0; i < n; i++) {
      const p1 = i > 0 ? perp(pts[i - 1], pts[i]) : null, p2 = i < n - 1 ? perp(pts[i], pts[i + 1]) : null;
      let [mx, mz] = p1 || p2, k = 1;
      if (p1 && p2) {
        mx = p1[0] + p2[0]; mz = p1[1] + p2[1];
        const l = Math.hypot(mx, mz) || 1;
        mx /= l; mz /= l;
        k = 1 / Math.max(0.6, mx * p2[0] + mz * p2[1]);
      }
      off.push([(mx * k * w) / 2, (mz * k * w) / 2]);
      nrm.push([mx * k * shift, mz * k * shift]);
    }
    let v = 0;
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z), m = Math.max(1, Math.ceil(l / 40));
      // shift: spostamento laterale dell'asse (righe di bordo), con lo stesso giunto a cuneo
      const at = (t) => [a.x + (b.x - a.x) * t + nrm[i][0] + (nrm[i + 1][0] - nrm[i][0]) * t, a.z + (b.z - a.z) * t + nrm[i][1] + (nrm[i + 1][1] - nrm[i][1]) * t, off[i][0] + (off[i + 1][0] - off[i][0]) * t, off[i][1] + (off[i + 1][1] - off[i][1]) * t];
      for (let s = 0; s < m; s++) {
        const [x0, z0, ox0, oz0] = at(s / m), [x1, z1, ox1, oz1] = at((s + 1) / m);
        const va = v + (l * s) / m / vScale, vb = v + (l * (s + 1)) / m / vScale;
        this.quad([x0 - ox0, y, z0 - oz0], [x0 + ox0, y, z0 + oz0], [x1 - ox1, y, z1 - oz1], [x1 + ox1, y, z1 + oz1], [0, va, 1, va, 0, vb, 1, vb]);
      }
      v += l / vScale;
    }
  }
  // poligono con buchi (anelli piatti [x0, z0, x1, z1, ...]) triangolato, faccia in su, uv in coordinate del mondo
  polygon(rings, y, uvScale = 20) {
    const V = (f) => { const out = []; for (let i = 0; i < f.length; i += 2) out.push(new THREE.Vector2(f[i], f[i + 1])); return out; };
    const contour = V(rings[0]), holes = rings.slice(1).map(V);
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (err) { return; }
    const all = [contour, ...holes].flat(), b = this.pos.length / 3;
    for (const p of all) { this.pos.push(p.x, y, p.y); this.uv.push(p.x / uvScale, p.y / uvScale); }
    for (const [i0, i1, i2] of tris) {
      const A = all[i0], B = all[i1], C = all[i2];
      const sgn = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
      if (sgn > 0) this.idx.push(b + i0, b + i2, b + i1); else this.idx.push(b + i0, b + i1, b + i2);
    }
  }
  // come polygon, con la quota di ogni vertice da yFn(x, z). Con maxEdge i triangoli si dividono a metà del lato più
  // lungo finché nessun lato supera maxEdge: la superficie segue il profilo della rampa invece di tagliarlo a corda
  // (l'impalcato del Camerini, con un lato di 170 m, spuntava sopra l'asfalto). Il punto di mezzo di un lato è unico
  // per i due triangoli che lo hanno, e ogni lato più lungo di maxEdge lo dividono tutti e due: niente fessure
  polygonH(rings, yFn, uvScale = 20, maxEdge = 0) {
    const b = this.pos.length / 3, t0 = this.idx.length;
    this.polygon(rings, 0, uvScale);
    const P = this.pos;
    for (let i = b * 3; i < P.length; i += 3) P[i + 1] = yFn(P[i], P[i + 2]);
    if (!maxEdge) return;
    const tris = this.idx.splice(t0), mid = new Map(), L2 = maxEdge * maxEdge;
    const d2 = (i, j) => (P[3 * i] - P[3 * j]) ** 2 + (P[3 * i + 2] - P[3 * j + 2]) ** 2;
    const half = (i, j) => {
      const k = i < j ? i + ',' + j : j + ',' + i;
      let m = mid.get(k);
      if (m === undefined) {
        const x = (P[3 * i] + P[3 * j]) / 2, z = (P[3 * i + 2] + P[3 * j + 2]) / 2;
        m = P.length / 3;
        P.push(x, yFn(x, z), z);
        this.uv.push(x / uvScale, z / uvScale);
        mid.set(k, m);
      }
      return m;
    };
    const todo = [];
    for (let i = 0; i < tris.length; i += 3) todo.push([tris[i], tris[i + 1], tris[i + 2]]);
    while (todo.length) {
      const [a, c, e] = todo.pop(), ac = d2(a, c), ce = d2(c, e), ea = d2(e, a), l = Math.max(ac, ce, ea);
      if (l <= L2) { this.idx.push(a, c, e); continue; }
      // stesso verso di rotazione nei due triangoli nuovi
      if (l === ac) { const m = half(a, c); todo.push([a, m, e], [m, c, e]); }
      else if (l === ce) { const m = half(c, e); todo.push([a, c, m], [a, m, e]); }
      else { const m = half(e, a); todo.push([a, c, m], [m, c, e]); }
    }
  }
  // corona circolare (rotatorie): u 0 bordo esterno -> 1 interno, v lungo la circonferenza (stesso verso dei nastri)
  annulus(cx, cz, r0, r1, y, seg = 48, vScale = 12) {
    const L = 2 * Math.PI * ((r0 + r1) / 2);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, va = (L * i) / seg / vScale, vb = (L * (i + 1)) / seg / vScale;
      const P = (a, r) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      this.quad(P(a0, r1), P(a0, r0), P(a1, r1), P(a1, r0), [0, va, 1, va, 0, vb, 1, vb]);
    }
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

// sponde di un corso d'acqua: due fasce, una per lato, dal bordo dell'acqua (1 m sotto) a 8 m fuori. Un nastro unico
// largo quanto il fiume più le sponde, con i vertici solo ai bordi, col terreno faceva da coperchio sopra l'alveo
function bankStrips(pts, w, y) {
  const b = new GeoBuilder(), geos = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1], l = Math.hypot(c.x - a.x, c.z - a.z) || 1, nx = -(c.z - a.z) / l, nz = (c.x - a.x) / l;
    for (const s of [1, -1]) {
      const o = s * (w / 2 + 3.5);
      b.ribbon(a.x + nx * o, a.z + nz * o, c.x + nx * o, c.z + nz * o, 9, y, 20, 0);
    }
  }
  geos.push(b.build());
  for (let i = 1; i < pts.length - 1; i++) geos.push(disc(pts[i].x, pts[i].z, w / 2 + 8, y, 20, 20));
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
        // portici: misurati (seme negativo = altezza libera) dove il DBGT li ha, altrimenti a caso nel centro storico
        float misurato = step(vSeed, -0.5);
        float pH = mix(3.9, -vSeed, misurato);
        float portico = isWall * step(vWP.y, pH) * max(misurato, centro * step(0.0, vSeed) * step(vSeed, 0.42) * step(7.0, vH));
        float fx4 = fract(tw / 4.2 + vSeed * 3.0);
        float ax = (fx4 - 0.5) / 0.36;
        float archTop = pH * 0.64 + pH * 0.26 * sqrt(max(0.0, 1.0 - ax * ax));
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
    applyTerrain(sh);
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
    for (const step of ['indexFeatures', 'buildGround', 'buildRoads', 'buildWater', 'buildRailway', 'buildTramway', 'buildDeckJoins', 'buildDecks', 'buildLandmarks', 'buildStops', 'buildRealBuildings', 'buildBuildings', 'buildTreesAndLamps', 'clearBusRoads']) {
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
    // sede del tram: attorno all'asse dei due binari, o attorno a ogni binario (binari OSM)
    const thw = this.net.tramLanes ? TRAM.lane + 0.3 : TRAM_HW;
    for (const t of this.net.tram || []) for (let i = 0; i < t.length - 1; i++) this.addSeg(t[i].x, t[i].z, t[i + 1].x, t[i + 1].z, thw, 'tram');
    for (const T of this.net.tramLines || []) for (const t of T.lanes) for (let i = 0; i < t.length - 1; i++) this.addSeg(t[i].x, t[i].z, t[i + 1].x, t[i + 1].z, TRAM.lane + 0.3, 'tram');
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
    if (this.asphRings) {
      // con la pianta delle strade conta il bordo vero dell'asfalto; vie pedonali e impalcati in quota restano a nastro
      let off = this.surfaceOff(x, z);
      for (const it of arr) if (it.kind === 'road' && it.ref && (it.ref.ped || it.ref.elev)) off = Math.min(off, distToSeg(x, z, it.ax, it.az, it.bx, it.bz).d - it.hw);
      best.off = off;
      return best;
    }
    if (best.off > -0.3 && this.jctGrid) {
      const jq = this.jctGrid.query(x, z, 1, this._qj || (this._qj = []));
      for (const it of jq) if (pointInPoly(x, z, it.pts)) { best.off = -0.3; break; }
    }
    return best;
  }

  // ---- terreno ----
  // prato: una griglia che segue la telecamera, a maglie di 10 m fino a 1 km (le celle del terreno) e via via più
  // larghe fino a 12 km, così le quote del terreno (vertex shader) si vedono anche sul suolo
  buildGround() {
    const tex = TX.groundTexture();
    const D = [0];
    for (let d = 10; D[D.length - 1] < 12000; ) { D.push(d); d += d < 1000 ? 10 : Math.max(10, Math.round(d * 0.06 / 10) * 10); }
    const C = [...D.slice(1).reverse().map((d) => -d), ...D], n = C.length;
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = C[i]; pos[k * 3 + 2] = C[j];
      uv[k * 2] = C[i] / 100; uv[k * 2 + 1] = -C[j] / 100;
      if (i < n - 1 && j < n - 1) idx.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    // il prato è lo sfondo di tutto: si disegna per primo e non nasconde niente (con il terreno le carreggiate, che
    // hanno meno vertici, possono passare qualche centimetro sotto il prato)
    const mat = new THREE.MeshLambertMaterial({ map: tex, depthWrite: false });
    // il prato segue la quota di strade ed edifici (alvei riempiti): solo acqua e sponde scendono nell'alveo
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.renderOrder = -0.5;
    this.ground = m;
    this.group.add(m);
  }
  // il prato segue la telecamera a passi di 10 m (i vertici restano sulle celle del terreno, la trama sul posto)
  followGround(x, z) {
    if (!this.ground) return;
    const cx = Math.round(x / 10) * 10, cz = Math.round(z / 10) * 10;
    this.ground.position.set(cx, 0, cz);
    this.ground.material.map.offset.set((cx / 100) % 1, (-cz / 100) % 1);
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
    const style = (e) => (e.ped ? ped : e.cls >= 5 && !e.routes ? plain : e.oneway ? roadOw : road);
    // righe tra le corsie da disegnare: tutte dove OSM dice lane_markings=yes, altrimenti sulle strade principali e sui
    // percorsi dei bus (non su piazzali, capolinea e parcheggi, né nelle rotatorie); quelle gialle delle corsie dei bus
    // sempre, anche con lane_markings=no
    const painted = (e) => {
      if (e.ped || e.roundabout) return [];
      const m = e.osmLanes ? e.osmLanes.mark : 0, all = m === 1 || (m === 0 && !e.service && style(e) !== plain);
      return laneLayout(e).lines.filter((l) => all || l.kind === 'bus');
    };
    // corsie viste da chi percorre l'arco partendo dal nodo from: i tratti di una catena devono averle uguali
    const laneKey = (e, from) => {
      const lay = laneLayout(e), fw = from === e.a, ln = painted(e);
      const ls = fw ? lay.lanes : lay.lanes.slice().reverse();
      return ls.map((l) => (l.d > 0 === fw ? '>' : '<') + (l.bus ? 'b' : '')).join('') + (fw ? ln : ln.slice().reverse()).map((l) => l.kind).join();
    };
    const trimAt = (N, e) => (N.joint ? 0 : N.trim ? N.trim.get(e) : N.radius * 0.6);
    const walkW = (e) => e.width + (e.elev ? 2 : e.service ? 2.4 : SIDEWALK * 2);
    // con la pianta delle strade (net.surfaces) asfalto, marciapiedi e isole sono aree: qui restano le righe e i
    // tratti in quota; senza, il vecchio disegno a nastri, dischi e ventagli
    const surf = !!this.net.surfaces;
    const lines = new GeoBuilder();
    const yellow = new GeoBuilder(); // righe delle corsie riservate ai bus
    const paint = new GeoBuilder(), paintBus = new GeoBuilder(); // frecce a terra e scritte BUS (atlante TX.roadMarkAtlas)
    const dashes = (pts, on, period) => {
      const out = [];
      let s = 0, cur = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z);
        for (let t = 0; t < l; ) {
          const ph = s % period, inDash = ph < on, step = Math.min(l - t, inDash ? on - ph : period - ph);
          const p0 = { x: a.x + ((b.x - a.x) * t) / l, z: a.z + ((b.z - a.z) * t) / l }, p1 = { x: a.x + ((b.x - a.x) * (t + step)) / l, z: a.z + ((b.z - a.z) * (t + step)) / l };
          if (inDash) { if (!cur) { cur = [p0]; out.push(cur); } cur.push(p1); } else cur = null;
          t += step; s += step;
        }
      }
      return out.filter((d) => d.length > 1);
    };
    // riga tra due corsie lungo pts: tratteggio urbano 3 + 3 m (art. 138), continua dove il sorpasso è vietato, gialla e
    // più larga accanto alle corsie dei bus; put(builder, tratto, larghezza) la disegna spostata di lato
    const laneLine = (ln, pts, put) => {
      const bus = ln.kind === 'bus', dashed = ln.kind === 'dash' || ln.kind === 'center';
      for (const d of dashed ? dashes(pts, 3, 6) : [pts]) put(bus ? yellow : lines, d, bus ? 0.25 : ln.kind.startsWith('center') ? 0.13 : 0.12);
    };
    // segno dipinto a terra (cella dell'atlante) centrato in (cx, cz), nel verso di marcia (dx, dz): w di traverso, len
    // lungo la strada
    const markQuad = (g, cx, cz, dx, dz, w, len, cell) => {
      const hx = (dx * len) / 2, hz = (dz * len) / 2, wx = (-dz * w) / 2, wz = (dx * w) / 2, y = Y_ROAD + 0.016, u0 = cell / 8, u1 = (cell + 1) / 8;
      g.quad([cx - hx - wx, y, cz - hz - wz], [cx - hx + wx, y, cz - hz + wz], [cx + hx - wx, y, cz + hz - wz], [cx + hx + wx, y, cz + hz + wz], [u0, 0, u1, 0, u0, 1, u1, 1]);
    };
    // scritta BUS sulle corsie riservate: all'inizio del tratto e ogni 70 m, leggibile da chi le percorre
    const busWriting = (pts, lay) => {
      if (!lay.lanes.some((l) => l.bus)) return;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      const tot = cum[cum.length - 1];
      const at = (s) => {
        let i = 0;
        while (i < pts.length - 2 && cum[i + 1] < s) i++;
        const a = pts[i], b = pts[i + 1], l = cum[i + 1] - cum[i] || 1, t = (s - cum[i]) / l;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l };
      };
      for (const l of lay.lanes) {
        if (!l.bus) continue;
        for (let s = 6; s + 4.5 <= tot - 4; s += 70) {
          const p = at(l.d > 0 ? s + 2.25 : tot - s - 2.25);
          markQuad(paintBus, p.x - p.dz * l.off, p.z + p.dx * l.off, p.dx * l.d, p.dz * l.d, Math.min(2.2, lay.w - 0.6), 4.5, TX.MARK_CELL.bus);
        }
      }
    };
    // frecce a terra da turn:lanes: punta 6 m prima dell'incrocio o delle strisce pedonali (art. 147), più un'altra 30 m
    // prima se il tratto è lungo. Le corsie di OSM sono da sinistra a destra per chi guida
    const turnCell = (v) => {
      const k = new Set();
      for (const t of (v || '').split(';')) if (!t.startsWith('merge')) k.add(t.endsWith('left') ? 'left' : t.endsWith('right') ? 'right' : t);
      return TX.MARK_CELL[['left', 'through', 'right'].filter((t) => k.has(t)).join(';')];
    };
    const turnArrows = (e, A, B) => {
      const lay = laneLayout(e);
      for (const [list, d] of [[e.turn.f, 1], [e.turn.b, -1]]) {
        if (!list) continue;
        const mine = lay.lanes.filter((l) => l.d === d);
        if (d < 0) mine.reverse();
        if (mine.length !== list.length) continue;
        const from = d > 0 ? trimAt(A, e) : trimAt(B, e);
        let end = e.len - (d > 0 ? trimAt(B, e) : trimAt(A, e));
        for (const c of e.cross) { const sc = d > 0 ? c : e.len - c; if (sc > e.len / 2) end = Math.min(end, sc - 2); }
        for (const tip of [end - 6, end - 36]) {
          if (tip - 4.5 < from + 2) break;
          const s = d > 0 ? tip - 2.25 : e.len - tip + 2.25, px = A.x + e.dx * s, pz = A.z + e.dz * s;
          mine.forEach((l, i) => {
            const cell = turnCell(list[i]);
            if (cell !== undefined) markQuad(paint, px - e.dz * l.off, pz + e.dx * l.off, e.dx * d, e.dz * d, 1.8, 4.5, cell);
          });
        }
      }
    };
    // dossi (art. 179): fascia a strisce gialle e nere di traverso, 0,6 m (1,2 quelli lunghi); cuscini: un cuscino per
    // corsia che i bus scavalcano; attraversamenti e vie rialzate: denti bianchi sulle rampe, con la punta verso l'alto.
    // Ogni rampa o dosso va anche in bumpGrid (bumpHit): sev è lo scossone, lim la velocità che non dà fastidio
    this.bumpGrid = new Grid(40);
    const bumpY = new GeoBuilder(), bumpK = new GeoBuilder();
    const CALM = [{ sev: 1, lim: 25, len: 0.6 }, { sev: 0.7, lim: 30, len: 1.2 }, { sev: 0.3, lim: 40, len: 2.4 }, { sev: 0.6, lim: 30 }, { sev: 0.6, lim: 30 }];
    const calmingAt = (e, A, s, c) => {
      const hw = e.width / 2 - 0.3, rx = -e.dz, rz = e.dx, y = Y_ROAD + 0.018, kd = CALM[c.kind];
      const P = (t, w) => [A.x + e.dx * t + rx * w, y, A.z + e.dz * t + rz * w];
      const band = (t, len, w0, w1) => {
        for (let w = w0, k = 0; w < w1 - 0.05; w += 0.5, k++) (k % 2 ? bumpK : bumpY).quad(P(t - len / 2, w), P(t - len / 2, Math.min(w + 0.5, w1)), P(t + len / 2, w), P(t + len / 2, Math.min(w + 0.5, w1)), [0, 0, 1, 0, 0, 1, 1, 1]);
      };
      // denti con la punta verso dir (+1 nel verso a -> b) a partire da t
      const teeth = (t, dir) => {
        for (let w = -hw + 0.2; w < hw - 0.6; w += 1.0) {
          const b0 = P(t, w), b1 = P(t, w + 0.6), tip = P(t + dir * 0.8, w + 0.3);
          paintTri.push(...(dir > 0 ? [b0, b1, tip] : [b1, b0, tip]));
        }
      };
      const ramp = (t) => {
        const x = A.x + e.dx * t, z = A.z + e.dz * t, it = { x, z, rx, rz, hw: hw + 0.3, sev: kd.sev, lim: kd.lim };
        this.bumpGrid.insertAABB(it, x - hw - 1, z - hw - 1, x + hw + 1, z + hw + 1);
      };
      if (c.kind <= 1) { band(s, kd.len, -hw, hw); ramp(s); }
      else if (c.kind === 2) { for (const l of laneLayout(e).lanes) band(s, kd.len, l.off - 0.85, l.off + 0.85); ramp(s); }
      else if (c.kind === 3) for (const d of [-1, 1]) { teeth(s + d * 3.3, -d); ramp(s + d * 2.7); }
      else { teeth(s, c.up); ramp(s); }
    };
    const paintTri = [];
    // rotatorie ad anello chiuso e quasi circolari: corona d'asfalto, marciapiede solo fuori, isola al centro
    const rings = this.findRoundabouts();
    // Catene: i tratti consecutivi della stessa via (nodo intermedio con due archi, stesso tipo e larghezza, curva
    // fino a ~100°) diventano un nastro unico con giunti a cuneo, al posto di nastri dritti sovrapposti
    const chained = new Set();
    const link = (n, e) => {
      if (!n.joint || n.bend > 1.2) return null;
      const f = n.edges[0] === e ? n.edges[1] : n.edges[0];
      if (!f || f === e || f.elev || chained.has(f) || style(f) !== style(e) || Math.abs(f.width - e.width) > 0.05 || walkW(f) !== walkW(e) || f.roundabout !== e.roundabout) return null;
      if (laneKey(f, n.id) !== laneKey(e, e.a === n.id ? e.b : e.a)) return null;
      return f;
    };
    for (const e0 of edges) {
      if (e0.elev || chained.has(e0)) continue;
      chained.add(e0);
      const walkFrom = (n0, e1) => {
        const out = [];
        let n = n0, e = e1;
        for (;;) {
          const f = link(n, e);
          if (!f) return { out, end: n, edge: e };
          chained.add(f);
          n.inChain = true;
          out.push(n);
          n = nodes[f.a === n.id ? f.b : f.a];
          e = f;
        }
      };
      const back = walkFrom(nodes[e0.a], e0), fwd = walkFrom(nodes[e0.b], e0);
      const pts = [back.end, ...back.out.reverse(), ...fwd.out, fwd.end].map((n) => ({ x: n.x, z: n.z }));
      // accorciata agli incroci (raccordi dell'incrocio)
      const trim = (p, q, r) => { const l = Math.hypot(q.x - p.x, q.z - p.z) || 1, t = Math.min(r, l - 0.1) / l; return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t }; };
      const road2 = pts.slice();
      road2[0] = trim(pts[0], pts[1], trimAt(back.end, back.edge));
      road2[road2.length - 1] = trim(pts[pts.length - 1], pts[pts.length - 2], trimAt(fwd.end, fwd.edge));
      if (surf) {
        // righe tra le corsie (mezzeria, divisorie, corsie dei bus) e scritte BUS; le righe di bordo seguono il bordo
        // dell'asfalto (buildSurfaces)
        if (!e0.ped && !e0.roundabout) {
          for (const ln of painted(e0)) laneLine(ln, road2, (g, d, w) => g.strip(d, w, Y_ROAD + 0.012, 1, ln.off));
          busWriting(road2, laneLayout(e0));
        }
        continue;
      }
      style(e0).strip(road2, e0.width, Y_ROAD, e0.ped ? 6 : 12);
      if (!e0.ped && !e0.roundabout) walk.strip(pts, walkW(e0), Y_SIDEWALK, 6);
    }
    if (surf) {
      // rotatorie: asfalto, isola e righe (bordo esterno e riga dell'isola) vengono dalla pianta, anche quelle ellittiche
      this.roundabouts = rings;
      this.buildSurfaces();
    } else {
      for (const g of rings) {
        roadOw.annulus(g.cx, g.cz, g.r - g.w / 2, g.r + g.w / 2, Y_ROAD + 0.004, 56);
        walk.annulus(g.cx, g.cz, g.r + g.w / 2 - 0.5, g.r + g.w / 2 + SIDEWALK, Y_SIDEWALK - 0.003, 56, 6);
      }
      this.buildRoundaboutIslands(rings);
    }
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      if (e.elev) {
        let ra = trimAt(A, e), rb = trimAt(B, e);
        if (ra + rb > e.len - 0.2) { const k = Math.max(0, e.len - 0.2) / (ra + rb); ra *= k; rb *= k; }
        const hFn = (x, z) => edgeHeight(e, (x - A.x) * e.dx + (z - A.z) * e.dz);
        if (surf && this.net.surfaces.up) {
          // asfalto in quota e righe di bordo dalla pianta delle strade (buildSurfaces): qui la mezzeria, alla quota della
          // rampa, e le pile
          for (const ln of painted(e)) {
            const ox = -e.dz * ln.off, oz = e.dx * ln.off;
            laneLine(ln, [{ x: A.x, z: A.z }, { x: B.x, z: B.z }], (g, d, w) => g.ribbon(d[0].x + ox, d[0].z + oz, d[d.length - 1].x + ox, d[d.length - 1].z + oz, w, Y_ROAD + 0.012, 1, 0, hFn));
          }
          this.buildOverpass(e, A, curb);
          continue;
        }
        style(e).ribbon(A.x + e.dx * ra, A.z + e.dz * ra, B.x - e.dx * rb, B.z - e.dz * rb, e.width, Y_ROAD, e.ped ? 6 : 12, 0, hFn);
        // con la pianta delle strade niente marciapiede sui tratti in quota: sulle rampe sembrava un'ala lastricata
        if (!e.ped && !surf) walk.ribbon(A.x, A.z, B.x, B.z, walkW(e), Y_SIDEWALK, 6, 0, hFn);
        this.buildOverpass(e, A, curb);
        continue;
      }
      // strisce pedonali: dove sono in OSM (fuori dal poligono dell'incrocio), altrimenti vicino agli incroci principali
      // e.cross: metri dal nodo a, servono anche per la linea d'arresto dei cartelli
      e.cross = [];
      if (this.net.crossings) {
        const lo = A.trim ? A.trim.get(e) + 2 : 1.7, hi = e.len - (B.trim ? B.trim.get(e) + 2 : 1.7);
        if (!e.roundabout && hi >= lo) for (const s of this.net.crossings.get(e) || []) e.cross.push(Math.min(hi, Math.max(lo, s)));
      } else {
        for (const [N, dirSign] of [[A, 1], [B, -1]]) {
          if (e.roundabout || N.edges.length < 3 || N.edges.filter((x) => x.main).length < 3) continue;
          const base = (N.trim ? N.trim.get(e) - 1.2 : N.radius) + 1.2;
          e.cross.push(dirSign > 0 ? base + 2 : e.len - base - 2);
        }
      }
      for (const s of e.cross) {
        for (let k = -e.width / 2 + 0.6; k < e.width / 2 - 0.4; k += 1.0) {
          const cx = A.x + e.dx * s + -e.dz * k, cz = A.z + e.dz * s + e.dx * k;
          const hx = e.dx * 1.7, hz = e.dz * 1.7, wx = -e.dz * 0.25, wz = e.dx * 0.25;
          marks.quad([cx - hx - wx, Y_ROAD + 0.02, cz - hz - wz], [cx - hx + wx, Y_ROAD + 0.02, cz - hz + wz], [cx + hx - wx, Y_ROAD + 0.02, cz + hz - wz], [cx + hx + wx, Y_ROAD + 0.02, cz + hz + wz], [0, 0, 1, 0, 0, 1, 1, 1]);
        }
      }
      if (surf && e.turn && !(e.osmLanes && e.osmLanes.mark === 2)) turnArrows(e, A, B);
      if (this.net.calming && this.net.calming.has(e)) {
        // fuori dagli incroci, come le strisce pedonali
        const lo = (A.trim ? A.trim.get(e) : 0) + 1.5, hi = e.len - (B.trim ? B.trim.get(e) : 0) - 1.5;
        if (hi >= lo) for (const c of this.net.calming.get(e)) calmingAt(e, A, Math.min(hi, Math.max(lo, c.s)), c);
      }
    }
    const inter = new GeoBuilder(), joints = new GeoBuilder(), walkDisc = new GeoBuilder();
    for (const n of Object.values(nodes)) {
      // i nodi interni a una catena sono già coperti dal nastro unico; con la pianta delle strade servono solo in quota,
      // e nemmeno lì se la pianta ha anche l'asfalto in quota (i ventagli degli incroci sulle rampe uscivano di decine di
      // metri: lastricato sopra la Rotonda Rosetta Molinari dal piede del Cavalcavia Borgomagno)
      if (!n.edges.length || (n.joint && n.bend < 0.02) || n.inChain || (surf && (this.net.surfaces.up || !((n.h || 0) > 0.05)))) continue;
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
    if (lines.pos.length) this.group.add(new THREE.Mesh(lines.build(), layer(new THREE.MeshLambertMaterial({ color: 0xe8e8e2 }), 4)));
    if (yellow.pos.length) this.group.add(new THREE.Mesh(yellow.build(), layer(new THREE.MeshLambertMaterial({ color: 0xe6b422 }), 4)));
    if (bumpY.pos.length) this.group.add(new THREE.Mesh(bumpY.build(), layer(new THREE.MeshLambertMaterial({ color: 0xe8b818 }), 5)), new THREE.Mesh(bumpK.build(), layer(new THREE.MeshLambertMaterial({ color: 0x1c1c1c }), 5)));
    if (paintTri.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(paintTri.flat(), 3));
      g.computeVertexNormals();
      this.group.add(new THREE.Mesh(g, layer(new THREE.MeshLambertMaterial({ color: 0xe8e8e2 }), 5)));
    }
    if (paint.pos.length || paintBus.pos.length) {
      const atlas = TX.roadMarkAtlas(), mat = (color) => layer(new THREE.MeshLambertMaterial({ map: atlas, color, alphaTest: 0.5 }), 5);
      if (paint.pos.length) this.group.add(new THREE.Mesh(paint.build(), mat(0xe8e8e2)));
      if (paintBus.pos.length) this.group.add(new THREE.Mesh(paintBus.build(), mat(0xe6b422)));
    }
  }

  // pianta delle strade (scripts/street_surfaces.py): carreggiate, marciapiedi e isole a riquadri, triangolate qui.
  // Il bordo dell'asfalto (senza i tagli tra un riquadro e l'altro) dice anche se le ruote sono in strada
  buildSurfaces() {
    const S = this.net.surfaces, T = S.tile;
    const asph = new GeoBuilder(), walk = new GeoBuilder(), isl = new GeoBuilder(), kerb = new GeoBuilder(), side = new GeoBuilder(), islandLines = new GeoBuilder();
    const green = new GeoBuilder(); // prati, aree alberate e aiuole del DBGT
    this.asphRings = new Map();
    this.asphEdges = new Grid(20);
    const onBorder = (ax, az, bx, bz, ix, iz) => (Math.abs(ax - bx) < 0.05 && [ix * T, (ix + 1) * T].some((v) => Math.abs(ax - v) < 0.06)) || (Math.abs(az - bz) < 0.05 && [iz * T, (iz + 1) * T].some((v) => Math.abs(az - v) < 0.06));
    const eachEdge = (poly, ix, iz, fn) => {
      for (const r of poly) for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length;
        if (!onBorder(r[i], r[i + 1], r[j], r[j + 1], ix, iz)) fn(r[i], r[i + 1], r[j], r[j + 1]);
      }
    };
    // righe di bordo: lungo il bordo vero dell'asfalto, 0,35 m dentro, dove la strada più vicina ha la segnaletica e
    // non c'è un'isola (che ha la sua riga). Prima ogni via aveva le sue righe a metà larghezza, e dove due rami si
    // uniscono (Via Toti al Rondò Borgomagno) si incrociavano in mezzo all'asfalto
    const edgeLines = new GeoBuilder(), q = [], rg = new Grid(12);
    // griglia fitta solo delle strade: con quella generale (celle da 80 m) ogni tratto di bordo provava centinaia di archi
    for (const e of this.net.edges) {
      const A = this.net.nodes[e.a], B = this.net.nodes[e.b], hw = e.width / 2;
      rg.insertAABB({ ax: A.x, az: A.z, bx: B.x, bz: B.z, hw, ref: e }, Math.min(A.x, B.x) - hw, Math.min(A.z, B.z) - hw, Math.max(A.x, B.x) + hw, Math.max(A.z, B.z) + hw);
    }
    const marked = (x, z, elev) => {
      let best = null, bd = 3;
      for (const it of rg.query(x, z, 3, q)) {
        if (elev && !it.ref.elev) continue;
        const d = distToSeg(x, z, it.ax, it.az, it.bx, it.bz).d - it.hw;
        if (d < bd) { bd = d; best = it.ref; }
      }
      return !!best && !best.ped && !best.elev === !elev && !(best.cls >= 5 && !best.routes);
    };
    const inside = (x, z, poly) => {
      let c = false;
      for (const r of poly) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const zi = r[i + 1], zj = r[j + 1];
        if (zi > z !== zj > z && x < ((r[j] - r[i]) * (z - zi)) / (zj - zi) + r[i]) c = !c;
      }
      return c;
    };
    // keep(a, b, dentro, fuori): il tratto a-b del bordo ha la riga (dentro/fuori: punti a 1,2 m nell'asfalto e a
    // 0,5 m fuori); yFn: quota della riga (asfalto in quota)
    const borderLines = (poly, keep, yFn) => poly.forEach((r, ri) => {
      const n = r.length / 2, pt = (i) => ({ x: r[2 * (i % n)], z: r[2 * (i % n) + 1] });
      let a2 = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; a2 += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1]; }
      const sg = (ri === 0) === (a2 > 0) ? 1 : -1; // 1: l'asfalto è a sinistra del verso dell'anello
      const ok = [];
      for (let i = 0; i < n; i++) {
        const a = pt(i), b = pt(i + 1);
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, sx = (-(b.z - a.z) / l) * sg, sz = ((b.x - a.x) / l) * sg, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        ok.push(keep(a, b, mx + sx * 1.2, mz + sz * 1.2, mx - sx * 0.5, mz - sz * 0.5));
      }
      const draw = (pts) => {
        const p0 = edgeLines.pos.length;
        edgeLines.strip(pts, 0.14, Y_ROAD + 0.012, 1, 0.35 * sg);
        if (yFn) for (let i = p0; i < edgeLines.pos.length; i += 3) edgeLines.pos[i + 1] = yFn(edgeLines.pos[i], edgeLines.pos[i + 2]);
      };
      if (ok.every(Boolean)) { const pts = []; for (let i = 0; i <= n + 1; i++) pts.push(pt(i)); draw(pts); return; }
      let run = null;
      for (let k = 1, s0 = ok.indexOf(false); k <= n; k++) {
        const i = (s0 + k) % n;
        if (ok[i]) { if (!run) run = [pt(i)]; run.push(pt(i + 1)); } else if (run) { draw(run); run = null; }
      }
    });
    for (const [ix, iz, A, W, I, V] of S.cells) {
      for (const poly of V || []) green.polygon(poly, Y_GREEN, 8);
      const rings = [];
      const ib = I.map((p) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; const r = p[0]; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); } return [x0, z0, x1, z1, p]; });
      const onIsland = (x, z) => ib.some(([x0, z0, x1, z1, p]) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && inside(x, z, p));
      for (const poly of A) {
        asph.polygon(poly, Y_ROAD, 20);
        rings.push(...poly);
        eachEdge(poly, ix, iz, (ax, az, bx, bz) => {
          this.asphEdges.insertAABB({ ax, az, bx, bz }, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
          kerb.ribbon(ax, az, bx, bz, 0.22, Y_ROAD + 0.003, 4);
        });
        borderLines(poly, (a, b, inx, inz, outx, outz) => !onBorder(a.x, a.z, b.x, b.z, ix, iz) && marked(inx, inz, false) && !onIsland(outx, outz));
      }
      this.asphRings.set(ix + ',' + iz, rings);
      for (const poly of W) walk.polygon(poly, Y_SIDEWALK, 6);
      // isole: prato rialzato con il cordolo e la riga bianca tutt'intorno sull'asfalto
      for (const poly of I) {
        isl.polygon(poly, Y_ROAD + 0.12, 5);
        const outer = poly[0];
        let a2 = 0;
        for (let i = 0; i < outer.length; i += 2) { const j = (i + 2) % outer.length; a2 += outer[i] * outer[j + 1] - outer[j] * outer[i + 1]; }
        eachEdge(poly, ix, iz, (ax, az, bx, bz) => {
          side.quad([ax, Y_ROAD, az], [bx, Y_ROAD, bz], [ax, Y_ROAD + 0.125, az], [bx, Y_ROAD + 0.125, bz], [0, 0, 1, 0, 0, 1, 1, 1]);
          const l = Math.hypot(bx - ax, bz - az) || 1, o = a2 > 0 ? 0.4 : -0.4, nx = ((bz - az) / l) * o, nz = (-(bx - ax) / l) * o;
          islandLines.ribbon(ax + nx, az + nz, bx + nx, bz + nz, 0.12, Y_ROAD + 0.012, 1);
        });
      }
    }
    // carreggiate in quota: alla quota della strada (vertici ogni 4 m), sopra l'impalcato e sopra l'asfalto a terra ai
    // piedi delle rampe
    const upA = new GeoBuilder();
    for (const rings of S.up || []) upA.polygonH(rings, (x, z) => Y_ROAD + this.heightAt(x, z) + 0.004, 20, 4);
    // righe di bordo anche in quota, tranne dove la rampa si fonde con l'asfalto a terra (al piede)
    const onGround = (x, z) => rg.query(x, z, 1, q).some((it) => !it.ref.elev && distToSeg(x, z, it.ax, it.az, it.bx, it.bz).d < it.hw);
    for (const rings of S.up || []) borderLines(rings, (a, b, inx, inz, outx, outz) => marked(inx, inz, true) && !onGround(outx, outz), (x, z) => Y_ROAD + this.heightAt(x, z) + 0.012);
    if (upA.pos.length) { const um = new THREE.Mesh(upA.build(), layer(new THREE.MeshLambertMaterial({ map: TX.intersectionTexture() }), 3)); um.receiveShadow = true; this.upMat = um.material; this.group.add(um); }
    const am = new THREE.Mesh(asph.build(), layer(new THREE.MeshLambertMaterial({ map: TX.intersectionTexture() }), 2));
    am.receiveShadow = true;
    this.asphMat = am.material;
    const wm = new THREE.Mesh(walk.build(), layer(new THREE.MeshLambertMaterial({ map: TX.sidewalkTexture() }), 1));
    wm.receiveShadow = true;
    this.walkMat = wm.material;
    const gt = TX.grassTexture();
    const im = new THREE.Mesh(isl.build(), layer(new THREE.MeshLambertMaterial({ map: gt, color: 0xb8d8a0 }), 8));
    im.receiveShadow = true;
    const kMat = new THREE.MeshLambertMaterial({ color: 0xc9c4ba, side: THREE.DoubleSide });
    this.group.add(am, wm, im, new THREE.Mesh(kerb.build(), layer(kMat.clone(), 3)), new THREE.Mesh(side.build(), layer(kMat, 8)));
    // come il prato di fondo: si disegna subito dopo e non nasconde niente (sul terreno in pendenza marciapiedi e
    // carreggiate, con altri vertici, possono passare qualche centimetro sotto)
    this.greenMat = new THREE.MeshLambertMaterial({ map: TX.grassTexture(), color: 0x9fbf88, depthWrite: false });
    if (green.pos.length) {
      const gm = new THREE.Mesh(green.build(), this.greenMat);
      gm.receiveShadow = true;
      gm.renderOrder = -0.4;
      this.group.add(gm);
    }
    const lineMat = layer(new THREE.MeshLambertMaterial({ color: 0xe8e8e2 }), 4);
    for (const g of [islandLines, edgeLines]) if (g.pos.length) this.group.add(new THREE.Mesh(g.build(), lineMat));
  }
  // dosso o rampa attraversati da obj (x, z) dall'ultima chiamata: il più forte, { sev, lim }, o null
  bumpHit(obj) {
    const p = obj._bumpPrev, x1 = obj.x, z1 = obj.z;
    obj._bumpPrev = { x: x1, z: z1 };
    if (!p || !this.bumpGrid) return null;
    const mx = x1 - p.x, mz = z1 - p.z, m = Math.hypot(mx, mz);
    if (m < 1e-4 || m > 20) return null;
    let best = null;
    for (const b of this.bumpGrid.query(x1, z1, m + 2, this._qb || (this._qb = []))) {
      // la linea del dosso (di traverso) e lo spostamento si incrociano
      const sx = b.rx * 2 * b.hw, sz = b.rz * 2 * b.hw, ax = b.x - b.rx * b.hw, az = b.z - b.rz * b.hw;
      const den = mx * sz - mz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - p.x) * sz - (az - p.z) * sx) / den, u = ((ax - p.x) * mz - (az - p.z) * mx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (!best || b.sev > best.sev)) best = b;
    }
    return best;
  }
  // distanza (m) dal bordo dell'asfalto: negativa dentro la carreggiata, al più 8
  surfaceOff(x, z) {
    const T = this.net.surfaces.tile, rings = this.asphRings.get(Math.floor(x / T) + ',' + Math.floor(z / T));
    let inside = false;
    if (rings) for (const r of rings) {
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const zi = r[i + 1], zj = r[j + 1];
        if (zi > z !== zj > z && x < ((r[j] - r[i]) * (z - zi)) / (zj - zi) + r[i]) inside = !inside;
      }
    }
    let d = 8;
    for (const sg of this.asphEdges.query(x, z, 8, this._qa || (this._qa = []))) { const q = distToSeg(x, z, sg.ax, sg.az, sg.bx, sg.bz).d; if (q < d) d = q; }
    return inside ? -d : d;
  }

  // rotatorie: anelli chiusi di archi junction=roundabout, quasi circolari (centro, raggio della mezzeria, larghezza)
  findRoundabouts() {
    const { nodes, edges } = this.net, seen = new Set(), rings = [];
    for (const e of edges) {
      if (!e.roundabout || seen.has(e)) continue;
      const comp = [], st = [e];
      while (st.length) {
        const f = st.pop();
        if (seen.has(f)) continue;
        seen.add(f); comp.push(f);
        for (const id of [f.a, f.b]) for (const g of nodes[id].edges) if (g.roundabout && !seen.has(g)) st.push(g);
      }
      const ids = [...new Set(comp.flatMap((f) => [f.a, f.b]))];
      if (ids.length < 3 || comp.some((f) => f.elev) || ids.some((id) => nodes[id].edges.filter((g) => g.roundabout).length !== 2)) continue;
      let cx = 0, cz = 0, L = 0;
      for (const f of comp) { const A = nodes[f.a], B = nodes[f.b]; cx += ((A.x + B.x) / 2) * f.len; cz += ((A.z + B.z) / 2) * f.len; L += f.len; }
      cx /= L; cz /= L;
      const ds = ids.map((id) => Math.hypot(nodes[id].x - cx, nodes[id].z - cz)), r = ds.reduce((a, b) => a + b, 0) / ds.length;
      if (r < 4 || ds.some((d) => Math.abs(d - r) > 0.25 * r + 1)) continue;
      rings.push({ cx, cz, r, w: comp.reduce((a, f) => a + f.width, 0) / comp.length });
    }
    return rings;
  }
  // isola centrale: cordolo e prato; se è troppo piccola per un bus, rotatoria dipinta (sormontabile)
  buildRoundaboutIslands(rings) {
    const kerb = [], grass = [], paint = [];
    for (const g of rings) {
      const ri = g.r - g.w / 2 - 0.1;
      if (ri >= 2) {
        kerb.push(new THREE.CylinderGeometry(ri, ri, 0.16, 48, 1, true).translate(g.cx, Y_ROAD + 0.08, g.cz));
        kerb.push(new THREE.RingGeometry(ri - 0.35, ri, 48).rotateX(-Math.PI / 2).translate(g.cx, Y_ROAD + 0.16, g.cz));
        grass.push(new THREE.CircleGeometry(ri - 0.3, 48).rotateX(-Math.PI / 2).translate(g.cx, Y_ROAD + 0.155, g.cz));
      } else {
        paint.push(new THREE.CircleGeometry(Math.max(1, ri), 32).rotateX(-Math.PI / 2).translate(g.cx, Y_ROAD + 0.03, g.cz));
      }
    }
    // davanti all'asfalto anche nel depth buffer (le strade hanno il loro polygonOffset)
    if (kerb.length) this.group.add(new THREE.Mesh(mergeGeometries(kerb), layer(new THREE.MeshLambertMaterial({ color: 0xcfcac0, side: THREE.DoubleSide }), 8)));
    if (grass.length) {
      const gt = TX.grassTexture();
      gt.repeat.set(2, 2);
      const m = new THREE.Mesh(mergeGeometries(grass), layer(new THREE.MeshLambertMaterial({ map: gt, color: 0xb8d8a0 }), 8));
      m.receiveShadow = true;
      this.group.add(m);
    }
    if (paint.length) this.group.add(new THREE.Mesh(mergeGeometries(paint), layer(new THREE.MeshLambertMaterial({ color: 0xeeeeea }), 4)));
    this.roundabouts = rings;
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
      // con gli impalcati della pianta delle strade (buildDecks) qui restano solo le pile
      const decks = !!(this.net.surfaces && this.net.surfaces.decks);
      if (!decks) for (const side of [-1, 1]) {
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
      if (!decks) {
        const sk = new THREE.BoxGeometry(e.width + 2.4, 1.0, 10.2);
        sk.rotateX(-slope);
        sk.rotateY(ang);
        sk.translate(cx, Y_ROAD + hm - 0.5, cz);
        deck.push(sk);
      }
      if (hm > 2.5 && Math.round(s) % 30 === 0) {
        for (const side of [-1, 1]) {
          const px = cx - e.dz * side * (e.width / 2 - 1), pz = cz + e.dx * side * (e.width / 2 - 1);
          // niente pile sulla carreggiata che passa sotto
          if (this.segGrid.query(px, pz, 20, this._qp || (this._qp = [])).some((it) => it.kind === 'road' && it.ref && !it.ref.elev && distToSeg(px, pz, it.ax, it.az, it.bx, it.bz).d < it.hw + 1.5)) continue;
          const pl = new THREE.BoxGeometry(1.2, hm - 0.6, 1.2);
          pl.translate(px, (hm - 0.6) / 2, pz);
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

  // vero se il punto è in una zona dove le ruote possono uscire un po' dall'asfalto (incroci, curve strette, rotonde)
  kerbAllowance(x, z) {
    const arr = this.kerbGrid.query(x, z, 20, this._qk || (this._qk = []));
    for (const it of arr) if (distToSeg(x, z, it.ax, it.az, it.bx, it.bz).d < it.hw) return true;
    return false;
  }

  // quota della strada sotto un punto (cavalcavia), 0 altrove
  // quota della strada in un punto. Con cur (quota attuale del veicolo) vale, tra le superfici che ci sono lì, quella
  // più vicina a cur: il piano terra conta solo dove sotto il cavalcavia passa davvero un'altra strada, così sulle
  // rampe si sale e chi passa sotto resta a terra
  heightAt(x, z, cur = null) {
    const arr = this.segGrid.query(x, z, 12, this._qh || (this._qh = []));
    let h = 0, best = Infinity, any = false, under = false;
    for (const it of arr) {
      const e = it.ref;
      if (it.kind !== 'road' || !e) continue;
      const r = distToSeg(x, z, it.ax, it.az, it.bx, it.bz);
      if (!e.elev) { if (r.d <= it.hw) under = true; continue; }
      if (r.d > it.hw + 1.5) continue;
      const he = edgeHeight(e, r.t * e.len);
      any = true;
      if (cur == null) h = Math.max(h, he);
      else if (Math.abs(he - cur) < best) { best = Math.abs(he - cur); h = he; }
    }
    if (any && cur != null && under && Math.abs(cur) < best) h = 0;
    return h;
  }

  // ---- acqua e ponti ----
  buildWater() {
    const wTex = TX.waterTexture();
    const wMat = layer(new THREE.MeshLambertMaterial({ map: wTex, color: 0xaaccd0 }), 2);
    this.waterTex = wTex;
    const bank = layer(new THREE.MeshLambertMaterial({ color: 0x7d8a5c }), 1);
    wMat.userData.terrainGround = bank.userData.terrainGround = true; // seguono l'alveo, non la quota dei ponti
    const geos = [], banks = [];
    for (const w of this.net.water) {
      geos.push(polyRibbon(w.pts, w.width, 0.03, 30));
      banks.push(bankStrips(w.pts, w.width, 0.02));
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
            const po = e.width / 2 + (this.net.surfaces ? 2.25 : 0.6); // oltre il marciapiede del ponte (2 m)
            const ox = -e.dz * side * po, oz = e.dx * side * po;
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
    // binari per verso (doppio binario dove i versi corrono affiancati, singolo dove si separano) e quote del cavalcavia
    const track = (this.tramTrack = new TramTrack(this.net));
    this.tramCenter = track.C;
    // una sede per linea: quelle in costruzione si appoggiano alle sedi già posate nei tratti in comune
    this.tramTracks = { [track.id]: track };
    for (const T of this.net.tramLines || []) {
      this.tramTracks[T.id] = new TramTrack(this.net, { id: T.id, lanes: T.lanes, lines: TRAM_LINES.filter((L) => L.id === T.id), over: Object.values(this.tramTracks) });
    }
    const tracks = Object.values(this.tramTracks);
    for (const T of tracks) T.setHeights((x, z, dx, dz) => this.nearElevatedHeight(x, z, dx, dz));
    const red = new GeoBuilder(), rail = new GeoBuilder(), kerb = new GeoBuilder();
    const deck = [], piers = [], poles = [], wires = [];
    this.tramPoles = []; // posizioni dei pali della linea aerea (per le prove)
    const L = TRAM.lane;
    // Facciate vicine alla sede: i tiranti della linea aerea si agganciano lì (le piante reali, gli ostacoli dei muri
    // si costruiscono dopo). spanAnchor: dal centro (cx, cz) verso (nx, nz), oltre half metri, la prima facciata entro
    // 14 m; se non c'è, un palo sul bordo della strada
    const FC = 20, fac = new Map(), nearTrack = new Set(), ck = (x, z) => Math.floor(x / FC) + ',' + Math.floor(z / FC);
    for (const T of tracks) for (const d of [1, -1]) { const P = T.path(d); for (let s = 0; s <= P.len; s += 10) { const p = P.at(s); for (const ox of [-1, 0, 1]) for (const oz of [-1, 0, 1]) nearTrack.add(ck(p.x + ox * FC, p.z + oz * FC)); } }
    for (const b of this.net.tramBuildings || this.net.buildings) {
      if (!b.pts.some((p) => nearTrack.has(ck(p.x, p.z)))) continue;
      for (let i = 0; i < b.pts.length; i++) {
        const a = b.pts[i], c = b.pts[(i + 1) % b.pts.length], seg = [a.x, a.z, c.x, c.z];
        for (const k of new Set([ck(a.x, a.z), ck(c.x, c.z), ck((a.x + c.x) / 2, (a.z + c.z) / 2)])) { if (!fac.has(k)) fac.set(k, []); fac.get(k).push(seg); }
      }
    }
    // distanza dall'asfalto: con la pianta delle strade conta l'asfalto vero (la sede è asfalto), non il nastro dell'arco
    const offRoad = this.asphRings ? (x, z) => Math.min(this.surfaceOff(x, z), this.clearance(x, z, ['tram'], 12) + 0.3) : (x, z) => this.clearance(x, z, ['road', 'tram'], 12) - 0.2;
    const spanAnchor = (cx, cz, nx, nz, half) => {
      let best = 14;
      const cells = new Set();
      for (let k = half; k < 14 + 5; k += 5) cells.add(ck(cx + nx * Math.min(k, 14), cz + nz * Math.min(k, 14)));
      for (const key of cells) for (const sg of fac.get(key) || []) {
        const [ax, az, bx, bz] = sg, ex = bx - ax, ez = bz - az, den = nx * ez - nz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - cx) * ez - (az - cz) * ex) / den, u = ((ax - cx) * nz - (az - cz) * nx) / den;
        if (t >= half && t < best && u >= 0 && u <= 1) best = t;
      }
      if (best < 14) return { x: cx + nx * best, z: cz + nz * best, pole: false };
      // nessuna facciata: palo dove finisce l'asfalto (marciapiede, isola, verde), al più a 9 m; se fin lì è tutta
      // carreggiata, sul cordolo della sede: mai in mezzo alla strada (binari separati con le corsie in mezzo)
      for (let k = half; k < 9; k += 0.25) if (offRoad(cx + nx * k, cz + nz * k) >= 0.4) return { x: cx + nx * k, z: cz + nz * k, pole: true };
      return { x: cx + nx * (half - 0.55), z: cz + nz * (half - 0.55), pole: true };
    };
    // ogni binario una volta: i tratti in comune li disegna la sede che c'era già
    for (const track of tracks) for (const dir of [1, -1]) {
      const P = track.path(dir);
      let lastPole = -1e9, prevWire = null;
      // tratto di binario da a a b (progressive sa, sb)
      const piece = (a, b, sa, sb) => {
        const l = sb - sa;
        const ha = track.heightAt(dir, sa), hb = track.heightAt(dir, sb);
        const ex = (b.x - a.x) / l, ez = (b.z - a.z) / l, nx = -ez, nz = ex;
        const hFn = ha || hb ? (x, z) => ha + (hb - ha) * Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l)) : null;
        const off = (o) => [a.x + nx * o, a.z + nz * o, b.x + nx * o, b.z + nz * o];
        // corsia rossa, rotaia di guida al centro, cordolo esterno (e interno dove il binario è singolo)
        red.ribbon(a.x, a.z, b.x, b.z, L * 2, Y_ROAD + 0.03, 8, 0, hFn);
        // disco di raccordo nei giunti: solo in piano, in rampa sporgerebbe sopra la corsia
        if (Math.abs(hb - ha) < 0.02) red.disc(b.x, b.z, L, Y_ROAD + 0.029 + hb, 8, 8);
        rail.ribbon(a.x, a.z, b.x, b.z, 0.22, Y_ROAD + 0.05, 8, 0, hFn);
        kerb.ribbon(...off(L), 0.3, Y_ROAD + 0.06, 8, 0, hFn);
        if (track.doubleAt(dir, sa) < 0.5) kerb.ribbon(...off(-L), 0.3, Y_ROAD + 0.06, 8, 0, hFn);
        // in quota (cavalcavia Borgomagno): impalcato con parapetti e pile, inclinati come la rampa
        const hm = (ha + hb) / 2;
        if (hm > 0.4 && !(this.net.surfaces && this.net.surfaces.decks)) {
          const ang = Math.atan2(ex, ez), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
          const tilt = -Math.atan2(hb - ha, l), l3 = Math.hypot(l, hb - ha) + 0.05;
          const slab = (w, h, o, y) => new THREE.BoxGeometry(w, h, l3).rotateX(tilt).rotateY(ang).translate(mx + nx * o, Y_ROAD + hm + y, mz + nz * o);
          deck.push(slab(L * 2 + 0.4, 0.6, 0, -0.32));
          deck.push(slab(0.22, 1.0, L + 0.1, 0.45));
          if (track.doubleAt(dir, sa) < 0.5) deck.push(slab(0.22, 1.0, -(L + 0.1), 0.45));
        }
        if (hm > 1.5 && Math.floor(sb / 22) !== Math.floor(sa / 22)) piers.push(new THREE.BoxGeometry(0.9, hm - 0.6, 0.9).translate(b.x, Y_ROAD + (hm - 0.6) / 2, b.z));
      };
      for (let i = 0; i < P.pts.length - 1; i++) {
        const a = P.pts[i], b = P.pts[i + 1], sa = P.cum[i], sb = P.cum[i + 1];
        const l = sb - sa;
        if (l < 0.05 || track.sharedAt(dir, (sa + sb) / 2)) continue;
        // in quota i tratti lunghi vanno spezzati ogni 5 m: la rampa disegnata segue la quota su cui corre il tram
        let up = false;
        for (let s = sa; s < sb + 5 && !up; s += 5) up = track.heightAt(dir, Math.min(s, sb)) > 0.05;
        const n = up ? Math.ceil(l / 5) : 1;
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n;
          piece({ x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 }, { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 }, sa + l * t0, sa + l * t1);
        }
      }
      // linea aerea: un filo sopra ogni binario, retto ogni 30 m da un tirante trasversale (facciate o pali a lato)
      for (let sp = 0; sp <= P.len; sp += 6) {
        const p = P.at(sp), h = track.heightAt(dir, sp);
        if (!track.wireAt(dir, sp) || track.sharedAt(dir, sp)) { prevWire = null; continue; }
        if (prevWire) {
          const wl = Math.hypot(p.x - prevWire.x, p.z - prevWire.z);
          wires.push(new THREE.BoxGeometry(0.035, 0.035, wl).rotateY(Math.atan2(p.x - prevWire.x, p.z - prevWire.z)).translate((p.x + prevWire.x) / 2, Y_ROAD + CATENARY_HEIGHT + (h + prevWire.h) / 2, (p.z + prevWire.z) / 2));
        }
        prevWire = { x: p.x, z: p.z, h };
        if (sp - lastPole < 30) continue;
        lastPole = sp;
        // sul doppio binario il tirante lo mette il verso nord, per tutti e due i fili (non dove il binario accanto è di
        // un'altra linea)
        const O = track.path(-dir), q0 = track.doubleAt(dir, sp) > 0.5 ? O.at(O.project(p.x, p.z).s) : null;
        const q = q0 && Math.hypot(q0.x - p.x, q0.z - p.z) < 10 ? q0 : null;
        if (q && dir < 0) continue;
        // tirante trasversale sopra i fili, agganciato alle facciate o a pali ai lati della strada
        const cx = q ? (p.x + q.x) / 2 : p.x, cz = q ? (p.z + q.z) / 2 : p.z, half = (q ? Math.hypot(p.x - q.x, p.z - q.z) / 2 : 0) + L + 0.6;
        const ends = [-1, 1].map((side) => spanAnchor(cx, cz, -p.dz * side, p.dx * side, half));
        const y = Y_ROAD + h + CATENARY_HEIGHT + 0.3;
        for (const a of ends) if (a.pole) { poles.push(new THREE.CylinderGeometry(0.08, 0.11, y - Y_ROAD - h + 0.4, 6).translate(a.x, Y_ROAD + h + (y - Y_ROAD - h + 0.4) / 2, a.z)); this.tramPoles.push({ x: a.x, z: a.z }); }
        const [a, b] = ends, sl = Math.hypot(b.x - a.x, b.z - a.z);
        wires.push(new THREE.BoxGeometry(0.03, 0.03, sl).rotateY(Math.atan2(b.x - a.x, b.z - a.z)).translate((a.x + b.x) / 2, y, (a.z + b.z) / 2));
      }
    }
    const tex = TX.tramLaneTexture();
    const rm = new THREE.Mesh(red.build(), layer(new THREE.MeshLambertMaterial({ map: tex }), 5));
    rm.receiveShadow = true;
    this.group.add(rm, new THREE.Mesh(rail.build(), layer(new THREE.MeshLambertMaterial({ color: 0x9da3a8 }), 6)), new THREE.Mesh(kerb.build(), layer(new THREE.MeshLambertMaterial({ color: 0xd8d4cc }), 6)));
    if (deck.length) { const dm = new THREE.Mesh(mergeGeometries(deck), new THREE.MeshLambertMaterial({ color: 0xb7b1a6 })); dm.castShadow = true; this.group.add(dm); }
    if (piers.length) this.group.add(new THREE.Mesh(mergeGeometries(piers), new THREE.MeshLambertMaterial({ color: 0xa8a39a })));
    if (poles.length) { const pm = new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x6f767c })); pm.castShadow = true; this.group.add(pm); }
    if (wires.length) this.group.add(new THREE.Mesh(mergeGeometries(wires), new THREE.MeshBasicMaterial({ color: 0x2a2d30 })));
    // cartelli "abbassare / alzare il pantografo" ai bordi dei tratti senza linea, per ogni verso
    const pan = [], panTex = TX.pantographSignTexture();
    for (const track of tracks) for (const dir of [1, -1]) {
      const P = track.path(dir);
      for (const [g0, g1] of track.gaps[dir]) for (const [sAt, up] of [[g0 - 60, 0], [g1 + 8, 1]]) {
        const p = P.at(sAt), px = p.x - p.dz * (L + 1.9), pz = p.z + p.dx * (L + 1.9), h = track.heightAt(dir, sAt);
        const ang = Math.atan2(-p.dx, -p.dz); // il cartello guarda il tram che arriva
        pan.push({ g: new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6).translate(px, Y_ROAD + h + 1.3, pz), mat: 'pole' });
        const pl = new THREE.PlaneGeometry(0.7, 0.7);
        const uv = pl.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (up ? 0.5 : 0));
        pan.push({ g: pl.rotateY(ang).translate(px, Y_ROAD + h + 2.35, pz), mat: 'sign' });
      }
    }
    if (pan.length) {
      this.group.add(new THREE.Mesh(mergeGeometries(pan.filter((x) => x.mat === 'pole').map((x) => x.g)), new THREE.MeshLambertMaterial({ color: 0x8f9497 })));
      this.group.add(new THREE.Mesh(mergeGeometries(pan.filter((x) => x.mat === 'sign').map((x) => x.g)), new THREE.MeshLambertMaterial({ map: panTex, side: THREE.DoubleSide })));
    }
    // banchine: a destra del binario di chi le serve (a sinistra dove la fermata lo dice), con la linea bianca di fermata
    // a fine banchina. Le fermate in comune tra più linee hanno una banchina sola, lunga per il tram più lungo che ci
    // ferma (SIR2 a 4 moduli): il muso si ferma a fine banchina, quindi la banchina si allunga indietro, e la pensilina
    // con lei. Le centrali servono i due versi e si allungano dai due capi
    const stopMods = [];
    for (const track of tracks) {
      const M = Math.max(3, ...track.lines.map((ln) => ln.modules || 3));
      for (const dir of [1, -1]) for (const st of track.stopsDir[dir]) { const p = track.path(dir).at(st.s); stopMods.push({ x: p.x, z: p.z, dx: p.dx, dz: p.dz, M }); }
    }
    const extraAt = (x, z, dx, dz, bothDirs) => {
      const M = Math.max(3, ...stopMods.filter((o) => Math.hypot(o.x - x, o.z - z) < 15 && (bothDirs || o.dx * dx + o.dz * dz > 0.9)).map((o) => o.M));
      return tramLength(M) - tramLength(3);
    };
    const plat = [], roofs = [], stopLines = new GeoBuilder(), built = [];
    for (const track of tracks) for (const dir of [1, -1]) {
      const P = track.path(dir);
      for (const st of track.stopsDir[dir]) {
        const p = P.at(st.s), dx = p.dx, dz = p.dz, sd = st.side < 0 ? -1 : 1, rx = -dz * sd, rz = dx * sd, ang = Math.atan2(dx, dz), h = track.heightAt(dir, st.s);
        if (st.shared || built.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 15 && b.dx * dx + b.dz * dz > 0.9)) continue;
        built.push(p);
        // banchina piena se c'è spazio, altrimenti più stretta e attaccata alla sede (dove la sede corre accanto alla strada)
        if (track.centralAt(p.x, p.z)) {
          // banchina centrale tra i due binari, comune ai due versi (la mette il verso nord), pensilina al centro
          if (dir > 0) {
            const O = track.path(-1), q = O.at(O.project(p.x, p.z).s), gap = Math.hypot(q.x - p.x, q.z - p.z);
            const w = Math.max(1.6, Math.min(3, gap - TRAM.width - 0.3)), mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
            const len = 30 + 2 * extraAt(mx, mz, dx, dz, true), roof = len * 0.4, k = roof / 2 - 1.5;
            plat.push(new THREE.BoxGeometry(w, 0.3, len).rotateY(ang).translate(mx, Y_ROAD + h + 0.15, mz));
            roofs.push(new THREE.BoxGeometry(Math.max(1.4, w - 0.2), 0.15, roof).rotateY(ang).translate(mx, Y_ROAD + h + 2.96, mz));
            for (const kk of [-k, k]) roofs.push(new THREE.BoxGeometry(0.12, 2.9, 0.12).translate(mx + dx * kk, Y_ROAD + h + 1.46, mz + dz * kk));
          }
        } else {
          const wide = this.clearance(p.x + rx * (L + 1.5), p.z + rz * (L + 1.5), ['road'], 20) >= 0.3;
          const ext = extraAt(p.x, p.z, dx, dz, false), len = 30 + ext, roof = len * 0.4, k = roof / 2 - 1.5;
          // bordo verso il tram a 1,8 m dal binario; centro indietro di metà dell'allungamento
          const off = wide ? L + 1.5 : L + 1.1, cx = p.x + rx * off - dx * ext / 2, cz = p.z + rz * off - dz * ext / 2;
          plat.push(new THREE.BoxGeometry(wide ? 2.8 : 2.0, 0.3, len).rotateY(ang).translate(cx, Y_ROAD + h + 0.15, cz));
          roofs.push(new THREE.BoxGeometry(wide ? 2.4 : 1.8, 0.15, roof).rotateY(ang).translate(cx, Y_ROAD + h + 2.96, cz));
          for (const kk of [-k, k]) roofs.push(new THREE.BoxGeometry(0.12, 2.9, 0.12).translate(cx + dx * kk + rx * (wide ? 0.9 : 0.6), Y_ROAD + h + 1.46, cz + dz * kk + rz * (wide ? 0.9 : 0.6)));
        }
        const q = P.at(st.s + TRAM_STOP_AHEAD), qr = [-q.dz, q.dx];
        const Q = (a, w) => [q.x + q.dx * a + qr[0] * w, Y_ROAD + h + 0.045, q.z + q.dz * a + qr[1] * w];
        stopLines.quad(Q(-0.2, -1.6), Q(-0.2, 1.6), Q(0.2, -1.6), Q(0.2, 1.6), [0, 0, 1, 0, 0, 1, 1, 1]);
      }
    }
    if (stopLines.pos.length) this.group.add(new THREE.Mesh(stopLines.build(), layer(new THREE.MeshLambertMaterial({ color: 0xf2f2ea }), 7)));
    if (plat.length) this.group.add(new THREE.Mesh(mergeGeometries(plat), new THREE.MeshLambertMaterial({ color: 0xc9c3b8 })));
    if (roofs.length) { const m = new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshLambertMaterial({ color: 0x5d646b })); m.castShadow = true; this.group.add(m); }
    // scambi ai capolinea (cambio cabina): un deviatoio che collega i due binari nel tratto tronco
    const xo = new GeoBuilder();
    for (const track of tracks) {
      const N = track.path(1), S = track.path(-1);
      for (const [A, sA, B] of [[N, N.len - 40, S], [S, S.len - 40, N]]) {
        const pa = A.at(sA), tgt = A.at(sA + 24), sb = B.project(tgt.x, tgt.z).s, pb = B.at(Math.min(B.len, Math.max(0, sb)));
        if (Math.hypot(pb.x - pa.x, pb.z - pa.z) < 40) xo.ribbon(pa.x, pa.z, pb.x, pb.z, 0.22, Y_ROAD + 0.055, 8);
      }
    }
    this.group.add(new THREE.Mesh(xo.build(), layer(new THREE.MeshLambertMaterial({ color: 0x9da3a8 }), 6)));
  }

  // Cavalcavia a più impalcati affiancati (Borgomagno: la strada verso sud e, poco più in basso, la sede del tram con
  // la corsia dei bus verso nord): la fascia vuota tra due impalcati in quota vicini diventa soletta, alla quota più
  // bassa dei due, così il cavalcavia è un corpo unico
  buildDeckJoins() {
    if (this.net.surfaces && this.net.surfaces.decks) return; // corpo unico già nella pianta delle strade
    const items = [];
    for (const e of this.net.edges) {
      if (!e.elev) continue;
      const A = this.net.nodes[e.a];
      for (let s = 2.5; s < e.len; s += 5) {
        const h = edgeHeight(e, s);
        if (h > 0.4) items.push({ x: A.x + e.dx * s, z: A.z + e.dz * s, dx: e.dx, dz: e.dz, h, hw: e.width / 2 + 1.2, slope: (edgeHeight(e, Math.min(e.len, s + 2.5)) - edgeHeight(e, Math.max(0, s - 2.5))) / 5, ref: e });
      }
    }
    const track = this.tramTrack;
    if (track) for (const dir of [1, -1]) {
      const P = track.path(dir);
      for (let s = 2.5; s < P.len; s += 5) {
        const h = track.heightAt(dir, s);
        if (h > 0.4) { const p = P.at(s); items.push({ x: p.x, z: p.z, dx: p.dx, dz: p.dz, h, hw: TRAM.lane + 0.2, slope: (track.heightAt(dir, s + 2.5) - track.heightAt(dir, s - 2.5)) / 5, ref: P }); }
      }
    }
    if (!items.length) return;
    const grid = new Grid(20);
    for (const it of items) grid.insertAABB(it, it.x, it.z, it.x, it.z);
    const geos = [], q = [];
    for (const a of items) {
      // solo verso destra: ogni coppia si considera una volta
      const rx = -a.dz, rz = a.dx;
      let best = null;
      for (const b of grid.query(a.x, a.z, 16, q)) {
        if (b.ref === a.ref || Math.abs(a.dx * b.dx + a.dz * b.dz) < 0.9) continue;
        const ox = b.x - a.x, oz = b.z - a.z, lat = ox * rx + oz * rz;
        if (lat <= 0 || Math.abs(ox * a.dx + oz * a.dz) > 3) continue;
        if (!best || lat < best.lat) best = { b, lat };
      }
      if (!best) continue;
      const { b, lat } = best, gap = lat - a.hw - b.hw;
      if (gap < 0.05 || gap > 10 || Math.abs(a.h - b.h) > 1.5) continue;
      const h = Math.min(a.h, b.h), off = a.hw + gap / 2;
      geos.push(new THREE.BoxGeometry(gap + 0.3, 0.8, 5.2).rotateX(-Math.atan(a.slope)).rotateY(Math.atan2(a.dx, a.dz)).translate(a.x + rx * off, Y_ROAD + h - 0.43, a.z + rz * off));
    }
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color: 0xb9b4aa }));
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    this.deckJoins = geos.length;
  }

  // Impalcati in quota della pianta delle strade (strade e tram uniti, come il Cavalcavia Borgomagno): piano superiore
  // alla quota della strada o del binario più vicino, fascia laterale, parapetti lungo il bordo (non dove il bordo
  // attraversa una carreggiata o un binario: lì l'impalcato finisce e comincia la rampa)
  buildDecks() {
    const D = this.net.surfaces && this.net.surfaces.decks;
    if (!D || !D.length) return;
    const track = this.tramTrack, q = [];
    const near = (x, z) => {
      let best = Infinity, h = 0, cross = false;
      for (const it of this.segGrid.query(x, z, 16, q)) {
        if (it.kind !== 'road' || !it.ref || !it.ref.elev) continue;
        const r = distToSeg(x, z, it.ax, it.az, it.bx, it.bz), sc = Math.max(0, r.d - it.hw);
        if (r.d < it.hw + 0.6) cross = true;
        if (sc < best) { best = sc; h = edgeHeight(it.ref, r.t * it.ref.len); }
      }
      if (track) for (const d of [1, -1]) {
        const P = track.path(d), pr = P.project(x, z);
        if (pr.d > 16) continue;
        const sc = Math.max(0, pr.d - TRAM.lane - 0.3);
        if (pr.d < TRAM.lane + 0.9) cross = true;
        if (sc < best) { best = sc; h = track.heightAt(d, pr.s); }
      }
      return { h, cross };
    };
    const top = new GeoBuilder(), side = new GeoBuilder(), par = new GeoBuilder();
    const H = new Map(), at = (x, z) => { const k = x + ',' + z; if (!H.has(k)) H.set(k, near(x, z)); return H.get(k); };
    for (const rings of D) {
      top.polygonH(rings, (x, z) => Y_ROAD + at(x, z).h - 0.02, 8, 4);
      for (const r of rings) for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length, ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
        const A = at(ax, az), B = at(bx, bz), ya = Y_ROAD + A.h - 0.02, yb = Y_ROAD + B.h - 0.02;
        side.quad([ax, ya - 0.9, az], [bx, yb - 0.9, bz], [ax, ya, az], [bx, yb, bz], [0, 0, 1, 0, 0, 1, 1, 1]);
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, M = near(mx, mz);
        if (A.h < 0.5 || B.h < 0.5 || M.cross) continue;
        par.quad([ax, ya, az], [bx, yb, bz], [ax, ya + 1.0, az], [bx, yb + 1.0, bz], [0, 0, 1, 0, 0, 1, 1, 1]);
        const l = Math.hypot(bx - ax, bz - az);
        if (l > 0.3) this.addObstacle(mx, mz, l / 2, 0.25, Math.atan2(-(bz - az), bx - ax), 'wall');
      }
    }
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
    const tm = new THREE.Mesh(top.build(), mat(0xb9b4aa)), sm = new THREE.Mesh(side.build(), mat(0xa9a397)), pm = new THREE.Mesh(par.build(), mat(0xcfc8bb));
    tm.receiveShadow = true; sm.castShadow = pm.castShadow = true;
    this.group.add(tm, sm, pm);
  }

  // quota della strada in quota più vicina (per il binario del tram che corre accanto al cavalcavia)
  // quota del cavalcavia che il binario affianca (direzione dx, dz): contano solo le strade in quota quasi parallele;
  // quelle che lo scavalcano di traverso (Corso Tredici Giugno a Pontevigodarzere) gli passano sopra
  nearElevatedHeight(x, z, dx, dz) {
    const arr = this.segGrid.query(x, z, 18, this._qe || (this._qe = []));
    let h = 0, bd = Infinity;
    for (const it of arr) {
      const e = it.ref;
      if (it.kind !== 'road' || !e || !e.elev) continue;
      if (dx != null && Math.abs(dx * e.dz - dz * e.dx) > 0.7) continue;
      const r = distToSeg(x, z, it.ax, it.az, it.bx, it.bz);
      if (r.d < it.hw + 9 && r.d < bd) { bd = r.d; h = edgeHeight(e, r.t * e.len); }
    }
    return h;
  }
  // tram: c'è la linea aerea sopra il binario di verso dir alla progressiva s?
  catenaryAt(dir, s) { return !this.tramTrack || this.tramTrack.wireAt(dir, s); }

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
    // con la pianta delle strade: il bordo vero dell'asfalto, attraversando la carreggiata dall'asse
    const kerb = this.asphRings ? (cx, cz, rx, rz, hw) => {
      let seen = this.surfaceOff(cx, cz) < 0;
      for (let o = 0.2; o <= hw + 8; o += 0.2) {
        if (this.surfaceOff(cx + rx * o, cz + rz * o) < 0) seen = true;
        else if (seen || o > hw) {
          // il bordo è tra o - 0,2 e o: si stringe a 2,5 cm (il bus si accosta a 30 cm dal cordolo, non sopra)
          let a = o - 0.2, b = o;
          for (let i = 0; i < 3; i++) { const m = (a + b) / 2; if (this.surfaceOff(cx + rx * m, cz + rz * m) < 0) a = m; else b = m; }
          return (a + b) / 2;
        }
      }
      return null;
    } : null;
    // fuori da ogni carreggiata: con la pianta delle strade conta l'asfalto vero, non il nastro dell'arco
    const clear = this.asphRings ? (x, z) => Math.min(this.surfaceOff(x, z), this.clearance(x, z, ['tram'], 20) + 0.3) : (x, z) => this.clearance(x, z, ['road', 'tram'], 20);
    this.stopPlacements = allStopPlacements(this.net, (x, z) => this.snapToRoad(x, z), clear, kerb);
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
      // locale: z = direzione strada, +x = verso la carreggiata. La pensilina c'è dove OSM la segna (o non dice
      // niente); dove OSM dice che non c'è, solo la palina e, se c'è, la panchina
      const shelter = st.shelter !== 0;
      if (shelter) {
        put(new THREE.BoxGeometry(1.9, 0.12, 5), 0, 2.45, -3, frames);
        put(new THREE.BoxGeometry(0.06, 2.1, 5), -0.85, 1.25, -3, glasses);
        for (const dz of [-5.4, -0.6]) for (const dx of [-0.85, 0.85]) put(new THREE.BoxGeometry(0.08, 2.45, 0.08), dx, 1.22, dz, frames);
      }
      if (shelter || st.bench === 1) put(new THREE.BoxGeometry(0.45, 0.08, 3.2), -0.55, 0.5, -3, benches);
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
      if (shelter && this.clearance(grp.position.x - st.dx * 3, grp.position.z - st.dz * 3, ['road'], 20) > 0.8) this.addObstacle(grp.position.x - st.dx * 3, grp.position.z - st.dz * 3, 2.6, 1.0, Math.atan2(-st.dz, st.dx), 'shelter');
      // segnaletica gialla della fermata (stile italiano): zig-zag all'ingresso e all'uscita,
      // linea tratteggiata lato corsia e la scritta BUS, leggibile da chi arriva. Dove si ferma il bus: al cordolo
      // vero (1,6 m dal bordo all'asse del bus), seguendolo anche dove non è parallelo all'asse della strada
      const y = Y_ROAD + 0.025, kb = (st.kl ?? st.kerb ?? st.hw) - 1.6, ks = st.ks || 0;
      const p = (o, w) => { const l = kb + ks * o + w; return [st.cx + st.dx * o + st.rx * l, y, st.cz + st.dz * o + st.rz * l]; };
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
  // Con i nodi OSM: STOP e dare precedenza dove sono davvero, diritto di precedenza sulla strada principale degli
  // incroci con un cartello sulle laterali. Senza: cartelli dedotti dal tipo di strada. Le rotatorie hanno sempre
  // il dare precedenza agli ingressi.
  buildSigns() {
    const { nodes, signs: real } = this.net;
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
    // il braccio e dell'incrocio n verso l'esterno, oltre i vertici intermedi della via (nodi con due soli archi):
    // tratti { arc, from, o, d0 } fino a maxD metri; end = fin dove può stare la linea d'arresto
    const armChain = (n, e, maxD) => {
      const chain = [];
      let from = n, arc = e, d0 = 0, to;
      for (;;) {
        const o = arc.a === from.id ? 1 : -1;
        chain.push({ arc, from, o, d0 });
        to = nodes[o > 0 ? arc.b : arc.a];
        d0 += arc.len;
        if (d0 >= maxD || to.edges.length !== 2) break;
        arc = to.edges[0] === arc ? to.edges[1] : to.edges[0];
        from = to;
      }
      chain.end = d0 - (to.edges.length >= 3 ? (to.trim ? to.trim.get(arc) : to.radius) + 1.5 : 0);
      return chain;
    };
    // punto e direzione (verso l'esterno) a d metri dal centro dell'incrocio
    const pointAt = (chain, d) => {
      const c = chain.find((c) => d <= c.d0 + c.arc.len) || chain[chain.length - 1];
      const dx = c.arc.dx * c.o, dz = c.arc.dz * c.o, t = d - c.d0;
      return { x: c.from.x + dx * t, z: c.from.z + dz * t, dx, dz, arc: c.arc };
    };
    const y0 = Y_SIDEWALK, yl = Y_ROAD + 0.022;
    for (const n of Object.values(nodes)) {
      const deg = n.edges.length;
      if (deg < 3 || n.signal || n.edges.some((e) => e.elev || e.tunnel) || n.edges.every((e) => e.ped)) continue;
      const roundabout = n.edges.some((e) => e.roundabout);
      const best = Math.min(...n.edges.map(rank));
      const mainCls = Math.min(...n.edges.map((e) => e.cls));
      const signed = real && n.edges.some((e) => real.has(`${n.id}:${e.id}`));
      n.edges.forEach((e, k) => {
        if (e.ped || !arrives(e, n)) return;
        const key = `${n.id}:${e.id}`;
        let kind = -1;
        if (roundabout) { if (!e.roundabout) kind = real && real.has(key) ? real.get(key) : 1; }
        else if (real) {
          if (real.has(key)) kind = real.get(key);
          else if (signed && e.cls <= 3 && rank(e) === best) kind = 3;
        }
        else if (e.service && e.cls >= 7) return;
        else if (e.cls > mainCls && rank(e) > best + 5) kind = mainCls <= 2 && e.cls >= 5 && rnd(n.id, k) < 0.5 ? 0 : 1;
        else if (e.cls <= 3 && rank(e) === best && rnd(n.id, k + 7) < 0.25) kind = 3;
        if (kind < 0) return;
        const trim = n.trim ? n.trim.get(e) : n.radius;
        const chain = armChain(n, e, trim + 14);
        // linea d'arresto subito prima delle strisce pedonali vicine all'incrocio
        const cross = [];
        for (const c of chain) for (const s of c.arc.cross || []) {
          const d = c.d0 + (c.o > 0 ? s : c.arc.len - s);
          if (d < trim + 10) cross.push(d);
        }
        const at = cross.length ? Math.max(...cross) + 2.4 : trim + 0.8;
        if (real ? at + 0.6 > chain.end : at > e.len * 0.6) return;
        const q = pointAt(chain, at), dx = q.dx, dz = q.dz, hw = q.arc.width / 2;
        // a destra di chi arriva: (dz, -dx)
        let px = 0, pz = 0, ok = false;
        for (const off of [hw + 0.8, hw + 1.6]) {
          px = q.x + dx * 0.6 + dz * off; pz = q.z + dz * 0.6 - dx * off;
          if (this.clearance(px, pz, ['road', 'tram'], 10) > 0.25) { ok = true; break; }
        }
        if (!ok) return;
        const ang = Math.atan2(dx, dz), h = (n.h || 0);
        poles.push(poleG.clone().translate(px, y0 + h, pz));
        plate(kind, px, y0 + h + (roundabout ? 2.45 : 2.3), pz, ang, 0.85);
        if (roundabout) plate(2, px, y0 + h + 1.65, pz, ang, 0.7);
        // linea di arresto (STOP) o tratteggio (precedenza) sulla corsia di chi arriva
        if (kind === 0 || kind === 1) {
          // con le corsie di OSM dalla riga che separa i versi (anche quella gialla di una corsia dei bus in controsenso)
          const span = q.arc.osmLanes ? laneSpan(q.arc, dx * q.arc.dx + dz * q.arc.dz < 0) : null;
          const w0 = span && span[0] > -hw ? span[0] + 0.1 : q.arc.oneway ? -hw + 0.3 : 0.1, w1 = hw - 0.3, lw = kind === 0 ? 0.25 : 0.15;
          const P = (a, w) => [q.x + dx * a + dz * w, yl + h, q.z + dz * a - dx * w];
          const seg = (a0, a1, wa, wb) => lines.quad(P(a0, wa), P(a0, wb), P(a1, wa), P(a1, wb), [0, 0, 1, 0, 0, 1, 1, 1]);
          if (kind === 0) seg(-lw, lw, w1, w0);
          else for (let w = w0; w < w1 - 0.3; w += 1.0) seg(-lw, lw, Math.min(w + 0.5, w1), w);
        }
        if (kind === 0) {
          const s = { x: q.x + dz * hw / 2, z: q.z - dx * hw / 2, dx: -dx, dz: -dz, hw };
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
    const T = tile && tile.half ? tile.half : (this.tileSize || 400) / 2 + 80;
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
    // tratti di linea senza strada (salti dell'aggancio al confine della mappa): liberali comunque (in un'area arrivata
    // dopo, solo i punti dentro l'area)
    if (!tile || tile.half) {
      for (const L of LINES) for (const v of L.variants) for (let i = 0; i < v.nodes.length - 1; i++) {
        if (this.net.edgeBetween(v.nodes[i], v.nodes[i + 1])) continue;
        const A = nodes[v.nodes[i]], B = nodes[v.nodes[i + 1]];
        const l = Math.hypot(B.x - A.x, B.z - A.z);
        for (let s = 0; s <= l; s += 2) {
          const x = A.x + ((B.x - A.x) * s) / l, z = A.z + ((B.z - A.z) * s) / l;
          if (tile && (Math.abs(x - tile.cx) > T || Math.abs(z - tile.cz) > T)) continue;
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
    // gli edifici sono divisi in riquadri da 400 m costruiti a richiesta (prima quelli vicini al bus)
    this.tileSize = 400;
    this.tiles = new Map();
    this.tilesBuilt = 0;
    this.bMat = makeBuildingMaterial(this.uniforms, true);
    this.rMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (this.net.areas) {
      // mappa divisa in aree da 800 m (src/data/aree.js): edifici, marciapiedi, verde e alberi arrivano con la loro area,
      // che si scarica quando il bus si avvicina e si libera quando si allontana
      this.areas = new Map();
      for (const key of AREA_KEYS) {
        const [ix, iz] = key.split('_').map(Number);
        this.areas.set(key, { key, cx: (ix + 0.5) * AREA_SIZE, cz: (iz + 0.5) * AREA_SIZE, added: false, meshes: [], obs: [], tiles: [] });
      }
      this.realBuildingCount = 0;
    } else {
      const list = this.net.buildings;
      if (!list || !list.length) return;
      this.realBuildingCount = list.length;
      this.addBuildings(list, null);
    }
    const p = this.net.landmarks.prato;
    if (p) this.ensureTiles(p.x, p.z, 700);
  }

  // edifici nei riquadri da 400 m (per baricentro dei vertici, come le aree di scripts/aree_mappa.py)
  addBuildings(list, area) {
    const T = this.tileSize;
    for (const b of list) {
      let cx = 0, cz = 0;
      for (const p of b.pts) { cx += p.x; cz += p.z; }
      b.cx = cx / b.pts.length; b.cz = cz / b.pts.length;
      const ix = Math.floor(b.cx / T), iz = Math.floor(b.cz / T), key = ix + ',' + iz;
      let t = this.tiles.get(key);
      if (!t) {
        this.tiles.set(key, (t = { key, cx: (ix + 0.5) * T, cz: (iz + 0.5) * T, list: [], built: false, meshes: [], obs: [] }));
        if (area) area.tiles.push(t);
      }
      t.list.push(b);
    }
    this._order = null;
  }

  // ---- aree a richiesta ----
  // area arrivata: marciapiedi, verde e alberi subito, edifici nei riquadri (costruiti da ensureTiles e streamTiles)
  addArea(A, d) {
    A.added = true;
    const walk = new GeoBuilder(), green = new GeoBuilder();
    for (const [, , W, V] of d.celle) {
      for (const poly of W || []) walk.polygon(poly, Y_SIDEWALK, 6);
      for (const poly of V || []) green.polygon(poly, Y_GREEN, 8);
    }
    if (walk.pos.length) { const m = new THREE.Mesh(walk.build(), this.walkMat); m.receiveShadow = true; A.meshes.push(m); }
    if (green.pos.length) { const m = new THREE.Mesh(green.build(), this.greenMat); m.receiveShadow = true; m.renderOrder = -0.4; A.meshes.push(m); }
    // alberi veri del DBGT (filari, aree alberate, boschi), fuori dalle strade e dalla sede del tram
    const trees = [];
    for (let i = 0; i < d.alberi.length; i += 2) {
      const x = d.alberi[i], z = d.alberi[i + 1];
      if (this.clearance(x, z, ['road', 'tram'], 12) < 0.8) continue;
      trees.push([x, z]);
      A.obs.push(this.addObstacle(x, z, 0.35, 0.35, 0, 'tree'));
    }
    if (trees.length) {
      const K = this.trees3d(), trunks = new THREE.InstancedMesh(K.trunkG, K.trunkMat, trees.length), crowns = new THREE.InstancedMesh(K.crownG, K.crownMat, trees.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
      // misura, rotazione e colore dal punto: lo stesso albero è uguale ogni volta che l'area torna
      const hash = (x, z, k) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
      trees.forEach(([x, z], i) => {
        const s = 1.1 + hash(x, z, 1) * 0.6;
        Q.setFromAxisAngle(Y, hash(x, z, 2) * 6.28);
        M.compose(P.set(x, 0, z), Q, S.set(s, s * (0.9 + hash(x, z, 3) * 0.3), s));
        trunks.setMatrixAt(i, M);
        crowns.setMatrixAt(i, M);
        col.setHSL(0.22 + hash(x, z, 4) * 0.08, 0.35 + hash(x, z, 5) * 0.2, 0.22 + hash(x, z, 6) * 0.12);
        crowns.setColorAt(i, col);
      });
      trunks.castShadow = crowns.castShadow = true;
      A.meshes.push(trunks, crowns);
    }
    for (const m of A.meshes) this.group.add(m);
    const list = d.edifici.map(parseBuilding);
    this.realBuildingCount += list.length;
    A.buildings = list.length;
    this.addBuildings(list, A);
    // le strade dei bus restano libere anche dagli alberi dell'area
    if (this.busRoadsCleared) this.clearBusRoads({ cx: A.cx, cz: A.cz, half: AREA_SIZE / 2 + 80 });
  }

  // area lontana: via mesh, ostacoli e riquadri degli edifici; i dati si riscaricano se torna a servire
  removeArea(A) {
    for (const m of A.meshes) this.disposeMesh(m);
    for (const b of A.obs) this.removeObstacle(b);
    for (const t of A.tiles) {
      for (const m of t.meshes) this.disposeMesh(m);
      for (const b of t.obs) this.removeObstacle(b);
      if (t.built) this.tilesBuilt--;
      this.tiles.delete(t.key);
    }
    this.realBuildingCount -= A.buildings || 0;
    Object.assign(A, { added: false, meshes: [], obs: [], tiles: [], buildings: 0 });
    this._order = null;
    dropArea(A.key);
  }

  disposeMesh(o) {
    this.group.remove(o);
    o.traverse((m) => {
      if (m.isInstancedMesh) { m.dispose(); return; } // geometrie e materiali degli alberi sono condivisi
      if (m.geometry) m.geometry.dispose();
      for (const mt of [].concat(m.material || [])) if (![this.bMat, this.rMat, this.walkMat, this.greenMat].includes(mt)) mt.dispose();
    });
  }

  removeObstacle(b) {
    const r = Math.hypot(b.hx, b.hz);
    this.obstacles.remove(b, b.x - r, b.z - r, b.x + r, b.z + r);
    this.obstacleCount--;
  }

  // aree entro r metri da (x, z): quelle già scaricate si aggiungono subito, le altre si chiedono
  syncAreas(x, z, r) {
    for (const k of areaKeysNear(x, z, r)) {
      const A = this.areas.get(k);
      if (A.added) continue;
      const d = areaData(k);
      if (d) this.addArea(A, d);
      else this.fetchArea(A);
    }
  }

  // scarica l'area; se non arriva (rete assente) non si aspetta più, e streamTiles riprova
  fetchArea(A) {
    requestArea(A.key).then(() => { A.failed = false; }, (e) => { A.failed = true; console.warn(e.message); });
  }

  // le aree entro r metri da (x, z) sono tutte aggiunte (per le prove e per chi aspetta la partenza)
  areasReady(x, z, r = 650) {
    return !this.areas || areaKeysNear(x, z, r).every((k) => this.areas.get(k).added || this.areas.get(k).failed);
  }

  // tutta la mappa (rapporto di verifica): scarica e aggiunge tutte le aree, che non si liberano più
  async loadAll() {
    if (!this.areas) return;
    await loadAllAreas();
    this.keepAreas = true;
    for (const A of this.areas.values()) if (!A.added) this.addArea(A, areaData(A.key));
  }

  // costruisce subito i riquadri entro r metri (es. all'avvio o dopo un teletrasporto); con le aree a richiesta, quelle
  // non ancora scaricate arrivano dopo (streamTiles)
  ensureTiles(x, z, r) {
    if (!this.tiles) return;
    if (this.areas) this.syncAreas(x, z, r + this.tileSize);
    for (const t of this.tiles.values()) if (!t.built && Math.hypot(t.cx - x, t.cz - z) < r + this.tileSize * 0.71) this.buildTile(t);
  }

  // a ogni fotogramma: aree vicine scaricate e aggiunte, lontane liberate; qualche riquadro costruito in sottofondo e
  // quelli lontani nascosti
  streamTiles(x, z, budgetMs = 6) {
    if (!this.tiles) return;
    const t0 = performance.now();
    if (this.areas) {
      if (!this._areaT || t0 - this._areaT > 1000) {
        this._areaT = t0;
        this._near = areaKeysNear(x, z, AREA_NEAR).map((k) => this.areas.get(k)).sort((a, b) => Math.hypot(a.cx - x, a.cz - z) - Math.hypot(b.cx - x, b.cz - z));
        for (const A of this._near) if (!A.added) this.fetchArea(A);
        if (!this.keepAreas) {
          const far = new Set(areaKeysNear(x, z, AREA_FAR));
          for (const A of this.areas.values()) if (A.added && !far.has(A.key)) this.removeArea(A);
        }
      }
      // al più un'area nuova per fotogramma (marciapiedi, verde e alberi in qualche millisecondo)
      const A = this._near.find((a) => !a.added && areaData(a.key));
      if (A) this.addArea(A, areaData(A.key));
    }
    if (!this._order || performance.now() - (this._orderT || 0) > 1500) {
      this._order = [...this.tiles.values()].filter((t) => !t.built).sort((a, b) => Math.hypot(a.cx - x, a.cz - z) - Math.hypot(b.cx - x, b.cz - z));
      this._orderT = performance.now();
    }
    while (this._order.length && performance.now() - t0 < budgetMs) {
      const t = this._order.shift();
      if (!t.built && this.tiles.has(t.key)) this.buildTile(t);
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
      // seme per lo shader: negativo = portici misurati alti -seme; sopra 0,42 = niente portici (misurato senza); se non
      // misurato, a caso nel centro
      const seed = b.por > 0 ? -b.por : b.por === 0 ? 0.42 + r * 0.58 : r;
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
          for (const k of order) { W.pos.push(...v[k]); W.nrm.push(nx, 0, nz); W.col.push(col.r, col.g, col.b); W.seed.push(seed); W.h.push(h); }
          tile.obs.push(this.addObstacle((p.x + q.x) / 2, (p.z + q.z) / 2, l / 2, 0.3, Math.atan2(-ez, ex), 'building'));
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
  // tronco e chioma degli alberi, condivisi con quelli delle aree
  trees3d() {
    if (!this.treeKit) {
      const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
      trunkG.translate(0, 1.5, 0);
      const crownG = new THREE.IcosahedronGeometry(2.4, 1);
      crownG.translate(0, 4.6, 0);
      this.treeKit = { trunkG, crownG, trunkMat: new THREE.MeshLambertMaterial({ color: 0x5a4330 }), crownMat: new THREE.MeshLambertMaterial({ color: 0xffffff }) };
    }
    return this.treeKit;
  }

  buildTreesAndLamps() {
    const { nodes, edges } = this.net;
    const rnd = this.rnd;
    const trees = [...(this.pratoTrees || []), ...(this.fillerTrees || [])];
    const lamps = [];
    // alberi veri del DBGT (filari, aree alberate, boschi) dentro il comune; lì non se ne generano altri
    const SF = this.net.surfaces;
    const dbgt = SF && SF.dbgt ? SF.dbgt.map((p) => { const r = p[0], pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]); return pts; }) : [];
    const inDbgt = (x, z) => dbgt.some((pts) => pointInPoly(x, z, pts));
    if (SF && SF.trees) for (let i = 0; i < SF.trees.length; i += 2) {
      const x = SF.trees[i], z = SF.trees[i + 1];
      if (this.clearance(x, z, ['road', 'tram'], 12) < 0.8) continue;
      trees.push({ x, z, big: true });
      this.addObstacle(x, z, 0.35, 0.35, 0, 'tree');
    }
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
        // fuori dall'asfalto vero (la pianta delle strade è spesso più larga della via del grafo): il palo si sposta
        // verso l'esterno fino a 3 m, altrimenti non si mette
        let x, z, ok = false;
        for (const extra of [0, 1, 2, 3]) {
          const off = e.width / 2 + 1.9 + extra;
          x = A.x + e.dx * s + -e.dz * side * off; z = A.z + e.dz * s + e.dx * side * off;
          if (this.clearance(x, z, ['road', 'tram']) < 1.6) break;
          if (!this.asphRings || this.surfaceOff(x, z) >= 0.5) { ok = true; break; }
        }
        if (!ok) continue;
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
        if (dbgt.length && inDbgt(x, z)) continue;
        if (this.clearance(x, z, ['road', 'tram']) < 1.8) continue;
        // fuori dall'asfalto vero, come i lampioni
        if (this.asphRings && this.surfaceOff(x, z) < 0.5) continue;
        if (Math.hypot(...lamps.length ? [lamps[lamps.length - 1].x - x, lamps[lamps.length - 1].z - z] : [99, 99]) < 4) continue;
        trees.push({ x, z });
        this.addObstacle(x, z, 0.35, 0.35, 0, 'tree');
      }
    }
    // alberi sparsi nei parchi/campagna
    for (let i = 0; i < 2500; i++) {
      const x = (rnd() - 0.5) * 9000, z = (rnd() - 0.5) * 9000;
      if (dbgt.length && inDbgt(x, z)) continue;
      if (this.clearance(x, z) < 8) continue;
      if (this.asphRings && this.surfaceOff(x, z) < 1) continue; // piazzali e parcheggi asfaltati fuori dal grafo
      trees.push({ x, z, big: true });
    }
    const K = this.trees3d();
    const trunks = new THREE.InstancedMesh(K.trunkG, K.trunkMat, trees.length);
    const crowns = new THREE.InstancedMesh(K.crownG, K.crownMat, trees.length);
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
    if (this.asphMat) this.asphMat.color.setScalar(1 - wet * 0.35);
    if (this.upMat) this.upMat.color.setScalar(1 - wet * 0.35);
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
