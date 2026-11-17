const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 } });

async function openGame(page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('pp_v02_save')) localStorage.setItem('pp_v02_save', JSON.stringify({ coins: 500 }));
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
  await expect(page.locator('#winText')).toContainText('50 coins');
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


test('hint costs exactly five coins and undo restores a move', async ({ page }) => {
  await openGame(page);
  const before = Number(await page.locator('#coins').textContent());
  await page.locator('#hint').click();
  await expect(page.locator('#coins')).toHaveText(String(before - 5));
  await expect(page.locator('#note')).toContainText('(-5');
  const first = page.locator('.item:not(:disabled)').first();
  await first.click();
  const wrongBin = await page.evaluate(() => {
    const index = Number(document.querySelector('.item:not(:disabled)').dataset.item);
    const correct = currentItems[index].bin;
    return [0, 1, 2].find(bin => bin !== correct);
  });
  await page.locator(`[data-bin="${wrongBin}"]`).click();
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#undo').click();
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#note')).toContainText('undone');
});

test('restart resets puzzle progress without losing wallet balance', async ({ page }) => {
  await openGame(page);
  const before = await page.locator('#coins').textContent();
  const first = page.locator('.item:not(:disabled)').first();
  await first.click();
  const index = Number(await first.getAttribute('data-item'));
  const correctBin = await page.evaluate(index => currentItems[index].bin, index);
  await page.locator(`[data-bin="${correctBin}"]`).click();
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#restart').click();
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#coins')).toHaveText(before);
  await expect(page.locator('.item:not(:disabled)')).toHaveCount(await page.locator('.item').count());
});

test('campaign progress and coin balance survive a page reload', async ({ page }) => {
  await openGame(page);
  await solveCurrentPuzzle(page);
  await page.locator('#continue').click();
  await expect(page.locator('#levelname')).toContainText('Level 2');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v02_save')));
  expect(saved.completed).toContain(0);
  expect(saved.level).toBe(1);
  const coins = saved.coins;
  await page.reload();
  await expect(page.locator('#levelname')).toContainText('Level 2');
  await expect(page.locator('#coins')).toHaveText(String(coins));
  await page.locator('[data-view="levels"]').click();
  await expect(page.locator('[data-level="0"]')).toContainText('Completed');
  await expect(page.locator('[data-level="1"]')).toContainText('Current level');
  await expect(page.locator('[data-level="2"]')).toBeDisabled();
});

test('mobile layout keeps navigation and gameplay controls visible', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openGame(page);
  await expect(page.locator('.tabs')).toBeVisible();
  await expect(page.locator('#items')).toBeVisible();
  await expect(page.locator('#bins')).toBeVisible();
  await expect(page.locator('#restart')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
});


test('all 500 generated campaign levels have valid, solvable sorting data', async ({ page }) => {
  await openGame(page);
  const result = await page.evaluate(() => {
    const levels = Array.from({ length: 500 }, (_, index) => {
      const data = levelData(index);
      const bins = [...new Set(data.items.map(item => item.bin))].sort();
      return {
        countMatches: data.items.length === data.count,
        threeCategories: data.labels.length === 3,
        binsValid: data.items.every(item => Number.isInteger(item.bin) && item.bin >= 0 && item.bin < 3),
        allBinsUsed: bins.join(',') === '0,1,2',
        goldenCorrect: data.golden === ((index + 1) % 10 === 0)
      };
    });
    const dailyA = dailyLevelData();
    const dailyB = dailyLevelData();
    const weeklyA = weeklyLevelData();
    const weeklyB = weeklyLevelData();
    return {
      levels,
      dailyStable: JSON.stringify(dailyA.items) === JSON.stringify(dailyB.items),
      weeklyStable: JSON.stringify(weeklyA.items) === JSON.stringify(weeklyB.items)
    };
  });
  expect(result.levels).toHaveLength(500);
  expect(result.levels.every(level => Object.values(level).every(Boolean))).toBe(true);
  expect(result.dailyStable).toBe(true);
  expect(result.weeklyStable).toBe(true);
  await page.locator('[data-view="levels"]').click();
  await expect(page.locator('#levelGrid .level-choice')).toHaveCount(500);
  await expect(page.locator('[data-level="499"]')).toBeDisabled();
});


test('completing level 500 shows the final campaign celebration', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pp_v02_save', JSON.stringify({
      level: 499,
      completed: Array.from({ length: 499 }, (_, index) => index),
      bestMoves: {},
      coins: 500
    }));
  });
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('#levelname')).toContainText('Level 500');
  await solveCurrentPuzzle(page);
  await expect(page.locator('.levelup-card')).toContainText('ALL LEVELS COMPLETE!');
  await expect(page.locator('.levelup-card')).toContainText('500 LEVELS MASTERED');
});
