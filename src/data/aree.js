// Aree della mappa fuori dal bundle (caricamento per aree, docs/ESTENSIONE_LINEE.md sezione 4): edifici, pianta delle
// strade e alberi in un file per riquadro da 800 m, public/mappa/aree/<ix>_<iz>.json (scripts/aree_mappa.py). La rete
// (nodi, archi, linee, segnaletica, terreno) resta in padova-map.json, che le elenca in MAP.aree.
// Per ora si scaricano tutte all'avvio e si rimettono in MAP prima di buildNetwork, nell'ordine delle chiavi: il gioco
// costruisce la città come quando era tutta nel bundle. Nella pagina autosufficiente (npm run build:single) le aree sono
// già dentro, dal modulo virtuale di vite.config.js.
import MAP from './padova-map.json' with { type: 'json' };
import INLINE from 'virtual:aree-mappa';

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

// onProgress(scaricate, totale)
export async function loadAllAreas(onProgress = () => {}) {
  if (!MAP.aree) return; // mappa ancora intera
  const keys = MAP.aree.chiavi;
  let done = 0;
  const areas = INLINE || await Promise.all(keys.map((k) => fetchArea(k).then((a) => { onProgress(++done, keys.length); return a; })));
  const S = MAP.surfaces;
  for (const a of areas) {
    for (const b of a.edifici) MAP.buildings.push(b);
    if (S) {
      for (const c of a.celle) S.cells.push(c);
      for (const v of a.alberi) S.trees.push(v);
    }
  }
  delete MAP.aree;
}
