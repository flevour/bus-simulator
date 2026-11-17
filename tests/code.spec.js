// Code vere (#115): chi segue chi, quanto passa da una corsia e da un semaforo, e niente sblocchi a tempo. Le regole e
// le misure sono in tests/code.js; la corsa è la 3 delle 8:15 di un giorno feriale, sempre la stessa (#122).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, avviaCorsa, tempoMassimo } from './gioco.js';
import { osservaCode, giraZoneCode, corridoio, livello, scarico, incrocio, SCATOLA } from './code.js';
import { ZONE } from './moto.js';

const QUERINI = { sx: -190, sz: -4910, nome: 'Via Querini' };

// Il corridoio di Via Querini, una corsia per verso, senza incroci per 1,1 km fino al semaforo; le auto vanno a 9 m/s
// (una via del quartiere). Flusso contro densità: con un'auto in ingresso ogni 6 s e ogni 3 s il flusso è quello che
// entra, quasi alla velocità voluta (il ramo libero, flusso = densità per velocità); ogni 2,2 s la corsia si riempie e
// il flusso sale ancora. La coda ferma al rosso ha 2 m tra muso e coda (156 auto per km, flusso zero), e al verde si
// scarica a circa un'auto ogni 2 s (dal quarto in poi: i primi partono da fermi), cioè circa 1.800 auto l'ora di verde
// (Highway Capacity Manual; con l'IDM di Treiber e le auto a 9 m/s, 2,2 s e 1.650 l'ora): è quello che la corsia
// porta. Su main del 17 novembre (461b4ce) la corsia portava al più 900 auto l'ora (37,5 auto per km a 6,6 m/s, da
// un'auto ogni 3 s in su) e al verde passava un'auto ogni 3,79 s (8 nei primi 30 s di verde)
test('corridoio di Via Querini: flusso contro densità e scarico al semaforo', async ({ pagina, gioco }) => {
  tempoMassimo(300);
  await avviaCorsa(pagina, { linea: '3' });
  const cor = await pagina.evaluate(corridoio, QUERINI);
  expect(cor.lungo, `corridoio: ${JSON.stringify(cor)}`).toBeGreaterThan(1000);
  expect(cor.giocatore).toBeGreaterThan(120);
  const livelli = [];
  for (const h of [6, 3, 2.2]) livelli.push(await pagina.evaluate(livello, { h, sec: 150 }));
  const sc = await pagina.evaluate(scarico, {});
  const t = sc.tempi, teste = t.slice(4).map((x, i) => x - t[i + 3]), testa = teste.reduce((a, b) => a + b, 0) / teste.length;
  console.log(`corridoio ${JSON.stringify(cor)}\nlivelli ${JSON.stringify(livelli)}\nscarico ${JSON.stringify(sc)}: un'auto ogni ${testa.toFixed(2)} s, ${Math.round(3600 / testa)} l'ora di verde`);
  const leggi = `livelli ${JSON.stringify(livelli)}`;
  // ramo libero: passano tutte quelle che entrano (600 e 1.200 l'ora), quasi alla velocità voluta
  expect(livelli[0].flusso, leggi).toBeGreaterThanOrEqual(570);
  expect(livelli[1].flusso, leggi).toBeGreaterThanOrEqual(1140);
  for (const l of livelli.slice(0, 2)) expect(l.v, leggi).toBeGreaterThan(8);
  // più fitte, il flusso sale ancora: la corsia non si ferma prima della sua capacità
  expect(livelli[2].flusso, leggi).toBeGreaterThan(livelli[1].flusso + 100);
  // coda ferma: 2 m tra muso e coda
  expect(sc.passo, `scarico ${JSON.stringify(sc)}`).toBeGreaterThan(6.2);
  expect(sc.passo).toBeLessThan(6.8);
  // scarico al verde: tutte passano, e dal quarto in poi una ogni 1,8-2,4 s (1.500-2.000 l'ora di verde)
  expect(t.every((x) => x != null), `scarico ${JSON.stringify(sc)}`).toBe(true);
  expect(testa, `scarico ${JSON.stringify(sc)}`).toBeGreaterThan(1.8);
  expect(testa).toBeLessThan(2.4);
  expect(gioco.errori()).toEqual([]);
});

// Una coda non entra in un incrocio che non può liberare. In fondo al corridoio, col verde, un'auto ferma 30 m oltre il
// nodo dell'incrocio con Via Ca' Panosso (l'incrocio è il raccordo della build, 18 m) e cinque auto che arrivano: c'è
// posto oltre l'incrocio per due, le altre si fermano prima e nessuna resta ferma dentro. Su main del 17 novembre
// (461b4ce), con l'auto ferma a 14 m dal nodo, quattro auto restavano ferme insieme dentro l'incrocio
test('una coda non entra in un incrocio che non può liberare', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '3' });
  await pagina.evaluate(corridoio, QUERINI);
  const r = await pagina.evaluate(incrocio, { ferma: 30, scatola: SCATOLA });
  console.log(`incrocio ${JSON.stringify(r)}`);
  expect(r.insieme, `auto ferme dentro l'incrocio: ${JSON.stringify(r)}`).toBe(0);
  expect(r.oltre, 'auto oltre l\'incrocio, dietro a quella ferma').toBe(2);
  expect(r.ferme, 'auto ferme in coda').toBe(5);
  expect(gioco.errori()).toEqual([]);
});

// i casi di ogni controllo contro l'elenco data/eccezioni/code.json (scripts/eccezioni.py): nuovi, spariti, senza perché
function controEccezioni(info, casi, toll = 3) {
  const fileCasi = info.outputPath('casi.json'), fileEsito = info.outputPath('eccezioni.json');
  writeFileSync(fileCasi, JSON.stringify(casi));
  const argomenti = ['scripts/eccezioni.py', 'code', fileCasi, '--toll', String(toll), '--json', fileEsito, '--comando', '`ECCEZIONI=aggiorna npx playwright test tests/code.spec.js`'];
  if (process.env.ECCEZIONI === 'aggiorna') argomenti.push('--aggiorna');
  let diversi = '';
  try { execFileSync('python3', argomenti, { encoding: 'utf8' }); } catch (e) { diversi = `${e.stdout || ''}${e.stderr || ''}`; }
  return { esiti: JSON.parse(readFileSync(fileEsito, 'utf8')), diversi };
}

const CONTROLLI = {
  'auto sparita sui binari': 'sblocchi',
  'auto sparita davanti al tram': 'sblocchi',
  'auto sparita davanti a un bus': 'sblocchi',
  'tram attraverso un bus': 'sblocchi',
  'bus attraverso un bus': 'sblocchi',
  'auto sorpassa un bus in coda': 'sblocchi',
  'giro di attese': 'giri_di_attese',
  'auto e tram che si aspettano': 'giri_di_attese',
  'auto e bus che si aspettano': 'giri_di_attese',
  'tram e bus che si aspettano': 'giri_di_attese',
  'auto in coda nell\'incrocio': 'incroci_bloccati',
  'auto fermo oltre 120 s': 'fermi',
  'bus fermo oltre 120 s': 'fermi',
  'tram fermo oltre 120 s': 'fermi',
};

// Dieci minuti nelle tre zone della prova del moto, con le 72 auto delle 8:15: gli sblocchi a tempo non scattano, non
// si formano giri di attese, nessuna auto resta ferma in coda dentro un incrocio e nessuno resta fermo oltre 120 s
// (fuori dalle fermate). Un caso per posto, confrontato con data/eccezioni/code.json. Su main del 17 novembre
// (461b4ce): 4 auto sparite davanti al tram, 5 bus in coda sorpassati dopo 12 s e 8 auto ferme in coda dentro un
// incrocio, in 7 posti
test('dieci minuti di traffico: niente sblocchi a tempo, incroci liberi, nessuno fermo oltre 120 s', async ({ pagina, gioco }, info) => {
  tempoMassimo(300);
  await avviaCorsa(pagina, { linea: '3' });
  await pagina.evaluate(osservaCode, { fermo: 120, scatola: SCATOLA });
  const r = await pagina.evaluate(giraZoneCode, { zone: ZONE, sec: 200 });
  const casi = Object.fromEntries([...new Set(Object.values(CONTROLLI))].map((c) => [c, []])), posti = [];
  for (const c of r.casi) {
    const [fissa, posto] = c.chiave.split(' @ '), [x, z] = posto.split(',').map(Number);
    if (posti.some((p) => p.fissa === fissa && Math.hypot(p.x - x, p.z - z) <= 3)) continue;
    posti.push({ fissa, x, z });
    casi[CONTROLLI[c.tipo]].push(c.chiave);
  }
  console.log(`code: ${JSON.stringify(r.conti)} in ${posti.length} posti; per passo traffic.update ${r.tempi.traffico.toFixed(3)} ms con ${r.tempi.auto.toFixed(1)} auto, buses.update ${r.tempi.bus.toFixed(3)} ms`);
  writeFileSync(info.outputPath('code.json'), JSON.stringify(r, null, 1));
  const { esiti, diversi } = controEccezioni(info, casi);
  for (const [k, e] of Object.entries(esiti)) {
    expect.soft(e.nuovi, `${k}: casi fuori dall'elenco data/eccezioni/code.json\n${diversi}`).toEqual([]);
    expect.soft(e.spariti, `${k}: casi spariti, da togliere dall'elenco data/eccezioni/code.json`).toEqual([]);
    expect.soft(e.senza_perche, `${k}: casi dell'elenco senza il perché`).toEqual([]);
  }
  expect(r.tempi.passi, 'passi guardati').toBeGreaterThan(17000);
  expect(gioco.errori()).toEqual([]);
});
