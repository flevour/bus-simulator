#!/usr/bin/env python3
"""Quote del terreno per il gioco dal DTM a 5 m della Regione Veneto (rv:DTM_RV_5m_3003, IODL 2.0).

Uso:
    python3 scripts/dtm_grid.py <dtm.tif in EPSG:3003> data/dtm-padova.json [passo in m, 10] [data/lidar5]

Con la cartella data/lidar5 (tessere del DTM LiDAR a 5 m della Regione, file .asc.zip scaricati da
https://idt2.regione.veneto.it/idt/download/layerDownload/downloadDtmLidar5?dataDtmLidarId=<idPol>, elenco in
data/lidar5/tessere.txt da getDtmLidar5ByComune?codComune=28060) le quote vengono dal LiDAR dove c'è, e dal DTM
regionale fuori dal Comune. Le tessere sono nel "Fuso 12" della Regione: trasversa di Mercatore sul meridiano 12°,
fattore di scala 1, ellissoide internazionale, datum Roma40, falso est circa 3.000.000. Falso est (2.999.985) e falso
nord (-21 m) sono ricavati allineando il LiDAR al DTM regionale georeferenziato (EPSG:3003, che combacia con i fiumi
OSM) per correlazione dei rilievi (argini, alvei); con i soli angoli dell'indice delle tessere restava uno scarto di
circa 70 m.

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


FUSO12 = ('+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=2999985 +y_0=-21 +ellps=intl '
          '+towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68 +units=m +no_defs')


def lidar_mosaic(folder):
    """Mosaico delle tessere .asc.zip (celle da 5 m, centri): (matrice con nan, x0, y0 dell'angolo in basso a sinistra)."""
    import glob
    import io
    import zipfile
    tiles = []
    for f in sorted(glob.glob(os.path.join(folder, '*.asc.zip'))):
        z = zipfile.ZipFile(f)
        name = next(n for n in z.namelist() if n.endswith('.asc'))
        head, body = z.read(name).decode().split('\n', 6)[:6], z.read(name).decode().split('\n', 6)[6]
        h = {ln.split()[0].lower(): float(ln.split()[1]) for ln in head}
        a = np.loadtxt(io.StringIO(body), dtype=np.float32).reshape(int(h['nrows']), int(h['ncols']))
        tiles.append((h, np.where(a == h['nodata_value'], np.nan, a)))
    cs = tiles[0][0]['cellsize']
    x0 = min(h['xllcenter'] for h, _ in tiles) - cs / 2
    y0 = min(h['yllcenter'] for h, _ in tiles) - cs / 2
    W = int(round((max(h['xllcenter'] + h['ncols'] * cs for h, _ in tiles) - cs / 2 - x0) / cs))
    H = int(round((max(h['yllcenter'] + h['nrows'] * cs for h, _ in tiles) - cs / 2 - y0) / cs))
    M = np.full((H, W), np.nan, np.float32)
    for h, a in tiles:
        c0 = int(round((h['xllcenter'] - cs / 2 - x0) / cs))
        r0 = H - int(round((h['yllcenter'] - cs / 2 - y0) / cs)) - a.shape[0]
        M[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
    return M, x0, y0, cs


def main(src, dst, step=10.0, lidar=None):
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
        if L is not None:
            # LiDAR dove c'è (centri delle celle da 5 m)
            X12, Y12 = to12.transform(lon, lat)
            c2 = (X12 - Lx0) / Lcs - 0.5
            r2 = LH - 1 - ((Y12 - Ly0) / Lcs - 0.5)
            i2, j2 = np.clip(np.floor(c2).astype(int), 0, LW - 2), np.clip(np.floor(r2).astype(int), 0, LH - 2)
            gx, gy = np.clip(c2 - i2, 0, 1), np.clip(r2 - j2, 0, 1)
            w = (L[j2, i2] * (1 - gx) + L[j2, i2 + 1] * gx) * (1 - gy) + (L[j2 + 1, i2] * (1 - gx) + L[j2 + 1, i2 + 1] * gx) * gy
            inside = (c2 >= 0) & (c2 <= LW - 1) & (r2 >= 0) & (r2 <= LH - 1) & ~np.isnan(w)
            v = np.where(inside, w, v)
        return v
    L = None
    if lidar:
        L, Lx0, Ly0, Lcs = lidar_mosaic(lidar)
        LH, LW = L.shape
        to12 = Transformer.from_crs(4326, FUSO12, always_xy=True)
        print(f'LiDAR: {LW} x {LH} celle da {Lcs:.0f} m, {100 * np.isnan(L).mean():.0f}% senza dati')
    q = step / 4
    h = np.nanmean([sample(xs + dx, zs + dz) for dx in (-q, q) for dz in (-q, q)], axis=0)
    ref = float(np.nanmedian(h))
    lo, hi = np.nanpercentile(h, 0.2), np.nanpercentile(h, 99.9)
    h = np.where(np.isnan(h), ref, np.clip(h, lo, hi)) - ref
    scale = float((hi - lo) / 255)
    offset = float(lo - ref)
    b = np.clip(np.round((h - offset) / scale), 0, 255).astype(np.uint8)
    fonte = 'DTM LiDAR 5 m della Regione Veneto nel Comune di Padova, altrove DTM 5 m (rv:DTM_RV_5m_3003), IODL 2.0' if lidar else 'DTM 5 m della Regione Veneto (rv:DTM_RV_5m_3003, IODL 2.0)'
    out = {'fonte': fonte, 'x0': float(x0), 'z0': float(z0),
           'step': step, 'nx': nx, 'nz': nz, 'scale': round(scale, 5), 'offset': round(offset, 3), 'ref': round(ref, 2),
           'data': base64.b64encode(b.tobytes()).decode()}
    with open(dst, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'griglia {nx} x {nz} a {step} m da ({x0:.0f}, {z0:.0f}); quota di riferimento {ref:.2f} m; '
          f'da {lo - ref:+.1f} a {hi - ref:+.1f} m, passo {scale * 100:.1f} cm')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 10.0, sys.argv[4] if len(sys.argv) > 4 else None)
