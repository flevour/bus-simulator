// Volumi col terreno (#110, meccanismo 1 degli elementi che spariscono). Il terreno alza la geometria nel vertex shader
// e three.js sceglie cosa disegnare dalle bounding sphere senza quota: uno schermo, un volante, un palo spariscono dove
// la quota non è zero (#81). Il volume di ogni oggetto col terreno lo calcola un solo punto del codice, terrainVolume di
// src/world/terrain.js, e questa prova controlla che per ogni oggetto del mondo contenga tutti i vertici alzati: con
// una corsa in servizio (traffico, bus e tram automatici, pedoni) e tutta la mappa caricata. A zero, senza eccezioni:
// un oggetto fuori dal suo volume è un oggetto che può sparire dallo schermo.
import { test, expect, avviaCorsa } from './gioco.js';
import { misuraVolumi } from './volumi.js';

test('volumi col terreno: ogni oggetto del mondo sta nel volume che usa il culling', async ({ pagina, gioco }) => {
  test.setTimeout(600_000);
  await avviaCorsa(pagina, { linea: '24', modo: 'service' });
  await pagina.evaluate(async () => {
    const g = window.__game;
    await g.city.loadAll();
    g.city.ensureTiles(0, 0, 1e9);
    g.sim(20, 1 / 30, false); // traffico, tram e pedoni in giro
    g.sim(1 / 30, 1 / 30, true);
  });
  const r = await pagina.evaluate(misuraVolumi);
  console.log(`volumi col terreno: ${r.oggetti} oggetti (${r.senzaCulling} senza culling, ${r.sprite} sprite), ${r.vertici} vertici, ${r.fuori.length} fuori dal volume, ${r.ms} ms`);
  expect(r.oggetti).toBeGreaterThan(2000);
  expect(r.vertici).toBeGreaterThan(5e6);
  expect(r.fuori, 'oggetti con vertici fuori dal volume col terreno').toEqual([]);

  // la prova vede un volume sbagliato: un'istanza degli alberi spostata di 500 m senza rifare la sfera
  const manomesso = await pagina.evaluate((misura) => {
    const g = window.__game;
    let o = null;
    g.scene.traverse((m) => { if (!o && m.isInstancedMesh && m.frustumCulled && m.count > 10 && m.boundingSphere) o = m; });
    const M = g.scene.matrixWorld.clone(), era = M.clone();
    o.getMatrixAt(0, era);
    o.setMatrixAt(0, M.copy(era).setPosition(era.elements[12] + 500, era.elements[13], era.elements[14]));
    const r = new Function(`return (${misura})()`)();
    o.setMatrixAt(0, era);
    return r.fuori;
  }, misuraVolumi.toString());
  expect(manomesso.length, 'un\'istanza spostata senza rifare la sfera esce dal volume').toBe(1);
  expect(manomesso[0].fuori).toBeGreaterThan(100);
  expect(gioco.errori()).toEqual([]);
});
