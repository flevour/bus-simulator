# Export OSM della segnaletica (Overpass)

L'export attuale `data/osm-padova.json` contiene solo le *way* (strade, edifici, binari, acque). Questa seconda query
scarica i **nodi** con la segnaletica reale e la sede del tram. Con questi dati il gioco può mettere STOP, dare
precedenza, semafori e strisce pedonali dove sono davvero.

Area: Centro storico e Arcella con un po' di margine (la stessa dell'area di gioco, `FOCUS` in `scripts/build_map.py`).

## Query

```overpassql
[out:json][timeout:180][bbox:45.385,11.845,45.455,11.920];
// nodi: cartelli, semafori, attraversamenti, fermate e incroci del tram
(
  node["highway"~"^(stop|give_way|traffic_signals|crossing|mini_roundabout|turning_circle|turning_loop|speed_camera|street_lamp)$"];
  node["crossing"];
  node["traffic_sign"];
  node["traffic_calming"];
  node["railway"~"^(tram_stop|tram_crossing|tram_level_crossing|level_crossing|crossing|switch)$"];
  node["public_transport"="stop_position"];
);
out body;
// linee: sede del tram, corsie riservate ai bus, attraversamenti pedonali disegnati come linee
(
  way["railway"="tram"];
  way["highway"="busway"];
  way["footway"="crossing"];
  way["highway"="footway"]["footway"="crossing"];
);
out geom;
```

I tag che interessano di più:

* `highway=stop` / `highway=give_way` con `direction=forward|backward`, cioè il lato da cui vale il cartello;
* `highway=traffic_signals` (con `traffic_signals:direction`) e `crossing=traffic_signals`;
* `crossing=zebra|uncontrolled|marked` e `crossing:markings`, per le strisce pedonali;
* `railway=tram_stop`, per le banchine reali del SIR1.

## Come esportarla

1. Apri https://overpass-turbo.eu, incolla la query e premi **Esegui**. Ci vuole circa un minuto.
2. **Esporta** → **Dati** → *dati grezzi OSM* (JSON) → scarica il file.
3. Mettilo nel repository (sul Mac):

   ```bash
   cd /Users/flevour/Sites/flevour/bus-simulator
   git checkout main && git pull
   cp ~/Downloads/export.json data/osm-padova-segnaletica.json
   git add data/osm-padova-segnaletica.json
   git commit -m "Dati OSM: segnaletica, semafori, attraversamenti e sede del tram"
   git push
   ```

Dai container cloud di Claude, `overpass-api.de` non è raggiungibile: l'export va fatto dal browser.

## Uso previsto nel gioco

`scripts/build_map.py` leggerà il file e, per ogni nodo, troverà l'incrocio o la strada più vicina. Poi:

* STOP e dare precedenza: cartello reale sull'accesso giusto (`direction`), al posto delle regole attuali in
  `City.buildSigns()`;
* semafori: l'incrocio diventa semaforizzato (oggi `TrafficLights` sceglie gli incroci con una regola sul traffico);
* attraversamenti: strisce pedonali nei punti veri (oggi le disegna a ogni incrocio principale);
* `railway=tram` / `tram_stop`: la sede e le banchine del tram allineate ai binari reali.
