#!/usr/bin/env python3
"""Larghezze misurate di carreggiate e marciapiedi lungo le strade OSM.

Uso:
    python3 scripts/measure_streets.py ctrn <cartella con i fogli CTRN *.gpkg> data/osm-padova.json data/misure-strade.json
    python3 scripts/measure_streets.py dbgt <cartella del DBGT> data/osm-padova.json data/misure-strade.json

Dai bordi misurati (CTRN 1:5000 o DBGT della Regione Veneto, licenza IODL 2.0) si tirano raggi perpendicolari all'asse
OSM ogni 4 m: il primo bordo della carreggiata da ogni lato dà la larghezza, il bordo successivo (cordolo, recinzione,
facciata) la larghezza del marciapiede. Per ogni tratto di 40 m di una via si tiene la mediana, solo se i campioni sono
abbastanza e concordi. Vicino agli incroci (12 m) non si misura.

Uscita: {"fonte": ..., "vie": {id della via OSM: [[s0, s1, carreggiata, marciapiede sinistro, marciapiede destro], ...]}}
con s lungo la via nel suo verso, sinistra e destra rispetto al verso della via, 0 dove la misura manca.
"""
import json
import math
import os
import sqlite3
import statistics
import sys
from collections import defaultdict

import numpy as np
import shapely
from shapely import STRtree, wkb
from shapely.geometry import LineString

sys.path.insert(0, os.path.dirname(__file__))
import build_gtfs  # noqa: E402

DRIVE = {'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
         'unclassified', 'residential', 'living_street', 'service'}
STEP = 4.0  # m tra un campione e l'altro
PIECE = 40.0  # m: tratti con una misura ciascuno
NEAR_JCT = 12.0  # m: niente campioni così vicino a un incrocio
RAY = 22.0  # m: lunghezza dei raggi
MIN_SAMPLES = 4
# CTRN: bordi della carreggiata (strada principale, secondaria, carreggiabile), cordoli e aiuole, edifici
CTRN_EDGE = ('0205', '0206', '0208')
CTRN_KERB = ('0212',)
CTRN_BLDG = ('0101', '0102', '0105', '0106', '0107', '0127')


def gpkg_geoms(path, table, codes):
    c = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    c.text_factory = bytes
    out = []
    q = f'select geom, LIVCOD from "{table}" where LIVCOD in ({",".join("?" * len(codes))})'
    for b, code in c.execute(q, codes):
        if not b:
            continue
        env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(b[3] >> 1) & 7]
        out.append(wkb.loads(bytes(b[8 + env:])))
    return out


def to_game(geoms, shift):
    """UTM 32N ETRF2000 -> coordinate del gioco (x est, z sud), con lo scarto della fonte."""
    from pyproj import Transformer
    t = Transformer.from_crs(7791, 4326, always_xy=True)

    def f(coords):
        lon, lat = t.transform(coords[:, 0] + shift[0], coords[:, 1] + shift[1])
        x = (lon - build_gtfs.ORIGIN_LON) * build_gtfs.M_LON
        z = -(lat - build_gtfs.ORIGIN_LAT) * build_gtfs.M_LAT
        return np.column_stack([x, z])
    return list(shapely.transform(np.array(geoms, dtype=object), f)) if geoms else []


def load_ctrn(folder, shift):
    lines, kinds = [], []
    for fn in sorted(os.listdir(folder)):
        if not fn.endswith('.gpkg'):
            continue
        p = os.path.join(folder, fn)
        for codes, kind, table in ((CTRN_EDGE, 'edge', 'viabilit'), (CTRN_KERB, 'kerb', 'viabilit'), (CTRN_BLDG, 'bldg', 'fabbric')):
            gs = gpkg_geoms(p, table, codes)
            if kind == 'bldg':
                gs = [g.boundary for g in gs]
            gs = to_game(gs, shift)
            lines += gs
            kinds += [kind] * len(gs)
    return lines, kinds


def measure(lines, kinds, osm_path, area=None, walk=None):
    d = json.load(open(osm_path, encoding='utf-8'))
    ways = [w for w in d['elements'] if w['type'] == 'way' and w.get('tags', {}).get('highway') in DRIVE
            and w['tags'].get('bridge') in (None, 'no') and w['tags'].get('tunnel') in (None, 'no') and len(w.get('geometry', [])) >= 2]
    # gli assi delle altre vie: due vie affiancate sulla stessa lastra d'asfalto (complanari, rampe) si dividono la
    # larghezza a metà invece di prenderla tutta ciascuna
    lines = list(lines) + [LineString([build_gtfs.xz(g['lat'], g['lon']) for g in w['geometry']]) for w in ways]
    kinds = np.array(list(kinds) + ['osm'] * len(ways))
    L_arr = np.array(lines, dtype=object)
    tree = STRtree(L_arr)
    use = defaultdict(int)
    for w in ways:
        for i, n in enumerate(w['nodes']):
            use[n] += 2 if i in (0, len(w['nodes']) - 1) else 1
    samples = []  # (via, s, x, z, ux, uz)
    for w in ways:
        pts = np.array([build_gtfs.xz(g['lat'], g['lon']) for g in w['geometry']])
        seg = np.hypot(*np.diff(pts, axis=0).T)
        cum = np.concatenate([[0], np.cumsum(seg)])
        L = cum[-1]
        jct = [cum[i] for i, n in enumerate(w['nodes']) if use[n] > 1]
        for s in np.arange(STEP / 2, L, STEP):
            if any(abs(s - j) < NEAR_JCT for j in jct):
                continue
            k = min(np.searchsorted(cum, s, side='right') - 1, len(seg) - 1)
            if seg[k] < 0.5:
                continue
            u = (pts[k + 1] - pts[k]) / seg[k]
            p = pts[k] + u * (s - cum[k])
            samples.append((w['id'], s, p[0], p[1], u[0], u[1]))
    S = np.array([x[1:] for x in samples])
    if area is not None:
        # solo i campioni con l'asse OSM dentro la carreggiata misurata: altrimenti la via è cambiata o è altrove
        shapely.prepare(area)
        inside = shapely.contains_xy(area, S[:, 1], S[:, 2])
        print(f'campioni con l\'asse dentro la carreggiata misurata: {inside.sum()} su {len(S)}', flush=True)
        S = S[inside]
        samples = [x for x, k in zip(samples, inside) if k]
    n = len(S)
    print(f'vie {len(ways)}, campioni {n}', flush=True)
    res = {}
    for side, sgn in (('L', 1), ('R', -1)):
        # sinistra della via (nel verso dei nodi) con x est e z sud: (uz, -ux); colonne di S: s, x, z, ux, uz
        nx, nz = S[:, 4] * sgn, -S[:, 3] * sgn
        origins = shapely.points(S[:, 1], S[:, 2])
        rays = shapely.linestrings(np.stack([np.column_stack([S[:, 1], S[:, 2]]), np.column_stack([S[:, 1] + nx * RAY, S[:, 2] + nz * RAY])], axis=1))
        parts = []
        for c0 in range(0, n, 20000):  # a blocchi: tutti insieme non stanno in memoria
            ri, li = tree.query(rays[c0:c0 + 20000], predicate='intersects')
            ri = ri + c0
            # ogni punto d'incontro conta: un anello (il bordo di un marciapiede) taglia il raggio due volte
            hit, k = shapely.get_parts(shapely.intersection(rays[ri], L_arr[li]), return_index=True)
            ri, li = ri[k], li[k]
            parts.append((ri, li, shapely.distance(origins[ri], hit)))
        ri = np.concatenate([p[0] for p in parts])
        li = np.concatenate([p[1] for p in parts])
        dist = np.concatenate([p[2] for p in parts])
        order = np.lexsort((dist, ri))
        ri, li, dist = ri[order], li[order], dist[order]
        # primo contatto oltre 0,4 m: se è un bordo dà il lato della carreggiata (se è una facciata, niente misura);
        # il contatto successivo, oltre 0,6 m, chiude il marciapiede
        first_edge = np.full(n, np.nan)
        side_w = np.full(n, np.nan)
        ok = dist >= 0.4
        ri, li, dist = ri[ok], li[ok], dist[ok]
        rays_u, first = np.unique(ri, return_index=True)
        fk = kinds[li[first]]
        is_edge = np.isin(fk, ('edge', 'kerb'))
        first_edge[rays_u[is_edge]] = dist[first[is_edge]]
        # un'altra via prima del bordo: metà della distanza (niente marciapiede da quel lato)
        is_osm = fk == 'osm'
        shared = np.full(n, False)
        shared[rays_u[is_osm]] = True
        first_edge[rays_u[is_osm]] = dist[first[is_osm]] / 2
        # il marciapiede finisce al suo bordo misurato o alla facciata (non a un'altra strada)
        beyond = (dist > np.nan_to_num(first_edge[ri], nan=1e9) + 0.6) & ~shared[ri] & np.isin(kinds[li], ('kerb', 'bldg', 'edge'))
        r2, i2 = np.unique(ri[beyond], return_index=True)
        w2 = dist[beyond][i2] - first_edge[r2]
        good = (w2 >= 0.8) & (w2 <= 8)
        if walk is not None:
            # il marciapiede c'è solo se subito oltre il bordo si è dentro un marciapiede misurato
            k = r2
            px = S[k, 1] + nx[k] * (first_edge[k] + 0.5)
            pz = S[k, 2] + nz[k] * (first_edge[k] + 0.5)
            good &= shapely.contains_xy(walk, px, pz)
        side_w[r2[good]] = w2[good]
        res[side] = (first_edge, side_w)
    width = res['L'][0] + res['R'][0]
    out = defaultdict(list)
    by_way = defaultdict(list)
    for i, (wid, s, *_r) in enumerate(samples):
        by_way[wid].append((s, width[i], res['L'][1][i], res['R'][1][i]))
    kept = 0
    for wid, arr in by_way.items():
        pieces = defaultdict(list)
        for s, wv, sl, sr in arr:
            pieces[int(s // PIECE)].append((wv, sl, sr))
        for k, vals in sorted(pieces.items()):
            ws = [v[0] for v in vals if not math.isnan(v[0]) and 3 <= v[0] <= 30]
            wmed = 0.0
            if len(ws) >= MIN_SAMPLES:
                m = statistics.median(ws)
                mad = statistics.median([abs(v - m) for v in ws])
                if mad <= 1.0 and sum(abs(v - m) <= 1.5 for v in ws) >= 0.6 * len(vals):
                    wmed = round(m, 1)
            sw = []
            for idx in (1, 2):
                xs = [v[idx] for v in vals if not math.isnan(v[idx])]
                sw.append(round(statistics.median(xs), 1) if len(xs) >= 3 and statistics.pstdev(xs) <= 1.2 else 0.0)
            if wmed or any(sw):
                out[str(wid)].append([round(k * PIECE, 1), round((k + 1) * PIECE, 1), wmed, *sw])
                kept += wmed > 0
    print(f'tratti con la carreggiata misurata {kept}, vie con misure {len(out)}', flush=True)
    return out


def shp(folder, name, columns=()):
    """Geometrie (e campi) di uno shapefile del DBGT, in coordinate del gioco."""
    import pyogrio
    path = os.path.join(folder, name + '.shp')
    _meta, _fids, geom, fields = pyogrio.raw.read(path, columns=list(columns), encoding='latin1')
    return shapely.from_wkb(geom), fields


def dbgt_to_game(geoms, shift):
    """RDN2008 geografiche (lon, lat) -> coordinate del gioco, con lo scarto della fonte (m, est e nord)."""
    def f(c):
        x = (c[:, 0] - build_gtfs.ORIGIN_LON) * build_gtfs.M_LON + shift[0]
        z = -(c[:, 1] - build_gtfs.ORIGIN_LAT) * build_gtfs.M_LAT - shift[1]
        return np.column_stack([x, z])
    return shapely.transform(shapely.force_2d(geoms), f)


# scarto medio DBGT -> edifici Overture/OSM (m, est e nord), misurato sugli edifici corrispondenti
DBGT_SHIFT = (-1.31, 1.93)


def load_dbgt(folder):
    """Carreggiate (AC_VEI), marciapiedi (AR_MARC), spartitraffico (SPART) ed edifici (EDIFC) del DBGT."""
    vei = dbgt_to_game(shp(folder, 'AC_VEI')[0], DBGT_SHIFT)
    carr = shapely.union_all(shapely.make_valid(vei[~shapely.is_missing(vei)]))
    marc = dbgt_to_game(shp(folder, 'AR_MARC')[0], DBGT_SHIFT)
    marc = shapely.union_all(shapely.make_valid(marc[~shapely.is_missing(marc)]))
    ed = dbgt_to_game(shp(folder, 'EDIFC')[0], DBGT_SHIFT)
    lines, kinds = [], []
    for g, kind in ((carr, 'edge'), (marc, 'kerb')):
        # bordi poligono per poligono: l'unione può essere una collezione mista, che non ha un bordo
        polys = [q for q in shapely.get_parts(g) if q.geom_type == 'Polygon']
        parts = [r for q in polys for r in shapely.get_parts(shapely.boundary(q))]
        lines += parts
        kinds += [kind] * len(parts)
    eb = [b for b in shapely.boundary(ed[~shapely.is_missing(ed)]) if b is not None]
    lines += eb
    kinds += ['bldg'] * len(eb)
    return lines, kinds, carr, marc


def main():
    kind, src, osm, dst = sys.argv[1:5]
    if kind == 'ctrn':
        # scarto medio CTRN -> OSM misurato sugli edifici (m, est e nord)
        shift = (-1.15, 2.08)
        lines, kinds = load_ctrn(src, shift)
        fonte = 'CTRN 1:5000 della Regione Veneto (rilievo 1997, IODL 2.0)'
        area = walk = None
    elif kind == 'dbgt':
        lines, kinds, area, walk = load_dbgt(src)
        shapely.prepare(walk)
        fonte = 'DBGT della Regione Veneto, lotto Comune di Padova (volo 2007, IODL 2.0)'
    else:
        raise SystemExit('fonte non gestita: ' + kind)
    print(f'linee {len(lines)}', flush=True)
    out = measure(lines, kinds, osm, area, walk)
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump({'fonte': fonte, 'vie': out}, f, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
