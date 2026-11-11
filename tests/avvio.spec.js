// Il gioco si carica, una corsa parte e la simulazione avanza senza errori.
import { test, expect, avviaCorsa } from './gioco.js';

for (const caso of [
  { nome: 'autobus, linea 24', linea: '24' },
  { nome: 'tram, SIR1', linea: 'SIR1', tram: true },
]) {
  test(`una corsa parte e avanza: ${caso.nome}`, async ({ pagina, gioco }) => {
    const corsa = await avviaCorsa(pagina, caso);
    expect(corsa.fermate).toBeGreaterThan(2);
    // 20 secondi di gioco da fermi, poi 15 con il gas: il mezzo deve muoversi
    const stato = await pagina.evaluate(() => {
      const g = window.__game;
      g.sim(20, 1 / 30, true);
      const x0 = g.bus.x, z0 = g.bus.z, clock0 = g.mission.clock;
      g.keys.add('KeyW');
      g.sim(15, 1 / 30, false);
      g.keys.delete('KeyW');
      g.sim(1, 1 / 30, true);
      return { spostamento: Math.hypot(g.bus.x - x0, g.bus.z - z0), tempo: g.mission.clock - clock0 };
    });
    expect(stato.tempo).toBeGreaterThan(15);
    expect(stato.spostamento).toBeGreaterThan(5);
    expect(gioco.errori()).toEqual([]);
  });
}

// il tram ferma a tutte le fermate: niente prenotazione e niente "si può passare" nel pannello della linea
test('il tram ferma a tutte le fermate, senza prenotazione', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true });
  const stato = await pagina.evaluate(() => {
    const g = window.__game, m = g.mission;
    g.sim(1, 1 / 30, true);
    return { tutte: m.stops.slice(1, -1).every((st) => m.needsStop(st)), riquadro: document.getElementById('request').hidden };
  });
  expect(stato.tutte).toBe(true);
  expect(stato.riquadro).toBe(true);
  expect(gioco.errori()).toEqual([]);
});

// fuori servizio (giro libero, esplorazione): niente traffico simulato e limitatore a 120 km/h; in servizio come prima
test('fuori servizio niente traffico e fino a 120 km/h, in servizio limitatore a 72', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '24', modo: 'free' });
  const libero = await pagina.evaluate(() => {
    const g = window.__game;
    g.sim(3, 1 / 30, false);
    return { vmax: g.bus.vmax, auto: g.traffic.cars.length, bus: g.buses.buses.length, tram: g.trams.trams.length };
  });
  expect(libero).toEqual({ vmax: 120, auto: 0, bus: 0, tram: 0 });
  // il tram in esplorazione (non deraglia) lanciato a 90 km/h accelera ancora
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, modo: 'roam' });
  const tram = await pagina.evaluate(() => {
    const g = window.__game, t = g.bus;
    g.sim(1, 1 / 30, false);
    t.parking = false; t.v = 25;
    g.keys.add('KeyW'); g.sim(3, 1 / 30, false); g.keys.delete('KeyW');
    return { vmax: t.vmax, kmh: t.speedKmh };
  });
  expect(tram.vmax).toBe(120);
  expect(tram.kmh).toBeGreaterThan(90);
  await avviaCorsa(pagina, { linea: '24' });
  const servizio = await pagina.evaluate(() => { const g = window.__game; g.sim(3, 1 / 30, false); return { vmax: g.bus.vmax, auto: g.traffic.cars.length }; });
  expect(servizio.vmax).toBe(72);
  expect(servizio.auto).toBeGreaterThan(0);
  expect(gioco.errori()).toEqual([]);
});
