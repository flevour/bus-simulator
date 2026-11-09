#!/usr/bin/env python3
"""Isole spartitraffico, aree verdi e alberi dal DBGT della Regione del Veneto (lotto Comune di Padova, volo 2007,
IODL 2.0), in coordinate del gioco.

Uso:
    python3 scripts/dbgt_green.py <cartella aree> <cartella linee> src/data/padova-map.json data/dbgt-verde.json

* isole: lo strato SPART (spartitraffico e isole di traffico); build_map.py tiene solo quelle che stanno dentro
  l'asfalto di oggi e fuori dalle corsie (street_surfaces.surfaces);
* verde: AR_VRD dei tipi prato (02), area alberata (03) e aiuola (04), semplificato; i giardini privati (01) restano
  il prato generico del gioco;
* alberi: lungo i filari (FIL_AL) ogni 12 m, nelle aree alberate a maglia di 24 m e nei boschi (BOSCO) di 14 m, con un
  piccolo scarto pseudo-casuale. Il gioco li mette al posto degli alberi generati dentro il comune;
* comune: il confine del Comune (dove valgono i dati del DBGT), semplificato.

La cartella della mappa serve solo a ritagliare l'area di gioco.
"""
import json
import math
import os
import sys
import zlib

import numpy as np
import shapely
from shapely.geometry import box

sys.path.insert(0, os.path.dirname(__file__))
from measure_streets import DBGT_SHIFT, dbgt_to_game, shp  # noqa: E402

ROW_STEP, GROVE_STEP, WOOD_STEP = 12.0, 24.0, 14.0
GREEN_TYPES = {'02': 2, '03': 3, '04': 4}


def flat(ring):
    return [round(v, 1) for xy in list(ring.coords)[:-1] for v in xy]


def rings(p):
    return [flat(p.exterior), *[flat(r) for r in p.interiors if len(r.coords) >= 4]]


def jitter(x, z, k):
    h = zlib.crc32(f'{round(x)}:{round(z)}:{k}'.encode())
    return ((h & 0xffff) / 65535 - 0.5), (((h >> 16) & 0xffff) / 65535 - 0.5)


def grid_points(poly, step):
    """Punti a maglia triangolare dentro il poligono, con uno scarto di un quarto di maglia."""
    x0, z0, x1, z1 = poly.bounds
    xs, zs = [], []
    j = 0
    z = z0 + step / 2
    while z < z1:
        x = x0 + step / 2 + (step / 2 if j % 2 else 0)
        while x < x1:
            jx, jz = jitter(x, z, 1)
            xs.append(x + jx * step / 2)
            zs.append(z + jz * step / 2)
            x += step
        z += step * 0.866
        j += 1
    if not xs:
        return []
    xs, zs = np.array(xs), np.array(zs)
    keep = shapely.contains_xy(poly, xs, zs)
    return list(zip(xs[keep], zs[keep]))


def main(aree, linee, map_path, dst):
    m = json.load(open(map_path, encoding='utf-8'))
    xs, zs = m['nodes'][0::2], m['nodes'][1::2]
    area = box(min(xs), min(zs), max(xs), max(zs))
    out = {'fonte': 'DBGT della Regione del Veneto, lotto Comune di Padova (volo 2007, IODL 2.0)'}

    def layer(folder, name, cols=()):
        g, f = shp(folder, name, cols)
        ok = ~shapely.is_missing(g)
        g = dbgt_to_game(shapely.make_valid(g[ok]), DBGT_SHIFT)
        f = [np.array(c)[ok] for c in f]
        inside = shapely.intersects(g, area)
        return g[inside], [c[inside] for c in f]

    # isole
    g, _ = layer(aree, 'SPART')
    isole = [rings(p) for q in g for p in shapely.get_parts(q) if p.geom_type == 'Polygon' and p.area >= 3]
    out['isole'] = isole
    # verde
    g, (ty,) = layer(aree, 'AR_VRD', ['AR_VRD_TY'])
    verde = []
    for p, t in zip(g, ty):
        if t not in GREEN_TYPES:
            continue
        for q in shapely.get_parts(p.simplify(1.0)):
            if q.geom_type == 'Polygon' and q.area >= (12 if t == '04' else 40):
                verde.append([GREEN_TYPES[t], *rings(q)])
    out['verde'] = verde
    # alberi
    alberi = []
    groves = [p for p, t in zip(g, ty) if t == '03']
    for p in groves:
        alberi += grid_points(p, GROVE_STEP)
    gb, _ = layer(aree, 'BOSCO')
    for p in gb:
        alberi += grid_points(p, WOOD_STEP)
    gf, _ = layer(linee, 'FIL_AL')
    for ln in gf:
        for part in shapely.get_parts(ln):
            if part.geom_type != 'LineString':
                continue
            L = part.length
            n = max(1, int(L // ROW_STEP))
            for k in range(n):
                q = part.interpolate((k + 0.5) * L / n)
                alberi.append((q.x, q.y))
    out['alberi'] = [round(v, 1) for xy in alberi for v in xy]
    # confine del comune
    gc, _ = layer(aree, 'COMUNE')
    comune = shapely.union_all(gc).simplify(5)
    out['comune'] = [rings(p) for p in shapely.get_parts(comune) if p.geom_type == 'Polygon']
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'isole {len(isole)}, aree verdi {len(verde)}, alberi {len(alberi)} '
          f'(aree alberate {len(groves)}, boschi {len(gb)}, filari {len(gf)})')


if __name__ == '__main__':
    main(*sys.argv[1:5])
