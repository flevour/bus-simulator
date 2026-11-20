// Comuni attorno a Padova (#147): confini comunali (admin_level 8) con il codice ISTAT, e il nodo del centro abitato
// (ruolo admin_centre) di ognuno. Servono a dire da dove partono i pendolari della matrice ISTAT (data/istat-pendolari.json)
// e quali comuni stanno dentro la mappa.
// Area: il riquadro delle strade fuori dalla mappa (scripts/overpass-strade-fuori.ql) allargato di 10 km.
// Uso: curl -X POST -A "padova-bus-simulator" --data-urlencode data@scripts/overpass-comuni.ql https://overpass-api.de/api/interpreter
//      e poi scripts/filter_osm_fuori.py (vedi README).
[out:json][timeout:180];
relation["boundary"="administrative"]["admin_level"="8"](45.05,11.35,45.85,12.45)->.r;
.r out body center;
node(r.r:"admin_centre");
out;
