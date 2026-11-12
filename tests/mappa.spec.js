// Rapporto di verifica sulla mappa, parte nel browser (sezione 6.1 di docs/PIANO_MODELLO_CITTA.md): gli oggetti che il
// gioco mette al loro posto al caricamento, misurati dal bordo vero dell'asfalto (city.roadInfo), e le fermate di
// tutte le varianti delle linee bus con il bus nella posizione di fermata. Il resto (edifici in carreggiata, fermate
// lontane dal percorso) lo controlla scripts/verifica_mappa.py sul JSON.
//
// La prova fallisce se un numero supera la sua soglia (valori del 9 novembre 2026). Se un numero scende, si abbassa la
// soglia nello stesso commit. Il rapporto completo, con i casi e le coordinate, è allegato al risultato della prova e
// scritto in test-results/<prova>/rapporto-mappa.json.
import { writeFileSync } from 'node:fs';
import { test, expect } from './gioco.js';

// 9 novembre: lampioni e alberi dei viali stanno fuori dall'asfalto vero (City.buildTreesAndLamps); con la corsia
// mappa sopra il piazzale della stazione fermate con ostacoli 9, fuori strada 5, spostate 11. Corsia capolinea,
// corridoio del SIR3 fino a Voltabarozzo: una palina in carreggiata, Piovese fr. Park (linee 4, 14, 16) nel golfo sotto
// il cavalcavia della tangenziale, fuori dall'asfalto ma sotto il nastro di Corso Primo Maggio (arco in quota, che
// roadInfo conta); con Via Bembo e Via Volta nella rete (gtfs_links di build_map.py) fuori strada 4, spostate 7.
// 11 novembre, SIR2 da Rubano a Vigonza: la 10 arriva intera a Sarmeola e a Ponte di Brenta, con due fermate dove le
// ruote del bus fermo escono dall'asfalto (Provvidenza 14, nel golfo accanto alla sede del tram a Chiesanuova, 4,9 m;
// Capolinea Ponte Brenta, nel piazzale, 1,7 m): fuori strada 6; spostate 6. Gruppo 2 della corsia capolinea (3, 10, 11,
// 22, 24 e 88 intere): paline in carreggiata 3, Park Bembo e Capolinea Park Bembo della 3 sotto il nastro di Corso
// Primo Maggio, come Piovese fr. Park; ostacoli 10, la pensilina di Bembo Rotonda via Ponchia (3 verso Lion) all'uscita
// della rotonda, da sistemare; fuori strada 7, Capolinea Caselle della 10 snodata nel piazzale della rotonda (5,1 m);
// spostate 3. 12 novembre (#66): nessun edificio sui binari dei depositi del tram, né a meno di 2 m dal loro asse
// 12 novembre (#16): il bus fermo sulla linea del cordolo nel sistema della palina (stopPose) e lo stallo del
// capolinea a Caselle: ostacoli 9 (via Ponchia), fuori strada 4 (Caselle e Maroncelli fr.121 della 9 e della 42)
const SOGLIE = {
  semafori_in_carreggiata: 2,
  paline_in_carreggiata: 3,
  lampioni_in_carreggiata: 0,
  alberi_in_carreggiata: 0,
  pensiline_in_carreggiata: 0,
  fermate_con_ostacoli: 9,
  fermate_fuori_strada: 4,
  fermate_spostate: 3,
  segni_sulla_sede: 0,
  asfalto_sopra_sede: 0,
  edifici_sui_binari_dei_depositi: 0,
};
const NOMI = {
  semafori_in_carreggiata: 'pali dei semafori in carreggiata',
  paline_in_carreggiata: 'paline in carreggiata',
  lampioni_in_carreggiata: 'lampioni in carreggiata',
  alberi_in_carreggiata: 'alberi in carreggiata',
  pensiline_in_carreggiata: 'pensiline in carreggiata',
  fermate_con_ostacoli: 'fermate dove il bus fermo tocca un ostacolo',
  fermate_fuori_strada: 'fermate dove il bus fermo ha le ruote oltre il cordolo',
  fermate_spostate: 'fermate agganciate a più di 40 m dalla fermata vera',
  segni_sulla_sede: 'quadrati di 10 m con segni della strada sopra la sede del tram',
  asfalto_sopra_sede: 'quadrati di 10 m con asfalto sopra la sede del tram',
  edifici_sui_binari_dei_depositi: 'edifici sopra i binari dei depositi del tram o a meno di 2 m dal loro asse',
};

test('rapporto di verifica sulla mappa', async ({ pagina, gioco }, info) => {
  test.setTimeout(600_000);
  // con la mappa divisa in aree (src/data/aree.js) si misura tutta: si caricano tutte, e non si liberano più
  await pagina.evaluate(() => window.__game.city.loadAll());
  const r = await pagina.evaluate(misura);
  const valori = Object.fromEntries(Object.keys(SOGLIE).map((k) => [k, r.casi[k].length]));
  const righe = [
    ...Object.entries(r.distribuzioni).map(([k, d]) => `${k}: ${Object.entries(d).map(([a, n]) => `${n} ${a}`).join(', ')}`),
    `${r.varianti} varianti di linea, ${r.fermate} fermate controllate`,
    ...Object.keys(SOGLIE).map((k) => `${valori[k] > SOGLIE[k] ? '✗' : '✓'} ${NOMI[k]}: ${valori[k]} (soglia ${SOGLIE[k]})`),
  ];
  const elenco = Object.keys(SOGLIE).filter((k) => r.casi[k].length).map((k) => `${NOMI[k]}:\n${r.casi[k].slice(0, 30).map((c) => '  ' + Object.entries(c).map(([a, b]) => `${a}=${b}`).join(', ')).join('\n')}`);
  const json = JSON.stringify({ valori, soglie: SOGLIE, ...r }, null, 1);
  writeFileSync(info.outputPath('rapporto-mappa.json'), json);
  await info.attach('rapporto-mappa.json', { body: json, contentType: 'application/json' });
  info.annotations.push({ type: 'rapporto', description: righe.join('\n') });
  console.log(['Rapporto di verifica della mappa (nel gioco)', ...righe.map((s) => '  ' + s)].join('\n'));
  for (const k of Object.keys(SOGLIE)) expect.soft(valori[k], `${NOMI[k]}\n${elenco.join('\n')}`).toBeLessThanOrEqual(SOGLIE[k]);
  expect(gioco.errori()).toEqual([]);
});

// Gira nella pagina: deve bastare a sé stessa (Playwright la passa come testo).
function misura() {
  const g = window.__game, city = g.city, tondo = (v) => Math.round(v * 10) / 10;
  const fuori = (x, z) => city.roadInfo(x, z).off;
  const dove = (off) => (off < 0 ? 'in carreggiata' : off < 0.3 ? 'sul cordolo' : off <= 3 ? 'sul marciapiede' : 'oltre 3 m');
  const via = (x, z) => { const e = city.roadInfo(x, z).edge; return (e && e.name) || ''; };
  const distribuzioni = {}, casi = {};
  const classifica = (nome, chiave, punti) => {
    const d = {};
    casi[chiave] = [];
    for (const p of punti) {
      const off = fuori(p.x, p.z), w = dove(off);
      d[w] = (d[w] || 0) + 1;
      if (off < 0) casi[chiave].push({ ...p.info, x: Math.round(p.x), z: Math.round(p.z), via: via(p.x, p.z), dentro: tondo(-off) });
    }
    distribuzioni[nome] = d;
  };

  // pali dei semafori (lanterne a muro escluse), paline, ostacoli fissi messi dal gioco
  const pali = [];
  for (const ap of g.lights.byKey.values()) for (const p of ap.poles || []) pali.push({ x: p.x, z: p.z, info: {} });
  classifica('pali dei semafori', 'semafori_in_carreggiata', pali);
  classifica('paline', 'paline_in_carreggiata', city.stopPlacements.map((st) => ({ x: st.x, z: st.z, info: { fermata: st.name } })));
  const ostacoli = [...new Set([...city.obstacles.map.values()].flat())].filter((b) => !b.dead);
  const di = (kind) => ostacoli.filter((b) => b.kind === kind).map((b) => ({ x: b.x, z: b.z, info: {} }));
  classifica('lampioni', 'lampioni_in_carreggiata', di('pole'));
  classifica('alberi', 'alberi_in_carreggiata', di('tree'));
  classifica('pensiline', 'pensiline_in_carreggiata', di('shelter'));

  // sede del tram pulita (segnalazioni dell'11 novembre dal SIR3 verso Cornaro): segni della strada (le mesh con
  // userData.segno) e asfalto sopra le corsie rosse, cordoli esclusi. Un caso per quadrato di 10 m. La sede è quella
  // del gioco con la sua quota (city.onSede): i segni a terra sotto un viadotto del tram non contano
  const quadrati = (mappa, x, z, voce) => {
    const k = Math.floor(x / 10) + ',' + Math.floor(z / 10), c = mappa.get(k) || { x: Math.round(x), z: Math.round(z), via: via(x, z), n: 0 };
    c.n++;
    if (voce) c.cm = Math.max(c.cm || 0, voce);
    mappa.set(k, c);
  };
  const segni = new Map(), asfalto = new Map();
  let asf = null;
  city.group.traverse((o) => {
    if (o.isMesh && o.material === city.asphMat) asf = o;
    if (!o.isMesh || !o.userData.segno) return;
    const P = o.geometry.attributes.position, I = o.geometry.index, n = (I ? I.count : P.count) / 3;
    for (let t = 0; t < n; t++) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 3; k++) { const i = I ? I.getX(3 * t + k) : 3 * t + k; x += P.getX(i) / 3; y += P.getY(i) / 3; z += P.getZ(i) / 3; }
      if (city.onSede(x, z, y - 0.14, -0.4)) quadrati(segni, x, z);
    }
  });
  // asfalto: la quota la mette lo shader del terreno ai vertici; dentro il triangolo è la media, la sede rossa sta 3 cm
  // sopra il terreno. Campioni ogni 1,5 m, conta chi supera la sede di più di 2 cm
  if (asf && g.terrain.ok) {
    const T = (x, z) => g.terrain.at(x, z), P = asf.geometry.attributes.position, I = asf.geometry.index;
    for (let t = 0; t < I.count / 3; t++) {
      const v = [0, 1, 2].map((k) => { const i = I.getX(3 * t + k), x = P.getX(i), z = P.getZ(i); return [x, z, P.getY(i) + T(x, z)]; });
      const x0 = Math.min(v[0][0], v[1][0], v[2][0]), x1 = Math.max(v[0][0], v[1][0], v[2][0]), z0 = Math.min(v[0][1], v[1][1], v[2][1]), z1 = Math.max(v[0][1], v[1][1], v[2][1]);
      if (!city.tramIn(x0, z0, x1, z1)) continue;
      const det = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
      if (Math.abs(det) < 1e-6) continue;
      for (let x = x0; x <= x1; x += 1.5) for (let z = z0; z <= z1; z += 1.5) {
        const a = ((x - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (z - v[0][1])) / det;
        const b = ((v[1][0] - v[0][0]) * (z - v[0][1]) - (x - v[0][0]) * (v[1][1] - v[0][1])) / det;
        if (a < 0 || b < 0 || a + b > 1 || !city.onSede(x, z, 0, -0.4)) continue;
        const sopra = v[0][2] * (1 - a - b) + v[1][2] * a + v[2][2] * b - (0.14 + 0.03 + T(x, z));
        if (sopra > 0.02) quadrati(asfalto, x, z, Math.round(sopra * 100));
      }
    }
  }
  casi.segni_sulla_sede = [...segni.values()];
  casi.asfalto_sopra_sede = [...asfalto.values()];

  // edifici sui binari dei depositi del tram (#66): piante disegnate come edifici sopra un binario di un deposito o a meno
  // di 2 m dal suo asse, e muri chiusi delle rimesse (disegnate come capannone sulla pianta vera, City.buildDepotShed) a
  // meno di 2 m. Si costruiscono i riquadri degli edifici attorno ai depositi
  casi.edifici_sui_binari_dei_depositi = [];
  const ruoli = {};
  for (const Y of city.tramYards || []) {
    const assi = Y.edges.flatMap((e) => e.pts.slice(1).map((p, i) => [e.pts[i].x, e.pts[i].z, p.x, p.z]));
    const xs = assi.flatMap((a) => [a[0], a[2]]), zs = assi.flatMap((a) => [a[1], a[3]]);
    const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, z0 = Math.min(...zs) - 10, z1 = Math.max(...zs) + 10;
    city.ensureTiles((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2);
    const dp = (px, pz, [ax, az, bx, bz]) => { const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez || 1))); return Math.hypot(px - ax - ex * t, pz - az - ez * t); };
    const taglia = (a, b) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); const A = [a[0], a[1]], B = [a[2], a[3]], C = [b[0], b[1]], D = [b[2], b[3]]; return o(A, B, C) * o(A, B, D) < 0 && o(C, D, A) * o(C, D, B) < 0; };
    const dseg = (a, b) => (taglia(a, b) ? 0 : Math.min(dp(a[0], a[1], b), dp(a[2], a[3], b), dp(b[0], b[1], a), dp(b[2], b[3], a)));
    const dentro = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].z > z) !== (P[j].z > z) && x < ((P[j].x - P[i].x) * (z - P[i].z)) / (P[j].z - P[i].z) + P[i].x) c = !c; return c; };
    for (const t of city.tiles.values()) for (const b of t.list) {
      if (!b.pts.some((p) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1)) continue;
      const rimessa = b.deposito === 'rimessa';
      if (b.deposito) ruoli[b.deposito] = (ruoli[b.deposito] || 0) + 1;
      const lati = rimessa ? b.muri || [] : b.pts.map((p, i) => { const q = b.pts[(i + 1) % b.pts.length]; return [p.x, p.z, q.x, q.z]; });
      let d = Infinity;
      for (const a of assi) {
        if (!rimessa && (dentro(a[0], a[1], b.pts) || dentro(a[2], a[3], b.pts))) d = 0;
        for (const l of lati) d = Math.min(d, dseg(a, l));
      }
      if (d < 2) casi.edifici_sui_binari_dei_depositi.push({ deposito: Y.name, cosa: rimessa ? 'muro della rimessa' : 'edificio', x: Math.round(b.cx), z: Math.round(b.cz), h: b.h, metri: tondo(d) });
    }
  }
  distribuzioni['edifici accanto ai binari dei depositi'] = { rimesse: ruoli.rimessa || 0, 'di servizio': ruoli.servizio || 0, tolti: city.depotDropped ? city.depotDropped.size : 0 };

  // fermate di tutte le varianti: si avvia la corsa (le fermate si allineano alle paline come in gioco) e si mette il
  // bus nella posizione di fermata (stopPose di src/game/routes.js)
  const punto = (R, s) => {
    s = Math.max(0, Math.min(R.length, s));
    let i = 0;
    while (i < R.segs.length - 1 && R.cum[i + 1] < s) i++;
    const q = R.segs[i], t = s - R.cum[i];
    return { x: R.pts[i].x + q.dx * t, z: R.pts[i].z + q.dz * t, dx: q.dx, dz: q.dz };
  };
  const posa = (R, st, back = 6.5) => {
    back = Math.min(back, Math.max(0, st.s));
    const p = st.kl != null ? { x: st.cx - st.dx * back, z: st.cz - st.dz * back, dx: st.dx, dz: st.dz } : punto(R, st.s - back);
    const rx = -p.dz, rz = p.dx, ks = st.ks || 0;
    const lat = (st.kl ?? st.kerb ?? st.hw) - ks * back - 1.6;
    return { x: p.x + rx * lat, z: p.z + rz * lat, h: Math.atan2(p.dx + rx * ks, p.dz + rz * ks) };
  };
  // cerchi di collisione del bus lungo l'asse (Bus in src/bus/bus.js; lo snodato con il rimorchio allineato) e ruote
  const CERCHI = [-4.9, -2.45, 0, 2.45, 4.9], CERCHI_SNODATO = [-2.55, -0.3, 1.95, 4.2, 4.9, -5.4, -7.7, -10, -10.7];
  const RUOTE = [3.3, -2.6], RUOTE_SNODATO = [3.3, -2.6, -9.6];
  const tocca = (x, z) => {
    for (const b of city.obstacles.query(x, z, 4, [])) {
      if (b.dead || b.kind === 'car') continue;
      const lx = (x - b.x) * b.c + (z - b.z) * b.s, lz = -(x - b.x) * b.s + (z - b.z) * b.c;
      if (Math.hypot(Math.max(Math.abs(lx) - b.hx, 0), Math.max(Math.abs(lz) - b.hz, 0)) < 1.325) return b;
    }
    return null;
  };
  casi.fermate_con_ostacoli = []; casi.fermate_fuori_strada = []; casi.fermate_spostate = [];
  const s = g.settings, visti = { ostacoli: new Set(), strada: new Set(), spostate: new Set() };
  let varianti = 0, fermate = 0;
  for (const L of g.lines) {
    const snodato = L.id === '10';
    for (let vi = 0; vi < L.variants.length; vi++) {
      Object.assign(s, { line: L, vIdx: vi, mode: 'service', fromDepot: false, vehicle: 'bus' });
      g.startMission();
      const m = g.mission, R = m.route;
      varianti++;
      for (const st of m.stops) {
        fermate++;
        const voce = { linea: L.id, verso: L.variants[vi].headsign, fermata: st.idx, nome: st.name };
        const chiave = `${L.id}:${st.name}:${Math.round(st.cx)}:${Math.round(st.cz)}`; // stessa palina in più varianti: una volta
        const sp = Math.hypot(st.cx - st.gtfs.x, st.cz - st.gtfs.z);
        if (sp > 40 && !visti.spostate.has(chiave)) { visti.spostate.add(chiave); casi.fermate_spostate.push({ ...voce, metri: Math.round(sp) }); }
        const q = posa(R, st), fx = Math.sin(q.h), fz = Math.cos(q.h);
        city.ensureTiles(q.x, q.z, 40);
        for (const lz of snodato ? CERCHI_SNODATO : CERCHI) {
          const b = tocca(q.x + fx * lz, q.z + fz * lz);
          if (b && !visti.ostacoli.has(chiave)) { visti.ostacoli.add(chiave); casi.fermate_con_ostacoli.push({ ...voce, cosa: b.kind, x: Math.round(b.x), z: Math.round(b.z), via: via(q.x, q.z) }); }
        }
        let peggio = 0;
        for (const lz of snodato ? RUOTE_SNODATO : RUOTE) for (const lato of [-1.05, 1.05]) {
          peggio = Math.max(peggio, fuori(q.x + fx * lz + fz * lato, q.z + fz * lz - fx * lato));
        }
        if (peggio > 1 && !visti.strada.has(chiave)) { visti.strada.add(chiave); casi.fermate_fuori_strada.push({ ...voce, metri: tondo(peggio), x: Math.round(q.x), z: Math.round(q.z), via: via(q.x, q.z) }); }
      }
    }
  }
  return { distribuzioni, casi, varianti, fermate };
}
