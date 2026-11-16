// Raccordi di corsia agli incroci (#112, docs/raccordi.md). La build li calcola sulle corsie rifatte in Python
// (corsie_arco di scripts/raccordi.py); il gioco le corsie le disegna con laneLayout. Questa prova legge il campo come lo
// leggerà il gioco e controlla che ogni raccordo cominci e finisca sull'asse di una corsia di laneLayout: se una delle
// due regole cambia senza l'altra, fallisce. Curva per curva contro la pianta delle strade li controlla
// scripts/verifica_mappa.py. La funzione leggi è anche l'esempio di come si decodifica il campo.
import { test, expect } from './gioco.js';

const TOLL = 0.03; // m dall'asse della corsia

test('raccordi di corsia: cominciano e finiscono sulle corsie che il gioco disegna', async ({ pagina, gioco }) => {
  const r = await pagina.evaluate(leggi, TOLL);
  console.log(`raccordi ${r.raccordi} su ${r.nodi} nodi, ${r.lunghi} scavalcano un arco corto; per classe ${JSON.stringify(r.classi)}; ` +
    `scarto massimo dall'asse ${r.peggio.toFixed(3)} m, raggio minimo ${r.raggioMinimo} m`);
  expect(r.errore).toBe('');
  expect(r.rotti, 'raccordi con un arco o una corsia che il gioco non ha, o con il raggio sotto il minimo di un mezzo ammesso').toEqual([]);
  expect(r.fuori, `raccordi che cominciano o finiscono a più di ${TOLL} m dall'asse della corsia`).toEqual([]);
  expect(r.raccordi).toBeGreaterThan(60000);
  expect(r.classi.auto).toBeGreaterThan(60000);
  expect(r.classi.bus12).toBeGreaterThan(45000);
  expect(gioco.errori()).toEqual([]);
});

// nella pagina: decodifica net.raccordi e confronta i capi di ogni curva con le corsie di laneLayout
function leggi(toll) {
  const { net, laneLayout } = window.__game, F = net.raccordi, E = net.edges, N = net.nodes;
  const out = { errore: '', raccordi: 0, nodi: 0, lunghi: 0, classi: {}, rotti: [], fuori: [], peggio: 0, raggioMinimo: Infinity };
  if (!F) return { ...out, errore: 'la rete non ha i raccordi' };
  F.classi.forEach((c) => (out.classi[c] = 0));
  // corsie di marcia nel verso, da sinistra a destra di chi va, come distanza dall'asse a destra: quelle disegnate, o
  // una sola dove in quel verso non ce ne sono (marcia di scripts/raccordi.py)
  const marcia = (e, fwd) => {
    const mie = laneLayout(e).lanes.filter((l) => l.d === (fwd ? 1 : -1)).map((l) => (fwd ? l.off : -l.off)).sort((a, b) => a - b);
    return mie.length ? mie : [e.oneway ? (e.width < 8 ? 0 : e.width / 2 - 2) : e.width / 4];
  };
  const tan2 = (a, b) => Math.tan(Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z)) / 2);
  out.nodi = F.nodi.length;
  F.nodi.forEach((n, i) => {
    const v = F.voci[i], O = N[n];
    for (let j = 0; j < v.length;) {
      // un raccordo: arco da, arco a, codice, raggio in decimetri, vertici in centimetri dal nodo, archi scavalcati
      const da = E[v[j]], a = E[v[j + 1]], c = v[j + 2], r = v[j + 3] / 10, nv = ((c >> 9) & 1) + 1, nvia = c >> 10;
      const cda = c & 7, ca = (c >> 3) & 7, classi = (c >> 6) & 7;
      const P = [];
      for (let k = 0; k < nv; k++) P.push({ x: O.x + v[j + 4 + 2 * k] / 100, z: O.z + v[j + 5 + 2 * k] / 100 });
      const via = v.slice(j + 4 + 2 * nv, j + 4 + 2 * nv + nvia);
      j += 4 + 2 * nv + nvia;
      out.raccordi++;
      if (nvia) out.lunghi++;
      F.classi.forEach((nome, b) => { if (classi & (1 << b)) out.classi[nome]++; });
      const dove = `${O.x},${O.z}`;
      if (!da || !a || via.some((k) => !E[k])) { out.rotti.push(`arco che non c'è @ ${dove}`); continue; }
      if (r) out.raggioMinimo = Math.min(out.raggioMinimo, r);
      if (F.raggi.some((min, b) => classi & (1 << b) && r && r < min)) out.rotti.push(`raggio ${r} @ ${dove}`);
      // l'arco da arriva al nodo; poi gli archi scavalcati, uno dopo l'altro; l'arco a parte dal nodo dove finisce l'ultimo
      const fin = da.b == n, din = { x: fin ? da.dx : -da.dx, z: fin ? da.dz : -da.dz };
      let m = n;
      for (const k of via) m = E[k].a == m ? E[k].b : E[k].a;
      if ((da.a != n && da.b != n) || (a.a != m && a.b != m)) { out.rotti.push(`catena che non si tiene @ ${dove}`); continue; }
      const fout = a.a == m, dout = { x: fout ? a.dx : -a.dx, z: fout ? a.dz : -a.dz }, Q = N[m];
      const li = marcia(da, fin), lo = marcia(a, fout);
      if (cda >= li.length || ca >= lo.length) { out.rotti.push(`corsia che non c'è @ ${dove}`); continue; }
      // capi della curva: dal primo vertice indietro lungo l'arrivo, dall'ultimo avanti lungo l'uscita, di una tangente
      let mid = null;
      if (nv === 2) { const l = Math.hypot(P[1].x - P[0].x, P[1].z - P[0].z); mid = { x: (P[1].x - P[0].x) / l, z: (P[1].z - P[0].z) / l }; }
      const t0 = r * tan2(din, mid || dout), t1 = r * tan2(mid || din, dout);
      const p0 = { x: P[0].x - din.x * t0, z: P[0].z - din.z * t0 }, p1 = { x: P[nv - 1].x + dout.x * t1, z: P[nv - 1].z + dout.z * t1 };
      // distanza dall'asse dell'arco, a destra di chi va, contro quella della corsia
      const si = Math.abs((p0.x - O.x) * -din.z + (p0.z - O.z) * din.x - li[cda]);
      const so = Math.abs((p1.x - Q.x) * -dout.z + (p1.z - Q.z) * dout.x - lo[ca]);
      out.peggio = Math.max(out.peggio, si, so);
      if (si > toll || so > toll) out.fuori.push(`${si.toFixed(2)} e ${so.toFixed(2)} m @ ${dove}`);
    }
  });
  out.rotti = out.rotti.slice(0, 30);
  out.fuori = out.fuori.slice(0, 30);
  return out;
}
