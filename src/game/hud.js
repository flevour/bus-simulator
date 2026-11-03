import { fmtHM } from '../data/padova.js';
import { fmtDelay } from './mission.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.toastsEl = $('toasts');
    this.mm = $('minimap');
    this.mmx = this.mm.getContext('2d');
    this.big = false;
    this.cluster = $('cluster');
    this.cx = this.cluster.getContext('2d');
  }
  show(v) { $('hud').style.display = v ? 'block' : 'none'; }

  toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    this.toastsEl.prepend(el);
    while (this.toastsEl.children.length > 5) this.toastsEl.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4400);
  }

  setLine(line, dest) {
    $('line-badge').textContent = line.id;
    $('line-badge').style.background = line.color;
    $('line-dest').textContent = dest;
  }

  update(bus, m, ctx) {
    $('clock').textContent = fmtHM(m.clock, true);
    const st = m.stops[m.nextStop];
    if (st) {
      $('next-stop').textContent = st.name + (st.terminal && st.idx > 0 ? ' (capolinea)' : '');
      $('next-sched').textContent = fmtHM(st.sched);
      const est = m.clock + Math.max(0, st.s - m.s) / 7;
      const delay = (st.arrived ? m.clock : est) - st.sched;
      const el = $('next-delay');
      if (st.arrived && st.idx < m.stops.length - 1) {
        const w = st.sched - m.clock;
        el.textContent = w > 0 ? `partenza tra ${fmtDelay(w)}` : 'PRONTO A PARTIRE';
        el.className = w > 0 ? 'early' : 'ok';
      } else {
        el.textContent = (delay >= 0 ? '+' : '−') + fmtDelay(delay);
        el.className = delay > 120 ? 'late' : delay < -60 ? 'early' : 'ok';
      }
      $('next-dist').textContent = Math.max(0, Math.round(st.s - m.s)) + ' m';
    }
    $('stops-progress').textContent = `Fermata ${Math.min(m.nextStop + 1, m.stops.length)}/${m.stops.length}`;
    $('request').classList.toggle('on', m.request);
    $('pax').textContent = m.onboard.length;
    $('score').textContent = m.score;
    const cb = $('comfort-bar');
    cb.style.width = m.comfort + '%';
    cb.style.background = m.comfort > 70 ? '#4caf50' : m.comfort > 40 ? '#ffb300' : '#e53935';
    $('limit').textContent = ctx.speedLimit;
    $('limit-sign').classList.toggle('over', bus.speedKmh > ctx.speedLimit + 3);

    // navigazione
    const nav = m.navInfo();
    const arrows = { left: '⬅', right: '➡', straight: '⬆' };
    $('nav-arrow').textContent = nav.sharp ? (nav.dir === 'left' ? '↰' : '↱') : arrows[nav.dir];
    $('nav-dist').textContent = nav.dir === 'straight' ? (nav.dist > 1500 ? 'Prosegui dritto' : `Prosegui per ${Math.round(nav.dist / 10) * 10} m`) : nav.dist > 1200 ? `Prosegui, poi a ${nav.dir === 'left' ? 'sinistra' : 'destra'} tra ${(nav.dist / 1000).toFixed(1)} km` : `Tra ${Math.round(nav.dist / 10) * 10} m svolta a ${nav.dir === 'left' ? 'sinistra' : 'destra'}`;
    $('nav-street').textContent = nav.street;
    $('nav').classList.toggle('warn', m.proj && m.proj.d > 40);
    $('offroute').style.display = m.proj && m.proj.d > 40 ? 'block' : 'none';

    // stato bus
    const ind = $('ind');
    const blink = bus.blink % 0.8 < 0.4;
    ind.querySelector('.l').classList.toggle('on', blink && (bus.indicator === -1 || bus.indicator === 2));
    ind.querySelector('.r').classList.toggle('on', blink && (bus.indicator === 1 || bus.indicator === 2));
    $('icon-doors').classList.toggle('on', bus.doorsAnyOpen);
    $('icon-lights').classList.toggle('on', bus.lights);
    $('icon-park').classList.toggle('on', bus.parking);
    $('icon-kneel').classList.toggle('on', bus.kneelTarget > 0);
    $('icon-stopbrake').classList.toggle('on', bus.doorsAnyOpen);
    this.drawCluster(bus);
    this.drawMinimap(bus, m, ctx);
  }

  drawCluster(bus) {
    const c = this.cx, W = this.cluster.width, H = this.cluster.height;
    c.clearRect(0, 0, W, H);
    const dial = (cx, cy, r, val, max, step, label, unit, color) => {
      c.save();
      c.translate(cx, cy);
      c.fillStyle = 'rgba(8,10,14,0.82)';
      c.beginPath(); c.arc(0, 0, r + 8, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.15)'; c.lineWidth = 2; c.stroke();
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      c.lineWidth = 2;
      for (let v = 0; v <= max; v += step) {
        const a = a0 + (a1 - a0) * (v / max);
        const big = v % (step * 2) === 0;
        c.strokeStyle = '#cfd8dc';
        c.beginPath();
        c.moveTo(Math.cos(a) * (r - (big ? 12 : 7)), Math.sin(a) * (r - (big ? 12 : 7)));
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        c.stroke();
        if (big) {
          c.fillStyle = '#cfd8dc';
          c.font = '11px Arial';
          c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(unit === 'rpm' ? v / 1000 : v, Math.cos(a) * (r - 24), Math.sin(a) * (r - 24));
        }
      }
      const a = a0 + (a1 - a0) * Math.min(1, val / max);
      c.strokeStyle = color; c.lineWidth = 4;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6)); c.stroke();
      c.fillStyle = '#222'; c.beginPath(); c.arc(0, 0, 6, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.font = 'bold 22px Arial'; c.textAlign = 'center';
      c.fillText(label, 0, r * 0.45);
      c.font = '10px Arial'; c.fillStyle = '#90a4ae';
      c.fillText(unit, 0, r * 0.45 + 16);
      c.restore();
    };
    dial(80, 80, 66, bus.speedKmh, 80, 5, Math.round(bus.speedKmh), 'km/h', '#ff7043');
    dial(W - 80, 80, 66, bus.rpm, 2500, 250, bus.dir < 0 ? 'R' : bus.speedKmh < 0.5 && bus.throttle < 0.05 ? 'D' : 'D' + bus.gear, 'rpm', '#4fc3f7');
    // pedali
    const bar = (x, v, col, lbl) => {
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x, 30, 10, 100);
      c.fillStyle = col; c.fillRect(x, 30 + 100 * (1 - v), 10, 100 * v);
      c.fillStyle = '#b0bec5'; c.font = '10px Arial'; c.textAlign = 'center'; c.fillText(lbl, x + 5, 145);
    };
    bar(W / 2 - 18, bus.throttle, '#66bb6a', 'GAS');
    bar(W / 2 + 8, bus.brake, '#ef5350', 'FRENO');
  }

  drawMinimap(bus, m, ctx) {
    const cv = this.mm, c = this.mmx;
    const W = cv.width, H = cv.height;
    const big = this.big;
    const scale = big ? 0.09 : 0.32;
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath();
    if (big) c.rect(0, 0, W, H); else c.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    c.fillStyle = 'rgba(30,38,30,0.85)';
    c.fill();
    c.clip();
    c.translate(W / 2, H / 2);
    if (!big) c.rotate(-(Math.PI - bus.h)); // il bus punta verso l'alto
    c.scale(scale, scale);
    const cxw = big ? m.route.pts.reduce((a, p) => a + p.x, 0) / m.route.pts.length : bus.x;
    const czw = big ? m.route.pts.reduce((a, p) => a + p.z, 0) / m.route.pts.length : bus.z;
    c.translate(-cxw, -czw);
    // acqua
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const w of ctx.net.water) {
      c.strokeStyle = '#3b6f8a'; c.lineWidth = w.width;
      c.beginPath(); w.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.z) : c.moveTo(p.x, p.z))); c.stroke();
    }
    // strade
    c.strokeStyle = '#8c8f93';
    for (const e of ctx.net.edges) {
      const A = ctx.net.nodes[e.a], B = ctx.net.nodes[e.b];
      c.lineWidth = e.width * (big ? 2.5 : 1.3);
      c.beginPath(); c.moveTo(A.x, A.z); c.lineTo(B.x, B.z); c.stroke();
    }
    // percorso
    c.strokeStyle = m.line.color; c.lineWidth = big ? 30 : 8;
    c.beginPath(); m.route.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.z) : c.moveTo(p.x, p.z))); c.stroke();
    // fermate
    for (const st of m.stops) {
      c.fillStyle = st.idx === m.nextStop ? '#ffeb3b' : st.left || st.arrived ? '#607d8b' : '#ffffff';
      c.beginPath(); c.arc(st.x, st.z, (big ? 40 : 9) * (st.idx === m.nextStop ? 1.5 : 1), 0, 7); c.fill();
    }
    // auto
    if (!big) {
      c.fillStyle = '#d0d0d0';
      for (const car of ctx.traffic.cars) { c.beginPath(); c.arc(car.x, car.z, 2.2, 0, 7); c.fill(); }
      // semafori
      for (const s of ctx.lights.signals) for (const ap of s.appr) {
        const stt = ctx.lights.stateOf(s, ap.phase);
        c.fillStyle = stt === 'G' ? '#00e676' : stt === 'Y' ? '#ffc400' : '#ff1744';
        c.beginPath(); c.arc(ap.pos.x, ap.pos.z, 3, 0, 7); c.fill();
      }
    }
    // bus
    c.save();
    c.translate(bus.x, bus.z);
    c.rotate(-bus.h);
    const k = big ? 4 : 1;
    c.fillStyle = '#ff5722'; c.strokeStyle = '#fff'; c.lineWidth = 1.5 * k;
    c.beginPath(); c.moveTo(0, 9 * k); c.lineTo(5 * k, -6 * k); c.lineTo(-5 * k, -6 * k); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.restore();
    if (!big) {
      c.fillStyle = '#fff'; c.font = 'bold 12px Arial'; c.textAlign = 'center';
      // indicatore del nord
      const a = Math.PI - bus.h;
      c.fillText('N', W / 2 + Math.sin(-a) * (W / 2 - 14), H / 2 - Math.cos(-a) * (H / 2 - 14));
    }
  }

  setBigMap(v) {
    this.big = v;
    this.mm.classList.toggle('big', v);
    this.mm.width = v ? 640 : 220;
    this.mm.height = v ? 640 : 220;
  }
}
