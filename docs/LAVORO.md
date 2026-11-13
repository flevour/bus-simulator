# Lavoro in parallelo

Il lavoro da fare sta nelle [issue di GitHub](https://github.com/flevour/bus-simulator/issues), con il metodo in
[`docs/agents/issue-tracker.md`](agents/issue-tracker.md). Ogni ticket preso in carico ha il suo worktree herdr, con
un ramo locale e una sessione sua. Quando il ticket è pubblicato su `main` e l'issue è chiusa, il worktree si toglie.
Le corsie, worktree per area che duravano giorni, non ci sono più dal 12 novembre 2026: le loro note sono in fondo,
divise per area.

## Regole

1. **Un worktree per ticket.** Lo apre il checkout principale, che sceglie quali ticket far partire:
   ```bash
   herdr worktree create --cwd ~/Sites/flevour/bus-simulator --branch ticket/<n>-<nome> --base origin/main --label "#<n> <nome>" --no-focus
   herdr agent start t<n> --kind claude --pane <pannello del worktree> -- --permission-mode auto
   ```
   `<n>` è il numero dell'issue, `<nome>` due o tre parole col trattino (`ticket/46-incroci-curva`). Il worktree sta
   in `~/.herdr/worktrees/bus-simulator/ticket-<n>-<nome>`. La sessione che parte lì prende il ticket (assegnazione e
   commento "Preso nel worktree `ticket/<n>-<nome>`.") e fa `npm install`. Niente rami remoti né pull request.
2. Prima di ogni commit `git status -sb`; commit con `~/.claude/custom-bins/committer "messaggio" file...`.
3. Per pubblicare:
   ```bash
   git fetch origin && GIT_EDITOR=: git rebase origin/main
   npm run build && npm test
   git push origin HEAD:main
   ```
   `npm test` compila il gioco senza PostHog in una cartella temporanea, lo serve su una porta libera e lancia le
   prove di Playwright in `tests/`. Sulla stessa macchina girano al più due serie di prove alla volta, anche lanciate
   con `-g` (`tests/posto.js`, posti in `/tmp/bus-simulator-prove`): le altre aspettano il loro turno, e una serie
   interrotta libera il posto da sola. La prima volta (o quando il rebase porta una versione nuova di Playwright):
   `npx playwright install --only-shell chromium`. Chi rigenera la mappa lancia anche
   `python3 scripts/verifica_mappa.py --elenco` (venv con `shapely`). Il rapporto della mappa (`tests/mappa.spec.js` e
   lo script) confronta i casi uno per uno con gli elenchi di `data/eccezioni/` (regola 12). Lo stesso controllo gira
   in CI (workflow Verifiche) a ogni push su `main`, e il gioco va su GitHub Pages solo se finisce verde (nota
   Verifiche, in fondo): dopo il push si guarda `gh run list --workflow verifiche.yml --limit 3` e, se la serie è
   rossa, la si ripara subito. Tra le prove ci sono le vedute di riferimento
   (`tests/vedute.spec.js`): chi cambia di proposito quello che si vede da uno dei punti aggiorna l'immagine nello
   stesso commit (nota "Verifiche: vedute di riferimento").
4. Conflitti nel rebase:
   - `src/data/novita.js` e `IDEE.md`: si tengono le righe di tutti; in `novita.js` la riga nuova va in cima con
     `n` successivo all'ultimo di `main`;
   - `src/data/padova-map.json` e `public/mappa/aree/` (nei ticket che rigenerano la mappa): si prende la mappa di
     `main` (rete e aree) e si rigenera.
5. Ogni worktree ha il suo `node_modules` (`npm install`): la cache di Vite sta in `node_modules/.vite` e due server
   che la condividono si pestano i piedi.
6. Porte dal numero dell'issue: dev `5200 + n`, preview `4200 + n` (ticket #46: 5246 e 4246); il checkout principale
   usa 5173 e 4173. Nel worktree non c'è `.env` e non va creato: le chiavi di PostHog si passano sulla riga di comando.
   In dev `src/posthog.js` si ferma se mancano, quindi valori finti; nel build vuote, così le prove non mandano eventi:
   ```bash
   VITE_POSTHOG_KEY=prova VITE_POSTHOG_HOST=http://localhost:9 npm run dev -- --port <dev> --strictPort
   VITE_POSTHOG_KEY= VITE_POSTHOG_HOST= npm run build && npx vite preview --port <preview>
   ```
7. Dopo modifiche a strade, fermate o edifici: percorsi dei bus liberi e fermate raggiungibili (vedi `CLAUDE.md`).
8. Un ticket per worktree e per sessione. Il commit che lo finisce ha in fondo `Closes #<n>`. Le cose trovate per
   strada diventano issue nuove. La sezione "Fatto" di `IDEE.md` non si aggiorna più.
9. A ticket finito la sessione scrive nell'issue quello che serve a chi viene dopo e si ferma. Il checkout principale
   controlla che il ramo sia tutto su `main` (`git log origin/main..ticket/<n>-<nome>` vuoto), poi toglie il worktree
   (`herdr worktree remove --workspace <id>`) e il ramo locale (`git branch -d ticket/<n>-<nome>`). Se ci sono commit
   non pubblicati, il worktree resta.
10. I ticket in parallelo li sceglie il checkout principale: non partono insieme due ticket che rigenerano la mappa o
    che cambiano le stesse funzioni (tabella sotto e "Riferimenti" del ticket). Chi cambia una funzione di un'altra
    area lo scrive nella nota di quell'area, qui in fondo, e nel commento di chiusura del ticket.
11. **Browser senza suoni e senza finestre.** Prove e script aprono il gioco headless, con `--mute-audio`; il server
    di Playwright MCP e i browser visibili non si usano per il gioco. Il gioco tace da solo nei browser guidati da un
    programma (`navigator.webdriver`) e con `?muto` nell'indirizzo: suoni e annunci a voce, che su macOS passano dalla
    sintesi vocale del sistema anche con `--mute-audio`, darebbero fastidio a chi lavora al computer.
    Anche gli script propri che aprono il gioco prendono uno dei due posti della macchina, come le serie di prove:
    `const libera = await prendiPosto()` da `tests/posto.js` del worktree (import per percorso assoluto), poi
    `libera()` alla fine; al più tre browser per posto, niente corse in parallelo oltre quelle.
12. **Soglie per caso, non per conteggio.** Un conteggio lascia passare un difetto che si sposta da un luogo a un altro,
    e si può alzare. Ogni controllo dà ai suoi casi una chiave stabile (struttura, linea e fermata, posto) e i casi
    noti stanno in `data/eccezioni/`, in gruppi con il perché (`scripts/eccezioni.py`, nota dell'area Verifiche). Un
    caso fuori dall'elenco fa fallire il controllo anche a totale uguale; un caso sparito va tolto dall'elenco nello
    stesso commit; un caso nuovo che deve restare entra in un gruppo con il perché, e lo si scrive anche nel commit.
13. **Niente nomi di luoghi nel codice degli algoritmi.** Una correzione che vale per un solo luogo è una riga in un
    file di dati in `data/` (zona, valore, perché) che l'algoritmo legge, non un ramo nel codice con una via o delle
    coordinate: così chi cambia l'algoritmo vede tutte le correzioni insieme e può toglierle quando non servono più.

## File condivisi

| File | Chi ci lavora | Perché |
|---|---|---|
| `src/data/padova-map.json`, `public/mappa/aree/` | i ticket che rigenerano la mappa, uno alla volta | la rete (una riga sola da 5,9 MB) e le aree da 800 m (edifici, marciapiedi, verde, alberi) le scrive `build_map.py`: due rigenerazioni non si uniscono, si prende la mappa di `main` e si rigenera (regola 4) |
| `scripts/build_map.py`, `scripts/street_surfaces.py` | `area:mappa` (dettagli dentro l'area) e `area:linee` (estensione dell'area) | producono la mappa; chi ha bisogno di dati nuovi li scrive in un file a parte |
| `scripts/tram_linee.py`, `scripts/tram_depositi.py`, `data/tram-linee-nuove.json`, `data/tram-depositi.json` | `area:tram` e `area:linee` (SIR2 fino ai capolinea) | dopo, si rigenera la mappa (la sede nella pianta delle strade segue i binari) |
| `src/world/city.js` | tutte le aree, ognuna nelle sue funzioni | edifici, marciapiedi, verde e alberi arrivano per aree (`src/data/aree.js`); chi cambia la geometria misura prima e dopo `city.timings` e i triangoli |
| `src/world/traffic.js` | `Traffic`, `Walkers`, `TrafficLights`, `TramSignals` e in `TramSim` chi il tram aspetta (`others`, `busT`) ad `area:traffico`, il resto di `TramSim` ad `area:tram` | due ticket in parallelo sulle stesse classi danno conflitti |
| `src/world/buses.js` | `area:traffico` (bus automatici) | `buildLane` e `ahead` (uscita dal binario opposto) vengono da `area:mappa`: chi li cambia lo scrive nella nota |
| `src/bus/bus.js` | `area:veicoli`, le altre aree nelle loro funzioni | |
| `src/main.js` | tutte le aree, ognuna nelle sue funzioni | |
| `src/tram/tram.js` | `area:tram` | scambi, binari, depositi, cambio cabina e turni: le funzioni sono nelle note del tram qui sotto |
| `scripts/binari_tram.py`, `scripts/binari_regola.py`, `scripts/tram_stesura.py`, `tests/binari-tram.spec.js`, `SOGLIE_BINARI` in `scripts/verifica_mappa.py` | `area:tram` (#69 le linee, #70 i depositi) | regola, stesura e controllo dei binari del tram ([`binari-tram.md`](binari-tram.md)): `binari_regola.py` rifà le linee, `tram_stesura.py` i depositi; chi rifà i binari abbassa le soglie della sua linea o del suo deposito e aggiunge le eccezioni con il perché |
| `data/cavalcavia.json`, `scripts/profilo_cavalcavia.py` | `area:mappa` (#123, #124, #125) | registro delle strutture e risolutore del profilo ([`cavalcavia.md`](cavalcavia.md), sezione 6): le correzioni per luogo sono righe del registro con il perché; chi attiva una struttura rigenera e aggiorna vedute ed eccezioni |
| `scripts/cavalcavia.py`, `tests/cavalcavia.spec.js`, `data/eccezioni/cavalcavia.json` | `area:mappa` (#84 i cavalcavia), `area:tram` (#74 le rampe del tram) | regola e controllo del profilo dei cavalcavia ([`cavalcavia.md`](cavalcavia.md)): chi cambia quote, terreno o quote dei binari toglie dall'elenco i casi corretti (`--aggiorna`); usa `binari_tram.Griglia` e `raggruppa` |
| `data/eccezioni/*.json`, `scripts/eccezioni.py` | tutte le aree, ognuna nei suoi casi | casi noti dei controlli, una riga per caso (regola 12): chi corregge un caso toglie la sua riga; in un rebase si tengono le righe tolte da tutti e si rilancia il controllo |

## Note per area

Le hanno scritte le corsie fino al 12 novembre: i nomi delle corsie dicono chi ha fatto cosa. Ogni ticket aggiunge
alla nota della sua area quello che serve sapere prima di toccarne il codice (file, funzioni, trappole) e cosa ha
cambiato nelle funzioni delle altre aree.

### Verifiche (corsia `verifiche`, chiusa il 9 novembre)

Chiusa il 9 novembre 2026. Cosa c'è (dettagli nel README, sezione "Verifiche"):

- `npm test` (Playwright, dipendenza di sviluppo): il gioco si carica e una corsa del bus e una del tram avanzano
  senza errori (`tests/avvio.spec.js`); giro guidato fino alle fermate successive sulle linee 24, 10 (snodato), 3,
  14 e sul SIR1 nei due versi, con un pilota scritto nella prova (`tests/guida.js`), senza traffico
  (`tests/giro.spec.js`); rapporto di verifica sulla mappa nel gioco (`tests/mappa.spec.js`). Ogni worker apre il
  gioco una volta; in tutto circa 2 minuti.
- `scripts/verifica_mappa.py`: rapporto sul JSON della mappa, in pochi secondi.
- `.github/workflows/verifiche.yml`: build, `npm test` e lo script a ogni push su `main`, con i rapporti come
  artefatti.
- Pubblicazione dopo le verifiche (#103, 13 novembre): `pages.yml` non parte più dal push ma dalla fine di
  `verifiche.yml` su `main` (`workflow_run`), e pubblica il commit verificato solo se la serie è finita verde. Se è
  rossa o annullata l'esecuzione di Pages compare come saltata e il sito resta all'ultimo commit verde. Le verifiche
  girano una serie alla volta e quella in corso non si annulla più: i push arrivati nel frattempo aspettano in un posto
  solo, dove resta l'ultimo (gli altri risultano annullati senza essere partiti, e i loro commit sono dentro la serie
  dopo). Una serie dura da 15 a 27 minuti, quindi un commit arriva a chi gioca tra 20 minuti e un'ora dopo il push. Una
  prova rossa ferma la pubblicazione di tutti finché un push non la ripara. Per un'emergenza `gh workflow run pages.yml`
  pubblica la testa di `main` senza aspettare. `workflow_run` usa il file del workflow che sta su `main`: una modifica a
  `pages.yml` vale dalla serie di verifiche successiva al push che la porta.
- Se si riapre: pilota più bravo nelle svolte a T e in quelle strette (sbaglia sulle linee 9 e 21) per allargare il
  giro guidato a tutte le linee; casi di prova dalle segnalazioni di chi gioca.

Soglie per caso (#105, 13 novembre). Da sapere:

- `scripts/eccezioni.py` (solo libreria standard) confronta i casi di un controllo con il suo elenco in
  `data/eccezioni/`: `Elenco(nome).confronta(controllo, chiavi, toll)` dà i casi nuovi, quelli spariti e quelli senza
  il perché, `confronta_misura` fa lo stesso per i numeri per luogo, `errori()` le righe da stampare. La chiave è
  `parte fissa @ x,z`: un caso resta lo stesso se ha la stessa parte fissa e si sposta fino a `toll` metri (4 i
  cavalcavia, 3 lo script della mappa, 2 la prova nel gioco). Il meccanismo ha la sua prova, `tests/eccezioni.spec.js`,
  che non apre il gioco;
- gli elenchi: `verifica-mappa.json` (edifici in carreggiata, con "lungo i percorsi dei bus" nella parte fissa; fermate
  lontane e spostate; marciapiede stretto in m² per riquadro da 800 m, con 20 m² di tolleranza), `cavalcavia.json`
  (`strade`, uguali nei dati e nel gioco; `binari dati`; `binari gioco`), `mappa-gioco.json` (i 14 controlli di
  `tests/mappa.spec.js`). I controlli a zero hanno l'elenco vuoto;
- per riscriverli: `python3 scripts/verifica_mappa.py --aggiorna` (i suoi casi e i cavalcavia nei dati),
  `python3 scripts/cavalcavia.py --aggiorna` (solo i cavalcavia nei dati, senza shapely),
  `ECCEZIONI=aggiorna npx playwright test tests/cavalcavia.spec.js tests/mappa.spec.js` (il gioco). Toglie gli spariti e
  mette i nuovi in un gruppo con il perché vuoto: finché non lo si scrive, o non si spostano i casi nel gruppo giusto,
  il controllo non passa;
- i binari del tram (`SOGLIE_BINARI`, `tests/binari-tram.spec.js`) e `tests/linea-aerea.spec.js` hanno soglie a zero,
  con le zone di eccezione in `binari_tram.py`; resta a conteggio la pendenza dei binari nel gioco (#120);
- i casi di partenza sono quelli del 13 novembre, uguali sul Mac e in CI (shapely 2.2.0, GEOS 3.14.1). Un'altra versione
  di shapely può spostare di qualche metro quadro il marciapiede stretto di un riquadro: la tolleranza serve a questo.

### Verifiche: vedute di riferimento (#104, 13 novembre)

`tests/vedute.spec.js` fotografa il gioco da 43 punti fissi, a 2,5 m dal piano della strada, e confronta ogni immagine
con quella di `tests/vedute/riferimenti/` (640 x 360, una per veduta). I punti sono in `tests/vedute/elenco.json`:
nome, `x`, `z`, `verso` in gradi (0 verso +z, 90 verso +x, come la direzione del bus) e perché la veduta è lì
(cavalcavia, ponti, capolinea del tram, rotonde e incroci con la sede). Da sapere:

- la scena la prepara `preparaVedute` di `tests/vedute.js`: esplorazione sulla 24, sereno, luce delle 11
  (`settings.lightHour`), tutta la mappa caricata e costruita, niente pedoni, acqua dei canali ferma, il mezzo
  nascosto, i semafori rimessi tutti allo stesso ciclo: ogni tram che passa sposta per sempre il ciclo del suo incrocio
  (`TrafficLights.tramCall`), e senza questo le lanterne dipendono dalle prove che hanno usato la pagina prima. La
  telecamera libera è `__game.veduta` (in `updateCamera` di `src/main.js`); `__game.walkers` dà i pedoni;
- una veduta cambiata fa fallire la prova, e in `test-results/vedute-vedute-di-riferimento/` restano, per ognuna,
  l'immagine nuova (`-actual`), il riferimento (`-expected`) e le differenze (`-diff`); in CI stanno nell'artefatto
  `risultati-prove`. Prima si guardano: se il cambiamento è quello voluto, i riferimenti si aggiornano nello stesso
  commit con `npx playwright test vedute.spec --update-snapshots`, che riscrive solo le immagini cambiate; `git status`
  dice quali, e vanno nominate nel messaggio di commit. Una veduta cambiata lontano dalla zona toccata è un difetto da
  capire prima di aggiornare qualsiasi cosa;
- il filtro è `vedute.spec` e non `vedute`: Playwright lo confronta col percorso intero, e in un worktree che ha
  "vedute" nel nome partirebbero tutte le prove;
- tolleranza (`TOLLERANZA` nella prova): sulla stessa macchina due lanci danno immagini identiche; tra macOS e Linux
  i colori cambiano di qualche unità su molti pixel, fili e bordi sottili cadono su pixel vicini e i cartelli col testo
  usano un altro font, quindi un pixel conta oltre la soglia 0,2 di pixelmatch e se ne ammettono 40 (con i riferimenti
  del Mac la veduta peggiore su Linux amd64 ne ha 4; un cavalcavia alzato di 0,5 m ne cambia più di 600, una lanterna
  del tram rimessa in carreggiata 1900). I riferimenti si possono fare sul Mac e valgono in CI;
- per aggiungere una veduta: una riga nell'elenco, poi lo stesso comando, che scrive l'immagine che manca. Il punto va
  sulla corsia o sul binario, a qualche decina di metri da quello che si vuole inquadrare;
- le vedute fissano anche i difetti di oggi (in cima al Cavalcavia San Marco l'asfalto copre la sede del tram, #85):
  chi li corregge aggiorna il riferimento;
- cambiano tutte le vedute insieme se cambiano luce, cielo, nebbia, colori dei materiali o l'altezza della telecamera:
  in quel caso si rifanno tutti i riferimenti in un commit a parte.

### Mappa (corsia `mappa`)

Issue: `area:mappa`.

Rigenera la mappa (venv con `shapely` e `pyarrow`, comandi in `CLAUDE.md`), una rigenerazione alla volta con le altre
corsie della tabella dei file condivisi. File: `scripts/build_map.py` (i dettagli dentro l'area; la definizione
dell'area è di `capolinea`), `scripts/street_surfaces.py`, le query e i filtri OSM (`scripts/overpass-*.ql`,
`scripts/filter_osm_*.py`), la parte delle strade di `src/world/city.js`, `src/data/padova.js`,
`src/data/padova-map.json`.

Da sapere prima di toccare questi file:

- gli elenchi completi del rapporto della mappa: `python3 scripts/verifica_mappa.py --elenco`, e
  `test-results/*/rapporto-mappa.json` dopo `npm test`;
- corsie e segnaletica orizzontale vengono dai tag OSM già nell'export (`lanes` su ~5.400 vie, `lanes:forward/backward`,
  `overtaking`, `turn:lanes`, `lanes:psv`/`bus:lanes`): numero di corsie e divisorie sulla carreggiata misurata,
  mezzeria continua con `overtaking=no`, frecce a terra, corsie dei bus gialle con la scritta BUS. Nella rete `lanes`,
  `turnLanes` e `calming` (dossi). I dati delle svolte (`turnLanes`) sono di `mappa`, le fasi dei semafori
  (`TrafficLights`) di `traffico`;
- strumenti di `build_map.py` per i bordi dell'area e i percorsi: `FOCUS_BORDI`, `cut_path`, `no_uturns`,
  `gtfs_cover`. `drop_spurs` toglie già nei dati i tratti A-B-A senza fermata, `buildRoute` (`src/game/routes.js`)
  quelli rimasti, in gioco;
- `match()` collega i pezzi di un tracciato GTFS con il cammino minimo nella rete: dove manca una via fa un giro lungo
  (la 22 verso Mandria girava per 5 km prima che l'area si allargasse). Quando il tracciato esce dall'area e rientra,
  meglio un salto o il taglio "tratto in città" che un giro;
- piazzale della stazione (controllo linea per linea in [`piazzale-stazione.md`](piazzale-stazione.md)), sistemato il
  9 novembre dalla sessione cloud sul checkout principale: banchine dei bus di OSM (`highway=platform`, in
  `data/osm-fermate.json` → `banchine`, da `scripts/osm_stops.py`) nella pianta delle strade
  (`street_surfaces.surfaces(..., platforms)`) al posto delle isole del DBGT; corsie a senso unico tra le banchine
  ristrette (una corsia, anche nei codici di `lanes`); paline per nome in `snap_stops_to_osm`, senza parole in comune
  solo entro 15 m; fermate a meno di 6 m da una banchina portate sopra (`onto_platforms`); contromano 6 volte la strada
  nell'aggancio, tranne le corsie bus in controsenso (`bus_both_ways`, flag 256, letto anche dal gioco in `busCan`);
  `terminal_lane` per i capolinea lontani dal percorso o raggiunti contromano, `stop_lanes` per le fermate in mezzo al
  percorso. Le banchine vere di OSM sono una fonte migliore dell'area 47586895 usata come banchina in una prima
  versione, lasciata cadere;
- sede del tram nella pianta delle strade: i binari di `data/tram-linee-nuove.json` entrano in
  `street_surfaces.surfaces` come quelli del SIR1, e la sede di tutte le linee è asfalto, fuori da isole e marciapiedi.
  Nei cavalcavia il terrapieno non si conta due volte (`adjust_heights` in `terrain_for_game`) e il binario non va mai
  sotto la strada che segue (`TramTrack.setHeights` in `tram.js`); l'asfalto in quota è suddiviso ogni 20 m in
  `buildRoads`. In `tests/mappa.spec.js` `segni_sulla_sede` e `asfalto_sopra_sede` sono a 0;
- `buildDecks` costruisce gli impalcati in 0,1 s (erano 17 s all'avvio, segnalati da `capolinea`);
- profilo dei cavalcavia (#83, 12 novembre): regola, fonti e cavalcavia peggiori in [`cavalcavia.md`](cavalcavia.md).
  Il controllo è `scripts/cavalcavia.py` (Python senza shapely né numpy), sui dati in `verifica_mappa.py`
  (`SOGLIE_CAVALCAVIA`) e sul gioco in `tests/cavalcavia.spec.js`. Ricostruisce il terreno "via" come
  `src/world/terrain.js` (chiusura e ponti) solo nelle celle dei profili: chi cambia la variante "via" nel gioco la
  cambia anche in `Via` dello script (la prova del gioco gli passa `Terrain.d`, e strade uguali tra dati e gioco dicono
  che coincidono). La quota dei binari nei dati è quella della strada che affiancano, nel gioco `TramTrack.h`: la prova
  legge `paths`, `h` e `stopsDir` di `TramTrack`. `--profilo X Z` stampa i profili che passano da un punto.

#84, profilo dei cavalcavia dal registro (13 novembre). Da sapere:

- le quote dei cavalcavia hanno due strade: le strutture con `profilo` vero in `data/cavalcavia.json` le calcola
  `scripts/profilo_cavalcavia.py` (programma lineare, `numpy` e `scipy` nel venv), le altre `overpass_heights` con il
  terreno spianato sotto, come prima. Regola, registro e formato nella mappa in [`cavalcavia.md`](cavalcavia.md),
  sezione 6;
- `build_map.py` si ferma se le strutture della rete non sono quelle del registro (`CAVALCAVIA=registro` lo riscrive
  tenendo i campi a mano), se una rampa con le quote di prima entra in una struttura attiva o le passa a meno di 120 m;
- `street_surfaces.py`: `quote_arco` e `quota_arco` danno la quota lungo un arco (profilo, zero per gli altri archi
  delle strutture attive, lineare tra i nodi per il resto); le usano `surfaces`, `decks` e `_tram_heights`.
  `overpass_heights` salta gli archi delle strutture attive, `terrain_for_game` non spiana sotto di loro;
- nel gioco: `edgeHeight` legge `e.hs` (da `MAP.edgeH`), `e.decl` segna gli archi delle strutture attive,
  `Terrain` applica `terrain.via`. Fuori dalla mia area: in `tram.js` `setHeights(fn, esatta)` non fa la media né
  applica la soglia di 0,25 m dove la quota viene da una struttura attiva (`city.nearProfile`). Oggi i casi dei
  binari sono quelli di prima (le strutture col tram sono spente): serve a #123;
- le rampe delle strutture attive sono archi a terra su un rilevato del terreno: hanno marciapiedi, strisce e fermate
  come le altre strade. Restano in quota le campate e gli ultimi 40 m prima;
- la mappa pubblicata è quella di `main` con, dalla rigenerazione, `nodeH`, `edgeH`, `cavalcavia`, `terrain`,
  impalcati e asfalto in quota, e le celle da 200 m entro 200 m dalle strutture attive (147 celle della rete, 25
  aree). #106 dirà se sostituirla tutta;
- gli alberi sparsi del gioco cambiano posto in tutta la mappa quando cambia il numero degli archi in quota: le vedute
  lontane dai cavalcavia cambiano di qualche decina di pixel.

Fatto il 9 e l'11 novembre: corsie e segnaletica dai tag OSM, fermate del tram sui nodi `tram_stop`, dossi e
attraversamenti rialzati, area ai bordi e linee tagliate, inversioni a U, corsie di servizio dei capolinea, lampioni
fuori dall'asfalto vero (`buildTreesAndLamps` con `surfaceOff`), sede di SIR2 e SIR3, rotonde attraversate dal tram,
cavalcavia di Chiesanuova e del Borgomagno (dettagli in IDEE, "Fatto").

Fuori dai miei file, piccoli e segnalati: in `traffic.js` le auto stanno nella corsia più a destra sulle vie con le
corsie in OSM (`Traffic.laneGeom`, con `driveOffset` di `padova.js`) e le linee d'arresto dei semafori partono dalla
riga che separa i versi (`TrafficLights.placeApproach`); in `main.js` e `mission.js` lo scossone e il comfort sui
dossi (`bumpHit`); le soglie di `scripts/verifica_mappa.py` e `tests/mappa.spec.js`; in `buses.js` (`buildLane` e
`ahead`) i bus automatici lasciano il binario del verso opposto prima di tutto (o vanno su quello del loro verso se la
carreggiata non basta: da 6.460 a 635 punti di corsia sopra un binario opposto, quasi tutti incroci obliqui) e si
fermano davanti a un tram che arriva (passavano come direzione dei pezzi del tram la loro quota); in `tram.js` la
media delle quote del binario non lo porta sotto la strada (`setHeights`); in `city.js` gli alberi dei viali e quelli
sparsi fuori dall'asfalto vero (`buildTreesAndLamps`); in `main.js` il terreno passato a `City` (`{ terrain }`, per
l'asfalto vicino alla sede del tram).

#73, paline e strisce pedonali (12 novembre). Da sapere prima di toccare `allStopPlacements` (`src/game/routes.js`):

- il bus fermo alla palina (`stopPose`: da 0,3 m prima della palina a 12,7 m dietro, lo snodato 18,5, `BUS_BACK` e
  `BUS_FRONT`) non copre le strisce disegnate (`e.cross`, che `City.buildRoads` mette prima di `buildStops`, in celle da
  20 m nella griglia `strisce`). `crossingsAt` dà, per una posa della palina, dove cominciano e finiscono le strisce
  lungo il bus, con il rettangolo vero delle strisce (anche quelle di un tratto girato prima della palina) e mezzo
  metro di margine;
- in `placeFor` lo spostamento minimo che libera le strisce viene prima dei vecchi passi di 4 m: in avanti se le
  strisce sono dietro la palina (Bembo Rotonda via Ponchia, 14,9 m), indietro se sono davanti (il bus si ferma prima),
  fino a 18 m perché `alignStops` la cerca entro 20 m. Questi spostamenti possono passare sul tratto vicino della
  variante (`pointOn` con `far`), ma solo attraverso i nodi con due archi, non gli incroci; i passi di 4 m restano nel
  tratto. Tra i passi di 4 m vengono prima quelli liberi, e da quelli che coprono le strisce si prova lo spostamento
  minimo (Roma 5 della 88: 10,2 m indietro invece di 12). I controlli si fanno solo per i candidati provati
  (`shifts` è un generatore): il piazzamento costa 207 ms invece di 175;
- la palina ha `zb` e `za`, dove finisce la segnaletica gialla dietro e davanti (`City.buildStops`), fino alle strisce
  vicine e non sopra;
- `ARTICULATED_LINES` sta in `routes.js` (lo importa `main.js`): la palina di una fermata servita dallo snodato tiene
  conto dei suoi 18 m;
- rapporto: `fermate_sulle_strisce` in `tests/mappa.spec.js` (stesso rettangolo del bus della posa, contro le strisce);
  da 205 (linea e palina) a 8, le fermate senza palina allineata (il bus sta lungo il percorso) e la partenza della 10
  dal Capolinea Ponte Brenta, dove il rimorchio, girato col cordolo, tocca le strisce di Via San Marco e `crossingsAt`,
  che non conosce ancora la pendenza del cordolo, non le vede.

#91, sorpresa alla DonQ (12 novembre), in `src/world/sorpresa.js`. In `City.addBuildings` l'edificio che contiene il
punto della foto (o il più vicino entro 15 m, `edificioSorpresa`) va in un riquadro suo, con chiave `'sorpresa'`, e
`buildTile` non mette i suoi muri tra gli ostacoli (`b.sorpresa`). `Sorpresa.update`, in `step` di `main.js` dopo
`streamTiles`, nasconde le mesh di quel riquadro quando il posto di guida è dentro: chi cambia come `streamTiles`
rimette visibili i riquadri o come si raggruppano gli edifici lo tenga presente. Prova in `tests/sorpresa.spec.js`.

#29, fermate dove il bus fermo tocca una facciata (12 novembre). Da sapere:

- i muri degli edifici della mappa (`City.buildTile`) sono riquadri di collisione spessi 0,6 m dalla facciata verso
  l'interno. Prima erano centrati sulla facciata e sporgevano 0,3 m in strada: dove la carreggiata del DBGT arriva fino
  all'edificio (i portici di Corso Milano a Milano 61, Tommaseo 114) la facciata sta sul cordolo, e il bus accostato a
  0,3 m urtava un muro che non si vede. Lo stesso riquadro lo usano l'urto del bus (`Bus.collide`), `clearBusRoads`, le
  case procedurali (`buildBuildings`) e `free` in `TrafficLights.placeApproach` (lanterne a muro): dove la facciata sta
  sul bordo dell'asfalto il palo del semaforo finiva dentro l'edificio e ora la lanterna va a muro (pali sul marciapiede
  da 552 a 550). I muri delle rimesse dei tram (`buildDepotShed`) restano centrati;
- `busLine` in `allStopPlacements`: se sotto il bus fermo la variante passa da un incrocio (`crossBehind`, un nodo con
  tre archi o più fino a 12,7 m dietro la palina, 18,5 con lo snodato), i punti del cordolo più lontani di
  `k + 1 + 0,2·|o|` sono la laterale e non entrano nella retta. A Buonarroti 46 erano metà dei punti, la mediana stava
  tra loro e il bus, girato di 11 gradi, finiva con il fondo nell'edificio d'angolo. Senza incrocio restano come prima:
  dietro la palina c'è un golfo di fermata (Saetta 1). Cambiano 6 paline su 689, tutte con la retta parallela all'asse;
- i giri guidati del 9 novembre: oggi nessuna linea passa da Via Curtatone e Montanara; la 13 da Boccaccio passa Via
  Sberti senza urti (prima toccava il muro sporgente in (2560, 640)), ma 75 m dopo, in Via Boccaccio (2632, 655), urta
  l'edificio con il muso 0,4 m fuori dalla corsia e resta bloccata prima della prima fermata. Non è una fermata (la
  palina è 185 m più avanti): è la guida del pilota (#77).

#81, frustum culling col terreno (12 novembre), in `src/world/terrain.js`. `renderer.render` di `main.js` alza la
telecamera della quota nel suo punto e il vertex shader alza la geometria, ma three.js scartava gli oggetti guardando le
bounding sphere senza quota: dalla cabina del tram alla Guizza (-1,1 m) lo schermo LCD non si disegnava, dal posto di
guida del bus, dove la quota è alta, quadro strumenti e volante. Ora `THREE.Frustum.prototype.intersectsObject`, col
terreno acceso (`K.value.z`, solo per la scena del mondo), alza la sfera della quota nel suo centro (variante "fondo"
per i materiali con `userData.terrainGround`) e la allarga di `min(span, raggio × slope)` più un gradino della quota
(`scale`): `slope` (pendenza massima tra celle vicine) e `span` (dislivello totale) li calcola il costruttore di
`Terrain`. Vale anche per le ombre e gli specchietti. Costa poco: alla Guizza circa 970 sfere per la vista e 720 per le
ombre, a 13 ns l'una per `at`. Da sapere:

- un oggetto della scena che il vertex shader non alza (uno `ShaderMaterial` senza `#include <project_vertex>`, come il
  cielo) viene provato come se fosse alzato: se è piccolo e vicino conviene `frustumCulled = false`;
- chi cambia lo spostamento nello shader (`PROJECT` e `terrainH`) cambia anche questa funzione;
- prova in `tests/schermo-cabina.spec.js` (con `onBeforeRender`, che three.js chiama solo per chi passa il culling).

### Linee (corsia `capolinea`)

Issue: `area:linee` (madre: #15 linee dei bus intere fino ai capolinea del GTFS).

Aperta il 9 novembre 2026. La mappa fino a tutti i capolinea, con le loro fermate. Piano: tappa 2 di
[`ESTENSIONE_LINEE.md`](ESTENSIONE_LINEE.md) e tappa 4 di [`linee-tram-nuove.md`](linee-tram-nuove.md). Inventario
dei capolinea e tabella "Varianti per linea" nella sezione 6 di `ESTENSIONE_LINEE.md`, aggiornata a ogni gruppo con
`scripts/inventario_capolinea.py <cartella_gtfs>`. Regola di chi gioca dell'11 novembre: quando la città si estende la
linea si allunga, ogni variante con la prima e l'ultima fermata del GTFS.

Come si lavora:

- area: corridoi attorno ai percorsi (celle da 250 m) e riquadri ai capolinea per anelli e piazzali, non rettangoli
  più grandi. Dati per le aree nuove: export Overpass di strade, nodi e tram, edifici Overture, DTM; il DBGT dove c'è
  (lotti "Padova Sud" ed "ETRA Padova"), altrimenti le misure della sezione 3 del
  [piano della città](PIANO_MODELLO_CITTA.md). Gli export nuovi in file a parte (per esempio `data/osm-corridoio.json`)
  finché non sostituiscono quelli di oggi;
- peso: con il caricamento per aree la mappa non ha più il limite dei 20 MB; a ogni gruppo si misurano la rete (nel
  bundle), le aree e l'avvio;
- verifiche a ogni gruppo: quelle della regola 3 con `scripts/verifica_mappa.py --elenco`, percorsi liberi e fermate
  raggiungibili nelle aree nuove, e il giro dal posto di guida ai capolinea nuovi (foto a 2,5 m da terra, una linea
  vera con il pilota di `tests/guida.js`).

Con la corsia `mappa`:

- in `build_map.py` `capolinea` tocca la definizione dell'area (`FOCUS`, `FOCUS_BORDI`, corridoi), i tagli delle linee
  e le funzioni nuove per le aree nuove; `mappa` i dettagli dentro l'area. Chi cambia una funzione dell'altra lo scrive
  qui;
- `padova-map.json` lo rigenerano tutte e due, una alla volta: prima di pubblicare rebase su `origin/main`, si prende
  la mappa di `main`, si rigenera e si rifanno le verifiche; se intanto l'altra corsia ha pubblicato, si ripete;
- la sede del tram nella pianta delle strade viene dai binari di `data/tram-linee-nuove.json`: i tratti nuovi la
  prendono da soli.

Fatto il 9 novembre (`067a747`; dettagli in [`ESTENSIONE_LINEE.md`](ESTENSIONE_LINEE.md), sezione 6): inventario e
SIR3 fino a Voltabarozzo con i due rami e il deposito. Funzioni nuove in `build_map.py`: corridoio di celle attorno ai
binari (`CORRIDOI_TRAM`, `corridor_cells`, `tram_corridors`, `in_focus`), edifici Overture del corridoio filtrati
sull'area, `gtfs_links` (vie fuori dall'area tra due vie dell'area dove passa un bus: Via Bembo per la 3, Via Volta per
la 24) e il taglio dei tornanti in testa e in coda in `cut_path`.

Funzioni della corsia `mappa` cambiate da `capolinea`: `stop_lanes` in `build_map.py` accetta anche i golfi di fermata
(strade di servizio a senso unico, palina fino a 5 m oltre il bordo o dentro il golfo, percorso attuale almeno 3 m più
lontano): cambia solo Piovese Park (4, 14, 16), le corsie della stazione restano come prima. Le soglie di
`verifica_mappa.py` e `tests/mappa.spec.js` (una palina in carreggiata: Piovese fr. Park, sotto il cavalcavia della
tangenziale).

Fatto l'11 novembre (dettagli in [`ESTENSIONE_LINEE.md`](ESTENSIONE_LINEE.md), sezioni 4 e 6):

- caricamento per aree (`c35636c`, `e76d0f3`, `82985e7`): la rete (nodi, archi, linee, segnaletica, terreno,
  carreggiate e isole, gli edifici a meno di 60 m dai binari) in `src/data/padova-map.json`, edifici, marciapiedi,
  verde e alberi in aree da 800 m in `public/mappa/aree/` (`scripts/aree_mappa.py`, lo fa `build_map.py`). Il gioco
  scarica le aree entro 1,5 km dal bus e libera quelle oltre 2,6 km (`addArea`, `removeArea` in `city.js`); all'avvio
  solo quelle attorno a Prato, in corsa aspetta fermo quelle entro 300 m. Per chi rigenera la mappa: stesso comando,
  regola 4 anche per le aree;
- SIR2 intero da Rubano (via Pria Fosca) a Busa di Vigonza (`aae9385`), capolinea su via Padova prima della rotonda con
  la SR515 e la SR11. Strade e segnaletica OSM delle due teste in `data/osm-corridoio.json`
  (`scripts/filter_osm_corridoio.py query` scrive la query Overpass dei corridoi, `filtra` tiene quello che manca agli
  export di oggi), edifici e paline Overture, terreno allargato con il DTM regionale (`dtm_grid.py --riquadro --come`:
  le celle di prima restano uguali; WPS `ras:CropCoverage` su `rv:DTM_RV_5m_3003`). Il DBGT di Rubano e Vigonza non
  c'è: valgono le larghezze per tipo di strada. Il lotto del deposito di Rubano (way OSM 1453139702) sta già nelle celle
  del corridoio (da -32 a -30 in x, da -13 a -11 in z) e nell'area `-10_-4`, con almeno 50 m di margine;
- con il corridoio del SIR2 la 10 arriva intera a Sarmeola e a Ponte di Brenta e la 25 è intera (`CORRIDOI_BUS` in
  `build_map.py`: celle toccate dai tracciati GTFS di tutte le varianti, e per quelle linee `build_gtfs.load` tiene
  tutte le varianti). Un tracciato che esce dall'area e ci rientra si aggancia prima intero e, se viene scartato, per
  pezzi.

Funzioni di altre corsie cambiate da `capolinea` l'11 novembre: in `city.js` `buildBuildings` (le case procedurali non
stanno a meno di 4 m dalla linea della fermata, dalla palina a 13 m indietro: con la rete più grande una finiva sul bus
della 88 a Guizza 441 F.T.); `avviaCorsa` di `tests/gioco.js` aspetta le aree attorno al bus; `tests/mappa.spec.js`
carica tutte le aree e ha le soglie del SIR2 (ruote oltre il cordolo 6: Provvidenza 14 e Capolinea Ponte Brenta sulla
10 intera).

Fatto l'11 novembre, gruppo 2 (`7283109`): 3, 10, 11, 22, 24 e 88 intere in tutte le varianti, dal capolinea vero del
GTFS (dettagli in [`ESTENSIONE_LINEE.md`](ESTENSIONE_LINEE.md), sezione 6). Da sapere:

- `filter_osm_corridoio.py query <gtfs> <cartella> [linee]` scrive una query Overpass per riquadro di celle contigue
  (tutte insieme il server le rifiuta) e solo per le celle delle linee nuove; con il server pubblico saturo per ore le
  query sono passate da overpass-turbo nel browser ("dati OSM grezzi"); `filtra` prende più file e tiene quello che
  `data/osm-corridoio.json` ha già;
- in `build_map.py`: dove la linea esce dalla mappa il tratto comincia e finisce con una fermata a meno di 40 m dal
  percorso; `gtfs_links` prende anche catene di vie fuori dall'area fino a 300 m (Via Matteotti a Cadoneghe per la 4);
  nel grafo dell'aggancio le strade di servizio dove passa un tracciato GTFS, nei corridoi fuori dai riquadri, costano
  come le altre (a Carpanedo la 88 faceva un'inversione a U invece dell'anello del capolinea);
- la rigenerazione si compone con la mappa di `main` come per il SIR2 (regola 4), con i tasselli anche delle vie nuove
  attaccate alla rete di prima.

Funzioni di altre corsie cambiate da `capolinea` l'11 novembre, gruppo 2: in `tests/traffico.spec.js` la prova di Tito
Livio e Ponti Romani guida la stessa corsa della 3, che ora parte alle 8:27 dal Capolinea Lion (27 fermate fino a
Garibaldi giardini, prima 17 da Bembo 149), con 8 minuti di tempo invece di 5; in `build_map.py` (corsia `mappa`) il
costo degli archi nel grafo dell'aggancio (`adj`): le strade di servizio coperte da un tracciato GTFS a 6 m, fuori dai
riquadri `FOCUS_BOXES`, costano come le altre (`on_ring`, con `gtfs_cover(...).near`). Nei riquadri cambiava anche il
parcheggio del Capolinea Plebiscito, con la 24 contro un edificio (#25).

#16, tre punti del gruppo 2 (12 novembre). Da sapere:

- `stopPose` (`src/game/routes.js`) mette il bus fermo sulla linea del cordolo (`kl`, `ks`) nel sistema della palina
  (`st.cx`, `st.dz`...), come la segnaletica gialla di `City.buildStops` e come la misura `busLine` di
  `allStopPlacements`; senza palina allineata resta lungo il percorso. Prima usava il percorso 6,5 m prima della palina:
  dove piega (Bembo Rotonda via Ponchia, all'uscita della rotonda, 13 gradi) il bus finiva 0,9 m più in fuori, sulla
  pensilina. Le copie della stessa posa: `posa` in `tests/mappa.spec.js` e la linea del cordolo del pilota (`scosta` in
  `tests/guida.js`). Chi le cambia, le cambia tutte e tre;
- in `build_map.py` e `street_surfaces.surfaces`, solo fuori dal DBGT (`comune` di `data/dbgt-verde.json`, dove
  carreggiate e piazzali sono stimati): all'esterno delle svolte a sinistra dei bus oltre 60 gradi (`SVOLTA_STRETTA`),
  nei primi 20 m della via d'uscita, le facciate stanno a 3 m dal bordo invece di 1,5 (`BUS_TURN_KERB`: il muso di un
  12 m che gira esce fino a 2,3 m oltre il cordolo). Tocca 4 edifici: la casa di fronte a Giarre (22, Via degli Olmi in
  Via dei Ciliegi; la via vera è larga 9 m con la sosta, quella stimata 7,5), due capannoni sulla 10 e uno sulla 24. In
  centro, dove la regola ritaglierebbe anche il Monte di Pietà e la Cassa di Risparmio, non vale;
- stalli dei capolinea: dove il bus fermo alla prima fermata sporge dietro l'inizio del percorso (6 m, lo snodato 12:
  `SNODATI`, come `ARTICULATED_LINES` in `src/game/routes.js`) e lì manca asfalto, la carreggiata continua dritta per quei
  metri (più di 5 m² che mancano alla carreggiata finale, raccordi compresi). Fuori dal DBGT c'è solo Caselle (la 10,
  piazzale vero dietro la rotonda, che OSM non disegna);
- il pilota non anticipa le svolte strette (insegue un punto a 9 m dall'asse posteriore, cioè al muso) e all'uscita si
  allarga: a Giarre sale 4 volte sul marciapiede tra il capolinea e Via Roveri (#77). Provato a tagliare la curva,
  rallentare o guardare più avanti: con la casa dov'era restava a pochi centimetri e avrebbe cambiato la guida di
  tutte le prove;
- la palina di Bembo Rotonda via Ponchia stava 1,7 m dopo le strisce pedonali e il bus fermo le copriva: sistemata in
  #73 (nota nella sezione Mappa).

Funzioni di altre aree cambiate da #16: `stopPose` (vedi sopra, `area:mappa` per le fermate) e la `scosta` del
pilota (`area:verifiche`).

### Traffico (corsia `traffico`)

Issue: `area:traffico` (madri: #48 regole della strada, #58 traffico e corse dinamici).

Aperta l'11 novembre 2026. Bus automatici, auto, pedoni e semafori. File: `Traffic`, `Walkers` e `TrafficLights` in
`src/world/traffic.js`, `src/world/buses.js`; in sola lettura `laneLayout`, `driveOffset` e `turnLanes` di
`src/data/padova.js` (dati della corsia `mappa`). `TramSim` e `TramSignals` sono del tram, tranne il coordinamento con
il traffico (tabella dei file condivisi): quando lo sblocco dei tram chiede di toccarli, si scrive qui cosa e perché.

Blocchi tra bus e tram ai semafori di Tito Livio e Ponti Romani (segnalazione del 9 novembre, fatto l'11 novembre).
Causa: la chiamata del tram (`TramSignals`) dava il rosso a tutti i bracci, anche a quelli lungo il binario; il bus
fermo al rosso sul binario davanti al tram non partiva e il tram dietro teneva viva la chiamata, finché dopo 20 s gli
passava attraverso. Come funziona ora:

- `TrafficLights.tramCall`: resta verde (o lo diventa dopo giallo e tutto rosso) la fase libera per tutti i tram
  chiamati (`x.free`, calcolata in `TramSignals`: bracci paralleli al binario che non sono la strada che lo taglia);
  rosso a chi lo taglia; senza fase libera rosso per tutti. A fine chiamata chi aveva il verde passa dal giallo. La
  fase scelta resta finché va bene a tutti i tram chiamati (se cambia a ogni passo il conteggio riparte);
- `TramSignals.update`: l'incrocio è occupato solo da chi lo attraversa, non da chi va lungo il binario;
- `TramSim.move` (del tram, qui solo chi il tram aspetta): i pezzi del tram portano il loro tram (`tram`), il tram non
  guarda i bus lontani dal giocatore (`b.near`, come i bus non guardano lui), e passa attraverso un bus fermo solo se
  il bus aspetta lui (`waitTram`, `waitX`, dopo 4 s), altrimenti dopo 90 s;
- `buses.js`: chi non può liberare l'incrocio (semaforo o sede del tram) non ci entra (`out` nelle corsie).

Incroci tra traffico e tram ai semafori (11 novembre):

- `TrafficLights.tramCall`: la fase tram parte solo se chi viene tagliato ha avuto 10 s di verde e, dopo una fase
  tram, il verde che gli spettava (`owed`); dopo 30 s non entrano altri tram (`tramOpen`), salvo quello che ha già il
  via libera su un altro incrocio dello stesso semaforo (`vTrams`, `x.who`: prima restava fermo tra due binari e la
  fase non finiva più, alla stazione); se un tram servito non passa con la fase scelta si va verso il tutto rosso.
  Intanto il tram aspetta alla barra orizzontale. Alla fine di una fase tram la fase tagliata ha subito il suo verde
  intero (si sposta il ciclo). Col tutto rosso (due tram che vogliono fasi diverse) appena i tram rimasti passano tutti
  con una fase si va su quella; `TRAM_HOLD` si conta dall'inizio della fase tram (`tramAge`), non dal cambio;
- `TramSignals`: via libera solo con l'incrocio libero da chi taglia i binari, anche fermo, e da chi ci arriva entro
  1,5 s, le auto lungo il loro percorso (`busy`, `covers`, `cuts`); `busy` guarda anche il muso delle auto e il bus di
  chi gioca (il corpo e, in marcia, 1,5 s di strada davanti al muso). Dopo 20 s di incrocio occupato da auto ferme,
  quelle lontane dal giocatore spariscono (`unstick`, in Via Dante la fine della corsia delle auto cade sulla sede);
- lanterne stradali sul binario (`TramSignals.lanterns`, 49 sulla mappa: Pace, Riviera dei Ponti Romani, Via Guido
  Reni, Corso del Popolo...): sono il segnale del tram. Il tram che arriva chiama il verde del suo braccio (con i turni
  di `tramCall`), i tram automatici col rosso si fermano 1 m prima della linea (`stopAhead`), chi gioca passando col
  rosso perde 60 punti. Dove lo stesso tram taglia anche una strada del semaforo decidono le barre. Lanterna disegnata,
  stato usato dalla logica e penalità (`tramSignals.violations` in `main.js`) devono coincidere;
- auto: guardano se i prossimi 50 m del loro percorso, lungo gli archi e anche in svolta (`Traffic.along`), tagliano i
  binari di un incrocio chiamato e si fermano 3 m prima (`calledAhead`); con due binari vicini si fermano prima del
  primo, e chi svolta verso binari subito dopo l'incrocio non entra se appena oltre c'è chi è fermo. Non entrano sui
  binari se oltre c'è coda (`carGap`, che guarda solo l'arco su cui si è); si fermano davanti a un tram che passa;
  niente vicoli ciechi per le auto (`deadEnd`: in Piazza Garibaldi e in Via Morgagni facevano inversioni sulla sede);
- `TramSim.move`: il tram si ferma davanti alle auto (`main.js` gli passa anche le auto), dopo 20 s quella ferma
  sparisce se è lontana dal giocatore;
- bus: la lista degli incroci col tram è geometrica (la corsia taglia la fascia dei binari, `nearXY`), non per arco.

Incroci col tram senza semaforo (11 novembre, `a991c4d`):

- chi ha il passaggio: `x.call` in `TramSignals.update` dice ad auto (`carGap`, `calledAhead`) e bus (`buses.js`)
  quando fermarsi prima dei binari. Senza semaforo da quando il tram chiama l'incrocio; col semaforo solo da quando
  parte la fase tram che lo fa passare;
- senza semaforo la precedenza è del tram: art. 145 del Codice della strada (salvo diversa segnalazione si dà la
  precedenza ai veicoli su rotaia). I 301 incroci senza semaforo (su 468) sono tutti così: nell'export OSM non ci
  sono nodi `railway=tram_crossing` né cartelli che la diano alla strada. Se servirà (binari dei depositi che tagliano
  una strada col tram che dà precedenza), su quell'incrocio `x.call` resta falso fino al via libera e `ready` aspetta
  che `busy` non veda nessuno in arrivo per 5 s;
- il bus di chi gioca che entra coi binari di un incrocio senza semaforo (muso a 1,2 m dalla sagoma del tram) con un
  tram a meno di 12 m più 4 s (`x.close`) perde 60 punti: "🚋 Non hai dato la precedenza al tram!"
  (`tramSignals.giveWay` in `main.js`).

Incroci col tram nelle rotonde (#46, 12 novembre). Nei controlli su tutta la mappa i casi di auto e tram dentro insieme
erano auto ferme a metà di una svolta sui binari all'uscita di una rotonda: Rosetta Gagliardi verso Viale della Pace
(SIR2 e SIR3, davanti alla stazione) e Graziana Campanato verso Via Tommaseo (SIR2). I pezzi delle rotonde sono lunghi
4-8 m e sono quasi tutti curva (tra i raggi dei due nodi la corsia è vuota): `calledAhead` guardava solo negli ultimi
45 m dell'arco, con 20 m in linea retta oltre la prossima svolta, e in svolta non guardava affatto; l'auto passava da
una curva all'altra fino ai binari. Come funziona ora:

- `Traffic.along(car, d0, d1, ts, fn)`: i punti del percorso dell'auto da d0 a d1 m davanti al centro, lungo gli
  archi: il resto della corsia o della curva in cui si trova, poi curva e corsia di ogni arco dopo. Gli archi si
  scelgono in anticipo (`car.route`, `routeAt`; `startTurn` prende il primo, `chooseNext(edge, fwd)`); i punti si
  guardano solo dove ci sono incroci col tram a meno di 30 m dall'arco (`tramXs`, in memoria sull'arco, al posto di
  `TramSignals.nearNode`);
- `calledAhead(car, ts)`: 50 m di percorso davanti al muso (`AHEAD`), a ogni passo e anche in svolta. La coda oltre i
  binari conta solo chi va nello stesso verso: in Via Gozzi, svoltando stretto verso Via Tommaseo, un'auto si fermava
  a metà curva per le auto ferme dall'altra parte, che aspettavano proprio lei;
- `TramSignals.covers` (coordinamento col traffico): un'auto tiene occupato l'incrocio col percorso dal centro al muso
  più 1,5 s di strada, lungo `along`. Prima, in svolta, contava tutto il resto della curva: un'auto ferma a metà prima
  dei binari avrebbe tenuto la barra orizzontale al tram che lei stessa aspettava;
- auto davanti (`Traffic.update`): tra due auto che svoltano verso lo stesso arco passa chi ha meno curva da fare. A
  Lion (Via Mascagni) due auto entravano nello stesso arco da due strade, ognuna aveva l'altra davanti e restavano ferme
  per sempre; ci finiva la prova di Tito Livio, che guida la 3 dal Capolinea Lion (il percorso scelto prima cambia la
  sequenza casuale delle auto). Gli altri intrecci tra auto in svolta sono in #79.

Controllo: 20 minuti col giocatore in dieci punti (alle 8:30 stazione, centro, Prato, Nievo, Corso del Popolo; alle
17:30 stazione, ovest verso Rubano, sud-est, est, sud): su `main` 3 casi in 8 giri, ora nessuno. A Corso del Popolo,
in Prato della Valle e in Piazzetta Nievo (binario in curva, corsia delle auto a 2 m) nessun caso, nemmeno su `main`.
Era la stessa causa delle due prove rosse di #78: in Via San Francesco (23, 148) l'auto che svolta da Riviera Tito
Livio trova i binari 1,6 m dopo l'inizio dell'arco, dentro la curva; a (794, 367), in CI, un pezzo di rotonda senza
nome lungo 8,7 m, tutto curva. Nei controlli dei fermi (40 minuti alle 8:15 e alle 17:30) restano blocchi che c'erano
già su `main`: auto in svolta che si aspettano a vicenda lontano dai binari (#79) e Corso Milano, SIR2 e auto muso a
muso con le auto in coda sovrapposte (#80).

Auto in svolta che si aspettano a vicenda (#79, 12 novembre). Negli incroci senza semaforo due auto con le curve che
si toccano a 2 m arrivavano insieme dove ognuna aveva l'altra davanti (più di 0,5 m avanti, meno di 1,7 m di lato,
direzioni a meno di 107°) e restavano ferme per sempre, con la coda dietro. Su `main`, in 14 giri da 40 minuti col
doppio delle auto (8:15 e 17:30, giocatore in otto punti), 11 casi, tutti di due auto in svolta: Via Pilade Bronzetti
(due volte), Via Gaspare Gozzi (due volte), Piazzale Mazzini, Via delle Melette con Via Tirana, Cavalcavia Dalmazia,
Via dei Savonarola con Via Fusinato, Piazzetta Palatucci, Via Guerrazzi con Via Panzini (1333 s), Via Aldini con Via
Avogadro (2116 s). Con le auto normali, in 4 giri, nessuno. Come funziona ora:

- `Traffic.update`: ogni auto ricorda chi aspetta (`lead`: l'auto davanti, se basta da sola a tenerla ferma, cioè a
  meno di 2 m, dove l'IDM da fermi non riparte), se a fermarla c'è solo lei (`alone`: non anche un semaforo, un bus, un
  tram o la regola dei binari) e da quanti secondi è ferma (`halt`);
- `Traffic.untangle`, dopo il passo di tutte: da ogni auto ferma da almeno 1 s segue `lead` (al più 9 auto, tutte
  ferme); se torna all'auto di partenza è un giro di attese e nessuna ripartirebbe. Tra le auto del giro con `alone`
  passa chi ha l'auto che aspetta più di lato, cioè meno in mezzo alla sua strada: la ignora (`through`) finché non è
  uscita dalla fascia davanti, poi `through` torna `null`. L'altra la segue. Con `alone` non si sceglie chi starebbe
  fermo comunque: nella rotonda del SIR3 vicino a Via Falloppio (794, 367) tre auto si aspettavano in giro e una era
  ferma anche prima dei binari, perché oltre c'era un'altra delle tre (166 s con la prima versione, che guardava solo
  le auto ferme per l'auto davanti);
- scatta per chi aspetta chi e non dopo un tempo: in una coda che si muove o ferma al rosso `lead` non chiude un giro.
  È lo schema che #59 chiede per `unstick`, `carT` e `busT`, che potrebbero partire da `lead`. La regola di #46 (tra due
  auto che svoltano verso lo stesso arco passa chi ha meno curva da fare) resta: lì lo stallo non si forma nemmeno.

Con questo codice, in otto punti alle 8:15 e alle 17:30 ((2300, 3000) al posto di (2000, 3200), vedi sotto), 16 giri
col doppio delle auto e 8 con le auto normali: nessun giro di attese. I giri delle 8:15 con le auto normali sono
identici a quelli di `main`: la simulazione è deterministica (seme fisso) e `untangle` cambia qualcosa solo quando si
forma un giro.

I fermi che restano nei controlli sono auto davanti ai binari con il tram fermo: Corso Milano e Porta Savonarola col
SIR2 (#80) e altri incroci col SIR3 e col SIR2, tra cui Piazzetta Nievo, Via Chiesanuova e Via Vicenza (#89); e a
(2785, 3300) un anello di strade di servizio da cui non si esce, che `deadEnd` non vede (#90).
Nei controlli il giocatore va tenuto lontano dai binari: fermo a 4,3 m dall'asse del SIR3 (teletrasportato a
(2000, 3200)) tiene fermo il tram per tutta la prova.

Pozzi (#90, 12 novembre). Accanto a Corso Esperanto (2785, 3300) un anello di strade di servizio a senso unico, con le
uscite a senso unico fino al bordo dell'area, è un pozzo: da dentro non si torna nella rete. `deadEnd` contava fino a
12 archi raggiungibili e dall'anello se ne raggiungono 17: le auto ci entravano, le uscite erano vicoli ciechi e
giravano nell'anello per sempre, con la coda ferma sulla strada d'ingresso. Come funziona ora:

- `Traffic.pit(e, fwd)`: dall'arco nel verso, con le sole mosse lecite (le svolte permesse e l'inversione a U in fondo
  a una strada a doppio senso senza altre uscite), si raggiungono meno di 200 archi nel loro verso. Nella mappa i pozzi
  arrivano a 35, gli altri archi ne raggiungono più di 44.000; il risultato coincide con "non arriva alla componente
  fortemente connessa più grande" su tutti gli archi. Memoria a parte (`_pit`): chi raggiunge un arco che non è un pozzo
  non lo è, gli archi raggiunti da un pozzo lo sono tutti;
- `deadEnd` è vero anche per i pozzi: le auto non ci nascono (`spawn`) e ci entrano solo se non c'è altro. In
  `chooseNext`, se tutte le uscite sono vicoli ciechi, si sceglie tra quelle che non sono pozzi (succede da 7 archi, tra cui uno
  in Via delle Porte Contarine);
- 93 archi d'ingresso ai pozzi (passaggi leciti da un arco da cui si torna a uno da cui no): 75 erano già vicoli ciechi,
  18 erano aperti e ora non lo sono. Sono, oltre all'anello (entrando da Via Marconi verso Corso Esperanto), un anello
  di servizio a (3571, -125), Via Ronchi Bassi e Via Po verso la Tangenziale di Limena, Via San Tommaso e Via Bonetto, e
  carreggiate a senso unico che finiscono al bordo dell'area (Corso Australia, Corso Boston, Corso Tredici Giugno e Via
  Boves, Corso Esperanto verso Corso Primo Maggio, Via Meucci e Via Galvani): lì le auto arrivavano al bordo e tornavano
  indietro contromano, ora quelle carreggiate restano vuote. Nei pozzi non passa nessuna linea dei bus;
- prova in `tests/traffico.spec.js`: attorno all'anello nessuna auto nasce in un pozzo e nessuna scelta ci entra;
- controllo col giocatore a (2300, 3000), doppio delle auto (144), 40 minuti: con `main` alle 8:15 89 auto ferme oltre
  90 s e alle 17:32 84, tutte nella coda dalla strada d'ingresso fino a Via Marconi (fino a 2169 s), e in media 62
  auto su 144 nei pozzi; ora nessuna auto ferma oltre 90 s e nessuna nei pozzi. Per il confronto basta spegnere
  `pit` nel prototipo (`P.pit = () => false`): `deadEnd` e `chooseNext` tornano come su `main`.

Bus automatici in anticipo (segnalazione dell'11 novembre, "in Prato della Valle a 20 all'ora"): vanno al più il 15%
sotto il limite e recuperano l'anticipo in fermata: oltre 40 s avanti si fermano anche senza prenotazioni, fino
all'orario (al più un minuto). Dal 12 novembre (#64) anche i tram automatici in anticipo vanno all'andatura normale e
aspettano in fermata (nota del tram, "Turni e stazione"): a Largo Europa passano le linee d'arresto a 8,5 m/s (prima
3,8) e la fase tram con un tram solo dura 8-10 s (prima 15,5). Non nelle fermate dove il tram fermo sta sopra un
incrocio: `TramSim.onCrossing` ripete le condizioni di `TramSignals.update` per chi è in sosta, e se cambiano lì va
cambiato anche lui. Se qualcuno sul suo binario lo aspetta (`TramSim.queued`: auto, bus, chi gioca o un altro tram) il
tram riparte finita la sosta di 15 s: a Tito Livio e a Ponti Romani, nella carreggiata, i bus restavano fermi fino a 100
s. `queued` dipende da `ahead` e `full` di `buses.js`: il bus si ferma al semaforo fino a 50 m dietro la coda del tram
(non entra nell'incrocio senza 15 m di posto oltre). Un tram fermo a lungo sopra un incrocio col semaforo tiene ancora
la fase tram agli altri tram dopo `TRAM_HOLD` (#92).

Prove in `tests/traffico.spec.js`: la 3 guidata nel traffico dal pilota (`guidaFermate` con `traffico`) fino a
Garibaldi giardini, nessuno fermo oltre 60 s da Tito Livio a Piazza Garibaldi; 20 minuti attorno ai semafori di Tito
Livio, Ponti Romani-Battisti, Largo Europa e Piazza Garibaldi, tram e auto mai dentro insieme; 20 minuti con tutti i
tram automatici, nessun tram fermo a un segnale (barre o lanterna) oltre 60 s e lanterne disegnate uguali allo stato;
20 minuti sul SIR3 tra Via San Mattia e Via Rosmini (14 incroci senza semaforo); penalità in Via De Leva; nella
rotonda Rosetta Gagliardi `calledAhead` vede i binari di Viale della Pace dall'ingresso e a metà curva, poi 20 minuti
attorno alle rotonde Rosetta Gagliardi e Graziana Campanato, a Corso del Popolo e al Piazzale della Stazione; a Porta
Trento due auto ferme in svolta, ognuna con l'altra davanti (da Via Bezzecca verso Via Belfiore e dalla rotonda verso
Via Bezzecca), finiscono le due svolte in meno di 10 s.

Per `mappa` (11 novembre, #65): su Riviera dei Ponti Romani verso Largo Europa (arco 17836 da (53, -333) a
(71, -306) e il successivo fino a (77, -283)) il binario del SIR1 verso nord corre a 2,2 m dall'asse, dentro la
corsia di chi scende verso Largo Europa (il SIR1 verso sud sta dall'altra parte, a 1,8-4 m). Chi scende e si ferma al
rosso della linea d'arresto (72, -301) è sul binario del tram che arriva di fronte, e in 10,3 m non c'è posto per
stargli di fianco: il tram si ferma davanti al bus di chi gioca e nessuno dei due passa. Nella prova di Ponti Romani
succede al pilota una volta su tre dai turni nuovi dei tram (anche su `main` a `7ed830c`: fermo 128 s). Serve la
corsia di chi scende accanto al binario, o il binario dove sta davvero.

Traffico e corse dinamici (obiettivo di chi gioca, #58): quello che si fa ora (densità delle auto, semafori, bus
automatici) non deve dare per scontato un traffico costante né mezzi sempre in orario. Le corse dei tram le gestisce
`tram-turni`: quando si arriva lì, ci si accorda scrivendolo qui. Cosa regge già le code: nessuno entra sui binari o
nell'incrocio senza posto oltre (`carGap`, `calledAhead`, `full` dei bus); i bus automatici partono dall'orario ma poi
si muovono nel traffico; la chiamata del tram ai semafori e agli incroci parte da dove il tram è davvero. Cosa dà per
scontato un traffico leggero: il numero di auto fisso per tutta la corsa (#60) e gli sblocchi che contano il tempo
invece di chi aspetta chi (#59).

Verifiche: regola 3, le foto dal posto di guida nei punti cambiati, la guida della 3 su Riviera dei Ponti Romani, e il
controllo su tutta la mappa: 40 minuti alle 8:15 e alle 17:30, giocatore lontano e in centro, nessun bus o tram fermo
oltre 90 s.

Retro delle lanterne del tram (#12, `area:tram`, 12 novembre): in `TramSignals.buildHeads` la cassa è grigia (0x9aa0a6,
un'unica mesh con palo, staffe e calotte) con il pannello nero davanti, una calotta dietro ogni luce e il palo accanto
alla cassa, dalla parte lontana dal binario. Logica, stati e `drawHeads` non cambiano: le luci (`hd.pos`) sono dove
erano. Dietro prima c'era un rettangolo nero vuoto: a Voltabarozzo chi arriva al capolinea ha davanti, sopra i binari,
la lanterna dei tram in partenza vista da dietro (2385, 3519) da 70 m fino all'attraversamento. Le 468 lanterne
passano da 64.116 a 125.892 triangoli (132 in più per lanterna) e `buildHeads` da circa 27 a 49 ms con SwiftShader.

Pali delle lanterne del tram fuori dalla strada (#97, `area:tram`, 13 novembre): `TramSignals.buildHeads(scene, city)`
mette il palo con `City.poleSpot` (sul marciapiede, su un'isola o sul verde, fuori dalla sagoma di ogni binario), a
destra fino a 14 m e fino a 6 m prima, se no a sinistra fino a 12 m; oltre 4 m a destra la lanterna sta su uno sbraccio
a `MAST_Y`, a `TRAM.lane` + 0,6 m dal binario. Senza posto per un palo è appesa al tirante della linea aerea più vicino
fino a 30 m prima (`city.tramSpans`, 30 lanterne), e senza neanche quello accanto alla sede fuori dalla sagoma. `hd.pole`
dice dov'è il palo (null se appesa), per `tests/pali.js`. Logica, stati e `drawHeads` non cambiano; le luci (`hd.pos`)
si spostano col palo. `buildHeads` passa da circa 38 a 100 ms con SwiftShader.

### Veicoli e guida (corsia `guida`, chiusa l'11 novembre)

Aperta e chiusa l'11 novembre 2026. Comandi e veicolo di chi gioca (IDEE, "Veicoli e guida"). File: `src/bus/bus.js`, gli
ingressi in `src/main.js` (oggetto `input`, comandi touch), menu e pausa in `index.html` e `src/style.css`.
Dall'11 novembre telefoni e tablet non sono supportati: comandi touch e HUD compatto restano nel codice ma spenti
(`MOBILE_SUPPORTED = false` in `src/game/touch.js`, invito a giocare da computer). Niente lavoro sul touch finché non
si riattiva.

- **Sterzo, fatto l'11 novembre** (sondaggio del 9 novembre, giocatore nuovo, Chrome su Windows, quindi tastiera:
  "La guida secondo me era meglio quella vecchia, l'attuale è troppo sensibile").
  - Cosa è cambiato: per la tastiera solo `ce4ea51` (6 novembre). Prima il volante andava verso il fondo a 0,85 al
    secondo e tornava al centro a 1,25 al secondo, le ruote lo seguivano subito; da `ce4ea51` la velocità cresce da
    0,22 a 0,97 in 0,6 s, il ritorno al centro è esponenziale (0,4 + 0,1 × m/s al secondo) e le ruote hanno un ritardo.
    `bfd0adb` ha aggiunto solo il volante touch. Il sito pubblica `main` dal 4 novembre.
  - Confronto (tasto tenuto, velocità costante, `dt` 1/60). Volante in gradi (rapporto 14), raggio di curva
    all'asse posteriore al rilascio, rotta totale fino a quando il volante è tornato al centro:

    | km/h | tasto | volante° prima / dopo | raggio m prima / dopo | rotta° prima / dopo / con 0,7 |
    |---|---|---|---|---|
    | 20 | 0,2 s | 79 / 15 | 60 / 324 | 1,0 / 2,4 / 1,6 |
    | 20 | 0,5 s | 191 / 81 | 24 / 58 | 5,6 / 9,9 / 6,9 |
    | 20 | 1 s | 376 / 275 | 12 / 17 | 22,4 / 32,6 / 22,6 |
    | 50 | 0,2 s | 48 / 9 | 98 / 531 | 1,4 / 2,0 / 1,4 |
    | 50 | 0,5 s | 116 / 49 | 40 / 96 | 8,4 / 9,2 / 6,4 |
    | 50 | 1 s | 229 / 168 | 20 / 28 | 33,3 / 32,6 / 22,7 |

    Al rilascio il volante di oggi è girato meno, ma ci mette 2,7 s a tornare al centro a 20 km/h (prima 0,3 s) e
    3,8 s a 10 km/h: il bus continua a girare dopo che si è lasciato il tasto, e in città un colpo di tasto lo fa
    girare da 1,5 a 2,5 volte più di prima.
  - Regolazione "Sensibilità dello sterzo" nel menu (punto 8, nascosto col tram) e nella pausa (riquadro Autobus):
    Bassa 0,5, Media 0,7 (di partenza), Alta 1 (lo sterzo dal 6 all'11 novembre), Molto alta 1,4, salvata in
    `localStorage` (`padova-bus-sim-sterzo`). Passa al bus come `input.steerSens` e scala solo la velocità con cui i
    tasti allontanano il volante dal centro; il controsterzo resta svelto, `maxSteer`, ritorno al centro e volante
    touch non cambiano, quindi il giro guidato di `npm test` resta uguale.
- **Gamepad e volante, fatto l'11 novembre** (`src/game/gamepad.js`, letto in `readInput` come i comandi touch e,
  in pausa e nel menu, dal ciclo principale). Gamepad standard: levetta sinistra = posizione del volante (zona morta
  0,15, curva 1,5), grilletti = pedali analogici, pulsanti = `onKeyPress` (tabella in testa al file; col tram X è il
  pantografo e la croce giù il cambio cabina). Lo sterzo del gamepad vale finché si preme un tasto di sterzo, poi
  torna alla tastiera fino alla prossima mossa della levetta. Volanti e pedaliere (mappatura non standard, o standard
  se si vuole): impostazione dalla pausa in tre passi, salvata in `localStorage` (`padova-bus-sim-volante`, per `id`
  del dispositivo), che legge assi e valori dei pulsanti; prima dell'impostazione vanno solo i pulsanti 0-3, 8 e 9.
  Prove con un controller finto in `tests/gamepad.spec.js`. Da provare con un volante vero (G29 o simili): range del
  volante, pedali che danno 0 finché non si toccano (gestito), palette e pulsanti dei diversi modelli.
- **Bus elettrico, fatto l'11 novembre**: batteria in `Bus` (`battery`, `energy`, `useEnergy`, `energyTick`;
  trazione e recupero in `update`, servizi di bordo e ricarica sul tempo della corsa, che in sosta può correre più
  del gioco), colonnine in `src/world/charger.js` (al massimo 6 nella scena, messe da `placeChargers` ai capolinea
  della corsa che non sono tagliati al bordo della mappa, con `stopPose`), logica in `chargeStep` e `chargeKey` di
  `main.js`. Il tasto O del bus (X del gamepad) è la colonnina; X non è più la marcia: col gamepad la retromarcia si
  mette ripremendo LT da fermo. Numeri in IDEE ("Fatto"). Non ci sono dati su colonnine vere ai capolinea di Padova:
  se si trovano, vanno messe dove sono.
- **Telecamera della porta posteriore, fatta l'11 novembre**: come gli specchietti è un riquadro sopra la scena
  (`doorRT`, `doorCam`, `doorQuad` e `updateDoorCam` in `main.js`, cornice `#door-frame`), perché il cruscotto 3D
  della cabina resta sotto l'inquadratura. Solo per il bus.
- **Specchietti regolabili, fatti l'11 novembre**: `mirrorAdj` in `main.js` (spostamento del punto guardato, 31 m
  dietro, in fuori e in basso), trascinamento sulle cornici `#mirror-frame-l` e `#mirror-frame-r`.
- Se si riapre: la prova con un volante vero, le colonnine dove sono davvero se si trovano i dati. Specchietti e
  monitor della porta si ridisegnano a disegni alterni (`renders` in `render`), quindi anche con `sim(…, true)` nelle
  prove; il giro guidato di `npm test` non deve cambiare.

### Tram: turni e stazione (corsia `tram-turni`)

Issue: `area:tram` (madre: #3 rete dei binari con i bivi e depositi del tram).

Aperta l'11 novembre 2026. Il tram di chi gioca tra una corsa e l'altra, i turni e i binari della stazione. File:
`src/game/turni.js` e le funzioni dei turni in `src/main.js` (`changeTramCab`, `chainNext`, `nextOfTurno`),
`TramTrack` in `src/tram/tram.js`, `TramSim` in `src/world/traffic.js` tranne il coordinamento con il traffico (che è
di `traffico`), `smoothTrack` e `NEW_TRAM_LINES` in `src/data/padova.js`, `scripts/tram_linee.py` e
`data/tram-linee-nuove.json` (con `capolinea`, tabella dei file condivisi), la parte del tram di `buildTramway` in
`src/world/city.js`. Dall'11 novembre pomeriggio scambi, cambio cabina, riquadro di fine corsa del tram, rete dei
binari e depositi sono della corsia `tram-scambi` (sotto).

Fatto, con quello che serve sapere prima di toccare questi file:

- B al capolinea (11 novembre): `tramNextRun` in `main.js`, prova in `tests/turni-tram.spec.js`.
- Tram incastrato al capolinea di Voltabarozzo (11 novembre). Fuori dai miei file, piccolo: in `mission.js` al
  capolinea del tram la zona arriva fino alla fine del binario, e chi si ferma oltre la banchina perde 10 punti come
  chi si ferma troppo indietro. Prova "in fondo al binario" in `tests/turni-tram.spec.js`.
- Fermate del tram: `build_map.py` e `aree_mappa.py` leggono solo i percorsi di `tram-linee-nuove.json`, non le
  fermate, quindi spostare una fermata non cambia la mappa. Le fermate le mette `fermate_sul_binario` in
  `tram_linee.py` (`tram-scambi`, sotto); `SPOSTA` non c'è più.
- Binari della stazione (11 novembre; [`linee-tram-nuove.md`](linee-tram-nuove.md), "Binari della stazione"): i
  binari dell'anello vengono dalle way OSM del cantiere (`tram_linee.py`, anello interno e raccordi) e passano da
  `smoothTrack`. Fuori dai miei file, piccoli: in `build_map.py` i binari del SIR1 passano da
  `scripts/tram_stazione.py` (`stazione_xz`, dopo `tram_lane`) e la rete ha la chiave `tramStazione`; in
  `tram_linee.py` il percorso passa dallo stesso modulo prima delle fermate (`stazione`); in `TramSim` di `traffic.js`
  `exclude` (la corsa dopo del giocatore). La mappa l'ho rigenerata ma pubblicata solo nei binari del SIR1, in
  `tramStazione` e nelle quattro celle da 200 m della stazione (area `0_-2`): il resto cambiava solo per la versione
  di shapely (qui 2.2.0); soglia del marciapiede stretto da 176.000 a 176.010. Chi rigenera dopo trova gli stessi
  binari.
- Manovra al capolinea come nella realtà e B che cambia solo cabina (11 novembre). Ai capolinea su binario tronco:
  discesa alla fermata d'arrivo, avanti fino in fondo al binario, B (cambia solo la cabina, ogni cassa resta dov'è:
  `Tram.transfer`), ripartenza fino alla fermata di partenza sull'altro binario. Lo scambio è la comunicazione di OSM
  (`service=crossover`, scritta da `tram_linee.py` in `tram-linee-nuove.json`, `net.tramScambi`), e come pende dice
  quando si passa sull'altro binario (`TramTrack.terminal`): dopo il cambio cabina a Voltabarozzo (la comunicazione
  subito dopo le banchine) e Rubano, prima a Pontevigodarzere e Guizza (la comunicazione oltre le banchine porta sul
  tronco dell'altro binario, B in fondo). A Busa di Vigonza OSM non ne ha: S di 24 m calcolata. Il tratto sullo scambio
  è il binario di partenza (o d'arrivo) spostato verso l'altro con le distanze lungo i binari (`Tram.at`, `xover`,
  `xend`). Il SIR1 aveva i tronchi tagliati: lo shape GTFS fa l'inversione in fondo e il pezzo di ritorno ora va in
  testa al binario di partenza (`padova.js`). Segnale dello scambio a due facce con la posizione (`switchSign` in
  `city.js`): in servizio è automatico, diritto per l'arrivo e deviato al cambio cabina dove si passa dopo, deviato per
  l'arrivo dove si passa prima; in Esplorazione e Giro libero lo gira N (diritto: B cambia solo cabina e si torna
  indietro sullo stesso binario). Prove con il pilota per ogni capolinea in `tests/turni-tram.spec.js`
  (`guidaCapolinea` in `tests/guida.js`; nel pilota la fase "apri" passa al servizio se le porte sono già aperte).
- Turni dei tram automatici (11 novembre). Senza i tratti del GTFS (ogni viaggio del SIR1 c'è anche spezzato: Santo →
  Pontevigodarzere restava perché la corsa intera ha due fermate Pontevigodarzere a 3 minuti e il confronto prendeva la
  prima; giravano due tram a un minuto tra Santo e Pontevigodarzere) e concatenati in turni con la regola dei turni di
  chi guida (`turni.js`, sotto): al più due tram in sosta a ogni capolinea, sosta di almeno 3 minuti dove c'è la
  manovra e di 1 all'anello della stazione (l'orario del SIR3 arriva lì un minuto prima di una partenza: la banchina di
  Stazione sud la usa anche il SIR2). `endRun` prende la corsa dopo del turno. Con i ritardi: una corsa il cui tram è
  ancora sulla corsa prima non entra nuova al capolinea, la fa lui in ritardo (`schedule`); un terzo tram al capolinea
  aspetta alla banchina d'arrivo che lo scambio sia libero. Le prime corse dei turni entrano alla banchina di partenza
  e le ultime escono alla banchina d'arrivo: lì si attaccano uscita e rientro dal deposito dei tram automatici (#61).
  Prova in `tests/turni-tram.spec.js` ("tram automatici"), con un tram per linea fermo 4 minuti.
- Turni di chi guida il tram (11 novembre). `turni()` di `turni.js` è l'unica fonte dei turni del tram: toglie i
  tratti (`senzaTratti`), concatena con i posti e le soste dei capolinea (`impostaSostaTram`, da `main.js` con i
  binari) e `tramRuns` prende da lì le corse dei tram automatici, con gli stessi `prev` e `next`. Un tratto scelto dal
  menu sta nel turno della corsa intera che lo contiene (`per`): prosegue con la sua corsa dopo se finisce al
  capolinea con lei, altrimenti è l'ultima. Prova in `tests/turni-tram.spec.js` ("turni del tram di chi guida").
- Per `tram-scambi`: anche i tram automatici fanno la manovra ai capolinea con lo scambio (discesa, fondo del
  binario, cambio cabina, fermata di partenza) invece di saltare sull'altro binario: `TramSim.turnAt`, `termBusy`,
  `termLimit` e `lanePoint`, che sposta il tram sulla comunicazione con `TramTrack.terminalOff` (nuovo, accanto a
  `terminal`; `t.off(s, dev)` ha il parametro `dev`, sempre deviato per i tram automatici). Un tram alla volta nella
  comunicazione e nel tronco (`t.occ`), anche quello di chi gioca; alla prima fermata il muso va avanti quanto basta
  perché la coda esca dallo scambio (`terminalClear`, Voltabarozzo). Il segnale dello scambio lo girano anche loro
  (`trams.onSwitch` in `main.js`). Se la rete dei binari cambia `terminal`, la prova "tram automatici" di
  `tests/turni-tram.spec.js` deve restare verde: i punti da tenere sono quelli elencati qui.
- Corse in ritardo (obiettivo di chi gioca, #58): turni, soste e posti ai capolinea vanno fatti in modo da reggere
  anche corse in ritardo, non solo l'orario esatto.
- Tram automatici e rimessa (12 novembre, #61). La prima corsa di un turno dalla Guizza o da Voltabarozzo
  (`r.fromDepot`, da `TramSim.depotOf` in `setService`) ha il tram in rimessa 5 minuti prima della partenza
  (`EXIT_LEAD`): `spawnDepot` lo mette in fondo a un binario libero col fondo dietro (`TramYard.parking`, rango pari)
  con il percorso del deposito fino alla banchina di partenza (`YardRun`, ora esportata da `tram.js`; `routeWith` mette
  gli scambi del piano solo per calcolarlo). L'ultima corsa del turno verso uno di questi capolinea (`endRun` →
  `toDepot`): discesa di 20 s, poi `depotIn` sceglie un binario tronco libero (prima quelli coperti) e il tram ci va;
  fermo in fondo, sparisce dopo 8 s. Nel deposito il tram ha `tr.rimessa`, `tr.track` è lo `YardRun` (dir 1) e
  `depotStep` dà la velocità (15 km/h, `YARD_V`); alla banchina `toLine` lo rimette sul binario della linea e lo
  scambio del capolinea si libera con `tr.esce`. Un tram automatico alla volta per deposito (`locks`: uscendo fino alla
  coda oltre la porta, entrando fino in fondo), e con lui lo scambio del capolinea (`t.occ`: entrando alla Guizza fino
  alla coda oltre la comunicazione, a Voltabarozzo fino oltre la porta, perché lì la manovra usa il binario d'arrivo
  fino in fondo). Uscendo serve anche il binario di partenza libero dalla porta alla banchina (`depotFree`); nel
  deposito non si muove nessuno mentre lo usa il tram di chi gioca (`trams.yardBusy` in `main.js`). Gli scambi del
  deposito si mettono per loro (`sw.state`, `sw.sign`); quello del capolinea va diritto per chi lo prende di punta
  (entrando alla Guizza, uscendo a Voltabarozzo) e poi torna com'era. Senza un binario libero in rimessa si riprova
  ogni 15 s e la corsa parte in ritardo; dopo 10 minuti (`DEPOT_LATE`) comincia lungo la linea. Nelle funzioni di
  `tram-scambi`: `tramToDepot` in `main.js` sceglie un binario senza tram automatici (`trams.edgeFree`). Prove in
  `tests/depositi-tram.spec.js` ("tram automatici: all'inizio del servizio…" e "…alla fine del servizio…"): 40 minuti
  dalle 5:10 e dalle 23:00, senza tram fermi oltre 90 s, al più due in sosta per capolinea, senza salti delle casse
  (passo per passo entrando e uscendo dal deposito) e con gli scambi messi; dalle 5:10 tutte le uscite in orario.
- Corse doppie del GTFS (12 novembre, #71). Alcuni viaggi del SIR1 ci sono due o tre volte, ognuno nel suo blocco di
  BusOne e a volte con tempi diversi: nei feriali dalla Guizza alle 5:35-6:30 (alle 6:16 uno di 39 minuti e uno di 46),
  da Pontevigodarzere alle 20:48-21:58 (anche su due varianti, con 24 e 25 fermate) e alle 0:20. In `senzaTratti`,
  dopo i tratti: una corsa con le stesse fermate di un'altra (ogni fermata entro 150 m da una dell'altra), che parte
  entro un minuto e arriva entro 10 minuti da lei, è una copia. Resta quella che arriva prima: con la più lenta la sera
  un tram arriverebbe alla Guizza prima di quello partito 7 minuti prima di lui. Le copie stanno con i tratti
  (`copia`, `per` la corsa che resta) e i tratti di una copia passano alla corsa che resta con la catena di `per`:
  togliere le copie dall'orario prima di `senzaTratti` lascerebbe senza corsa intera i tratti della copia lenta (Cavalletto
  → Guizza alle 21:28 diventava un tram in più). Una copia ha nel turno di chi guida lo stesso `prev` e `next` della
  corsa che resta, anche se arriva più tardi. Dal menu le copie le toglie #75 (sotto). Prova in
  `tests/turni-tram.spec.js` ("corse doppie del GTFS del SIR1…"): un tram per orario dalla Guizza alle 5:35-6:16,
  nessuna corsa intera che arriva prima di quella partita prima sullo stesso percorso, le copie al posto della corsa che
  resta.
- Corse doppie nel menu (12 novembre, #75). Le partenze del menu vengono da `partenze(L, day, v)` di `turni.js`: per il
  tram sono quelle dell'orario (`v[day]`) senza le copie, che `turni` raccoglie in `copie` come oggetti dell'orario (ogni
  corsa ha in `dp` la partenza da cui viene). Si confrontano gli oggetti e non gli orari perché lo stesso viaggio ci può
  essere due volte identico nella stessa variante (dalla Guizza 5:35 → 6:14 due volte). Le usano in `main.js` l'elenco
  `#departure` e la sua scelta (il valore è l'indice in `partenze`), i conteggi "fer. / fest." di `#route-variant`,
  quello di `#variant-note` e la scheda della linea (`renderLines`). Una copia che sta in un'altra variante sparisce dal
  suo elenco: la sera da Pontevigodarzere la corsa delle 21:23 resta solo tra quelle da 24 fermate. Nel SIR1 il menu ha
  22 partenze feriali e 13 festive in meno; i tratti restano. Prova in `tests/turni-tram.spec.js` ("menu del SIR1…"):
  dalla Guizza alle 5:35-6:30 un'opzione per orario, in nessun elenco la stessa ora due volte, conteggi uguali agli
  elenchi e ogni opzione con i tempi della corsa che resta nel turno.
- Tram automatici in anticipo (12 novembre, #64). In `TramSim.move` la corsa in linea va a 8,5 m/s anche in anticipo
  sull'orario, e l'anticipo si recupera in fermata: il tram aspetta l'orario (`wait`, almeno 15 s; nelle fermate in
  mezzo al più 2 minuti, alla prima fino all'ora). Prima rallentava fino a 3 m/s per arrivare 15 s prima della
  partenza. In 25 minuti dalle 8:29 e dalle 17:38, giocatore lontano, confronto con `main` del 13 novembre: tra due
  fermate in anticipo 7,6-7,8 m/s di media (prima 5,0 sul SIR1, 5,9 su SIR2 e SIR3); alle linee d'arresto di Largo
  Europa (barre e lanterna) i tram passano a 8,5 m/s di mediana (prima 3,8); la fase tram di quel semaforo dura 8-23 s,
  in media 14 (prima 15,5-27, in media 19), e la più corta, un tram da solo, 8-10 s (prima 15,5). Le fasi lunghe che
  restano sono tram e bus che si incontrano sul binario (#65) o due tram insieme. Nessun tram fermo oltre 90 s. Nei
  tratti lunghi dell'orario GTFS del SIR1 l'anticipo arriva a 3 minuti: oltre i 2 minuti d'attesa il tram riparte
  prima dell'orario. Provato anche al più il 15% sotto, come i bus: 6,7 m/s, fase 11-14 s.
  Nelle fermate dove il tram fermo sta sopra un incrocio con la strada (col muso o con la cassa) o appena oltre una
  lanterna (`TramSim.onCrossing`, deciso sulla fine della banchina `ss[k]`) l'orario non si aspetta: 15 s e via,
  l'anticipo si recupera alla fermata dopo. Sono 25, 20 del SIR2 (se sono al posto giusto: #93). In sosta il tram
  tiene chiamato l'incrocio su cui sta (`TramSignals.update`): aspettando l'anticipo teneva il semaforo in fase tram
  oltre i 30 s di `TRAM_HOLD`, e il tram dell'altro verso restava alla barra orizzontale (#92). `onCrossing` ripete le
  condizioni di `TramSignals.update` per chi è in sosta (`d > -(len + halfT) && d <= halfT`, lanterna
  `d > -8 && d <= 0`): se cambiano lì, vanno cambiate anche qui.
  Dove il binario corre nella carreggiata il tram che aspetta l'orario tiene fermo il traffico: alle fermate Tito Livio
  e Ponti Romani i bus restavano fermi 70-100 s e la prova di Tito Livio di `tests/traffico.spec.js` falliva;
  all'Arcella, la sera, un SIR1 aspettava 2 minuti dietro una corsa che comincia a metà linea. Ora il tram riparte
  finita la sosta di 15 s (`tr.hold`: i secondi d'attesa oltre la sosta; `tr.cut` quando l'attesa è stata tagliata) se
  qualcuno lo aspetta (`TramSim.queued`): un bus automatico fermo per lui (`waitTram` di `buses.js`, anche il bus
  che svolta a Tito Livio davanti al muso), o sul binario (proiettando entro 3 m) un'auto, un bus, il mezzo
  di chi gioca o un altro tram dietro la coda nel suo verso (entro 20 m, o fermo entro 50: il bus resta al semaforo
  prima dell'incrocio finché oltre non ha 15 m di posto, `full` in `buses.js`), o fermo entro 70 m davanti al muso e
  rivolto verso di lui.
  Alla penultima fermata il tram aspetta anche quanto serve per arrivare al capolinea 15 s prima dell'orario, come
  quando rallentava (`d / 8,5 + 7` s per l'ultima tratta). I turni ci fanno stare al più due tram: arrivando fino a 3
  minuti prima, alle 23:15 alla Guizza ce n'erano tre e il terzo restava oltre i 90 s davanti allo scambio (prova "alla
  fine del servizio" di `tests/depositi-tram.spec.js`).
  Prova in "tram automatici" di `tests/turni-tram.spec.js`, che ha anche le misure in anticipo: velocità tra le
  fermate, partenze prima dell'orario (salvo `onCrossing`, `tr.cut` e oltre 2 minuti), velocità alle linee d'arresto e
  fase più corta di Largo Europa (semaforo con il nodo in (53, -333)). Il tram che la prova ferma 4 minuti
  non si sceglie sopra un incrocio: con le velocità nuove capitava un SIR2 su Via Antonio Marchi, che teneva la fase
  tram per tutto il tempo.

Verifiche: regola 3, più le foto in stazione e la guida dei tram che ci passano.

### Tram: scambi e depositi (corsia `tram-scambi`)

Issue: `area:tram` (madre: #3 rete dei binari con i bivi e depositi del tram).

Aperta l'11 novembre 2026 (pomeriggio), da `tram-turni`. Il tram di chi gioca ai capolinea e sugli scambi: cambio
cabina, scambi manovrabili, rete dei binari con i bivi, depositi. File: in `src/tram/tram.js` `TramTrack` (scambi,
`terminal`, percorsi) e `Tram` (`transfer`, `at`, `xover`, `xend`); in `src/main.js` `changeTramCab`,
`toggleTramSwitch`, `tramAtTerminal`, `setSwitch`, `tramLoop`, `tramNav`, il riquadro di fine corsa del tram
(`closeTramResults`); `switchSign` e la parte del tram di `buildTramway` in `src/world/city.js`; i binari in
`src/data/padova.js` e `scripts/tram_linee.py` (tabella dei file condivisi). I turni (`src/game/turni.js`,
`tramRuns`, `chainNext`, `nextOfTurno`) restano di `tram-turni`: chi tocca una funzione dell'altra lo scrive qui.

Il lavoro fatto finora sulla manovra al capolinea è descritto sopra, in `tram-turni` ("Manovra al capolinea come
nella realtà"): comunicazioni di OSM in `net.tramScambi`, `TramTrack.terminal`, segnale dello scambio, N in
Esplorazione e Giro libero, prove in `tests/turni-tram.spec.js` con `guidaCapolinea` di `tests/guida.js`.

Immagini mandate da chi gioca (non vanno nel repo): `images/<n>.png` nella cartella della sessione del checkout
principale, `/private/tmp/claude-501/-Users-flevour-Sites-flevour-bus-simulator/1f252032-3341-4785-8744-16f28dc7514a/images/`
(14 scambio a un capolinea, 19 Pontevigodarzere dall'alto, 20 Voltabarozzo dall'alto con il deposito, 21 cantiere di
Rubano, 22 segnale dello scambio all'arrivo, 23 schema OSM di Voltabarozzo, 24 schema OSM della Guizza); le tre della
segnalazione urgente nella sessione di `tram-turni`,
`/private/tmp/claude-501/-Users-flevour--herdr-worktrees-bus-simulator-corsia-tram-turni/dc4a4a37-01d4-4293-864a-a5497e45bcd8/images/`
(10, 11, 12).

Fatto, con quello che serve sapere prima di toccare questi file:

- Manovra al capolinea sbloccata (segnalazione urgente dell'11 novembre su Voltabarozzo). Esc o "Fai la manovra al
  capolinea" chiudono il riepilogo di fine corsa (`closeTramResults`); B o "Prossima corsa" col riepilogo aperto,
  prima del punto della manovra, lo chiudono anche. Il navigatore del tram, quando il percorso della corsa non basta,
  lo dà `tramNav` in `main.js` (via `Mission.navHint`, frase pronta in `nav.text` per `hud.js`): a fine corsa quanti
  metri fare per avere tutto il tram oltre lo scambio, poi B. B a metà corsa in servizio, deciso così: cambia solo
  cabina, la corsa resta quella, si guida all'indietro sullo stesso binario, le fermate non si servono (`inZone` in
  `mission.js` con `bus.facing < 0`) e il navigatore dice "Cambia cabina (B)"; nessuna penalità. Il salvataggio
  ricorda la cabina (`facing`). In `tram_linee.py` (file condiviso con `capolinea` e `tram-turni`)
  `fermate_sul_binario` prende per ogni verso la fermata sul suo binario e, dove OSM ha la banchina
  (`railway=platform`), la mette a metà banchina: le due stop_position di OSM ai capi della banchina centrale di
  Voltabarozzo erano scambiate tra i versi (`stops_on` prende la prima che incontra). La S dello scambio in
  `buildTramway` sta sotto le corsie dritte, in tinta unita (sembrava una X).
- Bivi tra le linee (11 novembre). `TramNet` in `tram.js` (accanto a `TramTrack`, costruita in `buildTramway`,
  `city.tramNet`): un bivio per capo di ogni tratto in comune di `TramTrack.shared` dove il tram più lungo ci sta tutto
  (10 bivi: SIR2 su SIR1 e su SIR3 nei due versi, il ritorno del SIR3 sull'andata in stazione; fuori gli incroci da
  9-27 m tra gli anelli). Il tram di chi gioca, fuori servizio (`bus.net`), lo prende di punta in
  `Tram.checkJunctions` e passa sull'altro binario con `switchTo` (anche cambio di `track`); in servizio la corsa resta
  sul suo percorso. Posizione: `updateJunctions` in `main.js` ogni mezzo secondo, per il tram più vicino che ci arriva
  entro 150 m (in servizio anche quelli automatici, dalla loro `track`, `dir` e `s`). I tram automatici non cambiano
  linea: seguono il loro binario, e i bivi si mettono per loro.
- Scambi dei capolinea nella rete (#10, 12 novembre). `TramTrack.terminal` resta com'era per la geometria e la
  manovra (`off`, `other`, `toe`, `heel`, `link`, `fondo`; `terminalOff` e i tram automatici di `TramSim` non
  cambiano), ma ogni scambio del capolinea è anche un nodo di `TramNet` (`tipo: 'capolinea'`, accanto ai bivi con
  `tipo: 'bivio'`; `net.terminals`, `net.nodes`). Il segnale è il `panel` come per i bivi (`t.panel.sig`, `side`,
  `state`; prima `t.sig` e `t.side`) e lo costruisce lo stesso ciclo di `buildTramway` (`t.sign`; `city.tramSwitches`
  non c'è più, `setSwitch` aggiorna `t.sign`). `net.on(T, dir)` dà per ogni binario dove si prende di punta ogni
  scambio (`{ j, role, s, fw }`): i bivi come prima, gli scambi dei capolinea sul binario d'arrivo, a `toe` andando
  verso il tronco ('avanti') o a `link` tornando dal tronco ('dopo', 'prima'). N (`toggleTramSwitch`) sceglie con
  `TramNet.pick`: il più vicino preso di punta davanti entro 250 m; poi, entro 120 m e con 100 m in più, quelli che il
  tram prenderà di punta dopo il cambio cabina (da fermo alle spalle, e davanti se il binario finisce entro 150 m: lo
  scambio dei capolinea 'dopo' arrivando alla banchina). Lo gira `TramNet.turn`. Lo scambio del capolinea si comporta
  come un bivio anche al passaggio (`Tram.checkJunctions`, solo fuori servizio): deviato e preso tornando dal tronco
  sul binario d'arrivo (dopo B con lo scambio diritto, poi N), porta il tram sul binario di partenza come il cambio cabina in fondo (`reseat` e `xover`, senza spostarlo). La
  manovra con B in fondo resta quella di prima. Prova in `tests/bivi-tram.spec.js`.
- Depositi della Guizza e di Voltabarozzo (11 novembre). Dati: `scripts/tram_depositi.py` → `data/tram-depositi.json`
  (way OSM attorno al deposito), `TRAM_DEPOTS` in `padova.js`; la mappa non cambia. Grafo: `TramYard` in `tram.js`
  (`city.tramYards`, disegnato in `buildTramway`; rimessa ed edifici accanto ai binari sotto, #66); porte 6 m prima della fine dei binari
  della linea, sulla way OSM che prosegue; scambi con `options` (il più dritto prima), `home` verso l'uscita più
  vicina, `reset()` a ogni corsa. Il tram di chi gioca (`bus.yards`, solo fuori servizio): `Tram.yardEnter`,
  `yardStep`, `yardRebuild`, `yardAhead` (per N), `reseat`. Fuori servizio, ai capolinea con lo scambio, tutto il tram
  sul tratto dove corre sull'altro binario e in marcia verso il tronco passa davvero su quel binario (`yardEnter`), e
  uscendo dal deposito sul tronco d'arrivo lo scostamento dello scambio aspetta che il tram sia tutto prima della
  comunicazione (`xendHold`). In servizio, l'uscita della prima corsa del turno dalla rimessa e il rientro dopo
  l'ultima (`f57fc61`): `tramDepotExit`, `tramToDepot`, `tramDepotCheck` in `main.js`; `Mission.depotOut` in
  `mission.js`. Per `tram-turni`: le corse sono quelle di `turnoOf`, l'uscita comincia 5 minuti prima della partenza,
  il rientro è un pulsante del riepilogo come per il bus, `showShiftEnd` dice "tram in rimessa"; nel menu
  `refreshTurno` mostra "Esci dal deposito" e la nota della rimessa anche per il tram. A Voltabarozzo in fondo i due
  binari si uniscono nel binario della rimessa: non è un anello, si gira cambiando cabina. La seconda comunicazione
  (`a8e086f`) è una porta a metà del binario di partenza (`pt.mid`, `state` 'linea'/'deposito', N);
  `tram_depositi.py` tiene le comunicazioni, e quelle dei capolinea cadono da sole (i pezzi di way sopra i binari del
  gioco si tolgono).
- Edifici accanto ai binari dei depositi (#66, 12 novembre). I binari dei depositi non entrano nella pianta delle
  strade, quindi la mappa non sa che lì ci sono: lo decide il gioco quando l'edificio arriva con la sua area
  (`City.depotRole` in `addBuildings`, binari in `city.yardSegs`, capi dei binari tronchi in `Y.deadEnds`). Rimessa:
  i binari ci finiscono dentro o ci passano con `tunnel=building_passage` (alla Guizza la way OSM 1430642570, a
  Voltabarozzo la 1453989052 con `depot=tram`, dove OSM non mette `building_passage`); `buildDepotShed(b, tile)` la
  disegna sulla pianta vera, capannone senza finestre alto da 7 a 9 m, pareti aperte a meno di 2,8 m dall'asse di un
  binario con l'architrave sopra 6 m, muri chiusi come ostacoli e in `b.muri`. La vecchia rimessa a scatola sui soli
  binari `building_passage` non c'è più. Sopra i binari o a meno di 2 m dall'asse, e non rimessa: l'edificio non si
  disegna (`city.depotDropped`; alla Guizza una pianta di Microsoft ML sull'anello sud che OSM non ha, la casa della
  segnalazione). Entro 6 m: edificio di servizio (`kind` 'industrial', tetto piano). Conteggio in
  `tests/mappa.spec.js` (`edifici_sui_binari_dei_depositi`, soglia 0). Un deposito nuovo con la rimessa in OSM la
  prende da solo, se i binari ci finiscono dentro; senza l'edificio nella mappa non c'è rimessa.
- Binari dei depositi secondo la regola (#70, 12 novembre). `scripts/tram_depositi.py` non copia più le way OSM: le
  stende con `scripts/tram_stesura.py` (rettilinei, clotoidi e archi, raggio di almeno 10,7 m, entro 1 m da OSM;
  metodo nella sezione 3 di [`binari-tram.md`](binari-tram.md)) e scrive i punti al millimetro. Le way restano quelle
  di OSM (id, servizio, galleria), quindi `TramYard` fa lo stesso grafo di prima (stessi nodi e rami); cambiano i punti,
  e i nodi degli scambi si spostano nella punta, che arretra sul binario che la porta (fino a 4 m). Da sapere:
  - i binari si stendono come catene di rami che continuano dritti; un ramo deviato si attacca alla catena che porta
    lo scambio (`ospite` in `stendi_deposito`), e dove due anelli si toccano in un nodo con quattro capi la seconda
    catena si stende in due pezzi tangenti lì. Due passate, perché alla Guizza c'è un giro (la catena lunga si attacca
    alla scala, la scala all'anello interno, l'anello tocca la catena lunga);
  - in `TramYard` alle porte (anche a quella a metà del binario di partenza di Voltabarozzo) il ramo parte dal binario
    della linea con un raccordo di Hermite di 15 m (`raccordo`, `RACC`) invece di saltare i punti OSM dei primi 6 m:
    i binari della linea nel gioco non stanno esattamente sulle way. Quando #69 porterà le linee sui dati secondo la
    regola, il raccordo diventa quasi dritto da solo;
  - nel controllo (`scripts/binari_tram.py`) i depositi si misurano sul grafo (`grafo_way` per i dati, i nodi di
    `TramYard` per il gioco): ogni ramo con 10 m dei binari che lo continuano (`oltre`), e la svolta tra le corde lunghe
    presa sulle finestre spostate fino a 5 m (`curve(S, esse=True)`), perché le S tra scambi vicini non contino come
    spigoli. I giunti di prima non ci sono più. Le linee si misurano come prima;
  - una sola eccezione, per gli scarti da OSM: la curva sud-ovest di Voltabarozzo, dove OSM ha un raggio di 6,4 m;
  - dopo una rigenerazione dei binari OSM (`data/osm-padova-tram*.json`) basta rilanciare `tram_depositi.py` e il
    controllo: `python3 scripts/binari_tram.py --elenco`, e nel gioco `tests/binari-tram.spec.js` e
    `tests/depositi-tram.spec.js`.
- Uscita da Voltabarozzo sul binario d'arrivo (#72, 12 novembre). Nello schema OSM e nella foto dall'alto dal deposito
  si arriva al binario d'arrivo con tre scambi: dove si uniscono i due anelli in fondo al deposito, l'anello esterno
  (way 1453989054, il binario ovest; parte sull'anello interno, verso la porta del binario di partenza); alla seconda
  comunicazione diritto (com'è alla partenza); fuori dalla porta la comunicazione del capolinea diritta. Il grafo era già
  così: il tram usciva sul binario d'arrivo, ma 70 m dopo la porta la comunicazione del capolinea, deviata, lo portava su
  quello di partenza, e dal deposito N girava solo gli scambi del deposito. Ora lo scambio che N gira lo dice
  `tramSwitchAhead` in `main.js` (anche in `__game`, per le prove): nel deposito, quando davanti non ci sono più scambi
  del deposito, anche quelli della rete presi di punta dopo la porta da cui si esce, con `Tram.yardLine` (il binario
  della linea dopo la porta, con la progressiva dove sarebbe il muso). Prova in `tests/depositi-tram.spec.js`
  ("Voltabarozzo: dalla rimessa sul binario d'arrivo…"), in Esplorazione e Giro libero.
- Deposito di Rubano: fermo dall'11 novembre, da decidere (#8, con i dati OSM e le strade possibili).

Verifiche: regola 3, guida con il pilota a ogni capolinea dei tram e nei depositi, foto dalla cabina agli scambi, tram
automatici per 40 minuti senza blocchi.

### Tram: freno d'emergenza (#62, 12 novembre)

Backspace o clic sul fungo rosso della cabina. Da sapere prima di toccare la cabina o i comandi del tram:

- stato nel `Tram` (`src/tram/tram.js`): `emergency`, che in `update` toglie la trazione e frena a 2,6 m/s² (prima
  `update` leggeva `input.emergency`, che nessuno impostava); `pressEmergency` lo inserisce e lo riarma solo a tram
  fermo; `obstacleAhead(world, dist)` cerca auto, bus e tram nella sagoma davanti al muso (`world.carsNear` e
  `projectNear` sul percorso) e la fine del binario; `mushroomHit(ray)` per il clic. In `main.js` `tramEmergency`
  (penalità di 50 punti in servizio, sopra 1,5 m/s, se non c'è un ostacolo entro lo spazio di una frenata a 1,3 m/s²
  più un secondo e 10 m) e `overMushroom` (clic e cursore a manina sul canvas, solo nella vista dalla cabina);
- il fungo (`fungo` del modulo di `buildModule`, con `userData.cap` che si abbassa quando è premuto) sta sulla plancia
  blu a sinistra dell'LCD, dove HUD e specchietto destro non lo coprono a 1280×720. Al posto di prima, a destra, era
  sotto lo specchietto;
- `renderer.render` in `main.js` sposta la telecamera della quota del terreno: il frustum culling di three.js guardava
  le posizioni senza, e gli oggetti piccoli a un metro dagli occhi sparivano dove la quota non è zero (alla Guizza è
  -1,1 m). Dal #81 il culling tiene conto della quota (`terrain.js`, nota in "Mappa"): fungo e schermo LCD (`dash`) non
  hanno più bisogno di `frustumCulled = false`. Nelle prove, col ciclo del gioco fermo, `frame` non avanza e `step` non
  ridisegna l'LCD (`drawDash` ogni 10 fotogrammi): per una foto dello schermo si chiama prima `bus.drawDash({})`;
- fuori dall'area: in `hud.js` e `index.html` l'icona 🛑 (`icon-emerg`, solo col tram) e la riga dell'aiuto. Prove in
  `tests/freno-emergenza.spec.js`.

### Tram: gong e clacson (#63, 12 novembre)

H suona il gong, Shift+H il clacson. Da sapere prima di toccare i comandi o i suoni del tram:

- sul `Tram` `gong` è il gong e `horn` il clacson; sul `Bus` `horn` resta il clacson. Li scrive `readInput` in `main.js`:
  Shift conta se è già premuto quando si preme H (`hornShift`), così chi sta suonando il gong e preme Shift per il gas a
  fondo non passa al clacson. Gamepad (clic della levetta sinistra) e touch danno solo H: sul tram il gong;
- in `audio.js` il clacson del tram ha la sua catena (`tramHornG`: due seghe a 554 e 659 Hz con un vibrato, passa banda
  a 1300 Hz), con lo stesso volume di quello del bus (RMS 0,14 contro 0,15 resi offline); il gong resta `tramBell`;
- `__game.audio` serve alle prove: nel browser delle prove il gioco è muto, e `tests/clacson-tram.spec.js` legge il
  volume chiesto alle catene (`setTargetAtTime`) e conta i rintocchi del gong.

### Tram: regola dei binari (#68, 12 novembre)

La regola per la stesura dei binari, con i numeri e le fonti (soprattutto il progetto del SIR3 di Italferr, 2020), è in
[`binari-tram.md`](binari-tram.md): raggio minimo 10,5 m ovunque, clotoidi di circa 10 m, interasse 3,00 m (SIR2
3,50 m) e mai sotto le fasce d'ingombro, scambi a cerniera di 4 m con R 10,5 m in rettilineo, pendenza fino al 6%. Da
sapere prima di toccare i binari:

- il controllo è uno solo, `scripts/binari_tram.py` (Python senza shapely): `verifica_mappa.py` lo usa sui dati degli
  script, `tests/binari-tram.spec.js` sui binari del gioco (li scrive in `test-results/<prova>/binari-gioco.json` e
  chiama lo script con `--gioco`). Le soglie dei dati sono `SOGLIE_BINARI` in `verifica_mappa.py`, quelle del gioco in
  testa alla prova; i punti peggiori con `--elenco`;
- i casi nelle zone di `ECCEZIONI` (il piazzale della stazione e i suoi raccordi, le curve che OSM disegna sotto i
  12 m, la curva sud-ovest del deposito di Voltabarozzo) si elencano a parte: una zona nuova va lì con il suo perché e
  nella sezione 4 di `binari-tram.md`;
- con i dati secondo la regola (#69, sotto) il gioco non ritocca più i binari delle linee: dati e gioco danno gli
  stessi numeri, tranne le S degli scambi ai capolinea (le disegna il gioco) e le pendenze (solo nel gioco);
- la prova del gioco legge `TramTrack.paths`, `TramTrack.terminals` (la S degli scambi con `off`, `toe`, `heel`),
  `TramTrack.h`, `stopsDir` e i nodi, i rami e le porte di `TramYard`: chi li cambia aggiorna `binari()` nella prova e
  `rete_gioco` nello script;
- i metodi di stesura sono due: `scripts/tram_stesura.py` (`stendi`: clotoide, arco, clotoide su una traccia OSM, con
  i capi liberi o tangenti a un altro binario) per i depositi (#70, nota in "Tram: scambi e depositi"),
  `scripts/binari_regola.py` (minimi quadrati, sotto) per le linee (#69), che hanno doppio binario e tratti in comune.

Binari delle linee secondo la regola (#69, 12 novembre). Da sapere prima di toccarli:

- `scripts/binari_regola.py` (numpy: il venv con shapely) rifà i due binari di una linea: traccia OSM ogni 0,5 m,
  tratti fissi (anelli e S del piazzale con `tram_stazione.su_anelli`, binari di un'altra linea già rifatta), doppio
  binario con asse e interasse costante a tratti, raccordo ai minimi quadrati con raggio almeno 12 m ed entro 0,8 m
  dalla traccia. Metodo e parametri nella sezione 3 di [`binari-tram.md`](binari-tram.md);
- l'ordine conta: `scripts/tram_linee.py` rifà SIR3 e poi SIR2 (agganciato al SIR3 verso Pace, con l'interasse del SIR1
  sui binari del SIR1) e scrive `data/tram-linee-nuove.json` (`regola: true`); poi `scripts/build_map.py` fa il SIR1
  (`sir1_binari`: percorso sui binari OSM di `data/osm-padova-tram-cantiere.json`, punti di passaggio dallo shape GTFS
  ogni 120 m sul binario a destra, tronchi fino all'inversione dello shape, `inversione`) agganciato ai binari di SIR2 e
  SIR3, e scrive `tram` e `tramRegola` nella mappa. Chi cambia una linea rigenera tutte e due;
- nel gioco, con `tramRegola` e `regola`: niente `smoothTrack`, `clearOfBuildings` e tronchi allungati in `padova.js`,
  niente `smoothLane` in `TramTrack`, che prende i vertici dei dati (`sampleV`); `snapShared` prende come tratto in comune
  solo quello che coincide entro 5 cm (`SHARE_REGOLA`); la S degli scambi ai capolinea è di due archi con raggio
  almeno 12 m (`R_COMUNICAZIONE`), e una comunicazione OSM più corta si allunga dalle due parti (cambiano `toe`, `heel`
  e `link`, non `fondo` né `other`);
- i dati sono più grandi: `tram` nella mappa 176 KB invece di 17, `tram-linee-nuove.json` 396 KB invece di 69 (punti
  fitti nelle curve, lat/lon a 8 decimali: con meno l'arrotondamento fa andare e venire l'interasse);
- il corridoio di celle attorno ai binari di SIR2 e SIR3 (`tram_corridors` in `build_map.py`) lo scrive
  `tram_linee.py` in `corridoio`, calcolato sulla traccia OSM dei percorsi come prima: dai binari rifatti (punti fitti,
  qualche decimetro più in là) cambiavano quattro celle, con le strade di Corso Irlanda e il rapporto dei cavalcavia.
  `corridor_cells` conta le celle ai punti del percorso e a passi di 62,5 m: sul percorso rifatto ne aggiungerebbe tre
  che il binario attraversa ((-13, -1), (-12, -5), (14, -7));
- nel controllo (`binari_tram.py`): le comunicazioni dei capolinea si misurano nel gioco (nei dati sono i due capi),
  con 10 m di binario della linea ai capi dei quali contano i 5 m vicino alla S (`CONTESTO`); nei 15 m dello scambio
  dove i due versi diventano un binario solo (Busa di Vigonza) l'interasse non conta; per le linee e le comunicazioni
  uno spigolo si misura anche contro la svolta in valore assoluto (le S: `assoluta` in `curve`, accanto a `esse` dei
  depositi); eccezioni nuove: i raccordi del piazzale (interassi) e le curve che OSM disegna sotto i 12 m (scarti e
  interassi);
- funzioni di altre aree cambiate da #69: in `TramTrack.terminal` (`tram-scambi`) la S è di due archi (sopra) e, per
  la S calcolata dove OSM non ha la comunicazione, l'altro binario conta come accanto se è in controsenso entro 37°
  invece che entro 25° (`beside`: a Busa di Vigonza, dove OSM ha un tronco solo, il binario di partenza si stacca dal
  tronco più ripido di prima e la S finiva prima delle banchine); in `TramSignals` (`traffico`) una strada che il tram
  incontra al nodo dell'incrocio e poi (o prima) affianca dentro la sua carreggiata non è un incrocio (a Pace la curva
  del SIR3 dalla corsia di Via Tommaseo alla sede lungo Via Gozzi tocca l'arco di Via Gozzi a 0,8 m dal nodo, e senza
  questo la lanterna di Via Tommaseo spariva); in `BusSim.move` (`traffico`) un bus non entra in un incrocio col tram
  se oltre i binari il semaforo non è verde e tra l'uscita e la linea d'arresto non ci sta (`rosso`, anche lontano dal
  giocatore, dove `full` non vale: alla stazione due bus fermi al rosso di Piazzale della Stazione restavano sui binari
  del SIR3, la fase tram restava tutto rosso e il tram aspettava loro, 19 tram fermi alle 8:30; su main lo stesso
  incastro può capitare, coi binari nuovi è capitato); in `tests/bivi-tram.spec.js` il bivio preso dopo il cambio cabina è quello del SIR3
  sull'anello esterno del piazzale (i tratti in comune sugli anelli ora coincidono), e la prova guarda l'altra linea del
  bivio invece del SIR2; le soglie di `tests/cavalcavia.spec.js`, `tests/linea-aerea.spec.js` e dei cavalcavia in
  `verifica_mappa.py` (binari: le rampe sono di #74).

### Tram: fermate dei capolinea (#99, 13 novembre)

Da sapere prima di toccare le fermate del tram o la zona della fermata:

- nel GTFS alcune corse del SIR1 finiscono con il capolinea due volte, a 3 minuti: la banchina d'arrivo e, dopo
  l'inversione, quella di partenza (verso Pontevigodarzere nello stesso punto, verso la Guizza a 3 m). `buildTramRoute`
  in `routes.js` toglie l'ultima fermata se ha il nome della penultima e sta a meno di 30 m; prima la metteva 30 m più
  avanti, sopra lo scambio. I dati restano com'erano (`tramLines` nella mappa, `v.stops` e `offsets`): `senzaTratti`
  in `turni.js` confronta i tratti con l'ora della seconda fermata e la sosta al capolinea comincia da lì (`r.end`).
  L'elenco delle fermate nel menu (`#stop-list`) mostra ancora le due righe;
- zona della fermata in `Mission` (`st.zone`, metri del muso dalla palina): da -12 a 10, all'ultima fermata del tram
  fino alla fine del binario (7033784). Ai capolinea con lo scambio il tram fermo non sta sulla comunicazione:
  `TramTrack.terminal` dà `span[d]`, il tratto del binario d dove c'è (su quello del campo da `toe` a `heel`,
  sull'altro il punto `link`), e `Mission` stringe la zona: all'arrivo il muso resta prima, alla partenza la coda è
  oltre (a Voltabarozzo, Rubano e Busa di Vigonza la zona di partenza comincia 4-6 m prima della palina invece di 12).
  Per farlo `Mission` legge dove comincia il percorso della corsa sul binario intero, `V.trackOffset`, che `main.js`
  scrive accanto a `V.trackPath`;
- chi supera la zona del capolinea fin sullo scambio non serve la fermata (porte aperte: penalità); il navigatore
  (`tramNav` in `main.js`) dice "Cambia cabina (B)" e, con la cabina girata, "Indietro N m, poi cambia cabina (B)";
- prove in `tests/turni-tram.spec.js`: "manovra al capolinea" (all'arrivo e alla partenza il tram fermo copre il punto
  della fermata, non sta sullo scambio e apre le porte senza penalità) e "capolinea superato fin sullo scambio". Il
  rilievo dei cinque capolinea (banchine OSM, fermate, scambi) è nel commento di chiusura di #99.

### Tram: pali accanto ai binari (#97, 13 novembre)

Segnalazione di chi gioca dopo un giro sul SIR1: pali e semafori in mezzo alla strada e sul percorso del tram. Il
controllo è `misuraPali` in `tests/pali.js`, nel rapporto di `tests/mappa.spec.js` (`pali_nella_sagoma_del_tram`,
`pali_del_tram_in_carreggiata`): ogni palo della linea aerea, lanterna del tram, segnale degli scambi, cartello del
pantografo, semaforo e lampione contro la sagoma del tram (centro sulla sede, o fusto a meno di 0,3 m dalla cassa, il
franco della UNI 7156 delle tabelle del SIR3; la cassa in curva va verso l'interno come in `Tram.syncTransform`) su
linee, S dei capolinea e depositi, e contro l'asfalto della pianta (tranne tra i due binari di una sede). Su `main` erano
14 nella sagoma e 488 in carreggiata (elenco nel commento dell'issue); ora 0 e 7, spiegati in testa a `mappa.spec.js`.

- `City.poleSpot(p, side, { min, max, along, clear, asfalto })`: il posto per un palo accanto al binario, il più vicino
  fuori dall'asfalto di 0,4 m, a più di `clear` da ogni binario di `city.tramLanes` (linee, depositi, S dei capolinea) e
  fuori dagli edifici vicini ai binari (`city.tramBld`, da `net.tramBuildings`). La usano segnali degli scambi (`place`
  in `buildTramway`, ora anche per i capolinea, entro 12 m), cartelli del pantografo (`city.panSigns`) e lanterne;
- linea aerea (`buildTramway`): `spanAnchor` cerca il palo fino a 24 m (prima 16; il progetto del SIR2 ha i pali dietro
  i marciapiedi di una strada di 24 m), fuori dalla sagoma di ogni binario (`fuoriSagoma`, depositi compresi: per questo
  `this.tramYards` si costruisce prima della linea aerea) e prima della facciata dietro; un tirante senza aggancio da un
  lato si sposta fino a 9 m lungo il binario; senza agganci ai due lati c'è il palo in mezzo se l'interasse lo lascia
  fuori dalla sagoma in curva (oggi nessuno), altrimenti il tirante va 6 m più avanti, fino a 54 m senza sostegno (90 m
  se il palo cadrebbe sulla sede di un'altra linea). I pali sul cordolo della sede non ci sono più. `city.tramPoles` ha
  anche la quota `h`. Pali da 1533 a 1647; `buildTramway` da circa 1,90 a 1,78 s (l'asfalto si guarda prima della
  distanza dalla sede del SIR1), triangoli uguali;
- restano in carreggiata 7 pali dove attorno c'è solo asfalto e nessun tirante vicino: il piazzale della stazione,
  l'incrocio tra la stazione e Via Tommaseo, la fermata di Via San Marco (4722, -1600), dove il palo starebbe sulla
  banchina del tram, che `poleSpot` non conosce (le banchine si disegnano in `buildTramway`, non sono nella pianta);
- mensole (tirante agganciato da un lato solo): da 223 a 74, ma la più lunga arriva a 27,4 m; c'erano già (19,6 m): #118.

### Tram: SIR2 e SIR3 (corsia `tram-reti`, chiusa il 9 novembre)

SIR3 e SIR2, tappe 1 e 2 del piano in [`linee-tram-nuove.md`](linee-tram-nuove.md), fatte:

- `scripts/tram_linee.py` scrive `data/tram-linee-nuove.json`: percorso per linea e verso sui binari OSM, fermate in
  ordine con la progressiva e il lato della banchina, moduli, orario generato.
- `src/tram/tram.js`: una sede per linea (`city.tramTracks[id]`, `city.tramTrack` resta il SIR1) e grafo dei binari:
  tratti in comune (`track.shared`) e scambi (`track.switches`), anello interno della stazione per SIR2 e SIR3.
  `TramSim` e `TramSignals` in `traffic.js` lavorano su tutte le sedi.
- Nel menu SIR3 e SIR2 stanno nell'elenco del SIR1 con la scritta "in costruzione"; si guida il tratto in città
  (SIR3 fino a Cornaro, SIR2 da Cimitero Maggiore a Savelli). La linea 10 resta tra gli autobus.
- Le tappe 3 e 4 (sede nella pianta delle strade, area di Voltabarozzo) sono richieste alla corsia `mappa`, nella sua
  sezione.

### Segnalazioni di chi gioca (corsia `segnalazioni`, chiusa il 9 novembre)

Le richieste arrivate da chi gioca (IDEE, prossimi passi 5). Fatto:

- Navigatore: manovre calcolate una volta per percorso (`routeManeuvers` in `routes.js`, usate da `navInfo` in
  `mission.js`, frasi in `hud.js`): svolte solo agli incroci, bivi, rotatorie con il numero dell'uscita,
  inversioni. `buildRoute` toglie le andate e ritorni senza fermate. Sulla 13 e sulla 25 il navigatore ora va; sulla
  22 verso Mandria il percorso resta sbagliato per i dati (richiesta nella sezione `mappa`).
- Passeggeri sugli altri autobus (`src/world/buses.js`): a bordo, visibili dai finestrini, e alle fermate dove i bus
  automatici si fermano vicino al giocatore. `Crowd` di `mission.js` è esportata e la usano tutti e due.
- Piazzale della stazione: controllo linea per linea in [`piazzale-stazione.md`](piazzale-stazione.md). Nel codice
  del gioco solo le paline delle corsie parallele (`allStopPlacements`); il resto sono dati, chiesti nella sezione
  `mappa`.

Le altre voci delle segnalazioni (zona Plebiscito, cavalcavia e fiumi, mappa più grande) sono dati della mappa:
corsia `mappa` e onda 3.

Dopo la chiusura i dati del piazzale sono stati sistemati dalla sessione cloud (vedi la sezione `mappa`).

