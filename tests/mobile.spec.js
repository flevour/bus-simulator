// Telefoni e tablet per ora non sono supportati (MOBILE_SUPPORTED in src/game/touch.js): invito a giocare da computer.
import { test, expect } from '@playwright/test';

test('telefono: invito a giocare da computer, la città non si costruisce', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(process.env.GIOCO_URL);
  await expect(page.locator('#solo-computer')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#solo-computer .finestra')).toBeHidden();
  await expect(page.locator('#loading')).toBeHidden();
  expect(await page.evaluate(() => !!window.__game)).toBe(false);
  await ctx.close();
});

test('computer con la finestra piccola: invito ad allargarla', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(process.env.GIOCO_URL);
  await expect(page.locator('#solo-computer')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#solo-computer .finestra')).toBeVisible();
  // allargando la finestra l'invito sparisce
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('#solo-computer')).toBeHidden();
  await ctx.close();
});
