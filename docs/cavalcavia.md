# Cavalcavia: la regola del profilo

Regola per il profilo dei cavalcavia del gioco (ticket #83, issue madre #82) e controllo di quanto la mappa di oggi se
ne allontana. La usa #84 (profilo dei cavalcavia secondo la regola, con le rampe del tram di #74). Ricerca del 12
novembre 2026. Come in [`binari-tram.md`](binari-tram.md), ogni numero porta la sua fonte (elenco in fondo) e una di
due parole:

* **confermato**: lo scrive una fonte;
* **inferenza**: è una deduzione, un calcolo con le formule di una fonte o una scelta di questa regola. Va verificata.

Le fonti sono le norme sulle strade nuove: il DM 5 novembre 2001 sulle strade ([N1]) e il DM 19 aprile 2006 sulle
intersezioni ([N2]). Per le strade esistenti sono «di riferimento» ([N3]): il gioco le prende come regola del disegno,
perché un cavalcavia vero ci sta dentro. Per i binari valgono i numeri di [`binari-tram.md`](binari-tram.md).

## 1. La regola in breve

1. **Sale, sta in piano, scende.** Da terra a terra il profilo di un cavalcavia è fatto di livellette (tratti a
   pendenza costante) raccordate da archi di parabola: sale, sta in piano o fa un dosso, scende. **Niente onde**: una
   conca o un gradino di almeno **0,10 m** con la salita o la discesa attorno più corta di **100 m** è un'onda.
2. **Pendenza massima** per tipo di strada: **6%** sulle urbane di scorrimento (tangenziali, corsi), **8%** sulle urbane
   di quartiere, **10%** sulle locali, **7%** sulle rampe di svincolo; **6%** per il tram (4% in fermata).
3. **Raccordi verticali** con il raggio minimo del tipo di strada, sui dossi e nelle conche:

   | | velocità di progetto | dosso | conca |
   |---|---|---|---|
   | urbana di scorrimento (D) | 60 km/h | 1350 m | 1450 m |
   | urbana di quartiere (E) | 50 km/h | 800 m | 1030 m |
   | locale (F) | 40 km/h | 450 m | 690 m |
   | rampa di svincolo | 40 km/h | 1000 m | 500 m |
   | tram | | 120 m | 350 m |

4. **Strada e binari sullo stesso impalcato alla stessa quota**, entro **0,10 m**.
5. **Quote dai dati.** Fuori dai ponti la strada sta sul terreno o sul rilevato, che il DTM vede: resta entro **0,5 m**
   dal DTM. Sui ponti (`bridge` di OSM) il DTM non c'è, perché le campate sono state tolte dal rilievo: la quota viene
   dalle spalle, con il franco sopra quello che passa sotto (**5,00 m** sopra le strade, **6,90 m** sopra la
   ferrovia elettrificata in corrente continua, dal piano del ferro all'intradosso) più lo spessore dell'impalcato.
6. **Eccezioni scritte.** Dove un vincolo vero obbliga a uscire dalla regola, l'eccezione ha una zona e il suo perché,
   come in `ECCEZIONI` di `scripts/binari_tram.py`. Oggi non ce ne sono: le scrive #84 dove servono.

## 2. I numeri e le fonti

### Tipi di strada

* Il DM 2001 divide le strade urbane in A (autostrade), D (urbane di scorrimento), E (urbane di quartiere) e F
  (locali), con l'intervallo della velocità di progetto: D da 50 a 80 km/h, E da 40 a 60, F da 25 a 60.
  **Confermato** [N1] tab. 3.4.a, p. 21.
* Nella rete del gioco il tipo viene dalla classe OSM della via (`DRIVE` in `scripts/build_map.py`): `trunk` con il
  nome (le tangenziali: Corso Australia, Corso Argentina, Corso Boston, Corso Irlanda, Corso Primo Maggio, Corso Tredici
  Giugno, Via Boves) è D; `trunk` senza nome è una rampa di svincolo; `primary`, `secondary` e `tertiary` sono E; le
  altre F. **Inferenza**: OSM classifica per importanza, il DM per funzione. Nella rete `trunk` e `trunk_link` hanno la
  stessa classe, e le rampe si riconoscono solo perché in OSM di solito non hanno il nome.
* Velocità di progetto della regola: 60 km/h per D, 50 per E, 40 per F e per le rampe. **Inferenza**: dentro gli
  intervalli del DM, vicino al limite urbano di 50 km/h. Sulle tangenziali i limiti OSM arrivano a 90 e 110 km/h: con
  quelle velocità i raggi minimi passerebbero i 2,5 km.

### Pendenze

* Pendenza massima in ambito urbano: A 6%, D 6%, E 8%, F 10% (fuori città A 5%, B 6%, C 7%, F 10%). Si può aumentare di
  un punto «qualora … lo sviluppo della livelletta sia tale da non penalizzare eccessivamente la circolazione»; la
  regola non usa l'aumento. **Confermato** [N1] § 5.3.1, p. 77.
* In galleria al più il 4% sulle A, B e D. Per ponti e viadotti il DM chiede solo di non cambiare la piattaforma, nessun
  limite di pendenza proprio. **Confermato** [N1] pp. 34 e 78.
* Rampe di svincolo: 7% in salita e 8% in discesa a 40 e 50 km/h, 10% a 30 km/h, 5-6% da 60 km/h in su; «al raggio
  planimetrico minimo è sempre associata la pendenza massima del 7,0%». La regola prende il 7% nei due versi.
  **Confermato** [N2] tab. 8, § 4.7.2.
* Tram: 6% in linea, 4% in fermata e ai capolinea. **Confermato** in [`binari-tram.md`](binari-tram.md). Nel SIR2 il
  cavalcavia San Marco ha rampe del 2,85% e del 4,26% e la pendenza più forte della linea è il 4,8%. **Confermato**
  [F14] pp. 15 e 26.

### Raccordi verticali

* I raccordi sono «archi di parabola quadratica», lunghi L = Rv·Δi/100. Ogni cambio di pendenza va raccordato; il DM
  non dà una lunghezza minima delle livellette. **Confermato** [N1] § 5.3.1-5.3.2.
* Sui dossi il raggio minimo viene dalla distanza di visibilità per l'arresto D: Rv = D²/[2(h1 + h2 + 2√(h1·h2))], con
  l'occhio a h1 = 1,10 m e l'ostacolo a h2 = 0,10 m (se D è più corta del raccordo). **Confermato** [N1] § 5.3.3.
* Nelle conche il raggio minimo viene dalla visibilità di notte con i fari: Rv = D²/[2(h + D·sin θ)], con h = 0,5 m e
  θ = 1°. **Confermato** [N1] § 5.3.4.
* Comfort: accelerazione verticale v²/Rv al più 0,6 m/s². Minimi assoluti per non toccare il fondo: 20 m sui dossi, 40 m
  nelle conche. **Confermato** [N1] § 5.3.2.
* Distanza di visibilità per l'arresto, D = D1 + D2: tempo di reazione τ = 2,8 − 0,01·V secondi, attrito longitudinale
  0,45 a 25 km/h, 0,43 a 40, 0,35 a 60; dal grafico del DM, in piano, circa 41 m a 40 km/h, 55 a 50, 70 a 60.
  **Confermato** [N1] § 5.1.2, fig. 5.1.2.c.
* Con queste formule, in piano: a 40 km/h D = 40,8 m, dosso 447 m, conca 687 m, comfort 206 m; a 50 km/h D = 54,6 m,
  dosso 800 m, conca 1026 m, comfort 322 m; a 60 km/h D = 70,8 m, dosso 1345 m, conca 1444 m, comfort 463 m. La regola
  arrotonda a 450/690, 800/1030, 1350/1450 m. **Inferenza** (calcolo con le formule del DM; con ±6% di pendenza D cambia
  di 3-6 m).
* Rampe di svincolo: raggi minimi 1000 m sui dossi e 500 m nelle conche a 40 km/h (1500 e 750 m a 50 km/h).
  **Confermato** [N2] tab. 8.
* Tram: 350 m nelle conche e 120 m sui dossi. **Confermato** in [`binari-tram.md`](binari-tram.md) ([F1] foglio 40).

### Onde

* Il DM non fissa una lunghezza minima delle livellette e non parla di onde: chiede livellette raccordate. Una conca tra due dossi è ammessa se pendenze e raggi
  rispettano i minimi, e per una conca profonda h servono almeno √(8·h·R) metri (con R = 1000 m: 28 m per 0,1 m, 89 m
  per 1 m). **Inferenza** (geometria delle parabole).
* La regola del gioco vieta le onde corte sui cavalcavia, quelle che chi gioca vede come «su e giù»: una conca o un
  gradino di almeno 0,10 m tra due punti di svolta, con la discesa o la salita più corta di 100 m. Due cavalcavia di
  fila con la strada che torna a terra in mezzo non sono un'onda. **Inferenza** (scelta della regola): 0,10 m sono due
  gradini della griglia del terreno del gioco (5,6 cm), 100 m sono meno di una rampa di un cavalcavia vero.

### Strada e binari

* Sullo stesso impalcato strada e sede del tram sono un piano solo (cavalcavia Borgomagno, Chiesanuova, San Marco, Via
  Venezia). La tolleranza di 0,10 m è una scelta della regola: un gradino più alto si vede tra la corsia e la sede.
  **Inferenza.**
* Il binario affianca la strada se è quasi parallelo (seno dell'angolo fino a 0,7) ed entro metà carreggiata più 9 m
  dall'asse, come `City.nearElevatedHeight` nel gioco e `_tram_heights` in `scripts/street_surfaces.py`.

### Quote: DTM, DBGT e franchi

* Il DTM LiDAR a 5 m della Regione non dichiara la precisione verticale; il capitolato regionale del 2015 (Belluno e
  Vicenza) chiede ±15 cm (1σ). **Confermato** per quell'appalto [R2] slide 38, **inferenza** per Padova. Su terreni in
  pendenza la differenza con un DTM a 1 m ha deviazione standard di 0,36 m. **Confermato** [R3].
* Dal DTM si tolgono edifici e «manufatti», le infrastrutture viarie comprese. **Confermato** [R2] slide 23 e 35. In
  `data/dtm-padova.json` i rilevati delle rampe ci sono e le campate no: Chiesanuova 8,5 e 8,8 m alle testate, 2,2 m a
  metà impalcato; Borgomagno 1,6 e 3,2 m, −0,6 m; San Marco 3,2 e 5,1 m, 0,2 m. **Inferenza** (misura sulla griglia a
  10 m). Quindi `docs/OPEN_DATA.md`, dove dice che dal DTM i cavalcavia «verrebbero alla quota vera», vale per le rampe
  e non per gli impalcati.
* Scarto massimo dal DTM fuori dai ponti: 0,5 m. **Inferenza** (scelta della regola): tre volte i 15 cm del capitolato,
  più la media dei punti a 2,5 m dal centro delle celle da 10 m (`scripts/dtm_grid.py`) sui fianchi dei rilevati.
* Il DBGT ha gli assi stradali in 3D (`EL_STR`, «GU_CPCurve3D»), ma il catalogo nazionale non fissa l'accuratezza
  altimetrica. **Confermato** [R4] pp. 14 e 67. Il capitolato della CTRN del Veneto chiede i punti quotati a 1:5000
  entro 0,80 m nel 95% dei casi e la quota di «tutti i punti superiori ed inferiori dei sovrappassi». **Confermato**
  per il lotto ETRA [R5] artt. 35 e 37, **inferenza** per Padova. Con gli assi del DBGT nei dati lo scarto massimo da
  loro sarà 0,8 m, anche sui ponti. **Inferenza.** Oggi `EL_STR` non è nei dati: il controllo non lo misura.
* Franco sopra le strade almeno 5,00 m. **Confermato** [N1] § 4.1.1, p. 37. Sopra la ferrovia elettrificata 6,90 m dal
  piano del ferro all'intradosso in corrente continua, 7,20 m a 25 kV. **Confermato** di seconda mano, dalla specifica
  RFI citata in [R1] slide 62. Con l'impalcato (0,9 m in `scripts/street_surfaces.py`) la strada sta circa 8 m sopra i
  binari della ferrovia. **Inferenza.** Nel DTM le testate di Chiesanuova sono 6,3-6,6 m sopra il terreno a metà
  impalcato: la griglia a 10 m smussa testate e fondo, o il piano del ferro non è il terreno misurato lì. Da
  verificare su ogni cavalcavia prima di fissarne la quota.

## 3. Come sono fatti oggi i cavalcavia del gioco

Le quote vengono da `scripts/street_surfaces.py` (`overpass_heights` per i nodi della rete, `terrain_for_game` e
`adjust_heights` per il terreno); il gioco somma la quota del terreno "via" (`src/world/terrain.js`) e quella della rete
lungo gli archi (`edgeHeight` in `src/world/city.js`). Da qui vengono quasi tutti i casi della sezione 5:

* **Impalcato a 7 m sopra il terreno spianato.** I nodi dei ponti OSM in quota (`layer` ≥ 1 sopra la ferrovia o un'altra
  strada) stanno a 7 m (`H_DECK`) sopra il terreno, che sotto i tratti in quota si spiana al 30° percentile del terreno
  intorno, ma resta il DTM dove il DTM è più basso. Sotto un viadotto il terreno ha conche e gradini, e l'impalcato li
  ripete 7 m più su: su Corso Irlanda (3650, −2110) sale di 5,3 m in 30 m e riscende (pendenze del 32%).
* **Rampe a S.** Dalla fine dell'impalcato la quota scende con una curva a S fino a terra al primo incrocio o a 130 m
  (`R_RAMP`), sopra il terreno spianato, senza guardare il rilevato del DTM. Dove il rilevato vero è più lungo o più alto
  la rampa sta sotto (Cavalcavia San Ignazio di Loyola, −6,8 m dal DTM per 343 m); dove manca sta sopra.
* **Quote nei nodi, lineari lungo gli archi.** Un arco lungo prende una rampa lunga quanto lui: Via Boves (2302, −3023)
  sale da 0 a 7 m in un chilometro sopra una strada a terra (+4,7 m dal DTM per 906 m); dove i nodi sono radi la rampa
  fa uno spigolo a ogni nodo (raggi da 45 a 200 m).
* **Fosso ai piedi.** Lo spianamento finisce 8 m oltre la carreggiata e taglia il rilevato vero: a Chiesanuova, in Via
  Vicenza (−1655, −382), la strada scende dal rilevato a 7,2 m al fondo spianato a 3,8 m in 22 m (fino al 29%) e risale
  con la rampa.
* **Rami a quote diverse.** Dove la strada del ponte si divide (Chiesanuova ovest, (−1889, −341)) ogni ramo ha la sua
  rampa, e chi passa dall'uno all'altro va giù e su di 2,6-4,1 m in 80-100 m.
* **Binari.** `TramTrack.setHeights` (`src/tram/tram.js`) prende la quota della strada che il binario affianca, fa la
  media su ±25 m e tiene la più alta tra media e strada: sulle rampe il binario resta sopra la strada, fino a 2,9 m a
  Chiesanuova (−1889, −343).

Per #84, i punti fermi che vengono dalla regola: le rampe seguono il rilevato del DTM dove c'è (entro 0,5 m), l'impalcato
va da spalla a spalla con il franco sopra quello che passa sotto, il terreno sotto l'impalcato è piatto e non scende
sotto la strada che arriva, le quote lungo gli archi sono abbastanza fitte da non fare spigoli né rampe lunghe un
chilometro, e il binario ha la quota della strada sull'impalcato che condivide.

## 4. Il controllo

`scripts/cavalcavia.py` misura il profilo di ogni cavalcavia contro la regola. Solo libreria standard di Python, come
`scripts/binari_tram.py`, da cui prende la griglia dei segmenti. Un cavalcavia è un gruppo di archi della rete in quota
(`nodeH` oltre 0,05 m, come `e.elev` nel gioco) che si toccano: impalcato, rampe e raccordi delle strade che ci si
innestano; ha il nome della via più lunga dei suoi ponti, e le coordinate quando il nome si ripete. Le reti sono due:

* **i dati**: strade e quote di `src/data/padova-map.json`, terreno "via" ricostruito dalla griglia della mappa come in
  `src/world/terrain.js` (chiusura morfologica e ponti sui fiumi, solo nelle celle che servono), binari di
  `padova-map.json` (SIR1) e `data/tram-linee-nuove.json` (SIR2 e SIR3) con la quota della strada in quota che
  affiancano. Li misura `scripts/verifica_mappa.py`, con le soglie in `SOGLIE_CAVALCAVIA`;
* **il gioco**: `tests/cavalcavia.spec.js` scrive il terreno "via" del gioco (`Terrain.d`) e i binari con le quote di
  `TramTrack.h` e chiama lo script con `--gioco`; le soglie sono nella prova. Le strade vengono dalla mappa in tutti e
  due i casi: i loro numeri coincidono, e il 12 novembre le 11.087 celle del terreno usate dai profili erano uguali a
  quelle del gioco.

```bash
python3 scripts/cavalcavia.py --elenco                        # i dati, con i cavalcavia peggiori
python3 scripts/cavalcavia.py --profilo -1889 -341            # i profili che passano da un punto, ogni 5 m
python3 scripts/verifica_mappa.py --elenco                    # i dati, dentro il rapporto della mappa (serve shapely)
npx playwright test tests/cavalcavia.spec.js                  # il gioco
python3 scripts/cavalcavia.py --gioco test-results/cavalcavia-cavalcavia-secondo-la-regola-del-profilo/cavalcavia-gioco.json --elenco
```

I profili si campionano ogni metro. Le strade si percorrono da ogni piede (nodo a terra del cavalcavia) lungo ogni arco
del gruppo, prendendo a ogni nodo l'arco più dritto entro 45° (meglio con lo stesso nome e, sul cavalcavia, in quota),
fino a terra dall'altra parte, con 60 m di strada a terra prima e dopo; un itinerario per insieme di archi del gruppo
(105 il 12 novembre). I binari si percorrono dove sono in quota, con 60 m prima e dopo. Le misure valgono dal primo
all'ultimo punto in quota del cavalcavia più 30 m per parte, per vedere il piede delle rampe. Cosa conta:

* **onde**: punti di svolta del profilo (la quota torna indietro di almeno 0,10 m); una conca tra due massimi con la
  discesa o la salita attorno più corta di 100 m. Il primo e l'ultimo punto di svolta non contano come massimi: oltre il
  piede la strada può risalire;
* **pendenze**: sopra il massimo del tipo di strada (o del tram) su 10 m;
* **raccordi**: raggio da due corde di 20 m attorno al punto, giusto per un arco di parabola; per uno spigolo dà 20 m
  diviso il salto di pendenza. Un gradino della griglia del terreno (5,6 cm su 10 m) dà più di 3 km, sopra ogni minimo;
* **binari fuori quota**: il binario più alto o più basso di 0,10 m della strada che affianca, dove uno dei due sta da
  0,6 m in su (`DECK_MIN`, l'impalcato);
* **scarti dal DTM** (solo strade): oltre 0,5 m dal DTM senza ritocchi (`data/dtm-padova.json`), per almeno 5 m, fuori
  dai ponti OSM e a più di 15 m da loro (spalle e travi).

Un caso è un tratto, con il punto peggiore, il posto (coordinate del gioco, fermata del tram vicina) e un peso: la
profondità diviso 0,10 m per le onde, la pendenza diviso il massimo, il minimo diviso il raggio, lo scarto diviso la
tolleranza. Lo stesso posto trovato da più itinerari conta una volta; i casi sugli archi in quota di un altro
cavalcavia sono di quello. I cavalcavia peggiori sono quelli con la somma dei pesi più alta. Il rapporto JSON
(`--json`) ha i casi e i numeri di ogni cavalcavia (`per_cavalcavia`).

Le soglie sono sui totali di strade e binari, valori del 12 novembre: se un numero scende si abbassa la soglia nello
stesso commit, come per il resto del rapporto della mappa. Non si contano ancora: i franchi sopra strade e ferrovia,
le pendenze del tram in fermata (4%), lo scarto dagli assi del DBGT (non sono nei dati), la differenza tra salita e
discesa sulle rampe di svincolo.

## 5. La mappa del 12 novembre 2026

44 cavalcavia, 42 km di archi in quota. Casi in tutto, dati / gioco:

| | onde | pendenze | raccordi | binari fuori quota | scarti dal DTM |
|---|---|---|---|---|---|
| strade | 113 / 113 | 228 / 228 | 484 / 484 | – | 221 / 221 |
| binari | 20 / 18 | 34 / 32 | 18 / 13 | 0 / 25 | – |

Ogni cavalcavia ha qualche caso. Nei dati il binario ha per definizione la quota della strada, nel gioco la media di
`setHeights` lo porta fuori quota a Chiesanuova (10 casi), San Marco (9), Borgomagno (4) e Via Venezia (2).

### Cavalcavia peggiori (per #84)

Dal gioco, per somma dei pesi; coordinate del gioco (x verso est, z verso sud), linee che ci passano.

1. **Corso Irlanda** (3876, −2057), tangenziale est, 7,1 km di viadotti e rampe, nessuna linea: peso 651; strade 21
   onde, 32 pendenze, 63 raccordi, 15 scarti dal DTM. L'impalcato ripete il terreno sotto: in (3650, −2110) sale di
   5,3 m in 30 m (dossi di raggio 45 m, pendenze del 32%) e scende in una conca di 2,7 m; rampe 4,4 m sopra il DTM in
   (3811, −1591).
2. **Cavalcavia Chiesanuova** (−1897, −334), linee 6 e 10, SIR2: peso 607; strade 8 20 23 20, binari 10 onde, 20
   pendenze, 8 raccordi, 10 fuori quota. Conche di 4,1 m in 100 m e di 2,6 m in 80 m dove i rami si dividono, sul lato
   ovest (−1889, −341) e (−1921, −343); fosso in Via Vicenza (−1655, −382) con pendenze del 29% (30% sul binario);
   rampa est 4,6 m sotto il rilevato del DTM; SIR2 fino a 2,9 m sopra la strada.
3. **Corso Australia e Cavalcavia San Ignazio di Loyola** (−1419, −1998), nessuna linea: peso 275; strade 6 10 10 3.
   Conca di 4,7 m in 166 m (−1490, −1827), pendenza del 40% sulla rampa del San Ignazio (−1500, −1805), strada 6,4 m
   sotto il DTM per 154 m.
4. **Corso Tredici Giugno e Via Boves** (1182, −3448), linea 24: peso 231; strade 4 15 31 10. Conche da 0,9 a 1,5 m in
   180-290 m, dossi di raggio 130 m, strada 5,4 m sopra il DTM (1010, −3499).
5. **Cavalcavia San Marco** (4513, −1476), linea 10, SIR2: peso 199; strade 8 5 16 9, binari 7 8 5 9. Rampa al 19%
   (4576, −1500), 16% sul binario; conca di 1,3 m in Via dell'Ippodromo (4540, −1584); SIR2 fino a 0,8 m sopra la strada.

Poi, nell'ordine: Via Boves (1575, −3301), i due Cavalcavia Antonio Grassi (1879, −1253) e (1915, −1271), Corso
Australia (−1479, −1826) e (−880, −3218), Corso Tredici Giugno (−693, −3928), Corso Argentina (4281, −195, linea 7).
Dove passano i bus, oltre a Chiesanuova, San Marco e Corso Tredici Giugno: Cavalcavia Camerini (−273, −2456, linea 13:
conca di 1,8 m in 176 m e pendenza del 14,5% a (−361, −2584)), Cavalcavia Mortise (2886, −2676, linea 22: conca di
1,7 m in 41 m), Cavalcavia Borgomagno (62, −1191, linee 4, 13, 16, 19, 22, 24 e SIR1: rampa del binario all'11,6%,
strada 3,2 m sopra il DTM), Via Venezia (2981, −708, linea 10 e SIR2: strada 6,5 m sopra il DTM per 223 m),
Cavalcavia Pietro Maroncelli (2494, −997, linee 9 e 42), Cavalcavia Montà (−3166, −3008, linea 11), Via Alessandro
Volta (−1770, 4242, linea 24).

## Fonti

Lette il 12 novembre 2026; dei PDF la pagina stampata.

* [N1]: Ministero delle Infrastrutture e dei Trasporti, DM 5 novembre 2001 n. 6792, "Norme funzionali e geometriche per
  la costruzione delle strade", allegato.
* [N2]: DM 19 aprile 2006, "Norme funzionali e geometriche per la costruzione delle intersezioni stradali", GU n. 170
  del 24 luglio 2006.
* [N3]: DM 22 aprile 2004, modifica dell'art. 2 del DM 5 novembre 2001, GU n. 147 del 25 giugno 2004, p. 33.
* [F1], [F14]: progetto del SIR3 e PFTE del SIR2, come in [`binari-tram.md`](binari-tram.md).
* [R1]: Università di Trieste, corso di Strade, ferrovie e aeroporti, lezione 5 "Ferrovie", 2019-2020, slide 62 (cita la
  specifica RFI sui cavalcavia).
* [R2]: Regione del Veneto, presentazione del rilievo LiDAR 2015, slide 23, 35 e 38.
* [R3]: Vincenzi, poster ASITA 2024 sul confronto tra DTM.
* [R4]: Gruppo di lavoro 2 dell'Intesa GIS, "Catalogo dei dati territoriali - Specifiche di contenuto per i DB
  geotopografici", 9 maggio 2016.
* [R5]: Regione del Veneto, DGR 3866/2008, allegato D (capitolato della CTRN, lotto ETRA), pp. 20-21.

Non lette: il testo della specifica RFI sui cavalcavia e il manuale di progettazione delle opere civili RFI; le
specifiche del DBGT del lotto di Padova; i progetti dei cavalcavia di Padova (Borgomagno, Camerini, Grassi, Chiesanuova,
Corso Australia), di cui non si sono trovate pendenze né altezze.

[N1]: https://mit.gov.it/nfsmitgov/files/media/normativa/2016-02/Decreto_Ministeriale_numero_6792_05-11-2001_all_1.pdf
[N2]: https://moodle2.units.it/pluginfile.php/288389/mod_resource/content/1/Decreto_ministeriale_19_aprile_2006.pdf
[N3]: https://www.gazzettaufficiale.it/eli/gu/2004/06/25/147/sg/pdf
[F1]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/186_NP00_00_D_Z1_RH_IF0000_001_A.pdf
[F14]: https://www.comune.padova.it/materiali-sir-2/PD1_All.6_ProgettoFattibilita_R.00.5.0.0_signed.pdf
[R1]: https://moodle2.units.it/pluginfile.php/316536/mod_resource/content/1/SFA_M_2019-2020_L05_Ferrovie.pdf
[R2]: https://repository.regione.veneto.it/public/92224bdc9c9d8b9acb3776d2fc4e58a7.php?dl=true
[R3]: https://www.asita.it/wp-content/uploads/2024/12/poster_vincenzi_asita.pdf
[R4]: https://geodati.gov.it/geoportale/images/Specifica_GdL2_09-05-2016.pdf
[R5]: https://bur.regione.veneto.it/BurvServices/pubblica/Download.aspx?name=3866_AllegatoD_211894.pdf&type=9&storico=False
