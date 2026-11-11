// Tram in stazione: corse guidate di SIR3 e SIR2 attraverso gli anelli del piazzale (scambi tra gli anelli, raccordi
// verso Pace e verso ovest, testate), dalla fermata prima della stazione a quella dopo. Il pilota è quello di
// guida.js: deve arrivare a tutte le fermate senza urti contro ostacoli fissi.
import { test, expect, avviaCorsa } from './gioco.js';
import { guidaFermate } from './guida.js';

// Porta il tram alla fermata `da` della corsa avviata (muso a fine banchina), con le fermate prima già servite
async function portaAllaFermata(page, da) {
  return page.evaluate((da) => {
    const g = window.__game, m = g.mission, bus = g.bus, k = m.stops.findIndex((s) => s.name === da);
    if (k < 0) throw new Error(`fermata ${da} non nella corsa (${m.stops.map((s) => s.name).join(', ')})`);
    for (const st of m.stops.slice(0, k)) Object.assign(st, { arrived: true, left: true, doneMsg: true });
    m.nextStop = k;
    bus.setFront(m.stops[k].s - 0.5);
    m.s = bus.sFront - 12.45;
    m.clock = m.stops[k].sched - 30;
    return m.stops.slice(k).map((s) => s.name);
  }, da);
}

for (const c of [
  { linea: 'SIR3', verso: 0, da: 'Stazione sud', fermate: 2 }, // scambio sud-est verso l'anello esterno, uscita verso Pace
  { linea: 'SIR3', verso: 1, da: 'Gozzi', fermate: 3 }, // da Pace sulla testata est, scambio nord-est, anello interno
  { linea: 'SIR2', verso: 0, da: 'Eremitani', fermate: 3 }, // da ovest sull'anello esterno, scambio sud-ovest, Stazione sud
  { linea: 'SIR2', verso: 1, da: 'Pace', fermate: 3 }, // Stazione nord, scambio nord-ovest, testata esterna, verso sud
]) {
  test(`tram in stazione: ${c.linea} da ${c.da}, ${c.fermate} fermate`, async ({ pagina, gioco }, info) => {
    await avviaCorsa(pagina, { linea: c.linea, tram: true, verso: c.verso });
    const nomi = await portaAllaFermata(pagina, c.da);
    const esiti = await guidaFermate(pagina, { fermate: c.fermate });
    const testo = `${nomi.slice(0, c.fermate + 1).join(' → ')}\n` + esiti.map((e) => `${e.arrivato ? '✓' : '✗'} ${e.nome}: ${e.motivo}, ${e.metri} m in ${e.tempo} s` +
      `${e.urti.length ? `, urti: ${e.urti.map((u) => `${u.cosa} (${u.x}, ${u.z})`).join('; ')}` : ''}${e.arrivato ? '' : ` (${e.x}, ${e.z}) ${e.log.join(' | ')}`}`).join('\n');
    info.annotations.push({ type: 'stazione', description: testo });
    expect(esiti.length === c.fermate && esiti.every((e) => e.arrivato), testo).toBe(true);
    expect(esiti.flatMap((e) => e.urti), `urti contro ostacoli fissi\n${testo}`).toEqual([]);
    expect(gioco.errori()).toEqual([]);
  });
}
