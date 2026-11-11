// Gamepad e volante con pedaliera (Gamepad API).
// Il gamepad con la mappatura standard (Xbox, PlayStation e simili) va subito: levetta sinistra = volante, grilletti =
// gas e freno, pulsanti = tasti della tastiera (stessa logica di onKeyPress, come i pulsanti touch). Volanti e
// pedaliere hanno assi diversi da modello a modello: si insegnano una volta dalla pausa e restano in questo browser;
// prima vanno solo i pulsanti principali.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CAL_KEY = 'padova-bus-sim-volante';

// pulsanti della mappatura standard: [indice, tasto con l'autobus, tasto con il tram]
const STD_PRESS = [
  [0, 'KeyF', 'KeyF'], // A / croce: porte
  [1, 'Space', 'Space'], // B / cerchio: freno a mano
  [2, 'KeyO', 'KeyO'], // X / quadrato: pantografo (colonnina di ricarica col bus elettrico, linea aerea col tram)
  [3, 'KeyC', 'KeyC'], // Y / triangolo: visuale
  [4, 'KeyQ', 'KeyQ'], // LB: freccia a sinistra
  [5, 'KeyE', 'KeyE'], // RB: freccia a destra
  [8, 'KeyM', 'KeyM'], // View / Share: mappa
  [9, 'KeyP', 'KeyP'], // Menu / Options: pausa
  [11, 'KeyV', 'KeyV'], // clic della levetta destra: sguardo in avanti
  [12, 'KeyT', 'KeyT'], // croce su: salta l'attesa
  [13, 'KeyK', 'KeyB'], // croce giù: inginocchiamento; tram: cambio cabina
];
// pulsanti tenuti premuti: [indice, tasto]
const STD_HOLD = [[10, 'KeyH'], [14, 'KeyZ'], [15, 'KeyX']]; // clic levetta sinistra: clacson; croce ◀ ▶: guarda ai lati
// volanti e pedaliere: solo i pulsanti che hanno lo stesso posto quasi su tutti (le palette cambiano da modello a modello)
const WHEEL_PRESS = STD_PRESS.filter(([i]) => i <= 3 || i === 8 || i === 9);

// assi e, dopo, valori dei pulsanti: su alcuni volanti i pedali sono pulsanti analogici (come i grilletti)
const values = (p) => [...p.axes, ...p.buttons.map((b) => b.value)];

function loadCal() {
  try { return JSON.parse(localStorage.getItem(CAL_KEY) || '{}') || {}; } catch (e) { return {}; }
}

export class GamepadControls {
  // press(code): come la pressione di un tasto; keys: Set dei tasti tenuti premuti; onChange(): gamepad collegato o
  // scollegato, passo dell'impostazione di volante e pedali cambiato
  constructor({ press, keys, onChange }) {
    this.press = press;
    this.keys = keys;
    this.onChange = onChange || (() => {});
    // steer null = il gamepad non sterza (si usano tastiera o touch), -1..1 con sinistra positiva come nel bus
    this.state = { steer: null, gas: 0, brake: 0 };
    this.pad = null; // ultimo gamepad letto
    this.isTram = false;
    this.steerActive = false; // la levetta o il volante si sono mossi dopo l'ultimo tasto di sterzo
    this.prev = []; // pulsanti premuti al passo precedente
    this.held = new Set(); // tasti che il gamepad tiene in keys
    this.prevBrake = 0;
    this.cal = loadCal();
    this.learn = null; // impostazione di volante e pedali in corso
    window.addEventListener('gamepaddisconnected', () => { this.pad = null; this.release(); this.onChange(); });
  }

  get connected() { return !!this.pad; }
  get standard() { return !!this.pad && this.pad.mapping === 'standard'; }
  get calibration() { return this.pad ? this.cal[this.pad.id] || null : null; }

  // tastiera: un tasto di sterzo ridà lo sterzo ai tasti finché la levetta non si muove di nuovo
  keyboardSteer() { this.steerActive = false; }

  release() {
    for (const c of this.held) this.keys.delete(c);
    this.held.clear();
    this.state.steer = null; this.state.gas = 0; this.state.brake = 0;
    this.prev = [];
  }

  first() {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of list || []) if (p && p.connected !== false) return p;
    return null;
  }

  // da chiamare a ogni passo (anche in pausa e nel menu): legge il gamepad, manda i tasti, aggiorna state
  poll(dt) {
    const p = this.first();
    const was = this.pad;
    this.pad = p;
    if (!p) { if (was) { this.release(); this.onChange(); } return; }
    if (!was || was.id !== p.id) { this.release(); this.onChange(); }
    if (this.learn) { this.learnStep(p, dt); this.state.steer = null; this.state.gas = 0; this.state.brake = 0; return; }
    const std = p.mapping === 'standard';
    const btn = (i) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
    const now = [];
    for (let i = 0; i < p.buttons.length; i++) now[i] = btn(i);
    for (const [i, bus, tram] of std ? STD_PRESS : WHEEL_PRESS) if (now[i] && !this.prev[i]) this.press(this.isTram ? tram : bus);
    // tasti a pressione: clacson e sguardo ai lati (anche con la levetta destra)
    const want = new Set();
    if (std) {
      for (const [i, code] of STD_HOLD) if (now[i]) want.add(code);
      const rx = p.axes[2] || 0;
      if (rx < -0.5) want.add('KeyZ');
      if (rx > 0.5) want.add('KeyX');
    }
    for (const c of this.held) if (!want.has(c)) { this.keys.delete(c); this.held.delete(c); }
    for (const c of want) if (!this.held.has(c)) { this.keys.add(c); this.held.add(c); }
    this.prev = now;

    // volante e pedali: quelli impostati dalla pausa, altrimenti levetta e grilletti del gamepad standard. Senza
    // impostazione un volante non sterza (un asse a caso potrebbe essere un pedale e girare il bus da solo)
    let steer = null, gas = 0, brake = 0;
    const c = this.cal[p.id];
    if (c) {
      const v = values(p);
      if (c.steer) {
        const x = v[c.steer.axis] || 0;
        steer = clamp(x * c.steer.left, -1, 1);
        if (Math.abs(x) > 0.03) this.steerActive = true;
      }
      gas = this.pedal(v, c.gas);
      brake = this.pedal(v, c.brake);
    } else if (std) {
      const x = p.axes[0] || 0, dz = 0.15;
      const a = Math.abs(x) < dz ? 0 : (Math.abs(x) - dz) / (1 - dz);
      // più fine vicino al centro; a destra (x > 0) lo sterzo del bus è negativo
      steer = -Math.sign(x) * a ** 1.5;
      if (a > 0) this.steerActive = true;
      gas = this.trigger(p.buttons[7]);
      brake = this.trigger(p.buttons[6]);
    }
    this.state.steer = this.steerActive ? steer : null;
    this.state.gas = gas;
    this.state.brake = brake;
    // il freno premuto da fermo inserisce la retromarcia, come S
    if (brake > 0.3 && this.prevBrake <= 0.3) this.press('KeyS');
    this.prevBrake = brake;
  }

  trigger(b) {
    const v = b ? b.value : 0;
    return v < 0.05 ? 0 : (v - 0.05) / 0.95;
  }

  // pedale imparato: rest = lasciato, full = a fondo. Alcune pedaliere danno 0 finché non si toccano la prima volta
  pedal(vals, c) {
    if (!c) return 0;
    const a = vals[c.axis];
    if (a == null || (a === 0 && Math.abs(c.rest) > 0.5)) return 0;
    const v = clamp((a - c.rest) / (c.full - c.rest), 0, 1);
    return v < 0.04 ? 0 : v;
  }

  // ---------------- impostazione di volante e pedali ----------------
  // tre passi: volante tutto a sinistra, gas a fondo e poi lasciato, freno a fondo e poi lasciato
  startLearn() {
    if (!this.pad) return;
    this.release();
    this.learn = { step: 'steer', phase: 'press', start: null, still: 0, last: null, out: {} };
    this.onChange();
  }

  cancelLearn() { this.learn = null; this.onChange(); }

  learnText() {
    const L = this.learn;
    if (!L) return '';
    if (L.step === 'steer') return 'Gira il volante tutto a sinistra e tienilo lì.';
    const nm = L.step === 'gas' ? 'il gas' : 'il freno';
    return L.phase === 'press' ? `Premi a fondo ${nm} e tienilo premuto.` : `Ora lascia ${nm}.`;
  }

  learnStep(p, dt) {
    const L = this.learn, axes = values(p);
    if (!L.start) { L.start = axes; L.last = axes; return; }
    const used = new Set(Object.values(L.out).map((c) => c.axis));
    // asse più lontano dalla posizione di partenza, tra quelli non ancora usati
    let best = -1, dev = 0;
    for (let i = 0; i < axes.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(axes[i] - L.start[i]);
      if (d > dev) { dev = d; best = i; }
    }
    // fermo: nessun asse si è mosso dal passo precedente
    const moved = axes.some((a, i) => Math.abs(a - L.last[i]) > 0.02);
    L.still = moved ? 0 : L.still + dt;
    L.last = axes;
    if (L.phase === 'press') {
      if (dev < 0.5 || L.still < 0.5) return;
      if (L.step === 'steer') {
        L.out.steer = { axis: best, left: Math.sign(axes[best] - L.start[best]) || -1 };
        this.nextLearn('gas');
      } else {
        L.axis = best; L.full = axes[best];
        L.phase = 'release'; L.still = 0;
        this.onChange();
      }
    } else if (L.still >= 0.5 && Math.abs(axes[L.axis] - L.full) > 0.5) {
      L.out[L.step] = { axis: L.axis, rest: axes[L.axis], full: L.full };
      if (L.step === 'gas') this.nextLearn('brake');
      else {
        this.cal[p.id] = L.out;
        try { localStorage.setItem(CAL_KEY, JSON.stringify(this.cal)); } catch (e) { /* ignorato */ }
        this.learn = null;
        // ricomincia da fermo: niente tasti né retromarcia per i pulsanti e il freno toccati durante l'impostazione
        this.prev = p.buttons.map((b) => b.pressed || b.value > 0.5);
        this.prevBrake = 1;
        this.onChange();
      }
    }
  }

  nextLearn(step) {
    const L = this.learn;
    L.step = step; L.phase = 'press'; L.start = L.last; L.still = 0;
    this.onChange();
  }
}
