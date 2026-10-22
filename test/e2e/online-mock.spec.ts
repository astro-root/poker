import { expect, test } from '@playwright/test';
import { noHorizontalScroll } from './helpers.ts';

// Fixtures come from src/app/mock-online.ts and exist only in the dev server (import.meta.env.DEV).
test('online lobby (not joined) offers create and join', async ({ page }) => {
  await page.goto('/online?mock=lobby');
  await expect(page.getByRole('button', { name: '対戦ルームを作る' })).toBeVisible();
  await expect(page.getByPlaceholder('招待リンクまたはルームID')).toBeVisible();
});

test('online lobby (joined) shows the roster with presence', async ({ page }) => {
  await page.goto('/online?mock=lobby-joined');
  await expect(page.locator('.roster-item')).toHaveCount(3);
  await expect(page.locator('.roster-item.is-away')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '対戦を開始' })).toBeEnabled();
});

test('online table (playing) shows your cards, actions and the away seat', async ({ page }) => {
  await page.goto('/online?mock=playing');
  await expect(page.locator('.hero-cards .playing-card')).toHaveCount(2);
  await expect(page.locator('.seat.is-away')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '退出' })).toBeVisible();
  await noHorizontalScroll(page);
});

test('online table (finished) offers a rematch', async ({ page }) => {
  await page.goto('/online?mock=finished');
  await expect(page.getByRole('button', { name: 'リマッチする' })).toBeVisible();
  await expect(page.locator('.result-champion')).toContainText('優勝');
});
