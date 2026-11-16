#!/usr/bin/env python3
"""Riduce gli export Overpass di scripts/overpass-luoghi.ql e scripts/overpass-arredo.ql a quello che serve ai ticket
della sosta (#111) e della domanda di traffico (#116).

Uso:
    python3 scripts/filter_osm_luoghi.py <export luoghi.json> <export arredo.json> data/osm-luoghi.json data/osm-arredo.json

data/osm-luoghi.json, un elemento per riga, in tre elenchi:
* "parcheggi": amenity=parking, parking_space e parking_entrance;
* "suolo": le aree landuse;
* "luoghi": scuole, università, ospedali (amenity) e negozi (shop).
Ogni elemento ha tipo e id OSM ("o": "w123"), i tag che servono ("t"), il centro ("c": [lat, lon]) e, per le aree,
i metri quadri ("m2") e il contorno ("p": [lat, lon, lat, lon, ...]; per le relazioni l'anello esterno più grande).

data/osm-arredo.json, un nodo per riga [id, lat, lon, ...]:
* "barriere": [id, lat, lon, tipo, access, motor_vehicle, bus]: dissuasori, sbarre, cancelli (barrier=*). L'id è quello
  del nodo OSM: una barriera in carreggiata è un nodo di una via degli scarichi;
* "lampioni": [id, lat, lon]; "alberi": [id, lat, lon].

Dati © OpenStreetMap contributors (ODbL).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_gtfs import xz  # noqa: E402

TAG = {
    'parcheggi': ('amenity', 'parking', 'access', 'capacity', 'fee', 'orientation', 'parking_space', 'name', 'operator:type',
                  'maxstay', 'capacity:disabled'),
    'suolo': ('landuse', 'name', 'residential', 'industrial'),
    'luoghi': ('amenity', 'shop', 'name', 'isced:level', 'capacity', 'opening_hours', 'healthcare', 'emergency'),
}
POSTI = ('school', 'kindergarten', 'university', 'college', 'hospital')


def tipo(t):
    if t.get('amenity') in ('parking', 'parking_space', 'parking_entrance'):
        return 'parcheggi'
    if 'landuse' in t:
        return 'suolo'
    if t.get('amenity') in POSTI or 'shop' in t:
        return 'luoghi'
    return None


def area(pts):
    """Metri quadri di un anello di punti (lat, lon)."""
    q = [xz(la, lo) for la, lo in pts]
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(q, q[1:] + q[:1]))) / 2


def anelli(pezzi):
    """Unisce per i capi i pezzi (liste di punti) dei membri esterni di una relazione in anelli chiusi."""
    pezzi, out = [list(p) for p in pezzi if len(p) > 1], []
    while pezzi:
        r = pezzi.pop()
        while r[0] != r[-1]:
            j = next((i for i, p in enumerate(pezzi) if p[0] == r[-1] or p[-1] == r[-1]), None)
            if j is None:
                break
            p = pezzi.pop(j)
            r += (p if p[0] == r[-1] else p[::-1])[1:]
        if r[0] == r[-1] and len(r) > 3:
            out.append(r)
    return out


def elemento(e, campi):
    t = e.get('tags', {})
    r = {'o': e['type'][0] + str(e['id']), 't': {k: t[k] for k in campi if k in t}}
    if e['type'] == 'node':
        r['c'] = [e['lat'], e['lon']]
        return r
    if e['type'] == 'way':
        ring = [(g['lat'], g['lon']) for g in e.get('geometry', [])]
        rings = [ring] if len(ring) > 3 and ring[0] == ring[-1] else []
    else:
        rings = anelli([[(g['lat'], g['lon']) for g in m.get('geometry', [])] for m in e['members']
                        if m['type'] == 'way' and m.get('role') in ('outer', '')])
    if not rings:
        b = e.get('bounds')
        if not b:
            return None
        r['c'] = [round((b['minlat'] + b['maxlat']) / 2, 7), round((b['minlon'] + b['maxlon']) / 2, 7)]
        return r
    ring = max(rings, key=area)[:-1]
    r['c'] = [round(sum(p[0] for p in ring) / len(ring), 7), round(sum(p[1] for p in ring) / len(ring), 7)]
    r['m2'] = round(sum(area(x[:-1]) for x in rings))
    r['p'] = [v for p in ring for v in p]
    return r


def scrivi(out, osm3s, elenchi):
    riga = lambda r: json.dumps(r, ensure_ascii=False, separators=(',', ':'))
    with open(out, 'w', encoding='utf-8') as f:
        f.write('{"osm3s":' + json.dumps(osm3s, ensure_ascii=False))
        for nome, righe in elenchi.items():
            f.write(',\n"' + nome + '":[\n' + ',\n'.join(riga(r) for r in righe) + '\n]')
        f.write('}\n')
    print(os.path.basename(out) + ': ' + ', '.join(f'{k} {len(v)}' for k, v in elenchi.items()))


def main(luoghi, arredo, out_luoghi, out_arredo):
    d = json.load(open(luoghi, encoding='utf-8'))
    el = {k: [] for k in TAG}
    for e in sorted(d['elements'], key=lambda e: (e['type'], e['id'])):
        k = tipo(e.get('tags', {}))
        r = elemento(e, TAG[k]) if k else None
        if r:
            el[k].append(r)
    scrivi(out_luoghi, d.get('osm3s', {}), el)
    d = json.load(open(arredo, encoding='utf-8'))
    ar = {'barriere': [], 'lampioni': [], 'alberi': []}
    for e in sorted(d['elements'], key=lambda e: e['id']):
        t = e.get('tags', {})
        if e['type'] != 'node':
            continue
        if 'barrier' in t:
            ar['barriere'].append([e['id'], e['lat'], e['lon'], t['barrier'], t.get('access', ''), t.get('motor_vehicle', ''),
                                   t.get('bus', t.get('psv', ''))])
        elif t.get('highway') == 'street_lamp':
            ar['lampioni'].append([e['id'], e['lat'], e['lon']])
        elif t.get('natural') == 'tree':
            ar['alberi'].append([e['id'], e['lat'], e['lon']])
    scrivi(out_arredo, d.get('osm3s', {}), ar)


if __name__ == '__main__':
    main(*sys.argv[1:5])
