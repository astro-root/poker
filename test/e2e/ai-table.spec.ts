import { expect, test } from '@playwright/test';
import { VIEWPORTS, noHorizontalScroll, startAiTable, waitForYourTurn } from './helpers.ts';

test('AI setup: strength and opponent count are applied and remembered', async ({ page }) => {
  await startAiTable(page, 4, 7);
  await expect(page.locator('.seat-ai')).toHaveCount(7);
  await expect(page.locator('.seat-tag').first()).toHaveText('皇帝');
  await page.reload();
  await expect(page.locator('.count-option.is-selected')).toHaveText('7');
  await expect(page.locator('.level-option.is-selected .level-name')).toHaveText('皇帝');
});

test('AI count can be any of 1 to 7', async ({ page }) => {
  for (const count of [1, 4, 7]) {
    await startAiTable(page, 1, count);
    await expect(page.locator('.seat-ai')).toHaveCount(count);
  }
});

for (const viewport of VIEWPORTS) {
  test(`A-1: your hole cards are fully visible and readable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startAiTable(page, 2, 7);
    const cards = page.locator('.hero-cards .playing-card');
    await expect(cards).toHaveCount(2);
    for (let index = 0; index < 2; index++) {
      const card = cards.nth(index);
      await expect(card).toBeInViewport({ ratio: 1 });
      const box = (await card.boundingBox())!;
      expect(box.width, 'card width').toBeGreaterThanOrEqual(44);
      expect(box.height, 'card height').toBeGreaterThanOrEqual(60);
      // Nothing may sit on top of the card (sticky dock, seat labels, etc.).
      const covered = await card.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return top !== null && !element.contains(top);
      });
      expect(covered, 'hole card is covered by another element').toBe(false);
    }
    await noHorizontalScroll(page);
  });
}

test('you can take an action, and Fold is hidden when you could simply check', async ({ page }) => {
  await startAiTable(page, 1, 3);
  await waitForYourTurn(page);
  const passive = page.locator('.tone-neutral .action-label');
  if ((await passive.innerText()) === 'チェック') await expect(page.locator('.tone-fold')).toHaveCount(0);
  const before = await page.locator('.notice-text').innerText();
  await page.locator('.tone-neutral').click();
  await expect(page.locator('.notice-text')).not.toHaveText(before);
});

test('raise sheet opens, presets move the slider and the confirm label follows', async ({ page }) => {
  await startAiTable(page, 1, 2);
  await waitForYourTurn(page);
  await page.locator('.tone-raise').click();
  const range = page.locator('.raise-range');
  await expect(range).toBeVisible();
  await page.getByRole('button', { name: '最大サイズを選択' }).click();
  await expect(page.locator('.raise-confirm')).toContainText(/ベット|レイズ/u);
  await expect(range).toHaveValue(await range.getAttribute('max') ?? '');
});

test('keyboard shortcut C checks or calls on your turn', async ({ page }) => {
  await startAiTable(page, 1, 2);
  await waitForYourTurn(page);
  const before = await page.locator('.notice-text').innerText();
  await page.keyboard.press('c');
  await expect(page.locator('.notice-text')).not.toHaveText(before);
});
