// Profilo dei cavalcavia come lo vede chi guida, misurato con la regola di docs/cavalcavia.md: onde, pendenze oltre il
// massimo, raccordi verticali sotto il raggio minimo, binari fuori quota rispetto alla strada sullo stesso impalcato e
// scarti dal DTM. I numeri e le misure sono quelli di scripts/cavalcavia.py, lo stesso che scripts/verifica_mappa.py usa
// sui dati: la prova scrive il terreno "via" del gioco e i binari con le loro quote (TramTrack.h, dopo la media di
// setHeights) in test-results/<prova>/cavalcavia-gioco.json e lo chiama con --gioco. Le strade le prende dalla mappa,
// come il gioco: i loro numeri sono quelli dei dati.
//
// Le soglie sono per caso, non per conteggio (#105): i casi noti stanno in data/eccezioni/cavalcavia.json ("strade",
// uguali nei dati e nel gioco, e "binari gioco"), in gruppi con il perché. Fallisce se lo script trova un caso fuori
// dall'elenco, anche a totale uguale, o se un caso dell'elenco è sparito (va tolto nello stesso commit). Chi cambia le
// quote dei binari o il terreno riscrive l'elenco con `ECCEZIONI=aggiorna npx playwright test cavalcavia` e scrive il
// perché dei casi nuovi che restano. Il rapporto con i casi e i cavalcavia peggiori è allegato al risultato e scritto
// in test-results/<prova>/rapporto-cavalcavia.json.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './gioco.js';

test('cavalcavia secondo la regola del profilo', async ({ pagina, gioco }, info) => {
  const file = info.outputPath('cavalcavia-gioco.json'), rapporto = info.outputPath('rapporto-cavalcavia.json');
  writeFileSync(file, JSON.stringify(await pagina.evaluate(profili)));
  const argomenti = ['scripts/cavalcavia.py', '--gioco', file, '--elenco', '--json', rapporto];
  if (process.env.ECCEZIONI === 'aggiorna') argomenti.push('--aggiorna');
  let testo;
  try {
    testo = execFileSync('python3', argomenti, { encoding: 'utf8' });
  } catch (e) {
    // casi diversi dall'elenco: lo script esce con 1 e li nomina; il rapporto c'è lo stesso, e lo controlla la prova
    testo = `${e.stdout || ''}${e.stderr || ''}`;
  }
  console.log(testo);
  info.annotations.push({ type: 'rapporto', description: testo });
  const r = JSON.parse(readFileSync(rapporto, 'utf8'));
  await info.attach('rapporto-cavalcavia.json', { path: rapporto, contentType: 'application/json' });
  for (const [controllo, e] of Object.entries(r.eccezioni)) {
    expect.soft(e.nuovi, `${controllo}: casi nuovi, fuori dall'elenco data/eccezioni/cavalcavia.json`).toEqual([]);
    expect.soft(e.spariti, `${controllo}: casi spariti, da togliere dall'elenco data/eccezioni/cavalcavia.json`).toEqual([]);
    expect.soft(e.senza_perche, `${controllo}: casi dell'elenco senza il perché`).toEqual([]);
  }
  expect(gioco.errori()).toEqual([]);
});

// Gira nella pagina: deve bastare a sé stessa (Playwright la passa come testo). Terreno e binari del gioco nel formato
// che legge rete_gioco di scripts/cavalcavia.py.
function profili() {
  const g = window.__game, city = g.city, T = g.terrain, r = (v) => Math.round(v * 100) / 100, P = (pts) => pts.map((p) => [r(p.x), r(p.z)]);
  // la variante "via" del terreno, un byte per cella, come la usa il gioco (chiusura e ponti già fatti)
  let bin = '';
  for (let i = 0; i < T.d.length; i += 0x8000) bin += String.fromCharCode.apply(null, T.d.subarray(i, i + 0x8000));
  const terreno = { x0: T.x0, z0: T.z0, step: T.step, nx: T.nx, nz: T.nz, scale: T.scale, offset: T.offset, via: btoa(bin) };
  const binari = Object.values(city.tramTracks).map((t) => ({
    id: t.id,
    paths: { 1: P(t.paths[1].pts), '-1': P(t.paths[-1].pts) },
    // quote dei binari sopra il terreno, ogni 5 m lungo il binario
    quote: { 1: (t.h[1] || []).map(r), '-1': (t.h[-1] || []).map(r) },
    fermate: [1, -1].flatMap((d) => t.stopsDir[d].map((s) => [r(s.x), r(s.z), s.name])),
  }));
  return { terreno, binari };
}
