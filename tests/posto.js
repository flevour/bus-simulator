// Posti per i browser del gioco sulla stessa macchina: al più due alla volta, per le serie di prove (tests/setup.js) e
// per gli script delle sessioni che aprono il gioco. Ogni posto vale al più tre Chromium con SwiftShader: con più
// browser insieme la macchina si satura e le prove a tempo (traffico) diventano instabili. In CI non serve.
// Negli script: const libera = await prendiPosto(); ... libera(); un posto si libera da solo se il processo finisce.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const POSTI = 2;
const CARTELLA_POSTI = '/tmp/bus-simulator-prove';

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function prendiPosto() {
  if (process.env.CI) return () => {};
  mkdirSync(CARTELLA_POSTI, { recursive: true });
  let avvisato = false;
  for (;;) {
    for (let i = 1; i <= POSTI; i++) {
      const posto = join(CARTELLA_POSTI, `posto-${i}`);
      try {
        mkdirSync(posto);
        writeFileSync(join(posto, 'pid'), String(process.pid));
        return () => rmSync(posto, { recursive: true, force: true });
      } catch {
        // posto occupato: si libera se chi lo teneva non c'è più (o se è rimasto senza pid per oltre un minuto)
        let pid = 0;
        try { pid = Number(readFileSync(join(posto, 'pid'), 'utf8')); } catch { /* appena creato o abbandonato */ }
        let vecchio = false;
        try { vecchio = Date.now() - statSync(posto).mtimeMs > 60_000; } catch { /* appena liberato */ }
        if (pid ? !vivo(pid) : vecchio) rmSync(posto, { recursive: true, force: true });
      }
    }
    if (!avvisato) {
      console.log(`Aspetto un posto per il gioco: al più ${POSTI} alla volta su questa macchina (${CARTELLA_POSTI}).`);
      avvisato = true;
    }
    await new Promise((ok) => setTimeout(ok, 5000));
  }
}
