// La città del gioco costruita in Node, senza browser e senza disegnare, con il posatore dell'arredo al posto del
// lettore (#109): la usa scripts/posa_arredo.mjs. I moduli sono quelli di src/, caricati con Vite (che sa leggere la
// mappa in JSON e il modulo virtuale delle aree); i binari sono quelli che il gioco ricava dai dati (TramTrack,
// TramYard, TramNet), gli edifici dello spazio libero tutti quelli delle aree in public/mappa/aree.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');

// il gioco disegna le sue texture su un canvas: qui un canvas che non fa niente
const ctx = new Proxy(function () {}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : typeof k === 'symbol' ? undefined : ctx),
  set: () => true,
  apply: () => ctx,
});

// { net, city, lights, tramSignals, posatore }: come buildWorld in src/main.js, fin dove serve alla posa. Con `poi`,
// una funzione (mondo, carica) che gira prima di chiudere Vite (carica: gli altri moduli di src/), dà il suo risultato
export async function costruisci(poi = null) {
  globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx }) };
  // le aree che la città chiede mentre si costruisce (la posa legge gli edifici dai file, qui sotto)
  globalThis.fetch = async (u) => ({ ok: true, json: async () => JSON.parse(readFileSync(join(radice, 'public', u), 'utf8')) });
  const avvisi = console.warn;
  console.warn = (...a) => { if (!String(a[0]).includes('toNonIndexed')) avvisi(...a); };
  const vite = await createServer({
    root: radice, mode: 'production', define: { 'import.meta.env.DEV': 'false' }, logLevel: 'warn', appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true },
  });
  try {
    const carica = (m) => vite.ssrLoadModule(m);
    const THREE = await carica('three');
    const { buildNetwork, parseBuilding } = await carica('/src/data/padova.js');
    const { AREA_KEYS } = await carica('/src/data/aree.js');
    const { City } = await carica('/src/world/city.js');
    const { Terrain } = await carica('/src/world/terrain.js');
    const { TrafficLights, TramSignals } = await carica('/src/world/traffic.js');
    const { Posatore } = await carica('/src/world/posa.js');
    const edifici = AREA_KEYS.flatMap((k) => JSON.parse(readFileSync(join(radice, 'public/mappa/aree', k + '.json'), 'utf8')).edifici.map(parseBuilding));
    const scene = new THREE.Scene(), net = buildNetwork(), posatore = new Posatore(edifici);
    const city = new City(scene, net, { terrain: new Terrain(net.terrain), arredo: posatore });
    const lights = new TrafficLights(scene, net, city);
    const tramSignals = new TramSignals(scene, city, lights);
    const mondo = { net, city, lights, tramSignals, posatore, scene };
    return poi ? await poi(mondo, carica) : mondo;
  } finally {
    console.warn = avvisi;
    await vite.close();
  }
}
