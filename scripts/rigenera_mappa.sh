#!/bin/sh
# Rigenera la mappa nell'ambiente di riferimento: Linux, Python 3.12 e le librerie di scripts/requirements-mappa.txt,
# dentro l'immagine Docker fissata qui sotto (la stessa del job "rigenera" di .github/workflows/verifiche.yml).
# Su macOS, con le stesse librerie, la mappa esce diversa in un centinaio di celle (la libreria matematica del sistema
# non è la stessa): da lì si passa sempre da qui. Gli argomenti sono quelli di scripts/rigenera_mappa.py.
#
#   scripts/rigenera_mappa.sh               # riscrive src/data/padova-map.json e public/mappa/aree/
#   scripts/rigenera_mappa.sh --controlla   # rigenera a parte e confronta con la mappa del repository
#   CAVALCAVIA=registro scripts/rigenera_mappa.sh   # riscrive anche i campi di data/cavalcavia.json che vengono dalla rete
#
# Per cambiare immagine: docker buildx imagetools inspect python:3.12-slim (il Digest dell'indice, che vale per amd64 e
# arm64), qui e nel workflow, con la mappa rigenerata nello stesso commit.
set -e
IMMAGINE='python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b'
cd "$(dirname "$0")/.."
exec docker run --rm -v "$PWD":/repo -w /repo -e PYTHONDONTWRITEBYTECODE=1 -e CAVALCAVIA -v bus-simulator-pip:/root/.cache/pip "$IMMAGINE" sh -c '
  pip install -q --disable-pip-version-check --root-user-action=ignore --require-hashes -r scripts/requirements-mappa.txt &&
  exec python scripts/rigenera_mappa.py "$@"' sh "$@"
