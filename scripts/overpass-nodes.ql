// Nodi OSM con semafori, STOP, dare precedenza, attraversamenti pedonali e dossi (traffic_calming) nell'area di gioco.
// Area: i riquadri FOCUS e FOCUS_SUD di scripts/build_map.py allargati di 300 m (sud, ovest, nord, est).
// Uso: curl -X POST --data-urlencode data@scripts/overpass-nodes.ql https://overpass-api.de/api/interpreter
//      e poi scripts/filter_osm_nodes.py per tenere solo i tag che servono (vedi README).
[out:json][timeout:180][bbox:45.3593,11.8482,45.4517,11.9158];
(
  node["highway"~"^(traffic_signals|stop|give_way|crossing)$"];
  node["crossing"];
  node["highway"="traffic_signals"]["traffic_signals"];
  node["traffic_signals:direction"];
  node["direction"];
  node["traffic_calming"];
);
out body;
