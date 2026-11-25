"""Pianta delle strade per il gioco: carreggiate, marciapiedi e isole come aree vere (Shapely).

Al posto di nastri, dischi e ventagli sovrapposti disegnati a runtime, qui si calcola una volta sola:
  * la carreggiata: unione dei tratti allargati alla loro larghezza, con i raccordi agli incroci;
  * le isole: isole delle rotatorie e spartitraffico chiusi (buchi piccoli della carreggiata senza edifici);
  * il marciapiede: fascia attorno alla carreggiata, senza edifici, isole e acqua (tranne sui ponti);
  * gli edifici ritagliati fuori da carreggiate, marciapiede minimo e sede del tram.
Le quote dei cavalcavia seguono la stessa regola del gioco (src/data/padova.js): i tratti in quota non fanno
parte del piano stradale a terra.
"""
import heapq
import math
import multiprocessing
import os
import sys
import threading
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

import shapely
from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union

H_DECK, R_RAMP, PSV_DECK = 7.0, 130.0, 0.92  # impalcato, rampa, corsie riservate ai bus (poco più in basso)
MAX_SLOPE = 0.10  # pendenza massima di un raccordo verso una rampa
H_CLEAR = 5.0  # m: quota minima di una rampa sopra una strada in sottopasso (un bus è alto 3,2 m, l'impalcato 0,9)
SIDEWALK = 3.5  # m: marciapiede attorno alle carreggiate
BRIDGE_WALK = 2.0  # m: marciapiede sui ponti sopra l'acqua
FILLET_BUS, FILLET = 7.0, 3.5  # m: raggio dei raccordi agli incroci (percorsi dei bus, altre strade)
ISLAND_MAX = 2500.0  # m²: un buco della carreggiata più piccolo di così (e senza edifici) è un'isola
BUS_KERB = 1.5  # m: marciapiede minimo tra carreggiata dei bus e facciate
# fuori dal DBGT, all'esterno delle svolte strette a sinistra dei bus: nei primi 20 m della via d'uscita le facciate stanno
# almeno 3 m oltre il bordo (il muso di un bus da 12 m che gira esce fino a 2,3 m oltre il cordolo della sua corsia)
BUS_TURN_KERB, BUS_TURN_LEN = 3.0, 20.0
TRAM_CLEAR = 3.2  # m: dal binario alle facciate
TRAM_LANE = 2.1  # m: metà della corsia rossa di un binario, con il cordolo
TILE = 200  # m: riquadri dell'export
CREPA = 0.3  # m: metà della fessura più larga che si chiude tra un parcheggio e la carreggiata
DECK_MIN = 0.6  # m: da questa quota in su la strada o il tram stanno su un impalcato (sotto è rampa a raso)
Q_TERRA = 0.05  # m: un tratto di arco in quota più basso di così è asfalto a terra (#126)
H_RASO = 0.15  # m: sotto questa quota la rampa disegnata e le classi a terra sono lo stesso piano: ne resta una sola (#126)
MARGINE_QUOTA = 1.5  # m: il gioco dà a un punto la quota più alta tra gli archi in quota entro mezza carreggiata più questo
DECK_EDGE = 1.0  # m: l'impalcato sporge oltre la carreggiata (cordolo e parapetto)
DECK_JOIN = 4.5  # m: impalcati più vicini del doppio di così diventano un corpo unico (Cavalcavia Borgomagno)
TRAM_HALF = 1.7 + 0.5  # m: metà della corsia di un binario più il cordolo


def unione(geoms):
    """Unione per zone (#139): i pezzi si uniscono prima per riquadro da TILE metri (quello del centro del loro
    rettangolo), poi i riquadri quattro a quattro, con un albero fisso nello spazio.

    unary_union di shapely fa la stessa forma, ma su un albero costruito con tutti i pezzi: un pezzo in più o in meno,
    anche lontano, cambia l'albero, l'ordine delle intersezioni e quindi l'ultima cifra delle coordinate dappertutto, e
    dove due bordi quasi si toccano anche la forma (fessure di pochi decimetri quadri). Qui un pezzo cambiato rifà solo
    l'unione del suo riquadro e quelle sopra, nel suo ramo; il resto si calcola dagli stessi pezzi, nello stesso ordine."""
    gruppi = defaultdict(list)
    for g in geoms:
        if g is None or g.is_empty:
            continue
        x0, z0, x1, z1 = g.bounds
        gruppi[(math.floor((x0 + x1) / 2 / TILE) + (1 << 20), math.floor((z0 + z1) / 2 / TILE) + (1 << 20))].append(g)
    if not gruppi:
        return Polygon()
    livello = _unisci(gruppi, True)
    while len(livello) > 1:
        su = defaultdict(list)
        for i, j in sorted(livello):
            su[(i >> 1, j >> 1)].append(livello[(i, j)])
        livello = _unisci(su, False)
    return next(iter(livello.values()))


def _unisci(gruppi, tutti):
    """Un livello di unione: {chiave: unary_union dei pezzi}; un pezzo solo resta com'è, tranne al primo livello (tutti).
    Le unioni di un livello sono indipendenti: si dividono tra i thread (#158, in_thread)."""
    chiavi = list(gruppi)
    da_fare = [k for k in chiavi if tutti or len(gruppi[k]) > 1]
    fatti = dict(zip(da_fare, in_thread(lambda i: unary_union(gruppi[da_fare[i]]), len(da_fare))))
    return {k: fatti[k] if k in fatti else gruppi[k][0] for k in chiavi}


def _cross_t(p, q, r, s):
    """Frazione di p-q dove il segmento incrocia r-s, o None."""
    rx, rz, sx, sz = q[0] - p[0], q[1] - p[1], s[0] - r[0], s[1] - r[1]
    den = rx * sz - rz * sx
    if abs(den) < 1e-9:
        return None
    t = ((r[0] - p[0]) * sz - (r[1] - p[1]) * sx) / den
    u = ((r[0] - p[0]) * rz - (r[1] - p[1]) * rx) / den
    return t if 0 <= t <= 1 and 0 <= u <= 1 else None


def _cross(p, q, r, s):
    return _cross_t(p, q, r, s) is not None


def _smooth(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def quote_arco(k, e, heights, profili=None, dichiarati=()):
    """[(frazione, quota sopra il terreno)] lungo l'arco k: il profilo della struttura (scripts/profilo_cavalcavia.py:
    progressive in cm e quote in mm) se l'arco ne ha uno, zero per gli altri archi delle strutture con il profilo
    (`dichiarati`), altrimenti lineare tra le quote dei nodi (overpass_heights)."""
    p = profili.get(k) if profili else None
    if p:
        L = p[0][-1] or 1
        return [(s / L, q / 1000) for s, q in zip(*p)]
    if k in dichiarati:
        return [(0.0, 0.0), (1.0, 0.0)]
    return [(0.0, heights.get(e[0], 0)), (1.0, heights.get(e[1], 0))]


def quota_arco(k, e, t, heights, profili=None, dichiarati=()):
    pts = quote_arco(k, e, heights, profili, dichiarati)
    for (t0, h0), (t1, h1) in zip(pts, pts[1:]):
        if t <= t1:
            return h0 + (h1 - h0) * ((t - t0) / ((t1 - t0) or 1))
    return pts[-1][1]


def overpass_heights(nodes, edges, rails, salta=frozenset()):
    """Quote dei nodi dei cavalcavia: ponti OSM in quota (layer >= 1) sopra la ferrovia o sopra un'altra strada,
    tutta la catena del ponte, rampe raccordate fino a 130 m che non salgono sulla strada di sotto (su tutti i rami
    con il nome del ponte, almeno H_CLEAR sopra le strade in sottopasso), raccordi al massimo al 10% per le strade che
    si innestano sulle rampe. salta: archi delle strutture che hanno il profilo di scripts/profilo_cavalcavia.py (i
    loro ponti qui non contano, e le rampe degli altri non ci entrano)."""
    C = 100
    cells = lambda a, b: [(gx, gz) for gx in range(int(min(a[0], b[0]) // C), int(max(a[0], b[0]) // C) + 1)
                          for gz in range(int(min(a[1], b[1]) // C), int(max(a[1], b[1]) // C) + 1)]
    rgrid = defaultdict(list)
    for bt, _yard, f in rails:
        if bt:
            continue  # binari in ponte o in galleria
        pts = [(f[i], f[i + 1]) for i in range(0, len(f), 2)]
        for a, b in zip(pts, pts[1:]):
            for c in cells(a, b):
                rgrid[c].append((a, b))
    egrid = defaultdict(list)
    for k, (a, b, cls, _w, _n, flags, _s, _l) in enumerate(edges):
        if flags & 12 or cls == 8:
            continue
        for c in cells(nodes[a], nodes[b]):
            egrid[c].append(k)
    at = defaultdict(list)
    for k, e in enumerate(edges):
        at[e[0]].append(k)
        at[e[1]].append(k)
    under, deck = set(), set()
    for k, (a, b, _c, _w, _n, flags, _s, layer) in enumerate(edges):
        if not (flags & 4 and layer >= 1) or k in salta:
            continue
        p, q = nodes[a], nodes[b]
        hit = any(_cross(p, q, r, s) for c in cells(p, q) for r, s in rgrid.get(c, ()))
        for c in cells(p, q):
            for j in egrid.get(c, ()):
                f = edges[j]
                if f[7] >= layer or f[0] in (a, b) or f[1] in (a, b):
                    continue
                if _cross(p, q, nodes[f[0]], nodes[f[1]]):
                    hit = True
                    under.update((f[0], f[1]))
        if hit:
            deck.add(k)
    stack = list(deck)
    while stack:
        k = stack.pop()
        for n in edges[k][:2]:
            for j in at[n]:
                if j not in deck and edges[j][5] & 4 and edges[j][7] >= 1 and j not in salta:
                    deck.add(j)
                    stack.append(j)
    # Rampe: dalla fine dell'impalcato la quota scende solo lungo la prosecuzione della strada stessa (stessa via, o il
    # ramo più dritto ai nodi intermedi, più i rami con il nome del ponte) e arriva a zero al primo incrocio o a 130 m;
    # le strade laterali restano a terra (prima la quota si spargeva su tutte le strade entro 130 m: incroci e
    # rotatorie ai piedi sollevati)
    deck_nodes = {n for k in deck for n in edges[k][:2]}
    name_of = lambda k: edges[k][4]
    heights = {}

    def put(n, h):
        if h > 0.001 and h > heights.get(n, 0):
            heights[n] = h
    # strade in sottopasso (tunnel o layer < 0): la rampa che ci passa sopra resta in quota fin oltre l'incrocio. Al
    # Cavalcavia Borgomagno OSM segna il sottopasso sulla strada di sotto (Piazzale della Stazione, dove passa la 24) e
    # non il ponte sulla rampa dei bus e del tram che sale dalla stazione
    tgrid = defaultdict(list)
    for j, f in enumerate(edges):
        if f[5] & 8 or f[7] < 0:
            for c in cells(nodes[f[0]], nodes[f[1]]):
                tgrid[c].append(j)

    def over_tunnel(p, q, a, b):
        """Frazione di p-q dove l'arco scavalca l'ultima strada in sottopasso, o -1."""
        ts = [_cross_t(p, q, nodes[edges[j][0]], nodes[edges[j][1]]) for c in cells(p, q) for j in tgrid.get(c, ())
              if not {edges[j][0], edges[j][1]} & {a, b}]
        return max([t for t in ts if t is not None], default=-1.0)

    for n in deck_nodes:
        put(n, H_DECK)
    for n0 in deck_nodes:
        din = [k for k in at[n0] if k in deck]
        nm = name_of(din[0]) if din else None
        # rami da seguire: (cammino, nodo, arco, metri, metri all'ultimo sottopasso). Dove la strada del ponte si divide
        # in due rami con lo stesso nome si scende su tutti e due (Borgomagno: la corsia dei bus verso Via Codalunga e
        # la rampa verso la stazione); prima si seguiva solo il più dritto e l'altro restava a terra, con un gradino
        stack = [([(n0, 0.0)], n0, k0, 0.0, 0.0) for k0 in at[n0] if k0 not in deck and k0 not in salta]
        while stack:
            path, cur, k, dist, dcross = stack.pop()
            while True:
                e = edges[k]
                nxt = e[1] if e[0] == cur else e[0]
                dx, dz = nodes[nxt][0] - nodes[cur][0], nodes[nxt][1] - nodes[cur][1]
                L = math.hypot(dx, dz) or 1e-9
                dist += L
                if nxt in deck_nodes or nxt in under or any(n == nxt for n, _ in path):
                    break
                tc = over_tunnel(nodes[cur], nodes[nxt], cur, nxt)
                if tc >= 0:  # quota piena fino a 15 m oltre il sottopasso (sugli archi lunghi non fino in fondo)
                    dcross = min(dist, dist - L + tc * L + 15)
                path.append((nxt, dist))
                if dist >= R_RAMP:
                    break
                outs = [j for j in at[nxt] if j != k and j not in deck and j not in salta]
                ground_deg = len(at[nxt])
                best, bd, same = None, 0.7, []
                for j in outs:
                    f = edges[j]
                    o = f[1] if f[0] == nxt else f[0]
                    ex, ez = nodes[o][0] - nodes[nxt][0], nodes[o][1] - nodes[nxt][1]
                    c = (ex * dx + ez * dz) / ((math.hypot(ex, ez) or 1e-9) * L)
                    if nm and name_of(j) == nm and c > 0.5:
                        same.append(j)
                    # a un incrocio si prosegue solo sulla stessa via (o dritto se l'impalcato finisce a meno di 40 m)
                    if ground_deg >= 3 and name_of(j) != nm and dist >= 40:
                        continue
                    if c > bd:
                        best, bd = j, c
                if best is None and same:
                    best = same[0]
                stack += [(list(path), nxt, j, dist, dcross) for j in same if j != best]
                if best is None:
                    break
                cur, k = nxt, best
            Lp = path[-1][1]
            if Lp < 1:
                continue
            # quota piena fino al sottopasso (almeno H_CLEAR sopra la strada di sotto), poi la discesa; solo se la rampa
            # lì è ancora alta: dove è già scesa a terra (Corso Australia su Via Cignaroli) nella realtà è il sottopasso
            # a scendere sotto il piano della strada, e il gioco non abbassa le strade
            hx = H_DECK * _smooth(1 - dcross / Lp) if dcross else 0.0
            if hx < H_DECK / 3:
                dcross = 0.0
            hc = max(hx, H_CLEAR) if dcross else 0.0
            for n, d in path:
                if d <= dcross:
                    h = max(H_DECK * _smooth(1 - d / Lp), hc)
                else:
                    h = (hc or H_DECK) * _smooth(1 - (d - dcross) / max(1.0, Lp - dcross))
                put(n, h)
    # raccordi: dove una strada si innesta su una rampa (stesso nodo) nessun arco sale più di MAX_SLOPE; la quota si
    # propaga all'indietro sulla strada che si innesta (Via Pietro Liberi sulla rampa nord del Borgomagno saliva di 4 m
    # in 6 m, la carreggiata di Via Friburgo al Cavalcavia Grassi di 7 m in 20 m)
    lens = [math.dist(nodes[e[0]], nodes[e[1]]) for e in edges]
    # accanto a una strada che passa sotto un impalcato (quota 0 obbligata) il raccordo sposterebbe solo il gradino
    pinned = under | {o for n in under for j in at[n] for o in edges[j][:2]}
    pq = [(-h, n) for n, h in heights.items()]
    heapq.heapify(pq)
    while pq:
        h, n = pq[0][0] * -1, heapq.heappop(pq)[1]
        if h < heights.get(n, 0) - 1e-6:
            continue
        for j in at[n]:
            o = edges[j][1] if edges[j][0] == n else edges[j][0]
            need = h - MAX_SLOPE * lens[j]
            if need > heights.get(o, 0) + 0.01 and o not in pinned and not edges[j][5] & 8 and j not in salta:
                heights[o] = need
                heapq.heappush(pq, (-need, o))
    out = {}
    for n, h in heights.items():
        psv = all(edges[j][5] & 32 for j in at[n])
        h = h * (PSV_DECK if psv else 1)
        if h > 0.001:
            out[n] = round(h, 2)
    return out


def _tram_heights(pts, nodes, edges, heights, profili=None, dichiarati=()):
    """Quota di ogni punto di un binario, per gli impalcati della pianta delle strade: quella della strada in quota più
    vicina e quasi parallela. La quota che il gioco legge la scrive scripts/quote_rete.py (`tramH`)."""
    up = [(k, e) for k, e in enumerate(edges) if max(h for _t, h in quote_arco(k, e, heights, profili, dichiarati)) > 0.05]
    out = []
    for i, p in enumerate(pts):
        q = pts[min(len(pts) - 1, i + 1)] if i < len(pts) - 1 else pts[i]
        o = pts[max(0, i - 1)] if i == len(pts) - 1 else p
        dx, dz = q[0] - o[0], q[1] - o[1]
        L = math.hypot(dx, dz) or 1
        dx, dz = dx / L, dz / L
        best, h = 1e9, 0.0
        for k, e in up:
            (ax, az), (bx, bz) = nodes[e[0]], nodes[e[1]]
            ux, uz = bx - ax, bz - az
            l = math.hypot(ux, uz) or 1e-9
            if abs(dx * uz / l - dz * ux / l) > 0.7:
                continue  # di traverso: il tram ci passa sotto
            t = max(0.0, min(1.0, ((p[0] - ax) * ux + (p[1] - az) * uz) / (l * l)))
            d = math.hypot(ax + ux * t - p[0], az + uz * t - p[1])
            if d < e[3] / 2 + 9 and d < best:
                best = d
                h = quota_arco(k, e, t, heights, profili, dichiarati)
        out.append(h)
    return out


def tratti_quota(q, lo, hi=math.inf):
    """Intervalli [t0, t1] del parametro dell'arco (0-1) dove la quota del profilo q = [(t, h)] sta tra lo e hi."""
    out = []
    for (ta, qa), (tb, qb) in zip(q, q[1:]):
        if tb - ta < 1e-9:
            continue
        # i punti dove il tratto entra ed esce dalla fascia [lo, hi)
        ts = [0.0, 1.0] + [(v - qa) / (qb - qa) for v in (lo, hi) if qb != qa and 0 < (v - qa) / (qb - qa) < 1]
        ts.sort()
        for u0, u1 in zip(ts, ts[1:]):
            m = qa + (qb - qa) * (u0 + u1) / 2
            if u1 - u0 < 1e-12 or not lo <= m < hi:
                continue
            t0, t1 = ta + (tb - ta) * u0, ta + (tb - ta) * u1
            if out and t0 - out[-1][1] < 1e-9:
                out[-1][1] = t1
            else:
                out.append([t0, t1])
    return out


def pezzi_quota(nodes, edges, ks, heights, profili, dichiarati, lo, hi=math.inf, margine=0.0):
    """Carreggiata degli archi ks dove la quota sta tra lo e hi: i tratti allargati a mezza carreggiata (più margine)
    con i capi dritti, più il disco del nodo dove la quota del nodo ci sta (come i giunti tondi della carreggiata)."""
    parts = []
    for k in ks:
        e = edges[k]
        q = quote_arco(k, e, heights, profili, dichiarati)
        A, B = nodes[e[0]], nodes[e[1]]
        P = lambda t: (A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t)
        for t0, t1 in tratti_quota(q, lo, hi):
            if (t1 - t0) * math.dist(A, B) > 1e-3:
                parts.append(LineString([P(t0), P(t1)]).buffer(e[3] / 2 + margine, cap_style='flat'))
        for n, h in ((e[0], q[0][1]), (e[1], q[-1][1])):
            if lo <= h < hi:
                parts.append(Point(nodes[n]).buffer(e[3] / 2 + margine, quad_segs=4))
    return parts


def decks(nodes, edges, heights, drive, tram, profili=None, dichiarati=()):
    """Impalcati in quota come un'area sola: i tratti di strada e di tram da DECK_MIN in su (carreggiata + 1 m, corsie
    del tram + cordolo), uniti e con la fascia tra impalcati vicini riempita."""
    m = DECK_MIN
    parts = []
    for k in drive:
        a, b, _c, wd = edges[k][:4]
        q = quote_arco(k, edges[k], heights, profili, dichiarati)
        ha, hb = q[0][1], q[-1][1]
        if max(h for _t, h in q) < m:
            continue
        A, B = nodes[a], nodes[b]
        P = lambda t: (A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t)
        # tratti dell'arco da DECK_MIN in su (lungo il profilo, o tra i due nodi)
        tratti = []
        for (ta, qa), (tb, qb) in zip(q, q[1:]):
            if max(qa, qb) < m or tb - ta < 1e-9:
                continue
            t0 = ta if qa >= m else ta + (tb - ta) * (m - qa) / (qb - qa)
            t1 = tb if qb >= m else ta + (tb - ta) * (qa - m) / (qa - qb)
            if tratti and t0 - tratti[-1][1] < 1e-6:
                tratti[-1][1] = t1
            else:
                tratti.append([t0, t1])
        for t0, t1 in tratti:
            if t1 - t0 > 1e-3:
                parts.append(LineString([P(t0), P(t1)]).buffer(wd / 2 + DECK_EDGE, cap_style='flat'))
        for n, h in ((a, ha), (b, hb)):
            if h >= m:
                parts.append(Point(nodes[n]).buffer(wd / 2 + DECK_EDGE, quad_segs=6))
    for t in tram:
        pts = [(t[i], t[i + 1]) for i in range(0, len(t), 2)]
        dense = [pts[0]]
        for p, q in zip(pts, pts[1:]):
            n = max(1, int(math.dist(p, q) // 5))
            dense += [(p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n) for k in range(1, n + 1)]
        hs = _tram_heights(dense, nodes, edges, heights, profili, dichiarati)
        run = []
        for p, h in zip(dense + [None], hs + [0]):
            if p is not None and h >= m:
                run.append(p)
                continue
            if len(run) >= 2:
                parts.append(LineString(run).buffer(TRAM_HALF, cap_style='flat', join_style='round'))
            run = []
    if not parts:
        return Polygon()
    D = unione(parts)
    return allarga(allarga(D, DECK_JOIN, quad_segs=4), -DECK_JOIN, quad_segs=4)


def _polys(geom):
    """Solo i poligoni di una geometria (le differenze possono lasciare linee e punti in una collezione)."""
    if isinstance(geom, Polygon):
        return [geom] if not geom.is_empty else []
    out = []
    for g in getattr(geom, 'geoms', []):
        out += _polys(g)
    return out


def _ring_pts(rings):
    """Anelli piatti (esterno, poi i buchi) come argomenti di Polygon."""
    pts = lambda r: [(r[i], r[i + 1]) for i in range(0, len(r), 2)]
    return pts(rings[0]), [pts(h) for h in rings[1:] if len(h) >= 6]


def _anelli_dm(p):
    """Anelli di un poligono al decimetro, piatti (esterno, poi i buchi)."""
    rings = []
    for r in [p.exterior, *p.interiors]:
        c = list(r.coords)[:-1]
        if len(c) >= 3:
            rings.append([round(v, 1) for xy in c for v in xy])
    return rings


def _rings(geom):
    """Poligoni di una geometria come liste di anelli piatti [x0, z0, x1, z1, ...] (esterno, poi i buchi), al decimetro.
    Arrotondati, due lati a meno di 5 cm possono toccarsi o incrociarsi, e il gioco triangola male un anello non valido
    (quali triangoli escono dipende dal vertice da cui parte: sul viadotto di Via Boves un pezzo di carreggiata in quota
    c'era o no a seconda di quello, #139): quei poligoni si portano al decimetro con shapely.set_precision, che li
    tiene validi."""
    polys = [geom] if isinstance(geom, Polygon) else list(geom.geoms) if hasattr(geom, 'geoms') else []
    out = []
    for p in polys:
        if not isinstance(p, Polygon) or p.is_empty or p.area < 0.5:
            continue
        rings = _anelli_dm(p)
        if rings and len(rings[0]) >= 6 and not Polygon(*_ring_pts(rings)).is_valid:
            for q in _polys(shapely.set_precision(p, 0.1)):
                r = _anelli_dm(q) if q.area >= 0.5 else None
                if r:
                    out.append(r)
        elif rings:
            out.append(rings)
    return out


# Ordine e punto di partenza di anelli e poligoni (#139). Le unioni di tutta la città (unary_union) danno la stessa
# forma, ma con l'ultima cifra delle coordinate che cambia appena cambia il numero dei pezzi che entrano, anche
# lontano. Le scelte che dipendono dall'ordine (da quale vertice parte un anello, in che ordine stanno i poligoni, e
# quindi quali vertici tiene la semplificazione) si fanno sulle coordinate al millimetro, che quel rumore non tocca.
def _chiave(p):
    return (round(p[0], 3), round(p[1], 3), p[0], p[1])


def _anello(c, antiorario):
    """Vertici di un anello (senza il punto che lo chiude) nel verso dato, dal vertice più piccolo al millimetro."""
    c = list(c)
    a2 = sum(c[i - 1][0] * c[i][1] - c[i][0] * c[i - 1][1] for i in range(len(c)))
    if (a2 > 0) != antiorario:
        c.reverse()
    i = min(range(len(c)), key=lambda i: _chiave(c[i]))
    return c[i:] + c[:i]


def canonico(geom):
    """I poligoni di geom con gli anelli in verso fisso (esterno antiorario, buchi orari), ognuno dal vertice più
    piccolo, i buchi e i poligoni in ordine: prima di semplificare, perché Douglas-Peucker tiene vertici diversi se
    l'anello parte da un altro punto."""
    out = []
    for p in _polys(geom):
        ext = _anello(p.exterior.coords[:-1], True)
        holes = sorted((_anello(r.coords[:-1], False) for r in p.interiors), key=lambda h: _chiave(h[0]))
        out.append(Polygon(ext, holes))
    out.sort(key=lambda q: (_chiave(q.exterior.coords[0]), round(q.area, 2)))
    return MultiPolygon(out) if out else Polygon()


def allarga(g, d, **kw):
    """g.buffer(d) con g in forma canonica (#139): GEOS semplifica ogni anello prima di allargarlo, partendo dal suo
    primo vertice, e il primo vertice di un'unione o di una differenza dipende da tutti i pezzi entrati."""
    return canonico(g).buffer(d, **kw)


def anelli_canonici(polys):
    """Poligoni come li scrive _rings (anelli piatti al decimetro), con lo stesso ordine di canonico ma sulle coordinate
    già arrotondate: due mappe con gli stessi contorni li scrivono uguali."""
    def ruota(f, antiorario):
        c = _anello(list(zip(f[0::2], f[1::2])), antiorario)
        return [v for xy in c for v in xy]
    out = []
    for rings in polys:
        holes = sorted((ruota(h, False) for h in rings[1:]), key=lambda h: (h[0], h[1]))
        out.append([ruota(rings[0], True), *holes])
    out.sort(key=lambda r: (r[0][0], r[0][1], len(r[0])))
    return out


def infittisci(coords, hfun, maxlen=12.0, tol=0.12):
    """La spezzata coords con i lati più lunghi di maxlen spezzati dove il terreno lungo il lato si scosta più di tol
    dalla retta tra i due estremi: il gioco alza solo i vertici, e un lato lungo taglierebbe argini e ponti."""
    out = [coords[0]]
    for p, q in zip(coords, coords[1:]):
        L = math.dist(p, q)
        if L > maxlen:
            # dal capo più piccolo: un lato percorso nei due versi (bordo tra due riquadri, lato in comune tra due
            # classi) ha gli stessi punti da una parte e dall'altra
            a, b = (p, q) if p <= q else (q, p)
            n = int(math.ceil(L / 4))
            ha, hb = hfun(*a), hfun(*b)
            err = max(abs(hfun(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) - (ha + (hb - ha) * k / n)) for k in range(1, n))
            if err > tol:
                m = int(math.ceil(L / maxlen))
                mid = [(a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m) for k in range(1, m)]
                out += mid if a is p else mid[::-1]
        out.append(q)
    return out


def dbgt_islands(cands, U, nodes, edges, ground, bus_edges, tram, busy=None):
    """Isole del DBGT (SPART) da aggiungere: dentro l'asfalto di oggi (almeno il 60%) oppure accanto alle carreggiate
    (spartitraffico tra due carreggiate separate, dove il gioco metteva il marciapiede), e fuori da dove passano i
    veicoli: le corsie delle auto (a un quarto della larghezza dall'asse, sull'asse nei sensi unici, 1 m per lato),
    tutta la carreggiata delle vie dei bus, gli incroci dei bus (le svolte) e la sede del tram. Così l'isola non finisce
    mai sotto le ruote. busy: corsie_occupate, se già calcolata (surfaces la fa in sfondo)."""
    if busy is None:
        busy = corsie_occupate(nodes, edges, ground, bus_edges, tram)
    # tre buffer dell'asfalto di tutta la città, insieme (#158), dalla stessa forma canonica (allarga la rifaceva ogni
    # volta, #161)
    C = canonico(U)
    Ub, Un, Ut = in_thread(lambda i: C.buffer((0.5, 8, 2)[i]), 3)
    for g in (busy, Ut):
        shapely.prepare(g)
    # le intersezioni con l'asfalto allargato (geometrie non preparate) si dividono tra i thread (#161); le domande alle
    # geometrie preparate restano qui. Stesso esito di "c.area >= 3 and not busy.intersects(c) and (Ub ∩ c >= 60% or
    # (Ut.intersects(c) and Un ∩ c >= 90%))", candidato per candidato
    cand = [c for c in cands if c.area >= 3 and not busy.intersects(c)]
    dentro = in_thread(lambda i: Ub.intersection(cand[i]).area >= 0.6 * cand[i].area, len(cand))
    altri = [i for i, ok in enumerate(dentro) if not ok and Ut.intersects(cand[i])]
    accanto = dict(zip(altri, in_thread(lambda j: Un.intersection(cand[altri[j]]).area >= 0.9 * cand[altri[j]].area, len(altri))))
    return [c for i, c in enumerate(cand) if dentro[i] or accanto.get(i, False)]


def corsie_occupate(nodes, edges, ground, bus_edges, tram):
    """Dove passano i veicoli, per dbgt_islands: corsie delle auto, carreggiate e incroci dei bus, sede del tram."""
    lanes = []
    deg = defaultdict(int)
    for k in ground:
        e = edges[k]
        ln = LineString([nodes[e[0]], nodes[e[1]]])
        hw = e[3] / 2
        if (min(e[0], e[1]), max(e[0], e[1])) in bus_edges:
            lanes.append(ln.buffer(max(hw - 0.2, 1.3), cap_style='flat'))
            deg[e[0]] += 1
            deg[e[1]] += 1
        elif e[5] & 3:
            lanes.append(ln.buffer(1.0, cap_style='flat'))
        else:
            for o in (hw / 2, -hw / 2):
                lanes.append(ln.offset_curve(o).buffer(1.0, cap_style='flat'))
    wmax = defaultdict(float)
    for k in ground:
        for n in edges[k][:2]:
            wmax[n] = max(wmax[n], edges[k][3])
    at = defaultdict(int)
    for k in ground:
        for n in edges[k][:2]:
            at[n] += 1
    lanes += [Point(nodes[n]).buffer(wmax[n] / 2 + 5) for n, d in deg.items() if d >= 1 and at[n] >= 3]
    for t in tram:
        if len(t) >= 4:
            lanes.append(LineString([(t[i], t[i + 1]) for i in range(0, len(t), 2)]).buffer(TRAM_LANE + 0.5))
    return unary_union(lanes)


def dbgt_polys(lst):
    """Poligoni da anelli piatti [[esterno], [buco], ...] (data/dbgt-*.json)."""
    out = []
    for r in lst:
        if len(r[0]) < 6:
            continue
        g = Polygon([(r[0][i], r[0][i + 1]) for i in range(0, len(r[0]), 2)], [[(h[i], h[i + 1]) for i in range(0, len(h), 2)] for h in r[1:] if len(h) >= 6])
        g = g if g.is_valid else g.buffer(0)
        out += _polys(g)
    return out


# Classi della pianta a terra (#126), nell'ordine in cui si prendono il terreno: dove due si sovrappongono vince quella
# che viene prima. Con la tolleranza della semplificazione (Douglas-Peucker, metri), se i lati si infittiscono dove il
# terreno non è piano, e il posto nella cella della mappa [ix, iz, asfalto, marciapiede, isole, verde, sede].
CLASSI = (('sede', 0.1, True, 6), ('isole', 0.1, False, 4), ('asfalto', 0.15, True, 2), ('marciapiede', 0.3, True, 3),
          ('verde', 1.0, False, 5))
GRIGLIA = 0.1  # m: passo delle coordinate della pianta nella mappa
NODI = 1e-6  # m: griglia su cui si incontrano le linee delle classi (snap rounding: senza, l'unione in virgola mobile
#              lasciava lati tagliati e due facce diventavano una)
FACCIA_MIN = 0.5  # m²: un pezzo di classe più piccolo di così va alla classe accanto


def _catene(cop, bx):
    """Le catene della copertura cop (poligoni per classe, l'ultima il vuoto): i bordi tra due classi da un nodo
    all'altro, ognuno una volta sola, con la classe da una parte e dall'altra (None fuori dal riquadro). Gli anelli senza
    nodi partono dal vertice più piccolo al millimetro."""
    import numpy as np
    linee = shapely.line_merge(shapely.union_all([LineString(r.coords) for ps in cop for p in ps for r in [p.exterior, *p.interiors]], grid_size=NODI))
    tutte = [(i, p) for i, ps in enumerate(cop) for p in ps]
    tr = STRtree([p for _i, p in tutte])
    out = []
    for c in sorted(shapely.get_parts(linee), key=lambda c: (_chiave(c.coords[0]), _chiave(c.coords[-1]), len(c.coords))):
        pts = list(c.coords)
        if pts[0] == pts[-1]:
            pts = _anello(pts[:-1], True)
            pts.append(pts[0])
        # da che parte sta ogni classe: punti a un decimo di millimetro dal lato più lungo, a sinistra e a destra
        k = max(range(len(pts) - 1), key=lambda k: math.dist(pts[k], pts[k + 1]))
        (ax, az), (bx_, bz) = pts[k], pts[k + 1]
        L = math.dist(pts[k], pts[k + 1]) or 1.0
        mx, mz, nx, nz = (ax + bx_) / 2, (az + bz) / 2, -(bz - az) / L * 1e-4, (bx_ - ax) / L * 1e-4
        lati = []
        for q in (Point(mx + nx, mz + nz), Point(mx - nx, mz - nz)):
            hit = [tutte[j][0] for j in tr.query(q, predicate='intersects')]
            lati.append(min(hit) if hit and bx.contains(q) else None)
        if lati[0] != lati[1]:
            out.append((pts, lati[0], lati[1]))
    return out


def partizione(pezzi, b, hfun=None, rampa=()):
    """Pianta a terra di un riquadro b = (x0, z0, x1, z1) come partizione: pezzi[i] sono i poligoni della classe i di
    CLASSI tagliati sul riquadro; torna i poligoni di ogni classe, senza sovrapposizioni e con i vertici sulla griglia
    da GRIGLIA metri.

    Il resto del riquadro (dove non c'è nessuna classe) è una classe in più, il vuoto: così la copertura riempie il
    riquadro, il suo bordo è quello del riquadro e resta fermo, e i riquadri accanto combaciano (#139). Le linee di tutte
    le classi, unite, danno le facce della copertura; ogni faccia va alla prima classe che contiene un suo punto interno,
    quindi dove due classi si sovrappongono vince quella che viene prima. Le linee si incontrano sulla griglia da NODI
    metri: in virgola mobile l'unione lasciava lati tagliati, e alla rotonda di Santa Croce un'isola di 440 m² che riempie
    un buco dell'asfalto con il bordo spostato di 2 cm si fondeva con l'asfalto attorno (lo stesso con coverage_clean di
    GEOS 3.14.1, con qualunque strategia). Poi ogni bordo tra due classi,
    da un nodo all'altro (_catene), si semplifica una volta sola con Douglas-Peucker e la tolleranza della più fine
    delle due classi, tenendo la topologia di tutto il riquadro: a passate dalla tolleranza più piccola, con le catene
    delle altre passate ferme (spezzate in lati di due punti, che non si semplificano ma contano per la topologia).
    coverage_simplify (Visvalingam-Whyatt) toglieva i vertici per area e mangiava le punte strette dei marciapiedi.
    Con il terreno (hfun) i bordi delle classi da infittire si spezzano dove il terreno non è piano.

    Alla fine la griglia: arrotondare al decimetro ogni poligono per conto suo incrociava i lati dove due classi, o una
    classe e il vuoto, sono più strette di un decimetro (43 m² di sovrapposizioni in tutta la città, nessuna più spessa
    di 5 cm). Qui si arrotondano insieme tutte le linee del riquadro (snap rounding, union_all con grid_size), si
    ricostruiscono le facce e ognuna va alla classe con cui ha più area in comune nella copertura prima di semplificare;
    quelle sotto FACCIA_MIN m² vanno alla vicina con il lato in comune più lungo (prima si buttavano e lasciavano un buco
    nella classe attorno). Tutto dipende solo da quello che c'è nel riquadro, in forma canonica.

    rampa: i poligoni delle rampe a raso nel riquadro, già sulla griglia (l'asfalto e la sede in quota come li disegna il
    gioco, dove stanno sotto H_RASO). Sono una classe in più, prima di tutte: le classi a terra lì lasciano il posto, e i
    bordi verso la rampa restano fermi (né semplificati né infittiti), così finiscono esattamente sul bordo della rampa
    disegnata, senza sovrapposizioni. Torna (poligoni di ogni classe di CLASSI, poligoni della rampa)."""
    import numpy as np
    from shapely.geometry import GeometryCollection
    bx = box(*b)
    pezzi = [list(rampa)] + list(pezzi)
    n = len(pezzi)
    tolls = [0.0] + [c[1] for c in CLASSI]
    fitte_c = [False] + [c[2] for c in CLASSI]
    cl = [[q for g in p for q in _polys(canonico(g))] for p in pezzi]
    # facce della copertura e classe di ognuna: la prima che ne contiene un punto interno, altrimenti il vuoto (n)
    # i vertici sulla griglia prima di unire (#139): l'unione arrotonda i nodi, ma l'incrocio tra due linee lo calcola dai
    # vertici com'erano, e dove due bordi quasi coincidono (il lato fermo della rampa a raso e quello dell'asfalto a terra
    # della stessa carreggiata) l'ultima cifra di un vertice sposta l'incrocio di decimetri lungo il lato. L'ultima cifra
    # dell'asfalto cambia anche lontano da un cambio (le differenze e buffer(0) di tutta la città): nella prova della
    # località un nodo della rampa a Corso Primo Maggio si spostava di 0,8 m per una quota cambiata a 3,7 km
    anelli = shapely.set_precision(np.array([LineString(r.coords) for ps in cl for p in ps for r in [p.exterior, *p.interiors]], dtype=object), NODI, mode='pointwise')
    linee = shapely.union_all([bx.exterior, *anelli], grid_size=NODI)
    facce = [f for f in shapely.get_parts(shapely.polygonize(shapely.get_parts(linee))) if f.area > 1e-9]
    punti = shapely.point_on_surface(np.array(facce, dtype=object))
    classe = np.full(len(facce), n)
    for i in range(n - 1, -1, -1):
        if cl[i]:
            g = shapely.union_all(cl[i])
            shapely.prepare(g)
            classe[shapely.contains(g, punti)] = i
    cop = [[f for f, c in zip(facce, classe) if c == i] for i in range(n + 1)]
    cop = [_polys(shapely.coverage_union_all(np.array(fs, dtype=object))) if fs else [] for fs in cop]
    catene = _catene(cop, bx)
    # tolleranza di una catena: quella della più fine delle due classi (il vuoto non conta); il bordo del riquadro e
    # quello della rampa sono fermi
    tol = lambda c: math.inf if None in c[1:] or 0 in c[1:] else min(tolls[i] if i < n else math.inf for i in c[1:])
    linee = [pts for pts, _a, _b in catene]
    for t in sorted({tol(c) for c in catene} - {math.inf}):
        qui = [k for k, c in enumerate(catene) if tol(c) == t]
        ferme = [LineString(seg) for k, c in enumerate(catene) if tol(c) != t for seg in zip(linee[k], linee[k][1:])]
        semplici = shapely.simplify(GeometryCollection([LineString(linee[k]) for k in qui] + ferme), t, preserve_topology=True).geoms
        for k, g in zip(qui, semplici):
            linee[k] = list(g.coords)
    if hfun:
        fitte = lambda i: i is not None and i < n and fitte_c[i]
        linee = [infittisci(pts, hfun) if 0 not in c[1:] and (fitte(c[1]) or fitte(c[2])) else pts for pts, c in zip(linee, catene)]
    # sulla griglia: linee arrotondate insieme (con il bordo del riquadro), facce, classe di ogni faccia
    righe = [LineString(pts) for pts in linee] + [bx.exterior]
    g = shapely.union_all(righe, grid_size=GRIGLIA)
    facce = sorted(shapely.get_parts(shapely.polygonize(shapely.get_parts(g))), key=lambda f: (_chiave(shapely.get_coordinates(f)[0]), round(f.area, 2)))
    tutte = [(i, p) for i, ps in enumerate(cop) for p in ps]
    tr = STRtree([p for _i, p in tutte])
    classe = []
    for f in facce:
        best, bi = 0.0, n
        for k in sorted(tr.query(f)):
            a = tutte[k][1].intersection(f).area
            if a > best:
                best, bi = a, tutte[k][0]
        classe.append(bi)
    tf = STRtree(facce)
    for k, f in enumerate(facce):
        if f.area >= FACCIA_MIN or classe[k] == n:
            continue
        lati = [(f.boundary.intersection(facce[j].boundary).length, -classe[j], j) for j in sorted(tf.query(f)) if j != k and classe[j] != classe[k]]
        if lati:
            classe[k] = classe[max(lati)[2]]
    out = []
    for i in range(n):
        fs = [f for f, c in zip(facce, classe) if c == i]
        out.append(_polys(shapely.coverage_union_all(np.array(fs, dtype=object))) if fs else [])
    return out[1:], out[0]


def riquadri(classi, hfun=None, rampa=None):
    """Celle da TILE metri [ix, iz, asfalto, marciapiede, isole, verde, sede, rampa] (anelli piatti al decimetro) dalle
    classi a terra nell'ordine di CLASSI: ogni classe tagliata sul riquadro, poi la partizione del riquadro (partizione).
    La rampa (le rampe a raso, che il gioco disegna con l'asfalto in quota) non si disegna come pianta a terra: è
    carreggiata per chi la cerca nelle celle (surfaceOff del gioco, la posa, la sosta). Si tagliano i singoli poligoni
    (indice spaziale) invece dell'intera geometria, che può essere una collezione mista."""
    L = [_polys(g) for g in classi]
    trees = [STRtree(x) for x in L]
    R = _polys(rampa) if rampa is not None else []
    tR = STRtree(R) if R else None
    x0, z0, x1, z1 = shapely.total_bounds([p for x in L[:4] for p in x])  # il verde da solo non fa riquadri
    tutti = [(ix, iz) for ix in range(int(x0 // TILE), int(x1 // TILE) + 1) for iz in range(int(z0 // TILE), int(z1 // TILE) + 1)]
    # i riquadri sono indipendenti (#139: il bordo del riquadro resta fermo): in_parallelo li divide tra i processi
    # (#158), le celle tornano nell'ordine dei riquadri
    celle = in_parallelo(lambda i: _cella_riquadro(tutti[i], L, trees, R, tR, hfun), len(tutti))
    return [c for c in celle if c is not None]


# processi per i passi della pianta che si dividono (#158): su Linux nascono per fork e trovano in memoria quello che
# serve; su macOS (spawn) tutto resta in sequenza. 1 fa tutto nel processo della build, come prima
PROCESSI = int(os.environ.get('PIANTA_PROCESSI') or min(4, os.cpu_count() or 1))
_LAVORO = None  # la funzione di in_parallelo, per i processi nati per fork


def _fetta(quali):
    global PROCESSI
    PROCESSI = 1  # in un processo figlio niente altri processi: un in_parallelo dentro un lavoro diviso va in sequenza
    return [_LAVORO(i) for i in quali]


def in_parallelo(fn, n, fette=8):
    """[fn(i) for i in range(n)], diviso tra PROCESSI processi nati per fork (#158). fn può essere una chiusura: i
    processi la trovano in memoria, e solo i risultati tornano indietro (le geometrie per WKB, con tutte le cifre). Ogni
    risultato è quello che fn dà nel processo della build, e torna al suo posto: l'uscita è la stessa, byte per byte.
    Su macOS (fork non è sicuro con le librerie di sistema) e con PROCESSI 1 in sequenza; PIANTA_FORK=1 forza il fork
    per le prove."""
    global _LAVORO
    if (PROCESSI <= 1 or n < 2 or _FIGLIO or not (sys.platform.startswith('linux') or os.environ.get('PIANTA_FORK'))
            or threading.current_thread() is not threading.main_thread()):  # niente fork da un thread di in_thread
        return [fn(i) for i in range(n)]
    k = min(n, PROCESSI * fette)
    quali = [list(range(j, n, k)) for j in range(k)]
    _LAVORO = fn
    try:
        with ProcessPoolExecutor(max_workers=PROCESSI, mp_context=multiprocessing.get_context('fork')) as pool:
            parti = list(pool.map(_fetta, quali))
    finally:
        _LAVORO = None
    out = [None] * n
    for q, r in zip(quali, parti):
        for i, v in zip(q, r):
            out[i] = v
    return out


def in_thread(fn, n):
    """[fn(i) for i in range(n)] in PROCESSI thread (#158), nell'ordine. Per le operazioni di Shapely su geometrie
    grandi (buffer, unioni, differenze): Shapely 2 lascia il GIL mentre GEOS lavora, e i thread non copiano il processo né
    rimandano indietro i risultati. Ogni risultato è quello di fn(i) da sola: l'uscita è la stessa, byte per byte, anche
    su macOS. Non per geometrie preparate in comune: GEOS ne costruisce l'indice al primo uso, e da più thread insieme
    non è sicuro (lì in_parallelo, che lavora in processi separati). Da un thread, o con PROCESSI 1, in sequenza."""
    if PROCESSI <= 1 or n < 2 or threading.current_thread() is not threading.main_thread():
        return [fn(i) for i in range(n)]
    with ThreadPoolExecutor(max_workers=min(PROCESSI, n)) as ex:
        return list(ex.map(fn, range(n)))


_FIGLIO = False  # vero nel processo di un lavoro in sfondo (Sfondo): lì niente altri processi, in_parallelo in sequenza
SFONDI = []  # i lavori in sfondo partiti in un processo figlio, per il riepilogo della build


class Sfondo:
    """Un lavoro che gira in un processo figlio, nato per fork, mentre la build va avanti (#161): le operazioni su
    geometrie grandi come la città che non dipendono l'una dall'altra lavorano insieme, anche mentre il programma lineare
    dei cavalcavia aspetta HiGHS. fn() deve dipendere solo da quello che c'è già in memoria e non cambiare niente che la
    build usa dopo (nel figlio i cambiamenti si perdono). risultato() aspetta e dà quello che fn() dà nel processo della
    build (le geometrie tornano per WKB, con tutte le cifre), o rilancia il suo errore: l'uscita è la stessa, byte per
    byte, come con in_parallelo (#158). Il figlio nasce solo se in questo processo non c'è nessun altro thread (un fork
    con un thread a metà di un lock non è sicuro); altrimenti, su macOS (PIANTA_FORK=1 lo forza), con PROCESSI 1 e in un
    figlio, fn() gira subito qui."""

    def __init__(self, nome, fn):
        self.nome, self._p, self._fatto = nome, None, False
        if (PROCESSI > 1 and not _FIGLIO and (sys.platform.startswith('linux') or os.environ.get('PIANTA_FORK'))
                and threading.current_thread() is threading.main_thread() and threading.active_count() == 1):
            ctx = multiprocessing.get_context('fork')
            self._r, scrivi = ctx.Pipe(duplex=False)
            self._p = ctx.Process(target=_sfondo_figlio, args=(fn, scrivi), daemon=True)
            self._p.start()
            scrivi.close()
            SFONDI.append(nome)
        else:
            self._valore, self._fatto = fn(), True

    def risultato(self):
        if not self._fatto:
            try:
                esito, valore = self._r.recv()
            except EOFError:
                esito, valore = 'errore', f'il processo è finito senza risultato (uscita {self._p.exitcode})'
            self._r.close()
            self._p.join()
            if esito != 'ok':
                raise RuntimeError(f'pianta delle strade, lavoro in sfondo "{self.nome}":\n{valore}')
            self._valore, self._fatto = valore, True
        return self._valore


def _sfondo_figlio(fn, scrivi):
    global _FIGLIO
    _FIGLIO = True
    try:
        out = ('ok', fn())
        scrivi.send(out)
    except BaseException:
        import traceback
        scrivi.send(('errore', traceback.format_exc()))
    scrivi.close()


def _cella_riquadro(ixz, L, trees, R, tR, hfun):
    """La cella del riquadro (ix, iz) [ix, iz, asfalto, marciapiede, isole, verde, sede, rampa], o None se è vuota."""
    ix, iz = ixz
    b = (ix * TILE, iz * TILE, (ix + 1) * TILE, (iz + 1) * TILE)
    bx = box(*b)
    pezzi = [[q for i in tr.query(bx) for q in _polys(x[i].intersection(bx))] for x, tr in zip(L, trees)]
    if not any(pezzi):
        return None
    parts = [None] * (len(CLASSI) + 1)
    ram = [q for i in tR.query(bx) for q in _polys(R[i].intersection(bx))] if tR is not None else []
    classi_r, rampa_r = partizione(pezzi, b, hfun, ram)
    for (_n, _t, _f, posto), ps in zip(CLASSI, classi_r):
        parts[posto - 2] = anelli_canonici([r for q in ps for r in _rings(q)])
    parts[-1] = anelli_canonici([r for q in rampa_r for r in _rings(q)])
    return [ix, iz, *parts] if any(parts) else None


NOMI_CLASSI = {2: 'asfalto', 3: 'marciapiede', 4: 'isole', 5: 'verde', 6: 'sede', 7: 'rampa'}


def sovrapposte(cells, minimo=0.01):
    """Pianta a terra (celle della mappa) come partizione (#126): [(ix, iz, classe, classe, m²)] dove due classi della
    stessa cella si sovrappongono per più di minimo m². Vuoto se la pianta è una partizione; build_map.py si ferma se
    non lo è, scripts/verifica_mappa.py lo misura sulla mappa."""
    out = []
    for c in cells:
        polys = []
        for i in range(2, len(c)):
            for rings in c[i]:
                p = Polygon(*_ring_pts(rings))
                polys.append((i, p if p.is_valid else p.buffer(0)))
        if len(polys) < 2:
            continue
        tr = STRtree([p for _i, p in polys])
        m2 = defaultdict(float)
        for a, b in zip(*tr.query([p for _i, p in polys], predicate='intersects')):
            (i, p), (j, q) = polys[a], polys[b]
            if a < b and i != j:
                m2[tuple(sorted((i, j)))] += p.intersection(q).area
        out += [(c[0], c[1], NOMI_CLASSI[i], NOMI_CLASSI[j], round(v, 2)) for (i, j), v in sorted(m2.items()) if v > minimo]
    return out


def _edifici(buildings):
    """Gli edifici come poligoni, con i cortili."""
    flat2 = lambda f: [(f[i], f[i + 1]) for i in range(0, len(f), 2)]
    out = []
    for b in buildings:
        p = Polygon(flat2(b[3]), [flat2(h) for h in (b[4] if len(b) > 4 and b[4] else []) if len(h) >= 6]) if len(b[3]) >= 6 else Polygon()
        out.append(p if p.is_valid else p.buffer(0))
    return out


def senza_quote(buildings, water, green, streets):
    """La parte della pianta che non dipende dalle quote né dalla rete (#161): l'area del DBGT, i contorni degli edifici
    uniti (per le carreggiate del DBGT), l'acqua, il verde e gli edifici uniti con i cortili (per gli alberi). La build
    la fa partire in sfondo (Sfondo) prima del passo dei cavalcavia, che per quasi tutto il tempo aspetta HiGHS, e la
    passa a surfaces (anticipo); senza, la fa partire surfaces."""
    flat2 = lambda f: [(f[i], f[i + 1]) for i in range(0, len(f), 2)]
    out = {'comune': unione([Polygon(*_ring_pts(r)).buffer(0) for r in green['comune']]) if green and green.get('comune') else Polygon()}
    if streets:
        bl = []
        for b in buildings:
            q = Polygon(flat2(b[3])) if len(b[3]) >= 6 else Polygon()
            bl.append(q if q.is_valid else q.buffer(0))
        out['bld'] = unione(bl)
    out['W'] = unione([LineString([(f[i], f[i + 1]) for i in range(0, len(f), 2)]).buffer(wd / 2 + 2) for _n, wd, f in water if len(f) >= 4])
    # verde del DBGT (prati, aree alberate, aiuole): l'ultima classe della pianta, quella che resta fuori da carreggiate,
    # sede, isole e marciapiedi (partizione, #126), e mai sull'acqua
    out['verde'] = Polygon()
    if green and green.get('verde'):
        vp = []
        for r in green['verde']:
            g = Polygon([(r[1][i], r[1][i + 1]) for i in range(0, len(r[1]), 2)], [[(h[i], h[i + 1]) for i in range(0, len(h), 2)] for h in r[2:] if len(h) >= 6])
            vp.append(g if g.is_valid else g.buffer(0))
        out['verde'] = unione(vp).difference(out['W']).buffer(0)
    if green and green.get('alberi'):
        out['bu'] = unary_union(_edifici(buildings))
    return out


def surfaces(nodes, edges, heights, buildings, water, tram, bus_edges, walk_w=None, hfun=None, green=None, streets=None, platforms=None,
             bus_left=(), stalli=(), profili=None, dichiarati=(), golfi=(), anticipo=None):
    """bus_left: (nodo della svolta, nodo dopo) delle svolte strette a sinistra dei bus; stalli: (nodo d'inizio, nodo
    dopo, metri) dei capolinea dove il bus fermo alla prima fermata sporge dietro l'inizio del percorso (build_map).
    Valgono solo fuori dal DBGT, dove carreggiate e piazzali sono stimati: dentro ci sono quelli misurati.
    golfi: poligoni delle aree di sosta lungo la strada di OSM (parking=street_side, scripts/sosta.py): asfalto dove
    toccano la carreggiata, come i parcheggi del DBGT. anticipo: Sfondo di senza_quote con gli stessi edifici, acqua,
    verde e carreggiate del DBGT (build_map la fa partire prima dei cavalcavia).
    Le operazioni su geometrie grandi come la città che non dipendono dall'asfalto U (impalcati, rampe, sede, corsie,
    edifici ritagliati, alberi) girano in sfondo mentre la catena di U va avanti qui (Sfondo, #161): stessi calcoli sugli
    stessi dati, la pianta esce la stessa."""
    if anticipo is None:
        anticipo = Sfondo('senza quote', lambda: senza_quote(buildings, water, green, streets))
    # archi in quota: con il profilo della loro struttura, o con un nodo in quota (overpass_heights)
    in_quota = {k for k, e in enumerate(edges) if max(h for _t, h in quote_arco(k, e, heights, profili, dichiarati)) > 0.05}
    seg = lambda e: LineString([nodes[e[0]], nodes[e[1]]])
    drive = [k for k, e in enumerate(edges) if e[2] != 8 and math.dist(nodes[e[0]], nodes[e[1]]) > 0.3]
    ground = [k for k in drive if k not in in_quota]
    # carreggiata: ogni tratto allargato (estremi tondi: i giunti delle curve restano pieni)
    pieces = {k: seg(edges[k]).buffer(edges[k][3] / 2, quad_segs=4) for k in drive}
    kq = [k for k in drive if k in in_quota]
    up = unione([pieces[k] for k in kq])  # le carreggiate in quota
    lato = Sfondo('quote e rete', lambda: _quote_e_rete(nodes, edges, heights, tram, bus_edges, green, profili, dichiarati, drive, ground, kq, pieces))
    U = unione([pieces[k] for k in ground])
    width = {(min(e[0], e[1]), max(e[0], e[1])): e[3] for e in edges}
    stimato = lambda n: not anticipo.risultato()['comune'].contains(Point(nodes[n]))
    # isole delle rotatorie: anelli chiusi di archi junction=roundabout, la mezzeria rientrata di metà carreggiata
    ring_at = defaultdict(list)
    for k in ground:
        if edges[k][5] & 16:
            ring_at[edges[k][0]].append(k)
            ring_at[edges[k][1]].append(k)
    seen, ring_islands, ring_roads, ring_arcs, ring_nodes = set(), [], [], set(), set()
    for k0 in ground:
        if not edges[k0][5] & 16 or k0 in seen:
            continue
        comp, st = [], [k0]
        while st:
            k = st.pop()
            if k in seen:
                continue
            seen.add(k)
            comp.append(k)
            for n in edges[k][:2]:
                st += [j for j in ring_at[n] if j not in seen]
        ids = {n for k in comp for n in edges[k][:2]}
        if len(ids) < 3 or any(len(ring_at[n]) != 2 for n in ids):
            continue
        # anello ordinato
        order, cur, prev = [next(iter(ids))], None, None
        cur = order[0]
        while True:
            nxt = [edges[j][1] if edges[j][0] == cur else edges[j][0] for j in ring_at[cur]]
            nxt = [n for n in nxt if n != prev]
            if not nxt or nxt[0] == order[0]:
                break
            prev, cur = cur, nxt[0]
            order.append(cur)
        if len(order) != len(ids):
            continue
        ring_arcs.update(comp)
        ring_nodes.update(ids)
        w = sum(edges[k][3] for k in comp) / len(comp)
        # quasi circolare (stessa prova del gioco, City.findRoundabouts): corona circolare esatta; altrimenti la mezzeria
        # rientrata di metà carreggiata
        L = sum(math.dist(nodes[edges[k][0]], nodes[edges[k][1]]) for k in comp)
        cx = sum((nodes[edges[k][0]][0] + nodes[edges[k][1]][0]) / 2 * math.dist(nodes[edges[k][0]], nodes[edges[k][1]]) for k in comp) / L
        cz = sum((nodes[edges[k][0]][1] + nodes[edges[k][1]][1]) / 2 * math.dist(nodes[edges[k][0]], nodes[edges[k][1]]) for k in comp) / L
        ds = [math.dist(nodes[n], (cx, cz)) for n in ids]
        r = sum(ds) / len(ds)
        if r >= 4 and all(abs(d - r) <= 0.25 * r + 1 for d in ds):
            ring_roads.append(Point(cx, cz).buffer(r + w / 2, quad_segs=16))
            if r - w / 2 > 0.5:
                ring_islands.append(Point(cx, cz).buffer(r - w / 2, quad_segs=16))
            continue
        # altrimenti (Rondò Borgomagno, ellittico) l'anello dei nodi levigato: niente isola a ottagono
        pts = [nodes[n] for n in order]
        for _ in range(3):
            pts = [q for a, b in zip(pts, pts[1:] + pts[:1]) for q in ((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))]
        poly = Polygon(pts)
        if poly.is_valid and poly.area > 1:
            ring_roads.append(poly.buffer(w / 2, quad_segs=4).difference(poly.buffer(-w / 2, quad_segs=4)))
            isl = poly.buffer(-w / 2)
            if not isl.is_empty and isl.area > 1:
                ring_islands.append(isl)
    ring_islands = unione(ring_islands) if ring_islands else Polygon()
    # (la carreggiata delle strade a terra che attraversano l'isola, con l'asse dentro, resta asfalto: un anello
    # allungato attorno alla strada principale, che passa sopra le due teste dell'anello e in mezzo sta a terra. Gli archi
    # che si innestano sull'anello, con un capo su un suo nodo, non contano: dove l'isola di un anello quasi circolare è
    # un cerchio ci entrano di qualche metro, e il gioco ci disegna sopra il suo. Con le quote di prima un pezzo
    # dell'anello stava in quota e l'isola non nasceva; con il profilo del risolutore copriva 140 m di carreggiata, #142)
    if not ring_islands.is_empty:
        shapely.prepare(ring_islands)
        dentro = []
        for k in ground:
            if k in ring_arcs or edges[k][0] in ring_nodes or edges[k][1] in ring_nodes:
                continue
            s = seg(edges[k])
            if ring_islands.intersects(s) and s.intersection(ring_islands).length > 0.5:
                dentro.append(pieces[k])
        if dentro:
            ring_islands = ring_islands.difference(unione(dentro))
    U = unione([U, *ring_roads])
    # buchi prima dei raccordi: la chiusura agli incroci riempirebbe anche le isole vere tra due rami vicini (il
    # triangolo di prato tra i due rami di Via Toti all'ingresso del Rondò Borgomagno diventava asfalto)
    pre_holes = [Polygon(r) for p in _polys(U) for r in p.interiors]
    # raccordi agli incroci: chiusura morfologica locale (si riempiono gli angoli rientranti tra due strade)
    # contano anche le rampe che arrivano a un incrocio a terra (piede della rampa), non gli incroci in quota
    tree_keys = drive
    tree = STRtree([pieces[k] for k in tree_keys])
    deg = defaultdict(list)
    for k in drive:
        for n in edges[k][:2]:
            if heights.get(n, 0) < 0.3:
                deg[n].append(k)
    incroci = [(n, ks) for n, ks in deg.items() if len(ks) >= 3]

    def fillet(j):
        n, ks = incroci[j]
        bus = any((min(edges[k][0], edges[k][1]), max(edges[k][0], edges[k][1])) in bus_edges for k in ks)
        rf = FILLET_BUS if bus else FILLET
        rad = max(edges[k][3] for k in ks) / 2 + rf * 2.2
        disc = Point(nodes[n]).buffer(rad, quad_segs=8)
        local = unary_union([pieces[tree_keys[i]] for i in sorted(tree.query(disc))]).intersection(disc)
        closed = allarga(allarga(local, rf, quad_segs=4), -rf, quad_segs=4)
        return closed.intersection(Point(nodes[n]).buffer(rad - rf * 0.6, quad_segs=8))
    fillets = in_parallelo(fillet, len(incroci))  # un incrocio alla volta, indipendenti (#158)
    # isole: buchi piccoli della carreggiata senza edifici dentro (spartitraffico, isole delle rotatorie)
    bpolys = _edifici(buildings)
    btree = STRtree(bpolys)
    free = lambda h: h.area < ISLAND_MAX and not any(bpolys[i].intersects(h) for i in btree.query(h))
    # si salvano solo le isole all'ingresso delle rotatorie (toccano l'anello) che i raccordi cancellerebbero quasi del
    # tutto, larghe almeno 2 m. Negli incroci normali i buchi tra le corsie di svolta OSM restano asfalto (spesso sono
    # zebrature, e il bus ci passava in mezzo); le isole che i raccordi solo accorciano restano accorciate
    ftree = STRtree(fillets)
    erased = lambda h: unary_union([fillets[i] for i in sorted(ftree.query(h))]).intersection(h).area
    rb = [pieces[k] for k in ground if edges[k][5] & 16]
    rtree = STRtree(rb)
    at_ring = lambda h: any(rb[i].distance(h) < 0.5 for i in rtree.query(h.buffer(0.5)))
    kept = [h for h in pre_holes if free(h) and not allarga(h, -1.0).is_empty and at_ring(h) and erased(h) > 0.8 * h.area]
    # carreggiate misurate del DBGT (2007) che toccano una via OSM di oggi: piazze, golfi di fermata, anelli dei
    # capolinea, angoli veri degli incroci. Un poligono grande entra solo se almeno il 30% sta già sulle strade di oggi
    # (una via cambiata o sparita non torna); mai dentro gli edifici di oggi né sotto le rampe dei cavalcavia
    dbgt_c, sosta_a, marciapiedi = Polygon(), Polygon(), None
    if streets:
        bld = anticipo.risultato()['bld']  # i contorni degli edifici uniti (senza_quote)
        Ut, U2 = in_thread(lambda i: allarga(U, (1.0, 2.0)[i]), 2)
        shapely.prepare(Ut)
        sel = [c for c in dbgt_polys(streets.get('carreggiate', [])) if Ut.intersects(c) and (c.area <= 6000 or c.intersection(U2).area >= 0.3 * c.area)]
        # parcheggi e distributori (SV_STR) che toccano la carreggiata: asfalto anche loro (Largo Debussy è un
        # parcheggio con l'aiuola in mezzo, non un prato dentro l'anello)
        Us = allarga(unione([U, *sel]), 1.0)
        shapely.prepare(Us)
        park = [c for c in dbgt_polys(streets.get('parcheggi', [])) if Us.intersects(c) and c.area <= 8000]
        # golfi di sosta di OSM (parking=street_side): il DBGT del 2007 non li ha tutti, e senza asfalto gli stalli
        # (scripts/sosta.py) non avrebbero dove stare
        park += [c for c in golfi if Us.intersects(c) and c.area <= 8000]
        sel += park
        sosta_a = unione(park) if park else Polygon()
        dbgt_c = unione(sel).difference(bld).difference(allarga(up, 1.0)).buffer(0) if sel else Polygon()

        def dbgt_marciapiedi():
            # marciapiedi misurati del DBGT che toccano l'asfalto di qui (con le carreggiate del DBGT), fuori dagli
            # edifici e dalle carreggiate in quota: dipende da U di adesso, e va in sfondo mentre U cresce (#161)
            Uc = allarga(unione([U, dbgt_c]), 1.5)
            shapely.prepare(Uc)
            msel = [c for c in dbgt_polys(streets.get('marciapiedi', [])) if Uc.intersects(c)]
            # aree pedonali e piazze (A_PED, AC_PED): lastricate, se toccano una strada o un marciapiede di oggi
            psel = [c for c in dbgt_polys(streets.get('pedonali', [])) if Uc.intersects(c)]
            return unione(msel + psel).difference(bld).difference(up).buffer(0) if msel or psel else Polygon()
        marciapiedi = Sfondo('marciapiedi del DBGT', dbgt_marciapiedi)
    U = unione([U, *fillets, dbgt_c])
    # tra un parcheggio e la carreggiata il DBGT lascia fessure di pochi centimetri (i due poligoni non hanno lo stesso
    # bordo): si chiudono, solo lì, o una fila di stalli a pettine sta a cavallo di una riga di marciapiede
    if not sosta_a.is_empty:
        crepe = allarga(allarga(U, CREPA, join_style='mitre'), -CREPA, join_style='mitre').difference(U).intersection(allarga(sosta_a, 2 * CREPA))
        if streets:
            crepe = crepe.difference(bld)
        U = unione([U, *[g for g in _polys(crepe) if g.area > 0.01]])
    U = U.difference(unione([ring_islands, *kept])).buffer(0)
    islands = [ring_islands] if not ring_islands.is_empty else []
    for p in ([U] if isinstance(U, Polygon) else list(U.geoms)):
        for r in p.interiors:
            h = Polygon(r)
            if free(h):
                islands.append(h)
    islands = unione(islands) if islands else Polygon()
    # forma delle isole: le quasi rotonde (rotatorie non segnate come tali in OSM, come il Rondò Borgomagno) levigate,
    # gli spartitraffico con gli spigoli arrotondati; l'asfalto riempie quello che l'isola perde
    shaped = []
    for g in _polys(islands):
        P = g.length or 1
        if 4 * math.pi * g.area / (P * P) > 0.72 and g.area > 30:
            pts = list(g.exterior.coords)[:-1]
            for _ in range(3):
                pts = [q for a, b in zip(pts, pts[1:] + pts[:1]) for q in ((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))]
            h = Polygon(pts)
            h = h if h.is_valid else h.buffer(0)
        else:
            h = allarga(allarga(g, -0.8, quad_segs=4), 0.8, quad_segs=4)
        if not h.is_empty and h.area > 2:
            shaped.append(h)
    U = unione([U, islands.difference(unione(shaped) if shaped else Polygon())])
    islands = unione(shaped) if shaped else Polygon()
    # isole misurate del DBGT dove OSM non le ha (spartitraffico, isole agli incroci), solo fuori dalle corsie
    n_isl = 0
    if green and green.get('isole'):
        mk = lambda r: Polygon([(r[0][i], r[0][i + 1]) for i in range(0, len(r[0]), 2)], [[(h[i], h[i + 1]) for i in range(0, len(h), 2)] for h in r[1:] if len(h) >= 6])
        cands = [mk(ri) for ri in green['isole'] if len(ri[0]) >= 6]
        cands = [g if g.is_valid else g.buffer(0) for g in cands]
        extra = dbgt_islands([c for c in cands if isinstance(c, Polygon)], U, nodes, edges, ground, bus_edges, tram, lato.risultato()['busy'])
        if extra:
            E = unione(extra).buffer(0)
            U = U.difference(E)
            islands = unione([islands, E])
            n_isl = len(extra)
    # banchine dei bus di OSM (le corsie della stazione): lastricate e rialzate, fuori dall'asfalto; le isole che le
    # toccano (DBGT del 2007, prima del piazzale di oggi) tornano asfalto
    P = Polygon()
    if platforms:
        pp = [Polygon([(f[i], f[i + 1]) for i in range(0, len(f), 2)]) for f in platforms if len(f) >= 6]
        P = unione([g if g.is_valid else g.buffer(0) for g in pp]).buffer(0)
        Pb = allarga(P, 0.5)
        gone = [g for g in _polys(islands) if g.intersects(Pb)]
        if gone:
            islands = islands.difference(unione(gone)).buffer(0)
            U = unione([U, *gone])
        U = U.difference(P).buffer(0)
    # stalli dei capolinea: la carreggiata continua dritta dietro l'inizio del percorso per la lunghezza del bus fermo
    # (il piazzale vero, che OSM non disegna: a Caselle il rimorchio dello snodato finiva 5 m oltre il cordolo). Solo
    # dove manca davvero asfalto, raccordi compresi (più di 5 m²: lungo la via restano schegge)
    stub = []
    for a, b, lung in stalli:
        (ax, az), (bx, bz) = nodes[a], nodes[b]
        L = math.hypot(bx - ax, bz - az)
        if L < 0.3 or not stimato(a):
            continue
        g = LineString([(ax, az), (ax - (bx - ax) / L * lung, az - (bz - az) / L * lung)]).buffer(width[(min(a, b), max(a, b))] / 2, cap_style='flat')
        if g.difference(U).area > 5:
            stub.append(g)
    if stub:
        U = unione([U, *stub])
        islands = islands.difference(unione(stub))
    # edifici fuori da carreggiate (anche quelle in quota), marciapiede minimo e sede del tram: la carreggiata intera
    # allargata e le sedi del tram vengono da _quote_e_rete, nello stesso ordine di prima
    L = lato.risultato()
    clear = [L['clear0']]
    clear += [pieces[k].buffer(BUS_KERB, quad_segs=2) for k in drive if (min(edges[k][0], edges[k][1]), max(edges[k][0], edges[k][1])) in bus_edges]
    clear += [g.buffer(0.8, quad_segs=2) for g in stub]
    # svolte strette a sinistra: a destra della via d'uscita, dalla parte delle case (z verso sud: per Shapely la sua
    # sinistra è la nostra destra). A Giarre la 22 gira da Via degli Olmi in Via dei Ciliegi e la casa di fronte stava
    # 1,6 m oltre il bordo; la via vera è larga 9 m con la sosta, quella stimata 7,5
    for b, c in bus_left:
        (bx, bz), (cx, cz) = nodes[b], nodes[c]
        L_ = math.hypot(cx - bx, cz - bz)
        if L_ < 0.3 or not stimato(b):
            continue
        t = min(1.0, BUS_TURN_LEN / L_)
        clear.append(LineString([(bx, bz), (bx + (cx - bx) * t, bz + (cz - bz) * t)]).buffer(width[(min(b, c), max(b, c))] / 2 + BUS_TURN_KERB, single_sided=True))
    clear += L['clear_tram']
    # il ritaglio degli edifici (_ritaglia) va in sfondo: il resto della pianta non lo usa (#161)
    ritaglio = Sfondo('edifici ritagliati', lambda: _ritaglia(clear, buildings, bpolys))
    # marciapiede: fascia attorno alla carreggiata e aree pedonali; via isole, acqua (tranne sui ponti) e l'impronta
    # delle rampe in quota. Gli edifici non si tolgono: lo coprono già, e il ritaglio triplicherebbe i vertici
    ped, bridges, W = L['ped'], L['bridges'], anticipo.risultato()['W']
    islands = islands.difference(W)  # tra due ponti affiancati c'è l'acqua, non un'isola
    # sotto rampe e impalcati niente isole né marciapiedi (la rampa del cavalcavia attraversava un'isola di prato)
    D = L['D']
    islands = islands.difference(up).difference(D)
    up_terra, up_alto, up_raso, sede_su, up_a, up_s, rampa, S = (L[q] for q in ('up_terra', 'up_alto', 'up_raso', 'sede_su', 'up_a', 'up_s', 'rampa', 'S'))
    if L['lanes']:
        islands = islands.difference(S)
    # marciapiede solo dove la via ce l'ha (flag 64 sinistra, 128 destra): su entrambi i lati una fascia intorno al
    # tratto, su un lato solo una fascia da quel lato
    # larghezza: quella misurata (CTRN o DBGT) da quel lato, altrimenti SIDEWALK
    bands = []
    for k in ground:
        a, b, _c, wd, _n, flags = edges[k][:6]
        sides = (flags >> 6) & 3
        wl, wr = walk_w[k] if walk_w else (0, 0)
        dl, dr = wd / 2 + (wl or SIDEWALK), wd / 2 + (wr or SIDEWALK)
        if sides == 3 and abs(dl - dr) < 0.3:
            bands.append(seg(edges[k]).buffer((dl + dr) / 2, quad_segs=4))
            continue
        # z verso sud: per Shapely il piano è speculare, la sua sinistra è la nostra destra
        if sides & 1:
            bands.append(seg(edges[k]).buffer(-dl, single_sided=True))
        if sides & 2:
            bands.append(seg(edges[k]).buffer(dr, single_sided=True))
        if sides == 3:
            bands.append(seg(edges[k]).buffer(min(dl, dr), quad_segs=4))  # giunti tondi tra un arco e l'altro
    dbgt_m = marciapiedi.risultato() if marciapiedi is not None else Polygon()
    walk = unione([*bands, ped, dbgt_m, P]).difference(U).difference(islands)
    acqua = W.difference(bridges)
    walk = walk.difference(acqua).difference(up).difference(D)
    # sotto la sede del tram asfalto, anche dove OSM la mette sul marciapiede o in una zona pedonale (il marciapiede
    # rialzato copriva la corsia rossa)
    sede = S.difference(acqua) if not S.is_empty else Polygon()
    if not S.is_empty:
        walk = walk.difference(S)
        U = unione([U, sede]).buffer(0)
    # verde del DBGT: da senza_quote
    verde = anticipo.risultato()['verde']
    # riquadri: le classi a terra tagliate sul riquadro e messe insieme come partizione (un solo proprietario per ogni
    # metro quadro, #126), semplificata lì con il bordo del riquadro fermo (i riquadri accanto combaciano, e un cambiamento
    # in un posto non sposta i contorni lontani, #139). L'asfalto U contiene anche la sede: nel riquadro la sede viene
    # prima, quindi l'asfalto è quello che resta. Con il terreno i lati lunghi infittiti dove non è piano (argini, ponti)
    # i piedi delle rampe a terra, e niente classi a terra sotto le rampe a raso
    U = unione([U, up_terra, up_raso])
    # alberi del DBGT: fuori dall'asfalto (almeno 1 m) e dagli edifici. In sfondo, mentre qui si fanno i riquadri (#161)
    piante = None
    if green and green.get('alberi'):
        bu = anticipo.risultato()['bu']
        piante = Sfondo('alberi', lambda: _alberi(U, bu, green['alberi']))
    cells = riquadri([sede, islands, U, walk, verde], hfun, rampa)
    alberi = piante.risultato() if piante is not None else []
    sostituiti, moved, dropped = ritaglio.risultato()
    out_b = []
    for j, b in enumerate(buildings):
        if j in sostituiti:
            out_b += sostituiti[j]
        else:
            out_b.append(b)
    stats = {'carreggiata_m2': round(U.area), 'marciapiede_m2': round(walk.area), 'isole': len(getattr(islands, 'geoms', [islands])),
             'isole_dbgt': n_isl, 'verde_m2': round(verde.area), 'alberi': len(alberi) // 2,
             'carreggiata_dbgt_m2': round(dbgt_c.area), 'marciapiede_dbgt_m2': round(dbgt_m.area),
             'impalcati_m2': round(D.area), 'sede_m2': round(sede.area), 'in_quota_m2': round(up_alto.area), 'in_quota_a_terra_m2': round(up_terra.area),
             'in_quota_a_raso_m2': round(rampa.area), 'sede_in_quota_m2': round(sede_su.area), 'stalli': len(stub), 'edifici_ritagliati': moved, 'edifici_tolti': dropped, 'riquadri': len(cells)}
    # carreggiate in quota (cavalcavia e rampe): un'area sola anche loro, la quota la mette il gioco vertice per vertice.
    # Prima di semplificare, anelli dal vertice più piccolo e poligoni in ordine fisso (canonico): l'unione che li dà li
    # comincia da un punto che dipende da tutti i pezzi entrati (#139)
    out = {'tile': TILE, 'cells': cells, 'decks': anelli_canonici([r for p in _polys(canonico(D).simplify(0.1)) for r in _rings(p)]),
           'up': anelli_canonici([r for p in _polys(up_a) for r in _rings(p)]), 'upSede': anelli_canonici([r for p in _polys(up_s) for r in _rings(p)])}
    if alberi:
        out['trees'] = alberi
    if green and green.get('comune'):
        out['dbgt'] = green['comune']  # area coperta dal DBGT: lì gli alberi sono quelli veri
    return out, out_b, stats


def _quote_e_rete(nodes, edges, heights, tram, bus_edges, green, profili, dichiarati, drive, ground, kq, pieces):
    """Le parti della pianta che dipendono solo dalla rete e dalle quote, non dall'asfalto U (#161): impalcati, asfalto
    e sede in quota, rampe a raso, sede del tram, la carreggiata intera allargata e le sedi del tram per il ritaglio
    degli edifici, aree pedonali, ponti, corsie occupate per le isole del DBGT. surfaces le fa in sfondo mentre la catena
    di U va avanti; i calcoli sono quelli che stavano lì."""
    seg = lambda e: LineString([nodes[e[0]], nodes[e[1]]])
    out = {}
    out['clear0'] = allarga(unione([pieces[k] for k in drive]), 0.8, quad_segs=2)
    out['clear_tram'] = [LineString([(t[i], t[i + 1]) for i in range(0, len(t), 2)]).buffer(TRAM_CLEAR, quad_segs=2) for t in tram if len(t) >= 4]
    out['ped'] = unione([seg(e).buffer(e[3] / 2, quad_segs=4) for e in edges if e[2] == 8 and math.dist(nodes[e[0]], nodes[e[1]]) > 0.3])
    out['bridges'] = unione([pieces[k].buffer(BRIDGE_WALK) for k in ground if edges[k][5] & 4])
    out['D'] = D = decks(nodes, edges, heights, drive, tram, profili, dichiarati)
    # asfalto in quota per quota (#126): i tratti degli archi in quota sotto Q_TERRA (i piedi delle rampe, un quarto
    # dell'asfalto in quota) sono asfalto a terra; quelli sotto H_RASO (a raso) stanno sullo stesso piano delle classi a
    # terra, che lì lasciano il posto alla rampa. Il resto passa sopra le strade a terra e non le tocca
    out['up_terra'] = unione(pezzi_quota(nodes, edges, kq, heights, profili, dichiarati, -math.inf, Q_TERRA))
    out['up_alto'] = up_alto = unione(pezzi_quota(nodes, edges, kq, heights, profili, dichiarati, Q_TERRA))
    out['up_raso'] = unione(pezzi_quota(nodes, edges, kq, heights, profili, dichiarati, Q_TERRA, H_RASO))
    up_sopra = unione(pezzi_quota(nodes, edges, kq, heights, profili, dichiarati, H_RASO))
    # la sede del tram nello spartitraffico (Via Aspetti, Via Guizza) e nelle rotonde che il tram attraversa resta
    # libera: l'isola è solo il verde ai lati (prima l'isola rialzata copriva binari e sede rossa)
    lanes = [LineString([(t[i], t[i + 1]) for i in range(0, len(t), 2)]).buffer(TRAM_LANE, quad_segs=2) for t in tram if len(t) >= 4]
    out['lanes'] = bool(lanes)
    # (i varchi più stretti di 3 m tra le sedi dei due binari si chiudono: restava una striscia d'erba tra i binari)
    S_tutta = allarga(allarga(unione(lanes), 1.5, quad_segs=2), -1.5, quad_segs=2) if lanes else Polygon()
    # sede in quota: la sede sotto una carreggiata in quota che corre accanto al binario (quasi parallela, come in
    # _tram_heights), tolta dall'asfalto in quota; il gioco la disegna alla quota del binario, come corsie rosse e rotaie.
    # Prima l'asfalto in quota la copriva a chiazze: prendeva la quota dell'asse della strada e si piegava sulla
    # larghezza (#85, #137). Non conta la quota del binario: sulla rampa del San Marco verso l'Ippodromo il binario sta
    # pochi centimetri sopra il terreno e la strada accanto 0,4-0,8 m (#137), e anche lì la sede è la sede. Una strada in
    # quota di traverso è un ponte sopra il tram, e la sede sotto resta a terra
    tratti_tram = []
    for t in tram:
        pts = [(t[i], t[i + 1]) for i in range(0, len(t), 2)]
        tratti_tram += [LineString([a, b]) for a, b in zip(pts, pts[1:]) if math.dist(a, b) > 1e-6]
    albero_tram = STRtree(tratti_tram) if tratti_tram else None
    sede_su_pezzi = []
    if albero_tram is not None and not S_tutta.is_empty:
        sedi = _polys(S_tutta)
        albero_sedi = STRtree(sedi)
        for k in kq:
            ps = [p for p in pezzi_quota(nodes, edges, [k], heights, profili, dichiarati, Q_TERRA) if len(albero_sedi.query(p, predicate='intersects'))]
            if not ps:
                continue
            (ax, az), (bx, bz) = nodes[edges[k][0]], nodes[edges[k][1]]
            L = math.hypot(bx - ax, bz - az) or 1e-9
            ux, uz = (bx - ax) / L, (bz - az) / L
            for p in ps:
                g = shapely.union_all([p.intersection(sedi[i]) for i in sorted(albero_sedi.query(p, predicate='intersects'))])
                if g.is_empty or g.area < 0.5:
                    continue
                c = g.representative_point()
                (sx, sz), (tx, tz) = tratti_tram[albero_tram.nearest(c)].coords
                l = math.hypot(tx - sx, tz - sz) or 1e-9
                if abs(ux * (tz - sz) / l - uz * (tx - sx) / l) <= 0.7:  # quasi parallela: corre accanto al binario
                    sede_su_pezzi.append(g)
    sede_su = unione(sede_su_pezzi) if sede_su_pezzi else Polygon()
    # asfalto e sede in quota come li disegna il gioco: la sede si taglia dopo aver semplificato, sulla griglia della
    # mappa, così i due hanno lo stesso lato in comune e non si sovrappongono
    up_area = canonico(up_alto).simplify(0.1).segmentize(4.0)
    sede_area = canonico(sede_su).simplify(0.1).segmentize(4.0)
    up_a = shapely.difference(up_area, sede_area, grid_size=GRIGLIA)
    up_s = shapely.intersection(up_area, sede_area, grid_size=GRIGLIA)
    # rampe a raso: l'asfalto e la sede in quota come li disegna il gioco, dove stanno sotto H_RASO. Nella partizione
    # dei riquadri le classi a terra lì lasciano il posto e finiscono sul loro bordo (riquadri, partizione): tagliate con
    # la geometria esatta delle rampe, i due bordi venivano semplificati e arrotondati per strade diverse, e tra l'uno e
    # l'altro restavano fessure fino a 4 cm (il controllo dei raccordi le prendeva per il bordo della strada); con una
    # fascia sotto il bordo della rampa, dove la rampa sta pochi centimetri sopra il terreno, da vicino vinceva l'asfalto
    # a terra (Corso Primo Maggio a Via Guizza). La quota è quella che il gioco disegna (City.elevHeight): la più alta
    # tra gli archi in quota entro mezza carreggiata più MARGINE_QUOTA, quindi la rampa sta sopra H_RASO anche dove il
    # suo arco è più basso ma uno accanto no. Lì le classi a terra restano sotto, come le strade sotto un ponte: con la
    # quota dell'arco la pianta a terra finiva dove la rampa disegnata stava già decimetri più su, e il gradino si vedeva
    alto_visto = unione(pezzi_quota(nodes, edges, kq, heights, profili, dichiarati, H_RASO, margine=MARGINE_QUOTA))
    rampa = shapely.difference(unione(_polys(up_a) + _polys(up_s)), alto_visto)
    S = S_tutta.difference(D).difference(up_sopra)
    out.update(sede_su=sede_su, up_a=up_a, up_s=up_s, rampa=rampa, S=S)
    out['busy'] = corsie_occupate(nodes, edges, ground, bus_edges, tram) if green and green.get('isole') else None
    return out


def _ritaglia(clear, buildings, bpolys):
    """Edifici fuori da clear (carreggiate allargate, marciapiede minimo, sede del tram): {indice dell'edificio: le voci
    che lo sostituiscono, nessuna se non resta niente}, ritagliati e tolti. In sfondo, per surfaces (#161)."""
    clear = unione(clear)
    ctree = clear
    # chi tocca ctree si chiede alla geometria preparata, con lo stesso esito: prima ogni intersects rifaceva l'indice di
    # tutta la città, circa 40 s sul Mac (#158). Poi le differenze con tutta la città, una per edificio che tocca, divise
    # tra i thread, con la geometria non più preparata
    shapely.prepare(ctree)
    tocca = [j for j, p in enumerate(bpolys) if ctree.intersects(p)]  # preparata ctree, il primo dei due
    shapely.destroy_prepared(ctree)
    resti = dict(zip(tocca, in_thread(lambda i: bpolys[tocca[i]].difference(ctree), len(tocca))))
    sostituiti, moved, dropped = {}, 0, 0
    for j in tocca:
        b = buildings[j]
        # (in ordine fisso e dal vertice più piccolo, prima di semplificare: la differenza con l'unione di tutta la città
        # comincia gli anelli da un punto che dipende anche da quello che sta lontano, #139)
        rest = canonico(resti[j])
        parts = [g for g in ([rest] if isinstance(rest, Polygon) else list(getattr(rest, 'geoms', []))) if isinstance(g, Polygon) and g.area >= 15]
        sostituiti[j] = []
        if not parts:
            dropped += 1
            continue
        moved += 1
        for g in parts:
            g = g.simplify(0.05)
            flat = [round(v, 1) for xy in list(g.exterior.coords)[:-1] for v in xy]
            holes = [[round(v, 1) for xy in list(r.coords)[:-1] for v in xy] for r in g.interiors]
            sostituiti[j].append([b[0], b[1], b[2], flat, holes or None, *b[5:]])
    return sostituiti, moved, dropped


def _alberi(U, bu, a):
    """Gli alberi del DBGT [x, z, ...] fuori dall'asfalto U (almeno 1 m) e dagli edifici bu. In sfondo (#161)."""
    xs, zs = a[0::2], a[1::2]
    Ub = allarga(U, 1.0)
    shapely.prepare(Ub)
    shapely.prepare(bu)
    ok = ~shapely.contains_xy(Ub, xs, zs) & ~shapely.contains_xy(bu, xs, zs)
    return [v for x, z, k in zip(xs, zs, ok) if k for v in (x, z)]


TERRAIN_CLOSE = 4  # celle (10 m): mezza larghezza della finestra quadrata della chiusura (riempie fino a ~80 m)
TRAM_GRADE = 0.03  # pendenza massima del terreno lungo i binari fuori dalle strade (rilevati del tram)
TRAM_BANK = 8.0  # m: mezza larghezza della striscia alzata attorno a un binario (celle del terreno da 10 m)
ROAD_GRADE = 0.04  # pendenza massima della strada che passa un ponte sui fiumi, teste e accessi compresi
ROAD_APPROACH = 60.0  # m: accessi del ponte considerati da ogni parte


def closing(h, r):
    """Chiusura morfologica (massimo poi minimo su una finestra quadrata di lato 2r+1, a due passate separabili):
    riempie gli avvallamenti più stretti della finestra e lascia com'è il resto, argini compresi. Stessa regola in
    src/world/terrain.js."""
    import numpy as np

    def filt(a, f, axis):
        p = np.pad(a, [(r, r) if k == axis else (0, 0) for k in range(2)], mode='edge')
        n = a.shape[axis]
        out = np.take(p, range(0, n), axis=axis)
        for d in range(1, 2 * r + 1):
            out = f(out, np.take(p, range(d, d + n), axis=axis))
        return out
    d = filt(filt(h, np.maximum, 0), np.maximum, 1)
    return filt(filt(d, np.minimum, 0), np.minimum, 1)


def terrain_for_game(dtm, nodes, edges, heights, tram=None, strutture=()):
    """Griglia delle quote per il gioco (src/world/terrain.js) dalla griglia del DTM (scripts/dtm_grid.py).

    * sotto i cavalcavia e le loro rampe (che il gioco alza da sé, quote in `heights`) il terreno si spiana alla quota
      del suolo intorno, così il rilevato non si conta due volte;
    * i ponti sui fiumi (bridge OSM che il gioco lascia a terra) diventano tratti con la quota raccordata tra le due
      sponde: il gioco li usa per la variante "via" della griglia (asfalto, edifici, veicoli), mentre suolo e acqua
      seguono l'alveo;
    * lungo i binari delle linee nuove del tram (`tram`: spezzate piatte [x0, z0, x1, z1, ...]; il DTM non ha ancora i
      loro terrapieni, quelli del SIR1 invece sì) fuori dalle carreggiate il terreno della variante "via" non sale né
      scende più di TRAM_GRADE: dove serve si alza come per i ponti (rilevati del tram).

    strutture: archi delle strutture con il profilo di scripts/profilo_cavalcavia.py. Sotto di loro il terreno qui non si
    spiana (lo adatta al profilo quello script), ma accessi dei ponti e rilevati del tram non ci entrano.
    """
    import base64
    import numpy as np
    g = dict(dtm)
    nx, nz, step, x0, z0 = g['nx'], g['nz'], g['step'], g['x0'], g['z0']
    b = np.frombuffer(base64.b64decode(g['data']), dtype=np.uint8).reshape(nz, nx).astype(np.float64)
    h = b * g['scale'] + g['offset']
    X, Z = np.meshgrid(x0 + np.arange(nx) * step, z0 + np.arange(nz) * step)

    def cells_near(geom, d):
        x_a, z_a, x_b, z_b = geom.buffer(d).bounds
        i0, i1 = max(0, int((x_a - x0) // step)), min(nx - 1, int((x_b - x0) // step) + 1)
        j0, j1 = max(0, int((z_a - z0) // step)), min(nz - 1, int((z_b - z0) // step) + 1)
        if i0 > i1 or j0 > j1:
            return None
        xs, zs = X[j0:j1 + 1, i0:i1 + 1], Z[j0:j1 + 1, i0:i1 + 1]
        m = shapely.contains_xy(geom.buffer(d), xs, zs)
        return (slice(j0, j1 + 1), slice(i0, i1 + 1)), m
    # spianatura sotto i tratti in quota del gioco
    up = [LineString([nodes[e[0]], nodes[e[1]]]).buffer(e[3] / 2 + 8) for e in edges
          if max(heights.get(e[0], 0), heights.get(e[1], 0)) > 0.3]
    flat = 0
    for comp in _polys(unary_union(up)) if up else []:
        ring = cells_near(comp.buffer(10).exterior.buffer(15), 0)
        core = cells_near(comp, 0)
        if not ring or not core:
            continue
        (sl, m) = ring
        vals = h[sl][m]
        if not len(vals):
            continue
        ground = float(np.percentile(vals, 30))
        (sl2, m2) = core
        sub = h[sl2]
        sub[m2] = np.minimum(sub[m2], ground)
        flat += int(m2.sum())
    # ponti sui fiumi: catene di archi bridge a terra, quota lineare tra le sponde (3 m oltre gli estremi)
    at = defaultdict(list)
    for k, e in enumerate(edges):
        if e[5] & 4 and max(heights.get(e[0], 0), heights.get(e[1], 0)) < 0.05 and e[2] != 8:
            at[e[0]].append(k)
            at[e[1]].append(k)
    hx = lambda x, z: float(h[min(nz - 1, max(0, round((z - z0) / step))), min(nx - 1, max(0, round((x - x0) / step)))])
    seen, bridges, river = set(), [], []
    for k0 in {k for ks in at.values() for k in ks}:
        if k0 in seen:
            continue
        # catena: si risale fino a un estremo (nodo con un solo arco bridge), poi si percorre
        comp, st = set(), [k0]
        while st:
            k = st.pop()
            if k in comp:
                continue
            comp.add(k)
            for n in edges[k][:2]:
                st += [j for j in at[n] if j not in comp and len(at[n]) <= 2]
        seen |= comp
        ends = [n for k in comp for n in edges[k][:2] if len(at[n]) == 1]
        if len(ends) != 2:
            continue
        order, cur, used = [ends[0]], ends[0], set()
        while cur != ends[1]:
            nxt = [(j, edges[j][1] if edges[j][0] == cur else edges[j][0]) for j in at[cur] if j in comp and j not in used]
            if not nxt:
                break
            used.add(nxt[0][0])
            cur = nxt[0][1]
            order.append(cur)
        if cur != ends[1]:
            continue
        pts = [nodes[n] for n in order]
        L = sum(math.dist(p, q) for p, q in zip(pts, pts[1:]))
        if L < 6 or L > 400:
            continue

        def beyond(p, q):
            d = math.dist(p, q) or 1
            return (p[0] + (p[0] - q[0]) / d * 3, p[1] + (p[1] - q[1]) / d * 3)
        h0, h1 = hx(*beyond(pts[0], pts[1])), hx(*beyond(pts[-1], pts[-2]))
        w = max(edges[k][3] for k in comp) / 2 + 3
        flatpts, s = [], 0.0
        for i, p in enumerate(pts):
            if i:
                s += math.dist(pts[i - 1], p)
            flatpts += [round(p[0], 1), round(p[1], 1), round(h0 + (h1 - h0) * s / L, 2)]
        bridges.append([round(w, 1), *flatpts])
        river.append((order, comp, w))
    # variante "via" (strade, edifici, prato): gli avvallamenti stretti (alvei, fossi, fino a circa 80 m) riempiti alla
    # quota delle sponde con una chiusura morfologica, così nessuna strada scende in un fiume anche dove OSM non segna
    # il ponte; poi i ponti lunghi (Brenta). Solo acqua e sponde seguono l'alveo (variante "fondo")
    hv = closing(h, TERRAIN_CLOSE)
    for br in bridges:
        w = br[0]
        for k in range(1, len(br) - 5, 3):
            ax, az, ah, bx, bz, bh = br[k:k + 6]
            seg = LineString([(ax, az), (bx, bz)])
            near = cells_near(seg, w)
            if not near:
                continue
            sl, m = near
            xs, zs = X[sl][m], Z[sl][m]
            ex, ez = bx - ax, bz - az
            t = np.clip(((xs - ax) * ex + (zs - az) * ez) / (ex * ex + ez * ez or 1), 0, 1)
            sub = hv[sl]
            sub[m] = np.maximum(sub[m], ah + (bh - ah) * t)
    def hb(x, z):
        fx = min(max((x - x0) / step, 0), nx - 1.001)
        fz = min(max((z - z0) / step, 0), nz - 1.001)
        i, j = int(fx), int(fz)
        tx, tz = fx - i, fz - j
        return (hv[j, i] * (1 - tx) + hv[j, i + 1] * tx) * (1 - tz) + (hv[j + 1, i] * (1 - tx) + hv[j + 1, i + 1] * tx) * tz

    def raise_along(P, grade, blocked, bank, deck=None):
        """Rilevati lungo la spezzata P: dove l'inviluppo del profilo di hv con pendenza `grade` sta sopra il terreno,
        spezzate con quota come quelle dei ponti (si alza soltanto), applicate subito a hv. blocked(xs, zs): punti senza
        vincolo (restano come sono). deck = (s0, s1): tratto tenuto dritto tra le due teste (l'impalcato del ponte)."""
        dense, cum = [P[0]], [0.0]
        for p, q in zip(P, P[1:]):
            n = max(1, int(math.dist(p, q) // 5))
            for k in range(1, n + 1):
                dense.append((p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n))
                cum.append(cum[-1] + math.dist(p, q) / n)
        if len(dense) < 3:
            return [], []
        xs_, zs_ = np.array([p[0] for p in dense]), np.array([p[1] for p in dense])
        free = ~blocked(xs_, zs_) & (xs_ >= x0) & (xs_ <= x0 + (nx - 1) * step) & (zs_ >= z0) & (zs_ <= z0 + (nz - 1) * step)
        hs = [hb(*p) for p in dense]
        ds = [0.0] + [cum[i] - cum[i - 1] for i in range(1, len(cum))]
        env = list(hs)
        for i in range(1, len(env)):
            if free[i]:
                env[i] = max(env[i], env[i - 1] - grade * ds[i])
        for i in range(len(env) - 2, -1, -1):
            if free[i]:
                env[i] = max(env[i], env[i + 1] - grade * ds[i + 1])
        if deck:
            idx = [i for i, c in enumerate(cum) if deck[0] - 0.01 <= c <= deck[1] + 0.01]
            if len(idx) >= 2:
                i0, i1 = idx[0], idx[-1]
                for i in idx:
                    if free[i]:
                        t = (cum[i] - cum[i0]) / ((cum[i1] - cum[i0]) or 1)
                        env[i] = max(env[i], env[i0] + (env[i1] - env[i0]) * t)
        out, info, run = [], [], []
        for i in range(len(dense) + 1):
            if i < len(dense) and env[i] > hs[i] + 0.05:
                if not run and i:
                    run.append(i - 1)
                run.append(i)
                continue
            if run:
                if i < len(dense):
                    run.append(i)
                out.append([bank, *[v for k in run for v in (round(dense[k][0], 1), round(dense[k][1], 1), round(float(env[k]), 2))]])
                info.append((round(dense[run[0]][0]), round(dense[run[0]][1]), round(cum[run[-1]] - cum[run[0]]),
                             round(float(max(env[k] - hs[k] for k in run)), 1)))
                run = []
        for br in out:
            for k in range(1, len(br) - 5, 3):
                ax, az, ah, bx, bz, bh = br[k:k + 6]
                near = cells_near(LineString([(ax, az), (bx, bz)]), bank)
                if not near:
                    continue
                sl, m = near
                xs, zs = X[sl][m], Z[sl][m]
                ex, ez = bx - ax, bz - az
                tt = np.clip(((xs - ax) * ex + (zs - az) * ez) / (ex * ex + ez * ez or 1), 0, 1)
                sub = hv[sl]
                sub[m] = np.maximum(sub[m], ah + (bh - ah) * tt)
        return out, info

    up = up + [LineString([nodes[edges[k][0]], nodes[edges[k][1]]]).buffer(edges[k][3] / 2 + 8) for k in sorted(strutture)
               if math.dist(nodes[edges[k][0]], nodes[edges[k][1]]) > 0.05]
    U_up = unary_union(up) if up else Polygon()
    shapely.prepare(U_up)
    # strade sui ponti dei fiumi: la variante "via" riempie l'alveo, ma alle teste la strada poteva salire o scendere di
    # colpo verso la cresta dell'argine (Corso Primo Maggio: 2,2 m in 10 m, 29%; Ponte Sabbionari, Via Pontevigodarzere
    # e Ponte Isonzo 9-10%). Lungo la strada che passa il ponte, con ROAD_APPROACH metri di accessi per parte, il profilo
    # non sale né scende più di ROAD_GRADE e l'impalcato resta dritto tra le teste
    drive_adj = defaultdict(list)
    for k, e in enumerate(edges):
        if e[2] != 8 and math.dist(nodes[e[0]], nodes[e[1]]) > 0.3:
            drive_adj[e[0]].append(k)
            drive_adj[e[1]].append(k)

    def follow(n, prev, comp):
        """La strada che prosegue dal nodo n (arrivando da prev) per ROAD_APPROACH metri: a ogni nodo l'arco più
        allineato, fuori dal ponte."""
        out, acc, cur, p = [], 0.0, n, prev
        while acc < ROAD_APPROACH:
            a, b = nodes[p], nodes[cur]
            la = math.dist(a, b) or 1
            dx, dz = (b[0] - a[0]) / la, (b[1] - a[1]) / la
            best, bd = None, 0.5
            for k in drive_adj[cur]:
                if k in comp:
                    continue
                o = edges[k][1] if edges[k][0] == cur else edges[k][0]
                if o == p:
                    continue
                q = nodes[o]
                lq = math.dist(b, q) or 1
                d = ((q[0] - b[0]) * dx + (q[1] - b[1]) * dz) / lq
                if d > bd:
                    bd, best = d, o
            if best is None:
                break
            acc += math.dist(nodes[cur], nodes[best])
            out.append(nodes[best])
            p, cur = cur, best
        return out
    accessi, teste = [], []
    for order, comp, w in river:
        before = follow(order[0], order[1], comp)[::-1]
        after = follow(order[-1], order[-2], comp)
        P = before + [nodes[n] for n in order] + after
        s0 = sum(math.dist(p, q) for p, q in zip(P[:len(before) + 1], P[1:len(before) + 1]))
        s1 = s0 + sum(math.dist(nodes[a], nodes[b]) for a, b in zip(order, order[1:]))
        r, inf = raise_along(P, ROAD_GRADE, lambda xs, zs: shapely.contains_xy(U_up, xs, zs), max(TRAM_BANK, w), (s0, s1))
        accessi += r
        teste += inf
    # rilevati del tram: il SIR3 sul canale Scaricatore, accanto al rilevato di Via Piovese, scendeva dall'argine al 20%
    # (il terrapieno del binario nuovo non c'è nel DTM). Lungo ogni binario l'inviluppo del profilo con pendenza
    # TRAM_GRADE. Non sulle carreggiate (si alzerebbe la sede e non le corsie accanto), sotto i tratti in quota del
    # gioco o fuori dalla griglia
    ramps, rilevati = [], []
    if tram:
        roads = unary_union([LineString([nodes[e[0]], nodes[e[1]]]).buffer(e[3] / 2 + 1, quad_segs=2) for e in edges
                             if e[2] != 8 and math.dist(nodes[e[0]], nodes[e[1]]) > 0.3] + up)
        shapely.prepare(roads)
        for t in tram:
            P = [(t[i], t[i + 1]) for i in range(0, len(t) - 1, 2)]
            r, inf = raise_along(P, TRAM_GRADE, lambda xs, zs: shapely.contains_xy(roads, xs, zs), TRAM_BANK)
            ramps += r
            rilevati += inf
    bridges += accessi + ramps

    def adjust_heights(hts):
        """Quote dei nodi delle rampe dove la variante "via" riempie la striscia spianata sotto la rampa fino alla
        quota del terrapieno intorno: si toglie il riempimento, così la strada sta alla più alta tra terrapieno e rampa
        invece di sommarli (Cavalcavia Chiesanuova: rampa ovest a 12,5 m invece di 7, impalcato che spuntava sopra
        asfalto e sede del tram). L'impalcato resta alla sua quota sopra la variante "via" (sotto, binari e strade
        stanno sul riempimento) e la correzione cresce con la distanza dall'impalcato, piena a 40 m."""
        fill = np.maximum(hv - h, 0)

        def at(a, x, z):
            fx = min(max((x - x0) / step, 0), nx - 1.001)
            fz = min(max((z - z0) / step, 0), nz - 1.001)
            i, j = int(fx), int(fz)
            tx, tz = fx - i, fz - j
            return (a[j, i] * (1 - tx) + a[j, i + 1] * tx) * (1 - tz) + (a[j + 1, i] * (1 - tx) + a[j + 1, i + 1] * tx) * tz
        deck_nodes = [n for n in {n for e in edges if e[5] & 4 and e[7] >= 1 for n in e[:2]} if n in hts]
        D = {n for n in deck_nodes}
        out, lowered = {}, 0
        for n, hn in hts.items():
            if n in D:
                out[n] = hn
                continue
            d = min((math.dist(nodes[n], nodes[k]) for k in deck_nodes), default=1e9)
            nh = max(0.0, hn - float(at(fill, *nodes[n])) * min(1.0, d / 40.0))
            lowered += nh < hn - 0.05
            if nh > 0.001:
                out[n] = round(nh, 2)
        return out, lowered

    def hfun(x, z):
        fx = min(max((x - x0) / step, 0), nx - 1.001)
        fz = min(max((z - z0) / step, 0), nz - 1.001)
        i, j = int(fx), int(fz)
        tx, tz = fx - i, fz - j
        return (hv[j, i] * (1 - tx) + hv[j, i + 1] * tx) * (1 - tz) + (hv[j + 1, i] * (1 - tx) + hv[j + 1, i + 1] * tx) * tz
    lo, hi = float(h.min()), float(h.max())
    scale = (hi - lo) / 255 or 0.01
    out = np.clip(np.round((h - lo) / scale), 0, 255).astype(np.uint8)
    g.update({'scale': round(scale, 5), 'offset': round(lo, 3), 'data': base64.b64encode(out.tobytes()).decode(), 'bridges': bridges,
              'close': TERRAIN_CLOSE})
    return g, {'celle_spianate': flat, 'ponti': len(river), 'accessi_ponti': sorted(teste, key=lambda r: -r[3])[:12],
               'rilevati_tram': rilevati}, hfun, adjust_heights
