// Arredo OSM nell'area della mappa: barriere e dissuasori, lampioni, alberi singoli (solo nodi).
// Area: il rettangolo dei nodi della rete (src/data/padova-map.json) allargato di 400 m (sud, ovest, nord, est).
// Uso: curl -X POST -A "overpass-client" --data-urlencode data@scripts/overpass-arredo.ql https://overpass-api.de/api/interpreter
//      e poi scripts/filter_osm_luoghi.py (vedi README).
[out:json][timeout:240][bbox:45.325,11.762,45.457,11.966];
(
  node["barrier"];
  node["highway"="street_lamp"];
  node["natural"="tree"];
);
out body;
