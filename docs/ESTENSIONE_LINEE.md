# Linee complete: la mappa fino ai capolinea veri

Valutazione del 9 novembre 2026, con i numeri misurati sul GTFS BusOne e sui dati in repo. Nessun codice cambiato:
serve a decidere come estendere la città oltre Centro e Arcella, e con quale caricamento.

## 1. Il problema

L'area di gioco sono due rettangoli in `scripts/build_map.py` (`FOCUS_BOXES`): Centro e Arcella (lon 11,852–11,912,
lat 45,390–45,449) e la fascia del tram fino alla Guizza (lon 11,855–11,885, lat 45,362–45,392), **39 km²**.
Delle linee si tengono le fermate entro 60 m dal tratto agganciato alle strade dell'area; le altre si tagliano e la
variante diventa "(tratto in città)".

Conseguenze, misurate:

- il **45%** dei km dei tracciati urbani (somma delle 286 varianti di 25 linee) è fuori dalla mappa;
- **74 capolinea** (48 luoghi) sono fuori dalla mappa: le corse partono o finiscono al bordo, spesso su una strada
  chiusa dal taglio dell'export;
- alcune fermate cadono fuori dalla rete. Esempio: **"Volta fr. 24"**, prima fermata della 24 verso Largo Debussy, è
  70 m oltre la fine di Via Alessandro Volta (tagliata a lat 45,368), in mezzo al prato. Il percorso parte con un
  tratto dritto che non è una strada (dalla fine di Via Rosa Luxemburg, a sua volta tagliata) e subito dopo sale sul
  cavalcavia, un pezzo di strada isolato nel prato;
- nel gioco: i turni del bus (`src/game/turni.js`) abbinano le corse ai capolinea al bordo con una tolleranza di
  1,5 km e un'ora, e tra due capolinea fuori mappa il bus viene portato alla partenza (`chainNext` in `src/main.js`);
  dal deposito della Stanga non si può uscire verso le varianti che partono al bordo.

## 2. Quanta mappa serve

| | Area | Note |
|---|---|---|
| Oggi | 39 km² | Centro, Arcella, fascia del tram |
| Rettangolo di tutte le linee urbane | 301 km² (16,2 × 18,6 km) | lon 11,780–11,987, lat 45,333–45,500: molta campagna |
| **Corridoio attorno ai tracciati** | **130 km²** | celle da 250 m toccate dai tracciati (58 km²) più una cella di margine |

**Proposta: il corridoio**, cioè `FOCUS_BOXES` sostituito da un insieme di celle calcolato dai tracciati GTFS completi
(più l'area di oggi), con qualche cella in più ai capolinea per anelli e piazzali. Tra un corridoio e l'altro la mappa
finisce come oggi al bordo dei rettangoli.

Capolinea fuori mappa con più corse (corse che ci partono o arrivano, contate su tutto il feed GTFS):

| Capolinea | Corse | Linee | Dal centro |
|---|---|---|---|
| Ponte di Brenta | 313 | 10 | 6,0 km |
| Granze Sud | 272 | 6, 7, 14, 15B | 5,8 km |
| Torre | 225 | 22 | 5,5 km |
| Lion (Albignasego) | 203 | 3 | 7,7 km |
| Altichiero | 197 | 13 | 4,9 km |
| Lagrange | 196 | 6, 12 | 3,8 km |
| Ippodromo Mortise | 195 | 9, 42 | 4,0 km |
| Sarmeola, via Emilia (Rubano) | 184 | 10 | 5,8 km |
| Mandriola (Albignasego) | 167 | 24, 88 | 5,3 km |
| Caselle (Selvazzano) | 164 | 10, 12 | 5,2 km |
| Carpanedo (Albignasego) | 163 | 88 | 8,3 km |
| Voltabrusegana | 155 | 5, 42 | 3,9 km |
| Cadoneghe | 151 | 4 | 5,2 km |
| Rio (Ponte San Nicolò) | 149 | 14, 16 | 5,7 km |
| Taggì | 148 | 11B | 7,3 km |
| Selvazzano | 145 | 12 | 7,6 km |
| Saonara | 140 | 7 | 9,4 km |

Seguono Bragni, Villatora, Saletto, Mandria, Albignasego Monumento, Tencarola, Ponte San Nicolò, Limena, Due Palazzi,
Tavo e Montà.

## 3. Dati per la nuova area (verificati il 9 novembre dal Mac)

| Strato | Copertura | Cosa serve |
|---|---|---|
| Strade OSM | `data/osm-padova.json` ha strade nel 72% delle celle del corridoio (solo vie con nome) | nuovo export Overpass del corridoio, anche dei nodi (semafori, STOP, strisce) e del tram |
| Edifici OSM | solo il centro (lat 45,384–45,424, lon 11,853–11,905) | ci sono gli edifici Overture |
| Edifici Overture | tutto, da S3 | scarico per il corridoio, come oggi |
| LiDAR 5 m della Regione | 99 tessere nel rettangolo delle linee (`rv:c0101071_lidar5m`); oggi 41 in `data/lidar5` | le tessere in più dal downloader IDT2 |
| DBGT (carreggiate, marciapiedi, volumi) | lotti "Comune di Padova" (2007), "Padova Sud" (2009), "ETRA Padova" (2008) nel rettangolo (`rv:c0101101_lotti_dbgt`) | scaricare i due lotti in più e verificare che abbiano gli stessi strati del lotto di Padova; il WFS ne elenca anche un quarto, "Laguna di Venezia", da verificare se tocca davvero il corridoio |
| GTFS | già completo | niente |

## 4. Caricamento per aree di strade ed edifici

### Com'è oggi (dal codice)

- `src/data/padova-map.json` pesa **12,4 MB** (pianta delle strade `surfaces.cells` 6,1 MB, edifici 3,9 MB, terreno
  0,8 MB, nodi e archi 0,7 MB, linee 0,2 MB), 4 MB compressi. Si importa nel bundle (13,5 MB di JavaScript) e si legge
  tutto all'avvio.
- **Strade**: la pianta (carreggiate, marciapiedi, isole, verde) arriva già **in celle da 200 m**, ma `buildSurfaces`
  in `src/world/city.js` le costruisce tutte all'avvio in poche mesh uniche; il bordo dell'asfalto per la fisica
  (`asphRings`) è per cella.
- **Edifici**: riquadri da 400 m (`buildRealBuildings`), con mesh e muri (ostacoli) costruiti solo vicino al bus
  (`ensureTiles`, `streamTiles`) e nascosti oltre 2,6 km; i dati però sono tutti in memoria.

Con il corridoio la mappa arriverebbe a circa **25–35 MB** (8–10 compressi). È una stima in proporzione all'area,
più bassa in periferia dove ci sono meno edifici: i dati non li ho generati.

### Fatto: la mappa fuori dal bundle (11 novembre, corsia `capolinea`)

Primo passo, senza toccare `city.js`: `build_map.py` scrive la rete in `src/data/padova-map.json` (2,4 MB con il
terreno) ed edifici, pianta delle strade e alberi in 170 aree da 800 m in `public/mappa/aree/<ix>_<iz>.json` (da 120
byte a 275 KB, 11 MB in tutto; `scripts/aree_mappa.py`). All'avvio `src/data/aree.js` le scarica tutte e le rimette in
`MAP` prima di `buildNetwork`, in ordine di chiave: la città si costruisce come prima (prove e rapporti uguali). Il
JavaScript passa da 14,6 a 3,7 MB (1,3 MB compresso); la mappa cambia senza far riscaricare il codice e viceversa.
Nella pagina autosufficiente (`npm run build:single`) le aree sono dentro la pagina (modulo `virtual:aree-mappa` in
`vite.config.js`). Gli script che leggono la mappa intera usano `aree_mappa.load` (`verifica_mappa.py`).

Secondo passo (11 novembre): nella rete tornano carreggiate e isole della pianta delle strade, che il gioco usa su
tutta la mappa all'avvio (fisica, paline con `allStopPlacements`, semafori, lampioni), il rettangolo degli edifici
(`edificiBBox`, per gli edifici procedurali fuori) e gli edifici a meno di 60 m dai binari (`edificiTram`, 5.647, per
`clearOfBuildings` e i tiranti di `buildTramway`). Nelle aree restano edifici, marciapiedi, verde e alberi: 8,8 MB in
161 aree, solo da vicino (da vedere e da urtare). Rete 5,9 MB, JavaScript 7,2 MB (2,5 MB compresso).

Terzo passo (11 novembre), le aree a richiesta: all'avvio solo quelle entro 1,5 km da Prato (17 su 161, per lo sfondo
del menu e per i semafori a muro), poi quelle entro 1,5 km dal bus, una per fotogramma; oltre 2,6 km si liberano mesh,
ostacoli e dati (`addArea`, `removeArea` in `city.js`). Fisica, paline, semafori e lampioni non cambiano: usano le
carreggiate della rete. La partenza non aspetta le aree (le prove sì, `city.areasReady`): al capolinea il bus è fermo e
le aree vicine arrivano in qualche decimo di secondo. Esempio: avviata la 3 al capolinea Orlandini e poi teletrasportato
il bus a sud, da 27 aree e 142.810 ostacoli a 17 aree e 35.555 ostacoli.

Restano: le aree scaricate anche lungo il percorso della linea, prima di arrivarci (punto 2); il terreno ancora in una
griglia unica; `npm run build:single` con tutte le aree dentro la pagina. Misura dell'avvio (11 novembre,
SwiftShader su una macchina carica): `buildDecks` prende 17 s su 21 di costruzione della città (0,3 s nel build del 9
novembre: impalcati in triangoli da 4 m, corsia `mappa`), `buildRoads` con tutta la pianta delle strade meno di 1 s.

### Proposta

1. **Due livelli di dati.**
   - *Rete*, sempre caricata: nodi, archi, nomi, linee e fermate, semafori e cartelli, quote dei ponti. Serve
     ovunque per percorsi, navigatore, bus automatici, traffico, minimappa e turni. Oggi circa 1,1 MB; con il
     corridoio 3–4 MB.
   - *Aree*, a richiesta: un file per riquadro (800 m o 1 km, multiplo delle celle da 200 m e dei riquadri da 400 m)
     con la pianta delle strade, gli edifici, gli alberi, il terreno e gli impalcati del riquadro. Fuori dal bundle,
     in `public/mappa/aree/<ix>_<iz>.json`; GitHub Pages li serve compressi.
2. **Quando si caricano.** All'avvio la rete e le aree entro circa 1 km dalla partenza (con la schermata
   "Costruisco Padova…"). In corsa si scaricano le aree entro 1,5–2 km, prima quelle lungo il percorso della linea,
   che si conosce in anticipo. Si costruiscono a pezzi con un budget per fotogramma, come oggi gli edifici. Oltre
   circa 3 km si liberano mesh, ostacoli e bordi dell'asfalto.
3. **Strade per riquadro.** `buildSurfaces` costruisce le mesh per riquadro e non più in un pezzo solo; `asphRings`,
   righe di bordo e ostacoli si aggiungono e si tolgono con il riquadro.
4. **Partenza e teletrasporto.** `ensureTiles` diventa asincrono (scarica e costruisce): il bus resta fermo finché il
   riquadro sotto le ruote non è pronto, perché fisica, cordoli e marciapiedi dipendono dalla pianta.
5. **Da adattare**, perché oggi leggono tutta la mappa all'avvio: paline e pensiline (`allStopPlacements`,
   `clearance`), `clearBusRoads`, raccordi degli impalcati, alberi e lampioni, edifici procedurali fuori dall'area OSM
   (`inOsmArea`), terreno (oggi una griglia unica a 10 m).
6. **`npm run build:single`** (pagina autosufficiente per gli artefatti): tutte le aree dentro la pagina, oppure solo
   l'area di oggi.
7. **Pipeline.** `build_map.py` scrive la rete e i riquadri; la pianta delle strade si può calcolare per riquadri in
   parallelo. Tempo di generazione stimato circa 3 volte quello di oggi.

## 5. Tappe

1. **Caricamento per aree con la mappa di oggi**: stesso contenuto, nessuna differenza per chi gioca. Misurare avvio e
   memoria prima e dopo, anche su telefono.
2. **Corridoio delle linee complete** in `build_map.py` (celle al posto di `FOCUS_BOXES`), nuovi export OSM, Overture,
   LiDAR e DBGT, niente più "(tratto in città)". Si può procedere a gruppi di capolinea, dai più usati (tabella
   sopra) o da quelli segnalati (Volta e Mandriola sulla 24). Le verifiche di oggi (percorsi liberi, paline sul
   marciapiede) vanno estese a tutto il corridoio.
3. **Nel gioco, dopo**: turni con i capolinea veri (via la tolleranza di 1,5 km e il trasferimento automatico in
   `turni.js` e `chainNext`), uscita dal deposito verso tutte le varianti, durate delle corse reali nel menu.

Tocca `build_map.py`, `street_surfaces.py`, `city.js` e `padova-map.json`, gli stessi file delle tappe del
[piano del modello della città](PIANO_MODELLO_CITTA.md): va fatto nella sessione che porta avanti quel piano, una
tappa alla volta.

## 6. Inventario e gruppi di capolinea (corsia capolinea)

`scripts/inventario_capolinea.py <cartella_gtfs>` confronta le linee complete con la mappa e stampa le tabelle qui
sotto: ogni variante urbana del GTFS (fermate e corse di un mercoledì e di una domenica) con quella di
`padova-map.json` (intera, tagliata, assente), il SIR1 dal GTFS, SIR2 e SIR3 con la regola del gioco (fermate con una
strada entro 120 m) e le fermate agganciate male di `verifica_mappa.py`. Si rilancia dopo ogni gruppo.

### Stato dopo il gruppo 2 (autobus 3, 10, 11, 22, 24 e 88, 11 novembre)

157 varianti urbane con corse nei due giorni: 66 intere nella mappa, 71 tagliate, 20 assenti (9 oltre le 10 varianti
per linea che tiene `build_gtfs.load`, 8 con il tracciato oltre i 9 km di `RADIUS`, 3 non agganciate). Le assenti non
dipendono dall'area: per le linee di `CORRIDOI_BUS` (`build_map.py`) quei due limiti non valgono. Dopo il gruppo 1b
erano 26 intere, 107 tagliate e 24 assenti.

**Varianti per linea.** Richiesta di chi gioca dell'11 novembre: quando la città si estende la linea si allunga, cioè
la variante nel gioco ha la prima e l'ultima fermata del GTFS, con tracciato e orario interi, senza "(tratto in
città)". Intere: così. Tagliate: c'è solo il tratto in città (parte dopo il capolinea, finisce prima, o tutte e due).
Assenti: la variante non c'è. Si aggiorna a ogni gruppo. Intere in tutte le varianti: 3, 10, 11, 13, 22, 24, 25 e 88.

| Linea | Varianti | Intere | Tagliate | Assenti | Perché | Corse fer. toccate | Fermate fuori |
|---|---|---|---|---|---|---|---|
| 2 | 1 | 0 | 1 | 0 | parte dopo il capolinea e finisce prima 1 | 7 | 2 |
| 3 | 7 | 7 | 0 | 0 | – | 0 | 0 |
| 4 | 12 | 2 | 8 | 2 | parte dopo il capolinea 4; finisce prima del capolinea 3; oltre le 10 varianti 2; parte dopo il capolinea e finisce prima 1 | 110 | 35 |
| 5 | 2 | 0 | 2 | 0 | parte dopo il capolinea 1; finisce prima del capolinea 1 | 71 | 9 |
| 6 | 17 | 0 | 10 | 7 | oltre le 10 varianti 7; parte dopo il capolinea e finisce prima 4; parte dopo il capolinea 4; finisce prima del capolinea 2 | 129 | 131 |
| 7 | 8 | 0 | 5 | 3 | oltre 9 km 3; finisce prima del capolinea 3; parte dopo il capolinea 2 | 89 | 70 |
| 9 | 10 | 3 | 4 | 3 | non agganciata 3; parte dopo il capolinea 2; finisce prima del capolinea 2 | 94 | 5 |
| 10 | 10 | 10 | 0 | 0 | – | 0 | 0 |
| 11 | 4 | 4 | 0 | 0 | – | 0 | 0 |
| 11B | 7 | 0 | 7 | 0 | parte dopo il capolinea 4; finisce prima del capolinea 3 | 64 | 7 |
| 12 | 9 | 0 | 9 | 0 | parte dopo il capolinea 6; finisce prima del capolinea 3 | 110 | 56 |
| 13 | 7 | 7 | 0 | 0 | – | 0 | 0 |
| 14 | 9 | 0 | 9 | 0 | parte dopo il capolinea 5; finisce prima del capolinea 4 | 94 | 24 |
| 15B | 5 | 0 | 5 | 0 | parte dopo il capolinea 4; finisce prima del capolinea 1 | 17 | 33 |
| 16 | 8 | 3 | 5 | 0 | finisce prima del capolinea 3; parte dopo il capolinea 2 | 79 | 37 |
| 17 | 2 | 0 | 0 | 2 | oltre 9 km 2 | 32 | 32 |
| 19 | 6 | 0 | 3 | 3 | oltre 9 km 3; parte dopo il capolinea 2; finisce prima del capolinea 1 | 76 | 42 |
| 21 | 2 | 1 | 1 | 0 | finisce prima del capolinea 1 | 10 | 3 |
| 22 | 14 | 14 | 0 | 0 | – | 0 | 0 |
| 24 | 7 | 7 | 0 | 0 | – | 0 | 0 |
| 25 | 1 | 1 | 0 | 0 | – | 0 | 0 |
| 42 | 2 | 0 | 2 | 0 | parte dopo il capolinea e finisce prima 2 | 0 | 10 |
| 88 | 7 | 7 | 0 | 0 | – | 0 | 0 |

**Tram**

| Linea | Verso | Fermate | Nella mappa | Fuori | Capolinea fuori |
|---|---|---|---|---|---|
| SIR1 | Pontevigodarzere (156 corse fer.) | 25 | 25 | 0 | – |
| SIR1 | Cavalletto (147 corse fer.) | 9 | 9 | 0 | – |
| SIR1 | Guizza Capolinea Sud (142 corse fer.) | 10 | 10 | 0 | – |
| SIR1 | Guizza Capolinea Sud (138 corse fer.) | 10 | 10 | 0 | – |
| SIR3 | Voltabarozzo | 13 | 13 | 0 | – |
| SIR3 | Stazione | 14 | 14 | 0 | – |
| SIR2 | Busa di Vigonza | 35 | 35 | 0 | – |
| SIR2 | Rubano | 35 | 35 | 0 | – |

**Autobus, capolinea fuori mappa.** I capolinea sono raggruppati entro 300 m; le corse sono quelle delle varianti
tagliate o assenti che ci partono o ci arrivano.

| Capolinea | Linee | Corse fer. | Corse fest. | Dalla mappa | Dal centro | lat, lon |
|---|---|---|---|---|---|---|
| Capolinea Granze Sud | 6, 7, 14, 15B | 121 | 50 | 1.880 m | 5,8 km | 45.3791, 11.9399 |
| Capolinea Ippodromo Mortise | 9, 42 | 86 | 34 | 130 m | 4,0 km | 45.4252, 11.9218 |
| Capolinea Lagrange | 6 | 112 | 0 | 360 m | 3,8 km | 45.4002, 11.8296 |
| Capolinea Voltabrusegana | 5, 42 | 71 | 34 | 660 m | 3,9 km | 45.3892, 11.8351 |
| Capolinea Selvazzano | 12 | 67 | 32 | 2.190 m | 7,6 km | 45.3962, 11.7816 |
| Capolinea Taggi' | 11B | 64 | 30 | 1.480 m | 7,3 km | 45.4599, 11.8218 |
| Capolinea Cadoneghe | 4 | 59 | 34 | 160 m | 5,2 km | 45.4399, 11.9249 |
| Capolinea Rio | 14, 16 | 76 | 0 | 510 m | 5,7 km | 45.3612, 11.9086 |
| Capolinea Bragni | 4 | 51 | 25 | 1.610 m | 7,0 km | 45.4666, 11.9075 |
| Capolinea Saonara | 7 | 74 | 0 | 5.250 m | 9,4 km | 45.3694, 11.9843 |
| Capolinea Villatora | 6, 15B | 62 | 10 | 3.150 m | 7,3 km | 45.3859, 11.9660 |
| Capolinea Saletto | 19 | 50 | 0 | 2.660 m | 7,7 km | 45.4756, 11.8578 |
| Capolinea Tencarola | 12 | 31 | 16 | 710 m | 5,6 km | 45.3980, 11.8069 |
| Capolinea Ponte S. Nicolò | 14 | 30 | 6 | 1.910 m | 6,9 km | 45.3627, 11.9379 |
| Capolinea Limena | 17 | 32 | 0 | 3.700 m | 8,9 km | 45.4826, 11.8366 |
| Capolinea Tavo (Chiesa) | 19 | 26 | 0 | 5.270 m | 10,3 km | 45.4991, 11.8559 |
| Sorio Park Colli | 2 | 14 | 0 | 70 m | 3,2 km | 45.3980, 11.8389 |
| Stati Uniti Ex capolinea | 7 | 9 | 0 | 1.710 m | 5,6 km | 45.3913, 11.9458 |
| Capolinea Roncajette Don Rossi PSN | 4, 16 | 7 | 0 | 2.260 m | 8,4 km | 45.3449, 11.9365 |
| Capolinea Duca Abruzzi | 6 | 5 | 0 | 470 m | 3,7 km | 45.3941, 11.8348 |
| Spagna fr mtcc | 7 | 4 | 0 | 800 m | 4,4 km | 45.3886, 11.9267 |

Capolinea che sono già nella mappa (entro 60 m dalla rete) ma fuori dalle corse del gioco:

| Capolinea | Linee | Corse fer. | Corse fest. | Perché |
|---|---|---|---|---|
| Ferrovia Corsia 2 | 6, 7, 9, 19 | 102 | 0 | non agganciata; oltre 9 km; oltre le 10 varianti |
| Capolinea Nord Tram | 4, 17, 19 | 59 | 0 | oltre 9 km; oltre le 10 varianti |
| Capolinea Caselle | 12 | 12 | 0 | la linea esce prima dalla mappa |
| Padova, Via Montà 429 | 21 | 10 | 0 | la linea esce prima dalla mappa |
| Capolinea scuola Severi | 9 | 8 | 0 | non agganciata |
| Capolinea Plebiscito | 16 | 2 | 0 | la linea esce prima dalla mappa |
| Capolinea Terranegra | 6 | 2 | 0 | oltre le 10 varianti |

### Gruppi

| Gruppo | Cosa | Stato |
|---|---|---|
| 1a | SIR3 fino a Voltabarozzo, con i due rami e il deposito | fatto il 9 novembre |
| 1b | SIR2 da Rubano (via Pria Fosca) a Vigonza, prima della rotonda della SR11; con la 25 intera | fatto l'11 novembre; rami di Romagnoli e Ospedale San Lazzaro quando OSM avrà i binari |
| 2 | autobus: la 24 (Mandriola), la 3 (Lion, Albignasego, San Giacomo), la 22 (Torre, Mandria, Giarre), la 10 (Caselle), la 11 (Due Palazzi) e la 88 (Carpanedo), tutte le varianti intere | fatto l'11 novembre |
| 3 | le altre linee, dai capolinea più usati della tabella sopra (Granze Sud, Ippodromo Mortise, Lagrange, Voltabrusegana) e dal salto della 19 a Saletto | da fare |

**Gruppo 1a.** In `build_map.py` l'area comprende i corridoi di celle da 250 m attorno ai binari completi delle linee di
`CORRIDOI_TRAM` (oggi il SIR3), più una cella di margine: 96 celle, 37 fuori dai riquadri di oggi (2,3 km²), da Cornaro
al capolinea. Il deposito è a meno di 100 m dal capolinea e ci sta dentro. Dati già in repo per quell'area: strade,
nodi, binari, paline, DTM e DBGT (lotto del Comune); servivano solo gli edifici Overture (3.944 in più nel parquet,
tenuti solo quelli dell'area). Il SIR3 ora è intero nel gioco nei due versi (13 e 14 fermate), i tram automatici fanno
il capolinea di Voltabarozzo, e 4, 14 e 16 arrivano più avanti su Via Piovese (6-7 fermate in più) fino allo svincolo
della tangenziale. Con l'area nuova sono servite tre correzioni dell'aggancio, utili anche altrove:

- `gtfs_links`: le vie fuori dall'area che collegano due vie dell'area dove passa un tracciato GTFS (Via Bembo per la
  3 verso Lion, che prima girava per 2,7 km di vie residenziali; 58 m di Via Alessandro Volta per la 24);
- `cut_path`: il pezzo tenuto di una linea tagliata non comincia con un tratto corto prima di una svolta stretta (la 24
  a Volta fr. 24);
- `stop_lanes`: anche i golfi di fermata (strade di servizio a senso unico) a Piovese Park, sotto la tangenziale.

Peso: mappa da 12,66 a 13,46 MB (4,05 → 4,29 MB compressa), JavaScript 14,6 MB. Rapporto della mappa: +7 edifici in
carreggiata (+6 lungo i bus, nessuno nella corsia), tutti nell'area nuova; fermate agganciate male da 11 a 7.
Restano da fare nell'area: i binari del deposito (in OSM 7 vie `service=yard` in `data/osm-padova-tram-cantiere.json`)
non sono disegnati, il gioco disegna solo i binari delle linee; nell'anello est dello svincolo di Piovese Park (raggio
di circa 12 m) il pilota delle prove a volte sale sul marciapiede o si pianta, la stessa corsa passa una volta e
l'altra no.

**Gruppo 1b.** Il corridoio del SIR2 aggiunge 166 celle (10,4 km², da lon 11,772 a 11,958), quello della 25 altre 8
nella zona industriale. Dati per le aree nuove: l'export delle strade `data/osm-padova.json` arriva a est fino a
Vigonza ma a ovest solo fino a lon 11,81, e quello dei nodi solo fino al riquadro di prima; strade e segnaletica delle
due teste sono in `data/osm-corridoio.json` (`scripts/filter_osm_corridoio.py`: 952 vie e 1.064 nodi), le paline
Overture da lon 11,768 a 11,962 (857, prima 524), 11.726 edifici Overture in più, il terreno da x -8550 a 6550 con il
DTM regionale (le celle di prima uguali). Il DBGT di Rubano e Vigonza (altri lotti) non c'è.

Nel gioco il SIR2 ha tutte le 35 fermate nei due versi, da Rubano (via Pria Fosca) a Busa di Vigonza (via Padova,
prima della rotonda con la SR515 e la SR11). Con il corridoio la 10 è intera fino a Sarmeola e a Ponte di Brenta (6
varianti su 10; quelle di Caselle restano tagliate), la 25 è intera, 6 e 7 arrivano più avanti. Le varianti della 22
da e per Torre e la 2, che uscendo dall'area e rientrando si agganciavano con un giro e venivano scartate, si
agganciano per pezzi; tre varianti della 22 verso Torre perdono l'ultima fermata del tratto in città (Madonna del
Rosario fr. 5): tornano intere con la 22 nel gruppo 2.

Peso: rete da 5,9 a 8,7 MB (nel bundle, con il terreno da 0,8 a 2,2 MB), aree da 8,8 a 12 MB in 188 file. Rapporto
della mappa: edifici in carreggiata da 174 a 189 (lungo i bus da 117 a 129), tutti nei corridoi nuovi, fino a 1,8 m e
nessuno nella corsia; marciapiede stretto da 175.993 a 189.949 m² (senza DBGT valgono le larghezze per tipo di strada);
nel gioco due fermate in più con le ruote oltre il cordolo, sulla 10 intera (Provvidenza 14, Capolinea Ponte Brenta).

**Gruppo 2.** Il corridoio di 3, 10, 11, 22, 24 e 88 aggiunge 283 celle, 154 fuori dai riquadri di prima (9,6 km²): da
Mandriola, Mandria e Giarre a sud-ovest a Lion, Albignasego, San Giacomo e Carpanedo a sud, più i tratti verso Torre,
Caselle e i Due Palazzi, capolinea che erano già nella mappa ma fuori dal tratto in città. La 88 non era tra le linee
chieste: con le vie del corridoio della 3 il tracciato da Carpanedo alla Guizza si agganciava con un giro di 13 km su
4,4 e la variante veniva scartata; con la 88 nei corridoi è intera con le altre sei. Dati per le aree nuove: strade e
segnaletica OSM in `data/osm-corridoio.json` (da 952 a 2.003 vie, da 1.064 a 1.974 nodi), con
`filter_osm_corridoio.py query <gtfs> <cartella> <linee>`, che scrive una query per riquadro di celle contigue e solo
per le celle delle linee nuove (10 riquadri; il server pubblico ha risposto 502 e 504 per ore e le query sono passate da
overpass-turbo nel browser, export "dati OSM grezzi"); 10.304 edifici Overture in più (solo quelli a meno di 0,0015
gradi dalle celle nuove), 49 paline Overture in più (906), il terreno fino a z 8.650 con il DTM regionale (le celle di
prima uguali). Il DBGT resta quello di prima.

Con l'area nuova sono servite tre correzioni in `build_map.py`, utili anche altrove:

- dove la linea esce dalla mappa il tratto comincia e finisce con una fermata a meno di 40 m dal percorso (`STOP_FAR` di
  `verifica_mappa.py`): le paline tra 40 e 60 m stanno su una via fuori dall'area (la 4 a Rigotti con le celle nuove; la
  5 e la 42 perdono Decorati 57 e partono da Decorati 1); fermate lontane da 2 a 0;
- `gtfs_links` prende anche catene di vie fuori dall'area, coperte dal tracciato, fino a 300 m in tutto: a Cadoneghe
  la 4 arriva più avanti su Via Matteotti, entrata con il corridoio della 22, ma i due pezzi in mezzo (15 e 125 m)
  restavano fuori e il bus saltava 142 m senza strada;
- nel grafo dell'aggancio le strade di servizio dove passa un tracciato GTFS (anelli e piazzali dei capolinea), nei
  corridoi fuori dai riquadri, costano come le altre e non 2,5 volte la lunghezza: a Carpanedo l'aggancio tornava
  indietro sulla strada principale invece di fare l'anello del piazzale, e la 88 partiva con un'inversione a U 30 m
  dopo il capolinea (il bus saliva sul marciapiede). Cambiano di pochi metri anche la 3 a Lion e nel golfo di Park
  Bembo e la 16 a Piovese Park; andate e ritorno A-B-A da 13 a 10, come prima del gruppo. Nei riquadri la regola
  cambiava anche il Capolinea Nord e il parcheggio del Plebiscito, dove la 24 finiva contro un edificio: lì i percorsi
  restano quelli di prima.

Varianti intere da 26 a 66 su 157: tutte quelle di 3, 10, 11, 22, 24 e 88, con le 4 della 22 oltre le prime 10
(Ferrovia - Mandria, Ferrovia - Mandria via Carnia, Codalunga - Giarre, Codalunga - Mandria). Con le aree nuove anche
la 21 da Ponterotto è intera (l'altra variante arriva una fermata più avanti), la 11B arriva 5 fermate più avanti verso
Taggì (Montà 410a) e la 4 una verso Cadoneghe (Matteotti 80). Varianti con "(tratto in città)" nel gioco da 107 a 71.

Peso: rete da 8,7 a 10,4 MB (nel bundle, 3,7 MB compressa; il terreno da 2,2 a 2,8 MB), aree da 10,1 a 11,8 MB in 224
file (prima 188). Rapporto della mappa: edifici in carreggiata da 189 a 200 e lungo i bus da 129 a 140, tutti nei
corridoi nuovi (fino a 1,5 m, nessuno nella corsia); marciapiede stretto da 189.651 a 199.867 m² (+10.200 su 737.000 m²
di marciapiede nuovo); salti senza strada 3 come prima (la 19 a Saletto).

Dal posto di guida (pilota di `tests/guida.js`: tre o quattro fermate da ogni capolinea nuovo, la 88 fino ad
Albignasego e a Carpanedo, la 3 da Ferrovia fino a dopo Park Bembo) partenze e arrivi ai capolinea nuovi vanno.
Restano da sistemare tre punti:

- la 22 da Giarre: dopo 110 m gira a 90 gradi da Via degli Olmi in Via dei Ciliegi e il pilota finisce contro la casa
  di fronte (Overture, 1,6 m oltre il bordo della carreggiata);
- la 3 verso Lion: la fermata Bembo Rotonda via Ponchia è all'uscita della rotonda e il bus fermo tocca la pensilina;
- al Capolinea Caselle la 10 snodata parte nel piazzale della rotonda con le ruote 5,1 m oltre il cordolo.

Nel gioco (`tests/mappa.spec.js`): paline in carreggiata da 1 a 3 (Park Bembo e Capolinea Park Bembo sotto il nastro di
Corso Primo Maggio, come Piovese fr. Park), fermate con ostacoli da 9 a 10 e con le ruote oltre il cordolo da 6 a 7
(Ponchia e Caselle), agganciate lontano dalla fermata vera da 6 a 3. C'erano già su `main`, con gli stessi percorsi: la
16 da Ferrovia si pianta contro un edificio al Borgomagno, la 24 nel parcheggio del Capolinea Plebiscito.
