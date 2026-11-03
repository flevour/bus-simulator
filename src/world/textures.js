import * as THREE from 'three';
import { mulberry32 } from './spatial.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function noise(ctx, w, h, amount, rnd, alpha = 0.08) {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

export function makeTex(c, repeat = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

// Asfalto con segnaletica: u attraverso la strada, v lungo (1 = 12 m)
export function roadTexture() {
  const [c, x] = canvas(256, 512);
  const rnd = mulberry32(7);
  x.fillStyle = '#3c3d40';
  x.fillRect(0, 0, 256, 512);
  noise(x, 256, 512, 9000, rnd, 0.12);
  // toppe di asfalto
  for (let i = 0; i < 6; i++) {
    x.fillStyle = `rgba(20,20,22,${0.15 + rnd() * 0.15})`;
    x.fillRect(rnd() * 200, rnd() * 480, 20 + rnd() * 60, 20 + rnd() * 50);
  }
  // tracce delle ruote
  x.fillStyle = 'rgba(25,25,28,0.25)';
  for (const u of [0.17, 0.33, 0.67, 0.83]) x.fillRect(u * 256 - 10, 0, 20, 512);
  // linee laterali continue
  x.fillStyle = '#e8e8e0';
  x.fillRect(8, 0, 5, 512);
  x.fillRect(256 - 13, 0, 5, 512);
  // linea di mezzeria tratteggiata (4.5 m pieno, 7.5 vuoto)
  x.fillRect(126, 0, 5, 512 * (4.5 / 12));
  return makeTex(c);
}

export function intersectionTexture() {
  const [c, x] = canvas(256, 256);
  const rnd = mulberry32(9);
  x.fillStyle = '#3a3b3e';
  x.fillRect(0, 0, 256, 256);
  noise(x, 256, 256, 5000, rnd, 0.12);
  return makeTex(c);
}

export function sidewalkTexture() {
  const [c, x] = canvas(256, 256);
  const rnd = mulberry32(3);
  x.fillStyle = '#a39c92';
  x.fillRect(0, 0, 256, 256);
  // lastre di pietra / porfido
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      const v = 140 + Math.floor(rnd() * 40);
      x.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
      x.fillRect(i * 32 + 1, j * 32 + 1, 30, 30);
    }
  noise(x, 256, 256, 3000, rnd, 0.1);
  return makeTex(c);
}

export function grassTexture() {
  const [c, x] = canvas(512, 512);
  const rnd = mulberry32(5);
  x.fillStyle = '#5d7a3e';
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60; i++) {
    const g = 90 + rnd() * 60;
    x.fillStyle = `rgba(${g * 0.6},${g},${g * 0.4},0.25)`;
    x.beginPath();
    x.arc(rnd() * 512, rnd() * 512, 20 + rnd() * 60, 0, 7);
    x.fill();
  }
  noise(x, 512, 512, 20000, rnd, 0.1);
  return makeTex(c);
}

export function groundTexture() {
  // terreno urbano: misto erba / terra / asfalto
  const [c, x] = canvas(512, 512);
  const rnd = mulberry32(11);
  x.fillStyle = '#6f7a5a';
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const r = rnd();
    x.fillStyle = r < 0.4 ? 'rgba(120,110,90,0.25)' : r < 0.7 ? 'rgba(80,110,60,0.3)' : 'rgba(95,95,95,0.2)';
    x.beginPath();
    x.arc(rnd() * 512, rnd() * 512, 15 + rnd() * 70, 0, 7);
    x.fill();
  }
  noise(x, 512, 512, 25000, rnd, 0.08);
  return makeTex(c);
}

export function waterTexture() {
  const [c, x] = canvas(256, 256);
  const rnd = mulberry32(13);
  x.fillStyle = '#3d5d63';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 300; i++) {
    x.strokeStyle = `rgba(200,230,230,${0.05 + rnd() * 0.08})`;
    x.beginPath();
    const px = rnd() * 256, py = rnd() * 256;
    x.moveTo(px, py);
    x.lineTo(px + 10 + rnd() * 20, py + rnd() * 2);
    x.stroke();
  }
  return makeTex(c);
}

export function railTexture() {
  const [c, x] = canvas(128, 256);
  const rnd = mulberry32(17);
  x.fillStyle = '#6b6259';
  x.fillRect(0, 0, 128, 256);
  noise(x, 128, 256, 6000, rnd, 0.2);
  // traversine e binari (due binari)
  for (const off of [16, 72]) {
    x.fillStyle = '#4a3b2e';
    for (let j = 0; j < 256; j += 16) x.fillRect(off, j, 40, 7);
    x.fillStyle = '#9a9aa0';
    x.fillRect(off + 7, 0, 3, 256);
    x.fillRect(off + 30, 0, 3, 256);
  }
  return makeTex(c);
}

// Testo su tabella (es. nome fermata)
export function labelTexture(text, opts = {}) {
  const { w = 512, h = 128, bg = '#0b3d91', fg = '#ffffff', font = 'bold 56px Arial', border = null } = opts;
  const [c, x] = canvas(w, h);
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  if (border) { x.strokeStyle = border; x.lineWidth = 8; x.strokeRect(4, 4, w - 8, h - 8); }
  x.fillStyle = fg;
  x.font = font;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  let size = parseInt(font.match(/(\d+)px/)[1]);
  while (x.measureText(text).width > w - 30 && size > 12) {
    size -= 2;
    x.font = font.replace(/\d+px/, size + 'px');
  }
  x.fillText(text, w / 2, h / 2 + 2);
  return makeTex(c, false);
}

// Display a LED arancione per il bus
export function ledTexture(line, dest, w = 1024, h = 128) {
  const [c, x] = canvas(w, h);
  x.fillStyle = '#080808';
  x.fillRect(0, 0, w, h);
  const draw = () => {
    x.fillStyle = '#ffa31a';
    x.textBaseline = 'middle';
    x.font = 'bold 92px "Courier New", monospace';
    x.textAlign = 'left';
    x.fillText(line, 20, h / 2 + 4);
    let size = 72;
    x.font = `bold ${size}px Arial`;
    const avail = w - 260;
    while (x.measureText(dest).width > avail && size > 20) { size -= 2; x.font = `bold ${size}px Arial`; }
    x.textAlign = 'center';
    x.fillText(dest, 240 + avail / 2, h / 2 + 4);
  };
  draw();
  // griglia LED
  x.fillStyle = 'rgba(0,0,0,0.45)';
  for (let i = 0; i < w; i += 6) x.fillRect(i, 0, 2, h);
  for (let j = 0; j < h; j += 6) x.fillRect(0, j, w, 2);
  const t = makeTex(c, false);
  return t;
}
