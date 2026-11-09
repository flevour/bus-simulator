# Richiesta di dati al Comune di Padova (accesso civico generalizzato)

Il Comune ha dati che nessuna fonte aperta ha: il rilievo del 2023 delle strade (gemello digitale, mobile mapping) con
segnaletica, semafori, marciapiedi e alberi, e i piani semaforici. Si chiedono con l'**accesso civico generalizzato**
(FOIA italiano, art. 5 comma 2 del D.Lgs. 33/2013): chiunque può chiedere dati e documenti della pubblica
amministrazione, **senza motivarlo**, gratis (salvo il costo di eventuali supporti).

## Come si invia

1. Sul sito del Comune, sezione **Amministrazione trasparente → Altri contenuti → Accesso civico**, si trovano il modulo
   e gli indirizzi (PEC del protocollo generale o email dell'ufficio che detiene i dati). Usare quelli indicati lì.
2. Inviare il testo qui sotto **via PEC** (vale come raccomandata) oppure con il modulo online, firmato o con copia del
   documento d'identità.
3. Conservare la **ricevuta di protocollo**: da quella data il Comune ha **30 giorni** per rispondere (art. 5 c. 6).
4. Se il Comune ha bisogno di sentire terzi (per esempio la ditta del rilievo) può sospendere i termini per 10 giorni.
5. Se risponde di no, risponde solo in parte o non risponde entro 30 giorni: **richiesta di riesame** al Responsabile
   della prevenzione della corruzione e della trasparenza (RPCT) del Comune (art. 5 c. 7), che decide entro 20 giorni;
   dopo, ricorso al TAR o al Difensore civico.
6. I dati personali (targhe, volti nelle immagini del mobile mapping) possono essere esclusi (art. 5-bis): per questo si
   chiedono gli **strati vettoriali** e non le immagini.

Il Comune può avere già pubblicato una parte di questi dati sul geoportale o sul portale open data: in quel caso basta
la risposta con il link.

## Testo da inviare

> **Oggetto**: Richiesta di accesso civico generalizzato ai sensi dell'art. 5, comma 2, del D.Lgs. 33/2013 — dati
> geografici di strade, segnaletica e semafori
>
> Al Comune di Padova — Settore Mobilità e Sistema Informativo Territoriale (o all'ufficio che detiene i dati)
>
> Il/La sottoscritto/a ……………………, nato/a a …………… il ……………, residente a ……………, email ……………, PEC (se presente) ……………
>
> chiede, ai sensi dell'art. 5, comma 2, del D.Lgs. 33/2013, l'accesso ai seguenti dati, **in formato aperto e
> georeferenziato** (GeoPackage, shapefile o GeoJSON; tabelle in CSV), con l'indicazione della licenza d'uso
> (preferibilmente CC BY 4.0 o IODL 2.0):
>
> 1. gli **strati vettoriali del rilievo della rete stradale del 2023** (cosiddetto gemello digitale, rilievo mobile
>    mapping): segnaletica verticale (tipo di cartello e posizione), segnaletica orizzontale (linee, frecce, strisce
>    pedonali, stalli), impianti semaforici e lanterne, marciapiedi e cordoli, attraversamenti, alberature, punti luce,
>    fermate e pensiline;
> 2. l'**elenco degli impianti semaforici** con la posizione delle lanterne e dei pali e, per ciascun impianto, il
>    **piano semaforico** (fasi, durate di verde, giallo e tutto rosso, ciclo, coordinamento con gli impianti vicini,
>    priorità al tram SIR1);
> 3. il **grafo stradale comunale** con sensi di marcia, corsie riservate al trasporto pubblico, zone a traffico
>    limitato e aree pedonali;
> 4. il **catasto delle strade** (DM 1 giugno 2001), se disponibile, con le larghezze di carreggiate e marciapiedi;
> 5. se disponibili, i **modelli digitali del terreno e delle superfici** (LiDAR) del territorio comunale.
>
> Non si chiedono immagini né dati personali: se alcuni strati li contengono, si chiede l'accesso parziale agli altri
> (art. 5-bis, comma 4).
>
> Si chiede l'invio all'indirizzo email indicato o la pubblicazione con un link per lo scaricamento.
>
> Luogo e data ……………          Firma ……………
>
> Allegato: copia del documento d'identità (se la richiesta non è firmata digitalmente o inviata da PEC personale)

## Cosa farne quando arrivano

* Strati del gemello digitale: semafori e lanterne al posto di quelli OSM dove ci sono (tappa M7 del piano,
  `docs/PIANO_MODELLO_CITTA.md`), cartelli e segnaletica orizzontale reali, cordoli per la pianta delle strade.
* Piani semaforici: fasi e durate vere al posto del ciclo di 60 s del gioco (`src/world/traffic.js`).
* Licenza: riportare l'attribuzione nel gioco e nel README come per gli altri dati.

Anche la **Regione del Veneto** ha dati utili non scaricabili dal sito: le tessere del **DTM LiDAR a 5 m** (40 su
Padova; l'elenco c'è, il download risponde "Parametri mancanti"). Si possono chiedere allo stesso modo alla Direzione
Pianificazione Territoriale della Regione (indirizzi sul sito della Regione, area Cartografia).
