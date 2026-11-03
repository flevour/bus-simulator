// Rete di strade secondarie generata a partire dalle vie principali.
// Le vie principali (quelle delle linee) sono reali; le traverse sono procedurali:
// crescono perpendicolari alle strade esistenti e si fermano sulla prima strada,
// sui corsi d'acqua, sulla ferrovia o sui monumenti, formando isolati connessi.

const NAMES = [
  'Via Dante', 'Via Petrarca', 'Via Manzoni', 'Via Verdi', 'Via Rossini', 'Via Puccini', 'Via Leopardi', 'Via Carducci',
  'Via Foscolo', 'Via Goldoni', 'Via Ariosto', 'Via Tasso', 'Via Galilei', 'Via Volta', 'Via Marconi', 'Via Fermi',
  'Via Cimarosa', 'Via Donizetti', 'Via Bellini', 'Via Monteverdi', 'Via Vivaldi', 'Via Tiepolo', 'Via Canova', 'Via Mantegna',
  'Via Palladio', 'Via Sansovino', 'Via Tintoretto', 'Via Veronese', 'Via Giorgione', 'Via Bembo', 'Via Ruzante', 'Via Morgagni',
  'Via Vesalio', 'Via Falloppio', 'Via Cornaro', 'Via Facciolati', 'Via Nievo', 'Via Fogazzaro', 'Via Pascoli', 'Via Verga',
  'Via Pirandello', 'Via Deledda', 'Via Svevo', 'Via Montale', 'Via Ungaretti', 'Via Quasimodo', 'Via dei Tigli', 'Via dei Platani',
  'Via dei Pioppi', 'Via degli Ontani', 'Via delle Rose', 'Via dei Gelsi', 'Via del Pescarotto', 'Via dei Mille', 'Via Trento',
  'Via Trieste', 'Via Gorizia', 'Via Udine', 'Via Treviso', 'Via Rovigo', 'Via Vicenza', 'Via Verona', 'Via Belluno', 'Via Asiago',
];

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

// raggio P + d*t contro segmento AB: ritorna t (distanza) o null
function raySeg(px, pz, dx, dz, ax, az, bx, bz) {
  const sx = bx - ax, sz = bz - az;
  const den = dx * sz - dz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((ax - px) * sz - (az - pz) * sx) / den;
  const u = ((ax - px) * dz - (az - pz) * dx) / den;
  if (t <= 0.5 || u < 0 || u > 1) return null;
  return { t, u };
}

const CENTRO = { x: -150, z: 120 };
function zoneOf(x, z) {
  const d = Math.hypot(x - CENTRO.x, (z - CENTRO.z) * 1.15);
  return d < 950 ? 0 : d < 2300 ? 1 : 2;
}

/**
 * nodes: { id: {x, z, name} }  (modificato: aggiunge nodi generati)
 * segs:  [{ a, b, name, width, main, orig, elev }] (modificato)
 * blockers: [{ pts:[{x,z}], hw }]  acqua e ferrovia
 * zones: [{ x, z, r }]              monumenti
 */
export function growStreets(nodes, segs, blockers, zones, seed = 2024) {
  const rnd = rng(seed);
  let nid = 0;
  const P = (id) => nodes[id];
  const segLen = (s) => Math.hypot(P(s.b).x - P(s.a).x, P(s.b).z - P(s.a).z);

  const blocked = (x, z, margin) => {
    for (const b of blockers)
      for (let i = 0; i < b.pts.length - 1; i++)
        if (segDist(x, z, b.pts[i].x, b.pts[i].z, b.pts[i + 1].x, b.pts[i + 1].z).d < b.hw + margin) return true;
    for (const zn of zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return true;
    return false;
  };
  const nearNode = (x, z, r) => {
    let best = null, bd = r;
    for (const [id, n] of Object.entries(nodes)) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  };
  // distanza minima da nodi con fermata lungo le strade principali
  const nearNamed = (x, z, r) => Object.values(nodes).some((n) => n.name && Math.hypot(n.x - x, n.z - z) < r);

  // divide il segmento s nel punto (x,z); ritorna l'id del nodo creato/riusato
  const split = (s, x, z) => {
    const A = P(s.a), B = P(s.b);
    if (Math.hypot(A.x - x, A.z - z) < 18) return s.a;
    if (Math.hypot(B.x - x, B.z - z) < 18) return s.b;
    const id = 'g' + nid++;
    nodes[id] = { x, z, name: null };
    const s2 = { ...s, a: id };
    s.b = id;
    segs.push(s2);
    return id;
  };

  const grow = (sources, gen) => {
    for (const src of sources) {
      const A0 = P(src.a), B0 = P(src.b);
      const L = Math.hypot(B0.x - A0.x, B0.z - A0.z);
      if (src.elev) continue;
      const dx = (B0.x - A0.x) / L, dz = (B0.z - A0.z) / L;
      const zone0 = zoneOf((A0.x + B0.x) / 2, (A0.z + B0.z) / 2);
      const spacing = [92, 140, 190][zone0] * (gen === 2 ? 1.1 : 1);
      for (let s = spacing * (0.45 + rnd() * 0.3); s < L - 40; s += spacing * (0.8 + rnd() * 0.4)) {
        const px = A0.x + dx * s, pz = A0.z + dz * s;
        const zone = zoneOf(px, pz);
        if (Math.hypot(px - CENTRO.x, pz - CENTRO.z) > 4300) continue;
        if (nearNode(px, pz, 40)) continue;
        if (src.main && nearNamed(px, pz, 60)) continue;
        for (const side of [-1, 1]) {
          if (zone === 2 && rnd() < 0.3) continue;
          const jitter = (rnd() - 0.5) * 0.18;
          let rx = -dz * side, rz = dx * side;
          const c = Math.cos(jitter), sn = Math.sin(jitter);
          [rx, rz] = [rx * c - rz * sn, rx * sn + rz * c];
          const maxLen = [450, 900, 1100][zone];
          // prima strada colpita
          let hit = null;
          for (const sg of segs) {
            if (sg === src) continue;
            const a = P(sg.a), b = P(sg.b);
            const r = raySeg(px, pz, rx, rz, a.x, a.z, b.x, b.z);
            if (r && r.t < maxLen && (!hit || r.t < hit.t)) hit = { t: r.t, seg: sg };
          }
          // ostacoli lungo il tragitto
          const lim = hit ? hit.t : maxLen;
          let end = lim, stopped = false;
          for (let t = 12; t < lim; t += 8) {
            if (blocked(px + rx * t, pz + rz * t, 6)) { end = t - 6; stopped = true; break; }
          }
          let target = null;
          if (hit && !stopped) {
            if (hit.seg.elev) continue;
            const hx = px + rx * hit.t, hz = pz + rz * hit.t;
            if (hit.seg.main && nearNamed(hx, hz, 55)) continue;
            target = { seg: hit.seg, x: hx, z: hz };
          } else {
            // vicolo cieco: solo fuori dal centro e se abbastanza lungo
            if (zone === 0 && !stopped) continue;
            end = Math.min(end, stopped ? end : [0, 260, 320][zone]);
            if (end < 70) continue;
          }
          const len = target ? hit.t : end;
          if (len < 45) continue;
          // non correre parallela e vicina ad altre strade
          let tooClose = false;
          for (let t = 30; t < len - 25 && !tooClose; t += 25) {
            const qx = px + rx * t, qz = pz + rz * t;
            for (const sg of segs) {
              if (sg.orig === src.orig || (target && sg.orig === target.seg.orig)) continue;
              const a = P(sg.a), b = P(sg.b);
              if (segDist(qx, qz, a.x, a.z, b.x, b.z).d < 32) { tooClose = true; break; }
            }
          }
          if (tooClose) continue;
          // crea i nodi
          const startSeg = segs.find((sg) => {
            const a = P(sg.a), b = P(sg.b);
            return sg.orig === src.orig && segDist(px, pz, a.x, a.z, b.x, b.z).d < 0.5;
          });
          if (!startSeg) continue;
          const n0 = split(startSeg, px, pz);
          let n1;
          if (target) {
            const snap = nearNode(target.x, target.z, 20);
            n1 = snap || split(segs.find((sg) => sg.orig === target.seg.orig && (() => { const a = P(sg.a), b = P(sg.b); return segDist(target.x, target.z, a.x, a.z, b.x, b.z).d < 0.5; })()) || target.seg, target.x, target.z);
          } else {
            n1 = 'g' + nid++;
            nodes[n1] = { x: px + rx * end, z: pz + rz * end, name: null };
          }
          if (n0 === n1) continue;
          const width = zone === 0 ? 7 : 7.5;
          const ns = { a: n0, b: n1, name: NAMES[Math.floor(rnd() * NAMES.length)], width, main: false, gen, orig: 's' + segs.length };
          segs.push(ns);
        }
      }
    }
  };

  const mainSegs = segs.filter((s) => s.main);
  grow(mainSegs.slice(), 1);
  // le traverse lunghe generano a loro volta altre traverse (isolati)
  grow(segs.filter((s) => s.gen === 1 && segLen(s) > 170), 2);
  grow(segs.filter((s) => s.gen === 2 && segLen(s) > 220), 3);
  return segs;
}
