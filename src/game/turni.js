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

const cache = new Map();

// tutte le corse della linea in quel giorno, con prev e next del turno
export function turni(L, day) {
  const key = L.id + ':' + day;
  if (cache.has(key)) return cache.get(key);
  const runs = [];
  for (const v of L.variants) for (const { t, d } of v[day] || []) runs.push({ L, v, t, d, end: t + tripDuration(v, d), prev: null, next: null });
  const byDep = runs.slice().sort((a, b) => a.t - b.t);
  for (const r of runs.slice().sort((a, b) => a.end - b.end)) {
    const to = r.v.stops[r.v.stops.length - 1];
    for (const q of byDep) {
      if (q.t < r.end + SOSTA_MIN || q.prev) continue;
      if (q.t > r.end + SOSTA_FUORI) break;
      const fuori = r.v.cutEnd || q.v.cutStart, from = q.v.stops[0];
      if (q.t > r.end + (fuori ? SOSTA_FUORI : SOSTA_MAX) || Math.hypot(from.x - to.x, from.z - to.z) > (fuori ? VICINO_FUORI : VICINO)) continue;
      r.next = q; q.prev = r;
      break;
    }
  }
  const res = { runs, find: (v, t) => runs.find((r) => r.v === v && Math.abs(r.t - t) < 60) || null };
  cache.set(key, res);
  return res;
}

// la corsa e il suo posto nel turno: { run, first, last, n (corsa n-esima), of (corse del turno) }
export function turnoOf(L, day, v, t) {
  const run = turni(L, day).find(v, t);
  if (!run) return null;
  let a = run, n = 1, of = 1;
  while (a.prev) { a = a.prev; n++; }
  for (let b = a; b.next; b = b.next) of++;
  return { run, first: !run.prev, last: !run.next, n, of };
}
