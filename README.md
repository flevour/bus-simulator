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
npm test           # prove nel browser headless (Playwright); la prima volta: npx playwright install --only-shell chromium
```

### Verifiche

`npm test` compila il gioco senza PostHog in una cartella temporanea, lo serve su una porta libera e lancia le prove
di `tests/` in Chromium headless (WebGL in software):

* `avvio.spec.js`: il gioco si carica, una corsa del bus e una del tram partono e avanzano senza errori;
* `giro.spec.js`: giro guidato su linee campione, bus e tram, fino alle fermate successive. Il pilota automatico sta
  nella prova (`tests/guida.js`), si guida senza traffico; la prova fallisce se una fermata non si raggiunge o il
  mezzo urta un ostacolo fisso;
* `mappa.spec.js`: rapporto di verifica sulla mappa nel gioco: pali dei semafori, paline, lampioni, alberi e
  pensiline rispetto al bordo dell'asfalto, e il bus fermo in ogni fermata di tutte le varianti (ostacoli, ruote
  oltre il cordolo, fermate agganciate lontano dalla fermata vera);
* `binari-tram.spec.js`: i binari del tram come li disegna il gioco, misurati con la regola di
  [`docs/binari-tram.md`](docs/binari-tram.md) (spigoli, raggi sotto il minimo, interassi, scarti da OSM, pendenze)
  da `scripts/binari_tram.py`, che la prova chiama con Python;
* `cavalcavia.spec.js`: il profilo dei cavalcavia con il terreno e le quote dei binari del gioco, misurato con la
  regola di [`docs/cavalcavia.md`](docs/cavalcavia.md) (onde, pendenze, raccordi verticali, binari fuori quota,
  scarti dal DTM) da `scripts/cavalcavia.py`.

`python3 scripts/verifica_mappa.py` (serve `shapely`) controlla il JSON della mappa: edifici in carreggiata e nella
corsia dei bus, fermate lontane dal percorso o agganciate nel punto sbagliato, marciapiedi più stretti di 1,5 m, i
binari del tram scritti dagli script secondo la stessa regola e il profilo dei cavalcavia nei dati.
Script e rapporto nel gioco escono con errore quando un numero supera la sua soglia, fissata sui valori del 9
novembre 2026 (in testa ai due file). Il workflow `.github/workflows/verifiche.yml` lancia build, `npm test` e lo
script a ogni push su `main`.

### Pubblicazione su GitHub Pages

Il workflow `.github/workflows/pages.yml` compila il gioco (`npm run build`) e pubblica `dist/` su GitHub Pages
a ogni push su `main` (o a mano da *Actions → Pubblica su GitHub Pages → Run workflow*).
Va attivato una sola volta: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
I percorsi del build sono relativi (`base: './'`), quindi il gioco funziona anche sotto `/bus-simulator/`.

## Smartphone e tablet

Per ora **non sono supportati**: su telefoni e tablet (solo touch, o schermo più piccolo di 560 px) il gioco mostra
l'invito ad aprirlo da un computer e non costruisce la città; su un computer con la finestra più piccola di 900 × 560
chiede di allargarla. I comandi touch sono ancora nel codice, spenti da `MOBILE_SUPPORTED` in `src/game/touch.js`:
con `true` tornano come descritto qui sotto.

Su schermo touch compaiono i comandi a video (meglio con il telefono in orizzontale; all'avvio il gioco passa a
schermo intero dove il browser lo consente):

* **volante** in basso a sinistra: trascina il dito a sinistra o a destra (sterzo progressivo);
* **pedali** in basso a destra: più in alto tocchi il pedale, più forza (gas e freno analogici);
* pulsanti per frecce, emergenza, clacson, freno a mano, marcia avanti/indietro e porte; il tasto **⋯** apre
  visuale, mappa, teletrasporto, salta l'attesa, fari, inginocchiamento, audio, aiuto e schermo intero;
* trascina sulla scena per guardarti intorno, doppio tocco per tornare a guardare avanti.

L'HUD si compatta sugli schermi piccoli e la risoluzione di rendering è ridotta per risparmiare batteria.

## Dati reali: OpenStreetMap + GTFS Busitalia Veneto

La mappa unisce due fonti aperte:

* **OpenStreetMap** (`data/osm-padova.json`, export Overpass): tutte le strade carrabili con nome, corsie,
  sensi unici, limiti di velocità e ponti; le piante dei ~21.000 edifici del centro; i binari (anche i fasci di
  stazione e lo scalo); fiumi e canali (Brenta, Bacchiglione, Piovego, Tronco Maestro, Scaricatore…).
* **Nodi OpenStreetMap** (`data/osm-padova-nodes.json`, query `scripts/overpass-nodes.ql`): semafori, STOP, dare
  precedenza, attraversamenti pedonali e dossi reali.
* **Binari del tram OpenStreetMap** (`data/osm-padova-tram.json`, query `scripts/overpass-tram.ql`): la sede del gioco
  segue i binari veri, uno per verso. Lo shape GTFS corre su uno dei due binari e ha punti radi: viene campionato ogni
  2 m e agganciato al binario OSM vicino e parallelo. Le fermate vanno sul nodo OSM dove si ferma il tram
  (`railway=tram_stop`, `stop_position`), a metà della banchina vera, oppure al centro della banchina OSM: le fermate GTFS
  stanno in fondo alla banchina, circa 10 m più avanti. I binari delle linee nuove (SIR2, SIR3) li legge da
  `data/tram-linee-nuove.json`, accanto all'export dei binari: la loro sede entra nella pianta delle strade come quella
  del SIR1 (asfalto, fuori da isole e marciapiedi).
* **GTFS ufficiale di Busitalia Veneto** (feed BusOne, `https://proxy.busone.app/biv/gtfs.zip`): le 22 linee urbane
  con le varianti di percorso, le fermate reali e gli orari delle corse di un mercoledì (feriale) e di una domenica
  (festivo). Partenza e arrivo sono quelli reali; i passaggi intermedi il gioco li ripartisce secondo il tempo di guida
  (limite della via e un tempo fisso per fermata), perché il GTFS segue il traffico vero: sulla 13 chiede 36-46 km/h di
  media in periferia e 10 km/h in centro. Una corsa non dura mai meno del 90% del tempo di guida stimato.

`scripts/build_map.py` aggancia ogni tracciato GTFS alle strade OSM (map matching), così i bus percorrono le vie
vere, e produce la mappa del gioco in due parti (`scripts/aree_mappa.py`): la rete (nodi, archi, linee, fermate,
segnaletica, terreno, carreggiate e isole) in `src/data/padova-map.json`, dentro il bundle, ed edifici, marciapiedi,
verde e alberi in un file per riquadro da 800 m in `public/mappa/aree/`, che il gioco scarica all'avvio
(`src/data/aree.js`; nella pagina autosufficiente di `npm run build:single` sono dentro la pagina).

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
  cortili interni. Altezza: quella misurata dalla Regione del Veneto (DBGT del Comune di Padova, volo 2007: media dei
  volumi `UN_VOL` dentro la pianta, pesata sull'area, se coprono almeno il 40%; `data/dbgt-volumi.json`), altrimenti
  piani da OSM se presenti, altrimenti altezza Microsoft ML (stimata da immagini satellitari) convertita in piani con
  una calibrazione sugli edifici OSM, altrimenti stima per tipologia. I portici sono quelli del DBGT (volumi
  `UN_VOL_POR` = 3, con l'altezza libera `UN_VOL_INH`); a caso nel centro solo dove il DBGT non arriva.
* **Carreggiate e marciapiedi misurati** (`data/misure-strade.json`, da `scripts/measure_streets.py`): dai poligoni
  del DBGT (carreggiate `AC_VEI`, marciapiedi `AR_MARC`, edifici `EDIFC`), spostati di 2,4 m sugli edifici OSM. Lungo
  ogni via OSM si tirano raggi perpendicolari ogni 4 m (non a meno di 12 m dagli incroci, e solo dove l'asse OSM cade
  dentro la carreggiata misurata): il primo bordo dà la carreggiata, il bordo successivo il marciapiede; due vie
  affiancate sulla stessa lastra d'asfalto si dividono la larghezza. Per ogni tratto di 40 m si tiene la mediana, se i
  campioni sono abbastanza e concordi. Dove manca la misura valgono le regole di prima (corsie OSM, tipo di strada).
  Le paline stanno 0,7 m oltre il bordo vero dell'asfalto.
* **Forma vera di carreggiate e marciapiedi** (`data/dbgt-strade.json`, da `scripts/dbgt_streets.py`): all'asfalto
  ricavato dalle vie OSM si uniscono i poligoni di carreggiata del DBGT (`AC_VEI`) che toccano una via di oggi (piazze,
  golfi di fermata, corsie di sosta, anelli dei capolinea, angoli veri degli incroci; un poligono grande solo se per
  almeno il 30% sta già sulle strade di oggi), mai dentro gli edifici o sotto le rampe; ai marciapiedi quelli di
  `AR_MARC` accanto, e le aree pedonali e le piazze (`A_PED`, `AC_PED`) lastricate. I passi carrai con il nome di
  una via restano nel grafo (Largo Claude Debussy). Parcheggi e distributori (`SV_STR`) che toccano la carreggiata sono
  asfalto anche loro.
* **Capolinea e fermate**: dove l'aggancio del tracciato GTFS comincia (o finisce) all'incrocio dopo la fermata, si
  riattacca il tratto fino al nodo vicino alla prima (o ultima) fermata (al massimo 80 m). Le fermate del percorso
  conoscono il cordolo vero (dalla palina piazzata 0,7 m oltre l'asfalto): il bus parte accostato lì, l'accostamento
  e i passeggeri in attesa si misurano da lì. Se la fermata del capolinea sta lungo l'arco che entra nel primo nodo
  (o esce dall'ultimo), quell'arco si aggiunge al percorso: a Largo Debussy e alla stazione la corsa parte dal punto
  in cui il bus sta fermo, nel verso del tracciato, e arrivo e partenza hanno la stessa palina. Se invece la fermata
  del capolinea non sta lungo il percorso ma accanto a un arco percorso nel suo verso, con la fermata a destra (le
  corsie della stazione, a senso unico una accanto all'altra), si arriva o si parte da lì con il percorso legale più
  corto (al massimo 600 m). Lo stesso per le fermate in mezzo al percorso, se la corsia giusta costa al massimo 120 m
  in più (le linee che passano dalla stazione fermano alla Corsia 3 dalla corsia sud). Le andate e ritorno in una via
  laterale (A-B-A, errori di aggancio) si tolgono se lì non c'è una fermata.
* **Sensi unici**: nell'aggancio dei tracciati il contromano costa 6 volte la strada (era 1,6: i percorsi tagliavano
  piazzali e sensi unici), tranne sulle corsie bus in controsenso (`oneway:bus=no`, `oneway:psv=no`,
  `busway=opposite_lane`, `lanes:bus:backward`), che il gioco conosce (flag 256) anche per le corse fuori servizio.
* **Paline OSM** (`data/osm-fermate.json`, da `scripts/osm_stops.py`): le fermate `highway=bus_stop` di OSM, dallo
  strato Overture `base/infrastructure` che riporta i tag originali. Ogni fermata GTFS va sulla palina con lo stesso
  nome (somiglianza pesata sulle parole: "Giotto", comune a tutta la via, conta poco; "Contarine" molto) entro 50 m,
  poi le altre sulla palina più vicina entro 25 m (15 m se i nomi non hanno parole in comune); una palina per
  fermata. La pensilina e la panchina ci sono dove OSM le segna o non dice niente. Le banchine dei bus
  (`highway=platform`, le corsie della stazione) sono aree lastricate e rialzate al posto delle isole del DBGT.
* **Isole, verde e alberi del DBGT** (`data/dbgt-verde.json`, da `scripts/dbgt_green.py`): gli spartitraffico
  (`SPART`) diventano isole dove stanno dentro l'asfalto di oggi o tra due carreggiate, mai sulle corsie delle auto,
  sulle carreggiate e agli incroci dei bus o sulla sede del tram; prati, aree alberate e aiuole (`AR_VRD`) sono uno
  strato verde sopra il prato generico; gli alberi sono quelli dei filari (`FIL_AL`, uno ogni 12 m), delle aree
  alberate (maglia di 24 m) e dei boschi (14 m), al posto di quelli generati dentro il comune.
* **Terreno** (`data/dtm-padova.json`, da `scripts/dtm_grid.py`): le quote del DTM a 5 m della Regione del Veneto in
  una griglia a 10 m. Il gioco resta piano e alza ogni vertice della quota del suo punto (vertex shader,
  `src/world/terrain.js`), con la telecamera e i fari: si vedono il centro storico più alto di 4 m, gli alvei dei
  fiumi e gli argini. Sotto i cavalcavia (che il gioco alza da sé) il terreno è spianato. Per strade, edifici e prato
  gli avvallamenti stretti (alvei e fossi fino a circa 80 m) sono riempiti alla quota delle sponde con una chiusura
  morfologica, e i ponti lunghi sono raccordati tra le sponde: nessuna strada scende in un fiume, anche dove OSM non
  segna il ponte. Solo l'acqua e le sponde (due fasce per lato) seguono l'alveo. Il prato è una
  griglia che segue la telecamera; carreggiate e marciapiedi sono infittiti dove il terreno non è piano. Salite e
  discese pesano sulla guida del bus.
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
* **Corsie e segnaletica orizzontale dai tag OSM** (`lanes`, `lanes:forward/backward`, corsie dei bus da `busway`,
  `lanes:psv`, `psv:lanes`, `bus:lanes`, `overtaking`, `lane_markings`, `turn:lanes`): la carreggiata misurata si
  divide in corsie (al più 3,75 m, almeno 2,6, quelle dei bus contro il cordolo), con il tratteggio 3 + 3 m tra le
  corsie dello stesso verso, la mezzeria continua dove il sorpasso è vietato, la riga gialla e la scritta BUS sulle
  corsie riservate (anche in controsenso) e le frecce a terra prima degli incroci. Sulle strade strette niente mezzeria.
* **Dossi e attraversamenti rialzati** (`traffic_calming` dei nodi OSM e delle vie rialzate): dossi a strisce gialle e
  nere, denti bianchi sulle rampe. Presi troppo forte (oltre 25-40 km/h secondo il tipo) scuotono il bus e i
  passeggeri.
* Il **tram SIR1** è guidabile sulla sua linea, da Guizza Capolinea a Pontevigodarzere (vedi sotto).
* **Area di gioco** allargata a sud lungo il tram, fino al capolinea della Guizza, e con sei piccoli riquadri ai bordi
  dove i percorsi escono e rientrano (Via Madonna della Salute per la 22, verso l'Ippodromo per la 9 e la 42, a nord per
  la 4, la 13 e la 17, a ovest per la 21, a sud per la 11). Le linee che escono dalla mappa tengono il tratto più lungo
  di fermate consecutive, la prima e l'ultima a meno di 40 m dal percorso, e il percorso comincia e finisce attorno a
  quelle.
* **Corridoi fino ai capolinea** (`CORRIDOI_TRAM` e `CORRIDOI_BUS` in `scripts/build_map.py`): celle da 250 m attorno
  ai binari completi delle linee del tram nuove, più una di margine, e le celle toccate dai tracciati GTFS di tutte le
  varianti delle linee del bus scelte, con strade ed edifici. Oggi il SIR3 fino a Voltabarozzo e al deposito, il SIR2 da
  Rubano (via Pria Fosca) al capolinea di Vigonza prima della rotonda della SR11, le linee 3, 10, 11, 22, 24, 25 e 88 con
  tutte le varianti fino ai capolinea. Strade e segnaletica OSM che mancano agli export di oggi in
  `data/osm-corridoio.json` (`scripts/filter_osm_corridoio.py`, che scrive anche le query Overpass, una per riquadro);
  edifici e paline da Overture, terreno dal DTM regionale (`dtm_grid.py --riquadro --come`). Una linea
  che esce dall'area e ci rientra si aggancia per pezzi. Le vie fuori dall'area che collegano due vie dell'area dove
  passa un bus entrano anche loro (`gtfs_links`). Capolinea
  e fermate ancora fuori dalla mappa: `python3 scripts/inventario_capolinea.py <cartella_gtfs>` (tabelle in
  `docs/ESTENSIONE_LINEE.md`, sezione 6).

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
python3 scripts/build_map.py data/osm-padova.json /tmp/biv src/data/padova-map.json data/overture-buildings-padova.parquet data/osm-padova-nodes.json data/osm-padova-tram.json data/misure-strade.json data/dbgt-volumi.json data/dtm-padova.json data/dbgt-verde.json data/dbgt-strade.json data/osm-fermate.json data/osm-corridoio.json
# paline OSM (strato Overture base/infrastructure, scaricato con scripts/overture_layers.py)
python3 scripts/osm_stops.py <base-infrastructure.parquet> data/osm-fermate.json
# terreno: DTM LiDAR a 5 m della Regione (tessere in data/lidar5, scaricate con
# https://idt2.regione.veneto.it/idt/download/layerDownload/downloadDtmLidar5?dataDtmLidarId=<idPol>, elenco in
# data/lidar5/tessere.txt) e, fuori dal Comune, il DTM a 5 m (GeoServer IDT2, WPS ras:CropCoverage su
# rv:DTM_RV_5m_3003); servono rasterio e pyproj
python3 scripts/dtm_grid.py dtm_rv_5m_3003_padova.tif data/dtm-padova.json 10 data/lidar5
# misure dal DBGT della Regione (lotto Comune di Padova, shapefile ETRF2000 dal downloader IDT2; servono pyogrio e pyproj)
curl -o aree.zip 'https://idt2.regione.veneto.it/idt/download/layerDownload/downloadGeoDBT?lotto=LOTTO%20COMUNE%20DI%20PADOVA&rif=ETRF2000&type=aree'
python3 scripts/measure_streets.py dbgt <cartella aree> data/osm-padova.json data/misure-strade.json
python3 scripts/dbgt_volumes.py <cartella aree> data/dbgt-volumi.json
python3 scripts/dbgt_green.py <cartella aree> <cartella linee> src/data/padova-map.json data/dbgt-verde.json
python3 scripts/dbgt_streets.py <cartella aree> src/data/padova-map.json data/dbgt-strade.json
```

`build_map.py` stampa quanti semafori, cartelli e attraversamenti ha agganciato, quanti campioni del tram sono finiti
sui binari OSM, quante fermate del tram hanno la banchina centrale e i numeri della pianta delle strade. Gli ultimi tre argomenti sono facoltativi: senza il file dei nodi il
gioco deduce semafori e cartelli dal tipo di strada, senza quello dei binari la sede segue lo shape GTFS.

Dati © OpenStreetMap contributors, licenza ODbL (https://www.openstreetmap.org/copyright). Contiene dati della
Regione del Veneto (DBGT del Comune di Padova, DTM a 5 m), licenza IODL 2.0.

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
| **Y** | saluta il collega che incroci (bus o tram che viene incontro, entro ~45 m): +10 punti, +15 se è della tua linea; se saluta lui per primo, ricambia entro qualche secondo |
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
| **H** | gong (campanello), a rintocchi finché è premuto |
| **Shift+H** | clacson del tram (Shift premuto prima di H) |
| **O** | abbassa / alza il pantografo |
| **B** | cambio cabina: al capolinea, in fondo al binario dopo la discesa, il tram resta dov'è e riparte con la corsa successiva del turno passando dallo scambio |
| **N** | gira lo scambio del capolinea (Esplorazione e Giro libero) |
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
  partenze anticipate, porte aperte fuori fermata, passeggeri lasciati a terra, frenate e curve brusche, dossi presi
  troppo forte

## Cosa c'è dentro

* **Città procedurale** costruita sulla rete stradale: palazzi con finestre (illuminate di notte), tetti in coppi in centro,
  alberi, lampioni, marciapiedi, strisce pedonali, fiumi (Brenta, Bacchiglione, Piovego, Tronco Maestro) con ponti, ferrovia.
* **Monumenti**: Prato della Valle con l'Isola Memmia, il canale e le statue, Basilica del Santo, Palazzo della Ragione,
  Torre dell'Orologio, Duomo, Specola, Cappella degli Scrovegni, Stazione FS, Ospedale, Fiera.
* **Sei livree**: il bus moderno **elettrico** (argento con tetto blu e verde lime, motore a coppia piena da fermo,
  recupero di energia in frenata, fischio dell'inverter), lo **storico arancione e bianco** con il diesel, il diesel
  **rosso e bianco** (bianco con fascia finestre e porte nere, tetto e fascia alta rossi, climatizzatore bianco sul tetto)
  e tre elettrici: il **blu** (bianco argento con tetto e fascia alta blu, filetti blu e giallo, solo due porte:
  anteriore verde per la salita e centrale rossa per la discesa), il **verde lime** (bianco con fascia alta verde lime
  "100% Elettrico | Zero Emissioni" e onda verde) e il **blu e argento** (argento con fascia alta e tetto blu, filetti
  blu e giallo). Sono ispirate ai mezzi visti a Padova e dintorni: se ne riprendono colori e stile, non loghi o marchi.
* **Snodato da 18 m sulla linea 10**: motrice e rimorchio uniti da ralla e soffietto, quattro porte. Il rimorchio segue la
  ralla e in curva taglia più della motrice (attenzione ai cordoli con l'asse posteriore); in retromarcia lo smorzatore
  anti-sbandamento rallenta la chiusura dello snodo, ma conviene comunque procedere diritti.
* **Bus** da 12 m con fisica a bicicletta sull'asse posteriore, cambio automatico a 6 marce con convertitore di coppia,
  retarder, freno di fermata, sospensioni (beccheggio/rollio), porte animate, display LED, specchietti retrovisori reali.
* **Traffico** con modello IDM, semafori sincronizzati, auto che suonano il clacson e sorpassano il bus fermo, pedoni.
* **Bus automatici** di tutte le linee urbane, dall'orario GTFS: per strada ci sono le corse in servizio a quell'ora
  (nei feriali una settantina al mattino, pochi la sera e nei festivi), con la livrea scelta per il proprio bus. Arrivano
  al capolinea qualche minuto prima della partenza e aspettano a porte aperte, fermano alle fermate (non sempre a quelle
  secondarie), regolano la velocità sull'orario, rispettano semafori e incroci col tram, si mettono in coda e accostano
  al marciapiede; dopo l'ultima fermata escono "fuori servizio". Le auto li seguono e li sorpassano in fermata. Si
  vedono sulla minimappa e, tutti, sulla mappa grande col colore della linea. La corsa guidata dal giocatore non ha un
  gemello automatico.
* **Saluto tra autisti**: alla guida del bus o del tram si saluta con **Y** chi viene incontro; l'autista dell'altro
  mezzo alza la mano (a volte saluta lui per primo).
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

## Novità e richieste

* **Novità**: il pulsante nel menu mostra le modifiche, con il numero di quelle non ancora lette; chi torna dopo un
  aggiornamento le vede aperte all'avvio. L'ultima letta è ricordata nel browser (`localStorage`). Le righe stanno in
  [`src/data/novita.js`](src/data/novita.js): una per ogni modifica visibile, con `n` crescente.
* **Richieste e segnalazioni** (dal menu e dalla pausa): idea, problema o altro, più un testo libero, inviati a PostHog
  insieme a mezzo, linea, modalità, ora di gioco e punto della mappa se si è in corsa. Le risposte finiscono nel
  sondaggio PostHog di tipo *API* **Richieste dal gioco** (Surveys → Richieste dal gioco → Results; il gioco lo cerca
  per id, `SURVEY_ID` in `src/game/news.js`), con una domanda a scelta singola *Idea* / *Problema* / *Altro* e una a
  testo libero. Se il sondaggio non è attivo o non si carica, arrivano come evento `player_request_submitted` con il
  testo.

## Sviluppo

* Si lavora su `main` con push continuo: ogni push pubblica su GitHub Pages. Le regole di progetto sono in `CLAUDE.md`.
* Idee e prossimi passi: [`IDEE.md`](IDEE.md). Specifica del tram guidabile: [`docs/prompt-tram.md`](docs/prompt-tram.md).
  Export della segnaletica reale: [`docs/overpass-segnaletica.md`](docs/overpass-segnaletica.md).

## Struttura

```
src/
  data/padova.js     carica la mappa: strade, edifici, ferrovia, acque, linee
  data/padova-map.json  rete della mappa generata da scripts/build_map.py (OSM + GTFS)
  data/aree.js       scarica le aree della mappa (public/mappa/aree: edifici, marciapiedi, verde, alberi)
  world/city.js      generazione della città
  world/traffic.js   semafori, auto, pedoni
  bus/bus.js         modello 3D e fisica del bus
  game/routes.js     percorsi e fermate
  game/mission.js    servizio, passeggeri, orari, punteggio
  game/hud.js        interfaccia, cruscotto, minimappa
  game/news.js       novità dall'ultima visita e modulo per le richieste (PostHog)
  game/greetings.js  saluto tra autisti
  world/buses.js     bus automatici dall'orario GTFS
  world/driver.js    autista dei mezzi automatici (con il braccio che saluta)
  bus/rainglass.js   gocce di pioggia sul parabrezza
  data/novita.js     righe delle novità per chi gioca
  game/audio.js      audio WebAudio + sintesi vocale
  main.js            rendering, telecamere, meteo, ciclo di gioco
```
