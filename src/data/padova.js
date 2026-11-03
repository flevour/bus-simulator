// Rete stradale semplificata di Padova e linee urbane.
// Le coordinate sono latitudine/longitudine approssimate dei luoghi reali,
// convertite in metri attorno a Piazza Garibaldi. I percorsi sono ispirati
// alla rete urbana di Padova ma semplificati per il gioco.

const ORIGIN = { lat: 45.4075, lon: 11.8775 };
const M_PER_LAT = 111130;
const M_PER_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function toXZ(lat, lon) {
  return { x: (lon - ORIGIN.lon) * M_PER_LON, z: -(lat - ORIGIN.lat) * M_PER_LAT };
}

// id: [lat, lon, nome fermata, importanza (1..3)]
const NODE_DATA = {
  // asse nord-sud del tram SIR1
  pvig: [45.4445, 11.8768, 'Pontevigodarzere', 2],
  dazio: [45.4405, 11.8783, 'Dazio', 1],
  saetta: [45.4365, 11.8800, 'Saetta', 1],
  sancarlo: [45.4322, 11.8818, 'San Carlo', 2],
  arcella: [45.4280, 11.8830, 'Arcella', 3],
  aspetti: [45.4252, 11.8826, 'Tiziano Aspetti', 2],
  borgomagno: [45.4222, 11.8820, 'Borgomagno', 1],
  stazione: [45.4180, 11.8805, 'Stazione FS', 3],
  trieste: [45.4143, 11.8795, 'Trieste', 2],
  eremitani: [45.4108, 11.8792, 'Eremitani', 2],
  garibaldi: [45.4082, 11.8785, 'Piazza Garibaldi', 3],
  pontiromani: [45.4062, 11.8790, 'Ponti Romani', 2],
  titolivio: [45.4040, 11.8782, 'Tito Livio', 2],
  santo: [45.4018, 11.8794, 'Santo', 3],
  prato: [45.3994, 11.8792, 'Prato della Valle', 3],
  pratosud: [45.3962, 11.8780, 'Prato della Valle Sud', 2],
  cavallotti: [45.3930, 11.8770, 'Vittorio Emanuele', 1],
  bassanello: [45.3885, 11.8752, 'Bassanello', 2],
  cuoco: [45.3830, 11.8762, 'Cuoco', 1],
  guizza: [45.3765, 11.8770, 'Guizza', 2],

  // linea 22: Torre – Via Madonna della Salute – Via Bajardi – Via Machiavelli – Via Aspetti
  torre: [45.4302, 11.9188, 'Torre', 2],
  salute: [45.4257, 11.9128, 'Madonna della Salute', 1],
  bajardi: [45.4259, 11.9025, 'Bajardi', 1],
  machiavelli: [45.4252, 11.8925, 'Machiavelli', 1],
  // linee 22 e 12: Viale Codalunga – Via Giotto – Largo Europa – Riviere – Businello
  codalunga: [45.4159, 11.8761, 'Codalunga', 1],
  giotto: [45.4128, 11.8775, 'Giotto', 1],
  largoeuropa: [45.4094, 11.8771, 'Largo Europa', 2],
  businello: [45.4007, 11.8779, 'Businello', 1],
  // Corso Vittorio Emanuele II – Bassanello – Strada Armistizio – Mandria
  armistizio: [45.3812, 11.8642, 'Armistizio', 1],
  mandria: [45.3748, 11.8532, 'Mandria', 2],

  // linea 24: Largo Debussy – Via Plebiscito – Via Callegari – Via Benedetti – Via Zanchi – Via Aspetti
  debussy: [45.4388, 11.8928, 'Largo Debussy', 2],
  plebiscito: [45.4364, 11.8938, 'Plebiscito', 2],
  callegari: [45.4309, 11.8951, 'Cardinal Callegari', 1],
  zanchi: [45.4288, 11.8888, 'Zanchi', 1],
  // Stazione – Piazzale Boschetti – Ospedale – Via Gattamelata – Via Cavazzana – Prato
  boschetti: [45.4092, 11.8835, 'Piazzale Boschetti', 2],
  ospedale: [45.4038, 11.8888, 'Ospedale Civile', 3],
  gattamelata: [45.4010, 11.8938, 'Gattamelata', 1],
  cavazzana: [45.3978, 11.8862, 'Cavazzana', 1],
  // Bassanello – Strada Battaglia – Sant'Agostino – Mandriola (Albignasego)
  battaglia: [45.3815, 11.8706, 'Strada Battaglia', 1],
  santagostino: [45.3712, 11.8668, "Sant'Agostino", 1],
  mandriola: [45.3615, 11.8626, 'Mandriola', 2],

  // linea 12: Prato della Valle – Via Sorio – Aeroporto – Brusegana – Tencarola
  pratoovest: [45.3989, 11.8742, 'Prato della Valle Ovest', 1],
  sorio: [45.3982, 11.8640, 'Sorio', 1],
  aeroporto: [45.3962, 11.8525, 'Aeroporto', 1],
  brusegana: [45.4004, 11.8432, 'Brusegana', 2],
  tencarola: [45.3992, 11.8190, 'Tencarola', 2],

  // altre strade della città (senza linee in gioco)
  fiera: [45.4160, 11.8885, 'Fiera', 2],
  stanga: [45.4128, 11.8995, 'Stanga', 2],
  sanlazzaro: [45.4140, 11.9150, 'San Lazzaro', 1],
  pontebrenta: [45.4162, 11.9330, 'Ponte di Brenta', 2],
  facciolati: [45.3928, 11.8880, 'Facciolati', 1],
  volta: [45.3848, 11.8962, 'Voltabarozzo', 1],
  forcellini: [45.3968, 11.8995, 'Forcellini', 1],
  terranegra: [45.3905, 11.9105, 'Terranegra', 1],
  sarpi: [45.4162, 11.8692, 'Sarpi', 1],
  monta: [45.4222, 11.8560, 'Montà', 1],
  bembo: [45.3925, 11.8690, 'Bembo', 1],
  sacrafam: [45.3950, 11.8620, 'Sacra Famiglia', 2],
};

// [a, b, nome via, larghezza carreggiata (m)]
const EDGE_DATA = [
  ['pvig', 'dazio', 'Via Pontevigodarzere', 10],
  ['dazio', 'saetta', 'Via Pontevigodarzere', 10],
  ['saetta', 'sancarlo', 'Via Tiziano Aspetti', 10],
  ['sancarlo', 'arcella', 'Via Tiziano Aspetti', 10],
  ['arcella', 'aspetti', 'Via Tiziano Aspetti', 10],
  ['aspetti', 'borgomagno', 'Via Tiziano Aspetti', 10],
  ['borgomagno', 'stazione', 'Cavalcavia Borgomagno', 11],
  ['stazione', 'trieste', 'Corso del Popolo', 12],
  ['trieste', 'eremitani', 'Corso Garibaldi', 10],
  ['eremitani', 'garibaldi', 'Corso Garibaldi', 10],
  ['garibaldi', 'pontiromani', 'Riviera dei Ponti Romani', 9],
  ['pontiromani', 'titolivio', 'Riviera Tito Livio', 9],
  ['titolivio', 'santo', 'Via del Santo', 9],
  ['santo', 'prato', 'Via Luca Belludi', 9],
  ['prato', 'pratosud', 'Prato della Valle', 11],
  ['pratosud', 'cavallotti', 'Corso Vittorio Emanuele II', 11],
  ['cavallotti', 'bassanello', 'Corso Vittorio Emanuele II', 11],
  ['bassanello', 'cuoco', 'Via Guizza', 10],
  ['cuoco', 'guizza', 'Via Guizza', 10],

  ['torre', 'salute', 'Via Madonna della Salute', 9],
  ['salute', 'bajardi', 'Via Bajardi', 9],
  ['bajardi', 'machiavelli', 'Via Machiavelli', 9],
  ['machiavelli', 'aspetti', 'Via Machiavelli', 9],
  ['stazione', 'codalunga', 'Viale Codalunga', 10],
  ['codalunga', 'giotto', 'Via Giotto', 9],
  ['giotto', 'largoeuropa', 'Via Giotto', 9],
  ['largoeuropa', 'pontiromani', 'Riviera dei Ponti Romani', 9],
  ['largoeuropa', 'garibaldi', 'Largo Europa', 10],
  ['titolivio', 'businello', 'Riviera del Businello', 9],
  ['businello', 'prato', 'Prato della Valle', 10],
  ['bassanello', 'armistizio', "Strada dell'Armistizio", 9],
  ['armistizio', 'mandria', "Strada dell'Armistizio", 9],

  ['debussy', 'plebiscito', 'Via del Plebiscito', 9],
  ['plebiscito', 'callegari', 'Via Cardinal Callegari', 9],
  ['callegari', 'zanchi', 'Via Benedetti', 9],
  ['zanchi', 'arcella', 'Via Zanchi', 9],
  ['trieste', 'boschetti', 'Via Trieste', 10],
  ['boschetti', 'ospedale', 'Via Giustiniani', 10],
  ['ospedale', 'gattamelata', 'Via Gattamelata', 10],
  ['gattamelata', 'cavazzana', 'Via Cavazzana', 9],
  ['cavazzana', 'pratosud', 'Via Cavazzana', 9],
  ['bassanello', 'battaglia', 'Strada Battaglia', 10],
  ['battaglia', 'santagostino', 'Strada Battaglia', 10],
  ['santagostino', 'mandriola', 'Via Sant’Agostino', 9],

  ['businello', 'pratoovest', 'Prato della Valle', 10],
  ['pratoovest', 'sorio', 'Via Sorio', 9],
  ['sorio', 'aeroporto', 'Via Sorio', 9],
  ['aeroporto', 'brusegana', 'Via dei Colli', 9],
  ['brusegana', 'tencarola', 'Via dei Colli', 9],

  ['stazione', 'fiera', 'Via Niccolò Tommaseo', 11],
  ['fiera', 'stanga', 'Via Niccolò Tommaseo', 11],
  ['stanga', 'sanlazzaro', 'Via Venezia', 12],
  ['sanlazzaro', 'pontebrenta', 'Via Venezia', 11],
  ['gattamelata', 'stanga', 'Via Gattamelata', 10],
  ['cavazzana', 'facciolati', 'Via Facciolati', 10],
  ['facciolati', 'volta', 'Via Facciolati', 10],
  ['gattamelata', 'forcellini', 'Via Forcellini', 10],
  ['forcellini', 'terranegra', 'Via Forcellini', 9],
  ['forcellini', 'facciolati', 'Via Bezzecca', 9],
  ['stazione', 'sarpi', 'Via Paolo Sarpi', 10],
  ['sarpi', 'monta', 'Via Montà', 9],
  ['bassanello', 'bembo', 'Via Pietro Bembo', 10],
  ['bembo', 'sacrafam', 'Via Pietro Bembo', 9],
  ['santo', 'ospedale', 'Via Cesarotti', 9],
];

// Linee: percorsi ricostruiti dalle descrizioni strada per strada di Busitalia Veneto.
// Ogni variante è una sequenza di nodi (andata); il ritorno è l'inverso.
const N_SIR1 = ['pvig', 'dazio', 'saetta', 'sancarlo', 'arcella', 'aspetti', 'borgomagno', 'stazione', 'trieste', 'eremitani', 'garibaldi', 'pontiromani', 'titolivio', 'santo', 'prato', 'pratosud', 'cavallotti', 'bassanello', 'cuoco', 'guizza'];
const N_22 = ['torre', 'salute', 'bajardi', 'machiavelli', 'aspetti', 'borgomagno', 'stazione', 'codalunga', 'giotto', 'largoeuropa', 'pontiromani', 'titolivio', 'businello', 'prato', 'pratosud', 'cavallotti', 'bassanello', 'armistizio', 'mandria'];
const N_24 = ['debussy', 'plebiscito', 'callegari', 'zanchi', 'arcella', 'aspetti', 'borgomagno', 'stazione', 'trieste', 'boschetti', 'ospedale', 'gattamelata', 'cavazzana', 'pratosud', 'cavallotti', 'bassanello', 'battaglia', 'santagostino', 'mandriola'];
const N_12 = ['stazione', 'trieste', 'eremitani', 'garibaldi', 'pontiromani', 'titolivio', 'businello', 'pratoovest', 'sorio', 'aeroporto', 'brusegana', 'tencarola'];

export const LINES = [
  {
    id: 'SIR1',
    color: '#d6202a',
    name: 'Pontevigodarzere – Guizza',
    via: 'Arcella, Stazione, Corso del Popolo, Riviere, Santo, Prato della Valle, Bassanello',
    note: 'Bus sostitutivo del tram sull’asse nord-sud',
    feriale: { headway: 8, first: '05:40', last: '23:20', nodes: N_SIR1 },
    festivo: { headway: 15, first: '07:00', last: '22:30', nodes: N_SIR1 },
  },
  {
    id: '22',
    color: '#c2185b',
    name: 'Torre – Mandria',
    via: 'Via Bajardi, Via Aspetti, Stazione, Viale Codalunga, Riviere, Prato della Valle, Bassanello, Strada Armistizio',
    note: 'Festivo: stesso percorso, frequenza ridotta',
    feriale: { headway: 15, first: '06:10', last: '21:40', nodes: N_22 },
    festivo: { headway: 30, first: '07:40', last: '20:40', nodes: N_22 },
  },
  {
    id: '24',
    color: '#00897b',
    name: 'Largo Debussy – Mandriola',
    via: 'Plebiscito, Via Aspetti, Stazione, Piazzale Boschetti, Ospedale, Via Gattamelata, Prato della Valle, Strada Battaglia',
    note: 'Festivo: limitata Stazione FS – Mandriola',
    feriale: { headway: 20, first: '06:00', last: '21:00', nodes: N_24 },
    festivo: { headway: 40, first: '07:30', last: '20:30', nodes: N_24.slice(N_24.indexOf('stazione')) },
  },
  {
    id: '12',
    color: '#e07b00',
    name: 'Stazione – Tencarola',
    via: 'Corso del Popolo, Riviere, Businello, Prato della Valle, Via Sorio, Aeroporto, Brusegana',
    note: 'Festivo: stesso percorso, frequenza ridotta',
    feriale: { headway: 20, first: '06:00', last: '21:30', nodes: N_12 },
    festivo: { headway: 40, first: '07:30', last: '20:30', nodes: N_12 },
  },
];

// Fiumi e canali: polilinee [lat, lon] + larghezza
export const WATER = [
  { name: 'Brenta', width: 70, pts: [[45.4500, 11.9260], [45.4300, 11.9290], [45.4150, 11.9300], [45.4000, 11.9345], [45.3800, 11.9330], [45.3650, 11.9300]] },
  { name: 'Bacchiglione', width: 38, pts: [[45.3960, 11.8200], [45.3925, 11.8450], [45.3900, 11.8600], [45.3880, 11.8730], [45.3870, 11.8850], [45.3890, 11.9000], [45.3920, 11.9200], [45.3940, 11.9345]] },
  { name: 'Piovego', width: 26, pts: [[45.4118, 11.8812], [45.4100, 11.8900], [45.4085, 11.9000], [45.4100, 11.9120], [45.4120, 11.9300]] },
  { name: 'Tronco Maestro', width: 22, pts: [[45.4180, 11.8650], [45.4130, 11.8700], [45.4070, 11.8718], [45.4025, 11.8722], [45.3990, 11.8700], [45.3940, 11.8650], [45.3925, 11.8450]] },
];

export const RAILWAY = [[45.4215, 11.8300], [45.4200, 11.8550], [45.4190, 11.8700], [45.4189, 11.8805], [45.4178, 11.8950], [45.4205, 11.9150], [45.4250, 11.9350], [45.4290, 11.9600]];

// Landmark (posizioni approssimate)
export const LANDMARKS = {
  prato: [45.3984, 11.8775],
  santo: [45.4013, 11.8812],
  ragione: [45.4074, 11.8758],
  stazione: [45.4186, 11.8792],
  specola: [45.4022, 11.8700],
  duomo: [45.4072, 11.8728],
  scrovegni: [45.4115, 11.8805],
  ospedale: [45.4048, 11.8905],
  fiera: [45.4170, 11.8900],
  orologio: [45.4078, 11.8742],
};

export function buildNetwork() {
  const nodes = {};
  for (const [id, [lat, lon, name, imp]] of Object.entries(NODE_DATA)) {
    const p = toXZ(lat, lon);
    nodes[id] = { id, name, importance: imp, x: p.x, z: p.z, edges: [] };
  }
  const edges = EDGE_DATA.map(([a, b, name, width], i) => {
    const A = nodes[a], B = nodes[b];
    if (!A || !B) throw new Error('Nodo mancante ' + a + '/' + b);
    const dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    const e = { id: i, a, b, name, width, len, dx: dx / len, dz: dz / len };
    A.edges.push(e);
    B.edges.push(e);
    return e;
  });
  const edgeBetween = (a, b) => nodes[a].edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  for (const L of LINES) for (const v of ['feriale', 'festivo']) {
    const seq = L[v].nodes;
    for (let i = 0; i < seq.length - 1; i++) if (!edgeBetween(seq[i], seq[i + 1])) throw new Error(`Linea ${L.id}: manca ${seq[i]}-${seq[i + 1]}`);
  }
  const conv = (arr) => arr.map(([la, lo]) => toXZ(la, lo));
  const water = WATER.map((w) => ({ ...w, pts: conv(w.pts) }));
  const railway = conv(RAILWAY);
  const landmarks = Object.fromEntries(Object.entries(LANDMARKS).map(([k, [la, lo]]) => [k, toXZ(la, lo)]));
  return { nodes, edges, edgeBetween, water, railway, landmarks };
}

export function parseHM(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 3600 + m * 60;
}
export function fmtHM(sec, withSec = false) {
  sec = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const p = (n) => String(n).padStart(2, '0');
  return withSec ? `${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}`;
}
