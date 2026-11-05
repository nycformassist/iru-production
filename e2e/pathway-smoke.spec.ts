import { test, expect } from '@playwright/test';

async function gotoDashboard(page) {
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);
  // Select English if language screen is showing
  const englishBtn = page.locator('button:has-text("English")').first();
  if (await englishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await englishBtn.click();
    await page.waitForTimeout(1500);
  }
  // Look for the dashboard heading
  await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });
}

test('Pathway guidance appears on I-765 selection', async ({ page }) => {
  await gotoDashboard(page);
  const btn = page.locator('text=I-765 — Apply for a Work Permit');
  await btn.first().click();
  await page.waitForTimeout(1500);
  const panel = page.locator('[data-testid="pathway-guidance"]');
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(panel).toContainText('I-589');
  // I-589 + I-765 is the $349 special bundle (overrides the $50-off
  // $348 total): the panel shows the $349 bundle total and the $398
  // combined regular price, not a $199 add-on price.
  await expect(panel).toContainText('$349.00');
  await expect(panel).toContainText('$398.00');
  await expect(page.locator('[data-testid="pathway-continue"]')).toBeVisible();
});

test('Pathway guidance: N-400 shows no recommendations (terminal)', async ({ page }) => {
  await gotoDashboard(page);
  const btn = page.locator('text=N-400 — Become a U.S. Citizen');
  await btn.first().click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="pathway-continue"]')).toBeVisible();
});
