/**
 * Evidence states, knowledge base, and gap engine tests.
 * All data synthetic. No real applicant information.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_STATES,
  EVIDENCE_KEYS,
  resolveState,
  resolveProxyState,
  requiresLegalReview,
  legalReviewReason,
  EVIDENCE_KB,
  buildGapRecords,
  nextActionFor,
  NO_ADVERSE_INFERENCE_PRINCIPLE,
} from './evidence.js';

describe('resolveState', () => {
  it('"yes" to primary is reported-not-verified, never verified or ready', () => {
    assert.equal(resolveState('yes', {}), EVIDENCE_STATES.REPORTED_NOT_VERIFIED);
    assert.notEqual(resolveState('yes', {}), EVIDENCE_STATES.INDEPENDENTLY_VERIFIED);
  });

  it('"no" + proxy yes keeps primary at action-required', () => {
    assert.equal(
      resolveState('no', { proxy_passport_2: 'yes' }),
      EVIDENCE_STATES.ACTION_REQUIRED
    );
  });

  it('"no" + no proxies is action-required', () => {
    assert.equal(resolveState('no', {}), EVIDENCE_STATES.ACTION_REQUIRED);
    assert.equal(
      resolveState('no', { proxy_passport_2: 'no' }),
      EVIDENCE_STATES.ACTION_REQUIRED
    );
  });

  it('"unknown" resolves to unknown', () => {
    assert.equal(resolveState('unknown', {}), EVIDENCE_STATES.UNKNOWN);
    assert.equal(resolveState(undefined, {}), EVIDENCE_STATES.UNKNOWN);
    assert.equal(resolveState('garbage', {}), EVIDENCE_STATES.UNKNOWN);
  });

  it('no state string contains "ready" or "verified" except the reserved ones', () => {
    for (const [name, value] of Object.entries(EVIDENCE_STATES)) {
      if (name === 'INDEPENDENTLY_VERIFIED' || name === 'REVIEWED_SUPPORTS_LIMITED') continue;
      assert.ok(!/ready/i.test(value), `${name} must not imply ready`);
      if (name !== 'REPORTED_NOT_VERIFIED') {
        assert.ok(!/verified/i.test(value), `${name} must not imply verified`);
      }
    }
    // REPORTED_NOT_VERIFIED explicitly says NOT verified — that is the honest framing.
    assert.ok(/not-verified/.test(EVIDENCE_STATES.REPORTED_NOT_VERIFIED));
  });
});

describe('resolveProxyState', () => {
  it('"yes" proxy is alternative-identified, never ready', () => {
    assert.equal(resolveProxyState('yes'), EVIDENCE_STATES.ALTERNATIVE_IDENTIFIED);
  });
  it('other answers are action-required', () => {
    assert.equal(resolveProxyState('no'), EVIDENCE_STATES.ACTION_REQUIRED);
    assert.equal(resolveProxyState('unknown'), EVIDENCE_STATES.ACTION_REQUIRED);
  });
});

describe('EVIDENCE_KB mandatory distinctions', () => {
  const kbText = JSON.stringify(EVIDENCE_KB);

  it('covers all 9 evidence keys', () => {
    for (const k of EVIDENCE_KEYS) assert.ok(EVIDENCE_KB[k], `KB missing ${k}`);
    assert.equal(EVIDENCE_KEYS.length, 9);
  });

  it('every alternative has supports AND limitations', () => {
    for (const [key, entry] of Object.entries(EVIDENCE_KB)) {
      assert.ok(entry.targetFact && entry.primaryEvidence, `${key} needs targetFact/primaryEvidence`);
      assert.ok(entry.alternatives.length > 0, `${key} needs alternatives`);
      for (const a of entry.alternatives) {
        assert.ok(a.supports && a.supports.length > 10, `${key}/${a.id} needs supports`);
        assert.ok(a.limitations && a.limitations.length > 10, `${key}/${a.id} needs limitations`);
        assert.ok(a.acquisition && a.safety && a.reviewNeeded, `${key}/${a.id} needs acquisition/safety/reviewNeeded`);
      }
    }
  });

  it('birth certificate supports identity but does NOT establish a passport exists', () => {
    const alt = EVIDENCE_KB.has_passport.alternatives.find(a => a.id === 'proxy_passport_2');
    assert.ok(/identity|biographical/i.test(alt.supports));
    assert.ok(/does not establish|does NOT establish/i.test(alt.limitations) && /passport/i.test(alt.limitations));
  });

  it('dated US photos / clinic receipts do NOT establish entry date or manner', () => {
    for (const id of ['proxy_i94_2', 'proxy_i94_3']) {
      const alt = EVIDENCE_KB.has_i94.alternatives.find(a => a.id === id);
      assert.ok(/do not establish|do NOT establish/i.test(alt.limitations));
      assert.ok(/entry date|manner of entry/i.test(alt.limitations));
    }
  });

  it('notarized landlord/roommate letter does NOT establish a formal lease', () => {
    const alt = EVIDENCE_KB.has_lease.alternatives.find(a => a.id === 'proxy_lease_2');
    assert.ok(/does not establish|does NOT establish/i.test(alt.limitations) && /formal lease/i.test(alt.limitations));
  });

  it('court appearance notice does NOT establish final disposition', () => {
    const alt = EVIDENCE_KB.has_arrests.alternatives.find(a => a.id === 'proxy_arrests_2');
    assert.ok(/do not establish|does NOT establish/i.test(alt.limitations) && /disposition/i.test(alt.limitations));
  });

  it('country-condition evidence does NOT prove individual experience', () => {
    const alt = EVIDENCE_KB.has_persecution_proof.alternatives.find(a => a.id === 'proxy_persecution_3');
    assert.ok(/do not prove|does NOT prove|do NOT prove/i.test(alt.limitations));
  });

  it('witness statements / medical records do not prove legal eligibility by themselves', () => {
    const w = EVIDENCE_KB.has_persecution_proof.alternatives.find(a => a.id === 'proxy_persecution_1');
    const m = EVIDENCE_KB.has_persecution_proof.alternatives.find(a => a.id === 'proxy_persecution_2');
    assert.ok(/do not.*prove legal eligibility|by themselves/i.test(w.limitations));
    assert.ok(/do not.*establish who|by themselves/i.test(m.limitations));
  });

  it('persecution alternatives carry witness-safety cautions', () => {
    const w = EVIDENCE_KB.has_persecution_proof.alternatives.find(a => a.id === 'proxy_persecution_1');
    assert.ok(/retaliation|risk/i.test(w.safety));
  });

  it('no alternative is ever labeled ready/verified', () => {
    // "already" is fine — strip it before checking for "ready".
    const withoutAlready = kbText.replace(/already/gi, '');
    assert.ok(!/\bready\b/i.test(withoutAlready), 'KB must never use "ready"');
    assert.ok(!/independently verified/i.test(withoutAlready), 'KB must never claim verification');
  });
});

describe('requiresLegalReview', () => {
  it('flags persecution and arrests items', () => {
    assert.equal(requiresLegalReview('has_persecution_proof'), true);
    assert.equal(requiresLegalReview('has_arrests'), true);
    assert.ok(legalReviewReason('has_persecution_proof').length > 0);
    assert.ok(legalReviewReason('has_arrests').length > 0);
  });
  it('does not flag ordinary documentary items', () => {
    assert.equal(requiresLegalReview('has_passport'), false);
    assert.equal(requiresLegalReview('has_lease'), false);
    assert.equal(legalReviewReason('has_passport'), null);
  });
});

describe('buildGapRecords', () => {
  const min = {
    evidence: {
      has_passport: 'no', has_i94: 'unknown', has_lease: 'yes',
      has_persecution_proof: 'no', has_green_card: 'unknown',
      has_tax_transcripts: 'yes', has_marriage_cert: 'no',
      has_proof_of_relationship: 'unknown', has_arrests: 'no',
    },
  };

  it('emits one record per missing/unknown key, skipping "yes"', () => {
    const gaps = buildGapRecords(min);
    const keys = gaps.map(g => g.key);
    assert.ok(!keys.includes('has_lease'));
    assert.ok(!keys.includes('has_tax_transcripts'));
    assert.equal(keys.length, 7);
  });

  it('each record has all 10 directive fields', () => {
    const gaps = buildGapRecords(min);
    const required = ['targetFact', 'currentState', 'primaryEvidence', 'alternatives',
      'evidentiaryConnection', 'availability', 'acquisitionSteps',
      'safetyConsiderations', 'reviewRequirements', 'nextAction'];
    for (const g of gaps) {
      for (const f of required) assert.ok(g[f] !== undefined, `${g.key} missing ${f}`);
      assert.ok(g.nextAction.step && g.nextAction.responsible && g.nextAction.priority && g.nextAction.status,
        `${g.key} nextAction incomplete`);
    }
  });

  it('evidentiaryConnection states per-alternative supports and limitations', () => {
    const gaps = buildGapRecords(min);
    const pp = gaps.find(g => g.key === 'has_passport');
    assert.ok(pp.evidentiaryConnection.length >= 3);
    for (const c of pp.evidentiaryConnection) {
      assert.ok(c.supports && c.limitations);
    }
  });

  it('distinguishes "no" from "unknown" in currentState', () => {
    const gaps = buildGapRecords(min);
    const noRec = gaps.find(g => g.key === 'has_passport');
    const unkRec = gaps.find(g => g.key === 'has_i94');
    assert.ok(/do not have/i.test(noRec.currentState));
    assert.ok(/does not know|not apply/i.test(unkRec.currentState));
  });

  it('flags legal review on persecution and arrests gaps', () => {
    const gaps = buildGapRecords(min);
    const p = gaps.find(g => g.key === 'has_persecution_proof');
    const a = gaps.find(g => g.key === 'has_arrests');
    assert.equal(p.legalReviewRequired, true);
    assert.equal(a.legalReviewRequired, true);
    const pp = gaps.find(g => g.key === 'has_passport');
    assert.equal(pp.legalReviewRequired, false);
  });

  it('persecution/arrests next actions route to attorney at high priority', () => {
    assert.deepEqual(
      [nextActionFor('has_persecution_proof', 'no').responsible, nextActionFor('has_persecution_proof', 'no').priority],
      ['attorney', 'high']
    );
    assert.deepEqual(
      [nextActionFor('has_arrests', 'no').responsible, nextActionFor('has_arrests', 'no').priority],
      ['attorney', 'high']
    );
  });

  it('handles empty/missing evidence without throwing', () => {
    assert.deepEqual(buildGapRecords({}), []);
    assert.deepEqual(buildGapRecords(null), []);
    assert.deepEqual(buildGapRecords({ evidence: {} }), []);
  });
});

describe('NO_ADVERSE_INFERENCE_PRINCIPLE', () => {
  it('states that missing corroboration does not disprove the account', () => {
    assert.ok(/does not.*disprove/i.test(NO_ADVERSE_INFERENCE_PRINCIPLE));
    assert.ok(!/ready|verified/i.test(NO_ADVERSE_INFERENCE_PRINCIPLE));
  });
});
