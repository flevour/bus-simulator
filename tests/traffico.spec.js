// Traffico: bus automatici, tram e semafori non si bloccano a vicenda.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, avviaCorsa, tempoMassimo } from './gioco.js';
import { guidaFermate } from './guida.js';

// I casi di un controllo contro l'elenco dei casi noti data/eccezioni/traffico.json (scripts/eccezioni.py, #105): i
// nuovi, quelli spariti dall'elenco e i gruppi senza il perché. Lo stato di partenza di una corsa è fissato (#122), quindi
// i casi sono gli stessi a ogni lancio, sul Mac e in CI.
// casi: { controllo: [chiavi] }, tutti i controlli della prova in una volta; dà { controllo: esito }
function controEccezioni(info, casi, toll = 3) {
  const fileCasi = info.outputPath('casi.json'), fileEsito = info.outputPath('eccezioni.json');
  writeFileSync(fileCasi, JSON.stringify(casi));
  const argomenti = ['scripts/eccezioni.py', 'traffico', fileCasi, '--toll', String(toll), '--json', fileEsito, '--comando', '`ECCEZIONI=aggiorna npx playwright test tests/traffico.spec.js`'];
  if (process.env.ECCEZIONI === 'aggiorna') argomenti.push('--aggiorna');
  let diversi = '';
  try { execFileSync('python3', argomenti, { encoding: 'utf8' }); } catch (e) { diversi = `${e.stdout || ''}${e.stderr || ''}`; }
  const esiti = JSON.parse(readFileSync(fileEsito, 'utf8'));
  return Object.fromEntries(Object.keys(casi).map((c) => [c, { ...esiti[c], diversi }]));
}

// La sosta più lunga di un bus automatico per far salire e scendere (BusSim.move: 8-20 s), più le porte che si
// chiudono (1,6 s) e il passo di un secondo dell'osservazione. Oltre, se nessuno sta salendo o scendendo (paxBusy), il
// bus in fermata aspetta l'orario (#127)
const SALITA = 20 + 1.6 + 1;

// Ogni secondo di gioco: chi è fermo da quanto (bus fuori dalle fermate, tram fuori dalle soste) nel cerchio (cx, cz, r).
// Si aggancia a __game.sim, che il pilota chiama a ogni passo; window.__fermi() dà i fermi più lunghi.
// In più (#127) i tram in coda dietro un bus in sosta: tram fermo fuori dalle sue soste, tenuto fermo da un bus (busT
// di TramSim.move), con davanti sul suo binario un bus in fermata (un pezzo del bus a meno di 2,2 m, come guarda il
// tram, fino a 60 m dal muso: anche con un bus in coda in mezzo). window.__codaSosta() dà, per tram e bus in sosta, i
// secondi di coda oltre la salita: con il bus in fermata da più di SALITA secondi senza nessuno che sale o scende.
// window.__codaTutta() le code intere dietro le soste, dalla prima all'ultima sosta di una fila di bus (#47).
function osservaFermi({ cx, cz, r, salita }) {
  const g = window.__game, sim = g.sim, da = new Map(), peggio = new Map(), inSosta = new Map(), coda = new Map();
  const inCoda = new Map(), code = [];
  let t = 0;
  const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  // i bus in sosta davanti al tram tr, sul suo binario
  const soste = (tr) => {
    const P = tr.track.path(tr.dir);
    return g.buses.buses.filter((b) => b.atStop && b.near !== false && b.parts && b.parts.some((p) => {
      const pr = P.projectNear(p.x, p.z, 2.2);
      return pr && pr.s - tr.s > 0 && pr.s - tr.s < 60;
    }));
  };
  const segna = (o, fermo, x, z, chi) => {
    if (!fermo || Math.hypot(x - cx, z - cz) > r) { da.delete(o); return; }
    const k = da.get(o) ?? g.mission.clock;
    da.set(o, k);
    const s = g.mission.clock - k, w = peggio.get(o);
    if (!w || s > w.s) peggio.set(o, { chi, s: Math.round(s), x: Math.round(x), z: Math.round(z), dalle: hm(k) });
  };
  g.sim = (sec, dt, draw, hud) => {
    sim(sec, dt, draw, hud);
    if ((t += sec) < 1) return;
    t = 0;
    for (const b of g.buses.buses) {
      segna(b, b.v < 0.1 && !b.atStop, b.x, b.z, `bus ${b.run.L.id}`);
      if (!b.atStop) inSosta.delete(b);
      else if (!inSosta.has(b)) inSosta.set(b, g.mission.clock);
    }
    for (const tr of g.trams.trams) {
      if (!tr.parts.length) continue;
      segna(tr, tr.v < 0.1 && tr.wait <= 0, tr.parts[0].x, tr.parts[0].z, `tram ${tr.line}`);
      const davanti = tr.v < 0.1 && tr.wait <= 0 && tr.busT > 0 && Math.hypot(tr.parts[0].x - cx, tr.parts[0].z - cz) <= r ? soste(tr) : [];
      // la coda intera: finisce quando il tram riparte o davanti non ha più un bus in sosta
      const q = inCoda.get(tr);
      if (!davanti.length) { if (q) { code.push(q); inCoda.delete(tr); } continue; }
      if (q) { q.s++; for (const b of davanti) if (!q.bus.includes(b.run.L.id)) q.bus.push(b.run.L.id); }
      else inCoda.set(tr, { tram: tr.line, s: 1, dalle: hm(g.mission.clock), x: Math.round(davanti[0].x), z: Math.round(davanti[0].z), bus: davanti.map((b) => b.run.L.id) });
      const b = davanti.find((o) => g.mission.clock - inSosta.get(o) > salita && !o.paxBusy);
      if (!b) continue;
      // chiave: tram e bus, il posto è quello del bus in fermata
      const k = `tram ${tr.line} dietro la sosta del bus ${b.run.L.id} @ ${Math.round(b.x)},${Math.round(b.z)}`, c = coda.get(k);
      if (c) c.s++;
      else coda.set(k, { chiave: k, s: 1, dalle: hm(g.mission.clock), fermata: b.L.stops[b.k] && b.L.stops[b.k].name });
    }
    segna(g.bus, Math.abs(g.bus.v) < 0.1 && !g.bus.doorsAnyOpen, g.bus.x, g.bus.z, 'giocatore');
  };
  window.__fermi = () => [...peggio.values()].sort((a, b) => b.s - a.s);
  window.__codaSosta = () => [...coda.values()].sort((a, b) => b.s - a.s);
  window.__codaTutta = () => [...code, ...inCoda.values()].sort((a, b) => b.s - a.s);
}

// Segnalazione del 9 novembre dalla linea 3 alle 8:54, in Riviera dei Ponti Romani: "si bloccano gli autobus che a
// loro volta bloccano i tram". All'incrocio con Riviera Tito Livio la chiamata del tram dava il rosso anche ai bus sul
// binario davanti a lui; il tram dietro di loro teneva viva la chiamata e il rosso non finiva. Si guida con il traffico
// la corsa della 3 delle 8:36 fino a Garibaldi giardini: nel tratto da Riviera Tito Livio a Piazza Garibaldi nessuno
// resta fermo più di un ciclo semaforico (60 s) fuori dalle fermate. Col codice del 9 novembre i bus restavano fermi
// fino a 81 s al rosso dell'incrocio (dove il rosso dura al massimo 29 s), dopo la correzione al massimo 29 s. Con la 3
// intera (11 novembre) la stessa corsa parte alle 8:27 dal Capolinea Lion, 10 fermate prima di Bembo 149.
// La corsa è la stessa a ogni lancio (#122: sereno, semafori, segnali del tram e bus automatici dallo stato di partenza):
// chi resta fermo oltre i 60 s è un caso con il suo posto, confrontato con l'elenco dei casi noti. Il limite non si
// alza: un caso nuovo fa fallire la prova, uno noto ha il suo perché e la sua issue in data/eccezioni/traffico.json.
test('Tito Livio e Ponti Romani: bus e tram non restano fermi più di un ciclo semaforico', async ({ pagina, gioco }, info) => {
  tempoMassimo(630);
  const corsa = await avviaCorsa(pagina, { linea: '3', verso: 1, partenza: '08:27' });
  expect(corsa.prima).toMatch(/^Capolinea Lion/);
  await pagina.evaluate(osservaFermi, { cx: 30, cz: -20, r: 380, salita: SALITA });
  const esiti = await guidaFermate(pagina, { fermate: 27, traffico: true });
  const fermi = await pagina.evaluate(() => window.__fermi()), coda = await pagina.evaluate(() => window.__codaSosta());
  // le code intere dei tram dietro le soste dei bus, per #47 (Ponti Romani 68): si misurano, il limite è sopra
  console.log(`code dei tram dietro le soste dei bus: ${JSON.stringify(await pagina.evaluate(() => window.__codaTutta()))}`);
  const ultima = esiti[esiti.length - 1];
  const E = controEccezioni(info, {
    fermi_oltre_un_ciclo: fermi.filter((f) => f.s > 60).map((f) => `${f.chi} @ ${f.x},${f.z}`),
    // il tram non resta in coda dietro un bus in sosta più della salita e della discesa (#127): a zero
    tram_dietro_la_sosta: coda.map((c) => c.chiave),
  });
  const e = E.fermi_oltre_un_ciclo, q = E.tram_dietro_la_sosta;
  const lunghi = `fermi più lunghi: ${JSON.stringify(fermi.slice(0, 6))}\n${e.diversi}`;
  expect.soft(e.nuovi, `fermi oltre i 60 s fuori dall'elenco data/eccezioni/traffico.json; ${lunghi}`).toEqual([]);
  expect.soft(e.spariti, `casi spariti, da togliere dall'elenco data/eccezioni/traffico.json; ${lunghi}`).toEqual([]);
  expect.soft(e.senza_perche, 'casi dell\'elenco senza il perché').toEqual([]);
  const code = `tram in coda dietro un bus in sosta oltre ${SALITA} s (secondi di coda oltre la salita): ${JSON.stringify(coda)}`;
  expect.soft(q.nuovi, `${code}\n${q.diversi}`).toEqual([]);
  expect.soft(q.spariti, `casi spariti, da togliere dall'elenco data/eccezioni/traffico.json; ${code}`).toEqual([]);
  expect.soft(q.senza_perche, 'casi dell\'elenco senza il perché').toEqual([]);
  expect(ultima.nome, `fermate: ${esiti.map((e) => `${e.nome} ${e.motivo}`).join(', ')}`).toBe('Garibaldi giardini');
  expect(ultima.arrivato).toBe(true);
  expect(gioco.errori()).toEqual([]);
});

// Incroci sulla sede del tram: tram e auto che tagliano i binari non sono mai dentro insieme. Ogni 0,2 s, per ogni
// incrocio col tram vicino ai punti scelti (col semaforo se sem, senza se è false, tutti se è null): il tram copre il
// binario all'altezza dell'auto (dal muso alla coda, 1 m di margine) e un'auto che taglia i binari ha il muso entro mezzo
// tram dall'asse (3,2 m dal centro).
// Con segnali, negli stessi passi, anche i segnali del tram di tutta la rete (barre agli incroci e lanterne stradali sul
// binario): il tempo più lungo che un tram resta fermo davanti a un segnale chiamato senza via libera, e le lanterne
// disegnate diverse dallo stato che la logica usa (controllate ogni 5 s, ignorando il passo in cui cambiano). Era una
// prova a parte con gli stessi 20 minuti di gioco dallo stesso stato: una simulazione in meno (#121).
function contaIncroci({ punti, sec, sem = true, r = 40, segnali = false }) {
  const g = window.__game, ts = g.tramSignals, xs = ts.list.filter((x) => (sem == null || !!x.sig === sem) && punti.some(([px, pz]) => Math.hypot(x.px - px, x.pz - pz) < r));
  const insieme = [];
  let passaggi = 0, auto = 0;
  const tutti = [...ts.list, ...ts.lanterns], da = new Map();
  const acceso = (ap) => { const a = g.lights.lamps.instanceColor.array, i = ap.lampIdx * 3; return a[i] > 0.5 ? 'R' : a[i + 3] > 0.5 ? 'Y' : a[i + 7] > 0.5 ? 'G' : '?'; };
  const diverse = () => ts.lanterns.filter((l) => l.ap.lampN && acceso(l.ap) !== g.lights.stateOf(l.sig, l.ap.phase));
  let peggio = { s: 0 }, sbagliate = [];
  for (let t = 0; t < sec * 5; t++) {
    g.sim(0.2, 1 / 30, false);
    if (segnali) {
      for (const x of tutti) {
        const fermo = x.who && x.who.some((tr) => tr.v < 0.1 && !(tr.wait > 0)) && x.state !== 'V';
        if (!fermo) { da.delete(x); continue; }
        const k = da.get(x) ?? g.mission.clock;
        da.set(x, k);
        if (g.mission.clock - k > peggio.s) peggio = { s: Math.round(g.mission.clock - k), dove: `${x.ap ? 'lanterna di ' + x.ap.edge.name : 'barre di ' + x.e.name} (${x.track.id})` };
      }
    }
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
    if (segnali && t % 25 === 0 && diverse().length) { g.sim(1 / 30, 1 / 30, false); sbagliate.push(...diverse().map((l) => l.ap.edge.name)); }
  }
  return { incroci: xs.length, passaggi, auto, insieme, lanterne: ts.lanterns.length, peggio, sbagliate };
}

// Chiesto da chi gioca l'11 novembre: se il tram ha il passaggio, auto e bus si fermano prima della sede. Giocatore fermo
// in Via Altinate, 20 minuti di gioco alle 8:15 attorno ai semafori di Riviera Tito Livio, di Riviera dei Ponti Romani
// con Via Battisti, di Largo Europa e di Piazza Garibaldi (per posizione: gli id dei nodi cambiano con la mappa).
// Negli stessi 20 minuti i segnali di tutti i tram automatici (segnalazione dell'11 novembre, sotto): nessun tram fermo
// più di un ciclo davanti a un segnale chiamato, lanterne disegnate come lo stato della logica.
test('incroci semaforizzati sulla sede e segnali del tram: tram e auto mai dentro insieme, verde entro un ciclo, lanterna disegnata uguale allo stato', async ({ pagina, gioco }) => {
  tempoMassimo(426);
  await avviaCorsa(pagina, { linea: '3' });
  await pagina.evaluate(() => { window.__game.teleport(230, -132); window.__game.sim(1, 1 / 30, false); });
  const r = await pagina.evaluate(contaIncroci, { punti: [[24, 149], [58, 65], [53, -333], [9, -195]], sec: 1200, segnali: true });
  expect(r.incroci).toBeGreaterThan(4);
  expect(r.passaggi, 'nessun tram è passato dagli incroci').toBeGreaterThan(200);
  expect(r.auto, 'nessuna auto vicino agli incroci').toBeGreaterThan(200);
  expect(r.insieme).toEqual([]);
  expect(r.lanterne).toBeGreaterThan(10);
  expect(r.peggio.s, `fermo più lungo a un segnale del tram: ${JSON.stringify(r.peggio)}`).toBeLessThanOrEqual(60);
  expect(r.sbagliate).toEqual([]);
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
  tempoMassimo(354);
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
// della Pace sui binari del SIR3 vicino a (px, pz): il pezzo di rotonda in mezzo è lungo 6 m ed è tutto curva (il
// raccordo della build lo scavalca). Con i binari chiamati da un tram, i metri dal muso al punto dove fermarsi
// (calledAhead), col centro 15 m prima della curva e a metà della curva che entra nella rotonda
function rotonda({ px, pz }) {
  const g = window.__game, ts = g.tramSignals, T = g.traffic, N = g.net.nodes;
  const x = ts.list.find((x) => !x.sig && Math.hypot(x.px - px, x.pz - pz) < 3);
  if (!x) return { incrocio: false };
  const uscita = x.e, giro = N[uscita.a].edges.find((e) => e.b === uscita.a && /^Rotonda/.test(e.name));
  const entrata = N[giro.a].edges.find((e) => e.b === giro.a && e !== giro && !/^Rotonda/.test(e.name));
  const c = T.nuova(entrata, true, 0, [{ edge: giro }, { edge: uscita }]);
  const curva0 = c.per.pezzi.find((p) => p.tipo === 'raccordo');
  const chiamata = x.call;
  x.call = true;
  c.q = curva0.q0 - 15 - 1.35; T.segui(c);
  const prima = T.calledAhead(c, ts);
  c.q = curva0.q0 + curva0.len / 2; T.segui(c);
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
  tempoMassimo(390);
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

// Segnalazione dell'11 novembre: il SIR3 di chi gioca fermo prima di Pace davanti a lanterne rosse che non diventavano
// mai verdi, e passandoci col rosso nessuna penalità. Erano le lanterne stradali della corsia riservata di Via Tommaseo,
// su cui corre il binario: nessuna logica del tram le guardava. Ora sono il segnale del tram: il tram che arriva chiama
// il verde, i tram automatici col rosso si fermano (con i 20 minuti degli incroci semaforizzati, sopra), chi gioca
// passando col rosso perde 60 punti.
test('segnali del tram: verde a Pace entro un ciclo, rosso a Pace penalizzato', async ({ pagina, gioco }) => {
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

// Due auto ferme in svolta in un incrocio senza semaforo vicino a (px, pz), sui raccordi delle auto della build
// (Traffic.inCurva), dove ognuna ha l'altra davanti (la regola delle auto davanti di Traffic.update: più di 0,5 m avanti,
// meno di 1,7 m di lato, direzioni a meno di 107°): la coppia di raccordi e di posti più vicina tra quelle che si cercano
// lungo le curve dei nodi entro 30 m. Quanti secondi ci mettono a finire le due svolte, se una è passata davanti
// all'altra (through) e se le due auto erano davvero l'una davanti all'altra
function stallo({ px, pz }) {
  const g = window.__game, T = g.traffic, N = g.net.nodes;
  const davanti = (c, o) => {
    const fx = Math.sin(c.h), fz = Math.cos(c.h), dx = o.x - c.x, dz = o.z - c.z;
    return dx * fx + dz * fz > 0.5 && Math.abs(dx * fz - dz * fx) < 1.7 && Math.cos(o.h - c.h) >= -0.3;
  };
  g.teleport(px + 60, pz + 100);
  g.sim(0.1, 1 / 30, false);
  let best = null;
  for (const n of Object.values(N)) {
    if (Math.hypot(n.x - px, n.z - pz) > 30 || n.signal) continue;
    const rs = T.rac.at(n.id).filter((R) => R.classi & 1 && !R.via.length);
    for (const A of rs) for (const B of rs) {
      if (A === B || A.da === B.da || A.a === B.a) continue;
      for (let ta = 0.02; ta < 1; ta += 0.04) for (let tb = 0.02; tb < 1; tb += 0.04) {
        const a = T.inCurva(A.da, A.a, n.id, ta, false), b = T.inCurva(B.da, B.a, n.id, tb, false);
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (davanti(a, b) && davanti(b, a) && (!best || d < best.d)) best = { d, n, A, B, ta, tb };
      }
    }
  }
  if (!best) return { trovate: false };
  const { n, ta, tb } = best, A = T.inCurva(best.A.da, best.A.a, n.id, ta), B = T.inCurva(best.B.da, best.B.a, n.id, tb);
  const prima = { a: davanti(A, B), b: davanti(B, A), d: Math.hypot(A.x - B.x, A.z - B.z) };
  // da sole: le altre auto e quelle nuove tornano dopo
  const altre = T.cars, quante = T.target;
  T.cars = [A, B]; T.target = 0;
  let fa = null, fb = null, passata = null;
  for (let i = 1; i <= 300 && (fa == null || fb == null); i++) {
    g.sim(0.1, 1 / 30, false);
    if (!passata && (A.through || B.through)) passata = `${(A.through ? best.A : best.B).a.name}`;
    if (fa == null && !A.turn && A.edge === best.A.a) fa = i / 10;
    if (fb == null && !B.turn && B.edge === best.B.a) fb = i / 10;
  }
  T.cars = altre; T.target = quante;
  const svolta = (R) => `${R.da.name || 'senza nome'} → ${R.a.name || 'senza nome'}`;
  return { trovate: true, dove: `${svolta(best.A)} e ${svolta(best.B)} (${Math.round(n.x)}, ${Math.round(n.z)})`, prima, fuori: fa != null && fb != null ? Math.max(fa, fb) : null, passata };
}

// #79: negli incroci senza semaforo due auto in svolta che si aspettano a vicenda restavano ferme per sempre (a Porta
// Trento, in Via Pilade Bronzetti, in Piazzale Mazzini, tra Via Tirana e Via delle Melette). Ora chi aspetta chi si
// segue fino a tornare al punto di partenza (Traffic.untangle): in un giro di attese tra auto ferme passa chi ha l'auto
// che aspetta più di lato. Dal 16 novembre (#113) le auto seguono i raccordi della build, e a Porta Trento la svolta da
// Via Bezzecca in Via Belfiore non c'è più (la build non la ammette alle auto): la scena si cerca all'incrocio di Via
// Gattamelata con Via Tartini, dove due raccordi delle auto si incrociano a 1,5 m. Dal 17 novembre (#115) chi c'è davanti
// si cerca lungo il percorso e non più in linea retta: le due auto, che in linea retta si vedono l'una davanti
// all'altra, di solito non sono una sul percorso dell'altra e non si aspettano nemmeno. Conta che finiscano le due
// svolte, con untangle o senza.
test('auto in svolta che si aspetterebbero a vicenda: finiscono tutte e due la svolta', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '3' });
  const r = await pagina.evaluate(stallo, { px: 760, pz: 896 });
  expect(r.trovate, 'due auto in svolta, ognuna con l\'altra davanti, all\'incrocio di Via Gattamelata con Via Tartini').toBe(true);
  expect(r.prima.a, `${r.dove}: la prima ha davanti la seconda`).toBe(true);
  expect(r.prima.b, `${r.dove}: la seconda ha davanti la prima`).toBe(true);
  expect(r.prima.d).toBeLessThan(2.5);
  expect(r.fuori, `secondi per finire le due svolte (passata davanti: ${r.passata})`).not.toBeNull();
  expect(r.fuori).toBeLessThan(10);
  expect(gioco.errori()).toEqual([]);
});

// Archi percorribili dalle auto attorno all'anello di strade di servizio accanto a Corso Esperanto (x, z): quelli
// dell'anello, i pozzi, le auto nuove nate attorno e le scelte agli incroci da chi non è in un pozzo
function pozzo({ x, z }) {
  const g = window.__game, T = g.traffic, N = g.net.nodes;
  const lontano = (id) => Math.hypot(N[id].x - x, N[id].z - z);
  const vicini = [...new Set(Object.values(N).filter((n) => lontano(n.id) < 600).flatMap((n) => n.edges))]
    .flatMap((e) => [true, false].filter((f) => T.allowed(e, f)).map((f) => ({ e, f })));
  const anello = vicini.filter(({ e }) => e.service && e.oneway && lontano(e.a) < 40 && lontano(e.b) < 40);
  const nate = [];
  for (let i = 0; i < 400; i++) T.spawn({ x, z }, 0, 500, nate);
  let scelte = 0, dentro = 0;
  for (const { e, f } of vicini) {
    if (T.pit(e, f)) continue;
    for (let i = 0; i < 20; i++, scelte++) { const n = T.chooseNext(e, f); if (T.pit(n.edge, n.fwd)) dentro++; }
  }
  return {
    anello: anello.length, chiuso: anello.filter(({ e, f }) => T.deadEnd(e, f)).length,
    pozzi: vicini.filter(({ e, f }) => T.pit(e, f)).length,
    nate: nate.length, nelPozzo: nate.filter((c) => T.pit(c.edge, c.fwd)).length, scelte, dentro,
  };
}

// #90: accanto a Corso Esperanto (2785, 3300) un anello di strade di servizio a senso unico, con le uscite a senso
// unico fino al bordo dell'area, è un pozzo: chi ci entra non torna più nella rete. Le auto ci entravano (deadEnd
// contava fino a 12 archi raggiungibili, dall'anello se ne raggiungono 17), le uscite erano vicoli ciechi e giravano
// nell'anello per sempre, con la coda ferma sulla strada d'ingresso. Ora (Traffic.pit) lì non nascono e non ci entrano
test('anello di strade di servizio senza uscita accanto a Corso Esperanto: le auto non ci nascono e non ci entrano', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '3' });
  const r = await pagina.evaluate(pozzo, { x: 2785, z: 3300 });
  expect(r.anello, 'archi dell\'anello').toBeGreaterThanOrEqual(6);
  expect(r.chiuso, 'archi dell\'anello chiusi alle auto (deadEnd)').toBe(r.anello);
  expect(r.pozzi, 'archi nei pozzi entro 600 m: l\'anello e la strada che ci porta').toBeGreaterThan(r.anello);
  expect(r.nate).toBeGreaterThan(100);
  expect(r.nelPozzo, 'auto nate in un pozzo').toBe(0);
  expect(r.scelte).toBeGreaterThan(1000);
  expect(r.dentro, 'scelte che entrano in un pozzo').toBe(0);
  expect(gioco.errori()).toEqual([]);
});
