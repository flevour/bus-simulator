// Rete stradale e linee urbane di Padova ricavate dal GTFS ufficiale Busitalia Veneto
// (feed BusOne): i tracciati di tutte le linee condividono un unico grafo stradale,
// da cui si ottengono le vie percorse dai mezzi pubblici, le fermate reali e gli orari.
// Vedi scripts/build_gtfs.py per la conversione.
import GTFS from './gtfs-padova.json' with { type: 'json' };

const ORIGIN = { lat: GTFS.origin[0], lon: GTFS.origin[1] };
const M_PER_LAT = 111130;
const M_PER_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function toXZ(lat, lon) {
  return { x: (lon - ORIGIN.lon) * M_PER_LON, z: -(lat - ORIGIN.lat) * M_PER_LAT };
}

export const GTFS_SOURCE = GTFS.source;

// fermate: [x, z, nome, via]
export const STOPS = GTFS.stops.map(([x, z, name, street], i) => ({ id: i, x, z, name, street }));

// linee urbane con le varianti di percorso (ordinate per numero di corse)
export const LINES = GTFS.lines.map((l) => {
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
  // coppia andata/ritorno: la variante più frequente e quella che parte dove l'altra arriva
  const a = variants[0];
  const endA = a.stops[a.stops.length - 1], startA = a.stops[0];
  let b = null, best = Infinity;
  for (const v of variants.slice(1)) {
    const s0 = v.stops[0], s1 = v.stops[v.stops.length - 1];
    const d = Math.hypot(s0.x - endA.x, s0.z - endA.z) + Math.hypot(s1.x - startA.x, s1.z - startA.z);
    const score = d - (v.feriale.length + v.festivo.length) * 15;
    if (d < 1500 && score < best) { best = score; b = v; }
  }
  const name = `${a.stops[0].street} – ${endA.street}`;
  return { id: l.id, color: l.color, name, headsign: a.headsign, variants, pair: [a.idx, b ? b.idx : a.idx] };
});
// importanza delle fermate: quante linee vi passano
{
  const cnt = new Map();
  for (const L of LINES) for (const s of new Set(L.variants.flatMap((v) => v.stops))) cnt.set(s, (cnt.get(s) || 0) + 1);
  for (const [s, c] of cnt) s.importance = c >= 4 ? 3 : c >= 2 ? 2 : 1;
}

// Fiumi e canali: polilinee [lat, lon] + larghezza
export const WATER = [
  { name: 'Brenta', width: 70, pts: [[45.4500, 11.9260], [45.4300, 11.9290], [45.4150, 11.9300], [45.4000, 11.9345], [45.3800, 11.9330], [45.3650, 11.9300]] },
  { name: 'Bacchiglione', width: 38, pts: [[45.3960, 11.8200], [45.3925, 11.8450], [45.3900, 11.8600], [45.3880, 11.8730], [45.3870, 11.8850], [45.3890, 11.9000], [45.3920, 11.9200], [45.3940, 11.9345]] },
  { name: 'Piovego', width: 26, pts: [[45.4118, 11.8812], [45.4100, 11.8900], [45.4085, 11.9000], [45.4100, 11.9120], [45.4120, 11.9300]] },
  { name: 'Tronco Maestro', width: 22, pts: [[45.4180, 11.8650], [45.4130, 11.8700], [45.4070, 11.8718], [45.4025, 11.8722], [45.3990, 11.8700], [45.3940, 11.8650], [45.3925, 11.8450]] },
];

export const RAILWAY = [[45.4215, 11.8300], [45.4200, 11.8550], [45.4192, 11.8700], [45.4192, 11.8805], [45.4186, 11.8900], [45.4180, 11.8960], [45.4205, 11.9150], [45.4250, 11.9350], [45.4290, 11.9600]];

// Landmark (posizioni approssimate)
export const LANDMARKS = {
  prato: [45.39814, 11.8766],
  santo: [45.4013, 11.8812],
  ragione: [45.4074, 11.8758],
  stazione: [45.4179, 11.8800],
  specola: [45.4022, 11.8700],
  duomo: [45.4072, 11.8728],
  scrovegni: [45.4115, 11.8805],
  ospedale: [45.4048, 11.8905],
  fiera: [45.4170, 11.8900],
  orologio: [45.4078, 11.8742],
};

// raggio di rispetto dei monumenti (per edifici e alberi)
export function buildNetwork() {
  const nodes = {};
  const N = GTFS.nodes.length / 2;
  for (let i = 0; i < N; i++) nodes[i] = { id: String(i), name: null, x: GTFS.nodes[i * 2], z: GTFS.nodes[i * 2 + 1], edges: [] };
  const conv = (arr) => arr.map(([la, lo]) => toXZ(la, lo));
  const water = WATER.map((w) => ({ ...w, pts: conv(w.pts) }));
  const railway = conv(RAILWAY);
  const landmarks = Object.fromEntries(Object.entries(LANDMARKS).map(([k, [la, lo]]) => [k, toXZ(la, lo)]));
  const edges = [];
  const E = GTFS.edges;
  for (let k = 0; k < E.length; k += 4) {
    const A = nodes[E[k]], B = nodes[E[k + 1]];
    const dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const routes = E[k + 2], tram = !!E[k + 3];
    const width = routes >= 6 ? 12 : routes >= 3 ? 10.5 : routes >= 2 ? 9.5 : 8.5;
    const e = { id: edges.length, a: A.id, b: B.id, routes, tram, width, main: routes >= 2 || tram, len, dx: dx / len, dz: dz / len, name: '' };
    A.edges.push(e);
    B.edges.push(e);
    edges.push(e);
  }
  // nome della via: quello della fermata più vicina, propagato lungo i tratti senza fermate
  nameEdges(nodes, edges);
  // sovrappassi dove la strada attraversa la ferrovia
  markOverpasses(nodes, edges, railway);
  const edgeBetween = (a, b) => nodes[a].edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  const expandSeq = (seq) => seq.filter((id, i) => i === 0 || id !== seq[i - 1]);
  return { nodes, edges, edgeBetween, expandSeq, water, railway, landmarks, stops: STOPS };
}

function nameEdges(nodes, edges) {
  const cell = 150, grid = new Map();
  for (const s of STOPS) {
    const k = Math.floor(s.x / cell) + ',' + Math.floor(s.z / cell);
    (grid.get(k) || grid.set(k, []).get(k)).push(s);
  }
  for (const e of edges) {
    const A = nodes[e.a], B = nodes[e.b];
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    let best = null, bd = 90;
    const gx = Math.floor(mx / cell), gz = Math.floor(mz / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of grid.get(gx + i + ',' + (gz + j)) || []) {
      const d = Math.hypot(s.x - mx, s.z - mz);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) e.name = best.street;
  }
  // propaga i nomi lungo le catene di tratti (nodi con due soli archi)
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (const e of edges) {
      if (e.name) continue;
      for (const nid of [e.a, e.b]) {
        const n = nodes[nid];
        if (n.edges.length !== 2) continue;
        const o = n.edges[0] === e ? n.edges[1] : n.edges[0];
        if (o.name) { e.name = o.name; changed = true; break; }
      }
    }
    if (!changed) break;
  }
}

function markOverpasses(nodes, edges, railway) {
  const hit = (A, B) => {
    for (let i = 0; i < railway.length - 1; i++) {
      const c = railway[i], d = railway[i + 1];
      const rx = B.x - A.x, rz = B.z - A.z, sx = d.x - c.x, sz = d.z - c.z;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.x - A.x) * sz - (c.z - A.z) * sx) / den, u = ((c.x - A.x) * rz - (c.z - A.z) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { x: A.x + rx * t, z: A.z + rz * t };
    }
    return null;
  };
  // ogni nodo entro 220 m (lungo la strada) da un attraversamento prende una quota
  const H = 7, R = 170;
  for (const e of edges) {
    const p = hit(nodes[e.a], nodes[e.b]);
    if (!p) continue;
    const dist = new Map();
    const queue = [];
    for (const nid of [e.a, e.b]) { const n = nodes[nid]; const d = Math.hypot(n.x - p.x, n.z - p.z); dist.set(nid, d); queue.push(nid); }
    while (queue.length) {
      const id = queue.shift();
      const d0 = dist.get(id);
      for (const f of nodes[id].edges) {
        const o = f.a === id ? f.b : f.a;
        const d = d0 + f.len;
        if (d < R && (!dist.has(o) || dist.get(o) > d)) { dist.set(o, d); queue.push(o); }
      }
    }
    for (const [id, d] of dist) {
      const u = Math.max(0, Math.min(1, 1 - d / R));
      const h = H * u * u * (3 - 2 * u);
      nodes[id].h = Math.max(nodes[id].h || 0, h);
    }
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
