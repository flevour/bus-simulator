// Griglia spaziale generica e utilità geometriche 2D (piano x/z)

export class Grid {
  constructor(cell = 60) {
    this.cell = cell;
    this.map = new Map();
  }
  key(ix, iz) {
    return ix * 73856093 ^ iz * 19349663;
  }
  insertAABB(item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = this.key(ix, iz);
        let a = this.map.get(k);
        if (!a) this.map.set(k, (a = []));
        a.push(item);
      }
  }
  // toglie item dalle celle del rettangolo con cui era stato inserito
  remove(item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = this.key(ix, iz), a = this.map.get(k);
        if (!a) continue;
        const i = a.indexOf(item);
        if (i >= 0) a.splice(i, 1);
        if (!a.length) this.map.delete(k);
      }
  }
  query(x, z, r, out = []) {
    const c = this.cell;
    out.length = 0;
    const stamp = (this._stamp = (this._stamp || 0) + 1);
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++)
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const a = this.map.get(this.key(ix, iz));
        if (!a) continue;
        for (const it of a) {
          if (it._q === stamp) continue;
          it._q = stamp;
          out.push(it);
        }
      }
    return out;
  }
}

// Distanza punto-segmento, ritorna {d, t}
export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t };
}

export function distToPolyline(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const r = distToSeg(px, pz, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
    if (r.d < best) best = r.d;
  }
  return best;
}

// Cerchio contro OBB (box orientato). Ritorna vettore di spinta o null
export function circleVsOBB(cx, cz, r, b) {
  const lx = (cx - b.x) * b.c + (cz - b.z) * b.s; // asse locale x
  const lz = -(cx - b.x) * b.s + (cz - b.z) * b.c;
  const qx = Math.max(-b.hx, Math.min(b.hx, lx));
  const qz = Math.max(-b.hz, Math.min(b.hz, lz));
  let dx = lx - qx, dz = lz - qz;
  let d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  let nx, nz, pen;
  if (d2 < 1e-8) {
    // centro dentro il box: esci dal lato più vicino
    const ex = b.hx - Math.abs(lx), ez = b.hz - Math.abs(lz);
    if (ex < ez) { nx = Math.sign(lx) || 1; nz = 0; pen = ex + r; }
    else { nx = 0; nz = Math.sign(lz) || 1; pen = ez + r; }
  } else {
    const d = Math.sqrt(d2);
    nx = dx / d; nz = dz / d; pen = r - d;
  }
  // ritorna in coordinate mondo
  return { x: (nx * b.c - nz * b.s) * pen, z: (nx * b.s + nz * b.c) * pen };
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
