const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 } });

async function openGame(page) {
  page.on('pageerror', error => console.log('[BROWSER PAGE ERROR]', error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('[BROWSER CONSOLE ERROR]', message.text()); });
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

test('every 100th campaign level triggers a special milestone celebration', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pp_v02_save', JSON.stringify({
      level: 99,
      completed: Array.from({ length: 99 }, (_, index) => index),
      bestMoves: {},
      coins: 500
    }));
  });
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('#levelname')).toContainText('Level 100');
  await solveCurrentPuzzle(page);
  await expect(page.locator('.levelup-card')).toContainText('100 LEVELS CLEARED!');
  await expect(page.locator('.levelup-card')).toContainText('MILESTONE MASTER');
});


test('daily spin wheel has the polished pastel prize-wheel styling', async ({ page }) => {
  await openGame(page);
  await page.locator('[data-view="daily"]').click();
  const wheel = page.locator('#dailySpinWheel');
  await expect(wheel).toBeVisible();
  const style = await wheel.evaluate(element => ({
    background: getComputedStyle(element).backgroundImage,
    border: getComputedStyle(element).borderTopWidth,
    labels: element.querySelectorAll('.spin-label').length,
    center: getComputedStyle(element.querySelector('.spin-wheel-center')).width
  }));
  expect(style.background).toContain('conic-gradient');
  expect(style.border).toBe('9px');
  expect(style.labels).toBe(12);
  expect(style.center).toBe('59px');
  await expect(page.locator('#spinButton')).toBeVisible();
});

test('campaign progression recovers when the saved current level is already completed', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pp_v02_save', JSON.stringify({
      level: 77,
      completed: Array.from({ length: 78 }, (_, index) => index),
      bestMoves: {},
      coins: 500
    }));
  });
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('#levelname')).toContainText('Level 78');
  await solveCurrentPuzzle(page);
  await page.locator('#continue').click();
  await expect(page.locator('#levelname')).toContainText('Level 79');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v02_save')));
  expect(saved.level).toBe(78);
  expect(saved.completed).toContain(77);
});

test('level 78 puzzle can be completed and unlocks level 79', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pp_v02_save', JSON.stringify({
      level: 77,
      completed: Array.from({ length: 77 }, (_, index) => index),
      bestMoves: {},
      coins: 500
    }));
  });
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('#levelname')).toContainText('Level 78');
  await solveCurrentPuzzle(page);
  await page.locator('#continue').click();
  await expect(page.locator('#levelname')).toContainText('Level 79');
});


test('all navigation sections open and the prototype shop stays safely disabled', async ({ page }) => {
  await openGame(page);
  for (const view of ['levels', 'profile', 'room', 'daily', 'store', 'play']) {
    await page.locator('[data-view="' + view + '"]').click();
    await expect(page.locator('#' + view)).toHaveClass(/active/);
  }
  await page.locator('[data-view="store"]').click();
  await expect(page.locator('.product button')).toHaveCount(4);
  await expect(page.locator('.product button:disabled')).toHaveCount(4);
  await expect(page.locator('#store button:disabled')).toHaveCount(5);
});

test('all ten room decorations unlock, render, and persist with the correct coin balance', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('pp_v02_save')) localStorage.setItem('pp_v02_save', JSON.stringify({ coins: 1000 }));
  });
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('[data-view="room"]').click();
  await expect(page.locator('#decorlist [data-buy]')).toHaveCount(10);
  for (let i = 0; i < 10; i++) {
    await page.locator('[data-buy="' + i + '"]').click();
    await expect(page.locator('[data-buy="' + i + '"]')).toBeDisabled();
  }
  await expect(page.locator('#roomProgress')).toHaveText('10/10');
  await expect(page.locator('#coins')).toHaveText('475');
  await expect(page.locator('#roomLeafyPlant')).toHaveClass(/owned/);
  await expect(page.locator('#roomWindowFlowers')).toHaveClass(/owned/);
  await expect(page.locator('#roomRug')).toHaveClass(/owned/);
  await expect(page.locator('#roomMat')).toHaveClass(/owned/);
  await page.reload();
  await page.locator('[data-view="room"]').click();
  await expect(page.locator('#roomProgress')).toHaveText('10/10');
  await expect(page.locator('#coins')).toHaveText('485');
  await expect(page.locator('#decorlist [data-buy]:disabled')).toHaveCount(10);
});

test('daily challenge completion rewards are claimed only once', async ({ page }) => {
  await openGame(page);
  await page.locator('[data-view="daily"]').click();
  await page.locator('#dailyPlay').click();
  await solveCurrentPuzzle(page);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v02_save')));
  expect(saved.dailyChallengesCompleted).toBe(1);
  const claimedDay = saved.dailyPuzzleClaimed;
  await page.locator('#continue').click();
  await page.locator('[data-view="daily"]').click();
  await page.locator('#dailyPlay').click();
  await solveCurrentPuzzle(page);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v02_save')));
  expect(saved.dailyChallengesCompleted).toBe(1);
  expect(saved.dailyPuzzleClaimed).toBe(claimedDay);
});

test('weekly challenge rewards are claimed only once and the weekly best is saved', async ({ page }) => {
  await openGame(page);
  await page.locator('[data-view="daily"]').click();
  await page.locator('#weeklyPlay').click();
  await solveCurrentPuzzle(page);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v02_save')));
  expect(saved.weeklyChallengesCompleted).toBe(1);
  const claimedWeek = saved.weeklyChallengeClaimed;
  expect(saved.weeklyBestMoves).toBeGreaterThan(0);
  await page.locator('#continue').click();
  await page.locator('[data-view="daily"]').click();
  await page.locator('#weeklyPlay').click();
  await solveCurrentPuzzle(page);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v02_save')));
  expect(saved.weeklyChallengesCompleted).toBe(1);
  expect(saved.weeklyChallengeClaimed).toBe(claimedWeek);
});

test('daily spin saves its prize, disables repeat claims, and keeps the wheel shadow-free', async ({ page }) => {
  await openGame(page);
  await page.locator('[data-view="daily"]').click();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v02_save')));
  await page.locator('#spinButton').click();
  await expect(page.locator('#spinMessage')).toContainText('You won', { timeout: 8000 });
  const after = await page.evaluate(() => ({
    save: JSON.parse(localStorage.getItem('pp_v02_save')),
    meta: JSON.parse(localStorage.getItem('pp_v1_meta'))
  }));
  expect(after.meta.spinDay).toBe(new Date().toISOString().slice(0, 10));
  expect(after.meta.spinPrize).toBeTruthy();
  expect(after.save.coins > before.coins || after.save.totalStars > before.totalStars).toBe(true);
  await expect(page.locator('#spinButton')).toBeDisabled();
  const shadow = await page.locator('#dailySpinWheel').evaluate(el => getComputedStyle(el).boxShadow);
  expect(shadow).toBe('none');
});

test('every campaign artwork type renders a valid SVG illustration', async ({ page }) => {
  await openGame(page);
  const result = await page.evaluate(() => {
    const types = [...new Set(iconSets.flat())];
    return types.map(type => ({ type, valid: art(type).includes('<svg') && !art(type).includes('undefined') }));
  });
  expect(result.length).toBeGreaterThan(0);
  expect(result.every(item => item.valid)).toBe(true);
});

test('room upgrades unlock in order, change the room style, and persist after reload', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => { state.coins = 3000; save(); refreshHeader(); });
  await page.locator('[data-view="room"]').click();
  await expect(page.locator('#roomStageTitle')).toHaveText('Cozy Starter Room');
  await expect(page.locator('#roomUpgradeButton')).toHaveText('Upgrade · 150 ✧');
  await page.locator('#roomUpgradeButton').click();
  await expect(page.locator('#roomStageTitle')).toHaveText('Dreamy Pastel Room');
  await expect(page.locator('#roomScene')).toHaveAttribute('data-upgrade', '1');
  await page.locator('#roomUpgradeButton').click();
  await expect(page.locator('#roomStageTitle')).toHaveText('Luxury Garden Suite');
  await expect(page.locator('#roomScene')).toHaveAttribute('data-upgrade', '2');
  await page.locator('#roomUpgradeButton').click();
  await expect(page.locator('#roomStageTitle')).toHaveText('Magical Dream Suite');
  await expect(page.locator('#roomScene')).toHaveAttribute('data-upgrade', '3');
  await expect(page.locator('#roomUpgradeButton')).toBeDisabled();
  await page.reload();
  await page.locator('[data-view="room"]').click();
  await expect(page.locator('#roomStageTitle')).toHaveText('Magical Dream Suite');
  await expect(page.locator('#roomScene')).toHaveAttribute('data-upgrade', '3');
  await expect(page.locator('#roomUpgradeButton')).toBeDisabled();
});

test('room upgrade button blocks purchases when the coin balance is too low', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => { state.coins = 100; save(); refreshHeader(); });
  await page.locator('[data-view="room"]').click();
  await expect(page.locator('#roomUpgradeButton')).toBeDisabled();
  await expect(page.locator('#roomStageTitle')).toHaveText('Cozy Starter Room');
  await expect(page.locator('#roomScene')).toHaveAttribute('data-upgrade', '0');
});


test('first-time players get a four-step tutorial that can be skipped and stays dismissed', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/');
  const overlay = page.locator('#tutorialOverlay');
  await expect(overlay).toHaveClass(/show/);
  await expect(page.locator('#tutorialTitle')).toHaveText('Welcome to Pocket Perfect!');
  await page.locator('#tutorialNext').click();
  await expect(page.locator('#tutorialTitle')).toHaveText('Sort each little object');
  await page.locator('#tutorialNext').click();
  await expect(page.locator('#tutorialTitle')).toHaveText('Earn coins and stars');
  await page.locator('#tutorialNext').click();
  await expect(page.locator('#tutorialTitle')).toHaveText('Restore your cozy room');
  await page.locator('#tutorialSkip').click();
  await expect(overlay).not.toHaveClass(/show/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v02_save')));
  expect(saved.tutorialCompleted).toBe(true);
  await page.reload();
  await expect(overlay).not.toHaveClass(/show/);
});

test('returning players with an existing save are not interrupted by onboarding', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pp_v02_save', JSON.stringify({ coins: 25, level: 0 })));
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('#tutorialOverlay')).not.toHaveClass(/show/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v02_save')));
  expect(saved.level).toBe(0);
});


test('daily login gift is claimable once and the seventh day grants bonus stars', async ({ page }) => {
  await page.addInitScript(() => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    localStorage.setItem('pp_v02_save', JSON.stringify({ coins: 100, totalStars: 2 }));
    localStorage.setItem('pp_v1_meta', JSON.stringify({
      day: new Date().toISOString().slice(0, 10), wins: 0, questClaimed: false, badges: [],
      loginDay: yesterday, loginStreak: 6
    }));
  });
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('[data-view="daily"]').click();
  await expect(page.locator('#loginStreak')).toHaveText('Day 6/7');
  await expect(page.locator('#loginClaimButton')).toBeEnabled();
  await page.locator('#loginClaimButton').click();
  await expect(page.locator('#loginStreak')).toHaveText('Day 7/7');
  await expect(page.locator('#loginClaimButton')).toBeDisabled();
  const saved = await page.evaluate(() => ({
    game: JSON.parse(localStorage.getItem('pp_v02_save')),
    meta: JSON.parse(localStorage.getItem('pp_v1_meta'))
  }));
  expect(saved.game.coins).toBe(160);
  expect(saved.game.totalStars).toBe(9);
  expect(saved.meta.loginStreak).toBe(7);
  await page.reload();
  await page.locator('[data-view="daily"]').click();
  await expect(page.locator('#loginClaimButton')).toBeDisabled();
  await expect(page.locator('#coins')).toHaveText('160');
});

test('daily missions pay once, unlock a mystery gift, and persist after reload', async ({ page }) => {
  await openGame(page);
  await solveCurrentPuzzle(page);
  await page.locator('#continue').click();
  await page.locator('[data-view="daily"]').click();
  const before = Number(await page.locator('#coins').textContent());
  const mission = page.locator('[data-mission="first"]');
  await expect(mission).toBeEnabled();
  await mission.click();
  await expect(page.locator('[data-mission="first"]')).toBeDisabled();
  await expect(page.locator('#coins')).toHaveText(String(before + 15));
  await expect(page.locator('#mysteryClaimButton')).toBeEnabled();
  await page.locator('#mysteryClaimButton').click();
  let saved = await page.evaluate(() => ({
    game: JSON.parse(localStorage.getItem('pp_v02_save')),
    meta: JSON.parse(localStorage.getItem('pp_v1_meta'))
  }));
  expect(saved.meta.missionClaims).toContain('first');
  expect(saved.meta.mysteryDay).toBe(new Date().toISOString().slice(0, 10));
  expect(['+25 coins', '+40 coins', '+60 coins', '+2 stars']).toContain(saved.meta.mysteryPrize);
  await page.reload();
  await page.locator('[data-view="daily"]').click();
  await expect(page.locator('[data-mission="first"]')).toBeDisabled();
  await expect(page.locator('#mysteryClaimButton')).toBeDisabled();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v1_meta')));
  expect(saved.missionClaims).toContain('first');
});

test('weekly return prize grants a free room decoration and cannot be claimed twice', async ({ page }) => {
  await openGame(page);
  const week = await page.evaluate(() => weeklyKey());
  const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  await page.evaluate(({ week, today }) => {
    localStorage.setItem('pp_v1_meta', JSON.stringify({
      day: today, wins: 1, questClaimed: false, badges: [],
      missionDay: today, missionClaims: [], weeklyMissionWeek: week, weeklyMissionClaims: 4
    }));
  }, { week, today });
  await page.reload();
  await page.locator('[data-view="daily"]').click();
  const before = Number(await page.locator('#coins').textContent());
  await page.locator('[data-mission="first"]').click();
  await expect(page.locator('#weeklyPrizeButton')).toBeEnabled();
  await page.locator('#weeklyPrizeButton').click();
  await expect(page.locator('#weeklyPrizeButton')).toBeDisabled();
  await expect(page.locator('#coins')).toHaveText(String(before + 95));
  let saved = await page.evaluate(() => ({
    game: JSON.parse(localStorage.getItem('pp_v02_save')),
    meta: JSON.parse(localStorage.getItem('pp_v1_meta'))
  }));
  expect(saved.game.decor).toContain(0);
  expect(saved.meta.weeklyPrizeClaimed).toBeTruthy();
  await page.reload();
  await page.locator('[data-view="room"]').click();
  await expect(page.locator('[data-buy="0"]')).toBeDisabled();
  await page.locator('[data-view="daily"]').click();
  await expect(page.locator('#weeklyPrizeButton')).toBeDisabled();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp_v1_meta')));
  expect(saved.weeklyMissionClaims).toBe(5);
});

test('daily return cards fit narrow mobile screens without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openGame(page);
  await page.locator('[data-view="daily"]').click();
  await expect(page.locator('#dailyMissionList .return-mission')).toHaveCount(3);
  await expect(page.locator('#mysteryClaimButton')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
});
