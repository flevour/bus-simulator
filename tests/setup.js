// Prima delle prove: build del gioco senza chiavi PostHog (le prove non mandano eventi) in una cartella temporanea,
// servito con vite preview su una porta scelta dal sistema. L'indirizzo passa alle prove in GIOCO_URL.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, preview } from 'vite';

// Sul Mac di sviluppo girano più worktree insieme: al più due serie di prove alla volta. Ogni serie apre tre Chromium
// con SwiftShader; con più serie la macchina si satura e le prove a tempo (traffico) diventano instabili. In CI no.
const POSTI = 2;
const CARTELLA_POSTI = '/tmp/bus-simulator-prove';

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function prendiPosto() {
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
      console.log(`Aspetto un posto per le prove: al più ${POSTI} serie alla volta su questa macchina (${CARTELLA_POSTI}).`);
      avvisato = true;
    }
    await new Promise((ok) => setTimeout(ok, 5000));
  }
}

export default async function setup() {
  const libera = await prendiPosto();
  // le variabili già nell'ambiente valgono più di quelle di .env: vuote, PostHog resta spento
  process.env.VITE_POSTHOG_KEY = '';
  process.env.VITE_POSTHOG_HOST = '';
  const outDir = mkdtempSync(join(tmpdir(), 'bus-simulator-prove-'));
  await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
  const server = await preview({ logLevel: 'warn', build: { outDir }, preview: { port: 0, strictPort: false, host: '127.0.0.1' } });
  const { port } = server.httpServer.address();
  process.env.GIOCO_URL = `http://127.0.0.1:${port}/`;
  return async () => {
    await new Promise((ok) => server.httpServer.close(ok));
    rmSync(outDir, { recursive: true, force: true });
    libera();
  };
}
