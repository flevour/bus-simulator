// Tram al capolinea: B cambia solo cabina, il tram resta dov'è (all'anello della stazione riparte senza cambiarla) e
// parte la corsa successiva del turno dall'altro verso, senza tornare al menu. Dove lo scambio sta oltre le banchine si
// va in fondo al binario tronco, si cambia cabina e si riparte passando dallo scambio fino alla banchina di partenza.
import { test, expect, avviaCorsa } from './gioco.js';
import { guidaFermate } from './guida.js';

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

for (const c of [
  { nome: 'SIR3 a Stazione sud (anello, senza cambio cabina)', linea: 'SIR3', verso: 1, cabina: false, poi: 'Voltabarozzo' },
  { nome: 'SIR3 a Voltabarozzo (scambio oltre le banchine)', linea: 'SIR3', verso: 0, cabina: true, poi: 'Stazione sud' },
  // segnalazione dell'11 novembre: fermo oltre la banchina, in fondo al binario, il capolinea non si serviva più
  { nome: 'SIR3 a Voltabarozzo in fondo al binario', linea: 'SIR3', verso: 0, cabina: true, poi: 'Stazione sud', oltre: 30 },
  { nome: 'SIR1 a Guizza (scambio verso la città)', linea: 'SIR1', verso: 1, cabina: true, poi: 'Pontevigodarzere' },
]) {
  test(`B al capolinea: ${c.nome}`, async ({ pagina, gioco }) => {
    const corsa = await avviaCorsa(pagina, { linea: c.linea, tram: true, verso: c.verso });
    const r = await capolineaEB(pagina, c.oltre || 0);
    const testo = JSON.stringify(r);
    if (c.oltre) expect(r.fermo, testo).toBeGreaterThan(10);
    expect(r.finita, testo).toBe(true);
    if (r.aBanchina) expect(r.aBanchina, testo).toEqual({ stessaCorsa: true, verso: r.verso });
    expect(r.nuova, testo).toBe(true);
    expect(r.verso2, testo).toBe(-r.verso);
    // il tram resta dov'è: nessuna cassa si sposta; cambia la cabina, tranne all'anello
    expect(r.spostamento, testo).toBeLessThan(0.1);
    expect(r.cambiata, testo).toBe(c.cabina);
    expect(r.cabina, testo).toBe(c.cabina);
    expect(r.dest, testo).toBe(c.poi);
    expect(r.prima2, testo).toBe(corsa.ultima);
    expect(r.partenza, testo).toBe(r.prossima);
    expect(r.partenza, testo).toBeGreaterThan(corsa.partenza);
    expect(r.inZona, testo).toBe(true);
    expect(r.corse, testo).toBe(1);
    expect(r.riepilogo, testo).toBe(false);
    // la corsa nuova: salita alla prima fermata e guida fino alla seconda
    const esiti = await guidaFermate(pagina, { fermate: 1 });
    expect(esiti.every((e) => e.arrivato), JSON.stringify(esiti)).toBe(true);
    expect(gioco.errori()).toEqual([]);
  });
}

// Esplorazione: lo scambio del capolinea si gira (N). Diritto: B cambia solo cabina e il tram torna indietro sullo
// stesso binario. Deviato: B fa ripartire sul binario dell'altro verso passando dallo scambio
test('scambio del capolinea girato in Esplorazione', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR3', tram: true, verso: 0, modo: 'roam' });
  const r = await pagina.evaluate(() => {
    const g = window.__game, bus = g.bus, dt = 1 / 30, d = bus.dirSig, t = bus.track.terminals[d];
    const sw = g.city.tramSwitches.find((w) => w.term === t);
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
