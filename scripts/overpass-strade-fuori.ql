// Strade principali attorno a Padova (#147), anche fuori dalla mappa: autostrade, superstrade, statali, provinciali e
// strade terziarie con le rampe. Con queste la build della domanda (scripts/pendolari.py) trova da quale porta della
// mappa entra chi viene da un comune di fuori.
// Area: il riquadro dei 20 km attorno a Padova, dove abita il 78% dei pendolari in auto verso la città (ISTAT 2011);
// scripts/filter_osm_fuori.py tiene le vie entro 20 km.
// Uso: curl -X POST -A "padova-bus-simulator" --data-urlencode data@scripts/overpass-strade-fuori.ql https://overpass-api.de/api/interpreter
//      e poi scripts/filter_osm_fuori.py (vedi README).
[out:json][timeout:300];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](45.22,11.62,45.59,12.14);
out tags geom;
