// Aiuti comuni alle prove: il gioco aperto una volta per worker, l'avvio di una corsa dal menu, gli errori della pagina.
import { test as base, expect } from '@playwright/test';

// Apre il gioco, aspetta che sia pronto (window.__game) e ferma il ciclo di requestAnimationFrame: da qui il tempo
// avanza solo con __game.sim(). Restituisce l'elenco, che si riempie da solo, degli errori in pagina e in console.
export async function apriGioco(page) {
  const errori = [];
  page.on('pageerror', (e) => errori.push(`eccezione: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errori.push(`console: ${m.text()}`); });
  // annunci a voce muti: su macOS la sintesi vocale passa dal sistema e si sentirebbe anche con --mute-audio
  await page.addInitScript(() => { if ('speechSynthesis' in window) window.speechSynthesis.speak = () => {}; });
  await page.goto(process.env.GIOCO_URL);
  await page.waitForFunction(() => window.__game, null, { timeout: 270_000 });
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.evaluate(fotografaFunzioni);
  return errori;
}

// Le prove guardano il gioco sostituendo le sue funzioni: gli osservatori di tests/code.js e tests/moto.js avvolgono
// gli update, il corridoio di Via Querini forza un semaforo (lights.stateOf), altre raccolgono i messaggi (hud.toast).
// La pagina serve più prove dello stesso worker, e una sostituzione rimasta cambia quelle dopo: in CI, con due worker,
// la prova dei dieci minuti di code.spec girava subito dopo quella dell'incrocio e trovava il semaforo di Via Querini
// forzato al verde, quindi i bus automatici che passano di lì e tutto il traffico dopo andavano in un altro modo che
// sul Mac, dove con tre worker partiva su una pagina nuova (#145). Gli oggetti che restano da una corsa all'altra sono
// quelli qui sotto (traffico, pedoni e bus di chi guida si rifanno a ogni corsa): all'apertura si fotografano le loro
// funzioni, e a fine prova (`pagina`) si tolgono le sostituzioni dei metodi e si rimettono le funzioni di __game.
export function fotografaFunzioni() {
  const g = window.__game;
  const oggetti = { __game: g, lights: g.lights, trams: g.trams, tramSignals: g.tramSignals, buses: g.buses, city: g.city, net: g.net, hud: g.hud, audio: g.audio, chargers: g.chargers };
  const funzioni = (o) => Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(o)).filter(([, d]) => typeof d.value === 'function').map(([k, d]) => [k, d.value]));
  window.__fotoFunzioni = Object.entries(oggetti).filter(([, o]) => o).map(([nome, o]) => ({ nome, o, prima: funzioni(o) }));
}

// in pagina: rimette le funzioni fotografate; dà quelle rimesse ("lights.stateOf")
export function ripristinaFunzioni() {
  const rimesse = [];
  for (const { nome, o, prima } of window.__fotoFunzioni || []) {
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(o))) {
      if (typeof d.value !== 'function' || d.value === prima[k]) continue;
      // un metodo della classe sostituito sull'oggetto (le funzioni proprie che il gioco crea mentre gira restano)
      if (k in prima) o[k] = prima[k];
      else if (k in Object.getPrototypeOf(o)) delete o[k];
      else continue;
      rimesse.push(`${nome}.${k}`);
    }
  }
  return rimesse;
}

// Caricare la città costa decine di secondi, una corsa nuova no: ogni worker apre il gioco una volta e le prove lo
// riusano, ognuna con la sua corsa. `gioco.errori()` dà gli errori comparsi durante la prova in corso.
export const test = base.extend({
  gioco: [async ({ browser }, use) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const tutti = await apriGioco(page);
    let da = 0;
    await use({ page, inizio: () => { da = tutti.length; }, errori: () => tutti.slice(da) });
    await page.close();
  }, { scope: 'worker', timeout: 300_000 }],
  // prima di ogni prova si azzera l'elenco degli errori; dopo, si tolgono le funzioni del gioco che la prova ha
  // sostituito (fotografaFunzioni, sopra). Se la pagina si è chiusa non c'è niente da rimettere
  pagina: async ({ gioco }, use) => {
    gioco.inizio();
    await use(gioco.page);
    await gioco.page.evaluate(ripristinaFunzioni).catch(() => []);
  },
});
export { expect };

// Tempo massimo di una prova lunga: tre volte la durata più lunga vista in CI (secondi). Sui processori della CI, con
// due worker insieme, la stessa prova dura da una serie all'altra fino al 40% in più (13 novembre, quattro serie: gli
// incroci semaforizzati da 234 a oltre 300 s, Tito Livio da 366 a oltre 480) e sul Mac la metà: con il limite a ridosso
// della durata solita tre serie di fila sono finite rosse per il tempo, ogni volta con prove diverse. È solo il tempo
// che la prova ha per finire: i limiti di merito stanno nelle prove.
export const tempoMassimo = (secondiInCI) => base.setTimeout(secondiInCI * 3000);

// Sceglie dal menu mezzo e linea (id della scheda: '24', 'SIR1'...), il verso (0 andata, 1 ritorno) e la modalità,
// poi avvia la corsa. La corsa è quella che il menu propone (la più vicina alle 8:15 nei giorni feriali) o, con
// `partenza` ('08:36'), quella che parte a quell'ora; senza uscita dal deposito: si parte dal capolinea.
// Con la mappa divisa in aree (src/data/aree.js) aspetta che quelle attorno al bus siano arrivate e costruite.
// Il meteo è il sereno (`meteo`: 'clear', 'rain', 'fog', 'variable'): quello del menu, "Variabile", estrae con
// Math.random quando piove o scende la nebbia, e con l'asfalto bagnato la stessa corsa va in un altro modo a ogni lancio.
// Il resto dello stato di partenza lo fissa startMission: semafori, segnali del tram, sequenze casuali di auto e bus.
export async function avviaCorsa(page, { linea, tram = false, verso = 0, modo = 'service', partenza = null, meteo = 'clear' }) {
  const corsa = await page.evaluate(({ linea, tram, verso, modo, partenza, meteo }) => {
    const g = window.__game, $ = (q) => document.querySelector(q);
    // il menu propone la corsa più vicina a quella scelta prima: senza scelta, quella delle 8:15 (giorno feriale)
    g.settings.departure = 0;
    g.settings.variant = 'feriale';
    $(`#vehicle button[data-k="${tram ? 'tram' : 'bus'}"]`).click();
    const card = $(`.line-card[data-id="${linea}"]`);
    if (!card) throw new Error(`linea ${linea} non presente nel menu`);
    card.click();
    // anche il verso propone la corsa più vicina a quella scelta prima: col verso di una corsa precedente diverso, la
    // prima corsa di una pagina nuova partiva alle 8:26 e le altre alle 8:14 (#115)
    g.settings.departure = 0;
    $(`#direction button[data-d="${verso ? -1 : 1}"]`).click();
    if (partenza) {
      const sel = $('#departure'), i = [...sel.options].findIndex((o) => o.textContent.startsWith(partenza));
      if (i < 0) throw new Error(`nessuna corsa della linea ${linea} alle ${partenza}`);
      sel.value = String(i);
      sel.dispatchEvent(new Event('change'));
    }
    $(`#mode button[data-m="${modo}"]`).click();
    g.settings.fromDepot = false;
    g.settings.weather = meteo;
    if (g.settings.line.id !== linea) throw new Error(`il menu ha scelto la linea ${g.settings.line.id} invece di ${linea}`);
    g.startMission();
    const m = g.mission;
    return { linea, fermate: m.stops.length, prima: m.stops[0].name, ultima: m.stops[m.stops.length - 1].name, partenza: g.settings.departure };
  }, { linea, tram, verso, modo, partenza, meteo });
  // a intervalli e non a ogni fotogramma: le prove spengono il ciclo del gioco (requestAnimationFrame)
  await page.waitForFunction(() => { const g = window.__game; g.city.ensureTiles(g.bus.x, g.bus.z, 650); return g.city.areasReady(g.bus.x, g.bus.z, 650); }, null, { polling: 100, timeout: 120_000 });
  return corsa;
}
