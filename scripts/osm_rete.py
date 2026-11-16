#!/usr/bin/env python3
"""Dati OSM agganciati alla rete della mappa per id (#108): quale via OSM è ogni arco, quale nodo OSM ogni nodo.

La rete (nodi e archi di src/data/padova-map.json) non porta gli id di OSM. `aggancia` li ritrova dalla rete e dallo
scarico delle vie (data/osm-padova.json, data/osm-corridoio.json), senza rifare la build: un nodo della rete è il nodo
OSM che ha le sue coordinate, un arco è il tratto di una via tra due suoi nodi di fila che stanno nella rete. Lo usano
lo strumento che scrive i campi nuovi nella mappa che c'è (scripts/tag_rete.py) e la build, che lo confronta con
l'aggancio vero (build_map.py sa da quale via viene ogni arco) e si ferma se non coincidono.

Solo libreria standard.
"""
import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_gtfs import xz  # noqa: E402  (la proiezione della build)

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPPA = os.path.join(RADICE, 'src', 'data', 'padova-map.json')
VIE = (os.path.join(RADICE, 'data', 'osm-padova.json'), os.path.join(RADICE, 'data', 'osm-corridoio.json'))
# classe dell'arco per tipo di strada: la prima colonna di build_map.DRIVE (la build controlla che coincidano)
CLASSE = {'trunk': 0, 'trunk_link': 0, 'primary': 1, 'primary_link': 1, 'secondary': 2, 'secondary_link': 2,
          'tertiary': 3, 'tertiary_link': 3, 'unclassified': 4, 'residential': 5, 'living_street': 6, 'service': 7,
          'pedestrian': 8}
CAMPI = 8  # numeri per arco in `edges`: a, b, classe, larghezza, nome, flag, velocità, livello


def leggi_vie(percorsi=VIE):
    """(vie carrabili degli scarichi, nell'ordine in cui le legge la build; id di tutte le vie degli scarichi)."""
    out, note = [], set()
    for p in percorsi:
        for e in json.load(open(p, encoding='utf-8'))['elements']:
            if e['type'] != 'way':
                continue
            note.add(e['id'])
            if 'geometry' in e and e.get('tags', {}).get('highway') in CLASSE:
                out.append(e)
    return out, note


def leggi_rete(M):
    """(nodi [(x, z)], archi [[a, b, classe, larghezza, nome, flag, velocità, livello]]) della mappa M."""
    n, E = M['nodes'], M['edges']
    return [(n[i], n[i + 1]) for i in range(0, len(n), 2)], [E[k:k + CAMPI] for k in range(0, len(E), CAMPI)]


def senso(t):
    """Senso unico della via: 1 nel verso della via, -1 contro, 0 doppio senso (come build_map.py)."""
    if t.get('oneway') in ('yes', '1') or t.get('junction') == 'roundabout':
        return 1
    return -1 if t.get('oneway') == '-1' else 0


class Aggancio:
    """arco_via[k]: id OSM della via dell'arco k (None se non trovata); via_archi[id]: i suoi archi nel verso della
    via (un arco va sempre da a verso b nel verso della via); nodo[id OSM]: nodo della rete; via[id]: l'elemento OSM."""

    def __init__(self, nodi, archi, nomi, vie):
        qui = defaultdict(list)
        for i, (x, z) in enumerate(nodi):
            qui[(round(x, 1), round(z, 1))].append(i)
        tra = defaultdict(list)  # (a, b) -> archi, in ordine
        for k, e in enumerate(archi):
            tra[(e[0], e[1])].append(k)
        self.nodi, self.archi = nodi, archi
        self.arco_via = [None] * len(archi)
        self.via_archi, self.nodo, self.via = {}, {}, {}
        self.doppi = 0  # archi contesi da più vie con gli stessi capi e gli stessi attributi
        self.coppie = {}  # (nodo OSM, nodo OSM dopo di lui lungo una via della rete) -> via
        for w in vie:
            t = w['tags']
            cls, nome, ow = CLASSE[t['highway']], t.get('name', ''), senso(t)
            dentro = []  # (nodo OSM, nodo della rete) lungo la via
            for n, g in zip(w['nodes'], w['geometry']):
                x, z = xz(g['lat'], g['lon'])
                p = (round(x, 1), round(z, 1))
                if p in qui:
                    dentro.append((n, qui[p]))
            presi = []
            for (na, ia), (nb, ib) in zip(dentro, dentro[1:]):
                liberi = [k for a in ia for b in ib for k in tra.get((a, b), ())
                          if self.arco_via[k] is None and archi[k][2] == cls and nomi[archi[k][4]] == nome
                          and (archi[k][5] & 3) == (1 if ow == 1 else 2 if ow == -1 else 0)]
                if not liberi:
                    continue
                k = liberi[0]
                self.doppi += len(liberi) > 1
                self.arco_via[k] = w['id']
                presi.append(k)
                self.nodo[na], self.nodo[nb] = archi[k][0], archi[k][1]
            if presi:
                self.via_archi.setdefault(w['id'], []).extend(presi)
                self.via[w['id']] = w
                for n1, n2 in zip(w['nodes'], w['nodes'][1:]):
                    self.coppie[(n1, n2)] = w['id']


# ---------------- tag delle vie, per arco ----------------
# Destra e sinistra sono quelle di chi va da a verso b (il verso della via OSM); la pendenza sale o scende da a verso b.

SOSTA_POSTO = {'no': 1, 'lane': 2, 'street_side': 3, 'on_kerb': 4, 'half_on_kerb': 5, 'shoulder': 6, 'separate': 7, 'yes': 8}
SOSTA_VERSO = {'parallel': 1, 'diagonal': 2, 'perpendicular': 3}
# schema vecchio parking:lane:<lato>: il valore dice il verso degli stalli (il posto non è detto) o il divieto
SOSTA_VECCHIA = {'no_parking': 1, 'no_stopping': 1, 'no': 1, 'marked': 8, 'yes': 8,
                 'parallel': 8 | 1 << 4, 'diagonal': 8 | 2 << 4, 'perpendicular': 8 | 3 << 4}
SUPERFICI = ('asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'unhewn_cobblestone', 'pebblestone',
             'compacted', 'fine_gravel', 'gravel', 'unpaved', 'ground', 'dirt', 'grass', 'grass_paver')
LISCIO = ('excellent', 'good', 'intermediate', 'bad', 'very_bad', 'horrible', 'very_horrible', 'impassable')
LATI = {'yes': 1, 'both': 1, 'dyke': 1, 'left': 2, 'right': 3}


def sosta_lato(t, lato):
    """Sosta su un lato della via (left o right): posto (SOSTA_POSTO) più verso degli stalli (SOSTA_VERSO) per 16;
    0 se OSM non dice niente. Lo schema nuovo (parking:<lato>) vale più del vecchio (parking:lane:<lato>)."""
    v = t.get(f'parking:{lato}', t.get('parking:both'))
    if v is not None:
        v = 'yes' if v == 'marked' else v  # "marked" è dello schema vecchio, usato a volte nel nuovo: stalli segnati
        if v not in SOSTA_POSTO:
            return 0
        verso = t.get(f'parking:{lato}:orientation', t.get('parking:both:orientation'))
        return SOSTA_POSTO[v] | (SOSTA_VERSO.get(verso, 0) << 4 if v != 'no' else 0)
    return SOSTA_VECCHIA.get(t.get(f'parking:lane:{lato}', t.get('parking:lane:both')), 0)


def sosta(A):
    """[arco, sinistra, destra] per gli archi delle vie con i tag di sosta."""
    out = []
    for w, ks in A.via_archi.items():
        t = A.via[w]['tags']
        sx, dx = sosta_lato(t, 'left'), sosta_lato(t, 'right')
        if sx or dx:
            out += [[k, sx, dx] for k in ks]
    return sorted(out)


def rilevati(A):
    """[arco, rilevato, trincea] per gli archi delle vie con embankment o cutting: 1 sui due lati, 2 solo a sinistra,
    3 solo a destra, 0 no."""
    out = []
    for w, ks in A.via_archi.items():
        t = A.via[w]['tags']
        r, c = LATI.get(t.get('embankment'), 0), LATI.get(t.get('cutting'), 0)
        if r or c:
            out += [[k, r, c] for k in ks]
    return sorted(out)


def pendenza(v):
    """(verso, percento) di un tag incline: verso 1 sale, -1 scende, 0 in piano; percento 0 se OSM dice solo il verso.
    None se il valore non si legge."""
    if v in ('up', 'down'):
        return (1 if v == 'up' else -1, 0)
    try:
        p = float(v.rstrip('%°').replace(',', '.'))
    except ValueError:
        return None
    if v.endswith('°'):
        p = math.tan(math.radians(p)) * 100
    p = round(p, 1)
    return ((p > 0) - (p < 0), abs(int(p) if p == int(p) else p))


def pendenze(A):
    """[arco, verso, percento] per gli archi delle vie con incline (pendenza dichiarata)."""
    out = []
    for w, ks in A.via_archi.items():
        p = pendenza(A.via[w]['tags'].get('incline', ''))
        if p:
            out += [[k, p[0], p[1]] for k in ks]
    return sorted(out)


def fondo(A):
    """Superficie, regolarità e illuminazione di tutti gli archi, in corse di archi di fila con gli stessi valori:
    {"superfici": legenda, "regolarita": legenda, "corse": [quanti archi, superficie, regolarità, luce, ...]}.
    Superficie e regolarità: posto nella legenda più uno, 0 se OSM non lo dice; luce: 1 illuminata, 2 no, 0 non detto."""
    corse = []
    for w in A.arco_via:
        t = A.via[w]['tags'] if w is not None else {}
        s, q = t.get('surface'), t.get('smoothness')
        v = (SUPERFICI.index(s) + 1 if s in SUPERFICI else 0, LISCIO.index(q) + 1 if q in LISCIO else 0,
             {'yes': 1, 'no': 2}.get(t.get('lit'), 0))
        if corse and corse[-1][1:] == v:
            corse[-1] = (corse[-1][0] + 1,) + v
        else:
            corse.append((1,) + v)
    return {'superfici': list(SUPERFICI), 'regolarita': list(LISCIO), 'corse': [x for c in corse for x in c]}


# ---------------- svolte vietate e obbligate ----------------

SVOLTE = ('no_left_turn', 'no_right_turn', 'no_straight_on', 'no_u_turn', 'only_left_turn', 'only_right_turn',
          'only_straight_on', 'no_entry', 'no_exit')
OBBLIGO = 4  # da qui in SVOLTE le svolte obbligate (only_*), fino a 6
ECCETTO_BUS, A_ORARIO, ECCETTO_FRONTISTI = 1, 2, 4
# perché una relazione non si aggancia
FUORI = 'fuori dalla rete'
INCOMPLETA = 'relazione incompleta in OSM'
TIPO_IGNOTO = 'tipo non letto'
ALTRI_MEZZI = 'vale solo per altri mezzi'
CAMBIATA = 'via che non è negli scarichi'
NON_IN_RETE = 'via dello scarico fuori dalla rete'
NODO_PERSO = 'nodo via fuori dalla rete'
IN_MEZZO = 'nodo via in mezzo a una via a doppio senso'
CONTROMANO = 'via a senso unico nel verso sbagliato'
STACCATA = 'via che non tocca il nodo via'


def _capi(A, w, nodo, arriva):
    """Archi della via w che arrivano al nodo (arriva) o ne partono, per chi rispetta il senso unico:
    [(arco, verso)] con verso 1 se l'arco si percorre da a verso b."""
    ow = senso(A.via[w]['tags'])
    out = []
    for k in A.via_archi[w]:
        a, b = A.archi[k][:2]
        # in avanti si arriva in b e si parte da a; all'indietro il contrario
        if ow >= 0 and (b if arriva else a) == nodo:
            out.append((k, 1))
        if ow <= 0 and (a if arriva else b) == nodo:
            out.append((k, -1))
    return out


def _capi_vicini(A, via_osm, vicini, arriva):
    """Come _capi, ma dal nodo OSM `via_osm` e dai nodi che gli stanno accanto nella via di oggi: l'arco è quello della
    via dello scarico che ha quei due nodi di fila."""
    nodo, out = A.nodo.get(via_osm), []
    for p in vicini:
        for (n1, n2), prima in (((p, via_osm), True), ((via_osm, p), False)):
            w = A.coppie.get((n1, n2))
            if w is None:
                continue
            # p prima del nodo lungo la via: l'arco finisce nel nodo; dopo: comincia dal nodo
            for k, verso in _capi(A, w, nodo, arriva):
                if (A.archi[k][1] if prima else A.archi[k][0]) == nodo and (k, verso) not in out:
                    out.append((k, verso))
    return out


def _tocca(A, w, nodo):
    return any(nodo in A.archi[k][:2] for k in A.via_archi[w])


def svolte(A, relazioni, note):
    """Aggancia le relazioni type=restriction agli archi per id della via.

    Una via che non è più quella dello scarico (id sparito, o la via dello scarico passa dal nodo "via" e quella di oggi
    ci finisce) si aggancia dai nodi accanto al nodo "via" (da_vicini, a_vicini). `per_nodi` conta le relazioni
    agganciate così.

    Restituisce (voci, id, scarti, per_nodi): voci [nodo, arco da, arco a, tipo, eccezioni] (più [archi via] quando la svolta
    passa da una o più vie), una per relazione agganciata, in ordine di nodo; id delle relazioni, in parallelo;
    scarti {id: (perché, nodo della rete o None)} per le altre. tipo: posto in SVOLTE (da OBBLIGO in su è una svolta
    obbligata: dall'arco "da" in quel nodo si può prendere solo l'arco "a"); eccezioni: somma di ECCETTO_BUS,
    A_ORARIO (vale solo in certe ore), ECCETTO_FRONTISTI. `note`: id di tutte le vie degli scarichi."""
    voci, scarti, per_nodi = [], {}, []
    for r in relazioni:
        rid = r['id']
        membri = r['da'] + r['a'] + r['via_vie']
        vn = A.nodo.get(r['via_nodo'][0]) if len(r['via_nodo']) == 1 else None
        in_rete = [w for w in membri if w in A.via_archi]
        if not in_rete and vn is None:
            scarti[rid] = (FUORI, None)
            continue
        qui = vn if vn is not None else A.archi[A.via_archi[in_rete[0]][0]][0]
        if len(r['da']) != 1 or len(r['a']) != 1 or bool(r['via_nodo']) == bool(r['via_vie']) or len(r['via_nodo']) > 1:
            scarti[rid] = (INCOMPLETA, qui)
            continue
        tipo = r['tipo'] or (r.get('orario', '').split('@')[0].strip())
        if tipo not in SVOLTE:
            scarti[rid] = (ALTRI_MEZZI if r.get('mezzi') else TIPO_IGNOTO, qui)
            continue
        da, a = r['da'][0], r['a'][0]
        if not r['via_vie'] and vn is not None:
            # svolta in un nodo: per id della via, o dai nodi accanto se la via è cambiata
            capi, come = [], []
            for w, vicini, arriva in ((da, r.get('da_vicini', []), True), (a, r.get('a_vicini', []), False)):
                c = _capi(A, w, vn, arriva) if w in A.via_archi else []
                if len(c) != 1 and (w not in note or len(c) > 1):
                    c2 = _capi_vicini(A, r['via_nodo'][0], vicini, arriva)
                    if len(c2) == 1 or not c:
                        c, come = c2, come + [w]
                capi.append(c)
            e, u = capi
            if not e or not u:
                perche = (CAMBIATA if any(w not in note for w in membri) else NON_IN_RETE if any(w not in A.via_archi for w in membri)
                          else STACCATA if not _tocca(A, da, vn) or not _tocca(A, a, vn) else CONTROMANO)
                scarti[rid] = (perche, vn)
                continue
            if len(e) > 1 or len(u) > 1:
                scarti[rid] = (IN_MEZZO, vn)
                continue
            if come:
                per_nodi.append(rid)
            voci.append((_voce(r, vn, e[0][0], u[0][0], tipo, []), rid))
            continue
        if any(w not in note for w in membri):
            scarti[rid] = (CAMBIATA, qui)
            continue
        if any(w not in A.via_archi for w in membri):
            scarti[rid] = (NON_IN_RETE, qui)
            continue
        via = []
        if r['via_vie']:
            # catena da -> vie via -> a: il nodo della voce è quello dove si lascia la via "da"
            n1 = None
            for prima, w in zip([da] + r['via_vie'], r['via_vie']):
                ns = {n for k in A.via_archi[w] for n in A.archi[k][:2]}
                comuni = ns & {n for k in A.via_archi[prima] for n in A.archi[k][:2]}
                dopo = a if w == r['via_vie'][-1] else r['via_vie'][r['via_vie'].index(w) + 1]
                fine = ns & {n for k in A.via_archi[dopo] for n in A.archi[k][:2]}
                if len(comuni) != 1 or len(fine) != 1:
                    n1 = None
                    break
                i, f = next(iter(comuni)), next(iter(fine))
                if n1 is None:
                    n1 = i
                # gli archi della via tra i due nodi, nel verso in cui si percorrono
                ks = A.via_archi[w]
                pos = {A.archi[k][0]: j for j, k in enumerate(ks)}
                pos.setdefault(A.archi[ks[-1]][1], len(ks))
                if i not in pos or f not in pos or i == f:
                    n1 = None
                    break
                via += ks[pos[i]:pos[f]] if pos[i] < pos[f] else ks[pos[f]:pos[i]][::-1]
                nf = f
            if n1 is None:
                scarti[rid] = (STACCATA, qui)
                continue
            vn, esce = n1, nf
        else:
            esce = vn
            if vn is None:
                scarti[rid] = (NODO_PERSO, qui)
                continue
        if not _tocca(A, da, vn) or not _tocca(A, a, esce):
            scarti[rid] = (STACCATA, vn)
            continue
        e, u = _capi(A, da, vn, True), _capi(A, a, esce, False)
        if not e or not u:
            scarti[rid] = (CONTROMANO, vn)
            continue
        if len(e) > 1 or len(u) > 1:
            # inversione sulla stessa via che passa dal nodo: OSM non dice da quale parte si arriva
            scarti[rid] = (IN_MEZZO, vn)
            continue
        voci.append((_voce(r, vn, e[0][0], u[0][0], tipo, via), rid))
    voci.sort(key=lambda v: (v[0][:3], v[1]))
    return [v for v, _i in voci], [i for _v, i in voci], scarti, per_nodi


def _voce(r, nodo, da, a, tipo, via):
    ecc = set(r.get('eccetto', '').replace(',', ';').split(';'))
    flag = ((ECCETTO_BUS if ecc & {'psv', 'bus'} else 0) | (A_ORARIO if not r['tipo'] else 0)
            | (ECCETTO_FRONTISTI if 'destination' in ecc else 0))
    return [nodo, da, a, SVOLTE.index(tipo), flag] + ([via] if via else [])


def leggi_relazioni(percorso=None):
    return json.load(open(percorso or os.path.join(RADICE, 'data', 'osm-padova-relazioni.json'), encoding='utf-8'))


# ---------------- campi della mappa, controlli, rapporto ----------------

CAMPI_MAPPA = ('svolte', 'sosta', 'rilevati', 'pendenze', 'fondo')
DOPO = 'turnLanes'  # nella mappa i campi stanno dopo questo
TOLL = 3.0  # m entro cui un caso è lo stesso di uno dell'elenco
ELENCO = 'osm-rete'
COMANDO = 'python3 scripts/osm_rete.py --aggiorna'


def campi(A, relazioni, note):
    """I campi che la mappa porta dai dati OSM agganciati per id, e quello che serve ai controlli."""
    voci, ids, scarti, per_nodi = svolte(A, relazioni['svolte'], note)
    c = {'svolte': voci, 'sosta': sosta(A), 'rilevati': rilevati(A), 'pendenze': pendenze(A), 'fondo': fondo(A)}
    return c, {'id': ids, 'scarti': scarti, 'per_nodi': per_nodi}


def campi_mappa(M, vie=None, note=None, relazioni=None):
    """(campi, info, aggancio) per la mappa M dagli scarichi di data/."""
    if vie is None:
        vie, note = leggi_vie()
    nodi, archi = leggi_rete(M)
    A = Aggancio(nodi, archi, M['names'], vie)
    c, info = campi(A, relazioni or leggi_relazioni(), note)
    return c, info, A


def angolo(A, nodo, da, a):
    """Gradi della svolta dall'arco da all'arco a nel nodo: negativi a sinistra (z verso sud), 0 diritto."""
    ea, eb = A.archi[da], A.archi[a]
    p, q = A.nodi[ea[0] if ea[1] == nodo else ea[1]], A.nodi[eb[1] if eb[0] == nodo else eb[0]]
    n = A.nodi[nodo]
    ux, uz, wx, wz = n[0] - p[0], n[1] - p[1], q[0] - n[0], q[1] - n[1]
    return math.degrees(math.atan2(ux * wz - uz * wx, ux * wx + uz * wz))


def incoerenti(A, voci, ids):
    """Svolte agganciate che non vanno dalla parte che il loro tipo dice (oltre 10 gradi dalla parte giusta per destra
    e sinistra, entro 70 dal diritto, oltre 110 per l'inversione): un aggancio sbagliato o un errore in OSM."""
    out = []
    for v, rid in zip(voci, ids):
        if len(v) > 5:
            continue
        t, g = SVOLTE[v[3]], angolo(A, *v[:3])
        ok = g < -10 if 'left' in t else g > 10 if 'right' in t else abs(g) < 70 if 'straight' in t else abs(g) > 110 if 'u_turn' in t else True
        if not ok:
            out.append({'relazione': rid, 'tipo': t, 'gradi': round(g), 'x': A.nodi[v[0]][0], 'z': A.nodi[v[0]][1]})
    return out


def percorsi_vietati(A, M, voci, ids):
    """Varianti delle linee dei bus che passano da una svolta vietata, o che dove la svolta è obbligata ne fanno
    un'altra. Non contano le svolte da cui i bus sono esclusi (except=psv|bus) e quelle che passano da una via."""
    tra, per = defaultdict(list), defaultdict(list)
    for k, e in enumerate(A.archi):
        tra[(e[0], e[1])].append(k)
        tra[(e[1], e[0])].append(k)
    for v, rid in zip(voci, ids):
        if len(v) == 5 and not v[4] & ECCETTO_BUS:
            per[(v[0], v[1])].append((v, rid))
    out, visti = [], set()
    for l in M['lines']:
        for va in l['variants']:
            ns = va['nodes']
            for a, b, c in zip(ns, ns[1:], ns[2:]):
                for k in tra.get((a, b), ()):
                    for v, rid in per.get((b, k), ()):
                        esce = tra.get((b, c), ())
                        vietata = (v[2] not in esce) if OBBLIGO <= v[3] < OBBLIGO + 3 else (v[2] in esce)
                        if vietata and esce and (l['id'], rid) not in visti:
                            visti.add((l['id'], rid))
                            out.append({'linea': l['id'], 'variante': va['headsign'], 'relazione': rid, 'tipo': SVOLTE[v[3]],
                                        'da': M['names'][A.archi[v[1]][4]], 'verso': M['names'][A.archi[esce[0]][4]],
                                        'a_orario': bool(v[4] & A_ORARIO), 'x': A.nodi[b][0], 'z': A.nodi[b][1]})
    return out


def rapporto(M, elenco=False, aggiorna=False):
    """Controlli sui dati OSM agganciati alla rete, caso per caso contro data/eccezioni/osm-rete.json:
    * i campi della mappa sono quelli che danno gli scarichi di oggi (chi cambia rete o scarichi li riscrive);
    * svolte che toccano la rete e non si agganciano, con il perché nella chiave;
    * svolte agganciate che non vanno dalla parte che dicono;
    * percorsi dei bus che passano da una svolta vietata.
    Restituisce (valori, casi, righe degli errori)."""
    from eccezioni import Elenco, chiave
    c, info, A = campi_mappa(M)
    errori = [f'  {k}: nella mappa non è quello che danno gli scarichi di data/ (python3 scripts/osm_rete.py --scrivi)'
              for k in CAMPI_MAPPA if M.get(k) != c[k]]
    if errori:
        errori.insert(0, 'Campi OSM della mappa diversi dagli scarichi:')
    casi = {
        'svolte_non_agganciate': [{'perche': p, 'relazione': rid, 'x': A.nodi[n][0], 'z': A.nodi[n][1]}
                                  for rid, (p, n) in sorted(info['scarti'].items()) if p != FUORI],
        'svolte_incoerenti': incoerenti(A, c['svolte'], info['id']),
        'percorsi_su_svolta_vietata': percorsi_vietati(A, M, c['svolte'], info['id']),
    }
    fissa = {'svolte_non_agganciate': lambda k: f"{k['perche']}, relazione {k['relazione']}",
             'svolte_incoerenti': lambda k: f"{k['tipo']}, relazione {k['relazione']}",
             'percorsi_su_svolta_vietata': lambda k: f"linea {k['linea']}, relazione {k['relazione']}"}
    E = Elenco(ELENCO, COMANDO)
    print(f"Dati OSM agganciati alla rete: {len(c['svolte'])} svolte ({len(info['per_nodi'])} dai nodi accanto), "
          f"sosta su {len(c['sosta'])} archi, rilevati e trincee {len(c['rilevati'])}, pendenze {len(c['pendenze'])}")
    for k, f in fissa.items():
        E.confronta(k, [chiave(f(x), x['x'], x['z']) for x in casi[k]], TOLL, aggiorna)
        segno, esito = E.segno(k)
        print(f"  {segno} {k.replace('_', ' ')}: {len(casi[k])} ({esito})")
        if elenco:
            for x in casi[k][:60]:
                print('      ' + ', '.join(f'{a}={b}' for a, b in x.items()))
    if aggiorna:
        E.scrivi()
    return {k: len(v) for k, v in casi.items()}, casi, errori + E.errori()


def scrivi(M, c, percorso=MAPPA):
    """Riscrive nella mappa i soli campi OSM, senza rigenerarla."""
    out = {}
    for k, v in M.items():
        if k not in CAMPI_MAPPA:
            out[k] = v
        if k == DOPO:
            out.update({q: c[q] for q in CAMPI_MAPPA})
    with open(percorso, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))


def conti(M, c, info, A):
    """Le righe del rapporto di docs/osm-dati.md: quante vie, archi e chilometri della rete hanno ogni dato."""
    km = [math.dist(A.nodi[e[0]], A.nodi[e[1]]) / 1000 for e in A.archi]
    tot = sum(km)
    vie_arco = A.arco_via
    righe = [f'rete: {len(A.archi)} archi, {len(A.via_archi)} vie OSM, {tot:.0f} km; archi senza via {vie_arco.count(None)}']

    def riga(nome, archi):
        archi = set(archi)
        vie = {vie_arco[k] for k in archi}
        righe.append(f'{nome}: {len(vie)} vie, {len(archi)} archi, {sum(km[k] for k in archi):.1f} km ({100 * sum(km[k] for k in archi) / tot:.1f}%)')

    def con(pred):
        return [k for k, w in enumerate(vie_arco) if w is not None and pred(A.via[w]['tags'])]
    riga('sosta detta (anche "vietata")', [v[0] for v in c['sosta']])
    riga('sosta ammessa su almeno un lato', [v[0] for v in c['sosta'] if any(x & 15 > 1 for x in v[1:])])
    riga('rilevato', [v[0] for v in c['rilevati'] if v[1]])
    riga('trincea', [v[0] for v in c['rilevati'] if v[2]])
    riga('pendenza dichiarata', [v[0] for v in c['pendenze']])
    riga('pendenza con il valore', [v[0] for v in c['pendenze'] if v[2] or not v[1]])
    riga('superficie', con(lambda t: t.get('surface') in SUPERFICI))
    riga('superficie non asfalto', con(lambda t: t.get('surface') in SUPERFICI[3:]))
    riga('regolarità', con(lambda t: t.get('smoothness') in LISCIO))
    riga('illuminazione detta', con(lambda t: t.get('lit') in ('yes', 'no')))
    riga('illuminata', con(lambda t: t.get('lit') == 'yes'))
    for nome, pred in (('cycleway:*', lambda t: any(k == 'cycleway' or k.startswith('cycleway:') for k in t)),
                       ('access, vehicle o motor_vehicle', lambda t: any(k in t for k in ('access', 'vehicle', 'motor_vehicle'))),
                       ('divieti a orario (*:conditional)', lambda t: any(k.endswith(':conditional') for k in t)),
                       ('maxheight', lambda t: 'maxheight' in t), ('maxweight', lambda t: 'maxweight' in t),
                       ('maxwidth', lambda t: 'maxwidth' in t), ('destination', lambda t: 'destination' in t)):
        riga(nome + ' (non nella mappa)', con(pred))
    from collections import Counter
    n = Counter(p for p, _n in info['scarti'].values())
    righe.append(f"svolte: {len(c['svolte'])} agganciate ({len(info['per_nodi'])} dai nodi accanto), "
                 + ', '.join(f'{v} {k}' for k, v in n.most_common()))
    righe.append('svolte per tipo: ' + ', '.join(f'{v} {SVOLTE[k]}' for k, v in Counter(v[3] for v in c['svolte']).most_common()))
    righe.append(f"nodi con una svolta: {len({v[0] for v in c['svolte']})}; con eccezione per i bus {sum(1 for v in c['svolte'] if v[4] & ECCETTO_BUS)}, "
                 f"a orario {sum(1 for v in c['svolte'] if v[4] & A_ORARIO)}, che passano da una via {sum(1 for v in c['svolte'] if len(v) > 5)}")
    # linee: quanta parte del percorso agganciato al GTFS sta sulle vie della relazione OSM della stessa linea
    tra = {}
    for k, e in enumerate(A.archi):
        tra[(e[0], e[1])] = tra[(e[1], e[0])] = k
    rel = defaultdict(set)
    for r in leggi_relazioni()['linee']:
        if r['mezzo'] == 'bus':
            rel[r['linea']] |= set(r['vie'])
    for l in M['lines']:
        ks = {tra[p] for v in l['variants'] for p in zip(v['nodes'], v['nodes'][1:]) if p in tra}
        if l['id'] in rel:
            su = sum(km[k] for k in ks if vie_arco[k] in rel[l['id']])
            righe.append(f"linea {l['id']}: {sum(km[k] for k in ks):.1f} km di percorso, {100 * su / max(1e-9, sum(km[k] for k in ks)):.0f}% sulle vie della relazione OSM")
        else:
            righe.append(f"linea {l['id']}: nessuna relazione OSM")
    # barriere in carreggiata: nodi di una via della rete
    p = os.path.join(RADICE, 'data', 'osm-arredo.json')
    if os.path.exists(p):
        in_rete = {n for w in A.via.values() for n in w['nodes']}
        b = Counter(x[3] for x in json.load(open(p, encoding='utf-8'))['barriere'] if x[0] in in_rete)
        righe.append('barriere su un nodo di una via della rete: ' + ', '.join(f'{v} {k}' for k, v in b.most_common()))
    return righe


def main():
    """Senza argomenti stampa il rapporto e i controlli; --scrivi riscrive i campi nella mappa che c'è; --aggiorna
    riscrive l'elenco delle eccezioni; --elenco stampa i casi."""
    M = json.load(open(MAPPA, encoding='utf-8'))
    if '--scrivi' in sys.argv:
        c, info, A = campi_mappa(M)
        prima = os.path.getsize(MAPPA)
        scrivi(M, c)
        print(f'campi {", ".join(CAMPI_MAPPA)} scritti in {os.path.relpath(MAPPA, RADICE)}: da {prima} a {os.path.getsize(MAPPA)} byte; '
              + ', '.join(f"{k} {len(json.dumps(c[k], separators=(',', ':')))}" for k in CAMPI_MAPPA))
        M = json.load(open(MAPPA, encoding='utf-8'))
    c, info, A = campi_mappa(M)
    print('\n'.join(conti(M, c, info, A)))
    _v, _c, errori = rapporto(M, '--elenco' in sys.argv, '--aggiorna' in sys.argv)
    if errori:
        print('\n'.join(errori))
        sys.exit(1)


if __name__ == '__main__':
    main()
