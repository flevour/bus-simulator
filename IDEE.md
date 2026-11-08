# Idee e sviluppi

Elenco a cui attingere per i prossimi lavori. Quando un'idea viene realizzata si sposta in fondo, in **Fatto**.
Legenda: `[ ]` da fare · `[~]` parziale · `[x]` fatto.

## Prossimi passi

1. [~] **Tram SIR1 guidabile**: fatto (vedi "Fatto"). Restano:
   - il binario tronco oltre il capolinea della Guizza, che entra in un edificio;
   - i semafori del tram coordinati con quelli stradali agli incroci semaforizzati;
   - interni più curati;
   - pedoni che attraversano la sede e si fermano;
   - specifica: [`docs/prompt-tram.md`](docs/prompt-tram.md).
2. [ ] **Nuovo piazzale della stazione** con gli anelli (ovali concentrici) del tram, per le linee future
   **SIR2, SIR3, SIR4, SIR5**. La geometria del tram dovrà gestire più linee, gli anelli e i deviatoi, non una sola
   sede: modellarla come grafo di binari (rami e scambi) su cui ogni linea ha il suo percorso.
3. [~] **Segnaletica reale da OpenStreetMap**: semafori, STOP, dare precedenza e strisce pedonali fatti (vedi
   "Fatto"). Restano:
   - fermate del tram dai nodi OSM (`tram_stop`);
   - semafori pedonali solo nel verso indicato da `traffic_signals:direction`;
   - dossi (`traffic_calming`) e corsie riservate (`highway=busway`);
   - istruzioni: [`docs/overpass-segnaletica.md`](docs/overpass-segnaletica.md).
4. [ ] **Segnaletica orizzontale dai tag OSM già presenti** (`lanes` su ~5400 strade, `lanes:forward/backward`,
   `overtaking`, `turn:lanes`, `lanes:psv`):
   - numero di corsie e linee divisorie;
   - mezzeria continua dove `overtaking=no`;
   - frecce a terra da `turn:lanes`;
   - corsie preferenziali gialle con la scritta BUS da `lanes:psv` / `bus:lanes`.
5. [~] **Segnalazioni dal gioco** (modulo Richieste; il 6 novembre dalla linea 42 in Via Madonna della Salute):
   - [x] fermate date per saltate prima di averle attraversate (vedi "Fatto");
   - [ ] semafori in mezzo alla strada e orientati male; zone pedonali; profilo altimetrico delle strade;
   - [ ] navigatore sulle linee 22, 13, 25 (in parte era lo stesso salto della posizione, da ricontrollare);
   - [ ] zona Plebiscito: strade e fermate;
   - [ ] cavalcavia da migliorare e posizione dei fiumi;
   - [ ] mappa più grande;
   - dal sondaggio del 7 novembre (linea 5, Corso del Popolo):
     - [ ] passeggeri anche sugli altri autobus;
     - [ ] deposito per le prime corse del mattino e le ultime della sera, che partono dalla stazione o ci finiscono;
     - [ ] piazzale della stazione: le fermate non corrispondono alle corsie e gli autobus partono a caso.

## Mappa e dati

- [ ] **Modello della città coerente con la realtà**: piano con fonti, misure dalle norme, pipeline a strati, semafori,
  fermate, verifiche e tappe in [`docs/PIANO_MODELLO_CITTA.md`](docs/PIANO_MODELLO_CITTA.md). Si parte da M0
  (strati Overture) e M2 (carreggiate e cordoli dalla CTRN 1:5000, raggiungibile da GitHub).

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
- [ ] 30 fermate servite su 403 non hanno palina (il posizionamento viene scartato): capire caso per caso.
- [ ] Capolinea: tratti del percorso GTFS senza strada corrispondente (map matching). Aggiungere le strade di servizio
  e le aree dei capolinea.
- [ ] Aggiornamento automatico del GTFS: workflow programmato che scarica il feed BusOne e rigenera
  `src/data/padova-map.json`.
- [ ] Edifici: altezze reali dove mancano (centro storico), tetti più vari, portici dove mancano.
- [ ] Piste ciclabili e ciclisti; sottopassi pedonali.
- [ ] Ampliare l'area di gioco oltre Centro e Arcella (linee oggi tagliate "tratto in città").

## Veicoli e guida

- [ ] Tram SIR1 (3 moduli), poi linee tram future con 4 moduli (vedi prompt).
- [ ] Bus snodato da 18 m per le linee più cariche.
- [ ] Bus elettrico: batteria, consumo, ricarica al capolinea (pantografo); punti per il recupero in frenata.
- [ ] Volante e pedaliera o gamepad (Gamepad API); comandi touch per smartphone (il gioco è su GitHub Pages).
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
- [ ] Turni di lavoro: più corse di fila con pausa al capolinea.

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

- [ ] Bundle da 4,7 MB: dati JSON separati e compressi, caricamento progressivo.
- [ ] Prestazioni su mobile.
- [ ] Test automatici in CI (build + giro dell'autopilota in headless).

## Fatto

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
- [x] Livree: moderna elettrica (argento, tetto blu, verde lime) e storica arancione e bianca.
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
