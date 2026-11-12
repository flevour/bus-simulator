// Giro guidato: il gioco non ha un autopilota, quindi lo scrive la prova. Il pilota sterza verso un punto del
// percorso più avanti (inseguimento puro) sulla corsia di destra, e negli ultimi metri verso il cordolo della fermata;
// dosa gas e freno con i tasti W e S per stare sotto la velocità che permettono le curve e la fermata; alla fermata
// apre le porte, aspetta la salita, chiude e riparte. Il tram segue il binario da solo: si guidano solo manipolatore,
// porte e pantografo. Si guida senza traffico (auto, bus e tram automatici tolti) e senza badare ai semafori: la
// prova riguarda strade, percorsi e fermate. Con `traffico` (solo bus) il traffico resta e il pilota si ferma ai rossi
// e dietro chi ha davanti, come chi gioca: serve alle prove sul traffico.

// Guida la corsa avviata fino a `fermate` fermate più avanti. Per ogni fermata un esito: { arrivato, motivo, nome,
// tempo, metri, urti, marciapiede, ... }; ci si ferma alla prima non raggiunta.
export async function guidaFermate(page, { fermate = 1, fermaAlPrimoUrto = false, traffico = false } = {}) {
  await page.evaluate(installaPilota, { fermaAlPrimoUrto, traffico });
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
function installaPilota({ fermaAlPrimoUrto, traffico }) {
  const g = window.__game, m = g.mission, bus = g.bus, R = m.route, tram = !!bus.isTram, dt = 1 / 30;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // senza traffico
  if (!traffico) {
    g.traffic.target = 0;
    g.traffic.cars.splice(0);
    g.buses.setService([], m.variant);
    if (g.trams.track) g.trams.setService([], m.variant);
  }
  // col traffico: semafori del percorso (linea d'arresto come in buildLane di buses.js) e chi c'è davanti (pezzi dei bus
  // automatici, auto, tram) entro 2,4 m dalla retta di marcia
  const semafori = [];
  if (traffico) for (let i = 1; i < R.seq.length; i++) {
    const n = g.net.nodes[R.seq[i]], e = R.segs[i - 1].edge, ap = n.signal && e.id != null && g.lights.approach(n, e);
    if (ap) semafori.push({ s: R.cum[i] - (ap.stop ?? (n.radius || 0) + 1.2) - 0.3, n, e });
  }
  const davanti = () => {
    const fx = Math.sin(bus.h), fz = Math.cos(bus.h), mx = bus.x + fx * 6, mz = bus.z + fz * 6;
    let gap = Infinity;
    const prova = (x, z, r, lat = 2.4) => {
      const a = (x - mx) * fx + (z - mz) * fz, l = Math.abs((x - mx) * fz - (z - mz) * fx);
      if (a > -1 && a < 40 && l < lat) gap = Math.min(gap, a - r);
    };
    for (const p of g.buses.parts) prova(p.x, p.z, 1.6);
    for (const c of g.traffic.cars) prova(c.x, c.z, 2.2);
    // il tram che viene incontro sul binario accanto conta solo se è proprio davanti (lui aspetta il mezzo di chi gioca)
    for (const p of g.trams.near(mx, mz, 40)) prova(p.x, p.z, 1.6, Math.cos(p.h - bus.h) < -0.3 ? 1.4 : 2.4);
    return gap;
  };
  // velocità permessa da semaforo e traffico (m.s è il centro del mezzo, il muso 6 m avanti)
  const vincoli = () => {
    let v = Infinity;
    for (const sg of semafori) {
      const d = sg.s - (m.s + 6);
      if (d < -0.5 || d > 70) continue;
      const c = g.lights.lightFor(sg.n, sg.e);
      if (c === 'R' || (c === 'Y' && d > Math.abs(bus.v) * 1.5 + 2)) v = Math.min(v, d < 0.5 ? 0 : Math.sqrt(2 * 1.6 * (d - 0.5)));
      break;
    }
    const gp = davanti();
    if (gp < 40) v = Math.min(v, gp < 3 ? 0 : Math.sqrt(2 * 2 * (gp - 3)));
    return v;
  };

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
  // 40 m prima della fermata si passa al cordolo, come stopPose di routes.js: con la palina allineata la linea del
  // cordolo è nella direzione del suo tratto, e se il percorso piega poco prima (uscita di una rotonda) si riporta di
  // traverso al percorso
  const scosta = (s, st) => {
    const p = punto(s), q = p.q, dx = svolta(s, 10);
    let base = q.edge && q.edge.oneway ? clamp(q.hw - 2, 0, q.hw / 2) : Math.max(0, Math.min(q.hw / 2, q.hw - 1.5));
    if (dx > 0.8) base -= Math.min(1, (dx - 0.8) / 0.6) * (base + 1);
    if (!st) return base;
    const o = s - st.s, k = (st.kl ?? st.kerb ?? st.hw) + (st.ks || 0) * o - 1.6;
    const cordolo = st.kl == null ? k : (st.cx + st.dx * o + st.rx * k - p.x) * -p.dz + (st.cz + st.dz * o + st.rz * k - p.z) * p.dx;
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
        // porte aperte alla fermata, da fermi e dopo qualche passo: prima la missione non sa di essere in fermata (se
        // sono già aperte, come dopo la manovra al capolinea, si passa al servizio)
        pedali(0);
        if (P.t > 0.5 && Math.abs(bus.v) < 0.05) { if (bus.doorTarget === 0) g.press('KeyF'); P.fase = 'servizio'; P.tf = P.t; }
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
        const vt = traffico ? Math.min(velocita(st), vincoli()) : velocita(st);
        pedali(vt);
        const resto = st.s - 6.5 - m.s;
        if (resto < 0.8 && Math.abs(bus.v) < 0.05) { pedali(0); g.press('KeyF'); P.fase = 'arrivo'; P.ta = P.t; }
        P.fermo = Math.abs(bus.v) < 0.2 && resto > 3 ? P.fermo + dt : 0;
        // col traffico si aspetta ai rossi e in coda
        if (P.fermo > (traffico ? 150 : 15)) return P.esito(false, 'mezzo bloccato');
        if (P.t - P.t0 > P.limite + (traffico ? 600 : 0)) return P.esito(false, 'tempo scaduto');
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

// Manovra al capolinea del tram, come nella realtà: a corsa finita (porte aperte all'ultima fermata finché scendono
// tutti) avanti fino in fondo al binario, dove serve passando dallo scambio; B (cambio cabina, il tram resta dov'è);
// ripartenza fino alla prima fermata della corsa nuova (dove serve passando dallo scambio), porte aperte. Per ogni
// passo cosa è successo.
export async function guidaCapolinea(page) {
  return page.evaluate(() => {
    const g = window.__game, bus = g.bus, m = g.mission, dt = 1 / 30;
    const tasto = (k, giu) => (giu ? g.keys.add(k) : g.keys.delete(k));
    // col manipolatore fino a meta (muso), sotto il limite delle curve e frenando in tempo; urti e deragliamenti
    const fino = (meta, max = 300) => {
      let t = 0, urti = 0;
      bus.parking = false;
      for (; t < max; t += dt) {
        const resto = meta - bus.sFront;
        const vt = Math.min(Math.min(bus.curveLimit(), 25) / 3.6, Math.sqrt(2 * 0.8 * Math.max(0, resto - 0.3)));
        const e = vt - Math.abs(bus.v);
        tasto('KeyW', vt > 0.05 && e > 0.3);
        tasto('KeyS', (vt <= 0.05 && Math.abs(bus.v) > 0.01) || e < -0.3);
        g.sim(dt, dt, false);
        if (bus.lastHit && bus.lastHit.kind !== 'car' && bus.lastHit.kind !== 'tram') urti++;
        if (resto < 0.8 && Math.abs(bus.v) < 0.05) break;
      }
      tasto('KeyW', false); tasto('KeyS', false);
      return { arrivato: meta - bus.sFront < 1.5, tempo: Math.round(t), urti, deragliato: bus.derailT > 0 };
    };
    const casse = () => bus.modules.map((x) => [x.group.position.x, x.group.position.z]);
    const out = {};
    // 1. discesa alla fermata d'arrivo: la corsa finisce
    if (bus.doorTarget === 0) g.press('KeyF');
    for (let t = 0; t < 150 && !m.finished; t++) g.sim(1, dt, false);
    out.finita = m.finished;
    g.press('KeyF');
    for (let t = 0; t < 5 && !bus.doorsClosed; t += dt) g.sim(dt, dt, false);
    // 2. avanti fino in fondo al binario
    out.fondo = fino(bus.path.len - 1.5);
    out.oltreScambio = !!(bus.xend && bus.offAt(bus.pathOffset + bus.sFront - bus.length));
    // 3. B: cambia la cabina, il tram resta dov'è
    const c0 = casse(), cab = bus.activeCab, verso = bus.dirSig;
    g.press('KeyB');
    for (let t = 0; t < 3 && g.mission === m; t += dt) g.sim(dt, dt, false);
    const c1 = casse();
    out.cabina = bus.activeCab !== cab;
    out.ferme = Math.round(Math.max(...c0.map((p, i) => Math.hypot(p[0] - c1[i][0], p[1] - c1[i][1]))) * 100) / 100;
    out.nuova = g.mission !== m;
    out.verso = bus.dirSig === -verso;
    const m2 = g.mission, st0 = m2.stops[0];
    out.prima = st0.name;
    // 4-5. ripartenza fino alla fermata di partenza
    out.partenza = fino(st0.s - 0.5);
    g.press('KeyF');
    g.sim(2, dt, false);
    out.servita = !!st0.arrived;
    out.muso = m2.stopInfo && Math.round(m2.stopInfo.along * 10) / 10;
    // dopo la fermata il tram è sul binario di partenza, senza scostamento
    const p = bus.path.at(bus.sFront), f = bus.at(bus.sFront);
    out.sulBinario = Math.round(Math.hypot(p.x - f.x, p.z - f.z) * 100) / 100;
    return out;
  });
}
