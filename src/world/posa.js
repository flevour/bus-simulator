// Il posatore (#109): mette nello spazio libero della mappa semafori e ripetitrici, tiranti, mensole e pali della
// linea aerea, lanterne del tram, segnali degli scambi, cartelli del pantografo e paline. Gira solo nella build
// (scripts/posa_arredo.mjs costruisce la città in Node e gli fa posare tutto); il gioco non lo importa: legge il
// risultato da src/data/padova-arredo.json con Arredo (src/data/arredo.js), che ha gli stessi metodi.
// L'ordine è fisso: binari (TramTrack, TramYard, TramNet, dai dati), pianta delle strade (net.surfaces), spazio
// libero, arredo. Lo spazio libero è uno solo, SpazioLibero qui sotto: fuori dall'asfalto, dalla sagoma del tram e
// dagli edifici di tutta la mappa, non di quelli che il gioco ha caricato in quel momento. Fino al 16 novembre ogni
// elemento si cercava il posto da solo al caricamento (TrafficLights.placeApproach, City.poleSpot, spanAnchor in
// City.buildTramway, TramSignals.buildHeads, City.buildStops): le ricerche sono quelle, portate qui.
import { Grid, distToSeg } from './spatial.js';
import { Y_ROAD } from './city.js';
import { armPoint, armCrossings } from './traffic.js';
import { TRAM, CATENARY_HEIGHT } from '../tram/tram.js';
import { laneSpan } from '../data/padova.js';
import { allStopPlacements } from '../game/routes.js';
import { CODICE, TIPI } from '../data/arredo.js';

function inRing(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

// Lo spazio libero: dove può stare un palo. Tre domande, ognuna con la sua misura
export class SpazioLibero {
  // edifici: tutti quelli della mappa ({ pts, holes }, dalle aree)
  constructor(city, edifici) {
    this.city = city;
    this.bld = new Grid(20);
    for (const b of edifici) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of b.pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
      this.bld.insertAABB({ pts: b.pts, holes: b.holes || null }, x0, z0, x1, z1);
    }
    this._q = [];
  }
  // distanza dal bordo dell'asfalto della pianta delle strade: negativa in carreggiata (la sede del tram è asfalto)
  asfalto(x, z) { return this.city.surfaceOff(x, z); }
  // dentro la sagoma del tram: a meno di r metri da un binario (linee, depositi e S dei capolinea: city.tramLanes)
  sagoma(x, z, r, binari = this.city.tramLanes) { return binari.some((P) => P.projectNear(x, z, r)); }
  // dentro un edificio (non nei cortili), o a meno di m metri dai suoi muri
  edificio(x, z, m = 0) {
    for (const b of this.bld.query(x, z, m + 0.5, this._q)) {
      if (inRing(x, z, b.pts) && !(b.holes || []).some((h) => inRing(x, z, h))) return true;
      if (m > 0) for (const r of [b.pts, ...(b.holes || [])]) for (let i = 0; i < r.length; i++) {
        const a = r[i], c = r[(i + 1) % r.length];
        if (distToSeg(x, z, a.x, a.z, c.x, c.z).d < m) return true;
      }
    }
    return false;
  }
}

export class Posatore {
  constructor(edifici) {
    this.edifici = edifici;
    this.dati = Object.fromEntries(TIPI.map((t) => [t, []]));
  }
  spazio(city) { return this._S || (this._S = new SpazioLibero(city, this.edifici)); }
  // scrive l'elemento e lo rilegge: la città della build usa le stesse cifre del gioco
  scrivi(tipo, ...args) {
    const a = CODICE[tipo].enc(...args);
    this.dati[tipo].push(a);
    return CODICE[tipo].dec(a);
  }

  // ---- semafori: linea d'arresto, pali e lanterne di un approccio ----
  semaforo(lights, sig, ap) {
    const nodes = lights.net.nodes, n = ap.node, e = ap.edge, city = lights.city, S = this.spazio(city);
    // linea d'arresto: dove OSM mette il semaforo del braccio, altrimenti 1 m prima delle strisce vicine all'incrocio,
    // altrimenti appena fuori dall'incrocio. Mai sulle strisce e sempre sull'arco d'arrivo (lì si fermano i veicoli)
    const trim = n.trim ? n.trim.get(e) : n.joint ? 0 : n.radius * 0.6;
    const cross = armCrossings(nodes, n, e, sig.ped ? 5 : trim + 14);
    let s = cross.length ? Math.max(...cross) + 2.7 : sig.ped ? 3.2 : trim + 1.0;
    // il nodo OSM del semaforo è spesso sull'angolo dell'incrocio, oltre le strisce: vale solo se è più lontano
    if (ap.info && ap.info.stop > s) s = ap.info.stop;
    s = Math.max(s, trim + 0.6);
    for (const c of cross) if (c - 2.2 < s && c + 2.2 > s) s = c + 2.7;
    // la linea può stare su un arco precedente (bracci con vertici intermedi vicino all'incrocio), non oltre il braccio
    let p = armPoint(nodes, n, e, s);
    if (s > p.end - 2) p = armPoint(nodes, n, e, (s = Math.max(Math.min(s, p.end - 2), Math.min(trim + 0.6, p.end - 1))));
    const q = armPoint(nodes, n, e, s + 12);
    // le lanterne guardano chi arriva, lungo l'asse del braccio alla linea d'arresto (non l'arco del grafo)
    let fx = q.x - p.x, fz = q.z - p.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    const hw = e.width / 2;
    // bordo dell'asfalto da un lato (side 1 = destra di chi arriva): dall'asse si attraversa la carreggiata fino al
    // primo punto fuori
    const edgeAt = (px, pz, side) => {
      const rx = fz * side, rz = -fx * side;
      let seen = S.asfalto(px, pz) < 0;
      for (let o = 0.2; o <= hw + 16; o += 0.2) {
        const v = S.asfalto(px + rx * o, pz + rz * o);
        if (v < 0) seen = true;
        else if (seen || o > hw) return o;
      }
      return null;
    };
    // 0 = libero, 1 = edificio (si può appendere la lanterna al muro), 2 = asfalto o binari
    const free = (x, z) => {
      if (S.asfalto(x, z) < 0.25 || city.clearance(x, z, ['tram', 'rail'], 15) < 0.4) return 2;
      return S.edificio(x, z, 0.2) ? 1 : 0;
    };
    // palo appena oltre la linea d'arresto (art. 168: il primo veicolo fermo vede le luci), 0,6 m fuori dall'asfalto;
    // se lì non c'è posto, poco più avanti o poco prima. Dove il marciapiede è stretto e c'è la facciata (centro
    // storico) la lanterna va su una mensola a muro
    const place = (side) => {
      let wall = null;
      for (const d of [-0.6, -1.6, -2.8, 0.6, 1.8, 3.2]) {
        const sp = s + d;
        if (sp < 0.5) continue;
        const a = armPoint(nodes, n, e, sp);
        const o = edgeAt(a.x, a.z, side);
        if (o == null) continue;
        const at = (po) => ({ x: a.x + fz * side * po, z: a.z - fx * side * po, o: po, d });
        const P = at(o + 0.6), f = free(P.x, P.z);
        if (f === 0) return P;
        if (f === 1 && !wall) { const W = at(o + 0.25); if (free(W.x, W.z) !== 2) wall = { ...W, wall: true }; }
      }
      return wall;
    };
    // a destra; se a destra non c'è posto (sede del tram accanto, un piazzale tutto asfalto), a sinistra: sui sensi
    // unici dall'altra parte della carreggiata, sulle vie a doppio senso oltre le corsie di chi viene incontro. Fino
    // al 16 novembre sulle vie a doppio senso l'approccio restava senza lanterna
    let R = place(1), Rs = 1;
    if (!R) { R = place(-1); Rs = -1; }
    // Il posto trovato è prima della linea d'arresto (verso chi arriva): il primo veicolo fermo avrebbe la lanterna di
    // fianco o alle spalle. La linea arretra fino a 0,6 m prima del palo, come dove il palo sta oltre la linea, se lì
    // non ci sono strisce e il braccio non è finito; l'asse delle lanterne resta quello di prima
    if (R && R.d > 0) {
      const s2 = s + R.d + 0.6, p2 = armPoint(nodes, n, e, s2);
      if (s2 <= p2.end - 2 && !cross.some((c) => c - 2.2 < s2 && c + 2.2 > s2)) { s = s2; p = p2; }
    }
    if (R) {
      // vie larghe (due o più corsie nel verso) o palo lontano dalle corsie: palo a sbraccio con la lanterna sopra le
      // corsie di chi arriva
      const reach = R.o - Rs * (e.oneway ? 0 : hw / 2); // dal palo al centro delle corsie di chi arriva
      R = { x: R.x, z: R.z, wall: !!R.wall, side: Rs, mast: !R.wall && !sig.ped && e.cls <= 5 && (ap.lanes >= 2 || reach > hw + 3.5) ? Math.min(10, reach) : 0 };
    }
    // ripetitrice a sinistra, obbligatoria sui sensi unici con due o più corsie (art. 168 c. 3)
    const Lp = e.oneway && ap.lanes >= 2 && Rs === 1 ? place(-1) : null;
    // linea d'arresto: continua, larga 50 cm, sulle corsie di chi arriva (art. 144)
    const er = edgeAt(p.x, p.z, 1);
    const el = e.oneway ? edgeAt(p.x, p.z, -1) : null;
    // con le corsie di OSM dalla riga che separa i versi (anche quella gialla di una corsia dei bus in controsenso)
    const span = e.osmLanes ? laneSpan(e, e.b === n.id) : null;
    const w0 = span && span[0] > -hw ? span[0] + 0.15 : e.oneway ? -((el ?? hw) - 0.3) : 0.15;
    return this.scrivi('semafori', n, { stop: s, w0, w1: (er ?? hw) - 0.3, R, L: Lp ? { x: Lp.x, z: Lp.z, wall: !!Lp.wall } : null });
  }

  // ---- posto per un palo accanto al binario (segnali degli scambi, cartelli del pantografo, lanterne del tram; #97) ----
  // Dal punto p del binario, verso (dx, dz), dalla parte side (1 a destra di chi va verso dx, dz), il punto più vicino
  // al binario tra min e max metri che sta fuori dall'asfalto di almeno 0,4 m (marciapiede, isola, verde: dove stanno i
  // pali veri), a più di clear metri da ogni binario (fuori dalla sagoma del tram, cassa e franco compresi) e fuori
  // dagli edifici. A ogni distanza si prova anche qualche metro prima o dopo (along). Con asfalto: true va bene anche
  // l'asfalto (piazzali dove non c'è altro). null se non c'è posto
  palo(city, p, side, { min = TRAM.lane + 0.6, max = 12, along = [0], clear = TRAM.lane + 0.5, asfalto = false } = {}) {
    const S = this.spazio(city);
    for (let o = min; o <= max; o += 0.25) for (const a of along) {
      const x = p.x + p.dx * a - p.dz * side * o, z = p.z + p.dz * a + p.dx * side * o;
      if (!asfalto && S.asfalto(x, z) < 0.4) continue;
      if (S.sagoma(x, z, clear)) continue;
      if (S.edificio(x, z)) continue;
      return { x, z, o, side };
    }
    return null;
  }

  // ---- linea aerea: un tirante trasversale ogni 30 m sopra i fili, agganciato alle facciate o a pali ai lati ----
  lineaAerea(city, tracks) {
    const L = TRAM.lane, S = this.spazio(city), out = [];
    // facciate vicine alla sede, in celle da 20 m: i tiranti si agganciano lì
    const FC = 20, fac = new Map(), nearTrack = new Set(), ck = (x, z) => Math.floor(x / FC) + ',' + Math.floor(z / FC);
    for (const T of tracks) for (const d of [1, -1]) { const P = T.path(d); for (let s = 0; s <= P.len; s += 10) { const p = P.at(s); for (const ox of [-1, 0, 1]) for (const oz of [-1, 0, 1]) nearTrack.add(ck(p.x + ox * FC, p.z + oz * FC)); } }
    for (const b of this.edifici) {
      if (!b.pts.some((p) => nearTrack.has(ck(p.x, p.z)))) continue;
      for (let i = 0; i < b.pts.length; i++) {
        const a = b.pts[i], c = b.pts[(i + 1) % b.pts.length], seg = [a.x, a.z, c.x, c.z];
        for (const k of new Set([ck(a.x, a.z), ck(c.x, c.z), ck((a.x + c.x) / 2, (a.z + c.z) / 2)])) { if (!fac.has(k)) fac.set(k, []); fac.get(k).push(seg); }
      }
    }
    const yardPaths = city.tramYards.flatMap((Y) => Y.edges.map((e) => e.path));
    // fuori dall'asfalto di almeno 0,4 m: conta l'asfalto vero della pianta (la sede è asfalto), non il nastro
    // dell'arco; prima l'asfalto, la distanza dalla sede del SIR1 costa di più
    const offRoad = (x, z) => S.asfalto(x, z) >= 0.4 && city.clearance(x, z, ['tram'], 12) >= 0.1;
    // sedi di tutti i binari in una griglia (un punto ogni 1,5 m): un tirante non passa mai sopra un'altra sede
    const SG = 4, sedi = new Map(), sk = (x, z) => Math.floor(x / SG) + ',' + Math.floor(z / SG);
    for (const T of tracks) for (const d of [1, -1]) {
      const P = T.path(d);
      for (let s = 0; s <= P.len; s += 1.5) { const p = P.at(s), k = sk(p.x, p.z); if (!sedi.has(k)) sedi.set(k, []); sedi.get(k).push(p.x, p.z); }
    }
    const onSede = (x, z) => {
      const ix = Math.floor(x / SG), iz = Math.floor(z / SG);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const c = sedi.get(ix + a + ',' + (iz + b));
        if (c) for (let i = 0; i < c.length; i += 2) if (Math.hypot(c[i] - x, c[i + 1] - z) < L + 0.2) return true;
      }
      return false;
    };
    // spanAnchor: dal centro (cx, cz) verso (nx, nz), oltre half metri, dove agganciare il tirante: la prima facciata
    // entro 14 m, altrimenti un palo dove finisce l'asfalto (marciapiede, isola, verde) entro 24 m, fuori dalla sagoma di
    // ogni binario e prima della facciata che c'è dietro (o la facciata stessa). Con la sede in mezzo alla strada i pali
    // stanno così sui marciapiedi e il tirante passa sopra le corsie: nel progetto del SIR2 i pali stanno ai bordi di una
    // strada larga 24 m, con il tirante su tutta la carreggiata (docs/linee-tram-nuove.md). La ricerca si ferma sulla
    // sede di un altro binario (versi separati con le corsie in mezzo): da quel lato niente aggancio (null)
    const REACH = 24;
    // fuori dalla sagoma dei binari delle linee e dei depositi (con la cassa che in curva stretta va verso l'interno);
    // skip: i binari da non contare (quelli del tirante, per i pali sul cordolo)
    const sagomaPaths = tracks.flatMap((T) => [T.path(1), T.path(-1)]).concat(yardPaths);
    const fuoriSagoma = (x, z, r = L + 0.6, skip = null) => !S.sagoma(x, z, r, skip ? sagomaPaths.filter((P) => !skip.includes(P)) : sagomaPaths);
    const spanAnchor = (cx, cz, nx, nz, half) => {
      let stop = REACH;
      for (let k = half; k < REACH; k += 0.5) if (onSede(cx + nx * k, cz + nz * k)) { stop = k; break; }
      let best = stop;
      const cells = new Set();
      for (let k = half; k < stop + 5; k += 5) cells.add(ck(cx + nx * Math.min(k, stop), cz + nz * Math.min(k, stop)));
      for (const key of cells) for (const sg of fac.get(key) || []) {
        const [ax, az, bx, bz] = sg, ex = bx - ax, ez = bz - az, den = nx * ez - nz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - cx) * ez - (az - cz) * ex) / den, u = ((ax - cx) * nz - (az - cz) * nx) / den;
        if (t >= half && t < best && u >= 0 && u <= 1) best = t;
      }
      const facade = best < stop ? { x: cx + nx * best, z: cz + nz * best, pole: false } : null;
      if (best < 14) return facade;
      for (let k = half; k < best; k += 0.25) {
        const x = cx + nx * k, z = cz + nz * k;
        if (offRoad(x, z) && fuoriSagoma(x, z)) return { x, z, pole: true };
      }
      return facade;
    };
    // ogni binario una volta: i tratti in comune hanno i tiranti della sede che c'era già
    for (const track of tracks) for (const dir of [1, -1]) {
      const P = track.path(dir);
      let lastPole = -1e9;
      for (let sp = 0; sp <= P.len; sp += 6) {
        if (!track.wireAt(dir, sp) || track.sharedAt(dir, sp)) continue;
        if (sp - lastPole < 30) continue;
        const prevPole = lastPole;
        lastPole = sp;
        // tirante trasversale sopra i fili alla progressiva s. Sul doppio binario il tirante lo mette il verso nord, per
        // tutti e due i fili (non dove il binario accanto è di un'altra linea)
        const O = track.path(-dir);
        const span = (s) => {
          const p = P.at(s), q = track.doubleAt(dir, s) > 0.5 ? O.projectNear(p.x, p.z, 10) : null, o = q && O.at(q.s);
          const cx = o ? (p.x + o.x) / 2 : p.x, cz = o ? (p.z + o.z) / 2 : p.z, half = (o ? q.d / 2 : 0) + L + 0.6;
          return { s, p, q: o, cx, cz, half, h: track.heightAt(dir, s), ends: [-1, 1].map((side) => spanAnchor(cx, cz, -p.dz * side, p.dx * side, half)) };
        };
        let Sp = span(sp);
        if (Sp.q && dir < 0) continue;
        // un lato senza aggancio (un incrocio, una piazza): il tirante si sposta di qualche metro lungo il binario, dove
        // ci sono gli agganci dai due lati, come i pali veri agli angoli degli incroci
        if (!Sp.ends[0] || !Sp.ends[1]) for (const o of [3, -3, 6, -6, 9, -9]) {
          const s2 = sp + o;
          if (s2 < 0 || s2 > P.len || !track.wireAt(dir, s2) || track.sharedAt(dir, s2)) continue;
          const S2 = span(s2);
          if (S2.ends[0] && S2.ends[1] && !S2.q === !Sp.q) { Sp = S2; break; }
        }
        const { p: pt, q, cx, cz, half } = Sp;
        let ends = Sp.ends, mid = false;
        // un lato senza aggancio: il tirante diventa una mensola dal palo dell'altro lato fino a 0,6 m oltre il filo più
        // lontano. Senza aggancio ai due lati (corsie larghe ai due lati): palo in mezzo ai due binari con due mensole, se
        // l'interasse lo lascia fuori dalle due sedi e a 0,3 m dalla cassa, che in curva va verso l'interno (il SIR2 a
        // 3,50 m; nel progetto del SIR3 i pali in mezzo chiedono da 3,06 m in rettilineo a 3,78 m a 10,5 m di raggio,
        // docs/binari-tram.md), altrimenti pali sul cordolo della sede
        const reach = half - L, side = (i) => (i ? 1 : -1);
        if (!ends[0] && !ends[1]) {
          const u = P.at(Sp.s - 4), v = P.at(Sp.s + 4), k = Math.abs(Math.atan2(u.dx * v.dz - u.dz * v.dx, u.dx * v.dx + u.dz * v.dz)) / 8;
          const env = Math.max(L + 0.05, TRAM.width / 2 + 0.3 + (TRAM.cab * TRAM.cab * k) / 8 + 0.11), d = q ? Math.hypot(pt.x - q.x, pt.z - q.z) : 0;
          mid = !!q && d / 2 >= env;
          // pali sul cordolo (o nella sagoma di un'altra linea, in stazione): il tirante si sposta 6 m più avanti, finché il
          // filo non resta senza sostegno per 54 m (90 m se il palo cadrebbe sulla sede di un'altra linea)
          const o = mid ? reach : d / 2 + env;
          ends = ends.map((e, i) => ({ x: cx - pt.dz * side(i) * o, z: cz + pt.dx * side(i) * o, pole: !mid }));
          const altra = !mid && ends.some((e) => !fuoriSagoma(e.x, e.z, L + 0.4, [P, O]));
          if (!mid && sp - prevPole < (altra ? 90 : 54)) { lastPole = prevPole; continue; }
        } else ends = ends.map((e, i) => e || { x: cx - pt.dz * side(i) * reach, z: cz + pt.dx * side(i) * reach, pole: false });
        out.push(this.scrivi('lineaAerea', { t: track.id, d: dir, cx, cz, half, h: Sp.h, a: ends[0], b: ends[1], mid }));
      }
    }
    return out;
  }

  // ---- segnale dello scambio ----
  // s: dove il panel lo mette, verso di chi lo prende di punta. Sul marciapiede, su un'isola o sul verde, fuori dalla
  // sagoma di ogni binario, entro 12 m a destra di chi arriva o, se lì non c'è posto, a sinistra, fino a 9 m prima
  // (palo). Dove attorno è tutto asfalto (il piazzale della stazione) il primo posto a 2,3 m da ogni binario, a destra o
  // a sinistra. null: resta dov'è
  scambio(city, s) {
    const L = TRAM.lane;
    const lanes = this._lanes || (this._lanes = Object.values(city.tramTracks).flatMap((T) => [T.path(1), T.path(-1)]).concat(city.tramYards.flatMap((Y) => Y.edges.map((e) => e.path))));
    const free = (x, z) => !lanes.some((P) => P.projectNear(x, z, L + 0.6));
    let foot = null, bd = 4;
    for (const P of lanes) { const pr = P.projectNear(s.x, s.z, bd); if (pr) { bd = pr.d; foot = P.at(pr.s); } }
    const p = foot ? { x: foot.x, z: foot.z, dx: s.dx, dz: s.dz } : null, along = [0, -3, -6, 2, -9];
    let spot = p && (this.palo(city, p, 1, { along, max: 12 }) || this.palo(city, p, -1, { along, max: 12 }));
    if (!spot) {
      const w = L + 0.9, bx = p ? p.x + s.dx * 4 : s.x + s.dx * 4 + s.dz * w, bz = p ? p.z + s.dz * 4 : s.z + s.dz * 4 - s.dx * w; // il punto sul binario
      spot = [4, 7, 10, 2, 13].flatMap((a) => [w, -w, w + 0.8, -w - 0.8].map((l) => ({ x: bx - s.dx * a - s.dz * l, z: bz - s.dz * a + s.dx * l }))).find((q) => free(q.x, q.z)) || null;
    }
    return this.scrivi('scambi', s, spot);
  }

  // ---- cartello "abbassare / alzare il pantografo" ----
  // p: il punto del binario. A destra, fuori dall'asfalto e dalla sagoma dei binari (palo); dove non c'è posto a 3,6 m
  // dal binario
  pantografo(city, p) {
    const along = [0, -3, 3, -6, 6], L = TRAM.lane;
    const spot = this.palo(city, p, 1, { along, max: 10 }) || this.palo(city, p, -1, { along, max: 10 }) || { x: p.x - p.dz * (L + 1.9), z: p.z + p.dx * (L + 1.9) };
    return this.scrivi('pantografi', p, spot);
  }

  // ---- lanterna del tram prima di un incrocio ----
  // x: l'incrocio (TramSignals.list), p: il punto del binario 3 m prima, s la sua progressiva, h la quota. Il palo sta
  // dove starebbe davvero (#97): sul marciapiede, su un'isola o sul verde, fuori dalla sagoma di ogni binario, a destra
  // fino a 14 m e fino a 6 m prima, altrimenti a sinistra oltre l'altro binario. Senza posto per un palo la lanterna è
  // appesa al tirante della linea aerea più vicino che passa sopra il binario prima dell'incrocio (fino a 30 m prima),
  // a destra appena fuori dalla sede; dove non c'è neanche quello (piazzali tutti asfalto) il palo sta accanto alla
  // sede, fuori dalla sagoma dei binari, e in quota accanto alla sede
  lanterna(signals, x, p, s, h) {
    const city = signals.city, T = x.track, P = T.path(x.dir), along = [0, -1.5, -3, -4.5, -6];
    let spot = h < 0.5 ? this.palo(city, p, 1, { along, max: 14 }) || this.palo(city, p, -1, { along, max: 12 }) : null;
    let hang = null;
    if (!spot && h < 0.5) for (const sp of city.tramSpans || []) {
      const pr = P.projectNear(sp.cx, sp.cz, sp.half), ds = pr ? pr.s - s : 99;
      if (ds < -30 || ds > 2 || (hang && Math.abs(ds) >= Math.abs(hang.ds))) continue;
      const q = P.at(pr.s), lx = q.x - q.dz * (TRAM.lane + 0.35), lz = q.z + q.dx * (TRAM.lane + 0.35);
      if (distToSeg(lx, lz, sp.a.x, sp.a.z, sp.b.x, sp.b.z).d < 0.3) hang = { x: lx, z: lz, ds, y: Y_ROAD + T.heightAt(x.dir, pr.s) + CATENARY_HEIGHT + 0.3 };
    }
    if (!spot && !hang && h < 0.5) spot = this.palo(city, p, 1, { along, max: 4, asfalto: true }) || this.palo(city, p, -1, { along, max: 8, asfalto: true });
    if (!spot && !hang) spot = { x: p.x - p.dz * (TRAM.lane + 0.68), z: p.z + p.dx * (TRAM.lane + 0.68), o: TRAM.lane + 0.68, side: 1 };
    return this.scrivi('lanterne', p, { spot, hang });
  }

  // ---- paline delle fermate dei bus ----
  paline(city) {
    const S = this.spazio(city);
    // il bordo vero dell'asfalto, attraversando la carreggiata dall'asse
    const kerb = (cx, cz, rx, rz, hw) => {
      let seen = S.asfalto(cx, cz) < 0;
      for (let o = 0.2; o <= hw + 8; o += 0.2) {
        if (S.asfalto(cx + rx * o, cz + rz * o) < 0) seen = true;
        else if (seen || o > hw) {
          // il bordo è tra o - 0,2 e o: si stringe a 2,5 cm (il bus si accosta a 30 cm dal cordolo, non sopra)
          let a = o - 0.2, b = o;
          for (let i = 0; i < 3; i++) { const m = (a + b) / 2; if (S.asfalto(cx + rx * m, cz + rz * m) < 0) a = m; else b = m; }
          return (a + b) / 2;
        }
      }
      return null;
    };
    // fuori da ogni carreggiata: conta l'asfalto vero, non il nastro dell'arco
    const clear = (x, z) => Math.min(S.asfalto(x, z), city.clearance(x, z, ['tram'], 20) + 0.3);
    return allStopPlacements(city.net, (x, z) => city.snapToRoad(x, z), clear, kerb).map((st) => this.scrivi('paline', st));
  }
}
