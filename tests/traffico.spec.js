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

// Incroci semaforizzati sulla sede del tram: tram e auto che tagliano i binari non sono mai dentro insieme. Ogni 0,2 s,
// per ogni incrocio col tram dei semafori scelti: il tram copre il binario all'altezza dell'auto (dal muso alla coda,
// 1 m di margine) e un'auto che taglia i binari ha il muso entro mezzo tram dall'asse (3,2 m dal centro).
function contaIncroci({ punti, sec }) {
  const g = window.__game, xs = g.tramSignals.list.filter((x) => x.sig && punti.some(([px, pz]) => Math.hypot(x.px - px, x.pz - pz) < 40));
  const insieme = [];
  let passaggi = 0, auto = 0;
  for (let t = 0; t < sec * 5; t++) {
    g.sim(0.2, 1 / 30, false);
    for (const x of xs) {
      for (const c of g.traffic.cars) if (Math.hypot(c.x - x.px, c.z - x.pz) < 25) auto++;
      let tram = null, d = 0;
      for (const tr of g.trams.trams) {
        const r = x.refs.find((r) => r.dir === tr.dir && r.track === tr.track);
        if (r && r.sT - tr.s > -(tr.L + x.halfT) && r.sT - tr.s <= x.halfT) { tram = tr; d = r.sT - tr.s; break; }
      }
      if (!tram) continue;
      passaggi++;
      for (const c of g.traffic.cars) {
        const rx = c.x - x.px, rz = c.z - x.pz, lungo = rx * x.tdx + rz * x.tdz, di = Math.abs(rx * x.tdz - rz * x.tdx);
        if (Math.abs(lungo) > x.halfT || di > 3.2 || lungo > -d + 1 || lungo < -d - tram.L - 1) continue;
        if (Math.abs(Math.sin(c.h) * x.tdx + Math.cos(c.h) * x.tdz) > 0.8) continue;
        insieme.push(`${x.e.name} (${Math.round(x.px)}, ${Math.round(x.pz)}) alle ${Math.floor(g.mission.clock / 3600)}:${String(Math.floor((g.mission.clock % 3600) / 60)).padStart(2, '0')}: tram ${tram.line}, auto a ${c.v.toFixed(1)} m/s`);
      }
    }
  }
  return { incroci: xs.length, passaggi, auto, insieme };
}

// Chiesto da chi gioca l'11 novembre: se il tram ha il passaggio, auto e bus si fermano prima della sede. Giocatore fermo
// in Via Altinate, 20 minuti di gioco alle 8:15 attorno ai semafori di Riviera Tito Livio, di Riviera dei Ponti Romani
// con Via Battisti, di Largo Europa e di Piazza Garibaldi (per posizione: gli id dei nodi cambiano con la mappa).
test('incroci semaforizzati sulla sede: tram e auto mai dentro insieme', async ({ pagina, gioco }) => {
  test.setTimeout(300_000);
  await avviaCorsa(pagina, { linea: '3' });
  await pagina.evaluate(() => { window.__game.teleport(230, -132); window.__game.sim(1, 1 / 30, false); });
  const r = await pagina.evaluate(contaIncroci, { punti: [[24, 149], [58, 65], [53, -333], [9, -195]], sec: 1200 });
  expect(r.incroci).toBeGreaterThan(4);
  expect(r.passaggi, 'nessun tram è passato dagli incroci').toBeGreaterThan(200);
  expect(r.auto, 'nessuna auto vicino agli incroci').toBeGreaterThan(200);
  expect(r.insieme).toEqual([]);
  expect(gioco.errori()).toEqual([]);
});
