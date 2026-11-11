"""Binari del tram nel piazzale nuovo della stazione: due anelli regolari e concentrici al posto dei binari di OSM e
dello shape GTFS, che lì fanno S, si avvicinano a 2 m e si incrociano.

Il disegno da seguire è il rendering del progetto del piazzale (a parole in docs/linee-tram-nuove.md, sezione "Binari
della stazione"): anelli ovali attorno all'isola dei bus, lati lunghi dritti e paralleli, testate a semicerchio con i
binari concentrici a distanza costante, raccordi verso le vie con curve morbide.

* anello interno (SIR2 e SIR3): lo stadio (due lati dritti paralleli e due semicerchi) che segue meglio l'anello interno
  di OSM, le way RING;
* anello esterno (SIR1 verso nord, e SIR2 e SIR3 tra gli scambi e le vie): lo stesso stadio allargato di GAP metri;
* un binario che passa dalla stazione: i punti che corrono lungo gli anelli in senso antiorario, nella fascia dei due
  anelli, vanno sull'anello interno o su quello esterno (il più vicino); dove passano dall'uno all'altro (gli scambi tra
  gli anelli) uno scostamento a S lungo LX metri; dove il binario arriva da una via o ci va, un raccordo di Hermite tra
  il binario com'era RACC metri prima e l'anello RACC metri dopo.

Lo usano scripts/tram_linee.py (SIR2 e SIR3, data/tram-linee-nuove.json) e scripts/build_map.py (SIR1): binari del
gioco e sede nella pianta delle strade seguono gli stessi anelli.
"""
import json, math

# anello interno in OSM (way del cantiere): lato nord con le due testate, lato sud
RING = (1332833374, 966705987, 966705990)
GAP = 3.4     # m tra i due anelli: l'interasse del doppio binario nel gioco (TRAM.lane * 2), le due corsie rosse si
              # toccano come nel rendering (in OSM i lati lunghi stanno a 4,0 m, con una striscia d'asfalto in mezzo)
SPLIT = 1.2   # m dall'anello interno: più vicino è interno, più lontano esterno (in OSM l'esterno sta a 2-3 m)
BAND = 2.0    # m dentro l'anello interno: oltre, il binario non è sull'anello
BAND_OUT = 5.0  # m fuori dall'anello esterno: alle testate i binari di OSM che vanno alle vie girano più stretti
              # (raggio 8 m a nord-ovest) e più in fuori dell'anello; dentro la fascia seguono la testata
ALIGN = 0.85  # coseno minimo tra il binario e il verso dell'anello (antiorario)
LX = 24.0     # m: lunghezza dello scostamento a S tra i due anelli
RACC_IN = 14.0   # m: raccordo tra una via e l'anello, sull'anello
RACC_OUT = 20.0  # m: e sulla via
MINRUN = 6.0  # m: tratti più corti (dentro o fuori dalla fascia, su un anello o sull'altro) si uniscono ai vicini
STEP = 1.0    # m tra i punti dei binari rifatti
NEAR = 45.0   # m: binari più lontani di così dall'anello interno non si toccano
SIMPLE = 0.03 # m: tolleranza della semplificazione dei punti rifatti

M_LAT = 111130.0


class Stazione:
    def __init__(self, ways_ll):
        """ways_ll: le way (punti lat, lon) dell'anello interno di OSM. Ricampionate ogni metro: ogni metro di binario
        pesa uguale (i nodi OSM sono fitti all'inizio delle curve e radi sui rettilinei)."""
        allp = [p for w in ways_ll for p in w]
        self.lat0 = sum(p[0] for p in allp) / len(allp)
        self.lon0 = sum(p[1] for p in allp) / len(allp)
        self.m_lon = 111320.0 * math.cos(math.radians(self.lat0))
        pts = [q for w in ways_ll for q in resample([self.loc(*p) for p in w], 1.0)]
        # asse lungo: direzione principale dei punti, poi la pendenza comune dei due lati dritti
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        sxx = sum((p[0] - cx) ** 2 for p in pts); syy = sum((p[1] - cy) ** 2 for p in pts)
        sxy = sum((p[0] - cx) * (p[1] - cy) for p in pts)
        th = 0.5 * math.atan2(2 * sxy, sxx - syy)
        self.c = (cx, cy)
        for _ in range(3):
            self.u = (math.cos(th), math.sin(th)); self.v = (-self.u[1], self.u[0])
            ab = [self.ab(p) for p in pts]
            amax = max(abs(a) for a, _ in ab)
            sides = [(a, b) for a, b in ab if abs(a) < 0.55 * amax]
            n = [(a, b) for a, b in sides if b > 0]; s = [(a, b) for a, b in sides if b <= 0]
            # retta per lato con la stessa pendenza k: b = q_lato + k a
            def fit(g):
                ma = sum(a for a, _ in g) / len(g); mb = sum(b for _, b in g) / len(g)
                return ma, mb, sum((a - ma) * (b - mb) for a, b in g), sum((a - ma) ** 2 for a, _ in g)
            fn, fs = fit(n), fit(s)
            k = (fn[2] + fs[2]) / (fn[3] + fs[3])
            th += math.atan(k)
        self.u = (math.cos(th), math.sin(th)); self.v = (-self.u[1], self.u[0])
        ab = [self.ab(p) for p in pts]
        amax = max(abs(a) for a, _ in ab)
        sides = [(a, b) for a, b in ab if abs(a) < 0.55 * amax]
        med = lambda xs: sorted(xs)[len(xs) // 2]
        bn = med([b for a, b in sides if b > 0]); bs = med([b for a, b in sides if b <= 0])
        a0, a1 = min(a for a, _ in ab), max(a for a, _ in ab)
        self.r = (bn - bs) / 2
        mid_a, mid_b = (a0 + a1) / 2, (bn + bs) / 2
        self.c = (self.c[0] + self.u[0] * mid_a + self.v[0] * mid_b, self.c[1] + self.u[1] * mid_a + self.v[1] * mid_b)
        self.L = (a1 - a0) / 2 - self.r
        self.P = 4 * self.L + 2 * math.pi * self.r

    @classmethod
    def from_osm(cls, path, ways=RING):
        ww = [[(p['lat'], p['lon']) for p in e['geometry']] for e in json.load(open(path))['elements']
              if e['type'] == 'way' and e['id'] in ways]
        return cls(ww) if ww else None

    # coordinate: (lat, lon) -> metri (x est, y nord) -> (a lungo l'asse, b verso il lato nord)
    def loc(self, lat, lon):
        return ((lon - self.lon0) * self.m_lon, (lat - self.lat0) * M_LAT)

    def ll(self, x, y):
        return (self.lat0 + y / M_LAT, self.lon0 + x / self.m_lon)

    def ab(self, p):
        dx, dy = p[0] - self.c[0], p[1] - self.c[1]
        return (dx * self.u[0] + dy * self.u[1], dx * self.v[0] + dy * self.v[1])

    def xy(self, a, b):
        return (self.c[0] + self.u[0] * a + self.v[0] * b, self.c[1] + self.u[1] * a + self.v[1] * b)

    def at(self, t, w=0.0):
        """Punto dell'anello alla progressiva t (antiorario, da inizio lato sud) a w metri verso l'esterno, con la
        direzione di marcia."""
        L, r = self.L, self.r
        t %= self.P
        if t < 2 * L:
            a, b, ta, tb, na, nb = -L + t, -r, 1, 0, 0, -1
        elif t < 2 * L + math.pi * r:
            f = -math.pi / 2 + (t - 2 * L) / r
            a, b, ta, tb, na, nb = L + r * math.cos(f), r * math.sin(f), -math.sin(f), math.cos(f), math.cos(f), math.sin(f)
        elif t < 4 * L + math.pi * r:
            a, b, ta, tb, na, nb = L - (t - 2 * L - math.pi * r), r, -1, 0, 0, 1
        else:
            f = math.pi / 2 + (t - 4 * L - math.pi * r) / r
            a, b, ta, tb, na, nb = -L + r * math.cos(f), r * math.sin(f), -math.sin(f), math.cos(f), math.cos(f), math.sin(f)
        p = self.xy(a + na * w, b + nb * w)
        d = (self.u[0] * ta + self.v[0] * tb, self.u[1] * ta + self.v[1] * tb)
        return p, d

    def proj(self, p):
        """(t, w) del punto: progressiva sull'anello interno e scostamento verso l'esterno."""
        a, b = self.ab(p)
        L, r = self.L, self.r
        if abs(a) <= L:
            return ((2 * L + math.pi * r + (L - a)), b - r) if b >= 0 else (a + L, -b - r)
        if a > L:
            f = math.atan2(b, a - L)
            return 2 * L + (f + math.pi / 2) * r, math.hypot(a - L, b) - r
        f = math.atan2(b, a + L)
        if f < 0:
            f += 2 * math.pi
        return 4 * L + math.pi * r + (f - math.pi / 2) * r, math.hypot(a + L, b) - r

    def fix(self, pts):
        """Binario (punti x, y in metri, nel sistema di loc) rifatto sugli anelli dove passa dalla stazione. Fuori dalla
        stazione i punti restano quelli di prima; dentro sono ogni STEP metri, semplificati a SIMPLE metri."""
        near = [i for i, p in enumerate(pts) if self.proj(p)[1] < NEAR]
        if len(pts) < 2 or not near:
            return pts
        i0, i1 = max(0, near[0] - 1), min(len(pts) - 1, near[-1] + 1)
        mid = self.fix_dense(resample(pts[i0:i1 + 1], STEP))
        keep = rdp(mid, SIMPLE)
        return pts[:i0] + [mid[k] for k in keep] + pts[i1 + 1:]

    def fix_dense(self, S):
        n = len(S)
        tw = [self.proj(p) for p in S]
        on = []
        for i, (t, w) in enumerate(tw):
            a, b = S[max(0, i - 1)], S[min(n - 1, i + 1)]
            l = math.dist(a, b) or 1
            d = self.at(t)[1]
            al = ((b[0] - a[0]) * d[0] + (b[1] - a[1]) * d[1]) / l
            on.append(al > ALIGN and -BAND < w < GAP + BAND_OUT)
        on = merge_short(on, int(MINRUN / STEP))
        if not any(on):
            return S
        out = list(S)
        i = 0
        while i < n:
            if not on[i]:
                i += 1
                continue
            j = i
            while j < n and on[j]:
                j += 1
            self.run(S, tw, out, i, j)
            i = j
        return out

    def run(self, S, tw, out, i, j):
        """Tratto [i, j) lungo gli anelli: progressiva continua, anello per punto, scambi a S, raccordi alle vie."""
        ts = [tw[i][0]]
        for k in range(i + 1, j):
            t = tw[k][0]
            while t < ts[-1] - self.P / 2:
                t += self.P
            ts.append(t)
        lev = merge_short([tw[k][1] >= SPLIT for k in range(i, j)], int(MINRUN / STEP))
        # scambi: dove si passa da un anello all'altro, centrati dove il binario di prima attraversa SPLIT (stesso punto
        # per tutte le linee che passano dallo stesso scambio)
        changes = []
        for k in range(1, len(lev)):
            if lev[k] == lev[k - 1]:
                continue
            tc = ts[k]
            for q in range(max(1, k - 8), min(len(lev), k + 8)):
                w1, w2 = tw[i + q - 1][1], tw[i + q][1]
                if (w1 - SPLIT) * (w2 - SPLIT) <= 0 and w1 != w2:
                    tc = ts[q - 1] + (SPLIT - w1) / (w2 - w1) * (ts[q] - ts[q - 1])
                    break
            changes.append((tc, GAP if lev[k] else -GAP))
        w0 = GAP if lev[0] else 0.0

        def w_at(t):
            w = w0
            for tc, dw in changes:
                x = min(1, max(0, (t - tc + LX / 2) / LX))
                w += dw * (1 - math.cos(math.pi * x)) / 2
            return w
        new = [self.at(t, w_at(t))[0] for t in ts]
        # raccordi con le vie: Hermite tra il binario di prima (RACC_OUT metri fuori) e l'anello (RACC_IN metri dentro).
        # Un tratto troppo corto per i due raccordi resta com'era (un binario che sfiora l'anello)
        m, mo = int(RACC_IN / STEP), int(RACC_OUT / STEP)
        if j - i <= 2 * m:
            return
        if i > 0:
            a = max(0, i - mo)
            new_a = raccordo(S[a], tangent(S, a), new[m], tangent(new, m), i + m - a)
            for k in range(a, i + m):
                out[k] = new_a[k - a]
            for k in range(i + m, j):
                out[k] = new[k - i]
        else:
            for k in range(i, j):
                out[k] = new[k - i]
        if j < len(S):
            b = min(len(S) - 1, j + mo)
            q = j - i - m
            new_b = raccordo(new[q], tangent(new, q), S[b], tangent(S, b), b - (j - m))
            for k in range(j - m, b):
                out[k] = new_b[k - (j - m)]


def rdp(pts, eps):
    """Douglas-Peucker: indici dei punti da tenere."""
    keep = {0, len(pts) - 1}
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        L = math.hypot(bx - ax, by - ay) or 1e-9
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            d = abs((pts[i][0] - ax) * (by - ay) - (pts[i][1] - ay) * (bx - ax)) / L
            if d > best:
                best, bi = d, i
        if best > eps:
            keep.add(bi)
            stack += [(a, bi), (bi, b)]
    return sorted(keep)


def resample(pts, step):
    out = [pts[0]]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        l = math.dist(a, b)
        if l < 1e-9:
            continue
        s = step - acc
        while s <= l:
            out.append((a[0] + (b[0] - a[0]) * s / l, a[1] + (b[1] - a[1]) * s / l))
            s += step
        acc = l - (s - step)
    if math.dist(out[-1], pts[-1]) > 1e-6:
        out.append(pts[-1])
    return out


def merge_short(flags, k):
    """Tratti di flag uguali più corti di k punti presi dal tratto prima (in testa: da quello dopo)."""
    f = list(flags)
    n = len(f)
    i = 0
    runs = []
    while i < n:
        j = i
        while j < n and f[j] == f[i]:
            j += 1
        runs.append([i, j, f[i]])
        i = j
    for r in range(len(runs)):
        i, j, v = runs[r]
        if j - i < k and len(runs) > 1:
            nv = runs[r - 1][2] if r > 0 else runs[r + 1][2]
            for x in range(i, j):
                f[x] = nv
            runs[r][2] = nv
    return f


def tangent(pts, i):
    a, b = pts[max(0, i - 2)], pts[min(len(pts) - 1, i + 2)]
    l = math.dist(a, b) or 1
    return ((b[0] - a[0]) / l, (b[1] - a[1]) / l)


def raccordo(p0, d0, p1, d1, n):
    """n punti da p0 (compreso) verso p1 (escluso): rettilineo, arco a raggio costante, rettilineo. Il raggio è il più
    grande che sta tra le due rette (p0, d0) e (p1, d1); se le rette non si incontrano davanti, una cubica di Hermite."""
    cr = d0[0] * d1[1] - d0[1] * d1[0]
    if abs(cr) < 0.05:
        return hermite(p0, d0, p1, d1, n)
    # incrocio X = p0 + s d0 = p1 - u d1
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    s = (dx * d1[1] - dy * d1[0]) / cr
    u = (d0[0] * dy - d0[1] * dx) / cr
    if s <= 0 or u <= 0:
        return hermite(p0, d0, p1, d1, n)
    X = (p0[0] + d0[0] * s, p0[1] + d0[1] * s)
    th = math.acos(max(-1.0, min(1.0, d0[0] * d1[0] + d0[1] * d1[1])))
    T = min(s, u)
    R = T / math.tan(th / 2)
    q1 = (X[0] - d0[0] * T, X[1] - d0[1] * T)
    side = 1 if cr > 0 else -1  # centro a sinistra (cr > 0) o a destra
    c = (q1[0] - d0[1] * R * side, q1[1] + d0[0] * R * side)
    l1, la, l2 = s - T, R * th, u - T
    tot = l1 + la + l2
    out = []
    for k in range(n):
        d = tot * k / n
        if d < l1:
            out.append((p0[0] + d0[0] * d, p0[1] + d0[1] * d))
        elif d < l1 + la:
            f = (d - l1) / R * side
            vx, vy = q1[0] - c[0], q1[1] - c[1]
            out.append((c[0] + vx * math.cos(f) - vy * math.sin(f), c[1] + vx * math.sin(f) + vy * math.cos(f)))
        else:
            e = d - l1 - la
            q2 = (X[0] + d1[0] * T, X[1] + d1[1] * T)
            out.append((q2[0] + d1[0] * e, q2[1] + d1[1] * e))
    return out


def hermite(p0, d0, p1, d1, n):
    """n punti da p0 (compreso) verso p1 (escluso) sulla cubica di Hermite con le direzioni d0, d1."""
    c = math.dist(p0, p1)
    out = []
    for k in range(n):
        s = k / n
        h00 = 2 * s ** 3 - 3 * s ** 2 + 1; h10 = s ** 3 - 2 * s ** 2 + s
        h01 = -2 * s ** 3 + 3 * s ** 2; h11 = s ** 3 - s ** 2
        out.append((h00 * p0[0] + h10 * c * d0[0] + h01 * p1[0] + h11 * c * d1[0],
                    h00 * p0[1] + h10 * c * d0[1] + h01 * p1[1] + h11 * c * d1[1]))
    return out


def zona(st, xz):
    """Zona della stazione per il gioco: i centri delle due testate (x, z del gioco con xz(lat, lon)), il raggio
    dell'anello interno e NEAR. Dentro (a meno di near metri dall'anello) i binari sono già quelli di questo modulo."""
    a, b = st.xy(-st.L, 0), st.xy(st.L, 0)
    r2 = lambda v: round(v, 2)
    return {'a': [r2(v) for v in xz(*st.ll(*a))], 'b': [r2(v) for v in xz(*st.ll(*b))], 'r': r2(st.r), 'near': NEAR}


def fix_ll(st, path_ll):
    """Binario (lat, lon) rifatto sugli anelli."""
    if not st:
        return path_ll
    return [st.ll(*p) for p in st.fix([st.loc(*p) for p in path_ll])]
