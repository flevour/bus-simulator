import * as THREE from 'three';
import { buildRoute, pointAt, projectOnRoute } from './routes.js';
import { personGeometry } from '../world/traffic.js';
import { zoneOf } from '../world/city.js';
import { fmtHM } from '../data/padova.js';
import { mulberry32, angleDiff } from '../world/spatial.js';
import { BUS } from '../bus/bus.js';

// Persone alle fermate (in attesa / che salgono / che scendono)
class Crowd {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(personGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 160);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.people = [];
    this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.Y = new THREE.Vector3(0, 1, 0); this.S = new THREE.Vector3(1, 1, 1); this.P = new THREE.Vector3();
  }
  add(p) { this.people.push(p); return p; }
  update(dt) {
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (p.target) {
        const dx = p.target.x - p.x, dz = p.target.z - p.z, d = Math.hypot(dx, dz);
        const step = p.speed * dt;
        if (d <= step) { p.x = p.target.x; p.z = p.target.z; const cb = p.onArrive; p.target = null; p.onArrive = null; cb && cb(p); }
        else { p.x += (dx / d) * step; p.z += (dz / d) * step; p.h = Math.atan2(dx, dz); p.ph += dt * 8; }
      }
      if (p.life != null) { p.life -= dt; if (p.life <= 0) p.dead = true; }
      if (p.dead) this.people.splice(i, 1);
    }
    const { M, Q, Y, S, P } = this;
    const n = Math.min(this.people.length, 160);
    for (let i = 0; i < n; i++) {
      const p = this.people[i];
      Q.setFromAxisAngle(Y, p.h);
      M.compose(P.set(p.x, 0.1 + (p.target ? Math.abs(Math.sin(p.ph)) * 0.05 : 0), p.z), Q, S.setScalar(p.sc));
      this.mesh.setMatrixAt(i, M);
      this.mesh.setColorAt(i, p.col);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.people.length = 0; this.mesh.count = 0; }
}

export class Mission {
  // route: variante GTFS (nodi, fermate, tempi); day: 'feriale' | 'festivo'; departure: secondi; depDur: durata reale della corsa
  constructor({ scene, net, line, route, day, departure, depDur, hud, audio, lights, city, free = false }) {
    this.free = free;
    const variant = day;
    this.net = net; this.line = line; this.variant = day; this.routeData = route; this.hud = hud; this.audio = audio; this.lights = lights; this.city = city;
    this.route = buildRoute(net, route);
    this.stops = this.route.stops;
    this.dest = this.stops[this.stops.length - 1].name;
    this.departure = departure;
    this.clock = departure - 25; // poco prima della partenza
    this.rnd = mulberry32(Math.floor(departure) + line.id.length * 31);
    this.crowd = new Crowd(scene);
    this.onboard = []; // indici fermata di destinazione
    this.score = 0;
    this.log = [];
    this.stats = { boarded: 0, alighted: 0, onTime: 0, late: 0, early: 0, skipped: 0, crashes: 0, redLights: 0, speeding: 0, sidewalk: 0, comfortSum: 0, comfortN: 0, indicatorsOk: 0 };
    this.comfort = 100;
    this.nextStop = 0; // la 0 è il capolinea di partenza
    this.s = 0;
    this.request = false;
    this.cool = {};
    this.state = 'service';
    this.lastSigDist = new Map();
    this.offRouteT = 0;
    this.departedFrom = -1;
    this.leaveCheck = null;
    this.finished = false;

    // orari
    const hour = (departure / 3600) % 24;
    const peak = isPeak(hour);
    const times = scheduleFor(route, departure, depDur);
    this.stops.forEach((st, i) => {
      st.sched = times[i];
      st.served = false;
      st.waiting = [];
      st.spawned = false;
    });
    const dayF = variant === 'festivo' ? 0.55 : 1;
    const hourF = hour < 6 ? 0.35 : peak ? 1.7 : hour < 20 ? 1 : hour < 22 ? 0.6 : 0.35;
    this.demand = dayF * hourF;
    this.timetable = this.stops.map((s) => ({ name: s.name, time: fmtHM(s.sched) }));
  }

  // numero di persone in attesa a una fermata
  rollWaiting(st) {
    if (st.idx === this.stops.length - 1) return 0;
    const base = [0, 0.8, 2.2, 4.5][st.importance] || 1;
    let n = Math.round((base + this.rnd() * 3) * this.demand + (st.idx === 0 ? 3 : 0));
    if (this.rnd() < 0.18) n = 0;
    return Math.max(0, Math.min(18, n));
  }

  spawnStopPeople(st) {
    st.spawned = true;
    const n = this.rollWaiting(st);
    for (let i = 0; i < n; i++) {
      const along = -1 - this.rnd() * 7, back = 0.5 + this.rnd() * 1.6;
      const p = this.crowd.add({
        x: st.x + st.dx * along + st.rx * back,
        z: st.z + st.dz * along + st.rz * back,
        h: Math.atan2(-st.rx, -st.rz) + (this.rnd() - 0.5) * 1.5,
        ph: 0, speed: 1.3 + this.rnd() * 0.4, sc: 0.85 + this.rnd() * 0.25,
        col: new THREE.Color().setHSL(this.rnd(), 0.45, 0.25 + this.rnd() * 0.4),
        dest: this.pickDest(st.idx),
      });
      if (this.rnd() < 0.14) { p.elderly = true; p.speed = 0.7; p.sc = 0.82; p.col = new THREE.Color(0x8a8a8a); }
      st.waiting.push(p);
    }
  }
  pickDest(fromIdx) {
    const cand = [];
    // la maggior parte dei viaggi dura qualche fermata; le fermate importanti attirano di più
    for (let j = fromIdx + 1; j < this.stops.length; j++) {
      const w = (j === this.stops.length - 1 ? 2.5 : this.stops[j].importance) * Math.exp(-(j - fromIdx) / 10);
      cand.push([j, w]);
    }
    const tot = cand.reduce((a, c) => a + c[1], 0);
    let r = this.rnd() * tot;
    for (const [j, w] of cand) { r -= w; if (r <= 0) return j; }
    return this.stops.length - 1;
  }

  addScore(pts, msg, kind = pts >= 0 ? 'good' : 'bad') {
    this.score += pts;
    this.log.push({ pts, msg, t: this.clock });
    this.hud.toast((pts > 0 ? '+' : '') + (pts !== 0 ? pts + '  ' : '') + msg, kind);
    if (pts > 0) this.audio.good(); else if (pts < 0) this.audio.bad();
  }
  cooldown(key, t) {
    const now = this.clock;
    if (this.cool[key] && this.cool[key] > now) return false;
    this.cool[key] = now + t;
    return true;
  }

  // ------------------------------------------------------------------
  update(dt, bus, ctx) {
    this.clock += dt;
    // attesa accelerata: a bordo tutti e in anticipo sull'orario -> il tempo scorre x12
    const cur = this.stops[this.nextStop];
    this.fastForward = !!(cur && this.atStop && cur.doneMsg && cur.idx < this.stops.length - 1 && cur.sched - this.clock > 2);
    if (this.fastForward) this.clock = Math.min(cur.sched, this.clock + dt * 11);
    if (this.finished) { this.crowd.update(dt); return; }
    const front = bus.toWorld(0, 6);
    if (this.free) { this.updateFree(dt, bus, ctx, front); return; }
    const proj = projectOnRoute(this.route, bus.x, bus.z, this.s);
    if (proj.d < 60) this.s = proj.s;
    this.proj = proj;
    const sFront = this.s + 6 * Math.cos(angleDiff(Math.atan2(this.route.segs[proj.segIndex].dx, this.route.segs[proj.segIndex].dz), bus.h));

    // genera persone alle fermate vicine
    for (const st of this.stops) if (!st.spawned && Math.abs(st.s - this.s) < 450) this.spawnStopPeople(st);

    // ---- fermata corrente ----
    const st = this.stops[this.nextStop];
    this.atStop = false;
    if (st) {
      const along = sFront - st.s; // 0 = muso del bus alla palina
      const inZone = along > -12 && along < 10 && proj.d < st.hw + 2.5;
      const lat = Math.abs(proj.lat - (st.hw - 1.6));
      this.stopInfo = { st, along, inZone, lat };
      const stopped = Math.abs(bus.v) < 0.3;
      if (inZone && stopped && bus.doorOpen[0] > 0.9) {
        this.atStop = true;
        if (!st.arrived) {
          st.arrived = true;
          const delay = this.clock - st.sched;
          st.delay = delay;
          if (st.idx > 0) this.judgeArrival(st, delay, lat);
          if (st.idx === this.nextStop && bus.indicator === 1) { this.addScore(10, 'Freccia a destra in accostamento'); this.stats.indicatorsOk++; }
          this.request = false;
          this.boardT = 0.8; this.alightT = 0.4;
          if (st.terminal && st.idx === this.stops.length - 1) this.audio.say(`${st.name}. Capolinea. Si prega di scendere.`);
        }
        this.serve(dt, bus, st);
      }
      // partenza dalla fermata
      if (st.arrived && !this.atStop && bus.doorsClosed && Math.abs(bus.v) > 0.5) {
        this.leaveStop(bus, st);
      }
      // fermata saltata
      if (!st.arrived && along > 25 && st.idx < this.stops.length - 1) {
        const wanted = st.waiting.length > 0 || this.onboard.some((d) => d === st.idx);
        if (wanted) {
          this.addScore(-120, `Fermata saltata: ${st.name}!`);
          this.stats.skipped++;
          for (const p of st.waiting) p.h += Math.PI; // si girano arrabbiati
          // chi doveva scendere scenderà alla successiva
          this.onboard = this.onboard.map((d) => (d === st.idx ? Math.min(d + 1, this.stops.length - 1) : d));
        } else this.hud.toast(`Fermata ${st.name}: nessuno a terra, transito`, 'info');
        st.arrived = true; st.left = true;
        this.advanceStop(bus);
      }
    }

    // ---- prenotazione fermata ----
    const ns = this.stops[this.nextStop];
    if (ns && !this.request && !ns.arrived && this.onboard.some((d) => d === ns.idx) && ns.s - this.s < 320 && this.rnd() < dt * 0.6) {
      this.request = true;
      this.audio.bell();
      this.hud.toast('🔔 Fermata prenotata', 'info');
    }

    // ---- uscita dalla fermata: freccia ----
    if (this.leaveCheck) {
      this.leaveCheck.t += dt;
      if (bus.indicator === -1) this.leaveCheck.ok = true;
      if (this.leaveCheck.t > 4 || bus.odometer - this.leaveCheck.odo > 15) {
        if (this.leaveCheck.ok) { this.addScore(20, 'Freccia a sinistra in partenza ✔'); this.stats.indicatorsOk++; }
        else this.addScore(-10, 'Ripartenza senza freccia');
        this.leaveCheck = null;
      }
    }

    // ---- comfort ----
    const standing = Math.max(0, this.onboard.length - 30);
    const aL = Math.abs(bus.aLong), aT = Math.abs(bus.aLat);
    let disc = 0;
    if (aL > 1.7) disc += (aL - 1.7) * 14;
    if (aT > 1.9) disc += (aT - 1.9) * 12;
    this.comfort = Math.max(0, Math.min(100, this.comfort - disc * dt * (this.onboard.length ? 1 : 0.3) + dt * 1.2));
    if ((aL > 3.8 || aT > 3.6) && this.onboard.length > 0 && this.cooldown('fall', 12)) {
      this.addScore(standing > 0 ? -40 : -20, standing > 0 ? 'Ahia! Un passeggero in piedi è caduto!' : 'Passeggeri sballottati!');
    }
    if (this.onboard.length > 0) { this.stats.comfortSum += this.comfort * dt; this.stats.comfortN += dt; }

    // ---- infrazioni ----
    const limit = ctx.speedLimit;
    if (bus.speedKmh > limit + 6) {
      this.speedT = (this.speedT || 0) + dt;
      if (this.speedT > 2.5 && this.cooldown('speed', 20)) {
        this.audio.camera();
        this.stats.speeding++;
        this.addScore(-40, `📸 Autovelox! ${Math.round(bus.speedKmh)} km/h (limite ${limit})`);
      }
    } else this.speedT = 0;
    this.checkRedLights(bus, front);
    if (ctx.onSidewalk && Math.abs(bus.v) > 1 && this.cooldown('walk', 8)) { this.stats.sidewalk++; this.addScore(-20, 'Sul marciapiede!'); }
    if (ctx.night && !bus.lights && Math.abs(bus.v) > 2 && this.cooldown('lights', 25)) this.addScore(-10, 'Accendi i fari! (L)');
    // fuori percorso
    if (proj.d > 40) {
      this.offRouteT += dt;
      if (this.offRouteT > 3 && this.cooldown('route', 6)) this.addScore(-15, 'Fuori percorso! Segui la navigazione');
    } else this.offRouteT = 0;

    this.crowd.update(dt);
  }

  // giro libero: solo regole della strada e comfort
  updateFree(dt, bus, ctx, front) {
    this.atStop = false;
    this.stopInfo = null;
    const aL = Math.abs(bus.aLong), aT = Math.abs(bus.aLat);
    let disc = 0;
    if (aL > 1.7) disc += (aL - 1.7) * 14;
    if (aT > 1.9) disc += (aT - 1.9) * 12;
    this.comfort = Math.max(0, Math.min(100, this.comfort - disc * dt * 0.3 + dt * 1.2));
    const limit = ctx.speedLimit;
    if (bus.speedKmh > limit + 6) {
      this.speedT = (this.speedT || 0) + dt;
      if (this.speedT > 2.5 && this.cooldown('speed', 20)) { this.audio.camera(); this.stats.speeding++; this.addScore(-40, `📸 Autovelox! ${Math.round(bus.speedKmh)} km/h (limite ${limit})`); }
    } else this.speedT = 0;
    this.checkRedLights(bus, front);
    if (ctx.onSidewalk && Math.abs(bus.v) > 1 && this.cooldown('walk', 8)) { this.stats.sidewalk++; this.addScore(-20, 'Sul marciapiede!'); }
    if (ctx.night && !bus.lights && Math.abs(bus.v) > 2 && this.cooldown('lights', 25)) this.addScore(-10, 'Accendi i fari! (L)');
    this.crowd.update(dt);
  }

  judgeArrival(st, delay, lat) {
    const d = Math.round(delay);
    let msg;
    if (delay < -60) { msg = `In anticipo di ${fmtDelay(-d)} – attendi l'orario`; this.stats.early++; this.addScore(30, msg, 'info'); }
    else if (delay <= 90) { this.stats.onTime++; this.addScore(100, `Puntuale a ${st.name}!`); }
    else if (delay <= 240) { this.stats.late++; this.addScore(40, `Ritardo ${fmtDelay(d)} a ${st.name}`, 'info'); }
    else { this.stats.late++; this.addScore(0, `Ritardo ${fmtDelay(d)} a ${st.name}`, 'bad'); }
    if (lat < 0.6) this.addScore(15, 'Accostamento perfetto');
    else if (lat > 1.8) this.addScore(-10, 'Troppo lontano dal marciapiede');
  }

  serve(dt, bus, st) {
    // discesa (porte centrale e posteriore)
    this.alightT -= dt;
    const leaving = this.onboard.findIndex((d) => d <= st.idx);
    if (leaving >= 0 && this.alightT <= 0) {
      this.onboard.splice(leaving, 1);
      this.stats.alighted++;
      this.alightT = 0.45 + this.rnd() * 0.35;
      const door = this.rnd() < 0.5 ? BUS.doors[1] : BUS.doors[2];
      const dp = bus.toWorld(-1.6, (door.z0 + door.z1) / 2);
      const away = { x: dp.x + st.rx * 4 + st.dx * (this.rnd() * 8 - 4), z: dp.z + st.rz * 4 + st.dz * (this.rnd() * 8 - 4) };
      const p = this.crowd.add({ x: dp.x, z: dp.z, h: 0, ph: 0, speed: 1.3 + this.rnd() * 0.3, sc: 0.85 + this.rnd() * 0.25, col: new THREE.Color().setHSL(this.rnd(), 0.4, 0.3 + this.rnd() * 0.3), life: 9 });
      p.target = away;
      p.onArrive = (q) => { q.target = { x: q.x + st.dx * 30 * (this.rnd() < 0.5 ? 1 : -1), z: q.z + st.dz * 30 }; };
      bus.passengers = this.onboard.length;
      bus.setPassengerVisuals(this.onboard.length);
    }
    // salita (porta anteriore)
    this.boardT -= dt;
    const cap = 100;
    if (st.waiting.length && this.boardT <= 0 && this.onboard.length + this.walkingIn() < cap) {
      const p = st.waiting.find((q) => !q.boarding);
      if (p) {
        p.boarding = true;
        const door = BUS.doors[0];
        const dp = bus.toWorld(-1.7, (door.z0 + door.z1) / 2);
        p.target = dp;
        p.speed = p.elderly ? 0.7 : p.runner ? 3 : 1.6;
        if (p.elderly && !st.elderlyMsg) {
          st.elderlyMsg = true;
          if (bus.kneelTarget > 0) this.addScore(15, 'Bus inginocchiato per la signora anziana 👵');
          else this.hud.toast('👵 Sale una persona anziana: premi K per abbassare il bus', 'info');
        }
        p.onArrive = (q) => {
          q.dead = true;
          st.waiting.splice(st.waiting.indexOf(q), 1);
          this.onboard.push(q.dest);
          this.stats.boarded++;
          bus.passengers = this.onboard.length;
          bus.setPassengerVisuals(this.onboard.length);
          this.audio.tone(1500, 0.08, { gain: 0.05 }); // validatrice
          if (q.runner) this.addScore(40, 'Hai aspettato il ritardatario: che gentile! 😊');
        };
        this.boardT = p.elderly ? 2.4 : 0.5 + this.rnd() * 0.5;
      }
    }
    const full = this.onboard.length + this.walkingIn() >= cap;
    if (full && st.waiting.some((q) => !q.boarding) && !st.fullMsg) { st.fullMsg = true; this.hud.toast(`🚌 Bus pieno! ${st.waiting.filter((q) => !q.boarding).length} in attesa del prossimo`, 'info'); }
    const done = (!st.waiting.length || (full && !this.walkingIn())) && !this.onboard.some((d) => d <= st.idx);
    if (done && !st.doneMsg) {
      st.doneMsg = true;
      if (st.idx === this.stops.length - 1) this.finish();
      else {
        const wait = st.sched - this.clock;
        if (st.idx === 0 || wait > 20) this.hud.toast(`⏩ Attesa accelerata fino alle ${fmtHM(st.sched, true)}, poi chiudi le porte (F)`, 'info');
        else this.hud.toast('Salita completata: chiudi le porte (F) e riparti', 'info');
      }
    }
    if (!done && bus.doorTarget === 0) st.doneMsg = false;
  }
  skipWait() {
    const cur = this.stops[this.nextStop];
    if (cur && this.atStop && cur.doneMsg && cur.sched > this.clock) { this.clock = cur.sched; this.hud.toast('Orario di partenza raggiunto: chiudi le porte (F)', 'info'); }
  }
  // evento: un ritardatario corre verso il bus mentre si chiudono le porte
  onDoorsClosing(bus) {
    const st = this.stops[this.nextStop];
    if (!st || !this.atStop || st.idx === this.stops.length - 1 || st.runnerDone) return;
    st.runnerDone = true;
    if (this.rnd() > 0.45) return;
    // parte da dietro il bus, ben visibile nello specchietto destro
    const back = bus.toWorld(-2.6, -14);
    const p = this.crowd.add({
      x: back.x, z: back.z, h: bus.h, ph: 0, speed: 4.6, sc: 1.0,
      col: new THREE.Color(0xff3d00), dest: this.pickDest(st.idx), runner: true,
    });
    const door = bus.toWorld(-1.8, (BUS.doors[0].z0 + BUS.doors[0].z1) / 2);
    p.target = { x: door.x, z: door.z };
    p.onArrive = () => {
      if (bus.doorTarget === 0 && !st.left) { this.hud.toast('✊ Bussa alla porta: "Aspetti! Aspetti!"', 'info'); this.audio.noiseBurst({ dur: 0.08, type: 'lowpass', freq: 600, gain: 0.5 }); this.audio.noiseBurst({ dur: 0.08, type: 'lowpass', freq: 600, gain: 0.5, delay: 0.25 }); }
    };
    st.waiting.push(p);
    this.audio.tone(880, 0.15, { type: 'square', gain: 0.05 });
    this.audio.tone(880, 0.15, { type: 'square', gain: 0.05, delay: 0.2 });
    this.hud.toast('🏃 "Aspettiii!" Un ritardatario corre verso la porta: riapri (F)?', 'info');
    this.runner = { p, st };
  }
  walkingIn() { return this.crowd.people.filter((p) => p.boarding && !p.dead).length; }

  leaveStop(bus, st) {
    if (st.left) return;
    st.left = true;
    const early = st.sched - this.clock;
    if (early > 45) this.addScore(-60, `Partenza anticipata di ${fmtDelay(Math.round(early))}!`);
    // chi stava camminando verso la porta resta a terra
    for (const p of st.waiting) if (p.boarding) { p.boarding = false; p.target = null; p.onArrive = null; }
    const left = st.fullMsg ? 0 : st.waiting.filter((p) => !p.runner).length;
    if (st.waiting.some((p) => p.runner)) this.hud.toast('Il ritardatario è rimasto a terra… 😢', 'info');
    if (left > 0) this.addScore(-15 * left, `${left} passegger${left > 1 ? 'i' : 'o'} lasciat${left > 1 ? 'i' : 'o'} a terra`);
    this.leaveCheck = { t: 0, ok: bus.indicator === -1, odo: bus.odometer };
    this.advanceStop(bus);
  }

  advanceStop(bus) {
    this.nextStop++;
    this.request = false;
    const ns = this.stops[this.nextStop];
    if (ns) {
      const txt = ns.idx === this.stops.length - 1 ? `Prossima fermata: ${ns.name}. Capolinea.` : `Prossima fermata: ${ns.name}.`;
      this.audio.say(txt);
      bus.setInnerDisplay('Prossima: ' + ns.name);
    }
  }

  checkRedLights(bus, front) {
    for (const sig of this.lights.signals) {
      const n = sig.node;
      const dx = front.x - n.x, dz = front.z - n.z;
      const d = Math.hypot(dx, dz);
      if (d > 45) { this.lastSigDist.delete(n.id); continue; }
      // arco di avvicinamento: quello più allineato con la posizione del muso
      let best = null, bd = -2;
      for (const ap of n.signal.appr) {
        const dot = (dx * ap.out.x + dz * ap.out.z) / (d || 1);
        if (dot > bd) { bd = dot; best = ap; }
      }
      const line = n.radius + 1.2;
      const prev = this.lastSigDist.get(n.id);
      this.lastSigDist.set(n.id, d);
      const movingIn = bus.fx * -best.out.x + bus.fz * -best.out.z > 0.5 && bus.v > 1;
      if (prev != null && prev > line && d <= line && movingIn && bd > 0.6) {
        const st = this.lights.lightFor(n, best.edge);
        if (st === 'R' && this.cooldown('red' + n.id, 10)) { this.stats.redLights++; this.addScore(-150, '🚦 Passaggio con il rosso!'); }
        else if (st === 'Y' && this.cooldown('yel' + n.id, 10)) this.hud.toast('Giallo… al limite!', 'info');
      }
    }
  }

  onCrash(hit) {
    if (hit.impact < 1.2) return;
    if (!this.cooldown('crash', 2.5)) return;
    // tamponamento subito: non è colpa dell'autista
    if (hit.kind === 'car' && hit.lz < 0 && hit.car) {
      const rel = (hit.car.x - hit.x) * Math.sin(hit.car.h) + (hit.car.z - hit.z) * Math.cos(hit.car.h);
      if (rel < 0) { this.hud.toast('Un\'auto ti ha tamponato! (non è colpa tua)', 'info'); this.comfort = Math.max(0, this.comfort - 10); return; }
    }
    this.stats.crashes++;
    this.comfort = Math.max(0, this.comfort - 25);
    const what = { car: 'un\'auto', building: 'un edificio', shelter: 'una pensilina', tree: 'un albero', pole: 'un palo', wall: 'il parapetto', landmark: 'un monumento!' }[hit.kind] || 'un ostacolo';
    const pts = -Math.round(Math.min(250, 40 + hit.impact * 25));
    this.addScore(pts, `💥 Hai urtato ${what}`);
  }

  // navigazione: prossima svolta
  navInfo() {
    const r = this.route;
    for (let i = 1; i < r.pts.length - 1; i++) {
      if (r.cum[i] < this.s - 5) continue;
      const a = r.segs[i - 1], b = r.segs[i];
      const cross = a.dx * b.dz - a.dz * b.dx, dot = a.dx * b.dx + a.dz * b.dz;
      const ang = Math.atan2(cross, dot);
      const dist = r.cum[i] - this.s;
      if (Math.abs(ang) > 0.45) return { dist, dir: ang > 0 ? 'right' : 'left', sharp: Math.abs(ang) > 1.9, street: b.edge.name };
    }
    const end = r.length - this.s;
    return { dist: end, dir: 'straight', street: r.segs[Math.min(r.segs.length - 1, this.proj ? this.proj.segIndex : 0)].edge.name };
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    const avgComfort = this.stats.comfortN ? this.stats.comfortSum / this.stats.comfortN : 100;
    const comfortBonus = Math.round((avgComfort - 60) * 4);
    this.addScore(comfortBonus, `Comfort medio ${Math.round(avgComfort)}%`, comfortBonus >= 0 ? 'good' : 'bad');
    this.addScore(200, `Capolinea ${this.dest} raggiunto!`);
    this.avgComfort = avgComfort;
    this.onFinish && this.onFinish();
  }

  speedLimitAt(x, z) { return zoneOf(x, z) === 0 ? 30 : 50; }
  posAt(s) { return pointAt(this.route, s); }
}

export function fmtDelay(sec) {
  const s = Math.abs(sec);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function isPeak(hour) {
  return (hour > 7 && hour < 9.3) || (hour > 12.5 && hour < 14.5) || (hour > 17 && hour < 19.5);
}
// orario teorico di passaggio alle fermate
// orari reali dal GTFS: tempi della corsa di riferimento scalati sulla durata della corsa scelta
export function scheduleFor(variant, departure, dur) {
  const k = (dur || variant.duration) / variant.duration;
  return variant.offsets.map((o) => departure + o * k);
}
