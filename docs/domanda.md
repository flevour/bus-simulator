# Domanda di traffico (#116)

Fino al 17 novembre 2026 le auto nascevano a caso attorno a chi guida e sceglievano a caso a ogni incrocio, con un
numero fissato alla partenza della corsa. Ora ogni auto fa un viaggio: parte da un luogo, va verso un altro, e il
numero di viaggi segue l'ora del giorno. La build prepara i dati della domanda (zone, pesi, porte, tempi, curva oraria)
in un file con un solo proprietario, `src/data/padova-domanda.json` (`scripts/domanda.py`); il gioco li legge
(`src/world/domanda.js`) e decide quali viaggi passano attorno a chi guida, senza simulare tutta la città.

Numeri del 17 novembre 2026, sulla mappa di `main`. Si ristampano con `python3 scripts/domanda.py --conti`.

## 1. Il file della domanda

`python3 scripts/domanda.py` lo riscrive dalla rete della mappa (`src/data/padova-map.json`), dagli edifici delle aree
(`public/mappa/aree/`) e dai luoghi di OSM (`data/osm-luoghi.json`, #108). Solo libreria standard e solo somme,
prodotti, divisioni e radici: niente seni o esponenziali della libreria del sistema, quindi il file è lo stesso sul Mac
e in Docker. `--controlla` lo rifà e dice se è quello del repository (lo lancia anche `scripts/verifica_mappa.py`, cioè
la CI); chi cambia la rete o gli edifici lo riscrive nello stesso commit della mappa, e `scripts/rigenera_mappa.sh` lo
rifà alla fine.

| Campo | Cosa |
|---|---|
| `cella` | lato delle zone (1.000 m) |
| `costo` | modello di costo dei tempi, lo stesso nel gioco: velocità libera (14 m/s sulle strade principali fuori dal centro, 9 m/s altrove, come le auto del gioco), attesa media a un semaforo (10 s), svolta a sinistra (5 s) e a destra (2 s) |
| `zone` | `[x, z, abitanti, addetti, scuole, negozi, sosta, centro, accessi]`; `accessi` è una lista piatta di `stato, peso, tipo` |
| `porte` | `[nome, x, z, peso, stati d'ingresso, stati d'uscita]` |
| `tempi` | matrice dei tempi a rete libera (s) tra i luoghi, righe per origine: prima le zone, poi le porte; 65535 dove non si arriva |
| `scopi` | `casa_lavoro`, `lavoro_casa`, `casa_scuola`, `scuola_casa`, `altro`, `pendolari_in`, `pendolari_out`, `attraverso` |
| `od` | per scopo, righe `[origine, peso dell'origine, [destinazione, millesimi, ...]]` |
| `curva` | `feriale` e `festivo`: per scopo, i viaggi che partono in ognuna delle 24 ore |

Uno stato è un arco percorso in un verso: `2 · arco` da `a` verso `b`, `2 · arco + 1` da `b` verso `a`. I movimenti tra
stati sono i raccordi della build con il bit delle auto ([raccordi.md](raccordi.md)): niente inversioni sullo stesso
arco, nemmeno in fondo alle strade chiuse, quindi in una strada chiusa si entra e non si esce. Un viaggio parte da uno
stato da cui si torna nella componente principale della rete (tipo 1) e finisce in uno che se ne raggiunge (tipo 2).

## 2. Zone e pesi

Le zone sono le celle da 1 km con abitanti, addetti, scuole o negozi e con almeno un accesso: 107. Per ogni zona:

- abitanti: volume degli edifici residenziali diviso 250 m³. Residenziali sono gli edifici `apartments` e `house` e
  quelli di tipo non detto dentro un'area OSM residenziale o fuori da ogni area di uso del suolo. Lo standard
  urbanistico è 100 m³ per abitante (DM 1444/1968, art. 3), ma il volume della mappa conta muri, scale, sottotetti e
  garage: con 250 m³ la mappa ha circa 335.000 abitanti, i 207.000 del comune più la prima cintura che sta nella mappa;
- addetti: volume degli edifici non residenziali (industriali, commerciali, ospedali, università, scuole, stazioni, e
  quelli di tipo non detto nelle aree industriali, commerciali, militari e ferroviarie) diviso 250 m³, più il 12% del
  volume residenziale (negozi, uffici e studi nei quartieri): 153.000;
- scuole (scuole e licei 1, asili 0,5, università 2) e negozi (1, supermercati e centri commerciali 5, ospedali 10) dai
  luoghi di OSM;
- sosta: stalli lungo le strade della mappa (#111) e posti dei parcheggi pubblici (la `capacity` di OSM o uno ogni
  25 m²). È dove un viaggio può finire: entra nel peso degli accessi e nell'attrattività degli altri viaggi.

Gli accessi di una zona sono gli archi da secondary a living_street (non le strade principali né quelle di servizio,
lunghi almeno 15 m), con peso la lunghezza più 6 per ogni stallo: i 8 più pesanti tra quelli da cui si parte e gli 8
tra quelli dove si arriva soltanto. Il centro della zona è lo stato della componente principale più vicino al
baricentro degli edifici: da lì si misurano i tempi tra zone.

## 3. Porte

Le porte sono i nodi della rete con un arco solo (senza le vie pedonali) su strade da tertiary in su: dove la mappa
taglia una strada che continua fuori. Le carreggiate della stessa via entro 150 m sono una porta sola. Peso per classe:
trunk 1, primary 0,6, secondary 0,35, tertiary 0,15. Sono 61 (53 d'ingresso, 51 d'uscita). Comprese le carreggiate a
senso unico che finiscono al bordo (Corso Australia, Corso Boston, Corso Esperanto, Via Boves): da #90 erano pozzi
dove le auto non entravano più, ora sono le uscite di chi va fuori città.

## 4. Viaggi al giorno e curva oraria

| Scopo | Da dove a dove | Feriale | Festivo |
|---|---|---|---|
| casa_lavoro, lavoro_casa | abitanti verso addetti e ritorno, 17% dei viaggi dei residenti ciascuno | 62.500 + 62.500 | 12.500 + 12.500 |
| casa_scuola, scuola_casa | abitanti verso scuole e ritorno, 6% ciascuno | 22.000 + 22.000 | 0 |
| altro | tra zone (spesa, servizi, visite), 54% | 199.000 | 258.000 |
| pendolari_in, pendolari_out | dalle porte agli addetti la mattina, ritorno la sera | 60.000 + 60.000 | 9.000 + 9.000 |
| attraverso | da porta a porta, tra porte ad almeno 3 km | 25.000 | 15.000 |
| in tutto | | 513.000 | 316.000 |

I viaggi dei residenti sono 1,1 per abitante al giorno: 2,3 spostamenti, il 60% in auto, 1,25 persone per auto (ISFORT,
Audimob, valori di un capoluogo del nord). Padova attira circa 90.000 pendolari al giorno (ISTAT); 60.000 in auto sono
una stima. Non risultano conteggi di traffico aperti per Padova: i totali sono stime, la forma della curva è quella
tipica delle città italiane, e le punte sono quelle che il GTFS conferma (sezione 7).

La destinazione segue un modello gravitazionale: la probabilità di andare da `o` a `d` è proporzionale
all'attrattività di `d` (addetti, scuole, abitanti, o per gli altri viaggi negozi, addetti e sosta) per
`1 / (1 + t / T0)³`, con `t` il tempo a rete libera e `T0` 600 s per il lavoro, 300 per la scuola, 420 per gli altri,
900 per i pendolari, 1.200 per chi attraversa. Si tengono le destinazioni più probabili fino al 98%.

Viaggi che partono in un'ora, feriale (tutti gli scopi): 52.000 tra le 7 e le 8 e tra le 8 e le 9, 25.000 alle 11,
31.000 alle 12 e alle 13, 50.000 alle 17 e alle 18, 5.700 alle 22. Festivo: punte di 27.000 alle 11 e 28.000 alle 17-18.

## 5. Assegnazione con la capacità delle strade

Con i tempi a rete libera ogni viaggio prende il percorso più veloce senza guardare gli altri: alle 8, con i 52.000 viaggi
di quell'ora, su Via Gattamelata passavano 6.200 auto l'ora in un verso, quattro volte quello che porta. La build allora
assegna i viaggi di tre ore, che fanno da fasce del giorno (8, punta del mattino; 11, morbida; 17, punta della sera),
con il metodo delle medie successive: quattro giri di assegnazioni "tutto o niente" (da ogni origine un albero dei
tempi, la domanda di ogni arrivo risale l'albero), con i tempi del giro prima dati dalla funzione BPR,
`t = t0 · (1 + 0,15 · (v / c)⁴)`. La capacità `c` di uno stato è il numero di corsie nel verso (tag OSM, o dalla
larghezza) per il flusso di saturazione della classe (1.900 auto l'ora per corsia sulle trunk, 1.700 primary, 1.600
secondary, 1.500 tertiary, 1.200 unclassified, 1.000 residential, 600 le altre), per il 45% dove finisce a un semaforo.
Con quattro giri l'assegnazione non è all'equilibrio: qualche arco resta molto sopra la capacità, e il gioco tiene i
fattori al più a 8.

Nel file, per ogni fascia (`fasce`): `fattori`, `[stato, f8, f11, f17]` in centesimi, solo dove uno supera 1,1; e
`presenze`, `[i, j, p8, p11, p17]`: le auto presenti (flusso per tempo, in centesimi d'auto) nella cella da 100 m
`i, j`. Alle 8 gli stati sopra 1,1 sono 1.164 (172 oltre il doppio): Via Chiesanuova, Via Facciolati e Via Piovese
verso il centro, Ponte Voltabarozzo, Piazzale San Giovanni, Via Fabrici d'Acquapendente, Ponte Scaricatore; alle 11
182; alle 17 1.059. Auto presenti in tutta la mappa: 8.700 alle 8, 3.100 alle 11, 7.500 alle 17. L'assegnazione costa
circa un minuto (63 s sul Mac), quasi tutto il calcolo del file.

## 6. Nel gioco

`src/world/domanda.js` (`Domanda`, una per rete, costruita in `buildWorld` e rimessa a zero a ogni corsa) e
`Traffic` di `src/world/traffic.js`:

- grafo: gli stati e i movimenti dei raccordi delle auto, con lo stesso costo della build (`tempoStato`, svolte), in
  forma compatta (CSR);
- ora (`Domanda.ora`, ogni minuto di gioco, da `ctx.clock` e `ctx.giorno` che `main.js` passa a `traffic.update`):
  viaggi al secondo per coppia di luoghi dalla curva interpolata tra le ore; la fascia (mattino dalle 5 alle 10, sera
  dalle 16 alle 20, morbida il resto) e `k`, i viaggi dell'ora su quelli dell'ora della fascia. I tempi della fascia
  sono quelli a rete libera con l'eccesso dei fattori per `k⁴` (la quarta potenza del flusso della BPR, `k` al più 1,3);
- alberi: per ogni arrivo, un Dijkstra all'indietro con i tempi della fascia dice da ogni stato quanto manca. Si
  calcolano a pezzi, 4.000 stati per passo (meno di 1 ms), e se ne tengono 96; cambiano quando cambiano fascia o `k` (a
  passi di 0,1): le auto tengono l'albero vecchio finché il nuovo non è pronto. Alla partenza della corsa quelli che
  servono si calcolano subito;
- chi guida (`Domanda.centro`): il nodo della rete più vicino, P, con un albero verso P e uno da P (a rete libera). Si
  rifanno quando chi guida si sposta di più di 150 m;
- quante auto e dove (`aggiorna`): le auto attese nel disco di raggio R attorno a P sono la somma delle presenze della
  build nelle celle del disco, per `k`. R è il raggio più grande per cui sono al più 72 (`AUTO_SIMULATE` in
  `main.js`), tra 300 e 1.500 m: nelle ore di punta il disco si stringe e le strade attorno a chi guida hanno le auto
  che avrebbero davvero. Alle 8:30 il disco è di 300 m in Via Facciolati e in Via Gattamelata (lì le auto attese
  sarebbero 85-95: sotto i 300 m non si scende e se ne simulano 72), di 480 m a Tito Livio e in Via Sorio, di 650 m in
  periferia; alle 11:30 da 390 a 730 m; alle 22:30 da 850 a 1.250 m; alle 3:30 di 1.500 m con 3-26 auto;
- quale viaggio fa un'auto nuova (`campiona`): il viaggio da `o` a `d` passa vicino a P se andare da `o` a P e poi da P
  a `d` costa poco più del viaggio diretto (i tempi della build). Il tempo in più dà la distanza `x` a cui il viaggio
  passa da P (`x = 8 m/s · tempo in più / 2`) e da quella la corda del disco che percorre; chi parte o arriva negli
  accessi dentro il disco ci passa in media 8 / 3π del raggio. Si sceglie una coppia per quanto tempo i suoi viaggi
  passano nel disco, si traccia il percorso vero (l'albero dell'arrivo) e l'auto nasce a caso lungo il tratto dentro il
  disco, a più di 60 m da chi guida (250 m durante la corsa, se le auto sono almeno la metà);
- a ogni nodo (`Traffic.chooseNext` con il viaggio): il movimento che arriva prima, con i ritardi misurati dove le auto
  sono simulate (`Domanda.ritardi`: il tempo che le auto passano su uno stato oltre quello a rete libera, oltre 5 s,
  in media mobile; si dimenticano del 15% ogni 10 s). Prima la svolta dopo, poi la corsia per farla (`estendi`);
- arrivo: dove finisce lo stato d'arrivo l'auto, lontano da chi guida (60 m), esce di scena; vicino fa il viaggio dopo,
  dalla zona d'arrivo con le probabilità dell'ora. Le auto oltre R + 250 m escono di scena;
- le auto senza viaggio (quelle delle prove, `Traffic.nuova`) scelgono come prima. Senza raccordi nella rete non c'è
  domanda e le auto nascono come prima (`spawn`).

Da #60: il numero di auto non è più fissato alla partenza (55 per un fattore dell'ora): segue l'ora del gioco minuto
per minuto, con la curva per ora e per giorno della build.

## 7. Verifica sul GTFS

`python3 scripts/gtfs_tempi.py` legge il feed fissato (`data/gtfs-biv.zip`, giorno feriale dell'11 novembre 2026) e dà,
per linea e schema di fermate, il tempo mediano dalla prima alla penultima fermata per l'ora di partenza, in quattro
fasce: 7-9, 10-12, 17-19 e 20-23 (l'ultima fermata ha dentro la sosta al capolinea).

Esito: sì, il GTFS di Busitalia ha tempi diversi tra punta e morbida, ma non su tutte le linee. Su 61 schemi con corse
in tutte e quattro le fasce, 15 hanno lo stesso tempo a tutte le ore (il SIR1, la 13, la 24, parte della 5, della 10 e
della 3). Gli altri sono più lenti tra le 7 e le 9, soprattutto verso il centro, meno tra le 17 e le 19, e più veloci
dopo le 20:

| Linea, verso il centro | 7-9 | 10-12 | 17-19 | 20-23 (minuti) |
|---|---|---|---|---|
| E005Z Piove di Sacco - Padova (Via Facciolati) | 58,4 | 36,1 | 41,2 | 36,1 |
| E073 Noventa - Padova (Via Venezia, Via Ariosto) | 43,6 | 29,5 | 34,1 | 29,5 |
| U07 Saonara - Stazione (Corso Stati Uniti, Via Morgagni) | 41,2 | 34,5 | 35,8 | 30,4 |
| U12 Tencarola - Stazione (Via Sorio, Prato della Valle) | 34,0 | 26,0 | 26,0 | 24,0 |
| U16 Rio - Stazione (Via Piovese, Via Facciolati) | 35,0 | 30,0 | 31,0 | 26,5 |
| U09 Mortise - Caduti della Resistenza (Via Beato Pellegrino) | 47,7 | 38,6 | 47,7 | 38,6 |

Sui tratti dei corridoi della prova (fermata per fermata):

| Corridoio | Linea | 7-9 | 10-12 | 17-19 | 20-23 (minuti) | mattino, sera sulle 11 |
|---|---|---|---|---|---|---|
| Via Sorio, verso il centro | U12 | 3,0 | 2,1 | 2,2 | 2,1 | +43%, +7% |
| Via Facciolati, verso il centro | U16 | 3,6 | 3,1 | 3,1 | 2,5 | +14%, +0% |
| Via Facciolati, verso il centro | E005Z | 4,5 | 2,3 | 2,8 | 2,3 | +91%, +22% |
| Via Ariosto e Via Gattamelata, verso il centro | E073 | 3,8 | 2,7 | 3,4 | 2,7 | +40%, +24% |

Sono tempi d'orario, non misurati: dicono dove l'azienda mette più tempo nelle ore di punta, cioè dove la congestione
c'è da anni, e la forma della curva (punta del mattino più forte di quella della sera, sera più veloce del giorno). Non
danno flussi: per le quantità restano le stime della sezione 4.

## 8. La prova

`tests/domanda.spec.js` (regole in `tests/domanda.js`). Tutte e due sono misure aggregate con un margine, non elenchi
di casi: gli intrecci esatti di qualche minuto di traffico cambiano tra il Mac e Linux e a ogni piccolo cambiamento
(#145).

- Viaggi e ore: alle 8:15 ogni auto ha un viaggio con origine, destinazione e arrivo; un ritardo misurato sul movimento
  migliore di un'auto le fa prendere un'altra strada; con i tempi della punta del mattino il percorso da Voltabarozzo a
  Pontecorvo costa più del 10% che con quelli delle 11 (264,7 s contro 222,6); portando l'orologio alle 22:30, senza
  ripartire, il disco si allarga di più di una volta e mezza (da 306 a 1.028 m: #60).
- Punte: sui tre corridoi della tabella sopra, alle 8, alle 11, alle 18 e alle 22 di un feriale (corsa della 10,
  poi l'orologio all'ora), chi guida a 900 m e il disco fermo a metà del corridoio, 60 s di riscaldamento e tre
  auto sonda per verso, una ogni 15 s, con un viaggio fino all'altro capo (almeno due arrivate per verso). Per ogni corridoio e ora di punta il
  rapporto tra il tempo medio e quello della morbida più lenta (11 o 22) nel verso che la sente di più; la media dei
  tre corridoi deve superare 1,08 alle 8 e alle 18.

Tempi medi delle auto sonda sul Mac, 18 novembre (tre per verso; verso il centro, poi verso fuori):

| Corridoio | 8 | 11 | 18 | 22 | punta delle 8 | delle 18 |
|---|---|---|---|---|---|---|
| Via Sorio (940 m) | 71 e 105 s | 70 e 105 | 70 e 110 | 69 e 103 | 1,02 | 1,04 |
| Via Facciolati (990 m) | 178 e 90 | 119 e 95 | 93 e 162 | 100 e 104 | 1,50 | 1,55 |
| Via Ariosto e Via Gattamelata (1.350 m) | 271 e 148 | 214 e 146 | 337 e 146 | 127 e 147 | 1,27 | 1,58 |
| media | | | | | 1,26 | 1,39 |

In CI la prova con quattro sonde e una ogni 20 s durava 14,7 minuti (serie 44299398661), la più lunga della serie; con
tre ogni 15 s in locale dura 4,2 minuti invece di 5,8-7,0. Con 45 s di riscaldamento invece di 60 le code non fanno in
tempo a formarsi e la punta delle 8 scendeva a 1,13.

Da un lancio all'altro, con piccoli cambiamenti del traffico, il rapporto di un corridoio si sposta anche di 0,2 (Via
Gattamelata alle 8 è stata 1,19, 1,02 e 1,27); la media dei tre molto meno.

Via Facciolati ha la punta dove la ha il GTFS: la mattina verso il centro, la sera verso fuori; Via Gattamelata la sera
verso il centro, come la E073, e la mattina meno (da 1,02 a 1,27 secondo il lancio). Via Sorio no: nella build il tratto
tra Via Col Berretta e Piazzale San Giovanni porta 90-290 auto l'ora per verso alle 8, lontano dalla capacità. Sta a 170
m dal bordo della mappa, e chi arriva da Tencarola, Selvazzano e Rubano entra dalla porta di Via Sorio, pesata come una
secondaria (0,35 contro 1 di una trunk), o da Corso Australia e Via Chiesanuova (che alle 8 sono le più cariche della
mappa). Il GTFS dice +43% alle 8 sulla U12: è il primo posto da guardare per tarare le porte (#147).

## 9. Costo per passo

Misura sul Mac (Chromium headless, SwiftShader, macchina carica), stessa corsa e stesso percorso per le due build: la
3 delle 8:15, poi 200 s in ognuna delle tre zone della prova del moto (centro, stazione, sud-est, con il teletrasporto
tra una e l'altra), 18.000 passi da 1/30 s, due lanci per build.

| | `main` (4ecf9be) | con la domanda |
|---|---|---|
| `traffic.update` per passo, media | 0,78-0,82 ms con 72 auto | 1,10-1,11 ms con 61 auto |
| 99° percentile | 1,7-2,0 ms | 2,0 ms |
| passi oltre 4 ms / oltre 8 ms | 9-13 / 4-5 | 7-16 / 4-6 |
| passo più lungo (al teletrasporto) | 37-53 ms | 50-62 ms |
| `buses.update` per passo | 0,36-0,38 ms | 0,32-0,33 ms |
| partenza della corsa (`startMission` e aree) | 470 ms (1.570 il primo lancio) | 530-710 ms |

Il costo per auto cresce di circa due terzi: la scelta della svolta guarda l'albero e i ritardi, la nascita traccia il
percorso del viaggio. Gli alberi non danno scatti: si calcolano 4.000 stati per passo (in Node un albero intero, 37.000
stati raggiungibili, costa 2-8 ms; a pezzi meno di 1 ms per passo), e alla partenza della corsa quelli che servono si
calcolano tutti insieme (circa 45 alberi, 120 ms dei 530-710). Il raggio del disco e i pesi dei viaggi (`aggiorna`) si
rifanno quando cambia il minuto di gioco o chi guida si sposta di 150 m: 0,5-2 ms. I passi oltre 8 ms sono quelli del
teletrasporto, come su `main`. Il bundle cresce di 534 KB (il file della domanda, 150 KB compresso).

## 10. Cosa resta fuori

- Il traffico di tutta la città (#117): fuori dal disco attorno a chi guida le code non ci sono, ci sono solo i tempi
  della fascia della build. Arrivando in un corridoio nell'ora di punta la coda si forma mentre il disco ci arriva (60-
  90 s prima di chi guida), non c'è già; i bus automatici non prendono ritardo dai tempi della fascia.
- Le auto non parcheggiano: arrivate, lontano da chi guida escono di scena; le auto in sosta di #111 seguono la loro
  quota per ora, non i viaggi.
- I numeri di partenza sono stime (sezione 4) e le porte hanno pesi per classe: niente conteggi aperti per Padova. Il
  GTFS dice dove la punta c'è (sezione 7); Via Sorio è il primo caso dove il modello non la dà.
- La domanda non è locale come la pianta (#139): l'assegnazione è un equilibrio, e un arco cambiato può spostare i flussi
  della fascia anche lontano. Per questo il file non è nella prova di località; si rifà con la mappa
  (`rigenera_mappa.sh`), e la CI controlla che sia quello che esce dalla mappa di oggi.
- Con la densità vera attorno a chi guida si vedono di più le code che restano dentro gli incroci quando il rosso
  ferma la fila (Via Gozzi, Via Tommaseo, Via Piovese, nella prova dei dieci minuti di `tests/code.spec.js`): le auto
  entrano quando la fila davanti si muove e si fermano lì quando si ferma (#148: otto casi in `data/eccezioni/code.json`).
