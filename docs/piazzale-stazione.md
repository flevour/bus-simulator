# Piazzale della stazione: corsie, fermate e versi

Controllo del 9 novembre 2026 sulla segnalazione "le fermate non corrispondono alle corsie e gli autobus partono a
caso" (sondaggio del 7 novembre). Confronta, linea per linea, dove il tracciato GTFS di BusOne fa partire e arrivare
il bus con dove lo fa il gioco (corsa del giocatore e bus automatici usano lo stesso percorso, `buildRoute`).

## Com'è fatto il capolinea

Coordinate del gioco (x verso est, z verso sud, in metri). Tutte le corsie del capolinea sono a senso unico verso
ovest; la strada sud è a senso unico verso est.

| Tratto | Dove | Nella rete del gioco |
|---|---|---|
| corsia nord | da (295, -1024) a (163, -1053), lungo la banchina verso la stazione | un arco solo da 135 m (nodi 7643 → 7644) |
| corsia sud | da (303, -1013) a (162, -1044), con l'isola in mezzo alle due corsie | 7641 → 7642 |
| raccordo ovest | dove le corsie escono verso Corso del Popolo, (163, -1053) → (157, -1024) | 7644 → 7642 → 3712 → 3713 → 7123 |
| strada sud | Piazzale della Stazione verso est, da (159, -1029) all'entrata bus (275, -999) | 3713 → 3709 → 11978 |

Fermate GTFS: Corsia 1 (189, -1060) e Corsia 2 (189, -1051) dalla parte della corsia nord, Corsia 3 (176, -1042) in
fondo alla corsia sud, Ex Catasto (212, -1014) sulla strada sud. Le paline OSM delle corsie 1 e 2 sono a nord della
corsia nord, (199, -1051) e (200, -1052); quella della corsia 3 sull'isola, (196, -1040).

I bus che arrivano da est entrano dall'entrata bus e percorrono una delle due corsie; quelli che arrivano da ovest
(Corso del Popolo) fanno la strada sud verso est e verso x = 231 passano nella corsia sud (GTFS: (231, -1011) →
(235, -1026)); chi arriva da est alla corsia 3 passa dalla corsia nord alla corsia sud verso x = 190 (GTFS:
(193, -1046) → (190, -1037)). Le partenze verso est dalle corsie 2 e 3 escono a ovest, scendono per il raccordo e
tornano verso est sulla strada sud.

## Linea per linea

P partenza, A arrivo; corse feriali e festive del gioco. "Contromano" vuol dire che il percorso entra nella corsia
sud da ovest (senso vietato), arriva in fondo e torna indietro.

| Linea | | Fermata | Tracciato GTFS | Gioco | Esito |
|---|---|---|---|---|---|
| 3 | P | Corsia 1 | corsia nord | corsia nord | giusto, ma senza palina |
| 3 | A | Corsia 1 | corsia sud | strada sud, prima del capolinea | sbagliato (passaggio mancante) |
| 3 | A | Ex Catasto | strada sud | corsia sud | sbagliato (fermata Ex Catasto) |
| 4 | P | Corsia 3 | raccordo ovest, a volte corsia nord | corsia sud, a volte corsia nord | giusto |
| 4 | A | Ex Catasto | strada sud | metà strada sud, metà corsia sud | in parte |
| 6 | P | Corsia 3 | raccordo ovest o strada sud | strada sud | sbagliato (partenza dopo la fermata) |
| 6 | A | Corsia 3 | corsia sud | corsia nord | sbagliato (attraversamento mancante) |
| 6 | A | Ex Catasto | strada sud | metà strada sud, metà corsia sud | in parte |
| 7 | P, A | Corsia 2 | corsia nord | corsia nord | giusto, ma senza palina |
| 9 | P | Corsia 3 | raccordo ovest | corsia sud | giusto |
| 9 | A | Corsia 3 | corsia sud | corsia nord | sbagliato (attraversamento mancante) |
| 9 | P | Ex Catasto | strada sud | strada sud | giusto |
| 9 | A | Ex Catasto | strada sud | corsia sud | sbagliato (fermata Ex Catasto) |
| 10 | P | Corsia 1 | corsia nord | corsia nord | giusto, ma senza palina |
| 10 | A | Corsia 1 | corsia nord | corsia nord | giusto, ma senza palina |
| 10 | P | Ex Catasto | strada sud | strada sud | giusto |
| 10 | A | Ex Catasto | strada sud | corsia sud | sbagliato (fermata Ex Catasto) |
| 11 | P | Corsia 1 | corsia nord | corsia nord | giusto, ma senza palina |
| 11B | A | Ex Catasto | strada sud | corsia sud | sbagliato (fermata Ex Catasto) |
| 12 | P | Corsia 3 | raccordo ovest | corsia sud | giusto |
| 12 | A | Corsia 3 | corsia sud | corsia sud, contromano | sbagliato (passaggio mancante) |
| 14 | P | Corsia 3 | strada sud (101 corse), raccordo ovest (13) | strada sud | sbagliato (partenza dopo la fermata) |
| 14 | A | Corsia 3 | corsia sud | corsia nord, a volte corsia sud contromano | sbagliato (tutti e due i passaggi) |
| 15B | A | Corsia 3 | corsia sud | corsia nord | sbagliato (attraversamento mancante) |
| 16 | P | Corsia 3 | raccordo ovest | corsia sud | giusto |
| 16 | A | Corsia 3 | corsia sud | corsia sud, contromano | sbagliato (passaggio mancante) |
| 16, 19, 88 | A | Ex Catasto | strada sud | corsia sud | sbagliato (fermata Ex Catasto) |
| 21 | P | Corsia 3 | raccordo ovest | corsia sud | giusto |
| 21 | A | Corsia 3 | corsia sud | corsia sud, contromano | sbagliato (passaggio mancante) |
| 24 | P, A | Ex Catasto | strada sud | strada sud | giusto |
| 24 | A | Corsia 3 | corsia sud | corsia nord | sbagliato (attraversamento mancante) |
| 25 | P | Corsia 2 | corsia nord | strada sud | sbagliato (partenza dal nodo sbagliato) |
| 25 | A | Corsia 2 | corsia nord | corsia nord | giusto, ma senza palina |
| 88 | P | Corsia 1 | corsia nord | corsia nord | giusto, ma senza palina |

## Le cause

1. **Banchina delle corsie 1 e 2 asfaltata.** Nella pianta delle strade a nord della corsia nord c'è asfalto per più
   di 12 m, fino alla sede del tram (l'area OSM 47586895, `highway=pedestrian` con `psv=yes`, e il bordo della
   piazza 46528079). La palina non trova il marciapiede e non viene messa: la Corsia 1 finisce sulla strada sud
   (x = 183), dove passano gli arrivi, e la Corsia 2 non c'è. È la ragione per cui "le fermate non corrispondono alle
   corsie". Dati della mappa (`street_surfaces.py`).
2. **Passaggio dalla strada sud alla corsia sud verso x = 231.** Non c'è nella rete (né in OSM). Gli arrivi da ovest
   alla corsia 3 (12, 16, 21) entrano contromano nella corsia sud dal raccordo ovest e fanno inversione in fondo; la 3
   finisce sulla strada sud prima del capolinea. Dati della mappa (`build_map.py`).
3. **Attraversamento dalla corsia nord alla corsia sud verso x = 190.** Manca anche questo: gli arrivi da est alla
   corsia 3 (6, 9, 14, 15B, 24) si fermano nella corsia nord. Dati della mappa.
4. **Fermata Ex Catasto agganciata alla palina OSM dell'isola** (223, -1036), a 22 m dalla posizione GTFS sulla
   strada sud: gli arrivi che passano dalla corsia sud ci si fermano. Sulla strada sud non c'è una palina OSM: lì
   meglio tenere la posizione GTFS. Dati della mappa (`snap_stops_to_osm`).
5. **Partenze che cominciano dopo la fermata.** Il tracciato GTFS della 14 e della 6 verso est comincia sulla strada
   sud, senza il pezzo dalla corsia 3; quello della 25 comincia nella corsia nord, ma l'aggancio parte dal nodo 7644 in
   fondo all'arco da 135 m. In tutti e due i casi la prima fermata viene proiettata sulla strada sud e il bus parte da
   lì. La partenza va fatta cominciare dalla fermata (corsia sud o corsia nord). Dati della mappa (`match()`,
   `extend_to_stop`).

Nel codice del gioco c'era un solo errore: due paline nello stesso verso a meno di 12 m si scartavano a vicenda
anche su corsie parallele (le corsie nord e sud sono a 10 m), quindi sistemata la banchina la Corsia 1 avrebbe tolto
la Corsia 3. Ora si scartano solo sulla stessa corsia (`allStopPlacements` in `src/game/routes.js`). Corsia 1 e
Corsia 2 restano una palina sola: OSM le mette a 1,8 m l'una dall'altra.

Strumenti usati (non nel repo): classificazione dei tracciati GTFS per corsia dal feed BusOne e dei percorsi del
gioco da `buildRoute`, e una vista dall'alto del piazzale con paline e corsie dei bus automatici.
