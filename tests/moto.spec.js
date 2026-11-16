// Prova del moto (#113): auto e bus automatici seguono la strada come mezzi veri, senza andare di traverso, saltare,
// girare più stretti del loro raggio minimo o fare inversione sullo stesso arco. Le regole sono in tests/moto.js.
// La corsa è la 3 delle 8:15 di un giorno feriale (il traffico dell'ora di punta), sempre la stessa (#122); il giocatore
// sta fermo in tre zone, 200 s di gioco in ognuna: 10 minuti in tutto. I casi si confrontano uno per uno con l'elenco
// data/eccezioni/moto.json (scripts/eccezioni.py): un caso nuovo fa fallire la prova anche se il totale non sale.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, avviaCorsa, tempoMassimo } from './gioco.js';
import { osservaMoto, giraZone, ZONE } from './moto.js';

const CONTROLLI = { traverso: 'di_traverso', salto: 'salti', imbardata: 'imbardata', inversione: 'inversioni' };

// i casi di ogni controllo contro l'elenco: nuovi, spariti, senza il perché
function controEccezioni(info, casi, toll = 3) {
  const fileCasi = info.outputPath('casi.json'), fileEsito = info.outputPath('eccezioni.json');
  writeFileSync(fileCasi, JSON.stringify(casi));
  const argomenti = ['scripts/eccezioni.py', 'moto', fileCasi, '--toll', String(toll), '--json', fileEsito, '--comando', '`ECCEZIONI=aggiorna npx playwright test tests/moto.spec.js`'];
  if (process.env.ECCEZIONI === 'aggiorna') argomenti.push('--aggiorna');
  let diversi = '';
  try { execFileSync('python3', argomenti, { encoding: 'utf8' }); } catch (e) { diversi = `${e.stdout || ''}${e.stderr || ''}`; }
  return { esiti: JSON.parse(readFileSync(fileEsito, 'utf8')), diversi };
}

test('moto di auto e bus automatici: mai di traverso, senza salti, imbardata entro il raggio minimo, senza inversioni', async ({ pagina, gioco }, info) => {
  tempoMassimo(300);
  await avviaCorsa(pagina, { linea: '3' });
  await pagina.evaluate(osservaMoto, {});
  const r = await pagina.evaluate(giraZone, { zone: ZONE, sec: 200 });
  const casi = Object.fromEntries(Object.values(CONTROLLI).map((c) => [c, []]));
  for (const c of r.casi) casi[CONTROLLI[c.tipo]].push(c.chiave);
  console.log(`moto: ${r.mezzi} passi di mezzi, ${r.km} km; casi ${JSON.stringify(r.conti)}; peggio ${JSON.stringify(r.peggio)}`);
  writeFileSync(info.outputPath('moto.json'), JSON.stringify(r, null, 1));
  const { esiti, diversi } = controEccezioni(info, casi);
  expect(r.mezzi, 'passi di mezzi guardati').toBeGreaterThan(100000);
  for (const [k, e] of Object.entries(esiti)) {
    expect.soft(e.nuovi, `${k}: casi fuori dall'elenco data/eccezioni/moto.json\n${diversi}`).toEqual([]);
    expect.soft(e.spariti, `${k}: casi spariti, da togliere dall'elenco data/eccezioni/moto.json`).toEqual([]);
    expect.soft(e.senza_perche, `${k}: casi dell'elenco senza il perché`).toEqual([]);
  }
  expect(gioco.errori()).toEqual([]);
});
