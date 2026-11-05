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

test('Pathway Add I-589 shows $349 bundle summary', async ({ page }) => {
  await gotoDashboard(page);
  const btn = page.locator('text=I-765 — Apply for a Work Permit');
  await btn.first().click();
  await page.waitForTimeout(1500);
  const panel = page.locator('[data-testid="pathway-guidance"]');
  await expect(panel).toBeVisible({ timeout: 10000 });

  // Add the related form: the panel button shows the bundle total.
  const addBtn = page.locator('[data-testid="pathway-add-I-589"]');
  await expect(addBtn).toBeVisible();
  await expect(addBtn).toContainText('$349.00');
  await addBtn.click();
  await page.waitForTimeout(1000);

  // Checkout summary: both forms, regular prices, bundle note, $349 total.
  const summary = page.locator('[data-testid="pathway-checkout-summary"]');
  await expect(summary).toBeVisible({ timeout: 10000 });
  await expect(summary).toContainText('I-765');
  await expect(summary).toContainText('I-589');
  await expect(summary).toContainText('$149.00');
  await expect(summary).toContainText('$249.00');
  await expect(summary).toContainText('Special bundle price');
  await expect(page.locator('[data-testid="pathway-summary-total"]')).toContainText('$349.00');
  await expect(page.locator('[data-testid="pathway-proceed-checkout"]')).toBeVisible();
  await expect(page.locator('[data-testid="pathway-proceed-checkout"]')).toContainText('$349.00');

  // Back returns to the guidance panel — no purchase made.
  await page.locator('[data-testid="pathway-summary-back"]').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible();
  await expect(page.locator('[data-testid="pathway-checkout-summary"]')).toHaveCount(0);
});

test('Declining the Pathway add-on proceeds to the questionnaire with no checkout', async ({ page }) => {
  await gotoDashboard(page);
  const btn = page.locator('text=I-765 — Apply for a Work Permit');
  await btn.first().click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });

  // "Continue with just I-765" — no checkout summary, no payment.
  await page.locator('[data-testid="pathway-continue"]').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="pathway-checkout-summary"]')).toHaveCount(0);
  // The I-765 questionnaire starts (eligibility category screen).
  await expect(page.locator('text=What is your eligibility category for employment authorization?')).toBeVisible({ timeout: 10000 });
});

test('Pathway Add I-485 shows $398 non-bundle summary (regular less $50)', async ({ page }) => {
  await gotoDashboard(page);
  const btn = page.locator('text=I-130 — Petition for a Family Member');
  await btn.first().click();
  await page.waitForTimeout(1500);
  const panel = page.locator('[data-testid="pathway-guidance"]');
  await expect(panel).toBeVisible({ timeout: 10000 });

  const addBtn = page.locator('[data-testid="pathway-add-I-485"]');
  await expect(addBtn).toBeVisible();
  // I-485 additional-form price: $249 − $50 = $199 (no bundle here).
  await expect(addBtn).toContainText('$199.00');
  await addBtn.click();
  await page.waitForTimeout(1000);

  const summary = page.locator('[data-testid="pathway-checkout-summary"]');
  await expect(summary).toBeVisible({ timeout: 10000 });
  await expect(summary).toContainText('I-130');
  await expect(summary).toContainText('I-485');
  await expect(summary).toContainText('$199.00');
  await expect(summary).toContainText('$249.00');
  // I-130 $199 full + I-485 $199 additional = $398. No bundle note.
  await expect(page.locator('[data-testid="pathway-summary-total"]')).toContainText('$398.00');
  await expect(summary).not.toContainText('Special bundle price');
});
