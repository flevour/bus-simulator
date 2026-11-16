#!/usr/bin/env python3
"""Raccordi di corsia agli incroci, calcolati nella build (#112, docs/raccordi.md).

Per ogni nodo della rete dice da quale corsia a quale corsia si passa, con quale curva e con quale raggio, e quali
mezzi ci passano (auto, bus da 12 m, snodato da 18 m). Dove non c'è un raccordo non si passa. Rispetta sensi unici,
corsie riservate, frecce a terra (turnLanes) e svolte vietate e obbligate di OSM (svolte). Ogni curva è provata contro
la pianta delle strade della mappa: resta sull'asfalto, fuori da isole e marciapiedi, e non entra nella sede del tram
dove le due vie non la toccano.

Le corsie sono quelle che il gioco disegna (laneLayout di src/data/padova.js, rifatta qui in corsie_arco:
tests/raccordi.spec.js controlla che le due diano lo stesso asse). Formato del campo e regole in docs/raccordi.md.

Uso:
    python3 scripts/raccordi.py              # rapporto e controlli sulla mappa che c'è
    python3 scripts/raccordi.py --elenco     # con i casi uno per uno
    python3 scripts/raccordi.py --aggiorna   # riscrive data/eccezioni/raccordi.json dai casi di oggi
    python3 scripts/raccordi.py --scrivi     # ricalcola il campo e lo scrive nella mappa che c'è (per provare: quello
                                             # pubblicato esce da scripts/rigenera_mappa.sh)
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RADICE, 'scripts'))
MAPPA = os.path.join(RADICE, 'src', 'data', 'padova-map.json')

# classi di mezzo: bit della maschera di un raccordo
CLASSI = ('auto', 'bus12', 'snodato')
AUTO, BUS12, SNODATO = 1, 2, 4
BUS = BUS12 | SNODATO
# raggio minimo (m) del percorso che il mezzo segue con il centro dell'asse posteriore. Bus da 12 m: quello del gioco
# (src/bus/bus.js: passo 5,9 m, sterzo massimo 0,62 rad: 5,9 / tan 0,62 = 8,26 m). Snodato: la stessa motrice, con lo
# snodo che a regime non supera 0,87 rad (ART.maxAngle: ralla 1,8 m dietro l'asse, asse del rimorchio 5,2 m dietro la
# ralla) da 8,4 m in su. Auto: diametro di volta tra marciapiedi di 10,5 m, passo 2,6 m, carreggiata 1,5 m:
# radice(5,25² - 2,6²) - 0,75 = 3,8 m
R_MIN = {AUTO: 3.8, BUS12: 8.3, SNODATO: 8.5}
# metà della sagoma (m): quanto asfalto serve dalla parte interna della curva
MEZZA = {AUTO: 0.9, BUS: 1.275}
GIOCO = 0.05  # m: una curva può stare più vicina al bordo dell'asfalto di quanto ci stanno le corsie che unisce, di tanto
LANE_MIN, BUS_LANE_MIN, LANE_MAX = 2.6, 3.0, 3.75  # come in src/data/padova.js
CORTO = 0.3  # m: gli archi più corti non esistono nemmeno per il gioco (buildNetwork)
T_MAX = 30.0  # m: quanto di un arco può prendere un raccordo
R_MAX = 200.0  # m: raggio oltre il quale non si va (curve appena accennate)
R_SVOLTA = 15.0  # m: raggio a cui punta una svolta vera
FRECCIA = 1.5  # m: di quanto un raccordo largo può tagliare lo spigolo delle due corsie
DIRITTO = math.radians(0.5)  # sotto questo angolo, con le corsie allineate, il raccordo è un punto
PASSO = 0.75  # m tra i punti provati di una curva
ATTORNO = 80.0  # m: asfalto guardato attorno al nodo
RISERVA = 0.15  # m di corsia lasciati liberi da una curva a due vertici
ESSE = 3.0  # m per parte che si tengono per una esse tra due corsie quasi parallele
LARGHE = (0.75, 1.5, 2.5, 3.5)  # m: di quanto una svolta larga passa oltre lo spigolo delle due corsie
VIA_MAX, VIA_LUNGO = 4, 24.0  # archi corti che un raccordo può scavalcare, e quanti metri in tutto
TRAM_LANE = 2.1  # m: metà della sede di un binario (street_surfaces.TRAM_LANE)


def croce(a, b):
    return a[0] * b[1] - a[1] * b[0]


def destra(d):
    """Normale a destra di chi va nella direzione d (z verso sud): come rx, rz di Traffic.laneGeom."""
    return (-d[1], d[0])


# ---------------------------------------------------------------- corsie

def corsie_arco(larghezza, senso, codice, sede=None):
    """Corsie di un arco nel verso a -> b, da sinistra a destra: [(verso, dei bus, distanza dall'asse verso destra)].
    È laneLayout di src/data/padova.js, con gli stessi conti nello stesso ordine; codice è quello di MAP.lanes
    (lane_code di build_map.py) o None se OSM non dice niente; sede è (sinistra, destra) in metri dove gli stalli
    stringono la carreggiata (`sedeCorsie` nella mappa, scripts/sosta.py): le corsie stanno lì dentro."""
    hl, hr = sede if sede else (larghezza / 2, larghezza / 2)
    larghezza = hl + hr
    bf = bb = 0
    if codice is not None:
        nf, nb, bf, bb = codice & 7, (codice >> 3) & 7, (codice >> 6) & 1, (codice >> 7) & 1
    elif senso:
        nf, nb = (1, 0) if senso > 0 else (0, 1)
    else:
        nf = nb = 1
    while nf + nb > 1 and (nf - bf + nb - bb) * LANE_MIN + (bf + bb) * BUS_LANE_MIN > larghezza:
        gf, gb = nf - bf, nb - bb
        if gf > 1 or gb > 1:
            if gf >= gb:
                nf -= 1
            else:
                nb -= 1
        elif bf or bb:
            if bf:
                bf, nf = 0, nf - 1
            else:
                bb, nb = 0, nb - 1
        else:
            nf = nb = 0
    lanes = [(-1, i < bb) for i in range(nb)] + [(1, i >= nf - bf) for i in range(nf)]
    n = len(lanes)
    if not n:
        return []
    lb, rb = lanes[0][1], lanes[-1][1]
    w = larghezza / n if lb and rb else min(larghezza / n, LANE_MAX)
    x0 = -hl if lb else hr - n * w if rb else min(max((-n * w) / 2, -hl), hr - n * w)
    return [(d, bus, x0 + (i + 0.5) * w) for i, (d, bus) in enumerate(lanes)]


class Rete:
    """Nodi, archi e corsie di marcia della mappa, come li vede il gioco."""

    def __init__(self, M):
        N, E = M['nodes'], M['edges']
        self.nodi = list(zip(N[0::2], N[1::2]))
        self.archi = [E[i:i + 8] for i in range(0, len(E), 8)]
        self.nomi = M['names']
        self.lung = [math.dist(self.nodi[e[0]], self.nodi[e[1]]) for e in self.archi]
        cod = dict(zip(M.get('lanes', [])[0::2], M.get('lanes', [])[1::2]))
        self.frecce = {k: (f, b) for k, f, b in M.get('turnLanes', [])}
        self.attorno = defaultdict(list)  # nodo -> archi carrabili
        for k, e in enumerate(self.archi):
            if e[2] != 8 and self.lung[k] >= CORTO:
                self.attorno[e[0]].append(k)
                self.attorno[e[1]].append(k)
        # dove gli stalli stringono la carreggiata le corsie stanno tra i bordi scritti dalla build (#111)
        sede = {k: (sx / 100, dx / 100) for k, sx, dx in M.get('sedeCorsie', [])}
        self.layout = [corsie_arco(e[3], 1 if e[5] & 1 else -1 if e[5] & 2 else 0, cod.get(k), sede.get(k)) for k, e in enumerate(self.archi)]
        self._marcia = {}

    def senso(self, k):
        f = self.archi[k][5]
        return 1 if f & 1 else -1 if f & 2 else 0

    def chi(self, k, avanti):
        """Maschera di chi può percorrere l'arco nel verso: le auto non entrano nelle corsie riservate (Traffic.allowed),
        i bus anche in controsenso dove la via lo ammette (busCan di src/game/routes.js)."""
        e = self.archi[k]
        if e[2] == 8 or self.lung[k] < CORTO:
            return 0
        s = self.senso(k)
        nel_verso = not s or (s > 0) == avanti
        return (AUTO if nel_verso and not e[5] & 32 else 0) | (BUS if nel_verso or e[5] & 256 else 0)

    def marcia(self, k, avanti):
        """Corsie di marcia dell'arco nel verso, da sinistra a destra di chi va: [(distanza dall'asse a destra di chi
        va, maschera, dei bus)]. Sono quelle disegnate (laneLayout); dove in un verso percorribile non ce ne sono (doppi
        sensi stretti senza mezzeria, controsenso dei soli bus) una corsia sola dove oggi passano i mezzi: a un quarto
        della carreggiata, o in asse sui sensi unici (Traffic.laneGeom, laneLat di src/world/buses.js)."""
        key = (k, avanti)
        if key in self._marcia:
            return self._marcia[key]
        chi, e = self.chi(k, avanti), self.archi[k]
        out = []
        if chi:
            d = 1 if avanti else -1
            mie = [(off if avanti else -off, BUS if bus else chi, bus) for dd, bus, off in self.layout[k] if dd == d]
            out = sorted(mie, key=lambda c: c[0])
            # le corsie dei bus non valgono per le auto; un verso con le sole corsie dei bus resta dei bus
            if not out:
                s = self.senso(k)
                out = [((0.0 if e[3] < 8 else e[3] / 2 - 2) if s else e[3] / 4, chi, False)]
        self._marcia[key] = out
        return out


# ---------------------------------------------------------------- pianta delle strade

class Pianta:
    """Asfalto, isole, marciapiedi e sede del tram della mappa, da guardare attorno a un nodo."""

    def __init__(self, M, binari):
        import numpy as np
        import shapely
        from shapely import STRtree
        from shapely.geometry import LineString, Polygon
        self.np, self.sh = np, shapely
        S = M['surfaces']
        self.T = S['tile']

        def poli(anelli):
            pts = lambda r: [(r[i], r[i + 1]) for i in range(0, len(r), 2)]
            p = Polygon(pts(anelli[0]), [pts(h) for h in anelli[1:] if len(h) >= 6])
            return p if p.is_valid else p.buffer(0)
        self.celle = {}
        for c in S['cells']:
            self.celle[(c[0], c[1])] = [[poli(a) for a in strato] for strato in (c[2], c[3], c[4])]
        self.su = [poli(a) for a in S.get('up') or []]
        self.su_tree = STRtree(self.su) if self.su else None
        # sede del tram, come in street_surfaces.surfaces: i binari allargati, con i varchi stretti tra due binari chiusi
        sedi = [LineString(t).buffer(TRAM_LANE, quad_segs=2) for t in binari if len(t) >= 2]
        self.sede = shapely.union_all(sedi).buffer(1.5, quad_segs=2).buffer(-1.5, quad_segs=2) if sedi else Polygon()
        shapely.prepare(self.sede)

    def sede_attorno(self, x, z):
        """La sede del tram nel quadrato attorno al punto, o None se non ce n'è."""
        q = self.sh.box(x - ATTORNO, z - ATTORNO, x + ATTORNO, z + ATTORNO)
        if not self.sh.intersects(self.sede, q):
            return None
        g = self.sh.intersection(self.sede, q)
        self.sh.prepare(g)
        return g

    def attorno(self, x, z, strato=0):
        """L'asfalto (strato 0), i marciapiedi (1) o le isole (2) nel quadrato di ATTORNO metri attorno al punto."""
        sh, T = self.sh, self.T
        q = sh.box(x - ATTORNO, z - ATTORNO, x + ATTORNO, z + ATTORNO)
        parti = []
        for ix in range(math.floor((x - ATTORNO) / T), math.floor((x + ATTORNO) / T) + 1):
            for iz in range(math.floor((z - ATTORNO) / T), math.floor((z + ATTORNO) / T) + 1):
                parti += self.celle.get((ix, iz), ((), (), ()))[strato]
        if strato == 0 and self.su_tree is not None:
            parti += [self.su[i] for i in self.su_tree.query(q)]
        if not parti:
            return sh.Polygon()
        # solo i poligoni: il taglio sul bordo del quadrato lascia anche linee e punti
        g = sh.get_parts(sh.get_parts(sh.union_all(sh.intersection(self.np.array(parti, dtype=object), q))))
        g = [p for p in g if p.geom_type == 'Polygon']
        return sh.multipolygons(g) if g else sh.Polygon()


# ---------------------------------------------------------------- curve

def campiona(d_in, verts, R, d_out):
    """Punti della curva di un raccordo: la spezzata che arriva lungo d_in, passa per i vertici verts ed esce lungo
    d_out, con un arco di raggio R a ogni vertice. Restituisce (punti, tangente prima del primo vertice, tangente dopo
    l'ultimo, valida): non è valida se due archi si sovrappongono. Con R = 0 la curva è il primo vertice."""
    if R <= 0:
        return [verts[0]], 0.0, 0.0, len(verts) == 1
    dirs = [d_in]
    for a, b in zip(verts, verts[1:]):
        m = math.dist(a, b)
        if m < 1e-6:
            return [verts[0]], 0.0, 0.0, False
        dirs.append(((b[0] - a[0]) / m, (b[1] - a[1]) / m))
    dirs.append(d_out)
    pts, tt = [], []
    for v, a, b in zip(verts, dirs, dirs[1:]):
        phi = math.atan2(croce(a, b), a[0] * b[0] + a[1] * b[1])
        if abs(phi) < 1e-6:
            tt.append(0.0)
            arco = [v]
        else:
            t = R * math.tan(abs(phi) / 2)
            tt.append(t)
            s = 1.0 if phi > 0 else -1.0
            rn = destra(a)
            cx, cz = v[0] - a[0] * t + s * R * rn[0], v[1] - a[1] * t + s * R * rn[1]
            n = max(2, math.ceil(abs(phi) * R / PASSO), math.ceil(abs(phi) / 0.2))
            arco = []
            for i in range(n + 1):
                p = phi * i / n
                c, sn = math.cos(p), math.sin(p)
                arco.append((cx - s * R * (rn[0] * c - a[0] * sn), cz - s * R * (rn[1] * c - a[1] * sn)))
        if pts:
            # tratto diritto tra un arco e l'altro
            p0, p1 = pts[-1], arco[0]
            m = math.dist(p0, p1)
            for i in range(1, math.ceil(m / PASSO)):
                f = i / math.ceil(m / PASSO)
                pts.append((p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f))
        pts += arco
    valida = all(tt[i] + tt[i + 1] <= math.dist(verts[i], verts[i + 1]) + 1e-6 for i in range(len(verts) - 1))
    return pts, tt[0], tt[-1], valida


# ---------------------------------------------------------------- raccordi di un nodo

SINISTRA, DRITTO, DESTRA_ = 'L', 'T', 'R'
FRECCE = {'left': 'L', 'slight_left': 'L', 'sharp_left': 'L', 'through': 'T', 'merge_to_left': 'T', 'merge_to_right': 'T',
          'right': 'R', 'slight_right': 'R', 'sharp_right': 'R'}
VIETA, OBBLIGO, ECCETTO_BUS = 4, 4, 1  # tipi di svolte: sotto 4 vietano, da 4 obbligano (osm_rete.SVOLTE)


class Raccordi:
    """Calcola i raccordi di tutti i nodi. Ogni raccordo è un dict: nodo, da, a (archi), cda, ca (corsie, da sinistra),
    classi (maschera), r (m), v (vertici, m), esito."""

    def __init__(self, M, binari, pianta=None):
        self.M = M
        self.R = Rete(M)
        self.P = pianta or Pianta(M, binari)
        self.np, self.sh = self.P.np, self.P.sh
        self.divieti = defaultdict(list)  # (nodo, arco da) -> [(arco a, tipo, eccezioni)]
        self.via = 0
        for v in M.get('svolte', []):
            if len(v) > 5:
                self.via += 1
                continue
            self.divieti[(v[0], v[1])].append((v[2], v[3], v[4]))
        # movimenti dei percorsi dei bus: (nodo, arco da, arco a)
        tra = defaultdict(list)
        for k, e in enumerate(self.R.archi):
            tra[(e[0], e[1])].append(k)
            tra[(e[1], e[0])].append(k)
        self.dei_bus = set()
        for l in M['lines']:
            for va in l['variants']:
                ns = va['nodes']
                for x, y, w in zip(ns, ns[1:], ns[2:]):
                    self.dei_bus |= {(y, i, j) for i in tra.get((x, y), ()) for j in tra.get((y, w), ())}
        # movimenti di ogni nodo, corsia per corsia; una corsia è (arco, avanti, corsia da sinistra)
        self.mov, self.dopo, self.prima = {}, defaultdict(list), defaultdict(list)
        for n in sorted(self.R.attorno):
            mm = [self.geometria([(da, self.R.archi[da][1] == n, cda), (a, self.R.archi[a][0] == n, ca)], m) for da, cda, a, ca, m, _th in self.coppie(n)]
            if mm:
                self.mov[n] = mm
            for g in mm:
                self.dopo[g['kin']].append(g)
                self.prima[g['kout']].append(g)
        self.spazio = self.spazi()

    def spazi(self):
        """Quanto di ogni corsia può prendere un raccordo a ciascun capo: {(arco, avanti, corsia, capo): metri}, capo 0
        dove la corsia comincia (ci arrivano i raccordi del nodo prima) e 1 dove finisce (ne partono quelli del nodo
        dopo). I due capi insieme non passano la lunghezza dell'arco, così un raccordo che arriva e uno che parte non
        si sovrappongono mai. A ogni capo va prima quanto serve al raggio minimo di chi ci passa (i bus sui loro
        percorsi), il resto a metà."""
        serve = defaultdict(lambda: [0.0, 0.0])
        for n, mm in self.mov.items():
            for g in mm:
                for r, i in ((R_MIN[AUTO] if g['m'] & AUTO else R_MIN[SNODATO], 0),
                             (R_MIN[SNODATO] if (n, g['kin'][0], g['kout'][0]) in self.dei_bus or not g['m'] & AUTO else R_MIN[AUTO], 1)):
                    # le corsie che si incontrano vicino al nodo: la tangente dell'arco; le altre (quasi parallele, da
                    # raccordare con una esse): qualche metro per parte
                    if g['k'] is not None and abs(g['s']) < 15 and abs(g['u']) < 15:
                        e_in, e_out = max(0.0, r * g['k'] - g['s']), max(0.0, r * g['k'] + g['u'])
                    else:
                        e_in = e_out = ESSE
                    for key, v in ((g['kin'] + (1,), e_in), (g['kout'] + (0,), e_out)):
                        serve[key][i] = max(serve[key][i], min(v, T_MAX))
        out = {}
        for k in range(len(self.R.archi)):
            L = self.R.lung[k]
            for avanti in (True, False):
                for c in range(len(self.R.marcia(k, avanti))):
                    ka, kb = (k, avanti, c, 0), (k, avanti, c, 1)
                    (a1, a2), (b1, b2) = serve.get(ka, (0.0, 0.0)), serve.get(kb, (0.0, 0.0))
                    if ka not in serve or kb not in serve:
                        xa, xb = (L, 0.0) if ka in serve else (0.0, L)
                    elif a2 + b2 <= L:
                        xa = a2 + (L - a2 - b2) / 2
                        xb = L - xa
                    elif a1 + b1 <= L:
                        q = (a2 - a1) + (b2 - b1)
                        xa = a1 + (L - a1 - b1) * ((a2 - a1) / q if q > 0 else 0.5)
                        xb = L - xa
                    else:
                        # non ci stanno tutti e due: il capo che chiede meno ha il suo, l'altro quello che resta (il suo
                        # raccordo scavalcherà l'arco, o non si farà: una svolta a gomito non toglie il posto a chi va diritto)
                        xa = min(a1, L) if a1 <= b1 else L - min(b1, L)
                        xb = L - xa
                    out[ka], out[kb] = min(T_MAX, xa), min(T_MAX, xb)
        return out

    def vietata(self, n, da, a):
        """Maschera di chi non può fare la svolta da -> a nel nodo, per le relazioni di OSM."""
        m = 0
        for verso, tipo, ecc in self.divieti.get((n, da), ()):
            if (verso == a) if tipo < VIETA else (verso != a):
                m |= AUTO if ecc & ECCETTO_BUS else AUTO | BUS
        return m

    def bracci(self, n):
        """Archi carrabili del nodo: (arco, direzione che si allontana dal nodo, arriva in avanti, parte in avanti)."""
        x, z = self.R.nodi[n]
        out = []
        for k in self.R.attorno.get(n, ()):
            e = self.R.archi[k]
            o = self.R.nodi[e[1] if e[0] == n else e[0]]
            L = self.R.lung[k]
            out.append((k, ((o[0] - x) / L, (o[1] - z) / L), e[1] == n, e[0] == n))
        return out

    def coppie(self, n):
        """Movimenti del nodo, corsia per corsia: [(da, corsia da, a, corsia a, maschera, gradi)]."""
        R, br = self.R, self.bracci(n)
        out = []
        for da, u_in, arr, _p in br:
            Lin = R.marcia(da, arr)
            if not Lin:
                continue
            d_in = (-u_in[0], -u_in[1])
            uscite = []
            for a, u_out, _a, par in br:
                Lout = R.marcia(a, par)
                if a == da or not Lout:
                    continue
                chi = R.chi(da, arr) & R.chi(a, par) & ~self.vietata(n, da, a)
                if chi:
                    uscite.append((math.atan2(croce(d_in, u_out), d_in[0] * u_out[0] + d_in[1] * u_out[1]), a, Lout, chi))
            if not uscite:
                continue
            uscite.sort()
            # dove va ogni uscita: diritto la più allineata (entro 45 gradi, o se è la sola), le altre a sinistra o destra
            jt = min(range(len(uscite)), key=lambda j: abs(uscite[j][0]))
            if len(uscite) > 1 and abs(uscite[jt][0]) > math.radians(45):
                jt = None
            dove = [DRITTO if j == jt else (SINISTRA if (j < jt if jt is not None else uscite[j][0] < 0) else DESTRA_) for j in range(len(uscite))]
            gen = [i for i, c in enumerate(Lin) if not c[2]]
            fr = (R.frecce.get(da) or ('', ''))[0 if arr else 1]
            fr = [set(t.split(';')) for t in fr.split('|')] if fr else []
            if len(fr) != len([1 for dd, _b, _o in R.layout[da] if dd == (1 if arr else -1)]) or len(fr) != len(Lin):
                fr = []

            def regola(i, d):
                if d == DRITTO:
                    return True
                if d == SINISTRA:
                    return i == (gen[0] if gen else 0)
                return i == len(Lin) - 1 or (gen and i == gen[-1])

            def ammessa(i, d):
                if fr and not fr[i] & {'none', ''}:
                    return d in {FRECCE.get(t) for t in fr[i]}
                return regola(i, d)
            amm = {(i, j) for i in range(len(Lin)) for j in range(len(uscite)) if ammessa(i, dove[j])}
            for j in range(len(uscite)):  # un'uscita che le frecce non danno a nessuna corsia
                if not any((i, j) in amm for i in range(len(Lin)) if Lin[i][1] & uscite[j][3]):
                    amm |= {(i, j) for i in range(len(Lin)) if regola(i, dove[j])}
            for i in range(len(Lin)):  # una corsia senza uscite per chi la percorre: le prende tutte
                for bit in (AUTO, BUS12, SNODATO):
                    if Lin[i][1] & bit and not any((i, j) in amm and self._verso(Lin, i, uscite[j], dove[j], gen, bit) for j in range(len(uscite))):
                        amm |= {(i, j) for j in range(len(uscite))}
            for i, j in sorted(amm):
                th, a, Lout, chi = uscite[j]
                for ca in self._verso(Lin, i, uscite[j], dove[j], gen, 7):
                    m = Lin[i][1] & Lout[ca][1] & chi
                    if m:
                        out.append((da, i, a, ca, m, th))
        return out

    @staticmethod
    def _verso(Lin, i, uscita, dove, gen, bit):
        """Corsie dell'uscita che la corsia i prende, tra quelle che il mezzo bit può percorrere."""
        _th, _a, Lout, chi = uscita
        go = [j for j, c in enumerate(Lout) if not c[2]]
        bo = [j for j, c in enumerate(Lout) if c[2]]
        if Lin[i][2]:  # dalla corsia dei bus
            t = ([bo[-1]] if bo else go[-1:]) if dove != SINISTRA else (go[:1] or bo[:1])
        else:
            r = len(gen) - 1 - gen.index(i)  # posto da destra tra le corsie non riservate
            if dove == DRITTO:
                if go:
                    jg = len(go) - 1 - r
                    t = [go[max(jg, 0)]]
                    if i == gen[0] and jg > 0:
                        t += go[:jg]  # le corsie in più a sinistra si prendono dalla più a sinistra
                else:
                    t = bo[-1:]
                if r == 0 and bo and go:
                    t.append(bo[-1])  # la corsia dei bus che comincia: dalla più a destra
            elif dove == SINISTRA:
                t = go[:1] or bo[:1]
            else:
                t = go[-1:] + (bo[-1:] if r == 0 else [])
        return [j for j in t if Lin[i][1] & Lout[j][1] & chi & bit]

    # -------- curva di un movimento

    def prepara(self, n):
        x, z = self.R.nodi[n]
        A = self.P.attorno(x, z)
        self.sh.prepare(A)
        self._A, self._B = A, A.boundary
        self._sede = self.P.sede_attorno(x, z)
        self._fuori_sede = False

    def margine(self, pts):
        """(spazio minimo dal bordo dell'asfalto lungo i punti, spazio ai due capi); negativo se un punto è fuori."""
        P = self.sh.points(self.np.array(pts))
        d = self.sh.distance(self._B, P)
        dentro = self.sh.contains(self._A, P)
        d = self.np.where(dentro, d, -d)
        return float(d.min()), min(float(d[0]), float(d[-1]))

    def nella_sede(self, pts):
        """La curva entra nella sede del tram."""
        return self._sede is not None and len(pts) > 1 and bool(self.sh.intersects(self._sede, self.sh.linestrings(pts)))

    def tocca_sede(self, g):
        """Le due vie del movimento toccano la sede del tram attorno al nodo: è un incrocio col tram, o una via che
        porta i binari. Lì un raccordo può attraversarla; altrove no."""
        if self._sede is None:
            return False
        R = self.R
        assi = [[R.nodi[R.archi[c[0]][0]], R.nodi[R.archi[c[0]][1]]] for c in g['cat']]
        for P, d, A, verso in ((g['Pi'], g['d_in'], self.spazio[g['kin'] + (1,)], -1), (g['Po'], g['d_out'], self.spazio[g['kout'] + (0,)], 1)):
            assi.append([P, (P[0] + verso * d[0] * max(A, 8.0), P[1] + verso * d[1] * max(A, 8.0))])
        return bool(self.sh.intersects(self._sede, self.sh.multilinestrings(assi)))

    def passa(self, pts, mezza):
        """La curva sta sull'asfalto, lontana dal bordo quanto metà della sagoma (o quanto le corsie che unisce, se ci
        stanno più vicine), e fuori dalla sede del tram dove le due vie non la toccano."""
        m, capi = self.margine(pts)
        return m >= min(mezza, capi) - GIOCO and not (self._fuori_sede and self.nella_sede(pts))

    def geometria(self, cat, m):
        """Le corsie ai due capi di un raccordo: cat è la catena delle corsie che percorre (la prima e l'ultima, e in
        mezzo quelle degli archi corti scavalcati), m la maschera di chi può. Dà il punto di ciascuna corsia accanto al
        suo nodo (Pi, Po), le direzioni, e dove si incontrano (s, u: metri lungo ciascuna dal suo punto; k: tangente di
        metà angolo; None se sono parallele)."""
        R = self.R
        (da, av_in, cda), (a, av_out, ca) = cat[0], cat[-1]
        ea, eb = R.archi[da], R.archi[a]
        n_in, n_out = ea[1] if av_in else ea[0], eb[0] if av_out else eb[1]
        Ni, No = R.nodi[n_in], R.nodi[n_out]
        oa, ob = R.nodi[ea[0] if av_in else ea[1]], R.nodi[eb[1] if av_out else eb[0]]
        d_in = ((Ni[0] - oa[0]) / R.lung[da], (Ni[1] - oa[1]) / R.lung[da])
        d_out = ((ob[0] - No[0]) / R.lung[a], (ob[1] - No[1]) / R.lung[a])
        off_in, off_out = R.marcia(da, av_in)[cda][0], R.marcia(a, av_out)[ca][0]
        ri, ro = destra(d_in), destra(d_out)
        Pi = (Ni[0] + ri[0] * off_in, Ni[1] + ri[1] * off_in)
        Po = (No[0] + ro[0] * off_out, No[1] + ro[1] * off_out)
        cr = croce(d_in, d_out)
        w = (Po[0] - Pi[0], Po[1] - Pi[1])
        g = {'nodo': n_in, 'cat': cat, 'm': m, 'th': math.atan2(cr, d_in[0] * d_out[0] + d_in[1] * d_out[1]), 'd_in': d_in, 'd_out': d_out,
             'Pi': Pi, 'Po': Po, 'lato': croce(d_in, w), 'kin': cat[0], 'kout': cat[-1], 's': 0.0, 'u': 0.0, 'k': None,
             'via': sum(R.lung[c[0]] for c in cat[1:-1])}
        if abs(cr) > 1e-3:
            g['s'], g['u'], g['k'] = croce(w, d_out) / cr, croce(w, d_in) / cr, math.tan(abs(g['th']) / 2)
        return g

    def curva(self, g):
        """Le curve di un movimento: ([(vertici, raggio, maschera di chi ci passa per raggio e asfalto)], esito). Di
        solito una; due quando sul percorso di una linea i bus hanno bisogno di una svolta più larga di quella delle
        auto. Esiti: ok, stretto (non c'è posto per il raggio minimo di chi ci deve passare), fuori (non sta
        sull'asfalto nemmeno con il raggio minimo); se non è ok la curva è quella che ci va più vicino."""
        d_in, d_out, Pi, Po, th = g['d_in'], g['d_out'], g['Pi'], g['Po'], g['th']
        Ai, Ao = self.spazio[g['kin'] + (1,)], self.spazio[g['kout'] + (0,)]
        minimo = R_MIN[AUTO] if g['m'] & AUTO else R_MIN[BUS12]
        self._fuori_sede = not self.tocca_sede(g)
        if abs(th) <= DIRITTO and abs(g['lato']) < 0.03 and not g['via']:
            v = (round((Pi[0] + Po[0]) / 2, 2), round((Pi[1] + Po[1]) / 2, 2))
            return [([v], 0.0, AUTO | BUS)], 'ok' if self.passa([v], MEZZA[BUS]) else 'fuori'

        def due(p, q):
            """Curva con un vertice sulla corsia d'arrivo a p metri dal suo punto e uno su quella d'uscita a q: i
            vertici e il raggio più grande che ci sta, o None."""
            v1, v2 = (round(Pi[0] + d_in[0] * p, 2), round(Pi[1] + d_in[1] * p, 2)), (round(Po[0] + d_out[0] * q, 2), round(Po[1] + d_out[1] * q, 2))
            m = math.dist(v1, v2)
            if m < 0.2:
                return None
            dm = ((v2[0] - v1[0]) / m, (v2[1] - v1[1]) / m)
            k1 = math.tan(abs(math.atan2(croce(d_in, dm), d_in[0] * dm[0] + d_in[1] * dm[1])) / 2)
            k2 = math.tan(abs(math.atan2(croce(dm, d_out), dm[0] * d_out[0] + dm[1] * d_out[1])) / 2)
            if k1 > 1.6 or k2 > 1.6:
                return None
            # con un po' di riserva: i vertici si scrivono al centimetro, e con due vertici la direzione del tratto di
            # mezzo (e con lei le tangenti) cambia di poco
            lim = ([R_MAX] + ([(Ai + p - RISERVA) / k1] if k1 > 1e-9 else []) + ([(Ao - q - RISERVA) / k2] if k2 > 1e-9 else [])
                   + ([0.97 * m / (k1 + k2)] if k1 + k2 > 1e-9 else []))
            return ([v1, v2], min(lim)) if min(lim) > 0 else None
        prove = []  # (vertici, raggio massimo)
        s = u = None
        if g['k'] is not None:
            s, u, k = g['s'], g['u'], g['k']
            tmax = min(Ai + s, Ao - u)
            if tmax > 0:
                cap = min(R_MAX, max(R_SVOLTA, FRECCIA / (1 / math.cos(abs(th) / 2) - 1))) if abs(th) < 3.1 else R_SVOLTA
                prove.append(([(round(Pi[0] + d_in[0] * s, 2), round(Pi[1] + d_in[1] * s, 2))], min(cap, tmax / k)))
        # due vertici, uno prima del nodo e uno dopo: corsie quasi parallele che non si incontrano, o che si incontrano
        # fuori dallo spazio che c'è. Con gli archi scavalcati in mezzo anche oltre il primo nodo e prima dell'ultimo
        Lv = g['via']
        pp = [-min(Ai, 16.0) / 2, -min(Ai, 16.0) / 4] + ([0.0, Lv / 2, Lv] if Lv else [])
        qq = [min(Ao, 16.0) / 2, min(Ao, 16.0) / 4] + ([0.0, -Lv / 2, -Lv] if Lv else [])
        prove += [c for c in (due(p, q) for p, q in ([(a, b) for a in pp for b in qq] if Lv else zip(pp, qq))) if c]
        bus_serve = self.bus_serve(g)

        def scegli(prove, solo_bus=False):
            meglio = None
            for verts, rmax in prove:
                e = self._adatta(d_in, verts, rmax, d_out, solo_bus)
                if e and (meglio is None or (e[1].bit_count(), e[0]) > (meglio[2].bit_count(), meglio[1])):
                    meglio = (verts, e[0], e[1])
                if meglio and meglio[2] == AUTO | BUS and len(meglio[0]) == 1:
                    break
            return meglio
        meglio = scegli(prove)
        larghe = []
        if s is not None and abs(th) > math.radians(20) and (meglio is None or (bus_serve and not meglio[2] & BUS)):
            # svolte larghe: si passa oltre lo spigolo e si rientra sulla corsia d'uscita più avanti, o ci si allarga
            # prima e si entra da più lontano (come fa un bus, e chiunque in una curva stretta tra due cordoli)
            for e in LARGHE:
                for f in (max(6.0, 4 * e), max(10.0, 6 * e)):
                    larghe += [c for c in (due(s + e, u + f), due(s - f, u - e)) if c]
        esito = []
        if meglio:
            esito.append(meglio)
        if larghe and not meglio:
            meglio = scegli(larghe)
            if meglio:
                esito.append(meglio)
        if larghe and meglio and bus_serve and not meglio[2] & BUS:
            b = scegli(larghe, solo_bus=True)
            if b:
                esito.append((b[0], b[1], b[2] & BUS))
        if esito:
            return esito, 'ok'
        # nessuna curva sta sull'asfalto con il raggio minimo, o non c'è lo spazio per farla
        verts, rmax = max(prove, key=lambda p: p[1]) if prove else ([Pi], 0.0)
        if rmax < minimo:
            return [(verts, rmax, 0)], 'stretto'
        return [(verts, minimo, 0)], 'fuori'

    def _adatta(self, d_in, verts, rmax, d_out, solo_bus=False):
        """Il raggio più grande fino a rmax con cui la curva sta sull'asfalto, per i bus se si può, se no per le auto:
        (raggio, maschera) o None. Vertici e raggio sono già quelli che si scrivono nella mappa (centimetri e
        decimetri): la curva provata è quella che il gioco leggerà."""
        def prova(r, mezza):
            pts, _t0, _t1, ok = campiona(d_in, verts, r, d_out)
            return ok and self.passa(pts, mezza)
        giu = lambda r: math.floor(r * 10 + 1e-6) / 10
        rmax = giu(rmax)
        for lo, mezza, chi in ((R_MIN[BUS12], MEZZA[BUS], AUTO | BUS), (R_MIN[AUTO], MEZZA[AUTO], AUTO)):
            if rmax < lo or (solo_bus and chi == AUTO):
                continue
            if prova(rmax, mezza):
                r = rmax
            elif prova(lo, mezza):
                a, b = lo, rmax
                for _ in range(5):
                    c = (a + b) / 2
                    if prova(c, mezza):
                        a = c
                    else:
                        b = c
                r = giu(a)
                if r > lo and not prova(r, mezza):
                    r = lo
            else:
                continue
            return r, chi & ~(SNODATO if r < R_MIN[SNODATO] else 0)
        return None

    def bus_serve(self, g):
        """Il movimento serve ai bus: è sul percorso di una linea, o le auto non ci passano."""
        return bool(g['m'] & BUS) and (not g['m'] & AUTO or all((self.R.archi[b[0]][0 if b[1] else 1], a[0], b[0]) in self.dei_bus
                                                                for a, b in zip(g['cat'], g['cat'][1:])))

    def corto(self, g):
        """(manca posto sulla corsia d'arrivo, manca su quella d'uscita) per il raggio minimo di chi ci deve passare."""
        if g['k'] is None:
            return True, True
        t = (R_MIN[AUTO] if g['m'] & AUTO else R_MIN[BUS12]) * g['k']
        return self.spazio[g['kin'] + (1,)] + g['s'] < t, self.spazio[g['kout'] + (0,)] - g['u'] < t

    def voci(self, g):
        curve, esito = self.curva(g)
        return [{'nodo': g['nodo'], 'cat': g['cat'], 'classi': g['m'] & chi if esito == 'ok' else 0, 'ammessi': g['m'], 'r': r, 'v': verts,
                 'esito': esito, 'gradi': math.degrees(g['th']), 'd_in': g['d_in'], 'd_out': g['d_out']} for verts, r, chi in curve]

    def calcola(self, nodi=None):
        """I raccordi dei nodi (tutti, se non detto). Dove a un movimento manca il posto per il raggio minimo perché un
        arco è corto, il raccordo si allunga: parte dalla corsia prima dell'arco corto, o arriva su quella dopo, e
        l'arco corto lo scavalca (fino a VIA_MAX archi e VIA_LUNGO metri). Lo stesso per i bus sui percorsi delle
        linee, dove il raccordo diretto basta solo alle auto."""
        out = []
        for n in (sorted(self.mov) if nodi is None else nodi):
            if n not in self.mov:
                continue
            self.prepara(n)
            for g in self.mov[n]:
                vv = self.voci(g)
                out += vv
                stretto = vv[0]['esito'] == 'stretto'
                solo = 0 if stretto else BUS  # il raccordo diretto c'è: quelli lunghi servono solo ai bus
                if not stretto and not (vv[0]['esito'] == 'ok' and self.bus_serve(g) and not any(v['classi'] & BUS for v in vv)):
                    continue
                g0 = self.geometria(g['cat'], g['m'] & BUS) if solo else g
                coda, visti = [g0], {tuple(g['cat'])}
                while coda:
                    h = coda.pop(0)
                    if len(h['cat']) - 2 >= VIA_MAX:
                        continue
                    c_in, c_out = self.corto(h)
                    nuove = []
                    if c_in:
                        nuove += [(p['cat'][:1] + h['cat'], p['m'] & h['m']) for p in self.prima[h['kin']]]
                    if c_out:
                        nuove += [(h['cat'] + q['cat'][-1:], h['m'] & q['m']) for q in self.dopo[h['kout']]]
                    for cat, m in nuove:
                        archi = [c[0] for c in cat]
                        if not m or tuple(cat) in visti or len(set(archi)) < len(archi) or sum(self.R.lung[k] for k in archi[1:-1]) > VIA_LUNGO:
                            continue
                        visti.add(tuple(cat))
                        h2 = self.geometria(cat, m)
                        if solo and not self.bus_serve(h2):
                            continue
                        v2 = [v for v in self.voci(h2)]
                        buone = [v for v in v2 if v['esito'] == 'ok' and v['classi'] & (solo or 7)]
                        if buone:
                            for v in buone:
                                v['classi'] &= solo or 7
                            out += buone
                        elif v2[0]['esito'] != 'fuori':
                            coda.append(h2)
        return out


# ---------------------------------------------------------------- campo della mappa

SNODATI = ('10',)  # linee con lo snodato da 18 m (SNODATI di build_map.py, ARTICULATED_LINES di src/game/routes.js)
CAMPO, DOPO = 'raccordi', 'fondo'


def scavalcati(voci):
    """Toglie ai raccordi che finiscono su una corsia da cui poi non si esce, se non con un raccordo che l'ha già
    scavalcata, i mezzi che ci resterebbero fermi: chi sceglie un raccordo ne trova sempre uno dopo, o è in fondo a una
    strada."""
    while True:
        esce, attraverso = defaultdict(int), defaultdict(int)
        for v in voci:
            esce[v['cat'][0]] |= v['classi']
            for c in v['cat'][1:-1]:
                attraverso[(v['cat'][0], c)] |= v['classi']
        tolti = 0
        for v in voci:
            if len(v['cat']) == 2:
                via = v['classi'] & ~esce[v['cat'][-1]] & attraverso[(v['cat'][0], v['cat'][-1])]
                if via:
                    v['classi'] &= ~via
                    tolti += 1
        voci = [v for v in voci if v['classi']]
        if not tolti:
            return voci


def raggio_massimo(d_in, verts, d_out):
    """Il raggio più grande con cui i due archi di una curva a due vertici non si sovrappongono."""
    m = math.dist(*verts)
    dm = ((verts[1][0] - verts[0][0]) / m, (verts[1][1] - verts[0][1]) / m)
    k = sum(math.tan(abs(math.atan2(croce(a, b), a[0] * b[0] + a[1] * b[1])) / 2) for a, b in ((d_in, dm), (dm, d_out)))
    return m / k if k > 1e-9 else R_MAX


def codifica(R, voci):
    """Il campo della mappa dai raccordi buoni: per nodo una lista piatta di interi (docs/raccordi.md)."""
    per = defaultdict(list)
    for v in voci:
        cat, n = v['cat'], v['nodo']
        x, z = R.nodi[n]
        via = [c[0] for c in cat[1:-1]]
        vr = [tuple(round((q - o) * 100) / 100 + o for q, o in zip(p, (x, z))) for p in v['v']]
        r = min(v['r'], R_MAX)
        if len(vr) == 2:  # con i vertici al centimetro i due archi devono ancora starci tra un vertice e l'altro
            r = min(r, 0.995 * raggio_massimo(v['d_in'], vr, v['d_out']))
        r = math.floor(r * 10 + 1e-6)
        classi = v['classi'] & ~sum(bit for bit in (AUTO, BUS12, SNODATO) if r and r / 10 < R_MIN[bit])
        if not classi:
            continue
        c = cat[0][2] | cat[-1][2] << 3 | classi << 6 | (len(v['v']) - 1) << 9 | len(via) << 10
        per[n].append((cat[0][0], via, cat[-1][0], -classi, [cat[0][0], cat[-1][0], c, r] + [round((q - o) * 100) for p in v['v'] for q, o in zip(p, (x, z))] + via))
    nodi = sorted(per)
    return {'classi': list(CLASSI), 'raggi': [R_MIN[AUTO], R_MIN[BUS12], R_MIN[SNODATO]], 'nodi': nodi,
            'voci': [[i for _da, _via, _a, _m, voce in sorted(per[n], key=lambda t: (t[0], t[4][2] & 7, t[1], t[2], t[3], t[4])) for i in voce] for n in nodi]}


def decodifica(R, campo):
    """I raccordi del campo della mappa: [{nodo, cat, classi, r, v}], cat con le corsie degli archi scavalcati a 0."""
    out = []
    for n, voce in zip(campo['nodi'], campo['voci']):
        x, z = R.nodi[n]
        i = 0
        while i < len(voce):
            da, a, c, r = voce[i:i + 4]
            nv, nvia = ((c >> 9) & 1) + 1, c >> 10
            pts = voce[i + 4:i + 4 + 2 * nv]
            via = voce[i + 4 + 2 * nv:i + 4 + 2 * nv + nvia]
            i += 4 + 2 * nv + nvia
            cat, m = [(da, R.archi[da][1] == n, c & 7)], n
            for k in via + [a]:
                avanti = R.archi[k][0] == m
                cat.append((k, avanti, 0))
                m = R.archi[k][1 if avanti else 0]
            cat[-1] = (a, cat[-1][1], (c >> 3) & 7)
            out.append({'nodo': n, 'cat': cat, 'classi': (c >> 6) & 7, 'r': r / 10, 'v': [(x + pts[j] / 100, z + pts[j + 1] / 100) for j in range(0, len(pts), 2)]})
    return out


def campo_mappa(M, binari=None):
    """(campo, generatore, voci) per la mappa intera M: lo chiama la build, e --scrivi sulla mappa che c'è."""
    import aree_mappa
    G = Raccordi(M, aree_mappa.tram_tracks(M) if binari is None else binari)
    voci = G.calcola()
    buone = scavalcati([dict(v) for v in voci if v['esito'] == 'ok' and v['classi']])
    return codifica(G.R, buone), G, voci


# ---------------------------------------------------------------- controlli e rapporto

ELENCO, COMANDO = 'raccordi', 'python3 scripts/raccordi.py --aggiorna'
TOLL = 3.0  # m: un caso dell'elenco resta lo stesso se si sposta fino a qui
TOLLERA = 0.04  # m: arrotondamenti del campo (vertici al centimetro, raggi al decimetro)


def controlla(G, campo):
    """Controlli sul campo scritto nella mappa, raccordo per raccordo: {controllo: [caso]}.
    * raccordi_rotti: archi o corsie che non ci sono, catena che non si tiene, curva che non si chiude, raggio sotto il
      minimo di un mezzo ammesso, mezzo che non può percorrere una delle due corsie, svolta vietata;
    * raccordi_fuori_corsia: la curva non comincia o non finisce sull'asse della sua corsia;
    * raccordi_fuori_asfalto: la curva esce dall'asfalto (isole e marciapiedi non lo sono), o ci sta più stretta delle
      corsie che unisce;
    * raccordi_nella_sede: la curva entra nella sede del tram dove le due vie non la toccano;
    * raccordi_sovrapposti: su una corsia un raccordo che arriva finisce oltre il punto da cui ne parte un altro."""
    R = G.R
    casi = defaultdict(list)
    capo = defaultdict(lambda: [-1e9, -1e9])
    nome = lambda k: R.nomi[R.archi[k][4]] or 'senza nome'

    visti = {}

    def caso(controllo, v, cosa, misura=''):
        # un caso per nodo e per difetto, con quanti raccordi lo hanno
        x, z = R.nodi[v['nodo']]
        k = (controllo, v['nodo'], cosa)
        if k in visti:
            visti[k]['raccordi'] += 1
            return
        visti[k] = {'cosa': cosa, 'misura': misura, 'da': nome(v['cat'][0][0]), 'a': nome(v['cat'][-1][0]), 'raccordi': 1, 'x': x, 'z': z}
        casi[controllo].append(visti[k])
    na = len(R.archi)
    per_nodo = defaultdict(list)
    for v in decodifica_sicura(R, campo, casi):
        per_nodo[v['nodo']].append(v)
    for n in sorted(per_nodo):
        G.prepara(n)
        for v in per_nodo[n]:
            cat = v['cat']
            if any(not 0 <= c[0] < na for c in cat) or any(c[2] >= len(R.marcia(c[0], c[1])) for c in (cat[0], cat[-1])):
                caso('raccordi_rotti', v, 'arco o corsia che non esiste')
                continue
            m = R.marcia(cat[0][0], cat[0][1])[cat[0][2]][1] & R.marcia(cat[-1][0], cat[-1][1])[cat[-1][2]][1]
            fine = n
            for a, b in zip(cat, cat[1:]):
                m &= R.chi(b[0], b[1]) & ~G.vietata(fine, a[0], b[0])
                fine = R.archi[b[0]][1 if b[1] else 0]
            if v['classi'] & ~m:
                caso('raccordi_rotti', v, 'mezzo non ammesso o svolta vietata')
            if any(v['classi'] & bit and v['r'] and v['r'] < R_MIN[bit] - 1e-9 for bit in (AUTO, BUS12, SNODATO)):
                caso('raccordi_rotti', v, 'raggio sotto il minimo', f"{v['r']} m")
            g = G.geometria(cat, v['classi'])
            pts, t0, t1, valida = campiona(g['d_in'], v['v'], v['r'], g['d_out'])
            if not valida and not (len(v['v']) == 2 and t0 + t1 <= math.dist(*v['v']) + TOLLERA):
                caso('raccordi_rotti', v, 'gli archi della curva si sovrappongono')
            # capi della curva: sull'asse delle due corsie, e a quanti metri dal loro punto accanto al nodo
            p0 = (v['v'][0][0] - g['d_in'][0] * t0, v['v'][0][1] - g['d_in'][1] * t0)
            p1 = (v['v'][-1][0] + g['d_out'][0] * t1, v['v'][-1][1] + g['d_out'][1] * t1)
            wi, wo = (p0[0] - g['Pi'][0], p0[1] - g['Pi'][1]), (p1[0] - g['Po'][0], p1[1] - g['Po'][1])
            if abs(croce(g['d_in'], wi)) > TOLLERA or abs(croce(g['d_out'], wo)) > TOLLERA:
                caso('raccordi_fuori_corsia', v, "non comincia o non finisce sull'asse della corsia", f"{abs(croce(g['d_in'], wi)):.2f} m all'inizio, {abs(croce(g['d_out'], wo)):.2f} alla fine")
            prima, dopo = -(wi[0] * g['d_in'][0] + wi[1] * g['d_in'][1]), wo[0] * g['d_out'][0] + wo[1] * g['d_out'][1]
            capo[cat[0]][1] = max(capo[cat[0]][1], prima)
            capo[cat[-1]][0] = max(capo[cat[-1]][0], dopo)
            if prima > R.lung[cat[0][0]] + TOLLERA or dopo > R.lung[cat[-1][0]] + TOLLERA:
                caso('raccordi_sovrapposti', v, 'la curva è più lunga della corsia')
            mezza = MEZZA[BUS] if v['classi'] & BUS else MEZZA[AUTO]
            sp, capi = G.margine(pts)
            if capi < 0:
                caso('raccordi_fuori_asfalto', v, "la corsia è fuori dall'asfalto", f'{-capi:.2f} m')
            elif sp < min(mezza, capi) - GIOCO - TOLLERA:
                caso('raccordi_fuori_asfalto', v, "la curva esce dall'asfalto" if sp < 0 else 'la curva è più vicina al bordo delle corsie',
                     f'{sp:.2f} m dal bordo, le corsie {capi:.2f}')
            if G.nella_sede(pts) and not G.tocca_sede(g):
                caso('raccordi_nella_sede', v, 'entra nella sede del tram')
    for (k, avanti, c), (dopo, prima) in sorted(capo.items()):
        if dopo + prima > R.lung[k] + TOLLERA:
            e = R.archi[k]
            x, z = R.nodi[e[1] if avanti else e[0]]
            casi['raccordi_sovrapposti'].append({'cosa': 'chi arriva finisce oltre il punto da cui si parte', 'misura': f'{dopo + prima - R.lung[k]:.2f} m su {R.lung[k]:.1f}',
                                                 'da': nome(k), 'a': nome(k), 'raccordi': 2, 'x': x, 'z': z})
    return casi


def decodifica_sicura(R, campo, casi):
    try:
        return decodifica(R, campo)
    except (IndexError, KeyError, TypeError, ValueError) as err:
        casi['raccordi_rotti'].append({'cosa': f'campo illeggibile: {err}', 'da': '', 'a': '', 'x': 0, 'z': 0})
        return []


def senza_uscita(G, voci):
    """Corsie da cui un'auto non esce: {perché: [caso]}. In fondo a una strada chiusa o al bordo della mappa (fine),
    davanti a sole vie dove le auto non entrano (accesso), per le svolte vietate di OSM (divieto), o perché nessuna
    delle svolte ammesse ha una curva che un'auto possa fare (curva)."""
    R = G.R
    esce = defaultdict(int)
    for v in voci:
        esce[v['cat'][0]] |= v['classi']
    out = defaultdict(list)
    for k in range(len(R.archi)):
        for avanti in (True, False):
            for c, (_off, m, _bus) in enumerate(R.marcia(k, avanti)):
                L = (k, avanti, c)
                if not m & AUTO or esce[L] & AUTO:
                    continue
                e = R.archi[k]
                n = e[1] if avanti else e[0]
                altri = [a for a in R.attorno[n] if a != k]
                if not altri:
                    perche = 'fine'
                elif not any(R.chi(a, R.archi[a][0] == n) & AUTO for a in altri):
                    perche = 'accesso'
                elif not any(g['m'] & AUTO for g in G.dopo[L]):
                    perche = 'divieto' if all(G.vietata(n, k, a) & AUTO for a in altri if R.chi(a, R.archi[a][0] == n) & AUTO) else 'corsia'
                else:
                    perche = 'curva'
                out[perche].append({'perche': perche, 'via': R.nomi[e[4]] or 'senza nome', 'metri': round(R.lung[k], 1), 'x': R.nodi[n][0], 'z': R.nodi[n][1]})
    return out


def percorsi_bus(G, voci):
    """Svolte dei percorsi delle linee senza un raccordo per il loro mezzo (snodato per le linee di SNODATI, bus da
    12 m per le altre): una per linea, nodo e coppia di archi."""
    R = G.R
    tra = {}
    for k, e in enumerate(R.archi):
        if R.lung[k] >= CORTO:
            tra.setdefault((e[0], e[1]), k)
            tra.setdefault((e[1], e[0]), k)
    catene = defaultdict(list)  # primo arco -> [(archi, maschera)]
    for v in voci:
        catene[v['cat'][0][0]].append(([c[0] for c in v['cat']], v['classi']))
    out, visti = [], set()
    for l in G.M['lines']:
        bit = SNODATO if l['id'] in SNODATI else BUS12
        for va in l['variants']:
            ns = va['nodes']
            archi = [tra.get(p) for p in zip(ns, ns[1:])]
            servita = [False] * (len(archi) - 1)
            for i, k in enumerate(archi):
                for cat, m in catene.get(k, ()):
                    if m & bit and archi[i:i + len(cat)] == cat:
                        for j in range(i, i + len(cat) - 1):
                            servita[j] = True
            for i, ok in enumerate(servita):
                da, a, n = archi[i], archi[i + 1], ns[i + 1]
                if ok or da is None or a is None or (l['id'], n, da, a) in visti:
                    continue
                visti.add((l['id'], n, da, a))
                g = next((g for g in G.mov.get(n, ()) if g['kin'][0] == da and g['kout'][0] == a), None)
                perche = ('inversione' if da == a else 'svolta non ammessa' if g is None else 'solo auto'
                          if any(m & AUTO and c[:2] == [da, a] for c, m in catene.get(da, ())) else 'senza curva')
                out.append({'linea': l['id'], 'variante': va['headsign'], 'perche': perche, 'da': R.nomi[R.archi[da][4]] or 'senza nome',
                            'a': R.nomi[R.archi[a][4]] or 'senza nome', 'gradi': round(math.degrees(g['th'])) if g else 180, 'x': R.nodi[n][0], 'z': R.nodi[n][1]})
    return out


def rapporto(M, elenco=False, aggiorna=False):
    """Controlli sui raccordi della mappa, caso per caso contro data/eccezioni/raccordi.json, e i numeri del rapporto.
    Restituisce (valori, casi, righe degli errori)."""
    from eccezioni import Elenco, chiave
    import aree_mappa
    G = Raccordi(M, aree_mappa.tram_tracks(M))
    campo = M.get(CAMPO)
    if not campo:
        return {}, {}, ['Raccordi: la mappa non ha il campo raccordi (scripts/rigenera_mappa.sh)']
    voci = decodifica_sicura(G.R, campo, defaultdict(list))
    casi = {k: [] for k in ('raccordi_rotti', 'raccordi_fuori_corsia', 'raccordi_fuori_asfalto', 'raccordi_nella_sede', 'raccordi_sovrapposti')}
    casi.update(controlla(G, campo))
    su = senza_uscita(G, voci)
    casi['auto_senza_uscita'] = su['curva'] + su['divieto'] + su['corsia']
    casi['bus_senza_raccordo'] = percorsi_bus(G, voci)
    fissa = {k: (lambda c: f"{c['cosa']}, {c['da']} > {c['a']}") for k in casi if k.startswith('raccordi_')}
    fissa['auto_senza_uscita'] = lambda c: f"{c['perche']}, {c['via']}"
    fissa['bus_senza_raccordo'] = lambda c: f"linea {c['linea']}, {c['perche']}, {c['da']} > {c['a']}"
    valori = {k: len(v) for k, v in casi.items()}
    valori.update({'raccordi': len(voci), 'nodi': len(campo['nodi']), 'scavalcano': sum(1 for v in voci if len(v['cat']) > 2),
                   'byte': len(json.dumps(campo, separators=(',', ':'))),
                   **{f'per_{c}': sum(1 for v in voci if v['classi'] & 1 << i) for i, c in enumerate(CLASSI)},
                   **{f'senza_uscita_{k}': len(v) for k, v in sorted(su.items())}})
    print(f"Raccordi di corsia: {valori['raccordi']} su {valori['nodi']} nodi ({valori['scavalcano']} scavalcano un arco corto), "
          + ', '.join(f"{valori['per_' + c]} per {c}" for c in CLASSI) + f"; {valori['byte']} byte")
    print('    corsie senza uscita per le auto: ' + ', '.join(f'{len(v)} {k}' for k, v in sorted(su.items())))
    E = Elenco(ELENCO, COMANDO)
    for k, f in fissa.items():
        E.confronta(k, [chiave(f(c), c['x'], c['z']) for c in casi[k]], TOLL, aggiorna)
        segno, esito = E.segno(k)
        print(f"  {segno} {k.replace('_', ' ')}: {len(casi[k])} ({esito})")
        if elenco:
            for c in casi[k][:80]:
                print('      ' + ', '.join(f'{a}={b}' for a, b in c.items()))
    if aggiorna:
        E.scrivi()
    return valori, casi, E.errori()


def scrivi(campo, percorso=MAPPA):
    """Riscrive nella rete il solo campo dei raccordi."""
    rete = json.load(open(percorso, encoding='utf-8'))
    out = {}
    for k, v in rete.items():
        if k != CAMPO:
            out[k] = v
        if k == DOPO:
            out[CAMPO] = campo
    out.setdefault(CAMPO, campo)
    with open(percorso, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))


def main():
    import aree_mappa
    M = aree_mappa.load(MAPPA)
    if '--scrivi' in sys.argv:
        campo, G, voci = campo_mappa(M)
        prima = os.path.getsize(MAPPA)
        scrivi(campo)
        print(f'campo {CAMPO} scritto in {os.path.relpath(MAPPA, RADICE)}: da {prima} a {os.path.getsize(MAPPA)} byte')
        print('  movimenti: ' + ', '.join(f'{n} {k}' for k, n in Counter(v['esito'] for v in voci if len(v['cat']) == 2).most_common()))
        M = aree_mappa.load(MAPPA)
    _v, _c, errori = rapporto(M, '--elenco' in sys.argv, '--aggiorna' in sys.argv)
    if errori:
        print('\n'.join(errori))
        sys.exit(1)


if __name__ == '__main__':
    main()
