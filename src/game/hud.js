import { fmtHM } from '../data/padova.js';
import { fmtDelay } from './mission.js';

const $ = (id) => document.getElementById(id);

// navigatore: freccia e frasi per la manovra di Mission.navInfo
const side = (dir) => (dir === 'left' ? 'sinistra' : 'destra');
function navArrow(nav) {
  if (nav.dir === 'roundabout') return '↺';
  if (nav.dir === 'uturn') return '↶';
  if (nav.dir === 'straight') return '⬆';
  if (nav.keep) return nav.dir === 'left' ? '⬉' : '⬈';
  if (nav.sharp) return nav.dir === 'left' ? '↰' : '↱';
  return nav.dir === 'left' ? '⬅' : '➡';
}
// la manovra in poche parole: "a destra", "alla rotonda 2ª uscita", ...
function navWhat(m) {
  if (m.dir === 'roundabout') return `alla rotonda ${m.exit}ª uscita`;
  if (m.dir === 'uturn') return 'inversione a U';
  return `${m.keep ? 'tieni la' : 'a'} ${side(m.dir)}`;
}
function navText(nav) {
  const m = Math.round(nav.dist / 10) * 10;
  if (nav.dir === 'straight') return nav.dist > 1500 ? 'Prosegui dritto' : `Prosegui per ${m} m`;
  if (nav.inside) return nav.exit > 1 ? `Esci alla ${nav.exit}ª uscita` : 'Esci alla prossima uscita';
  if (nav.dist > 1200) return `Prosegui, poi ${navWhat(nav)} tra ${(nav.dist / 1000).toFixed(1)} km`;
  if (nav.dir === 'roundabout') return `Tra ${m} m alla rotonda ${nav.exit}ª uscita`;
  if (nav.dir === 'uturn') return `Tra ${m} m inversione a U`;
  return `Tra ${m} m ${nav.keep ? 'tieni la' : 'svolta a'} ${side(nav.dir)}`;
}

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
    $('clock').classList.toggle('ff', !!m.fastForward);
    $('panel-line').classList.toggle('free', !!m.free);
    if (m.free) {
      $('next-stop').textContent = ctx.street || '—';
      $('stops-progress').textContent = 'Giro libero';
    }
    const st = m.free ? null : m.stops[m.nextStop];
    if (st) {
      $('next-stop').textContent = st.name + (st.terminal && st.idx > 0 && !m.transfer ? ' (capolinea)' : '');
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
    if (!m.free) $('stops-progress').textContent = m.transfer ? 'Fuori servizio' : `Fermata ${Math.min(m.nextStop + 1, m.stops.length)}/${m.stops.length}`;
    const lbl = m.transfer ? 'Destinazione' : 'Prossima fermata';
    if ($('next-lbl').textContent !== lbl) $('next-lbl').textContent = lbl;
    // fermata a richiesta: prenotata, qualcuno in attesa, oppure si può passare dritti; il tram ferma sempre
    const rq = $('request');
    rq.hidden = !!m.tram;
    const ahead = st && !st.arrived && st.idx < m.stops.length - 1 && st.spawned;
    const nWait = ahead ? st.waiting.length : 0;
    const txt = m.request ? '🔔 FERMATA PRENOTATA' : nWait ? `👥 ${nWait} IN ATTESA: FERMATI` : ahead ? '⏩ NESSUNO: SI PUÒ PASSARE' : '🔔 FERMATA PRENOTATA';
    if (rq.textContent !== txt) rq.textContent = txt;
    rq.classList.toggle('on', m.request);
    rq.classList.toggle('wait', !m.request && nWait > 0);
    rq.classList.toggle('pass', !m.request && ahead && !nWait);
    $('pax').textContent = m.onboard.length;
    $('score').textContent = m.score;
    const cb = $('comfort-bar');
    cb.style.width = m.comfort + '%';
    cb.style.background = m.comfort > 70 ? '#4caf50' : m.comfort > 40 ? '#ffb300' : '#e53935';
    $('limit').textContent = ctx.speedLimit;
    $('limit-sign').classList.toggle('over', bus.speedKmh > ctx.speedLimit + 3);

    // navigazione
    $('nav').style.display = m.free ? 'none' : '';
    const nav = m.free ? { dist: 0, dir: 'straight', street: '' } : m.navInfo();
    $('nav-arrow').textContent = navArrow(nav);
    $('nav-dist').textContent = navText(nav);
    $('nav-street').textContent = nav.then ? `${nav.street ? nav.street + ', ' : ''}poi ${navWhat(nav.then)}` : nav.street;
    $('nav').classList.toggle('warn', m.proj && m.proj.d > 40);
    $('offroute').style.display = !m.free && m.proj && m.proj.d > 40 ? 'block' : 'none';

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
    if (bus.isTram) dial(W - 80, 80, 66, Math.max(0, bus.powerKw), 500, 50, bus.powerKw < -2 ? 'REC' : bus.wired ? 'T' : 'BAT', 'kW', bus.powerKw < -2 ? '#66bb6a' : bus.wired ? '#4fc3f7' : '#ffb74d');
    else if (bus.electric) dial(W - 80, 80, 66, Math.max(0, bus.powerKw), 200, 25, bus.dir < 0 ? 'R' : bus.powerKw < -2 ? 'REC' : 'E', 'kW', bus.powerKw < -2 ? '#66bb6a' : '#a6d22e');
    else dial(W - 80, 80, 66, bus.rpm, 2500, 250, bus.dir < 0 ? 'R' : bus.speedKmh < 0.5 && bus.throttle < 0.05 ? 'D' : 'D' + bus.gear, 'rpm', '#4fc3f7');
    // pedali
    const bar = (x, v, col, lbl) => {
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x, 30, 10, 100);
      c.fillStyle = col; c.fillRect(x, 30 + 100 * (1 - v), 10, 100 * v);
      c.fillStyle = '#b0bec5'; c.font = '10px Arial'; c.textAlign = 'center'; c.fillText(lbl, x + 5, 145);
    };
    bar(W / 2 - 18, bus.throttle, '#66bb6a', bus.isTram ? 'TRAZ.' : 'GAS');
    bar(W / 2 + 8, bus.brake, '#ef5350', 'FRENO');
    if (bus.isTram) {
      // pantografo e batteria
      c.fillStyle = bus.pantoPos > 0.97 ? '#4fc3f7' : bus.pantoPos < 0.03 ? '#ffb74d' : '#cfd8dc';
      c.font = 'bold 11px Arial'; c.textAlign = 'center';
      c.fillText(bus.pantoPos > 0.97 ? 'PANT ▲' : bus.pantoPos < 0.03 ? 'PANT ▼' : 'PANT …', W / 2 - 5, 14);
      c.fillStyle = bus.battery < 0.2 ? '#ef5350' : '#b0bec5';
      c.fillText(`BATT ${Math.round(bus.battery * 100)}%`, W / 2 - 5, 157);
    } else if (bus.electric) {
      // bus elettrico: batteria e, alla colonnina del capolinea, potenza di ricarica
      c.font = 'bold 11px Arial'; c.textAlign = 'center';
      if (bus.chargeKw > 0) { c.fillStyle = '#4fc3f7'; c.fillText(`⚡ ${Math.round(bus.chargeKw)} kW`, W / 2 - 5, 14); }
      c.fillStyle = bus.battery < 0.2 ? '#ef5350' : '#b0bec5';
      c.fillText(`BATT ${Math.round(bus.battery * 100)}%`, W / 2 - 5, 157);
    }
  }

  drawMinimap(bus, m, ctx) {
    const cv = this.mm, c = this.mmx;
    const W = cv.width, H = cv.height;
    const big = this.big;
    const scale = big ? 0.12 : 0.32;
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
    const cxw = bus.x, czw = bus.z;
    if (big) this.bigView = { cx: cxw, cz: czw, scale, W, H };
    c.translate(-cxw, -czw);
    // acqua
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const w of ctx.net.water) {
      c.strokeStyle = '#3b6f8a'; c.lineWidth = w.width;
      c.beginPath(); w.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.z) : c.moveTo(p.x, p.z))); c.stroke();
    }
    // strade
    for (const pass of [0, 1]) {
      c.strokeStyle = pass ? '#c9ccd0' : '#7b8086';
      for (const e of ctx.net.edges) {
        if (!!e.main !== !!pass) continue;
        const A = ctx.net.nodes[e.a], B = ctx.net.nodes[e.b];
        if (!big && Math.abs(A.x - bus.x) > 800 && Math.abs(B.x - bus.x) > 800) continue;
        if (!big && Math.abs(A.z - bus.z) > 800 && Math.abs(B.z - bus.z) > 800) continue;
        c.lineWidth = e.width * (big ? (pass ? 3 : 2) : (pass ? 1.6 : 1.1));
        c.beginPath(); c.moveTo(A.x, A.z); c.lineTo(B.x, B.z); c.stroke();
      }
    }
    // percorso
    if (!m.free) {
      c.strokeStyle = m.transfer ? '#90a4ae' : m.line.color; c.lineWidth = big ? 30 : 8;
      c.beginPath(); m.route.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.z) : c.moveTo(p.x, p.z))); c.stroke();
    }
    // fermate
    for (const st of m.free ? [] : m.stops) {
      c.fillStyle = st.idx === m.nextStop ? '#ffeb3b' : st.left || st.arrived ? '#607d8b' : '#ffffff';
      c.beginPath(); c.arc(st.x, st.z, (big ? 40 : 9) * (st.idx === m.nextStop ? 1.5 : 1), 0, 7); c.fill();
    }
    // bus automatici, col colore della linea (nella mappa grande tutti quelli in servizio)
    if (ctx.buses) for (const b of ctx.buses.buses) {
      if (!big && (Math.abs(b.x - bus.x) > 800 || Math.abs(b.z - bus.z) > 800)) continue;
      c.fillStyle = b.run.L.color;
      c.strokeStyle = '#fff'; c.lineWidth = big ? 8 : 1.5;
      c.beginPath(); c.arc(b.x, b.z, big ? 30 : 6, 0, 7); c.fill(); c.stroke();
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
    c.restore();
    // bus: freccia a dimensione fissa con alone pulsante
    const bx = big ? W / 2 + (bus.x - cxw) * scale : W / 2, by = big ? H / 2 + (bus.z - czw) * scale : H / 2;
    const ang = big ? Math.PI - bus.h : 0;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
    c.save();
    c.translate(bx, by);
    c.fillStyle = `rgba(255,109,0,${0.18 + pulse * 0.22})`;
    c.beginPath(); c.arc(0, 0, 15 + pulse * 5, 0, Math.PI * 2); c.fill();
    c.rotate(ang);
    c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 6;
    c.fillStyle = '#ff6d00'; c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(0, -14); c.lineTo(10, 11); c.lineTo(0, 5); c.lineTo(-10, 11); c.closePath();
    c.stroke(); c.fill();
    c.restore();
    if (big) {
      c.fillStyle = 'rgba(8,12,18,0.8)'; c.fillRect(0, H - 30, W, 30);
      c.fillStyle = '#fff'; c.font = 'bold 14px Arial'; c.textAlign = 'center';
      c.fillText('Clicca su una strada per teletrasportarti · M per chiudere', W / 2, H - 10);
    }
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
