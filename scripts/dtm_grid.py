#!/usr/bin/env python3
"""Quote del terreno per il gioco dal DTM a 5 m della Regione Veneto (rv:DTM_RV_5m_3003, IODL 2.0).

Uso:
    python3 scripts/dtm_grid.py <dtm.tif in EPSG:3003> data/dtm-padova.json [passo in m, 10]

Il DTM (Gauss-Boaga fuso ovest) si campiona nei centri delle celle di una griglia nelle coordinate del gioco (x est,
z sud), facendo la media dei punti a 2,5 m dal centro (così gli argini stretti non spariscono né diventano scalini).
Le quote si scrivono relative alla mediana dell'area, in un byte: quota = byte * scale + offset (m).

Uscita: {"fonte", "x0", "z0", "step", "nx", "nz", "scale", "offset", "ref", "data" (base64, righe lungo x)}.
Il DTM si scarica dal GeoServer della Regione con una richiesta WPS (ras:CropCoverage su rv:DTM_RV_5m_3003): vedi
docs/PIANO_MODELLO_CITTA.md.
"""
import base64
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build_gtfs  # noqa: E402


def main(src, dst, step=10.0):
    import rasterio
    from pyproj import Transformer
    with rasterio.open(src) as r:
        a = r.read(1).astype(np.float64)
        tr = r.transform
        nodata = r.nodata
    a[a == nodata] = np.nan
    H, W = a.shape
    # estensione del DTM in coordinate del gioco (gli angoli, poi il rettangolo che li contiene)
    to_ll = Transformer.from_crs(3003, 4326, always_xy=True)
    to_gb = Transformer.from_crs(4326, 3003, always_xy=True)
    cx = [tr.c, tr.c + tr.a * W]
    cy = [tr.f, tr.f + tr.e * H]
    corners = [to_ll.transform(x, y) for x in cx for y in cy]
    gx = [(lon - build_gtfs.ORIGIN_LON) * build_gtfs.M_LON for lon, lat in corners]
    gz = [-(lat - build_gtfs.ORIGIN_LAT) * build_gtfs.M_LAT for lon, lat in corners]
    x0, x1 = np.ceil(max(sorted(gx)[:2]) / step) * step, np.floor(min(sorted(gx)[2:]) / step) * step
    z0, z1 = np.ceil(max(sorted(gz)[:2]) / step) * step, np.floor(min(sorted(gz)[2:]) / step) * step
    nx, nz = int((x1 - x0) / step) + 1, int((z1 - z0) / step) + 1
    xs, zs = np.meshgrid(x0 + np.arange(nx) * step, z0 + np.arange(nz) * step)

    def sample(x, z):
        lon = build_gtfs.ORIGIN_LON + x / build_gtfs.M_LON
        lat = build_gtfs.ORIGIN_LAT - z / build_gtfs.M_LAT
        X, Y = to_gb.transform(lon, lat)
        c = (X - tr.c) / tr.a - 0.5
        rr = (Y - tr.f) / tr.e - 0.5
        i0, j0 = np.clip(np.floor(c).astype(int), 0, W - 2), np.clip(np.floor(rr).astype(int), 0, H - 2)
        fx, fy = np.clip(c - i0, 0, 1), np.clip(rr - j0, 0, 1)
        v = (a[j0, i0] * (1 - fx) + a[j0, i0 + 1] * fx) * (1 - fy) + (a[j0 + 1, i0] * (1 - fx) + a[j0 + 1, i0 + 1] * fx) * fy
        return v
    q = step / 4
    h = np.nanmean([sample(xs + dx, zs + dz) for dx in (-q, q) for dz in (-q, q)], axis=0)
    ref = float(np.nanmedian(h))
    lo, hi = np.nanpercentile(h, 0.2), np.nanpercentile(h, 99.9)
    h = np.where(np.isnan(h), ref, np.clip(h, lo, hi)) - ref
    scale = float((hi - lo) / 255)
    offset = float(lo - ref)
    b = np.clip(np.round((h - offset) / scale), 0, 255).astype(np.uint8)
    out = {'fonte': 'DTM 5 m della Regione Veneto (rv:DTM_RV_5m_3003, IODL 2.0)', 'x0': float(x0), 'z0': float(z0),
           'step': step, 'nx': nx, 'nz': nz, 'scale': round(scale, 5), 'offset': round(offset, 3), 'ref': round(ref, 2),
           'data': base64.b64encode(b.tobytes()).decode()}
    with open(dst, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'griglia {nx} x {nz} a {step} m da ({x0:.0f}, {z0:.0f}); quota di riferimento {ref:.2f} m; '
          f'da {lo - ref:+.1f} a {hi - ref:+.1f} m, passo {scale * 100:.1f} cm')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 10.0)
