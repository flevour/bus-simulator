"""Quote lette per arco e per binario (#107, docs/cavalcavia.md sezione 7): quello che il gioco legge senza cercare.

Il gioco non ricava le quote per vicinanza: legge la quota di una strada da (arco, progressiva) e quella di un binario
da (binario, progressiva). Qui la build scrive tutte e due.

`edgeH`, una voce per arco in quota [arco, progressive in cm, quote in mm sopra il terreno]:
  * strutture con il profilo del risolutore (scripts/profilo_cavalcavia.py): il profilo, com'è;
  * cavalcavia con le quote di prima (street_surfaces.overpass_heights): i due capi dell'arco, lineare in mezzo.
Gli archi che non ci sono stanno a terra.

`tramH`, una voce per binario [linea, verso (+1, -1), progressive in cm, quote in mm]. Un binario su un cavalcavia
prende il profilo della strada che affianca: l'appartenenza (quale arco, in quale punto) si decide qui.
  * Strutture con il profilo del risolutore (`cavalcavia` nella mappa): la quota assoluta del binario è quella della
    strada nel punto dell'asse più vicino (terreno "via" lì più quota dell'arco); la quota scritta è quella meno il
    terreno "via" sotto il binario, campionato come lo campiona il gioco. Terreno più quota dà il profilo della strada
    anche dove il terreno sotto binario e carreggiata non è lo stesso (sotto le campate).
  * Cavalcavia con le quote di prima: la quota sopra il terreno della strada, con la media che faceva il gioco
    (`profilo`). Lì le carreggiate affiancate non hanno la stessa quota e il terreno è spianato solo fino a 8 m oltre
    la carreggiata; la media sparisce quando la struttura prende il profilo (#123).
La progressiva è quella lungo il binario dei dati (`tram` nella mappa per il SIR1, `percorso` di
data/tram-linee-nuove.json per le linee nuove, dal primo punto). Fuori dai tratti scritti la quota è zero.

Solo libreria standard, come scripts/cavalcavia.py, da cui prende la rete e il terreno.

    python3 scripts/quote_rete.py            # i tratti in quota dei binari della mappa che c'è
    python3 scripts/quote_rete.py --scrivi   # riscrive edgeH e tramH nella mappa che c'è, senza rigenerarla
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from binari_tram import Griglia, xz_da  # noqa: E402
from cavalcavia import IN_QUOTA, RADICE, Rete, Via, arco_accanto, punto  # noqa: E402

PASSO = 1.0       # m tra i punti lungo il binario (più i vertici e i confini di cella), sulle strutture con il profilo
TOLL = 0.002      # m: i punti che stanno entro questa quota dalla retta tra i vicini non si scrivono
# cavalcavia con le quote di prima: la regola di TramTrack.setHeights, che stava nel gioco
MEDIA_PASSO = 5.0  # m tra i punti
MEDIA = 5          # punti per parte nella media (25 m)
SOGLIA = 0.25      # m: sotto, il binario sta a terra
DOPPIO = 9.0       # m: fin qui il binario dell'altro verso corre affiancato (stesso impalcato)


def archi(nodes, edges, heights, profili=(), dichiarati=()):
    """`edgeH` completo: i profili delle strutture (`profili`: [arco, progressive, quote]) più, per gli archi in quota
    fuori dalle strutture con il profilo (`dichiarati`), i due capi con le quote dei nodi (`heights`: nodo -> m)."""
    out = {k: [k, ss, qs] for k, ss, qs in profili}
    for k, e in enumerate(edges):
        if k in out or k in dichiarati:
            continue
        ha, hb = heights.get(e[0], 0), heights.get(e[1], 0)
        if ha > IN_QUOTA or hb > IN_QUOTA:
            out[k] = [k, [0, max(1, round(math.dist(nodes[e[0]], nodes[e[1]]) * 100))], [round(ha * 1000), round(hb * 1000)]]
    return [out[k] for k in sorted(out)]


def tracce(M, nuove=None):
    """I binari della mappa: [(linea, verso, [(x, z)])], nelle coordinate e con le progressive che usa il gioco."""
    xz = xz_da(M['origin'])
    out = []
    if M.get('tramLanes'):
        for d, t in zip((1, -1), M['tram']):
            out.append(('SIR1', d, [(t[i], t[i + 1]) for i in range(0, len(t) - 1, 2)]))
    if nuove is None:
        p = os.path.join(RADICE, 'data/tram-linee-nuove.json')
        nuove = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {'linee': []}
    for L in nuove['linee']:
        for d, v in zip((1, -1), L['versi']):
            out.append((L['id'], d, [xz(*p) for p in v['percorso']]))
    return out


def _sfoltisci(ss, qs):
    """Toglie i punti che stanno sulla retta tra quello tenuto prima e quello dopo, entro TOLL."""
    keep = [0]
    for i in range(1, len(ss) - 1):
        a, b = keep[-1], i + 1
        ok = True
        for j in range(a + 1, b):
            v = qs[a] + (qs[b] - qs[a]) * (ss[j] - ss[a]) / ((ss[b] - ss[a]) or 1)
            if abs(v - qs[j]) > TOLL:
                ok = False
                break
        if not ok:
            keep.append(i)
    keep.append(len(ss) - 1)
    return [ss[i] for i in keep], [qs[i] for i in keep]


def _accanto(R, x, z, dx, dz):
    """(quota sopra il terreno, arco, frazione) della strada che il binario affianca in (x, z); (0, None, 0) a terra."""
    k, t, _d = arco_accanto(R, (x, z), (dx, dz))
    return (R.rel(k, t), k, t) if k is not None else (0.0, None, 0.0)


def _confini(G, P, cum):
    """Progressive dove il binario P attraversa un confine di cella della griglia del terreno G: lì la quota del
    terreno sotto il binario cambia pendenza (vicino alle spalle di un cavalcavia anche di molto)."""
    out = []
    for (a, b), c in zip(zip(P, P[1:]), cum):
        l = math.dist(a, b)
        for u, v, o in ((a[0], b[0], G.x0), (a[1], b[1], G.z0)):
            if abs(v - u) < 1e-9:
                continue
            lo, hi = sorted((u, v))
            for g in range(math.ceil((lo - o) / G.step), math.floor((hi - o) / G.step) + 1):
                t = (o + g * G.step - u) / (v - u)
                if 0 < t < 1:
                    out.append(c + t * l)
    return out


def profilo(R, P, O=None):
    """Quota sopra il terreno lungo il binario P: ([progressive in m], [quote in m], [arco affiancato o None]).
    O: il binario dell'altro verso della stessa linea.

    Strutture con il profilo: punti ogni PASSO metri, nei vertici e a ogni confine di cella del terreno, quota
    assoluta della strada meno il terreno sotto il binario. Cavalcavia con le quote di prima: la regola che aveva il gioco (TramTrack.setHeights), finché ci sono:
    punti ogni MEDIA_PASSO metri, la quota della strada (la più alta delle due dove i binari corrono affiancati: stanno
    sullo stesso impalcato), media su MEDIA punti per parte senza scendere sotto la strada, zero sotto SOGLIA. Lì le
    carreggiate affiancate non hanno la stessa quota e senza media il binario farebbe un gradino a ogni passaggio
    dall'una all'altra."""
    cum = [0.0]
    for a, b in zip(P, P[1:]):
        cum.append(cum[-1] + math.dist(a, b))
    L = cum[-1]
    go = Griglia(list(zip(O, O[1:])), 20.0) if O and len(O) > 1 else None
    s5 = [i * MEDIA_PASSO for i in range(int(L // MEDIA_PASSO) + 1)]
    raw, esatta, k5 = [], [], []
    for s in s5:
        x, z, dx, dz = punto(P, cum, s)
        h, k, _t = _accanto(R, x, z, dx, dz)
        e = k in R.dichiarati
        if not e and go:
            v = go.vicino((x, z), DOPPIO)
            if v:
                (ax, az), (bx, bz) = go.segmenti[v[1]]
                l2 = (bx - ax) ** 2 + (bz - az) ** 2 or 1
                t = max(0.0, min(1.0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2))
                h = max(h, _accanto(R, ax + (bx - ax) * t, az + (bz - az) * t, dx, dz)[0])
        raw.append(h)
        esatta.append(e)
        k5.append(k)
    n = len(s5)
    q5 = []
    for i in range(n):
        if esatta[i]:
            q5.append(raw[i])
            continue
        v = [raw[j] for j in range(i - MEDIA, i + MEDIA + 1) if 0 <= j < n]
        w = max(sum(v) / len(v), raw[i])
        q5.append(0.0 if w < SOGLIA else w)
    # tratti lungo le strutture con il profilo: punti fitti con la quota assoluta della strada
    pts = {s: (q, k) for s, q, k, e in zip(s5, q5, k5, esatta) if not e}
    i = 0
    while i < n:
        if not esatta[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and esatta[j + 1]:
            j += 1
        a, b = s5[i], s5[j]
        ss = {c for c in cum if a <= c <= b} | {a + m * PASSO for m in range(int((b - a) // PASSO) + 1)} | {b}
        ss |= {c for c in _confini(R.via, P, cum) if a <= c <= b}
        for s in ss:
            x, z, dx, dz = punto(P, cum, s)
            q, k, t = _accanto(R, x, z, dx, dz)
            if k in R.dichiarati:
                e = R.archi[k]
                (ax, az), (bx, bz) = R.nodi[e[0]], R.nodi[e[1]]
                q += R.via.at(ax + (bx - ax) * t, az + (bz - az) * t) - R.via.at(x, z)
            pts[s] = (max(0.0, q), k)
        i = j + 1
    ss = sorted(pts)
    return ss, [pts[s][0] for s in ss], [pts[s][1] for s in ss]


def quote(R, binari):
    """Per ogni binario [linea, verso, progressive in cm, quote in mm], solo i tratti in quota (con un punto a zero
    prima e dopo); e l'appartenenza: {(linea, verso): [(da, a, archi)]} in metri."""
    out, tratti = [], {}
    for lid, d, P in binari:
        altro = [Q for l2, d2, Q in binari if l2 == lid and d2 == -d]
        ss, qs, ks = profilo(R, P, altro[0] if altro else None)
        # tratti in quota
        su = [q > IN_QUOTA for q in qs]
        i, n, runs = 0, len(ss), []
        while i < n:
            if not su[i]:
                i += 1
                continue
            j = i
            while j + 1 < n and su[j + 1]:
                j += 1
            runs.append([i, j])
            i = j + 1
        S, Q, app = [], [], []
        for i, j in runs:
            a, b = max(0, i - 1), min(n - 1, j + 1)
            s1, q1 = _sfoltisci(ss[a:b + 1], [0.0 if (m < i or m > j) else qs[m] for m in range(a, b + 1)])
            if S and round(s1[0] * 100) <= S[-1]:
                s1, q1 = s1[1:], q1[1:]
            S += [round(s * 100) for s in s1]
            Q += [round(q * 1000) for q in q1]
            app.append((round(ss[i], 1), round(ss[j], 1), sorted({k for k in ks[i:j + 1] if k is not None})))
        if S:
            out.append([lid, d, S, Q])
            tratti[(lid, d)] = app
    return out, tratti


def calcola(M, nuove=None):
    """`tramH` per la mappa M (la rete con edgeH, cavalcavia e terreno già scritti)."""
    R = Rete('dati', M, Via(M['terrain']), None)
    return quote(R, tracce(M, nuove))


def main():
    """Stampa i tratti in quota dei binari; con --scrivi riscrive `edgeH` e `tramH` nella mappa che c'è
    (src/data/padova-map.json), senza rigenerarla: le quote dei nodi e i profili sono quelli già scritti."""
    p = os.path.join(RADICE, 'src/data/padova-map.json')
    M = json.load(open(p, encoding='utf-8'))
    n = M['nodes']
    nodi = [(n[i], n[i + 1]) for i in range(0, len(n), 2)]
    E = M['edges']
    dichiarati = {k for s in M.get('cavalcavia', []) for k in s['archi']}
    eh = archi(nodi, [E[k:k + 8] for k in range(0, len(E), 8)], {i: h for i, h in M.get('nodeH', [])},
               [v for v in M.get('edgeH', []) if v[0] in dichiarati], dichiarati)
    print(f"edgeH: {len(eh)} archi in quota ({sum(1 for v in eh if v[0] in dichiarati)} con il profilo della struttura)")
    M['edgeH'] = eh
    th, tratti = calcola(M)
    for (lid, d), app in sorted(tratti.items()):
        print(f"{lid} verso {'+1' if d > 0 else '-1'}: " + ', '.join(f'{a:.0f}-{b:.0f} m' for a, b, _k in app))
    if '--scrivi' in sys.argv:
        out = {}
        for k, v in M.items():
            if k != 'tramH':
                out[k] = v
            if k == 'cavalcavia':
                out['tramH'] = th
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        print('edgeH e tramH scritti in', p)


if __name__ == '__main__':
    main()
