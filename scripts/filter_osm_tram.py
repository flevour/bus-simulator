#!/usr/bin/env python3
"""Riduce l'export Overpass di scripts/overpass-tram.ql a binari, banchine, fermate e tag che usa build_map.py.

Uso:
    python3 scripts/filter_osm_tram.py <export_overpass.json> data/osm-padova-tram.json

Dati © OpenStreetMap contributors (ODbL).
"""
import json
import sys

TAGS = ('railway', 'public_transport', 'tram', 'service', 'name', 'ref', 'bridge', 'tunnel', 'layer', 'oneway')


def useful(t):
    return t.get('railway') == 'tram' or (t.get('tram') == 'yes' and 'platform' in (t.get('railway'), t.get('public_transport')))


def stop_node(t):
    """Nodo dove si ferma il tram: railway=tram_stop o stop_position con tram=yes (non le paline sulle banchine)."""
    return t.get('public_transport') == 'stop_position' and (t.get('tram') == 'yes' or t.get('railway') == 'tram_stop') or \
        (t.get('railway') == 'tram_stop' and t.get('public_transport') != 'platform')


def main(src, out):
    d = json.load(open(src, encoding='utf-8'))
    els = []
    for e in d['elements']:
        t = e.get('tags', {})
        if e['type'] == 'node' and stop_node(t):
            els.append({'type': 'node', 'id': e['id'], 'lat': round(e['lat'], 7), 'lon': round(e['lon'], 7), 'tags': {k: t[k] for k in TAGS if k in t}})
        if e['type'] != 'way' or not useful(t) or 'geometry' not in e:
            continue
        els.append({'type': 'way', 'id': e['id'], 'tags': {k: t[k] for k in TAGS if k in t},
                    'geometry': [{'lat': round(g['lat'], 7), 'lon': round(g['lon'], 7)} for g in e['geometry']]})
    els.sort(key=lambda e: (e['type'] != 'way', e['id']))
    # un binario per riga: i diff tra un export e l'altro restano leggibili
    with open(out, 'w', encoding='utf-8') as f:
        f.write('{"osm3s":' + json.dumps(d.get('osm3s', {}), ensure_ascii=False) + ',"elements":[\n')
        f.write(',\n'.join(json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in els))
        f.write('\n]}\n')
    print(f'binari, banchine e fermate tenuti {len(els)} su {len(d["elements"])}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
