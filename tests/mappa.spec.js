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

// 9 novembre: i lampioni stanno fuori dall'asfalto vero (City.buildTreesAndLamps); con la corsia mappa sopra il
// piazzale della stazione fermate con ostacoli 9, fuori strada 5, spostate 11; gli alberi messi a caso si rimescolano
// a ogni mappa nuova
const SOGLIE = {
  semafori_in_carreggiata: 2,
  paline_in_carreggiata: 0,
  lampioni_in_carreggiata: 0,
  alberi_in_carreggiata: 4,
  pensiline_in_carreggiata: 0,
  fermate_con_ostacoli: 9,
  fermate_fuori_strada: 5,
  fermate_spostate: 11,
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
};

test('rapporto di verifica sulla mappa', async ({ pagina, gioco }, info) => {
  test.setTimeout(600_000);
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
    const p = punto(R, st.s - back), rx = -p.dz, rz = p.dx, ks = st.ks || 0;
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
