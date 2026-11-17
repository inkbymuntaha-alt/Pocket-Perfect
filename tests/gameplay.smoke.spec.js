const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 } });

async function openGame(page) {
  await page.addInitScript(() => {
    localStorage.setItem('pp_v02_save', JSON.stringify({ coins: 500 }));
  });
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('#items .item').first()).toBeVisible();
}

async function solveCurrentPuzzle(page) {
  const moves = await page.evaluate(() => currentItems.map((item, index) => ({ index, bin: item.bin })));
  for (const move of moves) {
    await page.locator(`[data-item="${move.index}"]`).click();
    await page.locator(`[data-bin="${move.bin}"]`).click();
  }
  await expect(page.locator('#modal')).toHaveClass(/show/, { timeout: 5000 });
}

test('campaign puzzle completes and Continue loads the next level', async ({ page }) => {
  await openGame(page);
  await solveCurrentPuzzle(page);
  await expect(page.locator('#winTitle')).toContainText('Room for more joy');
  await page.locator('#continue').click();
  await expect(page.locator('#levelname')).toContainText('Level 2');
  await expect(page.locator('#items .item').first()).toBeVisible();
});

test('weekly challenge completes and shows its reward celebration', async ({ page }) => {
  await openGame(page);
  await page.locator('[data-view="daily"]').click();
  await page.locator('#weeklyPlay').click();
  await expect(page.locator('#levelname')).toContainText('Weekly Challenge');
  await solveCurrentPuzzle(page);
  await expect(page.locator('.weekly-win-toast')).toContainText('WEEKLY CHALLENGE COMPLETE!');
  await expect(page.locator('#rewardLine')).toContainText('50 coins');
});

test('daily spin animates, awards a prize, and cannot be claimed twice', async ({ page }) => {
  await openGame(page);
  await page.locator('[data-view="daily"]').click();
  await page.locator('#spinButton').click();
  await expect(page.locator('#spinMessage')).toContainText('You won', { timeout: 7000 });
  await expect(page.locator('#spinButton')).toBeDisabled();
  await expect(page.locator('#spinPreviewButton')).toBeVisible();
});

test('room decoration can be unlocked and appears as owned', async ({ page }) => {
  await openGame(page);
  await page.locator('[data-view="room"]').click();
  await page.locator('[data-buy="0"]').click();
  await expect(page.locator('#roomProgress')).toContainText('1/10');
  await expect(page.locator('[data-buy="0"]')).toBeDisabled();
  await expect(page.locator('#roomLeafyPlant')).toHaveClass(/owned/);
});
