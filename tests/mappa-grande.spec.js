// Mappa grande (M): trascinando si sposta senza teletrasportare, un clic senza trascinare teletrasporta.
import { test, expect, avviaCorsa } from './gioco.js';

test('mappa grande: trascinare la sposta, un clic teletrasporta', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '24', modo: 'free' });
  const prima = await pagina.evaluate(() => {
    const g = window.__game;
    g.sim(1, 1 / 30, true);
    g.press('KeyM');
    g.sim(0.2, 1 / 30, true);
    return { x: g.bus.x, z: g.bus.z, big: g.hud.big };
  });
  expect(prima.big).toBe(true);
  const box = await pagina.locator('#minimap').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // trascina di 150 px verso destra e 100 px verso il basso
  await pagina.mouse.move(cx, cy);
  await pagina.mouse.down();
  for (let i = 1; i <= 10; i++) await pagina.mouse.move(cx + 15 * i, cy + 10 * i);
  await pagina.mouse.up();
  const dopo = await pagina.evaluate(() => {
    const g = window.__game;
    g.sim(0.2, 1 / 30, true);
    return { x: g.bus.x, z: g.bus.z, big: g.hud.big, pan: g.hud.pan, cx: g.hud.bigView.cx - g.bus.x };
  });
  // la mappa segue il mouse: il centro va a sinistra e in alto (verso x e z minori), il mezzo resta dov'è
  expect(dopo.big).toBe(true);
  expect(dopo.pan.x).toBeLessThan(-100);
  expect(dopo.pan.z).toBeLessThan(-50);
  expect(dopo.cx).toBeCloseTo(dopo.pan.x, 0);
  expect(Math.hypot(dopo.x - prima.x, dopo.z - prima.z)).toBeLessThan(1);
  // un clic fermo teletrasporta e chiude la mappa
  await pagina.mouse.click(cx + 60, cy - 40);
  const clic = await pagina.evaluate(() => { const g = window.__game; return { x: g.bus.x, z: g.bus.z, big: g.hud.big }; });
  expect(clic.big).toBe(false);
  expect(Math.hypot(clic.x - prima.x, clic.z - prima.z)).toBeGreaterThan(20);
  expect(gioco.errori()).toEqual([]);
});
