// Vedute di riferimento: immagini del gioco da punti fissi, a 2,5 m dal piano della strada, confrontate con quelle di
// tests/vedute/riferimenti/. I conteggi dei rapporti non vedono un cavalcavia che torna a onde, una sede del tram che
// sparisce a pezzi o un palo in mezzo alla strada: l'immagine sì. I punti sono in tests/vedute/elenco.json (nome,
// punto, verso in gradi come la direzione del bus, perché è lì): cavalcavia, ponti, capolinea del tram, rotonde e
// incroci con la sede. La scena è ferma e uguale a ogni lancio (preparaVedute in tests/vedute.js): esplorazione,
// sereno, luce delle 11, niente traffico né pedoni, semafori allo stesso ciclo, tutta la mappa caricata.
//
// Chi cambia una veduta di proposito aggiorna il riferimento nello stesso commit:
//   npx playwright test vedute --update-snapshots
// riscrive solo le immagini cambiate, e `git status` dice quali. Se la prova fallisce, in test-results/ ci sono per
// ogni veduta diversa l'immagine nuova, quella di riferimento e le differenze (in CI nell'artefatto risultati-prove).
// Come si aggiunge una veduta e cosa guardare prima di aggiornare: docs/LAVORO.md, nota "Vedute di riferimento".
import { readFileSync } from 'node:fs';
import { test, expect } from './gioco.js';
import { preparaVedute, scattaVeduta, finisciVedute } from './vedute.js';

const ELENCO = JSON.parse(readFileSync(new URL('./vedute/elenco.json', import.meta.url), 'utf8'));
const ORA = 11;
// Sulla stessa macchina due lanci danno immagini identiche, anche dopo altre prove sulla stessa pagina. Tra macOS e
// Linux (SwiftShader su processori diversi) i colori cambiano di poco su molti pixel, i fili e i bordi sottili cadono
// su pixel vicini e i cartelli col testo usano un altro font: un pixel conta come diverso oltre la soglia 0,2 di
// pixelmatch, e se ne ammettono 40 su 230.400. Il 13 novembre 2026, con i riferimenti fatti su macOS, la veduta peggiore
// su Linux ne aveva 4 (amd64, come in CI; con la soglia 0,1 erano 73); un cavalcavia alzato di 0,5 m ne cambia più di
// 600 in ogni veduta che lo inquadra, una lanterna del tram rimessa in carreggiata 1900.
const TOLLERANZA = { threshold: 0.2, maxDiffPixels: 40 };

test('vedute di riferimento', async ({ pagina, gioco }) => {
  test.setTimeout(600_000);
  expect(new Set(ELENCO.map((v) => v.nome)).size, 'nomi delle vedute tutti diversi').toBe(ELENCO.length);
  const prima = await pagina.evaluate(preparaVedute, { ora: ORA });
  try {
    for (const v of ELENCO) {
      const f = await pagina.evaluate(scattaVeduta, v);
      expect([f.larga, f.alta], 'grandezza del disegno').toEqual([1280, 720]);
      expect.soft(Buffer.from(f.png, 'base64'), `${v.nome} (${v.x}, ${v.z}): ${v.perche}`).toMatchSnapshot(`${v.nome}.png`, TOLLERANZA);
    }
  } finally {
    await pagina.evaluate(finisciVedute, prima);
  }
  expect(gioco.errori()).toEqual([]);
});
