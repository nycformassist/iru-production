// e2e/pathway-crawl.spec.ts — FULL Pathway + paywall crawl (part 1 of 5).
//
// For each form WITH a recommendation: dashboard → form card → Pathway panel
// (name / related form / discount math / total) → Add → checkout summary
// (line items / discount-or-bundle / total / "Continue with just this form")
// → Proceed → assert redirect URL is checkout.stripe.com (URL ONLY).
// Terminal forms (N-400, I-90) must show NO Pathway panel.
// Screenshots of every state. Console/pageerror/request-failure logging;
// any JS error on a localhost page FAILS the test.
//
// BOUNDARIES (hard):
// - Do NOT interact with Stripe's hosted Checkout page beyond asserting the
//   redirect URL. Stripe's bot protection withholds the card form from
//   automated browsers; circumventing it is off-limits.
// - 4 Proceed clicks per project run: /api/checkout rate limiter is 5 per
//   10 min per IP (in-memory in dev-api-server). Restart dev-api-server
//   (scripts/restart-dev-api.sh) BETWEEN project runs.
// - Chromium reaches checkout.stripe.com only through the proxy shim
//   (127.0.0.1:8888); direct CONNECT gets 403 from the egress proxy.
import { test, expect, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test.use({
  proxy: { server: 'http://127.0.0.1:8888', bypass: 'localhost,127.0.0.1' },
  ignoreHTTPSErrors: true,
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'screenshots', 'pathway-crawl');
fs.mkdirSync(SHOT_DIR, { recursive: true });

type CrawlCase = {
  key: string;
  cardText: string;
  formCode: string;
  related: { code: string; addButtonPrice: string }[];
  proceedWith: string; // which related form to Add + Proceed with
  summaryTotal: string;
  bundle: boolean;
  summaryRegulars: string[];
};

const CASES: CrawlCase[] = [
  {
    key: 'i765', cardText: 'I-765 — Apply for a Work Permit', formCode: 'I-765',
    related: [{ code: 'I-589', addButtonPrice: '$349.00' }],
    proceedWith: 'I-589', summaryTotal: '$349.00', bundle: true,
    summaryRegulars: ['$149.00', '$249.00'],
  },
  {
    key: 'i589', cardText: 'I-589 — Apply for Asylum', formCode: 'I-589',
    related: [{ code: 'I-765', addButtonPrice: '$349.00' }],
    proceedWith: 'I-765', summaryTotal: '$349.00', bundle: true,
    summaryRegulars: ['$249.00', '$149.00'],
  },
  {
    key: 'i130', cardText: 'I-130 — Petition for a Family Member', formCode: 'I-130',
    related: [{ code: 'I-485', addButtonPrice: '$199.00' }],
    proceedWith: 'I-485', summaryTotal: '$398.00', bundle: false,
    summaryRegulars: ['$199.00', '$249.00'],
  },
  {
    key: 'i485', cardText: 'I-485 — Apply for a Green Card', formCode: 'I-485',
    related: [
      { code: 'I-765', addButtonPrice: '$99.00' },
      { code: 'I-130', addButtonPrice: '$149.00' },
    ],
    proceedWith: 'I-765', summaryTotal: '$348.00', bundle: false,
    summaryRegulars: ['$249.00', '$149.00'],
  },
];

const TERMINAL = [
  { key: 'n400', cardText: 'N-400 — Become a U.S. Citizen', formCode: 'N-400' },
  { key: 'i90', cardText: 'I-90 — Renew or Replace My Green Card', formCode: 'I-90' },
];

async function gotoDashboard(page: Page) {
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);
  const englishBtn = page.locator('button:has-text("English")').first();
  if (await englishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await englishBtn.click();
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });
}


// Screenshots are evidence, not the assertion: a hung font load must never
// fail the test. Best-effort capture with a short timeout.
async function safeShot(page: Page, file: string) {
  try {
    await page.screenshot({ path: file, timeout: 10000 });
  } catch (e: any) {
    console.log(`  [shot-skip] ${file}: ${e?.message?.split('\n')[0] || e}`);
  }
}

function shotName(page: Page, formKey: string, state: string) {
  const vp = page.viewportSize();
  const label = vp ? `${vp.width}x${vp.height}` : 'unknown';
  return path.join(SHOT_DIR, `${formKey}-${label}-${state}.png`);
}

// Collect JS errors / console errors / failed requests. Classification
// must use the FAILING URL for requestfailed (a Stripe iframe aborting
// when the test navigates away is js.stripe.com noise, not an app bug -
// the page URL is localhost for every entry, so classifying on it
// mis-flags external aborts as local). pageerror / console.error belong
// to the page that produced them.
type CollectedError = { kind: string; pageUrl: string; targetUrl: string; text: string };
function attachErrorCollectors(page: Page) {
  const errors: CollectedError[] = [];
  page.on('pageerror', (err) => {
    errors.push({ kind: 'pageerror', pageUrl: page.url(), targetUrl: page.url(), text: err.message });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push({ kind: 'console.error', pageUrl: page.url(), targetUrl: page.url(), text: msg.text() });
  });
  page.on('requestfailed', (req) => {
    errors.push({ kind: 'requestfailed', pageUrl: page.url(), targetUrl: req.url(), text: req.failure()?.errorText || '' });
  });
  return errors;
}

function assertNoLocalErrors(errors: CollectedError[]) {
  const isLocal = (u: string) => u.includes('localhost:5173') || u.includes('localhost:3001') || u.includes('localhost:8000');
  const local = errors.filter((e) => isLocal(e.targetUrl));
  // Filter known-benign noise (favicon, Vite client pings).
  const real = local.filter((e) => !e.targetUrl.includes('favicon.ico'));
  expect(real, 'localhost JS/network errors:\n' + real.map((e) => e.kind + ' ' + e.targetUrl + ' ' + e.text).join('\n')).toEqual([]);
  if (errors.length > 0) console.log('  [note] non-local errors logged (not failed):\n  ' + errors.filter((e) => !local.includes(e)).map((e) => e.kind + ' ' + e.targetUrl + ' ' + e.text).join('\n  '));
}

for (const c of CASES) {
  test(`crawl ${c.formCode}: panel → Add ${c.proceedWith} → summary → Stripe redirect`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = attachErrorCollectors(page);
    await gotoDashboard(page);
    await page.locator(`text=${c.cardText}`).first().click();
    await page.waitForTimeout(1500);

    // --- Pathway panel ---
    const panel = page.locator('[data-testid="pathway-guidance"]');
    await expect(panel, `${c.formCode} panel visible`).toBeVisible({ timeout: 10000 });
    await expect(panel).toContainText(c.formCode);
    for (const rel of c.related) {
      await expect(panel).toContainText(rel.code);
      const addBtn = page.locator(`[data-testid="pathway-add-${rel.code}"]`);
      await expect(addBtn, `Add ${rel.code} button`).toBeVisible();
      await expect(addBtn).toContainText(rel.addButtonPrice);
    }
    if (c.bundle) {
      await expect(panel).toContainText('special bundle price');
      await expect(panel).toContainText('$349.00');
    } else {
      await expect(panel).toContainText('save $50');
    }
    // Decline path is present with no pressure.
    await expect(page.locator('[data-testid="pathway-dismiss"]')).toBeVisible();
    await expect(page.locator('[data-testid="pathway-dismiss"]')).toContainText(`Continue with just ${c.formCode}`);
    await safeShot(page, shotName(page, c.key, '01-panel'));

    // --- Checkout summary ---
    await page.locator(`[data-testid="pathway-add-${c.proceedWith}"]`).click();
    await page.waitForTimeout(1000);
    const summary = page.locator('[data-testid="pathway-checkout-summary"]');
    await expect(summary, 'summary visible').toBeVisible({ timeout: 10000 });
    await expect(summary).toContainText(c.formCode);
    await expect(summary).toContainText(c.proceedWith);
    for (const regular of c.summaryRegulars) await expect(summary).toContainText(regular);
    if (c.bundle) {
      await expect(summary).toContainText('Special bundle price');
    } else {
      await expect(summary).not.toContainText('Special bundle price');
    }
    await expect(page.locator('[data-testid="pathway-summary-total"]')).toContainText(c.summaryTotal);
    await expect(summary).toContainText(`continue with just ${c.formCode} instead`);
    await expect(page.locator('[data-testid="pathway-proceed-checkout"]')).toBeVisible();
    await expect(page.locator('[data-testid="pathway-proceed-checkout"]')).toContainText(c.summaryTotal);
    await expect(page.locator('[data-testid="pathway-summary-back"]')).toBeVisible();
    await safeShot(page, shotName(page, c.key, '02-summary'));

    // --- Proceed → redirect URL only ---
    await page.locator('[data-testid="pathway-proceed-checkout"]').click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000, waitUntil: 'domcontentloaded' });
    const stripeUrl = page.url();
    expect(stripeUrl).toContain('checkout.stripe.com');
    expect(stripeUrl).toMatch(/cs_test_[A-Za-z0-9]+/);
    console.log(`  ${c.formCode} redirect OK: ${stripeUrl.slice(0, 90)}...`);
    await page.waitForTimeout(3000);
    await safeShot(page, shotName(page, c.key, '03-stripe-redirect'));

    assertNoLocalErrors(errors);
  });
}

for (const t of TERMINAL) {
  test(`crawl ${t.formCode} (terminal): NO Pathway panel, questionnaire starts`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = attachErrorCollectors(page);
    await gotoDashboard(page);
    await page.locator(`text=${t.cardText}`).first().click();
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="pathway-guidance"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pathway-continue"]')).toBeVisible();
    await safeShot(page, shotName(page, t.key, '01-no-panel'));
    await page.locator('[data-testid="pathway-continue"]').click();
    await page.waitForTimeout(1500);
    // Questionnaire starts: Save Progress button is present.
    await expect(page.locator('[data-testid="btn-save"]')).toBeVisible({ timeout: 10000 });
    await safeShot(page, shotName(page, t.key, '02-questionnaire'));
    assertNoLocalErrors(errors);
  });
}
