// Sorpresa alla DonQ (#91, src/world/sorpresa.js): l'edificio non ferma il bus, dentro c'è la foto sospesa davanti al
// bus, fuori no; i muri degli altri edifici restano e nessuna linea passa nell'edificio.
import { test, expect, avviaCorsa } from './gioco.js';

test('sorpresa alla DonQ: il bus entra nell\'edificio e vede la foto, fuori no', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '24', modo: 'roam' });
  // teletrasporto su Corso del Popolo, davanti all'edificio; la foto si scarica quando il bus è vicino
  await pagina.evaluate(() => { const g = window.__game; g.teleport(140, -935); g.sim(0.2, 1 / 30, false); });
  await pagina.waitForFunction(() => { const g = window.__game; g.city.ensureTiles(g.bus.x, g.bus.z, 650); return g.city.areasReady(g.bus.x, g.bus.z, 650); }, null, { polling: 100, timeout: 120_000 });
  await pagina.waitForFunction(() => { window.__game.sim(0.1, 1 / 30, false); return !!window.__game.scene.getObjectByName('sorpresa-donq'); }, null, { polling: 200, timeout: 30_000 });
  const stato = await pagina.evaluate(() => {
    const g = window.__game, b = g.bus, c = g.city, out = {};
    const dentro = (pts, x, z) => {
      let k = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], q = pts[j];
        if ((a.z > z) !== (q.z > z) && x < ((q.x - a.x) * (z - a.z)) / (q.z - a.z) + a.x) k = !k;
      }
      return k;
    };
    const t = c.tiles.get('sorpresa'), foto = g.scene.getObjectByName('sorpresa-donq'), pts = t.list[0].pts;
    out.pianta = dentro(pts, 129.73, -942.38);
    // muri: nessuno della DonQ tra gli ostacoli (quelli in comune con gli edifici accanto restano), quelli vicini sì
    out.muriDonq = t.obs.length;
    out.muriAltri = c.obstacles.query(115, -930, 60, []).filter((o) => o.kind === 'building' && !o.dead).length;
    // nessuna linea passa dentro l'edificio
    out.lineeDentro = [];
    for (const L of g.lines) for (const v of L.variants) for (let i = 0; i + 1 < v.nodes.length; i++) {
      const A = g.net.nodes[v.nodes[i]], B = g.net.nodes[v.nodes[i + 1]], l = Math.hypot(B.x - A.x, B.z - A.z);
      if (Math.hypot(A.x - 120, A.z - 930) > 2000 && Math.hypot(B.x - 120, B.z - 930) > 2000 && l < 1000) continue;
      for (let s = 0; s <= l; s += 1) if (dentro(pts, A.x + ((B.x - A.x) * s) / l, A.z + ((B.z - A.z) * s) / l)) { out.lineeDentro.push(L.id); break; }
    }
    out.fuori = foto.visible;
    // la foto si vede (centro nell'inquadratura, davanti alla telecamera) dal posto di guida e dalla vista da fuori
    const inquadrata = () => { const p = foto.getWorldPosition(foto.position.clone()).project(g.camera); return Math.abs(p.x) < 0.8 && Math.abs(p.y) < 0.8 && p.z < 1; };
    // dentro, rivolti verso Corso del Popolo: il posto di guida è nell'edificio
    b.place(120, -935, Math.PI / 2);
    g.setCam(0); g.sim(0.2, 1 / 30, true);
    out.dentro = foto.visible;
    out.immagine = foto.material.map.image.width + '×' + foto.material.map.image.height;
    out.cabina = inquadrata();
    out.edificioNascosto = t.meshes.every((m) => !m.visible);
    g.setCam(1); g.sim(1, 1 / 30, true);
    out.daFuori = inquadrata();
    g.setCam(0);
    // avanti piano verso Corso del Popolo: la facciata non ferma il bus, fuori la foto sparisce e l'edificio torna
    b.parking = false;
    g.keys.add('KeyW');
    for (let k = 0; k < 120 && b.toWorld(0, 4.8).x < 136; k++) g.sim(0.1, 1 / 30, false);
    g.keys.delete('KeyW');
    g.keys.add('KeyS');
    g.sim(2, 1 / 30, false);
    g.keys.delete('KeyS');
    out.posto = b.toWorld(0, 4.8).x;
    out.uscito = foto.visible;
    out.edificioVisto = t.meshes.every((m) => m.visible);
    return out;
  });
  expect(stato.pianta).toBe(true);
  expect(stato.muriDonq).toBe(0);
  expect(stato.muriAltri).toBeGreaterThan(20);
  expect(stato.lineeDentro).toEqual([]);
  expect(stato.fuori).toBe(false);
  expect(stato.dentro).toBe(true);
  expect(stato.immagine).toBe('1280×960');
  expect(stato.cabina).toBe(true);
  expect(stato.edificioNascosto).toBe(true);
  expect(stato.daFuori).toBe(true);
  expect(stato.posto).toBeGreaterThan(134);
  expect(stato.uscito).toBe(false);
  expect(stato.edificioVisto).toBe(true);
  expect(gioco.errori()).toEqual([]);
});
