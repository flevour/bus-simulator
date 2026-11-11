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

// specchietti regolabili: trascinati col mouse cambiano direzione, la regolazione resta nel browser, il doppio clic la
// azzera
test('specchietti regolabili col mouse', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '24' });
  await pagina.evaluate(() => { window.__game.setCam(0); window.__game.sim(1 / 30, 1 / 30, true); });
  const box = await pagina.locator('#mirror-frame-l').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await pagina.mouse.move(cx, cy);
  await pagina.mouse.down();
  await pagina.mouse.move(cx - 60, cy + 30, { steps: 6 });
  await pagina.mouse.up();
  const dopo = await pagina.evaluate(() => ({ adj: { ...window.__game.mirrorAdj[0] }, salvato: JSON.parse(localStorage.getItem('padova-bus-sim-specchietti') || 'null') }));
  await pagina.mouse.dblclick(cx - 60, cy + 30);
  const azzerato = await pagina.evaluate(() => {
    const a = { ...window.__game.mirrorAdj[0] };
    localStorage.removeItem('padova-bus-sim-specchietti');
    return a;
  });
  // trascinato a sinistra (verso il suo lato) guarda più in fuori, in giù più in basso
  expect(dopo.adj.yaw).toBeGreaterThan(0.08);
  expect(dopo.adj.pitch).toBeGreaterThan(0.04);
  expect(dopo.salvato[0].yaw).toBeCloseTo(dopo.adj.yaw, 5);
  expect(azzerato).toEqual({ yaw: 0, pitch: 0 });
  expect(gioco.errori()).toEqual([]);
});
