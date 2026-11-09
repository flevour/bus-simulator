"""Prova: percorso di una linea tram sui binari OSM, passando per le fermate (KML ufficiale) in ordine.

Grafo dei binari railway=tram (sensi unici rispettati, niente curve oltre 60° ai nodi), Dijkstra su stati
(arco, fermate già toccate). Ogni fermata vale come l'insieme dei nodi entro 30 m (prima quelli della linea).
Marcia a destra: dove due binari corrono affiancati (2-6 m), quello con l'altro binario a destra costa il triplo;
la lunghezza percorsa contromano esce nel risultato.
Sperimentale, non usato da build_map.py (vedi docs/linee-tram-nuove.md).
Uso: python3 scripts/tram_percorsi.py <osm-tram.json> <linea.kml> <LINEA> <prima fermata> <ultima fermata> <uscita.json> [fermate da saltare]
I KML: https://www.trampadova.it/wp-content/themes/hello-theme-child-master/assets/SIR3.kml (e SIR2.kml).
"""
import json, math, heapq, re, sys
from collections import defaultdict

K = 111320; COS = math.cos(math.radians(45.4))
P = lambda la, lo: (lo * K * COS, la * K)
OVERRIDE = {('SIR3', 'Pace'): (45.41542, 11.88308)}  # nel KML del SIR3 la fermata Pace è oltre il bivio, sul SIR2


def line_of(t):
    n = (t.get('name') or '') + (t.get('ref') or '')
    return 'SIR1' if 'SIR1' in n else 'SIR2' if '2' in n else 'SIR3' if '3' in n else '?'


def load(osm, kml, LINE):
    adj, pos, own = defaultdict(set), {}, defaultdict(set)
    for e in json.load(open(osm))['elements']:
        if e['tags'].get('railway') != 'tram':
            continue
        g = [(round(p['lat'], 7), round(p['lon'], 7)) for p in e['geometry']]
        ow = e['tags'].get('oneway') == 'yes'
        for a in g:
            pos[a] = P(*a); own[a].add(line_of(e['tags']))
        for a, b in zip(g, g[1:]):
            if a != b:
                adj[a].add(b)
                if not ow:
                    adj[b].add(a)
    stops = []
    for pm in re.findall(r'(?s)<Placemark>(.*?)</Placemark>', open(kml, encoding='utf-8').read()):
        if '<Point' not in pm:
            continue
        n = re.search(r'<name>(.*?)</name>', pm).group(1).replace('Fermata', '').strip()
        lo, la = map(float, re.search(r'(?s)<coordinates>(.*?)</coordinates>', pm).group(1).strip().split(',')[:2])
        la, lo = OVERRIDE.get((LINE, n), (la, lo))
        stops.append((n, P(la, lo)))
    return adj, pos, own, stops


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


def route(adj, pos, own, stops, LINE, R=30, bad=None):
    def ang(a, b, c):
        v1 = (pos[b][0] - pos[a][0], pos[b][1] - pos[a][1]); v2 = (pos[c][0] - pos[b][0], pos[c][1] - pos[b][1])
        l = math.hypot(*v1) * math.hypot(*v2) or 1
        return math.degrees(math.acos(max(-1, min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / l))))

    def near(p, r):
        mine = [n for n in pos if math.dist(pos[n], p) < r and LINE in own[n]]
        if mine:
            return mine
        anyn = [n for n in pos if math.dist(pos[n], p) < r]
        return anyn or (near(p, r * 2) if r < 120 else [])

    W = []
    for i, (n, p) in enumerate(stops):
        o = stops[max(0, i - 1)][1]; q = stops[min(len(stops) - 1, i + 1)][1]
        hx, hy = q[0] - o[0], q[1] - o[1]
        cand = near(p, R)
        W.append(set(cand))
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
        best = max(dist, key=lambda s: s[2])
        return None, stops[best[2] - 1][0] + ' -> ' + stops[best[2]][0]
    path, st = [], goal
    while st:
        path.append(st[1]); last = st; st = prev[st]
    path.append(last[0]); path.reverse()
    L = sum(math.dist(pos[a], pos[b]) for a, b in zip(path, path[1:]))
    wrong = sum(math.dist(pos[a], pos[b]) for a, b in zip(path, path[1:]) if bad and (a, b) in bad)
    return [pos[n] for n in path], f'{L:.0f} (contromano {wrong:.0f} m)'


if __name__ == '__main__':
    osm, kml, LINE, a, b, out = sys.argv[1:7]
    adj, pos, own, stops = load(osm, kml, LINE)
    names = [s[0] for s in stops]
    i, j = names.index(a), names.index(b)
    sub = stops[i:j + 1] if i <= j else stops[j:i + 1][::-1]
    skip = sys.argv[7].split(',') if len(sys.argv) > 7 else []
    sub = [s for s in sub if s[0] not in skip]
    pts, info = route(adj, pos, own, sub, LINE, bad=right_hand(adj, pos))
    print(LINE, a, '->', b, 'metri' if pts else 'bloccato tra', info)
    if pts:
        json.dump(pts, open(out, 'w'))
