// Il meccanismo delle soglie per caso (#105, scripts/eccezioni.py), senza aprire il gioco: un caso che si sposta in un
// altro luogo fa fallire il controllo anche se il totale resta uguale, un caso sparito va tolto dall'elenco, un gruppo
// senza il perché non passa, e --aggiorna riscrive l'elenco lasciando vuoto il perché dei casi nuovi.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('soglie per caso: un caso nuovo fallisce anche a totale uguale', async ({}, info) => {
  const elenco = info.outputPath('elenco.json'), casi = info.outputPath('casi.json'), esito = info.outputPath('esito.json');
  const scrivi = (gruppi) => writeFileSync(elenco, JSON.stringify({ cosa: 'prova', controlli: { pali: gruppi } }));
  const confronta = (chiavi, ...altro) => {
    writeFileSync(casi, JSON.stringify({ pali: chiavi }));
    const r = spawnSync('python3', ['scripts/eccezioni.py', elenco, casi, '--toll', '2', '--json', esito, ...altro], { encoding: 'utf8' });
    return { esce: r.status, testo: r.stdout + r.stderr, ...JSON.parse(readFileSync(esito, 'utf8')).pali };
  };
  const noti = ['palo @ 10,10', 'palo @ 50,50', 'lanterna @ 10,10'];
  scrivi([{ perche: 'attorno c\'è solo asfalto', casi: noti }]);

  // gli stessi casi, uno spostato di un metro: è lo stesso caso
  expect(confronta(['palo @ 11,10', 'palo @ 50,50', 'lanterna @ 10,10'])).toMatchObject({ esce: 0, casi: 3, nuovi: [], spariti: [] });
  // tre casi come prima, ma un palo è passato da (50, 50) a (90, 90): uno nuovo e uno sparito, con il nome
  let r = confronta(['palo @ 10,10', 'palo @ 90,90', 'lanterna @ 10,10']);
  expect(r).toMatchObject({ esce: 1, casi: 3, nuovi: ['palo @ 90,90'], spariti: ['palo @ 50,50'] });
  expect(r.testo).toContain('caso nuovo: palo @ 90,90');
  expect(r.testo).toContain('caso sparito: va tolto dall\'elenco: palo @ 50,50');
  // stesso posto, altro tipo: non è lo stesso caso
  expect(confronta(['palo @ 10,10', 'palo @ 50,50', 'palo @ 10,11'])).toMatchObject({ esce: 1, nuovi: ['palo @ 10,11'], spariti: ['lanterna @ 10,10'] });
  // un caso corretto: va tolto dall'elenco
  expect(confronta(['palo @ 10,10', 'lanterna @ 10,10'])).toMatchObject({ esce: 1, nuovi: [], spariti: ['palo @ 50,50'] });

  // --aggiorna toglie lo sparito e mette il nuovo in un gruppo senza perché: finché non lo si scrive, non passa
  r = confronta(['palo @ 10,10', 'palo @ 90,90', 'lanterna @ 10,10'], '--aggiorna');
  expect(r).toMatchObject({ esce: 1, nuovi: [], spariti: [], senza_perche: ['palo @ 90,90'] });
  const gruppi = JSON.parse(readFileSync(elenco, 'utf8')).controlli.pali;
  expect(gruppi).toEqual([{ perche: 'attorno c\'è solo asfalto', casi: ['palo @ 10,10', 'lanterna @ 10,10'] }, { perche: '', casi: ['palo @ 90,90'] }]);
  gruppi[1].perche = 'piazzale senza tiranti';
  scrivi(gruppi);
  expect(confronta(['palo @ 10,10', 'palo @ 90,90', 'lanterna @ 10,10'])).toMatchObject({ esce: 0, nuovi: [], spariti: [], senza_perche: [] });
});
