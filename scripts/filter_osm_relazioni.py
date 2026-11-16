#!/usr/bin/env python3
"""Riduce l'export Overpass di scripts/overpass-relazioni.ql a quello che usa scripts/osm_rete.py.

Uso:
    python3 scripts/filter_osm_relazioni.py <export_overpass.json> data/osm-padova-relazioni.json

* Svolte (type=restriction): id, tipo, vie "da" e "a", nodo o vie "via", eccezioni (except) e orario
  (restriction:conditional). Le relazioni a cui manca un membro restano, con il campo vuoto: le conta il rapporto.
  "da_vicini" e "a_vicini" sono i nodi che nella via di oggi stanno accanto al nodo "via": con loro una via cambiata in
  OSM dopo lo scarico (spezzata, unita ad altre) si aggancia lo stesso al tratto giusto delle vie dello scarico.
* Linee (type=route di bus e tram): id, numero, nome, rete e, in ordine, le vie del percorso che stanno negli scarichi
  delle vie (data/osm-padova.json, data/osm-corridoio.json); "fuori" conta le altre. Una linea senza vie negli scarichi
  (i pullman a lunga percorrenza che passano solo in tangenziale o fuori area) non si tiene.

Una relazione per riga: i diff tra un export e l'altro restano leggibili.

Dati © OpenStreetMap contributors (ODbL).
"""
import json
import os
import sys

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIE = (os.path.join(RADICE, 'data', 'osm-padova.json'), os.path.join(RADICE, 'data', 'osm-corridoio.json'))


def main(src, out):
    d = json.load(open(src, encoding='utf-8'))
    note = {e['id'] for p in VIE for e in json.load(open(p, encoding='utf-8'))['elements'] if e['type'] == 'way'}
    nodi_via = {e['id']: e['nodes'] for e in d['elements'] if e['type'] == 'way'}

    def vicini(vie, nodo):
        out = []
        for w in vie:
            ns = nodi_via.get(w, [])
            out += [ns[i + s] for i, n in enumerate(ns) if n == nodo for s in (-1, 1) if 0 <= i + s < len(ns)]
        return sorted(set(out))
    svolte, linee = [], []
    for e in d['elements']:
        t = e.get('tags', {})
        if e['type'] != 'relation':
            continue
        m = e.get('members', [])
        if t.get('type', '').startswith('restriction'):
            r = {'id': e['id'], 'tipo': t.get('restriction', ''),
                 'da': [x['ref'] for x in m if x['type'] == 'way' and x['role'] == 'from'],
                 'via_nodo': [x['ref'] for x in m if x['type'] == 'node' and x['role'] == 'via'],
                 'via_vie': [x['ref'] for x in m if x['type'] == 'way' and x['role'] == 'via'],
                 'a': [x['ref'] for x in m if x['type'] == 'way' and x['role'] == 'to']}
            if len(r['via_nodo']) == 1:
                r['da_vicini'], r['a_vicini'] = vicini(r['da'], r['via_nodo'][0]), vicini(r['a'], r['via_nodo'][0])
            # restriction:hgv, restriction:bus...: vale solo per quel mezzo
            for k in sorted(t):
                if k.startswith('restriction:') and k != 'restriction:conditional':
                    r.setdefault('mezzi', {})[k.split(':', 1)[1]] = t[k]
            if t.get('type') != 'restriction':
                r.setdefault('mezzi', {})[t['type'].split(':', 1)[1]] = t.get('restriction', '')
            if 'except' in t:
                r['eccetto'] = t['except']
            if 'restriction:conditional' in t:
                r['orario'] = t['restriction:conditional']
            svolte.append(r)
        elif t.get('type') == 'route':
            vie = [x['ref'] for x in m if x['type'] == 'way' and x['role'] in ('', 'forward', 'backward')]
            dentro = [w for w in vie if w in note]
            if dentro:
                linee.append({'id': e['id'], 'mezzo': t.get('route', ''), 'linea': t.get('ref', ''), 'nome': t.get('name', ''),
                              'rete': t.get('network', ''), 'da': t.get('from', ''), 'a': t.get('to', ''),
                              'vie': dentro, 'fuori': len(vie) - len(dentro)})
    svolte.sort(key=lambda r: r['id'])
    linee.sort(key=lambda r: r['id'])
    riga = lambda r: json.dumps(r, ensure_ascii=False, separators=(',', ':'))
    with open(out, 'w', encoding='utf-8') as f:
        f.write('{"osm3s":' + json.dumps(d.get('osm3s', {}), ensure_ascii=False) + ',\n"svolte":[\n')
        f.write(',\n'.join(riga(r) for r in svolte))
        f.write('\n],\n"linee":[\n')
        f.write(',\n'.join(riga(r) for r in linee))
        f.write('\n]}\n')
    print(f'svolte {len(svolte)}, linee {len(linee)} su {sum(1 for e in d["elements"] if e.get("tags", {}).get("type") == "route")}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
