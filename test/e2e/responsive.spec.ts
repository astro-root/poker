import { expect, test } from '@playwright/test';

// Static pages need no backend, so they run anywhere. Widths follow the project's responsive requirements.
const WIDTHS = [320, 375, 390, 768, 1024, 1440];
const PAGES = ['/', '/rules', '/hands', '/glossary', '/terms', '/privacy'];

for (const width of WIDTHS) {
  test.describe(`viewport ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 740 : 900 } });

    for (const path of PAGES) {
      test(`${path}: no sideways scroll, footer reachable`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('footer.site-footer')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);
      });
    }

    test('navigation: hamburger on phones, inline links on desktop', async ({ page }) => {
      await page.goto('/');
      const toggle = page.locator('.nav-toggle');
      if (width <= 760) {
        await expect(toggle).toBeVisible();
        await expect(page.getByRole('link', { name: 'ルール', exact: true }).first()).toBeHidden();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.page-nav').getByRole('link', { name: 'ルール' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      } else {
        await expect(toggle).toBeHidden();
        await expect(page.locator('.page-nav').getByRole('link', { name: 'ルール' })).toBeVisible();
      }
    });
  });
}

test('reduced motion disables page animations', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  const duration = await page.locator('.hero-title').evaluate((el) => getComputedStyle(el).animationName);
  expect(duration).toBe('none');
  await context.close();
});

test('footer: legal links, parent site and contact open safely', async ({ page }) => {
  await page.goto('/rules');
  const footer = page.locator('footer.site-footer');
  await expect(footer.getByRole('link', { name: '利用規約' })).toHaveAttribute('href', '/terms');
  await expect(footer.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute('href', '/privacy');
  await expect(footer.locator('a[href="https://astro-root.com"]')).toHaveAttribute('rel', /noopener/u);
  await expect(footer.locator('a[href="https://astro-root.com/contact"]')).toHaveAttribute('target', '_blank');
  await expect(footer).toContainText('©2026 astro-root');
});

test('legal pages show the operator name and a working contact link', async ({ page }) => {
  for (const path of ['/terms', '/privacy']) {
    await page.goto(path);
    await expect(page.locator('main')).toContainText('Root（astro-root）');
    await expect(page.locator('main a[href="https://astro-root.com/contact"]')).toBeVisible();
  }
});
