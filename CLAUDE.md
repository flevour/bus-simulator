# CLAUDE.md — Padova Bus Simulator

Istruzioni di progetto per Claude e per chi contribuisce.

## Lavoro e rami

* Si lavora direttamente su **`main` con push continuo**: commit piccoli e frequenti, push su `main` dopo ogni
  modifica verificata. Niente rami remoti né pull request, salvo richiesta esplicita.
* Ogni ticket (issue di GitHub) ha il suo worktree herdr, su un ramo locale `ticket/<n>-<nome>` che si ribasa su
  `origin/main` e si pubblica con `git push origin HEAD:main`; a ticket chiuso il worktree si toglie. Regole, porte e
  file condivisi in [`docs/LAVORO.md`](docs/LAVORO.md): leggilo prima di lavorare in un worktree.
* Il gioco va su GitHub Pages (https://flevour.github.io/bus-simulator/) solo dopo le verifiche: ogni push su `main`
  fa partire `.github/workflows/verifiche.yml` e, se finisce verde, `.github/workflows/pages.yml` pubblica quel
  commit. Un push con una prova rossa lascia il sito com'era, quindi prima di pushare `npm run build` e `npm test`
  devono passare. Tempi e casi particolari nella nota Verifiche di [`docs/LAVORO.md`](docs/LAVORO.md).
* Il vecchio ramo `claude/padova-bus-simulator` è stato unito in `main` e non si usa più.

## Lingua

Interfaccia del gioco, messaggi, commenti nel codice, README e messaggi di commit in **italiano**.

## Idee e specifiche

* Il lavoro da fare sta nelle **issue di GitHub** (label `area:*`, `pronto`, `da-decidere`, `urgente`; issue madri con
  sotto-issue). Come si scrive, si prende e si chiude un ticket è in
  [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md). Il commit che chiude un ticket ha in fondo
  `Closes #<n>`. Il repository è pubblico: niente dati personali nelle issue, immagini citate per percorso locale.
* `IDEE.md`: idee non ancora pronte per diventare un ticket. La sezione "Fatto" non si aggiorna più: la storia sta
  nelle issue chiuse e nei commit.
* `src/data/novita.js`: novità per chi gioca, mostrate nel menu a chi torna. Per ogni modifica che si vede in gioco
  aggiungi in cima una riga in italiano semplice (cosa cambia per chi guida, non come è fatto), con `n` successivo e la
  data del giorno, nello stesso commit della modifica.
* `docs/prompt-tram.md`: specifica del tram SIR1 guidabile.
* `docs/cabina-translohr.md`: ricerca sulla cabina vera del Translohr (comandi uno per uno, procedure di guida, foto
  del SIR3, cosa portare nel gioco), con le fonti; dove contraddice `prompt-tram.md` (pedali, posto di guida a
  sinistra, clacson) vale la ricerca.
* `docs/linee-tram-nuove.md`: ricerca sui tracciati delle linee in costruzione SIR2 e SIR3.
* `docs/binari-tram.md`: regola per la stesura dei binari del tram (raggi, interassi, scambi, pendenze, con le fonti del
  progetto del SIR3), la stesura secondo la regola (`scripts/tram_stesura.py`, oggi per i depositi) e il controllo di
  quanto la rete se ne allontana (`scripts/binari_tram.py`).
* `docs/cavalcavia.md`: regola del profilo dei cavalcavia (pendenze, raccordi verticali, niente onde, strada e binari
  alla stessa quota, scarto dal DTM, con le fonti del DM 5 novembre 2001), il controllo di quanto la mappa se ne
  allontana (`scripts/cavalcavia.py`), il registro delle strutture (`data/cavalcavia.json`: quali hanno il profilo
  calcolato, punti e franchi messi a mano con il perché) e il risolutore (`scripts/profilo_cavalcavia.py`).
* `docs/overpass-segnaletica.md`: segnaletica reale da OSM (query, export dal browser, uso nel gioco).
* `docs/ESTENSIONE_LINEE.md`: linee complete fino ai capolinea veri e caricamento per aree di strade ed edifici.
* `docs/PIANO_MODELLO_CITTA.md`: piano per un modello della città coerente con la realtà (fonti, misure, pipeline,
  verifiche, tappe). Le misure di riferimento della sezione 3 valgono dove mancano i dati.

## Comandi

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # dist/ (quello che va su GitHub Pages)
npm test              # prove nel browser headless (Playwright, tests/); la prima volta: npx playwright install --only-shell chromium
npm run build:single  # dist-single/index.html autosufficiente
python3 scripts/to_artifact.py dist-single/index.html <uscita>.html   # pagina per un artefatto claude.ai
```

Rigenerare i dati della mappa (GTFS Busitalia + OSM + Overture + segnaletica e binari OSM; servono `shapely`,
`pyarrow`, `numpy` e `scipy`; `CAVALCAVIA=registro` davanti al comando riscrive i campi di `data/cavalcavia.json` che
vengono dalla rete):

```bash
curl -L -o /tmp/biv.zip https://proxy.busone.app/biv/gtfs.zip && mkdir -p /tmp/biv && unzip -o /tmp/biv.zip -d /tmp/biv
python3 scripts/build_map.py data/osm-padova.json /tmp/biv src/data/padova-map.json data/overture-buildings-padova.parquet data/osm-padova-nodes.json data/osm-padova-tram.json data/misure-strade.json data/dbgt-volumi.json data/dtm-padova.json data/dbgt-verde.json data/dbgt-strade.json data/osm-fermate.json data/osm-corridoio.json
python3 scripts/verifica_mappa.py --elenco   # rapporto di verifica: esce con errore se i casi non sono quelli degli elenchi
```

`build_map.py` scrive la mappa in due parti (`scripts/aree_mappa.py`): la rete (nodi, archi, linee, fermate,
segnaletica, terreno, carreggiate e isole della pianta delle strade) in `src/data/padova-map.json`, dentro il bundle, ed
edifici, marciapiedi, verde e alberi in un file per riquadro da 800 m in `public/mappa/aree/`, che il gioco scarica
all'avvio (`src/data/aree.js`). Gli script che leggono la mappa intera usano `aree_mappa.load`.

`data/misure-strade.json` (larghezze misurate di carreggiate e marciapiedi) e `data/dbgt-volumi.json` (altezze degli
edifici) vengono dal DBGT della Regione del Veneto con `scripts/measure_streets.py` e `scripts/dbgt_volumes.py`;
`data/dtm-padova.json` (quote del terreno) dal DTM a 5 m della Regione con `scripts/dtm_grid.py`; `data/dbgt-verde.json`
(isole, aree verdi, alberi) e `data/dbgt-strade.json` (poligoni di carreggiate e marciapiedi) dal DBGT con
`scripts/dbgt_green.py` e `scripts/dbgt_streets.py`; `data/osm-fermate.json` (paline OSM con pensilina e panchina)
da Overture con `scripts/osm_stops.py` (comandi nel README).
Il terreno si applica nel vertex shader (`src/world/terrain.js`): i materiali nuovi lo prendono da soli, quelli con un
`onBeforeCompile` proprio devono chiamare `applyTerrain(sh)`; le posizioni in JavaScript restano piane (y = 0) e
`terrain.at(x, z)` dà la quota dove serve (telecamera, pendenza del bus).

`data/osm-padova-nodes.json` (semafori, STOP, dare precedenza, attraversamenti) viene da `scripts/overpass-nodes.ql`
filtrato con `scripts/filter_osm_nodes.py`; `data/osm-padova-tram.json` (binari e banchine del tram) da
`scripts/overpass-tram.ql` filtrato con `scripts/filter_osm_tram.py`: i comandi sono nel README. La pianta delle strade
(carreggiate, marciapiedi, isole, edifici ritagliati) la calcola `scripts/street_surfaces.py`.

## Verifiche

* `npm test` lancia le prove di `tests/` (Playwright, dipendenza di sviluppo): build senza PostHog in una cartella
  temporanea, servita su una porta libera, Chromium con
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --mute-audio`. Si lancia prima di ogni push
  su `main`; il workflow `.github/workflows/verifiche.yml` la ripete in CI. Le prove nuove usano gli aiuti di
  `tests/gioco.js` (gioco aperto una volta per worker, avvio di una corsa dal menu, errori della pagina) e, per
  guidare, il pilota di `tests/guida.js`.
* Rapporto di verifica sulla mappa: `python3 scripts/verifica_mappa.py` sul JSON (dopo ogni rigenerazione) e
  `tests/mappa.spec.js` nel gioco.
* **Soglie per caso, non per conteggio.** Ogni controllo dà ai suoi casi una chiave stabile (struttura, linea e
  fermata, posto) e li confronta con l'elenco dei casi noti in `data/eccezioni/` (`scripts/eccezioni.py`), in gruppi
  con il perché: `verifica-mappa.json`, `cavalcavia.json` (`scripts/cavalcavia.py`, anche da
  `tests/cavalcavia.spec.js`), `mappa-gioco.json` (`tests/mappa.spec.js`). Un caso fuori dall'elenco fa fallire il
  controllo anche se il totale non sale; un caso sparito va tolto dall'elenco nello stesso commit. Dopo una correzione
  l'elenco si riscrive con `--aggiorna` (script) o `ECCEZIONI=aggiorna npx playwright test tests/<prova>.spec.js`: i
  casi nuovi finiscono in un gruppo con il perché vuoto, che va scritto. Un controllo nuovo nasce così, non con un
  conteggio.
* **Niente nomi di luoghi nel codice degli algoritmi.** Una correzione che vale per un solo luogo è una riga in un
  file di dati in `data/` (zona, valore, perché) che l'algoritmo legge, non un ramo nel codice con una via o delle
  coordinate.
* Vedute di riferimento: `tests/vedute.spec.js` confronta le immagini da 43 punti fissi (`tests/vedute/elenco.json`:
  cavalcavia, ponti, capolinea del tram, rotonde e incroci con la sede) con quelle di `tests/vedute/riferimenti/`. Chi
  cambia una veduta di proposito aggiorna il riferimento nello stesso commit
  (`npx playwright test vedute.spec --update-snapshots`, dopo aver guardato le differenze in `test-results/`); i
  dettagli sono in `docs/LAVORO.md`, nota "Verifiche: vedute di riferimento".
* `window.__game` espone lo stato per i test, tra cui `startMission()`, `sim(sec, dt, draw)`, `press(code)`, `keys`,
  `setCam(n)`, `teleport(x, z)`, `settings`, `lines`, `wx`, `city`, `net`. Disattiva il loop con
  `window.requestAnimationFrame = () => 0` e avanza con `sim`.
* Edifici, marciapiedi, verde e alberi arrivano per aree attorno al bus (`src/data/aree.js`): dopo `startMission`
  `avviaCorsa` di `tests/gioco.js` aspetta `city.areasReady(x, z)`; chi misura tutta la mappa chiama prima
  `await city.loadAll()` (come `tests/mappa.spec.js`).
* Dopo modifiche a strade, fermate o edifici, controlla che i percorsi dei bus restino liberi: nessun ostacolo
  nella corsia, fermate raggiungibili.

## Note

* Dati: © OpenStreetMap contributors (ODbL), Overture Maps, GTFS Busitalia Veneto (feed BusOne), Regione del Veneto
  (DBGT e DTM, IODL 2.0). Mantieni l'attribuzione nel gioco e nel README.
* Livree e marchi: riprendere colori e stile dei mezzi, non riprodurre loghi o marchi aziendali.
* Dai container cloud alcuni servizi non sono raggiungibili (Overpass, Geofabrik, server della Regione Veneto). Il feed
  GTFS BusOne e Overture (S3) invece funzionano.
