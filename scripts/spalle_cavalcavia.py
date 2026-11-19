#!/usr/bin/env python3
"""Spalle dei cavalcavia nel LiDAR e franchi veri (#125, docs/cavalcavia.md sezione 6).

Il franco della regola (5,00 m sopra le strade, 6,90 m sopra la ferrovia, più 0,90 m di impalcato) è quello delle
strade nuove. Dove un cavalcavia vero ne ha meno, il profilo calcolato con la regola sale sopra il rilevato che il
rilievo vede, e il controllo trova la rampa metri sopra il DTM (Camerini, Grassi, Borgomagno). Lo script misura, per
ogni incrocio di una campata delle strutture attive con quello che passa sotto:

* la quota della mappa sull'impalcato (terreno "via" più `edgeH`) e quella da cui il risolutore misura il franco: la
  strada di sotto, o sopra la ferrovia il piano della campata (scripts/profilo_cavalcavia.py, piani_campate: il 35°
  percentile del terreno entro 30 m, qui del DTM di data/dtm-padova.json);
* le spalle: la quota più alta del DTM LiDAR a 5 m della Regione (`data/lidar5`, le tessere di scripts/dtm_grid.py)
  lungo la strada della struttura, da 3 a 25 m oltre la fine dei ponti OSM da una parte e dall'altra. Il rilievo toglie
  le campate e tiene il rilevato fino alla spalla, quindi lì la quota della strada è quella del rilievo;
* la quota dell'impalcato all'incrocio che danno le spalle (tra le due, o quella vicina se l'altra è oltre MAX_SPALLA),
  e il franco che ne viene: quella quota meno IMPALCATO meno quello che passa sotto (sopra la ferrovia, meno il terreno
  della mappa sotto l'incrocio, che dice dove sono i binari meglio del piano della campata: dove nel DTM sotto
  l'impalcato restano pezzi delle spalle il piano sta più su);
* `maxheight` di OSM sulla strada di sotto (data/osm-padova.json), se c'è: l'altezza massima del cartello.

I franchi veri si scrivono a mano nel registro (`franchi` in data/cavalcavia.json), con la fonte nel perché: sopra la
ferrovia la quota dell'impalcato che danno le spalle (`quota`), sotto un cartello il suo `maxheight` (`franco`). Questo
script dice i numeri. Servono numpy e pyproj (la trasformazione nel fuso 12 della Regione, come scripts/dtm_grid.py).

    python3 scripts/spalle_cavalcavia.py                 # tutti gli incroci delle strutture attive
    python3 scripts/spalle_cavalcavia.py --solo Camerini # le strutture con quel nome
    python3 scripts/spalle_cavalcavia.py --mappa M.json  # su un'altra mappa (una prova del risolutore)
    python3 scripts/spalle_cavalcavia.py --json F.json   # e le righe in un file
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_gtfs  # noqa: E402
import cavalcavia  # noqa: E402
from binari_tram import Griglia  # noqa: E402
from profilo_cavalcavia import IMPALCATO, FRANCO, Rete, impalcati  # noqa: E402

PIANO = (30.0, 0.35)  # come piani_campate: percentile del terreno entro questi metri

RADICE = cavalcavia.RADICE
SPALLA = (3.0, 25.0)  # m oltre la fine dei ponti: dove si cerca la spalla
MAX_SPALLA = 40.0      # m dall'incrocio alla fine dei ponti: oltre, la spalla è di un viadotto e non dice la quota lì
PASSO = 1.0


class Lidar:
    """Il DTM LiDAR a 5 m delle tessere di data/lidar5, nelle coordinate del gioco, relativo alla quota di riferimento
    della griglia del gioco (data/dtm-padova.json, `ref`)."""

    def __init__(self, cartella=os.path.join(RADICE, 'data/lidar5')):
        import dtm_grid
        from pyproj import Transformer
        self.M, self.x0, self.y0, self.cs = dtm_grid.lidar_mosaic(cartella)
        self.H, self.W = self.M.shape
        self.tr = Transformer.from_crs(4326, dtm_grid.FUSO12, always_xy=True)
        self.ref = json.load(open(os.path.join(RADICE, 'data/dtm-padova.json')))['ref']

    def at(self, x, z):
        lon = build_gtfs.ORIGIN_LON + x / build_gtfs.M_LON
        lat = build_gtfs.ORIGIN_LAT - z / build_gtfs.M_LAT
        X, Y = self.tr.transform(lon, lat)
        c = (X - self.x0) / self.cs - 0.5
        r = self.H - 1 - ((Y - self.y0) / self.cs - 0.5)
        i, j = int(math.floor(c)), int(math.floor(r))
        if not (0 <= i < self.W - 1 and 0 <= j < self.H - 1):
            return None
        u, v = c - i, r - j
        M = self.M
        q = (M[j, i] * (1 - u) + M[j, i + 1] * u) * (1 - v) + (M[j + 1, i] * (1 - u) + M[j + 1, i + 1] * u) * v
        return None if q != q else float(q) - self.ref


def maxheight():
    """Griglia dei tratti delle vie OSM con maxheight numerico: (griglia, [(id, nome, maxheight)])."""
    d = json.load(open(os.path.join(RADICE, 'data/osm-padova.json'), encoding='utf-8'))
    segs, info = [], []
    for e in d['elements']:
        t = e.get('tags', {})
        if e.get('type') != 'way' or 'maxheight' not in t:
            continue
        try:
            mh = float(t['maxheight'])
        except ValueError:
            continue
        pts = [build_gtfs.xz(g['lat'], g['lon']) for g in e['geometry']]
        for a, b in zip(pts, pts[1:]):
            segs.append((a, b))
            info.append((e['id'], t.get('name', ''), mh))
    return Griglia(segs or [((1e9, 1e9), (1e9, 1e9))], 50.0), info


def main():
    solo = sys.argv[sys.argv.index('--solo') + 1] if '--solo' in sys.argv else None
    mappa = sys.argv[sys.argv.index('--mappa') + 1] if '--mappa' in sys.argv else os.path.join(RADICE, 'src/data/padova-map.json')
    M = json.load(open(mappa, encoding='utf-8'))
    D = cavalcavia.rete_dati(M)  # quote della mappa: terreno "via" più edgeH
    dtm = cavalcavia.dtm()
    base = cavalcavia.Griglia10(M['terrain'])  # terreno di base della mappa: sotto le campate, dove i binari stanno

    def piano(p):
        """Il piano di una campata nel punto p, come piani_campate (sul DTM: il terreno di base prima delle strutture)."""
        r = PIANO[0]
        i0, i1 = math.ceil((p[0] - r - dtm.x0) / dtm.step), math.floor((p[0] + r - dtm.x0) / dtm.step)
        j0, j1 = math.ceil((p[1] - r - dtm.z0) / dtm.step), math.floor((p[1] + r - dtm.z0) / dtm.step)
        v = sorted(dtm.cella(i, j) * dtm.scale + dtm.offset for j in range(j0, j1 + 1) for i in range(i0, i1 + 1)
                   if math.dist((dtm.x0 + i * dtm.step, dtm.z0 + j * dtm.step), p) <= r)
        return v[int(len(v) * PIANO[1])] if v else None
    R = Rete(D.nodi, D.archi, M['names'], M['rails'], [])
    _deck, incroci = impalcati(R)
    di = {k: s['id'] for s in M['cavalcavia'] for k in s['archi']}
    L = Lidar()
    G_mh, info_mh = maxheight()
    ponte = lambda k: bool(R.archi[k][5] & 4) and R.archi[k][7] >= 1

    def quota(k, s):
        e = R.archi[k]
        A, B = R.nodi[e[0]], R.nodi[e[1]]
        t = max(0.0, min(1.0, s / (R.lung[k] or 1)))
        return D.via.at(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t) + D.rel(k, t)

    def spalla(k, s, v):
        """(metri dall'incrocio alla fine dei ponti, quota più alta del LiDAR nei metri SPALLA dopo, punto) o None."""
        d, visti, fine, best = 0.0, {k}, None, None
        while True:
            Lk = R.lung[k]
            e = R.archi[k]
            A, B = R.nodi[e[0]], R.nodi[e[1]]
            while 0 <= s <= Lk:
                if fine is None and not ponte(k):
                    fine = d
                if fine is not None:
                    if d - fine > SPALLA[1]:
                        return (fine, *best) if best else None
                    if d - fine >= SPALLA[0]:
                        t = s / (Lk or 1)
                        x, z = A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t
                        q = L.at(x, z)
                        if q is not None and (best is None or q > best[0]):
                            best = (q, x, z)
                s += v * PASSO
                d += PASSO
            nd = e[1] if v > 0 else e[0]
            dopo = [m for m in R.seguiti(k, nd) if di.get(m) == di.get(k) and m not in visti]
            if not dopo:
                return (fine, *best) if best and fine is not None else None
            oltre = s - Lk if v > 0 else -s
            k = dopo[0]
            visti.add(k)
            v, s = (1, oltre) if R.archi[k][0] == nd else (-1, R.lung[k] - oltre)

    print('struttura | sotto | incrocio | impalcato nella mappa | quota di sotto | spalle nel LiDAR (metri dalla fine dei '
          'ponti, quota) | impalcato dalle spalle | franco: regola, dalle spalle, maxheight di OSM')
    visti, righe = set(), []
    for k, t, tipo, j, p in sorted(incroci, key=lambda c: (di.get(c[0], ''), c[4])):
        sid = di.get(k)
        if sid is None or (solo and solo not in sid):
            continue
        ch = (sid, tipo, j, round(p[0]), round(p[1]))
        if ch in visti:
            continue
        visti.add(ch)
        s = t * R.lung[k]
        sopra = quota(k, s)
        if j is not None:
            c = _incrocio(R, k, j)
            sotto = quota(j, c * R.lung[j]) if c is not None else None
        else:
            sotto = base.at(*p)
        a, b = spalla(k, s, -1), spalla(k, s, 1)
        vicine = [x for x in (a, b) if x and x[0] <= MAX_SPALLA]
        if len(vicine) == 2:
            q_sp = a[1] + (b[1] - a[1]) * a[0] / ((a[0] + b[0]) or 1)
        elif vicine:
            q_sp = vicine[0][1]
        else:
            q_sp = None
        mh = G_mh.vicino(p, 12) if j is not None else None
        fs = q_sp - IMPALCATO - sotto if q_sp is not None and sotto is not None else None
        nome = (R.nome(j) or 'strada senza nome') if j is not None else 'ferrovia'
        sp = lambda x: f'{x[0]:4.0f} m {x[1]:6.2f} ({x[2]:.0f}, {x[3]:.0f})' if x else '        -       '
        righe.append({'struttura': sid, 'sotto': tipo, 'via': nome, 'x': round(p[0], 1), 'z': round(p[1], 1), 'impalcato': round(sopra, 2),
                      'piano': None if j is not None else round(piano(p), 2),
                      'quota_sotto': None if sotto is None else round(sotto, 2), 'spalle': [None if x is None else [round(v, 2) for v in x] for x in (a, b)],
                      'dalle_spalle': None if q_sp is None else round(q_sp, 2), 'franco_regola': FRANCO[tipo],
                      'franco_spalle': None if fs is None else round(fs, 2),
                      'maxheight': [info_mh[mh[1]][2], info_mh[mh[1]][0]] if mh else None})
        print(f"{sid[:30]:30s} {nome[:24]:24s} ({p[0]:6.0f}, {p[1]:6.0f})  impalcato {sopra:6.2f}  sotto "
              f"{('%6.2f' % sotto) if sotto is not None else '   -  '}  spalle {sp(a)} | {sp(b)}  "
              f"dalle spalle {('%6.2f' % q_sp) if q_sp is not None else '   -  '}  franco {FRANCO[tipo]:.2f}"
              f" {('%5.2f' % fs) if fs is not None else '  -  '}"
              + (f"  maxheight {info_mh[mh[1]][2]:.2f} (way {info_mh[mh[1]][0]})" if mh else ''))
    if '--json' in sys.argv:
        json.dump(righe, open(sys.argv[sys.argv.index('--json') + 1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def _incrocio(R, k, j):
    A, B = R.nodi[R.archi[k][0]], R.nodi[R.archi[k][1]]
    C, E = R.nodi[R.archi[j][0]], R.nodi[R.archi[j][1]]
    rx, rz, sx, sz = B[0] - A[0], B[1] - A[1], E[0] - C[0], E[1] - C[1]
    den = rx * sz - rz * sx
    if abs(den) < 1e-9:
        return None
    return ((C[0] - A[0]) * rz - (C[1] - A[1]) * rx) / den


if __name__ == '__main__':
    main()
