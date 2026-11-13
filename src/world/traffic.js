import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid, distToSeg, mulberry32 } from './spatial.js';
import { Y_ROAD, TRAM_HW, zoneOf, edgeHeight, layer } from './city.js';
import { ledTexture } from './textures.js';
import { TRAM, tramLength, buildTramConvoy, setPantograph, YardRun } from '../tram/tram.js';
import { driverFigure, setWave } from './driver.js';
import { driveOffset, laneSpan } from '../data/padova.js';
import { turni } from '../game/turni.js';

// ------------------------------------------------------------------
// Semafori
// ------------------------------------------------------------------
// Senza i nodi OSM: semafori agli incroci tra vie molto percorse (almeno tre bracci con 4+ linee),
// a non meno di 90 m l'uno dall'altro
function guessSignals(net) {
  const weight = (n) => n.edges.reduce((s, e) => s + e.routes, 0);
  const cand = Object.values(net.nodes)
    .filter((n) => n.edges.length >= 3 && !n.edges.some((e) => e.roundabout) && n.edges.filter((e) => e.cls <= 2 || e.routes >= 2).length >= 3 && Math.hypot(n.x + 150, n.z - 120) < 4800)
    .sort((a, b) => weight(b) - weight(a));
  const chosen = [];
  for (const n of cand) if (!chosen.some((k) => Math.hypot(k.x - n.x, k.z - n.z) < 90)) chosen.push(n);
  return chosen.map((n) => ({ ped: false, nodes: [n] }));
}

// Tempi (art. 159–168 Regolamento CdS, Nota MIT 67906/2007 per il giallo). Il ciclo è comune a tutti gli impianti,
// così l'onda verde tiene: 60 s, più corto dei 90 s tipici ma con le stesse proporzioni
const CYCLE = 60, ALL_RED = 2, PED_GREEN = 12;
const TRAM_Y = 3; // giallo di chi lascia il verde al tram
const MIN_G = 10; // verde minimo di chi taglia il binario prima che un tram glielo tolga
const TRAM_HOLD = 30; // oltre questa durata della fase tram non entrano altri tram
const WAVE_V = 12; // m/s (circa 43 km/h): velocità dell'onda verde lungo le vie coordinate
const WAVE_REACH = 700; // m: distanza massima tra due impianti coordinati
const HEAD_Y = 2.3; // bordo inferiore della lanterna sul palo (2–3 m)
const MAST_Y = 5.4; // bordo inferiore della lanterna sopra la carreggiata (5,10–6,00 m)
const HEAD_H = 1.05;

// punto e direzione (verso l'esterno) a d metri dal centro del nodo n lungo il braccio e, oltre i vertici intermedi;
// from = estremo dell'arco verso l'incrocio, t = metri da from, end = lunghezza del braccio fino al prossimo incrocio
function armPoint(nodes, n, e, d) {
  let from = n, arc = e, d0 = 0;
  for (let k = 0; k < 60; k++) {
    const o = arc.a === from.id ? 1 : -1, to = nodes[o > 0 ? arc.b : arc.a];
    if (d <= d0 + arc.len || to.edges.length !== 2) {
      const dx = arc.dx * o, dz = arc.dz * o, t = d - d0;
      return { x: from.x + dx * t, z: from.z + dz * t, dx, dz, arc, from, t, end: to.edges.length !== 2 ? d0 + arc.len : Infinity };
    }
    d0 += arc.len;
    arc = to.edges[0] === arc ? to.edges[1] : to.edges[0];
    from = to;
  }
  return null;
}

// strisce pedonali lungo il braccio: metri dal centro del nodo, fino a maxD
function armCrossings(nodes, n, e, maxD) {
  const out = [];
  let from = n, arc = e, d0 = 0;
  for (let k = 0; k < 60 && d0 < maxD; k++) {
    const o = arc.a === from.id ? 1 : -1, to = nodes[o > 0 ? arc.b : arc.a];
    for (const s of arc.cross || []) { const d = d0 + (o > 0 ? s : arc.len - s); if (d <= maxD) out.push(d); }
    d0 += arc.len;
    if (to.edges.length !== 2) break;
    arc = to.edges[0] === arc ? to.edges[1] : to.edges[0];
    from = to;
  }
  return out;
}

export class TrafficLights {
  constructor(scene, net, city = null) {
    this.net = net;
    this.city = city;
    this.signals = [];
    this.byKey = new Map(); // `${nodo}:${arco}` -> approccio
    this.stopArcs = new Map(); // `${arco}:${nodo verso cui si va}` -> { ap, t }: arco con la linea d'arresto, a t m dal nodo
    this.stats = { approcci: 0, lineaOsm: 0, palo: 0, muro: 0, senzaPalo: 0, ripetitrici: 0, sbracci: 0 };
    const rnd = mulberry32(99);
    const rank = (e) => e.cls * 10 - Math.min(e.routes || 0, 9);
    const arms = net.signalArms;
    // un incrocio grande (strade a carreggiate separate) occupa più nodi del grafo: un solo impianto per tutti
    for (const g of net.signals || guessSignals(net)) {
      const inside = new Set(g.nodes);
      const appr = [];
      for (const n of g.nodes)
        for (const e of n.edges) {
          // niente lanterna sui tratti interni all'incrocio, sulle vie pedonali, sui sensi unici in uscita e, per i
          // semafori pedonali con traffic_signals:direction, nel verso che OSM esclude
          if (e.ped || inside.has(net.nodes[e.a === n.id ? e.b : e.a]) || (e.oneway && (e.oneway === 1 ? e.b : e.a) !== n.id)) continue;
          const info = arms && arms.get(`${n.id}:${e.id}`);
          if (info && info.off) continue;
          const out = e.a === n.id ? { x: e.dx, z: e.dz } : { x: -e.dx, z: -e.dz };
          appr.push({ node: n, edge: e, out, ang: Math.atan2(out.z, out.x), info, lanes: info ? info.lanes : e.oneway && e.width >= 7 ? 2 : 1 });
        }
      if (!appr.length) continue;
      // fase 0: la strada principale e quelle allineate; fase 1: le trasversali (i semafori pedonali hanno solo la 0)
      const ref = appr.reduce((p, q) => (rank(q.edge) < rank(p.edge) ? q : p));
      for (const ap of appr) {
        const d = Math.abs(((ap.ang - ref.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI); // 0 = opposto, PI = stesso
        ap.phase = g.ped || d < Math.PI / 4 || d > (Math.PI * 3) / 4 ? 0 : 1;
      }
      // giallo 3 s a 50 km/h, 4 s con molti mezzi pesanti (le vie dei bus); tutto rosso 2 s; verdi in proporzione
      // all'importanza delle vie di ciascuna fase. Pedonale: verde lungo ai veicoli, poi il rosso per chi attraversa
      const Y = appr.some((a) => a.edge.routes > 0) ? 4 : 3;
      let cycle;
      if (g.ped) cycle = [CYCLE - Y - PED_GREEN - 2 * ALL_RED, Y, ALL_RED, PED_GREEN, 0, ALL_RED];
      else {
        const imp = (ph) => Math.max(0, ...appr.filter((a) => a.phase === ph).map((a) => (9 - a.edge.cls) * 2 + Math.min(a.edge.routes || 0, 6)));
        const w0 = imp(0), w1 = imp(1), free = CYCLE - 2 * (Y + ALL_RED);
        const f = w1 > 0 ? Math.min(0.68, Math.max(0.45, w0 / (w0 + w1))) : 0.68;
        const G0 = Math.round(free * f);
        cycle = [G0, Y, ALL_RED, free - G0, Y, ALL_RED];
      }
      const sig = { nodes: g.nodes, ped: g.ped, appr, offset: rnd() * CYCLE, cycle, total: CYCLE, gAge: [0, 0] };
      for (const n of g.nodes) n.signal = sig;
      for (const ap of appr) this.byKey.set(`${ap.node.id}:${ap.edge.id}`, ap);
      this.signals.push(sig);
    }
    for (const s of this.signals) for (const ap of s.appr) this.placeApproach(s, ap);
    this.greenWave();
    this.buildMeshes(scene);
    this.time = 0;
    this._c = new THREE.Color();
    this.update(0);
  }

  // linea d'arresto, pali e lanterne di un approccio
  placeApproach(sig, ap) {
    const nodes = this.net.nodes, n = ap.node, e = ap.edge, city = this.city;
    this.stats.approcci++;
    // linea d'arresto: dove OSM mette il semaforo del braccio, altrimenti 1 m prima delle strisce vicine all'incrocio,
    // altrimenti appena fuori dall'incrocio. Mai sulle strisce e sempre sull'arco d'arrivo (lì si fermano i veicoli)
    const trim = n.trim ? n.trim.get(e) : n.joint ? 0 : n.radius * 0.6;
    const cross = armCrossings(nodes, n, e, sig.ped ? 5 : trim + 14);
    let s = cross.length ? Math.max(...cross) + 2.7 : sig.ped ? 3.2 : trim + 1.0;
    // il nodo OSM del semaforo è spesso sull'angolo dell'incrocio, oltre le strisce: vale solo se è più lontano
    if (ap.info && ap.info.stop > s) { s = ap.info.stop; this.stats.lineaOsm++; }
    s = Math.max(s, trim + 0.6);
    for (const c of cross) if (c - 2.2 < s && c + 2.2 > s) s = c + 2.7;
    // la linea può stare su un arco precedente (bracci con vertici intermedi vicino all'incrocio), non oltre il braccio
    let p = armPoint(nodes, n, e, s);
    if (s > p.end - 2) p = armPoint(nodes, n, e, (s = Math.max(Math.min(s, p.end - 2), Math.min(trim + 0.6, p.end - 1))));
    ap.stop = s;
    this.stopArcs.set(`${p.arc.id}:${p.from.id}`, { ap, t: p.t });
    const q = armPoint(nodes, n, e, ap.stop + 12);
    // le lanterne guardano chi arriva, lungo l'asse del braccio alla linea d'arresto (non l'arco del grafo)
    let fx = q.x - p.x, fz = q.z - p.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    ap.face = { x: fx, z: fz };
    const hw = e.width / 2;
    const off = (x, z) => (city ? (city.asphRings ? city.surfaceOff(x, z) : city.clearance(x, z, ['road'], 20)) : 1);
    // bordo dell'asfalto da un lato (side 1 = destra di chi arriva): dall'asse si attraversa la carreggiata fino al
    // primo punto fuori
    const edgeAt = (px, pz, side) => {
      const rx = fz * side, rz = -fx * side;
      let seen = off(px, pz) < 0;
      for (let o = 0.2; o <= hw + 16; o += 0.2) {
        const v = off(px + rx * o, pz + rz * o);
        if (v < 0) seen = true;
        else if (seen || o > hw) return o;
      }
      return null;
    };
    // 0 = libero, 1 = edificio (si può appendere la lanterna al muro), 2 = asfalto, binari o altro
    const free = (x, z) => {
      if (!city) return 0;
      if (off(x, z) < 0.25 || city.clearance(x, z, ['tram', 'rail'], 15) < 0.4) return 2;
      const arr = city.obstacles.query(x, z, 3, this._oq || (this._oq = []));
      for (const b of arr) {
        const dx = x - b.x, dz = z - b.z, u = dx * b.c + dz * b.s, v = -dx * b.s + dz * b.c;
        if (Math.abs(u) < b.hx + 0.2 && Math.abs(v) < b.hz + 0.2) return b.kind === 'building' ? 1 : 2;
      }
      return 0;
    };
    // palo appena oltre la linea d'arresto (art. 168: il primo veicolo fermo vede le luci), 0,6 m fuori dall'asfalto;
    // se lì non c'è posto, poco più avanti o poco prima. Dove il marciapiede è stretto e c'è la facciata (centro
    // storico) la lanterna va su una mensola a muro
    const place = (side) => {
      let wall = null;
      for (const d of [-0.6, -1.6, -2.8, 0.6, 1.8, 3.2]) {
        const sp = ap.stop + d;
        if (sp < 0.5) continue;
        const a = armPoint(nodes, n, e, sp);
        const o = edgeAt(a.x, a.z, side);
        if (o == null) continue;
        const at = (po) => ({ x: a.x + fz * side * po, z: a.z - fx * side * po, o: po });
        const P = at(o + 0.6), f = free(P.x, P.z);
        if (f === 0) return P;
        if (f === 1 && !wall) { const W = at(o + 0.25); if (free(W.x, W.z) !== 2) wall = { ...W, wall: true }; }
      }
      return wall;
    };
    const h = n.h || 0;
    ap.heads = [];
    ap.poles = [];
    // a destra; sui sensi unici, se a destra non c'è posto (sede del tram accanto), a sinistra
    let R = place(1), Rs = 1;
    if (!R && e.oneway) { R = place(-1); Rs = -1; }
    if (R) {
      this.stats.palo++;
      if (R.wall) this.stats.muro++;
      ap.pos = { x: R.x, z: R.z };
      // vie larghe (due o più corsie nel verso) o palo lontano dalle corsie: palo a sbraccio con la lanterna sopra le
      // corsie di chi arriva
      const reach = R.o - Rs * (e.oneway ? 0 : hw / 2); // dal palo al centro delle corsie di chi arriva
      const mast = !R.wall && !sig.ped && e.cls <= 5 && (ap.lanes >= 2 || reach > hw + 3.5) ? Math.min(10, reach) : 0;
      if (!R.wall) ap.poles.push({ x: R.x, z: R.z, y: h, mast, side: Rs });
      ap.heads.push({ x: R.x + fx * 0.2, y: h + 0.1 + HEAD_Y + (R.wall ? 0.5 : 0), z: R.z + fz * 0.2, wall: R.wall ? Rs : 0 });
      if (mast) {
        this.stats.sbracci++;
        ap.heads.push({ x: R.x - fz * Rs * mast + fx * 0.2, y: h + 0.1 + MAST_Y, z: R.z + fx * Rs * mast + fz * 0.2 });
      }
    } else {
      this.stats.senzaPalo++;
      ap.pos = { x: p.x + fz * (hw + 1), z: p.z - fx * (hw + 1) };
    }
    // ripetitrice a sinistra, obbligatoria sui sensi unici con due o più corsie (art. 168 c. 3)
    if (e.oneway && ap.lanes >= 2 && Rs === 1) {
      const Lp = place(-1);
      if (Lp) {
        this.stats.ripetitrici++;
        if (!Lp.wall) ap.poles.push({ x: Lp.x, z: Lp.z, y: h, mast: 0, side: -1 });
        ap.heads.push({ x: Lp.x + fx * 0.2, y: h + 0.1 + HEAD_Y + (Lp.wall ? 0.5 : 0), z: Lp.z + fz * 0.2, wall: Lp.wall ? -1 : 0 });
      }
    }
    // linea d'arresto: continua, larga 50 cm, sulle corsie di chi arriva (art. 144)
    const er = edgeAt(p.x, p.z, 1);
    const el = e.oneway ? edgeAt(p.x, p.z, -1) : null;
    // con le corsie di OSM dalla riga che separa i versi (anche quella gialla di una corsia dei bus in controsenso)
    const span = e.osmLanes ? laneSpan(e, e.b === n.id) : null;
    const w0 = span && span[0] > -hw ? span[0] + 0.15 : e.oneway ? -((el ?? hw) - 0.3) : 0.15;
    ap.line = { x: p.x, z: p.z, fx, fz, w0, w1: (er ?? hw) - 0.3, y: h };
  }

  // onda verde: lungo una via, l'impianto a valle accende il verde quando arriva chi è partito col verde da quello a
  // monte, a WAVE_V. Si coordina a partire dagli impianti più importanti (più linee bus)
  greenWave() {
    const nodes = this.net.nodes, bySig = new Map();
    for (const s of this.signals) for (const n of s.nodes) bySig.set(n, s);
    const start = (s, p) => (p === 0 ? 0 : s.cycle[0] + s.cycle[1] + s.cycle[2]);
    const links = new Map(this.signals.map((s) => [s, []]));
    for (const s of this.signals)
      for (const ap of s.appr) {
        // si risale la via di chi arriva fino all'impianto precedente
        let from = ap.node, arc = ap.edge, d = 0;
        for (let k = 0; k < 200 && d < WAVE_REACH; k++) {
          const o = arc.a === from.id ? 1 : -1, to = nodes[o > 0 ? arc.b : arc.a], dx = arc.dx * o, dz = arc.dz * o;
          d += arc.len;
          const s2 = bySig.get(to);
          if (s2 && s2 !== s) {
            // a monte, la fase di chi va verso s: l'approccio allineato con il verso di marcia
            let best = null, bd = 0.6;
            for (const a2 of s2.appr) { const dot = a2.out.x * dx + a2.out.z * dz; if (dot > bd) { bd = dot; best = a2; } }
            if (best) {
              const l = { up: s2, upPhase: best.phase, down: s, downPhase: ap.phase, d };
              links.get(s).push(l);
              links.get(s2).push(l);
            }
            break;
          }
          let next = null, bd = 0.7;
          for (const e2 of to.edges) {
            if (e2 === arc || e2.ped) continue;
            const o2 = e2.a === to.id ? 1 : -1, dot = e2.dx * o2 * dx + e2.dz * o2 * dz;
            if (dot > bd) { bd = dot; next = e2; }
          }
          if (!next) break;
          from = to;
          arc = next;
        }
      }
    const weight = (s) => s.appr.reduce((a, ap) => a + (ap.edge.routes || 0), 0);
    const done = new Set();
    for (const root of [...this.signals].sort((a, b) => weight(b) - weight(a))) {
      if (done.has(root)) continue;
      done.add(root);
      const queue = [root];
      while (queue.length) {
        const s = queue.shift();
        for (const l of links.get(s)) {
          // verde di "down" (fase downPhase) = verde di "up" (fase upPhase) + d / WAVE_V
          const other = l.up === s ? l.down : l.up;
          if (done.has(other)) continue;
          const t = l.d / WAVE_V;
          if (other === l.down) other.offset = s.offset - start(s, l.upPhase) + start(other, l.downPhase) - t;
          else other.offset = s.offset - start(s, l.downPhase) + start(other, l.upPhase) + t;
          other.offset = ((other.offset % CYCLE) + CYCLE) % CYCLE;
          done.add(other);
          queue.push(other);
        }
      }
    }
  }

  buildMeshes(scene) {
    const parts = [], Y = new THREE.Vector3(0, 1, 0), Q = new THREE.Quaternion(), M = new THREE.Matrix4(), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
    const pole = new THREE.CylinderGeometry(0.07, 0.09, 1, 6).translate(0, 0.5, 0);
    const mastPole = new THREE.CylinderGeometry(0.1, 0.14, 1, 8).translate(0, 0.5, 0);
    const arm = new THREE.CylinderGeometry(0.06, 0.07, 1, 6).rotateZ(Math.PI / 2).translate(-0.5, 0, 0);
    // lanterna: cassa, pannello di contrasto nero e visiere sopra le tre luci
    const head = mergeGeometries([
      new THREE.BoxGeometry(0.36, HEAD_H, 0.26).translate(0, HEAD_H / 2, 0),
      new THREE.BoxGeometry(0.62, HEAD_H + 0.25, 0.03).translate(0, HEAD_H / 2, -0.15),
      ...[0, 1, 2].map((k) => new THREE.BoxGeometry(0.3, 0.025, 0.17).translate(0, HEAD_H - 0.02 - k * 0.33, 0.215)),
    ]);
    const add = (g, x, y, z, ang, sy = 1, sx = 1) => {
      Q.setFromAxisAngle(Y, ang);
      M.compose(P.set(x, y, z), Q, S.set(sx, sy, 1));
      parts.push(g.clone().applyMatrix4(M));
    };
    let heads = 0;
    for (const s of this.signals)
      for (const ap of s.appr) {
        const ang = Math.atan2(ap.face.x, ap.face.z);
        for (const pl of ap.poles) {
          if (pl.mast) {
            add(mastPole, pl.x, pl.y + 0.1, pl.z, 0, MAST_Y + HEAD_H + 0.3);
            // braccio verso il centro della carreggiata (a sinistra di chi arriva), poi la lanterna appesa
            add(arm, pl.x, pl.y + 0.1 + MAST_Y + HEAD_H + 0.05, pl.z, pl.side < 0 ? ang + Math.PI : ang, 1, pl.mast);
          } else add(pole, pl.x, pl.y + 0.1, pl.z, 0, HEAD_Y + HEAD_H - 0.1);
        }
        for (const hd of ap.heads) {
          add(head, hd.x, hd.y, hd.z, ang);
          // mensola verso la facciata
          if (hd.wall) add(arm, hd.x, hd.y + HEAD_H / 2, hd.z, hd.wall > 0 ? ang + Math.PI : ang, 1, 0.9);
          heads++;
        }
      }
    if (parts.length) {
      this.poles = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ color: 0x23272b }));
      this.poles.castShadow = true;
      scene.add(this.poles);
    }
    // luci (instanced: il colore cambia a ogni fase), lenti da 200 mm
    this.lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, heads * 3));
    let j = 0;
    for (const s of this.signals)
      for (const ap of s.appr) {
        Q.setFromAxisAngle(Y, Math.atan2(ap.face.x, ap.face.z));
        ap.lampIdx = j;
        for (const hd of ap.heads)
          for (let k = 0; k < 3; k++) {
            const lp = new THREE.Vector3(0, HEAD_H - 0.19 - k * 0.33, 0.135).applyQuaternion(Q);
            M.compose(P.set(hd.x + lp.x, hd.y + lp.y, hd.z + lp.z), Q, S.set(1, 1, 1));
            this.lamps.setMatrixAt(j++, M);
          }
        ap.lampN = j - ap.lampIdx;
      }
    this.lamps.count = j;
    this.lamps.instanceMatrix.needsUpdate = true;
    scene.add(this.lamps);
    // linee d'arresto
    const pos = [];
    for (const s of this.signals)
      for (const ap of s.appr) {
        const L = ap.line;
        if (!L || L.w1 - L.w0 < 0.8) continue;
        const rx = L.fz, rz = -L.fx, y = Y_ROAD + 0.022 + L.y;
        const Pt = (a, w) => [L.x + L.fx * a + rx * w, y, L.z + L.fz * a + rz * w];
        const a = Pt(-0.25, L.w0), b = Pt(-0.25, L.w1), c = Pt(0.25, L.w0), d = Pt(0.25, L.w1);
        pos.push(...a, ...c, ...b, ...b, ...c, ...d);
      }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      this.stopLines = new THREE.Mesh(g, layer(new THREE.MeshLambertMaterial({ color: 0xe8e8e0, side: THREE.DoubleSide }), 4));
      scene.add(this.stopLines);
    }
  }

  // Chiamata dei tram in arrivo (TramSignals): calls sono gli incroci col tram chiamati vicino all'impianto, ognuno con
  // le fasi che non tagliano il suo binario (x.free) e il suo segnale (x.state 'V': il tram ha già il via libera).
  // Fase tram: la fase libera per tutti i tram chiamati resta verde, o lo diventa dopo il giallo e il tutto rosso delle
  // altre, che vanno in rosso; senza fase libera rosso per tutti. Prima il rosso era per tutti anche dove il tram corre
  // lungo la strada (Riviera Tito Livio, Riviera dei Ponti Romani): il bus fermo al rosso sul binario davanti al tram
  // non partiva, il tram dietro di lui teneva viva la chiamata e il rosso durava.
  // Anche la strada ha il suo turno: la fase tram parte solo se chi viene tagliato ha avuto almeno MIN_G di verde e,
  // dopo una fase tram, il verde che gli spettava; dopo TRAM_HOLD non entrano altri tram e la fase finisce quando
  // escono quelli col via libera. Intanto il tram aspetta alla barra orizzontale (prima, con un tram dopo l'altro, in
  // Via Tommaseo alla stazione il rosso durava 95 s)
  tramCall(sig, calls, dt) {
    const shown = [this.stateOf(sig, 0), this.stateOf(sig, 1)];
    const has = (p) => sig.appr.some((a) => a.phase === p);
    if (sig.tramT > 0) {
      sig.tramAge += dt;
      if (sig.tramAge > TRAM_HOLD) sig.tramOpen = false;
      // serviti: chi ha il via libera, il tram che ce l'ha già su un altro incrocio dell'impianto e, a fase aperta,
      // tutti gli altri. Se uno di loro non passa con la fase scelta, si va verso una più stretta (al limite tutto
      // rosso) ripartendo da quello che si vede; col tutto rosso, appena i serviti passano tutti con una fase si va su
      // quella (prima si restava al tutto rosso fino a TRAM_HOLD: a Largo Europa, passato il SIR2 che taglia la strada,
      // il SIR1 alla lanterna di Riviera dei Ponti Romani aspettava 27 s col rosso e la strada con lui)
      const served = calls.filter((x) => sig.tramOpen || x.state === 'V' || x.who.some((t) => sig.vTrams.has(t)));
      if (served.length) {
        const free = [0, 1].filter((p) => has(p) && served.every((x) => x.free.includes(p)));
        if (sig.tramPh === -1 ? free.length : !served.every((x) => x.free.includes(sig.tramPh))) {
          sig.tramFrom = shown;
          sig.tramPh = free.find((p) => shown[p] === 'G') ?? free[0] ?? -1;
          sig.tramT = 0;
        }
        sig.tramT += dt;
        return;
      }
      // fine della fase tram: chi aveva il verde passa dal giallo; la fase tagliata ha subito il suo verde intero, appena
      // sgomberato l'incrocio (il ciclo si sposta). Prima aspettava il ciclo dopo se la fase tram aveva coperto il suo
      // verde: 94 s di rosso su Riviera dei Ponti Romani a Largo Europa
      sig.postFrom = shown;
      sig.tramT = 0;
      sig.postT = dt;
      sig.owed = [0, 1].map((p) => p !== sig.tramPh && has(p));
      const owed = [0, 1].filter((p) => sig.owed[p]);
      if (owed.length) {
        const p = owed.length > 1 ? (this.cycleState(sig, 1) === 'G' ? 1 : 0) : owed[0];
        const start = p === 0 ? 0 : sig.cycle[0] + sig.cycle[1] + sig.cycle[2];
        sig.offset = (((start - this.time - TRAM_Y - ALL_RED) % sig.total) + sig.total) % sig.total;
      }
      return;
    }
    if (sig.postT > 0) sig.postT = sig.postT + dt < TRAM_Y + ALL_RED ? sig.postT + dt : 0;
    if (!calls.length) return;
    const free = [0, 1].filter((p) => has(p) && calls.every((x) => x.free.includes(p)));
    const ph = free.length ? free.find((p) => shown[p] === 'G') ?? free[0] : -1;
    if ([0, 1].some((p) => p !== ph && has(p) && ((sig.owed && sig.owed[p]) || (shown[p] === 'G' && sig.gAge[p] < MIN_G)))) return;
    sig.tramFrom = shown;
    sig.tramPh = ph;
    sig.tramT = dt;
    sig.tramAge = dt;
    sig.tramOpen = true;
    sig.postT = 0;
  }
  stateOf(sig, phase) {
    if (sig.tramT > 0) {
      const s0 = sig.tramFrom[phase], t = sig.tramT;
      if (phase === sig.tramPh) return s0 === 'G' || t >= TRAM_Y + ALL_RED ? 'G' : s0 === 'Y' && t < TRAM_Y ? 'Y' : 'R';
      return s0 !== 'R' && t < TRAM_Y ? 'Y' : 'R';
    }
    const base = this.cycleState(sig, phase);
    if (sig.postT > 0) {
      // fine della chiamata: chi aveva il verde del tram lo lascia col giallo, gli altri aspettano l'incrocio libero
      const s1 = sig.postFrom[phase];
      if (s1 === 'G') return base === 'G' ? 'G' : sig.postT < TRAM_Y ? 'Y' : 'R';
      if (sig.postFrom[1 - phase] === 'G') return 'R';
    }
    return base;
  }
  cycleState(sig, phase) {
    let t = (this.time + sig.offset) % sig.total;
    const c = sig.cycle;
    // fasi: [A verde, A giallo, tutto rosso, B verde, B giallo, tutto rosso]
    let k = 0;
    while (k < 5 && t > c[k]) { t -= c[k]; k++; }
    if (phase === 0) return k === 0 ? 'G' : k === 1 ? 'Y' : 'R';
    return k === 3 ? 'G' : k === 4 ? 'Y' : 'R';
  }
  // approccio (linea d'arresto, fase) per chi arriva al nodo percorrendo l'arco "edge"; null se non c'è lanterna
  approach(node, edge) {
    return node.signal ? this.byKey.get(`${node.id}:${edge.id}`) || null : null;
  }
  // linea d'arresto sull'arco "edge" per chi va verso il nodo "to": { ap, t: metri prima di to }
  stopOn(edge, to) {
    return this.stopArcs.get(`${edge.id}:${to.id}`) || null;
  }
  // stato per chi arriva al nodo percorrendo l'arco "edge"
  lightFor(node, edge) {
    const ap = this.approach(node, edge);
    return ap ? this.stateOf(node.signal, ap.phase) : 'G'; // tratto interno all'incrocio: si libera l'incrocio
  }

  update(dt) {
    this.time += dt;
    const c = this._c;
    for (const s of this.signals) {
      // da quanto ogni fase mostra il verde (verde minimo prima della fase tram, verde dovuto dopo)
      for (const p of [0, 1]) {
        s.gAge[p] = this.stateOf(s, p) === 'G' ? s.gAge[p] + dt : 0;
        if (s.owed && s.owed[p] && s.gAge[p] >= MIN_G) s.owed[p] = false;
      }
      for (const ap of s.appr) {
        if (!ap.lampN) continue;
        const st = this.stateOf(s, ap.phase);
        if (st === ap._st) continue;
        ap._st = st;
        const cols = [st === 'R' ? 0xff2a1a : 0x2a0806, st === 'Y' ? 0xffb300 : 0x2a2006, st === 'G' ? 0x26ff6a : 0x062a10];
        for (let k = 0; k < ap.lampN; k++) this.lamps.setColorAt(ap.lampIdx + k, c.set(cols[k % 3]));
        this._dirty = true;
      }
    }
    if (this._dirty && this.lamps.instanceColor) { this.lamps.instanceColor.needsUpdate = true; this._dirty = false; }
  }
}

// ------------------------------------------------------------------
// Auto
// ------------------------------------------------------------------
const AHEAD = 50; // m di percorso davanti al muso in cui le auto guardano i binari degli incroci col tram
const CAR_COLORS = ['#c0c0c0', '#202020', '#f5f5f5', '#8a1c1c', '#1c3d8a', '#3a3a3a', '#6b6b6b', '#d8d0b8', '#2d5a3a', '#b5651d', '#e6c229', '#4a6fa5', '#9e9e9e', '#f0f0f0'];

function carGeometry() {
  const parts = [];
  const col = (g, c) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const cc = new THREE.Color(c);
    for (let i = 0; i < n; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g.toNonIndexed ? g : g;
  };
  parts.push(col(new THREE.BoxGeometry(1.78, 0.62, 4.2).translate(0, 0.62, 0), 0xffffff));
  parts.push(col(new THREE.BoxGeometry(1.6, 0.55, 2.2).translate(0, 1.2, -0.25), 0x9aa4ad));
  parts.push(col(new THREE.BoxGeometry(1.5, 0.5, 0.05).translate(0, 1.2, 0.87), 0x182028));
  parts.push(col(new THREE.BoxGeometry(1.5, 0.45, 0.05).translate(0, 1.2, -1.36), 0x182028));
  for (const x of [-0.8, 0.8]) for (const z of [-1.35, 1.35]) parts.push(col(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 10).rotateZ(Math.PI / 2).translate(x, 0.33, z), 0x111111));
  return mergeGeometries(parts);
}

export class Traffic {
  constructor(scene, net, city, lights, opts) {
    this.net = net;
    this.city = city;
    this.lights = lights;
    this.rnd = mulberry32(opts.seed || 42);
    this.target = opts.count;
    this.cars = [];
    this.grid = new Grid(30);
    const max = 220;
    this.mesh = new THREE.InstancedMesh(carGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), max);
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // le istanze si muovono: il bounding sphere iniziale non vale più
    // luci (anteriori bianche e posteriori rosse)
    const lg = mergeGeometries([
      ...[-0.6, 0.6].map((x) => { const g = new THREE.PlaneGeometry(0.35, 0.15).translate(x, 0.75, 2.11); return colorize(g, 0xfff4d0); }),
      ...[-0.65, 0.65].map((x) => { const g = new THREE.PlaneGeometry(0.3, 0.14).rotateY(Math.PI).translate(x, 0.8, -2.11); return colorize(g, 0xff2020); }),
    ]);
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x555555 });
    this.lightMesh = new THREE.InstancedMesh(lg, this.lightMat, max);
    this.lightMesh.count = 0;
    this.lightMesh.frustumCulled = false;
    scene.add(this.mesh, this.lightMesh);
    this.M = new THREE.Matrix4();
    this.Q = new THREE.Quaternion();
    this.Y = new THREE.Vector3(0, 1, 0);
    this.S = new THREE.Vector3(1, 1, 1);
    this.P = new THREE.Vector3();
    this.honks = [];
    this.bigs = []; // bus automatici: { x, z, h, v, atStop, circles, parts }
  }

  setNight(f) {
    this.lightMat.color.setScalar(0.35 + f * 0.65);
  }

  laneGeom(car) {
    const e = car.edge, n = this.net.nodes;
    const from = car.fwd ? n[e.a] : n[e.b], to = car.fwd ? n[e.b] : n[e.a];
    const dx = car.fwd ? e.dx : -e.dx, dz = car.fwd ? e.dz : -e.dz;
    // sulle vie con le corsie in OSM la corsia più a destra (non quella dei bus), altrimenti un quarto della carreggiata
    const off = (e.osmLanes && driveOffset(e, car.fwd)) ?? (e.oneway && e.width < 8 ? 0 : e.width / 4);
    const rx = -dz * off, rz = dx * off;
    const s0 = from.radius * 0.8, s1 = e.len - to.radius * 0.8;
    return { from, to, dx, dz, rx, rz, s0, s1, sx: from.x + rx, sz: from.z + rz };
  }

  // tratto carrabile a caso vicino al bus (ricerca spaziale: la città è molto grande)
  randomEdgeNear(x, z, minD, maxD) {
    const a = this.rnd() * Math.PI * 2, d = minD + this.rnd() * (maxD - minD);
    const arr = this.city.segGrid.query(x + Math.cos(a) * d, z + Math.sin(a) * d, 80, this._re || (this._re = []));
    const cand = arr.filter((it) => it.kind === 'road' && it.ref && !it.ref.ped && !it.ref.psv && (!it.ref.service || this.rnd() < 0.15));
    return cand.length ? cand[Math.floor(this.rnd() * cand.length)].ref : null;
  }
  // vicolo cieco per le auto: percorrendo l'arco nel verso fwd si raggiungono meno di 12 archi (senza tornare indietro
  // sullo stesso). Le auto non ci nascono e ci entrano solo se non c'è altro: in Piazza Garibaldi uno spezzone di 5 m
  // sopra i binari, che porta solo alla corsia dei bus, e in Via Morgagni due spezzoni che portano solo l'uno nell'altro
  // tenevano un'auto a fare inversioni sulla sede
  deadEnd(e, fwd) {
    const memo = this._dead || (this._dead = new Map()), key = fwd ? e.id : -1 - e.id;
    if (memo.has(key)) return memo.get(key);
    const seen = new Set([key]), queue = [[e, fwd]];
    while (queue.length && seen.size < 12) {
      const [a, f] = queue.shift(), n = this.net.nodes[f ? a.b : a.a];
      for (const x of n.edges) {
        const xf = x.a === n.id, k = xf ? x.id : -1 - x.id;
        if (x !== a && this.allowed(x, xf) && !seen.has(k)) { seen.add(k); queue.push([x, xf]); }
      }
    }
    memo.set(key, seen.size < 12);
    return seen.size < 12;
  }
  // le auto non entrano nelle vie pedonali né nelle corsie riservate ai bus
  allowed(e, fwd) { return !e.ped && !e.psv && (!e.oneway || (e.oneway === 1) === fwd); }

  spawn(bus, minD = 120, maxD = 1400, cars = this.cars) {
    for (let tries = 0; tries < 12; tries++) {
      const e = this.randomEdgeNear(bus.x, bus.z, minD, maxD);
      if (!e) continue;
      let fwd = e.oneway ? e.oneway === 1 : this.rnd() < 0.5;
      if (this.deadEnd(e, fwd)) { if (e.oneway || this.deadEnd(e, !fwd)) continue; fwd = !fwd; }
      const car = { car: true, edge: e, fwd, s: 0, v: 0, turn: null, id: Math.random() };
      const g = this.laneGeom(car);
      if (g.s1 - g.s0 < 3) continue;
      car.s = g.s0 + this.rnd() * (g.s1 - g.s0);
      car.y = e.elev ? edgeHeight(e, car.fwd ? car.s : e.len - car.s) : 0; // quota iniziale (sul cavalcavia o sotto)
      const x = g.sx + g.dx * car.s, z = g.sz + g.dz * car.s;
      const d = Math.hypot(x - bus.x, z - bus.z);
      if (d < minD || d > maxD) continue;
      if (cars.some((c) => Math.hypot(c.x - x, c.z - z) < 12)) continue;
      if (this.bigs.some((b) => Math.hypot(b.x - x, b.z - z) < 16)) continue; // non sopra un bus automatico
      car.x = x; car.z = z; car.h = Math.atan2(g.dx, g.dz);
      const zone = zoneOf(x, z);
      car.vmax = (zone === 0 || !e.main ? 9 : 14) * (0.9 + this.rnd() * 0.2);
      car.v = car.vmax * 0.7;
      car.color = new THREE.Color(CAR_COLORS[Math.floor(this.rnd() * CAR_COLORS.length)]);
      car.blocked = 0; car.pass = 0; car.passT = 0; car.honkCd = 0; car.latOff = 0; car.route = [];
      cars.push(car);
      return car;
    }
    return null;
  }

  // l'arco dopo edge (percorso nel verso fwd)
  chooseNext(edge, fwd) {
    const to = fwd ? this.net.nodes[edge.b] : this.net.nodes[edge.a];
    let opts = to.edges.filter((e) => e !== edge && this.allowed(e, e.a === to.id));
    const open = opts.filter((e) => !this.deadEnd(e, e.a === to.id));
    if (open.length) opts = open;
    if (!opts.length) opts = to.edges.filter((e) => !e.ped && !e.psv);
    if (!opts.length) opts = [edge];
    // le vie principali attirano più traffico delle traverse; quasi nessuno entra nelle strade di servizio
    const w = opts.map((e) => (e.main ? 4 : e.service ? 0.08 : e.cls === 6 ? 0.3 : 1));
    let r = this.rnd() * w.reduce((a, b) => a + b, 0), k = 0;
    while (k < opts.length - 1 && (r -= w[k]) > 0) k++;
    const e = opts[k];
    return { edge: e, fwd: e.a === to.id, node: to };
  }

  // il percorso si sceglie in anticipo (calledAhead e covers guardano oltre il prossimo arco): car.route[i] è l'arco
  // i + 1 dopo quello su cui si è (in svolta: dopo quello su cui si entra)
  routeAt(car, i) {
    const r = car.route;
    while (r.length <= i) { const p = r.length ? r[r.length - 1] : car.turn ? car.turn.next : car; r.push(this.chooseNext(p.edge, p.fwd)); }
    return r[i];
  }

  startTurn(car, g) {
    const nx = car.route.shift() || this.chooseNext(car.edge, car.fwd);
    car.turn = { ...this.turnPath(car, g, nx), t: 0, next: nx };
  }
  // curva da fine corsia (g, sull'arco from) all'inizio della corsia del prossimo arco (nx): quadratica p0-p1-p2
  turnPath(car, g, nx, from = car.edge) {
    const g2 = this.laneGeom({ edge: nx.edge, fwd: nx.fwd, s: 0 });
    const p0 = { x: g.sx + g.dx * g.s1, z: g.sz + g.dz * g.s1 };
    const p2 = { x: g2.sx + g2.dx * g2.s0, z: g2.sz + g2.dz * g2.s0 };
    // intersezione delle due rette di corsia
    const den = g.dx * g2.dz - g.dz * g2.dx;
    let p1;
    if (Math.abs(den) > 0.15) {
      const t = ((p2.x - p0.x) * g2.dz - (p2.z - p0.z) * g2.dx) / den;
      p1 = { x: p0.x + g.dx * t, z: p0.z + g.dz * t };
      if (t < 0 || t > 40) p1 = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
    } else {
      // inversione a U o rettilineo
      p1 = nx.edge === from ? { x: nx.node.x + g.dx * 6, z: nx.node.z + g.dz * 6 } : { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
    }
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) + Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const cosA = g.dx * g2.dx + g.dz * g2.dz;
    return { p0, p1, p2, len: Math.max(2, len * 0.92), s0: g2.s0, vmax: cosA > 0.8 ? car.vmax : 5.5, g2 };
  }
  // incroci col tram a meno di 30 m dall'arco: quelli che la sua corsia e le curve ai suoi nodi possono tagliare
  tramXs(e, ts) {
    if (e.tramXs) return e.tramXs;
    const A = this.net.nodes[e.a];
    return (e.tramXs = ts.list.filter((x) => {
      const t = Math.max(0, Math.min(e.len, (x.px - A.x) * e.dx + (x.pz - A.z) * e.dz));
      return Math.hypot(x.px - A.x - e.dx * t, x.pz - A.z - e.dz * t) < 30;
    }));
  }
  // il percorso dell'auto da d0 a d1 m davanti al centro, lungo gli archi e non in linea retta: il resto della corsia (o
  // della curva in cui si trova), poi curva e corsia di ogni arco scelto in anticipo (routeAt). fn(d, x, z, dx, dz, xs)
  // per un punto ogni 1,5 m dei tratti con incroci col tram vicini (xs); true per fermarsi, e lo restituisce. Nella
  // rotonda Rosetta Gagliardi i pezzi sono corti e curvi: 20 m in linea retta dopo la prossima svolta finivano fuori
  // dalla rotonda e non vedevano i binari di Viale della Pace, due archi più avanti
  along(car, d0, d1, ts, fn) {
    const q = this._q || (this._q = {});
    let d = 0, prev, g;
    // un tratto lungo L che inizia a d m dal centro; pt(u) mette in q punto e direzione a u m dal suo inizio
    const piece = (L, xs, pt) => {
      const a = Math.max(0, d0 - d), b = Math.min(L, d1 - d);
      if (xs.length && b >= a) for (let u = a; ; u = Math.min(b, u + 1.5)) {
        pt(u);
        if (fn(d + u, q.x, q.z, q.dx, q.dz, xs)) return true;
        if (u >= b) break;
      }
      d += L;
      return false;
    };
    const curve = (T, t0) => (u) => {
      const t = t0 + u / T.len, w = 1 - t, { p0, p1, p2 } = T;
      q.x = w * w * p0.x + 2 * w * t * p1.x + t * t * p2.x; q.z = w * w * p0.z + 2 * w * t * p1.z + t * t * p2.z;
      q.dx = w * (p1.x - p0.x) + t * (p2.x - p1.x); q.dz = w * (p1.z - p0.z) + t * (p2.z - p1.z);
    };
    const lane = (g, x0, z0) => (u) => { q.x = x0 + g.dx * u; q.z = z0 + g.dz * u; q.dx = g.dx; q.dz = g.dz; };
    const both = (a, b) => (!a.length ? b : !b.length ? a : [...new Set([...a, ...b])]);
    if (car.turn) {
      const T = car.turn;
      if (piece((1 - T.t) * T.len, T.xs || (T.xs = both(this.tramXs(car.edge, ts), this.tramXs(T.next.edge, ts))), curve(T, T.t))) return true;
      prev = T.next; g = T.g2;
      if (piece(Math.max(0, g.s1 - g.s0), this.tramXs(prev.edge, ts), lane(g, g.sx + g.dx * g.s0, g.sz + g.dz * g.s0))) return true;
    } else {
      prev = car; g = this.laneGeom(car);
      if (piece(Math.max(0, g.s1 - car.s), this.tramXs(car.edge, ts), lane(g, car.x, car.z))) return true;
    }
    for (let i = 0; d < d1; i++) {
      const nx = this.routeAt(car, i), T = nx.path || (nx.path = this.turnPath(car, g, nx, prev.edge));
      if (piece(T.len, nx.xs || (nx.xs = both(this.tramXs(prev.edge, ts), this.tramXs(nx.edge, ts))), curve(T, 0))) return true;
      prev = nx; g = T.g2;
      if (d < d1 && piece(Math.max(0, g.s1 - g.s0), this.tramXs(nx.edge, ts), lane(g, g.sx + g.dx * g.s0, g.sz + g.dz * g.s0))) return true;
    }
    return false;
  }
  // metri dal muso al primo punto del percorso (AHEAD m lungo gli archi, anche in svolta) che taglia i binari di un
  // incrocio chiamato da un tram, o all'inizio dei primi binari se appena dopo c'è chi è fermo e l'auto non ci starebbe
  // (dove i binari sono subito dopo una svolta la regola di carGap, che guarda l'arco su cui l'auto si trova, non vale:
  // si entrava svoltando e ci si fermava sui binari in coda); Infinity se non serve fermarsi
  calledAhead(car, ts) {
    let enter = -1, exit = null, hit = Infinity;
    this.along(car, 2.1, 2.1 + AHEAD, ts, (d, px, pz, dx, dz, xs) => {
      let on = false;
      for (const x of xs) if (ts.cuts(x, px, pz, dx, dz)) { if (x.call) { hit = d - 2.1; return true; } on = true; }
      if (on) { if (enter < 0 || exit.open) exit = { px, pz, dx, dz, open: true }; if (enter < 0) enter = d - 2.1; }
      else if (exit) exit.open = false;
      return false;
    });
    if (enter < 0 || enter >= hit) return hit;
    // binari chiamati poco dopo altri binari: ci si ferma prima dei primi, come in carGap (si restava fermi tra i due)
    if (hit < Infinity) return enter > 0 && hit - enter < 14 ? enter : hit;
    if (enter === 0) return Infinity;
    // oltre i primi binari: qualcuno fermo o quasi entro 7 m, sulla stessa corsia e nello stesso verso? (chi viene
    // incontro non è coda: in Via Gozzi, svoltando stretto verso Via Tommaseo, ci si fermava a metà curva per le auto
    // in coda dall'altra parte, che aspettavano proprio chi si era fermato)
    const l = Math.hypot(exit.dx, exit.dz) || 1, ux = exit.dx / l, uz = exit.dz / l;
    const full = (o, v, h) => {
      if (o === car || v > 1.5 || Math.sin(h) * ux + Math.cos(h) * uz < 0.5) return false;
      const rx = o.x - exit.px, rz = o.z - exit.pz, f = rx * ux + rz * uz;
      return f > -1 && f < 7 && Math.abs(rx * uz - rz * ux) < 1.8;
    };
    for (const o of this.near(exit.px + ux * 3, exit.pz + uz * 3, 8)) if (full(o, o.v, o.h)) return enter;
    for (const B of this.bigs) if (B.circles && Math.abs(B.x - exit.px) < 30 && Math.abs(B.z - exit.pz) < 30 && B.circles.some((p) => full(p, B.v, B.h))) return enter;
    return hit;
  }

  // la strada OSM e il tracciato GTFS del tram non sempre combaciano: un'auto che invaderebbe la sede si sposta di lato
  // (lx, lz: verso sinistra) quanto basta per lasciare libero il binario, al massimo 3 m
  tramShift(c, x, z, lx, lz) {
    const e = c.edge, q = this._qt || (this._qt = []);
    if (e.nearTram === undefined) {
      e.nearTram = false;
      const A = this.net.nodes[e.a];
      for (let s = 0; s <= e.len + 8 && !e.nearTram; s += 8)
        e.nearTram = this.city.segGrid.query(A.x + e.dx * Math.min(s, e.len), A.z + e.dz * Math.min(s, e.len), e.width / 2 + TRAM_HW + 3, q).some((it) => it.kind === 'tram');
    }
    if (!e.nearTram) return 0;
    let best = null;
    for (const it of this.city.segGrid.query(x, z, TRAM_HW + 3, q)) {
      if (it.kind !== 'tram') continue;
      // solo dove la strada corre accanto alla sede: chi la attraversa di traverso passa sui binari
      const sx = it.bx - it.ax, sz = it.bz - it.az;
      if (Math.abs(lx * sx + lz * sz) > 0.5 * (Math.hypot(sx, sz) || 1)) continue;
      const r = distToSeg(x, z, it.ax, it.az, it.bx, it.bz);
      if (!best || r.d < best.d) best = { d: r.d, t: r.t, it };
    }
    const need = best ? best.it.hw + 1.0 - best.d : 0;
    if (need <= 0) return 0;
    const { it, t } = best, qx = it.ax + (it.bx - it.ax) * t, qz = it.az + (it.bz - it.az) * t;
    return ((x - qx) * lx + (z - qz) * lz >= 0 ? 1 : -1) * Math.min(3, need);
  }

  update(dt, bus, ctx) {
    this.bigs = ctx.bigs || [];
    const playerBig = { player: true, v: bus.v, atStop: ctx.busAtStop };
    // popolazione dinamica attorno al bus
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (Math.hypot(c.x - bus.x, c.z - bus.z) > 1700 || c.overlapT > 2.5) this.cars.splice(i, 1);
    }
    let guard = 0;
    while (this.cars.length < this.target && guard++ < 6) this.spawn(bus, this.cars.length < this.target * 0.5 ? 60 : 250, 1500);

    // griglia per ricerca vicini
    this.grid = new Grid(30);
    for (const c of this.cars) this.grid.insertAABB(c, c.x - 3, c.z - 3, c.x + 3, c.z + 3);
    const near = [];
    // ingombro del mezzo del giocatore: il bus (anche snodato) lo calcola da sé, per il tram bastano cinque cerchi
    const busCircles = bus.worldCircles ? bus.worldCircles() : [-4.9, -2.45, 0, 2.45, 4.9].map((lz) => ({ x: bus.x + Math.sin(bus.h) * lz, z: bus.z + Math.cos(bus.h) * lz }));
    this.honks.length = 0;

    for (const c of this.cars) {
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      c.far = Math.hypot(c.x - bus.x, c.z - bus.z) > 60; // il tram fermo dietro un'auto incastrata la fa sparire solo lontano
      let gap = 80, leadV = Infinity; // leadV: velocità di chi c'è davanti (nessuno: Infinity)
      let v0 = c.turn ? c.turn.vmax : c.vmax;
      // auto davanti
      let lead = null, through = false;
      this.grid.query(c.x + fx * 15, c.z + fz * 15, 18, near);
      for (const o of near) {
        if (o === c) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (fwd > 0.5 && fwd < gap + 4.5 && lat < 1.7) {
          // evita stalli reciproci: ignora chi viene verso di noi
          const cosH = Math.cos(o.h - c.h);
          if (cosH < -0.3) continue;
          // e tra due auto che svoltano verso lo stesso arco passa chi ha meno curva da fare (a Lion, entrando in Via
          // Mascagni da Via Sant'Andrea e dalla traversa, ognuna aveva l'altra davanti e restavano ferme per sempre)
          if (c.turn && o.turn && o.turn.next.edge === c.turn.next.edge && (1 - c.turn.t) * c.turn.len < (1 - o.turn.t) * o.turn.len) continue;
          // chi esce da un giro di attese (sotto) passa davanti all'auto che aspettava, finché non l'ha superata
          if (o === c.through) { through = true; continue; }
          if (fwd - 4.4 < gap) { gap = fwd - 4.4; leadV = o.v; lead = o; }
        }
      }
      if (!through) c.through = null;
      const carGap = gap;
      // il bus del giocatore e i bus automatici
      let blocker = null;
      if (c.passT <= 0) {
        const hit = (p, who) => {
          const dx = p.x - c.x, dz = p.z - c.z;
          const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
          if (fwd > 0 && fwd < 40 && lat < 2.6) {
            const g = fwd - 3.6;
            if (g < gap) { gap = g; blocker = who; leadV = Math.abs(who.v); }
          }
        };
        for (const p of busCircles) hit(p, playerBig);
        for (const B of this.bigs) {
          if (!B.circles || Math.abs(B.x - c.x) > 50 || Math.abs(B.z - c.z) > 50) continue;
          for (const p of B.circles) hit(p, B);
        }
      }
      // i tram: chi passa davanti si aspetta, anche col muso già oltre l'incrocio o di sbieco contro; di chi viene
      // incontro sul binario accanto conta solo quello proprio davanti. Il tram fermo alla barra orizzontale non si
      // aspetta (si passa davanti al suo muso): conta solo se l'auto gli finirebbe addosso
      if (ctx.trams) for (const p of ctx.trams.near(c.x + fx * 15, c.z + fz * 15, 20)) {
        const dx = p.x - c.x, dz = p.z - c.z, fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        const lim = p.tram && p.tram.v < 0.3 ? 1.4 : Math.cos(p.h - c.h) > -0.3 ? 2.6 : 1.6;
        if (fwd > 0 && fwd < 40 && lat < lim && fwd - 4.4 < gap) { gap = fwd - 4.4; leadV = 0; }
      }
      // semaforo a fine arco
      const g = this.laneGeom(c);
      // incrocio con la sede del tram chiamato da un tram, o con la coda oltre: ci si ferma prima. Chi nell'incrocio
      // in fondo all'arco taglierebbe i binari di un incrocio chiamato si ferma alla linea (o a fine arco), anche col
      // verde: col verde lungo il binario (fase tram) chi svoltava, o andava dritto dove il binario curva (Via Belludi),
      // passava davanti al tram. Anche in svolta: nella rotonda i pezzi sono corti e un'auto passa quasi tutto il tempo
      // nelle curve, e da una curva entrava nell'altra fino ai binari
      if (ctx.tramSignals) {
        if (!c.turn) gap = Math.min(gap, ctx.tramSignals.carGap(c, g, gap, leadV));
        // (3 m prima dei binari; chi c'è già sopra va avanti e li libera)
        const d = this.calledAhead(c, ctx.tramSignals);
        if (d > 0.5 && d < Infinity) gap = Math.min(gap, Math.max(0, d - 3));
      }
      if (!c.turn) {
        const to = g.to;
        const sl = this.lights.stopOn(c.edge, to);
        if (sl) {
          // muso (2,1 m davanti al centro dell'auto) alla linea d'arresto, anche prima dell'arco che entra nell'incrocio
          const ap = sl.ap, st = this.lights.stateOf(ap.node.signal, ap.phase);
          const dist = c.edge.len - sl.t - c.s - 2.3;
          if (dist > -0.3 && (st === 'R' || (st === 'Y' && dist > c.v * 1.2))) gap = Math.min(gap, dist + 1.2); // IDM: ci si ferma 2 m prima
        }
      }
      // IDM
      const aMax = 1.6, bComf = 2.5;
      const sStar = 2 + c.v * 1.3 + (c.v * c.v) / (2 * Math.sqrt(aMax * bComf));
      let acc = aMax * (1 - Math.pow(c.v / Math.max(0.1, v0), 4) - Math.pow(sStar / Math.max(0.3, gap), 2));
      if (c.bump > 0) { acc = -8; c.overlapT = (c.overlapT || 0) + dt; c.bump = 0; }
      else c.overlapT = Math.max(0, (c.overlapT || 0) - dt * 0.5);
      acc = Math.max(-9, acc);
      c.v = Math.max(0, c.v + acc * dt);
      if (gap < 0.2) c.v = 0;
      // chi si aspetta: l'auto davanti, se basta da sola a tenerla ferma (a meno di 2 m l'IDM non riparte), e se a
      // fermarla non c'è anche altro (un semaforo, un bus, un tram, i binari)
      c.lead = carGap < 2 ? lead : null;
      c.alone = gap === carGap;
      c.halt = c.v < 0.1 ? (c.halt || 0) + dt : 0;

      // bloccati da un bus fermo: clacson (solo col giocatore) e sorpasso; un bus automatico si sorpassa in fermata
      // o se resta fermo a lungo (al semaforo rosso si aspetta)
      if (blocker && c.v < 0.3 && Math.abs(blocker.v) < 0.5) {
        c.blocked += dt;
        c.honkCd -= dt;
        if (blocker.player && c.blocked > 6 && c.honkCd <= 0 && !ctx.busAtStop) { this.honks.push(c); c.honkCd = 5 + this.rnd() * 5; }
        if (c.blocked > (blocker.atStop ? 1.5 : blocker.player ? 5 : 12)) { c.passT = 9; c.blocked = 0; }
      } else c.blocked = Math.max(0, c.blocked - dt);
      if (c.passT > 0) c.passT -= dt;
      const latTarget = c.passT > 1.5 ? 1 : 0;
      c.latOff += (latTarget * 3.2 - c.latOff) * Math.min(1, dt * 1.2);

      // avanzamento
      let move = c.v * dt;
      if (!c.turn) {
        c.s += move;
        if (c.s >= g.s1) {
          this.startTurn(c, g);
          c.turn.t = Math.min(1, (c.s - g.s1) / c.turn.len);
        }
      } else {
        c.turn.t += move / c.turn.len;
        if (c.turn.t >= 1) {
          c.edge = c.turn.next.edge;
          c.fwd = c.turn.next.fwd;
          c.s = c.turn.s0 + (c.turn.t - 1) * c.turn.len;
          c.turn = null;
          const zone = zoneOf(c.x, c.z);
          c.vmax = (zone === 0 || !c.edge.main ? 9 : 14) * (0.9 + this.rnd() * 0.2);
        }
      }
      // posizione
      let x, z, h;
      if (!c.turn) {
        const g2 = this.laneGeom(c);
        x = g2.sx + g2.dx * c.s;
        z = g2.sz + g2.dz * c.s;
        h = Math.atan2(g2.dx, g2.dz);
        // spostamento laterale per sorpasso (verso sinistra)
        x += g2.dz * c.latOff;
        z += -g2.dx * c.latOff;
        // fuori dalla sede del tram
        const ts = this.tramShift(c, x, z, g2.dz, -g2.dx);
        c.tramOff = (c.tramOff || 0) + (ts - (c.tramOff || 0)) * Math.min(1, dt * 3);
        x += g2.dz * c.tramOff;
        z += -g2.dx * c.tramOff;
      } else {
        const { p0, p1, p2, t } = c.turn;
        const u = 1 - t;
        x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
        z = u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z;
        const tx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x), tz = 2 * u * (p1.z - p0.z) + 2 * t * (p2.z - p1.z);
        h = Math.atan2(tx, tz);
      }
      c.x = x; c.z = z;
      let dh = h - c.h;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      c.h += dh * Math.min(1, dt * 10);
    }
    this.untangle();

    // istanze
    const { M, Q, Y, S, P } = this;
    this.cars.forEach((c, i) => {
      Q.setFromAxisAngle(Y, c.h);
      c.y = this.city.heightAt(c.x, c.z, c.y);
      M.compose(P.set(c.x, Y_ROAD + c.y, c.z), Q, S);
      this.mesh.setMatrixAt(i, M);
      this.mesh.setColorAt(i, c.color);
      this.lightMesh.setMatrixAt(i, M);
    });
    this.mesh.count = this.lightMesh.count = this.cars.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lightMesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // aggiorna griglia finale per collisioni con il bus (anche i pezzi dei bus automatici)
    this.grid = new Grid(30);
    for (const c of this.cars) this.grid.insertAABB(c, c.x - 3, c.z - 3, c.x + 3, c.z + 3);
    for (const B of this.bigs) for (const p of B.parts || []) this.grid.insertAABB(p, p.x - 3, p.z - 3, p.x + 3, p.z + 3);
  }

  // giri di attese tra auto: A aspetta B che aspetta ... A, ferme da almeno un secondo. Nessuna ripartirebbe più: a
  // Porta Trento chi da Via Bezzecca svolta in Via Belfiore e chi dalla rotonda esce in Via Bezzecca hanno le curve che
  // si toccano a 2 m, e ognuna ha l'altra davanti. Passa chi ha l'auto che aspetta più di lato, cioè meno in mezzo alla
  // sua strada, tra quelle che non sono ferme anche per altro: nella rotonda del SIR3 vicino a Via Falloppio tre auto si
  // aspettavano in giro, e una era ferma anche prima dei binari perché oltre c'era un'altra delle tre
  untangle() {
    for (const c of this.cars) {
      if (!c.lead || c.halt < 1) continue;
      const ring = [c];
      for (let o = c.lead; o !== c; o = o.lead) {
        if (!o || o.halt < 1 || ring.length > 8 || ring.includes(o)) { ring.length = 0; break; }
        ring.push(o);
      }
      let best = null, side = -1;
      for (const o of ring) {
        const s = Math.abs((o.lead.x - o.x) * Math.cos(o.h) - (o.lead.z - o.z) * Math.sin(o.h));
        if (o.alone && s > side) { side = s; best = o; }
      }
      if (best) { best.through = best.lead; best.lead = null; }
    }
  }

  near(x, z, r) {
    return this.grid.query(x, z, r, this._n || (this._n = []));
  }
}

function colorize(g, c) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const cc = new THREE.Color(c);
  for (let i = 0; i < n; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// ------------------------------------------------------------------
// Pedoni (decorativi sui marciapiedi + persone alle fermate)
// ------------------------------------------------------------------
export function personGeometry() {
  return mergeGeometries([
    colorize(new THREE.CylinderGeometry(0.1, 0.12, 0.85, 6).translate(-0.1, 0.42, 0), 0x2a2f3a),
    colorize(new THREE.CylinderGeometry(0.1, 0.12, 0.85, 6).translate(0.1, 0.42, 0), 0x2a2f3a),
    colorize(new THREE.CylinderGeometry(0.2, 0.17, 0.7, 8).translate(0, 1.2, 0), 0xffffff),
    colorize(new THREE.SphereGeometry(0.12, 10, 8).translate(0, 1.68, 0), 0xe0b090),
  ]);
}

export class Walkers {
  constructor(scene, net, count, city) {
    this.city = city;
    this.net = net;
    this.rnd = mulberry32(77);
    this.target = count;
    this.list = [];
    this.mesh = new THREE.InstancedMesh(personGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 400);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.M = new THREE.Matrix4();
    this.Q = new THREE.Quaternion();
    this.Y = new THREE.Vector3(0, 1, 0);
    this.S = new THREE.Vector3(1, 1, 1);
    this.P = new THREE.Vector3();
  }
  // punto di marciapiede: lontano dalle carreggiate (le vie pedonali vanno bene) e dalla sede del tram
  onWalk(x, z) {
    for (const it of this.city.segGrid.query(x, z, 12, this._qw || (this._qw = []))) {
      if (it.kind !== 'tram' && (it.kind !== 'road' || (it.ref && it.ref.ped))) continue;
      if (distToSeg(x, z, it.ax, it.az, it.bx, it.bz).d < it.hw + 0.4) return false;
    }
    return true;
  }
  spawn(bus) {
    if (!this.city) return;
    for (let k = 0; k < 10; k++) {
      const a0 = this.rnd() * Math.PI * 2, d0 = 40 + this.rnd() * 520;
      // niente pedoni accanto a cavalcavia e gallerie: a terra finirebbero sulla strada sotto
      const arr = this.city.segGrid.query(bus.x + Math.cos(a0) * d0, bus.z + Math.sin(a0) * d0, 60, this._re || (this._re = [])).filter((it) => it.kind === 'road' && it.ref && !it.ref.elev && !it.ref.tunnel);
      if (!arr.length) continue;
      const e = arr[Math.floor(this.rnd() * arr.length)].ref;
      const A = this.net.nodes[e.a], B = this.net.nodes[e.b];
      const s = A.radius + this.rnd() * (e.len - A.radius - B.radius);
      const side = this.rnd() < 0.5 ? -1 : 1;
      const off = e.width / 2 + 1.2 + this.rnd() * 2.2;
      const at = (t) => [A.x + e.dx * t - e.dz * side * off, A.z + e.dz * t + e.dx * side * off];
      const [x, z] = at(s);
      const d = Math.hypot(x - bus.x, z - bus.z);
      if (d > 600 || d < 40 || !this.onWalk(x, z)) continue;
      const zone = zoneOf(x, z);
      if (zone === 2 && this.rnd() < 0.7) continue;
      // tratto di marciapiede libero attorno al punto: il pedone va avanti e indietro lì dentro
      let s0 = s, s1 = s;
      while (s0 - 1.5 > A.radius && s - s0 < 60 && this.onWalk(...at(s0 - 1.5))) s0 -= 1.5;
      while (s1 + 1.5 < e.len - B.radius && s1 - s < 60 && this.onWalk(...at(s1 + 1.5))) s1 += 1.5;
      if (s1 - s0 < 4) continue;
      const dir = this.rnd() < 0.5 ? 1 : -1;
      this.list.push({ e, s, s0, s1, side, off, dir, v: 1.1 + this.rnd() * 0.5, x, z, ph: this.rnd() * 6, col: new THREE.Color().setHSL(this.rnd(), 0.45, 0.25 + this.rnd() * 0.4), sc: 0.9 + this.rnd() * 0.2 });
      return;
    }
  }
  update(dt, bus) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (Math.hypot(p.x - bus.x, p.z - bus.z) > 700) { this.list.splice(i, 1); continue; }
      p.s += p.v * p.dir * dt;
      const A = this.net.nodes[p.e.a], B = this.net.nodes[p.e.b];
      if ((p.s < p.s0 && p.dir < 0) || (p.s > p.s1 && p.dir > 0)) p.dir *= -1;
      p.x = A.x + p.e.dx * p.s - p.e.dz * p.side * p.off;
      p.z = A.z + p.e.dz * p.s + p.e.dx * p.side * p.off;
      p.ph += dt * p.v * 5;
    }
    let g = 0;
    while (this.list.length < this.target && g++ < 5) this.spawn(bus);
    const { M, Q, Y, S, P } = this;
    this.list.forEach((p, i) => {
      Q.setFromAxisAngle(Y, Math.atan2(p.e.dx * p.dir, p.e.dz * p.dir));
      M.compose(P.set(p.x, 0.1 + (p.e.elev && this.city ? this.city.heightAt(p.x, p.z) : 0) + Math.abs(Math.sin(p.ph)) * 0.05, p.z), Q, S.set(p.sc, p.sc, p.sc));
      this.mesh.setMatrixAt(i, M);
      this.mesh.setColorAt(i, p.col);
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------
// Tram (Translohr): i convogli in servizio secondo l'orario, ognuno sulla sede della sua linea, con le fermate delle corse
// ------------------------------------------------------------------
// progressiva sul binario di partenza oltre la quale la coda di un tram lascia libero lo scambio del capolinea t: fuori
// dalla comunicazione ('dopo') o dal tronco ('avanti')
function terminalClear(t) { return (t.field === 'dep' ? t.heel : t.link) + 1; }
// rimessa dei tram automatici: velocità nel deposito (15 km/h) e anticipo dell'uscita sulla partenza della prima corsa del
// turno, come per il tram di chi guida (main.js, tramDepotExit); oltre DEPOT_LATE dalla partenza senza un binario libero in
// rimessa la corsa comincia lungo la linea
const YARD_V = 4, EXIT_LEAD = 300, DEPOT_LATE = 600;

// Viaggi dei tram dall'orario GTFS (giorno 'feriale' | 'festivo'), con i turni di turni.js: gli stessi di chi guida il
// tram, senza i tratti in cui il GTFS spezza ogni viaggio (nei feriali 12-13 tram in servizio per quasi tutto il
// giorno). Al capolinea ogni tram prende la corsa dopo del suo turno; aspettano al più due tram (uno alla banchina di
// partenza, uno che arriva o fa la manovra), gli altri rientrano. La sosta più breve, dai binari, la dà
// impostaSostaTram (main.js): 3 minuti dove c'è la manovra con lo scambio, 1 all'anello della stazione (l'orario del
// SIR3 arriva lì un minuto prima di una partenza, e la banchina di Stazione sud la usa anche il SIR2).
// trackOf(L): la sede della linea (TramTrack)
export function tramRuns(lines, trackOf, day) {
  const runs = [];
  for (const L of lines) {
    const track = trackOf(L);
    if (!track) continue;
    const ssOf = new Map(), mine = new Map();
    for (const r of turni(L, day).runs) {
      const v = r.v, dir = track.dirOf(v);
      if (!ssOf.has(v)) {
        // progressiva del muso fermo a fine banchina (12 m oltre la palina), sempre crescente lungo la corsa
        const P = track.path(dir), ss = [];
        for (const st of v.stops) ss.push(Math.max(ss.length ? ss[ss.length - 1] : -Infinity, P.project(st.x, st.z).s + 12));
        // partenza dal capolinea con lo scambio: il muso più avanti se serve perché la coda sia fuori dallo scambio (a
        // Voltabarozzo la banchina di partenza comincia subito dopo la comunicazione), così chi arriva può fare la manovra
        const t0 = track.terminals && track.terminals[dir > 0 ? -1 : 1];
        if (t0 && ss[0] < terminalClear(t0) + 200) ss[0] = Math.min(ss[1] - 1, Math.max(ss[0], terminalClear(t0) + 0.5 + tramLength(L.modules || 3)));
        ssOf.set(v, ss);
      }
      const times = v.offsets.map((o) => r.t + (o * r.d) / v.duration);
      mine.set(r, { line: L, track, v, t: r.t, d: r.d, dir, ss: ssOf.get(v), times, prev: null, next: null });
    }
    for (const [r, x] of mine) { x.prev = mine.get(r.prev) || null; x.next = mine.get(r.next) || null; runs.push(x); }
  }
  return runs.sort((a, b) => a.t - b.t);
}

export class TramSim {
  // tram automatici sulla sede: ognuno sulla corsia di destra del suo verso, fermate con il muso a fine banchina.
  // Con l'orario (setService) i tram sono quelli in servizio a quell'ora, ognuno sulla sua corsa; senza, opts.starts:
  // [[s del muso, verso], ...] del SIR1 che girano tra i capolinea. opts.modules: moduli del convoglio del SIR1
  // track: binari per verso del SIR1 (TramTrack della città); tracks: le sedi di tutte le linee per id. s di ogni tram è
  // lungo il binario del suo verso, sulla sede della sua linea (tr.track)
  constructor(scene, net, opts = {}) {
    this.trams = [];
    this.track = opts.track;
    if (!this.track) return;
    this.tracks = opts.tracks || { SIR1: this.track };
    this.modules = opts.modules || 3;
    this.L = tramLength(this.modules);
    this.stopsDir = { 1: this.track.stopsDir[1].map((p) => p.s), '-1': this.track.stopsDir[-1].map((p) => p.s) };
    this.catenaryAt = opts.catenaryAt || (() => true);
    this.scene = scene;
    // depositi (TramYard): la prima corsa di un turno da un capolinea col deposito esce dalla rimessa, l'ultima ci rientra.
    // locks: per deposito il tram automatico che ci si muove (uno alla volta: nei binari unici non se ne incontrano due)
    this.yards = opts.yards || [];
    this.locks = new Map();
    this.reset(opts.starts);
  }
  // ricrea i tram automatici senza orario: girano tra i capolinea
  reset(starts) {
    this.runs = null;
    while (this.trams.length) this.remove(this.trams[0]);
    starts = starts || [[this.track.path(1).len * 0.25, 1], [this.track.path(-1).len * 0.3, -1]];
    for (const [s0, dir] of starts) this.add(s0, dir, dir > 0 ? 'Pontevigodarzere' : 'Guizza');
  }
  // line: la linea (senza, il SIR1)
  add(s, dir, dest, line = null) {
    const id = line ? line.id : 'SIR1', modules = line ? line.modules || 3 : this.modules;
    const c = buildTramConvoy(this.scene, modules, id, dest);
    const tr = { id: (this.nextId = (this.nextId || 0) + 1), s, dir, v: 0, wait: 0, mods: c.mods, bellows: c.bellows, parts: [], served: null, panto: 1, run: null, k: 0, waveT: 0, line: id, track: this.tracks[id] || this.track, L: tramLength(modules) };
    // il guidatore al centro della cabina di testa (il pavimento del tram è più alto di quello del bus)
    tr.driver = driverFigure();
    tr.driver.group.position.set(0.12, 0.2, TRAM.cab / 2 - 1.75);
    c.mods[0].inner.add(tr.driver.group);
    this.trams.push(tr);
    return tr;
  }
  remove(tr) {
    // tolto mentre entrava in rimessa (salto d'orario): lo scambio del capolinea torna com'era per le manovre
    const m = tr.rimessa;
    if (m && m.entra && m.t && m.t.occ === tr) { m.t.occ = null; if (m.t.field === 'arr' && this.onSwitch) this.onSwitch(m.t, 'deviato'); }
    for (const m of tr.mods) this.scene.remove(m.group);
    for (const b of tr.bellows) this.scene.remove(b);
    this.trams.splice(this.trams.indexOf(tr), 1);
  }
  // servizio dall'orario: day 'feriale' | 'festivo'; mine: corsa guidata dal giocatore { v, t }, che non ha un gemello
  // automatico (e nemmeno la corsa intera che la contiene)
  setService(lines, day, mine = null) {
    while (this.trams.length) this.remove(this.trams[0]);
    this.lines = lines;
    this.runs = tramRuns(lines, (L) => this.tracks[L.id], day);
    // prime corse dei turni che partono da un capolinea col deposito: il tram esce dalla rimessa (spawnDepot)
    for (const r of this.runs) {
      const d = !r.prev && this.depotOf(r.track, r.dir, 'start');
      r.fromDepot = d && r.ss[0] - d.pt.s < 400 ? d : null;
    }
    if (mine) this.exclude(mine);
    this.locks.clear();
    this.lastClock = null;
  }
  // porta del deposito al capo del binario del verso dir ('start': da lì si esce sulla linea, 'end': da lì si entra)
  depotOf(T, dir, kind) {
    for (const Y of this.yards) {
      const pt = Y.ports.find((p) => p.T === T && p.dir === (dir > 0 ? 1 : -1) && p.kind === kind && !p.mid);
      if (pt) return { Y, pt };
    }
    return null;
  }
  // corsa del giocatore { v, t } (anche la successiva del suo turno, al capolinea): via dall'orario dei tram automatici,
  // e il tram che la stava facendo esce
  exclude(mine) {
    const ml = this.runs && this.lines.find((L) => L.variants.includes(mine.v)), mt = ml && this.tracks[ml.id];
    if (!mt) return;
    const st0 = mine.v.stops[0], dir = mt.dirOf(mine.v);
    const same = (r) => r.line === ml && r.dir === dir && r.v.stops.some((s, i) => Math.hypot(s.x - st0.x, s.z - st0.z) < 150 && Math.abs(r.times[i] - mine.t) <= 180);
    for (const r of this.runs) if (same(r) && r.tram && this.trams.includes(r.tram)) this.remove(r.tram);
    this.runs = this.runs.filter((r) => !same(r));
  }
  destOf(run) { return run.v.headsign.replace(/ \(.*$/, ''); }
  // posizione che l'orario dà alla corsa all'ora clock (tra due fermate, in proporzione al tempo)
  spawnAt(run, clock) {
    const { times, ss } = run;
    let k = 0;
    while (k < times.length - 2 && times[k + 1] <= clock) k++;
    const f = Math.max(0, Math.min(1, (clock - times[k]) / Math.max(1, times[k + 1] - times[k])));
    const tr = this.add(ss[k] + (ss[k + 1] - ss[k]) * f, run.dir, this.destOf(run), run.line);
    tr.run = run; tr.k = k + 1; tr.v = f > 0 ? 6 : 0;
    run.tram = tr;
    return tr;
  }
  // tram in servizio a quell'ora: dopo un salto d'orario (avvio, teletrasporto) si ricompone tutto dall'orario. Le prime
  // corse dei turni dai capolinea col deposito hanno il tram in rimessa da 5 minuti prima della partenza
  schedule(clock, others = []) {
    const jump = this.lastClock == null || clock < this.lastClock - 1 || clock - this.lastClock > 60;
    if (jump) {
      while (this.trams.length) this.remove(this.trams[0]);
      this.locks.clear();
      for (const r of this.runs) r.tram = null;
      for (const r of this.runs) if (r.t <= clock && clock < r.t + r.d) this.spawnAt(r, clock);
      for (const r of this.runs) if (r.fromDepot && r.t - EXIT_LEAD <= clock && clock < r.t) this.spawnDepot(r, others);
    } else {
      // senza un binario libero in rimessa (le corse doppie del GTFS) si riprova ogni 15 s e la corsa parte in ritardo;
      // dopo 10 minuti comincia lungo la linea, come le altre
      for (const r of this.runs) {
        if (!r.fromDepot || r.tram || clock < r.t - EXIT_LEAD || clock >= r.t + DEPOT_LATE || clock < (r.retry || 0)) continue;
        if (!this.spawnDepot(r, others)) r.retry = clock + 15;
      }
      // corse che partono ora senza un tram che le aspetti al capolinea: ne entra uno nuovo. Se il tram del turno è
      // ancora sulla corsa prima (in ritardo) la prende lui, appena arriva
      const late = (r) => r.prev && r.prev.tram && r.prev.tram.run === r.prev && this.trams.includes(r.prev.tram);
      for (const r of this.runs) {
        const t = r.fromDepot ? r.t + DEPOT_LATE : r.t;
        if (t > this.lastClock && t <= clock && !r.tram && !late(r)) this.spawnAt(r, clock);
      }
    }
    this.lastClock = clock;
  }
  // fine corsa: al capolinea il tram prende la corsa dopo del suo turno (se nessun altro tram l'ha presa nel frattempo e
  // non è quella di chi gioca), altrimenti rientra: in rimessa dove c'è il deposito, altrimenti esce
  endRun(tr, clock) {
    const next = tr.run.next && !tr.run.next.tram && this.runs.includes(tr.run.next) ? tr.run.next : null;
    if (!next) { if (!this.toDepot(tr)) this.remove(tr); return; }
    const T = tr.track, P = T.path(tr.dir), N = T.path(next.dir), head = P.at(tr.s), pr = N.projectNear(head.x, head.z, 1.5);
    const t = this.terminalOf(tr);
    if (t && next.dir === t.dep) {
      // capolinea con lo scambio: la discesa, poi la manovra come il tram di chi gioca, quando lo scambio è libero. I
      // turni ci fanno aspettare al più due tram (tramRuns); con i ritardi un terzo resta alla banchina d'arrivo finché
      // chi è nel tronco non è uscito dallo scambio, e la corsa dopo parte in ritardo
      tr.man = { t, next, fase: 'scarico' };
      tr.v = 0; tr.wait = 20;
      next.tram = tr;
      return;
    }
    if (pr && N.at(pr.s).dx * head.dx + N.at(pr.s).dz * head.dz > 0.7) {
      // capolinea ad anello (SIR3 in stazione): il binario della nuova corsa continua quello d'arrivo, niente cambio cabina
      tr.dir = next.dir; tr.s = pr.s;
    } else {
      // cambio cabina: il muso diventa l'altra estremità, sul binario della nuova corsa
      const tail = P.at(tr.s - tr.L);
      tr.dir = next.dir; tr.s = N.project(tail.x, tail.z).s;
    }
    tr.run = next; tr.k = 1; tr.v = 0; tr.wait = Math.max(30, next.t - clock);
    next.tram = tr;
    this.setDest(tr, this.destOf(next));
  }
  // punto del binario a s, spostato sullo scambio del capolinea dove il tram ci passa in manovra
  lanePoint(s, dir, track = this.track) {
    const p = track.path(dir).at(s), o = track.terminalOff && track.terminalOff(dir, s);
    return o ? { x: p.x + o.x, z: p.z + o.z, fx: p.dx, fz: p.dz } : { x: p.x, z: p.z, fx: p.dx, fz: p.dz };
  }
  // scambio del capolinea dove finisce la corsa del tram (TramTrack.terminal), se la corsa arriva fin lì
  terminalOf(tr) {
    const T = tr.track, t = T.terminals && T.terminals[tr.dir > 0 ? 1 : -1], ss = tr.run && tr.run.ss;
    return t && ss && t.fondo - ss[ss.length - 1] < 300 ? t : null;
  }
  // fin dove arriva col muso il tram che arriva al capolinea t mentre un altro fa la manovra: prima della comunicazione
  // (prima della fermata, se la comunicazione è subito dopo)
  termLimit(t) { return t.field === 'dep' ? t.link - (t.heel - t.toe) - 2 : t.toe - 2; }
  // lo scambio del capolinea t è occupato: un altro tram automatico in manovra, o quello di chi gioca oltre il limite
  // del binario d'arrivo o sul tronco di quello di partenza
  termBusy(t, tr, others) {
    if (t.occ && t.occ !== tr && this.trams.includes(t.occ)) return true;
    const T = tr.track, A = T.path(t.arr), B = T.path(t.dep), lim = this.termLimit(t);
    for (const o of others) {
      if (!o || !o.isTram || !o.trackPoints || o.track !== T) continue;
      for (const p of o.trackPoints()) {
        const a = A.projectNear(p.x, p.z, 2.5);
        if (a && a.s > lim) return true;
        const b = t.field === 'arr' && B.projectNear(p.x, p.z, 2.5);
        if (b && b.s < t.link + 2) return true;
      }
    }
    return false;
  }
  // cambio cabina in fondo al binario: ogni cassa resta dov'è, il muso diventa l'altra estremità, sul binario della corsa
  // nuova (con le distanze lungo i binari dello scambio, come Tram.transfer); poi si va alla prima fermata
  turnAt(tr) {
    const { t, next } = tr.man, tail = tr.s - tr.L;
    const s = t.field === 'arr' ? (tail >= t.heel ? t.other(tail) : -1) : (tail >= t.link ? t.toe - (tail - t.link) : -1);
    tr.man = null;
    if (s < 0) {
      const q = tr.track.path(tr.dir).at(tail);
      tr.s = tr.track.path(next.dir).project(q.x, q.z).s;
      if (t.occ === tr) t.occ = null;
    }
    else { tr.s = s; tr.esce = t; }
    tr.dir = next.dir; tr.run = next; tr.k = 0; tr.v = 0; tr.wait = 10;
    this.setDest(tr, this.destOf(next));
    if (t.field === 'dep' && this.onSwitch) this.onSwitch(t, 'deviato');
  }
  // Rimessa (TramYard). Il tram che esce o rientra (tr.rimessa: { Y, pt la porta, t lo scambio del capolinea, esce o
  // entra, via, ch gli scambi del deposito }) corre sul percorso del deposito (YardRun, come il tram di chi guida: track,
  // dir 1, s lungo il percorso). Si muove un tram alla volta per deposito, e tiene anche lo scambio del capolinea finché
  // la coda non ne è fuori; non si parte mentre il deposito lo usa il tram di chi gioca (yardBusy, main.js)

  // prima corsa del turno da un capolinea col deposito: il tram in fondo a un binario libero della rimessa
  // (TramYard.parking), col percorso fino alla banchina di partenza. null se non c'è posto
  spawnDepot(r, others) {
    const { Y, pt } = r.fromDepot, L = tramLength(r.line.modules || 3), P = r.track.path(r.dir);
    for (const pk of Y.parking(L + 2)) {
      // solo i binari col fondo dietro al tram: gli altri sono di passaggio
      if (pk.rank % 2 || !this.edgeFree(pk.e, null, others)) continue;
      const { n, i } = Y.endAt(pk.e, pk.fwd), ch = Y.plan(n, i, (E) => E.port === pt);
      const rt = ch && this.routeWith(Y, ch, n, i), last = rt && rt.pieces[rt.pieces.length - 1];
      if (!last || last.port !== pt) continue;
      const pieces = [{ e: pk.e, fwd: pk.fwd }, ...rt.pieces.filter((pc) => !pc.port), { main: r.track, dir: r.dir, s0: pt.s, s1: Math.min(P.len, r.ss[0] + 30), portAt: 0 }];
      const R = new YardRun(Y, pieces, []), port = R.bounds[pieces.length - 1];
      const tr = this.add(L + 1, 1, this.destOf(r), r.line);
      tr.track = R; tr.run = r; tr.k = 0;
      tr.rimessa = { Y, pt, t: r.track.terminals && r.track.terminals[r.dir > 0 ? -1 : 1], esce: true, e: pk.e, ch, port, stop: port + r.ss[0] - pt.s, free: port + 1 };
      r.tram = tr;
      return tr;
    }
    return null;
  }
  // ultima corsa del turno a un capolinea col deposito: dopo la discesa il tram va in rimessa
  toDepot(tr) {
    const d = this.depotOf(tr.track, tr.dir, 'end');
    if (!d || d.pt.s < tr.s || d.pt.s - tr.s > 400) return false;
    tr.rimessa = { ...d, t: tr.track.terminals && tr.track.terminals[tr.dir > 0 ? 1 : -1], entra: true };
    tr.v = 0; tr.wait = 20;
    this.setDest(tr, 'Fuori servizio', '');
    return true;
  }
  // percorso del deposito dal nodo n, arrivando dal capo i, con gli scambi messi come nel piano ch (senza girarli)
  routeWith(Y, ch, n, i) {
    const old = ch.map(([sw]) => sw.state);
    for (const [sw, k] of ch) sw.state = k;
    const r = Y.route(n, i);
    ch.forEach(([sw], j) => { sw.state = old[j]; });
    return r;
  }
  // nessun tram (tranne tr) sul ramo e del deposito, né preso da uno che ci sta andando
  edgeFree(e, tr, others) {
    const on = (p) => e.path.projectNear(p.x, p.z, 2.5);
    for (const t2 of this.trams) if (t2 !== tr && ((t2.rimessa && t2.rimessa.e === e) || t2.parts.some(on))) return false;
    for (const o of others) if (o && o.isTram && o.trackPoints && o.trackPoints().some(on)) return false;
    return true;
  }
  // si può partire: il deposito libero, lo scambio del capolinea libero e, uscendo, nessun tram sul binario di partenza
  // dalla porta alla banchina
  depotFree(tr, others) {
    const m = tr.rimessa, lock = this.locks.get(m.Y);
    if ((lock && lock !== tr && this.trams.includes(lock)) || (this.yardBusy && this.yardBusy(m.Y))) return false;
    if (m.t && this.termBusy(m.t, tr, others)) return false;
    if (m.entra) return true;
    const r = tr.run, P = r.track.path(r.dir), lo = m.pt.s - 3, hi = r.ss[0] + 3;
    for (const t2 of this.trams) if (t2 !== tr && t2.track === r.track && t2.dir === r.dir && t2.s > lo && t2.s - t2.L < hi) return false;
    for (const o of others) if (o && o.isTram && o.trackPoints) for (const p of o.trackPoints()) { const q = P.projectNear(p.x, p.z, 2.5); if (q && q.s > lo && q.s < hi) return false; }
    return true;
  }
  // rientro: dal binario d'arrivo in fondo a un binario tronco libero della rimessa (prima quelli coperti). false se non ce
  // n'è uno
  depotIn(tr, others) {
    const m = tr.rimessa, { Y, pt } = m, need = tr.L + 2, tunnel = Y.edges.some((e) => e.tunnel), n = pt.node, i = Y.portEnd(pt);
    const ch = Y.plan(n, i, (E) => !!E.e && Y.deadEnd(E) && E.e.len >= need && (!tunnel || !!E.e.tunnel) && this.edgeFree(E.e, tr, others));
    if (!ch) return false;
    const rt = this.routeWith(Y, ch, n, i), last = rt.pieces[rt.pieces.length - 1], s0 = Math.max(0, tr.s - tr.L - 5);
    const R = new YardRun(Y, [{ main: tr.track, dir: tr.dir, s0, s1: pt.s, portAt: 1 }, ...rt.pieces.filter((pc) => !pc.port)], []);
    const f = tr.track.path(tr.dir).at(tr.s), pr = R.P.projectNear(f.x, f.z, 3);
    // lo scambio del capolinea si libera con la coda oltre la porta; dove la manovra non usa il binario d'arrivo oltre la
    // comunicazione ('avanti', la Guizza) già con la coda oltre la comunicazione
    m.ch = ch; m.e = last.e; m.free = (m.t && m.t.field === 'arr' ? Math.min(m.t.heel + 2, pt.s) : pt.s) - s0 + 1;
    tr.track = R; tr.dir = 1; tr.s = pr ? pr.s : tr.s - s0;
    return true;
  }
  // a ogni passo, la velocità del tram che esce o rientra: fermo finché non può partire, poi a 15 km/h fino alla banchina
  // di partenza (lì passa sul binario della linea) o in fondo al binario della rimessa (lì sparisce dopo qualche secondo)
  depotStep(tr, others, clock, dt, gone) {
    const m = tr.rimessa;
    if (!m.via) {
      if ((m.check = (m.check || 0) - dt) > 0) return 0;
      m.check = 0.5;
      if (!this.depotFree(tr, others)) return 0;
      if (m.entra && !this.depotIn(tr, others)) { gone.push(tr); return 0; }
      m.via = true;
      this.locks.set(m.Y, tr);
      for (const [sw, k] of m.ch) { sw.state = k; if (sw.sign) sw.sign.update(); }
      if (m.t) {
        m.t.occ = tr;
        // lo scambio del capolinea diritto per chi lo prende di punta: entrando dove sta sul binario d'arrivo, uscendo
        // dove sta su quello di partenza
        if (this.onSwitch && m.t.field === (m.entra ? 'arr' : 'dep')) this.onSwitch(m.t, 'diritto');
      }
    }
    const R = tr.track, tail = tr.s - tr.L;
    if (tail > m.free) {
      if (m.esce && this.locks.get(m.Y) === tr) this.locks.delete(m.Y);
      if (m.entra && m.t && m.t.occ === tr) { m.t.occ = null; if (m.t.field === 'arr' && this.onSwitch) this.onSwitch(m.t, 'deviato'); }
    }
    const d = (m.esce ? m.stop : R.P.len - 1.5) - tr.s;
    if (d > 0.8) return Math.min(YARD_V, Math.sqrt(2 * 0.9 * (d - 0.5)) + 0.3);
    if (tr.v < 0.2) {
      if (m.esce) this.toLine(tr, clock);
      else {
        if (this.locks.get(m.Y) === tr) this.locks.delete(m.Y);
        if ((m.parked = (m.parked || 0) + dt) > 8) gone.push(tr);
      }
    }
    return 0;
  }
  // uscendo, alla banchina di partenza: il tram passa sul binario della linea e parte all'ora. Lo scambio del capolinea si
  // libera quando la coda ne è fuori (tr.esce)
  toLine(tr, clock) {
    const m = tr.rimessa, r = tr.run, P = r.track.path(r.dir), f = tr.track.P.at(tr.s), pr = P.projectNear(f.x, f.z, 3);
    tr.rimessa = null;
    if (this.locks.get(m.Y) === tr) this.locks.delete(m.Y);
    tr.track = r.track; tr.dir = r.dir; tr.s = pr ? pr.s : r.ss[0];
    tr.k = 1; tr.v = 0; tr.wait = Math.max(5, r.t - clock);
    if (m.t && m.t.occ === tr) tr.esce = m.t;
  }
  // clock: ora del gioco (secondi), per il servizio dall'orario
  update(dt, others = [], clock = null) {
    if (!Array.isArray(others)) others = [others];
    if (!this.runs || clock == null) { this.move(dt, others, null); return; }
    // con l'attesa accelerata in fermata l'orologio corre (x12): i tram la seguono a passi normali
    const cd = this.lastClock == null ? dt : clock - this.lastClock;
    this.schedule(clock, others);
    const n = cd > dt * 1.5 && cd < 60 ? Math.min(15, Math.round(cd / dt)) : 1;
    for (let i = 0; i < n; i++) this.move(dt, others, clock - (n - 1 - i) * dt);
  }
  move(dt, others, clock) {
    const ended = [], turned = [], gone = [];
    for (const tr of this.trams) {
      // prossima fermata nel verso di marcia: il muso si ferma 12 m oltre la palina (fine banchina)
      let T = tr.track, P = T.path(tr.dir);
      let vt = 8.5;
      if (tr.wait > 0) { tr.wait -= dt; vt = 0; }
      else if (tr.rimessa) vt = this.depotStep(tr, others, clock, dt, gone);
      else if (tr.man) {
        // al capolinea: a scambio libero avanti fino in fondo al binario (a 15 km/h), poi il cambio cabina
        const m = tr.man;
        if (m.fase === 'scarico' && !this.termBusy(m.t, tr, others)) { m.fase = 'fondo'; m.t.occ = tr; }
        if (m.fase === 'fondo') {
          const d = Math.min(m.t.fondo - 1, P.len - 2.5) - tr.s;
          vt = Math.min(4, Math.sqrt(2 * 0.9 * Math.max(0, d)) + 0.3);
          if (d < 0.8) turned.push(tr);
        } else vt = 0;
      } else if (tr.run) {
        const d = tr.run.ss[tr.k] - tr.s;
        // in linea alla velocità che porta alla prossima fermata in orario (tra 11 e 30 km/h), arrivando 15 s prima
        // della partenza; in ritardo si va al massimo
        const left = tr.run.times[tr.k] - 15 - clock;
        if (left > 0) vt = Math.max(3, Math.min(8.5, d / left));
        vt = Math.min(vt, Math.sqrt(2 * 0.9 * Math.max(0, d)) + 0.3);
        // sullo scambio del capolinea a 15 km/h; arrivando, se un altro tram fa la manovra ci si ferma prima della
        // comunicazione
        if (tr.esce) vt = Math.min(vt, 4);
        const t = tr.k === tr.run.ss.length - 1 && this.terminalOf(tr), lim = t && this.termLimit(t);
        if (t && tr.s > lim - 150 && this.termBusy(t, tr, others)) vt = Math.min(vt, lim - tr.s > 0.8 ? Math.sqrt(2 * 0.9 * (lim - tr.s)) + 0.3 : 0);
        if (d < 0.8) {
          if (tr.k >= tr.run.ss.length - 1) ended.push(tr);
          // in anticipo sull'orario si aspetta la partenza (al massimo 2 minuti, alla prima fermata fino all'ora); in
          // fermata comunque almeno 15 s
          else { const early = tr.run.times[tr.k] - clock; tr.wait = Math.max(15, tr.k ? Math.min(120, early) : early); tr.k++; }
        }
      } else {
        const stopAt = (x) => x + 12;
        const next = this.stopsDir[tr.dir].find((x) => stopAt(x) > tr.s + 0.5 && x !== tr.served);
        if (next != null) {
          const d = stopAt(next) - tr.s;
          vt = Math.min(vt, Math.sqrt(2 * 0.9 * d) + 0.3);
          if (d < 0.8) { tr.wait = 18; tr.served = next; }
        }
      }
      // entrando in rimessa o uscendone il tram può essere passato su un altro percorso
      if (tr.track !== T) { T = tr.track; P = T.path(tr.dir); }
      // segnale del tram a via impedita: si rallenta per fermarsi alla linea
      if (this.signals) {
        const d = this.signals.stopAhead(tr.s, tr.dir, T);
        if (d < 60) vt = Math.min(vt, Math.sqrt(2 * 0.9 * Math.max(0, d - 0.5)));
      }
      // chi è sulla stessa corsia davanti, auto comprese: ci si ferma a distanza. Il mezzo del giocatore conta anche
      // appena a fianco del muso; un bus automatico solo se è tutto davanti al muso (quello accanto, anche solo in parte,
      // aspetta il tram che ha la precedenza: dove la corsia del bus sfiora il binario aspetterebbero tutti e due, per
      // sempre)
      const head = this.lanePoint(tr.s, tr.dir, T);
      const ahead = (o) => (o.x - head.x) * head.fx + (o.z - head.z) * head.fz;
      const obst = [], beside = new Set();
      for (const o of others) if (o && o.isBus && ahead(o) < 1.5) beside.add(o.bus);
      tr.ignoreBusT = Math.max(0, (tr.ignoreBusT || 0) - dt);
      for (const o of others) {
        // lontano dal giocatore i bus non guardano chi hanno davanti (nessuno li vede): nemmeno il tram guarda loro,
        // altrimenti aspetta dietro i bus alle fermate sul binario mentre gli altri bus gli passano attraverso
        if (!o || (o.isBus && (beside.has(o.bus) || tr.ignoreBusT > 0 || o.bus.near === false))) continue;
        if (o.isTram && o.trackPoints) for (const p of o.trackPoints()) obst.push({ p, min: -2 });
        else obst.push({ p: o, min: -2, bus: o.isBus });
      }
      // gli altri tram contano se hanno il muso davanti al nostro (agli scambi cede chi arriva dietro); se ognuno vede
      // l'altro davanti (incroci a raso, rami che si uniscono) cede il tram entrato in servizio dopo
      for (const t2 of this.trams) {
        if (t2 === tr || !t2.parts.length || ahead(t2.parts[0]) < -0.5) continue;
        const h2 = this.lanePoint(t2.s, t2.dir, t2.track);
        if (t2.id > tr.id && (head.x - h2.x) * h2.fx + (head.z - h2.z) * h2.fz > -0.5 && Math.hypot(head.x - h2.x, head.z - h2.z) < 30) continue;
        for (const p of t2.parts) obst.push({ p, min: -2 });
      }
      let byBus = null, byCar = null;
      for (const { p: o, min, bus } of obst) {
        const rx = o.x - head.x, rz = o.z - head.z;
        if (Math.abs(rx) > 60 || Math.abs(rz) > 60) continue;
        const a = rx * head.fx + rz * head.fz, lat = Math.abs(rx * -head.fz + rz * head.fx), v2 = Math.max(0, (a - 7) * 0.5);
        if (lat < 2.2 && a > min && a < 30 && v2 < vt) { vt = v2; byBus = bus ? o.bus : null; byCar = o.car ? o : null; }
      }
      // un'auto ferma sui binari (in coda a metà svolta) si aspetta; dopo 20 s, lontano dal giocatore, sparisce
      tr.carT = byCar && tr.v < 0.1 ? (tr.carT || 0) + dt : 0;
      if (tr.carT > 20 && byCar.far) { byCar.overlapT = 3; tr.carT = 0; }
      // dove la corsia del bus incrocia il binario quasi di striscio (o ci corre sopra) un bus fermo sui binari e il tram
      // possono aspettarsi a vicenda: il bus ha davanti questo tram, o aspetta l'incrocio che questo tram ha chiamato.
      // Allora dopo 4 s il tram passa lo stesso e per 10 s non guarda i bus. Un bus fermo al rosso o in coda invece si
      // aspetta (prima dopo 20 s il tram ci passava attraverso); oltre i 90 s si passa comunque
      const mutual = byBus && (byBus.waitTram === tr || (byBus.waitX && byBus.waitX.refs.some((r) => r.track === T && r.dir === tr.dir && r.sT > tr.s - 2)));
      tr.busT = byBus && tr.v < 0.1 ? (tr.busT || 0) + dt : 0;
      if (tr.busT > (mutual ? 4 : 90)) { tr.ignoreBusT = 10; tr.busT = 0; }
      tr.v += Math.max(-2.5, Math.min(1.0, vt - tr.v)) * dt * 2;
      tr.v = Math.max(0, tr.v);
      tr.s += tr.v * dt;
      // uscito dallo scambio del capolinea (la coda oltre la comunicazione): lo scambio è libero
      if (tr.esce && tr.s - tr.L > terminalClear(tr.esce)) {
        const t = tr.esce;
        tr.esce = null;
        if (t.occ === tr) t.occ = null;
        if (t.field === 'dep' && this.onSwitch) this.onSwitch(t, 'diritto');
      }
      // al capolinea il guidatore cambia cabina: il muso diventa l'altra estremità, sul binario dell'altro verso
      if (tr.s >= P.len - 2 && !tr.rimessa) {
        if (tr.run) { tr.s = P.len - 2; tr.v = 0; if (!ended.includes(tr) && !tr.man) ended.push(tr); }
        else {
          const tail = P.at(tr.s - tr.L);
          tr.dir *= -1; tr.s = T.path(tr.dir).project(tail.x, tail.z).s; tr.wait = 30; tr.v = 0; tr.served = null;
        }
      }
      if (tr.waveT > 0) tr.waveT = Math.max(0, tr.waveT - dt);
      setWave(tr.driver.arm, tr.waveT);
      // nel tratto senza linea aerea il pantografo si abbassa
      const pm = tr.mods[1];
      if (pm && pm.panto) {
        const want = T.wireAt(tr.dir, tr.s - (TRAM.cab + TRAM.gap + TRAM.mid / 2)) ? 1 : 0;
        tr.panto += Math.sign(want - tr.panto) * Math.min(Math.abs(want - tr.panto), dt / 4);
        setPantograph(pm.panto, tr.panto);
      }
      tr.parts.length = 0;
      let off = 0;
      tr.mods.forEach((m, k) => {
        const sa = tr.s - off, sb = sa - m.len;
        const a = this.lanePoint(sa, tr.dir, T), b = this.lanePoint(sb, tr.dir, T);
        const ha = T.heightAt(tr.dir, sa), hb = T.heightAt(tr.dir, sb);
        m.group.position.set((a.x + b.x) / 2, Y_ROAD + (ha + hb) / 2, (a.z + b.z) / 2);
        m.group.rotation.order = 'YXZ';
        m.group.rotation.y = Math.atan2(a.x - b.x, a.z - b.z);
        m.group.rotation.x = -Math.atan2(ha - hb, m.len);
        const h = m.group.rotation.y;
        for (const f of [0.15, 0.5, 0.85]) tr.parts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h, isTram: true, tram: tr, bump: 0 });
        if (k < tr.mods.length - 1) {
          const j = this.lanePoint(sb - TRAM.gap / 2, tr.dir, T);
          tr.bellows[k].position.set(j.x, Y_ROAD + 1.41 + hb, j.z);
          tr.bellows[k].rotation.y = h;
        }
        off += m.len + TRAM.gap;
      });
    }
    for (const tr of ended) this.endRun(tr, clock);
    for (const tr of turned) this.turnAt(tr);
    for (const tr of gone) if (this.trams.includes(tr)) this.remove(tr);
  }
  // indicatore di linea e destinazione sulle due cabine
  setDest(tr, dest, line = tr.line) {
    for (const m of tr.mods) if (m.led) { m.led.material.map.dispose(); m.led.material.map = ledTexture(line, dest); m.led.material.needsUpdate = true; }
  }
  // di notte fanali accesi in testa e luci rosse in coda
  setNight(f) {
    for (const tr of this.trams) {
      const head = tr.mods[0], tail = tr.mods[tr.mods.length - 1];
      if (head.headMat) { head.headMat.emissiveIntensity = f > 0.3 ? 2 : 0.2; head.tailMat.emissiveIntensity = 0; }
      if (tail.tailMat) { tail.tailMat.emissiveIntensity = f > 0.3 ? 0.9 : 0.05; tail.headMat.emissiveIntensity = 0; }
    }
  }
  // colleghi da salutare: la cabina di testa di ogni tram
  colleagues(out = []) {
    for (const tr of this.trams) if (tr.parts.length) {
      const p = this.lanePoint(tr.s - 2, tr.dir, tr.track);
      out.push({ ref: tr, x: p.x, z: p.z, h: tr.parts[0].h, line: tr.line, tram: true });
    }
    return out;
  }
  near(x, z, r) {
    const out = [];
    for (const tr of this.trams) for (const p of tr.parts) if (Math.abs(p.x - x) < r + 6 && Math.abs(p.z - z) < r + 6) out.push(p);
    return out;
  }
}

// Incroci tra la sede del tram e le strade: priorità al tram.
// Quando un tram si avvicina (o è sull'incrocio) le auto si fermano prima della sede; il segnale del tram passa da
// barra orizzontale (via impedita) a barra verticale (via libera) dopo qualche secondo, a incrocio sgombro; quando il
// tram è passato mostra il triangolo (attenzione) e torna alla barra orizzontale.
// Gli incroci si cercano sui binari di tutte le sedi; nei tratti in comune tra più linee l'incrocio è uno solo e ha un
// riferimento (refs: sede, verso, progressiva) per ogni linea che ci passa.
// metà della fascia dei binari a un incrocio, più mezza auto: chi ha il centro più vicino al binario è sui binari
const BAND = TRAM.lane + 0.6 + 1.1;
export class TramSignals {
  constructor(scene, city, lights) {
    this.list = [];
    this.byEdge = new Map();
    this.violations = [];
    this.giveWay = [];
    this.pIn = new Set();
    if (!city.tramTrack) return;
    const q = [];
    // incroci a raso tra il binario di ogni verso e le strade
    for (const T of Object.values(city.tramTracks || { SIR1: city.tramTrack })) for (const dir of [1, -1]) {
      const C = T.path(dir);
      for (let i = 0; i < C.pts.length - 1; i++) {
        const a = C.pts[i], b = C.pts[i + 1];
        const tl = C.cum[i + 1] - C.cum[i];
        if (tl < 0.05) continue;
        const tdx = (b.x - a.x) / tl, tdz = (b.z - a.z) / tl;
        for (const it of city.segGrid.query((a.x + b.x) / 2, (a.z + b.z) / 2, tl / 2 + 20, q)) {
          if (it.kind !== 'road' || !it.ref || it.ref.ped || it.ref.elev || it.ref.tunnel) continue;
          const e = it.ref;
          const ex = it.bx - it.ax, ez = it.bz - it.az, el = Math.hypot(ex, ez) || 1;
          const den = (b.x - a.x) * ez - (b.z - a.z) * ex;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((it.ax - a.x) * ez - (it.az - a.z) * ex) / den, u = ((it.ax - a.x) * (b.z - a.z) - (it.az - a.z) * (b.x - a.x)) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const sinA = Math.abs(tdx * (ez / el) - tdz * (ex / el));
          if (sinA < 0.3) continue; // strade che corrono accanto alla sede, non la attraversano
          const sT = C.cum[i] + t * tl, tE = u * el;
          if (T.heightAt(dir, sT) > 1.5) continue; // binario in quota: la strada passa sotto
          // strada che il tram imbocca o da cui esce: la incontra al nodo dell'incrocio e poi (o prima) le corre accanto
          // dentro la carreggiata, parallelo; non la attraversa (a Pace dal binario in Via Tommaseo alla sede lungo Via
          // Gozzi, che i binari secondo la regola toccano a meno di un metro dal nodo)
          const lungo = [-15, -10, -5, 5, 10, 15].some((o) => {
            const q = C.at(Math.max(0, Math.min(C.len, sT + o))), w = Math.max(0, Math.min(1, ((q.x - it.ax) * ex + (q.z - it.az) * ez) / (el * el)));
            return Math.hypot(it.ax + ex * w - q.x, it.az + ez * w - q.z) < e.width / 2 + 1 && Math.abs(q.dx * ex + q.dz * ez) / el > 0.9;
          });
          if (lungo && Math.min(tE, el - tE) < 2) continue;
          const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
          // lo stesso incrocio sulla rotaia di un'altra sede (tratto in comune)
          const same = this.list.find((x) => x.e === e && Math.hypot(x.px - px, x.pz - pz) < 2 && x.tdx * tdx + x.tdz * tdz > 0.9);
          if (same) { if (!same.refs.some((r) => r.track === T && r.dir === dir)) same.refs.push({ track: T, dir, sT }); continue; }
          if (this.list.some((x) => x.track === T && x.dir === dir && Math.abs(x.sT - sT) < 6)) continue;
          const x = {
            track: T, dir, e, tE, sT, px, pz, tdx, tdz, refs: [{ track: T, dir, sT }],
            halfE: Math.min(10, (TRAM.lane + 0.6) / sinA), halfT: Math.min(14, (e.width / 2 + 1) / sinA),
            req: 0, call: false, state: 'H', after: 0, prev: new Map(),
          };
          this.list.push(x);
          if (!this.byEdge.has(e)) this.byEdge.set(e, []);
          this.byEdge.get(e).push(x);
        }
      }
    }
    // incroci vicini a un semaforo stradale: la chiamata del tram mette l'incrocio in fase tram
    this.sigs = new Set();
    for (const x of this.list) {
      let best = null, bd = 35;
      for (const sg of (lights && lights.signals) || []) for (const n of sg.nodes) { const d = Math.hypot(n.x - x.px, n.z - x.pz); if (d < bd) { bd = d; best = sg; } }
      x.sig = best;
      if (!best) continue;
      this.sigs.add(best);
      // fasi che non tagliano il binario: i bracci corrono lungo il tram (stessa direzione o opposta) e non sono la
      // strada che lo attraversa qui
      x.free = [0, 1].filter((p) => best.appr.every((a) => a.phase !== p || (a.edge !== x.e && Math.abs(a.out.x * x.tdx + a.out.z * x.tdz) > 0.8)));
    }
    this.lights = lights;
    // Lanterne stradali sul binario: dove il binario corre dentro la carreggiata di un braccio col semaforo (la corsia
    // riservata di Via Tommaseo prima di Pace, Riviera dei Ponti Romani) chi guida il tram vede la lanterna di quel
    // braccio, e quella è il suo segnale: i tram automatici ci si fermano col rosso, il tram che arriva chiama il verde
    // del suo braccio (con i turni di tramCall: arriva entro un ciclo) e chi gioca, passando col rosso, prende la
    // penalità. Prima nessuna logica del tram la guardava: il SIR3 di chi gioca aspettava a Pace un verde che non gli
    // spettava e, passando col rosso, non perdeva punti. Non dove lo stesso tram taglia anche una strada di quel
    // semaforo: lì decide il segnale a barre dell'incrocio
    this.lanterns = [];
    for (const sg of (lights && lights.signals) || []) for (const ap of sg.appr) {
      const L = ap.line;
      if (!L) continue;
      for (const T of Object.values(city.tramTracks || { SIR1: city.tramTrack })) for (const dir of [1, -1]) {
        if (this.list.some((x) => x.sig === sg && x.refs.some((r) => r.track === T && r.dir === dir))) continue;
        const P = T.path(dir), pr = P.projectNear(L.x, L.z, ap.edge.width / 2 + 1.5);
        if (!pr) continue;
        const a = P.at(pr.s);
        if (a.dx * -L.fx + a.dz * -L.fz < 0.8 || T.heightAt(dir, pr.s) > 1.5) continue;
        this.lanterns.push({ sig: sg, ap, track: T, dir, sT: pr.s, free: [ap.phase], who: [], state: 'H', prev: new Map() });
        this.sigs.add(sg);
      }
    }
    this.buildHeads(scene);
  }
  // un segnale per incrocio, a destra del binario, prima della strada: lanterna a tre luci in colonna (dall'alto barra
  // orizzontale bianca = via impedita, triangolo arancione = attenzione, barra verticale bianca = via libera); ne è
  // accesa una sola, le altre si vedono spente (lente scura, simbolo appena visibile, visiera). Cassa grigia con il
  // pannello nero davanti; dietro una calotta per luce, e il palo accanto con due staffe: chi arriva sull'altro binario
  // vede il retro di una lanterna. Prima la cassa era tutta nera sopra il palo e da dietro sembrava un segnale spento
  // (a Voltabarozzo chi arriva al capolinea l'ha davanti, sopra i binari, da 70 m fino all'attraversamento)
  buildHeads(scene) {
    const n = this.list.length;
    if (!n) return;
    const statics = [], body = [], lenses = [];
    const mk = (geo) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n); m.count = n; m.frustumCulled = false; scene.add(m); return m; };
    this.hBar = mk(new THREE.PlaneGeometry(0.24, 0.065));
    this.vBar = mk(new THREE.PlaneGeometry(0.065, 0.24));
    const tri = new THREE.Shape();
    tri.moveTo(-0.12, -0.09); tri.lineTo(0.12, -0.09); tri.lineTo(0, 0.11); tri.closePath();
    this.tri = mk(new THREE.ShapeGeometry(tri));
    this.heads = [];
    const Y0 = 3.25, DY = 0.36, HH = DY * 3 + 0.1;
    for (const x of this.list) {
      const T = x.track, s = x.sT - (x.halfT + 3), P = T.path(x.dir), p = P.at(s), h = T.heightAt(x.dir, s);
      const px = p.x - p.dz * (TRAM.lane + 0.35), pz = p.z + p.dx * (TRAM.lane + 0.35), ang = Math.atan2(-p.dx, -p.dz);
      const fx = Math.sin(ang), fz = Math.cos(ang), y = Y_ROAD + h + Y0, y0 = Y_ROAD + h;
      // ox, oz: verso l'esterno, lontano dal binario (l'asse x della cassa ruotata di ang)
      const ox = -p.dz, oz = p.dx, top = y + HH / 2 + 0.12;
      body.push(new THREE.CylinderGeometry(0.05, 0.06, top - y0, 6).translate(px + ox * 0.33, (top + y0) / 2, pz + oz * 0.33));
      for (const k of [1, -1]) body.push(new THREE.BoxGeometry(0.16, 0.06, 0.08).rotateY(ang).translate(px + ox * 0.26, y + k * DY * 1.2, pz + oz * 0.26));
      body.push(new THREE.BoxGeometry(0.42, HH, 0.16).rotateY(ang).translate(px - fx * 0.01, y, pz - fz * 0.01));
      statics.push(new THREE.BoxGeometry(0.42, HH, 0.02).rotateY(ang).translate(px + fx * 0.08, y, pz + fz * 0.08));
      const pos = [];
      for (const k of [1, 0, -1]) {
        const ly = y + k * DY;
        body.push(new THREE.CylinderGeometry(0.1, 0.14, 0.07, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.125).rotateY(ang).translate(px, ly, pz));
        lenses.push(new THREE.CircleGeometry(0.155, 20).rotateY(ang).translate(px + fx * 0.092, ly, pz + fz * 0.092));
        // visiera sopra ogni luce
        statics.push(new THREE.BoxGeometry(0.36, 0.025, 0.16).rotateY(ang).translate(px + fx * 0.16, ly + 0.17, pz + fz * 0.16));
        pos.push(new THREE.Vector3(px + fx * 0.096, ly, pz + fz * 0.096));
      }
      this.heads.push({ x, pos, ang, shown: null });
    }
    const box = new THREE.Mesh(mergeGeometries(statics), new THREE.MeshLambertMaterial({ color: 0x1b1d1f }));
    const lens = new THREE.Mesh(mergeGeometries(lenses), new THREE.MeshBasicMaterial({ color: 0x0b0c0d }));
    // grigio neutro, come il retro dei cartelli stradali: si legge anche in ombra
    scene.add(box, lens, new THREE.Mesh(mergeGeometries(body), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 })));
    this.box = box;
    this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.O = new THREE.Vector3(1, 1, 1); this.C = new THREE.Color();
    this.drawHeads(true);
  }
  drawHeads(force) {
    if (!this.heads) return;
    let dirty = false;
    const ON = { w: 0xfff6dc, o: 0xff9a1a }, OFF = { w: 0x34342f, o: 0x3d2709 };
    this.heads.forEach((hd, i) => {
      const st = hd.x.state;
      if (!force && hd.shown === st) return;
      hd.shown = st; dirty = true;
      this.Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hd.ang);
      [[this.hBar, 'H', 'w', 0], [this.tri, 'T', 'o', 1], [this.vBar, 'V', 'w', 2]].forEach(([mesh, key, c, k]) => {
        if (force) { this.M.compose(hd.pos[k], this.Q, this.O); mesh.setMatrixAt(i, this.M); }
        mesh.setColorAt(i, this.C.set(st === key ? ON[c] : OFF[c]));
      });
    });
    if (dirty) for (const m of [this.hBar, this.vBar, this.tri]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  // occ: tram presenti [{ front (s lungo il binario), dir, track (la sede), len, v, dwell, player }]; cars: auto vicine per
  // sapere se l'incrocio è sgombro; player: il bus di chi gioca (per la precedenza al tram)
  update(dt, occ, traffic, player) {
    this.violations.length = 0;
    this.giveWay.length = 0;
    this.player = player && !player.isTram ? player : null;
    // per semaforo: i tram che hanno già il via libera su uno dei suoi incroci (al passo prima)
    for (const sg of this.sigs) { sg.vTrams = sg._vTrams || new Set(); sg._vTrams = new Set(); sg._calls = []; }
    for (const x of this.list) {
      let need = false;
      x.who = [];
      x.close = false;
      for (const o of occ) {
        const r = x.refs.find((r) => r.dir === o.dir && r.track === o.track);
        if (!r) continue;
        const d = r.sT - o.front; // distanza del muso dall'incrocio lungo il binario (positiva se davanti)
        const on = d > -(o.len + x.halfT) && d <= x.halfT;
        const coming = d > x.halfT && d < 25 + o.v * 6 && !o.dwell;
        if (on || coming) { need = true; x.who.push(o.ref || o); }
        // tram a meno di 12 m più 4 s dai binari dell'incrocio (o già sopra), in marcia o col via libera
        if (d > -(o.len + x.halfT) && d - x.halfT < 12 + o.v * 4 && !o.dwell && (o.v > 0.5 || x.state === 'V')) x.close = true;
        // il tram del giocatore entra nell'incrocio con la barra orizzontale?
        if (o.player) {
          const pd = x.prev.get(o) ?? d;
          if (pd > x.halfT + 0.3 && d <= x.halfT + 0.3 && x.state === 'H' && o.v > 0.5) this.violations.push(x);
          x.prev.set(o, d);
        }
      }
      if (need) {
        x.req += dt;
        if (x.sig) x.sig._calls.push(x);
        const busy = traffic && this.busy(x, traffic);
        // occupato a lungo da auto ferme (la fine della loro corsia cade sulla sede e il tram aspetta loro mentre loro
        // aspettano il tram): dopo 20 s quelle lontane dal giocatore spariscono, come le auto incastrate davanti ai bus
        x.busyT = busy && x.state !== 'V' ? (x.busyT || 0) + dt : 0;
        if (x.busyT > 20) { this.unstick(x, traffic); x.busyT = 0; }
        // con un semaforo stradale: via libera nella fase tram che lascia passare questo tram, dopo giallo e rosso per
        // chi taglia il binario; a fase chiusa solo al tram che ha già il via libera su un altro incrocio del semaforo
        // (non resta fermo tra due binari)
        const sg = x.sig, ready = sg ? sg.tramT > 4.5 && (sg.tramOpen || x.who.some((t) => sg.vTrams.has(t))) && (sg.tramPh === -1 || x.free.includes(sg.tramPh)) : x.req > 2.5;
        if (x.state !== 'V' && ready && !busy) x.state = 'V';
        if (sg && x.state === 'V') for (const t of x.who) sg._vTrams.add(t);
        if (x.state === 'T') x.state = 'H';
        x.after = 0;
        // chi taglia il binario si ferma prima della sede: senza semaforo da quando il tram chiama (precedenza al
        // tram); col semaforo da quando parte la fase tram che lo fa passare, prima vale il verde della strada (auto
        // e bus si fermavano a ogni chiamata, anche col verde e col tram fermo alla barra orizzontale)
        x.call = x.state === 'V' || (sg ? sg.tramT > 0 && (sg.tramOpen || x.who.some((t) => sg.vTrams.has(t))) && (sg.tramPh === -1 || x.free.includes(sg.tramPh)) : true);
      } else {
        if (x.state === 'V') { x.state = 'T'; x.after = 0; }
        if (x.state === 'T' && (x.after += dt) > 2) x.state = 'H';
        x.req = 0;
        x.call = false;
      }
    }
    // lanterne stradali sul binario: lo stato è quello della lanterna; il tram che arriva chiama il verde del suo braccio
    for (const l of this.lanterns || []) {
      const st = this.lights.stateOf(l.sig, l.ap.phase);
      l.state = st === 'G' ? 'V' : 'H';
      l.who = [];
      for (const o of occ) {
        if (o.dir !== l.dir || o.track !== l.track) continue;
        const d = l.sT - o.front;
        if (d > -8 && d < 25 + o.v * 6 && !(o.dwell && d > 0)) l.who.push(o.ref || o);
        // il tram del giocatore passa la linea d'arresto col rosso?
        if (o.player) {
          const pd = l.prev.get(o) ?? d;
          if (pd > 0.3 && d <= 0.3 && st === 'R' && o.v > 0.5) this.violations.push(l);
          l.prev.set(o, d);
        }
      }
      if (l.who.length) {
        l.sig._calls.push(l);
        if (l.state === 'V') for (const t of l.who) l.sig._vTrams.add(t);
      }
    }
    for (const sg of this.sigs) this.lights.tramCall(sg, sg._calls, dt);
    // chi guida il bus entra coi binari di un incrocio senza semaforo (il muso a 1,2 m dalla sagoma del tram, non nel
    // margine della fascia) con il tram vicino: non gli ha dato la precedenza (col semaforo vale il rosso)
    const b = this.player;
    if (b) {
      const fx = Math.sin(b.h), fz = Math.cos(b.h), px = b.x + fx * 6, pz = b.z + fz * 6, inside = new Set();
      for (const x of this.nearXY(px, pz)) if (this.cuts(x, px, pz, fx, fz, TRAM.lane + 0.6)) inside.add(x);
      for (const x of inside) if (!this.pIn.has(x) && !x.sig && x.close && b.v > 1) this.giveWay.push(x);
      this.pIn = inside;
    }
    this.drawHeads(false);
  }
  // incrocio occupato: qualcuno che taglia il binario (anche fermo) è nella fascia dei binari o ci arriva entro 1,5 s
  // (le auto lungo il loro percorso, anche in svolta). Chi va lungo il binario (col verde del tram) non conta
  busy(x, traffic) {
    for (const c of traffic.near(x.px, x.pz, x.halfT + 25)) if (!c.isTram && this.covers(x, c, 1.5, traffic)) return true;
    // il bus di chi gioca, come quelli automatici: il corpo (non il muso, che alla linea d'arresto può sporgere nel
    // margine della fascia: si teneva la barra orizzontale al tram e la fase tram del semaforo restava aperta) e, in
    // marcia, 1,5 s di strada davanti al muso
    const b = this.player;
    if (b && Math.hypot(b.x - x.px, b.z - x.pz) < x.halfT + 40) {
      const fx = Math.sin(b.h), fz = Math.cos(b.h);
      for (const l of b.v > 0.5 ? [-4, 0, 4, 6 + b.v * 1.5] : [-4, 0, 4]) if (this.cuts(x, b.x + fx * l, b.z + fz * l, fx, fz)) return true;
    }
    return false;
  }
  // l'auto o il pezzo di bus c taglia i binari dell'incrocio x: col centro, per le auto anche col muso (2,1 m avanti: in
  // coda a passo d'uomo il muso entrava sui binari col centro ancora fuori, e il tram aveva il via libera), più ahead
  // secondi di strada in marcia. Le auto lungo il loro percorso (curve e archi dopo, Traffic.along): prima contava tutto
  // il resto della curva, anche per chi si fermava a metà prima dei binari, e un punto in linea retta, che nelle svolte
  // finiva fuori strada. Lo stesso per busy e unstick: chi tiene occupato l'incrocio deve poter sparire (prima unstick
  // guardava solo il centro e un SIR2 aspettava 11 minuti a Porta Savonarola)
  covers(x, c, ahead, traffic) {
    if (c.car) return traffic.along(c, 0, 2.1 + (c.v > 0.5 ? c.v * ahead : 0), this, (d, px, pz, dx, dz) => this.cuts(x, px, pz, dx, dz));
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    return this.cuts(x, c.x, c.z, fx, fz) || (ahead > 0 && c.v > 0.5 && this.cuts(x, c.x + fx * c.v * ahead, c.z + fz * c.v * ahead, fx, fz));
  }
  unstick(x, traffic) {
    for (const c of traffic.near(x.px, x.pz, x.halfT + 25)) if (c.car && c.far && c.v <= 0.3 && this.covers(x, c, 0, traffic)) c.overlapT = 3;
  }
  // il punto (px, pz), andando verso (dx, dz), è nella fascia dei binari dell'incrocio x e li taglia (non ci corre lungo;
  // gli incroci di sbieco sono quasi tutti strade lungo il binario, come Via Piovese col SIR3, che lo incrociano solo
  // perché la linea OSM e il tracciato del tram non combaciano: chi le percorre gli corre accanto); band: metri dall'asse
  cuts(x, px, pz, dx, dz, band = BAND) {
    const rx = px - x.px, rz = pz - x.pz;
    if (Math.abs(rx * x.tdx + rz * x.tdz) > x.halfT || Math.abs(rx * x.tdz - rz * x.tdx) > band) return false;
    return Math.abs(dx * x.tdx + dz * x.tdz) < 0.8 * (Math.hypot(dx, dz) || 1);
  }
  // incroci col tram nella cella da 40 m del punto e in quelle accanto
  nearXY(px, pz) {
    if (!this._grid) {
      this._grid = new Map();
      for (const x of this.list) {
        const k = `${Math.floor(x.px / 40)},${Math.floor(x.pz / 40)}`;
        if (!this._grid.has(k)) this._grid.set(k, []);
        this._grid.get(k).push(x);
      }
    }
    const cx = Math.floor(px / 40), cz = Math.floor(pz / 40), out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = this._grid.get(`${cx + i},${cz + j}`); if (a) out.push(...a); }
    return out;
  }
  // le auto si fermano prima della sede se l'incrocio è chiamato da un tram, o se oltre i binari la coda (chi c'è davanti
  // a lead m, a leadV m/s) non lascia posto all'auto: chi non può liberare i binari non ci entra
  carGap(c, g, lead = Infinity, leadV = 0) {
    const xs = this.byEdge.get(c.edge);
    if (!xs) return Infinity;
    let gap = Infinity;
    for (const x of xs) {
      // ci si ferma prima del primo binario che si incontra (anche se il tram arriva su quello più lontano)
      let pos = c.fwd ? x.tE : c.edge.len - x.tE, half = x.halfE;
      for (const y of xs) { const py = c.fwd ? y.tE : c.edge.len - y.tE; if (py < pos && pos - py < 14) { pos = py; half = y.halfE; } }
      const stop = Math.min(pos - half - 2.5, g.s1 - 0.3);
      const dist = stop - c.s;
      const out = (c.fwd ? x.tE : c.edge.len - x.tE) + x.halfE + 1;
      const full = leadV < 1.5 && c.s + 2.1 + lead < out + 6;
      if ((x.call || full) && dist > -0.5 && dist < 80) gap = Math.min(gap, Math.max(0, dist));
    }
    return gap;
  }
  // per i tram automatici: distanza dalla prossima linea d'arresto a via impedita (track: la sede del tram)
  stopAhead(s, dir, track) {
    let best = Infinity;
    // lanterne stradali sul binario col rosso (o col giallo da lontano): 1 m prima della linea d'arresto
    for (const l of this.lanterns || []) {
      if (l.dir !== dir || l.track !== track) continue;
      const d = l.sT - 1 - s, st = this.lights.stateOf(l.sig, l.ap.phase);
      if (d > -0.5 && d < best && (st === 'R' || (st === 'Y' && d > 10))) best = d;
    }
    for (const x of this.list) {
      if (x.state === 'V') continue;
      const r = x.refs.find((r) => r.dir === dir && r.track === track);
      if (!r) continue;
      const d = r.sT - (x.halfT + 1.5) - s;
      if (d > -0.5 && d < best) best = d;
    }
    return best;
  }
}
