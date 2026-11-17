// Inseguitore di percorso (#113): auto e bus automatici seguono un percorso continuo fatto degli assi delle corsie
// (laneLayout) e dei raccordi di corsia calcolati nella build (net.raccordi, docs/raccordi.md). Il mezzo ha una
// progressiva lungo il percorso: il centro del suo asse posteriore sta sul percorso e la direzione è la tangente, quindi
// non va di traverso, non salta e in curva gira con il raggio del raccordo, mai sotto il minimo della sua classe.
// Gli spostamenti di lato fanno parte del percorso: il cambio di corsia è un tratto della corsia (una cicloide), il
// resto (sorpasso, fuori dalla sede del tram, accosto alle fermate) è uno scostamento che cambia al più di K metri per
// metro e con la curva entro A, e che prima di un raccordo stretto torna entro quello che il raccordo ammette. Auto
// (src/world/traffic.js) e bus automatici (src/world/buses.js) usano questo modulo: cambiano solo il modo in cui
// scelgono la strada. Dove la build non ha un raccordo per il mezzo il percorso usa un ripiego, dichiarato sul pezzo e
// contato (ripiego()).
import { laneLayout, edgeHeight } from '../data/padova.js';

// classi di mezzo dei raccordi (bit) e raggi minimi, come nella build (docs/raccordi.md, sezione 2)
export const AUTO = 1, BUS12 = 2, SNODATO = 4;
const RAGGI = { [AUTO]: 3.8, [BUS12]: 8.3, [SNODATO]: 8.5 };
export const raggioMinimo = (bit) => RAGGI[bit];
// pendenza del cambio di corsia quando c'è posto (metri di lato per metro): 3 m di corsia in 25 m
const PEND_CAMBIO = 0.12;
// un raccordo con raggio da qui in su (oltre il doppio del minimo, con 4 m di margine) lascia muovere lo scostamento
const LIBERO = 4;

// corsie di marcia dell'arco nel verso fwd (a -> b): distanza dall'asse a destra di chi va e corsia dei bus, da
// sinistra a destra; una sola dove in quel verso laneLayout non ne ha, dove oggi passano i mezzi (come marcia di
// scripts/raccordi.py e leggi di tests/raccordi.spec.js: le corsie dei raccordi sono queste)
export function corsie(e, fwd) {
  const k = fwd ? '_corsieF' : '_corsieB';
  if (e[k]) return e[k];
  const d = fwd ? 1 : -1;
  let mie = laneLayout(e).lanes.filter((l) => l.d === d).map((l) => ({ off: fwd ? l.off : -l.off, bus: !!l.bus })).sort((a, b) => a.off - b.off);
  if (!mie.length) mie = [{ off: e.oneway ? (e.width < 8 ? 0 : e.width / 2 - 2) : e.width / 4, bus: false }];
  return (e[k] = mie);
}

// ------------------------------------------------------------------
// Raccordi della build, decodificati per nodo alla prima richiesta (formato in docs/raccordi.md, sezione 4)
// ------------------------------------------------------------------
export class Raccordi {
  constructor(net) {
    this.net = net;
    this.F = net.raccordi;
    this.pos = new Map();
    if (this.F) this.F.nodi.forEach((n, i) => this.pos.set(String(n), i));
    // senza il campo (la rete ha saltato degli archi, src/data/padova.js) nessun mezzo saprebbe dove svoltare: lo si dice
    else console.error('net.raccordi manca: auto e bus automatici senza raccordi di corsia');
    this.memo = new Map();
  }
  // i raccordi che cominciano al nodo n (id): { n, m, da, a, via, fin, fout, cda, ca, classi, r, P }
  at(n) {
    let out = this.memo.get(n);
    if (out) return out;
    out = [];
    const i = this.pos.get(n);
    if (i !== undefined) {
      const v = this.F.voci[i], E = this.net.edges, O = this.net.nodes[n];
      for (let j = 0; j < v.length;) {
        const c = v[j + 2], nv = ((c >> 9) & 1) + 1, nvia = c >> 10;
        const P = [];
        for (let k = 0; k < nv; k++) P.push({ x: O.x + v[j + 4 + 2 * k] / 100, z: O.z + v[j + 5 + 2 * k] / 100 });
        const via = [];
        for (let k = 0; k < nvia; k++) via.push(E[v[j + 4 + 2 * nv + k]]);
        const da = E[v[j]], a = E[v[j + 1]];
        let m = n;
        for (const x of via) m = x.a === m ? x.b : x.a;
        out.push({ n, m, da, a, via, fin: da.b === n, fout: a.a === m, cda: c & 7, ca: (c >> 3) & 7, classi: (c >> 6) & 7, r: v[j + 3] / 10, P });
        j += 4 + 2 * nv + nvia;
      }
    }
    this.memo.set(n, out);
    return out;
  }
}
// l'indice dei raccordi della rete, uno per tutti
export const raccordiDi = (net) => net._raccordi || (net._raccordi = new Raccordi(net));

// ------------------------------------------------------------------
// Geometria
// ------------------------------------------------------------------
// direzione d ruotata di f radianti nel piano x/z (verso +x -> verso +z con f positivo)
const ruota = (d, f) => ({ x: d.x * Math.cos(f) - d.z * Math.sin(f), z: d.x * Math.sin(f) + d.z * Math.cos(f) });

// tratti della curva: arco di cerchio di raggio r a ogni vertice di P, tangente ai lati; arriva lungo din ed esce
// lungo dout. Con r = 0 (corsie allineate) il raccordo è il punto del vertice
export function curvaPer(P, din, dout, r) {
  const dirs = [din];
  for (let k = 1; k < P.length; k++) {
    const l = Math.hypot(P[k].x - P[k - 1].x, P[k].z - P[k - 1].z) || 1;
    dirs.push({ x: (P[k].x - P[k - 1].x) / l, z: (P[k].z - P[k - 1].z) / l });
  }
  dirs.push(dout);
  const tr = [];
  let ang = 0, fine = null;
  for (let k = 0; k < P.length; k++) {
    const d1 = dirs[k], d2 = dirs[k + 1], cr = d1.x * d2.z - d1.z * d2.x;
    const th = Math.atan2(Math.abs(cr), d1.x * d2.x + d1.z * d2.z), t = r * Math.tan(th / 2);
    const A = { x: P[k].x - d1.x * t, z: P[k].z - d1.z * t };
    if (fine) {
      const l = Math.hypot(A.x - fine.x, A.z - fine.z);
      if (l > 1e-4) tr.push({ arco: false, len: l, A: fine, d: d1 });
    }
    if (r > 0 && th > 1e-5) {
      const sg = cr >= 0 ? 1 : -1;
      tr.push({ arco: true, len: r * th, A, d: d1, sg, r, C: { x: A.x - sg * r * d1.z, z: A.z + sg * r * d1.x } });
      fine = { x: P[k].x + d2.x * t, z: P[k].z + d2.z * t };
    } else {
      // corsie allineate: un punto, con la direzione d'uscita
      tr.push({ arco: false, len: 0, A, d: d2 });
      fine = A;
    }
    ang += th;
  }
  let len = 0;
  for (const t of tr) { t.u0 = len; len += t.len; }
  return { tr, len, ang, p0: tr[0].A, p1: fine, r };
}

// punto e tangente a u metri dall'inizio della curva
function suCurva(g, u, out) {
  const tr = g.tr;
  let k = tr.length - 1;
  while (k > 0 && tr[k].u0 > u) k--;
  const t = tr[k], w = Math.max(0, Math.min(t.len, u - t.u0));
  if (t.arco) {
    const d = ruota(t.d, (t.sg * w) / t.r);
    out.x = t.C.x + t.sg * t.r * d.z; out.z = t.C.z - t.sg * t.r * d.x;
    out.dx = d.x; out.dz = d.z;
  } else {
    out.x = t.A.x + t.d.x * w; out.z = t.A.z + t.d.z * w;
    out.dx = t.d.x; out.dz = t.d.z;
  }
}

// curva di un raccordo della build, con le progressive dei capi: s0 sull'arco d'arrivo dal suo nodo di partenza (nel
// verso di marcia), s1 su quello d'uscita dal nodo m
export function curva(net, R) {
  if (R.g) return R.g;
  const N = net.nodes, da = R.da, a = R.a;
  const din = R.fin ? { x: da.dx, z: da.dz } : { x: -da.dx, z: -da.dz };
  const dout = R.fout ? { x: a.dx, z: a.dz } : { x: -a.dx, z: -a.dz };
  // raggio zero: il punto dove due corsie allineate si toccano. Se le due direzioni differiscono di poco (archi della
  // rete appena piegati) lo spigolo sarebbe un colpo di sterzo: un arco di 30 m, con al più mezzo metro di tangente,
  // che resta sulle due rette di corsia
  let r = R.r;
  if (!r && R.P.length === 1) {
    const th = Math.atan2(Math.abs(din.x * dout.z - din.z * dout.x), din.x * dout.x + din.z * dout.z);
    if (th > 1e-4) r = Math.min(30, 0.5 / Math.tan(th / 2));
  }
  const g = curvaPer(R.P, din, dout, r);
  const S = N[R.fin ? da.a : da.b], M = N[R.m];
  g.s0 = (g.p0.x - S.x) * din.x + (g.p0.z - S.z) * din.z;
  g.s1 = (g.p1.x - M.x) * dout.x + (g.p1.z - M.z) * dout.z;
  return (R.g = g);
}

// ------------------------------------------------------------------
// Pezzi del percorso: at(u, out) dà punto (x, z), tangente (dx, dz), la normale lungo cui si misura lo scostamento
// (nx, nz, a destra) e la derivata della base (bx, bz), a u metri dall'inizio del pezzo
// ------------------------------------------------------------------
// tratto della corsia sull'arco e nel verso fwd, da sa a sb metri dal nodo di partenza; scostamento o0 fino a c0, o1
// da c1, in mezzo il cambio di corsia: una cicloide, che ha la curva zero ai due capi (si attacca a un raccordo senza
// sommare le due curve) e la più forte a metà
export class Corsia {
  constructor(N, e, fwd, sa, sb, o0, o1, c0, c1, corsia) {
    const S = N[fwd ? e.a : e.b];
    this.tipo = 'corsia';
    this.e = e; this.fwd = fwd; this.sa = sa; this.sb = sb; this.len = Math.max(0, sb - sa);
    this.dx = fwd ? e.dx : -e.dx; this.dz = fwd ? e.dz : -e.dz; this.Sx = S.x; this.Sz = S.z;
    this.o0 = o0; this.o1 = o1; this.c0 = c0; this.c1 = Math.max(c1, c0 + 1e-3);
    this.to = N[fwd ? e.b : e.a];
    this.corsia = corsia; // posto della corsia alla fine, da sinistra
  }
  off(s) {
    if (s <= this.c0 || this.o0 === this.o1) return s <= this.c0 ? this.o0 : this.o1;
    if (s >= this.c1) return this.o1;
    const t = (s - this.c0) / (this.c1 - this.c0);
    return this.o0 + (this.o1 - this.o0) * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI));
  }
  dOff(s) {
    if (s <= this.c0 || s >= this.c1 || this.o0 === this.o1) return 0;
    const L = this.c1 - this.c0;
    return ((this.o1 - this.o0) * (1 - Math.cos((2 * Math.PI * (s - this.c0)) / L))) / L;
  }
  at(u, out) {
    const s = this.sa + u, o = this.off(s), k = this.dOff(s), dx = this.dx, dz = this.dz;
    out.x = this.Sx + dx * s - dz * o; out.z = this.Sz + dz * s + dx * o;
    out.nx = -dz; out.nz = dx;
    out.bx = dx - dz * k; out.bz = dz + dx * k;
    const l = Math.hypot(out.bx, out.bz);
    out.dx = out.bx / l; out.dz = out.bz / l;
    return out;
  }
}

// il raccordo R (della build o di ripiego) come pezzo del percorso. Rmin: raggio minimo di chi lo percorre; in un
// raccordo stretto lo scostamento resta fermo e al più latOk, perché la curva spostata di lato non scenda sotto Rmin
export class Curva {
  constructor(net, R, Rmin) {
    const g = R.g || curva(net, R);
    this.tipo = 'raccordo';
    this.R = R; this.g = g; this.len = g.len;
    this.lib = g.r === 0 || g.ang < 0.05 || g.r >= 2 * Rmin + LIBERO;
    this.latOk = this.lib ? Infinity : Math.max(0, g.r - Rmin - 0.2);
  }
  at(u, out) {
    suCurva(this.g, u, out);
    out.nx = -out.dz; out.nz = out.dx; out.bx = out.dx; out.bz = out.dz;
    return out;
  }
  // quota sopra il terreno a u metri: tra quella del capo sull'arco d'arrivo e quella del capo sull'arco d'uscita
  quota(u) {
    if (this.h0 === undefined) {
      const R = this.R, g = this.g;
      this.h0 = R.da ? edgeHeight(R.da, R.fin ? g.s0 : R.da.len - g.s0) : 0;
      this.h1 = R.a ? edgeHeight(R.a, R.fout ? g.s1 : R.a.len - g.s1) : 0;
    }
    return this.h0 + (this.h1 - this.h0) * (this.len > 0 ? Math.max(0, Math.min(1, u / this.len)) : 1);
  }
}

// ------------------------------------------------------------------
// Il percorso e il mezzo che lo segue
// ------------------------------------------------------------------
export class Percorso {
  constructor() {
    this.pezzi = [];
    this.fine = 0;
  }
  aggiungi(p) {
    p.q0 = this.fine;
    this.fine += p.len;
    this.pezzi.push(p);
    return p;
  }
  // il pezzo che contiene la progressiva q (tra due pezzi, quello dopo); si parte da quello della volta prima, perché
  // chi segue il percorso chiede quasi sempre lo stesso pezzo o il successivo
  indice(q) {
    const P = this.pezzi, n = P.length;
    let k = this._k || 0;
    if (k < n && P[k].q0 <= q) {
      while (k + 1 < n && P[k + 1].q0 <= q) k++;
      if (k - (this._k || 0) < 8) return (this._k = k);
    }
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (P[m].q0 <= q) lo = m; else hi = m - 1; }
    return (this._k = lo);
  }
  at(q, out) {
    const p = this.pezzi[this.indice(q)];
    p.at(Math.max(0, Math.min(p.len, q - p.q0)), out);
    out.p = p;
    return out;
  }
  // via i pezzi finiti prima di q
  taglia(q) {
    let k = 0;
    while (k < this.pezzi.length - 1 && this.pezzi[k].q0 + this.pezzi[k].len < q) k++;
    if (k) { this.pezzi.splice(0, k); this._k = 0; }
  }
}

const Q = {};
// mette il mezzo o sul percorso: il centro dell'asse posteriore alla progressiva o.q, scostato di o.lat a destra, con
// la direzione della tangente più la pendenza dello scostamento (o.pend); x, z: asse metri più avanti (il centro del
// mezzo). Restituisce il pezzo in cui sta l'asse posteriore
export function posa(per, o, asse) {
  per.at(o.q, Q);
  const hx = Q.bx + Q.nx * o.pend, hz = Q.bz + Q.nz * o.pend, l = Math.hypot(hx, hz) || 1;
  o.h = Math.atan2(hx, hz);
  o.x = Q.x + Q.nx * o.lat + (hx / l) * asse;
  o.z = Q.z + Q.nz * o.lat + (hz / l) * asse;
  return Q.p;
}
// il punto del percorso a q (senza scostamento), in un oggetto che si riusa
export const punto = (per, q, out = Q) => per.at(q, out);

// scostamento massimo che si può tenere a D metri utili (dove lo scostamento si può muovere: fuori dai raccordi stretti
// e dalle pause attorno, vedi stretti()) da un raccordo stretto per tornarci in tempo entro il suo latOk, con pendenza
// al più K e curva al più A
const rientro = (D, A, K) => {
  D = Math.max(0, D - 0.5 - K / A);
  return D <= (2 * K) / A ? (A * D * D) / 4 : K * (D - K / A);
};

// muove lo scostamento del mezzo o verso il bersaglio (metri a destra) dopo ds metri di strada: pendenza al più K
// metri per metro, curva al più A; da fermi non cambia. Dentro un raccordo stretto resta fermo: prima lo si porta entro
// il suo latOk, contando solo i metri dove si può muovere, e un metro e mezzo prima si smette di muoverlo (la pendenza
// arriva a zero, perché dentro la direzione è quella della curva); appena usciti si aspetta un metro prima di muoverlo,
// perché la curva del raccordo e quella dello scostamento non si sommino. Restituisce il bersaglio usato
export function scosta(per, o, bersaglio, ds, A, K) {
  const i0 = per.indice(o.q), m = stretti(per, o, i0), p0 = per.pezzi[i0];
  // metri utili già fatti nel pezzo, se ci si può muovere di lato
  const fatto = m.qui ? 0 : Math.max(0, Math.min(m.utile0, o.q - p0.q0 - m.pausa0));
  let lim = m.qui ? m.qui.latOk : Infinity, prossimo = Infinity;
  for (const t of m.lista) {
    const libero = t.libero - fatto;
    lim = Math.min(lim, t.latOk + rientro(libero, A, K));
    prossimo = Math.min(prossimo, libero);
  }
  const b = Math.max(-lim, Math.min(lim, bersaglio));
  // dentro non si taglia: uno scostamento rimasto oltre latOk (pochi centimetri) stringe un poco la curva, un taglio
  // sarebbe un salto di lato
  if (m.qui) { o.pend = 0; return b; }
  if (ds <= 0) return b;
  // appena usciti da un raccordo stretto
  if (m.uscita != null && o.q - m.uscita <= 1) return b;
  let voglio;
  const ferma = prossimo < Math.abs(o.pend) / A + 1.5, err = b - o.lat;
  // arrivati: gli ultimi millimetri in un passo, con la pendenza che cambia al più quanto in un passo qualunque
  if (!ferma && Math.abs(err) < 0.05 * ds && Math.abs(o.pend) <= A * ds) { o.lat = b; o.pend = 0; return b; }
  if (ferma) voglio = 0;
  else voglio = Math.sign(err) * Math.min(K, Math.sqrt(2 * A * Math.abs(err)));
  o.pend += Math.max(-A * ds, Math.min(A * ds, voglio - o.pend));
  o.lat += o.pend * ds;
  return b;
}

// i raccordi stretti davanti al pezzo i0, entro 60 m utili: per ognuno latOk e i metri utili fin lì, dall'inizio del
// pezzo (o dalla sua fine, se è stretto: qui). Utili sono i metri dove lo scostamento si muove: fuori dai raccordi
// stretti, dal metro dopo e dal metro e mezzo prima (utile0 e pausa0 per il pezzo i0); uscita, la fine di un raccordo
// stretto appena prima. In memoria sul mezzo finché non cambia il pezzo o il percorso non si allunga
function stretti(per, o, i0) {
  const P = per.pezzi, p0 = P[i0];
  let m = o._stretti;
  if (m && m.p === p0 && m.fine === per.fine) return m;
  const stretto = (p) => !!p && p.tipo === 'raccordo' && !p.lib;
  m = o._stretti = { p: p0, fine: per.fine, qui: stretto(p0) ? p0 : null, lista: [], uscita: null, utile0: 0, pausa0: 0 };
  let libero = 0;
  for (let i = i0; i < P.length && libero - m.utile0 < 60; i++) {
    const p = P[i];
    if (stretto(p)) { if (i > i0) m.lista.push({ latOk: p.latOk, libero }); continue; }
    const pausa = stretto(P[i - 1]) ? 1 : 0, utile = Math.max(0, p.len - pausa - (stretto(P[i + 1]) ? 1.5 : 0));
    if (i === i0) { m.utile0 = utile; m.pausa0 = pausa; }
    libero += utile;
  }
  for (let i = i0 - 1; i >= 0 && P[i].q0 + P[i].len >= p0.q0 - 1; i--) if (stretto(P[i])) { m.uscita = P[i].q0 + P[i].len; break; }
  return m;
}

// lo scostamento di un mezzo appena messo sul percorso (nato, spostato): dentro un raccordo stretto, al più quello che
// il raccordo ammette, e fermo
export function entro(per, o) {
  for (let i = per.indice(o.q); i >= 0; i--) {
    const p = per.pezzi[i];
    if (p.q0 + p.len < o.q) break;
    if (p.tipo === 'raccordo' && !p.lib && p.q0 <= o.q) { o.lat = Math.max(-p.latOk, Math.min(p.latOk, o.lat)); o.pend = 0; }
  }
}

// ------------------------------------------------------------------
// Cambi di corsia lungo un arco
// ------------------------------------------------------------------
// lunghezza minima del cambio di corsia di dO metri perché la curva (al più 2π dO / D² a metà della cicloide) resti
// entro metà del raggio minimo, e quella voluta
const cambioMin = (dO, Rmin) => Math.sqrt(4 * Math.PI * dO * Rmin);
const cambioVoluto = (dO, Rmin) => Math.max(cambioMin(dO, Rmin), dO / PEND_CAMBIO);

// costo di passare dalla corsia i alla j sull'arco e (verso fwd) in L metri: 0 se è la stessa, poi le corsie da
// cambiare; 100 se non c'è posto per un cambio entro il raggio minimo, 1000 se i due raccordi si sovrappongono
export function costoCambio(e, fwd, i, j, L, Rmin) {
  if (L < -0.05) return 1000;
  if (i === j) return 0;
  const cs = corsie(e, fwd), dO = Math.abs(cs[j].off - cs[i].off);
  return Math.abs(i - j) + (L >= cambioMin(dO, Rmin) + 0.5 ? 0 : 100);
}

// tratto di corsia sull'arco e (verso fwd) da sa a sb, dalla corsia i alla j. Il cambio è lungo quanto serve a non
// superare PEND_CAMBIO di pendenza e metà della curva del raggio minimo; se c'è meno posto, quanto c'è, e lo si conta
export function tratto(N, e, fwd, sa, sb, i, j, Rmin, conta) {
  const cs = corsie(e, fwd), o0 = cs[Math.min(i, cs.length - 1)].off, o1 = cs[Math.min(j, cs.length - 1)].off;
  if (Math.abs(o1 - o0) < 1e-3) return new Corsia(N, e, fwd, sa, sb, o0, o0, sa, sa, j);
  const dO = Math.abs(o1 - o0), Dmin = cambioMin(dO, Rmin), Dv = cambioVoluto(dO, Rmin), L = sb - sa;
  let c0, D, corto = false;
  if (L >= Dv + 2) { D = Dv; c0 = sa + 1 + (L - D - 2) * 0.2; }
  else if (L >= Dmin + 0.5) { D = L - 0.5; c0 = sa + 0.25; }
  else { D = Math.max(0.5, L); c0 = sa; corto = true; if (conta) conta('cambio di corsia corto', N[fwd ? e.b : e.a]); }
  const p = new Corsia(N, e, fwd, sa, sb, o0, o1, c0, c0 + D, j);
  if (corto) p.ripiego = 'cambio di corsia corto';
  return p;
}

// ------------------------------------------------------------------
// Ripieghi: curve dove la build non ha un raccordo per il mezzo (bus: #134 per il raggio, #114 per le svolte che la
// rete non ammette e le inversioni). Sono dichiarati: chi li usa li conta, e il pezzo del percorso dice quale ripiego è
// (p.ripiego), per la prova del moto (tests/moto.js)
// ------------------------------------------------------------------
// curva dalla corsia ci dell'arco ein (verso fin), libera da sDa metri, alla corsia co di eout (verso fout), che
// arriva al nodo n e parte dal nodo m (lo stesso, o oltre gli archi che un raccordo scavalcava): un arco di cerchio tra
// le due rette di corsia, il più largo che sta nel posto libero (al più 15 m); un'inversione è un mezzo giro; due corsie
// parallele nello stesso verso, una esse
export function ripiego(net, ein, fin, ci, sDa, eout, fout, co, n, m = n) {
  const N = net.nodes, O = N[n], M = N[m];
  const din = fin ? { x: ein.dx, z: ein.dz } : { x: -ein.dx, z: -ein.dz };
  const dout = fout ? { x: eout.dx, z: eout.dz } : { x: -eout.dx, z: -eout.dz };
  const ci2 = corsie(ein, fin), co2 = corsie(eout, fout);
  const oi = ci2[Math.min(ci, ci2.length - 1)].off, oo = co2[Math.min(co, co2.length - 1)].off;
  // rette di corsia: dal nodo d'arrivo e da quello di partenza, scostate a destra; posto libero sulla corsia d'arrivo
  // da sDa (dove finisce il pezzo prima) e su quella d'uscita fino a metà arco
  const A = { x: O.x - din.z * oi, z: O.z + din.x * oi }, B = { x: M.x - dout.z * oo, z: M.z + dout.x * oo };
  const cr = din.x * dout.z - din.z * dout.x, dot = din.x * dout.x + din.z * dout.z;
  const qui = ein.len - sDa; // metri liberi prima del nodo
  const tan = (p, q) => Math.tan(Math.atan2(Math.abs(p.x * q.z - p.z * q.x), p.x * q.x + p.z * q.z) / 2);
  // due vertici, V1 sulla retta d'arrivo e V2 su quella d'uscita: il raggio voluto, o quello per cui i due archi stanno
  // tra i vertici e il primo comincia entro avanti metri prima di V1
  const due = (V1, V2, voluto, avanti) => {
    const l = Math.hypot(V2.x - V1.x, V2.z - V1.z) || 1e-3, u = { x: (V2.x - V1.x) / l, z: (V2.z - V1.z) / l };
    const t1 = tan(din, u), t2 = tan(u, dout);
    return Math.max(0.3, Math.min(voluto, avanti / Math.max(t1, 1e-3), l / Math.max(t1 + t2, 1e-3)));
  };
  let P, r, tipo;
  if (dot < -0.9) {
    // mezzo giro: dalla corsia d'arrivo al nodo a quella d'uscita, girando dalla parte dove sta l'altra
    const w = (B.x - A.x) * -din.z + (B.z - A.z) * din.x, rr = Math.max(0.5, Math.abs(w) / 2);
    const av = (B.x - A.x) * din.x + (B.z - A.z) * din.z; // l'uscita più avanti (o indietro) lungo l'arrivo
    const a1 = rr + Math.max(0, av), a2 = rr + Math.max(0, -av);
    P = [{ x: A.x + din.x * a1, z: A.z + din.z * a1 }, { x: B.x - dout.x * a2, z: B.z - dout.z * a2 }];
    r = due(P[0], P[1], rr, qui + a1); tipo = 'inversione';
  } else if (Math.abs(cr) < 0.05) {
    // corsie parallele nello stesso verso: una esse con i vertici fino a 6 m dal nodo, prima e dopo
    const L = Math.max(0.5, Math.min(6, qui - 1));
    P = [{ x: A.x - din.x * L, z: A.z - din.z * L }, { x: B.x + dout.x * 6, z: B.z + dout.z * 6 }];
    r = due(P[0], P[1], 8.5, qui - L); tipo = 'esse';
  } else {
    // vertice: incontro delle due rette di corsia
    const t = ((B.x - A.x) * dout.z - (B.z - A.z) * dout.x) / cr;
    const V = { x: A.x + din.x * t, z: A.z + din.z * t };
    const th = Math.atan2(Math.abs(cr), dot), tan = Math.tan(th / 2);
    const room = Math.max(0.3, Math.min(qui + t - 0.3, eout.len / 2 - ((V.x - B.x) * dout.x + (V.z - B.z) * dout.z)));
    P = [V]; r = Math.max(0.5, Math.min(15, room / Math.max(tan, 1e-3))); tipo = 'curva';
  }
  const S = N[fin ? ein.a : ein.b];
  let g = curvaPer(P, din, dout, r);
  g.s0 = (g.p0.x - S.x) * din.x + (g.p0.z - S.z) * din.z;
  if (g.s0 < sDa - 0.05) {
    // la curva comincerebbe prima di dove si è: due vertici, il primo un metro avanti sulla corsia d'arrivo, il
    // secondo sulla corsia d'uscita almeno 3 m oltre, con il raggio che ci sta (stretto quanto serve, ma continuo)
    const S0 = { x: S.x + din.x * sDa - din.z * oi, z: S.z + din.z * sDa + din.x * oi };
    const V1 = { x: S0.x + din.x, z: S0.z + din.z }, b = Math.max(3, (V1.x - B.x) * dout.x + (V1.z - B.z) * dout.z + 3);
    const V2 = { x: B.x + dout.x * b, z: B.z + dout.z * b };
    P = [V1, V2]; r = due(V1, V2, 8.5, 1);
    tipo = 'curva stretta';
    g = curvaPer(P, din, dout, r);
    g.s0 = (g.p0.x - S.x) * din.x + (g.p0.z - S.z) * din.z;
  }
  g.s1 = (g.p1.x - M.x) * dout.x + (g.p1.z - M.z) * dout.z;
  const R = { n, m, da: ein, a: eout, via: [], fin, fout, cda: ci, ca: co, classi: 0, r, P, ripiego: tipo, g };
  return R;
}

// ------------------------------------------------------------------
// Percorso di un bus lungo una sequenza di archi
// ------------------------------------------------------------------
// raccordo R al nodo segs[i].n1 che segue il percorso: arriva da segs[i], scavalca gli archi che seguono e arriva su
// quello dopo
const segue = (R, segs, i) => {
  for (let j = 0; j < R.via.length; j++) if (!segs[i + 1 + j] || segs[i + 1 + j].e !== R.via[j]) return false;
  const s = segs[i + 1 + R.via.length];
  return !!s && s.e === R.a && s.fwd === R.fout;
};

// segs: [{ e, fwd, n0, n1 }] uno per tratto tra due nodi del percorso. bit: classe del mezzo. Ogni svolta prende un
// raccordo della build per il mezzo (prima i diretti, poi quelli che scavalcano archi corti); senza, quello delle auto
// (ripiego "auto": raggio sotto il minimo del bus, #134) o una curva del gioco (ripiego, vedi ripiego()). Le corsie si
// scelgono su tutto il percorso insieme: meno cambi di corsia, mai senza posto, e a destra quando si può. conta(tipo,
// nodo) per ogni ripiego. Restituisce il percorso e, per ogni pezzo, i tratti del percorso (k0, k1) e le progressive
// sui due archi, per chi deve passare dal percorso dei nodi a quello del bus
export function percorsoBus(net, segs, bit, conta) {
  const N = net.nodes, rac = raccordiDi(net), Rmin = RAGGI[bit];
  const mosse = [];
  for (let i = 0; i < segs.length - 1;) {
    const s = segs[i], t = segs[i + 1];
    // due nodi del percorso senza un arco tra loro (dopo s): lo si salta in linea retta (vuota)
    if (!s.e) { i++; continue; }
    if (!t.e) { mosse.push({ i, k: i + 2, racs: [], vuota: true }); i += 2; continue; }
    const qui = rac.at(s.n1).filter((R) => R.da === s.e && segue(R, segs, i));
    const prendi = (f) => {
      const ok = qui.filter(f);
      if (!ok.length) return null;
      const corti = Math.min(...ok.map((R) => R.via.length));
      return ok.filter((R) => R.via.length === corti);
    };
    let racs = prendi((R) => R.classi & bit), tipo = null;
    if (!racs) { racs = prendi((R) => R.classi & AUTO); tipo = 'raccordo delle auto'; }
    if (!racs) {
      const ci = corsie(s.e, s.fwd).length - 1, co = corsie(t.e, t.fwd).length - 1, prima = mosse[mosse.length - 1];
      const sDa = prima && prima.k === i && prima.racs.length ? Math.max(...prima.racs.map((R) => R.g.s1)) : 0;
      const R = ripiego(net, s.e, s.fwd, ci, sDa, t.e, t.fwd, co, s.n1);
      racs = [R]; tipo = R.ripiego;
    }
    for (const R of racs) curva(net, R);
    const k = i + 1 + racs[0].via.length;
    mosse.push({ i, k, racs, tipo });
    i = k;
  }
  // corsie: cammino di costo minimo sui raccordi delle svolte (Viterbi)
  const iniz = corsie(segs[0].e || { width: 0, oneway: 1 }, segs[0].fwd).length - 1;
  const piene = mosse.filter((m) => !m.vuota);
  const costi = [], da = [];
  piene.forEach((m, j) => {
    const sg = segs[m.k], nOut = sg && sg.e ? corsie(sg.e, sg.fwd).length : 1;
    costi.push([]); da.push([]);
    m.racs.forEach((R, a) => {
      const pref = 0.3 * (nOut - 1 - R.ca); // a destra quando si può
      if (j === 0) {
        const s0 = segs[m.i];
        costi[j][a] = costoCambio(s0.e, s0.fwd, iniz, R.cda, R.g.s0, Rmin) + pref; da[j][a] = -1;
        return;
      }
      const p = piene[j - 1], sg2 = segs[m.i];
      let best = Infinity, bi = 0;
      p.racs.forEach((Q, b) => {
        const c = costi[j - 1][b] + (p.k === m.i && sg2.e ? costoCambio(sg2.e, sg2.fwd, Q.ca, R.cda, R.g.s0 - Q.g.s1, Rmin) : 0);
        if (c < best) { best = c; bi = b; }
      });
      costi[j][a] = best + pref; da[j][a] = bi;
    });
  });
  const scelta = new Array(piene.length);
  if (piene.length) {
    const ult = costi[piene.length - 1];
    let a = ult.indexOf(Math.min(...ult));
    for (let j = piene.length - 1; j >= 0; j--) { scelta[j] = piene[j].racs[a]; a = da[j][a]; }
  }
  piene.forEach((m, j) => { m.R = scelta[j]; if (m.tipo) conta(m.tipo, N[segs[m.i].n1], m.R); });
  // pezzi
  const per = new Percorso();
  let cor = iniz, s = 0, k = 0;
  const lane = (sg, sa, sb, i, j, kk) => {
    const p = per.aggiungi(tratto(N, sg.e, sg.fwd, sa, sb, i, j, Rmin, (t, n) => conta(t, n)));
    p.k0 = p.k1 = kk;
    return p;
  };
  for (const m of mosse) {
    const sg = segs[m.i];
    if (m.vuota) {
      // due nodi del percorso senza un arco tra loro: dalla fine della corsia si va diritto all'inizio della corsia
      // dell'arco dopo (ripiego contato: il mezzo cambia direzione di colpo)
      const pa = lane(sg, s, Math.max(s, sg.e.len), cor, cor, m.i), A = pa.at(pa.len, {});
      const dopo = segs[m.k];
      cor = dopo && dopo.e ? corsie(dopo.e, dopo.fwd).length - 1 : 0;
      const B = dopo && dopo.e ? new Corsia(N, dopo.e, dopo.fwd, 0, 0, corsie(dopo.e, dopo.fwd)[cor].off, 0, 0, 0, cor).at(0, {}) : N[segs[m.i + 1].n1];
      const l = Math.hypot(B.x - A.x, B.z - A.z) || 0.01;
      const R = { n: segs[m.i + 1].n0, m: segs[m.i + 1].n1, da: null, a: null, via: [], ripiego: 'senza arco' };
      R.g = { tr: [{ arco: false, len: l, A: { x: A.x, z: A.z }, d: { x: (B.x - A.x) / l, z: (B.z - A.z) / l }, u0: 0 }], len: l, ang: 0, r: 0, p0: A, p1: B, s0: 0, s1: 0 };
      const p = per.aggiungi(new Curva(net, R, Rmin));
      p.k0 = m.i + 1; p.k1 = m.k; p.ripiego = 'senza arco';
      conta('senza arco', N[segs[m.i + 1].n0]);
      s = 0; k = m.k;
      continue;
    }
    let R = m.R, rip = m.tipo;
    if (sg.e) {
      // il raccordo comincia prima della fine di quello di prima, o da un'altra corsia senza posto per cambiarla (su un
      // arco corto: i raccordi della build valgono svolta per svolta): una curva del gioco dalla corsia e dal punto
      // dove si è
      const L = R.g.s0 - s;
      if (R.a && (L < -0.05 || costoCambio(sg.e, sg.fwd, cor, R.cda, L, Rmin) >= 100)) {
        rip = L < -0.05 ? 'raccordi sovrapposti' : 'cambio di corsia senza posto';
        conta(rip, N[sg.n1]);
        R = ripiego(net, sg.e, sg.fwd, cor, s, R.a, R.fout, R.ca, R.n, R.m);
      }
      lane(sg, s, Math.max(s, R.g.s0), cor, R.cda, m.i);
    }
    const p = per.aggiungi(new Curva(net, R, Rmin));
    p.k0 = m.i; p.k1 = m.k;
    if (rip) p.ripiego = rip;
    cor = R.ca; s = R.g.s1; k = m.k;
  }
  const ult = segs[k];
  if (ult && ult.e) lane(ult, s, Math.max(s, ult.e.len), cor, cor, k);
  return per;
}
