"""Binari dei depositi del tram da OSM: la Guizza dall'export del SIR1, Voltabarozzo da quello del cantiere del SIR3.
Per ogni deposito le way railway=tram con almeno un vertice entro r metri dal centro, tagliate al cerchio: i binari di
servizio (yard, siding, spur) e i pezzi dei binari di linea che ci portano, senza le comunicazioni (service=crossover:
quelle dei capolinea le fa TramTrack.terminal nel gioco). Il gioco ne fa il grafo dei binari del deposito (TramYard in
src/tram/tram.js) e lo attacca alla fine dei binari della linea; i pezzi che corrono accanto a quelli del gioco li
toglie lui.

Uso: python3 scripts/tram_depositi.py data/osm-padova-tram.json data/osm-padova-tram-cantiere.json data/tram-depositi.json
"""
import json, math, sys

# centro del deposito, raggio, export da cui prenderlo (0: SIR1, 1: cantiere)
DEPOSITI = [
    {'nome': 'Guizza', 'linea': 'SIR1', 'fonte': 0, 'centro': (45.3672, 11.8753), 'r': 230},
    {'nome': 'Voltabarozzo', 'linea': 'SIR3', 'fonte': 1, 'centro': (45.3748, 11.9076), 'r': 200},
]


def main(sir1, cantiere, out):
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
            if e['type'] != 'way' or t.get('railway') != 'tram' or t.get('service') == 'crossover':
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
        res['depositi'].append({'nome': D['nome'], 'linea': D['linea'], 'binari': binari})
        print(f"{D['nome']}: {len(binari)} binari, "
              + ', '.join(f"{s} {sum(b['servizio'] == s for b in binari)}" for s in sorted({b['servizio'] for b in binari})))
    json.dump(res, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main(*sys.argv[1:4])
