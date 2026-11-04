#!/usr/bin/env python3
"""Converte il GTFS Busitalia Veneto (Padova) nei dati del gioco.

Uso:
    python3 scripts/build_gtfs.py <cartella_gtfs_estratta> src/data/gtfs-padova.json

Il GTFS si scarica da https://proxy.busone.app/biv/gtfs.zip (feed BusOne, elencato
nel Mobility Database come id 3584). I tracciati (shapes) di tutte le linee sono
costruiti su un grafo stradale condiviso: le vie percorse da più linee hanno gli
stessi vertici. Da qui si ricava:
  * la rete stradale percorsa dai mezzi pubblici (vertici + archi),
  * le linee urbane con le varianti di percorso, le fermate reali e gli orari.
"""
import csv
import json
import math
import re
import sys
from collections import Counter, defaultdict

ORIGIN_LAT, ORIGIN_LON = 45.4075, 11.8775
M_LAT = 111130.0
M_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))
RADIUS = 9000  # metri attorno al centro inclusi nella rete stradale
FER_DATE, FES_DATE = '20261104', '20261108'  # mercoledì, domenica


def xz(lat, lon):
    return ((lon - ORIGIN_LON) * M_LON, -(lat - ORIGIN_LAT) * M_LAT)


def secs(t):
    h, m, s = (int(v) for v in t.split(':'))
    return h * 3600 + m * 60 + s


def line_id(short):
    m = re.match(r'^U0*(\d+)(B?)$', short)
    return (m.group(1) + m.group(2)) if m else None


def clean_name(desc):
    d = re.sub(r'\s+', ' ', desc).strip()
    return d[:1].upper() + d[1:]


def street_of(desc):
    d = re.split(r'\s(?:fr\.|ang\.|incr\.|civ\.|n\.)|\s\d|\(|/', desc)[0].strip()
    return d


def main(src, out):
    rd = lambda f: csv.DictReader(open(f'{src}/{f}', encoding='utf-8-sig'))
    routes = {r['route_id']: r for r in rd('routes.txt')}
    trips = {t['trip_id']: t for t in rd('trips.txt')}
    stops = {s['stop_id']: s for s in rd('stops.txt')}
    cal = defaultdict(set)
    for r in rd('calendar_dates.txt'):
        if r['exception_type'] == '1':
            cal[r['service_id']].add(r['date'])
    shapes = defaultdict(list)
    for r in rd('shapes.txt'):
        shapes[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
    for k in shapes:
        shapes[k].sort()
    shape_route = {}
    for t in trips.values():
        shape_route.setdefault(t['shape_id'], t['route_id'])

    # ---------------- rete stradale ----------------
    vid = {}
    verts = []

    def vertex(lat, lon):
        k = (round(lat, 6), round(lon, 6))
        if k not in vid:
            x, z = xz(lat, lon)
            # unisce vertici quasi coincidenti (< 1.5 m)
            g = (round(x / 1.5), round(z / 1.5))
            if g in grid:
                vid[k] = grid[g]
            else:
                vid[k] = len(verts)
                grid[g] = vid[k]
                verts.append((x, z))
        return vid[k]

    grid = {}
    edge_routes = defaultdict(set)
    edge_tram = set()
    shape_nodes = {}
    for sid, pts in shapes.items():
        rid = shape_route.get(sid)
        if rid is None:
            continue
        seq = []
        for _, la, lo in pts:
            x, z = xz(la, lo)
            if math.hypot(x, z) > RADIUS:
                seq.append(None)
                continue
            v = vertex(la, lo)
            if not seq or seq[-1] != v:
                seq.append(v)
        shape_nodes[sid] = seq
        for a, b in zip(seq, seq[1:]):
            if a is None or b is None or a == b:
                continue
            e = (min(a, b), max(a, b))
            edge_routes[e].add(rid)
            if routes[rid]['agency_id'] != '10':
                edge_tram.add(e)

    # vertici effettivamente usati
    used = sorted({v for e in edge_routes for v in e})
    remap = {v: i for i, v in enumerate(used)}
    nodes_out = []
    for v in used:
        x, z = verts[v]
        nodes_out += [round(x, 1), round(z, 1)]
    edges_out = []
    for (a, b), rs in edge_routes.items():
        bus_routes = len({r for r in rs if routes[r]['agency_id'] == '10'})
        edges_out += [remap[a], remap[b], bus_routes, 1 if (a, b) in edge_tram else 0]

    # ---------------- linee urbane ----------------
    by_line = defaultdict(list)
    for t in trips.values():
        r = routes[t['route_id']]
        lid = line_id(r['route_short_name'])
        if lid:
            by_line[lid].append(t)
    trip_ids = {t['trip_id'] for ts in by_line.values() for t in ts}
    times = defaultdict(list)
    for r in rd('stop_times.txt'):
        if r['trip_id'] in trip_ids:
            times[r['trip_id']].append((int(r['stop_sequence']), secs(r['departure_time'] or r['arrival_time']), r['stop_id']))
    stop_index = {}
    stops_out = []

    def stop_ref(sid):
        if sid not in stop_index:
            s = stops[sid]
            x, z = xz(float(s['stop_lat']), float(s['stop_lon']))
            stop_index[sid] = len(stops_out)
            desc = clean_name(s['stop_desc'] or s['stop_name'])
            stops_out.append([round(x, 1), round(z, 1), desc, street_of(desc)])
        return stop_index[sid]

    lines_out = []
    for lid, ts in by_line.items():
        color = '#' + (routes[ts[0]['route_id']]['route_color'] or '607d8b')
        groups = defaultdict(list)
        for t in ts:
            if t['trip_id'] in times and t['shape_id'] in shape_nodes:
                groups[t['shape_id']].append(t)
        variants = []
        for sid, tt in groups.items():
            fer = [t for t in tt if FER_DATE in cal[t['service_id']]]
            fes = [t for t in tt if FES_DATE in cal[t['service_id']]]
            if len(fer) + len(fes) < 2:
                continue
            seq = shape_nodes[sid]
            if any(v is None for v in seq) or len(seq) < 3:
                continue  # esce dall'area del gioco
            ref = sorted(fer or fes, key=lambda t: times[t['trip_id']][-1][1] - times[t['trip_id']][0][1])[len(fer or fes) // 2]
            st = sorted(times[ref['trip_id']])
            t0 = st[0][1]
            dur_ref = max(1, st[-1][1] - t0)

            def deps(lst):
                out = []
                for t in lst:
                    s2 = sorted(times[t['trip_id']])
                    out.append([s2[0][1], s2[-1][1] - s2[0][1]])
                return sorted(out)

            head = Counter(t['trip_headsign'] for t in tt).most_common(1)[0][0]
            variants.append({
                'shape': sid,
                'headsign': clean_name(head),
                'nodes': [remap[v] for v in seq],
                'stops': [stop_ref(s[2]) for s in st],
                'offsets': [s[1] - t0 for s in st],
                'duration': dur_ref,
                'fer': deps(fer),
                'fes': deps(fes),
            })
        if not variants:
            continue
        variants.sort(key=lambda v: -(len(v['fer']) + len(v['fes'])))
        lines_out.append({'id': lid, 'color': color, 'variants': variants[:10]})

    def sort_key(l):
        m = re.match(r'(\d+)(.*)', l['id'])
        return (int(m.group(1)), m.group(2))

    lines_out.sort(key=sort_key)
    data = {
        'source': 'GTFS Busitalia Veneto (BusOne), feed ' + FER_DATE[:6],
        'origin': [ORIGIN_LAT, ORIGIN_LON],
        'ferDate': FER_DATE, 'fesDate': FES_DATE,
        'nodes': nodes_out, 'edges': edges_out, 'stops': stops_out, 'lines': lines_out,
    }
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'nodi {len(used)}, archi {len(edge_routes)}, fermate {len(stops_out)}, linee {len(lines_out)}')
    for l in lines_out:
        v = l['variants'][0]
        print(l['id'], len(l['variants']), 'varianti;', v['headsign'], '|', len(v['fer']), 'fer', len(v['fes']), 'fes')


def load(src):
    """Linee urbane con varianti (tracciato in lat/lon), fermate e orari, senza costruire la rete."""
    rd = lambda f: csv.DictReader(open(f'{src}/{f}', encoding='utf-8-sig'))
    routes = {r['route_id']: r for r in rd('routes.txt')}
    trips = {t['trip_id']: t for t in rd('trips.txt')}
    stops = {s['stop_id']: s for s in rd('stops.txt')}
    cal = defaultdict(set)
    for r in rd('calendar_dates.txt'):
        if r['exception_type'] == '1':
            cal[r['service_id']].add(r['date'])
    shapes = defaultdict(list)
    for r in rd('shapes.txt'):
        shapes[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
    by_line = defaultdict(list)
    for t in trips.values():
        lid = line_id(routes[t['route_id']]['route_short_name'])
        if lid:
            by_line[lid].append(t)
    trip_ids = {t['trip_id'] for ts in by_line.values() for t in ts}
    times = defaultdict(list)
    for r in rd('stop_times.txt'):
        if r['trip_id'] in trip_ids:
            times[r['trip_id']].append((int(r['stop_sequence']), secs(r['departure_time'] or r['arrival_time']), r['stop_id']))
    stop_index, stops_out = {}, []

    def stop_ref(sid):
        if sid not in stop_index:
            s = stops[sid]
            x, z = xz(float(s['stop_lat']), float(s['stop_lon']))
            stop_index[sid] = len(stops_out)
            desc = clean_name(s['stop_desc'] or s['stop_name'])
            stops_out.append([round(x, 1), round(z, 1), desc, street_of(desc)])
        return stop_index[sid]

    lines = []
    for lid, ts in by_line.items():
        color = '#' + (routes[ts[0]['route_id']]['route_color'] or '607d8b')
        groups = defaultdict(list)
        for t in ts:
            if t['trip_id'] in times and t['shape_id'] in shapes:
                groups[t['shape_id']].append(t)
        variants = []
        for sid, tt in groups.items():
            fer = [t for t in tt if FER_DATE in cal[t['service_id']]]
            fes = [t for t in tt if FES_DATE in cal[t['service_id']]]
            if len(fer) + len(fes) < 2:
                continue
            pts = [(la, lo) for _, la, lo in sorted(shapes[sid])]
            if any(math.hypot(*xz(la, lo)) > RADIUS for la, lo in pts):
                continue
            ref = sorted(fer or fes, key=lambda t: times[t['trip_id']][-1][1] - times[t['trip_id']][0][1])[len(fer or fes) // 2]
            st = sorted(times[ref['trip_id']])
            t0 = st[0][1]

            def deps(lst):
                out = []
                for t in lst:
                    s2 = sorted(times[t['trip_id']])
                    out.append([s2[0][1], s2[-1][1] - s2[0][1]])
                return sorted(out)

            head = Counter(t['trip_headsign'] for t in tt).most_common(1)[0][0]
            variants.append({
                'headsign': clean_name(head), 'shape_pts': pts,
                'stops': [stop_ref(s[2]) for s in st], 'offsets': [s[1] - t0 for s in st],
                'duration': max(1, st[-1][1] - t0), 'fer': deps(fer), 'fes': deps(fes),
            })
        if variants:
            variants.sort(key=lambda v: -(len(v['fer']) + len(v['fes'])))
            lines.append({'id': lid, 'color': color, 'variants': variants[:10]})

    def sort_key(l):
        m = re.match(r'(\d+)(.*)', l['id'])
        return (int(m.group(1)), m.group(2))

    lines.sort(key=sort_key)
    return {'lines': lines, 'stops': stops_out}


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
