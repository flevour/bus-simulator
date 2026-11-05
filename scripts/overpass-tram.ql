// Binari e banchine del tram (SIR1 e le altre linee) nell'area di gioco: la sede del gioco segue i binari invece dello
// shape GTFS; le banchine dicono dove la fermata ha una banchina centrale comune ai due versi.
// Area: la stessa di scripts/overpass-nodes.ql.
// Uso: curl -X POST -A "padova-bus-simulator" --data-urlencode data@scripts/overpass-tram.ql https://overpass-api.de/api/interpreter
//      e poi scripts/filter_osm_tram.py (vedi README).
[out:json][timeout:120][bbox:45.3593,11.8482,45.4517,11.9158];
(
  way["railway"="tram"];
  way["railway"="platform"]["tram"="yes"];
  way["public_transport"="platform"]["tram"="yes"];
);
out geom tags;
