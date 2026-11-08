import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Y_ROAD, TRAM_HW, zoneOf, edgeHeight } from './city.js';
import { mulberry32, distToSeg } from './spatial.js';
import { ledTexture } from './textures.js';
import { TrackPath } from '../tram/tram.js';
import { buildRoute, alignStops, busCan } from '../game/routes.js';
import { scheduleFor } from '../game/mission.js';
import { driverGeometry, ARM_PIVOT, setWave } from './driver.js';

// ------------------------------------------------------------------
// Bus automatici delle linee urbane, dall'orario GTFS: in servizio ci sono le corse che a quell'ora sono per strada
// (nei feriali fino a una settantina al mattino), ognuna sul suo percorso. Arrivano al capolinea da una strada vicina
// qualche minuto prima della partenza, aspettano a porte aperte, fermano alle fermate (non a tutte: sono a richiesta),
// rispettano semafori, incroci col tram e chi hanno davanti; dopo l'ultima fermata escono "fuori servizio".
// Si muovono tutti lungo la corsia del loro percorso; solo quelli vicini al giocatore hanno un modello 3D.
// ------------------------------------------------------------------

const LEAD = 260, EXIT = 320; // metri di strada prima del capolinea di partenza e dopo quello di arrivo
const VLEAD = 7; // velocità media stimata per entrare e uscire di linea (m/s)
const FRONT = 6; // dal centro del bus al muso
const STEP = 2; // passo dei punti della corsia (m)
const R_VIS = 560, MAX_VIS = 16; // modelli: entro questa distanza dal giocatore, al massimo tanti
const NEAR = 700; // oltre questa distanza non si guarda chi c'è davanti (nessuno lo vede)
const DOOR_T = 1.6; // secondi per aprire o chiudere le porte
const DRIVER = [0.62, 0, 4.5]; // autista: seduto a sinistra, dietro al cruscotto

// corsia del bus: sui doppi sensi quella di destra, sui sensi unici stretti il centro
const laneLat = (e) => (!e ? 1.8 : e.oneway ? (e.width < 8 ? 0 : e.width / 2 - 2) : Math.max(e.width / 4, e.width / 2 - 2.2));
// prosecuzione più dritta possibile lungo il grafo: avanti (uscita dall'ultima fermata, arrivando da prev) o indietro
// (strada da cui si arriva al capolinea: prev è il nodo successivo sul percorso)
function walk(net, from, prev, maxLen, back) {
  const out = [], seen = new Set([from, prev]);
  let cur = from, p = prev, len = 0;
  while (len < maxLen) {
    const C = net.nodes[cur], P = net.nodes[p];
    let dx = back ? P.x - C.x : C.x - P.x, dz = back ? P.z - C.z : C.z - P.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    let best = null, bd = 0.25;
    for (const e of C.edges) {
      const m = e.a === cur ? e.b : e.a;
      if (seen.has(m) || !busCan(e, back ? m : cur)) continue;
      const M = net.nodes[m], ex = back ? C.x - M.x : M.x - C.x, ez = back ? C.z - M.z : M.z - C.z, el = Math.hypot(ex, ez) || 1;
      const sc = (ex * dx + ez * dz) / el + (e.main ? 0.15 : 0) - (e.service ? 0.3 : 0);
      if (sc > bd) { bd = sc; best = { m, el }; }
    }
    if (!best) break;
    out.push(best.m);
    seen.add(best.m);
    len += best.el;
    p = cur; cur = best.m;
  }
  return out;
}

// Corsia di una variante: avvicinamento + percorso + uscita, spostata a destra della mezzeria e smussata, con fermate,
// semafori, incroci col tram e velocità massima punto per punto (curve e limiti), tutto in progressiva lungo la corsia
function buildLane(net, city, v, tramSignals) {
  const route = buildRoute(net, v);
  if (city.stopPlacements) alignStops(route, city.stopPlacements);
  const seq = route.seq;
  const lead = seq.length > 1 ? walk(net, seq[0], seq[1], LEAD, true).reverse() : [];
  const exit = seq.length > 1 ? walk(net, seq[seq.length - 1], seq[seq.length - 2], EXIT, false) : [];
  const ids = [...lead, ...seq, ...exit];
  const N = ids.map((id) => net.nodes[id]);
  const cum = [0], segs = [];
  for (let i = 0; i < N.length - 1; i++) {
    const dx = N[i + 1].x - N[i].x, dz = N[i + 1].z - N[i].z, len = Math.hypot(dx, dz) || 0.01;
    const e = net.edgeBetween(ids[i], ids[i + 1]);
    segs.push({ e, dx: dx / len, dz: dz / len, len, lat: laneLat(e), fwd: e ? e.a === ids[i] : true });
    cum.push(cum[i] + len);
  }
  // estremi dei tratti spostati di lato, uniti nel punto d'incontro delle due rette (smussato dopo)
  const raw = [];
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i], h = segs[i + 1];
    const B = { x: N[i + 1].x - g.dz * g.lat, z: N[i + 1].z + g.dx * g.lat, cs: cum[i + 1] };
    if (i === 0) raw.push({ x: N[0].x - g.dz * g.lat, z: N[0].z + g.dx * g.lat, cs: 0 });
    if (!h) { raw.push(B); break; }
    const B2 = { x: N[i + 1].x - h.dz * h.lat, z: N[i + 1].z + h.dx * h.lat, cs: cum[i + 1] };
    const cross = g.dx * h.dz - g.dz * h.dx;
    if (Math.abs(cross) > 0.08) {
      const t = ((B2.x - B.x) * h.dz - (B2.z - B.z) * h.dx) / cross, u = ((B2.x - B.x) * g.dz - (B2.z - B.z) * g.dx) / cross;
      const X = { x: B.x + g.dx * t, z: B.z + g.dz * t, cs: cum[i + 1] };
      if (t > -0.9 * g.len && u < 0.9 * h.len && Math.hypot(X.x - N[i + 1].x, X.z - N[i + 1].z) < 10) { raw.push(X); continue; }
    }
    raw.push(B);
    if (Math.hypot(B2.x - B.x, B2.z - B.z) > 0.05) raw.push(B2);
  }
  // punti ogni ~2 m, poi media mobile (curve e cambi di corsia senza spigoli)
  const pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i], d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(d / STEP));
    for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, cs: a.cs + ((b.cs - a.cs) * k) / n });
  }
  for (let pass = 0; pass < 2; pass++) {
    const src = pts.map((p) => ({ x: p.x, z: p.z }));
    for (let i = 3; i < pts.length - 3; i++) {
      let x = 0, z = 0;
      for (let j = -3; j <= 3; j++) { x += src[i + j].x; z += src[i + j].z; }
      pts[i].x = x / 7; pts[i].z = z / 7;
    }
  }
  const segAt = (cs) => {
    let lo = 0, hi = cum.length - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= cs) lo = m; else hi = m - 1; }
    return lo;
  };
  // fuori dalla sede del tram dove la strada le corre accanto (come le auto), non sulle corsie riservate che la
  // percorrono (Cavalcavia Borgomagno) né dove la si attraversa
  const shift = new Float32Array(pts.length), q = [];
  for (let i = 0; i < pts.length; i++) {
    const g = segs[segAt(pts[i].cs)];
    if (g.e && g.e.psv) continue;
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)], p = pts[i];
    let dx = c.x - a.x, dz = c.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    let best = null;
    for (const it of city.segGrid.query(p.x, p.z, TRAM_HW + 4, q)) {
      if (it.kind !== 'tram') continue;
      const sx = it.bx - it.ax, sz = it.bz - it.az;
      if (Math.abs(dx * sz - dz * sx) > 0.5 * (Math.hypot(sx, sz) || 1)) continue;
      const r = distToSeg(p.x, p.z, it.ax, it.az, it.bx, it.bz);
      if (!best || r.d < best.d) best = { d: r.d, t: r.t, it };
    }
    const need = best ? best.it.hw + 1.45 - best.d : 0;
    if (need <= 0) continue;
    const { it, t } = best, qx = it.ax + (it.bx - it.ax) * t, qz = it.az + (it.bz - it.az) * t;
    // senza uscire dalla carreggiata: dove la strada è la sede stessa (Via Belludi) si passa sui binari
    const room = g.e ? g.e.width / 2 - 1.3 : 3;
    shift[i] = Math.max(-room - g.lat, Math.min(room - g.lat, ((p.x - qx) * -dz + (p.z - qz) * dx >= 0 ? 1 : -1) * Math.min(3, need)));
  }
  if (shift.some((x) => x)) {
    const sm = shift.map((_, i) => { let a = 0, n = 0; for (let j = Math.max(0, i - 5); j <= Math.min(shift.length - 1, i + 5); j++) { a += shift[j]; n++; } return a / n; });
    for (let i = 0; i < pts.length; i++) {
      if (!sm[i]) continue;
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      pts[i].x += (-(c.z - a.z) / l) * sm[i]; pts[i].z += ((c.x - a.x) / l) * sm[i];
    }
  }
  const P = new TrackPath(pts.map((p) => ({ x: p.x, z: p.z })));
  const CS = pts.map((p) => p.cs);
  // progressiva sulla corsia di un punto della mezzeria (cs)
  const ls = (cs) => {
    let lo = 0, hi = CS.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (CS[m] <= cs) lo = m; else hi = m; }
    const f = CS[hi] > CS[lo] ? Math.max(0, Math.min(1, (cs - CS[lo]) / (CS[hi] - CS[lo]))) : 0;
    return P.cum[lo] + (P.cum[hi] - P.cum[lo]) * f;
  };
  const c0 = cum[lead.length];
  // fermate: muso a fine zona di fermata, accostato al marciapiede
  const stops = route.stops.map((st) => {
    const k = segAt(c0 + st.s), sg = segs[k];
    return { fs: ls(c0 + st.s) - 0.5, extra: Math.max(0, st.hw - 1.7 - sg.lat), name: st.name, importance: st.importance, terminal: st.terminal };
  });
  // semafori: linea d'arresto prima del nodo, solo dove c'è una lanterna per chi arriva da quell'arco
  const signals = [];
  for (let k = 1; k < N.length; k++) {
    const n = N[k], e = segs[k - 1].e;
    const ap = n.signal && e && n.signal.appr.find((a) => a.node === n && a.edge === e);
    if (!ap) continue;
    signals.push({ s: ls(cum[k] - (ap.stop ?? (n.radius || 0) + 1.2) - 0.3), node: n, edge: e });
  }
  // incroci a raso con la sede del tram: ci si ferma prima del primo binario se un tram ha chiamato l'incrocio
  const tram = [];
  if (tramSignals && tramSignals.byEdge) segs.forEach((g, k) => {
    const xs = g.e && tramSignals.byEdge.get(g.e);
    if (!xs) return;
    const list = xs.map((x) => ({ x, at: cum[k] + (g.fwd ? x.tE : g.e.len - x.tE) - x.halfE })).sort((a, b) => a.at - b.at);
    for (const it of list) {
      const first = list.find((o) => o.at <= it.at && it.at - o.at < 14) || it;
      tram.push({ x: it.x, s: ls(first.at - 2.5) });
    }
  });
  // velocità massima: curve (accelerazione laterale da bus urbano) e limiti del tratto, poi l'inviluppo di frenata
  const n = P.pts.length, vlim = new Float32Array(n), segOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = segAt(CS[i]), g = segs[k];
    segOf[i] = k;
    const a = P.pts[Math.max(0, i - 4)], b = P.pts[i], c = P.pts[Math.min(n - 1, i + 4)];
    const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z);
    const dl = Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z);
    const kap = dl > 0.5 ? Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) / dl : 0;
    const e = g.e, lim = (Math.min(50, (e && e.speed) || (zoneOf(b.x, b.z) === 0 ? 30 : 50)) / 3.6) * 0.95;
    vlim[i] = Math.min(lim, e && e.roundabout ? 7 : Infinity, Math.sqrt(1.5 / Math.max(kap, 1e-4)));
  }
  for (let i = n - 2; i >= 0; i--) vlim[i] = Math.min(vlim[i], Math.sqrt(vlim[i + 1] * vlim[i + 1] + 2 * 1.1 * (P.cum[i + 1] - P.cum[i])));
  const leadLen = stops.length ? stops[0].fs : 0, exitLen = stops.length ? P.len - stops[stops.length - 1].fs : 0;
  return { P, stops, signals, tram, vlim, segOf, segs, cum, CS, ids, leadLen, exitLen, dest: v.stops[v.stops.length - 1].name };
}

// quota della strada sotto il punto i della corsia (cavalcavia)
function laneHeight(L, i) {
  const k = L.segOf[i], g = L.segs[k];
  if (!g || !g.e || !g.e.elev) return 0;
  const d = L.CS[i] - L.cum[k];
  return edgeHeight(g.e, g.fwd ? d : g.e.len - d);
}

// corse dall'orario: day 'feriale' | 'festivo'
export function busRuns(lines, day) {
  const runs = [];
  for (const L of lines) for (const v of L.variants) for (const { t, d } of v[day] || []) {
    const times = scheduleFor(v, t, d);
    runs.push({ L, v, t, times, end: times[times.length - 1], bus: null, done: false });
  }
  return runs.sort((a, b) => a.t - b.t);
}

// ------------------------------------------------------------------
// Modello leggero (geometrie condivise per livrea, poche mesh per bus)
// ------------------------------------------------------------------
const HW = 1.275, L2 = 6, Y0 = 0.32, YB = 1.12, YW = 2.62, YT = 3.05;
const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const DOORS = [[4.25, 5.45], [0.2, 1.4], [-4.4, -3.2]];
const LIV = {
  moderna: { lower: 0xc3c7cc, upper: 0xd8dbdf, stripe: 0xa6d22e, door: 0x7a1f2b, roof: 0x2a56c6, electric: true },
  storica: { lower: 0xf2992b, upper: 0xebebe7, stripe: 0xf2992b, door: 0xf2992b, roof: 0xe0e0dc, electric: false },
  // versioni semplificate delle livree di src/bus/bus.js (stessi colori, sempre 12 m)
  aps: { lower: 0xf4f4f2, upper: 0xd42430, stripe: 0x141517, door: 0x141517, roof: 0xf0f0ee, electric: false },
  blu: { lower: 0xe4e7ec, upper: 0x2a44c4, stripe: 0x141517, door: 0xc22a30, roof: 0x2a44c4, electric: true },
  busitalia: { lower: 0xf3f3f0, upper: 0xa9cf2c, stripe: 0xa9cf2c, door: 0x24272b, roof: 0xeeeeea, electric: true },
  veneto: { lower: 0xc7cbd2, upper: 0x2c3fbf, stripe: 0x23262c, door: 0x2a2d33, roof: 0x3550d6, electric: true },
};
function colorize(g, c) {
  const n = g.attributes.position.count, arr = new Float32Array(n * 3), cc = new THREE.Color(c);
  for (let i = 0; i < n; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const boxG = (w, h, d, c, x, y, z) => colorize(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
// tratti lungo z senza gli intervalli esclusi
function pieces(excl, z0 = -L2 + 0.05, z1 = L2 - 0.05) {
  const out = [];
  let z = z0;
  for (const [a, b] of [...excl].sort((p, q) => p[0] - q[0])) { if (a > z) out.push([z, Math.min(a, z1)]); z = Math.max(z, b); }
  if (z < z1) out.push([z, z1]);
  return out.filter(([a, b]) => b - a > 0.02);
}
const GEO = {};
function busGeometry(livery) {
  if (GEO[livery]) return GEO[livery];
  const L = LIV[livery] || LIV.moderna, dark = 0x1d1f22, glass = 0x1d2a33;
  const body = [], doors = [], lights = [];
  const arches = [3.3, -2.6].map((a) => [a - 0.62, a + 0.62]);
  for (const side of [1, -1]) {
    const x = side * (HW - 0.03), dex = side < 0 ? DOORS : [];
    for (const [a, b] of pieces(dex)) body.push(boxG(0.06, YB - 0.9, b - a, L.lower, x, (YB + 0.9) / 2, (a + b) / 2));
    for (const [a, b] of pieces([...arches, ...dex])) body.push(boxG(0.06, 0.9 - Y0, b - a, L.lower, x, (0.9 + Y0) / 2, (a + b) / 2));
    for (const [a, b] of pieces(dex)) body.push(boxG(0.02, 0.16, b - a, L.stripe, x + side * 0.03, 1.0, (a + b) / 2));
    // finestrini scuri; a sinistra quello del posto guida è un vetro vero (si vede l'autista)
    for (const [a, b] of pieces(side > 0 ? [[3.7, 6]] : dex)) body.push(boxG(0.06, YW - YB, b - a, glass, x, (YW + YB) / 2, (a + b) / 2));
    for (const [a, b] of pieces([], -L2 + 0.05, L2 - 0.05)) body.push(boxG(0.06, YT - YW, b - a, L.upper, x, (YW + YT) / 2, (a + b) / 2));
    if (side < 0) for (const [a, b] of DOORS) body.push(boxG(0.06, YT - YW + 0.1, b - a, L.upper, x, (YW + YT) / 2 - 0.05, (a + b) / 2));
    if (L.electric) body.push(boxG(0.02, 0.12, 2 * L2 - 0.4, L.roof, side * (HW + 0.01), Y0 + 0.1, 0));
  }
  body.push(boxG(2 * HW, 0.08, 2 * L2 - 0.1, L.upper, 0, YT - 0.04, 0));
  if (L.electric) body.push(boxG(2.2, 0.5, 9.2, L.roof, 0, YT + 0.25, -0.4), boxG(2.0, 0.35, 1.2, L.roof, 0, YT + 0.17, 4.6));
  else body.push(boxG(1.6, 0.32, 2.8, 0xe0e0dc, 0, YT + 0.16, 0.8), boxG(1.4, 0.25, 1.6, 0xe0e0dc, 0, YT + 0.12, -4.6));
  // interno scuro (si vede dalle porte aperte) fino alla paratia dietro al posto guida
  body.push(boxG(2 * HW - 0.16, YW - Y0, 9.5, 0x202428, 0, (YW + Y0) / 2, -1.15));
  // frontale, retro, paraurti, specchietti, cruscotto e tergicristalli a riposo
  body.push(boxG(2 * HW, 0.62, 0.12, L.lower, 0, Y0 + 0.31, L2 - 0.06), boxG(2 * HW + 0.04, 0.25, 0.2, dark, 0, Y0 + 0.1, L2));
  body.push(boxG(2 * HW, 0.26, 0.1, L.upper, 0, YT - 0.13, L2 - 0.05));
  body.push(boxG(2 * HW, (YT - Y0) * 0.72, 0.1, L.lower, 0, Y0 + ((YT - Y0) * 0.72) / 2, -L2 + 0.05), boxG(2 * HW - 0.4, 0.8, 0.04, glass, 0, 2.35, -L2 - 0.01));
  body.push(boxG(2 * HW, YT - Y0 - (YT - Y0) * 0.72, 0.1, L.upper, 0, YT - (YT - Y0 - (YT - Y0) * 0.72) / 2, -L2 + 0.05), boxG(2 * HW + 0.04, 0.25, 0.2, dark, 0, Y0 + 0.1, -L2));
  for (const s of [1, -1]) body.push(boxG(0.05, 0.05, 0.5, dark, s * (HW + 0.15), 2.55, L2 + 0.05), boxG(0.08, 0.5, 0.25, dark, s * (HW + 0.3), 2.3, L2 + 0.25));
  body.push(boxG(2 * HW - 0.1, 0.18, 0.4, 0x2a2d31, 0, 1.0, 5.7), boxG(1.15, 0.62, 0.75, 0x2a2d31, 0.62, 1.21, 5.45));
  body.push(boxG(0.5, 0.12, 0.5, 0x333333, 0.62, 0.95, 4.45), boxG(0.5, 0.75, 0.1, 0x333333, 0.62, 1.4, 4.15));
  for (const s of [1, -1]) body.push(colorize(new THREE.BoxGeometry(1.8, 0.03, 0.02).translate(-0.9, 0, 0).rotateZ(s > 0 ? 0 : Math.PI).translate(s * 1.1, 0.95 + (s < 0 ? 0.03 : 0), L2 + 0.04), dark));
  // ruote
  for (const az of [3.3, -2.6]) for (const s of [1, -1]) {
    body.push(colorize(new THREE.CylinderGeometry(0.5, 0.5, 0.34, 16).rotateZ(Math.PI / 2).translate(s * (HW - 0.2), 0.5, az), 0x151515));
    body.push(colorize(new THREE.CylinderGeometry(0.3, 0.3, 0.36, 10).rotateZ(Math.PI / 2).translate(s * (HW - 0.2), 0.5, az), 0x9aa0a6));
  }
  // porte chiuse (a porte aperte si nascondono e si vede l'interno)
  for (const [a, b] of DOORS) {
    doors.push(boxG(0.05, 2.28, b - a - 0.02, L.door, -HW - 0.01, Y0 + 1.16, (a + b) / 2));
    for (const k of [0, 1]) doors.push(boxG(0.03, 1.7, (b - a) / 2 - 0.16, glass, -HW - 0.04, Y0 + 1.3, a + ((b - a) * (k + 0.5)) / 2));
  }
  // luci: fanali e fanalini (il colore si scala di notte)
  for (const s of [1, -1]) {
    lights.push(boxG(0.42, 0.16, 0.06, 0xfff3d6, s * 0.9, 0.78, L2 + 0.02), boxG(0.16, 0.4, 0.06, 0xff1a1a, s * 1.08, 1.0, -L2 - 0.02));
  }
  // l'autista (il braccio che saluta è a parte)
  body.push(driverGeometry().body.clone().translate(...DRIVER));
  // vetri veri: parabrezza e finestrino del guidatore
  const ws = new THREE.PlaneGeometry(2 * HW - 0.1, 1.95).translate(0, 1.9, L2 + 0.005);
  const sw = new THREE.PlaneGeometry(2.25, YW - YB).rotateY(Math.PI / 2).translate(HW + 0.005, (YW + YB) / 2, 4.83);
  GEO[livery] = { body: mergeGeometries(body), doors: mergeGeometries(doors), lights: mergeGeometries(lights), glass: mergeGeometries([ws, sw]) };
  return GEO[livery];
}

// ------------------------------------------------------------------
export class BusSim {
  constructor(scene, net, city, opts = {}) {
    this.scene = scene; this.net = net; this.city = city;
    this.tramSignals = opts.tramSignals || null;
    this.lanes = new Map(); // variante -> corsia
    this.buses = [];
    this.runs = [];
    this.parts = []; // pezzi dei bus vicini (collisioni col giocatore, auto, tram)
    this.livery = 'moderna';
    this.free = [];
    this.tex = new Map();
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x777777 });
    this.glassMat = new THREE.MeshLambertMaterial({ color: 0x223844, transparent: true, opacity: 0.35 });
    this.rnd = mulberry32(7);
    this._q = [];
  }
  lane(v) {
    let L = this.lanes.get(v);
    if (!L) { L = buildLane(this.net, this.city, v, this.tramSignals); this.lanes.set(v, L); }
    return L;
  }
  // prepara in sottofondo (nel menu) le corsie delle varianti con corse attorno all'ora t, poche alla volta
  warm(lines, day, t) {
    const todo = lines.flatMap((L) => L.variants).filter((v) => !this.lanes.has(v) && (v[day] || []).some((r) => r.t > t - 7200 && r.t < t + 3600));
    const step = () => {
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 8) this.lane(todo.shift());
      if (todo.length) setTimeout(step, 30);
    };
    setTimeout(step, 400);
  }
  // servizio dall'orario; mine: corsa guidata dal giocatore { v, t } (non ha un gemello automatico)
  setService(lines, day, livery, mine = null) {
    this.clear();
    this.livery = livery; // le istanze si rifanno al prossimo modello se la livrea è cambiata
    this.runs = busRuns(lines, day).filter((r) => !mine || r.v !== mine.v || Math.abs(r.t - mine.t) > 120);
    this.lastClock = null;
  }
  // la corsa passa al giocatore (la successiva del suo turno): il gemello automatico, se c'è, esce di scena
  exclude(mine) {
    const same = (r) => r.v === mine.v && Math.abs(r.t - mine.t) <= 120;
    for (const r of this.runs) if (same(r) && r.bus) this.remove(r.bus);
    this.runs = this.runs.filter((r) => !same(r));
  }
  clear() {
    while (this.buses.length) this.remove(this.buses[0]);
    for (const r of this.runs) { r.bus = null; r.done = false; }
  }
  // finestra in cui la corsa ha un bus per strada (con l'avvicinamento e l'uscita)
  window(r) {
    const L = this.lane(r.v);
    const start = r.t - 45 - (L.leadLen > 30 ? L.leadLen / VLEAD : 15);
    return { L, start, end: r.end + 25 + L.exitLen / VLEAD };
  }
  // via i bus troppo vicini a un punto (partenza della corsa, teletrasporto)
  clearAround(x, z, r) {
    for (const b of this.buses.slice()) if (Math.hypot(b.x - x, b.z - z) < r) { b.run.done = true; this.remove(b); }
  }
  remove(b) {
    this.release(b);
    b.run.bus = null;
    this.buses.splice(this.buses.indexOf(b), 1);
  }
  // nuovo bus per la corsa r, nella posizione che l'orario gli dà all'ora clock
  spawn(r, clock, player) {
    const { L, start, end } = this.window(r);
    if (clock < start || clock >= end || !L.stops.length) return null;
    const st = L.stops, T = r.times;
    const b = {
      run: r, L, s: 0, v: 0, k: 0, phase: 'line', wait: 0, doors: 0, doorTarget: 0, lat: 0, x: 0, z: 0, h: 0, y: 0,
      model: null, blockT: 0, passT: 0, ignoreBusT: 0, waveT: 0, sig: 0, tx: 0, id: this.rnd(),
      serve: st.map((s2, i) => i === 0 || i === st.length - 1 || this.rnd() < (s2.importance >= 3 ? 0.95 : s2.importance === 2 ? 0.8 : 0.6)),
      dest: L.dest,
    };
    if (clock < r.t) {
      const tau = r.t - clock;
      if (tau > 45 && L.leadLen > 30) { b.phase = 'lead'; b.s = Math.max(FRONT, st[0].fs - FRONT - (tau - 45) * VLEAD); b.v = 6; }
      else { b.s = st[0].fs - FRONT; b.wait = tau; b.doorTarget = b.doors = 1; b.atStop = true; b.lat = st[0].extra; }
    } else if (clock < r.end) {
      let k = 0;
      while (k < T.length - 2 && T[k + 1] <= clock) k++;
      const f = Math.max(0, Math.min(1, (clock - T[k]) / Math.max(1, T[k + 1] - T[k])));
      b.s = st[k].fs + (st[k + 1].fs - st[k].fs) * f - FRONT;
      b.k = k + 1; b.v = f > 0.05 && f < 0.95 ? 7 : 0;
    } else {
      b.phase = 'exit'; b.k = st.length;
      b.s = st[st.length - 1].fs - FRONT + (clock - r.end - 25) * VLEAD;
      if (b.s + FRONT > L.P.len - 10) return null;
      b.dest = 'Fuori servizio';
    }
    this.place(b);
    // un altro bus è già lì (capolinea comune a più linee, tratti in comune): in coda dietro di lui
    for (let k = 0; k < 4 && this.buses.some((o) => Math.hypot(o.x - b.x, o.z - b.z) < 13); k++) { b.s -= 15; this.place(b); }
    if (this.buses.some((o) => Math.hypot(o.x - b.x, o.z - b.z) < 13) || b.s < 0) return null;
    while (b.sig < L.signals.length && L.signals[b.sig].s < b.s + FRONT - 1) b.sig++;
    while (b.tx < L.tram.length && L.tram[b.tx].s < b.s + FRONT - 1) b.tx++;
    if (player && Math.hypot(b.x - player.x, b.z - player.z) < 30) return null; // sopra il giocatore: si salta
    r.bus = b;
    this.buses.push(b);
    return b;
  }
  // corse in servizio a quell'ora: dopo un salto d'orario (avvio, ripresa) si ricompone tutto dall'orario
  schedule(clock, player) {
    const jump = this.lastClock == null || clock < this.lastClock - 1 || clock - this.lastClock > 60;
    if (jump) {
      this.clear();
      for (const r of this.runs) {
        if (r.t - 600 > clock) break;
        if (clock >= r.end + 200) { r.done = true; continue; }
        if (!this.spawn(r, clock, player) && clock > r.t) r.done = true;
      }
    } else {
      // corse che entrano ora in linea (dalla strada di avvicinamento); se il punto è sotto il giocatore si riprova
      for (const r of this.runs) {
        if (r.t - 600 > clock) break;
        if (r.bus || r.done) continue;
        const w = this.window(r);
        if (w.start <= clock && clock < w.end && this.spawn(r, clock, player)) continue;
        if (clock > r.t + 60) r.done = true; // il punto d'ingresso è rimasto sotto il giocatore: la corsa salta
      }
    }
    this.lastClock = clock;
  }
  // posizione e direzione dal punto della corsia: assi anteriore e posteriore sulla corsia (più lo spostamento laterale)
  place(b) {
    const P = b.L.P, f = P.at(b.s + 3.3), r = P.at(b.s - 2.6);
    const fx = f.x - f.dz * b.lat, fz = f.z + f.dx * b.lat, rx = r.x - r.dz * b.lat, rz = r.z + r.dx * b.lat;
    const l = Math.hypot(fx - rx, fz - rz) || 1;
    b.h = Math.atan2(fx - rx, fz - rz);
    b.x = rx + ((fx - rx) / l) * 2.6; b.z = rz + ((fz - rz) / l) * 2.6;
  }

  // ctx: { player (bus o tram del giocatore), traffic, trams, lights, clock }
  update(dt, ctx) {
    const clock = ctx.clock;
    if (clock == null) return;
    const cd = this.lastClock == null ? dt : clock - this.lastClock;
    this.schedule(clock, ctx.player);
    // con l'attesa accelerata in fermata l'orologio corre: i bus lo seguono a passi normali
    const n = cd > dt * 1.5 && cd < 60 ? Math.min(15, Math.round(cd / dt)) : 1;
    for (let i = 0; i < n; i++) this.move(dt, ctx, clock - (n - 1 - i) * dt);
    for (const b of this.buses) if (b.waveT > 0) b.waveT = Math.max(0, b.waveT - dt);
    this.updateParts();
    this.updateModels(ctx);
  }
  move(dt, ctx, clock) {
    const { player, traffic, trams, lights } = ctx;
    const ended = [];
    for (const b of this.buses) {
      const L = b.L, P = L.P, st = L.stops;
      const front = b.s + FRONT;
      const near = !player || Math.hypot(b.x - player.x, b.z - player.z) < NEAR;
      // fermo in fermata: porte aperte, poi (all'orario) si chiudono e si riparte
      if (b.atStop) {
        b.v = 0;
        b.wait -= dt;
        const last = b.k >= st.length - 1;
        if (b.wait <= 0) {
          b.doorTarget = 0;
          if (b.doors <= 0.001) {
            b.atStop = false;
            if (last) { b.phase = 'exit'; b.k = st.length; b.dest = 'Fuori servizio'; this.retex(b); }
            else b.k++;
          }
        }
        this.doorsStep(b, dt);
        continue;
      }
      let vt = this.vcap(L, front);
      if (b.phase === 'lead' && front >= st[0].fs - 40) b.phase = 'line';
      // prossima fermata servita
      let wantLat = 0;
      if (b.k < st.length) {
        const s0 = st[b.k], d = s0.fs - front;
        // in anticipo sull'orario si va più piano (mai sotto i 18 km/h), così non si aspetta a ogni fermata
        const left = b.run.times[b.k] - clock;
        if (b.phase === 'line' && b.k > 0 && left > 4 && d > 15) vt = Math.min(vt, Math.max(5, (d / left) * 1.1));
        if (b.serve[b.k]) {
          vt = Math.min(vt, Math.sqrt(2 * 1.2 * Math.max(0, d)) + (d > 0.6 ? 0.25 : 0));
          if (d < 30) wantLat = s0.extra;
          if (d < 0.6) {
            b.s = s0.fs - FRONT; b.v = 0; b.atStop = true; b.doorTarget = 1;
            // salita e discesa; in anticipo si aspetta l'orario (al massimo un paio di minuti); al capolinea l'orario
            const T = b.run.times[b.k];
            b.wait = b.k === 0 ? Math.max(5, b.run.t - clock) : b.k === st.length - 1 ? 18 : Math.max(8 + this.rnd() * 12, Math.min(40, T - clock));
            this.doorsStep(b, dt);
            continue;
          }
        } else if (d < -1) b.k++;
      }
      // dopo una fermata ci si riporta sulla corsia piano piano
      if (b.k > 0 && b.k <= st.length && wantLat === 0) {
        const prev = st[b.k - 1];
        if (front - prev.fs < 18) wantLat = prev.extra * Math.max(0, 1 - (front - prev.fs) / 18);
      }
      if (b.passT > 0) { b.passT -= dt; wantLat = -3.2; }
      b.lat += Math.max(-0.9 * dt, Math.min(0.9 * dt, wantLat - b.lat));
      // semaforo
      while (b.sig < L.signals.length && L.signals[b.sig].s < front - 1) b.sig++;
      const sg = L.signals[b.sig];
      if (sg && lights) {
        const d = sg.s - front;
        if (d < 70) {
          const c = lights.lightFor(sg.node, sg.edge);
          if (c === 'R' || (c === 'Y' && d > b.v * 1.5 + 2)) vt = Math.min(vt, d < 0.3 ? 0 : Math.sqrt(2 * 1.6 * (d - 0.3)));
        }
      }
      // incrocio con la sede chiamato da un tram
      while (b.tx < L.tram.length && L.tram[b.tx].s < front - 0.5) b.tx++;
      for (let j = b.tx; j < L.tram.length && L.tram[j].s - front < 60; j++) {
        if (L.tram[j].x.req > 0) { const d = L.tram[j].s - front; vt = Math.min(vt, d < 0.3 ? 0 : Math.sqrt(2 * 1.6 * (d - 0.3))); break; }
      }
      // chi c'è davanti sulla corsia (solo vicino al giocatore)
      b.blocker = null;
      if (near) {
        const ob = this.ahead(b, front, player, traffic, trams);
        if (ob && ob.bus) b.blocker = ob.bus;
        if (ob) {
          vt = Math.min(vt, Math.max(0, ob.v) + Math.sqrt(2 * 2.5 * Math.max(0, ob.gap - 3)));
          if (ob.gap < 3) vt = 0;
          if (b.v < 0.3 && vt < 0.3) {
            b.blockT += dt;
            // il giocatore fermo in mezzo alla corsia: dopo un po' lo si sorpassa; un'auto incastrata sparisce;
            // due bus che si aspettano a vicenda: uno passa
            if (ob.player && b.blockT > 10 && Math.abs(player.v) < 0.3) { b.passT = 12; b.blockT = 0; }
            else if (ob.car && b.blockT > 15 && (!player || Math.hypot(ob.car.x - player.x, ob.car.z - player.z) > 60)) { ob.car.overlapT = 3; b.blockT = 0; }
            else if (ob.bus && ob.bus.blocker === b && b.blockT > 8 && b.id < ob.bus.id) { b.ignoreBusT = 4; b.blockT = 0; }
          }
        } else b.blockT = 0;
      }
      if (b.ignoreBusT > 0) b.ignoreBusT -= dt;
      const a = vt > b.v ? Math.min(1.1, (vt - b.v) * 1.2) : Math.max(-3.5, (vt - b.v) * 2.5);
      b.v = Math.max(0, b.v + a * dt);
      b.s += b.v * dt;
      this.doorsStep(b, dt);
      if (b.phase === 'exit' && b.s + FRONT > P.len - 2) ended.push(b);
      this.place(b);
    }
    for (const b of ended) { b.run.done = true; this.remove(b); }
  }
  doorsStep(b, dt) {
    b.doors += Math.sign(b.doorTarget - b.doors) * Math.min(Math.abs(b.doorTarget - b.doors), dt / DOOR_T);
  }
  // velocità massima nel punto s della corsia
  vcap(L, s) {
    const P = L.P, i = P.seg(Math.max(0, Math.min(P.len, s)));
    const f = Math.max(0, Math.min(1, (s - P.cum[i]) / ((P.cum[i + 1] - P.cum[i]) || 1)));
    return L.vlim[i] + (L.vlim[Math.min(i + 1, L.vlim.length - 1)] - L.vlim[i]) * f;
  }
  // il primo ostacolo sulla corsia davanti al muso: distanza (gap) e velocità lungo la corsia
  ahead(b, front, player, traffic, trams) {
    const P = b.L.P, i0 = P.seg(Math.max(0, front - 3)), i1 = Math.min(P.pts.length - 1, P.seg(front + 40) + 1);
    const fp = P.at(front);
    let best = null;
    const test = (x, z, h, v, r, lat, info) => {
      if (Math.abs(x - fp.x) > 45 || Math.abs(z - fp.z) > 45) return;
      // proiezione sul tratto di corsia davanti
      let bs = null, bd = Infinity, bl = 0, bh = 0;
      for (let i = i0; i < i1; i++) {
        const A = P.pts[i], B = P.pts[i + 1], ex = B.x - A.x, ez = B.z - A.z, l2 = ex * ex + ez * ez || 1e-6;
        const t = Math.max(0, Math.min(1, ((x - A.x) * ex + (z - A.z) * ez) / l2));
        const d = Math.hypot(x - A.x - ex * t, z - A.z - ez * t);
        if (d < bd) { const l = Math.sqrt(l2); bd = d; bs = P.cum[i] + l * t; bl = ((x - A.x) * -ez + (z - A.z) * ex) / l + b.lat; bh = Math.atan2(ex, ez); }
      }
      if (bs == null || Math.abs(bl) > lat) return;
      const gap = bs - r - front;
      if (gap < -1.5 || gap > 40) return;
      const c = h == null ? 1 : Math.cos(h - bh);
      if (h != null && c < -0.3 && !info.player) return; // chi viene incontro
      if (!best || gap < best.gap) best = { gap, v: (v || 0) * Math.max(0, c), ...info };
    };
    if (player && b.passT <= 0 && Math.abs(player.x - fp.x) < 60 && Math.abs(player.z - fp.z) < 60) {
      const pts = player.isTram && player.trackPoints ? player.trackPoints() : [-4.9, -2.45, 0, 2.45, 4.9].map((lz) => player.toWorld(0, lz));
      for (const p of pts) test(p.x, p.z, player.h, Math.abs(player.v), 1.3, 2.6, { player: true });
    }
    if (traffic) for (const c of traffic.near(fp.x, fp.z, 40)) {
      if (c.isBus) { if (c.bus !== b && b.ignoreBusT <= 0) test(c.x, c.z, c.h, c.v, 1.5, 2.6, { bus: c.bus }); }
      else test(c.x, c.z, c.h, c.v, 2.2, 2.3, { car: c });
    }
    if (trams) for (const p of trams.near(fp.x, fp.z, 40)) test(p.x, p.z, p.h, 0, 1.6, 2.5, { tram: true });
    return best;
  }
  // pezzi dei bus per le collisioni (due cerchi per pezzo, come le auto) e per le auto che li seguono
  updateParts() {
    this.parts.length = 0;
    for (const b of this.buses) {
      if (!b.parts) b.parts = [-4.4, -1.5, 1.5, 4.4].map(() => ({ x: 0, z: 0, h: 0, v: 0, isBus: true, bus: b, bump: 0 }));
      if (!b.circles) b.circles = [-4.9, -2.45, 0, 2.45, 4.9].map(() => ({ x: 0, z: 0 }));
      const s = Math.sin(b.h), c = Math.cos(b.h);
      [-4.4, -1.5, 1.5, 4.4].forEach((lz, i) => Object.assign(b.parts[i], { x: b.x + s * lz, z: b.z + c * lz, h: b.h, v: b.v }));
      [-4.9, -2.45, 0, 2.45, 4.9].forEach((lz, i) => { b.circles[i].x = b.x + s * lz; b.circles[i].z = b.z + c * lz; });
      for (const p of b.parts) this.parts.push(p);
    }
  }
  near(x, z, r) {
    const out = this._q;
    out.length = 0;
    for (const p of this.parts) if (Math.abs(p.x - x) < r + 3 && Math.abs(p.z - z) < r + 3) out.push(p);
    return out;
  }

  // ---- modelli ----
  texFor(line, dest) {
    const k = line + '|' + dest;
    let t = this.tex.get(k);
    if (!t) { t = { tex: ledTexture(line, dest, 512, 64), n: 0 }; this.tex.set(k, t); }
    t.n++;
    return t;
  }
  untex(t) {
    if (--t.n > 0) return;
    t.tex.dispose();
    for (const [k, v] of this.tex) if (v === t) this.tex.delete(k);
  }
  retex(b) {
    if (!b.model) return;
    const m = b.model;
    this.untex(m.t);
    m.t = this.texFor(b.run.L.id, b.dest);
    m.ledF.material.map = m.ledS.material.map = m.t.tex;
  }
  // parti istanziate, una per pezzo per tutti i bus visibili (porte nascoste a porte aperte); il display LED, con la
  // sua texture, è l'unica mesh per bus
  buildInstances() {
    const G = busGeometry(this.livery), D = driverGeometry();
    if (!this.bodyMat) this.bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (this.inst) for (const m of Object.values(this.inst)) { this.scene.remove(m); m.dispose(); }
    const mk = (g, mat, shadow = false) => {
      const m = new THREE.InstancedMesh(g, mat, MAX_VIS);
      m.frustumCulled = false; // le istanze si muovono
      m.castShadow = shadow;
      for (let i = 0; i < MAX_VIS; i++) m.setMatrixAt(i, ZERO);
      this.scene.add(m);
      return m;
    };
    this.inst = { body: mk(G.body, this.bodyMat, true), doors: mk(G.doors, this.bodyMat), lights: mk(G.lights, this.lightMat), glass: mk(G.glass, this.glassMat), arm: mk(D.arm, D.mat) };
    this.slots = Array.from({ length: MAX_VIS }, () => null);
    this.instLivery = this.livery;
  }
  ledMesh() {
    // display frontale e laterale in un'unica mesh con la stessa texture
    const g = mergeGeometries([
      new THREE.PlaneGeometry(2.1, 0.26).translate(0, YT - 0.14, L2 + 0.012),
      new THREE.PlaneGeometry(1.3, 0.17).rotateY(-Math.PI / 2).translate(-HW - 0.02, 2.35, 3.0),
    ]);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    m.matrixAutoUpdate = false;
    return m;
  }
  acquire(b) {
    if (!this.inst || this.instLivery !== this.livery) this.buildInstances();
    const slot = this.slots.indexOf(null);
    if (slot < 0) return;
    this.slots[slot] = b;
    const led = this.free.pop() || this.ledMesh();
    const t = this.texFor(b.run.L.id, b.dest);
    led.material.map = t.tex;
    led.material.needsUpdate = true;
    this.scene.add(led);
    b.model = { slot, led, t, arm: new THREE.Object3D() };
    b.model.arm.position.set(DRIVER[0] + ARM_PIVOT[0], DRIVER[1] + ARM_PIVOT[1], DRIVER[2] + ARM_PIVOT[2]);
  }
  release(b) {
    if (!b.model) return;
    const m = b.model;
    this.untex(m.t);
    this.scene.remove(m.led);
    this.free.push(m.led);
    for (const im of Object.values(this.inst)) { im.setMatrixAt(m.slot, ZERO); im.instanceMatrix.needsUpdate = true; }
    this.slots[m.slot] = null;
    b.model = null;
  }
  retex(b) {
    if (!b.model) return;
    const m = b.model;
    this.untex(m.t);
    m.t = this.texFor(b.run.L.id, b.dest);
    m.led.material.map = m.t.tex;
  }
  updateModels(ctx) {
    const p = ctx.player;
    if (!p) return;
    // i più vicini entro R_VIS hanno il modello (con un po' di isteresi per non farlo apparire e sparire)
    for (const b of this.buses) b._d = Math.hypot(b.x - p.x, b.z - p.z);
    for (const b of this.buses) if (b.model && b._d > R_VIS + 60) this.release(b);
    const want = this.buses.filter((b) => !b.model && b._d < R_VIS).sort((a, c) => a._d - c._d);
    let used = this.buses.filter((b) => b.model).length;
    for (const b of want) { if (used >= MAX_VIS) break; this.acquire(b); used++; }
    if (!this.inst) return;
    for (const b of this.buses) {
      const m = b.model;
      if (!m) continue;
      const i = b.L.P.seg(Math.max(0, Math.min(b.L.P.len, b.s)));
      b.y = laneHeight(b.L, i);
      M.compose(V.set(b.x, Y_ROAD + b.y, b.z), Q.setFromAxisAngle(UP, b.h), ONE);
      for (const k of ['body', 'lights', 'glass']) this.inst[k].setMatrixAt(m.slot, M);
      this.inst.doors.setMatrixAt(m.slot, b.doors < 0.3 ? M : ZERO);
      setWave(m.arm, b.waveT);
      m.arm.updateMatrix();
      this.inst.arm.setMatrixAt(m.slot, M2.multiplyMatrices(M, m.arm.matrix));
      m.led.matrix.copy(M);
      m.led.matrixWorldNeedsUpdate = true;
    }
    for (const im of Object.values(this.inst)) im.instanceMatrix.needsUpdate = true;
  }
  setNight(f) { this.lightMat.color.setScalar(0.35 + f * 0.65); }
  // colleghi da salutare: posizione, direzione e linea dei bus con il modello
  colleagues(out = []) {
    for (const b of this.buses) if (b.model) out.push({ ref: b, x: b.x + Math.sin(b.h) * 4.5, z: b.z + Math.cos(b.h) * 4.5, h: b.h, line: b.run.L.id, color: b.run.L.color, tram: false });
    return out;
  }
}
