# Nuove linee del tram: SIR3 e SIR2 (ricerca e prova dei tracciati)

Ricerca sperimentale per portare nel gioco le linee in costruzione. Stato al 9 novembre 2026. **Il gioco e la
pipeline della mappa non sono cambiati**: qui ci sono le fonti, una prova di instradamento sui binari OSM
(`scripts/tram_percorsi.py`, fuori da `build_map.py`) e il piano. Un'altra sessione lavora alla mappa: le tappe del
piano sono ordinate per toccare il meno possibile `build_map.py`, `street_surfaces.py` e `city.js`.

![Binari OSM (blu SIR1, rosso SIR2, arancio SIR3; tratteggio: in cantiere), percorsi trovati e fermate OSM](img/linee-tram-nuove.png)

## Fonti

Lette direttamente il 9 novembre 2026:

* **trampadova.it**, il sito del Comune per il tram (via la sua API WordPress): pagine delle linee, FAQ sul percorso
  del SIR3, notizie dei cantieri e le **mappe KML** delle due linee
  (`https://www.trampadova.it/wp-content/themes/hello-theme-child-master/assets/SIR3.kml`, `SIR2.kml`).
* **Presentazione "Cantieri SIR2 e SIR3"** di APS Holding e Comune di Padova, 2 dicembre 2025, sul sito del MIT:
  https://www.mit.gov.it/nfsmitgov/files/media/notizia/2025-12/01%20Presentazione%20Sistema%20SMART%20-%20Galiazzo.pdf
  (schede delle linee, schema della rete SMART con i nomi delle fermate, mappa dei cantieri a novembre 2025).
* **OpenStreetMap**, export Overpass del 9 novembre 2026 con
  [`scripts/overpass-tram-cantiere.ql`](../scripts/overpass-tram-cantiere.ql), salvato in
  [`data/osm-padova-tram-cantiere.json`](../data/osm-padova-tram-cantiere.json).
* **Wikipedia** "Tranvia di Padova" e "Trams in Padua".
* Indicazione di chi gestisce il progetto: **il SIR2 prenderà il posto della linea di autobus 10** e avrà **convogli
  da 4 casse**.

Le fermate dei KML e quelle di OSM, in ordine lungo i percorsi, sono in
[`data/tram-fermate-nuove.json`](../data/tram-fermate-nuove.json).

### SIR3 Stazione – Voltabarozzo

* **Dati del progetto** (trampadova.it, 22 marzo 2023): 5,496 km, **13 fermate** a 450 m in media, 3 sottostazioni
  elettriche, **7 convogli da 25 m a 3 casse**, **18 minuti** di percorrenza, 18 km/h di velocità commerciale.
  Presentazione di dicembre 2025: operativa dal 2026, 7 veicoli, **un tram ogni 8 minuti**, 12 fermate (senza contare
  la stazione).
* **Mezzi**: 5 tram a 3 casse sono arrivati al deposito di Voltabarozzo nel 2025 (trampadova.it, 29 gennaio 2025);
  tutti i mezzi nuovi successivi sono a 4 casse e il progetto del SIR3 è stato adattato ai mezzi più lunghi. All'avvio
  il SIR3 va quindi a **3 moduli** (come il SIR1), con banchine pronte per 4.
* **Fermate** (KML): Stazione sud, Pace, Gozzi, Morgagni, Ospedale, Sografi, Forcellini, Gregorianum, Parco Iris,
  Cornaro, Nani, Piovese, Capolinea Voltabarozzo. Nello schema SMART Ospedale si chiama "Ospedale Civile",
  Gregorianum "Sant'Antonio" e il capolinea "Voltabarozzo".
* **Percorso** (FAQ di trampadova.it): stazione, via Gozzi, ponte Omizzolo, via Morgagni, via Giustiniani, via
  Sografi, passeggiata Bianchini, liceo Cornaro, nuovo ponte sullo Scaricatore, Voltabarozzo. Al parcheggio tra via
  Nani e via Michiel si divide: **verso il capolinea per via Giardinetto e via Zeno, verso il centro per via
  Piovese**; i due rami si riuniscono alla rotonda tra via Balestra, via Zeno e via Piovese. Capolinea a destra poco
  prima della tangenziale, con il **deposito di Voltabarozzo** (via Piovese).
* **Stato**: piattaforma finita a marzo 2026; prime prove dalla stazione il 4 maggio 2026; primo viaggio fino alla
  stazione il 5 giugno; posa dei cavi e linea aerea a luglio; obiettivo PNRR certificato il 2 agosto (6,3 km di linea
  e il deposito); da settembre asfaltature e finiture. Obiettivo dichiarato: **servizio entro la fine del 2026**.

### SIR2 Rubano – Busa di Vigonza

* **Dati** (presentazione di dicembre 2025): operativa dal 2027, circa 17,5 km, 26 veicoli, 37 fermate, **un tram
  ogni 6-8 minuti**. Capolinea intermedi sui rami: **Romagnoli** (Chiesanuova) e **Ospedale San Lazzaro** (dopo Net
  Center). Mezzi a **4 casse** (il mezzo n. 31 della flotta SMART, a 4 casse, è arrivato a Rubano il 23 giugno 2026).
* **Sostituisce la linea 10** (Sarmeola/Caselle – Stazione – Ponte di Brenta), che nel gioco c'è già.
* **Percorso**: Rubano, Sarmeola, via Chiesanuova, Cimitero Maggiore, via Vicenza, corso Milano, via Dante, Corso
  Garibaldi, Eremitani, stazione, Pace, via Tommaseo (Fiera, Università), Stanga, via Venezia, via San Marco, Ponte di
  Brenta, Busa di Vigonza.
* **Fermate**: il KML del sito ha un elenco vecchio ("le fermate e le denominazioni saranno definite in base al
  progetto esecutivo": Verdi e Insurrezione al posto delle attuali). L'elenco in OSM corrisponde allo schema SMART:
  Rubano, Municipio Rubano, Quartiere Europa, Z.I. Rubano, Quartiere Fatima, Via Borromeo, Sarmeola, Brentella,
  Brentella Est, Chiesanuova, Pierobon, Cimitero Maggiore, Via Vicenza, Savonarola, Via S. Pietro, Via Dante,
  Garibaldi, Eremitani, (De Gasperi, Stazione), Pace, Tribunale/Fiera, Università, Stanga, Anelli, Venezia, Savelli,
  Net Center, Palasport S. Lazzaro, San Marco, Ippodromo, Dante di Nanni, Ponte di Brenta, Villa Breda, Busa di
  Vigonza. I nomi dello schema SMART a volte sono diversi (Via S. Pietro è "Milano", Stanga è "Stanga - Questura").
* **Stato**: obiettivo PNRR certificato il 2 agosto 2026 (21,3 km di piattaforma, rotaia su oltre 16 km, deposito di
  Rubano); settembre 2026: asfaltature in corso Milano e a Chiesanuova, fermata sud di via Vicenza da finire, via
  Tommaseo dalla stazione alla Stanga a seguire.

### Stazione e rete SMART

* Estate 2025: nel piazzale della stazione è stato costruito l'**anello ad alta capacità** per tutte le linee SMART (un
  tram ogni 4 minuti). Alla fine i binari formeranno **due quasi-ovali concentrici, uno interno e uno esterno**,
  percorsi in senso antiorario (verso ovest sul lato nord, verso est sul lato sud). **Oggi il SIR1 usa quello
  esterno.** Le due fermate nuove, **Stazione nord** e **Stazione sud**, stanno sui due lati lunghi del piazzale e
  servono entrambi gli anelli (disegno del progetto con le due fermate sui binari affiancati). Mancano ancora la
  linea aerea nell'anello e le fermate stesse, che in OSM non ci sono.
* In OSM l'anello esterno è la way 966705982 (`oneway=yes`, SIR1); l'interno è mappato come `service=siding`, senza
  senso unico, con raccordi corti. **Senza l'anello esterno nessuna delle quattro prove riesce**: l'anello interno in
  OSM non è collegato in modo percorribile alle uscite verso Pace e Corso del Popolo. Per il gioco la geometria della
  stazione va disegnata dal progetto (o aspettata in OSM), con la scelta dell'anello per ogni linea.
* La fermata **Trieste** del SIR1 è chiusa da settembre 2025: la sostituisce **De Gasperi**, a pochi metri, adatta ai
  tram più lunghi del SIR2. Neanche De Gasperi è in OSM.
* Lo schema SMART di dicembre 2025 prevede linee passanti che combinano i binari di SIR1, SIR2 e SIR3 (T1 Pontevigodarzere
  – Guizza, T2 Rubano – Vigonza, T4 Rubano – Legnaro, T6 Ospedale San Lazzaro – Legnaro, T7 Pontevigodarzere – Legnaro,
  T11 Vigonza – Guizza, T12 Ospedale San Lazzaro – Guizza, T21 Romagnoli – Ospedale San Lazzaro, T22 Romagnoli –
  Vigonza), con prolungamenti a Legnaro e oltre Vigonza. Per il gioco bastano per ora SIR2 e SIR3 come linee proprie;
  il grafo dei binari (piano, tappa 2) deve però permettere queste combinazioni.

## Cosa c'è nei dati

**GTFS.** Il feed Busitalia (BusOne, valido dal 4 novembre al 3 dicembre 2026) ha solo `TPD_SIR1`: niente tracciati,
fermate né orari per SIR2 e SIR3. Gli orari vanno generati dalla frequenza.

**OSM** (`data/osm-padova-tram-cantiere.json`):

| | Binari `railway=tram` | In cantiere | Fermate (`railway=tram_stop`) |
|---|---|---|---|
| SIR3 | circa 10,6 km (doppio binario, deposito) | – | 12 nomi, una per verso, sul binario; manca la stazione |
| SIR2 | circa 30,7 km (doppio binario da Rubano alla Busa di Vigonza) | 2,8 km: i rami di Romagnoli e Ospedale San Lazzaro | 33 nomi, una per verso, sul binario; mancano De Gasperi e la stazione |

Nessuna relazione `route=tram` per SIR2 e SIR3 (solo per il SIR1). I nomi delle way non sono uniformi ("SIR 3",
"SIR3", "Linea SIR3", "SIR 2 Rubano-Vigonza") e non hanno `ref`. L'export che usa oggi il gioco
(`data/osm-padova-tram.json`, 5 novembre) prende solo un riquadro attorno al centro e solo `railway=tram`.

## Prova di instradamento

`scripts/tram_percorsi.py` costruisce il grafo dei binari OSM, anche quelli in cantiere (sensi unici rispettati,
niente curve oltre 60° ai nodi), e cerca il percorso più corto che tocca le fermate del KML in ordine. Ogni fermata
del KML si aggancia alle fermate OSM con lo stesso nome (una per verso, quindi il percorso sceglie il binario giusto);
dove i binari corrono affiancati vale la marcia a destra (il binario contromano costa il triplo). Le fermate OSM che
cadono sul percorso diventano l'elenco della linea.

```bash
python3 scripts/tram_percorsi.py data/osm-padova-tram-cantiere.json SIR3.kml SIR3 "Stazione sud" "Capolinea Voltabarozzo" sir3-andata.json
python3 scripts/tram_percorsi.py data/osm-padova-tram-cantiere.json SIR3.kml SIR3 "Capolinea Voltabarozzo" "Stazione sud" sir3-ritorno.json
python3 scripts/tram_percorsi.py data/osm-padova-tram-cantiere.json SIR2.kml SIR2 "Capolinea Rubano" "Busa Di Vigonza" sir2-est.json
python3 scripts/tram_percorsi.py data/osm-padova-tram-cantiere.json SIR2.kml SIR2 "Busa Di Vigonza" "Capolinea Rubano" sir2-ovest.json
```

| Prova | Lunghezza | Contromano | Fermate OSM sul percorso |
|---|---|---|---|
| SIR3 Stazione → Voltabarozzo | 5350 m | 10 m | 11 (il percorso finisce al punto del KML, poco prima della fermata del capolinea) |
| SIR3 Voltabarozzo → Stazione | 5569 m | 25 m | 12 |
| SIR2 Rubano → Busa di Vigonza | 16 276 m | 45 m | 33 |
| SIR2 Busa di Vigonza → Rubano | 16 660 m | 58 m | 33 |

* Le lunghezze tornano: 5,5 km per il SIR3; per il SIR2 16,3-16,7 km sulla linea principale, contro i 17,5 km
  dichiarati con i rami. I pochi metri contromano sono scambi e incroci.
* Il SIR3 segue i due rami di Voltabarozzo come dice la FAQ (Giardinetto/Zeno all'andata, Piovese al ritorno).
* Il SIR2 tra Garibaldi e la stazione usa i binari del SIR1 (Corso Garibaldi, Corso del Popolo) e passa dall'anello.
* Con l'export del 5 novembre (solo il centro) il SIR2 era coperto da Brentella a Savelli e andava contromano per
  2,4 km da Pace alla Stanga; con quello del 9 novembre lo scambio di Pace c'è e la linea è completa.
* Correzioni a mano rimaste: la fermata Pace del KML del SIR3 è oltre il bivio, sui binari del SIR2 (lo script usa la
  Pace OSM sul tratto comune); le fermate della stazione si agganciano per posizione, perché in OSM non ci sono.
* In stazione tutte e quattro le prove passano dall'**anello esterno**, l'unico percorribile in OSM: il tratto della
  stazione è quindi provvisorio finché non c'è la geometria dei due anelli (vedi sopra).

**Area di gioco.** Dentro la rete stradale del gioco ci sono le fermate del SIR3 da Pace a Cornaro (Gregorianum e Parco
Iris sono sulla passeggiata Bianchini, senza strade attorno ma dentro il riquadro `FOCUS`); Nani, Piovese, il
capolinea e il deposito sono fuori, a sud-est. Del SIR2 ci sono le fermate da Cimitero Maggiore a Savelli; Rubano e
Chiesanuova a ovest, Net Center, San Lazzaro, Ponte di Brenta e Vigonza a est sono fuori. L'export OSM delle strade
`data/osm-padova.json` arriva fin là (lat 45,32–45,67, lon 11,69–11,99): allargare l'area è una scelta dei riquadri
`FOCUS` di `build_map.py`, non dei dati.

## Dati delle linee (tappa 1)

`scripts/tram_linee.py` scrive [`data/tram-linee-nuove.json`](../data/tram-linee-nuove.json): per linea (colore dei KML
del Comune, moduli, frequenza) e per verso il percorso sui binari OSM (lat/lon, con 90-160 m di binario prima della
prima fermata e dopo l'ultima), le fermate in ordine con la progressiva `s` in metri, gli `offsets` in secondi e le
partenze feriali e festive `[ora, durata]` come le linee della mappa.

```bash
python3 scripts/tram_linee.py data/osm-padova-tram-cantiere.json data/tram-fermate-nuove.json data/tram-linee-nuove.json
```

* **Stazione**: SIR2 e SIR3 passano dall'anello interno, il SIR1 resta sull'esterno. In OSM l'anello interno e i quattro
  raccordi tra i due anelli ci sono e sono collegati, ma senza senso unico: lo script li percorre in senso antiorario.
  Stazione nord e Stazione sud stanno sui lati lunghi dell'anello interno, tra i raccordi (55 m di rettilineo, ci sta
  un convoglio da 4 casse). Il SIR3 arriva da Pace sul lato nord, ferma a Stazione nord, gira l'anello e finisce a
  Stazione sud, da dove riparte; il SIR2 verso est ferma a Stazione sud, verso ovest a Stazione nord e poi scende sul
  binario del SIR1 nel Corso del Popolo.
* **De Gasperi** è sul Corso del Popolo dove il KML del SIR2 aveva Trieste, un nodo per binario.
* **Orario**: SIR3 ogni 8 minuti, 18 minuti da capolinea a capolinea; SIR2 ogni 7 minuti, 54 minuti a 18 km/h
  (velocità commerciale del SIR3, quella del SIR2 non è pubblicata). Dalle 5.40 alle 7 e dalle 21 ogni 15 minuti, dalle
  20 alle 21 ogni 10; festivi ogni 15 minuti, ogni 30 dopo le 21. Sosta di 20 s a ogni fermata.

| Linea e verso | Percorso | Fermate |
|---|---|---|
| SIR3 → Voltabarozzo | 5390 m | 13, da Stazione sud a Voltabarozzo |
| SIR3 → Stazione | 5531 m | 14, da Voltabarozzo a Stazione nord e Stazione sud |
| SIR2 → Busa di Vigonza | 16 277 m | 35 |
| SIR2 → Rubano | 16 318 m | 35 |

## Piano

Prima il SIR3 (apre per primo e la parte nel gioco è quasi tutta già dentro la mappa), poi il SIR2.

1. **Dati delle linee, senza toccare la mappa.** Uno script nuovo, sulla base di `tram_percorsi.py`, scrive
   `data/tram-linee-nuove.json`: per linea e verso il percorso sui binari (lat/lon), le fermate OSM in ordine con la
   progressiva, il numero di moduli (**SIR3: 3**, **SIR2: 4**) e l'orario generato (SIR3 ogni 8 minuti e 18 minuti da
   capolinea a capolinea; SIR2 ogni 6-8 minuti, tempi tra le fermate dalla velocità commerciale). Aggiunge a mano le
   fermate che OSM non ha (Stazione nord/sud, De Gasperi). Rischio di conflitto nullo: file nuovi.
2. **Grafo dei binari nel gioco.** `TramTrack` (in `src/tram/tram.js`) oggi è un solo tracciato con due versi, costruito
   da `net.tram`. Diventa una sede per linea (`city.tramTracks[id]`), con `city.tramTrack` che resta il SIR1, così il
   resto del codice non cambia subito. Poi un grafo vero (rami e scambi) per i **due anelli della stazione** (ogni
   linea percorre il suo, il SIR1 l'esterno; le fermate Stazione nord e Stazione sud servono entrambi) e per i tratti
   comuni (SIR2 sul SIR1 tra Garibaldi e la stazione, SIR2 e SIR3 fino a Pace). Gli anelli si disegnano dal progetto
   del piazzale, perché in OSM l'interno non è collegato alle uscite. Tocca `tram.js`, `traffic.js` (TramSim),
   `main.js`, `mission.js` e la parte del tram di `city.js`. I convogli a 4 moduli (circa 32 m) sono già previsti
   da `modules` (vedi `docs/prompt-tram.md`): vanno provati sulle curve dell'anello e di via Tommaseo.
3. **Sede tranviaria nella pianta delle strade.** `build_map.py` passa a `street_surfaces.surfaces()` le corsie del
   tram: vanno aggiunte quelle di SIR3 e SIR2, e i bus non devono trovarsi la sede in corsia (verifica del CLAUDE.md).
   È la tappa che si sovrappone di più al lavoro sulla mappa: farla **dopo** che l'altra sessione ha unito il suo.
4. **Area di Voltabarozzo.** Un riquadro `FOCUS` in più (circa lon 11,885–11,912, lat 45,372–45,392) per avere strade,
   edifici e deposito fino al capolinea; vanno controllati gli altri dati (DBGT, DTM, segnaletica) su quell'area.
   Anche questa tocca `build_map.py`: dopo la tappa 3. In alternativa, in un primo tempo il SIR3 si guida fino a
   Cornaro ("tratto in città"), come già si fa per il SIR1 verso la Guizza.
5. **SIR3 nel gioco**: linea nel menu del tram (3 moduli), tram automatici dall'orario generato, fermate con banchina,
   scambio all'uscita dell'anello.
6. **SIR2 nel gioco**: il tratto da Cimitero Maggiore a Savelli (come "tratto in città"), 4 moduli, binari in comune
   col SIR1 e col SIR3. **La linea 10 esce di servizio** quando c'è il SIR2: serve uno scenario (per esempio "oggi"
   con SIR1 e linea 10, "rete SMART" con SIR1, SIR2, SIR3 e senza linea 10) oppure si toglie la 10 quando il SIR2
   entra nel gioco. I rami di Romagnoli e Ospedale San Lazzaro (ancora in cantiere in OSM) e i capolinea fuori dalla
   mappa vengono dopo.

Deciso il 9 novembre: le linee nuove vanno accanto alla rete di oggi, nello stesso elenco del SIR1 nel menu del tram,
con un'indicazione che le distingue (linea in costruzione). Niente scenario "rete SMART" per ora: la linea 10 resta
tra gli autobus.
