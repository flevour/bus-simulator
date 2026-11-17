#!/usr/bin/env python3
"""Tempi di percorrenza del GTFS per fascia oraria (#116): se le corse hanno tempi diversi tra punta e morbida, sono una
misura locale della congestione per corridoio, con cui confrontare la domanda di traffico del gioco (docs/domanda.md,
sezione 6). Solo libreria standard.

Per un giorno (feriale del feed fissato: 11 novembre 2026), per ogni linea e schema di fermate con corse in tutte e
quattro le fasce (7-9, 10-12, 17-19, 20-23 per l'ora di partenza), il tempo mediano dalla prima all'ultima fermata;
poi, per i corridoi della prova (CORRIDOI), il tempo mediano tra due fermate di fila per fascia.

  python3 scripts/gtfs_tempi.py                 # linee e corridoi
  python3 scripts/gtfs_tempi.py --data 20261115 # un altro giorno del feed
"""
import csv
import io
import os
import statistics
import sys
import zipfile
from collections import defaultdict

RADICE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FEED = os.path.join(RADICE, 'data', 'gtfs-biv.zip')
FASCE = {'7-9': (7, 9), '10-12': (10, 12), '17-19': (17, 19), '20-23': (20, 23)}
# corridoi della prova tests/domanda.spec.js: linea, fermata da cui si parte e fermata dove si arriva (nomi del feed)
CORRIDOI = [
    ('Via Sorio, verso il centro', 'U12', 'Sorio fr. 96  (Aereoporto)', 'Rotonda San Giovanni'),
    ('Via Facciolati, verso il centro', 'U16', 'Facciolati CTO', 'Pontecorvo Chiesa'),
    ('Via Facciolati, verso il centro (extraurbana)', 'E005Z', 'OSPEDALE S. ANTONIO R', 'PADOVA PONTECORVO V. FACCIOLATI R'),
    ('Via Ariosto e Via Gattamelata, verso il centro', 'E073', 'PADOVA V. ARIOSTO R', 'PADOVA BUSONERA R'),
]


def fascia(t):
    h = t / 3600
    for k, (a, b) in FASCE.items():
        if a <= h < b:
            return k
    return None


def leggi(data):
    z = zipfile.ZipFile(FEED)
    rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), 'utf-8-sig'))
    attivi = {r['service_id'] for r in rd('calendar_dates.txt') if r['date'] == data and r['exception_type'] == '1'}
    routes = {r['route_id']: r['route_short_name'] for r in rd('routes.txt')}
    trips = {r['trip_id']: routes[r['route_id']] for r in rd('trips.txt') if r['service_id'] in attivi}
    nomi = {r['stop_id']: r['stop_name'] for r in rd('stops.txt')}
    sec = lambda t: (lambda h, m, s: h * 3600 + m * 60 + s)(*map(int, t.split(':')))
    corse = defaultdict(list)
    for r in rd('stop_times.txt'):
        if r['trip_id'] in trips:
            corse[r['trip_id']].append((int(r['stop_sequence']), r['stop_id'], sec(r['arrival_time']), sec(r['departure_time'])))
    for s in corse.values():
        s.sort()
    return trips, nomi, corse


def main():
    data = sys.argv[sys.argv.index('--data') + 1] if '--data' in sys.argv else '20261111'
    trips, nomi, corse = leggi(data)
    print(f'{len(corse)} corse il {data}')
    # linee: dalla prima all'ultima fermata. L'ultima fermata ha spesso dentro la sosta al capolinea: si guarda la
    # penultima
    schemi = defaultdict(lambda: defaultdict(list))
    for tid, s in corse.items():
        f = fascia(s[0][3])
        if f and len(s) > 2:
            schemi[(trips[tid], tuple(x[1] for x in s))][f].append(s[-2][2] - s[0][3])
    righe = []
    for (linea, sch), per in schemi.items():
        if all(per.get(k) for k in FASCE):
            med = {k: statistics.median(v) for k, v in per.items()}
            righe.append((max(med['7-9'], med['17-19']) / max(1, min(med['10-12'], med['20-23'])), linea, nomi[sch[0]], nomi[sch[-2]], med))
    righe.sort(key=lambda r: (-r[0], r[1]))
    print('\nlinea | da | alla penultima fermata | 7-9 | 10-12 | 17-19 | 20-23 (minuti, mediana)')
    for _, linea, a, b, med in righe:
        print(f'{linea} | {a} | {b} | ' + ' | '.join(f'{med[k] / 60:.1f}' for k in FASCE))
    uguali = sum(1 for r in righe if len({round(v) for v in r[4].values()}) == 1)
    print(f'\n{len(righe)} schemi con corse in tutte le fasce; {uguali} con lo stesso tempo in tutte')
    # corridoi
    print('\ncorridoio | linea | corse | 7-9 | 10-12 | 17-19 | 20-23 (minuti, mediana) | punta del mattino e della sera rispetto alle 11')
    for nome, linea, da, a in CORRIDOI:
        per = defaultdict(list)
        for tid, s in corse.items():
            if trips[tid] != linea:
                continue
            ids = [nomi[x[1]] for x in s]
            if da in ids and a in ids and ids.index(da) < ids.index(a):
                i, j = ids.index(da), ids.index(a)
                f = fascia(s[i][3])
                if f:
                    per[f].append(s[j][2] - s[i][3])
        if not all(per.get(k) for k in FASCE):
            print(f'{nome} | {linea} | corse mancanti in qualche fascia')
            continue
        med = {k: statistics.median(v) for k, v in per.items()}
        n = sum(len(v) for v in per.values())
        print(f'{nome} | {linea} | {n} | ' + ' | '.join(f'{med[k] / 60:.1f}' for k in FASCE)
              + f" | {100 * (med['7-9'] / med['10-12'] - 1):+.0f}% e {100 * (med['17-19'] / med['10-12'] - 1):+.0f}%")


if __name__ == '__main__':
    main()
