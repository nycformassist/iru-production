/**
 * api/_lib/pathway.test.js — Pathway Assistant unit tests.
 *
 * Run: node --test api/_lib/pathway.test.js
 * (Uses node:test; no framework needed.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRecommendations,
  isFormReleased,
  PATHWAY_GRAPH,
  FORM_INFO,
} from './pathway.js';
import { FORMS, getActiveCatalog } from './catalog.js';

// ─── Graph shape ───

test('PATHWAY_GRAPH covers all six built forms, I-360 maps to empty', () => {
  for (const form of ['I-589', 'I-765', 'N-400', 'I-130', 'I-485', 'I-90']) {
    assert.ok(Array.isArray(PATHWAY_GRAPH[form]), `${form} must have a graph entry`);
  }
  assert.deepEqual(PATHWAY_GRAPH['I-360'], [], 'I-360 must map to empty (not built)');
  assert.deepEqual(PATHWAY_GRAPH['N-400'], [], 'N-400 is terminal');
  assert.deepEqual(PATHWAY_GRAPH['I-90'], [], 'I-90 is standalone');
});

test('PATHWAY_GRAPH never points at I-360', () => {
  for (const [from, targets] of Object.entries(PATHWAY_GRAPH)) {
    for (const t of targets) {
      assert.notEqual(t.form, 'I-360', `${from} must not recommend I-360`);
    }
  }
});

// ─── getRecommendations ───

test('I-765 recommends I-589 when released', () => {
  const recs = getRecommendations({
    currentForm: 'I-765',
    ownedForms: [],
    activeCatalog: { 'I-589': { released: true }, 'I-765': { released: true } },
    context: 'dtc',
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].form, 'I-589');
  assert.equal(recs[0].reason_key, 'asylum_ead');
});

test('I-589 recommends I-765 when released', () => {
  const recs = getRecommendations({
    currentForm: 'I-589',
    ownedForms: [],
    activeCatalog: { 'I-589': { released: true }, 'I-765': { released: true } },
    context: 'dtc',
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].form, 'I-765');
});

test('I-130 recommends I-485 when released', () => {
  const recs = getRecommendations({
    currentForm: 'I-130',
    ownedForms: [],
    activeCatalog: { 'I-130': { released: true }, 'I-485': { released: true } },
    context: 'bronxworks',
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].form, 'I-485');
});

test('I-485 recommends I-765 and I-130 when both released', () => {
  const recs = getRecommendations({
    currentForm: 'I-485',
    ownedForms: [],
    activeCatalog: {
      'I-485': { released: true },
      'I-765': { released: true },
      'I-130': { released: true },
    },
    context: 'dtc',
  });
  assert.equal(recs.length, 2);
  assert.deepEqual(recs.map((r) => r.form), ['I-765', 'I-130']);
});

test('N-400 recommends nothing (terminal)', () => {
  const recs = getRecommendations({
    currentForm: 'N-400',
    ownedForms: [],
    activeCatalog: { 'N-400': { released: true } },
    context: 'dtc',
  });
  assert.deepEqual(recs, []);
});

test('I-90 recommends nothing (standalone)', () => {
  const recs = getRecommendations({
    currentForm: 'I-90',
    ownedForms: [],
    activeCatalog: { 'I-90': { released: true } },
    context: 'dtc',
  });
  assert.deepEqual(recs, []);
});

test('I-360 never recommends anything (not built)', () => {
  const recs = getRecommendations({
    currentForm: 'I-360',
    ownedForms: [],
    activeCatalog: { 'I-360': { released: true }, 'I-765': { released: true } },
    context: 'dtc',
  });
  assert.deepEqual(recs, []);
});

test('unreleased forms are never recommended', () => {
  const recs = getRecommendations({
    currentForm: 'I-765',
    ownedForms: [],
    activeCatalog: { 'I-589': { released: false }, 'I-765': { released: true } },
    context: 'dtc',
  });
  assert.deepEqual(recs, []);
});

test('owned forms are never recommended', () => {
  const recs = getRecommendations({
    currentForm: 'I-765',
    ownedForms: ['I-589'],
    activeCatalog: { 'I-589': { released: true }, 'I-765': { released: true } },
    context: 'dtc',
  });
  assert.deepEqual(recs, []);
});

test('unknown current form returns empty', () => {
  const recs = getRecommendations({
    currentForm: 'I-999',
    ownedForms: [],
    activeCatalog: { 'I-765': { released: true } },
    context: 'dtc',
  });
  assert.deepEqual(recs, []);
});

test('missing activeCatalog returns empty', () => {
  const recs = getRecommendations({
    currentForm: 'I-765',
    ownedForms: [],
    activeCatalog: null,
    context: 'dtc',
  });
  assert.deepEqual(recs, []);
});

test('works with array-shaped activeCatalog', () => {
  const recs = getRecommendations({
    currentForm: 'I-765',
    ownedForms: [],
    activeCatalog: ['I-589', 'I-765'],
    context: 'dtc',
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].form, 'I-589');
});

test('works with real catalog FORMS (all six built forms released, I-360 not)', () => {
  const recs765 = getRecommendations({
    currentForm: 'I-765',
    ownedForms: [],
    activeCatalog: FORMS,
    context: 'dtc',
  });
  assert.equal(recs765.length, 1, 'I-765 should recommend I-589 (released)');

  const recs130 = getRecommendations({
    currentForm: 'I-130',
    ownedForms: [],
    activeCatalog: FORMS,
    context: 'dtc',
  });
  assert.equal(recs130.length, 1, 'I-130 should recommend I-485 (built and released; price level unassigned, shown as "Pricing to be confirmed")');
  assert.equal(recs130[0].form, 'I-485');
});

test('getActiveCatalog only includes released forms', () => {
  const active = getActiveCatalog();
  assert.ok(active['I-589'], 'I-589 released');
  assert.ok(active['I-765'], 'I-765 released');
  assert.ok(active['N-400'], 'N-400 released (built; price level unassigned)');
  assert.ok(active['I-130'], 'I-130 released (built; price level unassigned)');
  assert.ok(active['I-485'], 'I-485 released (built; price level unassigned)');
  assert.ok(active['I-90'], 'I-90 released (built; price level unassigned)');
  assert.ok(!active['I-360'], 'I-360 never released');
});

// ─── isFormReleased ───

test('isFormReleased: I-360 always false', () => {
  assert.equal(isFormReleased('I-360', { 'I-360': { released: true } }), false);
  assert.equal(isFormReleased('I-360', ['I-360']), false);
});

test('isFormReleased handles all three catalog shapes', () => {
  assert.equal(isFormReleased('I-765', ['I-765']), true);
  assert.equal(isFormReleased('I-765', ['I-589']), false);
  assert.equal(isFormReleased('I-765', { 'I-765': { released: true } }), true);
  assert.equal(isFormReleased('I-765', { 'I-765': { released: false } }), false);
  assert.equal(
    isFormReleased('I-765', { sku1: { forms: ['I-765'], released: true } }),
    true
  );
  assert.equal(
    isFormReleased('I-765', { sku1: { forms: ['I-765'], released: false } }),
    false
  );
});

// ─── FORM_INFO ───

test('FORM_INFO covers all seven workflows', () => {
  for (const form of ['I-589', 'I-765', 'N-400', 'I-130', 'I-485', 'I-90', 'I-360']) {
    assert.ok(FORM_INFO[form], `${form} must have FORM_INFO`);
    assert.ok(FORM_INFO[form].name, `${form} must have a name`);
    assert.ok(FORM_INFO[form].process, `${form} must have a process`);
  }
});
