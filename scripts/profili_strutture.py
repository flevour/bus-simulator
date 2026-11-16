"""Profili dei cavalcavia, struttura per struttura, scritti nel repository (#107, docs/cavalcavia.md sezione 7).

data/profili-cavalcavia.json ha, per ogni struttura, la quota assoluta (terreno "via" più quota sopra il terreno, come
la vede chi guida) lungo i suoi archi e lungo i binari che ci passano sopra, in centimetri:

  {"strutture": {"<id>": {"archi": [[ax, az, bx, bz, [progressive in cm], [quote in cm]], ...],
                          "binari": [[linea, verso, [progressive in cm], [quote in cm]], ...]}}}

Una struttura è un cavalcavia con il profilo del risolutore (`cavalcavia` nella mappa: tutti i suoi archi, anche le
rampe a terra sul rilevato) o un gruppo di archi in quota che si toccano (i cavalcavia con le quote di prima), con il
nome che gli dà scripts/cavalcavia.py. Le progressive degli archi sono quelle di `edgeH` (ogni 10 m per gli archi a
terra), quelle dei binari sono lungo il binario dei dati, come in `tramH`.

Lo script confronta i profili della mappa con quelli del file ed esce con errore se una struttura è cambiata (una
quota oltre TOLL centimetri, un arco o un tratto di binario in più o in meno), nominandola: una modifica alle quote di
una struttura va dichiarata riscrivendo il file nello stesso commit, e il diff dice quali strutture tocca.

    python3 scripts/profili_strutture.py              # confronta
    python3 scripts/profili_strutture.py --aggiorna   # riscrive il file dai profili di oggi

Lo usa tests/profili.spec.js, che controlla anche che il gioco legga le stesse quote. Solo libreria standard.
"""
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import quote_rete  # noqa: E402
from cavalcavia import RADICE, cavalcavia, lineare, punto, rete_dati  # noqa: E402

FILE = os.path.join(RADICE, 'data/profili-cavalcavia.json')
TOLL = 1          # cm: una quota resta la stessa fino a qui
PASSO_TERRA = 10.0  # m tra i punti lungo gli archi a terra delle strutture con il profilo
ALTRI = 'altri archi in quota'


def profili(R=None):
    """{id della struttura: {'archi': [...], 'binari': [...]}} dalla mappa (R: la rete dei dati)."""
    R = R or rete_dati()
    di, out = {}, {}
    for c in cavalcavia(R):
        out[c['id']] = {'archi': [], 'binari': []}
        for k in c['archi']:
            di[k] = c['id']
    for k in sorted(set(R.EH or ()) | R.dichiarati):
        e = R.archi[k]
        (ax, az), (bx, bz) = R.nodi[e[0]], R.nodi[e[1]]
        p = (R.EH or {}).get(k)
        if p:
            ss = list(p[0])
        else:
            n = max(1, round(R.lung[k] / PASSO_TERRA))
            ss = [round(R.lung[k] * 100 * i / n) for i in range(n + 1)]
        L = ss[-1] or 1
        qs = [round((R.via.at(ax + (bx - ax) * s / L, az + (bz - az) * s / L) + R.rel(k, s / L)) * 100) for s in ss]
        out.setdefault(di.get(k, ALTRI), {'archi': [], 'binari': []})['archi'].append([ax, az, bx, bz, ss, qs])
    binari = quote_rete.tracce(R.M)
    th = {(lid, d): (ss, qs) for lid, d, ss, qs in R.M.get('tramH', [])}
    _th, tratti = quote_rete.quote(R, binari)
    for lid, d, P in binari:
        if (lid, d) not in th:
            continue
        cum = [0.0]
        for a, b in zip(P, P[1:]):
            cum.append(cum[-1] + ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5)
        ss, qs = th[(lid, d)]
        sm, qm = [s / 100 for s in ss], [q / 1000 for q in qs]
        for a, b, ks in tratti.get((lid, d), []):
            conta = Counter(di[k] for k in ks if k in di)
            if not conta:
                continue
            pts = [s for s in ss if a * 100 - 1 <= s <= b * 100 + 1]
            quote = []
            for s in pts:
                x, z, _dx, _dz = punto(P, cum, s / 100)
                quote.append(round((R.via.at(x, z) + lineare(sm, qm, s / 100)) * 100))
            out[conta.most_common(1)[0][0]]['binari'].append([lid, d, pts, quote])
    for v in out.values():
        v['archi'].sort(key=lambda a: a[:4])
        v['binari'].sort(key=lambda b: (b[0], -b[1], b[2][0]))
    return {k: out[k] for k in sorted(out) if out[k]['archi'] or out[k]['binari']}


def _uguali(a, b):
    """Due profili (progressive e quote) sono gli stessi: stesse progressive, quote entro TOLL."""
    return a[-2] == b[-2] and len(a[-1]) == len(b[-1]) and all(abs(x - y) <= TOLL for x, y in zip(a[-1], b[-1]))


def confronta(oggi, scritti):
    """[(struttura, cosa è cambiato)] tra i profili di oggi e quelli del file."""
    out = []
    for sid in sorted(set(oggi) | set(scritti)):
        if sid not in scritti:
            out.append((sid, 'struttura nuova'))
            continue
        if sid not in oggi:
            out.append((sid, 'struttura sparita'))
            continue
        for cosa, chiave in (('archi', lambda a: tuple(a[:4])), ('binari', lambda b: (b[0], b[1], b[2][0]))):
            A = {chiave(a): a for a in oggi[sid][cosa]}
            B = {chiave(a): a for a in scritti[sid][cosa]}
            diversi = [k for k in A if k in B and not _uguali(A[k], B[k])]
            piu, meno = len(set(A) - set(B)), len(set(B) - set(A))
            if diversi or piu or meno:
                peggio = max((abs(x - y) for k in diversi for x, y in zip(A[k][-1], B[k][-1])), default=0)
                out.append((sid, f"{cosa}: {len(diversi)} con la quota cambiata" + (f' (fino a {peggio} cm)' if peggio else '')
                            + (f', {piu} in più' if piu else '') + (f', {meno} in meno' if meno else '')))
    return out


def scrivi(P, path=FILE):
    """Un arco e un tratto di binario per riga, così il diff dice cosa cambia."""
    righe = ['{"cosa": "Profili dei cavalcavia per struttura: quota assoluta in cm lungo gli archi [ax, az, bx, bz, progressive in cm, '
             'quote] e lungo i binari [linea, verso, progressive in cm, quote]. Lo riscrive scripts/profili_strutture.py --aggiorna; '
             'una struttura che cambia qui va nominata nel commit (docs/cavalcavia.md, sezione 7).",', ' "strutture": {']
    ids = list(P)
    for n, sid in enumerate(ids):
        righe.append(f'  {json.dumps(sid, ensure_ascii=False)}: {{')
        for cosa in ('archi', 'binari'):
            v = P[sid][cosa]
            righe.append(f'   "{cosa}": [' + ('' if v else ']' + (',' if cosa == 'archi' else '')))
            for i, a in enumerate(v):
                righe.append('    ' + json.dumps(a, ensure_ascii=False, separators=(',', ':')) + (',' if i < len(v) - 1 else ''))
            if v:
                righe.append('   ]' + (',' if cosa == 'archi' else ''))
        righe.append('  }' + (',' if n < len(ids) - 1 else ''))
    righe += [' }', '}']
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(righe) + '\n')


def main():
    oggi = profili()
    if '--aggiorna' in sys.argv:
        prima = json.load(open(FILE, encoding='utf-8'))['strutture'] if os.path.exists(FILE) else {}
        scrivi(oggi)
        cambiate = confronta(oggi, prima)
        print(f'{FILE}: {len(oggi)} strutture, {sum(len(v["archi"]) for v in oggi.values())} archi, '
              f'{sum(len(v["binari"]) for v in oggi.values())} tratti di binario; cambiate {len(cambiate)}')
        for sid, cosa in cambiate:
            print(f'  {sid}: {cosa}')
        return
    if not os.path.exists(FILE):
        sys.exit(f'manca {FILE}: python3 scripts/profili_strutture.py --aggiorna')
    cambiate = confronta(oggi, json.load(open(FILE, encoding='utf-8'))['strutture'])
    if cambiate:
        print('Profili dei cavalcavia diversi da data/profili-cavalcavia.json:')
        for sid, cosa in cambiate:
            print(f'  {sid}: {cosa}')
        sys.exit('Una struttura cambiata va dichiarata: python3 scripts/profili_strutture.py --aggiorna, e nel commit quali e perché.')
    print(f'profili dei cavalcavia: {len(oggi)} strutture, uguali a data/profili-cavalcavia.json')


if __name__ == '__main__':
    main()
