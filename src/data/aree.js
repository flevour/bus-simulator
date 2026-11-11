// Aree della mappa fuori dal bundle (caricamento per aree, docs/ESTENSIONE_LINEE.md sezione 4): edifici, marciapiedi e
// verde della pianta delle strade, alberi, in un file per riquadro da 800 m, public/mappa/aree/<ix>_<iz>.json
// (scripts/aree_mappa.py). La rete (nodi, archi, linee, segnaletica, terreno, carreggiate e isole) resta in
// padova-map.json, che le elenca in MAP.aree.
// La città (src/world/city.js) chiede le aree vicine al bus e libera quelle lontane; qui si scaricano e si tengono finché
// servono. Nella pagina autosufficiente (npm run build:single) sono già tutte dentro, dal modulo virtuale di
// vite.config.js.
import MAP from './padova-map.json' with { type: 'json' };
import INLINE from 'virtual:aree-mappa';

export const AREA_SIZE = MAP.aree ? MAP.aree.lato : 800;
export const AREA_KEYS = MAP.aree ? MAP.aree.chiavi : [];
const data = new Map(); // chiave -> dati dell'area
const pending = new Map(); // chiave -> promessa dello scaricamento
if (INLINE) AREA_KEYS.forEach((k, i) => data.set(k, INLINE[i]));

async function fetchArea(k, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(`mappa/aree/${k}.json`);
      if (!r.ok) throw new Error(`area ${k}: HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((ok) => setTimeout(ok, 400 * i));
    }
  }
}

// i dati dell'area, se ci sono già
export const areaData = (k) => data.get(k) || null;

// scarica l'area (una volta sola anche se la si chiede più volte)
export function requestArea(k) {
  if (data.has(k)) return Promise.resolve(data.get(k));
  if (!pending.has(k)) {
    pending.set(k, fetchArea(k).then((a) => { data.set(k, a); pending.delete(k); return a; }, (e) => { pending.delete(k); throw e; }));
  }
  return pending.get(k);
}

// la città non usa più l'area: i dati si liberano (si riscaricano, dalla cache del browser, se tornano a servire)
export function dropArea(k) {
  if (!INLINE) data.delete(k);
}

export const areasLoading = () => pending.size;

// le aree che toccano il cerchio (x, z, r)
export function areaKeysNear(x, z, r) {
  const S = AREA_SIZE, out = [];
  for (const k of AREA_KEYS) {
    const [ix, iz] = k.split('_').map(Number);
    const dx = Math.max(ix * S - x, 0, x - (ix + 1) * S), dz = Math.max(iz * S - z, 0, z - (iz + 1) * S);
    if (dx * dx + dz * dz <= r * r) out.push(k);
  }
  return out;
}

// scarica le aree entro r metri da (x, z); onProgress(scaricate, totale)
export async function loadAreasNear(x, z, r, onProgress = () => {}) {
  const keys = areaKeysNear(x, z, r);
  let done = 0;
  await Promise.all(keys.map((k) => requestArea(k).then(() => onProgress(++done, keys.length))));
}

export const loadAllAreas = () => Promise.all(AREA_KEYS.map(requestArea));
