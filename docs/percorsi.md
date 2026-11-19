# Percorsi delle linee guidabili da un bus (#114)

Il percorso di ogni variante di ogni linea lo fa la build, e la build lo controlla: ogni passo deve essere uno che un
bus vero può fare. Prima di #114 i percorsi uscivano dall'aggancio del tracciato GTFS alla rete con contromano,
inversioni e svolte vietate, e il gioco ne toglieva una parte al caricamento (`spurs` di `buildRoute` in
`src/game/routes.js`); quelli rimasti si vedevano nei bus automatici che giravano sul posto o andavano avanti e indietro
in una laterale (#32, #36).

Numeri del 17 novembre 2026, sulla mappa rigenerata con `scripts/rigenera_mappa.sh`. Si ristampano con `python3 scripts/percorsi.py`.

## 1. La regola

Per ogni variante, sul cammino di nodi della mappa (`lines[].variants[].nodes`, senza i nodi ripetuti di fila come fa
`expandSeq` del gioco):

| Controllo | Cosa non va |
|---|---|
| `salti` | due nodi di fila senza un arco tra loro: il gioco li unisce con un tratto dritto, attraverso quello che c'è |
| `contromano` | un arco a senso unico percorso contro il suo verso dove i bus non hanno la corsia in controsenso (flag 256, `busway=opposite_lane` e simili), o una via pedonale |
| `inversioni` | il percorso torna indietro sullo stesso arco (A-B-A) |
| `svolte_vietate` | una svolta che OSM vieta anche ai bus, senza `except=psv` o `bus` (campo `svolte`, [osm-dati.md](osm-dati.md) sezione 5): una vietata, o un'altra dove la svolta è obbligata |
| `senza_raccordo` | una svolta ammessa senza un raccordo di corsia per il mezzo della linea ([raccordi.md](raccordi.md)): lo snodato per le linee di `SNODATI`, il bus da 12 m per le altre. "solo auto" se c'è il raccordo delle auto ma con un raggio sotto quello del bus, "senza curva" se non ce n'è nessuno |
| `corsie_slegate` | due svolte di fila, tutte e due con il raccordo del mezzo, che con i raccordi che sceglie il gioco (`percorso_bus` di `scripts/raccordi.py`, come `percorsoBus` di `src/world/inseguitore.js`) stanno su corsie diverse senza il posto per cambiarla, o si sovrappongono: lì il bus farebbe una curva del gioco (#135). Le svolte vicine a una senza raccordo non contano: sono di `senza_raccordo` |

Le svolte che già non vanno per un altro controllo (un arco contromano, un'inversione, una svolta vietata) non si
contano anche come svolte senza raccordo. Le svolte che passano da una via (tre in tutta la mappa) non valgono, come per
i raccordi.

## 2. Cosa fa la build

L'aggancio resta quello di `build_map.py` (`match`, poi `no_uturns`, `extend_to_stop`, `stop_edge`, `terminal_lane`,
`stop_lanes`, `drop_spurs`, `cut_path`; [LAVORO.md](LAVORO.md), sezione Mappa). Tre cose in più, in quest'ordine.

1. Tag corretti. `data/osm-correzioni.json` ha una riga per ogni via degli scarichi OSM con un tag sbagliato, con il
   perché verificato: `osm_rete.correggi` li sostituisce appena letti gli scarichi, nella build e in
   `osm_rete.leggi_vie` (quindi anche nei controlli dei dati OSM). La build si ferma se la via non c'è più o ha già
   quei tag. Oggi c'è una riga: Corso del Popolo tra Via Trieste e Via Foscolo (via 23555665), dove OSM ha perso la
   corsia dei bus in controsenso il 19 dicembre 2025 e le 33 varianti dirette alla stazione andavano contromano.
2. Aggancio per pezzi. Un tracciato che esce dall'area e rientra si aggancia per pezzi e si tiene quello con più
   fermate. Prima succedeva solo se il percorso agganciato era più lungo di una volta e mezzo il tracciato (pezzi
   separati da almeno 300 m senza strade). Ora anche se il percorso salta da un nodo a un altro senza strada, o se si
   allontana dal tracciato più di `GIRO_SCARTO` (40 m) per più di `GIRO_LUNGO` (200 m) di fila (`giro`): allora i pezzi
   sono separati da almeno `BUCO` (100 m) senza strade, e il pezzo si prende se non ha salti e non fa un giro più lungo.
   È il caso della 4 verso Cadoneghe: la rotonda a nord del Piazzale Castagnara e il raccordo con Via Gramsci non sono
   negli scarichi, e l'aggancio al loro posto girava 550 m nel quartiere, contromano in Via Italo Bordin e con due
   svolte vietate, per tornare indietro in fondo a Via Gramsci.
3. Riparazione (`ripara`), dopo `cut_path`. Per ogni passaggio che un bus non può fare (contromano, inversione, svolta
   vietata: `passi_male`), uno alla volta, la build prova:
   - un giro attorno al passaggio che torna nello stesso nodo, tolto (fino a `RIPARA_GIRO` nodi prima e dopo);
   - un pezzo attorno al passaggio, fino a `RIPARA_NODI` nodi prima e dopo, sostituito dal cammino del bus tra i suoi
     capi (`via_bus`: i costi dell'aggancio, senza contromano, inversioni e svolte vietate, arrivando e ripartendo
     senza inversioni né svolte vietate);
   - il pezzo in testa o in coda tolto, se il percorso non comincia o finisce al bordo della mappa (un nodo con un arco
     solo: `cutStart` e `cutEnd` in `src/main.js` restano quelli di prima).

   Vale prima un cambio che lascia uguali il primo e l'ultimo nodo, il più corto; poi i tagli di testa o coda, il più
   piccolo. Ogni cambio deve lasciare meno passaggi sbagliati di prima, aggiungere al più `RIPARA_IN_PIU` (300 m) e
   non allontanare le fermate: ognuna resta entro `FERMATA_VICINA` (20 m) dal percorso, o entro `FERMATA_PEGGIO` (5 m)
   più di prima se ci stava già più lontana (le fermate in ordine sui tratti, come in `cut_path`). Un passaggio senza
   un cambio che vada resta, e lo conta il controllo.

I percorsi che non hanno niente da riparare escono uguali a prima, nodo per nodo.

## 3. Il controllo

`scripts/percorsi.py` legge la mappa (rete, linee, `svolte`, `raccordi`) e confronta i casi con l'elenco dei casi noti
in `data/eccezioni/percorsi.json` (`scripts/eccezioni.py`, regola 12 di [LAVORO.md](LAVORO.md)). La chiave di un caso è
`linea L, variante, cosa e vie @ x,z`, con il posto in metri del gioco (il nodo dove comincia l'arco o dove si svolta) e
3 m di tolleranza.

- `build_map.py` lo lancia alla fine, con la mappa già scritta: un caso nuovo, o uno dell'elenco sparito, ferma la
  build con l'elenco dei casi (quindi `scripts/rigenera_mappa.sh` esce prima della posa dell'arredo, e il job
  `rigenera` della CI è rosso);
- `scripts/verifica_mappa.py` lo lancia sulla mappa del repository (job `mappa` della CI);
- `python3 scripts/percorsi.py --elenco` stampa i casi, `--aggiorna` riscrive l'elenco (i casi nuovi vanno in un
  gruppo con il perché vuoto, da scrivere).

Chi cambia rete, svolte, corsie, pianta o raccordi rigenera la mappa e vede qui se un percorso non si guida più.

## 4. Casi di oggi

137 varianti di 22 linee, 34.175 svolte. Prima e dopo #114, contando i casi per variante:

| Controllo | Prima | Dopo | Cosa li ha tolti |
|---|---|---|---|
| `salti` | 3 | 0 | la 19 a nord di Pontevigodarzere: aggancio per pezzi, si tiene il pezzo con più fermate (una fermata in meno per variante) |
| `contromano` | 111 | 0 | 99 in Corso del Popolo verso la stazione (33 varianti, tre archi): la correzione del tag; 2 della 4 in Via Italo Bordin: aggancio per pezzi; 3 della 11B in Via Montà, 3 della 22 a Mandria, 4 della 16 e della 24 al Capolinea Plebiscito: riparazione |
| `inversioni` | 9 | 0 | 5 della 4 in fondo a Via Gramsci: aggancio per pezzi; 4 della 16 e della 24 al Capolinea Plebiscito: riparazione |
| `svolte_vietate` | 9 | 0 | 8 della 4 al Piazzale Castagnara (5) e sulla stradina di servizio di Via Pontevigodarzere (3): aggancio per pezzi e riparazione; 1 della 15B a Largo Europa: riparazione (un giro dell'isolato fatto due volte) |
| `senza_raccordo` | 327 | 310 | 17 stavano sui giri tolti; le altre (275 "solo auto", 35 "senza curva") sono di #134 |

Contate per linea, come faceva `bus_senza_raccordo` di `scripts/raccordi.py`, le svolte senza raccordo erano 213 (124
solo auto, 18 senza curva, 66 svolte non ammesse, 5 inversioni) e sono 133, tutte nei due gruppi di #134: nessuna è
nuova.

Con le rotonde di #143 (19 novembre: nell'anello si prosegue da ogni corsia e si passa alla corsia esterna) le svolte
senza raccordo per variante sono 296 (262 solo auto, 34 senza curva): 14 in meno, nelle rotonde di Via della Salutare
(13), Via Facciolati (14 e 16), Via Bembo (3) e in quella a (-894, 6153) sulla 88.

I percorsi cambiati, 27 varianti (più le 33 che passano da Corso del Popolo, con gli stessi nodi e il controsenso dei
bus sui tre archi):

| Dove | Varianti | Cosa cambia |
|---|---|---|
| Pontevigodarzere, Piazzale Castagnara (1450, -4600) | 4: sei varianti verso o da Cadoneghe e Bragni | il pezzo con più fermate: "Cap Nord Tram - Cadoneghe" e "Cadoneghe - Capolinea Nord Tram" tengono il pezzo di Via Gramsci (7 fermate su 11 e 10), le altre tre il pezzo in città fino al Piazzale Castagnara (16, 14 e 33 fermate su 23, 21 e 40); "Cap Nord Tram - Bragni" non passa più dalla stradina di servizio con l'obbligo di andare diritto |
| a nord di Pontevigodarzere (1000, -4900) | 19: tre varianti | il tracciato esce dalla mappa per 400 m: si tiene il pezzo con più fermate, invece del salto in linea retta |
| Capolinea Plebiscito (1650, -3000) | 16: due; 24: due | il giro attorno al palazzetto come dicono i sensi unici, fino alla sosta in fondo alla corsia est (da dove riparte "Plebiscito Pontecorvo"), senza avanti e indietro nel parcheggio |
| Largo Europa (-30, -420) | 15B: una | un giro dell'isolato in meno (366 m) e niente inversione vietata |
| Mandria (-3590, 4100) | 22: tre | si entra nella corsia del capolinea dall'ingresso, 10 m in più |
| Via Montà (-3700, -4430) | 11B: tre | finisce 23 m prima: la carreggiata verso nord, la Lungargine Ponterotto, è fuori dall'area |
| Via Sorio (-2050, 785) | 12: sei; 6: una | partono 95 m prima: l'aggancio per pezzi toglie dal tracciato agganciato il giro di #36, che `cut_path` già tagliava |

Restano giri legali lontani dal tracciato, che questo controllo non vede (non sono contromano né svolte vietate): la 4 e
la 19 tra Via Giotto e Corso Garibaldi (500 m per Via Matteotti e Largo Europa, dove il collegamento del tracciato non
è negli scarichi) e la 4 nel piazzale della stazione (270 m). Sono in un'issue a parte, con le strade che mancano ai
bordi della mappa.
