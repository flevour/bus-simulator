// Giro guidato: il gioco non ha un autopilota, quindi lo scrive la prova. Il pilota sterza verso un punto del
// percorso più avanti (inseguimento puro) sulla corsia di destra, e negli ultimi metri verso il cordolo della fermata;
// dosa gas e freno con i tasti W e S per stare sotto la velocità che permettono le curve e la fermata; alla fermata
// apre le porte, aspetta la salita, chiude e riparte. Il tram segue il binario da solo: si guidano solo manipolatore,
// porte e pantografo. Si guida senza traffico (auto, bus e tram automatici tolti) e senza badare ai semafori: la
// prova riguarda strade, percorsi e fermate.

// Guida la corsa avviata fino a `fermate` fermate più avanti. Per ogni fermata un esito: { arrivato, motivo, nome,
// tempo, metri, urti, marciapiede, ... }; ci si ferma alla prima non raggiunta.
export async function guidaFermate(page, { fermate = 1, fermaAlPrimoUrto = false } = {}) {
  await page.evaluate(installaPilota, { fermaAlPrimoUrto });
  const esiti = [];
  for (let k = 0; k < fermate; k++) {
    let r;
    do r = await page.evaluate(() => window.__pilota.avanza(15)); while (!r.fine);
    esiti.push(r);
    if (!r.arrivato) break;
  }
  return esiti;
}

// Gira nella pagina: deve bastare a sé stessa (Playwright la passa come testo).
function installaPilota({ fermaAlPrimoUrto }) {
  const g = window.__game, m = g.mission, bus = g.bus, R = m.route, tram = !!bus.isTram, dt = 1 / 30;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // senza traffico
  g.traffic.target = 0;
  g.traffic.cars.splice(0);
  g.buses.setService([], m.variant);
  if (g.trams.track) g.trams.setService([], m.variant);

  // punto del percorso a s (come pointAt di routes.js)
  const punto = (s) => {
    s = clamp(s, 0, R.length);
    let lo = 0, hi = R.segs.length - 1;
    while (lo < hi) { const k = (lo + hi + 1) >> 1; if (R.cum[k] <= s) lo = k; else hi = k - 1; }
    const q = R.segs[lo], t = s - R.cum[lo];
    return { x: R.pts[lo].x + q.dx * t, z: R.pts[lo].z + q.dz * t, dx: q.dx, dz: q.dz, q };
  };
  // cambio di direzione del percorso tra s - d e s + d, positivo a destra
  const svolta = (s, d) => {
    const a = punto(s - d), b = punto(s + d);
    return Math.atan2(a.dx * b.dz - a.dz * b.dx, a.dx * b.dx + a.dz * b.dz);
  };
  const curva = (s) => Math.abs(svolta(s, 6)) / 12;
  // scostamento a destra dell'asse: metà della mezza carreggiata a doppio senso, a 2 m dal bordo sui sensi unici.
  // Nelle svolte strette a destra ci si allarga fino a un metro oltre l'asse, come fa chi guida un bus da 12 m; nei
  // 40 m prima della fermata si passa al cordolo, come stopPose di routes.js
  const scosta = (s, st) => {
    const q = punto(s).q, dx = svolta(s, 10);
    let base = q.edge && q.edge.oneway ? clamp(q.hw - 2, 0, q.hw / 2) : Math.max(0, Math.min(q.hw / 2, q.hw - 1.5));
    if (dx > 0.8) base -= Math.min(1, (dx - 0.8) / 0.6) * (base + 1);
    if (!st) return base;
    const kl = st.kl ?? st.kerb ?? st.hw, cordolo = kl - (st.ks || 0) * (st.s - s) - 1.6;
    const w = clamp(1 - (st.s - 6.5 - s) / 40, 0, 1);
    return base + (cordolo - base) * w;
  };
  // velocità voluta: 30 km/h, meno dove le curve nei prossimi 60 m lo chiedono, e la frenata per la fermata
  // (il muso si ferma a mezzo metro dalla palina: centro del mezzo 6,5 m prima)
  const velocita = (st) => {
    let v = tram ? Math.min(bus.curveLimit(), 30) / 3.6 : 8.3;
    if (!tram) for (let d = 0; d <= 60; d += 4) {
      const k = curva(m.s + d);
      if (k > 1e-3) v = Math.min(v, Math.sqrt(Math.max(9, 1.5 / k) + 2 * 1.0 * Math.max(0, d - 6)));
    }
    const resto = st.s - 6.5 - m.s;
    return Math.min(v, Math.sqrt(2 * 0.8 * Math.max(0, resto - 0.3)));
  };
  const tasto = (k, giu) => (giu ? g.keys.add(k) : g.keys.delete(k));
  const pedali = (vt) => {
    const e = vt - Math.abs(bus.v);
    tasto('KeyW', vt > 0.05 && e > 0.3);
    tasto('KeyS', (vt <= 0.05 && Math.abs(bus.v) > 0.01) || e < -0.3);
    tasto('ShiftLeft', e < -1.5);
  };
  // inseguimento puro dall'asse posteriore (2,6 m dietro il centro, passo 5,9 m: BUS in bus.js)
  const sterza = (st) => {
    const v = Math.abs(bus.v), h = bus.h;
    const rx = bus.x - Math.sin(h) * 2.6, rz = bus.z - Math.cos(h) * 2.6;
    const ld = clamp(8 + 0.5 * v, 9, 16), s = m.s - 2.6 + ld, p = punto(s), l = scosta(s, st);
    const vx = p.x - p.dz * l - rx, vz = p.z + p.dx * l - rz, L = Math.hypot(vx, vz) || 1;
    const sinA = (vx * Math.cos(h) - vz * Math.sin(h)) / L; // positivo: il punto è a sinistra
    const delta = Math.atan((2 * 5.9 * sinA) / L), max = 0.62 / (1 + v * v * 0.0045);
    // il volante, lasciato, torna al centro un poco a ogni passo: si compensa
    bus.steerIn = clamp(delta / max / (1 - Math.min(1, dt * (0.4 + 0.1 * v))), -1, 1);
  };
  // pantografo: giù prima del tratto senza filo, su appena dopo
  const pantografo = () => {
    const T = bus.track, sp = bus.pathOffset + bus.sFront - bus.facing * 12.45;
    const gap = T.gapAhead(bus.dirSig, sp, 50);
    if (gap && bus.pantoUp) g.press('KeyO');
    else if (!gap && !bus.pantoUp && bus.wireAvail && bus.pantoPos < 0.05) g.press('KeyO');
  };
  const via = () => { const r = g.city.roadInfo(bus.x, bus.z); return (r.edge && r.edge.name) || ''; };

  const P = {
    fase: 'apri', t: 0, obiettivo: -1, urti: [], fermo: 0, s0: 0, t0: 0, sw0: 0,
    esito(arrivato, motivo) {
      const st = m.stops[P.obiettivo] || {};
      for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) g.keys.delete(k);
      const r = {
        fine: true, arrivato, motivo, linea: m.line.id, fermata: P.obiettivo, nome: st.name, tempo: Math.round(P.t - P.t0),
        metri: Math.round(m.s - P.s0), urti: P.urti, marciapiede: m.stats.sidewalk - P.sw0, punteggio: m.score,
        x: Math.round(bus.x), z: Math.round(bus.z), via: via(), log: m.log.slice(-6).map((e) => `${e.pts} ${e.msg}`),
      };
      P.fase = arrivato ? 'servizio' : 'ferma';
      return r;
    },
    passo() {
      const cur = m.stops[m.nextStop];
      if (P.fase === 'apri') {
        // porte aperte alla fermata, da fermi e dopo qualche passo: prima la missione non sa di essere in fermata
        pedali(0);
        if (P.t > 0.5 && Math.abs(bus.v) < 0.05 && bus.doorTarget === 0) { g.press('KeyF'); P.fase = 'servizio'; P.tf = P.t; }
      } else if (P.fase === 'servizio') {
        // salita e discesa finite: si salta l'attesa fino all'orario e si chiudono le porte
        if ((cur && cur.doneMsg) || P.t - P.tf > 120) { g.press('KeyT'); g.press('KeyF'); P.fase = 'chiudi'; }
      } else if (P.fase === 'chiudi') {
        if (bus.doorsClosed && bus.doorTarget === 0) {
          P.obiettivo = cur && cur.arrived ? m.nextStop + 1 : m.nextStop;
          if (!m.stops[P.obiettivo]) return P.esito(false, 'nessuna fermata dopo questa');
          P.fase = 'guida'; P.s0 = m.s; P.t0 = P.t; P.sw0 = m.stats.sidewalk; P.urti = []; P.fermo = 0;
          P.limite = 90 + (m.stops[P.obiettivo].s - m.s) / 3;
        }
      } else if (P.fase === 'guida') {
        const st = m.stops[P.obiettivo];
        if (m.nextStop > P.obiettivo) return P.esito(false, 'fermata superata senza fermarsi');
        if (!tram) sterza(st); else pantografo();
        const vt = velocita(st);
        pedali(vt);
        const resto = st.s - 6.5 - m.s;
        if (resto < 0.8 && Math.abs(bus.v) < 0.05) { pedali(0); g.press('KeyF'); P.fase = 'arrivo'; P.ta = P.t; }
        P.fermo = Math.abs(bus.v) < 0.2 && resto > 3 ? P.fermo + dt : 0;
        if (P.fermo > 15) return P.esito(false, 'mezzo bloccato');
        if (P.t - P.t0 > P.limite) return P.esito(false, 'tempo scaduto');
      } else if (P.fase === 'arrivo') {
        const st = m.stops[P.obiettivo];
        if (st.delay !== undefined) return P.esito(true, 'arrivato');
        if (P.t - P.ta > 6) return P.esito(false, 'porte aperte fuori dalla zona di fermata');
      } else return P.esito(false, 'pilota fermo dopo un errore');
      g.sim(dt, dt, false);
      P.t += dt;
      const hit = bus.lastHit;
      if (hit && hit.kind !== 'car' && hit.kind !== 'tram') {
        const u = P.urti[P.urti.length - 1];
        // dove: punto del mezzo (lz, metri dal centro verso il muso; il rimorchio dello snodato sotto -4,4), distanza
        // del mezzo dall'asse del percorso (lat, positiva a destra) e del punto urtato dal bordo dell'asfalto (fuori)
        if (!u || Math.hypot(u.x - hit.x, u.z - hit.z) > 3) {
          P.urti.push({ cosa: hit.kind, x: Math.round(hit.x), z: Math.round(hit.z), via: via(), s: Math.round(m.s), lz: Math.round(hit.lz * 10) / 10,
            lat: Math.round((m.proj ? m.proj.lat : 0) * 10) / 10, fuori: Math.round(g.city.roadInfo(hit.x, hit.z).off * 10) / 10 });
          if (fermaAlPrimoUrto) return P.esito(false, 'urto');
        }
      }
      return null;
    },
    avanza(sec) {
      for (let t = 0; t < sec; t += dt) { const r = P.passo(); if (r) return r; }
      return { fine: false, fase: P.fase, s: Math.round(m.s), v: Math.round(bus.v * 10) / 10 };
    },
  };
  window.__pilota = P;
}
