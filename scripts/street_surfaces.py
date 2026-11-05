"""Pianta delle strade per il gioco: carreggiate, marciapiedi e isole come aree vere (Shapely).

Al posto di nastri, dischi e ventagli sovrapposti disegnati a runtime, qui si calcola una volta sola:
  * la carreggiata: unione dei tratti allargati alla loro larghezza, con i raccordi agli incroci;
  * le isole: isole delle rotatorie e spartitraffico chiusi (buchi piccoli della carreggiata senza edifici);
  * il marciapiede: fascia attorno alla carreggiata, senza edifici, isole e acqua (tranne sui ponti);
  * gli edifici ritagliati fuori da carreggiate, marciapiede minimo e sede del tram.
Le quote dei cavalcavia seguono la stessa regola del gioco (src/data/padova.js): i tratti in quota non fanno
parte del piano stradale a terra.
"""
import math
from collections import defaultdict

from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union

H_DECK, R_RAMP, PSV_DECK = 7.0, 130.0, 0.92  # come markOverpasses in src/data/padova.js
SIDEWALK = 3.5  # m: marciapiede attorno alle carreggiate
BRIDGE_WALK = 2.0  # m: marciapiede sui ponti sopra l'acqua
FILLET_BUS, FILLET = 7.0, 3.5  # m: raggio dei raccordi agli incroci (percorsi dei bus, altre strade)
ISLAND_MAX = 2500.0  # m²: un buco della carreggiata più piccolo di così (e senza edifici) è un'isola
BUS_KERB = 1.5  # m: marciapiede minimo tra carreggiata dei bus e facciate
TRAM_CLEAR = 3.2  # m: dal binario alle facciate
TRAM_LANE = 2.1  # m: metà della corsia rossa di un binario, con il cordolo
TILE = 200  # m: riquadri dell'export
DECK_MIN = 0.6  # m: da questa quota in su la strada o il tram stanno su un impalcato (sotto è rampa a raso)
DECK_EDGE = 1.0  # m: l'impalcato sporge oltre la carreggiata (cordolo e parapetto)
DECK_JOIN = 4.5  # m: impalcati più vicini del doppio di così diventano un corpo unico (Cavalcavia Borgomagno)
TRAM_HALF = 1.7 + 0.5  # m: metà della corsia di un binario più il cordolo


def _cross(p, q, r, s):
    rx, rz, sx, sz = q[0] - p[0], q[1] - p[1], s[0] - r[0], s[1] - r[1]
    den = rx * sz - rz * sx
    if abs(den) < 1e-9:
        return False
    t = ((r[0] - p[0]) * sz - (r[1] - p[1]) * sx) / den
    u = ((r[0] - p[0]) * rz - (r[1] - p[1]) * rx) / den
    return 0 <= t <= 1 and 0 <= u <= 1


def overpass_heights(nodes, edges, rails):
    """Quote dei nodi dei cavalcavia: ponti OSM in quota (layer >= 1) sopra la ferrovia o sopra un'altra strada,
    tutta la catena del ponte, rampe raccordate fino a 130 m che non salgono sulla strada di sotto."""
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
        if not (flags & 4 and layer >= 1):
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
                if j not in deck and edges[j][5] & 4 and edges[j][7] >= 1:
                    deck.add(j)
                    stack.append(j)
    dist = {}
    queue = []
    for k in deck:
        for n in edges[k][:2]:
            if n not in dist:
                dist[n] = 0.0
                queue.append(n)
    qi = 0
    while qi < len(queue):
        n = queue[qi]
        qi += 1
        for j in at[n]:
            if j in deck:
                continue
            e = edges[j]
            o = e[1] if e[0] == n else e[0]
            d = dist[n] + math.dist(nodes[e[0]], nodes[e[1]])
            if d < R_RAMP and o not in under and (o not in dist or dist[o] > d):
                dist[o] = d
                queue.append(o)
    heights = {}
    for n, d in dist.items():
        u = max(0.0, min(1.0, 1 - d / R_RAMP))
        psv = all(edges[j][5] & 32 for j in at[n])
        h = H_DECK * u * u * (3 - 2 * u) * (PSV_DECK if psv else 1)
        if h > 0.001:
            heights[n] = round(h, 2)
    return heights


def _tram_heights(pts, nodes, edges, heights):
    """Quota di ogni punto di un binario: quella della strada in quota più vicina e quasi parallela (come
    City.nearElevatedHeight nel gioco)."""
    up = [e for e in edges if heights.get(e[0], 0) > 0.05 or heights.get(e[1], 0) > 0.05]
    out = []
    for i, p in enumerate(pts):
        q = pts[min(len(pts) - 1, i + 1)] if i < len(pts) - 1 else pts[i]
        o = pts[max(0, i - 1)] if i == len(pts) - 1 else p
        dx, dz = q[0] - o[0], q[1] - o[1]
        L = math.hypot(dx, dz) or 1
        dx, dz = dx / L, dz / L
        best, h = 1e9, 0.0
        for e in up:
            (ax, az), (bx, bz) = nodes[e[0]], nodes[e[1]]
            ux, uz = bx - ax, bz - az
            l = math.hypot(ux, uz) or 1e-9
            if abs(dx * uz / l - dz * ux / l) > 0.7:
                continue  # di traverso: il tram ci passa sotto
            t = max(0.0, min(1.0, ((p[0] - ax) * ux + (p[1] - az) * uz) / (l * l)))
            d = math.hypot(ax + ux * t - p[0], az + uz * t - p[1])
            if d < e[3] / 2 + 9 and d < best:
                best = d
                h = heights.get(e[0], 0) + (heights.get(e[1], 0) - heights.get(e[0], 0)) * t
        out.append(h)
    return out


def decks(nodes, edges, heights, drive, tram):
    """Impalcati in quota come un'area sola: i tratti di strada e di tram da DECK_MIN in su (carreggiata + 1 m, corsie
    del tram + cordolo), uniti e con la fascia tra impalcati vicini riempita."""
    m = DECK_MIN
    parts = []
    for k in drive:
        a, b, _c, wd = edges[k][:4]
        ha, hb = heights.get(a, 0), heights.get(b, 0)
        if max(ha, hb) < m:
            continue
        t0 = 0.0 if ha >= m else (m - ha) / (hb - ha)
        t1 = 1.0 if hb >= m else (ha - m) / (ha - hb)
        A, B = nodes[a], nodes[b]
        P = lambda t: (A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t)
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
        hs = _tram_heights(dense, nodes, edges, heights)
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
    D = unary_union(parts)
    return D.buffer(DECK_JOIN, quad_segs=4).buffer(-DECK_JOIN, quad_segs=4)


def _polys(geom):
    """Solo i poligoni di una geometria (le differenze possono lasciare linee e punti in una collezione)."""
    if isinstance(geom, Polygon):
        return [geom] if not geom.is_empty else []
    out = []
    for g in getattr(geom, 'geoms', []):
        out += _polys(g)
    return out


def _rings(geom):
    """Poligoni di una geometria come liste di anelli piatti [x0, z0, x1, z1, ...] (esterno, poi i buchi)."""
    polys = [geom] if isinstance(geom, Polygon) else list(geom.geoms) if hasattr(geom, 'geoms') else []
    out = []
    for p in polys:
        if not isinstance(p, Polygon) or p.is_empty or p.area < 0.5:
            continue
        rings = []
        for r in [p.exterior, *p.interiors]:
            c = list(r.coords)[:-1]
            if len(c) >= 3:
                rings.append([round(v, 1) for xy in c for v in xy])
        if rings:
            out.append(rings)
    return out


def surfaces(nodes, edges, heights, buildings, water, tram, bus_edges):
    elev = lambda e: heights.get(e[0], 0) > 0.05 or heights.get(e[1], 0) > 0.05
    seg = lambda e: LineString([nodes[e[0]], nodes[e[1]]])
    drive = [k for k, e in enumerate(edges) if e[2] != 8 and math.dist(nodes[e[0]], nodes[e[1]]) > 0.3]
    ground = [k for k in drive if not elev(edges[k])]
    # carreggiata: ogni tratto allargato (estremi tondi: i giunti delle curve restano pieni)
    pieces = {k: seg(edges[k]).buffer(edges[k][3] / 2, quad_segs=4) for k in drive}
    U = unary_union([pieces[k] for k in ground])
    # isole delle rotatorie: anelli chiusi di archi junction=roundabout, la mezzeria rientrata di metà carreggiata
    ring_at = defaultdict(list)
    for k in ground:
        if edges[k][5] & 16:
            ring_at[edges[k][0]].append(k)
            ring_at[edges[k][1]].append(k)
    seen, ring_islands, ring_roads = set(), [], []
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
        w = sum(edges[k][3] for k in comp) / len(comp)
        # quasi circolare (stessa prova del gioco, City.findRoundabouts): corona circolare esatta, così le righe
        # tracciate dal gioco ci cadono sopra; altrimenti la mezzeria rientrata di metà carreggiata
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
        poly = Polygon([nodes[n] for n in order])
        if poly.is_valid and poly.area > 1:
            isl = poly.buffer(-w / 2)
            if not isl.is_empty and isl.area > 1:
                ring_islands.append(isl)
    ring_islands = unary_union(ring_islands) if ring_islands else Polygon()
    U = unary_union([U, *ring_roads])
    # raccordi agli incroci: chiusura morfologica locale (si riempiono gli angoli rientranti tra due strade)
    tree_keys = ground
    tree = STRtree([pieces[k] for k in tree_keys])
    deg = defaultdict(list)
    for k in ground:
        deg[edges[k][0]].append(k)
        deg[edges[k][1]].append(k)
    fillets = []
    for n, ks in deg.items():
        if len(ks) < 3:
            continue
        bus = any((min(edges[k][0], edges[k][1]), max(edges[k][0], edges[k][1])) in bus_edges for k in ks)
        rf = FILLET_BUS if bus else FILLET
        rad = max(edges[k][3] for k in ks) / 2 + rf * 2.2
        disc = Point(nodes[n]).buffer(rad, quad_segs=8)
        local = unary_union([pieces[tree_keys[i]] for i in tree.query(disc)]).intersection(disc)
        closed = local.buffer(rf, quad_segs=4).buffer(-rf, quad_segs=4)
        fillets.append(closed.intersection(Point(nodes[n]).buffer(rad - rf * 0.6, quad_segs=8)))
    U = unary_union([U, *fillets]).difference(ring_islands).buffer(0)
    # isole: buchi piccoli della carreggiata senza edifici dentro (spartitraffico, isole delle rotatorie)
    bpolys = []
    flat2 = lambda f: [(f[i], f[i + 1]) for i in range(0, len(f), 2)]
    for b in buildings:
        p = Polygon(flat2(b[3]), [flat2(h) for h in (b[4] if len(b) > 4 else []) if len(h) >= 6]) if len(b[3]) >= 6 else Polygon()
        bpolys.append(p if p.is_valid else p.buffer(0))
    btree = STRtree(bpolys)
    islands = [ring_islands] if not ring_islands.is_empty else []
    for p in ([U] if isinstance(U, Polygon) else list(U.geoms)):
        for r in p.interiors:
            h = Polygon(r)
            if h.area < ISLAND_MAX and not any(bpolys[i].intersects(h) for i in btree.query(h)):
                islands.append(h)
    islands = unary_union(islands) if islands else Polygon()
    # edifici fuori da carreggiate (anche quelle in quota), marciapiede minimo e sede del tram
    clear = [unary_union([pieces[k] for k in drive]).buffer(0.8, quad_segs=2)]
    clear += [pieces[k].buffer(BUS_KERB, quad_segs=2) for k in drive if (min(edges[k][0], edges[k][1]), max(edges[k][0], edges[k][1])) in bus_edges]
    for t in tram:
        if len(t) >= 4:
            clear.append(LineString([(t[i], t[i + 1]) for i in range(0, len(t), 2)]).buffer(TRAM_CLEAR, quad_segs=2))
    clear = unary_union(clear)
    ctree = clear
    out_b, moved, dropped = [], 0, 0
    for b, p in zip(buildings, bpolys):
        if not p.intersects(ctree):
            out_b.append(b)
            continue
        rest = p.difference(ctree)
        parts = [g for g in ([rest] if isinstance(rest, Polygon) else list(getattr(rest, 'geoms', []))) if isinstance(g, Polygon) and g.area >= 15]
        if not parts:
            dropped += 1
            continue
        moved += 1
        for g in parts:
            g = g.simplify(0.05)
            flat = [round(v, 1) for xy in list(g.exterior.coords)[:-1] for v in xy]
            holes = [[round(v, 1) for xy in list(r.coords)[:-1] for v in xy] for r in g.interiors]
            out_b.append([b[0], b[1], b[2], flat, holes] if holes else [b[0], b[1], b[2], flat])
    # marciapiede: fascia attorno alla carreggiata e aree pedonali; via isole, acqua (tranne sui ponti) e l'impronta
    # delle rampe in quota. Gli edifici non si tolgono: lo coprono già, e il ritaglio triplicherebbe i vertici
    ped = unary_union([seg(e).buffer(e[3] / 2, quad_segs=4) for e in edges if e[2] == 8 and math.dist(nodes[e[0]], nodes[e[1]]) > 0.3])
    W = unary_union([LineString([(f[i], f[i + 1]) for i in range(0, len(f), 2)]).buffer(wd / 2 + 2) for _n, wd, f in water if len(f) >= 4])
    bridges = unary_union([pieces[k].buffer(BRIDGE_WALK) for k in ground if edges[k][5] & 4])
    islands = islands.difference(W)  # tra due ponti affiancati c'è l'acqua, non un'isola
    # sotto rampe e impalcati niente isole né marciapiedi (la rampa del cavalcavia attraversava un'isola di prato)
    D = decks(nodes, edges, heights, drive, tram)
    up = unary_union([pieces[k] for k in drive if elev(edges[k])])
    islands = islands.difference(up).difference(D)
    # la sede del tram nello spartitraffico (Via Aspetti, Via Guizza) resta libera: l'isola è solo il verde ai lati
    lanes = [LineString([(t[i], t[i + 1]) for i in range(0, len(t), 2)]).buffer(TRAM_LANE, quad_segs=2) for t in tram if len(t) >= 4]
    if lanes:
        islands = islands.difference(unary_union(lanes))
    # marciapiede solo dove la via ce l'ha (flag 64 sinistra, 128 destra): su entrambi i lati una fascia intorno al
    # tratto, su un lato solo una fascia da quel lato
    bands = []
    for k in ground:
        a, b, _c, wd, _n, flags = edges[k][:6]
        sides, d = (flags >> 6) & 3, wd / 2 + SIDEWALK
        if sides == 3:
            bands.append(seg(edges[k]).buffer(d, quad_segs=4))
        elif sides:
            # z verso sud: per Shapely il piano è speculare, la sua sinistra è la nostra destra
            bands.append(seg(edges[k]).buffer(-d if sides == 1 else d, single_sided=True))
    walk = unary_union([*bands, ped]).difference(U).difference(islands)
    walk = walk.difference(W.difference(bridges)).difference(up).difference(D)
    # riquadri: contorni semplificati prima del taglio, così i bordi tra un riquadro e l'altro combaciano; si tagliano
    # i singoli poligoni (indice spaziale) invece dell'intera geometria, che può essere una collezione mista
    layers = [_polys(g.simplify(tol)) for g, tol in ((U, 0.15), (walk, 0.3), (islands, 0.1))]
    trees = [STRtree(L) for L in layers]
    cells = []
    x0, z0, x1, z1 = unary_union([p for L in layers[:2] for p in L]).bounds
    for ix in range(int(x0 // TILE), int(x1 // TILE) + 1):
        for iz in range(int(z0 // TILE), int(z1 // TILE) + 1):
            bx = box(ix * TILE, iz * TILE, (ix + 1) * TILE, (iz + 1) * TILE)
            parts = [[r for i in tr.query(bx) for r in _rings(L[i].intersection(bx))] for L, tr in zip(layers, trees)]
            if any(parts):
                cells.append([ix, iz, *parts])
    stats = {'carreggiata_m2': round(U.area), 'marciapiede_m2': round(walk.area), 'isole': len(getattr(islands, 'geoms', [islands])),
             'impalcati_m2': round(D.area), 'edifici_ritagliati': moved, 'edifici_tolti': dropped, 'riquadri': len(cells)}
    return {'tile': TILE, 'cells': cells, 'decks': [r for p in _polys(D.simplify(0.1)) for r in _rings(p)]}, out_b, stats
