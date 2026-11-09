// Binari, fermate e relazioni del tram, comprese le linee in costruzione (SIR2, SIR3): per i tracciati delle nuove
// linee. Rispetto a scripts/overpass-tram.ql prende anche i binari in cantiere (railway=construction con
// construction=tram), i binari in progetto, le fermate (railway=tram_stop) e le relazioni route=tram con l'ordine
// dei binari e delle fermate. Area più larga: il SIR2 va da Rubano (ovest) alla Busa di Vigonza (est).
// Uso (vedi docs/linee-tram-nuove.md):
//   curl -X POST -A "padova-bus-simulator" --data-urlencode data@scripts/overpass-tram-cantiere.ql \
//        -o /tmp/osm-tram-cantiere.json https://overpass-api.de/api/interpreter
// oppure si incolla la query su https://overpass-turbo.eu e si esporta il JSON grezzo.
[out:json][timeout:180][bbox:45.355,11.770,45.455,11.990];
(
  way["railway"="tram"];
  way["railway"="construction"]["construction"="tram"];
  way["railway"="proposed"]["proposed"="tram"];
  way["railway"="platform"]["tram"="yes"];
  way["public_transport"="platform"]["tram"="yes"];
  node["railway"="tram_stop"];
  node["public_transport"="stop_position"]["tram"="yes"];
)->.tram;
rel(bw.tram)["route"="tram"]->.rel;
rel(bn.tram)["route"="tram"]->.rel2;
(.tram; .rel; .rel2;);
out geom tags;
