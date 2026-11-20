#!/usr/bin/env python3
"""Riduce gli export Overpass di scripts/overpass-comuni.ql e scripts/overpass-strade-fuori.ql a quello che serve alla
domanda di traffico per le porte (#147, scripts/pendolari.py).

Uso:
    python3 scripts/filter_osm_fuori.py <export comuni.json> <export strade.json> data/osm-comuni.json data/osm-strade-fuori.json

data/osm-comuni.json, un comune per riga: [codice ISTAT, nome, lat, lon, centro]. Il punto è il nodo del centro abitato
(ruolo admin_centre del confine, centro 1) o, dove manca, il centro del riquadro del confine (centro 0).

data/osm-strade-fuori.json, una via per riga: [classe, rampa, senso, lat, lon, dlat, dlon, ...]. Classe è l'indice in
"classi" (motorway, trunk, primary, secondary, tertiary), rampa 1 per i _link, senso 0 nei due versi, 1 solo nel verso
dei punti, 2 solo nel verso opposto (oneway=-1). Le coordinate sono interi in milionesimi di grado (11 cm): il primo
punto intero, gli altri come differenza dal precedente. Le vie sono in ordine di id OSM, quelle con almeno un punto entro
RAGGIO metri dal centro di Padova; senza le vie chiuse alle auto (access o motor_vehicle no o private) e le aree.

Dati © OpenStreetMap contributors (ODbL).
"""
import json
import sys

CLASSI = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']
# entro 20 km dal centro di Padova abita il 78% dei pendolari in auto verso la città (ISTAT 2011): chi sta più lontano si
# aggancia al bordo (scripts/pendolari.py)
CENTRO, RAGGIO = (45.4075, 11.8775), 20000.0
M_PER_LAT, M_PER_LON = 111130, 78153.30172146406
SI = ('yes', 'true', '1')


def comuni(export):
    E = json.load(open(export, encoding='utf-8'))['elements']
    nodi = {e['id']: e for e in E if e['type'] == 'node'}
    out = []
    for e in E:
        if e['type'] != 'relation' or 'ref:ISTAT' not in e.get('tags', {}):
            continue
        ac = [m['ref'] for m in e.get('members', []) if m['type'] == 'node' and m['role'] == 'admin_centre']
        n = nodi.get(ac[0]) if ac else None
        lat, lon, centro = (n['lat'], n['lon'], 1) if n else (e['center']['lat'], e['center']['lon'], 0)
        out.append([int(e['tags']['ref:ISTAT']), e['tags'].get('name', ''), round(lat, 7), round(lon, 7), centro])
    return sorted(out)


def senso(t):
    ow = t.get('oneway', '')
    if ow in SI:
        return 1
    if ow in ('-1', 'reverse'):
        return 2
    implicito = t['highway'].startswith('motorway') or t.get('junction') in ('roundabout', 'circular')
    return 1 if implicito and ow != 'no' else 0


def strade(export):
    E = json.load(open(export, encoding='utf-8'))['elements']
    out = []
    for e in sorted(E, key=lambda e: e['id']):
        t = e.get('tags', {})
        if e['type'] != 'way' or t.get('area') == 'yes' or len(e.get('geometry', ())) < 2:
            continue
        if t.get('access') in ('no', 'private') or t.get('motor_vehicle') in ('no', 'private'):
            continue
        h = t['highway']
        base = h[:-5] if h.endswith('_link') else h
        if base not in CLASSI:
            continue
        g = e['geometry']
        if min((p['lat'] - CENTRO[0]) ** 2 * M_PER_LAT ** 2 + (p['lon'] - CENTRO[1]) ** 2 * M_PER_LON ** 2 for p in g) > RAGGIO ** 2:
            continue
        riga = [CLASSI.index(base), 1 if h.endswith('_link') else 0, senso(t)]
        plat = plon = None
        for p in g:
            lat, lon = round(p['lat'] * 1e6), round(p['lon'] * 1e6)
            riga += [lat, lon] if plat is None else [lat - plat, lon - plon]
            plat, plon = lat, lon
        out.append(riga)
    return out


def scrivi(path, testa, chiave, righe):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(testa, ensure_ascii=False)[:-1] + f', "{chiave}": [\n')
        f.write(',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in righe))
        f.write('\n]}\n')


def main():
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    ec, es, oc, os_ = sys.argv[1:]
    C = comuni(ec)
    scrivi(oc, {'fonte': '© OpenStreetMap contributors (ODbL): confini comunali (admin_level 8) con ref:ISTAT e nodo '
                          'admin_centre; scripts/overpass-comuni.ql, scripts/filter_osm_fuori.py',
                'campi': ['codice ISTAT', 'nome', 'lat', 'lon', 'centro abitato (1) o del riquadro (0)']}, 'comuni', C)
    S = strade(es)
    scrivi(os_, {'fonte': '© OpenStreetMap contributors (ODbL): strade da tertiary in su con le rampe; '
                          'scripts/overpass-strade-fuori.ql, scripts/filter_osm_fuori.py',
                 'classi': CLASSI,
                 'campi': ['classe', 'rampa', 'senso (0 due versi, 1 verso dei punti, 2 opposto)',
                           'lat e lon del primo punto in 1e-6 gradi, poi le differenze']}, 'vie', S)
    print(f'{oc}: {len(C)} comuni ({sum(1 for c in C if c[4])} col centro abitato); {os_}: {len(S)} vie, '
          f'{sum((len(r) - 3) // 2 for r in S)} punti')


if __name__ == '__main__':
    main()
