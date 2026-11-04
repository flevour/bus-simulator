# 🚌 Padova Bus Simulator

Simulatore di autobus urbano **in prima persona** ambientato a **Padova**, realizzato con [Three.js](https://threejs.org/).
Scegli una linea, il servizio **feriale** o **festivo**, la direzione e la corsa dell'orario, poi porta i passeggeri a destinazione rispettando fermate, semafori, limiti di velocità e tabella di marcia.

## Avvio

```bash
npm install
npm run dev        # server di sviluppo su http://localhost:5173
npm run build      # build di produzione in dist/
npm run build:single  # un unico file HTML autosufficiente in dist-single/index.html
```

## Dati reali: OpenStreetMap + GTFS Busitalia Veneto

La mappa unisce due fonti aperte:

* **OpenStreetMap** (`data/osm-padova.json`, export Overpass): tutte le strade carrabili con nome, corsie,
  sensi unici, limiti di velocità e ponti; le piante dei ~21.000 edifici del centro; i binari (anche i fasci di
  stazione e lo scalo); fiumi e canali (Brenta, Bacchiglione, Piovego, Tronco Maestro, Scaricatore…).
* **GTFS ufficiale di Busitalia Veneto** (feed BusOne, `https://proxy.busone.app/biv/gtfs.zip`): le 22 linee urbane
  con le varianti di percorso, le fermate reali e gli orari delle corse di un mercoledì (feriale) e di una domenica
  (festivo).

`scripts/build_map.py` aggancia ogni tracciato GTFS alle strade OSM (map matching), così i bus percorrono le vie
vere, e produce `src/data/padova-map.json` per il gioco.

* Gli edifici del centro hanno la pianta reale, con l'altezza da OSM quando c'è, altrimenti stimata; quelli di pianta
  rettangolare hanno il tetto a padiglione in coppi, le facciate hanno zoccolo, cornicione e persiane e nel centro
  storico molti hanno i portici ad arco al piano terra. Basilica del
  Santo (cupole e campanili), Palazzo della Ragione (tetto a carena) e Duomo sono decorati sulla loro pianta.
  Fuori dall'area degli edifici OSM i palazzi sono generati lungo le strade.
* Prato della Valle (isola Memmia, canale, statue) è modellato a parte e allineato alle strade reali.
* I ponti stradali sopra la ferrovia diventano cavalcavia in quota, con le rampe.
* I limiti di velocità vengono dai tag `maxspeed` di OSM quando presenti (altrimenti 30 in centro, 50 fuori).
* Il **tram SIR1** non è tra le linee guidabili.

Per rigenerare i dati:

```bash
curl -L -o /tmp/biv.zip https://proxy.busone.app/biv/gtfs.zip && mkdir -p /tmp/biv && unzip -o /tmp/biv.zip -d /tmp/biv
python3 scripts/build_map.py data/osm-padova.json /tmp/biv src/data/padova-map.json
```

Dati © OpenStreetMap contributors, licenza ODbL (https://www.openstreetmap.org/copyright).

## Modalità

* **Servizio di linea**: corsa con orario, fermate, passeggeri e punteggio.
* **Giro libero**: niente orari né fermate, giri dove vuoi per tutta la città (valgono comunque semafori, limiti e marciapiedi).


## Comandi (tastiera)

| Tasto | Azione |
|-------|--------|
| **W / ↑** | acceleratore (progressivo) |
| **S / ↓** | freno (progressivo: tenere premuto per frenare di più) |
| **A D / ← →** | sterzo |
| **Shift** + W/S | gas a fondo / frenata forte (senza Shift i pedali sono dosati) |
| **F** | apri / chiudi porte (con porte aperte è attivo il freno di fermata) |
| **Q / E** | freccia sinistra / destra · **G** quattro frecce |
| **Spazio** | freno di stazionamento |
| **R** | marcia avanti / retromarcia (da fermo) |
| **L** | fari · **H** clacson · **K** inginocchiamento |
| **C** | cambia visuale (cabina, esterna, passeggeri, dall'alto) |
| **Z / X** | guarda a sinistra / destra |
| **T** | salta l'attesa in fermata (in anticipo l'attesa scorre comunque ×12) |
| **M** | mappa grande · **I** aiuto · **U** audio on/off · **P / Esc** pausa |

## Come si gioca

1. Al capolinea apri le porte (**F**) e lascia salire i passeggeri. Aspetta l'orario di partenza.
2. Chiudi le porte, metti la **freccia a sinistra (Q)** e parti.
3. Segui la **navigazione** in alto e la minimappa. Il bus è lungo 12 m: allarga le curve e attento alla coda che sporge!
4. Quando un passeggero prenota la fermata suona il campanello. Accosta (**freccia a destra E**) e fermati con il muso
   sulla **palina gialla**, dentro il riquadro giallo *BUS*, vicino al marciapiede.
5. Arrivato al capolinea finale fai scendere tutti: ricevi il resoconto con stelle e punteggio.

### Punteggio

* ✅ puntualità alla fermata, accostamento preciso, uso corretto delle frecce, comfort dei passeggeri
* ❌ semaforo rosso, autovelox (30 km/h in centro, 50 fuori), incidenti, marciapiede, fermate saltate,
  partenze anticipate, porte aperte fuori fermata, passeggeri lasciati a terra, frenate e curve brusche

## Cosa c'è dentro

* **Città procedurale** costruita sulla rete stradale: palazzi con finestre (illuminate di notte), tetti in coppi in centro,
  alberi, lampioni, marciapiedi, strisce pedonali, fiumi (Brenta, Bacchiglione, Piovego, Tronco Maestro) con ponti, ferrovia.
* **Monumenti**: Prato della Valle con l'Isola Memmia, il canale e le statue, Basilica del Santo, Palazzo della Ragione,
  Torre dell'Orologio, Duomo, Specola, Cappella degli Scrovegni, Stazione FS, Ospedale, Fiera.
* **Bus** da 12 m con fisica a bicicletta sull'asse posteriore, cambio automatico a 6 marce con convertitore di coppia,
  retarder, freno di fermata, sospensioni (beccheggio/rollio), porte animate, display LED, specchietti retrovisori reali.
* **Traffico** con modello IDM, semafori sincronizzati, auto che suonano il clacson e sorpassano il bus fermo, pedoni.
* **Passeggeri** che aspettano, salgono, prenotano la fermata e scendono, con annunci vocali in italiano.
* **Audio sintetizzato**: motore diesel, turbo, porte pneumatiche con cicalino, freni ad aria, campanello, frecce, pioggia.
* **Meteo**: sereno, pioggia (asfalto bagnato, frenata più lunga, tergicristalli) e la classica **nebbia padana**.

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
