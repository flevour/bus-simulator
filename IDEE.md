# Idee e sviluppi

Elenco a cui attingere per i prossimi lavori. Quando un'idea viene realizzata si sposta in fondo, in **Fatto**.
Legenda: `[ ]` da fare · `[~]` parziale · `[x]` fatto.
Chi lavora su cosa (corsie in parallelo nei worktree): [`docs/CORSIE.md`](docs/CORSIE.md).

## Prossimi passi

1. [~] **Tram SIR1 guidabile**: fatto (vedi "Fatto"). Restano:
   - il binario tronco oltre il capolinea della Guizza, che entra in un edificio;
   - i semafori del tram coordinati con quelli stradali agli incroci semaforizzati;
   - interni più curati;
   - pedoni che attraversano la sede e si fermano;
   - [ ] **turni del tram e deposito della Guizza**, come per il bus (vedi "Fatto"): la prima corsa del turno esce dal
     deposito, l'ultima ci rientra; al capolinea cambio cabina (B) e corsa successiva senza tornare al menu. Il
     deposito è accanto al capolinea della Guizza: in OSM ci sono i binari di servizio (`railway=tram`,
     `service=yard`, Busitalia Veneto, verso 45.3670, 11.8756), alcuni dentro la rimessa (`tunnel=building_passage`),
     e sono già nell'export `data/osm-padova-tram.json` (35 binari di servizio), da vedere se il gioco li usa. Il
     binario tronco "che entra in un edificio" è forse l'ingresso della rimessa: da verificare;
   - specifica: [`docs/prompt-tram.md`](docs/prompt-tram.md).
2. [~] **Nuovo piazzale della stazione e linee SIR2, SIR3**: grafo dei binari con i due anelli e le due linee nel
   gioco per il tratto in città fatti (vedi "Fatto"; dettagli in [`docs/linee-tram-nuove.md`](docs/linee-tram-nuove.md)).
   Restano:
   - la sede di SIR2 e SIR3 nella pianta delle strade (tappa 3, corsia `mappa`): oggi i binari sono disegnati sopra
     l'asfalto e in diversi tratti la corsia dei bus ci passa sopra o accanto (richiesta in `docs/CORSIE.md`);
   - l'area di Voltabarozzo (tappa 4) e le linee fino ai capolinea veri (Voltabarozzo, Rubano, Busa di Vigonza);
   - i rami del SIR2 per Romagnoli e per l'Ospedale San Lazzaro, ancora in cantiere in OSM;
   - SIR4 e SIR5, e le linee passanti della rete SMART (T1, T2 e le altre) sugli stessi binari;
   - la linea 10 resta tra gli autobus (deciso il 9 novembre); quando il SIR2 sarà in servizio si potrà toglierla.
3. [x] **Segnaletica reale da OpenStreetMap**: semafori, STOP, dare precedenza, strisce pedonali, fermate del tram,
   dossi e corsie (vedi "Fatto"). `highway=busway`: nell'area ci sono 3 vie, due doppioni della corsia in controsenso
   di Corso Garibaldi già nei dati, niente da fare. Istruzioni:
   [`docs/overpass-segnaletica.md`](docs/overpass-segnaletica.md).
4. [~] **Segnaletica orizzontale dai tag OSM**: corsie, divisorie, mezzeria continua, frecce e corsie dei bus fatte
   (vedi "Fatto"). Restano le svolte a sinistra protette ai semafori dove `turn:lanes` ha una corsia di svolta
   (`TrafficLights` in `traffic.js`), le corsie nelle rotatorie a due corsie e le auto che non usano le corsie dei bus
   (corsia del traffico, onda 2).
5. [~] **Segnalazioni dal gioco** (modulo Richieste; il 6 novembre dalla linea 42 in Via Madonna della Salute):
   - [x] fermate date per saltate prima di averle attraversate (vedi "Fatto");
   - [x] semafori in mezzo alla strada e orientati male (vedi "Fatto");
   - [x] profilo altimetrico delle strade (terreno dal DTM della Regione, vedi "Fatto");
   - [x] zone pedonali (piazze e aree pedonali lastricate dal DBGT); resta la ZTL;
   - [x] navigatore sulle linee 22, 13, 25 (vedi "Fatto"); la 22 verso Mandria ora ha Via Madonna della Salute;
   - [~] zona Plebiscito: al Capolinea Plebiscito la 16 e la 24 saltavano in linea retta sul prato (vedi "Fatto");
     la segnalazione non dice altro: se resta qualcosa servono i dettagli da chi gioca;
   - [~] cavalcavia: al Borgomagno la rampa dei bus e del tram che sale dalla stazione restava a terra, con il tram
     sospeso e una gobba dove passa la 24 (vedi "Fatto"); restano i sottopassi che nella realtà scendono sotto il
     piano della strada (Corso Australia su Via Cignaroli, Corso Tredici Giugno su Via Rienza: il gioco non abbassa
     le strade) e la posizione dei fiumi;
   - [ ] cavalcavia di Chiesanuova sul SIR2 (9 novembre): impalcato a pezzi, asfalto e sede del tram storti (corsia
     `mappa`);
   - [ ] rotonde attraversate dal tram: l'isola verde copre binari e sede (9 novembre, corsia `mappa`);
   - [ ] mappa più grande (corsia `capolinea`);
   - dal sondaggio del 7 novembre (linea 5, Corso del Popolo):
     - [x] passeggeri anche sugli altri autobus (vedi "Fatto");
     - [x] deposito per le prime corse del mattino e le ultime della sera (vedi "Fatto"); restano il piazzale del
       deposito (oggi dietro la sbarra c'è prato), il tram (deposito della Guizza, punto 1) e i turni che cambiano
       linea;
     - [x] piazzale della stazione: le fermate non corrispondono alle corsie e gli autobus partono a caso.
       Controllato linea per linea e corretto nei dati (vedi "Fatto" e
       [`docs/piazzale-stazione.md`](docs/piazzale-stazione.md)).

## Mappa e dati

- [~] **Modello della città coerente con la realtà**: piano con fonti, misure dalle norme, pipeline a strati, semafori,
  fermate, verifiche e tappe in [`docs/PIANO_MODELLO_CITTA.md`](docs/PIANO_MODELLO_CITTA.md). Fatte M1–M4 e verde,
  isole e alberi del DBGT; i prossimi passi in ordine sono nel piano (sezione 7, "Prossimi passi"):
  - [~] corsie e segnaletica orizzontale fatte (vedi "Fatto"); restano le svolte a sinistra protette ai semafori;
  - [x] portici veri dai volumi del DBGT (vedi "Fatto");
  - [x] paline e pensiline da OSM (vedi "Fatto");
  - [x] zone pedonali e piazze lastricate (aree pedonali del DBGT); resta la ZTL;
  - [ ] quote stradali del DBGT e sottopassi; tessere LiDAR da chiedere alla Regione;
  - [x] rapporto di verifica e test in CI (vedi "Fatto"); restano i casi che ha trovato:
    - [x] lampioni in carreggiata: da 1.121 a nessuno (stanno fuori dall'asfalto vero, vedi "Fatto");
    - [ ] 9 fermate dove il bus fermo tocca un edificio (erano 19; i lampioni non più): Milano 61 (linee 6, 9, 10,
      42), Tommaseo 114 (3, 7, 10, 25), Buonarroti 46 (24), facciate sul bordo dell'asfalto;
    - [ ] 11 fermate agganciate a più di 40 m dalla fermata vera (erano 33): Bembo 95 (3, 317 m), le altre tra 43 e
      71 m (Facciolati 160, Decorati 57, Falloppio 69, Garibaldi giardini, Armistizio 164, Volta fr. 24, Croce
      Rossa 112);
  - [ ] mappa più leggera (dati separati e compressi);
  - [ ] ortofoto AGEA 2024 in Esplorazione; catasto, Mapillary e richiesta al Comune.

- [ ] **Modalità di esplorazione senza mezzo**, per controllare com'è fatta la mappa:
  - *panoramica*: vista dall'alto con trascinamento (pan) e zoom, come una mappa;
  - *giro libero*: telecamera che vola ovunque, WASD per muoversi (e mouse per guardarsi intorno), senza bus né
    regole di guida.

- [ ] Fonti open data per un gioco più realistico (semafori e cartelli reali, domanda di passeggeri da ISTAT e poli OSM,
  meteo reale da Open-Meteo, altezze dalla CTR del Veneto): ricerca in [`docs/OPEN_DATA.md`](docs/OPEN_DATA.md).

- [ ] Foto aeree per le strisce (mezzeria, linee di arresto). Pipeline offline: ortofoto a ~20 cm/pixel, riconoscimento
  delle strisce, aggancio alle strade OSM. Problemi:
  - licenza: Google e Bing non permettono di ricavarne dati; le ortofoto della Regione Veneto sono da verificare;
  - alberi, ombre e auto coprono le strisce;
  - dai container cloud i server della Regione sono bloccati.
- [ ] 25 fermate servite su 484 non hanno palina (il posizionamento viene scartato; Corsia 1 e Corsia 2 della stazione
  ne hanno una sola, a 1,8 m in OSM): Garibaldi Eremitani, Borgomagno, Largo Europa, T. Aspetti 141 e fr. 240, Bronzetti
  4, Crescini 6, Facciolati CTO, Capolinea Pontecorvo e altre ai bordi della mappa. Capire caso per caso.
- [~] Capolinea: tratti del percorso GTFS senza strada. Le corsie di servizio dove passa un bus entrano nella rete
  (vedi "Fatto"); restano 11 salti, tutti ai bordi della mappa (13 ad Altichiero, 19 a Saletto, 24 a Mandriola).
- [ ] **Mappa fino a tutti i capolinea di tutte le linee**: oggi molte varianti sono "tratto in città" e partono al
  bordo della mappa. Allargare rete, edifici, pianta delle strade, terreno e fermate lungo i percorsi GTFS fino a ogni
  capolinea (corridoi attorno ai percorsi, per non far crescere troppo la mappa).
- [~] **Piazzale della stazione**: tante corsie e capolinea nello stesso piazzale. Verificato linea per linea in
  [`docs/piazzale-stazione.md`](docs/piazzale-stazione.md); i dati sono sistemati (banchine vere, sensi unici, Ex
  Catasto sulla strada sud, partenze dalla fermata). Restano i due passaggi che mancano in OSM (dalla strada sud alla
  corsia sud verso x = 231, dalla corsia nord alla corsia sud verso x = 190): oggi i bus ci arrivano con il giro
  legale dall'entrata est. Corsia 1 e Corsia 2 hanno la stessa palina (OSM le mette a 1,8 m l'una dall'altra); la 4
  per il Capolinea Nord parte dalla corsia sud e fa il giro del piazzale. La banchina sud è del tram.
- [~] Percorsi con brevi deviazioni avanti e indietro in una via laterale (179 tratti A-B-A, errori di aggancio del
  tracciato GTFS): quelli senza fermate li tolgono già i dati (`drop_spurs`); con i giri nelle rotatorie e le linee
  tagliate senza andata e ritorno ai capi (vedi "Fatto") ne restano 11, tutti con una fermata: la 3 in Via Bembo
  (749 m, tre varianti), la 4 in Via Gramsci (cinque varianti), la 16 e la 24 al Capolinea Plebiscito. Da capire caso
  per caso (alcuni possono essere veri).
- [ ] Corsie bus in controsenso (flag 256): il gioco le conosce per i percorsi, ma i bus le percorrono al centro della
  strada; servirebbe una corsia propria sul lato giusto, e le auto non dovrebbero usarla.
- [ ] Aggiornamento automatico del GTFS: workflow programmato che scarica il feed BusOne e rigenera
  `src/data/padova-map.json`.
- [~] Edifici: altezze misurate dal DBGT della Regione e portici veri (fatti, vedi "Fatto"); restano tetti più vari.
- [ ] Piste ciclabili e ciclisti; sottopassi pedonali.
- [ ] Ampliare l'area di gioco oltre Centro e Arcella (linee oggi tagliate "tratto in città"): linee complete fino ai
  capolinea veri, con un corridoio di 130 km² attorno ai tracciati. Valutazione e piano in
  [`docs/ESTENSIONE_LINEE.md`](docs/ESTENSIONE_LINEE.md).

## Veicoli e guida

- [x] Tram: SIR1 e SIR3 a 3 moduli, SIR2 a 4 moduli (vedi "Fatto").
- [ ] Bus elettrico: batteria, consumo, ricarica al capolinea (pantografo); punti per il recupero in frenata.
- [ ] Volante e pedaliera o gamepad (Gamepad API).
- [ ] Telecamera della porta posteriore sul cruscotto; specchietti regolabili.
- [ ] Altre livree storiche (anni '80–'90).

## Traffico e regole

- [ ] Le auto rispettano STOP, precedenze e rotonde (oggi solo semafori).
- [ ] Pedoni che attraversano sulle strisce con obbligo di precedenza (e punti).
- [ ] Penalità per non dare precedenza a chi arriva (rotonde, dare precedenza).
- [ ] Corsie preferenziali vere: bonus per il bus, auto che non le usano.
- [ ] Traffico più lento con pioggia e nebbia.

## Passeggeri e servizio

- [ ] Pedana per carrozzine alla porta centrale, passeggini.
- [ ] Controllore e validazione dei biglietti.
- [ ] Annunci di fermata più naturali; display interno con le prossime fermate.
- [ ] Affollamento per fascia oraria e per fermata più realistico.
- [~] Turni di lavoro: più corse di fila con sosta al capolinea (fatto per il bus, vedi "Fatto"); restano il tram
  (punto 1), la pausa dell'autista e il cambio turno.

## Meteo e ambiente

- [ ] Pozzanghere e riflessi sull'asfalto bagnato.
- [ ] Temporale con lampi; rara neve.
- [ ] Pedoni con l'ombrello quando piove.
- [ ] Stagioni (alberi spogli in inverno), alba e tramonto più curati.

## Gioco

- [ ] Sfide nel giro libero (corsa perfetta, a tempo, fermate di precisione).
- [ ] Classifiche per linea (serve un backend).
- [ ] Tutorial guidato per la prima corsa.

## Tecnica

- [ ] Bundle da 13,5 MB (12,4 MB di mappa): rete sempre caricata, strade ed edifici a riquadri scaricati vicino al bus.
  Piano nella sezione 4 di [`docs/ESTENSIONE_LINEE.md`](docs/ESTENSIONE_LINEE.md).
- [ ] Prestazioni su mobile.
- [ ] Pilota delle prove (`tests/guida.js`) più bravo nelle svolte a T e in quelle strette a destra (oggi sbaglia
  dopo il capolinea sulle linee 9 e 21), per allargare il giro guidato a tutte le linee; casi di prova dalle
  segnalazioni di chi gioca (coordinate da ricontrollare a ogni build, sezione 6.2 del piano della città).

## Fatto

- [x] Verifiche automatiche: `npm test` con Playwright (il gioco si carica, corse del bus e del tram che avanzano,
  giro guidato con un pilota scritto nella prova sulle linee 24, 10, 3, 14 e sul SIR1 nei due versi), rapporto di
  verifica sulla mappa (`scripts/verifica_mappa.py` sul JSON, `tests/mappa.spec.js` nel gioco) con soglie sui valori
  del 9 novembre, workflow Verifiche in CI a ogni push su `main`. Prove senza audio e senza eventi PostHog.
- [x] Tram SIR3 e SIR2, linee in costruzione: percorsi sui binari OSM, fermate e orario generato
  (`scripts/tram_linee.py`, `data/tram-linee-nuove.json`). Nel gioco il tratto in città, SIR3 da Stazione sud a Cornaro
  e SIR2 (4 moduli) da Cimitero Maggiore a Savelli, nel menu del tram accanto al SIR1 con la scritta "in costruzione".
  Grafo dei binari: una sede per linea che nei tratti in comune corre sulla rotaia di quella già posata, con gli
  scambi ai capi; in stazione SIR2 e SIR3 sull'anello interno, con le banchine dentro l'anello. Tram automatici delle
  tre linee, con le precedenze agli scambi, agli incroci a raso tra binari e con i bus che corrono sopra i binari.
- [x] Piazzale della stazione: banchine vere di OSM (`highway=platform`) al posto delle isole del DBGT del 2007,
  corsie a senso unico rispettate (ogni capolinea si raggiunge sulla corsia della sua banchina), corsie ristrette allo
  spazio tra le banchine. Paline per nome (Via Giotto), niente paline doppie (erano 28), andate e ritorno A-B-A da 179
  a 44, tratti contromano da oltre mille a 127.
- [x] Mappa, 9 novembre (corsia `mappa`):
  - **corsie e segnaletica orizzontale dai tag OSM**: numero di corsie per verso (`lanes`, `lanes:forward/backward`)
    sulla carreggiata misurata, tratteggio 3 + 3 m tra le corsie, mezzeria continua con `overtaking=no`, nessuna riga
    con `lane_markings=no`, corsie dei bus (`busway`, `lanes:psv`, `psv:lanes`, `bus:lanes`, anche in controsenso) con
    la riga gialla e la scritta BUS, frecce a terra da `turn:lanes`; linee d'arresto dalla riga che separa i versi; le
    auto nella corsia più a destra;
  - **fermate del tram** sui nodi OSM `tram_stop`, a metà della banchina vera (le fermate GTFS stanno in fondo);
  - **dossi e attraversamenti rialzati** da `traffic_calming` (nodi e vie rialzate): strisce gialle e nere, denti
    sulle rampe, scossone e comfort se presi troppo forte;
  - **area ai bordi**: sei riquadri dove i percorsi escono e rientrano (Via Madonna della Salute per la 22, Ippodromo,
    Altichiero, Cadoneghe, Ponterotto, Due Palazzi); le linee tagliate tengono il tratto più lungo di fermate
    consecutive e il percorso attorno a quelle: fermate agganciate nel punto sbagliato da 121 a 10;
  - **inversioni a U**: giro nella rotatoria al posto della manovra (Rotonda Galante sulla 9 e sulla 42), linee
    tagliate senza andata e ritorno ai capi;
  - **corsie di servizio dove passa un bus** (anelli dei capolinea nei parcheggi): il Capolinea Plebiscito senza salti;
  - **lampioni** fuori dall'asfalto vero: da 1.116 in carreggiata a nessuno.
  - **rampe dei cavalcavia** (`overpass_heights` in `street_surfaces.py`): la quota scende su tutti i rami con il
    nome del ponte (al Borgomagno la rampa dei bus e del tram verso la stazione era a terra, con un gradino di 6,5 m
    in 16 m, il tram sospeso sopra il terrapieno del DTM e una gobba di 2,8 m nel sottopasso della 24); almeno 5 m
    sopra le strade in sottopasso (`tunnel` o `layer` < 0) dove la rampa è ancora alta; raccordi al 10% per le
    strade che si innestano (Via Friburgo al Cavalcavia Grassi, Via Pietro Liberi, Cavalcavia Mortise: prima fino
    al 74%).
- [x] Passeggeri sugli altri autobus: dai finestrini dei bus automatici si vedono i passeggeri seduti e in piedi (di
  sera con l'interno illuminato); vicino al giocatore, alle fermate dove si fermano, qualcuno aspetta, sale dalla
  porta anteriore e scende da quella centrale, e il bus aspetta che abbiano finito.
- [x] Navigatore rifatto: svolte annunciate solo agli incroci (non le curve della strada), bivi con "tieni la
  destra/sinistra", rotatorie con il numero dell'uscita (e dentro quante ne mancano), inversioni, la manovra dopo se è
  vicina. Tolte dai percorsi le andate e ritorni senza fermate in una via laterale (13 a Largo Europa, 42 in Via
  Madonna della Salute e altre).
- [x] Paline vere da OSM (via Overture), con pensilina e panchina dove OSM le segna; capolinea con partenza e arrivo
  sullo stesso tratto (Largo Debussy lungo il giardino, corsie della stazione), una sola palina.
- [x] Portici veri: dai volumi del DBGT sopra i portici (altezza libera misurata) per 2.198 edifici; archi alti come
  quelli reali; quelli a caso restano solo fuori dall'area misurata. Forma vera di carreggiate e marciapiedi dal
  DBGT; ponti e rive senza strade che scendono nell'alveo; Largo Debussy con l'anello del capolinea.
- [x] Isole, verde e alberi dal DBGT: spartitraffico tra le carreggiate e alle isole di traffico (fuori dalle corsie
  e dai percorsi dei bus), prati, aree alberate e aiuole come strato verde, alberi veri dei filari e dei parchi al
  posto di quelli generati dentro il comune.
- [x] Terreno con le quote vere (tappa M4 del piano): DTM a 5 m della Regione del Veneto, griglia a 10 m applicata a
  tutta la scena nel vertex shader; centro storico più alto, alvei e argini, ponti raccordati tra le sponde, cavalcavia
  spianati sotto, pendenza nella guida del bus. Restano i sottopassi e il LiDAR (da chiedere alla Regione).
- [x] Carreggiate, marciapiedi e altezze degli edifici misurati (tappe M2 e M3 del piano): larghezze dal DBGT della
  Regione del Veneto (2007) lungo le vie OSM di oggi, marciapiedi veri (spesso sotto i 2 m), paline al bordo
  dell'asfalto, altezze alla gronda dai volumi misurati per il 71% degli edifici. Restano isole e verde del DBGT.
- [x] Turno del bus: le corse che fa lo stesso mezzo si ricavano dall'orario (dopo l'arrivo al capolinea, la prima
  corsa della linea che riparte da lì dopo 3-40 minuti; fino a 1,5 km e un'ora ai capolinea al bordo della mappa). La
  prima del turno esce dal deposito della Stanga (sbarra su Via Orlandini, dai dati OSM) fuori servizio, con il
  navigatore che ricalcola se si sbaglia strada; al capolinea si sceglie tra la corsa dopo (dalla fermata di
  partenza, fuori servizio se serve), il rientro in deposito e il menu, con il punteggio del turno.
- [x] Semafori rifatti (tappa M1 del piano): linea d'arresto dal nodo OSM del semaforo o prima delle strisce, palo sul
  marciapiede vero subito oltre la linea (nessuno in carreggiata), ripetitrice a sinistra sui sensi unici a più corsie,
  sbracci sulle vie larghe, lanterne a muro dove il marciapiede è stretto, luci orientate sull'asse del braccio;
  incroci a carreggiate separate e con la sede del tram come un solo impianto; ciclo comune di 60 s con giallo di 4 s
  sulle vie dei bus e onda verde; semafori pedonali solo nel verso di `traffic_signals:direction`.
  Restano le svolte a sinistra protette (`turn:lanes`).
- [x] Posizione lungo il percorso che segue il verso di marcia: dove il percorso ripassa vicino a sé stesso non salta
  più avanti (fermate date per saltate prima di arrivarci, navigatore avanti di centinaia di metri).
- [x] Bus automatici di tutte le linee dall'orario GTFS (capolinea, fermate a richiesta, semafori, code, uscita fuori
  servizio) e saluto tra autisti con Y (punti bonus).
- [x] Novità dall'ultima visita nel menu e modulo per richieste e segnalazioni (sondaggio PostHog).
- [x] Gocce di pioggia sul parabrezza di bus e tram, tolte dai tergicristalli contrapposti (quasi tutto il vetro);
  tergicristalli anche sul tram; sterzo da tastiera progressivo.
- [x] Modalità Esplorazione (nessuna regola, il tram non deraglia); meteo e ora della luce dal menu di pausa.
- [x] Semafori del tram a tre luci (barra orizzontale, triangolo, barra verticale), le spente visibili.
- [x] Pianta delle strade calcolata con Shapely (`scripts/street_surfaces.py`): carreggiate con i raccordi agli
  incroci, rotatorie circolari con l'isola, spartitraffico, marciapiedi solo dove la via li ha, edifici ritagliati;
  il gioco disegna le aree e usa il bordo dell'asfalto per le ruote.
- [x] Banchine centrali del tram comuni ai due versi (dalle banchine OSM), porte aperte dal lato della banchina.
- [x] Tram con la cassa bombata in due blu; linea aerea con tiranti dalle facciate al posto dei pali centrali.
- [x] Fermate a richiesta anche col tram; cavalcavia anche sopra le strade (Corso Tredici Giugno sopra Via Sacro
  Cuore).
- [x] Sede del tram sui binari OSM (`railway=tram`), un tracciato per verso: lo shape GTFS correva su un binario ma il
  gioco lo usava come asse, e la sede finiva 1,7 m di lato (in Corso Vittorio Emanuele sopra la carreggiata).
- [x] Strade più larghe sui percorsi dei bus (minimo 7,5 m a doppio senso, 5,5 a senso unico, 7 in rotatoria) e
  facciate spostate fuori da carreggiate, marciapiedi e sede del tram invece di restringere le strade; tolti gli
  edifici che la mezzeria attraversa. Corsie riservate ai bus (`access=no` + `psv`) nel grafo, vietate alle auto.
- [x] Cavalcavia Borgomagno come corpo unico: la strada verso sud e, 0,5 m più in basso, la sede del tram con la
  corsia dei bus verso nord, unite da una soletta (vale per tutti gli impalcati in quota affiancati).
- [x] Il bus può percorrere la sede del tram senza penalità.
- [x] Orari intermedi ripartiti secondo il tempo di guida (il GTFS chiedeva medie impossibili in periferia).
- [x] Tram SIR1 guidabile (3 moduli, numero di moduli come dato della linea):
  - corse reali GTFS (anche le limitate);
  - corsie e rotaie per senso, banchine a destra, fermata col muso a fine banchina;
  - manipolatore, campanello, cambio cabina, limiti in curva;
  - linea aerea con pantografo, da abbassare a Prato della Valle (a batteria) e rialzare subito dopo;
  - tram automatici con la stessa livrea.
- [x] Precedenza al tram agli incroci (48 incroci con la sede), semafori del tram a barre con chiamata, deragliamento
  in curva troppo veloce.
- [x] Menu: prima la scelta del mezzo (autobus o tram), poi le linee; livrea solo per l'autobus. Meteo variabile
  predefinito.
- [x] Area di gioco allargata a sud fino al capolinea della Guizza (strade OSM già nell'export, edifici Overture).

- [x] Linee urbane reali dal GTFS Busitalia (varianti, fermate, orari feriali e festivi); strade OSM; edifici Overture.
- [x] Pausa, salvataggio e ripresa della corsa; teletrasporto (J e clic sulla mappa grande).
- [x] Sede tranviaria del SIR1 con corsie rosse e rotaia; tram automatici dall'orario GTFS (quanti ne sono in servizio
  a quell'ora, ognuno sulla sua corsa; al capolinea prendono la corsa successiva).
- [x] Livree: moderna elettrica (argento, tetto blu, verde lime) e storica arancione e bianca; poi rosso e bianco,
  elettrico blu (salita dalla porta verde, discesa dalla rossa), elettrico verde lime, blu e argento. Il 12 m ha due
  porte, davanti e in mezzo; la terza in fondo solo sull'arancione e sul rosso.
- [x] Bus snodato da 18 m sulla linea 10 (rimorchio che segue la ralla, quattro porte, soffietto).
- [x] Comandi touch per smartphone: volante e pedali analogici, pulsanti a video, HUD compatto.
- [x] Sguardo col mouse (trascinamento), V o doppio clic per tornare avanti.
- [x] Il ritardatario arriva da dietro e sale dalla porta posteriore.
- [x] Pubblicazione su GitHub Pages da `main`.
- [x] Meteo variabile con transizioni (nuvole, pioggia, nebbia, strade bagnate).
- [x] Marciapiede: contano le ruote; fascia sormontabile a incroci e rotonde.
- [x] Retromarcia con S ripremuto da fermo; W da fermo torna avanti.
- [x] Incroci con cordoli raccordati al posto dei dischi.
- [x] Palina spostata di qualche metro se cade su un'altra strada (es. Bramante Chiesa).
- [x] Segnaletica gialla di fermata: zig-zag, tratteggio, scritta BUS.
- [x] Cartelli verticali agli incroci (STOP, dare precedenza, rotatoria) e regola dello STOP.
- [x] Semafori, STOP, dare precedenza e strisce pedonali reali dai nodi OSM (`scripts/overpass-nodes.ql`): un impianto
  per incrocio anche su più nodi, semafori pedonali in mezzo ai tratti, linea d'arresto prima delle strisce.
