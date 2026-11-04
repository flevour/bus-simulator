#!/usr/bin/env python3
"""Riduce l'export Overpass di scripts/overpass-nodes.ql ai nodi e ai tag che usa build_map.py.

Uso:
    python3 scripts/filter_osm_nodes.py <export_overpass.json> data/osm-padova-nodes.json

Dati © OpenStreetMap contributors (ODbL).
"""
import json
import sys

TAGS = ('highway', 'crossing', 'crossing:signals', 'crossing:markings', 'traffic_signals',
        'traffic_signals:direction', 'direction', 'stop', 'priority')
HIGHWAY = ('traffic_signals', 'stop', 'give_way', 'crossing')


def useful(t):
    return t.get('highway') in HIGHWAY or 'crossing' in t or 'traffic_signals:direction' in t


def main(src, out):
    d = json.load(open(src, encoding='utf-8'))
    els = []
    for e in d['elements']:
        t = e.get('tags', {})
        if e['type'] != 'node' or not useful(t):
            continue
        els.append({'type': 'node', 'id': e['id'], 'lat': e['lat'], 'lon': e['lon'],
                    'tags': {k: t[k] for k in TAGS if k in t}})
    els.sort(key=lambda e: e['id'])
    # un nodo per riga: i diff tra un export e l'altro restano leggibili
    with open(out, 'w', encoding='utf-8') as f:
        f.write('{"osm3s":' + json.dumps(d.get('osm3s', {}), ensure_ascii=False) + ',"elements":[\n')
        f.write(',\n'.join(json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in els))
        f.write('\n]}\n')
    print(f'nodi tenuti {len(els)} su {len(d["elements"])}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
