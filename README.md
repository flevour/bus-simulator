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

## Dati reali: GTFS Busitalia Veneto

Rete stradale, linee, percorsi, fermate e orari vengono dal **GTFS ufficiale di Busitalia Veneto** (feed BusOne,
`https://proxy.busone.app/biv/gtfs.zip`). I tracciati di tutte le linee sono costruiti su un unico grafo stradale:
le vie percorse da più linee condividono gli stessi vertici, quindi dall'unione dei tracciati si ottiene la **rete reale
delle strade percorse dai mezzi pubblici di Padova** (circa 16.000 tratti), con le fermate nella posizione vera.

* **Linee**: tutte le 22 linee urbane del feed (2, 3, 4, 5, 6, 7, 9, 10, 11, 11B, 12, 13, 14, 15B, 16, 19, 21, 22, 24, 25, 42, 88); sono esclusi i percorsi che escono oltre 9 km dal centro.
  Per ogni linea si sceglie direzione e variante di percorso (con il numero di corse feriali e festive).
* **Orari**: le corse sono quelle del GTFS per un mercoledì (feriale) e una domenica (festivo); gli orari di
  passaggio alle fermate sono quelli reali della corsa.
* **Monumenti**: Prato della Valle, Santo, Palazzo della Ragione, Stazione FS ecc. sono modelli semplificati,
  allineati automaticamente alla rete reale. Fiumi e ferrovia sono ancora tracciati approssimati.
* Il **tram SIR1** compare come strada (binari condivisi) ma non è tra le linee guidabili.

Per aggiornare i dati:

```bash
curl -L -o /tmp/biv.zip https://proxy.busone.app/biv/gtfs.zip && mkdir -p /tmp/biv && unzip -o /tmp/biv.zip -d /tmp/biv
python3 scripts/build_gtfs.py /tmp/biv src/data/gtfs-padova.json
```

Le vie senza autobus (strade residenziali) non sono nel GTFS: per averle servono i dati OpenStreetMap.

## Comandi (tastiera)

| Tasto | Azione |
|-------|--------|
| **W / ↑** | acceleratore (progressivo) |
| **S / ↓** | freno (progressivo: tenere premuto per frenare di più) |
| **A D / ← →** | sterzo |
| **Shift** | pedale "dolce" (metà corsa) |
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
  data/padova.js     rete stradale e linee (dal GTFS), fiumi, monumenti
  data/gtfs-padova.json  dati generati da scripts/build_gtfs.py
  world/city.js      generazione della città
  world/traffic.js   semafori, auto, pedoni
  bus/bus.js         modello 3D e fisica del bus
  game/routes.js     percorsi e fermate
  game/mission.js    servizio, passeggeri, orari, punteggio
  game/hud.js        interfaccia, cruscotto, minimappa
  game/audio.js      audio WebAudio + sintesi vocale
  main.js            rendering, telecamere, meteo, ciclo di gioco
```
