# Idee e sviluppi

Elenco a cui attingere per i prossimi lavori. Quando un'idea viene realizzata si sposta in fondo, in **Fatto**.
Legenda: `[ ]` da fare · `[~]` parziale · `[x]` fatto.

## Prossimi passi

1. [ ] **Tram SIR1 guidabile** sulla sua linea (3 moduli; in futuro linee con 4 moduli). Specifica pronta:
   [`docs/prompt-tram.md`](docs/prompt-tram.md).
2. [ ] **Segnaletica reale da OpenStreetMap**: STOP, dare precedenza, semafori, strisce pedonali e fermate del tram nei
   punti veri. Query e istruzioni: [`docs/overpass-segnaletica.md`](docs/overpass-segnaletica.md). Oggi i cartelli
   seguono regole sul tipo di strada.
3. [ ] **Segnaletica orizzontale dai tag OSM già presenti** (`lanes` su ~5400 strade, `lanes:forward/backward`,
   `overtaking`, `turn:lanes`, `lanes:psv`):
   - numero di corsie e linee divisorie;
   - mezzeria continua dove `overtaking=no`;
   - frecce a terra da `turn:lanes`;
   - corsie preferenziali gialle con la scritta BUS da `lanes:psv` / `bus:lanes`.

## Mappa e dati

- [ ] Foto aeree per le strisce (mezzeria, linee di arresto). Pipeline offline: ortofoto a ~20 cm/pixel, riconoscimento
  delle strisce, aggancio alle strade OSM. Problemi:
  - licenza: Google e Bing non permettono di ricavarne dati; le ortofoto della Regione Veneto sono da verificare;
  - alberi, ombre e auto coprono le strisce;
  - dai container cloud i server della Regione sono bloccati.
- [ ] Allineare la sede del tram ai binari OSM (`railway=tram`) invece che allo shape GTFS. Esempio: in Viale
  Cavallotti la sede è attaccata al marciapiede del bus e i passeggeri hanno poco spazio.
- [ ] 30 fermate servite su 403 non hanno palina (il posizionamento viene scartato): capire caso per caso.
- [ ] Capolinea: tratti del percorso GTFS senza strada corrispondente (map matching). Aggiungere le strade di servizio
  e le aree dei capolinea.
- [ ] Aggiornamento automatico del GTFS: workflow programmato che scarica il feed BusOne e rigenera
  `src/data/padova-map.json`.
- [ ] Edifici: altezze reali dove mancano (centro storico), tetti più vari, portici dove mancano.
- [ ] Piste ciclabili e ciclisti; sottopassi pedonali.
- [ ] Ampliare l'area di gioco oltre Centro e Arcella (linee oggi tagliate "tratto in città").

## Veicoli e guida

- [ ] Tram SIR1 (3 moduli), poi linee tram future con 4 moduli (vedi prompt).
- [ ] Bus snodato da 18 m per le linee più cariche.
- [ ] Bus elettrico: batteria, consumo, ricarica al capolinea (pantografo); punti per il recupero in frenata.
- [ ] Volante e pedaliera o gamepad (Gamepad API); comandi touch per smartphone (il gioco è su GitHub Pages).
- [ ] Telecamera della porta posteriore sul cruscotto; specchietti regolabili.
- [ ] Altre livree storiche (anni '80–'90).

## Traffico e regole

- [ ] Le auto rispettano STOP, precedenze e rotonde (oggi solo semafori).
- [ ] Pedoni che attraversano sulle strisce con obbligo di precedenza (e punti).
- [ ] Penalità per non dare precedenza a chi arriva (rotonde, dare precedenza).
- [ ] Corsie preferenziali vere: bonus per il bus, auto che non le usano.
- [ ] Semafori del tram (barre bianche) e priorità semaforica.
- [ ] Traffico più lento con pioggia e nebbia.

## Passeggeri e servizio

- [ ] Pedana per carrozzine alla porta centrale, passeggini.
- [ ] Controllore e validazione dei biglietti.
- [ ] Annunci di fermata più naturali; display interno con le prossime fermate.
- [ ] Affollamento per fascia oraria e per fermata più realistico.
- [ ] Turni di lavoro: più corse di fila con pausa al capolinea.

## Meteo e ambiente

- [ ] Pozzanghere e riflessi sull'asfalto bagnato.
- [ ] Temporale con lampi; rara neve.
- [ ] Pedoni con l'ombrello quando piove.
- [ ] Stagioni (alberi spogli in inverno), alba e tramonto più curati.

## Gioco

- [ ] Sfide nel giro libero (corsa perfetta, a tempo, fermate di precisione).
- [ ] Classifiche per linea (serve un backend).
- [ ] Tutorial guidato per la prima corsa.

## Tecnica

- [ ] Bundle da 4,7 MB: dati JSON separati e compressi, caricamento progressivo.
- [ ] Prestazioni su mobile.
- [ ] Test automatici in CI (build + giro dell'autopilota in headless).

## Fatto

- [x] Linee urbane reali dal GTFS Busitalia (varianti, fermate, orari feriali e festivi); strade OSM; edifici Overture.
- [x] Pausa, salvataggio e ripresa della corsa; teletrasporto (J e clic sulla mappa grande).
- [x] Sede tranviaria del SIR1 con corsie rosse e rotaia; due tram automatici.
- [x] Livree: moderna elettrica (argento, tetto blu, verde lime) e storica arancione e bianca.
- [x] Sguardo col mouse (trascinamento), V o doppio clic per tornare avanti.
- [x] Il ritardatario arriva da dietro e sale dalla porta posteriore.
- [x] Pubblicazione su GitHub Pages da `main`.
- [x] Meteo variabile con transizioni (nuvole, pioggia, nebbia, strade bagnate).
- [x] Marciapiede: contano le ruote; fascia sormontabile a incroci e rotonde.
- [x] Retromarcia con S ripremuto da fermo; W da fermo torna avanti.
- [x] Incroci con cordoli raccordati al posto dei dischi.
- [x] Palina spostata di qualche metro se cade su un'altra strada (es. Bramante Chiesa).
- [x] Segnaletica gialla di fermata: zig-zag, tratteggio, scritta BUS.
- [x] Cartelli verticali agli incroci (STOP, dare precedenza, rotatoria) e regola dello STOP.
