#!/usr/bin/env python3
"""Tempi di percorrenza del GTFS per fascia oraria (#116): se le corse hanno tempi diversi tra punta e morbida, sono una
misura locale della congestione per corridoio, con cui confrontare la domanda di traffico del gioco (docs/domanda.md,
sezione 7). Solo libreria standard.

Per un giorno (feriale del feed fissato: 11 novembre 2026), per ogni linea e schema di fermate con corse in tutte e
quattro le fasce (7-9, 10-12, 17-19, 20-23 per l'ora di partenza), il tempo mediano dalla prima all'ultima fermata;
poi, per i corridoi della prova (CORRIDOI), il tempo mediano tra due fermate di fila per fascia.

Con --porte (#147), per ogni porta d'ingresso della domanda (src/data/padova-domanda.json) i tratti delle linee sul
percorso più veloce dalla porta al centro: il rapporto tra le corse delle 7-9 e delle 10-12 del GTFS e quello dei tempi
della fascia della domanda alle 8 e alle 11 sullo stesso tratto. Un tratto dove il GTFS ha la punta e la domanda no è un
caso, contro l'elenco data/eccezioni/punte.json (lo lancia anche scripts/verifica_mappa.py, cioè la CI).

  python3 scripts/gtfs_tempi.py                 # linee e corridoi
  python3 scripts/gtfs_tempi.py --data 20261115 # un altro giorno del feed
  python3 scripts/gtfs_tempi.py --porte         # corridoi delle porte contro l'elenco; --elenco tutti, --aggiorna
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


# ------------------------------------------------------------------
# Corridoi delle porte (#147): la punta del mattino del GTFS contro quella della domanda
# ------------------------------------------------------------------
DOMANDA = os.path.join(RADICE, 'src', 'data', 'padova-domanda.json')
ELENCO, COMANDO, CONTROLLO = 'punte', 'python3 scripts/gtfs_tempi.py --porte --aggiorna', 'punta_mattino_mancante'
GIORNO = '20261111'
AGGANCIO = 30.0  # metri tra la fermata e il percorso della porta
LUNGO = (600.0, 4000.0)  # lunghezza del tratto lungo il percorso (m): l'orario allunga blocchi interi di fermate
ENTRO = 3000.0  # la prima fermata del tratto sta entro questi metri dalla porta, lungo il percorso
CORSE_MIN = 3  # corse alle 7-9 e alle 10-12 perché la mediana dica qualcosa
MORBIDA_MIN = 90  # secondi del tratto alle 10-12: sotto, un minuto di orario in più è già il 50%
PUNTA_GTFS = 1.2  # il GTFS ha la punta: almeno il 20% di tempo in più alle 7-9 che alle 10-12
PUNTA_GIOCO = 1.1  # la domanda ha la punta: il tratto costa almeno il 10% in più alle 8 che alle 11 (la soglia di #147)
TOLL = 60.0


def percorsi_porte(R, D):
    """per ogni porta d'ingresso il percorso più veloce a rete libera dai suoi stati allo stato più vicino al centro"""
    import heapq
    import domanda

    def d2(s):
        e = s >> 1
        dx = (R.nx[R.a[e]] + R.nx[R.b[e]]) / 2 - domanda.CENTRO[0]
        dz = (R.nz[R.a[e]] + R.nz[R.b[e]]) / 2 - domanda.CENTRO[1]
        return (dx * dx + dz * dz, s)
    centro = min(R.principale, key=d2)
    dist, prossimo, coda = {}, {}, [(R.t[centro], centro, -1)]
    while coda:
        d, s, p = heapq.heappop(coda)
        if s in dist:
            continue
        dist[s], prossimo[s] = d, p
        for u, c in R.pred.get(s, ()):
            if u not in dist:
                heapq.heappush(coda, (d + c + R.t[u], u, s))
    out = []
    for nome, _x, _z, _peso, ing, _usc in D['porte']:
        stati = sorted((dist[s], s) for s in ing if s in dist)
        if stati:
            p, s = [], stati[0][1]
            while s >= 0:
                p.append(s)
                s = prossimo[s]
            out.append((nome, p))
    return out


def corridoi_porte(M, D, data=GIORNO):
    """i corridoi delle porte: per ogni linea che passa sul percorso di una porta verso il centro, il tratto dalla prima
    fermata sul percorso (entro ENTRO metri dalla porta) all'ultima di fila sul percorso entro LUNGO metri, con il
    rapporto tra le mediane delle corse alle 7-9 e alle 10-12 e quello dei tempi della fascia della domanda alle 8 e
    alle 11 (tempo a rete libera per il fattore, più i movimenti). Un tratto preso da più porte vicine è uno solo"""
    import domanda
    R = domanda.Rete(M)
    fattori = {f[0]: f[1:] for f in D['fasce']['fattori']}
    trips, nomi, corse = leggi(data)
    z = zipfile.ZipFile(FEED)
    pos = {r['stop_id']: domanda.xz(float(r['stop_lat']), float(r['stop_lon']))
           for r in csv.DictReader(io.TextIOWrapper(z.open('stops.txt'), 'utf-8-sig'))}
    schemi = sorted({(trips[tid], tuple(x[1] for x in s)) for tid, s in corse.items()})
    griglia = defaultdict(list)
    for sid, (x, zz) in pos.items():
        griglia[(int(x // 100), int(zz // 100))].append(sid)
    visti = {}
    for porta, p in percorsi_porte(R, D):
        # fermate entro AGGANCIO metri dal percorso: metri dalla porta e indice dello stato
        prog, cum = {}, 0.0
        for i, s in enumerate(p):
            e = s >> 1
            a, b = (R.a[e], R.b[e]) if s & 1 == 0 else (R.b[e], R.a[e])
            ax, az, bx, bz = R.nx[a], R.nz[a], R.nx[b], R.nz[b]
            L2 = (bx - ax) * (bx - ax) + (bz - az) * (bz - az) or 1.0
            for gi in range(int(min(ax, bx) // 100) - 1, int(max(ax, bx) // 100) + 2):
                for gj in range(int(min(az, bz) // 100) - 1, int(max(az, bz) // 100) + 2):
                    for sid in griglia.get((gi, gj), ()):
                        x, zz = pos[sid]
                        u = max(0.0, min(1.0, ((x - ax) * (bx - ax) + (zz - az) * (bz - az)) / L2))
                        dx, dz = ax + u * (bx - ax) - x, az + u * (bz - az) - zz
                        if dx * dx + dz * dz <= AGGANCIO * AGGANCIO and (sid not in prog or dx * dx + dz * dz < prog[sid][2]):
                            prog[sid] = (cum + u * R.len[e], i, dx * dx + dz * dz)
            cum += R.len[e]
        # per ogni schema di fermate: la prima fila di fermate sul percorso, in avanti, che parte entro ENTRO metri
        for linea, ids in schemi:
            k = next((k for k, sid in enumerate(ids) if sid in prog and prog[sid][0] <= ENTRO), None)
            if k is None:
                continue
            j = k
            while j + 1 < len(ids) and ids[j + 1] in prog and prog[ids[j + 1]][0] > prog[ids[j]][0]:
                j += 1
            fine = [sid for sid in ids[k + 1:j + 1] if LUNGO[0] <= prog[sid][0] - prog[ids[k]][0] <= LUNGO[1]]
            if not fine:
                continue
            sa, sb = ids[k], fine[-1]
            c = visti.get((linea, sa, sb))
            if c is None:
                tratto = p[prog[sa][1]:prog[sb][1] + 1]
                c = visti[(linea, sa, sb)] = {'porte': [], 'linea': linea, 'da': nomi[sa], 'a': nomi[sb], 'x': pos[sa][0],
                                              'z': pos[sa][1], 'sa': sa, 'sb': sb, 'tratto': tratto,
                                              'metri': round(sum(R.len[s >> 1] for s in tratto)), 'tempi': defaultdict(list)}
            if porta not in c['porte']:
                c['porte'].append(porta)
    # tempi del GTFS per fascia, su tutte le corse della linea che passano dalle due fermate in quest'ordine
    per_linea = defaultdict(list)
    for c in visti.values():
        per_linea[c['linea']].append(c)
    for tid, s in corse.items():
        idx = {x[1]: i for i, x in enumerate(s)}
        for c in per_linea.get(trips[tid], ()):
            i, j = idx.get(c['sa']), idx.get(c['sb'])
            if i is not None and j is not None and i < j and fascia(s[i][3]):
                c['tempi'][fascia(s[i][3])].append(s[j][2] - s[i][3])

    def tempo(p, k):
        """tempo del tratto con i tempi della fascia k (fasce.ore = [8, 11, 17]) e i movimenti"""
        return sum(R.t[s] * fattori.get(s, (100, 100, 100))[k] / 100.0 for s in p) + sum(
            next(c for u, c in R.succ[a] if u == b) for a, b in zip(p, p[1:]))
    tenuti = []
    for c in visti.values():
        t = c.pop('tempi')
        if len(t['7-9']) < CORSE_MIN or len(t['10-12']) < CORSE_MIN:
            continue
        c['gtfs'] = {f: statistics.median(t[f]) for f in ('7-9', '10-12')}
        if c['gtfs']['10-12'] < MORBIDA_MIN:
            continue
        c['rapporto_gtfs'] = c['gtfs']['7-9'] / c['gtfs']['10-12']
        c['rapporto_gioco'] = tempo(c['tratto'], 0) / tempo(c['tratto'], 1)
        tenuti.append(c)
    return sorted(tenuti, key=lambda c: (c['porte'][0], c['linea'], c['da'])), R


def fissa(c):
    """parte fissa della chiave di un corridoio: linea e fermate (le porte stanno nel rapporto)"""
    return f"{c['linea']} {c['da']} → {c['a']}"


def rapporto(M, D=None, elenco=False, aggiorna=False):
    """i corridoi dove il GTFS ha la punta del mattino e la domanda no, caso per caso contro data/eccezioni/punte.json.
    Restituisce (valori, casi, righe degli errori)"""
    import json
    from eccezioni import Elenco, chiave
    D = D if D is not None else json.load(open(DOMANDA, encoding='utf-8'))
    corridoi, _R = corridoi_porte(M, D)
    casi = [c for c in corridoi if c['rapporto_gtfs'] >= PUNTA_GTFS and c['rapporto_gioco'] < PUNTA_GIOCO]
    con = {n for c in corridoi for n in c['porte']}
    print(f"Punta del mattino del GTFS sui corridoi delle porte: {len(corridoi)} corridoi per {len(con)} porte su "
          f"{sum(1 for g in D['porte'] if g[4])} d'ingresso")
    E = Elenco(ELENCO, COMANDO)
    E.confronta(CONTROLLO, [chiave(fissa(c), c['x'], c['z']) for c in casi], TOLL, aggiorna)
    segno, esito = E.segno(CONTROLLO)
    print(f'  {segno} punta del mattino mancante: {len(casi)} ({esito})')
    if elenco:
        print('  corridoio @ prima fermata, metri: 7-9 e 10-12 del GTFS (minuti) | rapporto del GTFS | della domanda | porte')
        for c in corridoi:
            print(f"    {fissa(c)} @ {c['x']:.0f},{c['z']:.0f}, {c['metri']} m: {c['gtfs']['7-9'] / 60:.1f} e "
                  f"{c['gtfs']['10-12'] / 60:.1f} | {c['rapporto_gtfs']:.2f} | {c['rapporto_gioco']:.2f} | "
                  + ', '.join(n or 'senza nome' for n in c['porte']))
    if aggiorna:
        E.scrivi()
    return {'corridoi': len(corridoi), 'porte_con_corridoio': len(con), CONTROLLO: len(casi)}, casi, E.errori()


def main():
    if '--porte' in sys.argv:
        import json
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        M = json.load(open(os.path.join(RADICE, 'src', 'data', 'padova-map.json'), encoding='utf-8'))
        _v, _c, errori = rapporto(M, None, '--elenco' in sys.argv, '--aggiorna' in sys.argv)
        if errori:
            print('\n'.join(errori))
            sys.exit(1)
        return
    data = sys.argv[sys.argv.index('--data') + 1] if '--data' in sys.argv else GIORNO
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
