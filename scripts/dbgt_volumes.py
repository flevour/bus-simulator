#!/usr/bin/env python3
"""Volumi degli edifici misurati del DBGT della Regione Veneto (lotto Comune di Padova, volo 2007, IODL 2.0).

Uso:
    python3 scripts/dbgt_volumes.py <cartella aree del DBGT> data/dbgt-volumi.json

Dallo strato UN_VOL (unità volumetriche) tiene per ogni volume il baricentro in coordinate del gioco, l'area della
pianta, l'altezza (UN_VOL_AV, dalla base alla gronda), il tipo di porzione (1 a terra, 2 aggetto, 3 copertura di
portico) e l'altezza libera sotto (UN_VOL_INH, i portici). build_map.py li usa per l'altezza degli edifici.

Uscita: {"fonte": ..., "v": [x, z, area, altezza, porzione, altezza libera, ...]} (sei numeri per volume).
"""
import json
import os
import sys

import numpy as np
import shapely

sys.path.insert(0, os.path.dirname(__file__))
from measure_streets import DBGT_SHIFT, dbgt_to_game, shp  # noqa: E402


def main(src, dst):
    geoms, fields = shp(src, 'UN_VOL', ['UN_VOL_POR', 'UN_VOL_AV', 'UN_VOL_INH'])
    por, av, inh = (np.array(f) for f in fields)
    ok = ~shapely.is_missing(geoms)
    g = dbgt_to_game(geoms[ok], DBGT_SHIFT)
    por, av, inh = por[ok], av[ok].astype(float), inh[ok].astype(float)
    area = shapely.area(g)
    c = shapely.centroid(g)
    x, z = shapely.get_x(c), shapely.get_y(c)
    keep = (area >= 4) & (av > 0.5) & (av < 120)
    out = []
    for i in np.flatnonzero(keep):
        p = int(por[i]) if str(por[i]).strip().isdigit() else 1
        out += [round(float(x[i]), 1), round(float(z[i]), 1), round(float(area[i]), 1), round(float(av[i]), 1), p, round(float(inh[i]), 1)]
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump({'fonte': 'DBGT della Regione Veneto, lotto Comune di Padova (volo 2007, IODL 2.0), strato UN_VOL',
                   'v': out}, f, separators=(',', ':'))
    print(f'volumi {keep.sum()} su {len(keep)}; altezza mediana {np.median(av[keep]):.1f} m; portici {int((por[keep].astype(str) == "03").sum())}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
