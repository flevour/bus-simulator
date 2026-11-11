// Mappa di Padova: strade, edifici, ferrovia e acque da OpenStreetMap; linee, fermate e
// orari dal GTFS Busitalia Veneto, con i tracciati agganciati alle strade OSM.
// Generata da scripts/build_map.py. Dati © OpenStreetMap contributors (ODbL), Busitalia Veneto.
import MAP from './padova-map.json' with { type: 'json' };
import NEW_TRAM from '../../data/tram-linee-nuove.json' with { type: 'json' };
import DEPOSITI from '../../data/tram-depositi.json' with { type: 'json' };

const ORIGIN = { lat: MAP.origin[0], lon: MAP.origin[1] };
const M_PER_LAT = 111130;
const M_PER_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function toXZ(lat, lon) {
  return { x: (lon - ORIGIN.lon) * M_PER_LON, z: -(lat - ORIGIN.lat) * M_PER_LAT };
}

export const MAP_SOURCE = MAP.source;
// classi OSM: 0 trunk, 1 primary, 2 secondary, 3 tertiary, 4 unclassified, 5 residential, 6 living_street, 7 service, 8 pedestrian
export const ROAD_CLASS = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian'];

// shelter, bench: pensilina e panchina secondo OSM (1 sì, 0 no, null/undefined non detto)
export const STOPS = MAP.stops.map(([x, z, name, street, shelter, bench], i) => ({ id: i, x, z, name, street, shelter, bench }));

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
const SIR1_LINES = (MAP.tramLines || []).map((l) => {
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

// Linee del tram in costruzione (SIR3, SIR2): percorso sui binari OSM e orario generato (data/tram-linee-nuove.json, da
// scripts/tram_linee.py). Nel gioco c'è il tratto in città: la serie più lunga di fermate di fila con una strada della
// mappa entro 120 m; i binari arrivano 150 m oltre le fermate estreme (il convoglio fermo, il cambio cabina).
// building: linea in costruzione; lanes: i binari dei due versi (verso +1 il primo del file), tagliati sul tratto in città
const roadWithin = (() => {
  const C = 100, cells = new Map();
  for (let i = 0; i < MAP.nodes.length; i += 2) {
    const k = Math.floor(MAP.nodes[i] / C) + ',' + Math.floor(MAP.nodes[i + 1] / C);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(MAP.nodes[i], MAP.nodes[i + 1]);
  }
  return (x, z, r) => {
    const n = Math.ceil(r / C), cx = Math.floor(x / C), cz = Math.floor(z / C);
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
      const c = cells.get(cx + a + ',' + (cz + b));
      if (c) for (let i = 0; i < c.length; i += 2) if (Math.hypot(c[i] - x, c[i + 1] - z) < r) return true;
    }
    return false;
  };
})();
function polyS(pts, x, z) {
  let best = Infinity, s = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l = Math.hypot(ex, ez) || 1e-6;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (l * l)));
    const d = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
    if (d < best) { best = d; s = acc + l * t; }
    acc += l;
  }
  return s;
}
function polyCut(pts, s0, s1) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z), at = (s) => ({ x: a.x + ((b.x - a.x) * (s - acc)) / (l || 1), z: a.z + ((b.z - a.z) * (s - acc)) / (l || 1) });
    if (acc + l >= s0 && acc <= s1) {
      if (!out.length) out.push(at(Math.max(s0, acc)));
      out.push(acc + l <= s1 ? b : at(s1));
    }
    acc += l;
  }
  return out;
}
const NEW_TRAM_LINES = NEW_TRAM.linee.map((l) => {
  const versi = l.versi.map((v) => {
    const path = v.percorso.map(([la, lo]) => toXZ(la, lo));
    const stops = v.fermate.map((f) => ({ ...toXZ(f.lat, f.lon), name: f.nome, side: f.lato || 1 }));
    let i0 = 0, i1 = -1;
    for (let i = 0, run = 0; i < stops.length; i++) {
      run = roadWithin(stops[i].x, stops[i].z, 120) ? run + 1 : 0;
      if (run > i1 - i0 + 1) { i1 = i; i0 = i - run + 1; }
    }
    return { v, path, stops, i0, i1 };
  });
  const variants = versi.map(({ v, stops, i0, i1 }, i) => {
    const o0 = v.offsets[i0], dur = v.offsets[i1] - o0, D = v.durata;
    const st = stops.slice(i0, i1 + 1).map((s, k) => ({ id: `${l.id}:${i}:${k}`, x: s.x, z: s.z, name: s.name, street: s.name, importance: 2, side: s.side }));
    const last = st[st.length - 1].name;
    return {
      idx: i, headsign: i1 < stops.length - 1 ? `${last} (per ${v.headsign})` : v.headsign, tram: true, stops: st,
      offsets: v.offsets.slice(i0, i1 + 1).map((o) => o - o0), duration: dur,
      feriale: v.fer.map(([t, d]) => ({ t: t + (o0 * d) / D, d: (dur * d) / D })),
      festivo: v.fes.map(([t, d]) => ({ t: t + (o0 * d) / D, d: (dur * d) / D })),
    };
  });
  const lanes = versi.map(({ path, stops, i0, i1 }) => {
    const s0 = polyS(path, stops[i0].x, stops[i0].z), s1 = polyS(path, stops[i1].x, stops[i1].z);
    return polyCut(path, s0 - 150, s1 + 150);
  });
  const a = variants[0];
  return {
    id: l.id, color: l.colore, tram: true, building: true, modules: l.moduli, variants, pair: [0, 1], lanes,
    headsign: `${a.stops[0].name} ↔ ${a.stops[a.stops.length - 1].name}`, name: l.nome,
  };
});
export const TRAM_LINES = [...SIR1_LINES, ...NEW_TRAM_LINES];
// Binari dei depositi del tram (data/tram-depositi.json di scripts/tram_depositi.py): per deposito le way OSM in x, z.
// Il grafo lo fa TramYard (src/tram/tram.js)
export const TRAM_DEPOTS = DEPOSITI.depositi.map((d) => ({
  name: d.nome, line: d.linea,
  ways: d.binari.map((b) => ({ id: b.id, service: b.servizio, tunnel: b.galleria, pts: b.punti.map(([la, lo]) => toXZ(la, lo)) })),
}));

// Prato della Valle è una piazza-parco: non è un edificio OSM, lo modelliamo noi
export const LANDMARKS = { prato: [45.39814, 11.8766] };

// Lo shape GTFS del tram al capolinea va oltre la banchina d'arrivo e torna indietro sul binario di partenza
// (inversione col cambio cabina). La sede è una sola con due binari: si taglia nel punto più lontano.
function cutReversal(t) {
  const n = t.length;
  let cut = -1;
  for (let i = Math.max(1, n - 15); i < n - 1; i++) {
    const a = t[i - 1], b = t[i], e = t[n - 1];
    const lx = b.x - a.x, lz = b.z - a.z, ll = Math.hypot(lx, lz) || 1;
    const ox = e.x - b.x, oz = e.z - b.z, ol = Math.hypot(ox, oz) || 1;
    if (ol > 5 && ol < 250 && (lx * ox + lz * oz) / (ll * ol) < -0.6) cut = i;
  }
  return cut > 0 ? t.slice(0, cut + 1) : t;
}

// Curve raccordate: a ogni vertice un arco di raggio fino a R (limitato dalla lunghezza dei tratti vicini),
// campionato ogni ~2,5 m. Il tracciato GTFS è una spezzata: così tram, binari e linea aerea girano morbidi.
function smoothTrack(t, R = 28) {
  const out = [t[0]];
  for (let i = 1; i < t.length - 1; i++) {
    const a = t[i - 1], b = t[i], c = t[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
    if (l1 < 0.5 || l2 < 0.5) continue;
    const d1x = (b.x - a.x) / l1, d1z = (b.z - a.z) / l1, d2x = (c.x - b.x) / l2, d2z = (c.z - b.z) / l2;
    const th = Math.acos(Math.max(-1, Math.min(1, d1x * d2x + d1z * d2z)));
    if (th < 0.03) { out.push(b); continue; }
    const T = Math.min(R * Math.tan(th / 2), l1 * 0.45, l2 * 0.45);
    const r = T / Math.tan(th / 2);
    const p1 = { x: b.x - d1x * T, z: b.z - d1z * T }, p2 = { x: b.x + d2x * T, z: b.z + d2z * T };
    const n = Math.max(2, Math.ceil((r * th) / 2.5));
    for (let k = 0; k <= n; k++) {
      const u = k / n, wa = (1 - u) * (1 - u), wb = 2 * u * (1 - u), wc = u * u;
      out.push({ x: wa * p1.x + wb * b.x + wc * p2.x, z: wa * p1.z + wb * b.z + wc * p2.z });
    }
  }
  out.push(t[t.length - 1]);
  return out;
}

// Lo shape GTFS non sta sempre in mezzo alla via: nelle strade strette del centro (Corso Vittorio Emanuele, le Riviere)
// un binario finiva nelle facciate. Dove serve l'asse si sposta di lato quanto basta (fino a 5 m), con raccordi di
// ~30 m; half: distanze dall'asse da tenere fuori dagli edifici. Il vero rimedio è seguire i binari OSM (railway=tram).
function clearOfBuildings(t, buildings, half) {
  const C = 20, grid = new Map();
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const p of t) { bx0 = Math.min(bx0, p.x - 30); bz0 = Math.min(bz0, p.z - 30); bx1 = Math.max(bx1, p.x + 30); bz1 = Math.max(bz1, p.z + 30); }
  for (const b of buildings) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of b.pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    if (x1 < bx0 || x0 > bx1 || z1 < bz0 || z0 > bz1) continue;
    for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++)
      for (let gz = Math.floor(z0 / C); gz <= Math.floor(z1 / C); gz++) {
        const k = gx + ',' + gz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(b);
      }
  }
  const inside = (x, z, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
    }
    return c;
  };
  const blocked = (x, z) => (grid.get(Math.floor(x / C) + ',' + Math.floor(z / C)) || []).some((b) => inside(x, z, b.pts) && !(b.holes || []).some((h) => inside(x, z, h)));
  // ricampionato ogni 3 m, con la normale (a sinistra) in ogni punto
  const pts = [t[0]];
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1], b = t[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3));
    for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  const nor = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: -(b.z - a.z) / l, z: (b.x - a.x) / l };
  });
  const sh = pts.map((p, i) => {
    const n = nor[i], free = (s) => half.every((o) => !blocked(p.x + n.x * (s + o), p.z + n.z * (s + o)));
    if (free(0)) return 0;
    for (let s = 0.5; s <= 5; s += 0.5) { if (free(s)) return s; if (free(-s)) return -s; }
    return 0;
  });
  // raccordo: il tratto spostato si allarga (lo spostamento maggiore nei 15 m vicini) e poi si media
  const W = 5, at = (arr, i) => arr[Math.max(0, Math.min(arr.length - 1, i))];
  const wide = sh.map((_, i) => { let m = 0; for (let k = -W; k <= W; k++) { const v = at(sh, i + k); if (Math.abs(v) > Math.abs(m)) m = v; } return m; });
  const sm = wide.map((_, i) => { let a = 0; for (let k = -W; k <= W; k++) a += at(wide, i + k); return a / (2 * W + 1); });
  return pts.map((p, i) => ({ x: p.x + nor[i].x * sm[i], z: p.z + nor[i].z * sm[i] }));
}

// edificio della mappa ([h, tipo, nome, contorno, cortili, portici]) con i punti come { x, z }
const flatPts = (f) => { const out = []; for (let i = 0; i < f.length; i += 2) out.push({ x: f[i], z: f[i + 1] }); return out; };
export const parseBuilding = ([h, kind, name, f, holes, por]) => ({ h, kind, name, pts: flatPts(f), holes: holes ? holes.map(flatPts) : null, por });

export function buildNetwork() {
  const nodes = {};
  const N = MAP.nodes.length / 2;
  for (let i = 0; i < N; i++) nodes[i] = { id: String(i), name: null, x: MAP.nodes[i * 2], z: MAP.nodes[i * 2 + 1], edges: [] };
  const flat = (f) => { const out = []; for (let i = 0; i < f.length; i += 2) out.push({ x: f[i], z: f[i + 1] }); return out; };
  const water = MAP.water.map(([name, width, f]) => ({ name, width, pts: flat(f) })).filter((w) => w.pts.length > 1);
  const rails = MAP.rails.map(([bt, yard, f]) => ({ bridge: bt === 1, tunnel: bt === 2, yard: !!yard, pts: flat(f) })).filter((r) => r.pts.length > 1);
  // por: altezza libera dei portici misurati (DBGT), 0 = misurato senza portici, undefined = non misurato
  const buildings = MAP.buildings.map(parseBuilding);
  // con la mappa divisa in aree (src/data/aree.js) gli edifici arrivano a richiesta: per spostare i binari fuori dalle
  // facciate e per i tiranti della linea aerea la rete ha quelli a meno di 60 m dai binari (scripts/aree_mappa.py)
  const tramBuildings = MAP.edificiTram ? MAP.edificiTram.map(parseBuilding) : buildings;
  // tram SIR1: tracciato e fermate (sede tranviaria in mezzo a Via Aspetti, Via Reni, ecc.)
  // sede del tram: inversione ai capolinea tagliata, curve raccordate, binario tronco di 40 m oltre i capolinea.
  // Con i binari OSM (tramLanes) c'è un tracciato per verso; con il solo GTFS il primo è l'asse dei due binari
  // affiancati a ±1,7 m e il secondo il binario singolo dove i versi si separano
  const lanes = !!MAP.tramLanes;
  // SIR1: lo shape GTFS di un verso arriva in fondo al binario tronco del capolinea, fa l'inversione e torna sul binario
  // dell'altro verso fino alla banchina (Pontevigodarzere, Guizza). L'inversione si taglia; il pezzo di ritorno, senza i
  // metri della curva a U, è il tronco del binario dell'altro verso e va in testa a quello: ci riparte il tram dopo il
  // cambio cabina. Un capo senza tronco si allunga dritto di 40 m (il convoglio fermo, il cambio cabina)
  const raw = (MAP.tram || []).map(flat).filter((t) => t.length > 1);
  const cuts = raw.map((t) => { const head = cutReversal(t); return { t: head, tail: t.slice(head.length) }; });
  const tram = cuts.map(({ t, tail: own }, k) => {
    const o = cuts[1 - k];
    let head = [];
    if (o && o.tail.length) {
      const u = o.t[o.t.length - 1], tail = o.tail.filter((p) => Math.hypot(p.x - u.x, p.z - u.z) > 2);
      if (tail.length > 1 && Math.hypot(tail[tail.length - 1].x - t[0].x, tail[tail.length - 1].z - t[0].z) < 40) head = tail;
    }
    t = smoothTrack(cutReversal(t.slice().reverse()).reverse());
    const ext = (p, q) => { const l = Math.hypot(p.x - q.x, p.z - q.z) || 1; return { x: p.x + ((p.x - q.x) / l) * 40, z: p.z + ((p.z - q.z) / l) * 40 }; };
    const start = head.length ? head.concat(t) : [ext(t[0], t[1]), ...t];
    const end = own.length ? [] : [ext(t[t.length - 1], t[t.length - 2])];
    return clearOfBuildings([...start, ...end], tramBuildings, k === 0 && !lanes ? [-3, -1.7, 0, 1.7, 3] : [-1.4, 0, 1.4]);
  });
  const tramStops = (MAP.tramStops || []).map(([x, z, name, central]) => ({ x, z, name, central: !!central }));
  // linee in costruzione: binari OSM per verso, curve raccordate e fuori dagli edifici come quelli del SIR1
  const tramLines = NEW_TRAM_LINES.map((L) => ({ id: L.id, lanes: L.lanes.map((t) => clearOfBuildings(smoothTrack(t), tramBuildings, [-1.4, 0, 1.4])) }));
  const landmarks = Object.fromEntries(Object.entries(LANDMARKS).map(([k, [la, lo]]) => [k, toXZ(la, lo)]));
  const edges = [];
  const E = MAP.edges;
  const byK = []; // indice dell'arco nella mappa -> arco (gli archi più corti di 0,3 m si saltano)
  for (let k = 0; k < E.length; k += 8) {
    const A = nodes[E[k]], B = nodes[E[k + 1]];
    const dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const cls = E[k + 2], flags = E[k + 5];
    const e = {
      id: edges.length, a: A.id, b: B.id, cls, width: E[k + 3], name: MAP.names[E[k + 4]] || '',
      oneway: flags & 1 ? 1 : flags & 2 ? -1 : 0, busBoth: !!(flags & 256), bridge: !!(flags & 4), tunnel: !!(flags & 8), roundabout: !!(flags & 16), psv: !!(flags & 32),
      speed: E[k + 6], layer: E[k + 7], len, dx: dx / len, dz: dz / len, routes: 0,
      main: cls <= 3, ped: cls === 8, service: cls === 7,
    };
    A.edges.push(e);
    B.edges.push(e);
    edges.push(e);
    byK[k / 8] = e;
  }
  // corsie dai tag OSM (scripts/build_map.py, lane_code), nel verso a -> b; frecce a terra da turn:lanes
  const LN = MAP.lanes || [];
  for (let i = 0; i < LN.length; i += 2) {
    const e = byK[LN[i]], c = LN[i + 1];
    if (e) e.osmLanes = { nf: c & 7, nb: (c >> 3) & 7, bf: (c >> 6) & 1, bb: (c >> 7) & 1, ovf: (c >> 8) & 1, ovb: (c >> 9) & 1, mark: (c >> 10) & 3 };
  }
  for (const [k, f, b] of MAP.turnLanes || []) if (byK[k]) byK[k].turn = { f: f ? f.split('|') : null, b: b ? b.split('|') : null };
  const edgeBetween = (a, b) => nodes[a].edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  // quante linee bus percorrono ogni tratto
  for (const L of LINES) {
    const used = new Set();
    for (const v of L.variants) for (let i = 0; i < v.nodes.length - 1; i++) { const e = edgeBetween(v.nodes[i], v.nodes[i + 1]); if (e) used.add(e); }
    for (const e of used) e.routes++;
  }
  for (const e of edges) if (e.routes >= 2) e.main = true;
  // quote dei cavalcavia: calcolate con la pianta delle strade (stessa regola), altrimenti qui
  if (MAP.nodeH) {
    for (const [i, h] of MAP.nodeH) if (nodes[i]) nodes[i].h = h;
    for (const e of edges) {
      const ha = nodes[e.a].h || 0, hb = nodes[e.b].h || 0;
      if (ha > 0.05 || hb > 0.05) { e.elev = true; e.ha = ha; e.hb = hb; }
    }
  } else markOverpasses(nodes, edges, rails);
  // segnaletica reale dai nodi OSM; null se la mappa è stata generata senza (il gioco la deduce dal tipo di strada)
  const signals = MAP.signals ? MAP.signals.map(([ped, ...ids]) => ({ ped: !!ped, nodes: ids.map((i) => nodes[i]) })) : null;
  const signs = MAP.signs ? new Map() : null; // `${incrocio}:${arco}` -> 0 STOP, 1 dare precedenza
  for (const [j, from, kind] of MAP.signs || []) {
    const e = edgeBetween(String(j), String(from));
    if (e) signs.set(`${j}:${e.id}`, kind);
  }
  // bracci degli incroci semaforizzati: `${incrocio}:${arco}` -> { stop: linea d'arresto OSM in m (0 = non nota),
  // lanes: corsie nel verso di chi arriva, off: niente lanterna (semaforo pedonale in un verso solo) }
  const signalArms = MAP.signalArms ? new Map() : null;
  for (let k = 0; k < (MAP.signalArms || []).length; k += 5) {
    const [j, from, dm, lanes, off] = MAP.signalArms.slice(k, k + 5);
    const e = edgeBetween(String(j), String(from));
    if (e) signalArms.set(`${j}:${e.id}`, { stop: dm / 10, lanes, off: !!off });
  }
  const crossings = MAP.crossings ? new Map() : null; // arco -> metri dal nodo a delle strisce pedonali
  for (const [a, b, s] of MAP.crossings || []) {
    const e = edgeBetween(String(a), String(b));
    if (!e) continue;
    if (!crossings.has(e)) crossings.set(e, []);
    crossings.get(e).push(e.a === String(a) ? s : e.len - s);
  }
  // dossi e attraversamenti rialzati (traffic_calming): arco -> [{ s: metri dal nodo a, kind, up }], kind 0 dosso,
  // 1 dosso lungo, 2 cuscino, 3 attraversamento rialzato (rampe prima e dopo), 4 rampa di una via rialzata che sale
  // nel verso a -> b (up = 1) o contro (-1)
  const calming = MAP.calming ? new Map() : null;
  for (const [a, b, s, kind] of MAP.calming || []) {
    const e = edgeBetween(String(a), String(b));
    if (!e) continue;
    if (!calming.has(e)) calming.set(e, []);
    const fw = e.a === String(a);
    calming.get(e).push({ s: fw ? s : e.len - s, kind, up: fw ? 1 : -1 });
  }
  const expandSeq = (seq) => seq.filter((id, i) => i === 0 || id !== seq[i - 1]);
  // area coperta dagli edifici OSM (fuori si generano edifici procedurali)
  let bb = MAP.edificiBBox || [Infinity, Infinity, -Infinity, -Infinity];
  if (!MAP.edificiBBox) for (const b of buildings) for (const p of b.pts) bb = [Math.min(bb[0], p.x), Math.min(bb[1], p.z), Math.max(bb[2], p.x), Math.max(bb[3], p.z)];
  return { nodes, edges, edgeBetween, expandSeq, water, rails, railway: rails.length ? rails[0].pts : [], buildings, tramBuildings, buildingBBox: bb, areas: !!MAP.aree, landmarks, stops: STOPS, tram, tramLanes: lanes, tramLines, tramStazione: MAP.tramStazione || null, tramScambi: (NEW_TRAM.scambi || []).map(([a, b, c, d]) => [toXZ(a, b), toXZ(c, d)]), surfaces: MAP.surfaces || null, tramStops, signals, signalArms, signs, crossings, calming, terrain: MAP.terrain || null };
}

const LANE_MIN = 2.6, BUS_LANE_MIN = 3.0, LANE_MAX = 3.75; // m
// Corsie di un arco nel verso a -> b, da sinistra a destra: { lanes: [{ d, bus, off }], lines: [{ off, kind }], w }.
// d = 1 nel verso a -> b, -1 contro; off: distanza dall'asse verso destra (verso a -> b); kind delle righe tra due
// corsie: 'dash' (stesso verso), 'solid' (stesso verso, sorpasso vietato), 'center' e 'centerSolid' (mezzeria), 'bus'
// (riga gialla della corsia riservata); w: larghezza delle corsie. Senza tag OSM una corsia per verso (una sola sui
// sensi unici). Sulle carreggiate
// strette (meno di 2,6 m a corsia, 3 per quelle dei bus) si tolgono le corsie in più: prima nel verso che ne ha di più,
// poi quelle dei bus; un doppio senso sotto i 5,2 m resta senza mezzeria.
export function laneLayout(e) {
  if (e.layout) return e.layout;
  const L = e.osmLanes;
  let nf, nb, bf = 0, bb = 0;
  if (L) ({ nf, nb, bf, bb } = L);
  else if (e.oneway) { nf = e.oneway > 0 ? 1 : 0; nb = e.oneway < 0 ? 1 : 0; }
  else nf = nb = 1;
  const fits = () => (nf - bf + nb - bb) * LANE_MIN + (bf + bb) * BUS_LANE_MIN <= e.width;
  while (nf + nb > 1 && !fits()) {
    const gf = nf - bf, gb = nb - bb;
    if (gf > 1 || gb > 1) { if (gf >= gb) nf--; else nb--; }
    else if (bf || bb) { if (bf) { bf = 0; nf--; } else { bb = 0; nb--; } }
    else { nf = nb = 0; }
  }
  const lanes = [];
  for (let i = 0; i < nb; i++) lanes.push({ d: -1, bus: i < bb });
  for (let i = 0; i < nf; i++) lanes.push({ d: 1, bus: i >= nf - bf });
  // corsie larghe al più 3,75 m, centrate; quelle dei bus stanno contro il cordolo, e l'avanzo resta dall'altra parte
  // (sosta). Con le corsie dei bus da tutte e due le parti riempiono la carreggiata
  const n = lanes.length, lb = n && lanes[0].bus, rb = n && lanes[n - 1].bus;
  const w = n ? (lb && rb ? e.width / n : Math.min(e.width / n, LANE_MAX)) : 0;
  const x0 = lb ? -e.width / 2 : rb ? e.width / 2 - n * w : (-n * w) / 2;
  lanes.forEach((l, i) => { l.off = x0 + (i + 0.5) * w; });
  const lines = [];
  for (let i = 0; i < n - 1; i++) {
    const p = lanes[i], q = lanes[i + 1], off = x0 + (i + 1) * w;
    const noPass = !!L && ((L.ovf && (p.d > 0 || q.d > 0)) || (L.ovb && (p.d < 0 || q.d < 0)));
    const kind = p.bus !== q.bus || (p.bus && p.d !== q.d) ? 'bus' : p.d !== q.d ? (noPass ? 'centerSolid' : 'center') : noPass ? 'solid' : 'dash';
    lines.push({ off, kind });
  }
  e.layout = { lanes, lines, w };
  return e.layout;
}

// distanza dall'asse, a destra di chi va, della corsia più a destra che non è dei bus, nel verso a -> b (fwd) o contro;
// null se in quel verso non ci sono corsie per le auto
export function driveOffset(e, fwd) {
  const d = fwd ? 1 : -1, mine = laneLayout(e).lanes.filter((l) => l.d === d && !l.bus);
  if (!mine.length) return null;
  return fwd ? mine[mine.length - 1].off : -mine[0].off;
}

// corsie di un verso (fwd: a -> b) come distanze dall'asse a destra di chi va: [bordo sinistro, bordo destro]; null se
// in quel verso non ci sono corsie. Per le linee d'arresto, che partono dalla mezzeria
export function laneSpan(e, fwd) {
  const lay = laneLayout(e), d = fwd ? 1 : -1, offs = lay.lanes.filter((l) => l.d === d).map((l) => (fwd ? l.off : -l.off));
  return offs.length ? [Math.min(...offs) - lay.w / 2, Math.max(...offs) + lay.w / 2] : null;
}

// ponti stradali sopra la ferrovia o sopra un'altra strada: impalcato in quota con rampe di accesso
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
  // strade di sotto attraversate da un ponte (senza nodi in comune): Corso Tredici Giugno sopra Via Sacro Cuore
  const C = 100, grid = new Map();
  for (const f of edges) {
    if (f.bridge || f.tunnel || f.ped) continue;
    const A = nodes[f.a], B = nodes[f.b];
    for (let gx = Math.floor(Math.min(A.x, B.x) / C); gx <= Math.floor(Math.max(A.x, B.x) / C); gx++)
      for (let gz = Math.floor(Math.min(A.z, B.z) / C); gz <= Math.floor(Math.max(A.z, B.z) / C); gz++) {
        const k = gx + ',' + gz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(f);
      }
  }
  const under = new Set();
  const overRoad = (e) => {
    const A = nodes[e.a], B = nodes[e.b];
    let hit = false;
    for (let gx = Math.floor(Math.min(A.x, B.x) / C); gx <= Math.floor(Math.max(A.x, B.x) / C); gx++)
      for (let gz = Math.floor(Math.min(A.z, B.z) / C); gz <= Math.floor(Math.max(A.z, B.z) / C); gz++)
        for (const f of grid.get(gx + ',' + gz) || []) {
          if (f.layer >= e.layer || f.a === e.a || f.a === e.b || f.b === e.a || f.b === e.b) continue;
          const c = nodes[f.a], d = nodes[f.b];
          const rx = B.x - A.x, rz = B.z - A.z, sx = d.x - c.x, sz = d.z - c.z, den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((c.x - A.x) * sz - (c.z - A.z) * sx) / den, u = ((c.x - A.x) * rz - (c.z - A.z) * rx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { hit = true; under.add(f.a); under.add(f.b); }
        }
    return hit;
  };
  const H = 7, R = 130, PSV_DECK = 0.92;
  const deck = new Set();
  for (const e of edges) if (e.bridge && e.layer >= 1 && (crosses(nodes[e.a], nodes[e.b]) | overRoad(e))) deck.add(e);
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
      // la rampa non sale sulla strada che passa sotto
      if (d < R && !under.has(o) && (!dist.has(o) || dist.get(o) > d)) { dist.set(o, d); queue.push(o); }
    }
  }
  // le corsie riservate ai bus in quota (Borgomagno: verso nord, sulla sede del tram) stanno poco più in basso della
  // strada accanto: il cavalcavia è un corpo unico su due livelli
  for (const [id, d] of dist) {
    const u = Math.max(0, Math.min(1, 1 - d / R));
    nodes[id].h = H * u * u * (3 - 2 * u) * (nodes[id].edges.every((e) => e.psv) ? PSV_DECK : 1);
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
