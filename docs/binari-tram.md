# Binari del tram: la regola

Regola per la stesura dei binari del tram nel gioco (ticket #68, issue madre #67) e controllo di quanto la rete di oggi
se ne allontana. La usano #69 (binari delle linee SIR1, SIR2 e SIR3) e #70 (depositi della Guizza e di Voltabarozzo).
Ricerca del 12 novembre 2026. Come in [`cabina-translohr.md`](cabina-translohr.md), ogni numero porta la sua fonte
(elenco in fondo) e una di due parole:

* **confermato**: lo scrive una fonte, oppure si legge in un disegno di progetto;
* **inferenza**: è una deduzione, da un disegno, da OSM o per analogia con un'altra rete Translohr. Va verificata.

La fonte principale è il progetto definitivo del SIR3 (Italferr 2020) pubblicato dal Comune: la relazione tecnica del
tracciato ([F1]), il disciplinare dell'armamento ([F2]), le planimetrie con le tabelle dei vertici ([F6]) e il disegno
dello scambio ([F4]). Il SIR3 dichiara di riprendere le soluzioni del SIR1 ([F1] foglio 5): dove manca un dato del SIR1
vale quello del SIR3 (inferenza).

## 1. La regola in breve

1. **OSM è la traccia, non il disegno.** I binari OSM (`railway=tram`) dicono dove passa il binario e come sono
   collegati (scambi, comunicazioni, rami del deposito). La geometria si rifà sopra: rettilinei, clotoidi e archi, con
   i numeri qui sotto. Il binario rifatto resta entro **1 m** dal binario OSM; più in là solo con un'eccezione scritta
   (sezione 4).
2. **Niente spigoli.** Il binario ha la tangente continua: rettilineo, clotoide, arco, clotoide, rettilineo. Le
   clotoidi sono lunghe di solito **10 m** (da 6 a 16 m, meno sui raggi piccoli); sopra i **400 m** di raggio l'arco
   attacca diretto. Nel gioco i binari sono polilinee: sulle curve un punto almeno ogni **3 m**, il passo di
   `TramTrack`.
3. **Raggio minimo 10,5 m** sulla rotaia di guida, in linea, negli scambi e in deposito. Dove la strada lo permette
   la curva è più larga: nel SIR3 tre su quattro stanno tra 40 e 250 m, quelle da 10,5 a 20 m solo al capolinea della
   stazione e nell'ultimo chilometro verso Voltabarozzo.
4. **Interasse costante.** I due binari di una linea nella stessa sede stanno a **3,00 m** (SIR1 e SIR3) o **3,50 m**
   (SIR2), e mai sotto il minimo delle fasce d'ingombro: **2,59 m** in rettilineo, che cresce in curva fino a 3,36 m a
   10,5 m di raggio (con i pali della linea aerea in mezzo: 3,06 m in rettilineo, 3,78 m a 10,5 m). Dove c'è qualcosa
   tra i binari (banchina centrale, pali, aiuola) l'interasse è più largo, costante lungo il tratto, e cambia solo con
   una S fatta di curve che rispettano il raggio minimo.
5. **Scambi** a cerniera lunghi **4,05 m**, ramo deviato con raggio **10,5 m** (fino a 21,5 m), uscita a **16,6°**;
   solo in rettilineo, su pendenza costante, mai negli incroci stradali. Una **comunicazione** tra binari a 3 m è lunga
   circa **10,8 m** tra le punte dei due scambi.
6. **Pendenza** al massimo **6%** in linea, **4%** in fermata, nelle rotaie di manovra e ai capolinea (in fermata
   meglio il 2%). Il veicolo arriva al 13% solo come limite. Raccordi verticali di almeno **350 m** nelle conche e
   **120 m** sui dossi (200 m nelle conche dei binari di servizio e del deposito).
7. **Eccezioni scritte.** Dove un vincolo vero obbliga a uscire dalla regola (il piazzale della stazione), l'eccezione
   ha una zona e il suo perché in `ECCEZIONI` di `scripts/binari_tram.py` e qui sotto. Il controllo la elenca a parte.

## 2. I numeri e le fonti

### Veicolo

* Translohr STE3 (SIR1 e i tre casse del SIR3): 25,0 m, largo 2,20 m, alto 2,99 m. **Confermato** [F1] fogli 7-8.
* Raggio minimo **10,50 m** sulla rotaia di guida, limite del costruttore: «Le curve circolari inserite nel tracciato,
  presentano valori dei raggi superiori al limite minimo ammesso dal costruttore del materiale rotabile pari a Rmin =
  10,50 m». **Confermato** [F1] foglio 35; stesso numero per il SIR1 [F9] p. 11 e per i veicoli nuovi da 25 e 32 m
  [F13] nota 4.
* A 10,5 m il STE3 spazza la fascia tra 8,62 e 11,92 m dal centro della curva. **Confermato** [F9] p. 11. Per il
  quattro casse (32-33 m) la fascia è più larga: numero non trovato.
* Pendenza superabile 13% «con carico eccezionale». **Confermato** [F1] fogli 8 e 39.

### Raggi

* Raggio minimo in linea **10,50 m** e negli scambi **10,50 m**. **Confermato** [F1] foglio 5 (tabella dei dati).
* Raggi usati nel SIR3: 12,50 m sul binario verso Voltabarozzo (curva AV02, alla stazione), 10,50 m su quello verso la
  stazione (BV68, a Voltabarozzo). **Confermato** [F1] foglio 35. Dei 100 vertici leggibili nelle 22 planimetrie: 13
  tra 10,5 e 20 m (capolinea della stazione, via Nani, via Piovese), 21 tra 40 e 90 m, 33 tra 100 e 200 m, 23 a
  250 m, 4 tra 300 e 600 m. **Confermato** (valori dei disegni [F6]; il conteggio è della ricerca).
* SIR2: «Raggio planimetrico minimo pari a 10.50 metri (15m minimo usati)»; 15 m alle due rotatorie, 24 m in Piazza
  Garibaldi. **Confermato** [F14] pp. 15 e 21.
* In deposito nessun numero di progetto. NTL scrive che il deposito Translohr occupa metà superficie grazie al «10.5
  metre turning circle». **Inferenza**: il minimo del deposito è lo stesso 10,5 m [F11] p. 7.
* Altre reti: Mestre San Basilio 31 m [F15] p. 15, Medellín 20 m [F16] p. 100. Il tram su ferro di Firenze: 20 m in
  linea e in deposito, 25 m negli scambi [F19]. **Confermato.**
* Nel gioco il raggio si misura sull'asse del binario, che è la rotaia di guida.

### Curve di transizione

* Ogni curva del SIR3 ha una clotoide in entrata e una in uscita, simmetriche. **Confermato** [F1] foglio 36.
* Lunghezza «comunemente ammesso è pari a 10 m, fatto salvo nei casi di piccoli raggi»; nei disegni 6, 8, 10, 12 e
  16 m (R 10,5 m con 6 m, R 12,5 m con 8 m, R 70 m con 10 m). Sopra i 400 m di raggio niente clotoidi. **Confermato**
  [F1] foglio 38, [F6].
* Comfort: accelerazione trasversale fino a 1 m/s² (0,9 nella tabella), contraccolpo fino a 0,4 m/s³; velocità in
  curva V = 3,6 √(R (1 + 9,81 d)) km/h, con d la pendenza trasversale. **Confermato** [F1] fogli 5 e 36. Con d = 0:
  12 km/h a 10,5 m, 18 a 25 m, 36 a 100 m (calcolo).
* Nessuna sopraelevazione: la sede segue la pendenza trasversale della strada, di solito fino al 2%, al più il 6%.
  **Confermato** [F1] foglio 35, [F2] fogli 18-19.
* La norma UNI 7836 (andamento plano-altimetrico dei binari) non vale per il Translohr, che non ha scartamento.
  **Confermato** [F1] foglio 34.

### Pendenze

* Pendenza massima in linea usata nel SIR3: **6%** (rampe del ponte sullo Scaricatore). **Confermato** [F1] fogli 5 e
  40-41. Nel SIR2 la più forte è il 4,8% (4,26% sul cavalcavia San Marco). **Confermato** [F14] pp. 15-16.
* In fermata, nelle rotaie di manovra e ai capolinea al massimo **4%**, in fermata preferibilmente il 2%.
  **Confermato** [F1] foglio 39.
* Raccordi verticali: la stessa relazione dà 350 m (tabella), «non minore di 500 m … vincolante» (testo) e come minimi
  350 m nelle conche sui binari in uso, 200 m su quelli non in uso (deposito, rotaia deviata), 120 m sui dossi.
  **Confermato** [F1] fogli 6, 39, 40. La regola prende i minimi: 350, 200 e 120 m.

### Interasse

* «l'intervia fra i binari (intesa come distanza da asse rotaia ad asse rotaia) assumerà il valore minimo di 3,00 m»;
  sede doppia larga almeno 5,40 m. **Confermato** [F1] fogli 8-9.
* Le tabelle della stessa relazione calcolano il minimo dalle fasce d'ingombro dei due tram, a 400 mm l'una
  dall'altra come chiede la UNI 7156 § 4.7. Con i pali della linea aerea fuori dai binari: 3,362 m a R 10,5, 3,129 a
  15, 2,997 a 20, 2,915 a 25, 2,862 a 30, 2,795 a 40, 2,753 a 50, 2,670 a 100, 2,631 a 200, 2,614 fino a 380 m,
  **2,594 m** oltre e in rettilineo. Con i pali in mezzo: da 3,777 m a R 10,5 fino a 3,062 m in rettilineo.
  **Confermato** [F1] fogli 23-24, 33. Il testo (3,00 m) e le tabelle (2,594 m) non coincidono: la regola usa le
  tabelle come minimo e 3,00 m come valore di progetto.
* SIR2: interasse 3,50 m, corridoio centrale di 7,00 m. **Confermato** [F14] p. 16. Mestre San Basilio: 3,00 m [F15].
* SIR1: nessun valore di progetto trovato. In OSM la distanza più frequente tra i due binari è 3,0-3,25 m.
  **Inferenza** debole: 3,00 m come il SIR3.
* In OSM la distanza tra i due binari va da 2,6 a 6 m anche dove i binari sono nella stessa sede: in Via Venezia
  (SIR2), Via Sografi (SIR3) e Via della Provvidenza (SIR2) i due binari stanno a 6 m per centinaia di metri. Lì
  probabilmente c'è qualcosa in mezzo; da verificare sulle foto aeree. **Inferenza.**
* Deposito: nessun valore trovato; sulla planimetria dell'ampliamento della Guizza i binari nuovi dell'officina
  stanno a 5,1-6,3 m, con passerelle in mezzo [F8]. **Inferenza.** Minimo: le stesse fasce d'ingombro della linea.

### Scambi e comunicazioni

* Scambio Translohr a cerniera (Vossloh Cogifer, 2004-05): ruota in pianta una coppia di rotaie, una dritta e una
  deviata. Lunghezza **4054 mm**, ramo deviato con raggio **10,5 m** che parte a 1022 mm dalla punta, angolo d'uscita
  **16,581°**, scostamento all'uscita 436,6 mm. **Confermato** [F4], [F1] foglio 42. Ingombro massimo 4500 mm di
  lunghezza e 550 mm per lato dalla rotaia [F2] foglio 32.
* Esistono deviatoi con il ramo deviato da 10,5 a 21,5 m. **Confermato** [F1] foglio 42.
* Velocità: 10-15 km/h sul deviato, fino a 70 km/h sul diritto. **Confermato** [F1] foglio 42.
* Dove: «unicamente su tratti in rettilineo del tracciato, escludendo i tratti di raccordo di livellette verticali»,
  non negli incroci stradali, nelle zone a velocità ridotta, per esempio vicino alle fermate. **Confermato** [F1]
  fogli 41-42, [F2] foglio 31.
* Comunicazioni: sei nel SIR3, più una sul SIR1 alla stazione [F7] foglio 142, [F5]. La distanza tra la punta del
  primo scambio e il centro della comunicazione è sempre 5,409 m, quindi circa 10,8 m tra le due punte: due curve
  opposte da 10,5 m tra binari a 3,00 m. **Inferenza** (dalle progressive e dal disegno).
* Nel SIR2 una comunicazione ogni 1000 m circa. **Confermato** [F14] p. 16.

### OSM

* Gli export del 9 novembre (`data/osm-padova-tram.json`, `data/osm-padova-tram-cantiere.json`) hanno i binari come
  polilinee con un punto ogni 5-20 m: sulle curve i vertici fanno spigoli da 2 a 30°, e alcune curve vere hanno
  raggi da 7 a 9 m (Via Carlo Zeno, Via Piovese, Via Tommaseo), sotto il minimo del veicolo. **Inferenza**: OSM
  disegna la curva tagliando gli angoli, non dice il raggio.
* La tolleranza di 1 m è una scelta di questa regola, non di una fonte: è più di quanto sbaglia un binario tracciato
  su foto aeree e basta per mettere un arco al posto di una spezzata o portare i due binari a interasse costante.

## 3. Come si rifà un binario (per #69 e #70)

È il metodo già usato per il piazzale della stazione (`scripts/tram_stazione.py`, sezione "Binari della stazione" di
[`linee-tram-nuove.md`](linee-tram-nuove.md)), da allargare a tutta la rete:

1. dai binari OSM, la successione delle way di ogni binario (come già fanno `scripts/tram_linee.py` e
   `scripts/tram_depositi.py`), ricampionata ogni metro;
2. i tratti dritti diventano rettilinei (la retta che segue meglio i punti), le svolte archi con il raggio più grande
   che sta tra i due rettilinei e resta entro 1 m da OSM, mai sotto 10,5 m, con le clotoidi ai capi;
3. dove i due binari di una linea sono nella stessa sede, prima l'asse comune e poi i due binari a metà interasse
   per parte: l'interasse resta costante e cambia solo con una S;
4. scambi e comunicazioni con la geometria della sezione 2, in rettilineo; nei depositi i ventagli fatti di scambi
   uno dopo l'altro;
5. i punti scritti ogni metro o meno (come il piazzale), così il gioco li prende come sono.

Nel gioco oggi i binari passano da tre ritocchi che con dati già secondo la regola non servono più e che spostano la
geometria (gli scarti da OSM del gioco vengono soprattutto da lì: dove i dati hanno uno spigolo il raccordo taglia
l'angolo, come in Via Guizza e in Via Carlo Zeno): i raccordi fino a 28 m di raggio a ogni vertice
(`smoothTrack` in `src/data/padova.js`), lo spostamento fino a 5 m lontano dalle facciate (`clearOfBuildings`, stesso
file) e la media mobile su ±9 m (`smoothLane` in `src/tram/tram.js`, già spenta nel piazzale). Altre misure del gioco
lontane dalla regola: l'interasse disegnato di 3,4 m (`TRAM.lane` 1,7 m, e `GAP` di `tram_stazione.py`), la S dello
scambio ai capolinea lunga 24 m (`XO` in `tram.js`) contro i 10,8 m veri, il raccordo di 20 m dei bivi (`SWITCH_LEN`).

## 4. Il controllo

`scripts/binari_tram.py` misura una rete di binari contro la regola, per linea (SIR1, SIR2, SIR3) e per deposito
(Guizza, Voltabarozzo). Solo libreria standard di Python. Le reti sono due:

* **i dati**, quello che scrivono gli script: il SIR1 in `src/data/padova-map.json` (shape GTFS agganciato ai binari
  OSM), SIR2 e SIR3 in `data/tram-linee-nuove.json`, le comunicazioni OSM dei capolinea e i depositi di
  `data/tram-depositi.json`. Li misura `scripts/verifica_mappa.py`, con le soglie in `SOGLIE_BINARI`;
* **il gioco**, i binari come li disegna dopo i ritocchi della sezione 3: `TramTrack.paths` (con i bivi tra le linee),
  le S degli scambi ai capolinea (`terminalCurve`), le quote (`TramTrack.h`), i rami e i nodi di `TramYard`. Li misura
  `tests/binari-tram.spec.js`, che li scrive in un file e chiama lo script con `--gioco`; le soglie sono nella prova.

```bash
python3 scripts/binari_tram.py --elenco                       # i dati, con i punti peggiori
python3 scripts/verifica_mappa.py --elenco                    # i dati, dentro il rapporto della mappa (serve shapely)
npx playwright test tests/binari-tram.spec.js                 # il gioco
python3 scripts/binari_tram.py --gioco test-results/binari-tram-binari-del-tram-secondo-la-regola/binari-gioco.json --elenco
```

Cosa conta (i binari ricampionati ogni metro; un caso è un tratto, con il punto peggiore):

* **spigoli**: la direzione cambia di almeno **2°** tra due corde di 2 m, e lì si concentra almeno metà della svolta
  fatta tra due corde di 10 m. Una curva distribuisce la svolta (in 4 m ne fa un quinto di quella in 20 m), uno
  spigolo no. Un arco disegnato con punti più radi di 4-5 m conta come una fila di spigoli;
* **raggi sotto il minimo**: raggio sotto 10,5 m, misurato con due corde di 3 m attorno al punto (il passo dei binari
  del gioco). I tratti sotto il minimo a meno di 10 m l'uno dall'altro sono una curva sola;
* **interassi fuori misura**: dove i due binari di una linea corrono nella stessa sede (entro 6 m, in controsenso, e
  non sullo stesso binario, come un tronco al capolinea), più vicini del minimo delle fasce d'ingombro per il raggio
  più stretto entro 10 m; oppure un interasse che va e viene: nei 30 m attorno al punto la strada fatta
  dall'interasse, tolto il cambio netto, supera 0,3 m. Un interasse costante o che passa da un valore a un altro senza
  tornare indietro va bene. Nel deposito: binari paralleli più vicini del minimo, a più di 15 m dai nodi;
* **scarti da OSM**: tratti a più di 1 m dal binario OSM più vicino e parallelo (entro 15 m: più lontano non c'è un
  binario OSM e il tratto è disegnato dal gioco, come le S dei capolinea);
* **pendenze** (solo nel gioco, l'unico con le quote): sopra il 6% su 10 m.

Ai nodi del deposito il controllo prova ogni coppia di rami che prosegue dritta (entro 45°, come `TramYard`), con 10 m
di ramo da una parte e dall'altra: sono i giunti e gli scambi dell'elenco. Ogni caso ha il posto (coordinate del gioco,
via e fermata più vicine) e un peso: gradi diviso 2 per gli spigoli, 10,5 diviso il raggio, 1 più i metri sotto il
minimo diviso 0,3 per gli interassi stretti, l'oscillazione diviso 0,3 m, metri da OSM, pendenza diviso 6%. L'elenco
dei punti peggiori va per peso.

Eccezioni (`ECCEZIONI`): il **piazzale della stazione**, per gli scarti da OSM. I binari lì vengono dal rendering del
progetto del piazzale: anelli regolari e raccordi morbidi al posto dei binari OSM, che fanno S e si incrociano.

Non si contano ancora: le clotoidi (oggi non ci sono da nessuna parte; servirà quando #69 e #70 le disegneranno), gli
scambi in curva o vicini agli incroci, la lunghezza delle comunicazioni, le pendenze in fermata e i raccordi verticali.

Le soglie sono i valori del 12 novembre: se un numero scende, si abbassa la soglia nello stesso commit, come per il
resto del rapporto della mappa.

## 5. La rete del 12 novembre 2026

Casi per linea e deposito, dati / gioco (le pendenze solo nel gioco):

| | spigoli | raggi | interassi | scarti da OSM | pendenze |
|---|---|---|---|---|---|
| SIR1 | 166 / 7 | 2 / 0 | 72 / 38 | 2 / 25 | – / 4 |
| SIR3 | 93 / 4 | 6 / 2 | 31 / 16 | 0 / 12 | – / 0 |
| SIR2 | 238 / 7 | 7 / 0 | 67 / 23 | 0 / 30 | – / 14 |
| Guizza | 6 / 10 | 7 / 2 | 0 / 0 | 0 / 0 | – / 0 |
| Voltabarozzo | 12 / 12 | 4 / 4 | 0 / 0 | 0 / 0 | – / 0 |

* **Linee**: nei dati quasi tutti gli spigoli sono vertici delle polilinee (di OSM, e per il SIR1 dello shape GTFS
  agganciato ai binari OSM e semplificato); nel gioco i raccordi e la media mobile li tolgono, e in cambio portano il
  binario fuori da OSM (699 m nel SIR1, 454 nel SIR2, 222 nel SIR3, fino a 3,4 m). Gli interassi fuori misura nei dati
  coprono 2,2 km nel SIR1, 1,4 km nel SIR2 e 0,7 km nel SIR3; nel gioco 0,9, 0,2 e 0,2 km.
* **Depositi**: dati e gioco quasi uguali, perché `TramYard` usa le way OSM come sono. Gli spigoli sono ai nodi dei
  ventagli (gli scambi di OSM sono vertici dove la way deviata parte con un angolo di 10-17°) e nelle curve disegnate
  con pochi punti; il raggio più stretto è 6,1 m nei dati e 6,4 m nel gioco.
* **Pendenze**: le rampe dei cavalcavia nel gioco arrivano al 18,5% (Chiesanuova, SIR2), oltre il limite del veicolo;
  il progetto del SIR2 non supera il 4,8%. Ticket a parte: #74.

### Punti peggiori delle linee (per #69)

Dal gioco, in ordine di peso; coordinate del gioco (x verso est, z verso sud).

1. **SIR1, Corso Vittorio Emanuele II verso Cavalletto** (-297, 1208) e (-291, 1195): i due binari a 1,0 m l'uno
   dall'altro per circa 150 m, contro un minimo di 2,59 m: due tram che si incrociano si sovrappongono. In OSM i due
   binari stanno a 2 m; nei dati a meno di 1 m. Da verificare dal vero se lì il binario è interlacciato.
2. **SIR2, capolinea di Rubano** (-7592, -2897): spigolo di 30° a 112 m dalla fermata (e uno di 10° a 7 m).
3. **SIR1, capolinea della Guizza** (-203, 4407): spigolo di 22° sul binario verso sud (30° nei dati) e di 12,5° nella
   S dello scambio (-248, 4399).

Poi: SIR1 a Pontevigodarzere (1105, -3828), spigolo di 16° (48° nei dati) e 11° nella S dello scambio (1061, -3830);
SIR2 e SIR3 alla testata est dell'anello della stazione (320, -995), spigolo di 14°; S dello scambio di Voltabarozzo (2367,
3574), 12°; SIR2 a Busa di Vigonza (5965, -2335), binari a 1,1 m per 9 m alla fine; SIR3 in Via Carlo Zeno alla
fermata Piovese (2216, 3403), raggio di 10,3 m, 3,4 m fuori da OSM, e nei dati una curva da 5,7 m; SIR3 nel raccordo
verso l'anello della stazione (160, -1055), raggio di 10 m per 31 m. Interassi che vanno e vengono di oltre 1 m:
SIR1 in Riviera del Businello (79, 797) e in Via Pontevigodarzere (1128, -3255), SIR2 in Corso Garibaldi (59, -357).

### Punti peggiori dei depositi (per #70)

* **Voltabarozzo**: spigolo di 27° e curve da 6,4-6,6 m nel binario a nord-ovest (2334, 3695), (2355, 3697) e
  (2330, 3690); scambi con spigoli di 17,5° (2356, 3674) e 13,6° (2358, 3688); spigolo di 16,6° sul binario che entra
  da sud (2378, 3659).
* **Guizza**: spigolo di 17,5° all'ingresso del ventaglio est (-125, 4444); il ventaglio tra (-151, 4436) e (-194,
  4485), quello della foto di #67, con spigoli di 14-14,6° a ogni scambio e un raggio di 9,6 m (-153, 4448).

## Fonti

Lette il 12 novembre 2026. I documenti del progetto del SIR3 stanno nella cartella
https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/ (804 PDF, l'elenco degli elaborati
è il file 001); la pagina di un "foglio N" coincide con la pagina del PDF.

* [F1]: Italferr con SDA Progetti, Erregi, Pini per APS Holding, "Progettazione definitiva della nuova linea
  tramviaria SIR 3 - Tracciato - Relazione tecnica", NP00 00 D Z1 RH IF0000 001, 2020, 44 fogli.
* [F2]: stesso progetto, "Disciplinare descrittivo e prestazionale - Parte seconda: Armamento", 2020.
* [F4]: stesso progetto, "Armamento - Sezioni tipologiche e particolari costruttivi - Tav. 3", 2020, con il disegno
  Vossloh Cogifer "TRANSLOHR - Scambio a cerniera deviazione a destra - Piano di posa" (2004-2005).
* [F5]: stesso progetto, "Planimetria armamento", tavole 1-5, 2020, file 509-513.
* [F6]: stesso progetto, "Tracciato - Planimetria" 1:500 con le tabelle dei vertici, 22 tavole, file 187-208.
* [F7]: stesso progetto, "Relazione generale", 245 fogli.
* [F8]: stesso progetto, "Planimetria attrezzata con sistema di segnalamento - Ampliamento Deposito Guizza", 2020.
* [F9]: APS Holding, "La linea SIR 1 a Padova - Le caratteristiche della linea e del veicolo", convegno SIDT, 11 maggio
  2007.
* [F11]: NTL, "Transport systems comparison trams on tires / trams on rails", 2013.
* [F13]: Alstom, comunicato del 23 settembre 2022 sui 26 Translohr per Padova, note 3-5.
* [F14]: Comune di Padova, MobilityInChain, Erregi, Viappiani, "Progetto di Fattibilità Tecnico-Economica della Linea
  SIR 2 - Relazione tecnica", 28 dicembre 2020.
* [F15]: Sinergo per PMV, "Relazione tecnico-illustrativa" della tramvia Ponte della Libertà - San Basilio (Venezia),
  2014.
* [F16]: J. Bueno Estévez, "Tranvía de Medellín", Revista de Obras Públicas n. 3572, gennaio 2016.
* [F19]: S.D.A. Progetti, sistema tranviario fiorentino, linea 3.2, "Relazione tecnica sistemazioni urbanistiche",
  luglio 2024.

Non lette: il testo delle norme UNI 7156 (citata da [F1]) e UNI 7836 (a pagamento); documenti di progetto del SIR1 e
del deposito della Guizza originale; guide di tracciato tedesche (BOStrab) e francesi (STRMTG); progetti con raggi e
interassi per Clermont-Ferrand, Parigi T5/T6, Shanghai e Tianjin.

[F1]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/186_NP00_00_D_Z1_RH_IF0000_001_A.pdf
[F2]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/010_NP00_00_D_Z1_KT_SF0000_002_A.pdf
[F4]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/516_NP00_00_D_Z1_WZ_SF0000_003_A.pdf
[F5]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/
[F6]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/
[F7]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/002_NP0000D13RGMD0000001B.pdf
[F8]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/670_NP0000D16PXIS0000002A-1.pdf
[F9]: https://www.cifi.it/UplDocumenti/Convegno%20SIDT%2011_05_07/05%20-%20Conte%20Translhors%20Padova.pdf
[F11]: https://simplonpc.co.uk/Tram_Venice_Actv/Avantages-compares-TL-tramway-GB_2013.pdf
[F13]: https://www.alstom.com/fr/press-releases-news/2022/9/alstom-fournira-26-nouveaux-tramways-sur-pneus-translohr-lagglomeration
[F14]: https://www.comune.padova.it/materiali-sir-2/PD1_All.6_ProgettoFattibilita_R.00.5.0.0_signed.pdf
[F15]: https://politicheambientali.cittametropolitana.ve.it/sites/default/files/relazione_tenico_illustrativa.pdf
[F16]: https://quickclick.es/rop/pdf/publico/2016/2016_enero_3572_09.pdf
[F19]: https://mobilita.comune.fi.it/export/sites/mobilita/materiali/15_08_02_00_01_3217IX10058PE_0B.pdf
