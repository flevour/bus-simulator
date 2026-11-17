// Domanda di traffico (#116): ogni auto fa un viaggio con origine, destinazione e ora; il numero di auto e le strade che
// si riempiono seguono l'ora del gioco. Regole e corridoi in tests/domanda.js, il modello in docs/domanda.md.
import { writeFileSync } from 'node:fs';
import { test, expect, avviaCorsa, tempoMassimo } from './gioco.js';
import { CORRIDOI, ORE, corridoioStati, misuraCorridoio } from './domanda.js';

// Le auto della corsa hanno un viaggio (origine, destinazione, arrivo) e lo seguono; il percorso si rifà quando i tempi
// cambiano: un ritardo misurato sulla strada che un'auto prenderebbe le fa prendere l'altra, e i tempi della punta del
// mattino (alberi della fascia) non sono quelli delle 11. Il numero di auto e il disco dove stanno seguono l'ora anche
// durante la corsa (#60): alle 8:15 72 auto in un disco stretto, alle 22:30 un disco più largo
test('viaggi con origine e destinazione, percorsi che seguono i tempi, auto che seguono l\'ora', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '3' });
  const r = await pagina.evaluate(() => {
    const g = window.__game, T = g.traffic, D = g.domanda, E = g.net.edges;
    const alle8 = { auto: T.cars.length, conViaggio: T.cars.filter((c) => c.viaggio && c.viaggio.o != null && c.viaggio.d != null && c.viaggio.arrivo != null).length, raggio: T.raggio, quante: T.quante };
    g.sim(30, 1 / 30, false);
    // un'auto con un viaggio e un nodo davanti con due movimenti che arrivano: il ritardo sul migliore fa scegliere l'altro
    let cambio = null;
    for (const c of T.cars) {
      const A = c.viaggio && c.viaggio.albero;
      if (!A || !A.fatto) continue;
      const s = 2 * c.edge.id + (c.fwd ? 0 : 1), vie = [];
      for (let j = D.so[s]; j < D.so[s + 1]; j++) if (A.T[D.sa[j]] < Infinity) vie.push(D.sa[j]);
      if (vie.length < 2) continue;
      const [prima] = D.migliore(s, A);
      D.ritardi.set(prima, 900);
      const [dopo] = D.migliore(s, A);
      D.ritardi.delete(prima);
      cambio = { prima, dopo };
      break;
    }
    // tempi della fascia: lo stesso arrivo alle 8:15 e alle 11:15, da un corridoio carico (Via Facciolati verso il centro)
    const albero = (ora) => { g.mission.clock = ora * 3600; D.ora(g.mission.clock, 'feriale'); const s = D.statoVicino(641, 894); return { s, A: D.alberoOra(s) }; };
    const da = D.statoVicino(1488, 2307);
    const p8 = albero(8.25), t8 = p8.A.T[da], p11 = albero(11.25), t11 = p11.A.T[da];
    // alle 22:30 il disco si allarga (meno viaggi), senza ripartire la corsa
    g.mission.clock = 22.5 * 3600;
    g.sim(70, 1 / 30, false);
    return { alle8, cambio, t8, t11, alle22: { auto: T.cars.length, raggio: T.raggio, quante: T.quante }, nodo: E.length };
  });
  console.log(`domanda: ${JSON.stringify(r)}`);
  expect(r.alle8.auto, 'auto alle 8:15').toBeGreaterThan(60);
  expect(r.alle8.conViaggio, 'ogni auto ha un viaggio').toBe(r.alle8.auto);
  expect(r.cambio, 'un\'auto con due strade verso l\'arrivo').not.toBeNull();
  expect(r.cambio.dopo, 'con un ritardo misurato sulla strada migliore se ne prende un\'altra').not.toBe(r.cambio.prima);
  expect(r.t8, 'tempi della punta del mattino più lunghi di quelli delle 11').toBeGreaterThan(r.t11 * 1.1);
  expect(r.alle22.raggio, 'alle 22:30 il disco è più largo che alle 8:15').toBeGreaterThan(r.alle8.raggio * 1.5);
  expect(gioco.errori()).toEqual([]);
});

// La punta c'è. Su tre corridoi dove il GTFS ha le corse più lente alle 7-9 e alle 17-19 (docs/domanda.md, sezione 7),
// per ogni ora e verso il tempo medio di quattro auto sonda (almeno tre arrivate); per ogni corridoio e ora di punta il rapporto con la
// morbida (le 11 o le 22, la più lenta) nel verso che la sente di più: la mattina di solito chi va verso il centro, la
// sera chi ne esce. La media dei tre corridoi alle 8 e alle 18 deve superare 1,08.
// Una misura aggregata con un margine, non un elenco di casi: gli intrecci esatti di qualche minuto di traffico cambiano
// tra il Mac e Linux e a ogni piccolo cambiamento (#145), e un corridoio da solo può non sentire la punta (Via Sorio
// non la sente: sezione 8 di docs/domanda.md, #147). Il 17 novembre sul Mac: 1,21 alle 8 e 1,41 alle 18
const SOGLIA_PUNTA = 1.08;
test('punte del mattino e della sera sui tre corridoi: più lenti alle 8 e alle 18 che alle 11 e alle 22', async ({ pagina, gioco }, info) => {
  tempoMassimo(900);
  const media = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const righe = [], punte = { 8: [], 18: [] }, tutte = [];
  for (const corr of CORRIDOI) {
    const misure = [];
    for (const { ora, partenza } of ORE) {
      await avviaCorsa(pagina, { linea: '10', partenza });
      misure.push(await pagina.evaluate(misuraCorridoio, { corr, ora, statiFn: corridoioStati.toString(), sonde: 4 }));
    }
    tutte.push({ corridoio: corr.nome, misure });
    // tempo medio delle sonde arrivate; ne devono arrivare almeno tre su quattro per verso (una che resta indietro più di
    // dieci minuti o esce di scena non fa la media, ma due sono un difetto del traffico)
    for (const m of misure) for (const v of m.tempi) expect(v.filter((x) => x != null).length, `${corr.nome} alle ${m.ora}: sonde arrivate (${JSON.stringify(m.tempi)})`).toBeGreaterThanOrEqual(3);
    const t = Object.fromEntries(misure.map((m) => [m.ora, m.tempi.map((v) => media(v.filter((x) => x != null)))]));
    for (const h of [8, 18]) punte[h].push(Math.max(...[0, 1].map((v) => t[h][v] / Math.max(t[11][v], t[22][v]))));
    righe.push(`${corr.nome}: ${misure.map((m) => `alle ${m.ora} ${t[m.ora].map(Math.round).join(' e ')} s (disco ${m.raggio} m)`).join('; ')}; punta delle 8 ${punte[8].at(-1).toFixed(2)}, delle 18 ${punte[18].at(-1).toFixed(2)}`);
  }
  console.log(righe.join('\n'));
  writeFileSync(info.outputPath('corridoi.json'), JSON.stringify(tutte, null, 1));
  const p8 = media(punte[8]), p18 = media(punte[18]);
  console.log(`punte medie: alle 8 ${p8.toFixed(3)}, alle 18 ${p18.toFixed(3)} (soglia ${SOGLIA_PUNTA})`);
  expect(p8, `punta del mattino, media dei tre corridoi\n${righe.join('\n')}`).toBeGreaterThan(SOGLIA_PUNTA);
  expect(p18, `punta della sera, media dei tre corridoi\n${righe.join('\n')}`).toBeGreaterThan(SOGLIA_PUNTA);
  expect(gioco.errori()).toEqual([]);
});
