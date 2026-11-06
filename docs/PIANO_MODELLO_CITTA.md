# Piano: un modello della città coerente con la realtà

Obiettivo: smettere di correggere a mano la mappa un caso alla volta. Strade, marciapiedi, isole, parchi, edifici,
fermate, semafori e tram devono venire da **dati misurati**. Le regole e le misure standard servono solo dove i
dati mancano. Ogni build deve **controllare da sola** la coerenza.

Questo documento contiene, in ordine:

1. lo stato attuale, con i numeri misurati il 6 novembre 2026;
2. le fonti di dati, con priorità e accesso dai container;
3. le misure di riferimento, per quando i dati mancano;
4. la pipeline a strati e la regola di priorità tra le fonti;
5. come trattare semafori, fermate e tram;
6. le verifiche automatiche e visive;
7. le tappe di lavoro e cosa serve per partire.

---

## 1. Stato attuale (misurato)

Come si costruisce oggi la mappa (`scripts/build_map.py`, `scripts/street_surfaces.py`):

| Elemento | Da dove viene | Problema |
|---|---|---|
| Rete stradale | Export Overpass delle *way* (`data/osm-padova.json`, 14.728 strade) | Buona. L'export è fatto a mano dal browser |
| Larghezza della carreggiata | `lanes × 3,3 + 1,2 m`, altrimenti un valore per classe; tra 5 e 16 m | **Non usa il tag `width`**, presente su 1.154 vie (8%). Nessun dato misurato |
| Marciapiede | Fascia fissa di **3,5 m** attorno alla carreggiata (1,5 m vicino ai bus, 2 m sui ponti); lati da `sidewalk` (19% delle vie) | Larghezza inventata. I marciapiedi mappati come vie (599) e le aree pedonali non sono usati |
| Isole, spartitraffico | Buchi della carreggiata sotto 2.500 m² | Dedotti, non misurati |
| Raccordi agli incroci | Raggio fisso: 7 m sulle vie dei bus, 3,5 m sulle altre | Uguale per tutti gli incroci |
| Edifici | Overture: piante OSM e Microsoft, altezza OSM o stima ML calibrata | Altezze del centro stimate; facciate ritagliate dalla pianta delle strade |
| Parchi, prati, piazze, zone pedonali, alberi | **Mancano**: l'export non contiene `leisure`, `landuse`, `natural` | Verde e alberi sono generati, non reali |
| Fermate | Fermate GTFS agganciate a runtime alla strada della linea | Buone: 479 paline su 494 a 0,4–3 m dal bordo dell'asfalto, 12 in carreggiata |
| Semafori | 228 nodi OSM `traffic_signals` raggruppati in 135 impianti (41 pedonali, 346 lanterne) | **73 pali su 346 (21%) cadono in carreggiata**, 18 sul cordolo. Palo stimato a "raggio dell'incrocio + 3,5 m" lungo la via e a "metà larghezza + 1 m" di lato; ciclo fisso 13-3-1-10-3-1 s |
| STOP, dare precedenza, strisce | Nodi OSM (676 STOP, 1.091 precedenze, 3.811 attraversamenti) | Buoni. Le strisce sono punti, non la loro geometria |
| Tram | Binari OSM `railway=tram` (export apposito) e banchine OSM | Buono; restano i casi segnalati in `IDEE.md` |

Segnalazioni ancora aperte dai giocatori (modulo del 6 novembre, vedi `IDEE.md`): semafori in mezzo alla strada e
orientati male, zone pedonali, profilo altimetrico, zona Plebiscito, cavalcavia, posizione dei fiumi.

---

## 2. Fonti di dati

*(sezione completata con la ricerca: vedi sotto "2.2")*

### 2.1 Cosa si raggiunge dai container cloud

Prova fatta il 6 novembre 2026. La policy di rete dell'ambiente nega tutti gli host tranne i registri dei pacchetti e
**il bucket S3 di Overture Maps**. Overpass, Geofabrik, openstreetmap.fr, Regione Veneto (IDT2), Comune di Padova,
Agenzia delle Entrate, Copernicus, Mapillary e Open-Meteo rispondono con un rifiuto del proxy (403 al CONNECT).

**Overture Maps funziona già.** Ripubblica ogni mese i dati OSM (istantanea del 10 ottobre 2026) e li rende
scaricabili da qui con `scripts/overture_layers.py`. Nell'area di gioco contiene:

| Strato Overture | Cosa contiene per Padova |
|---|---|
| `transportation/segment` (17.580) | Strade, con `width_rules` su 2.354 segmenti (13%), superficie su 12.376, limiti su 2.307, ponti e gallerie. **1.112 attraversamenti pedonali come linee** (`footway=crossing`), **599 marciapiedi mappati a parte**, 2.612 vie pedonali, 212 aree pedonali, 168 scalinate. 56 segmenti di tram |
| `base/infrastructure` (15.976) | 227 semafori (con `traffic_signals:direction`), 676 STOP, 1.083 precedenze, 3.770 attraversamenti. **524 fermate del bus (163 con pensilina, 63 con panchina)**, 93 banchine. 379 lampioni, 515 panchine, 550 dissuasori, 641 cordoli, 2.027 posti auto, ponti e viadotti |
| `base/land_use` (1.751) | **170 parchi**, 394 prati, 205 campi sportivi, 39 giochi, **94 zone pedonali e 22 piazze**, giardini, cimiteri, scuole, università |
| `base/land` (1.222) | **978 alberi e 73 filari**, boschi, prati |
| `base/water` (371) | Canali, fossi, stagni come aree e linee |
| `places/place` (15.696) | Attività, utili per la domanda di passeggeri |

Rispetto all'export Overpass attuale, Overture dà **gratis e subito** proprio ciò che manca: verde, zone pedonali,
piazze, alberi, la geometria degli attraversamenti, i marciapiedi mappati, le pensiline delle fermate. Inoltre
permette di aggiornare la mappa senza export manuali.

### 2.2 Fonti esterne

*(da completare con la ricerca)*

---

## 3. Misure di riferimento

Si usano solo dove mancano i dati. Legenda dello stato:
- **V**: il testo dell'articolo è citato dalla fonte;
- **S**: fonte secondaria che cita la norma (regolamenti comunali, progetti, cataloghi);
- **T**: prassi tipica o stima.

I testi ufficiali (Gazzetta Ufficiale, MIT, Normattiva) non si aprono dai container. Prima di fissare un valore V
conviene ricontrollarlo sul testo.

### 3.1 Sezioni stradali (DM 5/11/2001, Regolamento del Codice della Strada)

| Elemento | Valore | Oggi nel gioco | Stato |
|---|---|---|---|
| Corsia | D (urbana di scorrimento) 3,25 · E (quartiere) 3,00 · F (locale) 2,75 m. Moduli da 2,75 a 3,75; fino a 2,50 negli approcci agli incroci urbani (art. 140) | 3,3 per corsia | S |
| Corsia riservata ai bus | ≥ 3,50 m (Roma: 3,00 alle fermate) | +3,3 col bus in controsenso | V / S |
| Banchina | E/F 0,50; D 1,00 a destra e 0,50 a sinistra; spartitraffico D ≥ 1,80 | non c'è | S |
| Marciapiede | minimo **1,50**, tipico 2,0–3,0; cordolo ≤ 0,15 (DM 236/89, DPR 503/96) | **3,5 fisso** | S / V |
| Sosta | in linea 2,00 × 5,00 (eccezionalmente 1,80); a pettine 2,30 di larghezza, profondità 4,80 (45°) o 5,00 (90°); corsia di manovra 3,50 o 6,00 (DM 2001 §3.4.7) | non c'è | S / V |
| Ciclabile | 1,50 per senso, 2,50 a doppio senso; separatore ≥ 0,50 (DM 557/99 art. 7) | non c'è | V |
| Centro storico | nessuna norma: 3–8 m tra le facciate | minimo 5 m | T |
| Portici | rete di 12–25 km a Padova; profondità tipica 2,5–4 m, altezza libera 3–5 m (Regolamento Edilizio di Padova art. 66: misure non lette) | generati | T |

### 3.2 Incroci e rotatorie (DM 19/4/2006)

| Elemento | Valore | Stato |
|---|---|---|
| Rotatorie, per diametro esterno | mini 14–25 m · compatte 25–40 m · convenzionali 40–50 m | V |
| Isola centrale | mini 14–18 m interamente sormontabile, 18–25 m parzialmente; compatte non sormontabile | V / S |
| Anello, ingressi a una corsia | 7,00 m (6,00 se il diametro è ≥ 40 m); due corsie 8,5–9 m | S / T |
| Bracci | ingresso 3,50 (6,00 a due corsie); uscita 4,50 (4,00 sotto i 25 m) | S / T |
| Fascia sormontabile, isole spartitraffico | 1,5–2 m con cordolo basso; isole a goccia 1,5–3 × 10–20 m | T |
| Raggio dei cordoli agli angoli | 5–8 m sulle vie locali, 10–15 m sulle vie dei bus | T (oggi 3,5 e 7) |
| Ingombro in curva | ogni veicolo deve stare in una corona di raggio esterno 12,50 m e interno 5,30 m (art. 217) | V |
| Triangolo di visibilità | lato corto 20 m (precedenza) o 3 m dietro la linea (STOP); lato lungo D = v·t, t = 12 s (precedenza) o 6 s (STOP) | S |

### 3.3 Fermate dei bus

| Elemento | Valore | Stato |
|---|---|---|
| Zona di fermata (art. 151) | 12 m d'ingresso + (bus più lungo + 2 m) + 12 m d'uscita: **38 m per il bus da 12 m, 44 m per lo snodato** | V |
| Segnaletica (art. 151) | gialla, linee da 12 cm; linea tratteggiata a ≥ 2,70 m dal cordolo chiusa da linee trasversali; scritta BUS; zig-zag facoltativi nei tratti d'ingresso e d'uscita | V |
| Zig-zag e scritta BUS | passo 1–1,5 m, ampiezza 0,5–1 m; lettere alte circa 1,6 m | T |
| Posizione rispetto agli incroci (art. 352) | dopo l'incrocio, a ≥ 20 m; prima, a ≥ 10 m, se la coda dei bus lo bloccherebbe | S |
| Golfo di fermata | largo 3,00 m (Roma) | S |
| Cordolo d'accosto | 15–22 cm per i bus a pianale ribassato (nessun valore nazionale) | S / T |
| Pensilina | 3–6 × 1,4–1,8 m, alta circa 2,5 m, con ≥ 1,5 m liberi davanti; non deve coprire le porte né la vista del bus | T / S |
| Palina | in testa alla fermata (il bus si ferma con la porta anteriore alla palina), 0,3–0,5 m dal bordo | T |
| Strisce pedonali | dietro il bus fermo | T |

### 3.4 Segnaletica orizzontale e verticale (Regolamento CdS)

| Elemento | Valore | Stato |
|---|---|---|
| Linee longitudinali (art. 138) | 12 cm su D ed E, 10 cm su F | V |
| Linee di margine (art. 141) | 15 cm su D ed E, 12 cm su F | S |
| Tratteggio urbano (art. 138) | 3,0 m pieno e 3,0 m vuoto; 4,5 e 1,5 prima di una linea continua | V / S |
| Linea d'arresto (art. 144) | continua, larga ≥ 50 cm | V |
| Denti di squalo (art. 144) | base 40–60 cm, altezza 60–70 cm | V |
| Strisce pedonali (art. 145) | strisce da 50 cm con intervalli da 50 cm; profondità ≥ 2,50 m su E/F e ≥ 4,00 m sulle altre | V / S |
| Attraversamento ciclabile (art. 146) | due tratteggi larghi 50 cm, distanti ≥ 1 m | S |
| Frecce (art. 147) | punta ≥ 5 m prima della linea d'arresto; lunghe circa 4,5 m in città | S / T |
| Scritta STOP (art. 148) | lettere alte 1,60 m in città, 1–3 m prima della linea | S |
| Cartelli (art. 80) | normali: disco 60 cm, triangolo 90 cm, ottagono dello STOP 90 cm | S |
| Altezza dei cartelli (art. 81) | bordo inferiore 0,60–2,20 m, ≥ 2,20 m sui marciapiedi, ≥ 5,10 m sopra la carreggiata | V |
| Distanza dal bordo (art. 81) | bordo interno a 0,30–1,00 m dal cordolo | S |
| Dare precedenza (art. 106) | ≤ 10 m dalla carreggiata con precedenza, in città | S |

### 3.5 Semafori (art. 159–168 Regolamento CdS)

| Elemento | Valore | Oggi nel gioco | Stato |
|---|---|---|---|
| Sequenza | verde → giallo → rosso; **non c'è il rosso+giallo** | uguale | V |
| Lenti | 200 mm (300 mm ammesse, a volte solo per il rosso) | — | S |
| **Palo** | sul margine destro, su marciapiede o isola, **subito oltre la linea d'arresto**, così il primo fermo vede le luci (art. 168 c. 1 e 8) | stimato, 21% in carreggiata | V |
| Ripetitrice a sinistra | solo su isole o marciapiedi; **obbligatoria sui sensi unici con 2 o più corsie** (art. 168 c. 3) | non c'è | V |
| Lanterne sopra la carreggiata | centrate sulle corsie, bordo inferiore a 5,10–6,00 m (art. 168) | non ci sono | V |
| Altezza delle lanterne sul palo | bordo inferiore a 2,00–3,00 m | circa 3,3 m | S |
| Giallo | 3 s a 50 km/h, 4 s a 60 km/h o con molti mezzi pesanti, 5 s a 70 km/h (Nota MIT 67906/2007) | 3 s | S |
| Tutto rosso | 1–3 s | 1 s | T |
| Ciclo | 60–120 s (piani fissi di solito 90 s); verde minimo 5–7 s | 31 s | T / S |
| Pedonali (art. 162) | figura rossa in alto, gialla, verde in basso; segnale acustico | — | V / S |
| **Semafori del tram** (art. 161) | fondo nero. **Barra orizzontale = fermo; triangolo giallo con la punta in alto = prepararsi a fermarsi; barra verticale = via** (inclinata per le svolte). Si accendono nell'ordine via → triangolo → fermo | come nelle norme | V |
| Priorità al tram a Padova | il SIR1 ha il preferenziamento, con rilevatori lungo la rotaia (prova di La Semaforica in via Guido Reni); il Comune segnala chiamate perse | chiamata 25 + 6·v m prima | S |

### 3.6 Tram (Translohr del SIR)

| Elemento | Valore | Oggi nel gioco | Stato |
|---|---|---|---|
| Veicolo STE3 | 25,0 × **2,20** × 2,89 m; raggio minimo 10,5 m; pianale 25–35 cm | 25 × 2,2 | V / S |
| Corsia | 3,50 m (dossier SIR2); due binari affiancati occupano 5,2–5,4 m | 3,4 | S |
| Banchina | alta 23,5 cm (SIR3); lunga 33 m e larga 2,1 m (SIR2) | 30 × 2,0–2,8 | S |
| Filo di contatto | nominale 5,60 m (4,40–6,00), CEI EN 50119 | 5,60 | S |

### 3.7 Arredo e verde

| Elemento | Valore | Stato |
|---|---|---|
| Lampioni (LR Veneto 17/2009) | interdistanza ≥ 3,7 × altezza: pali da 8–10 m ogni 30–37 m sulle vie D/E, da 6–8 m ogni 22–30 m sulle F; mensole a muro o tesate nel centro storico | S / T |
| Alberi | filari ogni 8–12 m (specie grandi), 6–8 m (medie); buche ≥ 1,5 × 1,5 m; spartitraffico alberati del Piano del Verde di Padova larghi 4–9 m | T / S |
| Viali dei parchi | 3–4 m i principali, 1,5–2,5 m i secondari (minimo 0,90 m) | T / V |
| Dissuasori | alti 0,8–1,0 m ogni 1,2–1,5 m, passaggio ≥ 0,90 m | T |

Fonti principali, con i link nella ricerca:
- Regolamento CdS, art. 138–168, testi su patente.it e leggeinchiaro.it;
- DM 5/11/2001 e DM 19/4/2006;
- DM 557/1999 (ciclabili);
- Nota MIT 67906/2007 (durata del giallo);
- dossier del SIR2 e progetto definitivo del SIR3 (comune.padova.it);
- Piano del Verde e Criteri progettuali dell'illuminazione del Comune di Padova.

Restano da leggere sul testo originale:
- la tabella delle rotatorie a più corsie;
- le figure II.438 (frecce) e II.447 (zig-zag);
- l'art. 66 del Regolamento Edilizio sui portici.

---

## 4. Pipeline a strati

Ogni elemento della città ha **una fonte di verità per strato**, scelta con una regola di priorità fissa. Ogni
elemento ricorda da quale fonte viene: un campo `src` nell'export, che serve per il debug e per mostrare nel gioco cosa
è misurato e cosa è stimato.

Regola di priorità, uguale per tutti gli strati:

1. **dato misurato ufficiale**: Regione Veneto DBT/CTR, Comune di Padova, Catasto;
2. **dato OSM esplicito** (via Overture o export): `width`, `sidewalk:*:width`, vie `footway=sidewalk`, aree;
3. **dato OSM indiretto**: `lanes`, `sidewalk=both`, `parking:*`, classe della strada;
4. **regola dalle norme** (sezione 3), con i vincoli del luogo: facciate, acqua, binari.

Strati, dal basso:

| # | Strato | Fonte (in ordine di priorità) | Cosa cambia rispetto a oggi |
|---|---|---|---|
| 0 | Terreno e quote | DTM LiDAR regionale → quote dei ponti OSM (`layer`, `bridge`) | Argini, rampe e cavalcavia alla quota vera; profilo delle strade |
| 1 | Rete (grafo) | OSM via Overture `segment` + `connector`, oppure export | Aggiornabile da qui ogni mese; stessi archi e nodi di oggi |
| 2 | **Carreggiata** (asfalto) | DBT "area stradale", se ottenibile → OSM `width` / `est_width` → `lanes` × larghezza di corsia per classe + corsie bus e parcheggi (`parking:*`) → regola per classe | Larghezze vere dove ci sono; le facciate restano un vincolo, ma non più l'unica misura |
| 3 | **Marciapiedi** | DBT "marciapiede" → vie OSM `footway=sidewalk` (distanza dall'asse = metà carreggiata) → `sidewalk:*:width` → `sidewalk=both/left/right` con larghezza dalle norme → nessuno se `sidewalk=no` | Niente più fascia fissa da 3,5 m; marciapiedi solo dove ci sono |
| 4 | Isole e spartitraffico | DBT → OSM `area:highway`, `traffic_island`, `junction=roundabout` (isola centrale) → buchi della carreggiata (come oggi) | Isole misurate dove ci sono |
| 5 | Attraversamenti | Linee `footway=crossing` (lunghezza e posizione vere) → nodi `crossing` (come oggi) | Strisce lunghe quanto la carreggiata, nel punto vero, inclinate come la via |
| 6 | Zone pedonali e piazze | `land_use` pedestrian/plaza + `highway=pedestrian` area | Piazze lastricate senza carreggiata: Erbe, Frutti, Signori… |
| 7 | Verde | `land_use` park/grass/garden/pitch, `land` tree/tree_row; poi il censimento del verde del Comune o lo Street Tree Layer di Copernicus | Parchi e alberi reali, filari lungo i viali |
| 8 | Acque | `base/water` (aree) + export attuale | Fiumi e canali con la sponda vera |
| 9 | Edifici | Overture (pianta) + altezza: CTR/DBT (quota di gronda) → OSM `height`/`building:levels` → stima ML (come oggi) | Altezze misurate in centro storico |
| 10 | Fermate | GTFS (identità, ordine, orari) + nodo OSM `bus_stop` per la posizione della palina + `shelter`/`bench` | Vedi sezione 5.2 |
| 11 | Semafori | Nodi OSM `traffic_signals` (+ elenco degli impianti del Comune, se c'è) | Vedi sezione 5.1 |
| 12 | Tram | Binari e banchine OSM (come oggi) + attraversamenti con le strade | Vedi sezione 5.3 |
| 13 | Arredo | `infrastructure`: lampioni, panchine, dissuasori, cordoli, posti auto | Arredo reale dove mappato, regole dove manca |

Dove due strati si contendono lo stesso spazio vale l'ordine: acqua e binari > carreggiata > marciapiede > verde >
edifici. Gli edifici si ritagliano solo se lo scarto è piccolo (meno di 1,5 m); se è più grande è un errore dei dati e
finisce nel rapporto di verifica, invece di spostare le facciate in silenzio.

---

## 5. Semafori, fermate e tram

### 5.1 Semafori per le auto

Dove: solo dove OSM (o il Comune) mette un semaforo. Le 135 installazioni attuali vengono già dai nodi OSM; si
tengono. Si corregge il **dove** e il **come**.

1. **Approcci veri.** 152 semafori OSM su 228 hanno il verso (`traffic_signals:direction`): il nodo è sulla linea
   d'arresto di quell'approccio, che si mette lì invece di stimarla. Senza verso: la linea d'arresto è 1 m prima del
   primo attraversamento dell'approccio (le linee `footway=crossing`, profonde 2,5–4 m), altrimenti al bordo
   dell'incrocio della pianta delle strade.
2. **Palo sul marciapiede, subito oltre la linea d'arresto** (art. 168: il primo fermo deve vedere le luci). Dal punto
   della linea si va verso destra fino al **bordo vero dell'asfalto** (`surfaceOff` della pianta delle strade) e ci si
   mette 0,3–1 m oltre. Mai in carreggiata: un palo che cade nell'asfalto è un errore di build. Sulle carreggiate
   separate il palo può stare sullo spartitraffico, se è un'isola della pianta.
3. **Lanterne come nelle norme** (sezione 3.5).
   - Una lanterna principale a destra, con il bordo inferiore a 2–3 m.
   - Una **ripetitrice a sinistra** sulle isole o sui marciapiedi: obbligatoria sui sensi unici con 2 o più corsie.
   - Lanterne sopra la carreggiata (5,10–6,00 m) sulle vie larghe.
   - Ogni lanterna è orientata sull'asse dell'approccio, non sull'arco del grafo: corregge "orientati male".
4. **Fasi coerenti con il traffico.** Gruppi di movimenti compatibili: gli approcci opposti insieme, quelli che si
   incrociano mai insieme.
   - Le vie a senso unico in uscita non hanno lanterna.
   - Le svolte a sinistra protette si danno dove OSM ha `turn:lanes` con una corsia dedicata.
   - Verde → giallo → rosso, senza rosso+giallo.
   - Giallo 3 s (4 s sulle vie dei bus), tutto rosso 1–2 s, ciclo intorno ai 90 s. Il ciclo di oggi è 31 s: per il
     gioco si può accorciare, ma tenendo le proporzioni.
5. **Coordinamento.** Onda verde lungo gli assi principali percorsi dai bus: offset dei cicli secondo la distanza e la
   velocità. Il tram ha la sua fase con la chiamata, come oggi.
6. **Pedonali.** I 41 impianti pedonali restano: verde lungo ai veicoli e chiamata pedonale. Lanterna solo nei versi
   dati da `traffic_signals:direction`, come già annotato in `IDEE.md`.

### 5.2 Fermate

Si tiene il lavoro fatto: le fermate GTFS danno identità, ordine e orari, e oggi 479 paline su 494 stanno già al
posto giusto. OSM migliora la **posizione**.

- **Misura del 6 novembre.** Delle 473 fermate servite nell'area, **393 hanno un nodo OSM `bus_stop` entro 25 m**
  (mediana 8,5 m) e 61 nessuno entro 40 m.
- **Regola.** Si usa la posizione OSM se è entro 25–30 m dalla fermata GTFS e sta dal lato del verso servito, cioè a
  destra della linea che la serve. Altrimenti resta il posizionamento attuale.
- **Arredo.** Pensilina solo dove OSM dice `shelter=yes` (163) o dove la fermata è importante e il marciapiede è
  largo; panchina con `bench=yes`.
- **Golfo di fermata** se OSM lo indica; segnaletica gialla come oggi, con le misure delle norme.
- **Controllo.** Palina sul marciapiede (0,4–3 m dal bordo); zona di fermata libera da passi carrai e attraversamenti
  vicini.

### 5.3 Tram

- **Binari e banchine** come oggi, da OSM.
- **Semafori del tram** a ogni attraversamento a raso con una strada (oggi 86) e integrati nei semafori stradali
  vicini (fase tram).
- **Controlli.** Segnale a destra del binario prima della strada, mai sulla carreggiata; banchina accessibile dal
  marciapiede o da un attraversamento.

---

## 6. Verifiche

### 6.1 Automatiche: rapporto a ogni build

Uno script di verifica (Playwright headless, come i test di oggi) scrive un rapporto con numeri da confrontare tra
una build e l'altra:

- **pali in carreggiata**: semafori, cartelli, lampioni, paline. Obiettivo 0. Oggi 73 semafori e 12 paline;
- edifici che invadono la carreggiata o il marciapiede minimo;
- marciapiedi più stretti di 1,5 m, che non sono marciapiedi;
- attraversamenti che non toccano due marciapiedi o isole;
- approcci semaforizzati senza lanterna o con lanterna che non guarda l'approccio (scarto > 20°);
- fasi in conflitto (due approcci che si incrociano con il verde insieme);
- percorsi dei bus liberi (come oggi), fermate raggiungibili;
- quota di strade con larghezza **misurata** o **stimata** (per vedere i progressi).

### 6.2 Visive

- **Ortofoto come terreno** in modalità Esplorazione (vista dall'alto), per confrontare a colpo d'occhio strade,
  marciapiedi e verde con la realtà. Servono le ortofoto regionali (licenza da verificare, vedi 2.2) o AGEA; non Google
  o Bing.
- Le segnalazioni dei giocatori (modulo Richieste) vanno tradotte in casi di prova, cioè coordinate da ricontrollare
  a ogni build.

---

## 7. Tappe

| Tappa | Cosa | Serve | Sessioni |
|---|---|---|---|
| **M0** | Strati Overture nella pipeline: parchi, prati, zone pedonali, piazze, alberi, geometria delle strisce, marciapiedi mappati, `width` OSM nella carreggiata, posizione delle paline e pensiline da OSM. Rapporto di verifica (6.1) | Niente: Overture è raggiungibile | 2 |
| **M1** | Semafori rifatti (5.1): lanterna sulla linea d'arresto e sul marciapiede vero, ripetitrici, fasi e onda verde, controlli | Niente | 1–2 |
| **M2** | Carreggiate e marciapiedi misurati dalla Regione (DBT), con la conflazione sulla rete OSM | Accesso ai dati regionali (2.2) | 2–3 |
| **M3** | Altezze degli edifici misurate (CTR/DBT o LiDAR DSM) | Come M2 | 1–2 |
| **M4** | Terreno e quote dal DTM: argini, rampe, sottopassi | Come M2 | 1 |
| **M5** | Ortofoto per la verifica visiva (ed eventualmente come terreno) | Servizio WMS/WMTS regionale o AGEA | 1 |
| **M6** | Semafori e segnaletica dal Comune (elenco degli impianti, fasi), se pubblicati | Dati del Comune | 1 |

### Cosa serve per partire

- **M0 e M1 si possono fare subito**, da qui.
- **Per M2–M6** servono i dati regionali e comunali. Due strade:
  1. **aggiungere all'ambiente cloud gli host** che li servono (elenco in 2.2), così ogni sessione li scarica da sola;
  2. oppure **scaricarli dal browser** e mettere i file in `data/`, come per l'export Overpass.
