// Bus elettrico: batteria all'inizio della corsa, colonnina di ricarica al capolinea (O abbassa e alza il pantografo),
// penalità se si riparte col pantografo giù, energia recuperata in frenata.
import { test, expect, avviaCorsa } from './gioco.js';

test('bus elettrico: ricarica alla colonnina del capolinea e recupero in frenata', async ({ pagina, gioco }) => {
  await pagina.evaluate(() => { window.__game.settings.livery = 'moderna'; });
  await avviaCorsa(pagina, { linea: '24' });
  const stato = await pagina.evaluate(() => {
    const g = window.__game, b = g.bus, m = g.mission, out = {};
    out.elettrico = b.electric;
    // il 5% in meno per ogni ora di servizio dalle 5:30
    out.batteria = b.battery;
    out.attesa = Math.max(0.15, Math.min(1, 1 - 0.05 * (g.settings.departure - 5.5 * 3600) / 3600));
    // alla partenza il bus è fermo sotto la colonnina
    out.sotto = !!g.chargers.at(b);
    g.sim(0.5, 1 / 30, false);
    b.battery = 0.5;
    g.press('KeyO');
    g.sim(3, 1 / 30, false);
    out.potenza = b.chargeKw;
    const b0 = b.battery;
    g.sim(30, 1 / 30, false);
    out.caricata = b.battery - b0;
    g.press('KeyO');
    g.sim(0.5, 1 / 30, false);
    out.potenzaDopo = b.chargeKw;
    // di nuovo giù, poi via col gas: penalità e pantografo su
    g.sim(3, 1 / 30, false);
    g.press('KeyO');
    g.sim(3, 1 / 30, false);
    const s0 = m.score;
    g.keys.add('KeyW');
    g.sim(4, 1 / 30, false);
    out.penalita = m.log.slice(-5).some((l) => l.msg.includes('pantografo della colonnina abbassato')) ? 1 : 0;
    out.punti = m.score - s0;
    // frenata da una decina di km/h: energia recuperata
    out.velocita = b.v;
    g.keys.delete('KeyW');
    const r0 = b.energy.regen;
    g.keys.add('KeyS');
    g.sim(3, 1 / 30, false);
    g.keys.delete('KeyS');
    out.recuperata = b.energy.regen - r0;
    out.usata = b.energy.used;
    return out;
  });
  expect(stato.elettrico).toBe(true);
  expect(stato.batteria).toBeCloseTo(stato.attesa, 2);
  expect(stato.sotto).toBe(true);
  expect(stato.potenza).toBeGreaterThan(250);
  // 30 s a 300 kW su 350 kWh: circa il 0,7%
  expect(stato.caricata).toBeGreaterThan(0.005);
  expect(stato.potenzaDopo).toBe(0);
  expect(stato.penalita).toBe(1);
  expect(stato.punti).toBeLessThanOrEqual(-100);
  expect(stato.velocita).toBeGreaterThan(1.5);
  expect(stato.recuperata).toBeGreaterThan(0.005);
  expect(stato.usata).toBeGreaterThan(0);
  expect(gioco.errori()).toEqual([]);
});
