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
  calcolato, punti e franchi messi a mano con il perché), il risolutore (`scripts/profilo_cavalcavia.py`) e le quote
  che il gioco legge per arco e per binario senza cercarle (`scripts/quote_rete.py`: `edgeH` e `tramH` nella mappa;
  profili per struttura in `data/profili-cavalcavia.json`, `scripts/profili_strutture.py`).
* `docs/overpass-segnaletica.md`: segnaletica reale da OSM (query, export dal browser, uso nel gioco).
* `docs/osm-dati.md`: dati OSM oltre le vie (svolte vietate, linee, parcheggi, uso del suolo, arredo), campi che la
  mappa ne porta per nodo e per arco (`svolte`, `sosta`, `rilevati`, `pendenze`, `fondo`), quanto copre OSM e controlli.
* `docs/raccordi.md`: raccordi di corsia agli incroci calcolati nella build (`scripts/raccordi.py`): da quale corsia a
  quale corsia, curva, raggio e classi di mezzo (auto, bus da 12 m, snodato), formato del campo `raccordi` della
  mappa, controlli contro la pianta delle strade e casi noti (`data/eccezioni/raccordi.json`). Auto e bus automatici li
  seguono con l'inseguitore di percorso (`src/world/inseguitore.js`, sezione 7): l'asse posteriore sul percorso, la
  direzione è la tangente, i ripieghi dove manca il raccordo sono dichiarati e contati.
* `docs/sosta.md`: sosta lungo le strade calcolata nella build (`scripts/sosta.py`): file di stalli per arco e per lato
  dai tag OSM, dalle aree OSM, dal DBGT e dalla larghezza della carreggiata, formato dei campi `stalli` e `sedeCorsie`
  della mappa, zone libere (incroci, fermate, passi carrai), controlli (`data/eccezioni/sosta.json`,
  `tests/sosta.spec.js`) e campione sulla foto aerea.
* `docs/percorsi.md`: percorsi delle linee guidabili da un bus (#114): la regola (niente salti, contromano, inversioni,
  svolte vietate ai bus; ogni svolta con un raccordo per il mezzo della linea), cosa fa la build (tag OSM corretti in
  `data/osm-correzioni.json`, aggancio per pezzi dove il tracciato esce dalla mappa, riparazione dei passaggi) e il
  controllo `scripts/percorsi.py`, che `build_map.py` lancia alla fine e che si ferma su un caso fuori da
  `data/eccezioni/percorsi.json`.
* `docs/domanda.md`: domanda di traffico (#116): viaggi con origine, destinazione e ora; la build
  (`scripts/domanda.py`, solo libreria standard) scrive in `src/data/padova-domanda.json` zone, porte, tempi,
  destinazioni per scopo, curva oraria feriale e festiva e l'assegnazione con la capacità per tre fasce; il gioco
  (`src/world/domanda.js`) sceglie i viaggi che passano nel disco attorno a chi guida, col raggio che tiene 72 auto.
  Verifica sul GTFS dei tempi tra punta e morbida in `scripts/gtfs_tempi.py`. Chi rigenera la mappa rifà il file
  (`python3 scripts/domanda.py`, in fondo a `rigenera_mappa.sh`; `verifica_mappa.py` controlla che sia quello che esce).
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

Rigenerare i dati della mappa (GTFS Busitalia + OSM + Overture + segnaletica e binari OSM). Serve Docker: il comando
gira su Linux con Python 3.12 e le librerie fissate in `scripts/requirements-mappa.txt` (`shapely`, `numpy`, `scipy`, `pyarrow`);
`CAVALCAVIA=registro` davanti al comando riscrive i campi di `data/cavalcavia.json` che vengono dalla rete:

```bash
scripts/rigenera_mappa.sh
scripts/rigenera_mappa.sh --controlla   # rigenera a parte e confronta col repository
scripts/rigenera_mappa.sh --localita    # prova della località: rigenera con i cambi di data/localita.json
python3 scripts/verifica_mappa.py --elenco   # rapporto di verifica: esce con errore se i casi non sono quelli degli elenchi
```

`scripts/rigenera_mappa.py` chiama `build_map.py` con i dati di `data/` e con il feed GTFS fissato in
`data/gtfs-biv.zip` (quello vivo cambia ogni giorno), e si ferma se sistema, Python o librerie non sono quelli fissati:
con uno shapely diverso la mappa esce diversa in un centinaio di aree, su macOS con lo stesso nei binari del tram e in
qualche raccordo. La mappa nel repository deve essere quella che questo comando produce, e il job `rigenera` di
`.github/workflows/verifiche.yml` lo controlla a ogni push: chi cambia uno script o un dato della mappa la rigenera e
la pubblica nello stesso commit. Come si cambiano le librerie, l'immagine o il feed è in testa a
`scripts/rigenera_mappa.py` e a `scripts/rigenera_mappa.sh`.
Alla fine la rigenerazione dice quante aree e celle della pianta sono cambiate e a che distanza dai dati cambiati
(`scripts/localita.py`): un cambiamento in un posto deve cambiare la mappa solo lì (#139).

`build_map.py` scrive la mappa in due parti (`scripts/aree_mappa.py`): la rete (nodi, archi, linee, fermate,
segnaletica, terreno, carreggiate e isole della pianta delle strade) in `src/data/padova-map.json`, dentro il bundle, ed
edifici, marciapiedi, verde e alberi in un file per riquadro da 800 m in `public/mappa/aree/`, che il gioco scarica
all'avvio (`src/data/aree.js`). Gli script che leggono la mappa intera usano `aree_mappa.load`. Con le aree scrive
`data/conto-aree.json`, quanti oggetti ci sono per tipo in ogni area: lo confrontano con la scena `tests/aree.spec.js`
e con i file delle aree `scripts/verifica_mappa.py` (si riscrive da solo con la mappa, o con
`python3 scripts/aree_mappa.py conta src/data/padova-map.json`).

Semafori e ripetitrici, tiranti e pali della linea aerea, lanterne del tram, segnali degli scambi, cartelli del
pantografo e paline li posa la build nello spazio libero (fuori da asfalto, sagoma del tram ed edifici) e il gioco li
legge da `src/data/padova-arredo.json` (`src/data/arredo.js`), senza cercare niente. Il posatore è
`src/world/posa.js`, fuori dal bundle; lo lancia `scripts/posa_arredo.mjs`, che costruisce la città in Node con i
moduli del gioco. Chi cambia mappa, binari o pianta delle strade rifà la posa nello stesso commit, dichiarando dove:

```bash
npm run posa                      # rifà la posa e dice quali elementi cambiano rispetto al file
npm run posa -- --zona X,Z,R      # riscrive il file se cambiano solo elementi entro R metri da (X, Z); ripetibile
npm run posa -- --tutta           # riscrive comunque (posatore cambiato, mappa rigenerata)
```

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
`scripts/overpass-tram.ql` filtrato con `scripts/filter_osm_tram.py`: i comandi sono nel README. `data/osm-padova-relazioni.json`
(svolte vietate e obbligate, percorsi delle linee), `data/osm-luoghi.json` e `data/osm-arredo.json` vengono da
`scripts/overpass-relazioni.ql`, `overpass-luoghi.ql` e `overpass-arredo.ql` con `scripts/filter_osm_relazioni.py` e
`filter_osm_luoghi.py`. `data/osm-padova.json` non si riscarica: i dati nuovi si agganciano alle sue vie per id
(`scripts/osm_rete.py`; `--scrivi` riscrive i soli campi OSM nella mappa che c'è, e la build dà gli stessi). La pianta delle strade
(carreggiate, marciapiedi, isole, edifici ritagliati) la calcola `scripts/street_surfaces.py`.

## Verifiche

* `npm test` lancia le prove di `tests/` (Playwright, dipendenza di sviluppo): build senza PostHog in una cartella
  temporanea, servita su una porta libera, Chromium con
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --mute-audio`. Si lancia prima di ogni push
  su `main`; il workflow `.github/workflows/verifiche.yml` la ripete in CI. Le prove nuove usano gli aiuti di
  `tests/gioco.js` (gioco aperto una volta per worker, avvio di una corsa dal menu, errori della pagina) e, per
  guidare, il pilota di `tests/guida.js`.
* **Stesso gioco, stesso esito.** Una corsa avviata con `avviaCorsa` parte sempre dallo stesso stato: sereno
  (parametro `meteo`), e `startMission` rimette semafori, segnali del tram e sequenze casuali di auto e bus automatici
  com'erano alla prima corsa, qualunque prova abbia usato la pagina prima. Una prova nuova non dipende da
  `Math.random`, dall'ordine delle prove o dal tempo vero. Le funzioni del gioco che una prova sostituisce per guardarlo
  le rimette il fixture `pagina` a fine prova (#145). `tests/impronta.spec.js` confronta lo stato del traffico di una
  corsa, ai bit, con quello di `tests/impronta.json`, uguale su Mac e in CI: chi cambia traffico, bus o tram
  automatici, mappa o linee lo riscrive nello stesso commit (`IMPRONTA=aggiorna npx playwright test
  tests/impronta.spec.js`). Le prove da più di un minuto in CI hanno
  `tempoMassimo(secondi)` di `tests/gioco.js`, tre volte la durata più lunga vista in CI; i limiti di merito non si
  allargano per il tempo (nota "Verifiche: stato di partenza e tempi delle prove" in `docs/LAVORO.md`).
* Rapporto di verifica sulla mappa: `python3 scripts/verifica_mappa.py` sul JSON (dopo ogni rigenerazione) e
  `tests/mappa.spec.js` nel gioco.
* **Soglie per caso, non per conteggio.** Ogni controllo dà ai suoi casi una chiave stabile (struttura, linea e
  fermata, posto) e li confronta con l'elenco dei casi noti in `data/eccezioni/` (`scripts/eccezioni.py`), in gruppi
  con il perché: `verifica-mappa.json`, `osm-rete.json` (`scripts/osm_rete.py`, svolte di OSM), `cavalcavia.json`
  (`scripts/cavalcavia.py`, anche da `tests/cavalcavia.spec.js`), `mappa-gioco.json` (`tests/mappa.spec.js`),
  `traffico.json` (`tests/traffico.spec.js`), `raccordi.json` (`scripts/raccordi.py`), `sosta.json`
  (`scripts/sosta.py`), `sosta-gioco.json` (`tests/sosta.spec.js`), `percorsi.json` (`scripts/percorsi.py`,
  anche alla fine della build), `moto.json` (`tests/moto.spec.js`) e `localita.json` (job `localita`,
  `scripts/rigenera_mappa.py --localita`). Un caso fuori dall'elenco fa fallire il controllo anche se il totale non
  sale; un caso sparito va tolto dall'elenco nello stesso commit. Dopo una correzione l'elenco si riscrive con
  `--aggiorna` (script) o `ECCEZIONI=aggiorna npx playwright test tests/<prova>.spec.js`: i casi nuovi finiscono in un
  gruppo con il perché vuoto, che va scritto. Un controllo nuovo nasce così, non con un conteggio.
* **Moto dei mezzi.** `tests/moto.spec.js` guarda auto e bus automatici per 10 minuti in tre zone (regole in
  `tests/moto.js`): a zero i casi di traverso, i salti, l'imbardata oltre v / raggio minimo e le inversioni sullo stesso
  arco, con i casi noti in `data/eccezioni/moto.json`. Dove il mezzo è su un ripiego dell'inseguitore la chiave lo dice
  tra parentesi: quei casi spariscono quando #134 e #114 danno alle svolte il loro raccordo.
* **Punte del traffico (#116).** `tests/domanda.spec.js` misura con auto sonda il tempo su tre corridoi (Via Sorio,
  Via Facciolati, Via Ariosto e Via Gattamelata) alle 8, alle 11, alle 18 e alle 22 di un feriale: la media dei
  rapporti tra punta e morbida deve superare 1,08. È una misura aggregata con un margine, non un elenco di casi: gli
  intrecci esatti del traffico cambiano tra Mac e Linux (#145).
* **Mappa locale (#139).** Cambiato un dato in un punto, la mappa cambia solo vicino: la pianta si unisce per zone e
  si semplifica per riquadro (`unione` e `semplifica_riquadro` in `scripts/street_surfaces.py`), e alberi e case di
  contorno del gioco prendono i numeri casuali dal loro posto (`rngAt` di `src/world/spatial.js`). La prova è il job
  `localita` di `verifiche.yml`: rigenera con i cambi di `data/localita.json` e fallisce se oltre il raggio dichiarato
  cambia qualcosa (pianta, aree, stalli, raccordi, terreno, posa) che non sta in `data/eccezioni/localita.json`. Chi
  scrive un passo della build che lavora su tutta la città lo fa con le stesse regole (nota #139 della Mappa in
  `docs/LAVORO.md`).
* **Profili dei cavalcavia dichiarati.** `data/profili-cavalcavia.json` ha la quota lungo archi e binari di ogni
  struttura; `tests/profili.spec.js` fallisce se la mappa ne ha altri. Chi cambia di proposito le quote di una
  struttura lancia `python3 scripts/profili_strutture.py --aggiorna` nello stesso commit e la nomina nel messaggio.
* **Arredo posato dichiarato.** `tests/arredo.spec.js` rifà la posa e fallisce se non è quella di
  `src/data/padova-arredo.json`, poi controlla che il gioco abbia letto tutto il file e che i suoi pali stiano lì. I
  pali nella sagoma del tram, in carreggiata, nell'ingombro dei bus e i semafori senza lanterna visibile dalla linea
  d'arresto sono casi di `tests/mappa.spec.js` (`tests/pali.js`), con le eccezioni in `data/eccezioni/mappa-gioco.json`.
* **Niente nomi di luoghi nel codice degli algoritmi.** Una correzione che vale per un solo luogo è una riga in un
  file di dati in `data/` (zona, valore, perché) che l'algoritmo legge, non un ramo nel codice con una via o delle
  coordinate.
* Vedute di riferimento: `tests/vedute.spec.js` confronta le immagini da 43 punti fissi (`tests/vedute/elenco.json`:
  cavalcavia, ponti, capolinea del tram, rotonde e incroci con la sede) con quelle di `tests/vedute/riferimenti/`. Chi
  cambia una veduta di proposito aggiorna il riferimento nello stesso commit
  (`npx playwright test vedute.spec --update-snapshots`, dopo aver guardato le differenze in `test-results/`); i
  dettagli sono in `docs/LAVORO.md`, nota "Verifiche: vedute di riferimento".
* Elementi che spariscono (#110): `tests/volumi.spec.js` controlla che ogni oggetto del mondo stia nel volume col
  terreno che usa il culling (`terrainVolume` in `src/world/terrain.js`, il solo punto che lo calcola);
  `tests/strati.spec.js` guarda gli strati sullo stesso piano (`layer()` in `src/world/city.js`) da 20 m e da 300 m nei
  punti delle vedute, con i casi noti in `data/eccezioni/strati.json`; `tests/aree.spec.js` confronta la scena con il
  conto per area della build. Dettagli in `docs/LAVORO.md`, nota #110 della Mappa.
* `window.__game` espone lo stato per i test, tra cui `startMission()`, `sim(sec, dt, draw)`, `press(code)`, `keys`,
  `setCam(n)`, `teleport(x, z)`, `settings`, `lines`, `wx`, `city`, `net`, `edgeHeight(e, s)`. Disattiva il loop con
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
