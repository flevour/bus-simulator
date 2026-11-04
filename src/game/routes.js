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

export function pointAt(route, s) {
  s = Math.max(0, Math.min(route.length, s));
  let i = 0;
  while (i < route.segs.length - 1 && route.cum[i + 1] < s) i++;
  const seg = route.segs[i];
  const t = s - route.cum[i];
  return { x: route.pts[i].x + seg.dx * t, z: route.pts[i].z + seg.dz * t, dx: seg.dx, dz: seg.dz, seg, segIndex: i };
}

// Proiezione di un punto sul percorso cercando vicino a sHint
export function projectOnRoute(route, x, z, sHint, back = 80, fwd = 400) {
  let best = { d: Infinity, s: sHint, lat: 0, segIndex: 0 };
  for (let i = 0; i < route.segs.length; i++) {
    const s0 = route.cum[i], s1 = route.cum[i + 1];
    if (s1 < sHint - back || s0 > sHint + fwd) continue;
    const seg = route.segs[i];
    const px = x - route.pts[i].x, pz = z - route.pts[i].z;
    let t = px * seg.dx + pz * seg.dz;
    t = Math.max(0, Math.min(seg.len, t));
    const cx = route.pts[i].x + seg.dx * t, cz = route.pts[i].z + seg.dz * t;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best.d) {
      const lat = (x - cx) * -seg.dz + (z - cz) * seg.dx; // positivo = destra
      best = { d, s: s0 + t, lat, segIndex: i };
    }
  }
  return best;
}

// Tutte le fermate reali (GTFS) agganciate alla strada più vicina, per la scenografia
export function allStopPlacements(net, snap, clear = () => 9) {
  // per ogni fermata: la prima variante che la serve dà la direzione di marcia
  const served = new Map(), dirVar = new Map();
  for (const L of LINES) for (const v of L.variants) for (const st of v.stops) {
    const set = served.get(st.id) || served.set(st.id, new Set()).get(st.id);
    set.add(L.id);
    if (!dirVar.has(st.id)) dirVar.set(st.id, v);
  }
  const out = [];
  for (const st of net.stops) {
    if (!served.has(st.id)) continue;
    const v = dirVar.get(st.id);
    let best = null, bd = 60;
    for (let i = 0; i < v.nodes.length - 1; i++) {
      const A = net.nodes[v.nodes[i]], B = net.nodes[v.nodes[i + 1]];
      const ex = B.x - A.x, ez = B.z - A.z, l2 = ex * ex + ez * ez;
      if (l2 < 0.01) continue;
      const t = Math.max(0, Math.min(1, ((st.x - A.x) * ex + (st.z - A.z) * ez) / l2));
      const cx = A.x + ex * t, cz = A.z + ez * t, d = Math.hypot(st.x - cx, st.z - cz);
      if (d < bd) { bd = d; best = { cx, cz, l: Math.sqrt(l2), ex, ez, e: net.edgeBetween(v.nodes[i], v.nodes[i + 1]) }; }
    }
    if (!best || !best.e || best.e.elev) continue;
    const dx = best.ex / best.l, dz = best.ez / best.l, hw = best.e.width / 2;
    const rx = -dz, rz = dx; // la palina sta a destra della direzione di marcia
    if (out.some((o) => Math.hypot(o.cx - best.cx, o.cz - best.cz) < 12 && o.dx * dx + o.dz * dz > 0.5)) continue;
    const px = best.cx + rx * (hw + 1.6), pz = best.cz + rz * (hw + 1.6);
    // palina e pensilina non devono cadere su un'altra carreggiata (doppie carreggiate)
    if (clear(px, pz) < 0.6 || clear(px + rx * 1.6 - dx * 3, pz + rz * 1.6 - dz * 3) < 0.6) continue;
    out.push({
      name: st.name, lines: [...served.get(st.id)].sort((p, q) => parseInt(p) - parseInt(q)).slice(0, 6),
      x: px, z: pz, cx: best.cx, cz: best.cz, dx, dz, rx, rz, hw,
    });
  }
  return out;
}
