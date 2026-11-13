// Binari del tram come li disegna il gioco, misurati con la regola di docs/binari-tram.md: spigoli, raggi sotto il
// minimo, interassi fuori misura, scarti da OSM e pendenze, per linea e per deposito. I numeri e le misure sono quelli di
// scripts/binari_tram.py, lo stesso che scripts/verifica_mappa.py usa sui dati: la prova scrive i binari del gioco
// (TramTrack, scambi dei capolinea, TramYard) in test-results/<prova>/binari-gioco.json e lo chiama con --gioco.
//
// Fallisce se un numero supera la sua soglia (valori del 12 novembre 2026). Se un numero scende, si abbassa la soglia
// nello stesso commit. Il rapporto con i casi e i punti peggiori è allegato al risultato e scritto in
// test-results/<prova>/rapporto-binari.json.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './gioco.js';

// Linee (#69) e depositi (#70) secondo la regola. Pendenze: le rampe dei cavalcavia Chiesanuova (fino al 18,9%) e San
// Marco (11%) del SIR2 e del Borgomagno (7,4%) del SIR1 (#74)
const SOGLIE = {
  SIR1: { spigoli: 0, raggi: 0, interassi: 0, scarti_osm: 0, pendenze: 4 },
  SIR3: { spigoli: 0, raggi: 0, interassi: 0, scarti_osm: 0, pendenze: 0 },
  SIR2: { spigoli: 0, raggi: 0, interassi: 0, scarti_osm: 0, pendenze: 14 },
  Guizza: { spigoli: 0, raggi: 0, interassi: 0, scarti_osm: 0, pendenze: 0 },
  Voltabarozzo: { spigoli: 0, raggi: 0, interassi: 0, scarti_osm: 0, pendenze: 0 },
};

test('binari del tram secondo la regola', async ({ pagina, gioco }, info) => {
  const file = info.outputPath('binari-gioco.json'), soglie = info.outputPath('soglie.json'), rapporto = info.outputPath('rapporto-binari.json');
  writeFileSync(file, JSON.stringify(await pagina.evaluate(binari)));
  writeFileSync(soglie, JSON.stringify(SOGLIE));
  let testo;
  try {
    testo = execFileSync('python3', ['scripts/binari_tram.py', '--gioco', file, '--soglie', soglie, '--elenco', '--json', rapporto], { encoding: 'utf8' });
  } catch (e) {
    // sopra le soglie lo script esce con 1: il rapporto c'è lo stesso, e le soglie le controlla la prova qui sotto
    testo = `${e.stdout || ''}${e.stderr || ''}`;
  }
  console.log(testo);
  info.annotations.push({ type: 'rapporto', description: testo });
  const r = JSON.parse(readFileSync(rapporto, 'utf8'));
  await info.attach('rapporto-binari.json', { path: rapporto, contentType: 'application/json' });
  for (const [dove, v] of Object.entries(SOGLIE)) for (const [tipo, s] of Object.entries(v)) expect.soft(r.valori[dove][tipo], `${tipo} ${dove}`).toBeLessThanOrEqual(s);
  expect(gioco.errori()).toEqual([]);
});

// Gira nella pagina: deve bastare a sé stessa (Playwright la passa come testo). I binari del gioco nel formato che
// legge rete_gioco di scripts/binari_tram.py.
function binari() {
  // al millimetro: nelle curve i punti sono a mezzo metro, e al centimetro l'arrotondamento pesa sull'interasse che va e viene
  const g = window.__game, city = g.city, r = (v) => Math.round(v * 1000) / 1000, P = (pts) => pts.map((p) => [r(p.x), r(p.z)]);
  const tracks = Object.values(city.tramTracks).map((T) => ({
    id: T.id,
    paths: { 1: P(T.paths[1].pts), '-1': P(T.paths[-1].pts) },
    // scambi tra le linee (capi dei tratti in comune) e comunicazioni dei capolinea, come le percorre il tram
    switches: T.switches.map((s) => ({ x: r(s.x), z: r(s.z) })),
    // la S degli scambi ai capolinea come la percorre il tram, con 10 m di binario prima e dopo (da sola, una S corta
    // sembrerebbe uno spigolo: la svolta delle corde lunghe uscirebbe dalla curva)
    terminals: [1, -1].map((d) => {
      const t = T.terminals[d];
      if (!t) return null;
      const Q = T.paths[(t.field === 'dep' ? t.dep : t.arr) > 0 ? 1 : -1], on = t.state, out = [];
      t.state = 'deviato';
      for (let s = Math.max(0, t.toe - 10); s <= Math.min(Q.len, t.heel + 10); s += 1) { const p = Q.at(s), o = t.off(s) || { x: 0, z: 0 }; out.push({ x: p.x + o.x, z: p.z + o.z }); }
      t.state = on;
      return { curve: P(out) };
    }),
    // quote dei binari ogni 5 m, fermate per i nomi dei posti
    quote: T.h[1] ? { 1: T.h[1].map(r), '-1': T.h[-1].map(r) } : null,
    fermate: [1, -1].flatMap((d) => T.stopsDir[d].map((s) => [r(s.x), r(s.z), s.name])),
  }));
  const yards = (city.tramYards || []).map((Y) => ({
    name: Y.name,
    nodes: Y.nodes.map((N) => ({ x: r(N.x), z: r(N.z), ends: N.ends.map((E) => (E.port ? { port: Y.ports.indexOf(E.port), out: [E.out.x, E.out.z] } : { e: E.e.id, at: E.at, out: [E.out.x, E.out.z] })) })),
    edges: Y.edges.map((e) => ({ id: e.id, pts: P(e.pts) })),
    ports: Y.ports.map((p) => ({ T: p.T.id, dir: p.dir, s: r(p.s) })),
  }));
  return { tracks, yards, stazione: g.net.tramStazione };
}
