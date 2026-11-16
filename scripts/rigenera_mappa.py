#!/usr/bin/env python3
"""Rigenera la mappa del gioco dai dati in data/, nell'ambiente fissato: Linux, Python 3.12 e le librerie di
scripts/requirements-mappa.txt.

La mappa dipende da tre cose fuori dagli script. Dalla versione delle librerie: con uno shapely diverso cambiano i
poligoni di un centinaio di aree. Dal sistema: con le stesse librerie macOS dà 115 celle e 20 aree diverse da Linux
(la libreria matematica non è la stessa), mentre Linux amd64 e arm64 danno gli stessi file. Dal feed GTFS, che cambia
ogni giorno. Qui sono fissate tutte e tre: le librerie nel file di lock, il sistema nell'immagine Docker di
scripts/rigenera_mappa.sh, il feed nella copia data/gtfs-biv.zip (scaricata il 9 novembre 2026). Così la mappa nel
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
"""
import argparse
import filecmp
import importlib.metadata
import json
import os
import re
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON = (3, 12)
LOCK = os.path.join('scripts', 'requirements-mappa.txt')
GTFS = os.path.join('data', 'gtfs-biv.zip')
MAPPA = os.path.join('src', 'data', 'padova-map.json')
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

    with tempfile.TemporaryDirectory(prefix='mappa-') as tmp:
        gtfs = args.gtfs
        if not gtfs:
            gtfs = os.path.join(tmp, 'gtfs')
            with zipfile.ZipFile(GTFS) as z:
                z.extractall(gtfs)
        uscita = os.path.join(tmp, 'padova-map.json') if args.controlla else (args.uscita or MAPPA)
        build_map.main(os.path.join('data', 'osm-padova.json'), gtfs, uscita, *[os.path.join('data', f) for f in DATI])
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
