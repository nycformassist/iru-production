/**
 * Language completion (G12–G14) + language persistence (G15/WS2) tests.
 *
 * Covers: KB_I18N parity and localized gap records, resource/country
 * i18n parity, packet wiring, localStorage language persistence
 * (source guards + extracted-function simulation), and ONE combined
 * checkout-return case asserting persisted-language restoration AND
 * server-derived purchase state together. Synthetic data only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { EVIDENCE_KB, EVIDENCE_KEYS, KB_I18N, localizedKb, localizedAlternative, buildGapRecords } from './_lib/evidence.js';
import { fallbackAssessment } from './_lib/prompt.js';
import { createEntitlementStore } from './_lib/entitlement.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANGS = ['ES', 'ZH', 'HT', 'AR'];
const appSrc = readFileSync(join(HERE, '..', 'src', 'App.tsx'), 'utf8');

async function loadTsModule(rel) {
  const source = readFileSync(join(HERE, '..', rel), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

// ---------------------------------------------------------------------------
// WS1.1 — Evidence KB localization (G12)
// ---------------------------------------------------------------------------
describe('KB_I18N parity', () => {
  it('every evidence key and alternative is fully translated in ES/ZH/HT/AR', () => {
    for (const lang of LANGS) {
      assert.ok(KB_I18N[lang], `${lang} KB table exists`);
      for (const key of EVIDENCE_KEYS) {
        const tr = KB_I18N[lang][key];
        assert.ok(tr, `${lang} missing KB key ${key}`);
        assert.ok(tr.targetFact && tr.targetFact.length >= 8, `${lang}/${key} targetFact`);
        assert.ok(tr.primaryEvidence && tr.primaryEvidence.length >= 8, `${lang}/${key} primaryEvidence`);
        for (const alt of EVIDENCE_KB[key].alternatives) {
          const t = (tr.alternatives || {})[alt.id];
          assert.ok(t, `${lang}/${key} missing alternative ${alt.id}`);
          for (const f of ['label', 'supports', 'limitations', 'acquisition', 'safety', 'reviewNeeded']) {
            // Some fields are legitimately terse in ZH (病历 = "medical
            // records"; 风险低。 = "Low risk."). Sentence fields stay >= 10.
            const minLen = f === 'label' ? 2 : f === 'safety' ? 3 : 10;
            assert.ok(typeof t[f] === 'string' && t[f].length >= minLen, `${lang}/${key}/${alt.id} missing ${f}`);
          }
        }
      }
    }
  });

  it('localizedKb EN output is byte-identical to the original KB', () => {
    for (const key of EVIDENCE_KEYS) {
      const loc = localizedKb(key, 'EN');
      assert.equal(loc.targetFact, EVIDENCE_KB[key].targetFact);
      assert.equal(loc.primaryEvidence, EVIDENCE_KB[key].primaryEvidence);
      assert.deepEqual(loc.alternatives, EVIDENCE_KB[key].alternatives.map((a) => ({ ...a })));
    }
    // Omitted lang behaves exactly like EN.
    assert.deepEqual(localizedKb('has_passport'), localizedKb('has_passport', 'EN'));
  });

  it('localizedKb never translates the availability ENUM values', () => {
    for (const lang of LANGS) {
      for (const key of EVIDENCE_KEYS) {
        const loc = localizedKb(key, lang);
        loc.alternatives.forEach((a, i) => {
          assert.equal(a.availability, EVIDENCE_KB[key].alternatives[i].availability, `${lang}/${key} availability enum changed`);
        });
      }
    }
  });

  it('localizedAlternative returns EN originals for EN and localized text otherwise', () => {
    const alt = EVIDENCE_KB.has_passport.alternatives[1]; // birth certificate
    assert.equal(localizedAlternative('has_passport', alt, 'EN').limitations, alt.limitations);
    const es = localizedAlternative('has_passport', alt, 'ES');
    assert.notEqual(es.limitations, alt.limitations);
    assert.equal(es.availability, alt.availability);
  });
});

describe('buildGapRecords localized output', () => {
  const onlyPassport = { evidence: Object.fromEntries(EVIDENCE_KEYS.map((k) => [k, k === 'has_passport' ? 'no' : 'yes'])) };
  const onlyI94 = { evidence: Object.fromEntries(EVIDENCE_KEYS.map((k) => [k, k === 'has_i94' ? 'no' : 'yes'])) };

  it('EN default output is unchanged (byte-identical KB text)', () => {
    const [g] = buildGapRecords(onlyPassport);
    assert.equal(g.targetFact, EVIDENCE_KB.has_passport.targetFact);
    assert.equal(g.currentState, 'Applicant reported they do not have this document.');
    const bc = g.evidentiaryConnection.find((c) => c.id === 'proxy_passport_2');
    assert.equal(bc.limitations, EVIDENCE_KB.has_passport.alternatives[1].limitations);
  });

  for (const lang of LANGS) {
    it(`${lang}: gap record carries localized KB text incl. the passport distinction`, () => {
      const [g] = buildGapRecords(onlyPassport, [], lang);
      assert.equal(g.targetFact, KB_I18N[lang].has_passport.targetFact);
      assert.notEqual(g.currentState, 'Applicant reported they do not have this document.');
      const bc = g.evidentiaryConnection.find((c) => c.id === 'proxy_passport_2');
      assert.equal(bc.limitations, KB_I18N[lang].has_passport.alternatives.proxy_passport_2.limitations);
      assert.equal(bc.supports, KB_I18N[lang].has_passport.alternatives.proxy_passport_2.supports);
      assert.ok(bc.limitations.length > 10, 'limitations text present');
      assert.ok(!g.acquisitionSteps.includes(EVIDENCE_KB.has_passport.alternatives[0].acquisition), 'acquisition localized');
      assert.ok(g.nextAction.step !== 'Work through the listed alternatives in order; gather what is obtainable and note what is not.', 'next action localized');
    });
  }

  it('ES/HT: dated-photo limitation still denies entry date/manner (mandatory distinction)', () => {
    for (const lang of ['ES', 'ZH', 'HT', 'AR']) {
      const [g] = buildGapRecords(onlyI94, [], lang);
      const photo = g.evidentiaryConnection.find((c) => c.id === 'proxy_i94_2');
      assert.notEqual(photo.limitations, EVIDENCE_KB.has_i94.alternatives[1].limitations, `${lang} localized`);
      assert.ok(!photo.limitations.includes('Do NOT establish the exact entry date'), `${lang} EN text absent`);
    }
    const [es] = buildGapRecords(onlyI94, [], 'ES');
    assert.ok(es.evidentiaryConnection.find((c) => c.id === 'proxy_i94_2').limitations.includes('fecha exacta de entrada'));
  });

  it('fallbackAssessment flows localized gap records through (deterministic path)', () => {
    const min = { evidence: onlyPassport.evidence, caseType: 'asylum', countryOfOrigin: 'Haiti', entryYear: 2023, entryDateFlag: null };
    const gaps = buildGapRecords(min, [], 'HT');
    const fb = fallbackAssessment(min, gaps, [], 'HT');
    assert.equal(fb.evidenceGaps[0].targetFact, KB_I18N.HT.has_passport.targetFact);
    assert.equal(fb.evidenceGaps[0].alternatives[1].limitation, KB_I18N.HT.has_passport.alternatives.proxy_passport_2.limitations);
    assert.ok(!JSON.stringify(fb.evidenceGaps).includes(EVIDENCE_KB.has_passport.alternatives[1].supports), 'EN supports text absent from HT fallback gaps');
  });

  it('packet-level: ES and HT gap records contain localized KB text and no EN supports text', () => {
    // The packet gap section renders localizedKb(k, lang) directly (source
    // guard below); its content is exactly these records' KB source.
    for (const lang of ['ES', 'HT']) {
      const gaps = buildGapRecords({ evidence: Object.fromEntries(EVIDENCE_KEYS.map((k) => [k, 'no'])) }, [], lang);
      assert.equal(gaps.length, 9);
      const blob = JSON.stringify(gaps);
      for (const key of EVIDENCE_KEYS) {
        assert.ok(blob.includes(KB_I18N[lang][key].targetFact), `${lang}/${key} localized targetFact in packet source`);
        for (const alt of EVIDENCE_KB[key].alternatives) {
          assert.ok(!blob.includes(alt.supports), `${lang}/${key}/${alt.id} EN supports absent`);
        }
      }
    }
    assert.ok(appSrc.includes('localizedKb(k, lang)'), 'packet gap section uses the localized accessor');
    assert.ok(appSrc.includes("lang === 'EN' ? t('pktKbNote'"), 'packet KB note is conditional on language');
    assert.ok(appSrc.includes("t('pktKbNoteLocalized'"), 'localized KB note key used for non-EN');
  });
});

// ---------------------------------------------------------------------------
// WS1.2/1.3 — Resources (G13) and country names (G14)
// ---------------------------------------------------------------------------
describe('resource + country i18n parity', () => {
  it('RESOURCE_I18N covers every org and mirrors EN eligibility presence', async () => {
    const res = await loadTsModule('src/resources.ts');
    const orgs = res.getAllOrgs();
    assert.ok(orgs.length >= 18);
    for (const org of orgs) {
      for (const lang of LANGS) {
        const tr = res.RESOURCE_I18N[org.id]?.[lang];
        assert.ok(tr, `${lang} missing resource ${org.id}`);
        assert.ok(tr.servicesOffered && tr.servicesOffered.length > 5, `${lang}/${org.id} servicesOffered`);
        assert.ok(tr.serviceArea && tr.serviceArea.length > 2, `${lang}/${org.id} serviceArea`);
        // Data integrity: a field absent in EN stays absent in translation.
        assert.equal(!!tr.eligibility, !!org.eligibility, `${lang}/${org.id} eligibility presence mirrors EN`);
        assert.equal(!!tr.transit, !!org.transit, `${lang}/${org.id} transit presence mirrors EN`);
        assert.equal(!!tr.exit, !!org.exit, `${lang}/${org.id} exit presence mirrors EN`);
      }
      // EN fallback is byte-identical.
      assert.equal(res.localizedResourceText(org, 'servicesOffered', 'EN'), org.servicesOffered);
      assert.equal(res.localizedResourceText(org, 'servicesOffered', 'ES'), res.RESOURCE_I18N[org.id].ES.servicesOffered);
    }
    const national = res.resolveResourcesForLocation({ country: 'US', postalCode: '' }).national;
    assert.equal(national.length, 3);
    for (const dir of national) {
      for (const lang of LANGS) assert.ok(res.NATIONAL_I18N[dir.name]?.[lang], `${lang} national description: ${dir.name}`);
      assert.equal(res.localizedNationalDescription(dir, 'EN'), dir.description);
      assert.notEqual(res.localizedNationalDescription(dir, 'HT'), dir.description);
    }
  });

  it('COUNTRY_NAMES_I18N covers every listed country in all 4 languages', async () => {
    const loc = await loadTsModule('src/location.ts');
    assert.ok(loc.COUNTRIES.length >= 55);
    for (const c of loc.COUNTRIES) {
      for (const lang of LANGS) {
        assert.ok(loc.COUNTRY_NAMES_I18N[c.code]?.[lang], `${lang} missing country ${c.code}`);
      }
      assert.equal(loc.localizedCountryName(c, 'EN'), c.name);
    }
    const haiti = loc.COUNTRIES.find((c) => c.code === 'HT');
    assert.equal(loc.localizedCountryName(haiti, 'ES'), 'Haití');
    assert.equal(loc.localizedCountryName(haiti, 'ZH'), '海地');
    assert.equal(loc.localizedCountryName(haiti, 'HT'), 'Ayiti');
    assert.equal(loc.localizedCountryName(haiti, 'AR'), 'هايتي');
  });

  it('App packet + selector consume the localized resource/country/layer text', () => {
    assert.ok(appSrc.includes("localizedResourceText(res, 'servicesOffered', lang)"), 'packet services localized');
    assert.ok(appSrc.includes("localizedResourceText(res, 'eligibility', lang)"), 'packet eligibility localized');
    assert.ok(appSrc.includes("localizedResourceText(res, 'serviceArea', lang)"), 'packet service area localized');
    assert.ok(appSrc.includes("localizedResourceText(res, 'transit', lang)"), 'packet transit localized');
    assert.ok(appSrc.includes('localizedNationalDescription(dir, lang)'), 'packet national descriptions localized');
    assert.ok(appSrc.includes("t('pktLayerStatewide', 'Statewide')"), 'statewide badge from dictionary');
    assert.ok(appSrc.includes("t('pktLayerLocal', 'Local')"), 'local badge from dictionary');
    assert.ok(!appSrc.includes("'Statewide' : (res.borough"), 'hardcoded Statewide label gone');
    assert.ok(appSrc.includes('localizedCountryName(c, lang)'), 'residence selector renders localized country names');
  });
});

// ---------------------------------------------------------------------------
// WS2 — Language persistence
// ---------------------------------------------------------------------------
function extractPersistenceFns(src, localStorageStub) {
  const keyMatch = src.match(/export const LANG_STORAGE_KEY = '([^']+)'/);
  const langsMatch = src.match(/export const SUPPORTED_LANGS = \[([^\]]+)\]/);
  assert.ok(keyMatch && langsMatch, 'persistence constants present in App.tsx');
  const extractFn = (name) => {
    const start = src.indexOf(`export function ${name}`);
    assert.ok(start >= 0, `${name} exists`);
    let depth = 0; let end = -1;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    return src.slice(start, end)
      .replace(`export function ${name}`, `function ${name}`)
      .replace(/: string/g, '').replace(/: void/g, '');
  };
  const factory = new Function('localStorage', 'LANG_STORAGE_KEY', 'SUPPORTED_LANGS',
    `${extractFn('loadPersistedLang')}\n${extractFn('persistLang')}\nreturn { loadPersistedLang, persistLang };`);
  return factory(localStorageStub, keyMatch[1], langsMatch[1].split(',').map((s) => s.trim().replace(/'/g, '')));
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

describe('language persistence (WS2)', () => {
  it('source: initializer, write-on-change, key and validation are wired', () => {
    assert.ok(appSrc.includes("export const LANG_STORAGE_KEY = 'iru_lang'"), 'storage key is iru_lang');
    assert.ok(appSrc.includes("export const SUPPORTED_LANGS = ['EN', 'ES', 'ZH', 'HT', 'AR']"), 'supported list');
    assert.ok(appSrc.includes("useState(() => loadPersistedLang())"), 'lang state initialized from storage');
    assert.ok(appSrc.includes('useEffect(() => { persistLang(lang); }, [lang]);'), 'persisted on every lang change');
    assert.ok(appSrc.includes('SUPPORTED_LANGS.includes(v)'), 'stored value validated against supported list');
    assert.ok(!appSrc.includes("setLang('EN')"), 'nothing ever resets lang to EN');
  });

  it('localStorage holds ONLY the language key and commerce tokens (no applicant data)', () => {
    // D2 (owner 2026-10-30): entitlement tokens persist in localStorage
    // for retained access; the server remains authoritative. These are
    // commerce credentials, never applicant immigration data. The guard
    // still bans any other localStorage usage.
    const allowedKeys = ['LANG_STORAGE_KEY', 'iru_entitlement_token', 'iru_evaluation_token', 'iru_form_tokens', 'iru_entitlement_id'];
    // Key constants defined in the file (indirect usage via helpers is OK
    // if the file defines only allowed key constants).
    const srcDir = join(HERE, '..', 'src');
    for (const f of readdirSync(srcDir)) {
      const text = readFileSync(join(srcDir, f), 'utf8');
      for (const m of text.matchAll(/localStorage\.(getItem|setItem|removeItem)\(([^)]*)\)/g)) {
        const arg = m[2].trim();
        // Direct literal key, key constant, or a helper parameter (the
        // helpers in paywall.tsx take `key` and are called only with
        // the allowed constants defined in that file).
        const isHelperParam = /^key(,|\))/.test(arg) || arg === 'key';
        const ok = isHelperParam || allowedKeys.some((k) => arg.includes(k));
        assert.ok(ok, `${f}: localStorage used with non-allowed key: ${m[0]}`);
      }
      // If a file uses the helper-param pattern, verify it defines only
      // allowed key constants.
      if (/localStorage\.(getItem|setItem|removeItem)\(key\)/.test(text)) {
        const constKeys = [...text.matchAll(/(?:const|let)\s+\w+\s*=\s*['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
        for (const k of constKeys) {
          if (k.startsWith('iru_')) {
            assert.ok(allowedKeys.includes(k), `${f}: defines non-allowed storage key constant: ${k}`);
          }
        }
      }
    }
  });

  it('simulation: valid codes restore, invalid/missing/throwing storage fall back to EN', () => {
    for (const code of ['EN', 'ES', 'ZH', 'HT', 'AR']) {
      assert.equal(extractPersistenceFns(appSrc, fakeStorage({ iru_lang: code })).loadPersistedLang(), code);
    }
    assert.equal(extractPersistenceFns(appSrc, fakeStorage({ iru_lang: 'FR' })).loadPersistedLang(), 'EN');
    assert.equal(extractPersistenceFns(appSrc, fakeStorage({ iru_lang: 'ht' })).loadPersistedLang(), 'EN');
    assert.equal(extractPersistenceFns(appSrc, fakeStorage()).loadPersistedLang(), 'EN');
    const throwing = { getItem() { throw new Error('privacy mode'); }, setItem() { throw new Error('privacy mode'); } };
    const fns = extractPersistenceFns(appSrc, throwing);
    assert.equal(fns.loadPersistedLang(), 'EN');
    assert.doesNotThrow(() => fns.persistLang('ES'));
  });

  it('simulation: persistLang writes ONLY the iru_lang key', () => {
    const store = fakeStorage();
    extractPersistenceFns(appSrc, store).persistLang('ZH');
    assert.deepEqual([...store.map.entries()], [['iru_lang', 'ZH']]);
  });
});

// ---------------------------------------------------------------------------
// WS2 COMBINED — simulated checkout return
// ---------------------------------------------------------------------------
describe('checkout return (combined WS2 case)', () => {
  it('?checkout=success return: persisted language is restored AND purchase state stays server-derived — the success parameter alone grants nothing', () => {
    // -- Pre-checkout browser state (exactly what App.tsx stores) --------
    const local = fakeStorage();
    const { persistLang, loadPersistedLang } = extractPersistenceFns(appSrc, local);
    persistLang('HT'); // applicant chose Haitian Creole before checkout

    // Server side: checkout created a RESERVED (unpaid) evaluation
    // entitlement; the browser holds only its token in localStorage (D2).
    const store = createEntitlementStore();
    const { entitlement, token } = store.create({ sku: 'evaluation', amountCents: 100, scope: { kind: 'evaluation' } });
    store.attachSession(entitlement.id, 'cs_test_synthetic');
    const session = fakeStorage({ iru_evaluation_token: token });

    // -- The return: full page load at /?checkout=success&entitlement=… --
    const ret = new URL(`http://localhost:5173/?checkout=success&entitlement=${entitlement.id}`);
    assert.equal(ret.searchParams.get('checkout'), 'success');

    // (a) Language restored from persistence — NOT reset to English.
    assert.equal(loadPersistedLang(), 'HT');

    // (b1) The client may read the return URL as a TRIGGER (Phase 2), but
    // the success parameter alone grants nothing: every routing decision
    // goes through server-side verification via /api/entitlement-status.
    // The URL never sets purchase state directly.
    assert.ok(appSrc.includes("fetch('/api/entitlement-status'"), 'return handling verifies via the server status endpoint');
    assert.ok(!/setPurchaseState\(\{\s*hasEvaluation:\s*true/.test(appSrc), 'no client-side paid marking');
    assert.ok(appSrc.includes("useState<{ hasEvaluation: boolean; ownedForms: string[] }>({ hasEvaluation: false, ownedForms: [] })"),
      'purchase state initializes unpaid/empty');

    // (b2) The URL carries an entitlement ID, not the bearer token:
    // even looked up as a token it resolves to nothing.
    assert.equal(store.getByToken(ret.searchParams.get('entitlement')), null);

    // (b3) Purchase-state derivation, mirroring refreshPurchaseState's
    // predicate against the REAL server status view (publicView is what
    // /api/entitlement-status returns): the stored token's entitlement
    // is unpaid, so the derived state stays at the entry state.
    const derive = (tokenValue) => {
      const ent = tokenValue ? store.getByToken(tokenValue) : null;
      const view = ent ? store.publicView(ent) : null;
      return {
        hasEvaluation: !!(view && view.paid && view.scope && view.scope.kind === 'evaluation'),
        ownedForms: [],
      };
    };
    assert.deepEqual(derive(session.getItem('iru_evaluation_token')), { hasEvaluation: false, ownedForms: [] });
    assert.ok(appSrc.includes("fetch('/api/entitlement-status'"), 'purchase state is refreshed from the server status endpoint');
    assert.ok(appSrc.includes('ev && ev.paid && ev.scope'), 'client predicate requires the server-reported paid flag');

    // (b4) ONLY the webhook-authoritative marking flips paid state —
    // after it, the same derivation reports the purchase, unchanged.
    const marked = store.markPaidBySession('cs_test_synthetic', 'evt_synthetic_1');
    assert.equal(marked.applied, true);
    assert.deepEqual(derive(session.getItem('iru_evaluation_token')), { hasEvaluation: true, ownedForms: [] });
    // And the language is still the persisted one after all of it.
    assert.equal(loadPersistedLang(), 'HT');
    assert.deepEqual([...local.map.entries()], [['iru_lang', 'HT']], 'localStorage still holds only the language code');
  });
});
