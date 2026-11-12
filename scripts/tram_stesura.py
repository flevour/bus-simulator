"""Stesura di un binario del tram secondo la regola (docs/binari-tram.md, sezione 3): dalla traccia OSM, una polilinea
in metri (x verso est, z verso sud come nel gioco), a un binario fatto di rettilinei, clotoidi e archi.

1. la traccia si semplifica (Douglas-Peucker, DP_TOLL): i lati sono le tangenti, i vertici le svolte;
2. le svolte dello stesso verso troppo vicine per avere ognuna la sua curva diventano una svolta sola, all'incrocio delle
   due tangenti esterne, se la curva unita resta vicina alla traccia: una curva che OSM disegna con tanti punti diventa
   un arco solo. Dove no, restano due curve che si toccano senza clotoide in mezzo (curva composta). Due svolte di verso
   opposto troppo vicine (una S) si allontanano lungo le tangenti esterne;
3. a ogni svolta clotoide, arco, clotoide (lunghezza della clotoide secondo il raggio, clotoide()). Il raggio è il più
   grande che resta entro SCARTO_OK dalla traccia e ci sta tra le curve vicine; mai sotto R_MIN, e la curva lunga almeno
   SPARSA metri (più corta, per il controllo, è uno spigolo);
4. i capi sono liberi (dove la traccia finisce) o su un altro binario (gli scambi): lì il binario parte tangente all'altro
   e la punta può spostarsi lungo l'altro binario tra `da` e `a` metri dal nodo di OSM, così la curva resta centrata
   sulla svolta della traccia. Se con la clotoide non ci sta, la curva parte dalla punta con l'arco (lo scambio a
   cerniera); se nemmeno così, la tangente dopo si sposta parallela finché ci sta.

Solo libreria standard. La usa scripts/tram_depositi.py per i binari dei depositi.
"""
import math

R_MIN = 10.7       # m: il raggio minimo del Translohr è 10,5 m, anche negli scambi e in deposito; 0,2 m in più perché i
                   # punti arrotondati al centimetro (il gioco) non portino il raggio misurato sotto il minimo
SPARSA = 5.5       # m: lunghezza minima di una curva (il controllo conta come spigolo una svolta fatta per più di
                   # metà in 4 m: un arco senza clotoidi più corto di 4,5 m)
SVOLTA_MIN = math.radians(0.3)  # svolte più piccole non hanno curva: il vertice si toglie
DP_TOLL = 0.2      # m: tolleranza della semplificazione della traccia
SCARTO_OK = 0.3    # m: il raggio cresce finché la curva resta così vicina alla traccia
UNIONE_MAX = math.radians(150)  # svolte unite in una sola fino a questo angolo (oltre le tangenti si incrociano lontano)
UNIONE_SCARTO = 0.9  # m: due svolte si uniscono se la curva unita resta così vicina alla traccia
PASSO = 1.0        # m tra i punti delle curve
H = 0.05           # m: passo dell'integrazione delle clotoidi


def clotoide(R):
    """Lunghezza della clotoide per il raggio R (docs/binari-tram.md: di solito 10 m, 6 m a R 10,5, 8 a 12,5; sopra i
    400 m l'arco attacca diretto)."""
    if R > 400:
        return 0.0
    if R < 12:
        return 6.0
    if R < 16:
        return 8.0
    return 10.0


# ---------- vettori ----------
def sub(a, b): return (a[0] - b[0], a[1] - b[1])
def add(a, b): return (a[0] + b[0], a[1] + b[1])
def mul(a, k): return (a[0] * k, a[1] * k)
def dot(a, b): return a[0] * b[0] + a[1] * b[1]
def cross(a, b): return a[0] * b[1] - a[1] * b[0]
def norm(a): return math.hypot(a[0], a[1])


def unit(a):
    l = norm(a) or 1e-12
    return (a[0] / l, a[1] / l)


def angolo(u, v):
    """Svolta con il segno da u a v (radianti)."""
    return math.atan2(cross(u, v), dot(u, v))


def incrocio(p, u, q, v):
    """Incrocio della retta p + t u con la retta q + s v, o None se quasi parallele."""
    c = cross(u, v)
    if abs(c) < 1e-9:
        return None
    t = cross(sub(q, p), v) / c
    return add(p, mul(u, t))


def dist_seg(p, a, b):
    ab = sub(b, a)
    l2 = dot(ab, ab)
    t = 0.0 if l2 < 1e-12 else max(0.0, min(1.0, dot(sub(p, a), ab) / l2))
    return norm(sub(p, add(a, mul(ab, t))))


def dist_poly(p, P):
    return min(dist_seg(p, a, b) for a, b in zip(P, P[1:])) if len(P) > 1 else norm(sub(p, P[0]))


def lunghezza(P):
    return sum(norm(sub(b, a)) for a, b in zip(P, P[1:]))


def dp(P, toll=DP_TOLL):
    """Douglas-Peucker: gli indici dei punti tenuti."""
    keep = {0, len(P) - 1}
    stack = [(0, len(P) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        k, dmax = None, toll
        for q in range(i + 1, j):
            d = dist_seg(P[q], P[i], P[j])
            if d > dmax:
                k, dmax = q, d
        if k is not None:
            keep.add(k)
            stack += [(i, k), (k, j)]
    return sorted(keep)


# ---------- la curva a una svolta ----------
_cache = {}
_bassi = {}


def basso(delta, fi, fo):
    """Il raggio più piccolo con R_MIN e almeno SPARSA metri di curva (fi, fo: parte delle clotoidi d'entrata e d'uscita,
    0 se non c'è)."""
    if not fi and not fo:
        return R_MIN
    key = (delta, fi, fo)
    if key in _bassi:
        return _bassi[key]
    lung = lambda R: curva(delta, R, clotoide(R) * fi, clotoide(R) * fo, False)[3]
    lo = R_MIN
    if lung(lo) < SPARSA:
        hi = lo
        while lung(hi) < SPARSA and hi < 1e5:
            hi *= 2
        for _ in range(25):
            m = (lo + hi) / 2
            if lung(m) >= SPARSA:
                hi = m
            else:
                lo = m
        lo = hi
    _bassi[key] = lo
    return lo


def curva(delta, R, l1, l2, punti=True):
    """Clotoide l1, arco R, clotoide l2 che gira di delta (radianti, col segno), da (0, 0) verso +x. Se le clotoidi da
    sole girano più di delta si accorciano (curva fatta di due clotoidi). Restituisce (punti ogni PASSO, tangente
    d'entrata, tangente d'uscita, lunghezza): le tangenti sono le distanze dal vertice della svolta all'inizio e alla
    fine della curva. Con punti=False solo le misure (punti None)."""
    key = (round(delta, 9), round(R, 6), round(l1, 6), round(l2, 6), punti)
    if key in _cache:
        return _cache[key]
    a = abs(delta)
    if l1 + l2 > 2 * R * a:
        f = 2 * R * a / (l1 + l2)
        l1, l2 = l1 * f, l2 * f
    la = R * a - (l1 + l2) / 2     # ogni clotoide gira di l / 2R
    tot = l1 + la + l2
    n = max(100, min(1500, math.ceil(tot / H)))
    h = tot / n
    k = 1 / R

    def kappa(s):
        if s < l1:
            return k * s / l1
        if s > l1 + la:
            return k * max(0.0, tot - s) / l2 if l2 > 0 else k
        return k

    x = y = th = 0.0
    pts, prossimo = [(0.0, 0.0)], PASSO
    for i in range(n):
        s = i * h
        thm = th + (kappa(s) + kappa(s + h / 2)) / 2 * h / 2     # direzione a metà passo
        x += math.cos(thm) * h
        y += math.sin(thm) * h
        th += (kappa(s) + 4 * kappa(s + h / 2) + kappa(s + h)) / 6 * h
        if punti and s + h >= prossimo - 1e-9 and s + h < tot - PASSO / 2:
            pts.append((x, y))
            prossimo += PASSO
    pts.append((x, y))
    if a > 1e-9:
        t_out = y / math.sin(a)
        t_in = x - y / math.tan(a)
    else:
        t_in = t_out = tot / 2
    if delta < 0:
        pts = [(p[0], -p[1]) for p in pts]
    out = (pts if punti else None, t_in, t_out, tot)
    if len(_cache) > 200000:
        _cache.clear()
    _cache[key] = out
    return out


class Svolta:
    """Un vertice del poligono delle tangenti, con la sua curva: raggio R, clotoide d'entrata (ci) e d'uscita (co). Dove
    due curve dello stesso verso si toccano non c'è clotoide (curva composta: la curvatura salta da un raggio all'altro
    senza tornare dritta)."""

    def __init__(self, W, u, v):
        self.W, self.u, self.v = W, u, v
        self.delta = angolo(u, v)
        self.R = None
        self.ci = self.co = True
        self.fi = self.fo = 1.0         # clotoidi accorciate dove due curve non ci stanno

    def lunghezze(self, R):
        lc = clotoide(R)
        return (lc * self.fi if self.ci else 0.0), (lc * self.fo if self.co else 0.0)

    def curva(self, R=None, punti=True):
        R = R or self.R
        return curva(self.delta, R, *self.lunghezze(R), punti=punti)

    def tangenti(self, R=None):
        c = self.curva(R, False)
        return c[1], c[2]

    def basso(self):
        """Il raggio più piccolo ammesso: R_MIN e, se la curva sta da sola, almeno SPARSA metri di curva."""
        return basso(round(self.delta, 6), self.ci and self.fi, self.co and self.fo)

    def alto(self, dentro, fuori):
        """Il raggio più grande con le tangenti entro dentro e fuori (None se nemmeno il più piccolo ci sta)."""
        lo = self.basso()
        ok = lambda R: all(t <= l + 1e-9 for t, l in zip(self.tangenti(R), (dentro, fuori)))
        if not ok(lo):
            return None
        # la tangente è almeno quella dell'arco senza clotoidi
        hi = min(dentro, fuori) / max(math.tan(abs(self.delta) / 2), 1e-9) + 1e-6
        if hi <= lo or ok(hi):
            return max(lo, hi)
        for _ in range(25):
            m = (lo + hi) / 2
            if ok(m):
                lo = m
            else:
                hi = m
        return lo

    def posa(self, R=None):
        """Punti della curva in x, z."""
        pts, t_in, _, _ = self.curva(R)
        a = sub(self.W, mul(self.u, t_in))
        n = (-self.u[1], self.u[0])
        return [add(a, add(mul(self.u, p[0]), mul(n, p[1]))) for p in pts]


# ---------- un binario ----------
def poligono(W):
    """Svolte del poligono delle tangenti W (vertici interni)."""
    return [Svolta(W[i], unit(sub(W[i], W[i - 1])), unit(sub(W[i + 1], W[i]))) for i in range(1, len(W) - 1)]


def pulisci(W):
    """Via i vertici doppi e quelli quasi in linea."""
    out = [W[0]]
    for i in range(1, len(W) - 1):
        if norm(sub(W[i], out[-1])) < 1e-6:
            continue
        u, v = unit(sub(W[i], out[-1])), unit(sub(W[i + 1], W[i]))
        if norm(sub(W[i + 1], W[i])) < 1e-6 or abs(angolo(u, v)) < SVOLTA_MIN:
            continue
        out.append(W[i])
    out.append(W[-1])
    return out


def tmin(S, i):
    """Tangenti (entrata, uscita) della curva più stretta ammessa alla svolta i."""
    return S[i].tangenti(S[i].basso())


def clotoidi(S):
    """Niente clotoide tra due curve dello stesso verso che non stanno separate."""
    for s in S:
        s.ci = s.co = True
    for i in range(len(S) - 1):
        a, b = S[i], S[i + 1]
        if (a.delta > 0) == (b.delta > 0) and tmin(S, i)[1] + tmin(S, i + 1)[0] > norm(sub(b.W, a.W)):
            a.co = b.ci = False


def miglior_scarto(s, dentro, fuori, traccia):
    """Lo scarto più piccolo dalla traccia della curva alla svolta s, con le tangenti entro dentro e fuori."""
    lo, hi = s.basso(), s.alto(dentro, fuori)
    if hi is None:
        hi = lo
    return min(scarto(s.posa(lo * (hi / lo) ** (k / 6)), traccia) for k in range(7))


def unisci(W, traccia):
    """Svolte dello stesso verso troppo vicine per due curve con le loro clotoidi: una svolta sola all'incrocio delle
    tangenti esterne, se la curva unita resta entro UNIONE_SCARTO dalla traccia (o se nemmeno due curve che si toccano
    senza clotoide in mezzo ci stanno). Fino a UNIONE_MAX; oltre, o se unite si allontanano dalla traccia, restano due
    curve che si toccano senza clotoide in mezzo."""
    no = set()
    while True:
        S = poligono(W)
        best = None
        for i in range(len(S) - 1):
            a, b = S[i], S[i + 1]
            if (a.delta > 0) != (b.delta > 0) or abs(a.delta + b.delta) > UNIONE_MAX or (a.W, b.W) in no:
                continue
            serve = tmin(S, i)[1] + tmin(S, i + 1)[0]
            l = norm(sub(b.W, a.W))
            if serve > l and (best is None or serve - l > best[0]):
                best = (serve - l, i)
        if best is None:
            return W
        i = best[1] + 1          # in W la svolta S[k] è il vertice k + 1
        p = incrocio(W[i - 1], unit(sub(W[i], W[i - 1])), W[i + 1], unit(sub(W[i + 2], W[i + 1])))
        if p is None:
            return W
        a, b = S[i - 1], S[i]
        a.co = b.ci = False
        composta = a.tangenti(a.basso())[1] + b.tangenti(b.basso())[0] <= norm(sub(b.W, a.W))
        if composta:
            u = Svolta(p, unit(sub(p, W[i - 1])), unit(sub(W[i + 2], p)))
            if miglior_scarto(u, norm(sub(p, W[i - 1])), norm(sub(W[i + 2], p)), traccia) > UNIONE_SCARTO:
                no.add((a.W, b.W))
                continue
        W = W[:i] + [p] + W[i + 2:]


def allarga(W):
    """Due svolte di verso opposto (una S) troppo vicine per le loro curve: si allontanano lungo le tangenti esterne,
    così la tangente in mezzo si allunga e le svolte si fanno più piccole."""
    for _ in range(len(W)):
        S = poligono(W)
        clotoidi(S)
        fatto = True
        for i in range(len(S) - 1):
            a, b = S[i], S[i + 1]
            if (a.delta > 0) == (b.delta > 0):
                continue
            if tmin(S, i)[1] + tmin(S, i + 1)[0] <= norm(sub(b.W, a.W)) + 1e-6:
                continue
            j = i + 1                  # vertice di a in W
            # quanto si possono spostare: fino a metà del lato prima e dopo (tutto il lato verso un capo)
            l0 = norm(sub(W[j], W[j - 1]))
            l2 = norm(sub(W[j + 2], W[j + 1]))
            m0 = l0 * (0.9 if j - 1 == 0 else 0.5)
            m2 = l2 * (0.9 if j + 2 == len(W) - 1 else 0.5)

            def prova(x):
                V = list(W)
                V[j] = sub(W[j], mul(a.u, min(x, m0)))
                V[j + 1] = add(W[j + 1], mul(b.v, min(x, m2)))
                T = poligono(V)
                clotoidi(T)
                return V, tmin(T, i)[1] + tmin(T, i + 1)[0] <= norm(sub(V[j + 1], V[j]))
            hi = max(m0, m2)
            if not prova(hi)[1]:
                W = prova(hi)[0]
                continue
            lo = 0.0
            for _ in range(20):
                m = (lo + hi) / 2
                if prova(m)[1]:
                    hi = m
                else:
                    lo = m
            W = prova(hi)[0]
            fatto = False
            break
        if fatto:
            return W
    return W


def scarto(P, traccia):
    """Distanza massima tra la curva P e la traccia: dai punti della curva alla traccia e dai vertici della traccia
    vicini alla curva (entro 3 m dalla corda, tra i suoi capi) alla curva."""
    d = max(dist_poly(p, traccia) for p in P)
    a, b = P[0], P[-1]
    for q in traccia:
        if dist_seg(q, a, b) < 3 and dot(sub(q, a), sub(b, a)) > 0 and dot(sub(q, b), sub(a, b)) > 0:
            d = max(d, dist_poly(q, P))
    return d


def raggi(S, W, traccia, scambio_inizio=False, scambio_fine=False):
    """Il raggio di ogni svolta: il più grande entro SCARTO_OK dalla traccia che ci sta tra le vicine (prima in avanti,
    con alle vicine dopo la curva più stretta, poi all'indietro). Ai capi su un altro binario (scambio_inizio,
    scambio_fine) la curva, se con la clotoide non ci sta, parte dalla punta senza: come il ramo deviato dello scambio a
    cerniera, un arco dalla punta. Dove nemmeno le curve più strette ci stanno, le clotoidi tra le due si accorciano."""
    n = len(S)
    if not n:
        return
    clotoidi(S)
    lati = [norm(sub(W[i + 1], W[i])) for i in range(len(W) - 1)]
    if scambio_inizio and tmin(S, 0)[0] > lati[0]:
        S[0].ci = False
    if scambio_fine and tmin(S, n - 1)[1] > lati[-1]:
        S[-1].co = False
    for s in S:
        s.R = s.basso()
    # curve più strette che non ci stanno tra due svolte: clotoidi più corte in mezzo
    for i in range(n - 1):
        a, b = S[i], S[i + 1]
        for f in (0.75, 0.5, 0.25, 0.0):
            if a.tangenti()[1] + b.tangenti()[0] <= lati[i + 1]:
                break
            a.fo, b.fi = min(a.fo, f), min(b.fi, f)
            a.R, b.R = a.basso(), b.basso()

    def scegli(i, dentro, fuori):
        s = S[i]
        lo, hi = s.basso(), s.alto(dentro, fuori)
        if hi is None:
            s.R = lo
            return
        # dal più grande al più piccolo: il primo entro SCARTO_OK, o quello con lo scarto più piccolo
        cand = sorted({lo, hi} | {lo * (hi / lo) ** (k / 12) for k in range(1, 12)}, reverse=True)
        best = None
        for R in cand:
            e = scarto(s.posa(R), traccia)
            if e <= SCARTO_OK:
                best = (R, e)
                break
            if best is None or e < best[1] - 1e-3:
                best = (R, e)
        s.R = best[0]

    for giro in range(2):
        for i in (range(n) if giro == 0 else reversed(range(n))):
            dentro = lati[i] - (S[i - 1].tangenti()[1] if i > 0 else 0.0)
            fuori = lati[i + 1] - (S[i + 1].tangenti()[0] if i < n - 1 else 0.0)
            scegli(i, dentro, fuori)


def sposta(W, k, d, m):
    """La tangente tra i vertici k e k + 1 si sposta parallela finché il vertice k avanza di m lungo d (la sua tangente
    dall'altra parte); il vertice k + 1 resta sulla sua (o, se è un capo, si proietta)."""
    u = unit(sub(W[k + 1], W[k]))
    V = list(W)
    V[k] = add(W[k], mul(d, m))
    if k + 2 < len(W):
        q = incrocio(V[k], u, W[k + 1], unit(sub(W[k + 2], W[k + 1])))
        V[k + 1] = q if q is not None else add(W[k + 1], mul(d, m))
    else:
        V[k + 1] = add(V[k], mul(u, dot(sub(W[k + 1], V[k]), u)))
    return V


def stendi(traccia, inizio=None, fine=None):
    """Il binario lungo la traccia (punti x, z). inizio e fine: None (capo libero) o {'p': nodo, 'd': versore del binario
    lì nel verso della traccia, 'da': m, 'a': m}: il binario parte (o arriva) tangente a d in p + t d con t tra 'da' e
    'a'. Restituisce i punti: rettilinei coi soli capi, curve ogni PASSO."""
    Q = [traccia[0]]
    for p in traccia[1:]:
        if norm(sub(p, Q[-1])) > 0.05:
            Q.append(p)
    if len(Q) < 2:
        return list(Q)
    W = [Q[i] for i in dp(Q)]
    if inizio:
        p, d = inizio['p'], inizio['d']
        W = [add(p, mul(d, inizio['da'])), p] + W[1:]
    if fine:
        p, d = fine['p'], fine['d']
        W = W[:-1] + [p, add(p, mul(d, fine['a']))]
    W = pulisci(W)
    W = unisci(W, Q)
    W = pulisci(W)
    W = allarga(W)
    S = poligono(W)
    raggi(S, W, Q, bool(inizio), bool(fine))
    # capi su un altro binario: se la curva non ci sta tra la punta più lontana e la svolta, la tangente dopo la svolta
    # si sposta parallela e la svolta avanza (lo scarto da OSM è lo spostamento)
    for _ in range(2):
        cambiato = False
        if inizio and S and len(W) > 2:
            t = S[0].tangenti()[0]
            l = norm(sub(W[1], W[0]))
            if t > l + 1e-6:
                W = sposta(W, 1, inizio['d'], t - l + 0.01)
                cambiato = True
        if fine and S and len(W) > 2:
            t = S[-1].tangenti()[1]
            l = norm(sub(W[-1], W[-2]))
            if t > l + 1e-6:
                W = sposta(W[::-1], 1, mul(fine['d'], -1), t - l + 0.01)[::-1]
                cambiato = True
        if not cambiato:
            break
        S = poligono(W)
        raggi(S, W, Q, bool(inizio), bool(fine))
    out = [] if inizio and S else [W[0]]
    for s in S:
        P = s.posa()
        if out and norm(sub(P[0], out[-1])) < 0.05:
            out.pop()
        out += P
    if not (fine and S):
        out.append(W[-1])
    res = [out[0]]
    for p in out[1:]:
        if norm(sub(p, res[-1])) > 0.02:
            res.append(p)
    return res
