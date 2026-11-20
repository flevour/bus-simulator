# Domanda di traffico (#116)

Fino al 17 novembre 2026 le auto nascevano a caso attorno a chi guida e sceglievano a caso a ogni incrocio, con un
numero fissato alla partenza della corsa. Ora ogni auto fa un viaggio: parte da un luogo, va verso un altro, e il
numero di viaggi segue l'ora del giorno. La build prepara i dati della domanda (zone, pesi, porte, tempi, curva oraria)
in un file con un solo proprietario, `src/data/padova-domanda.json` (`scripts/domanda.py`); il gioco li legge
(`src/world/domanda.js`) e decide quali viaggi passano attorno a chi guida, senza simulare tutta la città.

Numeri del 17 novembre 2026, sulla mappa di `main`. Si ristampano con `python3 scripts/domanda.py --conti`.

## 1. Il file della domanda

`python3 scripts/domanda.py` lo riscrive dalla rete della mappa (`src/data/padova-map.json`), dagli edifici delle aree
(`public/mappa/aree/`), dai luoghi di OSM (`data/osm-luoghi.json`, #108) e, per chi entra dalle porte, dai pendolari
ISTAT, dai comuni e dalle strade fuori dalla mappa (sezione 3, #147). Solo libreria standard e solo somme,
prodotti, divisioni e radici: niente seni o esponenziali della libreria del sistema, quindi il file è lo stesso sul Mac
e in Docker. `--controlla` lo rifà e dice se è quello del repository (lo lancia anche `scripts/verifica_mappa.py`, cioè
la CI); chi cambia la rete o gli edifici lo riscrive nello stesso commit della mappa, e `scripts/rigenera_mappa.sh` lo
rifà alla fine.

| Campo | Cosa |
|---|---|
| `cella` | lato delle zone (1.000 m) |
| `costo` | modello di costo dei tempi, lo stesso nel gioco: velocità libera (14 m/s sulle strade principali fuori dal centro, 9 m/s altrove, come le auto del gioco), attesa media a un semaforo (10 s), svolta a sinistra (5 s) e a destra (2 s) |
| `zone` | `[x, z, abitanti, addetti, scuole, negozi, sosta, centro, accessi]`; `accessi` è una lista piatta di `stato, peso, tipo` |
| `porte` | `[nome, x, z, peso, stati d'ingresso, stati d'uscita]`; il peso sono i pendolari che ci passano in un giorno feriale, entrando e uscendo (il gioco non lo usa) |
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
taglia una strada che continua fuori. Le carreggiate della stessa via entro 150 m sono una porta sola. Sono 61 (53
d'ingresso, 51 d'uscita). Comprese le carreggiate a senso unico che finiscono al bordo (Corso Australia, Corso Boston,
Corso Esperanto, Via Boves): da #90 erano pozzi dove le auto non entravano più, ora sono le uscite di chi va fuori città.

Chi entra da una porta viene da un comune di fuori (`scripts/pendolari.py`, #147). Fino al 19 novembre le porte avevano
un peso per classe della strada (trunk 1, primary 0,6, secondary 0,35, tertiary 0,15) e i pendolari erano 60.000
stimati: ora numeri e porte vengono da tre fonti.

| Dato | Fonte | File |
|---|---|---|
| pendolari in auto come conducenti, per lavoro e per studio, da comune a comune, per orario di uscita da casa | ISTAT, matrice del pendolarismo 2011 (15° Censimento generale della popolazione, 9 ottobre 2011), licenza CC BY 4.0 | `data/istat-pendolari.json` (`scripts/istat_pendolari.py` dallo zip ISTAT) |
| comuni attorno a Padova: codice ISTAT e centro abitato (nodo `admin_centre` del confine) | OpenStreetMap (ODbL) | `data/osm-comuni.json` (`scripts/overpass-comuni.ql`, `scripts/filter_osm_fuori.py`) |
| strade da tertiary in su entro 20 km da Padova, con le rampe e i sensi unici | OpenStreetMap (ODbL) | `data/osm-strade-fuori.json` (`scripts/overpass-strade-fuori.ql`, `scripts/filter_osm_fuori.py`) |

La matrice del 2011 è la più recente con il mezzo di trasporto e l'orario: quella del 2021 (censimento permanente, per
lavoro e per studio) viene da fonti amministrative e dà solo quante persone vanno da un comune all'altro. Si scarica
da https://www.istat.it/storage/cartografia/matrici_pendolarismo/matrici_pendolarismo_2011.zip (36 MB), comandi nel
README.

Il conto:

- dentro la mappa stanno i comuni col centro abitato in un'area della mappa: oggi Padova, Albignasego, Cadoneghe,
  Ponte San Nicolò e Rubano. I loro abitanti sono già nelle zone (sezione 2), e tra loro i 11.400 pendolari dell'ISTAT
  sono viaggi tra zone;
- dai comuni di fuori verso questi vanno in auto 48.400 conducenti al giorno (Padova da sola ne riceve 50.100 da tutta
  Italia, 99.000 pendolari con tutti i mezzi dalle cinque province attorno). Sono `pendolari_in`, e la sera
  `pendolari_out`;
- la rete di fuori sono le vie di OSM senza i tratti che la mappa ha già (tra due nodi della mappa con un arco tra loro),
  a velocità libera per classe: 110 km/h le autostrade, 80 le superstrade, 60 le primary, 50 le secondary, 45 le
  tertiary, le rampe al 70%. Una porta è un nodo della mappa, e la via di fuori che la continua passa dallo stesso nodo:
  tutte le porte tranne una carreggiata di Corso Argentina hanno la loro via di fuori;
- dal centro abitato di un comune al nodo della rete più vicino: la linea d'aria per 1,3, a 8 m/s per i primi 1.500 m
  e a 20 m/s oltre (i comuni oltre i 20 km delle strade);
- per ogni comune di fuori e zona, la porta col tempo minore: la rete di fuori fino alla porta, poi la matrice dei tempi
  della mappa (sezione 1). Le zone di destinazione pesano gli addetti per la deterrenza del viaggio intero (`T0` dei
  pendolari, sezione 4); la sera si esce dalla porta col tempo minore verso il comune. Da casa alla porta ci vogliono in
  media 15 minuti.

Pendolari al giorno per comune e porta: `python3 scripts/domanda.py --conti`. Qualche esempio: Selvazzano Dentro 2.680
(Via Sorio 40%, Via Don Bosco 27%, Corso Boston 14%), Vigonza 2.720 (Via del Commercio 89%), Abano Terme 1.520 (Corso
Boston 35%, Via Don Bosco 26%, Corso Australia 23%), Noventa Padovana 1.670 (Via Valmarana 73%). Le porte più usate:
Corso Argentina 10.500 al giorno tra entrate e uscite, Piazzale Castagnara 10.300, Via Valmarana 9.100, Via Vigonovese
8.100, Tangenziale Limena 6.500, Via Roma (Albignasego) 5.200; Via Sorio 2.700 (con i pesi per classe ne entravano 970,
ora 1.330). Ventiquattro porte non le prende nessun pendolare: per tutti i comuni di fuori una porta vicina è più veloce.

Chi attraversa la città da porta a porta (25.000 al giorno, una stima: la matrice conta solo chi va al lavoro o a
scuola) entra ed esce dalle porte in proporzione ai pendolari che ci passano, con la stessa deterrenza di prima.

## 4. Viaggi al giorno e curva oraria

| Scopo | Da dove a dove | Feriale | Festivo |
|---|---|---|---|
| casa_lavoro, lavoro_casa | abitanti verso addetti e ritorno, 17% dei viaggi dei residenti ciascuno | 62.500 + 62.500 | 12.500 + 12.500 |
| casa_scuola, scuola_casa | abitanti verso scuole e ritorno, 6% ciascuno | 22.000 + 22.000 | 0 |
| altro | tra zone (spesa, servizi, visite), 54% | 199.000 | 258.000 |
| pendolari_in, pendolari_out | dai comuni di fuori, per una porta, agli addetti la mattina, ritorno la sera (ISTAT 2011, sezione 3) | 48.400 + 48.400 | 7.300 + 7.300 |
| attraverso | da porta a porta, tra porte ad almeno 3 km | 25.000 | 15.000 |
| in tutto | | 490.000 | 313.000 |

I viaggi dei residenti sono 1,1 per abitante al giorno: 2,3 spostamenti, il 60% in auto, 1,25 persone per auto (ISFORT,
Audimob, valori di un capoluogo del nord). I pendolari da fuori sono quelli della matrice ISTAT (sezione 3). Non
risultano conteggi di traffico aperti per Padova: gli altri totali sono stime, la forma della curva è quella tipica delle
città italiane, e le punte sono quelle che il GTFS conferma (sezione 7).

Per `pendolari_in` la curva prende dalla matrice anche l'orario: il 34% esce di casa prima delle 7:15, il 45% dalle 7:15
alle 8:14, il 12% dalle 8:15 alle 9:14 e l'8% dopo. Le fasce si spostano dei 15 minuti medi da casa alla porta, e dentro
ogni fascia resta la forma della curva tipica (`ore_istat` in `scripts/domanda.py`): tra le 7 e le 8 entra il 41% dei
pendolari (prima il 30%), tra le 8 e le 9 il 28% (22%), alle 11 l'1% (3%).

La destinazione segue un modello gravitazionale: la probabilità di andare da `o` a `d` è proporzionale
all'attrattività di `d` (addetti, scuole, abitanti, o per gli altri viaggi negozi, addetti e sosta) per
`1 / (1 + t / T0)³`, con `t` il tempo a rete libera e `T0` 600 s per il lavoro, 300 per la scuola, 420 per gli altri,
900 per i pendolari, 1.200 per chi attraversa. Si tengono le destinazioni più probabili fino al 98%.

Viaggi che partono in un'ora, feriale (tutti gli scopi): 54.000 tra le 7 e le 8, 52.000 tra le 8 e le 9, 22.000 alle
11, 30.000 alle 12 e alle 13, 47.000 alle 17 e 46.000 alle 18, 5.600 alle 22. Festivo: punte di 26.000 alle 11 e
28.000 alle 17-18.

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
`i, j`. Alle 8 gli stati sopra 1,1 sono 879 (82 oltre il doppio): Via Chiesanuova, Via Facciolati e Via Piovese
verso il centro, Ponte Voltabarozzo, Piazzale San Giovanni, Via Fabrici d'Acquapendente, Ponte Scaricatore; alle 11
135; alle 17 767. Auto presenti in tutta la mappa: 7.200 alle 8, 2.700 alle 11, 6.000 alle 17. Con i pesi delle porte
per classe e 60.000 pendolari stimati (fino al 19 novembre) erano 1.103 (166), 181 e 1.043 stati, e 8.700, 3.100 e
7.600 auto. L'assegnazione costa
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

E non dicono il punto preciso (#147): l'orario allunga blocchi interi di fermate dello stesso fattore. La U12 ha alle
7-9 il 42-44% in più su ogni tratto tra due fermate da Tencarola a Via Cavalletto, la E080 il 60% su tutto il tratto in
città, la E005Z il 92% e la E003B il 48% su quello urbano e niente fuori; la U06, sullo stesso tratto di Via Sorio della
U12, ha lo stesso tempo a tutte le ore. Il +43% di Via Sorio è quello di tutto il viaggio della U12 verso il centro.

## 8. La prova

`tests/domanda.spec.js` (regole in `tests/domanda.js`). Tutte e due sono misure aggregate con un margine, non elenchi
di casi: gli intrecci esatti di qualche minuto di traffico cambiano tra il Mac e Linux e a ogni piccolo cambiamento
(#145).

- Viaggi e ore: alle 8:15 ogni auto ha un viaggio con origine, destinazione e arrivo; un ritardo misurato sul movimento
  migliore di un'auto le fa prendere un'altra strada; con i tempi della punta del mattino il percorso da Voltabarozzo a
  Pontecorvo costa più del 10% che con quelli delle 11 (264,7 s contro 222,6); portando l'orologio alle 22:30, senza
  ripartire, il disco si allarga di più di una volta e mezza (da 306 a 1.028 m: #60).
- Punta del mattino su tutte le porte (`python3 scripts/gtfs_tempi.py --porte`, anche in `scripts/verifica_mappa.py`,
  cioè nel lavoro mappa della CI; #147): per ogni porta d'ingresso il percorso più veloce a rete libera fino al centro,
  e su questo ogni linea del GTFS che ci passa, dalla prima fermata entro 3 km dalla porta all'ultima di fila sul
  percorso entro 4 km (almeno 600 m, almeno 90 s alle 10-12, almeno tre corse alle 7-9 e alle 10-12). Il rapporto del
  GTFS è tra le mediane delle corse alle 7-9 e alle 10-12; quello del gioco tra i tempi della fascia della domanda alle 8
  e alle 11 sullo stesso tratto (tempo a rete libera per il fattore, più svolte e semafori). Dove il GTFS ha almeno il
  20% in più e la domanda meno del 10% è un caso, contro l'elenco `data/eccezioni/punte.json`. Il 20 novembre: 55 tratti
  per 36 porte su 53; 15 casi (con i pesi per classe erano 11): la U12 in Via Sorio, la E080 verso Chiesanuova, la E073
  dalla zona industriale, la E013V, la U10 da Ponte di Brenta, la U03 in Via Bembo, la U06 in Via delle Cave (#159). È
  una prova sulla build e non nel gioco: sonde nel gioco su 55 tratti costerebbero ore. Nel gioco la domanda della
  fascia guida la scelta della strada e quante auto stanno attorno a chi guida, e dove la build è lontana dalla
  capacità nemmeno il gioco fa code (Via Sorio).
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

Con i pendolari ISTAT per porta (#147), sul Mac il 20 novembre, sulla mappa di #142 (verso il centro, poi verso fuori):

| Corridoio | 8 | 11 | 18 | 22 | punta delle 8 | delle 18 |
|---|---|---|---|---|---|---|
| Via Sorio | 75 e 114 s | 70 e 109 | 68 e 114 | 69 e 100 | 1,08 | 1,05 |
| Via Facciolati | 177 e 95 | 97 e 103 | 113 e 91 | 95 e 91 | 1,83 | 1,17 |
| Via Ariosto e Via Gattamelata | 257 e 148 | 243 e 147 | 387 e 147 | 125 e 160 | 1,06 | 1,59 |
| media | | | | | 1,32 | 1,27 |

Un lancio prima, sulla mappa di #148, la media era 1,38 e 1,18 (Via Sorio 1,03 alle 8, Via Facciolati 1,93 e 1,02,
Via Gattamelata 1,18 e 1,49). La sera Via Facciolati verso fuori sente meno la punta: dalla porta di Corso Esperanto
escono 1.500 pendolari al giorno, con il peso di una trunk ne uscivano 3.200. Via Sorio resta sotto 1,1 anche con 1.330
pendolari al giorno dalla sua porta invece di 970 (#159).

Fino al 19 novembre Via Facciolati aveva la punta la mattina verso il centro e la sera verso fuori, Via Gattamelata la
sera verso il centro e la mattina meno, Via Sorio no: nella build il tratto tra Via Col Berretta e Piazzale San Giovanni
portava 90-290 auto l'ora per verso alle 8, con la porta di Via Sorio pesata come una secondaria (0,35 contro 1 di una
trunk). Con i pendolari ISTAT (#147) ne porta 450 contro 720 al semaforo, e il +43% della U12 è quello di tutto il suo
viaggio verso il centro (sezione 7).

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
- I numeri di partenza dei residenti sono stime (sezione 4): niente conteggi aperti per Padova. Da fuori ci sono solo i
  pendolari della matrice ISTAT del 2011, per lavoro e per studio: mancano i viaggi da fuori per altri motivi (servizi,
  ospedali, università, acquisti) e quello che è cambiato dal 2011, e chi parte da Padova per lavorare fuori. Il GTFS
  dice dove il viaggio è più lento (sezione 7): i 15 tratti dove la domanda non ha la punta sono in
  `data/eccezioni/punte.json`, con Via Sorio (#159).
- La domanda non è locale come la pianta (#139): l'assegnazione è un equilibrio, e un arco cambiato può spostare i flussi
  della fascia anche lontano. Per questo il file non è nella prova di località; si rifà con la mappa
  (`rigenera_mappa.sh`), e la CI controlla che sia quello che esce dalla mappa di oggi.
- Con la densità vera attorno a chi guida si vedono di più le code che restano dentro gli incroci quando il rosso
  ferma la fila (Via Gozzi, Via Tommaseo, Via Piovese, nella prova dei dieci minuti di `tests/code.spec.js`): le auto
  entrano quando la fila davanti si muove e si fermano lì quando si ferma (#148: otto casi in `data/eccezioni/code.json`).
