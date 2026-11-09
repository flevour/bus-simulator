// Aiuti comuni alle prove: apertura del gioco, avvio di una corsa dal menu, raccolta degli errori della pagina.

// Apre il gioco, aspetta che sia pronto (window.__game) e ferma il ciclo di requestAnimationFrame: da qui il tempo
// avanza solo con __game.sim(). Restituisce l'elenco, che si riempie da solo, degli errori in pagina e in console.
export async function apriGioco(page) {
  const errori = [];
  page.on('pageerror', (e) => errori.push(`eccezione: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errori.push(`console: ${m.text()}`); });
  await page.goto(process.env.GIOCO_URL);
  await page.waitForFunction(() => window.__game, null, { timeout: 120_000 });
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  return errori;
}

// Sceglie dal menu mezzo e linea (id della scheda: '24', 'SIR1'...), il verso (0 andata, 1 ritorno) e la modalità,
// poi avvia la corsa. La corsa resta quella che il menu propone (la più vicina alle 8:15 nei giorni feriali), senza
// uscita dal deposito: si parte dal capolinea.
export async function avviaCorsa(page, { linea, tram = false, verso = 0, modo = 'service' }) {
  return page.evaluate(({ linea, tram, verso, modo }) => {
    const g = window.__game, $ = (q) => document.querySelector(q);
    $(`#vehicle button[data-k="${tram ? 'tram' : 'bus'}"]`).click();
    const card = $(`.line-card[data-id="${linea}"]`);
    if (!card) throw new Error(`linea ${linea} non presente nel menu`);
    card.click();
    $(`#direction button[data-d="${verso ? -1 : 1}"]`).click();
    $(`#mode button[data-m="${modo}"]`).click();
    g.settings.fromDepot = false;
    if (g.settings.line.id !== linea) throw new Error(`il menu ha scelto la linea ${g.settings.line.id} invece di ${linea}`);
    g.startMission();
    const m = g.mission;
    return { linea, fermate: m.stops.length, prima: m.stops[0].name, ultima: m.stops[m.stops.length - 1].name, partenza: g.settings.departure };
  }, { linea, tram, verso, modo });
}
