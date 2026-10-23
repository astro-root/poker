import { expect, test } from '@playwright/test';
import { VIEWPORTS, noHorizontalScroll } from './helpers.ts';

const ROUTES = [
  { path: '/', heading: /Poker Colosseum/u },
  { path: '/ai', heading: /AI対戦の設定/u },
  { path: '/online', heading: /リンクを送って/u },
  { path: '/glossary', heading: /ポーカー用語集/u },
  { path: '/terms', heading: /利用規約/u },
  { path: '/privacy', heading: /プライバシーポリシー/u },
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
  await expect(page).toHaveTitle('Poker Colosseum — Online Texas Hold’em');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  await expect(page.locator('.brand-bottom')).toHaveText('COLOSSEUM');
});

test('footer links to the legal pages and the parent site on every main page', async ({ page }) => {
  for (const path of ['/', '/ai', '/online', '/glossary', '/hands', '/terms', '/privacy']) {
    await page.goto(path);
    const footer = page.locator('footer.site-footer');
    await expect(footer).toContainText('©2026 astro-root');
    await expect(footer.getByRole('link', { name: '利用規約' })).toHaveAttribute('href', '/terms');
    await expect(footer.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute('href', '/privacy');
    const parent = footer.locator('a[href="https://astro-root.com"]');
    await expect(parent).toHaveAttribute('rel', /noopener/u);
  }
});

test('the removed marketing line is gone from the home page and the tagline is shown', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).not.toContainText('アカウント登録不要');
  await expect(page.locator('.hero-tagline')).toHaveText('Step Into the Colosseum.');
});
