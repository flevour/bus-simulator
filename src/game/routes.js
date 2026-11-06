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
    if (k === 0) s = Math.max(s, Math.min(28, length * 0.1));
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
      if (!pr || q.d < pr.d) pr = q;
    }
    if (!pr) return;
    const p = pointAt(route, pr.s), hw = p.seg.hw, rx = -p.dz, rz = p.dx;
    Object.assign(st, { s: pr.s, x: p.x + rx * (hw + 1.6), z: p.z + rz * (hw + 1.6), cx: p.x, cz: p.z, dx: p.dx, dz: p.dz, rx, rz, hw });
  });
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
export function allStopPlacements(net, snap, clear = () => 9) {
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
    for (const sh of [0, -4, 4, -8, 8, -12, 12, -16]) {
      if (best.at + sh < 0 || best.at + sh > best.l) continue;
      const cx = best.cx + dx * sh, cz = best.cz + dz * sh;
      const px = cx + rx * (hw + 1.6), pz = cz + rz * (hw + 1.6);
      if (clear(px, pz) < 0.6 || clear(px + rx * 1.6 - dx * 3, pz + rz * 1.6 - dz * 3) < 0.6) continue;
      spot = { cx, cz, px, pz };
      break;
    }
    if (!spot) return;
    out.push({
      id: st.id, name: st.name, lines: [...served.get(st.id)].sort((p, q) => parseInt(p) - parseInt(q)).slice(0, 6),
      x: spot.px, z: spot.pz, cx: spot.cx, cz: spot.cz, dx, dz, rx, rz, hw,
    });
  }
}
