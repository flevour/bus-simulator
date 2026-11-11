// Linea aerea del tram: pali sui marciapiedi (o sul verde, sulle isole), mai in mezzo alla strada, e nessun tirante
// sopra la sede di un altro binario. Soglie dell'11 novembre: se un numero scende si abbassa la soglia nello stesso
// commit, se sale per una buona ragione si alza scrivendo il perché.
import { test, expect } from './gioco.js';

const SOGLIE = { pali_sull_asfalto: 10, pali_sul_cordolo: 94, tiranti_sopra_un_altra_sede: 0 };

test('linea aerea: pali fuori dalla strada, tiranti mai sopra un\'altra sede', async ({ pagina, gioco }) => {
  const r = await pagina.evaluate(() => {
    const c = window.__game.city, L = 1.7, paths = [];
    for (const T of Object.values(c.tramTracks)) for (const d of [1, -1]) paths.push(T.path(d));
    const dTrack = (x, z) => Math.min(...paths.map((P) => P.project(x, z).d));
    let asfalto = 0, cordolo = 0, sopra = 0;
    for (const p of c.tramPoles) {
      const d = dTrack(p.x, p.z);
      if (Math.abs(d - L) < 0.35) cordolo++;
      else if (c.surfaceOff(p.x, p.z) < -0.3) asfalto++;
    }
    for (const s of c.tramSpans) {
      const l = Math.hypot(s.a.x - s.b.x, s.a.z - s.b.z);
      for (let t = 0; t <= 1; t += 0.5 / Math.max(1, l)) {
        const x = s.a.x + (s.b.x - s.a.x) * t, z = s.a.z + (s.b.z - s.a.z) * t;
        if (Math.hypot(x - s.cx, z - s.cz) > s.half + 0.3 && dTrack(x, z) < L) { sopra++; break; }
      }
    }
    return { pali: c.tramPoles.length, pali_sull_asfalto: asfalto, pali_sul_cordolo: cordolo, tiranti_sopra_un_altra_sede: sopra };
  });
  console.log('linea aerea:', JSON.stringify(r));
  expect(r.pali).toBeGreaterThan(500);
  for (const [k, max] of Object.entries(SOGLIE)) expect(r[k], k).toBeLessThanOrEqual(max);
  expect(gioco.errori()).toEqual([]);
});
