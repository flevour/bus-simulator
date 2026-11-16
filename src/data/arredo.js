// Arredo posato dalla build (#109): semafori e ripetitrici, tiranti, mensole e pali della linea aerea, lanterne del
// tram, segnali degli scambi, cartelli del pantografo e paline. Le posizioni le calcola una volta il posatore
// (src/world/posa.js, lanciato da scripts/posa_arredo.mjs) nello spazio libero della mappa e le scrive in
// padova-arredo.json; il gioco le legge qui e non cerca niente.
// Ogni tipo è un elenco nell'ordine in cui il gioco costruisce i suoi elementi: il lettore dà il prossimo e controlla
// che sia quello giusto dall'ancora (le prime due cifre: il punto della rete o del binario a cui l'elemento appartiene).
// Se l'ancora non torna la mappa è cambiata senza rifare la posa: errore, non una ricerca di ripiego.
// Posatore e lettore hanno gli stessi metodi (semaforo, lineaAerea, scambio, pantografo, lanterna, paline): City,
// TrafficLights e TramSignals chiamano city.arredo senza sapere quale dei due hanno davanti.
import DATI from './padova-arredo.json' with { type: 'json' };

const cm = (v) => Math.round(v * 100) / 100;
// al millesimo di millimetro: l'ultima cifra di un calcolo cambia da una versione di Node all'altra, e il file deve
// uscire uguale su ogni macchina
const um = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6);

// Come si scrive ogni elemento nel file (enc) e come si rilegge (dec). Le posizioni disegnate sono al centimetro; la
// linea d'arresto dei semafori e le paline, da cui dipende dove si fermano i veicoli, al millesimo di millimetro. Il posatore rilegge quello che ha scritto: la città della build è quella del gioco
export const CODICE = {
  // [nodo x, z, linea d'arresto (m dal nodo), linea da w0 a w1, palo a destra x, z, tipo, sbraccio, ripetitrice x, z,
  // tipo]; tipo: 0 nessuno, ±1 palo, ±2 lanterna a muro, negativo a sinistra di chi arriva
  semafori: {
    enc: (n, r) => [n.x, n.z, um(r.stop), cm(r.w0), cm(r.w1), ...(r.R ? [cm(r.R.x), cm(r.R.z), (r.R.wall ? 2 : 1) * r.R.side, cm(r.R.mast)] : [0, 0, 0, 0]), ...(r.L ? [cm(r.L.x), cm(r.L.z), r.L.wall ? 2 : 1] : [])],
    dec: (a) => ({
      stop: a[2], w0: a[3], w1: a[4],
      R: a[7] ? { x: a[5], z: a[6], wall: Math.abs(a[7]) === 2, side: Math.sign(a[7]), mast: a[8] } : null,
      L: a.length > 9 ? { x: a[9], z: a[10], wall: a[11] === 2 } : null,
    }),
  },
  // tirante della linea aerea: [centro x, z, linea, verso, mezza larghezza delle sedi, quota, capo a x, z, palo,
  // capo b x, z, palo, palo in mezzo]
  lineaAerea: {
    enc: (s) => [cm(s.cx), cm(s.cz), s.t, s.d, cm(s.half), cm(s.h), cm(s.a.x), cm(s.a.z), s.a.pole ? 1 : 0, cm(s.b.x), cm(s.b.z), s.b.pole ? 1 : 0, s.mid ? 1 : 0],
    dec: (a) => ({ cx: a[0], cz: a[1], t: a[2], d: a[3], half: a[4], h: a[5], a: { x: a[6], z: a[7], pole: !!a[8] }, b: { x: a[9], z: a[10], pole: !!a[11] }, mid: !!a[12] }),
  },
  // segnale dello scambio: [dove lo mette il suo scambio x, z, dove sta il palo x, z] (senza posto resta dov'è)
  scambi: {
    enc: (s, q) => (q ? [cm(s.x), cm(s.z), cm(q.x), cm(q.z)] : [cm(s.x), cm(s.z)]),
    dec: (a) => (a.length > 2 ? { x: a[2], z: a[3] } : null),
  },
  // cartello del pantografo: [punto del binario x, z, palo x, z]
  pantografi: {
    enc: (p, q) => [cm(p.x), cm(p.z), cm(q.x), cm(q.z)],
    dec: (a) => ({ x: a[2], z: a[3] }),
  },
  // lanterna del tram: [punto del binario x, z, 0, palo x, z, distanza dal binario, lato] o, appesa al tirante,
  // [punto del binario x, z, 1, x, z, quota del tirante]
  lanterne: {
    enc: (p, r) => (r.hang ? [cm(p.x), cm(p.z), 1, cm(r.hang.x), cm(r.hang.z), cm(r.hang.y)] : [cm(p.x), cm(p.z), 0, cm(r.spot.x), cm(r.spot.z), cm(r.spot.o), r.spot.side]),
    dec: (a) => (a[2] ? { spot: null, hang: { x: a[3], z: a[4], y: a[5] } } : { spot: { x: a[3], z: a[4], o: a[5], side: a[6] }, hang: null }),
  },
  // palina: [x, z, fermata, punto sull'asse cx, cz, punto della fermata sul percorso bx, bz, verso dx, dz, mezza
  // carreggiata, cordolo, retta del cordolo kl, ks (null senza), pensilina, zigzag da zb a za]
  paline: {
    enc: (s) => [um(s.x), um(s.z), s.id, um(s.cx), um(s.cz), um(s.bx), um(s.bz), um(s.dx), um(s.dz), um(s.hw), um(s.kerb), um(s.kl), um(s.ks), s.roof ? 1 : 0, um(s.zb), um(s.za)],
    dec: (a) => ({ x: a[0], z: a[1], id: a[2], cx: a[3], cz: a[4], bx: a[5], bz: a[6], dx: a[7], dz: a[8], rx: -a[8], rz: a[7], hw: a[9], kerb: a[10], kl: a[11] ?? undefined, ks: a[12] ?? undefined, roof: !!a[13], zb: a[14], za: a[15] }),
  },
};
export const TIPI = Object.keys(CODICE);

export class Arredo {
  constructor(dati = DATI) {
    this.dati = dati;
    this.letti = Object.fromEntries(TIPI.map((t) => [t, 0]));
  }
  // il prossimo elemento del tipo, con l'ancora in (x, z)
  prossimo(tipo, x, z) {
    const a = this.dati[tipo][this.letti[tipo]++];
    if (!a || Math.abs(a[0] - x) > 0.011 || Math.abs(a[1] - z) > 0.011) {
      throw new Error(`arredo: ${tipo} n. ${this.letti[tipo]} non è quello della mappa (${cm(x)}, ${cm(z)}): la posa va rifatta (npm run posa)`);
    }
    return CODICE[tipo].dec(a);
  }
  semaforo(lights, sig, ap) { return this.prossimo('semafori', ap.node.x, ap.node.z); }
  lineaAerea() { return this.dati.lineaAerea.map(CODICE.lineaAerea.dec); }
  scambio(city, s) { return this.prossimo('scambi', s.x, s.z); }
  pantografo(city, p) { return this.prossimo('pantografi', p.x, p.z); }
  lanterna(signals, x, p) { return this.prossimo('lanterne', p.x, p.z); }
  paline() { return this.dati.paline.map(CODICE.paline.dec); }
}
