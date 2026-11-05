/**
 * api/catalog.test.js — Pricing catalog regression tests.
 *
 * These tests FREEZE the owner-approved prices. If any price changes,
 * these tests fail. Changing a price requires owner approval AND updating
 * these tests explicitly.
 *
 * Owner rulings:
 * - B2C prices: 2026-10-29 (do not reopen) — RETIRED 2026-11-05 for
 *   the four B2C SKUs (the $1 evaluation model is withdrawn; the rows
 *   below are the preserved historical record, released: false,
 *   retired: true). The retirement supersedes the 2026-10-29 ruling
 *   for these four SKUs only.
 * - Bundle prices: 2026-11-01 (do not reopen)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, getCatalogEntry, isPurchasable, getPurchasableSkus, validatePriceAgreement } from './_lib/catalog.js';

describe('pricing catalog — B2C retired record (2026-10-29 amounts, RETIRED 2026-11-05)', () => {
  it('evaluation is $1.00 — historical record, retired, not purchasable', () => {
    const e = getCatalogEntry('iru-evaluation');
    assert.ok(e, 'evaluation SKU exists');
    assert.equal(e.priceCents, 100);
    assert.equal(e.chargeCents, 100);
    assert.equal(e.released, false);
    assert.equal(e.retired, true);
    assert.equal(e.retiredReason, 'evaluation-retired');
  });

  it('one-form is $99.95 total, $98.95 charge (after $1 credit) — historical record, retired', () => {
    const e = getCatalogEntry('iru-complete-one-form');
    assert.ok(e, 'one-form SKU exists');
    assert.equal(e.priceCents, 9995);
    assert.equal(e.chargeCents, 9895);
    assert.equal(e.creditedCents, 100);
    assert.equal(e.released, false);
    assert.equal(e.retired, true);
    assert.equal(e.retiredReason, 'evaluation-retired');
  });

  it('two-form bundle is $149.95 total, $148.95 charge (after $1 credit) — historical record, retired', () => {
    const e = getCatalogEntry('iru-complete-bundle');
    assert.ok(e, 'bundle SKU exists');
    assert.equal(e.priceCents, 14995);
    assert.equal(e.chargeCents, 14895);
    assert.equal(e.creditedCents, 100);
    assert.equal(e.forms.length, 2);
    assert.deepEqual(e.forms, ['I-589', 'I-765']);
    assert.equal(e.released, false);
    assert.equal(e.retired, true);
    assert.equal(e.retiredReason, 'evaluation-retired');
  });

  it('second-form add-on is $50.00 — historical record, retired', () => {
    const e = getCatalogEntry('iru-second-form-addon');
    assert.ok(e, 'add-on SKU exists');
    assert.equal(e.priceCents, 5000);
    assert.equal(e.chargeCents, 5000);
    assert.equal(e.released, false);
    assert.equal(e.retired, true);
    assert.equal(e.retiredReason, 'evaluation-retired');
  });

  it('no retired B2C SKU is purchasable', () => {
    assert.equal(isPurchasable('iru-evaluation'), false);
    assert.equal(isPurchasable('iru-complete-one-form'), false);
    assert.equal(isPurchasable('iru-complete-bundle'), false);
    assert.equal(isPurchasable('iru-second-form-addon'), false);
  });
});

describe('pricing catalog — bundle frozen prices (2026-11-01)', () => {
  it('I-589 + I-765 bundle is $349.00', () => {
    const e = getCatalogEntry('iru-bundle-589-765');
    assert.ok(e, 'bundle SKU exists');
    assert.equal(e.priceCents, 34900);
    assert.equal(e.chargeCents, 34900);
    assert.deepEqual(e.forms, ['I-589', 'I-765']);
  });

  it('I-130 + I-485 + I-864 bundle is $549.00', () => {
    const e = getCatalogEntry('iru-bundle-130-485-864');
    assert.ok(e, 'bundle SKU exists');
    assert.equal(e.priceCents, 54900);
    assert.equal(e.chargeCents, 54900);
    assert.deepEqual(e.forms, ['I-130', 'I-485', 'I-864']);
  });

  it('I-130 + I-485 + I-864 + I-765 + I-131 bundle is $699.00', () => {
    const e = getCatalogEntry('iru-bundle-130-485-864-765-131');
    assert.ok(e, 'bundle SKU exists');
    assert.equal(e.priceCents, 69900);
    assert.equal(e.chargeCents, 69900);
    assert.deepEqual(e.forms, ['I-130', 'I-485', 'I-864', 'I-765', 'I-131']);
  });

  it('unreleased bundles cannot be purchased', () => {
    assert.equal(isPurchasable('iru-bundle-589-765'), false);
    assert.equal(isPurchasable('iru-bundle-130-485-864'), false);
    assert.equal(isPurchasable('iru-bundle-130-485-864-765-131'), false);
  });
});

describe('pricing catalog — structural invariants', () => {
  it('every entry has required fields', () => {
    for (const [sku, entry] of Object.entries(CATALOG)) {
      assert.ok(entry.sku, `${sku}: has sku`);
      assert.ok(entry.kind, `${sku}: has kind`);
      assert.ok(Array.isArray(entry.forms), `${sku}: forms is array`);
      assert.ok(typeof entry.priceCents === 'number' && entry.priceCents > 0, `${sku}: valid priceCents`);
      assert.ok(typeof entry.chargeCents === 'number' && entry.chargeCents > 0, `${sku}: valid chargeCents`);
      assert.ok(entry.name, `${sku}: has name`);
      assert.ok(typeof entry.released === 'boolean', `${sku}: released is boolean`);
      assert.ok(entry.scope, `${sku}: has scope`);
      assert.equal(entry.sku, sku, `${sku}: key matches sku field`);
    }
  });

  it('government filing fees are never included (preparation only)', () => {
    // This is a structural guard: no entry may claim to cover filing fees.
    // IRU charges are for preparation only.
    for (const [sku, entry] of Object.entries(CATALOG)) {
      const text = JSON.stringify(entry).toLowerCase();
      assert.ok(!text.includes('filing fee'), `${sku}: must not mention filing fees`);
      assert.ok(!text.includes('uscis fee'), `${sku}: must not mention USCIS fees`);
    }
  });

  it('unknown SKUs return null, never throw', () => {
    assert.equal(getCatalogEntry(null), null);
    assert.equal(getCatalogEntry(''), null);
    assert.equal(getCatalogEntry('nonexistent-sku'), null);
    assert.equal(isPurchasable('nonexistent-sku'), false);
  });
});

describe('pricing catalog — price agreement validation', () => {
  it('a retired SKU fails as retired, even at its historical price', () => {
    const r = validatePriceAgreement('iru-evaluation', 100);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'retired');
  });

  it('a retired SKU fails as retired before any price comparison', () => {
    // A mismatched price on a retired SKU still reports 'retired':
    // retirement is checked before the price comparison.
    const r = validatePriceAgreement('iru-evaluation', 200);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'retired');
  });

  it('unreleased SKU fails', () => {
    const r = validatePriceAgreement('iru-bundle-589-765', 34900);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-released');
  });

  it('unknown SKU fails', () => {
    const r = validatePriceAgreement('bogus', 100);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unknown-sku');
  });
});

describe('pricing catalog — purchasable SKUs', () => {
  it('only released SKUs are purchasable — the four retired B2C SKUs are excluded', () => {
    const purchasable = getPurchasableSkus();
    assert.ok(!purchasable.includes('iru-evaluation'));
    assert.ok(!purchasable.includes('iru-complete-one-form'));
    assert.ok(!purchasable.includes('iru-complete-bundle'));
    assert.ok(!purchasable.includes('iru-second-form-addon'));
    assert.ok(!purchasable.includes('iru-bundle-589-765'));
    assert.ok(!purchasable.includes('iru-bundle-130-485-864'));
    assert.ok(!purchasable.includes('iru-bundle-130-485-864-765-131'));
    // No catalog entry is purchasable right now: the B2C SKUs are
    // retired and the multi-form bundles are unreleased. (New live
    // offerings — readiness, formprep — are priced in
    // checkout-pricing.js, not in this catalog.)
    assert.deepEqual(purchasable, []);
  });
});
