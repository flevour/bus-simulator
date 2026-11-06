# 🚌 Padova Bus Simulator

Simulatore di autobus urbano **in prima persona** ambientato a **Padova**, realizzato con [Three.js](https://threejs.org/).
Scegli il mezzo (**autobus** o **tram**), una linea, il servizio **feriale** o **festivo**, la direzione e la corsa dell'orario, poi porta i passeggeri a destinazione rispettando fermate, semafori, limiti di velocità e tabella di marcia.

**Gioca online:** https://flevour.github.io/bus-simulator/

## Avvio

```bash
npm install
npm run dev        # server di sviluppo su http://localhost:5173
npm run build      # build di produzione in dist/
npm run build:single  # un unico file HTML autosufficiente in dist-single/index.html
```

### Pubblicazione su GitHub Pages

Il workflow `.github/workflows/pages.yml` compila il gioco (`npm run build`) e pubblica `dist/` su GitHub Pages
a ogni push su `main` (o a mano da *Actions → Pubblica su GitHub Pages → Run workflow*).
Va attivato una sola volta: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
I percorsi del build sono relativi (`base: './'`), quindi il gioco funziona anche sotto `/bus-simulator/`.

## Dati reali: OpenStreetMap + GTFS Busitalia Veneto

La mappa unisce due fonti aperte:

* **OpenStreetMap** (`data/osm-padova.json`, export Overpass): tutte le strade carrabili con nome, corsie,
  sensi unici, limiti di velocità e ponti; le piante dei ~21.000 edifici del centro; i binari (anche i fasci di
  stazione e lo scalo); fiumi e canali (Brenta, Bacchiglione, Piovego, Tronco Maestro, Scaricatore…).
* **Nodi OpenStreetMap** (`data/osm-padova-nodes.json`, query `scripts/overpass-nodes.ql`): semafori, STOP, dare
  precedenza e attraversamenti pedonali reali.
* **Binari del tram OpenStreetMap** (`data/osm-padova-tram.json`, query `scripts/overpass-tram.ql`): la sede del gioco
  segue i binari veri, uno per verso. Lo shape GTFS corre su uno dei due binari e ha punti radi: viene campionato ogni
  2 m e agganciato al binario OSM vicino e parallelo.
* **GTFS ufficiale di Busitalia Veneto** (feed BusOne, `https://proxy.busone.app/biv/gtfs.zip`): le 22 linee urbane
  con le varianti di percorso, le fermate reali e gli orari delle corse di un mercoledì (feriale) e di una domenica
  (festivo). Partenza e arrivo sono quelli reali; i passaggi intermedi il gioco li ripartisce secondo il tempo di guida
  (limite della via e un tempo fisso per fermata), perché il GTFS segue il traffico vero: sulla 13 chiede 36-46 km/h di
  media in periferia e 10 km/h in centro. Una corsa non dura mai meno del 90% del tempo di guida stimato.

`scripts/build_map.py` aggancia ogni tracciato GTFS alle strade OSM (map matching), così i bus percorrono le vie
vere, e produce `src/data/padova-map.json` per il gioco.

**Pianta delle strade** (`scripts/street_surfaces.py`, con Shapely): carreggiate, marciapiedi e isole sono aree vere,
calcolate una volta sola invece di nastri sovrapposti disegnati dal gioco:

* la carreggiata è l'unione dei tratti allargati alla loro larghezza, con i raccordi agli incroci (7 m sui percorsi
  dei bus, 3,5 altrove);
* le rotatorie quasi circolari diventano corone esatte con l'isola al centro, le altre (anche quelle non segnate come
  rotatoria in OSM, come il Rondò Borgomagno) hanno anello e isola levigati;
* gli spartitraffico chiusi senza edifici diventano isole con gli spigoli arrotondati e la riga tutt'intorno, tranne la
  sede del tram e l'acqua; le isole all'ingresso delle rotatorie (come il triangolo tra i due rami di Via Toti al Rondò
  Borgomagno) restano anche dove i raccordi le avrebbero riempite;
* il marciapiede è una fascia di 3,5 m attorno alla carreggiata (2 m sui ponti);
* gli edifici sono ritagliati fuori da carreggiate, marciapiede minimo (1,5 m sui percorsi dei bus) e sede del tram;
* le rampe scendono solo lungo la prosecuzione del ponte (stessa via, o il ramo più dritto) fino al primo incrocio o
  a 130 m: le strade laterali e le rotatorie ai piedi restano a terra; anche l'asfalto in quota è un'area, con i
  raccordi agli incroci dove la rampa arriva a terra;
* gli impalcati in quota sono un'area sola anche loro: i tratti di strada e di tram da 0,6 m in su, uniti e con la
  fascia tra impalcati vicini riempita (il Cavalcavia Borgomagno è un corpo unico con strada, tram e corsia bus); sotto
  non restano isole né marciapiedi, i parapetti seguono il bordo e si fermano dove cominciano le rampe.

Il gioco disegna le aree a riquadri da 200 m e usa il bordo dell'asfalto per dire se le ruote sono in strada. Le righe
di bordo seguono il bordo dell'asfalto, 0,35 m dentro, sulle strade con segnaletica (anche in quota): dove due rami si
uniscono non si incrociano.

* **Area di gioco: Centro storico e Arcella.** Le linee che escono dall'area sono tagliate al confine
  ("tratto in città").
* **Edifici da Overture Maps** (`data/overture-buildings-padova.parquet`): piante OSM e Microsoft, compresi i
  cortili interni. Altezza: piani da OSM se presenti, altrimenti altezza Microsoft ML (stimata da immagini
  satellitari) convertita in piani con una calibrazione sugli edifici OSM, altrimenti stima per tipologia.
  La geometria è costruita a riquadri da 400 m, prima quelli vicini al bus.
* **Tram SIR1**: la sede tranviaria (corsie rosse e rotaia centrale) viene dal tracciato GTFS. I tram automatici sono
  quelli in servizio a quell'ora secondo l'orario GTFS: nei feriali 12-13 per quasi tutto il giorno, nei festivi 7-12.
  Ognuno segue la sua corsa, regola la velocità sull'orario e al capolinea cambia cabina e prende la corsa successiva.
  Il GTFS pubblica ogni viaggio anche spezzato in tratti (Guizza → Cavalletto, Stazione → Pontevigodarzere…): i tratti
  coperti da una corsa più lunga entro 3 minuti sono lo stesso tram e non si contano.
  Il bus può percorrere la sede del tram senza penalità: nel centro e lungo Corso Vittorio Emanuele spesso è l'unico
  spazio libero.
* Gli edifici del centro hanno la pianta reale, con l'altezza da OSM quando c'è, altrimenti stimata; quelli di pianta
  rettangolare hanno il tetto a padiglione in coppi, le facciate hanno zoccolo, cornicione e persiane e nel centro
  storico molti hanno i portici ad arco al piano terra. Basilica del
  Santo (cupole e campanili), Palazzo della Ragione (tetto a carena) e Duomo sono decorati sulla loro pianta.
  Fuori dall'area degli edifici OSM i palazzi sono generati lungo le strade.
* Prato della Valle (isola Memmia, canale, statue) è modellato a parte e allineato alle strade reali.
* I ponti stradali sopra la ferrovia diventano cavalcavia in quota, con le rampe.
* I limiti di velocità vengono dai tag `maxspeed` di OSM quando presenti (altrimenti 30 in centro, 50 fuori).
* **Semafori, STOP, dare precedenza e strisce pedonali dove sono in OSM.** Ogni nodo OSM viene agganciato al grafo
  lungo la sua strada: il semaforo o il cartello (che in OSM sta sulla linea d'arresto, qualche metro prima
  dell'incrocio) va all'incrocio che precede, rispettando `direction` e `traffic_signals:direction`. I semafori entro
  25 m formano un solo impianto, anche quando l'incrocio occupa più nodi (strade a carreggiate separate). I semafori
  pedonali lontani dagli incroci restano come nodo del grafo. Se la mappa è generata senza i nodi OSM, il gioco torna
  a dedurre semafori e cartelli dal tipo di strada.
* Il **tram SIR1** è guidabile sulla sua linea, da Guizza Capolinea a Pontevigodarzere (vedi sotto).
* **Area di gioco** allargata a sud lungo il tram, fino al capolinea della Guizza.

Per rigenerare i dati:

```bash
# segnaletica reale (nodi OSM); se Overpass risponde 502 (server saturo) riprova dopo qualche decina di secondi
curl -X POST -A "padova-bus-simulator" --data-urlencode data@scripts/overpass-nodes.ql -o /tmp/osm-nodes.json https://overpass-api.de/api/interpreter
python3 scripts/filter_osm_nodes.py /tmp/osm-nodes.json data/osm-padova-nodes.json
# binari e banchine del tram
curl -X POST -A "padova-bus-simulator" --data-urlencode data@scripts/overpass-tram.ql -o /tmp/osm-tram.json https://overpass-api.de/api/interpreter
python3 scripts/filter_osm_tram.py /tmp/osm-tram.json data/osm-padova-tram.json
# orari GTFS e mappa del gioco (servono i pacchetti Python shapely e pyarrow: pip install shapely pyarrow)
curl -L -o /tmp/biv.zip https://proxy.busone.app/biv/gtfs.zip && mkdir -p /tmp/biv && unzip -o /tmp/biv.zip -d /tmp/biv
python3 scripts/build_map.py data/osm-padova.json /tmp/biv src/data/padova-map.json data/overture-buildings-padova.parquet data/osm-padova-nodes.json data/osm-padova-tram.json
```

`build_map.py` stampa quanti semafori, cartelli e attraversamenti ha agganciato, quanti campioni del tram sono finiti
sui binari OSM, quante fermate del tram hanno la banchina centrale e i numeri della pianta delle strade. Gli ultimi tre argomenti sono facoltativi: senza il file dei nodi il
gioco deduce semafori e cartelli dal tipo di strada, senza quello dei binari la sede segue lo shape GTFS.

Dati © OpenStreetMap contributors, licenza ODbL (https://www.openstreetmap.org/copyright).

## Modalità

* **Servizio di linea**: corsa con orario, fermate, passeggeri e punteggio.
* **Giro libero**: niente orari né fermate, giri dove vuoi per tutta la città (valgono comunque semafori, limiti e marciapiedi).
* **Esplorazione**: nessuna regola né punteggio; il bus non ha linea, limiti o semafori da rispettare e il tram non
  deraglia nelle curve prese veloci.

Meteo e ora del giorno si cambiano in ogni momento dal menu di pausa (**P**): l'ora sceglie la luce (alba, mattina,
mezzogiorno, tramonto, sera, notte) oppure segue l'orologio della corsa, senza toccare l'orario.


## Comandi (tastiera)

| Tasto | Azione |
|-------|--------|
| **W / ↑** | acceleratore (progressivo) |
| **S / ↓** | freno (progressivo: tenere premuto per frenare di più) |
| **A D / ← →** | sterzo: i tasti girano il volante (un colpetto corregge, tenendo premuto si gira di più); lasciato, torna al centro da solo, più in fretta in velocità |
| **Shift** + W/S | gas a fondo / frenata forte (senza Shift i pedali sono dosati) |
| **F** | apri / chiudi porte (con porte aperte è attivo il freno di fermata) |
| **Q / E** | freccia sinistra / destra · **G** quattro frecce |
| **Spazio** | freno di stazionamento |
| **S** di nuovo, da fermo | retromarcia: poi **S** arretra e **W** frena; fermandosi con **W** si torna in marcia avanti |
| **R** | marcia avanti / retromarcia (da fermo) |
| **L** | fari · **H** clacson · **K** inginocchiamento |
| **C** | cambia visuale (cabina, esterna, passeggeri, dall'alto) |
| **Z / X** | guarda a sinistra / destra (tenendo premuto) |
| **Mouse** | trascina per guardarti intorno (nella visuale esterna ruota attorno al bus) · **V** o doppio clic: sguardo avanti |
| **T** | salta l'attesa in fermata (in anticipo l'attesa scorre comunque ×12) |
| **J** | teletrasporto: prossima fermata, fermata successiva o luoghi principali (tasti 1–9) |
| **M** | mappa grande (clic su una strada per teletrasportarti) · **I** aiuto · **U** audio on/off · **P / Esc** pausa |

## Tram SIR1

Nel menu c'è la linea **🚋 SIR1**: un Translohr da 3 moduli (~25 m) che corre sulla sua rotaia, con corse e fermate
reali del GTFS (anche le corse limitate a Cavalletto e al Santo). Il numero di moduli è un dato della linea: le linee
future potranno averne 4.

| Tasto | Azione |
|-------|--------|
| **W / S** | manipolatore: trazione / frenatura (Shift per la tacca piena) |
| **F** | porte (da fermo; si sale e si scende da tutte le porte) |
| **H** | campanello |
| **O** | abbassa / alza il pantografo |
| **B** | cambio cabina al capolinea |
| **Spazio** | freno di stazionamento |

* Ci si ferma con il muso a fine banchina; nelle curve strette il limite scende (fino a 15 km/h).
* A **Prato della Valle** non c'è la linea aerea: il pantografo va abbassato prima, in entrambi i sensi, e rialzato
  subito dopo. Nel tratto il tram va a batteria. Pantografo alzato senza filo: −150 punti.
* **Precedenza al tram**: quando un tram si avvicina a un incrocio con la sede, le auto si fermano prima della linea.
* **Semafori del tram**: lanterna a tre luci in colonna, una sola accesa (le altre si vedono spente):
  * in alto la **barra orizzontale** bianca: via impedita;
  * al centro il **triangolo** arancione: attenzione;
  * in basso la **barra verticale** bianca: via libera, a incrocio sgombro dopo la chiamata.
  * Passare con la barra orizzontale costa punti.
* **Curve troppo veloci fanno deragliare il tram**: arrivano i soccorsi (−300 punti) e dopo qualche secondo si riparte.
* Il tram non ha la retromarcia; un'auto che taglia la sede di traverso fa frenare il tram senza colpa.

## Come si gioca

1. Al capolinea apri le porte (**F**) e lascia salire i passeggeri. Aspetta l'orario di partenza.
2. Chiudi le porte, metti la **freccia a sinistra (Q)** e parti.
3. Segui la **navigazione** in alto e la minimappa. Il bus è lungo 12 m: allarga le curve e attento alla coda che sporge!
4. Quando un passeggero prenota la fermata suona il campanello. Accosta (**freccia a destra E**) e fermati con il muso
   sulla **palina gialla**, dentro il riquadro giallo *BUS*, vicino al marciapiede.
   Le fermate sono a richiesta, anche col tram: ci si ferma se qualcuno ha prenotato o aspetta a terra, altrimenti si
   passa dritti. Il riquadro della prossima fermata dice quale dei tre casi vale.
5. Arrivato al capolinea finale fai scendere tutti: ricevi il resoconto con stelle e punteggio.

### Punteggio

* ✅ puntualità alla fermata, accostamento preciso, uso corretto delle frecce, comfort dei passeggeri
* ❌ semaforo rosso, STOP non rispettato, autovelox (30 km/h in centro, 50 fuori), incidenti, ruote sul marciapiede (la carrozzeria che sporge
  in curva non conta, e a incroci e rotonde la ruota posteriore può tagliare la curva), fermate saltate,
  partenze anticipate, porte aperte fuori fermata, passeggeri lasciati a terra, frenate e curve brusche

## Cosa c'è dentro

* **Città procedurale** costruita sulla rete stradale: palazzi con finestre (illuminate di notte), tetti in coppi in centro,
  alberi, lampioni, marciapiedi, strisce pedonali, fiumi (Brenta, Bacchiglione, Piovego, Tronco Maestro) con ponti, ferrovia.
* **Monumenti**: Prato della Valle con l'Isola Memmia, il canale e le statue, Basilica del Santo, Palazzo della Ragione,
  Torre dell'Orologio, Duomo, Specola, Cappella degli Scrovegni, Stazione FS, Ospedale, Fiera.
* **Due livree**: il bus moderno **elettrico** (argento con tetto blu e verde lime, motore a coppia piena da fermo,
  recupero di energia in frenata, fischio dell'inverter) e lo **storico arancione e bianco** con il diesel.
* **Bus** da 12 m con fisica a bicicletta sull'asse posteriore, cambio automatico a 6 marce con convertitore di coppia,
  retarder, freno di fermata, sospensioni (beccheggio/rollio), porte animate, display LED, specchietti retrovisori reali.
* **Traffico** con modello IDM, semafori sincronizzati, auto che suonano il clacson e sorpassano il bus fermo, pedoni.
* **Segnaletica verticale** agli incroci senza semaforo: STOP e dare precedenza reali da OSM (con linea di arresto o
  tratteggio, dietro le strisce pedonali), diritto di precedenza sulla strada principale degli incroci dove le
  laterali hanno un cartello, dare precedenza con il cartello di rotatoria agli ingressi delle rotonde. Allo STOP
  bisogna fermarsi prima della linea, altrimenti si perdono punti.
* **Semafori reali** agli incroci e agli attraversamenti pedonali (questi con un verde lungo per i veicoli).
* **Passeggeri** che aspettano, salgono, prenotano la fermata e scendono, con annunci vocali in italiano.
* **Audio sintetizzato**: motore diesel, turbo, porte pneumatiche con cicalino, freni ad aria, campanello, frecce, pioggia.
* **Meteo** (predefinito: variabile): sereno, pioggia (asfalto bagnato, frenata più lunga, gocce sul parabrezza di bus e tram che i tergicristalli tolgono), la classica **nebbia padana** oppure
  **variabile**: si parte col sereno, il cielo si copre e arriva la pioggia o la nebbia, con transizioni graduali; dopo la
  pioggia le strade restano bagnate per un po'.

## Sviluppo

* Si lavora su `main` con push continuo: ogni push pubblica su GitHub Pages. Le regole di progetto sono in `CLAUDE.md`.
* Idee e prossimi passi: [`IDEE.md`](IDEE.md). Specifica del tram guidabile: [`docs/prompt-tram.md`](docs/prompt-tram.md).
  Export della segnaletica reale: [`docs/overpass-segnaletica.md`](docs/overpass-segnaletica.md).

## Struttura

```
src/
  data/padova.js     carica la mappa: strade, edifici, ferrovia, acque, linee
  data/padova-map.json  dati generati da scripts/build_map.py (OSM + GTFS)
  world/city.js      generazione della città
  world/traffic.js   semafori, auto, pedoni
  bus/bus.js         modello 3D e fisica del bus
  game/routes.js     percorsi e fermate
  game/mission.js    servizio, passeggeri, orari, punteggio
  game/hud.js        interfaccia, cruscotto, minimappa
  game/audio.js      audio WebAudio + sintesi vocale
  main.js            rendering, telecamere, meteo, ciclo di gioco
```
