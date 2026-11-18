// Impronta del traffico (#145): lo stato di auto, bus e tram automatici e del bus di chi guida, ai bit, a intervalli
// fissi di gioco. La simulazione va a passo fisso, con sequenze casuali dal seme e senza tempo vero: la stessa corsa
// deve dare la stessa impronta su ogni macchina (Mac arm64, Linux amd64 della CI) e qualunque corsa la pagina abbia
// fatto prima. Non importa nulla da Playwright: la usano la prova (tests/impronta.spec.js) e gli script di confronto.

// in pagina: sec secondi di gioco in ognuna delle zone, un'impronta ogni `ogni` secondi ("centro 10 s 1a2b3c4d")
export function improntaTraffico({ zone, sec, ogni = 10, dt = 1 / 30 }) {
  const g = window.__game;
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  let h = 0;
  // FNV-1a sulle due metà di ogni numero: un bit diverso in una coordinata cambia l'impronta
  const mix = (x) => { f[0] = x; h = Math.imul(h ^ u[0], 16777619) >>> 0; h = Math.imul(h ^ u[1], 16777619) >>> 0; };
  const impronta = () => {
    h = 2166136261;
    mix(g.mission.clock);
    const T = g.traffic, B = g.buses, TR = g.trams;
    mix(T.cars.length); mix(B.buses.length); mix(TR.trams.length);
    for (const c of T.cars) { mix(c.x); mix(c.z); mix(c.h); mix(c.v); }
    for (const b of B.buses) { mix(b.x); mix(b.z); mix(b.h); mix(b.v); }
    for (const t of TR.trams) { if (t.parts[0]) { mix(t.parts[0].x); mix(t.parts[0].z); } mix(t.v); }
    mix(g.bus.x); mix(g.bus.z); mix(g.bus.h); mix(g.bus.v);
    return h.toString(16).padStart(8, '0');
  };
  const out = [];
  for (const z of zone) {
    g.teleport(z.x, z.z);
    for (let t = ogni; t <= sec; t += ogni) { g.sim(ogni, dt, false); out.push(`${z.nome} ${t} s ${impronta()}`); }
  }
  return out;
}
