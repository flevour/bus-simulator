#!/usr/bin/env python3
"""Località della mappa (#139): quello che la build calcola cambia solo vicino al dato cambiato.

Confronta due mappe divise in rete e aree (scripts/aree_mappa.py). Prima trova dove sono cambiati i dati che entrano
nella pianta delle strade: nodi e archi della rete (larghezza, classe, flag), quote dei nodi e degli archi, archi
percorsi dalle linee, fermate, binari, corsie, cavalcavia. Poi conta quello che la build ne ricava, per distanza dal
dato cambiato più vicino: celle della pianta nella rete (carreggiate e isole) e nelle aree (marciapiedi e verde),
edifici e alberi delle aree, asfalto e impalcati in quota, stalli e corsie strette dagli stalli, raccordi agli
incroci, terreno.

Lo usano:
* scripts/rigenera_mappa.py, a fine rigenerazione: quante aree e celle sono cambiate e a che distanza dal dato
  cambiato (la mappa di prima è quella che c'era su disco);
* scripts/rigenera_mappa.py --localita, la prova della località (job "localita" di .github/workflows/verifiche.yml):
  la build con i dati cambiati di data/localita.json, confrontata con la mappa del repository; quello che cambia oltre
  il raggio dichiarato è un caso, contro l'elenco data/eccezioni/localita.json (scripts/eccezioni.py).

Uso:
    python3 scripts/localita.py <prima>.json <dopo>.json             # rapporto (dati cambiati trovati da sé)
    python3 scripts/localita.py <prima>.json <dopo>.json --punto X,Z # distanze da un punto dato (ripetibile)

Solo libreria standard.
"""
import argparse
import base64
import json
import math
import os
import sys
from collections import Counter, defaultdict

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RADICE, 'scripts'))
import aree_mappa  # noqa: E402

PASSO_ARCHI = 8  # valori per arco in "edges"
BANDE = (200, 500, 1000, 2000)  # m: bande di distanza del rapporto
# uscite della build, nell'ordine del rapporto
USCITE = ('celle della rete', 'celle delle aree', 'edifici', 'alberi', 'asfalto in quota', 'impalcati', 'stalli',
          'corsie strette', 'raccordi', 'terreno')


def carica(path):
    """(rete, {chiave: area}) della mappa in path."""
    rete = json.load(open(path, encoding='utf-8'))
    if 'aree' not in rete:
        rete, aree = aree_mappa.split(rete)
        return rete, aree
    d = aree_mappa.aree_dir(path)
    return rete, {k: json.load(open(os.path.join(d, k + '.json'), encoding='utf-8')) for k in rete['aree']['chiavi']}


def _nodo(rete, n):
    v = rete['nodes']
    return (v[2 * n], v[2 * n + 1]) if 0 <= n and 2 * n + 1 < len(v) else None


def _capi(rete, k):
    """(punto a, punto b) dell'arco k: gli archi si confrontano dai loro capi, non dall'indice, che cambia per tutti
    gli archi dopo uno aggiunto o tolto."""
    e = rete['edges'][k * PASSO_ARCHI:k * PASSO_ARCHI + 2]
    return (_nodo(rete, e[0]), _nodo(rete, e[1])) if len(e) == 2 else (None, None)


def _medio(capi):
    a, b = capi
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) if a and b else a or b


def _coppie(f):
    return [(f[i], f[i + 1]) for i in range(0, len(f) - 1, 2)]


def _js(x):
    return json.dumps(x, separators=(',', ':'))


def _solo_da_una_parte(a, b):
    """Elementi di due Counter che ci sono da una parte sola (con le ripetizioni)."""
    return list(((a - b) + (b - a)).elements())


def _per_arco(rete, nome, passo=None):
    """Counter di (capi dell'arco, resto della riga in JSON) per le righe di rete[nome] che cominciano con un arco (o
    piatte, a passo fisso)."""
    lista = rete.get(nome) or []
    righe = [lista[i:i + passo] for i in range(0, len(lista), passo)] if passo else lista
    return Counter((_capi(rete, r[0]), _js(r[1:])) for r in righe)


def dati_cambiati(A, B):
    """[(x, z, cosa)]: dove sono cambiati i dati che entrano nella pianta delle strade, tra le reti A e B."""
    out = []
    na = Counter(_coppie(A['nodes']))
    nb = Counter(_coppie(B['nodes']))
    out += [(x, z, 'nodo') for x, z in _solo_da_una_parte(na, nb)]
    arch = lambda R: Counter((_capi(R, k), _js(R['edges'][k * PASSO_ARCHI + 2:(k + 1) * PASSO_ARCHI])) for k in range(len(R['edges']) // PASSO_ARCHI))
    out += [(*_medio(c), 'arco') for c, _r in _solo_da_una_parte(arch(A), arch(B))]
    quote = lambda R: Counter((_nodo(R, n), h) for n, h in R.get('nodeH') or [])
    out += [(*p, 'quota di un nodo') for p, _h in _solo_da_una_parte(quote(A), quote(B)) if p]
    for nome, passo, cosa in (('edgeH', None, 'quota di un arco'), ('lanes', 2, 'corsie di un arco')):
        out += [(*_medio(c), cosa) for c, _r in _solo_da_una_parte(_per_arco(A, nome, passo), _per_arco(B, nome, passo)) if _medio(c)]
    # archi percorsi dalle linee: quelli che una variante prende o lascia
    la = {l['id']: l for l in A.get('lines') or []}
    lb = {l['id']: l for l in B.get('lines') or []}
    for lid in set(la) | set(lb):
        va = (la.get(lid) or {}).get('variants') or []
        vb = (lb.get(lid) or {}).get('variants') or []
        for i in range(max(len(va), len(vb))):
            pa = Counter((_nodo(A, p), _nodo(A, q)) for p, q in zip(va[i]['nodes'], va[i]['nodes'][1:])) if i < len(va) else Counter()
            pb = Counter((_nodo(B, p), _nodo(B, q)) for p, q in zip(vb[i]['nodes'], vb[i]['nodes'][1:])) if i < len(vb) else Counter()
            out += [(*_medio(c), 'percorso della linea ' + str(lid)) for c in _solo_da_una_parte(pa, pb) if _medio(c)]
    fa, fb = Counter(_js(s) for s in A.get('stops') or []), Counter(_js(s) for s in B.get('stops') or [])
    out += [(s[0], s[1], 'fermata') for s in map(json.loads, _solo_da_una_parte(fa, fb))]
    # binari, acque: i punti che ci sono da una parte sola
    for nome in ('tram', 'rails', 'water'):
        pa = Counter(p for t in A.get(nome) or [] for p in _coppie(t if nome == 'tram' else t[2]))
        pb = Counter(p for t in B.get(nome) or [] for p in _coppie(t if nome == 'tram' else t[2]))
        out += [(x, z, nome) for x, z in _solo_da_una_parte(pa, pb)]
    # cavalcavia: con gli archi della struttura dai loro capi
    cav = lambda R: Counter(_js({**c, 'archi': [_capi(R, k) for k in c.get('archi') or []]}) for c in R.get('cavalcavia') or [])
    out += [(c['x'], c['z'], 'cavalcavia') for c in map(json.loads, _solo_da_una_parte(cav(A), cav(B)))]
    return out


def _box(ix, iz, T):
    return (ix * T, iz * T, (ix + 1) * T, (iz + 1) * T)


def _box_anello(f):
    xs, zs = f[0::2], f[1::2]
    return (min(xs), min(zs), max(xs), max(zs))


def _diff_multinsieme(a, b):
    """Elementi (in JSON) che ci sono da una parte sola, con quante volte."""
    return [json.loads(s) for s in _solo_da_una_parte(Counter(map(_js, a)), Counter(map(_js, b)))]


def uscite_cambiate(A, AA, B, BA):
    """[(cosa, chiave, (x0, z0, x1, z1))]: quello che la build ricava, cambiato tra (rete A, aree AA) e (B, BA)."""
    out = []
    S, T = A.get('surfaces') or {}, B.get('surfaces') or {}
    lato = (T or S).get('tile', 200)
    ca = {(c[0], c[1]): c for c in S.get('cells') or []}
    cb = {(c[0], c[1]): c for c in T.get('cells') or []}
    for k in set(ca) | set(cb):
        if ca.get(k) != cb.get(k):
            out.append(('celle della rete', f'{k[0]},{k[1]}', _box(*k, lato)))
    for nome, cosa in (('up', 'asfalto in quota'), ('decks', 'impalcati')):
        for poly in _diff_multinsieme(S.get(nome) or [], T.get(nome) or []):
            out.append((cosa, '', _box_anello(poly[0])))
    lato_a = (B.get('aree') or A.get('aree') or {}).get('lato', aree_mappa.LATO)
    for k in set(AA) | set(BA):
        a, b = AA.get(k) or {}, BA.get(k) or {}
        if a == b:
            continue
        cca = {(c[0], c[1]): c for c in a.get('celle') or []}
        ccb = {(c[0], c[1]): c for c in b.get('celle') or []}
        for q in set(cca) | set(ccb):
            if cca.get(q) != ccb.get(q):
                out.append(('celle delle aree', f'{q[0]},{q[1]}', _box(*q, lato)))
        for e in _diff_multinsieme(a.get('edifici') or [], b.get('edifici') or []):
            out.append(('edifici', '', _box_anello(e[3])))
        for x, z in (Counter(_coppie(a.get('alberi') or [])) - Counter(_coppie(b.get('alberi') or []))) + \
                (Counter(_coppie(b.get('alberi') or [])) - Counter(_coppie(a.get('alberi') or []))):
            out.append(('alberi', '', (x, z, x, z)))
    for nome, cosa in (('stalli', 'stalli'), ('sedeCorsie', 'corsie strette')):
        for c, _r in _solo_da_una_parte(_per_arco(A, nome), _per_arco(B, nome)):
            p = _medio(c)
            if p:
                out.append((cosa, '', (p[0], p[1], p[0], p[1])))
    # raccordi per nodo, dal posto del nodo (le voci hanno dentro indici di archi e nodi: se la rete cambia struttura
    # cambiano anche lontano)
    racc = lambda R: Counter((_nodo(R, n), _js(v)) for n, v in zip((R.get('raccordi') or {}).get('nodi') or [], (R.get('raccordi') or {}).get('voci') or []))
    for p, _v in _solo_da_una_parte(racc(A), racc(B)):
        if p:
            out.append(('raccordi', '', (p[0], p[1], p[0], p[1])))
    ta, tb = A.get('terrain') or {}, B.get('terrain') or {}
    if ta.get('data') != tb.get('data'):
        prima = {k: v for k, v in ta.items() if k != 'data'}
        if prima != {k: v for k, v in tb.items() if k != 'data'}:
            out.append(('terreno', 'griglia', (-1e9, -1e9, 1e9, 1e9)))
        else:
            da, db = base64.b64decode(ta['data']), base64.b64decode(tb['data'])
            nx, st = tb['nx'], tb['step']
            for i, (u, v) in enumerate(zip(da, db)):
                if u != v:
                    x, z = tb['x0'] + (i % nx) * st, tb['z0'] + (i // nx) * st
                    out.append(('terreno', '', (x, z, x, z)))
    return out


def distanza(box, punti):
    """Distanza dal rettangolo al punto più vicino (inf senza punti)."""
    x0, z0, x1, z1 = box
    return min((math.hypot(max(x0 - x, 0, x - x1), max(z0 - z, 0, z - z1)) for x, z in punti), default=math.inf)


def conta(ds):
    """Quante distanze per banda: '0-200 m 3, 500-1000 m 1, oltre 2000 m 4'."""
    lim = (0, *BANDE, math.inf)
    c = Counter(next(i for i in range(len(lim) - 1) if d < lim[i + 1]) for d in ds)
    nome = lambda i: f'{lim[i]}-{lim[i + 1]} m' if lim[i + 1] < math.inf else f'oltre {lim[i]} m'
    return ', '.join(f'{nome(i)} {c[i]}' for i in range(len(lim) - 1) if c[i])


def rapporto(prima, dopo, punti=None):
    """(righe, dati, uscite con la distanza) del confronto tra due mappe (percorsi delle reti). Con punti, le distanze
    sono da quelli invece che dai dati cambiati trovati."""
    A, AA = carica(prima)
    B, BA = carica(dopo)
    dati = dati_cambiati(A, B)
    rif = punti if punti is not None else [(x, z) for x, z, _c in dati]
    usc = [(c, k, b, distanza(b, rif)) for c, k, b in uscite_cambiate(A, AA, B, BA)]
    righe = []
    if punti is None:
        cosa = Counter(c for _x, _z, c in dati)
        righe.append('dati cambiati: ' + (', '.join(f'{c} {n}' for c, n in cosa.most_common()) if dati else 'nessuno'))
    # aree cambiate (file diversi) per distanza: le aree sono i riquadri da 800 m di public/mappa/aree
    lato = (B.get('aree') or {}).get('lato', aree_mappa.LATO)
    diverse = sorted(k for k in set(AA) | set(BA) if AA.get(k) != BA.get(k))
    dist_aree = [distanza(_box(*map(int, k.split('_')), lato), rif) for k in diverse]
    righe.append(f'aree cambiate: {len(diverse)} su {len(set(AA) | set(BA))}' + (f' ({conta(dist_aree)})' if diverse and rif else ''))
    per = defaultdict(list)
    for c, k, b, d in usc:
        per[c].append(d)
    for c in USCITE:
        if per.get(c):
            ds = per[c]
            righe.append(f'  {c}: {len(ds)}' + (f' ({conta(ds)}; la più lontana a {max(ds):.0f} m)' if rif else ''))
    return righe, dati, usc


def _centro(b):
    return (b[0] + b[2]) / 2, (b[1] + b[3]) / 2


def controlla(prima, dopo, prova, aggiorna=False):
    """Prova della località: dopo è la mappa rigenerata con i cambi di prova (data/localita.json), prima quella del
    repository. Ogni uscita cambiata oltre il raggio da tutti i cambi è un caso, contro data/eccezioni/localita.json;
    ogni cambio deve cambiare qualcosa entro il raggio (se no la prova non prova niente). (righe, errori)."""
    import eccezioni
    punti = [(c['x'], c['z']) for c in prova['cambi']]
    R = prova['raggio']
    righe, _dati, usc = rapporto(prima, dopo, punti)
    casi = [eccezioni.chiave(c, *_centro(b)) for c, _k, b, d in usc if d > R]
    E = eccezioni.Elenco('localita', 'python3 scripts/rigenera_mappa.py --localita --aggiorna')
    E.confronta('mappa', casi, 1.0, aggiorna)
    if aggiorna:
        E.scrivi()
    errori = E.errori()
    for c in prova['cambi']:
        if not any(distanza(b, [(c['x'], c['z'])]) <= R for _c, _k, b, _d in usc):
            errori.append(f"Il cambio {c['cosa']} presso ({c['x']}, {c['z']}) non ha cambiato niente entro {R} m: "
                          f"la prova non prova niente (data/localita.json).")
    righe.append(f"oltre {R} m dai cambi: {len(casi)} uscite cambiate" + (f" ({', '.join(f'{c} {n}' for c, n in Counter(k.rpartition(' @ ')[0] for k in casi).most_common())})" if casi else ''))
    return righe, errori


def main():
    ap = argparse.ArgumentParser(description='Quello che cambia tra due mappe, per distanza dal dato cambiato.')
    ap.add_argument('prima')
    ap.add_argument('dopo')
    ap.add_argument('--punto', action='append', default=[], help='X,Z: distanze da qui invece che dai dati cambiati')
    args = ap.parse_args()
    punti = [tuple(float(v) for v in p.split(',')) for p in args.punto] or None
    righe, _dati, _usc = rapporto(args.prima, args.dopo, punti)
    print('\n'.join(righe))


if __name__ == '__main__':
    main()
