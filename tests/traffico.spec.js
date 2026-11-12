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
// fino a 81 s al rosso dell'incrocio (dove il rosso dura al massimo 29 s), dopo la correzione al massimo 29 s. Con la 3
// intera (11 novembre) la stessa corsa parte alle 8:27 dal Capolinea Lion, 10 fermate prima di Bembo 149.
test('Tito Livio e Ponti Romani: bus e tram non restano fermi più di un ciclo semaforico', async ({ pagina, gioco }) => {
  test.setTimeout(480_000);
  const corsa = await avviaCorsa(pagina, { linea: '3', verso: 1, partenza: '08:27' });
  expect(corsa.prima).toMatch(/^Capolinea Lion/);
  await pagina.evaluate(osservaFermi, { cx: 30, cz: -20, r: 380 });
  const esiti = await guidaFermate(pagina, { fermate: 27, traffico: true });
  const fermi = await pagina.evaluate(() => window.__fermi());
  const ultima = esiti[esiti.length - 1];
  expect(fermi.filter((f) => f.s > 60), `fermi più lunghi: ${JSON.stringify(fermi.slice(0, 6))}`).toEqual([]);
  expect(ultima.nome, `fermate: ${esiti.map((e) => `${e.nome} ${e.motivo}`).join(', ')}`).toBe('Garibaldi giardini');
  expect(ultima.arrivato).toBe(true);
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

// Segnali del tram (barre agli incroci e lanterne stradali sul binario) per sec secondi: il tempo più lungo che un tram
// resta fermo davanti a un segnale chiamato senza via libera, e le lanterne disegnate diverse dallo stato che la logica
// usa (controllate ogni 5 s, ignorando il passo in cui cambiano)
function attesaSegnali({ sec }) {
  const g = window.__game, ts = g.tramSignals, tutti = [...ts.list, ...ts.lanterns], da = new Map();
  const acceso = (ap) => { const a = g.lights.lamps.instanceColor.array, i = ap.lampIdx * 3; return a[i] > 0.5 ? 'R' : a[i + 3] > 0.5 ? 'Y' : a[i + 7] > 0.5 ? 'G' : '?'; };
  const diverse = () => ts.lanterns.filter((l) => l.ap.lampN && acceso(l.ap) !== g.lights.stateOf(l.sig, l.ap.phase));
  let peggio = { s: 0 }, sbagliate = [];
  for (let t = 0; t < sec * 5; t++) {
    g.sim(0.2, 1 / 30, false);
    for (const x of tutti) {
      const fermo = x.who && x.who.some((tr) => tr.v < 0.1 && !(tr.wait > 0)) && x.state !== 'V';
      if (!fermo) { da.delete(x); continue; }
      const k = da.get(x) ?? g.mission.clock;
      da.set(x, k);
      if (g.mission.clock - k > peggio.s) peggio = { s: Math.round(g.mission.clock - k), dove: `${x.ap ? 'lanterna di ' + x.ap.edge.name : 'barre di ' + x.e.name} (${x.track.id})` };
    }
    if (t % 25 === 0 && diverse().length) { g.sim(1 / 30, 1 / 30, false); sbagliate.push(...diverse().map((l) => l.ap.edge.name)); }
  }
  return { lanterne: ts.lanterns.length, peggio, sbagliate };
}

// Segnalazione dell'11 novembre: il SIR3 di chi gioca fermo prima di Pace davanti a lanterne rosse che non diventavano
// mai verdi, e passandoci col rosso nessuna penalità. Erano le lanterne stradali della corsia riservata di Via Tommaseo,
// su cui corre il binario: nessuna logica del tram le guardava. Ora sono il segnale del tram: il tram che arriva chiama
// il verde, i tram automatici col rosso si fermano, chi gioca passando col rosso perde 60 punti.
test('segnali del tram: verde entro un ciclo, lanterna disegnata uguale allo stato, rosso a Pace penalizzato', async ({ pagina, gioco }) => {
  test.setTimeout(300_000);
  // tutti i tram automatici (il giocatore su un bus fermo in Via Altinate, fuori dai binari), 20 minuti
  await avviaCorsa(pagina, { linea: '3' });
  await pagina.evaluate(() => { window.__game.teleport(230, -132); window.__game.sim(1, 1 / 30, false); });
  const r = await pagina.evaluate(attesaSegnali, { sec: 1200 });
  expect(r.lanterne).toBeGreaterThan(10);
  expect(r.peggio.s, `fermo più lungo a un segnale del tram: ${JSON.stringify(r.peggio)}`).toBeLessThanOrEqual(60);
  expect(r.sbagliate).toEqual([]);
  // il SIR3 di chi gioca verso Voltabarozzo, prima di Pace
  await avviaCorsa(pagina, { linea: 'SIR3', tram: true });
  const pace = await pagina.evaluate(() => {
    const g = window.__game, b = g.bus, ts = g.tramSignals;
    const l = ts.lanterns.find((l) => l.track === b.track && l.dir === b.dirSig && Math.hypot(l.ap.line.x - 493, l.ap.line.z + 866) < 15);
    if (!l) return { lanterna: false };
    const stato = () => g.lights.stateOf(l.sig, l.ap.phase);
    // fermo 20 m prima della linea, aspettando il rosso: il verde arriva
    let n = 0;
    while (stato() !== 'R' && n++ < 600) g.sim(0.2, 1 / 30, false);
    b.setFront(l.sT - b.pathOffset - 20);
    b.v = 0;
    let verde = null;
    for (let t = 0; t < 90 && verde == null; t++) { g.sim(1, 1 / 30, false); if (stato() === 'G') verde = t + 1; }
    // indietro, si aspetta il rosso, poi si passa la linea a 7 m/s
    b.setFront(l.sT - b.pathOffset - 120);
    g.sim(1, 1 / 30, false);
    n = 0;
    while (stato() !== 'R' && n++ < 600) g.sim(0.2, 1 / 30, false);
    b.setFront(l.sT - b.pathOffset - 15);
    g.sim(0.1, 1 / 30, false);
    const rosso = stato(), log0 = g.mission.log.length;
    b.v = 7;
    g.keys.add('KeyW');
    g.sim(3, 1 / 30, false);
    g.keys.delete('KeyW');
    return { lanterna: true, verde, rosso, oltre: b.pathOffset + b.sFront - l.sT, messaggi: g.mission.log.slice(log0).map((e) => `${e.pts} ${e.msg}`) };
  });
  expect(pace.lanterna, 'lanterna della corsia di Via Tommaseo prima di Pace').toBe(true);
  expect(pace.verde, 'secondi prima del verde, da fermi davanti alla lanterna').not.toBeNull();
  expect(pace.verde).toBeLessThanOrEqual(60);
  expect(pace.rosso).toBe('R');
  expect(pace.oltre).toBeGreaterThan(0);
  expect(pace.messaggi).toContain('-60 🚦 Passato col rosso!');
  expect(gioco.errori()).toEqual([]);
});
