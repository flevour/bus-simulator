"""Regola del profilo dei cavalcavia (docs/cavalcavia.md) e controllo di quanto la mappa se ne allontana.

Un cavalcavia è un gruppo di archi della rete in quota (quote dei nodi in `nodeH`, da scripts/street_surfaces.py) che
si toccano: impalcato, rampe e raccordi delle strade che ci si innestano. Lo si percorre lungo ogni strada che lo
attraversa, da terra a terra, e lungo ogni binario del tram che ci sale: la quota del profilo è quella che vede chi
guida, il terreno della variante "via" (src/world/terrain.js) più la quota della rete (strade: `nodeH` lungo gli archi;
binari: la quota della strada in quota che affiancano). Per ogni cavalcavia conta:
  * onde: la quota scende e risale (o sale e riscende) di almeno ONDA m invece di salire, stare in piano e scendere;
  * pendenze oltre il massimo del tipo di strada (o del tram);
  * raccordi verticali sotto il raggio minimo, sui dossi e nelle conche;
  * binari fuori quota: il binario più alto o più basso della strada che affianca sullo stesso impalcato;
  * scarti dal DTM: fuori dai ponti la strada più lontana di DTM_TOLL m dal terreno del DTM senza ritocchi.

Le reti sono due:
  * i dati (src/data/padova-map.json, data/tram-linee-nuove.json, data/dtm-padova.json): li misura
    scripts/verifica_mappa.py con rete_dati(); il terreno "via" si ricostruisce qui come lo fa il gioco, e i binari
    hanno la quota della strada in quota che affiancano (_tram_heights di scripts/street_surfaces.py);
  * il gioco: tests/cavalcavia.spec.js scrive il terreno "via" del gioco e i binari con le loro quote (TramTrack.h, dopo
    la media di setHeights) e chiama questo script con --gioco. Le strade vengono dalla mappa in tutti e due i casi.

Ogni caso ha il posto (coordinate del gioco, la via o il binario, la fermata del tram vicina) e un peso, quanto è oltre
la regola; i cavalcavia peggiori sono quelli con la somma dei pesi più alta.

I casi noti stanno in data/eccezioni/cavalcavia.json (scripts/eccezioni.py), uno per riga con la chiave
"cavalcavia | tipo | via o binario @ x,z" e il perché del gruppo: "strade" (uguali nei dati e nel gioco), "binari dati"
e "binari gioco". Lo script esce con errore se trova un caso fuori dall'elenco, anche a totale uguale, o se un caso
dell'elenco è sparito (va tolto). Un caso resta lo stesso se si sposta fino a TOLL metri. Chi cambia quote, terreno o
binari riscrive l'elenco con --aggiorna (per il gioco: ECCEZIONI=aggiorna npx playwright test cavalcavia) e scrive il
perché dei casi nuovi che restano.

  python3 scripts/cavalcavia.py [--gioco cavalcavia-gioco.json] [--elenco] [--json rapporto.json] [--aggiorna]
  python3 scripts/cavalcavia.py [--gioco ...] --profilo X Z      # i profili che passano da (X, Z), ogni 5 m

Senza argomenti misura i dati. Solo libreria standard: gira anche nel job delle prove, dove shapely e numpy non ci sono.
"""
import argparse
import base64
import json
import math
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from binari_tram import Griglia, raggruppa, xz_da  # noqa: E402
from eccezioni import Elenco, chiave  # noqa: E402

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------- numeri della regola (docs/cavalcavia.md, con le fonti) ----------
# tipo di strada del DM 5 novembre 2001 dalla classe OSM della rete (build_map.DRIVE): trunk con il nome (tangenziali,
# corsi) urbana di scorrimento D, trunk senza nome rampa di svincolo (DM 19 aprile 2006); primary, secondary, tertiary
# urbana di quartiere E; le altre locali F. Il tram ha i suoi numeri (docs/binari-tram.md)
TIPO = {0: 'D', 1: 'E', 2: 'E', 3: 'E'}  # le altre classi: 'F'
# pendenza massima: DM 2001 § 5.3.1 (ambito urbano), DM 2006 tab. 8 (rampe a 40-50 km/h, in salita), SIR3 per il tram
PENDENZA = {'D': 0.06, 'rampa': 0.07, 'E': 0.08, 'F': 0.10, 'tram': 0.06}
# raggi minimi dei raccordi verticali (m). Strade: DM 2001 § 5.3.2-5.3.4 alla velocità di progetto D 60, E 50, F 40 km/h,
# con la distanza di visibilità per l'arresto (§ 5.1.2): dossi con l'occhio a 1,10 m e l'ostacolo a 0,10 m, conche con
# i fari a 0,5 m e 1°; rampe: DM 2006 tab. 8 a 40 km/h; tram: progetto del SIR3
R_DOSSO = {'D': 1350.0, 'rampa': 1000.0, 'E': 800.0, 'F': 450.0, 'tram': 120.0}
R_CONCA = {'D': 1450.0, 'rampa': 500.0, 'E': 1030.0, 'F': 690.0, 'tram': 350.0}
ONDA = 0.10       # m: una discesa (o una salita) più piccola di così non è un'onda
TRATTO = 100.0    # m: una discesa o una salita più corta di così, tra due svolte, è un tratto breve
QUOTA_TOLL = 0.10  # m: strada e binari sullo stesso impalcato
DTM_TOLL = 0.5    # m: scarto massimo dal DTM fuori dai ponti

# ---------- come si misura ----------
PASSO = 1.0       # m: i profili si campionano ogni metro
MARGINE = 60.0    # m di strada a terra prima e dopo il cavalcavia, nel profilo
PIEDE = 30.0      # m: le misure vanno fin qui oltre il tratto in quota (il piede delle rampe e quello che c'è subito dopo)
IN_QUOTA = 0.05   # m: da questa quota della rete un arco è in quota (come e.elev nel gioco)
DECK_MIN = 0.6    # m: da qui in su strada e binari stanno su un impalcato (street_surfaces.DECK_MIN)
CORDA_P = 10.0    # m: pendenza su 10 m (come le pendenze dei binari)
CORDA_R = 20.0    # m: raggio da due corde di 20 m (un gradino di quota del terreno, 5,6 cm, dà più di 3 km)
PONTE_VICINO = 15.0  # m: vicino a un ponte il DTM non dice la quota della strada (spalle, travi)
AFFIANCA = 9.0    # m oltre metà carreggiata: il binario affianca la strada (City.nearElevatedHeight)
PARALLELO = 0.7   # seno massimo dell'angolo tra binario e strada perché siano paralleli (come sopra)
UNITO = 3         # m: casi più vicini di così sono lo stesso caso
TOLL = 4.0        # m: un caso dell'elenco delle eccezioni resta lo stesso se si sposta fino a qui (due casi dello stesso
#                   tipo sulla stessa via stanno ad almeno UNITO + 2 m)
TIPI = ['onde', 'pendenze', 'raccordi', 'fuori_quota', 'scarti_dtm']
NOMI = {
    'onde': f'onde (discese e risalite di almeno {ONDA:g} m)'.replace('.', ','),
    'pendenze': 'pendenze oltre il massimo',
    'raccordi': 'raccordi sotto il raggio minimo',
    'fuori_quota': f'binari fuori quota di oltre {QUOTA_TOLL:g} m'.replace('.', ','),
    'scarti_dtm': f'scarti dal DTM oltre {DTM_TOLL:g} m'.replace('.', ','),
}
# tipi per strade e binari (i binari non hanno lo scarto dal DTM: il terrapieno delle linee nuove nel DTM non c'è)
TIPI_DI = {'strade': ['onde', 'pendenze', 'raccordi', 'scarti_dtm'], 'binari': ['onde', 'pendenze', 'raccordi', 'fuori_quota']}


def tipo_di(cls, nome):
    return 'rampa' if cls == 0 and not nome else TIPO.get(cls, 'F')


# ---------- terreno ----------
class Griglia10:
    """Una griglia di quote del gioco (un byte per cella: quota = byte * scale + offset)."""

    def __init__(self, g, dati=None):
        self.nx, self.nz, self.step, self.x0, self.z0 = g['nx'], g['nz'], g['step'], g['x0'], g['z0']
        self.scale, self.offset = g['scale'], g['offset']
        self.b = base64.b64decode(dati if dati is not None else g['data'])

    def cella(self, i, j):
        return self.b[j * self.nx + i]

    def at(self, x, z):
        """Quota (m) interpolata come la texture del gioco (Terrain.at)."""
        fx = max(0.0, min(self.nx - 1.001, (x - self.x0) / self.step))
        fz = max(0.0, min(self.nz - 1.001, (z - self.z0) / self.step))
        i, j = int(fx), int(fz)
        tx, tz = fx - i, fz - j
        c = self.cella
        v = (c(i, j) * (1 - tx) + c(i + 1, j) * tx) * (1 - tz) + (c(i, j + 1) * (1 - tx) + c(i + 1, j + 1) * tx) * tz
        return v * self.scale + self.offset


class Via(Griglia10):
    """La variante "via" del terreno ricostruita dalla griglia della mappa come in src/world/terrain.js: chiusura
    morfologica di raggio `close` celle, poi i ponti lunghi che alzano le celle vicine. Calcolata solo nelle celle che
    servono (i profili dei cavalcavia), con le finestre tagliate ai bordi come nel gioco."""

    def __init__(self, g):
        super().__init__(g)
        self.r = g.get('close', 0)
        self._m, self._d, self._e, self._c = {}, {}, {}, {}
        self.ponti = defaultdict(list)  # cella -> segmenti dei ponti che la toccano
        for br in g.get('bridges', []):
            w = br[0]
            for k in range(1, len(br) - 5, 3):
                ax, az, ah, bx, bz, bh = br[k:k + 6]
                i0 = max(0, math.floor((min(ax, bx) - w - self.x0) / self.step))
                i1 = min(self.nx - 1, math.ceil((max(ax, bx) + w - self.x0) / self.step))
                j0 = max(0, math.floor((min(az, bz) - w - self.z0) / self.step))
                j1 = min(self.nz - 1, math.ceil((max(az, bz) + w - self.z0) / self.step))
                for j in range(j0, j1 + 1):
                    for i in range(i0, i1 + 1):
                        self.ponti[(i, j)].append((w, ax, az, ah, bx, bz, bh))
        # celle fissate dopo chiusura e ponti (le piattaforme dei cavalcavia): righe [j, i0, byte, byte, ...]
        for r in g.get('via', []):
            for n, v in enumerate(r[2:]):
                self._c[(r[1] + n, r[0])] = v

    def _finestra(self, f, memo, fonte, i, j, lungo_x):
        k = (i, j)
        v = memo.get(k)
        if v is None:
            r = self.r
            if lungo_x:
                v = f(fonte(a, j) for a in range(max(0, i - r), min(self.nx - 1, i + r) + 1))
            else:
                v = f(fonte(i, a) for a in range(max(0, j - r), min(self.nz - 1, j + r) + 1))
            memo[k] = v
        return v

    def cella(self, i, j):
        k = (i, j)
        v = self._c.get(k)
        if v is not None:
            return v
        b, nx = self.b, self.nx
        m = lambda a, c: self._finestra(max, self._m, lambda p, q: b[q * nx + p], a, c, True)
        d = lambda a, c: self._finestra(max, self._d, m, a, c, False)
        e = lambda a, c: self._finestra(min, self._e, d, a, c, True)
        v = self._finestra(min, {}, e, i, j, False) if self.r else b[j * nx + i]
        for w, ax, az, ah, bx, bz, bh in self.ponti.get(k, ()):
            x, z = self.x0 + i * self.step, self.z0 + j * self.step
            ex, ez = bx - ax, bz - az
            l2 = ex * ex + ez * ez or 1
            t = max(0.0, min(1.0, ((x - ax) * ex + (z - az) * ez) / l2))
            if math.hypot(x - ax - ex * t, z - az - ez * t) > w:
                continue
            q = math.floor((ah + (bh - ah) * t - self.offset) / self.scale + 0.5)  # Math.round
            if q > v:
                v = min(255, q)
        self._c[k] = v
        return v


# ---------- la rete ----------
class Rete:
    """Strade della mappa (nodi, archi, quote), terreno "via" e DTM, binari del tram con le loro quote."""

    def __init__(self, nome, M, via, dtm):
        self.nome, self.M, self.via, self.dtm = nome, M, via, dtm
        n = M['nodes']
        self.nodi = [(n[i], n[i + 1]) for i in range(0, len(n), 2)]
        E = M['edges']
        self.archi = [E[k:k + 8] for k in range(0, len(E), 8)]
        self.lung = [math.dist(self.nodi[e[0]], self.nodi[e[1]]) for e in self.archi]
        self.H = {i: h for i, h in M.get('nodeH', [])}
        # quota sopra il terreno lungo gli archi in quota: progressive (cm) e quote (mm); senza, lineare tra i nodi
        self.EH = {k: (ss, qs) for k, ss, qs in M.get('edgeH', [])} if 'edgeH' in M else None
        # strutture dichiarate dalla build (scripts/profilo_cavalcavia.py): archi dei cavalcavia con le loro rampe
        self.strutture = M.get('cavalcavia')
        self.nomi = M['names']
        self.at = defaultdict(list)  # archi carrabili per nodo
        for k, e in enumerate(self.archi):
            if e[2] != 8 and self.lung[k] > 0.05:
                self.at[e[0]].append(k)
                self.at[e[1]].append(k)
        # archi delle strutture dichiarate: la loro quota è il profilo (EH) o zero; gli altri, lineare tra i nodi
        self.dichiarati = {k for s in self.strutture or [] for k in s['archi']}
        self.in_quota = sorted(set(self.EH or ()) | {k for k, e in enumerate(self.archi) if k not in self.dichiarati and e[2] != 8
                                                    and (self.H.get(e[0], 0) > IN_QUOTA or self.H.get(e[1], 0) > IN_QUOTA)})
        # archi dove si misura: quelli delle strutture dichiarate e quelli in quota
        self.misurati = self.dichiarati | set(self.in_quota)
        self.binari = []   # {'id', 'verso', 'pts': [(x, z)], 'quote': quota ogni 5 m sopra il terreno, o None nei dati}
        self.fermate = []  # (x, z, nome) del tram, per dare il nome ai posti
        self.strade = Griglia([(self.nodi[e[0]], self.nodi[e[1]]) for e in self.archi], 20.0)

    def via_di(self, k):
        i = self.archi[k][4]
        return self.nomi[i] if i < len(self.nomi) else ''

    def h(self, n):
        return self.H.get(n, 0.0)

    def rel(self, k, t):
        """Quota sopra il terreno alla frazione t dell'arco k (come edgeHeight nel gioco)."""
        p = self.EH.get(k) if self.EH else None
        if not p:
            if k in self.dichiarati:
                return 0.0
            e = self.archi[k]
            return self.h(e[0]) + (self.h(e[1]) - self.h(e[0])) * t
        ss, qs = p
        s = t * self.lung[k] * 100
        lo, hi = 0, len(ss) - 1
        if s <= ss[0]:
            return qs[0] / 1000
        if s >= ss[hi]:
            return qs[hi] / 1000
        while hi - lo > 1:
            m = (lo + hi) // 2
            if ss[m] <= s:
                lo = m
            else:
                hi = m
        return (qs[lo] + (qs[hi] - qs[lo]) * (s - ss[lo]) / ((ss[hi] - ss[lo]) or 1)) / 1000


def rete_dati(M=None):
    """La rete dei dati: strade e quote della mappa, terreno "via" ricostruito, binari con la quota della strada in quota
    che affiancano (la regola di street_surfaces._tram_heights)."""
    M = M or json.load(open(os.path.join(RADICE, 'src/data/padova-map.json')))
    R = Rete('dati', M, Via(M['terrain']), dtm())
    xz = xz_da(M['origin'])
    t = M['tram']
    tracce = [('SIR1', 1, [(t[0][i], t[0][i + 1]) for i in range(0, len(t[0]), 2)]),
              ('SIR1', -1, [(t[1][i], t[1][i + 1]) for i in range(0, len(t[1]), 2)])]
    R.fermate += [(s[0], s[1], s[2]) for s in M['tramStops']]
    nuove = json.load(open(os.path.join(RADICE, 'data/tram-linee-nuove.json')))
    for L in nuove['linee']:
        for d, v in zip((1, -1), L['versi']):
            tracce.append((L['id'], d, [xz(*p) for p in v['percorso']]))
            R.fermate += [(*xz(f['lat'], f['lon']), f['nome']) for f in v['fermate']]
    for lid, d, P in tracce:
        R.binari.append({'id': lid, 'verso': d, 'pts': P, 'quote': None})
    return R


def rete_gioco(G, M=None):
    """La rete del gioco dal file di tests/cavalcavia.spec.js: terreno "via" del gioco, binari (TramTrack.paths) con le
    quote ogni 5 m (TramTrack.h). Le strade dalla mappa, come le prende il gioco."""
    M = M or json.load(open(os.path.join(RADICE, 'src/data/padova-map.json')))
    T = G['terreno']
    R = Rete('gioco', M, Griglia10(T, T['via']), dtm())
    for B in G['binari']:
        for d in (1, -1):
            R.binari.append({'id': B['id'], 'verso': d, 'pts': [tuple(p) for p in B['paths'][str(d)]], 'quote': B['quote'][str(d)]})
        R.fermate += [tuple(f) for f in B.get('fermate', [])]
    return R


def dtm():
    p = os.path.join(RADICE, 'data/dtm-padova.json')
    return Griglia10(json.load(open(p))) if os.path.exists(p) else None


def strada_accanto(R, p, verso):
    """(quota della rete, arco) della strada in quota più vicina a p e quasi parallela al verso, entro metà carreggiata
    più AFFIANCA; (0, None) se non c'è."""
    L = math.hypot(*verso) or 1
    dx, dz = verso[0] / L, verso[1] / L
    best, h, kb = 1e9, 0.0, None
    for k in R.strade.vicini(p, 30.0):
        e = R.archi[k]
        if k not in R.misurati or e[2] == 8:
            continue
        (ax, az), (bx, bz) = R.nodi[e[0]], R.nodi[e[1]]
        ux, uz = bx - ax, bz - az
        l = math.hypot(ux, uz) or 1e-9
        if abs(dx * uz / l - dz * ux / l) > PARALLELO:
            continue
        t = max(0.0, min(1.0, ((p[0] - ax) * ux + (p[1] - az) * uz) / (l * l)))
        d = math.hypot(ax + ux * t - p[0], az + uz * t - p[1])
        if d < e[3] / 2 + AFFIANCA and d < best:
            best, h, kb = d, R.rel(k, t), k
    return h, kb


# ---------- i cavalcavia ----------
def cavalcavia(R):
    """Gruppi di archi in quota che si toccano, con un nome (la via più lunga dei ponti, se no degli archi) e il centro."""
    dichiarate = [{'archi': set(s['archi']), 'nome': s['id'], 'id': s['id'], 'x': s['x'], 'z': s['z'], 'dichiarata': True,
                   'metri': round(sum(R.lung[k] for k in s['archi']))} for s in R.strutture or []]
    at = defaultdict(list)
    liberi = [k for k in R.in_quota if k not in R.dichiarati]
    for k in liberi:
        for n in R.archi[k][:2]:
            at[n].append(k)
    visti, out = set(), []
    for k0 in liberi:
        if k0 in visti:
            continue
        gruppo, st = set(), [k0]
        while st:
            k = st.pop()
            if k in gruppo:
                continue
            gruppo.add(k)
            for n in R.archi[k][:2]:
                st += [j for j in at[n] if j not in gruppo]
        visti |= gruppo
        nomi, ponti = Counter(), Counter()
        for k in gruppo:
            nm = R.via_di(k)
            if nm:
                nomi[nm] += R.lung[k]
                if R.archi[k][5] & 4:
                    ponti[nm] += R.lung[k]
        nome = (ponti or nomi or Counter({'senza nome': 1})).most_common(1)[0][0]
        L = sum(R.lung[k] for k in gruppo) or 1
        cx = sum((R.nodi[R.archi[k][0]][0] + R.nodi[R.archi[k][1]][0]) / 2 * R.lung[k] for k in gruppo) / L
        cz = sum((R.nodi[R.archi[k][0]][1] + R.nodi[R.archi[k][1]][1]) / 2 * R.lung[k] for k in gruppo) / L
        out.append({'archi': gruppo, 'nome': nome, 'x': round(cx), 'z': round(cz), 'metri': round(L)})
    # stesso nome: si distinguono con il posto
    conta = Counter(c['nome'] for c in out)
    usati = {c['id'] for c in dichiarate}
    for c in out:
        c['id'] = c['nome'] if conta[c['nome']] == 1 and c['nome'] not in usati else f"{c['nome']} ({c['x']}, {c['z']})"
    return dichiarate + out


def prossimo(R, cur, k, gruppo):
    """L'arco che prosegue dal nodo cur arrivando lungo k: il più dritto entro 45°, meglio se con lo stesso nome e, sul
    cavalcavia, in quota."""
    a, b = R.nodi[R.archi[k][0] if R.archi[k][1] == cur else R.archi[k][1]], R.nodi[cur]
    la = math.dist(a, b) or 1
    dx, dz = (b[0] - a[0]) / la, (b[1] - a[1]) / la
    best, bd = None, 0.7
    for j in R.at[cur]:
        if j == k:
            continue
        f = R.archi[j]
        o = R.nodi[f[1] if f[0] == cur else f[0]]
        lo = math.dist(b, o) or 1
        c = ((o[0] - b[0]) * dx + (o[1] - b[1]) * dz) / lo
        if c < 0.7:
            continue
        c += 0.2 * (R.via_di(j) == R.via_di(k)) + 0.3 * (k in gruppo and j in gruppo)
        if c > bd:
            best, bd = j, c
    return best


def cammina(R, n0, k0, gruppo):
    """Nodi dal nodo n0 lungo l'arco k0, sul cavalcavia e poi per MARGINE metri a terra."""
    seq, cur, k, terra = [n0], n0, k0, 0.0
    visti = {n0}
    while True:
        e = R.archi[k]
        nxt = e[1] if e[0] == cur else e[0]
        if nxt in visti:
            break
        seq.append(nxt)
        visti.add(nxt)
        if k not in gruppo:
            terra += R.lung[k]
            if terra >= MARGINE:
                break
        j = prossimo(R, nxt, k, gruppo)
        if j is None:
            break
        cur, k = nxt, j
    return seq


def itinerari(R, C):
    """Le strade che attraversano il cavalcavia: da ogni piede (nodo a terra del gruppo, o in quota senza seguito) lungo
    ogni arco del gruppo, fino a terra dall'altra parte; prima MARGINE metri della strada che arriva. Una volta sola per
    insieme di archi del gruppo."""
    G = C['archi']
    piedi = defaultdict(list)
    for k in G:
        for n in R.archi[k][:2]:
            if len(R.at[n]) == 1 or (any(j not in G for j in R.at[n]) if C.get('dichiarata') else R.h(n) <= IN_QUOTA):
                piedi[n].append(k)
    visti, out = set(), []
    for n0, ks in piedi.items():
        for k0 in ks:
            avanti = cammina(R, n0, k0, G)
            # la strada che arriva al piede: l'arco a terra più in linea con k0, all'indietro
            j = None
            if len(avanti) > 1:
                o = avanti[1]
                fin = [i for i in R.at[n0] if i != k0 and i not in G]
                best = -0.7
                for i in fin:
                    f = R.archi[i]
                    m = f[1] if f[0] == n0 else f[0]
                    u = (R.nodi[m][0] - R.nodi[n0][0], R.nodi[m][1] - R.nodi[n0][1])
                    v = (R.nodi[o][0] - R.nodi[n0][0], R.nodi[o][1] - R.nodi[n0][1])
                    c = (u[0] * v[0] + u[1] * v[1]) / ((math.hypot(*u) * math.hypot(*v)) or 1)
                    if c < best:
                        best, j = c, i
            indietro = cammina(R, n0, j, G) if j is not None else [n0]
            seq = indietro[::-1] + avanti[1:]
            usati = frozenset(k for k in archi_di(R, seq) if k in G)
            if usati and usati not in visti:
                visti.add(usati)
                out.append(seq)
    return out


def archi_di(R, seq):
    out = []
    for a, b in zip(seq, seq[1:]):
        k = next((k for k in R.at[a] if b in R.archi[k][:2]), None)
        out.append(k)
    return out


def profilo_strada(R, seq):
    """Punti ogni PASSO metri lungo i nodi seq: (x, z, quota, quota della rete, tipo di strada, sul ponte)."""
    pts = []
    for (a, b), k in zip(zip(seq, seq[1:]), archi_di(R, seq)):
        A, B = R.nodi[a], R.nodi[b]
        L = math.dist(A, B)
        e = R.archi[k]
        n = max(1, round(L / PASSO))
        for i in range(n):
            t = i / n
            x, z = A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t
            rel = R.rel(k, t if e[0] == a else 1 - t)
            # in galleria o in sottopasso (layer negativo) il DTM vede quello che sta sopra, non la strada
            pts.append({'x': x, 'z': z, 'q': R.via.at(x, z) + rel, 'rel': rel, 'tipo': tipo_di(e[2], R.via_di(k)), 'ponte': bool(e[5] & 4),
                        'sotto': bool(e[5] & 8 or e[7] < 0), 'arco': k})
    if seq:
        x, z = R.nodi[seq[-1]]
        last = pts[-1] if pts else {'tipo': 'F', 'ponte': False, 'arco': None}
        k = last['arco']
        rel = R.rel(k, 1.0 if R.archi[k][1] == seq[-1] else 0.0) if k is not None else R.h(seq[-1])
        pts.append({'x': x, 'z': z, 'q': R.via.at(x, z) + rel, 'rel': rel, 'tipo': last['tipo'], 'ponte': last['ponte'], 'arco': k})
    return pts


def profili_binari(R, cav):
    """Tratti dei binari in quota (più MARGINE metri per parte), punti ogni PASSO metri con la quota del binario, la
    quota della strada in quota che affianca (se c'è) e il cavalcavia a cui appartengono (quello della strada più
    vicina). La quota del binario: nel gioco TramTrack.h, ogni 5 m; nei dati quella della strada che affianca."""
    di = {k: c['id'] for c in cav for k in c['archi']}
    out = defaultdict(list)
    for B in R.binari:
        P, Q = B['pts'], B['quote']
        cum = [0.0]
        for a, b in zip(P, P[1:]):
            cum.append(cum[-1] + math.dist(a, b))
        L = cum[-1]

        def accanto(s):
            x, z, dx, dz = punto(P, cum, s)
            return x, z, strada_accanto(R, (x, z), (dx, dz))
        quota = (lambda s: interp(Q, s / 5.0)) if Q else (lambda s: accanto(s)[2][0])
        # tratti in quota, cercati ogni 5 m
        # con le strutture dichiarate: dove il binario affianca una loro strada, anche a terra
        su = [s for s in frange(0, L, 5.0) if quota(s) > IN_QUOTA or accanto(s)[2][1] in R.dichiarati]
        if not su:
            continue
        tratti, a, b = [], su[0], su[0]
        for s in su[1:]:
            if s - b > 2 * MARGINE:
                tratti.append((a, b))
                a = s
            b = s
        tratti.append((a, b))
        for a, b in tratti:
            pts = []
            for s in frange(max(0.0, a - MARGINE), min(L, b + MARGINE), PASSO):
                x, z, (hr, k) = accanto(s)
                h = quota(s) if Q else hr
                t = R.via.at(x, z)
                pts.append({'x': x, 'z': z, 'q': t + h, 'rel': h, 'tipo': 'tram', 'ponte': False,
                            'strada': t + hr if k is not None else None, 'strada_rel': hr, 'arco': k})
            ks = Counter(p['arco'] for p in pts if p['arco'] in di)
            if not ks:
                continue
            out[di[ks.most_common(1)[0][0]]].append({'binario': f"{B['id']} verso {'+1' if B['verso'] > 0 else '-1'}", 'pts': pts})
    return out


def frange(a, b, passo):
    s = a
    while s <= b + 1e-9:
        yield s
        s += passo


def interp(Q, f):
    f = max(0.0, min(len(Q) - 1, f))
    i = int(f)
    t = f - i
    return Q[i] + ((Q[min(len(Q) - 1, i + 1)]) - Q[i]) * t


def punto(P, cum, s):
    lo, hi = 0, len(cum) - 1
    while hi - lo > 1:
        m = (lo + hi) // 2
        if cum[m] <= s:
            lo = m
        else:
            hi = m
    a, b = P[lo], P[hi]
    l = cum[hi] - cum[lo] or 1
    t = max(0.0, min(1.0, (s - cum[lo]) / l))
    return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / l, (b[1] - a[1]) / l


# ---------- misure ----------
def campo(pts, gruppo, dichiarate=False):
    """Indici del tratto da misurare: dal primo all'ultimo punto in quota del cavalcavia (archi del gruppo), più PIEDE
    metri per parte."""
    su = [i for i, p in enumerate(pts) if p['arco'] in gruppo and (dichiarate or p['rel'] > IN_QUOTA)]
    if not su:
        return None
    k = round(PIEDE / PASSO)
    return max(0, su[0] - k), min(len(pts) - 1, su[-1] + k)


def estremi(q, i0, i1, soglia=ONDA):
    """Punti di svolta del profilo tra i0 e i1 (zigzag): massimi e minimi dopo i quali la quota torna indietro di almeno
    `soglia`, più l'ultimo (non confermato). [(indice, +1 massimo / -1 minimo)]."""
    out, verso, lo, hi, ext = [], 0, i0, i0, i0
    for i in range(i0 + 1, i1 + 1):
        if verso == 0:
            lo = i if q[i] < q[lo] else lo
            hi = i if q[i] > q[hi] else hi
            if q[hi] - q[lo] >= soglia:
                # il primo: un minimo se poi si è saliti, un massimo se si è scesi
                out.append((lo, -1) if hi > lo else (hi, 1))
                verso, ext = (1, hi) if hi > lo else (-1, lo)
        elif verso == 1:
            if q[i] > q[ext]:
                ext = i
            elif q[ext] - q[i] >= soglia:
                out.append((ext, 1))
                verso, ext = -1, i
        else:
            if q[i] < q[ext]:
                ext = i
            elif q[i] - q[ext] >= soglia:
                out.append((ext, -1))
                verso, ext = 1, i
    if verso:
        out.append((ext, verso))
    return out


def onde(pts, i0, i1):
    """Le conche del profilo: minimi con la quota che scende e risale di almeno ONDA, tra due massimi veri (non il primo
    o l'ultimo punto di svolta del tratto misurato: fuori dal piede la strada può salire, e il raccordo in basso è
    giusto), con la discesa o la salita attorno più corta di TRATTO. Il profilo di un cavalcavia sale, sta in piano e
    scende: un minimo così è un'onda (una conca o, su una rampa, un gradino). Una conca lunga è la strada che torna a
    terra tra due cavalcavia, o una livelletta che le altre misure controllano."""
    q = [p['q'] for p in pts]
    E = estremi(q, i0, i1)
    casi = []
    for n in range(2, len(E) - 2):
        i, s = E[n]
        sx, dx = E[n - 1][0], E[n + 1][0]
        if s != -1:
            continue
        prof = min(q[sx] - q[i], q[dx] - q[i])
        if prof < ONDA or min(i - sx, dx - i) * PASSO >= TRATTO:
            continue
        casi.append({'tipo': 'onde', 'i': i, 'profondita': round(prof, 2), 'metri': round((dx - sx) * PASSO), 'peso': round(prof / ONDA, 2)})
    return casi


def pendenze(pts, i0, i1):
    q = [p['q'] for p in pts]
    k = round(CORDA_P / 2 / PASSO)
    p = [None] * len(pts)
    for i in range(max(i0, k), min(i1, len(pts) - 1 - k) + 1):
        p[i] = (q[i + k] - q[i - k]) / (2 * k * PASSO)
    oltre = [v is not None and abs(v) > PENDENZA[pts[i]['tipo']] for i, v in enumerate(p)]
    casi = []
    for a, b in raggruppa(oltre):
        i = max(range(a, b + 1), key=lambda i: abs(p[i] or 0))
        casi.append({'tipo': 'pendenze', 'i': i, 'pendenza': round(abs(p[i]) * 100, 1), 'massimo': round(PENDENZA[pts[i]['tipo']] * 100),
                     'metri': round((b - a + 1) * PASSO), 'peso': round(abs(p[i]) / PENDENZA[pts[i]['tipo']], 2)})
    return casi


def raccordi(pts, i0, i1):
    """Raccordi verticali sotto il raggio minimo: il raggio da due corde di CORDA_R metri attorno al punto (giusto per un
    raccordo parabolico; per uno spigolo dice la corda diviso il salto di pendenza)."""
    q = [p['q'] for p in pts]
    k = round(CORDA_R / PASSO)
    r = [None] * len(pts)
    for i in range(max(i0, k), min(i1, len(pts) - 1 - k) + 1):
        d = (q[i + k] - q[i]) / CORDA_R - (q[i] - q[i - k]) / CORDA_R
        if abs(d) > 1e-9:
            r[i] = CORDA_R / d  # > 0 conca, < 0 dosso
    sotto = [v is not None and (v > 0 and v < R_CONCA[pts[i]['tipo']] or v < 0 and -v < R_DOSSO[pts[i]['tipo']]) for i, v in enumerate(r)]
    casi = []
    for a, b in raggruppa(sotto, round(CORDA_R / PASSO)):
        for segno, nome, minimo in ((1, 'conca', R_CONCA), (-1, 'dosso', R_DOSSO)):
            idx = [i for i in range(a, b + 1) if sotto[i] and r[i] * segno > 0]
            if not idx:
                continue
            i = min(idx, key=lambda i: abs(r[i]))
            casi.append({'tipo': 'raccordi', 'i': i, 'forma': nome, 'raggio': round(abs(r[i])), 'minimo': round(minimo[pts[i]['tipo']]),
                         'metri': round((idx[-1] - idx[0] + 1) * PASSO), 'peso': round(minimo[pts[i]['tipo']] / abs(r[i]), 2)})
    return casi


def fuori_quota(pts, i0, i1):
    """Binario e strada che affianca sullo stesso impalcato (uno dei due da DECK_MIN in su) a quote diverse."""
    d = [None] * len(pts)
    for i in range(i0, i1 + 1):
        p = pts[i]
        if p.get('strada') is not None and max(p['rel'], p['strada_rel']) >= DECK_MIN:
            d[i] = p['q'] - p['strada']
    oltre = [v is not None and abs(v) > QUOTA_TOLL for v in d]
    casi = []
    for a, b in raggruppa(oltre):
        i = max(range(a, b + 1), key=lambda i: abs(d[i] or 0))
        casi.append({'tipo': 'fuori_quota', 'i': i, 'scarto': round(d[i], 2), 'metri': round((b - a + 1) * PASSO), 'peso': round(abs(d[i]) / QUOTA_TOLL, 2)})
    return casi


def scarti_dtm(R, pts, i0, i1):
    """Fuori dai ponti (e a più di PONTE_VICINO metri da loro) la strada sta sul terreno o sul terrapieno, che il DTM
    vede: scarti oltre DTM_TOLL."""
    if not R.dtm:
        return []
    ponte = [p['ponte'] or p.get('sotto') for p in pts]
    k = round(PONTE_VICINO / PASSO)
    vicino = [any(ponte[max(0, i - k):i + k + 1]) for i in range(len(pts))]
    d = [None] * len(pts)
    for i in range(i0, i1 + 1):
        if not vicino[i]:
            d[i] = pts[i]['q'] - R.dtm.at(pts[i]['x'], pts[i]['z'])
    oltre = [v is not None and abs(v) > DTM_TOLL for v in d]
    casi = []
    for a, b in raggruppa(oltre):
        if (b - a + 1) * PASSO < 5:
            continue
        i = max(range(a, b + 1), key=lambda i: abs(d[i] or 0))
        casi.append({'tipo': 'scarti_dtm', 'i': i, 'scarto': round(d[i], 2), 'metri': round((b - a + 1) * PASSO), 'peso': round(abs(d[i]) / DTM_TOLL, 2)})
    return casi


def misura(R):
    """Per ogni cavalcavia i casi delle strade e dei binari: {id: {'nome', 'x', 'z', 'metri', 'casi': [...]}}."""
    cav = cavalcavia(R)
    binari = profili_binari(R, cav)
    altri = {k for C in cav for k in C['archi']}
    out = {}
    for C in cav:
        casi = []
        G = C['archi']
        # i casi sugli archi in quota di un altro cavalcavia sono di quello (gli itinerari sconfinano di MARGINE metri)
        altrove = lambda caso, pts: pts[caso['i']]['arco'] in altri and pts[caso['i']]['arco'] not in G
        for seq in itinerari(R, C):
            pts = profilo_strada(R, seq)
            c = campo(pts, G, bool(C.get('dichiarata')))
            if not c:
                continue
            for caso in onde(pts, *c) + pendenze(pts, *c) + raccordi(pts, *c) + scarti_dtm(R, pts, *c):
                if not altrove(caso, pts):
                    casi.append(posa(caso, pts, 'strade', R.via_di(pts[caso['i']]['arco']) or 'strada senza nome'))
        for T in binari.get(C['id'], []):
            pts = T['pts']
            c = campo(pts, G, bool(C.get('dichiarata')))
            if not c:
                continue
            for caso in onde(pts, *c) + pendenze(pts, *c) + raccordi(pts, *c) + fuori_quota(pts, *c):
                if not altrove(caso, pts):
                    casi.append(posa(caso, pts, 'binari', T['binario']))
        # lo stesso posto trovato da più itinerari: il caso più pesante
        casi.sort(key=lambda c: -c['peso'])
        tenuti = []
        for c in casi:
            if not any(o['su'] == c['su'] and o['tipo'] == c['tipo'] and math.dist(o['p'], c['p']) < UNITO + 2 for o in tenuti):
                tenuti.append(c)
        for c in tenuti:
            c['cavalcavia'] = C['id']
            c['x'], c['z'] = round(c['p'][0]), round(c['p'][1])
            c['luogo'] = luogo(R, c['p'])
            del c['p']
        out[C['id']] = {'nome': C['nome'], 'x': C['x'], 'z': C['z'], 'metri': C['metri'], 'casi': tenuti}
    return out


def posa(caso, pts, su, dove):
    p = pts[caso.pop('i')]
    return {**caso, 'su': su, 'dove': dove, 'p': (p['x'], p['z'])}


def luogo(R, p):
    """Fermata del tram più vicina, se è vicina."""
    if not R.fermate:
        return ''
    f = min(R.fermate, key=lambda f: math.dist(p, f[:2]))
    d = math.dist(p, f[:2])
    return f'fermata {f[2]}' if d < 30 else f'{d:.0f} m da {f[2]}' if d < 300 else ''


def conta(misure):
    """{'strade': {tipo: n}, 'binari': {tipo: n}} su tutti i cavalcavia, e lo stesso per cavalcavia."""
    tot = {su: {t: 0 for t in TIPI_DI[su]} for su in TIPI_DI}
    per = {}
    for cid, C in misure.items():
        v = {su: {t: 0 for t in TIPI_DI[su]} for su in TIPI_DI}
        for c in C['casi']:
            v[c['su']][c['tipo']] += 1
            tot[c['su']][c['tipo']] += 1
        per[cid] = v
    return tot, per


def peggiori(misure, n=10):
    """I cavalcavia con la somma dei pesi più alta."""
    return sorted(misure.items(), key=lambda kv: -sum(c['peso'] for c in kv[1]['casi']))[:n]


def descrivi(c):
    v = {'onde': lambda: f"conca di {c['profondita']:g} m in {c['metri']} m",
         'pendenze': lambda: f"pendenza {c['pendenza']:g}% (massimo {c['massimo']}%) per {c['metri']} m",
         'raccordi': lambda: f"{c['forma']} di raggio {c['raggio']} m (minimo {c['minimo']}) per {c['metri']} m",
         'fuori_quota': lambda: f"binario {c['scarto']:+g} m rispetto alla strada per {c['metri']} m",
         'scarti_dtm': lambda: f"{c['scarto']:+g} m dal DTM per {c['metri']} m"}[c['tipo']]()
    luogo = f", {c['luogo']}" if c['luogo'] else ''
    return f"{c['dove'] or c['su']}: {v}, ({c['x']}, {c['z']}){luogo}, peso {c['peso']:g}"


def chiave_di(c):
    """La chiave di un caso nell'elenco delle eccezioni: cavalcavia, tipo, via o binario e posto."""
    return chiave(f"{c['cavalcavia']} | {c['tipo']} | {c['dove']}", c['x'], c['z'])


def rapporto(R, elenco=False, json_out=None, aggiorna=False):
    """Stampa i numeri e li confronta caso per caso con l'elenco delle eccezioni (data/eccezioni/cavalcavia.json).
    Restituisce (valori, misure, righe degli errori: vuote se i casi sono quelli dell'elenco)."""
    misure = misura(R)
    tot, per = conta(misure)
    comando = 'ECCEZIONI=aggiorna npx playwright test cavalcavia' if R.nome == 'gioco' else 'python3 scripts/cavalcavia.py --aggiorna'
    E = Elenco('cavalcavia', comando)
    controllo = {'strade': 'strade', 'binari': f'binari {R.nome}'}
    print(f'Cavalcavia ({R.nome}): {len(misure)}, ' + ', '.join(NOMI[t] for t in TIPI))
    for su in TIPI_DI:
        E.confronta(controllo[su], [chiave_di(c) for C in misure.values() for c in C['casi'] if c['su'] == su], TOLL, aggiorna)
        segno, esito = E.segno(controllo[su])
        print(f'  {segno} {su}: ' + ', '.join(f'{t} {tot[su][t]}' for t in TIPI_DI[su]) + f' ({esito})')
    if aggiorna:
        E.scrivi()
    if elenco:
        print('  cavalcavia peggiori (somma dei pesi; strade e binari: onde, pendenze, raccordi, scarti dal DTM o fuori quota):')
        for cid, C in peggiori(misure, 12):
            v = per[cid]
            peso = sum(c['peso'] for c in C['casi'])
            print(f"    {cid}, ({C['x']}, {C['z']}), {C['metri']} m: peso {peso:.0f}; strade "
                  + ' '.join(str(v['strade'][t]) for t in TIPI_DI['strade']) + '; binari ' + ' '.join(str(v['binari'][t]) for t in TIPI_DI['binari']))
            for c in sorted(C['casi'], key=lambda c: -c['peso'])[:4]:
                print('      ' + descrivi(c))
    if json_out:
        json.dump({'rete': R.nome, 'valori': tot, 'eccezioni': E.esiti, 'per_cavalcavia': per, 'cavalcavia': misure},
                  open(json_out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return tot, misure, E.errori()


def stampa_profili(R, x, z, passo=5):
    """I profili (strade e binari) che passano a meno di 10 m da (x, z), un punto ogni `passo` metri: progressiva,
    posto, quota, quota della rete, DTM, pendenza su CORDA_P metri."""
    cav = cavalcavia(R)
    vicino = lambda pts: any(math.hypot(p['x'] - x, p['z'] - z) < 10 for p in pts)
    tutti = [(f"{C['id']}, strada", profilo_strada(R, seq)) for C in cav for seq in itinerari(R, C)]
    tutti += [(f"{cid}, {T['binario']}", T['pts']) for cid, TT in profili_binari(R, cav).items() for T in TT]
    k = round(CORDA_P / 2 / PASSO)
    for nome, pts in tutti:
        if not vicino(pts):
            continue
        print(f'{nome}: {len(pts) * PASSO:.0f} m')
        q = [p['q'] for p in pts]
        for i in range(0, len(pts), round(passo / PASSO)):
            p = pts[i]
            pend = f'{100 * (q[i + k] - q[i - k]) / CORDA_P:6.1f}%' if k <= i < len(pts) - k else ''
            dtm_ = f'{R.dtm.at(p["x"], p["z"]):6.2f}' if R.dtm else ''
            print(f"  {i * PASSO:6.0f} ({p['x']:7.1f}, {p['z']:7.1f}) quota {p['q']:6.2f} rete {p['rel']:5.2f} dtm {dtm_} {pend}"
                  + (' ponte' if p['ponte'] else '') + (f" strada {p['strada']:6.2f}" if p.get('strada') is not None else ''))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--gioco', help='file del terreno e dei binari del gioco (tests/cavalcavia.spec.js); senza, i dati')
    ap.add_argument('--aggiorna', action='store_true', help="riscrive l'elenco delle eccezioni dai casi di oggi (i nuovi senza perché)")
    ap.add_argument('--elenco', action='store_true', help='elenca i cavalcavia peggiori')
    ap.add_argument('--json', help='scrive il rapporto completo in questo file')
    ap.add_argument('--profilo', nargs=2, type=float, metavar=('X', 'Z'), help='stampa i profili che passano da questo punto')
    args = ap.parse_args()
    R = rete_gioco(json.load(open(args.gioco))) if args.gioco else rete_dati()
    if args.profilo:
        stampa_profili(R, *args.profilo)
        return
    _, _, errori = rapporto(R, args.elenco, args.json, args.aggiorna)
    if errori:
        print('\n'.join(errori))
        sys.exit(1)


if __name__ == '__main__':
    main()
