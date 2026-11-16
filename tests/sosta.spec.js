// Sosta lungo le strade (#111, docs/sosta.md). Gli stalli li calcola la build (scripts/sosta.py) e li controlla sulla
// mappa scripts/verifica_mappa.py; qui si guarda il gioco, che li legge:
// - la scena ha le righe di tutti gli stalli della mappa e un'auto ferma, con il suo ostacolo, in quelli occupati
//   all'ora della prova, né più né meno;
// - nessuno stallo, occupato o no, sta dove passano i mezzi automatici: la corsia delle auto (Traffic.laneGeom) e la
//   carrozzeria dei bus lungo le corsie di tutte le varianti (come in tests/pali.js), con l'accosto alle fermate.
// Soglie per caso (#105): i casi noti stanno in data/eccezioni/sosta-gioco.json, che nasce vuoto. Un caso nuovo si
// corregge nella build (zone libere, larghezza che serve alle corsie); se deve restare va nell'elenco con il perché:
// `ECCEZIONI=aggiorna npx playwright test tests/sosta.spec.js`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, avviaCorsa } from './gioco.js';

const TOLL = 3; // m: un caso resta lo stesso se si sposta fin qui
const NOMI = {
  stalli_nella_corsia_delle_auto: 'stalli dove passa la corsia delle auto',
  stalli_nell_ingombro_dei_bus: 'stalli nell\'ingombro dei bus automatici lungo le loro corsie e alle fermate',
};

test('sosta lungo le strade: stalli della mappa in scena, fuori dalle corsie di auto e bus', async ({ pagina, gioco }, info) => {
  test.setTimeout(600_000);
  await avviaCorsa(pagina, { linea: '24', modo: 'roam' }); // auto e bus automatici ci sono solo in una corsa
  await pagina.evaluate(() => window.__game.city.loadAll());
  const r = await pagina.evaluate(misuraSosta);
  console.log(`sosta: ${r.stalli} stalli in ${r.file} file su ${r.archi} archi, ${r.auto} auto ferme alle ${r.ora}; ` +
    `corsie strette su ${r.sedi} archi; ${Object.entries(NOMI).map(([k, n]) => `${n}: ${r.casi[k].length}`).join('; ')}`);
  expect(r.stalli, 'la mappa ha gli stalli').toBeGreaterThan(10000);
  expect(r.inScena, 'stalli con le righe in scena, area per area').toBe(r.stalli);
  expect(r.auto, 'auto ferme: gli stalli occupati a quell\'ora').toBe(r.attese);
  expect(r.ostacoli, 'un ostacolo per ogni auto ferma').toBe(r.auto);
  expect(r.auto).toBeGreaterThan(0.5 * r.stalli);
  expect(r.dopo.auto, 'di notte le auto ferme sono di più').toBeGreaterThan(r.auto);
  expect(r.dopo.ostacoli).toBe(r.dopo.auto);

  const fileCasi = info.outputPath('casi.json'), fileEsito = info.outputPath('eccezioni.json');
  writeFileSync(fileCasi, JSON.stringify(Object.fromEntries(Object.keys(NOMI).map((k) => [k, r.casi[k].map((c) => `${c.cosa}, ${c.via} @ ${Math.round(c.x)},${Math.round(c.z)}`)]))));
  const argomenti = ['scripts/eccezioni.py', 'sosta-gioco', fileCasi, '--toll', String(TOLL), '--json', fileEsito, '--comando', '`ECCEZIONI=aggiorna npx playwright test tests/sosta.spec.js`'];
  if (process.env.ECCEZIONI === 'aggiorna') argomenti.push('--aggiorna');
  let diversi = '';
  try {
    execFileSync('python3', argomenti, { encoding: 'utf8' });
  } catch (e) {
    diversi = `${e.stdout || ''}${e.stderr || ''}`;
  }
  const eccezioni = JSON.parse(readFileSync(fileEsito, 'utf8'));
  writeFileSync(info.outputPath('rapporto-sosta.json'), JSON.stringify({ ...r, eccezioni }, null, 1));
  for (const k of Object.keys(NOMI)) {
    expect.soft(eccezioni[k].nuovi, `${NOMI[k]}: casi nuovi, fuori dall'elenco data/eccezioni/sosta-gioco.json\n${diversi}`).toEqual([]);
    expect.soft(eccezioni[k].spariti, `${NOMI[k]}: casi spariti, da togliere dall'elenco data/eccezioni/sosta-gioco.json\n${diversi}`).toEqual([]);
    expect.soft(eccezioni[k].senza_perche, `${NOMI[k]}: casi dell'elenco senza il perché`).toEqual([]);
  }
  expect(gioco.errori()).toEqual([]);
});

// Gira nella pagina: deve bastare a sé stessa (Playwright la passa come testo).
function misuraSosta() {
  const g = window.__game, city = g.city, net = g.net, tondo = (v) => Math.round(v * 10) / 10;
  const posti = [...city.stalliPerArea().values()].flat();
  const conta = () => {
    let inScena = 0, auto = 0, ostacoli = 0;
    for (const A of city.areas.values()) { inScena += A.stalli || 0; auto += A.auto || 0; }
    for (const b of new Set([...city.obstacles.map.values()].flat())) if (b.kind === 'parked' && !b.dead) ostacoli++;
    return { inScena, auto, ostacoli };
  };
  // le undici: le auto di giorno; poi le tre di notte, quando sono di più, e di nuovo le undici per le prove dopo
  city.setSostaOra(11);
  // (la quota è quella dell'ora che la città ha preso: non si rifà per meno di due stalli su cento)
  const giorno = conta(), attese = posti.filter((p) => p.r < city.sostaQuota(city.sostaOra)).length;
  city.setSostaOra(3);
  const dopo = conta();
  city.setSostaOra(11);

  // ogni stallo come l'auto che ci sta: tre cerchi larghi quanto l'auto (1,78 m) lungo i suoi 4,2 m
  const R = 0.89, cerchi = [];
  for (const p of posti) for (const k of [-1.2, 0, 1.2]) cerchi.push({ p, x: p.x + Math.sin(p.h) * k, z: p.z + Math.cos(p.h) * k });
  const casi = { stalli_nella_corsia_delle_auto: [], stalli_nell_ingombro_dei_bus: [] };
  const caso = (k, p, cosa, dentro) => {
    if (p['_' + k]) return;
    p['_' + k] = true;
    casi[k].push({ cosa, via: p.f.e.name || 'via senza nome', x: tondo(p.x), z: tondo(p.z), dentro: tondo(dentro) });
  };

  // corsia delle auto: l'asse che dà Traffic.laneGeom nei versi in cui le auto percorrono l'arco, largo un'auto
  for (const c of cerchi) {
    const e = c.p.f.e, A = net.nodes[e.a], d = (c.x - A.x) * -e.dz + (c.z - A.z) * e.dx; // a destra dell'asse, verso a -> b
    for (const fwd of [true, false]) {
      if (e.psv || (e.oneway && (e.oneway > 0) !== fwd)) continue;
      const q = g.traffic.laneGeom({ edge: e, fwd, s: 0 }), off = (q.rx * -e.dz + q.rz * e.dx);
      const dentro = R + R - Math.abs(d - off);
      if (dentro > 0.05) caso('stalli_nella_corsia_delle_auto', c.p, 'auto', dentro);
    }
  }

  // ingombro dei bus automatici (come in tests/pali.js): la carrozzeria lungo la corsia di ogni variante, 12 m per
  // 2,55; attorno alle fermate anche accostata al marciapiede, da 30 m prima con il muso a 18 m dopo (BusSim.update)
  const HW = 1.275, META = 6, C = 16, celle = new Map(), cella = (x, z) => Math.floor(x / C) + ',' + Math.floor(z / C);
  for (const c of cerchi) { const k = cella(c.x, c.z); (celle.get(k) || celle.set(k, []).get(k)).push(c); }
  for (const L of g.lines) for (const v of L.variants) {
    const lane = g.buses.lane(v), P = lane.P;
    for (let s = 2.6; s < P.len - 3.3; s += 0.5) {
      const f = P.at(s + 3.3), r = P.at(s - 2.6), l = Math.hypot(f.x - r.x, f.z - r.z) || 1, ux = (f.x - r.x) / l, uz = (f.z - r.z) / l;
      const cx = r.x + ux * 2.6, cz = r.z + uz * 2.6, ix = Math.floor(cx / C), iz = Math.floor(cz / C), muso = s + META;
      let extra = 0;
      for (const st of lane.stops) if (muso > st.fs - 30 && muso < st.fs + 18) extra = Math.max(extra, st.extra || 0);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const c of celle.get(ix + a + ',' + (iz + b)) || []) {
        const dx = c.x - cx, dz = c.z - cz, lat = -dx * uz + dz * ux; // a destra di chi guida
        const dentro = Math.min(META + R - Math.abs(dx * ux + dz * uz), lat > 0 ? HW + extra + R - lat : HW + R + lat);
        if (dentro > 0.05) caso('stalli_nell_ingombro_dei_bus', c.p, `linea ${L.id}${extra ? ', fermata' : ''}`, dentro);
      }
    }
  }
  return {
    stalli: posti.length, file: net.stalli.length, archi: new Set(net.stalli.map((f) => f.e)).size, sedi: net.edges.filter((e) => e.sede).length,
    ora: 11, attese, ...giorno, dopo, casi,
  };
}
