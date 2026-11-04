// Mappa di Padova: strade, edifici, ferrovia e acque da OpenStreetMap; linee, fermate e
// orari dal GTFS Busitalia Veneto, con i tracciati agganciati alle strade OSM.
// Generata da scripts/build_map.py. Dati © OpenStreetMap contributors (ODbL), Busitalia Veneto.
import MAP from './padova-map.json' with { type: 'json' };

const ORIGIN = { lat: MAP.origin[0], lon: MAP.origin[1] };
const M_PER_LAT = 111130;
const M_PER_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function toXZ(lat, lon) {
  return { x: (lon - ORIGIN.lon) * M_PER_LON, z: -(lat - ORIGIN.lat) * M_PER_LAT };
}

export const MAP_SOURCE = MAP.source;
// classi OSM: 0 trunk, 1 primary, 2 secondary, 3 tertiary, 4 unclassified, 5 residential, 6 living_street, 7 service, 8 pedestrian
export const ROAD_CLASS = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian'];

export const STOPS = MAP.stops.map(([x, z, name, street], i) => ({ id: i, x, z, name, street }));

export const LINES = MAP.lines.map((l) => {
  const variants = l.variants.map((v, i) => ({
    idx: i,
    headsign: v.headsign,
    nodes: v.nodes.map(String),
    stops: v.stops.map((k) => STOPS[k]),
    offsets: v.offsets,
    duration: v.duration,
    feriale: v.fer.map(([t, d]) => ({ t, d })),
    festivo: v.fes.map(([t, d]) => ({ t, d })),
  }));
  const a = variants[0];
  const endA = a.stops[a.stops.length - 1], startA = a.stops[0];
  let b = null, best = Infinity;
  for (const v of variants.slice(1)) {
    const s0 = v.stops[0], s1 = v.stops[v.stops.length - 1];
    const d = Math.hypot(s0.x - endA.x, s0.z - endA.z) + Math.hypot(s1.x - startA.x, s1.z - startA.z);
    const score = d - (v.feriale.length + v.festivo.length) * 15;
    if (d < 1500 && score < best) { best = score; b = v; }
  }
  return { id: l.id, color: l.color, name: `${a.stops[0].street} – ${endA.street}`, headsign: a.headsign, variants, pair: [a.idx, b ? b.idx : a.idx] };
});
{
  const cnt = new Map();
  for (const L of LINES) for (const s of new Set(L.variants.flatMap((v) => v.stops))) cnt.set(s, (cnt.get(s) || 0) + 1);
  for (const [s, c] of cnt) s.importance = c >= 4 ? 3 : c >= 2 ? 2 : 1;
}

// Linee del tram (SIR1): fermate proprie e orari reali; il percorso segue la sede tranviaria (vedi src/tram/tram.js)
export const TRAM_LINES = (MAP.tramLines || []).map((l) => {
  const variants = l.variants.map((v, i) => {
    const stops = v.stops.map(([x, z, name], k) => ({ id: `${l.id}:${i}:${k}`, x, z, name, street: name, importance: 2 }));
    const last = stops[stops.length - 1].name;
    // alcune corse nel GTFS finiscono prima della destinazione indicata (la linea è spezzata a metà)
    const headsign = v.headsign.startsWith(last) ? v.headsign : `${last} (per ${v.headsign.replace(' (tratto in città)', '')})`;
    return {
      idx: i, headsign, tram: true, stops, offsets: v.offsets, duration: v.duration,
      feriale: v.fer.map(([t, d]) => ({ t, d })), festivo: v.fes.map(([t, d]) => ({ t, d })),
    };
  });
  // direzioni principali: le due corse più lunghe, una per verso
  const full = variants.slice().sort((a, b) => b.stops.length - a.stops.length || (b.feriale.length - a.feriale.length));
  const a = full[0];
  const b = full.find((v) => v !== a && Math.hypot(v.stops[0].x - a.stops[a.stops.length - 1].x, v.stops[0].z - a.stops[a.stops.length - 1].z) < 400) || a;
  return {
    id: l.id, color: l.color, tram: true, modules: l.modules || 3, variants, pair: [a.idx, b.idx],
    headsign: `${a.stops[0].name} ↔ ${a.stops[a.stops.length - 1].name}`, name: 'Tram',
  };
});

// Prato della Valle è una piazza-parco: non è un edificio OSM, lo modelliamo noi
export const LANDMARKS = { prato: [45.39814, 11.8766] };

export function buildNetwork() {
  const nodes = {};
  const N = MAP.nodes.length / 2;
  for (let i = 0; i < N; i++) nodes[i] = { id: String(i), name: null, x: MAP.nodes[i * 2], z: MAP.nodes[i * 2 + 1], edges: [] };
  const flat = (f) => { const out = []; for (let i = 0; i < f.length; i += 2) out.push({ x: f[i], z: f[i + 1] }); return out; };
  const water = MAP.water.map(([name, width, f]) => ({ name, width, pts: flat(f) })).filter((w) => w.pts.length > 1);
  const rails = MAP.rails.map(([bt, yard, f]) => ({ bridge: bt === 1, tunnel: bt === 2, yard: !!yard, pts: flat(f) })).filter((r) => r.pts.length > 1);
  const buildings = MAP.buildings.map(([h, kind, name, f, holes]) => ({ h, kind, name, pts: flat(f), holes: holes ? holes.map(flat) : null }));
  // tram SIR1: tracciato e fermate (sede tranviaria in mezzo a Via Aspetti, Via Reni, ecc.)
  // binario di coda di 40 m oltre i capolinea: il convoglio sta tutto dietro la banchina
  const tram = (MAP.tram || []).map(flat).filter((t) => t.length > 1).map((t) => {
    const ext = (p, q) => { const l = Math.hypot(p.x - q.x, p.z - q.z) || 1; return { x: p.x + ((p.x - q.x) / l) * 40, z: p.z + ((p.z - q.z) / l) * 40 }; };
    return [ext(t[0], t[1]), ...t, ext(t[t.length - 1], t[t.length - 2])];
  });
  const tramStops = (MAP.tramStops || []).map(([x, z, name]) => ({ x, z, name }));
  const landmarks = Object.fromEntries(Object.entries(LANDMARKS).map(([k, [la, lo]]) => [k, toXZ(la, lo)]));
  const edges = [];
  const E = MAP.edges;
  for (let k = 0; k < E.length; k += 8) {
    const A = nodes[E[k]], B = nodes[E[k + 1]];
    const dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const cls = E[k + 2], flags = E[k + 5];
    const e = {
      id: edges.length, a: A.id, b: B.id, cls, width: E[k + 3], name: MAP.names[E[k + 4]] || '',
      oneway: flags & 1 ? 1 : flags & 2 ? -1 : 0, bridge: !!(flags & 4), tunnel: !!(flags & 8), roundabout: !!(flags & 16),
      speed: E[k + 6], layer: E[k + 7], len, dx: dx / len, dz: dz / len, routes: 0,
      main: cls <= 3, ped: cls === 8, service: cls === 7,
    };
    A.edges.push(e);
    B.edges.push(e);
    edges.push(e);
  }
  const edgeBetween = (a, b) => nodes[a].edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  // quante linee bus percorrono ogni tratto
  for (const L of LINES) {
    const used = new Set();
    for (const v of L.variants) for (let i = 0; i < v.nodes.length - 1; i++) { const e = edgeBetween(v.nodes[i], v.nodes[i + 1]); if (e) used.add(e); }
    for (const e of used) e.routes++;
  }
  for (const e of edges) if (e.routes >= 2) e.main = true;
  markOverpasses(nodes, edges, rails);
  const expandSeq = (seq) => seq.filter((id, i) => i === 0 || id !== seq[i - 1]);
  // area coperta dagli edifici OSM (fuori si generano edifici procedurali)
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of buildings) for (const p of b.pts) bb = [Math.min(bb[0], p.x), Math.min(bb[1], p.z), Math.max(bb[2], p.x), Math.max(bb[3], p.z)];
  return { nodes, edges, edgeBetween, expandSeq, water, rails, railway: rails.length ? rails[0].pts : [], buildings, buildingBBox: bb, landmarks, stops: STOPS, tram, tramStops };
}

// ponti stradali sopra la ferrovia: impalcato in quota con rampe di accesso
function markOverpasses(nodes, edges, rails) {
  const crosses = (A, B) => {
    for (const r of rails) {
      if (r.tunnel || r.bridge) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const c = r.pts[i], d = r.pts[i + 1];
        const rx = B.x - A.x, rz = B.z - A.z, sx = d.x - c.x, sz = d.z - c.z;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - A.x) * sz - (c.z - A.z) * sx) / den, u = ((c.x - A.x) * rz - (c.z - A.z) * rx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
      }
    }
    return false;
  };
  const H = 7, R = 130;
  const deck = new Set();
  for (const e of edges) if (e.bridge && e.layer >= 1 && crosses(nodes[e.a], nodes[e.b])) deck.add(e);
  // tutto il ponte (catena di tratti con bridge) sta in quota
  const stack = [...deck];
  while (stack.length) {
    const e = stack.pop();
    for (const nid of [e.a, e.b]) for (const f of nodes[nid].edges) if (f.bridge && f.layer >= 1 && !deck.has(f)) { deck.add(f); stack.push(f); }
  }
  const dist = new Map();
  const queue = [];
  for (const e of deck) for (const nid of [e.a, e.b]) if (!dist.has(nid)) { dist.set(nid, 0); queue.push(nid); }
  while (queue.length) {
    const id = queue.shift();
    const d0 = dist.get(id);
    for (const f of nodes[id].edges) {
      if (deck.has(f)) continue;
      const o = f.a === id ? f.b : f.a;
      const d = d0 + f.len;
      if (d < R && (!dist.has(o) || dist.get(o) > d)) { dist.set(o, d); queue.push(o); }
    }
  }
  for (const [id, d] of dist) {
    const u = Math.max(0, Math.min(1, 1 - d / R));
    nodes[id].h = H * u * u * (3 - 2 * u);
  }
  for (const e of edges) {
    const ha = nodes[e.a].h || 0, hb = nodes[e.b].h || 0;
    if (ha > 0.05 || hb > 0.05) { e.elev = true; e.ha = ha; e.hb = hb; }
  }
}

export function parseHM(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 3600 + m * 60;
}
export function fmtHM(sec, withSec = false) {
  sec = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const p = (n) => String(n).padStart(2, '0');
  return withSec ? `${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}`;
}
