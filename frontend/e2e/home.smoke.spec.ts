import { test, expect } from '@playwright/test';

/**
 * The overview: every demo card must link to its real route. A path with a
 * slash (pose/still) once rendered as /pose%2Fstill, which no route matches,
 * so the click silently bounced back to the overview.
 */

test('every card on the overview opens its demo', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('a.card');
  await expect(cards).toHaveCount(5);

  const hrefs = await cards.evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(['/pose', '/search', '/smartform', '/benchmark', '/pose/still']);

  await cards.nth(4).click();
  await expect(page).toHaveURL(/\/pose\/still$/);
  await expect(page.locator('app-pose-still')).toBeVisible();
});

test('the number keys open the demos, including 5', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a.card')).toHaveCount(5);
  await page.keyboard.press('5');
  await expect(page).toHaveURL(/\/pose\/still$/);
});
