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
7. **Eccezioni scritte.** Dove un vincolo vero obbliga a uscire dalla regola (il piazzale della stazione e i suoi
   raccordi, le curve che OSM disegna sotto il raggio minimo, la curva sud-ovest del deposito di Voltabarozzo),
   l'eccezione ha una zona e il suo perché in `ECCEZIONI` di `scripts/binari_tram.py` e nella sezione 4. Il controllo la
   elenca a parte.

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

* Pendenza massima in linea usata nel SIR3: **6%**, su un dosso a Voltabarozzo, all'incrocio tra via Michiel e via
  Mocenigo, poco prima della fermata Nani (pk 4+702). Sul binario A (stazione-Voltabarozzo, il «pari» della relazione)
  sale al 5% dalla pk 4+577 alla 4+604 e scende al 6% fino alla 4+634; sul binario B (il «dispari») fa lo stesso tra
  le pk 4+584, 4+610 e 4+641. La strada di oggi ha già il dosso: terreno a 11,65 m alla pk 4+600, a 10,59 m alla 4+550 e
  a 10,15 m alla 4+650. **Confermato** [F1] fogli 5 e 40-41, [F20] tavole 11 e 24, [F6] tavola 19 (via Mocenigo alla
  pk 4+604-4+611). Nel gioco il dosso sta circa in (1980, 2980). **Inferenza**: dalle coordinate UTM dello scambio
  della pk 4+649, in [F6] tavola 19, che nel gioco sta in (2011, 3023).
* Il ponte nuovo sullo Scaricatore sta in piano a 16,9 m (±0,07%) tra le pk 4+129 e 4+217, tra Lungargine Terranegra e
  Lungargine Sabbionari. Le rampe salgono al 5,13% venendo dalla stazione (5,14% sul binario B) e scendono al 4,89%
  verso Voltabarozzo, con raccordi di 1500 m. **Confermato** [F20] tavole 10-11 e 23-24, [F21].
* Nel SIR2 la pendenza più forte è il 4,8%; sul cavalcavia San Marco le rampe sono del 2,85% e del 4,26%.
  **Confermato** [F14] p. 15 (4,8%) e p. 26 (San Marco).
* In fermata, nelle rotaie di manovra e ai capolinea al massimo **4%**, in fermata preferibilmente il 2%.
  **Confermato** [F1] foglio 39.
* Raccordi verticali: la stessa relazione dà 350 m (tabella), «non minore di 500 m … vincolante» (testo) e come minimi
  350 m nelle conche sui binari in uso, 200 m su quelli non in uso (deposito, rotaia deviata), 120 m sui dossi.
  **Confermato** [F1] fogli 6, 39, 40. La regola prende i minimi: 350, 200 e 120 m.
* Il progetto scende sotto i 350 m in un punto solo, il dosso del 6% di via Mocenigo: 200 m in cima e 250 m nelle due
  conche ai piedi. È l'eccezione «escluso incrocio via Michiel / via Mocenigo» della tabella dei dati. **Confermato**
  [F1] foglio 6, [F20] (sulle altre tavole i raccordi hanno almeno 350 m).

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

## 3. Come si rifanno i binari (#69 per le linee, #70 per i depositi)

I binari delle tre linee li rifà `scripts/binari_regola.py` (numpy), chiamato da `scripts/tram_linee.py` per SIR3 e
SIR2 e da `scripts/build_map.py` per il SIR1, in quest'ordine: una linea che corre sui binari di una già rifatta li
prende com'erano. Per ogni linea:

1. **la traccia**: il percorso di ogni verso sui binari OSM (way dopo way, come già per SIR2 e SIR3; il SIR1 dal 12
   novembre segue anche lui i binari OSM, con lo shape GTFS solo per i punti di passaggio, un punto ogni 120 m sul
   binario a destra dello shape, e per i capi dei tronchi, dove lo shape fa l'inversione), con il piazzale della
   stazione già sugli anelli di `scripts/tram_stazione.py`; ricampionata ogni 0,5 m;
2. **i tratti fissi**: gli anelli della stazione e le S tra i due anelli (uguali per tutte le linee:
   `tram_stazione.su_anelli`), e i tratti dove la linea corre sui binari di un'altra già rifatta (il SIR2 sul SIR3
   verso Pace, il SIR1 sul SIR2 in Corso Garibaldi e Corso del Popolo). Dove le linee si separano il tratto comune
   finisce 15 m prima (`STACCO`), così la curva comincia in tempo;
3. **il doppio binario**: dove i due versi corrono in controsenso tra 1,5 e 6,5 m (`DOPPIO`), l'asse a metà tra i due
   binari OSM; l'interasse è costante a tratti: quello della linea (3,00 m, 3,50 m per il SIR2, 3,00 m sui binari del
   SIR1) dove sta entro `DELTA` (1,2 m) dall'interasse di OSM, altrimenti il valore a 10 cm più vicino a quello della
   linea che ci sta; mai sotto il minimo delle fasce d'ingombro per il raggio del binario interno; un tratto con un
   interasse diverso dura almeno 70 m (`PIANO`), e tra due tratti c'è una S di 40 m (`TRANS`). L'asse si raccorda (sotto)
   e i due binari sono l'asse più e meno mezzo interasse: l'interasse è quello, punto per punto. Ai capi del tratto,
   dove i binari di OSM si allontanano di più di 0,6 m dall'interasse (`CAPO`), il doppio binario finisce;
4. **il raccordo** di ogni binario: un problema ai minimi quadrati sui punti ogni 0,5 m, vicino alla traccia (il punto
   più vicino), con la terza differenza piccola (la curvatura cambia piano, come in una clotoide: `L3` = 9 m) e, dove la
   curvatura supera 1/12 m (`R_FIT`, 1,5 m di margine sul minimo), un vincolo che la riporta sotto. Si ripete finché
   nessun punto è oltre il raggio o oltre 0,8 m dalla traccia (`TOLL`). Dove la curva non ci sta, prima si accorcia il
   tratto fisso del doppio binario lì vicino, poi la traccia cede: è il caso delle curve che OSM disegna sotto i 12 m;
5. **i punti scritti** densi nelle curve e radi sui rettilinei (semplificati a 2 mm), in lat/lon a 8 decimali per SIR2
   e SIR3 e in x, z al millimetro per il SIR1: il gioco li prende come sono.

Con i dati secondo la regola (`tramRegola` nella mappa, `regola` in `data/tram-linee-nuove.json`) il gioco spegne i suoi
ritocchi: niente `smoothTrack`, `clearOfBuildings` e tronchi allungati in `src/data/padova.js`, niente `smoothLane` in
`TramTrack`, che prende i vertici dei dati (e un punto ogni 3 m sui rettilinei); i tratti in comune tra le linee
(`snapShared`) sono solo quelli che coincidono entro 5 cm. La S degli scambi ai capolinea è fatta di due archi uguali,
con raggio almeno 12 m (`R_COMUNICAZIONE` in `tram.js`): una comunicazione di OSM più corta si allunga dalle due parti
(tra binari a 3 m le servono 11 m).

Restano lontani dalla regola, nel gioco: l'interasse disegnato (le corsie rosse sono larghe 3,4 m, `TRAM.lane`, e dove i
binari stanno a 3 m si sovrappongono) e il raccordo di 20 m dei bivi tra le linee (`SWITCH_LEN`, che con i dati
secondo la regola non sposta più niente).

### Nei depositi (#70)

I depositi della Guizza e di Voltabarozzo sono rifatti così da `scripts/tram_depositi.py`, con la geometria di
`scripts/tram_stesura.py` (solo libreria standard):

* **un binario** (`stendi`): la traccia OSM semplificata (Douglas-Peucker a 0,2 m) dà le tangenti; le svolte dello
  stesso verso troppo vicine per avere ognuna la sua curva diventano una sola all'incrocio delle tangenti esterne, se la
  curva unita resta entro 0,9 m dalla traccia (una curva che OSM disegna con tanti punti diventa un arco solo); dove no,
  e oltre 150°, restano due curve che si toccano senza clotoide in mezzo. Due svolte opposte troppo vicine si
  allontanano lungo le tangenti esterne. A ogni svolta clotoide, arco, clotoide (6 m sotto R 12, 8 m sotto R 16, poi
  10 m; niente sopra R 400): il raggio è il più grande che resta entro 0,3 m dalla traccia e ci sta tra le curve vicine,
  mai sotto 10,7 m (10,5 m più un margine perché i punti arrotondati al centimetro non lo portino sotto il minimo) e con
  la curva lunga almeno 5,5 m. Rettilinei coi soli capi, curve un punto al metro;
* **i binari continui**: a ogni nodo i rami che proseguono dritti (prima la coppia più dritta) fanno un binario, steso
  da solo; si stendono prima quelli su cui si attaccano gli altri, in due passate (nella prima, dove c'è un giro, il
  binario che porta lo scambio è quello di OSM);
* **gli scambi**: il ramo deviato parte tangente al binario che lo porta. OSM mette lo scambio nel vertice dove la way
  deviata parte già girata di 5-17°: la punta arretra lungo il binario quanto serve perché la curva resti centrata sulla
  svolta di OSM, non oltre il nodo prima (a metà strada se anche quello è uno scambio) né fuori dal rettilineo. Se
  la curva con la clotoide non ci sta, parte dalla punta senza, con l'arco, come il ramo deviato dello scambio a cerniera;
* **due binari che si toccano** in un nodo con quattro capi (alla Guizza gli anelli in alto e in basso) restano
  tangenti lì;
* **nel gioco** `TramYard` prende i punti come sono; alle porte, dove il binario della linea del gioco non sta
  esattamente sulla way, un raccordo di Hermite di 15 m dal binario della linea (posizione e direzione) al ramo del
  deposito.

## 4. Il controllo

`scripts/binari_tram.py` misura una rete di binari contro la regola, per linea (SIR1, SIR2, SIR3) e per deposito
(Guizza, Voltabarozzo). Solo libreria standard di Python. Le reti sono due:

* **i dati**, quello che scrivono gli script: il SIR1 in `src/data/padova-map.json`, SIR2 e SIR3 in
  `data/tram-linee-nuove.json`, i depositi di `data/tram-depositi.json`. Le comunicazioni dei capolinea nei dati sono i
  loro due capi: la S la disegna il gioco, e si misura lì. Li misura `scripts/verifica_mappa.py`, con le soglie in
  `SOGLIE_BINARI`;
* **il gioco**, i binari come li disegna: `TramTrack.paths` (con i bivi tra le linee), le S degli scambi ai capolinea
  come le percorre il tram (con 10 m di binario prima e dopo: contano i casi nei 5 m vicino alla S, gli altri sono
  della linea e lì le finestre tagliate dal capo vedono spigoli che non ci sono), le quote (`TramTrack.h`), i rami e i
  nodi di `TramYard`. Li misura `tests/binari-tram.spec.js`, che li scrive in un file e chiama lo script con `--gioco`;
  le soglie sono nella prova.

```bash
python3 scripts/binari_tram.py --elenco                       # i dati, con i punti peggiori
python3 scripts/verifica_mappa.py --elenco                    # i dati, dentro il rapporto della mappa (serve shapely)
npx playwright test tests/binari-tram.spec.js                 # il gioco
python3 scripts/binari_tram.py --gioco test-results/binari-tram-binari-del-tram-secondo-la-regola/binari-gioco.json --elenco
```

Cosa conta (i binari ricampionati ogni metro; un caso è un tratto, con il punto peggiore):

* **spigoli**: la direzione cambia di almeno **2°** tra due corde di 2 m, e lì si concentra almeno metà della svolta
  fatta tra due corde di 10 m. Una curva distribuisce la svolta (in 4 m ne fa un quinto di quella in 20 m), uno
  spigolo no. Un arco disegnato con punti più radi di 4-5 m conta come una fila di spigoli. Per le linee e le
  comunicazioni la svolta in 20 m è la netta o, se è di più, metà di quella in valore assoluto: in una S (una
  comunicazione, un binario che si scosta) la svolta netta è quasi nulla e ogni curva sembrava uno spigolo; per uno
  spigolo vero o un arco a poligono non cambia niente. Nei depositi la misura è un'altra (sotto);
* **raggi sotto il minimo**: raggio sotto 10,5 m, misurato con due corde di 3 m attorno al punto (il passo dei binari
  del gioco). I tratti sotto il minimo a meno di 10 m l'uno dall'altro sono una curva sola;
* **interassi fuori misura**: dove i due binari di una linea corrono nella stessa sede (entro 6 m, in controsenso, e
  non sullo stesso binario, come un tronco al capolinea, né nei 15 m dello scambio dove i due versi diventano un
  binario solo, come a Busa di Vigonza), più vicini del minimo delle fasce d'ingombro per il raggio più stretto entro
  10 m; oppure un interasse che va e viene: nei 30 m attorno al punto la strada fatta
  dall'interasse, tolto il cambio netto, supera 0,3 m. Un interasse costante o che passa da un valore a un altro senza
  tornare indietro va bene. Nel deposito: binari paralleli più vicini del minimo, a più di 15 m dai nodi;
* **scarti da OSM**: tratti a più di 1 m dal binario OSM più vicino e parallelo (entro 15 m: più lontano non c'è un
  binario OSM e il tratto è disegnato dal gioco, come le S dei capolinea);
* **pendenze** (solo nel gioco, l'unico con le quote): sopra il 6% su 10 m.

Nei depositi il controllo misura ogni ramo del grafo (tra due nodi, come `TramYard`) insieme ai 10 m di binario che lo
continuano oltre ogni capo: ogni uscita al primo nodo (entro 45°), poi sempre la più dritta; alle porte il binario della
linea. Contano i casi sul ramo; quelli a meno di 3 m da un nodo sono gli scambi dell'elenco. Così una curva che comincia
a un nodo (lo scambio a cerniera parte con l'arco) o una way spezzata a metà curva non si misurano su una finestra
tagliata, dove sembrerebbero spigoli. E nei depositi la svolta tra le corde di 10 m è la più grande tra le finestre
spostate fino a 5 m: in una S (il ramo deviato che gira al contrario del binario da cui parte, due scambi a punta contro
punta) le due curve si annullano tra le corde lunghe e la svolta in 4 m sembrerebbe concentrata; una delle finestre
vicine vede una curva intera, mentre uno spigolo o uno zig-zag restano spigoli. Ogni caso ha il posto (coordinate del gioco, via e fermata più vicine) e un peso: gradi diviso 2 per gli spigoli, 10,5 diviso il raggio, 1 più i metri sotto il
minimo diviso 0,3 per gli interassi stretti, l'oscillazione diviso 0,3 m, metri da OSM, pendenza diviso 6%. L'elenco
dei punti peggiori va per peso.

Eccezioni (`ECCEZIONI`), elencate a parte con il loro perché:

* il **piazzale della stazione**, per gli scarti da OSM: i binari lì vengono dal rendering del progetto del piazzale,
  anelli regolari e raccordi morbidi al posto dei binari OSM, che fanno S e si incrociano;
* i **raccordi del piazzale**, per gli interassi, fino a 20 m oltre la zona del piazzale (`RACCORDI`, i raccordi di
  `tram_stazione.py` verso le vie): i due versi di una linea vanno e vengono da anelli e raccordi diversi e si
  incrociano con le altre linee, non sono un doppio binario;
* le **curve di OSM sotto il raggio minimo**, per scarti da OSM e interassi, a meno di 25 m da un vertice OSM dove la
  circonferenza per lui e i due vertici accanto (a meno di 15 m) ha raggio sotto 12 m (`CURVA_OSM_R`: 10,5 m del veicolo
  più il margine dei binari rifatti): il binario non può seguire OSM, e l'interasse con l'altro binario, che la segue,
  cambia. OSM taglia gli angoli; il progetto del SIR3 ha in quei punti raggi da 10,5 a 20 m (Via Carlo Zeno e Via
  Piovese, il tornante del SIR1 a Bassanello, la curva di Viale della Pace);
* la **curva sud-ovest del deposito di Voltabarozzo** (2334, 3690), per gli scarti da OSM. OSM (il cantiere, way
  1453989055) disegna la curva del binario interno dell'anello con un raggio di 6,4 m, sotto il minimo del Translohr:
  col raggio minimo il binario passa fino a 1,2 m più all'interno dell'anello. Nella foto aerea la curva della
  massicciata è ancora più larga.

Non si contano ancora: le clotoidi, gli scambi in curva o vicini agli incroci, la lunghezza delle comunicazioni, le
pendenze in fermata e i raccordi verticali.

Le soglie sono 0, tranne le pendenze delle linee nel gioco (le rampe dei cavalcavia, #74): se un numero scende, si
abbassa la soglia nello stesso commit, come per il resto del rapporto della mappa.

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

### Dopo #69 e #70 (12 novembre, sera)

Le linee e i depositi rifatti con la regola (sezione 3), dati / gioco:

| | spigoli | raggi | interassi | scarti da OSM | pendenze | nelle eccezioni |
|---|---|---|---|---|---|---|
| SIR1 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | – / 4 | 4 / 4 |
| SIR3 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | – / 0 | 7 / 7 |
| SIR2 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | – / 14 | 7 / 7 |
| Guizza | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | – / 0 | |
| Voltabarozzo | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | – / 0 | 1 / 1 |

* **Nelle eccezioni**: 3 scarti nel piazzale della stazione (fino a 3,5 m, il SIR2 verso il Cavalcavia Borgomagno); 5
  interassi nei raccordi del piazzale (a ovest verso il Cavalcavia Borgomagno e Corso del Popolo, a est verso Pace, dove
  i binari verso la stazione girano nel raccordo e quelli verso Pace proseguono); 10 casi accanto alle curve che OSM disegna sotto i 12 m: Via Carlo Zeno e Via Piovese
  (SIR3, fino a 3,5 m da OSM, dove OSM fa una S da 6 m di raggio), Via Luigi Anelli (SIR2, fino a 3,2 m, la curva
  attorno all'aiuola: il binario rifatto resta sull'asfalto), il tornante del SIR1 verso nord a Bassanello (interasse),
  la curva di Viale della Pace (SIR2 e SIR3, 1,1 m), la curva del SIR3 da Via Tommaseo verso sud a Pace (1,2 m).
* **Punti peggiori di prima**: in Corso Vittorio Emanuele i due binari del SIR1 stanno a 3 m (lo shape GTFS saltava
  sull'altro binario dalla comunicazione: il SIR1 ora segue i binari OSM); ai capolinea di Rubano, della Guizza e di
  Pontevigodarzere niente spigoli, e la S degli scambi ai capolinea è di due archi da almeno 12 m.
* **Pendenze**: le rampe dei cavalcavia, come prima (#74).
* **Depositi**: rifatti da #70 (sezione 3), a 0 anche con i binari delle linee rifatti, ai quali le porte si
  raccordano; nelle eccezioni la curva sud-ovest di Voltabarozzo.

### Punti peggiori delle linee (prima di #69)

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

### Depositi (#70)

Erano questi i punti peggiori, sulle way OSM com'erano:

* **Voltabarozzo**: spigolo di 27° e curve da 6,4-6,6 m nel binario a nord-ovest (2334, 3695), (2355, 3697) e
  (2330, 3690); scambi con spigoli di 17,5° (2356, 3674) e 13,6° (2358, 3688); spigolo di 16,6° sul binario che entra
  da sud (2378, 3659).
* **Guizza**: spigolo di 17,5° all'ingresso del ventaglio est (-125, 4444); il ventaglio tra (-151, 4436) e (-194,
  4485), quello della foto di #67, con spigoli di 14-14,6° a ogni scambio e un raggio di 9,6 m (-153, 4448).

Con la misura dei depositi della sezione 4 le way OSM davano, dati / gioco: Guizza 5 / 5 spigoli e 5 / 5 raggi,
Voltabarozzo 4 / 5 spigoli e 4 / 4 raggi. Rifatti come nella sezione 3 sono a 0 in tutto, dati e gioco; resta nelle
eccezioni la curva sud-ovest di Voltabarozzo (1,2 m da OSM).

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
  SIR 2 - Relazione tecnica", 28 dicembre 2020. Le pagine sono quelle stampate: nel PDF due in più.
* [F15]: Sinergo per PMV, "Relazione tecnico-illustrativa" della tramvia Ponte della Libertà - San Basilio (Venezia),
  2014.
* [F16]: J. Bueno Estévez, "Tranvía de Medellín", Revista de Obras Públicas n. 3572, gennaio 2016.
* [F19]: S.D.A. Progetti, sistema tranviario fiorentino, linea 3.2, "Relazione tecnica sistemazioni urbanistiche",
  luglio 2024.
* [F20]: progetto del SIR3 come [F1], "Profilo longitudinale" 1:1000/1:100, 26 tavole (binario A tavole 1-13,
  binario B 14-26), rev. B, settembre 2020, file 209-234.
* [F21]: progetto del SIR3 come [F1], "Inserimento urbano - Ponte sul canale Scaricatore - Sezione longitudinale",
  NP00 00 D Z1 QC IF0000 004, novembre 2020, file 378.

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
[F20]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/
[F21]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/378_NP00_00_D_Z1_QC_IF0000_004_A.pdf
