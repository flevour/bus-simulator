// Freno d'emergenza del tram (#62): Backspace o clic sul fungo rosso della cabina. Il tram lanciato si ferma con la
// decelerazione d'emergenza (2,6 m/s² più le resistenze), il freno si riarma solo da fermo e, in servizio, tirato in
// marcia senza un ostacolo davanti costa 50 punti.
import { test, expect, avviaCorsa } from './gioco.js';

test('tram: freno d\'emergenza col tasto, frenata a 2,6 m/s² e riarmo solo da fermo', async ({ pagina, gioco }) => {
  // in Esplorazione il tram non deraglia: la frenata si misura lanciato a 54 km/h dove capita
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, modo: 'roam' });
  const r = await pagina.evaluate(() => {
    const g = window.__game, t = g.bus, dt = 1 / 30;
    g.sim(1, dt, false);
    t.parking = false; t.v = 15;
    const v0 = t.v, km0 = t.odometer;
    g.press('Backspace');
    g.sim(dt, dt, false);
    // ripremuto in marcia resta inserito
    g.press('Backspace');
    const inMarcia = t.emergency;
    let tempo = dt;
    while (t.v > 0 && tempo < 20) { g.sim(dt, dt, false); tempo += dt; }
    const fermo = { tempo, spazio: t.odometer - km0, emergenza: t.emergency };
    // fermo col freno inserito la trazione non va
    g.keys.add('KeyW');
    g.sim(2, dt, false);
    const conTrazione = t.v;
    // riarmato si riparte
    g.press('Backspace');
    const riarmato = !t.emergency;
    g.sim(3, dt, false);
    g.keys.delete('KeyW');
    return { v0, inMarcia, fermo, conTrazione, riarmato, ripartito: t.v };
  });
  console.log('freno d\'emergenza:', JSON.stringify(r));
  expect(r.inMarcia).toBe(true);
  expect(r.fermo.emergenza).toBe(true);
  // 15 m/s in circa 5,7 s e 43 m: 2,6 m/s² del freno più rotolamento e aria
  const dec = r.v0 / r.fermo.tempo;
  expect(dec).toBeGreaterThan(2.55);
  expect(dec).toBeLessThan(2.85);
  expect(r.fermo.spazio).toBeGreaterThan(38);
  expect(r.fermo.spazio).toBeLessThan(45);
  expect(r.conTrazione).toBe(0);
  expect(r.riarmato).toBe(true);
  expect(r.ripartito).toBeGreaterThan(1);
  expect(gioco.errori()).toEqual([]);
});

test('tram in servizio: freno d\'emergenza senza ostacolo davanti costa punti, con un ostacolo no', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true });
  const r = await pagina.evaluate(() => {
    const g = window.__game, t = g.bus, m = g.mission, dt = 1 / 30;
    g.sim(1, dt, false);
    // auto, bus e tram vicini decisi dalla prova: il traffico vero cambia da una volta all'altra
    const near = g.traffic.near, tnear = g.trams.near;
    const tira = (davanti, v = 10) => {
      g.traffic.near = () => davanti;
      g.trams.near = () => [];
      t.parking = false; t.v = v;
      const s0 = m.score;
      g.press('Backspace');
      g.traffic.near = near; g.trams.near = tnear;
      const punti = m.score - s0;
      for (let k = 0; t.v > 0 && k < 600; k++) g.sim(dt, dt, false);
      g.press('Backspace');
      return punti;
    };
    const senza = tira([]);
    const ultima = m.log[m.log.length - 1].msg;
    const p = t.at(t.sFront + t.facing * 25);
    const auto = tira([{ x: p.x, z: p.z }]);
    // l'auto di fianco al binario (3,5 m dall'asse) non è un ostacolo
    const q = t.at(t.sFront + t.facing * 25), lato = tira([{ x: q.x + q.dz * 3.5, z: q.z - q.dx * 3.5 }]);
    const piano = tira([], 1);
    // in fondo al percorso la fine del binario è un ostacolo
    t.setFront(t.facing > 0 ? t.path.len - 30 : 30);
    const fine = tira([]);
    return { senza, ultima, auto, lato, piano, fine, riarmato: !t.emergency };
  });
  console.log('penalità del freno d\'emergenza:', JSON.stringify(r));
  expect(r.senza).toBe(-50);
  expect(r.ultima).toContain('senza un ostacolo');
  expect(r.auto).toBe(0);
  expect(r.lato).toBe(-50);
  expect(r.piano).toBe(0);
  expect(r.fine).toBe(0);
  expect(r.riarmato).toBe(true);
  expect(gioco.errori()).toEqual([]);
});

test('tram: il clic sul fungo rosso della cabina fa il freno d\'emergenza', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, modo: 'roam' });
  // il fungo sullo schermo, nella vista dalla cabina
  const p = await pagina.evaluate(() => {
    const g = window.__game;
    g.setCam(0);
    g.sim(1 / 30, 1 / 30, true);
    const f = g.bus.activeCab.fungo, v = f.localToWorld(f.position.clone().set(0, 0.04, 0)).project(g.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, emergenza: g.bus.emergency };
  });
  expect(p.emergenza).toBe(false);
  await pagina.mouse.move(p.x, p.y);
  const cursore = await pagina.evaluate(() => document.getElementById('c').style.cursor);
  await pagina.mouse.click(p.x, p.y);
  const dopo = await pagina.evaluate(() => {
    const g = window.__game, f = g.bus.activeCab.fungo;
    g.sim(1 / 30, 1 / 30, false);
    return { emergenza: g.bus.emergency, giu: f.userData.cap.position.y < 0.04, icona: document.getElementById('icon-emerg').classList.contains('on') };
  });
  expect(cursore).toBe('pointer');
  expect(dopo).toEqual({ emergenza: true, giu: true, icona: true });
  // il clic accanto al fungo non lo preme: si riarma col tasto e si clicca 60 px più in là
  await pagina.evaluate(() => window.__game.press('Backspace'));
  await pagina.mouse.click(p.x - 60, p.y);
  expect(await pagina.evaluate(() => window.__game.bus.emergency)).toBe(false);
  expect(gioco.errori()).toEqual([]);
});
