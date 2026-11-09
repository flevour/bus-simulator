// Giro guidato in headless: dal capolinea alle fermate successive su alcune linee campione, autobus e tram.
// Linee scelte tra quelle che il pilota di guida.js percorre pulite (9 novembre 2026): un urto contro un ostacolo
// fisso o una fermata non raggiunta vogliono dire che qualcosa è cambiato in strade, fermate o percorsi.
import { test, expect, avviaCorsa } from './gioco.js';
import { guidaFermate } from './guida.js';

const CAMPIONI = [
  { linea: '24', fermate: 3 },
  { linea: '10', verso: 1, fermate: 2 }, // snodato da 18 m
  { linea: '3', verso: 1, fermate: 2 }, // svolta stretta a destra in Via Guasti
  { linea: '14', fermate: 2 }, // dal piazzale della stazione
  { linea: 'SIR1', tram: true, fermate: 3 },
  { linea: 'SIR1', tram: true, verso: 1, fermate: 2 },
];

for (const c of CAMPIONI) {
  test(`giro guidato: ${c.tram ? 'tram' : 'linea'} ${c.linea}${c.verso ? ' ritorno' : ''}, ${c.fermate} fermate`, async ({ pagina, gioco }, info) => {
    const corsa = await avviaCorsa(pagina, c);
    const esiti = await guidaFermate(pagina, c);
    const righe = esiti.map((e) => `${e.arrivato ? '✓' : '✗'} ${e.nome}: ${e.motivo}, ${e.metri} m in ${e.tempo} s` +
      `${e.urti.length ? `, urti: ${e.urti.map((u) => `${u.cosa} in ${u.via || '?'} (${u.x}, ${u.z})`).join('; ')}` : ''}` +
      `${e.marciapiede ? `, ${e.marciapiede} volte sul marciapiede` : ''}${e.arrivato ? '' : ` (${e.x}, ${e.z}, ${e.via}) ultimi messaggi: ${e.log.join(' | ')}`}`);
    const testo = `${corsa.prima} → ${corsa.ultima}\n${righe.join('\n')}`;
    info.annotations.push({ type: 'giro', description: testo });
    expect(esiti.length === c.fermate && esiti.every((e) => e.arrivato), testo).toBe(true);
    expect(esiti.flatMap((e) => e.urti), `urti contro ostacoli fissi\n${testo}`).toEqual([]);
    expect(gioco.errori()).toEqual([]);
  });
}
