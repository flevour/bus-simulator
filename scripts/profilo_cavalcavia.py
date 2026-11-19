"""Profilo dei cavalcavia secondo la regola (docs/cavalcavia.md): registro delle strutture, risolutore, terreno.

Una struttura è un cavalcavia con le sue rampe: i ponti OSM in quota (layer >= 1) che scavalcano la ferrovia o un'altra
strada, e le strade che ci arrivano fino a FINESTRA metri (le laterali fino a LATERALE, e oltre finché stanno su un rilevato). Per ogni struttura il
risolutore cerca il profilo più liscio dentro i limiti della regola, con le fonti in quest'ordine:
  1. i punti messi a mano nel registro (data/cavalcavia.json), con il perché;
  2. il franco sopra quello che passa sotto (ferrovia, strade), dove `layer` di OSM dice solo chi sta sopra;
  3. il DTM fuori dai ponti (rilevati e spalle), entro la tolleranza della regola.
È un programma lineare: le incognite sono le quote ogni PASSO metri lungo gli archi, i vincoli pendenza massima e raggi
dei raccordi del tipo di strada, i piedi alla quota del terreno; si minimizzano lo scarto dal DTM, le variazioni di
pendenza e i saliscendi. Dove i vincoli non stanno insieme restano le violazioni più piccole possibili, che il
controllo (scripts/cavalcavia.py) trova e che vanno scritte tra le eccezioni.

Il terreno sotto le strutture si adatta al profilo: fuori dai ponti la piattaforma (carreggiata più MARGINE) prende la
quota del profilo, così strada, corsie e binari accanto stanno sullo stesso piano e il rilevato è quello del profilo;
sotto le campate vale il piano di quello che passa sotto, senza la gobba della chiusura morfologica; negli ultimi SPALLA
metri prima di una campata il terreno scende dal rilevato al piano di sotto. La quota scritta nella mappa è il profilo
meno il terreno campionato come lo campiona il gioco (stessa griglia, stessa interpolazione), con un punto a ogni
confine di cella: terreno più quota dà il profilo.

Nella mappa:
  * `cavalcavia`: le strutture, [{id, x, z, archi}] (le usa il controllo; #107 le userà per i binari);
  * `edgeH`: [arco, [progressive in cm], [quote in mm sopra il terreno]] degli archi in quota;
  * `nodeH`: la quota dei nodi degli archi in quota (come prima);
  * `terrain.data` con le piattaforme e `terrain.via`, le celle della variante "via" fissate dopo chiusura e ponti.

Il registro (data/cavalcavia.json) ha una voce per struttura: i campi scritti dalla build (`ponti`, `scavalca`, `x`,
`z`, `metri`) e quelli messi a mano (`profilo`, `punti`, `franchi`), con il perché. Il profilo si calcola solo per le
strutture con `profilo` vero; le altre tengono le quote di street_surfaces.overpass_heights. La build si ferma se le
strutture della rete non sono quelle del registro; con CAVALCAVIA=registro lo riscrive tenendo i campi messi a mano.

Servono numpy e scipy (programmazione lineare, HiGHS).
"""
import base64
import json
import math
import os
import sys
from collections import Counter, defaultdict

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from binari_tram import Griglia  # noqa: E402
from cavalcavia import AFFIANCA, DTM_TOLL, ONDA, PARALLELO, PENDENZA, PONTE_VICINO, R_CONCA, R_DOSSO, TRATTO, Griglia10, Via, arco_accanto, estremi, punto, tipo_di  # noqa: E402

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRO = os.path.join(RADICE, 'data/cavalcavia.json')

# ---------- numeri (docs/cavalcavia.md) ----------
FRANCO = {'ferrovia': 6.9, 'strada': 5.0}  # m, dal piano di sotto all'intradosso
IMPALCATO = 0.9   # m: spessore dell'impalcato (street_surfaces: la fascia laterale)
FINESTRA = 300.0  # m: la strada del ponte fa parte della struttura fin qui oltre la campata
LATERALE = 60.0   # m: le strade che si innestano sulla strada del ponte, fin qui
RILEVATO = 1200.0  # m in più, finché la strada sta su un rilevato o in trincea (non si lascia una rampa a metà)
FUORI_TERRA = 0.6  # m tra il DTM e il piano intorno: oltre, la strada è su un rilevato o in trincea
PASSO = 4.0       # m tra le incognite lungo un arco
CORDA = 8.0       # m: i raccordi si vincolano anche su corde lunghe almeno così, attraverso i nodi
MARGINE = 12.0    # m oltre metà carreggiata: la piattaforma del terreno alla quota del profilo
MARGINE_CAMPATA = 20.0  # m oltre metà carreggiata: sotto le campate il terreno è il piano di sotto
SPALLA = 40.0     # m prima di una campata: il terreno scende dal rilevato al piano di sotto (il tram legge la quota
#                   ogni 5 m: su 40 m la discesa raccordata gli lascia meno di 8 cm di errore)
SOTTOPASSO = 6.0  # m oltre metà della strada in galleria: lì la strada di sopra è una campata
NUCLEO = 14.2     # m: le quattro celle attorno a un punto dell'asse stanno entro questa distanza (10 m per radice di 2)
SOTTO_PASSO = 2.0  # m tra i punti della rete delle strade che passano sotto le campate (StradeSotto)
CAMPATA_VERA = 1.5  # m: sotto un ponte OSM il DTM sta entro questa quota dal piano intorno, se no lì c'è un rilevato
ATTORNO = 90.0    # m dagli archi di una struttura: lì la chiusura morfologica non riempie (tra due rilevati)
VICINE = 200.0    # m: fin qui da una struttura con il profilo le celle sotto i cavalcavia con le quote di prima si fissano
QUOTA_DI_PRIMA = 0.3  # m: da questa quota a un capo un arco fuori dalle strutture è di un cavalcavia con le quote di prima
ACQUA = 12.0      # m da un corso d'acqua: lì la chiusura resta (fossi e canali senza ponte in OSM)
IN_QUOTA = 0.05   # m: un arco con la quota sopra il terreno oltre questa è in quota (e.elev nel gioco)
# il terreno del gioco ha gradini di GRADINO metri (un byte per cella): dove la strada sta sul terreno il controllo
# vede il profilo più il gradino. I limiti del progetto lasciano quel margine: pendenza su 10 m, raggio da corde di 20 m
GRADINO = 0.0563
P_MARGINE = GRADINO / 10.0
K_MARGINE = 4 * GRADINO / 2 / 400.0  # curvatura apparente di un gradino su due corde di 20 m, a metà
DTM_MARGINE = GRADINO
# pesi del programma lineare (per metro di quota)
W_DTM = 1.0       # scarto dal DTM, per incognita
W_BANDA = 40.0    # scarto dal DTM oltre la tolleranza
W_VAR = 3.0       # variazione totale: niente saliscendi che non servono
W_PIEDE = 60.0    # scarto dal terreno negli ultimi ARRIVO metri prima di un piede
ARRIVO = 20.0     # m: prima di un piede il profilo arriva sul terreno com'è, senza uno spigolo dove la struttura finisce
W_RETTA = 2.0e3   # variazione di pendenza sulle campate (per unità di curvatura, 1/m)
W_RETTA_TERRA = 2.0e2
# i limiti della regola e i franchi contano molto più del DTM: dove il DTM non vede la rampa (un manufatto tolto dal
# rilievo) il profilo resta dentro pendenze e raggi e si allontana dal DTM
W_PENDENZA = 1.0e5
W_RACCORDO = 1.0e7
W_FRANCO = 1.0e5
W_ACCANTO = 20.0   # carreggiate affiancate a quote diverse (oltre ACCANTO_TOLL)
# giro contro le onde (Profili.onde): una conca del profilo calcolato si riempie fino a ONDA_RESTO sotto il più basso dei
# due massimi, per metro di quota che manca W_ONDA. Più del DTM (la conca si riempie dove la strada resta entro la
# tolleranza) e meno della banda oltre la tolleranza (dove il DTM vede la conca, la strada lo segue: rilievo prima della
# regola delle onde); pendenze, raggi e franchi contano molto di più
W_ONDA = 20.0
ONDA_GIRO = 0.08   # m: le conche da qui in su (il controllo conta da ONDA, sul profilo più i gradini del terreno)
ONDA_RESTO = 0.05  # m: quanto resta di una conca riempita
GIRI_ONDE = 2      # giri contro le onde dopo la prima soluzione
ONDA_BINARIO = 2   # m tra i punti di un binario dove si chiede di riempire una conca
ONDA_RILIEVO = 0.3  # m sopra il terreno com'è: solo da qui (o vicino a un ponte) una conca si riempie
ACCANTO = 8.0      # m oltre le due mezze carreggiate: fin qui due archi quasi paralleli sono la stessa piattaforma
ACCANTO_TOLL = 0.03
FITTO = 50         # cm tra i punti provati lungo un arco per la quota sopra il terreno (quote_archi)
FEDELE = 2         # mm: i punti in più che stanno entro questa quota dalla retta tra i vicini non si scrivono
BINARIO_PASSO = 1.0  # m tra i punti lungo un binario dove si vincola la sua pendenza (come i profili del controllo)
BINARIO_CORDA = 10.0  # m: la pendenza del binario si vincola su questa corda (CORDA_P del controllo)


def carica_registro(path=REGISTRO):
    if not os.path.exists(path):
        return {'strutture': []}
    return json.load(open(path, encoding='utf-8'))


# ---------- geometria ----------
def _incrocio(p, q, r, s):
    """Frazione di p-q dove incrocia r-s, o None."""
    rx, rz, sx, sz = q[0] - p[0], q[1] - p[1], s[0] - r[0], s[1] - r[1]
    den = rx * sz - rz * sx
    if abs(den) < 1e-9:
        return None
    t = ((r[0] - p[0]) * sz - (r[1] - p[1]) * sx) / den
    u = ((r[0] - p[0]) * rz - (r[1] - p[1]) * rx) / den
    return (t, u) if 0 <= t <= 1 and 0 <= u <= 1 else None


class Rete:
    """Nodi e archi della mappa in costruzione (build_map: archi [a, b, classe, larghezza, nome, flag, velocità,
    layer]), con gli indici che servono."""

    def __init__(self, nodes, edges, names, rails, tram):
        self.nodi, self.archi, self.nomi = nodes, edges, names
        self.lung = [math.dist(nodes[e[0]], nodes[e[1]]) for e in edges]
        self.at = defaultdict(list)
        for k, e in enumerate(edges):
            if self.lung[k] > 0.05:
                self.at[e[0]].append(k)
                self.at[e[1]].append(k)
        self.griglia = Griglia([(nodes[e[0]], nodes[e[1]]) for e in edges], 50.0)
        self.rotaie = []
        for bt, _yard, f in rails:
            if bt:
                continue  # binari in ponte o in galleria
            pts = [(f[i], f[i + 1]) for i in range(0, len(f), 2)]
            self.rotaie += list(zip(pts, pts[1:]))
        self.g_rotaie = Griglia(self.rotaie, 50.0)
        segs = []
        self.binari = []  # i binari del tram, uno per verso: [(x, z)]
        for t in tram or []:
            pts = [(t[i], t[i + 1]) for i in range(0, len(t) - 1, 2)]
            segs += list(zip(pts, pts[1:]))
            self.binari.append(pts)
        self.g_tram = Griglia(segs, 20.0)

    def nome(self, k):
        i = self.archi[k][4]
        return self.nomi[i] if isinstance(i, int) and 0 <= i < len(self.nomi) else (i if isinstance(i, str) else '')

    def tipo(self, k):
        return tipo_di(self.archi[k][2], self.nome(k))

    def altro(self, k, n):
        e = self.archi[k]
        return e[1] if e[0] == n else e[0]

    def verso(self, k, da):
        """Versore dell'arco k uscendo dal nodo `da`."""
        a, b = self.nodi[da], self.nodi[self.altro(k, da)]
        l = math.dist(a, b) or 1
        return (b[0] - a[0]) / l, (b[1] - a[1]) / l

    def seguiti(self, k, n, soglia=0.7):
        """Gli archi che proseguono dal nodo n arrivando lungo k (coseno almeno `soglia`), il più dritto per primo; conta
        di più chi ha lo stesso nome (come gli itinerari di scripts/cavalcavia.py)."""
        dx, dz = self.verso(k, self.altro(k, n))
        out = []
        for j in self.at[n]:
            if j == k or self.archi[j][2] == 8:
                continue
            ex, ez = self.verso(j, n)
            c = ex * dx + ez * dz
            if c >= soglia:
                out.append((c + 0.2 * (self.nome(j) == self.nome(k)), j))
        return [j for _c, j in sorted(out, reverse=True)]

    def con_tram(self, k):
        """Vero se un binario del tram affianca l'arco (quasi parallelo, entro metà carreggiata più AFFIANCA)."""
        e = self.archi[k]
        A, B = self.nodi[e[0]], self.nodi[e[1]]
        L = self.lung[k] or 1
        ux, uz = (B[0] - A[0]) / L, (B[1] - A[1]) / L
        n = max(1, round(L / 10))
        vicini = 0
        for i in range(n + 1):
            p = (A[0] + (B[0] - A[0]) * i / n, A[1] + (B[1] - A[1]) * i / n)
            for s in self.g_tram.vicini(p, e[3] / 2 + AFFIANCA):
                (ax, az), (bx, bz) = self.g_tram.segmenti[s]
                ex, ez = bx - ax, bz - az
                l = math.hypot(ex, ez) or 1e-9
                if abs(ux * ez / l - uz * ex / l) > PARALLELO:
                    continue
                t = max(0.0, min(1.0, ((p[0] - ax) * ex + (p[1] - az) * ez) / (l * l)))
                if math.hypot(ax + ex * t - p[0], az + ez * t - p[1]) < e[3] / 2 + AFFIANCA:
                    vicini += 1
                    break
        return vicini * 2 > n + 1


# ---------- le strutture ----------
def impalcati(R):
    """I ponti in quota: archi `bridge` con layer >= 1 che scavalcano la ferrovia o una strada con il layer più basso, e
    tutta la catena di ponti in quota che li tocca. Restituisce (archi, incroci): incroci = [(arco sopra, frazione, tipo,
    arco sotto o None, punto)]."""
    deck, incroci = set(), []
    for k, e in enumerate(R.archi):
        a, b, _c, _w, _n, flags, _s, layer = e[:8]
        if not (flags & 4 and layer >= 1) or R.lung[k] <= 0.05:
            continue
        p, q = R.nodi[a], R.nodi[b]
        m = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        hit = False
        for s in R.g_rotaie.vicini(m, R.lung[k] / 2 + 1):
            c = _incrocio(p, q, *R.g_rotaie.segmenti[s])
            if c:
                hit = True
                incroci.append((k, c[0], 'ferrovia', None, (p[0] + (q[0] - p[0]) * c[0], p[1] + (q[1] - p[1]) * c[0])))
        for j in R.griglia.vicini(m, R.lung[k] / 2 + 1):
            f = R.archi[j]
            if j == k or f[7] >= layer or f[5] & 8 or f[2] == 8 or f[0] in (a, b) or f[1] in (a, b) or R.lung[j] <= 0.05:
                continue
            c = _incrocio(p, q, R.nodi[f[0]], R.nodi[f[1]])
            if c:
                hit = True
                incroci.append((k, c[0], 'strada', j, (p[0] + (q[0] - p[0]) * c[0], p[1] + (q[1] - p[1]) * c[0])))
        if hit:
            deck.add(k)
    stack = list(deck)
    while stack:
        k = stack.pop()
        for n in R.archi[k][:2]:
            for j in R.at[n]:
                if j not in deck and R.archi[j][5] & 4 and R.archi[j][7] >= 1:
                    deck.add(j)
                    stack.append(j)
    # più incroci con la stessa ferrovia o la stessa strada sullo stesso arco: uno ogni 5 m basta
    visti, out = set(), []
    for k, t, tipo, j, p in sorted(incroci, key=lambda c: (c[0], c[1])):
        ch = (k, tipo, j, round(t * R.lung[k] / 5))
        if ch not in visti:
            visti.add(ch)
            out.append((k, t, tipo, j, p))
    return deck, out


def sottopassi(R, S, deck):
    """Strade in galleria o con layer negativo che passano sotto un arco della struttura che non è un ponte (un
    sottopasso nel rilevato: OSM segna la galleria sulla strada di sotto). [(arco sopra, frazione, arco sotto, punto)]."""
    out = []
    for k in sorted(S - deck):
        e = R.archi[k]
        p, q = R.nodi[e[0]], R.nodi[e[1]]
        m = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        for j in R.griglia.vicini(m, R.lung[k] / 2 + 1):
            f = R.archi[j]
            if j == k or not (f[5] & 8 or f[7] < 0) or f[7] >= e[7] or f[2] == 8 or f[0] in e[:2] or f[1] in e[:2] or R.lung[j] <= 0.05:
                continue
            c = _incrocio(p, q, R.nodi[f[0]], R.nodi[f[1]])
            if c:
                out.append((k, c[0], j, (p[0] + (q[0] - p[0]) * c[0], p[1] + (q[1] - p[1]) * c[0])))
    return out


def finestra(R, deck, sotto, fuori_terra, limiti=None):
    """Gli archi di ogni struttura: i ponti e le strade che ci arrivano. Dalla fine di un ponte si segue la strada (a
    ogni nodo gli archi che proseguono, e le rampe di svincolo) per FINESTRA metri; chi si innesta di lato entra per
    LATERALE metri. Dove la finestra finirebbe su un rilevato o in trincea (fuori_terra(nodo)) si prosegue, fino a
    RILEVATO metri in più. Non si entra nelle gallerie e nei sottopassi, e ci si ferma ai nodi delle strade che passano
    sotto (`sotto`). limiti: {nodo del ponte: (principale, laterale)} dal registro."""
    import heapq
    ok = lambda k: not R.archi[k][5] & 8 and R.archi[k][7] >= 0 and k not in deck
    S = set(deck)
    best = {}
    heap = []
    for k in deck:
        for n in R.archi[k][:2]:
            fp, fl = (limiti or {}).get(n, (FINESTRA, LATERALE))
            heapq.heappush(heap, (-(fp + RILEVATO), n, k, fl, RILEVATO))
    while heap:
        b, n, k, fl, r = heapq.heappop(heap)
        b = -b - r  # b: metri della finestra che restano; r: metri di rilevato che restano
        if best.get((n, k), -1e9) >= b + r:
            continue
        best[(n, k)] = b + r
        if n in sotto and k not in deck:
            continue
        if b <= 0 and not fuori_terra(n):
            continue
        dritti = set(R.seguiti(k, n, 0.5))
        for j in R.at[n]:
            if j == k or not ok(j):
                continue
            bj = b if j in dritti or R.tipo(j) == 'rampa' else min(b, fl)
            rj = r
            if bj <= 0:
                if rj <= 0 or not fuori_terra(n):
                    continue
                rj -= R.lung[j]
            S.add(j)
            o = R.altro(j, n)
            nb = bj - R.lung[j]
            if (nb > 0 or rj > 0) and best.get((o, j), -1e9) < max(nb, 0) + rj:
                heapq.heappush(heap, (-(max(nb, 0) + rj), o, j, fl, rj))
    # niente buchi: un arco corto tra due nodi della struttura (un collegamento tra due carreggiate) ne fa parte
    nodi = {n for k in S for n in R.archi[k][:2]}
    for k in range(len(R.archi)):
        if k not in S and ok(k) and R.lung[k] > 0.05 and R.lung[k] <= 2 * LATERALE and R.archi[k][0] in nodi and R.archi[k][1] in nodi \
                and R.archi[k][0] not in sotto and R.archi[k][1] not in sotto:
            S.add(k)
    return S


def componenti(R, S):
    """Gruppi di archi che si toccano."""
    at = defaultdict(list)
    for k in S:
        for n in R.archi[k][:2]:
            at[n].append(k)
    visti, out = set(), []
    for k0 in sorted(S):
        if k0 in visti:
            continue
        g, st = set(), [k0]
        while st:
            k = st.pop()
            if k in g:
                continue
            g.add(k)
            for n in R.archi[k][:2]:
                st += [j for j in at[n] if j not in g]
        visti |= g
        out.append(g)
    return out


def nomina(R, gruppi, deck):
    """Nome e posto di ogni struttura: la via più lunga dei suoi ponti e il baricentro dei ponti; se il nome si ripete,
    con il posto (come i cavalcavia di scripts/cavalcavia.py)."""
    out = []
    for g in gruppi:
        ponti = [k for k in g if k in deck]
        nomi = Counter()
        for k in ponti:
            nomi[R.nome(k) or 'senza nome'] += R.lung[k]
        nome = nomi.most_common(1)[0][0]
        L = sum(R.lung[k] for k in ponti) or 1
        cx = sum((R.nodi[R.archi[k][0]][0] + R.nodi[R.archi[k][1]][0]) / 2 * R.lung[k] for k in ponti) / L
        cz = sum((R.nodi[R.archi[k][0]][1] + R.nodi[R.archi[k][1]][1]) / 2 * R.lung[k] for k in ponti) / L
        out.append({'nome': nome, 'x': round(cx), 'z': round(cz), 'archi': g, 'ponti': ponti, 'metri': round(sum(R.lung[k] for k in g))})
    conta = Counter(c['nome'] for c in out)
    for c in out:
        c['id'] = c['nome'] if conta[c['nome']] == 1 else f"{c['nome']} ({c['x']}, {c['z']})"
    return sorted(out, key=lambda c: c['id'])


# ---------- il programma lineare ----------
class LP:
    def __init__(self, n):
        self.n = n          # incognite
        self.costo = [0.0] * n
        self.lo, self.hi = [None] * n, [None] * n
        self.r, self.c, self.v, self.b = [], [], [], []
        self.m = 0

    def var(self, costo=0.0, lo=0.0, hi=None):
        self.costo.append(costo)
        self.lo.append(lo)
        self.hi.append(hi)
        self.n += 1
        return self.n - 1

    def riga(self, termini, b):
        """somma(coefficiente * incognita) <= b"""
        for i, a in termini:
            self.r.append(self.m)
            self.c.append(i)
            self.v.append(a)
        self.b.append(b)
        self.m += 1

    def risolvi(self):
        """Risolve per parti: le incognite che nessun vincolo lega tra loro (strutture lontane) stanno in programmi
        separati. Un programma solo per tutte ha molte soluzioni con lo stesso costo, e quella che HiGHS sceglie dipende
        da tutto il resto: attivare una struttura spostava fino a 20 cm il profilo di un'altra a chilometri di distanza.
        Una parte che non cambia ha la stessa soluzione, perché il suo programma è lo stesso, nello stesso ordine."""
        A = coo_matrix((self.v, (self.r, self.c)), shape=(self.m, self.n)).tocsr()
        primo = np.full(self.m, -1)
        r, c = np.asarray(self.r), np.asarray(self.c)
        a = np.r_[0, np.flatnonzero(np.diff(r)) + 1]  # le righe sono scritte una dopo l'altra (riga)
        primo[r[a]] = c[a]  # la prima incognita di ogni riga
        G = coo_matrix((np.ones(len(c)), (primo[r], c)), shape=(self.n, self.n))
        n_parti, parte = connected_components(G, directed=False)
        costo, b = np.asarray(self.costo), np.asarray(self.b)
        limiti = list(zip(self.lo, self.hi))
        x = np.zeros(self.n)
        righe_di = np.argsort(parte[primo], kind='stable')
        inizio = np.searchsorted(parte[primo][righe_di], np.arange(n_parti + 1))
        for p in range(n_parti):
            inc = np.flatnonzero(parte == p)
            righe = righe_di[inizio[p]:inizio[p + 1]]
            if not len(righe):
                x[inc] = [lo if lo is not None else 0.0 for lo in (limiti[i][0] for i in inc)]
                continue
            res = linprog(costo[inc], A_ub=A[righe][:, inc], b_ub=b[righe], bounds=[limiti[i] for i in inc], method='highs')
            if res.status != 0:
                raise RuntimeError('profilo dei cavalcavia: il programma lineare non ha soluzione: ' + res.message)
            x[inc] = res.x
        return x


class Profili:
    """Le incognite (quote assolute ogni PASSO metri lungo gli archi delle strutture) e, dopo risolvi(), i profili."""

    def __init__(self, R, S, deck, incroci, sotto, nat, base, dtm, registro, strutture):
        self.R, self.S, self.deck, self.incroci = R, S, deck, incroci
        self.nat, self.base, self.dtm = nat, base, dtm
        self.di_nodo = {}
        self.nodi_arco = {}  # arco -> indici delle incognite dal nodo a al nodo b
        self.s_arco = {}     # arco -> progressive
        self.xz = []
        for k in sorted(S):
            a, b = R.archi[k][:2]
            n = max(1, round(R.lung[k] / PASSO))
            idx = []
            for i in range(n + 1):
                if i == 0 or i == n:
                    nd = a if i == 0 else b
                    if nd not in self.di_nodo:
                        self.di_nodo[nd] = len(self.xz)
                        self.xz.append(R.nodi[nd])
                    idx.append(self.di_nodo[nd])
                else:
                    t = i / n
                    idx.append(len(self.xz))
                    self.xz.append((R.nodi[a][0] + (R.nodi[b][0] - R.nodi[a][0]) * t, R.nodi[a][1] + (R.nodi[b][1] - R.nodi[a][1]) * t))
            self.nodi_arco[k] = idx
            self.s_arco[k] = [R.lung[k] * i / n for i in range(n + 1)]
        self.N = len(self.xz)
        self.tram = {k: R.con_tram(k) for k in S}
        # piedi: nodi dove la struttura finisce (un arco fuori dalla struttura), e nodi delle strade che passano sotto
        self.piedi = set()
        for nd in self.di_nodo:
            if nd in sotto or any(j not in S for j in R.at[nd]):
                self.piedi.add(nd)
        # ponti (anche a terra, sui fiumi) e incognite vicine: lì il DTM non dice la quota della strada
        self.g_ponti = Griglia([(R.nodi[R.archi[k][0]], R.nodi[R.archi[k][1]]) for k in sorted(S) if R.archi[k][5] & 4], 30.0)
        self.sul_ponte = [self.g_ponti.piu_vicino(p, PONTE_VICINO + 1) is not None for p in self.xz]
        # ponti a terra (sui fiumi): il DTM vede l'acqua
        self.g_ponti_terra = Griglia([(R.nodi[R.archi[k][0]], R.nodi[R.archi[k][1]]) for k in sorted(S) if R.archi[k][5] & 4 and k not in deck]
                                     or [((1e9, 1e9), (1e9, 1e9))], 30.0)
        # campate: tratti (da, a, piano) di ogni arco sotto cui il terreno è il piano di quello che passa sotto. I ponti
        # in quota per intero (piano None: quello delle loro incognite), gli altri sopra i sottopassi
        self.campate = {k: [(0.0, R.lung[k], None)] for k in deck}
        self.rilevato = set()  # incognite dei ponti OSM dove il DTM vede un rilevato (piani_campate)
        self.h = None
        self.lungo_binari = self.punti_binari()
        self.registro = registro
        self.strutture = strutture
        self.violazioni = {}

    def punti_binari(self):
        """Per ogni binario i punti ogni BINARIO_PASSO metri con la strada della struttura che affiancano: [[(arco,
        frazione) o None]]. La strada è quella che scripts/quote_rete.py darà al binario (cavalcavia.arco_accanto, qui
        tra gli archi delle strutture): il binario prende la quota del profilo in quel punto dell'asse."""
        R = self.R
        vista = type('Vista', (), {'strade': R.griglia, 'misurati': self.S, 'archi': R.archi, 'nodi': R.nodi})
        out = []
        for P in R.binari:
            cum = [0.0]
            for a, b in zip(P, P[1:]):
                cum.append(cum[-1] + math.dist(a, b))
            riga = []
            for n in range(int(cum[-1] // BINARIO_PASSO) + 1):
                x, z, dx, dz = punto(P, cum, n * BINARIO_PASSO)
                k, t, _d = arco_accanto(vista, (x, z), (dx, dz))
                riga.append((k, t) if k is not None else None)
            if any(riga):
                out.append(riga)
        return out

    def p_max(self, k):
        p = PENDENZA[self.R.tipo(k)]
        return (min(p, PENDENZA['tram']) if self.tram[k] else p) - P_MARGINE

    def k_max(self, ks):
        """(curvatura massima in conca, in dosso) per gli archi ks: il più severo."""
        rc = max(R_CONCA[self.R.tipo(k)] for k in ks)
        rd = max(R_DOSSO[self.R.tipo(k)] for k in ks)
        return max(1e-5, 1 / rc - K_MARGINE), max(1e-5, 1 / rd - K_MARGINE)

    def passi(self, k, i, verso, dist):
        """Incognite a `dist` metri (almeno) dalla i-esima dell'arco k, andando nel verso +1 o -1 lungo l'arco e poi
        lungo gli archi che proseguono: [(incognita, metri, archi percorsi)]."""
        out = []
        st = [(k, i, verso, 0.0, (k,))]
        while st:
            k, i, v, d, ks = st.pop()
            idx, s = self.nodi_arco[k], self.s_arco[k]
            j = i
            while 0 <= j + v < len(idx):
                j += v
                dj = d + abs(s[j] - s[i])
                if dj >= dist:
                    out.append((idx[j], dj, ks))
                    break
            else:
                nd = self.R.archi[k][1] if v > 0 else self.R.archi[k][0]
                d2 = d + abs(s[j] - s[i])
                if len(ks) > 6:
                    continue
                for m in self.R.seguiti(k, nd):
                    if m in self.S and m not in ks:
                        mi = 0 if self.R.archi[m][0] == nd else len(self.nodi_arco[m]) - 1
                        st.append((m, mi, 1 if mi == 0 else -1, d2, ks + (m,)))
        return out

    def a_frazione(self, k, t):
        """[(incognita, peso)] del punto a frazione t dell'arco k."""
        idx = self.nodi_arco[k]
        f = max(0.0, min(1.0, t)) * (len(idx) - 1)
        i = min(len(idx) - 2, int(f))
        w = f - i
        return [(idx[i], 1 - w), (idx[i + 1], w)]

    def risolvi(self, piani, onde=None):
        """piani: funzione (arco, frazione, arco di sotto o None, punto) -> quota di quello che passa sotto una campata
        (il piano della campata, o la strada di sotto). onde: {chiave: ([(incognita, peso)], quota minima)}, le conche
        da riempire trovate dai giri contro le onde (onde())."""
        R, N = self.R, self.N
        lp = LP(N)
        lp.lo, lp.hi = [-60.0] * N, [150.0] * N
        dtm = [self.dtm.at(*p) for p in self.xz]
        nat = [self.nat.at(*p) for p in self.xz]
        self._nat = nat
        # piedi alla quota del terreno
        for nd in self.piedi:
            i = self.di_nodo[nd]
            lp.lo[i] = lp.hi[i] = nat[i]
        # punti messi a mano
        self.punti = []
        qui = {s['id'] for s in self.strutture}
        for st in self.registro.get('strutture', []):
            for p in st.get('punti', []) if st['id'] in qui else []:
                i = min(range(N), key=lambda i: math.dist(self.xz[i], (p['x'], p['z'])))
                if math.dist(self.xz[i], (p['x'], p['z'])) > 25:
                    raise RuntimeError(f"registro dei cavalcavia: il punto ({p['x']}, {p['z']}) di {st['id']} non è su una struttura")
                q = p['quota'] if 'quota' in p else nat[i] + p['sopra']
                toll = p.get('toll', 0.02)
                lp.lo[i], lp.hi[i] = max(lp.lo[i], q - toll), min(lp.hi[i], q + toll)
                self.punti.append(i)
        mano = set(self.punti)
        # arrivo ai piedi: negli ultimi ARRIVO metri il profilo segue il terreno com'è
        import heapq
        dist, heap = {}, [(0.0, self.di_nodo[nd], nd, None, 0) for nd in self.piedi]
        vicino = {}
        for k in self.S:
            idx, ss = self.nodi_arco[k], self.s_arco[k]
            for n in range(len(idx) - 1):
                d = ss[n + 1] - ss[n]
                vicino.setdefault(idx[n], []).append((idx[n + 1], d))
                vicino.setdefault(idx[n + 1], []).append((idx[n], d))
        heap = [(0.0, self.di_nodo[nd]) for nd in self.piedi]
        heapq.heapify(heap)
        while heap:
            d, i = heapq.heappop(heap)
            if i in dist:
                continue
            dist[i] = d
            for j, l in vicino.get(i, ()):
                if j not in dist and d + l <= ARRIVO:
                    heapq.heappush(heap, (d + l, j))
        for i in dist:
            if i in mano or lp.lo[i] == lp.hi[i] or i in self.vere:
                continue
            a = lp.var(W_PIEDE)
            lp.riga([(i, 1), (a, -1)], nat[i])
            lp.riga([(i, -1), (a, -1)], -nat[i])
        # DTM fuori dai ponti: scarto e banda
        for i in range(N):
            if self.sul_ponte[i] or i in mano or i in dist:
                continue
            a = lp.var(W_DTM)
            lp.riga([(i, 1), (a, -1)], dtm[i])
            lp.riga([(i, -1), (a, -1)], -dtm[i])
            b = lp.var(W_BANDA)
            toll = DTM_TOLL - DTM_MARGINE
            lp.riga([(i, 1), (b, -1)], dtm[i] + toll)
            lp.riga([(i, -1), (b, -1)], -dtm[i] + toll)
        # pendenze e variazione totale
        self.v_pend = []
        for k in sorted(self.S):
            idx, s = self.nodi_arco[k], self.s_arco[k]
            p = self.p_max(k)
            for i in range(len(idx) - 1):
                d = s[i + 1] - s[i]
                sl = lp.var(W_PENDENZA)
                lp.riga([(idx[i + 1], 1), (idx[i], -1), (sl, -1)], p * d)
                lp.riga([(idx[i + 1], -1), (idx[i], 1), (sl, -1)], p * d)
                self.v_pend.append((sl, k, i))
                tv = lp.var(W_VAR)
                lp.riga([(idx[i + 1], 1), (idx[i], -1), (tv, -1)], 0)
                lp.riga([(idx[i + 1], -1), (idx[i], 1), (tv, -1)], 0)
        # pendenza lungo i binari: il binario prende la quota della strada nel punto dell'asse più vicino, e dove la
        # strada curva o il binario passa da una carreggiata all'altra fa meno metri della strada (all'interno di una
        # curva la stessa salita sta in un binario più corto). Il limite del tram vale lungo il binario, sulla corda
        # che misura il controllo
        self.v_binari = []
        p = PENDENZA['tram'] - P_MARGINE
        m = round(BINARIO_CORDA / BINARIO_PASSO)
        for riga in self.lungo_binari:
            for n in range(len(riga) - m):
                if riga[n] is None or riga[n + m] is None:
                    continue
                qa, qb = self.a_frazione(*riga[n]), self.a_frazione(*riga[n + m])
                sl = lp.var(W_PENDENZA)
                lp.riga([(i, w) for i, w in qb] + [(i, -w) for i, w in qa] + [(sl, -1)], p * BINARIO_CORDA)
                lp.riga([(i, -w) for i, w in qb] + [(i, w) for i, w in qa] + [(sl, -1)], p * BINARIO_CORDA)
                self.v_binari.append(sl)
        # raccordi: terne di incognite vicine lungo l'arco, e corde di CORDA metri che passano i nodi
        terne = {}
        for k in sorted(self.S):
            idx, s = self.nodi_arco[k], self.s_arco[k]
            for i in range(len(idx)):
                if 0 < i < len(idx) - 1 and s[i] - s[i - 1] >= 2:
                    terne.setdefault((idx[i - 1], idx[i], idx[i + 1]), (s[i] - s[i - 1], s[i + 1] - s[i], (k,)))
                for (ia, da, ka) in self.passi(k, i, -1, CORDA):
                    for (ib, db, kb) in self.passi(k, i, 1, CORDA):
                        ch = (ia, idx[i], ib) if ia < ib else (ib, idx[i], ia)
                        terne.setdefault(ch, (da, db, tuple(set(ka + kb))) if ia < ib else (db, da, tuple(set(ka + kb))))
        self.v_racc = []
        for (ia, ic, ib), (da, db, ks) in terne.items():
            kc, kd = self.k_max(ks)
            # curvatura = 2 * ((hb - hc) / db - (hc - ha) / da) / (da + db)
            ca, cc, cb = 2 / (da * (da + db)), -2 / (da * db), 2 / (db * (da + db))
            sl = lp.var(W_RACCORDO)
            lp.riga([(ia, ca), (ic, cc), (ib, cb), (sl, -1)], kc)
            lp.riga([(ia, -ca), (ic, -cc), (ib, -cb), (sl, -1)], kd)
            campata = ic in self.vere
            u = lp.var(W_RETTA if campata else W_RETTA_TERRA)
            lp.riga([(ia, ca), (ic, cc), (ib, cb), (u, -1)], 0)
            lp.riga([(ia, -ca), (ic, -cc), (ib, -cb), (u, -1)], 0)
            self.v_racc.append((sl, ic, ks))
        # franchi sopra quello che passa sotto (o, dal registro, la quota minima dell'impalcato all'incrocio)
        self.v_franco = []
        for (k, t, tipo, j, p) in self.incroci:
            franco, quota = self.franco(tipo, p)
            f = quota if quota is not None else franco + IMPALCATO
            sl = lp.var(W_FRANCO)
            sopra = self.a_frazione(k, t)
            if quota is not None:
                lp.riga([(i, -w) for i, w in sopra] + [(sl, -1)], -quota)
            elif j is not None and j in self.S:
                c = _incrocio(R.nodi[R.archi[k][0]], R.nodi[R.archi[k][1]], R.nodi[R.archi[j][0]], R.nodi[R.archi[j][1]])
                giu = self.a_frazione(j, c[1])
                lp.riga([(i, -w) for i, w in sopra] + [(i, w) for i, w in giu] + [(sl, -1)], -f)
            else:
                lp.riga([(i, -w) for i, w in sopra] + [(sl, -1)], -(piani(k, t, j, p) + f))
            self.v_franco.append((sl, k, t, tipo, p, f))
        # carreggiate affiancate (i due sensi di un viale, la corsia di bus e tram accanto alla strada): stessa quota
        # alla stessa altezza della strada, così il terreno della piattaforma è un piano solo per corsie e binari. Anche due
        # strade con nomi diversi: la rampa del Dalmazia si porta dietro Corso delle Tre Venezie, a 8 m, fino a 1 m sopra il
        # DTM, ma slegate, all'incrocio a raso ai piedi ovest del Chiesanuova Via Chiesanuova e Via Pacinotti restavano
        # 14-18 cm in quota (nota #125 di docs/LAVORO.md)
        g_s = Griglia([(R.nodi[R.archi[k][0]], R.nodi[R.archi[k][1]]) for k in sorted(self.S)], 30.0)
        ordine = sorted(self.S)
        fatti = set()
        for k in ordine:
            e = R.archi[k]
            ux, uz = R.verso(k, e[0])
            for n, i in enumerate(self.nodi_arco[k]):
                p = self.xz[i]
                for m in g_s.vicini(p, e[3] / 2 + 12 + ACCANTO):
                    j = ordine[m]
                    f = R.archi[j]
                    if j == k or set(f[:2]) & set(e[:2]) or f[7] != e[7]:
                        continue
                    A, B = R.nodi[f[0]], R.nodi[f[1]]
                    ex, ez = B[0] - A[0], B[1] - A[1]
                    l2 = ex * ex + ez * ez
                    t = ((p[0] - A[0]) * ex + (p[1] - A[1]) * ez) / l2
                    if not 0 <= t <= 1 or abs(ux * ex + uz * ez) / math.sqrt(l2) < 0.9:
                        continue
                    if math.hypot(A[0] + ex * t - p[0], A[1] + ez * t - p[1]) > (e[3] + f[3]) / 2 + ACCANTO or (i, j) in fatti:
                        continue
                    fatti.add((i, j))
                    sl = lp.var(W_ACCANTO)
                    altro = self.a_frazione(j, t)
                    lp.riga([(i, 1)] + [(a, -w) for a, w in altro] + [(sl, -1)], ACCANTO_TOLL)
                    lp.riga([(i, -1)] + [(a, w) for a, w in altro] + [(sl, -1)], ACCANTO_TOLL)
        # conche da riempire (giri contro le onde): quota (o media pesata, lungo un binario) almeno fino al livello, con
        # una variabile di scarto
        for _ch, (termini, q) in sorted((onde or {}).items()):
            sl = lp.var(W_ONDA)
            lp.riga([(i, -w) for i, w in termini] + [(sl, -1)], -q)
        x = lp.risolvi()
        self.h = x[:N]
        self.violazioni = {
            'pendenze': sum(1 for sl, _k, _i in self.v_pend if x[sl] > 1e-4),
            'binari': sum(1 for sl in self.v_binari if x[sl] > 1e-4),
            'raccordi': sum(1 for sl, _i, _ks in self.v_racc if x[sl] > 1e-6),
            'franchi': [(round(p[0]), round(p[1]), tipo, round(float(x[sl]), 2)) for sl, _k, _t, tipo, p, _f in self.v_franco if x[sl] > 0.01],
        }
        return self.h

    def itinerari(self):
        """Le strade delle strutture come le percorre il controllo (scripts/cavalcavia.py, itinerari): da ogni piede lungo
        ogni arco, a ogni nodo l'arco più dritto (R.seguiti) della struttura, fin dove la struttura finisce. Una volta
        sola per insieme di archi. [(incognite, progressive in metri)]"""
        R, out, visti = self.R, [], set()
        for nd in sorted(self.piedi):
            for k0 in sorted(R.at[nd]):
                if k0 not in self.S:
                    continue
                inc, ss, archi, n, k, s0 = [], [], [], nd, k0, 0.0
                while k is not None:
                    archi.append(k)
                    idx, s = self.nodi_arco[k], self.s_arco[k]
                    L = R.lung[k]
                    seq = list(zip(idx, s)) if R.archi[k][0] == n else [(i, L - v) for i, v in zip(reversed(idx), reversed(s))]
                    for i, v in seq[1 if inc else 0:]:
                        inc.append(i)
                        ss.append(s0 + v)
                    s0 += L
                    n = R.altro(k, n)
                    dopo = [j for j in R.seguiti(k, n) if j in self.S and j not in archi]
                    k = dopo[0] if dopo else None
                ch = frozenset(archi)
                if len(inc) >= 3 and ch not in visti:
                    visti.add(ch)
                    out.append((inc, ss))
        return out

    def onde(self):
        """Le conche del profilo calcolato, come le conta il controllo (scripts/cavalcavia.py, onde: un minimo tra due
        massimi, profondo almeno ONDA_GIRO, con la discesa o la salita attorno più corta di TRATTO), lungo le strade e
        lungo i binari; per ognuna, nei punti più bassi del più basso dei due massimi meno ONDA_RESTO, la quota minima
        da chiedere al giro dopo. {chiave: ([(incognita, peso)], quota minima)}"""
        h, out = self.h, {}
        # si riempie solo dove la strada sta già sul suo rilevato o vicino a un ponte, dove il terreno sale con lei: a raso
        # le celle delle strade accanto non salgono, e la strada riempita restava sospesa qualche centimetro sopra, in
        # quota (al piazzale della stazione cambiavano lanterne del tram e paline, ai piedi ovest del Chiesanuova
        # l'incrocio con il SIR2 perdeva le lanterne). Lì una conca è il terreno com'è, e resta con il suo perché
        rilievo = lambda i: self.sul_ponte[i] or h[i] - self._nat[i] >= ONDA_RILIEVO

        def conche(q, ss):
            E = estremi(q, 0, len(q) - 1, ONDA_GIRO)
            for n in range(1, len(E) - 1):
                i, verso = E[n]
                sx, dx = E[n - 1][0], E[n + 1][0]
                if verso != -1 or min(q[sx], q[dx]) - q[i] < ONDA_GIRO or min(ss[i] - ss[sx], ss[dx] - ss[i]) >= TRATTO:
                    continue
                yield sx, dx, round(min(q[sx], q[dx]) - ONDA_RESTO, 4)
        # (quote al decimo di millimetro, come la rete delle strade sotto le campate: le ultime cifre della soluzione
        # possono cambiare da un processore all'altro, e queste soglie diventano termini noti del programma)
        for inc, ss in self.itinerari():
            q = [round(float(h[i]), 4) for i in inc]
            for sx, dx, livello in conche(q, ss):
                for m in range(sx + 1, dx):
                    if q[m] < livello and rilievo(inc[m]):
                        ch = ('strada', inc[m])
                        out[ch] = ([(inc[m], 1.0)], max(livello, out.get(ch, (None, -1e9))[1]))
        for r, riga in enumerate(self.lungo_binari):
            n = 0
            while n < len(riga):
                if riga[n] is None:
                    n += 1
                    continue
                a = n
                while n < len(riga) and riga[n] is not None:
                    n += 1
                termini = [self.a_frazione(*riga[m]) for m in range(a, n)]
                q = [round(sum(float(h[i]) * w for i, w in t), 4) for t in termini]
                ss = [m * BINARIO_PASSO for m in range(len(q))]
                for sx, dx, livello in conche(q, ss):
                    for m in range(sx + 1, dx, ONDA_BINARIO):
                        if q[m] < livello and all(rilievo(i) for i, _w in termini[m]):
                            ch = ('binario', r, a + m)
                            out[ch] = (termini[m], max(livello, out.get(ch, (None, -1e9))[1]))
        return out

    def franco(self, tipo, p):
        """(franco, quota) all'incrocio p: dal registro (`franchi`, la prima voce entro il suo `raggio`) il franco sopra
        quello che passa sotto al posto di quello della regola, oppure la quota minima dell'impalcato (`quota`: quella
        delle spalle, scripts/spalle_cavalcavia.py, che non dipende dal piano della campata); se no il franco della
        regola. Uno dei due è None."""
        for st in self.registro.get('strutture', []):
            for f in st.get('franchi', []):
                if math.dist(p, (f['x'], f['z'])) <= f.get('raggio', 30):
                    return (None, f['quota']) if 'quota' in f else (f['franco'], None)
        return FRANCO[tipo], None

    def quota(self, k, s):
        """Quota del profilo alla progressiva s dell'arco k."""
        idx, ss = self.nodi_arco[k], self.s_arco[k]
        n = len(idx) - 1
        f = max(0.0, min(1.0, s / (self.R.lung[k] or 1))) * n
        i = min(n - 1, int(f))
        w = f - i
        return float(self.h[idx[i]] * (1 - w) + self.h[idx[i + 1]] * w)


# ---------- il terreno ----------
class Terreno:
    """La griglia del terreno del gioco (bytes), con le celle della variante "via" fissate dalle strutture."""

    def __init__(self, g):
        self.g = g
        self.nx, self.nz, self.step, self.x0, self.z0 = g['nx'], g['nz'], g['step'], g['x0'], g['z0']
        self.scale, self.offset = g['scale'], g['offset']
        self.b = np.frombuffer(base64.b64decode(g['data']), dtype=np.uint8).reshape(self.nz, self.nx).copy()
        self.via = {}  # (i, j) -> byte

    def byte(self, q):
        return int(max(0, min(255, math.floor((q - self.offset) / self.scale + 0.5))))

    def celle(self, p, r):
        i0, i1 = max(0, math.ceil((p[0] - r - self.x0) / self.step)), min(self.nx - 1, math.floor((p[0] + r - self.x0) / self.step))
        j0, j1 = max(0, math.ceil((p[1] - r - self.z0) / self.step)), min(self.nz - 1, math.floor((p[1] + r - self.z0) / self.step))
        return [(i, j) for j in range(j0, j1 + 1) for i in range(i0, i1 + 1)]

    def centro(self, i, j):
        return self.x0 + i * self.step, self.z0 + j * self.step

    def quota_base(self, i, j):
        return self.b[j, i] * self.scale + self.offset

    def scrivi(self):
        """Il dizionario del terreno per la mappa: `data` con le piattaforme, `via` con le celle fissate, in righe
        [j, i0, byte, byte, ...] (celle di seguito sulla stessa riga)."""
        g = dict(self.g)
        g['data'] = base64.b64encode(self.b.tobytes()).decode()
        righe, cur = [], None
        for (j, i) in sorted((j, i) for (i, j) in self.via):
            if cur and cur[0] == j and cur[1] + len(cur) - 2 == i:
                cur.append(self.via[(i, j)])
            else:
                cur = [j, i, self.via[(i, j)]]
                righe.append(cur)
        g['via'] = righe
        return g


def _vicino_punto(g, p, r):
    return any(math.dist(g.segmenti[k][0], p) <= r for k in g.vicini(p, r))


def _piano(T, p, raggio, parte):
    v = sorted(T.quota_base(a, b) for a, b in T.celle(p, raggio) if math.dist(T.centro(a, b), p) <= raggio)
    return v[int(len(v) * parte)] if v else None


def piani_campate(R, P, T, gallerie):
    """Il piano di quello che passa sotto ogni campata: per ogni incognita di un ponte in quota il 35° percentile del
    terreno entro 30 m (le spalle stanno sopra, il piano della ferrovia o della strada sotto). Restituisce
    {incognita: quota}. Sopra i sottopassi (gallerie: [(arco, frazione, arco sotto, punto)]) aggiunge a P.campate il
    tratto largo quanto la strada di sotto più SOTTOPASSO per parte, con il 25° percentile entro 40 m (il rilevato
    occupa una striscia, il piano è quello intorno)."""
    out = {}
    for k in sorted(P.deck):
        for i in P.nodi_arco[k]:
            if i not in out:
                v = _piano(T, P.xz[i], 30.0, 0.35)
                out[i] = v if v is not None else P.nat.at(*P.xz[i])
    # ponti OSM su un rilevato: dove il DTM lungo l'asse sta ben sopra il piano intorno (15° percentile entro 40 m) il
    # rilievo vede un terrapieno, non una campata tolta (Via Boves: 280 m di "ponte" su un rilevato di 8 m). Lì la strada
    # sta sul rilevato come fuori dai ponti. Restano campata i 15 m attorno a quello che passa sotto e i tratti di
    # rilevato più corti di 20 m tra due campate (le pile)
    sopra = {}
    for k in sorted(P.deck):
        for i in P.nodi_arco[k]:
            if i not in sopra:
                v = _piano(T, P.xz[i], 40.0, 0.15)
                sopra[i] = v is not None and P.dtm.at(*P.xz[i]) - v > CAMPATA_VERA
    for k, t, _tipo, _j, _p in P.incroci:
        idx, ss = P.nodi_arco[k], P.s_arco[k]
        for n, i in enumerate(idx):
            if abs(ss[n] - t * R.lung[k]) <= PONTE_VICINO:
                sopra[i] = False
    for k in sorted(P.deck):
        idx, ss = P.nodi_arco[k], P.s_arco[k]
        tratti, a = [], None
        for n, i in enumerate(idx):
            if not sopra[i]:
                a = n if a is None else a
            if a is not None and (sopra[i] or n == len(idx) - 1):
                b = n if not sopra[i] else n - 1
                tratti.append((ss[a], ss[b], None))
                a = None
        # tratti vicini (meno di 20 m di rilevato in mezzo) sono una campata sola
        uniti = []
        for tr in tratti:
            if uniti and tr[0] - uniti[-1][1] < 20:
                uniti[-1] = (uniti[-1][0], tr[1], None)
            else:
                uniti.append(tr)
        uniti = [tr for tr in uniti if tr[1] > tr[0] or R.lung[k] < 2 * PASSO]
        if uniti:
            P.campate[k] = uniti
        else:
            del P.campate[k]
        for n, i in enumerate(idx):
            if not any(s0 <= ss[n] <= s1 for s0, s1, _f in uniti):
                P.rilevato.add(i)
    vere = [i for k in P.campate for n, i in enumerate(P.nodi_arco[k]) if any(s0 <= P.s_arco[k][n] <= s1 for s0, s1, _f in P.campate[k])]
    P.rilevato -= set(vere)
    gv = Griglia([(P.xz[i], P.xz[i]) for i in vere] or [((1e9, 1e9), (1e9, 1e9))], 30.0)
    P.vere = set(vere)
    P.sul_ponte = [(i in P.vere) or _vicino_punto(gv, p, PONTE_VICINO) or (P.g_ponti_terra.piu_vicino(p, PONTE_VICINO + 1) is not None) for i, p in enumerate(P.xz)]
    for k, t, j, p in gallerie:
        a = R.archi[j][3] / 2 + SOTTOPASSO
        v = _piano(T, p, 40.0, 0.25)
        if v is not None:
            P.campate.setdefault(k, []).append((t * R.lung[k] - a, t * R.lung[k] + a, v))
    return out


def non_riempire(R, P, T, acqua, fatte):
    """Attorno alle strutture (entro ATTORNO metri dai loro archi) la variante "via" non riempie: tra due rilevati
    vicini la chiusura morfologica alzava la strada che ci passa in mezzo fino alla loro quota (Corso Australia sotto il
    Cavalcavia Chiesanuova: +3,8 m). Le celle dove la chiusura alza il terreno di almeno due gradini si fissano al valore
    senza chiusura (con i ponti dei fiumi), tranne vicino ai corsi d'acqua. fatte: celle già decise (piattaforme)."""
    g = T.scrivi()
    chiusa, aperta = Via(g), Via({**g, 'close': 0})
    for c in fatte:
        chiusa._c.pop(c, None)
    ga = Griglia(acqua, 50.0) if acqua else None
    celle = set()
    for k in sorted(P.S):
        e = R.archi[k]
        A, B = R.nodi[e[0]], R.nodi[e[1]]
        L = R.lung[k]
        for c in T.celle(((A[0] + B[0]) / 2, (A[1] + B[1]) / 2), L / 2 + ATTORNO):
            if c in fatte or c in celle:
                continue
            x, z = T.centro(*c)
            t = max(0.0, min(1.0, ((x - A[0]) * (B[0] - A[0]) + (z - A[1]) * (B[1] - A[1])) / (L * L)))
            if math.hypot(A[0] + (B[0] - A[0]) * t - x, A[1] + (B[1] - A[1]) * t - z) <= ATTORNO:
                celle.add(c)
    n = 0
    for c in sorted(celle):
        v = aperta.cella(*c)
        if chiusa.cella(*c) - v >= 2 and not (ga and ga.piu_vicino(T.centro(*c), ACQUA) is not None):
            T.via[c] = v
            n += 1
    return n


def fuori_dalle_strutture(R, P):
    """Gli archi carrabili a terra che non sono delle strutture (le strade che restano sul terreno com'è)."""
    return [k for k in range(len(R.archi)) if k not in P.S and R.lung[k] > 0.05 and R.archi[k][2] != 8 and not R.archi[k][5] & 8
            and R.archi[k][7] >= 0]


class StradeSotto:
    """Le strade fuori dalle strutture che passano sotto una campata, e la loro quota lì (#125).

    Sotto una campata il terreno è il piano di quello che passa sotto (piani_campate: il 35° percentile entro 30 m), ma
    la strada di sotto tiene la sua quota. Né il piano né il DTM la danno: il piano lo fa il fosso o il canale accanto
    (Corso Primo Maggio sotto Via Salboro scendeva di 0,7 m, il Lungargine San Lazzaro sotto Corso Irlanda di 2 m), e
    nel DTM, da cui le campate sono state tolte, sotto l'impalcato resta quello che il rilievo interpola dalle spalle e
    dalle pile (Via Friburgo sotto il Grassi +2,4 m, Corso Australia sotto il Chiesanuova +4 m). La quota vera della
    strada di sotto è quella che ha appena fuori dalle celle della campata (l'ombra), dove il terreno resta com'è.

    Le strade fuori dalle strutture che entrano nell'ombra sono una rete di punti ogni SOTTO_PASSO metri, con i nodi in
    comune, che prosegue sulle rampe delle strutture dove una strada ci entra: i punti fuori dall'ombra hanno la quota
    del terreno, quelli dentro la media dei vicini lungo la strada (pesata con l'inverso della distanza). Su una strada
    sola è la retta tra i due lati; a un incrocio sotto la campata le strade arrivano alla stessa quota; dove una strada
    finisce nell'ombra (un capo cieco, o l'impalcato) prosegue in piano. Una parte della rete che non esce mai
    dall'ombra (una bretella tutta sotto un viadotto, tra due impalcati) non ha quota: lì resta il piano della campata.
    Il terreno di base è quello senza chiusura (la variante "via" lo riprende entro un gradino: non_riempire)."""

    def __init__(self, R, P, T, terreno):
        self.R, self.P, self.T = R, P, T
        self.base = Via({**terreno, 'close': 0})
        self.celle = set()  # l'ombra: le celle che il terreno sotto le campate cambia (adatta_terreno)
        for k, tratti in P.campate.items():
            e = R.archi[k]
            A, B = R.nodi[e[0]], R.nodi[e[1]]
            L = R.lung[k]
            w = max(e[3] / 2 + MARGINE_CAMPATA, NUCLEO + e[3] / 2 + (AFFIANCA if P.tram[k] else 0))
            for c in T.celle(((A[0] + B[0]) / 2, (A[1] + B[1]) / 2), L / 2 + w):
                x, z = T.centro(*c)
                t = max(0.0, min(1.0, ((x - A[0]) * (B[0] - A[0]) + (z - A[1]) * (B[1] - A[1])) / (L * L)))
                if math.hypot(A[0] + (B[0] - A[0]) * t - x, A[1] + (B[1] - A[1]) * t - z) <= w \
                        and any(s0 <= t * L <= s1 for s0, s1, _f in tratti):
                    self.celle.add(c)
        self.fuori = fuori_dalle_strutture(R, P)
        self.di_fuori = set(self.fuori)
        self.g_fuori = Griglia([(R.nodi[R.archi[k][0]], R.nodi[R.archi[k][1]]) for k in self.fuori] or [((1e9, 1e9), (1e9, 1e9))], 40.0)
        self.quote = self._rete()

    def libero(self, x, z):
        """Vero se nessuna delle quattro celle attorno al punto è nell'ombra."""
        T = self.T
        i, j = math.floor((x - T.x0) / T.step), math.floor((z - T.z0) / T.step)
        return not any(c in self.celle for c in ((i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1)))

    def _punto(self, j, s):
        e = self.R.archi[j]
        A, B = self.R.nodi[e[0]], self.R.nodi[e[1]]
        t = s / (self.R.lung[j] or 1)
        return A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t

    def _rete(self):
        """{arco: [quota o None in ogni punto]} per le strade fuori dalle strutture che entrano nell'ombra."""
        from scipy.sparse.linalg import spsolve
        R = self.R
        n_di = lambda j: max(1, math.ceil(R.lung[j] / SOTTO_PASSO))
        candidati = sorted({self.fuori[m] for c in self.celle for m in self.g_fuori.vicini(self.T.centro(*c), NUCLEO)})
        coda = [j for j in candidati if not all(self.libero(*self._punto(j, R.lung[j] * i / n_di(j))) for i in range(n_di(j) + 1))]
        # da un nodo nell'ombra la rete prosegue sulle strade fuori dalle strutture e sulle rampe (archi delle strutture
        # che non sono campate): dove la strada di sotto entra nella struttura, la rampa fuori dall'ombra sta sul suo
        # rilevato, che il DTM vede (Via Sergio Fraccalanza sotto il San Marco: in piano fino al piede la strada faceva
        # un gradino di 0,8 m con la rampa)
        prosegue = lambda m: m in self.di_fuori or (m in self.P.S and m not in self.P.campate and R.archi[m][2] != 8)
        archi = set()
        while coda:
            j = coda.pop()
            if j in archi:
                continue
            archi.add(j)
            for nd in R.archi[j][:2]:
                if not self.libero(*R.nodi[nd]):
                    coda += [m for m in R.at[nd] if prosegue(m) and m not in archi]
        indice, valore, chiavi = {}, [], {}
        lati = defaultdict(float)  # (punto, punto) -> peso
        for j in sorted(archi):
            n = n_di(j)
            a, b = R.archi[j][:2]
            ks = []
            for i in range(n + 1):
                ch = ('n', a) if i == 0 else ('n', b) if i == n else ('a', j, i)
                if ch not in indice:
                    p = self._punto(j, R.lung[j] * i / n)
                    indice[ch] = len(valore)
                    valore.append(self.base.at(*p) if self.libero(*p) else None)
                ks.append(indice[ch])
            chiavi[j] = ks
            for u, v in zip(ks, ks[1:]):
                if u != v:
                    lati[(min(u, v), max(u, v))] += n / R.lung[j]
        ignote = [u for u, v in enumerate(valore) if v is None]
        pos = {u: i for i, u in enumerate(ignote)}
        if ignote:
            # parti della rete nell'ombra: quelle senza un punto fuori restano senza quota
            righe, col = [], []
            for (u, v) in lati:
                if u in pos and v in pos:
                    righe += [pos[u], pos[v]]
                    col += [pos[v], pos[u]]
            m = len(ignote)
            _n, parte = connected_components(coo_matrix((np.ones(len(righe)), (righe, col)), shape=(m, m)), directed=False)
            bordo = set()
            for (u, v) in lati:
                for a, b in ((u, v), (v, u)):
                    if a in pos and b not in pos:
                        bordo.add(parte[pos[a]])
            dentro = [u for u in ignote if parte[pos[u]] in bordo]
            q = {u: i for i, u in enumerate(dentro)}
            r, c, w = [], [], []
            rhs = np.zeros(len(dentro))
            for (u, v), peso in lati.items():
                for a, b in ((u, v), (v, u)):
                    if a in q:
                        r.append(q[a])
                        c.append(q[a])
                        w.append(peso)
                        if b in q:
                            r.append(q[a])
                            c.append(q[b])
                            w.append(-peso)
                        else:
                            rhs[q[a]] += peso * valore[b]
            if dentro:
                # (al decimo di millimetro: le ultime cifre di spsolve cambiano da un processore all'altro, e queste quote
                # entrano nei franchi del programma lineare, che dove ha più soluzioni dello stesso costo cambia scelta:
                # la mappa di Docker sul Mac e quella della CI differivano in due archi)
                x = np.atleast_1d(spsolve(coo_matrix((w, (r, c)), shape=(len(dentro), len(dentro))).tocsc(), rhs))
                for u, i in q.items():
                    valore[u] = round(float(x[i]), 4)
        return {j: [valore[u] for u in ks] for j, ks in chiavi.items()}

    def quota(self, j, s):
        """Quota della strada j (fuori dalle strutture) alla progressiva s, o None dove la sua parte della rete non esce
        dall'ombra. Non il terreno nel punto: nell'ombra la variante "via" ha anche i ponti a terra di
        street_surfaces.terrain_for_game sotto gli impalcati, la retta tra le spalle."""
        L = self.R.lung[j] or 1
        q = self.quote.get(j)
        if q is None:
            p = self._punto(j, s)
            return self.base.at(*p) if self.libero(*p) else None
        f = max(0.0, min(1.0, s / L)) * (len(q) - 1)
        i = min(len(q) - 2, int(f))
        if q[i] is None or q[i + 1] is None:
            return None
        return q[i] + (q[i + 1] - q[i]) * (f - i)

    def in_punto(self, j, p):
        """Quota della strada j nel punto p (proiettato sul suo asse), o None (quota)."""
        e = self.R.archi[j]
        A, B = self.R.nodi[e[0]], self.R.nodi[e[1]]
        L = self.R.lung[j] or 1
        t = max(0.0, min(1.0, ((p[0] - A[0]) * (B[0] - A[0]) + (p[1] - A[1]) * (B[1] - A[1])) / (L * L)))
        return self.quota(j, t * L)

    def cella(self, c, ombra=False):
        """Quota della strada fuori dalle strutture il cui asse passa più vicino al centro della cella c, entro NUCLEO, o
        None. Con ombra=True solo dove quella strada è nell'ombra di una campata (la sua quota viene dalla rete, non dal
        terreno com'è)."""
        p = self.T.centro(*c)
        v = self.g_fuori.vicino(p, NUCLEO)
        if v is None:
            return None
        j = self.fuori[v[1]]
        if ombra:
            e = self.R.archi[j]
            A, B = self.R.nodi[e[0]], self.R.nodi[e[1]]
            L = self.R.lung[j] or 1
            t = max(0.0, min(1.0, ((p[0] - A[0]) * (B[0] - A[0]) + (p[1] - A[1]) * (B[1] - A[1])) / (L * L)))
            if self.libero(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t):
                return None
        return self.in_punto(j, p)


def adatta_terreno(R, P, T, piano, solo_campate=False, sotto=None):
    """Scrive nel terreno le piattaforme (quota del profilo fuori dalle campate, con la discesa di SPALLA metri verso il
    piano di sotto prima di ogni campata) e il piano sotto le campate. La cella prende la quota dell'arco più vicino, alla
    sua proiezione; sotto una campata vale sempre il piano della campata, tranne entro NUCLEO dall'asse di una strada
    fuori dalla struttura, dove vale la quota di quella strada (sotto: StradeSotto). Fuori dalle campate, dove quella
    strada è nell'ombra di una campata, la cella non sta più su della sua quota."""
    import heapq
    # metri dalla campata più vicina lungo le strade della struttura, e il piano di quella campata
    dist, heap = {}, []
    for k in P.deck:
        for nd in R.archi[k][:2]:
            heapq.heappush(heap, (0.0, nd, piano[P.di_nodo[nd]]))
    while heap:
        d, nd, f = heapq.heappop(heap)
        if nd in dist:
            continue
        dist[nd] = (d, f)
        if d >= SPALLA:
            continue
        for j in R.at[nd]:
            if j in P.S and j not in P.deck:
                o = R.altro(j, nd)
                if o not in dist:
                    heapq.heappush(heap, (d + R.lung[j], o, f))

    def campata(k, s):
        """Il piano della campata dell'arco k alla progressiva s, o None."""
        for s0, s1, f in P.campate.get(k, ()):
            if s0 <= s <= s1:
                return f if f is not None else sum(piano[i] * w for i, w in P.a_frazione(k, s / (R.lung[k] or 1)))
        return None

    def bersaglio(k, i):
        """Quota del terreno sotto la i-esima incognita dell'arco k."""
        v = P.nodi_arco[k][i]
        if solo_campate:
            return piano.get(v, 0.0)
        h = float(P.h[v])
        a, b = R.archi[k][:2]
        s = P.s_arco[k][i]
        cand = [(dist[n][0] + ds, dist[n][1]) for n, ds in ((a, s), (b, R.lung[k] - s)) if n in dist]
        if cand:
            d, f = min(cand)
            if d < SPALLA and f < h:
                u = d / SPALLA
                return f + (h - f) * u * u * (3 - 2 * u)  # senza spigoli: chi campiona la quota ogni pochi metri non salta
        return h
    # le celle attorno all'asse di una strada che non è della struttura restano com'erano (lì la strada sta sul terreno)
    fuori = sotto.fuori if sotto else fuori_dalle_strutture(R, P)
    g_fuori = sotto.g_fuori if sotto else Griglia([(R.nodi[R.archi[k][0]], R.nodi[R.archi[k][1]]) for k in fuori] or [((1e9, 1e9), (1e9, 1e9))], 40.0)
    scelta = {}  # cella -> (priorità, distanza, quota, ponte a terra)
    nucleo = {}  # cella -> (quota, campata, ponte a terra): la più bassa tra gli archi che le passano entro NUCLEO
    nucleo_oltre = {}  # come nucleo, oltre i capi degli archi: conta dove nessun arco a terra della struttura copre la cella
    a_terra = set()
    asse = {}    # cella -> metri dall'asse più vicino di un arco della struttura che le passa accanto
    for k in sorted(P.campate if solo_campate else P.S):
        e = R.archi[k]
        A, B = R.nodi[e[0]], R.nodi[e[1]]
        L = R.lung[k]
        w = e[3] / 2 + (MARGINE_CAMPATA if k in P.campate else MARGINE)
        # il nucleo copre le celle attorno a ogni punto della carreggiata, e della sede del tram se la affianca
        nuc = NUCLEO + e[3] / 2 + (AFFIANCA if P.tram[k] else 0)
        w = max(w, nuc)
        idx = P.nodi_arco[k]
        q = [bersaglio(k, i) for i in range(len(idx))]
        n = len(idx) - 1
        m = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
        for c in T.celle(m, L / 2 + w):
            x, z = T.centro(*c)
            t = ((x - A[0]) * (B[0] - A[0]) + (z - A[1]) * (B[1] - A[1])) / (L * L)
            dentro = 0 <= t <= 1
            tc = max(0.0, min(1.0, t))
            d = math.hypot(A[0] + (B[0] - A[0]) * tc - x, A[1] + (B[1] - A[1]) * tc - z)
            if d > w:
                continue
            f = tc * n
            i = min(n - 1, int(f))
            quota = q[i] + (q[i + 1] - q[i]) * (f - i)
            fc = campata(k, tc * L) if k in P.campate else None
            campata_qui = fc is not None
            if campata_qui:
                quota = fc
            elif solo_campate or d > max(e[3] / 2 + MARGINE, nuc):
                continue
            # sotto una campata vale il suo piano; oltre i capi di un arco (calotta) conta meno di chi ci passa accanto
            pr = (0 if campata_qui and dentro else 1 if dentro else 2 if not campata_qui else 3, d)
            if c not in scelta or pr < scelta[c][0]:
                scelta[c] = (pr, quota, campata_qui, bool(e[5] & 4))
            # (solo dove la cella si proietta dentro l'arco: oltre i capi la quota del nodo non è quella della strada lì.
            # Oltre un capo che non è un piede, su un arco che non è una campata, sì: lì la strada prosegue nella
            # struttura, e le celle all'esterno della curva che nessun arco copre restavano al piano della campata accanto,
            # più alto della strada che passa a terra: Via Friburgo sul Grassi saliva di 1,3 m)
            oltre = not dentro and k not in P.campate and R.archi[k][0 if t < 0 else 1] not in P.piedi
            if (dentro or oltre) and d <= nuc:
                nc = nucleo if dentro else nucleo_oltre
                if dentro:
                    asse[c] = min(d, asse.get(c, 1e9))
                    if k not in P.campate:
                        a_terra.add(c)
                v = nc.get(c)
                # sotto una campata la cella resta "sotto una campata" anche se la quota più bassa è di un'altra strada
                nc[c] = (min(quota, v[0]) if v else quota, campata_qui or bool(v and v[1]), bool(e[5] & 4) if not v or quota < v[0] else v[2])
    for c, v in nucleo_oltre.items():
        if c in a_terra:
            continue
        u = nucleo.get(c)
        nucleo[c] = v if not u else (min(u[0], v[0]), u[1] or v[1], v[2] if v[0] < u[0] else u[2])
    for c, v in nucleo.items():
        scelta[c] = (None, *v)
    # (non salgono mai: la strada di fuori sta sul terreno e si alzerebbe con loro. Scendono al profilo se l'asse della
    # struttura è più vicino del suo: un rilevato del DTM più alto del profilo spunterebbe dalla carreggiata e dalla
    # sede del tram, che sopra il terreno si possono alzare e sotto no)
    # (sotto una campata la strada di sotto tiene la sua quota, e le celle attorno al suo asse la prendono: il piano della
    # campata lo fa anche il fosso accanto, e la strada sprofondava)
    protette = 0
    for c in list(scelta):
        if scelta[c][2]:
            v = sotto.cella(c) if sotto else None
            if v is not None:
                scelta[c] = (scelta[c][0], v, True, scelta[c][3])
            continue
        d = g_fuori.piu_vicino(T.centro(*c), NUCLEO)
        if d is None:
            continue
        # (dove la strada di fuori è nell'ombra di una campata la sua quota è quella della rete, e la cella non sta più
        # su: la rampa della struttura che le corre accanto resta al suo profilo con la quota sopra il terreno, la strada
        # di sotto senza dosso. Corso Australia sotto il Chiesanuova saliva di 0,6 m sulle celle della rampa accanto)
        v = sotto.cella(c, ombra=True) if sotto else None
        if asse.get(c, 1e9) < d and T.byte(scelta[c][1]) < T.b[c[1], c[0]]:
            if v is not None and T.byte(v) < T.byte(scelta[c][1]):
                scelta[c] = (scelta[c][0], v, scelta[c][2], scelta[c][3])
            continue
        if v is not None and T.byte(v) < T.b[c[1], c[0]]:
            scelta[c] = (scelta[c][0], v, scelta[c][2], scelta[c][3])
            continue
        del scelta[c]
        protette += 1
    for c, (_pr, quota, campata, ponte) in scelta.items():
        b = T.byte(quota)
        T.via[c] = b
        i, j = c
        if campata:
            T.b[j, i] = min(T.b[j, i], b)   # il suolo non spunta sopra quello che passa sotto
        elif not ponte:
            T.b[j, i] = b                   # rilevato alla quota del profilo (sui ponti dei fiumi il fondo resta l'alveo)
    return set(scelta)


def _sfoltisci(ss, qs, fissi, toll):
    """Toglie i punti che stanno sulla retta tra quello tenuto prima e quello dopo, entro toll; `fissi` restano."""
    keep = [0]
    for i in range(1, len(ss) - 1):
        a, b = keep[-1], i + 1
        if ss[i] in fissi or any(abs(qs[a] + (qs[b] - qs[a]) * (ss[j] - ss[a]) / ((ss[b] - ss[a]) or 1) - qs[j]) > toll for j in range(a + 1, b)):
            keep.append(i)
    keep.append(len(ss) - 1)
    return [ss[i] for i in keep], [qs[i] for i in keep]


def vicine_a_quote_di_prima(nodes, edges, strutture, quote):
    """Gli id delle strutture con un nodo a meno di VICINE metri da un arco in quota con le quote di prima (`quote`:
    {nodo: quota} di street_surfaces.overpass_heights, senza gli archi di `strutture`)."""
    S = {k for s in strutture for k in s['archi']}
    vecchi = [k for k, e in enumerate(edges) if k not in S and max(quote.get(e[0], 0), quote.get(e[1], 0)) > QUOTA_DI_PRIMA]
    g = Griglia([(nodes[edges[k][0]], nodes[edges[k][1]]) for k in vecchi] or [((1e9, 1e9), (1e9, 1e9))], 100.0)
    return {s['id'] for s in strutture if any(g.piu_vicino(nodes[n], VICINE) is not None for k in s['archi'] for n in edges[k][:2])}


def tieni_quote_di_prima(R, P, T, prima, quote):
    """I cavalcavia con le quote di prima (street_surfaces.overpass_heights: quota sopra il terreno spianato sotto di
    loro) accanto a una struttura con il profilo tengono il loro terreno: le celle attorno ai loro archi, fin dove la
    quota del terreno conta per chi ci passa (carreggiata più NUCLEO), prendono quelle di `prima`, nel terreno di base e
    fissate nella variante "via". `prima` è il terreno com'è senza le strutture vicine (build_map lo calcola con quelle
    strutture spente: lì le loro rampe sono spianate come le altre). Senza, le piattaforme, la chiusura morfologica che
    cambia attorno alla struttura (raggio di quattro celle) e la spianatura che non c'è più sotto le sue rampe
    spostavano il terreno sotto il cavalcavia accanto, e con il terreno la sua quota (Corso Irlanda accanto al
    Cavalcavia San Marco: da -1,8 a +2,2 m). quote: {nodo: quota} di overpass_heights. Restituisce quante celle ha
    fissato."""
    vecchi = [k for k, e in enumerate(R.archi) if k not in P.S and R.lung[k] > 0.05 and max(quote.get(e[0], 0), quote.get(e[1], 0)) > QUOTA_DI_PRIMA]
    if not vecchi or prima is None:
        return 0
    g_s = Griglia([(R.nodi[R.archi[k][0]], R.nodi[R.archi[k][1]]) for k in sorted(P.S)], 100.0)
    via0, base0 = Via(prima), Terreno(prima)
    celle = set()
    for k in vecchi:
        e = R.archi[k]
        A, B = R.nodi[e[0]], R.nodi[e[1]]
        L = R.lung[k]
        if g_s.piu_vicino(A, VICINE) is None and g_s.piu_vicino(B, VICINE) is None:
            continue
        w = e[3] / 2 + NUCLEO
        for c in T.celle(((A[0] + B[0]) / 2, (A[1] + B[1]) / 2), L / 2 + w):
            x, z = T.centro(*c)
            t = max(0.0, min(1.0, ((x - A[0]) * (B[0] - A[0]) + (z - A[1]) * (B[1] - A[1])) / (L * L)))
            if math.hypot(A[0] + (B[0] - A[0]) * t - x, A[1] + (B[1] - A[1]) * t - z) <= w:
                celle.add(c)
    for (i, j) in celle:
        T.b[j, i] = base0.b[j, i]
        T.via[(i, j)] = via0.cella(i, j)
    return len(celle)


def quote_archi(R, P, T, via):
    """Per ogni arco delle strutture la quota sopra il terreno: profilo meno terreno "via" (campionato come il gioco),
    un punto a ogni incognita e a ogni confine di cella della griglia, e in mezzo quelli che servono perché terreno più
    quota dia il profilo entro FEDELE (lungo un arco in diagonale il terreno interpolato tra quattro celle è una
    parabola, non una retta: sotto le spalle, dove le celle hanno quote molto diverse, tra due incognite si scostava
    di qualche centimetro). {arco: ([progressive in cm], [quote in mm])} per gli archi in quota (oltre IN_QUOTA in
    qualche punto)."""
    out = {}
    for k in sorted(P.S):
        e = R.archi[k]
        A, B = R.nodi[e[0]], R.nodi[e[1]]
        L = R.lung[k]
        ss = set(round(s * 100) for s in P.s_arco[k])
        for asse, a, b, o in ((0, A[0], B[0], T.x0), (1, A[1], B[1], T.z0)):
            if abs(b - a) < 1e-6:
                continue
            lo, hi = sorted((a, b))
            for g in range(math.ceil((lo - o) / T.step), math.floor((hi - o) / T.step) + 1):
                t = (o + g * T.step - a) / (b - a)
                if 0 < t < 1:
                    ss.add(round(t * L * 100))
        fissi = set(ss)
        ss |= set(range(0, round(L * 100), FITTO))
        ss = sorted(s for s in ss if 0 <= s <= round(L * 100))
        if ss[-1] != round(L * 100):
            ss.append(round(L * 100))
        qs = []
        for s in ss:
            t = min(1.0, s / 100 / L)
            x, z = A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t
            qs.append(max(0, round((P.quota(k, t * L) - via.at(x, z)) * 1000)))
        # un piede sta sul terreno: il profilo lì è il terreno del primo giro, e se il secondo giro ha cambiato la cella
        # di un gradino (5,6 cm) il piede restava qualche centimetro sopra. La sua quota passava agli archi fuori dalla
        # struttura, lineare fino all'altro capo, e un arco a terra lungo 400 m contava come in quota (#124). Negli
        # ultimi ARRIVO metri prima di un piede, dove il profilo segue già il terreno com'è, quello scarto scende a zero
        for nd, s_nd in ((e[0], 0), (e[1], round(L * 100))):
            q0 = qs[0] if s_nd == 0 else qs[-1]
            if nd in P.piedi and q0 > 0:
                arco = min(ARRIVO, L) * 100
                qs = [max(0, round(q - q0 * (1 - abs(s - s_nd) / arco))) if abs(s - s_nd) < arco else q for s, q in zip(ss, qs)]
        if max(qs) > IN_QUOTA * 1000:
            out[k] = _sfoltisci(ss, qs, fissi, FEDELE)
    return out


# ---------- tutto insieme ----------
def griglia_via(g):
    """La variante "via" del terreno g come la calcola il gioco (src/world/terrain.js), su tutta la griglia: chiusura
    morfologica sui byte, ponti che alzano le celle vicine, celle fissate. Restituisce la funzione quota(x, z)."""
    from street_surfaces import closing
    nx, nz, step, x0, z0 = g['nx'], g['nz'], g['step'], g['x0'], g['z0']
    b = np.frombuffer(base64.b64decode(g['data']), dtype=np.uint8).reshape(nz, nx).astype(np.int32)
    d = closing(b, g.get('close', 0)) if g.get('close', 0) else b.copy()
    for br in g.get('bridges', []):
        w = br[0]
        for k in range(1, len(br) - 5, 3):
            ax, az, ah, bx, bz, bh = br[k:k + 6]
            ex, ez = bx - ax, bz - az
            l2 = ex * ex + ez * ez or 1
            i0, i1 = max(0, math.floor((min(ax, bx) - w - x0) / step)), min(nx - 1, math.ceil((max(ax, bx) + w - x0) / step))
            j0, j1 = max(0, math.floor((min(az, bz) - w - z0) / step)), min(nz - 1, math.ceil((max(az, bz) + w - z0) / step))
            if i0 > i1 or j0 > j1:
                continue
            X, Z = np.meshgrid(x0 + np.arange(i0, i1 + 1) * step, z0 + np.arange(j0, j1 + 1) * step)
            t = np.clip(((X - ax) * ex + (Z - az) * ez) / l2, 0, 1)
            vicino = np.hypot(X - ax - ex * t, Z - az - ez * t) <= w
            v = np.minimum(255, np.floor((ah + (bh - ah) * t - g['offset']) / g['scale'] + 0.5)).astype(np.int32)
            sub = d[j0:j1 + 1, i0:i1 + 1]
            sub[vicino & (v > sub)] = v[vicino & (v > sub)]
    for r in g.get('via', []):
        d[r[0], r[1]:r[1] + len(r) - 2] = r[2:]
    sc, off = g['scale'], g['offset']

    def quota(x, z):
        fx = min(max((x - x0) / step, 0), nx - 1.001)
        fz = min(max((z - z0) / step, 0), nz - 1.001)
        i, j = int(fx), int(fz)
        tx, tz = fx - i, fz - j
        return float((d[j, i] * (1 - tx) + d[j, i + 1] * tx) * (1 - tz) + (d[j + 1, i] * (1 - tx) + d[j + 1, i + 1] * tx) * tz) * sc + off
    quota.griglia = d
    return quota


def strutture_rete(nodes, edges, names, rails, tram, terreno, dtm):
    """Le strutture della rete, prima di calcolarne il profilo: (rete, ponti, incroci, nodi delle strade che passano
    sotto, strutture). terreno: quello del gioco senza le strutture."""
    R = Rete(nodes, edges, names, rails, tram)
    deck, incroci = impalcati(R)
    sotto = {n for _k, _t, _tipo, j, _p in incroci if j is not None for n in R.archi[j][:2]}
    T = Terreno(terreno)
    G_dtm = Griglia10(dtm)
    memo = {}

    def fuori_terra(n):
        if n not in memo:
            v = _piano(T, R.nodi[n], 40.0, 0.25)
            memo[n] = v is not None and abs(G_dtm.at(*R.nodi[n]) - v) > FUORI_TERRA
        return memo[n]
    S = finestra(R, deck, sotto, fuori_terra)
    return R, deck, incroci, sotto, nomina(R, componenti(R, S), deck)


def attive(strutture, registro):
    """Le strutture con il profilo calcolato qui: quelle con `profilo` vero nel registro (le altre restano con le quote
    di street_surfaces.overpass_heights finché non sono verificate una per una)."""
    reg = {s['id']: s for s in registro.get('strutture', [])}
    return [s for s in strutture if reg.get(s['id'], {}).get('profilo')]


def calcola(nodes, edges, names, rails, tram, terreno, dtm, registro=None, acqua=None, tutte=False, log=print, pronte=None, quote_di_prima=None,
            terreno_prima=None):
    """nodes, edges, names, rails: la rete in costruzione; tram: i binari (spezzate piatte); terreno: il dizionario del
    terreno senza le strutture attive (street_surfaces.terrain_for_game); dtm: data/dtm-padova.json; pronte: il
    risultato di strutture_rete, se già calcolato. Con tutte=True il profilo si calcola per ogni struttura.
    quote_di_prima: {nodo: quota} dei cavalcavia che tengono le quote di street_surfaces.overpass_heights, e
    terreno_prima: il terreno senza le strutture che stanno accanto a loro (vicine_a_quote_di_prima): sotto quei
    cavalcavia il terreno resta quello (tieni_quote_di_prima).
    Restituisce {'terreno', 'edgeH', 'nodeH', 'cavalcavia', 'strutture', 'profili', ...}."""
    registro = registro if registro is not None else carica_registro()
    R, deck, incroci, sotto, tutte_le_strutture = pronte or strutture_rete(nodes, edges, names, rails, tram, terreno, dtm)
    strutture = tutte_le_strutture if tutte else attive(tutte_le_strutture, registro)
    S = {k for s in strutture for k in s['archi']}
    deck = deck & S
    incroci = [c for c in incroci if c[0] in S]
    if not S:
        return {'terreno': dict(terreno), 'edgeH': [], 'nodeH': {}, 'cavalcavia': [], 'strutture': [], 'tutte': tutte_le_strutture,
                'profili': None, 'rete': R, 'incroci': incroci, 'archi': S}
    base = Griglia10(terreno)
    T = Terreno(terreno)
    G_dtm = Griglia10(dtm)
    P = Profili(R, S, deck, incroci, sotto, Via(terreno), base, G_dtm, registro, strutture)
    gallerie = sottopassi(R, S, deck)
    piano = piani_campate(R, P, T, gallerie)
    segmenti_acqua = []
    for w in acqua or []:
        f = w[-1]
        pts = [(f[i], f[i + 1]) for i in range(0, len(f) - 1, 2)]
        segmenti_acqua += list(zip(pts, pts[1:]))
    # le strade fuori dalla struttura che passano sotto le campate tengono la loro quota (StradeSotto)
    sotto = StradeSotto(R, P, T, terreno)
    # i piedi stanno alla quota del terreno com'è con il piano sotto le campate e senza il riempimento della chiusura
    T0 = Terreno(terreno)
    fatte = adatta_terreno(R, P, T0, piano, solo_campate=True, sotto=sotto)
    non_riempire(R, P, T0, segmenti_acqua, fatte)
    tieni_quote_di_prima(R, P, T0, terreno_prima, quote_di_prima or {})
    P.nat = Via(T0.scrivi())

    def piano_di(k, t, j=None, p=None):
        """Quota di quello che passa sotto l'arco k alla frazione t: la strada j, fuori dalla struttura, se c'è (il
        franco si misura da lei), se no il piano della campata."""
        v = sotto.in_punto(j, p) if j is not None else None
        return v if v is not None else sum(piano[i] * w for i, w in P.a_frazione(k, t))
    # due giri: il terreno adattato al profilo cambia un poco la quota ai piedi (le celle accanto alle strade fuori dalla
    # struttura restano com'erano, ma la chiusura attorno cambia), e il secondo giro parte da lì
    # in ogni giro, dopo la prima soluzione, fino a GIRI_ONDE giri contro le onde: le conche trovate si chiedono riempite
    # (Profili.onde) e si risolve di nuovo; le richieste restano per i giri dopo
    onde = {}
    for giro in range(2):
        P.risolvi(piano_di, onde)
        trovate = len(P.onde())
        for _g in range(GIRI_ONDE):
            nuove = P.onde()
            if not nuove:
                break
            for ch, (t, q) in nuove.items():
                onde[ch] = (t, max(q, onde.get(ch, (None, -1e9))[1]))
            P.risolvi(piano_di, onde)
        log(f'cavalcavia: {len(strutture)} strutture, {len(S)} archi ({sum(R.lung[k] for k in S) / 1000:.1f} km), {P.N} incognite; '
            f"oltre la regola: pendenze {P.violazioni['pendenze']}, pendenze dei binari {P.violazioni['binari']}, raccordi {P.violazioni['raccordi']}, franchi {P.violazioni['franchi']}; "
            f'punti nelle conche: {trovate} prima dei giri contro le onde, {len(P.onde())} dopo')
        T = Terreno(terreno)
        fatte = adatta_terreno(R, P, T, piano, sotto=sotto)
        n = len(fatte)
        aperte = non_riempire(R, P, T, segmenti_acqua, fatte)
        tenute = tieni_quote_di_prima(R, P, T, terreno_prima, quote_di_prima or {})
        g = T.scrivi()
        P.nat = Via(g)
    via = Via(g)
    eh = quote_archi(R, P, T, via)
    nh = {}
    for k, (ss, qs) in eh.items():
        for nd, q in ((R.archi[k][0], qs[0]), (R.archi[k][1], qs[-1])):
            if q > 0:
                nh[nd] = max(nh.get(nd, 0), round(q / 1000, 2))
    log(f'cavalcavia: {n} celle del terreno adattate, {aperte} senza riempimento, {tenute} tenute sotto i cavalcavia con le quote di prima, '
        f'{len(gallerie)} sottopassi, {len(eh)} archi in quota, '
        f'{sum(1 for k in eh if not any(k in P.campate for _ in (0,)))} dei quali senza campate')
    cav = [{'id': s['id'], 'x': s['x'], 'z': s['z'], 'archi': sorted(s['archi'])} for s in strutture]
    return {'terreno': g, 'edgeH': [[k, ss, qs] for k, (ss, qs) in sorted(eh.items())], 'nodeH': nh, 'cavalcavia': cav,
            'strutture': strutture, 'tutte': tutte_le_strutture, 'profili': P, 'rete': R, 'incroci': incroci, 'archi': S}


def voci_registro(R, strutture, incroci):
    """I campi del registro scritti dalla build, per struttura: ponti (spezzate), cosa scavalcano, posto, metri."""
    out = []
    for s in strutture:
        sc = Counter()
        for k, _t, tipo, j, _p in incroci:
            if k in s['archi']:
                sc['ferrovia' if tipo == 'ferrovia' else (R.nome(j) or 'strada senza nome')] += 1
        ponti = sorted([[round(v) for n in R.archi[k][:2] for v in R.nodi[n]] for k in s['ponti']])
        out.append({'id': s['id'], 'x': s['x'], 'z': s['z'], 'metri': s['metri'], 'scavalca': sorted(sc), 'ponti': ponti})
    return out


def confronta_registro(registro, voci):
    """Righe di errore se le strutture della rete non sono quelle del registro."""
    noti = {s['id']: s for s in registro.get('strutture', [])}
    oggi = {v['id']: v for v in voci}
    err = [f'struttura fuori dal registro: {i}' for i in oggi if i not in noti]
    err += [f'struttura del registro che non c\'è più: {i}' for i in noti if i not in oggi]
    for i, v in oggi.items():
        if i in noti and (noti[i].get('ponti') != v['ponti'] or noti[i].get('scavalca') != v['scavalca']):
            err.append(f'struttura cambiata rispetto al registro: {i}')
    return err


def scrivi_registro(registro, voci, path=REGISTRO):
    """Riscrive il registro: i campi della build da `voci`, quelli messi a mano dalle voci di prima."""
    noti = {s['id']: s for s in registro.get('strutture', [])}
    out = []
    for v in voci:
        mano = {k: x for k, x in noti.get(v['id'], {}).items() if k in ('profilo', 'perche', 'punti', 'franchi')}
        out.append({**v, **mano})
    reg = {k: x for k, x in registro.items() if k != 'strutture'}
    reg['strutture'] = out
    with open(path, 'w', encoding='utf-8') as f:
        f.write('{\n')
        for k, x in reg.items():
            if k != 'strutture':
                f.write(f' {json.dumps(k, ensure_ascii=False)}: {json.dumps(x, ensure_ascii=False)},\n')
        f.write(' "strutture": [\n')
        f.write(',\n'.join('  ' + json.dumps(s, ensure_ascii=False) for s in out))
        f.write('\n ]\n}\n')
