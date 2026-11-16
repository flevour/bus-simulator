# Dati OSM oltre le vie: relazioni, tag per arco, luoghi e arredo (#108)

`data/osm-padova.json` e `data/osm-corridoio.json` hanno solo le vie, scaricate il 4 novembre 2026, e non si
riscaricano: le vie di oggi non sono più quelle e cambierebbe tutta la rete. Quello che serve in più sta in file
accanto e si aggancia alle vie dello scarico per id. Questo documento dice cosa c'è, come entra nella mappa e quanto
copre, per decidere la sosta (#111), i raccordi di corsia (#112) e la domanda di traffico (#116).

Numeri del 13 novembre 2026, sulla rete di `main`: 30.295 archi, 11.435 vie OSM, 1.132 km. Si ristampano con
`python3 scripts/osm_rete.py`.

## 1. File e comandi

| File | Query | Filtro | Cosa |
|---|---|---|---|
| `data/osm-padova-relazioni.json` (0,3 MB) | `scripts/overpass-relazioni.ql` | `scripts/filter_osm_relazioni.py` | 1.030 svolte vietate e obbligate (`type=restriction`), 100 percorsi di linea (`type=route`) con almeno una via negli scarichi |
| `data/osm-luoghi.json` (3,6 MB) | `scripts/overpass-luoghi.ql` | `scripts/filter_osm_luoghi.py` | 6.266 parcheggi, stalli e ingressi, 4.154 aree di uso del suolo, 1.958 scuole, università, ospedali e negozi |
| `data/osm-arredo.json` (0,7 MB) | `scripts/overpass-arredo.ql` | `scripts/filter_osm_luoghi.py` | 4.572 barriere, 4.225 lampioni, 8.062 alberi singoli |

L'area è il rettangolo dei nodi della rete allargato di 400 m. I comandi sono nel README. Overpass risponde spesso 502
o 504: si riprova, anche su un altro server pubblico (`https://maps.mail.ru/osm/tools/overpass/api/interpreter` ha
risposto quando `overpass-api.de` era saturo), con un user agent generico.

I tag delle vie (`parking:*`, `embankment`, `cutting`, `incline`, `surface`, `smoothness`, `lit`) si leggono dagli
scarichi delle vie.

## 2. Aggancio alla rete

La rete della mappa non porta gli id di OSM. `scripts/osm_rete.py` (`Aggancio`) li ritrova dalla rete e dagli scarichi:
un nodo della rete è il nodo OSM con le sue coordinate, un arco è il tratto di una via tra due suoi nodi di fila che
stanno nella rete, con la stessa classe, lo stesso nome e lo stesso senso unico. Sulla rete di `main` trova la via di
tutti i 30.295 archi, senza archi contesi. `build_map.py` sa da quale via viene ogni arco e si ferma se `Aggancio` non
dà la stessa: così lo strumento che scrive i soli campi (`python3 scripts/osm_rete.py --scrivi`) e la build danno gli
stessi campi. Provato il 13 novembre con una build intera a parte (feed GTFS del 9 novembre): nodi, archi e i cinque
campi identici.

Un arco va sempre da `a` verso `b` nel verso della via OSM. Destra e sinistra sono quelle di chi va da `a` verso `b`.

## 3. Campi nella mappa

Stanno nella rete (`src/data/padova-map.json`), dopo `turnLanes`. Il gioco ancora non li legge. Peso: 79.957 byte in
più su 10,7 MB (0,75%), 19 KB in più compressa. Parcheggi, uso del suolo, luoghi e arredo non entrano nella mappa:
servono alla build dei ticket che li usano, e nei file per area andrà quello che loro decidono di disegnare.

| Campo | Formato | Byte |
|---|---|---|
| `svolte` | `[nodo, arco da, arco a, tipo, eccezioni]`, più `[archi via]` quando la svolta passa da una via | 12.341 |
| `sosta` | `[arco, sinistra, destra]` | 3.625 |
| `rilevati` | `[arco, rilevato, trincea]`: 1 sui due lati, 2 solo a sinistra, 3 solo a destra, 0 no | 6.854 |
| `pendenze` | `[arco, verso, percento]`: verso 1 sale da `a` a `b`, -1 scende, 0 in piano; percento 0 se OSM dice solo il verso | 4.812 |
| `fondo` | `{superfici, regolarita, corse}`: `corse` è `[quanti archi, superficie, regolarità, luce, ...]`, archi di fila con gli stessi valori | 52.273 |

`svolte`. `tipo` è il posto in `SVOLTE` di `osm_rete.py`: 0 `no_left_turn`, 1 `no_right_turn`, 2 `no_straight_on`,
3 `no_u_turn`, 4 `only_left_turn`, 5 `only_right_turn`, 6 `only_straight_on`. Da 0 a 3 la manovra dall'arco `da`
all'arco `a` in quel nodo è vietata; da 4 a 6 dall'arco `da` si può prendere solo l'arco `a`. `eccezioni` è una somma:
1 non vale per i bus (`except=psv` o `bus`), 2 vale solo in certe ore, 4 non vale per i frontisti. L'arco `da` arriva
al nodo e l'arco `a` ne parte: il verso di percorrenza si legge da quale capo dell'arco è il nodo. Le voci sono in
ordine di nodo.

`sosta`. Ogni lato è `posto + 16 × verso`. Posto: 1 vietata, 2 in carreggiata (`lane`), 3 in un golfo a lato
(`street_side`), 4 sul marciapiede, 5 a cavallo del cordolo, 6 sulla banchina, 7 disegnata a parte come area
(`separate`), 8 ammessa senza dire dove. Verso degli stalli: 1 in linea, 2 a spina, 3 a pettine, 0 non detto. Vale lo
schema nuovo (`parking:left|right|both`) e, dove manca, il vecchio (`parking:lane:*`).

`fondo`. Superficie e regolarità sono il posto nella legenda più uno, 0 se OSM non lo dice; luce 1 illuminata, 2 no,
0 non detto. Le corse coprono tutti gli archi, nell'ordine.

## 4. Quanto copre OSM

| Dato | Vie | Archi | km | Quota della rete |
|---|---|---|---|---|
| superficie | 8.412 | 22.948 | 853,4 | 75,4% |
| superficie diversa dall'asfalto | 741 | 1.644 | 56,2 | 5,0% |
| illuminazione detta | 3.551 | 10.378 | 410,0 | 36,2% |
| regolarità del fondo | 2.540 | 6.975 | 276,3 | 24,4% |
| rilevato | 201 | 528 | 31,4 | 2,8% |
| trincea | 33 | 60 | 2,3 | 0,2% |
| pendenza dichiarata | 215 | 393 | 15,5 | 1,4% |
| pendenza con il valore | 60 | 128 | 7,9 | 0,7% |
| sosta detta, anche "vietata" | 122 | 301 | 12,8 | 1,1% |
| sosta ammessa su almeno un lato | 55 | 130 | 6,5 | 0,6% |

Letti e contati, non portati nella mappa (nessun ticket li chiede ancora): `cycleway:*` su 1.004 vie (84,4 km),
`access`, `vehicle` o `motor_vehicle` su 549 (37,8 km), divieti a orario `*:conditional` su 443 (80,3 km: è la ZTL,
`motor_vehicle:conditional=no @ (Mo-Fr 08:00-20:00)` e simili), `maxheight` su 105, `maxweight` su 42, `maxwidth` su
30, `destination` su 114.

Dove OSM basta e dove no:

- Superficie: basta. Tre quarti della rete ce l'hanno, e dove manca è quasi sempre asfalto. I 56 km non asfaltati
  (porfido, lastre, ghiaia) sono il dato che cambia qualcosa nel gioco.
- Illuminazione: copre un terzo della rete, e 3.368 vie su 3.551 dicono "sì". Dice dove c'è luce e quasi mai dove non
  c'è. I 4.225 lampioni singoli sono concentrati in poche zone: 2.923 stanno entro 300 m dalla rete. Per mettere i
  lampioni veri non basta; per spegnerli sulle 183 vie con `lit=no` sì.
- Rilevati e pendenze: pochi e sparsi. 31 km di rilevato sono un controllo utile per le rampe dei cavalcavia (#107 e
  seguenti: un arco in quota senza `embankment` né ponte, o il contrario), non una fonte delle quote. Le pendenze con
  un valore sono 60 vie, di cui 57 dicono "0%".
- Sosta lungo le strade dai tag delle vie: non basta. 6,5 km su 1.132 hanno la sosta ammessa. A Padova la sosta è
  mappata come area, non come tag della via (sezione 6).

## 5. Svolte vietate e obbligate

Delle 1.030 relazioni, 536 sono agganciate a un nodo e a due archi della rete, 412 non toccano la rete (fuori
dall'area) e 82 la toccano senza agganciarsi. Le 536: 279 `only_straight_on`, 122 `only_right_turn`, 62 `no_u_turn`,
51 `no_left_turn`, 18 `only_left_turn`, 3 `no_right_turn`, 1 `no_straight_on`, su 472 nodi. Tre hanno l'eccezione per
i bus, tre passano da una via invece che da un nodo, nessuna è a orario.

Quante non si agganciano più perché OSM è cambiato dopo lo scarico: nessuna. Due relazioni usano una via nata il 5
novembre (una via dello scarico spezzata il giorno dopo) e si agganciano lo stesso dal nodo accanto al nodo "via": il
filtro tiene, per ogni relazione, i nodi che nella via di oggi stanno accanto al nodo "via", e `osm_rete.py` cerca la
via dello scarico che ha quei due nodi di fila. Così regge anche i prossimi scarichi delle relazioni, con le vie ferme
al 4 novembre.

Le 82 non agganciate, caso per caso in `data/eccezioni/osm-rete.json`:

| Quante | Perché |
|---|---|
| 29 | una delle due vie è negli scarichi ma non nella rete: fuori dall'area di gioco, o corsia di parcheggio, passo carraio, strada di servizio chiusa che la build salta |
| 26 | in OSM alla relazione manca un membro (la via da, la via a o il nodo via) |
| 21 | una delle due vie non è negli scarichi: fuori dalle aree scaricate o di un tipo che lo scarico non ha (track, path, cycleway). Nessuna è stata modificata dopo il 4 novembre (API di OSM, 13 novembre) |
| 3 | la via è a senso unico nel verso opposto a quello della svolta: il senso unico già la vieta |
| 2 | la via a passa dal nodo via senza finirci, a doppio senso: OSM non dice da quale parte si esce |
| 1 | della via da (un passo carraio) la rete tiene solo il pezzo dove passa il bus |

Due controlli sulle svolte agganciate, con gli stessi elenchi:

- coerenza con la geometria: una svolta a sinistra deve andare a sinistra di almeno 10 gradi, una a destra a destra, un
  "diritto" entro 70 gradi, un'inversione oltre 110. Su 533 svolte in un nodo ne esce una, un errore in OSM (il membro
  "a" è dalla parte sbagliata dell'incrocio);
- percorsi dei bus: 3 passaggi su una svolta che OSM vieta anche ai bus. La 4 al Piazzale Castagnara, in due nodi, esce
  di lato dove c'è l'obbligo di andare diritto; la 15B a Largo Europa fa l'inversione vietata verso Via Matteotti. Sono
  di #114.

Per #112: le svolte vietate non dicono tutto. Le obbligate sono il 78%, e vanno lette come "dall'arco `da` tutte le
altre uscite sono vietate". 673 barriere stanno su un nodo di una via della rete (444 cancelli, 108 dissuasori, 45
sbarre, 21 blocchi, 16 limitatori d'altezza): un dissuasore in carreggiata chiude la via alle auto quanto un divieto,
e oggi la rete non lo sa.

## 6. Parcheggi, uso del suolo, luoghi (per #111 e #116)

Parcheggi (`amenity=parking`): 2.507, di cui 1.561 entro 300 m dalla rete.

| Tipo | Quanti | Ettari | Con i posti (`capacity`) |
|---|---|---|---|
| a raso (`surface`) | 1.295 | 164,9 | 256 |
| non detto | 622 | 53,6 | 31 |
| lungo la strada (`street_side`) | 548 | 10,0 | 181 |
| multipiano | 9 | 2,5 | 4 |
| interrati | 9 | 0,6 | 0 |
| sul tetto | 7 | 3,3 | 1 |

L'accesso è detto per 870 (485 pubblici, 204 per i clienti, 147 privati). Gli stalli disegnati uno per uno
(`parking_space`) sono 3.613, 2.819 con il contorno; gli ingressi dei parcheggi 146.

Per #111: la sosta lungo le strade si prende dalle 548 aree `street_side` (10 ettari, con il contorno) e dagli stalli
singoli, non dai tag delle vie. Coprono le zone mappate con cura e lasciano scoperte le altre: dove non c'è niente OSM
non dice se la sosta manca o se nessuno l'ha mappata, e serve una regola per tipo di strada o il DBGT.

Uso del suolo: 4.154 aree. Residenziale 544 aree per 47,5 km², agricolo 1.607 per 41,2, industriale 144 per 15,8,
commerciale 94 per 2,1; il resto è verde, bosco, ferrovia, militare. Luoghi: 157 scuole, 45 asili, 60 sedi
universitarie, 18 ospedali, 1.651 negozi (192 abbigliamento, 136 supermercati); 336 hanno il contorno, gli altri sono
punti. Entro 300 m dalla rete: 1.574 luoghi e 1.871 aree.

Per #116: residenziale, industriale e commerciale bastano per dire dove nasce e dove arriva il traffico a grana
grossa. Le scuole ci sono ma senza numeri: una sola ha `capacity`, 31 su 157 hanno il grado (`isced:level`). Gli orari
di punta vanno messi per tipo di luogo, non letti da OSM. I negozi sono fitti in centro e radi fuori: come peso
relativo tra zone tendono a sottostimare la periferia.

## 7. Linee dei bus: relazioni OSM e aggancio GTFS

Per ogni linea del gioco, quanta parte del percorso agganciato al GTFS sta su vie della relazione OSM con lo stesso
numero (tutte le direzioni insieme):

| Linea | km del percorso | Sulle vie della relazione |
|---|---|---|
| 42 | 16,5 | 99% |
| 12 | 5,9 | 98% |
| 10 | 19,8 | 92% |
| 11 | 15,9 | 92% |
| 9 | 15,4 | 91% |
| 13 | 16,6 | 86% |
| 7 | 8,8 | 78% |
| 24 | 25,9 | 76% |
| 22 | 26,1 | 73% |
| 6 | 19,1 | 72% |
| 3 | 17,8 | 64% |
| 16 | 16,4 | 52% |
| 88 | 19,7 | 24% |
| 19 | 6,8 | 21% |

Senza relazione in OSM: 2, 4, 5, 11B, 14, 15B, 21, 25. Le relazioni OSM non sono una fonte migliore del GTFS: mancano
per 8 linee su 22, spesso hanno una sola direzione o una sola variante (la 24 e la 88 ne hanno una), e nessuno le
aggiorna con gli orari. Servono come secondo parere: una linea sotto il 70% è da guardare, perché o la relazione è
vecchia o l'aggancio ha preso un'altra via (per la 88 e la 19 il gioco ha più varianti di quelle mappate).

## 8. Controlli

`scripts/osm_rete.py` (anche da `scripts/verifica_mappa.py`, quindi in CI) controlla, con i casi noti in
`data/eccezioni/osm-rete.json`:

- i cinque campi della mappa sono quelli che danno gli scarichi: chi cambia la rete o riscarica le relazioni li
  riscrive con `--scrivi`, o rigenera;
- `svolte_non_agganciate`, `svolte_incoerenti`, `percorsi_su_svolta_vietata` (sezione 5).

`python3 scripts/osm_rete.py --aggiorna` riscrive l'elenco dai casi di oggi, `--elenco` li stampa.
