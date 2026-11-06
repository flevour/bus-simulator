#!/usr/bin/env python3
"""Scarica da Overture Maps (S3, accesso anonimo) gli strati utili al modello della città, ritagliati sull'area di gioco.

Uso:
    python3 scripts/overture_layers.py data/overture [W S E N]

Scrive un parquet per strato in data/overture/: strade e marciapiedi (transportation/segment, con le sottoclassi
sidewalk e crosswalk, width_rules, superfici, ponti), nodi del grafo (transportation/connector), punti
dell'infrastruttura (base/infrastructure: semafori, STOP, attraversamenti, fermate con pensilina, lampioni, panchine,
cordoli, posti auto), uso del suolo (base/land_use: parchi, prati, zone pedonali, piazze), alberi e boschi
(base/land), copertura del suolo (base/land_cover), acque (base/water) e attività (places/place, per la domanda di
passeggeri). I dati di questi strati vengono da OpenStreetMap (ODbL): Overture li ripubblica ogni mese.

Funziona dai container cloud (S3 è raggiungibile), a differenza di Overpass. Area predefinita: la stessa delle query
Overpass di scripts/ (riquadri FOCUS e FOCUS_SUD di build_map.py allargati di 300 m).
"""
import os
import sys
import time

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pafs
import pyarrow.parquet as pq

RELEASE = 'release/2026-10-21.0'
BBOX = (11.8482, 45.3593, 11.9158, 45.4517)  # W S E N
LAYERS = [
    ('transportation', 'segment'), ('transportation', 'connector'),
    ('base', 'infrastructure'), ('base', 'land_use'), ('base', 'land'), ('base', 'land_cover'), ('base', 'water'),
    ('places', 'place'),
]


def main(out, bbox=BBOX):
    w, s, e, n = bbox
    opts = dict(anonymous=True, region='us-west-2')
    if os.environ.get('HTTPS_PROXY'):
        opts['proxy_options'] = os.environ['HTTPS_PROXY']
    if os.path.exists('/root/.ccr/ca-bundle.crt'):
        opts['tls_ca_file_path'] = '/root/.ccr/ca-bundle.crt'
    fs = pafs.S3FileSystem(**opts)
    os.makedirs(out, exist_ok=True)
    flt = (pc.field('bbox', 'xmin') < e) & (pc.field('bbox', 'xmax') > w) & (pc.field('bbox', 'ymin') < n) & (pc.field('bbox', 'ymax') > s)
    for theme, typ in LAYERS:
        t = time.time()
        d = ds.dataset(f'overturemaps-us-west-2/{RELEASE}/theme={theme}/type={typ}/', filesystem=fs, format='parquet')
        tab = d.to_table(filter=flt)
        path = f'{out}/{theme}-{typ}.parquet'
        pq.write_table(tab, path)
        print(f'{theme}/{typ}: {tab.num_rows} righe in {time.time() - t:.0f} s -> {path}', flush=True)


if __name__ == '__main__':
    a = sys.argv[1:]
    main(a[0] if a else 'data/overture', tuple(float(v) for v in a[1:5]) if len(a) >= 5 else BBOX)
