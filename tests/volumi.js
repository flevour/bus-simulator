// Volumi col terreno (tests/volumi.spec.js): la funzione che gira nella pagina del gioco. Deve bastare a sé stessa:
// Playwright la passa come testo.

// Per ogni oggetto del mondo che three.js può scartare (Mesh, Line, Points e Sprite con frustumCulled) prende il volume
// che usa il culling (Terrain.volume, cioè terrainVolume di src/world/terrain.js) e controlla che dentro ci siano tutti
// i suoi vertici come li disegna il vertex shader: nel mondo, con le matrici delle istanze, alzati della quota del
// terreno nel loro punto (variante "fondo" per i materiali terrainGround; non alzati per gli ShaderMaterial senza
// project_vertex, che il terreno non tocca). Torna gli oggetti con un vertice fuori di più di un millimetro.
export function misuraVolumi() {
  const g = window.__game, T = g.terrain, t0 = performance.now();
  const out = { oggetti: 0, vertici: 0, sprite: 0, senzaCulling: 0, fuori: [] };
  const M = g.scene.matrixWorld.clone();
  g.scene.updateMatrixWorld(true);
  const cosa = (o) => {
    const p = [];
    for (let q = o; q && q !== g.scene; q = q.parent) p.push(q.name || q.type);
    const m = [].concat(o.material)[0];
    return `${p.reverse().join('/')}${m && m.color ? ' #' + m.color.getHexString() : ''}`;
  };
  g.scene.traverse((o) => {
    if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
    const pos = o.isSprite ? null : o.geometry && o.geometry.attributes.position;
    if (!o.isSprite && !pos) return;
    out.oggetti++;
    if (o.isSprite) out.sprite++;
    if (!o.frustumCulled) { out.senzaCulling++; return; }
    const v = T.volume(o), mats = [].concat(o.material);
    const fondo = mats.some((m) => m.userData && m.userData.terrainGround);
    const alzato = !mats.some((m) => m.isShaderMaterial && !m.vertexShader.includes('#include <project_vertex>'));
    let peggio = 0, n = 0;
    const punto = (wx, wy, wz) => {
      const d = Math.hypot(wx - v.x, wy + (alzato ? T.at(wx, wz, fondo) : 0) - v.y, wz - v.z) - v.r;
      if (d > peggio) peggio = d;
      n++;
    };
    const vertici = (m) => {
      const e = m.elements;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        punto(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
    };
    if (o.isSprite) { const e = o.matrixWorld.elements; punto(e[12], e[13], e[14]); }
    else if (o.isInstancedMesh) for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, M); M.premultiply(o.matrixWorld); vertici(M); }
    else vertici(o.matrixWorld);
    out.vertici += n;
    if (peggio > 1e-3) out.fuori.push({ cosa: cosa(o), fuori: Math.round(peggio * 1000) / 1000, x: Math.round(v.x), z: Math.round(v.z), raggio: Math.round(v.r * 10) / 10, istanze: o.isInstancedMesh ? o.count : 0 });
  });
  out.ms = Math.round(performance.now() - t0);
  return out;
}
