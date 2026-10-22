/**
 * Legal grounding module tests. Verifies the authority records are
 * complete and that interpretive applications are flagged rather than
 * presented as settled rules.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LEGAL_AUTHORITIES, legalHardRules, authoritiesNeedingValidation } from './legal.js';

describe('LEGAL_AUTHORITIES', () => {
  it('documents the required authorities', () => {
    const ids = LEGAL_AUTHORITIES.map(a => a.id);
    for (const required of ['ina-208-b1Bii-iii', 'cfr-1208-13a', 'cfr-103-2-b2', 'uscis-pm-e6', 'uscis-pm-4c4', 'eoir-practice-manual']) {
      assert.ok(ids.includes(required), `missing authority ${required}`);
    }
  });

  it('every authority has citation, URL, verification date, workflows, and principles', () => {
    for (const a of LEGAL_AUTHORITIES) {
      assert.ok(a.citation && a.citation.length > 0, `${a.id} needs a citation`);
      assert.ok(/^https?:\/\//.test(a.url), `${a.id} needs a URL`);
      assert.ok(a.verifiedDate, `${a.id} needs a verification date`);
      assert.ok(Array.isArray(a.workflows) && a.workflows.length > 0, `${a.id} needs workflows`);
      assert.ok(Array.isArray(a.principles) && a.principles.length > 0, `${a.id} needs principles`);
      assert.equal(typeof a.needsLegalValidation, 'boolean', `${a.id} needs the validation flag`);
    }
  });

  it('interpretive applications are flagged, not presented as settled', () => {
    const flagged = authoritiesNeedingValidation();
    assert.ok(flagged.length > 0, 'at least one authority must be flagged interpretive');
    for (const a of flagged) {
      assert.ok(a.notes && a.notes.length > 0, `${a.id} needs an explanatory note`);
    }
  });

  it('no authority tells IRU to decide eligibility or predict acceptance', () => {
    const text = JSON.stringify(LEGAL_AUTHORITIES);
    assert.ok(!/will be (approved|accepted|granted)/i.test(text));
  });
});

describe('legalHardRules', () => {
  it('states the testimony/corroboration and secondary-evidence rules', () => {
    const r = legalHardRules();
    assert.ok(/credible.*testimony/i.test(r));
    assert.ok(/reasonably obtain/i.test(r));
    assert.ok(/8 CFR 103\.2\(b\)\(2\)/.test(r));
    assert.ok(/does not.*disprove/i.test(r));
    assert.ok(/not the adjudicator/i.test(r));
  });

  it('is a non-empty string safe to embed in a prompt', () => {
    const r = legalHardRules();
    assert.equal(typeof r, 'string');
    assert.ok(r.length > 200);
    assert.ok(!/```/.test(r), 'no code fences that could break prompt structure');
  });
});
