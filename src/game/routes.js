import { LINES } from '../data/padova.js';

// Costruisce un percorso da una variante GTFS: polilinea sui vertici della rete + fermate reali
export function buildRoute(net, variant) {
  const seq = net.expandSeq(variant.nodes);
  const pts = seq.map((id) => ({ x: net.nodes[id].x, z: net.nodes[id].z }));
  const cum = [0];
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const e = net.edgeBetween(seq[i], seq[i + 1]);
    const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z;
    const len = Math.hypot(dx, dz) || 0.01;
    segs.push({ i, edge: e || { width: 9, name: '' }, len, dx: dx / len, dz: dz / len, hw: (e ? e.width : 9) / 2 });
    cum.push(cum[i] + len);
  }
  const length = cum[cum.length - 1];
  const route = { seq, pts, cum, segs, length };

  // fermate: proiezione delle coordinate reali sul percorso, in ordine
  const stops = [];
  let sPrev = 0;
  variant.stops.forEach((g, k) => {
    const last = k === variant.stops.length - 1;
    const pr = projectOnRoute(route, g.x, g.z, sPrev, 20, last ? 1e9 : 2500);
    let s = Math.max(pr.s, sPrev + (k ? 25 : 0));
    // prima fermata: il bus (12-18 m) deve stare dietro la palina. Ai capolinea veri può sporgere nel piazzale, quindi
    // bastano pochi metri; dove la linea è tagliata al bordo della mappa servono 28 m di strada
    if (k === 0) s = Math.max(s, Math.min(variant.cutStart ? 28 : 6, length * 0.1));
    if (last) s = Math.min(Math.max(s, sPrev + 25), length - 15);
    s = Math.min(s, length - 15);
    sPrev = s;
    const p = pointAt(route, s);
    const hw = p.seg.hw;
    const rx = -p.dz, rz = p.dx; // normale destra
    stops.push({
      idx: k, s, gtfs: g, name: g.name, importance: g.importance || 1,
      terminal: k === 0 || last,
      x: p.x + rx * (hw + 1.6), z: p.z + rz * (hw + 1.6),
      cx: p.x, cz: p.z, dx: p.dx, dz: p.dz, rx, rz, hw,
    });
  });
  route.stops = stops;
  return route;
}

// La palina disegnata può essere spostata di qualche metro (vicino agli incroci): la zona di fermata la segue
// (una fermata può avere più paline, una per verso: vale quella sul percorso di questa corsa)
export function alignStops(route, placements) {
  const stops = route.stops;
  stops.forEach((st, k) => {
    const prev = stops[k - 1], next = stops[k + 1];
    let pr = null;
    for (const pl of placements) {
      if (pl.id !== st.gtfs.id) continue;
      const q = projectOnRoute(route, pl.cx, pl.cz, st.s, 30, 30);
      if (q.d > 6 || Math.abs(q.s - st.s) > 20 || (prev && q.s < prev.s + 15) || (next && q.s > next.s - 15) || q.s > route.length - 15) continue;
      const dir = pointAt(route, q.s);
      if (dir.dx * pl.dx + dir.dz * pl.dz < 0.5) continue; // palina del verso opposto
      if (!pr || q.d < pr.d) pr = { ...q, pl };
    }
    if (!pr) return;
    const p = pointAt(route, pr.s), hw = p.seg.hw, rx = -p.dz, rz = p.dx;
    // kerb: distanza dall'asse del cordolo vero alla palina (carreggiata misurata, golfi di fermata); chi aspetta sta
    // un metro oltre, sul marciapiede
    const kerb = pr.pl.kerb != null ? pr.pl.kerb : hw;
    Object.assign(st, { s: pr.s, x: p.x + rx * (kerb + 1.0), z: p.z + rz * (kerb + 1.0), cx: p.x, cz: p.z, dx: p.dx, dz: p.dz, rx, rz, hw, kerb, kl: pr.pl.kl ?? kerb, ks: pr.pl.ks || 0 });
  });
}

// Bus fermo alla fermata con il centro "back" metri prima della palina: accostato al cordolo vero e parallelo a lui
// (kl, ks: la linea del cordolo lungo la fermata, vedi allStopPlacements; dove non è parallelo all'asse, come a
// Largo Debussy, il bus lo segue)
export function stopPose(route, st, back = 6.5) {
  const p = pointAt(route, st.s - back), rx = -p.dz, rz = p.dx, ks = st.ks || 0;
  const lat = (st.kl ?? st.kerb ?? st.hw) - ks * back - 1.6;
  return { x: p.x + rx * lat, z: p.z + rz * lat, h: Math.atan2(p.dx + rx * ks, p.dz + rz * ks) };
}

// il bus può percorrere l'arco e partendo dal nodo from? (anche le corsie riservate, non le vie pedonali)
export const busCan = (e, from) => !e.ped && (!e.oneway || (e.oneway === 1) === (e.a === from));

// Percorso più breve per un bus tra due nodi della rete (Dijkstra), per le corse fuori servizio. Le vie piccole e le
// strade di servizio costano di più: si va sulle strade principali come farebbe un autista. notFrom: nodo da non
// prendere come primo (niente inversione a U in partenza); notInto: nodo da cui non arrivare alla meta (verso sbagliato).
export function findPath(net, from, to, { notFrom = null, notInto = null } = {}) {
  const dist = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]];
  const push = (it) => {
    heap.push(it);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === to) break;
    if (d > dist.get(u)) continue;
    for (const e of net.nodes[u].edges) {
      if (!busCan(e, u)) continue;
      const w = e.a === u ? e.b : e.a;
      if ((u === from && w === notFrom) || (w === to && u === notInto)) continue;
      const nd = d + e.len * (e.main ? 1 : e.service ? 3 : e.cls >= 5 ? 1.6 : 1.25);
      if (nd < (dist.get(w) ?? Infinity)) { dist.set(w, nd); prev.set(w, u); push([nd, w]); }
    }
  }
  if (from !== to && !prev.has(to)) return null;
  const seq = [to];
  while (seq[seq.length - 1] !== from) seq.push(prev.get(seq[seq.length - 1]));
  return seq.reverse();
}

// Meta di una corsa fuori servizio che porta alla prima fermata di una variante: il nodo prima della fermata (da
// raggiungere arrivando dal percorso, non dal nodo dopo), i nodi da percorrere dopo e dove sta la fermata (at: metri
// dal nodo). Così chi arriva è sulla corsia giusta e nel verso giusto per partire.
export function startGoal(net, city, v) {
  const route = buildRoute(net, v);
  if (city && city.stopPlacements) alignStops(route, city.stopPlacements);
  const st = route.stops[0], seq = route.seq;
  let i = 0;
  while (i < route.cum.length - 2 && route.cum[i + 1] <= st.s) i++;
  let j = i + 1;
  while (j < seq.length - 1 && route.cum[j] < st.s + 30) j++;
  return { node: seq[i], notInto: seq[i + 1], tail: seq.slice(i + 1, j + 1), at: st.s - route.cum[i], stop: { id: st.gtfs.id, name: st.name, x: st.cx, z: st.cz, importance: 1 }, route, s: st.s };
}

// Variante fuori servizio dal punto in cui si trova il bus (sulla strada più vicina, nel verso di marcia h) fino alla
// meta; null se non c'è una strada qui o un percorso possibile
export function planTransfer(net, city, x, z, h, goal) {
  const r = city.snapToRoad(x, z, 60);
  if (!r || r.edge.ped) return null;
  const e = r.edge, fwd = Math.sin(h) * e.dx + Math.cos(h) * e.dz >= 0;
  const A = fwd ? e.a : e.b, B = fwd ? e.b : e.a;
  // senza inversione a U se si può; davanti a una strada chiusa (capolinea al bordo della mappa) si torna indietro
  const path = findPath(net, B, goal.node, { notFrom: A, notInto: goal.notInto }) || findPath(net, B, goal.node, { notInto: goal.notInto });
  if (!path) return null;
  const nodes = net.expandSeq([A, ...path, ...goal.tail]);
  if (nodes.length < 2) return null;
  return { nodes, goalIdx: nodes.length - 1 - goal.tail.length, stops: [{ id: 'partenza', name: 'Partenza', x, z, importance: 1 }, goal.stop], offsets: [0, 1], duration: 1 };
}

// Percorso del tram: la corsia (TrackPath) è già nel verso di marcia; le fermate sono proiettate in ordine.
// Il muso si ferma a fine banchina: la "palina" della missione è 12 m oltre il centro della banchina.
export const TRAM_STOP_AHEAD = 12;
export function buildTramRoute(path, variant) {
  const pts = path.pts, cum = path.cum, segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = cum[i + 1] - cum[i] || 0.01;
    segs.push({ i, edge: { width: 3.2, name: '' }, len, dx: (pts[i + 1].x - pts[i].x) / len, dz: (pts[i + 1].z - pts[i].z) / len, hw: 1.6 });
  }
  const route = { seq: [], pts, cum, segs, length: path.len, tram: true };
  const stops = [];
  let sPrev = 0;
  variant.stops.forEach((g, k) => {
    const last = k === variant.stops.length - 1;
    const pr = projectOnRoute(route, g.x, g.z, sPrev, 40, 6000);
    const s = Math.min(route.length - 15, Math.max(pr.s + TRAM_STOP_AHEAD, sPrev + (k ? 30 : 0)));
    sPrev = s;
    const p = pointAt(route, s), hw = 1.6, rx = -p.dz, rz = p.dx;
    stops.push({
      idx: k, s, gtfs: g, name: g.name, importance: g.importance || 2, terminal: k === 0 || last, tram: true,
      x: p.x + rx * (hw + 1.6), z: p.z + rz * (hw + 1.6), cx: p.x, cz: p.z, dx: p.dx, dz: p.dz, rx, rz, hw,
    });
  });
  route.stops = stops;
  return route;
}

export function pointAt(route, s) {
  s = Math.max(0, Math.min(route.length, s));
  let i = 0;
  while (i < route.segs.length - 1 && route.cum[i + 1] < s) i++;
  const seg = route.segs[i];
  const t = s - route.cum[i];
  return { x: route.pts[i].x + seg.dx * t, z: route.pts[i].z + seg.dz * t, dx: seg.dx, dz: seg.dz, seg, segIndex: i };
}

// Proiezione di un punto sul percorso cercando vicino a sHint. Con h (direzione del mezzo) si segue chi guida: dove il
// percorso ripassa vicino a sé stesso (incroci, rotonde, andata e ritorno nella stessa via) vince il tratto nel verso
// di marcia e vicino a sHint, invece di saltare avanti di centinaia di metri e dare per saltate le fermate in mezzo.
export function projectOnRoute(route, x, z, sHint, back = 80, fwd = 400, h) {
  let best = { d: Infinity, s: sHint, lat: 0, segIndex: 0 }, bestCost = Infinity;
  const hx = h === undefined ? 0 : Math.sin(h), hz = h === undefined ? 0 : Math.cos(h);
  for (let i = 0; i < route.segs.length; i++) {
    const s0 = route.cum[i], s1 = route.cum[i + 1];
    if (s1 < sHint - back || s0 > sHint + fwd) continue;
    const seg = route.segs[i];
    const px = x - route.pts[i].x, pz = z - route.pts[i].z;
    let t = px * seg.dx + pz * seg.dz;
    t = Math.max(0, Math.min(seg.len, t));
    const cx = route.pts[i].x + seg.dx * t, cz = route.pts[i].z + seg.dz * t;
    const d = Math.hypot(x - cx, z - cz);
    // costo in metri: di traverso +6, contromano +12; oltre 20 m da sHint, 8 cm per metro
    const cost = h === undefined ? d : d + (1 - (seg.dx * hx + seg.dz * hz)) * 6 + Math.max(0, Math.abs(s0 + t - sHint) - 20) * 0.08;
    if (cost < bestCost) {
      const lat = (x - cx) * -seg.dz + (z - cz) * seg.dx; // positivo = destra
      best = { d, s: s0 + t, lat, segIndex: i };
      bestCost = cost;
    }
  }
  return best;
}

// Tutte le fermate reali (GTFS) agganciate alla strada più vicina, per la scenografia.
// Una palina per ogni verso in cui la fermata è servita: ai capolinea la stessa fermata GTFS vale per l'arrivo e per
// la partenza, spesso su lati o tratti diversi. Prima le partenze (lì si sale), poi le fermate intermedie, poi gli arrivi.
// kerb(x, z, rx, rz, hw): distanza dall'asse del bordo vero dell'asfalto verso (rx, rz), o null (senza pianta delle strade)
export function allStopPlacements(net, snap, clear = () => 9, kerb = null) {
  const served = new Map(), vars = new Map();
  for (const L of LINES) for (const v of L.variants) v.stops.forEach((st, k) => {
    const set = served.get(st.id) || served.set(st.id, new Set()).get(st.id);
    set.add(L.id);
    const rank = k === 0 ? 0 : k === v.stops.length - 1 ? 2 : 1;
    (vars.get(st.id) || vars.set(st.id, []).get(st.id)).push({ v, rank });
  });
  const out = [];
  for (const st of net.stops) {
    if (!served.has(st.id)) continue;
    for (const { v } of vars.get(st.id).sort((p, q) => p.rank - q.rank)) placeFor(st, v);
  }
  return out;

  // Linea del bus lungo la fermata: il cordolo vero misurato ogni 3 m per la lunghezza del bus (palina a o = 0, il bus
  // dietro), retta che lo segue (pendenza ks, scartati i punti fuori riga: passi carrai, incroci, golfi) spostata sul
  // punto più vicino all'asse, così il bus non sale sul marciapiede in nessun punto. kl: dove passa la retta alla palina.
  function busLine(cx, cz, k, dx, dz, hw) {
    const rx = -dz, rz = dx;
    let pts = [[0, k]];
    for (const o of [-3, -6, -9, -12]) {
      const q = kerb(cx + dx * o, cz + dz * o, rx, rz, hw);
      if (q != null && q > hw - 2.5 && q < hw + 8) pts.push([o, q]);
    }
    const fit = (P) => {
      const n = P.length, mo = P.reduce((a, p) => a + p[0], 0) / n, mk = P.reduce((a, p) => a + p[1], 0) / n;
      let sxx = 0, sxy = 0;
      for (const [o, q] of P) { sxx += (o - mo) ** 2; sxy += (o - mo) * (q - mk); }
      const m = sxx > 1 ? sxy / sxx : 0;
      return { m, c: mk - m * mo };
    };
    let ks = 0;
    if (pts.length >= 3) {
      let f = fit(pts);
      const keep = pts.filter(([o, q]) => Math.abs(q - (f.c + f.m * o)) < 0.4);
      if (keep.length >= 3 && keep.length < pts.length) { pts = keep; f = fit(pts); }
      ks = Math.max(-0.2, Math.min(0.2, f.m));
    }
    return { ks, kl: Math.min(...pts.map(([o, q]) => q - ks * o)) };
  }

  function placeFor(st, v) {
    let best = null, bd = 60;
    for (let i = 0; i < v.nodes.length - 1; i++) {
      const A = net.nodes[v.nodes[i]], B = net.nodes[v.nodes[i + 1]];
      const ex = B.x - A.x, ez = B.z - A.z, l2 = ex * ex + ez * ez;
      if (l2 < 0.01) continue;
      const t = Math.max(0, Math.min(1, ((st.x - A.x) * ex + (st.z - A.z) * ez) / l2));
      const cx = A.x + ex * t, cz = A.z + ez * t, d = Math.hypot(st.x - cx, st.z - cz);
      if (d < bd) { bd = d; best = { cx, cz, l: Math.sqrt(l2), ex, ez, at: t * Math.sqrt(l2), e: net.edgeBetween(v.nodes[i], v.nodes[i + 1]) }; }
    }
    if (!best || !best.e || best.e.elev) return;
    const dx = best.ex / best.l, dz = best.ez / best.l, hw = best.e.width / 2;
    const rx = -dz, rz = dx; // la palina sta a destra della direzione di marcia
    if (out.some((o) => Math.hypot(o.cx - best.cx, o.cz - best.cz) < 12 && o.dx * dx + o.dz * dz > 0.5)) return;
    // palina e pensilina non devono cadere su un'altra carreggiata (doppie carreggiate, incroci):
    // se il punto esatto è occupato si sposta la fermata di qualche metro lungo la strada
    let spot = null;
    // prima al cordolo vero, poi (se lì non c'è posto) alla distanza fissa dall'asse come prima
    for (const useKerb of kerb ? [true, false] : [false]) for (const sh of [0, -4, 4, -8, 8, -12, 12, -16]) {
      if (spot) break;
      if (best.at + sh < 0 || best.at + sh > best.l) continue;
      const cx = best.cx + dx * sh, cz = best.cz + dz * sh;
      // palina 0,7 m oltre il cordolo vero, 0,5 m sulle banchine strette (la carreggiata misurata può essere più larga
      // o più stretta dell'arco)
      const k = useKerb ? kerb(cx, cz, rx, rz, hw) : null;
      // (anche in fondo a un golfo di fermata, dove l'asfalto misurato si allarga)
      const atKerb = k != null && k > hw - 2.5 && k < hw + 8;
      for (const off of atKerb ? [k + 0.7, k + 0.5] : [hw + 1.6]) {
        const px = cx + rx * off, pz = cz + rz * off;
        if (clear(px, pz) < (atKerb ? 0.2 : 0.6) || clear(px + rx * 1.6 - dx * 3, pz + rz * 1.6 - dz * 3) < (atKerb ? 0.2 : 0.6)) continue;
        spot = { cx, cz, px, pz, kerb: atKerb ? k : hw, ...(atKerb ? busLine(cx, cz, k, dx, dz, hw) : {}) };
        break;
      }
    }
    if (!spot) return;
    out.push({
      id: st.id, name: st.name, lines: [...served.get(st.id)].sort((p, q) => parseInt(p) - parseInt(q)).slice(0, 6),
      x: spot.px, z: spot.pz, cx: spot.cx, cz: spot.cz, dx, dz, rx, rz, hw, kerb: spot.kerb, kl: spot.kl, ks: spot.ks, shelter: st.shelter, bench: st.bench,
    });
  }
}
