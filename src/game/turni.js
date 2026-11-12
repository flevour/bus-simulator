import { tripDuration } from './mission.js';

// Turni macchina ricavati dall'orario. Il GTFS ha solo le corse in servizio: non dice quale mezzo le fa, né quando esce
// dal deposito o ci rientra. Come i blocchi "schedule-inferred" di BusOne, una corsa che arriva al capolinea prosegue
// con la prima corsa della stessa linea che parte da lì dopo la sosta. Le corse che nessuno precede sono le uscite dal
// deposito (le prime del mattino e i rinforzi delle ore di punta), quelle senza seguito i rientri.
const SOSTA_MIN = 3 * 60, SOSTA_MAX = 40 * 60; // sosta al capolinea tra due corse dello stesso mezzo
const VICINO = 250; // metri tra la fermata d'arrivo e quella di partenza della corsa successiva
// capolinea al bordo della mappa (v.cutStart, v.cutEnd: la linea prosegue fuori). L'andata esce e il ritorno rientra
// spesso per strade diverse (sulla 24 a 560 m), e il giro fuori mappa fino al capolinea vero allunga la sosta
const VICINO_FUORI = 1500, SOSTA_FUORI = 60 * 60;
// tram: al più due in sosta a ogni capolinea, uno alla banchina di partenza e uno che arriva o fa la manovra
const POSTI_TRAM = 2;

const cache = new Map();
// tram: sosta più breve dopo una corsa della variante v, dai binari della linea L (la imposta main.js con la città)
let sostaTram = null;
export function impostaSostaTram(f) { sostaTram = f; cache.clear(); }

// tutte le corse della linea in quel giorno, con prev e next del turno. Per il tram i turni sono quelli dei viaggi veri
// (senzaTratti), gli stessi dei tram automatici; ogni tratto sta nel turno della corsa intera che lo contiene, ogni copia
// di una corsa nel turno della corsa che resta
export function turni(L, day) {
  const key = L.id + ':' + day;
  if (cache.has(key)) return cache.get(key);
  let runs = [], tratti = [];
  for (const v of L.variants) for (const { t, d } of v[day] || []) runs.push({ L, v, t, d, end: t + tripDuration(v, d), prev: null, next: null });
  if (L.tram) {
    for (const r of runs) r.times = r.v.offsets.map((o) => r.t + (o * r.d) / r.v.duration);
    ({ viaggi: runs, tratti } = senzaTratti(runs));
    concatena(runs, { posti: POSTI_TRAM, sostaMin: (r) => (sostaTram ? sostaTram(L, r.v) : SOSTA_MIN) });
    // il tratto sta nel turno della corsa intera: dopo la corsa prima di lei, e prosegue con la sua corsa dopo se finisce
    // insieme a lei (altrimenti finisce a metà linea ed è l'ultima del turno di chi lo guida); la copia di una corsa è lo
    // stesso viaggio e ha il suo stesso posto
    for (const k of tratti) {
      const c = k.per, a = k.v.stops[k.v.stops.length - 1], b = c.v.stops[c.v.stops.length - 1];
      k.prev = c.prev;
      if (k.copia || (Math.hypot(a.x - b.x, a.z - b.z) < 150 && Math.abs(k.times[k.times.length - 1] - c.times[c.times.length - 1]) <= 180)) k.next = c.next;
    }
  } else concatena(runs);
  const at = (r, v, t) => r.v === v && Math.abs(r.t - t) < 60;
  const res = { runs, tratti, find: (v, t) => runs.find((r) => at(r, v, t)) || tratti.find((r) => at(r, v, t)) || null };
  cache.set(key, res);
  return res;
}

// Il GTFS dei tram pubblica ogni viaggio anche spezzato in tratti (Guizza → Cavalletto, Santo → Pontevigodarzere…) che
// si sovrappongono alla corsa intera: un tratto la cui prima e ultima fermata sono servite, in quest'ordine ed entro 3
// minuti, da una corsa più lunga della stessa linea è lo stesso tram. Alcuni viaggi del SIR1 ci sono anche due o tre
// volte, ognuno nel suo blocco di BusOne, a volte con tempi diversi (nei feriali dalla Guizza alle 5:35-6:30, alle 6:16
// uno di 39 minuti e uno di 46; da Pontevigodarzere la sera): una corsa con le stesse fermate di un'altra, che parte entro
// un minuto e arriva entro 10 minuti da lei, è lo stesso tram. Resta quella che arriva prima (con la più lenta la corsa
// delle 21:23 arriverebbe a Guizza dopo quella delle 21:30); le copie stanno con i tratti, con copia, e i loro tratti
// vanno con la corsa che resta. Le corse hanno v, t, d e times (l'ora a ogni fermata). Restano i viaggi veri; ogni tratto
// ha in per la corsa intera
export function senzaTratti(runs) {
  // la prima fermata di c, da i in poi, entro 150 m da st e 3 minuti da t: al capolinea del SIR1 ci sono due fermate
  // Pontevigodarzere a 3 minuti l'una dall'altra, conta quella giusta e non la più vicina
  const at = (c, st, t, i = 0) => {
    for (; i < c.v.stops.length; i++) { const s = c.v.stops[i]; if (Math.hypot(s.x - st.x, s.z - st.z) < 150 && Math.abs(c.times[i] - t) <= 180) return i; }
    return -1;
  };
  const covers = (c, k) => {
    if (c === k || c.v.stops.length <= k.v.stops.length || c.t > k.t + 180 || c.t + c.d < k.t + k.d - 180) return false;
    const i = at(c, k.v.stops[0], k.t);
    return i >= 0 && at(c, k.v.stops[k.v.stops.length - 1], k.t + k.d, i + 1) > i;
  };
  const byDep = runs.slice().sort((a, b) => a.t - b.t), viaggi = [], tratti = [];
  let lo = 0;
  for (const k of byDep) {
    while (byDep[lo].t < k.t - 4000) lo++;
    let per = null;
    for (let i = lo; i < byDep.length && byDep[i].t <= k.t + 180; i++) if (covers(byDep[i], k) && (!per || byDep[i].v.stops.length > per.v.stops.length)) per = byDep[i];
    if (per) { k.per = per; tratti.push(k); } else viaggi.push(k);
  }
  // copie: stesse fermate (ogni fermata dell'una vicina a una dell'altra: una variante per la Guizza ha in fondo anche la
  // banchina di partenza, a 3 m da quella d'arrivo), stessa partenza e arrivo vicino
  const vicine = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 150;
  const stesse = (a, b) => a === b || (vicine(a.stops[0], b.stops[0]) && vicine(a.stops[a.stops.length - 1], b.stops[b.stops.length - 1])
    && a.stops.every((s) => b.stops.some((u) => vicine(s, u))) && b.stops.every((s) => a.stops.some((u) => vicine(s, u))));
  const tenuti = [];
  for (const c of viaggi) {
    const i = tenuti.findIndex((k) => c.t - k.t <= 60 && Math.abs(k.t + k.d - c.t - c.d) <= 600 && stesse(k.v, c.v));
    if (i < 0) { tenuti.push(c); continue; }
    const [via, resta] = c.t + c.d < tenuti[i].t + tenuti[i].d ? [tenuti[i], c] : [c, tenuti[i]];
    via.per = resta; via.copia = true; tenuti[i] = resta;
  }
  for (const k of viaggi) if (k.copia) tratti.push(k);
  for (const k of tratti) while (k.per.per) k.per = k.per.per;
  return { viaggi: viaggi.filter((k) => !k.copia), tratti };
}

// Le corse (con v, t ed end) in turni: in ordine d'arrivo ogni corsa prosegue con la prima che parte vicino al suo
// capolinea dopo la sosta, tra quelle che nessuna ha già preso (prev e next). Una linea alla volta. posti: i mezzi che
// possono aspettare insieme a un capolinea (se è pieno la corsa che arriva è l'ultima del turno: il mezzo rientra e la
// partenza la prende un altro); sostaMin(r): la sosta più breve dopo la corsa r
export function concatena(runs, { posti = Infinity, sostaMin = () => SOSTA_MIN } = {}) {
  const byDep = runs.slice().sort((a, b) => a.t - b.t), soste = new Map();
  for (const r of runs.slice().sort((a, b) => a.end - b.end)) {
    const to = r.v.stops[r.v.stops.length - 1];
    // in sosta lì all'arrivo di r: le soste già decise cominciano tutte prima (si va in ordine d'arrivo)
    const qui = soste.get(to.name) || [];
    if (qui.filter((t) => t > r.end).length >= posti) continue;
    const min = sostaMin(r);
    for (const q of byDep) {
      if (q.t < r.end + min || q.prev) continue;
      if (q.t > r.end + SOSTA_FUORI) break;
      const fuori = r.v.cutEnd || q.v.cutStart, from = q.v.stops[0];
      if (q.t > r.end + (fuori ? SOSTA_FUORI : SOSTA_MAX) || Math.hypot(from.x - to.x, from.z - to.z) > (fuori ? VICINO_FUORI : VICINO)) continue;
      r.next = q; q.prev = r;
      soste.set(to.name, [...qui, q.t]);
      break;
    }
  }
  return runs;
}

// la corsa e il suo posto nel turno: { run, first, last, n (corsa n-esima), of (corse del turno) }. Per un tratto del
// tram il posto è quello della corsa intera che lo contiene
export function turnoOf(L, day, v, t) {
  const run = turni(L, day).find(v, t);
  if (!run) return null;
  let n = 1;
  for (let a = run.per || run; a.prev; a = a.prev) n++;
  let of = n;
  for (let b = run; b.next; b = b.next) of++;
  return { run, first: !run.prev, last: !run.next, n, of };
}
