import * as THREE from 'three';

// Gocce di pioggia sul parabrezza (bus e tram): una texture su canvas appena dietro il vetro, che si vede dal posto di
// guida e da fuori. Con la pioggia arrivano gocce nuove, di più in marcia; quando smette il vetro si asciuga piano.
// Ogni spazzola pulisce il settore che ha spazzato dall'ultimo aggiornamento.
// Coordinate in metri nel piano del vetro, origine al centro, y verso l'alto.
const TICK = 1 / 12;
let sprite = null;
function dropSprite() {
  if (sprite) return sprite;
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const x = c.getContext('2d');
  // riflesso chiaro in alto a sinistra, bordo scuro: la goccia fa da lente
  const g = x.createRadialGradient(9, 9, 1, 12, 12, 12);
  g.addColorStop(0, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.35, 'rgba(205,218,230,0.22)');
  g.addColorStop(0.8, 'rgba(55,66,78,0.5)');
  g.addColorStop(1, 'rgba(55,66,78,0)');
  x.fillStyle = g;
  x.beginPath(); x.arc(12, 12, 12, 0, Math.PI * 2); x.fill();
  return (sprite = c);
}

export class RainGlass {
  constructor(w, h, res = 512) {
    this.w = w; this.h = h;
    const c = document.createElement('canvas');
    c.width = res; c.height = Math.round((res * h) / w);
    this.canvas = c; this.ctx = c.getContext('2d');
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.renderOrder = 2; // dopo il vetro, a un paio di centimetri
    this.mesh.visible = false;
    this.t = 0; this.fadeT = 0;
    this.dryT = 0; // secondi di vetro ancora bagnato dopo l'ultima pioggia
    this.prev = [];
  }
  px(x) { return (x / this.w + 0.5) * this.canvas.width; }
  py(y) { return (0.5 - y / this.h) * this.canvas.height; }
  // rain 0-1, speed m/s; wipers: [{ x, y, len, a }] perno, lunghezza della spazzola e angolo (punta verso (-sin a, cos a))
  update(dt, rain, speed, wipers = []) {
    this.t += dt;
    if (this.t < TICK) return;
    const T = this.t, x = this.ctx, C = this.canvas;
    this.t = 0;
    const raining = rain > 0.02;
    if (raining) this.dryT = 30;
    else if ((this.dryT -= T) <= 0) {
      if (this.mesh.visible) { x.clearRect(0, 0, C.width, C.height); this.tex.needsUpdate = true; this.mesh.visible = false; }
      this.prev = wipers.map((w) => w.a);
      return;
    }
    this.mesh.visible = true;
    x.globalCompositeOperation = 'destination-out';
    // asciugatura: lenta sotto la pioggia, più svelta quando smette (a scatti di un secondo: con passi piccoli
    // l'alfa a 8 bit non scende più sotto una certa soglia)
    if ((this.fadeT += T) >= 1) {
      this.fadeT = 0;
      x.fillStyle = `rgba(0,0,0,${raining ? 0.04 : 0.14})`;
      x.fillRect(0, 0, C.width, C.height);
    }
    // spazzole: il settore tra la posizione di prima e quella di adesso
    x.fillStyle = '#000';
    wipers.forEach((w, i) => {
      const a0 = this.prev[i] ?? w.a, a1 = w.a;
      if (Math.abs(a1 - a0) < 1e-4) return;
      const lo = Math.min(a0, a1) - 0.03, hi = Math.max(a0, a1) + 0.03;
      x.beginPath();
      x.moveTo(this.px(w.x), this.py(w.y));
      for (let a = lo; ; a = Math.min(hi, a + 0.05)) {
        x.lineTo(this.px(w.x - Math.sin(a) * w.len), this.py(w.y + Math.cos(a) * w.len));
        if (a >= hi) break;
      }
      x.closePath();
      x.fill();
    });
    this.prev = wipers.map((w) => w.a);
    // gocce nuove: in marcia il vetro ne prende molte di più
    x.globalCompositeOperation = 'source-over';
    const n = Math.floor(rain * (9 + 1.4 * speed) * this.w * this.h * T + Math.random());
    const sp = dropSprite(), ppm = C.width / this.w;
    for (let k = 0; k < n; k++) {
      const s = (0.012 + Math.random() ** 3 * 0.028) * ppm; // da 1 a 4 cm
      x.drawImage(sp, Math.random() * C.width - s / 2, Math.random() * C.height - s / 2, s, s);
    }
    this.tex.needsUpdate = true;
  }
}

// fase dei tergicristalli: con la pioggia vanno avanti e indietro, quando smette finiscono la corsa e si fermano a
// riposo (fase PARK, dove sin = -1)
export const WIPER_PARK = Math.PI * 1.5;
export function wiperPhase(t, on, dt, rate = 2.4) {
  const TAU = Math.PI * 2, k = (t - WIPER_PARK) / TAU;
  if (!on && Math.abs(k - Math.round(k)) < 1e-6) return t;
  const t2 = t + dt * rate;
  return on ? t2 : Math.min(t2, WIPER_PARK + Math.ceil(k) * TAU);
}
