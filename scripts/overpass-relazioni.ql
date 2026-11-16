// Relazioni OSM nell'area della mappa: svolte vietate e obbligate (type=restriction, anche per tipo di mezzo) e
// percorsi delle linee di bus e tram (type=route). Solo i membri (id e ruolo), senza geometria: si agganciano per id
// alle vie di data/osm-padova.json e data/osm-corridoio.json. Delle vie delle svolte anche l'elenco dei nodi di oggi:
// una via cambiata in OSM dopo lo scarico (spezzata, unita) si ritrova dal nodo accanto al nodo "via".
// Area: il rettangolo dei nodi della rete (src/data/padova-map.json) allargato di 400 m (sud, ovest, nord, est).
// Uso: curl -X POST -A "overpass-client" --data-urlencode data@scripts/overpass-relazioni.ql https://overpass-api.de/api/interpreter
//      e poi scripts/filter_osm_relazioni.py (vedi README).
[out:json][timeout:180][bbox:45.325,11.762,45.457,11.966];
(
  relation["type"="restriction"];
  relation["type"~"^restriction:"];
  relation["type"="route"]["route"~"^(bus|trolleybus|tram)$"];
);
out body;
relation["type"~"^restriction"]->.svolte;
way(r.svolte);
out skel;
