# Issue su GitHub

Il lavoro da fare sta nelle issue di [flevour/bus-simulator](https://github.com/flevour/bus-simulator/issues), dal 12
novembre 2026. Si usa `gh` per tutto. Il repository è pubblico, e quindi anche le issue.

## Termini

- **Area**: un tema del gioco, con la sua label `area:*`.
- **Ticket**: un'issue che una sessione porta a termine e pubblica da sola su `main`, nel suo worktree herdr (ramo
  `ticket/<n>-<nome>`). Le regole sono in [`docs/LAVORO.md`](../LAVORO.md).
- **Checkout principale**: la sessione in `~/Sites/flevour/bus-simulator` che scrive e ordina i ticket, sceglie quali
  far partire, apre e toglie i worktree.
- **Issue madre**: un obiettivo più grande di una sessione, diviso in sotto-issue nell'ordine in cui vanno fatte. Si
  chiude quando sono chiuse tutte.

## Label

| Label | Significato |
|---|---|
| `area:mappa` | strade, fermate, edifici, terreno e dati della mappa |
| `area:tram` | binari, scambi, depositi, turni e mezzo del tram |
| `area:traffico` | auto, pedoni, semafori, precedenze e mezzi automatici |
| `area:linee` | linee dei bus: capolinea, orari e turni |
| `area:veicoli` | bus: modelli, livree, guida e cabina |
| `area:interfaccia` | menu, pannelli, comandi, novità e sondaggio |
| `area:verifiche` | prove, pilota, rapporti di verifica e CI |
| `difetto` / `funzione` | qualcosa che non va / una cosa nuova o da estendere |
| `segnalazione` | chiesto da chi gioca, nel sondaggio o in un messaggio |
| `pronto` | chiaro e piccolo abbastanza: una sessione lo può prendere |
| `da-decidere` | serve una scelta dell'utente prima di lavorarci |
| `urgente` | prima di tutto il resto, si pubblica appena pronto |

Ogni ticket ha un'area, `difetto` o `funzione`, e una tra `pronto` e `da-decidere`. Le issue madri non hanno `pronto`:
si lavora sulle sotto-issue.

## Scrivere un ticket

I ticket li scrive e li ordina il checkout principale. Da lì passano anche le segnalazioni del sondaggio "Richieste dal
gioco" di PostHog. Le sessioni dei ticket aprono un'issue per quello che trovano lavorando: senza `pronto` se non è ancora chiaro,
e senza allargare il ticket che hanno in mano.

- In italiano, con tre sezioni: `## Cosa`, `## Fatto quando` (con le prove), `## Riferimenti` (file, funzioni,
  commit).
- Deve stare in una sessione sola. Se non ci sta, si fa un'issue madre con le sotto-issue
  (`gh issue create --parent <madre>`).
- Il repository è pubblico: le segnalazioni si riassumono ("chi gioca ha chiesto…"), senza nomi, email o testo copiato
  dalle risposte. Le immagini non si caricano: si cita il percorso locale (`<sessione>/images/<n>.png`). Le foto di
  terzi non vanno mai nel repository.
- Le dipendenze si mettono solo quando sono vere: `gh issue create --blocked-by <n>`, oppure dopo
  `gh api --method POST repos/flevour/bus-simulator/issues/<n>/dependencies/blocked_by -F issue_id=<id>`, con l'id
  del database del bloccante (`gh api repos/flevour/bus-simulator/issues/<bloccante> --jq .id`), non il numero.

## Prendere un ticket

Ogni ticket ha il suo worktree e la sua sessione ([`docs/LAVORO.md`](../LAVORO.md), regola 1).

1. Il checkout principale sceglie il prossimo ticket: prima gli `urgente`, poi quelli `pronto` senza assegnatario,
   senza mettere in parallelo due ticket che toccano le stesse cose (regola 10 di `docs/LAVORO.md`):
   ```bash
   gh issue list -l urgente -s open
   gh issue list -l pronto -s open --search "no:assignee" --json number,title,labels
   ```
   Si salta un ticket che ha un bloccante aperto, cioè se
   `gh api repos/flevour/bus-simulator/issues/<n> --jq .issue_dependencies_summary.blocked_by` è maggiore di 0. Tra
   le sotto-issue di una madre vale il suo ordine
   (`gh api repos/flevour/bus-simulator/issues/<madre>/sub_issues --jq '.[].number'`); per il resto, il numero più
   basso.
2. La sessione del ticket lo prende prima di lavorarci:
   ```bash
   gh issue edit <n> --add-assignee @me
   gh issue comment <n> --body "Preso nel worktree ticket/<n>-<nome>."
   ```
3. Si lavora come dice `docs/LAVORO.md` (rebase, build, prove, push su `main`). Il commit che finisce il lavoro ha in
   fondo `Closes #<n>`, e al push su `main` GitHub chiude l'issue. I commit intermedi hanno `Refs #<n>`.
4. Prima del commit finale si scrive nell'issue quello che serve a chi viene dopo: funzioni di altre aree toccate,
   soglie cambiate, cose lasciate fuori (che diventano issue nuove).
5. Chi si ferma a metà scrive un commento con lo stato e toglie l'assegnazione
   (`gh issue edit <n> --remove-assignee @me`); il worktree resta finché qualcuno riprende il ticket.
6. A ticket chiuso il checkout principale toglie il worktree (regola 9 di `docs/LAVORO.md`).

Un ticket `da-decidere` non si prende. La scelta la fa l'utente; il checkout principale la scrive nell'issue e cambia
la label in `pronto`.

## Cosa resta com'era

- `src/data/novita.js`: una riga per ogni modifica che si vede in gioco, nello stesso commit della modifica.
- [`IDEE.md`](../../IDEE.md) resta l'elenco delle idee non ancora pronte per diventare un ticket. La sezione "Fatto"
  non si aggiorna più: la storia sta nelle issue chiuse e nei commit.
