// Vedute di riferimento (tests/vedute.spec.js): le due funzioni che girano nella pagina del gioco, per la prova e per gli
// script che fotografano gli stessi punti. Devono bastare a sé stesse: Playwright le passa come testo.

// Scena ferma e uguale a ogni lancio, qualunque prova abbia usato la pagina prima: esplorazione (niente auto, bus e
// tram automatici) sulla linea 24, sereno, luce dell'ora data, tutte le aree della mappa caricate e costruite, niente
// pedoni, l'acqua dei canali ferma, il mezzo di chi guida nascosto. I semafori ripartono tutti dallo stesso ciclo
// all'ora data: ogni tram che passa sposta per sempre il ciclo del suo incrocio (TrafficLights.tramCall), e le
// lanterne cambierebbero con la storia della pagina; finisciVedute rimette i cicli di prima.
export async function preparaVedute({ ora }) {
  const g = window.__game, $ = (q) => document.querySelector(q);
  const prima = { weather: g.settings.weather, lightHour: g.settings.lightHour };
  g.settings.departure = 0;
  g.settings.variant = 'feriale';
  $('#vehicle button[data-k="bus"]').click();
  $('.line-card[data-id="24"]').click();
  $('#mode button[data-m="roam"]').click();
  g.settings.fromDepot = false;
  g.settings.weather = 'clear';
  g.settings.lightHour = ora;
  g.startMission();
  await g.city.loadAll();
  g.city.ensureTiles(0, 0, 1e9);
  g.walkers.target = 0;
  g.walkers.list.length = 0;
  g.walkers.mesh.count = 0;
  g.traffic.target = 0;
  g.traffic.cars.splice(0);
  g.setCam(1); // visuale esterna: niente specchietti né monitor della porta sopra l'immagine
  g.sim(5, 1 / 30, false); // i segnali del tram lasciano le chiamate dei tram di prima
  const L = g.lights;
  prima.cicli = L.signals.map((s) => s.offset);
  for (const s of L.signals) Object.assign(s, { offset: 0, tramT: 0, postT: 0, owed: null, gAge: [0, 0] });
  L.time = ora * 3600 - 10;
  g.sim(10, 1 / 30, false);
  if (g.city.waterTex) g.city.waterTex.offset.x = 0; // l'acqua scorre col tempo di gioco
  g.bus.group.visible = false;
  return prima;
}

// Una veduta: telecamera a 2,5 m dal piano della strada nel punto (x, z), rivolta a `verso` gradi (0 verso +z, 90
// verso +x, come la direzione del bus). Sopra un cavalcavia vale la strada più alta (city.heightAt); il terreno lo
// aggiunge il gioco. L'immagine torna in PNG (base64) a metà grandezza, media di 2 x 2 pixel: 640 x 360.
export function scattaVeduta(v) {
  const g = window.__game, city = g.city, h = (v.verso * Math.PI) / 180;
  g.bus.place(v.x, v.z, h); // sole e ombre seguono il mezzo
  city.streamTiles(v.x, v.z, 0); // riquadri visibili da qui
  const y = city.heightAt(v.x, v.z) + 2.5;
  g.veduta = { x: v.x, y, z: v.z, h };
  g.sim(0, 1 / 30, true);
  g.veduta = null;
  const gl = g.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const w = W >> 1, hh = H >> 1, c = document.createElement('canvas');
  c.width = w;
  c.height = hh;
  const ctx = c.getContext('2d'), im = ctx.createImageData(w, hh), o = im.data;
  // le righe di WebGL vanno dal basso in alto
  for (let r = 0; r < hh; r++) for (let x = 0; x < w; x++) {
    const a = ((H - 1 - 2 * r) * W + 2 * x) * 4, b = a - W * 4, k = (r * w + x) * 4;
    for (let j = 0; j < 3; j++) o[k + j] = (px[a + j] + px[a + 4 + j] + px[b + j] + px[b + 4 + j] + 2) >> 2;
    o[k + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return { png: c.toDataURL('image/png').split(',')[1], larga: W, alta: H, quota: y };
}

// Rimette il gioco com'era per le prove che usano la stessa pagina dopo.
export function finisciVedute(prima) {
  const g = window.__game;
  g.veduta = null;
  g.bus.group.visible = true;
  g.setCam(0);
  if (prima.cicli) g.lights.signals.forEach((s, i) => { s.offset = prima.cicli[i]; });
  Object.assign(g.settings, { weather: prima.weather, lightHour: prima.lightHour });
}
