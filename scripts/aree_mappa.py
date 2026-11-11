#!/usr/bin/env python3
"""Mappa del gioco divisa in rete e aree (caricamento per aree, docs/ESTENSIONE_LINEE.md sezione 4).

La rete (nodi, archi, nomi, linee, fermate, segnaletica, terreno, impalcati) resta in src/data/padova-map.json, dentro
il bundle del gioco. Edifici, pianta delle strade (le celle da 200 m di street_surfaces) e alberi vanno in un file per
riquadro da LATO metri, public/mappa/aree/<ix>_<iz>.json, che il gioco scarica (src/data/aree.js). La rete elenca le
aree in "aree": {"lato": LATO, "chiavi": [...]}; edifici, celle e alberi restano nella rete come liste vuote.

Un edificio va nell'area del baricentro dei vertici del contorno, una cella nell'area del suo angolo, un albero in
quella del suo punto. Dentro un'area l'ordine è quello della mappa intera; rimessa insieme (load, o il gioco) la mappa
ha le aree in ordine di chiave.

Uso:
    python3 scripts/aree_mappa.py dividi src/data/padova-map.json    # divide una mappa intera (build_map.py lo fa da sé)
    python3 scripts/aree_mappa.py unisci src/data/padova-map.json <mappa intera>.json

Le aree stanno in public/mappa/aree per src/data/padova-map.json, accanto alla mappa in <nome>-aree/ per le altre
(le rigenerazioni di prova non toccano quelle del gioco).
"""
import json
import math
import os
import sys

LATO = 800.0


def aree_dir(path):
    """Cartella delle aree della mappa path."""
    p = os.path.abspath(path)
    tail = os.path.join('src', 'data', 'padova-map.json')
    if p.endswith(os.sep + tail):
        return os.path.join(p[:-len(tail)], 'public', 'mappa', 'aree')
    return p[:-5] + '-aree' if p.endswith('.json') else p + '-aree'


def key(x, z):
    return f'{math.floor(x / LATO)}_{math.floor(z / LATO)}'


def split(data):
    """(rete, {chiave: area}) da una mappa intera; data non cambia."""
    aree = {}

    def area(k):
        return aree.setdefault(k, {'edifici': [], 'celle': [], 'alberi': []})
    for b in data.get('buildings') or []:
        f = b[3]
        n = len(f) // 2
        area(key(sum(f[0::2]) / n, sum(f[1::2]) / n))['edifici'].append(b)
    S = data.get('surfaces')
    if S:
        T = S['tile']
        for c in S.get('cells') or []:
            area(key(c[0] * T, c[1] * T))['celle'].append(c)
        tr = S.get('trees') or []
        for i in range(0, len(tr), 2):
            area(key(tr[i], tr[i + 1]))['alberi'] += tr[i:i + 2]
    rete = dict(data)
    rete['buildings'] = []
    if S:
        rete['surfaces'] = {**S, 'cells': [], 'trees': []}
    order = sorted(aree, key=lambda k: tuple(int(v) for v in k.split('_')))
    rete['aree'] = {'lato': LATO, 'chiavi': order}
    return rete, {k: aree[k] for k in order}


def merge(rete, aree):
    """Mappa intera dalla rete e dalle aree (in ordine di chiave), come la rimette insieme il gioco."""
    m = dict(rete)
    m['buildings'] = list(rete.get('buildings') or [])
    S = rete.get('surfaces')
    if S:
        m['surfaces'] = {**S, 'cells': list(S.get('cells') or []), 'trees': list(S.get('trees') or [])}
    for k in rete['aree']['chiavi']:
        a = aree[k]
        m['buildings'] += a['edifici']
        if S:
            m['surfaces']['cells'] += a['celle']
            m['surfaces']['trees'] += a['alberi']
    del m['aree']
    return m


def write(data, out):
    """Scrive la rete in out e le aree nella loro cartella, togliendo quelle che non ci sono più."""
    rete, aree = split(data)
    d = aree_dir(out)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.endswith('.json') and f[:-5] not in aree:
            os.remove(os.path.join(d, f))
    for k, a in aree.items():
        with open(os.path.join(d, k + '.json'), 'w', encoding='utf-8') as f:
            json.dump(a, f, ensure_ascii=False, separators=(',', ':'))
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(rete, f, ensure_ascii=False, separators=(',', ':'))
    return len(aree)


def load(path):
    """La mappa intera: la rete in path con le sue aree (o la mappa così com'è, se non è divisa)."""
    rete = json.load(open(path, encoding='utf-8'))
    if 'aree' not in rete:
        return rete
    d = aree_dir(path)
    return merge(rete, {k: json.load(open(os.path.join(d, k + '.json'), encoding='utf-8')) for k in rete['aree']['chiavi']})


if __name__ == '__main__':
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == 'dividi':
        n = write(load(path), path)
        print(f'rete in {path}, {n} aree in {aree_dir(path)}')
    elif cmd == 'unisci':
        with open(sys.argv[3], 'w', encoding='utf-8') as f:
            json.dump(load(path), f, ensure_ascii=False, separators=(',', ':'))
