// Paid-access journey (owner directive 2026-11-05; paywall ON).
// Runs against the local dev servers with VITE_PAYWALL_ENABLED=true and
// PAYWALL_ENABLED=true on the API servers. Verifies the completion
// criterion: an unentitled visitor sees the public Pathway guidance and
// pricing but cannot start the questionnaire; a paid Readiness customer
// can. The entitled leg buys a real $99.95 Readiness (I-589) through the
// dev checkout + a signed webhook — the only step Playwright cannot do
// is the human click through Stripe's hosted Checkout page itself
// (bot protection, by design); the spec asserts the redirect target is
// checkout.stripe.com instead and returns via the real success URL.
import { test, expect, request } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SHOT = 'e2e/screenshots/paid-journey';

function webhookSecret(): string {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const m = env.match(/^STRIPE_WEBHOOK_SECRET=(.+)$/m);
  if (!m) throw new Error('STRIPE_WEBHOOK_SECRET not in .env.local');
  return m[1].trim();
}

async function buyReadinessI589(): Promise<{ token: string; sessionId: string }> {
  // Each run presents its own test client IP: the checkout limiter is
  // per-IP (5 / 10 min), so repeated spec runs from one machine would
  // otherwise exhaust each other's allowance. The browser leg keeps the
  // real IP — only the API seeding leg is namespaced per run.
  const testIp = `10.200.1.${1 + Math.floor(Math.random() * 250)}`;
  const api = await request.newContext({ baseURL: 'http://localhost:3001' });
  try {
    const co = await api.post('/api/checkout', {
      data: { sku: 'iru-readiness', form: 'I-589' },
      headers: { 'x-forwarded-for': testIp },
    });
    expect(co.ok()).toBeTruthy();
    const coBody = await co.json();
    expect(coBody.amountCents).toBe(9995);
    expect(coBody.scope).toEqual({ kind: 'readiness', forms: ['I-589'] });
    expect(new URL(coBody.checkoutUrl).host).toBe('checkout.stripe.com');
    const m = String(coBody.checkoutUrl).match(/(cs_test_[A-Za-z0-9]+)/);
    expect(m).toBeTruthy();
    const sessionId = m![1];
    const event = {
      id: `evt_paid_journey_${Date.now()}`,
      type: 'checkout.session.completed',
      data: { object: { id: sessionId, payment_status: 'paid' } },
    };
    const payload = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', webhookSecret()).update(`${ts}.${payload}`).digest('hex');
    const wh = await api.post('http://localhost:3002/api/webhook', {
      data: payload,
      headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}`, 'x-forwarded-for': testIp },
    });
    expect(wh.ok()).toBeTruthy();
    const whBody = await wh.json();
    expect(whBody.applied).toBe(true);
    return { token: coBody.entitlementToken as string, sessionId };
  } finally {
    await api.dispose();
  }
}

async function gotoDashboard(page) {
  await page.goto('http://localhost:5173/');
  // Paywall ON: the app starts at ENTRY (public product screen). The
  // "Browse forms" card is the public path to form selection.
  await expect(page.locator('text=Browse forms')).toBeVisible({ timeout: 15000 });
  await page.locator('text=Browse forms').click();
  await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });
}

test('unentitled visitor sees the Pathway panel and pricing but cannot start the questionnaire', async ({ page }) => {
  await gotoDashboard(page);
  await page.locator('text=I-765 — Apply for a Work Permit').first().click();
  const panel = page.locator('[data-testid="pathway-guidance"]');
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(panel).toContainText('I-589');
  await expect(panel).toContainText('$349.00');
  await expect(page.locator('[data-testid="pathway-continue"]')).toBeVisible();
  await page.screenshot({ path: `${SHOT}/01-unentitled-pathway-panel.png` });
  // "Continue with just this form" must land on the gate, not the questionnaire.
  await page.locator('[data-testid="pathway-continue"]').click();
  await expect(page.locator('text=A purchase is required')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="btn-next"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toHaveCount(0);
  await page.screenshot({ path: `${SHOT}/02-unentitled-gate.png` });
});

test('paid Readiness customer can start the I-589 questionnaire', async ({ page }) => {
  const { token, sessionId } = await buyReadinessI589();
  // Mirror what handleCheckout stores at purchase time: the readiness
  // token in its localStorage map. The gate re-verifies it server-side.
  await page.addInitScript((tok) => {
    localStorage.setItem('iru_readiness_tokens', JSON.stringify({ 'I-589': tok }));
  }, token);
  // The return URL re-checks the session at Stripe: this test session
  // was never paid through hosted Checkout (only a human can complete
  // that page), so the app correctly sends the visitor back to ENTRY.
  // The webhook-paid local entitlement is what grants access — through
  // "Continue my case", which verifies the stored token server-side.
  await page.goto(`/?checkout=success&session_id=${sessionId}`);
  await expect(page.locator('text=Continue my case')).toBeVisible({ timeout: 15000 });
  await page.locator('text=Continue my case').click();
  // Readiness scope enters the readiness flow (LANG).
  const englishBtn = page.locator('button:has-text("English")').first();
  await expect(englishBtn).toBeVisible({ timeout: 15000 });
  await englishBtn.click();
  await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });
  await page.screenshot({ path: `${SHOT}/03-entitled-dashboard.png` });
  await page.locator('text=I-589 — Apply for Asylum').first().click();
  const panel = page.locator('[data-testid="pathway-guidance"]');
  await expect(panel).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="pathway-continue"]').click();
  // The questionnaire renders: a question input or the Next button, and
  // no gate screen.
  await expect(page.locator('[data-testid="btn-next"], [data-testid="btn-see-report"]').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text=A purchase is required')).toHaveCount(0);
  await page.screenshot({ path: `${SHOT}/04-entitled-questionnaire.png` });
});

test('PACKAGES shows the 9 products at the approved prices and no $1 evaluation offer', async ({ page }) => {
  await gotoDashboard(page);
  await page.locator('text=I-765 — Apply for a Work Permit').first().click();
  await page.locator('[data-testid="pathway-continue"]').click();
  await expect(page.locator('text=A purchase is required')).toBeVisible({ timeout: 10000 });
  await page.locator('text=See products').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('text=Immigration Readiness').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text=Form Preparation').first()).toBeVisible();
  for (const form of ['I-589', 'I-765', 'I-130', 'I-485', 'N-400', 'I-90']) {
    await expect(page.locator(`text=${form}`).first()).toBeVisible();
  }
  for (const price of ['$99.95', '$149.00', '$199.00', '$249.00', '$349.00']) {
    await expect(page.locator(`text=${price}`).first()).toBeVisible();
  }
  // Exactly 9 purchasable products: 2 Readiness + 6 Preparation + 1 bundle.
  await expect(page.locator('button:has-text("Choose —")')).toHaveCount(9);
  await expect(page.locator('text=$1.00')).toHaveCount(0);
  await expect(page.locator('text=limited evaluation')).toHaveCount(0);
  await page.screenshot({ path: `${SHOT}/05-packages.png` });
});
