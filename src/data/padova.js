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
  pvig: [45.4445, 11.8768, 'Pontevigodarzere', 2],
  dazio: [45.4405, 11.8783, 'Dazio', 1],
  saetta: [45.4365, 11.8800, 'Saetta', 1],
  sancarlo: [45.4322, 11.8818, 'San Carlo', 2],
  arcella: [45.4278, 11.8830, 'Arcella', 3],
  borgomagno: [45.4228, 11.8822, 'Borgomagno', 1],
  stazione: [45.4180, 11.8805, 'Stazione FS', 3],
  trieste: [45.4143, 11.8795, 'Trieste', 2],
  eremitani: [45.4108, 11.8792, 'Eremitani', 2],
  garibaldi: [45.4082, 11.8785, 'Piazza Garibaldi', 3],
  pontiromani: [45.4062, 11.8790, 'Ponti Romani', 2],
  titolivio: [45.4040, 11.8782, 'Tito Livio', 2],
  santo: [45.4018, 11.8792, 'Santo', 3],
  prato: [45.3994, 11.8792, 'Prato della Valle', 3],
  pratosud: [45.3962, 11.8780, 'Prato Sud', 1],
  cavallotti: [45.3932, 11.8774, 'Cavallotti', 1],
  bassanello: [45.3885, 11.8752, 'Bassanello', 2],
  cuoco: [45.3830, 11.8762, 'Cuoco', 1],
  guizza: [45.3765, 11.8770, 'Guizza', 2],

  fiera: [45.4160, 11.8885, 'Fiera', 2],
  stanga: [45.4128, 11.8995, 'Stanga', 2],
  sanlazzaro: [45.4140, 11.9150, 'San Lazzaro', 1],
  pontebrenta: [45.4162, 11.9330, 'Ponte di Brenta', 2],
  pdbcap: [45.4182, 11.9425, 'Ponte di Brenta Capolinea', 1],

  facciolati: [45.3928, 11.8870, 'Facciolati', 1],
  volta: [45.3848, 11.8962, 'Voltabarozzo', 1],
  voltacap: [45.3805, 11.9035, 'Voltabarozzo Capolinea', 1],

  codalunga: [45.4130, 11.8735, 'Codalunga', 1],
  mazzini: [45.4108, 11.8710, 'Piazza Mazzini', 2],
  corsomilano: [45.4082, 11.8692, 'Corso Milano', 2],
  sorio: [45.4062, 11.8600, 'Sorio', 1],
  chiesanuova: [45.4122, 11.8475, 'Chiesanuova', 1],
  chiesacap: [45.4140, 11.8390, 'Chiesanuova Capolinea', 1],
  brusegana: [45.4012, 11.8480, 'Brusegana', 1],
  bruscap: [45.3992, 11.8405, 'Brusegana Capolinea', 1],

  guidoreni: [45.4268, 11.8920, 'Guido Reni', 1],
  mortise: [45.4265, 11.9030, 'Mortise', 1],
  torre: [45.4292, 11.9160, 'Torre', 1],
  sarpi: [45.4162, 11.8692, 'Sarpi', 1],
  monta: [45.4222, 11.8560, 'Montà', 1],
  montacap: [45.4246, 11.8460, 'Montà Capolinea', 1],

  belzoni: [45.4068, 11.8860, 'Belzoni', 1],
  ospedale: [45.4032, 11.8888, 'Ospedale', 3],
  sanmassimo: [45.4022, 11.8840, 'San Massimo', 1],
  gattamelata: [45.4010, 11.8938, 'Gattamelata', 1],
  forcellini: [45.3968, 11.8995, 'Forcellini', 1],
  terranegra: [45.3905, 11.9105, 'Terranegra', 1],

  bembo: [45.3925, 11.8690, 'Bembo', 1],
  sacrafam: [45.3950, 11.8620, 'Sacra Famiglia', 2],
  armistizio: [45.3812, 11.8642, 'Armistizio', 1],
  mandria: [45.3748, 11.8532, 'Mandria', 1],
};

// [a, b, nome via, larghezza carreggiata (m)]
const EDGE_DATA = [
  ['pvig', 'dazio', 'Via Pontevigodarzere', 10],
  ['dazio', 'saetta', 'Via Pontevigodarzere', 10],
  ['saetta', 'sancarlo', 'Via Tiziano Aspetti', 10],
  ['sancarlo', 'arcella', 'Via Tiziano Aspetti', 10],
  ['arcella', 'borgomagno', 'Via Tiziano Aspetti', 10],
  ['borgomagno', 'stazione', 'Cavalcavia Borgomagno', 11],
  ['stazione', 'trieste', 'Corso del Popolo', 12],
  ['trieste', 'eremitani', 'Corso Garibaldi', 10],
  ['eremitani', 'garibaldi', 'Corso Garibaldi', 10],
  ['garibaldi', 'pontiromani', 'Riviera dei Ponti Romani', 9],
  ['pontiromani', 'titolivio', 'Riviera Tito Livio', 9],
  ['titolivio', 'santo', 'Via del Santo', 9],
  ['santo', 'prato', 'Via Luca Belludi', 9],
  ['prato', 'pratosud', 'Prato della Valle', 11],
  ['pratosud', 'cavallotti', 'Via Felice Cavallotti', 10],
  ['cavallotti', 'bassanello', 'Via Felice Cavallotti', 10],
  ['bassanello', 'cuoco', 'Via Guizza', 10],
  ['cuoco', 'guizza', 'Via Guizza', 10],

  ['stazione', 'fiera', 'Via Niccolò Tommaseo', 11],
  ['fiera', 'stanga', 'Via Niccolò Tommaseo', 11],
  ['stanga', 'sanlazzaro', 'Via Venezia', 12],
  ['sanlazzaro', 'pontebrenta', 'Via Venezia', 11],
  ['pontebrenta', 'pdbcap', 'Via San Marco', 9],

  ['pratosud', 'facciolati', 'Via Jacopo Facciolati', 10],
  ['facciolati', 'volta', 'Via Jacopo Facciolati', 10],
  ['volta', 'voltacap', 'Via Vigonovese', 9],

  ['trieste', 'codalunga', 'Viale della Codalunga', 10],
  ['codalunga', 'mazzini', 'Viale della Codalunga', 10],
  ['mazzini', 'corsomilano', 'Corso Milano', 10],
  ['corsomilano', 'sorio', 'Via Sorio', 9],
  ['sorio', 'chiesanuova', 'Via Chiesanuova', 9],
  ['chiesanuova', 'chiesacap', 'Via Chiesanuova', 9],
  ['sorio', 'brusegana', 'Via dei Colli', 9],
  ['brusegana', 'bruscap', 'Via dei Colli', 9],

  ['torre', 'mortise', 'Via Mortise', 9],
  ['mortise', 'guidoreni', 'Via Guido Reni', 9],
  ['guidoreni', 'arcella', 'Via Guido Reni', 9],
  ['stazione', 'sarpi', 'Via Paolo Sarpi', 10],
  ['sarpi', 'monta', 'Via Montà', 9],
  ['monta', 'montacap', 'Via Montà', 9],

  ['pontiromani', 'belzoni', 'Via Belzoni', 9],
  ['belzoni', 'ospedale', 'Via Giustiniani', 10],
  ['santo', 'sanmassimo', 'Via Cesarotti', 9],
  ['sanmassimo', 'ospedale', 'Via San Massimo', 9],
  ['ospedale', 'gattamelata', 'Via Gattamelata', 10],
  ['gattamelata', 'forcellini', 'Via Forcellini', 10],
  ['forcellini', 'terranegra', 'Via Forcellini', 9],
  ['gattamelata', 'stanga', 'Via Gattamelata', 10],

  ['bassanello', 'bembo', 'Via Pietro Bembo', 10],
  ['bembo', 'sacrafam', 'Via Pietro Bembo', 9],
  ['bassanello', 'armistizio', "Via dell'Armistizio", 9],
  ['armistizio', 'mandria', 'Via Romana Aponense', 9],
  ['forcellini', 'facciolati', 'Via Bezzecca', 9],
  ['fiera', 'gattamelata', 'Via Venezia (sottopasso)', 9],
];

// Linee: ogni variante è una sequenza di nodi (andata). Il ritorno è l'inverso.
export const LINES = [
  {
    id: 'SIR1',
    color: '#d6202a',
    name: 'Pontevigodarzere – Guizza',
    note: 'Bus sostitutivo del tram SIR1 lungo tutto l’asse nord-sud',
    feriale: { headway: 8, first: '05:40', last: '23:20', nodes: ['pvig', 'dazio', 'saetta', 'sancarlo', 'arcella', 'borgomagno', 'stazione', 'trieste', 'eremitani', 'garibaldi', 'pontiromani', 'titolivio', 'santo', 'prato', 'pratosud', 'cavallotti', 'bassanello', 'cuoco', 'guizza'] },
    festivo: { headway: 15, first: '07:00', last: '22:30', nodes: ['pvig', 'dazio', 'saetta', 'sancarlo', 'arcella', 'borgomagno', 'stazione', 'trieste', 'eremitani', 'garibaldi', 'pontiromani', 'titolivio', 'santo', 'prato', 'pratosud', 'cavallotti', 'bassanello', 'cuoco', 'guizza'] },
  },
  {
    id: '3',
    color: '#1f7a3a',
    name: 'Ponte di Brenta – Voltabarozzo',
    note: 'Festivo: limitata a Prato della Valle',
    feriale: { headway: 12, first: '05:50', last: '22:40', nodes: ['pdbcap', 'pontebrenta', 'sanlazzaro', 'stanga', 'fiera', 'stazione', 'trieste', 'eremitani', 'garibaldi', 'pontiromani', 'titolivio', 'santo', 'prato', 'pratosud', 'facciolati', 'volta', 'voltacap'] },
    festivo: { headway: 30, first: '07:20', last: '21:50', nodes: ['pdbcap', 'pontebrenta', 'sanlazzaro', 'stanga', 'fiera', 'stazione', 'trieste', 'eremitani', 'garibaldi', 'pontiromani', 'titolivio', 'santo', 'prato'] },
  },
  {
    id: '10',
    color: '#e07b00',
    name: 'Stazione – Chiesanuova',
    note: 'Festivo: linea 10/16 per Brusegana',
    feriale: { headway: 15, first: '06:00', last: '21:45', nodes: ['stazione', 'trieste', 'codalunga', 'mazzini', 'corsomilano', 'sorio', 'chiesanuova', 'chiesacap'] },
    festivo: { headway: 30, first: '07:30', last: '20:30', nodes: ['stazione', 'trieste', 'codalunga', 'mazzini', 'corsomilano', 'sorio', 'brusegana', 'bruscap'] },
  },
  {
    id: '12',
    color: '#6a3fa0',
    name: 'Torre – Stazione – Montà',
    note: 'Festivo: limitata Torre – Stazione',
    feriale: { headway: 15, first: '06:10', last: '21:30', nodes: ['torre', 'mortise', 'guidoreni', 'arcella', 'borgomagno', 'stazione', 'sarpi', 'monta', 'montacap'] },
    festivo: { headway: 40, first: '07:40', last: '20:00', nodes: ['torre', 'mortise', 'guidoreni', 'arcella', 'borgomagno', 'stazione'] },
  },
  {
    id: '15',
    color: '#0a6fb8',
    name: 'Stazione – Ospedale – Terranegra',
    note: 'Festivo: deviata via Santo (Via Belzoni chiusa)',
    feriale: { headway: 10, first: '05:55', last: '22:15', nodes: ['stazione', 'trieste', 'eremitani', 'garibaldi', 'pontiromani', 'belzoni', 'ospedale', 'gattamelata', 'forcellini', 'terranegra'] },
    festivo: { headway: 30, first: '07:15', last: '21:15', nodes: ['stazione', 'trieste', 'eremitani', 'garibaldi', 'pontiromani', 'titolivio', 'santo', 'sanmassimo', 'ospedale', 'gattamelata', 'forcellini', 'terranegra'] },
  },
  {
    id: '22',
    color: '#c2185b',
    name: 'Sacra Famiglia – Ospedale – Stanga',
    note: 'Festivo: limitata Sacra Famiglia – Ospedale',
    feriale: { headway: 12, first: '06:05', last: '21:20', nodes: ['sacrafam', 'bembo', 'bassanello', 'cavallotti', 'pratosud', 'prato', 'santo', 'sanmassimo', 'ospedale', 'gattamelata', 'stanga'] },
    festivo: { headway: 30, first: '07:45', last: '20:15', nodes: ['sacrafam', 'bembo', 'bassanello', 'cavallotti', 'pratosud', 'prato', 'santo', 'sanmassimo', 'ospedale'] },
  },
  {
    id: '24',
    color: '#00897b',
    name: 'Mandria – Stazione',
    note: 'Passa da Prato della Valle e dal centro storico',
    feriale: { headway: 15, first: '06:00', last: '21:00', nodes: ['mandria', 'armistizio', 'bassanello', 'cavallotti', 'pratosud', 'prato', 'santo', 'titolivio', 'pontiromani', 'garibaldi', 'eremitani', 'trieste', 'stazione'] },
    festivo: { headway: 30, first: '07:30', last: '20:30', nodes: ['mandria', 'armistizio', 'bassanello', 'cavallotti', 'pratosud', 'prato', 'santo', 'titolivio', 'pontiromani', 'garibaldi', 'eremitani', 'trieste', 'stazione'] },
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
