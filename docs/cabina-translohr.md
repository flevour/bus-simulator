# Cabina del Translohr: comandi e procedure

Ricerca del 12 novembre 2026 per rifare nel gioco la cabina del tram e i suoi comandi. Ogni affermazione porta la sua
fonte (elenco in fondo). Le parole **confermato** e **inferenza** distinguono due casi:

* **confermato**: lo scrive una fonte, oppure si vede chiaramente in una foto con didascalia;
* **inferenza**: è una mia deduzione, da una foto o per analogia con un'altra rete Translohr. Va verificata.

Quasi tutto il materiale scritto sulla cabina viene da Clermont-Ferrand (Translohr STE4 del 2006): lì, dal 2004, un
gruppo di ergonomi (Robin Foot e Ghislaine Doniol-Shaw, LATTS) ha studiato il posto di guida per il sindacato e poi
lo ha rifatto con il costruttore. Per Padova non ho trovato manuali, regolamenti di esercizio o descrizioni della
cabina: per Padova ci sono le foto e il progetto del segnalamento del SIR3.

La foto della cabina del SIR3 data dall'utente è di PadovaOggi ([articolo dell'11 novembre 2026][padovaoggi2026],
didascalia "La cabina del conducente", testo alternativo "SIR 3 VOLTABAROZZO"). Non è nel repository: è in
`/private/tmp/claude-501/-Users-flevour-Sites-flevour-bus-simulator/1f252032-3341-4785-8744-16f28dc7514a/images/25.png`.
Le altre foto citate sono su Wikimedia Commons e su ferrovie.it; le ho solo guardate, non salvate nel repository.

## 1. Quale Translohr gira a Padova

### SIR1

* Translohr **STE3**: 25 m, tre casse, una cabina a ogni estremità (bidirezionale). Confermato
  ([Wikipedia it, NTL Translohr][wiki-it]; [Wikipedia it, Tranvia di Padova][wiki-it-pd]).
* 18 convogli, APS 01-18, in servizio da marzo 2007. Confermato ([presentazione SMART, dicembre 2025][mit2025];
  [Sustainable Bus, 2022][sbus2022]). Wikipedia in francese ne conta 22: le fonti non sono d'accordo
  ([Wikipedia fr][wiki-fr]).
* Tra Santo e Cavalletto (circa 600 m, Prato della Valle) il tram va a batteria, senza linea aerea. Confermato
  ([Wikipedia it, Tranvia di Padova][wiki-it-pd]). Il rinnovo della flotta SIR1 cambia le batterie. Confermato
  ([Sustainable Bus, 2022][sbus2022]).
* Il bando del 2001 chiedeva un volante per usare il mezzo come un autobus in caso di bisogno
  ([Wikipedia it, Tranvia di Padova][wiki-it-pd]). Il Translohr consegnato non ha un volante che sterza
  ([Wikipedia fr][wiki-fr]): Lohr ha abbandonato la guida bimodale e il veicolo segue sempre la rotaia
  ([Foot e Doniol-Shaw 2008][foot2008]; [Wikipedia en][wiki-en]).

### SIR3 e SIR2

* Alstom, che oggi costruisce il Translohr insieme a NTL ([Foot e Garrigou 2014][actes2014]), ha vinto il 23
  settembre 2022 la fornitura di **26 Translohr di terza generazione** per SIR2 e SIR3: 20 da 32 m (quattro casse) e
  6 da 25 m (tre casse), costruiti in Alsazia. Confermato ([comunicato Alstom][alstom2022]).
* Il primo tram a tre casse per il SIR3 è arrivato a Voltabarozzo il 29 gennaio 2025. Secondo il sito del Comune
  è "esteticamente identico" a quelli del SIR1, con dispositivi anti deragliamento, batterie nuove e un dispositivo
  che controlla "il collegamento tra la rotaia e il ruotino"; i tram a quattro casse sono di "seconda generazione",
  con sedili disposti in modo diverso. Confermato ([trampadova.it, gennaio 2025][trampadova2025]).
* PadovaOggi scrive che le vetture del SIR3 sono lo "stesso modello" di quelle del SIR1. Confermato
  ([PadovaOggi, 11 novembre 2026][padovaoggi2026]).
* I numeri della flotta cambiano da fonte a fonte: SIR3 7 veicoli e SIR2 26 per APS e Comune
  ([presentazione SMART][mit2025]); 5 a tre casse e 28 a quattro per trampadova.it ([gennaio 2025][trampadova2025]).

### Cosa cambia in cabina tra SIR1 e SIR3

Confronto tra la foto del 2006 di un tram del SIR1 ([ferrovie.it, foto 4, "La console di guida del TransLohr",
7 ottobre 2006][ferrovie2006]) e la foto del SIR3 di PadovaOggi. Tutto il confronto è **inferenza** dalle due foto.

* Uguale: la tavoletta di pulsanti grigi davanti al guidatore, con due pulsanti rossi a sinistra e due azzurri in
  basso a destra; il fungo rosso a destra; la colonna di LED rossi a destra dello schermo centrale; la scatola in
  alto a sinistra, sul montante del parabrezza, con lampade rosse e verdi.
* Diverso: nel 2006 il cruscotto è blu e lo schermo centrale mostra un tachimetro a lancetta; nel 2026 il cruscotto è
  grigio scuro e lo schermo è bianco, con data, ora e campi di testo. Nel 2026 c'è in più un monitor con la cornice
  blu a destra, probabilmente la console del sistema di esercizio (sezione 3). Il fungo giallo a sinistra si vede solo nel 2026 (nel 2006 quella zona è coperta dal guidatore).
* Non ho trovato nulla sulla cabina dei tram da 32 m del SIR2, né su come sono le cabine del SIR1 dopo il rinnovo.

## 2. I comandi della cabina, uno per uno

### Posto di guida

* Il posto di guida è **a sinistra**, come in un autobus, non al centro come nei tram moderni. Confermato per
  Clermont ([Foot e Doniol-Shaw 2006][foot2006], sezione "L'effet d'estrangement d'un tramway sur pneu").
* La cabina è stretta: il sedile tocca il passaruota e per arretrarlo a Clermont hanno dovuto inclinarne la guida.
  Confermato ([Foot 2018][foot2018], p. 36).

### Trazione e freno: due pedali

* Trazione e frenatura si comandano con **due pedali**, come in un autobus, non con un manipolatore. Confermato per
  Clermont ([Foot e Doniol-Shaw 2006][foot2006]: "la commande de traction/freinage se fait à l'aide de deux
  pédales"). Il rapporto d'inchiesta sull'incidente di Clermont del 2011 dice che il conducente frenò "avec la
  pédale de frein puis à l'aide du coup de poing de sécurité" ([BEA-TT 2012][beatt2012], § 3.1.1).
* Il pedale del freno è grande, "conséquence du passage d'un freinage routier à un freinage ferroviaire".
  Confermato ([Foot 2018][foot2018], p. 36).
* I freni sono di tipo stradale, sulle ruote gommate, con ABS. Confermato ([Wikipedia it][wiki-it]). Accelerazione e
  frenata di servizio sono limitate per il comfort; la frenata d'emergenza è più forte che nei tram su rotaia.
  Confermato ([Wikipedia fr][wiki-fr]).
* Padova: **inferenza**. Nessuna fonte parla dei pedali dei tram di Padova, ma il banco è lo stesso di Clermont e
  nelle foto di Padova non c'è nessuna leva di trazione.

### Veglia (VACMA, "uomo morto")

* Due pulsanti, **uno per lato della tavoletta**, al posto dove in un autobus c'è il volante; basta premerne uno.
  Confermato ([Foot e Doniol-Shaw 2006][foot2006]; [Foot e Doniol-Shaw 2009][foot2009]; [Doniol-Shaw, Foot e
  Franchi 2011][self2011]).
* Tempi a Clermont: si tiene premuto al massimo 12 s e si rilascia al massimo 2 s. Oltre suona un allarme; se entro
  2 s il conducente non agisce sulla veglia, parte il freno d'emergenza. Confermato ([Doniol-Shaw, Foot e Franchi
  2011][self2011], pp. 3-4; tabella in [Foot 2013][foot2013]).
* In pratica i conducenti premono la veglia con la mano destra e tengono la sinistra pronta sul gong; molti fanno
  30-50 pressioni brevi al minuto. Confermato ([Doniol-Shaw, Foot e Franchi 2011][self2011]).
* Dopo il 2015 Clermont ha rifatto il banco: due maniglie laterali e una barra centrale ("guidon") per la veglia.
  Confermato ([Foot 2018][foot2018], pp. 29-32).
* Padova: in un forum (SkyscraperCity, discussione "Padova Translohr") qualcuno scrive che si preme un pulsante ai
  lati del pannello ogni quindici secondi. L'ho visto solo nel riassunto di una ricerca: la pagina non si apre
  (rimanda a un servizio a pagamento). Non verificato.

### La tavoletta dei comandi

* La maggior parte dei comandi sta su una **tavoletta** davanti al conducente, disegnata come una tastiera da
  computer (dimensioni, distanza e forza dei tasti presi dalle norme per l'ufficio), con i tasti disposti in modo
  quasi simmetrico. Confermato ([Foot e Doniol-Shaw 2009][foot2009], sezione "Un poste bureautique pour un
  tramway ?").
* A Clermont la tavoletta aveva **28 comandi a pulsante**. Il gruppo di lavoro li ha divisi così ([Foot
  2018][foot2018], pp. 29 e 32). Confermato:
  * per guidare: gong, clacson, veglia, riconoscimento degli allarmi;
  * da usare spesso: porte, cambio della zona delle telecamere di retrovisione;
  * da fermi, legati alla guida: pantografo, **scambio** ("aiguille"), "mode tortue" (marcia lenta), apertura delle
    porte a sinistra, fendinebbia;
  * per preparare il tram: video interno, luci del comparto passeggeri e della cabina, ventilazione;
  * inoltre: tergicristallo e lavavetri, abbaglianti, quattro tasti per le pagine dello schermo centrale.

Sulla tavoletta di un Translohr STE3 del tram T5 di Parigi i simboli si leggono bene ([foto Commons,
2013][commons-t5b]). La disposizione è diversa da Padova (a Parigi il gong è a destra), ma i comandi sono quasi gli
stessi. Lettura dei simboli: **inferenza**.

| Riga | Simboli, da sinistra a destra |
| --- | --- |
| 1 | riscaldamento cabina, + e −; due tasti di ventilazione; disappannamento del parabrezza; luce cabina; luce passeggeri; ventilazione passeggeri; riscaldamento passeggeri; freccia su; freccia curva |
| 2 | tergicristallo + e −; lavavetri; TEST (prova delle spie); pantografo su e giù; freccia giù; freccia curva |
| 3 | clacson (rosso); abbaglianti; anabbaglianti; retronebbia; tartaruga (marcia lenta); triangolo sopra tre linee (non capito); semaforo; scambio a sinistra; scambio a destra; campana del gong (rosso) |
| 4 | annuncio ai passeggeri; voce o interfono; annuncio (non chiaro); simbolo non capito; porte lato sinistro; simbolo porte; porte lato destro; due tasti con frecce verso il centro (chiusura porte) |

Le quattro frecce delle righe 1 e 2 sono probabilmente i quattro tasti delle pagine dello schermo centrale di cui
parla [Foot 2018][foot2018] (inferenza).

### Gong e clacson

* Ci sono **tutti e due**. Il gong (o campanello) è il comando più usato in marcia; il clacson si usa ogni tanto.
  Confermato ([Foot e Doniol-Shaw 2009][foot2009]).
* A Clermont sono in basso a sinistra sulla tavoletta, tutti e due rossi: il gong sotto, il clacson sopra. I
  conducenti tengono la mano sinistra sempre pronta sul gong. Confermato ([Foot e Doniol-Shaw 2009][foot2009]).
* Sul banco nuovo di Clermont il gong è una lunga barra davanti al pupitre e c'è anche un gong a pedale; clacson e
  abbaglianti sono pulsanti a fungo. Confermato ([Foot 2018][foot2018], pp. 29 e 37).

### Porte

* I comandi delle porte sono in basso a destra sulla tavoletta, **azzurri**. Confermato ([Foot e Doniol-Shaw
  2009][foot2009]).
* Lo schermo centrale mostra uno schema del tram con lo stato delle porte, aperte o chiuse, che il conducente guarda
  in fermata. Confermato ([Foot e Doniol-Shaw 2009][foot2009]).
* In fermata si aprono le porte appena fermi e poi si chiudono; il tram può partire solo a porte del tutto chiuse.
  Confermato ([Doniol-Shaw, Foot e Franchi 2011][self2011]).
* L'apertura **a sinistra** è un comando a parte, che a Clermont hanno allontanato dal pupitre per non premerlo per
  sbaglio. Il conducente vede anche il "modo di apertura" delle porte e le richieste di apertura generale fatte da
  chi ha una disabilità. Confermato ([Foot 2018][foot2018], pp. 32-35).
* A Mestre il passeggero apre la porta con un pulsante verde, da dentro e da fuori. Confermato ([ferrovie.it,
  2010][ferrovie2010]). Quindi il conducente abilita le porte e chi sale o scende le apre (inferenza).
* Un allarme registra l'apertura di una porta in marcia. Confermato ([BEA-TT 2012][beatt2012], § 3.2).

### Pantografo

* Si alza e si abbassa da un pulsante, da fermi. Confermato ([Foot 2018][foot2018], p. 32; sulla tavoletta del T5
  c'è il simbolo del pantografo con le frecce su e giù, [Commons][commons-t5b], inferenza).
* Alcuni allarmi abbassano il pantografo da soli e frenano il tram; poi è il conducente a rialzarlo. Confermato
  ([BEA-TT 2012][beatt2012], §§ 3.1.1 e 3.4.1).
* Sul SIR3 ci sono due tratti in cui il tram va solo a batteria. Confermato ([trampadova.it, gennaio
  2025][trampadova2025]).

### Scambi

* A Clermont lo scambio ("aiguille") è un comando del conducente, da fermo. Sul banco nuovo è stato spostato lontano
  dal pupitre per evitare comandi per sbaglio. Confermato ([Foot 2018][foot2018], pp. 32-33).
* Sulla tavoletta del T5 ci sono due tasti con una Y e la freccia a sinistra o a destra: la scelta della direzione
  dello scambio. Inferenza ([Commons][commons-t5b]).
* Padova, SIR3: la richiesta parte dal tram, che passa su un "loop virtuale" (un punto calcolato dal computer di
  bordo con la localizzazione) e la manda a terra via WiFi; l'apparato di terra controlla, blocca lo scambio e
  accende il segnale di via libera con la direzione. Confermato ([Italferr 2020][italferr2020], §§ 7.2-7.4, 8.1).
  Dettagli del segnale e delle distanze nella sezione 4.
* Per Wikipedia il sistema degli scambi del SIR1 è "computerizzato, anche se controllato dalla centrale operativa".
  Confermato ([Wikipedia it, Tranvia di Padova][wiki-it-pd]).

### Priorità ai semafori e pulsante "Ready to Start"

* Ai semafori il tram chiede la priorità da solo, con loop virtuali di richiesta, conferma e rilascio. Il
  conducente ha anche un pulsante "Ready to Start" per chiederla a mano, per esempio quando il semaforo è subito
  dopo una fermata. Ogni cabina ha una "console del conducente" per questi sistemi. Confermato per il SIR3
  ([Italferr 2020][italferr2020], §§ 6.2 e 7.4).
* Il tasto con il semaforo sulla tavoletta del T5 potrebbe essere un comando simile. Inferenza.
* La priorità dipende dall'orario: niente priorità se il tram è in anticipo, richiesta se è in orario o in
  ritardo (e niente priorità se il tram è senza passeggeri). Confermato come requisito del SIR3 ([Italferr
  2020][italferr2020], § 6.1).

### Console del conducente: orario, fermate, messaggi (SAE)

Il SAE (Sistema di Ausilio all'Esercizio) è il sistema che localizza i tram e regola il servizio dal posto centrale.
Tutto confermato come requisito del progetto del SIR3 ([Italferr 2020][italferr2020]), salvo dove scritto:

* a bordo ci sono un computer, i sensori per la posizione (radar, accelerometro, satellite), la radio verso terra,
  il pulsante "Ready to Start" e una **"Console del conducente (una per cabina)"** (§ 7.4);
* il computer di bordo calcola la posizione al metro e la manda al posto centrale (PCC), che la usa per l'orario,
  i semafori, gli scambi e l'informazione ai passeggeri (§ 5);
* regolazione "a orario": il PCC calcola l'**anticipo o il ritardo** rispetto all'orario; il dato "viene trasferito
  al sistema di bordo e visualizzato sul console del conducente, in modo che il conducente possa decidere di
  regolare la velocità del veicolo" (§ 10.2);
* regolazione "a intervallo" (nelle ore di punta): sulla console compare un **conto alla rovescia per la
  partenza**, per gestire la sosta a ogni fermata e tenere la frequenza (§ 10.2);
* il PCC parla con i conducenti (può scegliere un tram sullo schema della linea e chiamarlo), riceve le chiamate
  d'emergenza dei passeggeri e manda dati ai tram (§ 10.2); voce e dati viaggiano su GSM/GPRS, come per il SIR1,
  e su una rete WiFi lungo la linea (§ 9.1);
* il PCC del SIR3 è un ampliamento di quello del SIR1 ([Italferr 2020, posto centrale][italferr2020pcc], § 4).
  Quindi anche i tram del SIR1 sono già localizzati e seguiti dal PCC (inferenza: non ho trovato come è fatta la
  loro console);
* per i passeggeri ci sono due monitor da 17" dietro le cabine (§ 9.4): non sono la console del conducente.

Chi fornisce il sistema e com'è fatta la console: **non trovato**. Il progetto Italferr non nomina un fornitore. Il
SIR3 è stato costruito da un raggruppamento con C.S.E., Ferrari Ferruccio, MERMEC STE ed Euroferroviaria
([presentazione SMART][mit2025]); non ho trovato chi di loro fornisca il SAE. Non ho trovato nemmeno il fornitore
dell'AVM dei bus di Busitalia Veneto o di APS (gare, capitolati, comunicati: nessun risultato su INIT, Pluservice,
AEP, Divitech, Swarco, Hitachi).

Esempi di console di questo tipo, non quella di Padova:

* SWARCO NEXT OBU GUI mostra al conducente il capolinea precedente e successivo, le prossime fermate, linea e
  corsa, l'**anticipo o il ritardo**, l'intervallo dal mezzo davanti, i messaggi con la centrale, una linea voce con
  la centrale e gli allarmi di diagnostica ([pagina SWARCO][swarco]).
* IVU.box.panel è un terminale da 7" o 10" "specially developed for bi-directional operation in trams" ([pagina
  IVU][ivu]).

Non ho trovato foto confrontabili con l'apparecchio della foto del SIR3 (cornice blu, cinque tasti sotto lo
schermo, tre sul lato destro).

### Freno d'emergenza

* È un **pulsante a fungo** ("coup de poing de sécurité"). Confermato ([BEA-TT 2012][beatt2012], § 3.1.1). Nelle
  foto di Padova (2006 e 2026), del T5 e di Clermont c'è un fungo rosso alla destra del conducente (inferenza sulla
  funzione di quello di Padova, per la posizione uguale).
* Il freno d'emergenza parte anche da solo se il conducente non usa la veglia ([Doniol-Shaw, Foot e Franchi
  2011][self2011]). Alcuni allarmi del sistema di guida fanno partire una "frenata di sicurezza" ([BEA-TT
  2012][beatt2012], § 3.4.1).

### Schermo centrale e spie

* Lo schermo centrale, dietro la tavoletta, mostra la **velocità** e lo **schema delle porte**. Confermato
  ([Foot e Doniol-Shaw 2009][foot2009]). Mostra anche gli allarmi ("écran de conduite"). Confermato ([BEA-TT
  2012][beatt2012], § 3.4.1).
* Una spia rossa "di sicurezza" a Clermont indicava a volte un guasto del pattino di ritorno della corrente, a volte
  dei rulli di guida, senza dire quale: è stata cambiata dopo l'incidente del 2011. Confermato ([Foot e Garrigou
  2014][actes2014], intervento di un delegato di T2C).
* Il tram registra velocità, distanze, freni, posizione del pantografo e guasti (a Clermont si chiama BMA).
  Confermato ([BEA-TT 2012][beatt2012], § 3.2).

### Retrovisione e video

* A Clermont si guarda indietro con telecamere e due schermi ai lati dello schermo centrale. Le telecamere
  lasciavano un angolo cieco davanti a destra, sulla prima porta; con il banco nuovo hanno aggiunto uno specchio
  per la banchina. Confermato ([Foot e Doniol-Shaw 2009][foot2009]; [Foot 2018][foot2018], pp. 32-34). Un tasto
  cambia la "zona di retrovisione". Confermato ([Foot 2018][foot2018]). Per Padova non ho trovato nulla.
* Sul montante sinistro c'era la scatola di comando del **video interno**. Confermato ([Foot 2018][foot2018], p. 34).

### Radio

* Il conducente parla per radio con il posto centrale (PCC), segnala i guasti e segue le sue istruzioni.
  Confermato ([BEA-TT 2012][beatt2012], §§ 3.1 e 3.4.2).
* Nella foto del T5 la cornetta della radio, nera con il cavo a spirale, è in alto a sinistra accanto alla
  tavoletta ([Commons][commons-t5a]). Inferenza sulla funzione.
* Sul SIR3 il PCC chiama i conducenti attraverso il sistema SAE, su GSM, e manda loro dati e messaggi. Confermato
  come requisito ([Italferr 2020][italferr2020], §§ 9.1 e 10.2). Dove arrivano i messaggi scritti (console SAE o
  schermo centrale) non è scritto.

### Consolle a sinistra: chiave, selettori, pulsanti protetti

* Nella foto del T5, a sinistra del sedile c'è una consolle con una **chiave**, un **selettore rotativo**, pulsanti
  verdi e rossi illuminati, un pulsante con il triangolo delle quattro frecce e una fila di pulsanti rossi sotto
  coperchi trasparenti ([Commons][commons-t5a]). Le scritte non si leggono: tutto **inferenza**. La chiave è
  probabilmente quella che attiva la cabina; il selettore forse il senso di marcia; i pulsanti coperti comandi da
  usare solo in caso di guasto.
* Esiste un freno di stazionamento: il conducente vede una spia "frein de parc actif". Confermato ([Foot
  2018][foot2018], p. 35). Il comando non è descritto.

### Velocità e marcia a vista

* Il Translohr va a vista: il conducente regola la velocità per potersi fermare prima di un ostacolo, di un altro
  tram o di un segnale di arresto. Confermato ([BEA-TT 2012][beatt2012], § 2.2; per il SIR3 [Italferr
  2020][italferr2020], § 7.1).
* Velocità massima del veicolo 70 km/h ([Wikipedia fr][wiki-fr]); a Clermont la linea è limitata a 60 km/h
  ([BEA-TT 2012][beatt2012], § 2.2).

## 3. La foto del SIR3, elemento per elemento

| Elemento | Cosa è probabilmente | Stato | Fonti |
| --- | --- | --- | --- |
| Scatola in alto a sinistra con schermo e quattro lampade (scura, rossa, rossa, verde) | Scatola del video interno (e forse dell'interfono passeggeri), come quella sul montante sinistro a Clermont. In alternativa la console del sistema di localizzazione, scambi e priorità che il progetto del SIR3 chiede in ogni cabina. C'era già nel 2006 | inferenza | [Foot 2018][foot2018] p. 34; [Italferr 2020][italferr2020] § 7.4; [ferrovie.it 2006][ferrovie2006] |
| Tavoletta con circa 35 pulsanti grigi | Tavoletta dei comandi del Translohr, "come una tastiera da computer" | confermato (tipo di comando) | [Foot e Doniol-Shaw 2009][foot2009] |
| I due pulsanti rossi a sinistra | Quello più in basso è il **gong**, quello sopra il **clacson** | inferenza forte: stessa disposizione descritta a Clermont | [Foot e Doniol-Shaw 2009][foot2009] |
| I due pulsanti azzurri in basso a destra | **Porte**. Dai simboli: uno apre e uno chiude | confermato il colore e la funzione a Clermont; inferenza quale apre e quale chiude | [Foot e Doniol-Shaw 2009][foot2009] |
| Gli altri pulsanti grigi | Luci, clima, tergicristallo, annunci, pantografo, scambio, marcia lenta, prova spie, pagine dello schermo | inferenza: i simboli non si leggono nella foto | [Foot 2018][foot2018]; [Commons T5][commons-t5b] |
| "Leva" nera a sinistra della tavoletta | Non è una leva di trazione (il Translohr va a pedali). Quasi certamente la **cornetta della radio** nel suo supporto, come nella foto del T5. In alternativa il pulsante di veglia del lato sinistro | inferenza | [Foot e Doniol-Shaw 2006][foot2006]; [Commons T5][commons-t5a] |
| Fungo giallo a sinistra | Non identificato. Nessuna fonte. Potrebbe essere un secondo comando d'emergenza (per esempio per il pantografo), ma è solo un'ipotesi | sconosciuto | nessuna |
| Fungo rosso a destra | **Freno d'emergenza** ("coup de poing") | confermato il comando; inferenza per la posizione | [BEA-TT 2012][beatt2012]; foto [2006][ferrovie2006], [T5][commons-t5a], [Clermont][commons-cf-old] |
| Pulsante arancione sopra la tavoletta | Non identificato. Forse il riconoscimento degli allarmi, che a Clermont è tra i comandi di guida | inferenza debole | [Foot 2018][foot2018] |
| Schermo centrale | Velocità, stato delle porte, allarmi. Nella foto: data, ora, campi di testo e un'icona | confermato a Clermont; inferenza per Padova | [Foot e Doniol-Shaw 2009][foot2009]; [BEA-TT 2012][beatt2012] |
| Colonna di LED rossi accanto allo schermo | Una barra luminosa. Nel T5 ci sono due barre ai lati dello schermo, una con la scala 5-15-25-35. Forse lo sforzo chiesto con i pedali o la velocità: nessuna fonte | sconosciuto | [Commons T5][commons-t5b] |
| Monitor con cornice blu a destra (schermo spento, cinque tasti sotto, tre sul lato destro, su una staffa nera) | Probabilmente la **console del conducente del SAE**: anticipo o ritardo sull'orario, conto alla rovescia per la partenza, fermate, messaggi del PCC. Il progetto del SIR3 chiede una console così in ogni cabina. Meno probabile un monitor delle telecamere: il Translohr ha già gli schermi di retrovisione nel cruscotto, ai lati dello schermo centrale. Non c'è nella foto del 2006. Modello e fornitore non trovati | inferenza (la console è confermata dal progetto; che sia questo apparecchio no) | [Italferr 2020][italferr2020] §§ 7.4 e 10.2; [Foot 2018][foot2018] p. 32; [ferrovie.it 2006][ferrovie2006] |
| Pulsanti rosso e verde in basso a sinistra, con una serratura tra i due | Consolle a sinistra: la serratura è probabilmente la **chiave di attivazione della cabina**, come nella foto del T5 | inferenza | [Commons T5][commons-t5a] |

## 4. Le procedure del conducente

Le fonti descrivono bene la guida in linea, le fermate, gli scambi del SIR3 e le emergenze. Non descrivono la
preparazione del tram né il cambio di cabina: per queste due fasi scrivo solo inferenze.

### Preparazione e attivazione della cabina

Nessuna fonte. Inferenza dalla consolle del T5 e dalla pratica comune nei tram: chiave nella cabina da cui si
guida, prova delle spie (tasto TEST), pantografo su, controllo dello schermo, porte chiuse, freno di stazionamento
tolto. Il Translohr ha una cabina a ogni estremità ([Wikipedia fr][wiki-fr]).

### Partenza

* Porte chiuse del tutto, altrimenti il tram non parte ([Doniol-Shaw, Foot e Franchi 2011][self2011]).
* Si guarda il segnale e la strada: marcia a vista ([BEA-TT 2012][beatt2012]).
* Se dopo la fermata c'è un semaforo, sul SIR3 si può chiedere la priorità con "Ready to Start" ([Italferr
  2020][italferr2020]).
* Pedale della trazione ([Foot e Doniol-Shaw 2006][foot2006]) e veglia da subito.

### In linea

* Veglia continua e mano pronta sul gong: sono le due azioni principali in marcia ([Doniol-Shaw, Foot e Franchi
  2011][self2011]).
* Il tram non può scartare: per evitare un ostacolo si suona e si frena ([Doniol-Shaw, Foot e Franchi
  2011][self2011]).
* Ai semafori la priorità parte da sola ([Italferr 2020][italferr2020]).

### Fermata con le porte

* Ci si ferma, si aprono le porte appena fermi (a destra di norma; a sinistra con il comando a parte), si guarda lo
  scambio dei passeggeri sugli schermi della retrovisione, si chiudono le porte e si aspetta che siano chiuse
  ([Doniol-Shaw, Foot e Franchi 2011][self2011]; [Foot 2018][foot2018]).
* I conducenti cercano di stare fermi il meno possibile per restare in orario ([Doniol-Shaw, Foot e Franchi
  2011][self2011]).

### Capolinea e cambio di cabina

Nessuna fonte descrive il cambio di cabina del Translohr. Inferenza: a tram fermo e porte chiuse si mette il freno di
stazionamento, si toglie la chiave, si attraversa il tram fino all'altra cabina, si mette la chiave, si cambia la
destinazione e si parte nell'altro senso. Al capolinea con lo scambio, a Padova la richiesta dello scambio parte
dal tram (vedi sotto).

### Scambi (SIR3, e per le distanze anche il SIR1)

Tutto confermato da [Italferr 2020][italferr2020], §§ 7 e 8:

* il tram passa sul loop virtuale di ingresso e chiede lo scambio;
* l'apparato di terra controlla, blocca lo scambio e mette il segnale su via libera ("Go"), con la direzione;
* croce "X" sulla seconda luce del segnale: zona occupata da un altro tram, oppure aghi non controllati. Se gli aghi
  non sono controllati il conducente va a passo d'uomo, guarda gli aghi e se serve manovra a mano la cassa di
  manovra;
* segnale spento: sistema guasto. Il conducente guarda gli aghi e se serve li manovra a mano;
* il segnale è a **8 m** dalla punta dello scambio; quando il pantografo passa su un contatto della linea aerea, a
  **12 m** dal segnale, la zona risulta occupata e i tram che seguono vedono la X; il loop di uscita è **25 m** dopo
  la punta dello scambio. Sono le stesse distanze del SIR1.

A Clermont i conducenti con l'allarme COMA disattivato (vedi "Emergenze") potevano arrivare alla fermata dopo, ma
non passare sugli scambi ([BEA-TT 2012][beatt2012], § 3.1.2).

### Emergenze

* Freno a fungo. Nell'incidente di Clermont il conducente ha frenato prima con il pedale e poi con il fungo
  ([BEA-TT 2012][beatt2012], § 3.1.1).
* Allarme della veglia: 2 s per reagire, poi freno d'emergenza ([Doniol-Shaw, Foot e Franchi 2011][self2011]).
* Allarme del contatto con la rotaia di guida (COMA a Clermont): sotto 0,5 s nulla; oltre, allarme sullo schermo e
  frenata di sicurezza; oltre 0,7 s da fermi o 2,5 s in marcia, anche pantografo giù ([BEA-TT 2012][beatt2012],
  § 3.4.1).
* Il conducente avvisa il PCC e segue le sue istruzioni; per scendere dalla cabina chiede il permesso; se serve fa
  scendere i passeggeri ([BEA-TT 2012][beatt2012], §§ 3.1.1, 3.2 e 3.4.2).

## 5. Per il gioco

Comandi di oggi: `onKeyPress` e `readInput` in `src/main.js`, `Tram.update` e `Tram.drawDash` in `src/tram/tram.js`,
aiuto in `index.html`, specifica in `docs/prompt-tram.md` (sezione "Cabina").

| Comando reale | Nel gioco oggi | Proposta |
| --- | --- | --- |
| Pedali di trazione e freno | W/S "manipolatore", progressivi, Shift a fondo | Tenere W/S e i grilletti del gamepad, che sono già pedali. Chiamarli "pedali" in aiuto, toast e `docs/prompt-tram.md` |
| Gong | H, rintocchi finché è premuto | Va bene così |
| Clacson | Shift+H (#63), con un suono suo, più acuto di quello del bus; Shift conta se è premuto prima di H | Fatto |
| Veglia | Manca | Opzione "guida realistica", spenta di base: tenere premuto o battere un tasto (K, libero sul tram); 12 s, allarme, 2 s, freno d'emergenza con penalità |
| Fungo rosso | Backspace o clic sul fungo, sulla plancia blu a sinistra dello schermo LCD (#62): toglie la trazione e frena a 2,6 m/s² fino all'arresto, si riarma solo da fermo ripremendolo; in servizio, in marcia senza un ostacolo davanti, −50 punti | Fatto |
| Porte | F apre e chiude | Tenere F per il lato della banchina. Il lato sinistro è un comando a parte: sul tram Q/E potrebbero aprire a sinistra e a destra |
| Frecce | Q/E/G valgono anche per il tram | Nessuna fonte mostra frecce di direzione sul Translohr (la tavoletta del T5 non ne ha). Le quattro frecce sì, nella consolle del T5 (inferenza): tenere G, usare Q/E per le porte |
| Pantografo | O | Va bene. Idea: ogni tanto un allarme del contatto con la rotaia di guida che frena e abbassa il pantografo, da rialzare con O |
| Scambio | N in Esplorazione e Giro libero; in servizio si gira da solo | Coerente con Padova, dove la richiesta parte dal tram. Si possono aggiungere i tre aspetti del segnale (via libera con direzione, X, spento) |
| Ready to Start | Manca | Facoltativo: un tasto libero sul tram (R) dopo le fermate con il semaforo subito dopo |
| Cambio cabina | B, da fermi con le porte chiuse | Va bene. Le fonti non descrivono i passi veri (chiave, attraversare il tram) |
| Fari | L | Va bene; abbaglianti facoltativi |
| Tergicristallo | Automatico con la pioggia | Va bene |
| Freno di stazionamento | Spazio | Va bene; nel cruscotto la spia "P" c'è già |
| Schermo centrale | Tachimetro a lancetta, T/F in %, PORTE, P | Aggiungere lo schema del tram con le porte e una riga per gli allarmi |
| Console SAE (monitor blu) | Nella cabina non c'è. Anticipo e ritardo, prossima fermata e conto alla rovescia sono solo nel pannello dell'HUD (`hud.js`, con `fmtDelay` di `mission.js`) | Disegnarli anche sul monitor blu della cabina, vedi sotto |
| Retrovisione | Non ci sono schermi delle telecamere | Due schermi ai lati dello schermo centrale con le telecamere laterali (lo chiede già `docs/prompt-tram.md`) |

Tasti liberi sul tram: K non fa nulla e R mostra solo un messaggio; Q ed E si liberano se il tram non usa le frecce.

Pulsanti cliccabili: la tavoletta può diventare una texture con zone cliccabili. Le più utili: gong e clacson (rossi,
a sinistra), porte (azzurri, in basso a destra), pantografo, scambio, luci, TEST; il fungo rosso a destra.

Console SAE nella cabina. Il gioco conosce già quello che la console vera deve mostrare: in `hud.js` il pannello della
linea calcola il ritardo stimato sulla prossima fermata, lo scrive con `fmtDelay` di `mission.js` (+m:ss o −m:ss: verde
in orario, rosso oltre 2 minuti di ritardo, giallo oltre 1 minuto di anticipo) e, fermi in fermata, scrive "partenza
tra m:ss" o "PRONTO A PARTIRE". Proposta: una seconda texture su canvas, come `Tram.drawDash`, sul monitor con la
cornice blu a destra del fungo rosso:

* in alto linea e destinazione, l'ora;
* al centro, grande, l'anticipo o il ritardo con gli stessi colori dell'HUD; in fermata il conto alla rovescia per
  la partenza (è proprio quello che la console mostra nella regolazione "a intervallo");
* sotto, le prossime tre fermate con l'orario teorico e la distanza dalla prima;
* in fondo una riga per i messaggi del PCC: lì possono finire i messaggi del tram che oggi sono toast (scambio,
  pantografo, cambio cabina);
* i cinque tasti sotto lo schermo come zone cliccabili, per esempio: pagina fermate, pagina messaggi, "Ready to
  Start". Quali siano i tasti veri non si sa: è una scelta di gioco.

Facoltativo, dal progetto del SIR3: oggi ogni incrocio dà sempre la precedenza al tram (`TramSignals` in
`src/world/traffic.js`); nella realtà la priorità non si chiede se il tram è in anticipo. Si può fare lo stesso, così
anticipare ha un costo anche agli incroci.

Differenze tra il modello di oggi e le fonti (non corrette qui):

* in `src/tram/tram.js` il commento dice "posto di guida al centro (dalla foto)": a Clermont è a sinistra, come in
  un autobus ([Foot e Doniol-Shaw 2006][foot2006]), e Padova ha lo stesso banco (inferenza);
* `docs/prompt-tram.md` mette "il manipolatore a destra del guidatore": il Translohr va a pedali, e nelle foto a
  destra c'è il fungo rosso;
* il banco del 2026 è grigio scuro; quello blu è del SIR1 nel 2006.

## Lacune

* Nessun documento di Padova sulla guida (regolamento di esercizio, manuale APS o Busitalia): i comandi di Padova
  sono dedotti dalle foto e da Clermont e Parigi.
* Cabina dei tram da 32 m del SIR2: nessuna foto né descrizione.
* Chiave, selettore del senso di marcia, retromarcia, cambio di cabina: nessuna fonte scritta sul Translohr.
* Fungo giallo, pulsante arancione, colonna di LED, scatola in alto: nessuna fonte.
* Monitor blu: il progetto conferma che ogni cabina ha una console del SAE con anticipo e ritardo, ma non ho trovato
  il fornitore (né del SAE dei tram né dell'AVM dei bus di Busitalia Veneto e APS), il modello, cosa fanno i suoi
  tasti, né una foto confrontabile. Nella foto lo schermo è spento.
* Tempi della veglia a Padova: sconosciuti.
* Simboli dei tasti di Padova: illeggibili nelle due foto.

Fonti non raggiungibili o non lette:

* Cairn ([articolo del 2006][cairn2006]): risponde 403. Ho letto la stessa versione su HAL ([foot2006]).
* SkyscraperCity, discussione "Padova Translohr" (https://www.skyscrapercity.com/threads/padova-translohr.1303941/):
  rimanda a un servizio a pagamento (Tollbit).
* haiku-design.com, pagina "Tramways TRANSLOHR, poste de conduite": 404.
* latts.fr, PDF "Un tram plus ergonomique à Clermont-Ferrand": 404.
* HAL senza file: l'expertise del 2004 sulla cabina del Translohr (halshs-01120090), le expertise per la RATP su T5
  e T6 (hal-01354977, hal-01354979, hal-00588272), il rapporto del 2013 sulla veglia a pedale (hal-00956797) e i
  rapporti sul nuovo pupitre di Clermont (halshs-01257376, hal-01192657, hal-01192659, halshs-01257390).
* ResearchGate: non consultato.

## Fonti

Lette il 12 novembre 2026. I PDF di HAL sono dietro un controllo anti robot e li ho letti in un browser.

* [foot2006]: R. Foot, G. Doniol-Shaw, "La dérive d'un dispositif de sécurité : de l'homme mort à l'homme
  incertain", *Terrains & travaux*, 2006.
* [foot2008]: R. Foot, G. Doniol-Shaw, "Questions raised on the design of the 'dead-man' device installed on
  trams", *Cognition, Technology & Work*, 2008.
* [foot2009]: R. Foot, G. Doniol-Shaw, "L'ergonomie contre le design ou le conducteur est-il un usager ? La mise en
  débat d'une cabine de tramway", 2009.
* [self2011]: G. Doniol-Shaw, R. Foot, P. Franchi, "Tramway et TMS : une mise en veille de la santé et de la
  sécurité", congresso SELF 2011.
* [foot2013]: R. Foot, "La Vacma : un dispositif de sécurité qui met en cause la santé des conducteurs et la
  sécurité de conduite", 2013.
* [actes2014]: R. Foot, A. Garrigou (a cura di), "Homme mort et conditions de travail des conducteurs de tramway",
  seminario del 23 giugno 2014.
* [foot2018]: R. Foot (a cura di), "Rencontres autour d'un poste de conduite de tramway", Clermont-Ferrand, 11
  gennaio 2018.
* [beatt2012]: BEA-TT, "Rapport d'enquête technique sur le déguidage d'une rame du tramway sur pneumatiques de
  Clermont-Ferrand (63), le 10 janvier 2011", marzo 2012.
* [italferr2020]: Italferr per APS Holding, "Progettazione definitiva della nuova linea tramviaria SIR3. Relazione
  tecnica impianti segnalamento, localizzazione, supervisione", aprile 2020.
* [italferr2020pcc]: Italferr per APS Holding, stesso progetto, "Relazione Tecnica Posto Centrale Operativo", 2020.
* [swarco]: SWARCO, pagina del prodotto NEXT OBU GUI (console di bordo per il conducente).
* [ivu]: IVU, pagina dei computer di bordo (IVU.box.panel per i tram).
* [alstom2022]: Alstom, comunicato del 23 settembre 2022 sui 26 Translohr per Padova.
* [trampadova2025]: trampadova.it, arrivo del primo tram del SIR3 a Voltabarozzo, gennaio 2025.
* [padovaoggi2026]: PadovaOggi, Giulia Ariti, "Sul tram per Voltabarozzo, viaggio a bordo della nuova linea", 11
  novembre 2026.
* [mit2025]: APS Holding e Comune di Padova (D. Galiazzo), presentazione del sistema SMART, dicembre 2025.
* [sbus2022]: Sustainable Bus, "Padua, new line Sir3 and revamping Sir1 fleet", 12 dicembre 2022.
* [ferrovie2006]: ferrovie.it, Luca Trentin, "In pre-esercizio il TransLohr di Padova", 10 ottobre 2006 (foto 4).
* [ferrovie2010]: ferrovie.it, Paolo Corposanto, "TransLohr di Mestre in servizio regolare", 21 dicembre 2010.
* [commons-t5a]: Wikimedia Commons, Chris93, "Poste de conduite du Translohr STE3", T5 a Pierrefitte, 31 maggio
  2013, CC BY-SA 3.0.
* [commons-t5b]: Wikimedia Commons, Chris93, "Détail du poste de conduite du Translohr STE3", 31 maggio 2013,
  CC BY-SA 3.0.
* [commons-cf-old]: Wikimedia Commons, Maxime Thibert, "Cabine Translohr Conducteur ancien pupitre de commande",
  Clermont-Ferrand, 2024, CC BY-SA 4.0. Il banco nuovo: [commons-cf-new].
* [wiki-fr], [wiki-it], [wiki-en], [wiki-it-pd]: voci di Wikipedia su Translohr e sulla tranvia di Padova.

[foot2006]: https://shs.hal.science/halshs-00436522
[cairn2006]: https://www.cairn.info/revue-terrains-et-travaux-2006-2-page-16.htm
[foot2008]: https://shs.hal.science/halshs-00437501
[foot2009]: https://shs.hal.science/halshs-00440317
[self2011]: https://shs.hal.science/halshs-00624132
[foot2013]: https://shs.hal.science/halshs-00818413
[actes2014]: https://shs.hal.science/halshs-01105145
[foot2018]: https://enpc.hal.science/hal-02018387
[beatt2012]: https://www.bea-tt.developpement-durable.gouv.fr/IMG/pdf/Rapport_BEATT_2011-001.pdf
[italferr2020]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/597_NP0000D16RHIS0000001A.pdf
[alstom2022]: https://www.alstom.com/fr/press-releases-news/2022/9/alstom-fournira-26-nouveaux-tramways-sur-pneus-translohr-lagglomeration
[trampadova2025]: https://www.trampadova.it/2025/01/arrivato-a-voltabarozzo-il-primo-mezzo-destinato-alla-linea-sir3/
[padovaoggi2026]: https://www.padovaoggi.it/attualita/padova-tram-ragona-giro-sir3-11-novembre-2026.html
[mit2025]: https://www.mit.gov.it/nfsmitgov/files/media/notizia/2025-12/01%20Presentazione%20Sistema%20SMART%20-%20Galiazzo.pdf
[sbus2022]: https://sustainable-bus.com/trolleybus-tramway/padua-new-line-sir3-and-rewamping-sir1
[ferrovie2006]: https://www.ferrovie.it/portale/articoli/2297
[ferrovie2010]: https://www.ferrovie.it/portale/articoli/2769
[commons-t5a]: https://commons.wikimedia.org/wiki/File:Poste_de_conduite_du_Translohr_STE3.jpg
[commons-t5b]: https://commons.wikimedia.org/wiki/File:D%C3%A9tail_du_poste_de_conduite_du_Translohr_STE3.jpg
[commons-cf-old]: https://commons.wikimedia.org/wiki/File:Cabine_Translohr_Conducteur_ancien_pupitre_de_commande.jpg
[commons-cf-new]: https://commons.wikimedia.org/wiki/File:Pupitre_de_conduite_nouvelle_g%C3%A9n%C3%A9ration.jpg
[wiki-fr]: https://fr.wikipedia.org/wiki/NTL_Translohr
[wiki-it]: https://it.wikipedia.org/wiki/NTL_Translohr
[wiki-en]: https://en.wikipedia.org/wiki/Translohr
[wiki-it-pd]: https://it.wikipedia.org/wiki/Tranvia_di_Padova
[italferr2020pcc]: https://www.comune.padova.it/urbanistica/Varianti_Pi_2021/44_progetto_variante_SIR3/599_NP0000D16RHIS0000002A.pdf
[swarco]: https://swarco.com/products/software/public-transport/next-obu-gui
[ivu]: https://www.ivu.com/en/on-board-systems/on-board-computers
