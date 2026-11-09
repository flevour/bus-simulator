# Nuove linee del tram: SIR3 e SIR2 (ricerca e prova dei tracciati)

Ricerca sperimentale per portare nel gioco le linee in costruzione. Stato al 9 novembre 2026. **Il gioco e la
pipeline della mappa non sono cambiati**: qui ci sono le fonti verificate, una prova di instradamento sui binari
OSM (`scripts/tram_percorsi.py`, fuori da `build_map.py`) e il piano. Un'altra sessione sta lavorando alla mappa: le
tappe del piano sono ordinate per toccare il meno possibile `build_map.py`, `street_surfaces.py` e `city.js`.

![Binari OSM (blu SIR1, rosso SIR2, arancio SIR3), fermate ufficiali e percorsi trovati](img/linee-tram-nuove.png)

## Fonti verificate

Lette direttamente il 9 novembre 2026 (il sito trampadova.it via la sua API WordPress, Wikipedia in wikitesto):

* **trampadova.it** (sito del Comune per il tram): pagine delle linee, FAQ sul percorso del SIR3, notizie dei
  cantieri e le **mappe KML ufficiali** delle due linee con tracciato e fermate
  (`https://www.trampadova.it/wp-content/themes/hello-theme-child-master/assets/SIR3.kml`, `SIR2.kml`). Le fermate
  sono copiate in [`data/tram-fermate-nuove.json`](../data/tram-fermate-nuove.json).
* **Wikipedia** "Tranvia di Padova" e "Trams in Padua".
* Non raggiungibili da qui: padovanet.it (pagina solo JavaScript), mit.gov.it (certificato TLS incompleto),
  Overpass (connessione rifiutata). Claude in Chrome non è disponibile nelle sessioni cloud.

### SIR3 Stazione – Voltabarozzo

* **13 fermate** (KML ufficiale): Stazione sud, Pace, Gozzi, Morgagni, Ospedale, Sografi, Forcellini, Gregorianum,
  Parco Iris, Cornaro, Nani, Piovese, Capolinea Voltabarozzo. Wikipedia ne conta 12, la pagina della linea 13.
* **Percorso** (FAQ di trampadova.it): stazione, via Gozzi, ponte Omizzolo, via Morgagni, via Giustiniani, via
  Sografi, passeggiata Bianchini, liceo Cornaro, nuovo ponte sullo Scaricatore, Voltabarozzo. Al parcheggio tra via
  Nani e via Michiel si divide: **verso il capolinea per via Giardinetto e via Zeno, verso il centro per via
  Piovese**; i due rami si riuniscono alla rotonda tra via Balestra, via Zeno e via Piovese. Capolinea a destra poco
  prima della tangenziale, con il **deposito di Voltabarozzo** (via Piovese).
* **Stato**: piattaforma finita a marzo 2026 (circa 6 km di linea e 12 km di piattaforma col deposito); prime prove
  dalla stazione il 4 maggio 2026, primo viaggio fino alla stazione il 5 giugno 2026; obiettivo PNRR certificato il 2
  agosto 2026 (6,3 km di linea e il deposito); da settembre 2026 asfaltature e finiture (via Falloppio, via
  Giustiniani, Largo Meneghetti, via Gozzi, stazione). Obiettivo dichiarato: **servizio entro la fine del 2026**.
* **Mezzi**: Translohr come il SIR1, batterie LTO; 5 tram nel deposito di Voltabarozzo (giugno 2026).

### SIR2 Rubano – Busa di Vigonza

* **36 fermate** nel KML (con l'avviso "le fermate e le denominazioni saranno definite in base al progetto
  esecutivo"), capolinea intermedi Caserma Romagnoli e Nuovo Ospedale San Lazzaro. Wikipedia: 18,25 km e 34 fermate;
  la pagina della linea: 17,5 km e 36 fermate.
* **Percorso** (Wikipedia): Sarmeola, via della Provvidenza, via Chiesanuova, corso Milano, Corso del Popolo,
  stazione, via Tommaseo (Fiera, Università), Stanga, via Venezia, via San Marco, Ponte di Brenta, Busa di Vigonza.
* **Stato**: obiettivo PNRR certificato il 2 agosto 2026: 21,3 km di piattaforma, rotaia posata su oltre 16 km,
  deposito di Rubano. Settembre 2026: asfaltature in corso Milano e a Chiesanuova, fermata sud di via Vicenza da
  finire, via Tommaseo dalla stazione alla Stanga tra circa un mese. Apertura prevista dal 2027 (presentazione SMART
  di dicembre 2025, letta solo dai risultati di ricerca).
* **Mezzi**: Wikipedia indica 10 tram da 3 moduli e 20 da 4.

### Stazione e SIR1

* Estate 2025: nel piazzale della stazione costruito l'**anello ad alta capacità** per tutte le 8 linee SMART (un tram
  ogni 4 minuti). Il SIR1 verso nord lo percorre già tutto; mancano ancora la linea aerea nell'anello (tram a
  batteria) e **due fermate nuove dentro l'anello, una a nord e una a sud** (le "Stazione nord/sud" del KML).
* La fermata **Trieste** del SIR1 è chiusa da settembre 2025: la sostituisce **De Gasperi**, a pochi metri, adatta
  ai tram più lunghi del SIR2. Il SIR1 è stato fermo per i lavori ed è ripartito a settembre 2026.

## Cosa c'è già nei dati del progetto

**GTFS.** Il feed Busitalia (BusOne, valido dal 4 novembre al 3 dicembre 2026) ha solo `TPD_SIR1`: niente
tracciati, fermate né orari per SIR2 e SIR3. Gli orari vanno generati dalla frequenza (SIR3: 8 minuti e 7 mezzi
secondo la presentazione SMART, letta solo dai risultati di ricerca).

**OSM** (`data/osm-padova-tram.json`, 5 novembre 2026). I binari delle due linee sono già mappati come
`railway=tram`, con nomi non uniformi ("SIR 3", "SIR3", "Linea SIR3", "Linea 3 …", "SIR 2 Rubano-Vigonza") e senza
`ref`; solo i binari del SIR1 hanno `oneway`.

## Prova di instradamento

`scripts/tram_percorsi.py` costruisce il grafo dei binari OSM (sensi unici del SIR1 rispettati, niente curve oltre 60°
ai nodi) e cerca il percorso più corto che tocca le fermate del KML in ordine, con la marcia a destra dove i binari
corrono affiancati (il binario contromano costa il triplo; il risultato dice quanti metri restano contromano).

```bash
python3 scripts/tram_percorsi.py data/osm-padova-tram.json SIR3.kml SIR3 "Stazione sud" "Capolinea Voltabarozzo" sir3-andata.json
python3 scripts/tram_percorsi.py data/osm-padova-tram.json SIR3.kml SIR3 "Capolinea Voltabarozzo" "Stazione sud" sir3-ritorno.json
python3 scripts/tram_percorsi.py data/osm-padova-tram.json SIR2.kml SIR2 "Brentella Est" "Savelli" sir2-est.json
```

| Prova | Esito |
|---|---|
| SIR3 andata | **5481 m**, tutte le 13 fermate, 10 m contromano (rumore). Ramo di via Giardinetto/Zeno come dice la FAQ |
| SIR3 ritorno | **5685 m**, tutte le fermate, 25 m contromano. Ramo di via Piovese; alla stazione entra nell'anello dal raccordo nord-est, lo gira e si ferma a "Stazione sud" |
| SIR2 Brentella Est → Savelli | 7849 m, ma **2401 m contromano** da Pace alla Stanga e a Savelli |
| SIR2 Savelli → Brentella Est | **bloccato** alla stazione (tra le due fermate dell'anello) |

Le lunghezze del SIR3 tornano con i 5,5 km dichiarati. Le fermate cadono a meno di 25 m dal percorso, tranne **Pace**:
nel KML del SIR3 è oltre il bivio, sui binari del SIR2 dove il SIR3 non passa. Nella prova è spostata alla posizione
della Pace del SIR2, sul tratto comune prima del bivio; la posizione vera va controllata.

**SIR2: cosa manca.**

* Copertura: solo **19 fermate su 36** (da Brentella Est a Savelli) sono vicine ai binari dell'export. Rubano e
  Sarmeola a ovest, Net Center, Nuovo Ospedale, San Marco, Ponte di Brenta e Vigonza a est sono fuori dal riquadro
  della query (`scripts/overpass-tram.ql`) o mappati come cantiere.
* **Nodo Pace** (via Tommaseo / SIR3): in OSM i binari che arrivano dalla stazione si collegano verso est solo al
  binario nord di via Tommaseo, per questo il percorso va contromano fino alla Stanga. Manca lo scambio, o il raccordo
  è mappato in modo diverso dal reale.
* **Anello della stazione**: le due fermate nuove dentro l'anello non sono in OSM; nel KML "Stazione sud" è 85 m
  fuori dai binari. I sensi unici dell'anello in OSM sono quelli del SIR1 di oggi (fase transitoria).
* Tra Garibaldi e la stazione il SIR2 usa i binari del SIR1 (Corso Garibaldi, Corso del Popolo): fermate in comune
  Eremitani e De Gasperi (ex Trieste).

**Area di gioco.** Delle fermate del SIR3 solo quelle fino a Cornaro cadono nella rete stradale del gioco: Nani,
Piovese, il capolinea e il deposito di Voltabarozzo sono a sud-est, fuori dai riquadri `FOCUS` e `FOCUS_SUD` di
`build_map.py`. L'export OSM `data/osm-padova.json` invece arriva fin là (lat 45,32–45,67, lon 11,69–11,99), come la
query della segnaletica. Il SIR2 dentro il gioco va da Chiesanuova (lon 11,852) a Savelli (lon 11,912).

## Piano

Prima il SIR3 (i dati sono completi e la linea apre per prima), poi il SIR2 quando OSM sarà più completo.

1. **Dati delle linee, senza toccare la mappa.** Uno script nuovo (sulla base di `tram_percorsi.py`) scrive
   `data/tram-linee-nuove.json`: per ogni linea e verso il percorso sui binari OSM (lat/lon) e le fermate in ordine
   con le distanze progressive. Fermate dal KML, corrette dove serve (Pace). Orari generati: ogni 8 minuti, tempi tra
   le fermate dalla velocità media del SIR1. Rischio di conflitto nullo: file nuovi.
2. **Grafo dei binari nel gioco.** `TramTrack` (in `src/tram/tram.js`) oggi è un solo tracciato con due versi, costruito
   da `net.tram`. Diventa una sede per linea (`city.tramTracks[id]`), con `city.tramTrack` che resta il SIR1, così il
   resto del codice non cambia subito. Poi un grafo vero (rami e scambi) per l'anello della stazione condiviso. Tocca
   `tram.js`, `traffic.js` (TramSim), `main.js`, `mission.js` e la parte del tram di `city.js`.
3. **Sede tranviaria nella pianta delle strade.** `build_map.py` passa a `street_surfaces.surfaces()` le corsie del
   tram: vanno aggiunte quelle del SIR3, e i bus non devono trovarsi la sede in corsia (verifica del CLAUDE.md). Questa
   è la tappa che si sovrappone di più al lavoro sulla mappa: farla **dopo** che l'altra sessione ha unito il suo.
4. **Area di Voltabarozzo.** Un riquadro `FOCUS` in più (circa lon 11,885–11,912, lat 45,372–45,392) per avere strade,
   edifici e deposito fino al capolinea; vanno controllati gli altri dati (DBGT, DTM, segnaletica) su quell'area.
   Anche questa tocca `build_map.py`: dopo la tappa 3. In alternativa, in un primo tempo il SIR3 si guida fino a
   Cornaro ("tratto in città"), come già si fa per il SIR1 verso la Guizza.
5. **SIR3 nel gioco**: linea nel menu del tram (4 moduli o 3? da verificare quali mezzi girano sul SIR3), tram
   automatici dall'orario generato, fermate con banchina, scambio all'uscita dell'anello.
6. **SIR2**, quando ci saranno i dati:
   * lanciare dal browser [`scripts/overpass-tram-cantiere.ql`](../scripts/overpass-tram-cantiere.ql) (area più
     larga, binari in cantiere, fermate e relazioni `route=tram`) e rifare la prova;
   * sistemare in OSM (o con una correzione locale) lo scambio del nodo Pace e le fermate dell'anello;
   * nel gioco la parte da Chiesanuova a Savelli, con i binari in comune col SIR1 tra Garibaldi e la stazione.

Domande aperte: le linee nuove vanno in gioco come già aperte (scenario "SMART") o con i cantieri? Il SIR3 usa tram da
3 o da 4 moduli?
