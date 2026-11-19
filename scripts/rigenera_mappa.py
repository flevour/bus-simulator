#!/usr/bin/env python3
"""Rigenera la mappa del gioco dai dati in data/, nell'ambiente fissato: Linux, Python 3.12 e le librerie di
scripts/requirements-mappa.txt.

La mappa dipende da tre cose fuori dagli script. Dalla versione delle librerie: con uno shapely diverso cambiano i
poligoni di un centinaio di aree. Dal sistema: con le stesse librerie macOS dà binari del tram diversi di un
millimetro e una decina di raccordi (la libreria matematica non è la stessa; fino a #139 anche 115 celle della pianta e
20 aree). Anche Linux arm64 e amd64 non sono uguali: il programma lineare dei cavalcavia (HiGHS) cambia le ultime cifre
tra le due, e il 19 novembre (#125) un valore di edgeH a 924,5 mm usciva 925 su arm64 e 924 in CI. Dal feed GTFS, che
cambia ogni giorno. Qui sono fissate tutte: le librerie nel file di lock, il sistema e l'architettura (Linux amd64, come
la CI; sul Mac Docker la emula) nell'immagine Docker di scripts/rigenera_mappa.sh, il feed nella copia
data/gtfs-biv.zip (scaricata il 9 novembre 2026). Così la mappa nel
repository è quella che questo comando produce, su ogni macchina, e una differenza dopo una modifica viene dalla
modifica.

Uso, da qualsiasi sistema con Docker (gli argomenti passano a questo script):
    scripts/rigenera_mappa.sh                # riscrive src/data/padova-map.json e public/mappa/aree/
    scripts/rigenera_mappa.sh --controlla    # rigenera in una cartella temporanea e confronta col repository
    scripts/rigenera_mappa.sh --gtfs <cartella>   # con un feed GTFS scaricato a parte, già scompattato (nel repository)
    scripts/rigenera_mappa.sh --uscita <file>     # scrive lì la rete, e le aree accanto in <nome>-aree/

Su Linux anche senza Docker:
    uv run --no-project --python 3.12 --with-requirements scripts/requirements-mappa.txt scripts/rigenera_mappa.py
oppure python3.12 -m venv <venv> && <venv>/bin/pip install --require-hashes -r scripts/requirements-mappa.txt.

Per cambiare versione delle librerie: scripts/requirements-mappa.in, poi
    uv pip compile --universal --python-version 3.12 --generate-hashes scripts/requirements-mappa.in -o scripts/requirements-mappa.txt
e la mappa rigenerata va nello stesso commit. Per cambiare feed: lo zip nuovo in data/gtfs-biv.zip, le date di
riferimento FER_DATE e FES_DATE in scripts/build_gtfs.py, e la mappa rigenerata nello stesso commit.

--controlla esce con 1 se la mappa rigenerata non è quella del repository, ed elenca le chiavi della rete e le aree
diverse. Lo lancia il job "rigenera" di .github/workflows/verifiche.yml a ogni push su main.

Alla fine dice quante aree e celle della pianta sono cambiate rispetto alla mappa di prima (quella che c'era nel file
d'uscita, o quella del repository con --controlla) e a che distanza dai dati cambiati (scripts/localita.py, #139).

--localita è la prova della località (#139): rigenera con i cambi di data/localita.json (la larghezza di un arco, la
quota di un nodo), in una cartella temporanea o in --uscita, e confronta con la mappa del repository: oltre il raggio
dichiarato da ogni cambio la mappa deve restare uguale byte per byte, tranne i casi di data/eccezioni/localita.json
(--aggiorna riscrive l'elenco). La posa dell'arredo sulla mappa così ottenuta si controlla dopo, fuori da qui:
node scripts/posa_arredo.mjs --localita --mappa <uscita>. Lo lancia il job "localita" di verifiche.yml.
"""
import argparse
import filecmp
import importlib.metadata
import json
import os
import platform
import re
import shutil
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON = (3, 12)
LOCK = os.path.join('scripts', 'requirements-mappa.txt')
GTFS = os.path.join('data', 'gtfs-biv.zip')
MAPPA = os.path.join('src', 'data', 'padova-map.json')
LOCALITA = os.path.join('data', 'localita.json')
# nell'ordine di build_map.main, dopo OSM, GTFS e uscita
DATI = ['overture-buildings-padova.parquet', 'osm-padova-nodes.json', 'osm-padova-tram.json', 'misure-strade.json',
        'dbgt-volumi.json', 'dtm-padova.json', 'dbgt-verde.json', 'dbgt-strade.json', 'osm-fermate.json',
        'osm-corridoio.json']


def versioni_del_lock():
    out = {}
    for riga in open(os.path.join(ROOT, LOCK), encoding='utf-8'):
        m = re.match(r'([A-Za-z0-9_.-]+)==(\S+)', riga)
        if m:
            out[m.group(1).lower()] = m.group(2)
    return out


def controlla_ambiente():
    """Errori se sistema, Python o librerie non sono quelli fissati: con altri la mappa esce diversa."""
    errori = []
    if sys.platform != 'linux':
        errori.append('sistema %s invece di linux (da qui: scripts/rigenera_mappa.sh, che passa da Docker)' % sys.platform)
    if platform.machine().lower() not in ('x86_64', 'amd64'):
        errori.append('architettura %s invece di x86_64, quella della CI (scripts/rigenera_mappa.sh la chiede a Docker)'
                      % platform.machine())
    if sys.version_info[:2] != PYTHON:
        errori.append('Python %d.%d invece di %d.%d' % (sys.version_info[:2] + PYTHON))
    for nome, attesa in sorted(versioni_del_lock().items()):
        try:
            trovata = importlib.metadata.version(nome)
        except importlib.metadata.PackageNotFoundError:
            trovata = None
        if trovata != attesa:
            errori.append('%s %s invece di %s' % (nome, trovata or 'assente', attesa))
    return errori


def confronta(rete, aree, conto, rete_repo, aree_repo, conto_repo):
    """Righe che dicono in cosa la mappa rigenerata (rete, aree, conto delle aree) differisce da quella del repository."""
    righe = []
    if not filecmp.cmp(rete, rete_repo, shallow=False):
        a, b = json.load(open(rete, encoding='utf-8')), json.load(open(rete_repo, encoding='utf-8'))
        for k in sorted(set(a) | set(b)):
            if a.get(k) == b.get(k):
                continue
            va, vb = a.get(k), b.get(k)
            if k == 'surfaces' and isinstance(va, dict) and isinstance(vb, dict):
                for q in sorted(set(va) | set(vb)):
                    if va.get(q) == vb.get(q):
                        continue
                    if q == 'cells' and len(va[q]) == len(vb[q]):
                        n = sum(1 for x, y in zip(va[q], vb[q]) if x != y)
                        righe.append('rete: surfaces.cells, %d celle diverse su %d' % (n, len(va[q])))
                    else:
                        righe.append('rete: surfaces.%s' % q)
            elif isinstance(va, list) and isinstance(vb, list) and len(va) == len(vb):
                n = sum(1 for x, y in zip(va, vb) if x != y)
                righe.append('rete: %s, %d elementi diversi su %d' % (k, n, len(va)))
            else:
                righe.append('rete: %s' % k)
        if not righe:
            righe.append('rete: stessi dati, scritti in modo diverso')
    if not filecmp.cmp(conto, conto_repo, shallow=False):
        righe.append('conto delle aree: %s' % os.path.relpath(conto_repo, ROOT))
    nuove, repo = set(os.listdir(aree)), set(os.listdir(aree_repo))
    solo_nuove, solo_repo = sorted(nuove - repo), sorted(repo - nuove)
    diverse = sorted(f for f in nuove & repo
                     if not filecmp.cmp(os.path.join(aree, f), os.path.join(aree_repo, f), shallow=False))
    for nome, elenco in (('diverse', diverse), ('solo nella rigenerata', solo_nuove), ('solo nel repository', solo_repo)):
        if elenco:
            righe.append('aree %s: %d su %d (%s%s)' % (nome, len(elenco), len(nuove | repo), ' '.join(elenco[:12]),
                                                     ' ...' if len(elenco) > 12 else ''))
    return righe


def main():
    ap = argparse.ArgumentParser(description='Rigenera la mappa dai dati in data/ con le librerie fissate.')
    ap.add_argument('--controlla', action='store_true',
                    help='rigenera in una cartella temporanea e confronta con la mappa del repository')
    ap.add_argument('--gtfs', help='cartella di un feed GTFS scompattato, al posto di ' + GTFS)
    ap.add_argument('--uscita', help='file della rete, al posto di ' + MAPPA)
    ap.add_argument('--localita', action='store_true',
                    help='prova della località: rigenera con i cambi di %s e controlla che la mappa cambi solo vicino a '
                         'ognuno (scripts/localita.py)' % LOCALITA)
    ap.add_argument('--aggiorna', action='store_true', help='con --localita, riscrive data/eccezioni/localita.json')
    ap.add_argument('--altre-versioni', action='store_true',
                    help='prosegue anche con sistema, Python o librerie diversi da quelli fissati (per prove: la mappa esce diversa)')
    args = ap.parse_args()

    errori = controlla_ambiente()
    if errori:
        print('Ambiente diverso da %s: %s.' % (LOCK, '; '.join(errori)), file=sys.stderr)
        if not args.altre_versioni:
            print('Il comando giusto è scripts/rigenera_mappa.sh (dettagli in testa a scripts/rigenera_mappa.py).', file=sys.stderr)
            return 2

    os.chdir(ROOT)
    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
    import aree_mappa
    import build_map
    import localita

    prova = None
    if args.localita:
        prova = json.load(open(LOCALITA, encoding='utf-8'))
        build_map.PROVA_LOCALITA = prova['cambi']
    with tempfile.TemporaryDirectory(prefix='mappa-') as tmp:
        gtfs = args.gtfs
        if not gtfs:
            gtfs = os.path.join(tmp, 'gtfs')
            with zipfile.ZipFile(GTFS) as z:
                z.extractall(gtfs)
        uscita = args.uscita or (os.path.join(tmp, 'padova-map.json') if args.controlla or args.localita else MAPPA)
        os.makedirs(os.path.dirname(os.path.abspath(uscita)), exist_ok=True)
        # la mappa di prima, per dire alla fine cosa è cambiato e dove: quella del repository per --controlla e
        # --localita, altrimenti quella che c'era nel file d'uscita (copiata, la build la sovrascrive)
        prima = MAPPA if args.controlla or args.localita else None
        if prima is None and os.path.exists(uscita) and os.path.isdir(aree_mappa.aree_dir(uscita)):
            prima = os.path.join(tmp, 'prima', 'padova-map.json')
            os.makedirs(os.path.dirname(prima))
            shutil.copy(uscita, prima)
            shutil.copytree(aree_mappa.aree_dir(uscita), aree_mappa.aree_dir(prima))
        build_map.main(os.path.join('data', 'osm-padova.json'), gtfs, uscita, *[os.path.join('data', f) for f in DATI])
        sys.stdout.flush()
        if args.localita:
            righe, errori = localita.controlla(prima, uscita, prova, args.aggiorna)
            print('\nProva della località (%s): rispetto a %s' % (LOCALITA, MAPPA))
            print('\n'.join(righe))
            if errori:
                print('\n'.join(errori), file=sys.stderr)
                return 1
            print('Fuori dal raggio dei cambi la mappa è quella del repository.')
            return 0
        if prima:
            print('\nCambiato rispetto alla mappa di prima (%s):' % ('repository' if args.controlla else uscita))
            print('\n'.join(localita.rapporto(prima, uscita)[0]))
        if not args.controlla:
            return 0
        righe = confronta(uscita, aree_mappa.aree_dir(uscita), aree_mappa.conto_file(uscita),
                          MAPPA, aree_mappa.aree_dir(MAPPA), aree_mappa.conto_file(MAPPA))
    sys.stdout.flush()
    if righe:
        print('\nLa mappa rigenerata è diversa da quella del repository:', file=sys.stderr)
        for r in righe:
            print('  ' + r, file=sys.stderr)
        print('Chi ha cambiato script o dati della mappa la rigenera con scripts/rigenera_mappa.py e la pubblica '
              'nello stesso commit.', file=sys.stderr)
        return 1
    print('\nLa mappa rigenerata è quella del repository.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
