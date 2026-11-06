import { WAVE_T } from '../world/driver.js';

// Saluto tra autisti: chi incrocia un collega (bus o tram che viene incontro) alza la mano. Con Y si saluta: punti se
// il collega è davanti a meno di 45 m, sulla sinistra o di fronte; a volte è lui a salutare per primo, e allora si
// ricambia in tempo (qualche secondo anche dopo averlo incrociato). Ogni collega si saluta una volta.
const AHEAD = 45, SIDE = 14, OFFER = 32, ANSWER_T = 5;
const who = (o) => (o.tram ? 'del tram' : `della linea ${o.line}`);

export class Greetings {
  constructor(hud, mission) {
    this.hud = hud; this.mission = mission;
    this.list = []; this.player = null; this.now = 0;
    this.offers = new Map(); // collega -> ora in cui ha salutato per primo
  }
  // distanza davanti al giocatore di un collega che viene incontro nella finestra del saluto, altrimenti null
  inWindow(o) {
    const p = this.player, fx = Math.sin(p.h), fz = Math.cos(p.h), rx = o.x - p.x, rz = o.z - p.z;
    const ahead = rx * fx + rz * fz, left = rx * fz - rz * fx;
    return Math.cos(o.h - p.h) < -0.7 && ahead > -3 && ahead < AHEAD && left > -2 && left < SIDE ? ahead : null;
  }
  // colleagues: [{ ref, x, z, h, line, tram }] (ref tiene lo stato: waveT, offered, greeted)
  update(dt, player, colleagues) {
    this.now += dt;
    this.player = player; this.list = colleagues;
    for (const o of colleagues) {
      const r = o.ref;
      if (r.greeted || r.offered) continue;
      const a = this.inWindow(o);
      if (a == null || a > OFFER) continue;
      r.offered = true;
      if (Math.random() < 0.45) {
        r.waveT = WAVE_T;
        this.offers.set(r, this.now);
        this.hud.toast(`👋 Il collega ${who(o)} ti saluta: Y per ricambiare`, 'info');
      }
    }
  }
  // il giocatore saluta: la mano sul cruscotto e, se c'è un collega nella finestra, il saluto conta
  press() {
    const el = document.getElementById('wave-hand');
    if (el) { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
    if (!this.player) return;
    let best = null, bd = Infinity;
    for (const o of this.list) {
      if (o.ref.greeted) continue;
      const a = this.inWindow(o), t = this.offers.get(o.ref);
      if (a == null && !(t != null && this.now - t < ANSWER_T)) continue;
      if ((a ?? 0) < bd) { bd = a ?? 0; best = o; }
    }
    if (!best) return;
    const r = best.ref, answered = this.offers.has(r), m = this.mission;
    r.greeted = true;
    if (!answered) r.waveT = WAVE_T;
    m.stats.waves = (m.stats.waves || 0) + 1;
    const msg = answered ? `👋 Saluto ricambiato al collega ${who(best)}` : `👋 Hai salutato il collega ${who(best)}, che ricambia`;
    if (m.roam) this.hud.toast(msg, 'good');
    else m.addScore(best.line === m.line.id ? 15 : 10, msg);
  }
}
