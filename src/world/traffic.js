import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid, mulberry32 } from './spatial.js';
import { Y_ROAD, zoneOf } from './city.js';
import { TrackPath, TRAM, tramLength, buildTramConvoy, setPantograph, tramStopPlacements } from '../tram/tram.js';

// ------------------------------------------------------------------
// Semafori
// ------------------------------------------------------------------
export class TrafficLights {
  constructor(scene, net) {
    this.net = net;
    this.signals = [];
    const rnd = mulberry32(99);
    // semafori agli incroci tra vie molto percorse (almeno tre bracci con 4+ linee), a non meno di 90 m l'uno dall'altro
    const weight = (n) => n.edges.reduce((s, e) => s + e.routes, 0);
    const cand = Object.values(net.nodes)
      .filter((n) => n.edges.length >= 3 && !n.edges.some((e) => e.roundabout) && n.edges.filter((e) => e.cls <= 2 || e.routes >= 2).length >= 3 && Math.hypot(n.x + 150, n.z - 120) < 4800)
      .sort((a, b) => weight(b) - weight(a));
    const chosen = [];
    for (const n of cand) if (!chosen.some((k) => Math.hypot(k.x - n.x, k.z - n.z) < 90)) chosen.push(n);
    for (const n of chosen) {
      const appr = n.edges.map((e) => {
        const out = e.a === n.id ? { x: e.dx, z: e.dz } : { x: -e.dx, z: -e.dz };
        return { edge: e, out, ang: Math.atan2(out.z, out.x) };
      });
      const a0 = appr[0].ang;
      for (const ap of appr) {
        let d = Math.abs(((ap.ang - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI); // 0 = opposto, PI = stesso
        ap.phase = d < Math.PI / 4 || d > (Math.PI * 3) / 4 ? 0 : 1;
      }
      if (!appr.some((a) => a.phase === 1)) appr[appr.length - 1].phase = 1;
      const sig = { node: n, appr, offset: rnd() * 50, cycle: [13, 3, 1, 10, 3, 1] };
      sig.total = sig.cycle.reduce((a, b) => a + b, 0);
      n.signal = sig;
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
        const n = s.node, e = ap.edge;
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
    const ap = sig.appr.find((a) => a.edge === edge);
    return ap ? this.stateOf(sig, ap.phase) : 'G';
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
    const cand = arr.filter((it) => it.kind === 'road' && it.ref && !it.ref.ped && (!it.ref.service || this.rnd() < 0.15));
    return cand.length ? cand[Math.floor(this.rnd() * cand.length)].ref : null;
  }
  allowed(e, fwd) { return !e.ped && (!e.oneway || (e.oneway === 1) === fwd); }

  spawn(bus, minD = 120, maxD = 1400, cars = this.cars) {
    for (let tries = 0; tries < 12; tries++) {
      const e = this.randomEdgeNear(bus.x, bus.z, minD, maxD);
      if (!e) continue;
      const fwd = e.oneway ? e.oneway === 1 : this.rnd() < 0.5;
      const car = { edge: e, fwd, s: 0, v: 0, turn: null, id: Math.random() };
      const g = this.laneGeom(car);
      if (g.s1 - g.s0 < 3) continue;
      car.s = g.s0 + this.rnd() * (g.s1 - g.s0);
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
    if (!opts.length) opts = to.edges.filter((e) => !e.ped);
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
      M.compose(P.set(c.x, Y_ROAD + this.city.heightAt(c.x, c.z), c.z), Q, S);
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
  spawn(bus) {
    for (let k = 0; k < 10; k++) {
      const a0 = this.rnd() * Math.PI * 2, d0 = 40 + this.rnd() * 520;
      const arr = this.city ? this.city.segGrid.query(bus.x + Math.cos(a0) * d0, bus.z + Math.sin(a0) * d0, 60, this._re || (this._re = [])).filter((it) => it.kind === 'road' && it.ref) : [];
      if (!arr.length) continue;
      const e = arr[Math.floor(this.rnd() * arr.length)].ref;
      const A = this.net.nodes[e.a], B = this.net.nodes[e.b];
      const s = A.radius + this.rnd() * (e.len - A.radius - B.radius);
      const side = this.rnd() < 0.5 ? -1 : 1;
      const off = e.width / 2 + 1.2 + this.rnd() * 2.2;
      const x = A.x + e.dx * s - e.dz * side * off, z = A.z + e.dz * s + e.dx * side * off;
      const d = Math.hypot(x - bus.x, z - bus.z);
      if (d > 600 || d < 40) continue;
      const zone = zoneOf(x, z);
      if (zone === 2 && this.rnd() < 0.7) continue;
      const dir = this.rnd() < 0.5 ? 1 : -1;
      this.list.push({ e, s, side, off, dir, v: 1.1 + this.rnd() * 0.5, x, z, ph: this.rnd() * 6, col: new THREE.Color().setHSL(this.rnd(), 0.45, 0.25 + this.rnd() * 0.4), sc: 0.9 + this.rnd() * 0.2 });
      return;
    }
  }
  update(dt, bus) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (Math.hypot(p.x - bus.x, p.z - bus.z) > 700) { this.list.splice(i, 1); continue; }
      p.s += p.v * p.dir * dt;
      const A = this.net.nodes[p.e.a], B = this.net.nodes[p.e.b];
      if (p.s < A.radius || p.s > p.e.len - B.radius) p.dir *= -1;
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
// Tram SIR1 (Translohr): due convogli che percorrono la sede tranviaria e si fermano alle fermate
// ------------------------------------------------------------------
export class TramSim {
  // tram automatici sulla sede: ognuno sulla corsia di destra del suo verso, fermate con il muso a fine banchina.
  // opts.starts: [[s del muso, verso], ...]; opts.modules: moduli del convoglio
  constructor(scene, net, opts = {}) {
    this.trams = [];
    const line = (net.tram || [])[0];
    if (!line || line.length < 2) return;
    this.center = new TrackPath(line);
    this.len = this.center.len;
    this.modules = opts.modules || 3;
    this.L = tramLength(this.modules);
    // fermate per verso di marcia (le stesse banchine disegnate dalla città)
    const pl = tramStopPlacements(this.center);
    this.stopsDir = { 1: pl.filter((p) => p.sig > 0).map((p) => p.s), '-1': pl.filter((p) => p.sig < 0).map((p) => p.s) };
    this.catenaryAt = opts.catenaryAt || (() => true);
    this.scene = scene;
    this.reset(opts.starts);
  }
  // ricrea i tram automatici (es. a ogni corsa: col tram del giocatore resta solo quello del verso opposto)
  reset(starts) {
    for (const tr of this.trams) { for (const m of tr.mods) this.scene.remove(m.group); for (const b of tr.bellows) this.scene.remove(b); }
    this.trams = [];
    starts = starts || [[this.len * 0.25, 1], [this.len * 0.7, -1]];
    const scene = this.scene;
    for (const [s0, dir] of starts) {
      const c = buildTramConvoy(scene, this.modules, 'SIR1', dir > 0 ? 'Pontevigodarzere' : 'Guizza');
      this.trams.push({ s: s0, dir, v: 0, wait: 0, mods: c.mods, bellows: c.bellows, parts: [], served: null, panto: 1 });
    }
  }
  lanePoint(s, dir) {
    const p = this.center.at(s);
    return { x: p.x - p.dz * dir * TRAM.lane, z: p.z + p.dx * dir * TRAM.lane, fx: p.dx * dir, fz: p.dz * dir };
  }
  update(dt, others = []) {
    if (!Array.isArray(others)) others = [others];
    for (const tr of this.trams) {
      // prossima fermata nel verso di marcia: il muso si ferma 12 m oltre la palina (fine banchina)
      const stopAt = (x) => x + tr.dir * 12;
      const stops = this.stopsDir[tr.dir];
      const next = tr.dir > 0 ? stops.find((x) => stopAt(x) > tr.s + 0.5 && x !== tr.served) : [...stops].reverse().find((x) => stopAt(x) < tr.s - 0.5 && x !== tr.served);
      let vt = 8.5;
      if (tr.wait > 0) { tr.wait -= dt; vt = 0; }
      else if (next != null) {
        const d = Math.abs(stopAt(next) - tr.s);
        vt = Math.min(vt, Math.sqrt(2 * 0.9 * d) + 0.3);
        if (d < 0.8) { tr.wait = 18; tr.served = next; }
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
      tr.s += tr.v * tr.dir * dt;
      // al capolinea il guidatore cambia cabina: il muso diventa l'altra estremità
      if ((tr.dir > 0 && tr.s >= this.len - 2) || (tr.dir < 0 && tr.s <= 2)) {
        tr.s -= tr.dir * this.L; tr.dir *= -1; tr.wait = 30; tr.v = 0; tr.served = null;
      }
      // nel tratto senza linea aerea il pantografo si abbassa
      const pm = tr.mods[1];
      if (pm && pm.panto) {
        const want = this.catenaryAt(pm.group.position.x, pm.group.position.z) ? 1 : 0;
        tr.panto += Math.sign(want - tr.panto) * Math.min(Math.abs(want - tr.panto), dt / 4);
        setPantograph(pm.panto, tr.panto);
      }
      tr.parts.length = 0;
      let off = 0;
      tr.mods.forEach((m, k) => {
        const sa = tr.s - tr.dir * off, sb = sa - tr.dir * m.len;
        const a = this.lanePoint(sa, tr.dir), b = this.lanePoint(sb, tr.dir);
        m.group.position.set((a.x + b.x) / 2, Y_ROAD, (a.z + b.z) / 2);
        m.group.rotation.y = Math.atan2(a.x - b.x, a.z - b.z);
        const h = m.group.rotation.y;
        for (const f of [0.15, 0.5, 0.85]) tr.parts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h, isTram: true, bump: 0 });
        if (k < tr.mods.length - 1) {
          const j = this.lanePoint(sb - tr.dir * TRAM.gap / 2, tr.dir);
          tr.bellows[k].position.set(j.x, Y_ROAD + 1.41, j.z);
          tr.bellows[k].rotation.y = h;
        }
        off += m.len + TRAM.gap;
      });
    }
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
    const C = city.tramCenter;
    if (!C) return;
    const q = [];
    for (let i = 0; i < C.pts.length - 1; i++) {
      const a = C.pts[i], b = C.pts[i + 1];
      const tl = C.cum[i + 1] - C.cum[i];
      if (tl < 0.1) continue;
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
        if (this.list.some((x) => Math.abs(x.sT - sT) < 6)) continue;
        const x = {
          e, tE, sT, px: a.x + (b.x - a.x) * t, pz: a.z + (b.z - a.z) * t,
          halfE: Math.min(14, (3.4 + 0.6) / sinA), halfT: Math.min(14, (e.width / 2 + 1) / sinA),
          req: 0, state: 'H', after: 0, prev: new Map(),
        };
        this.list.push(x);
        if (!this.byEdge.has(e)) this.byEdge.set(e, []);
        this.byEdge.get(e).push(x);
      }
    }
    // incroci vicini a un semaforo stradale: la chiamata del tram mette l'incrocio in fase tram
    this.sigs = new Set();
    for (const x of this.list) {
      let best = null, bd = 35;
      for (const sg of (lights && lights.signals) || []) { const d = Math.hypot(sg.node.x - x.px, sg.node.z - x.pz); if (d < bd) { bd = d; best = sg; } }
      x.sig = best;
      if (best) this.sigs.add(best);
    }
    this.buildHeads(scene, C);
  }
  // un segnale per senso di marcia, a destra della corsia, prima dell'incrocio
  buildHeads(scene, C) {
    const n = this.list.length * 2;
    if (!n) return;
    const statics = [];
    const mk = (geo) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n); m.count = n; m.frustumCulled = false; scene.add(m); return m; };
    this.hBar = mk(new THREE.PlaneGeometry(0.3, 0.07));
    this.vBar = mk(new THREE.PlaneGeometry(0.07, 0.3));
    const tri = new THREE.Shape();
    tri.moveTo(-0.13, -0.1); tri.lineTo(0.13, -0.1); tri.lineTo(0, 0.12); tri.closePath();
    this.tri = mk(new THREE.ShapeGeometry(tri));
    this.heads = [];
    for (const x of this.list) for (const dir of [1, -1]) {
      const s = x.sT - dir * (x.halfT + 3);
      const p = C.at(s), rx = -p.dz * dir, rz = p.dx * dir;
      const px = p.x + rx * 3.75, pz = p.z + rz * 3.75, ang = Math.atan2(-p.dx * dir, -p.dz * dir);
      statics.push(new THREE.CylinderGeometry(0.05, 0.06, 3.0, 6).translate(px, Y_ROAD + 1.5, pz));
      statics.push(new THREE.BoxGeometry(0.5, 0.62, 0.16).rotateY(ang).translate(px, Y_ROAD + 3.1, pz));
      const fx = Math.sin(ang), fz = Math.cos(ang);
      this.heads.push({ x, dir, pos: new THREE.Vector3(px + fx * 0.085, Y_ROAD + 3.1, pz + fz * 0.085), ang, shown: null });
    }
    const box = new THREE.Mesh(mergeGeometries(statics), new THREE.MeshLambertMaterial({ color: 0x1b1d1f }));
    scene.add(box);
    this.box = box;
    this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.Z = new THREE.Vector3(0, 0, 0); this.O = new THREE.Vector3(1, 1, 1);
    this.drawHeads(true);
  }
  drawHeads(force) {
    if (!this.heads) return;
    let dirty = false;
    this.heads.forEach((hd, i) => {
      const st = hd.x.state;
      if (!force && hd.shown === st) return;
      hd.shown = st; dirty = true;
      this.Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hd.ang);
      for (const [mesh, on] of [[this.hBar, st === 'H'], [this.vBar, st === 'V'], [this.tri, st === 'T']]) {
        this.M.compose(hd.pos, this.Q, on ? this.O : this.Z);
        mesh.setMatrixAt(i, this.M);
      }
    });
    if (dirty) for (const m of [this.hBar, this.vBar, this.tri]) m.instanceMatrix.needsUpdate = true;
  }
  // occ: tram presenti [{ front (s lungo la sede), dir, len, v, dwell, player }]; cars: auto vicine per sapere se l'incrocio è sgombro
  update(dt, occ, traffic) {
    this.violations.length = 0;
    for (const sg of this.sigs) sg._call = false;
    for (const x of this.list) {
      let need = false;
      for (const o of occ) {
        const d = (x.sT - o.front) * o.dir; // distanza del muso dall'incrocio (positiva se davanti)
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
      const pos = c.fwd ? x.tE : c.edge.len - x.tE;
      const stop = Math.min(pos - x.halfE - 2.5, g.s1 - 0.3);
      const dist = stop - c.s;
      if (dist > -0.5 && dist < 80) gap = Math.min(gap, Math.max(0, dist));
    }
    return gap;
  }
  // per i tram automatici: distanza dalla prossima linea d'arresto a via impedita
  stopAhead(s, dir) {
    let best = Infinity;
    for (const x of this.list) {
      if (x.state === 'V') continue;
      const d = (x.sT - dir * (x.halfT + 1.5) - s) * dir;
      if (d > -0.5 && d < best) best = d;
    }
    return best;
  }
}
