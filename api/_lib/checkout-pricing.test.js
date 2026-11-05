/**
 * api/_lib/checkout-pricing.test.js — Pathway checkout pricing unit tests.
 *
 * Run: node --test api/_lib/checkout-pricing.test.js
 * (Uses node:test; no framework needed.)
 *
 * Pricing (owner-approved 2026-11-05, FINAL):
 *   level 1 = $149 (14900c) · level 2 = $199 (19900c) · level 3 = $249 (24900c)
 *   additional form = regular − $50 (5000c)
 *   I-589 + I-765 bundle = $34900 total for the pair (overrides $348)
 *   Readiness never discounts prep and never counts as owned.
 *   I-360 is never priced.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_PRICE_CENTS,
  ADDITIONAL_FORM_DISCOUNT_CENTS,
  BUNDLE_589_765_CENTS,
  FORMPREP_SKU,
  regularPriceCents,
  pricePurchase,
} from './checkout-pricing.js';

// ─── Constants ───

test('pricing constants are the owner-approved values', () => {
  assert.deepEqual(LEVEL_PRICE_CENTS, { 1: 14900, 2: 19900, 3: 24900 });
  assert.equal(ADDITIONAL_FORM_DISCOUNT_CENTS, 5000);
  assert.equal(BUNDLE_589_765_CENTS, 34900);
  assert.equal(FORMPREP_SKU, 'iru-formprep');
});

// ─── regularPriceCents ───

test('regularPriceCents: level prices from the catalog', () => {
  assert.equal(regularPriceCents('I-765'), 14900);
  assert.equal(regularPriceCents('I-90'), 14900);
  assert.equal(regularPriceCents('I-130'), 19900);
  assert.equal(regularPriceCents('I-589'), 24900);
  assert.equal(regularPriceCents('N-400'), 24900);
  assert.equal(regularPriceCents('I-485'), 24900);
});

test('regularPriceCents: I-360 is never priced', () => {
  assert.equal(regularPriceCents('I-360'), null);
});

test('regularPriceCents: unknown form is never priced', () => {
  assert.equal(regularPriceCents('I-999'), null);
  assert.equal(regularPriceCents('I-864'), null); // in FORM_IDS but not in FORMS
  assert.equal(regularPriceCents(null), null);
  assert.equal(regularPriceCents(undefined), null);
});

// ─── Bundle pair, both new ───

test('I-765 + I-589 together → total 34900, bundle applied', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-765', addedForm: 'I-589' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 34900);
  assert.equal(r.bundleApplied, true);
  assert.equal(r.bundleSavingCents, 4900);
  assert.equal(r.currency, 'usd');
  assert.deepEqual(r.forms, ['I-765', 'I-589']);
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines[0], {
    form: 'I-765', regularCents: 14900, discountCents: 0, finalCents: 14900, kind: 'bundle',
  });
  assert.deepEqual(r.lines[1], {
    form: 'I-589', regularCents: 24900, discountCents: 4900, finalCents: 20000, kind: 'bundle',
  });
});

test('same pair reversed (selected I-589, added I-765) → total 34900, bundle applied', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-589', addedForm: 'I-765' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 34900);
  assert.equal(r.bundleApplied, true);
  assert.equal(r.bundleSavingCents, 4900);
  assert.deepEqual(r.forms, ['I-589', 'I-765']);
  assert.deepEqual(r.lines[0], {
    form: 'I-589', regularCents: 24900, discountCents: 4900, finalCents: 20000, kind: 'bundle',
  });
  assert.deepEqual(r.lines[1], {
    form: 'I-765', regularCents: 14900, discountCents: 0, finalCents: 14900, kind: 'bundle',
  });
});

// ─── Single form, nothing owned ───

test('I-765 alone (no added form) → total 14900, no bundle', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-765' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 14900);
  assert.equal(r.bundleApplied, false);
  assert.equal(r.bundleSavingCents, 0);
  assert.deepEqual(r.forms, ['I-765']);
  assert.deepEqual(r.lines, [
    { form: 'I-765', regularCents: 14900, discountCents: 0, finalCents: 14900, kind: 'first' },
  ]);
});

// ─── Bundle with one pair form owned ───

test('I-765 owned, add I-589 → total 20000, bundle applied', () => {
  const r = pricePurchase({ ownedForms: ['I-765'], selectedForm: 'I-589' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 20000);
  assert.equal(r.bundleApplied, true);
  assert.equal(r.bundleSavingCents, 4900);
  assert.deepEqual(r.forms, ['I-589']);
  assert.deepEqual(r.lines, [
    { form: 'I-589', regularCents: 24900, discountCents: 4900, finalCents: 20000, kind: 'bundle' },
  ]);
});

test('I-589 owned, add I-765 → total 10000, bundle applied', () => {
  const r = pricePurchase({ ownedForms: ['I-589'], selectedForm: 'I-765' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 10000);
  assert.equal(r.bundleApplied, true);
  assert.equal(r.bundleSavingCents, 4900);
  assert.deepEqual(r.forms, ['I-765']);
  assert.deepEqual(r.lines, [
    { form: 'I-765', regularCents: 14900, discountCents: 4900, finalCents: 10000, kind: 'bundle' },
  ]);
});

// ─── Additional-form discount ───

test('I-765 owned, then add I-130 → second purchase total 14900 (19900 − 5000)', () => {
  const r = pricePurchase({ ownedForms: ['I-765'], selectedForm: 'I-130' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 14900);
  assert.equal(r.bundleApplied, false);
  assert.equal(r.bundleSavingCents, 0);
  assert.deepEqual(r.forms, ['I-130']);
  assert.deepEqual(r.lines, [
    { form: 'I-130', regularCents: 19900, discountCents: 5000, finalCents: 14900, kind: 'additional' },
  ]);
});

test('I-130 + I-485 together, nothing owned → total 39800 (19900 + 19900), no bundle', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-130', addedForm: 'I-485' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 39800);
  assert.equal(r.bundleApplied, false);
  assert.equal(r.bundleSavingCents, 0);
  assert.deepEqual(r.forms, ['I-130', 'I-485']);
  assert.deepEqual(r.lines, [
    { form: 'I-130', regularCents: 19900, discountCents: 0, finalCents: 19900, kind: 'first' },
    { form: 'I-485', regularCents: 24900, discountCents: 5000, finalCents: 19900, kind: 'additional' },
  ]);
});

test('I-130 owned, add I-485 → total 19900 (24900 − 5000)', () => {
  const r = pricePurchase({ ownedForms: ['I-130'], selectedForm: 'I-485' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 19900);
  assert.equal(r.bundleApplied, false);
  assert.deepEqual(r.lines, [
    { form: 'I-485', regularCents: 24900, discountCents: 5000, finalCents: 19900, kind: 'additional' },
  ]);
});

test('single additional-form case: owned I-130, selected I-485 → total 19900', () => {
  const r = pricePurchase({ ownedForms: ['I-130'], selectedForm: 'I-485' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 19900);
  assert.equal(r.bundleApplied, false);
  assert.deepEqual(r.forms, ['I-485']);
  assert.deepEqual(r.lines, [
    { form: 'I-485', regularCents: 24900, discountCents: 5000, finalCents: 19900, kind: 'additional' },
  ]);
});

// ─── Readiness never counts as owned ───

test('readiness I-765 + selected I-130 → total 19900 full price (no discount)', () => {
  const r = pricePurchase({
    ownedForms: [],
    readinessForms: ['I-765'],
    selectedForm: 'I-130',
  });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 19900);
  assert.equal(r.bundleApplied, false);
  assert.deepEqual(r.lines, [
    { form: 'I-130', regularCents: 19900, discountCents: 0, finalCents: 19900, kind: 'first' },
  ]);
});

test('readiness I-765 + selected I-765 → total 14900 full price (readiness is not ownership)', () => {
  const r = pricePurchase({
    ownedForms: [],
    readinessForms: ['I-765'],
    selectedForm: 'I-765',
  });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 14900);
  assert.equal(r.bundleApplied, false);
  assert.deepEqual(r.lines, [
    { form: 'I-765', regularCents: 14900, discountCents: 0, finalCents: 14900, kind: 'first' },
  ]);
});

test('readiness never triggers the bundle: readiness I-589 + selected I-765 → 14900, no bundle', () => {
  const r = pricePurchase({
    ownedForms: [],
    readinessForms: ['I-589'],
    selectedForm: 'I-765',
  });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 14900);
  assert.equal(r.bundleApplied, false);
  assert.equal(r.bundleSavingCents, 0);
});

// ─── Owned forms are never re-charged ───

test('owned I-765, selected I-765, added I-589 → only I-589 line, total 20000', () => {
  const r = pricePurchase({
    ownedForms: ['I-765'],
    selectedForm: 'I-765',
    addedForm: 'I-589',
  });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 20000);
  assert.equal(r.bundleApplied, true);
  assert.equal(r.bundleSavingCents, 4900);
  assert.deepEqual(r.forms, ['I-589']);
  assert.deepEqual(r.lines, [
    { form: 'I-589', regularCents: 24900, discountCents: 4900, finalCents: 20000, kind: 'bundle' },
  ]);
});

test('owned I-765 + I-589, selected I-765 → ok false, reason already-owned', () => {
  const r = pricePurchase({
    ownedForms: ['I-765', 'I-589'],
    selectedForm: 'I-765',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'already-owned');
  assert.ok(typeof r.error === 'string' && r.error.length > 0);
  assert.deepEqual(r.lines, []);
  assert.equal(r.totalCents, 0);
  assert.deepEqual(r.forms, []);
});

// ─── I-360 / unknown / unreleased are never priced ───

test('I-360 never priced: selected I-360 → ok false', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-360' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'form-not-available');
  assert.ok(typeof r.error === 'string' && r.error.length > 0);
  assert.deepEqual(r.lines, []);
  assert.equal(r.totalCents, 0);
  assert.equal(r.bundleApplied, false);
  assert.deepEqual(r.forms, []);
});

test('I-360 never priced: added I-360 → ok false, nothing priced', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-765', addedForm: 'I-360' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'form-not-available');
  assert.deepEqual(r.lines, []);
  assert.equal(r.totalCents, 0);
  assert.deepEqual(r.forms, []);
});

test('unknown form → ok false, reason form-not-available', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-999' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'form-not-available');
  assert.deepEqual(r.lines, []);
  assert.equal(r.totalCents, 0);
});

test('unknown added form → ok false, nothing priced', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-765', addedForm: 'I-864' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'form-not-available');
  assert.deepEqual(r.lines, []);
  assert.equal(r.totalCents, 0);
});

test('missing selected form → ok false, reason form-not-available', () => {
  const r = pricePurchase({ ownedForms: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'form-not-available');
  assert.deepEqual(r.lines, []);
  assert.equal(r.totalCents, 0);
});

// ─── Three-form case ───

test('three-form case: owned I-589, selected I-765, added I-130 → 10000 + 14900 = 24900, bundle applied', () => {
  const r = pricePurchase({
    ownedForms: ['I-589'],
    selectedForm: 'I-765',
    addedForm: 'I-130',
  });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 24900);
  assert.equal(r.bundleApplied, true);
  assert.equal(r.bundleSavingCents, 4900);
  assert.deepEqual(r.forms, ['I-765', 'I-130']);
  assert.deepEqual(r.lines, [
    { form: 'I-765', regularCents: 14900, discountCents: 4900, finalCents: 10000, kind: 'bundle' },
    { form: 'I-130', regularCents: 19900, discountCents: 5000, finalCents: 14900, kind: 'additional' },
  ]);
});

// ─── Edge cases (interpretation locked in by these tests) ───

test('duplicate selected == added is charged once', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-765', addedForm: 'I-765' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 14900);
  assert.deepEqual(r.forms, ['I-765']);
  assert.equal(r.lines.length, 1);
});

test('both pair forms already owned + new non-pair form → no bundle in this purchase, additional pricing', () => {
  const r = pricePurchase({
    ownedForms: ['I-589', 'I-765'],
    selectedForm: 'I-130',
  });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 14900);
  assert.equal(r.bundleApplied, false);
  assert.equal(r.bundleSavingCents, 0);
  assert.deepEqual(r.lines, [
    { form: 'I-130', regularCents: 19900, discountCents: 5000, finalCents: 14900, kind: 'additional' },
  ]);
});

test('unknown codes in ownedForms are ignored (do not trigger the discount)', () => {
  const r = pricePurchase({
    ownedForms: ['I-999'],
    selectedForm: 'I-130',
  });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 19900);
  assert.deepEqual(r.lines, [
    { form: 'I-130', regularCents: 19900, discountCents: 0, finalCents: 19900, kind: 'first' },
  ]);
});

test('non-pair two-form purchase with nothing owned: first full, second additional', () => {
  const r = pricePurchase({ ownedForms: [], selectedForm: 'I-765', addedForm: 'I-130' });
  assert.equal(r.ok, true);
  assert.equal(r.totalCents, 29800);
  assert.equal(r.bundleApplied, false);
  assert.deepEqual(r.lines, [
    { form: 'I-765', regularCents: 14900, discountCents: 0, finalCents: 14900, kind: 'first' },
    { form: 'I-130', regularCents: 19900, discountCents: 5000, finalCents: 14900, kind: 'additional' },
  ]);
});
