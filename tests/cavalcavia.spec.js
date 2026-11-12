// Profilo dei cavalcavia come lo vede chi guida, misurato con la regola di docs/cavalcavia.md: onde, pendenze oltre il
// massimo, raccordi verticali sotto il raggio minimo, binari fuori quota rispetto alla strada sullo stesso impalcato e
// scarti dal DTM. I numeri e le misure sono quelli di scripts/cavalcavia.py, lo stesso che scripts/verifica_mappa.py usa
// sui dati: la prova scrive il terreno "via" del gioco e i binari con le loro quote (TramTrack.h, dopo la media di
// setHeights) in test-results/<prova>/cavalcavia-gioco.json e lo chiama con --gioco. Le strade le prende dalla mappa,
// come il gioco: i loro numeri sono quelli dei dati.
//
// Fallisce se un numero supera la sua soglia (valori del 12 novembre 2026). Se un numero scende, si abbassa la soglia
// nello stesso commit. Il rapporto con i casi e i cavalcavia peggiori è allegato al risultato e scritto in
// test-results/<prova>/rapporto-cavalcavia.json.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './gioco.js';

// Prima che i cavalcavia seguano la regola (#84). Binari: la media di setHeights sulle rampe di Chiesanuova, San Marco
// e Borgomagno (#74)
const SOGLIE = {
  strade: { onde: 113, pendenze: 228, raccordi: 484, scarti_dtm: 221 },
  binari: { onde: 18, pendenze: 32, raccordi: 13, fuori_quota: 25 },
};

test('cavalcavia secondo la regola del profilo', async ({ pagina, gioco }, info) => {
  const file = info.outputPath('cavalcavia-gioco.json'), soglie = info.outputPath('soglie.json'), rapporto = info.outputPath('rapporto-cavalcavia.json');
  writeFileSync(file, JSON.stringify(await pagina.evaluate(profili)));
  writeFileSync(soglie, JSON.stringify(SOGLIE));
  let testo;
  try {
    testo = execFileSync('python3', ['scripts/cavalcavia.py', '--gioco', file, '--soglie', soglie, '--elenco', '--json', rapporto], { encoding: 'utf8' });
  } catch (e) {
    // sopra le soglie lo script esce con 1: il rapporto c'è lo stesso, e le soglie le controlla la prova qui sotto
    testo = `${e.stdout || ''}${e.stderr || ''}`;
  }
  console.log(testo);
  info.annotations.push({ type: 'rapporto', description: testo });
  const r = JSON.parse(readFileSync(rapporto, 'utf8'));
  await info.attach('rapporto-cavalcavia.json', { path: rapporto, contentType: 'application/json' });
  for (const [su, v] of Object.entries(SOGLIE)) for (const [tipo, s] of Object.entries(v)) expect.soft(r.valori[su][tipo], `${tipo} ${su}`).toBeLessThanOrEqual(s);
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
