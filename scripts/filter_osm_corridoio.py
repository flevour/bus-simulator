#!/usr/bin/env python3
"""Strade, binari, acque e segnaletica OSM dei corridoi fino ai capolinea (CORRIDOI_TRAM e CORRIDOI_BUS di
build_map.py) che mancano agli export di oggi, data/osm-padova.json e data/osm-padova-nodes.json (corsia capolinea,
docs/ESTENSIONE_LINEE.md).

Uso:
    python3 scripts/filter_osm_corridoio.py query <cartella_gtfs> /tmp/corridoio [linee]
    for q in /tmp/corridoio/riquadro-*.ql; do
      curl -X POST -A "padova-bus-simulator" --data-urlencode data@$q -o ${q%.ql}.json https://overpass-api.de/api/interpreter
    done
    python3 scripts/filter_osm_corridoio.py filtra <cartella_gtfs> data/osm-padova.json data/osm-padova-nodes.json \\
        data/osm-corridoio.json /tmp/corridoio/riquadro-*.json

La query chiede, in un riquadro per ogni gruppo di celle contigue dei corridoi fuori dai riquadri FOCUS (allargato del
margine con cui build_map.py tiene le vie), le stesse vie dell'export delle strade (highway carrabili e pedonali,
railway rail e razed, waterway canal e river) e gli stessi nodi di scripts/overpass-nodes.ql: una query per riquadro,
perché tutte insieme il server pubblico le rifiuta. Quando rifiuta anche quelle (502 e 504 per ore), passano da
overpass-turbo.eu nel browser: query nell'editor, Esegui, Esporta → "dati OSM grezzi" (non GeoJSON, che non ha gli id
dei nodi), salvata come riquadro-<n>.json. Con linee (linee del bus appena aggiunte a CORRIDOI_BUS, separate da
virgole: "24,3,22") chiede solo le celle che aggiungono quelle linee; il resto è già in data/osm-corridoio.json. Il
filtro tiene quello che data/osm-corridoio.json ha già e aggiunge:
* le vie che toccano una cella dei corridoi fuori dai riquadri FOCUS, che non sono già in data/osm-padova.json e che
  non sono pezzi di vie che ci sono (una via spezzata in OSM dopo l'export cambia id: se metà dei suoi nodi sono già
  su una via dell'export, si salta);
* i nodi della segnaletica (gli stessi di scripts/filter_osm_nodes.py) nelle celle dei corridoi fuori dai riquadri,
  che non sono già in data/osm-padova-nodes.json.

build_map.py li unisce a quelli degli export di oggi. Dati © OpenStreetMap contributors (ODbL).
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import build_gtfs  # noqa: E402
import build_map  # noqa: E402
import filter_osm_nodes  # noqa: E402

MARGINE = 0.0015  # gradi, come il filtro delle vie in build_map.main
HIGHWAY = 'trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian'


def in_box(lat, lon, m=0.0):
    return any(b[0] - m <= lon <= b[2] + m and b[1] - m <= lat <= b[3] + m for b in build_map.FOCUS_BOXES)


def new_area(lat, lon, m=0.0):
    """Il punto è in una cella dei corridoi (allargata di m gradi) e non nei riquadri di prima."""
    return not in_box(lat, lon, m) and build_map.in_focus(lat, lon, m)


def corridor_cells(gtfs_dir, nuove=()):
    """Celle dei corridoi (tram e autobus), come le calcola build_map.main; anche in build_map.FOCUS_CELLE. Con nuove
    (linee di CORRIDOI_BUS), solo le celle che aggiungono quelle linee."""
    gt = build_gtfs.load(gtfs_dir, full=build_map.CORRIDOI_BUS)
    prima = build_map.tram_corridors() | build_map.bus_corridors(gt, [l for l in build_map.CORRIDOI_BUS if l not in nuove])
    build_map.FOCUS_CELLE.update(prima | build_map.bus_corridors(gt))
    return build_map.FOCUS_CELLE - prima if nuove else build_map.FOCUS_CELLE


def boxes(cells):
    """Riquadri (S, W, N, E) dei gruppi di celle contigue fuori dai riquadri FOCUS, allargati del margine."""
    C = build_map.CELLA
    out = [c for c in cells if not in_box(*build_map.latlon((c[0] + 0.5) * C, (c[1] + 0.5) * C))]
    left, groups = set(out), []
    while left:
        stack, g = [left.pop()], []
        while stack:
            i, j = stack.pop()
            g.append((i, j))
            for a in (-1, 0, 1):
                for b in (-1, 0, 1):
                    if (i + a, j + b) in left:
                        left.remove((i + a, j + b))
                        stack.append((i + a, j + b))
        groups.append(g)
    res = []
    for g in groups:
        x0, x1 = min(i for i, j in g) * C, (max(i for i, j in g) + 1) * C
        z0, z1 = min(j for i, j in g) * C, (max(j for i, j in g) + 1) * C
        n, w = build_map.latlon(x0, z0)
        s, e = build_map.latlon(x1, z1)
        res.append((s - MARGINE, w - MARGINE, n + MARGINE, e + MARGINE))
    return sorted(res)


def query(gtfs_dir, out_dir, nuove=()):
    """Una query Overpass per riquadro, <out_dir>/riquadro-<n>.ql."""
    bb = boxes(corridor_cells(gtfs_dir, nuove))
    os.makedirs(out_dir, exist_ok=True)
    for n, (s, w, nn, e) in enumerate(bb, 1):
        b = f'({s:.4f},{w:.4f},{nn:.4f},{e:.4f})'
        with open(f'{out_dir}/riquadro-{n}.ql', 'w', encoding='utf-8') as f:
            f.write(f'// generata da scripts/filter_osm_corridoio.py query: riquadro {n} di {len(bb)}\n'
                    '[out:json][timeout:600][maxsize:1073741824];\n(\n'
                    f'  way["highway"~"^({HIGHWAY})$"]{b};\n  way["railway"~"^(rail|razed)$"]{b};\n'
                    f'  way["waterway"~"^(canal|river)$"]{b};\n);\nout geom;\n(\n'
                    f'  node["highway"~"^(traffic_signals|stop|give_way|crossing)$"]{b};\n  node["crossing"]{b};\n'
                    f'  node["traffic_signals:direction"]{b};\n  node["direction"]{b};\n  node["traffic_calming"]{b};\n);\nout body;\n')
    print(f'{len(bb)} riquadri in {out_dir}')


def filtra(gtfs_dir, osm_path, nodes_path, out, srcs):
    corridor_cells(gtfs_dir)
    old = json.load(open(osm_path, encoding='utf-8'))['elements']
    kept = json.load(open(out, encoding='utf-8'))['elements'] if os.path.exists(out) else []
    old_ways = {e['id'] for e in old + kept if e['type'] == 'way'}
    old_nodes = {n for e in old + kept if e['type'] == 'way' for n in e.get('nodes', ())}
    old_signs = {e['id'] for e in json.load(open(nodes_path, encoding='utf-8'))['elements'] + kept if e['type'] == 'node'}
    ways, signs, split, seen = [], [], 0, set()
    for src in srcs:
        d = json.load(open(src, encoding='utf-8'))
        for e in d['elements']:
            if (e['type'], e['id']) in seen:
                continue
            seen.add((e['type'], e['id']))
            if e['type'] == 'way':
                if e['id'] in old_ways or not any(new_area(g['lat'], g['lon'], MARGINE) for g in e['geometry']):
                    continue
                if sum(n in old_nodes for n in e['nodes']) * 2 >= len(e['nodes']):
                    split += 1
                    continue
                ways.append({k: e[k] for k in ('type', 'id', 'bounds', 'nodes', 'geometry', 'tags') if k in e})
            elif e['type'] == 'node':
                t = e.get('tags', {})
                if e['id'] in old_signs or not filter_osm_nodes.useful(t) or not new_area(e['lat'], e['lon']):
                    continue
                signs.append({'type': 'node', 'id': e['id'], 'lat': e['lat'], 'lon': e['lon'],
                              'tags': {k: t[k] for k in filter_osm_nodes.TAGS if k in t}})
    els = (sorted([e for e in kept if e['type'] == 'way'] + ways, key=lambda e: e['id'])
           + sorted([e for e in kept if e['type'] == 'node'] + signs, key=lambda e: e['id']))
    # un elemento per riga, come data/osm-padova-nodes.json
    with open(out, 'w', encoding='utf-8') as f:
        f.write('{"osm3s":' + json.dumps(d.get('osm3s', {}), ensure_ascii=False) + ',"elements":[\n')
        f.write(',\n'.join(json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in els))
        f.write('\n]}\n')
    print(f'vie nuove {len(ways)} (saltate perché pezzi di vie che ci sono: {split}), nodi della segnaletica nuovi '
          f'{len(signs)}; in tutto {len(els)} elementi')


if __name__ == '__main__':
    if sys.argv[1] == 'query':
        query(sys.argv[2], sys.argv[3], tuple(sys.argv[4].split(',')) if len(sys.argv) > 4 else ())
    else:
        filtra(*sys.argv[2:6], sys.argv[6:])
