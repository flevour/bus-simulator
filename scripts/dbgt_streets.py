#!/usr/bin/env python3
"""Carreggiate (AC_VEI) e marciapiedi (AR_MARC) misurati del DBGT della Regione del Veneto (lotto Comune di Padova,
volo 2007, IODL 2.0), in coordinate del gioco, per la pianta delle strade.

Uso:
    python3 scripts/dbgt_streets.py <cartella aree> src/data/padova-map.json data/dbgt-strade.json

street_surfaces.surfaces unisce all'asfalto ricavato dalle vie OSM i poligoni di carreggiata che toccano una via OSM
di oggi (piazze, golfi di fermata, anelli dei capolinea, angoli veri degli incroci) e al marciapiede quelli di
marciapiede accanto: la forma vera dove c'è, la rete di oggi (OSM) a decidere dove sono le strade.
La mappa serve solo a ritagliare l'area di gioco.
"""
import json
import os
import sys

import shapely
from shapely.geometry import box

sys.path.insert(0, os.path.dirname(__file__))
from measure_streets import DBGT_SHIFT, dbgt_to_game, shp  # noqa: E402
from dbgt_green import rings  # noqa: E402


def main(aree, map_path, dst):
    m = json.load(open(map_path, encoding='utf-8'))
    xs, zs = m['nodes'][0::2], m['nodes'][1::2]
    area = box(min(xs), min(zs), max(xs), max(zs))
    out = {'fonte': 'DBGT della Regione del Veneto, lotto Comune di Padova (volo 2007, IODL 2.0)'}
    for name, key in (('AC_VEI', 'carreggiate'), ('AR_MARC', 'marciapiedi')):
        g, _ = shp(aree, name)
        g = g[~shapely.is_missing(g)]
        g = dbgt_to_game(shapely.make_valid(g), DBGT_SHIFT)
        g = g[shapely.intersects(g, area)]
        polys = [p.simplify(0.2) for q in g for p in shapely.get_parts(q) if p.geom_type == 'Polygon' and p.area >= 2]
        out[key] = [rings(p) for p in polys if not p.is_empty and p.geom_type == 'Polygon']
        print(f'{key}: {len(out[key])}')
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main(*sys.argv[1:4])
