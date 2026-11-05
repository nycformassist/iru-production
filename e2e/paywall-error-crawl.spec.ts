// e2e/paywall-error-crawl.spec.ts — PART 3 of the full crawl.
//
// Click EVERY button on EVERY screen of the paywall flow and log every
// console error, unhandled rejection, and failed request. Any bug found
// gets FIXED and the crawl re-run until clean.
//
// Screens covered:
//  1. Language screen + dashboard (language buttons, resume empty/garbage,
//     all 6 form cards + Back).
//  2. PATHWAY panel for every form (every Add button, dismiss, Continue,
//     Back) + questionnaire exit (Start Over).
//  3. Checkout summary for every recommended form (Back, Proceed → Stripe
//     redirect URL only).
//  4. Completion placement: full I-765 questionnaire → report → Pathway
//     panel → Add → summary → Back → Generate PDF → Start Over.
//
// Failure rule: any pageerror or console.error from a localhost page FAILS.
// Failed localhost API requests FAIL. External failures (fonts, Stripe
// subresources) are LOGGED for triage, not failed — Stripe's hosted page
// is out of scope and never interacted with beyond the redirect URL.
//
// Rate limiter: 4 /api/checkout POSTs per run (test 3). Restart
// dev-api-server (scripts/restart-dev-api.sh) BETWEEN project runs.
import { test, expect, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test.use({
  proxy: { server: 'http://127.0.0.1:8888', bypass: 'localhost,127.0.0.1' },
  ignoreHTTPSErrors: true,
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'screenshots', 'error-crawl');
fs.mkdirSync(SHOT_DIR, { recursive: true });

type Collected = { kind: string; pageUrl: string; targetUrl: string; text: string };
type Collector = { errors: Collected[] };

function attachCollectors(page: Page): Collector {
  const errors: Collected[] = [];
  page.on('pageerror', (err) => errors.push({ kind: 'pageerror', pageUrl: page.url(), targetUrl: page.url(), text: err.message }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push({ kind: 'console.error', pageUrl: page.url(), targetUrl: page.url(), text: msg.text() });
  });
  page.on('requestfailed', (req) => {
    errors.push({ kind: 'requestfailed', pageUrl: page.url(), targetUrl: req.url(), text: req.failure()?.errorText || '' });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push({ kind: `http-${res.status()}`, pageUrl: page.url(), targetUrl: res.url(), text: '' });
  });
  return { errors };
}

function isLocalUrl(u: string) {
  return /localhost:(5173|3001|3002|8000)/.test(u);
}

function triageAndAssert(c: Collector, label: string) {
  // pageerror / console.error belong to the page that produced them;
  // requestfailed / http-* belong to the URL that failed. A Stripe
  // iframe aborting when the test navigates AWAY from checkout is
  // external noise (js.stripe.com), not an app bug — classify by the
  // failing URL, not the page URL.
  const local = c.errors.filter((e) => isLocalUrl(e.targetUrl));
  const real = local.filter((e) => !e.targetUrl.includes('favicon.ico'));
  const external = c.errors.filter((e) => !local.includes(e));
  console.log(`  [${label}] total events: ${c.errors.length}, localhost: ${real.length}, external: ${external.length}`);
  for (const e of c.errors) console.log(`    - ${e.kind} @ ${e.targetUrl.slice(0, 160)} :: ${e.text.slice(0, 120)}`);
  expect(real, `localhost errors in ${label}:\n${real.map((e) => `${e.kind} ${e.targetUrl} ${e.text}`).join('\n')}`).toEqual([]);
}

async function safeShot(page: Page, file: string) {
  try {
    await page.screenshot({ path: file, timeout: 10000 });
  } catch (e: any) {
    console.log(`  [shot-skip] ${file}: ${e?.message?.split('\n')[0] || e}`);
  }
}

function shot(page: Page, name: string) {
  const vp = page.viewportSize();
  return path.join(SHOT_DIR, `${name}-${vp ? `${vp.width}x${vp.height}` : 'na'}.png`);
}

async function gotoLanguage(page: Page) {
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);
  await page.waitForSelector('text=Choose your language', { timeout: 15000 });
}

async function selectEnglish(page: Page) {
  const englishBtn = page.locator('button:has-text("English")').first();
  await englishBtn.click();
  await page.waitForTimeout(1500);
  await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });
}

const FORM_CARDS = [
  { key: 'n400', cardText: 'N-400 — Become a U.S. Citizen', code: 'N-400', related: [] as string[] },
  { key: 'i130', cardText: 'I-130 — Petition for a Family Member', code: 'I-130', related: ['I-485'] },
  { key: 'i485', cardText: 'I-485 — Apply for a Green Card', code: 'I-485', related: ['I-765', 'I-130'] },
  { key: 'i90', cardText: 'I-90 — Renew or Replace My Green Card', code: 'I-90', related: [] as string[] },
  { key: 'i589', cardText: 'I-589 — Apply for Asylum', code: 'I-589', related: ['I-765'] },
  { key: 'i765', cardText: 'I-765 — Apply for a Work Permit', code: 'I-765', related: ['I-589'] },
];

test('error crawl 1: language screen + dashboard buttons', async ({ page }) => {
  test.setTimeout(300000);
  const c = attachCollectors(page);
  await gotoLanguage(page);
  // Language buttons SELECT the language AND navigate to the dashboard
  // (onClick: setLang + setStage('DASHBOARD')). The choice persists
  // across reload (localStorage iru_lang), so a reload returns to the
  // LANG screen rendered in the persisted language.
  await page.locator('button:has-text("Español")').first().click();
  await page.waitForTimeout(1500);
  // Dashboard reached (in Spanish now); form cards are the stable marker.
  await expect(page.locator('text=N-400 — Become a U.S. Citizen').first()).toBeVisible({ timeout: 10000 });
  await safeShot(page, shot(page, 'lang-Espanol-dashboard'));
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);
  await expect(page.locator('text=Elija su idioma')).toBeVisible({ timeout: 10000 });
  await page.locator('button:has-text("English")').first().click();
  await page.waitForTimeout(1500);
  await expect(page.locator('text=N-400 — Become a U.S. Citizen').first()).toBeVisible({ timeout: 10000 });
  // Already on the English dashboard; continue with the resume tests.
  // Resume with empty token.
  await page.locator('[data-testid="btn-resume"]').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-testid="resume-error"]')).toBeVisible({ timeout: 10000 });
  // Resume with a garbage token (no clientKey on this device).
  await page.locator('[data-testid="resume-token-input"]').fill('garbage-token-123');
  await page.locator('[data-testid="btn-resume"]').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-testid="resume-error"]')).toBeVisible({ timeout: 10000 });
  await safeShot(page, shot(page, 'dashboard-resume-error'));
  // Every form card → PATHWAY → Back → dashboard.
  for (const f of FORM_CARDS) {
    await page.locator(`text=${f.cardText}`).first().click();
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-testid="pathway-back"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="pathway-back"]').click();
    await page.waitForTimeout(1000);
    await page.waitForSelector('text=What do you need help with?', { timeout: 10000 });
  }
  triageAndAssert(c, 'language+dashboard');
});

test('error crawl 2: PATHWAY panel buttons for every form', async ({ page }) => {
  test.setTimeout(300000);
  const c = attachCollectors(page);
  await gotoLanguage(page);
  await selectEnglish(page);
  for (const f of FORM_CARDS) {
    await page.locator(`text=${f.cardText}`).first().click();
    await page.waitForTimeout(1200);
    if (f.related.length === 0) {
      // Terminal form: no panel; Continue goes to the questionnaire.
      await expect(page.locator('[data-testid="pathway-guidance"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="pathway-continue"]')).toBeVisible();
      await page.locator('[data-testid="pathway-continue"]').click();
      await page.waitForTimeout(1200);
      await expect(page.locator('[data-testid="btn-save"]')).toBeVisible({ timeout: 10000 });
    } else {
      await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
      // Every Add button → summary → Back → panel.
      for (const rel of f.related) {
        const addBtn = page.locator(`[data-testid="pathway-add-${rel}"]`);
        await expect(addBtn).toBeVisible();
        await addBtn.click();
        await page.waitForTimeout(800);
        await expect(page.locator('[data-testid="pathway-checkout-summary"]')).toBeVisible({ timeout: 10000 });
        await page.locator('[data-testid="pathway-summary-back"]').click();
        await page.waitForTimeout(800);
        await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
      }
      // Dismiss → questionnaire → Start Over → dashboard.
      await page.locator('[data-testid="pathway-dismiss"]').click();
      await page.waitForTimeout(1200);
      await expect(page.locator('[data-testid="btn-save"]')).toBeVisible({ timeout: 10000 });
    }
    // Exit the questionnaire back to the dashboard.
    await page.locator('text=← Start Over').first().click();
    await page.waitForTimeout(1200);
    await page.waitForSelector('text=What do you need help with?', { timeout: 10000 });
    console.log(`  panel buttons OK: ${f.code}`);
  }
  triageAndAssert(c, 'pathway-panels');
});

test('error crawl 3: summary Proceed → Stripe redirect for every recommended form', async ({ page }) => {
  test.setTimeout(300000);
  const c = attachCollectors(page);
  await gotoLanguage(page);
  await selectEnglish(page);
  const withRecs = FORM_CARDS.filter((f) => f.related.length > 0);
  for (const f of withRecs) {
    await page.locator(`text=${f.cardText}`).first().click();
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
    await page.locator(`[data-testid="pathway-add-${f.related[0]}"]`).click();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="pathway-checkout-summary"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="pathway-proceed-checkout"]').click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000, waitUntil: 'domcontentloaded' });
    expect(page.url()).toContain('checkout.stripe.com');
    console.log(`  ${f.code} proceed redirect OK`);
    // Back to the app for the next form (fresh load; localStorage is per-origin).
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(1500);
    const englishBtn = page.locator('button:has-text("English")').first();
    if (await englishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await englishBtn.click();
      await page.waitForTimeout(1200);
    }
    await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });
  }
  triageAndAssert(c, 'summary-proceed');
});

test('error crawl 4: completion placement — full I-765 questionnaire → report → Add → Generate', async ({ page }) => {
  test.setTimeout(600000);
  const c = attachCollectors(page);
  page.on('dialog', async (dialog) => { await dialog.accept(); });
  await gotoLanguage(page);
  await selectEnglish(page);
  await page.locator('text=I-765 — Apply for a Work Permit').first().click();
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="pathway-continue"]').click();
  await page.waitForTimeout(1200);

  // Answer every question generically until the report (Generate) appears.
  let steps = 0;
  for (steps = 0; steps < 200; steps++) {
    if (await page.getByTestId('btn-generate').isVisible().catch(() => false)) break;
    const addBtn = page.getByTestId('btn-add-entry');
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(200);
      const inputs = page.locator('[data-testid^="entry-input-"]');
      for (let i = 0; i < await inputs.count(); i++) {
        const el = inputs.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        const tag = await el.evaluate((e) => e.tagName);
        const type = (await el.getAttribute('type')) ?? '';
        if (tag === 'SELECT') {
          const opts = await el.locator('option').all();
          if (opts.length > 1) await el.selectOption({ index: 1 });
        } else if (type === 'date') await el.fill('2020-01-01');
        else await el.fill('TestValue');
      }
      const saveBtn = page.getByTestId('btn-save-entry');
      if (await saveBtn.isVisible().catch(() => false)) await saveBtn.click();
      await page.waitForTimeout(200);
      const seeReport = page.getByTestId('btn-see-report');
      if (await seeReport.isVisible().catch(() => false)) await seeReport.click();
      else await page.getByTestId('btn-next').click();
      await page.waitForTimeout(200);
      continue;
    }
    const textInputs = page.locator('[data-testid^="question-input-"]');
    for (let i = 0; i < await textInputs.count(); i++) {
      const input = textInputs.nth(i);
      if (!(await input.isVisible().catch(() => false))) continue;
      if ((await input.inputValue()).trim()) continue;
      const testId = (await input.getAttribute('data-testid')) || '';
      const inputType = (await input.getAttribute('type')) || '';
      const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === 'select') await input.selectOption({ index: 1 });
      else if (inputType === 'date') await input.fill('1990-01-15');
      else if (testId.includes('a_number') || testId.includes('alien')) await input.fill('123456789');
      else if (testId.includes('family') || testId.includes('legal_name')) await input.fill('Smith');
      else if (testId.includes('given')) await input.fill('John');
      else await input.fill('Test');
    }
    const radios = page.locator('input[type="radio"]');
    const seen = new Set<string>();
    for (let i = 0; i < await radios.count(); i++) {
      const radio = radios.nth(i);
      if (!(await radio.isVisible().catch(() => false))) continue;
      const name = await radio.getAttribute('name');
      if (name && !seen.has(name)) {
        seen.add(name);
        if (!(await radio.isChecked())) await radio.check({ force: true });
      }
    }
    const seeReport = page.getByTestId('btn-see-report');
    if (await seeReport.isVisible().catch(() => false)) {
      await seeReport.click();
      await page.waitForTimeout(500);
      if (await page.getByTestId('btn-generate').isVisible().catch(() => false)) break;
      continue;
    }
    const nextBtn = page.getByTestId('btn-next');
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(200);
    } else break;
  }
  console.log(`  I-765 questionnaire completed in ${steps} steps`);
  const genBtn = page.getByTestId('btn-generate');
  await expect(genBtn, 'report reached (Generate visible)').toBeVisible({ timeout: 30000 });
  await safeShot(page, shot(page, 'completion-report'));

  // Completion placement: Pathway panel in the report → Add → summary → Back.
  const panel = page.locator('[data-testid="pathway-guidance"]');
  await expect(panel, 'completion Pathway panel').toBeVisible({ timeout: 10000 });
  await expect(panel).toContainText('I-589');
  await page.locator('[data-testid="pathway-add-I-589"]').click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="pathway-checkout-summary"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="pathway-summary-total"]')).toContainText('$349.00');
  await safeShot(page, shot(page, 'completion-summary'));
  await page.locator('[data-testid="pathway-summary-back"]').click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });

  // Generate the PDF (download) — proves the report's primary action works.
  const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
  await genBtn.click();
  const download = await downloadPromise;
  const pdfPath = '/tmp/error-crawl-i765.pdf';
  await download.saveAs(pdfPath);
  expect(fs.existsSync(pdfPath)).toBe(true);
  expect(fs.statSync(pdfPath).size).toBeGreaterThan(5000);
  console.log(`  completion Generate OK: PDF ${fs.statSync(pdfPath).size} bytes`);

  // Start Over returns to the dashboard.
  await page.locator('text=← Start Over').first().click();
  await page.waitForTimeout(1200);
  await page.waitForSelector('text=What do you need help with?', { timeout: 10000 });
  triageAndAssert(c, 'completion-placement');
});
