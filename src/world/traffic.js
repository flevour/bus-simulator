import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid, mulberry32 } from './spatial.js';
import { Y_ROAD, zoneOf } from './city.js';

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
  constructor(scene, net) {
    this.line = (net.tram || [])[0] || [];
    this.trams = [];
    if (this.line.length < 2) return;
    const cum = [0];
    for (let i = 1; i < this.line.length; i++) cum.push(cum[i - 1] + Math.hypot(this.line[i].x - this.line[i - 1].x, this.line[i].z - this.line[i - 1].z));
    this.cum = cum;
    this.len = cum[cum.length - 1];
    // fermate proiettate sul tracciato
    this.stopS = [];
    for (const st of net.tramStops || []) {
      let best = 1e9, bs = 0;
      for (let i = 0; i < this.line.length - 1; i++) {
        const a = this.line[i], b = this.line[i + 1];
        const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((st.x - a.x) * ex + (st.z - a.z) * ez) / l2));
        const d = Math.hypot(st.x - a.x - ex * t, st.z - a.z - ez * t);
        if (d < best) { best = d; bs = cum[i] + Math.sqrt(l2) * t; }
      }
      if (best < 40) this.stopS.push(bs);
    }
    this.stopS.sort((a, b) => a - b);
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const body = lam(0xf2f2ee), red = lam(0xc8102e), glass = lam(0x1d2a33), roof = lam(0xb5b9bd);
    const modG = [new THREE.BoxGeometry(2.6, 2.1, 10.2).translate(0, 1.55, 0), new THREE.BoxGeometry(2.62, 0.5, 10.22).translate(0, 0.65, 0), new THREE.BoxGeometry(2.64, 1.1, 9.6).translate(0, 1.9, 0), new THREE.BoxGeometry(2.0, 0.35, 8).translate(0, 2.75, 0)];
    const mats = [body, red, glass, roof];
    for (const [s0, dir] of [[this.len * 0.25, 1], [this.len * 0.7, -1]]) {
      const modules = [];
      for (let k = 0; k < 3; k++) {
        const g = new THREE.Group();
        modG.forEach((geo, i) => { const m = new THREE.Mesh(geo, mats[i]); m.castShadow = true; g.add(m); });
        scene.add(g);
        modules.push(g);
      }
      this.trams.push({ s: s0, dir, v: 0, wait: 0, modules, parts: [], nextStop: null });
    }
  }
  at(s) {
    s = Math.max(0, Math.min(this.len, s));
    let i = 0;
    while (i < this.cum.length - 2 && this.cum[i + 1] < s) i++;
    const a = this.line[i], b = this.line[i + 1], l = this.cum[i + 1] - this.cum[i] || 1, t = (s - this.cum[i]) / l;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: Math.atan2(b.x - a.x, b.z - a.z) };
  }
  update(dt, bus) {
    for (const tr of this.trams) {
      // prossima fermata nella direzione di marcia
      const ahead = tr.dir > 0 ? this.stopS.find((x) => x > tr.s + 0.5) : [...this.stopS].reverse().find((x) => x < tr.s - 0.5);
      let vt = 8.5;
      if (tr.wait > 0) { tr.wait -= dt; vt = 0; }
      else if (ahead != null) {
        const d = Math.abs(ahead - tr.s);
        vt = Math.min(vt, Math.sqrt(2 * 0.9 * d) + 0.3);
        if (d < 1) { tr.wait = 18; tr.s = ahead + tr.dir * 1.2; }
      }
      // si ferma se il bus è sulla sede davanti
      const head = this.at(tr.s + tr.dir * 5);
      if (Math.hypot(bus.x - head.x, bus.z - head.z) < 14) {
        const f = (bus.x - head.x) * Math.sin(head.h) * tr.dir + (bus.z - head.z) * Math.cos(head.h) * tr.dir;
        if (f > -2) vt = 0;
      }
      tr.v += Math.max(-2.5, Math.min(1.0, vt - tr.v)) * dt * 2;
      tr.v = Math.max(0, tr.v);
      tr.s += tr.v * tr.dir * dt;
      if (tr.s >= this.len - 2 || tr.s <= 2) { tr.dir *= -1; tr.wait = 30; tr.s = Math.max(2.1, Math.min(this.len - 2.1, tr.s)); }
      tr.parts.length = 0;
      tr.modules.forEach((g, k) => {
        const p = this.at(tr.s - tr.dir * (5.3 + k * 10.7));
        g.position.set(p.x, 0.14, p.z);
        g.rotation.y = p.h + (tr.dir < 0 ? Math.PI : 0);
        for (const o of [-3.4, 0, 3.4]) tr.parts.push({ x: p.x + Math.sin(p.h) * o, z: p.z + Math.cos(p.h) * o, h: p.h, isTram: true, bump: 0 });
      });
    }
  }
  near(x, z, r) {
    const out = [];
    for (const tr of this.trams) for (const p of tr.parts) if (Math.abs(p.x - x) < r + 6 && Math.abs(p.z - z) < r + 6) out.push(p);
    return out;
  }
}
