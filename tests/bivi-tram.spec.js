// Rete dei binari con i bivi tra le linee (TramNet in src/tram/tram.js): dove il SIR2 corre sui binari del SIR1 o del
// SIR3, ai capi del tratto in comune c'è un bivio. In Esplorazione N gira il bivio più vicino davanti al tram e il tram
// prende il ramo su cui il bivio è messo, senza spostarsi (le casse non saltano); senza N resta sulla sua linea. Dopo un
// cambio cabina si prende di punta un'unione: N porta sull'altro binario anche andando all'indietro. In servizio i bivi
// si mettono da soli secondo la linea e N non li gira.
import { test, expect, avviaCorsa } from './gioco.js';

// Il tram a `prima` metri dal bivio (sul binario su cui corre, nel verso di marcia), N se `gira`, poi col manipolatore
// fino a `oltre` metri dopo il bivio. Restituisce il binario prima e dopo, lo stato del bivio e del segnale, il salto più
// grande di una cassa in un passo (oltre lo spostamento del tram) e lo scostamento dal binario su cui il tram risulta.
async function alBivio(page, { kind, gira, cabina = false, prima = 100, oltre = 60 }) {
  return page.evaluate(({ kind, gira, cabina, prima, oltre }) => {
    const g = window.__game, bus = g.bus, dt = 1 / 30, net = g.city.tramNet;
    g.traffic.target = 0; g.traffic.cars.splice(0);
    if (cabina) { g.press('KeyB'); g.sim(0.2, dt, false); }
    const fw = bus.facing > 0;
    const c = net.on(bus.track, bus.dirSig).filter(({ j }) => j.kind === kind).sort((a, b) => (fw ? a.s - b.s : b.s - a.s))[0];
    if (!c) return { nessuno: true };
    const { j, s } = c;
    bus.setFront(s - (fw ? prima : -prima));
    g.sim(0.6, dt, false);
    const out = { da: bus.track.id, ruolo: c.role, stato0: j.state };
    const toasts = [];
    const toast0 = g.hud.toast.bind(g.hud);
    g.hud.toast = (t, k) => { toasts.push(t); return toast0(t, k); };
    if (gira) g.press('KeyN');
    out.stato = j.state;
    out.segnale = j.sign.diverted.visible ? 'deviato' : 'diritto';
    out.atteso = j.state === j.dev ? 'deviato' : 'diritto';
    bus.parking = false;
    let salto = 0, prev = bus.modules.map((m) => [m.group.position.x, m.group.position.z]);
    g.keys.add('KeyW');
    for (let t = 0; t < 60; t += dt) {
      g.sim(dt, dt, false);
      const cc = bus.modules.map((m) => [m.group.position.x, m.group.position.z]);
      salto = Math.max(salto, ...cc.map((p, i) => Math.hypot(p[0] - prev[i][0], p[1] - prev[i][1]) - Math.abs(bus.v) * dt));
      prev = cc;
      const r = bus.track === j.x.T && bus.dirSig === j.x.dir ? j.x : bus.track === j.o.T && bus.dirSig === j.o.dir ? j.o : null;
      if (!r || (fw ? bus.sFront - r.s : r.s - bus.sFront) > oltre) break;
    }
    g.keys.delete('KeyW');
    g.hud.toast = toast0;
    const p = bus.path.at(bus.sFront), f = bus.at(bus.sFront);
    return { ...out, a: bus.track.id, salto: Math.round(salto * 100) / 100, sulBinario: Math.round(Math.hypot(p.x - f.x, p.z - f.z) * 100) / 100, toasts };
  }, { kind, gira, cabina, prima, oltre });
}

test('bivi in Esplorazione: N porta il tram sul binario dell\'altra linea, senza N resta sulla sua', async ({ pagina, gioco }) => {
  // SIR1 verso Pontevigodarzere: in stazione il SIR2 si stacca verso Pace
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, verso: 0, modo: 'roam' });
  const gira = await alBivio(pagina, { kind: 'diramazione', gira: true });
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, verso: 0, modo: 'roam' });
  const resta = await alBivio(pagina, { kind: 'diramazione', gira: false });
  const testo = JSON.stringify({ gira, resta });
  expect([gira.da, gira.stato0, gira.a], testo).toEqual(['SIR1', gira.ruolo, 'SIR2']);
  expect(gira.segnale, testo).toBe(gira.atteso);
  expect(gira.toasts.some((t) => /Bivio tra \d+ m: verso il binario del SIR2/.test(t)), testo).toBe(true);
  expect(gira.toasts.some((t) => /sei sul binario del SIR2/.test(t)), testo).toBe(true);
  expect([gira.salto < 0.05, gira.sulBinario < 0.05], testo).toEqual([true, true]);
  expect([resta.da, resta.a], testo).toEqual(['SIR1', 'SIR1']);
  expect(resta.salto, testo).toBeLessThan(0.05);
  expect(gioco.errori()).toEqual([]);
});

test('bivi in Esplorazione: dopo il cambio cabina N porta sull\'altro binario anche andando all\'indietro', async ({ pagina, gioco }) => {
  // SIR1 verso Pontevigodarzere con la cabina girata: si torna verso la Guizza e si prende di punta l'unione da cui il
  // SIR2 è arrivato sul binario del SIR1
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, verso: 0, modo: 'roam' });
  const r = await alBivio(pagina, { kind: 'unione', gira: true, cabina: true });
  const testo = JSON.stringify(r);
  expect([r.da, r.a], testo).toEqual(['SIR1', 'SIR2']);
  expect([r.salto < 0.05, r.sulBinario < 0.05], testo).toEqual([true, true]);
  expect(gioco.errori()).toEqual([]);
});

test('bivi in servizio: si mettono da soli per la linea e N non li gira', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, verso: 0 });
  const r = await pagina.evaluate(() => {
    const g = window.__game, bus = g.bus, m = g.mission, dt = 1 / 30, net = g.city.tramNet;
    g.traffic.target = 0; g.traffic.cars.splice(0);
    g.trams.setService([], m.variant); // nessun tram automatico che rimetta il bivio per sé
    const { j, role, s } = net.on(bus.track, bus.dirSig).find((c) => c.j.kind === 'diramazione');
    // il bivio messo per l'altra linea; il tram della corsa a 120 m
    j.state = role === 'x' ? 'o' : 'x';
    j.sign.update();
    bus.setFront(s - bus.pathOffset - 120);
    m.s = bus.sFront - 6;
    g.sim(1, dt, false);
    const out = { messo: j.state === role };
    g.press('KeyN');
    out.dopoN = j.state === role;
    bus.parking = false;
    g.keys.add('KeyW');
    for (let t = 0; t < 40 && bus.pathOffset + bus.sFront < s + 60; t += dt) g.sim(dt, dt, false);
    g.keys.delete('KeyW');
    out.track = bus.track.id;
    out.oltre = bus.pathOffset + bus.sFront > s + 30;
    return out;
  });
  expect(r, JSON.stringify(r)).toEqual({ messo: true, dopoN: true, track: 'SIR1', oltre: true });
  expect(gioco.errori()).toEqual([]);
});
