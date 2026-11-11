#!/usr/bin/env python3
"""Inventario dei capolinea e delle fermate fuori dalla mappa (corsia capolinea, docs/ESTENSIONE_LINEE.md).

Confronta le linee complete con quello che la mappa tiene:
  * autobus: ogni variante urbana del GTFS (tracciato e fermate di una corsa tipo, corse feriali e festive nei giorni
    di riferimento di build_gtfs.py) con le varianti di src/data/padova-map.json: intera, tagliata ("tratto in città",
    con le fermate fuori) o assente (oltre i 9 km di build_gtfs.RADIUS, oltre le 10 varianti tenute per linea, non
    agganciata);
  * tram: le corse del SIR1 dal GTFS con quelle della mappa; SIR2 e SIR3 da data/tram-linee-nuove.json con la regola
    del gioco (src/data/padova.js: fermate con una strada della mappa entro 120 m, la serie più lunga di fila);
  * fermate agganciate male: lontane dal percorso o nel punto sbagliato (scripts/verifica_mappa.py, se c'è shapely).

Stampa le tabelle in Markdown, da copiare in docs/ESTENSIONE_LINEE.md a ogni gruppo di capolinea.

  python3 scripts/inventario_capolinea.py <cartella_gtfs> [src/data/padova-map.json] [data/tram-linee-nuove.json]
"""
import csv
import json
import math
import sys
from collections import Counter, defaultdict

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import build_gtfs  # noqa: E402

xz = build_gtfs.xz
PLACE = 300  # m: capolinea più vicini di così sono lo stesso luogo
NEAR = 60  # m: un capolinea più vicino di così a un nodo della rete stradale è nella mappa
TRAM_ROAD = 120  # m: come roadWithin in src/data/padova.js


def latlon(x, z):
    return build_gtfs.ORIGIN_LAT - z / build_gtfs.M_LAT, build_gtfs.ORIGIN_LON + x / build_gtfs.M_LON


def gtfs_variants(src):
    """Tutte le varianti urbane del GTFS, come build_gtfs.load ma senza togliere quelle oltre RADIUS e oltre le prime
    10 per linea: [linea, capolinea di partenza, di arrivo, nomi e posizioni delle fermate, corse feriali, festive,
    lontano (oltre RADIUS), posto nella linea]."""
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
        shapes[r['shape_id']].append((float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
    by_line = defaultdict(list)
    for t in trips.values():
        lid = build_gtfs.line_id(routes[t['route_id']]['route_short_name'])
        if lid:
            by_line[lid].append(t)
    ids = {t['trip_id'] for ts in by_line.values() for t in ts}
    times = defaultdict(list)
    for r in rd('stop_times.txt'):
        if r['trip_id'] in ids:
            times[r['trip_id']].append((int(r['stop_sequence']), build_gtfs.secs(r['departure_time'] or r['arrival_time']), r['stop_id']))
    out = []
    for lid, ts in by_line.items():
        groups = defaultdict(list)
        for t in ts:
            if t['trip_id'] in times and t['shape_id'] in shapes:
                groups[t['shape_id']].append(t)
        vs = []
        for sid, tt in groups.items():
            fer = [t for t in tt if build_gtfs.FER_DATE in cal[t['service_id']]]
            fes = [t for t in tt if build_gtfs.FES_DATE in cal[t['service_id']]]
            if len(fer) + len(fes) < 2:
                continue
            far = any(math.hypot(*xz(la, lo)) > build_gtfs.RADIUS for la, lo in shapes[sid])
            ref = sorted(fer or fes, key=lambda t: times[t['trip_id']][-1][1] - times[t['trip_id']][0][1])[len(fer or fes) // 2]
            st = []
            for _, _t, s in sorted(times[ref['trip_id']]):
                s = stops[s]
                x, z = xz(float(s['stop_lat']), float(s['stop_lon']))
                st.append((build_gtfs.clean_name(s['stop_desc'] or s['stop_name']), x, z))
            head = build_gtfs.clean_name(Counter(t['trip_headsign'] for t in tt).most_common(1)[0][0])
            vs.append({'line': lid, 'headsign': head, 'stops': st, 'fer': len(fer), 'fes': len(fes), 'far': far})
        # stesso ordine e stesso taglio di build_gtfs.load: le prime 10 per corse tra quelle entro RADIUS
        vs.sort(key=lambda v: -(v['fer'] + v['fes']))
        rank = 0
        for v in vs:
            v['rank'] = None if v['far'] else rank
            rank += not v['far']
        out += vs
    return out


class NodeGrid:
    """Nodi della rete stradale della mappa, per la distanza di un punto dalla mappa."""

    def __init__(self, nodes, cell=200):
        self.C = cell
        self.g = defaultdict(list)
        for i in range(0, len(nodes), 2):
            self.g[(int(nodes[i] // cell), int(nodes[i + 1] // cell))].append((nodes[i], nodes[i + 1]))

    def dist(self, x, z, cap=20000):
        cx, cz, r, best = int(x // self.C), int(z // self.C), 0, cap
        while r * self.C < best + self.C and r * self.C < cap:
            for a in range(-r, r + 1):
                for b in range(-r, r + 1):
                    if max(abs(a), abs(b)) != r:
                        continue
                    for px, pz in self.g.get((cx + a, cz + b), ()):
                        best = min(best, math.hypot(px - x, pz - z))
            r += 1
        return best


def match_map(v, map_lines, map_stops):
    """Variante della mappa che corrisponde alla variante GTFS v (stessa linea e destinazione, fermate in fila dentro
    quelle di v): (variante, indice della prima fermata tenuta) o None."""
    names = [s[0] for s in v['stops']]
    for mv in map_lines.get(v['line'], ()):
        if mv['headsign'].replace(' (tratto in città)', '') != v['headsign']:
            continue
        kept = [map_stops[i][2] for i in mv['stops']]
        for i0 in range(len(names) - len(kept) + 1):
            if names[i0:i0 + len(kept)] == kept:
                return mv, i0
    return None


def places(points):
    """Raggruppa i capolinea (nome, x, z, peso) a meno di PLACE m: il nome è quello col peso più alto."""
    groups = []
    for p in sorted(points, key=lambda p: -p[3]):
        g = next((g for g in groups if math.hypot(g['x'] - p[1], g['z'] - p[2]) < PLACE), None)
        if g is None:
            groups.append({'name': p[0], 'x': p[1], 'z': p[2], 'items': [p]})
        else:
            g['items'].append(p)
    return groups


def fmt(n):
    return f'{int(n):,}'.replace(',', '.')


def line_key(s):
    return int(''.join(c for c in s if c.isdigit())), s


def km(m):
    return f'{m / 1000:.1f}'.replace('.', ',')


def main(src, map_path='src/data/padova-map.json', tram_path='data/tram-linee-nuove.json'):
    M = json.load(open(map_path, encoding='utf-8'))
    grid = NodeGrid(M['nodes'])
    map_lines = defaultdict(list)
    for L in M['lines']:
        map_lines[L['id']] += L['variants']
    gv = gtfs_variants(src)

    # ---------------- autobus ----------------
    stato = Counter()
    term = []  # capolinea fuori dalle corse del gioco: (nome, x, z, corse feriali, linea, festive, perché)
    fuori = defaultdict(lambda: {'fer': 0, 'stops': set(), 'var': 0, 'cut': 0, 'gone': 0, 'whole': 0, 'why': Counter()})
    for v in gv:
        m = match_map(v, map_lines, M['stops'])
        n = len(v['stops'])
        if m:
            mv, i0 = m
            outside = list(range(i0)) + list(range(i0 + len(mv['stops']), n))
            v['state'] = 'intera' if not outside else 'tagliata'
        else:
            outside = list(range(n))
            v['state'] = 'oltre 9 km' if v['far'] else 'oltre le 10 varianti' if v['rank'] >= 10 else 'non agganciata'
        stato[v['state']] += 1
        f = fuori[v['line']]
        f['var'] += 1
        if outside:
            f['cut' if m else 'gone'] += 1
            f['fer'] += v['fer']
            f['stops'].update(v['stops'][i][0] for i in outside)
            if m:
                a, b = 0 in outside, n - 1 in outside
                f['why']['parte dopo il capolinea e finisce prima' if a and b else 'parte dopo il capolinea' if a
                         else 'finisce prima del capolinea' if b else 'fermate in mezzo fuori dall\'area'] += 1
            else:
                f['why'][v['state']] += 1
        else:
            f['whole'] += 1
        for i in (0, n - 1):
            if i in outside:
                name, x, z = v['stops'][i]
                term.append((name, x, z, v['fer'], v['line'], v['fes'], 'la linea esce prima dalla mappa' if m else v['state']))
    tot = sum(stato.values())
    print(f'## Autobus: {tot} varianti urbane con corse il {build_gtfs.FER_DATE} o il {build_gtfs.FES_DATE}\n')
    print(', '.join(f'{k} {n}' for k, n in stato.most_common()) + '.\n')

    pl = places(term)
    for g in pl:
        g['fer'] = sum(p[3] for p in g['items'])
        g['fes'] = sum(p[5] for p in g['items'])
        g['lines'] = sorted({p[4] for p in g['items']}, key=line_key)
        g['why'] = sorted({p[6] for p in g['items']})
        g['dist'] = grid.dist(g['x'], g['z'])
        g['centre'] = math.hypot(g['x'], g['z'])
    pl.sort(key=lambda g: -g['fer'] - g['fes'])
    print('### Capolinea fuori mappa\n')
    print('Corse feriali e festive che ci partono o ci arrivano (varianti tagliate o assenti); distanza dal nodo più vicino '
          'della rete stradale della mappa.\n')
    print('| Capolinea | Linee | Corse fer. | Corse fest. | Dalla mappa | Dal centro | lat, lon |')
    print('|---|---|---|---|---|---|---|')
    for g in pl:
        if g['dist'] >= NEAR:
            la, lo = latlon(g['x'], g['z'])
            print(f"| {g['name']} | {', '.join(g['lines'])} | {g['fer']} | {g['fes']} | {fmt(round(g['dist'], -1))} m | "
                  f"{km(g['centre'])} km | {la:.4f}, {lo:.4f} |")
    print()
    print(f'### Capolinea nella mappa (entro {NEAR} m dalla rete) ma fuori dalle corse del gioco\n')
    print('| Capolinea | Linee | Corse fer. | Corse fest. | Perché |')
    print('|---|---|---|---|---|')
    for g in pl:
        if g['dist'] < NEAR:
            print(f"| {g['name']} | {', '.join(g['lines'])} | {g['fer']} | {g['fes']} | {'; '.join(g['why'])} |")
    print()
    print('### Varianti per linea\n')
    print('Intere: prima e ultima fermata del GTFS nel gioco, con tracciato e orario interi. Tagliate: nel gioco c\'è il '
          '"tratto in città". Assenti: la variante non c\'è.\n')
    print('| Linea | Varianti | Intere | Tagliate | Assenti | Perché | Corse fer. toccate | Fermate fuori |')
    print('|---|---|---|---|---|---|---|---|')
    for lid in sorted(fuori, key=line_key):
        f = fuori[lid]
        why = '; '.join(f'{k} {n}' for k, n in f['why'].most_common()) or '–'
        print(f"| {lid} | {f['var']} | {f['whole']} | {f['cut']} | {f['gone']} | {why} | {f['fer']} | {len(f['stops'])} |")
    print()

    # ---------------- tram ----------------
    print('## Tram\n')
    print('| Linea | Verso | Fermate | Nella mappa | Fuori | Capolinea fuori |')
    print('|---|---|---|---|---|---|')
    sir1 = build_gtfs.load_tram(src)
    in_map = {}
    for L in M.get('tramLines') or []:
        for mv in L['variants']:
            in_map.setdefault(mv['headsign'].replace(' (tratto in città)', ''), []).append([s[2] for s in mv['stops']])
    for v in sir1['variants'][:4]:
        names = [s[2] for s in v['stops']]
        kept = max((k for k in in_map.get(v['headsign'], ()) if all(n in names for n in k)), key=len, default=[])
        out = [n for n in names if n not in kept]
        ends = [n for n in (names[0], names[-1]) if n in out]
        print(f"| SIR1 | {v['headsign']} ({len(v['fer'])} corse fer.) | {len(names)} | {len(kept)} | {len(out)} | {', '.join(ends) or '–'} |")
    near = lambda x, z: grid.dist(x, z, cap=TRAM_ROAD + 1) < TRAM_ROAD
    for L in json.load(open(tram_path, encoding='utf-8'))['linee']:
        for v in L['versi']:
            st = [(f['nome'],) + xz(f['lat'], f['lon']) for f in v['fermate']]
            ok = [near(x, z) for _, x, z in st]
            best, run, i1 = 0, 0, -1
            for i, o in enumerate(ok):
                run = run + 1 if o else 0
                if run > best:
                    best, i1 = run, i
            i0 = i1 - best + 1
            out = [s[0] for k, s in enumerate(st) if not i0 <= k <= i1]
            ends = [st[k][0] for k in (0, len(st) - 1) if not i0 <= k <= i1]
            far = max((grid.dist(x, z) for k, (_, x, z) in enumerate(st) if not i0 <= k <= i1), default=0)
            print(f"| {L['id']} | {v['headsign']} | {len(st)} | {best} | {len(out)}{f' (fino a {fmt(round(far, -1))} m)' if out else ''} "
                  f"| {', '.join(ends) or '–'} |")
    print()

    # ---------------- fermate agganciate male ----------------
    try:
        import verifica_mappa
    except ImportError:
        print('(fermate agganciate male: serve shapely)')
        return
    lontane, spostate = verifica_mappa.fermate(verifica_mappa.Mappa(M))
    print(f'## Fermate agganciate male: {len(lontane)} lontane dal percorso, {len(spostate)} nel punto sbagliato\n')
    print('| Linea | Verso | Fermata | Metri |')
    print('|---|---|---|---|')
    for c in sorted(lontane + spostate, key=lambda c: -c['metri']):
        print(f"| {c['linea']} | {c['verso']} | {c['nome']} | {fmt(round(c['metri']))} |")


if __name__ == '__main__':
    main(*sys.argv[1:])
