# Raccordi di corsia agli incroci (#112)

A ogni nodo della rete la build scrive da quale corsia a quale corsia si passa, con quale curva, con quale raggio e
quali mezzi ci passano. Dove non c'è un raccordo non si passa. Li calcola `scripts/raccordi.py`, che `build_map.py`
chiama dopo la pianta delle strade; stanno nel campo `raccordi` della rete (`src/data/padova-map.json`). Il gioco li
porta in `net.raccordi` e ancora non li segue: lo farà #113, e #114 li userà per controllare i percorsi delle linee.

Numeri del 16 novembre 2026, sulla mappa di `main`. Si ristampano con `python3 scripts/raccordi.py`.

## 1. Corsie

Le corsie sono quelle che il gioco disegna: `laneLayout` di `src/data/padova.js`, rifatta in Python in
`corsie_arco` con gli stessi conti. Una corsia di marcia è (arco, verso, posto): il posto si conta da sinistra a
destra di chi va, da 0. Dove in un verso percorribile `laneLayout` non ha corsie c'è una corsia sola, dove oggi
passano i mezzi: a un quarto della carreggiata sui doppi sensi stretti senza mezzeria, in asse sul controsenso dei
bus (`busBoth`) sotto gli 8 m di carreggiata.

`tests/raccordi.spec.js` legge il campo nel gioco e controlla che ogni raccordo cominci e finisca sull'asse di una
corsia di `laneLayout`, entro 3 cm: chi cambia una delle due regole senza l'altra lo vede lì.

Dove gli stalli della sosta stringono la carreggiata (#111, [`sosta.md`](sosta.md)) le corsie stanno tra i bordi di
`sedeCorsie`, che `corsie_arco` e `laneLayout` leggono allo stesso modo: la build calcola la sosta prima dei raccordi.

Chi può percorrere una corsia: le auto non entrano nelle vie pedonali, nelle corsie riservate (`psv`) e nelle corsie
dei bus, e non vanno contromano; i bus vanno anche in controsenso dove la via lo ammette.

## 2. Classi di mezzo

| Classe | Bit | Raggio minimo | Da dove viene |
|---|---|---|---|
| `auto` | 1 | 3,8 m | diametro di volta tra marciapiedi di 10,5 m, passo 2,6 m, carreggiata 1,5 m |
| `bus12` | 2 | 8,3 m | il bus del gioco (`src/bus/bus.js`): passo 5,9 m, sterzo massimo 0,62 rad, 5,9 / tan 0,62 = 8,26 m |
| `snodato` | 4 | 8,5 m | la stessa motrice; lo snodo a regime non supera 0,87 rad (`ART.maxAngle`) da 8,4 m in su |

Il raggio è quello della curva che il mezzo segue con il centro dell'asse posteriore, con la direzione tangente alla
curva. Con questo riferimento il muso di un bus da 12 m esce dalla curva verso l'esterno (fino a 2,3 m oltre il
cordolo della sua corsia: `BUS_TURN_KERB` in `scripts/street_surfaces.py`), e la parte interna della sagoma sta a
metà larghezza dalla curva: 0,9 m per le auto, 1,275 m per i bus. È lo spazio che la curva deve avere dal bordo
dell'asfalto.

## 3. Come nasce un raccordo

1. Movimenti del nodo. Da ogni arco che arriva a ogni arco che parte, se un mezzo può percorrerli tutti e due e la
   svolta non è vietata. Dal campo `svolte` (docs/osm-dati.md): una svolta vietata toglie quel movimento, una
   obbligata toglie tutti gli altri dallo stesso arco; con l'eccezione per i bus restano i soli bus. Le tre svolte
   che passano da una via non si applicano. Non ci sono inversioni sullo stesso arco.
2. Corsie. L'uscita più allineata, entro 45 gradi, è "diritto"; le altre sono a sinistra o a destra. Senza frecce a
   terra si va diritto da ogni corsia sulla corsia allineata da destra, a sinistra dalla corsia più a sinistra verso
   la più a sinistra, a destra dalla più a destra verso la più a destra; con le frecce (`turnLanes`) ogni corsia fa
   quello che dice la sua freccia. Le corsie in più a sinistra si prendono dalla più a sinistra, la corsia dei bus
   che comincia dalla più a destra. Una corsia che resterebbe senza uscite le prende tutte.
3. Spazio lungo la corsia. Un raccordo che arriva su una corsia e uno che ne parte non si sovrappongono: i due capi
   della corsia si dividono la lunghezza dell'arco. A ogni capo va prima quanto serve al raggio minimo di chi ci
   passa (lo snodato sui percorsi delle linee), il resto a metà; se non ci stanno tutti e due, il capo che chiede
   meno ha il suo.
4. Curva. Un arco di cerchio tangente alle due corsie, con il raggio più grande che sta nello spazio e sull'asfalto,
   fino a 15 m per una svolta e a 200 m per una curva appena accennata. Dove le due corsie sono quasi parallele e non
   si incontrano (la carreggiata cambia larghezza) la curva è una esse, con due vertici. Se la curva non basta ai
   mezzi che devono passare si prova la svolta larga: si va oltre lo spigolo e si rientra sulla corsia d'uscita più
   avanti, o ci si allarga prima.
5. Archi corti. Se a un movimento manca il posto perché un arco è corto (un pezzo di rotonda di 2 m, due incroci a
   5 m), il raccordo si allunga: parte dalla corsia prima dell'arco corto o arriva su quella dopo, e l'arco corto lo
   scavalca (fino a 4 archi e 24 m). Si fa per le auto dove il raccordo diretto non ha il raggio minimo, e per i bus
   sui percorsi delle linee dove il raccordo diretto basta solo alle auto. Un raccordo che finisce su una corsia da
   cui poi non si esce, se non con un raccordo che l'ha già scavalcata, perde i mezzi che ci resterebbero fermi.
6. Prova contro la pianta. Ogni curva, con i vertici al centimetro e il raggio al decimetro come sono scritti, deve
   stare sull'asfalto della mappa (carreggiate a terra e in quota; isole, marciapiedi e banchine non lo sono) a metà
   sagoma dal bordo, o quanto le corsie che unisce se quelle stanno più vicine. Non entra nella sede del tram (i
   binari allargati di 2,1 m) dove nessuna delle due vie la tocca: dove una la tocca è un incrocio col tram, o una
   via che porta i binari.

Sul percorso di una linea lo stesso movimento può avere due raccordi dalla stessa corsia alla stessa corsia: quello
delle auto e uno più largo per i bus.

## 4. Formato del campo

```json
"raccordi": {
  "classi": ["auto", "bus12", "snodato"],
  "raggi": [3.8, 8.3, 8.5],
  "nodi": [0, 1, 2, ...],
  "voci": [[...], [...], ...]
}
```

`nodi` sono i nodi che hanno almeno un raccordo, in ordine; `voci[i]` sono i raccordi che cominciano al nodo
`nodi[i]`, uno dopo l'altro in una lista piatta di interi. Un raccordo è:

```
da, a, codice, raggio, x1, z1 [, x2, z2] [, via1, via2, ...]
```

- `da`: l'arco da cui si arriva al nodo (indice nella mappa, come in `svolte`). Il verso si legge da quale capo
  dell'arco è il nodo.
- `a`: l'arco su cui si esce. Parte dal nodo, o dal nodo dove finisce l'ultimo arco scavalcato.
- `codice`: `corsia_da | corsia_a << 3 | classi << 6 | (vertici - 1) << 9 | scavalcati << 10`. Le corsie sono posti
  da sinistra (sezione 1), `classi` la somma dei bit dei mezzi che ci passano, `vertici` 1 o 2, `scavalcati` quanti
  archi seguono in fondo.
- `raggio`: in decimetri, arrotondato per difetto. È il raggio di tutti gli archi della curva, quindi il minimo. Zero
  vuol dire che le due corsie sono allineate: il raccordo è il punto del vertice, senza curva.
- `x, z`: i vertici, in centimetri dal nodo `nodi[i]`.
- `via`: gli archi corti scavalcati, nell'ordine in cui si percorrono.

La curva si ricostruisce così. La direzione d'arrivo è quella dell'arco `da` verso il nodo, quella d'uscita è
dell'arco `a` che si allontana dal suo nodo. La spezzata arriva lungo la direzione d'arrivo, passa per i vertici ed
esce lungo quella d'uscita; a ogni vertice c'è un arco di cerchio di raggio `raggio` tangente ai due lati, che
comincia e finisce a `raggio × tan(angolo / 2)` dal vertice. La curva comincia sull'asse della corsia `corsia_da` e
finisce su quello della corsia `corsia_a`. Tra un raccordo e il successivo il mezzo va diritto sulla corsia, dalla
fine dell'uno all'inizio dell'altro. `campiona` e `decodifica` di `scripts/raccordi.py` e la funzione `leggi` di
`tests/raccordi.spec.js` lo fanno in Python e in JavaScript.

Gli indici degli archi sono quelli della mappa. Valgono per `net.edges` finché `buildNetwork` non salta archi (oggi
non ce ne sono sotto 0,3 m); se ne salta, `net.raccordi` è `null`.

## 5. Controlli

`python3 scripts/raccordi.py` (anche da `scripts/verifica_mappa.py`, quindi in CI) rilegge il campo scritto nella
mappa e lo controlla raccordo per raccordo, con i casi noti in `data/eccezioni/raccordi.json`:

| Controllo | Cosa guarda |
|---|---|
| `raccordi_rotti` | archi o corsie che non esistono, curva che non si chiude, raggio sotto il minimo di un mezzo ammesso, mezzo che non può percorrere una delle corsie, svolta vietata |
| `raccordi_fuori_corsia` | la curva non comincia o non finisce sull'asse della sua corsia |
| `raccordi_fuori_asfalto` | la curva esce dall'asfalto o ci sta più stretta delle corsie che unisce; la corsia stessa è fuori dall'asfalto |
| `raccordi_nella_sede` | la curva entra nella sede del tram dove le due vie non la toccano |
| `raccordi_sovrapposti` | su una corsia un raccordo che arriva finisce oltre il punto da cui ne parte un altro |
| `auto_senza_uscita` | corsie da cui un'auto non esce, per le curve, per le corsie o per le svolte vietate |
| `bus_senza_raccordo` | svolte dei percorsi delle linee senza un raccordo per il loro mezzo (snodato per la 10) |

`--elenco` stampa i casi, `--aggiorna` riscrive l'elenco, `--scrivi` ricalcola il campo nella mappa che c'è. Il campo
pubblicato è quello che esce da `scripts/rigenera_mappa.sh`: su macOS le curve al limite escono diverse, come la
pianta delle strade.

Chi cambia `svolte` (`python3 scripts/osm_rete.py --scrivi`), le corsie, le larghezze o la pianta delle strade
rigenera la mappa: i raccordi cambiano con loro.

## 6. Rapporto (16 novembre 2026)

68.149 raccordi su 23.413 nodi; 4.310 scavalcano almeno un arco corto. Ci passano le auto in 65.378, il bus da 12 m in
50.242, lo snodato in 49.617. Dei 66.061 movimenti da corsia a corsia, 64.157 hanno il raccordo diretto, a 1.852 manca
il posto per il raggio minimo (arco corto: molti li copre un raccordo che lo scavalca), 52 non stanno sull'asfalto.

Il campo pesa 2.082.610 byte: `src/data/padova-map.json` passa da 9.855.305 a 11.937.927 byte (21,1% in più), compressa
da 3,59 a 4,27 MB (689 KB in più). Quasi tutto il peso sono i due indici d'arco di ogni raccordo.

Corsie da cui un'auto non esce: 3.664.

| Perché | Corsie | Nell'elenco dei casi |
|---|---|---|
| fine: strada chiusa o bordo della mappa | 3.328 | no |
| accesso: davanti solo vie pedonali, riservate o contromano | 77 | no |
| curva: nessuna svolta ammessa ha una curva da auto (gomiti oltre 120 gradi, tronchi ciechi di pochi metri, archi corti in fila) | 252 | sì |
| corsia: l'uscita ha nel verso giusto solo corsie dei bus | 6 | sì |
| divieto: le svolte di OSM non lasciano uscite | 1 | sì |

Svolte dei percorsi delle linee senza un raccordo per il loro mezzo: 215 su 7.187.

| Perché | Svolte | Di chi è |
|---|---|---|
| solo auto: il raccordo c'è, con il raggio sotto quello del bus | 126 | #134 |
| senza curva: nessuna curva, nemmeno per le auto | 18 | #134 |
| svolta non ammessa: contromano o vietata anche ai bus | 66 | #114 |
| inversione sullo stesso arco | 5 | #114 |

Raccordi con la corsia fuori dall'asfalto della pianta: 99 nodi (#133). Gli altri controlli della sezione 5 sono a zero.
