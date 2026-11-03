import { LINES } from '../data/padova.js';

// Costruisce un percorso (polilinea + fermate) da una sequenza di nodi
export function buildRoute(net, seq) {
  const pts = seq.map((id) => ({ x: net.nodes[id].x, z: net.nodes[id].z }));
  const cum = [0];
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const e = net.edgeBetween(seq[i], seq[i + 1]);
    const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z;
    const len = Math.hypot(dx, dz);
    segs.push({ i, edge: e, len, dx: dx / len, dz: dz / len, hw: e.width / 2 });
    cum.push(cum[i] + len);
  }
  const length = cum[cum.length - 1];
  const route = { seq, pts, cum, segs, length };

  const stops = [];
  let lastS = -1e9;
  for (let i = 0; i < seq.length; i++) {
    const node = net.nodes[seq[i]];
    let s;
    if (i === 0) s = Math.min(28, segs[0].len * 0.3);
    else if (i === seq.length - 1) s = length - 20;
    else s = cum[i] - (node.edges.length >= 3 ? 34 : 16);
    if (s < lastS + 60) continue;
    lastS = s;
    const p = pointAt(route, s);
    const hw = p.seg.hw;
    const rx = -p.dz, rz = p.dx; // normale destra
    stops.push({
      idx: stops.length,
      s,
      nodeId: seq[i],
      name: node.name,
      importance: node.importance,
      terminal: i === 0 || i === seq.length - 1,
      x: p.x + rx * (hw + 1.6),
      z: p.z + rz * (hw + 1.6),
      cx: p.x, cz: p.z,
      dx: p.dx, dz: p.dz,
      rx, rz, hw,
    });
  }
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

// Tutte le fermate di tutte le linee (entrambe le direzioni) per la scenografia
export function allStopPlacements(net) {
  const out = [];
  for (const L of LINES)
    for (const v of ['feriale', 'festivo'])
      for (const dir of [1, -1]) {
        const seq = dir === 1 ? L[v].nodes : [...L[v].nodes].reverse();
        const r = buildRoute(net, seq);
        for (const st of r.stops) {
          const dup = out.find((o) => Math.hypot(o.x - st.x, o.z - st.z) < 18);
          if (dup) { if (!dup.lines.includes(L.id)) dup.lines.push(L.id); continue; }
          out.push({ ...st, lines: [L.id] });
        }
      }
  return out;
}
