# Prompt: tram SIR1 guidabile

Testo da dare a Claude (o a chi sviluppa) per realizzare il tram. È autosufficiente: descrive il contesto del codice,
i dati, cosa fare e come verificarlo.

---

## Obiettivo

Nel simulatore (Three.js, `src/`) aggiungi il **tram come mezzo guidabile, solo sulla sua linea**. Per ora la linea è
il **SIR1** di Padova (Translohr, Guizza ↔ Pontevigodarzere), con **3 moduli**. Il numero di moduli deve essere un
parametro della linea: le linee tram future (SIR2, SIR3) useranno anche **4 moduli** e devono poter essere aggiunte
solo come dati.

Lingua: interfaccia, messaggi, commenti e commit in italiano. Lavora su `main` con push continuo (vedi `CLAUDE.md`).

## Contesto del codice

* `src/main.js`: rendering, telecamere (cabina, esterna, passeggeri, dall'alto), input da tastiera, meteo, ciclo di gioco,
  salvataggio (`SAVE_KEY`), teletrasporto, menu (`buildMenu`, `startMission`). Espone `window.__game` per i test
  (`sim`, `press`, `keys`, `setCam`, `teleport`, `settings`, `lines`, `wx`, …).
* `src/bus/bus.js`: modello e fisica del bus (`Bus`). Interfaccia usata dal resto del gioco: `x, z, h, fx, fz, v,
  speedKmh, dir, doorOpen[], doorTarget, doorsClosed, doorsAnyOpen, kneelTarget, lights, indicator, parking, throttle,
  brake, rpm/powerKw, electric, passengers, toWorld(lx, lz), place(x, z, h), update(dt, input, world),
  drawDash(state), setPassengerVisuals(n), setInnerDisplay(t)`, materiali per la notte.
* `src/game/mission.js`: corsa, fermate, passeggeri (`Crowd`), orari, punteggio, ritardatario, regole (semafori rossi,
  STOP, autovelox, marciapiede). `src/game/routes.js`: `buildRoute`, `pointAt`, `projectOnRoute`.
* `src/game/hud.js`: pannello linea, navigazione, minimappa e mappa grande, cruscotto (`drawCluster`).
* `src/game/audio.js`: suoni sintetizzati (diesel, inverter dell'elettrico, porte, campanello, pioggia).
* `src/world/city.js`: città, strade, incroci, fermate. **`buildTramway()`** disegna la sede: corsie rosse larghe
  `TRAM_HW = 3.4` per lato, rotaia centrale, cordoli e banchine alle fermate. `onTramway(x, z)` dice se un punto è
  sulla sede.
* `src/world/traffic.js`: **`TramSim`**, cioè due tram automatici sul tracciato. Hanno 3 moduli a scatola bianchi e
  rossi, si fermano 18 s alle fermate e per il bus, e `near()` restituisce le parti per le collisioni.
* `src/data/padova.js` carica `src/data/padova-map.json`: `net.tram` (polilinea del tracciato principale in metri, x
  est e z sud) e `net.tramStops` (25 fermate: `x, z, name`).
* `scripts/build_map.py` produce `padova-map.json` da OSM + GTFS. Il tram viene da qui (cerca "tram SIR1"). Oggi
  esporta solo lo shape più frequente e le fermate di una corsa, **senza orari**.

## Dati reali del SIR1 (GTFS BusOne, `https://proxy.busone.app/biv/gtfs.zip`)

* `route_id` `TPD_SIR1`, `route_short_name` `SIR1`, agenzia `TPD_11`. `route_type` è 3, quindi il GTFS lo classifica
  come autobus: va riconosciuto dall'agenzia o dal nome, non dal tipo.
* 1699 corse nel feed. Destinazioni: `GUIZZA-Cap.SUD`, `PONTEVIGODARZERE` e le corse limitate `CAVALLETTO`, `SANTO`.
* Tracciato principale di circa 10,1 km con 25 fermate: Guizza Capolinea, Guizza, Cuoco, Sacchetti, Bassanello,
  Cavallotti, Santa Croce, Diaz, Cavalletto, Prato della Valle, Santo, Tito Livio, Ponti Romani, Eremitani,
  Stazione FS, Borgomagno, Arcella, Dazio, Palasport, San Carlo, San Gregorio, Saimp, Fornace, Pontevigodarzere.
* Il sud della linea (Guizza) esce dall'area di gioco (`FOCUS` in `build_map.py`). Decidi se allargare l'area lungo
  la linea del tram, oppure tagliare come per i bus ("tratto in città").

## Cosa fare

### 1. Dati (`scripts/build_map.py` → `padova-map.json`)

Esporta il tram come una linea vera, con lo stesso formato delle linee bus (`lines[]`) o in un campo `tramLines[]`:

* `id` (`SIR1`), `color`, `modules: 3`;
* varianti per direzione e per le corse limitate, con shape, fermate in ordine, `offsets` e `duration`;
* partenze `fer`/`fes` per le stesse date dei bus (`FER_DATE`, `FES_DATE` in `scripts/build_gtfs.py`).

Per ogni fermata calcola anche il **lato della banchina** rispetto al senso di marcia (destra, sinistra o centrale).
Il Translohr apre le porte da entrambi i lati.

Quando ci sarà il file `data/osm-padova-segnaletica.json` (vedi `docs/overpass-segnaletica.md`), usa i binari OSM
`railway=tram` e i `railway=tram_stop` per allineare tracciato e banchine. Oggi in Viale Cavallotti la sede è
attaccata al marciapiede del bus.

### 2. Veicolo (`src/tram/tram.js`, nuova classe `Tram`)

Stessa interfaccia del `Bus`, così missione, HUD, telecamere, audio e salvataggio funzionano quasi senza modifiche.

* **Moto vincolato alla rotaia**: lo stato è la posizione curvilinea `s` lungo il tracciato e la velocità. Niente
  sterzo. Ogni modulo è posizionato sul tracciato alla sua distanza dal muso (moduli articolati che seguono la
  curva), con le giunzioni a soffietto tra un modulo e l'altro.
* **Moduli parametrici**: `modules: 3` per il SIR1 (Translohr STE3, circa 25 m), 4 per le linee future (circa 32 m).
  Con 3 moduli ci sono due moduli di testa con le cabine e uno centrale. Con 4 moduli si aggiunge un modulo centrale.
* **Bidirezionale**: cabina a entrambe le estremità. Al capolinea il guidatore "cambia cabina" con un tasto (per
  esempio **B**) e il senso di marcia si inverte; niente retromarcia in linea.
* **Fisica**:
  * massa circa 30–40 t a vuoto più i passeggeri;
  * accelerazione di servizio circa 1,1 m/s²;
  * frenata di servizio circa 1,3 m/s², emergenza circa 2,5 m/s² (Backspace o il fungo rosso; Spazio è il freno di stazionamento);
  * velocità massima 70 km/h, limiti per tratta (centro storico e curve strette più bassi);
  * motore elettrico: suono dell'inverter (riusa quello del bus elettrico, più grave), compressore, gong.
* **Comandi**:
  * W/S comandano il manipolatore di trazione e frenatura, a tacche: tenere premuto per salire di tacca, Shift per
    andare più veloce;
  * F apre le porte sul lato della banchina, solo da fermo e allineati;
  * H suona il gong o campanello, Shift+H il clacson (il Translohr li ha tutti e due, `docs/cabina-translohr.md`);
  * L accende i fari;
  * C cambia visuale;
  * B cambia cabina (solo al capolinea, da fermo).
* **Aspetto esterno** (dalla foto di riferimento):
  * carrozzeria blu cobalto lucida, con pannelli grigio argento chiaro attorno alle porte e tra i moduli;
  * finestrini scuri a tutta altezza;
  * testata con grande parabrezza curvo e inclinato e fanali bassi;
  * gonna nera che nasconde le ruote;
  * pantografo sul tetto del modulo centrale, display di linea e destinazione sopra il parabrezza.
  * Usa la stessa livrea per i `TramSim` automatici, oggi bianchi e rossi.
* **Cabina** (dalla foto di riferimento):
  * banco di guida inclinato grigio chiaro con circa 40 pulsanti tondi grigi, alcuni rossi e uno azzurro;
  * a destra una plancia blu scuro con uno schermo LCD: tachimetro a lancetta al centro e indicatori numerici;
  * una barra verticale di LED rossi;
  * il pulsante a fungo rosso di emergenza in alto a destra;
  * il manipolatore a destra del guidatore.
  * Il cruscotto può essere una texture su canvas aggiornata come `Bus.drawDash`.

### 3. Missione e regole

* Nel menu il SIR1 compare come linea a parte (badge "T", per esempio). Si possono scegliere direzione, variante
  (anche le corse limitate) e corsa dall'orario reale.
* Il tram del giocatore prende il posto di uno dei `TramSim` automatici; l'altro resta in circolazione, sulla stessa
  rotaia e con distanziamento.
* Fermate:
  * il muso va fermato al segnale di fine banchina, con una tolleranza di qualche metro;
  * niente controllo di accostamento laterale;
  * la salita e la discesa usano tutte le porte, dal lato della banchina.
* Regole e punteggio:
  * punti per puntualità, fermata precisa, comfort (strappi e frenate), uso del gong vicino ai pedoni;
  * penalità per eccesso di velocità sul limite della tratta, partenza con le porte aperte, rosso o segnale del
    tram, frenate d'emergenza inutili.
  * Non si applicano frecce, marciapiede, retromarcia o la penalità "corsia del tram".
* Incroci: le auto devono fermarsi quando il tram passa, quindi i semafori lungo la linea danno priorità al tram.
  Collisioni con le auto come per il bus.
* Salvataggio e ripresa: anche lo stato del tram (`s`, verso, cabina attiva).

### 4. HUD e telecamere

* Visuale di cabina dal posto di guida della cabina attiva; visuale esterna che segue tutto il convoglio; vista
  passeggeri da un modulo centrale.
* Cruscotto HUD: velocità, tacca del manipolatore (trazione o frenatura), porte, segnale del tram.
* Niente specchietti come quelli del bus: telecamere laterali sullo schermo di bordo.

## Come verificare

* `npm run build` senza errori.
* Test headless con Playwright, con Chromium preinstallato e flag `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`:
  * carica la pagina e avvia una corsa SIR1 con `__game.startMission()`;
  * disattiva il loop con `requestAnimationFrame = () => 0` e simula con `__game.sim(sec, dt, draw)`;
  * controlla che il tram parta, segua la rotaia senza uscire dalla sede e si fermi alle fermate;
  * controlla che le porte si aprano solo da fermo, che i passeggeri salgano e che il punteggio si aggiorni;
  * controlla il cambio cabina al capolinea.
* Screenshot da cabina ed esterna da confrontare con le foto di riferimento.
* Verifica che con 4 moduli (anche solo un test con il parametro forzato) il convoglio segua bene le curve.
* Le linee bus non devono cambiare comportamento: prova una corsa del 24 dopo le modifiche.

## Stato

Prima versione realizzata in `src/tram/tram.js` (TrackPath, corsie, modello a moduli, classe `Tram`),
`src/world/traffic.js` (`TramSim`), `src/game/routes.js` (`buildTramRoute`), `src/game/mission.js` (regole del
tram, pantografo), `scripts/build_gtfs.py` (`load_tram`). L'area di gioco arriva fino alla Guizza.

Regole aggiunte nel frattempo:

* **Pantografo**: a Prato della Valle non c'è la linea aerea. Va abbassato prima di arrivarci, in entrambi i sensi, e
  rialzato subito dopo. Il tratto è definito in `catenaryGaps()`: ±130 m dalla fermata.
* **Gong e clacson** (#63): H il gong a rintocchi, Shift+H il clacson del tram, diverso da quello del bus.

## Per le linee future (SIR2, SIR3, SIR4, SIR5)

Il nuovo piazzale della stazione ha gli anelli del tram a **ovali concentrici**: i tram girano attorno al piazzale e
più linee condividono tratti di binario. Oggi la sede è un'unica polilinea (`net.tram[0]`) con due corsie. Per le
nuove linee:

* passare a un **grafo di binari** (archi con la loro geometria, deviatoi ai nodi), costruito dai binari OSM
  `railway=tram` e dagli shape GTFS di ogni linea;
* il percorso di una corsa diventa una sequenza di archi del grafo (come per i bus sulla rete stradale), con gli
  anelli percorsi nel verso giusto;
* `TramSim` e la linea aerea lavorano sul grafo, non su una sola polilinea;
* le banchine possono stare a destra, a sinistra o al centro (isola tra due binari): le porte si aprono dal lato
  della banchina.

## Fuori dall'obiettivo per ora

SIR2 e SIR3 come dati (basterà aggiungerli quando ci saranno shape e orari), linee tram con deviazioni, depositi.
