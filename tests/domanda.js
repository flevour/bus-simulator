// Domanda di traffico (#116): le regole della prova di tests/domanda.spec.js. Non importa nulla da Playwright: le
// funzioni girano in pagina (page.evaluate).
//
// Tre corridoi dove il GTFS ha le corse più lente nelle ore di punta (scripts/gtfs_tempi.py, docs/domanda.md,
// sezione 7): un tratto di una via con nome, da un capo all'altro, nei due versi. Per ogni ora il disco delle auto
// (Traffic.centro) sta fermo a metà del corridoio e chi guida è lontano; dopo un riscaldamento partono delle auto
// sonda nei due versi, con un viaggio fino all'altro capo (seguono l'albero dell'arrivo come le altre), e si misura
// quanto ci mettono. La prova confronta le medie per verso tra le ore.
export const CORRIDOI = [
  { nome: 'Via Sorio', da: [-1970, 778], a: [-1170, 426], vie: ['Via Sorio'] },
  { nome: 'Via Facciolati', da: [1114, 1685], a: [641, 894], vie: ['Via Jacopo Facciolati', ''] },
  { nome: 'Via Ariosto e Via Gattamelata', da: [1874, -17], a: [1071, 567], vie: ['Via Ludovico Ariosto', 'Via Gattamelata', ''] },
];
// ore della prova e partenza della 10 da cui si parte (la corsa più vicina; poi l'orologio va all'ora giusta)
export const ORE = [
  { ora: 8, partenza: '08:06' },
  { ora: 11, partenza: '10:45' },
  { ora: 18, partenza: '17:45' },
  { ora: 22, partenza: '21:45' },
];

// in pagina: il percorso più veloce sulle vie del corridoio da (ax, az) a (bx, bz), come stati della rete delle auto
// (src/world/domanda.js): dallo stato su quelle vie più vicino al primo capo, nel verso dell'altro, a quello più vicino
// all'altro capo
export function corridoioStati({ da, a, vie }) {
  const g = window.__game, D = g.domanda, E = g.net.edges;
  const L0 = Math.hypot(a[0] - da[0], a[1] - da[1]), dx = (a[0] - da[0]) / L0, dz = (a[1] - da[1]) / L0;
  const su = (x, z) => {
    let best = -1, bd = Infinity;
    for (const e of E) {
      if (!vie.includes(e.name)) continue;
      for (const f of [0, 1]) {
        const s = 2 * e.id + f;
        if (D.so[s] === D.so[s + 1]) continue;
        const ex = f ? -e.dx : e.dx, ez = f ? -e.dz : e.dz;
        if (ex * dx + ez * dz < 0.3) continue;
        const d = (D.mx[e.id] - x) ** 2 + (D.mz[e.id] - z) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
    }
    return best;
  };
  const sA = su(da[0], da[1]), sB = su(a[0], a[1]);
  const p = sA >= 0 && sB >= 0 ? D.percorso(sA, D.alberoOra(sB)) : null;
  if (!p) return null;
  let lungo = 0;
  for (const s of p) lungo += E[s >> 1].len;
  return { stati: p, lungo };
}

// in pagina, con la corsa appena avviata (statiFn: corridoioStati come testo): l'orologio all'ora data, chi guida a 900 m dal corridoio, il disco delle auto
// fermo a metà; riscaldamento di `warm` secondi, poi `sonde` auto per verso, una ogni `passo` secondi, e il tempo di
// ognuna fino all'altro capo (null se in 600 s non ci arriva). Restituisce i tempi per verso e lo stato del disco
export function misuraCorridoio({ corr, ora, statiFn, warm = 60, sonde = 3, passo = 15 }) {
  const g = window.__game, T = g.traffic, D = g.domanda, E = g.net.edges;
  const stati = new Function('return ' + statiFn)();
  g.mission.clock = ora * 3600;
  const mx = (corr.da[0] + corr.a[0]) / 2, mz = (corr.da[1] + corr.a[1]) / 2;
  const L0 = Math.hypot(corr.a[0] - corr.da[0], corr.a[1] - corr.da[1]), nx = -(corr.a[1] - corr.da[1]) / L0, nz = (corr.a[0] - corr.da[0]) / L0;
  const s = g.city.snapToRoad(mx + nx * 900, mz + nz * 900, 300) || g.city.snapToRoad(mx - nx * 900, mz - nz * 900, 300);
  g.teleport(s.cx, s.cz);
  T.centro = { x: mx, z: mz };
  T.cars.length = 0;
  D.P = null;
  T.popola(g.bus, g.mission.clock, g.settings.variant);
  g.sim(warm, 1 / 30, false);
  const versi = [stati({ ...corr }), stati({ ...corr, da: corr.a, a: corr.da })];
  const tutte = [];
  let t = 0;
  // una sonda: un'auto con un viaggio fino all'ultimo stato del corridoio, all'inizio del primo stato dove ci sta (le
  // auto a meno di 12 m dal suo posto escono di scena: la sonda parte comunque)
  const lancia = (v, k) => {
    const ultimo = v.stati[v.stati.length - 1], albero = D.alberoOra(ultimo);
    for (const s0 of v.stati.slice(0, 4)) {
      const nuove = [], c = T.metti(E[s0 >> 1], !(s0 & 1), 0, { arrivo: ultimo, albero }, { x: 1e9, z: 1e9 }, 0, Infinity, nuove);
      if (!c) continue;
      for (let i = T.cars.length - 1; i >= 0; i--) if (Math.hypot(T.cars[i].x - c.x, T.cars[i].z - c.z) < 12) T.cars.splice(i, 1);
      c.sonda = true;
      T.cars.push(c);
      const eU = E[ultimo >> 1];
      tutte.push({ c, verso: k, fine: g.net.nodes[ultimo & 1 ? eU.a : eU.b], da: t, t: null });
      return;
    }
    tutte.push({ c: null, verso: k, t: null });
  };
  while (t < 600 && (tutte.length < 2 * sonde || tutte.some((x) => x.c && x.t == null && T.cars.includes(x.c)))) {
    if (tutte.length < 2 * sonde && t >= (tutte.length / 2) * passo) { lancia(versi[0], 0); lancia(versi[1], 1); }
    g.sim(1, 1 / 30, false);
    t += 1;
    // arrivata: entro 20 m dal nodo dove finisce l'ultimo stato (l'ultimo stato può essere più corto di quello che
    // l'auto fa in un secondo, e arrivata l'auto esce di scena)
    for (const x of tutte) if (x.c && x.t == null && T.cars.includes(x.c) && Math.hypot(x.c.x - x.fine.x, x.c.z - x.fine.z) < 20) x.t = t - x.da;
  }
  T.centro = null;
  return {
    ora,
    lungo: versi.map((v) => Math.round(v.lungo)),
    tempi: [0, 1].map((k) => tutte.filter((x) => x.verso === k).map((x) => x.t)),
    raggio: T.raggio, quante: T.quante, auto: T.cars.length,
  };
}
