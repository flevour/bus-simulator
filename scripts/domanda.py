#!/usr/bin/env python3
"""Domanda di traffico (#116): viaggi in auto con origine, destinazione e ora, per il gioco.

Dalla rete della mappa (src/data/padova-map.json, con gli edifici delle aree in public/mappa/aree/) e dai luoghi di OSM
(data/osm-luoghi.json) scrive src/data/padova-domanda.json, che il gioco legge (src/world/domanda.js):

  - zone: le celle di una griglia da CELLA metri con i loro pesi (abitanti dal volume degli edifici residenziali, lavoro
    dal volume degli altri e dei luoghi, scuole, negozi, sosta) e gli archi da cui un viaggio parte e dove finisce;
  - porte: le strade principali al bordo della mappa, da cui entra ed esce chi viene da fuori o la attraversa;
  - tempi: il tempo di viaggio a rete libera tra zone e porte, con lo stesso modello di costo del gioco;
  - od: per ogni scopo la probabilità della destinazione data l'origine (modello gravitazionale sui tempi);
  - curva: quanti viaggi partono in ogni ora di un giorno feriale e di uno festivo, per scopo.

Regole, fonti e numeri in docs/domanda.md. Solo libreria standard e solo operazioni che danno lo stesso risultato su
ogni macchina (somme, prodotti, divisioni, radici): niente seni, esponenziali o logaritmi, che vengono dalla libreria
matematica del sistema. Così il file è lo stesso sul Mac e in Docker.

  python3 scripts/domanda.py              # riscrive src/data/padova-domanda.json
  python3 scripts/domanda.py --controlla  # rifà il calcolo e dice se il file è quello che esce (anche da verifica_mappa.py)
  python3 scripts/domanda.py --conti      # numeri per docs/domanda.md
"""
import glob
import heapq
import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pendolari  # noqa: E402  (pendolari da fuori e porte, #147)

RADICE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MAPPA = os.path.join(RADICE, 'src', 'data', 'padova-map.json')
AREE = os.path.join(RADICE, 'public', 'mappa', 'aree')
LUOGHI = os.path.join(RADICE, 'data', 'osm-luoghi.json')
USCITA = os.path.join(RADICE, 'src', 'data', 'padova-domanda.json')

# proiezione del gioco (toXZ di src/data/padova.js): metri per grado di longitudine all'origine, scritto come numero
# perché il coseno della libreria del sistema può cambiare l'ultima cifra da una macchina all'altra
M_PER_LAT = 111130
M_PER_LON = 78153.30172146406

CELLA = 1000  # lato delle zone (m)

# ------------------------------------------------------------------
# Modello di costo: lo stesso di src/world/domanda.js (tempoArco, tempoSvolta)
# ------------------------------------------------------------------
# velocità libera delle auto del gioco (Traffic.spawn, segui): 14 m/s sulle strade principali fuori dal centro, 9 m/s
# altrove; il centro è zoneOf di src/world/city.js
CENTRO = (-150.0, 120.0)
V_PRINCIPALE, V_LOCALE = 14.0, 9.0
# attesa media a un semaforo (ciclo di 60 s, metà di verde: arrivi a caso aspettano in media 60 · 0,5² / 2 = 7,5 s, più
# la partenza) e svolte: a sinistra si dà la precedenza a chi viene incontro
ATTESA_SEMAFORO = 10.0
SVOLTA_SINISTRA, SVOLTA_DESTRA = 5.0, 2.0

AUTO = 1  # bit delle auto nei raccordi (docs/raccordi.md)

# capacità per l'assegnazione: auto l'ora per corsia per classe (trunk ... service; HCM, flussi di saturazione tipici
# delle strade urbane), parte di verde ai semafori, e la funzione dei tempi (BPR: t = t0 · (1 + 0,15 · (v / c)⁴))
SATURAZIONE = [1900, 1700, 1600, 1500, 1200, 1000, 600, 600, 0]
VERDE = 0.45
BPR_A = 0.15


def in_centro(x, z):
    """zoneOf(x, z) === 0 di src/world/city.js, senza la radice: d² < 950²"""
    dx, dz = x - CENTRO[0], (z - CENTRO[1]) * 1.15
    return dx * dx + dz * dz < 950.0 * 950.0


# ------------------------------------------------------------------
# Rete: stati (arco, verso) e movimenti delle auto dai raccordi della build
# ------------------------------------------------------------------
class Rete:
    """Uno stato è un arco percorso in un verso: 2·arco nel verso a -> b, 2·arco + 1 nel verso b -> a. I movimenti sono
    i raccordi della build con il bit delle auto: da uno stato che arriva a un nodo a uno che ne parte, scavalcando gli
    archi corti (via)."""

    def __init__(self, M):
        self.M = M
        N = M['nodes']
        self.nx = N[0::2]
        self.nz = N[1::2]
        E = M['edges']
        self.na = len(E) // 8
        self.a, self.b, self.cls, self.flags, self.larg, self.len = [], [], [], [], [], []
        for k in range(0, len(E), 8):
            a, b = E[k], E[k + 1]
            dx, dz = self.nx[b] - self.nx[a], self.nz[b] - self.nz[a]
            self.a.append(a)
            self.b.append(b)
            self.cls.append(E[k + 2])
            self.flags.append(E[k + 5])
            self.larg.append(E[k + 3])
            self.len.append(math.sqrt(dx * dx + dz * dz))
        self.nomi = M['names']
        self.nome = [E[k + 4] for k in range(0, len(E), 8)]
        semafori = set()
        for s in M.get('signals') or []:
            if not s[0]:
                semafori.update(s[1:])
        self.semafori = semafori
        self.t = [self.tempo_stato(s) for s in range(2 * self.na)]
        self.succ = defaultdict(list)  # stato -> [(stato dopo, costo del movimento senza lo stato dopo)]
        self.pred = defaultdict(list)
        F = M['raccordi']
        visti = set()
        for n, voce in zip(F['nodi'], F['voci']):
            i = 0
            while i < len(voce):
                da, a, c = voce[i], voce[i + 1], voce[i + 2]
                nv, nvia = ((c >> 9) & 1) + 1, c >> 10
                via = voce[i + 4 + 2 * nv:i + 4 + 2 * nv + nvia]
                i += 4 + 2 * nv + nvia
                if not (c >> 6) & AUTO:
                    continue
                s0 = 2 * da + (0 if self.b[da] == n else 1)
                m, extra = n, 0.0
                for k in via:
                    avanti = self.a[k] == m
                    extra += self.t[2 * k + (0 if avanti else 1)]
                    m = self.b[k] if avanti else self.a[k]
                s1 = 2 * a + (0 if self.a[a] == m else 1)
                if (s0, s1) in visti:
                    continue
                visti.add((s0, s1))
                costo = extra + self.svolta(s0, s1, n)
                self.succ[s0].append((s1, costo))
                self.pred[s1].append((s0, costo))
        # i raccordi non hanno inversioni sullo stesso arco, nemmeno in fondo alle strade chiuse: in una strada chiusa si
        # entra e non si esce. Un viaggio parte da uno stato da cui si torna nella componente principale (ritorno) e
        # finisce in uno che se ne raggiunge (arrivo)
        self.principale = self.componente()
        self.arrivo = self.chiusura(self.succ)
        self.ritorno = self.chiusura(self.pred)
        corsie = {}
        L = M.get('lanes') or []
        for i in range(0, len(L), 2):
            corsie[L[i]] = (L[i + 1] & 7, (L[i + 1] >> 3) & 7)
        self.cap = [self.capacita(s, corsie) for s in range(2 * self.na)]

    def capacita(self, s, corsie):
        """auto l'ora che lo stato porta: corsie nel verso (dai tag OSM, o dalla larghezza) per il flusso di saturazione
        della classe; dove finisce a un semaforo, la parte di verde (45%)"""
        e = s >> 1
        nf, nb = corsie.get(e, (0, 0))
        n = nf if s & 1 == 0 else nb
        if n == 0:
            ow = self.flags[e] & 3
            n = (2 if self.larg[e] >= 6.5 else 1) if ow else (2 if self.larg[e] >= 13 else 1)
        c = n * SATURAZIONE[self.cls[e]]
        return c * VERDE if self.fine(s) in self.semafori else c

    def fine(self, s):
        e = s >> 1
        return self.b[e] if s & 1 == 0 else self.a[e]

    def inizio(self, s):
        e = s >> 1
        return self.a[e] if s & 1 == 0 else self.b[e]

    def dir(self, s):
        e, L = s >> 1, self.len[s >> 1] or 1.0
        dx, dz = (self.nx[self.b[e]] - self.nx[self.a[e]]) / L, (self.nz[self.b[e]] - self.nz[self.a[e]]) / L
        return (dx, dz) if s & 1 == 0 else (-dx, -dz)

    def tempo_stato(self, s):
        e = s >> 1
        mx, mz = (self.nx[self.a[e]] + self.nx[self.b[e]]) / 2, (self.nz[self.a[e]] + self.nz[self.b[e]]) / 2
        v = V_PRINCIPALE if self.cls[e] <= 3 and not in_centro(mx, mz) else V_LOCALE
        return self.len[e] / v

    def svolta(self, s0, s1, n):
        """costo del movimento da s0 a s1 al nodo n: semaforo e svolta (oltre 45 gradi)"""
        c = ATTESA_SEMAFORO if n in self.semafori else 0.0
        (ax, az), (bx, bz) = self.dir(s0), self.dir(s1)
        if ax * bx + az * bz < 0.7071:
            # con z verso sud, a sinistra è il prodotto vettoriale negativo
            c += SVOLTA_SINISTRA if ax * bz - az * bx < 0 else SVOLTA_DESTRA
        return c

    def ammesso(self, s):
        e = s >> 1
        if self.cls[e] == 8 or self.flags[e] & 32:
            return False
        ow = 1 if self.flags[e] & 1 else -1 if self.flags[e] & 2 else 0
        return ow == 0 or (ow == 1) == (s & 1 == 0)

    def componente(self):
        """gli stati della componente fortemente connessa più grande del grafo dei movimenti (Kosaraju, senza ricorsione)"""
        stati = sorted(set(self.succ) | set(self.pred))
        ordine, visto = [], set()
        for s0 in stati:
            if s0 in visto:
                continue
            visto.add(s0)
            pila = [(s0, iter(self.succ.get(s0, ())))]
            while pila:
                s, it = pila[-1]
                for t, _ in it:
                    if t not in visto:
                        visto.add(t)
                        pila.append((t, iter(self.succ.get(t, ()))))
                        break
                else:
                    pila.pop()
                    ordine.append(s)
        comp, migliore = {}, set()
        for s0 in reversed(ordine):
            if s0 in comp:
                continue
            gruppo, pila = [s0], [s0]
            comp[s0] = s0
            while pila:
                s = pila.pop()
                for t, _ in self.pred.get(s, ()):
                    if t not in comp:
                        comp[t] = s0
                        gruppo.append(t)
                        pila.append(t)
            if len(gruppo) > len(migliore):
                migliore = set(gruppo)
        return migliore

    def chiusura(self, adiacenti):
        """gli stati raggiunti dalla componente principale lungo adiacenti (succ: dove si arriva; pred: da dove si torna)"""
        visto = set(self.principale)
        pila = sorted(self.principale)
        while pila:
            s = pila.pop()
            for t, _ in adiacenti.get(s, ()):
                if t not in visto:
                    visto.add(t)
                    pila.append(t)
        return visto

    def avanti(self, sorgenti):
        """tempi dall'inizio degli stati sorgente alla fine di ogni stato raggiunto (Dijkstra)"""
        dist = {}
        coda = [(self.t[s], s) for s in sorgenti]
        heapq.heapify(coda)
        while coda:
            d, s = heapq.heappop(coda)
            if s in dist:
                continue
            dist[s] = d
            for t, c in self.succ.get(s, ()):
                if t not in dist:
                    heapq.heappush(coda, (d + c + self.t[t], t))
        return dist


# ------------------------------------------------------------------
# Edifici, luoghi e sosta per zona
# ------------------------------------------------------------------
def xz(lat, lon):
    return (lon - 11.8775) * M_PER_LON, -(lat - 45.4075) * M_PER_LAT


def cella(x, z):
    return (math.floor(x / CELLA), math.floor(z / CELLA))


def area_poligono(f):
    a = 0.0
    n = len(f) // 2
    for i in range(n):
        j = (i + 1) % n
        a += f[2 * i] * f[2 * j + 1] - f[2 * j] * f[2 * i + 1]
    return abs(a) / 2


def dentro(px, pz, P):
    """punto nel poligono (P: [(x, z)], pari e dispari)"""
    c = False
    j = len(P) - 1
    for i in range(len(P)):
        (xi, zi), (xj, zj) = P[i], P[j]
        if (zi > pz) != (zj > pz) and px < (xj - xi) * (pz - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


class Suolo:
    """aree di uso del suolo di OSM, con una griglia per cercarle"""
    PASSO = 250

    def __init__(self, suolo, tipi):
        self.poli = []
        self.griglia = defaultdict(list)
        for s in suolo:
            t = s['t'].get('landuse')
            if t not in tipi or 'p' not in s:
                continue
            p = s['p']
            P = [xz(p[i], p[i + 1]) for i in range(0, len(p), 2)]
            k = len(self.poli)
            self.poli.append((tipi[t], P))
            xs, zs = [q[0] for q in P], [q[1] for q in P]
            for gx in range(math.floor(min(xs) / self.PASSO), math.floor(max(xs) / self.PASSO) + 1):
                for gz in range(math.floor(min(zs) / self.PASSO), math.floor(max(zs) / self.PASSO) + 1):
                    self.griglia[(gx, gz)].append(k)

    def tipo(self, x, z):
        for k in self.griglia.get((math.floor(x / self.PASSO), math.floor(z / self.PASSO)), ()):
            t, P = self.poli[k]
            if dentro(x, z, P):
                return t
        return None


# uso del suolo che conta: residenziale o lavoro (industriale, commerciale, negozi, istruzione, militare)
SUOLO = {'residential': 'casa', 'industrial': 'lavoro', 'commercial': 'lavoro', 'retail': 'lavoro', 'education': 'lavoro',
         'military': 'lavoro', 'railway': 'lavoro'}
# tipo di edificio di OSM che dice già cosa c'è dentro
EDIFICIO = {'apartments': 'casa', 'house': 'casa', 'industrial': 'lavoro', 'warehouse': 'lavoro', 'commercial': 'lavoro',
            'retail': 'lavoro', 'hospital': 'lavoro', 'university': 'lavoro', 'school': 'lavoro', 'train_station': 'lavoro',
            'church': None, 'garage': None, 'garages': None, 'roof': None}
# metri cubi di edificio residenziale per abitante. Lo standard urbanistico è 100 m³ (DM 1444/1968, art. 3), ma il
# volume degli edifici della mappa conta muri, scale, sottotetti e garage, e gli edifici di tipo non detto fuori dalle
# aree di uso del suolo finiscono tra le case: con 250 m³ la mappa ha circa 335.000 abitanti, i 207.000 del comune di
# Padova (ISTAT, 2024) più la prima cintura che sta nella mappa (Albignasego, Selvazzano, Rubano, Cadoneghe, Vigonza,
# Noventa, Ponte San Nicolò, per buona parte)
M3_ABITANTE = 250.0
# metri cubi per addetto negli edifici non residenziali (uffici e capannoni insieme)
M3_ADDETTO = 250.0
# nei quartieri residenziali una parte del volume sono negozi, uffici e studi
LAVORO_IN_CASA = 0.12


def pesi_zone(R, luoghi):
    """per cella: abitanti, addetti, scuole, negozi, sosta (stalli e posti dei parcheggi) e il baricentro degli edifici"""
    suolo = Suolo(luoghi['suolo'], SUOLO)
    Z = defaultdict(lambda: {'abitanti': 0.0, 'addetti': 0.0, 'scuole': 0.0, 'negozi': 0.0, 'sosta': 0.0, 'vx': 0.0, 'vz': 0.0, 'v': 0.0})
    for f in sorted(glob.glob(os.path.join(AREE, '*.json'))):
        for h, kind, _nome, pts, _buchi, *_ in json.load(open(f, encoding='utf-8'))['edifici']:
            if not h or len(pts) < 6:
                continue
            n = len(pts) // 2
            cx, cz = sum(pts[0::2]) / n, sum(pts[1::2]) / n
            vol = area_poligono(pts) * h
            uso = EDIFICIO.get(kind, 'ignoto') if kind else 'ignoto'
            if uso == 'ignoto':
                uso = suolo.tipo(cx, cz) or 'casa'
            if uso is None:
                continue
            z = Z[cella(cx, cz)]
            if uso == 'casa':
                z['abitanti'] += vol / M3_ABITANTE
                z['addetti'] += vol * LAVORO_IN_CASA / M3_ADDETTO
            else:
                z['addetti'] += vol / M3_ADDETTO
            z['vx'] += cx * vol
            z['vz'] += cz * vol
            z['v'] += vol
    # scuole e negozi (punti o baricentri di OSM)
    for L in luoghi['luoghi']:
        t = L['t']
        x, z = xz(*L['c'])
        a = t.get('amenity')
        if a in ('school', 'college'):
            Z[cella(x, z)]['scuole'] += 1.0
        elif a == 'kindergarten':
            Z[cella(x, z)]['scuole'] += 0.5
        elif a == 'university':
            Z[cella(x, z)]['scuole'] += 2.0
        elif a == 'hospital':
            Z[cella(x, z)]['negozi'] += 10.0
        elif 'shop' in t:
            Z[cella(x, z)]['negozi'] += 5.0 if t['shop'] in ('supermarket', 'mall', 'department_store') else 1.0
    # sosta: parcheggi pubblici (posti dichiarati, o uno ogni 25 m²) e stalli lungo le strade della mappa
    for P in luoghi['parcheggi']:
        t = P['t']
        if t.get('amenity') != 'parking' or t.get('access') in ('private', 'no') or t.get('parking') == 'street_side':
            continue
        x, z = xz(*P['c'])
        try:
            posti = float(t['capacity'])
        except (KeyError, ValueError):
            posti = P.get('m2', 0) / 25.0
        Z[cella(x, z)]['sosta'] += min(posti, 2000.0)
    for e, _lato, _tipo, _fonte, _d0, _d1, _s0, n in R.M.get('stalli') or []:
        mx, mz = (R.nx[R.a[e]] + R.nx[R.b[e]]) / 2, (R.nz[R.a[e]] + R.nz[R.b[e]]) / 2
        Z[cella(mx, mz)]['sosta'] += n
    return Z


# ------------------------------------------------------------------
# Zone, accessi e porte
# ------------------------------------------------------------------
ACCESSI = 16  # archi per zona da cui si parte e dove si arriva
# classi delle vie da cui si parte e dove si arriva: da secondary a living_street (le strade principali no, le strade
# di servizio no: lì il gioco non fa nascere le auto)
CLASSI_ACCESSO = (2, 3, 4, 5, 6)


def stalli_per_arco(R):
    out = defaultdict(int)
    for e, _lato, _tipo, _fonte, _d0, _d1, _s0, n in R.M.get('stalli') or []:
        out[e] += n
    return out


def zone_e_accessi(R, Z):
    """zone con almeno una partenza e un arrivo: [(cella, pesi, accessi [(stato, peso, tipo)], centro, cx, cz)]. Tipo:
    1 si parte (da lì si torna nella rete), 2 si arriva, 3 tutti e due. Il centro è uno stato della componente
    principale, il più vicino al baricentro degli edifici: da lì si misurano i tempi tra zone"""
    stalli = stalli_per_arco(R)
    per = defaultdict(list)
    for s in sorted(R.arrivo | R.ritorno):
        e = s >> 1
        if R.cls[e] not in CLASSI_ACCESSO or not R.ammesso(s) or R.len[e] < 15:
            continue
        mx, mz = (R.nx[R.a[e]] + R.nx[R.b[e]]) / 2, (R.nz[R.a[e]] + R.nz[R.b[e]]) / 2
        tipo = (1 if s in R.ritorno else 0) | (2 if s in R.arrivo else 0)
        per[cella(mx, mz)].append((R.len[e] + 6.0 * stalli[e], s, mx, mz, tipo))
    out = []
    for k in sorted(Z):
        p = Z[k]
        cand = per[k]
        if p['abitanti'] + p['addetti'] + p['scuole'] + p['negozi'] < 20:
            continue
        principali = [a for a in cand if a[1] in R.principale]
        if not principali or not any(a[4] & 1 for a in cand) or not any(a[4] & 2 for a in cand):
            continue
        cx, cz = (p['vx'] / p['v'], p['vz'] / p['v']) if p['v'] else ((k[0] + 0.5) * CELLA, (k[1] + 0.5) * CELLA)
        ordine = sorted(cand, key=lambda a: (-a[0], a[1]))
        acc = [a for a in ordine if a[4] & 1][:ACCESSI // 2] + [a for a in ordine if a[4] == 2][:ACCESSI // 2]
        acc = sorted(set(acc), key=lambda a: a[1])
        centro = min(principali, key=lambda a: ((a[2] - cx) * (a[2] - cx) + (a[3] - cz) * (a[3] - cz), a[1]))[1]
        out.append((k, p, [(a[1], a[0], a[4]) for a in acc], centro, cx, cz))
    return out


def porte(R):
    """le porte della mappa: nodi con un arco solo (senza le vie pedonali), su strade da tertiary in su, raggruppati per
    nome entro 150 m (le due carreggiate). Stati d'ingresso (dal nodo verso la mappa) e d'uscita (verso il nodo), e i
    nodi. Il peso (i pendolari che ci passano) lo mette scripts/pendolari.py"""
    grado = defaultdict(list)
    for e in range(R.na):
        if R.cls[e] == 8:
            continue
        grado[R.a[e]].append(e)
        grado[R.b[e]].append(e)
    cand = []
    for n in sorted(grado):
        es = grado[n]
        if len(es) != 1 or R.cls[es[0]] > 3:
            continue
        e = es[0]
        dentro_mappa = 2 * e + (0 if R.a[e] == n else 1)  # dal nodo verso la mappa
        fuori = dentro_mappa ^ 1
        ing = [dentro_mappa] if R.ammesso(dentro_mappa) and dentro_mappa in R.ritorno else []
        usc = [fuori] if R.ammesso(fuori) and fuori in R.arrivo else []
        if ing or usc:
            cand.append((n, e, ing, usc))
    gruppi = []
    for n, e, ing, usc in cand:
        nome = R.nomi[R.nome[e]] if R.nome[e] >= 0 else ''
        x, z = R.nx[n], R.nz[n]
        for g in gruppi:
            if g['nome'] == nome and (g['x'] - x) * (g['x'] - x) + (g['z'] - z) * (g['z'] - z) < 150.0 * 150.0:
                g['in'] += ing
                g['out'] += usc
                g['nodi'].append(n)
                break
        else:
            gruppi.append({'nome': nome, 'x': x, 'z': z, 'in': ing, 'out': usc, 'nodi': [n], 'peso': 0})
    return gruppi


# ------------------------------------------------------------------
# Assegnazione con la capacità delle strade (metodo delle medie successive)
# ------------------------------------------------------------------
def tutto_o_niente(R, t, partenze, arrivi, domanda):
    """flussi sugli stati con i tempi t: ogni viaggio sul percorso più veloce. partenze e arrivi: per luogo,
    [(stato, peso)]; domanda: origine -> [(destinazione, auto l'ora)]. Da ogni origine un albero (Dijkstra da tutte le
    sue partenze); la domanda di ogni arrivo risale l'albero"""
    y = defaultdict(float)
    for o in sorted(domanda):
        dist, pred, ordine = {}, {}, []
        coda = [(t[s], s, -1) for s, _ in partenze[o]]
        heapq.heapify(coda)
        while coda:
            d, s, p = heapq.heappop(coda)
            if s in dist:
                continue
            dist[s] = d
            pred[s] = p
            ordine.append(s)
            for u, c in R.succ.get(s, ()):
                if u not in dist:
                    heapq.heappush(coda, (d + c + t[u], u, s))
        acc = defaultdict(float)
        for d, r in domanda[o]:
            arr = [(s, w) for s, w in arrivi[d] if s in dist]
            tot = sum(w for _, w in arr)
            for s, w in arr:
                acc[s] += r * w / tot
        for s in reversed(ordine):
            a = acc.get(s)
            if not a:
                continue
            y[s] += a
            p = pred[s]
            if p >= 0:
                acc[p] += a
    return y


def assegna(R, partenze, arrivi, domanda, giri=4):
    """flussi (auto l'ora) e tempi degli stati con la congestione: medie successive di assegnazioni tutto o niente, con i
    tempi della funzione BPR sui flussi del giro prima"""
    t0 = R.t
    t = list(t0)
    x = defaultdict(float)
    for k in range(1, giri + 1):
        y = tutto_o_niente(R, t, partenze, arrivi, domanda)
        for s in set(x) | set(y):
            x[s] += (y.get(s, 0.0) - x[s]) / k
        t = list(t0)
        for s, v in x.items():
            c = R.cap[s]
            if c > 0:
                q = v / c
                q2 = q * q
                t[s] = t0[s] * (1.0 + BPR_A * q2 * q2)
    return x, t


# ------------------------------------------------------------------
# Scopi, curva oraria e matrice origine-destinazione
# ------------------------------------------------------------------
# Viaggi in auto al giorno nell'area della mappa, per scopo (docs/domanda.md, sezione 4). Abitanti e addetti vengono
# dagli edifici; i tassi sono quelli di un capoluogo del nord: 2,3 spostamenti per abitante al giorno, il 60% in auto,
# 1,25 persone per auto (ISFORT, Audimob), cioè 1,1 viaggi in auto per abitante. I pendolari da fuori sono quelli della
# matrice ISTAT 2011 che vanno in auto, come conducenti, dai comuni di fuori a quelli dentro la mappa
# (scripts/pendolari.py, #147); chi attraversa la città è una stima (25.000)
SCOPI = ['casa_lavoro', 'lavoro_casa', 'casa_scuola', 'scuola_casa', 'altro', 'pendolari_in', 'pendolari_out', 'attraverso']
VIAGGI_ABITANTE = 1.1
QUOTA = {'casa_lavoro': 0.17, 'lavoro_casa': 0.17, 'casa_scuola': 0.06, 'scuola_casa': 0.06, 'altro': 0.54}
ATTRAVERSO = 25000
# festivo: niente scuola, un quinto del lavoro, un terzo in più degli altri viaggi; meno pendolari e passaggi
FESTIVO = {'casa_lavoro': 0.2, 'lavoro_casa': 0.2, 'casa_scuola': 0.0, 'scuola_casa': 0.0, 'altro': 1.3,
           'pendolari_in': 0.15, 'pendolari_out': 0.15, 'attraverso': 0.6}

# Partenze per ora, in percentuale dei viaggi del giorno di quello scopo (ore 0-23). Profili tipici delle città italiane
# (ISFORT, Audimob: fasce orarie degli spostamenti per motivo), con le punte che il GTFS di Busitalia conferma: le corse
# hanno tempi più lunghi tra le 7 e le 9 e tra le 17 e le 19 (docs/domanda.md, sezione 5)
ORE = {
    'casa_lavoro': [0.1, 0.1, 0.1, 0.2, 0.5, 2, 7, 24, 26, 12, 4, 3, 2, 5, 5, 3, 2, 1, 0.5, 0.5, 0.5, 0.5, 0.3, 0.2],
    'lavoro_casa': [0.3, 0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.5, 0.5, 0.5, 1, 2, 7, 6, 2.5, 3, 8, 22, 24, 12, 4, 2, 1.5, 1],
    'casa_scuola': [0, 0, 0, 0, 0, 0, 1, 38, 44, 4, 2, 1, 1, 2, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0],
    'scuola_casa': [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 4, 22, 30, 8, 6, 12, 10, 3, 1, 0, 0, 0, 0],
    'altro': [0.6, 0.3, 0.2, 0.2, 0.3, 0.6, 2, 4, 5, 7, 8, 8.5, 7.5, 5.5, 5.5, 6.5, 7.5, 8.5, 8.5, 6, 3.5, 2.5, 1.8, 1],
    'pendolari_in': [0.2, 0.1, 0.1, 0.2, 1, 4, 14, 30, 22, 9, 4, 3, 2, 3, 3, 2, 1, 0.5, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1],
    'pendolari_out': [0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 0.5, 0.5, 0.5, 1, 2, 5, 5, 3, 4, 10, 25, 24, 11, 5, 2, 1, 0.5],
    'attraverso': [1, 0.5, 0.4, 0.4, 0.8, 2, 5, 8, 8, 6, 5.5, 5.5, 5.5, 5, 5, 5.5, 6.5, 7.5, 7.5, 5, 3, 2, 1.5, 1],
}
ORE_FESTIVO = {
    'altro': [1, 0.6, 0.4, 0.3, 0.3, 0.4, 0.8, 2, 4, 7, 9, 9.5, 8, 5.5, 5, 6, 7.5, 8.5, 8.5, 6.5, 4, 2.5, 1.8, 1.4],
    'attraverso': [1.5, 0.8, 0.5, 0.4, 0.4, 0.8, 1.5, 3, 5, 7, 8, 8, 7, 6, 6, 7, 8, 8.5, 8, 6, 4, 3, 2.5, 2],
}

# deterrenza del tempo di viaggio: 1 / (1 + t / T0)^3, con T0 per scopo (s). Con 600 s la metà dei viaggi casa-lavoro
# sta sotto i 12 minuti di rete libera; la scuola è più vicina, gli altri viaggi di più
T0 = {'lavoro': 600.0, 'scuola': 300.0, 'altro': 420.0, 'pendolari': 900.0, 'attraverso': 1200.0}


# orari di uscita da casa dei pendolari nella matrice ISTAT 2011 (data/istat-pendolari.json): prima delle 7:15, dalle
# 7:15 alle 8:14, dalle 8:15 alle 9:14, dopo (ore). Il viaggio comincia alla porta, il tempo medio fuori dalla mappa dopo
FASCE_ISTAT = [7.25, 8.25, 9.25]


def ore_istat(prof, fasce, ritardo):
    """il profilo orario prof (24 ore, uniforme dentro ogni ora) con il peso di ogni fascia di uscita della matrice ISTAT
    (fasce: pendolari per fascia), spostate di ritardo ore: la forma dentro una fascia resta quella di prof"""
    bordi = [0.0] + [b + ritardo for b in FASCE_ISTAT] + [24.0]
    dentro = lambda h, k: max(0.0, min(h + 1.0, bordi[k + 1]) - max(float(h), bordi[k]))
    massa = [sum(prof[h] * dentro(h, k) for h in range(24)) for k in range(4)]
    tot = sum(fasce)
    return [sum(prof[h] * dentro(h, k) * fasce[k] / tot / massa[k] for k in range(4) if massa[k] > 0) * 100.0 for h in range(24)]


def deterrenza(t, t0):
    u = 1.0 + t / t0
    return 1.0 / (u * u * u)


def per_mille(pesi):
    """probabilità in millesimi, che sommano a 1000: si tengono le destinazioni dalla più probabile finché fanno il
    98%, poi si arrotonda col metodo dei resti"""
    tot = sum(w for _, w in pesi)
    if tot <= 0:
        return []
    ordine = sorted(pesi, key=lambda a: (-a[1], a[0]))
    tenuti, cum = [], 0.0
    for d, w in ordine:
        tenuti.append((d, w))
        cum += w
        if cum >= 0.98 * tot:
            break
    t2 = sum(w for _, w in tenuti)
    quote = [(d, w * 1000.0 / t2) for d, w in tenuti]
    base = [(d, int(q)) for d, q in quote]
    resto = 1000 - sum(b for _, b in base)
    ordine_resti = sorted(range(len(quote)), key=lambda i: (-(quote[i][1] - base[i][1]), quote[i][0]))
    out = dict(base)
    for i in ordine_resti[:resto]:
        out[quote[i][0]] += 1
    return sorted([(d, q) for d, q in out.items() if q > 0])


def calcola(conti=False):
    M = json.load(open(MAPPA, encoding='utf-8'))
    luoghi = json.load(open(LUOGHI, encoding='utf-8'))
    R = Rete(M)
    Z = pesi_zone(R, luoghi)
    zone = zone_e_accessi(R, Z)
    P = porte(R)
    nz = len(zone)
    # luoghi della matrice: le zone, poi le porte
    centri_da = [[z[3]] for z in zone] + [g['in'] for g in P]
    centri_a = [z[3] for z in zone]
    tempi = []
    for k, sorg in enumerate(centri_da):
        if not sorg:
            tempi.append(None)
            continue
        dist = R.avanti(sorg)
        riga = [dist.get(c) for c in centri_a]
        for g in P:
            ts = [dist[s] for s in g['out'] if s in dist]
            riga.append(min(ts) if ts else None)
        tempi.append(riga)
    nl = nz + len(P)
    INF = 65535

    def tempo(o, d):
        r = tempi[o]
        v = r[d] if r else None
        return INF if v is None else min(INF, int(round(v)))
    T = [[tempo(o, d) for d in range(nl)] for o in range(nl)]

    # generazione e attrazione per scopo
    ab = [z[1]['abitanti'] for z in zone]
    ad = [z[1]['addetti'] for z in zone]
    sc = [z[1]['scuole'] for z in zone]
    ne = [z[1]['negozi'] for z in zone]
    so = [z[1]['sosta'] for z in zone]
    tot_ab = sum(ab)
    # pendolari da fuori (#147): da quale porta entra ed esce chi viene da ogni comune di fuori, verso quale zona
    pend = pendolari.pendolari(R, zone, P, T, (M['aree']['lato'], set(M['aree']['chiavi'])), xz, deterrenza,
                               T0['pendolari'], INF)
    for k, g in enumerate(P):
        g['peso'] = round(pend['entrano'].get(k, 0.0) + pend['escono'].get(k, 0.0))
    porta_in = [nz + i for i, g in enumerate(P) if g['in']]
    porta_out = [nz + i for i, g in enumerate(P) if g['out']]
    # attrattività per gli altri viaggi: negozi, addetti e sosta (dove si può lasciare l'auto)
    alt = [ne[i] * 20.0 + ad[i] * 0.3 + so[i] * 0.5 for i in range(nz)]
    scopi = {}

    def gravita(origini, destinazioni, gen, att, t0, scopo):
        righe = []
        for o in origini:
            pesi = [(d, att[d] * deterrenza(T[o][d], t0)) for d in destinazioni if d != o and T[o][d] < INF and att[d] > 0]
            pm = per_mille(pesi)
            if pm and gen[o] > 0:
                righe.append([o, round(gen[o], 1), [x for dq in pm for x in dq]])
        tot = sum(r[1] for r in righe)
        return {'righe': righe, 'totale': tot}

    zi = list(range(nz))
    genZ = lambda v: {i: v[i] for i in zi}
    attZ = lambda v: {i: v[i] for i in zi}
    # casa -> lavoro e ritorno; la scuola; gli altri viaggi tra zone (anche da e verso le porte, poco)
    scopi['casa_lavoro'] = gravita(zi, zi, genZ(ab), attZ(ad), T0['lavoro'], 'casa_lavoro')
    scopi['lavoro_casa'] = gravita(zi, zi, genZ(ad), attZ(ab), T0['lavoro'], 'lavoro_casa')
    scopi['casa_scuola'] = gravita(zi, zi, genZ(ab), attZ(sc), T0['scuola'], 'casa_scuola')
    scopi['scuola_casa'] = gravita(zi, zi, genZ(sc), attZ(ab), T0['scuola'], 'scuola_casa')
    gen_alt = {i: ab[i] + alt[i] * 0.5 for i in zi}
    scopi['altro'] = gravita(zi, zi, gen_alt, attZ(alt), T0['altro'], 'altro')
    # pendolari: dalle porte ai posti di lavoro la mattina, ritorno la sera (scripts/pendolari.py): per porta le zone, e
    # per zona le porte, con i pendolari al giorno
    def righe_di(flussi):
        righe = []
        for o in sorted(flussi):
            pm = per_mille(sorted((d, f) for d, f in flussi[o].items() if f > 0))
            if pm:
                righe.append([o, round(sum(flussi[o].values()), 1), [x for dq in pm for x in dq]])
        return {'righe': righe, 'totale': sum(r[1] for r in righe)}
    scopi['pendolari_in'] = righe_di({nz + k: v for k, v in pend['pin'].items()})
    scopi['pendolari_out'] = righe_di({d: {nz + k: f for k, f in v.items()} for d, v in pend['pout'].items()})
    # attraversamenti: da porta a porta, tra porte ad almeno 3 km in linea d'aria (chi entra ed esce dalla stessa
    # parte non attraversa la città: ci passa accanto, fuori dalla mappa). Chi entra ed esce da una porta è in proporzione
    # ai pendolari che ci passano: la fonte dice quanto è usata ogni porta, non da dove a dove va chi attraversa
    gp = {d: pend['entrano'].get(d - nz, 0.0) for d in porta_in}
    ap = {d: pend['escono'].get(d - nz, 0.0) for d in porta_out}
    lontane = {}
    for o in porta_in:
        go = P[o - nz]
        lontane[o] = [d for d in porta_out if (P[d - nz]['x'] - go['x']) ** 2 + (P[d - nz]['z'] - go['z']) ** 2 > 3000.0 ** 2]
    righe = []
    for o in porta_in:
        pesi = [(d, ap[d] * deterrenza(T[o][d], T0['attraverso'])) for d in lontane[o] if T[o][d] < INF and ap[d] > 0]
        pm = per_mille(pesi)
        if pm and gp[o] > 0:
            righe.append([o, round(gp[o], 1), [x for dq in pm for x in dq]])
    scopi['attraverso'] = {'righe': righe, 'totale': sum(r[1] for r in righe)}

    # viaggi al giorno per scopo
    giorno = {s: VIAGGI_ABITANTE * QUOTA[s] * tot_ab for s in QUOTA}
    giorno['pendolari_in'] = pend['assegnati']
    giorno['pendolari_out'] = pend['assegnati']
    giorno['attraverso'] = ATTRAVERSO

    # chi entra dalle porte la mattina esce di casa quando dice la matrice ISTAT, e arriva alla porta dopo il tempo medio
    # fuori dalla mappa (scripts/pendolari.py)
    ore_pendolari = ore_istat(ORE['pendolari_in'], pend['fasce'], pend['fuori_medio'] / 3600.0)

    def curva(ore, fattori):
        out = {}
        for s in SCOPI:
            prof = ore.get(s, ore_pendolari if s == 'pendolari_in' else ORE[s])
            tot = sum(prof)
            out[s] = [round(giorno[s] * fattori.get(s, 1.0) * p / tot) for p in prof]
        return out

    curve = {'feriale': curva({}, {}), 'festivo': curva(ORE_FESTIVO, FESTIVO)}
    od = {s: scopi[s]['righe'] for s in SCOPI}
    fasce = carico(R, zone, P, od, curve['feriale'])

    dati = {
        'fonte': 'scripts/domanda.py (#116): edifici della mappa, OSM (uso del suolo, luoghi, parcheggi, comuni e strade fuori dalla mappa), sosta di #111; pendolari da ISTAT, matrice del pendolarismo 2011 (CC BY 4.0, #147); docs/domanda.md',
        'cella': CELLA,
        'costo': {'vPrincipale': V_PRINCIPALE, 'vLocale': V_LOCALE, 'semaforo': ATTESA_SEMAFORO, 'sinistra': SVOLTA_SINISTRA, 'destra': SVOLTA_DESTRA},
        'zone': [[round(cx), round(cz), round(p['abitanti']), round(p['addetti']), round(p['scuole'], 1), round(p['negozi']), round(p['sosta']), centro,
                  [x for a in acc for x in (a[0], round(a[1]), a[2])]] for (k, p, acc, centro, cx, cz) in zone],
        'porte': [[g['nome'], round(g['x']), round(g['z']), g['peso'], g['in'], g['out']] for g in P],
        'tempi': [x for riga in T for x in riga],
        'scopi': SCOPI,
        'od': od,
        'curva': curve,
        'fasce': fasce,
    }
    if conti:
        stampa_conti(dati, R, zone, P, giorno, pend)
    return dati


# ore che rappresentano le fasce del giorno nell'assegnazione: punta del mattino (8-9), morbida (11-12), punta della
# sera (17-18). Il gioco usa la fascia del mattino dalle 5 alle 10, la sera dalle 16 alle 20, la morbida nel resto
# (src/world/domanda.js, fascia), scalata con i viaggi dell'ora
ORE_FASCE = [8, 11, 17]
GRIGLIA = 100  # lato delle celle delle auto presenti (m)


def carico(R, zone, P, od, curva):
    """per ogni fascia: tempi con la congestione (fattore sul tempo a rete libera, solo dove supera 1,1) e auto presenti
    per cella da GRIGLIA metri (flusso per tempo), dall'assegnazione dei viaggi di quell'ora"""
    nz = len(zone)
    partenze = [[(a[0], round(a[1])) for a in z[2] if a[2] & 1] for z in zone] + [[(s, 1) for s in g['in']] for g in P]
    arrivi = [[(a[0], round(a[1])) for a in z[2] if a[2] & 2] for z in zone] + [[(s, 1) for s in g['out']] for g in P]
    fattori, presenze = {}, defaultdict(lambda: [0.0] * len(ORE_FASCE))
    for k, h in enumerate(ORE_FASCE):
        domanda = defaultdict(lambda: defaultdict(float))
        for scopo, righe in od.items():
            n = curva[scopo][h]
            tot = sum(r[1] for r in righe)
            for o, g, ds in righe:
                for j in range(0, len(ds), 2):
                    domanda[o][ds[j]] += n * g / tot * ds[j + 1] / 1000.0
        dom = {o: sorted((d, r) for d, r in v.items() if r > 0 and partenze[o] and arrivi[d]) for o, v in domanda.items() if partenze[o]}
        x, t = assegna(R, partenze, arrivi, dom)
        for s, v in x.items():
            f = t[s] / R.t[s] if R.t[s] > 0 else 1.0
            if f >= 1.1:
                fattori.setdefault(s, [100] * len(ORE_FASCE))[k] = min(5000, int(round(f * 100)))
            e = s >> 1
            mx, mz = (R.nx[R.a[e]] + R.nx[R.b[e]]) / 2, (R.nz[R.a[e]] + R.nz[R.b[e]]) / 2
            presenze[(math.floor(mx / GRIGLIA), math.floor(mz / GRIGLIA))][k] += v * t[s] / 3600.0
    del nz
    return {
        'ore': ORE_FASCE,
        'fattori': [[s] + fattori[s] for s in sorted(fattori)],
        'griglia': GRIGLIA,
        'presenze': [[i, j] + [round(v * 100) for v in presenze[(i, j)]] for (i, j) in sorted(presenze) if any(round(v * 100) for v in presenze[(i, j)])],
    }


def stampa_conti(dati, R, zone, P, giorno, pend):
    print(f"stati nella componente principale: {len(R.principale)} su {2 * R.na}")
    print(f"zone: {len(zone)}; porte: {len(P)} ({sum(1 for g in P if g['in'])} d'ingresso, {sum(1 for g in P if g['out'])} d'uscita)")
    tot = lambda k: sum(z[1][k] for z in zone)
    print(f"abitanti {tot('abitanti'):.0f}, addetti {tot('addetti'):.0f}, scuole {tot('scuole'):.0f}, negozi {tot('negozi'):.0f}, sosta {tot('sosta'):.0f}")
    for s in SCOPI:
        print(f"  {s:14} feriale {sum(dati['curva']['feriale'][s]):7d}  festivo {sum(dati['curva']['festivo'][s]):7d}")
    for g in ('feriale', 'festivo'):
        ore = [sum(dati['curva'][g][s][h] for s in SCOPI) for h in range(24)]
        print(g, 'per ora:', ore, 'totale', sum(ore))
    print(f"pendolari in auto (ISTAT 2011) verso i comuni dentro la mappa ({', '.join(pend['dentro'])}): "
          f"{pend['totale']:.0f} dai comuni di fuori, {pend['assegnati']:.0f} con una porta; {pend['fra_dentro']:.0f} tra "
          f"comuni dentro (sono nelle zone). Per orario di uscita: "
          + ', '.join(f'{v:.0f}' for v in pend['fasce']) + ' (prima delle 7:15, 7:15-8:14, 8:15-9:14, dopo); '
          f"tempo medio da casa alla porta {pend['fuori_medio'] / 60:.1f} minuti")
    print('pendolari_in per ora (feriale): ' + ', '.join(f'{h}: {v}' for h, v in enumerate(dati['curva']['feriale']['pendolari_in']) if v))
    print(f"porte senza una via di fuori: {', '.join(n or '(senza nome)' for n in pend['senza_rete']) or 'nessuna'}")
    for o, (nome, f, porte_c) in sorted(pend['per_comune'].items(), key=lambda kv: -kv[1][1]):
        if f >= 300:
            print(f'  {nome}: {f:.0f}, ' + ', '.join(f"{P[k]['nome'] or '(senza nome)'} {v / f * 100:.0f}%" for k, v in porte_c[:4]))
    for k, g in enumerate(P):
        print('  porta', g['nome'] or '(senza nome)', round(g['x']), round(g['z']), g['peso'], len(g['in']), len(g['out']),
              f"entrano {pend['entrano'].get(k, 0):.0f}, escono {pend['escono'].get(k, 0):.0f}")


def scrivi(dati, path=USCITA):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(dati, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')


def controlla():
    """[] se src/data/padova-domanda.json è quello che esce dalla mappa e dai dati di oggi, altrimenti l'errore (anche
    per scripts/verifica_mappa.py)"""
    testo = json.dumps(calcola(), ensure_ascii=False, separators=(',', ':')) + '\n'
    attuale = open(USCITA, encoding='utf-8').read() if os.path.exists(USCITA) else ''
    if testo != attuale:
        return ['src/data/padova-domanda.json non è quello che esce dalla mappa e dai dati di oggi: python3 scripts/domanda.py, nello stesso commit']
    return []


def main():
    args = sys.argv[1:]
    if '--controlla' in args:
        errori = controlla()
        print('\n'.join(errori) if errori else 'domanda: il file è quello che esce dalla mappa')
        sys.exit(1 if errori else 0)
    dati = calcola(conti='--conti' in args)
    if '--conti' not in args:
        scrivi(dati)
        print(f"scritto {os.path.relpath(USCITA)}: {len(dati['zone'])} zone, {len(dati['porte'])} porte")


if __name__ == '__main__':
    main()
