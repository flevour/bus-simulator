import * as THREE from 'three';

// ------------------------------------------------------------------
// Terreno: quote del suolo (DTM) applicate a tutta la scena nel vertex shader.
// Il gioco resta piano (fisica, strade, edifici a y = 0): ogni vertice viene alzato della quota del terreno nel suo
// punto, la telecamera e i fari della stessa quota. Così strade, marciapiedi, edifici e veicoli seguono il terreno
// insieme, senza toccare chi li costruisce.
// La griglia arriva da scripts/terrain_grid.py: quote relative alla quota di riferimento della città, in passi di
// `step` metri, codificate in un byte (q * scale + offset).
// ------------------------------------------------------------------

const U = {
  uTerr: { value: null },
  uTerrR: { value: new THREE.Vector4(0, 0, 1, 1) }, // x0, z0, 1/larghezza, 1/altezza (m)
  uTerrK: { value: new THREE.Vector3(0, 0, 0) }, // scala, offset, attivo
};

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
export function applyTerrain(sh) {
  if (!sh.vertexShader.includes('#include <project_vertex>')) return;
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + GLSL)
    .replace('#include <project_vertex>', PROJECT)
    .replace('#include <worldpos_vertex>', WORLDPOS);
}
THREE.Material.prototype.onBeforeCompile = function (sh) { applyTerrain(sh); };

export class Terrain {
  // g: { x0, z0, step, nx, nz, scale, offset, data (base64, un byte per cella, righe lungo x) }
  constructor(g) {
    this.ok = !!g;
    if (!g) return;
    Object.assign(this, { x0: g.x0, z0: g.z0, step: g.step, nx: g.nx, nz: g.nz, scale: g.scale, offset: g.offset });
    const bin = atob(g.data), d = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
    this.d = d;
    const tex = new THREE.DataTexture(d, g.nx, g.nz, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    U.uTerr.value = tex;
    // centri delle celle: uv = (p - x0 + step/2) / (n * step)
    U.uTerrR.value.set(g.x0 - g.step / 2, g.z0 - g.step / 2, 1 / (g.nx * g.step), 1 / (g.nz * g.step));
    U.uTerrK.value.set(g.scale * 255, g.offset, 1);
  }
  // quota (m) in un punto, interpolata come nella texture
  at(x, z) {
    if (!this.ok) return 0;
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.x0) / this.step)), fz = Math.max(0, Math.min(this.nz - 1.001, (z - this.z0) / this.step));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, n = this.nx, d = this.d;
    const a = d[j * n + i], b = d[j * n + i + 1], c = d[(j + 1) * n + i], e = d[(j + 1) * n + i + 1];
    const v = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
    return v * this.scale + this.offset;
  }
  // terreno acceso solo per la scena del mondo (non per l'overlay del cruscotto)
  enable(on) { U.uTerrK.value.z = on && this.ok ? 1 : 0; }
}
