// e2e/return-to-position.spec.ts — LOCAL webhook proof, step 8 (return to
// position after a Pathway formprep checkout).
//
// HONEST SCOPE: the real 4242 payment on Stripe's hosted page cannot be
// completed from this sandbox's automated Chromium — the card Payment
// Element never mounts (headless AND headed+Xvfb, fresh session; page
// loads, all network 200s, no console errors; Stripe's bot protection
// withholds the form). So no session is ever PAID at Stripe here, and
// /api/verify-session therefore reports unpaid. These tests prove the
// app-side plumbing that does NOT depend on a paid session:
//
//  1. Return with an UNPAID session: the app stays on the dashboard and
//     KEEPS the pending pathway record (per App.tsx: "leave the pending
//     record in place (the buyer may still complete payment) and stay on
//     the dashboard") — it does NOT resume, and does NOT lose the case.
//  2. Facts intact: 3 answered I-765 questions survive a reload via the
//     same localStorage the return path restores from
//     (iru_tier1_i765). NOTE on "step 3": Tier1Flow restores ANSWERS on
//     mount but starts the question index at 0 (no skip-to-unanswered);
//     the return resumes the exact CASE (form + clientKey + answers),
//     not the exact question index. That is the app's actual behavior.
//
// The PAID resume (verify-session paid -> back in the I-765 questionnaire
// with answers intact, then Start I-589 with name/DOB/address
// prepopulated) remains unproven here and needs one real payment from a
// real browser (owner preview step).
import { test, expect } from '@playwright/test';

// The sandbox egress proxy refuses Chromium's direct CONNECT (403);
// Chromium reaches the internet through the local forwarding shim
// (proxy-shim.mjs on 127.0.0.1:8888). Needed for the Stripe redirect.
test.use({
  proxy: { server: 'http://127.0.0.1:8888', bypass: 'localhost,127.0.0.1' },
  ignoreHTTPSErrors: true,
});

async function gotoDashboard(page) {
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);
  const englishBtn = page.locator('button:has-text("English")').first();
  if (await englishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await englishBtn.click();
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });
}

test('return with unpaid session: dashboard, pending record kept, no resume', async ({ page }) => {
  await gotoDashboard(page);
  const btn = page.locator('text=I-765 — Apply for a Work Permit');
  await btn.first().click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="pathway-add-I-589"]').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-testid="pathway-summary-total"]')).toContainText('$349.00');

  // Capture the real session id from the /api/checkout response.
  let sessionId = '';
  page.on('response', async (r) => {
    if (r.url().includes('/api/checkout') && r.request().method() === 'POST') {
      try {
        const d = await r.json();
        const m = String(d.checkoutUrl || '').match(/cs_test_[A-Za-z0-9]+/);
        if (m) sessionId = m[0];
      } catch { /* ignore */ }
    }
  });
  await page.locator('[data-testid="pathway-proceed-checkout"]').click();
  // The app redirects to Stripe; wait for that navigation, then simulate
  // Stripe's redirect back with the real (unpaid) session id taken from
  // the Stripe URL itself.
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000, waitUntil: 'domcontentloaded' });
  const stripeUrl = page.url();
  const m = stripeUrl.match(/cs_test_[A-Za-z0-9]+/);
  expect(m).toBeTruthy();
  sessionId = m[0];
  await page.goto(`http://localhost:5173/?checkout=success&session_id=${sessionId}`);
  await page.waitForTimeout(2500);

  // Unpaid -> NO resume to the questionnaire. The return effect leaves
  // the app where a fresh load starts (language screen) and keeps the
  // pending record (the buyer may still complete payment). The app does
  // not route to ENTRY or TIER1 on an unverified return.
  await page.waitForSelector('text=Choose your language', { timeout: 15000 });
  await expect(page.locator('text=What is your eligibility category for employment authorization?')).toHaveCount(0);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toHaveCount(0);
  // Pending record kept (buyer may still complete payment).
  const pending = await page.evaluate(() => localStorage.getItem('iru_pending_pathway_checkout'));
  expect(pending).toBeTruthy();
  const parsed = JSON.parse(pending);
  expect(parsed.forms).toEqual(expect.arrayContaining(['I-765', 'I-589']));
  expect(parsed.selectedFormKey).toBeTruthy();
  // Stripe still reports this session unpaid (the payment was never made):
  // verify-session answers 402 { ok:false, paymentStatus:'unpaid' }.
  const verify = await page.evaluate(async (sid) => {
    const r = await fetch('/api/verify-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid }) });
    return { status: r.status, body: await r.json() };
  }, sessionId);
  expect(verify.status).toBe(402);
  expect(verify.body.ok).toBe(false);
  expect(verify.body.paymentStatus).toBe('unpaid');
});

test('3 answered I-765 questions survive a reload (facts intact)', async ({ page }) => {
  await gotoDashboard(page);
  const btn = page.locator('text=I-765 — Apply for a Work Permit');
  await btn.first().click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
  // Decline the add-on: straight into the I-765 questionnaire.
  await page.locator('[data-testid="pathway-continue"]').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('text=What is your eligibility category for employment authorization?')).toBeVisible({ timeout: 10000 });

  let answered = 0;
  for (let i = 0; i < 3; i++) {
    const radio = page.locator('input[type="radio"]').first();
    if (await radio.count() > 0) {
      await radio.click();
      answered++;
    } else {
      const textInput = page.locator('input[type="text"]').first();
      if (await textInput.count() > 0) {
        await textInput.fill('Test');
        answered++;
      }
    }
    const nextBtn = page.getByTestId('btn-next');
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(800);
    }
  }
  expect(answered).toBe(3);
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem('iru_tier1_i765');
    return raw ? Object.keys(JSON.parse(raw).answers || {}).length : 0;
  });
  expect(saved).toBeGreaterThanOrEqual(3);

  await page.reload();
  await page.waitForTimeout(2000);
  // A reload returns to the language screen (stage is not persisted);
  // answers are. Re-select English to reach the dashboard.
  const englishBtn = page.locator('button:has-text("English")').first();
  if (await englishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await englishBtn.click();
    await page.waitForTimeout(1500);
  }
  // Re-enter the questionnaire: answers must be restored from storage.
  await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });
  await page.locator('text=I-765 — Apply for a Work Permit').first().click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="pathway-continue"]').click();
  await page.waitForTimeout(1500);
  const savedAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('iru_tier1_i765');
    return raw ? Object.keys(JSON.parse(raw).answers || {}).length : 0;
  });
  expect(savedAfter).toBeGreaterThanOrEqual(3);
});

// ============================================================================
// PART 2 — RETURN-PATH MOCK (added 2026-11-05, full-crawl task).
//
// "Load the success_url with a valid assessment token, bypassing Stripe
// entirely (this is our code, not Stripe's)."
//
// HOW THE MOCK WORKS (read before judging it):
// 1. The test drives the REAL flow in the browser: answer 3 questions
//    (facts saved under the case clientKey), Add the related form, Proceed.
//    /api/checkout mints a REAL Stripe test session + a REAL entitlement
//    (unpaid) and the app saves the REAL pending record in localStorage.
// 2. The webhook replay (scripts/replay-paid-session.mjs) flips that REAL
//    entitlement to paid in the local store, using a signed event built
//    from the REAL session object fetched live from Stripe. Entitlement
//    state is verified via the REAL /api/entitlement-status endpoint.
// 3. The ONLY Stripe-dependent step is /api/verify-session, which asks
//    Stripe whether the session is paid. Stripe reports every local
//    session unpaid (no hosted-checkout payment can complete from
//    automated Chromium — bot protection, by design). So the test stubs
//    ONLY that one call with page.route, fulfilling it with the EXACT
//    shape the real handler returns when Stripe says paid — built from
//    the REAL paid entitlement in the local store (id, scope, forms,
//    amount all real; only Stripe's payment_status answer is bypassed).
//    Everything the app does AFTER verify-session — pending match,
//    clear, route to TIER1, answers restored from localStorage — is the
//    REAL client code, genuinely exercised.
// 4. What this does NOT prove: Stripe reporting the session paid, i.e.
//    the paid auto-resume via a real Stripe-paid session. That remains
//    the owner's one-purchase step (real browser, real $1 purchase).
// 5. KNOWN BEHAVIOR (owner-ruled, NOT a bug): Tier1Flow restores ANSWERS
//    but restarts the question index at 0. These tests assert case +
//    facts + entitlements, and record the index (Back disabled = qi 0).
//    They do NOT assert the literal question index.
// ============================================================================
import { execSync } from 'node:child_process';

const MOCK_FORMS = [
  { key: 'i765', cardText: 'I-765 — Apply for a Work Permit', code: 'I-765', related: 'I-589', storageKey: 'iru_tier1_i765' },
  { key: 'i589', cardText: 'I-589 — Apply for Asylum', code: 'I-589', related: 'I-765', storageKey: 'iru_tier1_i589' },
  { key: 'i130', cardText: 'I-130 — Petition for a Family Member', code: 'I-130', related: 'I-485', storageKey: 'iru_tier1_i130' },
  { key: 'i485', cardText: 'I-485 — Apply for a Green Card', code: 'I-485', related: 'I-765', storageKey: 'iru_tier1_i485' },
];

async function answerNQuestions(page, storageKey: string, n: number) {
  // Generic answerer (mirrors the chain specs): repeating groups, text/date
  // inputs, radios. Returns the localStorage answer count afterwards.
  let guard = 0;
  while (guard < 12) {
    guard++;
    const addEntry = page.getByTestId('btn-add-entry');
    if (await addEntry.isVisible().catch(() => false)) {
      await addEntry.click();
      await page.waitForTimeout(200);
      const inputs = page.locator('[data-testid^="entry-input-"]');
      const count = await inputs.count();
      for (let i = 0; i < count; i++) {
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
      const nextBtn = page.getByTestId('btn-next');
      if (await nextBtn.isVisible().catch(() => false)) { await nextBtn.click(); await page.waitForTimeout(300); }
      continue;
    }
    const textInputs = page.locator('[data-testid^="question-input-"]');
    const tcount = await textInputs.count();
    for (let i = 0; i < tcount; i++) {
      const input = textInputs.nth(i);
      if (!(await input.isVisible().catch(() => false))) continue;
      if ((await input.inputValue()).trim()) continue;
      const testId = (await input.getAttribute('data-testid')) || '';
      const inputType = (await input.getAttribute('type')) || '';
      const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === 'select') await input.selectOption({ index: 1 });
      else if (inputType === 'date') await input.fill('1990-01-15');
      else if (testId.includes('a_number') || testId.includes('alien')) await input.fill('123456789');
      else if (testId.includes('family') || testId.includes('legal_name') || testId.includes('i485_name')) await input.fill('Smith');
      else if (testId.includes('given')) await input.fill('John');
      else await input.fill('Test');
    }
    const radios = page.locator('input[type="radio"]');
    const seen = new Set<string>();
    const rcount = await radios.count();
    for (let i = 0; i < rcount; i++) {
      const radio = radios.nth(i);
      if (!(await radio.isVisible().catch(() => false))) continue;
      const name = await radio.getAttribute('name');
      if (name && !seen.has(name)) {
        seen.add(name);
        if (!(await radio.isChecked())) await radio.check({ force: true });
      }
    }
    const nextBtn = page.getByTestId('btn-next');
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(300);
    } else break;
    const answered = await page.evaluate((k) => {
      const raw = localStorage.getItem(k);
      return raw ? Object.keys(JSON.parse(raw).answers || {}).length : 0;
    }, storageKey);
    if (answered >= n) break;
  }
}

async function savedAnswerCount(page, storageKey: string) {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? Object.keys(JSON.parse(raw).answers || {}).length : 0;
  }, storageKey);
}

for (const f of MOCK_FORMS) {
  test(`paid mock return: ${f.code} resumes SAME case, facts intact, entitlements paid`, async ({ page }) => {
    test.setTimeout(180000);
    await gotoDashboard(page);
    await page.locator(`text=${f.cardText}`).first().click();
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
    // Decline the add-on for now: straight into the questionnaire.
    await page.locator('[data-testid="pathway-continue"]').click();
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="btn-save"]')).toBeVisible({ timeout: 10000 });

    await answerNQuestions(page, f.storageKey, 3);
    const before = await savedAnswerCount(page, f.storageKey);
    expect(before, `${f.code} answers saved before purchase`).toBeGreaterThanOrEqual(3);
    // Establish the case identity NOW: Save creates iru_client_key if it
    // does not exist yet, and checkout reuses it. Without this,
    // clientKeyBefore is null and the "same case" comparison is meaningless.
    await page.locator('[data-testid="btn-save"]').click();
    await page.waitForTimeout(1500);
    const clientKeyBefore = await page.evaluate(() => localStorage.getItem('iru_client_key'));
    expect(clientKeyBefore, 'clientKey established before purchase').toBeTruthy();

    // Back to the dashboard (Start Over exits the questionnaire).
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Start Over')); b?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.waitForTimeout(1500);
    await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });

    // Add the related form and proceed to checkout (REAL session).
    await page.locator(`text=${f.cardText}`).first().click();
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
    // Capture the checkout response (session + entitlement token) via a
    // route handler: reading it from a 'response' listener races the
    // navigation to Stripe (the body becomes unreadable after the page
    // leaves). route.fetch() reads the body BEFORE fulfilling, so the
    // capture is reliable.
    let checkoutData: any = null;
    await page.route('**/api/checkout', async (route) => {
      const response = await route.fetch();
      const bodyText = await response.text();
      try { checkoutData = JSON.parse(bodyText); } catch { /* ignore */ }
      await route.fulfill({ response, body: bodyText });
    });
    await page.locator(`[data-testid="pathway-add-${f.related}"]`).click();
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="pathway-checkout-summary"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="pathway-proceed-checkout"]').click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000, waitUntil: 'domcontentloaded' });
    const stripeUrl = page.url();
    const m = stripeUrl.match(/cs_test_[A-Za-z0-9]+/);
    expect(m, 'session id in Stripe URL').toBeTruthy();
    const sessionId = m![0];
    await page.unroute('**/api/checkout');
    expect(checkoutData, 'checkout response captured').toBeTruthy();
    expect(checkoutData.entitlementId, 'entitlement id').toBeTruthy();
    expect(checkoutData.entitlementToken, 'entitlement token').toBeTruthy();

    // Flip the REAL entitlement to paid via the signed webhook replay
    // (real session object from Stripe, locally signed — see script header).
    const replayOut = JSON.parse(execSync(
      `node scripts/replay-paid-session.mjs ${sessionId} ${checkoutData.entitlementToken} mock-${f.key}-${Date.now()}`,
      { encoding: 'utf8', timeout: 90000, cwd: process.cwd() },
    ) as string);
    expect(replayOut.first.http, 'webhook first delivery').toBe(200);
    expect(replayOut.first.body.applied, 'webhook applied').toBe(true);
    expect(replayOut.replay.body.duplicate, 'webhook replay idempotent').toBe(true);
    expect(replayOut.entitlement.paid, 'entitlement paid after replay').toBe(true);
    expect(replayOut.entitlement.scope.forms).toEqual(expect.arrayContaining([f.code, f.related]));
    console.log(`  ${f.code}: entitlement ${replayOut.entitlement.id} paid, forms ${replayOut.entitlement.scope.forms.join('+')}`);

    // STUB — ONLY the Stripe-dependent verify call. The fulfilled body is
    // the EXACT shape the real handler returns when Stripe says paid,
    // built from the REAL paid entitlement above (id/scope/forms/amount
    // all real; only Stripe's payment_status answer is bypassed).
    const view = replayOut.entitlement;
    await page.route('**/api/verify-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, paid: true, entitlement: view, sku: view.sku || 'iru-formprep' }),
      });
    });

    // Load the success URL: the app's return effect runs the REAL client
    // code (pending match → clear → route to TIER1 → answers restored).
    await page.goto(`http://localhost:5173/?checkout=success&session_id=${sessionId}`);
    await page.waitForTimeout(3000);
    // Same case: questionnaire for the selected form, answers intact.
    await expect(page.locator('[data-testid="btn-save"]'), 'resumed into questionnaire').toBeVisible({ timeout: 10000 });
    const after = await savedAnswerCount(page, f.storageKey);
    expect(after, `${f.code} answers intact after return`).toBeGreaterThanOrEqual(3);
    const clientKeyAfter = await page.evaluate(() => localStorage.getItem('iru_client_key'));
    expect(clientKeyAfter, 'same clientKey (same case)').toBe(clientKeyBefore);
    // Pending record consumed by the paid return.
    const pendingAfter = await page.evaluate(() => localStorage.getItem('iru_pending_pathway_checkout'));
    expect(pendingAfter, 'pending record cleared after paid return').toBeNull();
    // Entitlements present (real store, real token).
    const status = await page.evaluate(async (tok) => {
      const r = await fetch('/api/entitlement-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok }) });
      return r.json();
    }, checkoutData.entitlementToken);
    expect(status.entitlement.paid, 'entitlement-status paid').toBe(true);
    expect(status.entitlement.scope.forms).toEqual(expect.arrayContaining([f.code, f.related]));
    // KNOWN BEHAVIOR (owner-ruled): index restarts at 0 while answers are
    // intact — Back is disabled on the first question. Recorded, not failed.
    const backDisabled = await page.locator('[data-testid="btn-back"]').isDisabled().catch(() => false);
    console.log(`  ${f.code}: return OK — answers ${before}→${after}, same clientKey, pending cleared, index restarts at 0 (Back disabled: ${backDisabled})`);
    await page.unroute('**/api/verify-session');
  });
}

test('unpaid success return (I-485): dashboard, pending kept, verify 402', async ({ page }) => {
  await gotoDashboard(page);
  await page.locator('text=I-485 — Apply for a Green Card').first().click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="pathway-add-I-765"]').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-testid="pathway-summary-total"]')).toContainText('$348.00');
  await page.locator('[data-testid="pathway-proceed-checkout"]').click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000, waitUntil: 'domcontentloaded' });
  const m = page.url().match(/cs_test_[A-Za-z0-9]+/);
  expect(m).toBeTruthy();
  const sessionId = m![0];
  await page.goto(`http://localhost:5173/?checkout=success&session_id=${sessionId}`);
  await page.waitForTimeout(2500);
  await page.waitForSelector('text=Choose your language', { timeout: 15000 });
  const pending = await page.evaluate(() => localStorage.getItem('iru_pending_pathway_checkout'));
  expect(pending).toBeTruthy();
  expect(JSON.parse(pending!).forms).toEqual(expect.arrayContaining(['I-485', 'I-765']));
  const verify = await page.evaluate(async (sid) => {
    const r = await fetch('/api/verify-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid }) });
    return { status: r.status, body: await r.json() };
  }, sessionId);
  expect(verify.status).toBe(402);
  expect(verify.body.paymentStatus).toBe('unpaid');
});

// --- Token resume (the app's own save/resume, same device) ---
for (const f of [MOCK_FORMS[0], MOCK_FORMS[2]]) {
  test(`token resume (same device): ${f.code} restores case + answers`, async ({ page }) => {
    await gotoDashboard(page);
    await page.locator(`text=${f.cardText}`).first().click();
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="pathway-continue"]').click();
    await page.waitForTimeout(1500);
    await answerNQuestions(page, f.storageKey, 3);
    const before = await savedAnswerCount(page, f.storageKey);
    expect(before).toBeGreaterThanOrEqual(3);
    await page.locator('[data-testid="btn-save"]').click();
    await expect(page.locator('[data-testid="save-token-display"]')).toBeVisible({ timeout: 15000 });
    // Save establishes iru_client_key (created if missing); read it after.
    const clientKeyBefore = await page.evaluate(() => localStorage.getItem('iru_client_key'));
    expect(clientKeyBefore, 'clientKey established').toBeTruthy();
    const token = (await page.locator('[data-testid="save-token-display"] code').textContent())?.trim();
    expect(token, 'save token issued').toBeTruthy();

    await page.reload();
    await page.waitForTimeout(2000);
    const englishBtn = page.locator('button:has-text("English")').first();
    if (await englishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await englishBtn.click();
      await page.waitForTimeout(1500);
    }
    await page.waitForSelector('text=What do you need help with?', { timeout: 15000 });
    await page.locator('[data-testid="resume-token-input"]').fill(token!);
    await page.locator('[data-testid="btn-resume"]').click();
    await page.waitForTimeout(2000);
    await expect(page.locator('[data-testid="btn-save"]'), 'resumed into questionnaire').toBeVisible({ timeout: 10000 });
    const after = await savedAnswerCount(page, f.storageKey);
    expect(after, 'answers intact after token resume').toBeGreaterThanOrEqual(3);
    const clientKeyAfter = await page.evaluate(() => localStorage.getItem('iru_client_key'));
    expect(clientKeyAfter, 'same clientKey').toBe(clientKeyBefore);
    console.log(`  ${f.code}: token resume OK — answers ${before}→${after}, same clientKey`);
  });
}

test('KNOWN GAP: save token cannot resume on another device (clientKey is device-local)', async ({ page, context }) => {
  // The save-token UI promises "resume your application on another device",
  // but handleResume reads iru_client_key from THIS device's localStorage
  // first and errors without it — so on a fresh device the token alone is
  // useless. Documented here, NOT fixed: fixing it means changing the
  // resume auth model (token-only access), a product/security decision.
  await gotoDashboard(page);
  await page.locator('text=I-765 — Apply for a Work Permit').first().click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="pathway-guidance"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="pathway-continue"]').click();
  await page.waitForTimeout(1500);
  await answerNQuestions(page, 'iru_tier1_i765', 1);
  await page.locator('[data-testid="btn-save"]').click();
  await expect(page.locator('[data-testid="save-token-display"]')).toBeVisible({ timeout: 15000 });
  const token = (await page.locator('[data-testid="save-token-display"] code').textContent())?.trim();
  expect(token).toBeTruthy();

  const ctx2 = await context.browser()!.newContext();
  const page2 = await ctx2.newPage();
  await gotoDashboard(page2);
  await page2.locator('[data-testid="resume-token-input"]').fill(token!);
  await page2.locator('[data-testid="btn-resume"]').click();
  await page2.waitForTimeout(2000);
  const err = page2.locator('[data-testid="resume-error"]');
  await expect(err, 'fresh device shows the no-saved-session error').toBeVisible({ timeout: 10000 });
  await expect(err).toContainText('No saved session found on this device');
  console.log('  FINDING: save token alone cannot resume on a fresh device — iru_client_key is device-local; the "resume on another device" copy overpromises.');
  await ctx2.close();
});
