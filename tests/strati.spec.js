// Strati da vicino e da lontano (#110, meccanismo 2 degli elementi che spariscono). Asfalto, sede del tram, marciapiedi,
// isole e segni stanno sullo stesso piano e si ordinano con polygonOffset (layer() in src/world/city.js) su una
// profondità da 0,35 a 7000 m: dove due strati si sovrappongono in pianta, chi si vede cambia con la distanza. La prova
// guarda il punto di ogni veduta di riferimento (tests/vedute/elenco.json) da 20 m e da 300 m lungo la stessa linea di
// vista, 35 gradi sotto l'orizzonte, con le telecamere del gioco, e confronta punto per punto lo strato che si vede
// (tests/strati.js). Un punto conta se da vicino non è su un bordo e se la quota è la stessa nelle due viste.
//
// Uno strato è il numero d'ordine dato a layer(): 1 marciapiedi e sponde, 1.5 giunti degli incroci, 2 carreggiate e
// acqua, 3 incroci, asfalto in quota e cordoli, 4 righe e segni, 4.2 massicciata, 4.5, 5 e 5.5 sede del tram (5 anche
// dossi, frecce e scritte), 6 rotaie e cordoli della sede, 7 linee d'arresto del tram, 8 isole; "verde" sono prati e
// aiuole delle aree, "fondo" il prato sotto a tutto.
//
// Soglie per caso (#105): un caso è una veduta con una coppia (strato da vicino, strato da lontano) su almeno CASO
// punti, circa 3 m² di strada; i casi noti stanno in data/eccezioni/strati.json con il perché. Un caso dell'elenco
// resta finché ha almeno RESTA punti: tra una macchina e l'altra i punti sul margine cambiano di qualcuno. L'elenco si
// riscrive con `ECCEZIONI=aggiorna npx playwright test tests/strati.spec.js`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './gioco.js';
import { preparaVedute, finisciVedute } from './vedute.js';
import { preparaStrati, confrontaStrati, finisciStrati } from './strati.js';

const ELENCO = JSON.parse(readFileSync(new URL('./vedute/elenco.json', import.meta.url), 'utf8'));
const NOTI = new Set(JSON.parse(readFileSync(new URL('../data/eccezioni/strati.json', import.meta.url), 'utf8')).controlli.strati_diversi_da_lontano.flatMap((g) => g.casi));
const VISTA = { giu: 35, vicino: 20, lontano: 300, raggio: 12, dy: 0.5 };
const CASO = 8, RESTA = 3;

test('strati da 20 m e da 300 m: nei punti delle vedute si vede lo stesso strato', async ({ pagina, gioco }, info) => {
  test.setTimeout(600_000);
  const prima = await pagina.evaluate(preparaVedute, { ora: 11 });
  const vedute = [];
  let strati;
  try {
    strati = await pagina.evaluate(preparaStrati);
    for (const v of ELENCO) vedute.push({ nome: v.nome, x: v.x, z: v.z, ...(await pagina.evaluate(confrontaStrati, { x: v.x, z: v.z, verso: v.verso, ...VISTA })) });
  } finally {
    await pagina.evaluate(finisciStrati);
    await pagina.evaluate(finisciVedute, prima);
  }
  const casi = [];
  for (const v of vedute) for (const [coppia, c] of Object.entries(v.coppie)) {
    const chiave = `${v.nome}: ${coppia} @ ${Math.round(v.x)},${Math.round(v.z)}`;
    if (c.punti >= CASO || (c.punti >= RESTA && NOTI.has(chiave))) casi.push(chiave);
  }
  const fileCasi = info.outputPath('casi.json'), fileEsito = info.outputPath('eccezioni.json');
  writeFileSync(fileCasi, JSON.stringify({ strati_diversi_da_lontano: casi }));
  const argomenti = ['scripts/eccezioni.py', 'strati', fileCasi, '--json', fileEsito, '--comando', '`ECCEZIONI=aggiorna npx playwright test tests/strati.spec.js`'];
  if (process.env.ECCEZIONI === 'aggiorna') argomenti.push('--aggiorna');
  let diversi = '';
  try {
    execFileSync('python3', argomenti, { encoding: 'utf8' });
  } catch (e) {
    diversi = `${e.stdout || ''}${e.stderr || ''}`;
  }
  const esito = JSON.parse(readFileSync(fileEsito, 'utf8')).strati_diversi_da_lontano;
  const somma = (k) => vedute.reduce((s, v) => s + v[k], 0);
  const righe = [
    `${vedute.length} vedute, ${strati.length} strati, ${somma('provati')} punti: ${somma('uguali')} uguali, ${somma('bordo')} su un bordo, ${somma('altraQuota')} ad altra quota, ${somma('stessoNumero')} tra strati con lo stesso numero, ${somma('fuoriVista')} fuori dalla vista vicina`,
    ...vedute.flatMap((v) => Object.entries(v.coppie).filter(([, c]) => c.punti >= RESTA).map(([coppia, c]) => `${v.nome}: ${coppia}, ${c.punti} punti attorno a (${c.x}, ${c.z})`)),
    ...(diversi ? [diversi] : []),
  ];
  const json = JSON.stringify({ vista: VISTA, strati, casi, esito, vedute }, null, 1);
  writeFileSync(info.outputPath('rapporto-strati.json'), json);
  await info.attach('rapporto-strati.json', { body: json, contentType: 'application/json' });
  console.log(['Strati da 20 m e da 300 m', ...righe.map((s) => '  ' + s)].join('\n'));
  // la prova guarda davvero: ogni veduta ha centinaia di punti confrontati
  for (const v of vedute) expect.soft(v.uguali, `${v.nome}: punti confrontati`).toBeGreaterThan(300);
  expect.soft(esito.nuovi, `casi nuovi, fuori dall'elenco data/eccezioni/strati.json\n${diversi}`).toEqual([]);
  expect.soft(esito.spariti, `casi spariti, da togliere dall'elenco data/eccezioni/strati.json\n${diversi}`).toEqual([]);
  expect.soft(esito.senza_perche, 'casi dell\'elenco senza il perché').toEqual([]);
  expect(gioco.errori()).toEqual([]);
});
