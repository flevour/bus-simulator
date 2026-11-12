// Tram al capolinea: B cambia solo cabina, il tram resta dov'è (all'anello della stazione riparte senza cambiarla) e
// parte la corsa successiva del turno dall'altro verso, senza tornare al menu. Dove lo scambio sta oltre le banchine si
// va in fondo al binario tronco, si cambia cabina e si riparte passando dallo scambio fino alla banchina di partenza.
import { test, expect, avviaCorsa } from './gioco.js';
import { guidaFermate, guidaCapolinea } from './guida.js';

// Salta alla fine della corsa: fermate prima del capolinea servite, tram 40 m prima della fine della banchina. Poi
// fino alla banchina col manipolatore (oltre: metri oltre la fine della banchina, al più fino alla fine del binario),
// porte aperte finché scendono tutti (la corsa finisce), B a banchina (cabB: dove lo scambio è oltre le banchine non
// deve succedere niente) e, se serve, fino in fondo al tronco e di nuovo B, con le porte ancora aperte: si chiudono da
// sole e si cambia cabina. Poi col manipolatore fino alla banchina di partenza.
async function capolineaEB(page, oltre = 0) {
  return page.evaluate((oltre) => {
    const g = window.__game, m = g.mission, bus = g.bus, n = m.stops.length, last = m.stops[n - 1], dt = 1 / 30;
    g.traffic.target = 0;
    g.traffic.cars.splice(0);
    for (const st of m.stops.slice(0, -1)) Object.assign(st, { arrived: true, left: true, doneMsg: true });
    m.nextStop = n - 1;
    bus.setFront(last.s - 0.5 - 40);
    m.s = bus.sFront - 12.45;
    m.clock = last.sched - 120;
    const guida = (meta) => {
      bus.parking = false;
      for (let i = 0; i < 30 * 150; i++) {
        const resto = meta - bus.sFront, vt = Math.min(5, Math.sqrt(2 * 0.8 * Math.max(0, resto - 0.3))), e = vt - Math.abs(bus.v);
        if (vt > 0.05 && e > 0.3) g.keys.add('KeyW'); else g.keys.delete('KeyW');
        if ((vt <= 0.05 && Math.abs(bus.v) > 0.01) || e < -0.3) g.keys.add('KeyS'); else g.keys.delete('KeyS');
        g.sim(dt, dt, false);
        if (resto < 0.8 && Math.abs(bus.v) < 0.05) break;
      }
      g.keys.delete('KeyW');
      g.keys.delete('KeyS');
    };
    const meta = Math.min(bus.path.len - 1.2, last.s - 0.5 + oltre);
    guida(meta);
    g.press('KeyF');
    for (let t = 0; t < 120 && !m.finished; t++) g.sim(1, dt, false);
    const casse = () => bus.modules.map((x) => [x.group.position.x, x.group.position.z]);
    const prima = { finita: m.finished, verso: bus.dirSig, h: bus.h, capolinea: last.name };
    const t = bus.track.terminals[bus.dirSig];
    let aBanchina = null;
    if (t && t.kind === 'dopo' && bus.sFront < bus.path.len - 20) {
      // a banchina B non basta: lo scambio è oltre, si va in fondo al tronco
      g.press('KeyB');
      for (let s = 0; s < 4; s += dt) g.sim(dt, dt, false);
      aBanchina = { stessaCorsa: g.mission === m, verso: bus.dirSig };
      if (bus.doorTarget > 0) { g.press('KeyF'); g.sim(3, dt, false); }
      guida(bus.path.len - 1.2);
    }
    const c0 = casse(), cab0 = bus.activeCab;
    g.press('KeyB');
    for (let s = 0; s < 8 && g.mission === m; s += dt) g.sim(dt, dt, false);
    const c1 = casse(), spostamento = Math.max(...c0.map((p, i) => Math.hypot(p[0] - c1[i][0], p[1] - c1[i][1])));
    const m2 = g.mission, cambiata = bus.activeCab !== cab0;
    const giro = Math.abs(Math.atan2(Math.sin(bus.h - prima.h), Math.cos(bus.h - prima.h)));
    // fino alla banchina di partenza (dal tronco si passa dallo scambio)
    const muso0 = m2.stopInfo && Math.round(m2.stopInfo.along * 10) / 10;
    if (m2 !== m) guida(m2.stops[0].s - 0.5);
    g.sim(0.5, dt, false);
    const si = m2.stopInfo;
    return {
      ...prima, aBanchina, nuova: m2 !== m, verso2: bus.dirSig, cabina: giro > Math.PI / 2, cambiata, spostamento: Math.round(spostamento * 100) / 100,
      prima2: m2.stops[0].name, dest: m2.dest, partenza: g.settings.departure, prossima: m2.departure, muso0,
      inZona: !!(si && si.inZone && si.st.idx === 0), muso: si && Math.round(si.along * 10) / 10,
      corse: g.turno.corse, riepilogo: !document.getElementById('results').classList.contains('hidden'),
      fermo: Math.round((meta - last.s) * 10) / 10, // metri del muso oltre la palina al capolinea
    };
  }, oltre);
}

// all'anello della stazione (SIR3 a Stazione sud) B alla banchina: si riparte senza cambiare cabina
test('B al capolinea: SIR3 a Stazione sud (anello, senza cambio cabina)', async ({ pagina, gioco }) => {
  const corsa = await avviaCorsa(pagina, { linea: 'SIR3', tram: true, verso: 1 });
  const r = await capolineaEB(pagina);
  const testo = JSON.stringify(r);
  expect([r.finita, r.nuova, r.verso2, r.cambiata, r.cabina, r.dest], testo).toEqual([true, true, -r.verso, false, false, 'Voltabarozzo']);
  expect(r.spostamento, testo).toBeLessThan(0.1);
  expect(r.prima2, testo).toBe(corsa.ultima);
  expect(r.partenza, testo).toBe(r.prossima);
  expect(r.inZona, testo).toBe(true);
  expect([r.corse, r.riepilogo], testo).toEqual([1, false]);
  const esiti = await guidaFermate(pagina, { fermate: 1 });
  expect(esiti.every((e) => e.arrivato), JSON.stringify(esiti)).toBe(true);
  expect(gioco.errori()).toEqual([]);
});

// Ai capolinea su binario tronco, con il pilota: dalla penultima fermata al capolinea, discesa, avanti fino in fondo al
// binario, B, ripartenza fino alla fermata di partenza sull'altro binario e poi fino alla fermata dopo. A Voltabarozzo
// e Rubano la comunicazione di OSM porta sull'altro binario dopo il cambio cabina, a Pontevigodarzere e Guizza prima;
// a Busa di Vigonza OSM non ne ha e c'è quella del gioco
for (const c of [
  { linea: 'SIR1', verso: 0, capolinea: 'Pontevigodarzere', avanti: true },
  { linea: 'SIR1', verso: 1, capolinea: 'Guizza Capolinea', avanti: true },
  { linea: 'SIR3', verso: 0, capolinea: 'Voltabarozzo' },
  { linea: 'SIR2', verso: 1, capolinea: 'Rubano' },
  { linea: 'SIR2', verso: 0, capolinea: 'Busa di Vigonza' },
]) {
  test(`manovra al capolinea: ${c.linea} a ${c.capolinea}`, async ({ pagina, gioco }, info) => {
    const corsa = await avviaCorsa(pagina, { linea: c.linea, tram: true, verso: c.verso });
    expect(corsa.ultima).toBe(c.capolinea);
    await pagina.evaluate(() => {
      const g = window.__game, m = g.mission, bus = g.bus, k = m.stops.length - 2;
      for (const st of m.stops.slice(0, k)) Object.assign(st, { arrived: true, left: true, doneMsg: true });
      m.nextStop = k;
      bus.setFront(m.stops[k].s - 0.5);
      m.s = bus.sFront - 12.45;
      m.clock = m.stops[k].sched - 30;
    });
    const arrivo = await guidaFermate(pagina, { fermate: 1 });
    expect(arrivo.every((e) => e.arrivato), JSON.stringify(arrivo)).toBe(true);
    const r = await guidaCapolinea(pagina);
    const testo = JSON.stringify(r);
    info.annotations.push({ type: 'capolinea', description: testo });
    expect(r.finita, testo).toBe(true);
    expect(r.fondo.arrivato && !r.fondo.deragliato && !r.fondo.urti, testo).toBe(true);
    if (c.avanti) expect(r.oltreScambio, testo).toBe(true);
    expect([r.cabina, r.nuova, r.verso], testo).toEqual([true, true, true]);
    expect(r.ferme, testo).toBeLessThan(0.1);
    expect(r.prima, testo).toBe(c.capolinea);
    expect(r.partenza.arrivato && !r.partenza.deragliato && !r.partenza.urti, testo).toBe(true);
    expect(r.servita, testo).toBe(true);
    expect(r.sulBinario, testo).toBeLessThan(0.05);
    const dopo = await guidaFermate(pagina, { fermate: 1 });
    expect(dopo.every((e) => e.arrivato), JSON.stringify(dopo)).toBe(true);
    expect(gioco.errori()).toEqual([]);
  });
}

// Esplorazione: lo scambio del capolinea si gira (N). Diritto: B cambia solo cabina e il tram torna indietro sullo
// stesso binario. Deviato: B fa ripartire sul binario dell'altro verso passando dallo scambio
test('scambio del capolinea girato in Esplorazione', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR3', tram: true, verso: 0, modo: 'roam' });
  const r = await pagina.evaluate(() => {
    const g = window.__game, bus = g.bus, dt = 1 / 30, d = bus.dirSig, t = bus.track.terminals[d], sw = t.sign;
    bus.setFront(bus.path.len - 2);
    g.sim(0.5, dt, false);
    const out = { tipo: t.kind, iniziale: t.state };
    g.press('KeyN');
    out.dopoN = t.state;
    out.segnale = sw.diverted.visible ? 'deviato' : 'diritto';
    g.press('KeyB');
    g.sim(0.2, dt, false);
    out.diritto = { verso: bus.dirSig, facing: bus.facing, xover: !!bus.xover };
    // indietro sullo stesso binario
    const s0 = bus.sFront;
    bus.parking = false;
    g.keys.add('KeyW'); g.sim(4, dt, false); g.keys.delete('KeyW');
    out.indietro = Math.round(s0 - bus.sFront);
    g.keys.add('KeyS'); g.sim(6, dt, false); g.keys.delete('KeyS');
    g.press('KeyB'); g.sim(0.2, dt, false); // di nuovo verso il tronco
    bus.setFront(bus.path.len - 2);
    g.sim(0.5, dt, false);
    g.press('KeyN');
    out.dopoN2 = t.state;
    g.press('KeyB');
    g.sim(0.2, dt, false);
    out.deviato = { verso: bus.dirSig, facing: bus.facing, xover: !!bus.xover };
    // ripartenza oltre lo scambio: sul binario di partenza, senza scostamento
    bus.parking = false;
    g.keys.add('KeyW'); g.sim(25, dt, false); g.keys.delete('KeyW');
    g.keys.add('KeyS'); g.sim(10, dt, false); g.keys.delete('KeyS');
    out.oltre = bus.pathOffset + bus.sFront - bus.length > t.heel;
    const p = bus.path.at(bus.sFront), f = bus.at(bus.sFront);
    out.sulBinario = Math.round(Math.hypot(p.x - f.x, p.z - f.z) * 100) / 100;
    return out;
  });
  const testo = JSON.stringify(r);
  expect(r.tipo, testo).toBe('dopo');
  expect([r.iniziale, r.dopoN, r.segnale], testo).toEqual(['deviato', 'diritto', 'diritto']);
  expect(r.diritto, testo).toEqual({ verso: 1, facing: -1, xover: false });
  expect(r.indietro, testo).toBeGreaterThan(2);
  expect(r.dopoN2, testo).toBe('deviato');
  expect(r.deviato, testo).toEqual({ verso: -1, facing: 1, xover: true });
  expect(r.oltre, testo).toBe(true);
  expect(r.sulBinario, testo).toBeLessThan(0.05);
  expect(gioco.errori()).toEqual([]);
});

// Tram automatici con i turni dell'orario: ai capolinea con lo scambio fanno la manovra come chi gioca (discesa, fondo
// del binario, cambio cabina, scambio, fermata di partenza), senza salti; ad aspettare la partenza ci sono al più due
// tram e nessuno resta fermo fuori dalle soste. Un tram per linea, a qualche fermata dal capolinea, resta fermo 4 minuti:
// fa comunque la corsa dopo del suo turno, in ritardo, e nessuna corsa resta senza tram. Chi gioca guida un bus lontano
// dai binari. Col codice di prima i tram saltavano sull'altro binario, e a Pontevigodarzere arrivavano due tram per ogni
// partenza (le corse Santo → Pontevigodarzere doppie del GTFS restavano: l'altra corsa ha due fermate Pontevigodarzere)
test('tram automatici: manovra ai capolinea con lo scambio, turni senza code e con i ritardi', async ({ pagina, gioco }) => {
  test.setTimeout(300_000);
  await avviaCorsa(pagina, { linea: '24' });
  const r = await pagina.evaluate(() => {
    const g = window.__game, T = g.trams, dt = 1 / 30;
    g.teleport(-2500, 3000);
    const nome = (t) => { for (const [id, k] of Object.entries(g.city.tramTracks)) for (const d of [1, -1]) if (k.terminals[d] === t) return `${id} ${k.stopsDir[d].slice(-1)[0].name}`; return '?'; };
    const prima = new Map(), fermo = new Map(), manovre = {}, attesa = {}, salti = [], fermi = [], ritardati = [];
    const t0 = g.mission.clock;
    for (let sec = 0; sec < 25 * 60; sec++) {
      g.sim(1, dt, false);
      if (sec === 60) for (const id of ['SIR1', 'SIR2', 'SIR3']) {
        const tr = T.trams.find((x) => x.line === id && x.run && x.run.next && !x.man && x.k >= 2 && x.k >= x.run.ss.length - 6 && x.k < x.run.ss.length - 1 && x.track.terminals[x.dir > 0 ? 1 : -1]);
        if (tr) { tr.wait = 240; ritardati.push({ tr, next: tr.run.next }); }
      }
      const per = {};
      for (const tr of T.trams) {
        // ogni cassa a un secondo di distanza è vicina a una cassa di prima (al cambio cabina la testa diventa la coda)
        const c = tr.mods.map((m) => [m.group.position.x, m.group.position.z]), p = prima.get(tr);
        if (p && p.length === c.length && c.some((a) => Math.min(...p.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))) > 12)) salti.push({ id: tr.id, line: tr.line });
        prima.set(tr, c);
        const t = tr.man ? tr.man.t : tr.esce || (tr.run && tr.k <= 1 && tr.s < tr.run.ss[0] + 1 && tr.track.terminals[tr.dir > 0 ? -1 : 1]);
        if (t) per[nome(t)] = (per[nome(t)] || 0) + 1;
        if (tr.man && tr.man.fase === 'fondo') manovre[nome(tr.man.t)] = true;
        const f = tr.v < 0.1 && tr.wait <= 0 && !tr.man && !(tr.run && tr.k === 0) ? (fermo.get(tr) || 0) + 1 : 0;
        fermo.set(tr, f);
        if (f === 90) fermi.push({ id: tr.id, line: tr.line, x: Math.round(tr.parts[0].x), z: Math.round(tr.parts[0].z) });
      }
      for (const [n, k] of Object.entries(per)) attesa[n] = Math.max(attesa[n] || 0, k);
    }
    // le corse dopo dei tram fermati le fa lo stesso tram; nessuna corsa partita nel frattempo è rimasta senza tram
    const turno = ritardati.map((r) => ({ line: r.tr.line, stesso: r.next.tram === r.tr, partitaDa: r.tr.run === r.next ? Math.round(g.mission.clock - r.next.t) : null }));
    const perse = T.runs.filter((r) => r.t > t0 + 120 && r.t < g.mission.clock - 60 && !r.tram).map((r) => `${r.line.id} ${r.v.stops[0].name}`);
    return { salti, manovre: Object.keys(manovre).sort(), attesa, fermi, turno, perse };
  });
  const testo = JSON.stringify(r);
  console.log('tram automatici:', testo);
  expect(r.salti, testo).toEqual([]);
  expect(r.manovre, testo).toEqual(['SIR1 Guizza Capolinea', 'SIR1 Pontevigodarzere', 'SIR2 Busa di Vigonza', 'SIR2 Rubano', 'SIR3 Voltabarozzo']);
  expect(Math.max(...Object.values(r.attesa)), testo).toBeLessThanOrEqual(2);
  expect(r.fermi, testo).toEqual([]);
  expect(r.turno.map((x) => x.line), testo).toEqual(['SIR1', 'SIR2', 'SIR3']);
  expect(r.turno.every((x) => x.stesso), testo).toBe(true);
  expect(r.perse, testo).toEqual([]);
  expect(gioco.errori()).toEqual([]);
});

// Voltabarozzo come nella realtà (segnalazione dell'11 novembre: "non riesco a chiudere il riepilogo per fare la
// manovra"): dalla fermata d'arrivo il riepilogo di fine corsa si chiude con Esc e il tram resta guidabile; B a banchina
// cambia solo cabina (si guida all'indietro e il navigatore dice di girarsi); il navigatore dice quanti metri fare per
// avere tutto il tram oltre lo scambio; lì B fa partire la corsa dopo sull'altro binario e il tram si ferma alla banchina
// di partenza, di fronte a quella d'arrivo, già tutto oltre lo scambio
test('Voltabarozzo: riepilogo chiuso con Esc, manovra oltre lo scambio, corsa dopo alla banchina di fronte', async ({ pagina, gioco }) => {
  const corsa = await avviaCorsa(pagina, { linea: 'SIR3', tram: true, verso: 0 });
  expect(corsa.ultima).toBe('Voltabarozzo');
  await pagina.evaluate(() => {
    const g = window.__game, m = g.mission, bus = g.bus, k = m.stops.length - 2;
    for (const st of m.stops.slice(0, k)) Object.assign(st, { arrived: true, left: true, doneMsg: true });
    m.nextStop = k;
    bus.setFront(m.stops[k].s - 0.5);
    m.s = bus.sFront - 12.45;
    m.clock = m.stops[k].sched - 30;
  });
  const arrivo = await guidaFermate(pagina, { fermate: 1 });
  expect(arrivo.every((e) => e.arrivato), JSON.stringify(arrivo)).toBe(true);
  // discesa: la corsa finisce, porte chiuse; il riepilogo arriva dopo qualche secondo
  await pagina.evaluate(() => {
    const g = window.__game, m = g.mission, bus = g.bus, dt = 1 / 30;
    for (let t = 0; t < 150 && !m.finished; t++) g.sim(1, dt, false);
    g.press('KeyF');
    for (let t = 0; t < 5 && !bus.doorsClosed; t += dt) g.sim(dt, dt, false);
  });
  // il riepilogo di questa corsa (al capolinea Voltabarozzo, col pulsante della manovra)
  await pagina.waitForFunction(() => !document.getElementById('results').classList.contains('hidden') && /Voltabarozzo/.test(document.getElementById('res-title').textContent) && !document.getElementById('res-manovra').hidden, null, { timeout: 15_000 });
  const r = await pagina.evaluate(() => {
    const g = window.__game, bus = g.bus, m = g.mission, dt = 1 / 30, $ = (id) => document.getElementById(id);
    const nav = () => $('nav-dist').textContent;
    const casse = () => bus.modules.map((x) => [x.group.position.x, x.group.position.z]);
    const ferme = (a, b) => Math.round(Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]))) * 100) / 100;
    const fino = (meta) => {
      bus.parking = false;
      for (let t = 0; t < 120; t += dt) {
        const resto = meta - bus.sFront, vt = Math.min(5, Math.sqrt(2 * 0.8 * Math.max(0, resto - 0.3))), e = vt - Math.abs(bus.v);
        if (vt > 0.05 && e > 0.3) g.keys.add('KeyW'); else g.keys.delete('KeyW');
        if ((vt <= 0.05 && Math.abs(bus.v) > 0.01) || e < -0.3) g.keys.add('KeyS'); else g.keys.delete('KeyS');
        g.sim(dt, dt, false);
        if (resto < 0.8 && Math.abs(bus.v) < 0.05) break;
      }
      g.keys.delete('KeyW'); g.keys.delete('KeyS');
    };
    const out = { manovra: !$('res-manovra').hidden };
    g.press('Escape');
    g.sim(0.2, dt, false);
    out.chiuso = $('results').classList.contains('hidden') && $('pause').classList.contains('hidden');
    out.nav = nav();
    // B a banchina: cambia solo cabina, il tram resta dov'è; di nuovo B e si torna verso il fondo
    let c0 = casse();
    g.press('KeyB'); g.sim(0.2, dt, false);
    out.banchina = { facing: bus.facing, stessa: g.mission === m, ferme: ferme(c0, casse()), nav: nav() };
    g.press('KeyB'); g.sim(0.2, dt, false);
    out.diNuovo = bus.facing;
    // avanti quanto dice il navigatore, poi B
    const metri = Number((out.nav.match(/(\d+) m/) || [])[1]);
    out.metri = metri;
    fino(bus.sFront + metri);
    out.navOltre = nav();
    c0 = casse();
    const t = bus.track.terminals[bus.dirSig];
    g.press('KeyB');
    for (let s = 0; s < 3 && g.mission === m; s += dt) g.sim(dt, dt, false);
    const m2 = g.mission;
    out.nuova = m2 !== m;
    out.ferme = ferme(c0, casse());
    fino(m2.stops[0].s - 0.5);
    g.sim(0.5, dt, false);
    out.inZona = !!(m2.stopInfo && m2.stopInfo.inZone && m2.stopInfo.st.idx === 0);
    // alla banchina di partenza la coda è oltre lo scambio (heel), e le due banchine stanno una di fronte all'altra
    out.oltreScambio = Math.round(bus.pathOffset + bus.sFront - bus.length - t.heel);
    const T = bus.track, a = T.stopsDir[t.arr].at(-1), d = T.stopsDir[t.dep][0];
    out.fronte = Math.round(Math.hypot(a.x - d.x, a.z - d.z));
    return out;
  });
  const testo = JSON.stringify(r);
  expect([r.manovra, r.chiuso], testo).toEqual([true, true]);
  expect(r.nav, testo).toMatch(/^Avanti \d+ m/);
  expect([r.banchina.facing, r.banchina.stessa, r.banchina.nav], testo).toEqual([-1, true, 'Cambia cabina (B)']);
  expect(r.banchina.ferme, testo).toBeLessThan(0.1);
  expect(r.diNuovo, testo).toBe(1);
  expect(r.metri, testo).toBeGreaterThan(20);
  expect(r.navOltre, testo).toBe('Cambia cabina (B)');
  expect([r.nuova, r.inZona], testo).toEqual([true, true]);
  expect(r.ferme, testo).toBeLessThan(0.1);
  expect(r.oltreScambio, testo).toBeGreaterThan(0);
  expect(r.fronte, testo).toBeLessThan(8);
  expect(gioco.errori()).toEqual([]);
});

// B quando si vuole, a tram fermo con le porte chiuse: in Esplorazione a metà linea il tram si inverte dov'è e torna
// indietro; in servizio a metà corsa la corsa resta quella, il navigatore dice di cambiare di nuovo cabina e con la
// cabina al contrario le fermate non si servono
test('B a metà linea: in Esplorazione e in servizio', async ({ pagina, gioco }) => {
  const prova = async (modo) => {
    await avviaCorsa(pagina, { linea: 'SIR3', tram: true, verso: 0, modo });
    return pagina.evaluate(() => {
      const g = window.__game, bus = g.bus, m = g.mission, dt = 1 / 30;
      g.traffic.target = 0; g.traffic.cars.splice(0);
      if (bus.doorTarget > 0) { g.press('KeyF'); g.sim(3, dt, false); }
      const casse = () => bus.modules.map((x) => [x.group.position.x, x.group.position.z]);
      // a metà linea, fermo
      bus.setFront(bus.path.len / 2);
      m.s = Math.max(0, bus.sFront - 6);
      bus.parking = false;
      g.sim(0.5, dt, false);
      const c0 = casse(), s0 = bus.sFront;
      g.press('KeyB');
      g.sim(0.2, dt, false);
      const c1 = casse();
      const out = { facing: bus.facing, stessa: g.mission === m, ferme: Math.round(Math.max(...c0.map((p, i) => Math.hypot(p[0] - c1[i][0], p[1] - c1[i][1]))) * 100) / 100, nav: document.getElementById('nav-dist').textContent };
      bus.parking = false;
      g.keys.add('KeyW'); g.sim(4, dt, false); g.keys.delete('KeyW');
      g.keys.add('KeyS'); g.sim(6, dt, false); g.keys.delete('KeyS');
      out.indietro = Math.round(s0 - bus.sFront);
      g.press('KeyB'); g.sim(0.2, dt, false);
      out.diNuovo = bus.facing;
      return out;
    });
  };
  const roam = await prova('roam'), servizio = await prova('service');
  const testo = JSON.stringify({ roam, servizio });
  expect([roam.facing, roam.ferme < 0.1, roam.indietro > 2, roam.diNuovo], testo).toEqual([-1, true, true, 1]);
  expect([servizio.facing, servizio.stessa, servizio.ferme < 0.1, servizio.nav, servizio.indietro > 2, servizio.diNuovo], testo).toEqual([-1, true, true, 'Cambia cabina (B)', true, 1]);
  expect(gioco.errori()).toEqual([]);
});

// Turni di chi guida il tram: gli stessi dei tram automatici, senza i tratti in cui il GTFS spezza ogni viaggio del
// SIR1. Prima, a Pontevigodarzere, la corsa dopo del turno poteva essere un tratto (→ Stazione FS, → Santo) invece
// della corsa intera per la Guizza (dalle 7 alle 18 ci sono solo corse intere; la sera anche corse corte vere, fino a
// Cavalletto). Un tratto scelto dal menu sta nel turno della corsa intera: prosegue con la sua corsa dopo se finisce al
// capolinea, altrimenti è l'ultima
test('turni del tram di chi guida: corse intere, come i tram automatici, e i tratti nel turno della corsa intera', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true });
  const r = await pagina.evaluate(() => {
    const g = window.__game, L = g.settings.line, sim = g.trams.runs.filter((x) => x.line === L);
    const nome = (v) => `${v.stops[0].name} → ${v.stops[v.stops.length - 1].name}`;
    const out = { diverse: 0, dopo: new Set(), tratti: [] };
    for (const v of L.variants) for (const { t } of v.feriale) {
      const tn = g.turnoOf(L, 'feriale', v, t);
      if (!tn) continue;
      const nx = tn.run.next;
      if (nx && t > 7 * 3600 && t < 18 * 3600) out.dopo.add(nome(nx.v));
      // la stessa corsa nei tram automatici ha la stessa corsa dopo
      const s = !tn.run.per && sim.find((x) => x.v === v && x.t === t);
      if (s && ((s.next && s.next.v) !== (nx && nx.v) || (s.next && s.next.t) !== (nx && nx.t))) out.diverse++;
      if (tn.run.per && t > 8 * 3600 && t < 8.5 * 3600) out.tratti.push({ tratto: nome(v), finisceInsieme: nome(v).endsWith(tn.run.per.v.stops[tn.run.per.v.stops.length - 1].name), ultima: tn.last, dopo: nx ? nome(nx.v) : null, nDiOf: tn.n <= tn.of });
    }
    out.dopo = [...out.dopo].sort();
    return out;
  });
  const testo = JSON.stringify(r);
  expect(r.diverse, testo).toBe(0);
  expect(r.dopo, testo).toEqual(['Guizza Capolinea → Pontevigodarzere', 'Pontevigodarzere → Guizza Capolinea']);
  expect(r.tratti.length, testo).toBeGreaterThan(4);
  for (const x of r.tratti) {
    expect(x.nDiOf, testo).toBe(true);
    expect(x.ultima, testo).toBe(!x.finisceInsieme || x.dopo == null);
  }
  expect(gioco.errori()).toEqual([]);
});
