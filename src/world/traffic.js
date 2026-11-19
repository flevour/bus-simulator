import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid, distToSeg, mulberry32 } from './spatial.js';
import { Y_ROAD, TRAM_HW, zoneOf, quotaStrada, layer } from './city.js';
import { ledTexture } from './textures.js';
import { TRAM, ASSE_SUL_BINARIO, tramLength, buildTramConvoy, setPantograph, YardRun } from '../tram/tram.js';
import { driverFigure, setWave } from './driver.js';
import { raccordiDi, curva, Curva, Percorso, posa, punto, scosta, corsie, costoCambio, tratto, ripiego, AUTO, raggioMinimo, idm, IDM_AUTO, incrocioDavanti } from './inseguitore.js';
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
export function armPoint(nodes, n, e, d) {
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
export function armCrossings(nodes, n, e, maxD) {
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
    this.stats = { approcci: 0, palo: 0, muro: 0, senzaPalo: 0, ripetitrici: 0, sbracci: 0 };
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
    for (const s of this.signals) s.offset0 = s.offset;
    this.buildMeshes(scene);
    this.time = 0;
    this._c = new THREE.Color();
    this.update(0);
  }

  // linea d'arresto, pali e lanterne di un approccio, dove li ha messi la build (city.arredo, src/data/arredo.js): la
  // linea d'arresto a stop metri dal nodo lungo il braccio, il palo a destra (o a sinistra sui sensi unici senza posto
  // a destra) con l'eventuale sbraccio, la ripetitrice a sinistra. Fino al 16 novembre il posto si cercava qui a ogni
  // caricamento, tastando il bordo dell'asfalto (#109): la ricerca è in src/world/posa.js
  placeApproach(sig, ap) {
    const nodes = this.net.nodes, n = ap.node, e = ap.edge;
    this.stats.approcci++;
    const r = this.city.arredo.semaforo(this, sig, ap);
    const p = armPoint(nodes, n, e, r.stop);
    ap.stop = r.stop;
    this.stopArcs.set(`${p.arc.id}:${p.from.id}`, { ap, t: p.t });
    const q = armPoint(nodes, n, e, ap.stop + 12);
    // le lanterne guardano chi arriva, lungo l'asse del braccio alla linea d'arresto (non l'arco del grafo)
    let fx = q.x - p.x, fz = q.z - p.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    ap.face = { x: fx, z: fz };
    const hw = e.width / 2, h = n.h || 0;
    ap.heads = [];
    ap.poles = [];
    const R = r.R;
    if (R) {
      this.stats.palo++;
      if (R.wall) this.stats.muro++;
      ap.pos = { x: R.x, z: R.z };
      if (!R.wall) ap.poles.push({ x: R.x, z: R.z, y: h, mast: R.mast, side: R.side });
      ap.heads.push({ x: R.x + fx * 0.2, y: h + 0.1 + HEAD_Y + (R.wall ? 0.5 : 0), z: R.z + fz * 0.2, wall: R.wall ? R.side : 0 });
      // palo a sbraccio: la seconda lanterna sopra le corsie di chi arriva
      if (R.mast) {
        this.stats.sbracci++;
        ap.heads.push({ x: R.x - fz * R.side * R.mast + fx * 0.2, y: h + 0.1 + MAST_Y, z: R.z + fx * R.side * R.mast + fz * 0.2 });
      }
    } else {
      this.stats.senzaPalo++;
      ap.pos = { x: p.x + fz * (hw + 1), z: p.z - fx * (hw + 1) };
    }
    // ripetitrice a sinistra, obbligatoria sui sensi unici con due o più corsie (art. 168 c. 3)
    const Lp = r.L;
    if (Lp) {
      this.stats.ripetitrici++;
      if (!Lp.wall) ap.poles.push({ x: Lp.x, z: Lp.z, y: h, mast: 0, side: -1 });
      ap.heads.push({ x: Lp.x + fx * 0.2, y: h + 0.1 + HEAD_Y + (Lp.wall ? 0.5 : 0), z: Lp.z + fz * 0.2, wall: Lp.wall ? -1 : 0 });
    }
    // linea d'arresto: continua, larga 50 cm, sulle corsie di chi arriva (art. 144)
    ap.line = { x: p.x, z: p.z, fx, fz, w0: r.w0, w1: r.w1, y: h };
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
  // inizio di una corsa: l'ora, e ogni semaforo col ciclo che aveva alla costruzione, senza fase tram in corso né verde
  // dovuto. tramCall sposta il ciclo a ogni passaggio di un tram: senza questo i semafori di una corsa dipendono dalle
  // corse fatte prima sulla stessa pagina
  reset(time) {
    this.time = time;
    for (const s of this.signals) {
      s.offset = s.offset0;
      s.gAge = [0, 0];
      s.tramT = s.tramAge = s.postT = 0;
      s.tramOpen = false;
      s.owed = null;
      s.vTrams = s._vTrams = null;
    }
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
  // secondi di verde che restano alla fase (0 se non è verde). Dal ciclo; quando il verde lo dà una chiamata del tram, o
  // la fine di una chiamata, quanto dura non si sa: Infinity, come se restasse
  verdeRestante(sig, phase) {
    if (this.stateOf(sig, phase) !== 'G') return 0;
    if (sig.tramT > 0 || sig.postT > 0 || this.cycleState(sig, phase) !== 'G') return Infinity;
    let t = (this.time + sig.offset) % sig.total, k = 0;
    const c = sig.cycle;
    while (k < 5 && t > c[k]) { t -= c[k]; k++; }
    return c[k] - t;
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
// Le auto seguono corsie e raccordi della build (src/world/inseguitore.js, #113): l'asse posteriore sta sul percorso,
// ASSE metri dietro al centro, e la direzione è la tangente
const ASSE = 1.35;
const R_AUTO = raggioMinimo(AUTO);
// scostamento di lato (sorpasso, fuori dalla sede del tram): al più K_LAT metri per metro, con la curva entro metà del
// raggio minimo
const K_LAT = 0.15, A_LAT = 1 / (2 * R_AUTO);
// curve: accelerazione laterale (√(ALAT · r) nel raccordo: 3,4 m/s nelle rotonde piccole, 6,7 m/s con 15 m di raggio;
// con 2 m/s² la rotonda di Via Bembo con Via Marinelli smaltiva troppo poco e la coda arrivava oltre 150 s) e frenata
// prima della curva (m/s²)
const ALAT = 3, FRENO = 2;
// quanto traffico attira una strada nella scelta del movimento (chooseNext)
const pesoVia = (e) => (e.main ? 4 : e.service ? 0.08 : e.cls === 6 ? 0.3 : 1);
// chi segue chi (#115): l'IDM delle auto, in src/world/inseguitore.js
const IDM_A = IDM_AUTO.a, IDM_S0 = IDM_AUTO.s0;
const idmAuto = (v, v0, s, dv) => idm(IDM_AUTO, v, v0, s, dv);
// lunghezza dell'auto più 20 cm: tra i centri di due auto in fila, la distanza meno questa è lo spazio tra muso e coda
const LUNGA = 4.4;
// metri dal centro al muso
const MUSO = 2.1;
// chi decide se entrare in un incrocio guarda la fila fino a FILA m davanti al centro (fin dove arriva il percorso,
// estendi), e prevede chi passa la prossima linea d'arresto prima del rosso (postoOltre, #148): una coda ferma al rosso
// si scarica al verde con un'auto ogni SCARICO s (2,16 s nel corridoio di Via Querini, tests/code.spec.js), e col giallo
// passa chi è a meno di 1,2 s dalla linea (GIALLO_PASSA: un secondo, per stare larghi). Oltre l'incrocio vuole il suo
// posto più MARGINE m: la previsione sbaglia di qualche metro (la fila davanti frena più del previsto, qualcuno
// s'immette): con mezzo metro, come prima, nei dieci minuti della prova delle code restavano dentro un incrocio da 3 a
// 5 auto, con 3 m una
const FILA = 92, SCARICO = 2.2, GIALLO_PASSA = 1, MARGINE = 3;
// secondi per fare d metri partendo a v m/s e accelerando come l'IDM fino a v0, senza nessuno davanti
function arrivo(d, v, v0) {
  if (d <= 0) return 0;
  const a = IDM_A, vm = Math.max(v0, v, 1), sa = (vm * vm - v * v) / (2 * a);
  return d <= sa ? (Math.sqrt(v * v + 2 * a * d) - v) / a : (vm - v) / a + (d - sa) / vm;
}
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
    this.rac = raccordiDi(net);
    // ripieghi delle auto (cambi di corsia senza posto, raccordi sovrapposti) e uscite di scena in fondo alle strade
    // chiuse: tipo -> quante volte
    this.ripieghi = {};
    // al più quante auto si simulano (72; le prove che vogliono solo le loro lo mettono a 0) e la domanda di traffico
    // (#116, src/world/domanda.js): quante ne servono (quante), dove nascono e dove vanno. raggio: il disco attorno a chi
    // guida dove stanno; centro: per le prove, il centro del disco al posto di chi guida
    this.target = opts.count;
    this.domanda = opts.domanda || null;
    this.quante = opts.count;
    this.raggio = 1500;
    this.centro = null;
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

  // auto nuova, non ancora in scena, all'inizio del suo percorso: il centro dell'asse posteriore a s metri dal nodo di
  // partenza dell'arco e (verso fwd), sulla corsia data; route: i movimenti già scelti
  nuovaAuto(e, fwd, s, corsia, route) {
    return {
      car: true, edge: e, fwd, s: s + ASSE, v: 0, turn: null, id: Math.random(), n: (this.serie = (this.serie || 0) + 1),
      per: new Percorso(), q: 0, lat: 0, pend: 0, coda: { e, fwd, s, corsia }, route, ev: [], chiusa: false,
      blocked: 0, pass: 0, passT: 0, honkCd: 0,
    };
  }

  // tratto carrabile a caso vicino al bus (ricerca spaziale: la città è molto grande)
  randomEdgeNear(x, z, minD, maxD) {
    const a = this.rnd() * Math.PI * 2, d = minD + this.rnd() * (maxD - minD);
    const arr = this.city.segGrid.query(x + Math.cos(a) * d, z + Math.sin(a) * d, 80, this._re || (this._re = []));
    const cand = arr.filter((it) => it.kind === 'road' && it.ref && !it.ref.ped && !it.ref.psv && (!it.ref.service || this.rnd() < 0.15));
    return cand.length ? cand[Math.floor(this.rnd() * cand.length)].ref : null;
  }
  // movimenti delle auto da chi percorre l'arco e nel verso fwd, al nodo dove arriva: i raccordi della build con le auto
  // (docs/raccordi.md), per arco d'uscita e archi corti scavalcati: { edge, fwd, node, racs }. Vuoto in fondo alle strade
  // chiuse e al bordo della mappa (non ci sono inversioni sullo stesso arco)
  movimenti(e, fwd) {
    const memo = this._mov || (this._mov = new Map()), key = fwd ? e.id : -1 - e.id;
    let out = memo.get(key);
    if (out) return out;
    const per = new Map();
    for (const R of this.rac.at(fwd ? e.b : e.a)) {
      if (R.da !== e || !(R.classi & AUTO)) continue;
      const k = R.via.length ? `${R.a.id}:${R.via.map((x) => x.id).join(',')}` : R.a.id;
      let m = per.get(k);
      if (!m) per.set(k, (m = { edge: R.a, fwd: R.fout, node: this.net.nodes[R.m], racs: [] }));
      m.racs.push(R);
    }
    out = [...per.values()];
    memo.set(key, out);
    return out;
  }
  // vicolo cieco per le auto: percorrendo l'arco nel verso fwd, con i movimenti dei raccordi, si raggiungono meno di 12
  // archi. Le auto non ci nascono e ci entrano solo se non c'è altro: in Piazza Garibaldi uno spezzone di 5 m sopra i
  // binari, che porta solo alla corsia dei bus, e in Via Morgagni due spezzoni che portano solo l'uno nell'altro tenevano
  // un'auto a fare inversioni sulla sede. Lo è anche l'arco da cui non si torna nella rete (pit)
  deadEnd(e, fwd) {
    const memo = this._dead || (this._dead = new Map()), key = fwd ? e.id : -1 - e.id;
    if (memo.has(key)) return memo.get(key);
    const seen = new Set([key]), queue = [[e, fwd]];
    while (queue.length && seen.size < 12) {
      const [a, f] = queue.shift();
      for (const m of this.movimenti(a, f)) {
        const k = m.fwd ? m.edge.id : -1 - m.edge.id;
        if (!seen.has(k)) { seen.add(k); queue.push([m.edge, m.fwd]); }
      }
    }
    const dead = seen.size < 12 || this.pit(e, fwd);
    memo.set(key, dead);
    return dead;
  }
  // pozzo: dall'arco nel verso fwd, con i movimenti dei raccordi, si raggiungono meno di 200 archi nel loro verso.
  // Accanto a Corso Esperanto (2785, 3300) un anello di strade di servizio a senso unico ne raggiunge 17, con le uscite a
  // senso unico fino al bordo dell'area: le auto ci entravano, le uscite erano vicoli ciechi e giravano nell'anello per
  // sempre, con la coda ferma sulla strada d'ingresso. Gli altri archi ne raggiungono decine di migliaia. Chi raggiunge
  // un arco che non è un pozzo non lo è; gli archi raggiunti da un pozzo lo sono tutti
  pit(e, fwd) {
    const memo = this._pit || (this._pit = new Map()), key = fwd ? e.id : -1 - e.id;
    if (memo.has(key)) return memo.get(key);
    const seen = new Set([key]), queue = [[e, fwd]];
    let out = false;
    while (queue.length && !out) {
      const [a, f] = queue.shift();
      for (const m of this.movimenti(a, f)) {
        const k = m.fwd ? m.edge.id : -1 - m.edge.id;
        if (seen.has(k)) continue;
        if (memo.get(k) === false || seen.size >= 200) { out = true; break; }
        seen.add(k); queue.push([m.edge, m.fwd]);
      }
    }
    if (out) memo.set(key, false);
    else for (const k of seen) memo.set(k, true);
    return !out;
  }
  // le auto non entrano nelle vie pedonali né nelle corsie riservate ai bus
  allowed(e, fwd) { return !e.ped && !e.psv && (!e.oneway || (e.oneway === 1) === fwd); }

  // un'auto nuova a caso tra minD e maxD metri da chi guida, su un arco e in un verso a caso (senza la domanda di #116:
  // le prove che non la vogliono)
  spawn(bus, minD = 120, maxD = 1400, cars = this.cars) {
    for (let tries = 0; tries < 12; tries++) {
      const e = this.randomEdgeNear(bus.x, bus.z, minD, maxD);
      if (!e) continue;
      let fwd = e.oneway ? e.oneway === 1 : this.rnd() < 0.5;
      if (this.deadEnd(e, fwd)) { if (e.oneway || this.deadEnd(e, !fwd)) continue; fwd = !fwd; }
      const car = this.metti(e, fwd, this.rnd(), null, bus, minD, maxD, cars);
      if (car) return car;
    }
    return null;
  }
  // un'auto nuova con un viaggio della domanda (#116, src/world/domanda.js) che passa nel disco attorno a c0, a più di
  // rIn metri: nasce lungo il suo percorso, dove ci sarebbe in quel momento. subito: gli alberi che servono si calcolano
  // ora (alla partenza della corsa); altrimenti, se l'albero dell'arrivo non è pronto, null (e lo si calcola a pezzi)
  nasci(c0, rIn, subito = false, cars = this.cars) {
    const v = this.domanda.campiona(this.rnd, c0.x, c0.z, rIn, subito);
    if (!v) return null;
    const e = this.net.edges[v.stato >> 1];
    return this.metti(e, !(v.stato & 1), v.f, { o: v.o, d: v.d, arrivo: v.arrivo, albero: v.albero }, c0, rIn, this.raggio + 50, cars);
  }
  // l'auto sull'arco e nel verso fwd, a frazione f del tratto tra l'inizio della corsia e il primo raccordo, con il viaggio
  // v (o null); null se non c'è posto (a meno di 12 m da un'altra auto o 16 m da un bus automatico, fuori da minD-maxD)
  metti(e, fwd, f, v, bus, minD, maxD, cars = this.cars) {
    // la prima svolta, e la corsia più a destra da cui la si fa: l'auto nasce lì, tra l'inizio della corsia e il raccordo
    const m = this.chooseNext(e, fwd, null, v);
    if (!m) return null;
    const R = m.racs.reduce((a, b) => (b.cda > a.cda ? b : a)), from = this.net.nodes[fwd ? e.a : e.b];
    const s0 = (from.radius || 0) * 0.8, s1 = curva(this.net, R).s0 - ASSE - 1;
    if (s1 - s0 < 3) return null;
    const car = this.nuovaAuto(e, fwd, s0 + f * (s1 - s0), R.cda, [m]);
    car.viaggio = v;
    this.estendi(car, 90);
    this.segui(car);
    const x = car.x, z = car.z;
    const d = Math.hypot(x - bus.x, z - bus.z);
    if (d < minD || d > maxD) return null;
    if (cars.some((c) => Math.hypot(c.x - x, c.z - z) < 12)) return null;
    if (this.bigs.some((b) => Math.hypot(b.x - x, b.z - z) < 16)) return null; // non sopra un bus automatico
    const zone = zoneOf(x, z);
    car.vmax = (zone === 0 || !e.main ? 9 : 14) * (0.9 + this.rnd() * 0.2);
    car.v = Math.min(car.vmax * 0.7, this.vCurva(car));
    // a pochi metri da un incrocio nasce abbastanza piano da poter ancora decidere se entrarci (frenata comoda): già
    // lanciata ci entrava comunque, anche con la coda oltre, e ci restava (#148)
    const box = this.incrocioDavanti(car, car.q + ASSE + MUSO, 60);
    if (box) car.v = Math.min(car.v, Math.sqrt(8 * Math.max(0, box.q0 - car.q - ASSE - MUSO - 0.3)));
    car.color = new THREE.Color(CAR_COLORS[Math.floor(this.rnd() * CAR_COLORS.length)]);
    cars.push(car);
    return car;
  }
  // le auto della corsa alla partenza (main.js): con la domanda quante ne dice per l'ora e il posto, nate lungo i loro
  // viaggi nel disco attorno a chi guida, con gli alberi calcolati subito; senza, target auto a caso
  popola(bus, clock = 8 * 3600, giorno = 'feriale') {
    const D = this.domanda;
    if (!D) { for (let i = 0; i < this.target; i++) this.spawn(bus, 60, 1400); return; }
    const c0 = this.centro || bus;
    D.ora(clock, giorno);
    D.centro(c0.x, c0.z, true);
    if (D.aggiorna(this.target)) { this.quante = Math.round(D.quante); this.raggio = D.R; }
    const n = Math.min(this.target, this.quante);
    for (let k = 0; k < 6 * n && this.cars.length < n; k++) this.nasci(c0, 60, true);
  }

  // il movimento dopo l'arco edge (percorso nel verso fwd); da T (la corsia dove si arriva: { e, fwd, s, corsia }) prima
  // quelli che non chiedono un cambio di corsia senza posto. null se non ce ne sono (strada chiusa, bordo della mappa).
  // Con un viaggio v (#116) quello che arriva prima all'arrivo, con i ritardi misurati (Domanda.costo); senza, a caso
  chooseNext(edge, fwd, T = null, v = null) {
    let opts = this.movimenti(edge, fwd);
    if (!opts.length) return null;
    if (v && this.domanda) {
      // l'albero dell'arrivo con i tempi della fascia di adesso; finché quello nuovo non è pronto, il vecchio
      const D = this.domanda;
      let A = v.albero && v.albero.fatto ? v.albero : null;
      if (!A || A.fascia !== D.chiaveTempi) { const B = D.albero(v.arrivo); if (B) A = v.albero = B; }
      if (A) {
        const s = 2 * edge.id + (fwd ? 0 : 1), st = (m) => 2 * m.edge.id + (m.fwd ? 0 : 1);
        const verso = opts.filter((m) => A.T[st(m)] < Infinity);
        if (verso.length) {
          let tra = verso;
          if (T) {
            const ok = verso.filter((m) => m.racs.some((R) => this.costo(T, R) < 100));
            if (ok.length) tra = ok;
          }
          let best = tra[0], bc = Infinity;
          for (const m of tra) { const c = D.costo(s, st(m), A); if (c < bc) { bc = c; best = m; } }
          return best;
        }
        // da qui l'arrivo non si raggiunge (un movimento senza raccordo per l'auto, un ripiego): il viaggio finisce
        v.perso = true;
      }
    }
    // prima chi non è un vicolo cieco, poi chi non è un pozzo (in Via delle Porte Contarine due vicoli ciechi, uno lo è)
    const open = opts.filter((m) => !this.deadEnd(m.edge, m.fwd));
    const back = opts.filter((m) => !this.pit(m.edge, m.fwd));
    if (open.length) opts = open;
    else if (back.length) opts = back;
    // dalla corsia dove si arriva, le svolte che si fanno senza un cambio di corsia che non ci sta. Nell'anello di una
    // rotonda ce n'è sempre una: la build porta le auto solo nelle corsie da cui un'uscita si raggiunge, e dentro
    // l'anello dà i raccordi che passano alla corsia più esterna (#143). Fino a #143, dove i raccordi entravano nella
    // corsia interna e uscivano solo dall'esterna, da qui si usciva alla prima con una curva del gioco
    if (T) {
      const ok = opts.filter((m) => m.racs.some((R) => this.costo(T, R) < 100));
      if (ok.length) opts = ok;
    }
    // le vie principali attirano più traffico delle traverse; quasi nessuno entra nelle strade di servizio. Nell'anello
    // di una rotonda l'uscita si sceglie come all'ingresso: restare nell'anello pesa quanto le uscite che restano prima
    // di tornare dove si è entrati (T.giro), e lì non si resta. Prima l'anello, via principale, pesava 4 contro 1 di
    // una traversa: attorno alla rotonda di Via Bembo con Via Marinelli un'auto su dieci faceva più di un giro, e in una
    // rotonda di Via Salboro qualcuna ne faceva sei
    const giro = edge.roundabout ? (T && T.giro) || { nodo: fwd ? edge.a : edge.b } : null, qui = fwd ? edge.b : edge.a;
    let w = opts.map((m) => (!giro || !m.edge.roundabout ? pesoVia(m.edge) : qui === giro.nodo ? 0 : this.restanti(m.edge, m.fwd, giro.nodo)));
    if (!w.some((x) => x > 0)) w = opts.map((m) => pesoVia(m.edge));
    opts = opts.filter((_, i) => w[i] > 0);
    w = w.filter((x) => x > 0);
    let r = this.rnd() * w.reduce((a, b) => a + b, 0), k = 0;
    while (k < opts.length - 1 && (r -= w[k]) > 0) k++;
    return opts[k];
  }
  // il peso delle uscite dell'anello dalla fine dell'arco (e, fwd) in avanti, fino al nodo dove si è entrati
  restanti(e, fwd, nodo) {
    const memo = this._restanti || (this._restanti = new Map()), key = `${fwd ? e.id : -1 - e.id}:${nodo}`;
    if (memo.has(key)) return memo.get(key);
    let w = 0;
    for (let k = 0, a = e, f = fwd; k < 40 && (f ? a.b : a.a) !== nodo; k++) {
      let dopo = null;
      for (const m of this.movimenti(a, f)) {
        if (!m.edge.roundabout) w += pesoVia(m.edge);
        else if (!dopo && m.racs.some((R) => !R.via.length)) dopo = m;
      }
      if (!dopo) break;
      a = dopo.edge; f = dopo.fwd;
    }
    memo.set(key, w);
    return w;
  }
  // dove si è entrati nell'anello di una rotonda, dopo il movimento m dalla coda T (null fuori dall'anello): il nodo
  // dove comincia l'arco d'anello raggiunto, perché il raccordo d'ingresso può scavalcare archi corti e la fine
  // dell'arco da cui si arriva può non stare sull'anello
  giroDopo(T, m) {
    if (!m.edge.roundabout) return null;
    if (T.e.roundabout) return T.giro || { nodo: T.fwd ? T.e.a : T.e.b };
    return { nodo: m.racs[0].m };
  }
  // costo di prendere il raccordo R dalla corsia dove si è (T): cambi di corsia, e 100 se non c'è posto per farli
  costo(T, R) { return costoCambio(T.e, T.fwd, T.corsia, R.cda, curva(this.net, R).s0 - T.s, R_AUTO); }
  // il raccordo del movimento m dalla corsia dove si è (T), guardando anche la svolta dopo (m2): meno cambi di corsia,
  // tutti con posto
  scegli(T, m, m2) {
    let best = null, bc = Infinity;
    // nell'anello di una rotonda, a parità di cambi di corsia, la corsia più esterna, da cui si esce: entrando, e dentro
    // l'anello con i raccordi che passano alla corsia esterna (#143). Un'auto nella corsia interna senza la svolta dopo
    // già scelta girava finché non trovava un'uscita da lì
    const est = m.edge.roundabout ? corsie(m.edge, m.fwd).length - 1 : 0;
    for (const R of m.racs) {
      let c = this.costo(T, R) + 0.5 * (est - Math.min(R.ca, est));
      if (m2) {
        const T2 = { e: m.edge, fwd: m.fwd, s: curva(this.net, R).s1, corsia: R.ca };
        c += Math.min(...m2.racs.map((R2) => this.costo(T2, R2)));
      }
      if (c < bc) { bc = c; best = R; }
    }
    return best;
  }
  // allunga il percorso dell'auto fino a q = fino: dalla corsia dove finisce (c.coda) il movimento già scelto o uno
  // nuovo, poi il tratto di corsia fino al suo raccordo (con il cambio di corsia, se serve) e il raccordo. Il percorso si
  // sceglie in anticipo (calledAhead e covers guardano lungo il percorso) e una svolta più avanti: la corsia del raccordo
  // si sceglie anche per quella dopo. In fondo a una strada chiusa il percorso finisce (c.chiusa)
  estendi(c, fino) {
    const N = this.net.nodes;
    while (c.per.fine < fino && !c.chiusa) {
      const T = c.coda, sT = 2 * T.e.id + (T.fwd ? 0 : 1);
      if (c.viaggio && c.viaggio.perso) c.viaggio = null;
      // arrivo del viaggio (#116): dove finisce lo stato d'arrivo l'auto, lontano da chi guida, esce di scena (update);
      // il viaggio dopo comincia da lì
      if (c.fineViaggio === sT) { c.arriva = c.per.fine + Math.max(0, T.e.len - T.s); c.fineViaggio = null; }
      if (c.viaggio && c.viaggio.arrivo === sT && !c.route.length) this.cambiaViaggio(c);
      const m = c.route.length ? c.route.shift() : this.chooseNext(T.e, T.fwd, T, c.viaggio);
      if (!m) {
        const p = c.per.aggiungi(tratto(N, T.e, T.fwd, T.s, Math.max(T.s, T.e.len - 1), T.corsia, T.corsia, R_AUTO));
        this.lineeArresto(c, p);
        c.chiusa = true;
        break;
      }
      // la corsia del raccordo guarda anche la svolta dopo; se non è ancora scelta, la si sceglie dalla corsia dove il
      // raccordo arriva, tra quelle che non chiedono un cambio di corsia senza posto
      let R, rip = null, m2 = null;
      // con un viaggio (#116) prima la svolta dopo, verso l'arrivo, poi la corsia per farla: scegliendo prima la corsia la
      // svolta verso l'arrivo poteva non avere posto per il cambio di corsia, e l'auto girava in un anello vicino
      if (!c.route.length && c.viaggio) {
        if (c.viaggio.arrivo === 2 * m.edge.id + (m.fwd ? 0 : 1)) this.cambiaViaggio(c);
        if (c.viaggio) m2 = this.versoArrivo(m, c.viaggio, T);
      }
      if (c.route.length) R = this.scegli(T, m, c.route[0]);
      else if (m2) {
        c.route.push(m2);
        R = this.scegli(T, m, m2);
      } else {
        R = this.scegli(T, m, null);
        const m2 = this.chooseNext(m.edge, m.fwd, { e: m.edge, fwd: m.fwd, s: curva(this.net, R).s1, corsia: R.ca, giro: this.giroDopo(T, m) });
        if (m2) c.route.push(m2);
      }
      const L = curva(this.net, R).s0 - T.s;
      // il raccordo comincia prima di dove si è, o da una corsia che non si fa in tempo a prendere: una curva del gioco
      // dalla corsia e dal punto dove si è (src/world/inseguitore.js), contata
      if (L < -0.05 || costoCambio(T.e, T.fwd, T.corsia, R.cda, L, R_AUTO) >= 100) {
        rip = L < -0.05 ? 'raccordi sovrapposti' : 'cambio di corsia senza posto';
        this.conta(rip);
        R = ripiego(this.net, T.e, T.fwd, T.corsia, T.s, R.a, R.fout, R.ca, R.n, R.m);
      }
      const p = c.per.aggiungi(tratto(N, T.e, T.fwd, T.s, Math.max(T.s, R.g.s0), T.corsia, R.cda, R_AUTO, (t) => this.conta(t)));
      this.lineeArresto(c, p);
      const k = c.per.aggiungi(new Curva(this.net, R, R_AUTO));
      if (rip) k.ripiego = rip;
      c.coda = { e: m.edge, fwd: m.fwd, s: R.g.s1, corsia: R.ca, giro: this.giroDopo(T, m) };
    }
  }
  conta(tipo) { this.ripieghi[tipo] = (this.ripieghi[tipo] || 0) + 1; }
  // la svolta dopo il movimento m per chi ha il viaggio v: quella che arriva prima, senza guardare la corsia (la corsia
  // per farla la sceglie poi scegli). Con 60 s in più per le svolte che dalla corsia di adesso non si fanno, le auto
  // dirette alla porta di Via Sorio deviavano in un anello di strade laterali e lo riempivano. null se l'albero
  // dell'arrivo non è pronto o da lì non ci si arriva
  versoArrivo(m, v, T) {
    const D = this.domanda;
    let A = v.albero && v.albero.fatto ? v.albero : null;
    if (!A || A.fascia !== D.chiaveTempi) { const B = D.albero(v.arrivo); if (B) A = v.albero = B; }
    if (!A) return null;
    const s = 2 * m.edge.id + (m.fwd ? 0 : 1);
    // nell'anello di una rotonda, prima le svolte che dalla corsia dove si è si fanno senza un cambio di corsia che non
    // ci sta: chi non ha fatto in tempo a passare alla corsia esterna fa un altro giro, come chiunque (#143)
    const fattibile = T && m.edge.roundabout ? (m2) => m.racs.some((R) => this.costo(T, R) < 100
      && m2.racs.some((R2) => this.costo({ e: m.edge, fwd: m.fwd, s: curva(this.net, R).s1, corsia: R.ca }, R2) < 100)) : null;
    let best = null, bc = Infinity, ok = false;
    for (const m2 of this.movimenti(m.edge, m.fwd)) {
      const u = 2 * m2.edge.id + (m2.fwd ? 0 : 1);
      if (!(A.T[u] < Infinity)) continue;
      const f = !fattibile || fattibile(m2), c = D.costo(s, u, A);
      if ((f && !ok) || (f === ok && c < bc)) { bc = c; best = m2; ok = f; }
    }
    if (!best) v.perso = true;
    return best;
  }
  // il viaggio di c arriva (il prossimo stato è il suo arrivo): il viaggio dopo parte dalla zona d'arrivo, con una
  // destinazione per le probabilità dell'ora (#116)
  cambiaViaggio(c) {
    const v = c.viaggio;
    c.fineViaggio = v.arrivo;
    const n = v.d == null ? null : this.domanda.prossimo(v.d, this.rnd);
    c.viaggio = n ? { ...n, albero: null } : null;
  }
  // linee d'arresto dei semafori lungo il percorso: per il tratto di corsia p (verso il nodo p.to), la progressiva della
  // sua linea, anche se cade dentro il raccordo che comincia prima
  lineeArresto(c, p) {
    const sl = this.lights.stopOn(p.e, p.to);
    if (!sl) return;
    const s = p.e.len - sl.t;
    if (s >= p.sa - 0.5) c.ev.push({ q: p.q0 + (s - p.sa), sl });
  }
  // mette l'auto sul percorso (posa) e aggiorna dove sta: arco, verso e progressiva del centro sulla corsia; in un
  // raccordo c.turn dice su quale arco si esce e quanto manca (rest). Entrando nella corsia di un arco nuovo l'auto
  // sceglie la sua andatura
  segui(c) {
    const p = posa(c.per, c, ASSE);
    c.pz = p;
    if (p.tipo === 'corsia') {
      c.turn = null;
      if (c.edge !== p.e && c.vmax) {
        const zone = zoneOf(c.x, c.z);
        c.vmax = (zone === 0 || !p.e.main ? 9 : 14) * (0.9 + this.rnd() * 0.2);
      }
      c.edge = p.e; c.fwd = p.fwd; c.s = p.sa + (c.q - p.q0) + ASSE;
    } else {
      const R = p.R;
      if (!c.turn || c.turn.pz !== p) c.turn = { next: { edge: R.a, fwd: R.fout, node: this.net.nodes[R.m] }, len: p.len, pz: p, rest: 0 };
      c.turn.rest = p.q0 + p.len - c.q;
      if (R.da) { c.edge = R.da; c.fwd = R.fin; c.s = p.g.s0 + (c.q - p.q0) + ASSE; }
    }
  }
  // velocità per le curve davanti: nel raccordo √(ALAT · r), prima la frenata fin lì (FRENO)
  vCurva(c) {
    let v = Infinity;
    const P = c.per.pezzi;
    for (let i = c.per.indice(c.q); i < P.length; i++) {
      const p = P[i], D = p.q0 - c.q;
      if (D > 60) break;
      if (p.tipo !== 'raccordo' || !p.g.r || p.g.ang < 0.05) continue;
      const vc = Math.sqrt(ALAT * p.g.r);
      v = Math.min(v, D <= 0 ? vc : Math.sqrt(vc * vc + 2 * FRENO * D));
    }
    return v;
  }
  // quota dell'auto sopra il terreno nel suo punto: dall'arco su cui è alla sua progressiva; nel raccordo, tra i due
  // archi (quotaStrada di padova.js, come il disegno della strada)
  carHeight(c) {
    const p = c.pz;
    if (p && p.tipo === 'raccordo') return p.quota(c.q + ASSE - p.q0, c.x, c.z);
    return quotaStrada(c.edge, c.fwd ? c.s : c.edge.len - c.s, c.x, c.z);
  }
  // un'auto per le prove, sull'arco e (verso fwd) col centro a s metri dal nodo di partenza, che seguirà gli archi dati
  // ([{ edge }], anche quelli che un raccordo scavalca) e poi quelli che sceglie
  nuova(e, fwd, s, archi = []) {
    const route = [];
    let cur = [e, fwd], k = 0;
    while (k < archi.length) {
      const m = this.movimenti(cur[0], cur[1]).find((m) => [...m.racs[0].via, m.edge].every((x, j) => archi[k + j] && archi[k + j].edge === x));
      if (!m) break;
      route.push(m);
      k += m.racs[0].via.length + 1;
      cur = [m.edge, m.fwd];
    }
    const cs = corsie(e, fwd), corsia = route.length ? this.scegli({ e, fwd, s: s - ASSE, corsia: cs.length - 1 }, route[0], route[1]).cda : cs.length - 1;
    const c = this.nuovaAuto(e, fwd, s - ASSE, corsia, route);
    c.vmax = 9; c.color = new THREE.Color(CAR_COLORS[0]);
    this.estendi(c, 90);
    this.segui(c);
    return c;
  }
  // un'auto ferma nel raccordo delle auto da da ad a, che comincia al nodo n, a frazione t della curva; per le prove
  // (allunga falso: senza il percorso dopo, solo per sapere dove sta)
  inCurva(da, a, n, t, allunga = true) {
    const R = this.rac.at(n).find((R) => R.da === da && R.a === a && R.classi & AUTO);
    if (!R) return null;
    const g = curva(this.net, R), c = this.nuovaAuto(da, R.fin, g.s0 - 5, R.cda, []);
    c.per.aggiungi(tratto(this.net.nodes, da, R.fin, g.s0 - 5, g.s0, R.cda, R.cda, R_AUTO));
    const p = c.per.aggiungi(new Curva(this.net, R, R_AUTO));
    c.coda = { e: R.a, fwd: R.fout, s: g.s1, corsia: R.ca };
    c.q = p.q0 + p.len * t;
    c.vmax = 9; c.color = new THREE.Color(CAR_COLORS[0]);
    if (allunga) this.estendi(c, c.q + 90);
    this.segui(c);
    return c;
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
  // il percorso dell'auto da d0 a d1 m davanti al centro, lungo corsie e raccordi (non in linea retta). fn(d, x, z, dx,
  // dz, xs) per un punto ogni 1,5 m dei pezzi con incroci col tram vicini (xs); true per fermarsi, e lo restituisce. Nella
  // rotonda Rosetta Gagliardi i pezzi sono corti e curvi: 20 m in linea retta dopo la prossima svolta finivano fuori
  // dalla rotonda e non vedevano i binari di Viale della Pace, due archi più avanti
  along(car, d0, d1, ts, fn) {
    const q = this._q || (this._q = {}), per = car.per, qc = car.q + ASSE;
    this.estendi(car, qc + d1 + 2);
    const P = per.pezzi;
    for (let i = per.indice(qc + d0); i < P.length; i++) {
      const p = P[i], a = Math.max(p.q0, qc + d0), b = Math.min(p.q0 + p.len, qc + d1);
      if (p.q0 > qc + d1) break;
      if (b < a) continue;
      const xs = this.pezzoXs(p, ts);
      if (!xs.length) continue;
      for (let u = a; ; u = Math.min(b, u + 1.5)) {
        p.at(u - p.q0, q);
        if (fn(u - qc, q.x, q.z, q.dx, q.dz, xs)) return true;
        if (u >= b) break;
      }
    }
    return false;
  }
  // incroci col tram vicini a un pezzo del percorso: quelli della sua corsia, o degli archi del raccordo
  pezzoXs(p, ts) {
    if (p.xs) return p.xs;
    if (p.tipo === 'corsia') return (p.xs = this.tramXs(p.e, ts));
    const R = p.R, tutti = new Set();
    for (const e of [R.da, ...R.via, R.a]) if (e) for (const x of this.tramXs(e, ts)) tutti.add(x);
    return (p.xs = [...tutti]);
  }
  // metri dal muso al primo punto del percorso (AHEAD m lungo gli archi, anche in svolta) che taglia i binari di un
  // incrocio chiamato da un tram, o all'inizio dei primi binari se appena dopo c'è chi è fermo e l'auto non ci starebbe
  // (dove i binari sono subito dopo una svolta la regola di carGap, che guarda l'arco su cui l'auto si trova, non vale:
  // si entrava svoltando e ci si fermava sui binari in coda); Infinity se non serve fermarsi
  calledAhead(car, ts) {
    let enter = -1, exit = null, hit = Infinity;
    this.xChiamato = null;
    this.along(car, 2.1, 2.1 + AHEAD, ts, (d, px, pz, dx, dz, xs) => {
      let on = false;
      for (const x of xs) if (ts.cuts(x, px, pz, dx, dz)) { if (x.call && !ts.sulBinarioAuto(car, x)) { hit = d - 2.1; this.xChiamato = x; return true; } on = true; }
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

  // Il primo mezzo lungo il percorso dell'auto c (corsie e raccordi, #113), entro D m davanti al centro: altre auto,
  // pezzi dei bus automatici, il mezzo di chi gioca (pl: i suoi punti, con chi, v e h), i tram. Prima si guardava in
  // linea retta, 33 m davanti al muso: in curva e nelle rotonde si vedevano le auto della strada accanto e non quelle
  // della propria corsia dopo la svolta, e due auto in svolta si aspettavano a vicenda (#79). Il percorso si campiona
  // ogni 2 m con lo scostamento dell'auto (in sorpasso è l'altra corsia); un mezzo ci sta sopra se il suo punto è a meno
  // di `lat` m dall'asse: 1,7 m un'auto, 2,6 m un bus (i punti sono sul suo asse), per i tram come prima. Chi viene
  // incontro non conta, nemmeno fermo di sbieco. Dà { gap: dal muso alla sua coda, v: la sua velocità lungo il
  // percorso, o, tipo } o null
  // Con `fila` (un array) guarda fino a `lungo` m e ci mette tutti i mezzi trovati, uno per punto (gap, v, mezzo: i bus
  // e i tram ne danno più d'uno), per postoOltre (#148); il primo mezzo resta quello entro D, come senza
  davanti(c, D, ctx, pl, fila = null, lungo = 0) {
    const S = this._camp || (this._camp = new Float64Array(5 * 48)), Q = this._qd || (this._qd = {});
    // (l'asse della corsia, senza lo scostamento: per le auto della stessa corsia spostate di lato in un altro modo, #148)
    const A = this._asse || (this._asse = new Float64Array(2 * 48));
    const qc = c.q + ASSE;
    const Dv = D;
    D = Math.max(2, Math.min(Math.max(D, fila ? lungo : 0), c.per.fine - qc, 2 * 46));
    let n = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let u = 0; ; u = Math.min(D, u + 2)) {
      punto(c.per, qc + u, Q);
      const x = Q.x + Q.nx * c.lat, z = Q.z + Q.nz * c.lat, k = n * 5;
      S[k] = x; S[k + 1] = z; S[k + 2] = u; S[k + 3] = Q.dx; S[k + 4] = Q.dz;
      A[2 * n] = Q.x; A[2 * n + 1] = Q.z;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      if (u >= D) break;
    }
    // i tratti a blocchi di 8 col loro riquadro: chi è fuori dal riquadro di un blocco (più lim) non è più vicino di lim a
    // nessuno dei suoi tratti, e il blocco si salta. Lo stesso risultato di prima, con meno conti: con la fila fino a
    // 92 m (#148) i tratti sono 46
    const B = this._blocchi || (this._blocchi = new Float64Array(4 * 6)), nb = Math.ceil((n - 1) / 8);
    for (let j = 0; j < nb; j++) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 8 * j; i <= Math.min(8 * j + 8, n - 1); i++) {
        const x = S[i * 5], z = S[i * 5 + 1];
        if (x < a0) a0 = x; if (x > a1) a1 = x; if (z < b0) b0 = z; if (z > b1) b1 = z;
      }
      B[4 * j] = a0; B[4 * j + 1] = a1; B[4 * j + 2] = b0; B[4 * j + 3] = b1;
    }
    // il punto più vicino del percorso a (px, pz), entro lim m: progressiva dal centro e tangente lì
    const R = this._rd || (this._rd = {});
    const proietta = (px, pz, lim) => {
      if (px < x0 - lim || px > x1 + lim || pz < z0 - lim || pz > z1 + lim) return null;
      let bd = lim, bi = -1, bt = 0;
      for (let j = 0; j < nb; j++) {
        if (px < B[4 * j] - lim || px > B[4 * j + 1] + lim || pz < B[4 * j + 2] - lim || pz > B[4 * j + 3] + lim) continue;
        for (let i = 8 * j; i < Math.min(8 * j + 8, n - 1); i++) {
          const k = i * 5, ax = S[k], az = S[k + 1], ex = S[k + 5] - ax, ez = S[k + 6] - az, l2 = ex * ex + ez * ez;
          const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2)) : 0;
          const d = Math.hypot(px - ax - ex * t, pz - az - ez * t);
          if (d < bd) { bd = d; bi = i; bt = t; }
        }
      }
      if (bi < 0) return null;
      const k = bi * 5;
      R.u = S[k + 2] + (S[k + 7] - S[k + 2]) * bt; R.tx = S[k + 3]; R.tz = S[k + 4];
      return R;
    };
    // un'auto della stessa corsia, spostata di lato diversamente (lo scostamento cambia lungo la strada, fuori dai binari
    // del tram, tramShift: chi guarda col suo scostamento di adesso non la vede): il punto dell'asse della sua corsia
    // all'altezza del suo centro sta a meno di 1,7 m dall'asse della corsia dell'auto. Non in sorpasso (lì lo
    // scostamento è l'altra corsia). In Via Gozzi e in Via Piovese, col SIR3, le auto della coda non vedevano quelle
    // davanti nella stessa corsia, entravano negli incroci e ci restavano
    const Qa = this._qa || (this._qa = {});
    const inCorsia = (o) => {
      if (c.passT > 0 || o.passT > 0 || Math.abs(c.lat - o.lat) < 0.3) return null;
      punto(o.per, o.q + ASSE, Qa);
      // (l'asse sta entro |lat| dai punti campionati: i riquadri dei blocchi si allargano di tanto)
      const px = Qa.x, pz = Qa.z, lim = 1.7 + Math.abs(c.lat);
      let bd = 1.7, bi = -1, bt = 0;
      for (let j = 0; j < nb; j++) {
        if (px < B[4 * j] - lim || px > B[4 * j + 1] + lim || pz < B[4 * j + 2] - lim || pz > B[4 * j + 3] + lim) continue;
        for (let i = 8 * j; i < Math.min(8 * j + 8, n - 1); i++) {
          const ax = A[2 * i], az = A[2 * i + 1], ex = A[2 * i + 2] - ax, ez = A[2 * i + 3] - az, l2 = ex * ex + ez * ez;
          const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2)) : 0;
          const d = Math.hypot(px - ax - ex * t, pz - az - ez * t);
          if (d < bd) { bd = d; bi = i; bt = t; }
        }
      }
      if (bi < 0) return null;
      const k = bi * 5;
      R.u = S[k + 2] + (S[k + 7] - S[k + 2]) * bt; R.tx = S[k + 3]; R.tz = S[k + 4];
      return R;
    };
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, r = Math.hypot(x1 - x0, z1 - z0) / 2 + 3 + Math.abs(c.lat);
    let best = null;
    // (u: progressiva del punto dal centro dell'auto; il primo mezzo si cerca entro Dv)
    const tieni = (gap, v, o, tipo, u) => {
      if (fila) fila.push(gap, v, o);
      if (u <= Dv && (!best || gap < best.gap)) best = { gap, v, o, tipo };
    };
    let through = false;
    for (const o of this.grid.query(mx, mz, r, this._nd || (this._nd = []))) {
      if (o === c || !o.car) continue;
      const p = proietta(o.x, o.z, 1.7) || inCorsia(o);
      if (!p) continue;
      const cos = Math.sin(o.h) * p.tx + Math.cos(o.h) * p.tz;
      if (cos < -0.3) continue;
      // chi esce da un giro di attese (untangle) passa davanti all'auto che aspettava, finché non l'ha superata, anche se
      // sono unite
      if (o === c.through) { if (p.u <= Dv) through = true; continue; }
      // due auto una sopra l'altra nello stesso verso (si sono unite nello stesso punto, nella rotonda o in una svolta,
      // e nessuna ha l'altra davanti): passa quella nata prima, l'altra (se non le sta davanti) si ferma finché non si
      // sono separate. Restavano unite per sempre: le auto in coda sovrapposte di Corso Milano (#80), le pile
      // nell'anello di Via Bembo (#115). Non si cede a chi aspetta proprio noi: a Piazzale San Giovanni, con la densità
      // vera delle 8 (#116), la più giovane cedeva alla più vecchia, che la vedeva un metro davanti e la aspettava, e la
      // coda di Via Sorio restava ferma oltre dieci minuti
      if (p.u <= 0.5) {
        if (cos > 0.7 && o.n < c.n && o.aspetta !== c && (o.x - c.x) * Math.sin(c.h) + (o.z - c.z) * Math.cos(c.h) > -0.5) tieni(p.u - LUNGA, 0, o, 'auto', p.u);
        continue;
      }
      // tra due auto che svoltano verso lo stesso arco passa chi ha meno curva da fare (a Lion, entrando in Via Mascagni
      // da Via Sant'Andrea e dalla traversa, ognuna aveva l'altra davanti e restavano ferme per sempre)
      if (c.turn && o.turn && o.turn.next.edge === c.turn.next.edge && c.turn.rest < o.turn.rest) continue;
      // due auto su traiettorie che si tagliano, ognuna sul percorso dell'altra, e l'altra ferma ad aspettare questa:
      // passa subito chi ha l'altra più di lato (la regola di untangle, senza il secondo di fermo). In Via Piovese con
      // Via Pietro Orseolo il giro si formava o no per un soffio, sul Mac sì e in CI no (#115)
      if (cos < 0.5 && o.aspetta === c && c.v < 0.5) {
        const mio = Math.abs((o.x - c.x) * Math.cos(c.h) - (o.z - c.z) * Math.sin(c.h));
        const suo = Math.abs((c.x - o.x) * Math.cos(o.h) - (c.z - o.z) * Math.sin(o.h));
        if (mio > suo || (mio === suo && c.n < o.n)) continue;
      }
      tieni(p.u - LUNGA, o.v * Math.max(0, cos), o, 'auto', p.u);
    }
    if (!through) c.through = null;
    // i bus (automatici e di chi gioca) si guardano anche in sorpasso solo se non sono quelli sorpassati
    if (c.passT <= 0) {
      const big = (pts, who, h) => {
        for (const q of pts) {
          const p = proietta(q.x, q.z, 2.6);
          if (p && p.u > 0) tieni(p.u - 3.6, Math.abs(who.v) * Math.max(0, Math.sin(h) * p.tx + Math.cos(h) * p.tz), who, who.player ? 'giocatore' : 'bus', p.u);
        }
      };
      if (Math.abs(pl.x - mx) < r + 40 && Math.abs(pl.z - mz) < r + 40) big(pl.pts, pl.who, pl.h);
      for (const B of this.bigs) if (B.circles && Math.abs(B.x - mx) < r + 8 && Math.abs(B.z - mz) < r + 8) big(B.circles, B, B.h);
    }
    // i tram: chi passa davanti si aspetta, anche col muso già oltre l'incrocio o di sbieco contro; di chi viene
    // incontro sul binario accanto conta solo quello proprio davanti. Il tram fermo alla barra orizzontale non si
    // aspetta (si passa davanti al suo muso): conta solo se l'auto gli finirebbe addosso. Chi va nello stesso verso si
    // segue alla sua velocità
    if (ctx.trams) for (const q of ctx.trams.near(mx, mz, r)) {
      const tv = q.tram ? q.tram.v : 0;
      const pr = proietta(q.x, q.z, 2.6);
      if (!pr || pr.u <= 0) continue;
      const cos = Math.sin(q.h) * pr.tx + Math.cos(q.h) * pr.tz;
      // (prima di proiettare non si sa la tangente: si riprova con la fascia giusta)
      const lim = tv < 0.3 ? 1.4 : cos > -0.3 ? 2.6 : 1.6;
      if (lim < 2.6 && !proietta(q.x, q.z, lim)) continue;
      tieni(R.u - LUNGA, cos > 0.7 ? tv * cos : 0, q.tram || q, 'tram', R.u);
    }
    return best;
  }

  // l'incrocio davanti all'auto lungo il suo percorso (src/world/inseguitore.js), con la prossima linea d'arresto
  incrocioDavanti(c, qn, fino) { return incrocioDavanti(this.net, c.per, qn, fino, c.ev[0] ? c.ev[0].q : null); }

  // Dove si fermerà la fila oltre l'incrocio box, per l'auto c che può ancora decidere se entrarci (#148): metri dal suo
  // muso (qn) all'ostacolo che il muso avrà davanti a fila ferma, come `spazio`; Infinity se entro FILA m la fila non si
  // ferma. fila: i mezzi sul percorso fino a FILA m (davanti). Ogni mezzo fermo (sotto 1 m/s) è un punto dove la fila si
  // ferma, ogni mezzo che va si fermerà dove dice il suo `spazio` (se ce l'ha), e chi sta tra l'auto e quel punto ci si
  // mette in coda: 6,4 m un'auto, la sua lunghezza più 3 m un bus o un tram. La prima linea d'arresto oltre l'incrocio
  // ferma la fila col rosso e col giallo, e col verde se l'auto non la passa prima che finisca: i mezzi davanti passano
  // la linea quando ci arrivano da soli (accelerando come l'IDM, senza frenare) o SCARICO s dopo quello che la passa
  // prima, e chi non ci arriva entro il verde più un secondo di giallo resta in coda.
  // Prima si guardava solo chi c'era davanti, fino a 20 m più 4 s alla sua velocità, e il suo `spazio`, che passava da
  // un'auto all'altra: oltre quella distanza la fila sembrava libera, e un verde durava per sempre. In Via Gozzi le auto
  // entravano negli incroci delle traverse quando la fila si muoveva e restavano dentro quando il rosso, 40-100 m più
  // avanti, la fermava
  postoOltre(c, box, fila, qn, v0) {
    // i mezzi della fila: il punto più vicino e il più lontano di ognuno e la sua velocità lungo il percorso, dal più vicino
    const M = this._mezzi || (this._mezzi = []);
    let n = 0;
    for (let i = 0; i < fila.length; i += 3) {
      const g = fila[i], o = fila[i + 2];
      let k = 0;
      while (k < n && M[k].o !== o) k++;
      if (k < n) { M[k].g0 = Math.min(M[k].g0, g); M[k].g1 = Math.max(M[k].g1, g); continue; }
      const m = M[n] || (M[n] = {});
      m.o = o; m.g0 = m.g1 = g; m.v = Math.abs(fila[i + 1]);
      n++;
    }
    for (let i = 1; i < n; i++) for (let k = i; k > 0 && M[k].g0 < M[k - 1].g0; k--) { const t = M[k]; M[k] = M[k - 1]; M[k - 1] = t; }
    let posto = Infinity, coda = 0;
    for (let k = 0; k < n; k++) {
      const m = M[k], o = m.o, auto = !!o.car;
      // posto in coda: un'auto la sua lunghezza (più 20 cm) e 2 m; un bus o un tram dal punto più vicino al più lontano,
      // più la parte oltre l'ultimo punto, e 3 m
      m.coda = auto ? LUNGA + IDM_S0 : m.g1 - m.g0 + LUNGA + 3;
      const s0 = auto ? IDM_S0 : 3;
      const fine = m.v < 1 ? m.g0 : o.spazio != null && o.spazio < Infinity ? m.g0 + Math.max(0, o.spazio - s0) : Infinity;
      posto = Math.min(posto, fine - coda);
      coda += m.coda;
    }
    // la prima linea d'arresto oltre l'incrocio (come `ferma`: il muso si ferma un metro prima)
    let X = null;
    for (const e of c.ev) if (e.q >= box.q1 - 0.5) { X = e; break; }
    if (!X) return posto;
    const gX = X.q - qn + 1, ap = X.sl.ap, sig = ap.node.signal;
    if (gX >= posto) return posto;
    const verde = this.lights.verdeRestante(sig, ap.phase) + GIALLO_PASSA;
    // chi resta prima della linea: col rosso e col giallo tutti; col verde chi non la passa in tempo, dal più vicino
    let resta = 0, t = -Infinity;
    for (let k = n - 1; k >= 0; k--) {
      const m = M[k];
      if (m.g0 >= gX) continue;
      if (verde > GIALLO_PASSA) {
        t = Math.max(arrivo(gX - 1 - m.g1 - LUNGA, m.v, m.o.vmax || 9), t + SCARICO);
        if (t <= verde) continue;
      }
      resta += m.coda;
    }
    if (verde > GIALLO_PASSA && Math.max(arrivo(gX - 1, c.v, v0), t + SCARICO) <= verde) return posto;
    return Math.min(posto, gX - resta);
  }

  // Le auto che da un'altra corsia vanno nello stesso incrocio di c (box) verso la sua stessa corsia d'uscita e non sono
  // già nella fila davanti: quelle impegnate (ci entrano comunque) e quelle che ci arrivano prima di c (tra `tra`
  // secondi), che prendono posto prima di lei (#148). Due corsie che si uniscono nell'incrocio, o una traversa che
  // s'immette, non si vedono nella fila finché i percorsi non si toccano: in Via Gozzi le auto di Via Scrovegni e di Via
  // Trieste entravano insieme a quelle della coda, contando lo stesso posto, e una restava nell'incrocio. Chi arriva
  // prima passa prima: tra due che si aspettano a vicenda una ha sempre l'altra dopo
  immessi(c, box, fila, tra) {
    const R = box.R1, Q = this._qi || (this._qi = {});
    punto(c.per, (box.q0 + box.q1) / 2, Q);
    let n = 0;
    for (const o of this.near(Q.x, Q.z, (box.q1 - box.q0) / 2 + 30)) {
      const u = o.uscita;
      if (o === c || !o.car || !u || u.R0 === box.R0 || !(o.impegnata || o.traIncrocio < tra || (o.traIncrocio === tra && o.n < c.n))) continue;
      if (u.R1.a !== R.a || u.R1.fout !== R.fout || u.R1.ca !== R.ca) continue;
      let gia = false;
      for (let i = 2; i < fila.length && !gia; i += 3) gia = fila[i] === o;
      if (!gia) n++;
    }
    return n;
  }

  // l'arco ha la sede del tram a meno di 3 m dalla carreggiata (in memoria sull'arco)
  vicinoTram(e) {
    if (e.nearTram === undefined) {
      const A = this.net.nodes[e.a], q = this._qt || (this._qt = []);
      e.nearTram = false;
      for (let s = 0; s <= e.len + 8 && !e.nearTram; s += 8)
        e.nearTram = this.city.segGrid.query(A.x + e.dx * Math.min(s, e.len), A.z + e.dz * Math.min(s, e.len), e.width / 2 + TRAM_HW + 3, q).some((it) => it.kind === 'tram');
    }
    return e.nearTram;
  }
  // la strada OSM e il tracciato GTFS del tram non sempre combaciano: un'auto che invaderebbe la sede si sposta di lato
  // (lx, lz: verso sinistra; restituisce quanto, a sinistra) quanto basta per lasciare libero il binario, al massimo 3 m.
  // Si guardano i binari che corrono accanto (non quelli che tagliano la strada, su cui si passa), per verso: prima di
  // tutto si sta a 3 m da quello in controsenso, poi da quello nel proprio verso. Dove i due binari corrono nella
  // carreggiata (Via Gozzi, Via Morgagni e Ponte Omizzolo col SIR3, il controsenso sulla corsia di destra) l'auto si
  // allontanava dal binario più vicino, il suo, e finiva su quello del tram che le veniva incontro: si aspettavano a
  // vicenda finché l'auto spariva (#115)
  tramShift(c, x, z, lx, lz) {
    if (!this.vicinoTram(c.edge)) return 0;
    const fx = -lz, fz = lx, tracks = Object.values(this.city.tramTracks || {});
    const lontano = (px, pz) => {
      let stesso = 3, contro = 3;
      for (const T of tracks) for (const dir of [1, -1]) {
        const P = T.path(dir), pr = P.projectNear(px, pz, 3);
        if (!pr) continue;
        const a = P.at(pr.s), dot = a.dx * fx + a.dz * fz;
        if (Math.abs(dot) < 0.5) continue;
        if (dot > 0) stesso = Math.min(stesso, pr.d); else contro = Math.min(contro, pr.d);
      }
      return contro * 10 + stesso;
    };
    let best = 0, bv = lontano(x, z);
    if (bv >= 33) return 0;
    for (let o = -3; o <= 3; o += 0.5) {
      if (!o) continue;
      const v = lontano(x + lx * o, z + lz * o) - Math.abs(o) * 0.05;
      if (v > bv + 1e-6) { bv = v; best = o; }
    }
    return best;
  }

  update(dt, bus, ctx) {
    this.bigs = ctx.bigs || [];
    const playerBig = { player: true, v: bus.v, atStop: ctx.busAtStop };
    // popolazione attorno a chi guida (o al centro messo da una prova). Con la domanda (#116): quante auto e fin dove le
    // dice l'ora del gioco (ctx.clock, ctx.giorno) per quel posto, e quelle nuove nascono lungo i loro viaggi; i conti
    // lunghi (alberi) vanno avanti un passo alla volta
    const c0 = this.centro || bus, D = this.domanda;
    this.tempo = (this.tempo || 0) + dt;
    if (D) {
      if (ctx.clock != null) D.ora(ctx.clock, ctx.giorno);
      D.centro(c0.x, c0.z);
      D.passo();
      D.invecchia(dt);
      if (D.aggiorna(this.target)) { this.quante = Math.round(D.quante); this.raggio = D.R; }
    }
    const lontano = D ? this.raggio + 250 : 1700;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      // (le auto sonda delle prove, c.sonda, non escono per la distanza: tests/domanda.js)
      if ((!c.sonda && Math.hypot(c.x - c0.x, c.z - c0.z) > lontano) || c.overlapT > 2.5) this.cars.splice(i, 1);
    }
    let guard = 0;
    const n = D ? Math.min(this.target, this.quante) : this.target;
    if (D) while (this.cars.length < n && guard++ < 3) this.nasci(c0, this.cars.length < n * 0.5 ? 60 : Math.min(250, 0.6 * this.raggio));
    else while (this.cars.length < this.target && guard++ < 6) this.spawn(bus, this.cars.length < this.target * 0.5 ? 60 : 250, 1500);

    // griglia per ricerca vicini
    this.grid = new Grid(30);
    for (const c of this.cars) this.grid.insertAABB(c, c.x - 3, c.z - 3, c.x + 3, c.z + 3);
    // il mezzo di chi gioca: il bus (anche snodato) dà i suoi cerchi, il tram i punti lungo il convoglio
    const pl = {
      who: playerBig, x: bus.x, z: bus.z, h: bus.h,
      pts: bus.worldCircles ? bus.worldCircles() : bus.trackPoints ? bus.trackPoints() : [-4.9, -2.45, 0, 2.45, 4.9].map((lz) => ({ x: bus.x + Math.sin(bus.h) * lz, z: bus.z + Math.cos(bus.h) * lz })),
    };
    this.honks.length = 0;

    for (const c of this.cars) {
      c.far = Math.hypot(c.x - bus.x, c.z - bus.z) > 60; // il tram fermo dietro un'auto incastrata la fa sparire solo lontano
      // andatura: quella dell'auto, e nelle curve quella del raggio del raccordo, con la frenata prima
      const v0 = Math.min(c.vmax, this.vCurva(c));
      const qc = c.q + ASSE, qn = qc + MUSO;
      // l'incrocio davanti, entro 60 m, e il primo mezzo lungo il percorso, guardando fin oltre l'incrocio
      const box = this.incrocioDavanti(c, qn, 60);
      // chi può ancora fermarsi prima dell'incrocio con una frenata comoda (4 m/s²) decide se entrarci; negli ultimi 20 m
      // prima di non poterlo più fare guarda tutta la fila sul percorso (postoOltre, #148), prima solo chi ha davanti
      const prima = box ? box.q0 - qn - 0.3 : -1, frenata = (c.v * c.v) / 8;
      const decide = !!box && prima > 0 && prima >= frenata;
      const fila = decide && prima < frenata + 20 ? this._fila || (this._fila = []) : null;
      if (fila) fila.length = 0;
      const L = this.davanti(c, Math.max(20 + 4 * c.v, box ? box.q1 - qc + 12 : 0), ctx, pl, fila, FILA);
      // l'incrocio in cui l'auto è, o in cui entra comunque perché non fa più in tempo a fermarsi (impegnata): chi
      // s'immette nella stessa corsia d'uscita da un'altra corsia la conta (immessi)
      // (traIncrocio: tra quanti secondi ci arriva, a quell'andatura, se può ancora fermarsi)
      if (box) { c.uscita = box; c.impegnata = !decide; c.traIncrocio = prima / Math.max(c.v, 1); }
      else if (c.uscita) {
        if (qn - LUNGA > c.uscita.q1 || qn < c.uscita.q0 - 1) c.uscita = null;
        else c.impegnata = true;
      }
      const gapL = L ? L.gap : Infinity, vL = L ? L.v : Infinity;
      // IDM: l'accelerazione più bassa tra quella per chi c'è davanti e quelle per i punti dove fermarsi (fermi: Δv = v)
      // (v / v0)⁴ con le moltiplicazioni: Math.pow(x, 4) cambia all'ultimo bit tra arm64 e amd64 (idm, #145)
      const rv = c.v / Math.max(0.1, v0), rv2 = rv * rv;
      let acc = IDM_A * (1 - rv2 * rv2), ferma = Infinity;
      if (L) acc = idmAuto(c.v, v0, gapL, c.v - vL);
      // (perX: l'incrocio col tram per cui ci si ferma, se è il vincolo più vicino)
      let perX = null;
      const fisso = (s, x = null) => { if (s < ferma) { ferma = s; perX = x; } acc = Math.min(acc, idmAuto(c.v, v0, s, c.v)); };
      // incrocio con la sede del tram chiamato da un tram, o con la coda oltre: ci si ferma prima. Chi nell'incrocio
      // in fondo all'arco taglierebbe i binari di un incrocio chiamato si ferma alla linea (o a fine arco), anche col
      // verde: col verde lungo il binario (fase tram) chi svoltava, o andava dritto dove il binario curva (Via Belludi),
      // passava davanti al tram. Anche in svolta: nella rotonda i pezzi sono corti e un'auto passa quasi tutto il tempo
      // nelle curve, e da una curva entrava nell'altra fino ai binari
      if (ctx.tramSignals) {
        if (!c.turn) { const s = ctx.tramSignals.carGap(c, { s1: c.pz.sb + ASSE }, gapL, vL); if (s < Infinity) fisso(s, ctx.tramSignals.xGap); }
        // (3 m prima dei binari; chi c'è già sopra va avanti e li libera)
        const d = this.calledAhead(c, ctx.tramSignals);
        if (d > 0.5 && d < Infinity) fisso(Math.max(0, d - 3), this.xChiamato);
      }
      // semaforo: la prossima linea d'arresto lungo il percorso, col muso (2,1 m davanti al centro dell'auto), anche
      // prima dell'arco che entra nell'incrocio e anche se il raccordo comincia prima della linea
      while (c.ev.length && c.ev[0].q - qc - 2.3 < -0.3) c.ev.shift();
      let rosso = false, gialla = Infinity;
      if (c.ev.length) {
        const { sl, q } = c.ev[0], ap = sl.ap, st = this.lights.stateOf(ap.node.signal, ap.phase);
        const dist = q - qc - 2.3;
        if (dist < 120 && (st === 'R' || (st === 'Y' && dist > c.v * 1.2))) { fisso(dist + 1.2); rosso = dist < gapL + 15; } // IDM: ci si ferma 2 m prima
        // (per un incrocio prima della linea il giallo vale come il rosso: entrando ci si fermerebbe lì)
        else if (st === 'Y' && dist > 0) gialla = dist + 1.2;
      }
      // in fondo a una strada chiusa ci si ferma prima della fine del percorso (non per l'incrocio da liberare: lì
      // l'auto, lontano da chi guida, esce di scena; contato, la teneva ferma per sempre prima di un incrocio a pochi
      // metri dalla fine, ora che la regola vale anche senza nessuno davanti, #148)
      const fermaPrima = ferma;
      if (c.chiusa) fisso(c.per.fine - qc - 3);
      // spazio davanti al muso fino a dove ci si fermerà, lungo la fila (space till last standing, come in SUMO): con
      // chi c'è davanti fermo (o quasi, sotto 1 m/s), la distanza dalla sua coda; se va, anche i metri che farà ancora
      // prima di fermarsi (il suo `spazio`, dal suo passo): a 2 m da chi ha davanti lui, per un semaforo, i binari, la
      // fine della strada o un incrocio da liberare, e un bus o un tram alla fermata. Senza, quanto fa frenando
      const fermo = L && Math.abs(vL) < 1;
      const spazio = !L ? Infinity : fermo ? gapL : gapL + Math.max(0, (L.o.spazio ?? (vL * vL) / (2 * IDM_AUTO.b)) - IDM_S0);
      // una coda non entra in un incrocio che non può liberare (#115): se tra la fine dell'incrocio e dove si fermerà la
      // fila davanti (postoOltre: tutta la fila fino a 92 m, e il rosso che la fermerà, #148) non c'è posto per l'auto,
      // ci si ferma prima dell'incrocio, quando si fa in tempo con una frenata comoda (4 m/s²; se no si passa). Prima si
      // entrava e ci si fermava dentro, in mezzo a chi lo taglia
      let scatola = Infinity;
      if (decide) {
        let posto = spazio;
        if (fila) {
          posto = Math.min(posto, this.postoOltre(c, box, fila, qn, v0));
          if (posto < Infinity) posto -= this.immessi(c, box, fila, c.traIncrocio) * (LUNGA + IDM_S0);
        }
        if (qn + Math.min(posto, fermaPrima, gialla) - box.q1 < LUNGA + IDM_S0 + (fila ? MARGINE : 0.5)) {
          scatola = prima;
          acc = Math.min(acc, idmAuto(c.v, v0, prima, c.v));
        }
      }
      if (c.bump > 0) { acc = -8; c.overlapT = (c.overlapT || 0) + dt; c.bump = 0; }
      else c.overlapT = Math.max(0, (c.overlapT || 0) - dt * 0.5);
      acc = Math.max(-9, acc);
      c.v = Math.max(0, c.v + acc * dt);
      if (Math.min(gapL, ferma, scatola) < 0.2) c.v = 0;
      // chi si aspetta: l'auto davanti, se basta da sola a tenerla ferma (a meno di 2 m l'IDM non riparte, o ferma
      // prima dell'incrocio che lei occupa), e se a fermarla non c'è anche altro (un semaforo, i binari, la fine della
      // strada)
      c.spazio = Math.min(spazio, ferma, scatola);
      const perLei = Math.min(gapL, scatola);
      c.lead = L && L.tipo === 'auto' && (gapL < 2 || scatola < Infinity) ? L.o : null;
      // chi la tiene ferma, se è un mezzo (auto, bus, tram o chi gioca): per i bus automatici, che non fanno sparire
      // un'auto che non aspetta loro
      c.aspetta = L && c.v < 0.1 && perLei <= ferma ? L.o : null;
      // i tram che l'auto ferma aspetta, anche attraverso la coda: quelli che chiamano i binari davanti a cui si ferma, il
      // tram davanti, o quelli che aspetta l'auto davanti. Un tram fermo dietro di lei sul suo binario la fa sparire solo
      // se è tra questi (TramSim.move): in Via Tommaseo la coda verso la rotonda Graziana Campanato sta sul binario del
      // SIR2 in controsenso e aspetta i binari della rotonda chiamati proprio dal tram che ha davanti (#115)
      c.tramAttesi = c.v >= 0.1 ? null : c.aspetta ? (c.aspetta.mods ? [c.aspetta] : c.aspetta.car ? c.aspetta.tramAttesi || null : null) : perX ? perX.who : null;
      c.alone = perLei <= ferma;
      c.halt = c.v < 0.1 ? (c.halt || 0) + dt : 0;

      // bloccati da un bus fermo: clacson (solo col giocatore) e sorpasso. Si sorpassa il bus automatico in fermata e il
      // bus di chi gioca fermo in corsia fuori da un rosso (chi gioca non è nel modello: è un ostacolo, come un furgone
      // che scarica). Un bus automatico fermo fuori dalla fermata è in coda, al rosso o davanti ai binari, e si aspetta:
      // fino al 17 novembre dopo 12 s lo si sorpassava comunque, anche in coda al semaforo (#115)
      // (anche quando chi gioca è fermo appena oltre un incrocio, senza posto dietro di lui: si aspetta prima e poi si passa)
      const blocker = L && L.tipo !== 'auto' && L.tipo !== 'tram' && (gapL <= Math.min(ferma, scatola) || (L.o.player && scatola <= ferma)) ? L.o : null;
      if (blocker && c.v < 0.3 && Math.abs(blocker.v) < 0.5 && (blocker.atStop || (blocker.player && !rosso))) {
        c.blocked += dt;
        c.honkCd -= dt;
        if (blocker.player && c.blocked > 6 && c.honkCd <= 0 && !ctx.busAtStop) { this.honks.push(c); c.honkCd = 5 + this.rnd() * 5; }
        if (c.blocked > (blocker.atStop ? 1.5 : 5)) { c.passT = 9; c.blocked = 0; }
      } else c.blocked = Math.max(0, c.blocked - dt);
      if (c.passT > 0) c.passT -= dt;
      // di lato, a destra: il sorpasso a sinistra (3,2 m) e, sulle corsie, fuori dalla sede del tram dove la strada OSM
      // e il binario non combaciano (guardando anche 6 m avanti, per spostarsi prima)
      let bers = c.passT > 1.5 ? -3.2 : 0;
      if (!c.turn && this.vicinoTram(c.edge)) {
        // (ricalcolato ogni metro di strada)
        if (c.viaTram == null || Math.abs(c.q - c.viaTramQ) > 1 || c.viaTramB !== bers) {
          const Q = this._qs || (this._qs = {});
          let via = 0;
          for (const d of [0, 6]) {
            punto(c.per, c.q + ASSE + d, Q);
            const t = this.tramShift(c, Q.x + Q.nx * bers, Q.z + Q.nz * bers, -Q.nx, -Q.nz);
            if (Math.abs(t) > Math.abs(via)) via = t;
          }
          c.viaTram = via; c.viaTramQ = c.q; c.viaTramB = bers;
        }
        bers -= c.viaTram;
      } else c.viaTram = null;
      // avanzamento lungo il percorso (src/world/inseguitore.js): l'asse posteriore sul percorso, la direzione è la
      // tangente, lo scostamento cambia al più di K_LAT metri per metro
      const q0 = c.q;
      c.q = Math.min(c.q + c.v * dt, Math.max(c.q, c.per.fine - ASSE - 0.5));
      this.estendi(c, c.q + 90);
      scosta(c.per, c, bers, c.q - q0, A_LAT, K_LAT);
      this.segui(c);
      c.per.taglia(c.q - 2);
      // in fondo a una strada chiusa, lontano da chi guida, l'auto esce di scena (non fa inversione)
      if (c.chiusa && c.far && c.v < 0.3 && c.per.fine - c.q - ASSE < 5) { c.overlapT = 3; this.conta('fuori scena in fondo a una strada chiusa'); }
      if (D) {
        // arrivata alla fine del viaggio: lontano da chi guida esce di scena (ha parcheggiato), vicino fa il viaggio dopo
        if (c.arriva != null && c.q + ASSE >= c.arriva - 4) { if (c.far) { c.overlapT = 3; this.conta('arrivo'); } c.arriva = null; }
        // ritardi misurati (#116): il tempo che l'auto ha passato sullo stato da cui esce, oltre quello a rete libera
        if (!c.turn) {
          const st = 2 * c.edge.id + (c.fwd ? 0 : 1);
          if (st !== c.st) {
            if (c.st != null && c.t0 != null) D.segna(c.st, st, this.tempo - c.t0);
            c.t0 = c.st == null ? null : this.tempo;
            c.st = st;
          }
        }
      }
    }
    this.untangle();

    // istanze
    const { M, Q, Y, S, P } = this;
    this.cars.forEach((c, i) => {
      Q.setFromAxisAngle(Y, c.h);
      c.y = this.carHeight(c);
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
  // aspettavano in giro, e una era ferma anche prima dei binari perché oltre c'era un'altra delle tre. Il giro si segue
  // fino a 30 auto: dal 16 novembre (#113) le auto fanno le rotonde piccole sui raccordi, con il raggio vero e più
  // piano, e nella rotonda di Via Bembo con Via Marinelli l'anello si riempiva con un giro di 10 auto (si seguivano al
  // più 9)
  untangle() {
    for (const c of this.cars) {
      if (!c.lead || c.halt < 1) continue;
      const ring = [c];
      for (let o = c.lead; o !== c; o = o.lead) {
        if (!o || o.halt < 1 || ring.length > 29 || ring.includes(o)) { ring.length = 0; break; }
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
      M.compose(P.set(p.x, 0.1 + quotaStrada(p.e, p.s, p.x, p.z) + Math.abs(Math.sin(p.ph)) * 0.05, p.z), Q, S.set(p.sc, p.sc, p.sc));
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
  // il tram fermo col muso a s (di solito dov'è; arrivando in fermata, la fine della banchina) tiene chiamato un incrocio
  // con la strada (ci sta sopra col muso o con la cassa) o la lanterna appena passata, con le condizioni di
  // TramSignals.update per chi è in sosta: lì non si aspetta l'orario. Ci sono 25 fermate così, quasi tutte del SIR2:
  // aspettando l'anticipo il tram teneva il semaforo in fase tram, o fermava le auto, per più di un minuto
  onCrossing(tr, s = tr.s) {
    const S = this.signals;
    if (!S) return false;
    for (const x of S.list) for (const r of x.refs) if (r.track === tr.track && r.dir === tr.dir && r.sT - s > -(tr.L + x.halfT) && r.sT - s <= x.halfT) return true;
    for (const l of S.lanterns || []) if (l.track === tr.track && l.dir === tr.dir && l.sT - s > -8 && l.sT - s <= 0) return true;
    return false;
  }
  // qualcuno aspetta il tram fermo: un bus automatico che si è fermato per lui (waitTram, anche svoltando davanti al
  // muso: a Tito Livio), o sul suo binario un altro tram, un'auto, un bus o il mezzo di chi gioca dietro la coda nel
  // suo verso (entro 20 m, o fermo entro 50), o fermo entro 70 m davanti al muso e rivolto verso di lui. Dove il
  // binario corre nella carreggiata il tram che aspetta l'orario tiene fermo il traffico: a Tito Livio i bus dietro di
  // lui, a Ponti Romani quelli al semaforo 30 m dietro la coda (il bus non entra nell'incrocio senza 15 m di posto
  // oltre); all'Arcella, la sera, il tram dietro (una corsa che comincia a metà linea) aspettava oltre 90 s
  queued(tr, others) {
    const P = tr.track.path(tr.dir), m = P.at(tr.s);
    // progressiva dal muso lungo il binario e verso (1 lo stesso del tram, -1 l'opposto) di chi ci sta sopra
    const on = (x, z, h) => {
      if (Math.abs(x - m.x) > 90 || Math.abs(z - m.z) > 90) return null;
      const pr = P.projectNear(x, z, 3);
      if (!pr) return null;
      const d = P.at(pr.s);
      return { a: pr.s - tr.s, c: Math.sin(h) * d.dx + Math.cos(h) * d.dz };
    };
    const waits = (p, v) => !!p && ((p.c > 0.7 && p.a < 1 - tr.L && p.a > -tr.L - (v < 0.5 ? 50 : 20)) || (p.c < -0.7 && p.a > 0 && p.a < 70 && v < 0.5));
    for (const t2 of this.trams) {
      if (t2 === tr || !t2.parts.length || t2.rimessa) continue;
      const h = this.lanePoint(t2.s, t2.dir, t2.track);
      if (waits(on(h.x, h.z, Math.atan2(h.fx, h.fz)), t2.v)) return true;
    }
    for (const o of others) {
      if (!o) continue;
      if (o.isBus && o.bus.waitTram === tr && o.bus.v < 0.3) return true;
      if (o.isTram) {
        // il tram di chi gioca: il muso e il verso dai primi due punti sul binario
        const pts = o.trackPoints ? o.trackPoints() : [];
        if (pts.length > 1 && waits(on(pts[0].x, pts[0].z, Math.atan2(pts[0].x - pts[1].x, pts[0].z - pts[1].z)), Math.abs(o.v))) return true;
      } else if (waits(on(o.x, o.z, o.h), Math.abs(o.v || 0))) return true;
    }
    return false;
  }
  move(dt, others, clock) {
    const ended = [], turned = [], gone = [];
    for (const tr of this.trams) {
      // prossima fermata nel verso di marcia: il muso si ferma 12 m oltre la palina (fine banchina)
      let T = tr.track, P = T.path(tr.dir);
      let vt = 8.5;
      // metri dal muso a dove il tram si fermerà (fermata, segnale, chi ha davanti), per le auto che lo seguono (#115)
      let spazio = Infinity;
      if (tr.wait > 0) {
        tr.wait -= dt; vt = 0; spazio = 0;
        // in fermata ad aspettare l'orario (hold: i secondi oltre la sosta di 15 s): se dietro aspetta il traffico si
        // riparte finita la sosta, l'anticipo si recupera dopo
        if (tr.hold > 0 && (tr.holdT = (tr.holdT || 0) - dt) <= 0) {
          tr.holdT = 0.5;
          if (this.queued(tr, others)) { tr.wait = Math.max(0, tr.wait - tr.hold); tr.hold = 0; tr.cut = true; }
        }
        if (tr.wait <= 0) tr.hold = 0;
      }
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
        spazio = Math.max(0, d);
        // in linea alla velocità normale anche in anticipo sull'orario: l'anticipo si recupera in fermata, come per i bus
        // automatici. Prima si rallentava fino a 3 m/s per arrivare 15 s prima della partenza: a Largo Europa i tram
        // passavano le linee d'arresto a 3,8 m/s invece di 8,5 (mediane), e chi aspettava col rosso li vedeva passare a
        // passo d'uomo
        vt = Math.min(vt, Math.sqrt(2 * 0.9 * Math.max(0, d)) + 0.3);
        // sullo scambio del capolinea a 15 km/h; arrivando, se un altro tram fa la manovra ci si ferma prima della
        // comunicazione
        if (tr.esce) vt = Math.min(vt, 4);
        const t = tr.k === tr.run.ss.length - 1 && this.terminalOf(tr), lim = t && this.termLimit(t);
        if (t && tr.s > lim - 150 && this.termBusy(t, tr, others)) vt = Math.min(vt, lim - tr.s > 0.8 ? Math.sqrt(2 * 0.9 * (lim - tr.s)) + 0.3 : 0);
        if (d < 0.8) {
          if (tr.k >= tr.run.ss.length - 1) ended.push(tr);
          else {
            // in anticipo sull'orario si aspetta la partenza (al massimo 2 minuti, alla prima fermata fino all'ora), in
            // fermata comunque almeno 15 s. Alla penultima anche quanto serve per arrivare al capolinea 15 s prima
            // dell'orario, come quando si rallentava: i turni ci fanno stare al più due tram, e arrivando prima il terzo
            // restava davanti allo scambio. Dove il tram fermo sta sopra un incrocio l'orario non si aspetta, e l'attesa
            // finisce se dietro aspetta il traffico (move, queued): l'anticipo si recupera dopo
            const { ss, times } = tr.run, k = tr.k;
            let early = times[k] - clock;
            if (k === ss.length - 2) early = Math.max(early, times[k + 1] - 15 - clock - ((ss[k + 1] - ss[k]) / 8.5 + 7));
            tr.wait = Math.max(15, !k ? early : this.onCrossing(tr, ss[k]) ? 0 : Math.min(120, early));
            tr.hold = k ? tr.wait - 15 : 0;
            tr.cut = false;
            tr.k++;
          }
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
        if (d < 60) { vt = Math.min(vt, Math.sqrt(2 * 0.9 * Math.max(0, d - 0.5))); spazio = Math.min(spazio, Math.max(0, d)); }
      }
      // chi è sulla stessa corsia davanti, auto comprese: ci si ferma a distanza. Il mezzo del giocatore conta anche
      // appena a fianco del muso; un bus automatico solo se è tutto davanti al muso (quello accanto, anche solo in parte,
      // aspetta il tram che ha la precedenza: dove la corsia del bus sfiora il binario aspetterebbero tutti e due, per
      // sempre)
      const head = this.lanePoint(tr.s, tr.dir, T);
      const ahead = (o) => (o.x - head.x) * head.fx + (o.z - head.z) * head.fz;
      // conta solo chi è entro 40 m dal muso (il filtro sul quadrato nel ciclo sotto): gli altri si scartano subito, con
      // la stessa condizione. I bus accanto al muso si cercano entro 80 m, perché le parti di uno stesso bus distano
      // meno di 20 m: una parte entro i 40 m ha le altre lì. Esiti uguali a prima, con meno lavoro (#121)
      const fuori = (o, r) => Math.abs(o.x - head.x) > r || Math.abs(o.z - head.z) > r;
      const obst = [], beside = new Set();
      for (const o of others) if (o && o.isBus && !fuori(o, 80) && ahead(o) < 1.5) beside.add(o.bus);
      tr.ignoreBusT = Math.max(0, (tr.ignoreBusT || 0) - dt);
      for (const o of others) {
        // lontano dal giocatore i bus non guardano chi hanno davanti (nessuno li vede): nemmeno il tram guarda loro,
        // altrimenti aspetta dietro i bus alle fermate sul binario mentre gli altri bus gli passano attraverso
        if (!o || (o.isBus && (beside.has(o.bus) || tr.ignoreBusT > 0 || o.bus.near === false))) continue;
        if (o.isTram && o.trackPoints) for (const p of o.trackPoints()) obst.push({ p, min: -2 });
        else if (!fuori(o, 40)) obst.push({ p: o, min: -2, bus: o.isBus });
      }
      // gli altri tram contano se hanno il muso davanti al nostro (agli scambi cede chi arriva dietro); se ognuno vede
      // l'altro davanti (incroci a raso, rami che si uniscono) cede il tram entrato in servizio dopo
      for (const t2 of this.trams) {
        if (t2 === tr || !t2.parts.length || ahead(t2.parts[0]) < -0.5 || t2.parts.every((p) => fuori(p, 40))) continue;
        const h2 = this.lanePoint(t2.s, t2.dir, t2.track);
        if (t2.id > tr.id && (head.x - h2.x) * h2.fx + (head.z - h2.z) * h2.fz > -0.5 && Math.hypot(head.x - h2.x, head.z - h2.z) < 30) continue;
        for (const p of t2.parts) obst.push({ p, min: -2 });
      }
      // chi è davanti lo è lungo il binario (#115): a meno di 2,2 m dal binario, fino a 30 m davanti al muso. Prima si
      // guardava in linea retta davanti al muso, e dove il binario curva il tram vedeva davanti a sé le auto ferme
      // accanto ai binari ad aspettare proprio lui (Piazzetta Nievo, Corso Milano: #80, #89)
      let byBus = null, byCar = null;
      for (const { p: o, min, bus } of obst) {
        const rx = o.x - head.x, rz = o.z - head.z;
        if (Math.abs(rx) > 40 || Math.abs(rz) > 40) continue;
        let a;
        if (P.projectNear && o.car) {
          // un'auto c'è se la sua sagoma (muso, centro, coda) arriva a 1,9 m dal binario: metà tram più metà auto. Col
          // solo centro, un'auto ferma di traverso davanti ai binari era fuori, una accanto al binario dentro
          a = Infinity;
          for (const l of [2.1, 0, -2.1]) {
            const pr = P.projectNear(o.x + Math.sin(o.h) * l, o.z + Math.cos(o.h) * l, 1.9);
            if (pr) a = Math.min(a, pr.s - tr.s);
          }
          if (a === Infinity) continue;
        } else if (P.projectNear) {
          const pr = P.projectNear(o.x, o.z, ASSE_SUL_BINARIO);
          if (!pr) continue;
          a = pr.s - tr.s;
        } else {
          a = rx * head.fx + rz * head.fz;
          if (Math.abs(rx * -head.fz + rz * head.fx) >= ASSE_SUL_BINARIO) continue;
        }
        const v2 = Math.max(0, (a - 7) * 0.5);
        if (a > min && a < 30 && v2 < vt) { vt = v2; byBus = bus ? o.bus : null; byCar = o.car ? o : null; spazio = Math.min(spazio, Math.max(0, a - 7)); }
      }
      tr.spazio = spazio;
      // un'auto ferma sui binari si aspetta, come in coda (al rosso, dietro chi la precede). Se aspetta proprio questo
      // tram, anche attraverso la coda o i binari che lui ha chiamato (c.tramAttesi), il tram, che ha la precedenza, non
      // può aspettare lei: lontano dal giocatore sparisce. Fino al 17 novembre spariva dopo 20 s qualunque cosa
      // aspettasse, anche il verde (#115)
      tr.carT = byCar && tr.v < 0.1 ? (tr.carT || 0) + dt : 0;
      if (tr.carT > 1 && byCar.far && (byCar.aspetta === tr || (byCar.tramAttesi && byCar.tramAttesi.includes(tr)))) { byCar.overlapT = 3; tr.carT = 0; }
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
    this.city = city;
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
    this.buildHeads(scene, city);
  }
  // un segnale per incrocio, prima della strada: lanterna a tre luci in colonna (dall'alto barra orizzontale bianca = via
  // impedita, triangolo arancione = attenzione, barra verticale bianca = via libera); ne è accesa una sola, le altre si
  // vedono spente (lente scura, simbolo appena visibile, visiera). Cassa grigia con il pannello nero davanti; dietro una
  // calotta per luce, e il palo accanto con due staffe: chi arriva sull'altro binario vede il retro di una lanterna.
  // Prima la cassa era tutta nera sopra il palo e da dietro sembrava un segnale spento (a Voltabarozzo chi arriva al
  // capolinea l'ha davanti, sopra i binari, da 70 m fino all'attraversamento).
  // Palo, sbraccio o gancio al tirante della linea aerea stanno dove li ha messi la build (city.arredo; la regola è in
  // Posatore.lanterna, src/world/posa.js): lontano dal binario la lanterna sta su uno sbraccio sopra le corsie, alta
  // come le lanterne stradali a sbraccio (MAST_Y), appena fuori dalla sede
  buildHeads(scene, city) {
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
      const ang = Math.atan2(-p.dx, -p.dz), fx = Math.sin(ang), fz = Math.cos(ang), y0 = Y_ROAD + h;
      // palo (spot) o gancio al tirante della linea aerea (hang), dove li ha messi la build
      const { spot, hang } = city.arredo.lanterna(this, x, p, s, h);
      let px, pz, y;
      if (hang) {
        // gancio dal tirante alla cassa
        px = hang.x; pz = hang.z; y = hang.y - 0.25 - HH / 2;
        body.push(new THREE.BoxGeometry(0.05, 0.27, 0.05).translate(px, hang.y - 0.12, pz));
      } else {
        // ox, oz: dal binario verso il palo (l'asse x della cassa ruotata di ang); arm: lanterna sullo sbraccio, a
        // TRAM.lane + 0,6 m dal binario, altrimenti sul palo, 0,33 m verso il binario
        const ox = -p.dz * spot.side, oz = p.dx * spot.side, arm = spot.side > 0 && spot.o > 4;
        const inward = arm ? spot.o - (TRAM.lane + 0.6) : 0.33;
        px = spot.x - ox * inward; pz = spot.z - oz * inward; y = y0 + (arm ? MAST_Y + HH / 2 : Y0);
        const top = y + HH / 2 + 0.12;
        body.push(new THREE.CylinderGeometry(arm ? 0.09 : 0.05, arm ? 0.12 : 0.06, top - y0, 6).translate(spot.x, (top + y0) / 2, spot.z));
        if (arm) body.push(new THREE.BoxGeometry(0.08, 0.08, inward + 0.1).rotateY(Math.atan2(ox, oz)).translate(spot.x - (ox * inward) / 2, top - 0.06, spot.z - (oz * inward) / 2));
        else for (const k of [1, -1]) body.push(new THREE.BoxGeometry(0.16, 0.06, 0.08).rotateY(ang).translate(px + ox * 0.26, y + k * DY * 1.2, pz + oz * 0.26));
      }
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
      this.heads.push({ x, pos, ang, shown: null, pole: spot ? { x: spot.x, z: spot.z, h } : null });
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
  // inizio di una corsa: nessuna chiamata né via libera rimasti dalla corsa prima
  reset() {
    for (const x of this.list || []) { x.req = 0; x.call = false; x.state = 'H'; x.after = 0; x.prev.clear(); }
    for (const l of this.lanterns || []) { l.who = []; l.state = 'H'; l.prev.clear(); }
  }
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
  // Chi è già sul binario davanti al tram non aspetta la sua chiamata (#115): i punti pts (muso, centro e coda di
  // un'auto o di un bus) stanno sul binario di ogni tram che chiama l'incrocio x, entro 40 m davanti al suo muso. Il tram
  // aspetta loro, e loro vanno avanti e liberano il binario. Prima si fermavano prima dei binari chiamati, col tram
  // fermo dietro: sul Ponte Omizzolo, dove la corsia delle auto è sul binario del SIR3, nessuno dei due ripartiva più, e
  // dopo 20 s l'auto spariva (#89)
  davantiAiTram(x, pts) {
    if (!x.who || !x.who.length) return false;
    return x.who.every((w) => {
      if (!w.track || !w.track.path) return false;
      const P = w.track.path(w.dir), front = w.front ?? w.s;
      return pts.some((p) => { const pr = P.projectNear(p.x, p.z, 1.9); return pr && pr.s > front - 1 && pr.s < front + 40; });
    });
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
    this.xGap = null;
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
      if (((x.call && !(c.car && this.sulBinarioAuto(c, x))) || full) && dist > -0.5 && dist < 80 && Math.max(0, dist) < gap) { gap = Math.max(0, dist); this.xGap = x.call ? x : null; }
    }
    return gap;
  }
  // l'auto c sta sul binario davanti a ogni tram che chiama l'incrocio x: non lo aspetta (davantiAiTram)
  sulBinarioAuto(c, x) {
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    return this.davantiAiTram(x, [{ x: c.x + fx * 2.1, z: c.z + fz * 2.1 }, { x: c.x, z: c.z }, { x: c.x - fx * 2.1, z: c.z - fz * 2.1 }]);
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
