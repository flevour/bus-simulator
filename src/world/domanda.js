// Domanda di traffico (#116): ogni auto fa un viaggio, con origine, destinazione e ora. Zone, pesi, porte, tempi tra
// luoghi, probabilità delle destinazioni e curva oraria li prepara la build (scripts/domanda.py, docs/domanda.md) in
// src/data/padova-domanda.json; qui il gioco li legge e decide quali viaggi passano attorno a chi guida, senza simulare
// tutta la città:
//   - il grafo è quello dei movimenti delle auto: uno stato è un arco percorso in un verso (2·arco nel verso a -> b,
//     2·arco + 1 nel verso b -> a), i movimenti sono i raccordi della build con il bit delle auto, con lo stesso costo
//     della build (rete libera, semafori, svolte);
//   - un viaggio va da un accesso della zona d'origine (o da una porta) a un accesso della zona di destinazione (o a
//     una porta). Per ogni arrivo un albero dei tempi (Dijkstra all'indietro) dice da ogni stato quanto manca: l'auto
//     sceglie a ogni nodo il movimento che arriva prima, con i ritardi misurati dove le auto sono simulate. È il
//     percorso più veloce con i tempi del momento, rifatto a ogni svolta;
//   - quali viaggi passano di lì: con due alberi dallo stato P dove sta chi guida (verso P e da P), il viaggio da o a d
//     passa vicino a P se andare da o a P e poi da P a d costa poco più del viaggio diretto (tempi della build). Il tempo
//     in più dà la distanza a cui il viaggio passa da P, e da quella il tempo che passa nel disco di raggio R attorno a
//     chi guida. I viaggi che partono o arrivano negli accessi dentro il disco ci passano una parte del raggio. La somma
//     su tutti i viaggi dell'ora, per il loro numero, è quante auto ci sono nel disco;
//   - il raggio R è il più grande per cui le auto attese nel disco non superano quelle che il gioco simula (72): nelle
//     ore di punta il disco si stringe e le strade attorno a chi guida hanno le auto che avrebbero davvero.
// I conti lunghi (alberi) vanno a pezzi, con un numero fisso di stati per passo: non danno scatti e, a parità di
// passi, danno sempre lo stesso risultato (le prove ripartono dallo stesso stato, #122).
import DATI from '../data/padova-domanda.json' with { type: 'json' };

// velocità media di chi viaggia (m/s): dal tempo in più di un giro da P alla distanza da P, e al tempo nel disco
export const V_MEDIA = 8;
// raggi del disco provati (m), dal più grande
export const RAGGI = [1500, 1200, 950, 750, 600, 480, 380, 300];
// chi parte o arriva dentro il disco ci passa in media 8 / 3π del raggio (da un punto a caso del disco al bordo)
const DENTRO = 8 / (3 * Math.PI);
// stati chiusi per passo di un albero (meno di 1 ms)
const PASSI_ALBERO = 4000;
// alberi tenuti in memoria (240 KB l'uno)
const ALBERI_MAX = 96;
// fattore massimo sul tempo a rete libera di uno stato (l'assegnazione della build in pochi giri lascia qualche arco
// da 50 volte)
const FATTORE_MAX = 8;
// differenza di tempo su uno stato che non conta come ritardo (curve, partenze, il rosso preso a caso)
const RITARDO_MIN = 5;
const INF = Infinity;

// coda a priorità su array tipizzati (chiave, stato), con i duplicati al posto della riduzione della chiave
class Coda {
  constructor(n = 1 << 15) { this.k = new Float64Array(n); this.v = new Int32Array(n); this.n = 0; }
  push(k, v) {
    if (this.n === this.k.length) { const k2 = new Float64Array(this.n * 2), v2 = new Int32Array(this.n * 2); k2.set(this.k); v2.set(this.v); this.k = k2; this.v = v2; }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  }
  pop() {
    const K = this.k, V = this.v, v0 = V[0], k = K[--this.n], v = V[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && K[c + 1] < K[c]) c++;
      if (K[c] >= k) break;
      K[i] = K[c]; V[i] = V[c]; i = c;
    }
    K[i] = k; V[i] = v;
    return v0;
  }
}

// un albero dei tempi, calcolato a pezzi. Indietro: T[s] è il tempo dall'inizio dello stato s alla fine della radice.
// Avanti: dall'inizio della radice alla fine di s
class Albero {
  constructor(D, radice, avanti = false, t = D.t) {
    this.D = D;
    this.radice = radice; // uno stato, o una lista (gli alberi di P)
    this.avanti = avanti;
    this.t = t; // tempi degli stati: a rete libera (alberi di P) o della fascia (alberi degli arrivi)
    this.fascia = D.chiaveTempi;
    this.T = new Float32Array(D.nS).fill(INF);
    this.fatto = false;
    this.coda = new Coda();
    this.chiuso = new Uint8Array(D.nS);
    for (const s of Array.isArray(radice) ? radice : [radice]) this.coda.push(t[s], s);
  }
  // al più n stati chiusi; vero quando l'albero è finito
  passo(n) {
    if (this.fatto) return true;
    const { coda, T, chiuso, D, t } = this, off = this.avanti ? D.so : D.po, to = this.avanti ? D.sa : D.pa, c = this.avanti ? D.sc : D.pc;
    while (coda.n && n-- > 0) {
      const k = coda.k[0], s = coda.pop();
      if (chiuso[s]) continue;
      chiuso[s] = 1;
      T[s] = k;
      for (let j = off[s]; j < off[s + 1]; j++) {
        const u = to[j];
        if (!chiuso[u]) coda.push(k + c[j] + t[u], u);
      }
    }
    if (!coda.n) { this.fatto = true; this.coda = null; this.chiuso = null; }
    return this.fatto;
  }
}

export class Domanda {
  constructor(net, dati = DATI) {
    this.net = net;
    this.dati = dati;
    const E = net.edges, N = net.nodes, nS = (this.nS = 2 * E.length);
    // tempo a rete libera di ogni stato e punto di mezzo dell'arco (come tempo_stato di scripts/domanda.py)
    const C = dati.costo, t = (this.t = new Float32Array(nS));
    this.mx = new Float32Array(E.length);
    this.mz = new Float32Array(E.length);
    const centro = (x, z) => { const dx = x + 150, dz = (z - 120) * 1.15; return dx * dx + dz * dz < 950 * 950; };
    for (const e of E) {
      const A = N[e.a], B = N[e.b], mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
      this.mx[e.id] = mx; this.mz[e.id] = mz;
      t[2 * e.id] = t[2 * e.id + 1] = e.len / (e.cls <= 3 && !centro(mx, mz) ? C.vPrincipale : C.vLocale);
    }
    this.semafori = new Set();
    for (const s of net.signals || []) if (!s.ped) for (const n of s.nodes) this.semafori.add(n.id);
    // movimenti delle auto dai raccordi della build (docs/raccordi.md, sezione 4), come Rete di scripts/domanda.py
    const mov = [], visti = new Set(), F = net.raccordi;
    const dir = (s) => { const e = E[s >> 1]; return s & 1 ? [-e.dx, -e.dz] : [e.dx, e.dz]; };
    if (F) F.nodi.forEach((n, i) => {
      const v = F.voci[i], ns = String(n);
      for (let j = 0; j < v.length;) {
        const da = v[j], a = v[j + 1], c = v[j + 2], nv = ((c >> 9) & 1) + 1, nvia = c >> 10;
        const via = v.slice(j + 4 + 2 * nv, j + 4 + 2 * nv + nvia);
        j += 4 + 2 * nv + nvia;
        if (!((c >> 6) & 1)) continue;
        const s0 = 2 * da + (E[da].b === ns ? 0 : 1);
        let m = ns, extra = 0;
        for (const k of via) { const av = E[k].a === m; extra += t[2 * k + (av ? 0 : 1)]; m = av ? E[k].b : E[k].a; }
        const s1 = 2 * a + (E[a].a === m ? 0 : 1), key = s0 * nS + s1;
        if (visti.has(key)) continue;
        visti.add(key);
        // svolta: semaforo e, oltre 45 gradi, a sinistra o a destra (con z verso sud, a sinistra il prodotto è negativo)
        let costo = extra + (this.semafori.has(ns) ? C.semaforo : 0);
        const [ax, az] = dir(s0), [bx, bz] = dir(s1);
        if (ax * bx + az * bz < 0.7071) costo += ax * bz - az * bx < 0 ? C.sinistra : C.destra;
        mov.push([s0, s1, costo]);
      }
    });
    // successori e predecessori in forma compatta (CSR)
    const csr = (chi, dove) => {
      const off = new Int32Array(nS + 1);
      for (const m of mov) off[m[chi] + 1]++;
      for (let i = 0; i < nS; i++) off[i + 1] += off[i];
      const to = new Int32Array(mov.length), co = new Float32Array(mov.length), pos = off.slice(0, nS);
      for (const m of mov) { const k = pos[m[chi]]++; to[k] = m[dove]; co[k] = m[2]; }
      return [off, to, co];
    };
    [this.so, this.sa, this.sc] = csr(0, 1);
    [this.po, this.pa, this.pc] = csr(1, 0);
    // luoghi: le zone, poi le porte (come la matrice dei tempi della build). Partenze e arrivi: [stato, peso]
    this.zone = dati.zone.map(([x, z, ab, ad, sc, ne, so, c, acc]) => {
      const partenze = [], arrivi = [];
      for (let k = 0; k < acc.length; k += 3) { if (acc[k + 2] & 1) partenze.push([acc[k], acc[k + 1]]); if (acc[k + 2] & 2) arrivi.push([acc[k], acc[k + 1]]); }
      return { x, z, abitanti: ab, addetti: ad, scuole: sc, negozi: ne, sosta: so, centro: c, partenze, arrivi };
    });
    this.porte = dati.porte.map(([nome, x, z, peso, ing, usc]) => ({ nome, x, z, peso, porta: true, partenze: ing.map((s) => [s, 1]), arrivi: usc.map((s) => [s, 1]), ing, usc }));
    this.luoghi = [...this.zone, ...this.porte];
    const L = (this.L = this.luoghi.length);
    this.tempi = Uint16Array.from(dati.tempi);
    // per ogni scopo: quota di chi parte da o e probabilità della destinazione
    this.od = {};
    for (const s of dati.scopi) {
      const righe = dati.od[s], tot = righe.reduce((a, r) => a + r[1], 0), P = new Float32Array(L * L);
      for (const [o, g, ds] of righe) for (let k = 0; k < ds.length; k += 2) P[o * L + ds[k]] = (g / tot) * (ds[k + 1] / 1000);
      this.od[s] = P;
    }
    // fasce del giorno (scripts/domanda.py, carico): fattori dei tempi con la congestione e auto presenti per cella
    const Fz = dati.fasce, nf = Fz.ore.length;
    this.oreFasce = Fz.ore;
    this.fattori = Fz.fattori.map((r) => [r[0], r.slice(1).map((v) => Math.min(FATTORE_MAX, v / 100))]);
    this.cellaP = Fz.griglia;
    this.presenze = new Map();
    for (const r of Fz.presenze) this.presenze.set(`${r[0]},${r[1]}`, r.slice(2, 2 + nf).map((v) => v / 100));
    this.tF = Float32Array.from(t); // tempi della fascia di adesso (alberi degli arrivi)
    this.chiaveTempi = 'libera';
    this.alberi = new Map(); // stato d'arrivo -> Albero (indietro), in ordine d'uso
    this.coda = []; // arrivi in attesa del loro albero
    this.ritardi = new Map(); // stato -> secondi in più misurati dove le auto sono simulate
    this.rate = null;
    this.P = null;
    this.principale();
  }

  // stati della componente principale (si va e si torna dal centro della prima zona), con una griglia da 100 m dei
  // loro punti di mezzo: P è uno di questi (in una strada chiusa i tempi da e verso P non direbbero niente)
  principale() {
    const s0 = this.zone[0].centro, giro = (off, to) => {
      const v = new Uint8Array(this.nS), pila = [s0];
      v[s0] = 1;
      while (pila.length) { const s = pila.pop(); for (let j = off[s]; j < off[s + 1]; j++) if (!v[to[j]]) { v[to[j]] = 1; pila.push(to[j]); } }
      return v;
    };
    const av = giro(this.so, this.sa), ind = giro(this.po, this.pa), E = this.net.edges;
    this.inPrincipale = (s) => av[s] && ind[s];
    // stati della componente principale vicini a un punto (griglia da 100 m dei punti di mezzo), e nodi dove ne
    // arrivano e ne partono: P è uno di questi
    this.griglia = new Map();
    this.nodiP = new Map();
    const arr = new Set(), par = new Set();
    for (let s = 0; s < this.nS; s++) {
      if (!av[s] || !ind[s]) continue;
      const k = `${Math.floor(this.mx[s >> 1] / 100)},${Math.floor(this.mz[s >> 1] / 100)}`;
      (this.griglia.get(k) || this.griglia.set(k, []).get(k)).push(s);
      const e = E[s >> 1];
      arr.add(s & 1 ? e.a : e.b);
      par.add(s & 1 ? e.b : e.a);
    }
    for (const n of arr) {
      if (!par.has(n)) continue;
      const N = this.net.nodes[n], k = `${Math.floor(N.x / 100)},${Math.floor(N.z / 100)}`;
      (this.nodiP.get(k) || this.nodiP.set(k, []).get(k)).push(N);
    }
  }

  // ---------------------------------------------------------------
  // Ora: viaggi al secondo per coppia di luoghi
  // ---------------------------------------------------------------
  // viaggi che partono in un'ora, per giorno e ora del gioco (secondi dalla mezzanotte), interpolati tra le ore
  viaggiOra(clock, giorno = 'feriale', scopo = null) {
    const cu = this.dati.curva[giorno === 'festivo' ? 'festivo' : 'feriale'];
    const h = (((clock / 3600) % 24) + 24) % 24 - 0.5, h0 = Math.floor(h), f = h - h0;
    const at = (s, k) => cu[s][((k % 24) + 24) % 24];
    return (scopo ? [scopo] : this.dati.scopi).reduce((a, s) => a + at(s, h0) * (1 - f) + at(s, h0 + 1) * f, 0);
  }
  // imposta l'ora: rate[o·L + d], viaggi al secondo da o a d. Si rifà ogni minuto di gioco; vero se è cambiata
  ora(clock, giorno = 'feriale') {
    const minuto = `${giorno}:${Math.floor(clock / 60)}`;
    if (this._ora === minuto) return false;
    this._ora = minuto;
    const L = this.L, rate = this.rate || (this.rate = new Float32Array(L * L));
    rate.fill(0);
    for (const s of this.dati.scopi) {
      const n = this.viaggiOra(clock, giorno, s) / 3600, P = this.od[s];
      if (n > 0) for (let i = 0; i < L * L; i++) rate[i] += n * P[i];
    }
    // fascia: 0 mattino (5-10), 2 sera (16-20), 1 il resto; k: viaggi di quest'ora su quelli dell'ora della fascia
    const h = (((clock / 3600) % 24) + 24) % 24, f = h >= 5 && h < 10 ? 0 : h >= 16 && h < 20 ? 2 : 1;
    const k = this.viaggiOra(clock, giorno) / this.viaggiOra(this.oreFasce[f] * 3600 + 1800, 'feriale');
    this.fasciaOra = f;
    this.kOra = k;
    // tempi della fascia: l'eccesso sul tempo a rete libera va con la quarta potenza del flusso (BPR), quindi con k⁴
    // (k al più 1,3). Gli alberi si rifanno quando la chiave cambia: fascia e k a passi di 0,1
    const kq = Math.round(Math.min(1.3, k) * 10) / 10, chiave = `${f}:${kq}`;
    if (chiave !== this.chiaveTempi) {
      this.chiaveTempi = chiave;
      this.tF.set(this.t);
      const k4 = kq ** 4;
      for (const [st, fs] of this.fattori) this.tF[st] = this.t[st] * (1 + (fs[f] - 1) * k4);
      // gli alberi vecchi restano alle auto che li hanno finché non è pronto il nuovo (chooseNext)
      this.alberi.clear();
      this.coda.length = 0;
    }
    this.sporco = true;
    return true;
  }
  // auto attese nel disco di raggio R attorno a P, dalle presenze della build per la fascia, scalate con i viaggi
  // dell'ora: un'auto presente per ogni cella da GRIGLIA metri col centro nel disco
  attesePresenze(R) {
    const { x, z } = this.P, g = this.cellaP, f = this.fasciaOra;
    let n = 0;
    for (let i = Math.floor((x - R) / g); i <= Math.floor((x + R) / g); i++) for (let j = Math.floor((z - R) / g); j <= Math.floor((z + R) / g); j++) {
      const p = this.presenze.get(`${i},${j}`);
      if (p && ((i + 0.5) * g - x) ** 2 + ((j + 0.5) * g - z) ** 2 <= R * R) n += p[f];
    }
    return n * this.kOra;
  }

  // ---------------------------------------------------------------
  // Alberi
  // ---------------------------------------------------------------
  // l'albero dello stato d'arrivo s se è pronto, altrimenti null (e lo mette in coda)
  albero(s) {
    const A = this.alberi.get(s);
    if (A) {
      this.alberi.delete(s); this.alberi.set(s, A); // in fondo all'ordine d'uso
      return A.fatto ? A : null;
    }
    this.alberi.set(s, new Albero(this, s, false, this.tF));
    this.coda.push(s);
    for (const k of this.alberi.keys()) {
      if (this.alberi.size <= ALBERI_MAX) break;
      if (k !== s) this.alberi.delete(k);
    }
    return null;
  }
  // tutto subito (alla partenza della corsa)
  alberoOra(s) {
    this.albero(s);
    const A = this.alberi.get(s);
    A.passo(Infinity);
    return A;
  }
  // un passo dei conti in sospeso, al più n stati: prima i due alberi di chi guida, poi quelli degli arrivi in coda
  passo(n = PASSI_ALBERO) {
    const P = this.P;
    if (P && !P.fatto) {
      if (!P.verso.fatto) P.verso.passo(n);
      else P.da.passo(n);
      if (P.verso.fatto && P.da.fatto) { P.fatto = true; this.sporco = true; }
      return;
    }
    while (this.coda.length) {
      const A = this.alberi.get(this.coda[0]);
      if (!A || A.fatto) { this.coda.shift(); continue; }
      if (A.passo(n)) this.coda.shift();
      return;
    }
  }

  // ---------------------------------------------------------------
  // Chi guida: lo stato P, i suoi alberi e quali viaggi passano di lì
  // ---------------------------------------------------------------
  // lo stato della componente principale col punto di mezzo più vicino a (x, z)
  statoVicino(x, z) {
    let best = -1, bd = Infinity;
    const gx = Math.floor(x / 100), gz = Math.floor(z / 100);
    for (let r = 0; r < 8 && best < 0; r++) {
      for (let i = gx - r; i <= gx + r; i++) for (let j = gz - r; j <= gz + r; j++) {
        if (Math.max(Math.abs(i - gx), Math.abs(j - gz)) !== r) continue;
        for (const s of this.griglia.get(`${i},${j}`) || []) {
          const d = (this.mx[s >> 1] - x) ** 2 + (this.mz[s >> 1] - z) ** 2;
          if (d < bd || (d === bd && s < best)) { bd = d; best = s; }
        }
      }
    }
    return best;
  }
  // il nodo dove arrivano e partono stati della componente principale più vicino a (x, z)
  nodoVicino(x, z) {
    let best = null, bd = Infinity;
    const gx = Math.floor(x / 100), gz = Math.floor(z / 100);
    for (let r = 0; r < 8 && !best; r++) {
      for (let i = gx - r; i <= gx + r; i++) for (let j = gz - r; j <= gz + r; j++) {
        if (Math.max(Math.abs(i - gx), Math.abs(j - gz)) !== r) continue;
        for (const N of this.nodiP.get(`${i},${j}`) || []) {
          const d = (N.x - x) ** 2 + (N.z - z) ** 2;
          if (d < bd || (d === bd && +N.id < +best.id)) { bd = d; best = N; }
        }
      }
    }
    return best;
  }
  // chi guida è in (x, z): se si è spostato di più di 150 m, i due alberi del nodo P si rifanno (a pezzi, o subito):
  // verso P dagli stati che ci arrivano, da P dagli stati che ne partono (nei due versi: un viaggio che passa da P in
  // un verso o nell'altro non fa giri)
  centro(x, z, subito = false) {
    if (this.P && Math.hypot(this.P.x - x, this.P.z - z) < 150) return;
    const N = this.nodoVicino(x, z);
    if (!N) return;
    const entra = [], esce = [];
    for (const e of N.edges) for (const f of [0, 1]) {
      const s = 2 * e.id + f;
      if (!this.inPrincipale(s)) continue;
      if ((f ? e.a : e.b) === N.id) entra.push(s);
      else esce.push(s);
    }
    this.P = { x, z, n: N, verso: new Albero(this, entra), da: new Albero(this, esce, true), fatto: false };
    if (subito) { this.P.verso.passo(Infinity); this.P.da.passo(Infinity); this.P.fatto = true; }
    this.sporco = true;
  }
  // il tempo dal luogo o a P e da P al luogo d (dagli alberi di P, dal centro della zona o dalle porte)
  versoP(o) {
    const l = this.luoghi[o], T = this.P.verso.T;
    return l.porta ? Math.min(INF, ...l.ing.map((s) => T[s])) : T[l.centro];
  }
  daP(d) {
    const l = this.luoghi[d], T = this.P.da.T;
    return l.porta ? Math.min(INF, ...l.usc.map((s) => T[s])) : T[l.centro];
  }
  // quota degli accessi (per peso) di ogni luogo dentro i raggi Rs del disco attorno a P: luogo -> [partenze, arrivi],
  // una quota per raggio (solo i luoghi che ne hanno dentro)
  quoteDentro(Rs) {
    const { x, z } = this.P, out = new Map(), Rmax = Math.max(...Rs);
    const quota = (acc) => Rs.map((R) => {
      let a = 0, b = 0;
      for (const [s, w] of acc) { b += w; if ((this.mx[s >> 1] - x) ** 2 + (this.mz[s >> 1] - z) ** 2 <= R * R) a += w; }
      return b ? a / b : 0;
    });
    this.luoghi.forEach((l, i) => {
      if (Math.hypot(l.x - x, l.z - z) > Rmax + 1500) return;
      const p = quota(l.partenze), a = quota(l.arrivi);
      if (p.some((v) => v > 0) || a.some((v) => v > 0)) out.set(i, [p, a]);
    });
    return out;
  }
  // auto nei dischi di raggio Rs secondo i giri da P: N[k], e (se w) i pesi cumulati delle coppie per Rs[0] nei tre modi di stare
  // nel disco: passarci (da fuori a fuori, il tempo della corda alla distanza a cui il viaggio passa da P), partirci e
  // arrivarci (DENTRO del raggio)
  presenze3(Rs, w = null) {
    const L = this.L, nR = Rs.length, q = this.quoteDentro(Rs), N = new Float64Array(nR), rate = this.rate, tempi = this.tempi;
    const a = this._a, b = this._b, zero = new Float32Array(nR);
    const qo = new Array(L), qd = new Array(L);
    for (let i = 0; i < L; i++) { const v = q.get(i); qo[i] = v ? v[0] : zero; qd[i] = v ? v[1] : zero; }
    let cum = 0;
    for (let o = 0; o < L; o++) {
      const ao = a[o], po = qo[o];
      for (let d = 0; d < L; d++) {
        const i = o * L + d, r = rate[i];
        if (!r) { if (w) w[3 * i] = w[3 * i + 1] = w[3 * i + 2] = cum; continue; }
        const T = tempi[i], ok = T !== 65535 && ao < INF && b[d] < INF;
        const x = ok ? (V_MEDIA * Math.max(0, ao + b[d] - T)) / 2 : INF, pd = qd[d];
        for (let k = 0; k < nR; k++) {
          const R = Rs[k], fo = po[k], fd = pd[k];
          const p0 = x < R ? (r * (1 - fo) * (1 - fd) * 2 * Math.sqrt(R * R - x * x)) / V_MEDIA : 0;
          const p1 = (r * fo * DENTRO * R) / V_MEDIA, p2 = (r * (1 - fo) * fd * DENTRO * R) / V_MEDIA;
          N[k] += p0 + p1 + p2;
          if (w && k === 0) { w[3 * i] = cum += p0; w[3 * i + 1] = cum += p1; w[3 * i + 2] = cum += p2; }
        }
      }
    }
    return { N, q };
  }
  // auto attese nel disco di ogni raggio di RAGGI (dalle presenze della build), il raggio e i pesi per scegliere i
  // viaggi delle auto nuove. Il raggio è il più grande per cui le auto attese non superano cap (per bisezione tra i due
  // raggi provati che lo racchiudono); i pesi vengono dai giri da P
  aggiorna(cap) {
    if (!this.P || !this.P.fatto || !this.rate || (!this.sporco && cap === this._cap)) return false;
    this.sporco = false;
    this._cap = cap;
    const L = this.L;
    this._a = this._a || new Float32Array(L);
    this._b = this._b || new Float32Array(L);
    for (let i = 0; i < L; i++) { this._a[i] = this.versoP(i); this._b[i] = this.daP(i); }
    const N = RAGGI.map((R) => this.attesePresenze(R));
    this.attese = Object.fromEntries(RAGGI.map((R, k) => [R, N[k]]));
    let R;
    const k = RAGGI.findIndex((_, j) => N[j] <= cap);
    if (k === 0) R = RAGGI[0];
    else if (k < 0) R = RAGGI[RAGGI.length - 1];
    else {
      let lo = RAGGI[k], hi = RAGGI[k - 1];
      for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; if (this.attesePresenze(m) <= cap) lo = m; else hi = m; }
      R = Math.round(lo);
    }
    this.R = R;
    const w = this.peso || (this.peso = new Float64Array(3 * L * L));
    const { q } = this.presenze3([R], w);
    this.q = q;
    this.pesoTot = w[3 * L * L - 1];
    this.quante = Math.min(cap, this.attesePresenze(R));
    return true;
  }

  // ---------------------------------------------------------------
  // Viaggi
  // ---------------------------------------------------------------
  // un accesso a caso, per peso, tra quelli dati (solo quelli dentro il disco, se dentro)
  accesso(acc, rnd, dentro = false) {
    let lista = acc;
    if (dentro) {
      const { x, z } = this.P, R = this.R;
      lista = acc.filter(([s]) => (this.mx[s >> 1] - x) ** 2 + (this.mz[s >> 1] - z) ** 2 <= R * R);
      if (!lista.length) lista = acc;
    }
    let tot = 0;
    for (const [, w] of lista) tot += w;
    let r = rnd() * tot;
    for (const [s, w] of lista) if ((r -= w) <= 0) return s;
    return lista[lista.length - 1][0];
  }
  // costo del movimento da s a u (0 se non c'è) e, con l'albero A, fino all'arrivo, con il ritardo misurato su u
  costoMov(s, u) {
    for (let j = this.so[s]; j < this.so[s + 1]; j++) if (this.sa[j] === u) return this.sc[j];
    return 0;
  }
  costo(s, u, A) { return this.costoMov(s, u) + A.T[u] + (this.ritardi.get(u) || 0); }
  // un'auto ha passato sec secondi sullo stato s prima di entrare in u: il tempo in più rispetto a quello a rete libera
  // (oltre RITARDO_MIN, per le differenze di andatura che ci sono anche senza code) entra nella media dello stato
  segna(s, u, sec) {
    const x = Math.max(0, sec - this.t[s] - this.costoMov(s, u) - RITARDO_MIN), r = this.ritardi.get(s) || 0, v = r + 0.3 * (x - r);
    if (v > 0.5) this.ritardi.set(s, v);
    else this.ritardi.delete(s);
  }
  // i ritardi misurati si dimenticano: ogni 10 s di gioco perdono il 15%
  invecchia(dt) {
    this._vecchio = (this._vecchio || 0) + dt;
    if (this._vecchio < 10) return;
    this._vecchio -= 10;
    for (const [s, v] of this.ritardi) if (v * 0.85 > 0.5) this.ritardi.set(s, v * 0.85); else this.ritardi.delete(s);
  }
  // da capo, a ogni corsa (startMission): niente alberi, ritardi, ora né chi guida. Gli alberi sono gli stessi a ogni
  // corsa, ma quali sono già pronti cambierebbe quando nascono le auto
  reset() {
    this.alberi.clear();
    this.coda.length = 0;
    this.ritardi.clear();
    this._vecchio = 0;
    this._ora = null;
    this.rate = null;
    this.P = null;
    this.pesoTot = 0;
    this.sporco = true;
  }

  // il movimento migliore da s verso la radice dell'albero A: [stato dopo, costo fino all'arrivo]; con i ritardi
  // misurati, se veri
  migliore(s, A, ritardi = true) {
    let best = -1, bc = INF;
    for (let j = this.so[s]; j < this.so[s + 1]; j++) {
      const u = this.sa[j], c = this.sc[j] + A.T[u] + (ritardi ? this.ritardi.get(u) || 0 : 0);
      if (c < bc) { bc = c; best = u; }
    }
    return [best, bc];
  }
  // il percorso da s fino alla radice dell'albero A: [stati], o null se non ci si arriva
  percorso(s, A, n = 3000) {
    const out = [s];
    while (s !== A.radice && out.length < n) {
      const [u] = this.migliore(s, A, false);
      if (u < 0 || A.T[u] === INF) return null;
      out.push((s = u));
    }
    return s === A.radice ? out : null;
  }
  // un viaggio a caso tra quelli che passano nel disco attorno a chi guida, per un'auto nuova: { o, d, arrivo, stato,
  // f, albero } con lo stato dove l'auto nasce (a più di rIn metri da (cx, cz) e dentro il disco) e la frazione
  // dell'arco. null se l'albero dell'arrivo non è pronto (è in coda) o il viaggio non passa nel disco. Il posto è a
  // caso lungo il tratto del percorso nel disco, per il tempo che ci passa
  campiona(rnd, cx, cz, rIn, subito = false) {
    if (!this.pesoTot) return null;
    const L = this.L, w = this.peso, r = rnd() * this.pesoTot;
    let lo = 0, hi = 3 * L * L - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (w[m] < r) lo = m + 1; else hi = m; }
    const modo = lo % 3, i = (lo - modo) / 3, o = Math.floor(i / L), d = i % L;
    const s0 = this.accesso(this.luoghi[o].partenze, rnd, modo === 1);
    const arrivo = this.accesso(this.luoghi[d].arrivi, rnd, modo === 2);
    const A = subito ? this.alberoOra(arrivo) : this.albero(arrivo);
    if (!A || A.T[s0] === INF) return null;
    const p = this.percorso(s0, A);
    if (!p) return null;
    const R = this.R, dentro = [];
    let tot = 0;
    for (const s of p) {
      if (s === A.radice) break; // sull'arrivo il viaggio è finito
      const e = s >> 1, q = (this.mx[e] - cx) ** 2 + (this.mz[e] - cz) ** 2;
      if (q <= R * R && q >= rIn * rIn) { dentro.push(s); tot += this.t[s]; }
    }
    if (!dentro.length) return null;
    let x = rnd() * tot, stato = dentro[dentro.length - 1];
    for (const s of dentro) if ((x -= this.t[s]) <= 0) { stato = s; break; }
    return { o, d, arrivo, stato, f: rnd(), albero: A, modo };
  }
  // il viaggio dopo, per chi è arrivato nel luogo o: la destinazione per le probabilità dell'ora e il suo arrivo
  prossimo(o, rnd) {
    const L = this.L;
    let tot = 0;
    for (let d = 0; d < L; d++) tot += this.rate[o * L + d];
    if (!tot) return null;
    let r = rnd() * tot, d = 0;
    for (; d < L - 1; d++) if ((r -= this.rate[o * L + d]) <= 0) break;
    return { o, d, arrivo: this.accesso(this.luoghi[d].arrivi, rnd) };
  }
}
