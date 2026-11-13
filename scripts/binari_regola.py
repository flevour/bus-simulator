"""Binari delle linee del tram rifatti secondo la regola di docs/binari-tram.md (ticket #69).

OSM è la traccia, non il disegno: i binari OSM (o, nel piazzale della stazione, gli anelli di scripts/tram_stazione.py)
dicono dove passa il binario; qui la geometria si rifà sopra:
  * niente spigoli e raggio mai sotto R_MIN: ogni binario è un raccordo dei punti della traccia, con la curvatura che
    cambia piano (si penalizza la sua derivata, come in una clotoide) e che non supera 1 / R_FIT;
  * entro TOLL metri dalla traccia (la regola chiede 1 m da OSM: il resto è margine);
  * dove i due binari di una linea corrono nella stessa sede, prima l'asse comune e poi i due binari a metà interasse per
    parte: l'interasse è costante (INTERASSE della linea, o più largo dove in OSM c'è qualcosa in mezzo) e cambia solo con
    una S lunga almeno TRANS metri;
  * dove una linea corre sui binari di un'altra già rifatta (il SIR2 sul SIR3 verso Pace, il SIR1 sul SIR2 in Corso
    Garibaldi e Corso del Popolo), il binario è quello dell'altra, punto per punto;
  * i tratti fissi (gli anelli della stazione, i binari delle altre linee, i binari a interasse costante) restano come
    sono, il raccordo li unisce al resto.

Il raccordo è un problema ai minimi quadrati sui punti del binario (uno ogni H metri): vicino alla traccia (il punto più
vicino, come una molla corta), terza differenza piccola (curvatura che cambia piano), e dove la curvatura supera il
massimo un vincolo che la riporta sotto. Lo si risolve per x e per y con lo stesso sistema a banda (Cholesky), ripetendo
finché non ci sono più punti oltre il raggio minimo o la tolleranza.

Lo usano scripts/tram_linee.py per SIR3 e SIR2 e scripts/build_map.py per il SIR1, in quest'ordine; il controllo è
scripts/binari_tram.py, il metodo nella sezione 3 di docs/binari-tram.md. Coordinate in metri (x verso est, y verso nord
in tram_linee.py; x verso est, z verso sud in build_map.py: i calcoli non dipendono dal verso degli assi); solo numpy
oltre alla libreria standard.
"""
import math

import numpy as np

R_MIN = 10.5   # m: raggio minimo del Translohr sulla rotaia di guida
R_FIT = 12.0   # m: raggio minimo dei binari rifatti (margine sul minimo: polilinee e arrotondamenti)
TOLL = 0.8     # m: scarto massimo dalla traccia (la regola: 1 m da OSM)
H = 0.5        # m tra i punti del raccordo
L3 = 9.0       # m: lunghezza su cui si distribuisce un cambio di curvatura (peso della terza differenza)
FISSO = 1e9    # peso dei punti fissi (il doppio binario: si liberano dove la curva accanto non ci sta)
INTOCCABILE = 2e9  # peso dei punti fissi che restano comunque (stazione, binari di un'altra linea)
VINCOLO = 1e7  # peso dei vincoli sulla curvatura
GIRI = 40      # iterazioni al più
CEDE = 30.0   # peso della traccia dove la tolleranza cede al raggio minimo
FINESTRA = 30  # punti della traccia attorno al punto più vicino dell'iterazione prima
# doppio binario
DOPPIO = (1.5, 6.5)  # m: i binari dei due versi a questa distanza, in controsenso, sono nella stessa sede
DELTA = 1.2    # m: quanto l'interasse costante può scostarsi da quello di OSM (metà per binario)
TRATTO = 30.0  # m: tratti in doppio binario più corti restano binari singoli
BUCO = 30.0    # m: buchi più corti tra due tratti in doppio binario si colmano (le curve strette)
SFUMA = 25.0   # m: tratto libero su cui si distribuisce lo scarto di traverso da un tratto fisso accanto
STACCO = 15.0  # m: margine ai capi di un tratto sui binari di un'altra linea, dove la linea se ne stacca
TRANS = 40.0   # m: lunghezza della S dove cambia l'interasse
PIANO = 70.0   # m: un interasse diverso da quelli accanto dura almeno tanto (S comprese: niente va e viene in 30 m)
CAPO = 0.6     # m: ai capi di un tratto in doppio binario, i binari di OSM più lontani di così dall'interasse sono già
               # quelli che si separano
LIBERO = 10.0  # m liberi tra un tratto fisso (stazione, binari di un'altra linea) e il doppio binario
COMUNE = (1.2, 0.3)  # m: binario sopra quello di un'altra linea (entro il primo), lo stesso binario dell'altro verso
                     # (entro il secondo)
SEMPLIFICA = 0.002   # m: tolleranza della semplificazione dei punti scritti
# interasse dove i binari corrono nella stessa sede senza niente in mezzo (binari_tram.INTERASSE): 3,00 m del progetto
# del SIR3, che riprende il SIR1; 3,50 m del PFTE del SIR2
INTERASSE = {'SIR1': 3.0, 'SIR3': 3.0, 'SIR2': 3.5}
# interasse minimo (m) secondo il raggio (m) del binario più stretto, dalle fasce d'ingombro (binari_tram.INGOMBRO)
INGOMBRO = [(10.5, 3.362), (15, 3.129), (20, 2.997), (25, 2.915), (30, 2.862), (40, 2.795), (50, 2.753), (100, 2.670),
            (200, 2.631), (380, 2.614), (math.inf, 2.594)]


# ---------- polilinee ----------
def ricampiona(P, h=H):
    """Punti ogni h metri lungo la polilinea (n, 2), estremi compresi."""
    P = np.asarray(P, float)
    d = np.hypot(*np.diff(P, axis=0).T)
    keep = np.concatenate([[True], d > 1e-9])
    P = P[keep]
    s = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
    if s[-1] < 1e-9:
        return P[:1].copy()
    n = max(1, int(round(s[-1] / h)))
    t = np.linspace(0, s[-1], n + 1)
    return np.stack([np.interp(t, s, P[:, 0]), np.interp(t, s, P[:, 1])], axis=1)


def progressive(P):
    return np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])


def normali(P):
    """Normale a sinistra in ogni punto (dalla corda tra il punto prima e quello dopo)."""
    a = np.vstack([P[:1], P[:-2], P[-2:-1]]) if len(P) > 2 else P[:1]
    b = np.vstack([P[1:2], P[2:], P[-1:]]) if len(P) > 2 else P[-1:]
    t = b - a
    t /= np.maximum(np.hypot(*t.T), 1e-9)[:, None]
    return np.stack([-t[:, 1], t[:, 0]], axis=1)


def curvatura(P):
    """Curvatura con il segno (positiva a sinistra) in ogni punto, dal cerchio per il punto prima, il punto e quello
    dopo; 0 agli estremi."""
    k = np.zeros(len(P))
    if len(P) < 3:
        return k
    a, b, c = P[:-2], P[1:-1], P[2:]
    ab, bc, ac = np.hypot(*(b - a).T), np.hypot(*(c - b).T), np.hypot(*(c - a).T)
    cr = (b - a)[:, 0] * (c - b)[:, 1] - (b - a)[:, 1] * (c - b)[:, 0]
    k[1:-1] = 2 * cr / np.maximum(ab * bc * ac, 1e-12)
    return k


def semplifica(P, eps):
    """Douglas-Peucker: i punti da tenere (indici)."""
    keep = np.zeros(len(P), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(P) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        u = P[b] - P[a]
        L = math.hypot(*u) or 1e-9
        q = P[a + 1:b] - P[a]
        d = np.abs(q[:, 0] * u[1] - q[:, 1] * u[0]) / L
        i = int(np.argmax(d))
        if d[i] > eps:
            keep[a + 1 + i] = True
            stack += [(a, a + 1 + i), (a + 1 + i, b)]
    return np.flatnonzero(keep)


def piu_vicini(X, T, m, w=FINESTRA):
    """Per ogni punto di X il punto più vicino sulla polilinea T, cercato tra i segmenti m-w..m+w (m: indici dei segmenti
    dell'iterazione prima). Restituisce (punti, indici dei segmenti, distanze)."""
    n = len(T) - 1
    best_d = np.full(len(X), np.inf)
    best_p = np.zeros_like(X)
    best_j = m.copy()
    for k in range(-w, w + 1):
        j = np.clip(m + k, 0, n - 1)
        a, b = T[j], T[j + 1]
        u = b - a
        l2 = np.maximum((u * u).sum(1), 1e-12)
        t = np.clip(((X - a) * u).sum(1) / l2, 0, 1)
        p = a + u * t[:, None]
        d = np.hypot(*(X - p).T)
        better = d < best_d - 1e-12
        best_d[better], best_p[better], best_j[better] = d[better], p[better], j[better]
    return best_p, best_j, best_d


# ---------- sistema a banda ----------
def cholesky(B):
    """Fattore di Cholesky della matrice simmetrica a banda B (B[i][k] = M[i][i+k], k = 0..p): L[i][k] = L(i, i-k)."""
    n, p = len(B), len(B[0]) - 1
    L = [[0.0] * (p + 1) for _ in range(n)]
    for i in range(n):
        Li = L[i]
        for k in range(min(i, p), -1, -1):
            j = i - k
            s = B[j][k]
            Lj = L[j]
            # somma su m < j: L(i, m) L(j, m), con m = i - a = j - c
            for a in range(k + 1, min(i, p) + 1):
                c = a - k
                if c > p:
                    break
                s -= Li[a] * Lj[c]
            if k == 0:
                Li[0] = math.sqrt(max(s, 1e-300))
            else:
                Li[k] = s / Lj[0]
    return L


def risolvi(L, b):
    n, p = len(L), len(L[0]) - 1
    y = [0.0] * n
    for i in range(n):
        s = b[i]
        Li = L[i]
        for k in range(1, min(i, p) + 1):
            s -= Li[k] * y[i - k]
        y[i] = s / Li[0]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = y[i]
        for k in range(1, min(n - 1 - i, p) + 1):
            s -= L[i + k][k] * x[i + k]
        x[i] = s / L[i][0]
    return x


D3 = (-1.0, 3.0, -3.0, 1.0)
D2 = (1.0, -2.0, 1.0)


def banda(n, peso, lam3, vincoli):
    """Matrice del sistema: diag(peso) + lam3 D3'D3 + VINCOLO d2'd2 per i punti vincolati."""
    B = np.zeros((n, 4))
    B[:, 0] = peso
    if n >= 4:
        for a in range(4):
            for b in range(a, 4):
                B[a:n - 3 + a, b - a] += lam3 * D3[a] * D3[b]
    for i in vincoli:
        for a in range(3):
            for b in range(a, 3):
                B[i - 1 + a, b - a] += VINCOLO * D2[a] * D2[b]
    return B.tolist()


# ---------- raccordo di un binario ----------
def raccorda(T, peso=None, toll=None, kmax=None, l3=L3, giri=GIRI, X0=None, cede_peso=CEDE, cede_ok=True):
    """Binario rifatto sulla traccia T (punti ogni H metri, (n, 2)).

    peso: per punto (1 = traccia, FISSO = il punto resta dov'è); toll: scarto massimo per punto (m); kmax: curvatura
    massima per punto. Restituisce (X, rapporto) con X (n, 2), un punto per punto della traccia."""
    T = np.asarray(T, float)
    n = len(T)
    peso = np.ones(n) if peso is None else np.asarray(peso, float)
    toll = np.full(n, TOLL) if toll is None else np.asarray(toll, float)
    kmax = np.full(n, 1 / R_FIT) if kmax is None else np.asarray(kmax, float)
    fisso = peso >= FISSO
    if n < 5:
        return T.copy(), {'oltre_toll': 0, 'oltre_raggio': 0, 'cede': [], 'curve_strette': [], 'lontani': []}
    # partenza: la traccia levigata (i punti fissi restano)
    X = T.copy() if X0 is None else np.asarray(X0, float).copy()
    if X0 is None:
        g = np.exp(-0.5 * (np.arange(-6, 7) / 2.0) ** 2)
        g /= g.sum()
        for c in range(2):
            v = np.convolve(np.pad(T[:, c], 6, mode='edge'), g, mode='valid')
            X[~fisso, c] = v[~fisso]
    m = np.clip(np.arange(n), 0, n - 2)
    w = peso.copy()
    vinc = {}
    lam3 = (l3 / H) ** 6
    rep = {}
    # dove raggio e tolleranza non stanno insieme (una curva della traccia più stretta del minimo) vince il raggio: lì
    # la molla verso la traccia resta morbida
    cede = np.zeros(n, bool)
    insiste = np.zeros(n, int)
    for it in range(giri):
        tgt, m, dist = piu_vicini(X, T, m)
        k = curvatura(X)
        oltre_t = (dist > toll) & ~fisso
        oltre_k = (np.abs(k) > kmax) & ~fisso
        oltre_k[[0, -1]] = False
        rep = {'giri': it, 'oltre_toll': int(oltre_t.sum()), 'oltre_raggio': int(oltre_k.sum()),
               'scarto_max': float(dist[~fisso].max()) if (~fisso).any() else 0.0,
               'raggio_min': float(1 / max(np.abs(k[~fisso]).max(), 1e-9)) if (~fisso).any() else math.inf}
        if it and not oltre_t.any() and not oltre_k.any():
            break
        insiste = np.where(oltre_k, insiste + 1, insiste)
        nuovi = (insiste >= 6) & ~cede & cede_ok
        if nuovi.any():
            z = np.convolve(nuovi.astype(float), np.ones(int(2 * 12 / H) + 1), mode='same') > 0
            cede |= z & ~fisso
            w[cede] = cede_peso
        # oltre la tolleranza: la molla verso la traccia si fa più dura (anche attorno)
        if oltre_t.any():
            f = (np.convolve(oltre_t.astype(float), np.ones(5), mode='same') > 0) & ~fisso & ~cede
            w[f] = np.minimum(w[f] * 3, 1e4)
        # oltre la curvatura massima: la seconda differenza riportata al massimo (con un po' di margine)
        for i in np.flatnonzero(oltre_k):
            if 0 < i < n - 1:
                vinc[int(i)] = True
        for i in list(vinc):
            d2 = X[i - 1] - 2 * X[i] + X[i + 1]
            h2 = (np.hypot(*(X[i] - X[i - 1])) * np.hypot(*(X[i + 1] - X[i])))
            lim = kmax[i] * 0.97 * h2
            l = math.hypot(*d2)
            vinc[i] = d2 * (min(1.0, lim / l) if l > 1e-12 else 1.0)
        B = banda(n, w, lam3, sorted(vinc))
        L = cholesky(B)
        new = np.empty_like(X)
        for c in range(2):
            b = w * tgt[:, c]
            for i, v in vinc.items():
                for a in range(3):
                    b[i - 1 + a] += VINCOLO * D2[a] * v[c]
            new[:, c] = risolvi(L, b.tolist())
        new[fisso] = T[fisso]
        X = new
    rep['cede'] = [X[(i + j) // 2].round(1).tolist() for i, j in tratti(cede)]
    k = curvatura(X)
    rep['curve_strette'] = [int(i) for i in np.flatnonzero((np.abs(k) > kmax * 1.02) & ~fisso)]
    _, _, dist = piu_vicini(X, T, m)
    rep['lontani'] = [int(i) for i in np.flatnonzero((dist > toll + 0.05) & ~fisso & ~cede)]
    return X, rep


# ---------- una linea: i due versi ----------
def interasse_min(r):
    """Interasse minimo dove il binario più stretto ha raggio r (INGOMBRO, interpolato)."""
    if r <= INGOMBRO[0][0]:
        return INGOMBRO[0][1]
    for (r0, a), (r1, b) in zip(INGOMBRO, INGOMBRO[1:]):
        if r <= r1:
            return b if r1 == math.inf else a + (b - a) * (r - r0) / (r1 - r0)
    return INGOMBRO[-1][1]


class Griglia:
    """Segmenti di una polilinea (n, 2) in celle, per i vicini di un punto."""

    def __init__(self, P, cella=8.0):
        self.P, self.c, self.g = P, cella, {}
        for j in range(len(P) - 1):
            a, b = P[j], P[j + 1]
            for gx in range(int(min(a[0], b[0]) // cella), int(max(a[0], b[0]) // cella) + 1):
                for gy in range(int(min(a[1], b[1]) // cella), int(max(a[1], b[1]) // cella) + 1):
                    self.g.setdefault((gx, gy), []).append(j)

    def vicino(self, p, r, verso=None, coseno=0.9):
        """(distanza, segmento, t) del segmento più vicino entro r; con verso solo quelli con coseno oltre la soglia
        (negativa: in controsenso, con il coseno sotto)."""
        best = None
        seen = set()
        c = self.c
        for gx in range(int((p[0] - r) // c), int((p[0] + r) // c) + 1):
            for gy in range(int((p[1] - r) // c), int((p[1] + r) // c) + 1):
                for j in self.g.get((gx, gy), ()):
                    if j in seen:
                        continue
                    seen.add(j)
                    a, b = self.P[j], self.P[j + 1]
                    ux, uy = b[0] - a[0], b[1] - a[1]
                    l2 = ux * ux + uy * uy
                    if l2 < 1e-12:
                        continue
                    if verso is not None:
                        co = (ux * verso[0] + uy * verso[1]) / math.sqrt(l2)
                        if (co > coseno) if coseno < 0 else (co < coseno):
                            continue
                    t = max(0.0, min(1.0, ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / l2))
                    d = math.hypot(a[0] + ux * t - p[0], a[1] + uy * t - p[1])
                    if d <= r and (best is None or d < best[0]):
                        best = (d, j, t)
        return best


def tangenti(P):
    t = np.gradient(P, axis=0)
    return t / np.maximum(np.hypot(*t.T), 1e-12)[:, None]


def tratti(flags, gap=0):
    """[(i, j)] dei tratti di flag veri (j compreso), uniti se separati da al più gap punti."""
    out = []
    i, n = 0, len(flags)
    while i < n:
        if not flags[i]:
            i += 1
            continue
        j = i
        while True:
            k = j + 1
            while k < n and k <= j + 1 + gap and not flags[k]:
                k += 1
            if k < n and k <= j + 1 + gap and flags[k]:
                j = k
            else:
                break
        out.append((i, j))
        i = j + 1
    return out


def lisce(P, m=10):
    """Tangenti levigate su ±m punti (la traccia OSM ha gli spigoli ai vertici)."""
    t = tangenti(P)
    k = np.ones(2 * m + 1)
    s = np.stack([np.convolve(np.pad(t[:, c], m, mode='edge'), k, mode='valid') for c in range(2)], axis=1)
    return s / np.maximum(np.hypot(*s.T), 1e-12)[:, None]


def sopra_altre(T, altre, fisso):
    """Tratti della traccia T sopra un binario già rifatto di un'altra linea, nello stesso verso: [(i, j, punti)] con i
    punti di quel binario tra le proiezioni dei capi. Ai capi il tratto finisce dove quel binario comincia a girare
    rispetto alla traccia (lo scambio dove le linee si separano): oltre, la linea prosegue per conto suo."""
    out = []
    tg = lisce(T)
    for O in altre:
        g = Griglia(O)
        tO = tangenti(O)
        hit = [None] * len(T)
        for i, p in enumerate(T):
            if fisso[i]:
                continue
            v = g.vicino(p, COMUNE[0], tg[i], 0.9)
            if v:
                hit[i] = v
        # stesso binario: vicino e parallelo (entro 2 gradi)
        ok = lambda i: hit[i] is not None and float(tO[hit[i][1]] @ tg[i]) > math.cos(math.radians(2))
        for i, j in tratti([h is not None for h in hit], int(40 / H)):
            # il buco si colma solo se l'altro binario va avanti nello stesso verso
            if hit[j][1] < hit[i][1]:
                continue
            while i < j and not ok(i):
                i += 1
            while j > i and not ok(j):
                j -= 1
            # dove le linee si separano la curva comincia prima della fine del tratto in comune: un po' di margine
            if i > 0:
                i += int(STACCO / H)
            if j < len(T) - 1:
                j -= int(STACCO / H)
            if (j - i) * H < 20:
                continue
            (_, a, ta), (_, b, tb) = hit[i], hit[j]
            pa = O[a] + (O[a + 1] - O[a]) * ta
            pb = O[b] + (O[b + 1] - O[b]) * tb
            Q = np.vstack([pa, O[a + 1:b + 1], pb])
            # lo stesso tratto: lungo quanto quello della traccia (non un giro sull'altra linea che passa due volte)
            lq, lt = progressive(Q)[-1], (j - i) * H
            if abs(lq - lt) > 0.1 * lt + 5:
                continue
            out.append((i, j, Q))
    return out


def sostituisci(T, peso, pezzi, fisso=FISSO):
    """Traccia con i tratti [(i, j, punti)] sostituiti da quei punti, fissi (con quel peso). I tratti non si
    sovrappongono."""
    pezzi = sorted(pezzi, key=lambda x: x[0])
    outT, outW, k = [], [], 0
    for i, j, Q in pezzi:
        outT.append(T[k:i]); outW.append(peso[k:i])
        outT.append(Q); outW.append(np.full(len(Q), fisso))
        k = j + 1
    outT.append(T[k:]); outW.append(peso[k:])
    T2 = np.vstack([x for x in outT if len(x)])
    W2 = np.concatenate([x for x in outW if len(x)])
    # punti doppi (capi dei tratti sostituiti)
    keep = np.concatenate([[True], np.hypot(*np.diff(T2, axis=0).T) > 0.05])
    return T2[keep], W2[keep]


def valore(lo, hi, base):
    """Interasse nell'intervallo [lo, hi]: base se ci sta, altrimenti il valore a 10 cm più vicino a base."""
    if lo <= base <= hi:
        return base
    tondi = [v / 10 for v in range(math.ceil(lo * 10 - 1e-9), math.floor(hi * 10 + 1e-9) + 1)]
    return min(tondi, key=lambda v: abs(v - base)) if tondi else (lo + hi) / 2


def interasse_a_tratti(d, base, wmin, delta=DELTA):
    """Interasse costante a tratti vicino a d (per punto, ogni H metri), mai sotto wmin (per punto), il valore base
    (per punto) dove si può: [[i, j, valore]]."""
    base = np.broadcast_to(np.asarray(base, float), d.shape)
    lo_p = np.where(np.isnan(d), wmin, np.maximum(d - delta, wmin))
    hi_p = np.where(np.isnan(d), np.inf, np.maximum(d + delta, wmin))
    # prima i tratti dove ci sta l'interasse della linea, poi gli altri a pezzi costanti il più lunghi possibile
    ok = (lo_p <= base) & (base <= hi_p)
    pezzi = []
    for i, j in tratti(ok):
        pezzi.append([i, j, float(base[i])])
    altri = []
    for i, j in tratti(~ok):
        k = i
        while k <= j:
            lo, hi, q = -math.inf, math.inf, k
            while q <= j and max(lo, lo_p[q]) <= min(hi, hi_p[q]):
                lo, hi, q = max(lo, lo_p[q]), min(hi, hi_p[q]), q + 1
            altri.append([k, q - 1, valore(lo, hi, float(np.median(base[k:q])))])
            k = q
    pezzi = sorted(pezzi + altri)
    return regolarizza(pezzi, wmin)


def regolarizza(pezzi, wmin):
    """Pezzi uguali di fila uniti; un pezzo in mezzo più corto di PIANO (l'interasse andrebbe e verrebbe in OSCILLA
    metri) prende il valore del vicino più simile, mai sotto wmin: in OSM lì i due binari si allontanano per pochi metri
    (una curva disegnata diversa sui due binari), non c'è niente in mezzo."""
    def unisci(pp):
        out = []
        for p in pp:
            if out and abs(out[-1][2] - p[2]) < 1e-9:
                out[-1][1] = p[1]
            else:
                out.append(list(p))
        return out
    pezzi = unisci(pezzi)
    fermi = set()  # pezzi che wmin tiene diversi dai vicini
    while True:
        corti = [k for k in range(1, len(pezzi) - 1) if (pezzi[k][1] - pezzi[k][0]) * H < PIANO
                 and tuple(pezzi[k]) not in fermi
                 and abs(pezzi[k - 1][2] - pezzi[k][2]) + abs(pezzi[k + 1][2] - pezzi[k][2]) > 0.15]
        if not corti:
            return pezzi
        k = min(corti, key=lambda k: pezzi[k][1] - pezzi[k][0])
        a, b, v = pezzi[k]
        q = min((k - 1, k + 1), key=lambda q: abs(pezzi[q][2] - v))
        nv = max(pezzi[q][2], float(np.max(wmin[a:b + 1])))
        if nv == v:
            fermi.add((a, b, v))
        pezzi[k][2] = nv
        pezzi = unisci(pezzi)



def profilo(pezzi, n):
    """Interasse per punto, con le S (coseno) lunghe TRANS a cavallo dei cambi."""
    w = np.zeros(n)
    for a, b, v in pezzi:
        w[a:b + 1] = v
    m = int(TRANS / H / 2)
    for (a0, b0, v0), (a1, b1, v1) in zip(pezzi, pezzi[1:]):
        c = b0 + 0.5
        L = min(m, (b0 - a0) // 2, (b1 - a1) // 2)
        for i in range(max(0, int(c - L)), min(n, int(c + L) + 1)):
            u = min(1.0, max(0.0, (i - (c - L)) / (2 * L))) if L else 1.0
            w[i] = v0 + (v1 - v0) * (1 - math.cos(math.pi * u)) / 2
    return w


def doppio(A, B, libA, libB, base):
    """Tratti dove i due binari corrono nella stessa sede: per ciascuno l'asse rifatto e i due binari a interasse
    costante. libA, libB: punti liberi (non fissi e a più di LIBERO metri da un tratto fisso). Ai capi di ogni tratto,
    dove i binari di OSM si allontanano dall'interasse (CAPO), si raccordano per conto loro. Restituisce i pezzi da
    sostituire in A e in B e le note."""
    gB = Griglia(B)
    tA = tangenti(A)
    m = [None] * len(A)
    for i, p in enumerate(A):
        if not libA[i]:
            continue
        # in controsenso entro 45 gradi: nelle curve strette il binario interno gira prima
        v = gB.vicino(p, DOPPIO[1], tA[i], -0.7)
        if v and v[0] >= DOPPIO[0] and libB[v[1]] and libB[min(v[1] + 1, len(B) - 1)]:
            m[i] = v
    # buchi fino a BUCO metri tra due tratti (le curve strette, dove i binari di OSM si allontanano di più): il punto
    # più vicino dell'altro binario, in qualunque direzione; lì l'interasse è quello dei tratti accanto
    stretto = [x is not None for x in m]
    for i0, i1 in zip(*[iter([q for r in tratti(stretto, 0) for q in r][1:-1])] * 2) if any(stretto) else []:
        if (i1 - i0) * H > BUCO:
            continue
        for i in range(i0 + 1, i1):
            if libA[i]:
                v = gB.vicino(A[i], 10.0, tA[i], 0.0 - 1e-9)
                if v and libB[v[1]] and libB[min(v[1] + 1, len(B) - 1)]:
                    m[i] = v
    pezziA, pezziB, note = [], [], []
    for i0, i1 in tratti([x is not None for x in m], int(10 / H)):
        idx = [i for i in range(i0, i1 + 1) if m[i] is not None]
        if (i1 - i0) * H < TRATTO or len(idx) < 2:
            continue
        q = np.array([B[m[i][1]] + (B[m[i][1] + 1] - B[m[i][1]]) * m[i][2] for i in idx])
        a = A[idx]
        Mraw = (a + q) / 2
        draw = np.hypot(*(a - q).T)
        s_raw = progressive(Mraw)
        if s_raw[-1] < TRATTO:
            continue
        # asse ogni H metri; interasse di OSM lungo l'asse
        M = ricampiona(Mraw)
        sM = progressive(M)
        d = np.interp(sM, s_raw, draw)
        # dove il punto viene dai buchi l'interasse di OSM non conta
        buco = np.interp(sM, s_raw, np.array([0.0 if stretto[i] else 1.0 for i in idx])) > 0.5
        nM = normali(M)
        # da che parte sta A (di solito a destra dell'asse, nel suo verso)
        side = 1.0 if np.median(((np.interp(sM, s_raw, a[:, 0]) - M[:, 0]) * nM[:, 0]
                                 + (np.interp(sM, s_raw, a[:, 1]) - M[:, 1]) * nM[:, 1])) > 0 else -1.0
        # interasse della linea (o di quella sui cui binari corre) punto per punto
        bM = np.array([base(p) for p in M]) if callable(base) else np.full(len(M), float(base))
        # interasse minimo dal raggio del binario più stretto, sull'asse levigato
        Mf0, _ = raccorda(M, kmax=np.full(len(M), 1 / (R_FIT + 1.75)), giri=6)
        k = np.abs(curvatura(Mf0))
        r_in = np.where(k > 1e-9, 1 / np.maximum(k, 1e-9), math.inf) - bM / 2
        span = int(10 / H)
        rmin = np.array([r_in[max(0, i - span):i + span + 1].min() for i in range(len(M))])
        wmin = np.array([interasse_min(r) + 0.15 for r in rmin])
        pezzi = interasse_a_tratti(np.where(buco, np.nan, d), bM, wmin)
        # i pezzi corti ai capi sono i binari che si avvicinano o si allontanano: restano liberi
        while len(pezzi) > 1 and (pezzi[0][1] - pezzi[0][0]) * H < TRANS:
            del pezzi[0]
        while len(pezzi) > 1 and (pezzi[-1][1] - pezzi[-1][0]) * H < TRANS:
            del pezzi[-1]
        a0, a1 = pezzi[0][0], pezzi[-1][1]
        # ai capi, dove i binari di OSM cominciano ad allontanarsi (o ad avvicinarsi) dall'interasse costante, il
        # tratto finisce: lì si separano per conto loro
        while a0 < a1 and not buco[a0] and abs(d[a0] - pezzi[0][2]) > CAPO:
            a0 += 1
        while a1 > a0 and not buco[a1] and abs(d[a1] - pezzi[-1][2]) > CAPO:
            a1 -= 1
        pezzi = [[max(a, a0), min(b, a1), v] for a, b, v in pezzi if b >= a0 and a <= a1]
        if (a1 - a0) * H < TRATTO or not pezzi:
            continue
        if a0 or a1 < len(M) - 1:
            M, d, wmin, Mf0, buco = M[a0:a1 + 1], d[a0:a1 + 1], wmin[a0:a1 + 1], Mf0[a0:a1 + 1], buco[a0:a1 + 1]
            pezzi = [[a - a0, b - a0, v] for a, b, v in pezzi]
            sM = sM[a0:a1 + 1] - sM[a0]
            # i capi del tratto su A e su B: i punti di A più vicini ai capi dell'asse
            ka = int(np.argmin(np.hypot(*(A[idx] - M[0]).T))); kb = int(np.argmin(np.hypot(*(A[idx] - M[-1]).T)))
            idx = idx[ka:kb + 1]
        w = profilo(pezzi, len(M))
        # l'asse sta vicino a OSM quanto basta perché i due binari, a metà interasse, ci restino entro TOLL; nelle curve
        # dei buchi l'interasse di OSM non conta
        toll = np.where(buco, TOLL, np.maximum(0.1, TOLL - np.abs(w - d) / 2))
        Mf, rep = raccorda(M, toll=toll, kmax=1 / (R_FIT + w / 2), X0=Mf0)
        nf = normali(Mf)
        Aoff = Mf + nf * (side * w / 2)[:, None]
        Boff = (Mf - nf * (side * w / 2)[:, None])[::-1]
        # tratto della traccia di B da sostituire: dalle proiezioni dei capi (su B il capo d'arrivo viene prima)
        pezziA.append((idx[0], idx[-1], Aoff))
        pezziB.append((m[idx[-1]][1] + 1, m[idx[0]][1], Boff))
        note.append({'da': [round(v) for v in A[idx[0]]], 'a': [round(v) for v in A[idx[-1]]], 'metri': round(sM[-1]),
                     'interassi': [[round(a * H), round(b * H), round(v, 2)] for a, b, v in pezzi], 'asse': rep})
    return pezziA, pezziB, note


def stesso_binario(T, X, fisso):
    """Tratti della traccia T (un verso) sullo stesso binario dell'altro verso X (già rifatto, in controsenso, entro
    COMUNE[1] metri: i tronchi ai capolinea con un binario solo): [(i, j, punti di X rovesciati)]."""
    g = Griglia(X)
    tg = lisce(T)
    hit = [None] * len(T)
    for i, p in enumerate(T):
        if not fisso[i]:
            v = g.vicino(p, COMUNE[1] + 0.5, tg[i], -0.99)
            hit[i] = v
    out = []
    for i, j in tratti([h is not None for h in hit], 2):
        if (j - i) * H < 10:
            continue
        (_, a, ta), (_, b, tb) = hit[i], hit[j]
        # X va al contrario: b viene prima di a
        pa = X[a] + (X[a + 1] - X[a]) * ta
        pb = X[b] + (X[b + 1] - X[b]) * tb
        out.append((i, j, np.vstack([pa, X[b + 1:a + 1][::-1], pb])))
    return out


def rifai(tracce, base, altre=(), fisso=None):
    """I due binari di una linea rifatti secondo la regola.

    tracce: {1: punti, -1: punti} (metri); base: interasse della linea (m, o funzione del punto: sui binari di
    un'altra linea vale il suo); altre: binari già rifatti di altre linee
    (polilinee (n, 2), nel loro verso); fisso(p, t): i punti da tenere come sono (gli anelli della stazione), con la
    direzione t del binario.
    Restituisce ({1: punti, -1: punti}, note)."""
    T, W = {}, {}
    note = {'comuni': [], 'doppio': [], 'stesso': []}
    for d in (1, -1):
        T[d] = ricampiona(tracce[d])
        tg = lisce(T[d], 4)
        W[d] = np.array([INTOCCABILE if fisso and fisso(p, t) else 1.0 for p, t in zip(T[d], tg)])
        # niente tratti sulle altre linee a ridosso degli anelli fissi: tra i due resterebbe un pezzo libero troppo corto
        k = int(LIBERO / H)
        vicino_fisso = np.convolve((W[d] >= FISSO).astype(float), np.ones(2 * k + 1), mode='same') > 0
        pezzi = sopra_altre(T[d], [np.asarray(o, float) for o in altre], vicino_fisso)
        note['comuni'] += [{'verso': d, 'da': [round(v) for v in T[d][i]], 'a': [round(v) for v in T[d][j]]} for i, j, _ in pezzi]
        T[d], W[d] = sostituisci(T[d], W[d], pezzi, INTOCCABILE)
    # punti liberi per il doppio binario: lontani dai tratti fissi
    lib = {}
    for d in (1, -1):
        f = (W[d] >= FISSO).astype(float)
        k = int(LIBERO / H)
        lib[d] = np.convolve(f, np.ones(2 * k + 1), mode='same') == 0
    pA, pB, note['doppio'] = doppio(T[1], T[-1], lib[1], lib[-1], base)
    T[1], W[1] = sostituisci(T[1], W[1], pA)
    T[-1], W[-1] = sostituisci(T[-1], W[-1], pB)
    out, note['binari'] = {}, {}
    for d in (1, -1):
        if d == -1:
            # i tronchi dove i due versi usano lo stesso binario: quello del verso +1
            pezzi = stesso_binario(T[-1], out[1], W[-1] >= FISSO)
            note['stesso'] = [{'da': [round(v) for v in T[-1][i]], 'a': [round(v) for v in T[-1][j]]} for i, j, _ in pezzi]
            T[-1], W[-1] = sostituisci(T[-1], W[-1], pezzi, INTOCCABILE)
        Tr0, Wr = ricampiona_fissi(T[d], W[d])
        Tr, tl = sfuma(Tr0, Wr)
        # i tratti fissi della stazione e delle altre linee restano; quelli del doppio binario si accorciano dove la
        # curva accanto non ci sta col raggio minimo
        # prima si accorciano i tratti fissi vicino alle curve che non ci stanno; se resta una curva troppo stretta cede
        # la tolleranza (la traccia è una curva più stretta del minimo), e se non basta la traccia cede del tutto
        for giro in range(3):
            X, rep = raccorda(Tr, peso=Wr, toll=tl, cede_ok=False)
            if not rep['curve_strette']:
                break
            sv = progressive(Tr)
            libera = np.zeros(len(Tr), bool)
            for i in rep['curve_strette']:
                libera |= np.abs(sv - sv[i]) < 30
            libera &= (Wr >= FISSO) & (Wr < INTOCCABILE)
            if not libera.any():
                break
            Wr = np.where(libera, 1.0, Wr)
            Tr, tl = sfuma(Tr0, Wr)
        if rep['curve_strette']:
            X, rep = raccorda(Tr, peso=Wr, toll=tl)
        if rep['curve_strette']:
            X, rep = raccorda(Tr, peso=Wr, toll=tl, cede_peso=1.0)
        note['binari'][d] = rep
        out[d] = X
    for d in (1, -1):
        out[d] = out[d][semplifica(out[d], SEMPLIFICA)]
    return out, note


def ricampiona_fissi(T, W):
    """Traccia ogni H metri, nei tratti liberi e in quelli fissi (che possono avere i punti radi sui rettilinei: il
    raccordo vuole i punti a passo costante)."""
    outT, outW = [], []
    i, n = 0, len(T)
    while i < n:
        j = i
        while j + 1 < n and (W[j + 1] == W[i] if W[i] >= FISSO else W[j + 1] < FISSO):
            j += 1
        seg = T[i:j + 1]
        if W[i] >= FISSO:
            R = ricampiona(seg) if len(seg) > 1 else seg
            outT.append(R); outW.append(np.full(len(R), W[i]))
        else:
            # il tratto libero comincia dal punto fisso prima (se c'è) e finisce a quello dopo, esclusi
            a = T[i - 1:i] if i > 0 else seg[:0]
            b = T[j + 1:j + 2] if j + 1 < n else seg[:0]
            full = np.vstack([a, seg, b])
            R = ricampiona(full) if len(full) > 1 else full
            if len(a):
                R = R[1:]
            if len(b):
                R = R[:-1]
            outT.append(R); outW.append(np.ones(len(R)))
        i = j + 1
    T2 = np.vstack([x for x in outT if len(x)])
    W2 = np.concatenate([x for x in outW if len(x)])
    keep = np.concatenate([[True], np.hypot(*np.diff(T2, axis=0).T) > 0.05])
    return T2[keep], W2[keep]


def sfuma(T, W, F=SFUMA):
    """Traccia raccordata ai tratti fissi: dove un tratto libero comincia o finisce accanto a un tratto fisso, lo scarto
    di traverso tra i due si distribuisce sui primi F metri del tratto libero (coseno), così il binario non fa una S
    stretta per arrivare al tratto fisso."""
    T = T.copy()
    T0 = T.copy()
    fisso = W >= FISSO
    n = len(T)
    s = progressive(T)
    tg = tangenti(T)
    for i, j in tratti(~fisso):
        for capo, dentro, verso in ((i - 1, i, 1), (j + 1, j, -1)):
            if capo < 0 or capo >= n:
                continue
            # scarto di traverso tra il punto fisso e la retta della traccia libera nel primo punto
            dlt = T[capo] - T[dentro]
            t = tg[dentro]
            dlt = dlt - (dlt @ t) * t
            k = dentro
            while 0 <= k < n and not fisso[k] and abs(s[k] - s[dentro]) < F:
                u = abs(s[k] - s[dentro]) / F
                T[k] += dlt * (1 + math.cos(math.pi * u)) / 2
                k += verso
    # la tolleranza resta da OSM: dove la traccia si è spostata il raccordo ne ha di meno
    return T, np.maximum(0.25, TOLL + 0.1 - np.hypot(*(T - T0).T))


class Proiezione:
    """Metri (x verso est, y verso nord) attorno a (lat0, lon0), e ritorno."""
    M_LAT = 111130.0

    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.m_lon = 111320.0 * math.cos(math.radians(lat0))

    def xy(self, lat, lon):
        return ((lon - self.lon0) * self.m_lon, (lat - self.lat0) * self.M_LAT)

    def ll(self, x, y):
        return (self.lat0 + y / self.M_LAT, self.lon0 + x / self.m_lon)


class Segmenti:
    """Segmenti di più polilinee in celle: vicino(p, r) dice se ce n'è uno entro r."""

    def __init__(self, polilinee, cella=10.0):
        self.s, self.c, self.g = [], cella, {}
        for P in polilinee:
            for a, b in zip(P, P[1:]):
                k = len(self.s)
                self.s.append((a, b))
                for gx in range(int(min(a[0], b[0]) // cella), int(max(a[0], b[0]) // cella) + 1):
                    for gy in range(int(min(a[1], b[1]) // cella), int(max(a[1], b[1]) // cella) + 1):
                        self.g.setdefault((gx, gy), []).append(k)

    def vicino(self, p, r):
        c = self.c
        for gx in range(int((p[0] - r) // c), int((p[0] + r) // c) + 1):
            for gy in range(int((p[1] - r) // c), int((p[1] + r) // c) + 1):
                for k in self.g.get((gx, gy), ()):
                    a, b = self.s[k]
                    ux, uy = b[0] - a[0], b[1] - a[1]
                    l2 = ux * ux + uy * uy or 1e-12
                    t = max(0.0, min(1.0, ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / l2))
                    if math.hypot(a[0] + ux * t - p[0], a[1] + uy * t - p[1]) <= r:
                        return True
        return False
