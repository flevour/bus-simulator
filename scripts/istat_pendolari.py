#!/usr/bin/env python3
"""Pendolari in auto tra i comuni attorno a Padova, dalla matrice del pendolarismo ISTAT 2011 (#147).

La matrice (15° Censimento generale della popolazione, 9 ottobre 2011) dà, per comune di residenza e comune di studio o
di lavoro, chi ci va ogni giorno con il mezzo, l'orario di uscita e il tempo impiegato. È la più recente con il mezzo:
quella del 2021 (censimento permanente) viene da fonti amministrative e non lo ha. Si scarica da
https://www.istat.it/storage/cartografia/matrici_pendolarismo/matrici_pendolarismo_2011.zip (36 MB, pagina "Matrici di
contiguità, distanza e pendolarismo"); licenza CC BY 4.0 (note legali del sito ISTAT, https://www.istat.it/note-legali/).

Uso:
    python3 scripts/istat_pendolari.py <matrici_pendolarismo_2011.zip> data/istat-pendolari.json

Si tengono i record di tipo L (con il mezzo) dei residenti in famiglia che vanno in un altro comune, con l'auto privata
come conducente (mezzo 07), per lavoro o per studio, tra due comuni di data/osm-comuni.json (quelli attorno a Padova,
scripts/filter_osm_fuori.py) con la destinazione entro DESTINAZIONE metri dal centro di Padova: dove può stare la mappa.
Una riga per coppia: [origine, destinazione, prima delle 7:15, 7:15-8:14, 8:15-9:14, dopo le 9:14], stima del numero di
persone (la matrice la dà con due decimali nei comuni con almeno 20.000 abitanti, dove è campionaria). Solo libreria
standard.
"""
import io
import json
import math
import os
import sys
import zipfile
from collections import defaultdict

RADICE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
COMUNI = os.path.join(RADICE, 'data', 'osm-comuni.json')
PADOVA = 28060
DESTINAZIONE = 12000.0
M_PER_LAT, M_PER_LON = 111130, 78153.30172146406  # la proiezione del gioco (scripts/domanda.py)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    zp, uscita = sys.argv[1:]
    C = {c[0]: c for c in json.load(open(COMUNI, encoding='utf-8'))['comuni']}
    _c, _n, la0, lo0, _x = C[PADOVA]
    vicino = {k for k, (_k, _n, la, lo, _x) in C.items()
              if math.hypot((lo - lo0) * M_PER_LON, (la - la0) * M_PER_LAT) < DESTINAZIONE}
    z = zipfile.ZipFile(zp)
    nome = next(n for n in z.namelist() if n.endswith('.txt') and 'matrix_pendo2011' in n)
    flussi = defaultdict(lambda: [0.0] * 4)
    letti = 0
    with z.open(nome) as f:
        for r in io.TextIOWrapper(f, 'latin-1'):
            # tracciato fisso (leggimi della matrice): tipo record, tipo residenza, provincia e comune di residenza,
            # luogo (2 = altro comune italiano), provincia e comune di destinazione, mezzo, orario di uscita, stima
            if r[0] != 'L' or r[17] != '2' or r[31:33] != '07':
                continue
            o, d = int(r[4:7] + r[8:11]), int(r[19:22] + r[23:26])
            if o not in C or d not in vicino:
                continue
            flussi[(o, d)][int(r[34]) - 1] += float(r[38:50])
            letti += 1
    righe = [[o, d] + [round(v, 2) for v in vs] for (o, d), vs in sorted(flussi.items())]
    with open(uscita, 'w', encoding='utf-8') as f:
        f.write(json.dumps({
            'fonte': 'ISTAT, matrice del pendolarismo 2011 (15° Censimento generale della popolazione, 9 ottobre 2011), '
                     'CC BY 4.0, elaborazione in scripts/istat_pendolari.py',
            'mezzo': 'auto privata come conducente (07), per lavoro e per studio',
            'campi': ['comune di residenza (ISTAT)', 'comune di destinazione', 'prima delle 7:15', 'dalle 7:15 alle 8:14',
                      'dalle 8:15 alle 9:14', 'dopo le 9:14'],
        }, ensure_ascii=False)[:-1] + ', "flussi": [\n')
        f.write(',\n'.join(json.dumps(r, separators=(',', ':')) for r in righe))
        f.write('\n]}\n')
    tot = sum(sum(r[2:]) for r in righe)
    print(f'{uscita}: {len(righe)} coppie di comuni ({letti} record), {tot:.0f} pendolari in auto verso {len(vicino)} comuni')


if __name__ == '__main__':
    main()
