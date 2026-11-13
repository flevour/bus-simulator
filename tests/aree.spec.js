// Conto per area (#110, meccanismo 4 degli elementi che spariscono). Edifici, marciapiedi, verde e alberi arrivano per
// aree da 800 m attorno al mezzo e si tolgono quando si allontana (City.streamTiles): la build scrive per ogni area
// quanti oggetti ci sono per tipo (data/conto-aree.json, scripts/aree_mappa.py) e qui si confronta la scena con quel
// conto: alla partenza di una corsa, con tutte le aree entro un chilometro e mezzo, dopo essersi allontanati di 6 km e
// dopo essere tornati. Un'area caricata a metà, un riquadro di edifici perso, una mesh rimasta in scena dopo che la sua
// area è stata tolta fanno fallire la prova. A zero, senza eccezioni.
import { readFileSync } from 'node:fs';
import { test, expect, avviaCorsa } from './gioco.js';
import { contoScena } from './aree.js';

const CONTO = JSON.parse(readFileSync(new URL('../data/conto-aree.json', import.meta.url), 'utf8')).aree;
const VICINO = 1500, LONTANO = 2600; // AREA_NEAR e AREA_FAR di src/world/city.js

// fa passare i fotogrammi finché le aree entro VICINO metri sono in scena e i loro edifici costruiti
async function assesta(pagina) {
  await expect.poll(() => pagina.evaluate((r) => {
    const g = window.__game, c = g.city;
    g.sim(1, 1 / 30, false);
    return c.areasReady(g.bus.x, g.bus.z, r) && c.tilesBuilt === c.tiles.size;
  }, VICINO), { timeout: 180_000, intervals: [200] }).toBe(true);
  // le aree lontane si tolgono una volta al secondo: un altro giro dopo che è passato
  await pagina.waitForTimeout(1200);
  await pagina.evaluate(() => window.__game.sim(1, 1 / 30, false));
}

test('conto per area: la scena ha gli oggetti che la build ha contato, anche dopo essere andati via e tornati', async ({ pagina, gioco }) => {
  test.setTimeout(600_000);
  await avviaCorsa(pagina, { linea: '24', modo: 'service' });
  // altre prove sulla stessa pagina possono aver caricato tutta la mappa per sempre (city.loadAll): qui le aree si tolgono
  await pagina.evaluate(() => { window.__game.city.keepAreas = false; });
  const passi = {};
  const guarda = async (nome, raggio) => {
    const r = await pagina.evaluate(contoScena, CONTO);
    passi[nome] = r;
    console.log(`conto per area, ${nome} (${r.x}, ${r.z}): ${r.aggiunte} aree, ${r.edifici} edifici, ${r.riquadri} riquadri, ${r.differenze.length} differenze`);
    expect.soft(r.differenze, `${nome}: differenze tra la scena e il conto della build`).toEqual([]);
    expect.soft(r.aree.filter((a) => a.dist <= raggio && !a.aggiunta).map((a) => a.k), `${nome}: aree entro ${raggio} m non in scena`).toEqual([]);
    expect.soft(r.aree.filter((a) => a.fallita).map((a) => a.k), `${nome}: aree non arrivate`).toEqual([]);
    return r;
  };
  // alla partenza la corsa aspetta le aree entro 650 m
  await guarda('alla partenza', 650);
  await assesta(pagina);
  const qui = await guarda('assestato', VICINO);
  expect(qui.aggiunte).toBeGreaterThan(8);
  expect(qui.edifici).toBeGreaterThan(500);
  // via: a 6 km le aree di prima sono oltre LONTANO e si tolgono
  const torna = await pagina.evaluate(() => {
    const g = window.__game, qui = { x: g.bus.x, z: g.bus.z };
    let la = null;
    for (const n of Object.values(g.net.nodes)) {
      const d = Math.hypot(n.x - qui.x, n.z - qui.z);
      if (n.edges.length >= 2 && d > 6000 && (!la || d < la.d)) la = { x: n.x, z: n.z, d };
    }
    g.teleport(la.x, la.z);
    return qui;
  });
  await assesta(pagina);
  const la = await guarda('a 6 km', VICINO);
  expect.soft(la.aree.filter((a) => a.aggiunta && a.dist > LONTANO).map((a) => a.k), 'a 6 km: aree oltre 2600 m ancora in scena').toEqual([]);
  // e ritorno: la scena torna quella del conto, senza resti delle aree tolte
  await pagina.evaluate((p) => window.__game.teleport(p.x, p.z), torna);
  await assesta(pagina);
  const dopo = await guarda('al ritorno', VICINO);
  expect.soft(dopo.sciolte, 'mesh di verde e alberi fuori dalle aree: come prima di partire').toBe(qui.sciolte);
  expect(gioco.errori()).toEqual([]);
});
