# Nuove linee del tram: SIR2 e SIR3 (ricerca)

Primo passo per avere nel gioco i tracciati delle linee in costruzione. Stato al 9 novembre 2026: raccolta delle
fonti e di quello che c'è già nei dati del progetto. Il codice del gioco non è ancora cambiato.

## Le due linee in breve

| | SIR3 Stazione – Voltabarozzo | SIR2 Rubano – Busa di Vigonza |
|---|---|---|
| Lunghezza | circa 5,4–5,5 km | circa 17,5 km |
| Fermate | 12 o 13 (le fonti non concordano) | 34 + 2 verso il Nuovo Ospedale (36) |
| Capolinea | Stazione FS, Voltabarozzo | Rubano, Busa di Vigonza; capolinea intermedi Nuovo Ospedale e Caserma Romagnoli |
| Deposito | nuovo deposito a Voltabarozzo, parcheggio scambiatore da 383 posti | deposito vicino al capolinea di Rubano |
| Mezzi | Translohr, come il SIR1; 7 mezzi, ogni 8 minuti | Translohr |
| Apertura prevista | dal 2026 (presentazione di dicembre 2025) | dal 2027 (stessa presentazione) |
| Lavori | cantieri dal 22 marzo 2023 | Lotto 1 tratta ovest Rubano–Padova: posa dei binari nel 2026; target PNRR raggiunto a fine luglio 2026 |

**Percorso SIR3.** Dalla stazione per Via Gozzi, il ponte Omizzolo, Via Morgagni, Via Giustiniani (Ospedale Civile),
Via Sografi, poi il nuovo ponte sullo Scaricatore verso Voltabarozzo. Vicino al capolinea si divide: un ramo per Via
Giardinetto e Via Zeno, l'altro per Via Piovese. Fermate citate: Stazione FS, Ospedale Civile, Sant'Antonio,
Sografi/Forcellini, Parco Iris, Cornaro, Voltabarozzo. L'elenco completo in ordine non l'ho trovato.

**Percorso SIR2.** Da Rubano per Sarmeola e Chiesanuova, il Cimitero Maggiore, il centro storico fino alla stazione;
poi verso la Fiera e il nodo della Stanga, Via San Marco (Ponte di Brenta) fino alla Busa di Vigonza. Il ramo per il
Nuovo Ospedale parte dal nodo di San Marco.

**Stazione.** Il nuovo piazzale ha gli anelli del tram a ovali concentrici, in comune tra SIR1, SIR2, SIR3 (e in
futuro SIR4, SIR5): vedi `IDEE.md` punto 2 e `docs/prompt-tram.md` ("Per le linee future").

Le cifre vengono dai risultati di ricerca (riassunti delle pagine qui sotto): da dentro il container le pagine non si
aprono (Wikipedia, padovanet.it, mit.gov.it, trampadova.it non sono raggiungibili), quindi vanno ricontrollate
aprendole dal browser. Fonti:

* Comune di Padova / MIT, presentazione del sistema SMART (2 dicembre 2025):
  https://www.mit.gov.it/nfsmitgov/files/media/notizia/2025-12/01%20Presentazione%20Sistema%20SMART%20-%20Galiazzo.pdf
* Tram Padova, linee SIR3 e SIR2 e FAQ sul percorso del SIR3: https://www.trampadova.it/linea-sir-3/,
  https://www.trampadova.it/linea-sir-2/, https://www.trampadova.it/faq/quale-e-il-percorso-del-sir3/
* Comune di Padova, dossier di progetto SIR2:
  https://www.comune.padova.it/sites/default/files/attachment/Dossier%20di%20progetto%20finale%20SIR%202.pdf
* Dibattito pubblico SIR2 (progetto, 2022): https://dptrampadova.it/progetto/,
  https://dptrampadova.it/wp-content/uploads/2022/02/DP-progetto-Galiazzo.pdf
* MIT, dossier conclusivo SIR2 (2022):
  https://www.mit.gov.it/nfsmitgov/files/media/basic/2022-09/Dossier%20conclusivo%20Linea%20Tranviaria%20Sir2%20Padova.pdf
* Comune di Rubano, ordinanza del 12 febbraio 2026 (Lotto 1, vie di corsa) e notiziario di giugno 2026 (posa dei
  binari): https://rubano-api.municipiumapp.it/s3/6004/allegati/ord_00020_12-02-2026.pdf,
  https://rubano-api.municipiumapp.it/s3/6004/allegati/puntosi/notiziario-giugno-2026-def.pdf
* MM spa, target PNRR del SIR2: https://www.mmspa.eu/sir2-padova-target-pnrr/
* padovanet.it, nuova viabilità a Voltabarozzo (giugno 2024):
  https://www.padovanet.it/notizia/20240621/tram-sir3-stazione-voltabarozzo-nuova-viabilit%C3%A0-voltabarozzo
* Sustainable Bus, SIR3 e revamping del SIR1: https://www.sustainable-bus.com/trolleybus-tramway/padua-new-tram-line-sir3-revamping
* Wikipedia: https://it.wikipedia.org/wiki/Tranvia_di_Padova, https://en.wikipedia.org/wiki/Trams_in_Padua

## Cosa c'è già nei dati del progetto

**GTFS.** Il feed Busitalia (BusOne, valido dal 4 novembre al 3 dicembre 2026) ha solo il tram `SIR1`: niente shape,
fermate né orari per SIR2 e SIR3. Tracciati e fermate vanno presi da OSM e dalle fonti ufficiali, gli orari vanno
inventati a partire dalla frequenza dichiarata (SIR3 ogni 8 minuti).

**OSM.** L'export `data/osm-padova-tram.json` (5 novembre 2026, query `scripts/overpass-tram.ql`) contiene già binari
delle due linee mappati come `railway=tram`:

| Linea | Way | Binario (m) | Dentro la rete stradale del gioco | Note |
|---|---|---|---|---|
| SIR3 | 30 (+ 2 scambi, 2 tronchini) | circa 10 900 | 75% | doppio binario completo, nessun estremo libero; il resto è a sud, verso Voltabarozzo, fuori dalla rete stradale esportata |
| SIR2 | 27 | circa 15 000 | 78% | da lon 11,8275 (Chiesanuova/Sarmeola) a lon 11,917 (est della Stanga): circa metà della linea; 5 estremi liberi |

Estremi liberi del SIR2 (dove finisce la parte mappata): i due binari a ovest (45,41725 11,82750), i due a est
(45,41443 11,91710) e un binario singolo a 45,41050 11,87818, da capire (tronchino, ramo, o tratto non finito). Il
SIR3 tocca il SIR2 in 3 nodi e il SIR1 in 1 nodo (zona stazione); 6 way senza nome fanno da raccordo. I nomi delle way
non sono uniformi ("SIR 3", "SIR3", "Linea SIR3", "Linea 3 Stazione-Voltabarozzo"), nessuna ha `ref`.

Oggi `build_map.py` usa i binari OSM solo per agganciare lo shape GTFS del SIR1 (`tram_grid`, `tram_lane`): i
binari di SIR2 e SIR3 sono nel file ma il gioco non li disegna. `tramLines` nel JSON della mappa ha una sola linea
(`id`, `color`, `modules`, `variants`).

**Quello che manca nell'export.** La query prende solo `railway=tram`. Restano fuori:

* i tratti ancora mappati come cantiere (`railway=construction` + `construction=tram`): probabilmente il resto del
  SIR2 (Rubano, Ponte di Brenta, Vigonza, Nuovo Ospedale);
* le fermate (`railway=tram_stop`) e le relazioni `route=tram` con l'ordine di binari e fermate;
* la parte di SIR2 fuori dal riquadro (Rubano a ovest, Vigonza a est).

Per questo c'è la query nuova [`scripts/overpass-tram-cantiere.ql`](../scripts/overpass-tram-cantiere.ql), su
un'area più larga. Dal container Overpass non risponde: va lanciata dal browser (overpass-turbo.eu, "Esporta" →
"dati grezzi") e il JSON va messo in `data/` (per esempio `data/osm-padova-tram-cantiere.json`).

## Proposta di lavoro

1. **Dati.** Lanciare `overpass-tram-cantiere.ql` dal browser e salvare il risultato. Allargare
   `filter_osm_tram.py` per tenere `construction`, `tram_stop` e le relazioni (membri in ordine con ruolo
   `stop`/`platform`). Confrontare i tracciati OSM con le planimetrie del progetto definitivo (dossier SIR2,
   presentazione SMART) dove OSM ha buchi.
2. **Elenco fermate.** Un file di dati per linea (`data/tram-linee-nuove.json` o simile) con nome, posizione e ordine
   delle fermate, preso dalle relazioni OSM o dai documenti ufficiali, con la fonte accanto. Così non serve aspettare
   il GTFS.
3. **Grafo dei binari.** Il passo già previsto in `docs/prompt-tram.md`: dai binari OSM un grafo (rami e scambi);
   ogni linea è una sequenza di rami. Serve sia per gli anelli della stazione sia per far convivere SIR1, SIR2 e
   SIR3 sugli stessi binari (il SIR3 parte dalla stazione dove passano anche gli altri).
4. **Linee nel gioco.** Aggiungere SIR2 e SIR3 a `tramLines` con `modules: 4`, orari generati dalla frequenza, e la
   sede tranviaria disegnata anche sui loro binari. In prima battuta solo la parte dentro l'area di gioco: il SIR3
   fino a dove arriva la rete stradale (manca il capolinea di Voltabarozzo, serve allargare `FOCUS_SUD` o un riquadro
   nuovo verso sud-est), il SIR2 tra Chiesanuova e la Stanga.
5. **Verifiche.** Come per il SIR1: i bus non devono trovare la sede del tram nella loro corsia, le fermate dei bus
   spostate dai cantieri (per esempio Via Gozzi, Via Sografi) restano raggiungibili.

Domande aperte: le linee nuove circolano come se fossero già aperte (scenario "Padova 2027") o con i cantieri? Il
SIR3 si fa prima (è quasi pronto e quasi tutto mappato), il SIR2 dopo?
