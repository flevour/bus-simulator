// Pali sul percorso del tram e in carreggiata (#97), per tests/mappa.spec.js. Ogni palo che il gioco mette accanto ai
// binari (linea aerea, lanterne del tram, segnali degli scambi, cartelli del pantografo), e quelli dei semafori e dei
// lampioni, misurato:
// - dalla sagoma del tram, su tutte le linee, le S dei capolinea e i depositi: dentro se il centro del palo è sulla sede
//   (la corsia rossa, TRAM.lane dal binario) o se il fusto (raggio r) sta a meno di 0,3 m dalla cassa (il franco della
//   UNI 7156 § 4.7, come nelle tabelle del progetto del SIR3 in docs/binari-tram.md). La cassa va verso l'interno delle
//   curve: moduli con i capi sul binario, come in Tram.syncTransform, e la cabina è il modulo più lungo;
// - dal bordo dell'asfalto (city.surfaceOff, la pianta delle strade), fuori dalla sagoma: è la carreggiata, tranne tra
//   i due binari di una sede (pali in mezzo), che è asfalto ma senza auto.
// Non contano i binari a più di 2,5 m di quota dal palo (cavalcavia e viadotti del tram).
// Gira nella pagina: deve bastare a sé stessa (Playwright la passa come testo).
export function misuraPali() {
  const g = window.__game, city = g.city, tondo = (v) => Math.round(v * 100) / 100;
  // TRAM di src/tram/tram.js: metà della sede, larghezza della cassa, lunghezza della cabina; franco dalla cassa
  const LANE = 1.7, W = 2.2, CAB = 8.2, FRANCO = 0.3;
  const binari = [];
  for (const T of Object.values(city.tramTracks || {})) {
    for (const d of [1, -1]) binari.push({ P: T.path(d), nome: `${T.id} ${d > 0 ? 'andata' : 'ritorno'}`, h: (s) => T.heightAt(d, s) });
    for (const d of [1, -1]) {
      const pts = T.terminalCurve(d);
      if (pts && pts.length > 1) binari.push({ P: new (T.path(1).constructor)(pts), nome: `${T.id} S del capolinea`, h: () => 0 });
    }
  }
  for (const Y of city.tramYards || []) for (const e of Y.edges) binari.push({ P: e.path, nome: `deposito ${Y.name}`, h: () => 0 });
  // binari vicini al palo, alla sua quota: piede sul binario, distanza, quanto il palo entra nella sagoma (positivo dentro)
  const vicini = (x, z, r, h) => {
    const out = [];
    for (const B of binari) {
      const P = B.P, pr = P.projectNear(x, z, LANE + 2.5);
      if (!pr || (h != null && Math.abs(B.h(pr.s) - h) > 2.5)) continue;
      let v = LANE - pr.d;
      for (let s = pr.s - 0.5; s <= pr.s + CAB + 0.5; s += 0.25) {
        const a = P.at(Math.min(P.len, Math.max(0, s))), b = P.at(Math.min(P.len, Math.max(0, s - CAB)));
        const ex = a.x - b.x, ez = a.z - b.z, l = Math.hypot(ex, ez);
        if (l < 1) continue;
        const ux = ex / l, uz = ez / l, u = (x - b.x) * ux + (z - b.z) * uz;
        if (u < -r || u > l + r) continue;
        v = Math.max(v, W / 2 + FRANCO - (Math.abs((x - b.x) * -uz + (z - b.z) * ux) - r));
      }
      out.push({ nome: B.nome, d: pr.d, v, piede: P.at(pr.s) });
    }
    return out.sort((a, b) => b.v - a.v);
  };
  // tra i due binari di una sede: due binari da parti opposte del palo, a meno di TRAM.lane + 0,6 m
  const inMezzo = (x, z, vs) => {
    const ok = vs.filter((b) => b.d < LANE + 0.6 && b.d > 0.01);
    return ok.some((a) => ok.some((b) => (a.piede.x - x) * (b.piede.x - x) + (a.piede.z - z) * (b.piede.z - z) < 0));
  };
  const asfalto = (x, z) => (city.asphRings ? city.surfaceOff(x, z) : city.roadInfo(x, z).off);
  const via = (x, z) => { const e = city.roadInfo(x, z).edge; return (e && e.name) || ''; };

  // i pali, per tipo: posizione, raggio del fusto, quota (dove si sa)
  const pali = [];
  let appese = 0;
  const add = (tipo, x, z, r, h, tram = true) => pali.push({ tipo, x, z, r, h, tram });
  for (const p of city.tramPoles || []) add('linea aerea', p.x, p.z, 0.11, p.h);
  for (const hd of (g.tramSignals && g.tramSignals.heads) || []) {
    if ('pole' in hd && !hd.pole) { appese++; continue; } // appesa al tirante della linea aerea, senza palo
    const p = hd.pole || (() => {
      // come TramSignals.buildHeads fino al 12 novembre: lanterna a TRAM.lane + 0,35 m dal binario, palo 0,33 m più in fuori
      const x = hd.x, T = x.track, s = x.sT - (x.halfT + 3), q = T.path(x.dir).at(s);
      return { x: q.x - q.dz * (LANE + 0.68), z: q.z + q.dx * (LANE + 0.68), h: T.heightAt(x.dir, s) };
    })();
    add('lanterna del tram', p.x, p.z, 0.06, p.h);
  }
  const sig = (s) => add('segnale dello scambio', s.x, s.z, 0.06, 0);
  for (const j of (city.tramNet && city.tramNet.nodes) || []) if (j.panel) sig(j.panel.sig);
  for (const Y of city.tramYards || []) {
    for (const sw of Y.switches.values()) if (sw.panel) sig(sw.panel.sig);
    for (const pt of Y.ports) if (pt.panel) sig(pt.panel.sig);
  }
  if (city.panSigns) for (const p of city.panSigns) add('cartello del pantografo', p.x, p.z, 0.04, p.h);
  else for (const T of Object.values(city.tramTracks || {})) for (const d of [1, -1]) {
    // come i cartelli "abbassare / alzare il pantografo" di City.buildTramway fino al 12 novembre
    const P = T.path(d);
    for (const [g0, g1] of T.gaps[d > 0 ? 1 : -1]) for (const s of [g0 - 60, g1 + 8]) {
      const p = P.at(s);
      add('cartello del pantografo', p.x - p.dz * (LANE + 1.9), p.z + p.dx * (LANE + 1.9), 0.04, T.heightAt(d, s));
    }
  }
  for (const ap of g.lights.byKey.values()) for (const p of ap.poles || []) add('semaforo', p.x, p.z, p.mast ? 0.14 : 0.09, p.y, false);
  for (const b of new Set([...city.obstacles.map.values()].flat())) if (!b.dead && b.kind === 'pole') add('lampione', b.x, b.z, 0.1, 0, false);

  const casi = { pali_nella_sagoma_del_tram: [], pali_del_tram_in_carreggiata: [] }, distribuzioni = {};
  for (const p of pali) {
    const vs = vicini(p.x, p.z, p.r, p.h), s = vs[0], off = asfalto(p.x, p.z);
    const dentro = s && s.v > 0, mezzo = !dentro && off < 0 && inMezzo(p.x, p.z, vs);
    const dove = dentro ? 'nella sagoma del tram' : p.h > 1.5 ? 'in quota' : mezzo ? 'tra i binari' : off < 0 ? 'in carreggiata' : off < 0.3 ? 'sul cordolo' : 'fuori';
    const d = distribuzioni[p.tipo] || (distribuzioni[p.tipo] = {});
    d[dove] = (d[dove] || 0) + 1;
    const voce = { tipo: p.tipo, x: tondo(p.x), z: tondo(p.z), via: via(p.x, p.z), binario: s ? s.nome : '', dal_binario: s ? tondo(s.d) : null };
    if (dentro) casi.pali_nella_sagoma_del_tram.push({ ...voce, dentro: tondo(s.v) });
    else if (p.tram && dove === 'in carreggiata') casi.pali_del_tram_in_carreggiata.push({ ...voce, dentro: tondo(-off) });
  }
  if (appese) (distribuzioni['lanterna del tram'] || (distribuzioni['lanterna del tram'] = {}))['appesa al tirante'] = appese;
  return { distribuzioni, casi };
}
