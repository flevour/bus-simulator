// Arredo posato dalla build (#109): semafori e ripetitrici, tiranti, mensole e pali della linea aerea, lanterne del
// tram, segnali degli scambi, cartelli del pantografo e paline stanno in src/data/padova-arredo.json, scritti da
// scripts/posa_arredo.mjs (npm run posa) con il posatore di src/world/posa.js. Due prove:
//  * la posa è quella del file: rifatta sulla mappa del commit dà le stesse righe. Una modifica alla mappa o al
//    posatore che sposta un palo senza riscrivere il file fallisce qui e dice quali elementi cambiano; chi riscrive
//    il file dichiara la zona (npm run posa -- --zona X,Z,R) e lo script si rifiuta se cambia qualcosa fuori;
//  * il gioco disegna quello che legge: ha consumato tutti gli elementi del file, i suoi pali stanno dove dice il
//    file, e non ha con sé il posatore (né City.poleSpot, la ricerca di prima).
// Che i pali stiano fuori dalla sagoma del tram, dall'asfalto e dall'ingombro dei bus lo dice tests/mappa.spec.js
// (tests/pali.js), con i casi noti in data/eccezioni/mappa-gioco.json.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test as base, expect as baseExpect } from '@playwright/test';
import { test, expect } from './gioco.js';

const FILE = 'src/data/padova-arredo.json';

base('arredo: la posa è quella scritta nel repository', async () => {
  base.setTimeout(180_000);
  const r = spawnSync('node', ['scripts/posa_arredo.mjs', '--controlla'], { encoding: 'utf8' });
  baseExpect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
});

test('arredo: il gioco disegna quello che legge dal file', async ({ pagina, gioco }) => {
  const F = JSON.parse(readFileSync(FILE, 'utf8'));
  const r = await pagina.evaluate((F) => {
    const g = window.__game, city = g.city, cm = (v) => Math.round(v * 100);
    const chiave = (x, z) => cm(x) + ',' + cm(z);
    // i posti del file, per tipo: un elemento del gioco deve stare su uno di questi
    const posti = { semafori: new Set(), lineaAerea: new Set(), lanterne: new Set(), pantografi: new Set(), scambi: new Set(), paline: new Set() };
    let paliSemafori = 0, paliLinea = 0, paliLanterne = 0;
    for (const a of F.semafori) {
      if (Math.abs(a[7]) === 1) { posti.semafori.add(chiave(a[5], a[6])); paliSemafori++; }
      if (a.length > 9 && a[11] === 1) { posti.semafori.add(chiave(a[9], a[10])); paliSemafori++; }
    }
    for (const a of F.lineaAerea) {
      if (a[8]) { posti.lineaAerea.add(chiave(a[6], a[7])); paliLinea++; }
      if (a[11]) { posti.lineaAerea.add(chiave(a[9], a[10])); paliLinea++; }
      if (a[12]) { posti.lineaAerea.add(chiave(a[0], a[1])); paliLinea++; }
    }
    for (const a of F.lanterne) if (!a[2]) { posti.lanterne.add(chiave(a[3], a[4])); paliLanterne++; }
    for (const a of F.pantografi) posti.pantografi.add(chiave(a[2], a[3]));
    for (const a of F.scambi) if (a.length > 2) posti.scambi.add(chiave(a[2], a[3]));
    for (const a of F.paline) posti.paline.add(chiave(a[0], a[1]));
    const fuori = [], conta = {};
    const guarda = (tipo, x, z) => { conta[tipo] = (conta[tipo] || 0) + 1; if (!posti[tipo].has(chiave(x, z))) fuori.push(`${tipo} (${x.toFixed(2)}, ${z.toFixed(2)})`); };
    for (const ap of g.lights.byKey.values()) for (const p of ap.poles) guarda('semafori', p.x, p.z);
    for (const p of city.tramPoles) guarda('lineaAerea', p.x, p.z);
    for (const hd of g.tramSignals.heads) if (hd.pole) guarda('lanterne', hd.pole.x, hd.pole.z);
    for (const p of city.panSigns) guarda('pantografi', p.x, p.z);
    for (const p of city.stopPlacements) guarda('paline', p.x, p.z);
    // i segnali degli scambi che il file ha spostato
    const sig = [];
    for (const j of city.tramNet.nodes) sig.push(j.panel.sig);
    for (const Y of city.tramYards) { for (const sw of Y.switches.values()) sig.push(sw.panel.sig); for (const pt of Y.ports) if (pt.panel) sig.push(pt.panel.sig); }
    const scambi = sig.filter((s) => posti.scambi.has(chiave(s.x, s.z))).length;
    return {
      letti: city.arredo.letti, conta, fuori, scambi,
      attesi: { semafori: paliSemafori, lineaAerea: paliLinea, lanterne: paliLanterne, pantografi: F.pantografi.length, paline: F.paline.length },
      segnali: sig.length, tiranti: city.tramSpans.length,
      ricerca: [typeof city.arredo.palo, typeof city.arredo.spazio, typeof city.poleSpot],
    };
  }, F);
  console.log(`letti dal file: ${Object.entries(r.letti).map(([t, n]) => `${t} ${n}`).join(', ')}; pali nel gioco: ${Object.entries(r.conta).map(([t, n]) => `${t} ${n}`).join(', ')}; tiranti ${r.tiranti}`);
  // gli elenchi letti uno alla volta sono stati letti fino in fondo (linea aerea e paline si leggono intere)
  for (const t of ['semafori', 'scambi', 'pantografi', 'lanterne']) expect(r.letti[t], `${t} letti dal file`).toBe(F[t].length);
  expect(r.tiranti, 'tiranti della linea aerea').toBe(F.lineaAerea.length);
  expect(r.segnali, 'segnali degli scambi').toBe(F.scambi.length);
  expect(r.scambi, 'segnali degli scambi nel posto del file').toBe(F.scambi.filter((a) => a.length > 2).length);
  expect(r.fuori, 'pali del gioco che non stanno dove dice il file').toEqual([]);
  expect(r.conta, 'pali del gioco, per tipo').toEqual(r.attesi);
  expect(r.ricerca, 'il gioco non ha il posatore né la ricerca del posto dei pali').toEqual(['undefined', 'undefined', 'undefined']);
  expect(gioco.errori()).toEqual([]);
});
