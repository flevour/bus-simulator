#!/usr/bin/env python3
"""Costruisce i dati del gioco unendo OpenStreetMap e GTFS Busitalia Veneto.

Uso:
    python3 scripts/build_map.py data/osm-padova.json <cartella_gtfs> src/data/padova-map.json

* OSM (export Overpass in JSON con `out geom`): strade (con nomi, corsie, sensi unici,
  limiti, ponti), edifici (pianta e altezza), ferrovia, fiumi e canali.
* GTFS: linee urbane, varianti, fermate e orari. I tracciati GTFS vengono agganciati
  alla rete OSM (map matching) così che i bus percorrano le strade reali.

Dati © OpenStreetMap contributors (ODbL) e Busitalia Veneto (GTFS, feed BusOne).
"""
import heapq
import json
import math
import re
import sys
from collections import defaultdict

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import build_gtfs  # noqa: E402  (riusa lettura GTFS e conversioni)

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
FOCUS_BOXES = [FOCUS, FOCUS_SUD]
WATER_W = {'brenta': 70, 'bacchiglione': 38, 'piovego': 26, 'scaricatore': 34, 'roncajette': 30, 'tronco maestro': 22, 'naviglio': 14}


def xz(lat, lon):
    return ((lon - ORIGIN_LON) * M_LON, -(lat - ORIGIN_LAT) * M_LAT)


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
    return round(max(4.5, min(16, w)), 1)


def speed_of(tags):
    m = re.match(r'(\d+)', tags.get('maxspeed', ''))
    return int(m.group(1)) if m else 0


def in_focus(lat, lon, m=0.0):
    return any(b[0] - m <= lon <= b[2] + m and b[1] - m <= lat <= b[3] + m for b in FOCUS_BOXES)


def main(osm_path, gtfs_dir, out, overture_path=None):
    els = json.load(open(osm_path, encoding='utf-8'))['elements']
    # solo gli elementi che toccano l'area di gioco (con un piccolo margine)
    ways = [e for e in els if e['type'] == 'way' and 'geometry' in e and any(in_focus(g['lat'], g['lon'], 0.0015) for g in e['geometry'])]

    # ---------------- strade ----------------
    roads = []
    for w in ways:
        t = w.get('tags', {})
        hw = t.get('highway')
        if hw not in DRIVE or t.get('area') == 'yes':
            continue
        if hw == 'service' and t.get('service') in SKIP_SERVICE:
            continue
        if t.get('access') in ('no', 'private') and hw in ('service', 'pedestrian'):
            continue
        roads.append(w)
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

    edges = []  # a, b, cls, width, name, flags, speed, layer
    for w in roads:
        t = w['tags']
        cls, cw = DRIVE[t['highway']]
        pts = [xz(g['lat'], g['lon']) for g in w['geometry']]
        junc = {i for i, n in enumerate(w['nodes']) if use[n] > 1}
        keep = rdp(pts, 1.2, junc)
        ow = 1 if t.get('oneway') in ('yes', '1') or t.get('junction') == 'roundabout' else -1 if t.get('oneway') == '-1' else 0
        flags = (1 if ow == 1 else 0) | (2 if ow == -1 else 0) | (4 if t.get('bridge') not in (None, 'no') else 0) | (8 if t.get('tunnel') not in (None, 'no') else 0) | (16 if t.get('junction') == 'roundabout' else 0)
        try:
            layer = int(t.get('layer', '0').split(';')[0])
        except ValueError:
            layer = 0
        wd = width_of(t, cw)
        nm = name_ref(t.get('name', ''))
        sp = speed_of(t)
        ids = [nid(w['nodes'][i], w['geometry'][i]['lat'], w['geometry'][i]['lon']) for i in keep]
        for a, b in zip(ids, ids[1:]):
            if a != b:
                edges.append([a, b, cls, wd, nm, flags, sp, layer])

    # adiacenza per il map matching
    adj = defaultdict(list)
    for k, (a, b, cls, _w, _n, flags, *_r) in enumerate(edges):
        L = math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1])
        cost = L * (1.0 if cls <= 5 else 1.6 if cls == 6 else 2.5 if cls == 7 else 3.5)
        # sensi unici: contromano molto penalizzato (restano possibili le corsie bus in controsenso)
        fwd_pen = 1.6 if flags & 2 else 1.0
        back_pen = 1.6 if flags & 1 else 1.0
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
    gt = build_gtfs.load(gtfs_dir)
    lines_out = []
    failed = 0
    for line in gt['lines']:
        variants = []
        for v in line['variants']:
            res = match(v['shape_pts'])
            if not res or len(res[0]) < 3:
                failed += 1
                continue
            seq, gaps = res
            # controllo: lunghezza agganciata vs lunghezza del tracciato GTFS
            sp = [xz(la, lo) for la, lo in v['shape_pts']]
            Lg = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(sp, sp[1:]))
            Lm = sum(math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1]) for a, b in zip(seq, seq[1:]))
            ratio = Lm / max(1, Lg)
            if ratio > 1.5:
                print(f'  scartata {line["id"]} {v["headsign"]}: agganciato {Lm:.0f} m su {Lg:.0f} m')
                failed += 1
                continue
            # tieni solo le fermate lungo il tratto agganciato (le linee che escono dalla mappa vengono tagliate)
            def dist_to_path(px, pz):
                best = 1e18
                for a, b in zip(seq, seq[1:]):
                    (ax, az), (bx, bz) = nodes[a], nodes[b]
                    dx, dz = bx - ax, bz - az
                    l2 = dx * dx + dz * dz or 1e-9
                    tt = max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / l2))
                    best = min(best, math.hypot(px - ax - dx * tt, pz - az - dz * tt))
                return best
            keep = [i for i, si in enumerate(v['stops']) if dist_to_path(gt['stops'][si][0], gt['stops'][si][1]) < 60]
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
            v2['nodes'] = seq
            variants.append(v2)
        if variants:
            lines_out.append({'id': line['id'], 'color': line['color'], 'variants': variants})
        print('linea', line['id'], len(variants), 'varianti agganciate', flush=True)

    # ---------------- edifici ----------------
    buildings = []
    if overture_path:
        buildings = overture_buildings(overture_path)
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
        floor = 6.2 if (min(a, b), max(a, b)) in bus_edges else 4.2
        if free < wd:
            e[3] = round(max(floor, min(wd, free)), 1)
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
    print('tram: punti', sum(len(t) // 2 for t in tram), 'fermate', len(tram_stops))

    nodes_flat = []
    for x, z in nodes:
        nodes_flat += [round(x, 1), round(z, 1)]
    # le fermate del tram valgono solo dove c'è la rete stradale (l'export OSM finisce prima di Guizza)
    nxs, nzs = nodes_flat[0::2], nodes_flat[1::2]
    bx0, bx1, bz0, bz1 = min(nxs) + 80, max(nxs) - 80, min(nzs) + 80, max(nzs) - 80
    tram_keep = lambda x, z: bx0 <= x <= bx1 and bz0 <= z <= bz1
    data = {
        'source': 'OpenStreetMap contributors (ODbL) + GTFS Busitalia Veneto (BusOne)',
        'origin': [ORIGIN_LAT, ORIGIN_LON], 'ferDate': build_gtfs.FER_DATE, 'fesDate': build_gtfs.FES_DATE,
        'nodes': nodes_flat, 'edges': [v for e in edges for v in e], 'names': names,
        'stops': gt['stops'], 'lines': lines_out,
        'buildings': buildings, 'rails': rails, 'water': water, 'tram': tram, 'tramStops': tram_stops,
        'tramLines': [build_gtfs.load_tram(gtfs_dir, keep=tram_keep)],
    }
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'nodi {len(nodes)} archi {len(edges)} edifici {len(buildings)} binari {len(rails)} acque {len(water)} linee {len(lines_out)} varianti non agganciate {failed}')


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
            out.append([round(src_h, 1), kind, name, flat, hflat] if hflat else [round(src_h, 1), kind, name, flat])
    print('edifici Overture:', len(out))
    return out


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
