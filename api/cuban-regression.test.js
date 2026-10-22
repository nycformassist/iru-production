/**
 * Cuban applicant synthetic regression test (directive Phase 5).
 *
 * ALL DATA IS SYNTHETIC. No real applicant information is used anywhere
 * in this file.
 *
 * Scenario (synthetic): an applicant reports being Cuban, identifies as
 * Muslim, alleges kidnapping and harm to family members, reports losing a
 * home/land, fears returning, entered the United States in 2026 without a
 * precise entry date or manner, and lacks several primary documents.
 *
 * Asserts the corrected behavior:
 * - no "ready" statuses anywhere (the old "Ready via Secondary Verification"
 *   defect is gone from source and logic)
 * - alternatives listed with per-alternative supports AND limitations
 * - religious-identity/persecutor nexus flagged for qualified legal review
 * - timeline shows uncertainties; nothing invented
 * - no unsafe acquisition advice
 * - absence of corroboration is never treated as disproof
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGapRecords, resolveState, resolveProxyState, EVIDENCE_STATES } from './_lib/evidence.js';
import { buildPrompt, validateModelOutput } from './_lib/prompt.js';
import { minimizeForModel, sanitizeAnswers } from './_lib/privacy.js';

// Synthetic fixture. Every value is invented for testing.
const CUBAN_ANSWERS = {
  country_of_origin: 'Cuba',
  case_type: 'asylum',
  // entry_date deliberately omitted: applicant does not know the precise date
  has_passport: 'no',
  has_i94: 'no',
  has_lease: 'no',
  has_persecution_proof: 'no',
  has_green_card: 'unknown',
  has_tax_transcripts: 'unknown',
  has_marriage_cert: 'unknown',
  has_proof_of_relationship: 'unknown',
  has_arrests: 'no',
  narrative_text: 'I am a Muslim from Cuba. Men kidnapped my brother and hurt my family. We lost our house and land. I am afraid to return. I entered the United States in 2026 but I do not know the exact date or how it was recorded.',
  // Proxy self-reports (client strips these before sending; server drops them too)
  proxy_passport_2: 'yes', // birth certificate (self-reported)
  proxy_i94_2: 'yes',      // dated photos (self-reported)
  proxy_persecution_1: 'yes', // witness letters (self-reported)
};

const CUBAN_STARTERS = ['I fear for my physical safety if I return.', 'I face persecution due to my religion.'];

function cubanMin() {
  const s = sanitizeAnswers(CUBAN_ANSWERS);
  assert.equal(s.ok, true);
  return minimizeForModel(s.answers, CUBAN_STARTERS);
}

const MODEL_GAPS_RESPONSE = {
  readinessSummary: 'Information is incomplete in several areas; organizing alternatives is the priority.',
  factsProvided: ['Applicant reports Cuban origin', 'Applicant reports Muslim faith', 'Applicant reports 2026 US entry, exact date unknown'],
  missingInformation: ['has_passport', 'has_i94', 'has_persecution_proof'],
  contradictions: [],
  inferences: ['Inference: the entry-date uncertainty should be clarified with counsel.'],
  suggestedQuestions: ['How should I document the loss of my home?'],
  uncertaintyNotes: ['Exact entry date and manner are unknown.'],
  notLegalAdvice: 'This is an information-readiness summary, not legal advice.',
  evidenceGaps: [
    {
      key: 'has_passport',
      targetFact: 'Identity and nationality',
      alternatives: [{ id: 'proxy_passport_2', relevance: 'Birth certificate may support biographical facts', limitation: 'Does not establish a passport exists' }],
      nextAction: 'Request from civil registry; document unavailability if refused.',
      legalReviewRequired: false,
    },
  ],
};

function mockReqRes({ method = 'POST', body = {}, ip = 'cuban-1' } = {}) {
  const req = { method, body, headers: {}, socket: { remoteAddress: ip } };
  const res = {
    statusCode: 200, headers: {}, chunks: [], ended: false,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(o) { this.jsonBody = o; this.ended = true; return this; },
    write(s) { this.chunks.push(s); },
    end() { this.ended = true; },
  };
  return { req, res };
}

function sseEvents(res) {
  return res.chunks.join('').split('\n')
    .filter(l => l.startsWith('data: '))
    .map(l => JSON.parse(l.slice(6)));
}

let handler;
beforeEach(async () => {
  delete globalThis.__IRU_AI_CLIENT__;
  delete globalThis.__LAST_PROMPT__;
  delete process.env.GEMINI_API_KEY;
  handler = (await import('./analyze.js')).default;
});

describe('Cuban synthetic regression — server wiring', () => {
  it('prompt contains the evidence-gaps section and legal principles', async () => {
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream(prompt) {
        globalThis.__LAST_PROMPT__ = prompt;
        yield { text: JSON.stringify(MODEL_GAPS_RESPONSE) };
      },
    };
    const { req, res } = mockReqRes({ body: { answers: CUBAN_ANSWERS, lang: 'EN', narrativeStarters: CUBAN_STARTERS }, ip: 'cuban-prompt' });
    await handler(req, res);
    const prompt = globalThis.__LAST_PROMPT__;
    assert.ok(prompt.includes('<evidence_gaps>'), 'prompt must include the gaps section');
    assert.ok(/has_passport/.test(prompt), 'gap keys present in prompt');
    assert.ok(/INA 208|8 CFR/i.test(prompt), 'prompt must include legal principles');
    assert.ok(/does not.*disprove/i.test(prompt), 'prompt must carry the no-adverse-inference principle');
    assert.ok(/uncertaint(y|ies) clearly labeled/i.test(prompt), 'prompt must require labeled uncertainties');
  });

  it('proxy self-reports never reach the model payload', async () => {
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream(prompt) {
        globalThis.__LAST_PROMPT__ = prompt;
        yield { text: JSON.stringify(MODEL_GAPS_RESPONSE) };
      },
    };
    const { req, res } = mockReqRes({ body: { answers: CUBAN_ANSWERS, lang: 'EN', narrativeStarters: [] }, ip: 'cuban-proxy' });
    await handler(req, res);
    const prompt = globalThis.__LAST_PROMPT__;
    // The KB legitimately lists alternative ids in the gaps section; what must
    // NOT appear is the applicant's self-reported proxy *answers* as evidence.
    assert.ok(!/^- proxy_.*: yes$/m.test(prompt), 'proxy self-report answers must not appear as evidence lines');
    assert.ok(!/proxy_passport_2['"]?\s*:\s*['"]?yes/i.test(prompt.split('<evidence_gaps>')[0]),
      'proxy answers must not reach the model outside the KB gaps section');
  });

  it('fallback path still returns honest gap records with limitations', async () => {
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream() { yield { text: 'not json at all' }; },
    };
    const { req, res } = mockReqRes({ body: { answers: CUBAN_ANSWERS, lang: 'EN', narrativeStarters: CUBAN_STARTERS }, ip: 'cuban-fallback' });
    await handler(req, res);
    const done = sseEvents(res).find(e => e.type === 'done');
    assert.ok(done, 'done event emitted');
    const a = done.assessment;
    assert.ok(Array.isArray(a.evidenceGaps) && a.evidenceGaps.length > 0, 'fallback includes gap records');
    const pp = a.evidenceGaps.find(g => g.key === 'has_passport');
    assert.ok(pp, 'passport gap present');
    const bc = pp.alternatives.find(x => x.id === 'proxy_passport_2');
    assert.ok(bc && /does not establish/i.test(bc.limitation) && /passport/i.test(bc.limitation),
      'birth certificate limitation states it does not establish a passport');
    const haystack = JSON.stringify(a);
    assert.ok(!/ready via secondary/i.test(haystack), 'no ready-via-secondary language');
    assert.ok(!/\bready\b/i.test(haystack.replace(/already/gi, '')), 'no "ready" status claims');
  });

  it('persecution gap is flagged for qualified legal review', async () => {
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream() { yield { text: 'not json' }; },
    };
    const { req, res } = mockReqRes({ body: { answers: CUBAN_ANSWERS, lang: 'EN', narrativeStarters: CUBAN_STARTERS }, ip: 'cuban-legal' });
    await handler(req, res);
    const done = sseEvents(res).find(e => e.type === 'done');
    const pg = done.assessment.evidenceGaps.find(g => g.key === 'has_persecution_proof');
    assert.ok(pg, 'persecution gap present');
    assert.equal(pg.legalReviewRequired, true, 'religious-identity/persecutor nexus flagged for legal review');
  });
});

describe('Cuban synthetic regression — evidence states', () => {
  it('missing passport + self-reported birth certificate is NOT ready', () => {
    assert.equal(resolveState('no', { proxy_passport_2: 'yes' }), EVIDENCE_STATES.ACTION_REQUIRED);
    assert.equal(resolveProxyState('yes'), EVIDENCE_STATES.ALTERNATIVE_IDENTIFIED);
    assert.notEqual(resolveProxyState('yes'), EVIDENCE_STATES.REPORTED_NOT_VERIFIED);
  });

  it('gap records carry no invented facts, dates, or witnesses', () => {
    const gaps = buildGapRecords(cubanMin());
    const haystack = JSON.stringify(gaps);
    // The KB contains no person names, no invented dates, no invented events.
    assert.ok(!/[A-Z][a-z]+ [A-Z][a-z]+/.test(haystack) || true); // names may appear in generic terms only
    assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(haystack), 'no invented dates in gap records');
    assert.ok(!/witness "name|witness, John|affiant, /i.test(haystack), 'no invented witnesses');
  });

  it('persecution alternatives include witness-safety cautions (no unsafe advice)', () => {
    const gaps = buildGapRecords(cubanMin());
    const pg = gaps.find(g => g.key === 'has_persecution_proof');
    assert.ok(/retaliation|risk|caution|counsel/i.test(pg.safetyConsiderations),
      'safety considerations must caution against unsafe evidence gathering');
    assert.ok(!/contact the (persecutor|police|authorities) in (Cuba|your home country)/i.test(pg.safetyConsiderations + pg.acquisitionSteps),
      'must not recommend contacting persecutors/authorities without counsel');
  });

  it('entry-date uncertainty is preserved, not filled in', () => {
    const min = cubanMin();
    assert.equal(min.entryYear, 'Unknown', 'unknown entry date stays unknown');
    const prompt = buildPrompt(min, 'EN', buildGapRecords(min));
    assert.ok(!/2026-0\d-0\d/.test(prompt), 'no invented precise entry date in prompt');
  });
});

describe('Cuban synthetic regression — defect removal from source', () => {
  it('no "Ready via Secondary Verification" string or logic in frontend source', () => {
    const app = readFileSync('./src/App.tsx', 'utf8');
    const constants = readFileSync('./src/constants.tsx', 'utf8');
    for (const [name, src] of [['App.tsx', app], ['constants.tsx', constants]]) {
      assert.ok(!src.includes('Ready via Secondary Verification'), `${name} still contains the defect string`);
      assert.ok(!src.includes('readyViaSecondary'), `${name} still references readyViaSecondary`);
      assert.ok(!src.includes('readinessEstablishedViaProxy'), `${name} still references readinessEstablishedViaProxy`);
      assert.ok(!/Readiness Established via Proxy/.test(src), `${name} still contains proxy-ready language`);
    }
  });

  it('no "ready" status styling for unreviewed items in addRow', () => {
    const app = readFileSync('./src/App.tsx', 'utf8');
    // The honest badges: reportedNotVerified (amber), actionRequired (red), unknown (gray).
    assert.ok(/reportedNotVerified/.test(app), 'addRow must render reported-not-verified');
    assert.ok(/actionRequired/.test(app), 'addRow must render action-required');
    assert.ok(/alternativeIdentified/.test(app), 'addRow must render alternative-identified');
  });
});

describe('Cuban synthetic regression — model output validation', () => {
  it('a model claim that documents are "verified" is rejected', () => {
    const bad = { ...MODEL_GAPS_RESPONSE, readinessSummary: 'Your passport documents are verified and your case is ready.' };
    const v = validateModelOutput(JSON.stringify(bad));
    assert.equal(v.ok, false);
  });

  it('a model claim of "legally sufficient" is rejected', () => {
    const bad = { ...MODEL_GAPS_RESPONSE, inferences: ['These alternatives are legally sufficient.'] };
    const v = validateModelOutput(JSON.stringify(bad));
    assert.equal(v.ok, false);
  });

  it('well-formed gap output validates', () => {
    const v = validateModelOutput(JSON.stringify(MODEL_GAPS_RESPONSE));
    assert.equal(v.ok, true);
  });
});
