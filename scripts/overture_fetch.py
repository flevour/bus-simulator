#!/usr/bin/env python3
"""Scarica gli edifici Overture Maps (tema buildings, tipo building) in un riquadro e li salva in parquet.

Uso:
    python3 scripts/overture_fetch.py W S E N uscita.parquet [esistente.parquet]

Con un file esistente le righe nuove vengono unite a quelle già presenti, senza doppioni (per id).
Legge direttamente da S3 (accesso anonimo); nei container cloud passa dal proxy configurato in HTTPS_PROXY.
"""
import os
import sys
import time

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pafs
import pyarrow.parquet as pq

RELEASE = 'release/2026-10-21.0'
COLS = ['id', 'geometry', 'bbox', 'sources', 'subtype', 'class', 'names', 'height', 'num_floors', 'min_height', 'min_floor',
        'roof_shape', 'roof_height', 'roof_color', 'facade_color', 'facade_material', 'roof_material', 'is_underground',
        'has_parts', 'level']


def main(w, s, e, n, out, existing=None):
    opts = dict(anonymous=True, region='us-west-2')
    if os.environ.get('HTTPS_PROXY'):
        opts['proxy_options'] = os.environ['HTTPS_PROXY']
    if os.path.exists('/root/.ccr/ca-bundle.crt'):
        opts['tls_ca_file_path'] = '/root/.ccr/ca-bundle.crt'
    fs = pafs.S3FileSystem(**opts)
    t = time.time()
    d = ds.dataset(f'overturemaps-us-west-2/{RELEASE}/theme=buildings/type=building/', filesystem=fs, format='parquet')
    flt = (pc.field('bbox', 'xmin') < e) & (pc.field('bbox', 'xmax') > w) & (pc.field('bbox', 'ymin') < n) & (pc.field('bbox', 'ymax') > s)
    tab = d.to_table(columns=[c for c in COLS if c in d.schema.names], filter=flt)
    print('scaricati', tab.num_rows, 'edifici in', round(time.time() - t), 's', flush=True)
    if existing:
        old = pq.read_table(existing)
        seen = set(old.column('id').to_pylist())
        keep = pa.array([i not in seen for i in tab.column('id').to_pylist()])
        tab = tab.filter(keep).select(old.schema.names).cast(old.schema)
        print('nuovi', tab.num_rows, 'oltre ai', old.num_rows, 'già presenti', flush=True)
        tab = pa.concat_tables([old, tab])
    pq.write_table(tab, out)
    print('scritto', out, tab.num_rows, 'righe', flush=True)


if __name__ == '__main__':
    a = sys.argv[1:]
    main(float(a[0]), float(a[1]), float(a[2]), float(a[3]), a[4], a[5] if len(a) > 5 else None)
