# Corsie di lavoro in parallelo

I lavori di [`IDEE.md`](../IDEE.md) procedono in parallelo, ognuno in un worktree herdr con il suo ramo locale
(lo space `bus-simulator` raccoglie il checkout principale e i worktree). Ogni corsia pubblica su `main` con commit
piccoli, come il resto del progetto. Questo file dice chi tocca cosa; i brief delle corsie aperte sono in fondo.

## Regole per tutte le corsie

1. Ramo locale `corsia/<nome>` partito da `origin/main`, worktree in `~/.herdr/worktrees/bus-simulator/corsia-<nome>`.
   Niente rami remoti né pull request.
2. Prima di ogni commit `git status -sb`; commit con `~/.claude/custom-bins/committer "messaggio" file...`.
3. Per pubblicare:
   ```bash
   git fetch origin && GIT_EDITOR=: git rebase origin/main
   npm run build            # e i test della corsia verifiche, quando ci sono
   git push origin HEAD:main
   ```
4. Conflitti nel rebase:
   - `src/data/novita.js` e `IDEE.md`: si tengono le righe di tutti; in `novita.js` la riga nuova va in cima con
     `n` successivo all'ultimo di `main`;
   - `src/data/padova-map.json` (solo nella corsia della mappa): si prende quello di `main` e si rigenera.
5. Ognuno il suo `node_modules` (`npm install` nel worktree): la cache di Vite sta in `node_modules/.vite` e due
   server che la condividono si pestano i piedi.
6. Porte fisse per corsia (tabella sotto). Nel worktree non c'è `.env` e non va creato: le chiavi di PostHog si
   passano sulla riga di comando. In dev `src/posthog.js` si ferma se mancano, quindi valori finti; nel build
   vuote, così le prove non mandano eventi:
   ```bash
   VITE_POSTHOG_KEY=prova VITE_POSTHOG_HOST=http://localhost:9 npm run dev -- --port <dev> --strictPort
   VITE_POSTHOG_KEY= VITE_POSTHOG_HOST= npm run build && npx vite preview --port <preview>
   ```
7. Dopo modifiche a strade, fermate o edifici: percorsi dei bus liberi e fermate raggiungibili (vedi `CLAUDE.md`).
8. A lavoro finito si sposta la voce in "Fatto" in `IDEE.md` e si aggiorna questo file (corsia chiusa o prossimo
   lavoro).

## File condivisi

| File | Chi lo modifica | Perché |
|---|---|---|
| `src/data/padova-map.json` | solo la corsia della mappa | una riga sola da 12 MB: due rigenerazioni non si uniscono |
| `scripts/build_map.py`, `scripts/street_surfaces.py` | solo la corsia della mappa | producono la mappa; chi ha bisogno di dati nuovi li scrive in un file a parte o li chiede a questa corsia |
| `src/world/city.js` | tutti, ognuno nelle sue funzioni | il caricamento per aree (onda 3) lo riscrive: parte quando nessun'altra corsia ci lavora |
| `src/world/traffic.js` | `Traffic`/`Walkers` al traffico, `TramSim`/`TramSignals` al tram | stesse classi in due corsie = conflitti |
| `src/main.js` | tutti, ognuno nelle sue funzioni | |

## Corsie aperte (onda 1, dal 9 novembre 2026)

| Corsia | Workspace herdr | Porte dev / preview |
|---|---|---|
| checkout principale | `bus-simulator` | 5173 / 4173 |
| `verifiche` | `verifiche` | 5174 / 4174 |
| `mappa` | `mappa` | 5175 / 4175 |
| `tram-reti` | `tram-reti` | 5176 / 4176 |
| `segnalazioni` | `segnalazioni` | 5177 / 4177 |

### verifiche

Obiettivo: un controllo automatico che ogni corsia lancia prima del push, e lo stesso in CI.

- Test nel browser headless con Playwright (flag e uso di `window.__game` in `CLAUDE.md`): il gioco si carica, una
  corsa parte con `startMission()`, `sim()` avanza senza errori in console. Playwright come dipendenza di sviluppo
  del progetto, con uno script `npm test`.
- Un giro guidato in headless: il gioco non ha un autopilota, va scritto nel test (sterzo verso il punto successivo
  del percorso con `keys`, oppure comandi diretti sul bus) e deve arrivare alla fermata successiva su alcune linee
  campione, bus e tram.
- Rapporto di verifica sulla mappa (sezione 6.1 di [`PIANO_MODELLO_CITTA.md`](PIANO_MODELLO_CITTA.md)) come script a
  parte che legge `src/data/padova-map.json`: pali e paline sul marciapiede, edifici fuori dalle strade, percorsi
  dei bus liberi, fermate raggiungibili. Esce con errore sopra soglie fissate sui valori di oggi.
- Workflow GitHub che lancia build e test a ogni push su `main`.
- Non tocca il codice del gioco. File: `tests/`, `scripts/verifica_mappa.py`, `.github/workflows/`, `package.json`.
- Finito il lavoro, aggiunge in questo file il comando di test al punto 3 delle regole.

### mappa

Unica corsia che rigenera la mappa. Primo lavoro: **corsie e segnaletica orizzontale** (IDEE, prossimi passi 4;
piano del modello della città, prossimi passi 1).

- Dai tag OSM già nell'export (`lanes` su ~5.400 vie, `lanes:forward/backward`, `overtaking`, `turn:lanes` su 40,
  `lanes:psv`/`bus:lanes`): numero di corsie e linee divisorie sulla carreggiata misurata, mezzeria continua con
  `overtaking=no`, frecce a terra, corsie dei bus gialle con la scritta BUS.
- File: `scripts/build_map.py`, `scripts/street_surfaces.py`, la parte delle strade di `src/world/city.js`,
  `src/data/padova-map.json`. Rigenerazione con i comandi di `CLAUDE.md` (venv con `shapely` e `pyarrow`).
- Dopo, in quest'ordine, nella stessa corsia: fermate del tram dai nodi `tram_stop`, dossi (`traffic_calming`) e
  `highway=busway`; capolinea con tratti GTFS senza strada; le 30 fermate senza palina; i 177 tratti A-B-A;
  zona Plebiscito; cavalcavia e posizione dei fiumi; correzioni del piazzale della stazione segnalate dalla corsia
  `segnalazioni`. Svolte a sinistra protette ai semafori (`TrafficLights` in `traffic.js`) quando ci sono le corsie.
- Le corsie preferenziali vere nel traffico (auto che non le usano) spettano alla corsia del traffico (onda 2).

### tram-reti

SIR3 e SIR2, tappe 1 e 2 del piano in [`linee-tram-nuove.md`](linee-tram-nuove.md).

- Tappa 1: script sulla base di `scripts/tram_percorsi.py` che scrive `data/tram-linee-nuove.json` (percorso per
  linea e verso sui binari, fermate in ordine con la progressiva, moduli, orario generato).
- Tappa 2: in `src/tram/tram.js` una sede per linea (`city.tramTracks[id]`, con `city.tramTrack` che resta il SIR1),
  poi il grafo dei binari con rami e scambi per i due anelli della stazione e i tratti in comune. `TramSim` e
  `TramSignals` in `traffic.js`, la parte del tram di `main.js`, `mission.js` e `buildTramway` in `city.js`.
- Nel menu (deciso il 9 novembre): SIR2 e SIR3 nello stesso elenco del SIR1, con un'indicazione che le distingue
  (linea in costruzione); la linea 10 resta tra gli autobus.
- Non tocca `build_map.py` né `padova-map.json`: la sede del tram nella pianta delle strade e l'area di
  Voltabarozzo (tappe 3 e 4) aspettano la corsia `mappa` o il caricamento per aree. Fino ad allora il SIR3 si guida
  fino a Cornaro come "tratto in città".
- Dopo questa corsia viene `tram-turni` (onda 2): turni del tram e deposito della Guizza, che usano gli scambi del
  grafo.

### segnalazioni

Le richieste arrivate da chi gioca (IDEE, prossimi passi 5).

- Navigatore sulle linee 22, 13 e 25: riprovare dopo la correzione della posizione lungo il percorso e correggere
  quello che resta (`mission.js` `navInfo`, `routes.js`).
- Passeggeri anche sugli altri autobus: gente a bordo dei bus automatici e alle fermate dove si fermano
  (`src/world/buses.js`).
- Piazzale della stazione: controllare linea per linea fermata, corsia e verso di partenza e arrivo dei bus, propri
  e automatici. Le correzioni al codice del gioco qui; quelle ai dati della mappa vanno scritte come richiesta in
  questo file, sezione `mappa`.
- Non tocca `build_map.py` né `padova-map.json`.

## Onde successive

Onda 2, quando le corsie dell'onda 1 si chiudono:

- `traffico`: auto che rispettano STOP, precedenze e rotonde; pedoni sulle strisce con precedenza; penalità per chi
  non dà precedenza; traffico più lento con pioggia e nebbia; corsie preferenziali vere (dopo le corsie di `mappa`).
- `tram-turni`: turni del tram e deposito della Guizza, binario tronco, semafori del tram coordinati (dopo
  `tram-reti`).
- `esplorazione`: panoramica e giro libero senza mezzo, poi l'ortofoto AGEA (M5).
- `guida`: gamepad, bus elettrico con ricarica, telecamera della porta posteriore, specchietti.

Onda 3, da sola su `city.js`: `mappa-aree` al posto di `mappa`. Caricamento per aree (sezione 4 di
[`ESTENSIONE_LINEE.md`](ESTENSIONE_LINEE.md)), poi le linee fino ai capolinea veri (vale anche per la segnalazione
"mappa più grande"), poi le tappe 3 e 4 del tram e l'aggiornamento automatico del GTFS.

Per aprire una corsia (da `~/Sites/flevour/bus-simulator`):

```bash
herdr worktree create --cwd ~/Sites/flevour/bus-simulator --branch corsia/<nome> --base origin/main --label <nome> --no-focus
```

poi `npm install` nel pannello del worktree e una riga nella tabella delle corsie aperte.
