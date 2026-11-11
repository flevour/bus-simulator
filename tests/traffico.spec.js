// Traffico: bus automatici, tram e semafori non si bloccano a vicenda.
import { test, expect, avviaCorsa } from './gioco.js';
import { guidaFermate } from './guida.js';

// Ogni secondo di gioco: chi è fermo da quanto (bus fuori dalle fermate, tram fuori dalle soste) nel cerchio (cx, cz, r).
// Si aggancia a __game.sim, che il pilota chiama a ogni passo; window.__fermi() dà i fermi più lunghi.
function osservaFermi({ cx, cz, r }) {
  const g = window.__game, sim = g.sim, da = new Map(), peggio = new Map();
  let t = 0;
  const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  const segna = (o, fermo, x, z, chi) => {
    if (!fermo || Math.hypot(x - cx, z - cz) > r) { da.delete(o); return; }
    const k = da.get(o) ?? g.mission.clock;
    da.set(o, k);
    const s = g.mission.clock - k, w = peggio.get(o);
    if (!w || s > w.s) peggio.set(o, { chi, s: Math.round(s), x: Math.round(x), z: Math.round(z), dalle: hm(k) });
  };
  g.sim = (sec, dt, draw) => {
    sim(sec, dt, draw);
    if ((t += sec) < 1) return;
    t = 0;
    for (const b of g.buses.buses) segna(b, b.v < 0.1 && !b.atStop, b.x, b.z, `bus ${b.run.L.id}`);
    for (const tr of g.trams.trams) if (tr.parts.length) segna(tr, tr.v < 0.1 && tr.wait <= 0, tr.parts[0].x, tr.parts[0].z, `tram ${tr.line}`);
    segna(g.bus, Math.abs(g.bus.v) < 0.1 && !g.bus.doorsAnyOpen, g.bus.x, g.bus.z, 'giocatore');
  };
  window.__fermi = () => [...peggio.values()].sort((a, b) => b.s - a.s);
}

// Segnalazione del 9 novembre dalla linea 3 alle 8:54, in Riviera dei Ponti Romani: "si bloccano gli autobus che a
// loro volta bloccano i tram". All'incrocio con Riviera Tito Livio la chiamata del tram dava il rosso anche ai bus sul
// binario davanti a lui; il tram dietro di loro teneva viva la chiamata e il rosso non finiva. Si guida con il traffico
// la corsa della 3 delle 8:36 fino a Garibaldi giardini: nel tratto da Riviera Tito Livio a Piazza Garibaldi nessuno
// resta fermo più di un ciclo semaforico (60 s) fuori dalle fermate. Col codice del 9 novembre i bus restavano fermi
// fino a 81 s al rosso dell'incrocio (dove il rosso dura al massimo 29 s), dopo la correzione al massimo 29 s.
test('Tito Livio e Ponti Romani: bus e tram non restano fermi più di un ciclo semaforico', async ({ pagina, gioco }) => {
  test.setTimeout(300_000);
  const corsa = await avviaCorsa(pagina, { linea: '3', verso: 1, partenza: '08:36' });
  expect(corsa.prima).toMatch(/^Bembo 149/);
  await pagina.evaluate(osservaFermi, { cx: 30, cz: -20, r: 380 });
  const esiti = await guidaFermate(pagina, { fermate: 17, traffico: true });
  const fermi = await pagina.evaluate(() => window.__fermi());
  const ultima = esiti[esiti.length - 1];
  expect(ultima.nome, `fermate: ${esiti.map((e) => `${e.nome} ${e.motivo}`).join(', ')}`).toBe('Garibaldi giardini');
  expect(ultima.arrivato).toBe(true);
  expect(fermi.filter((f) => f.s > 60), `fermi più lunghi: ${JSON.stringify(fermi.slice(0, 6))}`).toEqual([]);
  expect(gioco.errori()).toEqual([]);
});
