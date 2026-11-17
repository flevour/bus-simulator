# Percorsi delle linee guidabili da un bus (#114)

Il percorso di ogni variante di ogni linea lo fa la build, e la build lo controlla: ogni passo deve essere uno che un
bus vero può fare. Prima di #114 i percorsi uscivano dall'aggancio del tracciato GTFS alla rete con contromano,
inversioni e svolte vietate, e il gioco ne toglieva una parte al caricamento (`spurs` di `buildRoute` in
`src/game/routes.js`); quelli rimasti si vedevano nei bus automatici che giravano sul posto o andavano avanti e indietro
in una laterale (#32, #36).

Numeri del 16 novembre 2026, sulla mappa di `main`. Si ristampano con `python3 scripts/percorsi.py`.

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
   corsia dei bus in controsenso il 19 dicembre 2025 e le 31 varianti dirette alla stazione andavano contromano.
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

<!-- numeri da completare dopo la rigenerazione -->
