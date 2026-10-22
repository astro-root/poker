import { expect, test } from '@playwright/test';
import { VIEWPORTS, noHorizontalScroll } from './helpers.ts';

const ROUTES = [
  { path: '/', heading: /闘技場で/u },
  { path: '/ai', heading: /AI対戦の設定/u },
  { path: '/online', heading: /リンクを送って/u },
  { path: '/terms', heading: /ポーカー用語集/u },
  { path: '/hands', heading: /役の強さ一覧/u },
] as const;

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`${route.path} renders without horizontal scroll at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(route.heading);
      await expect(page.locator('.brand')).toBeVisible();
      await noHorizontalScroll(page);
    });
  }
}

test('site name and icons are present', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Poker Colosseum/u);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  await expect(page.locator('.brand-bottom')).toHaveText('COLOSSEUM');
});
