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

## Linee disponibili

| Linea | Capolinea | Percorso | Feriale | Festivo |
|-------|-----------|----------|---------|---------|
| **SIR1** | Pontevigodarzere – Guizza | Arcella, Stazione FS, Corso del Popolo, Corso Garibaldi, Riviere, Santo, Prato della Valle, Bassanello | ogni 8' | ogni 15' |
| **22** | Torre – Mandria | Via Madonna della Salute, Via Bajardi, Via Machiavelli, Via Aspetti, Cavalcavia Borgomagno, Viale Codalunga, Via Giotto, Largo Europa, Riviere Ponti Romani / Tito Livio / Businello, Prato della Valle, Corso Vittorio Emanuele II, Bassanello, Strada dell'Armistizio | ogni 15' | ogni 30' |
| **24** | Largo Debussy – Mandriola | Via del Plebiscito, Via Callegari, Via Benedetti, Via Zanchi, Via Aspetti, Stazione FS, Piazzale Boschetti, Ospedale Civile, Via Gattamelata, Via Cavazzana, Prato della Valle, Bassanello, Strada Battaglia, Sant'Agostino | ogni 20' | ogni 40', limitata Stazione FS – Mandriola |
| **12** | Stazione FS – Tencarola | Corso del Popolo, Corso Garibaldi, Riviere, Businello, Prato della Valle, Via Sorio, Aeroporto, Brusegana | ogni 20' | ogni 40' |

Ogni linea si percorre in **andata** o **ritorno**. Le corse sono generate da orario di inizio/fine servizio e frequenza:
l'ora scelta determina luce (alba, giorno, tramonto, notte), traffico (ore di punta) e numero di passeggeri.

> I percorsi seguono le descrizioni strada per strada delle linee urbane Busitalia di Padova; la geometria delle strade è
> semplificata (tratti rettilinei tra i punti principali, coordinate approssimate) e le frequenze sono indicative.
> Dove non ho trovato differenze tra feriale e festivo, il festivo usa lo stesso percorso con frequenza ridotta.

## Modalità

* **Servizio di linea**: corsa con orario, fermate, passeggeri e punteggio.
* **Giro libero**: niente orari né fermate, giri dove vuoi per tutta la città (valgono comunque semafori, limiti e marciapiedi).

## La città

Le vie percorse dalle linee sono quelle reali (coordinate approssimate). Tutte le altre strade, le traverse che formano
gli isolati, sono **generate proceduralmente** a partire dalle vie principali: si fermano su fiumi, ferrovia e monumenti
e sono tutte percorribili. Il **Cavalcavia Borgomagno** è sopraelevato sopra la ferrovia (in salita il bus rallenta).
La **Stazione FS** ha il piazzale con le corsie dei bus, la fermata del tram, il posteggio taxi e il fascio dei binari.

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
  data/padova.js     rete stradale, linee, fiumi, monumenti
  world/city.js      generazione della città
  world/traffic.js   semafori, auto, pedoni
  bus/bus.js         modello 3D e fisica del bus
  game/routes.js     percorsi e fermate
  game/mission.js    servizio, passeggeri, orari, punteggio
  game/hud.js        interfaccia, cruscotto, minimappa
  game/audio.js      audio WebAudio + sintesi vocale
  main.js            rendering, telecamere, meteo, ciclo di gioco
```
