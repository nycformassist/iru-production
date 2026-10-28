/**
 * c5-key-semantics.test.js — C5: the has_arrests / has_prior_arrests guard.
 *
 * `has_arrests` means "disposition certificates held", not "has arrests".
 * Renaming it was rejected (orphans stored recovery payloads; during a deploy
 * an old client's key would be silently dropped by the server allowlist).
 * These tests make the meaning impossible to lose quietly instead.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVIDENCE_KEY_SEMANTICS } from './_lib/evidence.js';
import { minimizeForModel } from './_lib/privacy.js';
import { buildPrompt } from './_lib/prompt.js';

const src = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const base = { country_of_origin: 'Cuba', entry_date: '2026-10-13', case_type: 'asylum', narrative_text: '' };

describe('C5: one canonical meaning for has_arrests', () => {
  it('the constant exists, is frozen, and says NOT arrest history', () => {
    const k = EVIDENCE_KEY_SEMANTICS.has_arrests;
    assert.ok(Object.isFrozen(EVIDENCE_KEY_SEMANTICS) && Object.isFrozen(k));
    assert.match(k.promptLabel, /disposition certificates/);
    assert.match(k.promptLabel, /NOT arrest history/);
    assert.equal(k.gatedBy, 'has_prior_arrests');
  });

  it('prompt.js takes the label from the constant (no second copy of the wording)', () => {
    assert.ok(src('./_lib/prompt.js').includes('EVIDENCE_KEY_SEMANTICS.has_arrests.promptLabel'));
    assert.ok(!src('./_lib/prompt.js').includes('(disposition certificates held, NOT arrest history)'), 'literal must live only in evidence.js');
  });
});

describe('C5: every mention of has_arrests in a prompt carries its meaning', () => {
  const variants = {
    'prior arrests no (gated unknown)': { ...base, has_prior_arrests: 'no' },
    'prior arrests yes, certificates yes': { ...base, has_prior_arrests: 'yes', has_arrests: 'yes' },
    'prior arrests yes, certificates no': { ...base, has_prior_arrests: 'yes', has_arrests: 'no' },
    'legacy payload (no prior-arrests answer)': { ...base },
    'certificates yes only': { ...base, has_arrests: 'yes' },
  };
  for (const [name, answers] of Object.entries(variants)) {
    it(name, () => {
      const p = buildPrompt(minimizeForModel(answers, []));
      const lines = p.split('\n');
      // The rule paragraph wraps across lines; join each run so a wrapped
      // sentence is judged as one statement.
      const mentions = lines.map((l, i) => ({ l, i })).filter(x => x.l.includes('has_arrests'));
      assert.ok(mentions.length >= 1, 'has_arrests is mentioned');
      for (const { l, i } of mentions) {
        const window = [lines[i - 1] || '', l, lines[i + 1] || ''].join(' ');
        assert.ok(/disposition certificates/i.test(window),
          `line ${i + 1} mentions has_arrests without its meaning: ${l.trim().slice(0, 120)}`);
      }
      assert.ok(!/has_arrests:\s/.test(p), 'never the bare "has_arrests: value" form');
    });
  }
});

describe('C5: the applicant-facing question text says certificates, in all five languages', () => {
  const consts = src('../src/constants.tsx');
  const i = consts.indexOf('{ id: "has_arrests", type: "radio"');
  const seg = consts.slice(i, consts.indexOf('guardianTips', i));
  const labelsBlock = seg.slice(seg.lastIndexOf('labels: {'));
  const byLang = Object.fromEntries([...labelsBlock.matchAll(/(EN|ES|ZH|HT|AR): "([^"]*)"/g)].map(m => [m[1], m[2]]));
  const TERMS = { EN: /Certificates? of Disposition/i, ES: /certificados? de disposición/i, ZH: /处置证书/, HT: /Sètifika Dispozisyon/i, AR: /شهادات تصرف/ };
  for (const [lang, rx] of Object.entries(TERMS)) {
    it(lang, () => {
      assert.ok(byLang[lang], `${lang} label found`);
      assert.match(byLang[lang], rx);
      assert.ok(!/\b(arrested|arrestado|被逮捕|arete)\b/i.test(byLang[lang].replace(/past arrests|arrestos pasados|过去逮捕|arestasyon/gi, '')),
        'must not ask "have you been arrested" — that is has_prior_arrests');
    });
  }
});
