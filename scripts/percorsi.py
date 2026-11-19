#!/usr/bin/env python3
"""Percorsi delle linee controllati nella build (#114, docs/percorsi.md).

Il percorso di ogni variante di ogni linea viene dall'aggancio del tracciato GTFS alla rete (build_map.py). Qui si
controlla che un bus lo possa guidare, passo per passo:

  * salti: due nodi di fila senza un arco tra loro (il tracciato passa dove la mappa non ha strade);
  * contromano: un arco a senso unico percorso contro il suo verso dove i bus non hanno la corsia in controsenso, o una
    via pedonale;
  * inversioni: il percorso torna indietro sullo stesso arco (A-B-A);
  * svolte vietate: una svolta che OSM vieta anche ai bus (svolte della mappa, docs/osm-dati.md sezione 5);
  * senza raccordo: una svolta ammessa che non ha un raccordo di corsia per il mezzo della linea (snodato per le linee
    di SNODATI, bus da 12 m per le altre: docs/raccordi.md). "solo auto" se il raccordo c'è ma con il raggio delle
    auto, "senza curva" se non ce n'è nessuno (#134).

Ogni caso ha la chiave "linea, variante, cosa, vie @ x,z" e si confronta con l'elenco dei casi noti in
data/eccezioni/percorsi.json (scripts/eccezioni.py): un caso fuori dall'elenco fa fallire il controllo, e build_map.py
lo lancia alla fine della build. Le svolte che non vanno (contromano, vietate, inversioni) non si contano anche come
svolte senza raccordo.

Uso:
    python3 scripts/percorsi.py              # rapporto e controlli sulla mappa che c'è
    python3 scripts/percorsi.py --elenco     # con i casi uno per uno
    python3 scripts/percorsi.py --aggiorna   # riscrive data/eccezioni/percorsi.json dai casi di oggi
"""
import json
import os
import sys
from collections import Counter, defaultdict

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RADICE, 'scripts'))
from raccordi import AUTO, BUS, BUS12, CORTO, SNODATI, SNODATO, Rete, capi, decodifica_sicura, percorso_bus, segmenti  # noqa: E402
from osm_rete import ECCETTO_BUS, OBBLIGO, SVOLTE  # noqa: E402

MAPPA = os.path.join(RADICE, 'src', 'data', 'padova-map.json')
ELENCO, COMANDO = 'percorsi', 'python3 scripts/percorsi.py --aggiorna'
TOLL = 3.0  # m: un caso dell'elenco resta lo stesso se si sposta fino a qui
CONTROLLI = ('salti', 'contromano', 'inversioni', 'svolte_vietate', 'senza_raccordo', 'corsie_slegate')


class Rete_bus:
    """Chi può fare cosa sulla rete della mappa, per i bus: archi tra due nodi, versi ammessi, svolte vietate."""

    def __init__(self, M):
        self.R = Rete(M)
        self.tra = {}
        for k, e in enumerate(self.R.archi):
            if self.R.lung[k] >= CORTO:
                self.tra.setdefault((e[0], e[1]), k)
                self.tra.setdefault((e[1], e[0]), k)
        self.divieti = defaultdict(list)  # (nodo, arco da) -> [(arco a, tipo, eccezioni)]
        for v in M.get('svolte', []):
            if len(v) == 5:  # quelle che passano da una via non valgono, come in scripts/raccordi.py
                self.divieti[(v[0], v[1])].append((v[2], v[3], v[4]))

    def passa(self, k, da_nodo):
        """Il bus percorre l'arco k partendo dal nodo da_nodo (sensi unici, corsie in controsenso, vie pedonali)."""
        return bool(self.R.chi(k, self.R.archi[k][0] == da_nodo) & BUS)

    def vietata(self, n, da, a):
        """Il tipo (indice in SVOLTE) della svolta di OSM che vieta ai bus la svolta da -> a nel nodo n, o None."""
        for verso, tipo, ecc in self.divieti.get((n, da), ()):
            if ecc & ECCETTO_BUS:
                continue
            if (verso == a) if tipo < OBBLIGO else (verso != a):
                return tipo
        return None


def cammino(ns):
    """I nodi della variante senza i nodi ripetuti di fila (expandSeq di src/data/padova.js)."""
    return [n for i, n in enumerate(ns) if i == 0 or n != ns[i - 1]]


def casi_percorsi(M, voci=None):
    """{controllo: [caso]} per tutte le varianti di tutte le linee della mappa M. voci: i raccordi decodificati (se
    mancano si leggono dal campo della mappa)."""
    B = Rete_bus(M)
    R = B.R
    casi = {k: [] for k in CONTROLLI}
    if voci is None:
        voci = decodifica_sicura(R, M['raccordi'], defaultdict(list)) if M.get('raccordi') else []
    catene = defaultdict(list)  # primo arco -> [(archi, classi)]
    partono = defaultdict(list)  # (nodo, arco da) -> raccordi del bus, con i capi (#135)
    for v in voci:
        catene[v['cat'][0][0]].append(([c[0] for c in v['cat']], v['classi']))
        if v['classi'] & BUS:
            partono[(v['nodo'], v['cat'][0][0])].append(dict(v, **dict(zip(('s0', 's1'), capi(R, v['cat'], v['v'], v['r'])))))
    nome = lambda k: R.nomi[R.archi[k][4]] or 'senza nome'
    svolte = 0
    for l in M['lines']:
        bit = SNODATO if l['id'] in SNODATI else BUS12
        for va in l['variants']:
            ns = cammino(va['nodes'])
            archi = [B.tra.get(p) for p in zip(ns, ns[1:])]
            visti = set()

            def caso(cosa, vie, n, chiave):
                if (cosa, chiave) in visti:
                    return
                visti.add((cosa, chiave))
                x, z = R.nodi[n]
                casi[cosa].append({'linea': l['id'], 'variante': va['headsign'], 'cosa': cosa, 'vie': vie, 'x': x, 'z': z})
            male = set()  # svolte (indice del nodo) già contate come contromano, salto, inversione o vietata
            for i, k in enumerate(archi):
                if k is None:
                    caso('salti', f'{ns[i]} > {ns[i + 1]}', ns[i], (ns[i], ns[i + 1]))
                    male |= {i, i + 1}
                elif not B.passa(k, ns[i]):
                    caso('contromano', nome(k) + (' (pedonale)' if R.archi[k][2] == 8 else ''), ns[i], k)
                    male |= {i, i + 1}
            for i in range(1, len(ns) - 1):
                da, a = archi[i - 1], archi[i]
                if da is None or a is None:
                    continue
                svolte += 1
                if ns[i - 1] == ns[i + 1]:
                    caso('inversioni', nome(da), ns[i], (ns[i], da))
                    male.add(i)
                    continue
                tipo = B.vietata(ns[i], da, a)
                if tipo is not None:
                    caso('svolte_vietate', f'{SVOLTE[tipo]}, {nome(da)} > {nome(a)}', ns[i], (ns[i], da, a))
                    male.add(i)
            # raccordi: una catena di archi del percorso servita da un raccordo per il mezzo della linea
            servita = [False] * len(ns)
            for i, k in enumerate(archi):
                for cat, m in catene.get(k, ()):
                    if m & bit and archi[i:i + len(cat)] == cat:
                        for j in range(i + 1, i + len(cat)):
                            servita[j] = True
            for i in range(1, len(ns) - 1):
                if servita[i] or i in male or archi[i - 1] is None or archi[i] is None:
                    continue
                da, a = archi[i - 1], archi[i]
                solo_auto = any(m & AUTO and c[:2] == [da, a] for c, m in catene.get(da, ()))
                caso('senza_raccordo', f"{'solo auto' if solo_auto else 'senza curva'}, {nome(da)} > {nome(a)}", ns[i], (ns[i], da, a))
            # corsie (#135): due svolte di fila con il raccordo del mezzo che, con i raccordi che percorsoBus sceglie (lo
            # rifà percorso_bus di scripts/raccordi.py), stanno su corsie diverse senza il posto per cambiarla o si
            # sovrappongono: il bus lì farebbe una curva del gioco. Quelle vicine a un ripiego sono di senza_raccordo
            if not any(k is None for k in archi):
                mm = percorso_bus(R, partono, segmenti(R, ns), bit)
                for p, m in zip(mm, mm[1:]):
                    if p[1] == m[0] and p[3] is None and m[3] is None and m[4] >= 100:
                        Q, V = p[2], m[2]
                        caso('corsie_slegate', f"{'raccordi sovrapposti' if m[4] >= 1000 else 'cambio di corsia senza posto'}, {nome(Q['cat'][0][0])} > {nome(V['cat'][-1][0])}",
                             V['nodo'], (V['nodo'], Q['cat'][0][0], V['cat'][-1][0]))
    return casi, svolte


def fissa(c):
    return f"linea {c['linea']}, {c['variante']}, {c['vie']}"


def rapporto(M, elenco=False, aggiorna=False, voci=None):
    """Controlli sui percorsi delle linee della mappa, caso per caso contro data/eccezioni/percorsi.json. Restituisce
    (valori, casi, righe degli errori)."""
    from eccezioni import Elenco, chiave
    casi, svolte = casi_percorsi(M, voci)
    varianti = sum(len(l['variants']) for l in M['lines'])
    valori = {k: len(v) for k, v in casi.items()}
    valori.update({'varianti': varianti, 'svolte': svolte})
    print(f'Percorsi delle linee: {varianti} varianti di {len(M["lines"])} linee, {svolte} svolte')
    E = Elenco(ELENCO, COMANDO)
    for k in CONTROLLI:
        E.confronta(k, [chiave(fissa(c), c['x'], c['z']) for c in casi[k]], TOLL, aggiorna)
        segno, esito = E.segno(k)
        extra = ''
        if k == 'senza_raccordo':
            extra = ' (' + ', '.join(f'{n} {p}' for p, n in Counter(c['vie'].split(',')[0] for c in casi[k]).most_common()) + ')' if casi[k] else ''
        print(f"  {segno} {k.replace('_', ' ')}: {len(casi[k])}{extra} ({esito})")
        if elenco:
            for c in casi[k][:300]:
                print(f"      linea {c['linea']}, {c['variante']}: {c['vie']} @ {c['x']:.0f},{c['z']:.0f}")
    if aggiorna:
        E.scrivi()
    return valori, casi, E.errori()


def main():
    M = json.load(open(MAPPA, encoding='utf-8'))
    _v, _c, errori = rapporto(M, '--elenco' in sys.argv, '--aggiorna' in sys.argv)
    if errori:
        print('\n'.join(errori))
        sys.exit(1)


if __name__ == '__main__':
    main()
