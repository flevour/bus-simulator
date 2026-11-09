import * as THREE from 'three';
import { buildRoute, buildTramRoute, pointAt, projectOnRoute, alignStops, planTransfer, routeManeuvers } from './routes.js';
import { personGeometry } from '../world/traffic.js';
import { zoneOf } from '../world/city.js';
import { fmtHM } from '../data/padova.js';
import { mulberry32, angleDiff } from '../world/spatial.js';
import { posthog, isPostHogConfigured, posthogGameLogger } from '../posthog.js';

const capture = (event, properties) => {
  if (isPostHogConfigured) posthog.capture(event, properties);
};

// Persone alle fermate (in attesa / che salgono / che scendono); anche quelle dei bus automatici (buses.js)
export class Crowd {
  constructor(scene, max = 160) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(personGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), max);
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
    const n = Math.min(this.people.length, this.max);
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
  constructor({ scene, net, line, route, day, departure, depDur, hud, audio, lights, city, free = false, roam = false }) {
    this.free = free || roam;
    this.roam = roam; // esplorazione: nessuna regola né punteggio
    const variant = day;
    this.net = net; this.line = line; this.variant = day; this.routeData = route; this.hud = hud; this.audio = audio; this.lights = lights; this.city = city;
    // il tram segue la sua corsia (route.trackPath); il bus le strade
    this.tram = !!route.tram;
    this.route = this.tram ? buildTramRoute(route.trackPath, route) : buildRoute(net, route);
    this.stops = this.route.stops;
    // tram: alle fermate con la banchina centrale (comune ai due versi) si sale e si scende a sinistra
    if (this.tram && city && city.tramTrack) for (const st of this.stops) {
      if (!city.tramTrack.centralAt(st.cx, st.cz)) continue;
      const O = city.tramTrack.path(-city.tramTrack.dirOf(route)), q = O.at(O.project(st.cx, st.cz).s), half = Math.hypot(q.x - st.cx, q.z - st.cz) / 2 || 2.2;
      Object.assign(st, { side: -1, rx: -st.rx, rz: -st.rz });
      st.x = st.cx + st.rx * half; st.z = st.cz + st.rz * half;
    }
    if (!this.tram && city && city.stopPlacements) alignStops(this.route, city.stopPlacements);
    this.maneuvers = this.tram ? [] : routeManeuvers(net, this.route);
    this.dest = this.stops[this.stops.length - 1].name;
    this.departure = departure;
    this.clock = departure - 25; // poco prima della partenza
    this.rnd = mulberry32(Math.floor(departure) + line.id.length * 31);
    this.crowd = new Crowd(scene);
    this.onboard = []; // indici fermata di destinazione
    this.score = 0;
    this.log = [];
    this.stats = { boarded: 0, alighted: 0, onTime: 0, late: 0, early: 0, skipped: 0, crashes: 0, redLights: 0, speeding: 0, sidewalk: 0, comfortSum: 0, comfortN: 0, indicatorsOk: 0, waves: 0 };
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

  // bisogna fermarsi? qualcuno aspetta alla fermata o qualcuno a bordo deve scendere (prenotazione)
  needsStop(st) {
    return st.waiting.length > 0 || this.onboard.some((d) => d === st.idx);
  }
  // numero di persone in attesa a una fermata: le fermate secondarie restano vuote più spesso (si passa dritti)
  rollWaiting(st) {
    if (st.idx === this.stops.length - 1) return 0;
    const base = [0, 0.8, 2.2, 4.5][st.importance] || 1;
    let n = Math.round((base + this.rnd() * 3) * this.demand + (st.idx === 0 ? 3 : 0));
    if (st.idx > 0 && this.rnd() < ([0, 0.4, 0.22, 0.1][st.importance] ?? 0.3)) n = 0;
    return Math.max(0, Math.min(18, n));
  }

  spawnStopPeople(st) {
    st.spawned = true;
    const n = this.rollWaiting(st);
    for (let i = 0; i < n; i++) {
      const along = this.tram ? -3 - this.rnd() * 20 : -1 - this.rnd() * 7;
      // sul tram si aspetta sulla banchina (larga o stretta); alla fermata del bus sul marciapiede
      let back = this.tram ? -0.6 + this.rnd() * 1.0 : 0.5 + this.rnd() * 1.6;
      // dove la sede del tram corre accanto alla carreggiata si resta in fila sul bordo, mai sui binari
      const onTram = (b) => this.city && this.city.onTramway && this.city.onTramway(st.x + st.dx * along + st.rx * b, st.z + st.dz * along + st.rz * b, 0.3);
      while (!this.tram && back > -1.3 && onTram(back)) back -= 0.25;
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
    if (this.roam) return;
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
    const proj = projectOnRoute(this.route, bus.x, bus.z, this.s, 80, 400, bus.h);
    if (proj.d < 60) this.s = proj.s;
    this.proj = proj;
    const sFront = this.s + 6 * Math.cos(angleDiff(Math.atan2(this.route.segs[proj.segIndex].dx, this.route.segs[proj.segIndex].dz), bus.h));

    // genera persone alle fermate vicine
    for (const st of this.stops) if (!st.spawned && Math.abs(st.s - this.s) < 450) this.spawnStopPeople(st);

    // ---- fermata corrente ----
    const st = this.stops[this.nextStop];
    if (this.tram) bus.platformSide = (st && st.side) || 1; // porte dal lato della banchina
    this.atStop = false;
    if (st) {
      const along = sFront - st.s; // 0 = muso del bus alla palina
      // accostamento misurato dal cordolo vero della fermata (kerb), se c'è
      const kerb = st.kerb ?? st.hw;
      const inZone = along > -12 && along < 10 && proj.d < Math.max(st.hw, kerb) + 2.5;
      const lat = Math.abs(proj.lat - ((st.kl ?? kerb) - 1.6));
      this.stopInfo = { st, along, inZone, lat };
      const stopped = Math.abs(bus.v) < 0.3;
      if (inZone && stopped && bus.doorOpen[0] > 0.9) {
        this.atStop = true;
        if (!st.arrived) {
          st.arrived = true;
          const delay = this.clock - st.sched;
          st.delay = delay;
          capture('stop_served', {
            vehicle_type: this.tram ? 'tram' : 'bus',
            line_id: this.line.id,
            stop_index: st.idx,
            arrival_status: delay < -60 ? 'early' : delay <= 90 ? 'on_time' : 'late',
          });
          if (st.idx > 0) this.judgeArrival(st, delay, lat, along);
          if (!this.tram && st.idx === this.nextStop && bus.indicator === 1) { this.addScore(10, 'Freccia a destra in accostamento'); this.stats.indicatorsOk++; }
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
        // fermata a richiesta (bus e tram): ci si ferma solo se qualcuno aspetta o deve scendere
        const wanted = this.needsStop(st);
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
        this.addScore(-40, this.tram ? `⚠️ Troppo veloce: ${Math.round(bus.speedKmh)} km/h (limite ${limit})` : `📸 Autovelox! ${Math.round(bus.speedKmh)} km/h (limite ${limit})`);
      }
    } else this.speedT = 0;
    if (this.tram) this.checkPantograph(bus, dt);
    else { this.checkRedLights(bus, front); this.checkStopSigns(bus); }
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
    if (this.roam) { this.comfort = 100; this.crowd.update(dt); return; }
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
    if (this.tram) this.checkPantograph(bus, dt);
    else { this.checkRedLights(bus, front); this.checkStopSigns(bus); }
    if (ctx.onSidewalk && Math.abs(bus.v) > 1 && this.cooldown('walk', 8)) { this.stats.sidewalk++; this.addScore(-20, 'Sul marciapiede!'); }
    if (ctx.night && !bus.lights && Math.abs(bus.v) > 2 && this.cooldown('lights', 25)) this.addScore(-10, 'Accendi i fari! (L)');
    this.crowd.update(dt);
  }

  // STOP: bisogna fermarsi (anche solo un attimo) prima della linea di arresto
  checkStopSigns(bus) {
    const grid = this.city && this.city.signGrid;
    if (!grid) return;
    const fx = bus.x + bus.fx * 6, fz = bus.z + bus.fz * 6; // muso del bus
    const near = grid.query(fx, fz, 1, this._qss || (this._qss = []));
    const mem = this._stopMem || (this._stopMem = new Map());
    for (const sg of near) {
      if (bus.fx * sg.dx + bus.fz * sg.dz < 0.6 || bus.dir < 0) continue;
      const along = (fx - sg.x) * sg.dx + (fz - sg.z) * sg.dz; // < 0 prima della linea
      const lat = (fx - sg.x) * -sg.dz + (fz - sg.z) * sg.dx;
      if (Math.abs(lat) > sg.hw + 1.5 || along < -30 || along > 8) continue;
      const m = mem.get(sg) || { stopped: false, prev: along };
      if (along > -14 && along < 0.6 && Math.abs(bus.v) < 0.4) m.stopped = true;
      if (m.prev < 0 && along >= 0) {
        if (!m.stopped && this.cooldown('stopsign', 6)) this.addScore(-40, '🛑 Non ti sei fermato allo STOP!');
        m.stopped = false;
      }
      m.prev = along;
      mem.set(sg, m);
    }
  }

  // punto davanti all'ultima porta (out: metri fuori dal fianco)
  rearDoor(bus, out) {
    if (this.tram) return bus.doorPoint(bus.doorCount - 1, out);
    return bus.doorWorld(bus.doors.length - 1, -(1.3 + out));
  }

  // Tram: a Prato della Valle non c'è la linea aerea. Il pantografo va abbassato prima (O) e rialzato subito dopo.
  checkPantograph(tram, dt) {
    if (!tram.track) return;
    const wire = tram.wireAvail !== false;
    if (!wire && tram.pantoPos > 0.3) {
      if (this.cooldown('pantoKo', 25)) {
        this.audio.crash && this.audio.crash(0.4);
        this.addScore(-150, '⚡ Pantografo alzato dove non c\'è la linea aerea! Strisciante danneggiato');
      }
      tram.pantoUp = false;
      this._pantoOk = true; // niente bonus: l'ha abbassato l'emergenza
    }
    // avviso prima del tratto senza filo
    const gap = tram.track.gapAhead(tram.dirSig, tram.pathOffset + tram.sFront, 140);
    if (gap && wire && tram.pantoUp && tram.v > 1 && this.cooldown('pantoWarn', 30)) this.hud.toast('🔌 Tra poco Prato della Valle: abbassa il pantografo (O)', 'info');
    if (!wire && !tram.pantoUp && !this._pantoOk) { this._pantoOk = true; this.addScore(20, 'Pantografo abbassato in tempo ✔'); }
    // dopo il tratto: rialzarlo subito
    if (wire && tram.pantoPos < 0.05 && tram.v > 1) {
      this.pantoDown = (this.pantoDown || 0) + tram.v * dt;
      if (this.pantoDown > 60 && this.cooldown('pantoUp', 25)) this.addScore(this.pantoDown > 200 ? -20 : 0, '🔌 C\'è di nuovo la linea aerea: rialza il pantografo (O)', this.pantoDown > 200 ? 'bad' : 'info');
    } else if (wire && tram.pantoPos > 0.9) { this.pantoDown = 0; this._pantoOk = false; }
  }

  judgeArrival(st, delay, lat, along = 0) {
    const d = Math.round(delay);
    let msg;
    if (delay < -60) { msg = `In anticipo di ${fmtDelay(-d)} – attendi l'orario`; this.stats.early++; this.addScore(30, msg, 'info'); }
    else if (delay <= 90) { this.stats.onTime++; this.addScore(100, `Puntuale a ${st.name}!`); }
    else if (delay <= 240) { this.stats.late++; this.addScore(40, `Ritardo ${fmtDelay(d)} a ${st.name}`, 'info'); }
    else { this.stats.late++; this.addScore(0, `Ritardo ${fmtDelay(d)} a ${st.name}`, 'bad'); }
    if (this.tram) {
      // il tram è sulla rotaia: conta solo fermarsi col muso a fine banchina
      if (Math.abs(along) < 2) this.addScore(15, 'Fermata precisa a fine banchina');
      else if (along < -8) this.addScore(-10, 'Fermato troppo indietro: l\'ultima porta è fuori dalla banchina');
    } else if (lat < 0.6) this.addScore(15, 'Accostamento perfetto');
    else if (lat > 1.8) this.addScore(-10, 'Troppo lontano dal marciapiede');
  }

  serve(dt, bus, st) {
    // discesa (porte centrale e posteriore)
    this.alightT -= dt;
    const leaving = this.onboard.findIndex((d) => d <= st.idx);
    if (leaving >= 0 && this.alightT <= 0) {
      this.onboard.splice(leaving, 1);
      this.stats.alighted++;
      this.alightT = (0.45 + this.rnd() * 0.35) / (this.tram ? 3 : 1);
      // sul bus si scende dalle porte dopo l'anteriore
      const dp = this.tram ? bus.doorPoint(Math.floor(this.rnd() * bus.doorCount), 0.3) : bus.doorWorld(1 + Math.floor(this.rnd() * (bus.doors.length - 1)), -1.6);
      const away = { x: dp.x + st.rx * 4 + st.dx * (this.rnd() * 8 - 4), z: dp.z + st.rz * 4 + st.dz * (this.rnd() * 8 - 4) };
      const p = this.crowd.add({ x: dp.x, z: dp.z, h: 0, ph: 0, speed: 1.3 + this.rnd() * 0.3, sc: 0.85 + this.rnd() * 0.25, col: new THREE.Color().setHSL(this.rnd(), 0.4, 0.3 + this.rnd() * 0.3), life: 9 });
      p.target = away;
      p.onArrive = (q) => { q.target = { x: q.x + st.dx * 30 * (this.rnd() < 0.5 ? 1 : -1), z: q.z + st.dz * 30 }; };
      bus.passengers = this.onboard.length;
      bus.setPassengerVisuals(this.onboard.length);
    }
    // salita (porta anteriore)
    this.boardT -= dt;
    const cap = this.tram ? 150 : 100;
    const board = (q) => {
      q.dead = true;
      st.waiting.splice(st.waiting.indexOf(q), 1);
      this.onboard.push(q.dest);
      this.stats.boarded++;
      bus.passengers = this.onboard.length;
      bus.setPassengerVisuals(this.onboard.length);
      this.audio.tone(1500, 0.08, { gain: 0.05 }); // validatrice
      if (q.runner) this.addScore(40, 'Hai aspettato il ritardatario: che gentile! 😊');
    };
    // il ritardatario arriva da dietro: sale dalla porta posteriore, senza fare la fila davanti
    const run = st.waiting.find((q) => q.runner && !q.boarding);
    const rdp = run && this.rearDoor(bus, 0.5);
    if (run && bus.doorTarget > 0 && bus.doorOpen[this.tram ? bus.doorCount - 1 : bus.doors.length - 1] > 0.6 && Math.hypot(run.x - rdp.x, run.z - rdp.z) < 2.5 && this.onboard.length + this.walkingIn() < cap) {
      run.boarding = true;
      run.target = this.rearDoor(bus, 0.15);
      run.speed = Math.max(run.speed, 3);
      run.onArrive = board;
    }
    if (st.waiting.length && this.boardT <= 0 && this.onboard.length + this.walkingIn() < cap) {
      const p = st.waiting.find((q) => !q.boarding && !q.runner);
      if (p) {
        p.boarding = true;
        // sul tram si sale dalla porta più vicina, sul bus da quella anteriore
        const dp = this.tram ? bus.doorPoint(bus.nearestDoor(p.x, p.z), 0.4) : bus.doorWorld(0, -1.7);
        p.target = dp;
        p.speed = p.elderly ? 0.7 : p.runner ? 3 : 1.6;
        if (p.elderly && !st.elderlyMsg && !this.tram) {
          st.elderlyMsg = true;
          if (bus.kneelTarget > 0) this.addScore(15, 'Bus inginocchiato per la signora anziana 👵');
          else this.hud.toast('👵 Sale una persona anziana: premi K per abbassare il bus', 'info');
        }
        p.onArrive = board;
        this.boardT = (p.elderly ? 2.4 : 0.5 + this.rnd() * 0.5) / (this.tram ? 3 : 1);
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
    // parte da dietro il bus, ben visibile nello specchietto destro, e punta alla porta posteriore
    const back = this.tram ? bus.toWorld(-2.6, -(bus.length - 6) - 12) : bus.behind(-2.6, 11);
    const p = this.crowd.add({
      x: back.x, z: back.z, h: bus.h, ph: 0, speed: 4.6, sc: 1.0,
      col: new THREE.Color(0xff3d00), dest: this.pickDest(st.idx), runner: true,
    });
    const door = this.rearDoor(bus, 0.5);
    p.target = { x: door.x, z: door.z };
    p.onArrive = () => {
      if (bus.doorTarget === 0 && !st.left) { this.hud.toast('✊ Bussa alla porta posteriore: "Aspetti! Aspetti!"', 'info'); this.audio.noiseBurst({ dur: 0.08, type: 'lowpass', freq: 600, gain: 0.5 }); this.audio.noiseBurst({ dur: 0.08, type: 'lowpass', freq: 600, gain: 0.5, delay: 0.25 }); }
    };
    st.waiting.push(p);
    this.audio.tone(880, 0.15, { type: 'square', gain: 0.05 });
    this.audio.tone(880, 0.15, { type: 'square', gain: 0.05, delay: 0.2 });
    this.hud.toast('🏃 "Aspettiii!" Un ritardatario corre verso la porta posteriore: riapri (F)?', 'info');
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
    this.leaveCheck = this.tram ? null : { t: 0, ok: bus.indicator === -1, odo: bus.odometer };
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
    for (const sig of this.lights.signals) for (const n of sig.nodes) {
      const dx = front.x - n.x, dz = front.z - n.z;
      const d = Math.hypot(dx, dz);
      if (d > 45) { this.lastSigDist.delete(n.id); continue; }
      // arco di avvicinamento: quello più allineato con la posizione del muso
      let best = null, bd = -2;
      for (const e of n.edges) {
        const o = e.a === n.id ? 1 : -1;
        const dot = (dx * e.dx * o + dz * e.dz * o) / (d || 1);
        if (dot > bd) { bd = dot; best = e; }
      }
      const prev = this.lastSigDist.get(n.id);
      this.lastSigDist.set(n.id, d);
      // tratti interni all'incrocio e sensi unici in uscita non hanno lanterna
      const ap = sig.appr.find((a) => a.node === n && a.edge === best);
      if (!ap) continue;
      const line = ap.stop ?? n.radius + 1.2; // linea d'arresto
      const movingIn = bus.fx * -ap.out.x + bus.fz * -ap.out.z > 0.5 && bus.v > 1;
      if (prev != null && prev > line && d <= line && movingIn && bd > 0.6) {
        const st = this.lights.stateOf(sig, ap.phase);
        if (st === 'R' && this.cooldown('red' + n.id, 10)) { this.stats.redLights++; this.addScore(-150, '🚦 Passaggio con il rosso!'); }
        else if (st === 'Y' && this.cooldown('yel' + n.id, 10)) this.hud.toast('Giallo… al limite!', 'info');
      }
    }
  }

  onCrash(hit) {
    if (hit.impact < 1.2 || this.roam) return;
    if (!this.cooldown('crash', 2.5)) return;
    if (hit.kind === 'derail') {
      this.stats.crashes++;
      this.comfort = 0;
      this.addScore(-300, '💥 Deragliamento! Curva presa troppo veloce: arrivano i soccorsi');
      return;
    }
    // tram: l'auto che taglia la sede di traverso è in torto (il tram ha la precedenza)
    if (this.tram && hit.crossing) { this.hud.toast('🚗 Un\'auto ha tagliato la strada al tram: frenata d\'emergenza', 'info'); this.comfort = Math.max(0, this.comfort - 15); return; }
    // tamponamento subito: non è colpa dell'autista
    if (hit.kind === 'car' && hit.lz < 0 && hit.car) {
      const rel = (hit.car.x - hit.x) * Math.sin(hit.car.h) + (hit.car.z - hit.z) * Math.cos(hit.car.h);
      if (rel < 0) { this.hud.toast('Un\'auto ti ha tamponato! (non è colpa tua)', 'info'); this.comfort = Math.max(0, this.comfort - 10); return; }
    }
    this.stats.crashes++;
    this.comfort = Math.max(0, this.comfort - 25);
    if (hit.car && hit.car.isTram) hit.kind = 'tram';
    if (hit.car && hit.car.isBus) hit.kind = 'bus';
    capture('player_collision_recorded', {
      vehicle_type: this.tram ? 'tram' : 'bus',
      collision_type: hit.kind,
      impact_speed_kmh: Math.round(hit.impact * 3.6),
    });
    const what = { tram: 'il tram!', bus: 'un autobus!', car: 'un\'auto', building: 'un edificio', shelter: 'una pensilina', tree: 'un albero', pole: 'un palo', wall: 'il parapetto', landmark: 'un monumento!' }[hit.kind] || 'un ostacolo';
    const pts = -Math.round(Math.min(250, 40 + hit.impact * 25));
    this.addScore(pts, `💥 Hai urtato ${what}`);
  }

  // navigazione: prossima svolta
  navInfo() {
    const r = this.route;
    if (this.tram) {
      // sul tram niente svolte: prossima fermata e avvisi per il pantografo
      const ns = this.stops[this.nextStop];
      return { dist: ns ? Math.max(0, ns.s - this.s - 6) : r.length - this.s, dir: 'straight', street: ns ? 'Fermata ' + ns.name : 'Capolinea' };
    }
    // la prossima manovra (vedi routeManeuvers), o quella in corso: dentro la rotatoria si contano le uscite che restano
    const M = this.maneuvers, s = this.s;
    let k = 0;
    while (k < M.length && (M[k].sEnd ?? M[k].s) < s - 5) k++;
    const m = M[k];
    if (!m) return { dist: r.length - s, dir: 'straight', street: r.segs[Math.min(r.segs.length - 1, this.proj ? this.proj.segIndex : 0)].edge.name };
    const nav = { dist: Math.max(0, m.s - s), dir: m.dir, sharp: m.sharp, keep: m.keep, exit: m.exit, street: m.street };
    if (m.dir === 'roundabout' && s > m.s - 3) Object.assign(nav, { inside: true, dist: Math.max(0, m.sEnd - s), exit: m.exits.filter((x) => x > s + 2).length || 1 });
    // due manovre ravvicinate: si dice anche la seconda
    const nx = M[k + 1];
    if (nx && nx.s - (m.sEnd ?? m.s) < 60) nav.then = nx;
    return nav;
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    const avgComfort = this.stats.comfortN ? this.stats.comfortSum / this.stats.comfortN : 100;
    const comfortBonus = Math.round((avgComfort - 60) * 4);
    this.addScore(comfortBonus, `Comfort medio ${Math.round(avgComfort)}%`, comfortBonus >= 0 ? 'good' : 'bad');
    this.addScore(200, `Capolinea ${this.dest} raggiunto!`);
    this.avgComfort = avgComfort;
    const missionDetails = {
      vehicle_type: this.tram ? 'tram' : 'bus',
      line_id: this.line.id,
      final_score: this.score,
      average_comfort: Math.round(avgComfort),
      on_time_stops: this.stats.onTime,
      late_stops: this.stats.late,
      skipped_stops: this.stats.skipped,
      collisions: this.stats.crashes,
    };
    capture('mission_completed', missionDetails);
    posthogGameLogger.info('mission completed', missionDetails);
    this.onFinish && this.onFinish();
  }

  speedLimitAt(x, z) { return zoneOf(x, z) === 0 ? 30 : 50; }
  posAt(s) { return pointAt(this.route, s); }
}

// Corsa fuori servizio: dal deposito al capolinea, tra una corsa e l'altra del turno, di rientro in deposito. Niente
// passeggeri né fermate: il navigatore porta alla meta, e ricalcola la strada se si sbaglia; valgono le regole della
// strada come nel giro libero. kind: 'uscita' | 'spostamento' | 'rientro'; goal: meta (vedi startGoal); plan: variante
// fuori servizio (planTransfer); arriveBy: orario a cui arrivare (senza clock si parte in tempo per farcela)
export class Transfer extends Mission {
  constructor({ kind, goal, plan, clock = null, arriveBy = null, ...opts }) {
    super({ ...opts, route: plan, departure: clock ?? arriveBy ?? 0, depDur: 1 });
    this.transfer = kind;
    this.goal = goal;
    this.arriveBy = arriveBy;
    this.setPlan(plan);
    this.clock = clock ?? arriveBy - this.eta - 90;
    this.stops[1].sched = arriveBy ?? this.clock + this.eta;
    this.timetable = this.stops.map((st) => ({ name: st.name, time: fmtHM(st.sched) }));
    capture('transfer_started', { kind, line_id: this.line.id });
  }
  // percorso fino alla meta: la fermata d'arrivo sta a goal.at metri dal nodo della meta
  setPlan(plan) {
    const route = buildRoute(this.net, plan);
    const b = route.stops[1], s = Math.max(0, Math.min(route.length - 1, route.cum[plan.goalIdx] + this.goal.at));
    const p = pointAt(route, s), hw = p.seg.hw, rx = -p.dz, rz = p.dx;
    Object.assign(b, { s, x: p.x + rx * (hw + 1.6), z: p.z + rz * (hw + 1.6), cx: p.x, cz: p.z, dx: p.dx, dz: p.dz, rx, rz, hw, sched: this.stops ? this.stops[1].sched : 0 });
    this.route = route;
    this.maneuvers = routeManeuvers(this.net, route);
    this.stops = route.stops;
    for (const st of this.stops) st.waiting = [];
    const a = this.stops[0];
    a.arrived = a.left = a.spawned = b.spawned = true;
    this.nextStop = 1;
    this.s = 0;
    this.offRouteT = 0;
    this.dest = b.name;
    // tempo di guida stimato, con un margine per incroci e semafori
    this.eta = route.segs.reduce((t, sg) => t + segTime(sg, route.pts[sg.i]), 0) * 1.25;
  }
  update(dt, bus, ctx) {
    this.clock += dt;
    if (this.finished) { this.crowd.update(dt); return; }
    const proj = projectOnRoute(this.route, bus.x, bus.z, this.s, 80, 400, bus.h);
    if (proj.d < 60) this.s = proj.s;
    this.proj = proj;
    const sg = this.route.segs[proj.segIndex];
    const st = this.stops[1], along = this.s + 6 * Math.cos(angleDiff(Math.atan2(sg.dx, sg.dz), bus.h)) - st.s;
    const inZone = along > -14 && along < 10 && proj.d < Math.max(st.hw, st.kerb ?? st.hw) + 3;
    // strada sbagliata: il navigatore ricalcola da qui
    if (proj.d > 30) {
      this.offRouteT += dt;
      if (this.offRouteT > 2.5) this.replan(bus);
    } else this.offRouteT = 0;
    this.updateFree(dt, bus, ctx, bus.toWorld(0, 6));
    this.stopInfo = { st, along, inZone, lat: 0 };
    if (inZone && Math.abs(bus.v) < 0.3) this.finish();
  }
  replan(bus) {
    this.offRouteT = 0;
    const plan = planTransfer(this.net, this.city, bus.x, bus.z, bus.h, this.goal);
    if (!plan) return;
    this.setPlan(plan);
    this.hud.toast('🧭 Ricalcolo del percorso', 'info');
  }
  navInfo() {
    const nav = super.navInfo();
    // ultimi metri: dove fermarsi
    const left = this.stops[1].s - this.s - 6;
    if (left < 120) return { dist: Math.max(0, left), dir: 'straight', street: this.transfer === 'rientro' ? 'Fermati davanti alla sbarra' : 'Fermati alla palina di ' + this.dest };
    return nav;
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    const late = this.clock - (this.arriveBy ?? Infinity);
    if (this.transfer === 'uscita') {
      if (late <= 60) this.addScore(50, `Al capolinea ${this.dest} in tempo per la partenza`);
      else this.addScore(-Math.min(100, Math.round(late / 6)), `Al capolinea con ${fmtDelay(late)} di ritardo sulla partenza`);
    } else if (this.transfer === 'rientro') this.addScore(100, 'Bus in deposito: turno finito!');
    capture('transfer_completed', { kind: this.transfer, line_id: this.line.id, final_score: this.score, late_s: Number.isFinite(late) ? Math.round(late) : null });
    this.onFinish && this.onFinish();
  }
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
  const k = tripDuration(variant, dur) / variant.duration;
  return variant.offsets.map((o) => departure + o * k);
}
// durata della corsa: quella reale, ma mai meno del 90% del tempo di guida stimato (le linee tagliate al bordo della
// mappa hanno durate ricavate in proporzione dal GTFS, a volte impossibili: 11B Taggi - Ferrovia 6 minuti invece di 15)
export function tripDuration(variant, dur) {
  return Math.max(dur || variant.duration, variant.minDur || 0);
}

// Tempi di passaggio a misura di guida. Il GTFS dà partenza e arrivo reali, ma tra le fermate segue il traffico vero:
// sulla 13 in periferia chiede 36-46 km/h di media fermate comprese, in centro bastano 10 km/h. Qui si stima il tempo
// di guida fino a ogni fermata: marcia all'85% del limite del tratto (maxspeed OSM, altrimenti 30 in centro e 50 fuori)
// più un tempo fisso per ogni fermata (frenata, porte, ripartenza).
const STOP_TIME = 22;
const segTime = (sg, p) => sg.len / ((Math.min(50, sg.edge.speed || (zoneOf(p.x, p.z) === 0 ? 30 : 50)) / 3.6) * 0.85);
export function drivingTimes(net, variant) {
  const route = buildRoute(net, variant);
  const { segs, cum, pts, stops } = route;
  const T = [0];
  for (const sg of segs) T.push(T[T.length - 1] + segTime(sg, pts[sg.i]));
  const runAt = (s) => {
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const l = cum[hi] - cum[lo] || 1;
    return T[lo] + (T[hi] - T[lo]) * Math.max(0, Math.min(1, (s - cum[lo]) / l));
  };
  const t0 = runAt(stops[0].s);
  return stops.map((st, k) => runAt(st.s) - t0 + k * STOP_TIME);
}
// la durata reale della corsa resta quella del GTFS, ripartita tra le fermate come il tempo di guida stimato
export function paceVariant(net, variant) {
  const w = drivingTimes(net, variant), tot = w[w.length - 1] || 1;
  variant.offsets = w.map((x) => Math.round((x / tot) * variant.duration));
  variant.minDur = Math.round(tot * 0.9);
}
