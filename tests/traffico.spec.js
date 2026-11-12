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

// Incroci sulla sede del tram: tram e auto che tagliano i binari non sono mai dentro insieme. Ogni 0,2 s, per ogni
// incrocio col tram vicino ai punti scelti (col semaforo se sem, senza se è false, tutti se è null): il tram copre il
// binario all'altezza dell'auto (dal muso alla coda, 1 m di margine) e un'auto che taglia i binari ha il muso entro mezzo
// tram dall'asse (3,2 m dal centro).
function contaIncroci({ punti, sec, sem = true, r = 40 }) {
  const g = window.__game, xs = g.tramSignals.list.filter((x) => (sem == null || !!x.sig === sem) && punti.some(([px, pz]) => Math.hypot(x.px - px, x.pz - pz) < r));
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

// Il bus di chi gioca a un incrocio senza semaforo vicino a (px, pz), sull'arco che taglia i binari: lo attraversa a
// 8 m/s senza tram, poi con un tram a 45 m che arriva a 9 m/s; poi resta fermo sui binari con un tram in arrivo, e se ne va
function precedenza({ px, pz }) {
  const g = window.__game, ts = g.tramSignals, b = g.bus, N = g.net.nodes;
  const x = ts.list.filter((x) => !x.sig && Math.hypot(x.px - px, x.pz - pz) < 10).sort((p, q) => Math.hypot(p.px - px, p.pz - pz) - Math.hypot(q.px - px, q.pz - pz))[0];
  if (!x) return { incrocio: false };
  const e = x.e, A = N[e.a], B = N[e.b], l = Math.hypot(B.x - A.x, B.z - A.z), dx = (B.x - A.x) / l, dz = (B.z - A.z) / l;
  const r = x.refs[0], tr = g.trams.trams.find((t) => t.track === r.track) || g.trams.trams[0];
  // bus a d m dall'incrocio (negativo: prima), sulla corsia di destra
  const metti = (d) => b.place(x.px + dx * d + (dz * e.width) / 4, x.pz + dz * d - (dx * e.width) / 4, Math.atan2(dx, dz));
  // via gli altri tram e le auto attorno all'incrocio
  const libera = () => {
    for (const t of g.trams.trams) if (t !== tr && t.parts[0] && Math.hypot(t.parts[0].x - x.px, t.parts[0].z - x.pz) < 400) t.s = (t.s + 2500) % 1000;
    g.traffic.cars = g.traffic.cars.filter((c) => Math.hypot(c.x - x.px, c.z - x.pz) > 250);
  };
  const tram = (d, v) => { tr.track = r.track; tr.dir = r.dir; tr.s = r.sT - d; tr.v = v; tr.wait = 0; };
  const attraversa = () => {
    const log0 = g.mission.log.length;
    b.v = 8;
    g.keys.add('KeyW');
    g.sim(4, 1 / 30, false);
    g.keys.delete('KeyW');
    b.v = 0;
    return g.mission.log.slice(log0).map((m) => `${m.pts} ${m.msg}`);
  };
  g.teleport(x.px - dx * 40, x.pz - dz * 40);
  tram(600, 0); libera(); metti(-30); g.sim(0.1, 1 / 30, false);
  const senza = attraversa();
  libera(); metti(-30); tram(45, 9); g.sim(0.1, 1 / 30, false);
  const con = attraversa();
  tram(600, 0); g.sim(3, 1 / 30, false);
  libera(); metti(0); b.v = 0; tram(70, 9);
  let viaLibera = false, muso = -Infinity;
  for (let i = 0; i < 80; i++) { g.sim(0.1, 1 / 30, false); if (x.state === 'V') viaLibera = true; muso = Math.max(muso, tr.s - r.sT); }
  metti(40); b.v = 0;
  let dopo = null;
  for (let i = 0; i < 100 && dopo == null; i++) { g.sim(0.1, 1 / 30, false); if (x.state === 'V') dopo = (i + 1) / 10; }
  return { incrocio: `${e.name} (${Math.round(x.px)}, ${Math.round(x.pz)})`, senza, con, viaLibera, muso, halfT: x.halfT, dopo };
}

// Dove non c'è semaforo la precedenza è del tram (art. 145 del Codice della strada: salvo diversa segnalazione si dà
// la precedenza ai veicoli su rotaia; nei dati nessun incrocio senza semaforo la dà alla strada), rispettata dai due
// lati: auto e bus si fermano prima dei binari quando un tram chiama l'incrocio, il tram aspetta chi è già sopra. Sul
// SIR3 tra Via San Mattia e Via Rosmini, 20 minuti: tram e auto mai dentro insieme. Poi il bus di chi gioca in Via De
// Leva: passando davanti al tram perde 60 punti, senza tram no; fermo sui binari, il tram aspetta alla barra
// orizzontale e ha il via libera appena il bus se ne va.
test('incroci senza semaforo: precedenza al tram, rispettata dai due lati', async ({ pagina, gioco }) => {
  test.setTimeout(300_000);
  await avviaCorsa(pagina, { linea: '3' });
  await pagina.evaluate(() => { window.__game.teleport(900, 500); window.__game.sim(1, 1 / 30, false); });
  const r = await pagina.evaluate(contaIncroci, { punti: [[720, 247], [786, 373], [909, 632], [1020, 816], [1101, 947]], sec: 1200, sem: false, r: 60 });
  expect(r.incroci).toBeGreaterThan(8);
  expect(r.passaggi, 'nessun tram è passato dagli incroci').toBeGreaterThan(200);
  expect(r.auto, 'nessuna auto vicino agli incroci').toBeGreaterThan(200);
  expect(r.insieme).toEqual([]);
  const p = await pagina.evaluate(precedenza, { px: 1020, pz: 816 });
  expect(p.incrocio).toMatch(/^Via Giuseppe De Leva/);
  expect(p.senza.filter((m) => m.includes('🚋'))).toEqual([]);
  expect(p.con).toContain('-60 🚋 Non hai dato la precedenza al tram!');
  expect(p.viaLibera, 'via libera al tram col bus fermo sui binari').toBe(false);
  expect(p.muso, 'muso del tram oltre la linea d\'arresto').toBeLessThan(-p.halfT);
  expect(p.dopo, 'secondi per il via libera dopo che il bus se ne va').not.toBeNull();
  expect(p.dopo).toBeLessThanOrEqual(3);
  expect(gioco.errori()).toEqual([]);
});

// Un'auto in Viale della Pace a 15 m dalla rotonda Rosetta Gagliardi, davanti alla stazione, che ne esce subito in Viale
// della Pace sui binari del SIR3 vicino a (px, pz): il pezzo di rotonda in mezzo è lungo 6 m ed è tutto curva. Con i
// binari chiamati da un tram, i metri dal muso al punto dove fermarsi (calledAhead), da lì e a metà della curva che
// entra nella rotonda
function rotonda({ px, pz }) {
  const g = window.__game, ts = g.tramSignals, T = g.traffic, N = g.net.nodes;
  const x = ts.list.find((x) => !x.sig && Math.hypot(x.px - px, x.pz - pz) < 3);
  if (!x) return { incrocio: false };
  const uscita = x.e, giro = N[uscita.a].edges.find((e) => e.b === uscita.a && /^Rotonda/.test(e.name));
  const entrata = N[giro.a].edges.find((e) => e.b === giro.a && e !== giro && !/^Rotonda/.test(e.name));
  const passo = (e) => ({ edge: e, fwd: true, node: N[e.a] });
  const c = { car: true, edge: entrata, fwd: true, v: 6, vmax: 9, turn: null, route: [passo(giro), passo(uscita)], tramOff: 0, latOff: 0 };
  const g0 = T.laneGeom(c);
  c.s = g0.s1 - 15; c.x = g0.sx + g0.dx * c.s; c.z = g0.sz + g0.dz * c.s; c.h = Math.atan2(g0.dx, g0.dz);
  const chiamata = x.call;
  x.call = true;
  const prima = T.calledAhead(c, ts);
  c.s = g0.s1;
  T.startTurn(c, g0);
  const { p0, p1, p2 } = c.turn;
  c.turn.t = 0.5;
  c.x = (p0.x + 2 * p1.x + p2.x) / 4; c.z = (p0.z + 2 * p1.z + p2.z) / 4;
  const curva = T.calledAhead(c, ts);
  x.call = chiamata;
  return { incrocio: `${uscita.name} (${Math.round(x.px)}, ${Math.round(x.pz)})`, giro: giro.name, prima: String(prima), curva: String(curva) };
}

// Incroci col tram nelle rotonde e dove il binario curva, davanti alla stazione. Nella rotonda Rosetta Gagliardi i pezzi
// sono corti e curvi: calledAhead guardava 20 m in linea retta oltre la prossima svolta, finiva fuori dalla rotonda e
// non vedeva i binari di Viale della Pace due archi più avanti; in svolta non guardava affatto, e l'auto passava da una
// curva all'altra fino a fermarsi sui binari davanti al tram (così anche nella rotonda Graziana Campanato col SIR2). Ora
// segue il percorso lungo gli archi, anche in svolta. Poi 20 minuti attorno alle due rotonde, a Corso del Popolo e al
// Piazzale della Stazione: tram e auto mai dentro insieme.
test('incroci col tram nelle rotonde e in curva: tram e auto mai dentro insieme', async ({ pagina, gioco }) => {
  test.setTimeout(300_000);
  await avviaCorsa(pagina, { linea: '3' });
  const r0 = await pagina.evaluate(rotonda, { px: 368, pz: -945 });
  expect(r0.incrocio).toMatch(/^Viale della Pace/);
  expect(r0.giro).toBe('Rotonda Rosetta Gagliardi');
  expect(Number(r0.prima), 'metri ai binari chiamati, 15 m prima della rotonda').toBeGreaterThan(15);
  expect(Number(r0.prima)).toBeLessThan(35);
  expect(Number(r0.curva), 'metri ai binari chiamati, in svolta nella rotonda').toBeGreaterThan(0.5);
  expect(Number(r0.curva)).toBeLessThan(15);
  await pagina.evaluate(() => { window.__game.teleport(450, -850); window.__game.sim(1, 1 / 30, false); });
  const r = await pagina.evaluate(contaIncroci, { punti: [[368, -945], [777, -734], [158, -1026], [298, -1014]], sec: 1200, sem: null, r: 60 });
  expect(r.incroci).toBeGreaterThan(8);
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

// Piazzale di Porta Trento, all'imbocco della rotonda da Via Bezzecca: chi da Via Bezzecca svolta in Via Belfiore e chi
// dalla rotonda esce in Via Bezzecca hanno le curve che si toccano a 2 m. Le due auto ferme dove ognuna ha l'altra
// davanti (la regola delle auto davanti di Traffic.update: più di 0,5 m avanti, meno di 1,7 m di lato, direzioni a meno
// di 107°): quanti secondi ci mettono a finire le due svolte, chi è passata davanti all'altra (through) e se le due auto
// erano davvero l'una davanti all'altra
function stallo({ ta, tb }) {
  const g = window.__game, T = g.traffic, N = g.net.nodes;
  const n = Object.values(N).filter((n) => n.edges.some((e) => e.name === 'Via Belfiore') && n.edges.filter((e) => e.name === 'Via Bezzecca').length === 2)
    .sort((p, q) => Math.hypot(p.x + 970, p.z + 1111) - Math.hypot(q.x + 970, q.z + 1111))[0];
  if (!n || Math.hypot(n.x + 970, n.z + 1111) > 20) return { nodo: false };
  const bez = n.edges.filter((e) => e.name === 'Via Bezzecca').sort((p, q) => p.len - q.len);
  const [rotonda, via] = bez, belfiore = n.edges.find((e) => e.name === 'Via Belfiore');
  // un'auto ferma a t della curva da da (che arriva a n) ad a (che parte da n)
  const inCurva = (da, a, t) => {
    const c = { car: true, edge: da, fwd: da.b === n.id, s: 0, v: 0, vmax: 9, turn: null, route: [], tramOff: 0, latOff: 0, blocked: 0, pass: 0, passT: 0, honkCd: 0, id: Math.random(), color: T.cars[0].color };
    const G = T.laneGeom(c), nx = { edge: a, fwd: a.a === n.id, node: n };
    c.s = G.s1;
    c.turn = { ...T.turnPath(c, G, nx), t, next: nx };
    const { p0, p1, p2 } = c.turn, w = 1 - t;
    c.x = w * w * p0.x + 2 * w * t * p1.x + t * t * p2.x; c.z = w * w * p0.z + 2 * w * t * p1.z + t * t * p2.z;
    c.h = Math.atan2(w * (p1.x - p0.x) + t * (p2.x - p1.x), w * (p1.z - p0.z) + t * (p2.z - p1.z));
    return c;
  };
  const davanti = (c, o) => {
    const fx = Math.sin(c.h), fz = Math.cos(c.h), dx = o.x - c.x, dz = o.z - c.z;
    return dx * fx + dz * fz > 0.5 && Math.abs(dx * fz - dz * fx) < 1.7 && Math.cos(o.h - c.h) >= -0.3;
  };
  g.teleport(n.x + 60, n.z + 100);
  g.sim(0.1, 1 / 30, false);
  const A = inCurva(via, belfiore, ta), B = inCurva(rotonda, via, tb);
  const prima = { a: davanti(A, B), b: davanti(B, A), d: Math.hypot(A.x - B.x, A.z - B.z) };
  // da sole: le altre auto e quelle nuove tornano dopo
  const altre = T.cars, quante = T.target;
  T.cars = [A, B]; T.target = 0;
  let fa = null, fb = null, passata = null;
  for (let i = 1; i <= 300 && (fa == null || fb == null); i++) {
    g.sim(0.1, 1 / 30, false);
    if (!passata && (A.through || B.through)) passata = A.through ? 'Via Belfiore' : 'Via Bezzecca';
    if (fa == null && A.edge === belfiore) fa = i / 10;
    if (fb == null && B.edge === via) fb = i / 10;
  }
  T.cars = altre; T.target = quante;
  return { nodo: true, prima, fuori: fa != null && fb != null ? Math.max(fa, fb) : null, passata };
}

// #79: negli incroci senza semaforo due auto in svolta che si aspettano a vicenda restavano ferme per sempre (a Porta
// Trento, in Via Pilade Bronzetti, in Piazzale Mazzini, tra Via Tirana e Via delle Melette). Ora chi aspetta chi si
// segue fino a tornare al punto di partenza (Traffic.untangle): in un giro di attese tra auto ferme passa chi ha l'auto
// che aspetta più di lato. A Porta Trento esce prima chi lascia la rotonda verso Via Bezzecca, poi l'altra.
test('auto in svolta che si aspettano a vicenda: a Porta Trento una passa e l\'altra la segue', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '3' });
  const r = await pagina.evaluate(stallo, { ta: 0.6, tb: 0.32 });
  expect(r.nodo, 'incrocio di Via Bezzecca con Via Belfiore').toBe(true);
  expect(r.prima.a, 'chi va in Via Belfiore ha davanti chi esce dalla rotonda').toBe(true);
  expect(r.prima.b, 'chi esce dalla rotonda ha davanti chi va in Via Belfiore').toBe(true);
  expect(r.prima.d).toBeLessThan(2.5);
  expect(r.fuori, 'secondi per finire le due svolte').not.toBeNull();
  expect(r.fuori).toBeLessThan(10);
  expect(r.passata).toBe('Via Bezzecca');
  expect(gioco.errori()).toEqual([]);
});
