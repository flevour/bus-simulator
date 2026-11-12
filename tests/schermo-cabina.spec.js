// Schermo LCD della cabina del tram e cruscotto del bus dove il terreno non è a zero (#81). renderer.render alza la
// telecamera della quota del terreno e il vertex shader la geometria; il frustum culling di three.js guardava le
// bounding sphere senza quota, e gli oggetti piccoli a un metro dagli occhi venivano scartati (alla Guizza, a -1,1 m,
// l'LCD e il fungo del freno d'emergenza; a 7 m quadro strumenti e volante del bus). onBeforeRender si chiama solo per
// gli oggetti che passano il culling.
import { test, expect, avviaCorsa } from './gioco.js';

// mette nella pagina window.__disegnati(oggetti): per ogni oggetto quante volte three.js lo disegna in un fotogramma
// della vista dalla cabina (non negli specchietti, che guardano indietro)
const conDisegnati = (pagina) => pagina.evaluate(() => {
  window.__disegnati = (oggetti) => {
    const g = window.__game, n = oggetti.map(() => 0);
    oggetti.forEach((o, i) => { o.onBeforeRender = (r, sc, cam) => { if (cam === g.camera) n[i]++; }; });
    g.setCam(0);
    g.sim(1 / 30, 1 / 30, true);
    oggetti.forEach((o) => { delete o.onBeforeRender; });
    return n;
  };
});

test('tram alla Guizza: dalla cabina si disegnano lo schermo LCD e il fungo, non la cabina dietro', async ({ pagina, gioco }) => {
  const corsa = await avviaCorsa(pagina, { linea: 'SIR1', tram: true, modo: 'free' });
  await conDisegnati(pagina);
  const r = await pagina.evaluate(() => {
    const g = window.__game, t = g.bus, cab = t.activeCab;
    const dietro = t.modules[0] === cab ? t.modules[t.nMod - 1] : t.modules[0];
    const [lcd, fungo, base, lcdDietro] = window.__disegnati([cab.dash, cab.fungo.userData.cap, cab.fungo.children[0], dietro.dash]);
    return { quota: g.terrain.at(t.x, t.z), lcd, fungo, base, lcdDietro };
  });
  console.log('cabina del tram:', JSON.stringify({ partenza: corsa.prima, ...r }));
  expect(corsa.prima).toMatch(/Guizza/);
  // la prova vale dove la quota è lontana da zero (alla Guizza -1,1 m)
  expect(Math.abs(r.quota)).toBeGreaterThan(0.8);
  expect(r.lcd).toBeGreaterThan(0);
  expect(r.fungo).toBeGreaterThan(0);
  expect(r.base).toBeGreaterThan(0);
  // il culling c'è ancora: lo schermo dell'altra cabina, 30 m alle spalle, non si disegna
  expect(r.lcdDietro).toBe(0);
  expect(gioco.errori()).toEqual([]);
});

test('bus dove la quota è lontana da zero: dal posto di guida si disegnano quadro strumenti e volante', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '24', modo: 'free' });
  await conDisegnati(pagina);
  const r = await pagina.evaluate(() => {
    const g = window.__game, b = g.bus, T = g.terrain;
    // l'incrocio con la quota più lontana da zero dove il terreno è quasi piano (meno di 10 cm in 10 m): sui pendii
    // ripidi il vertex shader piega il bus stesso
    let best = { h: 0 };
    for (const n of Object.values(g.net.nodes)) {
      if (n.edges.length < 3) continue;
      const h = T.at(n.x, n.z);
      if (Math.abs(h) <= Math.abs(best.h)) continue;
      if (Math.abs(T.at(n.x + 5, n.z) - T.at(n.x - 5, n.z)) > 0.1 || Math.abs(T.at(n.x, n.z + 5) - T.at(n.x, n.z - 5)) > 0.1) continue;
      best = { h, x: n.x, z: n.z };
    }
    g.teleport(best.x, best.z);
    const rim = b.wheelRot.children[0];
    const [quadro, volante] = window.__disegnati([b.dash, rim]);
    return { quota: g.terrain.at(b.x, b.z), x: Math.round(b.x), z: Math.round(b.z), quadro, volante };
  });
  console.log('posto di guida del bus:', JSON.stringify(r));
  expect(Math.abs(r.quota)).toBeGreaterThan(3);
  expect(r.quadro).toBeGreaterThan(0);
  expect(r.volante).toBeGreaterThan(0);
  expect(gioco.errori()).toEqual([]);
});
