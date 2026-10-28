/**
 * c2-consistency-integration.test.js — C2 through the REAL /api/analyze
 * handler (fake AI client), the SSE consumer, and the client wiring.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import analyzeHandler from './analyze.js';
import { readAnalyzeStream } from './_lib/sse.js';

const Y = new Date().getUTCFullYear();

function mockReqRes(body, ip) {
  const req = { method: 'POST', body, headers: {}, socket: { remoteAddress: ip } };
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

const payload = (answers = {}, lang = 'EN') => ({
  answers: {
    country_of_origin: 'Cuba', country_of_birth: 'Cuba', citizenship: 'Cuba',
    residence_country: 'US', entry_date: `${Y}-01-05`, case_type: 'asylum',
    marital_status: 'single', has_prior_arrests: 'no', has_passport: 'no', has_i94: 'yes',
    narrative_text: '', ...answers,
  },
  lang, narrativeStarters: [], imageReviews: [],
});

const modelJson = (over = {}) => JSON.stringify({
  readinessSummary: `Cuban applicant, single, entered in ${Y}. No prior arrests reported.`,
  factsProvided: ['Country of origin: Cuba'],
  missingInformation: ['Passport (not held)'],
  contradictions: [], inferences: [], suggestedQuestions: [],
  uncertaintyNotes: [], notLegalAdvice: 'Not legal advice.', evidenceGaps: [],
  ...over,
});

async function run(json, body, ip) {
  globalThis.__IRU_AI_CLIENT__ = { async *generateContentStream() { yield { text: json }; } };
  const { req, res } = mockReqRes(body, ip);
  const logs = [];
  const orig = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };
  try { await analyzeHandler(req, res); } finally { console.log = orig; }
  const events = res.chunks.join('').split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5)));
  return { res, events, done: events.find(e => e.type === 'done'), logs };
}

describe('C2: /api/analyze annotates, never rewrites', () => {
  afterEach(() => { delete globalThis.__IRU_AI_CLIENT__; });

  it('flags a residence contradiction by field id only and leaves the assessment untouched', async () => {
    const out = JSON.parse(modelJson({ missingInformation: ['Country of residence (reported as Unknown)'] }));
    const { done, logs } = await run(JSON.stringify(out), payload(), '10.20.0.1');
    assert.deepEqual(done.integrityFlags, ['residenceCountry']);
    assert.equal(done.status, undefined, 'a flagged review is still a delivered review, not ai_unavailable');
    assert.deepEqual(done.assessment.missingInformation, out.missingInformation, 'model text must not be rewritten');
    const line = logs.find(l => l.includes('iru_analyze_consistency'));
    assert.ok(line, 'consistency event logged');
    const ev = JSON.parse(line);
    assert.deepEqual(ev.fields, ['residenceCountry']);
    assert.ok(!/Cuba|single/.test(line), 'log carries no record values or model text');
  });

  it('a clean review carries no integrityFlags key at all (payload unchanged)', async () => {
    const { done, logs } = await run(modelJson(), payload(), '10.20.0.2');
    assert.ok(!('integrityFlags' in done));
    assert.ok(!logs.some(l => l.includes('iru_analyze_consistency')));
  });

  it('C1 + C2: an untouched residence dropdown (Not provided) is not flagged', async () => {
    const body = payload(); delete body.answers.residence_country;
    const { done } = await run(modelJson({ missingInformation: ['Country of residence (reported as Unknown)'] }), body, '10.20.0.3');
    assert.ok(!('integrityFlags' in done));
  });

  it('non-English output is skipped and logged, never flagged', async () => {
    const { done, logs } = await run(modelJson({ missingInformation: ['Country of residence (unknown)'] }), payload({}, 'ES'), '10.20.0.4');
    assert.ok(!('integrityFlags' in done));
    const ev = JSON.parse(logs.find(l => l.includes('iru_analyze_consistency')));
    assert.equal(ev.skipped, 'lang');
  });

  it('the AI-failure fallback path is not checked or flagged', async () => {
    globalThis.__IRU_AI_CLIENT__ = { async *generateContentStream() { throw new Error('provider down'); } };
    const { req, res } = mockReqRes(payload(), '10.20.0.5');
    const orig = console.error; console.error = () => {};
    try { await analyzeHandler(req, res); } finally { console.error = orig; }
    const ev = res.chunks.join('').split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(e => e.type === 'error');
    assert.equal(ev.status, 'ai_unavailable');
    assert.ok(!('integrityFlags' in ev));
  });
});

describe('C2: SSE consumer and client wiring', () => {
  const enc = s => new TextEncoder().encode(s);
  const reader = bytes => { let sent = false; return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; } }; };

  it('readAnalyzeStream returns string integrityFlags and defaults to []', async () => {
    const a = await readAnalyzeStream(reader(enc(`data: ${JSON.stringify({ type: 'done', assessment: { x: 1 }, integrityFlags: ['residenceCountry', 7, null] })}\n\n`)));
    assert.deepEqual(a.integrityFlags, ['residenceCountry']);
    const b = await readAnalyzeStream(reader(enc(`data: ${JSON.stringify({ type: 'done', assessment: { x: 1 } })}\n\n`)));
    assert.deepEqual(b.integrityFlags, []);
  });

  it('App.tsx shows the note on screen and in print, and resets it on Start Over', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.ok(app.includes('setIntegrityFlags(streamFlags || [])'));
    assert.ok(app.includes('data-testid="integrity-note"'));
    assert.equal((app.match(/pktIntegrityNote/g) || []).length, 2, 'one on-screen use and one print use');
    assert.ok(app.includes('setAiUnavailable(false);\n    setIntegrityFlags([]);'), 'Start Over must clear the flags');
    assert.ok(app.includes('} else { setAiUnavailable(false); }'), 'a successful re-run must clear a stale unavailable state');
  });

  it('the note exists in all five languages', () => {
    const consts = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');
    assert.equal((consts.match(/pktIntegrityNote:/g) || []).length, 5);
  });
});
