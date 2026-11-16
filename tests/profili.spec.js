// Quote lette per arco e per binario (#107). I profili dei cavalcavia stanno, struttura per struttura, in
// data/profili-cavalcavia.json (scripts/profili_strutture.py): quota assoluta in centimetri lungo gli archi e lungo i
// binari. Tre prove:
//  * la mappa ha i profili del file: una modifica che cambia le quote di una struttura senza riscriverlo (--aggiorna,
//    con la struttura nominata nel commit) fallisce, e dice quale;
//  * il gioco legge quelle quote: terreno più quota dell'arco (edgeHeight) e del binario (TramTrack.heightAt) nei punti
//    del file, entro 2 cm;
//  * chi guida le percorre: un pilota porta il bus sopra ogni cavalcavia dove passa una linea, e la quota letta a ogni
//    passo sotto i due assi (city.quotaSotto) è quella del file sull'arco dove sta l'asse, entro 2 cm, senza finire su un
//    arco in quota che non è del percorso; i salti della quota assoluta da un passo all'altro sono solo quelli noti
//    (data/eccezioni/profili-pilota.json).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test as base, expect as baseExpect } from '@playwright/test';
import { test, expect, avviaCorsa } from './gioco.js';

const FILE = 'data/profili-cavalcavia.json';
const TOLL = 0.02; // m

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
  // i salti noti (gradini tra carreggiate affiancate dei cavalcavia con le quote di prima) stanno, caso per caso, in
  // data/eccezioni/profili-pilota.json: un salto fuori dall'elenco o uno dell'elenco sparito fanno fallire la prova
  const fileCasi = info.outputPath('casi.json'), fileEsito = info.outputPath('eccezioni.json');
  writeFileSync(fileCasi, JSON.stringify({ salti }));
  const argomenti = ['scripts/eccezioni.py', 'profili-pilota', fileCasi, '--toll', '8', '--json', fileEsito, '--comando', '`ECCEZIONI=aggiorna npx playwright test profili.spec`'];
  if (process.env.ECCEZIONI === 'aggiorna') argomenti.push('--aggiorna');
  const e = spawnSync('python3', argomenti, { encoding: 'utf8' });
  console.log(e.stdout + e.stderr);
  const esito = JSON.parse(readFileSync(fileEsito, 'utf8')).salti;
  expect.soft(esito.nuovi, 'salti della quota fuori dall\'elenco data/eccezioni/profili-pilota.json').toEqual([]);
  expect.soft(esito.spariti, 'salti dell\'elenco spariti: da togliere').toEqual([]);
  expect.soft(esito.senza_perche, 'salti dell\'elenco senza il perché').toEqual([]);
  expect.soft(altrove, 'assi del bus su un arco che non è del percorso').toEqual([]);
  expect(gioco.errori()).toEqual([]);
});

// Le funzioni qui sotto girano nella pagina: devono bastare a sé stesse (Playwright le passa come testo).

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
  const lato = (e) => (e.oneway ? 0 : Math.min(e.width / 4, e.width / 2 - 1.5));
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
  const p0 = punto(8), l0 = lato(p0.e);
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
      const ld = clamp(8 + 0.5 * v, 9, 16), p = punto(A.s - 2.6 + ld), l = lato(p.e);
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
            // terreno sull'asse della strada lì; in mezzo lineare (tra due punti il terreno non lo è)
            const ss = f[4], qs = f[5], L = ss[ss.length - 1] || 1, x = (st.s / st.e.len) * L;
            let k = 0;
            while (k < ss.length - 2 && ss[k + 1] < x) k++;
            const w = clamp((x - ss[k]) / ((ss[k + 1] - ss[k]) || 1), 0, 1);
            const sopra = (i) => qs[i] / 100 - T.at(a.x + (b.x - a.x) * (ss[i] / L), a.z + (b.z - a.z) * (ss[i] / L));
            atteso = sopra(k) + (sopra(k + 1) - sopra(k)) * w;
          }
          const d = Math.abs(q - atteso);
          A.peggio = Math.max(A.peggio, Math.round(d * 1000) / 1000);
          // mezzo centimetro in più: il file è al centimetro
          if (d > TOLL + 0.005 && A.fuori.length < 10) A.fuori.push(`${dove}: letta ${q.toFixed(3)}, dal file ${atteso.toFixed(3)}`);
        }
        // salti: sulla quota assoluta dell'asse (terreno sotto l'asse più quota letta), quella che si vede: vicino alle
        // spalle la quota sopra il terreno cambia in fretta perché sale il terreno
        const pr = A.prima[i], k = i ? -2.6 : 3.3, ass = q + T.at(bus.x + Math.sin(bus.h) * k, bus.z + Math.cos(bus.h) * k);
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
