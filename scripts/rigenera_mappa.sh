#!/bin/sh
# Rigenera la mappa nell'ambiente di riferimento: Linux, Python 3.12 e le librerie di scripts/requirements-mappa.txt,
# dentro l'immagine Docker fissata qui sotto (la stessa del job "rigenera" di .github/workflows/verifiche.yml).
# Su macOS, con le stesse librerie, la mappa esce diversa nei binari del tram (di un millimetro) e in qualche raccordo
# (la libreria matematica del sistema non è la stessa): da lì si passa sempre da qui. Anche Linux arm64 non dà la mappa
# della CI (amd64): il programma lineare dei cavalcavia cambia le ultime cifre, e un valore a mezzo millimetro va da una
# parte o dall'altra (#125). Per questo il container è sempre linux/amd64: sul Mac Docker lo emula (16 minuti il 19
# novembre, da solo in Docker; con un altro container che occupa 3 GB l'emulazione può finire senza memoria, uscita 137). Gli argomenti sono quelli di scripts/rigenera_mappa.py.
#
#   scripts/rigenera_mappa.sh               # riscrive src/data/padova-map.json e public/mappa/aree/
#   scripts/rigenera_mappa.sh --controlla   # rigenera a parte e confronta con la mappa del repository
#   CAVALCAVIA=registro scripts/rigenera_mappa.sh   # riscrive anche i campi di data/cavalcavia.json che vengono dalla rete
#
#   scripts/rigenera_mappa.sh --localita    # prova della località (#139): rigenera con i cambi di data/localita.json in
#                                           # .localita/ e controlla che mappa e posa dell'arredo cambino solo vicino
#
# Alla fine confronta la posa dell'arredo (npm run posa) con la mappa nuova: vedi in fondo.
#
# Per cambiare immagine: docker buildx imagetools inspect python:3.12-slim (il Digest dell'indice, che vale per amd64 e
# arm64), qui e nel workflow, con la mappa rigenerata nello stesso commit.
set -e
# la prova della località scrive la mappa con i cambi in .localita/ (fuori dal repository), dove la posa la ritrova
case " $* " in *" --localita "*) case " $* " in *" --uscita "*) ;; *) set -- "$@" --uscita .localita/padova-map.json ;; esac ;; esac
IMMAGINE='python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b'
cd "$(dirname "$0")/.."
docker run --rm --platform linux/amd64 -v "$PWD":/repo -w /repo -e PYTHONDONTWRITEBYTECODE=1 -e CAVALCAVIA -v bus-simulator-pip:/root/.cache/pip "$IMMAGINE" sh -c '
  pip install -q --disable-pip-version-check --root-user-action=ignore --require-hashes -r scripts/requirements-mappa.txt &&
  exec python scripts/rigenera_mappa.py "$@"' sh "$@"
# La posa dell'arredo (semafori, pali, paline: scripts/posa_arredo.mjs, #109) segue la mappa: dopo una rigenerazione si
# rifà, fuori dal contenitore, con Node. Qui solo il confronto: se la posa cambia lo script dice dove, e il file si
# riscrive dichiarando la zona (npm run posa -- --zona X,Z,R, o --tutta)
case " $* " in *" --controlla "*) exit 0 ;; esac
case " $* " in *" --localita "*)
  while [ "$1" != "--uscita" ]; do shift; done
  echo "Posa dell'arredo sulla mappa della prova ($2):"
  exec node scripts/posa_arredo.mjs --localita --mappa "$2" ;;
esac
echo "Posa dell'arredo sulla mappa rigenerata:"
node scripts/posa_arredo.mjs || echo "La posa dell'arredo è cambiata: src/data/padova-arredo.json va riscritto nello stesso commit della mappa."
# La domanda di traffico (scripts/domanda.py, #116) segue la rete e gli edifici: solo libreria standard, lo stesso file
# sul Mac e in Linux. Se cambia si riscrive qui, e va nello stesso commit della mappa
echo "Domanda di traffico sulla mappa rigenerata:"
python3 scripts/domanda.py --controlla || { python3 scripts/domanda.py && echo "src/data/padova-domanda.json riscritto: va nello stesso commit della mappa."; }
