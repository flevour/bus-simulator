#!/usr/bin/env python3
"""Costruisce i dati del gioco unendo OpenStreetMap e GTFS Busitalia Veneto.

Uso:
    python3 scripts/build_map.py data/osm-padova.json <cartella_gtfs> src/data/padova-map.json \
        [data/overture-buildings-padova.parquet] [data/osm-padova-nodes.json]

* OSM (export Overpass in JSON con `out geom`): strade (con nomi, corsie, sensi unici,
  limiti, ponti), edifici (pianta e altezza), ferrovia, fiumi e canali.
* Nodi OSM (facoltativi, scripts/overpass-nodes.ql): semafori, STOP, dare precedenza e
  attraversamenti pedonali reali, agganciati agli incroci e ai tratti del grafo.
* GTFS: linee urbane, varianti, fermate e orari. I tracciati GTFS vengono agganciati
  alla rete OSM (map matching) così che i bus percorrano le strade reali.

Dati © OpenStreetMap contributors (ODbL) e Busitalia Veneto (GTFS, feed BusOne).
"""
import heapq
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import build_gtfs  # noqa: E402  (riusa lettura GTFS e conversioni)
import street_surfaces  # noqa: E402  (pianta delle strade con Shapely)
import aree_mappa  # noqa: E402  (rete e aree della mappa)

ORIGIN_LAT, ORIGIN_LON = build_gtfs.ORIGIN_LAT, build_gtfs.ORIGIN_LON
M_LAT, M_LON = build_gtfs.M_LAT, build_gtfs.M_LON

DRIVE = {
    'trunk': (0, 13), 'trunk_link': (0, 7), 'primary': (1, 12), 'primary_link': (1, 7),
    'secondary': (2, 10.5), 'secondary_link': (2, 7), 'tertiary': (3, 9.5), 'tertiary_link': (3, 7),
    'unclassified': (4, 8), 'residential': (5, 7), 'living_street': (6, 6), 'service': (7, 5.5), 'pedestrian': (8, 6),
}
SKIP_SERVICE = {'parking_aisle', 'driveway', 'drive-through', 'emergency_access'}
# area di gioco (Centro storico + Arcella), in gradi: ovest, sud, est, nord
FOCUS = (11.852, 45.390, 11.912, 45.449)
# fascia sud lungo il tram SIR1, da Bassanello al capolinea della Guizza
FOCUS_SUD = (11.855, 45.362, 11.885, 45.392)
# piccoli riquadri dove i percorsi GTFS escono dall'area per poche centinaia di metri e rientrano: senza le strade il map
# matching li collegava con giri di chilometri (linea 22 in Via Madonna della Salute, 9 e 42 a est, 4, 13 e 17 a nord,
# 21 a ovest, 11 a sud)
FOCUS_BORDI = [
    (11.9125, 45.4250, 11.9165, 45.4350),  # Via Madonna della Salute e Cavalcavia Mortise (22)
    (11.9125, 45.4185, 11.9155, 45.4210),  # 9 e 42 verso l'Ippodromo
    (11.8720, 45.4485, 11.8780, 45.4525),  # 13 e 17 verso Altichiero
    (11.8960, 45.4485, 11.9070, 45.4550),  # 4 verso Cadoneghe
    (11.8470, 45.4245, 11.8525, 45.4280),  # 21 verso Ponterotto
    (11.8850, 45.3875, 11.8905, 45.3905),  # 11 e 11B verso Due Palazzi
]
FOCUS_BOXES = [FOCUS, FOCUS_SUD] + FOCUS_BORDI
# l'area fino ai capolinea veri (corsia capolinea, docs/ESTENSIONE_LINEE.md): corridoi di celle da CELLA metri attorno ai
# percorsi completi delle linee, più una cella di margine, invece di rettangoli più grandi. Tram: le linee di
# data/tram-linee-nuove.json (il SIR3 fino a Voltabarozzo, con il deposito accanto al capolinea; il SIR2 da Rubano, via
# Pria Fosca, al capolinea di Vigonza prima della rotonda della SR11). Autobus: le celle
# toccate dai tracciati GTFS di tutte le varianti delle linee di CORRIDOI_BUS, senza margine (le vie e gli edifici a
# meno di 0,0015 gradi da una cella entrano lo stesso, in_focus); quelle linee hanno tutte le varianti
# (build_gtfs.load). La 25 dal SIR2 (il corridoio la taglia nella zona industriale: intera, parte dalla stazione come
# prima); poi la 24, la 3, la 22, la 10 e la 11 (gruppo 2). Strade e segnaletica fuori dagli export di oggi in
# data/osm-corridoio.json (scripts/filter_osm_corridoio.py)
CELLA = 250.0
CORRIDOI_TRAM = ('SIR3', 'SIR2')
CORRIDOI_BUS = ('25',)
TRAM_NUOVE = __file__.rsplit('/', 2)[0] + '/data/tram-linee-nuove.json'
FOCUS_CELLE = set()  # (ix, iz) delle celle, riempito da main()
WATER_W ={'brenta': 70, 'bacchiglione': 38, 'piovego': 26, 'scaricatore': 34, 'roncajette': 30, 'tronco maestro': 22, 'naviglio': 14}


def xz(lat, lon):
    return ((lon - ORIGIN_LON) * M_LON, -(lat - ORIGIN_LAT) * M_LAT)


def latlon(x, z):
    return ORIGIN_LAT - z / M_LAT, ORIGIN_LON + x / M_LON


def rdp(pts, eps, keep=None):
    """Douglas-Peucker; keep = indici da non togliere."""
    if len(pts) < 3:
        return list(range(len(pts)))
    keep = keep or set()
    out = {0, len(pts) - 1} | keep
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, az), (bx, bz) = pts[a], pts[b]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            d = abs((px - ax) * dz - (pz - az) * dx) / L
            if i in keep:
                d = 1e9
            if d > best:
                best, bi = d, i
        if best > eps and bi > 0:
            out.add(bi)
            stack += [(a, bi), (bi, b)]
    return sorted(out)


def width_of(tags, cls_w):
    lanes = tags.get('lanes')
    try:
        n = float(lanes.split(';')[0]) if lanes else None
    except ValueError:
        n = None
    oneway = tags.get('oneway') in ('yes', '1', '-1') or tags.get('junction') == 'roundabout'
    if n:
        w = n * 3.3 + 1.2
    else:
        w = cls_w * (0.62 if oneway and cls_w > 6 else 1)
    # senso unico con la corsia dei bus in controsenso (Corso Vittorio Emanuele, Riviera del Businello)
    if 'opposite_lane' in (tags.get('psv', ''), tags.get('busway', ''), tags.get('bus', '')):
        w += 3.3
    return round(max(5.0, min(16, w)), 1)


def sidewalk_sides(tags):
    """Lati con il marciapiede (1 sinistra, 2 destra, rispetto al verso della way): dai tag sidewalk quando ci sono;
    senza tag sulle vie urbane sì, su tangenziali, rampe di svincolo e strade di servizio no."""
    no = (None, 'no', 'none')
    left, right, both = tags.get('sidewalk:left'), tags.get('sidewalk:right'), tags.get('sidewalk:both')
    if left or right:
        return (0 if left in no else 1) | (0 if right in no else 2)
    v = tags.get('sidewalk') or both
    if v in ('no', 'none'):
        return 0
    if v in ('left', 'right'):
        return 1 if v == 'left' else 2
    if v:
        return 3
    hw = tags['highway']
    return 0 if hw in ('trunk', 'service') or hw.endswith('_link') else 3


def psv_lane(tags):
    """Corsia riservata ai mezzi pubblici (vietata alle auto): access=no con psv/bus ammessi."""
    psv = tags.get('psv') in ('yes', 'designated') or tags.get('bus') in ('yes', 'designated')
    return psv and (tags.get('access') in ('no', 'private') or tags.get('motor_vehicle') in ('no', 'psv'))


def _num(v):
    try:
        return int(float(v.split(';')[0])) if v else None
    except ValueError:
        return None


def lane_tags(t, ow, width):
    """Corsie di una via dai tag OSM, nel verso della way (avanti) e contro (indietro): (corsie avanti, corsie indietro,
    di cui dei bus avanti, dei bus indietro, sorpasso vietato avanti, indietro, segnaletica). Le corsie dei bus sono
    contate in lanes (wiki OSM) e stanno a destra di chi le percorre; segnaletica: 0 non detta, 1 sì, 2 no
    (lane_markings). Una via a doppio senso con lanes=1 ha zero corsie: niente mezzeria. None se OSM non dice niente."""
    keys = ('lanes', 'lanes:forward', 'lanes:backward', 'busway', 'busway:right', 'busway:left', 'busway:both',
            'lanes:psv', 'lanes:psv:forward', 'lanes:psv:backward', 'lanes:bus', 'lanes:bus:forward', 'lanes:bus:backward',
            'psv:lanes', 'psv:lanes:forward', 'psv:lanes:backward', 'bus:lanes', 'bus:lanes:forward', 'bus:lanes:backward',
            'overtaking', 'overtaking:forward', 'overtaking:backward', 'lane_markings')
    if not any(k in t for k in keys):
        return None
    lanes, lf, lb = _num(t.get('lanes')), _num(t.get('lanes:forward')), _num(t.get('lanes:backward'))
    # corsie dei bus per verso: contate (lanes:psv...), per posizione (psv:lanes = yes|designated) o busway
    bf = bb = 0
    for pre in ('lanes:psv', 'lanes:bus'):
        if _num(t.get(pre)):
            if ow >= 0:
                bf = 1
            if ow <= 0:
                bb = 1
        bf = max(bf, min(1, _num(t.get(pre + ':forward')) or 0))
        bb = max(bb, min(1, _num(t.get(pre + ':backward')) or 0))
    for pre in ('psv:lanes', 'bus:lanes'):
        if 'designated' in t.get(pre, '').split('|'):
            bf, bb = (1, bb) if ow >= 0 else (bf, 1)
        bf = max(bf, 1 if 'designated' in t.get(pre + ':forward', '').split('|') else 0)
        bb = max(bb, 1 if 'designated' in t.get(pre + ':backward', '').split('|') else 0)
    counted = bf or bb
    lane_v = ('lane', 'yes')
    bw, right, left, both = t.get('busway'), t.get('busway:right'), t.get('busway:left'), t.get('busway:both')
    contra = 'opposite_lane' in (bw, left, t.get('psv'), t.get('bus')) or (left in lane_v and t.get('busway:left:oneway') == '-1')
    if bw in lane_v or both in lane_v:
        bf, bb = (1, bb) if ow > 0 else (bf, 1) if ow < 0 else (1, 1)
    if right in lane_v:
        bf = 1
    if left in lane_v and not contra:
        bb, bf = (1, bf) if not ow else (bb, 1)
    if contra:
        if ow > 0:
            bb = 1
        elif ow < 0:
            bf = 1
        else:
            bb = 1  # doppio senso con la corsia "in controsenso": quella dell'altro verso è dei bus
    if lf is not None or lb is not None:
        nf = lf if lf is not None else max(0, (lanes or 0) - (lb or 0)) or 1
        nb = lb if lb is not None else max(0, (lanes or 0) - nf) or 1
    elif ow:
        n = lanes or 1
        # corsia dei bus in controsenso: contata in lanes solo se la carreggiata non basta per una corsia in più
        k = bb if ow > 0 else bf
        if k and lanes and lanes >= 2 and width < (lanes + 1) * 3.0:
            n = lanes - 1
        nf, nb = (n, k) if ow > 0 else (k, n)
    elif lanes == 1:
        nf = nb = 0
    else:
        nf = nb = max(1, (lanes or 2) // 2)
        if lanes and lanes % 2:
            nf += 1
    # con busway (non con le corsie contate) nel verso delle auto almeno una corsia oltre a quella dei bus: busway=lane
    # spesso non è contata in lanes; il verso della corsia in controsenso è solo dei bus
    if not counted and bf and nf and nf <= bf and ow >= 0:
        nf = bf + 1
    if not counted and bb and nb and nb <= bb and ow <= 0 and not contra:
        nb = bb + 1
    bf, bb = min(bf, nf), min(bb, nb)
    ovf = 1 if 'no' in (t.get('overtaking'), t.get('overtaking:forward')) else 0
    ovb = 1 if 'no' in (t.get('overtaking'), t.get('overtaking:backward')) else 0
    mark = {'yes': 1, 'no': 2}.get(t.get('lane_markings'), 0)
    return (min(nf, 7), min(nb, 7), bf, bb, ovf, ovb, mark)


def lane_code(lt):
    """Corsie di un arco in un intero: 3 bit per le corsie avanti e indietro, poi corsie dei bus avanti e indietro,
    sorpasso vietato avanti e indietro, segnaletica (2 bit)."""
    nf, nb, bf, bb, ovf, ovb, mark = lt
    return nf | nb << 3 | bf << 6 | bb << 7 | ovf << 8 | ovb << 9 | mark << 10


def turn_tags(t, ow):
    """Frecce a terra da turn:lanes nel verso della way e contro (stringhe 'left|through', '' se non ci sono)."""
    f, b = t.get('turn:lanes:forward', ''), t.get('turn:lanes:backward', '')
    if 'turn:lanes' in t:
        if ow < 0:
            b = b or t['turn:lanes']
        else:
            f = f or t['turn:lanes']
    return f, b


def bus_both_ways(tags):
    """Senso unico per le auto ma con i bus ammessi anche in controsenso (corsia bus in controsenso)."""
    return (tags.get('oneway:bus') == 'no' or tags.get('oneway:psv') == 'no' or 'opposite' in tags.get('busway', '')
            or 'opposite' in tags.get('busway:left', '') or 'opposite' in tags.get('busway:right', '')
            or tags.get('lanes:bus:backward', '0') not in ('0', '') or tags.get('lanes:psv:backward', '0') not in ('0', ''))


def speed_of(tags):
    m = re.match(r'(\d+)', tags.get('maxspeed', ''))
    return int(m.group(1)) if m else 0


def in_focus(lat, lon, m=0.0):
    """Il punto è nell'area di gioco, allargata di m gradi: nei riquadri o in una cella dei corridoi."""
    if any(b[0] - m <= lon <= b[2] + m and b[1] - m <= lat <= b[3] + m for b in FOCUS_BOXES):
        return True
    x, z = xz(lat, lon)
    mx, mz, C = m * M_LON, m * M_LAT, CELLA
    i, j = math.floor(x / C), math.floor(z / C)
    return any((i + a, j + b) in FOCUS_CELLE and (i + a) * C - mx <= x <= (i + a + 1) * C + mx and (j + b) * C - mz <= z <= (j + b + 1) * C + mz
               for a in (-1, 0, 1) for b in (-1, 0, 1))


def corridor_cells(paths, cell=CELLA, ring=1):
    """Celle (ix, iz) da cell metri toccate dai percorsi (liste di punti lat/lon), più ring celle tutto attorno."""
    hit = set()
    for pts in paths:
        q = [xz(la, lo) for la, lo in pts]
        for (ax, az), (bx, bz) in zip(q, q[1:]):
            n = max(1, int(math.hypot(bx - ax, bz - az) // (cell / 4)))
            for i in range(n + 1):
                hit.add((math.floor((ax + (bx - ax) * i / n) / cell), math.floor((az + (bz - az) * i / n) / cell)))
    return {(i + a, j + b) for i, j in hit for a in range(-ring, ring + 1) for b in range(-ring, ring + 1)}


def tram_corridors(path=TRAM_NUOVE, ids=CORRIDOI_TRAM):
    """Celle dei corridoi attorno ai binari delle linee del tram nuove (tutti e due i versi)."""
    linee = json.load(open(path, encoding='utf-8'))['linee']
    return corridor_cells([v['percorso'] for l in linee if l['id'] in ids for v in l['versi']])


def bus_corridors(gt, ids=CORRIDOI_BUS):
    """Celle toccate dai tracciati GTFS delle linee ids (gt: build_gtfs.load con quelle linee in full)."""
    return corridor_cells([v['shape_pts'] for l in gt['lines'] if l['id'] in ids for v in l['variants']], ring=0)


STOP_WORDS = {'via', 'viale', 'corso', 'piazza', 'piazzale', 'p', 'zza', 'largo', 'fr', 'ang', 'incr', 'angolo', 'di', 'del',
              'della', 'dei', 'de', 'da', 'e', 'f', 't'}


def name_tokens(n):
    """Parole di un nome di fermata, senza "via", "fr.", "ang." e simili (i numeri civici contano)."""
    return {t for t in re.findall(r'[a-zà-ù]+|[0-9]+', (n or '').lower()) if t not in STOP_WORDS and len(t) > 1}


def snap_stops_to_osm(stops, osm, reach=25.0, name_reach=50.0, min_sim=0.6):
    """Fermate GTFS sulla palina OSM (highway=bus_stop, data/osm-fermate.json), una palina per fermata.
    Prima le coppie con lo stesso nome (somiglianza pesata: "Giotto", comune a tutte le fermate della via, conta poco;
    "Contarine" molto) entro name_reach metri, dalle più somiglianti; poi le altre fermate sulla palina più vicina entro
    reach metri. Così "Giotto Contarine" va su "Via Giotto / Porte Contarine" e non sulla palina di "Giotto Centro
    Strada", che è più vicina. Aggiunge in fondo pensilina e panchina di OSM (1, 0 o None). Restituisce quante fermate
    sono state spostate."""
    df = Counter()
    for n in [s[2] for s in stops] + [o[2] for o in osm]:
        df.update(name_tokens(n))
    N = len(stops) + len(osm)

    def w(t):
        return math.log(N / df[t]) if df[t] else 1.0

    def sim(a, b):
        A, B = name_tokens(a), name_tokens(b)
        if not A or not B:
            return 0.0
        return 2 * sum(w(t) for t in A & B) / (sum(map(w, A)) + sum(map(w, B)))

    C = 50
    grid = defaultdict(list)
    for j, o in enumerate(osm):
        grid[(int(o[0] // C), int(o[1] // C))].append(j)
    near = []
    for i, s in enumerate(stops):
        for gx in range(int((s[0] - name_reach) // C), int((s[0] + name_reach) // C) + 1):
            for gz in range(int((s[1] - name_reach) // C), int((s[1] + name_reach) // C) + 1):
                for j in grid.get((gx, gz), ()):
                    d = math.hypot(osm[j][0] - s[0], osm[j][1] - s[1])
                    if d <= name_reach:
                        near.append((d, i, j, sim(s[2], osm[j][2])))
    used_s, used_o, moved = set(), set(), 0
    by_name = [q for q in near if q[3] >= min_sim]
    # senza parole in comune la palina vicina vale solo entro 15 m ("Ferrovia (Ex Catasto)", sulla strada a sud del
    # piazzale, finiva sulla banchina "Piazzale Stazione" a 24,6 m)
    by_dist = [q for q in near if q[0] <= reach and (q[3] > 0 or q[0] <= 15)]
    for d, i, j, _sm in sorted(by_name, key=lambda q: (-round(q[3], 2), q[0])) + sorted(by_dist):
        if i in used_s or j in used_o:
            continue
        used_s.add(i)
        used_o.add(j)
        s, o = stops[i], osm[j]
        s[0], s[1] = o[0], o[1]
        while len(s) < 4:
            s.append('')
        s[4:] = [o[4], o[5]]
        moved += d > 0.5
    return moved


def onto_platforms(stops, platforms, reach=6.0):
    """Fermate a pochi metri da una banchina dei bus (stazione: la palina OSM della Corsia 2 sta 4 m prima della punta
    della banchina) portate sulla banchina, mezzo metro dentro: il bus si ferma accanto alla banchina, non prima."""
    from shapely.geometry import Point, Polygon
    from shapely.ops import nearest_points
    polys = [Polygon([(f[i], f[i + 1]) for i in range(0, len(f), 2)]).buffer(0) for f in platforms if len(f) >= 6]
    moved = 0
    for s in stops:
        p = Point(s[0], s[1])
        d, g = min(((g.distance(p), g) for g in polys), key=lambda q: q[0], default=(1e9, None))
        if 0 < d < reach:
            inner = g.buffer(-0.5)
            q = nearest_points(inner if not inner.is_empty else g, p)[0]
            s[0], s[1] = round(q.x, 1), round(q.y, 1)
            moved += 1
    return moved


def cut_path(seq, nodes, stops, margin=60.0):
    """Cammino seq (nodi del grafo) da margin metri prima della prima fermata a margin metri dopo l'ultima. Le fermate
    (x, z) vanno sui tratti del cammino in ordine, con la somma delle distanze più piccola (programmazione dinamica): le
    linee ad anello passano due volte accanto al capolinea, e la prima fermata è quella della partenza."""
    def d(p, i):
        (ax, az), (bx, bz) = nodes[seq[i]], nodes[seq[i + 1]]
        dx, dz = bx - ax, bz - az
        t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz or 1e-9)))
        return math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t)
    seg = lambda i: math.dist(nodes[seq[i]], nodes[seq[i + 1]])
    S = len(seq) - 1
    if S < 2 or not stops:
        return seq
    # cost[i]: fermate fin qui sistemate, l'ultima sul tratto i; back[k][i]: tratto della fermata precedente
    cost = [d(stops[0], i) for i in range(S)]
    back = []
    for p in stops[1:]:
        best, arg, b, new = 1e18, 0, [], []
        for i in range(S):
            if cost[i] < best:
                best, arg = cost[i], i
            b.append(arg)
            new.append(best + d(p, i))
        back.append(b)
        cost = new
    idxs = [min(range(S), key=lambda i: cost[i])]
    for b in reversed(back):
        idxs.append(b[idxs[-1]])
    idxs.reverse()
    i0, i1 = idxs[0], idxs[-1]
    nxt, prv = (idxs[1], idxs[-2]) if len(idxs) > 1 else (S, 0)
    uturn = lambda j: 0 < j < S and seq[j - 1] == seq[j + 1]
    mirror = lambda i, j: 2 * j - 1 - i if 0 <= 2 * j - 1 - i < S and seq[2 * j - 1 - i] == seq[i + 1] and seq[2 * j - i] == seq[i] else None
    # il percorso esce dalla mappa e rientra per la stessa via (andata e ritorno con l'inversione a U sulla punta): la
    # prima fermata va sul ritorno, nel verso della linea, e si parte dalla punta; l'ultima sull'andata, e si finisce lì
    a = b = None
    for j in range(i0 + 1, min(nxt, S)):
        if uturn(j) and mirror(i0, j) is not None and mirror(i0, j) <= nxt:
            i0, a = mirror(i0, j), j
            break
    for j in range(i1, prv, -1):
        if uturn(j) and mirror(i1, j) is not None and mirror(i1, j) >= prv:
            i1, b = mirror(i1, j), j
            break
    if a is None:
        a, L = i0, 0.0
        while a > 0 and L < margin and not uturn(a):
            a -= 1
            L += seg(a)
    if b is None:
        b, L = i1 + 1, 0.0
        while b < S and L < margin and not uturn(b):
            L += seg(b)
            b += 1
    # niente tornante in testa o in coda: un tratto corto prima di una svolta stretta, con la fermata non più vicina a
    # lui che al nodo della svolta, è l'aggancio che entra da una via laterale dove il percorso vero arriva da fuori
    # (la 24 a Volta fr. 24 arriva da ovest per Via Volta, fuori dall'area; l'aggancio partiva da Via Rosa Luxemburg)
    def sharp(j):
        (ax, az), (bx, bz), (cx, cz) = nodes[seq[j - 1]], nodes[seq[j]], nodes[seq[j + 1]]
        u, w = (bx - ax, bz - az), (cx - bx, cz - bz)
        return u[0] * w[0] + u[1] * w[1] < math.cos(math.radians(75)) * math.hypot(*u) * math.hypot(*w)
    near_node = lambda p, j: math.dist(p, nodes[seq[j]])
    while b - a > 2 and seg(a) < 25 and sharp(a + 1) and d(stops[0], a) >= near_node(stops[0], a + 1) - 5:
        a += 1
    while b - a > 2 and seg(b - 1) < 25 and sharp(b - 1) and d(stops[-1], b - 1) >= near_node(stops[-1], b - 1) - 5:
        b -= 1
    return seq[a:b + 1]


def gtfs_cover(gt, step=4.0, reach=6.0, share=0.7):
    """Funzione che dà i pezzi di una via (punti x, z) coperti dai tracciati GTFS dei bus, come coppie (primo punto,
    ultimo punto): tratti consecutivi con almeno share dei loro punti, presi ogni step metri, a meno di reach metri da
    un tracciato, lunghi in tutto almeno 10 m."""
    C = reach
    cells = set()
    for line in gt['lines']:
        for v in line['variants']:
            pts = [xz(la, lo) for la, lo in v['shape_pts']]
            for (ax, az), (bx, bz) in zip(pts, pts[1:]):
                n = max(1, int(math.hypot(bx - ax, bz - az) // step))
                for i in range(n + 1):
                    cells.add((int((ax + (bx - ax) * i / n) // C), int((az + (bz - az) * i / n) // C)))

    near = lambda x, z: any((int(x // C) + dx, int(z // C) + dz) in cells for dx in (-1, 0, 1) for dz in (-1, 0, 1))

    def covered(pts):
        ok = []
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            n = max(1, int(math.hypot(bx - ax, bz - az) // step))
            ok.append(sum(1 for i in range(n + 1) if near(ax + (bx - ax) * i / n, az + (bz - az) * i / n)) >= share * (n + 1))
        runs, i = [], 0
        while i < len(ok):
            if not ok[i]:
                i += 1
                continue
            j = i
            while j < len(ok) and ok[j]:
                j += 1
            if sum(math.dist(pts[k], pts[k + 1]) for k in range(i, j)) >= 10:
                runs.append((i, j))
            i = j
        return runs
    return covered


def gtfs_links(els, ways, covered, share=0.7):
    """Vie fuori dall'area che collegano due vie dell'area (tra due loro nodi in comune) dove passa un tracciato GTFS dei
    bus: al bordo dell'area il map matching altrimenti salta il pezzo o fa un giro (la 3 in Via Bembo verso Lion girava
    per 2,7 km di vie residenziali; con Via del Cristo nel corridoio del SIR3 saltava 282 m)."""
    have = {w['id'] for w in ways}
    on = {n for w in ways if w.get('tags', {}).get('highway') in DRIVE for n in w['nodes']}
    out = []
    for e in els:
        if e['type'] != 'way' or 'geometry' not in e or e['id'] in have or e.get('tags', {}).get('highway') not in DRIVE:
            continue
        k = [i for i, n in enumerate(e['nodes']) if n in on]
        if len(k) < 2:
            continue
        pts = [xz(g['lat'], g['lon']) for g in e['geometry'][k[0]:k[-1] + 1]]
        L = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        if L >= 5 and sum(math.dist(pts[q], pts[q + 1]) for i, j in covered(pts) for q in range(i, j)) > share * L:
            out.append(e)
    return out


def measured_piece(meas, s):
    """Tratto misurato (data/misure-strade.json) della via che contiene il punto a s metri dall'inizio."""
    for p in meas or ():
        if p[0] <= s < p[1]:
            return p
    return None


def main(osm_path, gtfs_dir, out, overture_path=None, nodes_path=None, tram_path=None, measures_path=None, volumes_path=None, dtm_path=None, green_path=None, streets_path=None, osm_stops_path=None, corridor_path=None):
    els = json.load(open(osm_path, encoding='utf-8'))['elements']
    if corridor_path:
        els += [e for e in json.load(open(corridor_path, encoding='utf-8'))['elements'] if e['type'] == 'way']
    # larghezze misurate di carreggiate e marciapiedi (scripts/measure_streets.py), per via OSM
    measures = json.load(open(measures_path, encoding='utf-8'))['vie'] if measures_path else {}
    gt = build_gtfs.load(gtfs_dir, full=CORRIDOI_BUS)
    FOCUS_CELLE.update(tram_corridors())
    FOCUS_CELLE.update(bus_corridors(gt))
    print(f'corridoi fino ai capolinea: {len(FOCUS_CELLE)} celle da {CELLA:.0f} m ({len(FOCUS_CELLE) * CELLA * CELLA / 1e6:.1f} km²)')
    # solo gli elementi che toccano l'area di gioco (con un piccolo margine)
    ways =[e for e in els if e['type'] == 'way' and 'geometry' in e and any(in_focus(g['lat'], g['lon'], 0.0015) for g in e['geometry'])]

    # ---------------- strade ----------------
    on_gtfs = gtfs_cover(gt)
    links = gtfs_links(els, ways, on_gtfs)
    print('vie fuori dall\'area tra due vie dell\'area, dove passa un bus:', ', '.join(f"{w['tags'].get('name', '')} ({w['id']})" for w in links))
    ways += links
    roads, gtfs_ways = [], set()
    for w in ways:
        t = w.get('tags', {})
        hw = t.get('highway')
        if hw not in DRIVE or t.get('area') == 'yes':
            continue
        # i passi carrai e le corsie dei parcheggi si saltano, tranne quelli con il nome di una via (in OSM a volte le
        # piazze e gli anelli dei capolinea sono segnati così, Largo Claude Debussy) e quelli dove passa un tracciato GTFS
        # dei bus (l'anello del Capolinea Plebiscito è nel parcheggio)
        if hw == 'service' and t.get('service') in SKIP_SERVICE and not (t.get('service') == 'driveway' and t.get('name')):
            # solo i pezzi dove passa il bus: dell'anello del parcheggio del Capolinea Plebiscito il bus fa 30 m su 380
            for i, j in on_gtfs([xz(g['lat'], g['lon']) for g in w['geometry']]):
                roads.append({**w, 'nodes': w['nodes'][i:j + 1], 'geometry': w['geometry'][i:j + 1]})
                gtfs_ways.add(w['id'])
            continue
        if t.get('access') in ('no', 'private') and hw in ('service', 'pedestrian') and not psv_lane(t):
            continue
        roads.append(w)
    print(f'corsie di servizio tenute perché ci passa un bus: {len(gtfs_ways)}')
    use = defaultdict(int)
    for w in roads:
        for i, n in enumerate(w['nodes']):
            use[n] += 2 if i in (0, len(w['nodes']) - 1) else 1
    node_id = {}
    nodes = []

    def nid(osm, lat, lon):
        if osm not in node_id:
            node_id[osm] = len(nodes)
            nodes.append(xz(lat, lon))
        return node_id[osm]

    names = []
    name_idx = {}

    def name_ref(s):
        if s not in name_idx:
            name_idx[s] = len(names)
            names.append(s)
        return name_idx[s]

    sign_els = (load_nodes(nodes_path) if nodes_path else []) + (load_nodes(corridor_path) if corridor_path else [])
    ped_gap = ped_signal_gaps(sign_els)

    edges = []  # a, b, cls, width, name, flags, speed, layer
    edge_walk = []  # per ogni arco: marciapiede misurato a sinistra e a destra (0 = non misurato)
    edge_lanes = {}  # arco -> corsie dai tag OSM (lane_tags), nel verso a -> b
    turns = []  # [arco, frecce nel verso a -> b, frecce contro]: sull'ultimo arco della via in ciascun verso
    table_ways = []  # (primo arco, ultimo arco) delle vie rialzate (traffic_calming=table)
    gtfs_edges = set()  # archi delle corsie di servizio tenute perché ci passa un bus (gli anelli dei capolinea)
    n_meas = 0
    way_geo = []  # per ogni strada: id OSM dei nodi, punti, posizioni tenute, nodi del grafo, senso unico, tag
    for w in roads:
        t = w['tags']
        cls, cw = DRIVE[t['highway']]
        pts = [xz(g['lat'], g['lon']) for g in w['geometry']]
        junc = {i for i, n in enumerate(w['nodes']) if use[n] > 1}
        # semafori pedonali lontani dagli incroci: il loro nodo resta nel grafo, così l'auto si ferma lì
        fixed = set(junc)
        if any(n in ped_gap for n in w['nodes']):
            cum = [0.0]
            for p, q in zip(pts, pts[1:]):
                cum.append(cum[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
            for i, n in enumerate(w['nodes']):
                if n in ped_gap and min((abs(cum[i] - cum[j]) for j in junc), default=1e9) >= ped_gap[n]:
                    fixed.add(i)
        keep = rdp(pts, 1.2, fixed)
        ow = 1 if t.get('oneway') in ('yes', '1') or t.get('junction') == 'roundabout' else -1 if t.get('oneway') == '-1' else 0
        flags = (1 if ow == 1 else 0) | (2 if ow == -1 else 0) | (4 if t.get('bridge') not in (None, 'no') else 0) | (8 if t.get('tunnel') not in (None, 'no') else 0) | (16 if t.get('junction') == 'roundabout' else 0) | (32 if psv_lane(t) else 0) | (sidewalk_sides(t) << 6) | (256 if ow and bus_both_ways(t) else 0)
        try:
            layer = int(t.get('layer', '0').split(';')[0])
        except ValueError:
            layer = 0
        wd = width_of(t, cw)
        nm = name_ref(t.get('name', ''))
        sp = speed_of(t)
        ids = [nid(w['nodes'][i], w['geometry'][i]['lat'], w['geometry'][i]['lon']) for i in keep]
        way_geo.append((w['nodes'], pts, keep, ids, ow, t))
        meas = measures.get(str(w['id'])) if w['id'] not in gtfs_ways else None  # dei pezzi non vale la progressiva
        if meas:
            cum = [0.0]
            for p, q in zip(pts, pts[1:]):
                cum.append(cum[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
        first = len(edges)
        for k, (a, b) in enumerate(zip(ids, ids[1:])):
            if a != b:
                # carreggiata misurata nel tratto che contiene il punto medio dell'arco
                pc = measured_piece(meas, (cum[keep[k]] + cum[keep[k + 1]]) / 2) if meas else None
                we = wd
                if pc and pc[2] and cls != 8:
                    we = round(max(3.0, min(25.0, pc[2])), 1)
                    n_meas += 1
                lt = lane_tags(t, ow, we)
                if lt:
                    edge_lanes[len(edges)] = lt
                edges.append([a, b, cls, we, nm, flags, sp, layer])
                edge_walk.append((pc[3], pc[4]) if pc else (0.0, 0.0))
        if w['id'] in gtfs_ways:
            gtfs_edges.update(range(first, len(edges)))
        if t.get('traffic_calming') == 'table' and len(edges) > first:
            table_ways.append((first, len(edges) - 1))
        tf, tb = turn_tags(t, ow)
        if (tf or tb) and len(edges) > first:
            # turn:lanes vale alla fine della via: frecce sull'ultimo arco in ciascun verso
            if tf:
                turns.append([len(edges) - 1, tf, ''])
            if tb:
                turns.append([first, '', tb])
    if measures:
        print(f'archi con la carreggiata misurata: {n_meas} su {len(edges)}')
    print(f'corsie dai tag OSM: {len(edge_lanes)} archi, con la corsia dei bus {sum(1 for v in edge_lanes.values() if v[2] or v[3])}, '
          f'sorpasso vietato {sum(1 for v in edge_lanes.values() if v[4] or v[5])}, frecce {len(turns)}')

    signage = osm_signage(sign_els, ped_gap, way_geo, node_id, nodes, edges) if nodes_path else {}
    # vie rialzate: una rampa (tipo 4) a ciascuna estremità, che sale nel verso da a verso b (il gioco la tiene fuori
    # dall'incrocio): all'inizio della via il primo arco, alla fine l'ultimo percorso al contrario
    for k0, k1 in table_ways:
        a, b = edges[k0][:2]
        signage.setdefault('calming', []).append([a, b, 0.0, 4])
        a, b = edges[k1][:2]
        signage['calming'].append([b, a, 0.0, 4])
    if table_ways:
        print(f'vie rialzate: {len(table_ways)}')

    # adiacenza per il map matching
    adj = defaultdict(list)
    for k, (a, b, cls, _w, _n, flags, *_r) in enumerate(edges):
        L = math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1])
        # le corsie riservate costano come una strada normale: sono fatte per i bus
        cost = L * (1.0 if cls <= 5 or flags & 32 else 1.6 if cls == 6 else 2.5 if cls == 7 else 3.5)
        # sensi unici: contromano molto penalizzato (il tracciato GTFS può tagliare un piazzale: alla stazione si girava
        # contromano); le corsie bus in controsenso (flag 256) non costano di più
        fwd_pen = 6.0 if flags & 2 and not flags & 256 else 1.0
        back_pen = 6.0 if flags & 1 and not flags & 256 else 1.0
        adj[a].append((b, cost * fwd_pen, k))
        adj[b].append((a, cost * back_pen, k))

    # griglia degli archi per gli agganci
    CELL = 40
    egrid = defaultdict(list)
    for k, (a, b, *_r) in enumerate(edges):
        (ax, az), (bx, bz) = nodes[a], nodes[b]
        for gx in range(int(math.floor(min(ax, bx) / CELL)), int(math.floor(max(ax, bx) / CELL)) + 1):
            for gz in range(int(math.floor(min(az, bz) / CELL)), int(math.floor(max(az, bz) / CELL)) + 1):
                egrid[(gx, gz)].append(k)

    def candidates(x, z, r=30, n=4):
        out = {}
        for gx in range(int((x - r) // CELL), int((x + r) // CELL) + 1):
            for gz in range(int((z - r) // CELL), int((z + r) // CELL) + 1):
                for k in egrid.get((gx, gz), ()):
                    if k in out:
                        continue
                    a, b = edges[k][0], edges[k][1]
                    (ax, az), (bx, bz) = nodes[a], nodes[b]
                    dx, dz = bx - ax, bz - az
                    l2 = dx * dx + dz * dz or 1e-9
                    tt = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / l2))
                    d = math.hypot(x - ax - dx * tt, z - az - dz * tt)
                    if d <= r:
                        out[k] = (d, tt)
        return sorted(((d, k, tt) for k, (d, tt) in out.items()))[:n]

    def dijkstra(src, limit):
        dist = {src: 0.0}
        prev = {}
        pq = [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, 1e18) or d > limit:
                continue
            for v, c, k in adj[u]:
                nd = d + c
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        return dist, prev

    def path_nodes(prev, src, dst):
        p = [dst]
        while p[-1] != src:
            p.append(prev[p[-1]])
        return p[::-1]

    def match(shape_pts):
        """Map matching semplice (Viterbi su candidati) da punti GTFS a cammino di nodi OSM."""
        pts = [xz(la, lo) for la, lo in shape_pts]
        # densifica a ~25 m
        dense = [pts[0]]
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            L = math.hypot(bx - ax, bz - az)
            n = max(1, int(L // 25))
            for i in range(1, n + 1):
                dense.append((ax + (bx - ax) * i / n, az + (bz - az) * i / n))
        layers = []
        for x, z in dense:
            c = candidates(x, z)
            if c:
                layers.append((x, z, c))
        if len(layers) < 2:
            return None
        # stato = (nodo d'ingresso scelto per il candidato): usiamo il nodo più vicino dell'arco
        def cand_node(k, tt):
            a, b = edges[k][0], edges[k][1]
            return a if tt < 0.5 else b
        score = [(d * 2.0, None, cand_node(k, tt)) for d, k, tt in layers[0][2]]
        back = []
        for li in range(1, len(layers)):
            x0, z0, _ = layers[li - 1]
            x1, z1, cands = layers[li]
            straight = math.hypot(x1 - x0, z1 - z0)
            new = []
            for d, k, tt in cands:
                node = cand_node(k, tt)
                best = (1e18, None)
                for j, (s0, _bp, n0) in enumerate(score):
                    if s0 >= 1e17:
                        continue
                    if n0 == node:
                        trans = 0
                    else:
                        dist, _ = dijkstra_cache(n0, straight * 3 + 120)
                        if node not in dist:
                            continue
                        trans = abs(dist[node] - straight)
                    tot = s0 + trans + d * 2.0
                    if tot < best[0]:
                        best = (tot, j)
                new.append((best[0], best[1], node))
            if all(sc >= 1e17 for sc, _, _ in new):
                # nessun collegamento nel raggio: riprova con un raggio ampio, poi "salta" con penalità
                jb = min(range(len(score)), key=lambda i: score[i][0])
                n0 = score[jb][2]
                dist, _ = dijkstra_cache(n0, straight * 10 + 800)
                new = []
                for d, k, tt in cands:
                    node = cand_node(k, tt)
                    pen = abs(dist[node] - straight) if node in dist else 5000
                    new.append((score[jb][0] + pen + d * 2.0, jb, node))
            back.append(new)
            score = new
        # ricostruzione all'indietro
        j = min(range(len(score)), key=lambda i: score[i][0])
        seq_nodes = [score[j][2]]
        for li in range(len(back) - 1, 0, -1):
            j = back[li][j][1]
            seq_nodes.append(back[li - 1][j][2])
        if back:
            j = back[0][j][1]
            seq_nodes.append(layers[0][2][j][1] is not None and cand_node(layers[0][2][j][1], layers[0][2][j][2]))
        seq_nodes = [n for n in seq_nodes[::-1] if n is not False]
        # collega i nodi consecutivi con i cammini minimi
        full = [seq_nodes[0]]
        gaps = 0
        for a, b in zip(seq_nodes, seq_nodes[1:]):
            if a == b:
                continue
            dist, prev = dijkstra_cache(a, 3000)
            if b not in dist:
                gaps += 1
                full.append(b)  # salto: il gioco lo tratta come tratto senza strada
                continue
            full += path_nodes(prev, a, b)[1:]
        return full, gaps

    cache = {}

    def dijkstra_cache(src, limit):
        c = cache.get(src)
        if c and c[0] >= limit:
            return c[1], c[2]
        dist, prev = dijkstra(src, limit)
        if len(cache) > 20000:
            cache.clear()
        cache[src] = (limit, dist, prev)
        return dist, prev

    # ---------------- GTFS ----------------
    def extend_to_stop(seq, stop, at_start):
        sx, sz = stop[0], stop[1]
        near = {}
        for d, k, _t in candidates(sx, sz, 20, 6):
            for n in edges[k][:2]:
                near[n] = math.hypot(nodes[n][0] - sx, nodes[n][1] - sz)
        if not near:
            return seq
        n = min(near, key=near.get)
        end = seq[0] if at_start else seq[-1]
        ends = seq[:3] if at_start else seq[-3:]
        if n in ends or near[n] > 20 or near[n] > math.hypot(nodes[end][0] - sx, nodes[end][1] - sz) - 5:
            return seq
        src, dst = (n, end) if at_start else (end, n)
        dist, prev = dijkstra(src, 300)
        if dst not in dist:
            return seq
        path = path_nodes(prev, src, dst)
        if sum(math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1]) for a, b in zip(path, path[1:])) > 80:
            return seq
        return path[:-1] + seq if at_start else seq + path[1:]

    edge_of = {}
    for k, e in enumerate(edges):
        edge_of[(e[0], e[1])] = edge_of[(e[1], e[0])] = k

    def bus_ok(k, frm):
        """Il bus può percorrere l'arco k partendo da frm (sensi unici rispettati, niente vie pedonali)."""
        a, b, cls, _w, _n, flags = edges[k][:6]
        if cls == 8:
            return False
        if flags & 256:
            return True
        if flags & 1:
            return frm == a
        if flags & 2:
            return frm == b
        return True

    def seg_dist(stop, u, v):
        """Distanza (m) della fermata dal tratto u->v e posizione della sua proiezione lungo il tratto (0-1)."""
        (ax, az), (bx, bz) = nodes[u], nodes[v]
        dx, dz = bx - ax, bz - az
        l2 = dx * dx + dz * dz or 1e-9
        t = ((stop[0] - ax) * dx + (stop[1] - az) * dz) / l2
        tc = max(0.0, min(1.0, t))
        return math.hypot(stop[0] - ax - dx * tc, stop[1] - az - dz * tc), t

    def bus_path(src, dst, max_len):
        """Percorso più corto per il bus da src a dst rispettando i sensi unici (corsie bus in controsenso comprese),
        entro max_len metri; None se non c'è."""
        dist, prev, pq = {src: 0.0}, {}, [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == dst:
                break
            if d > dist.get(u, 1e18) or d > max_len:
                continue
            for v2, _c, k in adj[u]:
                if not bus_ok(k, u):
                    continue
                nd = d + math.hypot(nodes[v2][0] - nodes[u][0], nodes[v2][1] - nodes[u][1])
                if nd < dist.get(v2, 1e18):
                    dist[v2], prev[v2] = nd, u
                    heapq.heappush(pq, (nd, v2))
        if dst not in dist or dist[dst] > max_len:
            return None
        return path_nodes(prev, src, dst), dist[dst]

    def right_of(stop, u, v):
        """Distanza della fermata a destra del tratto u->v (negativa a sinistra) e posizione lungo il tratto (0-1)."""
        (ax, az), (bx, bz) = nodes[u], nodes[v]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz) or 1e-9
        return ((stop[0] - ax) * -dz + (stop[1] - az) * dx) / L, ((stop[0] - ax) * dx + (stop[1] - az) * dz) / (L * L)

    def terminal_lane(seq, stop, at_start, max_extra=600.0):
        """Capolinea lontano dal percorso: il tracciato GTFS nei piazzali è approssimativo (alla stazione le corsie
        sono tre, a senso unico, una accanto all'altra) e l'aggancio può finire sulla corsia sbagliata o sulla strada
        accanto. Se la fermata non sta lungo gli ultimi (o primi) tratti ma accanto a un arco percorso nel suo verso con
        la fermata a destra, si arriva (o si parte) da lì con il percorso legale più corto."""
        span = seq[:5] if at_start else seq[-5:]
        d_cur = min((seg_dist(stop, a, b)[0] for a, b in zip(span, span[1:])), default=1e9)
        # anche se il percorso passa dalla fermata ma ci arriva (o riparte) contromano
        if any(not bus_ok(edge_of[(a, b)], a) for a, b in zip(span, span[1:]) if (a, b) in edge_of):
            d_cur = 1e9
        best = None
        for _d, k, _t in candidates(stop[0], stop[1], 9, 8):
            a, b = edges[k][0], edges[k][1]
            for u, v in ((a, b), (b, a)):
                if not bus_ok(k, u):
                    continue
                side, t = right_of(stop, u, v)
                if 0 < side < 8 and 0.05 < t < 1.0 and d_cur > side + 4 and (best is None or side < best[0]):
                    best = (side, u, v)
        if not best:
            return seq
        _s, u, v = best
        plen = lambda p: sum(math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1]) for a, b in zip(p, p[1:]))
        legal = lambda p: all((a, b) not in edge_of or bus_ok(edge_of[(a, b)], a) for a, b in zip(p, p[1:]))
        out = None  # (percorso, lunghezza aggiunta meno quella tolta)
        if at_start:
            for j in range(min(len(seq), 8)):
                if not legal(seq[j:j + 5]):
                    continue  # il pezzo che resta deve essere percorribile (niente contromano subito dopo)
                r = bus_path(v, seq[j], max_extra)
                if r and u not in r[0] and (out is None or r[1] - plen(seq[:j + 1]) < out[1]):
                    out = ([u] + r[0] + seq[j + 1:], r[1] - plen(seq[:j + 1]))
        else:
            for j in range(len(seq) - 1, max(-1, len(seq) - 9), -1):
                if not legal(seq[max(0, j - 4):j + 1]):
                    continue
                r = bus_path(seq[j], u, max_extra)
                if r and v not in r[0] and (out is None or r[1] - plen(seq[j:]) < out[1]):
                    out = (seq[:j] + r[0] + [v], r[1] - plen(seq[j:]))
        return out[0] if out else seq

    def stop_lanes(seq, stops, max_extra=120.0):
        """Fermate in mezzo al percorso accanto a una corsia parallela (stazione: le linee che passano e fermano alla
        Corsia 3 facevano la corsia nord, a 7 m dalla banchina): se il percorso passa lontano dalla fermata e un arco
        accanto, percorso nel suo verso, ha la fermata a destra, si passa da lì quando costa poco (le due corsie
        finiscono nello stesso nodo)."""
        plen = lambda p: sum(math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1]) for a, b in zip(p, p[1:]))
        for stop in stops:
            if len(seq) < 3:
                break
            dists = [seg_dist(stop, a, b)[0] for a, b in zip(seq, seq[1:])]
            i = min(range(len(dists)), key=dists.__getitem__)
            d_cur = dists[i]
            best = None
            for _d, k, _t in candidates(stop[0], stop[1], 9, 8):
                a, b = edges[k][0], edges[k][1]
                for u, v in ((a, b), (b, a)):
                    if not bus_ok(k, u):
                        continue
                    side, t = right_of(stop, u, v)
                    # golfi di fermata (strade di servizio a senso unico accanto alla carreggiata: Piovese Park, sotto
                    # la tangenziale): la palina può stare fino a 5 m oltre il bordo del golfo o, approssimata, dentro
                    hw = edges[k][3] / 2
                    lane = 0 < side < 4 and d_cur > side + 4
                    bay = edges[k][2] == 7 and edges[k][5] & 3 and -hw < side < hw + 5 and d_cur > abs(side) + 3
                    if (lane or bay) and 0.05 < t < 1.0 and (best is None or abs(side) < best[0]):
                        best = (abs(side), u, v)
            if not best:
                continue
            _s, u, v = best
            out = None
            for a_ in range(max(0, i - 6), i + 1):
                r1 = bus_path(seq[a_], u, 400)
                if not r1 or v in r1[0]:
                    continue
                for b_ in range(i + 1, min(len(seq), i + 8)):
                    r2 = bus_path(v, seq[b_], 400)
                    if not r2 or u in r2[0]:
                        continue
                    extra = r1[1] + plen([u, v]) + r2[1] - plen(seq[a_:b_ + 1])
                    if extra < max_extra and (out is None or extra < out[1]):
                        out = (seq[:a_] + r1[0] + r2[0] + seq[b_ + 1:], extra)
            if out:
                seq = out[0]
        return seq

    def drop_spurs(seq, pts):
        """Toglie le andate e ritorno A-B-A in una via laterale (errori di aggancio del tracciato GTFS), se lì non c'è
        una fermata (dentro l'arco, non all'incrocio A)."""
        i = 0
        while i < len(seq) - 2:
            if seq[i] == seq[i + 2] and not any(d < 20 and 0.3 < t <= 1.05 for d, t in (seg_dist(p, seq[i], seq[i + 1]) for p in pts)):
                del seq[i + 1:i + 3]
                i = max(0, i - 2)
            else:
                i += 1
        return seq

    def stop_edge(seq, stop, at_start, reach=12.0):
        """Capolinea: il tracciato GTFS può cominciare (o finire) al nodo vicino alla fermata invece che sul tratto dove
        il bus sta fermo (Largo Debussy: si arriva lungo il prato e si riparte dallo stesso punto, ma la partenza
        comincia all'angolo dopo). Se la fermata sta lungo un arco che entra nel primo nodo (o esce dall'ultimo), più
        vicina che al primo (o ultimo) tratto, quell'arco si aggiunge al percorso: arrivo e partenza hanno la stessa
        palina e il bus parte da dove sta davvero, nel verso del tracciato."""
        s0, s1 = (seq[0], seq[1]) if at_start else (seq[-1], seq[-2])
        d_cur = seg_dist(stop, s1, s0)[0]
        best = None
        for w, _c, k in adj[s0]:
            if w == s1 or w in seq[:4] or w in seq[-4:] or not bus_ok(k, w if at_start else s0):
                continue
            d, t = seg_dist(stop, w, s0) if at_start else seg_dist(stop, s0, w)
            # la fermata deve cadere dentro l'arco (non oltre il nodo) e ben più vicina del tratto attuale
            if d < reach and d < d_cur - 3 and (0.15 < t < 0.97 if at_start else 0.03 < t < 0.85) and (best is None or d < best[0]):
                best = (d, w)
        if not best:
            return seq
        return [best[1]] + seq if at_start else seq + [best[1]]

    def loop_back(T, P, limit, allow=frozenset()):
        """Giro da T a P senza inversioni a U (nemmeno la prima: non si torna subito su P), nei sensi di marcia giusti,
        entro limit metri e solo per strade principali, rotatorie, corsie dei bus e anelli dei capolinea (non dentro i
        quartieri; allow: archi (nodo, nodo) che vanno sempre bene, quelli che il percorso fa già): [T, ..., P], o None.
        Ricerca sugli archi orientati (nodo, nodo da cui si arriva)."""
        ok = lambda k, frm: bus_ok(k, frm) and (edges[k][2] <= 4 or edges[k][5] & 32 or k in gtfs_edges or (edges[k][0], edges[k][1]) in allow)
        pq = [(math.dist(nodes[T], nodes[w]), w, T, None) for w, _c, k in adj[T] if w != P and ok(k, T)]
        heapq.heapify(pq)
        parent = {}
        while pq:
            d, u, frm, par = heapq.heappop(pq)
            if (u, frm) in parent or d > limit:
                continue
            parent[(u, frm)] = par
            if u == P:
                path, st = [u], (u, frm)
                while st is not None:
                    path.append(st[1])
                    st = parent[st]
                return path[::-1]
            for w, _c, k in adj[u]:
                if w != frm and ok(k, u) and (w, u) not in parent:
                    heapq.heappush(pq, (d + math.dist(nodes[u], nodes[w]), w, u, (u, frm)))
        return None

    def no_uturns(seq, stops, limit=600.0):
        """Inversioni a U in mezzo al percorso (A-B-A su un nodo, di solito un aggancio sbagliato davanti a una rotatoria
        o a un isolato) con una fermata (stops: punti) sull'andata e ritorno: dove si può, il giro attorno al posto della
        manovra. Quelle senza fermate le toglie il gioco (spurs in src/game/routes.js). Restituisce (percorso, giri)."""
        out, n, i = list(seq), 0, 1
        while i < len(out) - 1:
            if out[i - 1] == out[i + 1]:
                k = 1
                while i - k - 1 >= 0 and i + k + 1 < len(out) and out[i - k - 1] == out[i + k + 1]:
                    k += 1
                spur = out[i - k:i + 1]
                on = any(seg_dist(p, u, v)[0] < 30 for p in stops for u, v in zip(spur, spur[1:]))
                done = frozenset(p for u, v in zip(spur, spur[1:]) for p in ((u, v), (v, u)))
                loop = loop_back(out[i], out[i - 1], limit, done) if on else None
                if loop:
                    out[i:i + 2] = loop
                    n += 1
                    i += len(loop) - 1
            i += 1
        return out, n

    if osm_stops_path:
        osm_st = json.load(open(osm_stops_path, encoding='utf-8'))
        print('fermate spostate sulla palina OSM:', snap_stops_to_osm(gt['stops'], osm_st['fermate']))
        print('fermate portate sulla banchina:', onto_platforms(gt['stops'], osm_st.get('banchine') or []))
    def variant_path(v, shape):
        """Cammino della variante v agganciando il tracciato shape (lat, lon): (cammino, inversioni tolte, metri
        agganciati, metri del tracciato), o None."""
        res = match(shape)
        if not res or len(res[0]) < 3:
            return None
        seq, gaps = res
        seq, n_loops = no_uturns(seq, [gt['stops'][si][:2] for si in v['stops']])
        # capolinea: il tracciato GTFS parte (o finisce) alla fermata, ma l'aggancio può cominciare all'incrocio dopo
        # (Largo Debussy: la fermata è nel piazzale, l'aggancio partiva da Via Leonardo da Vinci). Si riattacca il
        # tratto fino al nodo vicino alla prima (o ultima) fermata, se è a pochi metri di strada
        seq = extend_to_stop(seq, gt['stops'][v['stops'][0]], True)
        seq = extend_to_stop(seq, gt['stops'][v['stops'][-1]], False)
        # e si comincia (o si finisce) sull'arco lungo cui sta la fermata del capolinea
        seq = stop_edge(seq, gt['stops'][v['stops'][0]], True)
        seq = stop_edge(seq, gt['stops'][v['stops'][-1]], False)
        seq = terminal_lane(seq, gt['stops'][v['stops'][0]], True)
        seq = terminal_lane(seq, gt['stops'][v['stops'][-1]], False)
        seq = stop_lanes(seq, [gt['stops'][si] for si in v['stops'][1:-1]])
        seq = drop_spurs(seq, [gt['stops'][si] for si in v['stops']])
        sp = [xz(la, lo) for la, lo in shape]
        Lg = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(sp, sp[1:]))
        Lm = sum(math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1]) for a, b in zip(seq, seq[1:]))
        return seq, n_loops, Lm, Lg

    def area_pieces(shape_pts, gap=300.0, step=25.0):
        """Il tracciato GTFS (lat, lon) diviso nei pezzi dentro l'area (punti ogni step metri con una strada a 30 m),
        separati da tratti di almeno gap metri senza strade."""
        dense = []
        for (la0, lo0), (la1, lo1) in zip(shape_pts, shape_pts[1:]):
            n = max(1, int(math.dist(xz(la0, lo0), xz(la1, lo1)) // step))
            dense += [(la0 + (la1 - la0) * i / n, lo0 + (lo1 - lo0) * i / n) for i in range(n)]
        dense.append(tuple(shape_pts[-1]))
        inside = [i for i, p in enumerate(dense) if candidates(*xz(*p))]
        pieces, a = [], 0
        for k in range(1, len(inside) + 1):
            if k == len(inside) or (inside[k] - inside[k - 1]) * step >= gap:
                pieces.append(dense[inside[a]:inside[k - 1] + 1])
                a = k
        return [p for p in pieces if len(p) > 1]

    def stops_near(pts, stops, r=60.0):
        """Quante fermate (x, z) stanno a meno di r metri dalla polilinea pts (lat, lon)."""
        q = [xz(*p) for p in pts]

        def near(st):
            for (ax, az), (bx, bz) in zip(q, q[1:]):
                dx, dz = bx - ax, bz - az
                t = max(0.0, min(1.0, ((st[0] - ax) * dx + (st[1] - az) * dz) / (dx * dx + dz * dz or 1e-9)))
                if math.hypot(st[0] - ax - dx * t, st[1] - az - dz * t) < r:
                    return True
            return False
        return sum(1 for st in stops if near(st))

    lines_out = []
    failed = 0
    uturns_fixed = 0
    for line in gt['lines']:
        variants = []
        for v in line['variants']:
            r = variant_path(v, v['shape_pts'])
            # controllo: lunghezza agganciata vs lunghezza del tracciato GTFS. Un tracciato che esce dall'area e ci
            # rientra si aggancia con un giro dentro l'area al posto del pezzo fuori (la 22 da Torre, con il capolinea
            # in un corridoio e Via Madonna del Rosario fuori): allora si aggancia il pezzo dentro l'area con più fermate
            if r and r[2] > 1.5 * max(1, r[3]):
                pieces = area_pieces(v['shape_pts'])
                if len(pieces) > 1:
                    n_st = [stops_near(p, [gt['stops'][si][:2] for si in v['stops']]) for p in pieces]
                    r2 = variant_path(v, pieces[n_st.index(max(n_st))])
                    if r2 and r2[2] <= 1.5 * max(1, r2[3]):
                        print(f'  {line["id"]} {v["headsign"]}: esce dall\'area e rientra, agganciato il pezzo con {max(n_st)} fermate di {len(pieces)}')
                        r = r2
            if not r:
                failed += 1
                continue
            seq, n_loops, Lm, Lg = r
            uturns_fixed += n_loops
            if Lm > 1.5 * max(1, Lg):
                print(f'  scartata {line["id"]} {v["headsign"]}: agganciato {Lm:.0f} m su {Lg:.0f} m')
                failed += 1
                continue
            # fermate lungo il tratto agganciato (le linee che escono dalla mappa vengono tagliate)
            def dist_to_path(px, pz):
                best = 1e18
                for a, b in zip(seq, seq[1:]):
                    (ax, az), (bx, bz) = nodes[a], nodes[b]
                    dx, dz = bx - ax, bz - az
                    l2 = dx * dx + dz * dz or 1e-9
                    tt = max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / l2))
                    best = min(best, math.hypot(px - ax - dx * tt, pz - az - dz * tt))
                return best
            # si tiene il tratto più lungo di fermate consecutive: una fermata isolata oltre un pezzo fuori dall'area
            # lasciava in mezzo chilometri di giro
            ok = [dist_to_path(gt['stops'][si][0], gt['stops'][si][1]) < 60 for si in v['stops']]
            keep, run = [], []
            for i, o in enumerate(ok + [False]):
                if o:
                    run.append(i)
                elif run:
                    keep = run if len(run) > len(keep) else keep
                    run = []
            if len(keep) < 3:
                failed += 1
                continue
            i0, i1 = keep[0], keep[-1]
            o0, o1 = v['offsets'][i0], v['offsets'][i1]
            dur = max(60, o1 - o0)
            trimmed = len(keep) < len(v['stops'])
            if trimmed:
                print(f'  tagliata {line["id"]} {v["headsign"]}: {len(keep)}/{len(v["stops"])} fermate nella mappa')
            v2 = {
                'headsign': v['headsign'] + (' (tratto in città)' if trimmed else ''),
                'stops': [v['stops'][i] for i in keep], 'offsets': [v['offsets'][i] - o0 for i in keep], 'duration': dur,
                'fer': [[t + o0 * d / v['duration'], dur * d / v['duration']] for t, d in v['fer']],
                'fes': [[t + o0 * d / v['duration'], dur * d / v['duration']] for t, d in v['fes']],
            }
            # percorso delle linee tagliate solo attorno al tratto tenuto: prima della prima fermata il giro fuori
            # dall'area spostava tutte le fermate (il gioco le cerca entro 2,5 km di percorso dalla precedente)
            v2['nodes'] = cut_path(seq, nodes, [gt['stops'][si][:2] for si in v2['stops']]) if trimmed else seq
            variants.append(v2)
        if variants:
            lines_out.append({'id': line['id'], 'color': line['color'], 'variants': variants})
        print('linea', line['id'], len(variants), 'varianti agganciate', flush=True)

    # ---------------- edifici ----------------
    buildings = []
    if overture_path:
        # l'export Overture copre riquadri interi: si tengono gli edifici dell'area di gioco, come le strade
        buildings = [b for b in overture_buildings(overture_path) if in_focus(*latlon(sum(b[3][0::2]) / (len(b[3]) // 2), sum(b[3][1::2]) / (len(b[3]) // 2)), 0.0015)]
        print('edifici Overture nell\'area di gioco:', len(buildings))
        if volumes_path:
            print('edifici con l\'altezza misurata (DBGT):', measured_heights(buildings, volumes_path))
    for w in ([] if overture_path else ways):
        t = w.get('tags', {})
        if 'building' not in t or w['nodes'][0] != w['nodes'][-1]:
            continue
        pts = [xz(g['lat'], g['lon']) for g in w['geometry']][:-1]
        if len(pts) < 3:
            continue
        far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
        idx = rdp(pts, 0.4, {far})
        poly = [pts[i] for i in idx]
        if len(poly) < 3:
            continue
        h = 0.0
        try:
            if 'height' in t:
                h = float(re.match(r'[\d.]+', t['height']).group(0))
            elif 'building:levels' in t:
                h = float(t['building:levels'].split(';')[0]) * 3.2 + 0.8
        except (AttributeError, ValueError):
            h = 0.0
        kind = t.get('building')
        nm = t.get('name', '')
        flat = []
        for x, z in poly:
            flat += [round(x, 1), round(z, 1)]
        buildings.append([round(h, 1), kind if kind in ('church', 'cathedral', 'chapel', 'train_station', 'hospital', 'university', 'school', 'industrial', 'warehouse', 'garage', 'garages', 'roof', 'house', 'apartments', 'commercial', 'retail') else '', nm, flat])

    # ---------------- ferrovia e acqua ----------------
    rails, water = [], []
    for w in ways:
        t = w.get('tags', {})
        if t.get('railway') == 'rail':
            pts = [xz(g['lat'], g['lon']) for g in w['geometry']]
            keep = rdp(pts, 1.0)
            flat = []
            for i in keep:
                flat += [round(pts[i][0], 1), round(pts[i][1], 1)]
            rails.append([1 if t.get('bridge') not in (None, 'no') else 2 if t.get('tunnel') not in (None, 'no') else 0, 1 if t.get('service') in ('yard', 'siding', 'spur') else 0, flat])
        elif t.get('waterway') in ('river', 'canal'):
            nm = t.get('name', '')
            wd = next((v for k, v in WATER_W.items() if k in nm.lower()), 40 if t['waterway'] == 'river' else 12)
            if t.get('tunnel') not in (None, 'no'):
                continue  # tratti tombinati
            pts = [xz(g['lat'], g['lon']) for g in w['geometry']]
            keep = rdp(pts, 2.0)
            flat = []
            for i in keep:
                flat += [round(pts[i][0], 1), round(pts[i][1], 1)]
            water.append([nm, wd, flat])

    # larghezza delle strade limitata allo spazio libero tra le facciate reali
    WC = 25
    wgrid = defaultdict(list)
    for b in buildings:
        f = b[3]
        n = len(f) // 2
        for i in range(n):
            ax, az, bx, bz = f[2 * i], f[2 * i + 1], f[2 * ((i + 1) % n)], f[2 * ((i + 1) % n) + 1]
            for gx in range(int(min(ax, bx) // WC), int(max(ax, bx) // WC) + 1):
                for gz in range(int(min(az, bz) // WC), int(max(az, bz) // WC) + 1):
                    wgrid[(gx, gz)].append((ax, az, bx, bz))
    narrowed = 0
    bus_edges = set()
    for l in lines_out:
        for v in l['variants']:
            for a, b in zip(v['nodes'], v['nodes'][1:]):
                bus_edges.add((min(a, b), max(a, b)))
    for e in edges:
        a, b, cls, wd = e[0], e[1], e[2], e[3]
        (ax, az), (bx, bz) = nodes[a], nodes[b]
        L = math.hypot(bx - ax, bz - az)
        if L < 1:
            continue
        dx, dz = (bx - ax) / L, (bz - az) / L
        rx, rz = -dz, dx
        free = 1e9
        for t in (0.2, 0.5, 0.8):
            px, pz = ax + (bx - ax) * t, az + (bz - az) * t
            dl = dr = 1e9
            for gx in range(int((px - 15) // WC), int((px + 15) // WC) + 1):
                for gz in range(int((pz - 15) // WC), int((pz + 15) // WC) + 1):
                    for (sx, sz, ex, ez) in wgrid.get((gx, gz), ()):
                        ux, uz = ex - sx, ez - sz
                        l2 = ux * ux + uz * uz or 1e-9
                        tt = max(0, min(1, ((px - sx) * ux + (pz - sz) * uz) / l2))
                        qx, qz = sx + ux * tt - px, sz + uz * tt - pz
                        d = math.hypot(qx, qz)
                        if d > 15:
                            continue
                        # solo muri ai lati (non davanti/dietro lungo la strada)
                        side = qx * rx + qz * rz
                        if abs(qx * dx + qz * dz) > d * 0.8:
                            continue
                        if side >= 0:
                            dr = min(dr, d)
                        else:
                            dl = min(dl, d)
            # la carreggiata può arrivare fino alle facciate (marciapiedi stretti nel centro storico)
            free = min(free, min(2 * min(dl, dr) + 0.5, dl + dr - 1.0))
        if (min(a, b), max(a, b)) in bus_edges:
            # percorsi dei bus: mai più stretti di così (in gioco, dalla cabina, gli spazi sembrano più stretti);
            # se le facciate sono più vicine si ritagliano gli edifici (street_surfaces.surfaces)
            e[3] = max(wd, BUS_MIN_RING if e[5] & 16 else BUS_MIN_1 if e[5] & 3 else BUS_MIN_2)
            continue
        if free < wd:
            e[3] = round(max(4.5, min(wd, free)), 1)
            narrowed += 1
    print('strade ristrette tra le facciate:', narrowed)

    # tram SIR1 (dal GTFS): tracciato principale e fermate, per la sede tranviaria
    import csv
    rd = lambda f: csv.DictReader(open(f'{gtfs_dir}/{f}', encoding='utf-8-sig'))
    troutes = {r['route_id'] for r in rd('routes.txt') if r['agency_id'] != '10'}
    tshapes, ttrips = defaultdict(int), {}
    for t in rd('trips.txt'):
        if t['route_id'] in troutes:
            tshapes[t['shape_id']] += 1
            ttrips.setdefault(t['shape_id'], t['trip_id'])
    tram = []
    tram_lanes = False
    tram_stop_ids = set()
    if tshapes:
        main_shape = max(tshapes, key=tshapes.get)
        # secondo tracciato: il più completo del verso opposto (dove i due versi si separano, es. l'anello della
        # stazione percorso solo verso nord, la sede di ogni verso segue il suo)
        tdir = {}
        for t in rd('trips.txt'):
            if t['route_id'] in troutes:
                tdir.setdefault(t['shape_id'], t.get('direction_id') or '0')
        npts = defaultdict(int)
        for r in rd('shapes.txt'):
            if r['shape_id'] in tshapes:
                npts[r['shape_id']] += 1
        opp = [k for k in tshapes if tdir.get(k) != tdir.get(main_shape)]
        opp_shape = max(opp, key=lambda k: (npts[k] > 0.8 * npts[main_shape], tshapes[k] * npts[k])) if opp else None
        pts = []
        for r in rd('shapes.txt'):
            if r['shape_id'] == main_shape:
                pts.append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
        pts.sort()
        flat = []
        for _, la, lo in pts:
            x, z = xz(la, lo)
            flat += [round(x, 1), round(z, 1)]
        tram.append(flat)
        if opp_shape:
            op = sorted((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])) for r in rd('shapes.txt') if r['shape_id'] == opp_shape)
            tram.append([round(v, 1) for _, la, lo in op for v in xz(la, lo)])
        # binari veri: ogni shape (uno per verso) agganciato ai binari OSM
        if tram_path:
            tram = [tram_lane(t, *tram_grid(tram_path)) for t in tram]
            tram_lanes = True
        trip = ttrips[main_shape]
        for r in rd('stop_times.txt'):
            if r['trip_id'] == trip:
                tram_stop_ids.add((int(r['stop_sequence']), r['stop_id']))
    stops_by_id = {s['stop_id']: s for s in rd('stops.txt')}
    tram_stops = []
    for _, sid in sorted(tram_stop_ids):
        s = stops_by_id[sid]
        x, z = xz(float(s['stop_lat']), float(s['stop_lon']))
        tram_stops.append([round(x, 1), round(z, 1), build_gtfs.clean_name(s['stop_desc'] or s['stop_name'])])
    if tram_path and tram_lanes:
        for st, c in zip(tram_stops, central_platforms(tram_path, tram_stops, tram)):
            st.append(c)
    print('tram: punti', sum(len(t) // 2 for t in tram), 'fermate', len(tram_stops), 'con banchina centrale', sum(st[3] for st in tram_stops if len(st) > 3))

    # pianta delle strade: quote dei cavalcavia, carreggiate, marciapiedi, isole; edifici ritagliati fuori
    heights = street_surfaces.overpass_heights(nodes, edges, rails)
    terrain = hfun = None
    if dtm_path:
        terrain, tst, hfun, adjust = street_surfaces.terrain_for_game(json.load(open(dtm_path)), nodes, edges, heights)
        heights, tst['nodi_abbassati'] = adjust(heights)
        print('terreno:', tst)
    green = json.load(open(green_path, encoding='utf-8')) if green_path else None
    streets = json.load(open(streets_path, encoding='utf-8')) if streets_path else None
    platforms = json.load(open(osm_stops_path, encoding='utf-8')).get('banchine') if osm_stops_path else None
    if platforms:
        # corsie a senso unico tra le banchine (stazione): larghe quanto lo spazio libero, una corsia sola (in OSM la
        # corsia nord è larga 8,4 m e i bus si tenevano a destra, sopra la banchina)
        from shapely.geometry import LineString as _LS, Polygon as _Poly
        from shapely.ops import unary_union as _uu
        Pl = _uu([_Poly([(f[i], f[i + 1]) for i in range(0, len(f), 2)]).buffer(0) for f in platforms if len(f) >= 6])
        narrowed = 0
        for k, e in enumerate(edges):
            if not e[5] & 3:
                continue
            d = _LS([nodes[e[0]], nodes[e[1]]]).distance(Pl)
            if d < e[3] / 2 - 0.3:
                e[3] = round(max(3.4, 2 * d + 0.4), 1)
                narrowed += 1
                if k in edge_lanes:  # una corsia sola: niente righe divisorie
                    lt = list(edge_lanes[k])
                    lt[0], lt[1] = min(lt[0], 1), min(lt[1], 1)
                    edge_lanes[k] = tuple(lt)
        print('corsie ristrette tra le banchine:', narrowed)
    # binari delle linee nuove del tram (SIR2 e SIR3: data/tram-linee-nuove.json di scripts/tram_linee.py, accanto
    # all'export dei binari): la loro sede è nella pianta delle strade come quella del SIR1
    new_tram = []
    nt_path = os.path.join(os.path.dirname(tram_path), 'tram-linee-nuove.json') if tram_path else None
    if nt_path and os.path.exists(nt_path):
        for L in json.load(open(nt_path, encoding='utf-8'))['linee']:
            for v in L['versi']:
                new_tram.append([round(c, 1) for la, lo in v['percorso'] for c in xz(la, lo)])
        print('binari delle linee nuove nella pianta delle strade:', len(new_tram))
    surf, buildings, st = street_surfaces.surfaces(nodes, edges, heights, buildings, water, (tram if tram_lanes else []) + new_tram, bus_edges, edge_walk, hfun, green, streets, platforms)
    print('pianta delle strade:', st)

    nodes_flat = []
    for x, z in nodes:
        nodes_flat += [round(x, 1), round(z, 1)]
    # le fermate del tram valgono solo dove c'è la rete stradale (l'export OSM finisce prima di Guizza)
    nxs, nzs = nodes_flat[0::2], nodes_flat[1::2]
    bx0, bx1, bz0, bz1 = min(nxs) + 80, max(nxs) - 80, min(nzs) + 80, max(nzs) - 80
    tram_keep = lambda x, z: bx0 <= x <= bx1 and bz0 <= z <= bz1
    tram_line = build_gtfs.load_tram(gtfs_dir, keep=tram_keep)
    if tram_path and tram_lanes:
        print('fermate del tram sui nodi OSM: %d su %d' % snap_tram_stops(tram_path, tram, tram_stops, tram_line))
    data = {
        'source': 'OpenStreetMap contributors (ODbL) + GTFS Busitalia Veneto (BusOne)',
        'origin': [ORIGIN_LAT, ORIGIN_LON], 'ferDate': build_gtfs.FER_DATE, 'fesDate': build_gtfs.FES_DATE,
        'nodes': nodes_flat, 'edges': [v for e in edges for v in e], 'names': names,
        'stops': gt['stops'], 'lines': lines_out,
        'buildings': buildings, 'rails': rails, 'water': water, 'tram': tram, 'tramLanes': tram_lanes, 'tramStops': tram_stops,
        'nodeH': [[n, h] for n, h in sorted(heights.items())], 'surfaces': surf,
        # corsie dai tag OSM: [arco, codice] (lane_code), e frecce a terra [arco, avanti, indietro]
        'lanes': [v for k, lt in sorted(edge_lanes.items()) for v in (k, lane_code(lt))], 'turnLanes': turns,
        'tramLines': [tram_line],
        **({'terrain': terrain} if terrain else {}),
        **signage,
    }
    # la rete in out (nel bundle del gioco), edifici, pianta delle strade e alberi per aree (public/mappa/aree)
    print('aree della mappa:', aree_mappa.write(data, out))
    print(f'inversioni a U sostituite da un giro: {uturns_fixed}')
    print(f'nodi {len(nodes)} archi {len(edges)} edifici {len(buildings)} binari {len(rails)} acque {len(water)} linee {len(lines_out)} varianti non agganciate {failed}')


BUS_MIN_2, BUS_MIN_1, BUS_MIN_RING = 7.5, 5.5, 7.0  # m: carreggiata minima sui percorsi dei bus (doppio senso, senso unico, rotatoria)
TRAM_SNAP = 9  # m: distanza massima tra lo shape GTFS e un binario OSM
TRAM_PAIR = (2.2, 6.0)  # m: interasse dei due binari affiancati


def tram_grid(path, cell=20):
    """Segmenti dei binari OSM (railway=tram) in una griglia."""
    segs = []
    for e in json.load(open(path, encoding='utf-8'))['elements']:
        if e['tags'].get('railway') != 'tram':
            continue  # banchine
        pts = [xz(g['lat'], g['lon']) for g in e['geometry']]
        segs += [(a, b) for a, b in zip(pts, pts[1:]) if a != b]
    grid = defaultdict(list)
    for k, ((ax, az), (bx, bz)) in enumerate(segs):
        for gx in range(int(min(ax, bx) // cell), int(max(ax, bx) // cell) + 1):
            for gz in range(int(min(az, bz) // cell), int(max(az, bz) // cell) + 1):
                grid[(gx, gz)].append(k)
    return segs, grid, cell


def central_platforms(path, stops, lanes):
    """Fermate del tram con la banchina centrale, comune ai due versi (Borgomagno, Arcella...): una banchina OSM entro
    70 m dalla fermata sta tra i due binari, a meno di 4 m da ciascuno."""
    plats = []
    for e in json.load(open(path, encoding='utf-8'))['elements']:
        if e['type'] != 'way' or e['tags'].get('railway') == 'tram':
            continue
        pts = [xz(g['lat'], g['lon']) for g in e['geometry']]
        plats.append((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
    L = [[(t[i], t[i + 1]) for i in range(0, len(t), 2)] for t in lanes]

    def near(p, line):
        best = (1e9, None)
        for (ax, az), (bx, bz) in zip(line, line[1:]):
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz or 1e-9
            t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2))
            c = (ax + dx * t, az + dz * t)
            d = math.dist(p, c)
            if d < best[0]:
                best = (d, c)
        return best
    out = []
    for x, z, _n in stops:
        central = False
        for c in plats:
            if math.dist(c, (x, z)) > 70 or len(L) < 2:
                continue
            (da, ca), (db, cb) = near(c, L[0]), near(c, L[1])
            if da < 4 and db < 4 and abs(da + db - math.dist(ca, cb)) < 1.0:
                central = True
        out.append(1 if central else 0)
    return out


def _dist_line(p, line):
    """Distanza del punto p dalla spezzata line ([(x, z)]) e progressiva del punto più vicino."""
    best, s0, bs = 1e18, 0.0, 0.0
    for (ax, az), (bx, bz) in zip(line, line[1:]):
        dx, dz = bx - ax, bz - az
        l2 = dx * dx + dz * dz or 1e-9
        t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2))
        d = math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t)
        if d < best:
            best, bs = d, s0 + t * math.sqrt(l2)
        s0 += math.sqrt(l2)
    return best, bs


def snap_tram_stops(path, tram, tram_stops, tram_lines, reach=25.0):
    """Fermate del tram sul nodo OSM dove si ferma il tram (railway=tram_stop, stop_position) entro reach metri dalla
    fermata GTFS: per ogni corsa quello sul binario del suo verso (tram: i due binari, il primo nel verso dello shape
    principale). I nodi OSM stanno a metà banchina, le fermate GTFS in fondo (circa 10 m più avanti); dove manca il nodo
    vale il centro della banchina OSM, e senza nemmeno quella resta il GTFS. Restituisce (spostate, fermate)."""
    els = json.load(open(path, encoding='utf-8'))['elements']
    nodes = [xz(e['lat'], e['lon']) for e in els if e['type'] == 'node']
    for e in els:
        if e['type'] == 'way' and e['tags'].get('railway') != 'tram':
            pts = [xz(g['lat'], g['lon']) for g in e['geometry']]
            nodes.append((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
    lines = [[(t[i], t[i + 1]) for i in range(0, len(t), 2)] for t in tram]
    moved = total = 0

    def snap(st, line):
        nonlocal moved, total
        total += 1
        cand = [(_dist_line(n, line)[0] + 0.1 * math.dist(n, st[:2]), n) for n in nodes if math.dist(n, st[:2]) <= reach]
        if cand:
            n = min(cand)[1]
            st[0], st[1] = round(n[0], 1), round(n[1], 1)
            moved += 1
    for st in tram_stops:
        snap(st, lines[0])
    for v in tram_lines['variants']:
        st = v['stops']
        # verso della corsa: la progressiva delle fermate sul primo binario cresce nel verso dello shape principale
        fwd = len(lines) < 2 or _dist_line(st[-1][:2], lines[0])[1] >= _dist_line(st[0][:2], lines[0])[1]
        for x in st:
            snap(x, lines[0 if fwd else 1])
    return moved, total


def tram_lane(flat, segs, grid, cell):
    """Binario di un verso. Lo shape GTFS ha punti radi e corre su uno dei due binari (non in mezzo): campionato ogni
    2 m, ogni punto va sul binario OSM vicino e parallelo; dove i binari sono due si tiene quello a destra di chi
    percorre lo shape (si marcia a destra)."""
    pts = [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]
    smp = []
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(bx - ax, bz - az) // 2))
        smp += [(ax + (bx - ax) * k / n, az + (bz - az) * k / n) for k in range(n)]
    smp.append(pts[-1])
    out, snapped = [], 0
    for i, (px, pz) in enumerate(smp):
        a, b = smp[max(0, i - 3)], smp[min(len(smp) - 1, i + 3)]
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
        dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        rx, rz = -dz, dx
        seen, cand = set(), []
        for gx in range(int((px - TRAM_SNAP) // cell), int((px + TRAM_SNAP) // cell) + 1):
            for gz in range(int((pz - TRAM_SNAP) // cell), int((pz + TRAM_SNAP) // cell) + 1):
                for k in grid.get((gx, gz), ()):
                    if k in seen:
                        continue
                    seen.add(k)
                    (sx, sz), (ex, ez) = segs[k]
                    ux, uz = ex - sx, ez - sz
                    l2 = ux * ux + uz * uz
                    if abs(ux * dx + uz * dz) < 0.8 * math.sqrt(l2):
                        continue  # binario di traverso (scambi, altre linee)
                    t = max(0.0, min(1.0, ((px - sx) * ux + (pz - sz) * uz) / l2))
                    qx, qz = sx + ux * t, sz + uz * t
                    d = math.hypot(qx - px, qz - pz)
                    if d <= TRAM_SNAP:
                        cand.append(((qx - px) * rx + (qz - pz) * rz, d, qx, qz))
        # binari distinti: offset laterali che differiscono più di 1,2 m
        cand.sort()
        tracks = []
        for c in cand:
            if tracks and c[0] - tracks[-1][0] < 1.2:
                if c[1] < tracks[-1][1]:
                    tracks[-1] = c
            else:
                tracks.append(c)
        pair = [(abs(t1[0] + t2[0]), t2) for t1, t2 in zip(tracks, tracks[1:]) if TRAM_PAIR[0] <= t2[0] - t1[0] <= TRAM_PAIR[1]]
        pick = min(pair)[1] if pair else min(tracks, key=lambda c: c[1]) if tracks else None
        if pick:
            snapped += 1
            out.append((pick[2], pick[3]))
        else:
            out.append((px, pz))
    # media mobile su ±4 m contro i salti tra un segmento e l'altro, poi semplificazione
    sm = []
    for i in range(len(out)):
        w = out[max(0, i - 2):i + 3]
        sm.append((sum(p[0] for p in w) / len(w), sum(p[1] for p in w) / len(w)))
    sm[0], sm[-1] = out[0], out[-1]
    keep = rdp(sm, 0.15)
    print(f'  binario agganciato ai binari OSM: {snapped}/{len(smp)} campioni, {len(keep)} punti')
    return [round(v, 2) for i in keep for v in sm[i]]


CALMING = {'bump': 0, 'hump': 1, 'cushion': 2, 'table': 3}  # traffic_calming -> tipo nei dati del gioco
SIGNAL_SKIP = ('blinker', 'emergency', 'ramp_meter')  # lampeggianti e semafori dei vigili del fuoco: niente ciclo
NO_MARKINGS = ('unmarked', 'no', 'informal')
SIGNAL_GROUP = 25  # m: i semafori dei vari bracci dello stesso incrocio
SIGNAL_REACH = 40  # m: distanza massima tra la lanterna (linea d'arresto) e l'incrocio, lungo la strada
SIGN_REACH = 30  # m: lo stesso per STOP e dare precedenza
SNAP = 15  # m: aggancio di un nodo OSM al nodo del grafo più vicino lungo la sua strada
PED_GAP = 10  # m: un attraversamento semaforizzato più vicino di così all'incrocio fa parte dell'incrocio
SIGNAL_STOP_MAX = 35  # m: oltre, il nodo OSM non è la lanterna sulla linea d'arresto del braccio
SIGNAL_NEAR = 18  # m: incroci così vicini (carreggiate separate, sede del tram in mezzo) sono un solo impianto


def lanes_toward(t, fwd):
    """Corsie nel verso di marcia (fwd = verso della way): lanes:forward/backward, lanes sui sensi unici, altrimenti
    metà di lanes; 1 se OSM non lo dice."""
    def num(v):
        try:
            return int(float(v.split(';')[0])) if v else None
        except ValueError:
            return None
    n = num(t.get('lanes:forward' if fwd else 'lanes:backward'))
    if n:
        return n
    n = num(t.get('lanes'))
    if t.get('oneway') in ('yes', '1', '-1') or t.get('junction') == 'roundabout':
        return n or 1
    return max(1, n // 2) if n else 1


def load_nodes(path):
    return [e for e in json.load(open(path, encoding='utf-8'))['elements'] if e['type'] == 'node' and e.get('tags')]


def is_vehicle_signal(t):
    return t.get('highway') == 'traffic_signals' and t.get('traffic_signals') not in SIGNAL_SKIP


def ped_signal_gaps(els):
    """Semafori che possono stare in mezzo a un tratto, con la distanza minima dall'incrocio (lungo la strada)
    oltre la quale il loro nodo va tenuto nel grafo.

    * highway=traffic_signals: oltre SIGNAL_REACH non regola nessun incrocio, è un semaforo pedonale;
    * attraversamenti con crossing=traffic_signals senza un semaforo per i veicoli entro SIGNAL_REACH:
      i veicoli hanno comunque il rosso (in OSM spesso è mappato solo l'attraversamento).
    """
    veh = [(e['id'], *xz(e['lat'], e['lon'])) for e in els if is_vehicle_signal(e['tags'])]
    out = {i: SIGNAL_REACH for i, _x, _z in veh}
    for e in els:
        t = e['tags']
        if is_vehicle_signal(t) or not (t.get('crossing') == 'traffic_signals' or t.get('crossing:signals') == 'yes'):
            continue
        x, z = xz(e['lat'], e['lon'])
        if all(math.hypot(x - vx, z - vz) > SIGNAL_REACH for _i, vx, vz in veh):
            out[e['id']] = PED_GAP
    return out


def osm_signage(els, ped_gap, way_geo, node_id, nodes, edges):
    """Semafori, STOP, dare precedenza e attraversamenti reali (nodi OSM) agganciati al grafo.

    Restituisce le chiavi da aggiungere ai dati del gioco:
    * signals: [pedonale, nodo, nodo, ...] per incrocio semaforizzato (più nodi del grafo se l'incrocio è grande);
      pedonale = 1 per i semafori di un attraversamento lontano dagli incroci;
    * signs: [incrocio, nodo da cui si arriva, tipo] con tipo 0 = STOP, 1 = dare precedenza;
    * crossings: [a, b, metri da a] per le strisce pedonali lungo l'arco a-b;
    * calming: [a, b, metri da a, tipo] per dossi (0), dossi lunghi (1), cuscini (2) e attraversamenti rialzati (3); in
      main() si aggiungono le rampe delle vie rialzate (4, che sale da a verso b);
    * signalArms: [incrocio, nodo da cui si arriva, linea d'arresto in dm (0 = non nota), corsie nel verso, spento]
      per ogni braccio degli incroci semaforizzati. La linea d'arresto è dove OSM mette il semaforo del braccio;
      spento = 1 per il verso senza lanterna di un semaforo pedonale con traffic_signals:direction.
    """
    # grado dei nodi come lo vede il gioco (padova.js scarta gli archi più corti di 0,3 m sulle coordinate arrotondate)
    rn = [(round(x, 1), round(z, 1)) for x, z in nodes]
    deg = defaultdict(int)
    arm_cls = defaultdict(dict)  # nodo -> {vicino: classe della strada}
    for a, b, cls, *_r in edges:
        if math.hypot(rn[b][0] - rn[a][0], rn[b][1] - rn[a][1]) < 0.3:
            continue
        deg[a] += 1
        deg[b] += 1
        arm_cls[a][b] = min(cls, arm_cls[a].get(b, 9))
        arm_cls[b][a] = min(cls, arm_cls[b].get(a, 9))
    on_way = defaultdict(list)  # id OSM -> [(strada, posizione)]
    cum = []  # distanza progressiva lungo ogni strada
    for wi, (osm_ids, pts, *_r) in enumerate(way_geo):
        c = [0.0]
        for p, q in zip(pts, pts[1:]):
            c.append(c[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
        cum.append(c)
        for i, n in enumerate(osm_ids):
            on_way[n].append((wi, i))

    def walk(wi, i, step, maxd):
        """Nodi del grafo lungo la strada wi a partire dalla posizione i, nel verso della way (step 1) o contrario (-1).
        Dà (nodo, distanza, nodo precedente): l'arco precedente -> nodo è quello che si percorre arrivando."""
        keep, ids = way_geo[wi][2], way_geo[wi][3]
        prev = None
        for j in (range(len(keep)) if step > 0 else range(len(keep) - 1, -1, -1)):
            if (keep[j] - i) * step < 0:
                prev = ids[j]  # alle spalle del nodo OSM: resta il più vicino
                continue
            d = abs(cum[wi][keep[j]] - cum[wi][i])
            if d > maxd:
                return
            yield ids[j], d, prev
            prev = ids[j]

    def junction(osm, steps, maxd):
        """Primo incrocio (3+ archi) lungo le strade del nodo OSM: (distanza, incrocio, nodo da cui si arriva)."""
        best = None
        for wi, i in on_way[osm]:
            for step in steps(wi):
                for g, d, prev in walk(wi, i, step, maxd):
                    if deg[g] >= 3:
                        if prev is not None and (best is None or d < best[0]):
                            best = (d, g, prev)
                        break
        return best

    def nearest(osm):
        """Nodo del grafo per il nodo OSM: lo stesso se è tenuto, altrimenti il più vicino entro SNAP lungo la strada."""
        if osm in node_id:
            return node_id[osm]
        best = None
        for wi, i in on_way[osm]:
            for step in (1, -1):
                for g, d, _p in walk(wi, i, step, SNAP):
                    if best is None or d < best[0]:
                        best = (d, g)
                    break
        return best[1] if best else None

    def steps_of(v, wi=None):
        if v == 'forward':
            return (1,)
        if v == 'backward':
            return (-1,)
        ow = way_geo[wi][4] if wi is not None else 0
        return (ow,) if ow else (1, -1)

    # ---- semafori ----
    sig = []  # [x, z, incrocio o None, id OSM]
    arm_stop = {}  # (incrocio, nodo da cui si arriva) -> metri dal centro dell'incrocio alla lanterna OSM
    arm_off = set()  # (nodo, nodo da cui si arriva) senza lanterna: semafori pedonali che valgono in un verso solo
    for e in els:
        t = e['tags']
        if e['id'] not in ped_gap or e['id'] not in on_way:
            continue
        g = node_id.get(e['id'])
        dv = t.get('traffic_signals:direction', t.get('direction'))
        if g is not None and deg[g] >= 3:
            j = g
        elif not is_vehicle_signal(t):
            j = None  # attraversamento semaforizzato lontano dai semafori dei veicoli
        else:
            r = junction(e['id'], lambda wi: steps_of(dv), SIGNAL_REACH)
            j = r[1] if r else None
            # il nodo OSM del semaforo sta sulla linea d'arresto del braccio da cui si arriva
            if r and r[0] <= SIGNAL_STOP_MAX:
                arm_stop[(r[1], r[2])] = max(r[0], arm_stop.get((r[1], r[2]), 0))
        if j is None and dv in ('forward', 'backward'):
            # semaforo pedonale in un verso solo: chi arriva dall'altro lato non ha la lanterna
            wi, i = on_way[e['id']][0]
            gp = nearest(e['id'])
            far = next((n for n, _d, _p in walk(wi, i, 1 if dv == 'forward' else -1, SIGNAL_REACH) if n != gp), None)
            if gp is not None and far is not None:
                arm_off.add((gp, far))
        sig.append((*xz(e['lat'], e['lon']), j, e['id']))
    # stesso incrocio: lanterne vicine o che portano allo stesso nodo
    parent = list(range(len(sig)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(len(sig)):
        for k in range(i):
            if math.hypot(sig[i][0] - sig[k][0], sig[i][1] - sig[k][1]) <= SIGNAL_GROUP or (sig[i][2] is not None and sig[i][2] == sig[k][2]):
                parent[root(i)] = root(k)
    groups = defaultdict(list)
    for i in range(len(sig)):
        groups[root(i)].append(sig[i])
    signals, ped_lost = [], 0
    owner = {}

    def bridge(js):
        """Aggiunge i vertici intermedi (due soli archi) dei tratti brevi tra due nodi dello stesso incrocio:
        senza, chi attraversa l'incrocio troverebbe una lanterna a metà."""
        inside, extra = set(js), set()
        for j in js:
            for nb in arm_cls[j]:
                prev, cur, path = j, nb, []
                length = math.hypot(nodes[nb][0] - nodes[j][0], nodes[nb][1] - nodes[j][1])
                while cur not in inside and deg[cur] == 2 and len(arm_cls[cur]) == 2 and length <= 2 * SIGNAL_GROUP:
                    path.append(cur)
                    prev, cur = cur, next(v for v in arm_cls[cur] if v != prev)
                    length += math.hypot(nodes[cur][0] - nodes[prev][0], nodes[cur][1] - nodes[prev][1])
                if cur in inside and length <= 2 * SIGNAL_GROUP:
                    extra.update(path)
        return sorted(inside | extra)

    ring = {(a, b) for a, b, _c, _w, _n, flags, *_r in edges if flags & 16}

    def near_nodes(js):
        """Incroci a carreggiate separate o con la sede del tram in mezzo: gli altri incroci a pochi metri lungo un arco
        sono lo stesso impianto. Senza, l'arco che attraversa lo spartitraffico diventava un braccio con la sua lanterna
        e la linea d'arresto finiva sulla sede del tram."""
        inside, more = set(js), set()
        dist = lambda a, b: math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1])
        for j in js:
            for nb in arm_cls[j]:
                if (j, nb) in ring or (nb, j) in ring or arm_cls[j][nb] >= 8:
                    continue
                # anche oltre i vertici intermedi (il nodo della via in mezzo alla sede del tram)
                prev, cur, path, length = j, nb, [], dist(j, nb)
                while cur not in inside and deg[cur] == 2 and len(arm_cls[cur]) == 2 and length <= SIGNAL_NEAR:
                    path.append(cur)
                    prev, cur = cur, next(v for v in arm_cls[cur] if v != prev)
                    length += dist(prev, cur)
                if length <= SIGNAL_NEAR and cur not in inside and cur not in owner and deg[cur] >= 3:
                    more.add(cur)
                    more.update(path)
        return sorted(inside | more)

    for members in groups.values():
        js = bridge(sorted({m[2] for m in members if m[2] is not None}))
        if js:
            js = near_nodes(js)
        ped = 0
        if not js:
            # semaforo pedonale in mezzo a un tratto: vale per il nodo del grafo più vicino (non per un incrocio),
            # uno per carreggiata se la strada ne ha due
            js = sorted({g for g in (nearest(m[3]) for m in members) if g is not None and deg[g] <= 2})
            if not js:
                ped_lost += 1
                continue
            ped = 1
        js = [j for j in js if j not in owner]
        if not js:
            continue
        for j in js:
            owner[j] = len(signals)
        signals.append([ped, *js])

    # bracci degli impianti: linea d'arresto OSM, corsie nel verso di chi arriva, lanterna spenta
    arc_way = {}
    for wi, (_o, _p, _k, ids, *_r) in enumerate(way_geo):
        for a, b in zip(ids, ids[1:]):
            if a != b:
                arc_way.setdefault((a, b), (wi, True))
                arc_way.setdefault((b, a), (wi, False))
    arms = []
    for s in signals:
        inside = set(s[1:])
        for j in s[1:]:
            for b in arm_cls[j]:
                if b in inside or (j, b) not in arc_way and (b, j) not in arc_way:
                    continue
                wi, fwd = arc_way.get((b, j), (None, True))
                lanes = lanes_toward(way_geo[wi][5], fwd) if wi is not None else 1
                stop = arm_stop.get((j, b), 0)
                arms.append([j, b, round(stop * 10), lanes, 1 if (j, b) in arm_off else 0])

    # ---- STOP e dare precedenza ----
    signs = {}  # (incrocio, nodo da cui si arriva) -> tipo; lo STOP prevale
    on_junction = 0
    for e in els:
        t = e['tags']
        kind = {'stop': 0, 'give_way': 1}.get(t.get('highway'))
        if kind is None or e['id'] not in on_way:
            continue
        g = node_id.get(e['id'])
        if g is not None and deg[g] >= 3:
            # cartello messo sul nodo dell'incrocio: vale per le strade di classe inferiore (per tutte con stop=all)
            on_junction += 1
            arms = arm_cls[g]
            best = min(arms.values())
            hits = [(g, b) for b, c in arms.items() if c > best or t.get('stop') == 'all']
        else:
            r = junction(e['id'], lambda wi: steps_of(t.get('direction'), wi), SIGN_REACH)
            if not r:
                continue
            hits = [(r[1], b) for b in arm_cls[r[1]]] if t.get('stop') == 'all' else [(r[1], r[2])]
        for k in hits:
            if k[0] not in owner:
                signs[k] = min(kind, signs.get(k, 9))

    # ---- attraversamenti pedonali ----
    crossings = []
    seen = defaultdict(list)
    for e in els:
        t = e['tags']
        c = t.get('crossing', '')
        if (t.get('highway') != 'crossing' and not c) or c in NO_MARKINGS or t.get('crossing:markings') == 'no' or e['id'] not in on_way:
            continue
        g = node_id.get(e['id'])
        if g is not None and deg[g] >= 3:
            continue  # sul nodo dell'incrocio non si sa su quale braccio
        wi, i = on_way[e['id']][0]
        keep, ids = way_geo[wi][2], way_geo[wi][3]
        j = max(k for k in range(len(keep) - 1) if keep[k] <= i) if len(keep) > 1 else None
        if j is None or ids[j] == ids[j + 1]:
            continue
        a, b = ids[j], ids[j + 1]
        if arm_cls[a].get(b, 9) >= 8:
            continue  # aree pedonali: niente strisce
        (ax, az), (bx, bz) = nodes[a], nodes[b]
        x, z = xz(e['lat'], e['lon'])
        L = math.hypot(bx - ax, bz - az) or 1e-9
        s = max(0.0, min(L, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L))
        key = (min(a, b), max(a, b))
        sa = s if a < b else L - s
        if any(abs(sa - o) < 3 for o in seen[key]):
            continue  # stesso attraversamento mappato due volte
        seen[key].append(sa)
        crossings.append([a, b, round(s, 1)])

    # ---- dossi e attraversamenti rialzati (traffic_calming) ----
    calming = []
    for e in els:
        kind = CALMING.get(e['tags'].get('traffic_calming'))
        if kind is None or e['id'] not in on_way:
            continue
        g = node_id.get(e['id'])
        if g is not None and deg[g] >= 3:
            continue  # incrocio rialzato: non si sa su quale braccio
        wi, i = on_way[e['id']][0]
        keep, ids = way_geo[wi][2], way_geo[wi][3]
        j = max(k for k in range(len(keep) - 1) if keep[k] <= i) if len(keep) > 1 else None
        if j is None or ids[j] == ids[j + 1]:
            continue
        a, b = ids[j], ids[j + 1]
        if arm_cls[a].get(b, 9) >= 8:
            continue
        (ax, az), (bx, bz) = nodes[a], nodes[b]
        x, z = xz(e['lat'], e['lon'])
        L = math.hypot(bx - ax, bz - az) or 1e-9
        calming.append([a, b, round(max(0.0, min(L, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L)), 1), kind])

    print(f'semafori OSM {len(sig)} -> incroci semaforizzati {sum(1 for s in signals if not s[0])} '
          f'(nodi {sum(len(s) - 1 for s in signals if not s[0])}), pedonali {sum(1 for s in signals if s[0])}, '
          f'non agganciati {ped_lost}')
    print(f'bracci semaforizzati {len(arms)}: con la linea d\'arresto OSM {sum(1 for a in arms if a[2])}, '
          f'a più corsie {sum(1 for a in arms if a[3] >= 2)}, senza lanterna (pedonali in un verso) {sum(1 for a in arms if a[4])}')
    print(f'cartelli: STOP {sum(1 for v in signs.values() if v == 0)}, dare precedenza {sum(1 for v in signs.values() if v == 1)} '
          f'(sul nodo dell\'incrocio {on_junction}); strisce pedonali {len(crossings)}')
    print(f'dossi: {sum(1 for c in calming if c[3] < 3)}, attraversamenti rialzati {sum(1 for c in calming if c[3] == 3)}')
    return {
        'signals': signals,
        'signs': [[a, b, k] for (a, b), k in sorted(signs.items())],
        'crossings': crossings,
        'calming': calming,
        'signalArms': [v for a in arms for v in a],
    }


# altezza Microsoft ML -> numero di piani (calibrata sugli edifici con building:levels OSM)
ML_CAL = [(0, 1), (4.7, 1), (5.3, 2), (6.3, 3), (8.1, 4), (11.0, 5), (14.3, 6.5), (25.0, 9), (50.0, 15), (86.0, 20)]


def floors_from_ml(h):
    for (h0, f0), (h1, f1) in zip(ML_CAL, ML_CAL[1:]):
        if h <= h1:
            return f0 + (f1 - f0) * (h - h0) / (h1 - h0)
    return ML_CAL[-1][1] * h / ML_CAL[-1][0]


def ring_area(r):
    a = 0.0
    for (x1, z1), (x2, z2) in zip(r, r[1:] + r[:1]):
        a += x1 * z2 - x2 * z1
    return a / 2


def measured_heights(buildings, vol_path):
    """Altezze misurate (DBGT, strato UN_VOL, scripts/dbgt_volumes.py) al posto di quelle stimate: per ogni edificio la
    media dei volumi che ha dentro, pesata sull'area, se coprono almeno il 40% della pianta. Restituisce quanti.
    Portici: agli edifici misurati si aggiunge in fondo (sesto elemento) l'altezza libera dei portici (UN_VOL_POR = 3,
    UN_VOL_INH), 0 se non ne hanno; il gioco disegna i portici solo dove ci sono."""
    v = json.load(open(vol_path, encoding='utf-8'))['v']
    C = 50
    grid = defaultdict(list)
    for i in range(0, len(v), 6):
        grid[(int(v[i] // C), int(v[i + 1] // C))].append(i)

    def inside(x, z, f):
        c, n = False, len(f) // 2
        for k in range(n):
            ax, az, bx, bz = f[2 * k], f[2 * k + 1], f[2 * ((k + 1) % n)], f[2 * ((k + 1) % n) + 1]
            if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
                c = not c
        return c
    done = 0
    for b in buildings:
        f, holes = b[3], (b[4] if len(b) > 4 and b[4] else [])
        xs, zs = f[0::2], f[1::2]
        area = abs(ring_area(list(zip(xs, zs)))) - sum(abs(ring_area(list(zip(h[0::2], h[1::2])))) for h in holes)
        if area < 4:
            continue
        sw = sa = pa = pi = 0.0
        for gx in range(int(min(xs) // C), int(max(xs) // C) + 1):
            for gz in range(int(min(zs) // C), int(max(zs) // C) + 1):
                for i in grid.get((gx, gz), ()):
                    x, z, a, h, por, inh = v[i:i + 6]
                    if inside(x, z, f) and not any(inside(x, z, hh) for hh in holes):
                        sw += a * h
                        sa += a
                        if por == 3 and inh > 1.5:
                            pa += a
                            pi += a * inh
        if sa >= 0.4 * area:
            b[0] = round(sw / sa, 1)
            done += 1
            while len(b) < 5:
                b.append(None)
            b[5:] = [round(max(2.5, min(7.0, pi / pa)), 1) if pa >= 10 else 0]
    return done


def overture_buildings(path):
    """Edifici Overture (piante OSM + Microsoft, con cortili) con altezza stimata in modo realistico."""
    import struct
    import zlib
    import pyarrow.parquet as pq
    rows = pq.read_table(path).to_pylist()

    def rings_of(wkb):
        # WKB little/big endian: Polygon (3) o MultiPolygon (6)
        def rd_poly(buf, off):
            bo = '<' if buf[off] == 1 else '>'
            typ = struct.unpack_from(bo + 'I', buf, off + 1)[0]
            off += 5
            polys = []
            if typ == 3:
                n = struct.unpack_from(bo + 'I', buf, off)[0]; off += 4
                rings = []
                for _ in range(n):
                    m = struct.unpack_from(bo + 'I', buf, off)[0]; off += 4
                    pts = struct.unpack_from(bo + 'd' * (2 * m), buf, off); off += 16 * m
                    rings.append([(pts[2 * i], pts[2 * i + 1]) for i in range(m)])
                polys.append(rings)
            elif typ == 6:
                n = struct.unpack_from(bo + 'I', buf, off)[0]; off += 4
                for _ in range(n):
                    p2, off = rd_poly(buf, off)
                    polys += p2
            return polys, off
        return rd_poly(bytes(wkb), 0)[0]

    out = []
    for r in rows:
        if r.get('is_underground'):
            continue
        name = (r.get('names') or {}).get('primary') or ''
        cls = r.get('class') or ''
        sub = r.get('subtype') or ''
        for rings in rings_of(r['geometry']):
            loc = []
            for ring in rings:
                pts = [xz(lat, lon) for lon, lat in ring]
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts = pts[:-1]
                if len(pts) < 3:
                    continue
                far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
                keep = rdp(pts, 0.35, {far})
                loc.append([pts[i] for i in keep])
            if not loc or len(loc[0]) < 3:
                continue
            outer, holes = loc[0], [h for h in loc[1:] if len(h) >= 3 and abs(ring_area(h)) > 12]
            area = abs(ring_area(outer)) - sum(abs(ring_area(h)) for h in holes)
            if area < 4:
                continue
            cx = sum(p[0] for p in outer) / len(outer)
            cz = sum(p[1] for p in outer) / len(outer)
            centro = math.hypot(cx + 150, (cz - 120) * 1.15) < 950
            seed = (zlib.crc32(r['id'].encode()) % 1000) / 1000
            src_h = None
            ml = False
            for s in r.get('sources') or []:
                if s.get('property') == '/properties/height':
                    ml = s.get('dataset') == 'Microsoft ML Buildings'
            # 1) piani da OSM  2) altezza OSM  3) altezza Microsoft calibrata  4) stima per tipologia
            if r.get('num_floors'):
                floors = float(r['num_floors'])
            elif r.get('height') and not ml:
                src_h = float(r['height'])
                floors = None
            elif r.get('height'):
                floors = floors_from_ml(float(r['height']))
            else:
                floors = None
            if src_h is None and floors is None:
                if cls in ('garage', 'garages', 'carport', 'shed', 'roof', 'hut'):
                    floors = 1
                elif cls in ('church', 'cathedral', 'chapel', 'basilica'):
                    src_h = 16 + seed * 8
                elif cls in ('house', 'detached', 'semidetached_house', 'terrace'):
                    floors = 2 + (seed > 0.7)
                elif centro:
                    # centro storico: 3-5 piani, più alti sui lotti grandi
                    floors = 3 + (area > 220) + (area > 600 and seed > 0.4) + (seed > 0.85)
                elif area < 60:
                    floors = 1
                elif area < 160:
                    floors = 2 + (seed > 0.6)
                else:
                    floors = 4 + int(seed * 3)
            if src_h is None:
                floors = max(1, round(floors))
                fh = 3.5 if centro else 3.1
                src_h = floors * fh + (0.8 if floors > 1 else 0.4)
            kind = 'church' if cls in ('church', 'cathedral', 'chapel', 'basilica') else 'train_station' if cls == 'train_station' else cls if cls in ('house', 'apartments', 'garage', 'garages', 'roof', 'industrial', 'warehouse', 'commercial', 'retail', 'hospital', 'school', 'university') else ''
            flat = []
            for x, z in outer:
                flat += [round(x, 1), round(z, 1)]
            hflat = []
            for h in holes:
                hf = []
                for x, z in h:
                    hf += [round(x, 1), round(z, 1)]
                hflat.append(hf)
            out.append([round(src_h, 1), kind, name, flat, hflat or None])
    print('edifici Overture:', len(out))
    return out


if __name__ == '__main__':
    extra = sys.argv[4:]
    pick = lambda ok: next((a for a in extra if ok(a)), None)
    main(sys.argv[1], sys.argv[2], sys.argv[3], pick(lambda a: a.endswith('.parquet')),
         pick(lambda a: a.endswith('.json') and 'nodes' in a), pick(lambda a: a.endswith('.json') and 'tram' in a),
         pick(lambda a: a.endswith('.json') and 'misure' in a), pick(lambda a: a.endswith('.json') and 'volumi' in a),
         pick(lambda a: a.endswith('.json') and 'dtm' in a), pick(lambda a: a.endswith('.json') and 'verde' in a),
         pick(lambda a: a.endswith('.json') and 'strade' in a and 'misure' not in a),
         pick(lambda a: a.endswith('.json') and 'fermate' in a), pick(lambda a: a.endswith('.json') and 'corridoio' in a))
