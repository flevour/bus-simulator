"""Regola per la stesura dei binari del tram (docs/binari-tram.md) e controllo di quanto una rete se ne allontana.

Misura una rete di binari (polilinee in metri, x verso est e z verso sud come nel gioco) contro i numeri della regola,
per linea (SIR1, SIR2, SIR3) e per deposito (Guizza, Voltabarozzo):
  * spigoli: punti dove la direzione cambia di colpo, invece di girare lungo una curva;
  * raggi sotto il minimo: curve più strette del minimo del Translohr (in linea, agli scambi, in deposito);
  * interassi fuori misura: i due binari di una linea affiancati più vicini del minimo, o con l'interasse che va e
    viene invece di restare costante; i binari paralleli del deposito più vicini del minimo;
  * scarti da OSM: binario oltre la tolleranza dal binario OSM più vicino e parallelo;
  * pendenze oltre il massimo (solo nel gioco, l'unico che ha le quote dei binari).

Le reti sono due:
  * i dati che scrivono gli script (il SIR1 in src/data/padova-map.json, SIR2 e SIR3 in data/tram-linee-nuove.json, le
    comunicazioni e i depositi da OSM): li misura scripts/verifica_mappa.py con rete_dati();
  * i binari come li disegna il gioco, dopo raccordi e medie di src/data/padova.js e src/tram/tram.js (TramTrack, scambi
    dei capolinea, TramYard): tests/binari-tram.spec.js li scrive in un file e chiama questo script con --gioco.

Ogni caso ha il posto (coordinate del gioco, via e fermata più vicine) e un peso, quanto è oltre la regola: l'elenco dei
punti peggiori è in ordine di peso. Dentro una zona di eccezione (ECCEZIONI, con il perché) un caso si elenca a parte e
non conta.

  python3 scripts/binari_tram.py [--gioco binari-gioco.json] [--elenco] [--json rapporto.json]

Senza argomenti misura i dati. Solo libreria standard: gira anche nel job delle prove, dove shapely non c'è.
"""
import argparse
import json
import math
import os
import sys

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------- numeri della regola (docs/binari-tram.md, con le fonti) ----------
R_MIN = 10.5          # m sulla rotaia di guida: minimo del Translohr, in linea e negli scambi (progetto del SIR3) e in
                      # deposito (inferenza)
# interasse minimo (m) secondo il raggio della curva (m), con i pali della linea aerea fuori dai binari: le fasce
# d'ingombro dei due tram a 400 mm (UNI 7156 § 4.7, tabella 12.a della relazione di tracciato del SIR3)
INGOMBRO = [(10.5, 3.362), (15, 3.129), (20, 2.997), (25, 2.915), (30, 2.862), (40, 2.795), (50, 2.753), (100, 2.670),
            (200, 2.631), (380, 2.614), (math.inf, 2.594)]
# interasse da usare dove i binari corrono nella stessa sede senza niente in mezzo (per chi li disegna: il controllo
# guarda il minimo e che resti costante): 3,00 m del progetto del SIR3, che riprende il SIR1; 3,50 m del PFTE del SIR2
INTERASSE = {'SIR1': 3.0, 'SIR3': 3.0, 'SIR2': 3.5}
PENDENZA = 0.06       # pendenza massima in linea (SIR3; il veicolo arriva al 13% con carico eccezionale)
OSM_TOLL = 1.0        # m: scarto massimo dal binario OSM

# ---------- come si misura ----------
PASSO = 1.0       # m: i binari si ricampionano ogni metro
CORDA = 3         # m: il raggio da due corde di 3 m attorno al punto (i binari del gioco hanno un punto ogni 3 m)
CORTO, LUNGO = 2, 10  # m: corde per gli spigoli
SPIGOLO = 2.0     # gradi: svolta minima nelle corde corte perché conti come spigolo
CONCENTRATA = 0.5  # parte della svolta delle corde lunghe che uno spigolo fa nelle corde corte (una curva: un quinto)
R_TOLL = 0.1      # m: raggi fino a R_MIN - R_TOLL contano come R_MIN (punti arrotondati al centimetro)
INTERASSE_TOLL = 0.3  # m: quanto l'interasse può andare e venire in OSCILLA metri
DOPPIO = 6.0      # m: i binari dei due versi più vicini di così sono nella stessa sede
UNICO = 1.0       # m: più vicini ancora sono lo stesso binario, percorso nei due versi (un tronco al capolinea)
OSCILLA = 30.0    # m: finestra in cui l'interasse non deve andare e venire
OSM_VICINO = 15.0  # m: oltre, il binario non ha un binario OSM accanto (tratti disegnati dal gioco)
GIUNTO = 10.0     # m: un ramo del deposito si misura con tanti metri dei binari che lo continuano
SPOSTA = 5.0      # m: nei depositi la svolta tra le corde lunghe è la più grande tra le finestre spostate fino a tanto
UNITO = 3         # m: casi più vicini di così lungo il binario sono lo stesso caso
CURVA = 10        # m: per i raggi, tratti sotto il minimo più vicini di così sono la stessa curva
TIPI = ['spigoli', 'raggi', 'interassi', 'scarti_osm', 'pendenze']
NOMI = {
    'spigoli': f'spigoli (svolta di almeno {SPIGOLO:g}° concentrata in {2 * CORTO} m)',
    'raggi': 'raggi sotto il minimo',
    'interassi': 'interassi fuori misura',
    'scarti_osm': f'scarti da OSM oltre {OSM_TOLL:g} m',
    'pendenze': f'pendenze oltre il {PENDENZA * 100:g}%',
}


# ---------- geometria ----------
def ricampiona(pts, passo=PASSO):
    """Punti ogni `passo` metri lungo la polilinea (gli spigoli restano spigoli)."""
    out = [tuple(pts[0])]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        l = math.dist(a, b)
        if l < 1e-9:
            continue
        s = passo - acc
        while s <= l:
            out.append((a[0] + (b[0] - a[0]) * s / l, a[1] + (b[1] - a[1]) * s / l))
            s += passo
        acc = l - (s - passo)
    if math.dist(out[-1], pts[-1]) > 1e-6:
        out.append(tuple(pts[-1]))
    return out


def svolta(a, b, c):
    """Angolo (radianti, con il segno) tra la direzione a→b e la direzione b→c."""
    d = math.atan2(c[1] - b[1], c[0] - b[0]) - math.atan2(b[1] - a[1], b[0] - a[0])
    return (d + math.pi) % (2 * math.pi) - math.pi


def svolte(S, h):
    """Per ogni punto la svolta tra la corda dei h metri prima e quella dei h metri dopo (agli estremi più corte)."""
    n, k = len(S), max(1, round(h / PASSO))
    out = [0.0] * n
    for i in range(n):
        a, b = max(0, i - k), min(n - 1, i + k)
        if a < i < b:
            out[i] = svolta(S[a], S[i], S[b])
    return out


def direzione(S, i, k=2):
    a, b = S[max(0, i - k)], S[min(len(S) - 1, i + k)]
    l = math.dist(a, b) or 1.0
    return ((b[0] - a[0]) / l, (b[1] - a[1]) / l)


def lunghezza(pts):
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


class Griglia:
    """Segmenti in una griglia, per cercare quelli vicini a un punto."""

    def __init__(self, segmenti, cella=10.0):
        self.segmenti, self.cella, self.g = segmenti, cella, {}
        for k, (a, b) in enumerate(segmenti):
            for gx in range(int(min(a[0], b[0]) // cella), int(max(a[0], b[0]) // cella) + 1):
                for gz in range(int(min(a[1], b[1]) // cella), int(max(a[1], b[1]) // cella) + 1):
                    self.g.setdefault((gx, gz), []).append(k)

    def vicini(self, p, r):
        c, out = self.cella, set()
        for gx in range(int((p[0] - r) // c), int((p[0] + r) // c) + 1):
            for gz in range(int((p[1] - r) // c), int((p[1] + r) // c) + 1):
                out.update(self.g.get((gx, gz), ()))
        return out

    def piu_vicino(self, p, r, verso=None, coseno=0.8, escludi=None):
        """Distanza dal segmento più vicino entro r; con verso solo i segmenti con |coseno| (o coseno, se negativo:
        controsenso) oltre la soglia. None se non ce n'è."""
        v = self.vicino(p, r, verso, coseno, escludi)
        return v and v[0]

    def vicino(self, p, r, verso=None, coseno=0.8, escludi=None):
        """(distanza, indice) del segmento più vicino, come piu_vicino."""
        best = None
        for k in self.vicini(p, r):
            if escludi and escludi(k):
                continue
            (ax, az), (bx, bz) = self.segmenti[k]
            ex, ez = bx - ax, bz - az
            l2 = ex * ex + ez * ez
            if l2 < 1e-12:
                continue
            if verso is not None:
                c = (ex * verso[0] + ez * verso[1]) / math.sqrt(l2)
                if (c > coseno) if coseno < 0 else (abs(c) < coseno):
                    continue
            t = max(0.0, min(1.0, ((p[0] - ax) * ex + (p[1] - az) * ez) / l2))
            d = math.hypot(ax + ex * t - p[0], az + ez * t - p[1])
            if d <= r and (best is None or d < best[0]):
                best = (d, k)
        return best


def segmenti(polilinee):
    return [(a, b) for P in polilinee for a, b in zip(P, P[1:])]


def tagli_inversioni(pts):
    """Polilinea divisa dove torna indietro (lo shape GTFS del SIR1 al capolinea: non è un binario)."""
    S = ricampiona(pts, 2.0)
    t = svolte(S, 2.0)
    pezzi, cur = [], [S[0]]
    for i in range(1, len(S)):
        cur.append(S[i])
        if abs(t[i]) > math.radians(120) and len(cur) > 2:
            pezzi.append(cur)
            cur = [S[i]]
    pezzi.append(cur)
    return [p for p in pezzi if lunghezza(p) > 20]


# ---------- la rete da misurare ----------
class Rete:
    """Binari da misurare. linee: id -> {binari: {1: pts, -1: pts}, comunicazioni: [pts], quote: {1: [quota ogni 5 m],
    -1: [...]} o None}. depositi: nome -> {rami: [{pts, a, b, proprio}], nodi: [{p, capi: [{r, at, out} o {linea, out}]}]}:
    il grafo dei binari, con i rami tra i nodi e a ogni nodo i capi (il ramo r che parte da lì, o il binario della linea
    alle porte). Si misurano i rami propri del deposito, ognuno con i binari che lo continuano."""

    def __init__(self, nome):
        self.nome = nome
        self.linee, self.depositi = {}, {}
        self.osm = []        # segmenti dei binari OSM
        self.stazione = None  # zona della stazione (net.tramStazione)
        self.fermate = []    # (x, z, nome) per dare il nome ai posti
        self.strade = None   # Griglia dei tratti di strada, con i nomi


def xz_da(origine):
    lat0, lon0 = origine
    m_lon = 111320 * math.cos(math.radians(lat0))
    return lambda la, lo: ((lo - lon0) * m_lon, -(la - lat0) * 111130)


def leggi_osm(xz):
    """Binari OSM (railway=tram, tutti i servizi) dei due export, senza doppioni."""
    visti, ways = set(), []
    for f in ('data/osm-padova-tram.json', 'data/osm-padova-tram-cantiere.json'):
        p = os.path.join(RADICE, f)
        if not os.path.exists(p):
            continue
        for e in json.load(open(p))['elements']:
            if e['type'] != 'way' or e.get('tags', {}).get('railway') != 'tram' or e['id'] in visti:
                continue
            visti.add(e['id'])
            ways.append({'id': e['id'], 'servizio': e['tags'].get('service', 'linea'), 'pts': [xz(g['lat'], g['lon']) for g in e['geometry']]})
    return ways


def strade_e_fermate(rete, M):
    n = M['nodes']
    nodi = [(n[i], n[i + 1]) for i in range(0, len(n), 2)]
    E, tratti, nomi = M['edges'], [], []
    for k in range(0, len(E), 8):
        tratti.append((nodi[E[k]], nodi[E[k + 1]]))
        nomi.append(M['names'][E[k + 4]] if E[k + 4] < len(M['names']) else '')
    rete.strade = (Griglia(tratti, 20.0), nomi)


def rete_dati(M=None):
    """La rete dei dati: SIR1 dalla mappa, SIR2 e SIR3 dai loro percorsi, comunicazioni e depositi da OSM."""
    M = M or json.load(open(os.path.join(RADICE, 'src/data/padova-map.json')))
    xz = xz_da(M['origin'])
    R = Rete('dati')
    ways = leggi_osm(xz)
    R.osm = segmenti([w['pts'] for w in ways])
    R.stazione = M.get('tramStazione')
    strade_e_fermate(R, M)
    t = M['tram']
    R.linee['SIR1'] = {'binari': {1: [(t[0][i], t[0][i + 1]) for i in range(0, len(t[0]), 2)],
                                  -1: [(t[1][i], t[1][i + 1]) for i in range(0, len(t[1]), 2)]}}
    R.fermate += [(s[0], s[1], s[2]) for s in M['tramStops']]
    nuove = json.load(open(os.path.join(RADICE, 'data/tram-linee-nuove.json')))
    for L in nuove['linee']:
        b = [[xz(*p) for p in v['percorso']] for v in L['versi']]
        R.linee[L['id']] = {'binari': {1: b[0], -1: b[1]}}
        R.fermate += [(*xz(f['lat'], f['lon']), f['nome']) for v in L['versi'] for f in v['fermate']]
    # comunicazioni OSM (service=crossover) accanto ai binari di una linea
    for L in R.linee.values():
        g = Griglia(segmenti(L['binari'].values()), 20.0)
        L['comunicazioni'] = [w['pts'] for w in ways if w['servizio'] == 'crossover' and all(g.piu_vicino(p, 30) is not None for p in w['pts'])]
    dep = json.load(open(os.path.join(RADICE, 'data/tram-depositi.json')))
    for D in dep['depositi']:
        g = Griglia(segmenti(R.linee[D['linea']]['binari'].values()), 20.0)
        ww = [{'servizio': b['servizio'], 'pts': [xz(*p) for p in b['punti']]} for b in D['binari']]
        # i binari della linea e le comunicazioni dei capolinea si misurano con la linea
        for w in ww:
            w['proprio'] = w['servizio'] not in ('linea', 'crossover') or not all(g.piu_vicino(p, 30) is not None for p in w['pts'])
        R.depositi[D['nome']] = grafo_way(ww)
    return R


def grafo_way(ways):
    """Il grafo di un deposito dalle way (punti x, z), come lo fa TramYard: nodi ai vertici in comune tra le way e ai
    loro capi, rami tra i nodi."""
    chiave = lambda p: (round(p[0] * 20), round(p[1] * 20))
    cnt = {}
    for w in ways:
        for i, p in enumerate(w['pts']):
            cnt[chiave(p)] = cnt.get(chiave(p), 0) + (2 if i in (0, len(w['pts']) - 1) else 1)
    nodi, ids, rami = [], {}, []

    def nodo(p):
        if chiave(p) not in ids:
            ids[chiave(p)] = len(nodi)
            nodi.append({'p': p, 'capi': []})
        return ids[chiave(p)]

    for w in ways:
        P, i0 = w['pts'], 0
        for i in range(1, len(P)):
            if i == len(P) - 1 or cnt[chiave(P[i])] >= 2:
                rami.append({'pts': P[i0:i + 1], 'a': nodo(P[i0]), 'b': nodo(P[i]), 'proprio': w['proprio']})
                i0 = i
    for k, r in enumerate(rami):
        nodi[r['a']]['capi'].append({'r': k, 'at': 'a', 'out': dir_uscita(braccio(r['pts']))})
        nodi[r['b']]['capi'].append({'r': k, 'at': 'b', 'out': dir_uscita(braccio(r['pts'][::-1]))})
    return {'rami': rami, 'nodi': nodi}


def braccio(P, lung=GIUNTO):
    """I primi `lung` metri della polilinea."""
    out, acc = [P[0]], 0.0
    for a, b in zip(P, P[1:]):
        l = math.dist(a, b)
        if acc + l >= lung:
            f = (lung - acc) / (l or 1)
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            return out
        out.append(b)
        acc += l
    return out


def dritti(N, i):
    """Capi del nodo N che continuano il capo i (entro 45°, come TramYard)."""
    a = N['capi'][i]['out']
    return [k for k, c in enumerate(N['capi']) if k != i and a[0] * c['out'][0] + a[1] * c['out'][1] < -0.7]


def oltre(D, n, k, lung=GIUNTO):
    """I primi `lung` metri di binario dal nodo n lungo il suo capo k, e ai nodi dopo sempre il capo più dritto (alle
    porte il binario della linea)."""
    out, acc = [D['nodi'][n]['p']], 0.0
    for _ in range(50):
        c = D['nodi'][n]['capi'][k]
        P = c['linea'] if 'linea' in c else (D['rami'][c['r']]['pts'] if c['at'] == 'a' else D['rami'][c['r']]['pts'][::-1])
        Q = braccio(P, lung - acc)
        out += Q[1:]
        acc += lunghezza(Q)
        if acc >= lung - 1e-6 or 'linea' in c:
            break
        r = D['rami'][c['r']]
        n = r['b'] if c['at'] == 'a' else r['a']
        i = next(j for j, x in enumerate(D['nodi'][n]['capi']) if x.get('r') == c['r'] and x['at'] == ('b' if c['at'] == 'a' else 'a'))
        cont = dritti(D['nodi'][n], i)
        if not cont:
            break
        a = D['nodi'][n]['capi'][i]['out']
        k = min(cont, key=lambda j: a[0] * D['nodi'][n]['capi'][j]['out'][0] + a[1] * D['nodi'][n]['capi'][j]['out'][1])
    return out


def dir_uscita(B):
    S = ricampiona(B, 0.5)
    q = S[min(len(S) - 1, 4)]
    l = math.dist(S[0], q) or 1.0
    return ((q[0] - S[0][0]) / l, (q[1] - S[0][1]) / l)


def rete_gioco(G, M=None):
    """La rete del gioco dal file di tests/binari-tram.spec.js: per sede i binari (TramTrack.paths, con i bivi tra le
    linee), le comunicazioni dei capolinea (terminalCurve), le quote; per deposito i rami e i nodi di TramYard."""
    M = M or json.load(open(os.path.join(RADICE, 'src/data/padova-map.json')))
    xz = xz_da(M['origin'])
    R = Rete('gioco')
    R.osm = segmenti([w['pts'] for w in leggi_osm(xz)])
    R.stazione = G.get('stazione')
    strade_e_fermate(R, M)
    for T in G['tracks']:
        b = {d: [tuple(p) for p in T['paths'][str(d)]] for d in (1, -1)}
        R.linee[T['id']] = {
            'binari': b,
            'comunicazioni': [[tuple(p) for p in t['curve']] for t in T['terminals'] if t and len(t['curve']) > 1],
            'quote': {d: T['quote'][str(d)] for d in (1, -1)} if T.get('quote') else None,
        }
        R.fermate += [tuple(f) for f in T.get('fermate', [])]
    tracks = {T['id']: T for T in G['tracks']}
    for Y in G['yards']:
        rami = [{'pts': [tuple(p) for p in e['pts']], 'proprio': True} for e in Y['edges']]
        nodi = []
        for n, N in enumerate(Y['nodes']):
            capi = []
            for E in N['ends']:
                if 'port' in E:
                    # alla porta il binario della linea, dalla porta verso fuori
                    pt = Y['ports'][E['port']]
                    P = [tuple(p) for p in tracks[pt['T']]['paths'][str(pt['dir'])]]
                    capi.append({'linea': braccio_lungo(P, pt['s'], E['out']), 'out': tuple(E['out'])})
                else:
                    capi.append({'r': E['e'], 'at': E['at'], 'out': tuple(E['out'])})
                    rami[E['e']][E['at']] = n
            nodi.append({'p': (N['x'], N['z']), 'capi': capi})
        R.depositi[Y['name']] = {'rami': rami, 'nodi': nodi}
    return R


def braccio_lungo(P, s, verso, lung=GIUNTO):
    """I `lung` metri del binario P da s nel verso `verso` (direzione x, z)."""
    S = ricampiona(P, PASSO)
    i = max(0, min(len(S) - 1, round(s / PASSO)))
    d = direzione(S, i)
    k = 1 if d[0] * verso[0] + d[1] * verso[1] > 0 else -1
    j = max(0, min(len(S) - 1, i + k * round(lung / PASSO)))
    return S[i:j + 1] if k > 0 else S[j:i + 1][::-1]


# ---------- misure ----------
def raggruppa(flags, unito=UNITO):
    """Tratti [i, j] di flag veri, uniti se distano meno di `unito` punti."""
    out, i, n = [], 0, len(flags)
    while i < n:
        if not flags[i]:
            i += 1
            continue
        j = i
        while True:
            nx = next((q for q in range(j + 1, min(n, j + 1 + unito)) if flags[q]), None)
            if nx is None:
                break
            j = nx
        out.append((i, j))
        i = j + 1
    return out


def curve(S, esse=False):
    """Spigoli e raggi sotto R_MIN lungo i punti S (ogni PASSO metri); 'i' è l'indice del punto in S. Con esse (nei
    depositi) la svolta tra le corde lunghe è la più grande tra quelle a meno di SPOSTA metri: in una S due curve opposte
    si annullano tra le corde lunghe, ma una delle finestre vicine ne vede una intera; uno spigolo o uno zig-zag no."""
    t2, t10, t3 = svolte(S, CORTO), svolte(S, LUNGO), svolte(S, CORDA)
    if esse:
        k = round(SPOSTA / PASSO)
        t10 = [max(abs(v) for v in t10[max(0, i - k):i + k + 1]) for i in range(len(S))]
    sp = [abs(t2[i]) >= math.radians(SPIGOLO) and abs(t2[i]) >= CONCENTRATA * abs(t10[i]) for i in range(len(S))]
    vicino_sp = [any(sp[max(0, i - UNITO):i + UNITO + 1]) for i in range(len(S))]
    rg = [not vicino_sp[i] and abs(t3[i]) > 1e-9 and CORDA / abs(t3[i]) < R_MIN - R_TOLL for i in range(len(S))]
    casi = []
    for i, j in raggruppa(sp):
        k = max(range(i, j + 1), key=lambda q: abs(t2[q]))
        g = math.degrees(abs(t2[k]))
        casi.append({'tipo': 'spigoli', 'p': S[k], 'i': k, 'gradi': round(g, 1), 'peso': round(g / SPIGOLO, 2)})
    # una curva troppo stretta è un caso solo, anche se il raggio torna sopra il minimo per qualche metro
    for i, j in raggruppa(rg, CURVA):
        k = max(range(i, j + 1), key=lambda q: abs(t3[q]))
        r = CORDA / abs(t3[k])
        casi.append({'tipo': 'raggi', 'p': S[k], 'i': k, 'raggio': round(r, 1), 'metri': round((j - i + 1) * PASSO), 'peso': round(R_MIN / r, 2)})
    return casi


def interasse_min(r):
    """Interasse minimo dove la curva ha raggio r (INGOMBRO, interpolato; sotto R_MIN il primo valore)."""
    if r <= INGOMBRO[0][0]:
        return INGOMBRO[0][1]
    for (r0, a), (r1, b) in zip(INGOMBRO, INGOMBRO[1:]):
        if r <= r1:
            return b if r1 == math.inf else a + (b - a) * (r - r0) / (r1 - r0)


def minimi(S):
    """Per ogni punto l'interasse minimo, dal raggio più stretto entro 10 m (la curva dove si trova il tram)."""
    t = svolte(S, CORDA)
    r = [CORDA / abs(v) if abs(v) > 1e-9 else math.inf for v in t]
    k = round(10 / PASSO)
    return [interasse_min(min(r[max(0, i - k):i + k + 1])) for i in range(len(S))]


def interassi(A, B):
    """I due binari di una linea (A verso +1, B verso -1) dove corrono nella stessa sede (entro DOPPIO metri, in
    controsenso, e non sullo stesso binario): più vicini del minimo (INGOMBRO), o con l'interasse che va e viene.
    Costante, o che passa da un valore a un altro senza tornare indietro (la S verso una banchina centrale, i pali in
    mezzo), va bene: negli OSCILLA metri attorno al punto la strada fatta dall'interasse, tolto il cambio netto, resta
    sotto INTERASSE_TOLL."""
    S = ricampiona(A)
    g = Griglia(segmenti([B]))
    d = [g.piu_vicino(p, DOPPIO, direzione(S, i), coseno=-0.9) for i, p in enumerate(S)]
    d = [v if v is not None and v >= UNICO else None for v in d]
    m = minimi(S)
    k = round(OSCILLA / 2 / PASSO)

    def va_e_viene(i):
        w = d[i - k:i + k + 1]
        if i < k or len(w) < 2 * k + 1 or None in w:
            return 0.0
        return sum(abs(b - a) for a, b in zip(w, w[1:])) - abs(w[-1] - w[0])
    osc = [va_e_viene(i) for i in range(len(S))]
    casi = []
    for i, j in raggruppa([v is not None and v < m[i] for i, v in enumerate(d)]):
        q = max((q for q in range(i, j + 1) if d[q] is not None), key=lambda q: m[q] - d[q])
        casi.append({'tipo': 'interassi', 'p': S[q], 'interasse': round(d[q], 2), 'minimo': round(m[q], 2),
                     'metri': round((j - i + 1) * PASSO), 'peso': round(1 + (m[q] - d[q]) / INTERASSE_TOLL, 2)})
    for i, j in raggruppa([v > INTERASSE_TOLL for v in osc]):
        q = max(range(i, j + 1), key=lambda q: osc[q])
        if any(math.dist(c['p'], S[q]) < OSCILLA for c in casi):
            continue
        casi.append({'tipo': 'interassi', 'p': S[q], 'interasse': round(d[q], 2), 'oscilla': round(osc[q], 2),
                     'metri': round((j - i + 1) * PASSO), 'peso': round(osc[q] / INTERASSE_TOLL, 2)})
    return casi


def interassi_deposito(rami, nodi):
    """Binari paralleli del deposito più vicini del minimo (INGOMBRO), lontano dai nodi, dove si avvicinano per forza
    (lo scambio e il tratto fino a dove ci stanno due tram affiancati)."""
    segs, chi = [], []
    for r, P in enumerate(rami):
        for a, b in zip(P, P[1:]):
            segs.append((a, b))
            chi.append(r)
    g = Griglia(segs)
    nodi = list(nodi) + [P[0] for P in rami] + [P[-1] for P in rami]
    casi = []
    for r, P in enumerate(rami):
        S = ricampiona(P)
        m = minimi(S)
        d = [None] * len(S)
        for i, p in enumerate(S):
            if any(math.dist(p, c) < 15 for c in nodi):
                continue
            v = g.piu_vicino(p, m[i], direzione(S, i), coseno=0.95, escludi=lambda q: chi[q] == r)
            d[i] = v if v is not None and v < m[i] else None
        for i, j in raggruppa([v is not None for v in d]):
            if (j - i + 1) * PASSO < 5:
                continue
            k = max((q for q in range(i, j + 1) if d[q] is not None), key=lambda q: m[q] - d[q])
            casi.append({'tipo': 'interassi', 'p': S[k], 'interasse': round(d[k], 2), 'minimo': round(m[k], 2),
                         'metri': round((j - i + 1) * PASSO), 'peso': round(1 + (m[k] - d[k]) / INTERASSE_TOLL, 2)})
    # ogni coppia di rami si trova due volte: una sola
    out = []
    for c in casi:
        if not any(math.dist(c['p'], o['p']) < c['interasse'] + 1 and abs(c['interasse'] - o['interasse']) < 0.2 for o in out):
            out.append(c)
    return out


def scarti(S, osm):
    """Tratti oltre OSM_TOLL dal binario OSM più vicino e parallelo (entro OSM_VICINO: oltre non c'è un binario OSM)."""
    d = [osm.piu_vicino(p, OSM_VICINO, direzione(S, i)) for i, p in enumerate(S)]
    casi = []
    for i, j in raggruppa([v is not None and v > OSM_TOLL for v in d]):
        if (j - i + 1) * PASSO < 3:
            continue
        k = max((q for q in range(i, j + 1) if d[q] is not None), key=lambda q: d[q])
        casi.append({'tipo': 'scarti_osm', 'p': S[k], 'scarto': round(d[k], 2), 'metri': round((j - i + 1) * PASSO),
                     'peso': round(d[k] / OSM_TOLL, 2)})
    return casi


def pendenze(P, quote):
    """Tratti con la pendenza (su 10 m, quote ogni 5 m) oltre PENDENZA."""
    T = ricampiona(P, 5.0)
    n = min(len(T), len(quote))
    p = [abs(quote[min(n - 1, i + 1)] - quote[max(0, i - 1)]) / 10.0 for i in range(n)]
    casi = []
    for i, j in raggruppa([v > PENDENZA for v in p], 1):
        k = max(range(i, j + 1), key=lambda q: p[q])
        casi.append({'tipo': 'pendenze', 'p': T[k], 'pendenza': round(p[k] * 100, 1), 'metri': (j - i + 1) * 5,
                     'peso': round(p[k] / PENDENZA, 2)})
    return casi


def in_stazione(Z, p):
    """Punto nella zona della stazione (net.tramStazione: centri delle testate a e b, raggio r, near)?"""
    if not Z:
        return False
    (ax, az), (bx, bz) = Z['a'], Z['b']
    ex, ez = bx - ax, bz - az
    t = max(0.0, min(1.0, ((p[0] - ax) * ex + (p[1] - az) * ez) / (ex * ex + ez * ez or 1e-9)))
    return math.hypot(p[0] - ax - ex * t, p[1] - az - ez * t) - Z['r'] < Z['near']


# Zone dove la regola cede a un vincolo scritto: i casi dentro si elencano a parte e non contano.
VOLTABAROZZO_SO = (2334, 3690)   # x, z del gioco
ECCEZIONI = [
    {'nome': 'piazzale della stazione', 'tipi': {'scarti_osm'}, 'dentro': lambda R, p: in_stazione(R.stazione, p),
     'perche': 'binari disegnati dal rendering del progetto del piazzale (docs/linee-tram-nuove.md, "Binari della '
               'stazione"): anelli regolari e raccordi morbidi al posto dei binari di OSM, che lì fanno S e si incrociano'},
    {'nome': 'curva sud-ovest del deposito di Voltabarozzo', 'tipi': {'scarti_osm'},
     'dentro': lambda R, p: math.dist(p, VOLTABAROZZO_SO) < 12,
     'perche': "OSM (il cantiere, way 1453989055) disegna la curva del binario interno dell'anello con un raggio di "
               "6,4 m, sotto il minimo del Translohr: col raggio minimo il binario passa fino a 1,2 m più all'interno "
               "dell'anello (nella foto aerea la curva della massicciata è ancora più larga)"},
]


def eccezione(R, c):
    return next((E['nome'] for E in ECCEZIONI if c['tipo'] in E['tipi'] and E['dentro'](R, c['p'])), None)


def misura(R):
    """Casi per linea e per deposito: {dove: [casi]}, ogni caso col posto e, nelle zone di eccezione, 'eccezione'."""
    osm = Griglia(R.osm)
    out = {}
    for nome, L in R.linee.items():
        casi = []
        for d in (1, -1):
            for P in tagli_inversioni(L['binari'][d]):
                S = ricampiona(P)
                for c in curve(S) + scarti(S, osm):
                    casi.append({**c, 'binario': d})
            if L.get('quote'):
                casi += [{**c, 'binario': d} for c in pendenze(L['binari'][d], L['quote'][d])]
        casi += [{**c, 'binario': 'comunicazione'} for P in L.get('comunicazioni', []) for c in curve(ricampiona(P))]
        casi += [{**c, 'binario': 1} for c in interassi(L['binari'][1], L['binari'][-1])]
        out[nome] = casi
    for nome, D in R.depositi.items():
        casi = []
        for ri, r in enumerate(D['rami']):
            if not r['proprio'] or len(r['pts']) < 2:
                continue
            P = r['pts']
            casi += [{**c, 'binario': 'ramo'} for c in scarti(ricampiona(P), osm)]
            # il ramo con i binari che lo continuano oltre i due capi (ogni uscita al primo nodo, poi dritto): una curva
            # che comincia o finisce al nodo (gli scambi, le way spezzate a metà curva) si misura con quello che c'è prima
            # e dopo, non su una finestra tagliata. Contano i casi sul ramo; ai nodi sono 'scambio'
            lati = []
            for n, at in ((r.get('a'), 'a'), (r.get('b'), 'b')):
                if n is None:
                    lati.append([[]])
                    continue
                N = D['nodi'][n]
                i = next(j for j, c in enumerate(N['capi']) if c.get('r') == ri and c['at'] == at)
                lati.append([oltre(D, n, k)[1:] for k in dritti(N, i)] or [[]])
            L = lunghezza(P)
            for pre in lati[0]:
                for post in lati[1]:
                    S = ricampiona(pre[::-1] + P + post)
                    s0 = lunghezza(pre[::-1] + [P[0]]) if pre else 0.0
                    for c in curve(S, esse=True):
                        s = c.pop('i') * PASSO
                        if s0 - 0.5 <= s <= s0 + L + 0.5:
                            nodo = s < s0 + UNITO or s > s0 + L - UNITO
                            casi.append({**c, 'binario': 'scambio' if nodo else 'ramo'})
        rami = [r['pts'] for r in D['rami'] if r['proprio'] and len(r['pts']) > 1]
        casi += [{**c, 'binario': 'ramo'} for c in interassi_deposito(rami, [N['p'] for N in D['nodi'] if len(N['capi']) > 1])]
        out[nome] = casi
    for dove, casi in out.items():
        # lo stesso posto trovato più volte (da due rami ai lati di un nodo, con più binari dopo): il caso più pesante
        casi.sort(key=lambda c: -c['peso'])
        tenuti = []
        for c in casi:
            if not any(o['tipo'] == c['tipo'] and math.dist(o['p'], c['p']) < UNITO for o in tenuti):
                tenuti.append(c)
        out[dove] = casi = tenuti
        for c in casi:
            c['eccezione'] = eccezione(R, c)
            c['dove'] = dove
            c['x'], c['z'] = round(c['p'][0]), round(c['p'][1])
            c['luogo'] = luogo(R, c['p'])
            del c['p']
            c.pop('i', None)
    return out


def luogo(R, p):
    """Via e fermata del tram più vicine."""
    parti = []
    if R.strade:
        g, nomi = R.strade
        v = g.vicino(p, 30, escludi=lambda k: not nomi[k])
        if v:
            parti.append(nomi[v[1]])
    if R.fermate:
        f = min(R.fermate, key=lambda f: math.dist(p, f[:2]))
        dist = math.dist(p, f[:2])
        parti.append(f'fermata {f[2]}' if dist < 30 else f'{dist:.0f} m da {f[2]}')
    return ', '.join(parti)


def conta(casi):
    """{dove: {tipo: numero di casi fuori dalle eccezioni}}."""
    return {dove: {t: sum(1 for c in cc if c['tipo'] == t and not c['eccezione']) for t in TIPI} for dove, cc in casi.items()}


def peggiori(casi, n=10, dove=None):
    tutti = [c for d, cc in casi.items() if dove is None or d in dove for c in cc if not c['eccezione']]
    return sorted(tutti, key=lambda c: -c['peso'])[:n]


def descrivi(c):
    v = {'spigoli': lambda: f"spigolo di {c['gradi']:g}°",
         'raggi': lambda: f"raggio {c['raggio']:g} m (minimo {R_MIN:g}) per {c['metri']} m",
         'interassi': lambda: (f"interasse che va e viene di {c['oscilla']:g} m in {OSCILLA:g} m (qui {c['interasse']:g} m) per {c['metri']} m"
                               if 'oscilla' in c else f"interasse {c['interasse']:g} m (minimo {c['minimo']:g}) per {c['metri']} m"),
         'scarti_osm': lambda: f"{c['scarto']:g} m da OSM per {c['metri']} m",
         'pendenze': lambda: f"pendenza {c['pendenza']:g}% per {c['metri']} m"}[c['tipo']]()
    b = {1: 'verso +1', -1: 'verso -1'}.get(c['binario'], c['binario'])
    return f"{c['dove']} {b}: {v}, ({c['x']}, {c['z']}) {c['luogo']}, peso {c['peso']:g}"


def rapporto(R, soglie=None, elenco=False, json_out=None):
    """Stampa i numeri per linea e deposito (con le soglie, se ci sono) e restituisce (valori, casi, sopra)."""
    casi = misura(R)
    valori = conta(casi)
    sopra = []
    # le pendenze solo dove ci sono le quote (nel gioco)
    tipi = [t for t in TIPI if t != 'pendenze' or any(L.get('quote') for L in R.linee.values())]
    print(f'Binari del tram ({R.nome}): ' + ', '.join(f"{NOMI[t]}" for t in tipi))
    for dove, v in valori.items():
        riga = []
        for t in tipi:
            s = soglie.get(dove, {}).get(t) if soglie else None
            oltre = s is not None and v[t] > s
            if oltre:
                sopra.append(f'{t} {dove}')
            riga.append(f"{'✗ ' if oltre else ''}{t} {v[t]}" + (f' (soglia {s})' if s is not None else ''))
        ecc = sum(1 for c in casi[dove] if c['eccezione'])
        print(f'  {dove}: ' + ', '.join(riga) + (f'; {ecc} casi nelle eccezioni' if ecc else ''))
    if elenco:
        print('  punti peggiori delle linee:')
        for c in peggiori(casi, 15, [d for d in casi if d in R.linee]):
            print('    ' + descrivi(c))
        for d in R.depositi:
            print(f'  punti peggiori del deposito {d}:')
            for c in peggiori(casi, 8, [d]):
                print('    ' + descrivi(c))
        ecc = [c for cc in casi.values() for c in cc if c['eccezione']]
        for E in ECCEZIONI:
            n = sum(1 for c in ecc if c['eccezione'] == E['nome'])
            if n:
                print(f"  nelle eccezioni, {E['nome']}: {n} casi ({E['perche']})")
    if json_out:
        json.dump({'rete': R.nome, 'valori': valori, 'soglie': soglie, 'casi': casi}, open(json_out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return valori, casi, sopra


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--gioco', help='file dei binari del gioco (tests/binari-tram.spec.js); senza, i dati')
    ap.add_argument('--soglie', help='file JSON con le soglie {dove: {tipo: n}}: esce con errore se un numero le supera')
    ap.add_argument('--elenco', action='store_true', help='elenca i punti peggiori')
    ap.add_argument('--json', help='scrive il rapporto completo in questo file')
    args = ap.parse_args()
    R = rete_gioco(json.load(open(args.gioco))) if args.gioco else rete_dati()
    soglie = json.load(open(args.soglie)) if args.soglie else None
    _, _, sopra = rapporto(R, soglie, args.elenco, args.json)
    if sopra:
        print('Sopra la soglia: ' + ', '.join(sopra))
        sys.exit(1)


if __name__ == '__main__':
    main()
