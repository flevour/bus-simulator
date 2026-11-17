// Posa dell'arredo nella build (#109): semafori e ripetitrici, tiranti, mensole e pali della linea aerea, lanterne del
// tram, segnali degli scambi, cartelli del pantografo e paline, messi una volta nello spazio libero della mappa e
// scritti in src/data/padova-arredo.json, un elemento per riga. Il gioco li legge da lì (src/data/arredo.js).
//
// Costruisce la città con i moduli del gioco, in Node e senza disegnare: i binari sono quelli che il gioco ricava dai
// dati (TramTrack, TramYard, TramNet), la pianta delle strade quella della mappa, gli edifici tutti quelli delle aree.
// Al posto del lettore dell'arredo la città riceve il posatore (src/world/posa.js), che ha gli stessi metodi.
//
//   npm run posa                          # rifà la posa e la confronta con il file: se non cambia niente finisce qui
//   npm run posa -- --zona X,Z,R          # riscrive il file se cambiano solo elementi entro R metri da (X, Z);
//                                         # --zona si può ripetere
//   npm run posa -- --tutta               # riscrive il file comunque (posatore cambiato, mappa rifatta da capo)
//   npm run posa -- --controlla           # non scrive: errore se la posa non è quella del file (tests/arredo.spec.js)
//   npm run posa -- --localita --mappa <rete>.json
//                                         # prova della località (#139): posa sulla mappa rigenerata con i cambi di
//                                         # data/localita.json (scripts/rigenera_mappa.py --localita --uscita); non
//                                         # scrive, e le righe cambiate oltre il raggio dei cambi sono casi contro
//                                         # data/eccezioni/localita.json (controllo "posa"; --aggiorna lo riscrive)
//
// Chi cambia la mappa in un posto dichiara la zona: se si spostano elementi fuori lo script li elenca e non scrive.
// Dopo una rigenerazione della mappa (scripts/rigenera_mappa.sh) la posa va rifatta nello stesso commit.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { costruisci } from './citta_node.mjs';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mappa = args.includes('--mappa') ? args[args.indexOf('--mappa') + 1] : null;
const posa = async () => (await costruisci(null, { mappa })).posatore.dati;
const FILE = join(radice, 'src/data/padova-arredo.json');
const controlla = args.includes('--controlla'), tutta = args.includes('--tutta'), localita = args.includes('--localita');
const zone = args.flatMap((a, i) => (a === '--zona' ? [String(args[i + 1]).split(',').map(Number)] : []));
if (localita && !mappa) { console.error('--localita vuole --mappa <rete>.json: la mappa rigenerata con i cambi di data/localita.json'); process.exit(2); }
if (zone.some((z) => z.length !== 3 || z.some((v) => !Number.isFinite(v)))) { console.error('--zona X,Z,R (metri, coordinate del gioco)'); process.exit(2); }

// un elemento per riga: il diff di git dice quali si sono spostati
const righe = (dati) => Object.fromEntries(Object.entries(dati).map(([t, l]) => [t, l.map((a) => JSON.stringify(a))]));
const testo = (R) => '{\n' + Object.entries(R).map(([t, l]) => `"${t}":[\n${l.join(',\n')}\n]`).join(',\n') + '\n}\n';
const leggi = () => (existsSync(FILE) ? righe(JSON.parse(readFileSync(FILE, 'utf8'))) : null);

const t0 = Date.now();
const nuove = righe(await posa()), vecchie = leggi();
const conto = Object.entries(nuove).map(([t, l]) => `${t} ${l.length}`).join(', ');
console.log(`posa in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${conto}`);
if (!vecchie) {
  if (controlla) { console.error(`manca ${FILE}`); process.exit(1); }
  writeFileSync(FILE, testo(nuove));
  console.log(`scritto ${FILE}`);
  process.exit(0);
}
if (testo(nuove) === testo(vecchie)) { console.log('la posa è quella del file'); process.exit(0); }
// elementi cambiati, per tipo: le righe che ci sono da una parte sola (uno spostato è una riga tolta e una aggiunta)
const cambi = [];
for (const t of new Set([...Object.keys(nuove), ...Object.keys(vecchie)])) {
  const conta = new Map();
  for (const r of vecchie[t] || []) conta.set(r, (conta.get(r) || 0) + 1);
  for (const r of nuove[t] || []) conta.set(r, (conta.get(r) || 0) - 1);
  for (const [r, n] of conta) if (n) { const [x, z] = JSON.parse(r); cambi.push({ t, x, z, come: n > 0 ? 'tolto' : 'aggiunto' }); }
}
const elenco = (l) => { for (const c of l.slice(0, 40)) console.log(`  ${c.come} ${c.t} (${c.x}, ${c.z})`); if (l.length > 40) console.log(`  e altri ${l.length - 40}`); };
console.log(cambi.length ? `${cambi.length} righe cambiate` : 'cambia solo l\'ordine delle righe');
if (localita) {
  // prova della località (#139): le righe cambiate oltre il raggio da ogni cambio sono casi, contro l'elenco
  const prova = JSON.parse(readFileSync(join(radice, 'data/localita.json'), 'utf8'));
  const lontane = cambi.filter((c) => !prova.cambi.some((p) => Math.hypot(c.x - p.x, c.z - p.z) <= prova.raggio));
  console.log(`oltre ${prova.raggio} m dai cambi: ${lontane.length} righe`);
  elenco(lontane);
  const tmp = mkdtempSync(join(tmpdir(), 'localita-'));
  try {
    writeFileSync(join(tmp, 'casi.json'), JSON.stringify({ posa: lontane.map((c) => `${c.come} ${c.t} @ ${Math.round(c.x)},${Math.round(c.z)}`) }));
    const r = spawnSync(process.env.PYTHON || 'python3', [join(radice, 'scripts/eccezioni.py'), 'localita', join(tmp, 'casi.json'), '--toll', '1',
      '--comando', 'node scripts/posa_arredo.mjs --localita --mappa <rete> --aggiorna', ...(args.includes('--aggiorna') ? ['--aggiorna'] : [])], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const fuori = cambi.filter((c) => !zone.some(([x, z, r]) => Math.hypot(c.x - x, c.z - z) <= r));
if (controlla) {
  elenco(cambi);
  console.error('la posa non è quella di src/data/padova-arredo.json: npm run posa -- --zona X,Z,R (o --tutta), e il file va pubblicato con la modifica');
  process.exit(1);
}
if (!tutta && fuori.length) {
  console.log(`${fuori.length} fuori dalle zone dichiarate:`);
  elenco(fuori);
  console.error(zone.length ? 'cambiano elementi fuori dalla zona dichiarata: il file resta com\'era' : 'dichiara dove cambia la mappa con --zona X,Z,R, o --tutta se la posa cambia dappertutto');
  process.exit(1);
}
elenco(cambi);
writeFileSync(FILE, testo(nuove));
console.log(`scritto ${FILE}`);
