"""Prova: percorso di una linea tram sui binari OSM, passando per le fermate ufficiali (KML) in ordine.

Grafo dei binari `railway=tram` e dei binari in cantiere (`railway=construction` + `construction=tram`), con i sensi
unici rispettati e niente curve oltre 60° ai nodi; Dijkstra su stati (arco, fermate già toccate).
Ogni fermata del KML si aggancia alle fermate OSM vicine con lo stesso nome (`railway=tram_stop`, una per verso, sul
binario); se non ce ne sono, ai nodi dei binari entro 30 m (prima quelli della linea). Le fermate che iniziano con "*"
(capolinea intermedi sui rami) si saltano.
Marcia a destra: dove due binari corrono affiancati (2-6 m), quello con l'altro binario a destra costa il triplo; la
lunghezza percorsa contromano esce nel risultato, come quella su binari ancora in cantiere.
Nel file di uscita: il percorso (lat, lon) e le fermate OSM che ci stanno sopra, in ordine, con la progressiva in metri.

Sperimentale, non usato da build_map.py (vedi docs/linee-tram-nuove.md).
Uso: python3 scripts/tram_percorsi.py <export-overpass.json> <linea.kml> <LINEA> <prima fermata> <ultima fermata> <uscita.json> [fermate da saltare]
L'export: scripts/overpass-tram-cantiere.ql (data/osm-padova-tram-cantiere.json); va anche data/osm-padova-tram.json,
senza binari in cantiere né fermate.
I KML: https://www.trampadova.it/wp-content/themes/hello-theme-child-master/assets/SIR3.kml (e SIR2.kml).
"""
import json, math, heapq, re, sys
from collections import defaultdict

K = 111320; COS = math.cos(math.radians(45.4))
P = lambda la, lo: (lo * K * COS, la * K)
# nel KML del SIR3 la fermata Pace è oltre il bivio, sui binari del SIR2: vale quella sul tratto comune
OVERRIDE = {('SIR3', 'Pace'): (45.41542, 11.88308)}
STOP_NEAR = 300  # m: fermata OSM con lo stesso nome della fermata KML
ON_PATH = 8      # m: fermata OSM che sta sul percorso


def line_of(t):
    n = (t.get('name') or '') + (t.get('ref') or '')
    return 'SIR1' if 'SIR1' in n else 'SIR2' if '2' in n else 'SIR3' if '3' in n else '?'


def norm(s):
    s = s.lower().replace('fermata', '').replace('capolinea', '').replace('via ', '').replace('v.le ', '')
    # "stazione": le fermate nuove dentro l'anello non sono in OSM, "Stazione FS" è quella del SIR1 fuori dall'anello
    return set(w for w in re.findall(r'[a-zà-ù]+', s) if len(w) > 2 and w not in ('san', 'del', 'della', 'di', 'de', 'stazione'))


def load(osm, kml, LINE):
    adj, pos, own, cons, osm_stops = defaultdict(set), {}, defaultdict(set), set(), []
    for e in json.load(open(osm))['elements']:
        t = e.get('tags', {})
        if e['type'] == 'node':
            if t.get('name') and (t.get('railway') == 'tram_stop' or t.get('tram') == 'yes'):
                osm_stops.append((t['name'], (e['lat'], e['lon']), P(e['lat'], e['lon'])))
            continue
        building = t.get('railway') == 'construction' and t.get('construction') == 'tram'
        if e['type'] != 'way' or not (t.get('railway') == 'tram' or building):
            continue
        g = [(round(p['lat'], 7), round(p['lon'], 7)) for p in e['geometry']]
        ow = t.get('oneway') == 'yes'
        for a in g:
            pos[a] = P(*a); own[a].add(line_of(t))
        for a, b in zip(g, g[1:]):
            if a != b:
                adj[a].add(b)
                if not ow:
                    adj[b].add(a)
                if building:
                    cons |= {(a, b), (b, a)}
    stops = []
    for pm in re.findall(r'(?s)<Placemark>(.*?)</Placemark>', open(kml, encoding='utf-8').read()):
        if '<Point' not in pm:
            continue
        n = re.sub(r'\s+', ' ', re.search(r'<name>(.*?)</name>', pm).group(1).replace('Fermata', '')).strip()
        lo, la = map(float, re.search(r'(?s)<coordinates>(.*?)</coordinates>', pm).group(1).strip().split(',')[:2])
        la, lo = OVERRIDE.get((LINE, n), (la, lo))
        stops.append((n, P(la, lo)))
    return adj, pos, own, cons, osm_stops, stops


def right_hand(adj, pos, cell=10):
    segs = {(a, b) for a in adj for b in adj[a]}
    grid = defaultdict(list)
    for a, b in segs:
        (ax, ay), (bx, by) = pos[a], pos[b]
        for gx in range(int(min(ax, bx) // cell) - 1, int(max(ax, bx) // cell) + 2):
            for gy in range(int(min(ay, by) // cell) - 1, int(max(ay, by) // cell) + 2):
                grid[(gx, gy)].append((a, b))
    bad = set()
    for a, b in segs:
        (ax, ay), (bx, by) = pos[a], pos[b]
        L = math.hypot(bx - ax, by - ay)
        if L < 0.5:
            continue
        dx, dy = (bx - ax) / L, (by - ay) / L
        mx, my = (ax + bx) / 2, (ay + by) / 2
        for c, d in grid[(int(mx // cell), int(my // cell))]:
            if {c, d} & {a, b}:
                continue
            (cx, cy), (ex, ey) = pos[c], pos[d]
            l2 = math.hypot(ex - cx, ey - cy)
            if l2 < 0.5 or abs((ex - cx) * dx + (ey - cy) * dy) / l2 < 0.95:
                continue  # non parallelo
            t = max(0, min(1, ((mx - cx) * (ex - cx) + (my - cy) * (ey - cy)) / l2 ** 2))
            px, py = cx + (ex - cx) * t - mx, cy + (ey - cy) * t - my
            side = dx * py - dy * px  # >0 a sinistra
            if 2 < math.hypot(px, py) < 6 and side < 0:
                bad.add((a, b)); break
    # binari in mezzo ad altri due (tratti comuni a più linee, scambi): nessun vincolo
    return {e for e in bad if (e[1], e[0]) not in bad}


def waypoints(pos, own, osm_stops, stops, LINE, R=30):
    def near(p, r):
        mine = [n for n in pos if math.dist(pos[n], p) < r and LINE in own[n]]
        if mine:
            return mine
        anyn = [n for n in pos if math.dist(pos[n], p) < r]
        return anyn or (near(p, r * 2) if r < 120 else [])

    W, how = [], []
    for n, p in stops:
        same = [s for s in osm_stops if math.dist(s[2], p) < STOP_NEAR and norm(s[0]) & norm(n)]
        cand = [m for s in same for m in pos if math.dist(pos[m], s[2]) < 10]
        W.append(set(cand or near(p, R)))
        how.append(same[0][0] if cand else None)
    return W, how


def route(adj, pos, W, bad=None):
    def ang(a, b, c):
        v1 = (pos[b][0] - pos[a][0], pos[b][1] - pos[a][1]); v2 = (pos[c][0] - pos[b][0], pos[c][1] - pos[b][1])
        l = math.hypot(*v1) * math.hypot(*v2) or 1
        return math.degrees(math.acos(max(-1, min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / l))))

    dist, prev, pq = {}, {}, []
    for n in W[0]:
        for m in adj[n]:
            st = (n, m, 1 if m not in W[1] else 2)
            c = math.dist(pos[n], pos[m]); dist[st] = c; prev[st] = None; heapq.heappush(pq, (c, st))
    goal = None
    while pq:
        c, st = heapq.heappop(pq)
        if c > dist.get(st, 1e18):
            continue
        a, b, k = st
        if k == len(W):
            goal = st; break
        for m in adj[b]:
            if m == a or ang(a, b, m) > 60:
                continue
            k2 = k + 1 if m in W[k] else k
            ns = (b, m, k2); nc = c + math.dist(pos[b], pos[m]) * (3 if bad and (b, m) in bad else 1)
            if nc < dist.get(ns, 1e18):
                dist[ns] = nc; prev[ns] = st; heapq.heappush(pq, (nc, ns))
    if not goal:
        return None, max((s[2] for s in dist), default=1)
    path, st = [], goal
    while st:
        path.append(st[1]); last = st; st = prev[st]
    path.append(last[0]); path.reverse()
    return path, None


def stops_on(path, pos, osm_stops):
    """Fermate OSM sul percorso, in ordine, con la progressiva (una per nome: la prima che si incontra)."""
    cum = [0.0]
    for a, b in zip(path, path[1:]):
        cum.append(cum[-1] + math.dist(pos[a], pos[b]))
    out = []
    for name, ll, p in osm_stops:
        best = None
        for i, (a, b) in enumerate(zip(path, path[1:])):
            (ax, ay), (bx, by) = pos[a], pos[b]
            L2 = (bx - ax) ** 2 + (by - ay) ** 2 or 1e-9
            t = max(0, min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L2))
            d = math.hypot(ax + (bx - ax) * t - p[0], ay + (by - ay) * t - p[1])
            if d < ON_PATH and (best is None or d < best[0]):
                best = (d, cum[i] + t * math.sqrt(L2))
        if best:
            out.append((round(best[1]), name, ll))
    out.sort()
    seen, res = set(), []
    for s, name, ll in out:
        if name not in seen:
            seen.add(name); res.append({'s': s, 'name': name, 'lat': ll[0], 'lon': ll[1]})
    return res


if __name__ == '__main__':
    osm, kml, LINE, a, b, out = sys.argv[1:7]
    adj, pos, own, cons, osm_stops, stops = load(osm, kml, LINE)
    names = [s[0] for s in stops]
    i, j = names.index(a), names.index(b)
    sub = stops[i:j + 1] if i <= j else stops[j:i + 1][::-1]
    skip = sys.argv[7].split(',') if len(sys.argv) > 7 else []
    sub = [s for s in sub if s[0] not in skip and not s[0].startswith('*')]
    W, how = waypoints(pos, own, osm_stops, sub, LINE)
    bad = right_hand(adj, pos)
    path, k = route(adj, pos, W, bad)
    if not path:
        print(LINE, a, '->', b, 'bloccato tra', sub[k - 1][0], '->', sub[k][0])
        sys.exit(1)
    E = list(zip(path, path[1:]))
    L = sum(math.dist(pos[x], pos[y]) for x, y in E)
    wrong = sum(math.dist(pos[x], pos[y]) for x, y in E if (x, y) in bad)
    building = sum(math.dist(pos[x], pos[y]) for x, y in E if (x, y) in cons)
    st = stops_on(path, pos, osm_stops)
    print(f'{LINE} {a} -> {b}: {L:.0f} m, contromano {wrong:.0f} m, in cantiere {building:.0f} m, '
          f'fermate KML agganciate a OSM {sum(1 for h in how if h)}/{len(how)}, fermate OSM sul percorso {len(st)}')
    json.dump({'line': LINE, 'from': a, 'to': b, 'length': round(L), 'path': [list(n) for n in path], 'stops': st},
              open(out, 'w'), ensure_ascii=False)
