// Comandi touch per smartphone e tablet: volante e pedali analogici, pulsanti per le funzioni del bus.
// I pulsanti simulano i tasti della tastiera (stessa logica di onKeyPress), volante e pedali danno valori continui.

export const isTouchDevice = () =>
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class TouchControls {
  // press(code): come la pressione di un tasto; keys: Set dei tasti tenuti premuti (per i comandi "a pressione")
  constructor({ press, keys }) {
    this.press = press;
    this.keys = keys;
    this.state = { steer: null, gas: 0, brake: 0 };
    this.enabled = false;
    this.root = document.getElementById('touch');
    this.extras = document.getElementById('t-extras');
    this.setupWheel();
    this.setupPedal('t-gas', 'gas', 'KeyW');
    this.setupPedal('t-brake', 'brake', 'KeyS');
    this.setupButtons();
    window.addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch');
  }

  release() {
    this.state.steer = null; this.state.gas = 0; this.state.brake = 0;
    this.keys.delete('KeyH');
    this.root.querySelectorAll('.held').forEach((el) => el.classList.remove('held'));
    this.drawWheel(0);
    this.drawPedal('t-gas', 0); this.drawPedal('t-brake', 0);
  }

  // un dito trascinato orizzontalmente gira il volante: ±75 px = sterzo a fondo
  setupWheel() {
    const el = document.getElementById('t-wheel');
    this.wheelEl = el.querySelector('.rim');
    let id = null, x0 = 0;
    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId; x0 = e.clientX;
      el.setPointerCapture(id);
      this.state.steer = 0;
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const a = clamp((e.clientX - x0) / 75, -1, 1);
      // a destra il volante gira in senso orario: nel bus sterzo positivo = sinistra
      this.state.steer = -Math.sign(a) * Math.abs(a) ** 1.3;
      this.drawWheel(a);
    });
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.state.steer = null; this.drawWheel(0);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  drawWheel(a) { if (this.wheelEl) this.wheelEl.style.transform = `rotate(${a * 135}deg)`; }

  // pedale: più in alto lo premi, più forza (in basso ~35 %, in cima 100 %)
  setupPedal(elId, key, code) {
    const el = document.getElementById(elId);
    let id = null;
    const val = (e) => {
      const r = el.getBoundingClientRect();
      return clamp(0.35 + 0.65 * (1 - (e.clientY - r.top) / r.height), 0.35, 1);
    };
    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      el.setPointerCapture(id);
      el.classList.add('held');
      this.state[key] = val(e);
      this.drawPedal(elId, this.state[key]);
      this.press(code);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.state[key] = val(e);
      this.drawPedal(elId, this.state[key]);
    });
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.state[key] = 0;
      el.classList.remove('held');
      this.drawPedal(elId, 0);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  drawPedal(elId, v) {
    const f = document.querySelector(`#${elId} .fill`);
    if (f) f.style.height = Math.round(v * 100) + '%';
  }

  setupButtons() {
    this.root.querySelectorAll('[data-key]').forEach((b) => {
      const code = b.dataset.key;
      if (b.dataset.hold !== undefined) {
        // comando tenuto premuto (clacson)
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('held'); this.keys.add(code); this.press(code); });
        const up = () => { b.classList.remove('held'); this.keys.delete(code); };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
      } else {
        b.addEventListener('pointerdown', (e) => e.preventDefault()); // niente focus né zoom
        b.addEventListener('click', () => {
          this.press(code);
          if (b.closest('#t-extras')) this.showExtras(false);
        });
      }
    });
    document.getElementById('t-close').addEventListener('click', () => this.showExtras(false));
    document.getElementById('t-more').addEventListener('click', () => this.showExtras(this.extras.hidden));
    document.getElementById('t-fullscreen').addEventListener('click', () => { this.toggleFullscreen(); this.showExtras(false); });
    if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) document.getElementById('t-fullscreen').hidden = true;
  }

  showExtras(v) { this.extras.hidden = !v; }

  // a schermo intero e in orizzontale, dove il browser lo consente (va chiamato da un gesto dell'utente)
  goFullscreen() {
    const d = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = d.requestFullscreen || d.webkitRequestFullscreen;
    if (!req) return;
    try {
      const p = req.call(d, { navigationUI: 'hide' });
      if (p && p.then) p.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    } catch { /* non supportato */ }
  }

  toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else this.goFullscreen();
  }
}
