// Depositi del tram (TramYard in src/tram/tram.js, binari OSM di data/tram-depositi.json): in Esplorazione dal capolinea
// si entra nel deposito, si girano gli scambi con N e si va in fondo a un binario della rimessa; con B si torna indietro
// e, con gli scambi nella posizione di partenza (verso l'uscita), si esce sul binario della linea. Entrando dal binario
// d'arrivo della Guizza con gli scambi come stanno si gira attorno al deposito e si esce su quello di partenza, come
// con l'anello di ritorno. Le casse non saltano mai.
import { test, expect, avviaCorsa } from './gioco.js';
import { guidaFermate } from './guida.js';

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

// In servizio la prima corsa di un turno dalla Guizza esce dalla rimessa: fuori servizio, con gli scambi già messi, fino
// alla banchina di partenza, dove la corsa comincia. Dopo l'ultima corsa di un turno verso la Guizza il riepilogo
// propone il rientro in rimessa: con gli scambi messi si va in fondo a un binario della rimessa e il turno finisce
test('rimessa della Guizza in servizio: uscita della prima corsa del turno e rientro dopo l\'ultima', async ({ pagina, gioco }) => {
  const scegli = (verso, quale) => pagina.evaluate(({ verso, quale }) => {
    const g = window.__game, $ = (q) => document.querySelector(q);
    g.settings.departure = 0; g.settings.variant = 'feriale';
    $('#vehicle button[data-k="tram"]').click();
    $('.line-card[data-id="SIR1"]').click();
    $(`#direction button[data-d="${verso ? -1 : 1}"]`).click();
    $('#mode button[data-m="service"]').click();
    const L = g.settings.line, V = L.variants[g.settings.vIdx];
    const run = V.feriale.find(({ t }) => t > 6 * 3600 && (g.turnoOf(L, 'feriale', V, t) || {})[quale]);
    Object.assign(g.settings, { departure: run.t, depDur: run.d, fromDepot: true });
    g.startMission();
    return { ultima: g.mission.stops[g.mission.stops.length - 1].name, prima: g.mission.stops[0].name };
  }, { verso, quale });
  const aspetta = () => pagina.waitForFunction(() => { const g = window.__game; g.city.ensureTiles(g.bus.x, g.bus.z, 650); return g.city.areasReady(g.bus.x, g.bus.z, 650); }, null, { polling: 100, timeout: 120_000 });

  // uscita: dalla rimessa alla banchina di Guizza Capolinea
  const c1 = await scegli(0, 'first');
  await aspetta();
  const u = await pagina.evaluate(() => {
    const g = window.__game, bus = g.bus, m = g.mission, dt = 1 / 30;
    g.traffic.target = 0; g.traffic.cars.splice(0);
    g.sim(0.2, dt, false);
    const out = { dentro: !!bus.yard, fuori: m.depotOut, nav: document.getElementById('nav-dist').textContent };
    const pc = bus.yard && bus.yard.pieces[0];
    out.rimessa = !!(pc && pc.e && pc.e.tunnel);
    bus.parking = false;
    let prev = bus.modules.map((x) => [x.group.position.x, x.group.position.z]), salto = 0;
    const st0 = m.stops[0];
    for (let t = 0; t < 240; t += dt) {
      const resto = m.depotOut ? 1e9 : st0.s - 0.5 - bus.sFront;
      const vt = Math.min(4.7, Math.sqrt(2 * 0.8 * Math.max(0, resto - 0.3))), e = vt - Math.abs(bus.v);
      if (vt > 0.05 && e > 0.3) g.keys.add('KeyW'); else g.keys.delete('KeyW');
      if ((vt <= 0.05 && Math.abs(bus.v) > 0.01) || e < -0.3) g.keys.add('KeyS'); else g.keys.delete('KeyS');
      g.sim(dt, dt, false);
      const c = bus.modules.map((x) => [x.group.position.x, x.group.position.z]);
      if (Math.abs(bus.v) > 0.02) salto = Math.max(salto, ...c.map((p, i) => Math.hypot(p[0] - prev[i][0], p[1] - prev[i][1]) - Math.abs(bus.v) * dt));
      prev = c;
      if (!m.depotOut && resto < 0.8 && Math.abs(bus.v) < 0.05) break;
    }
    g.keys.delete('KeyW'); g.keys.delete('KeyS');
    g.press('KeyF');
    g.sim(2, dt, false);
    out.inLinea = !m.depotOut && !bus.yard && bus.track.id === 'SIR1';
    out.inZona = !!(m.stopInfo && m.stopInfo.inZone && m.stopInfo.st.idx === 0);
    out.servita = !!st0.arrived;
    out.salto = Math.round(salto * 100) / 100;
    return out;
  });
  const t1 = JSON.stringify({ c1, u });
  expect(c1.prima, t1).toBe('Guizza Capolinea');
  expect([u.dentro, u.fuori, u.rimessa, u.nav], t1).toEqual([true, true, true, 'Esci dalla rimessa']);
  expect([u.inLinea, u.inZona, u.servita], t1).toEqual([true, true, true]);
  expect(u.salto, t1).toBeLessThan(0.05);

  // rientro: ultima corsa di un turno verso la Guizza, dalla penultima fermata
  const c2 = await scegli(1, 'last');
  await aspetta();
  expect(c2.ultima).toBe('Guizza Capolinea');
  await pagina.evaluate(() => {
    const g = window.__game, m = g.mission, bus = g.bus, k = m.stops.length - 2;
    for (const st of m.stops.slice(0, k)) Object.assign(st, { arrived: true, left: true, doneMsg: true });
    m.nextStop = k;
    bus.setFront(m.stops[k].s - 0.5);
    m.s = bus.sFront - 12.45;
    m.clock = m.stops[k].sched - 30;
  });
  const arrivo = await guidaFermate(pagina, { fermate: 1 });
  expect(arrivo.every((e) => e.arrivato), JSON.stringify(arrivo)).toBe(true);
  await pagina.evaluate(() => {
    const g = window.__game, m = g.mission, bus = g.bus, dt = 1 / 30;
    for (let t = 0; t < 150 && !m.finished; t++) g.sim(1, dt, false);
    g.press('KeyF');
    for (let t = 0; t < 5 && !bus.doorsClosed; t += dt) g.sim(dt, dt, false);
  });
  await pagina.waitForFunction(() => !document.getElementById('results').classList.contains('hidden'), null, { timeout: 15_000 });
  const r = await pagina.evaluate(() => {
    const g = window.__game, bus = g.bus, dt = 1 / 30, $ = (id) => document.getElementById(id);
    const out = { pulsante: !$('res-depot').hidden && $('res-depot').textContent };
    $('res-depot').click();
    out.chiuso = $('results').classList.contains('hidden');
    bus.parking = false;
    let entrato = false;
    for (let t = 0; t < 240; t += dt) {
      if (Math.abs(bus.v) < 4.7) g.keys.add('KeyW'); else g.keys.delete('KeyW');
      g.sim(dt, dt, false);
      entrato = entrato || !!bus.yard;
      if (t > 3 && Math.abs(bus.v) < 0.02) break;
    }
    g.keys.delete('KeyW');
    g.sim(1, dt, false);
    const R = bus.yard, pc = R && R.pieces[R.piece(bus.sFront)];
    out.entrato = entrato;
    out.rimessa = !!(pc && pc.e && pc.e.tunnel);
    out.fine = !$('results').classList.contains('hidden') && $('res-title').textContent;
    return out;
  });
  const t2 = JSON.stringify(r);
  expect([r.pulsante, r.chiuso], t2).toEqual(['🅿️ Fine turno: rientra in rimessa', true]);
  expect([r.entrato, r.rimessa, r.fine], t2).toEqual([true, true, 'Turno finito: tram in rimessa']);
  expect(gioco.errori()).toEqual([]);
});

// Voltabarozzo: la seconda comunicazione (OSM 1453989053) va dal binario ovest verso sud a metà del binario di partenza.
// Sul binario di partenza, con la cabina girata verso sud, N mette lo scambio verso il deposito e il tram scende sulla
// comunicazione; senza N resta sul binario di partenza fino al suo inizio (e lì entra nel deposito dall'altra porta)
test('Voltabarozzo: la seconda comunicazione, a metà del binario di partenza, con N', async ({ pagina, gioco }) => {
  const giro = async (gira) => {
    await avviaCorsa(pagina, { linea: 'SIR3', tram: true, verso: 1, modo: 'roam' });
    return pagina.evaluate((gira) => {
      const g = window.__game, bus = g.bus, dt = 1 / 30, Y = g.city.tramYards.find((y) => y.name === 'Voltabarozzo'), mid = Y.ports.find((p) => p.mid);
      bus.setFront(98);
      g.sim(0.3, dt, false);
      g.press('KeyB');
      g.sim(0.2, dt, false);
      const a = bus.yardAhead();
      const out = { mezzo: !!mid, davanti: !!(a && a.port === mid) };
      if (gira) g.press('KeyN');
      out.stato = mid.state;
      bus.parking = false;
      let prev = bus.modules.map((m) => [m.group.position.x, m.group.position.z]), salto = 0, primo = null;
      for (let t = 0; t < 60 && !primo; t += dt) {
        if (Math.abs(bus.v) < 4.7) g.keys.add('KeyW'); else g.keys.delete('KeyW');
        g.sim(dt, dt, false);
        const c = bus.modules.map((m) => [m.group.position.x, m.group.position.z]);
        if (Math.abs(bus.v) > 0.02) salto = Math.max(salto, ...c.map((p, i) => Math.hypot(p[0] - prev[i][0], p[1] - prev[i][1]) - Math.abs(bus.v) * dt));
        prev = c;
        // il primo ramo del deposito dopo il binario della linea
        if (bus.yard) primo = bus.yard.pieces.find((pc) => pc.e).e.service;
      }
      g.keys.delete('KeyW');
      return { ...out, primo, salto: Math.round(salto * 100) / 100 };
    }, gira);
  };
  const si = await giro(true), no = await giro(false);
  const testo = JSON.stringify({ si, no });
  expect([si.mezzo, si.davanti, si.stato, si.primo], testo).toEqual([true, true, 'deposito', 'crossover']);
  expect([no.stato, no.primo], testo).toEqual(['linea', 'spur']);
  expect([si.salto < 0.05, no.salto < 0.05], testo).toEqual([true, true]);
  expect(gioco.errori()).toEqual([]);
});

// Tram automatici e rimessa (#61): la prima corsa di un turno dalla Guizza o da Voltabarozzo esce dalla rimessa (5 minuti
// prima, su un binario della rimessa, con gli scambi del deposito messi) fino alla banchina di partenza; dopo l'ultima il
// tram scende alla banchina d'arrivo e va in fondo a un binario della rimessa. Un tram alla volta per deposito, con lo
// scambio del capolinea. In pagina: `min` minuti dall'ora `da` con chi gioca lontano dai binari; registra uscite, rientri,
// tram fermi oltre 90 s (fuori da manovra, sosta e attesa in rimessa), i tram in sosta per capolinea, i salti delle casse
// (al secondo per tutti, a ogni passo entrando e uscendo dal deposito) e le corse rimaste senza tram
async function giroRimessa(page, { da, min }) {
  return page.evaluate(({ da, min }) => {
    const g = window.__game, T = g.trams, dt = 1 / 30;
    g.teleport(-2500, 3000);
    g.mission.clock = da;
    g.sim(dt, dt, false);
    const t0 = g.mission.clock;
    const nome = (t) => { for (const [id, k] of Object.entries(g.city.tramTracks)) for (const d of [1, -1]) if (k.terminals[d] === t) return `${id} ${k.stopsDir[d].slice(-1)[0].name}`; return '?'; };
    const casse = (tr) => tr.mods.map((m) => [m.group.position.x, m.group.position.z]);
    const out = { uscite: [], rientri: [], fermi: [], attesa: {}, salti: [], passi: [], scambi: [] };
    const sec = new Map(), passo = new Map(), fermo = new Map(), via = new Set(), dentro = new Map();
    for (let n = 0; n < min * 60 * 30; n++) {
      g.sim(dt, dt, false);
      for (const tr of T.trams) {
        const m = tr.rimessa;
        // a ogni passo, dentro e fuori dal deposito: ogni cassa si sposta quanto il tram
        if (m || dentro.get(tr)) {
          const c = casse(tr), p = passo.get(tr);
          const s = p ? Math.max(...c.map((a, i) => Math.hypot(a[0] - p[i][0], a[1] - p[i][1]))) - tr.v * dt : 0;
          if (s > 0.05) out.passi.push({ id: tr.id, line: tr.line, s: Math.round(s * 100) / 100 });
          passo.set(tr, c);
        } else passo.delete(tr);
        if (m && m.via && !via.has(tr)) {
          via.add(tr);
          if (m.ch.some(([sw, k]) => sw.state !== k)) out.scambi.push(tr.id);
        }
        // uscito: alla banchina di partenza, sul binario della linea
        if (dentro.get(tr) && dentro.get(tr).esce && !m) out.uscite.push({ line: tr.line, ritardo: Math.round(g.mission.clock + tr.wait - tr.run.t) });
        dentro.set(tr, m);
      }
      for (const [tr, m] of dentro) if (!T.trams.includes(tr)) { if (m && m.entra && m.parked) out.rientri.push({ line: tr.line, deposito: m.Y.name }); dentro.delete(tr); passo.delete(tr); sec.delete(tr); fermo.delete(tr); }
      if (n % 30) continue;
      const per = {};
      for (const tr of T.trams) {
        const c = casse(tr), p = sec.get(tr);
        if (p && p.length === c.length && c.some((a) => Math.min(...p.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))) > 12)) out.salti.push({ id: tr.id, line: tr.line });
        sec.set(tr, c);
        const m = tr.rimessa;
        // in sosta al capolinea: in manovra, fuori dallo scambio, alla banchina di partenza (anche venendo dal deposito;
        // non le corse che cominciano a metà linea, come Stazione FS → Pontevigodarzere la sera)
        const t = tr.man ? tr.man.t : tr.esce || (!m && tr.run && tr.k <= 1 && tr.run.ss[0] < 400 && tr.s < tr.run.ss[0] + 1 && tr.track.terminals[tr.dir > 0 ? -1 : 1]);
        if (t) per[nome(t)] = (per[nome(t)] || 0) + 1;
        const f = tr.v < 0.1 && tr.wait <= 0 && !tr.man && !(m && !m.via) && !(m && m.parked) && !(tr.run && tr.k === 0 && !m) ? (fermo.get(tr) || 0) + 1 : 0;
        fermo.set(tr, f);
        if (f === 90) out.fermi.push({ id: tr.id, line: tr.line, rimessa: !!m, x: Math.round(tr.parts[0].x), z: Math.round(tr.parts[0].z) });
      }
      for (const [k, v] of Object.entries(per)) {
        // chi c'era, la prima volta che un capolinea ne ha più di due
        if (v > 2 && !(out.attesa[k] > 2)) out.pieno = { k, ora: Math.round(g.mission.clock), chi: T.trams.filter((tr) => tr.man || tr.esce || (!tr.rimessa && tr.run && tr.k <= 1 && tr.run.ss[0] < 400 && tr.s < tr.run.ss[0] + 1)).map((tr) => ({ id: tr.id, line: tr.line, man: tr.man && tr.man.fase, esce: !!tr.esce, dir: tr.dir, s: Math.round(tr.s), k: tr.k, parte: tr.run && Math.round(tr.run.t) })) };
        out.attesa[k] = Math.max(out.attesa[k] || 0, v);
      }
    }
    // corse partite senza tram (dalla rimessa si può partire fino a 10 minuti dopo)
    out.perse = T.runs.filter((r) => !r.tram && r.t > t0 + 120 && (r.fromDepot ? r.t + 600 : r.t) < g.mission.clock - 60).map((r) => `${r.line.id} ${r.v.stops[0].name}`);
    out.passi = out.passi.slice(0, 5);
    return out;
  }, { da, min });
}

test('tram automatici: all\'inizio del servizio escono dalla rimessa della Guizza e di Voltabarozzo', async ({ pagina, gioco }) => {
  test.setTimeout(480_000);
  await avviaCorsa(pagina, { linea: '24' });
  const r = await giroRimessa(pagina, { da: 5 * 3600 + 10 * 60, min: 40 });
  const testo = JSON.stringify(r);
  console.log('rimessa, inizio del servizio:', testo);
  // SIR3 alle 5:21, 5:36 e 5:51; SIR1 dalle 5:35 (tre corse doppie del GTFS ogni 7 minuti: escono una alla volta)
  for (const line of ['SIR1', 'SIR3']) expect(r.uscite.filter((u) => u.line === line && u.ritardo <= 0).length, testo).toBeGreaterThan(0);
  expect(r.uscite.length, testo).toBeGreaterThanOrEqual(8);
  expect([r.fermi, r.salti, r.passi, r.scambi, r.perse], testo).toEqual([[], [], [], [], []]);
  expect(Math.max(...Object.values(r.attesa)), testo).toBeLessThanOrEqual(2);
  expect(gioco.errori()).toEqual([]);
});

test('tram automatici: alla fine del servizio rientrano nella rimessa della Guizza e di Voltabarozzo', async ({ pagina, gioco }) => {
  test.setTimeout(480_000);
  await avviaCorsa(pagina, { linea: '24' });
  const r = await giroRimessa(pagina, { da: 23 * 3600, min: 40 });
  const testo = JSON.stringify(r);
  console.log('rimessa, fine del servizio:', testo);
  // SIR3 a Voltabarozzo alle 23:09 e alle 23:24, SIR1 alla Guizza alle 23:13 e alle 23:28
  expect(r.rientri.filter((x) => x.deposito === 'Guizza').length, testo).toBeGreaterThanOrEqual(2);
  expect(r.rientri.filter((x) => x.deposito === 'Voltabarozzo').length, testo).toBeGreaterThanOrEqual(2);
  expect([r.fermi, r.salti, r.passi, r.scambi, r.perse], testo).toEqual([[], [], [], [], []]);
  expect(Math.max(...Object.values(r.attesa)), testo).toBeLessThanOrEqual(2);
  expect(gioco.errori()).toEqual([]);
});
