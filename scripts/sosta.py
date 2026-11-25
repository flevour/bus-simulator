#!/usr/bin/env python3
"""Sosta lungo le strade (#111, docs/sosta.md): gli stalli per arco e per lato, calcolati nella build.

La mappa porta `stalli`, una voce per fila di stalli:

    [arco, lato, tipo, fonte, d0, d1, s0, quanti]

* lato: 0 a sinistra, 1 a destra di chi va dal nodo `a` al nodo `b` dell'arco;
* tipo: 1 in linea, 2 a spina (45 gradi), 3 a pettine; passo lungo il cordolo e profondità in `STALLO`;
* fonte: 1 tag OSM della via (`sosta` nella mappa), 2 area OSM (`parking=street_side`), 3 DBGT (`SV_STR`),
  4 larghezza misurata della carreggiata meno le corsie;
* d0, d1: distanza dall'asse dell'arco del bordo verso le corsie e del bordo verso il cordolo, in cm;
* s0: progressiva dal nodo `a` dell'inizio del primo stallo, in cm; gli stalli sono `quanti`, uno ogni passo.

Dove gli stalli stringono la carreggiata la mappa porta anche `sedeCorsie`, [arco, sinistra, destra]: le corsie stanno
tra `sinistra` e `destra` centimetri dall'asse, uguali lungo tutta la catena dell'arco (gli archi di fila tra due
incroci). `stalliTipi` dà passo e profondità di ogni tipo, in cm.

Il gioco legge e non cerca niente: le corsie tra i bordi di `sedeCorsie` (laneLayout in src/data/padova.js), le righe
e le auto ferme negli stalli.

Come si calcola. Le fonti valgono in ordine: quello che una fonte ha già deciso per un tratto di un lato (anche
"sosta vietata" nei tag OSM) la fonte dopo non lo tocca. Ogni stallo sta contro il cordolo vero, cioè il bordo
dell'asfalto della pianta delle strade (`surfaces` nella mappa) misurato davanti allo stallo, e resta solo se:

* sta tutto sull'asfalto, a non più di FUORI metri oltre la carreggiata dell'arco (oltre è un piazzale);
* è fuori dalle zone libere del suo lato: incroci, strisce pedonali, fermate dei bus (ingresso, bus, uscita), passi
  carrai e ingressi dei parcheggi di OSM;
* non tocca le corsie di un altro arco, un incrocio, la sede del tram, uno stallo di un altro arco;
* con gli stalli le corsie dell'arco ci stanno ancora (`bisogno`).

    python3 scripts/sosta.py                 # rapporto: file e stalli per fonte e per tipo, controlli
    python3 scripts/sosta.py --elenco        # anche i casi dei controlli, con le coordinate del gioco
    python3 scripts/sosta.py --scrivi        # riscrive `stalli` nella mappa che c'è (per provare: la mappa pubblicata
                                             # è quella di scripts/rigenera_mappa.sh, che li calcola nella build)
    python3 scripts/sosta.py --aggiorna      # riscrive data/eccezioni/sosta.json dai casi di oggi

Serve shapely e numpy (come scripts/street_surfaces.py). Dati © OpenStreetMap contributors (ODbL), Regione del Veneto
(DBGT, IODL 2.0).
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RADICE, 'scripts'))
import build_gtfs  # noqa: E402
import osm_rete  # noqa: E402
import raccordi  # noqa: E402  (corsie_arco: le corsie come le mette il gioco)

LINEA, SPINA, PETTINE = 1, 2, 3
TAG, AREA, DBGT, LARGHEZZA = 1, 2, 3, 4
NOME_TIPO = {LINEA: 'in linea', SPINA: 'a spina', PETTINE: 'a pettine'}
NOME_FONTE = {TAG: 'tag OSM della via', AREA: 'area OSM', DBGT: 'DBGT', LARGHEZZA: 'larghezza'}
# passo lungo il cordolo e profondità di uno stallo, in metri (DM 5/11/2001 §3.4.7, docs/PIANO_MODELLO_CITTA.md §3.1:
# in linea 2,00 x 5,00; a pettine 2,30-2,50 x 5,00; a spina a 45 gradi 2,30 / sin 45 = 3,25 di passo, 4,80 di profondità)
STALLO = {LINEA: (5.0, 2.0), SPINA: (3.3, 4.8), PETTINE: (2.5, 5.0)}
PASSO_T = 0.25      # m tra i punti con cui si misura il bordo dell'asfalto di traverso
T_MAX = 16.0        # m dall'asse: oltre non si cerca il cordolo
FUORI = 6.5         # m oltre la carreggiata dell'arco: un bordo più lontano è un piazzale, non una fila lungo la via
SALTO = 0.5         # m: stalli di fila con il cordolo entro questo scarto stanno nella stessa fila
INCROCIO = 5.0      # m liberi prima dell'incrocio (CdS art. 158), oltre la carreggiata della via che incrocia
INCROCIO_BUS = 12.0  # m liberi sugli archi dove passa una linea: la coda del bus in svolta
CURVA_BUS = 10.0    # m liberi ai due lati di un gomito dove passa una linea: la corsia dei bus lo smussa
CAMBIO_BUS = 8.0    # m liberi, dove passa una linea, ai capi di una catena senza incrocio: lì cambiano carreggiata o
                    # corsie, e la corsia dei bus passa da uno scostamento all'altro in qualche metro
CURVA = 2.5         # m liberi ai due lati di un gomito senza incrocio
STRISCE = 3.5       # m liberi prima e dopo l'asse delle strisce pedonali
# m liberi prima del bus fermo e dopo la palina. L'art. 151 del Regolamento CdS ne chiede 12 e 12; qui sono quelli che
# servono ai bus del gioco, che accostano tutti interi: quelli automatici cominciano 30 m prima con il muso (buses.js)
# e rientrano in 18 m, il pilota delle prove 40 m prima; più 12 m per parte, perché la palina posata dal gioco non sta
# sempre dove la fermata dei dati si proietta sul percorso. Con un inseguitore di percorso che sposta un asse alla volta
# (#113) possono tornare 12 e 12
FERMATA_INGRESSO, FERMATA_USCITA = 42.0, 32.0
BUS, SNODATO = 12.0, 18.0  # m: il bus fermo, dalla palina all'indietro
CAPOLINEA, CAPOLINEA_LATO = 60.0, 10.0  # m liberi lungo la via e di traverso attorno alla prima e all'ultima fermata
FERMATA_REACH = 25.0  # m: una fermata più lontana dal percorso della sua linea non libera niente
PASSO_CARRAIO = {'driveway': 2.5, 'parking_aisle': 3.5}  # m liberi ai due lati dell'asse, per tipo di strada di servizio
PASSO_ALTRO = 3.0   # m: le altre strade di servizio fuori dalla rete e gli ingressi dei parcheggi (parking_entrance)
INGRESSO_REACH = 10.0  # m: un parking_entrance più lontano da ogni arco non libera niente
TRAM = 2.6          # m dal binario: metà della corsia con il cordolo (TRAM_LANE di street_surfaces) più mezzo metro
CORSIA_MAX = raccordi.LANE_MAX  # m: la corsia più larga che il gioco disegna (src/data/padova.js)
# sosta dedotta dalla larghezza: solo sulle vie di queste classi con la carreggiata misurata (flag 512 dell'arco)
CLASSI_LARGHEZZA = (2, 3, 4, 5, 6)  # secondary, tertiary, unclassified, residential, living_street
LARGHEZZA_MIN = 2.0  # m liberi oltre le corsie perché ci sia una fila in linea
# la sosta dedotta dalla larghezza vale solo in città: dentro un'area di OSM con questi usi del suolo (allargata di
# URBANO_REACH metri) e con un edificio entro EDIFICIO_REACH metri dal lato dello stallo. In campagna il DBGT conta
# nella carreggiata banchine e slarghi dove nessuno parcheggia (campione sulla foto aerea, docs/sosta.md)
URBANO = ('residential', 'commercial', 'retail', 'industrial', 'education', 'religious', 'construction', 'military')
URBANO_REACH = 15.0
EDIFICIO_REACH = 30.0
FILA_MIN = 3         # stalli di fila, per la sola fonte larghezza: meno è un allargamento, non una fila
AREA_QUOTA = {PETTINE: 0.6, SPINA: 0.6, LINEA: 0.5}  # parte dello stallo che deve stare nell'area di OSM o del DBGT
AREA_REACH = 2.5    # m: un'area più lontana dalla carreggiata dell'arco non è lungo quella via
ECCEZIONI = 'sosta'
# come in scripts/build_map.py, che controlla che siano uguali: linee con lo snodato, strade di servizio fuori dalla rete
SNODATI = ('10',)
SERVIZIO_FUORI = {'parking_aisle', 'driveway', 'drive-through', 'emergency_access'}
TOLL = 3.0          # m: un caso dei controlli resta lo stesso se si sposta fin qui


def corsie(larghezza, codice, flags, sede=None):
    """Corsie che il gioco disegna sull'arco: (avanti, indietro, dei bus avanti, dei bus indietro), e le loro distanze
    dall'asse. Il conto è corsie_arco di scripts/raccordi.py, cioè laneLayout di src/data/padova.js."""
    ls = raccordi.corsie_arco(larghezza, 1 if flags & 1 else -1 if flags & 2 else 0, codice, sede)
    return (sum(1 for d, _b, _o in ls if d > 0), sum(1 for d, _b, _o in ls if d < 0),
            sum(1 for d, b, _o in ls if d > 0 and b), sum(1 for d, b, _o in ls if d < 0 and b)), ls


class Asfalto:
    """L'asfalto della pianta delle strade, per riquadro: dice se un punto ci sta sopra."""

    def __init__(self, surfaces):
        self.T = surfaces['tile']
        self.celle = {}
        for c in surfaces['cells']:
            polys = []
            for r in c[2] + [r for i in (6, 7) if len(c) > i for r in c[i]]:  # asfalto, sede del tram e rampe a raso (#126)
                est = [(r[0][i], r[0][i + 1]) for i in range(0, len(r[0]) - 1, 2)]
                if len(est) < 3:
                    continue
                p = Polygon(est, [[(h[i], h[i + 1]) for i in range(0, len(h) - 1, 2)] for h in r[1:] if len(h) >= 6])
                polys.append(p if p.is_valid else p.buffer(0))
            if polys:
                g = unary_union(polys)
                shapely.prepare(g)
                self.celle[(c[0], c[1])] = g

    def dentro(self, xs, zs):
        xs, zs = np.asarray(xs, dtype=float), np.asarray(zs, dtype=float)
        out = np.zeros(xs.shape, dtype=bool)
        fx, fz = xs.ravel(), zs.ravel()
        fo = out.ravel()
        ix, iz = np.floor(fx / self.T).astype(np.int64), np.floor(fz / self.T).astype(np.int64)
        chiave = ix * 1000003 + iz
        ordine = np.argsort(chiave, kind='stable')
        ck = chiave[ordine]
        tagli = np.flatnonzero(np.diff(ck)) + 1
        for seg in np.split(ordine, tagli):
            g = self.celle.get((int(ix[seg[0]]), int(iz[seg[0]])))
            if g is not None:
                fo[seg] = shapely.contains_xy(g, fx[seg], fz[seg])
        return out


class Strade:
    """La rete della mappa come serve alla sosta: archi con verso, corsie, linee dei bus, zone libere per lato."""

    def __init__(self, M, vie=None, luoghi=None):
        self.M = M
        n = M['nodes']
        self.nodi = [(n[i], n[i + 1]) for i in range(0, len(n), 2)]
        E = M['edges']
        self.archi = [E[k:k + 8] for k in range(0, len(E), 8)]
        self.N = len(self.archi)
        self.A = np.array([self.nodi[e[0]] for e in self.archi], dtype=float)
        self.B = np.array([self.nodi[e[1]] for e in self.archi], dtype=float)
        d = self.B - self.A
        self.L = np.hypot(d[:, 0], d[:, 1])
        with np.errstate(invalid='ignore', divide='ignore'):
            self.U = np.where(self.L[:, None] > 0, d / self.L[:, None], 0.0)
        # normale a destra di chi va da a verso b (come laneGeom nel gioco: rx = -dz, rz = dx)
        self.Nr = np.stack([-self.U[:, 1], self.U[:, 0]], axis=1)
        self.W = np.array([e[3] for e in self.archi], dtype=float)
        self.codice = dict(zip(M['lanes'][0::2], M['lanes'][1::2]))
        self.in_quota = {v[0] for v in M.get('edgeH', [])}
        self.coppia = {}
        for k, e in enumerate(self.archi):
            self.coppia.setdefault((e[0], e[1]), k)
        # archi dove passa una linea (anche lo snodato), dai nodi delle varianti
        self.bus, self.snodato = set(), set()
        for Ln in M['lines']:
            for v in Ln['variants']:
                for a, b in zip(v['nodes'], v['nodes'][1:]):
                    k = self.arco(a, b)
                    if k is not None:
                        self.bus.add(k)
                        if Ln['id'] in SNODATI:
                            self.snodato.add(k)
        # archi carrabili per nodo
        self.at = defaultdict(list)
        for k, e in enumerate(self.archi):
            if e[2] != 8 and self.L[k] > 0.05:
                self.at[e[0]].append(k)
                self.at[e[1]].append(k)
        self.semafori = {n for v in M.get('signals', []) for n in v[1:]}
        self.corsie = [corsie(e[3], self.codice.get(k), e[5])[0] for k, e in enumerate(self.archi)]
        self.tree = STRtree([LineString([self.A[k], self.B[k]]) for k in range(self.N)])
        self.libero = defaultdict(list)  # (arco, lato) -> [(s0, s1, perché)]: tratti senza stalli
        self._catene()
        self._incroci()
        self._strisce()
        self._fermate()
        self._passi(vie or [], luoghi or [])

    def arco(self, a, b):
        k = self.coppia.get((a, b))
        return k if k is not None else self.coppia.get((b, a))

    def punto(self, k, s, d):
        """Punto dell'arco k alla progressiva s, a d metri dall'asse verso destra."""
        return (self.A[k][0] + self.U[k][0] * s + self.Nr[k][0] * d, self.A[k][1] + self.U[k][1] * s + self.Nr[k][1] * d)

    def ammesso(self, k):
        """Archi che possono avere stalli: a terra, non pedonali, non rotatorie, ponti, gallerie o corsie riservate."""
        e = self.archi[k]
        return e[2] != 8 and not e[5] & (4 | 8 | 16 | 32) and k not in self.in_quota and self.L[k] >= STALLO[PETTINE][0]

    def bisogno(self, k):
        """Larghezza che le corsie dell'arco devono tenere perché il gioco non ne tolga e i mezzi ci passino: per
        corsia 2,75 m sulle vie locali, 3,00 su quelle di quartiere, 3,25 sulle strade principali, 3,50 dove passa una
        linea (DM 5/11/2001: con 3,25 tra la fiancata del bus e le auto ferme restavano 24 cm, e nelle curve il bus
        automatico le toccava). Senza corsie (doppio senso stretto,
        senza mezzeria) tutta la carreggiata."""
        nf, nb, bf, bb = self.corsie[k]
        n = nf + nb
        if not n:
            return self.W[k]
        e = self.archi[k]
        per = 3.5 if k in self.bus else 3.25 if e[2] <= 1 else 3.0 if e[2] <= 3 else 2.75
        if n == 1:
            return 3.5 if k in self.bus or bf or bb else 3.0
        return (n - bf - bb) * per + (bf + bb) * 3.5

    def mezza_corsie(self, k):
        """Mezza larghezza delle corsie dell'arco come le disegna il gioco senza stalli, centrate sull'asse."""
        n = sum(self.corsie[k][:2])
        return min(self.W[k], max(n, 1) * CORSIA_MAX) / 2

    def _catene(self):
        """Catena di ogni arco carrabile: gli archi di fila tra due incroci con la stessa carreggiata e le stesse
        corsie. `catena[k]` = (catena, verso): verso 1 se l'arco va come la catena, -1 se va contro. Le corsie di una
        catena stanno tutte tra gli stessi bordi, così le righe non fanno gradini da un arco all'altro."""
        self.catena = {}
        vista = lambda k, sg: self.corsie[k] if sg > 0 else (self.corsie[k][1], self.corsie[k][0], self.corsie[k][3], self.corsie[k][2])
        for k0 in range(self.N):
            if k0 in self.catena or self.archi[k0][2] == 8 or self.L[k0] <= 0.05:
                continue
            self.catena[k0] = (k0, 1)
            for capo in (0, 1):
                k, sk, nodo = k0, 1, self.archi[k0][capo]
                while len(self.at[nodo]) == 2:
                    j = self.at[nodo][0] if self.at[nodo][1] == k else self.at[nodo][1]
                    if j == k or j in self.catena:
                        break
                    # la catena passa dal nodo: in avanti j ne esce, all'indietro j ci arriva
                    sj = (1 if self.archi[j][0] == nodo else -1) if capo else (1 if self.archi[j][1] == nodo else -1)
                    if abs(self.W[j] - self.W[k]) > 0.05 or self.archi[j][2] != self.archi[k][2] or vista(j, sj) != vista(k, sk):
                        break
                    self.catena[j] = (k0, sj)
                    nodo = self.archi[j][1] if self.archi[j][0] == nodo else self.archi[j][0]
                    k, sk = j, sj

    def _incroci(self):
        for nodo, ks in self.at.items():
            if len(ks) >= 3:
                for k in ks:
                    altri = max(self.W[j] for j in ks if j != k) / 2
                    lib = altri + (INCROCIO_BUS if k in self.bus or nodo in self.semafori else INCROCIO)
                    self._capo(k, nodo, lib, 'incrocio')
            elif len(ks) == 2:
                k, j = ks
                # verso uscente dal nodo dei due archi: allineati se opposti
                u = self.U[k] * (1 if self.archi[k][0] == nodo else -1)
                v = self.U[j] * (1 if self.archi[j][0] == nodo else -1)
                if u[0] * v[0] + u[1] * v[1] > -math.cos(math.radians(20)):
                    for q in ks:
                        self._capo(q, nodo, CURVA_BUS if q in self.bus else CURVA, 'curva')
                elif self.catena[k][0] != self.catena[j][0]:
                    for q in ks:
                        if q in self.bus:
                            self._capo(q, nodo, CAMBIO_BUS, 'curva')

    def _capo(self, k, nodo, lib, perche):
        s = (0.0, lib) if self.archi[k][0] == nodo else (self.L[k] - lib, self.L[k])
        for lato in (0, 1):
            self.libero[(k, lato)].append((s[0], s[1], perche))

    def _strisce(self):
        for a, b, s in self.M.get('crossings', []):
            k = self.arco(a, b)
            if k is None:
                continue
            if self.archi[k][0] != a:
                s = self.L[k] - s
            for lato in (0, 1):
                self.libero[(k, lato)].append((s - STRISCE, s + STRISCE, 'strisce'))

    def _fermate(self):
        """Zona di fermata a destra di chi percorre la linea: ingresso, bus fermo con la porta davanti alla palina,
        uscita. Lungo il percorso della variante, anche oltre l'arco della fermata. Dove il percorso passa due volte
        dalla stessa via (andata e ritorno) vale il passaggio che ha la fermata a destra, dopo la fermata prima. La
        zona vale anche come rettangolo (`fermate`): libera gli stalli degli archi accanto, quando la linea corre su
        una carreggiata e la fermata sta sull'asfalto di quella affiancata."""
        stops = self.M['stops']
        fatte, self.fermate = set(), []
        for Ln in self.M['lines']:
            bus = SNODATO if Ln['id'] in SNODATI else BUS
            for v in Ln['variants']:
                ids = [n for i, n in enumerate(v['nodes']) if i == 0 or n != v['nodes'][i - 1]]
                if len(ids) < 2:
                    continue
                P = np.array([self.nodi[i] for i in ids], dtype=float)
                seg = P[1:] - P[:-1]
                ln = np.hypot(seg[:, 0], seg[:, 1])
                cum = np.concatenate([[0.0], np.cumsum(ln)])
                prima = -1e9
                for si in v['stops']:
                    x, z = stops[si][0], stops[si][1]
                    t = np.clip(((x - P[:-1, 0]) * seg[:, 0] + (z - P[:-1, 1]) * seg[:, 1]) / np.maximum(ln * ln, 1e-9), 0, 1)
                    dist = np.hypot(P[:-1, 0] + seg[:, 0] * t - x, P[:-1, 1] + seg[:, 1] * t - z)
                    dist[ln < 0.05] = 1e9
                    if dist.min() > FERMATA_REACH:
                        continue
                    # di traverso al tratto, positivo a destra di chi va
                    lat = ((x - P[:-1, 0]) * -seg[:, 1] + (z - P[:-1, 1]) * seg[:, 0]) / np.maximum(ln, 1e-9)
                    vicini = np.flatnonzero(dist <= dist.min() + 3.0)
                    dopo = [q for q in vicini if cum[q] + t[q] * ln[q] >= prima - 5.0] or list(vicini)
                    j = int(next((q for q in dopo if lat[q] > 1.0), dopo[0]))
                    S = prima = cum[j] + t[j] * ln[j]
                    s0, s1 = S - bus - FERMATA_INGRESSO, S + FERMATA_USCITA
                    u = seg[j] / ln[j]
                    nr = np.array([-u[1], u[0]])
                    c = P[j] + seg[j] * t[j]
                    # rettangolo della zona: dall'asse del percorso fino a 5 m oltre la palina, dalla sua parte
                    l0, l1 = sorted((-1.0 if lat[j] >= 0 else 1.0, float(lat[j]) + (5.0 if lat[j] >= 0 else -5.0)))
                    r0, r1 = s0 - S, s1 - S
                    if si in (v['stops'][0], v['stops'][-1]):
                        # capolinea: il bus automatico arriva e riparte anche fuori dal percorso della variante
                        # (buildLane di src/world/buses.js), sugli archi lì attorno
                        r0, r1, l0, l1 = -CAPOLINEA, CAPOLINEA, min(l0, -CAPOLINEA_LATO), max(l1, CAPOLINEA_LATO)
                    chiave = (round(float(c[0]), 1), round(float(c[1]), 1), round(float(u[0]), 2), round(float(u[1]), 2), bus, r1, l1 - l0)
                    if chiave not in fatte:
                        fatte.add(chiave)
                        self.fermate.append(Polygon([tuple(c + u * a + nr * b) for a, b in ((r0, l0), (r1, l0), (r1, l1), (r0, l1))]))
                    for q in range(len(ids) - 1):
                        if cum[q + 1] <= s0 or cum[q] >= s1 or ln[q] < 0.05:
                            continue
                        k = self.arco(ids[q], ids[q + 1])
                        if k is None:
                            continue
                        a, b = max(s0, cum[q]) - cum[q], min(s1, cum[q + 1]) - cum[q]
                        avanti = self.archi[k][0] == ids[q]
                        if not avanti:
                            a, b = ln[q] - b, ln[q] - a
                        voce = (k, 1 if avanti else 0, round(a, 1), round(b, 1))
                        if voce not in fatte:
                            fatte.add(voce)
                            self.libero[voce[:2]].append((a, b, 'fermata'))
        self.fermate_tree = STRtree(self.fermate) if self.fermate else None

    def _passi(self, vie, luoghi):
        """Passi carrai: le strade di servizio di OSM che la rete non ha (driveway, parking_aisle) dove toccano una
        via della rete, dal lato da cui escono; e gli ingressi dei parcheggi (parking_entrance)."""
        nodi_rete = set()
        fuori = []
        for w in vie:
            t = w.get('tags', {})
            if w.get('type') != 'way' or 'geometry' not in w:
                continue
            hw = t.get('highway')
            in_rete = hw in osm_rete.CLASSE and not (hw == 'service' and t.get('service') in SERVIZIO_FUORI)
            if in_rete:
                nodi_rete.update(w['nodes'])
            elif hw == 'service':
                fuori.append(w)
        for w in fuori:
            mezzo = PASSO_CARRAIO.get(w['tags'].get('service'), PASSO_ALTRO)
            g = w['geometry']
            for i, nid in enumerate(w['nodes']):
                if nid not in nodi_rete:
                    continue
                P = build_gtfs.xz(g[i]['lat'], g[i]['lon'])
                for j in (i - 1, i + 1):
                    if 0 <= j < len(g):
                        self._passo(P, build_gtfs.xz(g[j]['lat'], g[j]['lon']), mezzo, 1.5, 'passo carraio')
        for o in luoghi:
            if o['t'].get('amenity') == 'parking_entrance':
                P = build_gtfs.xz(*o['c'])
                self._passo(P, None, PASSO_ALTRO, INGRESSO_REACH, 'ingresso di un parcheggio')

    def _passo(self, P, Q, mezzo, reach, perche):
        """Libera mezzo metri ai due lati della proiezione di P sull'arco più vicino (entro reach), dal lato di Q (o
        dal lato di P, se Q manca)."""
        pt = Point(P)
        best = None
        for k in self.tree.query(pt.buffer(reach)):
            k = int(k)
            if self.archi[k][2] == 8 or self.L[k] < 0.05:
                continue
            s = (P[0] - self.A[k][0]) * self.U[k][0] + (P[1] - self.A[k][1]) * self.U[k][1]
            s = min(max(s, 0.0), self.L[k])
            c = self.punto(k, s, 0)
            dist = math.hypot(P[0] - c[0], P[1] - c[1])
            if dist <= reach and (best is None or dist < best[0]):
                best = (dist, k, s)
        if best is None:
            return
        _d, k, s = best
        R = Q if Q is not None else P
        lat = (R[0] - self.A[k][0]) * self.Nr[k][0] + (R[1] - self.A[k][1]) * self.Nr[k][1]
        if abs(lat) < 0.3:
            return
        self.libero[(k, 1 if lat > 0 else 0)].append((s - mezzo, s + mezzo, perche))

    def tratti_liberi(self, k, lato, entro=None, presi=()):
        """Tratti del lato dell'arco dove possono stare stalli: [0, L] (o `entro`) meno le zone libere e i tratti già
        presi da una fonte prima."""
        a0, b0 = entro if entro else (0.0, float(self.L[k]))
        a0, b0 = max(0.0, a0), min(float(self.L[k]), b0)
        chiusi = sorted([(a, b) for a, b, _p in self.libero.get((k, lato), ())] + list(presi))
        out, s = [], a0
        for a, b in chiusi:
            if a > s:
                out.append((s, min(a, b0)))
            s = max(s, b)
            if s >= b0:
                break
        if s < b0:
            out.append((s, b0))
        return [(a, b) for a, b in out if b - a > 1e-6]


class Sosta:
    def __init__(self, M, luoghi, dbgt, vie, suolo=()):
        self.M = M
        self.suolo, self.urbano = suolo, None
        self.R = R = Strade(M, vie, luoghi)
        self.asf = Asfalto(M['surfaces'])
        self.presi = defaultdict(list)   # (arco, lato) -> [(s0, s1)] già decisi da una fonte
        self.stalli = []                 # dict: k, lato, tipo, fonte, s0, kd (bordo dell'asfalto), poi d0 e d1 della fila
        self.scarti = Counter()          # (fonte, perché) -> stalli scartati
        # corsie degli archi e incroci, per dire se uno stallo tocca le corsie di un altro arco
        self.corr, self.corr_k = [], []
        for k in range(R.N):
            if R.archi[k][2] == 8 or R.L[k] < 0.3:
                continue
            # (dove passa una linea mezzo metro in più: la carrozzeria del bus in curva esce dalla corsia)
            self.corr.append(LineString([R.A[k], R.B[k]]).buffer(R.mezza_corsie(k) + (0.5 if k in R.bus else 0), cap_style='flat'))
            self.corr_k.append(k)
        for nodo, ks in R.at.items():
            if len(ks) >= 3:
                self.corr.append(Point(R.nodi[nodo]).buffer(max(R.mezza_corsie(k) for k in ks), quad_segs=4))
                self.corr_k.append(-1)
        self.corr_tree = STRtree(self.corr)
        tram = [LineString([(t[i], t[i + 1]) for i in range(0, len(t) - 1, 2)]).buffer(TRAM, quad_segs=2) for t in self._binari() if len(t) >= 4]
        # la sede di una linea intera ha migliaia di vertici: preparata, e chiesta come primo argomento (è lei che ha
        # l'indice), "lo stallo tocca la sede?" ha lo stesso esito senza ripercorrerla tutta ogni volta (#161: era metà
        # del passo della sosta)
        for g in tram:
            shapely.prepare(g)
        self.tram = tram
        self.tram_tree = STRtree(tram) if tram else None
        self.luoghi, self.dbgt = luoghi, dbgt

    def _binari(self):
        import aree_mappa
        return [[v for p in t for v in p] for t in aree_mappa.tram_tracks(self.M)]

    # ---- stalli candidati ----
    def candidati(self, k, lato, tipo, entro=None):
        """Stalli di un tipo sui tratti liberi del lato: in ogni tratto quanti ce ne stanno, centrati."""
        passo = STALLO[tipo][0]
        out = []
        for a, b in self.R.tratti_liberi(k, lato, entro, self.presi[(k, lato)]):
            n = int((b - a + 1e-6) // passo)
            s = a + (b - a - n * passo) / 2
            out += [s + i * passo for i in range(n)]
        return out

    def bordo(self, ks, lati, s0s, tipo):
        """Distanza dall'asse del bordo dell'asfalto davanti a ogni stallo: il più vicino tra le linee di traverso."""
        R = self.R
        passo = STALLO[tipo][0]
        nl = max(3, int(math.ceil(passo / 1.25)) + 1)
        ks = np.asarray(ks)
        segno = np.where(np.asarray(lati) == 1, 1.0, -1.0)
        ss = np.asarray(s0s, dtype=float)[:, None] + np.linspace(0.2, passo - 0.2, nl)[None, :]        # [n, nl]
        ts = np.arange(PASSO_T, T_MAX + 1e-9, PASSO_T)                                                     # [nt]
        bx = R.A[ks, 0][:, None] + R.U[ks, 0][:, None] * ss
        bz = R.A[ks, 1][:, None] + R.U[ks, 1][:, None] * ss
        nx, nz = (R.Nr[ks, 0] * segno)[:, None, None], (R.Nr[ks, 1] * segno)[:, None, None]
        X = bx[:, :, None] + nx * ts[None, None, :]
        Z = bz[:, :, None] + nz * ts[None, None, :]
        dentro = self.asf.dentro(X, Z)
        # primo punto fuori dall'asfalto lungo ogni linea: il bordo è il punto prima
        fuori = ~dentro
        primo = np.where(fuori.any(axis=2), fuori.argmax(axis=2), len(ts))
        return (primo.min(axis=1) * PASSO_T).round(2)

    def rett(self, k, lato, s0, tipo, d0, d1):
        R = self.R
        sg = 1 if lato == 1 else -1
        s1 = s0 + STALLO[tipo][0]
        return Polygon([R.punto(k, s0, sg * d0), R.punto(k, s1, sg * d0), R.punto(k, s1, sg * d1), R.punto(k, s0, sg * d1)])

    def prova(self, k, lato, tipo, fonte, s0s, area=None):
        """Stalli che reggono tra i candidati s0s: bordo dell'asfalto, piazzali, corsie degli altri archi, sede del
        tram, area della fonte. Dà [(s0, kd)]."""
        if not s0s:
            return []
        R = self.R
        prof = STALLO[tipo][1]
        kd = self.bordo([k] * len(s0s), [lato] * len(s0s), s0s, tipo)
        out = []
        for s0, d1 in zip(s0s, kd):
            d1 = float(d1)
            d0 = d1 - prof
            if d0 < 0.5:
                self.scarti[(fonte, "non c'è asfalto per lo stallo")] += 1
                continue
            if d1 > R.W[k] / 2 + FUORI:
                self.scarti[(fonte, 'piazzale: il bordo è oltre %.1f m dalla carreggiata' % FUORI)] += 1
                continue
            g = self.rett(k, lato, s0, tipo, d0, d1)
            if area is not None and g.intersection(area).area < AREA_QUOTA[tipo] * g.area:
                self.scarti[(fonte, "lo stallo contro il cordolo non sta nell'area della fonte")] += 1
                continue
            if any(self.corr_k[int(i)] != k and g.intersection(self.corr[int(i)]).area > 0.2 for i in self.corr_tree.query(g)):
                self.scarti[(fonte, 'sulle corsie di un altro arco o in un incrocio')] += 1
                continue
            if self.tram_tree is not None and any(self.tram[int(i)].intersects(g) for i in self.tram_tree.query(g)):
                self.scarti[(fonte, 'sulla sede del tram')] += 1
                continue
            out.append((s0, d1))
        return out

    def prendi(self, k, lato, tipo, fonte, buoni):
        passo = STALLO[tipo][0]
        for s0, kd in buoni:
            self.stalli.append({'k': k, 'lato': lato, 'tipo': tipo, 'fonte': fonte, 's0': s0, 'kd': kd})
            self.presi[(k, lato)].append((s0, s0 + passo))

    # ---- le fonti ----
    def da_tag(self):
        """1. Tag OSM della via (`sosta` nella mappa, scripts/osm_rete.py): in carreggiata, in un golfo, a cavallo del
        cordolo o "ammessa" danno una fila lungo tutto il lato; "vietata", sul marciapiede e sulla banchina chiudono
        il lato alle fonti dopo; "disegnata a parte" lo lascia all'area OSM."""
        R = self.R
        for k, sx, dx in self.M.get('sosta', []):
            for lato, v in ((0, sx), (1, dx)):
                posto, verso = v & 15, v >> 4
                if not posto or posto == 7:
                    continue
                if posto in (2, 3, 5, 8) and R.ammesso(k):
                    tipo = {2: SPINA, 3: PETTINE}.get(verso, LINEA)
                    self.prendi(k, lato, tipo, TAG, self.prova(k, lato, tipo, TAG, self.candidati(k, lato, tipo)))
                self.presi[(k, lato)].append((0.0, float(R.L[k])))

    def aree_osm(self):
        """Aree `parking=street_side` di OSM (parcheggi e stalli singoli) con il contorno, unite dove si toccano, con
        il verso degli stalli se OSM lo dice."""
        polys, versi = golfi_osm(self.luoghi, True)
        uniti = [g for g in getattr(unary_union([p.buffer(0.2, quad_segs=2) for p in polys]), 'geoms', [])] if polys else []
        tree = STRtree(polys) if polys else None
        out = []
        for g in uniti:
            peso = Counter()
            for i in tree.query(g):
                peso[versi[int(i)]] += polys[int(i)].area
            verso = max((v for v in peso if v), key=lambda v: peso[v], default=None)
            out.append((g, verso))
        return out

    def aree_dbgt(self):
        from street_surfaces import dbgt_polys
        return [(g, None) for g in dbgt_polys((self.dbgt or {}).get('parcheggi', [])) if not g.is_empty]

    def da_aree(self, aree, fonte):
        """2 e 3. Aree di sosta lungo le vie: gli stalli stanno contro il cordolo dei lati degli archi che l'area
        affianca, per il tratto che l'area copre. Senza il verso, a pettine se uno stallo profondo 5 m sta nell'area,
        altrimenti in linea."""
        R = self.R
        for g, verso in aree:
            for k in sorted(int(i) for i in R.tree.query(g.buffer(T_MAX))):
                # (il DBGT non vale lungo le strade di servizio: lì i suoi SV_STR sono quasi tutti distributori e
                # piazzali, campione sulla foto aerea in docs/sosta.md)
                if not R.ammesso(k) or (fonte == DBGT and R.archi[k][2] == 7):
                    continue
                asse = LineString([R.A[k], R.B[k]])
                if asse.distance(g) > R.W[k] / 2 + AREA_REACH:
                    continue
                c = g.representative_point()
                lat = (c.x - R.A[k][0]) * R.Nr[k][0] + (c.y - R.A[k][1]) * R.Nr[k][1]
                lato = 1 if lat > 0 else 0
                xs, zs = np.array(g.exterior.coords).T
                pr = (xs - R.A[k][0]) * R.U[k][0] + (zs - R.A[k][1]) * R.U[k][1]
                entro = (float(pr.min()), float(pr.max()))
                if entro[1] <= 0 or entro[0] >= R.L[k]:
                    continue
                # senza il verso si provano i due tipi: a pettine se copre almeno due terzi del cordolo che copre la
                # fila in linea; nel conto degli scarti resta la prova scelta (l'ultima, se non regge nessuna)
                prima, scelta = Counter(self.scarti), None
                for tipo in ((verso,) if verso else (PETTINE, LINEA)):
                    self.scarti = Counter(prima)
                    buoni = self.prova(k, lato, tipo, fonte, self.candidati(k, lato, tipo, entro), g)
                    metri = len(buoni) * STALLO[tipo][0]
                    if scelta is None or metri > 1.5 * scelta[2]:
                        scelta = (tipo, buoni, metri, self.scarti)
                if scelta[1]:
                    self.prendi(k, lato, scelta[0], fonte, scelta[1])
                    self.scarti = scelta[3]

    def in_citta(self, k, lato, s0, d1):
        """Lo stallo sta in un'area urbana di OSM e ha un edificio vicino dal suo lato."""
        if self.urbano is None:
            from shapely.geometry import Polygon as P
            ps = []
            for o in self.suolo:
                if o['t'].get('landuse') in URBANO and 'p' in o:
                    g = P([build_gtfs.xz(o['p'][i], o['p'][i + 1]) for i in range(0, len(o['p']) - 1, 2)])
                    ps.append(g if g.is_valid else g.buffer(0))
            self.urbano = unary_union(ps).buffer(URBANO_REACH, quad_segs=2) if ps else Polygon()
            shapely.prepare(self.urbano)
            self.edifici = []
            for b in self.M.get('buildings') or []:
                f = b[3]
                if len(f) >= 6:
                    g = P([(f[i], f[i + 1]) for i in range(0, len(f) - 1, 2)])
                    self.edifici.append(g if g.is_valid else g.buffer(0))
            self.edifici_tree = STRtree(self.edifici) if self.edifici else None
        x, z = self.R.punto(k, s0 + STALLO[LINEA][0] / 2, (1 if lato == 1 else -1) * d1)
        if not shapely.contains_xy(self.urbano, x, z):
            return 'fuori dalle aree urbane di OSM'
        if self.edifici_tree is None or not len(self.edifici_tree.query(Point(x, z), predicate='dwithin', distance=EDIFICIO_REACH)):
            return 'senza edifici entro %d m' % EDIFICIO_REACH
        return None

    def da_larghezza(self):
        """4. Carreggiata misurata più larga delle corsie: 2 m liberi su un lato danno una fila in linea. Il posto
        libero di un lato è il bordo dell'asfalto meno le corsie di quel lato; se bastano solo sommando i due lati la
        fila è una, dal lato più largo (a destra della via OSM se sono uguali): le corsie si spostano. Sempre in
        linea: 5 m liberi non bastano a dire che la fila è a pettine (campione sulla foto aerea, docs/sosta.md)."""
        R = self.R
        for k in range(R.N):
            e = R.archi[k]
            nf, nb, bf, bb = R.corsie[k]
            if not R.ammesso(k) or e[2] not in CLASSI_LARGHEZZA or not e[5] & 512 or bf or bb or not nf + nb:
                continue
            bis = R.bisogno(k)
            if R.W[k] - bis < LARGHEZZA_MIN:
                continue
            # corsie di ogni lato con l'asse in mezzo: a sinistra quelle contro il verso, a destra quelle nel verso
            per = bis / (nf + nb)
            lato_bis = (nb * per, nf * per) if nf and nb else (bis / 2, bis / 2)
            cand = {lato: self.candidati(k, lato, LINEA) for lato in (0, 1)}
            kd = {lato: self.bordo([k] * len(c), [lato] * len(c), c, LINEA) if c else np.array([]) for lato, c in cand.items()}
            med = {lato: float(np.median(np.minimum(v, R.W[k] / 2 + FUORI))) if len(v) else 0.0 for lato, v in kd.items()}
            posto = {lato: med[lato] - lato_bis[lato] for lato in (0, 1)}
            if min(posto.values()) >= LARGHEZZA_MIN:
                lati = (0, 1)
            elif posto[0] + posto[1] >= LARGHEZZA_MIN and max(med.values()) > 0:
                lati = (0,) if posto[0] > posto[1] + 0.3 else (1,)
            else:
                continue
            for lato in lati:
                if not len(kd[lato]):
                    continue
                tipo = LINEA
                buoni = []
                for s0, d1 in self.prova(k, lato, tipo, LARGHEZZA, self.candidati(k, lato, tipo)):
                    no = self.in_citta(k, lato, s0, d1)
                    if no:
                        self.scarti[(LARGHEZZA, no)] += 1
                    else:
                        buoni.append((s0, d1))
                # file corte: un allargamento, non una fila
                file_, cur = [], []
                for s0, d1 in buoni:
                    if cur and (abs(s0 - cur[-1][0] - STALLO[tipo][0]) > 1e-6):
                        file_.append(cur)
                        cur = []
                    cur.append((s0, d1))
                if cur:
                    file_.append(cur)
                for f in file_:
                    if len(f) >= FILA_MIN:
                        self.prendi(k, lato, tipo, LARGHEZZA, f)
                    else:
                        self.scarti[(LARGHEZZA, 'fila più corta di %d stalli' % FILA_MIN)] += len(f)

    # ---- file ----
    def file(self):
        """Gli stalli in file: di fila sullo stesso lato, stesso tipo e fonte, con il cordolo entro SALTO; il bordo
        della fila è il cordolo più vicino all'asse."""
        out = []
        self.stalli.sort(key=lambda s: (s['k'], s['lato'], s['s0']))
        cur = None
        for s in self.stalli:
            passo = STALLO[s['tipo']][0]
            if cur and cur['k'] == s['k'] and cur['lato'] == s['lato'] and cur['tipo'] == s['tipo'] and cur['fonte'] == s['fonte'] \
                    and abs(cur['s0'] + cur['n'] * passo - s['s0']) < 1e-6 and max(cur['hi'], s['kd']) - min(cur['lo'], s['kd']) <= SALTO:
                cur['n'] += 1
                cur['lo'], cur['hi'] = min(cur['lo'], s['kd']), max(cur['hi'], s['kd'])
            else:
                cur = {'k': s['k'], 'lato': s['lato'], 'tipo': s['tipo'], 'fonte': s['fonte'], 's0': s['s0'], 'n': 1, 'lo': s['kd'], 'hi': s['kd']}
                out.append(cur)
        for f in out:
            f['d1'] = f['lo']
            f['d0'] = round(f['d1'] - STALLO[f['tipo']][1], 2)
        return out

    def corsie_libere(self, file_):
        """Le corsie devono starci: tra i bordi d0 dei due lati (o il bordo della carreggiata) serve `bisogno`, lungo
        tutta la catena dell'arco (gli archi di fila tra due incroci), perché le corsie di una catena stanno tra gli
        stessi bordi. Dove non basta si tolgono le file che stringono, prima quelle della fonte meno certa, poi il
        lato che stringe di più. Sugli archi con la corsia dei bus, che il gioco tiene contro il cordolo, nessuna fila
        può stringere la carreggiata. Dà le file rimaste e, per catena, la mezza larghezza libera a sinistra e a destra
        (nel verso della catena)."""
        R = self.R
        per_catena = defaultdict(list)
        for f in file_:
            c, sg = R.catena[f['k']]
            f['lc'] = f['lato'] if sg > 0 else 1 - f['lato']  # lato nel verso della catena
            per_catena[c].append(f)
        out, self.bordi = [], {}
        for c, fs in per_catena.items():
            mezza = R.W[c] / 2
            nf, nb, bf, bb = R.corsie[c]
            bis = R.bisogno(c) if not (bf or bb) else R.W[c]
            while True:
                h = [min([mezza] + [f['d0'] for f in fs if f['lc'] == lato]) for lato in (0, 1)]
                if h[0] + h[1] >= bis - 1e-6:
                    break
                stringe = [f for f in fs if f['d0'] < mezza - 1e-6]
                if not stringe:
                    break
                peggio = max(stringe, key=lambda f: (f['fonte'], mezza - f['d0'], -f['n'], f['lc'], f['k'], f['s0']))
                via = [f for f in stringe if f['lc'] == peggio['lc'] and f['fonte'] == peggio['fonte'] and f['d0'] <= peggio['d0'] + 1e-6]
                for f in via:
                    self.scarti[(f['fonte'], 'le corsie non ci stanno')] += f['n']
                fs = [f for f in fs if not any(f is v for v in via)]
            if fs and (h[0] < mezza - 1e-6 or h[1] < mezza - 1e-6):
                self.bordi[c] = h
            out += fs
        return sorted(out, key=lambda f: (f['k'], f['lato'], f['s0']))

    def sedi(self, file_):
        """`sedeCorsie`: [arco, sinistra, destra] in cm per gli archi delle catene dove gli stalli stringono la
        carreggiata: le corsie stanno tra sinistra e destra dell'asse (nel verso a -> b dell'arco)."""
        R = self.R
        # dopo gli ultimi scarti i bordi si ricalcolano dalle file rimaste
        bordi = {}
        for f in file_:
            c, _sg = R.catena[f['k']]
            mezza = R.W[c] / 2
            h = bordi.setdefault(c, [mezza, mezza])
            h[f['lc']] = min(h[f['lc']], f['d0'])
        out = []
        for k in range(R.N):
            cs = R.catena.get(k)
            if not cs or cs[0] not in bordi:
                continue
            h, mezza = bordi[cs[0]], R.W[cs[0]] / 2
            if h[0] >= mezza - 1e-6 and h[1] >= mezza - 1e-6:
                continue
            sx, dx = (h[0], h[1]) if cs[1] > 0 else (h[1], h[0])
            out.append([k, round(sx * 100), round(dx * 100)])
        return out

    def _unita(self, file_):
        out = []
        for f in file_:
            passo = STALLO[f['tipo']][0]
            for i in range(f['n']):
                out.append((f, i, self.rett(f['k'], f['lato'], f['s0'] + i * passo, f['tipo'], f['d0'] + 0.05, f['d1'] - 0.05)))
        return out

    @staticmethod
    def _senza(file_, via):
        """Le file senza gli stalli di `via` (indici nell'ordine di _unita): una fila con un buco diventa due."""
        if not via:
            return file_
        out, idx = [], 0
        for f in file_:
            passo = STALLO[f['tipo']][0]
            cur = None
            for i in range(f['n']):
                if idx + i in via:
                    cur = None
                    continue
                if cur is None:
                    cur = dict(f, s0=f['s0'] + i * passo, n=0)
                    out.append(cur)
                cur['n'] += 1
            idx += f['n']
        return out

    def rifinisci(self, file_):
        """Ogni stallo, al posto che ha nella sua fila (il bordo della fila è il cordolo più vicino all'asse tra i suoi
        stalli), deve stare ancora tutto sull'asfalto e fuori dalle corsie degli altri archi e dalla sede del tram: gli
        stessi controlli di `controlla`."""
        unita = self._unita(file_)
        via = set()
        for q, (f, i, g) in enumerate(unita):
            perche = self.fuori_posto(f['k'], f['lato'], f['tipo'], f['s0'] + i * STALLO[f['tipo']][0], f['d0'], f['d1'], g)
            if perche:
                via.add(q)
                self.scarti[(f['fonte'], perche)] += 1
        return self._senza(file_, via)

    def fuori_posto(self, k, lato, tipo, s0, d0, d1, g=None):
        """Perché lo stallo non può stare lì, o None: asfalto in nove punti, corsie degli altri archi, sede del tram."""
        R = self.R
        passo, sg = STALLO[tipo][0], 1 if lato == 1 else -1
        ps = [R.punto(k, s0 + passo * u, sg * (d0 + (d1 - d0) * v)) for u in (0.08, 0.5, 0.92) for v in (0.08, 0.5, 0.92)]
        if not self.asf.dentro([p[0] for p in ps], [p[1] for p in ps]).all():
            return "non sta tutto sull'asfalto"
        if g is None:
            g = self.rett(k, lato, s0, tipo, d0 + 0.05, d1 - 0.05)
        if any(self.corr_k[int(j)] != k and g.intersection(self.corr[int(j)]).area > 0.2 for j in self.corr_tree.query(g)):
            return 'sulle corsie di un altro arco o in un incrocio'
        if self.tram_tree is not None and any(self.tram[int(j)].intersects(g) for j in self.tram_tree.query(g)):
            return 'sulla sede del tram'
        if R.fermate_tree is not None and any(g.intersection(R.fermate[int(j)]).area > 0.2 for j in R.fermate_tree.query(g)):
            return 'nella zona di una fermata'
        return None

    def senza_doppi(self, file_):
        """Stalli di archi diversi che si toccano (angoli, vie affiancate sullo stesso asfalto): resta quello della
        fonte più certa, poi dell'arco con l'indice più basso; la fila si spezza."""
        unita = self._unita(file_)
        if not unita:
            return file_
        tree = STRtree([u[2] for u in unita])
        via = set()
        a, b = tree.query([u[2] for u in unita], predicate='intersects')
        for i, j in sorted(zip(a.tolist(), b.tolist())):
            if i >= j or i in via or j in via:
                continue
            fi, fj = unita[i][0], unita[j][0]
            if fi['k'] == fj['k'] and fi['lato'] == fj['lato']:
                continue
            if unita[i][2].intersection(unita[j][2]).area < 0.1:
                continue
            perde = j if (fi['fonte'], fi['k']) <= (fj['fonte'], fj['k']) else i
            via.add(perde)
            self.scarti[(unita[perde][0]['fonte'], 'sopra uno stallo di un altro arco')] += 1
        return self._senza(file_, via)

    def calcola(self):
        self.da_tag()
        self.da_aree(self.aree_osm(), AREA)
        self.da_aree(self.aree_dbgt(), DBGT)
        self.da_larghezza()
        file_ = self.senza_doppi(self.rifinisci(self.corsie_libere(self.file())))
        file_ = [f for f in file_ if not (f['fonte'] == LARGHEZZA and f['n'] < FILA_MIN)]
        self.file_ = file_
        voci = [[f['k'], f['lato'], f['tipo'], f['fonte'], round(f['d0'] * 100), round(f['d1'] * 100), round(f['s0'] * 100), f['n']] for f in file_]
        return voci, self.sedi(file_)


def golfi_osm(luoghi=None, versi=False):
    """Poligoni delle aree di sosta lungo la strada di OSM (`parking=street_side`: parcheggi e stalli singoli con il
    contorno, non privati), nelle coordinate del gioco; con `versi` anche il tipo di stallo che OSM dichiara."""
    if luoghi is None:
        luoghi = json.load(open(os.path.join(RADICE, 'data', 'osm-luoghi.json'), encoding='utf-8'))['parcheggi']
    VERSO = {'parallel': LINEA, 'diagonal': SPINA, 'perpendicular': PETTINE}
    polys, vs = [], []
    for o in luoghi:
        t = o['t']
        if t.get('parking') != 'street_side' or t.get('amenity') not in ('parking', 'parking_space') or 'p' not in o:
            continue
        if t.get('access') in ('private', 'no'):
            continue
        pts = [build_gtfs.xz(o['p'][i], o['p'][i + 1]) for i in range(0, len(o['p']) - 1, 2)]
        if len(pts) < 3:
            continue
        p = Polygon(pts)
        p = p if p.is_valid else p.buffer(0)
        if p.is_empty or not isinstance(p, Polygon):
            continue
        polys.append(p)
        vs.append(VERSO.get(t.get('orientation')))
    return (polys, vs) if versi else polys


def leggi_dati(vie=None):
    """Aree di sosta e uso del suolo di OSM, poligoni del DBGT e vie OSM (per i passi carrai) dai file di data/."""
    osm = json.load(open(os.path.join(RADICE, 'data', 'osm-luoghi.json'), encoding='utf-8'))
    luoghi, suolo = osm['parcheggi'], osm['suolo']
    dbgt = json.load(open(os.path.join(RADICE, 'data', 'dbgt-strade.json'), encoding='utf-8'))
    if vie is None:
        vie = []
        for nome in ('osm-padova.json', 'osm-corridoio.json'):
            p = os.path.join(RADICE, 'data', nome)
            if os.path.exists(p):
                vie += json.load(open(p, encoding='utf-8'))['elements']
    return luoghi, suolo, dbgt, vie


def calcola(M, vie=None, dbgt=None):
    """`stalli` e `sedeCorsie` per la mappa intera M (con `surfaces` ed edifici), più l'oggetto del calcolo. `vie`: gli
    elementi OSM che la build ha già letto; `dbgt`: i poligoni di data/dbgt-strade.json se la build li ha già letti."""
    luoghi, suolo, dbgt_file, vie = leggi_dati(vie)
    S = Sosta(M, luoghi, dbgt or dbgt_file, vie, suolo)
    voci, sedi = S.calcola()
    return voci, sedi, S


def tipi():
    """`stalliTipi`: per tipo (1 in linea, 2 a spina, 3 a pettine) [passo lungo il cordolo, profondità] in cm."""
    return {str(t): [round(p * 100), round(d * 100)] for t, (p, d) in STALLO.items()}


def riassunto(voci):
    righe = []
    for fonte in NOME_FONTE:
        vs = [v for v in voci if v[3] == fonte]
        tipi = ', '.join(f"{sum(v[7] for v in vs if v[2] == t)} {NOME_TIPO[t]}" for t in NOME_TIPO if any(v[2] == t for v in vs))
        righe.append(f"  {NOME_FONTE[fonte]}: {len({v[0] for v in vs})} archi, {len(vs)} file, {sum(v[7] for v in vs)} stalli ({tipi or 'nessuno'})")
    return righe


def bordi_corsie(R, k, sede=None):
    """Bordo sinistro e destro delle corsie dell'arco come le mette il gioco (laneLayout in src/data/padova.js), in
    metri dall'asse verso destra, e le corsie (avanti, indietro, dei bus avanti e indietro); None senza corsie.
    `sede`: (sinistra, destra) in metri, i bordi di `sedeCorsie`."""
    hl, hr = sede if sede else (R.W[k] / 2, R.W[k] / 2)
    cs, ls = corsie(R.W[k], R.codice.get(k), R.archi[k][5], sede)
    n = len(ls)
    if not n:
        return None
    w = (hl + hr) / n if ls[0][1] and ls[-1][1] else min((hl + hr) / n, CORSIA_MAX)
    return ls[0][2] - w / 2, ls[-1][2] + w / 2, cs


CONTROLLI = {
    'stalli_fuori_asfalto': "stalli che non stanno tutti sull'asfalto della pianta delle strade",
    'stalli_sulle_corsie': "stalli sulle corsie del loro arco o di un altro, o che non lasciano la larghezza che serve alle corsie",
    'stalli_agli_incroci': 'stalli negli incroci, nei gomiti o sulle strisce pedonali',
    'stalli_alle_fermate': 'stalli nella zona di fermata dei bus (ingresso, bus fermo, uscita)',
    'stalli_sui_passi_carrai': 'stalli davanti a un passo carraio o a un ingresso di parcheggio di OSM',
    'stalli_sulla_sede_del_tram': 'stalli sulla sede del tram',
    'stalli_sovrapposti': 'stalli di archi diversi uno sopra l\'altro',
    'stalli_su_archi_non_ammessi': 'stalli su archi pedonali, in quota, in rotatoria, su ponti, in galleria o riservati ai bus',
}
ZONA = {'incrocio': 'stalli_agli_incroci', 'curva': 'stalli_agli_incroci', 'strisce': 'stalli_agli_incroci',
        'fermata': 'stalli_alle_fermate', 'passo carraio': 'stalli_sui_passi_carrai', 'ingresso di un parcheggio': 'stalli_sui_passi_carrai'}


def controlla(M, voci, sedi, S=None):
    """I casi dei controlli sugli stalli della mappa: {controllo: [{'cosa', 'via', 'arco', 'x', 'z'}]}. Guarda gli
    stalli scritti nella mappa, uno per uno, contro la rete, la pianta e i dati di oggi: vale anche se la mappa o i
    dati sono cambiati dopo il calcolo."""
    if S is None:
        luoghi, suolo, dbgt, vie = leggi_dati()
        S = Sosta(M, luoghi, dbgt, vie, suolo)
    R = S.R
    casi = {k: [] for k in CONTROLLI}
    sede = {k: (a / 100, b / 100) for k, a, b in sedi}
    rett, info = [], []

    def caso(controllo, cosa, k, x, z):
        casi[controllo].append({'cosa': cosa, 'via': M['names'][R.archi[k][4]] or 'via senza nome', 'arco': k, 'x': round(x, 1), 'z': round(z, 1)})

    for k, lato, tipo, _fonte, d0, d1, s0, n in voci:
        d0, d1, s0 = d0 / 100, d1 / 100, s0 / 100
        passo = STALLO[tipo][0]
        sg = 1 if lato == 1 else -1
        mx, mz = R.punto(k, s0 + n * passo / 2, sg * (d0 + d1) / 2)
        if not R.ammesso(k):
            caso('stalli_su_archi_non_ammessi', 'arco non ammesso', k, mx, mz)
        # corsie del proprio arco, con i bordi scritti nella mappa
        bc, bc0 = bordi_corsie(R, k, sede.get(k)), bordi_corsie(R, k)
        h = sede.get(k, (R.W[k] / 2, R.W[k] / 2))
        if bc and (bc[2] != bc0[2] or h[0] + h[1] < R.bisogno(k) - 0.011 and min(h) < R.W[k] / 2 - 0.011):
            caso('stalli_sulle_corsie', 'le corsie non hanno la larghezza che serve', k, mx, mz)
        elif d0 < h[lato] - 0.011 or (bc and (-d0 > bc[0] + 0.011 if lato == 0 else d0 < bc[1] - 0.011)):
            caso('stalli_sulle_corsie', "sulle corsie dell'arco", k, mx, mz)
        for i in range(n):
            a = s0 + i * passo
            cx, cz = R.punto(k, a + passo / 2, sg * (d0 + d1) / 2)
            g = S.rett(k, lato, a, tipo, d0 + 0.05, d1 - 0.05)
            perche = S.fuori_posto(k, lato, tipo, a, d0, d1, g)
            if perche:
                caso({'sulla sede del tram': 'stalli_sulla_sede_del_tram', "non sta tutto sull'asfalto": 'stalli_fuori_asfalto',
                      'nella zona di una fermata': 'stalli_alle_fermate'}.get(perche, 'stalli_sulle_corsie'), perche, k, cx, cz)
            for za, zb, perche in R.libero.get((k, lato), ()):
                if a < zb - 0.011 and a + passo > za + 0.011:
                    caso(ZONA[perche], perche, k, cx, cz)
                    break
            if a < -0.011 or a + passo > R.L[k] + 0.011:
                caso('stalli_agli_incroci', "oltre i capi dell'arco", k, cx, cz)
            rett.append(g)
            info.append((k, lato, cx, cz))
    if rett:
        a, b = STRtree(rett).query(rett, predicate='intersects')
        for i, j in zip(a.tolist(), b.tolist()):
            if i < j and info[i][:2] != info[j][:2] and rett[i].intersection(rett[j]).area > 0.1:
                caso('stalli_sovrapposti', f'con uno stallo dell\'arco {info[j][0]}', info[i][0], info[i][2], info[i][3])
    return casi


def rapporto(M, elenco=False, aggiorna=False):
    """Rapporto sugli stalli scritti nella mappa e controlli a zero, caso per caso contro data/eccezioni/sosta.json.
    Restituisce (valori, casi, righe degli errori)."""
    from eccezioni import Elenco, chiave
    voci, sedi = M.get('stalli'), M.get('sedeCorsie')
    if voci is None or sedi is None:
        return {}, {}, ['La mappa non ha gli stalli (stalli, sedeCorsie): va rigenerata con scripts/rigenera_mappa.sh']
    print(f'Sosta lungo le strade: {len(voci)} file, {sum(v[7] for v in voci)} stalli su {len({v[0] for v in voci})} archi; '
          f'corsie strette dagli stalli su {len(sedi)} archi')
    print('\n'.join(riassunto(voci)))
    casi = controlla(M, voci, sedi)
    E = Elenco(ECCEZIONI, 'python3 scripts/sosta.py --aggiorna')
    for k in CONTROLLI:
        E.confronta(k, [chiave(f"{c['cosa']}, {c['via']}", c['x'], c['z']) for c in casi[k]], TOLL, aggiorna)
        segno, esito = E.segno(k)
        print(f"  {segno} {k.replace('_', ' ')}: {len(casi[k])} ({esito})")
        if elenco:
            for c in casi[k][:60]:
                print('      ' + ', '.join(f'{a}={b}' for a, b in c.items()))
    if aggiorna:
        E.scrivi()
    return {k: len(v) for k, v in casi.items()}, casi, E.errori()


def conti(M):
    """Le righe della copertura di docs/sosta.md: per fonte quante vie OSM, archi e metri di cordolo hanno stalli."""
    nodi, archi = osm_rete.leggi_rete(M)
    A = osm_rete.Aggancio(nodi, archi, M['names'], osm_rete.leggi_vie()[0])
    km = sum(math.dist(nodi[e[0]], nodi[e[1]]) for e in archi if e[2] != 8) / 1000
    vie_rete = len({w for k, w in enumerate(A.arco_via) if w is not None and archi[k][2] != 8})
    voci = M['stalli']
    righe = [f'  rete carrabile: {vie_rete} vie OSM, {sum(1 for e in archi if e[2] != 8)} archi, {km:.0f} km (due lati: {2 * km:.0f} km di cordolo)']
    for nome, vs in [(NOME_FONTE[f], [v for v in voci if v[3] == f]) for f in NOME_FONTE] + [('tutte le fonti', voci)]:
        metri = sum(v[7] * STALLO[v[2]][0] for v in vs)
        righe.append(f"  {nome}: {len({A.arco_via[v[0]] for v in vs})} vie, {len({v[0] for v in vs})} archi, {len(vs)} file, "
                     f"{sum(v[7] for v in vs)} stalli, {metri / 1000:.1f} km di cordolo ({100 * metri / (2000 * km):.1f}%)")
    return righe


def scrivi(percorso, voci, sedi):
    """Riscrive `stalli` e `sedeCorsie` nella rete che c'è, senza rigenerarla (per provare)."""
    rete = json.load(open(percorso, encoding='utf-8'))
    rete['stalli'], rete['sedeCorsie'], rete['stalliTipi'] = voci, sedi, tipi()
    with open(percorso, 'w', encoding='utf-8') as f:
        json.dump(rete, f, ensure_ascii=False, separators=(',', ':'))


def main():
    import argparse
    import time
    import aree_mappa
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('mappa', nargs='?', default=os.path.join(RADICE, 'src', 'data', 'padova-map.json'))
    ap.add_argument('--elenco', action='store_true', help='elenca i casi dei controlli, con le coordinate del gioco')
    ap.add_argument('--aggiorna', action='store_true', help='riscrive data/eccezioni/sosta.json dai casi di oggi')
    ap.add_argument('--calcola', action='store_true', help='rifà il calcolo e dice cosa scarta, senza scrivere')
    ap.add_argument('--scrivi', action='store_true', help='rifà il calcolo e lo scrive nella mappa che c\'è (per provare)')
    ap.add_argument('--json', help='con --calcola o --scrivi: scrive qui le voci calcolate')
    ap.add_argument('--conti', action='store_true', help='quante vie, archi e metri di cordolo copre ogni fonte')
    args = ap.parse_args()
    M = aree_mappa.load(args.mappa)
    if args.calcola or args.scrivi:
        t0 = time.time()
        voci, sedi, S = calcola(M)
        print(f'Calcolo in {time.time() - t0:.0f} s: {len(voci)} file, {sum(v[7] for v in voci)} stalli su {len({v[0] for v in voci})} archi, '
              f'corsie strette su {len(sedi)} archi')
        print('\n'.join(riassunto(voci)))
        for (fonte, perche), n in sorted(S.scarti.items()):
            print(f'  scartati, {NOME_FONTE[fonte]}: {n} {perche}')
        if args.json:
            json.dump({'stalli': voci, 'sedeCorsie': sedi}, open(args.json, 'w'))
        if args.scrivi:
            scrivi(args.mappa, voci, sedi)
            M['stalli'], M['sedeCorsie'] = voci, sedi
        else:
            return
    if args.conti and M.get('stalli') is not None:
        print('\n'.join(conti(M)))
    _valori, _casi, errori = rapporto(M, args.elenco, args.aggiorna)
    if errori:
        print('\n'.join(errori))
        sys.exit(1)


if __name__ == '__main__':
    main()
