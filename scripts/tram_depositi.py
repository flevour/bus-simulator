"""Binari dei depositi del tram da OSM: la Guizza dall'export del SIR1, Voltabarozzo da quello del cantiere del SIR3.
Per ogni deposito le way railway=tram con almeno un vertice entro r metri dal centro, tagliate al cerchio: i binari di
servizio (yard, siding, spur), le comunicazioni e i pezzi dei binari di linea che ci portano. Il gioco ne fa il grafo dei
binari del deposito (TramYard in src/tram/tram.js) e lo attacca alla fine dei binari della linea; i pezzi che corrono
accanto a quelli del gioco li toglie lui, e con loro le comunicazioni dei capolinea (quelle le fa TramTrack.terminal);
una comunicazione che dal deposito arriva a metà di un binario della linea (Voltabarozzo) diventa una porta lì.

Le way di OSM sono la traccia: la geometria si rifà secondo la regola di docs/binari-tram.md (scripts/tram_stesura.py:
rettilinei, clotoidi e archi, raggio di almeno 10,5 m, entro 1 m da OSM). Le way restano quelle di OSM, con id, servizio
e galleria; cambiano i punti:

* i binari sono catene di rami che continuano dritti ai nodi (a ogni scambio la coppia più dritta, poi le altre): ogni
  catena si stende da sola, prima quelle su cui si attaccano le altre;
* a uno scambio il ramo deviato parte tangente al binario che lo porta, e la punta arretra lungo quel binario quanto
  serve perché la curva resti centrata sulla svolta di OSM (OSM mette lo scambio nel vertice dove la way deviata parte
  già girata di 5-17°): il nodo dello scambio si sposta nella punta. Non oltre il nodo prima (a metà strada se anche
  quello è uno scambio) né fuori dal rettilineo; se lo spazio non basta, la curva parte dalla punta con l'arco, come il
  ramo deviato dello scambio a cerniera;
* dove due binari si toccano in un nodo con quattro capi (alla Guizza i due anelli, in alto e in basso) restano tangenti
  nel nodo: il secondo si stende in due pezzi che finiscono lì;
* due passate: alla Guizza c'è un giro (la catena lunga si attacca alla scala, la scala all'anello interno, l'anello
  tocca la catena lunga), e nella prima la catena che porta lo scambio, se non è ancora stesa, è quella di OSM.

Il raccordo tra la fine dei binari della linea, come li disegna il gioco, e i rami del deposito lo fa TramYard.

Uso: python3 scripts/tram_depositi.py data/osm-padova-tram.json data/osm-padova-tram-cantiere.json data/tram-depositi.json
"""
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tram_stesura as ts

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# centro del deposito, raggio, export da cui prenderlo (0: SIR1, 1: cantiere)
DEPOSITI = [
    {'nome': 'Guizza', 'linea': 'SIR1', 'fonte': 0, 'centro': (45.3672, 11.8753), 'r': 230},
    {'nome': 'Voltabarozzo', 'linea': 'SIR3', 'fonte': 1, 'centro': (45.3748, 11.9076), 'r': 200},
]
DRITTO = -0.7      # coseno tra due capi che continuano dritti a un nodo (entro 45°, come TramYard)
MARGINE = 1.0      # m tra la punta di uno scambio e il nodo prima
RETTO = 0.02       # m: il binario che porta lo scambio è dritto dove si scosta dalla tangente meno di così
CIFRE = 8          # decimali di lat e lon (1 mm): i raggi misurati su corde di 3 m non devono sentire l'arrotondamento


def proiezione(origine):
    """Da lat, lon a x, z del gioco e ritorno (toXZ di src/data/padova.js)."""
    lat0, lon0 = origine
    m_lon = 111320 * math.cos(math.radians(lat0))
    return (lambda la, lo: ((lo - lon0) * m_lon, -(la - lat0) * 111130),
            lambda x, z: [round(lat0 - z / 111130, CIFRE), round(lon0 + x / m_lon, CIFRE)])


def chiave(p):
    return (round(p[0] * 20), round(p[1] * 20))


class Polilinea:
    def __init__(self, P):
        self.P = P
        self.s = [0.0]
        for a, b in zip(P, P[1:]):
            self.s.append(self.s[-1] + ts.norm(ts.sub(b, a)))
        self.len = self.s[-1]

    def proietta(self, q):
        """(s, punto, versore) del punto più vicino a q."""
        best = None
        for i, (a, b) in enumerate(zip(self.P, self.P[1:])):
            ab = ts.sub(b, a)
            l2 = ts.dot(ab, ab)
            if l2 < 1e-12:
                continue
            t = max(0.0, min(1.0, ts.dot(ts.sub(q, a), ab) / l2))
            p = ts.add(a, ts.mul(ab, t))
            d = ts.norm(ts.sub(q, p))
            if best is None or d < best[0]:
                best = (d, self.s[i] + t * (self.s[i + 1] - self.s[i]), p, ts.unit(ab))
        return best[1], best[2], best[3]

    def at(self, s):
        s = max(0.0, min(self.len, s))
        for i in range(len(self.P) - 1):
            if self.s[i + 1] >= s or i == len(self.P) - 2:
                l = self.s[i + 1] - self.s[i]
                t = 0.0 if l < 1e-12 else (s - self.s[i]) / l
                a, b = self.P[i], self.P[i + 1]
                return ts.add(a, ts.mul(ts.sub(b, a), t)), ts.unit(ts.sub(b, a))

    def pezzo(self, s0, s1):
        """I punti tra s0 e s1 (s0 < s1)."""
        out = [self.at(s0)[0]]
        out += [p for p, s in zip(self.P, self.s) if s0 + 1e-6 < s < s1 - 1e-6]
        out.append(self.at(s1)[0])
        return out

    def dritto(self, s, verso, fino):
        """Quanti metri da s nel verso (+1, -1), fino a `fino`, il binario resta sulla sua tangente in s."""
        p, d = self.at(s)
        m = 0.0
        while m < fino:
            m2 = min(fino, m + 0.5)
            q, _ = self.at(s + verso * m2)
            if abs(ts.cross(d, ts.sub(q, p))) > RETTO or (s + verso * m2 < 0 or s + verso * m2 > self.len):
                break
            m = m2
        return m


def grafo(ways):
    """Nodi (vertici condivisi tra le way e capi delle way, come TramYard) e rami tra i nodi."""
    cnt = {}
    for w in ways:
        for i, p in enumerate(w['pts']):
            cnt[chiave(p)] = cnt.get(chiave(p), 0) + (2 if i in (0, len(w['pts']) - 1) else 1)
    nodi, ids, rami = [], {}, []

    def nodo(p):
        k = chiave(p)
        if k not in ids:
            ids[k] = len(nodi)
            nodi.append({'p': p, 'capi': []})
        return ids[k]

    for wi, w in enumerate(ways):
        i0 = 0
        for i in range(1, len(w['pts'])):
            if i == len(w['pts']) - 1 or cnt[chiave(w['pts'][i])] >= 2:
                rami.append({'w': wi, 'pts': w['pts'][i0:i + 1], 'a': nodo(w['pts'][i0]), 'b': nodo(w['pts'][i])})
                i0 = i
    for k, r in enumerate(rami):
        for at, P in (('a', r['pts']), ('b', r['pts'][::-1])):
            q = Polilinea(P).at(min(2.0, ts.lunghezza(P)))[0]
            nodi[r[at]]['capi'].append({'r': k, 'at': at, 'out': ts.unit(ts.sub(q, P[0]))})
    return nodi, rami


def coppie(nodi):
    """A ogni nodo i capi che continuano uno nell'altro: prima le coppie più dritte (ognuno è il migliore dell'altro),
    poi tra i capi rimasti. Le prime fanno passare il binario che porta gli scambi, le seconde un binario che lo tocca."""
    for N in nodi:
        C = N['capi']
        N['coppia'] = [None] * len(C)
        N['giro'] = [0] * len(C)
        for giro in (1, 2):
            liberi = [i for i in range(len(C)) if N['coppia'][i] is None]
            def migliore(i):
                c = [k for k in liberi if k != i and ts.dot(C[i]['out'], C[k]['out']) < DRITTO]
                return min(c, key=lambda k: ts.dot(C[i]['out'], C[k]['out'])) if c else None
            m = {i: migliore(i) for i in liberi}
            for i in liberi:
                k = m[i]
                if k is not None and m.get(k) == i and N['coppia'][i] is None:
                    N['coppia'][i], N['coppia'][k] = k, i
                    N['giro'][i] = N['giro'][k] = giro


def catene(nodi, rami):
    """Binari continui: rami uniti dalle coppie del primo giro. Ogni catena: [(ramo, avanti)], e per ogni capo il nodo e
    il capo da cui esce."""
    fatto = set()
    out = []

    def capo(n, r, at):
        return next(i for i, c in enumerate(nodi[n]['capi']) if c['r'] == r and c['at'] == at)

    def avanza(r, fwd):
        """Dal ramo r percorso nel verso fwd, i rami dopo."""
        seq = []
        while True:
            n = rami[r]['b'] if fwd else rami[r]['a']
            i = capo(n, r, 'b' if fwd else 'a')
            N = nodi[n]
            k = N['coppia'][i]
            if k is None or N['giro'][i] != 1:
                return seq, (n, i)
            c = N['capi'][k]
            if c['r'] in fatto:
                return seq, (n, i)
            fatto.add(c['r'])
            r, fwd = c['r'], c['at'] == 'a'
            seq.append((r, fwd))

    for r0 in range(len(rami)):
        if r0 in fatto:
            continue
        fatto.add(r0)
        dopo, fine = avanza(r0, True)
        prima, inizio = avanza(r0, False)
        seq = [(r, not f) for r, f in reversed(prima)] + [(r0, True)] + dopo
        out.append({'rami': seq, 'inizio': inizio, 'fine': fine})
    return out


def traccia(catena, rami):
    P = []
    for r, fwd in catena['rami']:
        Q = rami[r]['pts'] if fwd else rami[r]['pts'][::-1]
        P += Q if not P else Q[1:]
    return P


def stendi_deposito(binari, xz, ll):
    """Le way di un deposito (punti lat, lon) stese secondo la regola: le stesse way coi punti nuovi, e (nodi, rami,
    catene, posizione dei nodi) per chi vuole guardarci dentro."""
    ways = [{'b': b, 'pts': [xz(*p) for p in b['punti']]} for b in binari]
    nodi, rami = grafo(ways)
    coppie(nodi)
    C = catene(nodi, rami)
    dove = {}                      # ramo -> catena
    for ci, c in enumerate(C):
        for r, _ in c['rami']:
            dove[r] = ci

    def ospite(n, i):
        """Catena che porta lo scambio dove finisce il capo i del nodo n, o None (capo libero)."""
        N = nodi[n]
        if len(N['capi']) == 1:
            return None
        k = N['coppia'][i]
        if k is not None and N['giro'][i] == 2:
            # tocca un binario: quello delle coppie del primo giro
            k = next(j for j in range(len(N['capi'])) if N['giro'][j] == 1)
            return dove[N['capi'][k]['r']], 'tocca'
        c = [j for j in range(len(N['capi'])) if j != i and ts.dot(N['capi'][i]['out'], N['capi'][j]['out']) < DRITTO]
        if not c:
            return None
        j = min(c, key=lambda j: ts.dot(N['capi'][i]['out'], N['capi'][j]['out']))
        return dove[N['capi'][j]['r']], 'scambio'

    for c in C:
        c['dip'] = [o for o in (ospite(*c['inizio']), ospite(*c['fine'])) if o]
    # ordine: prima le catene su cui si attaccano le altre
    ordine, fatte = [], set()
    while len(ordine) < len(C):
        pronte = [ci for ci in range(len(C)) if ci not in fatte and all(o in fatte or o == ci for o, _ in C[ci]['dip'])]
        if not pronte:
            # un giro (A su B e B su A): la più lunga prima
            pronte = [max((ci for ci in range(len(C)) if ci not in fatte), key=lambda ci: ts.lunghezza(traccia(C[ci], rami)))]
        ci = max(pronte, key=lambda ci: ts.lunghezza(traccia(C[ci], rami)))
        ordine.append(ci)
        fatte.add(ci)

    # due passate: nella prima una catena che si attacca a una non ancora stesa (un giro: A su B, B su C, C su A) la
    # prende com'è in OSM; nella seconda tutte si ristendono sulle altre già stese
    stese = {}
    for _ in range(2):
        pos = {}                   # posizione dei nodi spostati: le punte degli scambi, i nodi dove due binari si toccano
        for ci in ordine:
            c = C[ci]
            Q = traccia(c, rami)
            vincoli = []
            for n, i in (c['inizio'], c['fine']):
                o = ospite(n, i)
                if o is None:
                    vincoli.append(None)
                    continue
                H, tipo = stese.get(o[0]) or Polilinea(traccia(C[o[0]], rami)), o[1]
                s, p, d = H.proietta(nodi[n]['p'])
                out = nodi[n]['capi'][i]['out']          # dal nodo verso il binario da stendere
                sv = 1
                if ts.dot(d, out) < 0:
                    d, sv = ts.mul(d, -1), -1
                if tipo == 'tocca':
                    da = 0.0
                else:
                    # la punta arretra (verso -d, lontano dal ramo deviato) fino al nodo prima sul binario che porta lo
                    # scambio, a metà se anche quello è uno scambio; e resta sul rettilineo
                    da = indietro(n, s, -sv, H, C[o[0]], rami, nodi)
                vincoli.append({'p': p, 'd': d, 'da': -da, 'a': 0.0, 'n': n, 'H': H})
            ini, fin = vincoli
            if fin:
                # alla fine il binario arriva sul nodo: d nel verso della catena, il capo può avanzare
                fin = dict(fin, d=ts.mul(fin['d'], -1), a=-fin['da'], da=0.0)
            P = ts.stendi(Q, ini and {k: ini[k] for k in ('p', 'd', 'da', 'a')}, fin and {k: fin[k] for k in ('p', 'd', 'da', 'a')})
            if ini:
                P[0] = ini['H'].proietta(P[0])[1]
                pos[ini['n']] = P[0]
            if fin:
                P[-1] = fin['H'].proietta(P[-1])[1]
                pos[fin['n']] = P[-1]
            stese[ci] = Polilinea(P)
            c['stesa'] = P
    # ogni ramo è il pezzo della sua catena stesa tra i suoi due nodi (spostati, negli scambi, nella punta)
    for ci, c in enumerate(C):
        H = stese[ci]
        for r, fwd in c['rami']:
            R = rami[r]
            ends = []
            for m in (R['a'], R['b']):
                if m not in pos:
                    pos[m] = H.proietta(nodi[m]['p'])[1]
                ends.append(pos[m])
            s0, s1 = H.proietta(ends[0])[0], H.proietta(ends[1])[0]
            # capi della catena: il primo e l'ultimo punto
            if r == c['rami'][0][0]:
                if fwd: s0 = 0.0
                else: s1 = 0.0
            if r == c['rami'][-1][0]:
                if fwd: s1 = H.len
                else: s0 = H.len
            P = H.pezzo(min(s0, s1), max(s0, s1))
            if s0 > s1:
                P = P[::-1]
            P[0], P[-1] = ends
            R['stesa'] = P
    out = []
    for wi, w in enumerate(ways):
        P = []
        for R in rami:
            if R['w'] == wi:
                P += R['stesa'] if not P else R['stesa'][1:]
        out.append({**w['b'], 'punti': [ll(*p) for p in P]})
    return out, (nodi, rami, C, pos)


def indietro(n, s, verso, H, catena, rami, nodi):
    """Quanti metri la punta dello scambio del nodo n (a s sulla catena stesa H) può arretrare nel verso `verso`."""
    # i nodi della catena con la loro s
    ss = []
    for r, _ in catena['rami']:
        for m in (rami[r]['a'], rami[r]['b']):
            ss.append((H.proietta(nodi[m]['p'])[0], m))
    davanti = [(abs(s2 - s), m) for s2, m in ss if (s2 - s) * verso > 0.05 and m != n]
    lim = min([d for d, _ in davanti], default=H.len) - MARGINE
    if davanti:
        d, m = min(davanti)
        if len(nodi[m]['capi']) >= 3:
            lim = min(lim, d / 2 - 0.25)
    lim = min(lim, H.dritto(s, verso, 30.0))
    return max(0.0, lim)


def main(sir1, cantiere, out):
    M = json.load(open(os.path.join(RADICE, 'src/data/padova-map.json')))
    xz, ll = proiezione(M['origin'])
    fonti = [json.load(open(sir1))['elements'], json.load(open(cantiere))['elements']]
    res = {'fonti': 'OpenStreetMap (© OpenStreetMap contributors, ODbL): export Overpass dei binari del tram '
                    '(data/osm-padova-tram.json, data/osm-padova-tram-cantiere.json).', 'depositi': []}
    for D in DEPOSITI:
        la0, lo0 = D['centro']
        k = math.cos(math.radians(la0)) * 111320
        dentro = lambda p: math.hypot((p['lon'] - lo0) * k, (p['lat'] - la0) * 110540) < D['r']
        binari = []
        for e in fonti[D['fonte']]:
            t = e.get('tags', {})
            if e['type'] != 'way' or t.get('railway') != 'tram':
                continue
            # tratti consecutivi dentro il cerchio
            run = []
            for p in e['geometry'] + [None]:
                if p is not None and dentro(p):
                    run.append([round(p['lat'], 7), round(p['lon'], 7)])
                    continue
                if len(run) > 1:
                    binari.append({'id': e['id'], 'servizio': t.get('service', 'linea'), 'galleria': t.get('tunnel'), 'punti': run})
                run = []
        stesi, (nodi, rami, C, pos) = stendi_deposito(binari, xz, ll)
        res['depositi'].append({'nome': D['nome'], 'linea': D['linea'], 'binari': stesi})
        print(f"{D['nome']}: {len(binari)} binari, "
              + ', '.join(f"{s} {sum(b['servizio'] == s for b in binari)}" for s in sorted({b['servizio'] for b in binari}))
              + f"; {len(C)} binari continui, {sum(ts.norm(ts.sub(pos[n], N['p'])) > 0.05 for n, N in enumerate(nodi))} nodi"
              f" spostati, {sum(len(b['punti']) for b in stesi)} punti")
    json.dump(res, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main(*sys.argv[1:4])
