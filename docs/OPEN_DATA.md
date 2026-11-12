# Open data per rendere la simulazione più realistica

Spunto: il post di Andrea Agostini (EKORE) su un *urban digital twin* di Padova fatto **solo con open data**:
~23.000 edifici in 3D, con edifici, ambiente e mobilità collegati. È una prova di fattibilità indipendente,
non legata alla piattaforma commerciale EKORE. Il post non dice quali dataset ha usato né se il modello si
può scaricare. Le fonti qui sotto sono quelle che con ogni probabilità stanno alla base di un lavoro del
genere, ordinate per quanto migliorano **questo** simulatore.

> Nota: la ricerca è stata fatta da un ambiente con rete limitata (portali regionali, ISTAT, ARPAV e Overpass
> non raggiungibili). Vanno verificati sul posto URL, formati e licenze segnati con *(da verificare)*.

## Cosa usa già il gioco

| Fonte | Cosa dà |
|---|---|
| OSM (export Overpass, **solo way**) | strade, corsie, sensi unici, maxspeed, ponti, ferrovia, acque, edifici |
| Overture Maps | piante degli edifici, cortili, altezza ML di Microsoft |
| GTFS Busitalia Veneto (BusOne) | 22 linee urbane, varianti, fermate, orari feriali e festivi |

Le cose che oggi sono **inventate** e che gli open data possono sostituire:
- **semafori**: messi a caso agli incroci con molte linee (`src/world/traffic.js:14`);
- **domanda di passeggeri**: un coefficiente unico per fascia oraria (`src/game/mission.js:99`), uguale per tutte le fermate;
- **cicli semaforici**: tutti `[13,3,1,10,3,1]`;
- **meteo**: variabile, ma non collegato al meteo reale;
- **densità del traffico**: un obiettivo fisso, senza differenze tra strade o tra ore del giorno.

## Priorità 1: dati a costo zero che mancano dall'export OSM

L'export attuale contiene solo *way*. I **nodi con tag** non sono stati scaricati. Basta rifare la query
Overpass per ottenere:

| Tag OSM | Uso nel gioco |
|---|---|
| `highway=traffic_signals` (+ `traffic_signals:direction`) | **semafori veri**, al posto di quelli euristici |
| `highway=stop`, `highway=give_way` (+ `direction`) | i cartelli STOP e precedenza reali, al posto di quelli dedotti |
| `highway=crossing`, `crossing=*` | strisce pedonali e punti in cui i pedoni attraversano |
| `highway=bus_stop`, `public_transport=platform`, `shelter=yes`, `bench=yes` | pensiline e panchine reali, con il lato della strada giusto |
| `traffic_calming=*` | dossi e cuscini berlinesi (si sentono in cabina) |
| `busway=*`, `lanes:bus=*`, `bus:lanes=*`, `access`/`bus=designated` | **corsie preferenziali** |
| `boundary=low_emission_zone`, `access=destination`, cartelli ZTL | ZTL del centro, con i varchi |
| `natural=tree`, `natural=tree_row`, `leisure=park` | alberature lungo i viali e parchi |
| `amenity=*`, `shop=*`, `school`, `university`, `hospital` | **poli che generano domanda** (vedi Priorità 2) |

Query di esempio (stessa bbox dell'export attuale):

```
[out:json][timeout:180];
(
  node["highway"~"traffic_signals|stop|give_way|crossing|bus_stop"]({{bbox}});
  node["traffic_calming"]({{bbox}});
  node["public_transport"="platform"]({{bbox}});
  node["natural"="tree"]({{bbox}});
  nwr["amenity"~"school|university|hospital|marketplace|cinema|theatre"]({{bbox}});
  nwr["shop"]({{bbox}});
  way["busway"]({{bbox}}); way["lanes:bus"]({{bbox}}); way["bus:lanes"]({{bbox}});
);
out geom;
```

Integrazione: in `scripts/build_map.py` ogni nodo segnaletico si aggancia al nodo più vicino del grafo
stradale. Poi `traffic.js` usa `n.signal` solo dove OSM indica un semaforo. Le fasi possono restare quelle
calcolate dagli angoli, come oggi.

Per controllare e completare la segnaletica c'è **Mapillary**: rileva cartelli e semafori dalle foto
(API v4, gratuita con token). Copre bene la segnaletica che manca su OSM *(da verificare la copertura a Padova)*.

## Priorità 2: domanda di passeggeri realistica

1. **ISTAT – popolazione per sezione di censimento** (basi territoriali e variabili censuarie 2011/2021).
   Si somma la popolazione residente entro ~300 m da ogni fermata: diventa il peso di *salita*
   della fermata. (Le basi territoriali sono pubblicate, il dettaglio 2021 per sezione è *da verificare*.)
2. **ISTAT – matrice del pendolarismo**. Quella per **sezioni di censimento 2011** (zip da ~126 MB) dà i flussi
   origine-destinazione per lavoro e per studio *dentro* il comune. La 2021 (uscita nel 2025) è solo a livello
   di comune. Con la 2011 si scelgono le *destinazioni* dei passeggeri: ospedale, università, centro,
   stazione, zona industriale.
3. **Poli da OSM** (Priorità 1): università, scuole, ospedali, mercati, supermercati. La loro attrattività
   cambia con l'ora: scuole tra le 7:30 e le 8:00 e tra le 13 e le 14, università tutto il giorno, Prato della
   Valle e mercati il sabato.
4. **GTFS stesso**: il numero di corse che passano da una fermata misura già quanto è frequentata. È gratis
   e c'è già in `padova-map.json`.

Così `mission.js` userebbe un peso per ogni fermata e per ogni ora, invece di `dayF * hourF` uguale ovunque.
Il modello in sé è semplice: salite ∝ popolazione + poli nelle vicinanze, discese ∝ attrattività della
fermata di destinazione.

## Priorità 3: traffico e meteo

- **Densità del traffico per strada**: Padova non sembra avere un dataset aperto di flussi o spire.
  Alternative: la *gerarchia OSM* (trunk > primary > …) come peso, e il profilo orario tipico
  (picchi alle 7:30–9 e alle 17–19) per variare `traffic.target`. Altre città pubblicano dati paragonabili,
  per esempio la "stima flussi di traffico" di Ferrara (CC-BY 4.0), da usare come riferimento per le
  proporzioni. Si possono anche chiedere i conteggi di Veneto Strade o della Provincia (non sono open).
- **Meteo reale**: **Open-Meteo** (CC-BY 4.0, senza chiave, CORS aperto) si può chiamare dal browser
  all'avvio della corsa per lat 45.41 e lon 11.88. Dà pioggia, nebbia (visibilità), vento e copertura nuvolosa,
  che pilotano il sistema meteo che c'è già. Le stazioni **ARPAV** (Legnaro, Padova) hanno le serie orarie
  in XML per un meteo "storico" *(API da verificare)*.
- **Alba e tramonto**: si calcolano (algoritmo NOAA), non servono dati.

## Priorità 4: edifici e territorio (come nel digital twin)

- **Regione Veneto – "Edifici del Veneto"** (WFS, febbraio 2022) e **Carta Tecnica Regionale / DBT** 1:5000
  (SHP/DXF, Gauss-Boaga). Licenza IODL 2.0, citare "Regione del Veneto – L.R. n. 28/76". La CTR ha quote di
  gronda e di colmo: altezze **misurate**, migliori della stima ML di Microsoft. Le altezze nel WFS sono
  *da verificare*.
- **DTM LiDAR regionale** a 5 m (ricavato da rilievi a 1 m): Padova è piatta, ma argini (Bastioni, Piovego) e
  rilevati delle rampe vengono alla quota vera. Gli impalcati dei cavalcavia no: dal rilievo si tolgono i manufatti,
  e a metà campata il DTM scende al terreno sotto il ponte. La quota di un ponte viene dalle spalle e dal franco
  sopra quello che passa sotto: vedi [`cavalcavia.md`](cavalcavia.md), sezione "Quote: DTM, DBGT e franchi".
- **Comune di Padova – cartografia** su `cartografia.comune.padova.it` (servizi ArcGIS REST, citati su
  talk-it di OSM). Può contenere ZTL, piste ciclabili, aree pedonali e varchi *(da verificare la licenza)*.
  Le ordinanze ZTL 2023/62/0437 e aree pedonali 2023/62/0464 descrivono i perimetri.
- **Copernicus Urban Atlas** (Padova FUA): uso del suolo e *street tree layer* per il verde urbano.

## Priorità 5: tempo reale (bonus)

Non risulta un feed **GTFS-Realtime** pubblico di Busitalia Veneto. Esistono gli orari in tempo reale
nell'app e sui QR alle fermate. Sul Mobility Database si può cercare "Busitalia", oppure si può chiedere
l'accesso all'azienda. Con quel feed si potrebbe giocare contro i ritardi reali.

## Roadmap consigliata

1. Rifare l'export Overpass con i nodi (semafori, STOP, strisce, corsie bus, alberi, poli). **Impatto massimo, nessun costo.**
2. Calcolare in `build_map.py` un peso di domanda per ogni fermata (corse GTFS + poli OSM + popolazione ISTAT).
3. Collegare Open-Meteo al meteo di gioco (con un'opzione "meteo reale").
4. Altezze degli edifici dalla CTR del Veneto, dove ci sono.
