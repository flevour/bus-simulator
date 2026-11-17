// Prova del moto (#113): auto e bus automatici si muovono come mezzi veri. Il punto che si guarda è il centro dell'asse
// posteriore: in un mezzo vero le ruote dietro non sterzano, quindi quel punto va sempre nella direzione del mezzo, e in
// curva gira al più con il raggio minimo del mezzo (docs/raccordi.md, sezione 2). A ogni passo della simulazione, per
// ogni auto e ogni bus automatico che c'era anche al passo prima:
//   - di traverso: sopra 1 m/s l'asse posteriore si sposta a più di 10 gradi dalla direzione del mezzo;
//   - salto: l'asse posteriore si sposta più di quanto la velocità spiega (1,5 volte la velocità più 15 cm a passo);
//   - imbardata: il mezzo gira più di quanto gli permette il raggio minimo per la strada che ha fatto (v / raggio
//     minimo, con il 10% e 3 millesimi di radiante a passo di margine), anche da fermo;
//   - inversione: il mezzo lascia un arco e il successivo è lo stesso arco nell'altro verso.
// Un caso è un episodio: comincia al primo passo fuori regola e finisce dopo un secondo senza; la chiave è chi (auto o
// bus), cosa e il posto dove comincia ("auto di traverso @ x,z"). Dove il mezzo è su un ripiego dell'inseguitore
// (src/world/inseguitore.js: una svolta senza il raccordo della build per lui, un cambio di corsia senza posto), la
// chiave lo dice tra parentesi ("bus imbardata (raccordo delle auto) @ x,z"): sono i casi che l'elenco tiene con il
// perché, finché #134 e #114 non danno a quelle svolte il loro raccordo. Non importa nulla da Playwright: la usano la
// prova (tests/moto.spec.js) e gli script di confronto prima e dopo.

// in pagina: comincia a guardare. window.__moto.fine() smette e dà casi, conti e valori peggiori
export function osservaMoto({ dt = 1 / 30 } = {}) {
  const g = window.__game, B = g.buses;
  const RMIN = { auto: 3.8, bus: 8.3 }, ASSE = { auto: 1.35, bus: 2.6 };
  const prima = new Map(), aperti = new Map(), ultimoArco = new Map();
  const casi = [], conti = { traverso: 0, salto: 0, imbardata: 0, inversione: 0 };
  const peggio = { traverso: 0, salto: 0, imbardata: 0 };
  let passi = 0, mezzi = 0, metri = 0;
  const NOMI = { traverso: 'di traverso', salto: 'salto', imbardata: 'imbardata', inversione: 'inversione' };
  // l'arco su cui il mezzo sta in corsia (null in curva, tra un arco e l'altro): delle auto c.edge fuori da c.turn,
  // dei bus il tratto del percorso dei nodi sotto il centro
  const arco = (o, auto) => {
    if (auto) return o.turn ? null : { id: o.edge.id, f: o.fwd };
    const L = o.L, k = L.segOf[L.P.seg(Math.max(0, Math.min(L.P.len, o.s)))], sg = L.segs[k];
    return sg && sg.e ? { id: sg.e.id, f: sg.fwd } : null;
  };
  // il ripiego su cui sta l'asse posteriore del mezzo, o che ha appena lasciato (un metro e mezzo), se ce n'è uno
  const ripiego = (o) => {
    const per = o.per || (o.L && o.L.per);
    if (!per || o.q == null) return null;
    const i = per.indice(o.q), p = per.pezzi[i], prima = per.pezzi[i - 1];
    if (p && p.ripiego) return p.ripiego;
    return prima && prima.ripiego && o.q - (prima.q0 + prima.len) < 1.5 ? prima.ripiego : null;
  };
  const caso = (o, chi, tipo, x, z, quanto) => {
    const k = `${tipo}`, m = aperti.get(o) || aperti.set(o, {}).get(o), ep = m[k];
    if (ep && g.mission.clock - ep.t < 1) { ep.t = g.mission.clock; ep.c.quanto = Math.max(ep.c.quanto, quanto); return; }
    const rip = ripiego(o);
    // window.__motoInfo(mezzo), se c'è, allega al caso lo stato del mezzo (per chi cerca la causa)
    const c = { chiave: `${chi} ${NOMI[tipo]}${rip ? ` (${rip})` : ''} @ ${Math.round(x)},${Math.round(z)}`, tipo, quanto, ora: g.mission.clock, linea: o.run ? o.run.L.id : null, info: window.__motoInfo ? window.__motoInfo(o) : undefined };
    m[k] = { t: g.mission.clock, c };
    casi.push(c);
    conti[tipo]++;
  };
  const guarda = (o, auto) => {
    const chi = auto ? 'auto' : 'bus', a = chi;
    const h = o.h, rx = o.x - Math.sin(h) * ASSE[a], rz = o.z - Math.cos(h) * ASSE[a];
    const p = prima.get(o);
    const ar = arco(o, auto);
    if (ar) {
      const u = ultimoArco.get(o);
      if (u && u.id === ar.id && u.f !== ar.f) caso(o, chi, 'inversione', rx, rz, 1);
      if (!u || u.id !== ar.id || u.f !== ar.f) ultimoArco.set(o, ar);
    }
    prima.set(o, { rx, rz, h, v: Math.abs(o.v) });
    if (!p) return;
    mezzi++;
    const dx = rx - p.rx, dz = rz - p.rz, d = Math.hypot(dx, dz);
    metri += d;
    let dh = h - p.h;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    // salto
    const lim = 1.5 * Math.max(p.v, Math.abs(o.v)) * dt + 0.15;
    if (d > lim) { caso(o, chi, 'salto', rx, rz, d); peggio.salto = Math.max(peggio.salto, d); }
    // di traverso: direzione media del passo contro il moto dell'asse posteriore
    if (d / dt > 1) {
      const hm = p.h + dh / 2, c = (dx * Math.sin(hm) + dz * Math.cos(hm)) / d;
      const ang = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
      if (ang > 10) { caso(o, chi, 'traverso', rx, rz, ang); peggio.traverso = Math.max(peggio.traverso, ang); }
    }
    // imbardata oltre quella del raggio minimo per la strada fatta
    const ammessa = (d / RMIN[a]) * 1.1 + 0.003;
    if (Math.abs(dh) > ammessa) {
      const r = Math.abs(dh) / Math.max(1e-6, d / RMIN[a]);
      caso(o, chi, 'imbardata', rx, rz, r);
      peggio.imbardata = Math.max(peggio.imbardata, Math.min(r, 1e6));
    }
  };
  const misura = () => {
    passi++;
    const vivi = new Set();
    for (const c of g.traffic.cars) { guarda(c, true); vivi.add(c); }
    for (const b of B.buses) { guarda(b, false); vivi.add(b); }
    // chi è uscito di scena non conta più (un mezzo nuovo è un altro oggetto)
    if (passi % 30 === 0) for (const o of prima.keys()) if (!vivi.has(o)) { prima.delete(o); aperti.delete(o); ultimoArco.delete(o); }
  };
  const upd = B.update;
  B.update = function (...args) { upd.apply(this, args); misura(); };
  // dopo un teletrasporto il passo successivo non è un salto: si ricomincia da capo
  const azzera = () => { prima.clear(); aperti.clear(); ultimoArco.clear(); };
  window.__moto = {
    azzera,
    fine: () => {
      delete B.update;
      const r = { casi, conti, peggio, passi, mezzi, km: Math.round(metri) / 1000 };
      return r;
    },
  };
}

// Le tre zone della prova: il giocatore fermo lontano dai binari, le auto nascono e girano attorno a lui; i bus
// automatici corrono su tutta la mappa. Centro (Via Altinate, verso Riviera Tito Livio e Piazza Garibaldi), stazione
// (davanti al piazzale, con le rotonde del SIR3), sud-est (strade di quartiere, rotonde e strade chiuse).
export const ZONE = [
  { nome: 'centro', x: 230, z: -132 },
  { nome: 'stazione', x: 450, z: -850 },
  { nome: 'sud-est', x: 2300, z: 3000 },
];

// in pagina: sec secondi di gioco in ognuna delle zone, guardando il moto (osservaMoto già chiamata)
export function giraZone({ zone, sec, dt = 1 / 30 }) {
  const g = window.__game;
  for (const z of zone) {
    g.teleport(z.x, z.z);
    g.sim(2, dt, false);
    window.__moto.azzera();
    g.sim(sec, dt, false);
  }
  return window.__moto.fine();
}
