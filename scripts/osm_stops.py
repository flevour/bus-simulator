#!/usr/bin/env python3
"""Fermate dei bus di OpenStreetMap (highway=bus_stop), dallo strato Overture base/infrastructure che riporta i tag
OSM originali (scripts/overture_layers.py).

Uso:
    python3 scripts/osm_stops.py <base-infrastructure.parquet> data/osm-fermate.json

Uscita: {"fonte": ..., "fermate": [[x, z, nome, ref, pensilina, panchina], ...], "banchine": [[x, z, x, z, ...], ...]} in
coordinate del gioco; pensilina e panchina valgono 1 (sì), 0 (no) o null (non detto); le banchine sono le aree dei bus
(highway=platform: le corsie della stazione), non quelle di treni e tram. build_map.py sposta la fermata GTFS sulla palina OSM vicina e
il gioco mette la pensilina solo dove OSM la segna.
"""
import json
import os
import sys

import pyarrow.parquet as pq
import shapely

sys.path.insert(0, os.path.dirname(__file__))
import build_gtfs  # noqa: E402


def yesno(v):
    if v is None:
        return None
    return 0 if v in ('no', 'none', 'separate') else 1


def bus_platform(r, tags):
    """Banchina dei bus (area): highway=platform o public_transport=platform con bus=yes; non quelle di treni e tram."""
    if r['class'] != 'platform' or tags.get('railway') or tags.get('tram') == 'yes' or tags.get('train') == 'yes':
        return False
    return tags.get('highway') == 'platform' or (tags.get('public_transport') == 'platform' and tags.get('bus') == 'yes')


def main(src, dst):
    out, plats = [], []
    for r in pq.read_table(src).to_pylist():
        tags = dict(r.get('source_tags') or [])
        if bus_platform(r, tags):
            g = shapely.from_wkb(r['geometry'])
            if g.geom_type == 'Polygon' and len(g.exterior.coords) >= 4:
                plats.append([round(v, 2) for lon, lat, *_ in g.exterior.coords[:-1] for v in build_gtfs.xz(lat, lon)])
            continue
        if r['class'] != 'bus_stop':
            continue
        b = r['bbox']
        lon, lat = (b['xmin'] + b['xmax']) / 2, (b['ymin'] + b['ymax']) / 2
        x, z = build_gtfs.xz(lat, lon)
        name = (r.get('names') or {}).get('primary') or tags.get('name') or ''
        out.append([round(x, 1), round(z, 1), name, tags.get('ref') or tags.get('local_ref') or '', yesno(tags.get('shelter')), yesno(tags.get('bench'))])
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump({'fonte': 'OpenStreetMap contributors (ODbL), via Overture Maps', 'fermate': out, 'banchine': plats}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'fermate {len(out)}, con pensilina {sum(1 for s in out if s[4] == 1)}, senza {sum(1 for s in out if s[4] == 0)}, con ref {sum(1 for s in out if s[3])}; banchine {len(plats)}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
