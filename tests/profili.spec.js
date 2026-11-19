// Quote lette per arco e per binario (#107). I profili dei cavalcavia stanno, struttura per struttura, in
// data/profili-cavalcavia.json (scripts/profili_strutture.py): quota assoluta in centimetri lungo gli archi e lungo i
// binari. Quattro prove:
//  * la mappa ha i profili del file: una modifica che cambia le quote di una struttura senza riscriverlo (--aggiorna,
//    con la struttura nominata nel commit) fallisce, e dice quale;
//  * il gioco legge quelle quote: terreno più quota dell'arco (edgeHeight) e del binario (TramTrack.heightAt) nei punti
//    del file, entro 2 cm;
//  * chi guida le percorre: un pilota porta il bus sopra ogni cavalcavia dove passa una linea, e la quota letta a ogni
//    passo sotto i due assi (city.quotaSotto) è quella del file sull'arco dove sta l'asse, portata nel punto dell'asse
//    del bus con la regola di quotaStrada (#137), entro 2 cm, senza finire su un arco in quota che non è del percorso; i
//    salti della quota assoluta da un passo all'altro sono solo quelli noti (data/eccezioni/profili-pilota.json);
//  * nessun gradino da un arco al successivo (#137): su tutte le strutture attive, per ogni coppia di archi di fila e
//    lungo linee parallele all'asse su tutta la larghezza, la quota che un mezzo legge non salta; i gradini noti sono in
//    data/eccezioni/gradini.json.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test as base, expect as baseExpect } from '@playwright/test';
import { test, expect, avviaCorsa } from './gioco.js';

const FILE = 'data/profili-cavalcavia.json';
const TOLL = 0.02; // m
// le strutture con il profilo del risolutore: quelle della mappa (cavalcavia), con i loro archi dal file dei profili
const strutture = () => {
  const P = JSON.parse(readFileSync(FILE, 'utf8')).strutture;
  const M = JSON.parse(readFileSync('src/data/padova-map.json', 'utf8'));
  return Object.fromEntries(M.cavalcavia.map((c) => [c.id, P[c.id].archi.map((a) => a.slice(0, 4))]));
};
// i casi di una prova contro il loro elenco in data/eccezioni/ (scripts/eccezioni.py): l'esito per controllo
function eccezioni(info, elenco, casi, toll, comando) {
  const fileCasi = info.outputPath(`${elenco}-casi.json`), fileEsito = info.outputPath(`${elenco}-esito.json`);
  writeFileSync(fileCasi, JSON.stringify(casi));
  const argomenti = ['scripts/eccezioni.py', elenco, fileCasi, '--toll', String(toll), '--json', fileEsito, '--comando', comando];
  if (process.env.ECCEZIONI === 'aggiorna') argomenti.push('--aggiorna');
  const e = spawnSync('python3', argomenti, { encoding: 'utf8' });
  console.log(e.stdout + e.stderr);
  return JSON.parse(readFileSync(fileEsito, 'utf8'));
}

base('profili dei cavalcavia: la mappa ha quelli scritti nel repository', async () => {
  const r = spawnSync('python3', ['scripts/profili_strutture.py'], { encoding: 'utf8' });
  baseExpect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
});

test('profili dei cavalcavia: il gioco legge le quote del file', async ({ pagina, gioco }) => {
  const P = JSON.parse(readFileSync(FILE, 'utf8')).strutture;
  const r = await pagina.evaluate(leggi, P);
  console.log(`archi ${r.archi} (${r.punti} punti), tratti di binario ${r.binari} (${r.puntiBinari} punti); scarto massimo ${r.peggio} m`);
  expect(r.mancanti, 'archi del file che il gioco non ha').toEqual([]);
  expect(r.fuori, `punti oltre ${TOLL} m dal profilo del file`).toEqual([]);
  expect(r.punti).toBeGreaterThan(3000);
  expect(r.puntiBinari).toBeGreaterThan(300);
  expect(gioco.errori()).toEqual([]);
});

test('profili dei cavalcavia: il pilota percorre quello del file', async ({ pagina, gioco }, info) => {
  test.setTimeout(900_000);
  const P = JSON.parse(readFileSync(FILE, 'utf8')).strutture;
  await avviaCorsa(pagina, { linea: '24', modo: 'roam' });
  const passaggi = await pagina.evaluate(passaggiDelleLinee, P);
  const righe = [], fuori = [], salti = [], altrove = [], incompleti = [];
  for (const c of passaggi) {
    await pagina.evaluate(parti, { ...c, profili: P });
    let r;
    do r = await pagina.evaluate(() => window.__attraversa.avanza(20)); while (!r.fine);
    righe.push(`${c.struttura}: linea ${c.linea}, ${Math.round(r.metri)} m in ${Math.round(r.tempo)} s, quota fino a ${r.max} m, scarto massimo ${r.peggio} m${r.motivo ? `, ${r.motivo}` : ''}`);
    if (r.motivo) incompleti.push(`${c.struttura} (linea ${c.linea}): ${r.motivo} a (${r.x}, ${r.z})`);
    fuori.push(...r.fuori.map((t) => `${c.struttura}: ${t}`));
    for (const t of r.salti) { salti.push(`${c.struttura} | salto @ ${t.x},${t.z}`); righe.push(`  salto: ${t.cosa}`); }
    altrove.push(...r.altrove.map((t) => `${c.struttura}: ${t}`));
  }
  const testo = righe.join('\n');
  console.log(testo);
  info.annotations.push({ type: 'cavalcavia', description: testo });
  expect(passaggi.length, 'cavalcavia dove passa una linea').toBeGreaterThan(8);
  expect.soft(incompleti, 'cavalcavia non attraversati fino in fondo').toEqual([]);
  expect.soft(fuori, `quota del bus oltre ${TOLL} m dal profilo del file`).toEqual([]);
  // i salti noti stanno, caso per caso, in data/eccezioni/profili-pilota.json: un salto fuori dall'elenco o uno
  // dell'elenco sparito fanno fallire la prova
  const esito = eccezioni(info, 'profili-pilota', { salti }, 8, '`ECCEZIONI=aggiorna npx playwright test profili.spec`').salti;
  expect.soft(esito.nuovi, 'salti della quota fuori dall\'elenco data/eccezioni/profili-pilota.json').toEqual([]);
  expect.soft(esito.spariti, 'salti dell\'elenco spariti: da togliere').toEqual([]);
  expect.soft(esito.senza_perche, 'salti dell\'elenco senza il perché').toEqual([]);
  expect.soft(altrove, 'assi del bus su un arco che non è del percorso').toEqual([]);
  expect(gioco.errori()).toEqual([]);
});

test('profili dei cavalcavia: nessun gradino da un arco al successivo', async ({ pagina, gioco }, info) => {
  await avviaCorsa(pagina, { linea: '24', modo: 'roam' });
  const r = await pagina.evaluate(gradini, strutture());
  const righe = r.casi.map((c) => `${c.chiave}: ${c.h} m, da ${c.da} a ${c.a} in (${c.px}, ${c.pz}), a ${c.l} m dall'asse, tra ${c.archi}`);
  console.log(`${r.coppie} coppie di archi, ${r.linee} linee, ${r.ms} ms; gradini: ${r.casi.length}\n${righe.join('\n')}`);
  writeFileSync(info.outputPath('gradini.json'), JSON.stringify(r.casi, null, 1));
  info.annotations.push({ type: 'gradini', description: righe.join('\n') });
  expect(r.coppie, 'coppie di archi di fila sulle strutture attive').toBeGreaterThan(1000);
  const esito = eccezioni(info, 'gradini', { gradini: r.casi.map((c) => c.chiave) }, 8, '`ECCEZIONI=aggiorna npx playwright test profili.spec -g gradino`').gradini;
  expect.soft(esito.nuovi, 'gradini fuori dall\'elenco data/eccezioni/gradini.json').toEqual([]);
  expect.soft(esito.spariti, 'gradini dell\'elenco spariti: da togliere').toEqual([]);
  expect.soft(esito.senza_perche, 'gradini dell\'elenco senza il perché').toEqual([]);
  expect(gioco.errori()).toEqual([]);
});

// Le funzioni qui sotto girano nella pagina: devono bastare a sé stesse (Playwright le passa come testo).

// Gradini da un arco al successivo sulle strutture attive (#137): per ogni coppia di archi di fila, di cui almeno uno
// della struttura e in quota, con una deviazione fino a 60 gradi (chi va dall'uno all'altro senza svoltare), un punto
// percorre linee parallele all'asse, un metro l'una dall'altra su tutta la larghezza (l'angolo sulla bisettrice), da
// 12 m prima del nodo a 12 m dopo, a passi di 25 cm. A ogni passo la quota sotto il punto la legge city.quotaSotto,
// come per un asse del bus di chi guida, partendo dal primo arco; la quota assoluta (più il terreno del punto) non deve
// cambiare più di 5 cm più il 10% del passo. Un caso per nodo: il salto più alto, con l'arco da cui e su cui il punto
// passa (lo stesso arco, l'altro della coppia o un terzo arco che si sovrappone).
function gradini(S) {
  const g = window.__game, net = g.net, T = g.terrain, N = net.nodes, city = g.city, PASSO = 0.25, LUNGO = 12;
  const k4 = (e) => { const A = N[e.a], B = N[e.b]; return `${A.x},${A.z},${B.x},${B.z}`; };
  const byKey = new Map(net.edges.map((e) => [k4(e), e]));
  const casi = [];
  let coppie = 0, linee = 0;
  const t0 = performance.now();
  for (const [id, archi] of Object.entries(S)) {
    const E = archi.map((a) => byKey.get(a.join(','))).filter((e) => e && e.hs), visti = new Set();
    for (const e1 of E) for (const n of [e1.a, e1.b]) {
      const C = N[n], ux = n === e1.b ? e1.dx : -e1.dx, uz = n === e1.b ? e1.dz : -e1.dz;
      for (const e2 of C.edges) {
        if (e2 === e1 || e2.ped || e2.width < 3) continue;
        const vx = n === e2.a ? e2.dx : -e2.dx, vz = n === e2.a ? e2.dz : -e2.dz;
        if (ux * vx + uz * vz < 0.5 || visti.has(`${e1.id}>${e2.id}`)) continue;
        visti.add(`${e1.id}>${e2.id}`);
        coppie++;
        const w = Math.min(e1.width, e2.width) / 2 - 1, L1 = Math.min(LUNGO, e1.len), L2 = Math.min(LUNGO, e2.len);
        // linee a destra di chi va per l > 0: normale (-dz, dx) di ognuno dei due archi, l'angolo sulla bisettrice
        const bx = -uz - vz, bz = ux + vx, bl = Math.hypot(bx, bz) || 1, cs = (-bx * uz + bz * ux) / bl || 1;
        let peggio = null;
        for (let l = -w; l <= w + 1e-6; l += 1) {
          const cx = C.x + (bx / bl) * (l / cs), cz = C.z + (bz / bl) * (l / cs), st = { e: e1 };
          let prima = null, ePrima = e1;
          linee++;
          for (let s = -L1; s <= L2; s += PASSO) {
            const [dx, dz] = s < 0 ? [ux, uz] : [vx, vz], x = cx + dx * s, z = cz + dz * s;
            const H = city.quotaSotto(st, x, z, dx, dz) + T.at(x, z);
            const d = prima == null ? 0 : Math.abs(H - prima);
            if (d > 0.05 + 0.1 * PASSO && (!peggio || d > peggio.h)) peggio = { h: d, da: prima, a: H, x, z, l, eDa: ePrima, eA: st.e };
            prima = H; ePrima = st.e;
          }
        }
        if (peggio) {
          const r = (v, k = 10) => Math.round(v * k) / k, nome = (e) => (e ? e.name || 'senza nome' : 'fuori strada');
          const tipo = peggio.eDa === peggio.eA ? 'sullo stesso arco' : [e1, e2].includes(peggio.eDa) && [e1, e2].includes(peggio.eA) ? "da un arco all'altro" : 'su un terzo arco';
          // quota dell'arco sull'asse e terreno sulla larghezza (punto contro asse) dove salta: per il perché dei casi
          const e = peggio.eA || e1, A = N[e.a], t = Math.max(0, Math.min(e.len, (peggio.x - A.x) * e.dx + (peggio.z - A.z) * e.dz));
          const asse = g.edgeHeight(e, t), terreno = T.at(peggio.x, peggio.z) - T.at(A.x + e.dx * t, A.z + e.dz * t);
          const c = { chiave: `${id} | gradino @ ${Math.round(C.x)},${Math.round(C.z)}`, h: r(peggio.h, 100), da: r(peggio.da, 100), a: r(peggio.a, 100), px: r(peggio.x), pz: r(peggio.z), l: r(peggio.l, 100), tipo, asse: r(asse, 100), terreno: r(terreno, 100), archi: `${nome(e1)} e ${nome(e2)}, ${tipo} (da ${nome(peggio.eDa)} a ${nome(peggio.eA)}; quota dell'asse ${r(asse, 100)} m, terreno ${r(terreno, 100)} m rispetto all'asse)` };
          const i = casi.findIndex((o) => o.chiave === c.chiave);
          if (i < 0) casi.push(c);
          else if (c.h > casi[i].h) casi[i] = c;
        }
      }
    }
  }
  casi.sort((a, b) => b.h - a.h);
  return { coppie, linee, ms: Math.round(performance.now() - t0), casi };
}

// Quote del gioco nei punti del file: archi (terreno sull'asse più edgeHeight) e binari (terreno sotto il binario più
// TramTrack.heightAt alla progressiva del percorso che corrisponde a quella dei dati).
function leggi(P) {
  const g = window.__game, net = g.net, T = g.terrain, TOLL = 0.02;
  const chiave = (ax, az, bx, bz) => `${ax},${az},${bx},${bz}`;
  const archi = new Map();
  for (const e of net.edges) { const A = net.nodes[e.a], B = net.nodes[e.b]; archi.set(chiave(A.x, A.z, B.x, B.z), e); }
  const out = { archi: 0, punti: 0, binari: 0, puntiBinari: 0, peggio: 0, mancanti: [], fuori: [] };
  const prova = (dove, q, v) => {
    const d = Math.abs(q - v);
    out.peggio = Math.max(out.peggio, Math.round(d * 1000) / 1000);
    // il file è al centimetro: mezzo centimetro di arrotondamento in più
    if (d > TOLL + 0.005 && out.fuori.length < 30) out.fuori.push(`${dove}: gioco ${q.toFixed(3)}, file ${v.toFixed(2)}`);
  };
  for (const [id, S] of Object.entries(P)) {
    for (const [ax, az, bx, bz, ss, qs] of S.archi) {
      const e = archi.get(chiave(ax, az, bx, bz));
      if (!e) { if (Math.hypot(bx - ax, bz - az) >= 0.3) out.mancanti.push(`${id}: (${ax}, ${az}) - (${bx}, ${bz})`); continue; }
      out.archi++;
      const L = ss[ss.length - 1] || 1, A = net.nodes[e.a];
      ss.forEach((s, i) => {
        const t = s / L, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        out.punti++;
        prova(`${id}, arco (${ax}, ${az}) a ${Math.round(s / 100)} m`, T.at(x, z) + g.edgeHeight(e, t * e.len), qs[i] / 100);
      });
    }
    for (const [linea, verso, ss, qs] of S.binari) {
      const K = g.city.tramTracks[linea];
      out.binari++;
      ss.forEach((s, i) => {
        const sp = K.pathS(verso, s / 100), p = K.path(verso).at(sp);
        out.puntiBinari++;
        prova(`${id}, binario ${linea} ${verso} a ${Math.round(s / 100)} m`, T.at(p.x, p.z) + K.heightAt(verso, sp), qs[i] / 100);
      });
    }
  }
  return out;
}

// I cavalcavia dove passa una linea di autobus: per ogni struttura del file il primo passaggio trovato (linea,
// variante), con il percorso da 90 m prima del primo arco in quota a 70 m dopo l'ultimo.
function passaggiDelleLinee(P) {
  const g = window.__game, net = g.net;
  const chiave = (e) => { const A = net.nodes[e.a], B = net.nodes[e.b]; return `${A.x},${A.z},${B.x},${B.z}`; };
  const di = new Map();
  for (const [id, S] of Object.entries(P)) for (const [ax, az, bx, bz, , qs] of S.archi) di.set(`${ax},${az},${bx},${bz}`, id);
  const out = [], visti = new Set();
  for (const L of g.lines) {
    if (L.tram) continue;
    L.variants.forEach((v, vi) => {
      const seq = v.nodes, E = [];
      for (let i = 0; i < seq.length - 1; i++) E.push(net.edgeBetween(seq[i], seq[i + 1]));
      for (let i = 0; i < E.length; i++) {
        if (!E[i] || !E[i].elev) continue;
        let j = i;
        while (j + 1 < E.length && E[j + 1] && E[j + 1].elev) j++;
        const id = di.get(chiave(E[i]));
        const alta = Math.max(...E.slice(i, j + 1).map((e) => Math.max(g.edgeHeight(e, 0), g.edgeHeight(e, e.len / 2), g.edgeHeight(e, e.len))));
        if (id && !visti.has(id) && alta > 1) {
          // indietro di 90 m e avanti di 70 lungo il percorso
          let a = i, b = j, la = 0, lb = 0;
          while (a > 0 && E[a - 1] && la < 90) { a--; la += E[a].len; }
          while (b + 1 < E.length && E[b + 1] && lb < 70) { b++; lb += E[b].len; }
          if (la >= 40 && lb >= 30) {
            visti.add(id);
            out.push({ struttura: id, linea: L.id, variante: vi, nodi: seq.slice(a, b + 2) });
          }
        }
        i = j;
      }
    });
  }
  return out;
}

// Mette il bus all'inizio del passaggio e prepara il pilota (window.__attraversa): inseguimento puro lungo il percorso,
// sulla corsia di destra, a 30 km/h (meno in curva). A ogni passo guarda i due assi del bus (bus.assi): l'arco deve
// essere uno del percorso, la quota quella del file su quell'arco alla progressiva dell'asse, e da un passo all'altro
// non deve saltare.
function parti(c) {
  const g = window.__game, net = g.net, bus = g.bus, T = g.terrain, dt = 1 / 30, TOLL = 0.02;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  g.traffic.target = 0; g.traffic.cars.splice(0);
  g.buses.setService([], g.mission.variant);
  if (g.trams.track) g.trams.setService([], g.mission.variant);
  const pts = c.nodi.map((n) => net.nodes[n]), segs = [], cum = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    const e = net.edgeBetween(c.nodi[i], c.nodi[i + 1]), l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    segs.push({ e, dx: (pts[i + 1].x - pts[i].x) / l, dz: (pts[i + 1].z - pts[i].z) / l, l });
    cum.push(cum[i] + l);
  }
  const tot = cum[cum.length - 1], del = new Set(segs.map((s) => s.e));
  const punto = (s) => {
    s = clamp(s, 0, tot);
    let i = 0;
    while (i < segs.length - 1 && cum[i + 1] < s) i++;
    const q = segs[i], t = s - cum[i];
    return { x: pts[i].x + q.dx * t, z: pts[i].z + q.dz * t, dx: q.dx, dz: q.dz, e: q.e };
  };
  // a destra dell'asse; dove gli stalli stringono la carreggiata (e.sede, #111) nelle corsie, come il pilota di
  // tests/guida.js: la fiancata a 30 cm dal bordo degli stalli di destra, senza passare oltre quelli di sinistra (sul
  // Cavalcavia Montà a un quarto della carreggiata il bus passava 44 cm sopra le auto in sosta)
  const lato = (p) => {
    const e = p.e;
    let l = e.oneway ? 0 : Math.min(e.width / 4, e.width / 2 - 1.5);
    if (e.sede) { const av = p.dx * e.dx + p.dz * e.dz > 0; l = Math.max(Math.min(l, e.sede[av ? 1 : 0] - 1.6), 1.6 - e.sede[av ? 0 : 1]); }
    return l;
  };
  const proietta = () => {
    let best = Infinity, s = 0;
    for (let i = 0; i < segs.length; i++) {
      const q = segs[i], t = clamp((bus.x - pts[i].x) * q.dx + (bus.z - pts[i].z) * q.dz, 0, q.l);
      const d = Math.hypot(bus.x - pts[i].x - q.dx * t, bus.z - pts[i].z - q.dz * t);
      if (d < best) { best = d; s = cum[i] + t; }
    }
    return s;
  };
  // i profili del file per arco
  const file = new Map();
  for (const S of Object.values(c.profili || {})) for (const a of S.archi) file.set(a.slice(0, 4).join(','), a);
  const p0 = punto(8), l0 = lato(p0);
  bus.place(p0.x - p0.dz * l0, p0.z + p0.dx * l0, Math.atan2(p0.dx, p0.dz));
  bus.elev = undefined; bus.v = 0; bus.steerIn = 0; bus.steer = 0; bus.parking = false;
  g.city.ensureTiles(bus.x, bus.z, 600);
  const A = {
    t: 0, s: 8, s0: 8, fermo: 0, max: 0, peggio: 0, fuori: [], salti: [], altrove: [], prima: [null, null],
    passo() {
      const v = Math.abs(bus.v), h = bus.h;
      A.s = proietta();
      // sterzo: inseguimento puro dall'asse posteriore
      const rx = bus.x - Math.sin(h) * 2.6, rz = bus.z - Math.cos(h) * 2.6;
      const ld = clamp(8 + 0.5 * v, 9, 16), p = punto(A.s - 2.6 + ld), l = lato(p);
      const vx = p.x - p.dz * l - rx, vz = p.z + p.dx * l - rz, D = Math.hypot(vx, vz) || 1;
      const sinA = (vx * Math.cos(h) - vz * Math.sin(h)) / D;
      const delta = Math.atan((2 * 5.9 * sinA) / D), max = 0.62 / (1 + v * v * 0.0045);
      bus.steerIn = clamp(delta / max / (1 - Math.min(1, dt * (0.4 + 0.1 * v))), -1, 1);
      // velocità: 30 km/h, meno dove il percorso gira nei prossimi 50 m
      let vt = 8.3;
      for (let d = 0; d <= 50; d += 4) {
        const a = punto(A.s + d - 6), b = punto(A.s + d + 6), k = Math.abs(Math.atan2(a.dx * b.dz - a.dz * b.dx, a.dx * b.dx + a.dz * b.dz)) / 12;
        if (k > 1e-3) vt = Math.min(vt, Math.sqrt(Math.max(9, 1.5 / k) + 2 * Math.max(0, d - 6)));
      }
      const e = vt - v;
      for (const [k, giu] of [['KeyW', e > 0.3], ['KeyS', e < -0.3]]) { if (giu) g.keys.add(k); else g.keys.delete(k); }
      g.sim(dt, dt, false);
      A.t += dt;
      A.fermo = Math.abs(bus.v) < 0.2 ? A.fermo + dt : 0;
      // i due assi: arco, progressiva e quota letti dal gioco, contro il file
      (bus.assi || []).forEach((st, i) => {
        const dove = `asse ${i ? 'dietro' : 'davanti'} a ${Math.round(A.s)} m (${Math.round(bus.x)}, ${Math.round(bus.z)})`;
        const q = st.q || 0;
        A.max = Math.max(A.max, Math.round(q * 100) / 100);
        if (st.e && q > 0.05 && !del.has(st.e) && A.altrove.length < 10) A.altrove.push(`${dove}: su ${st.e.name || 'una strada senza nome'} a quota ${q.toFixed(2)}`);
        if (st.e && del.has(st.e)) {
          const N = net.nodes, a = N[st.e.a], b = N[st.e.b], f = file.get(`${a.x},${a.z},${b.x},${b.z}`);
          let atteso = 0;
          if (f) {
            // profilo del file alla progressiva dell'asse: nei due punti del file attorno, la quota assoluta meno il
            // terreno sull'asse della strada lì; in mezzo lineare (tra due punti il terreno non lo è). Poi nel punto
            // dove il gioco l'ha letta (st.x, st.z), con la regola della quota fuori asse (quotaFuoriAsse, #137)
            const ss = f[4], qs = f[5], L = ss[ss.length - 1] || 1, x = (st.s / st.e.len) * L;
            let k = 0;
            while (k < ss.length - 2 && ss[k + 1] < x) k++;
            const w = clamp((x - ss[k]) / ((ss[k + 1] - ss[k]) || 1), 0, 1);
            const sopra = (i) => qs[i] / 100 - T.at(a.x + (b.x - a.x) * (ss[i] / L), a.z + (b.z - a.z) * (ss[i] / L));
            const t = st.s / st.e.len;
            atteso = g.quotaFuoriAsse(sopra(k) + (sopra(k + 1) - sopra(k)) * w, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, st.x, st.z);
          }
          const d = Math.abs(q - atteso);
          A.peggio = Math.max(A.peggio, Math.round(d * 1000) / 1000);
          // mezzo centimetro in più: il file è al centimetro
          if (d > TOLL + 0.005 && A.fuori.length < 10) A.fuori.push(`${dove}: letta ${q.toFixed(3)}, dal file ${atteso.toFixed(3)}`);
        }
        // salti: sulla quota assoluta dell'asse (terreno sotto l'asse più quota letta), quella che si vede: vicino alle
        // spalle la quota sopra il terreno cambia in fretta perché sale il terreno
        const pr = A.prima[i], ass = q + T.at(st.x, st.z);
        if (pr && Math.abs(ass - pr.ass) > 0.05 + 0.5 * Math.hypot(bus.x - pr.x, bus.z - pr.z) && !A.salti.some((o) => Math.hypot(o.x - bus.x, o.z - bus.z) < 15)) A.salti.push({ x: Math.round(bus.x), z: Math.round(bus.z), cosa: `${dove}: da ${pr.ass.toFixed(2)} a ${ass.toFixed(2)}` });
        A.prima[i] = { ass, x: bus.x, z: bus.z, e: st.e && st.e.id, s: (st.s || 0).toFixed(1), l: st.e && st.e.len.toFixed(1) };
      });
      if (A.s >= tot - 12) return A.esito('');
      if (A.fermo > 10) return A.esito('mezzo bloccato');
      if (A.t > 60 + tot / 3) return A.esito('tempo scaduto');
      return null;
    },
    esito(motivo) {
      for (const k of ['KeyW', 'KeyS']) g.keys.delete(k);
      return { fine: true, motivo, metri: A.s - A.s0, tempo: A.t, max: A.max, peggio: A.peggio, fuori: A.fuori, salti: A.salti, altrove: A.altrove, x: Math.round(bus.x), z: Math.round(bus.z) };
    },
    avanza(sec) {
      for (let t = 0; t < sec; t += dt) { const r = A.passo(); if (r) return r; }
      return { fine: false };
    },
  };
  window.__attraversa = A;
}
