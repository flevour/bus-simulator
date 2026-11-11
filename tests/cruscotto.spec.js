// Monitor della telecamera sull'ultima porta: acceso in cabina da fermi o con le porte aperte, spento in marcia e
// nelle altre visuali.
import { test, expect, avviaCorsa } from './gioco.js';

test('monitor della porta posteriore sul cruscotto', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '24' });
  const stato = await pagina.evaluate(() => {
    const g = window.__game, b = g.bus, monitor = () => document.getElementById('door-frame');
    const disegna = () => { g.sim(1 / 30, 1 / 30, true); g.sim(1 / 30, 1 / 30, true); };
    const out = {};
    g.setCam(0);
    if (!b.doorTarget) g.press('KeyF');
    g.sim(4, 1 / 30, false);
    disegna();
    out.fermo = monitor().style.display;
    out.scritta = monitor().textContent;
    g.press('KeyF');
    g.sim(4, 1 / 30, false);
    b.v = 10; disegna(); b.v = 10; disegna();
    out.inMarcia = monitor().style.display;
    b.v = 0;
    g.setCam(1);
    disegna();
    out.esterna = monitor().style.display;
    g.setCam(0);
    return out;
  });
  expect(stato.fermo).toBe('block');
  expect(stato.scritta).toContain('Porta');
  expect(stato.inMarcia).toBe('none');
  expect(stato.esterna).toBe('none');
  expect(gioco.errori()).toEqual([]);
});
