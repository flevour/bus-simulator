import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid, distToSeg, mulberry32 } from './spatial.js';
import { Y_ROAD, TRAM_HW, zoneOf, edgeHeight } from './city.js';
import { ledTexture } from './textures.js';
import { TRAM, tramLength, buildTramConvoy, setPantograph } from '../tram/tram.js';

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

export class TrafficLights {
  constructor(scene, net) {
    this.net = net;
    this.signals = [];
    const rnd = mulberry32(99);
    const rank = (e) => e.cls * 10 - Math.min(e.routes || 0, 9);
    // un incrocio grande (strade a carreggiate separate) occupa più nodi del grafo: un solo impianto per tutti
    for (const g of net.signals || guessSignals(net)) {
      const inside = new Set(g.nodes);
      const appr = [];
      for (const n of g.nodes)
        for (const e of n.edges) {
          // niente lanterna sui tratti interni all'incrocio, sulle vie pedonali e sui sensi unici in uscita
          if (e.ped || inside.has(net.nodes[e.a === n.id ? e.b : e.a]) || (e.oneway && (e.oneway === 1 ? e.b : e.a) !== n.id)) continue;
          const out = e.a === n.id ? { x: e.dx, z: e.dz } : { x: -e.dx, z: -e.dz };
          appr.push({ node: n, edge: e, out, ang: Math.atan2(out.z, out.x) });
        }
      if (!appr.length) continue;
      // fase 0: la strada principale e quelle allineate; fase 1: le trasversali (i semafori pedonali hanno solo la 0)
      const ref = appr.reduce((p, q) => (rank(q.edge) < rank(p.edge) ? q : p));
      for (const ap of appr) {
        let d = Math.abs(((ap.ang - ref.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI); // 0 = opposto, PI = stesso
        ap.phase = g.ped || d < Math.PI / 4 || d > (Math.PI * 3) / 4 ? 0 : 1;
      }
      // pedonale: verde lungo per i veicoli, poi il rosso mentre attraversano i pedoni
      const sig = { nodes: g.nodes, ped: g.ped, appr, offset: rnd() * 50, cycle: g.ped ? [28, 3, 1, 12, 0, 1] : [13, 3, 1, 10, 3, 1] };
      sig.total = sig.cycle.reduce((a, b) => a + b, 0);
      for (const n of g.nodes) n.signal = sig;
      this.signals.push(sig);
    }
    // pali e lanterne (instanced)
    const count = this.signals.reduce((a, s) => a + s.appr.length, 0);
    const poleG = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6).translate(0, 1.6, 0),
      new THREE.BoxGeometry(0.36, 1.05, 0.26).translate(0, 3.6, 0),
    ]);
    this.poles = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0x23272b }), count);
    const lampG = new THREE.CircleGeometry(0.12, 12);
    this.lamps = new THREE.InstancedMesh(lampG, new THREE.MeshBasicMaterial({ color: 0xffffff }), count * 3);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
    let i = 0, j = 0;
    for (const s of this.signals)
      for (const ap of s.appr) {
        const n = ap.node, e = ap.edge;
        const r = n.radius + 3.5;
        const inc = { x: -ap.out.x, z: -ap.out.z };
        const right = { x: -inc.z, z: inc.x };
        const x = n.x + ap.out.x * r + right.x * (e.width / 2 + 1.0);
        const z = n.z + ap.out.z * r + right.z * (e.width / 2 + 1.0);
        // la lanterna guarda verso il traffico in arrivo (direzione ap.out)
        const ang = Math.atan2(ap.out.x, ap.out.z);
        Q.setFromAxisAngle(Y, ang);
        M.compose(P.set(x, 0.1, z), Q, S);
        this.poles.setMatrixAt(i++, M);
        ap.lampIdx = j;
        for (let k = 0; k < 3; k++) {
          const lp = new THREE.Vector3(0, 3.95 - k * 0.33, 0.135).applyQuaternion(Q);
          M.compose(P.set(x + lp.x, 0.1 + lp.y, z + lp.z), Q, S);
          this.lamps.setMatrixAt(j++, M);
        }
        ap.pos = { x, z };
      }
    this.lamps.instanceMatrix.needsUpdate = true;
    this.poles.castShadow = true;
    scene.add(this.poles, this.lamps);
    this.time = 0;
    this._c = new THREE.Color();
    this.update(0);
  }

  stateOf(sig, phase) {
    // fase del tram (chiamata da un tram in arrivo): chi aveva il verde passa al giallo per 3 s, poi rosso per tutti
    if (sig.tramT > 0) {
      const base = this.cycleState(sig, phase);
      return sig.tramT < 3 && base !== 'R' ? 'Y' : 'R';
    }
    return this.cycleState(sig, phase);
  }
  cycleState(sig, phase) {
    let t = (this.time + sig.offset) % sig.total;
    const c = sig.cycle;
    // fasi: [A verde, A giallo, tutto rosso, B verde, B giallo, tutto rosso]
    let k = 0;
    while (t > c[k]) { t -= c[k]; k++; }
    if (phase === 0) return k === 0 ? 'G' : k === 1 ? 'Y' : 'R';
    return k === 3 ? 'G' : k === 4 ? 'Y' : 'R';
  }
  // stato per chi arriva al nodo percorrendo l'arco "edge"
  lightFor(node, edge) {
    const sig = node.signal;
    if (!sig) return 'G';
    const ap = sig.appr.find((a) => a.edge === edge && a.node === node);
    return ap ? this.stateOf(sig, ap.phase) : 'G'; // tratto interno all'incrocio: si libera l'incrocio
  }

  update(dt) {
    this.time += dt;
    const c = this._c;
    for (const s of this.signals)
      for (const ap of s.appr) {
        const st = this.stateOf(s, ap.phase);
        const cols = [st === 'R' ? 0xff2a1a : 0x2a0806, st === 'Y' ? 0xffb300 : 0x2a2006, st === 'G' ? 0x26ff6a : 0x062a10];
        for (let k = 0; k < 3; k++) this.lamps.setColorAt(ap.lampIdx + k, c.set(cols[k]));
      }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------
// Auto
// ------------------------------------------------------------------
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
  }

  setNight(f) {
    this.lightMat.color.setScalar(0.35 + f * 0.65);
  }

  laneGeom(car) {
    const e = car.edge, n = this.net.nodes;
    const from = car.fwd ? n[e.a] : n[e.b], to = car.fwd ? n[e.b] : n[e.a];
    const dx = car.fwd ? e.dx : -e.dx, dz = car.fwd ? e.dz : -e.dz;
    const off = e.oneway && e.width < 8 ? 0 : e.width / 4;
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
  // le auto non entrano nelle vie pedonali né nelle corsie riservate ai bus
  allowed(e, fwd) { return !e.ped && !e.psv && (!e.oneway || (e.oneway === 1) === fwd); }

  spawn(bus, minD = 120, maxD = 1400, cars = this.cars) {
    for (let tries = 0; tries < 12; tries++) {
      const e = this.randomEdgeNear(bus.x, bus.z, minD, maxD);
      if (!e) continue;
      const fwd = e.oneway ? e.oneway === 1 : this.rnd() < 0.5;
      const car = { edge: e, fwd, s: 0, v: 0, turn: null, id: Math.random() };
      const g = this.laneGeom(car);
      if (g.s1 - g.s0 < 3) continue;
      car.s = g.s0 + this.rnd() * (g.s1 - g.s0);
      car.y = e.elev ? edgeHeight(e, car.fwd ? car.s : e.len - car.s) : 0; // quota iniziale (sul cavalcavia o sotto)
      const x = g.sx + g.dx * car.s, z = g.sz + g.dz * car.s;
      const d = Math.hypot(x - bus.x, z - bus.z);
      if (d < minD || d > maxD) continue;
      if (cars.some((c) => Math.hypot(c.x - x, c.z - z) < 12)) continue;
      car.x = x; car.z = z; car.h = Math.atan2(g.dx, g.dz);
      const zone = zoneOf(x, z);
      car.vmax = (zone === 0 || !e.main ? 9 : 14) * (0.9 + this.rnd() * 0.2);
      car.v = car.vmax * 0.7;
      car.color = new THREE.Color(CAR_COLORS[Math.floor(this.rnd() * CAR_COLORS.length)]);
      car.blocked = 0; car.pass = 0; car.passT = 0; car.honkCd = 0; car.latOff = 0;
      cars.push(car);
      return car;
    }
    return null;
  }

  chooseNext(car) {
    const to = car.fwd ? this.net.nodes[car.edge.b] : this.net.nodes[car.edge.a];
    let opts = to.edges.filter((e) => e !== car.edge && this.allowed(e, e.a === to.id));
    if (!opts.length) opts = to.edges.filter((e) => !e.ped && !e.psv);
    if (!opts.length) opts = [car.edge];
    // le vie principali attirano più traffico delle traverse; quasi nessuno entra nelle strade di servizio
    const w = opts.map((e) => (e.main ? 4 : e.service ? 0.08 : e.cls === 6 ? 0.3 : 1));
    let r = this.rnd() * w.reduce((a, b) => a + b, 0), k = 0;
    while (k < opts.length - 1 && (r -= w[k]) > 0) k++;
    const e = opts[k];
    return { edge: e, fwd: e.a === to.id, node: to };
  }

  startTurn(car, g) {
    const nx = this.chooseNext(car);
    const next = { edge: nx.edge, fwd: nx.fwd, s: 0 };
    const g2 = this.laneGeom(next);
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
      p1 = nx.edge === car.edge ? { x: nx.node.x + g.dx * 6, z: nx.node.z + g.dz * 6 } : { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
    }
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) + Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const cosA = g.dx * g2.dx + g.dz * g2.dz;
    car.turn = { p0, p1, p2, len: Math.max(2, len * 0.92), t: 0, next: nx, s0: g2.s0, vmax: cosA > 0.8 ? car.vmax : 5.5 };
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
    const busCircles = [-4.9, -2.45, 0, 2.45, 4.9].map((lz) => ({ x: bus.x + Math.sin(bus.h) * lz, z: bus.z + Math.cos(bus.h) * lz }));
    this.honks.length = 0;

    for (const c of this.cars) {
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      let gap = 80;
      let v0 = c.turn ? c.turn.vmax : c.vmax;
      // auto davanti
      this.grid.query(c.x + fx * 15, c.z + fz * 15, 18, near);
      for (const o of near) {
        if (o === c) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (fwd > 0.5 && fwd < gap + 4.5 && lat < 1.7) {
          // evita stalli reciproci: ignora chi viene verso di noi
          const cosH = Math.cos(o.h - c.h);
          if (cosH < -0.3) continue;
          gap = Math.min(gap, fwd - 4.4);
        }
      }
      // il bus
      let busBlock = false;
      if (c.passT <= 0) {
        for (const p of busCircles) {
          const dx = p.x - c.x, dz = p.z - c.z;
          const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
          if (fwd > 0 && fwd < 40 && lat < 2.6) {
            const g = fwd - 3.6;
            if (g < gap) { gap = g; busBlock = true; }
          }
        }
      }
      // semaforo a fine arco
      const g = this.laneGeom(c);
      // incrocio con la sede del tram chiamato da un tram: ci si ferma prima
      if (!c.turn && ctx.tramSignals) gap = Math.min(gap, ctx.tramSignals.carGap(c, g));
      if (!c.turn) {
        const to = g.to;
        if (to.signal) {
          const st = this.lights.lightFor(to, c.edge);
          const dist = g.s1 - c.s;
          if (dist > 0.5 && (st === 'R' || (st === 'Y' && dist > c.v * 1.2))) gap = Math.min(gap, dist - 1.5);
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

      // bloccati dal bus fermo: clacson e sorpasso
      if (busBlock && c.v < 0.3 && Math.abs(bus.v) < 0.5) {
        c.blocked += dt;
        c.honkCd -= dt;
        if (c.blocked > 6 && c.honkCd <= 0 && !ctx.busAtStop) { this.honks.push(c); c.honkCd = 5 + this.rnd() * 5; }
        if (c.blocked > (ctx.busAtStop ? 1.5 : 5)) { c.passT = 9; c.blocked = 0; }
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
    // aggiorna griglia finale per collisioni con il bus
    this.grid = new Grid(30);
    for (const c of this.cars) this.grid.insertAABB(c, c.x - 3, c.z - 3, c.x + 3, c.z + 3);
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
// Tram SIR1 (Translohr): i convogli in servizio secondo l'orario, sulla sede tranviaria, con le fermate delle loro corse
// ------------------------------------------------------------------
// Viaggi dei tram dall'orario GTFS (giorno 'feriale' | 'festivo'). Il GTFS pubblica ogni viaggio anche spezzato in tratti
// (Guizza → Cavalletto, Stazione → Pontevigodarzere, Santo → Pontevigodarzere…) che si sovrappongono alla corsa intera:
// un tratto la cui prima e ultima fermata sono servite da una corsa più lunga, nello stesso verso, entro 3 minuti è lo
// stesso tram. Restano i viaggi veri: nei feriali 12-13 tram in servizio per quasi tutto il giorno.
export function tramRuns(lines, track, day) {
  const runs = [];
  for (const L of lines) for (const v of L.variants) {
    const dir = track.dirOf(v), P = track.path(dir);
    // progressiva del muso fermo a fine banchina (12 m oltre la palina), sempre crescente lungo la corsa
    const ss = [];
    for (const st of v.stops) ss.push(Math.max(ss.length ? ss[ss.length - 1] : -Infinity, P.project(st.x, st.z).s + 12));
    for (const { t, d } of v[day] || []) runs.push({ line: L, v, t, d, dir, ss, times: v.offsets.map((o) => t + (o * d) / v.duration) });
  }
  runs.sort((a, b) => a.t - b.t);
  const passAt = (c, st) => {
    let best = null, bd = 150;
    c.v.stops.forEach((s2, i) => { const d = Math.hypot(s2.x - st.x, s2.z - st.z); if (d < bd) { bd = d; best = c.times[i]; } });
    return best;
  };
  const near = (a, b) => a != null && Math.abs(a - b) <= 180;
  const covers = (c, k) => c !== k && c.dir === k.dir && c.v.stops.length > k.v.stops.length && c.t <= k.t + 180 && c.t + c.d >= k.t + k.d - 180 &&
    near(passAt(c, k.v.stops[0]), k.t) && near(passAt(c, k.v.stops[k.v.stops.length - 1]), k.t + k.d);
  let lo = 0;
  return runs.filter((k) => {
    while (runs[lo].t < k.t - 4000) lo++;
    for (let i = lo; i < runs.length && runs[i].t <= k.t + 180; i++) if (covers(runs[i], k)) return false;
    return true;
  });
}

export class TramSim {
  // tram automatici sulla sede: ognuno sulla corsia di destra del suo verso, fermate con il muso a fine banchina.
  // Con l'orario (setService) i tram sono quelli in servizio a quell'ora, ognuno sulla sua corsa; senza, opts.starts:
  // [[s del muso, verso], ...] che girano tra i capolinea. opts.modules: moduli del convoglio
  // track: binari per verso (TramTrack della città); s di ogni tram è lungo il binario del suo verso
  constructor(scene, net, opts = {}) {
    this.trams = [];
    this.track = opts.track;
    if (!this.track) return;
    this.modules = opts.modules || 3;
    this.L = tramLength(this.modules);
    this.stopsDir = { 1: this.track.stopsDir[1].map((p) => p.s), '-1': this.track.stopsDir[-1].map((p) => p.s) };
    this.catenaryAt = opts.catenaryAt || (() => true);
    this.scene = scene;
    this.reset(opts.starts);
  }
  // ricrea i tram automatici senza orario: girano tra i capolinea
  reset(starts) {
    this.runs = null;
    while (this.trams.length) this.remove(this.trams[0]);
    starts = starts || [[this.track.path(1).len * 0.25, 1], [this.track.path(-1).len * 0.3, -1]];
    for (const [s0, dir] of starts) this.add(s0, dir, dir > 0 ? 'Pontevigodarzere' : 'Guizza');
  }
  add(s, dir, dest) {
    const c = buildTramConvoy(this.scene, this.modules, 'SIR1', dest);
    const tr = { s, dir, v: 0, wait: 0, mods: c.mods, bellows: c.bellows, parts: [], served: null, panto: 1, run: null, k: 0 };
    this.trams.push(tr);
    return tr;
  }
  remove(tr) {
    for (const m of tr.mods) this.scene.remove(m.group);
    for (const b of tr.bellows) this.scene.remove(b);
    this.trams.splice(this.trams.indexOf(tr), 1);
  }
  // servizio dall'orario: day 'feriale' | 'festivo'; mine: corsa guidata dal giocatore { v, t }, che non ha un gemello
  // automatico (e nemmeno la corsa intera che la contiene)
  setService(lines, day, mine = null) {
    while (this.trams.length) this.remove(this.trams[0]);
    let runs = tramRuns(lines, this.track, day);
    if (mine) {
      const st0 = mine.v.stops[0], dir = this.track.dirOf(mine.v);
      runs = runs.filter((r) => r.dir !== dir || !r.v.stops.some((s, i) => Math.hypot(s.x - st0.x, s.z - st0.z) < 150 && Math.abs(r.times[i] - mine.t) <= 180));
    }
    this.runs = runs;
    this.lastClock = null;
  }
  destOf(run) { return run.v.headsign.replace(/ \(.*$/, ''); }
  // posizione che l'orario dà alla corsa all'ora clock (tra due fermate, in proporzione al tempo)
  spawnAt(run, clock) {
    const { times, ss } = run;
    let k = 0;
    while (k < times.length - 2 && times[k + 1] <= clock) k++;
    const f = Math.max(0, Math.min(1, (clock - times[k]) / Math.max(1, times[k + 1] - times[k])));
    const tr = this.add(ss[k] + (ss[k + 1] - ss[k]) * f, run.dir, this.destOf(run));
    tr.run = run; tr.k = k + 1; tr.v = f > 0 ? 6 : 0;
    run.tram = tr;
    return tr;
  }
  // tram in servizio a quell'ora: dopo un salto d'orario (avvio, teletrasporto) si ricompone tutto dall'orario
  schedule(clock) {
    const jump = this.lastClock == null || clock < this.lastClock - 1 || clock - this.lastClock > 60;
    if (jump) {
      while (this.trams.length) this.remove(this.trams[0]);
      for (const r of this.runs) r.tram = null;
      for (const r of this.runs) if (r.t <= clock && clock < r.t + r.d) this.spawnAt(r, clock);
    } else {
      // corse che partono ora senza un tram che le aspetti al capolinea: ne entra uno nuovo
      for (const r of this.runs) if (r.t > this.lastClock && r.t <= clock && !r.tram) this.spawnAt(r, clock);
    }
    this.lastClock = clock;
  }
  // fine corsa: al capolinea il tram prende la prossima corsa che parte da lì entro 20 minuti, altrimenti esce
  endRun(tr, clock) {
    const last = tr.run.v.stops[tr.run.v.stops.length - 1];
    let next = null;
    for (const r of this.runs) {
      if (r.tram || r.t < clock - 30 || r.t > clock + 1200) continue;
      const s0 = r.v.stops[0];
      if (Math.hypot(s0.x - last.x, s0.z - last.z) < 60 && (!next || r.t < next.t)) next = r;
    }
    if (!next) { this.remove(tr); return; }
    // cambio cabina: il muso diventa l'altra estremità, sul binario della nuova corsa
    const tail = this.track.path(tr.dir).at(tr.s - this.L);
    tr.dir = next.dir; tr.s = this.track.path(tr.dir).project(tail.x, tail.z).s;
    tr.run = next; tr.k = 1; tr.v = 0; tr.wait = Math.max(30, next.t - clock);
    next.tram = tr;
    this.setDest(tr, this.destOf(next));
  }
  lanePoint(s, dir) {
    const p = this.track.path(dir).at(s);
    return { x: p.x, z: p.z, fx: p.dx, fz: p.dz };
  }
  // clock: ora del gioco (secondi), per il servizio dall'orario
  update(dt, others = [], clock = null) {
    if (!Array.isArray(others)) others = [others];
    if (!this.runs || clock == null) { this.move(dt, others, null); return; }
    // con l'attesa accelerata in fermata l'orologio corre (x12): i tram la seguono a passi normali
    const cd = this.lastClock == null ? dt : clock - this.lastClock;
    this.schedule(clock);
    const n = cd > dt * 1.5 && cd < 60 ? Math.min(15, Math.round(cd / dt)) : 1;
    for (let i = 0; i < n; i++) this.move(dt, others, clock - (n - 1 - i) * dt);
  }
  move(dt, others, clock) {
    const ended = [];
    for (const tr of this.trams) {
      // prossima fermata nel verso di marcia: il muso si ferma 12 m oltre la palina (fine banchina)
      const P = this.track.path(tr.dir);
      let vt = 8.5;
      if (tr.wait > 0) { tr.wait -= dt; vt = 0; }
      else if (tr.run) {
        const d = tr.run.ss[tr.k] - tr.s;
        // in linea alla velocità che porta alla prossima fermata in orario (tra 11 e 30 km/h), arrivando 15 s prima
        // della partenza; in ritardo si va al massimo
        const left = tr.run.times[tr.k] - 15 - clock;
        if (left > 0) vt = Math.max(3, Math.min(8.5, d / left));
        vt = Math.min(vt, Math.sqrt(2 * 0.9 * Math.max(0, d)) + 0.3);
        if (d < 0.8) {
          if (tr.k >= tr.run.ss.length - 1) ended.push(tr);
          // in anticipo sull'orario si aspetta la partenza (al massimo 2 minuti); in fermata comunque almeno 15 s
          else { tr.wait = Math.max(15, Math.min(120, tr.run.times[tr.k] - clock)); tr.k++; }
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
      // segnale del tram a via impedita: si rallenta per fermarsi alla linea
      if (this.signals) {
        const d = this.signals.stopAhead(tr.s, tr.dir);
        if (d < 60) vt = Math.min(vt, Math.sqrt(2 * 0.9 * Math.max(0, d - 0.5)));
      }
      // chi è sulla stessa corsia davanti (bus, tram del giocatore, altri tram): ci si ferma a distanza
      const head = this.lanePoint(tr.s, tr.dir);
      const obst = [];
      for (const o of others) if (o) obst.push(...(o.isTram && o.trackPoints ? o.trackPoints() : [{ x: o.x, z: o.z }]));
      for (const t2 of this.trams) if (t2 !== tr) for (const p of t2.parts) obst.push(p);
      for (const o of obst) {
        const rx = o.x - head.x, rz = o.z - head.z;
        if (Math.abs(rx) > 60 || Math.abs(rz) > 60) continue;
        const ahead = rx * head.fx + rz * head.fz, lat = Math.abs(rx * -head.fz + rz * head.fx);
        if (lat < 2.2 && ahead > -2 && ahead < 30) vt = Math.min(vt, Math.max(0, (ahead - 7) * 0.5));
      }
      tr.v += Math.max(-2.5, Math.min(1.0, vt - tr.v)) * dt * 2;
      tr.v = Math.max(0, tr.v);
      tr.s += tr.v * dt;
      // al capolinea il guidatore cambia cabina: il muso diventa l'altra estremità, sul binario dell'altro verso
      if (tr.s >= P.len - 2) {
        if (tr.run) { tr.s = P.len - 2; tr.v = 0; if (!ended.includes(tr)) ended.push(tr); }
        else {
          const tail = P.at(tr.s - this.L);
          tr.dir *= -1; tr.s = this.track.path(tr.dir).project(tail.x, tail.z).s; tr.wait = 30; tr.v = 0; tr.served = null;
        }
      }
      // nel tratto senza linea aerea il pantografo si abbassa
      const pm = tr.mods[1];
      if (pm && pm.panto) {
        const want = this.track.wireAt(tr.dir, tr.s - (TRAM.cab + TRAM.gap + TRAM.mid / 2)) ? 1 : 0;
        tr.panto += Math.sign(want - tr.panto) * Math.min(Math.abs(want - tr.panto), dt / 4);
        setPantograph(pm.panto, tr.panto);
      }
      tr.parts.length = 0;
      let off = 0;
      tr.mods.forEach((m, k) => {
        const sa = tr.s - off, sb = sa - m.len;
        const a = this.lanePoint(sa, tr.dir), b = this.lanePoint(sb, tr.dir);
        const ha = this.track.heightAt(tr.dir, sa), hb = this.track.heightAt(tr.dir, sb);
        m.group.position.set((a.x + b.x) / 2, Y_ROAD + (ha + hb) / 2, (a.z + b.z) / 2);
        m.group.rotation.order = 'YXZ';
        m.group.rotation.y = Math.atan2(a.x - b.x, a.z - b.z);
        m.group.rotation.x = -Math.atan2(ha - hb, m.len);
        const h = m.group.rotation.y;
        for (const f of [0.15, 0.5, 0.85]) tr.parts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h, isTram: true, bump: 0 });
        if (k < tr.mods.length - 1) {
          const j = this.lanePoint(sb - TRAM.gap / 2, tr.dir);
          tr.bellows[k].position.set(j.x, Y_ROAD + 1.41 + hb, j.z);
          tr.bellows[k].rotation.y = h;
        }
        off += m.len + TRAM.gap;
      });
    }
    for (const tr of ended) this.endRun(tr, clock);
  }
  // indicatore di linea e destinazione sulle due cabine
  setDest(tr, dest) {
    for (const m of tr.mods) if (m.led) { m.led.material.map.dispose(); m.led.material.map = ledTexture('SIR1', dest); m.led.material.needsUpdate = true; }
  }
  // di notte fanali accesi in testa e luci rosse in coda
  setNight(f) {
    for (const tr of this.trams) {
      const head = tr.mods[0], tail = tr.mods[tr.mods.length - 1];
      if (head.headMat) { head.headMat.emissiveIntensity = f > 0.3 ? 2 : 0.2; head.tailMat.emissiveIntensity = 0; }
      if (tail.tailMat) { tail.tailMat.emissiveIntensity = f > 0.3 ? 0.9 : 0.05; tail.headMat.emissiveIntensity = 0; }
    }
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
export class TramSignals {
  constructor(scene, city, lights) {
    this.list = [];
    this.byEdge = new Map();
    this.violations = [];
    const T = city.tramTrack;
    if (!T) return;
    const q = [];
    // incroci a raso tra il binario di ogni verso e le strade
    for (const dir of [1, -1]) {
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
          if (this.list.some((x) => x.dir === dir && Math.abs(x.sT - sT) < 6)) continue;
          const x = {
            dir, e, tE, sT, px: a.x + (b.x - a.x) * t, pz: a.z + (b.z - a.z) * t,
            halfE: Math.min(10, (TRAM.lane + 0.6) / sinA), halfT: Math.min(14, (e.width / 2 + 1) / sinA),
            req: 0, state: 'H', after: 0, prev: new Map(),
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
      if (best) this.sigs.add(best);
    }
    this.buildHeads(scene, T);
  }
  // un segnale per incrocio, a destra del binario, prima della strada: lanterna a tre luci in colonna (dall'alto barra
  // orizzontale bianca = via impedita, triangolo arancione = attenzione, barra verticale bianca = via libera); ne è
  // accesa una sola, le altre si vedono spente (lente scura, simbolo appena visibile, visiera)
  buildHeads(scene, T) {
    const n = this.list.length;
    if (!n) return;
    const statics = [], lenses = [];
    const mk = (geo) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n); m.count = n; m.frustumCulled = false; scene.add(m); return m; };
    this.hBar = mk(new THREE.PlaneGeometry(0.24, 0.065));
    this.vBar = mk(new THREE.PlaneGeometry(0.065, 0.24));
    const tri = new THREE.Shape();
    tri.moveTo(-0.12, -0.09); tri.lineTo(0.12, -0.09); tri.lineTo(0, 0.11); tri.closePath();
    this.tri = mk(new THREE.ShapeGeometry(tri));
    this.heads = [];
    const Y0 = 3.25, DY = 0.36;
    for (const x of this.list) {
      const s = x.sT - (x.halfT + 3), P = T.path(x.dir), p = P.at(s), h = T.heightAt(x.dir, s);
      const px = p.x - p.dz * (TRAM.lane + 0.35), pz = p.z + p.dx * (TRAM.lane + 0.35), ang = Math.atan2(-p.dx, -p.dz);
      const fx = Math.sin(ang), fz = Math.cos(ang), y = Y_ROAD + h + Y0;
      statics.push(new THREE.CylinderGeometry(0.05, 0.06, y - DY * 1.5 - Y_ROAD - h, 6).translate(px, (y - DY * 1.5 + Y_ROAD + h) / 2, pz));
      statics.push(new THREE.BoxGeometry(0.42, DY * 3 + 0.1, 0.18).rotateY(ang).translate(px, y, pz));
      const pos = [];
      for (const k of [1, 0, -1]) {
        const ly = y + k * DY;
        lenses.push(new THREE.CircleGeometry(0.155, 20).rotateY(ang).translate(px + fx * 0.092, ly, pz + fz * 0.092));
        // visiera sopra ogni luce
        statics.push(new THREE.BoxGeometry(0.36, 0.025, 0.16).rotateY(ang).translate(px + fx * 0.16, ly + 0.17, pz + fz * 0.16));
        pos.push(new THREE.Vector3(px + fx * 0.096, ly, pz + fz * 0.096));
      }
      this.heads.push({ x, pos, ang, shown: null });
    }
    const box = new THREE.Mesh(mergeGeometries(statics), new THREE.MeshLambertMaterial({ color: 0x1b1d1f }));
    const lens = new THREE.Mesh(mergeGeometries(lenses), new THREE.MeshBasicMaterial({ color: 0x0b0c0d }));
    scene.add(box, lens);
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
  // occ: tram presenti [{ front (s lungo la sede), dir, len, v, dwell, player }]; cars: auto vicine per sapere se l'incrocio è sgombro
  update(dt, occ, traffic) {
    this.violations.length = 0;
    for (const sg of this.sigs) sg._call = false;
    for (const x of this.list) {
      let need = false;
      for (const o of occ) {
        if (o.dir !== x.dir) continue;
        const d = x.sT - o.front; // distanza del muso dall'incrocio lungo il binario (positiva se davanti)
        const on = d > -(o.len + x.halfT) && d <= x.halfT;
        const coming = d > x.halfT && d < 25 + o.v * 6 && !o.dwell;
        if (on || coming) need = true;
        // il tram del giocatore entra nell'incrocio con la barra orizzontale?
        if (o.player) {
          const pd = x.prev.get(o) ?? d;
          if (pd > x.halfT + 0.3 && d <= x.halfT + 0.3 && x.state === 'H' && o.v > 0.5) this.violations.push(x);
          x.prev.set(o, d);
        }
      }
      if (need) {
        x.req += dt;
        if (x.sig) x.sig._call = true;
        const busy = traffic && traffic.near(x.px, x.pz, 4.5).some((c) => !c.isTram && c.v > 0.2);
        // con un semaforo stradale: via libera solo dopo giallo e rosso per le auto
        const ready = x.sig ? x.sig.tramT > 4.5 : x.req > 2.5;
        if (x.state !== 'V' && ready && !busy) x.state = 'V';
        if (x.state === 'T') x.state = 'H';
        x.after = 0;
      } else {
        if (x.state === 'V') { x.state = 'T'; x.after = 0; }
        if (x.state === 'T' && (x.after += dt) > 2) x.state = 'H';
        x.req = 0;
      }
    }
    for (const sg of this.sigs) sg.tramT = sg._call ? (sg.tramT || 0) + dt : 0;
    this.drawHeads(false);
  }
  // le auto si fermano prima della sede se l'incrocio è chiamato da un tram
  carGap(c, g) {
    const xs = this.byEdge.get(c.edge);
    if (!xs) return Infinity;
    let gap = Infinity;
    for (const x of xs) {
      if (x.req <= 0) continue;
      // ci si ferma prima del primo binario che si incontra (anche se il tram arriva su quello più lontano)
      let pos = c.fwd ? x.tE : c.edge.len - x.tE, half = x.halfE;
      for (const y of xs) { const py = c.fwd ? y.tE : c.edge.len - y.tE; if (py < pos && pos - py < 14) { pos = py; half = y.halfE; } }
      const stop = Math.min(pos - half - 2.5, g.s1 - 0.3);
      const dist = stop - c.s;
      if (dist > -0.5 && dist < 80) gap = Math.min(gap, Math.max(0, dist));
    }
    return gap;
  }
  // per i tram automatici: distanza dalla prossima linea d'arresto a via impedita
  stopAhead(s, dir) {
    let best = Infinity;
    for (const x of this.list) {
      if (x.state === 'V' || x.dir !== dir) continue;
      const d = x.sT - (x.halfT + 1.5) - s;
      if (d > -0.5 && d < best) best = d;
    }
    return best;
  }
}
