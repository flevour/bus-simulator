"""Casi noti dei controlli: soglie per caso invece che per conteggio (#105).

Un conteggio lascia passare un difetto che si sposta da un luogo a un altro: 4 fermate fuori strada restano 4 anche se
sono altre quattro. Ogni controllo dà ai suoi casi una chiave stabile, e i casi noti stanno in un file di
data/eccezioni/, divisi in gruppi con il perché:

  {"cosa": "...",
   "controlli": {"<controllo>": [{"perche": "...", "casi": ["<parte fissa> @ x,z", ...]}]},
   "misure": {"<misura>": {"perche": "...", "tolleranza": 20, "valori": {"<luogo>": 1234}}}}

La chiave di un caso è una parte fissa (struttura, linea, fermata, tipo) e il posto in metri del gioco. Un caso trovato
corrisponde a uno noto se ha la stessa parte fissa e sta entro la tolleranza del controllo, uno a uno: un caso che si
sposta di poco resta lo stesso, uno che compare altrove è nuovo. Il controllo fallisce se:
  * c'è un caso nuovo, fuori dall'elenco, anche se il totale non sale;
  * un caso dell'elenco è sparito: va tolto, così non può tornare senza che nessuno se ne accorga;
  * un gruppo non ha il perché.
Le misure sono numeri per luogo (i metri quadri di marciapiede stretto per riquadro): falliscono se un luogo cresce o
scende oltre la tolleranza.

Chi corregge o sposta dei casi riscrive l'elenco con --aggiorna del suo controllo: toglie gli spariti e mette i nuovi
in un gruppo con il perché vuoto, che va scritto a mano (o i casi spostati nel gruppo giusto) prima che il controllo
passi.

Per le prove nel browser, che i casi li trovano in JavaScript:

  python3 scripts/eccezioni.py <elenco> <casi.json> [--toll M] [--aggiorna] [--json esito.json]

con casi.json = {"<controllo>": ["<chiave>", ...]}. Solo libreria standard.
"""
import argparse
import json
import math
import os
import sys
from collections import defaultdict

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARTELLA = os.path.join(RADICE, 'data', 'eccezioni')
MOSTRA = 25  # casi stampati per controllo e per esito; il resto si conta


def chiave(fissa, x, z):
    return f'{fissa} @ {round(x)},{round(z)}'


def spezza(k):
    """(parte fissa, (x, z)) di una chiave; il posto è None se la chiave non ne ha uno."""
    fissa, sep, posto = k.rpartition(' @ ')
    if sep:
        try:
            x, z = (float(v) for v in posto.split(','))
            return fissa, (x, z)
        except ValueError:
            pass
    return k, None


def abbina(casi, noti, toll=0.0):
    """Abbina uno a uno i casi trovati a quelli noti: prima le chiavi uguali, poi stessa parte fissa e posto entro toll
    metri, il più vicino. Restituisce (nuovi, spariti)."""
    per = defaultdict(list)
    for k in noti:
        fissa, p = spezza(k)
        per[fissa].append([k, p, False])
    resto, nuovi = [], []
    for k in casi:
        fissa, p = spezza(k)
        n = next((n for n in per.get(fissa, ()) if not n[2] and n[0] == k), None)
        if n:
            n[2] = True
        else:
            resto.append((k, fissa, p))
    for k, fissa, p in resto:
        liberi = [n for n in per.get(fissa, ()) if not n[2] and p and n[1] and math.dist(p, n[1]) <= toll]
        if liberi:
            min(liberi, key=lambda n: math.dist(p, n[1]))[2] = True
        else:
            nuovi.append(k)
    return nuovi, [n[0] for v in per.values() for n in v if not n[2]]


class Elenco:
    """Un file di data/eccezioni/ e l'esito del confronto con i casi di oggi."""

    def __init__(self, nome, comando=''):
        self.nome, self.comando = nome, comando
        # un nome è un file di data/eccezioni/; un percorso che finisce in .json è quel file (le prove del meccanismo)
        self.file = nome if nome.endswith('.json') else os.path.join(CARTELLA, nome + '.json')
        self.d = json.load(open(self.file, encoding='utf-8')) if os.path.exists(self.file) else {'cosa': ''}
        self.d.setdefault('controlli', {})
        self.esiti = {}

    def noti(self, controllo):
        return [k for g in self.d['controlli'].get(controllo, []) for k in g['casi']]

    def confronta(self, controllo, casi, toll=0.0, aggiorna=False):
        """Confronta i casi (chiavi) del controllo con l'elenco. Con aggiorna, prima riscrive l'elenco del controllo."""
        casi = list(casi)
        if aggiorna:
            self._aggiorna(controllo, casi, toll)
        gruppi = self.d['controlli'].get(controllo, [])
        nuovi, spariti = abbina(casi, self.noti(controllo), toll)
        senza = [k for g in gruppi if not g.get('perche', '').strip() for k in g['casi']]
        e = {'casi': len(casi), 'nuovi': sorted(nuovi), 'spariti': sorted(spariti), 'senza_perche': senza}
        self.esiti[controllo] = e
        return e

    def _aggiorna(self, controllo, casi, toll):
        nuovi, spariti = abbina(casi, self.noti(controllo), toll)
        gruppi = self.d['controlli'].setdefault(controllo, [])
        via = defaultdict(int)
        for k in spariti:
            via[k] += 1
        for g in gruppi:
            tenuti = []
            for k in g['casi']:
                if via[k] > 0:
                    via[k] -= 1
                else:
                    tenuti.append(k)
            g['casi'] = tenuti
        if nuovi:
            vuoto = next((g for g in gruppi if not g.get('perche', '').strip()), None)
            if vuoto is None:
                vuoto = {'perche': '', 'casi': []}
                gruppi.append(vuoto)
            vuoto['casi'] = sorted(vuoto['casi'] + nuovi)
        gruppi[:] = [g for g in gruppi if g['casi']]

    def confronta_misura(self, misura, valori, aggiorna=False):
        """Confronta i numeri per luogo con quelli dell'elenco: cresciuti o scesi oltre la tolleranza."""
        m = self.d.setdefault('misure', {}).setdefault(misura, {'perche': '', 'tolleranza': 0, 'valori': {}})
        if aggiorna:
            m['valori'] = {k: v for k, v in sorted(valori.items()) if v > 0}
        toll, noti = m.get('tolleranza', 0), m['valori']
        riga = lambda k: f"{k}: {valori.get(k, 0)} (nell'elenco {noti.get(k, 0)})"
        luoghi = sorted({*valori, *noti})
        cresciuti = [riga(k) for k in luoghi if valori.get(k, 0) > noti.get(k, 0) + toll]
        scesi = [riga(k) for k in luoghi if valori.get(k, 0) < noti.get(k, 0) - toll]
        e = {'casi': len(valori), 'nuovi': cresciuti, 'spariti': scesi, 'senza_perche': [] if m.get('perche', '').strip() else [misura], 'misura': True}
        self.esiti[misura] = e
        return e

    def segno(self, controllo):
        """('✓' o '✗', due parole sull'esito) per la riga del rapporto."""
        e = self.esiti[controllo]
        mis = e.get('misura')
        if not (e['nuovi'] or e['spariti'] or e['senza_perche']):
            return '✓', 'ogni luogo entro la tolleranza' if mis else "tutti nell'elenco"
        nomi = (('nuovi', 'cresciuti' if mis else 'nuovi'), ('spariti', 'scesi' if mis else "spariti dall'elenco"),
                ('senza_perche', 'senza perché'))
        return '✗', ', '.join(f'{len(e[k])} {nome}' for k, nome in nomi if e[k])

    def errori(self):
        """Le righe da stampare per i controlli che non corrispondono all'elenco; vuoto se corrispondono tutti."""
        out = []
        for controllo, e in self.esiti.items():
            mis = e.get('misura')
            nuovo = 'cresciuto' if mis else 'caso nuovo'
            sparito = "sceso: va abbassato nell'elenco" if mis else "caso sparito: va tolto dall'elenco"
            for cosa, casi in ((nuovo, e['nuovi']), (sparito, e['spariti']), ("nell'elenco senza il perché", e['senza_perche'])):
                out += [f'  {controllo}, {cosa}: {k}' for k in casi[:MOSTRA]]
                if len(casi) > MOSTRA:
                    out.append(f'  {controllo}, {cosa}: e altri {len(casi) - MOSTRA}')
        if out:
            comando = self.comando or '--aggiorna'
            out.insert(0, f"Casi diversi dall'elenco {os.path.relpath(self.file, RADICE)}:")
            out.append("  Un caso nuovo si corregge; se deve restare, va nell'elenco in un gruppo con il perché. "
                       f"{comando} riscrive l'elenco dai casi di oggi: toglie gli spariti e mette i nuovi in un gruppo "
                       "con il perché vuoto, da scrivere.")
        return out

    def scrivi(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.file)), exist_ok=True)
        with open(self.file, 'w', encoding='utf-8') as f:
            json.dump(self.d, f, ensure_ascii=False, indent=1)
            f.write('\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('elenco', help='nome del file in data/eccezioni/, senza .json (o il percorso di un file .json)')
    ap.add_argument('casi', help='file JSON {controllo: [chiavi]} con i casi di oggi')
    ap.add_argument('--toll', type=float, default=0.0, help='metri entro cui un caso è lo stesso di uno noto')
    ap.add_argument('--aggiorna', action='store_true', help='riscrive l\'elenco dai casi di oggi')
    ap.add_argument('--comando', default='', help='come si aggiorna l\'elenco da chi chiama, per il messaggio')
    ap.add_argument('--json', help='scrive l\'esito {controllo: {casi, nuovi, spariti, senza_perche}} in questo file')
    args = ap.parse_args()
    E = Elenco(args.elenco, args.comando)
    for controllo, casi in json.load(open(args.casi, encoding='utf-8')).items():
        E.confronta(controllo, casi, args.toll, args.aggiorna)
    if args.aggiorna:
        E.scrivi()
    if args.json:
        json.dump(E.esiti, open(args.json, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    err = E.errori()
    if err:
        print('\n'.join(err))
        sys.exit(1)


if __name__ == '__main__':
    main()
