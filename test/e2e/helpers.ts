import { expect, type Page } from '@playwright/test';

export const VIEWPORTS = [
  { name: 'phone-360', width: 360, height: 640 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'landscape-844', width: 844, height: 390 },
] as const;

export async function noHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'page must not scroll sideways').toBeLessThanOrEqual(clientWidth);
}

/** Starts an AI table with the given level (1-4) and opponent count (1-7). */
export async function startAiTable(page: Page, level = 2, count = 3): Promise<void> {
  await page.goto('/ai');
  await page.locator(`.level-option:nth-child(${level})`).click();
  await page.locator(`.count-option:nth-child(${count})`).click();
  await page.locator('.setup-start').click();
  await expect(page.locator('.dock')).toBeVisible();
}

/** Waits until it is the human's turn (AI seats act on a short timer). */
export async function waitForYourTurn(page: Page): Promise<void> {
  await expect(page.locator('.dock.is-your-turn')).toBeVisible({ timeout: 30_000 });
}
