// Conto per area (tests/aree.spec.js): la funzione che gira nella pagina del gioco. Deve bastare a sé stessa:
// Playwright la passa come testo.

// Per ogni area della mappa dice se è in scena e, se c'è, cosa la città ha messo per lei: quello che ha contato
// caricandola (A.conto, da City.addArea) e quello che sta davvero nella scena (edifici nei riquadri, mesh di
// marciapiedi e verde, alberi disegnati e ostacoli). `differenze` elenca quello che non torna: un'area contata diversa
// dal conto della build (`conto`, da data/conto-aree.json), edifici che non stanno in nessun riquadro, mesh o riquadri
// fuori dalla scena, alberi diversi da quelli che la regola lascia (fuori da strade e binari), e gli oggetti rimasti in
// scena di aree che non ci sono più.
export async function contoScena(conto) {
  const g = window.__game, city = g.city, bx = g.bus.x, bz = g.bus.z, LATO = 800;
  const diff = [], aree = [];
  // edifici tolti perché sopra i binari dei depositi (City.addBuildings), per area del baricentro
  const tolti = {};
  for (const b of (city.depotDropped || new Map()).values()) {
    let x = 0, z = 0;
    for (const p of b.pts) { x += p.x; z += p.z; }
    const k = `${Math.floor(x / b.pts.length / LATO)}_${Math.floor(z / b.pts.length / LATO)}`;
    tolti[k] = (tolti[k] || 0) + 1;
  }
  const delleAree = new Set(), riquadri = new Set();
  for (const A of city.areas.values()) {
    const [ix, iz] = A.key.split('_').map(Number);
    const dist = Math.hypot(Math.max(ix * LATO - bx, 0, bx - (ix + 1) * LATO), Math.max(iz * LATO - bz, 0, bz - (iz + 1) * LATO));
    aree.push({ k: A.key, dist: Math.round(dist), aggiunta: !!A.added, fallita: !!A.failed });
    if (!A.added) continue;
    const c = conto[A.key], no = (cosa) => diff.push(`area ${A.key}: ${cosa}`);
    if (!c) { no('non è nel conto della build'); continue; }
    for (const t of ['edifici', 'marciapiedi', 'verde', 'alberi']) if (A.conto[t] !== c[t]) no(`${t} ${A.conto[t]} nel gioco, ${c[t]} nel conto della build`);
    // edifici: tutti in un riquadro dell'area, tranne quelli sopra i binari dei depositi
    const neiRiquadri = A.tiles.reduce((s, t) => s + t.list.length, 0);
    if (neiRiquadri + (tolti[A.key] || 0) !== c.edifici) no(`${neiRiquadri} edifici nei riquadri e ${tolti[A.key] || 0} tolti dai depositi, ${c.edifici} nel conto`);
    for (const t of A.tiles) {
      riquadri.add(t);
      if (city.tiles.get(t.key) !== t) no(`il riquadro ${t.key} non è tra quelli della città`);
      if (t.built && t.list.length && !t.meshes.length) no(`il riquadro ${t.key} è costruito senza mesh`);
      for (const m of t.meshes) if (m.parent !== city.group) no(`una mesh del riquadro ${t.key} non è in scena`);
    }
    // marciapiedi e verde: una mesh ciascuno se l'area ne ha; alberi: tronchi e chiome, uno per albero rimasto
    for (const m of A.meshes) { delleAree.add(m); if (m.parent !== city.group) no('una mesh dell\'area non è in scena'); }
    const con = (mat) => A.meshes.filter((m) => m.material === mat).length;
    if (con(city.walkMat) !== (c.marciapiedi ? 1 : 0)) no(`${con(city.walkMat)} mesh di marciapiede per ${c.marciapiedi} poligoni`);
    if (con(city.greenMat) !== (c.verde ? 1 : 0)) no(`${con(city.greenMat)} mesh di verde per ${c.verde} poligoni`);
    const d = await (await fetch(`mappa/aree/${A.key}.json`)).json();
    let restano = 0;
    for (let i = 0; i < d.alberi.length; i += 2) if (city.clearance(d.alberi[i], d.alberi[i + 1], ['road', 'tram'], 12) >= 0.8) restano++;
    const ist = A.meshes.filter((m) => m.isInstancedMesh);
    if (ist.length !== (restano ? 2 : 0) || ist.some((m) => m.count !== restano)) no(`alberi disegnati ${ist.map((m) => m.count).join(' e ') || 0}, ${restano} fuori da strade e binari su ${c.alberi}`);
    if (A.obs.length !== restano) no(`${A.obs.length} ostacoli degli alberi per ${restano} alberi`);
  }
  // quello che resta in scena di aree che non ci sono più
  for (const t of city.tiles.values()) if (!riquadri.has(t)) diff.push(`il riquadro ${t.key} è in scena senza la sua area`);
  let sciolte = 0;
  for (const m of city.group.children) {
    if (delleAree.has(m) || !m.isMesh) continue;
    if (m.isInstancedMesh && m.geometry === city.trees3d().trunkG) sciolte++;
    if (m.material === city.greenMat && m.geometry.attributes.position && m.geometry.attributes.position.count) sciolte++;
  }
  const dentro = aree.filter((a) => a.aggiunta);
  return { x: Math.round(bx), z: Math.round(bz), aree, aggiunte: dentro.length, edifici: city.realBuildingCount, riquadri: city.tiles.size, costruiti: city.tilesBuilt, sciolte, differenze: diff };
}
