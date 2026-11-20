#!/usr/bin/env python3
"""Prova del risolutore dei cavalcavia senza rigenerare la mappa (#125, docs/cavalcavia.md sezione 6).

Rifà il passo dei cavalcavia di scripts/build_map.py (da `if dtm_path:` a `heights.update(ris['nodeH'])`) sulla rete
di src/data/padova-map.json, con il registro di data/cavalcavia.json o con le sole strutture scelte accese, scrive
terreno, `cavalcavia`, `nodeH`, `edgeH` e `tramH` in una copia della mappa in memoria e la misura con il controllo
(scripts/cavalcavia.py). Con una struttura piccola gira in mezzo minuto: serve a provare una modifica al risolutore o al
registro prima dei sette minuti di scripts/rigenera_mappa.sh.

Dice anche le regole di #125 e #151 sulle strutture accese, e con --controlla esce con errore se una non vale:
  * il programma non viola pendenze, raggi e franchi;
  * il programma vede le conche dei binari come il controllo, entro CONCA_TOLL: Profili.quota_binario (la quota del
    binario del giro contro le onde) negli stessi punti del binario della mappa scritta. Con la sola strada sull'asse il
    programma non vedeva le conche a raso del SIR2 in Via Venezia e ai piedi del San Marco (13-17 cm per il controllo,
    5-7 per il programma): a raso il binario della mappa segue il terreno sotto di sé;
  * la strada che passa sotto una campata, fuori dalla struttura, tiene la sua quota: nella mappa scritta (terreno
    "via" più `edgeH`) ha, entro SOTTO_TOLL, la quota della rete delle strade sotto le campate (profilo_cavalcavia.
    StradeSotto: fuori dall'ombra il terreno com'è, dentro la media dei vicini, su una strada sola la retta tra i due
    lati). Il DTM non è il riferimento: sotto l'impalcato interpola dalle spalle. Con il codice di prima Corso Primo
    Maggio sotto Via Salboro scendeva di 0,69 m sotto la retta tra i due lati; senza abbassare le celle della rampa
    accanto, Corso Australia sotto il Chiesanuova faceva un dosso di 0,6 m. Si dice anche lo scarto dalla corda tra i
    due punti dove la strada esce dall'ombra (dove la rete ha incroci sotto la campata non è zero).

Cosa non dice: le quote al centimetro della mappa vera. I nodi della mappa sono arrotondati al decimetro, le strutture
spente cambiano il terreno attorno, e dove il profilo resta libero due soluzioni dello stesso costo possono scambiarsi
da una macchina all'altra (nota #124 in docs/LAVORO.md). Le quote vere vengono solo dalla rigenerazione.

    python3 scripts/prova_risolutore.py                          # Via Salboro, il Grassi e il San Marco, le regole di #125 e #151
    python3 scripts/prova_risolutore.py --struttura "Cavalcavia Camerini" --struttura "Via Salboro"
    python3 scripts/prova_risolutore.py --registro                # il registro com'è (tutte le strutture accese lì)
    python3 scripts/prova_risolutore.py --controlla              # in CI: esce con errore se una regola non vale

Servono numpy, scipy e shapely (scripts/requirements-mappa.txt), come per la build.
"""
import argparse
import copy
import json
import math
import os
import sys
import time
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cavalcavia  # noqa: E402
import profilo_cavalcavia  # noqa: E402
import quote_rete  # noqa: E402
import street_surfaces  # noqa: E402
from binari_tram import xz_da  # noqa: E402

RADICE = cavalcavia.RADICE
STRUTTURE = ['Via Salboro', 'Cavalcavia Antonio Grassi', 'Cavalcavia San Marco']  # con strade sotto le campate
# (Corso Primo Maggio, Via Friburgo, Via Sergio Fraccalanza) e, il San Marco, con le conche a raso del SIR2 ai piedi (#151)
SOTTO_METRI = 200.0  # m per parte dall'incrocio, lungo la strada di sotto: fin qui si cerca dove esce dall'ombra
SOTTO_TOLL = 0.15    # m dalla quota della rete: due gradini del terreno e l'interpolazione delle celle
CONCA_TOLL = 0.01    # m: la profondità di una conca dei binari per il programma e per il controllo (#151)


def carica():
    M = json.load(open(os.path.join(RADICE, 'src/data/padova-map.json'), encoding='utf-8'))
    n = M['nodes']
    nodes = [(n[i], n[i + 1]) for i in range(0, len(n), 2)]
    E = M['edges']
    edges = [E[k:k + 8] for k in range(0, len(E), 8)]
    xz = xz_da(M['origin'])
    nuove = json.load(open(os.path.join(RADICE, 'data/tram-linee-nuove.json'), encoding='utf-8'))
    new_tram = [[round(c, 1) for la, lo in v['percorso'] for c in xz(la, lo)] for L in nuove['linee'] for v in L['versi']]
    dtm = json.load(open(os.path.join(RADICE, 'data/dtm-padova.json')))
    return M, nodes, edges, new_tram, nuove, dtm


def passo(M, nodes, edges, new_tram, dtm, registro, log=print):
    """Il passo dei cavalcavia di build_map.py: (risultato di profilo_cavalcavia.calcola, quote dei nodi, archi delle
    strutture accese)."""
    names, rails, water = M['names'], M['rails'], M['water']
    binari = (M['tram'] if M['tramLanes'] else []) + new_tram
    terreno0 = street_surfaces.terrain_for_game(dtm, nodes, edges, {}, new_tram)[0]
    pronte = profilo_cavalcavia.strutture_rete(nodes, edges, names, rails, binari, terreno0, dtm)
    attive = profilo_cavalcavia.attive(pronte[4], registro)
    dichiarati = {k for st in attive for k in st['archi']}
    heights = street_surfaces.overpass_heights(nodes, edges, rails, dichiarati)
    misti = sorted(n for k in dichiarati for n in edges[k][:2] if heights.get(n, 0) > 0.05)
    if misti:
        sys.exit('una rampa con le quote di prima arriva dentro una struttura accesa, ai nodi '
                 + ', '.join(f'({nodes[n][0]:.0f}, {nodes[n][1]:.0f})' for n in misti[:8]) + ': si accendono insieme')
    terreno_prima, quote_prima = None, {}
    vicine = profilo_cavalcavia.vicine_a_quote_di_prima(nodes, edges, attive, heights)
    if vicine:
        lontani = {k for st in attive if st['id'] not in vicine for k in st['archi']}
        grezze = street_surfaces.overpass_heights(nodes, edges, rails, lontani)
        terreno_prima, _tst, _hfun, adjust_prima = street_surfaces.terrain_for_game(dtm, nodes, edges, grezze, new_tram, lontani)
        corrette = adjust_prima(dict(grezze))[0]
        nodi_dichiarati = {n for k in dichiarati for n in edges[k][:2]}
        quote_prima = {n: corrette.get(n, 0) for n, q in heights.items() if n not in nodi_dichiarati and grezze.get(n) == q}
    terrain, _tst, _hfun, adjust = street_surfaces.terrain_for_game(dtm, nodes, edges, heights, new_tram, dichiarati)
    heights, _abbassati = adjust(heights)
    heights.update(quote_prima)
    ris = profilo_cavalcavia.calcola(nodes, edges, names, rails, binari, terrain, dtm, registro, water, pronte=pronte,
                                     quote_di_prima=heights, terreno_prima=terreno_prima, log=log)
    heights.update(ris['nodeH'])
    return ris, heights, dichiarati, terrain


def mappa_nuova(M, nodes, edges, nuove, ris, heights, dichiarati):
    M2 = dict(M)
    M2['terrain'] = ris['terreno']
    M2['cavalcavia'] = ris['cavalcavia']
    M2['nodeH'] = [[n, h] for n, h in sorted(heights.items())]
    M2['edgeH'] = quote_rete.archi(nodes, edges, heights, ris['edgeH'], dichiarati)
    M2['tramH'], _tratti = quote_rete.calcola(M2, nuove)
    return M2


def strade_sotto(D, ris, terreno):
    """Per ogni incrocio di una campata accesa con una strada fuori dalla struttura (a terra: la regola vale lì): (struttura,
    via, punto, scarto più grande dalla quota della rete nell'ombra, scarto più grande dalla corda tra i punti dove la
    strada esce dall'ombra), o con None se la strada non esce dall'ombra da una parte."""
    R, P = ris['rete'], ris['profili']
    ombra = profilo_cavalcavia.StradeSotto(R, P, profilo_cavalcavia.Terreno(terreno), terreno)
    di = {k: s['id'] for s in ris['strutture'] for k in s['archi']}

    def punto(j, s):
        e = R.archi[j]
        A, B = R.nodi[e[0]], R.nodi[e[1]]
        return A[0] + (B[0] - A[0]) * s / R.lung[j], A[1] + (B[1] - A[1]) * s / R.lung[j]

    def lato(j, s, verso):
        """[(metri, x, z, quota della mappa, quota della rete)] dall'incrocio fino al primo punto fuori dall'ombra, lungo
        la strada e quelle che la proseguono fuori dalle strutture; None se non esce dall'ombra entro SOTTO_METRI."""
        out, d, visti = [], 0.0, {j}
        while d <= SOTTO_METRI:
            L = R.lung[j]
            while 0 <= s <= L and d <= SOTTO_METRI:
                x, z = punto(j, s)
                out.append((d * verso, x, z, D.via.at(x, z) + D.rel(j, s / L), ombra.quota(j, s)))
                if d and ombra.libero(x, z):
                    return out
                s += verso * 2.0
                d += 2.0
            nd = R.archi[j][1] if verso > 0 else R.archi[j][0]
            dopo = [m for m in R.seguiti(j, nd) if m in ombra.di_fuori and m not in visti]
            if not dopo:
                return None
            oltre = s - L if verso > 0 else -s
            j = dopo[0]
            visti.add(j)
            verso, s = (1, oltre) if R.archi[j][0] == nd else (-1, R.lung[j] - oltre)
        return None

    out, visti = [], set()
    for k, t, tipo, j, p in ris['incroci']:
        if tipo != 'strada' or j not in ombra.di_fuori or k not in P.campate:
            continue
        if max(D.h(n) for n in R.archi[j][:2]) > profilo_cavalcavia.QUOTA_DI_PRIMA:
            continue  # la strada di sotto è un cavalcavia con le quote di prima (tieni_quote_di_prima)
        ch = (j, round(p[0] / 10), round(p[1] / 10))
        if ch in visti:
            continue
        visti.add(ch)
        e = R.archi[j]
        s0 = min(R.lung[j], math.dist(R.nodi[e[0]], p))
        a, b = lato(j, s0, -1), lato(j, s0, 1)
        if not a or not b:
            out.append((di[k], R.nome(j) or 'strada senza nome', p, None, None))
            continue
        pts = sorted(a[1:] + b)
        (sa, _x, _z, qa, _r), (sb, _x, _z, qb, _r) = pts[0], pts[-1]
        rete = max(abs(q - r) for _s, _x, _z, q, r in pts if r is not None)
        corda = max(abs(q - (qa + (qb - qa) * (s - sa) / ((sb - sa) or 1))) for s, _x, _z, q, _r in pts)
        out.append((di[k], R.nome(j) or 'strada senza nome', p, rete, corda))
    return out


def conche_binari(D, ris):
    """Le conche dei binari sulle strutture accese come le vede il controllo (scripts/cavalcavia.py, onde sul binario
    della mappa scritta: terreno sotto il binario più tramH) e come le vede il programma negli stessi punti
    (Profili.quota_binario, la quota del binario del giro contro le onde), #151. Solo dove il binario affianca una strada
    delle strutture accese: altrove il programma non ha quote. ([(struttura, binario, (x, z), profondità per il
    controllo, per il programma)] con None dove uno dei due non vede la conca, scarto più grande tra le due quote)"""
    R, P = ris['rete'], ris['profili']
    vista = type('Vista', (), {'strade': R.griglia, 'misurati': P.S, 'archi': R.archi, 'nodi': R.nodi})
    accese = {s['id'] for s in ris['strutture']}
    out, peggio = [], 0.0
    for cid, TT in sorted(cavalcavia.profili_binari(D, cavalcavia.cavalcavia(D)).items()):
        if cid not in accese:
            continue
        for T in TT:
            pts, prog = T['pts'], []
            for i, p in enumerate(pts):
                a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
                k, t, _d = cavalcavia.arco_accanto(vista, (p['x'], p['z']), (b['x'] - a['x'], b['z'] - a['z']))
                prog.append(None if k is None else P.quota_binario(P.a_frazione(k, t), (p['x'], p['z'])))
            n = 0
            while n < len(pts):
                if prog[n] is None:
                    n += 1
                    continue
                a = n
                while n < len(pts) and prog[n] is not None:
                    n += 1
                if n - a < 5:
                    continue
                A = pts[a:n]
                B = [dict(p, q=q) for p, q in zip(A, prog[a:n])]
                peggio = max(peggio, max(abs(x['q'] - y['q']) for x, y in zip(A, B)))
                ca, cb = cavalcavia.onde(A, 0, len(A) - 1), cavalcavia.onde(B, 0, len(B) - 1)
                presi = set()
                for c in ca:
                    vicine = [(abs(d['i'] - c['i']), j) for j, d in enumerate(cb) if j not in presi
                              and abs(d['i'] - c['i']) * cavalcavia.PASSO <= cavalcavia.TOLL]
                    j = min(vicine)[1] if vicine else None
                    if j is not None:
                        presi.add(j)
                    p = A[c['i']]
                    out.append((cid, T['binario'], (round(p['x']), round(p['z'])), c['profondita'], cb[j]['profondita'] if j is not None else None))
                for j, d in enumerate(cb):
                    if j not in presi:
                        p = B[d['i']]
                        out.append((cid, T['binario'], (round(p['x']), round(p['z'])), None, d['profondita']))
    return out, peggio


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--struttura', action='append', default=[], help=f"strutture da accendere da sole (di base {', '.join(STRUTTURE)})")
    ap.add_argument('--registro', action='store_true', help='il registro com\'è, con le sue strutture accese')
    ap.add_argument('--controlla', action='store_true', help='esce con errore se una regola di #125 non vale')
    ap.add_argument('--mappa', help='scrive qui la mappa di prova')
    a = ap.parse_args()
    t0 = time.time()
    M, nodes, edges, new_tram, nuove, dtm = carica()
    registro = copy.deepcopy(profilo_cavalcavia.carica_registro())
    ids = {s['id'] for s in registro['strutture']}
    scelte = a.struttura or ([] if a.registro else STRUTTURE)
    for i in scelte:
        if i not in ids:
            sys.exit(f'struttura che non è nel registro: {i}')
    if scelte:
        for s in registro['strutture']:
            s['profilo'] = s['id'] in scelte
    ris, heights, dichiarati, terreno = passo(M, nodes, edges, new_tram, dtm, registro, log=lambda *x: None)
    P = ris['profili']
    M2 = mappa_nuova(M, nodes, edges, nuove, ris, heights, dichiarati)
    if a.mappa:
        with open(a.mappa, 'w', encoding='utf-8') as f:
            json.dump(M2, f, ensure_ascii=False, separators=(',', ':'))
    D = cavalcavia.rete_dati(M2)
    misure = cavalcavia.misura(D)
    accese = [s['id'] for s in ris['strutture']]
    print(f"strutture accese: {len(accese)} ({', '.join(accese) if len(accese) <= 4 else 'il registro'}), {P.N} incognite, "
          f'{time.time() - t0:.0f} s')
    errori = []
    v = P.violazioni
    print(f"oltre la regola nel programma: pendenze {v['pendenze']}, pendenze dei binari {v['binari']}, raccordi {v['raccordi']}, "
          f"franchi {len(v['franchi'])}")
    if v['pendenze'] or v['binari'] or v['raccordi'] or v['franchi']:
        errori.append('il programma viola pendenze, raggi o franchi')
    sov = sorted(v['sovrapposte'], key=lambda c: -c[2])
    print(f"carreggiate sovrapposte a quote diverse (#150): {len(sov)} punti"
          + (', i più alti ' + ', '.join(f'{m:.2f} m in ({x}, {z})' for x, z, m in sov[:6]) if sov else ''))
    # (dopo i giri contro le onde restano le conche che il DTM vede: lì la strada lo segue, il rilievo prima delle onde)
    print(f'punti nelle conche del profilo calcolato, dopo i giri contro le onde: {len(P.onde())}')
    sotto = strade_sotto(D, ris, terreno)
    print(f'strade sotto le campate: {len(sotto)}; scarto più grande dalla quota della rete nell\'ombra (e dalla corda tra i '
          f'punti fuori dall\'ombra):')
    for sid, via, p, scarto, corda in sorted(sotto, key=lambda r: -(r[3] if r[3] is not None else -1)):
        if scarto is None:
            print(f'     -    {via} sotto {sid} ({p[0]:.0f}, {p[1]:.0f}): non esce dall\'ombra da una parte (resta il piano)')
            continue
        print(f'  {scarto:5.2f} m ({corda:4.2f})  {via} sotto {sid} ({p[0]:.0f}, {p[1]:.0f})' + ('  OLTRE' if scarto > SOTTO_TOLL else ''))
        if scarto > SOTTO_TOLL:
            errori.append(f'{via} sotto {sid} ({p[0]:.0f}, {p[1]:.0f}) si stacca dalla sua quota di {scarto:.2f} m')
    conche, scarto = conche_binari(D, ris)
    diverse = [c for c in conche if c[3] is None or c[4] is None or abs(c[3] - c[4]) > CONCA_TOLL + 1e-9]
    print(f'conche dei binari (#151): {len(conche)}, {len(diverse)} viste diverse dal programma e dal controllo '
          f'(oltre {CONCA_TOLL * 100:.0f} cm); quota del binario fino a {scarto:.3f} m diversa tra i due')
    for cid, bin_, p, qc, qp in conche:
        segno = '  DIVERSA' if (cid, bin_, p, qc, qp) in diverse else ''
        print(f"  {bin_} ({p[0]}, {p[1]}) su {cid}: controllo {'-' if qc is None else f'{qc:.2f} m'}, "
              f"programma {'-' if qp is None else f'{qp:.2f} m'}{segno}")
    if diverse:
        errori.append(f'{len(diverse)} conche dei binari viste diverse dal programma e dal controllo')
    conta = Counter()
    for cid in accese:
        for c in misure.get(cid, {}).get('casi', []):
            conta[c['tipo']] += 1
    print('casi del controllo sulle strutture accese: ' + (', '.join(f'{t} {n}' for t, n in sorted(conta.items())) or 'nessuno'))
    if a.controlla and errori:
        sys.exit('\n'.join(errori))


if __name__ == '__main__':
    main()
