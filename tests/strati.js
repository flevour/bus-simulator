// Strati da vicino e da lontano (tests/strati.spec.js): le funzioni che girano nella pagina del gioco. Devono bastare a
// sé stesse: Playwright le passa come testo.
//
// Asfalto, sede del tram, marciapiedi, isole e segni sono strati sullo stesso piano: chi si vede lo decidono
// polygonOffset (layer() in src/world/city.js), l'ordine di disegno e pochi centimetri di quota, su una profondità da
// 0,35 a 7000 m. Lo spostamento di polygonOffset cresce con la distanza, i centimetri no: dove due strati si
// sovrappongono in pianta, da vicino vince il più alto e da lontano quello col numero più grande. Qui si disegnano solo
// gli strati, ognuno col suo numero e con la quota di ogni pixel, e si guarda lo stesso punto della strada da due
// distanze lungo la stessa linea di vista.

// Prepara la scena: restano visibili solo gli strati (i materiali con polygonOffset e il verde delle aree), ognuno con
// un materiale che scrive nel pixel la quota (16 bit, rosso e verde) e il numero dello strato (blu). Il prato di fondo
// non scrive la profondità e non copre niente: resta lo sfondo (numero 0). Stesso polygonOffset, depthWrite,
// trasparenza e ordine dei materiali di prima, così vince chi vince nel gioco.
export function preparaStrati() {
  const g = window.__game, city = g.city;
  const Basic = city.poolMat.constructor;
  let Target = null;
  g.scene.traverse((o) => { if (!Target && o.isLight && o.shadow && o.shadow.map) Target = o.shadow.map.constructor; });
  if (!Target) throw new Error('nessuna luce con la mappa delle ombre: manca la classe del render target');
  const S = { nascosti: [], cambiati: [], strati: [], quota: { value: new g.camera.position.constructor(0, 1, 0) } };
  const nome = (o, m) => {
    if (m === city.greenMat) return 'verde';
    if (o === city.ground || !m.polygonOffset || (m.transparent && !m.alphaTest)) return null;
    return `strato ${-m.polygonOffsetFactor}`;
  };
  const trovati = [];
  g.scene.traverse((o) => {
    if (!o.geometry || !(o.isMesh || o.isLine || o.isPoints)) return;
    const m = o.material, n = !Array.isArray(m) && o.isMesh ? nome(o, m) : null;
    if (n) trovati.push([o, m, n]);
    else if (o.visible) { o.visible = false; S.nascosti.push(o); }
  });
  // nell'ordine dei materiali di prima: tra due strati alla stessa profondità vince l'ultimo disegnato
  const mats = [...new Map(trovati.map(([, m, n]) => [m, n]))].sort((a, b) => a[0].id - b[0].id);
  const perMat = new Map();
  for (const [m, n] of mats) {
    const k = S.strati.length + 1;
    const mat = new Basic({ fog: false, toneMapped: false, side: m.side, transparent: m.transparent, depthWrite: m.depthWrite, depthTest: m.depthTest, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits, alphaTest: m.alphaTest, map: m.alphaTest ? m.map : null });
    mat.userData.terrainGround = !!m.userData.terrainGround;
    const terreno = Object.getPrototypeOf(mat).onBeforeCompile;
    mat.onBeforeCompile = (sh) => {
      terreno.call(mat, sh);
      sh.uniforms.uQuota = S.quota;
      sh.uniforms.uStrato = { value: k / 255 };
      const fine = sh.vertexShader.lastIndexOf('}');
      sh.vertexShader = 'varying float vQuota;\n' + sh.vertexShader.slice(0, fine) + 'vQuota = (inverse(viewMatrix) * mvPosition).y;\n}' + sh.vertexShader.slice(fine + 1);
      sh.fragmentShader = 'uniform vec3 uQuota; uniform float uStrato; varying float vQuota;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float q16 = clamp((vQuota - uQuota.x) / uQuota.y, 0.0, 1.0) * 65535.0, qAlto = floor(q16 / 256.0);
        gl_FragColor = vec4(qAlto / 255.0, floor(q16 - qAlto * 256.0) / 255.0, uStrato, 1.0);`);
    };
    perMat.set(m, mat);
    S.strati.push({ k, nome: n, mat, colore: m.color ? '#' + m.color.getHexString() : '', oggetti: 0 });
  }
  for (const [o, m] of trovati) {
    S.cambiati.push([o, m]);
    o.material = perMat.get(m);
    S.strati[mats.findIndex((x) => x[0] === m)].oggetti++;
  }
  S.cam = g.camera.clone();
  S.target = new Target(1280, 720);
  window.__strati = S;
  return S.strati.map((s) => ({ k: s.k, nome: s.nome, colore: s.colore, oggetti: s.oggetti }));
}

// Rimette la scena com'era.
export function finisciStrati() {
  const S = window.__strati;
  if (!S) return;
  for (const o of S.nascosti) o.visible = true;
  for (const [o, m] of S.cambiati) o.material = m;
  for (const s of S.strati) s.mat.dispose();
  S.target.dispose();
  window.__strati = null;
}

// Una veduta degli strati da due distanze. Il bersaglio è il punto (x, z) sul piano della strada; la linea di vista ha
// l'azimut `verso` (gradi, come la direzione del bus) e scende di `giu` gradi; le due telecamere, quelle del gioco
// (68 gradi, da 0,35 a 7000 m, 1280 x 720), stanno su quella linea a `vicino` e a `lontano` metri dal bersaglio. Ogni
// pixel della vista lontana entro `raggio` metri dal bersaglio è un punto del mondo (la sua quota è nel pixel): lo si
// cerca nella vista vicina e si confronta lo strato. Contano solo i punti dove da vicino lo strato è lo stesso nei
// pixel attorno (non un bordo) e la quota è la stessa entro `dy` metri (non un cavalcavia davanti a quello che sta
// sotto). Torna i conti e, per ogni coppia (strato da vicino, strato da lontano) con numeri d'ordine diversi, quanti
// punti e dove.
export function confrontaStrati({ x, z, verso, giu, vicino, lontano, raggio, dy }) {
  const g = window.__game, city = g.city, T = g.terrain, S = window.__strati, r = g.renderer;
  const V3 = g.camera.position.constructor, W = S.target.width, H = S.target.height;
  const h = (verso * Math.PI) / 180, a = (giu * Math.PI) / 180;
  const fx = Math.sin(h) * Math.cos(a), fy = -Math.sin(a), fz = Math.cos(h) * Math.cos(a);
  const yT = T.at(x, z) + city.heightAt(x, z), Y0 = yT - 60, DY = 120;
  S.quota.value.set(Y0, DY, 0);
  const vista = (dist) => {
    const cam = S.cam.clone();
    cam.fov = 68; cam.aspect = W / H; cam.near = 0.35; cam.far = 7000;
    cam.updateProjectionMatrix();
    // posto vero della telecamera; renderer.render la alza della quota del terreno nel suo punto
    const C = { x: x - fx * dist, y: yT - fy * dist, z: z - fz * dist }, alza = T.at(C.x, C.z);
    cam.position.set(C.x, C.y - alza, C.z);
    cam.rotation.set(-a, Math.PI + h, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const colore = r.getClearColor(g.scene.fog.color.clone()), alfa = r.getClearAlpha();
    r.setRenderTarget(S.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(g.scene, cam);
    const px = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(S.target, 0, 0, W, H, px);
    r.setRenderTarget(null);
    r.setClearColor(colore, alfa);
    cam.updateMatrixWorld(true);
    return { cam, C, alza, px };
  };
  const N = vista(vicino), F = vista(lontano);
  const strato = (V, i) => (V.px[i * 4 + 3] ? V.px[i * 4 + 2] : 0);
  const quota = (V, i) => Y0 + ((V.px[i * 4] * 256 + V.px[i * 4 + 1]) / 65535) * DY;
  const p = new V3(), d = new V3();
  const out = { provati: 0, uguali: 0, bordo: 0, altraQuota: 0, stessoNumero: 0, fuoriVista: 0, coppie: {} };
  const nome = (s) => (s ? S.strati[s - 1].nome : 'fondo');
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    // il raggio del pixel (le righe vanno dal basso in alto) e il punto del mondo che si vede da lontano
    p.set(((i + 0.5) / W) * 2 - 1, ((j + 0.5) / H) * 2 - 1, 0.5).unproject(F.cam);
    d.set(p.x - F.C.x, p.y + F.alza - F.C.y, p.z - F.C.z).normalize();
    if (d.y > -0.05) continue;
    let t = (yT - F.C.y) / d.y;
    if (Math.hypot(F.C.x + d.x * t - x, F.C.z + d.z * t - z) > raggio + 8) continue;
    const k = j * W + i, sF = strato(F, k);
    let qy = yT;
    if (sF) { qy = quota(F, k); t = (qy - F.C.y) / d.y; }
    else for (let n = 0; n < 6; n++) { t = (qy - F.C.y) / d.y; qy = T.at(F.C.x + d.x * t, F.C.z + d.z * t); } // sfondo: il prato sul terreno
    const qx = F.C.x + d.x * t, qz = F.C.z + d.z * t;
    if (Math.hypot(qx - x, qz - z) > raggio) continue;
    out.provati++;
    p.set(qx, qy - N.alza, qz).project(N.cam);
    const u = Math.floor(((p.x + 1) / 2) * W), w = Math.floor(((p.y + 1) / 2) * H);
    if (u < 1 || w < 1 || u >= W - 1 || w >= H - 1 || p.z > 1) { out.fuoriVista++; continue; }
    const kN = w * W + u, sN = strato(N, kN);
    let pieno = true;
    for (let b = -1; b <= 1 && pieno; b++) for (let c = -1; c <= 1; c++) if (strato(N, kN + b * W + c) !== sN) { pieno = false; break; }
    if (!pieno) { out.bordo++; continue; }
    if (sN === sF) { out.uguali++; continue; }
    // stesso punto, strato diverso: vale se è la stessa superficie (il prato di fondo sta sul terreno)
    if (sN && Math.abs(quota(N, kN) - qy) > dy) { out.altraQuota++; continue; }
    // due materiali con lo stesso numero d'ordine (carreggiata e carreggiata a senso unico): si vede la stessa cosa
    if (nome(sN) === nome(sF)) { out.stessoNumero++; continue; }
    const coppia = `${nome(sN)} da vicino, ${nome(sF)} da lontano`, c = out.coppie[coppia] || (out.coppie[coppia] = { punti: 0, x: 0, z: 0 });
    c.punti++; c.x += qx; c.z += qz;
  }
  for (const c of Object.values(out.coppie)) { c.x = Math.round((c.x / c.punti) * 10) / 10; c.z = Math.round((c.z / c.punti) * 10) / 10; }
  return out;
}
