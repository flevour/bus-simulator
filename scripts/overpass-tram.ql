// Binari del tram (SIR1 e le altre linee) nell'area di gioco: la sede del gioco segue questi invece dello shape GTFS.
// Area: la stessa di scripts/overpass-nodes.ql.
// Uso: curl -X POST -A "padova-bus-simulator" --data-urlencode data@scripts/overpass-tram.ql https://overpass-api.de/api/interpreter
//      e poi scripts/filter_osm_tram.py (vedi README).
[out:json][timeout:120][bbox:45.3593,11.8482,45.4517,11.9158];
way["railway"="tram"];
out geom tags;
