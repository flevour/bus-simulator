# Corsie di lavoro in parallelo

I lavori di [`IDEE.md`](../IDEE.md) procedono in parallelo, ognuno in un worktree herdr con il suo ramo locale
(lo space `bus-simulator` raccoglie il checkout principale e i worktree). Ogni corsia pubblica su `main` con commit
piccoli, come il resto del progetto. Questo file dice chi tocca cosa; i brief delle corsie aperte sono in fondo.

## Regole per tutte le corsie

1. Ramo locale `corsia/<nome>` partito da `origin/main`, worktree in `~/.herdr/worktrees/bus-simulator/corsia-<nome>`.
   Niente rami remoti né pull request.
2. Prima di ogni commit `git status -sb`; commit con `~/.claude/custom-bins/committer "messaggio" file...`.
3. Per pubblicare:
   ```bash
   git fetch origin && GIT_EDITOR=: git rebase origin/main
   npm run build && npm test
   git push origin HEAD:main
   ```
   `npm test` compila il gioco senza PostHog in una cartella temporanea, lo serve su una porta libera e lancia le
   prove di Playwright in `tests/`. La prima volta (o quando il rebase porta una versione nuova di Playwright):
   `npm install` e `npx playwright install --only-shell chromium`. La corsia `mappa`, dopo ogni rigenerazione,
   lancia anche `python3 scripts/verifica_mappa.py --elenco` (venv con `shapely`). Il rapporto della mappa
   (`tests/mappa.spec.js` e lo script) ha soglie fissate sui valori del 9 novembre: se un numero scende si abbassa
   la soglia nello stesso commit, se sale per una buona ragione si alza scrivendo il perché nel commit. Lo stesso
   controllo gira in CI (workflow Verifiche) a ogni push su `main`.
4. Conflitti nel rebase:
   - `src/data/novita.js` e `IDEE.md`: si tengono le righe di tutti; in `novita.js` la riga nuova va in cima con
     `n` successivo all'ultimo di `main`;
   - `src/data/padova-map.json` (solo nella corsia della mappa): si prende quello di `main` e si rigenera.
5. Ognuno il suo `node_modules` (`npm install` nel worktree): la cache di Vite sta in `node_modules/.vite` e due
   server che la condividono si pestano i piedi.
6. Porte fisse per corsia (tabella sotto). Nel worktree non c'è `.env` e non va creato: le chiavi di PostHog si
   passano sulla riga di comando. In dev `src/posthog.js` si ferma se mancano, quindi valori finti; nel build
   vuote, così le prove non mandano eventi:
   ```bash
   VITE_POSTHOG_KEY=prova VITE_POSTHOG_HOST=http://localhost:9 npm run dev -- --port <dev> --strictPort
   VITE_POSTHOG_KEY= VITE_POSTHOG_HOST= npm run build && npx vite preview --port <preview>
   ```
7. Dopo modifiche a strade, fermate o edifici: percorsi dei bus liberi e fermate raggiungibili (vedi `CLAUDE.md`).
8. A lavoro finito si sposta la voce in "Fatto" in `IDEE.md` e si aggiorna questo file (corsia chiusa o prossimo
   lavoro).

## File condivisi

| File | Chi lo modifica | Perché |
|---|---|---|
| `src/data/padova-map.json` | `mappa` e `capolinea`, una rigenerazione alla volta | una riga sola da 12 MB: due rigenerazioni non si uniscono, si prende quella di `main` e si rigenera (regola 4) |
| `scripts/build_map.py`, `scripts/street_surfaces.py` | `mappa` (dettagli dentro l'area) e `capolinea` (estensione dell'area) | producono la mappa; chi ha bisogno di dati nuovi li scrive in un file a parte o li chiede a queste corsie |
| `src/world/city.js` | tutti, ognuno nelle sue funzioni | il caricamento per aree (onda 3) lo riscrive: parte quando nessun'altra corsia ci lavora |
| `src/world/traffic.js` | `Traffic`/`Walkers`/`TrafficLights` a `traffico`, `TramSim`/`TramSignals` al tram | stesse classi in due corsie = conflitti; `traffico` può toccare `TramSim` solo dove serve allo sblocco dei tram, scrivendolo qui |
| `src/world/buses.js` | `traffico` (comportamento dei bus automatici) | `mappa` ci ha messo l'uscita dal binario opposto (`buildLane`, `ahead`): chi la cambia lo scrive qui |
| `src/bus/bus.js` | `guida` (sterzo, pedali, cruscotto) | gli altri solo per piccole cose, segnalate qui |
| `src/main.js` | tutti, ognuno nelle sue funzioni | |

## Corsie aperte (onda 1 dal 9 novembre 2026, `traffico` e `guida` dall'11 novembre)

| Corsia | Workspace herdr | Porte dev / preview |
|---|---|---|
| checkout principale | `bus-simulator` | 5173 / 4173 |
| `verifiche` (chiusa il 9 novembre) | `verifiche` | 5174 / 4174 |
| `mappa` | `mappa` | 5175 / 4175 |
| `tram-reti` (chiusa il 9 novembre) | `tram-reti` | 5176 / 4176 |
| `segnalazioni` (chiusa il 9 novembre) | `segnalazioni` | 5177 / 4177 |
| `capolinea` (dal 9 novembre) | `capolinea` | 5178 / 4178 |
| `traffico` (dall'11 novembre) | `traffico` | 5179 / 4179 |
| `guida` (dall'11 novembre) | `guida` | 5180 / 4180 |

### verifiche

Chiusa il 9 novembre 2026. Cosa c'è (dettagli nel README, sezione "Verifiche"):

- `npm test` (Playwright, dipendenza di sviluppo): il gioco si carica e una corsa del bus e una del tram avanzano
  senza errori (`tests/avvio.spec.js`); giro guidato fino alle fermate successive sulle linee 24, 10 (snodato), 3,
  14 e sul SIR1 nei due versi, con un pilota scritto nella prova (`tests/guida.js`), senza traffico
  (`tests/giro.spec.js`); rapporto di verifica sulla mappa nel gioco (`tests/mappa.spec.js`). Ogni worker apre il
  gioco una volta; in tutto circa 2 minuti.
- `scripts/verifica_mappa.py`: rapporto sul JSON della mappa, in pochi secondi.
- `.github/workflows/verifiche.yml`: build, `npm test` e lo script a ogni push su `main`, con i rapporti come
  artefatti. Non ferma la pubblicazione su GitHub Pages.
- Se si riapre: pilota più bravo nelle svolte a T e in quelle strette (sbaglia sulle linee 9 e 21) per allargare il
  giro guidato a tutte le linee; casi di prova dalle segnalazioni di chi gioca.

### mappa

Unica corsia che rigenera la mappa (venv con `shapely` e `pyarrow`, comandi in `CLAUDE.md`). File: `scripts/build_map.py`,
`scripts/street_surfaces.py`, le query e i filtri OSM (`scripts/overpass-*.ql`, `scripts/filter_osm_*.py`), la parte
delle strade di `src/world/city.js`, `src/data/padova.js`, `src/data/padova-map.json`.

- Dai tag OSM già nell'export (`lanes` su ~5.400 vie, `lanes:forward/backward`, `overtaking`, `turn:lanes` su 40,
  `lanes:psv`/`bus:lanes`): numero di corsie e linee divisorie sulla carreggiata misurata, mezzeria continua con
  `overtaking=no`, frecce a terra, corsie dei bus gialle con la scritta BUS.
- File: `scripts/build_map.py`, `scripts/street_surfaces.py`, la parte delle strade di `src/world/city.js`,
  `src/data/padova-map.json`. Rigenerazione con i comandi di `CLAUDE.md` (venv con `shapely` e `pyarrow`).
- Dopo, in quest'ordine, nella stessa corsia: fermate del tram dai nodi `tram_stop`, dossi (`traffic_calming`) e
  `highway=busway`; capolinea con tratti GTFS senza strada; le 30 fermate senza palina; i 177 tratti A-B-A;
  zona Plebiscito; cavalcavia e posizione dei fiumi; correzioni del piazzale della stazione segnalate dalla corsia
  `segnalazioni`. Svolte a sinistra protette ai semafori (`TrafficLights` in `traffic.js`) quando ci sono le corsie.
- Le corsie preferenziali vere nel traffico (auto che non le usano) spettano alla corsia del traffico (onda 2).
- Richieste della corsia `verifiche` (rapporto della mappa del 9 novembre; elenchi completi con
  `python3 scripts/verifica_mappa.py --elenco` e in `test-results/*/rapporto-mappa.json` dopo `npm test`):
  - **lampioni in carreggiata** (1.121): fatto, nessuno (corsia mappa, `buildTreesAndLamps` con `surfaceOff`);
  - **fermate dove il bus fermo tocca un ostacolo**: da 19 a 9, tutte contro una facciata sul bordo dell'asfalto:
    Milano 61 in Corso Milano (linee 6, 9, 10, 42), Tommaseo 114 (3, 7, 10, 25), Buonarroti 46 (24);
  - punti dove il giro guidato urta una facciata sul bordo dell'asfalto stando nella sua corsia, da guardare: Via
    Curtatone e Montanara all'incrocio (linee 6 e 12), Via Sberti vicino al capolinea Boccaccio (13);
  - **fermate agganciate a più di 40 m dalla fermata vera**: da 33 a 11 (area ai bordi e linee tagliate); resta
    Bembo 95 sulla 3 a 317 m (il tratto A-B-A di Via Bembo), le altre tra 43 e 71 m.
- Richieste della corsia `segnalazioni`:
  - **linea 22 verso Mandria (varianti 0, 3, 4, 7, 8)**: Via Madonna della Salute e il Cavalcavia Mortise tra la
    rotonda di Mortise (45,4340 N) e Via Cardan (45,4265 N) stanno tra 11,9135 e 11,915 E, appena fuori da `FOCUS`
    (bordo est 11,912 più il margine di 0,0015), quindi mancano dalla rete. `match()` collega i due pezzi con il
    cammino minimo nella mappa: un giro di 5 km per Via del Plebiscito, Via Boves, Via Cascino e Via delle Molle, e
    le fermate dalla 2 alla 21 finiscono fino a 3,8 km dalla loro palina (la corsa non si può fare). Basta allargare
    l'area a est lì attorno; in generale, quando il tracciato GTFS esce dall'area e rientra, meglio un salto o il
    taglio "tratto in città" che un giro. La stessa via serve l'inizio della 42 (oggi va, il gioco toglie l'avanti e
    indietro). Elenco delle varianti con fermate lontane dal percorso: 39 su 132, quasi tutte con una o due fermate
    ai capolinea fuori mappa;
  - i tratti A-B-A: dal 9 novembre `buildRoute` (`src/game/routes.js`) toglie in gioco quelli senza fermate (117 su
    179); restano 62: 58 con una fermata, quasi sempre una via tagliata al bordo della mappa dove il bus deve fare
    inversione (Croce Rossa sulla 25, Rotonda Galante sulla 9 e sulla 42), e 4 all'inizio o alla fine del percorso;
  - **piazzale della stazione** (controllo linea per linea in [`piazzale-stazione.md`](piazzale-stazione.md)): delle
    38 partenze e arrivi per linea e fermata, 19 sono nella corsia sbagliata e 2 in parte, tutti per i dati. In ordine di effetto: (1) banchina a nord
    della corsia nord da marciapiede invece che asfalto (area OSM 47586895, `highway=pedestrian` + `psv=yes`), senza
    la quale le paline delle corsie 1 e 2 non si possono mettere; (2) passaggio dalla strada sud alla corsia sud verso
    x = 231 per gli arrivi da ovest (oggi 12, 16 e 21 entrano contromano e fanno inversione); (3) attraversamento dalla
    corsia nord alla corsia sud verso x = 190 per gli arrivi da est alla corsia 3; (4) la fermata Ex Catasto alla sua
    posizione GTFS sulla strada sud, non alla palina OSM dell'isola; (5) partenze della 14, della 6 e della 25 che
    comincino dalla fermata e non sulla strada sud.
- Fatto il 9 novembre dalla sessione cloud sul checkout principale (richiesta diretta di chi gioca, unito sopra le
  corsie e la segnaletica di questa corsia e sopra le fermate del tram, mappa rigenerata), per il **piazzale della
  stazione** (punti 1, 4 e 5 sopra; 2 e 3 in parte) e per i **tratti A-B-A**: banchine dei bus (`highway=platform`,
  in `data/osm-fermate.json` → `banchine`, da `scripts/osm_stops.py`) nella pianta delle strade
  (`street_surfaces.surfaces(..., platforms)`) al posto delle isole del DBGT, e la palina delle corsie 1 e 2 sulla
  banchina nord; corsie a senso unico tra le banchine ristrette (una corsia, anche nei codici di `lanes`); paline per
  nome in `snap_stops_to_osm`, senza parole in comune solo entro 15 m (Ex Catasto resta sulla strada sud); fermate a
  meno di 6 m da una banchina portate sopra (`onto_platforms`); contromano 6 volte la strada nell'aggancio (era 1,6),
  tranne le corsie bus in controsenso (`bus_both_ways`, flag 256, letto anche dal gioco in `busCan`); `terminal_lane`
  per i capolinea lontani dal percorso o raggiunti contromano (partenze della 6 e della 14 dalla corsia 3, arrivi
  alla corsia 3 sulla corsia sud) e `stop_lanes` per le fermate in mezzo al percorso (5, 6, 9 e 42 passano dalla
  corsia sud e fermano alla Corsia 3); `drop_spurs` toglie gli A-B-A senza fermata già nei dati (restano 44). Per i punti
  2 e 3 i bus arrivano alla corsia giusta con il giro legale dall'entrata est: i due passaggi veri (x = 231 e
  x = 190) restano da aggiungere alla rete come archi propri. Con i sensi unici la linea 2 (Diretto Piazze) ora si
  aggancia, ma come la 6 e la 12 (già prima, 3,2 km) fa un giro di 3,5 km lontano dal tracciato GTFS attorno a
  (-1547, 497), nel corridoio di Via Sorio: manca una strada o un passaggio nella rete. I lampioni in carreggiata
  li ha poi tolti la corsia mappa (spostati fuori dall'asfalto vero con `surfaceOff`).
- Richieste della corsia `tram-reti` (dettagli in [`linee-tram-nuove.md`](linee-tram-nuove.md), sezione "Nel gioco"):
  - **sede di SIR3 e SIR2 nella pianta delle strade** (tappa 3): i binari sono `net.tramLines` in gioco, da
    `data/tram-linee-nuove.json`, tagliati sul tratto in città. Oggi stanno sopra l'asfalto e le corsie dei bus ci
    passano sopra o a meno di 2,5 m: la linea 10 per circa 2 km sul SIR2 (Corso Milano, via Tommaseo, via Venezia), le
    linee 6, 42, 25 e 7 tra 0,5 e 1,7 km sul SIR2, le linee 4, 5, 6, 9, 14, 15B, 24 e 42 tra 0,3 e 1,2 km sul SIR3 (via
    Gozzi, via Morgagni, via Sografi). Verso la Stanga (x 1100, z -565) una corsia dei bus taglia il binario quasi di
    striscio e i bus si fermavano sopra i binari. Due fermate dei bus sono senza palina perché cadrebbe sui binari:
    Sografi 31 (via Sografi, SIR3) e Grassi (Cittadella) (via Venezia, SIR2);
  - **area di Voltabarozzo** (tappa 4): riquadro `FOCUS` fino al capolinea e al deposito, poi il SIR3 intero.
    Passata alla corsia `capolinea`.
- Segnalazioni di chi gioca del 9 novembre (foto nel pannello del checkout principale):
  - **cavalcavia di Chiesanuova** sul SIR2 ("non convince"): l'impalcato è quasi tutto grigio chiaro, con pezzi di
    asfalto scuro a triangoli e schegge storte che si sovrappongono; la sede rossa del tram è a pezzi obliqui che non
    seguono il binario e il tram corre sul grigio; le righe bianche delle corsie stanno sul grigio; bordi
    dell'impalcato irregolari e un rettangolo scuro sospeso accanto al binario;
  - **rotonde attraversate dal tram**: l'isola verde al centro della rotonda e l'isola triangolare all'ingresso sono
    disegnate sopra la sede rossa e i binari, che spariscono sotto l'erba ("priorità del layer sbagliata"). Va
    insieme alla sede di SIR3 e SIR2 nella pianta delle strade; da controllare anche sul SIR1.
  - **bus automatici contromano sul binario del tram** (Via Tommaseo vicino a Viale della Pace, Piazza Garibaldi, con
    il muso dentro il tram): fatto, vedi sotto.
- Dal sondaggio del 9 novembre (IDEE, prossimi passi 5), due richieste sui cavalcavia arrivate dopo la correzione del
  Borgomagno (pubblicata alle 16:04): "Bisogna sistemare i cavalcavia" (linea 22 in Via Orlandini, x 1315, z -1022, alle
  17:57) e, da un giocatore nuovo, "sarebbero da migliorare i ponti o cavalcavia come quello della stazione e il
  Camerini" (linea 13 in Viale Codalunga, alle 20:36). Il **Cavalcavia Camerini** (nella rete con questo nome) non l'ha
  mai guardato nessuno; il **Borgomagno** va rivisto dal posto di guida come lo vede chi gioca.
- Segnalazioni di chi gioca dell'11 novembre, sulla sede del tram (due foto dal SIR3 verso Cornaro, nel pannello del
  checkout principale):
  - **"sporchessi" sulla linea**: trattini e segni bianchi corti sparsi sulla sede rossa, di traverso e lungo il
    binario. Sembrano i segni della carreggiata (divisorie, frecce, strisce) rimasti sopra la sede; si vedono anche
    dove il binario corre da solo a fianco della strada;
  - **"macchie di asfalto che mangiano la corsia"**: a un incrocio, poligoni grigio scuro a triangoli sopra la sede
    rossa, che coprono pezzi di tutti e due i binari. Sembra l'asfalto della strada che incrocia disegnato sopra la
    sede.

  Da controllare su tutte le linee, non solo lì: conteggio dei segni e dei pezzi d'asfalto che cadono sulla sede, con
  una soglia in `verifica_mappa.py`.

Fatto il 9 novembre (dettagli in IDEE, "Fatto"): corsie e segnaletica orizzontale dai tag OSM, fermate del tram sui
nodi `tram_stop`, dossi e attraversamenti rialzati, `highway=busway` (niente da fare), area ai bordi e linee tagliate
(la 22 in Via Madonna della Salute), inversioni a U, corsie di servizio dei capolinea (Capolinea
Plebiscito), lampioni fuori dall'asfalto. Strumenti nuovi in `build_map.py`: `FOCUS_BORDI`, `cut_path`,
`no_uturns`, `gtfs_cover`; nei dati `lanes`, `turnLanes` e `calming`. Il piazzale della stazione l'ha sistemato la
sessione cloud (sopra): la mia versione con l'area 47586895 come banchina e i due passaggi aggiunti è stata lasciata
cadere nel rebase, le banchine vere di OSM sono una fonte migliore.

Fuori dai miei file, piccoli e segnalati: in `traffic.js` le auto stanno nella corsia più a destra sulle vie con le
corsie in OSM (`Traffic.laneGeom`, con `driveOffset` di `padova.js`) e le linee d'arresto dei semafori partono dalla
riga che separa i versi (`TrafficLights.placeApproach`); in `main.js` e `mission.js` lo scossone e il comfort sui
dossi (`bumpHit`); le soglie di `scripts/verifica_mappa.py` e `tests/mappa.spec.js`; in `buses.js` (`buildLane` e
`ahead`) i bus automatici lasciano il binario del verso opposto prima di tutto (o vanno su quello del loro verso se la
carreggiata non basta: da 6.460 a 635 punti di corsia sopra un binario opposto, quasi tutti incroci obliqui) e si
fermano davanti a un tram che arriva (passavano come direzione dei pezzi del tram la loro quota); in `tram.js` la
media delle quote del binario non lo porta sotto la strada (`setHeights`); in `city.js` gli alberi dei viali e quelli
sparsi fuori dall'asfalto vero (`buildTreesAndLamps`).

Prossimo lavoro, in quest'ordine:

- sede del tram pulita (segnalazioni dell'11 novembre, sopra): niente segni della carreggiata né asfalto sopra la
  sede, su tutte le linee;
- cavalcavia del sondaggio del 9 novembre (sopra): foto dal posto di guida e guida di una linea che ci passa sul
  Cavalcavia Camerini, sul Borgomagno e su quelli lungo la 22 attorno a Via Orlandini; poi, al Borgomagno, la piega
  dei fili del tram e il gradino di 20 cm;
- sede di SIR3 e SIR2 nella pianta delle strade: fatta per isole, marciapiedi, edifici e impalcati (i binari di
  `data/tram-linee-nuove.json` entrano in `street_surfaces.surfaces` come quelli del SIR1; la sede di tutte le linee
  è asfalto, fuori da isole e marciapiedi: rotonde attraversate dal tram a posto). Cavalcavia di Chiesanuova: rampe
  senza il terrapieno contato due volte (`adjust_heights` in `terrain_for_game`) e binario mai sotto la strada che
  segue (`TramTrack.setHeights` in `tram.js`). Restano: le carreggiate dei bus accanto ai binari nuovi, che OSM
  disegna sopra la sede futura (larghezze e corsie da rivedere quando OSM avrà le strade rifatte); a Chiesanuova
  qualche scaglia nello svincolo ovest e un tratto di binario sotto un triangolo dell'asfalto in quota (suddiviso
  ogni 20 m in `buildRoads`);
- le 9 fermate dove il bus fermo tocca una facciata e le 11 agganciate lontano (richieste di `verifiche`, sopra; dopo il
  corridoio del SIR3 sono 7, le quattro di Bembo 95 sulla 3 a posto);
- svolte a sinistra protette ai semafori dove `turn:lanes` ha una corsia di svolta: passate alla corsia `traffico`
  (`TrafficLights` in `traffic.js`); i dati (`turnLanes`) restano di `mappa`;
- le fermate senza palina e gli 11 tratti A-B-A con una fermata rimasti (3 in Via Bembo, 4 in Via Gramsci, 16 e 24
  al Capolinea Plebiscito; elenchi in IDEE, "Mappa e dati"); quelli di Via Bembo li ha tolti la corsia `capolinea`
  (il pezzo di Via Bembo tra due vie dell'area, `gtfs_links`);
- cavalcavia: sistemate le rampe (Borgomagno e raccordi, vedi IDEE); restano i sottopassi che nella realtà scendono
  sotto il piano della strada (Corso Australia su Via Cignaroli, Corso Tredici Giugno su Via Rienza, 3,6 m sopra la
  strada di sotto), che chiedono di abbassare il terreno sotto le strade `tunnel`; posizione dei fiumi senza dettagli;
- zona Plebiscito: sistemato il Capolinea Plebiscito; per il resto servono i dettagli di chi l'ha segnalata;
- gli 11 salti senza strada rimasti sono ai bordi (13 ad Altichiero, 19 a Saletto, 24 a Mandriola): li risolve la
  corsia `capolinea` (fatto quello della 24 in Via Volta).

### capolinea

Aperta il 9 novembre 2026. La mappa fino a tutti i capolinea, prima quelli del tram, con le loro fermate (IDEE, "Mappa
fino a tutti i capolinea di tutte le linee" e "mappa più grande"). Piano: tappa 2 di
[`ESTENSIONE_LINEE.md`](ESTENSIONE_LINEE.md) e tappa 4 di [`linee-tram-nuove.md`](linee-tram-nuove.md). È il lavoro
dell'onda 3 anticipato, a gruppi di capolinea, senza aspettare il caricamento per aree finché il peso lo permette.

- **Inventario**, prima di tutto: per ogni linea (autobus del GTFS, SIR1, SIR2 e SIR3 da `data/tram-linee-nuove.json`)
  i capolinea e le fermate fuori dall'area di oggi o agganciate male, con le corse che li usano. Tabella in
  `ESTENSIONE_LINEE.md`, aggiornata a ogni gruppo.
- **Ordine**:
  1. tram: SIR3 fino a Voltabarozzo con i due rami (Giardinetto e Zeno all'andata, Piovese al ritorno) e il deposito
     (riquadro di circa lon 11,885–11,912, lat 45,372–45,392); SIR2 fino a Rubano e alla Busa di Vigonza, con le
     fermate e le banchine OSM, e i rami di Romagnoli e dell'Ospedale San Lazzaro se OSM ha i binari; controllo dei
     capolinea del SIR1 (Pontevigodarzere, Guizza). Dove la linea è intera, via il "tratto in città";
  2. autobus, dai capolinea più usati (tabella della sezione 2 di `ESTENSIONE_LINEE.md`) e da quelli segnalati (Volta
     fr. 24 e Mandriola sulla 24, gli 11 salti senza strada ad Altichiero, Saletto e Mandriola).
- **Area**: corridoi attorno ai percorsi (celle da 250 m) e riquadri ai capolinea per anelli e piazzali, non
  rettangoli più grandi. Dati per le aree nuove: export Overpass di strade, nodi e tram, edifici Overture, DTM; il DBGT
  dove c'è (lotti "Padova Sud" ed "ETRA Padova"), altrimenti le misure della sezione 3 del
  [piano della città](PIANO_MODELLO_CITTA.md). Gli export nuovi in file a parte (per esempio `data/osm-corridoio.json`)
  finché non sostituiscono quelli di oggi.
- **Peso**: misurare bundle, avvio e memoria a ogni gruppo (oggi 13,5 MB di JavaScript, 12,4 MB di mappa). Prima che
  la mappa superi circa 20 MB fermarsi e chiedere: lì serve il caricamento per aree (sezione 4 di
  `ESTENSIONE_LINEE.md`), che riscrive `city.js` e parte quando nessun'altra corsia ci lavora.
- **Verifiche** a ogni gruppo: quelle della regola 3 con `scripts/verifica_mappa.py --elenco`, percorsi liberi e
  fermate raggiungibili nelle aree nuove, e il giro dal posto di guida ai capolinea nuovi (foto a 2,5 m da terra, una
  linea vera con il pilota di `tests/guida.js`).
- **Nel gioco**, dopo i dati: turni con i capolinea veri (via la tolleranza di 1,5 km in `turni.js` e il trasferimento
  in `chainNext`), uscita dal deposito verso tutte le varianti (tappa 3 di `ESTENSIONE_LINEE.md`).

Con la corsia `mappa`, che resta aperta:

- in `build_map.py` `capolinea` tocca la definizione dell'area (`FOCUS`, `FOCUS_BORDI`, corridoi), i tagli delle linee
  e le funzioni nuove per le aree nuove; `mappa` i dettagli dentro l'area. Chi cambia una funzione dell'altra lo scrive
  qui;
- `padova-map.json` lo rigenerano tutte e due, una alla volta: prima di pubblicare rebase su `origin/main`, si prende
  la mappa di `main`, si rigenera e si rifanno le verifiche; se intanto l'altra corsia ha pubblicato, si ripete;
- la sede di SIR2 e SIR3 nella pianta delle strade (tappa 3) la fa `mappa`, primo del suo prossimo lavoro; `capolinea`
  la estende ai tratti nuovi con le stesse funzioni quando è su `main`.

Fatto il 9 novembre (dettagli in [`ESTENSIONE_LINEE.md`](ESTENSIONE_LINEE.md), sezione 6):

- inventario: `scripts/inventario_capolinea.py <cartella_gtfs>`, tabelle nella sezione 6. Il SIR1 è intero (i
  capolinea di Pontevigodarzere e Guizza sono nella mappa);
- gruppo 1a, **SIR3 fino a Voltabarozzo** con i due rami e il deposito: corridoio di celle attorno ai binari
  (`CORRIDOI_TRAM`, `corridor_cells`, `tram_corridors`, `in_focus` in `build_map.py`), edifici Overture del corridoio
  nel parquet e filtro degli edifici sull'area. La sede nella pianta delle strade arriva da sola dai binari completi di
  `data/tram-linee-nuove.json` (lavoro della corsia `mappa`). Il SIR3 si guida intero nei due versi;
- funzioni nuove per i bordi dell'area: `gtfs_links` (vie fuori dall'area tra due vie dell'area dove passa un bus: Via
  Bembo per la 3, che toglie l'A-B-A di Via Bembo della lista della corsia `mappa`, e Via Volta per la 24) e il taglio
  dei tornanti in testa e in coda in `cut_path`.

Funzioni della corsia `mappa` cambiate da `capolinea`: `stop_lanes` in `build_map.py` accetta anche i golfi di fermata
(strade di servizio a senso unico, palina fino a 5 m oltre il bordo o dentro il golfo, percorso attuale almeno 3 m più
lontano): cambia solo Piovese Park (4, 14, 16), le corsie della stazione restano come prima. Le soglie di
`verifica_mappa.py` e `tests/mappa.spec.js` (una palina in carreggiata: Piovese fr. Park, sotto il cavalcavia della
tangenziale).

Prossimo lavoro, in quest'ordine:

- gruppo 1b, SIR2 fino a Rubano e alla Busa di Vigonza: 173 celle nuove (10,8 km², stima 3-4 MB di mappa). Servono gli
  export fuori dal riquadro di oggi: nodi OSM (`scripts/overpass-nodes.ql` sul corridoio), paline (Overture
  `base/infrastructure`), edifici Overture, DTM, DBGT dei lotti di Rubano e Vigonza o le misure della sezione 3 del
  piano; i rami di Romagnoli e San Lazzaro se OSM ha i binari;
- binari del deposito di Voltabarozzo (OSM `service=yard`, in `data/osm-padova-tram-cantiere.json`): non disegnati, li
  può prendere la corsia `tram-turni` con il deposito della Guizza;
- caricamento per aree (onda 3, sezione 4 di `ESTENSIONE_LINEE.md`), **prima del gruppo 2**: deciso l'11 novembre.
  Con il SIR2 la mappa arriva a circa 17 MB; gli autobus fino ai capolinea la porterebbero a 25-35 MB. Prima la rete
  sempre caricata e le aree in `public/` (pipeline), poi `city.js`. Quando si arriva a `city.js` lo si scrive qui: da
  lì le altre corsie non toccano `city.js` finché il lavoro non è su `main`;
- gruppo 2, autobus (24 a Mandriola per prima), con i limiti di `build_gtfs.load` (10 varianti per linea, 9 km) da
  togliere per le linee che arrivano ai capolinea. Tra i capolinea richiesti da chi gioca (sondaggio del 9 novembre,
  linea 3 in Via Fondà): quelli della 3 e della 22 e le fermate della 10 e della 11 fuori dall'area.

### traffico

Aperta l'11 novembre 2026. Bus automatici, auto, pedoni e semafori (IDEE, "Traffico e regole"). File: `Traffic`,
`Walkers` e `TrafficLights` in `src/world/traffic.js`, `src/world/buses.js`; in sola lettura `laneLayout`,
`driveOffset` e `turnLanes` di `src/data/padova.js` (dati della corsia `mappa`).

- **Prima di tutto la segnalazione del 9 novembre** (IDEE, prossimi passi 5): "Problema con semafori in centro tra
  tito livio e ponti romani si bloccano gli autobus che a loro volta bloccano i tram". Mandata dalla linea 3, giorno
  feriale, alle 8:54 di gioco, in x 81, z -133 (Riviera dei Ponti Romani; il SIR1 passa di lì).
  1. Riprodurre in headless: corsa della 3 vicino a quell'ora, giocatore portato lontano dai binari, `__game.sim`
     per 20-30 minuti di gioco, posizione e velocità di bus automatici (`__game.buses`), tram (`__game.trams`) e auto
     tra Riviera Tito Livio e Riviera dei Ponti Romani. Trovare chi aspetta chi: incrocio occupato col rosso, bus
     fermo sul binario, attese incrociate tra bus, tram e auto.
  2. Correggere la causa: chi non può liberare l'incrocio non ci entra, un bus non resta fermo sopra il binario, e
     nessuno aspetta all'infinito qualcuno che aspetta lui.
  3. Una prova in `tests/` su quel tratto (bus e tram non restano fermi oltre 90 s fuori dalle fermate e dai rossi),
     poi lo stesso controllo su tutta la mappa per 40 minuti di gioco alle 8:15 e alle 17:30, per trovare gli altri
     blocchi (elenco in questa sezione).
- **Subito dopo, gli incroci tra traffico e tram** (chiesto da chi gioca l'11 novembre): se il tram ha il passaggio,
  auto e bus si fermano prima della sede; se lo ha la strada, il tram si ferma. Vale per i tram automatici e per
  quello di chi gioca, per i bus automatici e per le auto. Ai semafori vuol dire coordinare `TramSignals` con
  `TrafficLights`: oggi i semafori del tram non seguono quelli stradali (IDEE, punto 1). Dove non c'è semaforo serve
  una precedenza dichiarata e rispettata dai due lati. Questo lavoro passa alla corsia `traffico`, che per farlo tocca
  `TramSignals` (e `TramSim` dove i tram automatici devono fermarsi), scrivendolo qui. Prova in `tests/`: a un
  incrocio semaforizzato sulla sede, tram e auto non sono mai dentro l'incrocio insieme.
- Poi, in quest'ordine: auto che rispettano STOP, precedenze e rotonde; pedoni sulle strisce con precedenza e penalità
  per chi non la dà; svolte a sinistra protette ai semafori dove `turn:lanes` ha una corsia di svolta (passate da
  `mappa`); corsie preferenziali vere, con le auto che non le usano; traffico più lento con pioggia e nebbia.
- Con il tram: `TramSim` e `TramSignals` restano della futura corsia `tram-turni`, tranne il coordinamento con il
  traffico (sopra); per il resto, se lo sblocco dei tram chiede di toccarli, si scrive qui cosa e perché.
- Verifiche: regola 3, più le foto dal posto di guida nei punti cambiati e la guida della 3 su Riviera dei Ponti Romani.

### guida

Aperta l'11 novembre 2026. Comandi e veicolo di chi gioca (IDEE, "Veicoli e guida"). File: `src/bus/bus.js`, gli
ingressi in `src/main.js` (oggetto `input`, comandi touch), menu e pausa in `index.html` e `src/style.css`.

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
  - Se il giocatore la trova ancora diversa da prima: quello che resta è il ritorno al centro lento dopo il rilascio.
    Si può renderlo più svelto solo dopo un tasto (il pilota delle prove non preme tasti), ma cambia la guida di
    tutti: da decidere.
- Prossimo lavoro, in quest'ordine: gamepad e volante (Gamepad API); bus elettrico con batteria e ricarica al capolinea;
  telecamera della porta posteriore sul cruscotto; specchietti regolabili.
- Verifiche: regola 3; il giro guidato di `npm test` deve restare uguale.

### tram-reti (chiusa il 9 novembre)

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

### segnalazioni (chiusa il 9 novembre)

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

## Onde successive

Onda 2, quando le corsie dell'onda 1 si chiudono (`traffico` e `guida` aperte l'11 novembre, sopra):

- `traffico`: aperta. Le corsie preferenziali si appoggiano su `laneLayout` e `driveOffset` di `padova.js` (corsie,
  corsie dei bus e scostamenti per verso).
- `tram-turni`: turni del tram e deposito della Guizza, binario tronco (i semafori del tram coordinati con il traffico
  sono passati a `traffico` l'11 novembre). Può partire:
  gli scambi tra le sedi sono in `track.switches`, quelli ai capolinea si disegnano in `buildTramway`.
- `esplorazione`: panoramica e giro libero senza mezzo, poi l'ortofoto AGEA (M5).
- `guida`: aperta (sterzo, poi gamepad, bus elettrico con ricarica, telecamera della porta posteriore, specchietti).

Onda 3, da sola su `city.js`: `mappa-aree` al posto di `mappa`. Caricamento per aree (sezione 4 di
[`ESTENSIONE_LINEE.md`](ESTENSIONE_LINEE.md)) e l'aggiornamento automatico del GTFS. Le linee fino ai capolinea veri
e la tappa 4 del tram le ha anticipate la corsia `capolinea`.

Per aprire una corsia (da `~/Sites/flevour/bus-simulator`):

```bash
herdr worktree create --cwd ~/Sites/flevour/bus-simulator --branch corsia/<nome> --base origin/main --label <nome> --no-focus
```

poi `npm install` nel pannello del worktree e una riga nella tabella delle corsie aperte.
