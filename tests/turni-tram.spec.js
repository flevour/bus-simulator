// Tram al capolinea: B cambia cabina (o all'anello della stazione passa sul binario dell'altro verso) e fa partire la
// corsa successiva del turno dalla prima fermata dell'altro verso, senza tornare al menu.
import { test, expect, avviaCorsa } from './gioco.js';
import { guidaFermate } from './guida.js';

// Salta alla fine della corsa: fermate prima del capolinea servite, tram 40 m prima della fine della banchina. Poi
// fino alla banchina col manipolatore, porte aperte finché scendono tutti (la corsa finisce) e B con le porte ancora
// aperte: si chiudono da sole e si cambia cabina.
async function capolineaEB(page) {
  return page.evaluate(() => {
    const g = window.__game, m = g.mission, bus = g.bus, n = m.stops.length, last = m.stops[n - 1], dt = 1 / 30;
    g.traffic.target = 0;
    g.traffic.cars.splice(0);
    for (const st of m.stops.slice(0, -1)) Object.assign(st, { arrived: true, left: true, doneMsg: true });
    m.nextStop = n - 1;
    bus.setFront(last.s - 0.5 - 40);
    m.s = bus.sFront - 12.45;
    m.clock = last.sched - 120;
    bus.parking = false;
    for (let i = 0; i < 30 * 90; i++) {
      const resto = last.s - 0.5 - bus.sFront, vt = Math.min(5, Math.sqrt(2 * 0.8 * Math.max(0, resto - 0.3))), e = vt - Math.abs(bus.v);
      if (vt > 0.05 && e > 0.3) g.keys.add('KeyW'); else g.keys.delete('KeyW');
      if ((vt <= 0.05 && Math.abs(bus.v) > 0.01) || e < -0.3) g.keys.add('KeyS'); else g.keys.delete('KeyS');
      g.sim(dt, dt, false);
      if (resto < 0.8 && Math.abs(bus.v) < 0.05) break;
    }
    g.keys.delete('KeyW');
    g.keys.delete('KeyS');
    g.press('KeyF');
    for (let t = 0; t < 120 && !m.finished; t++) g.sim(1, dt, false);
    const prima = { finita: m.finished, verso: bus.dirSig, h: bus.h, capolinea: last.name };
    g.press('KeyB');
    for (let t = 0; t < 8 && g.mission === m; t += dt) g.sim(dt, dt, false);
    g.sim(0.5, dt, false);
    const m2 = g.mission, si = m2.stopInfo, giro = Math.abs(Math.atan2(Math.sin(bus.h - prima.h), Math.cos(bus.h - prima.h)));
    return {
      ...prima, nuova: m2 !== m, verso2: bus.dirSig, cabina: giro > Math.PI / 2, prima2: m2.stops[0].name, dest: m2.dest,
      partenza: g.settings.departure, prossima: m2.departure, inZona: !!(si && si.inZone && si.st.idx === 0), muso: si && Math.round(si.along * 10) / 10,
      corse: g.turno.corse, riepilogo: !document.getElementById('results').classList.contains('hidden'),
    };
  });
}

for (const c of [
  { nome: 'SIR3 a Stazione sud (anello, senza cambio cabina)', verso: 1, cabina: false, poi: 'Voltabarozzo' },
  { nome: 'SIR3 a Voltabarozzo (cambio cabina)', verso: 0, cabina: true, poi: 'Stazione sud' },
]) {
  test(`B al capolinea: ${c.nome}`, async ({ pagina, gioco }) => {
    const corsa = await avviaCorsa(pagina, { linea: 'SIR3', tram: true, verso: c.verso });
    const r = await capolineaEB(pagina);
    const testo = JSON.stringify(r);
    expect(r.finita, testo).toBe(true);
    expect(r.nuova, testo).toBe(true);
    expect(r.verso2, testo).toBe(-r.verso);
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
