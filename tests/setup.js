// Prima delle prove: build del gioco senza chiavi PostHog (le prove non mandano eventi) in una cartella temporanea,
// servito con vite preview su una porta scelta dal sistema. L'indirizzo passa alle prove in GIOCO_URL.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, preview } from 'vite';
import { prendiPosto } from './posto.js';

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
