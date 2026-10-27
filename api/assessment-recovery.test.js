// Unit tests for session-scoped assessment recovery
// (src/assessmentRecovery.ts). Synthetic fixtures only; no real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saveRecovery,
  loadRecovery,
  clearRecovery,
  loadPickerMarker,
  readRawSnapshot,
  sanitizeAnswers,
  createSnapshot,
  sessionStore,
  RECOVERY_KEY,
  RECOVERY_TTL_MS,
  ELIGIBLE_ANSWER_KEYS,
} from '../src/assessmentRecovery.ts';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function throwingStorage() {
  return {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
}

const BASE = {
  stage: 'PHASE1',
  language: 'HT',
  answers: { gender: 'female', case_type: 'asylum', has_passport: 'yes', zip_code: '11201' },
  docType: 'has_passport',
  pickerOpened: false,
};

test('save/restore round trip preserves eligible state', () => {
  const store = fakeStorage();
  assert.equal(saveRecovery(store, BASE, {}, 1000), true);
  const loaded = loadRecovery(store, {}, 2000);
  assert.ok(loaded);
  assert.equal(loaded.stage, 'PHASE1');
  assert.equal(loaded.language, 'HT');
  assert.deepEqual(loaded.answers, BASE.answers);
  assert.equal(loaded.docType, 'has_passport');
  assert.equal(loaded.pickerOpened, false);
  assert.equal(loaded.savedAt, 1000);
  assert.equal(loaded.expiresAt, 1000 + RECOVERY_TTL_MS);
});

test('restoring eligible answers, language, stage, and document type', () => {
  const store = fakeStorage();
  saveRecovery(store, {
    stage: 'PHOTO', language: 'ES',
    answers: { marital_status: 'single', has_i94: 'no', residence_postal_code: 'SW1A 1AA' },
    docType: 'has_lease', pickerOpened: true,
  });
  const loaded = loadRecovery(store);
  assert.ok(loaded);
  assert.equal(loaded.stage, 'PHOTO');
  assert.equal(loaded.language, 'ES');
  assert.deepEqual(loaded.answers, { marital_status: 'single', has_i94: 'no', residence_postal_code: 'SW1A 1AA' });
  assert.equal(loaded.docType, 'has_lease');
  assert.equal(loaded.pickerOpened, true);
});

test('reload simulation: a fresh load from the same store restores', () => {
  const store = fakeStorage();
  saveRecovery(store, BASE);
  // Drop every in-memory reference (simulating a page reload) and load again.
  const loaded = loadRecovery(store);
  assert.ok(loaded);
  assert.equal(loaded.stage, BASE.stage);
  assert.deepEqual(loaded.answers, BASE.answers);
});

test('expired data is cleared and yields a clean null', () => {
  const store = fakeStorage();
  saveRecovery(store, BASE, {}, 1000);
  assert.equal(loadRecovery(store, {}, 1000 + RECOVERY_TTL_MS + 1), null);
  assert.equal(store._map.has(RECOVERY_KEY), false);
});

test('malformed JSON is cleared and yields null', () => {
  const store = fakeStorage({ [RECOVERY_KEY]: 'not-json{{' });
  assert.equal(loadRecovery(store), null);
  assert.equal(store._map.has(RECOVERY_KEY), false);
});

test('wrong version is cleared and yields null', () => {
  const store = fakeStorage();
  saveRecovery(store, BASE);
  const raw = JSON.parse(store._map.get(RECOVERY_KEY));
  raw.version = 99;
  store._map.set(RECOVERY_KEY, JSON.stringify(raw));
  assert.equal(loadRecovery(store), null);
  assert.equal(store._map.has(RECOVERY_KEY), false);
});

test('unknown or non-restorable stages are refused', () => {
  const store = fakeStorage();
  assert.equal(saveRecovery(store, { ...BASE, stage: 'BOGUS' }), false);
  assert.equal(saveRecovery(store, { ...BASE, stage: 'PACKET' }), false);
  assert.equal(saveRecovery(store, { ...BASE, stage: 'ANALYZING' }), false);
  assert.equal(saveRecovery(store, { ...BASE, stage: 'LANG' }), false);
  assert.equal(store._map.has(RECOVERY_KEY), false);
  // Hand-crafted raw snapshot with a bad stage is also rejected + cleared.
  const raw = { version: 1, savedAt: 1, expiresAt: 9999999999999, language: 'EN', stage: 'PACKET', answers: {}, docType: '', pickerOpened: false };
  store._map.set(RECOVERY_KEY, JSON.stringify(raw));
  assert.equal(loadRecovery(store), null);
  assert.equal(store._map.has(RECOVERY_KEY), false);
});

test('invalid language is refused', () => {
  const store = fakeStorage();
  assert.equal(saveRecovery(store, { ...BASE, language: 'XX' }), false);
  const raw = { version: 1, savedAt: 1, expiresAt: 9999999999999, language: 'XX', stage: 'PHASE1', answers: {}, docType: '', pickerOpened: false };
  store._map.set(RECOVERY_KEY, JSON.stringify(raw));
  assert.equal(loadRecovery(store), null);
});

test('non-object answers reject the snapshot; bad values are stripped', () => {
  const store = fakeStorage();
  const raw = { version: 1, savedAt: 1, expiresAt: 9999999999999, language: 'EN', stage: 'PHASE1', answers: 'nope', docType: '', pickerOpened: false };
  store._map.set(RECOVERY_KEY, JSON.stringify(raw));
  assert.equal(loadRecovery(store), null);
  // Forbidden keys and wrong-typed values are stripped, the rest restores.
  const store2 = fakeStorage();
  saveRecovery(store2, BASE);
  const raw2 = JSON.parse(store2._map.get(RECOVERY_KEY));
  raw2.answers.full_name = 'Test Person';
  raw2.answers.case_type = 42;
  store2._map.set(RECOVERY_KEY, JSON.stringify(raw2));
  const loaded = loadRecovery(store2);
  assert.ok(loaded);
  assert.equal(loaded.answers.full_name, undefined);
  assert.equal(loaded.answers.case_type, undefined);
  assert.equal(loaded.answers.gender, 'female');
});

test('ZIP values are validated; street addresses never survive', () => {
  assert.deepEqual(
    sanitizeAnswers({ zip_code: '11201', residence_postal_code: 'SW1A 1AA', residence_street: '123 Main St' }),
    { zip_code: '11201', residence_postal_code: 'SW1A 1AA' },
  );
  assert.deepEqual(sanitizeAnswers({ zip_code: '!!!' }), {});
  assert.deepEqual(sanitizeAnswers({ zip_code: '1'.repeat(21) }), {});
});

test('unavailable or throwing storage never breaks boot', () => {
  assert.equal(saveRecovery(null, BASE), false);
  assert.equal(loadRecovery(null), null);
  assert.equal(clearRecovery(null), false);
  assert.equal(saveRecovery(throwingStorage(), BASE), false);
  assert.equal(loadRecovery(throwingStorage()), null);
  assert.equal(clearRecovery(throwingStorage()), false);
  assert.equal(loadPickerMarker(throwingStorage()), false);
  assert.equal(sessionStore(), null, 'node has no sessionStorage');
});

test('serialized payload contains no file data, names, IDs, or payment keys', () => {
  const store = fakeStorage();
  saveRecovery(store, {
    stage: 'PHOTO', language: 'EN',
    answers: {
      gender: 'female', case_type: 'asylum',
      full_name: 'Test Person', residence_street: '123 Main St',
      country_of_origin: 'Haiti', entry_date: '2023-03-01',
      citizenship: 'Haitian',
    },
    docType: 'has_passport', pickerOpened: false,
  });
  const raw = store._map.get(RECOVERY_KEY);
  assert.ok(raw);
  for (const forbidden of ['Test Person', '123 Main St', 'Haiti', '2023-03-01', 'Haitian', 'passport.jpg', 'iru_entitlement_token', 'iru_form_tokens', 'full_name', 'residence_street', 'country_of_origin', 'entry_date', 'citizenship']) {
    assert.ok(!raw.includes(forbidden), `payload must not contain ${forbidden}`);
  }
  const parsed = JSON.parse(raw);
  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['answers', 'docType', 'expiresAt', 'language', 'pickerOpened', 'savedAt', 'stage', 'version'],
  );
  for (const key of Object.keys(parsed.answers)) {
    assert.ok(ELIGIBLE_ANSWER_KEYS.includes(key), `answer key ${key} must be whitelisted`);
  }
});

test('clear removes ONLY the recovery key', () => {
  const store = fakeStorage({
    [RECOVERY_KEY]: '{}',
    iru_form_tokens: '{"f":"t"}',
    iru_entitlement_token: 'tok',
    iru_entitlement_id: 'id',
    iru_lang: 'HT',
  });
  assert.equal(clearRecovery(store), true);
  assert.equal(store._map.has(RECOVERY_KEY), false);
  assert.equal(store._map.get('iru_form_tokens'), '{"f":"t"}');
  assert.equal(store._map.get('iru_entitlement_token'), 'tok');
  assert.equal(store._map.get('iru_entitlement_id'), 'id');
  assert.equal(store._map.get('iru_lang'), 'HT');
});

test('picker marker round trip and preservation read', () => {
  const store = fakeStorage();
  saveRecovery(store, { ...BASE, pickerOpened: true });
  assert.equal(loadPickerMarker(store), true);
  const loaded = loadRecovery(store);
  assert.equal(loaded.pickerOpened, true);
  saveRecovery(store, { ...BASE, pickerOpened: false });
  assert.equal(loadPickerMarker(store), false);
});

test('sliding expiry: each save refreshes the deadline', () => {
  const store = fakeStorage();
  saveRecovery(store, BASE, {}, 1000);
  const first = readRawSnapshot(store).expiresAt;
  saveRecovery(store, BASE, {}, 1000 + 3600_000);
  const second = readRawSnapshot(store).expiresAt;
  assert.ok(second > first);
  assert.equal(second, 1000 + 3600_000 + RECOVERY_TTL_MS);
});

test('invalid document type degrades to empty, valid types keep', () => {
  assert.equal(createSnapshot({ ...BASE, docType: 'nope' }).docType, '');
  assert.equal(createSnapshot({ ...BASE, docType: 'has_i94' }).docType, 'has_i94');
  assert.equal(createSnapshot({ ...BASE, docType: '' }).docType, '');
});

test('prior-arrests answer restores (2026-10-27 fix #3 persistence)', () => {
  const store = fakeStorage();
  assert.equal(saveRecovery(store, { ...BASE, stage: 'PHASE3', answers: { ...BASE.answers, has_prior_arrests: 'no' } }, {}, 1000), true);
  const loaded = loadRecovery(store, {}, 2000);
  assert.ok(loaded);
  assert.equal(loaded.answers.has_prior_arrests, 'no');
});
