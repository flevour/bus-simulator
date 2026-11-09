import * as THREE from 'three';

// ------------------------------------------------------------------
// Terreno: quote del suolo (DTM) applicate a tutta la scena nel vertex shader.
// Il gioco resta piano (fisica, strade, edifici a y = 0): ogni vertice viene alzato della quota del terreno nel suo
// punto, la telecamera e i fari della stessa quota. Così strade, marciapiedi, edifici e veicoli seguono il terreno
// insieme, senza toccare chi li costruisce.
// La griglia arriva da scripts/terrain_grid.py: quote relative alla quota di riferimento della città, in passi di
// `step` metri, codificate in un byte (q * scale + offset).
// ------------------------------------------------------------------

// due varianti della griglia: "via" (asfalto, edifici, veicoli: i ponti sui fiumi hanno la quota raccordata tra le
// sponde) e "fondo" (suolo, acqua e argini: seguono l'alveo). I materiali del fondo hanno userData.terrainGround
const R = { value: new THREE.Vector4(0, 0, 1, 1) }; // x0, z0, 1/larghezza, 1/altezza (m)
const K = { value: new THREE.Vector3(0, 0, 0) }; // scala, offset, attivo
const U = { uTerr: { value: null }, uTerrR: R, uTerrK: K };
const UG = { uTerr: { value: null }, uTerrR: R, uTerrK: K };

const GLSL = `
uniform sampler2D uTerr; uniform vec4 uTerrR; uniform vec3 uTerrK;
float terrainH(vec2 p) {
  if (uTerrK.z < 0.5) return 0.0;
  return texture2D(uTerr, (p - uTerrR.xy) * uTerrR.zw).r * uTerrK.x + uTerrK.y;
}
`;
const PROJECT = `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 tWP = modelMatrix * mvPosition;
tWP.y += terrainH(tWP.xz);
mvPosition = viewMatrix * tWP;
gl_Position = projectionMatrix * mvPosition;
`;
const WORLDPOS = `#include <worldpos_vertex>
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  worldPosition.y += terrainH(worldPosition.xz);
#endif
`;

// da chiamare nell'onBeforeCompile dei materiali che ne hanno uno proprio (gli altri lo prendono dal prototipo)
export function applyTerrain(sh, ground = false) {
  if (!sh.vertexShader.includes('#include <project_vertex>')) return;
  Object.assign(sh.uniforms, ground ? UG : U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + GLSL)
    .replace('#include <project_vertex>', PROJECT)
    .replace('#include <worldpos_vertex>', WORLDPOS);
}
// le uniform sono condivise da tutti i materiali: chi disegna fuori dal mondo (anteprime dei bus nel menu) spegne il
// terreno e poi lo rimette com'era
export function suspendTerrain() { const was = K.value.z; K.value.z = 0; return was; }
export function resumeTerrain(was) { K.value.z = was; }
THREE.Material.prototype.onBeforeCompile = function (sh) { applyTerrain(sh, !!(this.userData && this.userData.terrainGround)); };

// chiusura morfologica su una finestra quadrata di lato 2r+1: massimo e poi minimo, a passate separate per righe e
// colonne (riempie fossi e alvei più stretti della finestra, lascia argini e rilievi)
function closing(src, nx, nz, r) {
  if (!r) return src.slice();
  const pass = (a, f, alongX) => {
    const out = new Uint8Array(a.length);
    const n = alongX ? nx : nz, m = alongX ? nz : nx;
    for (let k = 0; k < m; k++)
      for (let i = 0; i < n; i++) {
        let v = f === 1 ? 0 : 255;
        for (let d = Math.max(0, i - r); d <= Math.min(n - 1, i + r); d++) {
          const c = alongX ? a[k * nx + d] : a[d * nx + k];
          v = f === 1 ? (c > v ? c : v) : (c < v ? c : v);
        }
        out[alongX ? k * nx + i : i * nx + k] = v;
      }
    return out;
  };
  const dil = pass(pass(src, 1, true), 1, false);
  return pass(pass(dil, 0, true), 0, false);
}

export class Terrain {
  // g: { x0, z0, step, nx, nz, scale, offset, data (base64, un byte per cella, righe lungo x) }
  constructor(g) {
    this.ok = !!g;
    if (!g) return;
    Object.assign(this, { x0: g.x0, z0: g.z0, step: g.step, nx: g.nx, nz: g.nz, scale: g.scale, offset: g.offset });
    const bin = atob(g.data), dg = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) dg[i] = bin.charCodeAt(i);
    // variante "via" (strade, edifici, prato): avvallamenti stretti riempiti alla quota delle sponde (chiusura
    // morfologica, come in scripts/street_surfaces.py), poi i ponti lunghi alzano le celle vicine (mai le abbassano)
    const d = closing(dg, g.nx, g.nz, g.close || 0);
    for (const br of g.bridges || []) {
      const w = br[0];
      for (let k = 1; k + 5 < br.length; k += 3) {
        const ax = br[k], az = br[k + 1], ah = br[k + 2], bx = br[k + 3], bz = br[k + 4], bh = br[k + 5];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - w - g.x0) / g.step)), i1 = Math.min(g.nx - 1, Math.ceil((Math.max(ax, bx) + w - g.x0) / g.step));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - w - g.z0) / g.step)), j1 = Math.min(g.nz - 1, Math.ceil((Math.max(az, bz) + w - g.z0) / g.step));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = g.x0 + i * g.step, z = g.z0 + j * g.step;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
          if (Math.hypot(x - ax - ex * t, z - az - ez * t) > w) continue;
          const v = Math.round((ah + (bh - ah) * t - g.offset) / g.scale);
          const c = j * g.nx + i;
          if (v > d[c]) d[c] = Math.min(255, v);
        }
      }
    }
    this.d = d;
    this.dg = dg;
    const tex = (arr) => {
      const t = new THREE.DataTexture(arr, g.nx, g.nz, THREE.RedFormat, THREE.UnsignedByteType);
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      return t;
    };
    U.uTerr.value = tex(d);
    UG.uTerr.value = tex(dg);
    // centri delle celle: uv = (p - x0 + step/2) / (n * step)
    R.value.set(g.x0 - g.step / 2, g.z0 - g.step / 2, 1 / (g.nx * g.step), 1 / (g.nz * g.step));
    K.value.set(g.scale * 255, g.offset, 1);
  }
  // quota (m) in un punto, interpolata come nella texture: variante "via" (ground = true: "fondo")
  at(x, z, ground = false) {
    if (!this.ok) return 0;
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.x0) / this.step)), fz = Math.max(0, Math.min(this.nz - 1.001, (z - this.z0) / this.step));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, n = this.nx, d = ground ? this.dg : this.d;
    const a = d[j * n + i], b = d[j * n + i + 1], c = d[(j + 1) * n + i], e = d[(j + 1) * n + i + 1];
    const v = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
    return v * this.scale + this.offset;
  }
  // terreno acceso solo per la scena del mondo (non per l'overlay del cruscotto)
  enable(on) { K.value.z = on && this.ok ? 1 : 0; }
}
