"""Pendolari da fuori della mappa e porte (#147), per scripts/domanda.py.

Chi entra dai bordi della mappa viene da un comune di fuori. La matrice del pendolarismo ISTAT 2011
(data/istat-pendolari.json, scripts/istat_pendolari.py) dice quanti vanno in auto, come conducenti, da un comune
all'altro; comuni (data/osm-comuni.json) e strade principali entro 20 km (data/osm-strade-fuori.json) vengono da OSM
(scripts/filter_osm_fuori.py). Qui:

  - dentro la mappa stanno i comuni col centro abitato in un'area della mappa: i loro abitanti sono già nelle zone, e chi
    ci va dagli altri comuni entra da una porta;
  - la rete di fuori sono le vie OSM senza i tratti che la mappa ha già (tra due suoi nodi con un arco tra loro), a
    velocità libera per classe. Una porta è un nodo della mappa, e la via di fuori che ci arriva passa dallo stesso nodo;
  - per ogni comune di fuori e zona, la porta col tempo minore: dal comune al nodo della rete più vicino, la rete fino
    alla porta, poi i tempi della mappa (la matrice della domanda). Le zone pesano gli addetti per la deterrenza del
    viaggio intero; la sera si esce dalla porta col tempo minore verso il comune.

Solo libreria standard e solo somme, prodotti, divisioni e radici, come scripts/domanda.py. Regole e numeri in
docs/domanda.md, sezione 3.
"""
import heapq
import json
import math
import os
from collections import defaultdict

RADICE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
COMUNI = os.path.join(RADICE, 'data', 'osm-comuni.json')
STRADE = os.path.join(RADICE, 'data', 'osm-strade-fuori.json')
ISTAT = os.path.join(RADICE, 'data', 'istat-pendolari.json')

# velocità libere fuori dalla mappa per classe (m/s): 110, 80, 60, 50 e 45 km/h; le rampe al 70%
V_FUORI = [30.6, 22.2, 16.7, 13.9, 12.5]
RAMPA = 0.7
# dal centro del comune al nodo della rete più vicino: la linea d'aria per 1,3, a 8 m/s per i primi 1.500 m (le strade
# del paese) e a 20 m/s oltre (i comuni oltre i 20 km delle strade)
TORTUOSITA, V_PAESE, V_LONTANO, PAESE = 1.3, 8.0, 20.0, 1500.0
AGGANCIO = 0.5  # metri tra un nodo della mappa e il punto della via di fuori che è lo stesso nodo


def rete_fuori(R, xz):
    """(x, z, succ, pred, nodi della mappa -> nodi di fuori): la rete delle vie di fuori, nodi per coordinate (0,1 m)"""
    nodo_mappa = {}
    for i in range(len(R.nx)):
        nodo_mappa.setdefault((math.floor(R.nx[i]), math.floor(R.nz[i])), []).append(i)

    def della_mappa(x, z):
        for i in (math.floor(x) - 1, math.floor(x), math.floor(x) + 1):
            for j in (math.floor(z) - 1, math.floor(z), math.floor(z) + 1):
                for n in nodo_mappa.get((i, j), ()):
                    if abs(R.nx[n] - x) < AGGANCIO and abs(R.nz[n] - z) < AGGANCIO:
                        return n
        return None
    archi = {(R.a[e], R.b[e]) for e in range(R.na)} | {(R.b[e], R.a[e]) for e in range(R.na)}
    X, Z, indice, mappa = [], [], {}, {}
    succ, pred = defaultdict(dict), defaultdict(dict)

    def nodo(x, z):
        k = (round(x * 10), round(z * 10))
        if k not in indice:
            indice[k] = len(X)
            X.append(x)
            Z.append(z)
            m = della_mappa(x, z)
            if m is not None:
                mappa.setdefault(m, []).append(indice[k])
        return indice[k]

    def arco(a, b, t):
        if a != b and t < succ[a].get(b, math.inf):
            succ[a][b] = pred[b][a] = t
    for v in json.load(open(STRADE, encoding='utf-8'))['vie']:
        classe, rampa, senso = v[0], v[1], v[2]
        vel = V_FUORI[classe] * (RAMPA if rampa else 1.0)
        lat, lon, punti = v[3], v[4], []
        for k in range(3, len(v), 2):
            if k > 3:
                lat, lon = lat + v[k], lon + v[k + 1]
            punti.append(nodo(*xz(lat / 1e6, lon / 1e6)))
        # tratti che la mappa ha già: tra due nodi della mappa di fila lungo la via, con un arco della mappa tra loro
        nella = [False] * (len(punti) - 1)
        idx = [(i, della_mappa(X[n], Z[n])) for i, n in enumerate(punti)]
        idx = [(i, m) for i, m in idx if m is not None]
        for (i, a), (k, b) in zip(idx, idx[1:]):
            if (a, b) in archi:
                nella[i:k] = [True] * (k - i)
        for j in range(len(punti) - 1):
            if nella[j]:
                continue
            a, b = punti[j], punti[j + 1]
            dx, dz = X[b] - X[a], Z[b] - Z[a]
            t = math.sqrt(dx * dx + dz * dz) / vel
            if senso != 2:
                arco(a, b, t)
            if senso != 1:
                arco(b, a, t)
    return X, Z, succ, pred, mappa


def dijkstra(adj, sorgenti):
    dist = {}
    coda = [(0.0, n) for n in sorgenti]
    heapq.heapify(coda)
    while coda:
        d, n = heapq.heappop(coda)
        if n in dist:
            continue
        dist[n] = d
        for m, t in adj.get(n, {}).items():
            if m not in dist:
                heapq.heappush(coda, (d + t, m))
    return dist


def accesso(d):
    """secondi dal centro del comune al nodo della rete a d metri in linea d'aria"""
    d = d * TORTUOSITA
    return d / V_PAESE if d <= PAESE else PAESE / V_PAESE + (d - PAESE) / V_LONTANO


def pendolari(R, zone, P, T, aree, xz, deterrenza, t0, INF):
    """pendolari_in (porta -> zona -> pendolari al giorno), pendolari_out (zona -> porta) e i conti. R: la rete della
    mappa; zone e P (con 'nodi', i nodi della mappa) della domanda; T: la matrice dei tempi (zone, poi porte); aree:
    (lato, chiavi) delle aree della mappa; t0: la deterrenza dei pendolari"""
    nz = len(zone)
    lato, chiavi = aree
    C = {}
    for codice, nome, lat, lon, _c in json.load(open(COMUNI, encoding='utf-8'))['comuni']:
        x, z = xz(lat, lon)
        C[codice] = (nome, x, z, f'{math.floor(x / lato)}_{math.floor(z / lato)}' in chiavi)
    F, fasce, fra_dentro = defaultdict(float), [0.0] * 4, 0.0
    for o, d, *n in json.load(open(ISTAT, encoding='utf-8'))['flussi']:
        if o not in C or d not in C or not C[d][3]:
            continue
        if C[o][3]:
            fra_dentro += sum(n)
            continue
        F[o] += sum(n)
        fasce = [a + b for a, b in zip(fasce, n)]
    X, Z, succ, pred, mappa = rete_fuori(R, xz)
    porta = [sorted({n for m in g['nodi'] for n in mappa.get(m, ()) if n in succ or n in pred}) for g in P]
    ing = [k for k, g in enumerate(P) if g['in'] and porta[k]]
    usc = [k for k, g in enumerate(P) if g['out'] and porta[k]]
    # tempi dai nodi di fuori alle porte d'ingresso, e dalle porte d'uscita ai nodi di fuori
    verso = {k: dijkstra(pred, porta[k]) for k in ing}
    da = {k: dijkstra(succ, porta[k]) for k in usc}
    # il nodo d'accesso di un comune: il più vicino da cui si arriva a una porta e a cui si torna da una porta
    utili = set().union(*(verso[k] for k in ing)) & set().union(*(da[k] for k in usc))
    utili = sorted(utili)
    addetti = [z[1]['addetti'] for z in zone]
    pin, pout = defaultdict(lambda: defaultdict(float)), defaultdict(lambda: defaultdict(float))
    per_comune, fuori = {}, 0.0
    for o in sorted(F):
        nome, x, z, _d = C[o]
        d2, n = min(((X[m] - x) * (X[m] - x) + (Z[m] - z) * (Z[m] - z), m) for m in utili)
        a = accesso(math.sqrt(d2))
        tin = {k: verso[k][n] + a for k in ing if n in verso[k]}
        tout = {k: da[k][n] + a for k in usc if n in da[k]}
        # per ogni zona la porta col tempo minore all'andata e al ritorno; il peso della zona: addetti per la deterrenza
        scelte = []
        for d in range(nz):
            andata = min(((t + T[nz + k][d], k) for k, t in tin.items() if T[nz + k][d] < INF), default=None)
            ritorno = min(((T[d][nz + k] + t, k) for k, t in tout.items() if T[d][nz + k] < INF), default=None)
            if andata and ritorno and addetti[d] > 0:
                scelte.append((addetti[d] * deterrenza(andata[0], t0), d, andata[1], ritorno[1]))
        tot = sum(s[0] for s in scelte)
        if tot <= 0:
            continue
        per_porta = defaultdict(float)
        for w, d, gi, go in scelte:
            f = F[o] * w / tot
            pin[gi][d] += f
            pout[d][go] += f
            per_porta[gi] += f
            fuori += f * tin[gi]
        per_comune[o] = (nome, F[o], sorted(per_porta.items(), key=lambda kv: (-kv[1], kv[0])))
    entrano = {k: sum(v.values()) for k, v in pin.items()}
    escono = defaultdict(float)
    for v in pout.values():
        for k, f in v.items():
            escono[k] += f
    assegnati = sum(entrano.values())
    return {
        'pin': pin, 'pout': pout, 'entrano': entrano, 'escono': dict(escono), 'per_comune': per_comune,
        'totale': sum(F.values()), 'assegnati': assegnati, 'fuori_medio': fuori / assegnati if assegnati else 0.0,
        'fra_dentro': fra_dentro, 'fasce': fasce, 'dentro': sorted(c[0] for c in C.values() if c[3]),
        'senza_rete': [P[k]['nome'] for k in range(len(P)) if not porta[k]],
    }
