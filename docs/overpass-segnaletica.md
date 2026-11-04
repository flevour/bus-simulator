# Segnaletica reale da OpenStreetMap (Overpass)

L'export `data/osm-padova.json` contiene solo le *way* (strade, edifici, binari, acque). I nodi con la segnaletica
arrivano da una seconda query e finiscono in `data/osm-padova-nodes.json`.

## Nodi: semafori, STOP, dare precedenza, attraversamenti (in uso)

Query: [`scripts/overpass-nodes.ql`](../scripts/overpass-nodes.ql). Area: i riquadri `FOCUS` e `FOCUS_SUD` di
`scripts/build_map.py` (Centro, Arcella e la fascia del tram fino alla Guizza) allargati di 300 m.

```bash
curl -X POST -A "padova-bus-simulator" --data-urlencode data@scripts/overpass-nodes.ql -o /tmp/osm-nodes.json https://overpass-api.de/api/interpreter
python3 scripts/filter_osm_nodes.py /tmp/osm-nodes.json data/osm-padova-nodes.json
```

Se il server risponde 502 è saturo: si riprova dopo qualche decina di secondi. In alternativa si incolla la query su
https://overpass-turbo.eu, si esporta il JSON grezzo e lo si passa a `filter_osm_nodes.py`. Il filtro tiene solo i
nodi con semafori, cartelli o attraversamenti e i tag `highway`, `crossing`, `crossing:signals`, `crossing:markings`,
`traffic_signals`, `traffic_signals:direction`, `direction`, `stop`, `priority`, un nodo per riga.

### Come li usa `build_map.py`

* **Aggancio.** Un nodo OSM tenuto nel grafo vale per sé; altrimenti si cammina lungo la sua strada. Semafori e
  cartelli in OSM stanno sulla linea d'arresto, qualche metro prima dell'incrocio: si cerca il primo incrocio (3+
  archi) entro 40 m (semafori) o 30 m (cartelli) nel verso di `traffic_signals:direction` / `direction`; senza verso,
  sui sensi unici si segue il senso di marcia, sulle strade a doppio senso si prende l'incrocio più vicino.
* **Semafori.** Le lanterne entro 25 m, o che portano allo stesso incrocio, formano un solo impianto. Un incrocio
  grande (carreggiate separate) occupa più nodi del grafo: l'impianto li comprende tutti, con i vertici intermedi tra
  l'uno e l'altro, e ha le lanterne solo sui bracci che arrivano da fuori. `traffic_signals=blinker` ed `emergency`
  non hanno ciclo e sono scartati.
* **Semafori pedonali.** Un semaforo senza incrocio entro 40 m, o un attraversamento `crossing=traffic_signals`
  senza semafori per i veicoli entro 40 m, regola il tratto in cui si trova: il suo nodo resta nel grafo e ha un ciclo
  con il verde lungo per i veicoli.
* **STOP e dare precedenza.** Il cartello va sul braccio da cui si arriva all'incrocio (lo STOP prevale se ce ne
  sono due); `stop=all` vale per tutti i bracci. Un cartello messo sul nodo stesso dell'incrocio vale per le strade
  di classe inferiore. Gli incroci semaforizzati non hanno cartelli.
* **Strisce pedonali.** Ogni attraversamento con le strisce (tutti tranne `crossing=unmarked|no|informal` e
  `crossing:markings=no`) diventa una posizione lungo un arco. Nel gioco, se cade dentro l'incrocio, si sposta
  all'imbocco; la linea d'arresto dei cartelli sta subito prima delle strisce.

Nei dati del gioco (`src/data/padova-map.json`) le chiavi sono `signals`, `signs` e `crossings`. Senza di esse il
gioco torna alle regole sul tipo di strada.

Limiti noti:

* un semaforo pedonale ha le lanterne in tutti e due i sensi anche quando OSM ne indica uno solo;
* il diritto di precedenza non è mappato in OSM: lo mettiamo sulla strada principale degli incroci dove le laterali
  hanno STOP o dare precedenza;
* agli ingressi delle rotatorie c'è sempre il dare precedenza, anche dove OSM non lo indica.

## Da fare: sede del tram, banchine e altri tag

Questa query più ampia scarica anche le linee del tram, le corsie riservate e altri cartelli:

```overpassql
[out:json][timeout:180][bbox:45.385,11.845,45.455,11.920];
(
  node["traffic_sign"];
  node["traffic_calming"];
  node["railway"~"^(tram_stop|tram_crossing|tram_level_crossing|level_crossing|crossing|switch)$"];
  node["public_transport"="stop_position"];
);
out body;
(
  way["railway"="tram"];
  way["highway"="busway"];
  way["footway"="crossing"];
  way["highway"="footway"]["footway"="crossing"];
);
out geom;
```

Uso previsto:

* `railway=tram` / `tram_stop`: la sede e le banchine del tram allineate ai binari reali;
* `traffic_calming`: dossi e cuscini berlinesi;
* `highway=busway`: corsie e strade riservate ai bus.
