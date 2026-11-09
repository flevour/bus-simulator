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
