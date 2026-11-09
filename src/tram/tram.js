import * as THREE from 'three';
import { ledTexture } from '../world/textures.js';
import { TRAM_LINES } from '../data/padova.js';
import { RainGlass, WIPER_PARK, wiperPhase } from '../bus/rainglass.js';

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
  // tratto da s0 a s1 (s0 < s1), con i vertici intermedi
  slice(s0, s1) {
    const pts = [this.at(s0)];
    for (let i = 1; i < this.pts.length - 1; i++) if (this.cum[i] > s0 + 0.3 && this.cum[i] < s1 - 0.3) pts.push(this.pts[i]);
    pts.push(this.at(s1));
    return new TrackPath(pts.map((p) => ({ x: p.x, z: p.z })));
  }
  // come project, ma solo sui tratti entro r metri (griglia di 16 m, costruita alla prima chiamata); null se non ce ne sono
  projectNear(x, z, r) {
    const G = 16;
    if (!this.grid) {
      this.grid = new Map();
      for (let i = 0; i < this.pts.length - 1; i++) {
        const a = this.pts[i], b = this.pts[i + 1];
        for (let gx = Math.floor(Math.min(a.x, b.x) / G); gx <= Math.floor(Math.max(a.x, b.x) / G); gx++)
          for (let gz = Math.floor(Math.min(a.z, b.z) / G); gz <= Math.floor(Math.max(a.z, b.z) / G); gz++) {
            const k = gx + ',' + gz;
            if (!this.grid.has(k)) this.grid.set(k, []);
            this.grid.get(k).push(i);
          }
      }
    }
    let best = null;
    for (let gx = Math.floor((x - r) / G); gx <= Math.floor((x + r) / G); gx++)
      for (let gz = Math.floor((z - r) / G); gz <= Math.floor((z + r) / G); gz++)
        for (const i of this.grid.get(gx + ',' + gz) || []) {
          const a = this.pts[i], b = this.pts[i + 1];
          const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-6;
          const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
          const d = Math.hypot(x - a.x - ex * t, z - a.z - ez * t);
          if (d < r && (!best || d < best.d)) best = { s: this.cum[i] + Math.sqrt(l2) * t, d };
        }
    return best;
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
export function tramRoute(track, variant, modules = 3, full = false) {
  const sig = track.dirOf(variant), P = track.path(sig);
  if (full) return { path: P, sig, offset: 0 };
  const ss = variant.stops.map((st) => P.project(st.x, st.z).s);
  const back = tramLength(modules) + 20;
  const s0 = Math.max(0, ss[0] - back), s1 = Math.min(P.len, ss[ss.length - 1] + 30);
  return { path: P.slice(s0, s1), sig, offset: s0 };
}

// ---------- binari per verso di marcia ----------
// Ogni verso ha il suo binario (dir +1 verso nord, Guizza → Pontevigodarzere; -1 verso sud). Dove i due versi corrono
// affiancati (doppio binario) i binari sono le due corsie della sede comune, a ±1,7 m dall'asse del tracciato verso nord.
// Dove si separano (l'anello della stazione percorso solo verso nord, i tratti su vie diverse a sud) ogni verso segue il
// suo tracciato GTFS a binario singolo. I passaggi tra doppio e singolo sono raccordati su ~25 m.
// Grafo dei binari: una sede per linea (city.tramTracks[id]; city.tramTrack è il SIR1). Le linee in costruzione hanno i
// binari OSM dei due versi; dove corrono sopra il binario di una sede già posata, nello stesso verso, ne prendono la
// geometria (tratti in comune: i tram delle due linee vanno sulla stessa rotaia). Ai capi del tratto in comune c'è uno
// scambio: il binario che si stacca si raccorda in 20 m. I tratti in comune li disegna la sede che c'era già.
function rampWeights(flags, step, ramp) {
  const n = flags.length, out = flags.slice();
  // via i tratti troppo corti (rumore dei tracciati GTFS)
  const minRun = Math.ceil(30 / step);
  let i = 0;
  while (i < n) { let j = i; while (j < n && out[j] === out[i]) j++; if (j - i < minRun && i > 0 && j < n) for (let k = i; k < j; k++) out[k] = out[i - 1]; i = j; }
  const k = step / ramp, w = out.map(Number);
  for (let i = 1; i < n; i++) w[i] = Math.max(w[i - 1] - k, Math.min(w[i - 1] + k, w[i]));
  for (let i = n - 2; i >= 0; i--) w[i] = Math.max(w[i + 1] - k, Math.min(w[i + 1] + k, w[i]));
  return w;
}
const STEP = 3, NEAR = 9;
const sampleS = (len) => { const out = []; for (let s = 0; s < len; s += STEP) out.push(s); out.push(len); return out; };
export class TramTrack {
  // net: la rete (net.tram, net.tramLanes, net.tramStops: la sede del SIR1). Per le altre linee opts: id, lanes (i binari
  // OSM dei versi +1 e -1), lines (le linee che ci corrono), over (sedi già posate, per i tratti in comune)
  constructor(net, opts = {}) {
    this.id = opts.id || 'SIR1';
    const raw = opts.lanes || net.tram || [], osm = opts.lanes ? true : net.tramLanes;
    this.lines = opts.lines || TRAM_LINES.filter((L) => !L.building);
    this.tramStops = opts.lanes ? [] : net.tramStops || [];
    // binari delle sedi già posate, con il loro verso
    const others = (opts.over || []).flatMap((T) => [1, -1].map((d) => ({ T, dir: d, P: T.paths[d] })));
    const nearOther = (p) => others.some((o) => o.P.projectNear(p.x, p.z, NEAR));
    const C = (this.C = new TrackPath(raw[0]));
    const S = raw[1] && raw[1].length > 1 ? new TrackPath(raw[1]) : null;
    // verso nord: lungo l'asse, a destra di 1,7 m dove c'è l'altro verso (con i binari OSM: il suo binario)
    const ns = sampleS(C.len);
    const wN = rampWeights(ns.map((s) => { const p = C.at(s); return (S && S.project(p.x, p.z).d < NEAR) || nearOther(p) ? 1 : 0; }), STEP, 25);
    const north = ns.map((s, i) => { const p = C.at(s), o = osm ? 0 : TRAM.lane * wN[i]; return { x: p.x - p.dz * o, z: p.z + p.dx * o }; });
    let south, wS;
    if (S && osm) {
      const ss = sampleS(S.len);
      wS = rampWeights(ss.map((s) => { const p = S.at(s); return C.project(p.x, p.z).d < NEAR || nearOther(p) ? 1 : 0; }), STEP, 25);
      south = ss.map((s) => { const p = S.at(s); return { x: p.x, z: p.z }; });
    } else if (S) {
      const ss = sampleS(S.len), cs = [], flags = [];
      for (const s of ss) { const p = S.at(s), pr = C.project(p.x, p.z); cs.push(pr.s); flags.push(pr.d < NEAR ? 1 : 0); }
      wS = rampWeights(flags, STEP, 25);
      south = ss.map((s, i) => {
        const p = S.at(s), q = C.at(cs[i]);
        const lx = q.x + q.dz * TRAM.lane, lz = q.z - q.dx * TRAM.lane; // corsia sinistra dell'asse = destra di chi va a sud
        return { x: p.x + (lx - p.x) * wS[i], z: p.z + (lz - p.z) * wS[i] };
      });
    } else {
      south = north.map((p, i) => { const q = C.at(ns[i]); return { x: q.x + q.dz * TRAM.lane, z: q.z - q.dx * TRAM.lane }; }).reverse();
      wS = wN.slice().reverse();
    }
    // i punti GTFS fitti e rumorosi (anello della stazione, Borgomagno) lasciano spigoli che i raccordi non tolgono:
    // media mobile su ±9 m, due passate, estremi fermi. Una curva vera di 28 m si sposta di circa mezzo metro
    smoothLane(north); smoothLane(south);
    // tratti in comune con le sedi già posate e scambi ai loro capi
    this.shared = { 1: [], '-1': [] };
    this.switches = [];
    this.paths = {};
    for (const [d, pts] of [[1, north], [-1, south]]) {
      // il verso -1 può correre anche sul binario +1 della stessa linea (capolinea ad anello: SIR3 in stazione)
      const hit = snapShared(pts, d > 0 ? others : [...others, { T: this, dir: 1, P: this.paths[1] }]), keep = dedupIdx(pts);
      const P = (this.paths[d] = new TrackPath(keep.map((i) => pts[i])));
      const h = keep.map((i) => hit[i]);
      for (let i = 0; i < h.length;) {
        if (!h[i]) { i++; continue; }
        let j = i;
        while (j + 1 < h.length && h[j + 1] && h[j + 1].o === h[i].o) j++;
        this.shared[d].push([P.cum[i], P.cum[j]]);
        // scambio dove il binario si unisce a quello dell'altra sede e dove se ne stacca (non agli estremi del percorso)
        for (const [k, kind] of [[i, 'unione'], [j, 'diramazione']]) {
          if (k === 0 || k === h.length - 1) continue;
          const p = P.pts[k];
          this.switches.push({ dir: d, s: P.cum[k], x: p.x, z: p.z, kind, other: { id: h[k].o.T.id, dir: h[k].o.dir, s: h[k].s } });
        }
        i = j + 1;
      }
    }
    // doppio binario lungo ogni percorso (0..1), campionato come i punti
    this.dbl = { 1: resampleW(this.paths[1], north, wN), '-1': resampleW(this.paths[-1], south, wS) };
    this.h = { 1: null, '-1': null };
    // fermate per verso: dalle fermate reali di tutte le corse. Sul tratto in comune la fermata è quella della sede che
    // c'era già, se ce n'è una a meno di 30 m nello stesso verso: la corsa si ferma alla stessa banchina (shared)
    this.stopsDir = { 1: [], '-1': [] };
    for (const L of this.lines) for (const v of L.variants) {
      const d = this.dirOf(v), P = this.paths[d];
      for (const st of v.stops) {
        let sp = P.project(st.x, st.z).s, shared = false;
        if (this.sharedAt(d, sp)) {
          const p = P.at(sp);
          for (const o of [...others, { T: this, dir: 1, P: this.paths[1] }]) for (const os of o.T.stopsDir[o.dir]) {
            const q = o.P.at(os.s);
            if (shared || Math.hypot(q.x - p.x, q.z - p.z) > 30 || q.dx * p.dx + q.dz * p.dz < 0.9) continue;
            st.x = os.x; st.z = os.z; sp = P.project(st.x, st.z).s; shared = true;
          }
        }
        if (!this.stopsDir[d].some((o) => Math.abs(o.s - sp) < 20)) this.stopsDir[d].push({ s: sp, name: st.name, x: st.x, z: st.z, side: st.side || 1, shared });
      }
    }
    for (const d of [1, -1]) this.stopsDir[d].sort((a, b) => a.s - b.s);
    // tratti senza linea aerea (Prato della Valle), per verso
    this.gaps = { 1: [], '-1': [] };
    for (const d of [1, -1]) for (const st of this.stopsDir[d]) if (/prato/i.test(st.name)) this.gaps[d].push([st.s - CATENARY_GAP_HALF, st.s + CATENARY_GAP_HALF]);
  }
  // s sul binario del verso dir è in un tratto in comune con una sede già posata?
  sharedAt(dir, s) { return this.shared[dir > 0 ? 1 : -1].some(([a, b]) => s >= a && s <= b); }
  path(dir) { return this.paths[dir > 0 ? 1 : -1]; }
  // la fermata vicina a (x, z) ha una banchina centrale, tra i due binari e comune ai due versi (dalle banchine OSM)
  centralAt(x, z) {
    let best = null, bd = 50;
    for (const st of this.tramStops) { const d = Math.hypot(st.x - x, st.z - z); if (d < bd) { bd = d; best = st; } }
    return !!(best && best.central);
  }
  // verso di una corsa: dalle sue fermate sul percorso verso nord
  dirOf(v) {
    const P = this.paths[1], a = P.project(v.stops[0].x, v.stops[0].z).s, b = P.project(v.stops[v.stops.length - 1].x, v.stops[v.stops.length - 1].z).s;
    return b >= a ? 1 : -1;
  }
  doubleAt(dir, s) { const P = this.path(dir), w = this.dbl[dir > 0 ? 1 : -1]; return w[Math.min(w.length - 1, P.seg(s))]; }
  wireAt(dir, s) { return !this.gaps[dir > 0 ? 1 : -1].some(([a, b]) => s > a && s < b); }
  gapAhead(dir, s, dist) { return this.gaps[dir > 0 ? 1 : -1].some(([a]) => a - s > 0 && a - s < dist); }
  // quota del binario (cavalcavia): campionata ogni 5 m, levigata. Dove i binari sono affiancati stanno sullo stesso
  // impalcato: vale la quota più alta delle due corsie (sul Cavalcavia Borgomagno il binario verso nord è più lontano
  // dalla strada e da solo resterebbe a terra)
  setHeights(fn) {
    for (const d of [1, -1]) {
      const P = this.paths[d], O = this.paths[-d], raw = [];
      for (let s = 0; s <= P.len; s += 5) {
        const p = P.at(s);
        let h = fn(p.x, p.z, p.dx, p.dz);
        if (this.doubleAt(d, s) > 0.5) {
          const q = O.at(O.project(p.x, p.z).s);
          h = Math.max(h, fn(q.x, q.z, p.dx, p.dz));
        }
        raw.push(h);
      }
      const sm = raw.map((_, i) => { let a = 0, n = 0; for (let k = -5; k <= 5; k++) { const v = raw[i + k]; if (v != null) { a += v; n++; } } return a / n; });
      // la media smussa i raccordi in basso, ma non abbassa il binario sotto la strada che segue: in cima alle rampe
      // finiva sotto l'impalcato e la sede rossa spariva a pezzi (Cavalcavia Chiesanuova sul SIR2)
      this.h[d] = sm.map((v, i) => { const w = Math.max(v, raw[i]); return w < 0.25 ? 0 : w; });
    }
  }
  heightAt(dir, s) {
    const h = this.h[dir > 0 ? 1 : -1];
    if (!h) return 0;
    const f = Math.max(0, Math.min(h.length - 1, s / 5)), i = Math.floor(f), t = f - i;
    return h[i] + ((h[Math.min(h.length - 1, i + 1)] ?? h[i]) - h[i]) * t;
  }
}
function smoothLane(pts, k = 3, passes = 2) {
  for (let pass = 0; pass < passes; pass++) {
    const src = pts.map((p) => ({ x: p.x, z: p.z }));
    for (let i = k; i < pts.length - k; i++) {
      let x = 0, z = 0;
      for (let j = -k; j <= k; j++) { x += src[i + j].x; z += src[i + j].z; }
      pts[i].x = x / (2 * k + 1); pts[i].z = z / (2 * k + 1);
    }
  }
}
function dedupIdx(pts) { const out = []; pts.forEach((p, i) => { if (i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.05) out.push(i); }); return out; }
// Binario che corre sopra quello di un'altra sede, nello stesso verso (entro 1,5 m, per almeno 20 m): i punti diventano
// quelli dell'altro binario, con un raccordo di 20 m ai capi (lo scambio). Restituisce per ogni punto { o, s } (binario
// e progressiva su cui corre) o null.
const SHARE = 1.5, SHARE_MIN = 20, SWITCH_LEN = 20;
function snapShared(pts, others) {
  const n = pts.length, hit = new Array(n).fill(null);
  if (!others.length) return hit;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    for (const o of others) {
      const pr = o.P.projectNear(pts[i].x, pts[i].z, SHARE);
      if (!pr) continue;
      const q = o.P.at(pr.s);
      if ((q.dx * (b.x - a.x) + q.dz * (b.z - a.z)) / l > 0.9) { hit[i] = { o, s: pr.s }; break; }
    }
  }
  // via i tratti più corti (binari che si incrociano o si sfiorano)
  const minRun = Math.ceil(SHARE_MIN / STEP);
  for (let i = 0; i < n;) {
    let j = i;
    while (j < n && !!hit[j] === !!hit[i]) j++;
    if (hit[i] && j - i < minRun) for (let k = i; k < j; k++) hit[k] = null;
    i = j;
  }
  const ref = hit.slice(), w = hit.map((h) => (h ? 1 : 0)), k = STEP / SWITCH_LEN;
  for (let i = 1; i < n; i++) if (w[i - 1] - k > w[i]) { w[i] = w[i - 1] - k; ref[i] = ref[i - 1]; }
  for (let i = n - 2; i >= 0; i--) if (w[i + 1] - k > w[i]) { w[i] = w[i + 1] - k; ref[i] = ref[i + 1]; }
  for (let i = 0; i < n; i++) {
    if (!w[i]) continue;
    const P = ref[i].o.P, q = P.at(hit[i] ? hit[i].s : P.project(pts[i].x, pts[i].z).s);
    pts[i] = { x: pts[i].x + (q.x - pts[i].x) * w[i], z: pts[i].z + (q.z - pts[i].z) * w[i] };
  }
  return hit;
}
function resampleW(P, pts, w) {
  // pesi per vertice del percorso (dopo dedup i vertici possono essere meno dei campioni)
  const out = [];
  let j = 0;
  for (let i = 0; i < P.pts.length; i++) {
    while (j < pts.length - 1 && Math.hypot(pts[j].x - P.pts[i].x, pts[j].z - P.pts[i].z) > 0.06) j++;
    out.push(w[Math.min(j, w.length - 1)]);
  }
  return out;
}

// Fermate del tram lungo la sede, per verso di marcia: dalle fermate reali di tutte le corse (il GTFS ha una banchina
// per direzione). s lungo la sede, sig = verso di chi la serve. Le stesse posizioni valgono per banchine, missione e tram
// automatici.
export function tramStopPlacements(center) {
  const out = [];
  for (const L of TRAM_LINES) for (const v of L.variants) {
    const ss = v.stops.map((st) => center.project(st.x, st.z).s);
    const sig = ss[ss.length - 1] >= ss[0] ? 1 : -1;
    v.stops.forEach((st, k) => {
      if (!out.some((o) => o.sig === sig && Math.abs(o.s - ss[k]) < 20)) out.push({ s: ss[k], sig, name: st.name });
    });
  }
  return out.sort((a, b) => a.s - b.s);
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
    // livrea SIR1: blu scuro in basso, blu chiaro dalla cintura dei finestrini al tetto, pannelli argento
    navy: lam(0x233f8c, { side: THREE.DoubleSide }), light: lam(0x4a7ad0, { side: THREE.DoubleSide }),
    silver: lam(0xc5cbd3, { side: THREE.DoubleSide }), glass: lam(0x17232e), skirt: lam(0x17191b),
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

// Sezione della cassa, metà destra dal basso al colmo del tetto: fiancata bombata, finestrini rientranti, tetto
// arrotondato. BAND: colore di ogni tratto (0 zoccolo, 1 blu scuro, 2 vetri, 3 blu chiaro).
const PROFILE = [[1.03, 0.2], [1.07, 0.52], [1.1, 0.85], [1.1, 1.3], [1.08, 1.85], [1.03, 2.42], [0.98, 2.7], [0.88, 2.9], [0.65, 3.04], [0.3, 3.09], [0, 3.1]];
const BAND = [0, 1, 1, 2, 2, 3, 3, 3, 3, 3];
const NOSE = 1.6, RAKE = 0.5;
// tergicristalli contrapposti come sul bus: perni negli angoli in basso del parabrezza (in metri nel piano del vetro
// inclinato, dal centro del vetro), spazzole a riposo distese verso il centro
const WIPER_X = 0.6, WIPER_LEN = 1.4, GLASS_H = 1.5, GLASS_Y = 1.99; // muso arrotondato: lunghezza (m) e inclinazione del parabrezza (m in avanti per m in alto)

// Superficie della cassa tra anelli successivi. pt(j, r): punto destro j del profilo all'anello r (il sinistro è
// speculare); j0..j1: tratto di profilo; mats[banda]. Le facce guardano fuori.
function shell(nr, pt, mats, j0 = 0, j1 = PROFILE.length - 1) {
  const pos = [], groups = mats.map(() => []);
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let r = 0; r < nr; r++) for (let j = j0; j <= j1; j++) { const p = pt(j, r); pos.push(p.x * side, p.y, p.z); }
    const n = j1 - j0 + 1, V = (r, j) => base + r * n + (j - j0);
    for (let r = 0; r < nr - 1; r++) for (let j = j0; j < j1; j++) {
      const a = V(r, j), b = V(r, j + 1), c = V(r + 1, j + 1), d = V(r + 1, j), g = groups[BAND[j]];
      if (side < 0) g.push(a, c, b, a, d, c); else g.push(a, b, c, a, c, d);
    }
  }
  return meshOf(pos, groups, mats);
}
function meshOf(pos, groups, mats) {
  const geo = new THREE.BufferGeometry(), idx = [];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  groups.forEach((g, k) => { if (g.length) { geo.addGroup(idx.length, g.length, k); idx.push(...g); } });
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mats);
}
// tappo piatto con la sagoma della sezione (estremità verso il soffietto)
function endCap(z, mat) {
  const pos = [0, 1.6, z], tri = [];
  const ring = [...PROFILE.map(([x, y]) => [-x, y]), ...PROFILE.slice(0, -1).reverse().map(([x, y]) => [x, y])];
  for (const [x, y] of ring) pos.push(x, y, z);
  for (let i = 1; i < ring.length; i++) tri.push(0, i, i + 1);
  return meshOf(pos, [tri], [mat]);
}

// Un modulo: gruppo con +z verso l'estremità A del convoglio. kind: 'cabA' | 'cabB' | 'mid'.
function buildModule(kind, len, opts) {
  const M = tramMaterials(), W = TRAM.width;
  const group = new THREE.Group();
  const inner = new THREE.Group(); // nella cabina B il muso guarda verso -z
  if (kind === 'cabB') inner.rotation.y = Math.PI;
  group.add(inner);
  const cab = kind !== 'mid';
  // cassa bombata a due blu. Fiancate e tetto si vedono da entrambi i lati; i vetri solo da fuori, così da dentro
  // si guarda attraverso. Il muso della cabina si stringe in pianta e il parabrezza è inclinato all'indietro.
  const mats = [M.skirt, M.navy, M.glass, M.light];
  const f = len / 2, z1 = cab ? f - NOSE + 0.1 : f;
  // sottocassa: nella cabina si ferma dove comincia il muso, che si stringe
  box(W - 0.1, 0.42, z1 + f - 0.3, M.skirt, 0, 0.34, (z1 - f) / 2, inner);
  inner.add(shell(2, (j, r) => ({ x: PROFILE[j][0], y: PROFILE[j][1], z: r ? z1 : -f }), mats));
  inner.add(endCap(-f, M.navy));
  if (!cab) inner.add(endCap(f, M.navy));
  // nel muso il parabrezza sale più in alto della cintura dei finestrini laterali
  const nosePt = (j, r) => {
    const t = r / 4, x = PROFILE[j][0], y = PROFILE[j][1] + (j === 5 ? 0.28 : j === 6 ? 0.12 : 0) * t * t;
    return { x: x * (1 - 0.3 * t * t), y, z: z1 + NOSE * t - Math.max(0, y - 1.25) * RAKE * t ** 1.5 - Math.max(0, 0.55 - y) * 0.4 * t };
  };
  if (cab) {
    inner.add(shell(5, nosePt, mats));
    // testata: strisce orizzontali tra i due lati dell'ultimo anello (blu scuro, parabrezza, blu chiaro)
    const pos = [], groups = mats.map(() => []);
    PROFILE.forEach((_, j) => { const p = nosePt(j, 4); pos.push(-p.x, p.y, p.z, p.x, p.y, p.z); });
    for (let j = 0; j < PROFILE.length - 1; j++) groups[BAND[j]].push(2 * j, 2 * j + 1, 2 * j + 3, 2 * j, 2 * j + 3, 2 * j + 2);
    inner.add(meshOf(pos, groups, mats));
    // pannello argento sul fianco, subito dietro il parabrezza
    inner.add(shell(2, (j, r) => ({ x: PROFILE[j][0] * 1.012, y: PROFILE[j][1], z: r ? z1 : z1 - 1.3 }), [M.silver, M.silver, M.silver, M.silver], 3, 5));
    // carenatura sul tetto
    box(W - 0.9, 0.2, len - NOSE - 2.2, M.light, 0, 3.18, -0.9, inner);
  }
  // fasce argento alle estremità verso il soffietto
  for (const ez of cab ? [-1] : [-1, 1]) inner.add(shell(2, (j, r) => ({ x: PROFILE[j][0] * 1.012, y: PROFILE[j][1], z: ez * (f - (r ? 0 : 0.5)) }), [M.silver, M.silver, M.silver, M.silver], 3, 5));
  // porte doppie sui due lati, con la cornice grigio argento
  const doorZ = kind === 'mid' ? [0] : [-len / 2 + 2.1];
  const doors = [];
  for (const dz of doorZ) {
    inner.add(shell(2, (j, r) => ({ x: PROFILE[j][0] * 1.012, y: PROFILE[j][1], z: dz + (r ? 0.8 : -0.8) }), [M.silver, M.silver, M.silver, M.silver], 1, 5));
    const leaves = [];
    for (const sd of [-1, 1]) for (const lr of [-1, 1]) {
      const leaf = box(0.05, 1.95, 0.66, M.door, sd * (W / 2 + 0.035), 1.32, dz + lr * 0.34, inner);
      leaf.userData = { sd, lr, z0: dz + lr * 0.34 };
      leaves.push(leaf);
    }
    doors.push({ z: dz, leaves, kind });
  }
  let eye = null, dash = null, led = null, headMat = null, tailMat = null;
  const wipers = [];
  if (cab) {
    // fanali bassi sul muso, display di linea sopra il parabrezza (inclinato come la testata)
    const tip = z1 + NOSE;
    headMat = M.head.clone(); tailMat = M.tail.clone();
    for (const sx of [-0.5, 0.5]) {
      box(0.28, 0.13, 0.05, headMat, sx, 0.72, tip + 0.01, inner);
      box(0.14, 0.09, 0.05, tailMat, sx * 1.3, 0.98, tip + 0.0, inner);
    }
    led = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.22), new THREE.MeshBasicMaterial({ map: ledTexture(opts.line, opts.dest) }));
    led.position.set(0, 2.86, tip - (2.86 - 1.25) * RAKE + 0.03); led.rotation.x = -Math.atan(RAKE); inner.add(led);
    // tergicristalli: la spazzola gira nel piano del vetro inclinato
    const wp = new THREE.Group();
    wp.position.set(0, 1.34, tip - (1.34 - 1.25) * RAKE + 0.03); wp.rotation.x = -Math.atan(RAKE); inner.add(wp);
    for (const side of [1, -1]) {
      const w = new THREE.Group();
      w.position.set(side * WIPER_X, side < 0 ? 0.03 : 0, side < 0 ? 0.02 : 0);
      w.rotation.z = (side * Math.PI) / 2;
      w.userData.side = side;
      box(0.035, WIPER_LEN, 0.025, M.skirt, 0, WIPER_LEN / 2, 0, w);
      wp.add(w);
      wipers.push(w);
    }
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
    // cielo della cabina visto da dentro, chiaro come quello dei passeggeri (si ferma prima del parabrezza inclinato)
    box(W - 0.3, 0.05, 1.5, M.cabin, 0, 2.42, f - 1.35, inner);
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
  return { group, inner, len, kind, doors, eye, dash, led, panto, headMat, tailMat, wipers };
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
    // binario del verso di marcia (TramTrack) e progressiva di inizio del percorso su quel binario
    this.track = opts.track || null;
    this.dirSig = opts.dir || 1;
    this.pathOffset = opts.offset || 0;
    this.nMod = Math.max(3, modules);
    this.length = tramLength(this.nMod);
    this.scene = scene;
    // stato: posizione del muso A lungo il percorso, verso di marcia (+1 = s crescente)
    this.aFwd = 1; this.facing = 1;
    this.derailT = 0; this.derailAmt = 0; this.derailSide = 1;
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
    // fari: un proiettore che segue la cabina attiva
    this.spot = new THREE.SpotLight(0xfff1d0, 0, 90, 0.5, 0.5, 1.2);
    this.spot.position.set(0, 1.0, TRAM.cab / 2);
    this.spot.target.position.set(0, 0, TRAM.cab / 2 + 25);
    this.brakeMat = tramMaterials().tail;
    // gocce di pioggia appena dietro il parabrezza di ogni cabina; il tergicristallo pulisce quello della cabina attiva
    this.wiperT = WIPER_PARK;
    const wy = (1.34 - GLASS_Y) / Math.cos(Math.atan(RAKE));
    this.wiperArms = [1, -1].map((side) => ({ x: side * WIPER_X, y: wy + (side < 0 ? 0.03 : 0), len: WIPER_LEN, a: (side * Math.PI) / 2 }));
    for (const m of [this.modules[0], this.modules[this.nMod - 1]]) {
      m.rainGlass = new RainGlass(1.42, GLASS_H);
      m.rainGlass.mesh.position.set(0, GLASS_Y, TRAM.cab / 2 + 0.1 - (GLASS_Y - 1.25) * RAKE - 0.05);
      m.rainGlass.mesh.rotation.x = -Math.atan(RAKE);
      m.inner.add(m.rainGlass.mesh);
    }
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
  curvature(s, signed = false) {
    const a = this.path.at(s - 12), b = this.path.at(s + 12);
    const d = Math.atan2(Math.sin(b.h - a.h), Math.cos(b.h - a.h));
    return (signed ? d : Math.abs(d)) / 24;
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
  // cambio di binario (cambio cabina al capolinea): nuovo percorso, nuovo verso
  setPath(path, dir, offset = 0) { this.path = path; this.dirSig = dir; this.pathOffset = offset; this.facing = 1; this.aFwd = 1; }
  hAt(s) { return this.track ? this.track.heightAt(this.dirSig, this.pathOffset + s) : 0; }
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
  // punto davanti a una porta, sul lato `side` (+1 destra del verso di marcia, di norma quello della banchina), a `out`
  // metri dal fianco
  doorPoint(i, out = 0.6, side = this.platformSide || 1) {
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
      const a = P.at(sa), b = P.at(sb), ha = this.hAt(sa), hb = this.hAt(sb);
      m.group.position.set((a.x + b.x) / 2, (ha + hb) / 2 + 0.14, (a.z + b.z) / 2);
      m.group.rotation.order = 'YXZ';
      m.group.rotation.y = Math.atan2(a.x - b.x, a.z - b.z);
      m.group.rotation.x = -Math.atan2((ha - hb) * this.aFwd, m.len);
      if (this.derailAmt > 0) {
        const w = this.derailAmt * (this.facing === this.aFwd ? this.nMod - k : k + 1) / this.nMod; // più la testa
        const hh = m.group.rotation.y, side = this.derailSide;
        m.group.position.x += -Math.cos(hh) * side * 1.1 * w;
        m.group.position.z += Math.sin(hh) * side * 1.1 * w;
        m.group.rotation.y += side * 0.12 * w;
        m.group.rotation.z = side * 0.05 * w;
      } else m.group.rotation.z = 0;
      if (k < this.nMod - 1) {
        const j = P.at(sb - this.aFwd * TRAM.gap / 2), bl = this.bellows[k];
        bl.position.set(j.x, this.hAt(sb) + 1.55, j.z);
        bl.rotation.y = j.h;
      }
      off += m.len + TRAM.gap;
    });
    if (this.spot && this.spot.parent !== this.activeCab.inner) this.activeCab.inner.add(this.spot, this.spot.target);
    // punto di riferimento (come il centro del bus): 6 m dietro il muso della cabina attiva
    const sr = this.sFront - this.facing * TRAM.ref;
    const r = P.at(sr), ra = P.at(sr + 4), rb = P.at(sr - 4);
    this.x = r.x; this.z = r.z;
    this.elev = this.hAt(sr);
    const hc = Math.atan2(ra.x - rb.x, ra.z - rb.z);
    this.h = this.facing > 0 ? hc : hc + Math.PI;
  }

  update(dt, input, world) {
    const sp = Math.abs(this.v);
    // manipolatore: come i pedali del bus, progressivo; Shift per la tacca piena
    const thrT = input.throttle && !input.brake ? (input.shift ? 1 : 0.6) : 0;
    const brkT = input.brake ? (input.shift ? 1 : 0.6) : 0;
    this.throttle += Math.sign(thrT - this.throttle) * Math.min(Math.abs(thrT - this.throttle), dt * (thrT > this.throttle ? 0.9 : 3));
    this.brake += Math.sign(brkT - this.brake) * Math.min(Math.abs(brkT - this.brake), dt * (brkT > this.brake ? 2.5 : 4));
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
    const sPanto = this.sFront - this.facing * (TRAM.cab + TRAM.gap + TRAM.mid / 2);
    const wire = !this.track || this.track.wireAt(this.dirSig, this.pathOffset + sPanto);
    this.wireAvail = wire;
    this.wired = wire && this.pantoPos > 0.97;
    // trazione: 48 kN fino a ~36 km/h, poi potenza costante (480 kW dal filo, 160 kW a batteria); niente trazione a porte aperte
    const Pmax = this.wired ? 480000 : this.battery > 0.03 ? 160000 : 0;
    let F = doorHold || this.derailT > 0 ? 0 : this.throttle * Math.min(48000, Pmax / Math.max(1, sp));
    if (sp * 3.6 > 70) F = 0;
    const res = 0.004 * m * 9.81 + 0.5 * 1.2 * 2.6 * 3.1 * sp * sp;
    // frenata di servizio: ~1,3 m/s² con S, ~2,2 m/s² con Shift+S; col manipolatore in neutro un leggero freno
    // elettrico (~0,3 m/s²) fa rallentare il tram come quelli veri
    let dec = this.brake * 2.2;
    if (this.throttle < 0.05 && this.brake < 0.05) dec = Math.max(dec, 0.3 * Math.min(1, sp / 3));
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
    // deragliamento: in curva oltre ~3 m/s² di accelerazione laterale il carrello di testa esce dalla rotaia
    let hit = null;
    if (this.derailT > 0) {
      this.v = 0;
      this.derailT -= dt;
      this.derailAmt = Math.min(1, this.derailAmt + dt * 3);
      if (this.derailT <= 0) { this.derailAmt = 0; this.syncTransform(); this.onRerail && this.onRerail(); }
    } else {
      const k = this.curvature(this.sFront - this.facing * 3, true);
      if (!this.noDerail && this.v > 4 && this.v * this.v * Math.abs(k) > 3.0) {
        this.derailT = 10; this.derailAmt = 0; this.derailSide = (k > 0 ? 1 : -1) * this.facing;
        hit = { kind: 'derail', impact: 9, x: this.x, z: this.z, lz: 1 };
        this.v = 0;
      }
    }
    // collisioni: auto o tram sulla corsia davanti al muso
    if (world && world.carsNear) {
      const fr = this.path.at(this.sFront), fdx = fr.dx * this.facing, fdz = fr.dz * this.facing;
      for (const c of world.carsNear(fr.x, fr.z, 6)) {
        const rx = c.x - fr.x, rz = c.z - fr.z;
        const ahead = rx * fdx + rz * fdz, lat = Math.abs(rx * -fdz + rz * fdx);
        if (hit) break; // già deragliato
        if (ahead > -0.5 && ahead < (c.isTram ? 3.2 : 2.4) && lat < 1.9) {
          const across = c.h != null && Math.abs(Math.sin(c.h) * fdx + Math.cos(c.h) * fdz) < 0.6;
          hit = { kind: c.isTram ? 'tram' : 'car', car: c, impact: this.v, x: fr.x, z: fr.z, lz: 1, crossing: !c.isTram && across };
          // come con il bus: l'auto urtata frena e, se resta incastrata davanti al muso, sparisce (niente stallo col
          // semaforo in fase tram, che tiene il rosso alle auto finché il tram non passa)
          if (!c.isTram) c.bump = (c.bump || 0) + 1;
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
    // fanali bianchi davanti (cabina attiva), luci rosse dietro (accese anche in frenata e a porte aperte)
    for (const m of [this.modules[0], this.modules[this.nMod - 1]]) {
      const front = m === this.activeCab;
      m.headMat.emissiveIntensity = front ? (this.lights ? 2.4 : 0.2) : 0;
      m.tailMat.emissiveIntensity = front ? 0 : this.brake > 0.05 || doorHold ? 2.4 : this.lights ? 0.9 : 0.05;
    }
    this.spot.intensity = this.lights ? 120 : 0;
    // tergicristallo della cabina attiva (quello dell'altra resta a riposo) e gocce sul parabrezza
    this.wiperT = wiperPhase(this.wiperT, !!input.wipers, dt);
    const up = Math.sin(this.wiperT) * 0.5 + 0.5; // 0 a riposo, 1 contro il bordo del vetro
    for (const m of [this.modules[0], this.modules[this.nMod - 1]]) m.wipers.forEach((w, i) => {
      w.rotation.z = (w.userData.side * Math.PI) / 2 * (m === this.activeCab ? 1 - up : 1);
      if (m === this.activeCab) this.wiperArms[i].a = w.rotation.z;
    });
    if (dt > 0) this.activeCab.rainGlass.update(dt, input.rain || 0, sp, this.wiperArms);
    this.animDoors();
    return hit;
  }
  // si aprono solo le porte dal lato della banchina (a destra, o a sinistra alle banchine centrali)
  animDoors() {
    const towardA = this.facing === this.aFwd;
    this.doors.forEach((d, i) => {
      const want = (towardA ? -1 : 1) * (this.platformSide || 1) * (d.module && d.module.kind === 'cabB' ? -1 : 1);
      for (const leaf of d.leaves) {
        const { sd, lr, z0 } = leaf.userData, o = sd === want ? this.doorOpen[i] : 0;
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
