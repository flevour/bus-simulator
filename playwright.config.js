// Prove nel browser headless (npm test). Il setup compila il gioco senza PostHog in una cartella temporanea e lo
// serve su una porta libera: le corsie che provano insieme non si pestano i piedi.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  globalSetup: './tests/setup.js',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    // WebGL in software (SwiftShader): va anche senza scheda grafica, come nei container e in CI
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});
