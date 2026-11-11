"""Linee del tram in costruzione (SIR3, SIR2): percorso sui binari OSM per linea e verso, fermate in ordine con la
progressiva, numero di moduli e orario generato. Scrive data/tram-linee-nuove.json (tappa 1 di docs/linee-tram-nuove.md).

Si appoggia a scripts/tram_percorsi.py (grafo dei binari, instradamento per fermate, marcia a destra) con in più:
* l'anello interno della stazione percorso in senso antiorario, come quello esterno: le way dell'anello e i quattro
  raccordi tra i due anelli (in OSM `service=siding`, senza senso unico) diventano a senso unico;
* le fermate che OSM non ha (Stazione nord e Stazione sud sui lati lunghi dell'anello interno, con la banchina dentro
  l'anello, a sinistra; De Gasperi sul Corso del Popolo dove c'era Trieste): un nodo nuovo sul binario, che il percorso
  deve toccare;
* i tratti di binario prima della prima fermata e dopo l'ultima (ci sta il convoglio, si cambia cabina);
* in stazione i binari sugli anelli regolari e concentrici del piazzale nuovo (scripts/tram_stazione.py), al posto
  delle S e degli intrecci dei binari OSM;
* l'orario: frequenza per fascia oraria e tempi tra le fermate dalla velocità commerciale.

SIR2 e SIR3 passano dall'anello interno, il SIR1 resta su quello esterno: il SIR3 gira tutto l'anello (arriva a Stazione
nord, riparte da Stazione sud), il SIR2 verso est prende Stazione sud e verso ovest Stazione nord.

Uso: python3 scripts/tram_linee.py data/osm-padova-tram-cantiere.json data/tram-fermate-nuove.json data/tram-linee-nuove.json
"""
import json, math, sys
from collections import defaultdict

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import tram_percorsi as tp
import tram_stazione

# anello interno e raccordi tra i due anelli della stazione: verso di percorrenza rispetto all'ordine dei nodi della
# way (+1 come la way, -1 al contrario). Senso antiorario: verso est sul lato sud, verso ovest sul lato nord
ONEWAY = {
    1332833374: -1, 966705987: -1, 966705990: -1,  # anello interno
    966705988: 1,    # lato sud, dall'esterno all'interno (ovest)
    1444534169: -1,  # lato sud, dall'interno all'esterno (est)
    1414900265: -1,  # lato nord, dall'esterno all'interno (est)
    1414900266: 1,   # lato nord, dall'interno all'esterno (ovest)
    1454097058: 1,   # dall'anello verso Pace
}
# fermate che OSM non ha: posizione e way su cui stanno
MANUAL = {
    'Stazione nord': ((45.416933, 11.880443), [1332833374]),  # lato nord dell'anello interno
    'Stazione sud': ((45.416695, 11.880405), [966705987]),    # lato sud dell'anello interno
    'De Gasperi': ((45.414205, 11.878987), [966705981, 966705984]),  # al posto di Trieste (KML del SIR2)
}
# fermate con la banchina a sinistra del verso di marcia: in stazione le banchine stanno dentro l'anello interno
LEFT = {'Stazione nord', 'Stazione sud'}
# fermate spostate lungo il binario, in metri nel verso di marcia: (linea, verso, fermata). A Voltabarozzo la fermata
# d'arrivo di OSM sta sulla curva d'ingresso al capolinea (raggio 24-58 m fino a 112 m dalla fine del binario): con il
# muso a fine banchina metà tram restava in curva (segnalazione dell'11 novembre). 33 m più avanti tram e banchina stanno
# sul dritto, e oltre resta il binario tronco per lo scambio e il cambio cabina
SPOSTA = {('SIR3', 'Voltabarozzo', 'Voltabarozzo'): 33}
# corse per linea e verso: le fermate del KML in ordine (quelle con "*" sono i capolinea intermedi dei rami, saltati)
KML_SKIP = {'Trieste', 'Stazione nord', 'Stazione sud'}
LINES = [
    {'id': 'SIR3', 'nome': 'Stazione ↔ Voltabarozzo', 'colore': '#e65100', 'moduli': 3, 'durata': 18 * 60, 'ogni': 8, 'anello': True,
     'versi': [
         ('Voltabarozzo', lambda k: ['Stazione sud'] + k),
         ('Stazione', lambda k: k[::-1] + ['Stazione nord', 'Stazione sud']),
     ]},
    {'id': 'SIR2', 'nome': 'Rubano ↔ Busa di Vigonza', 'colore': '#0097a7', 'moduli': 4, 'kmh': 18, 'ogni': 7,
     'versi': [
         ('Busa di Vigonza', lambda k: ins(k, 'Eremitani', ['De Gasperi', 'Stazione sud'])),
         ('Rubano', lambda k: ins(k, 'Eremitani', ['De Gasperi', 'Stazione nord'])[::-1]),
     ]},
]
DWELL = 20      # s di sosta a ogni fermata intermedia
EXTEND = 120    # m di binario prima della prima fermata e dopo l'ultima


def ins(names, after, extra):
    i = names.index(after)
    return names[:i + 1] + extra + names[i + 1:]


def load(osm):
    """Grafo dei binari come tram_percorsi.load, con la way di ogni arco e i sensi unici dell'anello interno."""
    adj, pos, own, cons, osm_stops, way = defaultdict(set), {}, defaultdict(set), set(), [], {}
    for e in json.load(open(osm))['elements']:
        t = e.get('tags', {})
        if e['type'] == 'node':
            if t.get('name') and (t.get('railway') == 'tram_stop' or t.get('tram') == 'yes'):
                osm_stops.append((t['name'], (e['lat'], e['lon']), tp.P(e['lat'], e['lon'])))
            continue
        building = t.get('railway') == 'construction' and t.get('construction') == 'tram'
        if e['type'] != 'way' or not (t.get('railway') == 'tram' or building):
            continue
        g = [(round(p['lat'], 7), round(p['lon'], 7)) for p in e['geometry']]
        ow = ONEWAY.get(e['id'], 1 if t.get('oneway') == 'yes' else 0)
        if ow < 0:
            g = g[::-1]
        for a in g:
            pos[a] = tp.P(*a); own[a].add(tp.line_of(t))
        for a, b in zip(g, g[1:]):
            if a != b:
                adj[a].add(b); way[(a, b)] = e['id']
                if not ow:
                    adj[b].add(a); way[(b, a)] = e['id']
                if building:
                    cons |= {(a, b), (b, a)}
    return adj, pos, own, cons, osm_stops, way


def split_at(adj, pos, way, ll, ways):
    """Nodo nuovo sul binario delle way indicate, nel punto più vicino a ll (lat, lon): uno per binario."""
    p = tp.P(*ll)
    best = {}
    for (a, b), w in way.items():
        if w not in ways or b not in adj[a]:
            continue
        (ax, ay), (bx, by) = pos[a], pos[b]
        L2 = (bx - ax) ** 2 + (by - ay) ** 2 or 1e-9
        t = max(0.02, min(0.98, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L2))
        d = math.hypot(ax + (bx - ax) * t - p[0], ay + (by - ay) * t - p[1])
        key = (w, frozenset((a, b)))
        if key not in best or d < best[key][0]:
            best[key] = (d, a, b, t)
    # per ogni way l'arco più vicino (due versi dello stesso arco: un nodo solo)
    per_way = {}
    for (w, _), v in best.items():
        if w not in per_way or v[0] < per_way[w][0]:
            per_way[w] = v
    out = set()
    for w, (d, a, b, t) in per_way.items():
        if d > 15:
            continue
        lat = round(a[0] + (b[0] - a[0]) * t, 7); lon = round(a[1] + (b[1] - a[1]) * t, 7)
        n = (lat, lon)
        pos[n] = tp.P(*n)
        for x, y in ((a, b), (b, a)):
            if y in adj[x]:
                adj[x].discard(y); adj[x].add(n); adj[n].add(y)
                way[(x, n)] = way[(n, y)] = w
        out.add(n)
    return out


def extend(adj, pos, path, dist, back):
    """Binario oltre il primo (back) o l'ultimo nodo del percorso: si prosegue sul binario più dritto per dist metri."""
    rev = defaultdict(set)
    for a in adj:
        for b in adj[a]:
            rev[b].add(a)
    nxt = rev if back else adj
    pts = path[::-1] if back else path[:]
    got, seen = 0.0, set(pts)
    while got < dist:
        a, b = pts[-2], pts[-1]
        dx, dy = pos[b][0] - pos[a][0], pos[b][1] - pos[a][1]
        cand = []
        for c in nxt[b]:
            if c in seen:
                continue
            ex, ey = pos[c][0] - pos[b][0], pos[c][1] - pos[b][1]
            l = math.hypot(dx, dy) * math.hypot(ex, ey) or 1
            cand.append(((dx * ex + dy * ey) / l, c))
        cand = [x for x in cand if x[0] > 0.5]
        if not cand:
            break
        c = max(cand)[1]
        got += math.dist(pos[b], pos[c]); pts.append(c); seen.add(c)
    return pts[::-1] if back else pts


def stazione(staz, full, pos, first, last):
    """Percorso rifatto sugli anelli della stazione (tram_stazione): nodi (lat, lon) nuovi e progressive dei punti più
    vicini a first e last (il primo e l'ultimo nodo del percorso senza i tratti prima e dopo)."""
    new = [(round(la, 7), round(lo, 7)) for la, lo in tram_stazione.fix_ll(staz, full)]
    new = [n for k, n in enumerate(new) if not k or n != new[k - 1]]
    for n in new:
        pos.setdefault(n, tp.P(*n))
    cum = [0.0]
    for a, b in zip(new, new[1:]):
        cum.append(cum[-1] + math.dist(pos[a], pos[b]))

    def s_of(p, from_s=0.0):
        best = (1e18, from_s)
        for i, (a, b) in enumerate(zip(new, new[1:])):
            if cum[i + 1] < from_s:
                continue
            (ax, ay), (bx, by) = pos[a], pos[b]
            L2 = (bx - ax) ** 2 + (by - ay) ** 2 or 1e-9
            t = max(0, min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L2))
            d = math.hypot(ax + (bx - ax) * t - p[0], ay + (by - ay) * t - p[1])
            if d < best[0] - 1e-6:
                best = (d, cum[i] + t * math.sqrt(L2))
        return best[1]
    s0 = s_of(pos[first])
    return new, s0, s_of(pos[last], s0) - s0


def punto(path, pos, s):
    """(lat, lon) del percorso (nodi lat, lon) a s metri dall'inizio."""
    acc = 0.0
    for a, b in zip(path, path[1:]):
        l = math.dist(pos[a], pos[b])
        if acc + l >= s and l > 0:
            t = (s - acc) / l
            return round(a[0] + (b[0] - a[0]) * t, 7), round(a[1] + (b[1] - a[1]) * t, 7)
        acc += l
    return path[-1]


def headways(ogni):
    """Partenze (secondi dalla mezzanotte) per giorno: frequenza piena di giorno, meno la sera e di primo mattino."""
    bands = {
        'fer': [(5 * 3600 + 40 * 60, 7 * 3600, 15), (7 * 3600, 20 * 3600, ogni), (20 * 3600, 21 * 3600, 10), (21 * 3600, 23 * 3600 + 31 * 60, 15)],
        'fes': [(6 * 3600, 21 * 3600, 15), (21 * 3600, 23 * 3600 + 31 * 60, 30)],
    }
    out = {}
    for day, bb in bands.items():
        ts, t = [], bb[0][0]
        for a, b, h in bb:
            t = max(t, a)
            while t < b:
                ts.append(t); t += h * 60
        out[day] = ts
    return out


def main(osm, stops_json, out):
    adj, pos, own, cons, osm_stops, way = load(osm)
    staz = tram_stazione.Stazione.from_osm(osm)
    kml = json.load(open(stops_json))['kml']
    manual_nodes = {name: split_at(adj, pos, way, ll, ws) for name, (ll, ws) in MANUAL.items()}
    manual_stops = [(name, ll, tp.P(*ll)) for name, (ll, _) in MANUAL.items()]
    bad = tp.right_hand(adj, pos)
    # i binari a senso unico non si possono prendere contromano: nessun costo in più
    bad = {(a, b) for a, b in bad if a in adj[b]}
    res = {'fonti': {
        'binari': 'OpenStreetMap (© OpenStreetMap contributors, ODbL), export Overpass del 9/11/2026 '
                  '(data/osm-padova-tram-cantiere.json), anche i binari in cantiere.',
        'fermate': 'KML delle linee di trampadova.it (Comune di Padova) per l\'ordine, fermate railway=tram_stop di OSM per '
                   'la posizione; Stazione nord, Stazione sud e De Gasperi messe a mano (in OSM non ci sono).',
        'orario': 'Generato: SIR3 ogni 8 minuti e 18 minuti da capolinea a capolinea (trampadova.it, presentazione '
                  'APS-Comune del 2/12/2025); SIR2 ogni 7 minuti (6-8 nella presentazione), 18 km/h di velocità '
                  'commerciale come il SIR3. Mattino presto, sera e festivi meno frequenti, come il SIR1.',
        'anelli': 'SIR2 e SIR3 sull\'anello interno della stazione (senso antiorario, raccordi OSM), il SIR1 su quello esterno.',
    }, 'linee': []}
    for L in LINES:
        names = [n for n, *_ in kml[L['id']] if not n.startswith('*') and n not in KML_SKIP]
        ll = {n: (la, lo) for n, la, lo in kml[L['id']]}
        versi = []
        for headsign, order in L['versi']:
            seq = order(names)
            W, stops = [], []
            for n in seq:
                if n in manual_nodes:
                    W.append(manual_nodes[n])
                else:
                    la, lo = tp.OVERRIDE.get((L['id'], n), ll[n])
                    W.append(tp.waypoints(pos, own, osm_stops, [(n, tp.P(la, lo))], L['id'])[0][0])
            path, k = tp.route(adj, pos, W, bad)
            if not path:
                sys.exit(f'{L["id"]} verso {headsign}: bloccato tra {seq[k - 1]} e {seq[k]}')
            E = list(zip(path, path[1:]))
            Lp = sum(math.dist(pos[a], pos[b]) for a, b in E)
            wrong = sum(math.dist(pos[a], pos[b]) for a, b in E if (a, b) in bad)
            building = sum(math.dist(pos[a], pos[b]) for a, b in E if (a, b) in cons)
            # binario prima e dopo, per il convoglio fermo al capolinea e il cambio cabina
            full = extend(adj, pos, extend(adj, pos, path, EXTEND, True), EXTEND, False)
            full, s0, Lp = stazione(staz, full, pos, path[0], path[-1])
            # fermate sul percorso, quelle OSM e quelle messe a mano, in ordine. Il punto del KML al capolinea può
            # stare poco prima della fermata OSM (Voltabarozzo): oltre gli estremi conta solo la fermata del capolinea
            ends = (tp.norm(seq[0]), tp.norm(seq[-1]))
            st = [s for s in tp.stops_on(full, pos, osm_stops + manual_stops)
                  if s0 - 3 <= s['s'] <= s0 + Lp + 3 or (s['s'] < s0 and tp.norm(s['name']) & ends[0])
                  or (s['s'] > s0 + Lp and tp.norm(s['name']) & ends[1])]
            for s in st:
                d = SPOSTA.get((L['id'], headsign, s['name']))
                if d:
                    s['s'] += d
                    s['lat'], s['lon'] = punto(full, pos, s['s'])
            st = [{'nome': s['name'], 's': round(s['s']), 'lat': s['lat'], 'lon': s['lon'], 'osm': s['name'] not in MANUAL,
                   'lato': -1 if s['name'] in LEFT else 1} for s in st]
            versi.append({'headsign': headsign, 'lunghezza': round(Lp), 'contromano': round(wrong), 'cantiere': round(building),
                          'inizio': round(s0), 'percorso': [list(n) for n in full], 'fermate': st})
            print(f'{L["id"]} → {headsign}: {Lp:.0f} m (+{s0:.0f} m prima), contromano {wrong:.0f} m, in cantiere '
                  f'{building:.0f} m, {len(st)} fermate: {", ".join(s["nome"] for s in st)}')
        # orario: stessa durata nei due versi, fermata per fermata in proporzione alla distanza più la sosta
        for v in versi:
            fs = v['fermate']
            run = fs[-1]['s'] - fs[0]['s']
            D = L.get('durata') or round(run / (L['kmh'] / 3.6) / 60) * 60
            v_ms = run / (D - DWELL * (len(fs) - 2))
            v['offsets'] = [round((f['s'] - fs[0]['s']) / v_ms + DWELL * i) for i, f in enumerate(fs[:-1])] + [D]
            v['durata'] = D
        hw = headways(L['ogni'])
        for i, v in enumerate(versi):
            D = v['durata']
            for day in ('fer', 'fes'):
                if i and L.get('anello'):
                    # capolinea ad anello (SIR3 in stazione): ogni ritorno arriva un minuto prima di una partenza
                    # dell'andata e il tram riparte subito; la sosta lunga la fa all'altro capolinea, così non tiene
                    # occupata la banchina che usa anche il SIR2
                    v[day] = [[t - 60 - D, D] for t in hw[day]]
                else:
                    # il verso di ritorno parte metà frequenza dopo
                    v[day] = [[t + i * L['ogni'] * 30, D] for t in hw[day]]
        res['linee'].append({'id': L['id'], 'nome': L['nome'], 'colore': L['colore'], 'moduli': L['moduli'],
                             'stato': 'in costruzione', 'ogni': L['ogni'], 'versi': versi})
    json.dump(res, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main(*sys.argv[1:4])
