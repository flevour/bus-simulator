# CLAUDE.md — Padova Bus Simulator

Istruzioni di progetto per Claude e per chi contribuisce.

## Lavoro e rami

* Si lavora direttamente su **`main` con push continuo**: commit piccoli e frequenti, push su `main` dopo ogni
  modifica verificata. Niente rami di lavoro né pull request, salvo richiesta esplicita.
* Ogni push su `main` pubblica il gioco su GitHub Pages (`.github/workflows/pages.yml`):
  https://flevour.github.io/bus-simulator/. Prima di pushare, `npm run build` deve passare.
* Il vecchio ramo `claude/padova-bus-simulator` è stato unito in `main` e non si usa più.

## Lingua

Interfaccia del gioco, messaggi, commenti nel codice, README e messaggi di commit in **italiano**.

## Idee e specifiche

* `IDEE.md`: elenco delle idee e dei prossimi passi. Aggiungi lì le nuove idee e spostale in "Fatto" quando sono
  realizzate.
* `src/data/novita.js`: novità per chi gioca, mostrate nel menu a chi torna. Per ogni modifica che si vede in gioco
  aggiungi in cima una riga in italiano semplice (cosa cambia per chi guida, non come è fatto), con `n` successivo e la
  data del giorno, nello stesso commit della modifica.
* `docs/prompt-tram.md`: specifica del tram SIR1 guidabile.
* `docs/overpass-segnaletica.md`: segnaletica reale da OSM (query, export dal browser, uso nel gioco).
* `docs/PIANO_MODELLO_CITTA.md`: piano per un modello della città coerente con la realtà (fonti, misure, pipeline,
  verifiche, tappe). Le misure di riferimento della sezione 3 valgono dove mancano i dati.

## Comandi

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # dist/ (quello che va su GitHub Pages)
npm run build:single  # dist-single/index.html autosufficiente
python3 scripts/to_artifact.py dist-single/index.html <uscita>.html   # pagina per un artefatto claude.ai
```

Rigenerare i dati della mappa (GTFS Busitalia + OSM + Overture + segnaletica e binari OSM; servono `shapely` e
`pyarrow`):

```bash
curl -L -o /tmp/biv.zip https://proxy.busone.app/biv/gtfs.zip && mkdir -p /tmp/biv && unzip -o /tmp/biv.zip -d /tmp/biv
python3 scripts/build_map.py data/osm-padova.json /tmp/biv src/data/padova-map.json data/overture-buildings-padova.parquet data/osm-padova-nodes.json data/osm-padova-tram.json data/misure-strade.json data/dbgt-volumi.json data/dtm-padova.json data/dbgt-verde.json
```

`data/misure-strade.json` (larghezze misurate di carreggiate e marciapiedi) e `data/dbgt-volumi.json` (altezze degli
edifici) vengono dal DBGT della Regione del Veneto con `scripts/measure_streets.py` e `scripts/dbgt_volumes.py`;
`data/dtm-padova.json` (quote del terreno) dal DTM a 5 m della Regione con `scripts/dtm_grid.py`; `data/dbgt-verde.json`
(isole, aree verdi, alberi) dal DBGT con `scripts/dbgt_green.py` (comandi nel README).
Il terreno si applica nel vertex shader (`src/world/terrain.js`): i materiali nuovi lo prendono da soli, quelli con un
`onBeforeCompile` proprio devono chiamare `applyTerrain(sh)`; le posizioni in JavaScript restano piane (y = 0) e
`terrain.at(x, z)` dà la quota dove serve (telecamera, pendenza del bus).

`data/osm-padova-nodes.json` (semafori, STOP, dare precedenza, attraversamenti) viene da `scripts/overpass-nodes.ql`
filtrato con `scripts/filter_osm_nodes.py`; `data/osm-padova-tram.json` (binari e banchine del tram) da
`scripts/overpass-tram.ql` filtrato con `scripts/filter_osm_tram.py`: i comandi sono nel README. La pianta delle strade
(carreggiate, marciapiedi, isole, edifici ritagliati) la calcola `scripts/street_surfaces.py`.

## Verifiche

* Test nel browser headless con Playwright (Chromium preinstallato nei container cloud). Lancia con
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` e servi il build con `npx vite preview --port 4173`.
* `window.__game` espone lo stato per i test, tra cui `startMission()`, `sim(sec, dt, draw)`, `press(code)`, `keys`,
  `setCam(n)`, `teleport(x, z)`, `settings`, `lines`, `wx`, `city`, `net`. Disattiva il loop con
  `window.requestAnimationFrame = () => 0` e avanza con `sim`.
* Dopo modifiche a strade, fermate o edifici, controlla che i percorsi dei bus restino liberi: nessun ostacolo
  nella corsia, fermate raggiungibili.

## Note

* Dati: © OpenStreetMap contributors (ODbL), Overture Maps, GTFS Busitalia Veneto (feed BusOne), Regione del Veneto
  (DBGT e DTM, IODL 2.0). Mantieni l'attribuzione nel gioco e nel README.
* Livree e marchi: riprendere colori e stile dei mezzi, non riprodurre loghi o marchi aziendali.
* Dai container cloud alcuni servizi non sono raggiungibili (Overpass, Geofabrik, server della Regione Veneto). Il feed
  GTFS BusOne e Overture (S3) invece funzionano.
