# Richiesta di dati al Comune di Padova (accesso civico generalizzato)

Il Comune ha, o può avere, dati che nessuna fonte aperta ha: l'elenco e i piani degli impianti semaforici (la
manutenzione è affidata a una ditta, quindi l'elenco esiste), eventuali rilievi della rete stradale con segnaletica,
marciapiedi e alberi, il catasto delle strade, il LiDAR. Si chiedono con l'**accesso civico generalizzato**
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

Il Comune risponde solo per i dati che **detiene**: se un dato non ce l'ha lo dice, senza conseguenze. Per questo la
richiesta chiede tutto "ove detenuto", nella forma in cui è disponibile, e non dà per scontato un rilievo preciso (non
abbiamo trovato conferme di un rilievo mobile mapping del Comune di Padova; c'è quello di Milano). Prima di inviare
conviene guardare il registro degli accessi e i bandi in Amministrazione trasparente ("semaforic", "rilievo",
"mobile mapping", "catasto strade", "LiDAR"): un appalto trovato lì è la prova che i dati esistono.

> **Oggetto**: Richiesta di accesso civico generalizzato ai sensi dell'art. 5, comma 2, del D.Lgs. 33/2013 — dati
> geografici di strade, segnaletica e semafori
>
> Al Comune di Padova — Unità Operativa Prevenzione Corruzione e Trasparenza, e per competenza al Settore Mobilità e
> al Sistema Informativo Territoriale (o all'ufficio che detiene i dati), Via del Municipio 1, 35122 Padova
>
> Il/La sottoscritto/a ……………………, nato/a a …………… il ……………, residente a …………… in ……………, codice fiscale ……………,
> email ……………
>
> chiede, ai sensi dell'art. 5, comma 2, del D.Lgs. 33/2013, l'accesso ai seguenti dati e documenti, **ove detenuti
> dall'Amministrazione**, preferibilmente in formato aperto e georeferenziato (GeoPackage, shapefile o GeoJSON;
> tabelle in CSV) o comunque nella forma in cui sono disponibili, con l'indicazione della licenza d'uso
> (preferibilmente CC BY 4.0 o IODL 2.0):
>
> 1. eventuali **rilievi o banche dati della rete stradale** comunale (ad esempio rilievi mobile mapping, banche dati
>    della segnaletica o del patrimonio stradale), limitatamente agli strati vettoriali disponibili su: segnaletica
>    verticale (tipo di cartello e posizione), segnaletica orizzontale (linee, frecce, strisce pedonali, stalli),
>    impianti semaforici, marciapiedi e cordoli, attraversamenti pedonali, alberature, punti luce, fermate e pensiline
>    del trasporto pubblico;
> 2. l'**elenco degli impianti semaforici**, con la posizione dei pali e delle lanterne ove disponibile, e per
>    ciascun impianto il **piano semaforico** (fasi, durate di verde, giallo e tutto rosso, ciclo, coordinamento con
>    gli impianti vicini, priorità al tram SIR1), anche nella forma di schede di impianto o di documentazione tecnica;
> 3. il **grafo stradale** comunale con i sensi di marcia e le corsie riservate al trasporto pubblico e, ove
>    disponibili, i perimetri vigenti delle zone a traffico limitato e delle aree pedonali;
> 4. ove esistente, il **catasto delle strade** (DM 1 giugno 2001), con le larghezze di carreggiate e marciapiedi;
> 5. ove detenuti, i **modelli digitali del terreno e delle superfici** (LiDAR) del territorio comunale.
>
> La richiesta riguarda i soli dati e documenti già in possesso dell'Amministrazione, nella forma in cui sono
> disponibili; non si chiede alcuna nuova elaborazione. Se alcuni dati non sono detenuti, si chiede di indicarlo; se
> sono detenuti da soggetti terzi per conto del Comune (ad esempio il gestore della manutenzione degli impianti
> semaforici), si chiede di indicare a chi rivolgersi.
>
> Non si chiedono immagini né dati personali: se alcuni strati li contengono, si chiede l'accesso parziale agli altri
> dati (art. 5-bis, comma 4, D.Lgs. 33/2013). Se parte dei dati è già pubblicata sul geoportale o sul portale open
> data del Comune, è sufficiente l'indicazione del collegamento.
>
> Si chiede l'invio dei dati all'indirizzo email sopra indicato, oppure la messa a disposizione di un collegamento per
> lo scaricamento.
>
> Si allega copia del documento d'identità.
>
> Distinti saluti
>
> Luogo e data ……………          Nome e cognome ……………

## Cosa farne quando arrivano

* Strati dei rilievi stradali: semafori e lanterne al posto di quelli OSM dove ci sono (tappa M7 del piano,
  `docs/PIANO_MODELLO_CITTA.md`), cartelli e segnaletica orizzontale reali, cordoli per la pianta delle strade.
* Piani semaforici: fasi e durate vere al posto del ciclo di 60 s del gioco (`src/world/traffic.js`).
* Licenza: riportare l'attribuzione nel gioco e nel README come per gli altri dati.

Anche la **Regione del Veneto** ha dati utili non scaricabili dal sito: le tessere del **DTM LiDAR a 5 m** (40 su
Padova; l'elenco c'è, il download risponde "Parametri mancanti"). Si possono chiedere allo stesso modo alla Direzione
Pianificazione Territoriale della Regione (indirizzi sul sito della Regione, area Cartografia).
