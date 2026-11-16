# Sosta lungo le strade (#111)

Molti viali sono larghi perché ai lati si parcheggia. Fino al 16 novembre 2026 il gioco disegnava tutta quella
larghezza come asfalto libero, e auto e bus automatici ci si allargavano sopra. Ora gli stalli sono un dato della mappa:
li calcola la build (`scripts/sosta.py`, chiamato da `build_map.py` dopo la pianta delle strade e prima dei raccordi di
corsia), il gioco li legge e non cerca niente, e un controllo a zero tiene corsie, fermate, passi carrai e incroci
liberi.

Numeri del 16 novembre 2026, sulla mappa di `main`. Si ristampano con `python3 scripts/sosta.py --conti`.

## 1. Campi nella mappa

Stanno nella rete (`src/data/padova-map.json`), dopo `signalArms`.

| Campo | Formato |
|---|---|
| `stalli` | una voce per fila: `[arco, lato, tipo, fonte, d0, d1, s0, quanti]` |
| `sedeCorsie` | `[arco, sinistra, destra]`, solo per gli archi dove gli stalli stringono la carreggiata |
| `stalliTipi` | per tipo, `[passo lungo il cordolo, profondità]` in cm |
| flag 512 dell'arco | la carreggiata dell'arco è misurata (DBGT o CTRN), non stimata dalla classe o dalle corsie |

`stalli`. `lato`: 0 a sinistra, 1 a destra di chi va dal nodo `a` al nodo `b`. `tipo`: 1 in linea, 2 a spina, 3 a
pettine. `fonte`: 1 tag OSM della via, 2 area OSM, 3 DBGT, 4 larghezza. `d0` e `d1`: distanza dall'asse dell'arco del
bordo verso le corsie e del bordo verso il cordolo, in cm. `s0`: progressiva dal nodo `a` dell'inizio del primo
stallo, in cm; gli stalli della fila sono `quanti`, uno ogni passo.

`sedeCorsie`. Le corsie dell'arco stanno tra `sinistra` e `destra` centimetri dall'asse (verso `a` → `b`), invece che su
tutta la carreggiata. I due bordi sono gli stessi lungo tutta la catena dell'arco, cioè gli archi di fila tra due
incroci con la stessa carreggiata e le stesse corsie: così le righe non fanno un gradino a ogni arco. Le corsie restano
centrate sull'asse finché ci stanno, poi si spostano dalla parte libera.

Misure degli stalli (DM 5/11/2001 § 3.4.7, sezione 3.1 di [`PIANO_MODELLO_CITTA.md`](PIANO_MODELLO_CITTA.md)): in linea
5,00 × 2,00 m; a pettine 2,50 × 5,00; a spina a 45 gradi 3,30 di passo e 4,80 di profondità.

## 2. Fonti, in ordine

Quello che una fonte decide per un tratto di un lato, la fonte dopo non lo tocca.

1. **Tag OSM della via** (`sosta` nella mappa, da `scripts/osm_rete.py`). In carreggiata, in un golfo, a cavallo del
   cordolo o "ammessa" danno una fila lungo tutto il lato, del tipo che OSM dichiara (in linea se non lo dice).
   "Vietata", sul marciapiede e sulla banchina chiudono il lato alle fonti dopo. "Disegnata a parte" lascia il lato
   all'area.
2. **Aree OSM** `parking=street_side` di `data/osm-luoghi.json` (parcheggi e stalli singoli con il contorno, non
   privati), unite dove si toccano. Dove l'area tocca la carreggiata entra nell'asfalto della pianta
   (`street_surfaces.surfaces`, `golfi`), come i parcheggi del DBGT: il rilievo del 2007 non le ha tutte.
3. **DBGT**, poligoni `SV_STR` di `data/dbgt-strade.json` (già nell'asfalto della pianta se toccano la carreggiata),
   solo lungo le vie che non sono strade di servizio: lì gli `SV_STR` sono quasi tutti distributori e piazzali
   (sezione 7).
4. **Larghezza**: carreggiata misurata (flag 512) più larga di quanto serve alle corsie, sulle vie secondary,
   tertiary, unclassified, residential e living_street senza corsie dei bus. Due metri liberi su un lato danno una
   fila in linea; se bastano solo sommando i due lati la fila è una, dal lato con più asfalto (a destra della via OSM
   se sono uguali). Vale solo in città: dentro un'area di OSM residenziale, commerciale, industriale o simile
   (allargata di 15 m) e con un edificio entro 30 m. Una fila più corta di tre stalli non si tiene.
5. Altrimenti niente sosta.

Per le fonti 2 e 3 senza il verso dichiarato la fila è a pettine se uno stallo profondo 5 m contro il cordolo sta per
il 60% nell'area e la fila così copre almeno due terzi del cordolo che coprirebbe in linea; altrimenti in linea.

## 3. Dove sta uno stallo

Ogni stallo sta contro il cordolo vero: il bordo dell'asfalto della pianta delle strade, misurato davanti allo stallo
ogni 25 cm di traverso. Resta solo se:

- sta tutto sull'asfalto, e il cordolo non è a più di 6,5 m oltre la carreggiata dell'arco (oltre è un piazzale, non una
  fila lungo la via);
- è fuori dalle zone libere del suo lato (tabella sotto);
- non tocca le corsie di un altro arco (mezzo metro in più dove passa una linea), un incrocio, la sede del tram (2,6 m
  dal binario), uno stallo di un altro arco;
- sta su un arco a terra, non pedonale, non in rotatoria, su un ponte, in galleria o riservato ai bus;
- con gli stalli le corsie della catena ci stanno ancora. Larghezza che serve per corsia: 2,75 m sulle vie locali,
  3,00 su quelle di quartiere, 3,25 sulle strade principali, 3,50 dove passa una linea (con 3,25 tra la fiancata del
  bus automatico e le auto ferme restavano 24 cm, e nelle curve le toccava); 3,00 per la corsia sola di un senso unico. È più di quanto serve al gioco per non togliere una
  corsia (2,60 e 3,00 in `laneLayout`), quindi gli stalli non cambiano mai il numero delle corsie. Dove non basta si
  tolgono le file che stringono, prima quelle della fonte meno certa. Sugli archi con la corsia dei bus, che il gioco
  tiene contro il cordolo, nessuna fila può stringere la carreggiata.

| Zona libera | Quanto | Da dove viene |
|---|---|---|
| incrocio | 5 m prima della carreggiata della via che incrocia (CdS art. 158), 12 m dove passa una linea o c'è il semaforo | nodi con tre archi o più |
| gomito senza incrocio | 2,5 m per parte, 10 m dove passa una linea | nodi con due archi che piegano più di 20 gradi |
| cambio di carreggiata | 8 m per parte, solo dove passa una linea | nodi con due archi di catene diverse (cambiano larghezza o corsie) |
| strisce pedonali | 3,5 m prima e dopo l'asse | `crossings` |
| fermata dei bus | 42 m prima del bus fermo (12 m, 18 lo snodato) e 32 m dopo la palina, a destra di chi percorre la linea, lungo il percorso della variante; lo stesso tratto come rettangolo, dall'asse del percorso a 5 m oltre la palina, per gli stalli degli archi accanto | `stops` e `lines` |
| capolinea | 60 m prima e dopo la prima e l'ultima fermata di ogni variante, 10 m per parte | `stops` e `lines` |
| passo carraio | 2,5 m per parte (3,5 per le corsie dei parcheggi, 3 per le altre strade di servizio) dal lato da cui esce | vie OSM di servizio che la rete non ha (`driveway`, `parking_aisle`) dove toccano una via della rete |
| ingresso di un parcheggio | 3 m per parte | `parking_entrance` di OSM entro 10 m da un arco |

La zona di fermata è più lunga dei 12 + 12 m dell'art. 151 del Regolamento: è quella che serve ai bus del gioco, che
accostano tutti interi (quelli automatici cominciano con il muso 30 m prima e rientrano in 18 m, il pilota delle prove
40 m prima), più 12 m per parte perché la palina posata dal gioco non sta sempre dove la fermata dei dati si proietta
sul percorso. Dove il percorso passa due volte dalla stessa via vale il passaggio che ha la fermata a destra. Con
l'inseguitore di percorso di #113, che sposta un asse alla volta, la zona può tornare a 12 + 12 (`FERMATA_INGRESSO` e
`FERMATA_USCITA` in `scripts/sosta.py`). Al capolinea il bus automatico arriva e riparte anche fuori dal percorso
della variante: per questo la zona è più larga.

## 4. Nel gioco

- `src/data/padova.js`: `net.stalli` (le file, con passo e profondità), `e.sede` per arco. `laneLayout` mette le corsie
  tra i bordi di `e.sede`.
- `src/world/city.js`, per area come edifici e alberi (`addSosta`, `fillSosta`): le righe bianche degli stalli e le
  auto ferme. Ogni stallo ha un numero fisso tra 0 e 1 ed è occupato se il numero sta sotto la quota dell'ora
  (`sostaQuota`: 90% la notte, 62% tra le 9 e le 17, 82% alle 20): le auto sono sempre le stesse e ne arrivano o ne
  partono poche alla volta. Sono istanze di una sola geometria da 72 triangoli e ostacoli per chi guida (`parked`:
  urtarne una è un urto come gli altri). `setSostaOra(ora)` le rifà quando la quota cambia di due stalli su cento.
- Traffico, con il minimo che serve: `Traffic.laneGeom` e `laneLat` dei bus automatici (`src/world/buses.js`) usano la
  corsia più a destra di `laneLayout` sugli archi con `e.sede`; sugli altri restano come prima (un quarto della
  carreggiata, 2,2 m dal bordo). Il bus automatico che si sposta per lasciare il binario del tram non va oltre il
  bordo degli stalli. Lo stesso fa il pilota delle prove (`tests/guida.js`).
- `scripts/raccordi.py` legge `sedeCorsie` (`corsie_arco`): i raccordi di corsia cominciano e finiscono sulle corsie
  strette. `scripts/sosta.py` usa la stessa funzione per le corsie: il conto è uno solo.

## 5. Controlli

`python3 scripts/sosta.py` (anche da `scripts/verifica_mappa.py`, quindi in CI) guarda gli stalli scritti nella mappa
uno per uno contro la rete, la pianta e i dati di oggi, con i casi noti in `data/eccezioni/sosta.json`: fuori
dall'asfalto, sulle corsie, agli incroci, alle fermate, sui passi carrai, sulla sede del tram, sovrapposti, su archi
non ammessi. La build li calcola già così, quindi gli elenchi sono vuoti: un caso compare se cambiano fermate, corsie
o pianta senza rifare gli stalli.

`tests/sosta.spec.js` guarda il gioco: la scena ha le righe di tutti gli stalli e un'auto con il suo ostacolo in quelli
occupati; nessuno stallo sta nella corsia che `Traffic.laneGeom` dà alle auto né nella carrozzeria dei bus automatici
lungo le corsie di tutte le varianti, accosto alle fermate compreso (`data/eccezioni/sosta-gioco.json`).

`python3 scripts/sosta.py --calcola` rifà il calcolo e dice quanti stalli scarta e perché; `--scrivi` lo scrive nella
mappa che c'è, per provare. La mappa pubblicata è quella di `scripts/rigenera_mappa.sh`.

## 6. Quanto copre ogni fonte

Rete carrabile: 11.110 vie OSM, 29.723 archi, 1.117 km, cioè 2.234 km di cordolo contando i due lati.

| Fonte | Vie OSM | Archi | File | Stalli | Cordolo con gli stalli |
|---|---|---|---|---|---|
| 1. tag OSM della via | 36 | 70 | 135 | 666 (625 in linea, 41 a pettine) | 3,2 km |
| 2. area OSM | 108 | 135 | 223 | 1.717 (1.551 a pettine, 90 in linea, 76 a spina) | 4,6 km |
| 3. DBGT | 175 | 217 | 355 | 1.249 (901 a pettine, 348 in linea) | 4,0 km |
| 4. larghezza | 961 | 1.472 | 2.596 | 19.783, tutti in linea | 98,9 km |
| in tutto | 1.199 | 1.833 | 3.309 | 23.415 | 110,7 km (5,0%) |

Le corsie sono strette dagli stalli su 1.865 archi. Le prime tre fonti dicono dove la sosta c'è di sicuro e coprono
319 vie; l'84% degli stalli viene dalla larghezza. Cosa scarta il calcolo e perché lo dice `--calcola`: per la
larghezza, i più sono fuori dalle aree urbane di OSM, in piazzali oltre 6,5 m dalla carreggiata, sulle corsie di un
altro arco o senza edifici vicini.

## 7. Campione sulla foto aerea

Archi estratti a caso per fonte (seme 2026), guardati sull'ortofoto Esri a zoom 19 con archi e stalli disegnati sopra.
La foto non ha data: le auto ferme dicono che lì si parcheggia, non com'è segnato.

| Fonte | Archi guardati | Esito |
|---|---|---|
| 1. tag OSM | 6 | 6 giusti: auto ferme dove stanno gli stalli, tipo giusto |
| 2. area OSM | 6 | 5 giusti, con gli stalli sopra le auto; 1 fuori dall'inquadratura |
| 3. DBGT, strade di servizio | 5 | 4 sbagliati (distributori di benzina, il tetto di una pensilina), 1 dubbio: tolto dalla fonte |
| 3. DBGT, altre vie | 6 | 4 giusti, 1 dubbio (uno stallo solo in un vicolo), 1 sbagliato (un parcheggio del 2007 dove oggi c'è un giardino) |
| 4. larghezza | 12 | in 9 la via ha davvero le auto in sosta (in 2 dal lato opposto o da un lato solo), 3 dubbi (alberi sopra la strada, tratti di tre stalli vicino a un incrocio) |

Due regole sono cambiate guardando la foto, prima di questo campione:

- la larghezza dava anche file a pettine dove avanzavano 5 m: su 6 archi, 2 sbagliati (stalli sopra giardini e case
  in una via di campagna e lungo una riviera) e 2 dubbi. Ora la larghezza dà solo file in linea;
- in campagna il DBGT conta nella carreggiata banchine e slarghi: una via tra i campi aveva gli stalli sull'erba. Da
  qui il vincolo delle aree urbane di OSM e dell'edificio entro 30 m, che toglie circa un terzo dei candidati.

Il lato, per la larghezza, non è un dato: quando lo spazio basta per una fila sola sta dal lato con più asfalto, e a
destra della via OSM se sono uguali.

## 8. Tempi e triangoli

Build di `main` (b5f2bd6) e build con la sosta, stesso script in pagina, Chromium con SwiftShader sul Mac.

| Misura | Prima | Dopo |
|---|---|---|
| `city.timings`, somma | 2.945 ms | 3.086 ms |
| di cui `buildRoads` | 1.284 ms | 1.354 ms |
| triangoli in scena al capolinea della 24 | 4.121.805 | 4.181.569 (1.149 stalli, 744 auto) |
| triangoli in scena in Via degli Scrovegni | 4.380.014 | 4.640.376 (5.087 stalli, 3.296 auto) |
| triangoli con tutta la mappa caricata | 5.876.277 | 7.092.350 (23.507 stalli, 15.481 auto alle 11) |
| un fotogramma in Via degli Scrovegni | 326 ms | 311 ms |

Righe e auto si costruiscono con l'area, non all'avvio: per area una mesh di righe e una di istanze. La rete nel bundle
cresce di 122 KB.

## 9. Lasciato fuori

- Colore delle righe: tutte bianche. OSM dice dove la sosta è a pagamento (`fee`), ma solo per le aree.
- Stalli riservati (disabili, carico e scarico, taxi) e divieti a orario.
- Le auto ferme non entrano e non escono dagli stalli: compaiono e spariscono con l'ora, poche alla volta.
- I parcheggi veri (piazzali con le loro corsie) restano asfalto vuoto: qui ci sono solo le file lungo le vie.
- Gli alberi e i lampioni sparsi che il gioco posa a caso al caricamento (#132) cambiano posto quando cambia la
  pianta: tre vedute di riferimento sono cambiate solo per questo.
