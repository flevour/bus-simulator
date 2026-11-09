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
