import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startAiTable, waitForYourTurn } from './helpers.ts';

async function expectNoContrastViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

const STATIC_PAGES = ['/', '/ai', '/online?mock=lobby', '/online?mock=lobby-joined', '/terms', '/hands', '/online?mock=playing', '/online?mock=finished'];

for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const path of STATIC_PAGES) {
    test(`color-contrast (WCAG AA) has no violations: ${path} @${size.width}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path);
      await page.waitForTimeout(400);
      await expectNoContrastViolations(page);
    });
  }

  test(`color-contrast: AI table on your turn with raise sheet and panels open @${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await startAiTable(page, 3, 7);
    await waitForYourTurn(page);
    await page.locator('.tone-raise').click();
    for (const summary of await page.locator('details.info-card > summary').all()) await summary.click();
    await expectNoContrastViolations(page);
  });
}
