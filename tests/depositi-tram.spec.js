// Depositi del tram (TramYard in src/tram/tram.js, binari OSM di data/tram-depositi.json): in Esplorazione dal capolinea
// si entra nel deposito, si girano gli scambi con N e si va in fondo a un binario della rimessa; con B si torna indietro
// e, con gli scambi nella posizione di partenza (verso l'uscita), si esce sul binario della linea. Entrando dal binario
// d'arrivo della Guizza con gli scambi come stanno si gira attorno al deposito e si esce su quello di partenza, come
// con l'anello di ritorno. Le casse non saltano mai.
import { test, expect, avviaCorsa } from './gioco.js';

// In pagina: tram a `prima` metri dalla porta del deposito sul suo binario (scambio del capolinea `stato`), poi avanti.
// `tronco`: con N si girano gli scambi fino a un binario della rimessa che finisce (scelti con una ricerca nel grafo);
// in fondo B e di nuovo avanti fino all'uscita. Restituisce le fasi, il salto più grande di una cassa in un passo (oltre
// lo spostamento del tram, senza i passi in cui si ferma in fondo) e i messaggi.
async function nelDeposito(page, { deposito, stato, tronco, prima = 60 }) {
  return page.evaluate(({ deposito, stato, tronco, prima }) => {
    const g = window.__game, bus = g.bus, dt = 1 / 30, Y = g.city.tramYards.find((y) => y.name === deposito);
    const term = bus.track.terminals[bus.dirSig], pt = Y.ports.find((p) => p.T === bus.track && p.dir === bus.dirSig && p.kind === 'end');
    if (term && stato) term.state = stato;
    // posizioni degli scambi per arrivare in fondo a un binario della rimessa
    const voluti = new Map();
    if (tronco) {
      const seen = new Set();
      const dfs = (n, i, acc) => {
        if (seen.has(n + ':' + i)) return null;
        seen.add(n + ':' + i);
        const c = Y.through(n, i), sw = Y.switches.get(n + ':' + i);
        for (const k of c) {
          const E = Y.nodes[n].ends[k];
          if (E.port) continue;
          const nx = Y.endAt(E.e, E.at === 'a'), acc2 = sw ? [...acc, [sw, sw.options.indexOf(k)]] : acc;
          if (E.e.tunnel && !Y.through(nx.n, nx.i).length) return acc2;
          const r = dfs(nx.n, nx.i, acc2);
          if (r) return r;
        }
        return null;
      };
      for (const [sw, k] of dfs(pt.node, Y.portEnd(pt), []) || []) voluti.set(sw, k);
    }
    bus.setFront(pt.s - prima);
    g.sim(0.5, dt, false);
    const msg = [], toast0 = g.hud.toast.bind(g.hud);
    g.hud.toast = (t, k) => { msg.push(t); return toast0(t, k); };
    const out = { voluti: voluti.size, fasi: [], nN: 0 };
    let prev = bus.modules.map((m) => [m.group.position.x, m.group.position.z]), salto = 0;
    const passo = () => {
      g.sim(dt, dt, false);
      const c = bus.modules.map((m) => [m.group.position.x, m.group.position.z]);
      if (Math.abs(bus.v) > 0.02) salto = Math.max(salto, ...c.map((p, i) => Math.hypot(p[0] - prev[i][0], p[1] - prev[i][1]) - Math.abs(bus.v) * dt));
      prev = c;
    };
    // avanti a 18 km/h finché fin() o il tram si ferma; con N lo scambio davanti nella posizione voluta
    const guida = (fin, max = 300) => {
      bus.parking = false;
      for (let t = 0; t < max; t += dt) {
        const a = voluti.size && bus.yardAhead(200);
        if (a && voluti.has(a.sw) && a.sw.state !== voluti.get(a.sw)) { g.press('KeyN'); out.nN++; }
        if (Math.abs(bus.v) < 4.7) g.keys.add('KeyW'); else g.keys.delete('KeyW');
        passo();
        if (fin() || (t > 3 && Math.abs(bus.v) < 0.02)) break;
      }
      g.keys.delete('KeyW');
    };
    const dove = () => {
      const R = bus.yard, pc = R && R.pieces[R.piece(bus.sFront)];
      return { deposito: !!R, track: bus.track.id, dir: bus.dirSig, facing: bus.facing, rimessa: !!(pc && pc.e && pc.e.tunnel), fine: R ? Math.round(R.P.len - bus.sFront) : null };
    };
    guida(() => !!bus.yard);
    out.fasi.push({ fase: 'entrata', ...dove() });
    guida(() => !bus.yard);
    out.fasi.push({ fase: tronco ? 'fondo' : 'uscita', ...dove() });
    if (tronco) {
      g.keys.add('KeyS');
      for (let t = 0; t < 10 && Math.abs(bus.v) > 0.01; t += dt) passo();
      g.keys.delete('KeyS');
      voluti.clear();
      g.press('KeyB');
      passo();
      guida(() => !bus.yard);
      // ancora qualche metro sul binario della linea
      guida(() => false, 6);
      out.fasi.push({ fase: 'uscita', ...dove() });
    }
    g.hud.toast = toast0;
    out.salto = Math.round(salto * 100) / 100;
    out.msg = msg.filter((t) => /Deposito|Scambio/.test(t));
    return out;
  }, { deposito, stato, tronco, prima });
}

test('deposito della Guizza: con N fino in fondo a un binario della rimessa, B e fuori sul binario della linea', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, verso: 1, modo: 'roam' });
  const r = await nelDeposito(pagina, { deposito: 'Guizza', stato: 'diritto', tronco: true });
  const testo = JSON.stringify(r);
  const [entrata, fondo, uscita] = r.fasi;
  expect(r.voluti, testo).toBeGreaterThan(0);
  expect(r.nN, testo).toBeGreaterThan(0);
  expect(entrata.deposito, testo).toBe(true);
  expect([fondo.deposito, fondo.rimessa, fondo.fine <= 2], testo).toEqual([true, true, true]);
  expect([uscita.deposito, uscita.track], testo).toEqual([false, 'SIR1']);
  expect(r.salto, testo).toBeLessThan(0.05);
  expect(r.msg.some((t) => /Deposito Guizza/.test(t)) && r.msg.some((t) => /Scambio (deviato|diritto) tra \d+ m/.test(t)), testo).toBe(true);
  expect(gioco.errori()).toEqual([]);
});

test('deposito della Guizza: dal binario d\'arrivo con gli scambi come stanno si esce su quello di partenza', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, verso: 1, modo: 'roam' });
  for (const stato of ['diritto', 'deviato']) {
    const r = await nelDeposito(pagina, { deposito: 'Guizza', stato, tronco: false, prima: stato === 'deviato' ? 120 : 60 });
    const testo = JSON.stringify({ stato, r });
    const [entrata, uscita] = r.fasi;
    expect(entrata.deposito, testo).toBe(true);
    // fuori sul SIR1 in marcia verso la città (verso nord): diritto sul binario di partenza; deviato si entra dal tronco
    // del binario di partenza e si esce su quello d'arrivo, all'indietro
    expect([uscita.deposito, uscita.track, uscita.dir * uscita.facing], testo).toEqual([false, 'SIR1', 1]);
    if (stato === 'diritto') expect(uscita.dir, testo).toBe(1);
    expect(r.salto, testo).toBeLessThan(0.05);
    await avviaCorsa(pagina, { linea: 'SIR1', tram: true, verso: 1, modo: 'roam' });
  }
  expect(gioco.errori()).toEqual([]);
});

test('deposito di Voltabarozzo: dal binario d\'arrivo fino in fondo alla rimessa', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR3', tram: true, verso: 0, modo: 'roam' });
  const r = await nelDeposito(pagina, { deposito: 'Voltabarozzo', stato: 'diritto', tronco: false });
  const testo = JSON.stringify(r);
  const [entrata, fondo] = r.fasi;
  expect(entrata.deposito, testo).toBe(true);
  expect([fondo.deposito, fondo.fine <= 2], testo).toEqual([true, true]);
  expect(r.salto, testo).toBeLessThan(0.05);
  expect(gioco.errori()).toEqual([]);
});
