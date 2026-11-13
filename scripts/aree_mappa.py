#!/usr/bin/env python3
"""Mappa del gioco divisa in rete e aree (caricamento per aree, docs/ESTENSIONE_LINEE.md sezione 4).

La rete resta in src/data/padova-map.json, dentro il bundle del gioco: nodi, archi, nomi, linee, fermate,
segnaletica, terreno, impalcati e, della pianta delle strade (celle da 200 m di street_surfaces), carreggiate e isole,
che servono ovunque (fisica, paline, semafori, lampioni). Il resto, che serve solo da vicino, va in un file per
riquadro da LATO metri, public/mappa/aree/<ix>_<iz>.json, che il gioco scarica (src/data/aree.js): edifici,
marciapiedi e verde della pianta delle strade, alberi. La rete elenca le aree in "aree": {"lato": LATO, "chiavi":
[...]}; gli edifici e gli alberi restano nella rete come liste vuote, le celle hanno marciapiedi e verde vuoti.

Per quello che il gioco calcola su tutta la mappa all'avvio la rete ha anche:
* "edificiBBox": il rettangolo che contiene gli edifici (fuori il gioco ne genera di procedurali);
* "edificiTram": gli edifici a meno di VICINO_TRAM metri dai binari del tram (SIR1 della mappa e linee di
  data/tram-linee-nuove.json), per spostare i binari fuori dalle facciate e agganciare i tiranti della linea aerea.

Un edificio va nell'area del baricentro dei vertici del contorno, una cella nell'area del suo angolo, un albero in
quella del suo punto. Dentro un'area l'ordine è quello della mappa intera; rimessa insieme (load, o il gioco) la mappa
ha edifici e alberi in ordine di chiave dell'area, le celle nell'ordine di prima.

Accanto alle aree la build scrive il loro conto (conto_file): per ogni area quanti edifici, poligoni di marciapiede e
di verde e alberi ci sono. Il gioco non lo legge: lo usano tests/aree.spec.js, che lo confronta con quello che la città
ha messo in scena per ogni area caricata, e scripts/verifica_mappa.py, che lo confronta con i file delle aree. Nel
diff di una rigenerazione dice quali aree sono cambiate e di quanto.

Uso:
    python3 scripts/aree_mappa.py dividi src/data/padova-map.json    # divide una mappa intera (build_map.py lo fa da sé)
    python3 scripts/aree_mappa.py unisci src/data/padova-map.json <mappa intera>.json
    python3 scripts/aree_mappa.py conta src/data/padova-map.json     # riscrive il conto dalle aree che ci sono

Le aree stanno in public/mappa/aree per src/data/padova-map.json, accanto alla mappa in <nome>-aree/ per le altre
(le rigenerazioni di prova non toccano quelle del gioco).
"""
import json
import math
import os
import sys

LATO = 800.0
VICINO_TRAM = 60.0  # m: oltre quanto il gioco sposta i binari (5 m) e cerca le facciate dei tiranti (celle da 20 m)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))


def aree_dir(path):
    """Cartella delle aree della mappa path."""
    p = os.path.abspath(path)
    tail = os.path.join('src', 'data', 'padova-map.json')
    if p.endswith(os.sep + tail):
        return os.path.join(p[:-len(tail)], 'public', 'mappa', 'aree')
    return p[:-5] + '-aree' if p.endswith('.json') else p + '-aree'


def conto_file(path):
    """File del conto delle aree della mappa path: data/conto-aree.json per la mappa del gioco."""
    p = os.path.abspath(path)
    tail = os.path.join('src', 'data', 'padova-map.json')
    if p.endswith(os.sep + tail):
        return os.path.join(p[:-len(tail)], 'data', 'conto-aree.json')
    return aree_dir(path) + '-conto.json'


def conta(aree):
    """{chiave: {tipo: quanti}} delle aree: edifici, poligoni di marciapiede e di verde, alberi."""
    return {k: {'edifici': len(a['edifici']), 'marciapiedi': sum(len(c[2]) for c in a['celle']),
                'verde': sum(len(c[3]) for c in a['celle']), 'alberi': len(a['alberi']) // 2} for k, a in aree.items()}


def scrivi_conto(aree, path):
    """Scrive il conto delle aree, una riga per area (il diff di una rigenerazione dice quali sono cambiate)."""
    c = conta(aree)
    tot = {t: sum(v[t] for v in c.values()) for t in ('edifici', 'marciapiedi', 'verde', 'alberi')}
    righe = ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in c.items())
    cosa = ('Quanti oggetti ci sono in ogni area della mappa (scripts/aree_mappa.py): edifici, poligoni di marciapiede e di '
            'verde, alberi. Lo scrive la build con le aree; tests/aree.spec.js lo confronta con la scena del gioco, '
            'scripts/verifica_mappa.py con i file delle aree. Non si scrive a mano: python3 scripts/aree_mappa.py conta '
            'src/data/padova-map.json.')
    with open(conto_file(path), 'w', encoding='utf-8') as f:
        f.write('{\n "cosa": ' + json.dumps(cosa, ensure_ascii=False) + ',\n "totale": ' + json.dumps(tot) + ',\n "aree": {\n' + righe + '\n }\n}\n')
    return c


def leggi_aree(path):
    """{chiave: area} dei file delle aree della mappa divisa in path, in ordine di chiave."""
    rete = json.load(open(path, encoding='utf-8'))
    d = aree_dir(path)
    return {k: json.load(open(os.path.join(d, k + '.json'), encoding='utf-8')) for k in rete['aree']['chiavi']}


def key(x, z):
    return f'{math.floor(x / LATO)}_{math.floor(z / LATO)}'


def tram_tracks(data):
    """Binari del tram (liste di punti x, z): quelli della mappa e quelli delle linee in costruzione."""
    out = [list(zip(t[0::2], t[1::2])) for t in data.get('tram') or []]
    path = os.path.join(ROOT, 'data', 'tram-linee-nuove.json')
    if os.path.exists(path):
        import build_gtfs
        for L in json.load(open(path, encoding='utf-8'))['linee']:
            out += [[build_gtfs.xz(la, lo) for la, lo in v['percorso']] for v in L['versi']]
    return out


def near_tram(buildings, tracks, r=VICINO_TRAM):
    """Gli edifici con il rettangolo a meno di r metri da un binario (celle da r metri)."""
    C, cells = r, set()
    for t in tracks:
        for (ax, az), (bx, bz) in zip(t, t[1:]):
            n = max(1, int(math.dist((ax, az), (bx, bz)) // 5))
            for i in range(n + 1):
                x, z = ax + (bx - ax) * i / n, az + (bz - az) * i / n
                cells.update((math.floor(x / C) + a, math.floor(z / C) + b) for a in (-1, 0, 1) for b in (-1, 0, 1))
    out = []
    for b in buildings:
        f = b[3]
        i0, i1 = math.floor(min(f[0::2]) / C), math.floor(max(f[0::2]) / C)
        j0, j1 = math.floor(min(f[1::2]) / C), math.floor(max(f[1::2]) / C)
        if any((i, j) in cells for i in range(i0, i1 + 1) for j in range(j0, j1 + 1)):
            out.append(b)
    return out


def split(data):
    """(rete, {chiave: area}) da una mappa intera; data non cambia."""
    aree = {}

    def area(k):
        return aree.setdefault(k, {'edifici': [], 'celle': [], 'alberi': []})
    blds = data.get('buildings') or []
    for b in blds:
        f = b[3]
        n = len(f) // 2
        area(key(sum(f[0::2]) / n, sum(f[1::2]) / n))['edifici'].append(b)
    rete = dict(data)
    rete['buildings'] = []
    if blds:
        xs = [v for b in blds for v in b[3][0::2]]
        zs = [v for b in blds for v in b[3][1::2]]
        rete['edificiBBox'] = [min(xs), min(zs), max(xs), max(zs)]
        rete['edificiTram'] = near_tram(blds, tram_tracks(data))
    S = data.get('surfaces')
    if S:
        T = S['tile']
        cells = []
        for c in S.get('cells') or []:
            ix, iz, A, W, I = c[:5]
            V = c[5] if len(c) > 5 else None
            cells.append([ix, iz, A, [], I, []])
            if W or V:
                area(key(ix * T, iz * T))['celle'].append([ix, iz, W, V or []])
        tr = S.get('trees') or []
        for i in range(0, len(tr), 2):
            area(key(tr[i], tr[i + 1]))['alberi'] += tr[i:i + 2]
        rete['surfaces'] = {**S, 'cells': cells, 'trees': []}
    order = sorted(aree, key=lambda k: tuple(int(v) for v in k.split('_')))
    rete['aree'] = {'lato': LATO, 'chiavi': order}
    return rete, {k: aree[k] for k in order}


def merge(rete, aree):
    """Mappa intera dalla rete e dalle aree (in ordine di chiave), come la rimette insieme il gioco."""
    m = dict(rete)
    m['buildings'] = list(rete.get('buildings') or [])
    for k in ('aree', 'edificiBBox', 'edificiTram'):
        m.pop(k, None)
    S = rete.get('surfaces')
    cell = {}
    if S:
        m['surfaces'] = {**S, 'cells': [list(c) for c in S.get('cells') or []], 'trees': list(S.get('trees') or [])}
        cell = {(c[0], c[1]): c for c in m['surfaces']['cells']}
    for k in rete['aree']['chiavi']:
        a = aree[k]
        m['buildings'] += a['edifici']
        if S:
            for ix, iz, W, V in a['celle']:
                c = cell[(ix, iz)]
                c[3], c[5] = W, V
            m['surfaces']['trees'] += a['alberi']
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
    scrivi_conto(aree, out)
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
    elif cmd == 'conta':
        c = scrivi_conto(leggi_aree(path), path)
        print(f'conto di {len(c)} aree in {conto_file(path)}')
    elif cmd == 'unisci':
        with open(sys.argv[3], 'w', encoding='utf-8') as f:
            json.dump(load(path), f, ensure_ascii=False, separators=(',', ':'))
