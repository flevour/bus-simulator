// Impronta del traffico (#145). Le prove del traffico (traffico.spec, code.spec, moto.spec) confrontano i casi di
// dieci minuti di gioco con elenchi scritti sul Mac e giudicati in CI su Linux: valgono solo se la stessa corsa va allo
// stesso modo sulle due macchine e qualunque prova abbia usato la pagina prima. Questa prova lo controlla da sola, ai
// bit: la corsa della 3 delle 8:15, un minuto in ognuna delle tre zone della prova del moto, un'impronta dello stato di
// auto, bus, tram e chi guida ogni 10 s (tests/impronta.js), confrontata con quella scritta in tests/impronta.json.
//
// Chi cambia di proposito il traffico, i bus o i tram automatici, la mappa o le linee cambia l'impronta: la riscrive
// nello stesso commit con `IMPRONTA=aggiorna npx playwright test tests/impronta.spec.js`, e la serie in CI dice se su
// Linux è la stessa. Se in CI l'impronta è diversa da quella scritta sul Mac (o dopo un'altra corsa è diversa da quella
// di prima), l'esito del traffico dipende dalla macchina o dalla storia della pagina: la riga che cambia per prima dice
// in quale zona e dopo quanti secondi, e la causa va trovata, non scritta in un elenco (docs/LAVORO.md, nota #145).
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, avviaCorsa, tempoMassimo } from './gioco.js';
import { improntaTraffico } from './impronta.js';
import { ZONE } from './moto.js';

const FILE = 'tests/impronta.json';

test('impronta del traffico: la stessa corsa dà lo stesso stato su ogni macchina e dopo altre corse', async ({ pagina, gioco }) => {
  tempoMassimo(120);
  await avviaCorsa(pagina, { linea: '3' });
  const prima = await pagina.evaluate(improntaTraffico, { zone: ZONE, sec: 60 });
  // un'altra corsa sulla stessa pagina, con il suo traffico: un tram del SIR1 per un minuto
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true });
  await pagina.evaluate(() => window.__game.sim(60, 1 / 30, false));
  await avviaCorsa(pagina, { linea: '3' });
  const dopo = await pagina.evaluate(improntaTraffico, { zone: ZONE, sec: 60 });
  // la prima riga diversa: "stazione 30 s 1a2b3c4d invece di stazione 30 s 5e6f7a8b"
  const primaDiversa = (a, b) => { const i = a.findIndex((x, k) => x !== b[k]); return i < 0 ? '(nessuna)' : `${a[i]} invece di ${b[i]}`; };
  expect(dopo, `dopo un'altra corsa sulla stessa pagina la corsa va diversamente: ${primaDiversa(dopo, prima)}`).toEqual(prima);
  if (process.env.IMPRONTA === 'aggiorna') {
    writeFileSync(FILE, `${JSON.stringify({ corsa: 'linea 3 delle 8:15, feriale, sereno; 60 s in ognuna delle zone di tests/moto.js', impronta: prima }, null, 1)}\n`);
    return;
  }
  const scritta = JSON.parse(readFileSync(FILE, 'utf8')).impronta;
  expect(prima, `il traffico va diversamente da quello di ${FILE}: ${primaDiversa(prima, scritta)}. Se è voluto, IMPRONTA=aggiorna npx playwright test tests/impronta.spec.js; se cambia solo in CI, l'esito dipende dalla macchina`).toEqual(scritta);
  expect(gioco.errori()).toEqual([]);
});
