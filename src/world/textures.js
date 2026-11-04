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
// asfalto per strade a senso unico: solo linee laterali, nessuna mezzeria
export function roadTextureOneway() {
  const [c, x] = canvas(256, 512);
  const rnd = mulberry32(8);
  x.fillStyle = '#3c3d40';
  x.fillRect(0, 0, 256, 512);
  noise(x, 256, 512, 9000, rnd, 0.12);
  for (let i = 0; i < 6; i++) {
    x.fillStyle = `rgba(20,20,22,${0.15 + rnd() * 0.15})`;
    x.fillRect(rnd() * 200, rnd() * 480, 20 + rnd() * 60, 20 + rnd() * 50);
  }
  x.fillStyle = 'rgba(25,25,28,0.25)';
  for (const u of [0.3, 0.7]) x.fillRect(u * 256 - 12, 0, 24, 512);
  x.fillStyle = '#e8e8e0';
  x.fillRect(8, 0, 5, 512);
  x.fillRect(256 - 13, 0, 5, 512);
  return makeTex(c);
}

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

// corsie riservate del tram: asfalto rosso con le linee di bordo
export function tramLaneTexture() {
  const [c, x] = canvas(256, 256);
  const rnd = mulberry32(23);
  x.fillStyle = '#8a3a31';
  x.fillRect(0, 0, 256, 256);
  noise(x, 256, 256, 6000, rnd, 0.12);
  x.fillStyle = 'rgba(40,10,8,0.25)';
  for (const u of [0.22, 0.78]) x.fillRect(u * 256 - 14, 0, 28, 256);
  x.fillStyle = '#e8e2d8';
  x.fillRect(6, 0, 4, 256);
  x.fillRect(246, 0, 4, 256);
  return makeTex(c);
}

// singolo binario su massicciata (u attraverso, v lungo: 1 = 6 m)
export function railTexture1() {
  const [c, x] = canvas(64, 256);
  const rnd = mulberry32(19);
  x.fillStyle = '#6b6259';
  x.fillRect(0, 0, 64, 256);
  noise(x, 64, 256, 2500, rnd, 0.2);
  x.fillStyle = '#4a3b2e';
  for (let j = 0; j < 256; j += 21) x.fillRect(10, j, 44, 8);
  x.fillStyle = '#a2a2a8';
  x.fillRect(19, 0, 3, 256);
  x.fillRect(42, 0, 3, 256);
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

// Cartelli stradali (atlante 8 x 1 celle da 128 px): 0 STOP, 1 dare precedenza, 2 rotatoria, 3 diritto di precedenza;
// 4-7 il retro grigio con la stessa sagoma
export function signAtlas() {
  const S = 128;
  const [c, x] = canvas(S * 8, S);
  const shape = (k, back) => {
    const ox = (back ? k + 4 : k) * S, cx = ox + S / 2, cy = S / 2;
    x.save();
    x.beginPath();
    if (k === 0) { for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; x.lineTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60); } }
    else if (k === 1) { x.moveTo(cx - 60, cy - 50); x.lineTo(cx + 60, cy - 50); x.lineTo(cx, cy + 56); }
    else if (k === 2) x.arc(cx, cy, 60, 0, Math.PI * 2);
    else { x.moveTo(cx, cy - 60); x.lineTo(cx + 60, cy); x.lineTo(cx, cy + 60); x.lineTo(cx - 60, cy); }
    x.closePath();
    if (back) { x.fillStyle = '#8a8d90'; x.fill(); x.restore(); return; }
    if (k === 0) { x.fillStyle = '#c8102e'; x.fill(); x.lineWidth = 6; x.strokeStyle = '#fff'; x.stroke(); x.fillStyle = '#fff'; x.font = 'bold 40px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('STOP', cx, cy + 2); }
    else if (k === 1) { x.fillStyle = '#c8102e'; x.fill(); x.beginPath(); x.moveTo(cx - 40, cy - 38); x.lineTo(cx + 40, cy - 38); x.lineTo(cx, cy + 32); x.closePath(); x.fillStyle = '#fff'; x.fill(); }
    else if (k === 2) {
      x.fillStyle = '#1f5fbf'; x.fill(); x.lineWidth = 4; x.strokeStyle = '#fff'; x.stroke();
      // tre frecce in senso antiorario
      x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineWidth = 9;
      for (let i = 0; i < 3; i++) {
        const a0 = (i * 2 * Math.PI) / 3 - 0.2, a1 = a0 - 1.45;
        x.beginPath(); x.arc(cx, cy, 34, a0, a1, true); x.stroke();
        const hx = cx + Math.cos(a1) * 34, hy = cy + Math.sin(a1) * 34, tx = Math.sin(a1), ty = -Math.cos(a1);
        x.beginPath(); x.moveTo(hx - tx * 13, hy - ty * 13); x.lineTo(hx + Math.cos(a1) * 12, hy + Math.sin(a1) * 12); x.lineTo(hx - Math.cos(a1) * 12, hy - Math.sin(a1) * 12); x.closePath(); x.fill();
      }
    } else { x.fillStyle = '#fff'; x.fill(); x.beginPath(); x.moveTo(cx, cy - 42); x.lineTo(cx + 42, cy); x.lineTo(cx, cy + 42); x.lineTo(cx - 42, cy); x.closePath(); x.fillStyle = '#f2c200'; x.fill(); }
    x.restore();
  };
  for (let k = 0; k < 4; k++) { shape(k, false); shape(k, true); }
  const t = makeTex(c, false);
  return t;
}

// Cartelli per il tram: pantografo da abbassare (sinistra) e da rialzare (destra), quadrato blu con il simbolo bianco
export function pantographSignTexture() {
  const [c, x] = canvas(256, 128);
  for (const [k, up] of [[0, false], [1, true]]) {
    const ox = k * 128;
    x.fillStyle = '#1f5fbf'; x.fillRect(ox + 4, 4, 120, 120);
    x.strokeStyle = '#fff'; x.lineWidth = 4; x.strokeRect(ox + 8, 8, 112, 112);
    x.strokeStyle = '#fff'; x.lineWidth = 6;
    // tetto del veicolo, bracci e strisciante
    x.beginPath(); x.moveTo(ox + 30, 100); x.lineTo(ox + 98, 100); x.stroke();
    const top = up ? 34 : 78;
    x.beginPath(); x.moveTo(ox + 50, 100); x.lineTo(ox + (up ? 74 : 86), (100 + top) / 2); x.lineTo(ox + 58, top); x.stroke();
    x.beginPath(); x.moveTo(ox + 36, top); x.lineTo(ox + 80, top); x.stroke();
    // freccia
    x.fillStyle = '#fff'; x.beginPath();
    if (up) { x.moveTo(ox + 100, 30); x.lineTo(ox + 112, 50); x.lineTo(ox + 88, 50); }
    else { x.moveTo(ox + 100, 76); x.lineTo(ox + 112, 56); x.lineTo(ox + 88, 56); }
    x.closePath(); x.fill();
    x.font = 'bold 13px Arial'; x.textAlign = 'center'; x.fillText(up ? 'ALZARE' : 'ABBASSARE', ox + 64, 22);
  }
  return makeTex(c, false);
}
