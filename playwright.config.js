// Prove nel browser headless (npm test). Il setup compila il gioco senza PostHog in una cartella temporanea e lo
// serve su una porta libera: le corsie che provano insieme non si pestano i piedi.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  // Ogni Chromium con SwiftShader prende circa 4 core mentre carica la città, e più corsie lanciano npm test insieme:
  // in locale 3 worker (ognuno carica il gioco una volta), in CI quelli che sceglie Playwright (2 su ubuntu-latest).
  workers: process.env.CI ? undefined : 3,
  globalSetup: './tests/setup.js',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  // immagini di riferimento delle vedute (tests/vedute.spec.js): le stesse su ogni sistema, senza suffisso
  snapshotPathTemplate: '{testDir}/vedute/riferimenti/{arg}{ext}',
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    // WebGL in software (SwiftShader): va anche senza scheda grafica, come nei container e in CI.
    // Senza audio: i suoni del gioco (Web Audio) non escono dagli altoparlanti (la voce la spegne apriGioco)
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] },
  },
});
