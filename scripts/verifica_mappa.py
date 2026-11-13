"""Rapporto di verifica sulla mappa (src/data/padova-map.json): numeri da confrontare tra una build e l'altra.

Controlla quello che il JSON dice già, senza aprire il gioco (sezione 6.1 di docs/PIANO_MODELLO_CITTA.md):
  * edifici che invadono la carreggiata (piante degli edifici contro la pianta delle strade), in tutto e lungo i
    percorsi dei bus: il gioco toglie gli ostacoli solo in una fascia attorno all'asse (clearBusRoads in
    src/world/city.js), e restano quelli nelle piazzole di fermata e agli incroci;
  * percorsi dei bus liberi: edifici nella corsia di ogni variante di linea;
  * fermate raggiungibili: fermate lontane dal percorso della loro variante, o che il gioco aggancia nel punto
    sbagliato perché stanno oltre 2,5 km di percorso dalla precedente (buildRoute in src/game/routes.js);
  * marciapiedi più stretti di 1,5 m;
  * dove sta nei dati la fermata (palina OSM o fermata GTFS): solo per informazione, perché il gioco porta comunque
    la palina al cordolo;
  * binari del tram secondo la regola di docs/binari-tram.md (scripts/binari_tram.py): spigoli, raggi sotto il minimo,
    interassi fuori misura e scarti da OSM, per linea e per deposito, sui binari che scrivono gli script. Quelli che
    disegna il gioco li misura tests/binari-tram.spec.js;
  * profilo dei cavalcavia secondo la regola di docs/cavalcavia.md (scripts/cavalcavia.py): onde, pendenze oltre il
    massimo, raccordi verticali sotto il raggio minimo e scarti dal DTM delle strade, le stesse misure e i binari fuori
    quota per i binari che ci salgono. Le quote dei binari come le mette il gioco le misura tests/cavalcavia.spec.js.
Pali dei semafori, lampioni, alberi, pensiline e paline al posto finale li mette il gioco al caricamento: li controlla
la prova tests/mappa.spec.js nel browser.

Le soglie sono per caso, non per conteggio (#105, scripts/eccezioni.py): i casi noti stanno in
data/eccezioni/verifica-mappa.json (edifici, fermate, marciapiede stretto per riquadro da 800 m) e in
data/eccezioni/cavalcavia.json, in gruppi con il perché. Esce con errore se trova un caso fuori dall'elenco, anche a
totale uguale, o se un caso dell'elenco è sparito (va tolto nello stesso commit). I binari del tram hanno soglie a zero
e le loro zone di eccezione in scripts/binari_tram.py. Dopo una rigenerazione della mappa che corregge o sposta dei
casi, --aggiorna riscrive i due elenchi: toglie gli spariti e mette i nuovi in un gruppo con il perché vuoto, da
scrivere prima che il rapporto passi.

  python3 scripts/verifica_mappa.py [src/data/padova-map.json] [--elenco] [--json rapporto.json] [--aggiorna]

Serve shapely (come per scripts/street_surfaces.py).
"""
import argparse
import json
import math
import sys
from collections import defaultdict

from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import substring, unary_union

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import aree_mappa  # noqa: E402
import binari_tram  # noqa: E402
import cavalcavia  # noqa: E402
from eccezioni import Elenco, chiave  # noqa: E402

BUS_NEAR = 6.0  # m: oltre metà carreggiata, un edificio è "lungo il percorso" fin qui dall'asse
BUS_HW = 1.3  # m: metà larghezza del bus (2,55 m) e un poco di margine
INVADE = 0.2  # m: un edificio invade se, tolti 20 cm da ogni lato della sovrapposizione, resta qualcosa (arrotondamenti)
STOP_FAR = 40.0  # m: oltre, la fermata non sta sul percorso della sua variante
WALK_MIN = 1.5  # m: un marciapiede più stretto non è un marciapiede
H_ELEV = 0.05  # m: nodi in quota (cavalcavia): sotto possono esserci edifici

TOLL = 3.0  # m: un caso dell'elenco delle eccezioni resta lo stesso se si sposta fino a qui

# binari del tram (scripts/binari_tram.py) sui dati: le linee (#69, scripts/binari_regola.py) e i depositi (#70,
# scripts/tram_depositi.py) seguono la regola di docs/binari-tram.md; i casi che restano sono nelle eccezioni di
# binari_tram.py, ognuna col suo perché, e non contano
SOGLIE_BINARI = {
    'SIR1': {'spigoli': 0, 'raggi': 0, 'interassi': 0, 'scarti_osm': 0},
    'SIR3': {'spigoli': 0, 'raggi': 0, 'interassi': 0, 'scarti_osm': 0},
    'SIR2': {'spigoli': 0, 'raggi': 0, 'interassi': 0, 'scarti_osm': 0},
    'Guizza': {'spigoli': 0, 'raggi': 0, 'interassi': 0, 'scarti_osm': 0},
    'Voltabarozzo': {'spigoli': 0, 'raggi': 0, 'interassi': 0, 'scarti_osm': 0},
}
NOMI = {
    'edifici_in_carreggiata': 'edifici che invadono la carreggiata',
    'edifici_in_carreggiata_bus': 'edifici che invadono la carreggiata lungo i percorsi dei bus',
    'edifici_sui_percorsi': 'edifici nella corsia dei bus',
    'fermate_lontane': f'fermate a più di {STOP_FAR:.0f} m dal percorso',
    'fermate_spostate': 'fermate agganciate nel punto sbagliato del percorso',
    'marciapiedi_stretti_m2': f'marciapiede più stretto di {WALK_MIN:.1f} m (m²)'.replace('.', ','),
}
# la chiave di ogni caso nell'elenco delle eccezioni (data/eccezioni/verifica-mappa.json): parte fissa e posto. Gli
# edifici non hanno un nome stabile (l'indice cambia a ogni rigenerazione): li distingue il posto
fermata = lambda c: f"linea {c['linea']} verso {c['verso']}, {c['nome']}"
CHIAVI = {
    'edifici_in_carreggiata': lambda c: 'edificio lungo i percorsi dei bus' if c['bus'] else 'edificio',
    'edifici_sui_percorsi': lambda c: 'edificio nella corsia',
    'fermate_lontane': fermata,
    'fermate_spostate': fermata,
}


def coppie(f):
    return [(f[i], f[i + 1]) for i in range(0, len(f) - 1, 2)]


def poligono(anelli):
    """Poligono da anelli piatti [x0, z0, x1, z1, ...]: il primo è il bordo, gli altri i buchi."""
    esterno = coppie(anelli[0])
    if len(esterno) < 3:
        return None
    p = Polygon(esterno, [coppie(r) for r in anelli[1:] if len(r) >= 6])
    return p if p.is_valid else p.buffer(0)


def invade(a, b):
    """Profondità della sovrapposizione tra a e b oltre gli arrotondamenti: 0 se non c'è."""
    inter = a.intersection(b)
    if inter.is_empty or inter.area < 0.05:
        return 0.0
    if inter.buffer(-INVADE).is_empty:
        return 0.0
    # spessore medio della sovrapposizione: area su metà perimetro
    return round(2 * inter.area / max(inter.length, 1e-6), 1)


class Mappa:
    def __init__(self, M):
        self.M = M
        n = M['nodes']
        self.nodi = [(n[i], n[i + 1]) for i in range(0, len(n), 2)]
        self.quota = {i: h for i, h in M.get('nodeH', [])}
        self.archi = {}
        E = M['edges']
        for k in range(0, len(E), 8):
            a, b, cls, width, name, flags = E[k:k + 6]
            oneway = 1 if flags & 1 else -1 if flags & 2 else 0
            self.archi[(min(a, b), max(a, b))] = {'a': a, 'b': b, 'width': width, 'name': M['names'][name] if name < len(M['names']) else '', 'oneway': oneway}
        S = M['surfaces']
        self.asfalto, self.marciapiede = [], []
        for ix, iz, A, W, *_ in S['cells']:
            self.asfalto += [p for p in (poligono(r) for r in A) if p is not None and not p.is_empty]
            self.marciapiede += [p for p in (poligono(r) for r in W) if p is not None and not p.is_empty]
        self.t_asfalto, self.t_marciapiede = STRtree(self.asfalto), STRtree(self.marciapiede)
        self.edifici = []
        for i, (h, kind, name, f, holes, *resto) in enumerate(M['buildings']):
            p = poligono([f] + (holes or []))
            if p is not None and not p.is_empty:
                self.edifici.append({'i': i, 'p': p, 'nome': name or kind, 'portico': bool(resto and resto[0])})
        self.t_edifici = STRtree([e['p'] for e in self.edifici])
        self.edifici_per_indice = {e['i']: e['p'] for e in self.edifici}

    def arco(self, a, b):
        return self.archi.get((min(a, b), max(a, b)))

    def in_quota(self, a, b):
        return self.quota.get(a, 0) > H_ELEV or self.quota.get(b, 0) > H_ELEV


def edifici_in_carreggiata(mappa):
    out = []
    for e in mappa.edifici:
        prof = max((invade(e['p'], mappa.asfalto[j]) for j in mappa.t_asfalto.query(e['p'], predicate='intersects')), default=0)
        if prof > 0:
            c = e['p'].representative_point()
            out.append({'edificio': e['i'], 'nome': e['nome'], 'x': round(c.x), 'z': round(c.y), 'metri': prof, 'portico': e['portico']})
    return out


def lungo_i_percorsi(mappa, casi):
    """I casi entro metà carreggiata più BUS_NEAR dall'asse di un tratto percorso dai bus (non in quota)."""
    fasce = []
    for a, b in {tuple(sorted(t)) for L in mappa.M['lines'] for v in L['variants'] for t in zip(v['nodes'], v['nodes'][1:]) if t[0] != t[1]}:
        if mappa.in_quota(a, b):
            continue
        arco = mappa.arco(a, b)
        fasce.append(LineString([mappa.nodi[a], mappa.nodi[b]]).buffer((arco['width'] if arco else 9) / 2 + BUS_NEAR, cap_style='flat'))
    albero = STRtree(fasce)
    return [c for c in casi if len(albero.query(mappa.edifici_per_indice[c['edificio']], predicate='intersects'))]


def corsia(arco):
    """Scostamento a destra dell'asse dove sta il bus (come il pilota di tests/guida.js)."""
    hw = (arco['width'] if arco else 9) / 2
    if arco and arco['oneway']:
        return min(max(hw - 2, 0), hw / 2)
    return max(0, min(hw / 2, hw - 1.5))


def percorsi(mappa):
    """Edifici nella corsia dei bus: per ogni tratto delle varianti, la fascia larga quanto il bus sulla corsia di destra
    (accorciata di 2,5 m ai capi, dove si svolta e la fascia esce dalla curva). Un edificio conta una volta, con le
    linee che lo toccano."""
    trovati = {}
    for L in mappa.M['lines']:
        for v in L['variants']:
            seq = [n for k, n in enumerate(v['nodes']) if k == 0 or n != v['nodes'][k - 1]]
            for a, b in zip(seq, seq[1:]):
                if mappa.in_quota(a, b):
                    continue
                (ax, az), (bx, bz) = mappa.nodi[a], mappa.nodi[b]
                ln = math.hypot(bx - ax, bz - az)
                if ln < 1:
                    continue
                dx, dz = (bx - ax) / ln, (bz - az) / ln
                rx, rz = -dz, dx
                arco = mappa.arco(a, b)
                lat, t = corsia(arco), min(2.5, ln / 4)
                p0, p1 = (ax + dx * t, az + dz * t), (bx - dx * t, bz - dz * t)
                fascia = Polygon([(p0[0] + rx * (lat - BUS_HW), p0[1] + rz * (lat - BUS_HW)), (p1[0] + rx * (lat - BUS_HW), p1[1] + rz * (lat - BUS_HW)),
                                  (p1[0] + rx * (lat + BUS_HW), p1[1] + rz * (lat + BUS_HW)), (p0[0] + rx * (lat + BUS_HW), p0[1] + rz * (lat + BUS_HW))])
                for j in mappa.t_edifici.query(fascia, predicate='intersects'):
                    e = mappa.edifici[j]
                    prof = invade(e['p'], fascia)
                    if prof <= 0:
                        continue
                    k = e['i']
                    if k not in trovati:
                        c = e['p'].representative_point()
                        trovati[k] = {'edificio': k, 'nome': e['nome'], 'x': round(c.x), 'z': round(c.y), 'via': arco['name'] if arco else '', 'metri': prof, 'linee': set()}
                    trovati[k]['metri'] = max(trovati[k]['metri'], prof)
                    trovati[k]['linee'].add(L['id'])
    return [{**t, 'linee': sorted(t['linee'])} for t in trovati.values()]


def fermate(mappa):
    """Fermate di ogni variante proiettate sul percorso in ordine, cercando dopo la precedente come buildRoute di
    src/game/routes.js: lontane (oltre STOP_FAR da tutto il percorso) o spostate (vicine al percorso, ma non nella
    finestra dove il gioco le cerca: da 20 m prima della precedente a 2,5 km dopo)."""
    lontane, spostate = [], []
    stops = mappa.M['stops']
    for L in mappa.M['lines']:
        for v in L['variants']:
            seq = [n for k, n in enumerate(v['nodes']) if k == 0 or n != v['nodes'][k - 1]]
            if len(seq) < 2:
                continue
            linea = LineString([mappa.nodi[n] for n in seq])
            s_prec = 0.0
            for k, si in enumerate(v['stops']):
                x, z, nome = stops[si][:3]
                pt = Point(x, z)
                ultima = k == len(v['stops']) - 1
                s0, s1 = max(0.0, s_prec - 20), linea.length if ultima else min(linea.length, s_prec + 2500)
                tratto = substring(linea, s0, s1) if s1 > s0 else linea
                d = tratto.distance(pt)
                s = s0 + tratto.project(pt)
                voce = {'linea': L['id'], 'verso': v['headsign'], 'fermata': k, 'nome': nome, 'x': round(x), 'z': round(z), 'metri': round(d, 1)}
                if d > STOP_FAR:
                    (spostate if linea.distance(pt) <= STOP_FAR else lontane).append(voce)
                # come buildRoute: la fermata va almeno 25 m dopo la precedente
                s_prec = max(s, s_prec + (25 if k else 0))
    return lontane, spostate


def paline(mappa):
    """Dove sta nei dati la fermata (palina OSM se c'è, altrimenti la fermata GTFS) delle linee bus."""
    usate = sorted({si for L in mappa.M['lines'] for v in L['variants'] for si in v['stops']})
    conta = defaultdict(int)
    for si in usate:
        x, z = mappa.M['stops'][si][:2]
        pt = Point(x, z)
        if any(mappa.asfalto[j].contains(pt) for j in mappa.t_asfalto.query(pt)):
            conta['in carreggiata'] += 1
        elif any(mappa.marciapiede[j].contains(pt) for j in mappa.t_marciapiede.query(pt)):
            conta['sul marciapiede'] += 1
        else:
            vicini = mappa.t_asfalto.query(pt.buffer(3), predicate='intersects')
            conta['entro 3 m dall\'asfalto' if len(vicini) else 'oltre 3 m dall\'asfalto'] += 1
    return dict(conta)


def marciapiedi_stretti(mappa):
    """Area dei marciapiedi più stretti di WALK_MIN: quello che sparisce con un'apertura morfologica di metà larghezza.
    Si uniscono prima i pezzi dei riquadri, che altrimenti sembrerebbero strisce tagliate al bordo. Restituisce l'area
    stretta, quella di tutti i marciapiedi e l'area stretta per riquadro da 800 m (la chiave delle aree della mappa),
    ogni pezzo nel riquadro del suo baricentro."""
    tutto = unary_union(mappa.marciapiede)
    aperto = tutto.buffer(-WALK_MIN / 2, join_style='mitre').buffer(WALK_MIN / 2, join_style='mitre')
    stretto = tutto.difference(aperto)
    per = defaultdict(float)
    for g in getattr(stretto, 'geoms', [stretto]):
        if not g.is_empty:
            c = g.centroid
            per[f'riquadro {aree_mappa.key(c.x, c.y)}'] += g.area
    return round(stretto.area), round(tutto.area), {k: round(v) for k, v in per.items()}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('mappa', nargs='?', default='src/data/padova-map.json')
    ap.add_argument('--elenco', action='store_true', help='elenca i casi trovati (con le coordinate del gioco)')
    ap.add_argument('--json', help='scrive il rapporto completo in questo file')
    ap.add_argument('--aggiorna', action='store_true', help="riscrive gli elenchi delle eccezioni dai casi di oggi (i nuovi senza perché)")
    args = ap.parse_args()
    mappa = Mappa(aree_mappa.load(args.mappa))  # la rete con le sue aree

    casi = {'edifici_in_carreggiata': edifici_in_carreggiata(mappa)}
    casi['edifici_in_carreggiata_bus'] = lungo_i_percorsi(mappa, casi['edifici_in_carreggiata'])
    lungo = {c['edificio'] for c in casi['edifici_in_carreggiata_bus']}
    for c in casi['edifici_in_carreggiata']:
        c['bus'] = c['edificio'] in lungo
    casi['edifici_sui_percorsi'] = percorsi(mappa)
    casi['fermate_lontane'], casi['fermate_spostate'] = fermate(mappa)
    dove = paline(mappa)
    stretto, totale, stretto_per_riquadro = marciapiedi_stretti(mappa)
    valori = {k: len(v) for k, v in casi.items()}
    valori['marciapiedi_stretti_m2'] = stretto

    # caso per caso contro l'elenco delle eccezioni. Gli edifici lungo i percorsi dei bus sono un sottoinsieme di quelli
    # in carreggiata: stanno nello stesso controllo, con la loro parte fissa della chiave
    E = Elenco('verifica-mappa', 'python3 scripts/verifica_mappa.py --aggiorna')
    for k, f in CHIAVI.items():
        E.confronta(k, [chiave(f(c), c['x'], c['z']) for c in casi[k]], TOLL, args.aggiorna)
    E.confronta_misura('marciapiedi_stretti_m2', stretto_per_riquadro, args.aggiorna)
    if args.aggiorna:
        E.scrivi()

    print(f'Rapporto di verifica della mappa ({args.mappa})')
    print(f'  {len(mappa.edifici)} edifici, {len(mappa.asfalto)} pezzi di carreggiata, {len(mappa.marciapiede)} di marciapiede, '
          f'{sum(len(L["variants"]) for L in mappa.M["lines"])} varianti di linea')
    print('  fermate delle linee bus nei dati: ' + ', '.join(f'{n} {k}' for k, n in sorted(dove.items(), key=lambda kv: -kv[1])))
    print(f'  marciapiede: {totale} m² in tutto')
    for k, nome in NOMI.items():
        if k in E.esiti:
            segno, esito = E.segno(k)
            print(f'  {segno} {nome}: {valori[k]} ({esito})')
        else:
            print(f'    {nome}: {valori[k]}')
        if args.elenco and k in casi and casi[k]:
            for c in sorted(casi[k], key=lambda c: -c.get('metri', 0))[:40]:
                print('      ' + ', '.join(f'{a}={b}' for a, b in c.items()))
    errori = E.errori()
    valori_b, casi_b, sopra_b = binari_tram.rapporto(binari_tram.rete_dati(mappa.M), SOGLIE_BINARI, args.elenco)
    valori_c, casi_c, errori_c = cavalcavia.rapporto(cavalcavia.rete_dati(mappa.M), args.elenco, aggiorna=args.aggiorna)
    if args.json:
        json.dump({'valori': valori, 'eccezioni': E.esiti, 'fermate': dove, 'casi': casi, 'marciapiedi_stretti_per_riquadro': stretto_per_riquadro,
                   'binari': {'valori': valori_b, 'soglie': SOGLIE_BINARI, 'casi': casi_b},
                   'cavalcavia': {'valori': valori_c, 'casi': casi_c}},
                  open(args.json, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if sopra_b:
        errori.append('Binari del tram sopra la soglia: ' + ', '.join(sopra_b))
    errori += errori_c
    if errori:
        print('\n'.join(errori))
        print('Con --elenco i casi di oggi, con le coordinate del gioco.')
        sys.exit(1)


if __name__ == '__main__':
    main()
