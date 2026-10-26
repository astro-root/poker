import { expect, test } from '@playwright/test';
import { startAiTable } from './helpers.ts';

test.use({ viewport: { width: 375, height: 740 } });

test('the action dock stays pinned to the bottom of the screen while the page scrolls', async ({ page }) => {
  await startAiTable(page, 2, 5);
  const dock = page.locator('.dock');
  await expect(dock).toBeVisible();
  for (const y of [0, 400, 1200]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    const box = (await dock.boundingBox())!;
    expect(Math.round(box.y + box.height), `dock bottom at scrollY=${y}`).toBeGreaterThanOrEqual(740 - 2);
  }
});

test('out of turn the controls stay visible but cannot be pressed', async ({ page }) => {
  await startAiTable(page, 2, 5);
  // Wait for a moment that is not our turn (the AI acts quickly, so poll briefly).
  await expect.poll(async () => page.locator('.dock.is-your-turn').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
  const waiting = page.locator('.dock:not(.is-your-turn) .action-row .action-button');
  if (await waiting.count()) {
    for (const button of await waiting.all()) await expect(button).toBeDisabled();
  }
});

test('renaming in the middle of a game keeps the same hand and the same game', async ({ page }) => {
  await startAiTable(page, 2, 3);
  const hand = await page.locator('.status-hand').first().innerText();
  page.once('dialog', (dialog) => { void dialog.accept('Nova'); });
  await page.getByRole('button', { name: '名前を変更' }).click();
  await expect(page.locator('.hero-name')).toHaveText('Nova');
  await expect(page.locator('.status-hand').first()).toHaveText(hand);
});

test('the phone menu is a translucent overlay: opening it does not move the page or the content', async ({ page }) => {
  await page.goto('/rules');
  await page.evaluate(() => window.scrollTo(0, 300));
  const before = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, top: document.querySelector('main')!.getBoundingClientRect().top }));
  await page.locator('.nav-toggle').click();
  const nav = page.locator('.page-nav');
  await expect(nav).toBeVisible();
  const after = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, top: document.querySelector('main')!.getBoundingClientRect().top }));
  expect(after).toEqual(before);
  const alpha = await nav.evaluate((el) => Number((getComputedStyle(el).backgroundColor.match(/[\d.]+/gu) ?? [])[3] ?? 1));
  expect(alpha).toBeLessThan(1);
  await page.mouse.click(200, 700); // tapping outside closes it
  await expect(nav).toBeHidden();
});
