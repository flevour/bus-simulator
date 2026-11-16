// Luoghi OSM nell'area della mappa che generano o ricevono traffico: parcheggi e stalli, uso del suolo, scuole,
// università, ospedali e negozi. Con la geometria (contorni delle aree).
// Area: il rettangolo dei nodi della rete (src/data/padova-map.json) allargato di 400 m (sud, ovest, nord, est).
// Uso: curl -X POST -A "overpass-client" --data-urlencode data@scripts/overpass-luoghi.ql https://overpass-api.de/api/interpreter
//      e poi scripts/filter_osm_luoghi.py (vedi README).
[out:json][timeout:240][bbox:45.325,11.762,45.457,11.966];
(
  nwr["amenity"~"^(parking|parking_space|parking_entrance)$"];
  wr["landuse"];
  nwr["amenity"~"^(school|kindergarten|university|college|hospital)$"];
  nwr["shop"];
);
out geom;
