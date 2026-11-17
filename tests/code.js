// Code vere (#115): le regole della prova di tests/code.spec.js. Non importa nulla da Playwright: le funzioni girano in
// pagina (page.evaluate) e le usano anche gli script di confronto prima e dopo.
//
// Tre misure:
//   - corridoio: su Via Querini (1,1 km a una corsia per verso, senza incroci, senza linee dei bus e lontano dai binari,
//     con un semaforo in fondo) le auto entrano dall'inizio a portate crescenti; a metà si contano quelle che passano
//     (flusso, auto l'ora per corsia) e quante ce ne sono in 500 m (densità, auto per km). Poi la coda ferma al rosso:
//     distanza tra le auto ferme (densità di coda) e, al verde, ogni quanti secondi un'auto passa la linea d'arresto
//     (scarico al semaforo);
//   - incrocio da liberare: un'auto ferma oltre l'incrocio in fondo al corridoio e cinque che arrivano col verde: quante
//     restano ferme dentro l'incrocio (sui raccordi della build ai nodi con tre o più vie);
//   - dieci minuti in tre zone (quelle della prova del moto), con il traffico della corsa delle 8:15: gli sblocchi a tempo
//     che scattano, i giri di attese, le auto ferme in coda dentro un incrocio e chi resta fermo oltre 120 s. Ogni caso
//     ha una chiave (cosa @ x,z) e si confronta con l'elenco data/eccezioni/code.json.
//
// Gli sblocchi si riconoscono da fuori, da quello che lasciano sui mezzi, così la prova gira uguale sul codice di prima
// e su quello di dopo:
//   - un'auto con overlapT a 3 esce di scena al passo dopo: se l'ha messo TramSim.update è l'auto ferma davanti al tram
//     (carT, dopo 20 s), se l'ha messo TramSignals.update è l'incrocio col tram occupato da auto ferme (unstick, dopo
//     20 s), se l'ha messo BusSim.update è l'auto ferma davanti a un bus automatico (dopo 15 s); quelle che lo prendono in
//     Traffic.update sono in fondo a una strada chiusa, e non sono uno sblocco. Dal 17 novembre (#115) l'auto sparisce
//     davanti a un tram o a un bus solo se aspetta proprio lui (c.aspetta): è un giro di attese, contato come tale;
//   - un tram con ignoreBusT a 10 passa attraverso i bus per 10 s (busT: dopo 90 s, o dopo 4 s se il bus aspetta lui:
//     allora è un giro di attese);
//   - un bus automatico con ignoreBusT appena messo a 4 passa attraverso un altro bus che aspetta lui (dopo 8 s);
//   - un'auto con through appena preso è uscita da un giro di attese (Traffic.untangle);
//   - un'auto con passT appena messo a 9 sorpassa un bus fermo: se il bus è in fermata è un sorpasso vero, se è il bus di
//     chi gioca anche (chi gioca non è nel modello: fermo in corsia è un ostacolo come un furgone), altrimenti è un bus
//     in coda sorpassato dopo 12 s.
// Il bus di chi gioca sorpassato da un bus automatico (passT a 12) non è uno sblocco, per lo stesso motivo.

// un nodo con almeno tre vie carrabili è un incrocio; il raccordo che ci passa è l'incrocio lungo il percorso dell'auto,
// allungato a metà della via più larga che lo taglia quando è più corto (un raccordo dritto può essere lungo zero). Col
// semaforo l'incrocio comincia alla linea d'arresto, se il raccordo comincia prima (incrocioDi)
function scatola(g, p) {
  const N = g.net.nodes, n = N[p.R.n];
  if (n.edges.filter((e) => !e.ped).length < 3 && !p.R.via.length) return null;
  let w = 0;
  for (const e of n.edges) if (!e.ped && e !== p.R.da && e !== p.R.a) w = Math.max(w, e.width);
  const pad = Math.max(0, (w - p.len) / 2);
  return { q0: p.q0 - pad, q1: p.q0 + p.len + pad, n };
}

// l'incrocio in cui l'auto c sta con la carrozzeria (dal muso, 2,1 m davanti al centro, alla coda), o null
export function incrocioDi(g, c) {
  const qc = c.q + 1.35, qn = qc + 2.1, qr = qc - 2.1;
  const ev = c.ev[0];
  for (const p of c.per.pezzi) {
    if (p.tipo !== 'raccordo' || !p.R || p.q0 > qn + 10) continue;
    const b = scatola(g, p);
    if (b && ev && ev.q > b.q0 && ev.q < b.q1) b.q0 = ev.q;
    if (b && b.q0 < qn - 0.3 && b.q1 > qr + 0.3) return b;
  }
  return null;
}

// in pagina: comincia a guardare. window.__code.fine() smette e dà casi, conti e tempi per passo
export function osservaCode({ fermo = 120, scatola }) {
  const g = window.__game, T = g.traffic, B = g.buses, TS = g.tramSignals, TR = g.trams;
  const casi = [], conti = {}, aperti = new Map();
  const scatolaDi = new Function('return ' + scatola)();
  const round = (v) => Math.round(v);
  // window.__codeInfo(mezzo, tipo), se c'è, allega al caso lo stato del mezzo (per chi cerca la causa)
  const caso = (tipo, x, z, info = {}, o = null) => {
    if (o && window.__codeInfo) info.stato = window.__codeInfo(o, tipo);
    casi.push({ chiave: `${tipo} @ ${round(x)},${round(z)}`, tipo, ora: g.mission.clock, ...info });
    conti[tipo] = (conti[tipo] || 0) + 1;
  };
  const segnate = new WeakSet(), ignorava = new WeakMap();
  const nuoveTre = () => { const out = []; for (const c of g.traffic.cars) if (c.overlapT === 3 && !segnate.has(c)) { segnate.add(c); out.push(c); } return out; };
  const tempi = { traffico: 0, bus: 0, passi: 0, auto: 0 };
  // il bus fermo davanti all'auto c (quello che sorpassa): il bus di chi gioca o uno automatico, entro 40 m
  const busDavanti = (c) => {
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    let best = null, bd = Infinity;
    const prova = (p, chi) => { const dx = p.x - c.x, dz = p.z - c.z, f = dx * fx + dz * fz; if (f > 0 && f < 40 && Math.abs(dx * fz - dz * fx) < 2.6 && f < bd) { bd = f; best = chi; } };
    const pl = g.bus.worldCircles ? g.bus.worldCircles() : [];
    for (const p of pl) prova(p, 'giocatore');
    for (const b of B.buses) for (const p of b.circles || []) prova(p, b);
    return best;
  };
  const o = { trams: TR.update, segnali: TS.update, traffico: T.update, bus: B.update };
  TR.update = function (...a) {
    o.trams.apply(this, a);
    for (const c of nuoveTre()) caso(c.aspetta || c.tramAttesi ? 'auto e tram che si aspettano' : 'auto sparita davanti al tram', c.x, c.z, {}, c);
    for (const tr of TR.trams) {
      if (tr.ignoreBusT !== 10 || !tr.parts.length) continue;
      // il bus fermo davanti aspetta proprio questo tram (waitTram, o l'incrocio che lui ha chiamato): è un giro di attese
      const h = tr.parts[0], tiene = B.buses.some((b) => Math.hypot(b.x - h.x, b.z - h.z) < 30 && (b.waitTram === tr || (b.waitX && b.waitX.who && b.waitX.who.includes(tr))));
      caso(tiene ? 'tram e bus che si aspettano' : 'tram attraverso un bus', h.x, h.z, { linea: tr.line }, tr);
    }
  };
  TS.update = function (...a) {
    o.segnali.apply(this, a);
    for (const c of nuoveTre()) caso('auto sparita sui binari', c.x, c.z, {}, c);
  };
  T.update = function (...a) {
    const prima = new Set(T.cars.filter((c) => c.through));
    const t0 = performance.now();
    o.traffico.apply(this, a);
    tempi.traffico += performance.now() - t0;
    tempi.auto += T.cars.length;
    tempi.passi++;
    nuoveTre(); // in fondo a una strada chiusa: non è uno sblocco
    for (const c of T.cars) {
      if (c.through && !prima.has(c)) caso('giro di attese', c.x, c.z, {}, c);
      if (c.passT > 8.95) {
        const b = busDavanti(c);
        if (b && b !== 'giocatore' && !b.atStop) caso('auto sorpassa un bus in coda', c.x, c.z, { linea: b.run.L.id });
      }
    }
  };
  B.update = function (...a) {
    const t0 = performance.now();
    o.bus.apply(this, a);
    tempi.bus += performance.now() - t0;
    for (const c of nuoveTre()) caso(c.aspetta ? 'auto e bus che si aspettano' : 'auto sparita davanti a un bus', c.x, c.z, {}, c);
    for (const b of B.buses) {
      const ign = b.ignoreBusT > 3.9;
      if (ign && !ignorava.get(b)) caso('bus attraverso un bus', b.x, b.z, { linea: b.run.L.id });
      ignorava.set(b, ign);
    }
    misura();
  };
  // ogni mezzo secondo: auto ferme in coda dentro un incrocio (oltre 2 s), mezzi fermi oltre `fermo` secondi
  let dt = 0;
  const fermi = new Map(), inCoda = new Map();
  // in coda: un mezzo fermo o quasi (sotto 1,5 m/s) nello stesso verso (entro 60 gradi), a meno di 7 m davanti al muso.
  // Chi taglia la strada o passa (un tram, un'auto che attraversa) non è una coda, e nemmeno chi aspetta i binari
  // chiamati da un tram entro 15 m (Traffic.calledAhead): lì ci si ferma anche dentro l'incrocio, per il tram. Il bus di
  // chi gioca non conta: non è nel traffico, e la prova lo lascia fermo dove lo mette il teletrasporto (nella zona
  // sud-est dentro un incrocio, e chi arriva dietro aspetta lì finché non lo sorpassa)
  const davanti = (c) => {
    if (T.calledAhead(c, TS) < 15) return false;
    const fx = Math.sin(c.h), fz = Math.cos(c.h), nx = c.x + fx * 2.1, nz = c.z + fz * 2.1;
    const vicino = (p, h, v) => { const dx = p.x - nx, dz = p.z - nz, f = dx * fx + dz * fz; return Math.abs(v) < 1.5 && f > -1 && f < 7 && Math.abs(dx * fz - dz * fx) < 2 && Math.cos(h - c.h) > 0.5; };
    for (const q of T.near(nx, nz, 10)) if (q !== c && q.car && vicino(q, q.h, q.v)) return true;
    for (const b of B.buses) if (Math.abs(b.x - nx) < 20 && Math.abs(b.z - nz) < 20 && (b.circles || []).some((p) => vicino(p, b.h, b.v))) return true;
    for (const p of TR.near(nx, nz, 10)) if (vicino(p, p.h, p.tram ? p.tram.v : 0)) return true;
    return false;
  };
  const misura = () => {
    if ((dt += 1 / 30) < 0.5) return;
    dt = 0;
    const ora = g.mission.clock, vivi = new Set();
    const segna = (o, fermoOra, x, z, chi) => {
      vivi.add(o);
      if (!fermoOra) { const f = fermi.get(o); if (f && f.contato) f.contato = false; fermi.delete(o); return; }
      const f = fermi.get(o) || fermi.set(o, { da: ora, x, z }).get(o);
      if (!f.contato && ora - f.da > fermo) { f.contato = true; caso(`${chi} fermo oltre ${fermo} s`, f.x, f.z, {}, o); }
    };
    for (const c of T.cars) {
      // in fondo a una strada chiusa vicino a chi gioca l'auto resta lì: è parcheggiata
      segna(c, c.v < 0.1 && !(c.chiusa && c.per.fine - c.q < 8), c.x, c.z, 'auto');
      const s = c.v < 0.1 ? scatolaDi(g, c) : null;
      if (s && davanti(c)) {
        const k = inCoda.get(c) || inCoda.set(c, { da: ora, n: s.n, contato: false }).get(c);
        if (!k.contato && ora - k.da > 2) { k.contato = true; caso('auto in coda nell\'incrocio', k.n.x, k.n.z, {}, c); }
      } else inCoda.delete(c);
    }
    for (const b of B.buses) segna(b, b.v < 0.1 && !b.atStop, b.x, b.z, 'bus');
    for (const tr of TR.trams) if (tr.parts.length) segna(tr, tr.v < 0.1 && tr.wait <= 0 && !tr.man && !tr.rimessa, tr.parts[0].x, tr.parts[0].z, 'tram');
    for (const k of fermi.keys()) if (!vivi.has(k)) fermi.delete(k);
  };
  window.__code = {
    fine: () => {
      delete TR.update; delete TS.update; delete T.update; delete B.update;
      return { casi, conti, tempi: { traffico: tempi.traffico / Math.max(1, tempi.passi), bus: tempi.bus / Math.max(1, tempi.passi), auto: tempi.auto / Math.max(1, tempi.passi), passi: tempi.passi } };
    },
  };
}
// incrocioDi come testo, per le funzioni in pagina (page.evaluate porta il testo della funzione, non il modulo)
export const SCATOLA = `function (g, c) { ${scatola.toString()}; return (${incrocioDi.toString()})(g, c); }`;

// in pagina: sec secondi di gioco in ognuna delle zone (osservaCode già chiamata)
export function giraZoneCode({ zone, sec, dt = 1 / 30 }) {
  const g = window.__game;
  for (const z of zone) {
    g.teleport(z.x, z.z);
    g.sim(sec, dt, false);
  }
  return window.__code.fine();
}

// ------------------------------------------------------------------
// Il corridoio di Via Querini
// ------------------------------------------------------------------
// in pagina: prepara il corridoio (window.__cor) dall'arco che arriva al semaforo vicino a (sx, sz) e con il nome dato,
// risalendo la via finché i nodi hanno due archi; oltre il semaforo la via più dritta per tre archi. Il semaforo di
// quell'impianto si forza con __cor.forza ('G', 'R', o null per il suo ciclo). Chi gioca va su una strada a più di
// 120 m dal corridoio, e le auto della corsa escono di scena: restano solo quelle che la prova mette
export function corridoio({ sx, sz, nome }) {
  const g = window.__game, N = g.net.nodes, T = g.traffic;
  const sig = Object.values(N).filter((n) => n.signal && n.edges.some((e) => e.name === nome)).sort((a, b) => Math.hypot(a.x - sx, a.z - sz) - Math.hypot(b.x - sx, b.z - sz))[0];
  // l'arco d'arrivo: quello della via da cui si risale più a lungo senza incroci
  const risali = (app) => {
    const chain = [];
    let cur = app, to = sig;
    for (let k = 0; k < 200; k++) {
      const from = N[cur.a === to.id ? cur.b : cur.a];
      chain.unshift({ edge: cur, fwd: cur.b === to.id });
      if (from.edges.length !== 2) break;
      cur = from.edges[0] === cur ? from.edges[1] : from.edges[0];
      to = from;
    }
    return chain;
  };
  const chain = sig.edges.filter((e) => e.name === nome && T.allowed(e, e.b === sig.id)).map(risali).sort((a, b) => b.reduce((s, x) => s + x.edge.len, 0) - a.reduce((s, x) => s + x.edge.len, 0))[0];
  const app = chain[chain.length - 1].edge;
  const cum = [0];
  for (const c of chain) cum.push(cum[cum.length - 1] + c.edge.len);
  const dopo = [];
  let e = app, n = sig;
  for (let k = 0; k < 3; k++) {
    const f = e.b === n.id, dx = f ? e.dx : -e.dx, dz = f ? e.dz : -e.dz;
    let best = null, bd = 0.5;
    for (const e2 of n.edges) { if (e2 === e || e2.ped) continue; const f2 = e2.a === n.id, d = (f2 ? e2.dx : -e2.dx) * dx + (f2 ? e2.dz : -e2.dz) * dz; if (d > bd && T.allowed(e2, f2)) { bd = d; best = { edge: e2, fwd: f2 }; } }
    if (!best) break;
    dopo.push(best); e = best.edge; n = N[best.fwd ? e.b : e.a];
  }
  const L = cum[cum.length - 1], linea = L - g.lights.stopOn(app, sig).t, S0 = sig.signal;
  const C = (window.__cor = { chain, cum, dopo, sig, L, linea, forza: null });
  const orig = g.lights.constructor.prototype.stateOf;
  // i semafori restano da una corsa all'altra: a fine prova il fixture `pagina` di tests/gioco.js toglie questa
  // sostituzione (prima restava, col verde forzato, per tutte le prove dopo sulla stessa pagina: #145)
  g.lights.stateOf = function (s, ph) { return s === S0 && C.forza ? C.forza : orig.call(this, s, ph); };
  // posizione del centro dell'auto lungo il corridoio (oltre il semaforo: L più quanto ha fatto; null altrove)
  C.pos = (c) => {
    const i = chain.findIndex((x) => x.edge === c.edge);
    if (i >= 0) return cum[i] + c.s;
    const j = dopo.findIndex((x) => x.edge === c.edge);
    return j >= 0 ? L + dopo.slice(0, j).reduce((s, x) => s + x.edge.len, 0) + c.s : null;
  };
  // un'auto della prova col centro a P metri dall'inizio del corridoio, ferma o a v m/s, che lo segue fino in fondo
  C.metti = (P, v = 0) => {
    let i = 0;
    while (i < chain.length - 1 && cum[i + 1] <= P) i++;
    const c = T.nuova(chain[i].edge, chain[i].fwd, P - cum[i], [...chain.slice(i + 1), ...dopo]);
    c.v = v;
    T.cars.push(c);
    return c;
  };
  // chi gioca su una strada a più di 120 m dal corridoio, entro 500 m dalla sua metà (le auto restano entro 1700 m)
  const M = N[chain[Math.floor(chain.length / 2)].edge.a];
  let best = null;
  for (let a = 0; a < 8; a++) for (const r of [250, 350, 450]) {
    const s = g.city.snapToRoad(M.x + Math.cos(a * 0.785) * r, M.z + Math.sin(a * 0.785) * r, 120);
    if (!s) continue;
    let d = Infinity;
    for (const x of [...chain, ...dopo]) { const A = N[x.edge.a]; for (let t = 0; t <= x.edge.len; t += 10) d = Math.min(d, Math.hypot(A.x + x.edge.dx * t - s.cx, A.z + x.edge.dz * t - s.cz)); }
    if (d > 120 && (!best || d < best.d)) best = { x: s.cx, z: s.cz, d };
  }
  g.teleport(best.x, best.z);
  g.sim(0.5, 1 / 30, false);
  T.cars.length = 0;
  T.target = 0;
  const A = N[chain[0].fwd ? chain[0].edge.a : chain[0].edge.b];
  return { archi: chain.length, lungo: Math.round(L), linea: Math.round(linea), inizio: [Math.round(A.x), Math.round(A.z)], semaforo: [Math.round(sig.x), Math.round(sig.z)], giocatore: Math.round(best.d), oltre: dopo.map((x) => x.edge.name) };
}

// in pagina: le auto entrano all'inizio del corridoio ogni h secondi, se c'è posto (dal muso a chi c'è davanti almeno
// 2 m più 1,3 s alla sua velocità, alla quale entrano); dopo warm secondi, per sec secondi: quante passano a X m
// (flusso, auto l'ora) e quante ce ne sono in media tra X0 e X1 (densità, auto per km), con la loro velocità media
export function livello({ h, sec, X = 500, X0 = 250, X1 = 750, warm = 150 }) {
  const g = window.__game, C = window.__cor, T = g.traffic, dt = 1 / 30;
  C.forza = 'G';
  T.cars.length = 0;
  let t = 0, last = -1e9, pass = 0, dens = 0, nd = 0, vs = 0, nv = 0, entrate = 0;
  const prima = new Map();
  while (t < warm + sec) {
    if (t - last >= h - 1e-9) {
      let first = null, fp = Infinity;
      for (const c of T.cars) { const p = C.pos(c); if (p != null && p < fp) { fp = p; first = c; } }
      const v = first ? Math.min(9, first.v) : 9;
      if (!first || fp - 6 - 4.4 >= 2 + 1.3 * v) { C.metti(6, v); last = t; entrate++; }
    }
    g.sim(dt, dt, false);
    t += dt;
    let n = 0;
    for (const c of T.cars) {
      const p = C.pos(c), p0 = prima.get(c);
      prima.set(c, p);
      if (t < warm) continue;
      if (p != null && p0 != null && p0 < X && p >= X) pass++;
      if (p != null && p >= X0 && p < X1) { n++; vs += c.v; nv++; }
    }
    if (t >= warm) { dens += n; nd++; }
  }
  return { h, flusso: Math.round((pass / sec) * 3600), densita: Math.round((dens / nd / ((X1 - X0) / 1000)) * 10) / 10, v: Math.round((vs / Math.max(1, nv)) * 10) / 10, entrate };
}

// in pagina: n auto ferme al rosso, col muso della prima 1 m prima della linea e 2 m tra muso e coda (6,4 m tra i centri,
// dove l'IDM le fa fermare); dopo 8 s di rosso, la distanza tra i centri delle auto ferme e, al verde, l'istante in cui
// il muso di ognuna passa la linea d'arresto
export function scarico({ n = 16 }) {
  const g = window.__game, C = window.__cor, T = g.traffic, dt = 1 / 30;
  T.cars.length = 0;
  C.forza = 'R';
  g.buses.clearAround(C.sig.x, C.sig.z, 500);
  const auto = [];
  for (let k = 0; k < n; k++) auto.push(C.metti(C.linea - 2.1 - 1 - k * 6.4, 0));
  g.sim(8, dt, false);
  const pos = auto.map((c) => C.pos(c));
  const passo = pos.slice(1).map((p, i) => pos[i] - p);
  C.forza = 'G';
  const tempi = auto.map(() => null), pr = [...pos];
  for (let t = dt; t < 120 && tempi.some((x) => x == null); t += dt) {
    g.sim(dt, dt, false);
    auto.forEach((c, i) => {
      const p = T.cars.includes(c) ? C.pos(c) ?? C.L + 100 : C.L + 100;
      if (tempi[i] == null && pr[i] + 2.1 < C.linea && p + 2.1 >= C.linea) tempi[i] = Math.round(t * 100) / 100;
      pr[i] = p;
    });
  }
  return { passo: Math.round((passo.reduce((a, b) => a + b, 0) / passo.length) * 100) / 100, tempi };
}

// in pagina: col verde, un'auto ferma sull'arco dopo l'incrocio in fondo al corridoio a `ferma` m dal nodo, e cinque
// auto che arrivano a 7 m/s, la prima 40 m prima della linea e le altre ogni 16 m. Per 40 s: quante sono ferme insieme
// dentro l'incrocio (incrocioDi, passata come testo), al più, e quali ci sono rimaste ferme
export function incrocio({ ferma = 14, scatola }) {
  const g = window.__game, C = window.__cor, T = g.traffic, dt = 1 / 30;
  const dentro = new Function('return ' + scatola)();
  T.cars.length = 0;
  C.forza = 'G';
  // la 13 passa oltre l'incrocio: i suoi bus restano lontani (fino al 17 novembre, fermo dietro l'auto ferma, dopo 15 s
  // il bus la faceva sparire)
  g.buses.clearAround(C.sig.x, C.sig.z, 500);
  // l'auto ferma resta lì: dopo ogni passo la si rimette al suo posto
  const d0 = C.dopo[0], ost = T.nuova(d0.edge, d0.fwd, ferma, C.dopo.slice(1)), q0 = ost.q;
  ost.v = 0;
  ost.vmax = 0.001;
  T.cars.push(ost);
  const auto = [0, 1, 2, 3, 4].map((k) => C.metti(C.linea - 40 - k * 16, 7));
  let insieme = 0;
  const rimaste = new Set();
  for (let t = 0; t < 40; t += dt) {
    g.sim(dt, dt, false);
    ost.v = 0;
    ost.q = q0;
    T.segui(ost);
    let n = 0;
    auto.forEach((c, i) => { if (T.cars.includes(c) && c.v < 0.1 && dentro(g, c)) { n++; rimaste.add(i); } });
    insieme = Math.max(insieme, n);
  }
  const fuori = auto.filter((c) => T.cars.includes(c) && C.pos(c) != null && C.pos(c) > C.L + 4).length;
  return { insieme, rimaste: [...rimaste], oltre: fuori, ferme: auto.filter((c) => T.cars.includes(c) && c.v < 0.1).length };
}
