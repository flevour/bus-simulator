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
     `main` (rete e aree) e si rigenera con `scripts/rigenera_mappa.sh`. La mappa si pubblica intera, come esce dal
     comando: niente composizioni a mano con le sole celle della zona toccata (nota Verifiche, #106);
   - `src/data/padova-arredo.json` (posa dell'arredo, #109): si prende quello di `main` e si rifà la posa sulla mappa
     del rebase (`npm run posa -- --zona X,Z,R` con la zona del proprio ticket, o `--tutta` se la mappa è rigenerata).
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
| `src/data/padova-map.json`, `public/mappa/aree/` | i ticket che rigenerano la mappa, uno alla volta | la rete (una riga sola da 5,9 MB) e le aree da 800 m (edifici, marciapiedi, verde, alberi) le scrive `build_map.py`: due rigenerazioni non si uniscono, si prende la mappa di `main` e si rigenera (regola 4); il job `rigenera` è rosso se la mappa del commit non è quella che esce da `scripts/rigenera_mappa.sh` |
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
| `scripts/quote_rete.py`, `scripts/profili_strutture.py`, `data/profili-cavalcavia.json`, `tests/profili.spec.js` | `area:mappa`, e chi cambia le quote dei binari (`area:tram`) | quote che il gioco legge per arco e per binario e profili per struttura ([`cavalcavia.md`](cavalcavia.md), sezione 7): chi cambia le quote di una struttura riscrive il file dei profili (`--aggiorna`) e la nomina nel commit |
| `scripts/cavalcavia.py`, `tests/cavalcavia.spec.js`, `data/eccezioni/cavalcavia.json` | `area:mappa` (#84 i cavalcavia), `area:tram` (#74 le rampe del tram) | regola e controllo del profilo dei cavalcavia ([`cavalcavia.md`](cavalcavia.md)): chi cambia quote, terreno o quote dei binari toglie dall'elenco i casi corretti (`--aggiorna`); usa `binari_tram.Griglia` e `raggruppa` |
| `scripts/osm_rete.py`, `data/osm-padova-relazioni.json`, `data/osm-luoghi.json`, `data/osm-arredo.json`, `data/eccezioni/osm-rete.json` | `area:mappa` (#108), poi chi li usa: `area:traffico` (#112, #111, #116) | dati OSM agganciati alla rete per id ([`osm-dati.md`](osm-dati.md)); chi cambia nodi o archi della rete, o riscarica le relazioni, riscrive i campi (`python3 scripts/osm_rete.py --scrivi`) e l'elenco |
| `src/world/posa.js`, `src/data/arredo.js`, `src/data/padova-arredo.json`, `scripts/posa_arredo.mjs`, `scripts/citta_node.mjs` | `area:mappa` (#109, poi #130 e #132); chi cambia mappa, binari o pianta rifà la posa | posa dell'arredo nella build: semafori, linea aerea, lanterne e segnali del tram, paline (nota #109 della Mappa). Il file si riscrive con `npm run posa -- --zona X,Z,R` nello stesso commit della modifica che sposta i pali; `tests/arredo.spec.js` fallisce se non è quello che la posa dà |
| `scripts/sosta.py`, `data/eccezioni/sosta.json`, `data/eccezioni/sosta-gioco.json`, `tests/sosta.spec.js` | `area:mappa` (#111), poi `area:traffico` (#113) per le zone di fermata | sosta lungo le strade ([`sosta.md`](sosta.md)): stalli per arco e per lato e corsie strette dagli stalli (`stalli`, `sedeCorsie` nella mappa). Chi cambia fermate, corsie, pianta o il modo in cui i bus accostano rigenera e guarda i due controlli; `corsie_arco` di `scripts/raccordi.py` è il conto delle corsie anche per la sosta |
| `scripts/raccordi.py`, `data/eccezioni/raccordi.json`, `tests/raccordi.spec.js` | `area:traffico` (#112), poi chi li usa (#113, #114) | raccordi di corsia agli incroci ([`raccordi.md`](raccordi.md)): la build li calcola dalla rete, dalle corsie, da `svolte` e dalla pianta delle strade, quindi cambiano con ogni rigenerazione che tocca una di queste; chi rigenera rilancia `python3 scripts/raccordi.py` e, se i casi cambiano, `--aggiorna`. `corsie_arco` rifà `laneLayout` di `src/data/padova.js`: le due si cambiano insieme, e così `cambio_min` e `costoCambio` di `src/world/inseguitore.js` (rotonde senza uscita, #143) |
| `scripts/percorsi.py`, `data/eccezioni/percorsi.json`, `data/osm-correzioni.json`; in `scripts/build_map.py` `ripara`, `giro`, `via_bus` | `area:linee` (#114), e chi rigenera la mappa | percorsi delle linee guidabili ([`percorsi.md`](percorsi.md)): la build li controlla alla fine e si ferma su un caso nuovo; chi cambia rete, svolte, corsie, pianta o raccordi guarda i casi con `python3 scripts/percorsi.py --elenco` e, se restano, li mette nell'elenco con il perché (`--aggiorna`). Un tag OSM sbagliato si corregge con una riga di `data/osm-correzioni.json`, non nel codice |
| `src/world/inseguitore.js`, `tests/moto.js`, `tests/moto.spec.js`, `data/eccezioni/moto.json` | `area:traffico` (#113, #115), poi chi tocca corsie, raccordi o percorsi dei bus (#114, #134, #111) | inseguitore di percorso di auto e bus automatici ([`raccordi.md`](raccordi.md), sezione 7), con chi segue chi e l'incrocio da liberare (`idm`, `incrocioDavanti`, sezione 8), e prova del moto: chi cambia `laneLayout`, i raccordi o il modo in cui i mezzi scelgono la strada rilancia `tests/moto.spec.js`; i casi sui ripieghi spariscono quando le svolte hanno il loro raccordo, e vanno tolti dall'elenco nello stesso commit |
| `tests/code.js`, `tests/code.spec.js`, `data/eccezioni/code.json` | `area:traffico` (#115), poi chi cambia chi segue chi, sblocchi, precedenze o il numero di auto (#49, #50, #116, #117) | prova delle code: corridoio di Via Querini (flusso contro densità, scarico al semaforo), incrocio da liberare, dieci minuti senza sblocchi a tempo, incroci bloccati e fermi oltre 120 s. Chi cambia il traffico la rilancia; un caso sparito si toglie dall'elenco nello stesso commit |
| `scripts/domanda.py`, `scripts/pendolari.py`, `src/data/padova-domanda.json`, `src/world/domanda.js`, `tests/domanda.js`, `tests/domanda.spec.js`, `scripts/gtfs_tempi.py`, `data/eccezioni/punte.json`, `data/istat-pendolari.json`, `data/osm-comuni.json`, `data/osm-strade-fuori.json` | `area:traffico` (#116, #147), poi #117, #159 e chi cambia rete, raccordi, edifici o sosta | domanda di traffico ([`domanda.md`](domanda.md)): la build scrive zone, porte, tempi, destinazioni, curva oraria e l'assegnazione per fascia; il file dipende da rete, raccordi ed edifici delle aree, e chi rigenera la mappa lo rifà nello stesso commit (`python3 scripts/domanda.py`, in fondo a `rigenera_mappa.sh`; `verifica_mappa.py` controlla che sia quello che esce). Non è locale: l'assegnazione sposta i flussi anche lontano |
| `scripts/localita.py`, `data/localita.json`, `data/eccezioni/localita.json`; in `scripts/street_surfaces.py` `unione`, `partizione`, `canonico`, `anelli_canonici` | `area:mappa` (#139), e chi scrive un passo della build | località della mappa: rapporto a fine rigenerazione e prova (job `localita`, nota #139 della Mappa). Un passo che lavora su tutta la città usa `unione` e semplifica per riquadro; un caso nuovo della prova si capisce prima di metterlo nell'elenco |
| `tests/impronta.json`, `tests/impronta.js`, `tests/impronta.spec.js` | chi cambia traffico, bus o tram automatici, mappa o linee (#145) | impronta del traffico di una corsa, ai bit, uguale su Mac e in CI (nota #145 delle Verifiche): chi la cambia di proposito la riscrive nello stesso commit con `IMPRONTA=aggiorna npx playwright test tests/impronta.spec.js`; se in CI è diversa da quella del Mac, l'esito dipende dalla macchina e la causa va trovata |
| `data/conto-aree.json` | i ticket che rigenerano la mappa | conto degli oggetti per area, scritto da `aree_mappa.py` con le aree: in un rebase si prende quello di `main` con la sua mappa e si rigenera, come per le aree |
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
- Mappa riproducibile (#106, 13 novembre): la mappa si rigenera con `scripts/rigenera_mappa.sh`, che lancia
  `scripts/rigenera_mappa.py` dentro un'immagine Docker fissata (Linux, Python 3.12) con le librerie di
  `scripts/requirements-mappa.txt` (shapely 2.2.0, numpy 2.5.4, scipy 1.18.1, pyarrow 26.0.1, con gli hash) e il feed GTFS di
  `data/gtfs-biv.zip`, scaricato il 9 novembre. Misure del 13 novembre, con lo stesso lock e gli stessi dati: Linux
  amd64, Linux arm64 e Linux con glibc 2.31 invece di 2.41 danno gli stessi file, byte per byte; macOS dà 115 celle
  della rete e 20 aree diverse (vertici spostati di 0,1-0,3 m, binari di 1 mm), per questo dal Mac si passa da Docker;
  shapely 2.1.2 dà altre differenze ancora. Il feed vivo cambia ogni giorno (cinque zip diversi tra il 9 e il 13
  novembre) e le date di riferimento di `build_gtfs.py` (`FER_DATE`, `FES_DATE`) escono dal feed: con quello del 13
  novembre il SIR1 restava senza corse feriali. Lo script si ferma se sistema, Python o librerie non sono quelli
  fissati (`--altre-versioni` per le prove). Il job `rigenera` di `verifiche.yml` gira nella stessa immagine, lancia
  `rigenera_mappa.py --controlla` (rigenera in una cartella temporanea e confronta rete e aree con quelle del commit)
  ed è rosso se differiscono, quindi ferma la pubblicazione: chi cambia uno script della mappa o un file di `data/`
  rigenera e pubblica la mappa nello stesso commit, intera. Dura circa 7 minuti accanto alle prove, che ne durano di
  più. Il job `mappa` usa lo stesso lock. Cambiare librerie, immagine o feed: in testa ai due script, sempre con la
  mappa rigenerata nello stesso commit.
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

### Verifiche: stato di partenza e tempi delle prove (#122, 13 novembre)

Tre serie di Verifiche di fila sono finite rosse senza che il gioco fosse cambiato, ogni volta con prove diverse. Le
cause erano due.

- **La stessa corsa non era la stessa.** Il meteo del menu è "Variabile": `updateWeather` estrae con `Math.random`
  quando piove o scende la nebbia, e con l'asfalto bagnato chi guida frena prima, quindi bus, tram e semafori si
  incontrano in un altro ordine. Due pagine nuove davano due corse diverse dalle 8:29 in poi. In più tre cose restavano
  sulla pagina da una corsa all'altra (ogni worker apre il gioco una volta): `BusSim.rnd` continuava dalla corsa prima
  (fermate servite, passeggeri, soste dei bus automatici), `TrafficLights.tramCall` sposta il ciclo di un semaforo a
  ogni passaggio di un tram, e chiamate e via libera di `TramSignals` restavano com'erano. Quindi l'esito dipendeva da
  quali prove erano passate prima sullo stesso worker.
- Ora `startMission` rimette tutto allo stato di partenza: `lights.reset(clock)` (cicli della costruzione, `offset0`),
  `tramSignals.reset()`, e `BusSim.setService` risemina la sua sequenza. `avviaCorsa` mette il sereno (parametro
  `meteo` per chi vuole pioggia o nebbia). Misura: la corsa della 3 delle 8:27 fino a Garibaldi giardini, con le
  posizioni di chi guida, dei bus, dei tram e delle auto ogni 30 s di gioco per 36 minuti, è uguale al decimetro da
  pagina nuova, dopo una corsa in tram, dopo una in bus e dopo 10 minuti di tram agli incroci di Riviera Tito Livio, sul
  Mac e su Linux in Docker.
- Chi scrive una prova che dipende dal traffico parte da `avviaCorsa` e non tocca `Math.random`: restano fuori dalla
  sequenza fissata solo cose che non spostano i mezzi (colori dei passeggeri, suoni, saluti) e quali aree della città
  sono già arrivate, che dipende dal tempo vero.
- **I tempi massimi erano a ridosso delle durate.** Sui processori della CI, con due worker, la stessa prova dura fino
  al 40% in più da una serie all'altra (quattro serie del 13 novembre: incroci semaforizzati da 234 a oltre 300 s con
  il limite a 300, Tito Livio da 366 a oltre 480 con il limite a 480, i turni dei tram automatici da 234 a oltre 300).
  Le prove lunghe usano `tempoMassimo(secondi)` di `tests/gioco.js`: tre volte la durata più lunga vista in CI. Chi
  aggiunge una prova da più di un minuto guarda quanto dura in CI (`gh run view <serie> --log`) e fa lo stesso. Il job
  `prove` ha 60 minuti (le serie durano da 21 a 34). Con lo stato di partenza fissato le prove fanno sempre lo stesso
  lavoro, ma la macchina che tocca in CI conta più del 40%: nelle quattro serie del 16 novembre (4cb1cb8, e9b4f2a,
  832abd0, bf4f044) Tito Livio dura 630, 300, 540 e 510 s, i turni dei tram 444, 222, 366 e 336 s, i segnali del tram
  414, 192, 348 e 306 s. I valori di `tempoMassimo` sono i più lunghi di queste serie, quindi il limite è almeno il
  triplo anche sulla macchina più lenta vista.
- **Il job `prove` oltre i 60 minuti (#121, 19 novembre).** Con la domanda di #116 le serie sono passate a 40-50
  minuti, e la stessa serie va da 40 a oltre 60 minuti secondo la macchina: 2f8e820 40,5 il 18 e 50,6 il 19, 2618bf2
  annullata tre volte al limite con tutte le prove verdi. Le prove non sono cambiate di durata per i commit di quei
  giorni (misure A/B di #126). Le prove si sono accorciate senza togliere controlli:
  - il HUD (minimappa, quadro, pannelli) si disegnava a ogni passo di `step`, anche in `sim` senza disegno: un quarto del
    tempo delle prove. Ora `drawHud` di `src/main.js` va una volta per fotogramma e alla fine di `sim`; il pilota di
    `tests/guida.js`, che chiama `sim` a ogni passo, passa `hud` false;
  - `TramSim.move` scartava le auto e i bus oltre 40 m dal muso solo dopo averli messi in elenco, per ogni tram e a ogni
    passo: ora li scarta prima, con la stessa condizione;
  - gli incroci semaforizzati sulla sede e i segnali del tram facevano gli stessi 20 minuti di gioco dallo stesso stato
    in due prove: ora una sola simulazione (`contaIncroci` con `segnali`).

  `tests/impronta.spec.js` è rimasta uguale ai bit: le modifiche non cambiano il traffico. Misura sul Mac, 120 s di gioco
  in Via Altinate senza disegno: da 15,3 a 9,4 s. Chi aggiunge lavoro a ogni passo che non serve alla simulazione (disegno,
  statistiche) lo mette in `drawHud` o in `render`, non in `step`; chi guarda tutti i mezzi della città da ogni mezzo
  scarta prima quelli lontani.
- La prima serie in CI con le prove del traffico verdi (4cb1cb8) è finita rossa per una veduta: al capolinea Stazione
  sud del SIR3 una colonnina di ricarica lasciata da una corsa in servizio di prima (`Chargers` ne tiene sei nella scena,
  ai capolinea delle ultime corse). Con le prove che non scadono più i worker non ripartono, e le vedute arrivano su una
  pagina con più storia. `preparaVedute` ora toglie le colonnine. Chi aggiunge alla scena un oggetto che resta da una
  corsa all'altra lo toglie lì.
- **Fermi oltre un ciclo: per caso.** Con la corsa fissata la prova di Tito Livio trova sempre lo stesso fermo oltre i
  60 s: il bus della 22 a (42, 106), in coda dietro un bus della 16 che sosta fino all'orario alla fermata di Riviera dei
  Ponti Romani (#127). Il limite resta 60 s: il caso sta in `data/eccezioni/traffico.json` con il perché, un altro fermo
  oltre i 60 s fa fallire la prova, e quando #127 lo toglie va tolto dall'elenco
  (`ECCEZIONI=aggiorna npx playwright test tests/traffico.spec.js`).
- Per rifare il confronto su Linux: copia del worktree senza `node_modules` in una cartella sotto `/private/tmp`,
  `docker run --rm --cpus=4 --ipc=host -e CI=1 -v <copia>:/lavoro -w /lavoro mcr.microsoft.com/playwright:v1.65.0-noble`
  con `npm ci` e poi `npx playwright test`: il setup delle prove compila e serve il gioco dentro il container. Senza
  `--platform` su questo Mac l'immagine è arm64: la CI è amd64 (nota #145, sotto).

### Verifiche: storia della pagina e impronta del traffico (#145, 17 novembre)

Dal 17 novembre quattro serie di Verifiche di fila sono finite rosse sulle prove del traffico: in CI `code.spec` (e una
volta Tito Livio) trovava un caso in meno o in più di quelli scritti sul Mac. La causa non era la macchina:

- **Misura.** La prova dei dieci minuti di `code.spec` (18.000 passi) con un'impronta dello stato a ogni passo
  (posizione, direzione e velocità di auto, bus, tram e chi guida, ai bit), su una pagina nuova, dà su Mac arm64 e su
  Linux amd64 (Docker, lo stesso Chromium della CI) gli stessi casi e lo stesso stato finale. Sul Mac, sulla stessa
  pagina dopo la prova dell'incrocio, dà esattamente l'esito della CI. In CI i worker sono 2: la prova dei dieci minuti
  partiva subito dopo quella dell'incrocio, mentre il corridoio occupava l'altro worker; sul Mac, con 3 worker, quasi
  sempre su una pagina nuova.
- **Causa.** `corridoio()` di `tests/code.js` sostituisce `g.lights.stateOf` per forzare il semaforo di Via Querini, e
  i semafori (come tram, segnali del tram, bus automatici e città) restano da una corsa all'altra: dopo la prova
  dell'incrocio il semaforo restava verde per sempre, e i bus automatici che ci passano cambiavano il resto del
  traffico. `startMission` rimette lo stato dei semafori (#122), non le funzioni che una prova ha messo al posto delle
  loro.
- **Ora.** `apriGioco` fotografa le funzioni di `__game`, `lights`, `trams`, `tramSignals`, `buses`, `city`, `net`,
  `hud`, `audio` e `chargers`, e a fine prova il fixture `pagina` di `tests/gioco.js` (`ripristinaFunzioni`) toglie i
  metodi sostituiti sugli oggetti e rimette le funzioni di `__game` (anche dopo una prova fallita, quando gli
  osservatori di `code.js` e `moto.js` non arrivano a `fine()`). Chi guarda il gioco sostituendo una funzione di un
  altro oggetto che resta tra le corse lo aggiunge lì; chi cambia lo stato (non le funzioni) di questi oggetti lo
  rimette da sé.
- **Impronta del traffico** (`tests/impronta.spec.js`, `tests/impronta.js`). La corsa della 3 delle 8:15, un minuto
  in ognuna delle tre zone della prova del moto, un'impronta ogni 10 s, uguale a quella scritta in
  `tests/impronta.json`; poi un tram del SIR1 per un minuto e di nuovo la stessa corsa, che deve dare la stessa
  impronta. Chi cambia di proposito traffico, bus o tram automatici, mappa o linee la riscrive nello stesso commit
  (`IMPRONTA=aggiorna npx playwright test tests/impronta.spec.js`) e la serie in CI dice se su Linux è la stessa.
- **Regola degli elenchi del traffico** (`code.json`, `moto.json`, `traffico.json`): resta quella di #105 (regola 12).
  Gli elenchi si scrivono sul Mac e valgono in CI perché l'esito è lo stesso, e l'impronta lo controlla a ogni serie;
  un caso noto che non si presenta fa fallire la prova come prima, perché vuol dire che il traffico è cambiato. I casi
  delle prove di dieci minuti compaiono e spariscono a ogni piccolo cambiamento del traffico (#113, #115, #139): chi lo
  cambia rilancia le tre prove e riscrive gli elenchi nello stesso commit, con il perché.
- **Se una prova del traffico è rossa solo in CI.** Prima l'impronta della stessa serie: rossa in CI e verde sul Mac
  vuol dire che l'esito dipende dalla macchina, e la riga che cambia per prima dice zona e secondo da cui guardare;
  verde, vuol dire che la prova ha trovato la pagina in un altro stato. Nel log della serie si guarda quale prova è
  girata prima sullo stesso worker (in `list` le prove escono in ordine di fine, con il numero di partenza) e la si
  rifà sul Mac in quell'ordine sulla stessa pagina. Non si riscrive l'elenco dall'esito della CI.
- **Funzioni matematiche.** Nel Chromium delle prove (158, Playwright 1.65.0) `sin`, `cos`, `tan`, `atan`, `atan2`,
  `exp`, `log`, `acos`, `asin`, `hypot` e `sqrt` danno gli stessi bit su Mac arm64, Linux arm64 e Linux amd64
  (200.000 ingressi per funzione). Cambiano tra arm64 e amd64 `Math.pow` e `**` con esponente non intero e anche con
  esponente 4 (343 volte su 200.000 tra 0 e 2,5; con esponente 2 mai), e `tanh` tra macOS e Linux. L'IDM delle auto
  aveva `Math.pow(v / v0, 4)`: con la pagina pulita le impronte di Mac e Linux erano uguali alla fine dei dieci minuti
  ma diverse in 316 passi su 18.000, a tratti brevi, per la velocità di un'auto diversa all'ultimo bit (al passo 1.069
  `8.292327961177511` sul Mac, `8.29232796117751` su Linux) che poi tornava uguale; con un'auto al limite di una regola
  avrebbe cambiato l'esito. Ora `idm` e `Traffic.update` fanno le potenze con le moltiplicazioni, e le impronte dei
  dieci minuti su Mac e Linux amd64 sono uguali a tutti i 18.000 passi (stessi casi di prima). Nella simulazione
  niente `Math.pow`, `**` con esponenti diversi da 2 e `tanh`. In Node 22 cambiano anche `cos`, `tan`, `asin` ed
  `expm1` tra arm64 e amd64: gli script in Node che devono dare gli stessi numeri su Mac e Linux (posa dell'arredo)
  non vanno confrontati ai bit.
- **Su Linux amd64 dal Mac.** Immagine leggera: `FROM node:22-slim` e
  `RUN npx -y playwright@1.65.0 install --with-deps --only-shell chromium`, costruita con
  `docker build --platform linux/amd64` (circa 1 GB, invece dei 7 di quella di Playwright). Una prova come in CI:
  copia del worktree senza `node_modules` sotto `/private/tmp`, `docker run --rm --platform linux/amd64 --ipc=host
  --cpus=4 -v <copia>:/lavoro -w /lavoro <immagine> sh -c 'npm ci && CI=1 npx playwright test --workers=2 <prova>'`.
  In emulazione la città si carica in 80 s e i dieci minuti di `code.spec` durano 5 minuti. Il container non vede i
  posti di `tests/posto.js`: lo si lancia da uno script che prende un posto e lo libera alla fine.

### Mappa (corsia `mappa`)

Issue: `area:mappa`.

Rigenera la mappa (`scripts/rigenera_mappa.sh`, comandi in `CLAUDE.md`), una rigenerazione alla volta con le altre
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
  `gtfs_cover`. `drop_spurs` toglie già nei dati i tratti A-B-A senza fermata, `ripara` (#114) i contromano, le
  inversioni e le svolte vietate ai bus rimasti, e `buildRoute` (`src/game/routes.js`) non ne trova più;
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
  sotto la strada che segue (la media delle quote dei binari, da #107 in `scripts/quote_rete.py`); l'asfalto in quota è suddiviso ogni 20 m in
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
  tenendo i campi a mano) o se una rampa con le quote di prima entra in una struttura attiva. Un cavalcavia con le
  quote di prima accanto a una struttura attiva tiene il suo terreno (#123, nota sotto): fino a #123 la build si
  fermava se le passava a meno di 120 m;
- `street_surfaces.py`: `quote_arco` e `quota_arco` danno la quota lungo un arco (profilo, zero per gli altri archi
  delle strutture attive, lineare tra i nodi per il resto); le usano `surfaces`, `decks` e `_tram_heights`.
  `overpass_heights` salta gli archi delle strutture attive, `terrain_for_game` non spiana sotto di loro;
- nel gioco: `edgeHeight` legge `e.hs` (da `MAP.edgeH`), `Terrain` applica `terrain.via`. Le quote dei binari sulle
  strutture attive, senza media, le scrive la build da #107 (nota sotto): serve a #123;
- le rampe delle strutture attive sono archi a terra su un rilevato del terreno: hanno marciapiedi, strisce e fermate
  come le altre strade. Restano in quota le campate e gli ultimi 40 m prima;
- la mappa pubblicata è quella di `main` con, dalla rigenerazione, `nodeH`, `edgeH`, `cavalcavia`, `terrain`,
  impalcati e asfalto in quota, e le celle da 200 m entro 200 m dalle strutture attive (147 celle della rete, 25
  aree). #106 dirà se sostituirla tutta;
- gli alberi sparsi del gioco cambiano posto in tutta la mappa quando cambia il numero degli archi in quota: le vedute
  lontane dai cavalcavia cambiano di qualche decina di pixel.

#108, dati OSM oltre le vie (13 novembre). Formati, numeri e copertura in [`osm-dati.md`](osm-dati.md). Da sapere:

- `data/osm-padova.json` resta quello del 4 novembre. Relazioni, luoghi e arredo stanno in file accanto, con query e
  filtro in `scripts/`; si possono riscaricare quando si vuole, le vie no;
- la rete non porta gli id di OSM: `osm_rete.Aggancio` li ritrova da coordinate dei nodi, classe, nome e senso unico
  degli archi. `build_map.py` tiene la via vera di ogni arco (`edge_way`) e si ferma se `Aggancio` non dà la stessa.
  Chi cambia come nascono nodi e archi (`rdp`, nodi tenuti, vie saltate) lo vede lì;
- nella rete, dopo `turnLanes`: `svolte`, `sosta`, `rilevati`, `pendenze`, `fondo` (80 KB in tutto). Un arco va da `a`
  a `b` nel verso della via OSM, e destra, sinistra e salita sono riferite a quel verso. Il gioco non li legge ancora;
- `python3 scripts/osm_rete.py --scrivi` riscrive quei cinque campi nella mappa che c'è e non tocca altro;
  `scripts/verifica_mappa.py` (e la CI) fallisce se i campi della mappa non sono quelli che danno gli scarichi, quindi
  chi pubblica una rete con nodi o archi diversi li riscrive nello stesso commit;
- i casi noti sono in `data/eccezioni/osm-rete.json`: 82 svolte che toccano la rete e non si agganciano (nessuna per
  vie cambiate dopo lo scarico), una svolta che va dalla parte opposta a quella del suo tipo, 3 passaggi dei percorsi
  dei bus su una svolta vietata (la 4 al Piazzale Castagnara, la 15B a Largo Europa: #114);
- Overpass: quando `overpass-api.de` risponde 502, `https://maps.mail.ru/osm/tools/overpass/api/interpreter` ha
  risposto; user agent generico.

#107, quote lette per arco e per binario (13 novembre). Regola e formato in [`cavalcavia.md`](cavalcavia.md), sezione
7. Da sapere:

- il gioco non cerca più le quote per vicinanza. `edgeH` ha tutti gli archi in quota (il profilo per le strutture
  attive, i due capi per gli altri cavalcavia) e `tramH` il profilo di ogni binario lungo la progressiva dei dati: li
  scrive `scripts/quote_rete.py`, che `build_map.py` chiama alla fine e che con `--scrivi` li rifà nella mappa che c'è
  senza rigenerarla. `nodeH` resta nella mappa per gli script, il gioco non lo legge;
- tolti dal gioco: `City.heightAt(x, z, cur)`, `City.nearElevatedHeight` e `nearProfile`, `TramTrack.setHeights` e
  `TramTrack.h`, `markOverpasses` e `e.decl` in `padova.js`. `edgeHeight` e `profileAt` stanno in `src/data/padova.js`
  (`city.js` riesporta `edgeHeight`). Per costruire la scena resta `City.elevHeight(x, z)`;
- il bus di chi guida: `bus.assi`, due stati `{ e, s, q }` (arco, progressiva, quota) tenuti da `City.quotaSotto` in
  `step` di `main.js`; `bus.elev = undefined` (dopo un teletrasporto) li azzera e si riparte dalla strada più alta lì
  sotto. Chi sposta il bus con `bus.place` senza azzerare `bus.elev` lascia gli assi sull'arco di prima: al passo dopo
  non lo trovano più e lo ricercano con la quota di prima (`City.arcoIn`);
- fuori dalla mia area. In `tram.js`: `TramTrack.heightAt` legge `hp` (il profilo del binario sulla progressiva del
  percorso), `ds` è la progressiva dei dati a ogni vertice del percorso, `pathS(dir, D)` porta una progressiva dei
  dati su quella del percorso, `heights(dir, passo)` dà le quote per le prove; `opts.da` è la progressiva dei dati al
  primo punto dei binari delle linee nuove (`da` in `NEW_TRAM_LINES`, che li taglia con `polyCut`). I binari non
  secondo la regola (`regola` falso, oggi nessuno) restano a terra: chi li rimette deve dare a ogni punto la sua
  progressiva dei dati. In `traffic.js`: `Traffic.carHeight` (quota dell'auto dal suo arco; in curva tra `h0` e `h1`
  di `turnPath`, da #113 tra le quote dei due capi del raccordo, `Curva.quota` di `inseguitore.js`), i pedoni con `edgeHeight(p.e, p.s)`. In `city.js` i tratti della sede del tram nella griglia
  (`indexFeatures`) portano in `ref` il profilo del loro binario (`onSede`). `__game.edgeHeight` per le prove;
- la quota dei binari sui cavalcavia con le quote di prima ha ancora la media che faceva il gioco, ora in
  `quote_rete.profilo`: a 5 m di passo è uguale a quella di prima entro 2 cm, le vedute non cambiano. Sulle strutture
  attive il binario prende la quota assoluta della strada, punto per punto. Provato accendendo in memoria Borgomagno,
  Chiesanuova, San Marco, Via Venezia e Dalmazia: binari fuori quota da 28 a 0, restano onde lievi e pendenze tra 6 e 9,6% (#123);
- `data/profili-cavalcavia.json`: i profili per struttura. Chi cambia quote, terreno o registro dei cavalcavia lancia
  `python3 scripts/profili_strutture.py --aggiorna` e nomina nel commit le strutture che il diff tocca; senza, fallisce
  `tests/profili.spec.js`, che ha anche il pilota sopra gli 11 cavalcavia dove passa una linea (quota letta entro
  5 mm da quella del file; i tre gradini che si vedono al cambio d'arco, dove il terreno non è uguale su tutta la
  larghezza, sono in `data/eccezioni/profili-pilota.json`);
- `scripts/cavalcavia.py` legge le quote come il gioco (`edgeH` per tutti gli archi, la frazione dell'arco per
  l'ultima progressiva scritta; `tramH` per i binari nei dati): al millimetro cambiano, e il punto peggiore di cinque
  casi delle strade si è spostato di più di 4 m (elenco aggiornato). I casi dei binari nei dati sono ora quelli del
  gioco;
- la mappa è quella di `main` con `edgeH` e `tramH` nuovi: nessuna cella e nessuna area cambiata.

#109, arredo posato dalla build (16 novembre). Semafori e ripetitrici, tiranti, mensole e pali della linea aerea,
lanterne del tram, segnali degli scambi, cartelli del pantografo e paline non si cercano più il posto al caricamento:
li mette una volta il posatore e il gioco li legge. Da sapere:

- i pezzi. `src/world/posa.js`: `SpazioLibero` (fuori dall'asfalto della pianta, dalla sagoma di tutti i binari, dagli
  edifici di tutta la mappa) e `Posatore`, con le ricerche che prima stavano in `TrafficLights.placeApproach`,
  `City.poleSpot`, `spanAnchor` di `City.buildTramway`, `TramSignals.buildHeads` e `City.buildStops`. Il gioco non lo
  importa. `src/data/arredo.js`: `Arredo`, il lettore, con gli stessi metodi del posatore (`semaforo`, `lineaAerea`,
  `scambio`, `pantografo`, `lanterna`, `paline`), e `CODICE`, come si scrive e si rilegge ogni tipo.
  `src/data/padova-arredo.json`: il file, un elemento per riga, nel bundle (221 KB, 80 KB compresso). `City` riceve
  l'arredo in `opts.arredo` (senza, il lettore) e `TrafficLights` e `TramSignals` usano `city.arredo`;
- la build. `scripts/posa_arredo.mjs` (`npm run posa`) costruisce la città in Node con i moduli del gioco
  (`scripts/citta_node.mjs`: Vite per caricarli, un canvas finto per le texture, niente disegno) passando il posatore
  al posto del lettore, in 6 secondi. L'ordine è quello del gioco: binari (`TramTrack`, `TramYard`, `TramNet` dai
  dati), pianta, spazio libero, arredo. I binari restano ricavati in JavaScript: per questo la posa non sta in
  `build_map.py`. Gli edifici dello spazio libero sono tutti quelli di `public/mappa/aree`: prima i semafori vedevano
  solo quelli già caricati all'avvio, cioè quasi nessuno, e i tiranti quelli di `MAP.edificiTram`;
- chi cambia mappa, binari o pianta rifà la posa nello stesso commit: `npm run posa` dice quali righe cambiano,
  `npm run posa -- --zona X,Z,R` (ripetibile) riscrive il file solo se cambiano elementi entro R metri da (X, Z) e
  altrimenti elenca quelli fuori e si ferma, `--tutta` riscrive comunque (posatore cambiato, mappa rifatta).
  `scripts/rigenera_mappa.sh` alla fine fa il confronto. `tests/arredo.spec.js` rifà la posa (`--controlla`) e fallisce
  se non è quella del file, poi controlla che il gioco abbia letto tutto e che i suoi pali stiano dove dice il file;
- il lettore dà gli elementi nell'ordine in cui il gioco li costruisce e controlla l'ancora di ognuno (il nodo, il
  punto del binario): se la mappa è cambiata senza rifare la posa il gioco si ferma con un errore, non cerca un posto
  di ripiego. Chi cambia l'ordine in cui `City`, `TrafficLights` o `TramSignals` costruiscono i loro elementi rifà la
  posa;
- cifre: le posizioni disegnate sono al centimetro; la linea d'arresto (`stop`) e le paline, da cui dipende dove si
  fermano i veicoli, al millesimo di millimetro: con tutte le cifre l'ultima cambiava tra Node 22 su Linux e Node 26
  su macOS (una linea d'arresto su 528), e il file deve uscire uguale su ogni macchina;
- cosa cambia rispetto alla ricerca di prima: 25 lanterne a muro dove la facciata sta sul bordo del marciapiede (prima
  il palo finiva nell'edificio, che al caricamento non c'era); dove a destra non c'è posto il palo va a sinistra anche
  sulle vie a doppio senso (5 approcci prima senza lanterna); dove il posto libero è prima della linea d'arresto la
  linea arretra fino a 0,6 m prima del palo (29 approcci). Linea aerea, lanterne del tram, segnali degli scambi e paline
  stanno dov'erano;
- controlli, nel rapporto di `tests/mappa.spec.js` (`tests/pali.js`), a zero con i casi in
  `data/eccezioni/mappa-gioco.json`: `pali_nella_sagoma_del_tram` (0), `pali_del_tram_in_carreggiata` (7, quelli di
  #97), `pali_nell_ingombro_dei_bus` (12: la carrozzeria dei bus automatici lungo le loro corsie; 6 per la corsia della
  10 fuori dall'asfalto accanto al SIR2, #131, gli altri per la coda del bus in curva, #130),
  `semafori_senza_lanterna_visibile` (7: una lanterna sulla linea d'arresto o oltre; restano i bracci di 1-3 m e due
  approcci senza posto);
- la rete non ha più `edificiTram` (963 KB): serviva a `clearOfBuildings` per i binari non secondo la regola e ai
  tiranti. `scripts/aree_mappa.py` lo scrive solo se ci sono binari non secondo la regola;
- fuori dalla mia area. In `traffic.js`: `TrafficLights.placeApproach` legge l'arredo e ricava dal solo `stop` punto
  della linea, asse e lanterne (`armPoint` e `armCrossings` sono esportate per il posatore; `stats.lineaOsm` non c'è
  più); `TramSignals` tiene `this.city` e `buildHeads` legge palo o gancio da `city.arredo.lanterna`. In `routes.js`:
  `allStopPlacements` la chiama solo il posatore e non dà più nome, linee, pensilina e panchina, che aggiunge
  `stopDetails` quando il gioco legge le paline (`roof` dice se la pensilina ci sta). In `city.js`: via `poleSpot`,
  `tramBld` e le facciate di `buildTramway`; `tramSpans`, `tramPoles`, `panSigns` e `stopPlacements` restano;
- restano posati al caricamento cartelli stradali, lampioni e alberi sparsi, e lo spazio libero non conosce le
  banchine del tram (#132) né l'ingombro dei bus in svolta (#130, dopo i raccordi di #112).

#123, cavalcavia col tram con il profilo del risolutore (16 novembre). Regola in [`cavalcavia.md`](cavalcavia.md),
sezione 6. Da sapere:

- attive nel registro Borgomagno, Chiesanuova, San Marco, Via Venezia e Dalmazia: quattordici strutture in tutto.
  Restano spente le tangenziali con Mortise e Via Salboro (#124);
- tre cose nuove in `scripts/profilo_cavalcavia.py`, che valgono per tutte le strutture attive. Il 6% del tram è un
  vincolo anche lungo ogni binario, sulla corda di 10 m (`punti_binari`, `v_binari`): all'interno di una curva il
  binario fa meno metri della strada che affianca. Le celle accanto a una strada fuori dalla struttura scendono alla
  quota del profilo se l'asse della struttura è più vicino (non salgono mai): sulle nove strutture di #84 i casi
  scendono da 132 a 93 e le quote cambiano fino a 73 cm (Grassi, in (1992, −1206)), dove il rilevato del DTM spuntava
  dalla carreggiata. `edgeH` ha i punti che servono perché terreno più quota dia il profilo entro 2 mm (25 KB in più);
- una struttura attiva può stare accanto a un cavalcavia con le quote di prima: `build_map.py` calcola terreno e quote
  dei nodi con quella struttura spenta (`vicine_a_quote_di_prima`) e `tieni_quote_di_prima` fissa le celle sotto il
  cavalcavia accanto. Oggi vale per il San Marco, la cui rampa ovest corre a 24 m dal viadotto di Corso Irlanda:
  `scripts/profili_strutture.py` dice che Corso Irlanda cambia in 8 archi, di al più 11 cm. Costa una
  `terrain_for_game` in più (la rigenerazione arriva a 3,3 GB di memoria: due insieme nella stessa macchina Docker
  da 8 GB non ci stanno, e una delle due muore con uscita 137 senza scrivere niente);
- `tests/cavalcavia.spec.js` misura i binari del gioco ogni metro e non ogni 5: sulle strutture attive la quota sopra
  il terreno cambia a ogni cella, e con un punto ogni 5 m la misura trovava gradini fino a 0,8 m che il tram non fa;
- `scripts/profili_strutture.py` salta i tratti di binario rimasti senza punti (un tratto in quota lungo un metro, con
  i capi arrotondati al decimetro);
- fuori dalla mia area, `tests/binari-tram.spec.js` e `pendenze` di `scripts/binari_tram.py` (area tram): la pendenza
  dei binari nel gioco si misura sulla quota assoluta (la prova scrive anche il terreno sotto i punti), dove il
  binario è in quota a un capo della corda. La sola quota sopra il terreno, sulle strutture attive, segue anche il
  terreno che scende alle spalle e dava pendenze fino al 25%. Con la misura giusta SIR1 e SIR2 hanno zero casi e le
  soglie a conteggio (4 e 14) sono a zero: a #120 resta da misurare le pendenze sul terreno, fuori dai cavalcavia;
- arredo (#109): le rampe sono ora archi a terra, quindi i loro pali si misurano e i semafori ai loro piedi cercano
  posto in un'altra pianta. Posa rifatta con `--tutta` (334 righe, anche lontano: ogni rigenerazione sposta di qualche
  decimetro i bordi dei marciapiedi). Tre gruppi nuovi in `data/eccezioni/mappa-gioco.json`: 26 pali della linea aerea
  sulle rampe del Chiesanuova e di Via Venezia nell'ingombro dei bus automatici (stanno dov'erano, #131), due pali sul
  bordo della sede sulla rampa del San Marco verso Ippodromo (`tests/linea-aerea.spec.js`: `pali_sull_asfalto` a 1) e
  un approccio senza lanterna ai piedi del Borgomagno verso l'Arcella, dove la linea d'arresto è larga 18 m;
- raccordi (#112): un caso nuovo in `data/eccezioni/raccordi.json`, una corsia senza uscita per le auto su una strada
  di servizio di 6 m accanto alla rotonda dell'Ippodromo, nel gruppo dei gomiti;
- quello che si vede e non è risolto: l'asfalto in quota copre a chiazze la sede del tram su Chiesanuova, Via Venezia,
  San Marco e Borgomagno. C'era anche prima (#85, #126); dopo #123 alcune chiazze sono sparite e altre sono nuove
  (rotonda dell'Ippodromo, veduta `rotonda-sir2-ippodromo`). La causa: `City.elevHeight` dà la quota dell'asse e il
  terreno si somma nel punto, e dove il terreno cambia sulla larghezza della carreggiata l'asfalto in quota si piega;
  la sede prende la quota assoluta dall'asse (`tramH`). Provato a dare all'asfalto la quota assoluta dell'asse: le
  chiazze cambiano forma e spunta il marciapiede in quota, quindi va fatto insieme alla pianta come partizione (#126)
  e per tutto quello che legge `edgeHeight` fuori asse (bus, auto, pedoni);
- casi rimasti, con il perché in `data/eccezioni/cavalcavia.json`: conche lunghe e basse dove la strada sta sul terreno
  com'è, strade che scendono sotto il cavalcavia, scarti dal DTM dove il franco della regola supera le spalle (#125).
  In cima al Chiesanuova resta una conca di 0,18 m in 137 m tra le due campate: un punto a mano nel registro la
  spostava di 16 m senza toglierla, serve il giro contro le onde di #125.

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
media delle quote del binario non lo porta sotto la strada (`setHeights`, da #107 nella build); in `city.js` gli alberi dei viali e quelli
sparsi fuori dall'asfalto vero (`buildTreesAndLamps`); in `main.js` il terreno passato a `City` (`{ terrain }`, per
l'asfalto vicino alla sede del tram).

#111, sosta lungo le strade (16 novembre). Regole, formato, fonti e controlli in [`sosta.md`](sosta.md). Da sapere:

- la build scrive `stalli` (file di stalli per arco e per lato) e `sedeCorsie` (i bordi tra cui stanno le corsie dove
  gli stalli stringono la carreggiata) con `scripts/sosta.py`, dopo la pianta delle strade e prima dei raccordi di
  corsia, che leggono `sedeCorsie`. Il conto delle corsie in Python è uno solo, `corsie_arco` di `scripts/raccordi.py`:
  chi cambia `laneLayout` cambia quello;
- gli archi hanno il flag 512, carreggiata misurata: la sosta dedotta dalla larghezza vale solo lì;
- la pianta delle strade è cambiata in due punti (`street_surfaces.surfaces`): le aree `parking=street_side` di OSM che
  toccano la carreggiata sono asfalto (`golfi`), e le fessure fino a 60 cm tra un parcheggio e la carreggiata si
  chiudono (`CREPA`: il DBGT non dà ai due poligoni lo stesso bordo, e restava una riga di marciapiede in mezzo agli
  stalli);
- gli stalli stanno contro il bordo dell'asfalto della pianta: chi cambia la pianta li sposta, e la rigenerazione li
  rifà. Le zone libere vengono da `stops`, `lines`, `crossings`, dai nodi della rete e dalle vie di servizio di OSM
  fuori dalla rete: chi sposta una fermata o cambia il percorso di una linea rigenera, e `stalli_alle_fermate` in
  `scripts/sosta.py` dice se uno stallo è rimasto nella zona;
- nel gioco le auto ferme sono per area (`City.addSosta`, `fillSosta`), ostacoli di tipo `parked`, che
  `clearBusRoads` non toglie. `City.setSostaOra` le rifà con l'ora (la chiama `setupWeatherAndTime` di `main.js`);
- `laneKey` di `buildRoads` ha anche gli scostamenti delle corsie dove c'è `e.sede`: due archi di fila con corsie
  diverse non stanno nella stessa catena di righe.

#124, cavalcavia delle tangenziali con il profilo del risolutore (dal 17 novembre, a passi). Regola in
[`cavalcavia.md`](cavalcavia.md), sezione 6. Da sapere:

- il programma lineare si risolve per parti (`LP.risolvi` in `scripts/profilo_cavalcavia.py`): le incognite che nessun
  vincolo lega stanno in programmi separati. Con un programma solo le soluzioni a parità di costo sono molte, e
  attivare una struttura spostava fino a 20 cm il profilo di un'altra a chilometri (Via Venezia, Camerini). Per parti
  `scripts/profili_strutture.py` nomina solo la struttura attivata e quelle accanto;
- dove il profilo resta libero e due soluzioni costano uguale, la scelta può cambiare da una macchina all'altra: sul
  Mac il tratto cieco di strada di servizio che da Via San Marco attraversa il SIR2 in (3372, −934) stava a terra, in
  Docker saliva di 32 cm, contava come in quota e l'incrocio perdeva la lanterna del tram. Un punto nel registro lo
  tiene sul terreno (`sopra: 0`). Le prove del risolutore sul Mac (fine della sezione 6 di `cavalcavia.md`) dicono
  quali casi cambiano, non le quote al centimetro: quelle vengono solo da `scripts/rigenera_mappa.sh`;
- le due carreggiate di una tangenziale sono strutture separate nel registro: attivarne una sola sposta casi
  sull'altra, che tiene le quote di prima accanto a una piattaforma nuova. Si attivano insieme;
- sotto una campata il terreno prende il piano di quello che passa sotto (35° percentile entro 30 m), anche dove passa
  una strada fuori dalla struttura: quasi ovunque la porta al DTM, che è giusto, ma sotto Via Salboro Corso Primo
  Maggio scende di 0,7 m in 40 m, con un gradino di 0,4 m in 8 m (un fosso accanto abbassa il percentile), e Via
  Adriatica sotto Corso Boston va 0,8 m sotto il DTM. È il caso "strada che passa sotto e risale" di #125: Via
  Salboro resta spenta finché la strada di sotto non tiene la sua quota sotto le campate. Il controllo non lo vede
  se la strada di sotto non è in quota: la misura è, per ogni incrocio di `impalcati` con una strada fuori dalla
  struttura, la quota della strada di sotto (terreno "via" più `edgeH`) prima e dopo, fino a 40 m per parte;
- passo 1: Cavalcavia Mortise attivo (quindici strutture). In cima al Mortise, alla spalla sud, spunta dall'asfalto
  una superficie chiara dell'impalcato (veduta `cavalcavia-mortise-cima`): è l'asfalto in quota che si piega dove il
  terreno cambia sulla larghezza della carreggiata (#137).
- passo 2: le cinque strutture di Corso Primo Maggio (venti in tutto), e i piedi sul terreno: negli ultimi 20 m prima
  di un piede la quota scritta scende a zero (`quote_archi`). Senza, il piede restava un gradino del terreno sopra
  (5-15 cm, il terreno del primo giro contro quello del secondo), la sua quota passava agli archi fuori dalla struttura
  e un arco a terra lungo 400 m contava come in quota: in gioco asfalto in quota, nel controllo un cavalcavia con le
  quote di prima (così era nato il gruppo "senza nome (4193, −1185)" accanto al San Marco). Sulle strutture di prima
  cambia la quota negli ultimi 20 m di qualche rampa, fino a 15 cm (Via Alessandro Volta);
- fuori dalla mia area, in `src/world/city.js` (`GeoBuilder.polygonH`, asfalto in quota e piano degli impalcati):
  `refine` divideva un lato solo se la quota a metà si staccava dalla corda. Sulle rampe di Corso Irlanda, quando due
  archi accanto al San Marco sono usciti dall'asfalto in quota, la triangolazione ha dato lati di 700 m con i capi e la
  metà sul viadotto a 7 m, che passavano sopra la rampa a 0,75 m: dal posto di guida un filo nel cielo (veduta
  `tangenziale-irlanda-rampe`). Ora la quota si guarda ogni 10 m sui lati più lunghi di 10 m (a metà su quelli più
  corti, come prima). Misura con la mappa del passo 2: `buildRoads` da circa 1.575 a 1.615 ms, `buildDecks` da 262 a
  299 ms, triangoli da 7,63 a 7,65 milioni (asfalto in quota da 342 a 364 mila);
- quello che resta è in #142, bloccato da #125: con tutte le tangenziali accese il profilo è dentro la regola (casi da
  889 a 413), ma sotto le campate le strade che passano sotto sprofondano fino a 3 m sotto il DTM (Lungargine San
  Lazzaro sotto Corso Irlanda, Via Fornace Morandi sotto Corso Tredici Giugno, una rampa sotto Via del Commercio).
  Le vedute `tangenziale-*` sono state fotografate prima di #124 e restano il prima per #142.

#139, mappa locale (17 novembre). Un dato cambiato in un punto cambia la mappa solo vicino. Causa e misure in #139.
Da sapere prima di scrivere un passo della build che lavora su tutta la città:

- la causa era in `street_surfaces.surfaces`. Le unioni di tutta la città (`unary_union`) danno la stessa forma, ma su
  un albero costruito con tutti i pezzi: un pezzo in più o in meno (un arco che va in quota, un arco che entra nei
  percorsi dei bus, un'isola del DBGT presa) cambia l'ultima cifra delle coordinate in tutta la mappa e, dove due bordi
  quasi si toccano, strisce di qualche centesimo di metro quadro tra asfalto e isola. Poi la semplificazione si faceva
  sulla geometria di tutta la città, prima del taglio in riquadri: Douglas-Peucker su anelli lunghi chilometri, che
  tiene vertici diversi se l'anello parte da un altro punto, trasformava quelle differenze in decimetri (fino a 40 m²
  per riquadro). Nel gioco una sequenza casuale sola (`City.rnd`) per case di riempimento, alberi e lampioni: un
  albero in più vicino al cambio cambiava tutti gli altri;
- ora le unioni della pianta e degli impalcati passano da `unione` (per riquadro da 200 m, poi quattro a quattro con
  un albero fisso nello spazio) e la pianta a terra si semplifica per riquadro (da #126 `partizione`, nota sotto; era
  `semplifica_riquadro`, uno strato alla volta): tagliata sul riquadro, con il bordo del riquadro fermo (i riquadri
  accanto combaciano), con il punto di partenza degli anelli e l'ordine dei pezzi scelti sulle coordinate al
  millimetro, e anelli d'uscita in forma canonica (`anelli_canonici`: esterno antiorario, dal vertice più piccolo,
  buchi e poligoni in ordine). Asfalto in quota,
  impalcati ed edifici ritagliati passano da `canonico` prima di `simplify`. Le regole per un passo nuovo: unioni con
  `unione`, niente `simplify` su una geometria di tutta la città, ordine delle uscite dalle coordinate arrotondate e non
  dall'ordine in cui GEOS restituisce i pezzi o da un indice;
- nel gioco `City.rnd` non c'è più: case di riempimento, alberi dei viali e lampioni prendono i numeri da `rngAt` di
  `src/world/spatial.js` con il posto (arco e lato, cella da 24 m), grandezza, verso e colore di ogni albero dal suo
  punto, gli alberi sparsi da una sequenza loro. Chi aggiunge alla scena cose a caso fa lo stesso;
- `scripts/localita.py PRIMA DOPO` dice cosa cambia tra due mappe (celle della pianta nella rete e nelle aree, edifici,
  alberi, asfalto in quota, impalcati, stalli, corsie strette, raccordi, terreno) e a che distanza dai dati cambiati
  (nodi, archi, quote, percorsi delle linee, fermate, binari, cavalcavia). `scripts/rigenera_mappa.py` lo stampa a fine
  rigenerazione, rispetto alla mappa che c'era prima;
- la prova: `data/localita.json` ha i cambi (larghezza di un arco di Corso del Popolo, quota di un nodo di Via Pietro
  Gerardo) e il raggio (300 m); `build_map.prova_localita` li applica appena prima della pianta quando
  `rigenera_mappa.py --localita` li mette in `build_map.PROVA_LOCALITA`; oltre il raggio la mappa deve essere quella
  del repository byte per byte, e la posa dell'arredo sulla mappa così ottenuta quella di `src/data/padova-arredo.json`
  (`node scripts/posa_arredo.mjs --localita --mappa <rete>`, con `costruisci(poi, { mappa })` di
  `scripts/citta_node.mjs`). Casi noti in `data/eccezioni/localita.json` (controlli `mappa` e `posa`), vuoto. Job
  `localita` di `verifiche.yml`; in locale `scripts/rigenera_mappa.sh --localita`, che scrive la mappa della prova in
  `.localita/` e rifà la posa fuori da Docker;
- misure (17 novembre). Con il codice di prima la quota di un nodo cambiava 133 aree su 224 (110 oltre 2 km), 849
  celle delle aree, 10 righe della posa e tutti i 3.911 alberi del gioco; nel caso di #114 (archi, archi dei bus e
  svolte strette cambiati in 71 posti) 1.694 strati di cella oltre 500 m. Ora, nei due cambi di quota provati e nel
  caso di #114, niente oltre 200 m tranne una cella di isole a 200-500 m dai percorsi cambiati; la prova in Docker
  cambia 2 aree, 10 raccordi entro 34 m e 2 righe della posa, e oltre 300 m niente. La pianta ha il 3-6% di vertici
  in meno e dura circa il 15% in più. Con lo stesso lock macOS dà ora la stessa pianta di Linux (prima 115 celle e
  20 aree diverse); restano diversi i binari del tram (1 mm) e una decina di raccordi, quindi si rigenera sempre da
  Docker.

#125, strade sotto le campate, onde e franchi veri (dal 17 novembre, a passi). Regola in
[`cavalcavia.md`](cavalcavia.md), sezione 6. Da sapere:

- passo 1: sotto una campata la strada che passa sotto, se non è della struttura, tiene la sua quota (`StradeSotto` in
  `scripts/profilo_cavalcavia.py`). L'ombra della campata sono le celle che `adatta_terreno` porta al piano; le strade
  fuori dalle strutture che ci entrano sono una rete di punti ogni 2 m, che prosegue sulle rampe delle strutture (non
  sugli impalcati): fuori dall'ombra la quota del terreno di base senza chiusura, dentro la media dei vicini lungo la
  strada. Le celle sotto la campata entro 14 m dal suo asse prendono quella quota, e il franco sopra di lei si misura da
  lì. Dove la rete non esce dall'ombra (una bretella tutta sotto un viadotto) resta il piano della campata, non il
  terreno nel punto: sotto gli impalcati delle strutture attive la variante "via" ha i ponti a terra di
  `terrain_for_game` (le strutture attive non hanno quote in `heights`, e i loro impalcati passano per ponti sui fiumi),
  la retta tra le spalle, fino a 5 m sopra la strada;
- la misura che il controllo non fa: per ogni incrocio di `impalcati` con una strada fuori dalla struttura, la quota
  della strada (terreno "via" più `edgeH`) ogni 2 m fino a 40 m per parte, contro la corda tra i due capi. Il DTM non
  basta come riferimento: sotto l'impalcato interpola dalle spalle (Corso Australia sotto il Chiesanuova: 4 m di dosso).
  La fa `scripts/prova_risolutore.py` sulle strutture accese (sotto);
- `scripts/prova_risolutore.py`: il passo dei cavalcavia della build sulla rete della mappa, senza rigenerarla, con le
  strutture scelte accese da sole (di base Via Salboro e il Grassi, dal 20 novembre anche il San Marco: #151) o con il
  registro (`--registro`); dice violazioni, casi del controllo e quanto la strada di sotto si stacca dalla quota della
  rete, e con `--controlla` esce con errore (lavoro `mappa` di `verifiche.yml`). 17 s sul Mac. Le quote al centimetro
  vengono solo dalla rigenerazione;
- passo 1 pubblicato il 18 novembre: casi delle strade da 819 a 789, dei binari da 16 a 12; Via Salboro accesa;
  cambiano le quote di 24 strutture (`data/profili-cavalcavia.json`: tutte quelle con una strada o la ferrovia sotto
  una campata, perché il franco sopra una strada si misura dalla strada); 14 aree della mappa, tutte entro 200 m dai
  dati cambiati; la posa di 49 pali della linea aerea su Borgomagno, Chiesanuova, Via Venezia e San Marco (stessi punti,
  altra altezza); in `data/eccezioni/verifica-mappa.json` le misure della pianta di cinque riquadri delle strutture
  toccate (marciapiedi stretti e verde coperto, da 30 a 250 m²).
- le quote calcolate che entrano nel programma lineare come termine noto (la rete delle strade sotto le campate, da
  `spsolve`) si arrotondano a 0,1 mm: le ultime cifre cambiano tra arm64 (Docker sul Mac) e amd64 (CI), e dove il
  programma ha più soluzioni dello stesso costo ne sceglie un'altra. Così 6b158b7 è finito rosso sul lavoro `rigenera`
  (2 archi di `edgeH`), corretto in 7b041a4; sul Mac l'arrotondamento ha spostato il profilo fino a 6 cm in 76 archi,
  tanto il programma è sensibile. Chi aggiunge un termine noto calcolato fa lo stesso;
- arrotondare non basta per il risultato del programma: HiGHS cambia le ultime cifre tra arm64 e amd64 anche con gli
  stessi dati, e un valore che cade a mezzo millimetro va da una parte o dall'altra. Dopo il passo 2 (154706b) il lavoro
  `rigenera` era rosso per un solo valore di `edgeH` (Corso Primo Maggio, arco 15479, a 64 m: 925 mm su arm64, 924 in
  CI), e con lui la veduta tangenziale-primo-maggio-esperanto. Arrotondare due volte sposta solo il confine. Da allora
  `scripts/rigenera_mappa.sh` lancia il container `linux/amd64` anche sul Mac (Docker lo emula: 16 minuti da sola in
  Docker; con un altro container da 3 GB accanto l'emulazione è finita senza memoria, uscita 137), e `rigenera_mappa.py` si ferma se l'architettura non è x86_64. Per provare il passo dei cavalcavia su amd64
  senza rigenerare tutto: la stessa riga `docker run --platform linux/amd64` con `--uscita` su un file a parte;
- passo 2: il giro contro le onde (`Profili.onde` e `itinerari`; costanti `W_ONDA`, `ONDA_GIRO`, `ONDA_RESTO`,
  `GIRI_ONDE`, `ONDA_RILIEVO`). Sono richieste morbide, con il costo tra quello del DTM e quello della banda: dove le due
  regole non stanno insieme vince il rilievo, e la conca resta con il suo perché. Il passo dei cavalcavia fa fino a tre
  soluzioni per giro del terreno, ma per parti: le strutture senza conche si risolvono come prima. Si riempie solo sul
  rilevato (0,3 m sopra il terreno) o sui ponti: a raso bastano 5,5 cm per fare in quota un arco (`IN_QUOTA`), e il
  gioco toglie la lanterna del tram a un incrocio con una strada in quota (`TramSignals`), anche se l'arco è in quota
  solo in un punto. Per lo stesso motivo un punto nel registro tiene a terra l'incrocio a raso del SIR2 ai piedi ovest
  del Chiesanuova. Con il passo, il nucleo oltre i capi interni degli archi a terra della struttura (sezione 6 di
  `cavalcavia.md`). Provato e lasciato: carreggiate affiancate solo con lo stesso nome (sul Mac 776 casi contro 791,
  Dalmazia, Mortise, San Marco), ma a quell'incrocio la cella prende la più bassa delle strade accanto e Via Chiesanuova
  e Via Pacinotti restano 14-18 cm in quota anche con i punti del registro: serve prima che la cella di un incrocio a
  raso prenda la quota dell'incrocio;
- passo 3: i franchi veri nel registro, dalle spalle nel LiDAR e dai cartelli di OSM (`scripts/spalle_cavalcavia.py`,
  sezione 6 di `cavalcavia.md`). Nel registro una voce di `franchi` può avere `quota` (l'impalcato all'incrocio) al
  posto di `franco`; `Profili.franco` dà (franco, quota). Lo script serve `pyproj` (come `dtm_grid.py`), fuori dalla
  build: i numeri si scrivono a mano nel registro, con la fonte nel perché;

#126, pianta delle strade come partizione (18 novembre). Un solo proprietario per ogni metro quadro: chi si vede non lo
decidono più `polygonOffset` e i centimetri di quota. Da sapere:

- a terra le classi sono cinque, in ordine di priorità: sede del tram, isole, asfalto, marciapiede, verde (`CLASSI` in
  `scripts/street_surfaces.py`), più le rampe a raso (sotto). La cella della mappa è `[ix, iz, asfalto, marciapiede,
  isole, verde, sede, rampa]`: sede (indice 6) e rampa (7) sono nuove e restano nella rete con asfalto e isole. La
  rampa non si disegna come pianta (la disegna l'asfalto in quota): c'è perché chi legge "la carreggiata" dalle celle
  prenda asfalto, sede e rampa (`sosta.Asfalto`, `raccordi.Pianta`, `verifica_mappa.Mappa`; nel gioco `asphRings` e
  `surfaceOff`, quindi la posa: senza, sulle rampe a raso la posa vedeva spazio libero e ci metteva i pali);
- `partizione` fa la pianta di un riquadro da 200 m: le linee di tutte le classi più il bordo del riquadro unite sulla
  griglia da 1 µm (`NODI`), le facce, ognuna alla prima classe che ne contiene un punto interno (il resto è il vuoto);
  poi i bordi tra due classi da un nodo all'altro (`_catene`) semplificati una volta sola con Douglas-Peucker, con la
  tolleranza della più fine delle due classi e la topologia di tutto il riquadro (a passate, le altre catene ferme come
  lati di due punti), infittiti dove il terreno non è piano se una delle due classi lo chiede; infine tutte le linee
  arrotondate insieme sulla griglia da 10 cm (snap rounding) e le facce di nuovo assegnate, quelle sotto 0,5 m² alla
  vicina con il lato in comune più lungo. Il bordo del riquadro non si semplifica: i riquadri accanto combaciano (#139);
- tre trappole trovate: arrotondare al decimetro ogni poligono per conto suo incrocia i lati dove due classi sono più
  vicine di 10 cm (43 m² di sovrapposizioni, tutte sotto i 5 cm di spessore); `coverage_simplify` di shapely
  (Visvalingam-Whyatt) toglie i vertici per area e mangiava le punte dei marciapiedi accanto alle banchine; l'unione
  delle linee in virgola mobile, e `coverage_clean` di GEOS 3.14.1, alla rotonda di Santa Croce davano all'asfalto
  un'isola di 440 m² che ne riempie un buco con il bordo spostato di 2 cm. Una quarta per la località (#139): l'unione
  sulla griglia arrotonda i nodi, ma calcola gli incroci dai vertici com'erano, e dove due bordi quasi coincidono (il
  lato fermo di una rampa a raso e quello dell'asfalto a terra della stessa carreggiata) l'ultima cifra di un vertice
  sposta l'incrocio di decimetri; l'ultima cifra dell'asfalto cambia anche lontano da un cambio (le differenze e
  `buffer(0)` di tutta la città, di prima di #126), e nella prova della località un nodo di una rampa a Corso Primo
  Maggio si spostava di 0,8 m per un nodo alzato a 3,7 km. `partizione` mette i vertici sulla griglia prima di unire;
- `build_map.py` si ferma se due classi della stessa cella si sovrappongono (`street_surfaces.sovrapposte`);
  `scripts/verifica_mappa.py` misura le stesse coppie, sede compresa, per riquadro da 800 m;
- in quota: i tratti degli archi in quota sotto 5 cm (`Q_TERRA`, i piedi delle rampe: un quarto di quello che era
  asfalto in quota) sono asfalto a terra. Dove la rampa disegnata sta sotto 15 cm (`H_RASO`) le classi a terra le
  lasciano il posto: l'asfalto e la sede in quota come li disegna il gioco entrano nella partizione del riquadro come
  una classe prima di tutte (`rampa` di `partizione`), con i bordi fermi, così la pianta a terra finisce sul bordo
  della rampa disegnata. La quota è quella che disegna il gioco (`City.elevHeight`: la più alta tra gli archi in
  quota entro mezza carreggiata più 1,5 m, `MARGINE_QUOTA`), non quella dell'arco: tagliando con la quota dell'arco la
  pianta a terra finiva dove la rampa disegnata stava già decimetri più su, e il gradino si vedeva (Chiesanuova,
  Borgomagno, Grassi). Sopra i 15 cm la rampa passa sopra le classi a terra, come un ponte: sta più in alto e ha lo
  strato più alto, quindi vince da vicino e da lontano. Restano fessure di qualche centimetro solo dove un altro bordo
  della pianta incontra quello della rampa (l'arrotondamento finale sposta quel nodo dal lato della rampa):
  `raccordi.Pianta` chiude i buchi dell'asfalto larghi in media meno di 10 cm (`FESSURA`). Due prove scartate:
  tagliare con la geometria esatta delle rampe lasciava fessure fino a 4 cm, che il controllo dei raccordi prendeva per
  il bordo della strada (sei svolte nuove senza raccordo sul San Marco e sul Camerini); una fascia di 30 cm di asfalto
  a terra sotto il bordo della rampa dava un caso nuovo degli strati a Corso Primo Maggio con Via Guizza, dove la
  quota resta di pochi centimetri per decine di metri e da vicino vinceva l'asfalto a terra;
- la sede in quota è una classe a sé, `surfaces.upSede`: la sede sotto ogni carreggiata in quota quasi parallela al
  binario (una di traverso è un ponte sopra il tram), tolta dall'asfalto in quota. Il gioco la disegna alla quota del
  binario (`City.quotaSede`, dal profilo `tramH` come `onSede`), mai sopra la strada accanto (`elevHeight`: al
  Chiesanuova un binario sale già a 0,6 m dove la strada sta a 5 cm), con lo stesso materiale dell'asfalto in quota e
  con i triangoli divisi dove il terreno si incurva (come `nearSede`). Non conta la quota del binario: sulla rampa del San
  Marco verso l'Ippodromo il binario sta pochi centimetri sopra il terreno e la strada accanto 0,4-0,8 m (#137), e con
  la quota stimata dalla strada (`_tram_heights`, come gli impalcati) per uno dei due binari l'asfalto in quota copriva
  ancora la corsia rossa. Asfalto e sede in quota si tagliano sulla griglia della mappa dopo aver semplificato, così
  hanno lo stesso lato in comune;
- facce verticali nuove (`buildSurfaces`, mesh `fianchi`): tra asfalto e sede in quota, da una quota all'altra (fino a
  mezzo metro all'Ippodromo, #137), e sul bordo delle rampe fino a terra dove la rampa sta sotto 15 cm; sul taglio di
  traverso alla carreggiata (strada dalle due parti, lato quasi perpendicolare all'arco) tutto il lato, perché lì
  `elevHeight` prende la quota dell'altra carreggiata se è più alta (al Borgomagno 0,47 m sul taglio a 5 cm) e da sotto
  si vedeva il terreno della rampa a raso. Senza facce, dal gradino si vedeva il terreno: una riga color prato di
  traverso a Via Salboro, lungo la corsia all'Ippodromo. Tre dettagli: la faccia segue `elevHeight` dividendo a metà
  fino a mezzo metro dove si stacca dalla corda, come il bordo disegnato (con le quote dei soli capi spuntava sopra la
  strada dove la quota salta); ogni quadrilatero c'è due volte, una per verso, con il materiale da un lato solo (con
  `DoubleSide` three.js gira la normale della faccia vista da dietro, e la faccia usciva nera); le normali sono in su,
  così una faccia di 5 cm ha la luce della strada e non fa una riga scura a ogni piede di rampa. Le righe di bordo
  dell'asfalto in quota non si disegnano dove fuori c'è ancora strada (al Mortise una riga attraversava la carreggiata
  sul taglio). `buildDecks` abbassa il piano dell'impalcato alla quota della sede in quota dove sta sotto di lei: sul
  San Marco la sede sta fino a 6 cm sotto la strada, e il piano chiaro ci spuntava sopra;
- nel gioco `buildSurfaces` disegna la sede a terra nella mesh dell'asfalto (corsie rosse e rotaie restano segni sopra,
  `buildTramway`); i lati in comune tra asfalto e sede non hanno cordolo né riga e non contano per `surfaceOff`. Le
  banchine del tram hanno lo strato 9: stanno 18 cm sopra le isole (strato 8) che a volte hanno sotto, e alla fermata
  Santa Croce del SIR1 da 30 m l'isola spuntava sulla banchina.

#137, quota dell'asse su tutta la larghezza della carreggiata (19 novembre). Regola in [`cavalcavia.md`](cavalcavia.md),
sezione 7. Da sapere:

- la quota di un punto della carreggiata di un arco in quota la dà solo `quotaStrada(e, s, x, z)` di
  `src/data/padova.js`: quota assoluta dell'asse alla progressiva s (terreno "via" sull'asse più `edgeHeight`) meno il
  terreno del punto. `edgeHeight` resta la quota sull'asse (prove, profili, impalcati vecchi). Il terreno lo passa `City`
  (`usaTerreno(this.terrain)` nel costruttore): è uno stato del modulo, quindi una `City` costruita con un altro terreno
  lo cambia per tutti. La differenza di terreno tra l'asse e il bordo della carreggiata arriva a 3 m (San Marco), e in un
  punto su sei degli archi in quota delle strutture attive supera i 20 cm;
- ai piedi la pianta disegna come asfalto a terra i tratti sotto 5 cm (`Q_TERRA`, lo stesso nome di
  `scripts/street_surfaces.py`), che seguono il terreno: la quota passa dal terreno al piano tra 5 cm e 0,5 m di quota
  dell'asse (`PIANO`). Con il piano da subito il taglio a 5 cm faceva un muro fino a 2,5 m sul lato; con `PIANO` a 0,15
  i gradini dei mezzi erano di più (105 coppie di archi contro 79), a 1,0 poco di meno (oltre 20 cm 14 contro 19) ma con
  più rampa piegata. Dove la quota dell'asse sale e scende con le celle del terreno sotto l'asse, in quella fascia una
  parte del terreno resta nella quota: sono i casi del secondo gruppo di `data/eccezioni/gradini.json`, che spariscono
  quando il terreno sotto la carreggiata sta alla quota della strada (#125);
- fuori dalla mia area. `src/world/traffic.js`: `Traffic.carHeight` e i pedoni leggono `quotaStrada` nel punto
  dell'auto o del pedone. `src/world/inseguitore.js`: `Curva.quota(u, x, z)` va dalla quota dell'arco d'arrivo a quella
  dell'arco d'uscita, tutte e due lette nel punto dell'auto, senza più `h0` e `h1` in cache. `src/world/buses.js`:
  `laneHeight(L, i, x, z)` nel punto del bus. Il moto di auto e bus automatici non cambia (la quota li disegna e basta):
  l'impronta del traffico è la stessa;
- in `src/world/city.js`: `elevHeight` prende prima gli archi su cui il punto cade tra i due capi (col capo dell'arco
  dopo, prima del nodo, il massimo faceva un ripiano di mezzo metro al Maroncelli) e può stare sotto zero; `quotaSotto`
  tiene in `st.x`, `st.z` il punto letto; le righe sugli archi in quota stanno sull'asfalto disegnato se è entro mezzo
  metro dalla quota del loro arco (ai viadotti di Via Boves le copriva, due casi degli strati spariti); il piano degli
  impalcati prende la quota della strada più vicina ma mai sopra l'asfalto disegnato (con la quota disegnata dappertutto,
  tra le carreggiate di Corso Argentina saliva a denti); `GeoBuilder.polygonH(rings, yFn, uvScale, tol, ter)` con `ter`
  divide dove si stacca dalla corda la quota assoluta; `GeoBuilder.ribbon` calcola la quota in ogni vertice, non solo
  sulla linea di mezzo (le righe e le corsie del tram larghe 3 m prendevano la quota del mezzo su tutti e due i lati);
- fuori dalla mia area, del tram: in quota la sede (`City.quotaSede`), le corsie rosse, le rotaie, i cordoli e i dischi
  dei giunti di `buildTramway` seguono la stessa regola (`quotaFuoriAsse`, col punto del binario) e il profilo del
  binario in ogni vertice (`TramTrack.heightAt`, non la retta tra i capi del pezzo: in cima al San Marco la corda stava
  10 cm sotto la sede); i dischi dei giunti si mettono dove il binario è in piano sulla quota assoluta. Corsie e sede
  stanno in piano sulla larghezza come la carreggiata accanto; prima si piegavano col terreno. Il tram, come ogni mezzo,
  resta alzato vertice per vertice dal vertex shader: dove il terreno sotto cambia molto sulla larghezza si deforma un
  poco con lui;
- prova nuova in `tests/profili.spec.js`, "nessun gradino da un arco al successivo", su tutte le strutture attive (non
  solo dove passa una linea), con l'elenco `data/eccezioni/gradini.json` in tre gruppi: carreggiate che si
  sovrappongono agli innesti con profili diversi (#150, dati del risolutore), passaggio al piano ai piedi (#125), curve
  lontano dall'asse e terreno ripido. Il pilota dei profili confronta la quota letta con quella del file portata nel
  punto con `quotaFuoriAsse`.

#142, tangenziali sul profilo del risolutore (19 novembre). Numeri in [`cavalcavia.md`](cavalcavia.md), sezione 6. Da
sapere:

- accese nel registro Via del Commercio (tre strutture), Corso Boston (due), Corso Australia, Corso Tredici Giugno (con
  Via Boves, il Cavalcavia Tevere e una carreggiata di Corso Australia) e Corso Irlanda (con Corso Argentina): tutte le
  ventinove strutture, e nessun cavalcavia ha più le quote di prima. `overpass_heights`, `vicine_a_quote_di_prima` e
  `tieni_quote_di_prima` restano per una struttura nuova che entri nel registro spenta. Corso Australia e Corso Tredici
  Giugno si accendono insieme: si scambiano le carreggiate tra le due strutture, e con una sola accesa Corso Australia
  sotto Corso Tredici Giugno si staccava di 1 m dalla sua quota;
- la rigenerazione in amd64 emulato dura di più (23.579 incognite contro 11.286): con il Mac sveglio circa mezz'ora di
  CPU nel container. Con il Mac a batteria e il coperchio chiuso il container è restato su tre ore (Maintenance Sleep),
  e le prove delle altre sessioni non aprivano le pagine;
- fuori dalla mia area, in `scripts/street_surfaces.py` (`surfaces`, isole delle rotatorie): l'isola di un anello
  `junction=roundabout` non copre più la carreggiata delle strade a terra che la attraversano con l'asse dentro. Tra
  i due cavalcavia di Corso Tredici Giugno su Corso Australia l'anello allungato dello svincolo gira attorno alla
  strada principale, che in mezzo sta a terra: con le quote di prima una parte dell'anello era in quota e l'isola non
  nasceva, con il profilo l'anello è tutto a terra e l'isola copriva 140 m di carreggiata (in partizione l'isola viene
  prima dell'asfalto). Gli archi che si innestano sull'anello, con un capo su un suo nodo, non contano. Lo trova
  il conto degli archi con l'asse fuori dall'asfalto (pianta a terra, sede, rampe, asfalto in quota): in tutta la città
  erano solo quei tre;
- nel registro i cartelli `maxheight` sotto Corso Tredici Giugno (Via Domenico Leonati 3,70, Cavalcavia Tevere 4,00),
  come quelli del passo 3 di #125. Il cartello da 2,40 che `scripts/spalle_cavalcavia.py` dà sotto Corso Irlanda in
  (3925, −3355) è di una strada di servizio senza nome di OSM accanto a Via Giuseppe Garibaldi, non della strada di
  sotto: non c'è;
- con Corso Irlanda acceso il San Marco non tiene più il terreno di prima: 12 cm sulla rampa ovest, 7 cm sui binari
  del SIR2 in un tratto corto, stessi casi. Con Corso Tredici Giugno il Mortise cambia fino a 27 cm su una rampa bassa;
- Via Antonio Ceron passa nel suo sottopasso (`tunnel`, `layer=-1`) sotto Via Boves, 3,8 m sotto l'impalcato; prima
  attraversava a raso la cima del rilevato. Sull'asfalto in quota di Via Boves lì restano un filo bianco e un triangolo
  chiaro (#156); le strade sotto le campate oltre 15 cm dalla loro quota sono in #157;
- area Verifiche, `tests/profili.spec.js`: gli assi del bus del pilota su un arco in quota che non è del percorso stanno
  in `data/eccezioni/profili-pilota.json` (controllo `altrove`, un caso per posto entro 15 m) come i salti; prima
  dovevano essere zero senza elenco. Il caso è all'innesto di una rampa su Via Boves, dove le due carreggiate stanno
  alla stessa quota entro 3 cm (#150). Il salto noto di Corso Tredici Giugno, con le quote di prima, è sparito;
- la guida dalla cabina sulle linee 4 e 24 (Corso Tredici Giugno, Corso Boston), 7 (Corso Irlanda), 22 (Mortise), 10
  (San Marco) e in Esplorazione su Corso Australia, Via del Commercio e Corso Boston ovest legge la quota del file entro
  8 mm, senza salti oltre quelli degli innesti sovrapposti (#150).

#158, rigenerazione più corta (20 novembre). Con le ventinove strutture di #142 i lavori `rigenera` (20 minuti) e
`localita` (25) di `verifiche.yml` scadevano; per scelta dell'utente i limiti restano e si accorcia il lavoro. Da sapere:

- `build_map.py` stampa subito, con `flush`, quanto dura ogni passo (`Cronometro`), e alla fine il riepilogo: il log in
  Docker e in CI è bufferizzato, e un lavoro scaduto non diceva dove era arrivato. In CI, prima (7a37c1b): build da 984
  a oltre 1.150 s, quasi tutta cavalcavia (290-375 s) e pianta delle strade (585-697 s); la stessa build dura il 20% in
  più da una macchina all'altra. In locale, in Docker amd64 emulato sul Mac, 1.162 s;
- la guardia: oltre `TETTO_CAVALCAVIA` (300 s) per il passo dei cavalcavia, o `TETTO_BUILD` (900 s) per la build, la
  build avvisa: in CI con un'annotazione `::warning::` nella serie, che resta anche se poi il lavoro scade. Non si ferma.
  Nella prima versione (47aa696) fermava la build in CI, e su una macchina lenta rigenera è caduta a 311 s di cavalcavia.
  Tra una macchina e l'altra della CI la stessa build dura fino a 1,6 volte (a5cefe8: 912 s su una, 1.439 s sull'altra,
  con i passi in sequenza 1,7-1,9 volte più lenti), e un tetto fisso che ferma la build sulle lente la ferma anche dove
  starebbe nel limite. La build stampa all'inizio la macchina (processori e modello). Chi allunga la build di proposito
  misura e sposta i tetti, scrivendo perché;
- il passo dei cavalcavia era al 93% programma lineare, le 21 parti risolte una dopo l'altra per 6 volte (due giri del
  terreno, ognuno con due giri contro le onde). Ora `LP.risolvi` le divide tra `PROCESSI` processi
  (`CAVALCAVIA_PROCESSI`, di base fino a 4): fork su Linux, spawn su macOS. E ricorda le soluzioni per impronta del
  programma (`_SOLUZIONI`, sha256 di incognite, matrice, termini noti e limiti): 54 soluzioni su 126 rifacevano un
  programma identico tra un giro e l'altro, tra cui la parte più grande nell'ultimo giro. Lo stesso programma ha la
  stessa soluzione, e le quote escono identiche. Il resto non si accorcia senza cambiare la mappa: la parte più grande,
  circa 57.000 incognite con le ausiliarie, si risolve 5 volte di fila, e un'altra strada per HiGHS (altro metodo,
  partenza dalla soluzione di prima) può dare un'altra delle soluzioni con lo stesso costo;
- nella pianta (`scripts/street_surfaces.py`) due modi di dividere un ciclo di lavori indipendenti, tutti e due con
  `PIANTA_PROCESSI` (di base fino a 4; 1 li spegne):
  - `in_thread(fn, n)`: thread, per le operazioni di Shapely su geometrie grandi (buffer, unioni, differenze). Shapely 2
    lascia il GIL mentre GEOS lavora, e i thread non copiano il processo né rimandano indietro i risultati. Lo usano i
    livelli di `unione`, i buffer dell'asfalto di tutta la città che non dipendono l'uno dall'altro (in `dbgt_islands`
    con l'unione delle corsie, quelli per le carreggiate del DBGT, quello per gli alberi con l'unione degli edifici) e
    le differenze tra ogni edificio e le zone da tenere libere. Vale anche su macOS. Non per geometrie preparate in
    comune: GEOS ne costruisce l'indice al primo uso, e da più thread insieme non è sicuro;
  - `in_parallelo(fn, n)`: processi nati per fork, che trovano in memoria quello che serve; tornano solo i risultati,
    le geometrie per WKB con tutte le cifre, nell'ordine. Per i cicli con tanto Python: i riquadri della partizione e i
    raccordi agli incroci (`fillets`, un nodo alla volta). Su macOS resta in sequenza (fork lì non è sicuro con le
    librerie di sistema); `PIANTA_FORK=1` lo forza per le prove. Un processo figlio non apre altri processi, e un thread
    non fa fork;
- nella pianta pesava anche, in sequenza, la domanda "questo edificio tocca le zone da tenere libere?" su tutta la
  città non preparata: ogni `intersects` rifaceva l'indice della geometria, circa 40 s sul Mac. Ora la geometria si
  prepara prima (stesso esito). Cercando altro tempo, la misura per riga di `surfaces` (traccia delle sole righe del
  suo frame, `sys.settrace`) dice dove guardare meglio del profilo per funzione;
- la regola, per chi aggiunge un ciclo a questi: ogni lavoro deve dare quello che darebbe nel processo della build, e
  il risultato torna al suo posto. Così l'uscita è la stessa byte per byte, ed è il job `rigenera` a controllarlo. Sul
  Mac, con gli argomenti della pianta salvati, la pianta esce identica in sequenza, con i soli thread e con thread e
  processi; il passo dei cavalcavia con uno e con quattro processi, e con la memoria, anche.

#150, carreggiate che si sovrappongono agli innesti (20 novembre). Regola e numeri in [`cavalcavia.md`](cavalcavia.md),
sezione 6. Da sapere:

- in `Profili.risolvi` di `scripts/profilo_cavalcavia.py`, prima delle carreggiate affiancate, un legame nuovo: dove un
  punto della sezione di un'incognita (l'asse e i due bordi) cade entro mezza carreggiata più `SOVRAPPOSTE` (1,5 m, il
  margine di `City.quotaSotto`) dall'asse di un altro arco delle strutture con un nodo in comune, l'incognita chiede la
  quota di quell'arco nel punto più vicino (`SOVRAPPOSTE_TOLL` 2 cm, `W_SOVRAPPOSTE` 50 per metro). Non tra archi che
  si incrociano, non tra archi senza nodi in comune, non con l'arco che prosegue lo stesso oltre il nodo (deviazione
  fino a 60 gradi). `P.violazioni['sovrapposte']` dice dove resta aperto, e `scripts/prova_risolutore.py` lo stampa;
- il peso è basso di proposito. Con 1000 il legame chiudeva quasi tutto ma spostava salite intere (al Mortise la rampa
  che si stacca a 15 gradi dalla strada a raso, al San Marco la campata di 0,5 m per 7 cm al bivio sulla rampa), e il
  peso dei casi del controllo saliva da 801 a 881-920 (sul Mac). Con 50 sale a 816 e i gradini restano solo dove
  chiuderli costa una salita;
- un punto del registro sul terreno (`sopra` fino a 5 cm: oggi i due incroci a raso con il SIR2, ai piedi ovest del
  Chiesanuova e in Via Venezia) vale come un piede: le strade che ci arrivano seguono il terreno negli ultimi `ARRIVO`
  metri, con un peso più alto del legame. Senza, il legame con la rampa del Chiesanuova alzava di 8 cm l'incrocio, terreno
  compreso (il punto è relativo al terreno del giro prima, che si alza con il profilo): Via Pacinotti arrivava a 5,1 cm
  e la posa toglieva la lanterna del SIR2. Lo dice `npm run posa` dopo la rigenerazione; sul Mac non si vedeva;
- con la mappa rigenerata: gradini da 82 a 54 (spariscono Via Vicenza al Chiesanuova, 0,45 m, il Montà, 0,23, e altri
  31; ne nascono 5 da 8 a 13 cm); casi del controllo delle strade da 361 a 377, peso da 792 a 816 (31 nuovi in un
  gruppo con il perché: conche corte e scarti poco oltre la tolleranza dove la strada della struttura va incontro a
  quella che entra); dei binari da 12 a 13 (la stessa conca a raso di Via Venezia, ora su tutti e due i versi). Le
  quote delle strutture cambiano fino a 0,47 m (Corso Tredici Giugno), quasi sempre sotto 0,4; 47 archi passano da
  terra a in quota (27 fino a 6 cm: le strade laterali che salgono incontro alla rampa) e 99 tornano a terra. Dove un
  arco tocca appena 5 cm la pianta ritaglia l'asfalto a terra attorno al pezzo in quota (su Corso Boston ovest un
  cordolo nuovo sul bordo, veduta `tangenziale-boston-ovest`);
- per provare una modifica senza rigenerare: `python3 scripts/prova_risolutore.py --registro --mappa <file>` scrive la
  mappa di prova (5 minuti sul Mac con tutto il registro), e la funzione `gradini` di `tests/profili.spec.js` gira anche
  sulla città costruita in Node con `costruisci(poi, { mappa })` di `scripts/citta_node.mjs` (le aree in
  `<file>-aree/`, un collegamento a `public/mappa/aree`): 10 s, senza browser. Sulla mappa di main dà esattamente i casi
  di `data/eccezioni/gradini.json`; sulla mappa di prova del Mac 3 casi in più e 6 in meno, quindi si confrontano due
  mappe di prova tra loro. Con le sole strutture che interessano (`--struttura`) il passo dura una decina di secondi;
- `data/eccezioni/gradini.json` è diviso per meccanismo: le sette sovrapposizioni rimaste, una per gruppo con il suo
  perché (innesti su una salita, rampe che si staccano a pochi gradi e salgono); il terreno sulla larghezza (30, assi
  alla stessa quota entro 5 cm: #125); le pieghe tra archi di fila (16); un arco fuori dalla struttura.

#151, conche dei binari viste dal programma come dal controllo (20 novembre). Regola in [`cavalcavia.md`](cavalcavia.md),
sezione 6 (punto 5). Da sapere:

- la quota di un binario nel programma la dà `Profili.quota_binario`: la strada accanto (i `termini` di `lungo_binari`)
  dove sta più di `IN_QUOTA` sopra il terreno sotto il binario, se no quel terreno, come `profilo` di
  `scripts/quote_rete.py` scrive `tramH`. La usano il giro contro le onde e la prova. Il terreno è `P.nat`, quello
  adattato al profilo: la regola vale dal secondo giro del terreno (`P.adattato`), perché al primo il rilevato del DTM
  sulle spalle sta sopra il profilo e il binario ci finiva sopra (sulla campata del San Marco una conca finta di 0,9 m,
  e il giro alzava la campata di 0,8 m);
- da dove venivano gli 8-10 cm di Via Venezia: la conca del SIR2 ai piedi del viadotto (fondo in (3210, -831)) ha il
  fondo e il massimo a valle a raso, quota della rete 0,00. Lì `tramH` è zero e il binario segue le celle del terreno,
  in byte (gradini di 5,6 cm) e a 2 m dall'asse della strada: -0,65 m sul fondo e -0,52 sul massimo, contro -0,62 e
  -0,55 della strada sull'asse. Il programma vedeva 5-7 cm, sotto la soglia del giro (8 cm), il controllo 13-16. Del
  rilevato e del viadotto la conca ha solo il massimo a monte;
- la prova: `conche_binari` di `scripts/prova_risolutore.py`, nei punti dei binari del controllo, sulle strutture
  accese. Con la sola quota della strada esce con errore (sul San Marco 2 conche che il programma non vede, binario
  diverso fino a 0,48 m), con la regola passa. Tra le strutture di base della prova (lavoro `mappa` della CI) c'è ora il
  San Marco: Via Venezia e il Borgomagno hanno strade sotto le campate oltre 15 cm (#157) e farebbero fallire la prova;
- le quote non cambiano: le conche dei binari rimaste hanno il fondo a raso e il giro riempie solo sul rilevato. Con il
  registro sul Mac `edgeH`, terreno, `tramH` e `nodeH` escono identici a prima, e la mappa resta quella di #150. Il
  binario è ancora calcolato in due posti (il programma e `quote_rete.profilo`), con la stessa regola: la prova
  controlla che restino d'accordo.

#161, build della mappa più corta, seconda volta (25 novembre). Dopo #158 `rigenera` stava a 18 minuti su 20 sulla
macchina lenta della CI (AMD EPYC 7763) e la guardia dei 900 s avvisava già. Numeri per passo e per macchina in #161. Da
sapere:

- in CI le macchine hanno 4 processori, cioè 2 core: dividere un lavoro rende solo dove ci sono processori fermi (nel
  passo dei cavalcavia, che quasi tutto il tempo aspetta la soluzione più lunga di HiGHS, e accanto alla catena
  dell'asfalto `U` della pianta, che sta in un core). Conta il lavoro totale: con la prima parte il Mac (14 core) andava
  più veloce, ma in CI il passo dei cavalcavia era salito da 290 a 301 s perché il lavoro anticipato toglieva il core a
  HiGHS. Chi divide un lavoro misura sulla CI, non sul Mac;
- `Sfondo(nome, fn, nice=0, fili=None)` di `scripts/street_surfaces.py`: `fn` in un processo figlio nato per fork,
  mentre la build va avanti; il risultato torna per pipe (le geometrie in WKB, con tutte le cifre). Il figlio nasce
  solo se nel processo non c'è nessun altro thread; su macOS (senza `PIANTA_FORK=1`), con `PIANTA_PROCESSI=1` e dentro
  un figlio `fn` gira subito lì, con lo stesso esito. `fn` dipende solo da quello che c'è in memoria al fork e non
  cambia niente che la build usa dopo (nel figlio i cambiamenti si perdono). Nel figlio `in_parallelo` va in sequenza e
  `in_thread` usa `fili` thread; `nice` abbassa la priorità per un lavoro che serve molto dopo. Alla fine la build
  stampa, per ogni lavoro partito in sfondo, quanto è durato e quanto è stato aspettato (riga "lavori in sfondo"): un
  lavoro aspettato è sul percorso più lungo. Oggi: il SIR1 (`tram_sir1` di `scripts/build_map.py`, legge solo file)
  dall'inizio della build; `senza_quote` (unioni di edifici, acqua, verde, area del DBGT) prima dei cavalcavia, con
  `nice=10` e un thread; nella pianta `_quote_e_rete` (impalcati, asfalto e sede in quota, rampe a raso, carreggiate
  allargate, ponti, corsie occupate), i marciapiedi del DBGT con l'unione del marciapiede, il ritaglio degli edifici
  (`_ritaglia`), il marciapiede, gli alberi (`_alberi`) mentre si fanno i riquadri; dopo la pianta il controllo della
  partizione (`sovrapposte`), guardato prima di scrivere la mappa;
- `per_finestre(G, candidati, d, prova)`, per le domande "il candidato tocca `G` allargata di d?" e "quanta parte del
  candidato sta in `G` allargata?": `G` tagliata sul rettangolo dei candidati di ogni riquadro da 200 m, allargato di
  d + 2 m, e allargata solo lì. Dentro il rettangolo l'insieme è lo stesso; cambiano le ultime cifre delle
  intersezioni, non le decisioni (provate sulla mappa del 25 novembre: le stesse 267 isole su 623 candidati, mappa
  identica). Si usa solo dove il risultato è un sì o un no su un candidato che entra com'è (isole, carreggiate,
  parcheggi e marciapiedi del DBGT, golfi, alberi), mai dove la geometria allargata entra nella mappa (crepe, chiusure,
  ritagli, unioni);
- calcoli più leggeri con lo stesso esito: la sosta chiede alla sede del tram preparata, come primo argomento di
  `intersects`; i raccordi dividono i nodi con `in_parallelo` (`Raccordi.calcola`); `_tram_heights` guarda solo gli
  archi in quota della cella da 50 m del punto; `_anello` fa con numpy gli anelli lunghi (stessi termini dell'area,
  stesso `sum` di Python, vertice più piccolo tra quelli con la x entro 2 mm dalla minima); `Via` del risolutore dei
  cavalcavia fa la chiusura del terreno su tutta la griglia con `street_surfaces.closing` (massimi e minimi di interi),
  il controllo `scripts/cavalcavia.py` resta cella per cella (`Via.chiusa`); `LP.riga` aggiunge i termini con `extend`;
- quello che non si accorcia senza cambiare la mappa: le cinque soluzioni di fila della parte più grande del programma
  lineare dei cavalcavia (circa 250 s sulla macchina lenta: un altro metodo o un'altra partenza per HiGHS danno un'altra
  soluzione con lo stesso costo, nota #158); le operazioni di GEOS su `U` intera nella catena della pianta, che entrano
  nella mappa (divise per zone cambierebbero le ultime cifre); il passo delle linee (la cache di `dijkstra` in
  `build_map.main` dà risultati calcolati con un limite più largo, quindi l'esito dipende dall'ordine delle varianti);
- come si è misurato e provato: gli argomenti dei passi salvati con cloudpickle da una build nativa sul Mac (venv con
  il lock), la traccia per riga di `surfaces` (`sys.settrace` sul solo frame) e il profilo per funzione; poi ogni passo
  rifatto dagli argomenti salvati e confrontato con l'uscita di prima, e la build intera sul Mac con il codice di prima
  e con quello nuovo, in sequenza e con `PIANTA_FORK=1`, confrontata con `cmp` e `diff -r` (rete, aree, conto). La
  mappa del Mac non è quella della CI, ma prima e dopo sul Mac devono essere uguali; in CI lo dice il lavoro `rigenera`.

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

#110, elementi che spariscono (13 novembre): volumi col terreno, strati da vicino e da lontano, conto per area. I quattro
meccanismi dell'issue, con quello che si riesce a riprodurre oggi:

1. **Volumi senza quota.** Era #81. Il volume col terreno lo calcola solo `terrainVolume(o)` di `src/world/terrain.js`
   (sfera alzata della quota nel centro e allargata dell'escursione dentro di lei): la usano
   `Frustum.intersectsObject` e `intersectsSprite`, quindi vista, ombre e specchietti. Vale anche per gli oggetti con
   più materiali (se mescolano "via" e "fondo", tutta l'escursione) e per gli sprite, che oggi non ci sono.
   `tests/volumi.spec.js` prende ogni Mesh, Line e Points della scena con una corsa in servizio e tutta la mappa
   caricata (6.197 oggetti, 13,6 milioni di vertici, 0,4 s) e controlla che i vertici alzati stiano nel volume
   (`Terrain.volume`, `tests/volumi.js`): a zero, senza eccezioni. Vede anche una sfera vecchia: chi sposta le
   istanze di una `InstancedMesh` dopo il primo disegno rifà la sfera (`computeBoundingSphere`) o mette
   `frustumCulled = false`, come fanno traffico, pedoni e bus automatici (18 oggetti).
2. **Strati sullo stesso piano.** `polygonOffset` sposta uno strato in avanti di una quantità che cresce con la
   distanza e con l'angolo radente, mentre i centimetri di quota tra gli strati restano quelli: dove due strati si
   sovrappongono in pianta, da vicino vince il più alto e da lontano quello col numero di `layer()` più grande. In
   cima al San Marco, dove l'asfalto in quota sta pochi millimetri sopra la sede, il cambio comincia tra 20 e 30 m: da
   30 m cambia il 3% dei punti, da 300 m il 25%. `tests/strati.spec.js` (funzioni in `tests/strati.js`) disegna solo
   gli strati, ognuno col suo numero e con la quota in ogni pixel, e guarda il punto di ogni veduta da 20 m e da 300 m
   sulla stessa linea di vista (35 gradi sotto l'orizzonte, telecamera del gioco): circa 800 punti per veduta, 25
   secondi in tutto. Un caso è una veduta con una coppia di strati diversi su almeno 8 punti (3 m² circa); un caso
   dell'elenco resta finché ne ha 3. Oggi 9 casi in `data/eccezioni/strati.json`, tutti sui cavalcavia: l'asfalto in
   quota copre la sede del tram da vicino in cima a San Marco (200 punti su 800, la foto di #85), Chiesanuova e
   Borgomagno e sulla rampa di San Marco, e ai piedi della rampa del Camerini asfalto a terra e in quota si scambiano
   (prima dei profili di #84 era la Montà: il caso si è spostato e la prova lo ha detto).
   A terra (capolinea, rotonde, incroci con la sede, ponti) nessun caso. Li toglie la pianta come partizione, #126.
   Chi aggiunge uno strato sceglie il numero sapendo che vince da lontano su tutto quello che ha un numero più basso
   entro mezzo metro di quota.
3. **Geometria tolta per vicinanza** (`sedeSkip`, `offTram`). Oggi non dà sparizioni: su 659.517 punti dell'asfalto dove
   `onSede` toglie i segni, la sede disegnata c'è sempre entro 0,75 m. I casi passati (trattini sulla corsia rossa,
   lanterna di Via Tommaseo) sono chiusi, e `segni_sulla_sede` in `tests/mappa.spec.js` è a zero.
4. **Aree caricate attorno al mezzo.** Entro 1.500 m (`AREA_NEAR`) c'è tutto; tra 1.500 e 2.600 m (`AREA_FAR`, e fine
   della nebbia col sereno) c'è solo quello che si è già visitato. All'avvio della 24 da Mandria mancano 3.932 edifici
   su 4.340 in quella fascia e 121 su 1.416 tra 650 e 1.500 m (la partenza aspetta le aree entro 650 m); nello stesso
   punto la scena ha 17 aree e 3.561 edifici arrivando dal centro, 15 e 2.562 dopo essere andati a 6 km e tornati.
   `areasReady` conta come pronta anche un'area che non è arrivata (`failed`).

Conto per area (#110). `scripts/aree_mappa.py` scrive con le aree `data/conto-aree.json`: per ogni area quanti edifici,
poligoni di marciapiede e di verde e alberi ci sono, una riga per area, così il diff di una rigenerazione dice quali aree
sono cambiate e di quanto. Il gioco non lo legge. `City.addArea` tiene in `A.conto` quello che ha contato caricando
l'area, e `tests/aree.spec.js` (funzione in `tests/aree.js`) confronta conto della build, `A.conto` e scena (edifici nei
riquadri più quelli tolti dai depositi, una mesh di marciapiede e una di verde se l'area ne ha, tronchi, chiome e
ostacoli per gli alberi fuori da strade e binari, riquadri e mesh in scena) alla partenza, con tutte le aree entro
1.500 m, a 6 km e al ritorno; a zero, senza eccezioni. `scripts/verifica_mappa.py` confronta il conto con i file delle
aree. Chi rigenera la mappa con `build_map.py` ha il conto riscritto; chi cambia i file delle aree in un altro modo
lancia `python3 scripts/aree_mappa.py conta src/data/padova-map.json`.

Pianta a terra come partizione, misura di partenza (#110). `scripts/verifica_mappa.py` misura per riquadro da 800 m i
metri quadri dove asfalto, marciapiede e isola della pianta si sovrappongono (`pianta_sovrapposta_m2`: 14.599 m² tra
asfalto e marciapiede, 1.628 tra asfalto e isola, 29 tra marciapiede e isola) e il verde che sta sotto di loro
(`verde_coperto_m2`, 471.510 m²), con i valori di oggi in `data/eccezioni/verifica-mappa.json` e 20 m² di tolleranza.
Le carreggiate in quota non entrano: passano sopra le strade a terra, e le guarda la prova degli strati. Da #126 la
pianta a terra è una partizione (nota #126 qui sotto): le due misure sono a zero, gli elenchi vuoti, e `build_map.py`
si ferma se due classi si sovrappongono (`street_surfaces.sovrapposte`).

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

#114, percorsi delle linee controllati nella build (17 novembre). Regola, cosa fa la build e controllo in
[`percorsi.md`](percorsi.md). Da sapere:

- `scripts/percorsi.py` controlla ogni variante: salti, archi contromano fuori dalle corsie dei bus in controsenso,
  inversioni sullo stesso arco, svolte che OSM vieta anche ai bus, svolte senza un raccordo per il mezzo della linea.
  Lo lancia `build_map.py` alla fine, con la mappa già scritta, e si ferma su un caso fuori da
  `data/eccezioni/percorsi.json` o su uno dell'elenco sparito: `scripts/rigenera_mappa.sh` esce allora prima della
  posa dell'arredo, e il job `rigenera` è rosso. Lo lancia anche `scripts/verifica_mappa.py`;
- i controlli dei percorsi che stavano altrove sono qui: `bus_senza_raccordo` di `scripts/raccordi.py` (in
  `percorsi.py` è `senza_raccordo`, per variante e non per linea) e `percorsi_su_svolta_vietata` di
  `scripts/osm_rete.py`. Il gruppo "solo auto" e "senza curva" (#134) ora sta in `percorsi.json`;
- in `build_map.py`: `osm_rete.correggi` subito dopo la lettura degli scarichi (`data/osm-correzioni.json`); l'aggancio
  OSM per id (`agg`, `osm_campi`) si fa prima dell'aggancio delle linee, perché la riparazione usa le svolte; l'aggancio
  per pezzi parte anche per i salti e per i giri lontani dal tracciato (`giro`, `GIRO_SCARTO`, `GIRO_LUNGO`, `BUCO`);
  `ripara` dopo `cut_path`. I percorsi senza niente da riparare escono uguali;
- quello che cambia nei percorsi: il controsenso dei bus in Corso del Popolo (33 varianti, nessun nodo diverso, cambia
  il flag di tre archi); la 4 tra Pontevigodarzere e Cadoneghe è tagliata alla rotonda che non c'è (cinque varianti);
  la 19 non salta più 440 m a nord di Pontevigodarzere (tre varianti, una fermata in meno); la 22 entra nel golfo del
  capolinea di Mandria dall'ingresso; al Capolinea Plebiscito la 16 e la 24 fanno il giro attorno al palazzetto come i
  sensi unici, senza avanti e indietro; la 15B a Largo Europa non fa due volte il giro dell'isolato; la 11B finisce
  23 m prima, prima della carreggiata contromano verso la rotonda di Via Montà; la 12 e la 6 (sette varianti) partono
  95 m prima in Via Sorio, dove l'aggancio per pezzi ha tolto il giro di #36 dal tracciato agganciato;
- con i percorsi cambiano i dati della pianta che li seguono (carreggiate allargate per i bus, svolte strette a
  sinistra, `bus_edges`) e, attraverso la pianta, bordi di marciapiede e righe della posa anche lontano (#139, con le
  misure di questa rigenerazione): posa rifatta con `--tutta` (90 righe), metri quadri per riquadro riscritti in
  `data/eccezioni/verifica-mappa.json`, un edificio che sfiora la carreggiata di 0,2 m a (-504, -575) e una corsia di
  Via Ariosto fuori dall'asfalto di 3 cm entrati nei gruppi che c'erano. Nei raccordi, al Piazzale Castagnara, la
  corsia di sinistra dell'arco di 3,6 m di Via Pontevigodarzere a (1410, -4601) resta senza curva per le auto: lo
  spazio degli archi corti va alla svolta della 4, che arriva ora dalla carreggiata e non più dalla stradina di
  servizio (gruppo degli archi corti di `auto_senza_uscita`).

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
- `Traffic.untangle`, dopo il passo di tutte: da ogni auto ferma da almeno 1 s segue `lead` (al più 9 auto, da #113 30, tutte
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
all'orario (al più un minuto). Dal 19 novembre non alle fermate sulla sede del tram (#127, nota "Sosta breve" sotto). Dal 12 novembre (#64) anche i tram automatici in anticipo vanno all'andatura normale e
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

Pali delle lanterne del tram fuori dalla strada (#97, `area:tram`, 13 novembre; da #109 la ricerca gira nella build,
`Posatore.lanterna` in `src/world/posa.js`, e `buildHeads` legge il risultato): `TramSignals.buildHeads(scene, city)`
mette il palo con `City.poleSpot` (sul marciapiede, su un'isola o sul verde, fuori dalla sagoma di ogni binario), a
destra fino a 14 m e fino a 6 m prima, se no a sinistra fino a 12 m; oltre 4 m a destra la lanterna sta su uno sbraccio
a `MAST_Y`, a `TRAM.lane` + 0,6 m dal binario. Senza posto per un palo è appesa al tirante della linea aerea più vicino
fino a 30 m prima (`city.tramSpans`, 30 lanterne), e senza neanche quello accanto alla sede fuori dalla sagoma. `hd.pole`
dice dov'è il palo (null se appesa), per `tests/pali.js`. Logica, stati e `drawHeads` non cambiano; le luci (`hd.pos`)
si spostano col palo. `buildHeads` passa da circa 38 a 100 ms con SwiftShader.

Stato di partenza a ogni corsa (#122, 13 novembre, da `area:verifiche`): `TrafficLights.reset(time)` rimette ogni
semaforo al ciclo della costruzione (`offset0`) senza fase tram in corso, `TramSignals.reset()` toglie chiamate e via
libera rimasti, `BusSim.setService` risemina `rnd`; li chiama `startMission`. Chi aggiunge stato a queste classi lo
rimette lì, altrimenti le prove del traffico tornano a dipendere dalle corse fatte prima sulla stessa pagina.

Raccordi di corsia agli incroci (#112, 16 novembre). Regole, formato e controlli in [`raccordi.md`](raccordi.md). Da
sapere prima di #113 e #114:

- la build scrive nella rete il campo `raccordi` (`scripts/raccordi.py`, chiamato da `build_map.py` dopo la pianta delle
  strade); il gioco lo porta in `net.raccordi` (da #113 lo seguono auto e bus automatici, nota sotto);
- le corsie dei raccordi sono quelle di `laneLayout`. Oggi le auto vanno a `driveOffset` (la corsia più a destra non
  riservata, che coincide) o, senza corsie OSM sui doppi sensi, a un quarto della carreggiata, che sopra i 7,5 m non è
  l'asse della corsia disegnata; i bus automatici a `laneLat`. Chi segue i raccordi sta sulle corsie disegnate;
- un raccordo può scavalcare archi corti (`via` nel formato): chi sceglie il percorso lo sceglie al nodo dove il
  raccordo comincia e arriva direttamente sull'arco `a`. Dopo un raccordo ce n'è sempre un altro, tranne in fondo alle
  strade chiuse, al bordo della mappa e nei casi di `auto_senza_uscita`;
- sul percorso di una linea lo stesso movimento può avere il raccordo delle auto e uno più largo per i soli bus: il bus
  prende quello con il suo bit;
- le inversioni sullo stesso arco non hanno raccordo, nemmeno in fondo alle strade chiuse;
- `window.__game.laneLayout` c'è per `tests/raccordi.spec.js`.

Sosta lungo le strade (#111, 16 novembre), per #113. Dove gli stalli stringono la carreggiata l'arco ha `e.sede`
(`sedeCorsie` della mappa) e `laneLayout` mette le corsie lì dentro; i raccordi di #112 sono calcolati su quelle corsie.
Il traffico è stato toccato con il minimo che serve:

- `Traffic.laneGeom`: sugli archi con `e.sede` l'auto sta su `driveOffset` anche senza corsie OSM; sugli altri resta a
  un quarto della carreggiata. `laneLat` di `buses.js` fa lo stesso per i bus automatici (prende il verso di marcia).
  Chi segue i raccordi sta già sulle corsie disegnate e non ha bisogno di nessuno dei due;
- le corsie di due catene di fila possono avere scostamenti diversi (una ha gli stalli, l'altra no): al nodo l'auto
  cambia scostamento come oggi quando cambia la larghezza. Con un percorso continuo lo scarto sta nel raccordo;
- la zona di fermata libera dagli stalli è 42 m prima del bus fermo e 32 m dopo la palina, più dei 12 + 12 m
  dell'art. 151, perché i bus automatici accostano tutti interi con `b.lat` (da 30 m prima con il muso, rientro in
  18 m), il pilota delle prove da 40 m prima, e la palina posata dal gioco sta fino a una decina di metri da dove la
  fermata dei dati si proietta sul percorso. Dove passa una linea servono anche 3,50 m per corsia e zone libere più
  lunghe a incroci, gomiti e cambi di carreggiata, perché `buildLane` smussa la corsia del bus. Un inseguitore che sposta un asse alla volta può entrare in diagonale
  dopo l'ultima auto: allora `FERMATA_INGRESSO` e `FERMATA_USCITA` di `scripts/sosta.py` tornano a 12 e 12, e
  `tests/sosta.spec.js` (accosto da 30 m prima a 18 m dopo) va cambiato insieme;
- `tests/sosta.spec.js` controlla che nessuno stallo stia nelle corsie delle auto né nella carrozzeria dei bus lungo
  `lane.P`: chi cambia dove passano auto e bus lo aggiorna con il nuovo percorso (con #113: sotto);
- un caso noto in `data/eccezioni/sosta-gioco.json`: al Capolinea Mandria il bus della 22 sfiorava uno stallo su un arco
  fuori dal percorso, lungo la strada che `buildLane` aggiunge prima e dopo il capolinea (`lead`, `exit`), che la build
  non conosce. Tolto con #113;
- `laneLat` e lo spostamento dal binario del tram (`room` in `buildLane`) hanno preso `e.sede`;
- `tests/traffico.spec.js`, Porta Trento: le due curve si sono spostate con le corsie più strette. L'attesa a vicenda
  si prepara con le auto a 0,6 e 0,55 delle curve (erano 0,6 e 0,32) e passa per prima chi va in Via Belfiore;
- le auto ferme non sono viste dal traffico: stanno fuori dalle corsie per costruzione. Un'auto che esce dalla corsia
  (sorpasso di un bus fermo, `untangle`) non le evita.

Inseguitore di percorso (#113, 16 novembre). Auto e bus automatici seguono lo stesso percorso continuo, fatto degli assi
delle corsie di `laneLayout` e dei raccordi della build, con `src/world/inseguitore.js` (regole in
[`raccordi.md`](raccordi.md), sezione 7). Prima posizione e direzione si calcolavano separate: gli spostamenti di lato
(`latOff`, `tramOff`) valevano subito, la direzione `c.h` seguiva con un ritardo, a fine svolta la posizione saltava
sulla corsia e `turnPath` inventava la curva (una quadratica col vertice sull'incontro delle corsie, o a metà strada se
non c'era). Da sapere:

- il centro dell'asse posteriore sta sul percorso alla progressiva `q` (auto: `c.q`, 1,35 m dietro al centro; bus:
  `b.q = b.s - 2,6`), la direzione è la tangente più la pendenza dello scostamento (`posa`). Nei raccordi il mezzo gira
  con il loro raggio; nei bus il muso esce dalla curva come nel bus di chi guida (prima i due assi stavano tutti e due
  sulla corsia, e in curva il bus andava di traverso rispetto alle ruote dietro);
- lo scostamento di lato (`lat` a destra, `pend` metri per metro) è il sorpasso, lo spostamento fuori dalla sede del
  tram e l'accosto alle fermate: cambia al più di 0,15 (auto) e 0,12 (bus) metri per metro, con la curva entro metà
  del raggio minimo, e nei raccordi stretti resta fermo (`scosta`). Il cambio di corsia invece è un tratto del
  percorso (`tratto`, una cicloide). I bus non spostano più i punti della corsia per stare fuori dai binari: lo
  spostamento calcolato in `buildLane` è il bersaglio dello scostamento (`L.shift`);
- auto: `Traffic.movimenti(e, fwd)` sono i movimenti dei raccordi con il bit delle auto; `chooseNext` sceglie tra loro
  (vicoli ciechi e pozzi come prima, ora sui movimenti: senza inversioni sullo stesso arco), `estendi` allunga il
  percorso 90 m avanti con la corsia scelta anche per la svolta dopo (`scegli`), `segui` dice dove sta l'auto (`c.edge`,
  `c.fwd`, `c.s` del centro sulla corsia; nel raccordo `c.turn = { next, rest, len }`). Le linee d'arresto dei semafori
  sono progressive del percorso (`c.ev`, `lineeArresto`): valgono anche quando il raccordo comincia prima della linea.
  In fondo a una strada chiusa l'auto si ferma e, lontano da chi guida, esce di scena. Per le prove `Traffic.nuova` e
  `Traffic.inCurva`; `along` campiona il percorso;
- bus: `percorsoBus` prende per ogni svolta del percorso un raccordo con il bit del bus da 12 m e sceglie le corsie su
  tutto il percorso (meno cambi, sempre con il posto, a destra quando si può); `buildLane` campiona il percorso ogni
  2 m (ogni metro nei raccordi) con la progressiva vera (`P.cum`), e fermate, semafori, incroci col tram e velocità
  restano calcolati su quei punti. `walk` (avvicinamento e uscita) preferisce le svolte con il raccordo del bus.
  `BusSim.ahead`: il di lato dell'ostacolo si confronta con lo scostamento che il bus avrà arrivandoci (verso
  `b.latT`, al più 0,12 m per metro; prima lo scostamento di adesso, sommato invece che tolto), anche durante il
  sorpasso di chi gioca, che prima si ignorava: con lo scostamento che cambia solo andando avanti, il bus automatico
  della 24 al capolinea di Largo Debussy tamponava il bus di chi guida e lo spostava da sotto la colonnina
  (`tests/elettrico.spec.js`). Se non c'è spazio per spostarsi di lato, aspetta;
- `tests/pali.js` (area Mappa, #109): l'ingombro dei bus automatici è messo come il nuovo `BusSim.place` (asse
  posteriore sulla corsia, direzione della corsia lì). In `data/eccezioni/mappa-gioco.json`, `pali_nell_ingombro_dei_bus`:
  rispetto a `main` dopo #114 spariscono i casi della coda che tagliava l'angolo (Prato della Valle, Due Palazzi,
  Albignasego), 16 dei 26 pali sulle rampe del Chiesanuova e di Via Venezia e uno di Via Venezia; arrivano quattro casi
  del muso che in curva esce oltre il cordolo (#130), sei di bus su curve di ripiego (#135, #114, #134), quattro della
  10 sul Cavalcavia San Marco fuori dall'asfalto (#131), la lanterna del tram in mezzo alla rotonda Rosetta Gagliardi
  e un palo della rampa del Chiesanuova. La palina del Capolinea Plebiscito, che #114 aveva messo tra le code in
  curva, è il bus al primo punto della corsia della 16 con la coda che sporge sopra la palina: gruppo a parte;
- `tests/sosta.spec.js` (#111): le corsie delle auto sono quelle di `laneLayout` (o la corsia sola di `corsie()`), la
  carrozzeria dei bus è messa come `BusSim.place`. In `data/eccezioni/sosta-gioco.json` (il caso del Capolinea Mandria
  l'hanno tolto i percorsi di #114) arrivano cinque stalli subito dopo una svolta (linee 3, 6, 11 e 11B): con l'asse
  posteriore ancora nel raccordo il muso esce verso l'esterno della curva, fino a 1,2 m dentro lo stallo. Li toglie
  `scripts/sosta.py` quando conosce l'ingombro dei bus in svolta (#130);
- `tests/profili.spec.js` (area Mappa): il pilota sta nelle corsie dove gli stalli stringono la carreggiata (`e.sede`),
  come quello di `tests/guida.js` dopo #111. Sul Cavalcavia Montà, a un quarto della carreggiata, il fianco del bus
  passava fino a 44 cm sopra le auto in sosta: in una serie completa il pilota si è fermato lì, da sola la prova
  passava;
- ripieghi, dove manca il raccordo per il mezzo: dichiarati sul pezzo (`p.ripiego`), contati in `BusSim.ripieghi` e
  `Traffic.ripieghi`, e nella chiave dei casi della prova del moto;
- `turnPath`, `startTurn`, `routeAt`, `laneGeom`, `laneLat`, `latOff` e `tramOff` non ci sono più (con loro i ritocchi di
  #111 per `e.sede`: le corsie di `laneLayout` gli stalli li hanno già); lo spostamento dai binari dei bus tiene il
  limite di #111 a destra (`e.sede`);
- andatura delle auto in curva: √(3 · r) nel raccordo (3,4 m/s nelle rotonde piccole, 6,7 m/s con 15 m di raggio),
  frenata di 2 m/s² prima. Con 2 m/s² la rotonda di Via Bembo con Via Marinelli, sulla 3 da Lion, smaltiva troppo poco:
  il bus di chi guida restava in coda oltre 150 s e la prova di Tito Livio finiva lì. Nella stessa rotonda l'anello si
  riempiva con un giro di attese di 10 auto, e `untangle` ne seguiva al più 9: ora 30;
- uscita dalle rotonde (`chooseNext`): nell'anello restare pesa quanto le uscite che restano prima di tornare al nodo
  d'ingresso (`T.giro`, `restanti`), e lì non si resta. Prima a ogni nodo l'anello, via principale, pesava 4 contro 1
  di una traversa: in Node, attorno alla rotonda di Via Bembo, il 10% delle auto faceva più di un giro e in una
  rotonda di Via Salboro si arrivava a sei giri. Ora nessuna ripassa sullo stesso arco dell'anello. Il nodo d'ingresso
  è quello dove comincia l'arco d'anello raggiunto: il raccordo d'ingresso può scavalcare archi corti. La rotonda di
  Via Bembo resta al limite: in Node ci sono in media 9 auto nell'anello, prima e dopo questa regola. L'anello (7
  archi, una quarantina di metri) ha raccordi da 3,8 a 5,2 m ai nodi, dove le auto vanno a 3,4-3,9 m/s. Con la sola
  correzione dei giunti dei raccordi (sotto) la prova di Tito Livio si fermava lì, con questa passa: un cambiamento
  piccolo del traffico può farla tornare;
- giunti dei raccordi: i vertici della build sono al centimetro e i capi delle curve stanno fino a 2 cm di lato
  dall'asse della corsia; `Curva.at` porta lo scarto a zero ai capi ([`raccordi.md`](raccordi.md), sezione 7). Con
  la mappa del 17 novembre (#124) un'auto a passo d'uomo passava da un raccordo all'altro con un passo laterale di
  millimetri: 10,8 gradi tra direzione e moto nella prova del moto (in Node 8 mm a 1,2 m/s, 11 gradi);
- la prova delle auto in svolta che si aspettano (#79) era a Porta Trento, dove la svolta da Via Bezzecca in Via
  Belfiore non ha un raccordo delle auto: ora cerca le due auto all'incrocio di Via Gattamelata con Via Tartini, dove
  due raccordi delle auto si incrociano a 1,5 m (`stallo` in `tests/traffico.spec.js`);
- la prova del moto (`tests/moto.spec.js`, regole in `tests/moto.js`) era rossa su `main` prima della modifica: numeri
  di prima e dopo nell'issue #113. Restano 99 posti, tutti bus su ripieghi: 60 raccordi delle auto (#134), 31 corsie
  che non si legano tra svolte vicine (#135), 8 curve del gioco dove la rete non ha la svolta (#114 e #134; con i
  percorsi corretti di #114 è sparita quella vicino al Capolinea Mandria). Le auto
  non hanno casi. `tempoMassimo(310)`: tre volte la durata della prima serie in CI (1,7 minuti il 17 novembre,
  461b4ce, con la serie intera in 26 minuti); in locale 1,2-1,5 minuti.

Code vere (#115, 17 novembre). Chi segue chi è uno solo per auto e bus automatici, e una coda non entra in un incrocio
che non può liberare. Prova in `tests/code.spec.js` (regole in `tests/code.js`, casi noti in `data/eccezioni/code.json`),
scritta prima della modifica: numeri di prima e di dopo nell'issue #115. Da sapere:

- IDM vero in `src/world/inseguitore.js` (`idm`, `IDM_AUTO` a 1,6 m/s², b 2, s0 2 m, T 1 s; `IDM_BUS` a 1,1, b 2, s0 3,
  T 1,5), con la differenza di velocità da chi c'è davanti. Prima la distanza voluta delle auto aveva v² al posto di
  v · Δv e i bus seguivano a 3 m a ogni velocità. Sul corridoio di Via Querini (auto a 9 m/s) la corsia porta 1.390
  auto l'ora a 48 auto per km con le auto che entrano ogni 2,2 s (prima al più 900, a 37,5 per km), e al verde una coda
  ferma si scarica a un'auto ogni 2,16 s (prima 3,79 s). Il numero di auto e la domanda per ora sono di #116 e #117;
- il mezzo davanti è quello davanti lungo il percorso (`Traffic.davanti`, sostituisce la ricerca in linea retta 33 m
  davanti al muso): auto entro 1,7 m dal percorso campionato ogni 2 m, pezzi dei bus entro 2,6 m, tram come prima;
  `c.spazio` dice fin dove la fila davanti lascia andare l'auto, `c.aspetta` chi la tiene ferma, `c.tramAttesi` i
  tram che aspetta, anche attraverso la coda. Due auto con i centri a meno di 1,7 m nello stesso verso (si sono unite in
  una svolta o nella rotonda) non si vedevano e restavano unite (#80): passa quella nata prima (`c.n`, al posto di
  `Math.random()` per l'ordine);
- l'incrocio da liberare (`incrocioDavanti` di `inseguitore.js`, regola in [`raccordi.md`](raccordi.md), sezione 8):
  auto e bus si fermano prima se oltre, fino a dove si fermerà la fila (`spazio` di auto, bus e tram), non ci stanno;
  il giallo oltre l'incrocio vale come il rosso; nella rotonda conta il posto dopo l'ingresso, e dentro l'anello si è
  già nell'incrocio (rifatta a ogni nodo, l'anello di Via Bembo con Via Marinelli si fermava in giro);
- sblocchi: le auto non sorpassano più un bus automatico fermo fuori dalla fermata (prima dopo 12 s, anche in coda al
  rosso); un bus fa sparire l'auto davanti solo se lei aspetta lui (prima dopo 15 s, anche al rosso); `carT` solo se
  l'auto aspetta quel tram, anche attraverso la coda o i binari che lui ha chiamato (prima dopo 20 s). Il bus di chi
  gioca fermo appena oltre un incrocio si sorpassa anche quando la regola dell'incrocio tiene ferma l'auto. Restano
  `unstick`, `busT` (90 s; 4 s se il bus aspetta il tram), bus contro bus (8 s) e `untangle`: nella prova di 10 minuti
  non scattano, o il caso è in `data/eccezioni/code.json` con il perché;
- tram: chi c'è davanti lo è lungo il binario (`projectNear`), e un'auto con la sagoma (muso, centro e coda entro 1,9 m
  dal binario): in linea retta il tram vedeva davanti le auto ferme accanto ai binari ad aspettare lui;
- chi è sul binario davanti al tram che chiama un incrocio non aspetta la chiamata, va avanti e lo libera
  (`TramSignals.davantiAiTram`, per le auto in `calledAhead` e `carGap`, per i bus in `move`): sul Ponte Omizzolo la
  corsia delle auto è sul binario del SIR3, e auto e tram si aspettavano;
- `tramShift` guarda i binari per verso: prima si sta a 3 m da quello in controsenso, poi da quello nel proprio. In Via
  Gozzi, Via Morgagni e sul Ponte Omizzolo le corsie delle auto sono sopra i due binari del SIR3 e l'auto lasciava il
  binario del suo verso per quello del tram che arrivava di fronte;
- rotonde a due corsie: entrando l'auto prende la corsia esterna dell'anello, se la build ha il raccordo (`scegli`); se
  dalla sua corsia non c'è posto per cambiare corsia prima di nessuna uscita, `chooseNext` la fa uscire alla prima con
  una curva del gioco (ripiego contato). Nella rotonda di Via Bembo con Via Marinelli i raccordi entrano solo nella
  corsia interna ed escono solo dall'esterna, con archi di 5-7 m: le auto giravano per sempre, l'anello si riempiva e
  la coda arrivava al bus della 3 nella prova di Tito Livio (su main la nascondevano le code più rade e `untangle`).
  Da #143 non c'è più: nota sotto;
- `avviaCorsa` (`tests/gioco.js`, area Verifiche): la partenza si rimette a zero anche prima del verso. Prima la prima
  prova di ogni worker partiva alle 8:26 e le altre alle 8:14, e l'esito dipendeva dall'ordine delle prove;
- tempo per passo, 72 auto, nella prova delle code: `traffic.update` da 0,55 a 0,6-0,77 ms, `buses.update` da 0,33 a
  0,23-0,35 ms (macchina carica, load 8-25).

Domanda di traffico (#116, 17 novembre). Regole, numeri, verifica sul GTFS e prova in [`domanda.md`](domanda.md). Da
sapere prima di toccare il traffico:

- ogni auto nata dalla corsa ha `c.viaggio` (`o`, `d`: luoghi della domanda, zone e poi porte; `arrivo`: lo stato,
  `2 · arco + verso`, dove finisce; `albero`: l'albero dei tempi dell'arrivo di `Domanda`). Le auto delle prove fatte
  con `Traffic.nuova` non ce l'hanno e scelgono come prima (`pesoVia`, rotonde, vicoli ciechi e pozzi);
- `Traffic.chooseNext(edge, fwd, T, v)`: con il viaggio, tra i movimenti da cui l'arrivo si raggiunge, quello che arriva
  prima (`Domanda.costo`: movimento, albero, ritardo misurato); la corsia conta solo per scegliere tra quelli che ci
  si possono fare. In `estendi` per le auto con un viaggio la svolta dopo si sceglie prima della corsia (`scegli(T, m,
  m2)`): scegliendo prima la corsia, su un arco di 11 m di Via Sorio l'auto finiva in un anello laterale e ci girava
  (sotto, `versoArrivo`).
  L'arrivo (`cambiaViaggio`): il viaggio dopo parte dalla zona d'arrivo; `c.arriva` è la progressiva dove l'auto,
  lontano da chi guida, esce di scena (contata in `Traffic.ripieghi` come `arrivo`);
- `Traffic.target` resta il numero massimo (72, `AUTO_SIMULATE` in `main.js`; le prove che lo mettono a 0 spengono le
  auto come prima); `Traffic.quante` e `Traffic.raggio` li decide la domanda per l'ora e il posto; le auto oltre
  `raggio + 250` escono di scena (erano 1.700 m). `Traffic.centro` mette il disco altrove (prove); `Traffic.popola`
  fa le auto della partenza (in `startMission`, al posto delle `count` chiamate a `spawn`); le auto con `c.sonda` non
  escono per la distanza;
- `traffic.update` riceve `ctx.clock` e `ctx.giorno` (in `main.js`); `Domanda.passo` avanza gli alberi di 4.000 stati
  per passo e `Domanda.reset` (in `startMission`) li toglie: chi aggiunge stato a `Domanda` lo rimette lì, come per
  #122;
- `Traffic.davanti` (di #115): tra due auto unite nello stesso punto la più giovane non cede più alla più vecchia se
  questa aspetta proprio lei, e chi esce da un giro di attese (`through`) passa anche lì. A Piazzale San Giovanni, con
  la densità vera delle 8, la più giovane cedeva alla più vecchia, che la vedeva un metro davanti e la aspettava, e la
  coda di Via Sorio restava ferma oltre dieci minuti;
- per le auto con un viaggio la svolta dopo si sceglie senza guardare la corsia (`versoArrivo`) e poi la corsia per
  farla; dove non ci sta un ripiego, come prima. Con 60 s di penalità per le svolte che dalla corsia non si fanno le
  auto dirette alla porta di Via Sorio deviavano in un anello di strade laterali e lo riempivano;
- le prove del traffico cambiano: a parità di ora le auto sono le stesse 72 o poche meno, ma stanno in un disco di
  300-700 m invece che fino a 1.700, sui percorsi dei loro viaggi, quindi gli incontri e le code sono altri.
  `traffic.update` costa 1,1 ms per passo invece di 0,8 (tabella in [`domanda.md`](domanda.md), sezione 9). Nella prova
  dei dieci minuti delle code le code al rosso risalgono gli incroci vicini e ci restano dentro (Via Gozzi, Via
  Tommaseo, Via Piovese: otto casi, #148); nella prova del moto restano solo le auto sui ripieghi della rotonda di Via
  Marconi (#143). La prova delle punte (`tests/domanda.spec.js`) è una misura aggregata con margine, non un elenco.

Rotonde a due corsie (#143, 18 novembre). Regola in [`raccordi.md`](raccordi.md), sezione 3 (corsie nell'anello e
punto 7). Da sapere prima di toccare raccordi o scelte delle auto nelle rotonde:

- nell'anello la build fa proseguire ogni corsia sulla corsia allineata e su quella appena più esterna (`coppie` di
  `scripts/raccordi.py`). Prima, dove un'uscita era più allineata dell'anello, l'anello era una svolta a sinistra e
  proseguiva solo la corsia interna; e con archi di 4-9 m tra un braccio e l'altro la corsia interna non aveva il posto
  per passare all'esterna, da cui si esce (√(4π · 3,75 · 3,8) + 0,5 = 14 m). I raccordi verso la corsia esterna non
  chiedono spazio lungo le corsie (`spazi` li salta, `cambio` sul movimento): prendono quello che resta, quindi gli
  altri raccordi cambiano solo dove la prosecuzione da ogni corsia è nuova;
- la build toglie le auto dai raccordi che le portano in una corsia dell'anello da cui nessuna uscita si raggiunge
  (`trappole`, `senza_trappole`), con il posto per cambiare corsia di `costoCambio` di `src/world/inseguitore.js`
  (`cambio_min`: chi cambia l'uno cambia l'altro), e `python3 scripts/raccordi.py` lo controlla sul campo scritto
  (`rotonde_senza_uscita`, elenco vuoto). Solo per le auto: i bus seguono i percorsi delle linee (#134, #135). Oggi
  l'anello tolto alle auto è uno, a Via Telemaco Signorini (1005, -3864), con le uscite solo per i bus (una via
  riservata, una svolta vietata alle auto da OSM): le sue corsie in `auto_senza_uscita` sono `accesso`;
- `Traffic.chooseNext` non fa più uscire alla prima con una curva del gioco chi nell'anello non ha un'uscita dalla sua
  corsia (la regola di #115 sopra): prosegue, e un'uscita c'è sempre. `scegli` nell'anello, a parità di cambi di
  corsia, prende la più esterna (mezzo cambio di corsia di costo per ogni corsia più in là); prima la corsia esterna
  si imponeva solo entrando, anche quando dalla corsia dell'auto non ci si arrivava. Con un viaggio, `versoArrivo`
  nell'anello sceglie prima le svolte che dalla corsia si fanno: chi non ha fatto in tempo a passare alla corsia
  esterna fa un altro giro;
- bus: con la prosecuzione da ogni corsia e i passaggi alla corsia esterna anche i bus automatici hanno più raccordi
  nelle rotonde. Su tutte le varianti (corsie di `BusSim`, in Node) i posti con un ripiego passano da 281 a 234; ne
  compaiono 8 dove le corsie di due svolte vicine non si legano (#135) e uno a Via Telemaco Signorini, dove la 4 usava
  il raccordo delle auto tolto e ora fa una curva del gioco (#134);
- prova del moto (`data/eccezioni/moto.json`): spariscono i 5 casi delle auto nella rotonda di Via Marconi e 19 di bus
  negli anelli (17 di #135, 2 di #134); ne arrivano 7 di bus nelle rotonde di Via Marconi, Via Facciolati e Corso delle
  Tre Venezie, dove il bus ha ora il raccordo suo ma la svolta dopo parte da un'altra corsia (#135), e 2 di auto al
  Ponte Omizzolo verso Via Gozzi, dove i raccordi sono quelli di prima e cambia solo il traffico (stessa causa, per le
  auto con un viaggio, che scelgono la svolta senza guardare la corsia);
- altre prove del traffico, con i viaggi un poco diversi (la domanda rifatta sui raccordi nuovi cambia `od` e `tempi`):
  impronta riscritta; in `code.json` il giro auto-tram del Ponte Omizzolo (#144) non si forma più e cambiano gli
  incroci dove resta la coda (#148: Via Piovese con Via Lazzaro Mocenigo, Via Gozzi con Via Tommaseo invece di un
  incrocio più indietro della stessa coda, il nodo di Via Altinate con Via Falloppio); `traffico.json` resta vuoto (la 22
  a Riviera dei Ponti Romani, #127, si ferma 52 s; sulla mappa di prima di #125 si fermava 62 s); `mappa-gioco.json`
  senza due pali che i bus delle rotonde di Via Gattamelata e di Albignasego non toccano più. `tests/domanda.spec.js` (#116)
  conta tra le auto con un viaggio anche quelle che l'hanno già finito (`c.arriva`): alle 8:15 la 138 nasce a pochi
  metri dal suo arrivo, in fondo a Via Rismondo, una strada chiusa da cui il viaggio dopo non si fa (`domanda.py` mette
  gli arrivi anche in fondo alle strade chiuse), e resta senza. Su main Via Rismondo è chiusa uguale: alle 8:15
  nessuna auto ci nasceva vicino al suo arrivo.

Sosta breve alle fermate sulla sede del tram (#127, 19 novembre). Decisione nell'issue: dove la corsia della fermata è
anche il binario, un bus automatico in anticipo fa solo salita e discesa e riparte; alle altre fermate aspetta l'orario
come prima (al più un minuto); il bus di chi guida non cambia. Da sapere:

- il dato è `st.sede` delle fermate di una corsia (`L.stops`), calcolato una volta in `buildLane` di
  `src/world/buses.js`: il bus fermo (muso a `fs`, scostato di `extra` più lo spostamento dai binari `L.shift`, messo
  con `posa` come lo mettono `move` e `place`) ha uno dei suoi pezzi (`PEZZI`, gli stessi di `updateParts`) a meno di
  `ASSE_SUL_BINARIO` da un binario di `city.tramLanes`. `ASSE_SUL_BINARIO` (2,2 m, in `src/tram/tram.js`) è la regola
  con cui `TramSim.move` guarda chi ha davanti: prima era un 2,2 scritto lì, ora è la costante, e chi la cambia cambia
  anche le fermate sulla sede;
- perché non nella build: dove si ferma un bus automatico (corsia del percorso, accosto, spostamento dai binari) lo sa
  solo `buildLane`. La palina della posa (`allStopPlacements`) ha la retta del cordolo dove si ferma il bus di chi
  guida (`stopPose`): con lo stesso controllo dava l'altra risposta su 14 fermate (Tito Livio 43 sulla sede con la
  palina, a 2,58 m dal binario col bus automatico; Piovese 241 il contrario). Chi cambia corsie, accosto o `L.shift`
  (#134, #135, #138) cambia anche il dato, senza rifare niente;
- `BusSim.move`: alle fermate con `s0.sede` la sosta è `8 + rnd · 12` s (con lo stesso numero estratto di prima, la
  sequenza di `rnd` non cambia), più chi sta ancora salendo (`paxBusy`, fino a 20 s); senza prenotazioni, anche con più
  di 40 s di anticipo, il bus non si ferma (alle altre fermate si ferma per recuperare l'anticipo). Capolinea di
  partenza (fino all'orario) e ultima fermata (18 s) come prima;
- prova: in "Tito Livio e Ponti Romani" di `tests/traffico.spec.js` il controllo `tram_dietro_la_sosta`
  (`data/eccezioni/traffico.json`, a zero): un tram fermo, tenuto fermo da un bus (`busT`), con sul suo binario fino a
  60 m davanti un bus in fermata da più di 22,6 s (la salita più lunga, le porte e il passo dell'osservazione) senza
  nessuno che sale o scende. La prova stampa anche le code intere dei tram dietro le soste (per #47). Su main
  (1db659b) il SIR1 restava 42 s dietro le soste della 88 e della 3 a Ponti Romani 6 (38 s oltre la salita) e 31 s
  dietro la 88 a Ponti Romani 68; ora nessun tram si ferma dietro una sosta in tutta la corsa;
- fermate col dato vero il 19 novembre: 22 (163 fermate di corsia su 3.237), guardate dall'alto e da 2,5 m col bus
  fermo dove lo mette `buildLane`. SIR1: Ponti Romani 6 e 68, Vittorio Emanuele 21 e 159; SIR3: Falloppio 36, i due
  Falloppio 69, Giustiniani Ospedale (linea 6, a 2,05 m: la palina sta oltre la sede, il bus si ferma nella corsia
  accanto e ci sporge), Sografi 26, 31 e 44, Piovese 213, 224 e 241, Leopardi 1; SIR2: San Marco fr. Palasport, San
  Marco (Casello Autostrada), San Marco 274, Via San Marco - San Lazzaro, Provvidenza 68, fr. via S. Antonio e incr.
  via Lazio. San Marco (Casello Autostrada) è sul Cavalcavia San Marco, dove la 10 corre a 1,5 m dal SIR2 (#131): il
  dato cambia quando cambia la corsia. Restano fuori di poco San Marco 196 (2,22 m) e Giustiniani Ospedale della 4
  (2,27 m): il tram passa;
- elenchi: impronta riscritta; in `code.json` spariscono quattro incroci della coda di #148 (Via Piovese con Via
  Lazzaro Mocenigo, Via Gozzi a (460, -650) e con Via Tommaseo, Via Altinate con Via Falloppio); `moto.json` uguale.

Svolte vicine dei percorsi delle linee (#135, 19 novembre). Regola in [`raccordi.md`](raccordi.md), sezione 3 punto 8 e
sezione 7. Da sapere prima di toccare `percorsoBus` o i raccordi dei bus:

- `percorsoBus` (`src/world/inseguitore.js`) sceglie raccordi e corsie su tutto il percorso con un cammino di costo
  minimo sugli stati (tratto, raccordo con cui ci si arriva): un cambio di corsia costa quante corsie, uno senza il
  posto o due raccordi sovrapposti 100 (`costoCambio`), la corsia a destra un poco meno, ogni arco scavalcato
  `SCAVALCO` (10), il raccordo delle auto o una curva del gioco `RIPIEGO` (100). Prima prendeva a ogni svolta il
  raccordo con meno archi scavalcati e poi sceglieva le corsie (Viterbi): tra due svolte vicine non vedeva il raccordo
  unico che le fa insieme, che spesso la build aveva già (per le auto o per un'altra svolta), e il bus faceva una curva
  del gioco. I pezzi del percorso e i ripieghi contati restano quelli di prima;
- `percorso_bus` di `scripts/raccordi.py` rifà la stessa scelta in Python, con gli stessi costi: la usa la build
  (`slegate`, `lega`: dove due svolte col raccordo del bus non si legano, i soli bus hanno le curve che le legano) e il
  controllo `corsie_slegate` di `scripts/percorsi.py`. Chi cambia uno dei due cambia l'altro. Il ripiego del gioco in
  Python non ha la curva: le giunzioni vicine a un ripiego non contano (sono di #134);
- nella build, sulla mappa rigenerata: 2 raccordi dei soli bus per 3 svolte della 10 a Via San Marco, `corsie_slegate`
  a zero, il resto della mappa uguale (la domanda non cambia: i raccordi nuovi non sono delle auto);
- numeri sulla mappa di main (prima di rigenerare): su tutte le varianti (corsie di `BusSim` costruite in Node) i
  posti con un ripiego dei bus passano da 234 a 118 (979 passaggi di varianti a 483), `cambio di corsia senza posto`
  da 15 a 2, `raccordi sovrapposti` da 27 a 7, il raccordo delle auto da 176 a 102 (il bus prende il raccordo suo che
  scavalca la svolta senza); prova del moto da 71 a 33 posti, imbardata peggiore da 16,7 a 9,1 volte quella ammessa
  (in `moto.json` restano la 10 nell'uscita dopo Ponte di Brenta per #135, 27 raccordi delle auto per #134). Altri
  elenchi: in `mappa-gioco.json` i pali che i bus su curva di ripiego toccavano (Via Chiesanuova, Albignasego, Via San
  Marco) ora li tocca il muso sui raccordi della build (#130), più un semaforo della 10 a Via San Marco; in `code.json`
  la coda di Via Gozzi resta nell'incrocio con Via Tommaseo invece che a (427, -558); impronta riscritta;
- restano, fuori dalla build: la 16 a Via Marconi nell'avvicinamento al capolinea (`walk` di `src/world/buses.js`, che
  la build non conosce), e due posti (9, 15B e 42 a (1792, -48), 88 a (-635, 2947)) dove il raccordo prima ha raggio
  zero e il gioco lo arrotonda con un arco di 30 m e fino a mezzo metro di tangente (`curva`), che finisce dopo l'inizio
  del raccordo dopo, su un arco di pochi metri.

Svolte strette dei bus (#134, 19 novembre). Misure, fonti e decisione nell'issue; regola in [`raccordi.md`](raccordi.md),
sezione 2 e sezione 3 punto 9. Da sapere:

- il raggio minimo del bus da 12 m automatico è 7,0 m (`R_MIN` di `scripts/raccordi.py`, `RAGGI` di
  `src/world/inseguitore.js`, il campo `raggi` della mappa): i bus veri girano tra 6,2 m (Citaro) e 7,7 m (limite del
  Regolamento UE 1230/2012), quello del gioco a 8,3 m girava più largo di tutti. Lo sterzo del bus di chi guida
  (`src/bus/bus.js`) non cambia, e nemmeno lo snodato (8,5 m, `ART.maxAngle`); nel gioco anche la 10 automatica segue
  i raccordi del bus da 12 m;
- la build cerca la curva del bus come prima a 8,3 m (`R_BUS`, `self.rbus` nella ricerca) e scende a 7,0 m solo nelle
  svolte dove il percorso di una variante, come lo sceglie il gioco, prenderebbe il raccordo delle auto o una curva
  del gioco (`strette`, dopo `calcola` e prima di `lega`). Abbassare il raggio dentro la ricerca cambiava anche come la
  build classifica i movimenti (stretto o fuori) e quando prova la svolta larga e i raccordi che scavalcano: la 10
  perdeva una trentina di raccordi dello snodato e la 88 uno a (-654, 2939). Chi cambia la ricerca guardi
  `python3 scripts/percorsi.py`: un caso nuovo lì è una svolta che aveva il raccordo e l'ha perso;
- la soglia della prova del moto per i bus (`tests/moto.js`) la legge dal campo `raggi` della mappa. Prova del moto da
  33 a 15 posti, imbardata peggiore da 9,1 a 7,7 volte quella ammessa: i casi del raccordo delle auto da 27 a 11; a
  Largo Europa il bus fa ora una curva del gioco a 3 m da dove prendeva il raccordo delle auto; spariscono, con il
  traffico cambiato, i 2 casi delle auto al Ponte Omizzolo;
- la pianta delle mini-rotonde rimaste (Piazzale Pontecorvo, Via Ca' Rasi, Rotonda Lina Merlin) segue la carreggiata
  vera sulla foto aerea: le 105 svolte che restano senza il raccordo del bus chiedono una manovra intera o l'isola
  sormontabile (#155).

Code che risalgono gli incroci (#148, 19 novembre). La regola resta quella di #115, in un posto solo
(`incrocioDavanti` di `src/world/inseguitore.js` e `scatola` in `Traffic.update`); cambia quello che l'auto sa quando
decide. Regola in [`raccordi.md`](raccordi.md), sezione 8. Da sapere prima di toccare il traffico:

- misura prima della modifica, con lo stato dei mezzi allegato ai casi (`window.__codeInfo`) e la storia degli ultimi
  4 s di ogni auto prima di entrare in un incrocio. Sulla main del pomeriggio (17cbafa), nei dieci minuti della prova
  delle code: 25 casi di `auto in coda nell'incrocio` in 6 posti, 42 soste di oltre 2 s dentro un incrocio, 418 secondi
  in tutto (la più lunga 25,6 s); con la mappa di #134 (ebf5c1f) 34 casi in 10 posti, 49 soste, 480 s. Quasi sempre, all'ultimo momento in cui poteva ancora fermarsi, l'auto vedeva posto
  oltre l'incrocio. Le cause, guardate dall'alto: in Via Gozzi e in Via Piovese le auto spostate di lato per stare
  fuori dal binario del SIR3 (`tramShift`) non vedevano quelle davanti nella stessa corsia spostate meno (il percorso
  si campiona con lo scostamento di chi guarda, e lo scostamento cambia lungo la strada); in Via Piovese due incroci a
  4,7 m l'uno dall'altro (8,7 m di corsia) valevano come due, e chi decideva al primo non si fermava più prima del
  secondo; la fila oltre i 20 m più 4 s di chi stava davanti sembrava libera, e un verde durava per sempre; le auto di
  Via Scrovegni e di Via Trieste s'immettevano nella stessa corsia contando lo stesso posto; un'auto nasceva già
  lanciata a un passo da un incrocio;
- `Traffic.davanti(c, D, ctx, pl, fila, lungo)`: con `fila` guarda fino a `lungo` m e mette lì tutti i mezzi trovati;
  il primo mezzo, e con lui la guida, resta quello entro D. Un'auto della stessa corsia con un altro scostamento è
  davanti se l'asse della sua corsia sta entro 1,7 m da quello dell'auto (`inCorsia`), fuori dai sorpassi. La
  proiezione salta i blocchi di 8 tratti lontani (stesso risultato, meno conti);
- `incrocioDavanti`: due incroci tra cui un'auto ferma non ci sta (`TRA_INCROCI`, 6,9 m tra gli incroci allargati)
  sono uno solo, fuori dagli anelli delle rotonde; dà anche `R0` e `R1`, il primo e l'ultimo raccordo. Vale anche per
  i bus automatici, che con incroci più lunghi si fermano prima dove non c'è posto per 12 m;
- `Traffic.postoOltre`: dove si fermerà la fila oltre l'incrocio, guardando fino a 92 m (mezzi fermi, `spazio` di chi
  va, la prima linea d'arresto oltre l'incrocio col rosso, col giallo e col verde che finisce prima che la fila passi:
  `TrafficLights.verdeRestante`, scarico di un'auto ogni 2,2 s). Lo calcola solo chi può ancora fermarsi, negli ultimi
  20 m prima di non poterlo più fare; con la vista lunga oltre l'incrocio vuole il suo posto più 3 m (`MARGINE`);
- `Traffic.immessi`: le auto di un'altra corsia dirette alla stessa corsia d'uscita (`c.uscita`, l'incrocio dove
  l'auto è o entrerà; `c.impegnata` se non può più fermarsi; `c.traIncrocio`, i secondi all'incrocio) prendono posto
  prima di chi ci arriva dopo. Attenzione ai nomi: `c.arriva` è già della domanda (#116, dove l'auto esce di scena);
- `Traffic.metti`: a pochi metri da un incrocio l'auto nasce abbastanza piano da poter ancora decidere;
- la regola vale anche senza nessuno davanti (prima solo con un mezzo davanti): conta il rosso oltre l'incrocio, non
  il fondo di una strada chiusa (`fermaPrima` in `Traffic.update`), dove l'auto lontano da chi guida esce di scena. Con
  il fondo contato, sul Lungargine Rovetta un'auto restava ferma oltre 120 s prima di un incrocio a pochi metri dalla
  fine;
- numeri, stessa macchina, main e ramo in parallelo, prova dei dieci minuti: sulla mappa di #134 casi da 34 in 10 posti
  a 2 in 2 posti, soste dentro un incrocio da 49 a 13, da 480 a 67 secondi, `traffic.update` da 1,01 a 1,07 ms per
  passo con 60 auto; su 17cbafa da 25 casi a 2, `traffic.update` da 1,09 a 1,23 ms (nel profilo di 60 s alla stazione
  `davanti` da 0,37 a 0,44 ms, `postoOltre` e `immessi` 0,01 ms ciascuna). Su 17cbafa anche con 144 auto alle 8:15
  (da 23 casi a 2, soste da 565 a 246 s, `traffic.update` da 2,05 a 2,20 ms) e alle 17:30 (da 18 a 2, da 288 a 77 s);
  nessuno fermo oltre 120 s. Corridoio di Via Querini uguale (non ha incroci): 600, 1.200 e 1.368 auto l'ora,
  scarico un'auto ogni 2,16 s; punte della domanda 1,39 alle 8 e 1,39 alle 18 (soglia 1,08); prove del traffico senza
  casi nuovi. In `moto.json` tornano le due auto al Ponte Omizzolo verso Via Gozzi (raccordi sovrapposti, gruppo "#135
  per le auto", tolte con #134): le code di Via Gozzi cambiano i ritardi misurati, e qualche auto riprende quella svolta;
- casi che restano in `code.json`: Via Gozzi con Via Trieste (427, -558), dove l'auto della traversa e quella della
  coda entrano insieme e si uniscono dentro l'incrocio (#49: nessuna dà precedenza all'altra; a Via Scrovegni succede
  lo stesso, con questa mappa non nei dieci minuti della prova); Via Piovese a (2089, 3296), un'auto che arriva a
  12,6 m/s e decide con la fila davanti a 11 m/s, che poi si ferma 11 m più indietro del previsto perché un'auto
  lascia libero l'incrocio dopo: quello che la previsione non vede. Casi così compaiono e spariscono a ogni
  cambiamento del traffico.

Porte pesate con i pendolari ISTAT (#147, 20 novembre). Fonti, conto e numeri in [`domanda.md`](domanda.md), sezioni
3, 4 e 8. Da sapere prima di toccare la domanda:

- `scripts/pendolari.py` (chiamato da `calcola` di `scripts/domanda.py`) dà le righe di `pendolari_in` e
  `pendolari_out`: dai comuni di fuori (centro abitato fuori dalle aree della mappa) a quelli dentro, pendolari in auto
  come conducenti della matrice ISTAT 2011, ogni coppia comune e zona con la porta col tempo minore (strade OSM fuori
  dalla mappa fino alla porta, poi la matrice `tempi`). `PESO_PORTA` e `PENDOLARI` non ci sono più; il peso delle porte
  nel file sono i pendolari che ci passano (il gioco non lo usa), e chi attraversa entra ed esce in proporzione a loro.
  La curva di `pendolari_in` prende le fasce di uscita della matrice (`ore_istat`);
- i tratti della mappa si riconoscono nelle vie di fuori per coordinate dei nodi (0,5 m) e per arco: chi cambia la
  proiezione (`xz`) o il modo in cui la build taglia le vie al bordo guarda `python3 scripts/domanda.py --conti`, dove
  la riga "porte senza una via di fuori" deve restare corta (oggi una carreggiata di Corso Argentina). Comuni e strade
  si riscaricano con le query in `scripts/overpass-comuni.ql` e `scripts/overpass-strade-fuori.ql` (comandi nel README);
- guardia `python3 scripts/gtfs_tempi.py --porte`, anche in `scripts/verifica_mappa.py` (lavoro mappa della CI): su ogni
  porta, i tratti delle linee sul percorso verso il centro dove il GTFS ha alle 7-9 almeno il 20% in più e la domanda
  alle 8 meno del 10% sono casi di `data/eccezioni/punte.json`. Chi cambia la domanda o la rete la rilancia; i 15 casi di
  oggi (Via Sorio con la U12, la E080 verso Chiesanuova, la U10 da Ponte di Brenta e altri) sono di #159;
- l'orario di Busitalia allunga blocchi interi di fermate dello stesso fattore (la U12 +42-44% da Tencarola a Via
  Cavalletto): un tratto del GTFS dice quanto è più lento il viaggio, non dove si forma la coda;
- con 48.400 pendolari invece di 60.000 la build ha meno code: stati sopra 1,1 alle 8 da 1.103 a 879, auto presenti da
  8.700 a 7.200. Prova delle punte in due lanci: medie 1,38 e 1,32 alle 8, 1,18 e 1,27 alle 18 (soglia 1,08); Via
  Facciolati 1,93 e 1,83 la mattina, la sera da 1,55 a 1,02 e 1,17 (dalla porta di Corso Esperanto escono 1.500
  pendolari al giorno invece di 3.200); Via Sorio 1,03 e 1,08 alle 8;
- prove del traffico: nei dieci minuti delle code nessun caso nuovo di auto ferma in un incrocio o oltre 120 s; due giri
  di attese auto-tram nuovi in Via Morgagni e tra Via Tommaseo e Via Gozzi (#144), sparito quello tra bus e SIR2 in
  Corso Garibaldi; nel moto spariscono le due auto del Ponte Omizzolo (#135 per le auto). Impronta riscritta.

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

Da #109 (16 novembre) queste ricerche girano nella build, in `src/world/posa.js` (`Posatore.palo` è `poleSpot`,
`Posatore.lineaAerea` ha `spanAnchor`), e il gioco legge il risultato: nota #109 della Mappa. Le regole sono rimaste
quelle scritte qui sotto.

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

